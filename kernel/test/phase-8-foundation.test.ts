// Phase 8 item 01: the foundation's kernel pins. Closed sets that grew
// (connector kinds, poll sources, never categories), each new value refused by
// a named code until its item lands, and the poll source-adapter seam
// (`triggers/sources/github-pulls.ts`). The contract, feature, parts and
// migration pins are appended below by the same item's second half.
//
// Real reads over a temp data dir and the real validators; never the network.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentSettingsPath, readAgentSettings, validateCharter } from "../src/agents/index.js";
import { CONNECTOR_KINDS } from "../src/integrations/types.js";
import type { GitHubClient, GitHubPullSummary, PollSpec } from "../src/integrations/types.js";
import { PlaybookError, checkPolicyValue } from "../src/playbooks/index.js";
import { NEVER_CATEGORIES } from "../src/sessions/policy.js";
import { MAX_POLL_ITEMS, POLL_SOURCES, fetchPollItems, parsePollSpec } from "../src/triggers/index.js";
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

  it("POLL_SOURCES lists github.pulls and the four sources not built yet", () => {
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
  for (const source of ["github.issues", "github.pr_comments", "jira.issues", "clickup.tasks"]) {
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

describe("a playbook mode live is still refused live_mode_not_in_phase_6", () => {
  it("checkPolicyValue refuses live, with the code unchanged", () => {
    let thrown: unknown;
    try {
      checkPolicyValue("mode", "live", false);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PlaybookError);
    expect((thrown as PlaybookError).code).toBe("live_mode_not_in_phase_6");
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

  it("a jira or clickup entry in the array is connector_not_built (settings_invalid, field connectors), and writes nothing", () => {
    for (const kind of ["jira", "clickup"]) {
      write("mason", { ...BASE, connectors: ["github", kind] });
      const before = readFileSync(agentSettingsPath(tmp, "mason"), "utf8");
      const r = readAgentSettings(tmp, "mason");
      expect(r, kind).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
      expect(r.ok ? "" : r.message).toContain("connector_not_built");
      expect(readFileSync(agentSettingsPath(tmp, "mason"), "utf8")).toBe(before);
    }
    write("wright", { ...BASE, connectors: ["clickup"] });
    expect(readAgentSettings(tmp, "wright")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
  });

  it("a jira or clickup key in the object form is connector_not_built", () => {
    for (const kind of ["jira", "clickup"]) {
      write("mason", { ...BASE, connectors: { [kind]: "read" } });
      const r = readAgentSettings(tmp, "mason");
      expect(r, kind).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
      expect(r.ok ? "" : r.message).toContain("connector_not_built");
    }
  });

  it('connectors: {github: "write"} is github_write_not_built (settings_invalid, field connectors), for Wright and a crew member', () => {
    for (const id of ["wright", "mason"]) {
      write(id, { ...BASE, connectors: { github: "write" } });
      const r = readAgentSettings(tmp, id);
      expect(r, id).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
      expect(r.ok ? "" : r.message).toContain("github_write_not_built");
    }
  });

  it("any other object form is refused too, never read as no grant", () => {
    write("mason", { ...BASE, connectors: { github: "read" } });
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
    write("mason", { ...BASE, connectors: {} });
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors" });
  });

  it("an unknown kind keeps its entry path, and another bad field is still reported before the object form", () => {
    write("mason", { ...BASE, connectors: ["github", "slack"] });
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors.1" });
    write("mason", { ...BASE, permission_mode: "nope", connectors: { github: "write" } });
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "permission_mode" });
  });
});

describe("a charter naming a connector not built", () => {
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

  it("connectors [github] stays ok; jira or clickup is connector_not_built (charter_invalid, field connectors)", () => {
    const opts = { dataDir: join(tmp, "data"), homeDir: join(tmp, "home") };
    expect(validateCharter(charter(["github"]), opts)).toMatchObject({ ok: true });
    for (const kind of ["jira", "clickup"]) {
      const r = validateCharter(charter([kind]), opts);
      expect(r, kind).toMatchObject({ ok: false, error: "charter_invalid", field: "connectors" });
      expect(r.ok ? "" : r.message).toContain("connector_not_built");
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
