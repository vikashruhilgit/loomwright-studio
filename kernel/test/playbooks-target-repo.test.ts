// Phase 8 item 20h: a ClickUp or Jira ticket playbook names its target
// repository. Migration 25 adds the nullable `playbooks.target_repo`; the store
// checks and versions it; the enable refuses a ticket playbook with none
// (`no_target_repo`) and any playbook whose repo the GitHub App does not reach
// (`target_repo_not_reachable`), before the hold and again in the kernel's
// apply, `enable_anyway` or not; and a live session's GitHub token is minted for
// it (`playbookRepos`). The tools' own shapes and the display are in
// playbooks-drafts-poll.test.ts. A temp data dir and a fixed clock: no daemon,
// no model, no network; the `connectors` and `mcp_connections` rows are seeded
// raw, as the poll tests do.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playbookRepos } from "../src/sessions/github-session-auth.js";
import { playbooksContribution } from "../src/playbooks/index.js";
import { EnableRefused, enableApproved } from "../src/playbooks/enable.js";
import { checkTargetRepo, targetRepoRefusal } from "../src/playbooks/target-repo.js";
import { PLAYBOOK_CHANGE_FIELDS, PLAYBOOK_POLICY_FIELDS, PlaybookError, createPlaybook, getPlaybook, listPlaybookVersions, updatePlaybook } from "../src/playbooks/store.js";
import type { CreatePlaybookParams } from "../src/playbooks/store.js";
import { DB_FILENAME, Store } from "../src/store/index.js";
import { migrations } from "../src/store/migrations/index.js";
import { playbookTargetRepo } from "../src/store/migrations/025_playbook_target_repo.js";
import { approvalApplierOf, heldToolCheckOf } from "../src/tools/server.js";
import type { KernelToolContext } from "../src/tools/server.js";

const NOW = new Date("2026-11-13T10:00:00.000Z");
const ENABLE_FULL = "mcp__kernel__kernel_playbook_enable";
const REPO = "vikashruhilgit/studio-sandbox";
const CLICKUP = JSON.stringify({ source: "clickup.tasks", filters: { list: "901" }, interval_seconds: 300 });
const JIRA = JSON.stringify({ source: "jira.issues", filters: { site: "acme.atlassian.net" }, interval_seconds: 300 });
const PULLS = (repo: string) => JSON.stringify({ source: "github.pulls", repos: [repo], filters: {}, interval_seconds: 300 });

let tmp: string;
let store: Store;
let n = 0;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-target-repo-"));
  store = new Store({ dataDir: tmp });
  store.prepare("INSERT INTO connectors (kind, status, reachable_repos_json) VALUES ('github', 'connected', ?)").run(JSON.stringify([REPO, "vikashruhilgit/other"]));
  store.prepare("INSERT INTO mcp_connections (kind, server_url, status) VALUES ('clickup', 'https://mcp.example.test', 'connected')").run();
  store.prepare("INSERT INTO mcp_connections (kind, server_url, status) VALUES ('jira', 'https://mcp.example.test', 'connected')").run();
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A draft with a done dry run at its version, its trigger `trigger` (`poll` spec text, or a cron). */
function draft(extra: Partial<CreatePlaybookParams> = {}, spec: string | "cron" = CLICKUP): number {
  const { playbook } = createPlaybook(
    store,
    {
      agent: "wright",
      name: `Tickets ${++n}`,
      intent: "Work each ticket and open a pull request; draft only.",
      trigger: spec === "cron" ? { kind: "cron", spec: "0 9 * * 1-5", tz: "UTC" } : { kind: "poll", spec },
      ...extra,
    },
    NOW,
  );
  store
    .prepare("INSERT INTO playbook_runs (playbook, version, kind, status, result_json, ended_at) VALUES (?, ?, 'dry_run', 'done', '{}', ?)")
    .run(playbook.id, playbook.version, NOW.toISOString());
  return playbook.id;
}

/** What the gate asks before it holds Wright's enable: the verdict, and how many approvals exist. */
function preHold(id: number, extra: Record<string, unknown> = {}): { refuse?: string; display?: string; subjectVersion?: number } & { approvals: number } {
  const sessions = { stopSession: async () => "stopped", getSession: (sid: number) => ({ id: sid, agent: "wright" }) } as unknown as KernelToolContext["sessions"];
  const check = heldToolCheckOf(playbooksContribution.tools ?? [], (sessionId) => ({ store, sessions, sessionId, now: () => NOW }));
  const verdict = (check(ENABLE_FULL, { id, idempotency_key: `e${id}`, ...extra }, 1) ?? {}) as { refuse?: string; display?: string; subjectVersion?: number };
  return { ...verdict, approvals: store.prepare<[], number>("SELECT count(*) FROM approvals").pluck().get() ?? 0 };
}

/** The kernel's apply of an approved enable, for the draft's current version. */
function applyApproved(id: number, extra: Record<string, unknown> = {}) {
  const row = getPlaybook(store, id);
  const apply = approvalApplierOf(playbooksContribution.tools ?? []);
  return apply(ENABLE_FULL, { id, idempotency_key: `e${id}`, ...extra }, { id: 1, sessionId: null, agent: "wright", subjectVersion: row?.version ?? null, requestedEventId: 1 }, store, NOW);
}

const columnsOf = (s: Store): string[] => s.prepare<[], string>("SELECT name FROM pragma_table_info('playbooks')").pluck().all();

describe("migration 25: playbooks.target_repo (AC1)", () => {
  it("is version 25, named playbook_target_repo, the last migration, and adds one nullable TEXT column with no default, no *_set_by and no trigger", () => {
    expect(migrations.at(-1)).toBe(playbookTargetRepo);
    expect([playbookTargetRepo.version, playbookTargetRepo.name]).toEqual([25, "playbook_target_repo"]);
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([25, "playbook_target_repo"]);
    const cols = columnsOf(store);
    expect(cols.at(-1)).toBe("target_repo");
    expect(cols).not.toContain("target_repo_set_by");
    expect(store.prepare("SELECT type, \"notnull\", dflt_value FROM pragma_table_info('playbooks') WHERE name = 'target_repo'").get()).toEqual({ type: "TEXT", notnull: 0, dflt_value: null });
    expect(store.prepare("SELECT sql FROM sqlite_master WHERE name = 'playbooks'").pluck().get()).not.toMatch(/CHECK/i);
    expect(store.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name <> 'events'").pluck().get()).toBe(0);
  });

  it("upgrades a v24 store: the column is added at the end, a row from before it reads null (never backfilled), a re-run is a no-op, and the integrity check passes", () => {
    const dir = join(tmp, "v24");
    const v24 = new Store({ dataDir: dir, migrations: migrations.slice(0, 24) });
    v24.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent) VALUES ('review', 'Review', 'wright', 'review PRs')").run();
    const before = columnsOf(v24);
    expect(before).not.toContain("target_repo");
    v24.close();

    const upgraded = new Store({ dataDir: dir });
    expect(columnsOf(upgraded)).toEqual([...before, "target_repo"]);
    expect(upgraded.prepare("SELECT slug, target_repo FROM playbooks").all()).toEqual([{ slug: "review", target_repo: null }]);
    upgraded.close();

    const db = new Database(join(dir, DB_FILENAME));
    db.exec("DELETE FROM schema_migrations WHERE version = 25");
    db.close();
    const rerun = new Store({ dataDir: dir });
    expect(rerun.appliedMigrations().map((m) => m.version).at(-1)).toBe(25);
    expect(columnsOf(rerun).filter((c) => c === "target_repo")).toEqual(["target_repo"]);
    expect(rerun.prepare("SELECT slug, target_repo FROM playbooks").all()).toEqual([{ slug: "review", target_repo: null }]);
    rerun.close();
  });
});

describe("the store keeps target_repo as a change field (AC1)", () => {
  it("is a change field, not a policy field: it is in PLAYBOOK_CHANGE_FIELDS and has no setter column", () => {
    expect(PLAYBOOK_CHANGE_FIELDS).toContain("target_repo");
    expect(PLAYBOOK_POLICY_FIELDS).not.toContain("target_repo" as never);
  });

  it("a create stores it as given, version 1's snapshot carries it, and a playbook that gives none stores null", () => {
    const id = draft({ target_repo: REPO });
    expect(getPlaybook(store, id)?.target_repo).toBe(REPO);
    expect((listPlaybookVersions(store, id)[0]?.snapshot as { target_repo?: unknown }).target_repo).toBe(REPO);
    expect(getPlaybook(store, draft({}, "cron"))?.target_repo).toBeNull();
    expect(getPlaybook(store, draft({ target_repo: "none" }, "cron"))?.target_repo).toBeNull();
  });

  it("an update changes it as the next version (in that version's snapshot and the event's fields), an unchanged re-save writes nothing, and none clears it", () => {
    const id = draft({ target_repo: REPO });
    const same = updatePlaybook(store, { id, agent: "wright", changes: { target_repo: REPO } }, NOW);
    expect(same.changed).toBe(false);
    expect(getPlaybook(store, id)?.version).toBe(1);

    const moved = updatePlaybook(store, { id, agent: "wright", changes: { target_repo: "vikashruhilgit/other" } }, NOW);
    expect(moved).toMatchObject({ changed: true, playbook: { version: 2, target_repo: "vikashruhilgit/other" } });
    expect((listPlaybookVersions(store, id)[1]?.snapshot as { target_repo?: unknown }).target_repo).toBe("vikashruhilgit/other");
    expect(store.prepare("SELECT payload_json FROM events WHERE kind = 'playbook_updated' ORDER BY id DESC LIMIT 1").pluck().get()).toContain('"fields":["target_repo"]');

    const cleared = updatePlaybook(store, { id, agent: "wright", changes: { target_repo: "none" } }, NOW);
    expect(cleared).toMatchObject({ changed: true, playbook: { version: 3, target_repo: null } });
    expect((listPlaybookVersions(store, id)[2]?.snapshot as { target_repo?: unknown }).target_repo).toBeNull();
    expect(updatePlaybook(store, { id, agent: "wright", changes: { target_repo: "none" } }, NOW).changed).toBe(false);
  });

  it("a value that is not owner/name, or has a . or .. part, is refused invalid_input naming target_repo, on a create and on an update, writing nothing", () => {
    const id = draft({ target_repo: REPO });
    const versions = listPlaybookVersions(store, id).length;
    for (const bad of ["studio-sandbox", "a/b/c", "owner/", "/name", "../name", "owner/..", "./x", "ow ner/name", "https://github.com/o/r", ""]) {
      const create = () => createPlaybook(store, { agent: "wright", name: "Bad", intent: "x", trigger: { kind: "cron", spec: "0 9 * * *", tz: "UTC" }, target_repo: bad }, NOW);
      expect(create, bad).toThrow(PlaybookError);
      expect(create, bad).toThrow(/^target_repo must be owner\/name/);
      expect(() => updatePlaybook(store, { id, agent: "wright", changes: { target_repo: bad } }, NOW), bad).toThrow(/^target_repo must be owner\/name/);
    }
    expect(listPlaybookVersions(store, id)).toHaveLength(versions);
    expect(store.prepare("SELECT count(*) FROM playbooks").pluck().get()).toBe(1);
    expect(() => checkTargetRepo(undefined)).toThrow(PlaybookError);
    expect(checkTargetRepo("Owner/Name.js")).toBe("Owner/Name.js");
  });
});

describe("the enable refuses a ticket playbook with no target repo, no_target_repo (AC3)", () => {
  it("a clickup.tasks playbook with none is refused before the hold with a plain sentence: no approval is written and it stays a draft", () => {
    const id = draft();
    const verdict = preHold(id);
    expect(verdict.display).toBeUndefined();
    expect(verdict.refuse).toMatch(/^kernel_playbook_enable: no_target_repo: playbook \d+ polls clickup\.tasks, which names no repository/);
    expect(verdict.refuse).toContain("set its target repository");
    expect(verdict.refuse).toContain("(nothing was held for the owner)");
    expect(verdict.approvals).toBe(0);
    expect(getPlaybook(store, id)?.status).toBe("draft");
  });

  it("a jira.issues playbook with none is refused the same way", () => {
    const verdict = preHold(draft({}, JIRA));
    expect(verdict.refuse).toContain("no_target_repo: ");
    expect(verdict.refuse).toContain("polls jira.issues");
    expect(verdict.approvals).toBe(0);
  });

  it("the enable_anyway flag skips only the charter gap: the call is still refused no_target_repo, before the hold and in the apply", () => {
    const id = draft();
    const verdict = preHold(id, { enable_anyway: true });
    expect(verdict.refuse).toContain("no_target_repo: ");
    expect(verdict.approvals).toBe(0);
    expect(applyApproved(id, { enable_anyway: true })).toMatchObject({ refused: "no_target_repo" });
    expect(getPlaybook(store, id)?.status).toBe("draft");
  });

  it("the kernel's apply refuses it too when the target repo was cleared after the hold (the approval's apply_refused), enabling nothing; with it set again the same enable is applied", () => {
    const id = draft({ target_repo: REPO });
    expect(preHold(id).display).toBeDefined();
    store.prepare("UPDATE playbooks SET target_repo = NULL WHERE id = ?").run(id);
    const outcome = applyApproved(id);
    expect(outcome).toMatchObject({ refused: "no_target_repo" });
    expect((outcome as { text: string }).text).toMatch(/^The kernel did not enable playbook tickets-\d+ \(#\d+\): no_target_repo \(playbook \d+ polls clickup\.tasks, which names no repository/);
    expect(getPlaybook(store, id)?.status).toBe("draft");
    expect(store.prepare("SELECT count(*) FROM events WHERE kind = 'playbook_enabled'").pluck().get()).toBe(0);
    store.prepare("UPDATE playbooks SET target_repo = ? WHERE id = ?").run(REPO, id);
    expect(applyApproved(id)).toMatchObject({ applied: expect.stringContaining("The kernel enabled playbook") });
    expect(getPlaybook(store, id)?.status).toBe("enabled");
  });

  it("enableApproved throws EnableRefused with the reason, writing nothing", () => {
    const id = draft();
    const attempt = () => enableApproved(store, { playbookId: id, agent: "wright", approval: { id: 1, requestedEventId: 1, subjectVersion: 1 }, sessionId: null, now: NOW });
    expect(attempt).toThrow(EnableRefused);
    try {
      attempt();
    } catch (err) {
      expect((err as EnableRefused).reason).toBe("no_target_repo");
    }
    expect(getPlaybook(store, id)?.status).toBe("draft");
  });

  it("the held display shows the target repo when the playbook has one, and is as it was when it has none", () => {
    expect(preHold(draft({ target_repo: REPO })).display?.split("\n")).toContain(`target_repo: ${REPO}`);
    expect(preHold(draft({}, PULLS(REPO))).display).not.toContain("target_repo");
  });

  it("a GitHub poll or a cron trigger with no target repo is not refused (only a ticket poll names no repository), and a cron playbook with a reachable one is held", () => {
    expect(preHold(draft({}, PULLS(REPO))).refuse).toBeUndefined();
    expect(preHold(draft({}, "cron")).refuse).toBeUndefined();
    const held = preHold(draft({ target_repo: REPO }, "cron"));
    expect(held.refuse).toBeUndefined();
    expect(held.subjectVersion).toBe(1);
  });
});

describe("the enable refuses a target repo the GitHub App does not reach, target_repo_not_reachable (AC4)", () => {
  it("a repo outside reachable_repos_json is refused before the hold, naming it: no approval is written", () => {
    const id = draft({ target_repo: "vikashruhilgit/not-reached" });
    const verdict = preHold(id);
    expect(verdict.display).toBeUndefined();
    expect(verdict.refuse).toMatch(/^kernel_playbook_enable: target_repo_not_reachable: target repository vikashruhilgit\/not-reached is not reachable \(the GitHub App does not reach it\)/);
    expect(verdict.approvals).toBe(0);
    expect(applyApproved(id)).toMatchObject({ refused: "target_repo_not_reachable" });
    expect(getPlaybook(store, id)?.status).toBe("draft");
  });

  it("no usable github connector row reads as not reachable, whatever the playbook's trigger", () => {
    const id = draft({ target_repo: REPO });
    expect(preHold(id).refuse).toBeUndefined();
    store.prepare("UPDATE connectors SET status = 'disconnected' WHERE kind = 'github'").run();
    expect(preHold(id).refuse).toContain("target_repo_not_reachable: target repository " + REPO + " is not reachable (no GitHub connector is connected)");
    store.prepare("DELETE FROM connectors").run();
    expect(preHold(draft({ target_repo: REPO }, "cron")).refuse).toContain("target_repo_not_reachable");
  });

  it("the match ignores case, and a repo made unreachable after the hold is refused in the kernel's apply (the playbook stays draft); reachable again, it is applied", () => {
    const id = draft({ target_repo: REPO.toUpperCase() });
    expect(preHold(id).display).toBeDefined();
    store.prepare("UPDATE connectors SET reachable_repos_json = ? WHERE kind = 'github'").run(JSON.stringify(["vikashruhilgit/other"]));
    const outcome = applyApproved(id);
    expect(outcome).toMatchObject({ refused: "target_repo_not_reachable" });
    expect((outcome as { text: string }).text).toContain(REPO.toUpperCase());
    expect(getPlaybook(store, id)?.status).toBe("draft");
    store.prepare("UPDATE connectors SET reachable_repos_json = ? WHERE kind = 'github'").run(JSON.stringify([REPO]));
    expect(applyApproved(id)).toMatchObject({ applied: expect.stringContaining("The kernel enabled playbook") });
  });

  it("enable_anyway does not skip it either", () => {
    const verdict = preHold(draft({ target_repo: "vikashruhilgit/not-reached" }), { enable_anyway: true });
    expect(verdict.refuse).toContain("target_repo_not_reachable: ");
    expect(verdict.approvals).toBe(0);
  });

  it("targetRepoRefusal decides no_target_repo first, then reach, and answers undefined for neither", () => {
    const noRepo = getPlaybook(store, draft());
    const unreachable = getPlaybook(store, draft({ target_repo: "o/zzz" }));
    const fine = getPlaybook(store, draft({ target_repo: REPO }));
    const plain = getPlaybook(store, draft({}, PULLS(REPO)));
    expect(targetRepoRefusal(store, noRepo!)?.reason).toBe("no_target_repo");
    expect(targetRepoRefusal(store, unreachable!)?.reason).toBe("target_repo_not_reachable");
    expect(targetRepoRefusal(store, fine!)).toBeUndefined();
    expect(targetRepoRefusal(store, plain!)).toBeUndefined();
  });
});

describe("a live session's GitHub token is minted for the target repo (AC2)", () => {
  it("a clickup.tasks playbook with a target repo mints for [target_repo], not no_repos; without one it still has no repos", () => {
    expect(playbookRepos(store, draft({ target_repo: REPO }))).toEqual([REPO]);
    expect(playbookRepos(store, draft())).toEqual([]);
    expect(playbookRepos(store, draft({}, JIRA))).toEqual([]);
  });

  it("a GitHub poll's repos and the target repo are deduplicated (case-insensitively), the poll's first", () => {
    expect(playbookRepos(store, draft({ target_repo: "vikashruhilgit/other" }, PULLS(REPO)))).toEqual([REPO, "vikashruhilgit/other"]);
    expect(playbookRepos(store, draft({ target_repo: REPO.toUpperCase() }, PULLS(REPO)))).toEqual([REPO]);
    expect(playbookRepos(store, draft({}, PULLS(REPO)))).toEqual([REPO]);
  });

  it("a cron playbook with a target repo has it, with neither it has none, and a missing playbook has none", () => {
    expect(playbookRepos(store, draft({ target_repo: REPO }, "cron"))).toEqual([REPO]);
    expect(playbookRepos(store, draft({}, "cron"))).toEqual([]);
    expect(playbookRepos(store, 9999)).toEqual([]);
  });
});
