// The `gui` feature's `paused-runs` part (phase 8 item 23j): the owner's Resume for
// a paused Loomwright run, the read and write routes behind the Tasks screen's
// "Parked run" card, on the loopback API (bearer token, like every gui route).
// It lives here, not under `automate/`, which holds no write route (its merge-scan
// test refuses one):
//
//   GET  /automate/paused-runs                  {runs, unreadable}: every paused run
//                                               file in a crew member's workspaces
//   POST /automate/paused-runs/:run_id/resume   {agent, checkout} → {queue_id}: queue
//                                               the kernel's resume run for it
//
// Why: a run that parks (here `trail_pr_open`, the 23h cause, at its first step)
// could only start again through a crew session's `kernel_automate_prepare`, and a
// crew session wakes only for a poll item that is not a duplicate, so nothing in
// Studio could ever continue it. Resume queues the same kind of kernel event
// prepare queues (`../automate/launch.ts`), with `kind: "resume"`: the kernel starts
// `/loomwright:automate --resume <run_id> --inline-phases` (safe mode) as its own
// session, with every launch check (playbook live, crew member on, the source
// session's model, the workspace, single drain, the run still paused).
//
// Attribution: the run is the crew member's whose kernel run last drained the
// checkout (the newest `automate_run` event for that checkout among the crew
// members that list it as a workspace): its repo, playbook, playbook version,
// task and source session. A checkout several crew members list is read once, so
// each run is listed once. A paused run Studio
// never started a run for (no such event) is listed and not resumable
// (`no_kernel_run`). Mechanism only (invariant 1): when to resume is the owner's.
// Run-file text (a title, a pause reason, an item path) is untrusted data,
// returned as `run-state.ts` cleaned it, never interpreted (invariant 3).
//
// The `studio` CLI loads it through the feature registry, so it imports no SDK,
// session manager or `kernel.ts`.
import { resolve } from "node:path";
import { listAgents } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { enqueueEvent } from "../loop/queue.js";
import { resolvedPath } from "../protected-paths.js";
import { TERMINAL_STATUSES } from "../sessions/types.js";
import type { Store } from "../store/index.js";
import { AUTOMATE_RUN_KEY, pausedPlaybook, type ResumeRunPayload } from "../automate/launch.js";
import { deadLockOf } from "../loomwright/run-lock.js";
import { isRunId, pausedRuns, readRunState, resumeWouldDoubleDrain } from "../automate/run-state.js";
import type { GuiPart } from "./types.js";

/** The newest kernel run events read per agent when looking for a checkout's attribution. */
const SOURCE_SCAN_LIMIT = 500;

/** Why a listed paused run cannot be resumed now, or `null` when it can. */
export type ResumeBlock = "no_kernel_run" | "run_live" | "resume_queued" | "playbook_not_live" | "agent_not_active" | "kill_switch_engaged" | "lock_settling" | null;

/** One paused run as `GET /automate/paused-runs` serves it. */
export interface PausedRunView {
  readonly agent: string;
  readonly checkout: string;
  /** The repo of the kernel run that last drained the checkout, or `null` without one. */
  readonly repo: string | null;
  readonly run_id: string;
  readonly title: string;
  readonly pause_reason: string | null;
  readonly item: string | null;
  readonly pr: string | null;
  /** True when the run file still reads `running` with no live lock holder (23l): its session ended mid-item. */
  readonly stranded: boolean;
  readonly blocked: ResumeBlock;
  /**
   * With `blocked: "lock_settling"` (D46): when Loomwright reclaims the dead holder's run lock (ISO 8601), or
   * `null` when the lock's age cannot be read. A lock left by one of the kernel's own ended run sessions never
   * blocks: the launch releases it first.
   */
  readonly resume_at: string | null;
}

/** The attribution a resume copies: the newest kernel run event's for the agent and checkout. */
type Source = Omit<ResumeRunPayload, "kind" | "run_id">;

/** The newest `automate_run` event's attribution for `agent` in `checkout` (realpath-free `resolve` compare), with its queue id, or `undefined`. */
function sourceOf(store: Store, agent: string, checkout: string): { source: Source; id: number } | undefined {
  const rows = store
    .prepare<[string, number], { id: number; payload_json: string }>(
      `SELECT id, payload_json FROM event_queue
       WHERE kind = 'message' AND json_valid(payload_json) AND json_extract(payload_json, '$.agent') = ?
         AND json_type(payload_json, '$.${AUTOMATE_RUN_KEY}') = 'object'
       ORDER BY id DESC LIMIT ?`,
    )
    .all(agent, SOURCE_SCAN_LIMIT);
  const want = resolve(checkout);
  for (const row of rows) {
    const run = (JSON.parse(row.payload_json) as Record<string, unknown>)[AUTOMATE_RUN_KEY] as Record<string, unknown>;
    if (typeof run.checkout !== "string" || resolve(run.checkout) !== want) continue;
    if (typeof run.repo !== "string" || typeof run.playbook !== "number" || typeof run.source_session !== "number") continue;
    const source: Source = {
      repo: run.repo,
      checkout: run.checkout,
      playbook: run.playbook,
      playbook_version: typeof run.playbook_version === "number" ? run.playbook_version : null,
      task: typeof run.task === "number" ? run.task : null,
      source_session: run.source_session,
    };
    return { source, id: row.id };
  }
  return undefined;
}

/** Whether a resume for `runId` is already queued and not yet handled. */
function resumeQueued(store: Store, runId: string): boolean {
  return (
    store
      .prepare<[string], number>(
        `SELECT 1 FROM event_queue WHERE status = 'pending' AND json_valid(payload_json)
           AND json_extract(payload_json, '$.${AUTOMATE_RUN_KEY}.kind') = 'resume'
           AND json_extract(payload_json, '$.${AUTOMATE_RUN_KEY}.run_id') = ? LIMIT 1`,
      )
      .pluck()
      .get(runId) !== undefined
  );
}

/**
 * Whether a run session the kernel started (an `automate-run` step's stored
 * `session_id`) for `agent` in `checkout` has not ended. Loomwright rewrites the
 * run file's status only after its session starts, so a just-resumed run still
 * reads `paused` for a while; the launch refuses a second start then
 * (`run_session_live`), and the list says `run_live` so no second Resume is
 * offered. `sessions.cwd` is a realpath, so both sides are compared resolved.
 */
function runSessionLive(store: Store, agent: string, checkout: string): boolean {
  const placeholders = TERMINAL_STATUSES.map(() => "?").join(", ");
  const cwds = store
    .prepare<unknown[], string | null>(
      `SELECT s.cwd FROM sessions s WHERE s.agent = ? AND s.status NOT IN (${placeholders}) AND s.id IN (
         SELECT CASE WHEN json_valid(w.result_json) THEN json_extract(w.result_json, '$.session_id') END
         FROM work_steps w WHERE w.key LIKE 'event:%:automate-run' AND w.status = 'done' AND w.result_json IS NOT NULL)`,
    )
    .pluck()
    .all(agent, ...TERMINAL_STATUSES);
  const want = resolvedPath(checkout);
  return cwds.some((cwd) => cwd !== null && resolvedPath(cwd) === want);
}

/** Why `run_id` in `checkout` can't be resumed now (the launch checks it all again), or `null`. */
function blockOf(store: Store, agentStatus: string, live: boolean, settling: boolean, runId: string, source: Source | undefined): ResumeBlock {
  if (source === undefined) return "no_kernel_run";
  if (isKillSwitchEngaged(store)) return "kill_switch_engaged";
  if (agentStatus !== "active") return "agent_not_active";
  // Live, and neither turned off nor a change waiting for review, as the launch needs (`pausedPlaybook`).
  const pb = store.prepare<[number], { mode: string; status: string; version: number }>("SELECT mode, status, version FROM playbooks WHERE id = ?").get(source.playbook);
  if (pb === undefined || pb.mode !== "live" || pausedPlaybook(pb, source.playbook_version) !== undefined) return "playbook_not_live";
  if (live) return "run_live";
  if (resumeQueued(store, runId)) return "resume_queued";
  if (settling) return "lock_settling";
  return null;
}

/** Every crew member's workspaces, as their settings list them (an unreadable settings file lists none). */
function workspaces(store: Store): { agent: string; status: string; checkout: string }[] {
  const out: { agent: string; status: string; checkout: string }[] = [];
  for (const agent of listAgents(store)) {
    const read = readAgentSettings(store.dataDir, agent.id);
    if (!read.ok) continue;
    for (const checkout of read.settings.workspaces ?? []) out.push({ agent: agent.id, status: agent.status, checkout });
  }
  return out;
}

/** The paused runs and the workspaces whose run state could not be read. */
export function listPausedRuns(store: Store): { runs: PausedRunView[]; unreadable: { agent: string; checkout: string; reason: string }[] } {
  const runs: PausedRunView[] = [];
  const unreadable: { agent: string; checkout: string; reason: string }[] = [];
  // One checkout can be several crew members' workspace; its run files are listed once, under the crew member whose
  // kernel run last drained it (the newest `automate_run` event among them), else under the first that lists it.
  const byCheckout = new Map<string, { checkout: string; members: { agent: string; status: string }[] }>();
  for (const { agent, status, checkout } of workspaces(store)) {
    const key = resolve(checkout);
    const entry = byCheckout.get(key) ?? { checkout, members: [] };
    entry.members.push({ agent, status });
    byCheckout.set(key, entry);
  }
  for (const { checkout, members } of byCheckout.values()) {
    const owner = newestSource(store, members, checkout) ?? { member: members[0] as { agent: string; status: string }, source: undefined };
    const { agent, status } = owner.member;
    const read = readRunState(checkout);
    if (!read.ok) {
      unreadable.push({ agent, checkout, reason: read.reason });
      continue;
    }
    const sessionLive = runSessionLive(store, agent, checkout);
    const listed = pausedRuns(read);
    // D46: a dead holder's lock that is not the kernel's own waits out Loomwright's reclaim age (read only here).
    const dead = listed.length === 0 ? ({ kind: "none" } as const) : deadLockOf(store, checkout);
    const settling = dead.kind === "foreign" && (dead.reclaimAt === null || Date.now() / 1000 < dead.reclaimAt);
    const resumeAt = dead.kind === "foreign" && dead.reclaimAt !== null ? new Date(dead.reclaimAt * 1000).toISOString() : null;
    for (const run of listed) {
      const live = sessionLive || resumeWouldDoubleDrain(read, run.run_id);
      const blocked = blockOf(store, status, live, settling, run.run_id, owner.source);
      runs.push({ agent, checkout, repo: owner.source?.repo ?? null, ...run, blocked, resume_at: blocked === "lock_settling" ? resumeAt : null });
    }
  }
  return { runs, unreadable };
}

/** Among `members`, the one whose kernel run event for `checkout` is newest, with that event's attribution. */
function newestSource(
  store: Store,
  members: readonly { agent: string; status: string }[],
  checkout: string,
): { member: { agent: string; status: string }; source: Source; id: number } | undefined {
  let best: { member: { agent: string; status: string }; source: Source; id: number } | undefined;
  for (const member of members) {
    const found = sourceOf(store, member.agent, checkout);
    if (found !== undefined && (best === undefined || found.id > best.id)) best = { member, source: found.source, id: found.id };
  }
  return best;
}

function isBodyObject(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

/** `POST /automate/paused-runs/:run_id/resume`: 200 `{queue_id}`, or why not (400, 404, 409). */
async function resumeRoute(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const runId = req.params.run_id ?? "";
  if (!isRunId(runId)) return { status: 400, body: { error: "invalid_run_id" } };
  const body = req.body;
  if (!isBodyObject(body) || typeof body.agent !== "string" || typeof body.checkout !== "string" || Object.keys(body).length !== 2) {
    return { status: 400, body: { error: "invalid_body", message: "the body is {agent, checkout}" } };
  }
  const { agent, checkout } = body as { agent: string; checkout: string };
  return req.store.transaction((): ContributedRouteResponse => {
    // Read again now: only a run the list would show as resumable is queued.
    const view = listPausedRuns(req.store).runs.find((r) => r.agent === agent && r.checkout === checkout && r.run_id === runId);
    if (view === undefined) return { status: 404, body: { error: "not_found", message: `no paused run ${runId} for ${agent} in ${checkout}` } };
    if (view.blocked !== null) return { status: 409, body: { error: view.blocked } };
    const source = (sourceOf(req.store, agent, checkout) as { source: Source }).source;
    const run: ResumeRunPayload = { kind: "resume", run_id: runId, ...source };
    const queued = enqueueEvent(req.store, { kind: "message", payload: { agent, [AUTOMATE_RUN_KEY]: run } }, req.now());
    return { status: 200, body: { queue_id: queued.id, run_id: runId, agent, checkout } };
  });
}

export const resumeRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/automate/paused-runs", handler: async (req: ContributedRouteRequest) => ({ status: 200, body: listPausedRuns(req.store) }) },
  { method: "POST", path: "/automate/paused-runs/:run_id/resume", handler: resumeRoute },
]);

/** The paused-runs part (23j): two owner routes, no tool, no handler. */
export const pausedRunsPart: GuiPart = Object.freeze({
  name: "paused-runs",
  tools: Object.freeze([]),
  routes: resumeRoutes,
  handlers: Object.freeze({}),
});
