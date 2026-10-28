// Forced-draft dry runs and the GitHub read tools in a dry run (phase 6 item 08,
// session layer): `forceDraft` makes a dry-run session take draft mode's path
// for an outward call (denied `draft_mode`, recorded as a draft output, never a
// `held` would-do entry) whatever `playbooks.mode` says, and survives a resume;
// the four `kernel_github_pr_*` tools are read-only in a dry run. Driven through
// the real `SessionManager` gate over the fake spawner/query in session-fakes.ts:
// never a real model, process or GitHub.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRY_RUN_DENY_MESSAGE, DRY_RUN_GITHUB_READ_TOOLS, DRY_RUN_READ_ONLY_TOOLS, classifyDryRunCall, isDryRunReadOnly } from "../src/sessions/dry-run.js";
import { draftDenyReason } from "../src/sessions/draft-mode.js";
import { SessionManager } from "../src/sessions/manager.js";
import { SessionError } from "../src/sessions/types.js";
import type { DryRunReport, SessionHandle, StartSessionParams, ToolPolicy } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const K = "mcp__kernel__";
const GITHUB_READ = ["pr_get", "pr_diff", "pr_files", "pr_comments"].map((n) => `${K}kernel_github_${n}`);
const REVIEW = 'gh pr review 12 --comment --body "Looks fine"';
const VIEW = "gh pr view 12";

let tmp: string;
let pluginDir: string;
let home: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-dry-run-draft-"));
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

/** The policy a poll playbook's review session has: gh and the four GitHub read tools allowed. */
const POLICY: ToolPolicy = { allowedTools: ["Read", ...GITHUB_READ], allowedBashPrefixes: ["gh pr"] };

const assistant = (): SDKMessage =>
  ({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, parent_tool_use_id: null }) as unknown as SDKMessage;
const success = (): SDKMessage => ({ type: "result", subtype: "success", is_error: false, result: "DONE", modelUsage: {} }) as unknown as SDKMessage;

function setup() {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  const fakes = fakeSessions();
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
    { ...fakes.deps, homeDir: home, now: () => new Date("2026-10-28T09:00:00.000Z") },
  );
  /** A playbook row; `draft` is the column's default. */
  const playbook = (mode?: "live"): number => {
    const slug = `pb${count(store, "SELECT count(*) FROM playbooks")}`;
    const id = Number(
      store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, version) VALUES (?, ?, 'wright', 'Review', 1)").run(slug, slug).lastInsertRowid,
    );
    if (mode !== undefined) store.prepare("UPDATE playbooks SET mode = ? WHERE id = ?").run(mode, id);
    return id;
  };

  /** The gate and stream of one launch attempt. */
  function attempt(call: FakeCall) {
    const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const gate = async (tool: string, input: unknown): Promise<Decision> => {
      const hookInput = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
      return ((await hook(hookInput, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
    };
    const finish = (): void => {
      call.stream.push(assistant());
      call.stream.push(success());
      call.stream.end();
    };
    return { gate, bash: (command: string) => gate("Bash", { command }), finish };
  }
  const lastCall = (): FakeCall => fakes.calls[fakes.calls.length - 1] as FakeCall;

  async function session(policy: ToolPolicy, overrides: Partial<StartSessionParams> = {}) {
    const handle = await manager.startSession(startParams(tmp, { policy, closeInputOnResult: false, ...overrides }));
    return { handle, ...attempt(lastCall()) };
  }
  async function resume(id: number, policy: ToolPolicy) {
    const handle = await manager.resumeSession(id, { permissionMode: "default", cwd: tmp, policy, closeInputOnResult: false });
    return { handle, ...attempt(lastCall()) };
  }
  /** Make an ended session resumable, as a kernel restart would leave it. */
  const interrupt = (id: number): void => {
    store.prepare("UPDATE sessions SET status = 'interrupted', ended_at = NULL WHERE id = ?").run(id);
  };
  const drafts = (): { session: number; playbook: number | null; tool: string; payload: Record<string, unknown> }[] =>
    store
      .prepare<[], { session: number; playbook: number | null; tool: string; payload_json: string }>("SELECT session, playbook, tool, payload_json FROM draft_outputs ORDER BY id")
      .all()
      .map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const approvals = (): number => count(store, "SELECT count(*) FROM approvals");
  const decisions = () => events(store, "tool_decision").map((e) => e.payload);
  return { store, manager, fakes, playbook, session, resume, interrupt, drafts, approvals, decisions };
}

async function reportOf(handle: SessionHandle): Promise<DryRunReport> {
  const report = await handle.dryRun;
  if (report === null || report === undefined) throw new Error("no dry-run report");
  return report;
}

const denied = (permissionDecisionReason: string): Decision => ({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason });

describe("the GitHub read tools are read-only in a dry run", () => {
  it("DRY_RUN_GITHUB_READ_TOOLS is exactly the four kernel_github_pr_* tools, frozen; DRY_RUN_READ_ONLY_TOOLS is unchanged", () => {
    expect(DRY_RUN_GITHUB_READ_TOOLS).toEqual(GITHUB_READ);
    expect(Object.isFrozen(DRY_RUN_GITHUB_READ_TOOLS)).toBe(true);
    expect(DRY_RUN_READ_ONLY_TOOLS).toEqual(["Read", "Glob", "Grep", `${K}kernel_loomwright_capabilities`]);
    expect(Object.isFrozen(DRY_RUN_READ_ONLY_TOOLS)).toBe(true);
  });

  it("isDryRunReadOnly accepts the four and nothing else under kernel_github_", () => {
    for (const tool of GITHUB_READ) expect(isDryRunReadOnly(tool, {}), tool).toBe(true);
    for (const tool of [`${K}kernel_github_pr_review`, `${K}kernel_github_pr_diff_x`, `${K}kernel_github_pr_post`, "kernel_github_pr_diff", "mcp__other__kernel_github_pr_diff"]) {
      expect(isDryRunReadOnly(tool, {}), tool).toBe(false);
    }
  });

  it("classifyDryRunCall allows a GitHub read tool the policy and rail allowed", () => {
    const allow = { decision: "allow", reason: "tool_allowed" } as const;
    for (const tool of GITHUB_READ) expect(classifyDryRunCall(tool, {}, allow, { kind: "ordinary" }), tool).toEqual({ kind: "allow" });
  });

  it("through the gate, a dry-run session runs the four tools its policy allows and records no would-do entry", async () => {
    const t = setup();
    const s = await t.session(POLICY, { dryRun: true });
    for (const tool of GITHUB_READ) expect((await s.gate(tool, {})).permissionDecision, tool).toBe("allow");
    s.finish();
    expect(await s.handle.done).toBe("completed");
    expect((await reportOf(s.handle)).wouldDo).toEqual([]);
  });

  it("a GitHub read tool the policy does not allow is still denied by the policy", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: ["Read"], allowedBashPrefixes: [] }, { dryRun: true });
    expect((await s.gate(`${K}kernel_github_pr_diff`, {})).permissionDecision).toBe("deny");
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([]);
  });
});

describe("a forced-draft dry run drafts an outward call", () => {
  it("denies gh pr review draft_mode, records one draft output and no would-do entry, while gh pr view stays a would-do entry", async () => {
    const t = setup();
    const pb = t.playbook();
    const s = await t.session(POLICY, { dryRun: true, forceDraft: true, playbook: pb, playbookVersion: 1 });
    expect(await s.bash(REVIEW)).toEqual(denied(draftDenyReason(1)));
    expect((await s.bash(VIEW)).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    s.finish();
    expect(await s.handle.done).toBe("completed");

    expect(t.drafts().map((d) => [d.session, d.playbook, d.tool, d.payload["body"]])).toEqual([[s.handle.id, pb, "gh pr review", "Looks fine"]]);
    expect(events(t.store, "draft_output_recorded")).toHaveLength(1);
    expect(t.approvals()).toBe(0);
    expect((await reportOf(s.handle)).wouldDo).toEqual([{ tool: "Bash", input_summary: VIEW, would: "run", reason: "dry_run" }]);
    expect(t.decisions().map((d) => d["reason"])).toEqual(["draft_mode", "dry_run"]);
  });

  it("is forced even when the playbook's stored mode is live: never held, never a would-do entry", async () => {
    const t = setup();
    const s = await t.session(POLICY, { dryRun: true, forceDraft: true, playbook: t.playbook("live"), playbookVersion: 1 });
    expect(await s.bash(REVIEW)).toEqual(denied(draftDenyReason(1)));
    s.finish();
    expect(t.drafts()).toHaveLength(1);
    expect(t.approvals()).toBe(0);
    expect((await reportOf(s.handle)).wouldDo).toEqual([]);
  });

  it("the never boundary still wins: no draft, no would-do entry", async () => {
    const t = setup();
    const s = await t.session({ ...POLICY, never: ["gh_pr_review"] }, { dryRun: true, forceDraft: true, playbook: t.playbook(), playbookVersion: 1 });
    expect((await s.bash(REVIEW)).permissionDecisionReason).toMatch(/^agent_boundary: gh_pr_review is in this agent's never list\./);
    s.finish();
    expect(t.drafts()).toEqual([]);
    expect((await reportOf(s.handle)).wouldDo).toEqual([]);
  });

  it("a dry run started without forceDraft is unchanged: gh pr review is a held would-do entry and no draft row is written", async () => {
    const t = setup();
    const s = await t.session(POLICY, { dryRun: true, playbook: t.playbook(), playbookVersion: 1 });
    expect((await s.bash(REVIEW)).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([
      { tool: "Bash", input_summary: REVIEW, would: "held", reason: "dry_run", action: "gh pr review" },
    ]);
    expect(t.drafts()).toEqual([]);
    expect(events(t.store, "session_dry_run").map((e) => e.payload)).toEqual([{}]);
  });

  it("forceDraft: true without dryRun: true is refused invalid_params before any row or spawn", async () => {
    const t = setup();
    for (const overrides of [{ forceDraft: true }, { forceDraft: true, dryRun: false }]) {
      const err = await t.manager.startSession(startParams(tmp, overrides)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SessionError);
      expect((err as SessionError).code).toBe("invalid_params");
    }
    const notBoolean = await t.manager.startSession(startParams(tmp, { dryRun: true, forceDraft: "yes" as unknown as boolean })).catch((e: unknown) => e);
    expect((notBoolean as SessionError).code).toBe("invalid_params");
    expect(t.fakes.calls).toHaveLength(0);
    expect(count(t.store, "SELECT count(*) FROM sessions")).toBe(0);
  });

  it("forceDraft: false without dryRun is accepted (a real run)", async () => {
    const t = setup();
    const s = await t.session(POLICY, { forceDraft: false });
    s.finish();
    expect(await s.handle.done).toBe("completed");
    expect(events(t.store, "session_dry_run")).toEqual([]);
  });
});

describe("a forced-draft dry run resumes forced-draft", () => {
  it("records the flag on the session_dry_run event and drafts the resumed gh pr review, never a held would-do entry", async () => {
    const t = setup();
    const pb = t.playbook("live");
    const first = await t.session(POLICY, { dryRun: true, forceDraft: true, playbook: pb, playbookVersion: 1 });
    first.finish();
    expect(await first.handle.done).toBe("completed");
    expect(events(t.store, "session_dry_run").map((e) => [e.session_id, e.payload])).toEqual([[first.handle.id, { forceDraft: true }]]);
    t.interrupt(first.handle.id);

    const resumed = await t.resume(first.handle.id, POLICY);
    expect(await resumed.bash(REVIEW)).toEqual(denied(draftDenyReason(1)));
    resumed.finish();
    expect(await resumed.handle.done).toBe("completed");
    expect((await reportOf(resumed.handle)).wouldDo).toEqual([]);
    expect(t.drafts().map((d) => d.session)).toEqual([first.handle.id]);
    expect(t.approvals()).toBe(0);
    // No second event: the start's one is what every resume reads.
    expect(events(t.store, "session_dry_run")).toHaveLength(1);
  });

  it("an ordinary dry run resumes as an ordinary dry run: held would-do entry, no draft", async () => {
    const t = setup();
    const first = await t.session(POLICY, { dryRun: true, playbook: t.playbook(), playbookVersion: 1 });
    first.finish();
    await first.handle.done;
    t.interrupt(first.handle.id);

    const resumed = await t.resume(first.handle.id, POLICY);
    expect((await resumed.bash(REVIEW)).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    resumed.finish();
    expect((await reportOf(resumed.handle)).wouldDo.map((w) => w.would)).toEqual(["held"]);
    expect(t.drafts()).toEqual([]);
  });
});
