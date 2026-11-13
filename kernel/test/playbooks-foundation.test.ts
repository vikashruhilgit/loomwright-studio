// The playbooks feature's foundation (phase 3): one `playbooks` contribution
// built from four sub-file parts (`drafts`, `dry-run`, `enable`, `runs`),
// registered sixth in `SHIPPED_CONTRIBUTIONS`; `drafts` is filled in (item 02:
// four tools, four routes, four `studio playbooks` verbs and one due-work
// function), so are `dry-run` and `enable` (item 07: one tool each) and so is
// `runs` (item 08: the run-now route and the `run` verb); the part merge refuses a
// verb or handler kind two parts claim; the closed value sets migration 13's
// TEXT columns hold. A temp data dir with a hand-written `api.json`, a stub
// Keychain and a stub fetch that fails the test if called: never a daemon.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { USAGE, runCli } from "../src/cli/index.js";
import { setRepoPolicy } from "../src/integrations/github/repo-policy.js";
import type { CliDeps } from "../src/cli/index.js";
import { ContributionConflictError, InvalidContributionError, PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { CliApiClient, ContributedRoute } from "../src/features/index.js";
import {
  DEDUPE_KEY_FIELDS,
  PLAYBOOKS_HELP,
  PLAYBOOK_PARTS,
  PLAYBOOK_PRIORITIES,
  PLAYBOOK_RUN_KINDS,
  PLAYBOOK_STATUSES,
  POLICY_SETTERS,
  draftsPart,
  dryRunPart,
  enablePart,
  mergePlaybookParts,
  playbooksContribution,
  playbooksContributionOf,
  runsPart,
} from "../src/playbooks/index.js";
import type { PlaybookPart, PlaybookVerb } from "../src/playbooks/index.js";
import { EnableRefused, enableApproved } from "../src/playbooks/enable.js";
import { createPlaybook, getPlaybook, parseMergeRequirement, setPlaybookPolicy } from "../src/playbooks/store.js";
import { MERGE_REQUIREMENT_KINDS, PLAYBOOK_MODES } from "../src/playbooks/types.js";
import { Store } from "../src/store/index.js";
import { approvalApplierOf, heldToolCheckOf } from "../src/tools/server.js";
import type { KernelToolContext } from "../src/tools/server.js";

let tmp: string;
let dataDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-playbooks-"));
  dataDir = join(tmp, "data");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeApiInfo(dir: string = tmp): string {
  writeFileSync(join(dir, "api.json"), JSON.stringify({ port: 1, host: "127.0.0.1", pid: process.pid, started_at: "x" }));
  return dir;
}

/** `studio <argv>` with the shipped contributions (unless given), a live api.json pid, and no Keychain or API reachable. */
async function studio(argv: string[], overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const reads: string[] = [];
  const fetches: string[] = [];
  const code = await runCli(argv, {
    dataDir: writeApiInfo(),
    isPidAlive: () => true,
    keychain: {
      read: (service) => {
        reads.push(service);
        return "unused";
      },
    },
    fetch: (async (input: unknown) => {
      fetches.push(String(input));
      throw new Error("the playbooks shell must not call the API");
    }) as typeof fetch,
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
    ...overrides,
  });
  return { code, stdout: out.join(""), stderr: err.join(""), reads, fetches };
}

const emptyPart = (name: string, extra: Partial<PlaybookPart> = {}): PlaybookPart => ({ name, tools: [], routes: [], verbs: [], handlers: {}, ...extra });

const verb = (name: string, seen: string[][] = []): PlaybookVerb => ({
  name,
  help: `studio playbooks ${name} <id>`,
  run: async (args) => {
    seen.push([name, ...args]);
    return 7;
  },
});

const noClient: CliApiClient = {
  request: async () => {
    throw new Error("no API in this test");
  },
};

describe("the playbooks contribution (AC4)", () => {
  it("is the sixth shipped contribution (the full order is pinned in feature-seams.test.ts): the parts' tools in part order, the drafts part's four routes and one due-work function, the runs part's route, and the playbooks subcommand; no handler", () => {
    expect(SHIPPED_CONTRIBUTIONS[5]).toBe(playbooksContribution);
    expect(playbooksContribution.name).toBe("playbooks");
    expect(Object.isFrozen(playbooksContribution)).toBe(true);
    expect(Object.keys(playbooksContribution)).toEqual(["name", "tools", "routes", "subcommands", "dueWork"]);
    const merged = mergeContributions([playbooksContribution], PHASE1_RESERVED);
    // Each part's tools, merged in part order (each part's own list is pinned in the next test).
    expect(merged.tools).toEqual(PLAYBOOK_PARTS.flatMap((p) => [...p.tools]));
    expect(merged.tools.map((t) => t.name)).toEqual([
      "kernel_playbook_create",
      "kernel_playbook_update",
      "kernel_playbook_list",
      "kernel_playbook_disable",
      "kernel_playbook_dry_run",
      "kernel_playbook_enable",
    ]);
    expect(merged.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /playbooks", "GET /playbooks/:ref", "POST /playbooks/:id/set", "POST /playbooks/:id/off", "POST /playbooks/:id/run"]);
    expect(merged.subcommands.map((s) => [s.name, s.help])).toEqual([["playbooks", PLAYBOOKS_HELP]]);
    expect(merged.handlers).toEqual({});
    expect(merged.dueWork.map((d) => d.owner)).toEqual(["playbooks"]);
    expect(merged.dueWork.map((d) => d.run)).toEqual([...(draftsPart.dueWork ?? [])]);
  });

  it("the subcommand has the drafts part's four verbs and the runs part's run on one help line (at most 200 characters), each verb's own help unchanged", () => {
    expect(PLAYBOOKS_HELP).toBe("studio playbooks <verb> | list [--all] [--json] | show <id|slug> [--json] | set <id> <field> <value> | off <id> | run <id>");
    expect(PLAYBOOKS_HELP.length).toBeLessThanOrEqual(200);
    expect(mergePlaybookParts(PLAYBOOK_PARTS).verbs.map((v) => v.name)).toEqual(["list", "show", "set", "off", "run"]);
    expect(mergePlaybookParts(PLAYBOOK_PARTS).verbs.map((v) => v.help)).toEqual([
      "studio playbooks list [--all] [--json]",
      "studio playbooks show <id|slug> [--json]",
      "studio playbooks set <id> <field> <value>",
      "studio playbooks off <id>",
      "studio playbooks run <id>",
    ]);
  });

  it("is built from four frozen parts, in order: drafts (item 02), dry-run and enable (item 07), then runs (item 08)", () => {
    expect(PLAYBOOK_PARTS).toEqual([draftsPart, dryRunPart, enablePart, runsPart]);
    expect(PLAYBOOK_PARTS.map((p) => p.name)).toEqual(["drafts", "dry-run", "enable", "runs"]);
    expect(Object.isFrozen(PLAYBOOK_PARTS)).toBe(true);
    for (const part of PLAYBOOK_PARTS) expect(Object.isFrozen(part), part.name).toBe(true);
    expect({
      tools: draftsPart.tools.map((t) => t.name),
      routes: draftsPart.routes.map((r) => `${r.method} ${r.path}`),
      verbs: draftsPart.verbs.map((v) => v.name),
      handlers: draftsPart.handlers,
      dueWork: draftsPart.dueWork?.length,
    }).toEqual({
      tools: ["kernel_playbook_create", "kernel_playbook_update", "kernel_playbook_list", "kernel_playbook_disable"],
      routes: ["GET /playbooks", "GET /playbooks/:ref", "POST /playbooks/:id/set", "POST /playbooks/:id/off"],
      verbs: ["list", "show", "set", "off"],
      handlers: {},
      dueWork: 1,
    });
    // Item 07's two parts: one tool each, nothing else.
    for (const [part, name] of [
      [dryRunPart, "kernel_playbook_dry_run"],
      [enablePart, "kernel_playbook_enable"],
    ] as const) {
      expect({ tools: part.tools.map((t) => t.name), routes: part.routes, verbs: part.verbs, handlers: part.handlers, dueWork: part.dueWork ?? [] }, part.name).toEqual({
        tools: [name],
        routes: [],
        verbs: [],
        handlers: {},
        dueWork: [],
      });
    }
    // Item 08's runs part: the run-now route and the `run` verb, no tool.
    expect({
      tools: runsPart.tools,
      routes: runsPart.routes.map((r) => `${r.method} ${r.path}`),
      verbs: runsPart.verbs.map((v) => [v.name, v.help]),
      handlers: runsPart.handlers,
      dueWork: runsPart.dueWork ?? [],
    }).toEqual({ tools: [], routes: ["POST /playbooks/:id/run"], verbs: [["run", "studio playbooks run <id>"]], handlers: {}, dueWork: [] });
    expect(mergePlaybookParts(PLAYBOOK_PARTS).dueWork).toEqual([...(draftsPart.dueWork ?? [])]);
  });

  it("pins the closed value sets migration 13's (and 17's) TEXT columns hold", () => {
    expect(PLAYBOOK_STATUSES).toEqual(["draft", "enabled", "disabled"]);
    expect(PLAYBOOK_PRIORITIES).toEqual(["low", "normal", "high"]);
    expect(PLAYBOOK_RUN_KINDS).toEqual(["dry_run", "fire", "run_now"]);
    expect(DEDUPE_KEY_FIELDS).toEqual(["playbook.id", "playbook.version", "trigger.id", "trigger.scheduled_at", "date", "item.id", "item.revision"]);
    expect(POLICY_SETTERS).toEqual(["wright", "owner"]);
    expect(PLAYBOOK_MODES).toEqual(["draft", "live"]);
    for (const list of [PLAYBOOK_STATUSES, PLAYBOOK_PRIORITIES, PLAYBOOK_RUN_KINDS, DEDUPE_KEY_FIELDS, POLICY_SETTERS, PLAYBOOK_MODES]) expect(Object.isFrozen(list)).toBe(true);
  });
});

describe("studio playbooks (AC4)", () => {
  it("with no verb, or help: the help on stdout, 0; no Keychain read, no API call", async () => {
    for (const argv of [["playbooks"], ["playbooks", "help"]]) {
      const r = await studio(argv);
      expect(r, argv.join(" ")).toMatchObject({ code: 0, stdout: `${PLAYBOOKS_HELP}\n`, stderr: "" });
      expect(r.reads).toEqual([]);
      expect(r.fetches).toEqual([]);
    }
  });

  it("an unknown verb: one line naming it, then the help, on stderr; 2", async () => {
    const r = await studio(["playbooks", "nope", "1"]);
    expect(r).toMatchObject({ code: 2, stdout: "", stderr: `studio playbooks: unknown verb "nope"\n${PLAYBOOKS_HELP}\n` });
    expect(r.reads).toEqual([]);
    expect(r.fetches).toEqual([]);
  });

  it("passes the api.json pid check first, like every contributed subcommand: a dead pid or no api.json never runs it", async () => {
    const dead = await studio(["playbooks"], { isPidAlive: () => false });
    expect(dead.code).toBe(1);
    expect(dead.stdout).toBe("");
    expect(dead.stderr).toMatch(/^studio: kernel daemon is not running \(pid \d+ in .*api\.json is gone\)\n$/);
    const missing = await studio(["playbooks", "nope"], { dataDir: join(tmp, "elsewhere") });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).not.toContain("unknown verb");
    expect(missing.reads).toEqual([]);
  });

  it("the help line is one whole entry of studio's usage text (wherever a later feature puts its own after it)", async () => {
    const r = await studio(["nope"]);
    expect(r.code).toBe(2);
    expect(r.stderr.startsWith(`${USAGE} | `)).toBe(true);
    expect(r.stderr.endsWith("\n")).toBe(true);
    expect(` | ${r.stderr.slice(0, -1)} | `).toContain(` | ${PLAYBOOKS_HELP} | `);
  });
});

describe("mergePlaybookParts", () => {
  it("joins tools and routes in part order and the parts' verbs and handlers", () => {
    const tool = (name: string) => defineTool({ name, description: "test tool", shape: { id: z.number() }, handler: () => ({}) });
    const route: ContributedRoute = { method: "GET", path: "/playbooks", handler: async () => ({ status: 200, body: {} }) };
    const handler = () => {};
    const merged = mergePlaybookParts([
      emptyPart("a", { tools: [tool("kernel_playbook_a")], verbs: [verb("one")] }),
      emptyPart("b", { tools: [tool("kernel_playbook_b")], routes: [route], verbs: [verb("two")], handlers: { message: handler } }),
    ]);
    expect(merged.tools.map((t) => t.name)).toEqual(["kernel_playbook_a", "kernel_playbook_b"]);
    expect(merged.routes).toEqual([route]);
    expect(merged.verbs.map((v) => v.name)).toEqual(["one", "two"]);
    expect(merged.handlers).toEqual({ message: handler });
  });

  it("a verb claimed by two parts is refused, naming both parts", () => {
    let err: unknown;
    try {
      mergePlaybookParts([emptyPart("drafts", { verbs: [verb("show")] }), emptyPart("dry-run"), emptyPart("runs", { verbs: [verb("show")] })]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect((err as ContributionConflictError).part).toBe("subcommand");
    expect((err as ContributionConflictError).conflictName).toBe("playbooks show");
    expect((err as ContributionConflictError).owners).toEqual(["drafts", "runs"]);
    expect((err as Error).message).toContain("drafts");
  });

  it("a handler kind claimed by two parts is refused, naming both parts", () => {
    let err: unknown;
    try {
      mergePlaybookParts([emptyPart("enable", { handlers: { message: () => {} } }), emptyPart("runs", { handlers: { message: () => {} } })]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect((err as ContributionConflictError).part).toBe("handler");
    expect((err as ContributionConflictError).conflictName).toBe("message");
    expect((err as ContributionConflictError).owners).toEqual(["enable", "runs"]);
  });

  it("joins the parts' due work in part order; the contribution carries dueWork only when some part has due work", () => {
    const one = () => {};
    const two = () => {};
    expect(mergePlaybookParts([emptyPart("a", { dueWork: [one] }), emptyPart("b"), emptyPart("c", { dueWork: [two] })]).dueWork).toEqual([one, two]);
    const c = playbooksContributionOf([emptyPart("a", { dueWork: [one] }), emptyPart("b"), emptyPart("c", { dueWork: [two] })]);
    expect(Object.keys(c)).toEqual(["name", "subcommands", "dueWork"]);
    expect(c.dueWork).toEqual([one, two]);
    expect(mergeContributions([c], PHASE1_RESERVED).dueWork.map((d) => [d.owner, d.run])).toEqual([
      ["playbooks", one],
      ["playbooks", two],
    ]);
    expect(Object.keys(playbooksContributionOf([emptyPart("a"), emptyPart("b", { dueWork: [] })]))).toEqual(["name", "subcommands"]);
  });

  it("a verb named help is refused: it is the built-in help", () => {
    expect(() => mergePlaybookParts([emptyPart("drafts", { verbs: [verb("help")] })])).toThrow(InvalidContributionError);
  });
});

describe("a playbooks contribution with verbs (what a later item's part adds)", () => {
  it("appends each verb's help to the help line, dispatches a known verb with the remaining args, and keeps only non-empty keys", async () => {
    const seen: string[][] = [];
    const handler = () => {};
    const c = playbooksContributionOf([emptyPart("drafts", { verbs: [verb("show", seen)] }), emptyPart("runs", { handlers: { wakeup: handler } })]);
    expect(Object.keys(c)).toEqual(["name", "subcommands", "handlers"]);
    const sub = c.subcommands?.[0];
    expect(sub?.help).toBe("studio playbooks <verb> | show <id>");
    const out: string[] = [];
    const output = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
    expect(await sub?.run(["show", "3", "--json"], noClient, output)).toBe(7);
    expect(seen).toEqual([["show", "3", "--json"]]);
    expect(await sub?.run([], noClient, output)).toBe(0);
    expect(out.join("")).toBe("studio playbooks <verb> | show <id>\n");
    // Still merges as a feature: the handler is a contributed handler.
    expect(mergeContributions([c], PHASE1_RESERVED).handlers.wakeup).toBe(handler);
  });

  it("a verb's help without the leading `studio playbooks ` goes on the help line unchanged", () => {
    const c = playbooksContributionOf([emptyPart("drafts", { verbs: [verb("show"), { ...verb("odd"), help: "odd <x> (no prefix)" }] })]);
    expect(c.subcommands?.[0]?.help).toBe("studio playbooks <verb> | show <id> | odd <x> (no prefix)");
  });
});

describe("a playbook's merge_requirement may only be stricter than the repo it polls (AC7)", () => {
  const NOW = new Date("2026-10-14T10:00:00.000Z");
  const ENABLE_FULL = "mcp__kernel__kernel_playbook_enable";
  const POLL = JSON.stringify({ source: "github.pulls", repos: ["o/r"], filters: {}, interval_seconds: 300 });
  let store: Store;

  beforeEach(() => {
    store = new Store({ dataDir });
    store.prepare("INSERT INTO connectors (kind, status, reachable_repos_json) VALUES ('github', 'connected', ?)").run(JSON.stringify(["o/r", "o/s"]));
  });
  afterEach(() => {
    store.close();
  });

  /** A draft (with a done dry run at its version) polling `repos`, its requirement `requirement` (omitted: not set). */
  function draft(requirement: string | undefined, spec: string = POLL, trigger: "poll" | "cron" = "poll"): number {
    const { playbook } = createPlaybook(
      store,
      {
        agent: "wright",
        name: `Reviewer ${requirement ?? "unset"} ${spec.length}`,
        intent: "Review each open pull request.",
        trigger: trigger === "poll" ? { kind: "poll", spec } : { kind: "cron", spec: "0 9 * * 1-5", tz: "UTC" },
        model: "claude-sonnet-4-5",
        ...(requirement === undefined ? {} : { merge_requirement: requirement }),
      },
      NOW,
    );
    store
      .prepare("INSERT INTO playbook_runs (playbook, version, kind, status, result_json, ended_at) VALUES (?, ?, 'dry_run', 'done', '{}', ?)")
      .run(playbook.id, playbook.version, NOW.toISOString());
    return playbook.id;
  }

  const repoNeeds = (repo: string, required: number): void => void setRepoPolicy(store, repo, { kind: "reviews", required }, () => NOW);

  /** What the gate asks before it holds Wright's enable: the verdict, and how many approvals exist. */
  function preHold(id: number): { verdict: { refuse?: string; display?: string; subjectVersion?: number } | undefined; approvals: number } {
    const sessions = { stopSession: async () => "stopped", getSession: (sid: number) => ({ id: sid, agent: "wright" }) } as unknown as KernelToolContext["sessions"];
    const check = heldToolCheckOf(playbooksContribution.tools ?? [], (sessionId) => ({ store, sessions, sessionId, now: () => NOW }));
    const verdict = check(ENABLE_FULL, { id, idempotency_key: `e${id}` }, 1) as { refuse?: string; display?: string; subjectVersion?: number } | undefined;
    return { verdict, approvals: store.prepare<[], number>("SELECT count(*) FROM approvals").pluck().get() ?? 0 };
  }

  /** The kernel's apply of an approved enable (what `studio approve` runs), for the draft's current version. */
  function applyApproved(id: number) {
    const row = getPlaybook(store, id);
    const apply = approvalApplierOf(playbooksContribution.tools ?? []);
    return apply(ENABLE_FULL, { id, idempotency_key: `e${id}` }, { id: 1, sessionId: null, agent: "wright", subjectVersion: row?.version ?? null, requestedEventId: 1 }, store, NOW);
  }

  it("the closed kinds are none, studio_approval and reviews; the column ships no default (null until set)", () => {
    expect([...MERGE_REQUIREMENT_KINDS]).toEqual(["none", "studio_approval", "reviews"]);
    expect(getPlaybook(store, draft(undefined))).toMatchObject({ merge_requirement: null, merge_requirement_set_by: null });
  });

  it("reviews:1 under a repo that needs 2 is refused playbook_looser_than_repo at the pre-hold check: nothing is held, no approval is written", () => {
    repoNeeds("o/r", 2);
    const id = draft("reviews:1");
    const { verdict, approvals } = preHold(id);
    expect(verdict).toEqual({
      refuse: "kernel_playbook_enable: playbook_looser_than_repo: merge_requirement reviews:1 is looser than o/r, whose policy needs 2 reviews; set reviews:2 or more, or have the owner change the repo's policy (nothing was held for the owner)",
    });
    expect(approvals).toBe(0);
    expect(getPlaybook(store, id)?.status).toBe("draft");
  });

  it("reviews:2, reviews:3, studio_approval, none and no requirement are not refused: the enable is held with its requirement shown", () => {
    repoNeeds("o/r", 2);
    for (const [requirement, shown] of [
      ["reviews:2", "merge_requirement: reviews:2 (proposed)"],
      ["reviews:3", "merge_requirement: reviews:3 (proposed)"],
      ["studio_approval", "merge_requirement: studio_approval (proposed)"],
      ["none", "merge_requirement: none (proposed)"],
      [undefined, "merge_requirement: not set"],
    ] as const) {
      const id = draft(requirement);
      const { verdict } = preHold(id);
      expect(verdict, String(requirement)).toMatchObject({ subjectVersion: 1 });
      expect(verdict?.refuse, String(requirement)).toBeUndefined();
      expect(verdict?.display?.split("\n"), String(requirement)).toContain(shown);
    }
  });

  it("the enable display starts its values with `mode:` (who set it) right before `model:`, and says LIVE on the first line only for a live playbook (phase 8 item 20e)", () => {
    const draftId = draft(undefined);
    store.prepare("UPDATE playbooks SET mode_set_by = 'wright' WHERE id = ?").run(draftId);
    const draftRow = getPlaybook(store, draftId);
    const draftLines = preHold(draftId).verdict?.display?.split("\n") ?? [];
    // Draft mode: the first line is byte-identical to what it was before the mode word existed.
    expect(draftLines[0]).toBe(`Enable playbook ${JSON.stringify(draftRow?.name)} (${draftRow?.slug}, #${draftId}) at version 1, agent wright`);
    expect(draftLines[0]).not.toContain("LIVE");
    const draftMode = draftLines.findIndex((line) => line.startsWith("mode: "));
    expect(draftRow?.mode).toBe("draft");
    expect(draftLines[draftMode]).toBe("mode: draft (proposed)");
    expect(draftLines[draftMode + 1]?.startsWith("model: ")).toBe(true);

    // Live mode, set by the owner on the row (version unchanged, so the done dry run still matches).
    const liveId = draft(undefined, JSON.stringify({ source: "github.pulls", repos: ["o/s"], filters: {}, interval_seconds: 300 }));
    store.prepare("UPDATE playbooks SET mode = 'live', mode_set_by = 'owner' WHERE id = ?").run(liveId);
    const liveRow = getPlaybook(store, liveId);
    const liveLines = preHold(liveId).verdict?.display?.split("\n") ?? [];
    expect(liveLines[0]).toBe(`Enable playbook ${JSON.stringify(liveRow?.name)} (${liveRow?.slug}, #${liveId}) at version 1, LIVE, agent wright`);
    const liveMode = liveLines.findIndex((line) => line.startsWith("mode: "));
    expect(liveLines[liveMode]).toBe("mode: live (set by owner)");
    expect(liveLines[liveMode + 1]?.startsWith("model: ")).toBe(true);
    // `mode:` is the first value line: nothing but the schedule line sits between the first line and it.
    expect(liveMode).toBe(2);
    expect(draftMode).toBe(2);
  });

  it("a repo with another kind of policy, or none, never refuses; only a polled repo counts; the stricter of several repos refuses and is named", () => {
    const solo = draft("reviews:1");
    expect(preHold(solo).verdict?.refuse).toBeUndefined();
    setRepoPolicy(store, "o/r", { kind: "studio_approval" }, () => NOW);
    expect(preHold(solo).verdict?.refuse).toBeUndefined();
    setRepoPolicy(store, "o/r", { kind: "solo" }, () => NOW);
    expect(preHold(solo).verdict?.refuse).toBeUndefined();
    // A cron playbook polls no repo: nothing to be looser than.
    repoNeeds("o/r", 5);
    expect(preHold(draft("reviews:1", POLL, "cron")).verdict?.refuse).toBeUndefined();
    // Two repos: the one that needs more than the playbook does is named.
    repoNeeds("o/r", 1);
    repoNeeds("o/s", 3);
    const two = draft("reviews:2", JSON.stringify({ source: "github.pulls", repos: ["o/r", "o/s"], filters: {}, interval_seconds: 300 }));
    expect(preHold(two).verdict?.refuse).toContain("looser than o/s, whose policy needs 3 reviews");
  });

  it("raised after the enable was held: the kernel's apply refuses playbook_looser_than_repo (the approval's apply_refused), the playbook stays draft and nothing is enabled", () => {
    repoNeeds("o/r", 2);
    const id = draft("reviews:2");
    expect(preHold(id).verdict?.display).toBeDefined();
    repoNeeds("o/r", 3);
    const outcome = applyApproved(id);
    expect(outcome).toMatchObject({ refused: "playbook_looser_than_repo" });
    expect((outcome as { text: string }).text).toBe(
      `The kernel did not enable playbook reviewer-reviews-2-${POLL.length} (#${id}): playbook_looser_than_repo (merge_requirement reviews:2 is looser than o/r, whose policy needs 3 reviews; set reviews:3 or more, or have the owner change the repo's policy).`,
    );
    expect(getPlaybook(store, id)).toMatchObject({ status: "draft", version: 1 });
    expect(store.prepare("SELECT count(*) FROM events WHERE kind = 'playbook_enabled'").pluck().get()).toBe(0);
    // The same enable, with the repo back at 2, is applied.
    repoNeeds("o/r", 2);
    expect(applyApproved(id)).toMatchObject({ applied: expect.stringContaining("The kernel enabled playbook") });
    expect(getPlaybook(store, id)?.status).toBe("enabled");
  });

  it("enableApproved throws EnableRefused with the reason, writing nothing; the owner raising the playbook's own requirement clears it (a new version, a new dry run)", () => {
    repoNeeds("o/r", 2);
    const id = draft("reviews:1");
    const attempt = () => enableApproved(store, { playbookId: id, agent: "wright", approval: { id: 1, requestedEventId: 1, subjectVersion: 1 }, sessionId: null, now: NOW });
    expect(attempt).toThrow(EnableRefused);
    try {
      attempt();
    } catch (err) {
      expect((err as EnableRefused).reason).toBe("playbook_looser_than_repo");
    }
    expect(getPlaybook(store, id)?.status).toBe("draft");
    setPlaybookPolicy(store, { id, field: "merge_requirement", value: "reviews:2" }, NOW);
    expect(getPlaybook(store, id)).toMatchObject({ version: 2, merge_requirement: "reviews:2", merge_requirement_set_by: "owner" });
    expect(preHold(id).verdict?.refuse).toContain("a dry run of version 2 is required");
  });
});

describe("parseMergeRequirement (the one merge_requirement grammar)", () => {
  it("reads none, studio_approval and reviews:N, and nothing else", () => {
    expect(parseMergeRequirement("none")).toEqual({ kind: "none", reviews: null });
    expect(parseMergeRequirement("studio_approval")).toEqual({ kind: "studio_approval", reviews: null });
    expect(parseMergeRequirement("reviews:2")).toEqual({ kind: "reviews", reviews: 2 });
    for (const bad of ["reviews", "reviews:0", "reviews:01", "reviews:1234567890", "reviews:-1", "Reviews:1", "", null, undefined, 3]) {
      expect(parseMergeRequirement(bad)).toBeNull();
    }
  });
});
