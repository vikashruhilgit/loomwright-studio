// The playbooks feature's `enable` part (phase 3 item 07): Wright asks to
// enable a draft playbook it dry-ran, the owner approves it once, and the
// kernel enables exactly the version the owner saw, in the decision's
// transaction (`applyOnApproval`; `KERNEL_APPLIED_ACTIONS`). `./index.ts`
// merges this part with the others in `PLAYBOOK_PARTS`.
//
//   tool  kernel_playbook_enable(id, idempotency_key, enable_anyway?)  (Wright: its own draft playbooks and its crew's)
//
// Every call to the tool is held for the owner by the kernel's PreToolUse
// rail (`ALWAYS_HELD_TOOLS` in `../sessions/policy.ts`), never by this part.
// Three parts:
//
// - `beforeHold`, which the gate asks before it holds the call (it can only
//   narrow): a crew member's session (`crew_cannot_draft`: Wright drafts and
//   enables a crew member's playbooks), a playbook that is missing, not one
//   the caller may manage (`mayManage`, `./drafts.ts`), turned off by the
//   owner or not a draft, an idempotency key whose work step already exists
//   in this session (an earlier enable used it: its stored result would be
//   replayed, so a new approval could only be spent with no effect), or a
//   playbook whose current version has no `done` dry run (`latestDryRun`), or
//   whose `merge_requirement` is looser than the policy of a repo it polls or targets
//   (`playbook_looser_than_repo`), or a ClickUp or Jira ticket playbook with no
//   target repository (`no_target_repo`), or one whose target repository the
//   GitHub connector does not reach (`target_repo_not_reachable`;
//   `./target-repo.ts`), or a crew member's playbook whose jobs its
//   charter does not cover (`charter_gap`: `playbookFit` in `./fit.ts` is a
//   gap, or could not check, fail closed) unless the call sets `enable_anyway`, is
//   refused, so no approval is written; otherwise the call
//   is held with a display for `studio approvals` (the name, slug, version,
//   every policy value with `(proposed)` where Wright set it, and the dry
//   run's summary; for a playbook that names jobs, its jobs and the fit, and
//   with `enable_anyway` over an open gap, that gap and that the owner is
//   enabling it anyway, so the owner's approval records the choice) and the
//   version as the approval's `subject_version`.
// - `applyOnApproval`, which the approvals decision runs when the owner
//   approves the held call `once`: `enableApproved` re-checks the playbook
//   (its agent, the owner's off, `draft`), refuses "version changed" unless
//   the approval's `subject_version` is the current version and no
//   `playbook_updated` came after the request, refuses with no `done` dry run
//   of the current version, refuses `playbook_looser_than_repo` when the repo's
//   policy was raised since the hold, refuses `no_target_repo` /
//   `target_repo_not_reachable` when the target repository was cleared or
//   stopped being reachable since the hold (`enable_anyway` skips neither),
//   refuses `charter_gap` when a gap is open
//   and the held call did not set `enable_anyway`, then enables it (`enablePlaybook`). A refusal is
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
// zod, the feature seam, `../loop/*`, the leaf `../agents/registry.js`, the
// repo-policy read (`../integrations/github/repo-policy.js`: the store, the
// keychain reader and the GitHub client, never the Agent SDK), the
// catalogue's type and this feature's files only.
import { z } from "zod";
import { getAgent } from "../agents/registry.js";
import type { AppliedApproval, ApprovalApplyOutcome } from "../approvals/store.js";
import { defineTool } from "../features/contribution.js";
import { TOOL_JOBS } from "../features/catalogue.js";
import type { ToolCatalogue } from "../features/catalogue.js";
import type { ContributedTool, ContributedToolContext } from "../features/contribution.js";
import { getWorkStep, runStep } from "../loop/steps.js";
import { getRepoPolicy } from "../integrations/github/repo-policy.js";
import type { HeldToolVerdict } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { CREW_CANNOT_DRAFT_DETAIL, afterPlaybookStep, mayManage, named, refuseCrewDrafting, syncMirror } from "./drafts.js";
import { DRY_RUN_TOOL_NAME, latestDryRun } from "./dry-run.js";
import type { DryRunRecord } from "./dry-run.js";
import { fitGapOpen, playbookFit } from "./fit.js";
import type { PlaybookFit } from "./fit.js";
import { PlaybookError, enablePlaybook, getPlaybook, linkedTriggerOf, parseMergeRequirement, playbookJobsOf, refuseIfOwnerTurnedOff } from "./store.js";
import type { PlaybookRow } from "./store.js";
import { targetRepoRefusal } from "./target-repo.js";
import type { PlaybookPart } from "./types.js";

export const ENABLE_TOOL_NAME = "kernel_playbook_enable";

/** The tool's full SDK name: what the gate holds, and what its `approval_used` event names. */
const ENABLE_FULL_NAME = `mcp__kernel__${ENABLE_TOOL_NAME}`;

/** The tool's arguments, as its shape parses them. */
interface EnableArgs {
  readonly id: number;
  readonly idempotency_key: string;
  /** The owner said to enable it with its charter gap open: the held display says so, and the approval records it. */
  readonly enable_anyway?: boolean | undefined;
}

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
  readonly reason: "not_found" | "crew_cannot_draft" | "not_owner" | "turned_off_by_owner" | "not_draft" | "version_changed" | "no_dry_run" | "playbook_looser_than_repo" | "no_target_repo" | "target_repo_not_reachable" | "charter_gap";

  constructor(reason: EnableRefused["reason"], message: string) {
    super(message);
    this.name = "EnableRefused";
    this.reason = reason;
  }
}

/** The `PlaybookError` the tool's own paths answer for a refusal, with the text they always gave. */
function playbookErrorOf(err: EnableRefused): PlaybookError {
  if (err.reason === "not_found" || err.reason === "not_owner") return new PlaybookError(err.reason, err.message);
  if (err.reason === "crew_cannot_draft") return new PlaybookError("crew_cannot_draft", `crew_cannot_draft: ${err.message}`);
  if (err.reason === "turned_off_by_owner") return new PlaybookError("owner_off", err.message);
  if (err.reason === "version_changed" || err.reason === "no_dry_run") return invalid(`version changed: ${err.message}`);
  if (err.reason === "playbook_looser_than_repo") return invalid(`playbook_looser_than_repo: ${err.message}`);
  if (err.reason === "no_target_repo") return invalid(`no_target_repo: ${err.message}`);
  if (err.reason === "target_repo_not_reachable") return invalid(`target_repo_not_reachable: ${err.message}`);
  if (err.reason === "charter_gap") return invalid(`charter_gap: ${err.message}`);
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
 * (`not_found`), `agent` is not a registered crew member
 * (`crew_cannot_draft`: a defence, since `beforeHold` never holds a crew
 * session's call), `agent` may manage it (`not_owner` unless it is its own,
 * or Wright's request for a registered crew member's; a null agent never
 * matches), the owner did not turn it off (`turned_off_by_owner`), and it is
 * a draft (`not_draft`). Throws `EnableRefused`.
 */
function draftOf(store: Store, id: number, agent: string | null): PlaybookRow {
  const row = getPlaybook(store, id);
  if (row === undefined) throw new EnableRefused("not_found", `no playbook ${id}`);
  if (agent !== null && getAgent(store, agent) !== undefined) throw new EnableRefused("crew_cannot_draft", CREW_CANNOT_DRAFT_DETAIL);
  if (agent === null || !mayManage(store, agent, row.owning_agent)) {
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

/** Playbook `id` if the caller may enable it: it exists, it may manage it, it is not turned off by the owner, and it is a draft. */
function ownDraft(store: Store, id: number, agent: string): PlaybookRow {
  return asPlaybookError(() => draftOf(store, id, agent));
}

// ---- The repo's policy -----------------------------------------------------------------

/**
 * The repos a playbook's pull requests go to (`owner/name`): the `repos` of its linked poll trigger and its
 * own `target_repo`, de-duplicated as written (a policy is found only under the name it was set with, so two spellings are both checked).
 */
function polledRepos(store: Store, row: PlaybookRow): readonly string[] {
  const trigger = linkedTriggerOf(store, row);
  const spec = trigger !== null && trigger.kind === "poll" ? (trigger.spec as { repos?: unknown } | null) : null;
  const listed = Array.isArray(spec?.repos) ? spec.repos.filter((r): r is string => typeof r === "string") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const repo of [...listed, ...(row.target_repo ? [row.target_repo] : [])]) {
    if (!seen.has(repo)) {
      seen.add(repo);
      out.push(repo);
    }
  }
  return out;
}

/**
 * The refusal when `row`'s own `merge_requirement` is looser than a repo it polls or targets, or `undefined`: it is
 * `reviews:N` and a polled or target repo's policy is `reviews` with more than N required (a playbook may only be
 * stricter than its repo, never looser). `none`, `studio_approval`, no requirement and a repo with another
 * kind (or none) are never refused here. Reads the repo's stored policy at the call, so the apply sees
 * what the owner set after the enable was held.
 */
function looserThanRepo(store: Store, row: PlaybookRow): EnableRefused | undefined {
  const own = parseMergeRequirement(row.merge_requirement);
  if (own === null || own.reviews === null) return undefined;
  for (const repo of polledRepos(store, row)) {
    const policy = getRepoPolicy(store, repo);
    if (policy.kind === "reviews" && policy.required_reviews !== null && policy.required_reviews > own.reviews) {
      return new EnableRefused(
        "playbook_looser_than_repo",
        `merge_requirement reviews:${own.reviews} is looser than ${repo}, whose policy needs ${policy.required_reviews} reviews; set reviews:${policy.required_reviews} or more, or have the owner change the repo's policy`,
      );
    }
  }
  return undefined;
}

// ---- The target repository ---------------------------------------------------------

/**
 * The `no_target_repo` or `target_repo_not_reachable` refusal for `row`, or `undefined` (the rule is
 * `targetRepoRefusal`'s). Never skipped by `enable_anyway`, which is scoped to the charter gap. Reads the
 * playbook and the connector at the call, so the apply sees a change made after the hold.
 */
function targetRepoRefused(store: Store, row: PlaybookRow): EnableRefused | undefined {
  const refusal = targetRepoRefusal(store, row);
  return refusal === undefined ? undefined : new EnableRefused(refusal.reason, refusal.message);
}

// ---- The charter gap ---------------------------------------------------------------

/**
 * The `charter_gap` refusal when `fit` leaves a gap open (`fitGapOpen`: a gap,
 * or a check that could not run) and the owner did not say to enable it
 * anyway, or `undefined`. `atHold`: the refusal names the exact
 * `kernel_agent_update` that closes the gap and how to enable anyway; at the
 * apply it names the gap only (the playbook stays draft).
 */
function charterGap(row: PlaybookRow, fit: PlaybookFit | undefined, enableAnyway: boolean, atHold: boolean): EnableRefused | undefined {
  if (!fitGapOpen(fit) || enableAnyway) return undefined;
  const what = fit.lines.join(" ");
  if (!atHold) return new EnableRefused("charter_gap", `${what} Playbook ${row.id} stays draft`);
  const close =
    fit.proposed_update === undefined ? "" : ` Close it: call kernel_agent_update with ${JSON.stringify(fit.proposed_update)} and a new idempotency_key (held for the owner), then ask again.`;
  return new EnableRefused("charter_gap", `${what}${close} Only if the owner says to enable it with the gap open, call again with enable_anyway: true`);
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
 * The display's charter lines for a playbook that names jobs (none
 * otherwise, so such a display is as it always was): the jobs, then the fit's
 * lines; over an open gap with `enableAnyway`, that the owner is enabling it
 * anyway; then the owner's connector steps.
 */
function charterLines(row: PlaybookRow, fit: PlaybookFit | undefined, enableAnyway: boolean): string[] {
  if (fit === undefined || fit.status === "no_jobs") return [];
  const lines = [`jobs: ${playbookJobsOf(row).map((job) => TOOL_JOBS[job]).join(", ")}`, ...fit.lines.map((l) => `charter: ${l}`)];
  if (fitGapOpen(fit) && enableAnyway) lines.push("charter gap: open; the owner is enabling this playbook anyway, with the gap open");
  lines.push(...fit.owner_steps.map((step) => `owner step: ${step}`));
  return lines;
}

/**
 * What `studio approvals` shows for an enable: the playbook (name, slug, id,
 * version, agent), its schedule, every policy value (` (proposed)` where
 * Wright set it), the dry run's summary, and for a crew member's playbook
 * that names jobs, its charter lines (`fit`; `enableAnyway` over an open gap
 * says the owner is enabling it anyway). Stored text throughout: the CLI
 * escapes every line.
 */
export function enableDisplay(store: Store, row: PlaybookRow, dryRun: DryRunRecord, fit?: PlaybookFit, enableAnyway = false): string {
  return [
    `Enable playbook ${JSON.stringify(row.name)} (${row.slug}, #${row.id}) at version ${row.version}${row.mode === "live" ? ", LIVE" : ""}, agent ${row.owning_agent}`,
    scheduleText(linkedTriggerOf(store, row)),
    valueLine("mode", row.mode, row.mode_set_by),
    valueLine("model", row.model, row.model_set_by),
    valueLine("priority", row.priority, row.priority_set_by),
    valueLine("dedupe_key", dedupeText(row.dedupe_key_spec), row.dedupe_key_set_by),
    valueLine("token_limit", row.token_limit_per_day, row.token_limit_set_by),
    valueLine("merge_requirement", row.merge_requirement, row.merge_requirement_set_by),
    ...(row.target_repo === null || row.target_repo === undefined ? [] : [`target_repo: ${row.target_repo}`]),
    valueLine("effort", row.effort, row.effort_set_by),
    valueLine("api_key_fallback", row.api_key_fallback_json, row.api_key_fallback_set_by),
    `dry run: ${dryRun.summary}`,
    ...charterLines(row, fit, enableAnyway),
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
function beforeHold(a: EnableArgs, ctx: ContributedToolContext): HeldToolVerdict {
  try {
    // A crew member's session is refused before anything else: nothing is held.
    const row = ownDraft(ctx.store, a.id, refuseCrewDrafting(ctx));
    if (getWorkStep(ctx.store, ctx.stepKey(a.idempotency_key)) !== undefined) {
      return { refuse: `${ENABLE_TOOL_NAME}: ${usedKeyMessage(row.id)} (nothing was held for the owner)` };
    }
    const dryRun = latestDryRun(ctx.store, row.id, row.version);
    if (dryRun === null) {
      return {
        refuse: `${ENABLE_TOOL_NAME}: a dry run of version ${row.version} is required before playbook ${row.id} can be enabled; call ${DRY_RUN_TOOL_NAME} first (nothing was held for the owner)`,
      };
    }
    const looser = looserThanRepo(ctx.store, row);
    if (looser !== undefined) return { refuse: `${ENABLE_TOOL_NAME}: ${playbookErrorOf(looser).message} (nothing was held for the owner)` };
    const noRepo = targetRepoRefused(ctx.store, row);
    if (noRepo !== undefined) return { refuse: `${ENABLE_TOOL_NAME}: ${playbookErrorOf(noRepo).message} (nothing was held for the owner)` };
    const fit = playbookFit(ctx.store, row, ctx.catalogue);
    const enableAnyway = a.enable_anyway === true;
    const gap = charterGap(row, fit, enableAnyway, true);
    if (gap !== undefined) return { refuse: `${ENABLE_TOOL_NAME}: ${playbookErrorOf(gap).message} (nothing was held for the owner)` };
    return { display: enableDisplay(ctx.store, row, dryRun, fit, enableAnyway), subjectVersion: row.version };
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
  /** The agent that asked for the enable: it must be the playbook's owner, or Wright for a registered crew member's (null never matches). */
  readonly agent: string | null;
  /** The owner's approval: its id, its `approval_requested` event's id and that event's `subject_version`. */
  readonly approval: { readonly id: number; readonly requestedEventId: number; readonly subjectVersion: unknown };
  /** The session `playbook_enabled` is linked to (the requesting session). */
  readonly sessionId: number | null;
  readonly now: Date;
  /** The kernel's tool catalogue, for the charter check (`playbookFit`); absent: a playbook that names jobs is unchecked, a gap (fail closed). */
  readonly catalogue?: ToolCatalogue | undefined;
  /** The held call set `enable_anyway`: the owner approved enabling it with a charter gap open. */
  readonly enableAnyway?: boolean | undefined;
}

/**
 * Enable playbook `p.playbookId` on the owner's approval, the one enable both
 * paths use (the kernel's `applyOnApproval` and the tool's handler). Checks,
 * in order: `draftOf` (`not_found`, `crew_cannot_draft`, `not_owner`,
 * `turned_off_by_owner`, `not_draft`); the approval's `subject_version` is the current version and
 * no `playbook_updated` came after its request (`version_changed`); the
 * current version has a `done` dry run (`no_dry_run`); its `merge_requirement` is not
 * looser than a repo it polls or targets (`playbook_looser_than_repo`); a ticket
 * playbook has a target repo and a set one is reachable (`no_target_repo`,
 * `target_repo_not_reachable`, never skipped by `enableAnyway`); a crew member's
 * charter covers the jobs the playbook names, read now (`charter_gap`, unless
 * `enableAnyway`). Then `enablePlaybook`
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
  const looser = looserThanRepo(store, row);
  if (looser !== undefined) throw looser;
  const noRepo = targetRepoRefused(store, row);
  if (noRepo !== undefined) throw noRepo;
  const gap = charterGap(row, playbookFit(store, row, p.catalogue), p.enableAnyway === true, false);
  if (gap !== undefined) throw gap;
  enablePlaybook(store, { id: row.id, version: row.version, sessionId: p.sessionId, approvalId: approval.id }, p.now);
  return { playbook: row.id, version: row.version, status: "enabled", approval_id: approval.id };
}

/** Refuse unless this call runs on its own consumed approval for the current version; then enable it. In one transaction (the step's). */
function enableOnApproval(ctx: ContributedToolContext, a: EnableArgs, agent: string): EnableToolResult {
  const { store } = ctx;
  const row = ownDraft(store, a.id, agent);
  const approval = ownApproval(store, ctx.sessionId, row.id, a.idempotency_key);
  if (approval === undefined) {
    throw invalid(`no approval of its own: this call has no owner-approved request in this session for playbook ${row.id} with this idempotency_key; nothing was enabled`);
  }
  return asPlaybookError(() =>
    enableApproved(store, { playbookId: row.id, agent, approval, sessionId: ctx.sessionId, now: ctx.now(), catalogue: ctx.catalogue, enableAnyway: a.enable_anyway === true }),
  );
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
function applyOnApproval(a: EnableArgs, ctx: { store: Store; now: () => Date; approval: AppliedApproval; catalogue?: ToolCatalogue }): ApprovalApplyOutcome {
  const { store, approval } = ctx;
  try {
    const done = enableApproved(store, {
      playbookId: a.id,
      agent: approval.agent,
      approval,
      sessionId: approval.sessionId,
      now: ctx.now(),
      catalogue: ctx.catalogue,
      enableAnyway: a.enable_anyway === true,
    });
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
function refuseStaleReplay(ctx: ContributedToolContext, a: EnableArgs): void {
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
  job: "manage_playbooks",
  description:
    "Ask the owner to enable a draft playbook you own, or (Wright) one of a registered crew member's, at its current version. Its current version needs a done kernel_playbook_dry_run first; otherwise this is refused. " +
    "The kernel always holds this call for the owner, showing the playbook, its values and the dry run; end your turn. " +
    "The owner's approval enables it: the kernel applies it itself, at the version the owner saw, and tells you what it did in a new message; do not repeat the call. " +
    "If it was changed since (a new version), the kernel does not enable it and it stays a draft: dry-run it again and ask again. " +
    "A crew member's playbook that names jobs its charter does not cover is refused charter_gap, nothing held: tell the owner the missing job in plain words and close the gap with the kernel_agent_update the refusal names. " +
    "enable_anyway: true only when the owner said to enable it with the gap open; the held approval then shows the open gap and that the owner is enabling it anyway. Never set it on your own. " +
    "Returns {playbook, version, status: enabled, approval_id}. Use a new idempotency_key for each request to the owner: a key an earlier enable in this session used is refused, nothing held.",
  shape: { id: z.number().int().positive(), idempotency_key: z.string().min(1).max(200), enable_anyway: z.boolean().optional() },
  beforeHold,
  applyOnApproval,
  handler: (a, ctx) =>
    named(ENABLE_TOOL_NAME, () => {
      const agent = refuseCrewDrafting(ctx);
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
