// Phase 8 item 20b, subtask 1: the kernel starts a crew member's `/automate` run (D44,
// which supersedes D43's "the playbook's own run session runs `/automate`").
//
//   - AC3: `kernel_automate_prepare` queues one event; `handleAutomateRun` starts ONE run
//     session through the session manager, with the prompt `/loomwright:automate --backlog
//     <path> --inline-phases`, cwd the checkout, agent / playbook / version / task the calling
//     session's and its model (never the crew member's settings model). Idempotent on
//     redelivery; it starts nothing, and says why, while Loomwright's run state is live or
//     unreadable. Parked on an admission refusal.
//   - AC4: the run policy is the frozen kernel constant, with the crew member's `never` list; the
//     crew session's own policy holds no `Skill` and no shell grant; the run session's rows are the
//     crew member's and the playbook's.
//   - AC5: the "Hand tickets to /automate" and "Triage PR comments" jobs grant only `mcp__kernel__` tools.
//   - AC12: `AskUserQuestion` is allowed by the run policy and held by the gate as a pending
//     approval whose payload carries the question's header, text and option labels. The SDK path
//     that returns the owner's chosen answer to the session is NOT exercised here (unverified).
//   - AC13: in the run session a push is held (`approval_required`) or denied `agent_boundary`
//     under the crew member's `never`, and a `gh pr merge` is denied `merge_blocked`.
//   - AC14: Stop and Kill of the run session end it through the session manager, and its tokens
//     count against the crew member and the playbook.
//
// The unit half drives `handleAutomateRun` through the real `EventLoop` with a recording
// `EventSessions`; the kernel half is `startKernel` over the fake spawner/query. Never the real SDK, a
// model, a network or a real Loomwright.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, SDKMessage, SDKUserMessage, HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentMemoryDir, agentSettingsPath } from "../src/agents/index.js";
import { createAgent } from "../src/agents/charter-files.js";
import { readAgentSettings } from "../src/agents/settings.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { AUTOMATE_RUN_COMMAND, AUTOMATE_RUN_KEY, AUTOMATE_RUN_POLICY, automateRunPrompt, handleAutomateRun } from "../src/automate/launch.js";
import type { AutomateRunPayload } from "../src/automate/launch.js";
import { decideApproval } from "../src/approvals/store.js";
import { brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import { KERNEL_TOOL_PREFIX, TOOL_JOB_DEFINITIONS, allowedToolsForJobs, buildToolCatalogue } from "../src/features/catalogue.js";
import { resolveJobNeeds } from "../src/features/job-needs.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { FeatureContribution } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import { EventLoop, enqueueEvent, getQueueRow, getWorkStep } from "../src/loop/index.js";
import type { EventSessions } from "../src/loop/types.js";
import { createPlaybook } from "../src/playbooks/store.js";
import { AdmissionRefusedError, decideToolUse } from "../src/sessions/index.js";
import { ALWAYS_HELD_TOOLS, classifyToolCall } from "../src/sessions/policy.js";
import type { QueryFn, SessionHandle, SessionRow, StartSessionParams } from "../src/sessions/index.js";
import type { SessionTokenMint } from "../src/sessions/github-session-auth.js";
import { Store } from "../src/store/index.js";
import type { KernelToolResult } from "../src/tools/server.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";
import { MAX_RUN_FILE_BYTES } from "../src/automate/run-state.js";
import { installRunFiles, makeCheckout, writeRunLock } from "./fixtures/loomwright-run-files/harness.js";
import { events } from "./loop-helpers.js";
import { notifierGuardInstalled } from "./notifier-guard.js";
import { stubNotifierContributions } from "./notifier-stub.js";
import { fakeMsg, fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const REPO = "o/r";
/** The calling session's model: the playbook version's. */
const PLAYBOOK_MODEL = "claude-opus-4-1";
/** The crew member's own settings model: the run must never use it. */
const CREW_MODEL = "claude-sonnet-4-5";
const START = "2026-11-13T10:00:00.000Z";
const WAIT = { timeout: 15_000, interval: 10 };
const K = KERNEL_TOOL_PREFIX;

let tmp: string;
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-automate-launch-"));
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- The run policy (AC4, AC5) ----------------------------------------------------------------------

describe("AUTOMATE_RUN_POLICY (AC4)", () => {
  it("is a frozen kernel constant that grants what /automate asks for, holds no never list and no bypass, and lists no shell that runs other programs", () => {
    expect(Object.isFrozen(AUTOMATE_RUN_POLICY)).toBe(true);
    expect(Object.isFrozen(AUTOMATE_RUN_POLICY.allowedTools)).toBe(true);
    expect(Object.isFrozen(AUTOMATE_RUN_POLICY.allowedBashPrefixes)).toBe(true);
    expect([...AUTOMATE_RUN_POLICY.allowedTools].sort()).toEqual(["Agent", "AskUserQuestion", "Bash", "Edit", "Glob", "Grep", "Read", "Skill", "Write"]);
    expect(AUTOMATE_RUN_POLICY.allowedBashPrefixes).toEqual(expect.arrayContaining(["git status", "git commit", "gh pr"]));
    // Never the bare programs: they carry config / alias / hook / release / secret / workflow routes past the rail.
    for (const bare of ["git", "gh"]) expect(AUTOMATE_RUN_POLICY.allowedBashPrefixes, bare).not.toContain(bare);
    // `bash` / `sh` as a prefix would let `bash -c '…'` run anything past the rail.
    for (const shell of ["bash", "sh", "zsh", "env", "xargs", "find", "npx", "npm", "node"]) expect(AUTOMATE_RUN_POLICY.allowedBashPrefixes, shell).not.toContain(shell);
    // The crew member's `never` list is added at the start; the constant carries none, and no mode the manager sets itself.
    expect(AUTOMATE_RUN_POLICY).not.toHaveProperty("never");
    expect(AUTOMATE_RUN_POLICY).not.toHaveProperty("mode");
    expect(AUTOMATE_RUN_POLICY).not.toHaveProperty("githubWrite");
    expect(Object.keys(AUTOMATE_RUN_POLICY).sort()).toEqual(["allowedBashPrefixes", "allowedTools"]);
  });

  it("allows Skill and the git / gh prefixes; the rail still holds a push and denies a merge, and a Bash metacharacter is still denied", () => {
    const rail = { dataDir: "/data", homeDir: "/home/o", cwd: "/work" };
    expect(decideToolUse(AUTOMATE_RUN_POLICY, "Skill", { skill: "loomwright:automate" })).toMatchObject({ decision: "allow" });
    expect(decideToolUse(AUTOMATE_RUN_POLICY, "Bash", { command: "git status" })).toMatchObject({ decision: "allow" });
    expect(decideToolUse(AUTOMATE_RUN_POLICY, "Bash", { command: "git status | cat" })).toEqual({ decision: "deny", reason: "bash_shell_metacharacter" });
    expect(decideToolUse(AUTOMATE_RUN_POLICY, "Bash", { command: "rm -rf x" })).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    expect(classifyToolCall("Bash", { command: "git push origin main" }, rail)).toMatchObject({ kind: "outward", action: "git push" });
    expect(classifyToolCall("Bash", { command: "gh pr merge 7 --squash" }, rail)).toEqual({ kind: "deny", reason: "merge_blocked" });
    expect(decideToolUse(AUTOMATE_RUN_POLICY, "AskUserQuestion", {})).toMatchObject({ decision: "allow" });
    expect(ALWAYS_HELD_TOOLS).toContain("AskUserQuestion");
  });

  it("does not allow git config, git -c, gh release / secret / workflow / repo delete, or git commit-tree (a prefix is matched on a word boundary)", () => {
    for (const command of [
      "git config core.fsmonitor touch",
      "git config --global core.hooksPath /x",
      "git -c core.fsmonitor=x status",
      "git commit-tree HEAD",
      "gh release create v1",
      "gh secret set X",
      "gh workflow run x",
      "gh repo delete x",
      "gh repo edit x",
      "gh label delete x",
    ]) {
      expect(decideToolUse(AUTOMATE_RUN_POLICY, "Bash", { command }), command).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    }
    for (const command of ["git commit -m x", "git diff HEAD", "gh pr view 7", "gh repo view o/r"]) {
      expect(decideToolUse(AUTOMATE_RUN_POLICY, "Bash", { command }), command).toMatchObject({ decision: "allow" });
    }
  });

  it("the prompt is Loomwright's automate over the backlog with inline phases and nothing else (safe mode, no --auto-merge, no --parallel)", () => {
    expect(AUTOMATE_RUN_COMMAND).toBe("/loomwright:automate");
    expect(automateRunPrompt("/w/o-r/.supervisor/requirements/studio/_BACKLOG.md")).toBe("/loomwright:automate --backlog /w/o-r/.supervisor/requirements/studio/_BACKLOG.md --inline-phases");
    expect(automateRunPrompt("/w/my repo/_BACKLOG.md")).toBe('/loomwright:automate --backlog "/w/my repo/_BACKLOG.md" --inline-phases');
    expect(() => automateRunPrompt('/w/a"b/_BACKLOG.md')).toThrow(/unsafe_path/);
    for (const flag of ["--auto-merge", "--parallel"]) expect(automateRunPrompt("/w/_BACKLOG.md")).not.toContain(flag);
  });
});

describe("the catalogue grants the ticket and triage jobs only kernel tools (AC5)", () => {
  const catalogue = buildToolCatalogue(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools);

  it("'Hand tickets to /automate' and 'Triage PR comments' list only mcp__kernel__ tools: no Skill, no shell prefix, no bare tool", () => {
    expect(TOOL_JOB_DEFINITIONS.automate_tickets.label).toBe("Hand tickets to /automate");
    expect(TOOL_JOB_DEFINITIONS.triage_pr_comments.label).toBe("Triage PR comments");
    // D44: the ticket job's own needs hold no Skill and no shell prefix (the kernel starts /automate under AUTOMATE_RUN_POLICY, never a crew need).
    const needs = resolveJobNeeds("automate_tickets", catalogue);
    expect(needs.claudeTools.map((n) => n.name)).not.toContain("Skill");
    expect(needs.claudeTools).toEqual([]);
    expect(needs.bashPrefixes).toEqual([]);
    expect(needs.commands.map((c) => [c.invocation, c.launch])).toEqual([["/loomwright:automate", "kernel"]]);
    // A job's declaration never adds a Claude tool or Bash prefix to a drafted charter: only kernel tools.
    for (const id of ["automate_tickets", "triage_pr_comments"] as const) {
      expect(allowedToolsForJobs(catalogue, [id]).every((t) => t.startsWith(K)), id).toBe(true);
    }
    for (const id of ["automate_tickets", "triage_pr_comments"] as const) {
      const granted = (catalogue.jobs.find((j) => j.id === id)?.tools ?? []).map((t) => `${K}${t.name}`);
      expect(granted.length, id).toBeGreaterThan(0);
      for (const tool of granted) expect(tool.startsWith(K), tool).toBe(true);
      expect(granted).not.toContain("Skill");
    }
    expect((catalogue.jobs.find((j) => j.id === "automate_tickets")?.tools ?? []).map((t) => t.name)).toEqual(expect.arrayContaining(["kernel_automate_prepare", "kernel_automate_state"]));
  });
});

// ---- The handler, through the real event loop (AC3) -------------------------------------------------

/** What the recording `EventSessions` answers for the calling session (a `sessions` row). */
const CALLER = { id: 41, agent: "mason", playbook: 5, playbook_version: 2, task_id: 7, model: PLAYBOOK_MODEL, status: "running" } as const;

interface Unit {
  readonly store: Store;
  readonly dataDir: string;
  readonly checkout: string;
  readonly backlog: string;
  readonly starts: StartSessionParams[];
  readonly callers: Map<number, Partial<SessionRow>>;
  /** What the next `startSession` does (default: answers a handle). */
  startBehaviour: { throws?: Error };
  readonly loop: EventLoop;
  /** The run payload for the calling session `source`. */
  run(over?: Partial<AutomateRunPayload>): AutomateRunPayload;
  /** Queue the run event for `run` and return its queue id. */
  queue(run?: AutomateRunPayload, agent?: string): number;
  stepOf(id: number): unknown;
}

function writeCrewSettings(dataDir: string, id: string, o: { workspaces: readonly string[]; never?: readonly string[]; model?: string }): void {
  const file = agentSettingsPath(dataDir, id);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      model: o.model ?? CREW_MODEL,
      permission_mode: "default",
      tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] },
      ...(o.never === undefined ? {} : { never: o.never }),
      connectors: { github: "write" },
      workspaces: o.workspaces,
    }),
  );
}

function unit(o: { withSessions?: boolean; never?: readonly string[]; mode?: "live" | "draft"; agentStatus?: "active" | "off" } = {}): Unit {
  const dataDir = join(tmp, "data");
  const store = new Store({ dataDir });
  const checkout = makeCheckout(tmp, "o-r");
  writeCrewSettings(dataDir, "mason", { workspaces: [checkout], ...(o.never === undefined ? {} : { never: o.never }) });
  store.prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, status, created_by, charter_json) VALUES ('mason', 'Mason', 'crab', 'crew-teal', ?, 'owner', '{}')").run(o.agentStatus ?? "active");
  store
    .prepare("INSERT INTO playbooks (id, slug, name, owning_agent, intent, version, mode, merge_requirement) VALUES (5, 'pb5', 'pb5', 'mason', 'Hand tickets over', 2, ?, 'none')")
    .run(o.mode ?? "live");
  const starts: StartSessionParams[] = [];
  // Every row set here is mirrored into the `sessions` table: the handler scopes its candidates there, then reads the row back.
  class MirroredRows extends Map<number, Partial<SessionRow>> {
    override set(id: number, row: Partial<SessionRow>): this {
      store
        .prepare("INSERT INTO sessions (id, agent, status, cwd) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET agent = excluded.agent, status = excluded.status, cwd = excluded.cwd")
        .run(id, row.agent ?? null, row.status ?? "running", row.cwd ?? null);
      return super.set(id, row);
    }
  }
  const callers = new MirroredRows();
  callers.set(CALLER.id, { ...CALLER });
  const self: { startBehaviour: { throws?: Error } } = { startBehaviour: {} };
  const sessions: EventSessions = {
    async startSession(params) {
      if (self.startBehaviour.throws !== undefined) throw self.startBehaviour.throws;
      starts.push(params);
      return { id: 100 + starts.length } as unknown as SessionHandle;
    },
    resumeSession: () => Promise.reject(new Error("unexpected resume")),
    getSession: (id) => callers.get(id) as SessionRow | undefined,
  };
  const loop = new EventLoop({ store, handlers: { message: handleAutomateRun }, ...(o.withSessions === false ? {} : { sessions }) });
  const backlog = join(checkout, ".supervisor", "requirements", "studio", "_BACKLOG.md");
  const unitEnv: Unit = {
    store,
    dataDir,
    checkout,
    backlog,
    starts,
    callers,
    get startBehaviour() {
      return self.startBehaviour;
    },
    set startBehaviour(v) {
      self.startBehaviour = v;
    },
    loop,
    run: (over = {}) => ({ repo: REPO, backlog, checkout, playbook: 5, playbook_version: 2, task: 7, source_session: CALLER.id, ...over }),
    queue: (run = unitEnv.run(), agent = "mason") => enqueueEvent(store, { kind: "message", payload: { agent, [AUTOMATE_RUN_KEY]: run } }).id,
    stepOf: (id) => getWorkStep(store, `event:${id}:automate-run`)?.result,
  };
  return unitEnv;
}

describe("handleAutomateRun starts one run session (AC3)", () => {
  it("starts it through the session manager as the crew member, for the calling session's playbook, version, task and model, in the checkout, under the run policy plus the crew member's never list", async () => {
    const u = unit({ never: ["git_push", "gh_pr_close"] });
    try {
      const id = u.queue();
      expect(await u.loop.tick()).toMatchObject({ done: 1, failed: 0, parked: 0 });
      expect(u.starts).toEqual([
        {
          agent: "mason",
          prompt: `/loomwright:automate --backlog ${u.backlog} --inline-phases`,
          // The calling session's model (the playbook version's), never the crew member's settings model.
          model: PLAYBOOK_MODEL,
          permissionMode: "default",
          cwd: u.checkout,
          policy: { allowedTools: [...AUTOMATE_RUN_POLICY.allowedTools], allowedBashPrefixes: [...AUTOMATE_RUN_POLICY.allowedBashPrefixes], never: ["git_push", "gh_pr_close"] },
          playbook: 5,
          playbookVersion: 2,
          task: 7,
        },
      ]);
      expect(u.starts[0]?.model).not.toBe(CREW_MODEL);
      expect(u.stepOf(id)).toEqual({ session_id: 101 });
      expect(getQueueRow(u.store, id)?.status).toBe("done");
    } finally {
      u.store.close();
    }
  });

  it("passes no never list when the crew member has none, and no task or version when the calling session has none", async () => {
    const u = unit();
    try {
      u.callers.set(CALLER.id, { ...CALLER, task_id: null, playbook_version: null });
      u.queue();
      await u.loop.tick();
      expect(u.starts).toHaveLength(1);
      const params = u.starts[0] as StartSessionParams;
      expect(params.policy).not.toHaveProperty("never");
      expect(params).not.toHaveProperty("task");
      expect(params).not.toHaveProperty("playbookVersion");
      expect(params.playbook).toBe(5);
    } finally {
      u.store.close();
    }
  });

  it("is idempotent on redelivery: the event delivered again starts no second session and keeps the stored result", async () => {
    const u = unit();
    try {
      const id = u.queue();
      await u.loop.tick();
      expect(u.starts).toHaveLength(1);
      // The crash-after-handler case: the event is pending again, the step is done.
      u.store.prepare("UPDATE event_queue SET status = 'pending', done_at = NULL WHERE id = ?").run(id);
      expect(await u.loop.tick()).toMatchObject({ done: 1, failed: 0 });
      expect(u.starts).toHaveLength(1);
      expect(u.stepOf(id)).toEqual({ session_id: 101 });
      // Settings changed since do not matter to a redelivery: nothing is decided again.
      writeCrewSettings(u.dataDir, "mason", { workspaces: [] });
      u.store.prepare("UPDATE event_queue SET status = 'pending', done_at = NULL WHERE id = ?").run(id);
      await u.loop.tick();
      expect(u.starts).toHaveLength(1);
    } finally {
      u.store.close();
    }
  });

  it("two events are two runs, each once", async () => {
    const u = unit();
    try {
      u.queue();
      u.queue();
      await u.loop.tick();
      expect(u.starts).toHaveLength(2);
    } finally {
      u.store.close();
    }
  });

  it("single drain holds when the workspace is a symlink and the session row carries the realpath cwd; a deleted checkout does not throw", async () => {
    const u = unit();
    try {
      const link = join(tmp, "link-ws");
      symlinkSync(u.checkout, link);
      writeCrewSettings(u.dataDir, "mason", { workspaces: [link] });
      const run = u.run({ checkout: link, backlog: join(link, ".supervisor", "requirements", "studio", "_BACKLOG.md") });
      const first = u.queue(run);
      await u.loop.tick();
      expect(u.stepOf(first)).toEqual({ session_id: 101 });
      u.callers.set(101, { id: 101, agent: "mason", status: "running", cwd: realpathSync(u.checkout) });
      const second = u.queue(run);
      await u.loop.tick();
      expect(u.starts).toHaveLength(1);
      expect(u.stepOf(second)).toEqual({ session_id: null, skipped: "run_session_live: session 101" });
      // The checkout is deleted: a stored reason, not a crash, and the ended session no longer blocks.
      u.callers.set(101, { id: 101, agent: "mason", status: "completed", cwd: realpathSync(u.checkout) });
      rmSync(u.checkout, { recursive: true });
      const third = u.queue(run);
      await u.loop.tick();
      expect(u.stepOf(third)).toMatchObject({ session_id: expect.anything() });
    } finally {
      u.store.close();
    }
  });

  it("starts no second run while the first run session is still live (Loomwright has not written its lock yet), and starts one once it ended", async () => {
    const u = unit();
    try {
      const first = u.queue();
      await u.loop.tick();
      expect(u.stepOf(first)).toEqual({ session_id: 101 });
      u.callers.set(101, { id: 101, agent: "mason", status: "running", cwd: u.checkout });
      const second = u.queue();
      await u.loop.tick();
      expect(u.starts).toHaveLength(1);
      expect(u.stepOf(second)).toEqual({ session_id: null, skipped: "run_session_live: session 101" });
      // The first run ended: a later event starts a new run.
      u.callers.set(101, { id: 101, agent: "mason", status: "completed", cwd: u.checkout });
      const third = u.queue();
      await u.loop.tick();
      expect(u.starts).toHaveLength(2);
      expect(u.stepOf(third)).toEqual({ session_id: 102 });
    } finally {
      u.store.close();
    }
  });

  it("finds the live run session however many newer automate-run steps other agents or checkouts have", async () => {
    const u = unit();
    try {
      const first = u.queue();
      await u.loop.tick();
      expect(u.stepOf(first)).toEqual({ session_id: 101 });
      u.callers.set(101, { id: 101, agent: "mason", status: "running", cwd: u.checkout });
      // 60 newer steps for other sessions (other agent, other checkout, ended): none may push 101 out of view.
      for (let i = 0; i < 60; i++) {
        const sid = 1000 + i;
        u.callers.set(sid, { id: sid, agent: i % 2 === 0 ? "ranger" : "mason", status: i % 3 === 0 ? "completed" : "running", cwd: i % 2 === 0 ? u.checkout : join(tmp, "elsewhere") });
        u.store.prepare("INSERT INTO work_steps (key, status, result_json) VALUES (?, 'done', ?)").run(`event:${9000 + i}:automate-run`, JSON.stringify({ session_id: sid }));
      }
      u.store.prepare("INSERT INTO work_steps (key, status, result_json) VALUES ('event:9999:automate-run', 'done', 'not json')").run();
      const second = u.queue();
      await u.loop.tick();
      expect(u.starts).toHaveLength(1);
      expect(u.stepOf(second)).toEqual({ session_id: null, skipped: "run_session_live: session 101" });
    } finally {
      u.store.close();
    }
  });

  it("starts nothing while Loomwright's run state is live (a running run file, or a held run lock) and stores why", async () => {
    const u = unit();
    try {
      installRunFiles(u.checkout, "live");
      const id = u.queue();
      expect(await u.loop.tick()).toMatchObject({ done: 1, failed: 0 });
      expect(u.starts).toEqual([]);
      expect(u.stepOf(id)).toMatchObject({ session_id: null, skipped: expect.stringMatching(/^run_live: 2026-11-09-100000-stories/) });

      // Only the lock: a live holder (this process) reads live too.
      rmSync(join(u.checkout, ".supervisor", "automate"), { recursive: true });
      writeRunLock(u.checkout, process.pid);
      const second = u.queue();
      await u.loop.tick();
      expect(u.starts).toEqual([]);
      expect(u.stepOf(second)).toMatchObject({ session_id: null, skipped: expect.stringMatching(/^run_live: /) });
    } finally {
      u.store.close();
    }
  });

  it("starts nothing when the run state cannot be read (it reads as live), and stores why", async () => {
    const u = unit();
    try {
      mkdirSync(join(u.checkout, ".supervisor", "automate"), { recursive: true });
      writeFileSync(join(u.checkout, ".supervisor", "automate", "huge.md"), `# Automate Run: huge\n## Status: paused\n${"x".repeat(MAX_RUN_FILE_BYTES + 1)}`);
      const id = u.queue();
      await u.loop.tick();
      expect(u.starts).toEqual([]);
      expect(u.stepOf(id)).toEqual({ session_id: null, skipped: "run_state_unreadable: run_file_too_large" });
    } finally {
      u.store.close();
    }
  });

  it("starts a run over a parked item: parked is not live (single drain is about a live run)", async () => {
    const u = unit();
    try {
      installRunFiles(u.checkout, "parked");
      u.queue();
      await u.loop.tick();
      expect(u.starts).toHaveLength(1);
    } finally {
      u.store.close();
    }
  });

  it("starts nothing, and stores model_unset, when the calling session has no model (it never falls back to the crew member's settings model)", async () => {
    const u = unit();
    try {
      u.callers.set(CALLER.id, { ...CALLER, model: null });
      const id = u.queue();
      await u.loop.tick();
      expect(u.starts).toEqual([]);
      expect(u.stepOf(id)).toMatchObject({ session_id: null, skipped: expect.stringMatching(/^model_unset: /) });
    } finally {
      u.store.close();
    }
  });

  it("starts nothing for a playbook no longer live, a crew member turned off, a gone or foreign calling session, a checkout that is not a workspace, a backlog outside it, or no session manager", async () => {
    const cases: { name: string; make: () => Unit; mutate?: (u: Unit) => void; run?: (u: Unit) => AutomateRunPayload; reason: RegExp }[] = [
      { name: "draft playbook", make: () => unit({ mode: "draft" }), reason: /^playbook_not_live: playbook 5 is in draft mode/ },
      { name: "gone playbook", make: () => unit(), run: (u) => u.run({ playbook: 99 }), reason: /^playbook_gone$/ },
      { name: "crew member off", make: () => unit({ agentStatus: "off" }), reason: /^agent_not_active: mason$/ },
      { name: "calling session gone", make: () => unit(), mutate: (u) => void u.callers.clear(), reason: /^source_session_gone$/ },
      { name: "calling session of another agent", make: () => unit(), mutate: (u) => void u.callers.set(CALLER.id, { ...CALLER, agent: "ranger" }), reason: /^source_session_mismatch$/ },
      { name: "calling session of another playbook", make: () => unit(), mutate: (u) => void u.callers.set(CALLER.id, { ...CALLER, playbook: 6 }), reason: /^source_session_mismatch$/ },
      { name: "checkout not a workspace", make: () => unit(), mutate: (u) => writeCrewSettings(u.dataDir, "mason", { workspaces: [join(tmp, "elsewhere")] }), reason: /^workspace_not_listed: / },
      { name: "backlog outside the checkout", make: () => unit(), run: (u) => u.run({ backlog: join(tmp, "other", "_BACKLOG.md") }), reason: /^backlog_outside_checkout$/ },
      { name: "unquotable backlog path", make: () => unit(), run: (u) => u.run({ backlog: join(u.checkout, 'a"b', "_BACKLOG.md") }), reason: /^unsafe_path: / },
      { name: "settings missing", make: () => unit(), mutate: (u) => rmSync(agentSettingsPath(u.dataDir, "mason")), reason: /^settings_missing: / },
      { name: "no session manager", make: () => unit({ withSessions: false }), reason: /^no_session_manager$/ },
    ];
    for (const c of cases) {
      rmSync(join(tmp, "data"), { recursive: true, force: true });
      rmSync(join(tmp, "o-r"), { recursive: true, force: true });
      const u = c.make();
      try {
        c.mutate?.(u);
        const id = u.queue(c.run?.(u));
        expect(await u.loop.tick(), c.name).toMatchObject({ done: 1, failed: 0 });
        expect(u.starts, c.name).toEqual([]);
        expect(u.stepOf(id), c.name).toMatchObject({ session_id: null, skipped: expect.stringMatching(c.reason) });
      } finally {
        u.store.close();
      }
    }
  });

  it("parks the event on an admission refusal and starts the run once the refusal lifts (the step is released, not failed)", async () => {
    const u = unit();
    try {
      u.startBehaviour = { throws: new AdmissionRefusedError("playbook_daily_limit", "2026-11-14T00:00:00.000Z", "the playbook is at its daily limit") };
      const id = u.queue();
      expect(await u.loop.tick()).toMatchObject({ parked: 1, failed: 0, done: 0 });
      expect(u.starts).toEqual([]);
      expect(getQueueRow(u.store, id)).toMatchObject({ status: "pending" });
      u.startBehaviour = {};
      u.store.prepare("UPDATE event_queue SET not_before = NULL WHERE id = ?").run(id);
      expect(await u.loop.tick()).toMatchObject({ done: 1, failed: 0 });
      expect(u.starts).toHaveLength(1);
      expect(u.stepOf(id)).toEqual({ session_id: 101 });
    } finally {
      u.store.close();
    }
  });

  it("fails an event whose run payload is malformed (a TypeError naming the field); a plain message with no automate_run key never reaches the handler's run", async () => {
    const u = unit();
    try {
      enqueueEvent(u.store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: { ...u.run(), source_session: "41" } } });
      enqueueEvent(u.store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: { ...u.run(), backlog: "relative/_BACKLOG.md" } } });
      enqueueEvent(u.store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: "nope" } });
      expect(await u.loop.tick()).toMatchObject({ failed: 3, done: 0 });
      expect(u.starts).toEqual([]);
      expect(events(u.store, "event_failed").map((e) => String(e.payload.error ?? e.payload.message ?? JSON.stringify(e.payload)))).toEqual([
        expect.stringContaining("source_session"),
        expect.stringContaining("backlog"),
        expect.stringContaining("automate_run"),
      ]);
    } finally {
      u.store.close();
    }
  });
});

describe("the module starts one session and nothing else (invariants 2 and 4)", () => {
  it("launch.ts has exactly one start call, imports no manager, SDK or kernel, and names no merge", () => {
    const text = readFileSync(new URL("../src/automate/launch.ts", import.meta.url), "utf8");
    expect(text.match(/\.startSession\(/g)).toHaveLength(1);
    expect(text).not.toMatch(/sessions\/manager|claude-agent-sdk|\/kernel\.js|child_process/);
    // The only command it builds is the safe-mode backlog run: no merge-parked drain, no flag that merges or fans out.
    expect(text).not.toContain("--merge-parked");
    expect(text).not.toMatch(/inline-phases[^\n]*(--auto-merge|--parallel)/);
  });
});

// ---- The kernel: prepare → event → run session, with the real gate (AC3, AC4, AC12, AC13, AC14) -------

/** A `result` carrying token usage for `model`, without ending the stream. */
const usage = (model: string, input: number, output: number): SDKMessage =>
  ({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    modelUsage: { [model]: { inputTokens: input, outputTokens: output, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0, costUSD: 0, contextWindow: 200_000, maxOutputTokens: 64_000 } },
  }) as unknown as SDKMessage;

interface RegisteredTool {
  handler(args: unknown, extra: unknown): Promise<KernelToolResult>;
}

function toolsOf(call: FakeCall): Record<string, RegisteredTool> {
  const server = (call.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  return (server?.instance as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

function gateOf(call: FakeCall): (toolName: string, toolInput: unknown) => Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return async (toolName, toolInput) => {
    const input = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: call.options.cwd } as unknown as HookInput;
    return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
  };
}

function charter(id: string, workspace: string, never: readonly string[]): Record<string, unknown> {
  return {
    id,
    display_name: id[0]?.toUpperCase() + id.slice(1),
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful engineer who turns tickets into pull requests.",
    duties: ["Hand each ticket to /automate."],
    boundaries: ["Never merge a pull request except through Loomwright's gate."],
    model: CREW_MODEL,
    permission_mode: "default",
    // The crew session's own policy: kernel tools and Read only. No Skill, no shell grant (D44).
    tool_policy: { allowedTools: ["Read", `${K}kernel_automate_prepare`, `${K}kernel_automate_state`], allowedBashPrefixes: [], never: [...never] },
    limits: { tokens_per_day: 200_000 },
    workspaces: [workspace],
    connectors: ["github"],
  };
}

interface Rig {
  readonly kernel: Kernel;
  readonly store: Store;
  readonly fakes: ReturnType<typeof fakeSessions>;
  readonly prompts: WeakMap<Options, string[]>;
  readonly workspaces: Record<string, string>;
  readonly playbooks: Record<string, number>;
  readonly minted: (readonly string[])[];
}

interface Launched {
  readonly callerId: number;
  readonly caller: FakeCall;
  readonly runId: number;
  readonly run: FakeCall;
  readonly task: number;
}

describe.skipIf(!notifierGuardInstalled())("the kernel starts the run (AC3, AC4, AC12, AC13, AC14)", () => {
  async function rig(): Promise<Rig> {
    const dataDir = join(tmp, "data");
    const home = join(tmp, "home");
    mkdirSync(home, { recursive: true });
    const wright = wrightSettingsPath(dataDir);
    mkdirSync(join(wright, ".."), { recursive: true });
    writeFileSync(wright, `${JSON.stringify({ ...(JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>), model: "claude-haiku-4-5-wright" }, null, 2)}\n`);

    const brain: FeatureContribution = Object.freeze({ ...brainContribution, handlers: Object.freeze({ message: brainMessageHandler({ now: () => new Date(START), timeZone: () => "UTC" }) }) });
    const contributions = stubNotifierContributions(Object.freeze(SHIPPED_CONTRIBUTIONS.map((c) => (c === brainContribution ? brain : c))));

    const prompts = new WeakMap<Options, string[]>();
    const fakes = fakeSessions({
      script: (call) => {
        // A session that stays open until a test ends or stops it.
        call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
      },
    });
    const query: QueryFn = (args) => {
      async function* tee(): AsyncGenerator<SDKUserMessage> {
        for await (const m of args.prompt) {
          const content = (m as { message: { content: unknown } }).message.content;
          const list = prompts.get(args.options) ?? [];
          list.push(typeof content === "string" ? content : JSON.stringify(content));
          prompts.set(args.options, list);
          yield m;
        }
      }
      return fakes.deps.query!({ ...args, prompt: tee() });
    };
    // An in-memory Keychain with the real one's rules (add never overwrites): the API token's home.
    const items = new Map<string, string>();
    const keychain: { reader: KeychainReader; writer: KeychainWriter } = {
      reader: { read: (service) => items.get(service) },
      writer: {
        add(service, _account, secret) {
          if (items.has(service)) throw new KeychainError(service, 45, null, "write");
          items.set(service, secret);
        },
      },
    };
    const minted: (readonly string[])[] = [];
    const sessionTokenMint: SessionTokenMint = (repos) => {
      minted.push(repos);
      return { ok: true, token: "ghs_launchfixturetoken0001", expires_at: new Date(Date.parse(START) + 86_400_000).toISOString() };
    };
    const d: KernelDeps = {
      keychain: keychain.reader,
      keychainWriter: keychain.writer,
      sessionDeps: { ...fakes.deps, query, homeDir: home },
      selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
      availableProviderIds: async () => ["api-key"],
      now: () => new Date(START),
      loopDeps: { tickMs: 10, now: () => new Date(START) },
      githubClient: new FakeGitHubClient({ tokenInfo: { login: "o", expires_at: null, permissions: null }, repos: [{ full_name: REPO, private: false }] }),
    };
    // The token mint is a daemon-wired option the typed `sessions` slot does not name (the exit walk passes it the same way).
    const sessionOptions = { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10, sessionTokenMint };
    const kernel = await startKernel({ dataDir, env: { PATH: "/usr/bin" }, sessions: sessionOptions, contributions }, d);
    kernels.push(kernel);
    const store = kernel.store;
    store.prepare("INSERT INTO connectors (kind, status, account_login, reachable_repos_json, created_at, updated_at) VALUES ('github', 'connected', 'o', ?, ?, ?)").run(JSON.stringify([REPO]), START, START);

    const workspaces: Record<string, string> = {};
    const playbooks: Record<string, number> = {};
    // mason takes no boundary; ranger never pushes.
    for (const [id, never] of [["mason", []], ["ranger", ["git_push"]]] as const) {
      const workspace = makeCheckout(tmp, `ws-${id}`, `https://github.com/${REPO}.git`);
      workspaces[id] = workspace;
      expect(createAgent(store, dataDir, charter(id, workspace, never), { by: "owner", homeDir: home }, new Date(START))).toMatchObject({ ok: true, filesError: null });
      const file = agentSettingsPath(dataDir, id);
      const rendered = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      writeFileSync(file, `${JSON.stringify({ ...rendered, connectors: { github: "write" } }, null, 2)}\n`);
      const made = createPlaybook(
        store,
        { agent: id, name: `Tickets ${id}`, intent: "Hand each ticket to /automate.", trigger: { kind: "poll", spec: JSON.stringify({ source: "github.pulls", repos: [REPO], filters: { state: "open" }, interval_seconds: 300 }) }, model: PLAYBOOK_MODEL },
        new Date(START),
      );
      store.prepare("UPDATE playbooks SET mode = 'live', mode_set_by = 'owner' WHERE id = ?").run(made.playbook.id);
      playbooks[id] = made.playbook.id;
    }
    return { kernel, store, fakes, prompts, workspaces, playbooks, minted };
  }

  /** The crew member's playbook session calls prepare; the kernel then starts the run session. */
  async function launch(r: Rig, agent: "mason" | "ranger"): Promise<Launched> {
    const dataDir = r.store.dataDir;
    const s = readAgentSettings(dataDir, agent);
    if (!s.ok) throw new Error(s.message);
    const task = Number(r.store.prepare("INSERT INTO tasks (title, state) VALUES ('Ticket', 'open')").run().lastInsertRowid);
    const before = r.fakes.calls.length;
    const handle = await r.kernel.sessions.startSession({
      agent,
      task,
      prompt: "Run this playbook.",
      model: PLAYBOOK_MODEL,
      permissionMode: s.settings.permissionMode,
      cwd: agentMemoryDir(dataDir, agent),
      policy: s.settings.policy,
      playbook: r.playbooks[agent] as number,
      playbookVersion: 1,
    });
    const caller = r.fakes.calls[before] as FakeCall;
    const answer = await toolsOf(caller)["kernel_automate_prepare"]?.handler(
      { repo: REPO, tickets: [{ ref: "T-1", title: "Add a greeting", link: "https://example.test/T-1", body: "Say hello." }] },
      {},
    );
    expect(answer?.isError, answer?.content[0]?.text).not.toBe(true);
    const out = JSON.parse(answer?.content[0]?.text ?? "null") as Record<string, unknown>;
    expect(out["run"]).toBe("started_by_kernel");
    await vi.waitFor(() => expect(r.fakes.calls.length).toBe(before + 2), WAIT);
    const run = r.fakes.calls[before + 1] as FakeCall;
    const runId = Number(r.store.prepare("SELECT MAX(id) FROM sessions").pluck().get());
    return { callerId: handle.id, caller, runId, run, task };
  }

  const sessionRow = (r: Rig, id: number) =>
    r.store
      .prepare<[number], { agent: string; status: string; model: string; playbook: number | null; playbook_version: number | null; task_id: number | null; cwd: string | null }>(
        "SELECT agent, status, model, playbook, playbook_version, task_id, cwd FROM sessions WHERE id = ?",
      )
      .get(id);

  const decisions = (r: Rig, sessionId: number) => events(r.store, "tool_decision").filter((e) => e.session_id === sessionId).map((e) => e.payload);

  it("AC3/AC4: prepare queues the event and the kernel starts ONE run session, attributed to the crew member and the playbook, in its checkout, on the calling session's model, with the run prompt", async () => {
    const r = await rig();
    const l = await launch(r, "mason");
    // One run session, started from the queued event.
    expect(r.store.prepare("SELECT COUNT(*) FROM sessions").pluck().get()).toBe(2);
    expect(r.store.prepare("SELECT COUNT(*) FROM event_queue WHERE json_extract(payload_json, '$.automate_run') IS NOT NULL").pluck().get()).toBe(1);
    expect(sessionRow(r, l.runId)).toMatchObject({
      agent: "mason",
      status: "running",
      // The calling session's model, not mason's settings model (CREW_MODEL).
      model: PLAYBOOK_MODEL,
      playbook: r.playbooks["mason"],
      playbook_version: 1,
      task_id: l.task,
    });
    expect(sessionRow(r, l.runId)?.cwd).toContain("ws-mason");
    expect(l.run.options.cwd).toBe(r.workspaces["mason"]);
    expect(l.run.options.model).toBe(PLAYBOOK_MODEL);
    await vi.waitFor(() => expect(r.prompts.get(l.run.options)?.length ?? 0).toBeGreaterThan(0), WAIT);
    expect((r.prompts.get(l.run.options) as string[])[0]).toBe(`/loomwright:automate --backlog ${join(r.workspaces["mason"] as string, ".supervisor", "requirements", "studio", "_BACKLOG.md")} --inline-phases`);
    // A live, write-granted playbook session: the manager minted its GitHub token (the caller's and the run's).
    expect(r.minted).toHaveLength(2);
    for (const repos of r.minted) expect(repos).toEqual([REPO]);

    // The crew session's own policy holds no Skill and no shell grant; the run session's holds them.
    const crew = gateOf(l.caller);
    expect(await crew("Skill", { skill: "loomwright:automate" })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "tool_not_allowed" });
    expect(await crew("Bash", { command: "git status" })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "bash_prefix_not_allowed" });
    expect(await crew("Bash", { command: "gh pr view 7" })).toMatchObject({ permissionDecision: "deny" });
    const settings = readAgentSettings(r.store.dataDir, "mason");
    expect(settings.ok && settings.settings.policy.allowedTools).not.toContain("Skill");
    expect(settings.ok && settings.settings.policy.allowedBashPrefixes).toEqual([]);
    const run = gateOf(l.run);
    expect(await run("Skill", { skill: "loomwright:automate" })).toMatchObject({ permissionDecision: "allow" });
    expect(await run("Bash", { command: "git status" })).toMatchObject({ permissionDecision: "allow" });
    expect(await run("Read", { file_path: "/x" })).toMatchObject({ permissionDecision: "allow" });
    // Nothing outside the run policy: a tool it does not list, and a command no prefix covers.
    expect(await run("WebFetch", { url: "https://example.test" })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "tool_not_allowed" });
    expect(await run("Bash", { command: "rm -rf build" })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "bash_prefix_not_allowed" });
    // The Bash rail is unchanged: a piped command is still denied.
    expect(await run("Bash", { command: "git log | head" })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "bash_shell_metacharacter" });
    // The run session's decisions are recorded against the run session.
    expect(decisions(r, l.runId).map((p) => [p.tool, p.decision])).toEqual(expect.arrayContaining([["Skill", "allow"], ["Bash", "allow"], ["Bash", "deny"]]));
  });

  it("AC12: a gate question in the run session is allowed by the policy and HELD in Approvals with its header, text and option labels; no always grant covers it (the owner's answer path is unverified)", async () => {
    const r = await rig();
    const l = await launch(r, "mason");
    const question = { header: "Gate", question: "Process the queue?", multiSelect: false, options: [{ label: "Process", description: "Go on" }, { label: "Skip", description: "Stop here" }] };
    const held = await gateOf(l.run)("AskUserQuestion", { questions: [question] });
    expect(held.permissionDecision).toBe("deny");
    expect(held.permissionDecisionReason).toMatch(/^approval_required: held as approval \d+; it did not run\. The owner decides in Studio's Approvals/);
    const approvals = r.store.prepare<[], { id: number; action: string; status: string; requesting_session: number; payload_json: string }>("SELECT id, action, status, requesting_session, payload_json FROM approvals").all();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ action: "AskUserQuestion", status: "pending", requesting_session: l.runId });
    const payload = JSON.parse(approvals[0]?.payload_json ?? "null") as { tool: string; input: { questions: { header: string; question: string; options: { label: string }[] }[] } };
    expect(payload.tool).toBe("AskUserQuestion");
    expect(payload.input.questions[0]?.header).toBe("Gate");
    expect(payload.input.questions[0]?.question).toBe("Process the queue?");
    expect(payload.input.questions[0]?.options.map((o) => o.label)).toEqual(["Process", "Skip"]);
    // The crew session is not allowed the tool at all (it is the run policy that lists it).
    expect(await gateOf(l.caller)("AskUserQuestion", { questions: [question] })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "tool_not_allowed" });
    expect(r.store.prepare("SELECT COUNT(*) FROM approvals").pluck().get()).toBe(1);
    // No "always" decision covers it (ALWAYS_HELD_TOOLS): refused at decide time, the approval left pending.
    expect(() => decideApproval(r.store, { id: approvals[0]?.id as number, decision: "always", by: "owner" }, new Date(START))).toThrow(
      expect.objectContaining({ code: "always_not_supported", message: "always never covers AskUserQuestion: the owner decides every call to it; approve it once" }),
    );
    expect(r.store.prepare("SELECT status FROM approvals WHERE id = ?").pluck().get(approvals[0]?.id)).toBe("pending");
  });

  it("AC13: a push in the run session is held approval_required for a crew member with no boundary, and denied agent_boundary under its never list; gh pr merge is denied merge_blocked for both", async () => {
    const r = await rig();
    const mason = await launch(r, "mason");
    const push = await gateOf(mason.run)("Bash", { command: "git push origin feature/x" });
    expect(push.permissionDecision).toBe("deny");
    expect(push.permissionDecisionReason).toMatch(/^approval_required: held as approval \d+/);
    expect(await gateOf(mason.run)("Bash", { command: "gh pr merge 7 --squash" })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "merge_blocked" });
    expect(decisions(r, mason.runId).map((p) => [p.tool, p.decision, p.reason])).toEqual([
      ["Bash", "deny", "approval_required"],
      ["Bash", "deny", "merge_blocked"],
    ]);
    const held = r.store.prepare<[], { action: string; status: string; requesting_session: number }>("SELECT action, status, requesting_session FROM approvals").all();
    expect(held).toEqual([{ action: "git push", status: "pending", requesting_session: mason.runId }]);

    // ranger's never list reaches the run policy: the same push is a boundary, never an approval.
    const ranger = await launch(r, "ranger");
    const boundary = await gateOf(ranger.run)("Bash", { command: "git push origin feature/x" });
    expect(boundary.permissionDecision).toBe("deny");
    expect(boundary.permissionDecisionReason).toMatch(/^agent_boundary: git_push is in this agent's never list/);
    expect(await gateOf(ranger.run)("Bash", { command: "gh pr merge 7 --squash" })).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "merge_blocked" });
    expect(decisions(r, ranger.runId)).toEqual([
      expect.objectContaining({ tool: "Bash", decision: "deny", reason: "agent_boundary", category: "git_push" }),
      expect.objectContaining({ tool: "Bash", decision: "deny", reason: "merge_blocked" }),
    ]);
    // No second approval was written for ranger's push.
    expect(r.store.prepare("SELECT COUNT(*) FROM approvals").pluck().get()).toBe(1);
  });

  it("AC14: Stop ends the run session through the session manager's normal path, and its tokens count against the crew member and the playbook", async () => {
    const r = await rig();
    const l = await launch(r, "mason");
    // The run meters some tokens (the result does not end the stream: the CLI is still up), then the owner stops it.
    l.run.stream.push(usage(PLAYBOOK_MODEL, 1_000, 200));
    await vi.waitFor(() => expect(r.store.prepare("SELECT COUNT(*) FROM budget WHERE session_id = ?").pluck().get(l.runId)).toBeGreaterThan(0), WAIT);
    expect(sessionRow(r, l.runId)?.status).toBe("running");
    expect(await r.kernel.sessions.stopSession(l.runId)).toBe("stopped");
    expect(sessionRow(r, l.runId)?.status).toBe("stopped");
    expect(r.fakes.isGroupAlive(l.run.child.pid)).toBe(false);
    // The usage is the crew member's and the playbook's (the budget row carries both), and the caller session is untouched.
    expect(r.store.prepare("SELECT agent, playbook, input_tokens, output_tokens FROM budget WHERE session_id = ?").all(l.runId)).toEqual([
      { agent: "mason", playbook: String(r.playbooks["mason"]), input_tokens: 1_000, output_tokens: 200 },
    ]);
    expect(sessionRow(r, l.callerId)?.status).toBe("running");
    // A stopped run starts no second one: the event is done and the session count is unchanged.
    expect(r.store.prepare("SELECT COUNT(*) FROM sessions").pluck().get()).toBe(2);
  });

  it("AC14: Kill ends the run session the same way (the group is killed), and the owner's stop/kill of it leaves the crew member's other sessions alone", async () => {
    const r = await rig();
    const l = await launch(r, "ranger");
    l.run.stream.push(usage(PLAYBOOK_MODEL, 50, 5));
    await vi.waitFor(() => expect(r.store.prepare("SELECT COUNT(*) FROM budget WHERE session_id = ?").pluck().get(l.runId)).toBeGreaterThan(0), WAIT);
    expect(await r.kernel.sessions.stopSession(l.runId, { mode: "kill" })).toBe("stopped");
    expect(sessionRow(r, l.runId)).toMatchObject({ status: "stopped", agent: "ranger", playbook: r.playbooks["ranger"] });
    expect(r.fakes.killed.length).toBeGreaterThan(0);
    expect(r.fakes.isGroupAlive(l.run.child.pid)).toBe(false);
    expect(r.store.prepare("SELECT agent, playbook FROM budget WHERE session_id = ?").all(l.runId)).toEqual([{ agent: "ranger", playbook: String(r.playbooks["ranger"]) }]);
    expect(sessionRow(r, l.callerId)?.status).toBe("running");
  });
});
