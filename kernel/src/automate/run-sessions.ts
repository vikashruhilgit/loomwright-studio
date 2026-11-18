// Which kernel-started Loomwright run a session is (phase 8 item 23o). SQL only:
// no process, no SDK, no session manager, so the approvals store can import it.
//
// A run session is one the `automate-run` step of a `message` event carrying
// `automate_run` started: the step's stored `result_json.session_id` names it,
// and the event's payload is the launch (its kind, attribution and, per kind,
// backlog / PR / run id). A continuation of a run session (`kind: "continue"`,
// queued when the owner decides an approval that session asked for) is a run
// session too, through its own step.

import type { Store } from "../store/index.js";

/** The payload key that marks a `message` event as a kernel-started Loomwright run (any kind). */
export const AUTOMATE_RUN_KEY = "automate_run";

/** A run session's launch: the event's agent and its `automate_run` payload, as queued. */
export interface RunLaunch {
  readonly agent: string;
  readonly run: Readonly<Record<string, unknown>>;
}

/** The launch that started `sessionId`, or `undefined` when no kernel run step started it. */
export function runLaunchOf(store: Store, sessionId: number): RunLaunch | undefined {
  const row = store
    .prepare<[number], { payload_json: string }>(
      `SELECT q.payload_json FROM work_steps w JOIN event_queue q ON w.key = 'event:' || q.id || ':automate-run'
        WHERE w.status = 'done' AND json_valid(w.result_json) AND json_extract(w.result_json, '$.session_id') = ?
          AND json_valid(q.payload_json)
        ORDER BY q.id DESC LIMIT 1`,
    )
    .get(sessionId);
  if (row === undefined) return undefined;
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  const run = payload[AUTOMATE_RUN_KEY];
  if (typeof payload.agent !== "string" || typeof run !== "object" || run === null || Array.isArray(run)) return undefined;
  return { agent: payload.agent, run: run as Record<string, unknown> };
}

/**
 * Which run a launch is, for "the same run": a resume / merge / continuation of a
 * known run by its `run_id`, a backlog launch by its backlog, a PR drain by its PR,
 * each in its checkout. `undefined` when the payload names none of them.
 */
function runKeyOf(run: Readonly<Record<string, unknown>>): string | undefined {
  const where = typeof run.checkout === "string" ? run.checkout : undefined;
  if (where === undefined) return undefined;
  if (typeof run.run_id === "string") return `${where}\0run:${run.run_id}`;
  if (typeof run.backlog === "string") return `${where}\0backlog:${run.backlog}`;
  if (typeof run.pr === "number" && typeof run.repo === "string") return `${where}\0pr:${run.repo}#${run.pr}`;
  return undefined;
}

/**
 * The first kernel run session started after `sessionId` for the same run
 * (`runKeyOf`), or `undefined`. Its existence means the run moved on: a later
 * Resume, or a continuation already carrying it, so a decision on one of
 * `sessionId`'s held calls must not continue `sessionId` again (23s gap 3).
 * Honest limit: a backlog launch names no run id, so a later Resume of the run it
 * created (by `run_id`) is not matched to it.
 */
export function laterRunSessionOf(store: Store, sessionId: number, launch: RunLaunch): number | undefined {
  const key = runKeyOf(launch.run);
  if (key === undefined) return undefined;
  const rows = store
    .prepare<[number], { session_id: number; payload_json: string }>(
      `SELECT json_extract(w.result_json, '$.session_id') AS session_id, q.payload_json
         FROM work_steps w JOIN event_queue q ON w.key = 'event:' || q.id || ':automate-run'
        WHERE w.status = 'done' AND json_valid(w.result_json) AND json_valid(q.payload_json)
          AND json_type(w.result_json, '$.session_id') = 'integer' AND json_extract(w.result_json, '$.session_id') > ?
        ORDER BY session_id`,
    )
    .all(sessionId);
  for (const row of rows) {
    const run = (JSON.parse(row.payload_json) as Record<string, unknown>)[AUTOMATE_RUN_KEY];
    if (typeof run === "object" && run !== null && !Array.isArray(run) && runKeyOf(run as Record<string, unknown>) === key) return row.session_id;
  }
  return undefined;
}

/**
 * The `automate_run` payload that continues run session `sessionId` with
 * `prompt` (the owner's decision, kernel-written): the session's own launch
 * fields, `kind: "continue"`, `of` the kind it was launched as (a
 * continuation's own `of` carried on), `session` and `prompt`. The launch reads
 * `of` for the run's policy, so a continuation never runs under another kind's.
 */
export function continuePayloadOf(launch: RunLaunch, sessionId: number, prompt: string): Record<string, unknown> {
  const run = launch.run;
  const of = run.kind === "continue" ? run.of : (run.kind ?? "backlog");
  return { ...run, kind: "continue", of, session: sessionId, prompt };
}
