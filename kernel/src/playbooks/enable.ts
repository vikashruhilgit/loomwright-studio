// The playbooks feature's `enable` part (phase 3 item 07): Wright asks to
// enable a draft playbook it dry-ran, the owner approves it once, and Wright's
// retry enables exactly the version the owner saw. `./index.ts` merges this
// part with the others in `PLAYBOOK_PARTS`.
//
//   tool  kernel_playbook_enable(id, idempotency_key)  (Wright: its own draft playbooks)
//
// Every call to the tool is held for the owner by the kernel's PreToolUse
// rail (`ALWAYS_HELD_TOOLS` in `../sessions/policy.ts`), never by this part.
// Two halves:
//
// - `beforeHold`, which the gate asks before it holds the call (it can only
//   narrow): a playbook that is missing, not the caller's, turned off by the
//   owner or not a draft, an idempotency key whose work step already exists
//   in this session (an earlier enable used it: its stored result would be
//   replayed, so a new approval could only be spent with no effect), or a
//   playbook whose current version has no `done` dry run (`latestDryRun`), is
//   refused, so no approval is written; otherwise the call
//   is held with a display for `studio approvals` (the name, slug, version,
//   every policy value with `(proposed)` where Wright set it, and the dry
//   run's summary) and the version as the approval's `subject_version`.
// - the handler, which runs only when the gate let the call through: on the
//   owner-approved retry that consumed this call's own one-shot grant. It
//   finds that approval (`approval_used` in this session, for this tool, with
//   this call's playbook and idempotency key, held by the rail), refuses
//   "version changed" unless the approval's `subject_version` is the current
//   version, no `playbook_updated` came after the request, and the current
//   version still has a `done` dry run, then enables the playbook at that
//   version (`enablePlaybook`) in a work step keyed
//   `ctx.stepKey(idempotency_key)`. A step already `done` for the key is
//   replayed only when its stored `approval_id` is this call's own approval;
//   otherwise (a newer approval was consumed for the same key) it refuses and
//   enables nothing, never returning the old result as this call's success.
//
// It never edits the triggers module: the linked trigger already exists
// (item 02), and item 08 makes it fire. The `studio` CLI loads this module:
// zod, the feature seam, `../loop/*` and this feature's files only.
import { z } from "zod";
import { defineTool } from "../features/contribution.js";
import type { ContributedTool, ContributedToolContext } from "../features/contribution.js";
import { getWorkStep, runStep } from "../loop/steps.js";
import type { HeldToolVerdict } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { afterPlaybookStep, named, owningAgent } from "./drafts.js";
import { DRY_RUN_TOOL_NAME, latestDryRun } from "./dry-run.js";
import type { DryRunRecord } from "./dry-run.js";
import { PlaybookError, enablePlaybook, getPlaybook, linkedTriggerOf, refuseIfOwnerTurnedOff } from "./store.js";
import type { PlaybookRow } from "./store.js";
import type { PlaybookPart } from "./types.js";

export const ENABLE_TOOL_NAME = "kernel_playbook_enable";

/** The tool's full SDK name: what the gate holds, and what its `approval_used` event names. */
const ENABLE_FULL_NAME = `mcp__kernel__${ENABLE_TOOL_NAME}`;

/** What the handler returns (and its work step stores). */
export interface EnableToolResult {
  /** The playbook's id. */
  readonly playbook: number;
  readonly version: number;
  readonly status: "enabled";
  readonly approval_id: number;
}

function invalid(message: string): PlaybookError {
  return new PlaybookError("invalid_input", message);
}

/** Playbook `id` if the caller may enable it: it exists, is its own, is not turned off by the owner, and is a draft. */
function ownDraft(store: Store, id: number, agent: string): PlaybookRow {
  const row = getPlaybook(store, id);
  if (row === undefined) throw new PlaybookError("not_found", `no playbook ${id}`);
  if (row.owning_agent !== agent) throw new PlaybookError("not_owner", `playbook ${row.id} belongs to agent ${row.owning_agent}; an agent can enable only its own playbooks`);
  refuseIfOwnerTurnedOff(store, row.id);
  if (row.status !== "draft") throw invalid(`playbook ${row.id} is ${row.status}, not draft: only a draft is enabled`);
  return row;
}

// ---- The display ----------------------------------------------------------------

function setterText(setBy: string | null): string {
  return setBy === "wright" ? " (proposed)" : setBy === "owner" ? " (set by owner)" : "";
}

function valueLine(label: string, value: string | number | null, setBy: string | null): string {
  return `${label}: ${value === null ? "not set" : String(value)}${value === null ? "" : setterText(setBy)}`;
}

function dedupeText(spec: string | null): string | null {
  if (spec === null) return null;
  try {
    const fields = JSON.parse(spec) as unknown;
    if (Array.isArray(fields)) return fields.map(String).join(", ");
  } catch {
    // Unreadable: shown as stored.
  }
  return spec;
}

function scheduleText(trigger: ReturnType<typeof linkedTriggerOf>): string {
  if (trigger === null) return "trigger: none";
  const spec = (typeof trigger.spec === "object" && trigger.spec !== null ? trigger.spec : {}) as { at?: unknown; cron?: unknown; tz?: unknown };
  if (trigger.kind === "once") return `trigger ${trigger.id}: once at ${String(spec.at)}`;
  if (trigger.kind === "cron") return `trigger ${trigger.id}: cron ${JSON.stringify(spec.cron)} in ${String(spec.tz)}`;
  return `trigger ${trigger.id}: ${trigger.kind}`;
}

/**
 * What `studio approvals` shows for an enable: the playbook (name, slug, id,
 * version, agent), its schedule, every policy value (` (proposed)` where
 * Wright set it), and the dry run's summary. Stored text throughout: the CLI
 * escapes every line.
 */
export function enableDisplay(store: Store, row: PlaybookRow, dryRun: DryRunRecord): string {
  return [
    `Enable playbook ${JSON.stringify(row.name)} (${row.slug}, #${row.id}) at version ${row.version}, agent ${row.owning_agent}`,
    scheduleText(linkedTriggerOf(store, row)),
    valueLine("model", row.model, row.model_set_by),
    valueLine("priority", row.priority, row.priority_set_by),
    valueLine("dedupe_key", dedupeText(row.dedupe_key_spec), row.dedupe_key_set_by),
    valueLine("token_limit", row.token_limit_per_day, row.token_limit_set_by),
    valueLine("effort", row.effort, row.effort_set_by),
    valueLine("api_key_fallback", row.api_key_fallback_json, row.api_key_fallback_set_by),
    `dry run: ${dryRun.summary}`,
  ].join("\n");
}

/** The refusal for an idempotency key an earlier enable of this session already used. */
function usedKeyMessage(id: number): string {
  return `idempotency_key already used for an enable in this session; use a new key to ask again for playbook ${id}`;
}

/**
 * The gate's pre-hold check: refuse (no approval) unless the caller's draft's
 * current version has a `done` dry run and the idempotency key has no work
 * step yet in this session (a used key would replay the old result, spending
 * the owner's new approval on nothing); else hold with the display and the
 * version. A refusal of the playbook (`PlaybookError`) is a `refuse`; any
 * other throw propagates (the gate denies `kernel_gate_error`).
 */
function beforeHold(a: { id: number; idempotency_key: string }, ctx: ContributedToolContext): HeldToolVerdict {
  try {
    const row = ownDraft(ctx.store, a.id, owningAgent(ctx));
    if (getWorkStep(ctx.store, ctx.stepKey(a.idempotency_key)) !== undefined) {
      return { refuse: `${ENABLE_TOOL_NAME}: ${usedKeyMessage(row.id)} (nothing was held for the owner)` };
    }
    const dryRun = latestDryRun(ctx.store, row.id, row.version);
    if (dryRun === null) {
      return {
        refuse: `${ENABLE_TOOL_NAME}: a dry run of version ${row.version} is required before playbook ${row.id} can be enabled; call ${DRY_RUN_TOOL_NAME} first (nothing was held for the owner)`,
      };
    }
    return { display: enableDisplay(ctx.store, row, dryRun), subjectVersion: row.version };
  } catch (err) {
    if (err instanceof PlaybookError) return { refuse: `${ENABLE_TOOL_NAME}: ${err.message}` };
    throw err;
  }
}

// ---- The owner-approved retry ------------------------------------------------------

/** The consumed approval this call runs on, with its `approval_requested` event. */
interface OwnApproval {
  readonly id: number;
  readonly requestedEventId: number;
  readonly subjectVersion: unknown;
}

interface UsedRow {
  readonly approval_id: number;
  readonly payload_json: string;
  readonly requested_event_id: number;
  readonly requested_json: string;
}

/** The playbook a held enable's input named (an id, or a slug resolved to one), or undefined. */
function inputPlaybookId(store: Store, input: unknown): number | undefined {
  const id = (input as { id?: unknown } | null)?.id;
  if (typeof id !== "number" && typeof id !== "string") return undefined;
  return getPlaybook(store, id)?.id;
}

/**
 * This call's own approval: the newest one consumed (`approval_used`) in
 * session `sessionId` for this tool, approved, held by the rail, whose held
 * input named playbook `playbookId` and idempotency key `key`. A different
 * enable's approval in the same session never counts.
 */
function ownApproval(store: Store, sessionId: number, playbookId: number, key: string): OwnApproval | undefined {
  const rows = store
    .prepare<[number, string], UsedRow>(
      `SELECT a.id AS approval_id, a.payload_json AS payload_json, r.id AS requested_event_id, r.payload_json AS requested_json
         FROM events u
         JOIN approvals a ON a.id = json_extract(u.payload_json, '$.id')
         JOIN events r ON r.kind = 'approval_requested' AND json_extract(r.payload_json, '$.id') = a.id
        WHERE u.kind = 'approval_used' AND u.session_id = ? AND json_extract(u.payload_json, '$.tool') = ?
          AND a.status = 'approved' AND json_extract(r.payload_json, '$.source') = 'rail'
        ORDER BY u.id DESC, r.id`,
    )
    .all(sessionId, ENABLE_FULL_NAME);
  for (const row of rows) {
    const payload = parsedObject(row.payload_json) as { input?: { idempotency_key?: unknown } } | null;
    const requested = parsedObject(row.requested_json) as { subject_version?: unknown } | null;
    if (payload === null || requested === null) continue;
    if (payload.input?.idempotency_key !== key || inputPlaybookId(store, payload.input) !== playbookId) continue;
    return { id: row.approval_id, requestedEventId: row.requested_event_id, subjectVersion: requested.subject_version };
  }
  return undefined;
}

/** Stored JSON text as an object, or null when it is not one. */
function parsedObject(json: string): object | null {
  try {
    const value = JSON.parse(json) as unknown;
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

/** Whether playbook `id` has a `playbook_updated` event after event `eventId` (event ids only grow: no clock ties). */
function editedSince(store: Store, id: number, eventId: number): boolean {
  return (
    store
      .prepare<[number, number], number>(
        "SELECT 1 FROM events WHERE kind = 'playbook_updated' AND json_valid(payload_json) AND json_extract(payload_json, '$.playbook_id') = ? AND id > ? LIMIT 1",
      )
      .pluck()
      .get(id, eventId) !== undefined
  );
}

/** Refuse unless this call runs on its own consumed approval for the current version; then enable it. In one transaction (the step's). */
function enableOnApproval(ctx: ContributedToolContext, a: { id: number; idempotency_key: string }, agent: string): EnableToolResult {
  const { store } = ctx;
  const row = ownDraft(store, a.id, agent);
  const approval = ownApproval(store, ctx.sessionId, row.id, a.idempotency_key);
  if (approval === undefined) {
    throw invalid(`no approval of its own: this call has no owner-approved request in this session for playbook ${row.id} with this idempotency_key; nothing was enabled`);
  }
  if (approval.subjectVersion !== row.version) {
    throw invalid(`version changed: approval ${approval.id} was for version ${String(approval.subjectVersion ?? "unknown")}, the playbook is at version ${row.version}; it stays draft`);
  }
  if (editedSince(store, row.id, approval.requestedEventId)) {
    throw invalid(`version changed: playbook ${row.id} was edited after approval ${approval.id} was requested; it stays draft`);
  }
  if (latestDryRun(store, row.id, row.version) === null) {
    throw invalid(`version changed: version ${row.version} has no done dry run; it stays draft`);
  }
  enablePlaybook(store, { id: row.id, version: row.version, sessionId: ctx.sessionId, approvalId: approval.id }, ctx.now());
  return { playbook: row.id, version: row.version, status: "enabled", approval_id: approval.id };
}

/**
 * Defence behind `beforeHold`: a step already `done` for this key is replayed
 * only when its stored result is for playbook `a.id` and its stored
 * `approval_id` is this call's own consumed approval.
 * When a newer approval was consumed for the same key (the gate let a stale
 * key through), refuse: nothing is enabled and the old result is never
 * returned as this call's success. Synchronous with the `runStep` that
 * follows: no call interleaves between this read and the step's claim.
 */
function refuseStaleReplay(ctx: ContributedToolContext, a: { id: number; idempotency_key: string }): void {
  const step = getWorkStep(ctx.store, ctx.stepKey(a.idempotency_key));
  if (step?.status !== "done") return;
  const result = step.result as { playbook?: unknown; approval_id?: unknown } | null | undefined;
  // A key is scoped to the session, not to a playbook: another playbook's stored result is never this call's.
  if (result?.playbook !== a.id) {
    throw invalid(
      `idempotency_key already used in this session for the enable of playbook ${String(result?.playbook ?? "unknown")}; ` +
        `use a new key to ask again for playbook ${a.id}; nothing was enabled`,
    );
  }
  const stored = result.approval_id;
  const playbookId = getPlaybook(ctx.store, a.id)?.id;
  const approval = playbookId === undefined ? undefined : ownApproval(ctx.store, ctx.sessionId, playbookId, a.idempotency_key);
  if (approval === undefined || approval.id !== stored) {
    throw invalid(
      `${usedKeyMessage(a.id)}: its stored result is for approval ${String(stored ?? "unknown")}, ` +
        `not approval ${approval === undefined ? "unknown" : String(approval.id)}; nothing was enabled`,
    );
  }
}

const enableTool = defineTool({
  name: ENABLE_TOOL_NAME,
  description:
    "Ask the owner to enable a draft playbook you own, at its current version. Its current version needs a done kernel_playbook_dry_run first; otherwise this is refused. " +
    "The kernel always holds this call for the owner, showing the playbook, its values and the dry run; end your turn. If the owner approves, run exactly the same call again, once: " +
    "the playbook is then enabled at the version the owner saw. If it was changed since (a new version), the retry is refused and it stays a draft: dry-run it again and ask again. " +
    "Returns {playbook, version, status: enabled, approval_id}. Use a new idempotency_key for each request to the owner: a key an earlier enable in this session used is refused, nothing held.",
  shape: { id: z.number().int().positive(), idempotency_key: z.string().min(1).max(200) },
  beforeHold,
  handler: (a, ctx) =>
    named(ENABLE_TOOL_NAME, () => {
      const agent = owningAgent(ctx);
      refuseStaleReplay(ctx, a);
      const first = runStep(ctx.store, ctx.stepKey(a.idempotency_key), () => enableOnApproval(ctx, a, agent), { now: ctx.now });
      return afterPlaybookStep(ctx, first.playbook, first);
    }),
});

/** The part's one tool. */
export const enableTools: readonly ContributedTool[] = Object.freeze([enableTool]);

export const enablePart: PlaybookPart = Object.freeze({
  name: "enable",
  tools: enableTools,
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
