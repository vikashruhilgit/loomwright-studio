// Phase 8 item 27b: a handover never queues a ticket that is gone.
//
//   - AC1: an earlier backlog line whose ticket is closed (a GitHub issue no
//     relevant `github.issues` poll lists, found by the closed-state probe) or no
//     longer matches its playbook's filter (a ClickUp task no `clickup.tasks` poll
//     lists) is not carried, and `kernel_automate_prepare` names it in `dropped`.
//   - AC2: a ticket whose source can't be read (no relevant poll, no connection or
//     client, a failed fetch, a listing that may be cut) is kept in place and named
//     in `unverified`: the rule fails toward keeping work.
//   - AC4 (all but the retire route, which `automate-retire.test.ts` pins): an
//     open matching ticket kept in place, a ticket handed over again never dropped,
//     a retired run's items dropped `run_retired`; the retired-run record's writer
//     and readers.
//
// Everything runs on a temp store and temp checkout with a fake GitHub client and
// a fake ticket reader: no network, no Keychain, never the SDK or a model. The 23i
// carry tests stay in `automate-runner.test.ts`, unchanged.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CARRY_DROP_REASONS, verifyCarried } from "../src/automate/carry-check.js";
import { RETIRED_HANDED_AGAIN_EVENT, RUN_RETIRED_EVENT, recordHandedAgain, recordRunRetired, retiredItemNames, retiredRunIds } from "../src/automate/retired-runs.js";
import { createAutomateRunnerTools } from "../src/automate/runner.js";
import { BACKLOG_FILE, MAX_ITEM_BYTES, STUDIO_ITEMS_DIR, earlierCandidates, itemFileName, parseItemSource, writeTicketItems } from "../src/automate/tickets-to-items.js";
import type { McpTicketReader, McpTicketResult } from "../src/integrations/mcp/trackers.js";
import type { GitHubClient, GitHubIssueFilters, GitHubIssueSummary } from "../src/integrations/types.js";
import { toolEnv } from "./fixtures/loomwright-run-files/harness.js";
import type { ToolEnv } from "./fixtures/loomwright-run-files/harness.js";

let env: ToolEnv;
let live: { playbook: number };

beforeEach(() => {
  env = toolEnv("studio-carry-");
  live = { playbook: env.playbook("live") };
});

afterEach(() => {
  env.close();
});

// ---- Fixtures ------------------------------------------------------------------------

const RATE = { limit: 5000, remaining: 4999, reset_at: "2026-11-09T11:00:00Z" };

/** A GitHub issue ticket of `o/r` as a playbook hands it over. */
const issue = (n: number, repo = "o/r") => ({ ref: `${repo}#${n}`, title: `Issue ${n}`, link: `https://github.com/${repo}/issues/${n}`, body: "Do it." });
/** A ClickUp task ticket. */
const task = (id: string) => ({ ref: `clickup:${id}`, title: `Task ${id}`, link: `https://app.clickup.com/t/${id}` });

const listed = (n: number, repo = "o/r"): GitHubIssueSummary => ({ number: n, title: `Issue ${n}`, body: "", author: "someone", labels: ["studio"], url: `https://github.com/${repo}/issues/${n}`, updated_at: "2026-11-09T09:00:00Z" });

type IssueAnswer = readonly GitHubIssueSummary[] | "fail" | "throw";

/** A fake GitHub client answering `listIssues` only: the open listing per repo, and the closed-state listing per repo. */
function fakeGithub(open: Record<string, IssueAnswer>, closed: Record<string, IssueAnswer> = {}) {
  const calls: { repo: string; filters: GitHubIssueFilters }[] = [];
  const client = {
    async listIssues(repo: string, filters: GitHubIssueFilters) {
      calls.push({ repo, filters });
      const answer = (filters.state === "closed" ? closed : open)[repo] ?? [];
      if (answer === "throw") throw new Error("boom");
      if (answer === "fail") return { ok: false as const, error: "http_error" as const, status: 500, rateLimit: RATE };
      return { ok: true as const, data: answer, rateLimit: RATE };
    },
  };
  return { client: client as unknown as GitHubClient, calls };
}

/** A fake ticket reader: every call answers `answer` (a task list, or a fixed failure). */
function fakeTickets(answer: readonly Record<string, unknown>[] | McpTicketResult): McpTicketReader & { calls: number } {
  const reader = {
    calls: 0,
    async call(): Promise<McpTicketResult> {
      reader.calls += 1;
      if (!Array.isArray(answer)) return answer as McpTicketResult;
      return { ok: true, text: JSON.stringify({ tasks: answer, count: answer.length, page: 0, has_more: false, next_page: null }) };
    },
  };
  return reader;
}

const clickupTask = (id: string, tags: string[]) => ({ id, name: `Task ${id}`, url: `https://app.clickup.com/t/${id}`, status: "to do", date_updated: "1762678800000", tags: tags.map((name) => ({ name })) });

/** A usable GitHub connector reaching `o/r` and `o/other`. */
function connectGithub(status = "connected"): void {
  env.store.prepare("INSERT INTO connectors (kind, status, reachable_repos_json) VALUES ('github', ?, ?)").run(status, JSON.stringify(["o/r", "o/other"]));
}

/** A ClickUp MCP connection with the task-listing tool. */
function connectClickup(status = "connected"): void {
  const tools = JSON.stringify([{ name: "clickup_filter_tasks", proxy: "kernel_mcp_r_clickup_clickup_filter_tasks", read_only: true, description: "", schema: "{}" }]);
  env.store.prepare("INSERT INTO mcp_connections (kind, server_url, status, granted_tools) VALUES ('clickup', 'https://mcp.example.test/mcp', ?, ?)").run(status, tools);
}

/** A poll trigger linked to the live playbook (`pb1`), or to `playbook`. */
function addPoll(spec: Record<string, unknown>, playbook: string | null = "pb1"): void {
  env.store
    .prepare("INSERT INTO triggers (owning_agent, playbook, kind, spec_json, action, action_payload, created_by) VALUES ('mason', ?, 'poll', ?, 'wake_agent', '{}', 'owner')")
    .run(playbook, JSON.stringify({ interval_seconds: 300, ...spec }));
}

const githubPoll = (repos: string[] = ["o/r"]) => addPoll({ source: "github.issues", repos, filters: { labels: ["studio"] } });
const clickupPoll = () => addPoll({ source: "clickup.tasks", filters: { list: "901", tags: ["studio-sandbox"] } });

const rel = (ref: string): string => `${STUDIO_ITEMS_DIR}/${itemFileName(ref)}`;
const line = (ref: string): string => `- [ ] ${rel(ref)}`;
const checklist = (): string[] =>
  readFileSync(join(env.checkout, STUDIO_ITEMS_DIR, BACKLOG_FILE), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("- ["));

function prepareWith(deps: { github?: GitHubClient | undefined; tickets?: McpTicketReader }) {
  const tools = createAutomateRunnerTools({ carry: { github: () => deps.github, ...(deps.tickets === undefined ? {} : { tickets: deps.tickets }) } });
  return async (tickets: readonly Record<string, unknown>[]): Promise<Record<string, unknown>> => {
    const answer = await env.call(tools, "kernel_automate_prepare", { repo: "o/r", tickets }, live);
    if (answer.isError) throw new Error(`expected an answer, got an error: ${answer.text}`);
    return answer.value as Record<string, unknown>;
  };
}

const eventCount = (): number => env.store.prepare<[], number>("SELECT COUNT(*) FROM events").pluck().get() as number;

// ---- AC1: closed or off-filter tickets are dropped ---------------------------------------

describe("AC1: a handover drops an earlier ticket that is closed or off its playbook's filter", () => {
  it("closed issue dropped ticket_closed: no relevant github.issues poll lists it and the closed-state probe finds it", async () => {
    connectGithub();
    githubPoll();
    const gh = fakeGithub({ "o/r": [listed(12), listed(22)] }, { "o/r": [listed(21)] });
    const prepare = prepareWith({ github: gh.client });
    await prepare([issue(21), issue(12)]);
    const out = await prepare([issue(22)]);
    expect(out["dropped"]).toEqual([{ item: rel("o/r#21"), ref: "o/r#21", reason: "ticket_closed" }]);
    expect(out["unverified"]).toEqual([]);
    expect(out["carried"]).toEqual([rel("o/r#12")]);
    expect(checklist()).toEqual([line("o/r#12"), line("o/r#22")]);
    // The item file is left where it is: only the backlog line goes.
    expect(existsSync(join(env.checkout, rel("o/r#21")))).toBe(true);
    // One open listing for the poll, one closed probe for the repo.
    expect(gh.calls).toEqual([
      { repo: "o/r", filters: { labels: ["studio"] } },
      { repo: "o/r", filters: { state: "closed" } },
    ]);
  });

  it("an issue off the filter that is not closed (or whose probe fails) is dropped filter_no_longer_matches", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(21), issue(23)]);
    const out = await prepareWith({ github: fakeGithub({ "o/r": [listed(22)] }, { "o/r": [] }).client })([issue(22)]);
    expect(out["dropped"]).toEqual([
      { item: rel("o/r#21"), ref: "o/r#21", reason: "filter_no_longer_matches" },
      { item: rel("o/r#23"), ref: "o/r#23", reason: "filter_no_longer_matches" },
    ]);
    // A probe that fails still drops: the listings proved it off the filter, only the label is weaker.
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(31)]);
    const failed = await prepareWith({ github: fakeGithub({ "o/r": [listed(32)] }, { "o/r": "fail" }).client })([issue(32)]);
    expect(failed["dropped"]).toEqual([{ item: rel("o/r#31"), ref: "o/r#31", reason: "filter_no_longer_matches" }]);
  });

  it("untagged ClickUp task dropped filter_no_longer_matches: no clickup.tasks poll lists it once its tag is removed", async () => {
    connectClickup();
    clickupPoll();
    await prepareWith({ tickets: fakeTickets([clickupTask("86bd5gdbq", ["studio-sandbox"])]) })([task("86bd5gdbq"), task("86bd3z76t")]);
    // The tag was removed: the server's answer no longer carries it, so the kernel's own tag check drops it from the listing.
    const reader = fakeTickets([clickupTask("86bd5gdbq", []), clickupTask("86bd3z76t", ["studio-sandbox"]), clickupTask("86bd9new1", ["studio-sandbox"])]);
    const out = await prepareWith({ tickets: reader })([task("86bd9new1")]);
    expect(out["dropped"]).toEqual([{ item: rel("clickup:86bd5gdbq"), ref: "clickup:86bd5gdbq", reason: "filter_no_longer_matches" }]);
    expect(out["carried"]).toEqual([rel("clickup:86bd3z76t")]);
    expect(checklist()).toEqual([line("clickup:86bd3z76t"), line("clickup:86bd9new1")]);
    // One listing for the one poll, whatever the number of candidates.
    expect(reader.calls).toBe(1);
  });

  it("handler answers dropped and unverified beside carried", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(21), issue(5, "o/other")]);
    const out = await prepareWith({ github: fakeGithub({ "o/r": [] }, { "o/r": [listed(21)] }).client })([issue(22)]);
    expect(Object.keys(out)).toEqual(expect.arrayContaining(["carried", "dropped", "unverified"]));
    expect(out["dropped"]).toEqual([{ item: rel("o/r#21"), ref: "o/r#21", reason: "ticket_closed" }]);
    // `o/other` has no poll: kept, unverified.
    expect(out["unverified"]).toEqual([rel("o/other#5")]);
    expect(out["run"]).toBe("started_by_kernel");
  });
});

// ---- AC2: an unreadable source keeps the line ---------------------------------------------

describe("AC2: a ticket whose source can't be read is kept in place and named unverified", () => {
  it("unreadable source kept unverified: a listing that fails keeps the line where it was", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(21), issue(12)]);
    const gh = fakeGithub({ "o/r": "fail" }, { "o/r": [listed(21), listed(12)] });
    const out = await prepareWith({ github: gh.client })([issue(22)]);
    expect(out["dropped"]).toEqual([]);
    expect(out["unverified"]).toEqual([rel("o/r#21"), rel("o/r#12")]);
    expect(out["carried"]).toEqual([rel("o/r#21"), rel("o/r#12")]);
    expect(checklist()).toEqual([line("o/r#21"), line("o/r#12"), line("o/r#22")]);
    // No closed probe once a listing failed.
    expect(gh.calls.filter((c) => c.filters.state === "closed")).toEqual([]);
  });

  it("listing cut at MAX_POLL_ITEMS is unverified: absence from a cut listing proves nothing", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(21)]);
    // 101 open issues: the fetch keeps 100 and reports found 101. #21 is not among them, and the probe would say closed.
    const many = Array.from({ length: 101 }, (_, i) => listed(1000 + i));
    const out = await prepareWith({ github: fakeGithub({ "o/r": many }, { "o/r": [listed(21)] }).client })([issue(22)]);
    expect(out["dropped"]).toEqual([]);
    expect(out["unverified"]).toEqual([rel("o/r#21")]);
    expect(checklist()).toEqual([line("o/r#21"), line("o/r#22")]);
  });

  it("a listing holding MAX_POLL_ITEMS items is unverified too: a paged source can stop there without saying so", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(21)]);
    const full = Array.from({ length: 100 }, (_, i) => listed(1000 + i));
    const out = await prepareWith({ github: fakeGithub({ "o/r": full }, { "o/r": [listed(21)] }).client })([issue(22)]);
    expect(out["dropped"]).toEqual([]);
    expect(out["unverified"]).toEqual([rel("o/r#21")]);
  });

  it("no relevant poll, no usable connector, no client, a closed tracker connection, a client that throws or a link of another form: all kept unverified, none fetched", async () => {
    const tickets = [issue(21), issue(7, "o/other"), task("86bd5gdbq"), { ref: "PROJ-1", title: "Jira", link: "https://example.test/browse/PROJ-1" }];
    await prepareWith({})(tickets);
    const names = tickets.map((t) => rel(t.ref));
    // No poll at all, and no connector.
    const reader = fakeTickets([]);
    const none = await prepareWith({ github: fakeGithub({ "o/r": [] }).client, tickets: reader })([issue(40)]);
    expect(none["dropped"]).toEqual([]);
    expect(none["unverified"]).toEqual(names);

    // Polls exist, but the GitHub connector is not usable and the ClickUp connection is not open: no fetch.
    githubPoll(["o/r", "o/other"]);
    clickupPoll();
    connectGithub("revoked");
    connectClickup("disconnected");
    const gh = fakeGithub({ "o/r": [] }, { "o/r": [listed(21)] });
    const closed = await prepareWith({ github: gh.client, tickets: reader })([issue(40)]);
    expect(closed["dropped"]).toEqual([]);
    expect(closed["unverified"]).toEqual(names);
    expect(gh.calls).toEqual([]);
    expect(reader.calls).toBe(0);

    // A usable connector but no client wired.
    connectGithub();
    const noClient = await prepareWith({})([issue(40)]);
    expect(noClient["unverified"]).toEqual(names);

    // A client that throws is a failed fetch, never a thrown handover.
    const throwing = await prepareWith({ github: fakeGithub({ "o/r": "throw", "o/other": "throw" }).client })([issue(40)]);
    expect(throwing["dropped"]).toEqual([]);
    expect(throwing["unverified"]).toEqual(names);
  });

  it("a poll whose stored spec can't be read keeps every would-be drop unverified; a poll linked to no playbook is not relevant", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(21)]);
    addPoll({ source: "nonsense" });
    const out = await prepareWith({ github: fakeGithub({ "o/r": [] }, { "o/r": [listed(21)] }).client })([issue(22)]);
    expect(out["dropped"]).toEqual([]);
    expect(out["unverified"]).toEqual([rel("o/r#21")]);
    env.store.prepare("DELETE FROM triggers").run();
    // Only a poll whose playbook does not exist: no relevant poll, so unverified even though that poll lists nothing.
    addPoll({ source: "github.issues", repos: ["o/r"], filters: {} }, "no-such-playbook");
    const orphan = await prepareWith({ github: fakeGithub({ "o/r": [] }, { "o/r": [listed(21)] }).client })([issue(22)]);
    expect(orphan["unverified"]).toEqual([rel("o/r#21")]);
  });
});

// ---- AC4: kept in place, handed again, retired ---------------------------------------------

describe("AC4: what is kept, and where", () => {
  it("open matching ticket kept in place: order unchanged, matched by url or by ref", async () => {
    connectGithub();
    githubPoll(["O/R"]);
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(12), issue(13)]);
    // #12 is listed by its url; #13 by its ref only (the listing's url is empty), the repo's case as the poll names it.
    const byRef = { ...listed(13, "O/R"), url: "" };
    const gh = fakeGithub({ "O/R": [listed(12), byRef] }, { "O/R": [listed(12), listed(13)] });
    const out = await prepareWith({ github: gh.client })([issue(14)]);
    expect(out["dropped"]).toEqual([]);
    expect(out["unverified"]).toEqual([]);
    expect(out["carried"]).toEqual([rel("o/r#12"), rel("o/r#13")]);
    expect(checklist()).toEqual([line("o/r#12"), line("o/r#13"), line("o/r#14")]);
    // Kept: no closed probe was needed.
    expect(gh.calls.filter((c) => c.filters.state === "closed")).toEqual([]);
  });

  it("a ticket listed by any one of several polls of its source is kept", async () => {
    connectClickup();
    clickupPoll();
    addPoll({ source: "clickup.tasks", filters: { space: "77" } });
    await prepareWith({ tickets: fakeTickets([]) })([task("86bd5gdbq")]);
    let call = 0;
    const reader: McpTicketReader = {
      async call() {
        call += 1;
        const tasks = call === 1 ? [] : [clickupTask("86bd5gdbq", [])];
        return { ok: true, text: JSON.stringify({ tasks, count: tasks.length, page: 0, has_more: false, next_page: null }) };
      },
    };
    const out = await prepareWith({ tickets: reader })([task("86bd9new1")]);
    expect(out["dropped"]).toEqual([]);
    expect(out["carried"]).toEqual([rel("clickup:86bd5gdbq")]);
  });

  it("ticket handed over again never dropped: it keeps its place, is not checked, and is neither carried nor unverified", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(21), issue(12)]);
    // #21 is closed and off the filter, but this handover hands it over again.
    const gh = fakeGithub({ "o/r": [listed(12)] }, { "o/r": [listed(21)] });
    const out = await prepareWith({ github: gh.client })([issue(21)]);
    expect(out["dropped"]).toEqual([]);
    expect(out["unverified"]).toEqual([]);
    expect(out["carried"]).toEqual([rel("o/r#12")]);
    expect(checklist()).toEqual([line("o/r#21"), line("o/r#12")]);
  });

  it("ticket handed over again never dropped, even with a drop verdict handed to the writer", () => {
    writeTicketItems(env.checkout, "o/r", [issue(21), issue(12)]);
    const verdicts = new Map([
      [itemFileName("o/r#21"), "ticket_closed" as const],
      [itemFileName("o/r#12"), "keep" as const],
    ]);
    const out = writeTicketItems(env.checkout, "o/r", [issue(21)], { verdicts, retired: new Set([itemFileName("o/r#21")]) });
    expect(out.dropped).toEqual([]);
    expect(out.unverified).toEqual([]);
    expect(checklist()).toEqual([line("o/r#21"), line("o/r#12")]);
  });

  it("retired run's items dropped run_retired, even when the playbook's poll still lists them and no run file names them", async () => {
    connectGithub();
    githubPoll();
    await prepareWith({ github: fakeGithub({ "o/r": [] }).client })([issue(12), issue(13)]);
    recordRunRetired(env.store, { checkout: env.checkout, run_id: "2026-11-20-001", items: [itemFileName("o/r#12")] }, "2026-11-25T10:00:00Z");
    const gh = fakeGithub({ "o/r": [listed(12), listed(13), listed(14)] });
    const out = await prepareWith({ github: gh.client })([issue(14)]);
    expect(out["dropped"]).toEqual([{ item: rel("o/r#12"), ref: "o/r#12", reason: "run_retired" }]);
    expect(out["unverified"]).toEqual([]);
    expect(out["carried"]).toEqual([rel("o/r#13")]);
    expect(checklist()).toEqual([line("o/r#13"), line("o/r#14")]);
  });

  it("with no carry argument the writer drops nothing and names nothing unverified (23i as before)", () => {
    writeTicketItems(env.checkout, "o/r", [issue(21), issue(12)]);
    const out = writeTicketItems(env.checkout, "o/r", [issue(22)]);
    expect(out.carried).toEqual([rel("o/r#21"), rel("o/r#12")]);
    expect(out.dropped).toEqual([]);
    expect(out.unverified).toEqual([]);
  });

  it("a name with no verdict (it appeared after the check) is kept and named unverified", () => {
    writeTicketItems(env.checkout, "o/r", [issue(21), issue(12)]);
    const out = writeTicketItems(env.checkout, "o/r", [issue(22)], { verdicts: new Map([[itemFileName("o/r#21"), "keep" as const]]), retired: new Set() });
    expect(out.carried).toEqual([rel("o/r#21"), rel("o/r#12")]);
    expect(out.unverified).toEqual([rel("o/r#12")]);
  });
});

// ---- The pieces -------------------------------------------------------------------------

describe("the carry check's pieces", () => {
  it("CARRY_DROP_REASONS is the closed set of three, defined once", () => {
    expect([...CARRY_DROP_REASONS]).toEqual(["ticket_closed", "filter_no_longer_matches", "run_retired"]);
    expect(Object.isFrozen(CARRY_DROP_REASONS)).toBe(true);
  });

  it("earlierCandidates names each carried item with the ref and link its file holds, and reads nothing without a backlog", () => {
    expect(earlierCandidates(env.checkout)).toEqual([]);
    writeTicketItems(env.checkout, "o/r", [issue(21), task("86bd5gdbq")]);
    expect(earlierCandidates(env.checkout)).toEqual([
      { name: itemFileName("o/r#21"), ref: "o/r#21", link: "https://github.com/o/r/issues/21" },
      { name: itemFileName("clickup:86bd5gdbq"), ref: "clickup:86bd5gdbq", link: "https://app.clickup.com/t/86bd5gdbq" },
    ]);
  });

  it("the one item parser reads ref and link only under ## Source ticket, and an item over MAX_ITEM_BYTES reads as none (kept unverified)", () => {
    const text = ["# Title", "## Notes", "- dedupe ref: `o/r#7`", "- link: https://github.com/o/r/issues/7", "## Source ticket", "- repo: o/r", "- dedupe ref: `o/r#21`", "- link: https://github.com/o/r/issues/21", "## Ticket data (untrusted)", "- dedupe ref: `o/r#8`"].join("\n");
    expect(parseItemSource(text)).toEqual({ ref: "o/r#21", link: "https://github.com/o/r/issues/21", title: "Title" });
    expect(parseItemSource("# T\n- dedupe ref: `o/r#7`\n")).toEqual({ ref: null, link: null, title: "T" });
    writeTicketItems(env.checkout, "o/r", [issue(21)]);
    writeFileSync(join(env.checkout, STUDIO_ITEMS_DIR, itemFileName("o/r#21")), `${readFileSync(join(env.checkout, STUDIO_ITEMS_DIR, itemFileName("o/r#21")), "utf8")}${"x".repeat(MAX_ITEM_BYTES)}`);
    expect(earlierCandidates(env.checkout)).toEqual([{ name: itemFileName("o/r#21"), ref: null, link: null }]);
  });

  it("verifyCarried reads only: no event, no queue row, and each poll is fetched once per call", async () => {
    connectGithub();
    githubPoll();
    const candidates = [21, 22, 23].map((n) => ({ name: itemFileName(`o/r#${n}`), ref: `o/r#${n}`, link: `https://github.com/o/r/issues/${n}` }));
    const before = eventCount();
    const gh = fakeGithub({ "o/r": [listed(22)] }, { "o/r": [listed(21)] });
    const verdicts = await verifyCarried(env.store, [...candidates, { name: "x", ref: null, link: null }], { github: () => gh.client });
    expect([...verdicts.values()]).toEqual(["ticket_closed", "keep", "filter_no_longer_matches", "unverified"]);
    expect(gh.calls).toEqual([
      { repo: "o/r", filters: { labels: ["studio"] } },
      { repo: "o/r", filters: { state: "closed" } },
    ]);
    expect(eventCount()).toBe(before);
    expect(env.store.prepare<[], number>("SELECT COUNT(*) FROM event_queue").pluck().get()).toBe(0);
  });

  it("verifyCarried never throws: a client factory that throws is unverified, a closed probe that throws drops filter_no_longer_matches", async () => {
    connectGithub();
    githubPoll();
    const one = [{ name: "a", ref: "o/r#1", link: "https://github.com/o/r/issues/1" }];
    const factory = (): GitHubClient => {
      throw new Error("no keychain");
    };
    expect([...(await verifyCarried(env.store, one, { github: factory })).values()]).toEqual(["unverified"]);
    const probeThrows = fakeGithub({ "o/r": [] }, { "o/r": "throw" });
    expect([...(await verifyCarried(env.store, one, { github: () => probeThrows.client })).values()]).toEqual(["filter_no_longer_matches"]);
    // A link whose repo is a dot segment is no source the kernel reads.
    expect([...(await verifyCarried(env.store, [{ name: "b", ref: null, link: "https://github.com/../r/issues/1" }], { github: () => probeThrows.client })).values()]).toEqual(["unverified"]);
  });
});

describe("retired runs: the automate_run_retired record", () => {
  const NAME_A = itemFileName("o/r#12");
  const NAME_B = itemFileName("clickup:86bd5gdbq");

  it("records one event and reads it back by checkout (resolve-compared), items kept once", () => {
    const record = recordRunRetired(env.store, { checkout: env.checkout, run_id: "2026-11-20-001", items: [NAME_A, NAME_B, NAME_A] }, "2026-11-25T10:00:00Z");
    expect(record.items).toEqual([NAME_A, NAME_B]);
    const rows = env.store.prepare<[string], { payload_json: string; actor: string }>("SELECT payload_json, actor FROM events WHERE kind = ?").all(RUN_RETIRED_EVENT);
    expect(rows).toHaveLength(1);
    expect(JSON.parse((rows[0] as { payload_json: string }).payload_json)).toEqual({ checkout: env.checkout, run_id: "2026-11-20-001", items: [NAME_A, NAME_B] });
    expect(retiredRunIds(env.store, `${env.checkout}/.`)).toEqual(new Set(["2026-11-20-001"]));
    expect(retiredItemNames(env.store, env.checkout)).toEqual(new Set([NAME_A, NAME_B]));
    // Another checkout's record is not this one's.
    expect(retiredRunIds(env.store, join(env.root, "elsewhere"))).toEqual(new Set());
  });

  it("ignores malformed rows, never throws on them", () => {
    const insert = env.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES ('2026-11-25T10:00:00Z', ?, 'kernel', ?)");
    for (const payload of ["not json", "[]", "null", JSON.stringify({ checkout: env.checkout }), JSON.stringify({ checkout: 7, run_id: "r1", items: [] }), JSON.stringify({ checkout: env.checkout, run_id: "../x", items: [NAME_A] })]) {
      insert.run(RUN_RETIRED_EVENT, payload);
    }
    insert.run(RUN_RETIRED_EVENT, JSON.stringify({ checkout: env.checkout, run_id: "r2", items: [NAME_A, "../../etc/passwd", 5] }));
    expect(retiredRunIds(env.store, env.checkout)).toEqual(new Set(["r2"]));
    expect(retiredItemNames(env.store, env.checkout)).toEqual(new Set([NAME_A]));
  });

  it("a name handed over again after its retire is lifted in event order, and a later retire names it again", () => {
    recordRunRetired(env.store, { checkout: env.checkout, run_id: "2026-11-20-001", items: [NAME_A, NAME_B] }, "2026-11-25T10:00:00Z");
    const before = eventCount();
    // A handover of tickets no retired run named writes nothing.
    expect(recordHandedAgain(env.store, env.checkout, [itemFileName("o/r#99")], "2026-11-25T11:00:00Z")).toEqual([]);
    expect(eventCount()).toBe(before);
    expect(recordHandedAgain(env.store, env.checkout, [NAME_A, itemFileName("o/r#99")], "2026-11-25T11:00:00Z")).toEqual([NAME_A]);
    expect(env.store.prepare("SELECT COUNT(*) FROM events WHERE kind = ?").pluck().get(RETIRED_HANDED_AGAIN_EVENT)).toBe(1);
    expect(retiredItemNames(env.store, env.checkout)).toEqual(new Set([NAME_B]));
    // Another checkout's hand-over lifts nothing here.
    recordHandedAgain(env.store, join(env.root, "elsewhere"), [NAME_B], "2026-11-25T11:30:00Z");
    expect(retiredItemNames(env.store, env.checkout)).toEqual(new Set([NAME_B]));
    recordRunRetired(env.store, { checkout: env.checkout, run_id: "2026-11-25-001", items: [NAME_A] }, "2026-11-25T12:00:00Z");
    expect(retiredItemNames(env.store, env.checkout)).toEqual(new Set([NAME_A, NAME_B]));
    expect(retiredRunIds(env.store, env.checkout)).toEqual(new Set(["2026-11-20-001", "2026-11-25-001"]));
  });

  it("refuses a record it could not read back, before writing anything", () => {
    const before = eventCount();
    expect(() => recordRunRetired(env.store, { checkout: "", run_id: "r1", items: [] }, "t")).toThrow(/^invalid_input/);
    expect(() => recordRunRetired(env.store, { checkout: env.checkout, run_id: "../r1", items: [] }, "t")).toThrow(/^invalid_input/);
    expect(() => recordRunRetired(env.store, { checkout: env.checkout, run_id: "r1", items: ["notes.md"] }, "t")).toThrow(/^invalid_input/);
    const many = Array.from({ length: 201 }, (_, i) => itemFileName(`o/r#${i + 1}`));
    expect(() => recordRunRetired(env.store, { checkout: env.checkout, run_id: "r1", items: many }, "t")).toThrow(/^invalid_input/);
    expect(eventCount()).toBe(before);
  });
});
