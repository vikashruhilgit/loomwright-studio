// Each session's working directory (migration 15): the session manager records
// the cwd's realpath (`resolvedPath`, the D31 check's resolution) in
// `sessions.cwd` in the insert that creates the row, `getSession` returns it,
// and a resume whose resolved cwd differs from the recorded one is refused
// `cwd_changed` before anything else runs. The SDK still gets the cwd as given.
// Driven through the real `SessionManager` (and, for the brain cases, the real
// brain handler) over the fake spawner/query from session-fakes.ts: never the
// real SDK, a model or a real process.
//
// Portable to Linux CI: every expectation is computed from `realpathSync(...)`
// (macOS's tmpdir() is behind a symlink, Linux's is not), and the firmlink
// form is built by prefixing a realpath with /System/Volumes/Data.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brainMessageHandler, defaultWrightSettingsJson, getBrainMessageByQueueId, wrightMemoryDir, wrightSettingsPath } from "../src/brain/index.js";
import type { LoomwrightSummary } from "../src/brain/index.js";
import { enqueueMessage, getQueueRow, toQueuedEvent } from "../src/loop/queue.js";
import { runStep, runStepAsync } from "../src/loop/steps.js";
import type { EventContext } from "../src/loop/types.js";
import { SessionManager } from "../src/sessions/manager.js";
import { AdmissionRefusedError, SessionError } from "../src/sessions/types.js";
import type { AdmissionDecision, ResumeSessionParams, SessionManagerOptions } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { fakeMsg, fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";
import type { FakeCall, FakeSessionsOptions } from "./session-fakes.js";

const MODEL = "claude-haiku-4-5";
const FIRMLINK = "/System/Volumes/Data";

let tmp: string;
let pluginDir: string;
let home: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-session-cwd-"));
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

const assistant = (): SDKMessage =>
  ({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, parent_tool_use_id: null }) as unknown as SDKMessage;
const success = (text = "DONE"): SDKMessage => ({ type: "result", subtype: "success", is_error: false, result: text, modelUsage: {} }) as unknown as SDKMessage;

/** A stand-in CLI that answers and ends. */
const completes = (call: FakeCall): void => {
  call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
  call.stream.push(assistant());
  call.stream.push(success());
  call.stream.end();
};

function openStore(): Store {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  return store;
}

/** A manager over the fakes with a temp home dir, a spied admission check and a spied auth `buildEnv`. */
function setup(o: { script?: FakeSessionsOptions["script"]; options?: Partial<SessionManagerOptions> } = {}) {
  const store = openStore();
  const fakes = fakeSessions({ script: o.script ?? completes });
  const admission = vi.fn((): AdmissionDecision => ({ admitted: true }));
  const buildEnv = vi.fn(() => ({ PATH: "/usr/bin" }));
  const manager = new SessionManager(
    { store, authProvider: stubProvider({ buildEnv }), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, admission, ...o.options },
    { ...fakes.deps, homeDir: home },
  );
  const refusals = () =>
    store
      .prepare<[], { session_id: number | null; payload_json: string }>("SELECT session_id, payload_json FROM events WHERE kind = 'session_refused' ORDER BY id")
      .all()
      .map((e) => ({ session_id: e.session_id, payload: JSON.parse(e.payload_json) as unknown }));
  const eventCount = (): number => store.prepare<[], number>("SELECT count(*) FROM events").pluck().get() ?? 0;
  return { store, manager, calls: fakes.calls, admission, buildEnv, refusals, eventCount };
}

/** A fresh folder under the temp dir, as created (not resolved). */
function folder(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let nextSid = 1;

/** An `interrupted` row resumable by the manager, with `cwd` recorded as given (`null`: a row from before migration 15). */
function interruptedRow(store: Store, cwd: string | null): number {
  const sid = `aaaaaaaa-bbbb-4ccc-8ddd-${String(nextSid++).padStart(12, "0")}`;
  return Number(
    store
      .prepare("INSERT INTO sessions (agent, status, sdk_session_id, model, loomwright_path, cwd) VALUES ('wright', 'interrupted', ?, ?, ?, ?)")
      .run(sid, MODEL, pluginDir, cwd).lastInsertRowid,
  );
}

const resumeIn = (cwd: string): ResumeSessionParams => ({ permissionMode: "default", cwd, policy: { allowedTools: [], allowedBashPrefixes: [] } });

async function refusal(p: Promise<unknown>): Promise<SessionError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SessionError);
  return err as SessionError;
}

describe("a start records the cwd's realpath in sessions.cwd (AC1, AC5, AC7)", () => {
  it("a plain folder: getSession returns its realpath; the SDK gets the cwd as given", async () => {
    const s = setup();
    const repo = folder("repos/demo");
    const handle = await s.manager.startSession(startParams(repo));
    expect(await handle.done).toBe("completed");
    expect(s.manager.getSession(handle.id)?.cwd).toBe(realpathSync(repo));
    expect(s.calls[0]?.options.cwd).toBe(repo);
  });

  it("a symlink to the folder, or its /System/Volumes/Data firmlink form, records the resolved folder; the SDK gets each as given", async () => {
    const s = setup();
    const repo = folder("repos/demo");
    const link = join(tmp, "demo-link");
    symlinkSync(repo, link);
    const firmlinked = join(FIRMLINK, realpathSync(repo));

    const viaLink = await s.manager.startSession(startParams(link));
    expect(await viaLink.done).toBe("completed");
    const viaFirmlink = await s.manager.startSession(startParams(firmlinked));
    expect(await viaFirmlink.done).toBe("completed");

    expect(s.manager.getSession(viaLink.id)?.cwd).toBe(realpathSync(repo));
    expect(s.manager.getSession(viaFirmlink.id)?.cwd).toBe(realpathSync(repo));
    expect(s.calls.map((c) => c.options.cwd)).toEqual([link, firmlinked]);
  });

  it("the cwd is written by the insert that creates the row, never a later UPDATE: in the store before the first message", async () => {
    // A CLI that never answers: the kernel could die right after the insert.
    const s = setup({ script: () => {} });
    // A temp trigger (never stored in the database file) that logs any UPDATE of sessions.cwd.
    s.store.prepare("CREATE TEMP TABLE cwd_updates (id INTEGER)").run();
    s.store.prepare("CREATE TEMP TRIGGER log_cwd_update AFTER UPDATE OF cwd ON main.sessions BEGIN INSERT INTO cwd_updates VALUES (new.id); END").run();
    const repo = folder("repo");
    const handle = await s.manager.startSession(startParams(repo));
    expect(s.manager.getSession(handle.id)).toMatchObject({ status: "starting", cwd: realpathSync(repo) });
    s.calls[0]?.stream.push(fakeMsg.init(handle.sdkSessionId));
    s.calls[0]?.stream.push(success());
    s.calls[0]?.stream.end();
    expect(await handle.done).toBe("completed");
    expect(s.store.prepare("SELECT count(*) FROM cwd_updates").pluck().get()).toBe(0);
  });

  it("the failed:auth row's insert records it too", async () => {
    const s = setup();
    s.buildEnv.mockImplementation(() => {
      throw new Error("no credentials");
    });
    const repo = folder("repo");
    await expect(s.manager.startSession(startParams(repo))).rejects.toThrow("no credentials");
    const row = s.store.prepare<[], { status: string; cwd: string | null }>("SELECT status, cwd FROM sessions").all();
    expect(row).toEqual([{ status: "failed:auth", cwd: realpathSync(repo) }]);
    expect(s.calls).toEqual([]);
  });
});

describe("a refused start records no session cwd (AC6)", () => {
  it("protected_cwd, invalid_params and an admission refusal insert no row; the only trace is protected_cwd's own session_refused event", async () => {
    const s = setup();
    const protectedCwd = join(home, "Documents", "repo");
    expect((await refusal(s.manager.startSession(startParams(protectedCwd)))).code).toBe("protected_cwd");
    expect((await refusal(s.manager.startSession(startParams(folder("repo"), { prompt: "" })))).code).toBe("invalid_params");
    s.admission.mockImplementation(() => ({ admitted: false, reason: "cap_parked", retryAt: null }));
    const refused = await refusal(s.manager.startSession(startParams(folder("repo"))));
    expect(refused).toBeInstanceOf(AdmissionRefusedError);

    expect(s.store.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(0);
    expect(s.refusals()).toEqual([{ session_id: null, payload: { reason: "protected_cwd", cwd: protectedCwd } }]);
    expect(s.calls).toEqual([]);
  });
});

describe("a resume runs only in the folder its session started in (AC3, AC4)", () => {
  it("another folder is refused cwd_changed naming both paths: one session_refused event, nothing spawned, admission and auth not called, the row unchanged", async () => {
    const s = setup();
    const demo = folder("repos/demo");
    const other = folder("repos/other");
    const id = interruptedRow(s.store, realpathSync(demo));
    const before = s.manager.getSession(id);
    const events = s.eventCount();

    const err = await refusal(s.manager.resumeSession(id, resumeIn(other)));
    expect(err.code).toBe("cwd_changed");
    expect(err.message).toContain(realpathSync(demo));
    expect(err.message).toContain(other);
    expect(s.refusals()).toEqual([{ session_id: id, payload: { reason: "cwd_changed", cwd: other, recorded_cwd: realpathSync(demo) } }]);
    expect(s.eventCount()).toBe(events + 1);
    expect(s.calls).toEqual([]);
    expect(s.admission).not.toHaveBeenCalled();
    expect(s.buildEnv).not.toHaveBeenCalled();
    expect(s.manager.getSession(id)).toEqual(before);
  });

  it("the same folder, a symlink to it, or its firmlink form resumes as today; the SDK gets the cwd as given", async () => {
    const s = setup();
    const demo = folder("repos/demo");
    const link = join(tmp, "demo-link");
    symlinkSync(demo, link);
    const firmlinked = join(FIRMLINK, realpathSync(demo));
    for (const cwd of [demo, link, firmlinked]) {
      const id = interruptedRow(s.store, realpathSync(demo));
      const handle = await s.manager.resumeSession(id, resumeIn(cwd));
      expect(await handle.done, cwd).toBe("completed");
      // The recorded cwd is left as it was.
      expect(s.manager.getSession(id)?.cwd).toBe(realpathSync(demo));
    }
    expect(s.calls.map((c) => c.options.cwd)).toEqual([demo, link, firmlinked]);
    expect(s.refusals()).toEqual([]);
  });

  it("a row from before migration 15 (cwd null) resumes as today in any folder, and stays null", async () => {
    const s = setup();
    const id = interruptedRow(s.store, null);
    const anywhere = folder("anywhere");
    const handle = await s.manager.resumeSession(id, resumeIn(anywhere));
    expect(await handle.done).toBe("completed");
    expect(s.calls.map((c) => c.options.cwd)).toEqual([anywhere]);
    expect(s.manager.getSession(id)?.cwd).toBeNull();
    expect(s.refusals()).toEqual([]);
  });

  it("D31 still comes first: a protected folder is refused protected_cwd, not cwd_changed", async () => {
    const s = setup();
    const id = interruptedRow(s.store, realpathSync(folder("repos/demo")));
    const protectedCwd = join(home, "Documents", "repo");
    expect((await refusal(s.manager.resumeSession(id, resumeIn(protectedCwd)))).code).toBe("protected_cwd");
    expect(s.refusals()).toEqual([{ session_id: id, payload: { reason: "protected_cwd", cwd: protectedCwd } }]);
  });
});

describe("the brain handler's sessions (AC2, and a resume in another folder)", () => {
  const UNAVAILABLE: LoomwrightSummary = { ok: false, reason: "not_installed (test)" };
  const handler = () => brainMessageHandler({ now: () => new Date("2026-10-20T10:00:00.000Z"), timeZone: () => "UTC", loomwright: () => UNAVAILABLE });

  function eventCtx(store: Store, id: number, sessions: SessionManager): EventContext {
    const row = getQueueRow(store, id);
    return {
      event: toQueuedEvent(row as NonNullable<typeof row>, "message"),
      store,
      runStep: (name, fn, opts) => runStep(store, `event:${id}:${name}`, fn, opts),
      runStepAsync: (name, fn, opts) => runStepAsync(store, `event:${id}:${name}`, fn, opts),
      sessions,
    };
  }

  function setWrightModel(dataDir: string): void {
    const file = wrightSettingsPath(dataDir);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ ...(JSON.parse(defaultWrightSettingsJson()) as object), model: MODEL }, null, 2)}\n`);
  }

  it("a message naming no workspace runs in the agent's memory folder, and sessions.cwd holds it resolved", async () => {
    const s = setup();
    const dataDir = s.store.dataDir;
    setWrightModel(dataDir);
    const { id } = enqueueMessage(s.store, { text: "hi", agent: "wright" });
    await handler()(eventCtx(s.store, id, s.manager));
    const message = getBrainMessageByQueueId(s.store, id);
    expect(message?.session_id).not.toBeNull();
    const session = s.manager.getSession(message?.session_id as number);
    expect(s.calls[0]?.options.cwd).toBe(wrightMemoryDir(dataDir));
    expect(session?.cwd).toBe(realpathSync(wrightMemoryDir(dataDir)));
    await vi.waitFor(() => expect(getBrainMessageByQueueId(s.store, id)?.status).toBe("replied"));
  });

  it("an interrupted session of the agent for the task, recorded in another folder, is not resumed there: the message fails session_refused with the reason", async () => {
    const s = setup();
    const dataDir = s.store.dataDir;
    setWrightModel(dataDir);
    const taskId = Number(s.store.prepare("INSERT INTO tasks (title, state) VALUES ('t', 'open')").run().lastInsertRowid);
    const elsewhere = realpathSync(folder("repos/demo"));
    const sessionId = interruptedRow(s.store, elsewhere);
    s.store.prepare("UPDATE sessions SET task_id = ? WHERE id = ?").run(taskId, sessionId);
    const { id } = enqueueMessage(s.store, { text: "carry on", agent: "wright", taskId });
    await expect(handler()(eventCtx(s.store, id, s.manager))).rejects.toMatchObject({ code: "cwd_changed" });
    const message = getBrainMessageByQueueId(s.store, id);
    expect(message?.status).toBe("failed");
    expect(message?.detail).toMatch(/^session_refused: cwd_changed: session \d+ ran in /);
    expect(message?.detail).toContain(elsewhere);
    expect(s.calls).toEqual([]);
    expect(s.manager.getSession(sessionId)?.status).toBe("interrupted");
  });
});
