// The playbooks feature's `runs` part (phase 3 item 08): an enabled playbook
// runs when its linked trigger fires (`fireOne`, `../triggers/store.ts`, queues
// its message) or when the owner says "run now"; each run is one
// `playbook_runs` row (migration 13). `./index.ts` merges this part with the
// others in `PLAYBOOK_PARTS` into the one `playbooks` contribution.
//
//   routes  POST /playbooks/:id/run    the owner's run now: queues the playbook's message
//   verbs   studio playbooks run <id>  (calls only its route)
//
// A playbook's message is a `message` event whose payload carries `playbook`:
// `{agent, playbook, version, trigger_id?, scheduled_at}`, at the playbook's
// priority, `sourceRef` `playbook:<id>:<scheduled_at>`. The brain's `message`
// handler hands it to `handlePlaybookMessage` (this part claims no handler:
// the brain owns `message`), which runs it under the playbook's own policy
// (invariant 1): the version's model, never Wright's settings model; the
// dedupe key the owner set, never a built-in "already done" rule.
//
// Steps, keyed on the event id (delivery is at least once):
//   a. the payload (a malformed one is a `TypeError`: the loop fails the event);
//   b-f. ONE work step, `playbook-run`: read the live row and the version's
//      snapshot, refuse (not found, not enabled or edited since, agent not
//      routed, model unset, dedupe spec invalid), skip a duplicate, and insert
//      exactly one run row (the refusal or skip, or `running`). Every refusal
//      is a return that writes its row inside the step, never a throw (a throw
//      rolls the step back). A redelivery replays the stored `{run_id,
//      outcome}` and never evaluates b-e again, so one event writes one row.
//      The one exception is a payload naming no playbook row at all: a run
//      row references `playbooks(id)`, so nothing can be recorded and it
//      throws (the loop fails the event, one notify);
//   g. Wright's memory files and settings (permission mode and policy only);
//   h. the prompt (`playbookPrompt`);
//   i. `runStepAsync("start-session")`: first the live row again (the stored
//      `start` may be stale: the event was parked, or the kernel died after
//      step b-f committed): not enabled or edited since, or a same-key run
//      ended `done` meanwhile, stores `{session_id: null, skip}` and moves the
//      row (still `running` with no session) to that skip, no session;
//      otherwise the session, with `sessions.playbook` and `playbook_version`;
//   j. the row's `session_id`, and a listener on `handle.done` (never awaited)
//      that ends the row `done` or `failed` with the session's counted tokens.
// The kernel owns the session's lifecycle (invariant 2): nothing here awaits
// or stops it.
//
// The `studio` CLI loads this module (through `./index.ts`, and through the
// brain's handler): besides `node:` builtins it imports only
// `../api/kill-switch.js`, `../features/contribution.js` types, `../loop/queue.js`, the triggers
// feature's `cron.js`, the brain's `context.js`, `memory.js`, `messages.js`
// and `settings.js` (never `../brain/index.js` or `handler.js`: no runtime
// cycle) and this feature's files; never the Agent SDK or the session manager.
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import { buildContext, defuseWrapperTags } from "../brain/context.js";
import type { LoomwrightSummary } from "../brain/context.js";
import { ensureMemoryFiles, wrightMemoryDir } from "../brain/memory.js";
import { BRAIN_AGENTS } from "../brain/messages.js";
import { readWrightSettings } from "../brain/settings.js";
import type { CliApiClient, CliSubcommandOutput, ContributedRoute, ContributedRouteRequest } from "../features/contribution.js";
import { enqueueEvent } from "../loop/queue.js";
import type { EventContext, EventSessions } from "../loop/types.js";
import type { SessionHandle, SessionStatus } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { wallClock } from "../triggers/cron.js";
import { getPlaybook } from "./store.js";
import { DEDUPE_KEY_FIELDS, PLAYBOOK_RUN_KINDS } from "./types.js";
import type { DedupeKeyField, PlaybookPart, PlaybookPriority, PlaybookRunKind, PlaybookVerb } from "./types.js";

/**
 * `playbook_runs.status` (closed here, not in `./types.ts`; migration 13 has
 * no SQL CHECK): every write below is checked against it.
 */
export const PLAYBOOK_RUN_STATUSES = Object.freeze(["running", "done", "failed", "skipped_duplicate", "skipped_not_enabled"] as const);
export type PlaybookRunStatus = (typeof PLAYBOOK_RUN_STATUSES)[number];

/** A playbook event's `sourceRef`: the queue keeps one row per playbook and instant. */
export function playbookSourceRef(id: number, scheduledAt: string): string {
  return `playbook:${id}:${scheduledAt}`;
}

// ---- The dedupe key ------------------------------------------------------------

/** What a dedupe key is built from: the event's values. */
export interface DedupeKeyInput {
  readonly playbook: number;
  readonly version: number;
  /** `null` for a run now. */
  readonly triggerId: number | null;
  /** The event's `scheduled_at` (ISO-8601). */
  readonly scheduledAt: string;
}

export type DedupeKeyResult = { readonly ok: true; readonly key: string } | { readonly ok: false; readonly error: "dedupe_spec_invalid" | "dedupe_zone_invalid" };

/** The `YYYY-MM-DD` calendar date of instant `iso` in `timeZone`; `undefined` for an unknown zone or an unreadable instant. */
function localDate(iso: string, timeZone: string): string | undefined {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  try {
    const w = wallClock(timeZone, ms);
    if (![w.year, w.month, w.day].every(Number.isFinite)) return undefined;
    return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
  } catch {
    return undefined;
  }
}

/**
 * A playbook's dedupe key for one event: `spec` (the stored
 * `dedupe_key_spec`, a JSON array of distinct `DEDUPE_KEY_FIELDS`) evaluated
 * field by field, in spec order (`playbook.id`, `playbook.version`,
 * `trigger.id` (null for a run now), `trigger.scheduled_at`, `date`: the
 * calendar date of `scheduled_at` in `timeZone`), as `JSON.stringify` of that
 * object. Pure: the event's values only, never the clock. A spec that is not
 * such an array is `dedupe_spec_invalid`; a zone the runtime does not know is
 * `dedupe_zone_invalid`.
 */
export function evaluateDedupeKey(spec: string, input: DedupeKeyInput, timeZone: string): DedupeKeyResult {
  let fields: unknown;
  try {
    fields = JSON.parse(spec) as unknown;
  } catch {
    return { ok: false, error: "dedupe_spec_invalid" };
  }
  if (!Array.isArray(fields) || fields.length === 0) return { ok: false, error: "dedupe_spec_invalid" };
  const key: Record<string, string | number | null> = {};
  for (const field of fields as unknown[]) {
    if (typeof field !== "string" || !(DEDUPE_KEY_FIELDS as readonly string[]).includes(field) || Object.hasOwn(key, field)) {
      return { ok: false, error: "dedupe_spec_invalid" };
    }
    switch (field as DedupeKeyField) {
      case "playbook.id":
        key[field] = input.playbook;
        break;
      case "playbook.version":
        key[field] = input.version;
        break;
      case "trigger.id":
        key[field] = input.triggerId;
        break;
      case "trigger.scheduled_at":
        key[field] = input.scheduledAt;
        break;
      case "date": {
        const date = localDate(input.scheduledAt, timeZone);
        if (date === undefined) return { ok: false, error: "dedupe_zone_invalid" };
        key[field] = date;
        break;
      }
    }
  }
  return { ok: true, key: JSON.stringify(key) };
}

// ---- Run rows ------------------------------------------------------------------

function checkStatus(status: PlaybookRunStatus): PlaybookRunStatus {
  if (!(PLAYBOOK_RUN_STATUSES as readonly string[]).includes(status)) throw new TypeError(`unknown playbook run status ${JSON.stringify(status)}`);
  return status;
}

interface NewRun {
  readonly playbook: number;
  readonly version: number;
  readonly kind: PlaybookRunKind;
  readonly status: PlaybookRunStatus;
  readonly dedupeKey: string | null;
  readonly result: Record<string, unknown> | null;
}

/** Insert one run row; a terminal one gets `ended_at`. Returns its id. */
function insertRun(store: Store, run: NewRun, now: Date): number {
  const status = checkStatus(run.status);
  if (!(PLAYBOOK_RUN_KINDS as readonly string[]).includes(run.kind)) throw new TypeError(`unknown playbook run kind ${JSON.stringify(run.kind)}`);
  const at = now.toISOString();
  return Number(
    store
      .prepare("INSERT INTO playbook_runs (playbook, version, kind, status, dedupe_key, result_json, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(run.playbook, run.version, run.kind, status, run.dedupeKey, run.result === null ? null : JSON.stringify(run.result), at, status === "running" ? null : at)
      .lastInsertRowid,
  );
}

/**
 * Fail run `id` with `error`, only while it is `running` with no session yet
 * (a row whose session started belongs to that session's ending). Returns
 * whether it moved.
 */
function failBeforeSession(store: Store, id: number, error: string, now: Date): boolean {
  const r = store
    .prepare("UPDATE playbook_runs SET status = ?, result_json = ?, ended_at = ? WHERE id = ? AND status = 'running' AND session_id IS NULL")
    .run(checkStatus("failed"), JSON.stringify({ error }), now.toISOString(), id);
  return r.changes > 0;
}

/** The session's counted budget tokens (D26: input + output + cache writes). */
function sessionTokens(store: Store, sessionId: number): number {
  return store.prepare<[number], number>("SELECT COALESCE(SUM(counted_tokens), 0) FROM budget WHERE session_id = ?").pluck().get(sessionId) ?? 0;
}

/** Whether the session asked to stop (`kernel_request_stop` appends `stop_requested` for it). */
function stopRequested(store: Store, sessionId: number): boolean {
  return store.prepare<[number], number>("SELECT 1 FROM events WHERE kind = 'stop_requested' AND session_id = ? LIMIT 1").pluck().get(sessionId) !== undefined;
}

/**
 * End run `runId` when its session ends: `done` for `completed`, or `stopped`
 * after the session's own `kernel_request_stop`; `failed` (`session_<status>`)
 * otherwise. Only a row still `running` moves. Never awaited and never throws:
 * the store may be closed by then (the row then stays `running`).
 */
function attachEnding(store: Store, runId: number, handle: SessionHandle, now: () => Date): void {
  void handle.done
    .then((status: SessionStatus) => {
      const done = status === "completed" || (status === "stopped" && stopRequested(store, handle.id));
      store
        .prepare("UPDATE playbook_runs SET status = ?, result_json = ?, tokens = ?, ended_at = ? WHERE id = ? AND status = 'running'")
        .run(checkStatus(done ? "done" : "failed"), done ? null : JSON.stringify({ error: `session_${status}` }), sessionTokens(store, handle.id), now().toISOString(), runId);
    })
    .catch(() => {
      // The store is closed or the write failed: nothing else to do.
    });
}

// ---- The playbook run (the brain hands a playbook's message here) ----------------

/** A playbook event's payload, checked. */
interface PlaybookEvent {
  readonly agent: string;
  readonly playbook: number;
  readonly version: number;
  readonly triggerId: number | null;
  readonly scheduledAt: string;
  readonly kind: "fire" | "run_now";
}

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Step a: the payload, or a `TypeError` naming what is wrong (the loop fails the event, one notify). */
function playbookEventOf(eventId: number, payload: Readonly<Record<string, unknown>>): PlaybookEvent {
  const bad = (what: string): TypeError => new TypeError(`event ${eventId}: a playbook message needs ${what}`);
  const { agent, playbook, version, trigger_id: triggerId, scheduled_at: scheduledAt } = payload;
  if (!isPositiveId(playbook)) throw bad("playbook, a positive integer");
  if (!isPositiveId(version)) throw bad("version, a positive integer");
  if (typeof scheduledAt !== "string" || !Number.isFinite(Date.parse(scheduledAt))) throw bad("scheduled_at, an ISO-8601 instant");
  if (triggerId !== undefined && !isPositiveId(triggerId)) throw bad("trigger_id, absent or a positive integer");
  if (typeof agent !== "string") throw bad("agent, a string");
  return { agent, playbook, version, triggerId: triggerId ?? null, scheduledAt, kind: triggerId === undefined ? "run_now" : "fire" };
}

/** The fields of a version snapshot (the full row at that version) a run reads. */
interface Snapshot {
  readonly slug: string;
  readonly intent: string;
  readonly model: string | null;
  readonly dedupe_key_spec: string | null;
}

/** The snapshot of playbook `id` at `version`, or `undefined` when there is none or it cannot be read. */
function readSnapshot(store: Store, id: number, version: number): Snapshot | undefined {
  const json = store.prepare<[number, number], string>("SELECT snapshot_json FROM playbook_versions WHERE playbook = ? AND version = ?").pluck().get(id, version);
  if (json === undefined) return undefined;
  let s: unknown;
  try {
    s = JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
  const o = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>;
  if (typeof o.slug !== "string" || typeof o.intent !== "string") return undefined;
  return {
    slug: o.slug,
    intent: o.intent,
    model: typeof o.model === "string" && o.model !== "" ? o.model : null,
    dedupe_key_spec: typeof o.dedupe_key_spec === "string" ? o.dedupe_key_spec : null,
  };
}

/** What the `playbook-run` step stored: the run row and `start`, or the terminal status it wrote. */
interface RunDecision {
  readonly run_id: number;
  readonly outcome: "start" | Exclude<PlaybookRunStatus, "running" | "done">;
  /** The snapshot's values the later steps need (set only for `start`). */
  readonly slug?: string;
  readonly intent?: string;
  readonly model?: string;
  /** The run's dedupe key (set only for `start`; `null` when the playbook has none). */
  readonly dedupe_key?: string | null;
}

/** Whether a `fire` or `run_now` of playbook `id` other than run `exceptRun` ended `done` with dedupe key `key`. */
function doneWithKey(store: Store, id: number, key: string, exceptRun: number | null): boolean {
  return (
    store
      .prepare<[number, string, number], number>("SELECT 1 FROM playbook_runs WHERE playbook = ? AND kind IN ('fire', 'run_now') AND dedupe_key = ? AND status = 'done' AND id != ? LIMIT 1")
      .pluck()
      .get(id, key, exceptRun ?? 0) !== undefined
  );
}

/** A skip found when the session is about to start: the row's terminal status and its `result_json`. */
interface LateSkip {
  readonly status: "skipped_not_enabled" | "skipped_duplicate";
  readonly result: Record<string, unknown> | null;
}

/**
 * Re-check the live state right before the session starts (inside the
 * `start-session` step): the `start` stored by `playbook-run` may be stale.
 * The playbook not `enabled`, or at another version, is `skipped_not_enabled`
 * with the live `{status, version}`; a same-key run that ended `done` since is
 * `skipped_duplicate`. `undefined` when the session may start.
 */
function lateSkip(store: Store, e: PlaybookEvent, runId: number, dedupeKey: string | null): LateSkip | undefined {
  const live = getPlaybook(store, e.playbook);
  if (live === undefined) return { status: "skipped_not_enabled", result: { status: null, version: null } };
  if (live.status !== "enabled" || live.version !== e.version) return { status: "skipped_not_enabled", result: { status: live.status, version: live.version } };
  if (dedupeKey !== null && doneWithKey(store, e.playbook, dedupeKey, runId)) return { status: "skipped_duplicate", result: null };
  return undefined;
}

/**
 * Steps b-f, inside the `playbook-run` work step: evaluate, then insert
 * exactly one run row. Never throws for a refusal (each is a return that
 * writes its row); a throw (a store fault) rolls the whole step back.
 */
function decideRun(store: Store, e: PlaybookEvent, timeZone: string, now: Date): RunDecision {
  const row = (status: Exclude<PlaybookRunStatus, "running" | "done">, result: Record<string, unknown> | null, dedupeKey: string | null = null): RunDecision => ({
    run_id: insertRun(store, { playbook: e.playbook, version: e.version, kind: e.kind, status, dedupeKey, result }, now),
    outcome: status,
  });

  // b. The live row and the version's snapshot.
  const live = getPlaybook(store, e.playbook);
  if (live === undefined) {
    // `playbook_runs.playbook` references `playbooks(id)`: a run of no playbook cannot be recorded.
    throw new Error(`event payload names playbook ${e.playbook}, which does not exist; no run recorded`);
  }
  const snapshot = readSnapshot(store, e.playbook, e.version);
  if (snapshot === undefined) return row("failed", { error: "not_found" });
  // c. Turned off, or edited (a new version), after the event was queued.
  if (live.status !== "enabled" || live.version !== e.version) return row("skipped_not_enabled", { status: live.status, version: live.version });
  // d. Only the brain's agents run today (crew is phase 4); the kernel never picks a model.
  if (!BRAIN_AGENTS.includes(e.agent)) return row("failed", { error: "agent_not_routed" });
  if (snapshot.model === null) return row("failed", { error: "model_unset" });
  // e. The owner's dedupe key: only a fire or run-now that ended `done` counts.
  let dedupeKey: string | null = null;
  if (snapshot.dedupe_key_spec !== null) {
    const evaluated = evaluateDedupeKey(snapshot.dedupe_key_spec, { playbook: e.playbook, version: e.version, triggerId: e.triggerId, scheduledAt: e.scheduledAt }, timeZone);
    if (!evaluated.ok) return row("failed", { error: evaluated.error });
    dedupeKey = evaluated.key;
    if (doneWithKey(store, e.playbook, dedupeKey, null)) return row("skipped_duplicate", null, dedupeKey);
  }
  // f. The run.
  const runId = insertRun(store, { playbook: e.playbook, version: e.version, kind: e.kind, status: "running", dedupeKey, result: null }, now);
  return { run_id: runId, outcome: "start", slug: snapshot.slug, intent: snapshot.intent, model: snapshot.model, dedupe_key: dedupeKey };
}

export interface PlaybookPromptInput {
  readonly dataDir: string;
  readonly id: number;
  readonly slug: string;
  readonly version: number;
  readonly intent: string;
  readonly kind: "fire" | "run_now";
  readonly scheduledAt: string;
  readonly loomwright: LoomwrightSummary;
  readonly now: Date;
  readonly timeZone: string;
}

/**
 * The prompt a playbook session starts with: the playbook's heading and its
 * intent (the owner approved this exact version when enabling it; any edit
 * returns it to draft), then Wright's context (`buildContext`) whose message is
 * a kernel-built line, wrapped as data like any message that is not the owner's.
 */
export function playbookPrompt(input: PlaybookPromptInput): string {
  const heading = `## Playbook ${input.slug} (#${input.id}, version ${input.version}, enabled by the owner)\n\n`;
  const instruction = `Run this playbook. Its intent is your instruction for this session:\n\n${defuseWrapperTags(input.intent)}\n\n`;
  const text = `Playbook ${input.slug} ${input.kind === "fire" ? `fired for ${input.scheduledAt}` : "run now by the owner"}.`;
  return `${heading}${instruction}${buildContext({ dataDir: input.dataDir, source: `playbook:${input.id}`, text, loomwright: input.loomwright, now: input.now, timeZone: input.timeZone })}`;
}

/** What the brain's handler passes through: its clock, zone and Loomwright reader. */
export interface PlaybookRunDeps {
  readonly now: () => Date;
  readonly timeZone: () => string;
  readonly loomwright: (sessions: EventSessions | undefined) => LoomwrightSummary;
}

/** An admission refusal (code `admission_refused`), told by its code (the session layer is never imported at runtime). */
function admissionRefusal(err: unknown): { readonly reason: string; readonly retryAt: string | null } | undefined {
  if (!(err instanceof Error) || (err as { code?: unknown }).code !== "admission_refused") return undefined;
  const { reason, retryAt } = err as { reason?: unknown; retryAt?: unknown };
  return { reason: typeof reason === "string" ? reason : "admission_refused", retryAt: typeof retryAt === "string" ? retryAt : null };
}

/** An error's first line, prefixed with its code when it has one. */
function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  const line = text.split("\n", 1)[0] ?? "";
  return typeof code === "string" && !line.startsWith(code) ? `${code}: ${line}` : line;
}

/** A playbook's `message` event (the payload carries `playbook`): see the module comment. */
export async function handlePlaybookMessage(ctx: EventContext, deps: PlaybookRunDeps): Promise<void> {
  const { event, store } = ctx;
  // a. The payload.
  const e = playbookEventOf(event.id, event.payload);
  // b-f. One step: a redelivery replays the stored decision (one run row per event).
  const decision = ctx.runStep("playbook-run", () => decideRun(store, e, deps.timeZone(), deps.now()));
  if (decision.outcome !== "start") return;
  const runId = decision.run_id;
  const fail = (error: string): void => {
    failBeforeSession(store, runId, error, deps.now());
  };

  // g. Wright's memory files and settings: only the permission mode and policy are used.
  const dataDir = store.dataDir;
  let settings;
  try {
    ensureMemoryFiles(dataDir);
  } catch (err) {
    fail(`memory_unwritable: ${messageOf(err)}`);
    throw err;
  }
  try {
    settings = readWrightSettings(dataDir);
  } catch (err) {
    fail(`settings_unwritable: ${messageOf(err)}`);
    throw err;
  }
  if (!settings.ok) {
    fail(settings.error === "model_unset" ? `model_unset: set "model" in ${settings.file}` : `settings_invalid: ${settings.message}`);
    return;
  }
  const sessions = ctx.sessions;
  if (sessions === undefined) {
    fail("no_session_manager");
    return;
  }

  // h. The prompt.
  const prompt = playbookPrompt({
    dataDir,
    id: e.playbook,
    slug: decision.slug ?? "",
    version: e.version,
    intent: decision.intent ?? "",
    kind: e.kind,
    scheduledAt: e.scheduledAt,
    loomwright: deps.loomwright(sessions),
    now: deps.now(),
    timeZone: deps.timeZone(),
  });

  // i. The session: the step's first effect, so an admission refusal leaves nothing to repeat.
  // The stored `start` may be stale (a parked event, or a crash after step b-f):
  // the live row is read again first, and a skip is stored so a replay skips too.
  const { permissionMode, policy } = settings.settings;
  const model = decision.model ?? "";
  const dedupeKey = decision.dedupe_key ?? null;
  let handle: SessionHandle | undefined;
  let started: { session_id: number } | { session_id: null; skip: LateSkip };
  try {
    started = await ctx.runStepAsync("start-session", async (): Promise<{ session_id: number } | { session_id: null; skip: LateSkip }> => {
      const skip = lateSkip(store, e, runId, dedupeKey);
      if (skip !== undefined) return { session_id: null, skip };
      handle = await sessions.startSession({
        agent: e.agent,
        prompt,
        model,
        permissionMode,
        cwd: wrightMemoryDir(dataDir),
        policy,
        playbook: e.playbook,
        playbookVersion: e.version,
      });
      return { session_id: handle.id };
    });
  } catch (err) {
    const refusal = admissionRefusal(err);
    if (refusal !== undefined) {
      // Still `running`: the loop parks the event and the same row runs on its redelivery.
      store
        .prepare("UPDATE playbook_runs SET result_json = ? WHERE id = ? AND status = 'running' AND session_id IS NULL")
        .run(JSON.stringify({ parked: refusal.reason, retry_at: refusal.retryAt }), runId);
    } else {
      fail(`session_refused: ${messageOf(err)}`);
    }
    throw err;
  }

  if (started.session_id === null) {
    // No session started: the row (still `running`, no session) ends as the skip.
    const { status, result } = started.skip;
    store
      .prepare("UPDATE playbook_runs SET status = ?, result_json = ?, ended_at = ? WHERE id = ? AND status = 'running' AND session_id IS NULL")
      .run(checkStatus(status), result === null ? null : JSON.stringify(result), deps.now().toISOString(), runId);
    return;
  }

  // j. The session's id, then its ending (only the delivery that started it holds its handle).
  store.prepare("UPDATE playbook_runs SET session_id = ?, result_json = NULL WHERE id = ? AND status = 'running'").run(started.session_id, runId);
  if (handle !== undefined) attachEnding(store, runId, handle, deps.now);
}

// ---- The owner's run now ---------------------------------------------------------

const ID = /^[1-9]\d{0,15}$/;

function idOf(req: ContributedRouteRequest): number | undefined {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  return ID.test(raw) && Number.isSafeInteger(id) ? id : undefined;
}

function isBodyObject(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

export const runRoutes: readonly ContributedRoute[] = Object.freeze([
  {
    method: "POST",
    path: "/playbooks/:id/run",
    handler: async (req) => {
      const id = idOf(req);
      if (id === undefined) return { status: 400, body: { error: "invalid_id" } };
      if (req.body !== undefined && !(isBodyObject(req.body) && Object.keys(req.body).length === 0)) {
        return { status: 400, body: { error: "invalid_body", message: "the body is empty or {}" } };
      }
      if (isKillSwitchEngaged(req.store)) return { status: 409, body: { error: "kill_switch_engaged" } };
      const now = req.now();
      const scheduledAt = now.toISOString();
      return req.store.transaction(() => {
        const playbook = getPlaybook(req.store, id);
        if (playbook === undefined) return { status: 404, body: { error: "not_found" } };
        if (playbook.status !== "enabled") {
          return { status: 409, body: { error: "not_enabled", message: `playbook ${id} is ${playbook.status}; only an enabled playbook runs` } };
        }
        // A stored priority outside the closed set makes `enqueueEvent` throw: never queued at a guessed priority.
        const queued = enqueueEvent(
          req.store,
          {
            kind: "message",
            payload: { agent: playbook.owning_agent, playbook: id, version: playbook.version, scheduled_at: scheduledAt },
            priority: playbook.priority as PlaybookPriority,
            sourceRef: playbookSourceRef(id, scheduledAt),
          },
          now,
        );
        return { status: 200, body: { queue_id: queued.id, created: queued.created, playbook: id, version: playbook.version, scheduled_at: scheduledAt } };
      });
    },
  },
]);

/** `studio playbooks run`'s help line. */
export const RUN_VERB_HELP = "studio playbooks run <id>";

/** Text from the store as one safe terminal token: JSON-quoted, C0/C1 controls and bidi overrides replaced (the drafts verbs' rule). */
function quoted(value: unknown): string {
  return JSON.stringify(String(value)).replace(/[\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "?");
}

/** A name or number from the store, printed bare unless it needs quoting. */
function bare(value: unknown): string {
  const s = String(value ?? "-");
  return /^[\w.:@/+-]{1,200}$/.test(s) ? s : quoted(s);
}

/** A kernel message (a refusal) as one safe line. */
function messageLine(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "?");
}

function parseId(raw: string | undefined): number | undefined {
  if (raw === undefined || !ID.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** A refusal's text: its `message` when it has one, else its `error` code. */
function refusalOf(body: unknown): string {
  const message = isBodyObject(body) ? body.message : undefined;
  if (typeof message === "string") return messageLine(message);
  const error = isBodyObject(body) ? body.error : undefined;
  return typeof error === "string" && /^[a-z_]{1,64}$/.test(error) ? error : "unknown";
}

const runVerb: PlaybookVerb = {
  name: "run",
  help: RUN_VERB_HELP,
  async run(args: readonly string[], client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
    const id = parseId(args[0]);
    if (id === undefined || args.length !== 1) {
      out.stderr.write(`usage: ${RUN_VERB_HELP}\n`);
      return 2;
    }
    const path = `/playbooks/${id}/run`;
    const res = await client.request("POST", path);
    if (res.status === 200) {
      const body = (isBodyObject(res.body) ? res.body : {}) as { version?: unknown; queue_id?: unknown };
      out.stdout.write(`queued playbook #${id} version ${bare(body.version)} (event ${bare(body.queue_id)})\n`);
      return 0;
    }
    if (res.status === 404) out.stderr.write(`studio: no playbook ${id}\n`);
    else if (res.status === 400 || res.status === 409) out.stderr.write(`studio: playbook ${id} not run: ${refusalOf(res.body)}\n`);
    else out.stderr.write(`studio: kernel API answered ${res.status} to POST ${path}\n`);
    return 1;
  },
};

/** The owner's verbs of this part: `run`. */
export const runVerbs: readonly PlaybookVerb[] = Object.freeze([runVerb]);

export const runsPart: PlaybookPart = Object.freeze({
  name: "runs",
  tools: Object.freeze([]),
  routes: runRoutes,
  verbs: runVerbs,
  handlers: Object.freeze({}),
});
