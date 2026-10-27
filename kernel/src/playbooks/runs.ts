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
// `{agent, playbook, version, trigger_id?, scheduled_at, item?}`, at the
// playbook's priority, `sourceRef` `playbook:<id>:<scheduled_at>`. A message
// with an `item` (a polled item, phase 6 item 05: `./items.ts`) is its own
// run: its row records the item, the owner's key may name `item.id` /
// `item.revision`, a skip appends one `poll_item_skipped` event, the item
// reaches the prompt only wrapped as data, and a GitHub item whose agent
// lacks the grant or a usable connector parks (`parked`, `needs_github`). The brain's `message`
// handler hands it to `handlePlaybookMessage` (this part claims no handler:
// the brain owns `message`), which runs it under the playbook's own policy
// (invariant 1): the version's model, never Wright's settings model; the
// dedupe key the owner set, never a built-in "already done" rule.
//
// Steps, keyed on the event id (delivery is at least once):
//   a. the payload (a malformed one is a `TypeError`: the loop fails the event);
//   b-f. ONE work step, `playbook-run`: read the live row and the version's
//      snapshot, refuse (not found, not enabled or edited since, agent off
//      (a registered crew member that is `off`: one notification, recorded in
//      the step so a redelivery records none more), agent not routed (neither
//      `wright` nor a registered crew member), model unset, dedupe spec
//      invalid), skip a duplicate (an item's: one `poll_item_skipped`), park
//      a GitHub item that needs GitHub (one notification per outage), and
//      insert exactly one run row (the refusal, skip or park, or `running`). Every refusal
//      is a return that writes its row inside the step, never a throw (a throw
//      rolls the step back). A redelivery replays the stored `{run_id,
//      outcome}` and never evaluates b-e again, so one event writes one row.
//      The one exception is a payload naming no playbook row at all: a run
//      row references `playbooks(id)`, so nothing can be recorded and it
//      throws (the loop fails the event, one notify);
//   g-i. ONE work step, `runStepAsync("start-session")`: g. the agent's
//      memory files and settings (permission mode and policy only; a crew
//      member's own, with its `never` list, after re-checking it is not
//      `off`) and the session manager, any refusal stored as
//      `{session_id: null, fail}`; then the
//      live row again (the stored `start` may be stale: the event was parked,
//      or the kernel died after step b-f committed): not enabled or edited
//      since, or a same-key run ended `done` meanwhile (an item's: one
//      `poll_item_skipped`, in the step), stores `{session_id: null, skip}`; h. the prompt (`playbookPrompt` for
//      Wright, `crewPlaybookPrompt` for a crew member: its own memory files,
//      never Wright's); i. the session, as the owning agent, cwd its memory
//      folder, with `sessions.playbook` and `playbook_version`, stored as
//      `{session_id}`. An admission refusal is rethrown from inside the step
//      (released, not done) so the loop parks the event;
//   j. after the step, from its STORED result only (a replay never decides
//      again): the row (still `running` with no session) moves to the stored
//      skip or `failed`, or gets the `session_id`; the delivery that started
//      the session adds a listener on `handle.done` (never awaited) that ends
//      the row `done` or `failed` with the session's counted tokens.
// The kernel owns the session's lifecycle (invariant 2): nothing here awaits
// or stops it.
//
// The `studio` CLI loads this module (through `./index.ts`, and through the
// brain's handler): besides `node:` builtins it imports only
// `../api/kill-switch.js`, `../features/contribution.js` types, `../loop/queue.js`, the triggers
// feature's `cron.js`, the brain's `context.js`, `memory.js` and `settings.js`
// (never `../brain/index.js` or `handler.js`: no runtime cycle), the agents
// feature's leaf modules (`../agents/registry.js`, `settings.js`,
// `memory.js`, `types.js`: never its index), `../notifications/record.js`
// and this feature's files (`./items.js`, `./store.js`, `./types.js`); never
// the Agent SDK or the session manager.
import { agentMemoryDir, ensureAgentMemoryFiles } from "../agents/memory.js";
import { getAgent, isRoutable } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import { isValidAgentId } from "../agents/types.js";
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import { MAX_CONTEXT_CHARS, MAX_MEMORY_FILE_CHARS, buildContext, defuseWrapperTags, localTimeLine } from "../brain/context.js";
import type { LoomwrightSummary } from "../brain/context.js";
import { cutChars, ensureMemoryFiles, readMemoryFile, wrightMemoryDir } from "../brain/memory.js";
import { readWrightSettings } from "../brain/settings.js";
import type { CliApiClient, CliSubcommandOutput, ContributedRoute, ContributedRouteRequest } from "../features/contribution.js";
import { enqueueEvent } from "../loop/queue.js";
import type { EventContext, EventSessions } from "../loop/types.js";
import { recordNotification } from "../notifications/record.js";
import type { SessionHandle, SessionStatus } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { wallClock } from "../triggers/cron.js";
import { appendItemSkipped, isGithubItem, itemPromptBlock, needsGithub, notifyNeedsGithub, runItemOf } from "./items.js";
import type { RunItem } from "./items.js";
import { getPlaybook } from "./store.js";
import { DEDUPE_KEY_FIELDS, PLAYBOOK_RUN_KINDS } from "./types.js";
import type { DedupeKeyField, PlaybookPart, PlaybookPriority, PlaybookRunKind, PlaybookVerb } from "./types.js";

/**
 * `playbook_runs.status` (closed here, not in `./types.ts`; migration 13 has
 * no SQL CHECK): every write below is checked against it. `parked` is a
 * GitHub item's run whose agent lacked the grant or a usable connector
 * (`needs_github`): terminal, and never a duplicate, so the next poll's
 * message for the item runs. (An admission-parked run is another thing: it
 * stays `running`, with `parked` in its `result_json`.)
 */
export const PLAYBOOK_RUN_STATUSES = Object.freeze(["running", "done", "failed", "skipped_duplicate", "skipped_not_enabled", "parked"] as const);
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
  /** The polled item the event carries (`item.id` is its ref); absent for a per-instant message. */
  readonly item?: Pick<RunItem, "ref" | "revision">;
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
 * calendar date of `scheduled_at` in `timeZone`, `item.id`: the item's ref,
 * `item.revision`: its revision), as `JSON.stringify` of that object. Pure:
 * the event's values only, never the clock; only the spec's fields, never an
 * item field the spec leaves out. A spec that is not such an array is
 * `dedupe_spec_invalid`; a zone the runtime does not know is
 * `dedupe_zone_invalid`. A spec naming an item field for an event that
 * carries no item is `dedupe_spec_invalid` too: a key that silently left the
 * field out would dedupe every fire as one.
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
      case "item.id":
      case "item.revision":
        // The event carries no item: refused, never left out of the key.
        if (input.item === undefined) return { ok: false, error: "dedupe_spec_invalid" };
        if (field === "item.id") key[field] = input.item.ref;
        else key[field] = input.item.revision;
        break;
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
  /** The event's item: its ref and revision are recorded on every row of an item event. */
  readonly item: RunItem | null;
}

/** Insert one run row; a terminal one gets `ended_at`. Returns its id. */
function insertRun(store: Store, run: NewRun, now: Date): number {
  const status = checkStatus(run.status);
  if (!(PLAYBOOK_RUN_KINDS as readonly string[]).includes(run.kind)) throw new TypeError(`unknown playbook run kind ${JSON.stringify(run.kind)}`);
  const at = now.toISOString();
  return Number(
    store
      .prepare(
        "INSERT INTO playbook_runs (playbook, version, kind, status, dedupe_key, result_json, started_at, ended_at, item_ref, item_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        run.playbook,
        run.version,
        run.kind,
        status,
        run.dedupeKey,
        run.result === null ? null : JSON.stringify(run.result),
        at,
        status === "running" ? null : at,
        run.item?.ref ?? null,
        run.item?.revision ?? null,
      )
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
  /** The polled item the message is about (`./items.ts`), or `null` for a per-instant message. */
  readonly item: RunItem | null;
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
  const item = runItemOf(eventId, payload.item);
  return { agent, playbook, version, triggerId: triggerId ?? null, scheduledAt, kind: triggerId === undefined ? "run_now" : "fire", item };
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
 * `skipped_duplicate` (an item's appends its one `poll_item_skipped` here, in
 * the step, so a redelivery appends none more). `undefined` when the session
 * may start.
 */
function lateSkip(store: Store, e: PlaybookEvent, runId: number, dedupeKey: string | null, now: Date): LateSkip | undefined {
  const live = getPlaybook(store, e.playbook);
  if (live === undefined) return { status: "skipped_not_enabled", result: { status: null, version: null } };
  if (live.status !== "enabled" || live.version !== e.version) return { status: "skipped_not_enabled", result: { status: live.status, version: live.version } };
  if (dedupeKey !== null && doneWithKey(store, e.playbook, dedupeKey, runId)) {
    if (e.item !== null) appendItemSkipped(store, e.playbook, e.item, dedupeKey, now);
    return { status: "skipped_duplicate", result: null };
  }
  return undefined;
}

/** The notification source of a playbook whose crew member is off. */
export const AGENT_OFF_SOURCE = "kernel:agent_off";

/**
 * Tell the owner a playbook did not run because its crew member is `off`:
 * one notification. Called inside a work step only (the `playbook-run` step,
 * or the `start-session` step), so a redelivery replays the step's stored
 * result and records none more.
 */
function notifyAgentOff(store: Store, e: PlaybookEvent, slug: string, now: Date): void {
  recordNotification(
    store,
    {
      source: AGENT_OFF_SOURCE,
      title: `Playbook not run: ${e.agent} is off`,
      body: `Playbook ${slug} (#${e.playbook}) fired for ${e.scheduledAt} but its agent ${e.agent} is off; nothing ran. Turn it on with studio agents on ${e.agent}.`,
    },
    now,
  );
}

/**
 * Steps b-f, inside the `playbook-run` work step: evaluate, then insert
 * exactly one run row. Never throws for a refusal (each is a return that
 * writes its row); a throw (a store fault) rolls the whole step back.
 */
function decideRun(store: Store, e: PlaybookEvent, timeZone: string, now: Date): RunDecision {
  const row = (status: Exclude<PlaybookRunStatus, "running" | "done">, result: Record<string, unknown> | null, dedupeKey: string | null = null): RunDecision => ({
    run_id: insertRun(store, { playbook: e.playbook, version: e.version, kind: e.kind, status, dedupeKey, result, item: e.item }, now),
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
  // d. The owning agent: a registered crew member that is off runs nothing (one notification, in this
  // step so a redelivery records none more); an id that is neither Wright nor registered is not routed.
  if (e.agent !== "wright" && getAgent(store, e.agent)?.status === "off") {
    notifyAgentOff(store, e, snapshot.slug, now);
    return row("failed", { error: "agent_off" });
  }
  if (!isRoutable(store, e.agent)) return row("failed", { error: "agent_not_routed" });
  // The kernel never picks a model.
  if (snapshot.model === null) return row("failed", { error: "model_unset" });
  // e. The owner's dedupe key: only a fire or run-now that ended `done` counts. The item's
  // fields are in it only when the spec names them (the kernel adds none).
  let dedupeKey: string | null = null;
  if (snapshot.dedupe_key_spec !== null) {
    const input = { playbook: e.playbook, version: e.version, triggerId: e.triggerId, scheduledAt: e.scheduledAt, ...(e.item !== null ? { item: e.item } : {}) };
    const evaluated = evaluateDedupeKey(snapshot.dedupe_key_spec, input, timeZone);
    if (!evaluated.ok) return row("failed", { error: evaluated.error });
    dedupeKey = evaluated.key;
    if (doneWithKey(store, e.playbook, dedupeKey, null)) {
      if (e.item !== null) appendItemSkipped(store, e.playbook, e.item, dedupeKey, now);
      return row("skipped_duplicate", null, dedupeKey);
    }
  }
  // A GitHub item whose agent lacks the grant or a usable connector parks (terminal, never a
  // duplicate: the next poll's message runs once both are there), one notification per outage.
  if (e.item !== null && isGithubItem(e.item)) {
    const park = needsGithub(store, e.agent);
    if (park !== undefined) {
      notifyNeedsGithub(store, { playbook: e.playbook, slug: snapshot.slug, agent: e.agent, item: e.item, park }, now);
      return row("parked", { ...park }, dedupeKey);
    }
  }
  // f. The run.
  const runId = insertRun(store, { playbook: e.playbook, version: e.version, kind: e.kind, status: "running", dedupeKey, result: null, item: e.item }, now);
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
  /** The polled item the run is about, shown wrapped as data (`itemPromptBlock`); absent or `null` for a per-instant run. */
  readonly item?: RunItem | null;
  readonly loomwright: LoomwrightSummary;
  readonly now: Date;
  readonly timeZone: string;
}

/**
 * The prompt a playbook session starts with: the playbook's heading and its
 * intent (the owner approved this exact version when enabling it; any edit
 * returns it to draft), then the item block when the run is an item's (the
 * item wrapped as data from its ref), then Wright's context (`buildContext`)
 * whose message is a kernel-built line, wrapped as data like any message that
 * is not the owner's.
 */
export function playbookPrompt(input: PlaybookPromptInput): string {
  const heading = `## Playbook ${input.slug} (#${input.id}, version ${input.version}, enabled by the owner)\n\n`;
  const instruction = `Run this playbook. Its intent is your instruction for this session:\n\n${defuseWrapperTags(input.intent)}\n\n`;
  const item = input.item == null ? "" : itemPromptBlock(input.item);
  const text = `Playbook ${input.slug} ${input.kind === "fire" ? `fired for ${input.scheduledAt}` : "run now by the owner"}.`;
  return `${heading}${instruction}${item}${buildContext({ dataDir: input.dataDir, source: `playbook:${input.id}`, text, loomwright: input.loomwright, now: input.now, timeZone: input.timeZone })}`;
}

/** A crew member's own memory files, in the order its playbook prompt shows them. */
const CREW_PROMPT_FILES = Object.freeze(["role.md", "preferences.md", "people.md", "lessons.md"] as const);

/** Kept free for the cut notes when `MAX_CONTEXT_CHARS` cuts the memory sections (`buildContext`'s reserve). */
const CREW_NOTE_RESERVE = 1_000;

/** What a crew member's playbook prompt is built from: `PlaybookPromptInput` without Loomwright, plus the member. */
export type CrewPlaybookPromptInput = Omit<PlaybookPromptInput, "loomwright"> & { readonly agent: string };

function crewCutNote(name: string, n: number, atLeast: boolean, why: string): string {
  return `… truncated: ${name}, ${atLeast ? "at least " : ""}${n} chars cut (${why})`;
}

/**
 * The prompt a crew member's playbook session starts with: the same heading
 * and instruction as `playbookPrompt` (the intent, wrapper tags defused) and,
 * for an item's run, the same item block, then the member's OWN memory files (`memory/<agent>/role.md`, `preferences.md`,
 * `people.md`, `lessons.md`, each cut at `MAX_MEMORY_FILE_CHARS`; a missing or
 * unreadable one is noted), then `## Now` with the local time and the
 * kernel-built line (`Playbook <slug> fired for <scheduled_at>.` or `… run now
 * by the owner.`: kernel text, so not wrapped). It never calls `buildContext`
 * and never reads `memory/wright`: Wright's memory is not the member's. At most
 * `MAX_CONTEXT_CHARS` characters: the heading, instruction, item block, time
 * and line are always kept; the memory sections fill the rest in order, and the first one
 * that does not fit is cut (the ones after it dropped), each with a note.
 * Throws `TypeError` for an id that is not a crew member's (never reached:
 * the run checks the agent is registered first).
 */
export function crewPlaybookPrompt(input: CrewPlaybookPromptInput): string {
  if (!isValidAgentId(input.agent)) throw new TypeError(`agent ${JSON.stringify(input.agent)} is not a crew member's id; a crew playbook prompt reads only a crew member's memory`);
  const heading = `## Playbook ${input.slug} (#${input.id}, version ${input.version}, enabled by the owner)\n\n`;
  const instruction = `Run this playbook. Its intent is your instruction for this session:\n\n${defuseWrapperTags(input.intent)}\n\n`;
  const item = input.item == null ? "" : itemPromptBlock(input.item);
  const line = `Playbook ${input.slug} ${input.kind === "fire" ? `fired for ${input.scheduledAt}` : "run now by the owner"}.`;
  const tail = `## Now\n\n${localTimeLine(input.now, input.timeZone)}\n\n${line}\n`;
  const sections = CREW_PROMPT_FILES.map((file) => {
    const name = `memory/${input.agent}/${file}`;
    const read = readMemoryFile(input.dataDir, `${input.agent}/${file}`, MAX_MEMORY_FILE_CHARS);
    let body = read.problem === null ? read.text.trimEnd() : `(${name} is ${read.problem === "missing" ? "missing" : `unreadable: ${read.problem}`})`;
    if (read.cut > 0) body += `\n${crewCutNote(name, read.cut, read.atLeast, `file limit ${MAX_MEMORY_FILE_CHARS}`)}`;
    if (body === "") body = "(empty)";
    return { name, body };
  });
  const render = (name: string, body: string): string => `## ${name}\n\n${body}\n`;
  const budget = MAX_CONTEXT_CHARS - heading.length - instruction.length - item.length - tail.length - CREW_NOTE_RESERVE;
  const kept: string[] = [];
  const notes: string[] = [];
  let used = 0;
  for (const section of sections) {
    const full = render(section.name, section.body);
    const sep = kept.length === 0 ? 0 : 1;
    if (notes.length === 0 && used + sep + full.length <= budget) {
      kept.push(full);
      used += sep + full.length;
      continue;
    }
    // The first section that does not fit is cut to what is left; the rest are dropped. Each is noted.
    const room = notes.length === 0 ? budget - used - sep - render(section.name, "").length : 0;
    if (room > 0) {
      const cut = cutChars(section.body, room);
      kept.push(render(section.name, cut));
      used += sep + render(section.name, "").length + cut.length;
      notes.push(crewCutNote(section.name, section.body.length - cut.length, false, `context limit ${MAX_CONTEXT_CHARS}`));
    } else {
      notes.push(crewCutNote(section.name, section.body.length, false, `context limit ${MAX_CONTEXT_CHARS}`));
    }
  }
  const noteText = notes.length === 0 ? "" : `${notes.join("\n")}\n`;
  return `${heading}${instruction}${item}${[kept.join("\n"), noteText, tail].filter((p) => p !== "").join("\n")}`;
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

/**
 * What the `start-session` step stored: the session's id, or no session and
 * why (a `skip`, or a `fail` detail; `fail_event` when the event fails too).
 */
type Started =
  | { readonly session_id: number }
  | { readonly session_id: null; readonly skip: LateSkip }
  | { readonly session_id: null; readonly fail: string; readonly fail_event?: true };

/**
 * The `start-session` step's stored result, read as stored by this code or by
 * the earlier shape (`{session_id}` or `{session_id: null, skip}`, no `fail`).
 * Anything else is `undefined`: nothing is written from it.
 */
function startedOf(value: unknown): Started | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (isPositiveId(v.session_id)) return { session_id: v.session_id };
  if (v.session_id !== null) return undefined;
  if (typeof v.fail === "string") return { session_id: null, fail: v.fail, ...(v.fail_event === true ? { fail_event: true as const } : {}) };
  const skip = v.skip as Record<string, unknown> | null | undefined;
  if (typeof skip === "object" && skip !== null && (skip.status === "skipped_not_enabled" || skip.status === "skipped_duplicate")) {
    const result = typeof skip.result === "object" && skip.result !== null ? (skip.result as Record<string, unknown>) : null;
    return { session_id: null, skip: { status: skip.status, result } };
  }
  return undefined;
}

/** What a crew member's playbook needs to start its session: the run so far. */
interface CrewStart {
  readonly e: PlaybookEvent;
  readonly runId: number;
  readonly slug: string;
  readonly intent: string;
  readonly model: string;
  readonly dedupeKey: string | null;
}

/**
 * Steps g-i for a crew member's playbook, inside the `start-session` step
 * (the same shape as Wright's): the member is still `active` (else a stored
 * `agent_off` fail and one notification, in the step so a replay records
 * none more), its memory files (a write error fails the event too; a missing
 * `role.md` is `charter_missing`), its own settings (a refusal stored as
 * Wright's are: `model_unset: set "model" in <file>`, `settings_invalid: …`,
 * `settings_missing: …`), the session manager, the live row, the crew prompt
 * and the session as the member: its permission mode, its policy with its
 * `never` list, cwd `memory/<id>`. Admission applies the member's limits
 * (the session carries its agent); a refusal is rethrown as for Wright's.
 */
async function startCrewSession(ctx: EventContext, deps: PlaybookRunDeps, c: CrewStart): Promise<{ readonly started: Started; readonly handle?: SessionHandle }> {
  const { store } = ctx;
  const { e } = c;
  const dataDir = store.dataDir;
  // g. The member, still on: it may have been turned off since the run row was written (a parked event).
  if (getAgent(store, e.agent)?.status !== "active") {
    notifyAgentOff(store, e, c.slug, deps.now());
    return { started: { session_id: null, fail: "agent_off" } };
  }
  let memory;
  try {
    memory = ensureAgentMemoryFiles(dataDir, e.agent);
  } catch (err) {
    return { started: { session_id: null, fail: `memory_unwritable: ${messageOf(err)}`, fail_event: true } };
  }
  if (!memory.ok) return { started: { session_id: null, fail: memory.error === "charter_missing" ? `charter_missing: ${memory.file}` : `${memory.error}: ${memory.message}` } };
  const settings = readAgentSettings(dataDir, e.agent);
  if (!settings.ok) {
    return { started: { session_id: null, fail: settings.error === "model_unset" ? `model_unset: set "model" in ${settings.file}` : `${settings.error}: ${settings.message}` } };
  }
  const sessions = ctx.sessions;
  if (sessions === undefined) return { started: { session_id: null, fail: "no_session_manager" } };
  const skip = lateSkip(store, e, c.runId, c.dedupeKey, deps.now());
  if (skip !== undefined) return { started: { session_id: null, skip } };
  // h. The prompt: the member's own memory, never Wright's.
  const prompt = crewPlaybookPrompt({
    dataDir,
    agent: e.agent,
    id: e.playbook,
    slug: c.slug,
    version: e.version,
    intent: c.intent,
    kind: e.kind,
    scheduledAt: e.scheduledAt,
    item: e.item,
    now: deps.now(),
    timeZone: deps.timeZone(),
  });
  // i. The session, as the member.
  const s = settings.settings;
  const handle = await sessions.startSession({
    agent: e.agent,
    prompt,
    model: c.model,
    permissionMode: s.permissionMode,
    cwd: agentMemoryDir(dataDir, e.agent),
    policy: { ...s.policy, ...(s.never !== undefined ? { never: s.never } : {}) },
    playbook: e.playbook,
    playbookVersion: e.version,
  });
  return { started: { session_id: handle.id }, handle };
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
  const dataDir = store.dataDir;
  const model = decision.model ?? "";
  const dedupeKey = decision.dedupe_key ?? null;

  // g-i. One step: everything that decides whether the session starts (settings,
  // the live row, the prompt, the start) runs inside it, and the row is written
  // after it from its stored result only, so a replay of a done step never
  // decides again (the settings or the live row may have changed since).
  // The session is the step's last effect, so an admission refusal leaves nothing to repeat.
  let handle: SessionHandle | undefined;
  let stored: unknown;
  try {
    stored = await ctx.runStepAsync("start-session", async (): Promise<Started> => {
      // A crew member's playbook runs as that member (step d let through only Wright or a registered member).
      if (e.agent !== "wright") {
        const crew = await startCrewSession(ctx, deps, { e, runId, slug: decision.slug ?? "", intent: decision.intent ?? "", model, dedupeKey });
        handle = crew.handle;
        return crew.started;
      }
      // g. Wright's memory files and settings: only the permission mode and policy are used.
      try {
        ensureMemoryFiles(dataDir);
      } catch (err) {
        return { session_id: null, fail: `memory_unwritable: ${messageOf(err)}`, fail_event: true };
      }
      let settings;
      try {
        settings = readWrightSettings(dataDir);
      } catch (err) {
        return { session_id: null, fail: `settings_unwritable: ${messageOf(err)}`, fail_event: true };
      }
      if (!settings.ok) {
        return { session_id: null, fail: settings.error === "model_unset" ? `model_unset: set "model" in ${settings.file}` : `settings_invalid: ${settings.message}` };
      }
      const sessions = ctx.sessions;
      if (sessions === undefined) return { session_id: null, fail: "no_session_manager" };
      // The stored `start` may be stale (a parked event, or a crash after step b-f):
      // the live row is read again, and a skip is stored so a replay skips too.
      const skip = lateSkip(store, e, runId, dedupeKey, deps.now());
      if (skip !== undefined) return { session_id: null, skip };
      // h. The prompt.
      const prompt = playbookPrompt({
        dataDir,
        id: e.playbook,
        slug: decision.slug ?? "",
        version: e.version,
        intent: decision.intent ?? "",
        kind: e.kind,
        scheduledAt: e.scheduledAt,
        item: e.item,
        loomwright: deps.loomwright(sessions),
        now: deps.now(),
        timeZone: deps.timeZone(),
      });
      // i. The session.
      const { permissionMode, policy } = settings.settings;
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
      failBeforeSession(store, runId, `session_refused: ${messageOf(err)}`, deps.now());
    }
    throw err;
  }

  // Every write below comes from the stored result and is guarded, so a replay repeats it harmlessly.
  const started = startedOf(stored);
  if (started === undefined) throw new TypeError(`event ${event.id}: the start-session step stored an unknown result`);
  if (started.session_id === null) {
    // No session started: the row (still `running`, no session) ends as the stored skip or failure.
    if ("fail" in started) {
      failBeforeSession(store, runId, started.fail, deps.now());
      if (started.fail_event === true) throw new Error(`playbook ${e.playbook} run ${runId} failed: ${started.fail}`);
      return;
    }
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
