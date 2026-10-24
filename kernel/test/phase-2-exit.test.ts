// Phase 2 exit check (item 08), deterministic part: the two "Done when"
// conditions in docs/ROADMAP.md, end to end through a real kernel composed
// with the shipped features.
//
// 1. `studio ask "remind me at 17:00 to check X"` makes Wright register a
//    trigger, and at 17:00 that trigger fires one notification with a deep
//    link, posted once.
// 2. A Loomwright version change produces one note file and one notification.
//
// Each kernel is `startKernel` over `SHIPPED_CONTRIBUTIONS`, with one swap:
// the notifications feature's due work posts through a recording stub
// notifier (`createDeliveryDueWork`), so no real notification is ever shown,
// on macOS or anywhere else. Sessions are the fake spawner/query
// (session-fakes.ts): a stand-in Wright, never the real SDK, a model or the
// network. One mutable clock is read by both `KernelDeps.now` and
// `loopDeps.now`; the trigger's "today 17:00" is fixed in one time zone, so
// the test never depends on CI's wall clock. Every Loomwright install and
// `installed_plugins.json` is a fixture under the test's temp dir: no test
// reads the real `~/.claude/plugins/installed_plugins.json`.
//
// The live half (a real model, the launchd service, a real notification) is
// the owner's run: test/phase-2-exit-live.test.ts and
// docs/evidence/phase-2-exit-runbook.md.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import { runCli } from "../src/cli/index.js";
import { SHIPPED_CONTRIBUTIONS } from "../src/features/index.js";
import type { FeatureContribution } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps, KernelOptions } from "../src/kernel.js";
import { VERSION_NOTE_SOURCE } from "../src/loomwright/index.js";
import type { DueWorkContext } from "../src/loop/types.js";
import { OSASCRIPT_PATH, TERMINAL_NOTIFIER_PATHS, createDeliveryDueWork, deepLinkFor, notificationsContribution, plistQuote } from "../src/notifications/index.js";
import type { NotificationRow, NotifierDeps, NotifierExec } from "../src/notifications/index.js";
import type { Store } from "../src/store/index.js";
import type { KernelToolResult } from "../src/tools/server.js";
import { formatZoned } from "../src/triggers/index.js";
import { fixtureContract, userEntry, writeInstalledPlugins, writeLoomwrightInstall } from "./fixtures/loomwright/helpers.js";
import type { FakeCall } from "./session-fakes.js";
import { fakeMsg, fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";

const MODEL = "claude-haiku-4-5";
/** The test's time zone: "today 17:00" is read here, never in the host's zone. */
const ZONE = "Asia/Kolkata";
/** 16:00 local on 2026-10-15 in `ZONE` (+05:30). */
const START = "2026-10-15T10:30:00.000Z";
/** The spec Wright gives: that day's 17:00 in `ZONE`, with its offset. */
const SPEC_17_00 = "2026-10-15T17:00:00+05:30";
/** The same instant as the kernel stores it (UTC). */
const AT_17_00 = "2026-10-15T11:30:00.000Z";
const ASK = "remind me at 17:00 to check X";
const REPLY = "I'll remind you at 17:00 today to check X.";
const MINUTE = 60_000;
const TN = TERMINAL_NOTIFIER_PATHS[0] as string;
const WAIT = { timeout: 10_000, interval: 10 };

let tmp: string;
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-phase2-exit-"));
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Fixtures ------------------------------------------------------------------

/** One mutable instant, read by `KernelDeps.now` and `loopDeps.now` alike. */
function mutableClock(iso: string) {
  let ms = Date.parse(iso);
  return {
    now: (): Date => new Date(ms),
    set: (to: string): void => {
      ms = Date.parse(to);
    },
    advance: (by: number): void => {
      ms += by;
    },
  };
}

function memoryKeychain() {
  const items = new Map<string, string>();
  const reader: KeychainReader = { read: (service) => items.get(service) };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { items, reader, writer };
}

/** Wright's settings with `model` set (the rest as a fresh data dir has it). */
function setModel(dataDir: string): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...settings, model: MODEL }, null, 2)}\n`);
}

interface Post {
  readonly file: string;
  readonly args: readonly string[];
  readonly input: string;
}

/**
 * The shipped contributions with the notifications feature's due work posting
 * through a recording stub (macOS with terminal-notifier present, as
 * `darwin()` in notifications.test.ts), counting the loop's ticks: the loop
 * runs every due work once per tick, so `ticks` counts ticks.
 */
function stubbedContributions() {
  const posts: Post[] = [];
  const exec: NotifierExec = async (file, args, input) => {
    posts.push({ file, args: [...args], input });
    return { status: 0, signal: null, timedOut: false, stdout: "", stderr: "" };
  };
  const notifier: NotifierDeps = { platform: "darwin", isExecutable: (p) => p === TN || p === OSASCRIPT_PATH, exec };
  const deliver = createDeliveryDueWork(notifier);
  const state = { ticks: 0 };
  const counted = async (ctx: DueWorkContext): Promise<void> => {
    await deliver(ctx);
    state.ticks++;
  };
  const contributions: readonly FeatureContribution[] = Object.freeze(
    SHIPPED_CONTRIBUTIONS.map((c) => (c === notificationsContribution ? Object.freeze({ ...c, dueWork: Object.freeze([counted]) }) : c)),
  );
  return { contributions, posts, state };
}

/** Wait until at least two more loop ticks have started after now (so one ran wholly after any change made before the call). */
async function twoMoreTicks(state: { ticks: number }): Promise<void> {
  const from = state.ticks;
  await vi.waitFor(() => expect(state.ticks).toBeGreaterThanOrEqual(from + 2), WAIT);
}

/** A kernel over the stubbed shipped contributions, the fake sessions and `clock`. */
async function startExitKernel(o: {
  dataDir: string;
  clock: ReturnType<typeof mutableClock>;
  contributions: readonly FeatureContribution[];
  sessions: NonNullable<KernelOptions["sessions"]>;
  script?: (call: FakeCall, n: number) => void;
}) {
  const keychain = memoryKeychain();
  const fakes = fakeSessions(o.script === undefined ? {} : { script: o.script });
  const d: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: fakes.deps,
    selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
    availableProviderIds: async () => ["api-key"],
    now: o.clock.now,
    loopDeps: { tickMs: 10, now: o.clock.now },
  };
  const kernel = await startKernel({ dataDir: o.dataDir, env: { PATH: "/usr/bin" }, sessions: o.sessions, contributions: o.contributions }, d);
  kernels.push(kernel);
  return { kernel, fakes, keychain };
}

/** `studio <argv>` against the running kernel on `dataDir`. */
async function studio(dataDir: string, keychain: { reader: KeychainReader }, argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(argv, {
    dataDir,
    keychain: keychain.reader,
    stdout: { write: (c: string) => stdout.push(c) },
    stderr: { write: (c: string) => stderr.push(c) },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

const success = (text: string): SDKMessage =>
  ({ type: "result", subtype: "success", is_error: false, result: text, modelUsage: {} }) as unknown as SDKMessage;

interface RegisteredTool {
  handler(args: unknown, extra: unknown): Promise<KernelToolResult>;
}

/** The tools on a launch's kernel MCP server (the server the session would call). */
function toolsOf(call: FakeCall): Record<string, RegisteredTool> {
  const server = (call.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  return (server?.instance as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

/**
 * The stand-in Wright: answers the ask by calling `kernel_trigger_register`
 * (once, today 17:00 in `ZONE`, notify, "check X"), then replies and ends.
 */
function remindingWright() {
  const toolResults: KernelToolResult[] = [];
  const script = (call: FakeCall): void => {
    call.stream.push(fakeMsg.init(call.options.sessionId ?? "unknown"));
    void (async () => {
      const result = await toolsOf(call).kernel_trigger_register?.handler(
        { kind: "once", spec: SPEC_17_00, action: "notify", text: "check X", idempotency_key: "remind-17-00" },
        {},
      );
      if (result !== undefined) toolResults.push(result);
      call.stream.push(success(REPLY));
      call.stream.end();
    })();
  };
  return { script, toolResults };
}

interface TriggerRow {
  readonly id: number;
  readonly owning_agent: string;
  readonly kind: string;
  readonly action: string;
  readonly action_payload: string;
  readonly enabled: number;
  readonly next_fire_at: string | null;
  readonly last_result: string | null;
}

const triggers = (store: Store): TriggerRow[] =>
  store.prepare<[], TriggerRow>("SELECT id, owning_agent, kind, action, action_payload, enabled, next_fire_at, last_result FROM triggers ORDER BY id").all();

const notifications = (store: Store): NotificationRow[] => store.prepare<[], NotificationRow>("SELECT * FROM notifications ORDER BY id").all();

/** The value after `flag` in a notifier argv. */
function argAfter(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

// ---- Condition 1: studio ask → trigger → 17:00 notification ------------------------

describe("phase 2 exit: studio ask creates a trigger that fires at 17:00 (AC1, AC2)", () => {
  it("the fixed instants read as 16:00 and 17:00 on 2026-10-15 in the test's zone", () => {
    expect(formatZoned(Date.parse(START), ZONE)).toBe("2026-10-15 16:00 +05:30");
    expect(formatZoned(Date.parse(SPEC_17_00), ZONE)).toBe("2026-10-15 17:00 +05:30");
    expect(new Date(SPEC_17_00).toISOString()).toBe(AT_17_00);
  });

  it("Wright registers a once trigger for today 17:00; at 17:00:01 it fires one notification with its deep link, posted once; later ticks add nothing", async () => {
    const dataDir = join(tmp, "data");
    setModel(dataDir);
    const clock = mutableClock(START);
    const stub = stubbedContributions();
    const wright = remindingWright();
    const { kernel, keychain, fakes } = await startExitKernel({
      dataDir,
      clock,
      contributions: stub.contributions,
      sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 },
      script: wright.script,
    });

    // AC1: the ask, at 16:00.
    const r = await studio(dataDir, keychain, ["ask", ASK]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${REPLY}\n`);
    expect(fakes.calls).toHaveLength(1);
    expect(fakes.calls[0]?.options.model).toBe(MODEL);
    expect(wright.toolResults).toHaveLength(1);
    expect(wright.toolResults[0]?.isError).toBeUndefined();
    const [trigger, ...others] = triggers(kernel.store);
    expect(others).toEqual([]);
    expect(trigger).toMatchObject({ owning_agent: "wright", kind: "once", action: "notify", action_payload: "check X", enabled: 1, next_fire_at: AT_17_00, last_result: null });
    const id = (trigger as TriggerRow).id;
    // Ticks at 16:00 fire nothing.
    await twoMoreTicks(stub.state);
    expect(notifications(kernel.store)).toEqual([]);
    expect(stub.posts).toEqual([]);

    // AC2: 17:00:01. The trigger fires on one tick; the delivery posts it on the next.
    clock.set("2026-10-15T11:30:01.000Z");
    await vi.waitFor(() => expect(stub.posts).toHaveLength(1), WAIT);
    const [row, ...more] = notifications(kernel.store);
    expect(more).toEqual([]);
    const n = row as NotificationRow;
    expect(n).toMatchObject({ source: `trigger:${id}`, body: "check X", deep_link: deepLinkFor(n.id), delivery_status: "delivered" });
    const post = stub.posts[0] as Post;
    expect(post.file).toBe(TN);
    expect(post.input).toBe("check X");
    // The click opens the row's own deep link in the app (`-open`), never a shell command.
    expect(argAfter(post.args, "-open")).toBe(plistQuote(deepLinkFor(n.id)));
    expect(argAfter(post.args, "-open")).toBe(plistQuote(n.deep_link));
    expect(post.args).not.toContain("-execute");

    // A `once` fires once: later ticks, the clock advanced again each time, add no row and no post.
    for (const by of [MINUTE, 60 * MINUTE, 24 * 60 * MINUTE]) {
      clock.advance(by);
      await twoMoreTicks(stub.state);
    }
    expect(notifications(kernel.store)).toHaveLength(1);
    expect(stub.posts).toHaveLength(1);
    expect(fakes.calls).toHaveLength(1);
    // ...and it is spent: off, no next fire, its last result `fired`.
    expect(triggers(kernel.store)).toEqual([expect.objectContaining({ id, enabled: 0, next_fire_at: null, last_result: "fired" })]);
   }, 30_000);
});

// ---- Condition 2: a Loomwright version change → one note, one notification ------------

describe("phase 2 exit: a Loomwright version change produces one note and one notification (AC3)", () => {
  it("installed_plugins.json switched from install A (17.2.0) to install B (17.3.0): one note, one kernel:loomwright_version notification; later ticks add neither", async () => {
    const dataDir = join(tmp, "data");
    const pluginsFile = join(tmp, "claude", "plugins", "installed_plugins.json");
    const installA = writeLoomwrightInstall(join(tmp, "cache", "loomwright", "17.2.0"), "valid");
    const b = fixtureContract();
    b.plugin_version = "17.3.0";
    (b.commands as { name: string; description: string }[]).push({ name: "phase-2-exit-added", description: "A command only 17.3.0 has." });
    b.skills = (b.skills as { name: string }[]).filter((s) => s.name !== "unit-testing");
    const installB = writeLoomwrightInstall(join(tmp, "cache", "loomwright", "17.3.0"), b);
    writeInstalledPlugins(pluginsFile, { "loomwright@atelier": [userEntry(installA, "17.2.0")] });
    const notesDir = join(dataDir, "memory", "shared", "loomwright-updates");
    const noteFiles = (): string[] => (existsSync(notesDir) ? readdirSync(notesDir).sort() : []);
    const versionNotifications = (store: Store): NotificationRow[] => notifications(store).filter((n) => n.source === VERSION_NOTE_SOURCE);

    const clock = mutableClock(START);
    const stub = stubbedContributions();
    // `installedPluginsPath` only: a configured `loomwrightPath` would win over the file.
    const { kernel } = await startExitKernel({ dataDir, clock, contributions: stub.contributions, sessions: { installedPluginsPath: pluginsFile, stopGraceMs: 10 } });
    const seen = (): { install_path: string; plugin_version: string }[] =>
      kernel.store.prepare<[], { install_path: string; plugin_version: string }>("SELECT install_path, plugin_version FROM loomwright_contract_seen ORDER BY id").all();

    // The first tick records A silently.
    await vi.waitFor(() => expect(seen()).toHaveLength(1), WAIT);
    expect(seen()).toEqual([{ install_path: installA, plugin_version: "17.2.0" }]);
    expect(noteFiles()).toEqual([]);
    expect(notifications(kernel.store)).toEqual([]);

    // The switch, then a tick at least a minute later (the watcher checks at most once a minute).
    writeInstalledPlugins(pluginsFile, { "loomwright@atelier": [userEntry(installB, "17.3.0")] });
    clock.advance(MINUTE + 1_000);
    await vi.waitFor(() => expect(versionNotifications(kernel.store)).toHaveLength(1), WAIT);
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md"]);
    const note = readFileSync(join(notesDir, "17.2.0-to-17.3.0.md"), "utf8");
    expect(note).toContain("phase-2-exit-added");
    expect(note).toContain("unit-testing");
    expect(seen()).toEqual([
      { install_path: installA, plugin_version: "17.2.0" },
      { install_path: installB, plugin_version: "17.3.0" },
    ]);
    expect(notifications(kernel.store)).toHaveLength(1);

    // Later ticks, each at least a minute after the last check, add neither.
    for (let i = 0; i < 3; i++) {
      clock.advance(MINUTE + 1_000);
      await twoMoreTicks(stub.state);
    }
    expect(noteFiles()).toEqual(["17.2.0-to-17.3.0.md"]);
    expect(versionNotifications(kernel.store)).toHaveLength(1);
    expect(notifications(kernel.store)).toHaveLength(1);
    expect(seen()).toHaveLength(2);
    // Its one post went to the stub, never to a real notifier.
    await vi.waitFor(() => expect(stub.posts).toHaveLength(1), WAIT);
   }, 30_000);
});
