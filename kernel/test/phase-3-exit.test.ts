// Phase 3 exit check, deterministic part: every phase 3 scope step, in order,
// end to end through one real kernel composed with the shipped features.
//
//   studio ask → Wright drafts a playbook (`kernel_playbook_create`, values
//   proposed, mirror file) → the owner sets priority and model → Wright
//   dry-runs it (shown in the mirror and in `studio approvals`) → its enable is
//   held → `studio approve <id> once` → the retried enable enables it → the
//   linked trigger fires at its instant (the playbook's model and priority) →
//   a second fire with the same dedupe key is skipped → an outward call held
//   in a fire session and approved `always` passes on the next fire, and is
//   held again after a new version → at the playbook's token limit the next
//   fire is parked and starts no session.
//
// The kernel is `startKernel` over `SHIPPED_CONTRIBUTIONS`, with two swaps:
// the brain's `message` handler reads the test's clock and zone (the shipped
// one reads the wall clock and the host zone, so a fire's `date` dedupe key
// would depend on the host), and the notifications feature's due work posts
// through a recording stub notifier and counts the loop's ticks. Sessions are
// the fake spawner/query (session-fakes.ts): a stand-in Wright and stand-in
// playbook sessions, never the real SDK, a model or the network. One mutable
// clock is read by `KernelDeps.now`, `loopDeps.now` and the brain's handler.
//
// Time zones: the playbook's cron, its dedupe key and the brain's context are
// all in `ZONE`. The budget day is the HOST's local day (`localDay`), so the
// token-limit step meters and fires inside one quarter hour of UTC
// (03:31:01Z to 03:32:01Z): every zone's midnight falls on a :00, :15, :30 or
// :45 UTC minute, so both instants are on the same budget day on any host,
// and the expected retry time is computed with `startOfNextLocalDay`.
//
// The live half (a real model, the launchd service) is the owner's run:
// test/phase-3-exit-live.test.ts and docs/evidence/phase-3-exit-runbook.md.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { PROPOSED_ALLOWED_TOOLS, brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightMemoryDir, wrightSettingsPath } from "../src/brain/index.js";
import { startOfNextLocalDay } from "../src/budget/index.js";
import { runCli } from "../src/cli/index.js";
import { SHIPPED_CONTRIBUTIONS } from "../src/features/index.js";
import type { FeatureContribution } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import type { DueWorkContext } from "../src/loop/types.js";
import { createDeliveryDueWork, notificationsContribution } from "../src/notifications/index.js";
import type { NotifierExec } from "../src/notifications/index.js";
import { getPlaybook, mirrorPath } from "../src/playbooks/index.js";
import type { Store } from "../src/store/index.js";
import type { KernelToolResult } from "../src/tools/server.js";
import { formatZoned } from "../src/triggers/index.js";
import { count, events } from "./loop-helpers.js";
import type { FakeCall } from "./session-fakes.js";
import { fakeMsg, fakeSessions, flush, makePluginDir, stubProvider } from "./session-fakes.js";

/** Wright's own model (`wright.json`): its sessions are told apart from a playbook's by it. */
const WRIGHT_MODEL = "claude-haiku-4-5";
/** The model Wright proposes in its draft. */
const PROPOSED_MODEL = "claude-sonnet-4-5";
/** The model the owner sets: every dry-run and fire session runs it. */
const PLAYBOOK_MODEL = "claude-opus-4-1";
/** The test's time zone (+05:30, no DST): the cron, the dedupe key's `date` and the brain's context read it. */
const ZONE = "Asia/Kolkata";
/** 08:00 in `ZONE` on Thu 2026-10-15. */
const START = "2026-10-15T02:30:00.000Z";
/** Every day at 09:01 and 09:02 in `ZONE`: two fires per date, so the second has the first's `date` dedupe key. */
const CRON = "1,2 9 * * *";
const PROPOSED_TOKEN_LIMIT = 50_000;
/** The owner's token limit in version 4. */
const LIMIT = 1_000;
/** Counted tokens (D26: input + output + cache writes) of the version-4 fire session: exactly `LIMIT`. */
const LIMIT_USAGE = { [PLAYBOOK_MODEL]: { inputTokens: 700, outputTokens: 200, cacheCreationInputTokens: 100, cacheReadInputTokens: 50, thinkingTokens: 0, costUSD: 0 } };
const COMMENT = "gh pr comment 12 --body status-ok";
const K = "mcp__kernel__";
const ENABLE = `${K}kernel_playbook_enable`;
const ASK_DRAFT = "Every morning at 09:01, with a 09:02 catch-up, comment on PR 12 with its status.";
const REPLY_DRAFT = "I drafted the playbook; check its values before I dry-run it.";
const ASK_ENABLE = "Dry-run the playbook and ask me to enable it.";
const REPLY_ENABLE = "Dry run done; enabling it is waiting for your approval.";
const WAIT = { timeout: 10_000, interval: 10 };

/** The `ZONE` instant `day` (2026-10-DD) at 09:0`minute`, in UTC. */
const fireAt = (day: number, minute: 1 | 2): string => `2026-10-${day}T03:3${minute}:00.000Z`;
/** One second after `fireAt`: the clock is set here so the instant is due. */
const after = (iso: string): string => new Date(Date.parse(iso) + 1_000).toISOString();

let tmp: string;
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-phase3-exit-"));
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Fixtures ------------------------------------------------------------------

/** One mutable instant, read by `KernelDeps.now`, `loopDeps.now` and the brain's handler alike. */
function mutableClock(iso: string) {
  let ms = Date.parse(iso);
  return {
    now: (): Date => new Date(ms),
    set: (to: string): void => {
      ms = Date.parse(to);
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
  return { reader, writer };
}

/**
 * Wright's settings: its model, and the proposed tool policy (the six
 * playbook tools among them) plus `gh` as an allowed Bash prefix, so a fire
 * session's `gh pr comment` reaches the kernel's rail.
 */
function writeSettings(dataDir: string): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  const policy = { status: "owner", allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: ["gh"] };
  writeFileSync(file, `${JSON.stringify({ ...settings, model: WRIGHT_MODEL, tool_policy: policy }, null, 2)}\n`);
}

/**
 * The shipped contributions with two swaps: the brain's `message` handler
 * reads the test's clock and zone, and the notifications feature's due work
 * posts through a recording stub and counts the loop's ticks.
 */
function testContributions(clock: ReturnType<typeof mutableClock>) {
  const posts: string[] = [];
  const exec: NotifierExec = async (file) => {
    posts.push(file);
    return { status: 0, signal: null, timedOut: false, stdout: "", stderr: "" };
  };
  const deliver = createDeliveryDueWork({ platform: "linux", exec });
  const state = { ticks: 0 };
  const counted = async (ctx: DueWorkContext): Promise<void> => {
    await deliver(ctx);
    state.ticks++;
  };
  const brain: FeatureContribution = Object.freeze({
    ...brainContribution,
    handlers: Object.freeze({ message: brainMessageHandler({ now: clock.now, timeZone: () => ZONE }) }),
  });
  const contributions: readonly FeatureContribution[] = Object.freeze(
    SHIPPED_CONTRIBUTIONS.map((c) => {
      if (c === brainContribution) return brain;
      if (c === notificationsContribution) return Object.freeze({ ...c, dueWork: Object.freeze([counted]) });
      return c;
    }),
  );
  return { contributions, posts, state };
}

/** Wait until at least two more loop ticks have started after now (so one ran wholly after any change made before the call). */
async function twoMoreTicks(state: { ticks: number }): Promise<void> {
  const from = state.ticks;
  await vi.waitFor(() => expect(state.ticks).toBeGreaterThanOrEqual(from + 2), WAIT);
}

const success = (text: string, modelUsage: unknown = {}): SDKMessage =>
  ({ type: "result", subtype: "success", is_error: false, result: text, modelUsage }) as unknown as SDKMessage;

interface RegisteredTool {
  handler(args: unknown, extra: unknown): Promise<KernelToolResult>;
}

/** The tools on a launch's kernel MCP server (the server the session would call). */
function toolsOf(call: FakeCall): Record<string, RegisteredTool> {
  const server = (call.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  return (server?.instance as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

/** Call a tool on `call`'s kernel server, as the session would. */
async function tool(call: FakeCall, name: string, args: unknown): Promise<KernelToolResult> {
  const t = toolsOf(call)[name];
  if (t === undefined) throw new Error(`no tool ${name} on the kernel server`);
  return t.handler(args, {});
}

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

/** Call `call`'s PreToolUse gate as the CLI would, from the session's working directory. */
function gateOf(call: FakeCall): (toolName: string, toolInput: unknown) => Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return async (toolName, toolInput) => {
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: "toolu_1",
      session_id: "s",
      transcript_path: "/dev/null",
      cwd: call.options.cwd,
    } as unknown as HookInput;
    return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
  };
}

function value<T = Record<string, unknown>>(r: KernelToolResult | undefined): T {
  expect(r?.isError, r?.content[0]?.text).toBeUndefined();
  return JSON.parse(r?.content[0]?.text ?? "null") as T;
}

/** What one stand-in session does after its `system/init`; it ends its own stream. */
type Driver = (call: FakeCall) => Promise<void>;

/**
 * The fake sessions with two queues of stand-ins: a session on Wright's model
 * (`studio ask`, an approval's decision message) runs the next Wright driver;
 * a session on the playbook's model (a dry run or a fire) runs the next
 * playbook driver. A session with no driver queued is a test failure (and is
 * ended at once, so nothing waits on it).
 */
function standIns() {
  const wright: Driver[] = [];
  const playbook: Driver[] = [];
  const failures: unknown[] = [];
  const fakes = fakeSessions({
    script: (call) => {
      call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
      const queue = call.options.model === PLAYBOOK_MODEL ? playbook : wright;
      const driver = queue.shift();
      if (driver === undefined) {
        failures.push(new Error(`a session on ${String(call.options.model)} started with no driver queued`));
        call.stream.push(success("unexpected"));
        call.stream.end();
        return;
      }
      void driver(call).catch((err: unknown) => {
        failures.push(err);
        call.stream.end();
      });
    },
  });
  return { fakes, wright, playbook, failures };
}

/** Reply `text` and end. */
const reply =
  (text: string): Driver =>
  async (call) => {
    call.stream.push(success(text));
    call.stream.end();
  };

interface RunRow {
  readonly id: number;
  readonly version: number;
  readonly kind: string;
  readonly status: string;
  readonly session_id: number | null;
  readonly dedupe_key: string | null;
  readonly tokens: number | null;
  readonly result_json: string | null;
}

const runRows = (store: Store, kind?: string): RunRow[] =>
  store
    .prepare<[], RunRow>("SELECT id, version, kind, status, session_id, dedupe_key, tokens, result_json FROM playbook_runs ORDER BY id")
    .all()
    .filter((r) => kind === undefined || r.kind === kind);

interface SessionRow {
  readonly id: number;
  readonly agent: string;
  readonly status: string;
  readonly model: string;
  readonly playbook: number | null;
  readonly playbook_version: number | null;
}

const sessionRow = (store: Store, id: number | null): SessionRow | undefined =>
  store.prepare<[number], SessionRow>("SELECT id, agent, status, model, playbook, playbook_version FROM sessions WHERE id = ?").get(id ?? 0);

/** The queued messages of playbook `id` (fires and run-nows), oldest first. */
const playbookMessages = (store: Store, id: number): { id: number; priority: string; status: string; payload: Record<string, unknown> }[] =>
  store
    .prepare<[number], { id: number; priority: string; status: string; payload_json: string }>(
      "SELECT id, priority, status, payload_json FROM event_queue WHERE kind = 'message' AND json_extract(payload_json, '$.playbook') = ? ORDER BY id",
    )
    .all(id)
    .map((r) => ({ id: r.id, priority: r.priority, status: r.status, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));

const approvalRows = (store: Store): { id: number; action: string; status: string; decision: string | null; playbook: number | null }[] =>
  store.prepare<[], { id: number; action: string; status: string; decision: string | null; playbook: number | null }>("SELECT id, action, status, decision, playbook FROM approvals ORDER BY id").all();

/** The `date` dedupe key of a fire on 2026-10-`day` in `ZONE`, as `evaluateDedupeKey` writes it. */
const dateKey = (day: number): string => JSON.stringify({ date: `2026-10-${day}` });

// ---- The test ------------------------------------------------------------------

describe("phase 3 exit: a playbook from studio ask to a parked fire, every scope step in order (AC3)", () => {
  it("the fixed instants read as 08:00, 09:01 and 09:02 in the test's zone", () => {
    expect(formatZoned(Date.parse(START), ZONE)).toBe("2026-10-15 08:00 +05:30");
    expect(formatZoned(Date.parse(fireAt(15, 1)), ZONE)).toBe("2026-10-15 09:01 +05:30");
    expect(formatZoned(Date.parse(fireAt(18, 2)), ZONE)).toBe("2026-10-18 09:02 +05:30");
  });

  it("ask → draft → owner sets → dry run → held enable → approve once → enabled → fire → duplicate skipped → always grant → held again on a new version → parked at the token limit", async () => {
    const dataDir = join(tmp, "data");
    writeSettings(dataDir);
    const clock = mutableClock(START);
    const stub = testContributions(clock);
    const s = standIns();
    const keychain = memoryKeychain();
    const d: KernelDeps = {
      keychain: keychain.reader,
      keychainWriter: keychain.writer,
      sessionDeps: s.fakes.deps,
      selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
      availableProviderIds: async () => ["api-key"],
      now: clock.now,
      loopDeps: { tickMs: 10, now: clock.now },
    };
    const kernel = await startKernel(
      { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 }, contributions: stub.contributions },
      d,
    );
    kernels.push(kernel);
    const store = kernel.store;
    const calls = s.fakes.calls;

    async function studio(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await runCli(argv, { dataDir, keychain: keychain.reader, stdout: { write: (c: string) => stdout.push(c) }, stderr: { write: (c: string) => stderr.push(c) } });
      return { code, stdout: stdout.join(""), stderr: stderr.join("") };
    }

    const noFailures = (): void => expect(s.failures).toEqual([]);

    // ---- 1. studio ask: the stand-in Wright drafts the playbook with proposed values ----
    let created: { id: number; slug: string; version: number; trigger_id: number; next_fire_at: string; mirror: string } | undefined;
    s.wright.push(async (call) => {
      await flush(1);
      created = value(
        await tool(call, "kernel_playbook_create", {
          name: "PR 12 morning status",
          intent: "Comment on PR 12 with its CI status.",
          trigger: { kind: "cron", spec: CRON, tz: ZONE },
          dedupe_key: ["date"],
          priority: "low",
          model: PROPOSED_MODEL,
          token_limit: PROPOSED_TOKEN_LIMIT,
          idempotency_key: "draft-1",
        }),
      );
      await reply(REPLY_DRAFT)(call);
    });
    const asked = await studio(["ask", ASK_DRAFT]);
    expect(asked.stderr).toBe("");
    expect(asked).toMatchObject({ code: 0, stdout: `${REPLY_DRAFT}\n` });
    noFailures();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.model).toBe(WRIGHT_MODEL);
    if (created === undefined) throw new Error("Wright created no playbook");
    const id = created.id;
    const slug = created.slug;
    expect(created).toMatchObject({ version: 1, next_fire_at: fireAt(15, 1), mirror: `memory/playbooks/${slug}.md` });
    expect(getPlaybook(store, id)).toMatchObject({
      owning_agent: "wright",
      status: "draft",
      version: 1,
      dedupe_key_spec: JSON.stringify(["date"]),
      dedupe_key_set_by: "wright",
      priority: "low",
      priority_set_by: "wright",
      model: PROPOSED_MODEL,
      model_set_by: "wright",
      token_limit_per_day: PROPOSED_TOKEN_LIMIT,
      token_limit_set_by: "wright",
    });
    expect(existsSync(mirrorPath(dataDir, slug))).toBe(true);
    expect(readFileSync(mirrorPath(dataDir, slug), "utf8")).toContain("Last dry run: No dry run yet.");
    const trigger = store.prepare<[number], { action: string; kind: string; next_fire_at: string }>("SELECT action, kind, next_fire_at FROM triggers WHERE id = ?").get(created.trigger_id);
    expect(trigger).toEqual({ action: "wake_agent", kind: "cron", next_fire_at: fireAt(15, 1) });

    // ---- 2. The owner sets priority and model (each a new version, set by the owner) ----
    expect(await studio(["playbooks", "set", String(id), "priority", "high"])).toMatchObject({ code: 0, stdout: `studio: playbook ${id} priority set to high (version 2)\n` });
    expect(await studio(["playbooks", "set", String(id), "model", PLAYBOOK_MODEL])).toMatchObject({ code: 0, stdout: `studio: playbook ${id} model set to ${PLAYBOOK_MODEL} (version 3)\n` });
    expect(getPlaybook(store, id)).toMatchObject({
      status: "draft",
      version: 3,
      priority: "high",
      priority_set_by: "owner",
      model: PLAYBOOK_MODEL,
      model_set_by: "owner",
      dedupe_key_set_by: "wright",
      token_limit_set_by: "wright",
    });

    // ---- 3. Wright dry-runs version 3, then asks to enable it: the enable is held ----
    interface DryRun {
      run_id: number;
      version: number;
      status: string;
      would_do: { tool: string; would: string }[];
      summary: string;
    }
    /** A dry-run session: it attempts the comment (recorded as would-do, never held), then ends. */
    const dryRunSession: Driver = async (call) => {
      await flush(1);
      const comment = await gateOf(call)("Bash", { command: COMMENT });
      if (comment.permissionDecision !== "deny") throw new Error(`a dry run ran ${COMMENT}`);
      await reply("DRY RUN DONE")(call);
    };
    /** Wright dry-runs the playbook and asks to enable it (held: its gate denies). */
    const dryRunThenAsk = (dryKey: string, enableKey: string, out: { dry?: DryRun; enable?: Decision }): Driver => {
      return async (call) => {
        await flush(1);
        out.dry = value<DryRun>(await tool(call, "kernel_playbook_dry_run", { id, idempotency_key: dryKey }));
        out.enable = await gateOf(call)(ENABLE, { id, idempotency_key: enableKey });
        await reply(REPLY_ENABLE)(call);
      };
    };
    /** Wright, woken by the approval's decision message, runs exactly the same enable call again in its new session. */
    const retryEnable = (enableKey: string, out: { decision?: Decision; result?: Record<string, unknown> }): Driver => {
      return async (call) => {
        await flush(1);
        const input = { id, idempotency_key: enableKey };
        out.decision = await gateOf(call)(ENABLE, input);
        if (out.decision.permissionDecision === "allow") out.result = value(await tool(call, "kernel_playbook_enable", input));
        await reply("Enabled.")(call);
      };
    };

    const v3: { dry?: DryRun; enable?: Decision } = {};
    s.wright.push(dryRunThenAsk("dry-v3", "enable-v3", v3));
    s.playbook.push(dryRunSession);
    expect(await studio(["ask", ASK_ENABLE])).toMatchObject({ code: 0, stdout: `${REPLY_ENABLE}\n` });
    noFailures();
    expect(calls).toHaveLength(3);
    // The dry-run session ran the playbook's model, recorded as the playbook's at version 3.
    expect(calls[2]?.options.model).toBe(PLAYBOOK_MODEL);
    expect(v3.dry).toMatchObject({ version: 3, status: "done", would_do: [{ tool: "Bash", would: "held" }] });
    const dry3 = v3.dry as DryRun;
    expect(runRows(store, "dry_run")).toEqual([expect.objectContaining({ id: dry3.run_id, version: 3, status: "done" })]);
    // Shown: the mirror's "Last dry run" line...
    expect(readFileSync(mirrorPath(dataDir, slug), "utf8")).toContain(`Last dry run: \`${dry3.summary}\``);
    // ...and the held enable, with the values the owner sees.
    expect(v3.enable?.permissionDecision).toBe("deny");
    expect(v3.enable?.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(approvalRows(store)).toEqual([{ id: 1, action: "kernel_playbook_enable", status: "pending", decision: null, playbook: null }]);
    expect(getPlaybook(store, id)?.status).toBe("draft");
    const shown = await studio(["approvals"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(`    Enable playbook "PR 12 morning status" (${slug}, #${id}) at version 3, agent wright\n`);
    expect(shown.stdout).toContain(`    model: ${PLAYBOOK_MODEL} (set by owner)\n`);
    expect(shown.stdout).toContain("    priority: high (set by owner)\n");
    expect(shown.stdout).toContain("    dedupe_key: date (proposed)\n");
    expect(shown.stdout).toContain(`    dry run: ${dry3.summary}\n`);

    // ---- 4. studio approve 1 once: the decision wakes Wright, whose retried enable enables version 3 ----
    const retry3: { decision?: Decision; result?: Record<string, unknown> } = {};
    s.wright.push(retryEnable("enable-v3", retry3));
    expect(await studio(["approve", "1", "once"])).toMatchObject({ code: 0 });
    await vi.waitFor(() => expect(events(store, "playbook_enabled")).toHaveLength(1), WAIT);
    noFailures();
    expect(retry3.decision).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "approval_granted" });
    expect(retry3.result).toEqual({ playbook: id, version: 3, status: "enabled", approval_id: 1 });
    expect(events(store, "playbook_enabled")[0]?.payload).toEqual({ playbook_id: id, version: 3, approval_id: 1, by: "owner" });
    expect(getPlaybook(store, id)).toMatchObject({ status: "enabled", version: 3 });
    await vi.waitFor(() => expect(calls).toHaveLength(4), WAIT);
    // Nothing fires before the instant.
    await twoMoreTicks(stub.state);
    expect(playbookMessages(store, id)).toEqual([]);

    // ---- 5. 09:01: the trigger fires; the session runs the playbook's model, the queue row its priority ----
    const fire = (): Driver => reply("FIRE DONE");
    s.playbook.push(fire());
    clock.set(after(fireAt(15, 1)));
    await vi.waitFor(() => expect(runRows(store, "fire").map((r) => r.status)).toEqual(["done"]), WAIT);
    noFailures();
    expect(calls).toHaveLength(5);
    expect(calls[4]?.options.model).toBe(PLAYBOOK_MODEL);
    expect(calls[4]?.options.cwd).toBe(wrightMemoryDir(dataDir));
    const [fire1] = runRows(store, "fire");
    expect(fire1).toMatchObject({ version: 3, dedupe_key: dateKey(15) });
    expect(sessionRow(store, fire1?.session_id ?? null)).toMatchObject({ agent: "wright", status: "completed", model: PLAYBOOK_MODEL, playbook: id, playbook_version: 3 });
    expect(playbookMessages(store, id)).toEqual([
      { id: expect.any(Number), priority: "high", status: "done", payload: { agent: "wright", playbook: id, version: 3, trigger_id: created.trigger_id, scheduled_at: fireAt(15, 1) } },
    ]);

    // ---- 6. 09:02, same date: the same dedupe key, so skipped_duplicate and no session ----
    clock.set(after(fireAt(15, 2)));
    await vi.waitFor(() => expect(runRows(store, "fire").map((r) => r.status)).toEqual(["done", "skipped_duplicate"]), WAIT);
    await twoMoreTicks(stub.state);
    noFailures();
    expect(runRows(store, "fire")[1]).toMatchObject({ version: 3, dedupe_key: dateKey(15), session_id: null });
    expect(playbookMessages(store, id).map((m) => [m.priority, m.status, m.payload.scheduled_at])).toEqual([
      ["high", "done", fireAt(15, 1)],
      ["high", "done", fireAt(15, 2)],
    ]);
    expect(calls).toHaveLength(5);

    // ---- 7. Day 2: the fire session's comment is held; the owner approves it always ----
    /** A fire session that runs the comment through its gate, then ends with `modelUsage`. */
    const commentFire = (decisions: Decision[], modelUsage: unknown = {}, until: Promise<void> = Promise.resolve()): Driver => {
      return async (call) => {
        await flush(1);
        decisions.push(await gateOf(call)("Bash", { command: COMMENT }));
        call.stream.push(success("FIRE DONE", modelUsage));
        await until;
        call.stream.end();
      };
    };
    const comments: Decision[] = [];
    s.playbook.push(commentFire(comments));
    clock.set(after(fireAt(16, 1)));
    await vi.waitFor(() => expect(runRows(store, "fire").map((r) => r.status)).toEqual(["done", "skipped_duplicate", "done"]), WAIT);
    noFailures();
    expect(comments).toHaveLength(1);
    expect(comments[0]?.permissionDecision).toBe("deny");
    expect(comments[0]?.permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
    expect(approvalRows(store)[1]).toEqual({ id: 2, action: "gh pr comment", status: "pending", decision: null, playbook: id });
    expect(events(store, "approval_requested")[1]?.payload).toMatchObject({ id: 2, source: "rail", playbook_version: 3 });
    // The decision's message wakes Wright once (it only acknowledges).
    s.wright.push(reply("Noted."));
    const always = await studio(["approve", "2", "always"]);
    expect(always.code).toBe(0);
    expect(always.stdout).toContain("always");
    expect(approvalRows(store)[1]).toMatchObject({ id: 2, status: "approved", decision: "always" });
    await vi.waitFor(() => expect(calls).toHaveLength(7), WAIT);
    // Day 2 09:02 is a duplicate of day 2 09:01 (stepped through, so day 3's fire is its own instant).
    clock.set(after(fireAt(16, 2)));
    await vi.waitFor(() => expect(runRows(store, "fire").filter((r) => r.status === "skipped_duplicate")).toHaveLength(2), WAIT);

    // ---- 8. Day 3: the same call passes on the standing grant, no new approval ----
    s.playbook.push(commentFire(comments));
    clock.set(after(fireAt(17, 1)));
    await vi.waitFor(() => expect(runRows(store, "fire").filter((r) => r.status === "done")).toHaveLength(3), WAIT);
    noFailures();
    expect(comments).toHaveLength(2);
    expect(comments[1]).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "approval_granted" });
    expect(approvalRows(store)).toHaveLength(2);
    expect(events(store, "approval_grant_used").map((e) => e.payload)).toEqual([{ id: 2, tool: "Bash" }]);
    expect(calls).toHaveLength(8);
    clock.set(after(fireAt(17, 2)));
    await vi.waitFor(() => expect(runRows(store, "fire").filter((r) => r.status === "skipped_duplicate")).toHaveLength(3), WAIT);

    // ---- 9. A new version: the owner sets the token limit, Wright dry-runs it, the owner approves its enable ----
    expect(await studio(["playbooks", "set", String(id), "token_limit", String(LIMIT)])).toMatchObject({
      code: 0,
      stdout: `studio: playbook ${id} token_limit set to ${LIMIT} (version 4)\n`,
    });
    // An edit returns the enabled playbook to draft.
    expect(getPlaybook(store, id)).toMatchObject({ status: "draft", version: 4, token_limit_per_day: LIMIT, token_limit_set_by: "owner" });
    const v4: { dry?: DryRun; enable?: Decision } = {};
    s.wright.push(dryRunThenAsk("dry-v4", "enable-v4", v4));
    s.playbook.push(dryRunSession);
    expect(await studio(["ask", ASK_ENABLE])).toMatchObject({ code: 0, stdout: `${REPLY_ENABLE}\n` });
    noFailures();
    expect(v4.dry).toMatchObject({ version: 4, status: "done" });
    expect(v4.enable?.permissionDecisionReason).toMatch(/^approval_required: held as approval 3;/);
    expect((await studio(["approvals"])).stdout).toContain(`    token_limit: ${LIMIT} (set by owner)\n`);
    const retry4: { decision?: Decision; result?: Record<string, unknown> } = {};
    s.wright.push(retryEnable("enable-v4", retry4));
    expect(await studio(["approve", "3", "once"])).toMatchObject({ code: 0 });
    await vi.waitFor(() => expect(events(store, "playbook_enabled")).toHaveLength(2), WAIT);
    noFailures();
    expect(retry4.result).toEqual({ playbook: id, version: 4, status: "enabled", approval_id: 3 });
    expect(getPlaybook(store, id)).toMatchObject({ status: "enabled", version: 4 });
    await vi.waitFor(() => expect(calls).toHaveLength(11), WAIT);

    // ---- 10. Day 4 09:01: version 4's fire session is held again (the grant was for version 3) and spends the limit ----
    let release: () => void = () => {};
    const open = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The session stays open after its result (metered at once) until `release`: a run that has
    // not ended `done` sets no dedupe key, so the next same-date fire reaches admission.
    s.playbook.push(commentFire(comments, LIMIT_USAGE, open));
    clock.set(after(fireAt(18, 1)));
    await vi.waitFor(() => expect(events(store, "playbook_limit_reached")).toHaveLength(1), WAIT);
    noFailures();
    expect(calls).toHaveLength(12);
    expect(comments).toHaveLength(3);
    expect(comments[2]?.permissionDecision).toBe("deny");
    expect(comments[2]?.permissionDecisionReason).toMatch(/^approval_required: held as approval 4;/);
    expect(approvalRows(store)[3]).toEqual({ id: 4, action: "gh pr comment", status: "pending", decision: null, playbook: id });
    expect(events(store, "approval_requested")[3]?.payload).toMatchObject({ id: 4, source: "rail", playbook_version: 4 });
    expect(events(store, "approval_grant_used")).toHaveLength(1);
    const limitedRun = runRows(store, "fire").at(-1) as RunRow;
    expect(limitedRun).toMatchObject({ version: 4, status: "running", dedupe_key: dateKey(18) });
    expect(sessionRow(store, limitedRun.session_id)).toMatchObject({ status: "running", playbook: id, playbook_version: 4 });
    expect(count(store, "SELECT COALESCE(SUM(counted_tokens), 0) FROM budget WHERE session_id = ?", limitedRun.session_id)).toBe(LIMIT);

    // ---- 11. Day 4 09:02: at the token limit the fire is parked (playbook_daily_limit) and starts no session ----
    clock.set(after(fireAt(18, 2)));
    const retryAt = startOfNextLocalDay(clock.now()).toISOString();
    await vi.waitFor(() => expect(events(store, "event_parked")).toHaveLength(1), WAIT);
    await twoMoreTicks(stub.state);
    noFailures();
    const parkedMessage = playbookMessages(store, id).at(-1);
    expect(parkedMessage).toMatchObject({ status: "pending", priority: "high", payload: { version: 4, scheduled_at: fireAt(18, 2) } });
    expect(events(store, "event_parked")[0]?.payload).toMatchObject({ queue_id: parkedMessage?.id, kind: "message", reason: "playbook_daily_limit", retry_at: retryAt });
    expect(events(store, "admission_refused").map((e) => e.payload)).toEqual([
      expect.objectContaining({ kind: "start", agent: "wright", playbook: id, reason: "playbook_daily_limit", retry_at: retryAt }),
    ]);
    const parkedRun = runRows(store, "fire").at(-1) as RunRow;
    expect(parkedRun).toMatchObject({ version: 4, status: "running", session_id: null, dedupe_key: dateKey(18) });
    expect(JSON.parse(parkedRun.result_json ?? "null")).toEqual({ parked: "playbook_daily_limit", retry_at: retryAt });
    expect(calls).toHaveLength(12);
    expect(count(store, "SELECT count(*) FROM sessions WHERE playbook = ? AND playbook_version = 4", id)).toBe(2);

    // The open session ends: its run is done with its counted tokens.
    release();
    await vi.waitFor(() => expect(runRows(store).find((r) => r.id === limitedRun.id)).toMatchObject({ status: "done", tokens: LIMIT }), WAIT);
    noFailures();
    expect(calls).toHaveLength(12);
  }, 60_000);
});
