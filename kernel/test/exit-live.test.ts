// Opt-in live exit test (item 09, AC3 live variant): the phase 1 exit
// criterion with a REAL session through the real SDK and a real model
// (Haiku), on the owner's subscription token read from the Keychain (read
// only; the harness keeps the API token in memory). Never runs in CI or by
// default. The owner runs it on his machine:
//
//   cd kernel && npm run build && STUDIO_LIVE=1 npx vitest run test/exit-live.test.ts
//
// The harness starts the kernel with one queued message; its handler starts a
// session that calls `kernel_task_create` (key `exit-test-key`) and then runs
// `sleep 20`. Once the kernel's gate records the `allow` for that `sleep` and
// `ps` shows `sleep` running in the session's process group, the kernel is
// `kill -9`ed and started again. Same assertions as the
// deterministic test, except that a resumed model may run `sleep` again: the
// work completing is what is asserted. A run summary (timings, row counts,
// event kinds; never env or tokens, and any `sk-ant-…` string redacted) is
// written to the path printed at the end; the owner commits it as evidence.
// Whatever happens, `afterEach` stops the harnesses, kills every session group
// it recorded (ownership-checked) and removes the temp dir: no CLI outlives it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  EXIT_TEST_KEY,
  buildKernel,
  groupAlive,
  groupHasCommand,
  groupLeader,
  groupProbeCode,
  killOwnGroup,
  startHarness,
  stopHarnesses,
  tryDb,
  waitFor,
  withDb,
} from "./crash-helpers.js";

const LIVE = process.env.STUDIO_LIVE === "1";

/** Replace anything token-shaped before it is written anywhere. */
function redact(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]");
}

describe.skipIf(!LIVE)("live exit test: kill -9 mid-session, then restart (STUDIO_LIVE=1)", () => {
  let build: { root: string; outDir: string };
  let tmp: string | undefined;
  /** Session pgid ⇒ its leader's executable path, recorded while the leader is the live CLI. */
  const groups = new Map<number, string>();

  /** Record `pgid`'s leader the first time it can be read, for `afterEach`'s ownership-checked kill. */
  function track(pgid: number | null | undefined): void {
    if (pgid === null || pgid === undefined || groups.has(pgid)) return;
    const leader = groupLeader(pgid);
    if (leader !== undefined) groups.set(pgid, leader);
  }

  beforeAll(() => {
    build = buildKernel();
  }, 120_000);

  afterAll(() => {
    rmSync(build.root, { recursive: true, force: true });
  });

  afterEach(async () => {
    await stopHarnesses(30_000);
    for (const [pgid, leader] of groups) killOwnGroup(pgid, leader);
    groups.clear();
    if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("reaps the orphaned CLI group, resumes the session, one task for the key, the event done once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-exit-live-"));
    tmp = dir;
    const dataDir = join(dir, "data");
    const cwd = join(dir, "work");
    mkdirSync(cwd);
    const t0 = Date.now();
    const timings: Record<string, number> = {};
    const args = ["--live", "--out-dir", build.outDir, "--data-dir", dataDir, "--cwd", cwd];
    const scalar = (sql: string, ...p: unknown[]): unknown => withDb(dataDir, (db) => db.prepare(sql).pluck().get(...p));

    const first = await startHarness([...args, "--enqueue"], 60_000);
    timings["first_ready_ms"] = Date.now() - t0;

    // The gate writes the allow row BEFORE the CLI spawns `sleep`: wait for that
    // row, tracking each session group as soon as it is recorded.
    const session = await waitFor(
      "the tool_decision allow for sleep",
      () =>
        tryDb(dataDir, (db) => {
          for (const g of db.prepare<[], number>("SELECT pgid FROM sessions WHERE pgid IS NOT NULL").pluck().all()) track(g);
          return db
            .prepare<[], { id: number; pgid: number | null }>(
              `SELECT s.id, s.pgid FROM events e JOIN sessions s ON s.id = e.session_id
                WHERE e.kind = 'tool_decision' AND json_extract(e.payload_json, '$.decision') = 'allow'
                  AND json_extract(e.payload_json, '$.command') LIKE 'sleep%' LIMIT 1`,
            )
            .get();
        }),
      180_000,
      200,
    );
    const pgid = session.pgid as number;
    track(pgid);
    timings["sleep_allowed_ms"] = Date.now() - t0;
    // Kill only once `sleep` runs in the session's group (the command is running).
    await waitFor("sleep running in the session's process group", () => (groupHasCommand(pgid, "sleep") ? true : undefined), 30_000, 100);
    timings["sleep_running_ms"] = Date.now() - t0;
    first.child.kill("SIGKILL");
    await first.exited;
    expect(groupAlive(pgid)).toBe(true);

    await startHarness(args, 60_000);
    timings["restarted_ms"] = Date.now() - t0;
    const queueId = Number(scalar("SELECT id FROM event_queue ORDER BY id LIMIT 1"));
    await waitFor(
      "the redelivered event to finish",
      () => {
        const s = scalar("SELECT status FROM event_queue WHERE id = ?", queueId);
        return s === "pending" ? undefined : s;
      },
      300_000,
      500,
    );
    timings["finished_ms"] = Date.now() - t0;

    const kinds = withDb(dataDir, (db) =>
      db.prepare<[], { kind: string; n: number }>("SELECT kind, count(*) AS n FROM events GROUP BY kind ORDER BY kind").all(),
    );
    const statuses = withDb(dataDir, (db) =>
      db
        .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'session_status' AND session_id = ? ORDER BY id")
        .pluck()
        .all(session.id)
        .map((p) => JSON.parse(p) as { from: string | null; to: string; reason?: string }),
    );
    const summary = {
      test: "exit-live",
      at: new Date().toISOString(),
      timings,
      queue_status: scalar("SELECT status FROM event_queue WHERE id = ?", queueId),
      session_final_status: scalar("SELECT status FROM sessions WHERE id = ?", session.id),
      session_transitions: statuses.map((s) => ({ from: s.from, to: s.to, reason: s.reason ?? null })),
      rows: {
        tasks: Number(scalar("SELECT count(*) FROM tasks")),
        sessions: Number(scalar("SELECT count(*) FROM sessions")),
        event_done_for_queue_row: Number(
          scalar("SELECT count(*) FROM events WHERE kind = 'event_done' AND json_extract(payload_json, '$.queue_id') = ?", queueId),
        ),
      },
      event_kinds: Object.fromEntries(kinds.map((k) => [k.kind, k.n])),
      group_probe_after: groupProbeCode(pgid) ?? "alive",
    };
    const summaryPath = join(tmpdir(), `studio-exit-live-summary-${Date.now()}.json`);
    writeFileSync(summaryPath, `${redact(JSON.stringify(summary, null, 2))}\n`, { mode: 0o600 });
    console.log(`exit-live summary: ${summaryPath}`);

    expect(summary.queue_status).toBe("done");
    expect(statuses.find((s) => s.reason === "group_killed")).toMatchObject({ to: "interrupted" });
    expect(groupProbeCode(pgid)).toBe("ESRCH");
    expect(summary.session_final_status).toBe("completed");
    expect(summary.rows.tasks).toBe(1);
    expect(scalar("SELECT status FROM work_steps WHERE key = ?", `kernel_task_create:session-${session.id}:${EXIT_TEST_KEY}`)).toBe("done");
    expect(summary.rows.event_done_for_queue_row).toBe(1);
    expect(summary.rows.sessions).toBe(1);
  }, 600_000);
});
