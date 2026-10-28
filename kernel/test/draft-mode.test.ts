// Draft mode (phase 6 item 07) through the real `SessionManager` gate: a
// draft-mode playbook session's outward call is denied `draft_mode` without
// asking the owner, before any grant or hold, and recorded as one
// `draft_outputs` row with one `draft_output_recorded` event; a session whose
// agent holds the `github` grant never runs `gh` (`use_kernel_github_tools`);
// the owner reads drafts through `GET /drafts` and `GET /drafts/:id`. Driven
// over the fake spawner/query in session-fakes.ts: no network, no real `gh`,
// never the real SDK, a model or a real process.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideApproval } from "../src/approvals/index.js";
import { draftsPart, recordDraftOutput } from "../src/integrations/index.js";
import type { ConnectorKind } from "../src/integrations/index.js";
import { SessionManager } from "../src/sessions/index.js";
import type { ToolPolicy } from "../src/sessions/index.js";
import { GITHUB_CLI_DENY_REASON, MAX_DRAFT_TEXT_CHARS, draftDenyReason } from "../src/sessions/draft-mode.js";
import { Store } from "../src/store/index.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

let tmp: string;
let pluginDir: string;
let home: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-draft-"));
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A policy that allows every gh form the tests run, and a push. */
const GH: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["gh pr", "git push"] };

const REVIEW = 'gh pr review 12 --approve --body "LGTM"';
const COMMENT = "gh pr comment 12 --body x";

interface DraftRow {
  id: number;
  session: number;
  agent: string;
  playbook: number | null;
  playbook_run: number | null;
  item_ref: string | null;
  tool: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/** A store and a manager over the fakes; each call gets its own data dir. */
function setup(connectors?: readonly ConnectorKind[]) {
  const store = new Store({ dataDir: join(tmp, `data-${stores.length}`) });
  stores.push(store);
  const fakes = fakeSessions();
  const manager = new SessionManager(
    {
      store,
      authProvider: stubProvider(),
      loomwrightPath: pluginDir,
      stopGraceMs: 10,
      baseEnv: { PATH: "/usr/bin" },
      ...(connectors === undefined ? {} : { connectorsFor: () => connectors }),
    },
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
  /** Start a session (a playbook's when `playbook` is given); returns its id and its gate. */
  async function session(policy: ToolPolicy, extra: { playbook?: number; agent?: string; dryRun?: boolean } = {}) {
    const { playbook: pb, ...rest } = extra;
    const handle = await manager.startSession(startParams(tmp, { policy, ...rest, ...(pb === undefined ? {} : { playbook: pb, playbookVersion: 1 }) }));
    const hook = fakes.calls[fakes.calls.length - 1]?.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const gate = async (tool: string, input: unknown): Promise<Decision> => {
      const hookInput = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
      return ((await hook(hookInput, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
    };
    return { id: handle.id, gate, bash: (command: string) => gate("Bash", { command }) };
  }
  const decisions = () => events(store, "tool_decision").map((e) => e.payload);
  const approvals = () => count(store, "SELECT count(*) FROM approvals");
  const drafts = (): DraftRow[] =>
    store
      .prepare<[], Omit<DraftRow, "payload"> & { payload_json: string }>("SELECT * FROM draft_outputs ORDER BY id")
      .all()
      .map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const draftEvents = () => events(store, "draft_output_recorded");
  return { store, manager, playbook, session, decisions, approvals, drafts, draftEvents };
}

const denied = (permissionDecisionReason: string): Decision => ({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason });

describe("draft mode through the gate (AC1)", () => {
  it("denies a draft-mode gh pr review draft_mode and records one row and one event, with no approval", async () => {
    const t = setup();
    const pb = t.playbook();
    const s = await t.session(GH, { playbook: pb });
    expect(await s.bash(REVIEW)).toEqual(denied(draftDenyReason(1)));
    expect(draftDenyReason(1)).toBe(
      "draft_mode: this playbook runs in draft mode, so the kernel did not send this call; it saved it as draft output 1 for the owner to read. " +
        "Nothing was posted. Do not retry it and do not ask for an approval.",
    );
    expect(t.approvals()).toBe(0);
    expect(t.drafts()).toEqual([
      {
        id: 1,
        session: s.id,
        agent: "wright",
        playbook: pb,
        playbook_run: null,
        item_ref: null,
        created_at: "2026-10-28T09:00:00.000Z",
        tool: "gh pr review",
        payload: { kind: "gh_pr_review", tool: "Bash", command: REVIEW, cwd: tmp, target: "12", body: "LGTM", event: "approve", truncated: false },
      },
    ]);
    expect(t.draftEvents().map((e) => [e.session_id, e.payload])).toEqual([[s.id, { draft_output_id: 1, tool: "gh pr review", summary: "gh pr review 12" }]]);
    expect(t.decisions()).toEqual([{ tool: "Bash", decision: "deny", reason: "draft_mode", command: REVIEW, tool_use_id: "toolu_1", draft_output_id: 1 }]);
  });

  it("records the run and its item when the session has a playbook_runs row (the newest one)", async () => {
    const t = setup();
    const pb = t.playbook();
    const s = await t.session(GH, { playbook: pb });
    const run = (item: string) =>
      Number(t.store.prepare("INSERT INTO playbook_runs (playbook, version, kind, session_id, item_ref) VALUES (?, 1, 'fire', ?, ?)").run(pb, s.id, item).lastInsertRowid);
    run("github:o/r#11");
    const newest = run("github:o/r#12");
    await s.bash(COMMENT);
    expect(t.drafts().map((d) => [d.playbook_run, d.item_ref])).toEqual([[newest, "github:o/r#12"]]);
  });

  it("records another outward Bash call (git push) as a command draft under the rail's action label", async () => {
    const t = setup();
    const s = await t.session(GH, { playbook: t.playbook() });
    expect((await s.bash("git push origin main")).permissionDecisionReason).toBe(draftDenyReason(1));
    expect(t.drafts().map((d) => [d.tool, d.payload])).toEqual([["git push", { kind: "command", tool: "Bash", command: "git push origin main", cwd: tmp, truncated: false }]]);
    expect(t.draftEvents().map((e) => e.payload["summary"])).toEqual(["git push"]);
  });

  it("a call the policy does not allow is denied by the policy, not drafted", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: [], allowedBashPrefixes: ["echo"] }, { playbook: t.playbook() });
    expect(await s.bash(REVIEW)).toEqual(denied("bash_prefix_not_allowed"));
    expect(t.drafts()).toEqual([]);
    expect(t.draftEvents()).toEqual([]);
  });
});

describe("a draft deny wins over grants (AC2)", () => {
  /** Hold the comment under a live playbook as approval 1; returns the playbook, switched to draft after `decision`. */
  async function grantedPlaybook(decision: "once" | "always") {
    const t = setup();
    const pb = t.playbook("live");
    const held = await t.session(GH, { playbook: pb });
    expect((await held.bash(COMMENT)).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    decideApproval(t.store, { id: 1, decision, by: "owner" }, new Date("2026-10-28T09:05:00.000Z"));
    t.store.prepare("UPDATE playbooks SET mode = 'draft' WHERE id = ?").run(pb);
    return { t, pb };
  }

  it("an always grant for gh pr comment is not used: the call is still denied draft_mode and recorded", async () => {
    const { t, pb } = await grantedPlaybook("always");
    const s = await t.session(GH, { playbook: pb });
    expect(await s.bash(COMMENT)).toEqual(denied(draftDenyReason(1)));
    expect(events(t.store, "approval_grant_used")).toEqual([]);
    expect(events(t.store, "approval_used")).toEqual([]);
    expect(t.drafts().map((d) => d.tool)).toEqual(["gh pr comment"]);
    expect(t.approvals()).toBe(1);
  });

  it("an unused once-approved grant for the exact payload is not consumed", async () => {
    const { t, pb } = await grantedPlaybook("once");
    const s = await t.session(GH, { playbook: pb });
    expect(await s.bash(COMMENT)).toEqual(denied(draftDenyReason(1)));
    expect(events(t.store, "approval_used")).toEqual([]);
    expect(events(t.store, "approval_grant_used")).toEqual([]);
    expect(t.store.prepare("SELECT status FROM approvals WHERE id = 1").pluck().get()).toBe("approved");
    expect(t.drafts()).toHaveLength(1);
  });
});

describe("the rail and the never boundary come before draft (AC3, AC7)", () => {
  it("denies gh pr merge merge_blocked as today, with and without the github grant, and writes no draft", async () => {
    for (const connectors of [undefined, ["github"] as const]) {
      const t = setup(connectors);
      const s = await t.session(GH, { playbook: t.playbook() });
      expect(await s.bash("gh pr merge 12")).toEqual(denied("merge_blocked"));
      expect(t.decisions()).toEqual([{ tool: "Bash", decision: "deny", reason: "merge_blocked", command: "gh pr merge 12", tool_use_id: "toolu_1" }]);
      expect(t.drafts()).toEqual([]);
      expect(t.draftEvents()).toEqual([]);
    }
  });

  it("a crew member whose never includes gh_pr_review is denied agent_boundary, and no draft row is written", async () => {
    const t = setup();
    const s = await t.session({ ...GH, never: ["gh_pr_review"] }, { playbook: t.playbook() });
    const reason = (await s.bash("gh pr review 12 --approve")).permissionDecisionReason;
    expect(reason).toMatch(/^agent_boundary: gh_pr_review is in this agent's never list\./);
    expect(t.decisions()).toEqual([expect.objectContaining({ reason: "agent_boundary", category: "gh_pr_review" })]);
    expect(t.drafts()).toEqual([]);
    expect(t.draftEvents()).toEqual([]);
  });

  it("a dry run of a draft playbook keeps its dry_run would-do: the comment is not recorded as a draft", async () => {
    const t = setup();
    const s = await t.session(GH, { playbook: t.playbook(), dryRun: true });
    const out = await s.bash(COMMENT);
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).not.toMatch(/^draft_mode/);
    expect(t.decisions()).toEqual([expect.objectContaining({ decision: "deny", reason: "dry_run" })]);
    expect(t.drafts()).toEqual([]);
    expect(t.draftEvents()).toEqual([]);
    expect(t.approvals()).toBe(0);
  });
});

describe("the GitHub CLI deny (AC4)", () => {
  it("denies gh pr view use_kernel_github_tools in a granted session, whether or not the policy allows it", async () => {
    for (const policy of [GH, { allowedTools: [], allowedBashPrefixes: ["echo"] }]) {
      const t = setup(["github"]);
      const s = await t.session(policy);
      expect(await s.bash("gh pr view 12")).toEqual(denied(GITHUB_CLI_DENY_REASON));
      expect(t.decisions()).toEqual([{ tool: "Bash", decision: "deny", reason: "use_kernel_github_tools", command: "gh pr view 12", tool_use_id: "toolu_1" }]);
      expect(t.drafts()).toEqual([]);
    }
    expect(GITHUB_CLI_DENY_REASON).toContain("kernel_github_pr_get, kernel_github_pr_diff, kernel_github_pr_files and kernel_github_pr_comments");
  });

  it("catches the program as the rail reads it (a path, another case) and leaves other programs alone", async () => {
    const t = setup(["github"]);
    const s = await t.session({ allowedTools: [], allowedBashPrefixes: ["/usr/bin/gh", "GH", "echo"] });
    expect((await s.bash("/usr/bin/gh pr view 12")).permissionDecisionReason).toBe(GITHUB_CLI_DENY_REASON);
    expect((await s.bash("GH pr view 12")).permissionDecisionReason).toBe(GITHUB_CLI_DENY_REASON);
    expect((await s.bash("echo gh pr view 12")).permissionDecision).toBe("allow");
  });

  it("an agent without the github grant may still run gh pr view", async () => {
    const t = setup();
    const s = await t.session(GH);
    expect((await s.bash("gh pr view 12")).permissionDecision).toBe("allow");
    expect(t.decisions()).toEqual([{ tool: "Bash", decision: "allow", reason: "bash_prefix_allowed", command: "gh pr view 12", tool_use_id: "toolu_1" }]);
  });

  it("a granted draft-mode session's comment is recorded as a draft, not denied use_kernel_github_tools", async () => {
    const t = setup(["github"]);
    const s = await t.session(GH, { playbook: t.playbook() });
    expect(await s.bash(COMMENT)).toEqual(denied(draftDenyReason(1)));
    expect(t.decisions().map((d) => d["reason"])).toEqual(["draft_mode"]);
    expect(t.drafts().map((d) => d.tool)).toEqual(["gh pr comment"]);
  });

  it("a granted session that is not draft is denied use_kernel_github_tools before the hold: no approval is written", async () => {
    const t = setup(["github"]);
    const s = await t.session(GH, { playbook: t.playbook("live") });
    expect((await s.bash(COMMENT)).permissionDecisionReason).toBe(GITHUB_CLI_DENY_REASON);
    expect(t.approvals()).toBe(0);
  });
});

describe("a non-draft session is unchanged (AC5)", () => {
  it("holds a chat turn's comment (no playbook, so no mode) as an approval", async () => {
    const t = setup();
    const s = await t.session(GH);
    expect((await s.bash(COMMENT)).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(t.approvals()).toBe(1);
    expect(t.drafts()).toEqual([]);
    expect(t.draftEvents()).toEqual([]);
  });

  it("holds a live playbook's comment as an approval (a stored live skips the draft step)", async () => {
    const t = setup();
    const s = await t.session(GH, { playbook: t.playbook("live") });
    expect((await s.bash(COMMENT)).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(t.drafts()).toEqual([]);
  });

  it("reads the playbook's mode afresh at each session start", async () => {
    const t = setup();
    const pb = t.playbook("live");
    expect((await (await t.session(GH, { playbook: pb })).bash(COMMENT)).permissionDecisionReason).toMatch(/^approval_required/);
    t.store.prepare("UPDATE playbooks SET mode = 'draft' WHERE id = ?").run(pb);
    expect((await (await t.session(GH, { playbook: pb })).bash(COMMENT)).permissionDecisionReason).toBe(draftDenyReason(1));
  });
});

describe("every outward kind is a draft, and the payload is bounded (AC8)", () => {
  it("records an always-held kernel tool as an input draft, never held", async () => {
    const t = setup();
    const tool = "mcp__kernel__kernel_playbook_enable";
    const s = await t.session({ allowedTools: [tool], allowedBashPrefixes: [] }, { playbook: t.playbook() });
    expect(await s.gate(tool, { id: 7 })).toEqual(denied(draftDenyReason(1)));
    expect(t.approvals()).toBe(0);
    expect(t.drafts().map((d) => [d.tool, d.payload])).toEqual([["kernel_playbook_enable", { kind: "input", tool, input_json: '{"id":7}', cwd: tmp, truncated: false }]]);
  });

  it("records a Write to ~/.claude/settings.json as an input draft, never held", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: ["Write"], allowedBashPrefixes: [] }, { playbook: t.playbook() });
    const input = { file_path: join(home, ".claude", "settings.json"), content: "{}" };
    expect((await s.gate("Write", input)).permissionDecisionReason).toBe(draftDenyReason(1));
    expect(t.approvals()).toBe(0);
    const [draft] = t.drafts();
    expect(draft?.tool).toMatch(/^Write /);
    expect(draft?.payload).toEqual({ kind: "input", tool: "Write", input_json: JSON.stringify(input), cwd: tmp, truncated: false });
  });

  it("cuts a tool input longer than MAX_DRAFT_TEXT_CHARS and says so", async () => {
    expect(MAX_DRAFT_TEXT_CHARS).toBe(65536);
    const t = setup();
    const s = await t.session({ allowedTools: ["Write"], allowedBashPrefixes: [] }, { playbook: t.playbook() });
    await s.gate("Write", { file_path: join(home, ".claude", "settings.json"), content: "x".repeat(70000) });
    const [draft] = t.drafts();
    expect(draft?.payload["kind"]).toBe("input");
    expect((draft?.payload["input_json"] as string).length).toBe(65536);
    expect(draft?.payload["truncated"]).toBe(true);
  });
});

describe("the draft write fails closed (AC9)", () => {
  it("denies kernel_gate_error and rolls back the row and the draft event when the decision write throws", async () => {
    const t = setup();
    const s = await t.session(GH, { playbook: t.playbook() });
    t.store
      .prepare(
        "CREATE TRIGGER t BEFORE INSERT ON events WHEN NEW.kind = 'tool_decision' AND json_extract(NEW.payload_json, '$.reason') = 'draft_mode' BEGIN SELECT RAISE(ABORT, 'test'); END",
      )
      .run();
    try {
      expect(await s.bash(COMMENT)).toEqual(denied("kernel_gate_error"));
      expect(t.drafts()).toEqual([]);
      expect(t.draftEvents()).toEqual([]);
      expect(t.decisions()).toEqual([{ tool: "Bash", decision: "deny", reason: "kernel_gate_error", command: COMMENT, tool_use_id: "toolu_1" }]);
    } finally {
      t.store.prepare("DROP TRIGGER t").run();
    }
  });

  it("denies kernel_gate_error when the draft_outputs table is gone", async () => {
    const t = setup();
    const s = await t.session(GH, { playbook: t.playbook() });
    t.store.prepare("ALTER TABLE draft_outputs RENAME TO draft_outputs_held").run();
    try {
      expect(await s.bash(COMMENT)).toEqual(denied("kernel_gate_error"));
      expect(t.draftEvents()).toEqual([]);
    } finally {
      t.store.prepare("ALTER TABLE draft_outputs_held RENAME TO draft_outputs").run();
    }
  });
});

describe("GET /drafts and GET /drafts/:id (AC6)", () => {
  const TOKEN = "ghp_PLANTED_TOKEN_0123456789abcdef";
  const KEYS = ["agent", "created_at", "id", "item_ref", "payload", "playbook", "playbook_run", "session", "tool"];
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env["GH_TOKEN"];
    process.env["GH_TOKEN"] = TOKEN;
  });
  afterEach(() => {
    if (savedToken === undefined) delete process.env["GH_TOKEN"];
    else process.env["GH_TOKEN"] = savedToken;
  });

  /** Four drafts: (wright, #12), (mason, #12), (wright, #13), (mason, #13), over two playbooks. */
  async function seeded() {
    const t = setup(["github"]);
    // The connector's setup: a row only (the token itself lives in the Keychain, never in the store).
    t.store.prepare("INSERT INTO connectors (kind, status, account_login) VALUES ('github', 'connected', 'octo')").run();
    const pbs = [t.playbook(), t.playbook()];
    const sessions = { wright: await t.session(GH, { playbook: pbs[0] as number }), mason: await t.session(GH, { playbook: pbs[1] as number, agent: "mason" }) };
    const at = "2026-10-28T09:00:00.000Z";
    const add = (agent: "wright" | "mason", item: string, body: string) =>
      recordDraftOutput(
        t.store,
        {
          session: sessions[agent].id,
          agent,
          playbook: agent === "wright" ? (pbs[0] as number) : (pbs[1] as number),
          playbookRun: null,
          itemRef: item,
          tool: "gh pr comment",
          payload: { kind: "gh_pr_comment", tool: "Bash", command: COMMENT, cwd: tmp, target: item.split("#")[1] ?? null, body, truncated: false },
        },
        at,
      ).id;
    const ids = [add("wright", "github:o/r#12", "a"), add("mason", "github:o/r#12", "b"), add("wright", "github:o/r#13", "c"), add("mason", "github:o/r#13", "d")];
    const route = (path: string) => draftsPart.routes.find((r) => r.path === path);
    const get = async (path: string, query: Record<string, string> = {}, params: Record<string, string> = {}) => {
      const res = await route(path)?.handler({ params, query, body: undefined, store: t.store, now: () => new Date(at) });
      return res as { status: number; body: Record<string, unknown> };
    };
    return { t, ids, pbs, get };
  }

  it("lists one item's drafts newest first, each with exactly the DraftOutput keys and no planted token", async () => {
    const { ids, get } = await seeded();
    const res = await get("/drafts", { item: "github:o/r#12" });
    expect(res.status).toBe(200);
    const drafts = res.body["drafts"] as Record<string, unknown>[];
    expect(drafts.map((d) => d["id"])).toEqual([ids[1], ids[0]]);
    for (const d of drafts) expect(Object.keys(d).sort()).toEqual(KEYS);
    expect(drafts[0]?.["payload"]).toMatchObject({ kind: "gh_pr_comment", body: "b" });
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });

  it("filters by agent and playbook, honours limit, and lists everything newest first with none", async () => {
    const { ids, pbs, get } = await seeded();
    const idsOf = async (query: Record<string, string>) => ((await get("/drafts", query)).body["drafts"] as { id: number }[]).map((d) => d.id);
    expect(await idsOf({})).toEqual([...ids].reverse());
    expect(await idsOf({ agent: "mason" })).toEqual([ids[3], ids[1]]);
    expect(await idsOf({ playbook: String(pbs[0]) })).toEqual([ids[2], ids[0]]);
    expect(await idsOf({ agent: "mason", item: "github:o/r#13" })).toEqual([ids[3]]);
    expect(await idsOf({ limit: "1" })).toEqual([ids[3]]);
    expect(await idsOf({ item: "github:o/r#99" })).toEqual([]);
  });

  it("answers 400 invalid_query for a bad agent, item, playbook or limit", async () => {
    const { get } = await seeded();
    const bad: Record<string, string>[] = [{ agent: "" }, { item: "" }, { agent: "a".repeat(513) }, { item: "i".repeat(513) }, { playbook: "0" }, { playbook: "abc" }, { playbook: "1.5" }, { limit: "0" }, { limit: "201" }, { limit: "abc" }, { limit: "-1" }];
    for (const query of bad) {
      const res = await get("/drafts", query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body).toEqual({ error: "invalid_query", message: expect.any(String) });
    }
    expect((await get("/drafts", { limit: "200" })).status).toBe(200);
  });

  it("returns one draft by id, 400 for a non-integer id and 404 no_draft for an unknown one", async () => {
    const { ids, get } = await seeded();
    const ok = await get("/drafts/:id", {}, { id: String(ids[2]) });
    expect(ok.status).toBe(200);
    const draft = ok.body["draft"] as Record<string, unknown>;
    expect(draft["id"]).toBe(ids[2]);
    expect(Object.keys(draft).sort()).toEqual(KEYS);
    expect(JSON.stringify(ok)).not.toContain(TOKEN);
    expect((await get("/drafts/:id", {}, { id: "abc" })).body).toEqual({ error: "invalid_query", message: expect.any(String) });
    expect((await get("/drafts/:id", {}, { id: "1.5" })).status).toBe(400);
    expect(await get("/drafts/:id", {}, { id: "999" })).toEqual({ status: 404, body: { error: "no_draft", message: "no draft 999" } });
  });

  it("reads a payload that is not JSON as null", async () => {
    const { t, get } = await seeded();
    t.store.prepare("UPDATE draft_outputs SET payload_json = 'not json' WHERE id = 1").run();
    expect(((await get("/drafts/:id", {}, { id: "1" })).body["draft"] as { payload: unknown }).payload).toBeNull();
  });
});
