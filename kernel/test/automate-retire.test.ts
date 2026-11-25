// Phase 8 item 27b: the owner's Retire for an old paused or stranded run.
//
//   - AC3: `POST /automate/paused-runs/:run_id/retire` (body exactly `{agent, checkout}`)
//     records one `automate_run_retired` event; the run is no longer listed by
//     `GET /automate/paused-runs` nor resumable (Resume and Reply answer 404); a run
//     that is live or has a resume or continuation queued is refused 409. The kernel
//     never writes, moves or deletes the run file (invariant 4).
//   - AC4 (the retire route): a later `kernel_automate_prepare` drops the retired
//     run's unfinished items `run_retired`, even after the run file is deleted.
//
// A temp store and checkout, no network, never the SDK or a model.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTOMATE_RUN_KEY } from "../src/automate/launch.js";
import { RUN_RETIRED_EVENT } from "../src/automate/retired-runs.js";
import { createAutomateRunnerTools } from "../src/automate/runner.js";
import { BACKLOG_FILE, STUDIO_ITEMS_DIR, itemFileName } from "../src/automate/tickets-to-items.js";
import type { ContributedRouteResponse } from "../src/features/contribution.js";
import { listPausedRuns, resumeRoutes } from "../src/gui/paused-runs.js";
import { enqueueEvent } from "../src/loop/index.js";
import { toolEnv, writeRunLock } from "./fixtures/loomwright-run-files/harness.js";
import type { ToolEnv } from "./fixtures/loomwright-run-files/harness.js";

const RUN_ID = "automate-2026-11-20-001";
const issue = (n: number) => ({ ref: `o/r#${n}`, title: `Issue ${n}`, link: `https://github.com/o/r/issues/${n}`, body: "Do it." });
const NAME_21 = itemFileName("o/r#21");
const NAME_12 = itemFileName("o/r#12");
const rel = (name: string): string => `${STUDIO_ITEMS_DIR}/${name}`;

/** The old run, as the 2026-11-20 run file read: paused on #21, with #12 still queued (and #21 named twice). */
const OLD_RUN = [
  "# Automate Run: Studio tickets — o/r",
  "## Status: paused",
  "## Source",
  `- backlog ${STUDIO_ITEMS_DIR}/${BACKLOG_FILE}`,
  "## Queue",
  `- [ ] ${rel(NAME_21)}`,
  `- [ ] ${rel(NAME_12)}`,
  "## Current",
  `- item: ${rel(NAME_21)} | status: awaiting_merge | pr: https://github.com/o/r/pull/9 | branch: feature/21`,
  "- pause_reason: trail_pr_open",
  "",
].join("\n");

let env: ToolEnv;
let live: { playbook: number };

const runPath = (runId = RUN_ID): string => join(env.checkout, ".supervisor", "automate", `${runId}.md`);

function writeRun(text: string, runId = RUN_ID): void {
  mkdirSync(join(env.checkout, ".supervisor", "automate"), { recursive: true });
  writeFileSync(runPath(runId), text);
}

/** The kernel run event an earlier handover queued for this checkout: what Resume is attributed to. */
function queueSourceLaunch(): void {
  const run = { repo: "o/r", backlog: join(env.checkout, STUDIO_ITEMS_DIR, BACKLOG_FILE), checkout: env.checkout, playbook: live.playbook, playbook_version: 1, task: null, source_session: 99 };
  const id = enqueueEvent(env.store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: run } }).id;
  env.store.prepare("UPDATE event_queue SET status = 'done' WHERE id = ?").run(id);
}

async function post(action: "retire" | "resume" | "reply", body: unknown, runId = RUN_ID): Promise<ContributedRouteResponse> {
  const route = resumeRoutes.find((r) => r.path === `/automate/paused-runs/:run_id/${action}`);
  if (route === undefined) throw new Error(`no ${action} route`);
  return route.handler({ params: { run_id: runId }, query: {}, body, store: env.store, now: () => new Date("2026-11-25T09:00:00.000Z") } as never);
}

const retire = (body: unknown = { agent: "mason", checkout: env.checkout }, runId = RUN_ID) => post("retire", body, runId);

const retiredRows = (): { at: string; payload: unknown }[] =>
  env.store
    .prepare<[string], { at: string; payload_json: string }>("SELECT at, payload_json FROM events WHERE kind = ? ORDER BY id")
    .all(RUN_RETIRED_EVENT)
    .map((r) => ({ at: r.at, payload: JSON.parse(r.payload_json) as unknown }));

beforeEach(() => {
  env = toolEnv("studio-retire-");
  live = { playbook: env.playbook("live") };
  env.store.prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, status, created_by, charter_json) VALUES ('mason', 'Mason', 'crab', 'crew-teal', 'active', 'owner', '{}')").run();
  writeRun(OLD_RUN);
});

afterEach(() => {
  env.close();
});

describe("POST /automate/paused-runs/:run_id/retire (27b)", () => {
  it("records one automate_run_retired event with the run file's studio items, and answers them", async () => {
    queueSourceLaunch();
    const res = await retire();
    expect(res).toEqual({ status: 200, body: { run_id: RUN_ID, agent: "mason", checkout: env.checkout, items: [NAME_21, NAME_12] } });
    expect(retiredRows()).toEqual([{ at: "2026-11-25T09:00:00.000Z", payload: { checkout: env.checkout, run_id: RUN_ID, items: [NAME_21, NAME_12] } }]);
  });

  it("retired run not listed: GET /automate/paused-runs no longer shows it, while another paused run in the checkout stays", async () => {
    writeRun("# Automate Run: other\n## Status: paused\n", "automate-2026-11-21-001");
    expect(listPausedRuns(env.store).runs.map((r) => r.run_id)).toEqual([RUN_ID, "automate-2026-11-21-001"]);
    expect((await retire()).status).toBe(200);
    expect(listPausedRuns(env.store).runs.map((r) => r.run_id)).toEqual(["automate-2026-11-21-001"]);
  });

  it("Resume answers 404 after a retire, and so do Reply and a second Retire; nothing is queued", async () => {
    queueSourceLaunch();
    expect(listPausedRuns(env.store).runs[0]).toMatchObject({ run_id: RUN_ID, blocked: null });
    expect((await retire()).status).toBe(200);
    const body = { agent: "mason", checkout: env.checkout };
    expect(await post("resume", body)).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await post("reply", { ...body, text: "Redo it." })).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await retire()).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(retiredRows()).toHaveLength(1);
    const pending = env.store.prepare("SELECT COUNT(*) FROM event_queue WHERE status = 'pending'").pluck().get();
    expect(pending).toBe(0);
  });

  it("run file unchanged and not moved: the kernel reads Loomwright's file and never writes, moves or deletes it", async () => {
    const folder = join(env.checkout, ".supervisor", "automate");
    const before = { names: readdirSync(folder).sort(), bytes: readFileSync(runPath()), mtime: statSync(runPath()).mtimeMs };
    expect((await retire()).status).toBe(200);
    expect(readdirSync(folder).sort()).toEqual(before.names);
    expect(readFileSync(runPath()).equals(before.bytes)).toBe(true);
    expect(statSync(runPath()).mtimeMs).toBe(before.mtime);
  });

  it("a block that only stops a Resume does not stop a retire: a run Studio never started is retired", async () => {
    expect(listPausedRuns(env.store).runs[0]?.blocked).toBe("no_kernel_run");
    expect((await retire()).status).toBe(200);
  });

  it("refuses 409 a run that is live (a live lock holder), even one Studio never started, and records nothing", async () => {
    writeRunLock(env.checkout, process.pid);
    // The list names its first block (`no_kernel_run`), but the run is live all the same.
    expect(listPausedRuns(env.store).runs[0]?.blocked).toBe("no_kernel_run");
    expect(await retire()).toEqual({ status: 409, body: { error: "run_live" } });
    queueSourceLaunch();
    expect(listPausedRuns(env.store).runs[0]?.blocked).toBe("run_live");
    expect(await retire()).toEqual({ status: 409, body: { error: "run_live" } });
    expect(retiredRows()).toEqual([]);
    expect(listPausedRuns(env.store).runs.map((r) => r.run_id)).toEqual([RUN_ID]);
  });

  it("refuses 409 a run with a resume queued, or a continuation queued, and records nothing", async () => {
    queueSourceLaunch();
    expect((await post("resume", { agent: "mason", checkout: env.checkout })).status).toBe(200);
    expect(await retire()).toEqual({ status: 409, body: { error: "resume_queued" } });
    env.store.prepare("UPDATE event_queue SET status = 'done' WHERE status = 'pending'").run();
    enqueueEvent(env.store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: { kind: "continue", run_id: RUN_ID, checkout: env.checkout } } });
    expect(listPausedRuns(env.store).runs[0]?.blocked).toBe("continuation_queued");
    expect(await retire()).toEqual({ status: 409, body: { error: "continuation_queued" } });
    expect(retiredRows()).toEqual([]);
  });

  it("refuses 409 approval_pending while a run session in the checkout holds a pending approval, and retires once it is decided", async () => {
    queueSourceLaunch();
    // A backlog run session that ended its turn on a held push: its launch names no run id.
    const sessionId = Number(env.store.prepare("INSERT INTO sessions (agent, status, cwd) VALUES ('mason', 'completed', ?)").run(env.checkout).lastInsertRowid);
    const run = { repo: "o/r", backlog: join(env.checkout, STUDIO_ITEMS_DIR, BACKLOG_FILE), checkout: env.checkout, playbook: live.playbook, playbook_version: 1, task: null, source_session: 99 };
    const launch = enqueueEvent(env.store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: run } }).id;
    env.store.prepare("UPDATE event_queue SET status = 'done' WHERE id = ?").run(launch);
    env.store.prepare("INSERT INTO work_steps (key, status, result_json) VALUES (?, 'done', ?)").run(`event:${launch}:automate-run`, JSON.stringify({ session_id: sessionId }));
    const approval = Number(
      env.store.prepare("INSERT INTO approvals (requesting_agent, requesting_session, action, payload_json) VALUES ('mason', ?, 'Bash', '{}')").run(sessionId).lastInsertRowid,
    );
    expect(await retire()).toEqual({ status: 409, body: { error: "approval_pending" } });
    // The owner decides it.
    env.store.prepare("UPDATE approvals SET status = 'denied' WHERE id = ?").run(approval);
    // Deciding it queues a continuation of that backlog session, which names no run id: still refused.
    const cont = enqueueEvent(env.store, { kind: "message", payload: { agent: "mason", [AUTOMATE_RUN_KEY]: { ...run, kind: "continue", of: "backlog", session: sessionId, prompt: "Denied." } } }).id;
    expect(await retire()).toEqual({ status: 409, body: { error: "continuation_queued" } });
    expect(retiredRows()).toEqual([]);
    env.store.prepare("UPDATE event_queue SET status = 'done' WHERE id = ?").run(cont);
    expect((await retire()).status).toBe(200);
  });

  it("a pending approval of a crew session that is no run session does not stop a retire", async () => {
    const sessionId = Number(env.store.prepare("INSERT INTO sessions (agent, status, cwd) VALUES ('mason', 'completed', ?)").run(env.checkout).lastInsertRowid);
    env.store.prepare("INSERT INTO approvals (requesting_agent, requesting_session, action, payload_json) VALUES ('mason', ?, 'Bash', '{}')").run(sessionId);
    expect((await retire()).status).toBe(200);
  });

  it("refuses what the list would not show 404, and a bad id or body 400, recording nothing", async () => {
    expect(await retire({ agent: "mason", checkout: env.checkout }, "automate-2026-11-20-002")).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await retire({ agent: "ghost", checkout: env.checkout })).toMatchObject({ status: 404 });
    expect(await retire({ agent: "mason", checkout: join(env.root, "elsewhere") })).toMatchObject({ status: 404 });
    expect(await retire({ agent: "mason", checkout: env.checkout }, "../etc")).toEqual({ status: 400, body: { error: "invalid_run_id" } });
    for (const body of [undefined, null, [], { agent: "mason" }, { agent: "mason", checkout: env.checkout, extra: 1 }, { agent: 1, checkout: env.checkout }]) {
      expect(await post("retire", body), JSON.stringify(body)).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    }
    expect(retiredRows()).toEqual([]);
  });

  it("records a run that names no studio item with no items: its card still goes", async () => {
    writeRun("# Automate Run: early\n## Status: paused\n## Current\n- item: null | status: null | pr: null | branch: null\n- pause_reason: trail_pr_open\n");
    expect(await retire()).toMatchObject({ status: 200, body: { items: [] } });
    expect(listPausedRuns(env.store).runs).toEqual([]);
  });
});

describe("a later handover never carries a retired run's items (27b)", () => {
  const prepare = async (tickets: readonly Record<string, unknown>[]): Promise<Record<string, unknown>> => {
    // No GitHub client and no poll: every earlier ticket the check reaches reads `unverified` (kept), so only the retire drops.
    const tools = createAutomateRunnerTools({ carry: { github: () => undefined } });
    const answer = await env.call(tools, "kernel_automate_prepare", { repo: "o/r", tickets }, live);
    if (answer.isError) throw new Error(`expected an answer, got an error: ${answer.text}`);
    return answer.value as Record<string, unknown>;
  };
  const checklist = (): string[] =>
    readFileSync(join(env.checkout, STUDIO_ITEMS_DIR, BACKLOG_FILE), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- ["));

  it("later prepare drops retired items run_retired after the run file is deleted", async () => {
    rmSync(runPath());
    await prepare([issue(21), issue(12)]);
    writeRun(OLD_RUN);
    expect((await retire()).status).toBe(200);
    // The owner later removes the file (or Loomwright archives it): the retire record still drops its items.
    rmSync(runPath());
    const out = await prepare([issue(30)]);
    expect(out["dropped"]).toEqual([
      { item: rel(NAME_21), ref: "o/r#21", reason: "run_retired" },
      { item: rel(NAME_12), ref: "o/r#12", reason: "run_retired" },
    ]);
    expect(out["carried"]).toEqual([]);
    expect(out["unverified"]).toEqual([]);
    expect(checklist()).toEqual([`- [ ] ${rel(itemFileName("o/r#30"))}`]);
  });

  it("a retired ticket handed over again is carried at a later handover that does not hand it over (the retire applies only to earlier lines)", async () => {
    rmSync(runPath());
    await prepare([issue(21), issue(12)]);
    writeRun(OLD_RUN);
    expect((await retire()).status).toBe(200);
    rmSync(runPath());
    // The playbook hands #21 over again: its poll lists it open.
    const again = await prepare([issue(21)]);
    expect(again["dropped"]).toEqual([{ item: rel(NAME_12), ref: "o/r#12", reason: "run_retired" }]);
    const out = await prepare([issue(30)]);
    expect(out["dropped"]).toEqual([]);
    expect(out["carried"]).toEqual([rel(NAME_21)]);
    expect(out["unverified"]).toEqual([rel(NAME_21)]);
    expect(checklist()).toEqual([`- [ ] ${rel(NAME_21)}`, `- [ ] ${rel(itemFileName("o/r#30"))}`]);
  });

  it("while the retired run's file is still there, its items are not carried either (the 23i run-file rule)", async () => {
    rmSync(runPath());
    await prepare([issue(21), issue(12), issue(13)]);
    writeRun(OLD_RUN);
    expect((await retire()).status).toBe(200);
    const out = await prepare([issue(30)]);
    expect(out["carried"]).toEqual([rel(itemFileName("o/r#13"))]);
    expect(out["unverified"]).toEqual([rel(itemFileName("o/r#13"))]);
    expect(checklist()).toEqual([`- [ ] ${rel(itemFileName("o/r#13"))}`, `- [ ] ${rel(itemFileName("o/r#30"))}`]);
  });
});
