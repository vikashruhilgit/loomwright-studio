// The phase 1 exit criterion, deterministic (item 09, AC3/AC4): the kernel is
// a separate OS process (the crash harness over a kernel built into a temp
// dir), it is `kill -9`ed mid-session and started again, and the data dir is
// read read-only from here. The session is the harness's stand-in (a real
// process group led by a `claude`-named node, no model, no Keychain), so this
// runs in `npm test` on macOS and on Linux CI. The stand-in's leader forks a
// "tool command" into a new session and group, as the CLI's Bash tool does
// (H08): the kernel must record that group and the restarted kernel's reaper
// must kill it, not only the CLI's group.
//
// Every harness, stand-in and tool group this file starts is killed in
// afterEach (by its own recorded pid / pgid, ownership-checked), so a failing
// test leaks no process.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_TEST_KEY,
  buildKernel,
  groupAlive,
  groupProbeCode,
  killOwnGroup,
  makeClaudeLeader,
  startHarness,
  stopHarnesses,
  tryDb,
  waitFor,
  withDb,
} from "./crash-helpers.js";
import { makePluginDir } from "./session-fakes.js";

/** The stand-in leader's sleep: long, since the kill and the reaper end it; never waited out. */
const LEADER_SLEEP_MS = 60_000;

let build: { root: string; outDir: string };
let leader: string;
let pluginDir: string;
let tmp: string;
let dataDir: string;
let cwd: string;
const pgids = new Set<number>();

beforeAll(() => {
  build = buildKernel();
  leader = makeClaudeLeader(build.root);
  pluginDir = makePluginDir(build.root);
}, 120_000);

afterAll(() => {
  rmSync(build.root, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-exit-"));
  dataDir = join(tmp, "data");
  cwd = join(tmp, "work");
  mkdirSync(cwd);
});

afterEach(async () => {
  await stopHarnesses();
  for (const pgid of pgids) killOwnGroup(pgid, leader);
  pgids.clear();
  rmSync(tmp, { recursive: true, force: true });
});

function harnessArgs(extra: readonly string[] = []): string[] {
  return [
    "--out-dir", build.outDir,
    "--data-dir", dataDir,
    "--cwd", cwd,
    "--plugin-dir", pluginDir,
    "--leader", leader,
    "--sleep-ms", String(LEADER_SLEEP_MS),
    ...extra,
  ];
}

interface SessionRowView {
  id: number;
  agent: string;
  status: string;
  pgid: number | null;
  /** Recorded asynchronously after the pgid; the reaper kills the group only once it is set. */
  leader_started_at: string | null;
}

/** The stand-in's tool group as the kernel recorded it (`session_groups`), once it is. */
function toolGroup(sessionId: number): { pgid: number; resolution: string | null } | undefined {
  return tryDb(dataDir, (db) =>
    db
      .prepare<[number], { pgid: number; resolution: string | null }>("SELECT pgid, resolution FROM session_groups WHERE session_id = ? ORDER BY pgid LIMIT 1")
      .get(sessionId),
  );
}

/** The exit test's one session row (with a recorded pgid), once it exists. */
function sessionRow(): SessionRowView | undefined {
  return tryDb(dataDir, (db) =>
    db.prepare<[], SessionRowView>("SELECT id, agent, status, pgid, leader_started_at FROM sessions WHERE agent LIKE 'exit-test:event-%' ORDER BY id LIMIT 1").get(),
  );
}

function scalar(sql: string, ...params: unknown[]): unknown {
  return withDb(dataDir, (db) => db.prepare(sql).pluck().get(...params));
}

function count(sql: string, ...params: unknown[]): number {
  return Number(scalar(sql, ...params));
}

function statusEvents(sessionId: number): { from: string | null; to: string; reason?: string }[] {
  return withDb(dataDir, (db) =>
    db
      .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'session_status' AND session_id = ? ORDER BY id")
      .pluck()
      .all(sessionId)
      .map((p) => JSON.parse(p) as { from: string | null; to: string; reason?: string }),
  );
}

/** Restart without --enqueue and wait for the queue row to be processed. */
async function restartAndFinish(queueId: number): Promise<void> {
  const second = await startHarness(harnessArgs());
  const status = await waitFor(
    "the redelivered event to finish",
    () => {
      const s = withDb(dataDir, (db) => db.prepare<[number], string>("SELECT status FROM event_queue WHERE id = ?").pluck().get(queueId));
      return s === "pending" ? undefined : s;
    },
    30_000,
  );
  const lastError = withDb(dataDir, (db) => db.prepare<[number], string | null>("SELECT last_error FROM event_queue WHERE id = ?").pluck().get(queueId));
  expect(status, `event ${queueId} ended ${String(status)}: ${String(lastError)}; harness stderr: ${second.stderr()}`).toBe("done");
}

/** The assertions both scenarios share, after the restart finished the event. */
function assertExitCriterion(queueId: number, session: SessionRowView, pgid: number, toolPgid: number): void {
  // The orphaned group was reaped by the restarted kernel, and is gone.
  const events = statusEvents(session.id);
  const killed = events.find((e) => e.reason === "group_killed");
  expect(killed, JSON.stringify(events)).toMatchObject({ to: "interrupted", reason: "group_killed" });
  expect(groupProbeCode(pgid)).toBe("ESRCH");
  // And so is the tool's group, outside the CLI's (H08): killed by the reaper after its ownership check.
  expect(groupProbeCode(toolPgid)).toBe("ESRCH");
  expect(toolGroup(session.id)).toEqual({ pgid: toolPgid, resolution: "killed" });

  // It went through `interrupted`, was resumed, and completed.
  const after = events.slice(events.indexOf(killed as (typeof events)[number]) + 1);
  expect(after.some((e) => e.from === "interrupted" && e.to === "starting")).toBe(true);
  expect(events.at(-1)).toMatchObject({ to: "completed", reason: "result_success" });
  expect(scalar("SELECT status FROM sessions WHERE id = ?", session.id)).toBe("completed");

  // Exactly one task for the key, and its work step is done.
  expect(count("SELECT count(*) FROM tasks")).toBe(1);
  expect(count("SELECT count(*) FROM events WHERE kind = 'task_created'")).toBe(1);
  const stepKey = `kernel_task_create:session-${session.id}:${EXIT_TEST_KEY}`;
  expect(scalar("SELECT status FROM work_steps WHERE key = ?", stepKey)).toBe("done");

  // No event completed twice, and no second session was started for it.
  expect(count("SELECT count(*) FROM events WHERE kind = 'event_done' AND json_extract(payload_json, '$.queue_id') = ?", queueId)).toBe(1);
  expect(count("SELECT count(*) FROM sessions WHERE agent = ?", `exit-test:event-${queueId}`)).toBe(1);
  expect(count("SELECT count(*) FROM sessions")).toBe(1);
  expect(scalar("SELECT status FROM event_queue WHERE id = ?", queueId)).toBe("done");
}

describe("kill -9 mid-session, then restart (phase 1 exit, deterministic)", () => {
  it("AC3: reaps the orphaned group, resumes the session, one task, the event done once", async () => {
    const first = await startHarness(harnessArgs(["--enqueue"]));

    // Mid-command: the task was created, the stand-in's `claude` group runs,
    // and the leader's start time (read asynchronously) is on disk, so the
    // restarted kernel's reaper can prove the group is the session's.
    const session = await waitFor("task_created, a live stand-in group and its recorded leader start time", () => {
      const row = sessionRow();
      if (row?.pgid == null) return undefined;
      pgids.add(row.pgid);
      const created = tryDb(dataDir, (db) => db.prepare("SELECT count(*) FROM events WHERE kind = 'task_created'").pluck().get() as number);
      return created === 1 && row.leader_started_at !== null && groupAlive(row.pgid) ? row : undefined;
    });
    const pgid = session.pgid as number;
    const queueId = count("SELECT id FROM event_queue ORDER BY id LIMIT 1");
    // The stand-in calls the tool only once its tool group is recorded, so it is by now.
    const toolPgid = (await waitFor("the recorded tool group", () => toolGroup(session.id), 5_000)).pgid;
    pgids.add(toolPgid);
    expect(toolPgid).not.toBe(pgid);

    first.child.kill("SIGKILL");
    expect((await first.exited).signal).toBe("SIGKILL");
    // The orphan exists: the kernel died, its session's group and the tool's group did not.
    expect(groupAlive(pgid)).toBe(true);
    expect(groupAlive(toolPgid)).toBe(true);
    expect(count("SELECT count(*) FROM event_queue WHERE status = 'pending'")).toBe(1);

    await restartAndFinish(queueId);
    assertExitCriterion(queueId, session, pgid, toolPgid);
    expect(count("SELECT count(*) FROM work_steps WHERE key = ?", `event:${queueId}:start-session`)).toBe(1);
  }, 90_000);

  it("AC4: a kill inside kernel_task_create's transaction leaves no task; after the restart there is exactly one", async () => {
    const first = await startHarness(harnessArgs(["--enqueue", "--fault", "task-create"]));

    // The harness SIGKILLs itself right after the INSERT INTO tasks, before the commit.
    const exit = await first.exited;
    expect(exit.signal, first.stderr()).toBe("SIGKILL");
    const session = await waitFor("the session row", sessionRow, 5_000);
    const pgid = session.pgid as number;
    expect(pgid).toBeGreaterThan(1);
    // The harness faults only once this is recorded (else it exits 1 with a named precondition error).
    expect(session.leader_started_at).not.toBeNull();
    pgids.add(pgid);
    expect(groupAlive(pgid)).toBe(true);
    // Recorded before the fault (the stand-in waits for it), and alive.
    const toolPgid = (await waitFor("the recorded tool group", () => toolGroup(session.id), 5_000)).pgid;
    pgids.add(toolPgid);
    expect(groupAlive(toolPgid)).toBe(true);
    // Nothing of the interrupted transaction committed.
    expect(count("SELECT count(*) FROM tasks")).toBe(0);
    expect(count("SELECT count(*) FROM events WHERE kind = 'task_created'")).toBe(0);
    expect(count("SELECT count(*) FROM work_steps WHERE key LIKE 'kernel_task_create:%'")).toBe(0);
    const queueId = count("SELECT id FROM event_queue ORDER BY id LIMIT 1");

    // The restart runs without the fault: the resumed stand-in calls the tool again.
    await restartAndFinish(queueId);
    assertExitCriterion(queueId, session, pgid, toolPgid);
  }, 90_000);
});
