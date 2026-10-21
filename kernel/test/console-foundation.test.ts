// The console feature's foundation (phase 5 item 01): one `console`
// contribution built from five sub-file parts (`events`, `output`, `control`,
// `pause`, `threads`, filled by items 02-06; item 03 filled `output`),
// registered eighth in `SHIPPED_CONTRIBUTIONS`, after `agents`; the part merge
// (subcommands included) and its refusal; the closed `session_output` kind
// set; and the session output observer the kernel wires
// (`recordSessionOutput`, item 03's recorder; its behaviour is pinned in
// `console-output.test.ts`). A temp data dir, an in-memory Keychain, the fake
// spawner/query and stub auth: never the real SDK, a model or the Keychain.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsContribution } from "../src/agents/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import {
  CONSOLE_PARTS,
  consoleContribution,
  consoleContributionOf,
  emptyConsolePart,
  isSessionOutputKind,
  mergeConsoleParts,
} from "../src/console/index.js";
import type { ConsolePart } from "../src/console/index.js";
import { controlPart } from "../src/console/control.js";
import { eventsPart } from "../src/console/events.js";
import { SESSION_OUTPUT_KINDS, outputPart, recordSessionOutput } from "../src/console/output.js";
import { pausePart } from "../src/console/pause.js";
import { threadsPart } from "../src/console/threads.js";
import { ContributionConflictError, PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { ContributedRoute, ContributedSubcommand, DueWorkFn } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import type { EventHandler } from "../src/loop/types.js";
import { Store } from "../src/store/index.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

// Every call the kernel makes to the console's output observer, recorded on
// the way through to the real function.
const observed = vi.hoisted(() => ({ calls: [] as { store: unknown; sessionId: number; type: string }[] }));
vi.mock("../src/console/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/console/output.js")>();
  return {
    ...actual,
    recordSessionOutput: (store: Store, sessionId: number, message: SDKMessage): void => {
      observed.calls.push({ store, sessionId, type: message.type });
      actual.recordSessionOutput(store, sessionId, message);
    },
  };
});

let tmp: string;
const stores: Store[] = [];
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-console-"));
  observed.calls.length = 0;
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

const noRoute: ContributedRoute["handler"] = async () => ({ status: 200, body: null });
const noHandler: EventHandler = () => {};
const noDueWork: DueWorkFn = () => {};
const noSubcommand = (name: string): ContributedSubcommand => ({ name, help: `studio ${name}`, run: async () => 0 });

describe("the console contribution", () => {
  it("is registered eighth, after agents (the last shipped contribution)", () => {
    expect(SHIPPED_CONTRIBUTIONS).toHaveLength(8);
    expect(SHIPPED_CONTRIBUTIONS[6]).toBe(agentsContribution);
    expect(SHIPPED_CONTRIBUTIONS[7]).toBe(consoleContribution);
    expect(consoleContribution.name).toBe("console");
  });

  it("is its name, the events and output parts' routes and output's sessions subcommand: no tools, handlers or due work", () => {
    expect(Object.keys(consoleContribution)).toEqual(["name", "routes", "subcommands"]);
    expect(Object.isFrozen(consoleContribution)).toBe(true);
    expect(consoleContribution.routes).toEqual([...eventsPart.routes, ...outputPart.routes]);
    expect(consoleContribution.subcommands).toEqual(outputPart.subcommands);
    const merged = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED);
    expect(merged.contributors.at(-1)).toBe("console");
    expect(merged.routes.filter((r) => r.owner === "console").map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /events",
      "GET /sessions",
      "GET /sessions/:id/output",
    ]);
    expect(merged.subcommands.filter((s) => consoleContribution.subcommands?.includes(s)).map((s) => s.name)).toEqual(["sessions"]);
    expect(merged.dueWork.filter((d) => d.owner === "console")).toEqual([]);
  });

  it("merges one part per sub-file, in order: events, output, control, pause, threads; events carries GET /events, output has routes and subcommands, the rest are empty", () => {
    expect(CONSOLE_PARTS).toEqual([eventsPart, outputPart, controlPart, pausePart, threadsPart]);
    expect(CONSOLE_PARTS[0]).toBe(eventsPart);
    expect(CONSOLE_PARTS[1]).toBe(outputPart);
    expect(CONSOLE_PARTS[2]).toBe(controlPart);
    expect(CONSOLE_PARTS[3]).toBe(pausePart);
    expect(CONSOLE_PARTS[4]).toBe(threadsPart);
    expect(CONSOLE_PARTS.map((p) => p.name)).toEqual(["events", "output", "control", "pause", "threads"]);
    // Item 02's part: the one `GET /events` route, nothing else.
    expect(eventsPart).toEqual({ name: "events", tools: [], routes: [{ method: "GET", path: "/events", handler: expect.any(Function) }], handlers: {} });
    // Item 03's part: its routes and the `sessions` verb, nothing else.
    expect(Object.keys(outputPart)).toEqual(["name", "tools", "routes", "handlers", "subcommands"]);
    expect(outputPart.tools).toEqual([]);
    expect(outputPart.handlers).toEqual({});
    expect(outputPart.dueWork).toBeUndefined();
    expect(outputPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /sessions", "GET /sessions/:id/output"]);
    expect(outputPart.subcommands?.map((s) => s.name)).toEqual(["sessions"]);
    // Every other part stays empty until its item fills it in.
    for (const part of CONSOLE_PARTS.filter((p) => p !== eventsPart && p !== outputPart)) {
      expect(part, part.name).toEqual({ name: part.name, tools: [], routes: [], handlers: {} });
    }
    expect(mergeConsoleParts(CONSOLE_PARTS)).toEqual({
      tools: [],
      routes: [...eventsPart.routes, ...outputPart.routes],
      subcommands: outputPart.subcommands,
      handlers: {},
      dueWork: [],
    });
  });

  it("a filled part's routes, handlers and due work reach the contribution in part order; with no part's subcommands it gets no subcommands key", () => {
    const first: ConsolePart = { ...emptyConsolePart("first"), routes: [{ method: "GET", path: "/probe/a", handler: noRoute }], dueWork: [noDueWork] };
    const second: ConsolePart = { ...emptyConsolePart("second"), routes: [{ method: "GET", path: "/probe/b", handler: noRoute }], handlers: { message: noHandler } };
    const contribution = consoleContributionOf([first, second]);
    expect(Object.keys(contribution)).toEqual(["name", "routes", "handlers", "dueWork"]);
    expect(contribution.routes?.map((r) => r.path)).toEqual(["/probe/a", "/probe/b"]);
    expect(contribution.handlers).toEqual({ message: noHandler });
    expect(contribution.dueWork).toEqual([noDueWork]);
    // An empty subcommands list is not a key either.
    expect(Object.keys(consoleContributionOf([{ ...emptyConsolePart("third"), subcommands: [] }]))).toEqual(["name"]);
  });

  it("a part's subcommands reach the contribution in part order, and mergeContributions checks their names", () => {
    const a = noSubcommand("probe-a");
    const b = noSubcommand("probe-b");
    const c = noSubcommand("probe-c");
    const first: ConsolePart = { ...emptyConsolePart("first"), subcommands: [a, b] };
    const second: ConsolePart = { ...emptyConsolePart("second"), routes: [{ method: "GET", path: "/probe/a", handler: noRoute }], subcommands: [c] };
    expect(mergeConsoleParts([first, emptyConsolePart("empty"), second]).subcommands).toEqual([a, b, c]);
    const contribution = consoleContributionOf([first, second]);
    expect(Object.keys(contribution)).toEqual(["name", "routes", "subcommands"]);
    expect(contribution.subcommands).toEqual([a, b, c]);
    expect(mergeContributions([contribution], PHASE1_RESERVED).subcommands.map((s) => s.name)).toEqual(["probe-a", "probe-b", "probe-c"]);
    // A collision is mergeContributions' refusal, as for tools and routes: two parts, or a phase 1 word.
    const twice = consoleContributionOf([first, { ...emptyConsolePart("again"), subcommands: [noSubcommand("probe-a")] }]);
    expect(() => mergeContributions([twice], PHASE1_RESERVED)).toThrow(ContributionConflictError);
    const reserved = consoleContributionOf([{ ...emptyConsolePart("word"), subcommands: [noSubcommand("status")] }]);
    expect(() => mergeContributions([reserved], PHASE1_RESERVED)).toThrow(ContributionConflictError);
  });

  it("refuses two parts that claim one handler kind, naming both", () => {
    const a: ConsolePart = { ...emptyConsolePart("events"), handlers: { message: noHandler } };
    const b: ConsolePart = { ...emptyConsolePart("threads"), handlers: { message: noHandler } };
    let err: unknown;
    try {
      mergeConsoleParts([a, b]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect(err).toMatchObject({ part: "handler", conflictName: "message", owners: ["events", "threads"] });
  });
});

describe("the session output kinds", () => {
  it("are exactly the six closed values, frozen", () => {
    expect(SESSION_OUTPUT_KINDS).toEqual(["assistant_text", "tool_call", "tool_decision", "tool_result", "result", "system"]);
    expect(Object.isFrozen(SESSION_OUTPUT_KINDS)).toBe(true);
    for (const kind of SESSION_OUTPUT_KINDS) expect(isSessionOutputKind(kind)).toBe(true);
    for (const other of ["assistant", "", "SYSTEM", 1, null, undefined]) expect(isSessionOutputKind(other)).toBe(false);
  });
});

describe("recordSessionOutput", () => {
  it("records the message into the session's output log and announces it: one row, one session_output_appended event, nothing returned", () => {
    const store = new Store({ dataDir: join(tmp, "data") });
    stores.push(store);
    store.prepare("INSERT INTO sessions (agent, status) VALUES ('wright', 'running')").run();
    const message = { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } } as unknown as SDKMessage;
    expect(recordSessionOutput(store, 1, message)).toBeUndefined();
    expect(store.prepare("SELECT session_id, seq, kind, payload_json FROM session_output").all()).toEqual([
      { session_id: 1, seq: 1, kind: "assistant_text", payload_json: '{"text":"hi"}' },
    ]);
    expect(store.prepare("SELECT kind, actor, session_id, payload_json FROM events").all()).toEqual([
      { kind: "session_output_appended", actor: "kernel", session_id: 1, payload_json: '{"from_seq":1,"to_seq":1}' },
    ]);
  });

  it("is the kernel's onOutput observer: startKernel calls it with its own store for every SDK message of a session", async () => {
    const items = new Map<string, string>();
    const keychain: KeychainReader = { read: (service) => items.get(service) };
    const writer: KeychainWriter = {
      add(service, _account, secret) {
        items.set(service, secret);
      },
    };
    const fakes = fakeSessions();
    const kernel = await startKernel(
      { dataDir: join(tmp, "data"), env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 } },
      {
        keychain,
        keychainWriter: writer,
        sessionDeps: fakes.deps,
        selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
        availableProviderIds: async () => ["api-key"],
      },
    );
    kernels.push(kernel);
    const handle = await kernel.sessions.startSession(startParams(tmp));
    // The fake CLI's first message is its system/init.
    await vi.waitFor(() => expect(observed.calls).toHaveLength(1));
    expect(observed.calls[0]).toEqual({ store: kernel.store, sessionId: handle.id, type: "system" });
    expect(observed.calls[0]?.store).toBe(kernel.store);
    // The real recorder ran on the kernel's store: the init is the session's first row.
    expect(kernel.store.prepare("SELECT seq, kind, json_extract(payload_json, '$.subtype') AS subtype FROM session_output WHERE session_id = ?").all(handle.id)).toEqual([
      { seq: 1, kind: "system", subtype: "init" },
    ]);
    expect(kernel.store.prepare("SELECT count(*) FROM events WHERE kind = 'observer_error'").pluck().get()).toBe(0);
  });
});
