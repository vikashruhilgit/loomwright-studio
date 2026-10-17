// The playbooks feature's `enable` part (phase 3 item 07): Wright asks to
// enable a draft playbook it dry-ran, the owner approves it once, and the
// kernel enables exactly the version the owner saw, in the decision's
// transaction (`applyOnApproval`; `KERNEL_APPLIED_ACTIONS`). `./index.ts`
// merges this part with the others in `PLAYBOOK_PARTS`.
//
//   tool  kernel_playbook_enable(id, idempotency_key)  (Wright: its own draft playbooks)
//
// Every call to the tool is held for the owner by the kernel's PreToolUse
// rail (`ALWAYS_HELD_TOOLS` in `../sessions/policy.ts`), never by this part.
// Three parts:
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
// - `applyOnApproval`, which the approvals decision runs when the owner
//   approves the held call `once`: `enableApproved` re-checks the playbook
//   (its agent, the owner's off, `draft`), refuses "version changed" unless
//   the approval's `subject_version` is the current version and no
//   `playbook_updated` came after the request, refuses with no `done` dry run
//   of the current version, then enables it (`enablePlaybook`). A refusal is
//   recorded on the approval and said in the agent's message; nothing is
//   enabled.
// - the handler, a defence path only: it runs when the gate let a call
//   through on a one-shot grant the kernel did not spend (a composition with
//   no applier). It finds that approval (`approval_used` in this session, for
//   this tool, with this call's playbook and idempotency key, held by the
//   rail), runs the same `enableApproved` checks and enable in a work step
//   keyed `ctx.stepKey(idempotency_key)`. A step already `done` for the key
//   is replayed only when its stored `approval_id` is this call's own
//   approval; otherwise (a newer approval was consumed for the same key) it
//   refuses and enables nothing, never returning the old result as this
//   call's success. After the kernel enabled it, a retry is refused before
//   the hold (`beforeHold`: the playbook is no longer a draft).
//
// It never edits the triggers module: the linked trigger already exists
// (item 02), and item 08 makes it fire. The `studio` CLI loads this module:
// zod, the feature seam, `../loop/*` and this feature's files only.
import { z } from "zod";
import type { AppliedApproval, ApprovalApplyOutcome } from "../approvals/store.js";
import { defineTool } from "../features/contribution.js";
import type { ContributedTool, ContributedToolContext } from "../features/contribution.js";
import { getWorkStep, runStep } from "../loop/steps.js";
import type { HeldToolVerdict } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { afterPlaybookStep, named, owningAgent, syncMirror } from "./drafts.js";
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

/**
 * Why `enableApproved` enabled nothing. `reason` is also the approval's
 * `apply_refused` token when the kernel applied the enable; `message` is the
 * one-line detail.
 */
export class EnableRefused extends Error {
  readonly reason: "not_found" | "not_owner" | "turned_off_by_owner" | "not_draft" | "version_changed" | "no_dry_run";

  constructor(reason: EnableRefused["reason"], message: string) {
    super(message);
    this.name = "EnableRefused";
    this.reason = reason;
  }
}

/** The `PlaybookError` the tool's own paths answer for a refusal, with the text they always gave. */
function playbookErrorOf(err: EnableRefused): PlaybookError {
  if (err.reason === "not_found" || err.reason === "not_owner") return new PlaybookError(err.reason, err.message);
  if (err.reason === "turned_off_by_owner") return new PlaybookError("owner_off", err.message);
  if (err.reason === "version_changed" || err.reason === "no_dry_run") return invalid(`version changed: ${err.message}`);
  return invalid(err.message);
}

/** `body`, with an `EnableRefused` answered as the tool's `PlaybookError`. */
function asPlaybookError<T>(body: () => T): T {
  try {
    return body();
  } catch (err) {
    throw err instanceof EnableRefused ? playbookErrorOf(err) : err;
  }
}

/**
 * Playbook `id` if `agent` may enable it, in this order: it exists
 * (`not_found`), it is `agent`'s (`not_owner`; a null agent never matches),
 * the owner did not turn it off (`turned_off_by_owner`), and it is a draft
 * (`not_draft`). Throws `EnableRefused`.
 */
function draftOf(store: Store, id: number, agent: string | null): PlaybookRow {
  const row = getPlaybook(store, id);
  if (row === undefined) throw new EnableRefused("not_found", `no playbook ${id}`);
  if (agent === null || row.owning_agent !== agent) {
    throw new EnableRefused("not_owner", `playbook ${row.id} belongs to agent ${row.owning_agent}; an agent can enable only its own playbooks`);
  }
  try {
    refuseIfOwnerTurnedOff(store, row.id);
  } catch (err) {
    if (err instanceof PlaybookError && err.code === "owner_off") throw new EnableRefused("turned_off_by_owner", err.message);
    throw err;
  }
  if (row.status !== "draft") throw new EnableRefused("not_draft", `playbook ${row.id} is ${row.status}, not draft: only a draft is enabled`);
  return row;
}

/** Playbook `id` if the caller may enable it: it exists, is its own, is not turned off by the owner, and is a draft. */
function ownDraft(store: Store, id: number, agent: string): PlaybookRow {
  return asPlaybookError(() => draftOf(store, id, agent));
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

/** What `enableApproved` runs on. */
export interface EnableApprovedParams {
  readonly playbookId: number;
  /** The agent the enable is for: the playbook's owning agent must be it (null never matches). */
  readonly agent: string | null;
  /** The owner's approval: its id, its `approval_requested` event's id and that event's `subject_version`. */
  readonly approval: { readonly id: number; readonly requestedEventId: number; readonly subjectVersion: unknown };
  /** The session `playbook_enabled` is linked to (the requesting session). */
  readonly sessionId: number | null;
  readonly now: Date;
}

/**
 * Enable playbook `p.playbookId` on the owner's approval, the one enable both
 * paths use (the kernel's `applyOnApproval` and the tool's handler). Checks,
 * in order: `draftOf` (`not_found`, `not_owner`, `turned_off_by_owner`,
 * `not_draft`); the approval's `subject_version` is the current version and
 * no `playbook_updated` came after its request (`version_changed`); the
 * current version has a `done` dry run (`no_dry_run`). Then `enablePlaybook`
 * (which re-checks the version and `draft` in its own transaction; nested in
 * a caller's, it joins it). Throws `EnableRefused` for a refusal, writing
 * nothing; any other throw propagates.
 */
export function enableApproved(store: Store, p: EnableApprovedParams): EnableToolResult {
  const row = draftOf(store, p.playbookId, p.agent);
  const { approval } = p;
  if (approval.subjectVersion !== row.version) {
    throw new EnableRefused(
      "version_changed",
      `approval ${approval.id} was for version ${String(approval.subjectVersion ?? "unknown")}, the playbook is at version ${row.version}; it stays draft`,
    );
  }
  if (editedSince(store, row.id, approval.requestedEventId)) {
    throw new EnableRefused("version_changed", `playbook ${row.id} was edited after approval ${approval.id} was requested; it stays draft`);
  }
  if (latestDryRun(store, row.id, row.version) === null) throw new EnableRefused("no_dry_run", `version ${row.version} has no done dry run; it stays draft`);
  enablePlaybook(store, { id: row.id, version: row.version, sessionId: p.sessionId, approvalId: approval.id }, p.now);
  return { playbook: row.id, version: row.version, status: "enabled", approval_id: approval.id };
}

/** Refuse unless this call runs on its own consumed approval for the current version; then enable it. In one transaction (the step's). */
function enableOnApproval(ctx: ContributedToolContext, a: { id: number; idempotency_key: string }, agent: string): EnableToolResult {
  const { store } = ctx;
  const row = ownDraft(store, a.id, agent);
  const approval = ownApproval(store, ctx.sessionId, row.id, a.idempotency_key);
  if (approval === undefined) {
    throw invalid(`no approval of its own: this call has no owner-approved request in this session for playbook ${row.id} with this idempotency_key; nothing was enabled`);
  }
  return asPlaybookError(() => enableApproved(store, { playbookId: row.id, agent, approval, sessionId: ctx.sessionId, now: ctx.now() }));
}

/** `text` on one line: every run of whitespace as one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The kernel's apply of an approved held enable, inside the decision's
 * transaction: `enableApproved` for the approval's own agent and requesting
 * session. Enabled ⇒ the sentence for the agent and, once the decision
 * committed, the mirror rewrite. `EnableRefused` ⇒ its reason and a sentence
 * naming it. Any other throw propagates (the decision records `apply_error`).
 */
function applyOnApproval(a: { id: number; idempotency_key: string }, ctx: { store: Store; now: () => Date; approval: AppliedApproval }): ApprovalApplyOutcome {
  const { store, approval } = ctx;
  try {
    const done = enableApproved(store, { playbookId: a.id, agent: approval.agent, approval, sessionId: approval.sessionId, now: ctx.now() });
    const slug = getPlaybook(store, done.playbook)?.slug ?? `#${done.playbook}`;
    return {
      applied: `The kernel enabled playbook ${slug} (#${done.playbook}) at version ${done.version} on approval ${approval.id}.`,
      // `syncMirror` never throws: a failed write is left for the next resync.
      after: () => void syncMirror(store, done.playbook),
    };
  } catch (err) {
    if (!(err instanceof EnableRefused)) throw err;
    const slug = getPlaybook(store, a.id)?.slug ?? `#${a.id}`;
    return { refused: err.reason, text: `The kernel did not enable playbook ${slug} (#${a.id}): ${err.reason} (${oneLine(err.message)}).` };
  }
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
    "The kernel always holds this call for the owner, showing the playbook, its values and the dry run; end your turn. " +
    "The owner's approval enables it: the kernel applies it itself, at the version the owner saw, and tells you what it did in a new message; do not repeat the call. " +
    "If it was changed since (a new version), the kernel does not enable it and it stays a draft: dry-run it again and ask again. " +
    "Returns {playbook, version, status: enabled, approval_id}. Use a new idempotency_key for each request to the owner: a key an earlier enable in this session used is refused, nothing held.",
  shape: { id: z.number().int().positive(), idempotency_key: z.string().min(1).max(200) },
  beforeHold,
  applyOnApproval,
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
