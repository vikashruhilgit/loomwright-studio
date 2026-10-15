// SessionHandle.result (AC8): the `result` text of the session's last
// successful `result` message from its last attempt, once `done` settles with
// `completed`; `null` for any other outcome. Never rejects, and nothing new is
// persisted. Over the fake spawner/query in session-fakes.ts: never the real
// SDK, a model or a real process.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/sessions/index.js";
import type { SessionHandle, StartSessionParams } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import type { FakeCall } from "./session-fakes.js";
import { fakeMsg, fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

let tmp: string;
let pluginDir: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-sessions-result-"));
  pluginDir = makePluginDir(tmp);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

const success = (text: string): SDKMessage =>
  ({ type: "result", subtype: "success", is_error: false, result: text, modelUsage: {} }) as unknown as SDKMessage;
/** `subtype: success` but `is_error`: not a successful result. */
const successIsError = (text: string): SDKMessage =>
  ({ type: "result", subtype: "success", is_error: true, result: text, modelUsage: {} }) as unknown as SDKMessage;
const errorResult = (): SDKMessage =>
  ({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"], modelUsage: {} }) as unknown as SDKMessage;
const assistant = (): SDKMessage =>
  ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "working" }] }, parent_tool_use_id: null }) as unknown as SDKMessage;

/** Every message `script` returns for call `n`, then (when `end`) the stream's end. */
function setup(script: (n: number) => { messages: SDKMessage[]; end: boolean }) {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  const fakes = fakeSessions({
    script: (call: FakeCall, n) => {
      call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
      const { messages, end } = script(n);
      for (const m of messages) call.stream.push(m);
      if (end) call.stream.end();
    },
  });
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
    fakes.deps,
  );
  return { store, manager, ...fakes };
}

/** Every table's row count, to show `result` persists nothing. */
function rowCounts(store: Store): Record<string, number> {
  const tables = store.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
  return Object.fromEntries(tables.map((t) => [t, store.prepare<[], number>(`SELECT count(*) FROM ${t}`).pluck().get() ?? 0]));
}

async function start(manager: SessionManager, overrides: Partial<StartSessionParams> = {}): Promise<SessionHandle> {
  return manager.startSession(startParams(tmp, overrides));
}

describe("SessionHandle.result", () => {
  it("resolves the text of the LAST successful result, not the first", async () => {
    const { manager } = setup(() => ({ messages: [success("first"), success("T")], end: true }));
    const h = await start(manager, { closeInputOnResult: false });
    expect(await h.done).toBe("completed");
    expect(await h.result).toBe("T");
  });

  it("skips a later error result and an is_error success when the session still completed (first result decides, input closed)", async () => {
    // closeInputOnResult (default): the first result decides the status; later
    // results are still read, and only successful ones count for the text.
    const { manager } = setup(() => ({ messages: [success("T"), errorResult(), successIsError("not this")], end: true }));
    const h = await start(manager);
    expect(await h.done).toBe("completed");
    expect(await h.result).toBe("T");
  });

  it("settles with done: unsettled while the session runs, the text once it ends", async () => {
    const { manager, calls } = setup(() => ({ messages: [], end: false }));
    const h = await start(manager, { closeInputOnResult: false });
    let settled: string | null | "pending" = "pending";
    void h.result.then((r) => (settled = r));
    calls[0]?.stream.push(success("T"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe("pending");
    calls[0]?.stream.end();
    expect(await h.done).toBe("completed");
    expect(await h.result).toBe("T");
  });

  it.each([
    ["an error result", [errorResult()]],
    ["an is_error success", [successIsError("nope")]],
    ["a success followed by a final error (input kept open)", [success("earlier"), errorResult()]],
    ["no result at all", []],
  ])("resolves null (never rejects) for a session that failed with %s", async (_, messages) => {
    const { manager } = setup(() => ({ messages, end: true }));
    const h = await start(manager, { closeInputOnResult: false });
    expect(await h.done).toBe("failed");
    await expect(h.result).resolves.toBeNull();
  });

  it("resolves null for a stopped session, even after a successful result", async () => {
    const { store, manager } = setup(() => ({ messages: [success("partial")], end: false }));
    const h = await start(manager, { closeInputOnResult: false });
    await vi.waitFor(() => expect(manager.getSession(h.id)?.status).toBe("running"));
    expect(await manager.stopSession(h.id)).toBe("stopped");
    expect(await h.done).toBe("stopped");
    await expect(h.result).resolves.toBeNull();
    expect(store.prepare("SELECT status FROM sessions WHERE id = ?").pluck().get(h.id)).toBe("stopped");
  });

  it("is in memory only: the stores' rows are what they are without it", async () => {
    const { store, manager } = setup(() => ({ messages: [success("T")], end: true }));
    const h = await start(manager);
    await h.done;
    const before = rowCounts(store);
    expect(await h.result).toBe("T");
    expect(rowCounts(store)).toEqual(before);
    // The reply text is nowhere in the store.
    const dump = store.prepare<[], string>("SELECT payload_json FROM events").pluck().all().join("\n");
    expect(dump).not.toContain('"T"');
  });

  it("a resumed session's handle carries the resume attempt's text; the interrupted start's handle resolves null", async () => {
    const { manager } = setup((n) => (n === 1 ? { messages: [success("before")], end: false } : { messages: [assistant(), success("R")], end: true }));
    const h = await start(manager, { closeInputOnResult: false });
    await vi.waitFor(() => expect(manager.getSession(h.id)?.status).toBe("running"));
    await manager.stopAll({ mode: "shutdown" });
    expect(await h.done).toBe("interrupted");
    await expect(h.result).resolves.toBeNull();

    const resumed = await manager.resumeSession(h.id, { permissionMode: "default", cwd: tmp, policy: { allowedTools: [], allowedBashPrefixes: [] } });
    expect(await resumed.done).toBe("completed");
    expect(await resumed.result).toBe("R");
  });
});
