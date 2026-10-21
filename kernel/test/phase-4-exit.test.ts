// Phase 4 exit check, deterministic part: "a specialist created from chat can
// do only what its policy allows. Tested: a comment-only reviewer can't push",
// every scope step in order, end to end through one real kernel composed with
// the shipped features.
//
//   studio ask → the stand-in Wright drafts mason's charter
//   (`kernel_agent_create`: never git_push nor any PR/issue write but
//   gh_pr_comment, Bash `git` / `gh pr view|diff|comment`, the repo as its one
//   workspace, sessions_at_once 1, a small tokens_per_day) → held, shown in
//   `studio approvals` with the enforced line → `studio approve <id> once`: the
//   kernel creates mason → `studio ask --agent mason --workspace <repo>`: in
//   mason's own session a `git push` is denied `agent_boundary` (no approval,
//   the bare remote's ref unchanged) and a `gh pr comment` is held, then denied
//   by the owner → Wright delegates to mason, mason's reply comes back, and a
//   further delegation past Wright's `delegation_depth` is refused → a second
//   mason start is parked `agent_sessions_at_once` and runs once the first
//   ends → past its `tokens_per_day` the next start is parked
//   `agent_daily_limit` → the next budget day, a playbook Wright drafts for
//   mason dry-runs and fires as mason → `studio agents off mason`, and the next
//   ask is refused, nothing queued.
//
// The kernel is `startKernel` over `SHIPPED_CONTRIBUTIONS`, with two swaps
// (phase 3's): the brain's `message` handler reads the test's clock and zone,
// and the notifications feature's due work posts through a recording stub
// notifier and counts the loop's ticks. Sessions are the fake spawner/query
// (session-fakes.ts): stand-in Wright, mason and playbook sessions, routed by
// model, never the real SDK, a model or the network. One mutable clock is read
// by `KernelDeps.now`, `loopDeps.now` and the brain's handler. The repo is a
// real git repo under the test's temporary folder with one unpushed commit and
// a local bare remote; git runs with no global or system config.
//
// Time: the budget day is the HOST's local day (`localDay`). Steps 1 to 8 run
// between 03:31Z and 03:32Z (the clock moves once, by the sessions-at-once
// recheck): every zone's midnight falls on a :00, :15, :30 or :45 UTC minute,
// so they are one budget day on any host. Step 9 moves the clock past that
// day's end (`startOfNextLocalDay`, the parked start's own retry time).
//
// The live half (a real model, the launchd service) is the owner's run:
// test/phase-4-exit-live.test.ts and docs/evidence/phase-4-exit-runbook.md.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentFilePaths, agentMemoryDir, getAgent } from "../src/agents/index.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { PROPOSED_ALLOWED_TOOLS, brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import { SESSIONS_AT_ONCE_RECHECK_MS, localDay, startOfNextLocalDay } from "../src/budget/index.js";
import { runCli } from "../src/cli/index.js";
import { SHIPPED_CONTRIBUTIONS } from "../src/features/index.js";
import type { FeatureContribution } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import type { DueWorkContext } from "../src/loop/types.js";
import { createDeliveryDueWork, notificationsContribution } from "../src/notifications/index.js";
import type { NotifierExec } from "../src/notifications/index.js";
import { getPlaybook } from "../src/playbooks/index.js";
import { NEVER_CATEGORIES } from "../src/sessions/policy.js";
import type { Store } from "../src/store/index.js";
import type { KernelToolResult } from "../src/tools/server.js";
import { count, events } from "./loop-helpers.js";
import type { FakeCall } from "./session-fakes.js";
import { fakeMsg, fakeSessions, flush, makePluginDir, stubProvider } from "./session-fakes.js";

/** Wright's own model (`wright.json`): its sessions are told apart from mason's and the playbook's by it. */
const WRIGHT_MODEL = "claude-haiku-4-5";
/** The model Wright proposes for mason in the charter: mason's own sessions run it. */
const MASON_MODEL = "claude-sonnet-4-5";
/** The playbook's model: its dry run and fire run it (as mason). */
const PLAYBOOK_MODEL = "claude-opus-4-1";
/** The brain's context zone (no DST). */
const ZONE = "Asia/Kolkata";
/** Steps 1 to 8 start here (see the header on time). */
const START = "2026-10-20T03:31:00.000Z";
/** Mason's proposed `limits.tokens_per_day`: small, so one session's usage passes it. */
const MASON_TOKENS_PER_DAY = 1_000;
/** Counted tokens (D26: input + output + cache writes) of one mason session in step 7: 1,200, past the limit. */
const PAST_LIMIT_USAGE = { [MASON_MODEL]: { inputTokens: 900, outputTokens: 200, cacheCreationInputTokens: 100, cacheReadInputTokens: 50, thinkingTokens: 0, costUSD: 0 } };
const K = "mcp__kernel__";
const CREATE = `${K}kernel_agent_create`;
const MESSAGE = `${K}kernel_agent_message`;
const ENABLE = `${K}kernel_playbook_enable`;
const PUSH = "git push origin main";
const COMMENT = 'gh pr comment 1 -b "LGTM"';
/** Every PR/issue write category but the comment (`gh_` in `NEVER_CATEGORIES`), and the push: mason's `never`. */
const MASON_NEVER: readonly string[] = NEVER_CATEGORIES.filter((c) => c === "git_push" || (c.startsWith("gh_") && c !== "gh_pr_comment"));
const MASON_PREFIXES = ["git", "gh pr view", "gh pr diff", "gh pr comment"];
const MASON_TOOLS = ["Read", "Grep", "Bash"];
const ASK_CREATE = "Make me a reviewer for the repo that only leaves review comments on pull requests and never pushes anything.";
const WAIT = { timeout: 10_000, interval: 10 };
const GIT_ID = ["-c", "user.name=Studio Test", "-c", "user.email=studio-test@example.test", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"];

let tmp: string;
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-phase4-exit-"));
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
  return { reader, writer };
}

/**
 * Wright's settings: its model, the proposed tool policy (the four
 * `kernel_agent_*` tools and the playbook tools among them) and
 * `limits.delegation_depth: 1`. No `never` and no `workspaces`: Wright's file
 * refuses both (`settings_invalid`).
 */
function writeSettings(dataDir: string): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  const policy = { status: "owner", allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] };
  writeFileSync(file, `${JSON.stringify({ ...settings, model: WRIGHT_MODEL, tool_policy: policy, limits: { delegation_depth: 1 } }, null, 2)}\n`);
}

/** `git` with the fixture's identity and no global or system config (CI has no identity; the owner's config is never read). */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", [...GIT_ID, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

/** A repo at `<tmp>/repo` with one commit pushed to the bare remote `<tmp>/remote.git` and one more left unpushed. */
function gitFixture(): { repo: string; remote: string; remoteRef: () => string } {
  const repo = join(tmp, "repo");
  const remote = join(tmp, "remote.git");
  git(["init", "--bare", remote]);
  git(["init", repo]);
  writeFileSync(join(repo, "README.md"), "# demo\n");
  git(["add", "README.md"], repo);
  git(["commit", "-m", "first"], repo);
  git(["remote", "add", "origin", remote], repo);
  git(["push", "origin", "main"], repo);
  writeFileSync(join(repo, "CHANGE.md"), "unpushed\n");
  git(["add", "CHANGE.md"], repo);
  git(["commit", "-m", "second (unpushed)"], repo);
  return { repo, remote, remoteRef: () => git(["--git-dir", remote, "rev-parse", "refs/heads/main"]) };
}

/** Mason's charter, as the stand-in Wright drafts it from the owner's sentence. */
function masonCharter(repo: string): Record<string, unknown> {
  return {
    id: "mason",
    display_name: "Mason",
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful reviewer who comments on pull requests.\nIt explains each finding plainly.",
    duties: ["Review the pull requests in the repo and leave review comments."],
    boundaries: ["Never push code, and never open, edit, review-approve or close a pull request or issue."],
    model: MASON_MODEL,
    permission_mode: "default",
    tool_policy: { allowedTools: MASON_TOOLS, allowedBashPrefixes: MASON_PREFIXES, never: [...MASON_NEVER] },
    limits: { tokens_per_day: MASON_TOKENS_PER_DAY, sessions_at_once: 1 },
    workspaces: [repo],
  };
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
 * The fake sessions with three queues of stand-ins, by the session's model:
 * Wright's (`studio ask`, a decision's message, a crew reply), mason's (its
 * own messages) and the playbook's (a dry run or a fire, run as mason). A
 * session with no driver queued is a test failure (and is ended at once, so
 * nothing waits on it).
 */
function standIns() {
  const wright: Driver[] = [];
  const mason: Driver[] = [];
  const playbook: Driver[] = [];
  const failures: unknown[] = [];
  const fakes = fakeSessions({
    script: (call) => {
      call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
      const model = call.options.model;
      const queue = model === MASON_MODEL ? mason : model === PLAYBOOK_MODEL ? playbook : wright;
      const driver = queue.shift();
      if (driver === undefined) {
        failures.push(new Error(`a session on ${String(model)} started with no driver queued`));
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
  return { fakes, wright, mason, playbook, failures };
}

/** Reply `text` (with `modelUsage`) and end. */
const reply =
  (text: string, modelUsage: unknown = {}): Driver =>
  async (call) => {
    call.stream.push(success(text, modelUsage));
    call.stream.end();
  };

interface SessionRow {
  readonly id: number;
  readonly agent: string;
  readonly status: string;
  readonly model: string;
  readonly playbook: number | null;
}

const sessionRows = (store: Store, agent?: string): SessionRow[] =>
  store
    .prepare<[], SessionRow>("SELECT id, agent, status, model, playbook FROM sessions ORDER BY id")
    .all()
    .filter((r) => agent === undefined || r.agent === agent);

/** The text of the message the decision on approval `id` queued (`sourceRef: approval:<id>`), and its agent. */
const decisionMessage = (store: Store, id: number): { agent: string; text: string } | undefined =>
  store
    .prepare<[string], { agent: string; text: string }>(
      "SELECT json_extract(payload_json, '$.agent') AS agent, json_extract(payload_json, '$.text') AS text FROM event_queue WHERE kind = 'message' AND source_ref = ?",
    )
    .get(`approval:${id}`);

interface ApprovalRow {
  readonly id: number;
  readonly action: string;
  readonly status: string;
  readonly decision: string | null;
  readonly requesting_session: number | null;
}

const approvalRows = (store: Store): ApprovalRow[] =>
  store.prepare<[], ApprovalRow>("SELECT id, action, status, decision, requesting_session FROM approvals ORDER BY id").all();

interface MessageRow {
  readonly id: number;
  readonly queue_id: number;
  readonly agent: string;
  readonly source: string;
  readonly text: string;
  readonly status: string;
  readonly session_id: number | null;
  readonly reply_text: string | null;
  readonly detail: string | null;
  readonly from_agent: string | null;
  readonly depth: number;
  readonly reply_to: number | null;
  readonly workspace: string | null;
}

const messageRows = (store: Store): MessageRow[] =>
  store
    .prepare<[], MessageRow>("SELECT id, queue_id, agent, source, text, status, session_id, reply_text, detail, from_agent, depth, reply_to, workspace FROM brain_messages ORDER BY id")
    .all();

/** The payloads of the queued `message` events, oldest first. */
const queuedMessages = (store: Store): Record<string, unknown>[] =>
  store
    .prepare<[], string>("SELECT payload_json FROM event_queue WHERE kind = 'message' ORDER BY id")
    .pluck()
    .all()
    .map((p) => JSON.parse(p) as Record<string, unknown>);

const runRows = (store: Store): { kind: string; status: string; session_id: number | null }[] =>
  store.prepare<[], { kind: string; status: string; session_id: number | null }>("SELECT kind, status, session_id FROM playbook_runs ORDER BY id").all();

// ---- The test ------------------------------------------------------------------

describe("phase 4 exit: a comment-only reviewer created from chat can't push, every scope step in order (AC1)", () => {
  it("mason's never list holds every PR/issue write but the comment, and the push", () => {
    expect(MASON_NEVER).toEqual(["git_push", "gh_pr_create", "gh_pr_review", "gh_pr_edit", "gh_pr_close", "gh_issue_create", "gh_issue_comment", "gh_issue_edit", "gh_issue_close", "gh_api_write"]);
  });

  it("ask → held charter → approve once → mason's push denied agent_boundary (remote unchanged), comment held and denied → delegation and its depth limit → sessions at once → daily tokens → crew playbook → off", async () => {
    const dataDir = join(tmp, "data");
    const home = join(tmp, "home");
    mkdirSync(home);
    writeSettings(dataDir);
    const fixture = gitFixture();
    const repo = fixture.repo;
    const clock = mutableClock(START);
    const stub = testContributions(clock);
    const s = standIns();
    const keychain = memoryKeychain();
    const d: KernelDeps = {
      keychain: keychain.reader,
      keychainWriter: keychain.writer,
      sessionDeps: { ...s.fakes.deps, homeDir: home },
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
    /** The last fake call (the session that just started). */
    const lastCall = (): FakeCall => calls[calls.length - 1] as FakeCall;
    /** The session row of fake call `i` (fake calls and session rows are made one for one, in order). */
    const rowOfCall = (i: number): SessionRow | undefined => sessionRows(store)[i];

    // The fixture: one unpushed commit, a bare remote outside the data dir.
    const pushedRef = fixture.remoteRef();
    expect(git(["rev-parse", "HEAD"], repo)).not.toBe(pushedRef);
    expect(git(["rev-list", "--count", "origin/main..main"], repo)).toBe("1");

    // ---- 1. studio ask: the stand-in Wright drafts mason's charter with kernel_agent_create ----
    let held: Decision | undefined;
    s.wright.push(async (call) => {
      await flush(1);
      held = await gateOf(call)(CREATE, { charter: masonCharter(repo), idempotency_key: "create-mason" });
      await reply("I drafted Mason, a comment-only reviewer; it is waiting for your approval.")(call);
    });
    const asked = await studio(["ask", ASK_CREATE]);
    expect(asked).toEqual({ code: 0, stderr: "", stdout: "I drafted Mason, a comment-only reviewer; it is waiting for your approval.\n" });
    noFailures();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.model).toBe(WRIGHT_MODEL);
    expect(rowOfCall(0)).toMatchObject({ agent: "wright", status: "completed" });
    expect(messageRows(store)).toEqual([expect.objectContaining({ agent: "wright", source: "ask", text: ASK_CREATE, status: "replied", session_id: rowOfCall(0)?.id })]);

    // ---- 2. Held (nothing created yet); studio approvals shows the header and the enforced never line ----
    expect(held?.permissionDecision).toBe("deny");
    expect(held?.permissionDecisionReason).toMatch(/^approval_required: held as approval 1; .*the kernel applies it itself .*do not repeat the call\.$/);
    expect(approvalRows(store)).toEqual([{ id: 1, action: "kernel_agent_create", status: "pending", decision: null, requesting_session: rowOfCall(0)?.id }]);
    expect(getAgent(store, "mason")).toBeUndefined();
    expect(agentFilePaths(dataDir, "mason").all.filter((p) => existsSync(p))).toEqual([]);
    const shown = await studio(["approvals"]);
    expect(shown.code).toBe(0);
    const block = shown.stdout.slice(shown.stdout.indexOf("  display:\n"), shown.stdout.indexOf("  payload:\n"));
    const [header, enforced] = block.split("\n").slice(1, 3);
    expect(header).toBe('    Create crew member mason ("Mason", crab crew-teal), proposed by Wright');
    expect(enforced?.startsWith("    enforced: never: ")).toBe(true);
    const neverShown = (enforced ?? "").slice("    enforced: never: ".length).split(";")[0]?.split(", ");
    expect(neverShown).toEqual([...MASON_NEVER]);
    expect(neverShown).toContain("git_push");
    expect(neverShown).not.toContain("gh_pr_comment");
    expect(enforced).toBe(`    enforced: never: ${MASON_NEVER.join(", ")}; tools: ${MASON_TOOLS.join(", ")}; bash prefixes: ${MASON_PREFIXES.map((p) => JSON.stringify(p)).join(", ")}`);

    // ---- 3. studio approve 1 once: the kernel creates mason; Wright's decision message says Nothing to repeat ----
    const applied = "The kernel created crew member mason (Mason) on approval 1.";
    s.wright.push(reply("Noted: Mason exists."));
    expect(await studio(["approve", "1", "once"])).toEqual({
      code: 0,
      stderr: "",
      stdout: `studio: approval 1 approved once: kernel_agent_create; the requesting agent gets a message\nstudio: the kernel applied it: ${applied}\n`,
    });
    expect(getAgent(store, "mason")).toMatchObject({ status: "active", created_by: "wright", approval_id: 1, display_name: "Mason" });
    const paths = agentFilePaths(dataDir, "mason");
    expect(paths.memory.map((p) => p.slice(paths.memoryDir.length + 1))).toEqual(["role.md", "preferences.md", "people.md", "lessons.md"]);
    expect(paths.all.filter((p) => existsSync(p))).toEqual([paths.settings, ...paths.memory]);
    const created = decisionMessage(store, 1);
    expect(created).toEqual({ agent: "wright", text: `approved approval 1: kernel_agent_create. ${applied} Nothing to repeat.` });
    expect(created?.text).toContain("Nothing to repeat.");
    // Wright receives it: one Wright session handles the decision's message.
    await vi.waitFor(() => expect(messageRows(store).find((m) => m.source === "approval:1")).toMatchObject({ agent: "wright", status: "replied" }), WAIT);
    expect(calls).toHaveLength(2);
    noFailures();

    // ---- 4. studio ask --agent mason --workspace <repo>: mason's session; the push is denied agent_boundary ----
    const decisions: { push?: Decision; comment?: Decision } = {};
    s.mason.push(async (call) => {
      await flush(1);
      decisions.push = await gateOf(call)("Bash", { command: PUSH });
      decisions.comment = await gateOf(call)("Bash", { command: COMMENT });
      await reply("I can't push: my settings forbid it. My review comment is waiting for your approval.")(call);
    });
    const pushAsk = await studio(["ask", "--agent", "mason", "--workspace", repo, "push your commit"]);
    expect(pushAsk).toEqual({ code: 0, stderr: "", stdout: "I can't push: my settings forbid it. My review comment is waiting for your approval.\n" });
    noFailures();
    expect(calls).toHaveLength(3);
    const masonCall = calls[2] as FakeCall;
    expect(masonCall.options.model).toBe(MASON_MODEL);
    expect(masonCall.options.cwd).toBe(repo);
    const masonSession = rowOfCall(2);
    expect(masonSession).toMatchObject({ agent: "mason", status: "completed", model: MASON_MODEL });
    expect(messageRows(store).at(-1)).toMatchObject({ agent: "mason", source: "ask", workspace: repo, status: "replied", session_id: masonSession?.id });
    expect(decisions.push?.permissionDecision).toBe("deny");
    expect(decisions.push?.permissionDecisionReason.startsWith("agent_boundary: git_push")).toBe(true);
    const masonDecisions = events(store, "tool_decision").filter((e) => e.session_id === masonSession?.id);
    expect(masonDecisions.filter((e) => e.payload.command === PUSH).map((e) => e.payload)).toEqual([
      { tool: "Bash", decision: "deny", reason: "agent_boundary", command: PUSH, category: "git_push", tool_use_id: "toolu_1" },
    ]);
    // No approval for the push: the only one this session holds is the comment's.
    expect(approvalRows(store).filter((a) => a.requesting_session === masonSession?.id).map((a) => a.action)).toEqual(["gh pr comment"]);
    expect(approvalRows(store).some((a) => a.action.includes("push"))).toBe(false);
    // The exit criterion's evidence: the bare remote's ref is what it was.
    expect(fixture.remoteRef()).toBe(pushedRef);
    expect(git(["rev-list", "--count", "origin/main..main"], repo)).toBe("1");

    // ---- 5. In the same session the comment was held; studio deny queues "Nothing was done" for mason ----
    expect(decisions.comment?.permissionDecision).toBe("deny");
    expect(decisions.comment?.permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
    expect(masonDecisions.filter((e) => e.payload.command === COMMENT).map((e) => e.payload)).toEqual([
      { tool: "Bash", decision: "deny", reason: "approval_required", command: COMMENT, approval_id: 2, tool_use_id: "toolu_1" },
    ]);
    expect(approvalRows(store)[1]).toEqual({ id: 2, action: "gh pr comment", status: "pending", decision: null, requesting_session: masonSession?.id });
    s.mason.push(reply("Understood: no comment."));
    const denied = await studio(["deny", "2"]);
    expect(denied).toMatchObject({ code: 0, stderr: "" });
    expect(denied.stdout).toMatch(/^studio: approval 2 denied/);
    expect(approvalRows(store)[1]).toMatchObject({ id: 2, status: "denied", decision: "deny" });
    expect(decisionMessage(store, 2)).toEqual({ agent: "mason", text: "denied approval 2: gh pr comment. Nothing was done; do not repeat the call." });
    // Mason receives it in its own session (the step-4 session had ended: sessions_at_once is 1).
    await vi.waitFor(() => expect(messageRows(store).find((m) => m.source === "approval:2")).toMatchObject({ agent: "mason", status: "replied" }), WAIT);
    expect(calls).toHaveLength(4);
    expect(rowOfCall(3)).toMatchObject({ agent: "mason", status: "completed" });
    noFailures();

    // ---- 6. Wright delegates to mason (not held); mason's reply returns at the delegation's depth; a further delegation is refused ----
    let delegated: { queue_id: number; agent: string; depth: number } | undefined;
    let delegateGate: Decision | undefined;
    s.wright.push(async (call) => {
      await flush(1);
      const input = { agent: "mason", text: "Review PR 1 in the repo and tell me what you find.", workspace: repo, idempotency_key: "delegate-1" };
      delegateGate = await gateOf(call)(MESSAGE, input);
      delegated = value(await tool(call, "kernel_agent_message", input));
      await reply("I asked Mason to review PR 1.")(call);
    });
    s.mason.push(reply("PR 1 looks fine; one naming nit."));
    let further: KernelToolResult | undefined;
    s.wright.push(async (call) => {
      await flush(1);
      further = await tool(call, "kernel_agent_message", { agent: "mason", text: "Now review PR 2 too.", idempotency_key: "delegate-2" });
      await reply("Mason says PR 1 looks fine.")(call);
    });
    const approvalsBefore = approvalRows(store).length;
    expect(await studio(["ask", "Ask Mason to review PR 1."])).toEqual({ code: 0, stderr: "", stdout: "I asked Mason to review PR 1.\n" });
    expect(delegateGate).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "tool_allowed" });
    expect(approvalRows(store)).toHaveLength(approvalsBefore);
    expect(delegated).toMatchObject({ agent: "mason", depth: 1 });
    expect(messageRows(store).find((m) => m.text === "Ask Mason to review PR 1.")).toMatchObject({ agent: "wright", source: "ask", from_agent: null, depth: 0, status: "replied" });
    // Mason's delegated row (depth 1), then Wright's reply row, from mason at the same depth.
    await vi.waitFor(() => expect(messageRows(store).filter((m) => m.reply_to !== null).map((m) => m.status)).toEqual(["replied"]), WAIT);
    noFailures();
    const delegationRow = messageRows(store).find((m) => m.queue_id === delegated?.queue_id) as MessageRow;
    expect(delegationRow).toMatchObject({ agent: "mason", source: "agent:wright", from_agent: "wright", depth: 1, reply_to: null, workspace: repo, status: "replied", reply_text: "PR 1 looks fine; one naming nit." });
    const replyRow = messageRows(store).find((m) => m.reply_to !== null) as MessageRow;
    expect(replyRow).toMatchObject({ agent: "wright", source: "agent:mason", from_agent: "mason", depth: 1, reply_to: delegationRow.id, text: "PR 1 looks fine; one naming nit." });
    expect(queuedMessages(store).find((p) => p.reply_to !== undefined)).toEqual({ agent: "wright", text: "PR 1 looks fine; one naming nit.", from_agent: "mason", depth: 1, reply_to: delegationRow.id });
    expect(rowOfCall(5)).toMatchObject({ agent: "mason", status: "completed" });
    expect(calls[5]?.options.cwd).toBe(repo);
    // The further delegation from depth 1 (Wright's limits.delegation_depth is 1): refused, nothing queued.
    expect(further?.isError).toBe(true);
    expect(further?.content[0]?.text).toMatch(/^delegation_depth: /);
    expect(events(store, "agent_message_refused").map((e) => e.payload)).toEqual([{ from: "wright", to: "mason", depth: 2, reason: "delegation_depth" }]);
    expect(events(store, "agent_message_queued").map((e) => e.payload)).toEqual([{ from: "wright", to: "mason", depth: 1, queue_id: delegated?.queue_id }]);
    expect(queuedMessages(store).filter((p) => p.from_agent === "wright")).toHaveLength(1);
    await vi.waitFor(() => expect(messageRows(store).find((m) => m.id === replyRow.id)?.status).toBe("replied"), WAIT);
    expect(calls).toHaveLength(7);
    noFailures();

    // ---- 7. While one mason session runs, a second ask is parked agent_sessions_at_once, then runs once the first ends ----
    let releaseFirst: () => void = () => {};
    const firstOpen = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    s.mason.push(async (call) => {
      await firstOpen;
      await reply("PR 2 reviewed.")(call);
    });
    const firstAsk = studio(["ask", "--agent", "mason", "Review PR 2."]);
    await vi.waitFor(() => expect(sessionRows(store, "mason").filter((r) => r.status === "running")).toHaveLength(1), WAIT);
    expect(calls).toHaveLength(8);
    s.mason.push(reply("PR 3 reviewed.", PAST_LIMIT_USAGE));
    const recheckAt = new Date(clock.now().getTime() + SESSIONS_AT_ONCE_RECHECK_MS).toISOString();
    const second = await studio(["ask", "--agent", "mason", "Review PR 3."]);
    const secondRow = messageRows(store).at(-1) as MessageRow;
    expect(secondRow).toMatchObject({ agent: "mason", text: "Review PR 3.", status: "parked", session_id: null, detail: `admission_refused: agent_sessions_at_once; retry at ${recheckAt}` });
    expect(second).toEqual({
      code: 2,
      stdout: "",
      stderr: `studio: message ${secondRow.id} is parked: admission_refused: agent_sessions_at_once; retry at ${recheckAt}; it stays queued and runs when admission allows\n`,
    });
    expect(events(store, "event_parked").map((e) => e.payload)).toEqual([expect.objectContaining({ queue_id: secondRow.queue_id, reason: "agent_sessions_at_once", retry_at: recheckAt })]);
    // No second session started.
    await twoMoreTicks(stub.state);
    expect(calls).toHaveLength(8);
    expect(sessionRows(store, "mason").filter((r) => r.status === "running" || r.status === "starting")).toHaveLength(1);
    // The first session ends; at the recheck the parked message starts its session.
    releaseFirst();
    expect(await firstAsk).toEqual({ code: 0, stderr: "", stdout: "PR 2 reviewed.\n" });
    clock.advance(SESSIONS_AT_ONCE_RECHECK_MS);
    await vi.waitFor(() => expect(messageRows(store).find((m) => m.id === secondRow.id)).toMatchObject({ status: "replied", reply_text: "PR 3 reviewed." }), WAIT);
    noFailures();
    expect(calls).toHaveLength(9);
    expect(rowOfCall(8)).toMatchObject({ agent: "mason", status: "completed" });

    // ---- 8. Past mason's tokens_per_day on this budget day, the next mason start is refused agent_daily_limit ----
    const day = localDay(clock.now());
    expect(count(store, "SELECT COALESCE(SUM(counted_tokens), 0) FROM budget WHERE agent = 'mason' AND day = ?", day)).toBe(1_200);
    const nextDay = startOfNextLocalDay(clock.now()).toISOString();
    s.mason.push(reply("PR 4 reviewed."));
    const third = await studio(["ask", "--agent", "mason", "Review PR 4."]);
    const thirdRow = messageRows(store).at(-1) as MessageRow;
    expect(thirdRow).toMatchObject({ agent: "mason", text: "Review PR 4.", status: "parked", session_id: null, detail: `admission_refused: agent_daily_limit; retry at ${nextDay}` });
    expect(third).toEqual({
      code: 2,
      stdout: "",
      stderr: `studio: message ${thirdRow.id} is parked: admission_refused: agent_daily_limit; retry at ${nextDay}; it stays queued and runs when admission allows\n`,
    });
    expect(events(store, "admission_refused").filter((e) => e.payload.reason === "agent_daily_limit").map((e) => e.payload)).toEqual([
      expect.objectContaining({ kind: "start", agent: "mason", reason: "agent_daily_limit", retry_at: nextDay }),
    ]);
    await twoMoreTicks(stub.state);
    expect(calls).toHaveLength(9);
    expect(sessionRows(store, "mason")).toHaveLength(5);
    noFailures();

    // ---- 9. The next budget day: the parked ask runs; a playbook Wright drafts for mason dry-runs and fires as mason ----
    clock.set(new Date(Date.parse(nextDay) + 1_000).toISOString());
    await vi.waitFor(() => expect(messageRows(store).find((m) => m.id === thirdRow.id)).toMatchObject({ status: "replied", reply_text: "PR 4 reviewed." }), WAIT);
    expect(calls).toHaveLength(10);
    noFailures();
    const fireAt = new Date(clock.now().getTime() + 60 * 60 * 1_000).toISOString();
    let pb: { id: number; slug: string; version: number } | undefined;
    let dry: { run_id: number; version: number; status: string } | undefined;
    let enableHeld: Decision | undefined;
    s.wright.push(async (call) => {
      await flush(1);
      const draft = value<{ id: number; slug: string; version: number }>(
        await tool(call, "kernel_playbook_create", {
          name: "Review sweep",
          intent: "Review the open pull requests in the repo and comment on each.",
          trigger: { kind: "once", spec: fireAt },
          model: PLAYBOOK_MODEL,
          agent: "mason",
          idempotency_key: "pb-1",
        }),
      );
      pb = draft;
      dry = value(await tool(call, "kernel_playbook_dry_run", { id: draft.id, idempotency_key: "dry-1" }));
      enableHeld = await gateOf(call)(ENABLE, { id: draft.id, idempotency_key: "enable-1" });
      await reply("Mason's playbook is drafted and dry-run; enabling it is waiting for your approval.")(call);
    });
    s.playbook.push(reply("DRY RUN DONE"));
    expect(await studio(["ask", "Give Mason a playbook that reviews the open pull requests in an hour."])).toEqual({
      code: 0,
      stderr: "",
      stdout: "Mason's playbook is drafted and dry-run; enabling it is waiting for your approval.\n",
    });
    noFailures();
    if (pb === undefined) throw new Error("Wright created no playbook");
    const playbookId = pb.id;
    expect(getPlaybook(store, playbookId)).toMatchObject({ owning_agent: "mason", status: "draft", version: 1 });
    expect(dry).toMatchObject({ version: 1, status: "done" });
    expect(calls).toHaveLength(12);
    const dryCall = calls[11] as FakeCall;
    expect(dryCall.options.model).toBe(PLAYBOOK_MODEL);
    expect(dryCall.options.cwd).toBe(agentMemoryDir(dataDir, "mason"));
    const dryRow = rowOfCall(11);
    expect(dryRow).toMatchObject({ agent: "mason", model: PLAYBOOK_MODEL, playbook: playbookId });
    expect(events(store, "session_dry_run").map((e) => e.session_id)).toEqual([dryRow?.id]);
    const enableId = approvalRows(store).length;
    expect(enableHeld?.permissionDecisionReason).toMatch(new RegExp(`^approval_required: held as approval ${enableId};`));
    expect(approvalRows(store).at(-1)).toMatchObject({ id: enableId, action: "kernel_playbook_enable", status: "pending" });
    const enabled = `The kernel enabled playbook ${pb.slug} (#${playbookId}) at version 1 on approval ${enableId}.`;
    s.wright.push(reply("Noted: Mason's playbook is enabled."));
    const approvedEnable = await studio(["approve", String(enableId), "once"]);
    expect(approvedEnable).toMatchObject({ code: 0, stderr: "" });
    expect(approvedEnable.stdout).toContain(`\nstudio: the kernel applied it: ${enabled}\n`);
    expect(getPlaybook(store, playbookId)).toMatchObject({ status: "enabled", version: 1 });
    await vi.waitFor(() => expect(calls).toHaveLength(13), WAIT);
    await twoMoreTicks(stub.state);
    expect(runRows(store).filter((r) => r.kind === "fire")).toEqual([]);
    // The trigger's instant: the fire runs as mason.
    s.playbook.push(reply("FIRE DONE"));
    clock.set(new Date(Date.parse(fireAt) + 1_000).toISOString());
    await vi.waitFor(() => expect(runRows(store).filter((r) => r.kind === "fire").map((r) => r.status)).toEqual(["done"]), WAIT);
    noFailures();
    expect(calls).toHaveLength(14);
    const fireCall = calls[13] as FakeCall;
    expect(fireCall.options.model).toBe(PLAYBOOK_MODEL);
    expect(fireCall.options.cwd).toBe(agentMemoryDir(dataDir, "mason"));
    const fireRun = runRows(store).find((r) => r.kind === "fire");
    expect(rowOfCall(13)).toMatchObject({ id: fireRun?.session_id, agent: "mason", status: "completed", model: PLAYBOOK_MODEL, playbook: playbookId });
    expect(events(store, "session_dry_run")).toHaveLength(1);

    // ---- 10. studio agents off mason; the next ask is refused, nothing queued ----
    expect(await studio(["agents", "off", "mason"])).toEqual({ code: 0, stderr: "", stdout: "studio: agent mason turned off\n" });
    expect(getAgent(store, "mason")?.status).toBe("off");
    const queuedBefore = count(store, "SELECT count(*) FROM event_queue");
    const messagesBefore = messageRows(store).length;
    expect(await studio(["ask", "--agent", "mason", "Review PR 5."])).toEqual({ code: 2, stdout: "", stderr: "studio: mason is off: it takes no messages; nothing was queued\n" });
    expect(count(store, "SELECT count(*) FROM event_queue")).toBe(queuedBefore);
    expect(messageRows(store)).toHaveLength(messagesBefore);
    await twoMoreTicks(stub.state);
    expect(calls).toHaveLength(14);
    expect(lastCall()).toBe(fireCall);

    // Every stand-in session had its driver, and every driver ran.
    noFailures();
    expect([s.wright.length, s.mason.length, s.playbook.length]).toEqual([0, 0, 0]);
    expect(fixture.remoteRef()).toBe(pushedRef);
  }, 60_000);
});
