// Phase 8 item 10: the PR tracker (`kernel/src/automate/tracker.ts`), a due work
// that keeps `pr_tracks` and the linked task current with one `pr_state_changed`
// event per change.
//
//   - AC1: a fake PR walked open -> ready -> parked -> merged over four passes (each
//     after a `trigger_fired`) leaves each state recorded once, four events with
//     the task's id, the task following, `run_file`/`item_id` naming the fixture
//     run, and `merged_by_gate` 1 only at the READY head; an unchanged pass
//     appends nothing.
//   - AC2: approvals read `1/2`, `solo`, `studio_approval` or `no_policy`.
//   - The tracker reads GitHub only after a `trigger_fired` (the owner's cadence),
//     follows `pr_tracks` rows until they end, caps one pass, fails closed on an
//     unreadable run state or a failed GitHub read, and reads a ticket ref only
//     from a requirement item under `.supervisor/requirements/studio/`.
//
// Everything runs on a temp store and checkouts with `FakeGitHubClient`: no
// network, no real Keychain, never the SDK or a model.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TRACKED_PER_PASS, PR_OWNER_KINDS, PR_TRACK_STATES, approvalsWordOf, createTrackerDueWork, trackerPart } from "../src/automate/tracker.js";
import { itemFileName, renderItem } from "../src/automate/tickets-to-items.js";
import type { DueWorkContext } from "../src/loop/types.js";
import type { GitHubPull, GitHubPullMergeState } from "../src/integrations/types.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";
import { HEAD, toolEnv } from "./fixtures/loomwright-run-files/harness.js";
import type { ToolEnv } from "./fixtures/loomwright-run-files/harness.js";
import { events } from "./loop-helpers.js";

// The default client is built from the real Keychain reader; a test that injects a client must never get that far.
const keychainReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/auth/keychain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/keychain.js")>()),
  securityCliKeychain: () => {
    keychainReads.count += 1;
    throw new Error("the real Keychain must not be read in a test");
  },
}));

const B = "b".repeat(40);
const RUN_ID = "2026-11-09-100000-tracker";
const URL7 = "https://github.com/o/r/pull/7";
const READY_AT = "2026-11-09T10:05:00Z";

let env: ToolEnv;
let minute: number;
let fired: number;

beforeEach(() => {
  env = toolEnv("studio-tracker-");
  env.store.prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, created_by, charter_json) VALUES ('mason', 'Mason', 'crab', 'crew-teal', 'owner', '{}')").run();
  minute = 0;
  fired = 0;
  keychainReads.count = 0;
});

afterEach(() => {
  env.close();
});

// ---- Fixtures ----------------------------------------------------------------------------------

/** A clock that moves a minute per call to `tick`. */
const clock = (): Date => new Date(Date.UTC(2026, 10, 9, 11, minute, 0));

function ctx(): DueWorkContext {
  return { store: env.store, now: clock };
}

/** An owner's trigger fired: what lets the next tick run a pass. */
function fire(): void {
  fired += 1;
  env.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'trigger_fired', 'kernel', ?)").run(clock().toISOString(), JSON.stringify({ trigger_id: fired }));
}

const pull = (over: Partial<GitHubPull> = {}, number = 7): GitHubPull => ({
  number,
  title: "A change",
  author: "someone",
  draft: false,
  head_sha: HEAD,
  url: `https://github.com/o/r/pull/${number}`,
  updated_at: "2026-11-09T09:00:00Z",
  body: "",
  state: "open",
  merged: false,
  base_ref: "main",
  head_ref: "feature/x",
  labels: [],
  ...over,
});

const mergeState = (over: Partial<GitHubPullMergeState> = {}): GitHubPullMergeState => ({ head_sha: HEAD, approvals: 0, changes_requested: false, ci: "pending", ...over });

function fakeWith(pulls: readonly GitHubPull[], states: Readonly<Record<string, GitHubPullMergeState>> = {}, failures: ConstructorParameters<typeof FakeGitHubClient>[0] = {}): FakeGitHubClient {
  const mergeStates = Object.fromEntries(pulls.map((p) => [`o/r#${p.number}`, mergeState({ head_sha: p.head_sha })]));
  return new FakeGitHubClient({ pulls: { "o/r": pulls }, mergeStates: { ...mergeStates, ...states }, ...failures });
}

/** Writes `.supervisor/automate/<id>.md` as Loomwright does, cut down to what the kernel reads. */
function writeRun(
  over: { status?: string; itemStatus?: string; pr?: string | null; item?: string; ready?: string | null; pause?: string | null; id?: string; bytes?: number } = {},
): void {
  const lines = [
    "# Automate Run: tracker fixture",
    `## Status: ${over.status ?? "running"}`,
    "## Source",
    "- folder stories",
    "## Current",
    `- item: ${over.item ?? "stories/01.md"} | status: ${over.itemStatus ?? "running"} | pr: ${over.pr === undefined ? URL7 : over.pr} | branch: feature/x`,
    `- pause_reason: ${over.pause ?? "null"}`,
    ...(over.ready === undefined || over.ready === null ? [] : [`- ready_sha: ${over.ready} | ready_at: ${READY_AT} | termination_reason: converged`]),
    "## Progress",
    "- picked",
  ];
  const file = join(env.checkout, ".supervisor", "automate", `${over.id ?? RUN_ID}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n${over.bytes === undefined ? "" : "x".repeat(over.bytes)}`);
}

/** Writes a `kernel_automate_prepare`-shaped item and answers its checkout-relative path. */
function writeItem(ref: string, title: string): string {
  const rel = join(".supervisor", "requirements", "studio", itemFileName(ref));
  const file = join(env.checkout, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderItem({ ref, title, link: "https://tracker.example/PROJ-1", body: "A body" }, "o/r"));
  return rel;
}

const setPolicy = (kind: "solo" | "studio_approval" | "reviews", required: number | null = null): void => {
  env.store.prepare("INSERT INTO repo_policies (repo, policy_kind, required_reviews, set_by, set_at) VALUES ('o/r', ?, ?, 'owner', ?)").run(kind, required, clock().toISOString());
};

interface Track {
  repo: string;
  number: number;
  head_sha: string | null;
  state: string;
  ticket_ref: string | null;
  approvals: number;
  required: number | null;
  ci_state: string | null;
  owner_kind: string | null;
  run_file: string | null;
  item_id: string | null;
  merged_by_gate: number;
  updated: string;
}

const tracks = (): Track[] => env.store.prepare<[], Track>("SELECT repo, number, head_sha, state, ticket_ref, approvals, required, ci_state, owner_kind, run_file, item_id, merged_by_gate, updated FROM pr_tracks ORDER BY number").all();

interface Task {
  id: number;
  title: string;
  kind: string | null;
  state: string;
  assignee_agent: string | null;
  links_json: string | null;
  dedupe_key: string | null;
}

const tasks = (): Task[] => env.store.prepare<[], Task>("SELECT id, title, kind, state, assignee_agent, links_json, dedupe_key FROM tasks ORDER BY id").all();
const links = (t: Task | undefined): Record<string, unknown> => JSON.parse(t?.links_json ?? "null") as Record<string, unknown>;

/** One tick of a tracker over `fake`. */
async function tick(work: ReturnType<typeof createTrackerDueWork>): Promise<void> {
  minute += 1;
  await work(ctx());
}

const trackerOver = (fake: FakeGitHubClient): ReturnType<typeof createTrackerDueWork> => createTrackerDueWork({ client: () => fake });

// ---- The closed sets and the approvals word -------------------------------------------------------------

describe("the closed sets and approvalsWordOf", () => {
  it("are exactly their values", () => {
    expect(PR_TRACK_STATES).toEqual(["open", "draft", "ready", "parked", "merged", "closed"]);
    expect(PR_OWNER_KINDS).toEqual(["automate_live", "automate_parked", "owner", "other"]);
    expect(Object.isFrozen(PR_TRACK_STATES) && Object.isFrozen(PR_OWNER_KINDS)).toBe(true);
    expect(MAX_TRACKED_PER_PASS).toBe(25);
  });

  it("reads n/N for a reviews policy, the kind's own word for solo and studio_approval, and no_policy without one", () => {
    expect(approvalsWordOf("reviews", 1, 2)).toBe("1/2");
    expect(approvalsWordOf("reviews", 0, 3)).toBe("0/3");
    expect(approvalsWordOf("reviews", 2, null)).toBe("2");
    expect(approvalsWordOf("solo", 3, null)).toBe("solo");
    expect(approvalsWordOf("studio_approval", 0, null)).toBe("studio_approval");
    expect(approvalsWordOf(null, 1, null)).toBe("no_policy");
  });

  it("is one due work, no tool, route, handler or subcommand", () => {
    expect(trackerPart.name).toBe("tracker");
    expect(trackerPart.dueWork).toHaveLength(1);
    expect(trackerPart.tools).toEqual([]);
    expect(trackerPart.routes).toEqual([]);
    expect(trackerPart.handlers).toEqual({});
    expect(trackerPart.subcommands ?? []).toEqual([]);
  });
});

// ---- AC1: the walk --------------------------------------------------------------------------------------

describe("a pull request walked open, ready, parked, merged (AC1)", () => {
  it("records each state once with one event each, the task following, and no event for an unchanged pass", async () => {
    const item = writeItem("PROJ-1", "Add the greeting");
    let fake = fakeWith([pull()]);
    const work = createTrackerDueWork({ client: () => fake });

    // open: a running run names the PR, no READY head yet.
    writeRun({ item });
    fire();
    await tick(work);
    expect(tracks()).toEqual([
      expect.objectContaining({ repo: "o/r", number: 7, state: "open", head_sha: HEAD, ticket_ref: "PROJ-1", owner_kind: "automate_live", ci_state: "pending", run_file: RUN_ID, item_id: item, merged_by_gate: 0 }),
    ]);
    const [task] = tasks();
    expect(task).toMatchObject({ title: "Add the greeting", kind: "ticket_pr", state: "open", assignee_agent: "mason", dedupe_key: "pr:o/r#7" });
    expect(links(task)).toEqual({ ticket: "PROJ-1", pr: { repo: "o/r", number: 7, url: URL7 }, state: "open", approvals: "no_policy", ci: "pending", owner_kind: "automate_live" });
    expect(events(env.store, "task_created")).toHaveLength(1);

    // an unchanged pass writes nothing: no event, the row's `updated` stays.
    const before = tracks()[0] as Track;
    fire();
    await tick(work);
    expect(tracks()[0]).toEqual(before);
    expect(events(env.store, "pr_state_changed")).toHaveLength(1);

    // ready: the run item carries READY at the PR's head.
    writeRun({ item, ready: HEAD });
    fire();
    await tick(work);
    expect(tracks()[0]).toMatchObject({ state: "ready", owner_kind: "automate_live" });
    expect(links(tasks()[0])).toMatchObject({ state: "ready" });

    // parked awaiting_merge: a paused run parks the item.
    writeRun({ item, status: "paused", itemStatus: "awaiting_merge", ready: HEAD, pause: "awaiting_merge" });
    fire();
    await tick(work);
    expect(tracks()[0]).toMatchObject({ state: "parked", owner_kind: "automate_parked", merged_by_gate: 0 });
    expect(links(tasks()[0])).toMatchObject({ state: "parked", owner_kind: "automate_parked", reason: "awaiting_merge" });

    // merged: Loomwright's gate merged it and closed the item at the READY head.
    fake = fakeWith([pull({ state: "closed", merged: true })]);
    writeRun({ item, status: "done", itemStatus: "done", ready: HEAD });
    fire();
    await tick(work);
    expect(tracks()[0]).toMatchObject({ state: "merged", merged_by_gate: 1, run_file: RUN_ID, item_id: item });
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ state: "merged" });

    // exactly four changes, each with the task's id, in order.
    const changed = events(env.store, "pr_state_changed");
    expect(changed.map((e) => [e.payload["from"], e.payload["to"]])).toEqual([
      [null, "open"],
      ["open", "ready"],
      ["ready", "parked"],
      ["parked", "merged"],
    ]);
    for (const e of changed) {
      expect(e.task_id).toBe((task as Task).id);
      expect(e.actor).toBe("kernel");
      expect(e.payload).toMatchObject({ repo: "o/r", pr: 7, head_sha: HEAD });
    }
    expect(changed[2]?.payload["reason"]).toBe("awaiting_merge");
    expect(changed[0]?.payload["owner_kind"]).toBe("automate_live");

    // a fifth pass: a merged row ends; nothing is read and nothing is appended.
    const reads = fake.calls.length;
    fire();
    await tick(work);
    expect(fake.calls.length).toBe(reads);
    expect(events(env.store, "pr_state_changed")).toHaveLength(4);
  });

  it("reads merged_by_gate 0 for a PR merged at another head than the READY one", async () => {
    const item = writeItem("PROJ-1", "Add the greeting");
    writeRun({ item, status: "done", itemStatus: "done", ready: HEAD });
    const work = trackerOver(fakeWith([pull({ head_sha: B, state: "closed", merged: true })]));
    fire();
    await tick(work);
    expect(tracks()[0]).toMatchObject({ state: "merged", head_sha: B, merged_by_gate: 0 });
  });

  it("reads merged_by_gate 0 when the item is not done, whatever its READY head", async () => {
    writeRun({ status: "paused", itemStatus: "awaiting_merge", ready: HEAD });
    const work = trackerOver(fakeWith([pull({ state: "closed", merged: true })]));
    fire();
    await tick(work);
    expect(tracks()[0]).toMatchObject({ state: "merged", merged_by_gate: 0 });
  });

  it("puts merged before closed: a pull GitHub reports closed and merged is merged; closed unmerged is closed", async () => {
    writeRun({ pr: URL7 });
    writeRun({ pr: "https://github.com/o/r/pull/8", id: "2026-11-09-100001-tracker" });
    const fake = fakeWith([pull({ state: "closed", merged: true }), pull({ state: "closed", merged: false }, 8)]);
    fire();
    await tick(trackerOver(fake));
    expect(tracks().map((t) => [t.number, t.state])).toEqual([
      [7, "merged"],
      [8, "closed"],
    ]);
  });

  it("reads a draft as draft, and a run item with a READY head that is not the PR's head as open", async () => {
    writeRun({ ready: B });
    const work = trackerOver(fakeWith([pull({ draft: true })]));
    fire();
    await tick(work);
    expect(tracks()[0]).toMatchObject({ state: "draft" });
    const other = trackerOver(fakeWith([pull()]));
    fire();
    await tick(other);
    expect(tracks()[0]).toMatchObject({ state: "open" });
  });

  it("reads an escalated paused item as parked, with the item's status as its reason when it has no pause_reason", async () => {
    const item = writeItem("PROJ-2", "Escalated one");
    writeRun({ item, status: "paused", itemStatus: "escalated", pause: null });
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    expect(tracks()[0]).toMatchObject({ state: "parked", owner_kind: "automate_parked" });
    expect(events(env.store, "pr_state_changed")[0]?.payload["reason"]).toBe("escalated");
  });

  it("appends a change when the head moves, an approval lands or CI turns, and records the new values", async () => {
    writeRun();
    let fake = fakeWith([pull()]);
    const work = createTrackerDueWork({ client: () => fake });
    fire();
    await tick(work);
    fake = fakeWith([pull({ head_sha: B })], { "o/r#7": mergeState({ head_sha: B, approvals: 1, ci: "green" }) });
    fire();
    await tick(work);
    expect(tracks()[0]).toMatchObject({ head_sha: B, approvals: 1, ci_state: "green", state: "open" });
    const changed = events(env.store, "pr_state_changed");
    expect(changed).toHaveLength(2);
    expect(changed[1]?.payload).toMatchObject({ from: "open", to: "open", head_sha: B, approvals: 1, ci: "green" });
  });

  it("leaves run_file and item_id as they were once no run file names the PR", async () => {
    writeRun();
    const work = trackerOver(fakeWith([pull()]));
    fire();
    await tick(work);
    writeRun({ pr: null });
    fire();
    await tick(trackerOver(fakeWith([pull({ draft: true })])));
    expect(tracks()[0]).toMatchObject({ state: "draft", run_file: RUN_ID, item_id: "stories/01.md" });
  });
});

// ---- AC2: approvals -------------------------------------------------------------------------------------

describe("approvals against the repo's policy (AC2)", () => {
  async function run(): Promise<{ row: Track; task: Task | undefined }> {
    const item = writeItem("PROJ-1", "Add the greeting");
    writeRun({ item });
    fire();
    await tick(trackerOver(fakeWith([pull()], { "o/r#7": mergeState({ approvals: 1 }) })));
    return { row: tracks()[0] as Track, task: tasks()[0] };
  }

  it("reads 1/2 for a reviews: 2 repo with one approving review at the head", async () => {
    setPolicy("reviews", 2);
    const { row, task } = await run();
    expect(row).toMatchObject({ approvals: 1, required: 2 });
    expect(links(task)["approvals"]).toBe("1/2");
  });

  it("reads solo for a Solo repo, with no required count", async () => {
    setPolicy("solo");
    const { row, task } = await run();
    expect(row).toMatchObject({ approvals: 1, required: null });
    expect(links(task)["approvals"]).toBe("solo");
  });

  it("reads studio_approval for a Studio-approval repo", async () => {
    setPolicy("studio_approval");
    const { row, task } = await run();
    expect(row.required).toBeNull();
    expect(links(task)["approvals"]).toBe("studio_approval");
  });

  it("reads no_policy for a repo with none, and for an unset one", async () => {
    env.store.prepare("INSERT INTO repo_policies (repo, policy_kind) VALUES ('o/r', 'unset')").run();
    const { task } = await run();
    expect(links(task)["approvals"]).toBe("no_policy");
  });
});

// ---- When it reads GitHub --------------------------------------------------------------------------------

describe("when the tracker reads GitHub", () => {
  it("reads nothing until a trigger_fired is appended, and once per fire after that", async () => {
    writeRun();
    const fake = fakeWith([pull()]);
    const work = trackerOver(fake);
    await tick(work);
    expect(fake.calls).toEqual([]);
    expect(tracks()).toEqual([]);
    fire();
    await tick(work);
    const reads = fake.calls.length;
    expect(reads).toBeGreaterThan(0);
    await tick(work);
    await tick(work);
    expect(fake.calls.length).toBe(reads);
    fire();
    await tick(work);
    expect(fake.calls.length).toBe(reads * 2);
  });

  it("is not woken by other events (only trigger_fired)", async () => {
    writeRun();
    const fake = fakeWith([pull()]);
    env.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'trigger_missed', 'kernel', '{}')").run(clock().toISOString());
    await tick(trackerOver(fake));
    expect(fake.calls).toEqual([]);
  });

  it("re-reads on the first tick after a restart (a new due work) when a trigger ever fired", async () => {
    writeRun();
    const fake = fakeWith([pull()]);
    fire();
    await tick(trackerOver(fake));
    const reads = fake.calls.length;
    await tick(trackerOver(fake));
    expect(fake.calls.length).toBe(reads * 2);
    expect(events(env.store, "pr_state_changed")).toHaveLength(1);
  });

  it("builds no client and reads no Keychain when there is nothing to follow, and uses the injected client otherwise", async () => {
    const work = createTrackerDueWork();
    fire();
    await tick(work);
    expect(keychainReads.count).toBe(0);
    writeRun();
    const fake = fakeWith([pull()]);
    fire();
    await tick(trackerOver(fake));
    expect(keychainReads.count).toBe(0);
    expect(tracks()).toHaveLength(1);
  });

  it("reads at most MAX_TRACKED_PER_PASS pull requests a pass, the oldest updated first", async () => {
    const total = MAX_TRACKED_PER_PASS + 3;
    for (let n = 1; n <= total; n += 1) {
      env.store
        .prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, updated) VALUES ('o/r', ?, ?, 'open', ?)")
        .run(n, HEAD, `2026-11-09T08:${String(59 - n).padStart(2, "0")}:00.000Z`);
    }
    const fake = fakeWith([]);
    fire();
    await tick(trackerOver(fake));
    const read = fake.callsTo("getPull").map((c) => c.args[1]);
    expect(read).toHaveLength(MAX_TRACKED_PER_PASS);
    // updated falls as the number rises, so the oldest are the highest numbers.
    expect(read).toEqual(Array.from({ length: MAX_TRACKED_PER_PASS }, (_, i) => total - i));
  });

  it("follows a pr_tracks row with no run file until it ends, and never reads an ended one", async () => {
    env.store.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, owner_kind, updated) VALUES ('o/r', 9, ?, 'open', 'other', '2026-11-09T08:00:00.000Z')").run(HEAD);
    env.store.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, updated) VALUES ('o/r', 10, ?, 'merged', '2026-11-09T08:00:00.000Z')").run(HEAD);
    env.store.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, updated) VALUES ('o/r', 11, ?, 'closed', '2026-11-09T08:00:00.000Z')").run(HEAD);
    const fake = fakeWith([pull({ draft: true }, 9), pull({}, 10), pull({}, 11)]);
    fire();
    await tick(trackerOver(fake));
    expect(fake.callsTo("getPull").map((c) => c.args[1])).toEqual([9]);
    expect(tracks().map((t) => [t.number, t.state])).toEqual([
      [9, "draft"],
      [10, "merged"],
      [11, "closed"],
    ]);
    // A row never named by a run file has no run file or item.
    expect(tracks()[0]).toMatchObject({ run_file: null, item_id: null, merged_by_gate: 0 });
    // No ticket, so no task: the event carries no task id.
    expect(tasks()).toEqual([]);
    expect(events(env.store, "pr_state_changed")[0]).toMatchObject({ task_id: null });
  });

  it("does not follow a PR URL in a run file for a repo the workspace is not a clone of", async () => {
    writeRun({ pr: "https://github.com/x/y/pull/3" });
    const fake = fakeWith([pull()]);
    fire();
    await tick(trackerOver(fake));
    expect(fake.calls).toEqual([]);
    expect(tracks()).toEqual([]);
  });
});

// ---- Fail closed ----------------------------------------------------------------------------------------------

describe("a read that fails changes nothing", () => {
  it("writes nothing and appends nothing when the pull or its merge state cannot be read", async () => {
    writeRun();
    for (const method of ["getPull", "getPullMergeState"] as const) {
      const fake = fakeWith([pull()], {}, { failures: { [method]: { ok: false, error: "rate_limited", resets_at: "2026-11-09T12:00:00.000Z", rateLimit: { limit: 1, remaining: 0, reset_at: "2026-11-09T12:00:00.000Z" } } } });
      fire();
      await tick(trackerOver(fake));
      expect(fake.callsTo(method).length, method).toBeGreaterThan(0);
    }
    expect(tracks()).toEqual([]);
    expect(tasks()).toEqual([]);
    expect(events(env.store, "pr_state_changed")).toEqual([]);
  });

  it("leaves an existing row exactly as it was when a later read fails", async () => {
    writeRun();
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    const before = tracks();
    fire();
    await tick(trackerOver(fakeWith([pull({ draft: true })], {}, { failures: { getPull: { ok: false, error: "unreachable", rateLimit: null } } })));
    expect(tracks()).toEqual(before);
    expect(events(env.store, "pr_state_changed")).toHaveLength(1);
  });

  it("skips a PR whose workspace's run state cannot be read (never guesses an owner)", async () => {
    env.store.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, owner_kind, updated) VALUES ('o/r', 7, ?, 'open', 'automate_live', '2026-11-09T08:00:00.000Z')").run(HEAD);
    writeRun({ id: "2026-11-09-100002-big", bytes: 1024 * 1024 + 10, pr: null });
    const fake = fakeWith([pull({ author: "octo" })]);
    env.store.prepare("INSERT INTO connectors (kind, status, account_login) VALUES ('github', 'connected', 'octo')").run();
    fire();
    await tick(trackerOver(fake));
    expect(fake.calls).toEqual([]);
    expect(tracks()[0]).toMatchObject({ state: "open", owner_kind: "automate_live" });
    expect(events(env.store, "pr_state_changed")).toEqual([]);
  });

  it("classifies a PR with no workspace for its repo as other, never owner", async () => {
    env.store.prepare("INSERT INTO connectors (kind, status, account_login) VALUES ('github', 'connected', 'octo')").run();
    env.store.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, updated) VALUES ('p/q', 3, ?, 'open', '2026-11-09T08:00:00.000Z')").run(HEAD);
    const fake = new FakeGitHubClient({ pulls: { "p/q": [pull({ author: "octo", url: "https://github.com/p/q/pull/3" }, 3)] }, mergeStates: { "p/q#3": mergeState() } });
    fire();
    await tick(trackerOver(fake));
    expect(tracks()[0]).toMatchObject({ repo: "p/q", owner_kind: "other" });
  });
});

// ---- Owner kinds ----------------------------------------------------------------------------------------------

describe("the owner kind a track records", () => {
  it("is owner for the connected account's and the App's pull requests, and other for anyone else's", async () => {
    env.store.prepare("INSERT INTO connectors (kind, status, account_login, app_slug) VALUES ('github', 'connected', 'Octo', 'studio-app')").run();
    for (const n of [1, 2, 3]) env.store.prepare("INSERT INTO pr_tracks (repo, number, head_sha, state, updated) VALUES ('o/r', ?, ?, 'open', '2026-11-09T08:00:00.000Z')").run(n, HEAD);
    const fake = fakeWith([pull({ author: "octo" }, 1), pull({ author: "studio-app[bot]" }, 2), pull({ author: "stranger" }, 3)]);
    fire();
    await tick(trackerOver(fake));
    expect(tracks().map((t) => [t.number, t.owner_kind])).toEqual([
      [1, "owner"],
      [2, "owner"],
      [3, "other"],
    ]);
  });

  it("is automate_live for a running run's item, whoever wrote the PR", async () => {
    writeRun();
    fire();
    await tick(trackerOver(fakeWith([pull({ author: "stranger" })])));
    expect(tracks()[0]).toMatchObject({ owner_kind: "automate_live" });
  });
});

// ---- The task and the ticket ----------------------------------------------------------------------------------

describe("the linked task and the ticket ref", () => {
  it("reads the ref only from an item under .supervisor/requirements/studio/ and creates no task without one", async () => {
    // A look-alike item outside the folder, one with a symlink, one with an unsafe ref, one that is too large.
    const outside = join(env.checkout, "stories", "01.md");
    mkdirSync(dirname(outside), { recursive: true });
    writeFileSync(outside, "# Outside\n\n## Source ticket\n- dedupe ref: `PROJ-9`\n");
    writeRun({ item: "stories/01.md" });
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    expect(tracks()[0]).toMatchObject({ ticket_ref: null });
    expect(tasks()).toEqual([]);

    const dir = join(env.checkout, ".supervisor", "requirements", "studio");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad-ref.md"), "# T\n\n## Source ticket\n- dedupe ref: `has space; rm`\n");
    writeFileSync(join(dir, "big.md"), `# T\n\n## Source ticket\n- dedupe ref: \`PROJ-9\`\n${"x".repeat(200 * 1024)}`);
    symlinkSync(outside, join(dir, "link.md"));
    for (const [n, name] of [
      [1, "bad-ref.md"],
      [2, "big.md"],
      [3, "link.md"],
    ] as const) {
      writeRun({ item: `.supervisor/requirements/studio/${name}`, pr: `https://github.com/o/r/pull/${7 + n}`, id: `2026-11-09-10000${n}-x` });
    }
    writeRun({ item: "../../outside.md", pr: "https://github.com/o/r/pull/20", id: "2026-11-09-100009-x" });
    fire();
    await tick(trackerOver(fakeWith([pull({}, 8), pull({}, 9), pull({}, 10), pull({}, 20)])));
    expect(tracks().filter((t) => t.number > 7).map((t) => t.ticket_ref)).toEqual([null, null, null, null]);
    expect(tasks()).toEqual([]);
  });

  it("reads no ref through a studio folder that is a symlink out of the workspace", async () => {
    const elsewhere = join(env.root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "ticket-z.md"), "# T\n\n## Source ticket\n- dedupe ref: `PROJ-7`\n");
    mkdirSync(join(env.checkout, ".supervisor", "requirements"), { recursive: true });
    symlinkSync(elsewhere, join(env.checkout, ".supervisor", "requirements", "studio"));
    writeRun({ item: ".supervisor/requirements/studio/ticket-z.md" });
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    expect(tracks()[0]).toMatchObject({ ticket_ref: null });
    expect(tasks()).toEqual([]);
  });

  it("reads the ref from a quoted ticket body never: only the kernel's own unquoted line counts", async () => {
    const rel = join(".supervisor", "requirements", "studio", "ticket-x-00000000.md");
    mkdirSync(join(env.checkout, ".supervisor", "requirements", "studio"), { recursive: true });
    writeFileSync(join(env.checkout, rel), "# T\n\n## Source ticket\n- repo: o/r\n\n## Ticket data (untrusted)\n> - dedupe ref: `EVIL-1`\n");
    writeRun({ item: rel });
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    expect(tracks()[0]).toMatchObject({ ticket_ref: null });
  });

  it("updates the task a dedupe key already names instead of creating a second, and keeps the ref when the item is gone", async () => {
    const item = writeItem("PROJ-1", "Add the greeting");
    env.store.prepare("INSERT INTO tasks (title, kind, state, dedupe_key) VALUES ('Mine', 'x', 'waiting', 'pr:o/r#7')").run();
    writeRun({ item });
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0]).toMatchObject({ title: "Mine", state: "open" });
    expect(events(env.store, "task_created")).toEqual([]);
    expect(events(env.store, "pr_state_changed")[0]?.task_id).toBe(tasks()[0]?.id);

    writeRun({ item: "stories/gone.md", status: "paused", itemStatus: "awaiting_merge", pause: "awaiting_merge" });
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    expect(tracks()[0]).toMatchObject({ ticket_ref: "PROJ-1", state: "parked" });
    expect(links(tasks()[0])).toMatchObject({ ticket: "PROJ-1", state: "parked" });
  });

  it("uses the agent that owns the workspace as the task's assignee and the PR as its title when the item has no heading", async () => {
    const rel = join(".supervisor", "requirements", "studio", "ticket-y-11111111.md");
    mkdirSync(join(env.checkout, ".supervisor", "requirements", "studio"), { recursive: true });
    writeFileSync(join(env.checkout, rel), "## Source ticket\n- dedupe ref: `PROJ-3`\n");
    writeRun({ item: rel });
    fire();
    await tick(trackerOver(fakeWith([pull()])));
    expect(tasks()[0]).toMatchObject({ title: "o/r#7", assignee_agent: "mason" });
  });
});
