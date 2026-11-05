// Phase 8 item 01: the foundation's kernel pins. Closed sets that grew
// (connector kinds, poll sources, never categories), each new value refused by
// a named code until its item lands, and the poll source-adapter seam
// (`triggers/sources/github-pulls.ts`). The contract, feature, parts and
// migration pins are appended below by the same item's second half
// (`phase_8_foundation`: migration 20, the `automate` feature, the integrations
// parts and the app contract's phase 8 routes).
//
// Real reads over a temp data dir and the real validators; never the network.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentSettingsPath, readAgentSettings, validateCharter } from "../src/agents/index.js";
import { mergeConnectorsGrant, parseConnectorsGrant, parseMcpGrantValue } from "../src/agents/settings.js";
import { AUTOMATE_NAME, AUTOMATE_PARTS, automateContribution, automateContributionOf } from "../src/automate/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { INTEGRATIONS_PARTS, githubAppRoutesPart, integrationsContribution, mcpPart, repoPolicyPart } from "../src/integrations/index.js";
import { CONNECTOR_KINDS } from "../src/integrations/types.js";
import type { GitHubClient, GitHubPullSummary, PollSpec } from "../src/integrations/types.js";
import { rosterRoutes } from "../src/agents/roster.js";
import type { ContributedRouteResponse } from "../src/features/index.js";
import { PlaybookError, checkPolicyValue, createPlaybook, getPlaybook, setPlaybookPolicy, updatePlaybook } from "../src/playbooks/index.js";
import { enablePlaybook } from "../src/playbooks/store.js";
import { NEVER_CATEGORIES } from "../src/sessions/policy.js";
import { MAX_POLL_ITEMS, POLL_SOURCES, fetchPollItems, parsePollSpec } from "../src/triggers/index.js";
import { DB_FILENAME, Store, migrations } from "../src/store/index.js";
import { phase8Foundation } from "../src/store/migrations/020_phase_8_foundation.js";
import { playbookMergeRequirement } from "../src/store/migrations/021_playbook_merge_requirement.js";
import { TriggerError } from "../src/triggers/store.js";
import { fetchGithubPulls } from "../src/triggers/sources/github-pulls.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-phase-8-foundation-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Closed sets
// ---------------------------------------------------------------------------

describe("phase 8 closed sets", () => {
  it("CONNECTOR_KINDS is github, jira, clickup, frozen", () => {
    expect(CONNECTOR_KINDS).toEqual(["github", "jira", "clickup"]);
    expect(Object.isFrozen(CONNECTOR_KINDS)).toBe(true);
  });

  it("POLL_SOURCES lists the three GitHub sources and the two not built yet (jira.issues, clickup.tasks)", () => {
    expect(POLL_SOURCES).toEqual(["github.pulls", "github.issues", "github.pr_comments", "jira.issues", "clickup.tasks"]);
  });

  it("NEVER_CATEGORIES holds the two new categories after gh_pr_close, accepted, and stays frozen", () => {
    const at = NEVER_CATEGORIES.indexOf("gh_pr_close");
    expect(NEVER_CATEGORIES.slice(at, at + 4)).toEqual(["gh_pr_close", "gh_pr_request_reviewers", "gh_pr_comment_reply", "gh_issue_create"]);
    expect(Object.isFrozen(NEVER_CATEGORIES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Refusals by name
// ---------------------------------------------------------------------------

const REPOS = ["acme/widgets"];

describe("a poll source not built is refused poll_source_not_built (invalid_spec)", () => {
  for (const source of ["jira.issues", "clickup.tasks"]) {
    it(source, () => {
      const text = JSON.stringify({ source, repos: REPOS, filters: {}, interval_seconds: 300 });
      let thrown: unknown;
      try {
        parsePollSpec(text);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(TriggerError);
      expect((thrown as TriggerError).code).toBe("invalid_spec");
      expect((thrown as TriggerError).message.startsWith("poll_source_not_built:")).toBe(true);
    });
  }

  it("the three GitHub sources parse (github.issues and github.pr_comments since phase 8 item 05)", () => {
    for (const source of ["github.pulls", "github.issues", "github.pr_comments"]) {
      expect(parsePollSpec(JSON.stringify({ source, repos: REPOS, filters: {}, interval_seconds: 300 })).source).toBe(source);
    }
  });

  it("a source outside the closed list keeps the existing invalid_spec membership message, and github.pulls still parses", () => {
    expect(() => parsePollSpec(JSON.stringify({ source: "gitlab.mrs", repos: REPOS, interval_seconds: 300 }))).toThrow(/source must be one of/);
    expect(parsePollSpec(JSON.stringify({ source: "github.pulls", repos: REPOS, filters: { draft: false }, interval_seconds: 300 }))).toEqual({
      source: "github.pulls",
      repos: REPOS,
      filters: { draft: false },
      interval_seconds: 300,
    });
  });
});

describe("a playbook mode live is the owner's, and only on an enabled playbook", () => {
  const NOW = new Date("2026-11-03T10:00:00.000Z");
  const CRON = { kind: "cron", spec: "0 9 * * *", tz: "UTC" };
  const stores: Store[] = [];
  const open = (): Store => {
    const s = new Store({ dataDir: tmp });
    stores.push(s);
    return s;
  };
  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
  });
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (err) {
      return err instanceof PlaybookError ? err.code : `not a PlaybookError: ${String(err)}`;
    }
    return undefined;
  };

  it("checkPolicyValue refuses an agent's live live_mode_owner_only, and lets the owner's through", () => {
    let thrown: unknown;
    try {
      checkPolicyValue("mode", "live", false);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PlaybookError);
    expect((thrown as PlaybookError).code).toBe("live_mode_owner_only");
    expect(checkPolicyValue("mode", "live", true)).toBe("live");
    expect(checkPolicyValue("mode", "draft", false)).toBe("draft");
  });

  it("an agent's create or update with live is refused live_mode_owner_only and writes nothing", () => {
    const store = open();
    expect(codeOf(() => createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON, mode: "live" }, NOW))).toBe("live_mode_owner_only");
    expect(store.prepare("SELECT count(*) FROM playbooks").pluck().get()).toBe(0);
    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW);
    expect(codeOf(() => updatePlaybook(store, { id: playbook.id, agent: "wright", changes: { mode: "live" } }, NOW))).toBe("live_mode_owner_only");
    expect(getPlaybook(store, playbook.id)).toMatchObject({ mode: "draft", version: 1 });
  });

  it("the owner's live is refused live_needs_enable until the playbook is enabled; then it is stored as the next version, back to draft", () => {
    const store = open();
    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW);
    expect(codeOf(() => setPlaybookPolicy(store, { id: playbook.id, field: "mode", value: "live" }, NOW))).toBe("live_needs_enable");
    expect(getPlaybook(store, playbook.id)).toMatchObject({ mode: "draft", version: 1 });

    enablePlaybook(store, { id: playbook.id, version: 1, sessionId: null, approvalId: 1 }, NOW);
    const changed = setPlaybookPolicy(store, { id: playbook.id, field: "mode", value: "live" }, NOW);
    expect(changed.changed).toBe(true);
    expect(getPlaybook(store, playbook.id)).toMatchObject({ mode: "live", mode_set_by: "owner", status: "draft", version: 2 });

    // Re-setting an owner-set live is the existing no-op, not a refusal, though the playbook is a draft again.
    expect(setPlaybookPolicy(store, { id: playbook.id, field: "mode", value: "live" }, NOW).changed).toBe(false);
    expect(getPlaybook(store, playbook.id)?.version).toBe(2);
    // The owner may always set draft; a later agent edit of the owner's mode stays refused.
    expect(setPlaybookPolicy(store, { id: playbook.id, field: "mode", value: "draft" }, NOW).playbook.mode).toBe("draft");
  });
});

describe("agent settings connectors grants", () => {
  const BASE = { model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: [] } };
  const write = (id: string, content: Record<string, unknown>): void => {
    const file = agentSettingsPath(tmp, id);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  };

  it("connectors: [github] still reads ok, for Wright and a crew member", () => {
    write("wright", { ...BASE, connectors: ["github"] });
    write("mason", { ...BASE, connectors: ["github"] });
    for (const id of ["wright", "mason"]) {
      const r = readAgentSettings(tmp, id);
      expect(r.ok && r.settings.connectors, id).toEqual(["github"]);
    }
  });

  it("a jira or clickup entry in the array is refused: its grant names tools (settings_invalid, field connectors), and nothing is written", () => {
    for (const kind of ["jira", "clickup"]) {
      write("mason", { ...BASE, connectors: ["github", kind] });
      const before = readFileSync(agentSettingsPath(tmp, "mason"), "utf8");
      const r = readAgentSettings(tmp, "mason");
      expect(r, kind).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
      const message = r.ok ? "" : r.message;
      expect(message).toContain(`the ${kind} grant names its tools`);
      expect(message).not.toContain("connector_not_built");
      expect(readFileSync(agentSettingsPath(tmp, "mason"), "utf8")).toBe(before);
    }
    write("wright", { ...BASE, connectors: ["clickup"] });
    expect(readAgentSettings(tmp, "wright")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
  });

  it("a jira or clickup key in the object form reads ok with tool names, and is refused for anything else", () => {
    for (const kind of ["jira", "clickup"]) {
      for (const bad of ["read", "write", [], ["a", ""], ["a", 1], [""], "x", null, {}, ["a\u0000b"], [`${"x".repeat(201)}`]]) {
        write("mason", { ...BASE, connectors: { [kind]: bad } });
        const r = readAgentSettings(tmp, "mason");
        expect(r, `${kind} ${JSON.stringify(bad)}`).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
        expect(r.ok ? "" : r.message).not.toContain("connector_not_built");
      }
      write("mason", { ...BASE, connectors: { [kind]: ["get_issue", "create_issue"] } });
      const r = readAgentSettings(tmp, "mason");
      expect(r.ok && [r.settings.connectors, r.settings.mcpGrants, r.settings.githubWrite], kind).toEqual([[kind], { [kind]: ["get_issue", "create_issue"] }, undefined]);
    }
  });

  it("any mix of github, jira and clickup in the object form reads ok, github first; Wright reads it too", () => {
    for (const id of ["wright", "mason"]) {
      write(id, { ...BASE, connectors: { clickup: ["t"], github: "write", jira: ["a", "a", "b"] } });
      const r = readAgentSettings(tmp, id);
      expect(r.ok && [r.settings.connectors, r.settings.githubWrite, r.settings.mcpGrants], id).toEqual([["github", "jira", "clickup"], true, { jira: ["a", "b"], clickup: ["t"] }]);
    }
    write("mason", { ...BASE, connectors: { github: "read", jira: ["a"] } });
    const r = readAgentSettings(tmp, "mason");
    expect(r.ok && [r.settings.connectors, r.settings.githubWrite]).toEqual([["github", "jira"], undefined]);
  });

  it('connectors: {github: "write"} reads ok with connectors [github] and githubWrite true, for Wright and a crew member', () => {
    for (const id of ["wright", "mason"]) {
      write(id, { ...BASE, connectors: { github: "write" } });
      const r = readAgentSettings(tmp, id);
      expect(r.ok && r.settings.connectors, id).toEqual(["github"]);
      expect(r.ok && r.settings.githubWrite, id).toBe(true);
    }
  });

  it("the array form [github] reads as before, with no write", () => {
    write("mason", { ...BASE, connectors: ["github"] });
    const r = readAgentSettings(tmp, "mason");
    expect(r.ok && r.settings.connectors).toEqual(["github"]);
    expect(r.ok && "githubWrite" in r.settings).toBe(false);
    write("mason", { ...BASE });
    const none = readAgentSettings(tmp, "mason");
    expect(none.ok && none.settings.githubWrite).toBeUndefined();
  });

  it('an object form with {github: "write"} plus another key is refused too, and github_write_not_built no longer exists', () => {
    write("mason", { ...BASE, connectors: { github: "write", extra: "x" } });
    const r = readAgentSettings(tmp, "mason");
    expect(r).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
    expect(r.ok ? "" : r.message).not.toContain("github_write_not_built");
    write("mason", { ...BASE, connectors: { github: "write", jira: "read" } });
    const mixed = readAgentSettings(tmp, "mason") as { message: string };
    expect(mixed).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
    expect(mixed.message).toContain("jira must be a non-empty array of tool names");
    expect(mixed.message).not.toContain("connector_not_built");
  });

  it('{github: "read"} reads ok, as ["github"] with no write; any other object form is refused too, never read as no grant', () => {
    write("mason", { ...BASE, connectors: { github: "read" } });
    const r = readAgentSettings(tmp, "mason");
    expect(r.ok && [r.settings.connectors, r.settings.githubWrite, r.settings.mcpGrants]).toEqual([["github"], undefined, undefined]);
    for (const bad of [{}, { github: "admin" }, { github: true }, { github: ["github"] }, { slack: "read" }, { github: "read", slack: ["x"] }]) {
      write("mason", { ...BASE, connectors: bad });
      expect(readAgentSettings(tmp, "mason"), JSON.stringify(bad)).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
    }
    // A `__proto__` key is an unknown key (JSON.parse makes it an own property), never read.
    writeFileSync(agentSettingsPath(tmp, "mason"), JSON.stringify(BASE).replace(/}$/, ',"connectors":{"__proto__":["x"]}}'));
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
  });

  it("connector_not_built is emitted nowhere", () => {
    for (const connectors of [["jira"], { jira: "read" }, { slack: "x" }, { github: "write", jira: "read" }]) {
      write("mason", { ...BASE, connectors });
      expect((readAgentSettings(tmp, "mason") as { message: string }).message).not.toContain("connector_not_built");
    }
  });

  it("parseConnectorsGrant reads both forms and refuses by name", () => {
    expect(parseConnectorsGrant(["github"])).toMatchObject({ ok: true, grant: { connectors: ["github"], githubWrite: false, mcp: {} } });
    expect(parseConnectorsGrant({ github: "write", jira: ["a"] })).toMatchObject({ ok: true, grant: { connectors: ["github", "jira"], githubWrite: true, mcp: { jira: ["a"] } } });
    for (const bad of [undefined, null, "github", 3, [], [""], ["slack"], ["jira"], {}, { github: "x" }]) {
      const r = parseConnectorsGrant(bad);
      // An empty array is the one empty grant that reads ok.
      expect(r.ok, JSON.stringify(bad)).toBe(Array.isArray(bad) && bad.length === 0);
    }
  });

  it("an unknown kind keeps its entry path, and another bad field is still reported before the object form", () => {
    write("mason", { ...BASE, connectors: ["github", "slack"] });
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors.1" });
    write("mason", { ...BASE, permission_mode: "nope", connectors: { github: "write" } });
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "permission_mode" });
  });
});

describe("set connectors (the owner's route)", () => {
  const BASE = { model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: [] } };
  const NOW = new Date("2026-11-03T10:00:00.000Z");
  let store: Store;
  beforeEach(() => {
    const file = agentSettingsPath(tmp, "wright");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify(BASE, null, 2)}\n`);
    store = new Store({ dataDir: tmp });
  });
  afterEach(() => store.close());
  const set = async (value: string): Promise<ContributedRouteResponse> => {
    const route = rosterRoutes.find((r) => r.method === "POST" && r.path === "/agents/:id/set");
    if (route === undefined) throw new Error("no set route");
    return route.handler({ params: { id: "wright" }, query: {}, body: { field: "connectors", value }, store, now: () => NOW });
  };
  const fileJson = (): Record<string, unknown> => JSON.parse(readFileSync(agentSettingsPath(tmp, "wright"), "utf8")) as Record<string, unknown>;

  it("writes {github: write} to the file, which the reader then reads as githubWrite true; the event carries the object", async () => {
    const r = await set("github:write");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ field: "connectors", old: null, new: { github: "write" }, changed: true });
    expect(fileJson().connectors).toEqual({ github: "write" });
    const read = readAgentSettings(tmp, "wright");
    expect(read.ok && [read.settings.connectors, read.settings.githubWrite]).toEqual([["github"], true]);
    const logged = store.prepare<[], string>("SELECT payload_json FROM events WHERE kind = 'agent_settings_set'").pluck().all().map((p) => JSON.parse(p) as unknown);
    expect(logged).toEqual([{ id: "wright", field: "connectors", old: null, new: { github: "write" }, by: "owner" }]);
  });

  it("setting it again is changed:false; github downgrades to the array form; none removes the key", async () => {
    await set("github:write");
    expect((await set("github:write")).body).toMatchObject({ old: { github: "write" }, changed: false });
    expect((await set("github")).body).toMatchObject({ old: { github: "write" }, new: ["github"], changed: true });
    expect(fileJson().connectors).toEqual(["github"]);
    const back = readAgentSettings(tmp, "wright");
    expect(back.ok && back.settings.githubWrite).toBeUndefined();
    await set("github:write");
    expect((await set("none")).body).toMatchObject({ old: { github: "write" }, new: null, changed: true });
    expect("connectors" in fileJson()).toBe(false);
  });

  it("jira:<tool>,<tool> writes that kind's key and keeps the others; jira:none drops only that key; none clears all", async () => {
    await set("github:write");
    const r = await set("jira:get_issue,create_issue");
    expect(r.body).toMatchObject({ field: "connectors", old: { github: "write" }, new: { github: "write", jira: ["get_issue", "create_issue"] }, changed: true });
    expect(fileJson().connectors).toEqual({ github: "write", jira: ["get_issue", "create_issue"] });
    await set("clickup:list_tasks");
    expect(fileJson().connectors).toEqual({ github: "write", jira: ["get_issue", "create_issue"], clickup: ["list_tasks"] });
    // The same list again is no change; a new list replaces only that kind's.
    expect((await set("clickup:list_tasks")).body).toMatchObject({ changed: false });
    await set("jira:get_issue");
    expect(fileJson().connectors).toEqual({ github: "write", jira: ["get_issue"], clickup: ["list_tasks"] });
    const read = readAgentSettings(tmp, "wright");
    expect(read.ok && [read.settings.connectors, read.settings.githubWrite, read.settings.mcpGrants]).toEqual([["github", "jira", "clickup"], true, { jira: ["get_issue"], clickup: ["list_tasks"] }]);
    // github changes only github's level, and keeps the MCP keys.
    await set("github");
    expect(fileJson().connectors).toEqual({ github: "read", jira: ["get_issue"], clickup: ["list_tasks"] });
    expect((await set("jira:none")).body).toMatchObject({ changed: true });
    expect(fileJson().connectors).toEqual({ github: "read", clickup: ["list_tasks"] });
    expect((await set("jira:none")).body).toMatchObject({ changed: false });
    await set("clickup:none");
    expect(fileJson().connectors).toEqual(["github"]);
    await set("jira:a");
    expect((await set("none")).body).toMatchObject({ new: null, changed: true });
    expect("connectors" in fileJson()).toBe(false);
    // Dropping the last key of a file with no github removes the key.
    await set("jira:a");
    await set("jira:none");
    expect("connectors" in fileJson()).toBe(false);
    const logged = store.prepare<[], string>("SELECT payload_json FROM events WHERE kind = 'agent_settings_set' ORDER BY id").pluck().all().map((p) => JSON.parse(p) as { new: unknown });
    expect(logged[1]?.new).toEqual({ github: "write", jira: ["get_issue", "create_issue"] });
  });

  it("a malformed jira: or clickup: value gets its own message naming the <kind>:<tool> form, and writes nothing", async () => {
    for (const value of ["jira:", "jira:a,", "jira:,a", "jira:a,,b", "clickup:", `jira:${"x".repeat(201)}`, "jira:a\u0000b"]) {
      const r = await set(value);
      expect([r.status, r.body], value).toMatchObject([400, { error: "invalid_input", field: "connectors", message: expect.stringContaining("<kind>:<tool>[,<tool>…]") }]);
      expect((r.body as { message: string }).message).not.toBe("connectors must be github or none");
    }
    expect("connectors" in fileJson()).toBe(false);
  });

  it("parseMcpGrantValue and mergeConnectorsGrant: pure forms", () => {
    expect(parseMcpGrantValue("github")).toBeUndefined();
    expect(parseMcpGrantValue("slack:x")).toBeUndefined();
    expect(parseMcpGrantValue("jira:a,b")).toEqual({ change: { kind: "jira", tools: ["a", "b"] } });
    expect(parseMcpGrantValue("clickup:none")).toEqual({ change: { kind: "clickup", tools: null } });
    expect(mergeConnectorsGrant(undefined, { kind: "github", level: "read" })).toEqual(["github"]);
    expect(mergeConnectorsGrant(["github"], { kind: "github", level: "write" })).toEqual({ github: "write" });
    expect(mergeConnectorsGrant({ github: "write" }, { kind: "github", level: "read" })).toEqual(["github"]);
    expect(mergeConnectorsGrant(undefined, { kind: "jira", tools: ["a"] })).toEqual({ jira: ["a"] });
    expect(mergeConnectorsGrant(["github"], { kind: "jira", tools: ["a"] })).toEqual({ github: "read", jira: ["a"] });
    expect(mergeConnectorsGrant({ jira: ["a"] }, { kind: "jira", tools: null })).toBeNull();
    expect(mergeConnectorsGrant(undefined, { kind: "jira", tools: null })).toBeNull();
  });

  it("other values stay refused with the one message", async () => {
    for (const value of ["github:read", "github:", "GITHUB:write", "github:write "]) {
      const r = await set(value);
      expect([r.status, r.body]).toMatchObject([400, { error: "invalid_input", message: "connectors must be github or none" }]);
    }
    expect("connectors" in fileJson()).toBe(false);
  });
});

describe("a charter naming an owner-only MCP connector", () => {
  const charter = (connectors: unknown): Record<string, unknown> => ({
    id: "reviewer",
    display_name: "Reviewer",
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful reviewer who comments on pull requests.",
    duties: ["Review the pull requests the owner sends and comment on them."],
    boundaries: ["Never push code."],
    model: "claude-sonnet-5",
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [], never: ["git_push"] },
    limits: { tokens_per_day: 200000 },
    workspaces: [join(tmp, "work")],
    connectors,
  });

  it("connectors [github] stays ok; jira or clickup is owner-only (charter_invalid, field connectors)", () => {
    const opts = { dataDir: join(tmp, "data"), homeDir: join(tmp, "home") };
    expect(validateCharter(charter(["github"]), opts)).toMatchObject({ ok: true });
    for (const kind of ["jira", "clickup"]) {
      const r = validateCharter(charter([kind]), opts);
      expect(r, kind).toMatchObject({ ok: false, error: "charter_invalid", field: "connectors" });
      const message = r.ok ? "" : r.message;
      expect(message).toContain(`the ${kind} grant is owner-only: set it with studio agents set reviewer connectors ${kind}:<tool>`);
      expect(message).not.toContain("connector_not_built");
    }
    expect(validateCharter(charter(["github", "jira"]), opts)).toMatchObject({ ok: false, error: "charter_invalid", field: "connectors" });
  });
});

// ---------------------------------------------------------------------------
// The poll source-adapter seam
// ---------------------------------------------------------------------------

function pull(number: number, extra: Partial<GitHubPullSummary> = {}): GitHubPullSummary {
  return { number, title: `PR ${number}`, author: "ada", draft: false, head_sha: `sha${number}`, url: `https://example.test/pull/${number}`, updated_at: "2026-11-02T00:00:00Z", ...extra };
}

/** A client whose `listOpenPulls` answers per repo; the other methods are never called by a poll fetch. */
function clientOf(answers: Record<string, () => unknown>): GitHubClient {
  return { listOpenPulls: async (repo: string) => (answers[repo] ?? (() => ({ ok: true, data: [] })))() } as unknown as GitHubClient;
}

const SPEC = (repos: string[], filters: PollSpec["filters"] = {}): PollSpec => ({ source: "github.pulls", repos, filters, interval_seconds: 300 });

describe("the github.pulls source module", () => {
  it("lists repos in spec order, pulls by ascending number, deduped, with the kernel's own filters", async () => {
    const client = clientOf({
      "a/one": () => ({ ok: true, data: [pull(3), pull(1), pull(1), pull(2, { draft: true }), pull(0), { ...pull(9), head_sha: "" }] }),
      "b/two": () => ({ ok: true, data: [pull(5, { author: "bob" })] }),
    });
    const r = await fetchGithubPulls(client, SPEC(["a/one", "b/two"], { draft: false }));
    expect(r.ok && r.items.map((i) => i.ref)).toEqual(["github:a/one#1", "github:a/one#3", "github:b/two#5"]);
    expect(r.ok && r.items[0]).toEqual({ ref: "github:a/one#1", revision: "sha1", title: "PR 1", url: "https://example.test/pull/1", updated_at: "2026-11-02T00:00:00Z" });
    const authored = await fetchGithubPulls(client, SPEC(["a/one", "b/two"], { author: "bob" }));
    expect(authored.ok && authored.items.map((i) => i.ref)).toEqual(["github:b/two#5"]);
    const closed = await fetchGithubPulls(client, SPEC(["a/one"], { state: "closed" }));
    expect(closed).toEqual({ ok: true, items: [] });
  });

  it("the first failure stops it: rate_limited, http_error, unreachable, a throw and a non-list", async () => {
    const never = (): never => {
      throw new Error("the second repo must not be listed after a failure");
    };
    const cases: [() => unknown, unknown][] = [
      [() => ({ ok: false, error: "rate_limited", resets_at: "2026-11-02T01:00:00Z" }), { ok: false, error: "rate_limited", repo: "a/one", resets_at: "2026-11-02T01:00:00Z" }],
      [() => ({ ok: false, error: "http_error", status: 502 }), { ok: false, error: "http_error", repo: "a/one", status: 502 }],
      [() => ({ ok: false, error: "unreachable" }), { ok: false, error: "unreachable", repo: "a/one" }],
      [() => ({ ok: true, data: "nope" }), { ok: false, error: "client_error", repo: "a/one", message: "the listing is not a list" }],
    ];
    for (const [answer, expected] of cases) {
      expect(await fetchGithubPulls(clientOf({ "a/one": answer, "b/two": never }), SPEC(["a/one", "b/two"]))).toEqual(expected);
    }
    const thrower = clientOf({ "a/one": () => { throw new Error("boom"); }, "b/two": never });
    expect(await fetchGithubPulls(thrower, SPEC(["a/one", "b/two"]))).toEqual({ ok: false, error: "client_error", repo: "a/one", message: "boom" });
  });
});

describe("fetchPollItems keeps its signature and applies the cap", () => {
  it("is exported from triggers/index and caps at MAX_POLL_ITEMS with found counting every item", async () => {
    const many = Array.from({ length: MAX_POLL_ITEMS + 5 }, (_, i) => pull(i + 1));
    const r = await fetchPollItems(clientOf({ "a/one": () => ({ ok: true, data: many }) }), SPEC(["a/one"]));
    expect(r.ok && [r.items.length, r.found]).toEqual([MAX_POLL_ITEMS, MAX_POLL_ITEMS + 5]);
  });

  it("passes a source failure through unchanged", async () => {
    const r = await fetchPollItems(clientOf({ "a/one": () => ({ ok: false, error: "unreachable" }) }), SPEC(["a/one"]));
    expect(r).toEqual({ ok: false, error: "unreachable", repo: "a/one" });
  });

  it("the module file lives under triggers/sources/", () => {
    expect(existsSync(new URL("../src/triggers/sources/github-pulls.ts", import.meta.url))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The `automate` feature and the integrations parts `mcp` and `repo-policy`
// ---------------------------------------------------------------------------

describe("the automate feature (phase_8_foundation)", () => {
  it("is registered last, after gui, with the parts runner, tracker and routing in that order, all empty", () => {
    expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name).slice(-2)).toEqual(["gui", AUTOMATE_NAME]);
    expect(SHIPPED_CONTRIBUTIONS.at(-1)).toBe(automateContribution);
    expect(AUTOMATE_NAME).toBe("automate");
    expect(AUTOMATE_PARTS.map((p) => p.name)).toEqual(["runner", "tracker", "routing"]);
    expect(Object.isFrozen(AUTOMATE_PARTS)).toBe(true);
    for (const part of AUTOMATE_PARTS) {
      expect(part.tools, part.name).toEqual([]);
      expect(part.routes, part.name).toEqual([]);
      expect(part.handlers, part.name).toEqual({});
      expect(part.dueWork ?? [], part.name).toEqual([]);
      expect(part.subcommands ?? [], part.name).toEqual([]);
    }
    expect(Object.keys(automateContribution)).toEqual(["name"]);
    expect(Object.isFrozen(automateContribution)).toBe(true);
  });

  it("merges with the shipped features and adds no tool, route, subcommand, handler or due work", () => {
    const withIt = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED);
    const without = mergeContributions(SHIPPED_CONTRIBUTIONS.slice(0, -1), PHASE1_RESERVED);
    expect(withIt.contributors).toEqual([...without.contributors, "automate"]);
    expect(withIt.tools.map((t) => t.name)).toEqual(without.tools.map((t) => t.name));
    const routeKeys = (m: typeof withIt): string[] => m.routes.map((r) => `${r.owner} ${r.method} ${r.path}`);
    expect(routeKeys(withIt)).toEqual(routeKeys(without));
    expect(withIt.subcommands.map((c) => c.name)).toEqual(without.subcommands.map((c) => c.name));
    expect(withIt.dueWork.map((d) => d.run)).toEqual(without.dueWork.map((d) => d.run));
  });

  it("builds a contribution named automate from the parts it is given, with the console's handler-conflict check", () => {
    const part = (name: string): (typeof AUTOMATE_PARTS)[number] => Object.freeze({ name, tools: Object.freeze([]), routes: Object.freeze([]), handlers: Object.freeze({ message: () => undefined }) });
    expect(automateContributionOf([]).name).toBe("automate");
    expect(() => automateContributionOf([part("a"), part("b")])).toThrow(/a.*b|b.*a/);
  });
});

describe("the integrations parts mcp and repo-policy (phase_8_foundation)", () => {
  it("sit before github-app-routes, which stays last; mcp (item 06) and repo-policy (item 08) are filled", () => {
    expect(INTEGRATIONS_PARTS.map((p) => p.name).slice(-3)).toEqual(["mcp", "repo-policy", "github-app-routes"]);
    expect(INTEGRATIONS_PARTS.at(-1)).toBe(githubAppRoutesPart);
    for (const part of [mcpPart, repoPolicyPart]) {
      expect(INTEGRATIONS_PARTS).toContain(part);
      expect(Object.isFrozen(part), part.name).toBe(true);
      expect(part.tools, part.name).toEqual([]);
      expect(part.handlers, part.name).toEqual({});
      expect(part.subcommands ?? [], part.name).toEqual([]);
    }
    // `repo-policy` is filled by item 08: exactly its three owner routes, no tool (so no agent can set a policy) and no due work.
    expect(repoPolicyPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /repos/policy",
      "POST /repos/policy/:owner/:repo/detect",
      "POST /repos/policy/:owner/:repo",
    ]);
    expect(repoPolicyPart.dueWork ?? []).toEqual([]);
    // `mcp` is filled: its three owner routes and the token renewal.
    expect(mcpPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /connectors/mcp/:kind/connect",
      "POST /connectors/mcp/:kind/connect/cancel",
      "POST /connectors/mcp/:kind/disconnect",
    ]);
    expect(mcpPart.dueWork).toHaveLength(1);
  });

  it("claim no handler kind, so the shipped integrations contribution still merges and keeps its name", () => {
    expect(integrationsContribution.name).toBe("integrations");
  });
});

// ---------------------------------------------------------------------------
// Migration 020: phase_8_foundation
// ---------------------------------------------------------------------------

describe("migration 20: phase_8_foundation", () => {
  const stores: Store[] = [];
  const open = (): Store => {
    const s = new Store({ dataDir: tmp });
    stores.push(s);
    return s;
  };
  afterEach(() => {
    for (const s of stores.splice(0)) {
      try {
        s.close();
      } catch {
        // already closed
      }
    }
  });
  const columnsOf = (s: Store, table: string): string[] => s.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck().all(table);

  it("is version 20, named phase_8_foundation, directly below 21 (playbook_merge_requirement, last), and the list is contiguous from 1", () => {
    expect([phase8Foundation.version, phase8Foundation.name]).toEqual([20, "phase_8_foundation"]);
    expect(migrations.at(-2)).toBe(phase8Foundation);
    expect(migrations.at(-1)).toBe(playbookMergeRequirement);
    expect(migrations.map((m) => m.version)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it("creates repo_policies, pr_tracks and mcp_connections with exactly the requirement's columns", () => {
    const store = open();
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([21, "playbook_merge_requirement"]);
    expect(columnsOf(store, "repo_policies")).toEqual(["id", "repo", "policy_kind", "required_reviews", "trust_unprotected", "detected_json", "set_by", "set_at"]);
    expect(columnsOf(store, "pr_tracks")).toEqual([
      "id",
      "repo",
      "number",
      "head_sha",
      "state",
      "ticket_ref",
      "approvals",
      "required",
      "ci_state",
      "owner_kind",
      "run_file",
      "item_id",
      "merged_by_gate",
      "updated",
    ]);
    expect(columnsOf(store, "mcp_connections")).toEqual(["id", "kind", "server_url", "status", "granted_tools", "token_expiry"]);
  });

  it("has no SQL CHECK and no SQL trigger: the value sets are closed in code", () => {
    const store = open();
    for (const table of ["repo_policies", "pr_tracks", "mcp_connections"]) {
      const sql = store.prepare<[string], string>("SELECT sql FROM sqlite_master WHERE name = ?").pluck().get(table) ?? "";
      expect(sql, table).not.toMatch(/CHECK/i);
    }
    expect(store.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name <> 'events'").pluck().get()).toBe(0);
  });

  it("is safe to re-run: with its record deleted (and 21's, which sits above it), migration 20 runs again as a no-op and every row stays", () => {
    const first = open();
    first.prepare("INSERT INTO repo_policies (repo, policy_kind, required_reviews, set_by) VALUES ('acme/widgets', 'reviews', 2, 'owner')").run();
    first.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, owner_kind) VALUES ('acme/widgets', 7, 'abc', 'open', 'automate_live')").run();
    first.prepare("INSERT INTO mcp_connections (kind, server_url, status) VALUES ('jira', 'https://mcp.example.test', 'connected')").run();
    first.close();

    const db = new Database(join(tmp, DB_FILENAME));
    // Deleting 20 alone would leave 21 above a gap: 20 and 21 re-run together.
    db.exec("DELETE FROM schema_migrations WHERE version >= 20");
    db.close();

    const rerun = open();
    expect(rerun.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([21, "playbook_merge_requirement"]);
    expect(rerun.prepare("SELECT repo, policy_kind, required_reviews, trust_unprotected FROM repo_policies").all()).toEqual([{ repo: "acme/widgets", policy_kind: "reviews", required_reviews: 2, trust_unprotected: 0 }]);
    expect(rerun.prepare("SELECT repo, number, approvals, merged_by_gate FROM pr_tracks").all()).toEqual([{ repo: "acme/widgets", number: 7, approvals: 0, merged_by_gate: 0 }]);
    expect(rerun.prepare("SELECT kind, status FROM mcp_connections").all()).toEqual([{ kind: "jira", status: "connected" }]);
  });
});

// ---------------------------------------------------------------------------
// The app contract's phase 8 routes (read as text, like console-contract.test.ts)
// ---------------------------------------------------------------------------

describe("the app contract declares phase 8's routes and shapes (p8-item-NN)", () => {
  const contract = readFileSync(new URL("../../app/src/api/contract.ts", import.meta.url), "utf8");

  it("adds the three origins to RouteOrigin", () => {
    for (const origin of ["p8-item-03", "p8-item-06", "p8-item-08"]) expect(contract).toContain(`| "${origin}"`);
  });

  it("declares the shapes the routes use, and ConnectorKind gains jira and clickup", () => {
    for (const name of ["GitHubAppUpgradeResponse", "McpConnectionKind", "McpConnection", "McpConnectResponse", "RepoPolicyKind", "RepoPolicy", "RepoPoliciesResponse", "RepoPolicySetBody", "PrTrack", "PrOwnerKind"]) {
      expect(contract, name).toMatch(new RegExp(`export (type|interface) ${name}\\b`));
    }
    expect(contract).toContain('export type RepoPolicyKind = "solo" | "studio_approval" | "reviews";');
    expect(contract).toContain('export type PrOwnerKind = "automate_live" | "automate_parked" | "owner" | "other";');
    expect(contract).toContain('export type ConnectorKind = "github" | "jira" | "clickup";');
  });
});
