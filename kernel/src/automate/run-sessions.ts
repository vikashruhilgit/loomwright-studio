// Which kernel-started Loomwright run a session is (phase 8 item 23o). SQL only:
// no process, no SDK, no session manager, so the approvals store can import it.
//
// A run session is one the `automate-run` step of a `message` event carrying
// `automate_run` started: the step's stored `result_json.session_id` names it,
// and the event's payload is the launch (its kind, attribution and, per kind,
// backlog / PR / run id). A continuation of a run session (`kind: "continue"`,
// queued when the owner decides an approval that session asked for) is a run
// session too, through its own step.

import { resolve } from "node:path";
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

/** The longest owner reply to a run session (`runReplyPrompt`), well inside a continuation's prompt limit. */
export const RUN_REPLY_MAX = 4000;

/**
 * The newest kernel run session of run `runId` in `checkout` (each side compared
 * resolved), or `undefined`. A backlog launch names no run id, so only a session a
 * resume, a merge or a continuation of one started is found (the 23s limit).
 */
export function latestRunSessionOf(store: Store, checkout: string, runId: string): number | undefined {
  const want = resolve(checkout);
  const rows = store
    .prepare<[], { session_id: number; payload_json: string }>(
      `SELECT json_extract(w.result_json, '$.session_id') AS session_id, q.payload_json
         FROM work_steps w JOIN event_queue q ON w.key = 'event:' || q.id || ':automate-run'
        WHERE w.status = 'done' AND json_valid(w.result_json) AND json_valid(q.payload_json)
          AND json_type(w.result_json, '$.session_id') = 'integer'
        ORDER BY session_id DESC`,
    )
    .all();
  for (const row of rows) {
    const run = (JSON.parse(row.payload_json) as Record<string, unknown>)[AUTOMATE_RUN_KEY];
    if (typeof run !== "object" || run === null || Array.isArray(run)) continue;
    const r = run as Record<string, unknown>;
    if (r.run_id === runId && typeof r.checkout === "string" && resolve(r.checkout) === want) return row.session_id;
  }
  return undefined;
}

/** The last thing session `sessionId` said (its newest `assistant_text`), or `null`. Model text: untrusted, shown as data. */
export function lastSessionMessage(store: Store, sessionId: number): string | null {
  const payload = store
    .prepare<[number], string>("SELECT payload_json FROM session_output WHERE session_id = ? AND kind = 'assistant_text' ORDER BY seq DESC LIMIT 1")
    .pluck()
    .get(sessionId);
  if (payload === undefined) return null;
  try {
    const text = (JSON.parse(payload) as { text?: unknown }).text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/**
 * What a run session is told when the owner replies to it (its last message,
 * typically a question it ended its turn on): the owner's own words, framed by
 * the kernel, then the same instruction to carry the run on as a decision's.
 * "Act on that reply" alone let the model do the item itself (live: reply "Redo
 * it." to session 235; session 236 branched, committed and asked to push with no
 * driver call, Launch Pad or Supervisor), so the frame names the run's driver as
 * the only way to act on it. Generic: it names no phase or file, only the driver
 * every run kind has.
 */
export function runReplyPrompt(reply: string): string {
  return `The owner replied to your last message: ${JSON.stringify(reply)}. Act on that reply only through this run's own steps: ask the run's driver for its next step and do what it hands out, so the item's work goes through the driver's spawns (Launch Pad and the Supervisor), never done directly in this session. Then carry on with this run from where it stopped. Keep going through its remaining steps until the run ends or another call is held for the owner; do not end your turn between steps.`;
}

/**
 * What a continued run session is told after the owner's decision text: the
 * decision covers one held call, and the run goes on past it. Without it a
 * session repeated the approved call, handed its result to the driver and ended
 * its turn at the next phase, so nothing carried the run on (live: approval 59,
 * session 233 stopped at "Phase 4.5 is next. I haven't started it yet").
 * Kernel-written; names no phase, so it holds for any run kind.
 */
export function runContinuationPrompt(decisionText: string, denied: boolean): string {
  const tail = denied
    ? "Then carry on with this run from where it stopped, without that call, as the run's own steps say for a refused step. Keep going until the run ends or another call is held for the owner."
    : "Then carry on with this run from where it stopped. Keep going through its remaining steps until the run ends or another call is held for the owner; do not end your turn between steps.";
  return `${decisionText} ${tail}`;
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
