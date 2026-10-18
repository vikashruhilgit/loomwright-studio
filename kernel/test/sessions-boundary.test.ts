// The never boundary (phase 4 item 03) through the real `SessionManager` gate:
// a call whose outward form is in the session policy's `never` list is denied
// `agent_boundary` with its category, never held as an approval and never
// covered by a grant, while every call outside its categories is decided as
// before. Driven over the fake spawner/query in session-fakes.ts; never the
// real SDK, a model or a real process.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideApproval } from "../src/approvals/index.js";
import { SessionManager } from "../src/sessions/index.js";
import type { ToolPolicy } from "../src/sessions/index.js";
import { NEVER_CATEGORIES } from "../src/sessions/policy.js";
import { Store } from "../src/store/index.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

let tmp: string;
let pluginDir: string;
let home: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-boundary-"));
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** The hook's reason for a boundary deny in `category`, pinned exactly. */
const boundaryReason = (category: string): string =>
  `agent_boundary: ${category} is in this agent's never list. The owner's settings forbid it for this agent; it did not run. ` +
  "Do not ask for an approval and do not retry it.";

const GIT: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["git"] };
const NO_PUSH: ToolPolicy = { ...GIT, never: ["git_push"] };

/** A store and a manager over the fakes; each call gets its own data dir. */
function setup() {
  const store = new Store({ dataDir: join(tmp, `data-${stores.length}`) });
  stores.push(store);
  const fakes = fakeSessions();
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
    { ...fakes.deps, homeDir: home, now: () => new Date("2026-10-18T09:00:00.000Z") },
  );
  /** Start a session under `policy`; returns its id and its gate. */
  async function session(policy: ToolPolicy) {
    const handle = await manager.startSession(startParams(tmp, { policy }));
    const hook = fakes.calls[fakes.calls.length - 1]?.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const gate = async (tool: string, input: unknown): Promise<Decision> => {
      const hookInput = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
      return ((await hook(hookInput, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
    };
    return { id: handle.id, gate, bash: (command: string) => gate("Bash", { command }) };
  }
  const decisions = () => events(store, "tool_decision").map((e) => e.payload);
  const approvals = () => count(store, "SELECT count(*) FROM approvals");
  const grantEvents = () => [...events(store, "approval_used"), ...events(store, "approval_grant_used")];
  return { store, session, decisions, approvals, grantEvents };
}

describe("the never boundary through the gate", () => {
  it("denies every push form the rail recognises agent_boundary (git_push): one tool_decision event, no approval row, no grant used", async () => {
    for (const command of ["git push origin main", "git -c alias.p=push p", "git subtree push", "git pu*"]) {
      const t = setup();
      const s = await t.session(NO_PUSH);
      expect(await s.bash(command), command).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: boundaryReason("git_push") });
      expect(t.decisions(), command).toEqual([{ tool: "Bash", decision: "deny", reason: "agent_boundary", command, category: "git_push" }]);
      expect(t.approvals(), command).toBe(0);
      expect(t.grantEvents(), command).toEqual([]);
    }
  });

  it("lets git diff and git log run as before", async () => {
    const t = setup();
    const s = await t.session(NO_PUSH);
    for (const command of ["git diff", "git log --oneline"]) {
      expect((await s.bash(command)).permissionDecision, command).toBe("allow");
    }
    expect(t.decisions()).toEqual([
      { tool: "Bash", decision: "allow", reason: "bash_prefix_allowed", command: "git diff" },
      { tool: "Bash", decision: "allow", reason: "bash_prefix_allowed", command: "git log --oneline" },
    ]);
    expect(t.approvals()).toBe(0);
  });

  it("holds gh pr comment exactly as today: the boundary changes nothing outside its categories", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: [], allowedBashPrefixes: ["git", "gh pr comment"], never: ["git_push"] });
    expect((await s.bash("gh pr comment 3 -b x")).permissionDecisionReason).toMatch(/^approval_required: held as approval 1; it did not run\. /);
    expect(t.decisions()).toEqual([{ tool: "Bash", decision: "deny", reason: "approval_required", command: "gh pr comment 3 -b x", approval_id: 1 }]);
    expect(t.approvals()).toBe(1);
  });

  it("with no never, or an empty one, a push is held as before", async () => {
    for (const policy of [GIT, { ...GIT, never: [] }]) {
      const t = setup();
      const s = await t.session(policy);
      expect((await s.bash("git push origin main")).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
      expect(t.decisions()).toEqual([{ tool: "Bash", decision: "deny", reason: "approval_required", command: "git push origin main", approval_id: 1 }]);
    }
  });

  it("a standing grant whose exact payload is the push never lets it through once the policy names git_push, and is not used", async () => {
    const t = setup();
    const playbook = Number(
      t.store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, version) VALUES ('ship', 'ship', 'wright', 'Ship', 1)").run().lastInsertRowid,
    );
    const inPlaybook = async (policy: ToolPolicy) => {
      const s = await t.session(policy);
      t.store.prepare("UPDATE sessions SET playbook = ?, playbook_version = 1 WHERE id = ?").run(playbook, s.id);
      return s;
    };
    const first = await inPlaybook(GIT);
    expect((await first.bash("git push origin main")).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    decideApproval(t.store, { id: 1, decision: "always", by: "owner" }, new Date("2026-10-18T09:05:00.000Z"));
    // The grant matches: without never, the identical push runs on it.
    expect((await (await inPlaybook(GIT)).bash("git push origin main")).permissionDecisionReason).toBe("approval_granted");
    expect(events(t.store, "approval_grant_used")).toHaveLength(1);

    // The owner then added git_push to never: the identical call is denied, and the grant is not used.
    const bounded = await inPlaybook(NO_PUSH);
    expect((await bounded.bash("git push origin main")).permissionDecisionReason).toBe(boundaryReason("git_push"));
    expect(events(t.store, "approval_grant_used")).toHaveLength(1);
    expect(events(t.store, "approval_used")).toEqual([]);
    expect(t.approvals()).toBe(1);
    expect(t.decisions().at(-1)).toEqual({ tool: "Bash", decision: "deny", reason: "agent_boundary", command: "git push origin main", category: "git_push" });
  });

  it("an approved one-shot grant for the exact push is not used under the boundary", async () => {
    const t = setup();
    const before = await t.session(GIT);
    expect((await before.bash("git push origin main")).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    decideApproval(t.store, { id: 1, decision: "once", by: "owner" }, new Date("2026-10-18T09:05:00.000Z"));
    const s = await t.session(NO_PUSH);
    expect((await s.bash("git push origin main")).permissionDecisionReason).toBe(boundaryReason("git_push"));
    expect(t.grantEvents()).toEqual([]);
    expect(t.approvals()).toBe(1);
  });

  it("denies a merge merge_blocked even when never names every category: the merge block comes first", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: [], allowedBashPrefixes: ["gh"], never: [...NEVER_CATEGORIES] });
    expect(await s.bash("gh pr merge 3")).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "merge_blocked" });
    expect(t.decisions()).toEqual([{ tool: "Bash", decision: "deny", reason: "merge_blocked", command: "gh pr merge 3" }]);
    expect(t.approvals()).toBe(0);
  });

  it("denies a Write the rail reads as several forms when never names any one of their categories (hooks_write)", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: ["Write"], allowedBashPrefixes: [], never: ["hooks_write"] });
    const input = { file_path: join(home, ".claude", "hooks", "x.sh"), content: "" };
    expect(await s.gate("Write", input)).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: boundaryReason("hooks_write") });
    expect(t.decisions()).toEqual([{ tool: "Write", decision: "deny", reason: "agent_boundary", category: "hooks_write" }]);
    expect(t.approvals()).toBe(0);
    // A settings file under ~/.claude/ is only settings_write: held as before.
    expect((await s.gate("Write", { file_path: join(home, ".claude", "settings.json"), content: "" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
  });

  it("an always-held kernel tool is held as before, whatever never names", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: ["mcp__kernel__kernel_agent_create"], allowedBashPrefixes: [], never: [...NEVER_CATEGORIES] });
    expect((await s.gate("mcp__kernel__kernel_agent_create", { id: "mason" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(t.decisions()).toEqual([expect.objectContaining({ decision: "deny", reason: "approval_required", approval_id: 1 })]);
  });
});
