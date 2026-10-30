// The Playbooks screen's plain helpers (phase 7 item 04): what each field reads,
// who set it, a playbook's on/off/draft state, which approval holds its enable,
// a run's words, a version's changes, and the line "Edit in English" hands to
// Wright. No React and no DOM here, so each is tested on its own.
//
// Every kernel string (name, intent, slug, item_ref, a snapshot's fields) is
// untrusted data (invariant 3): it passes through `printable` and is rendered
// as a React text child, never as markup. Invariant 1 holds in every formatter:
// an unset policy value reads "not set", never the kernel's default, and a field
// a version's snapshot does not carry reads "unknown", never a guess.
import type { Approval, Playbook, PlaybookListing, PlaybookRun, PlaybookVersion, Trigger } from "../../api/contract";
import { approvalSubject } from "../approvals/subject";
import { printable } from "../approvals/printable";
import type { ResourceError } from "../../store/store";
import { triggerSchedule } from "../chat/model";

/** The ids the unit tests and the e2e spec target. */
export const PLAYBOOKS_TEST_IDS = {
  screen: "screen-playbooks",
  count: "playbooks-count",
  list: "playbooks-list",
  row: "playbook-row",
  open: "playbook-open",
  band: "playbooks-band",
  bandReview: "playbooks-band-review",
  empty: "playbooks-empty",
  askWright: "playbooks-ask-wright",
  loading: "playbooks-loading",
  error: "playbooks-error",
  retry: "playbooks-retry",
  switch: "playbook-switch",
  turnOn: "playbook-turn-on",
  turnOnApproval: "playbook-turn-on-approval",
  turnOnLink: "playbook-turn-on-link",
  turnOnAsk: "playbook-turn-on-ask",
  notice: "playbooks-notice",
  detail: "playbook-detail",
  editEnglish: "playbook-edit-english",
  editFields: "playbook-edit-fields",
  history: "playbook-history",
  historyView: "playbook-history-view",
  runNow: "playbook-run-now",
  runNowStatus: "playbook-run-now-status",
  tokens: "playbook-tokens",
  runs: "playbook-runs",
  run: "playbook-run",
  edit: "playbook-edit",
  field: "playbook-field",
  fieldEdit: "playbook-field-edit",
  fieldRefusal: "playbook-field-refusal",
  fieldStatus: "playbook-field-status",
  versionList: "playbook-versions",
  version: "playbook-version",
  versionDiff: "playbook-version-diff",
} as const;

export const NOT_SET = "not set";
export const UNKNOWN = "unknown";
export const NOT_COUNTED = "not counted yet";
export const NO_RUNS = "no runs yet";

/** Kernel text as inert, single-line text. */
export function safe(text: string): string {
  return printable(text);
}

/** Multi-line kernel text (an intent) as inert text that keeps its line breaks. */
export function safeBlock(text: string): string {
  return printable(text, true);
}

// ---- a playbook's state ---------------------------------------------------------------------

/** `on` (enabled), `draft` (waiting on the owner) or `off` (disabled); an unknown status reads off, never on. */
export type PlaybookState = "on" | "off" | "draft";

export function stateOf(playbook: Pick<Playbook, "status">): PlaybookState {
  if (playbook.status === "enabled") return "on";
  if (playbook.status === "draft") return "draft";
  return "off";
}

export function isOn(playbook: Pick<Playbook, "status">): boolean {
  return stateOf(playbook) === "on";
}

/** The playbooks whose state is `draft`: they wait on the owner. */
export function draftsOf(playbooks: readonly PlaybookListing[]): readonly PlaybookListing[] {
  return playbooks.filter((p) => stateOf(p) === "draft");
}

/** The switch's accessible name: `<name> is on` / `<name> is off`. */
export function switchName(playbook: Pick<Playbook, "name" | "status">): string {
  return `${safe(playbook.name)} is ${isOn(playbook) ? "on" : "off"}`;
}

/** `3 playbooks · 2 on`, with " · last known" while the kernel cannot be asked. */
export function countText(playbooks: readonly Pick<Playbook, "status">[], lastKnown: boolean): string {
  const on = playbooks.filter(isOn).length;
  const base = `${playbooks.length} ${playbooks.length === 1 ? "playbook" : "playbooks"} · ${on} on`;
  return lastKnown ? `${base} · last known` : base;
}

// ---- policy values and who set them -----------------------------------------------------------

/** `set by you` / `proposed by Wright`; nothing when the kernel names no setter (an unset value). */
export function setByWord(setBy: string | null): string {
  if (setBy === "owner") return "set by you";
  if (setBy === "wright") return "proposed by Wright";
  return "";
}

/** A policy value as shown: its text, or "not set" for none. Never the kernel's default for it. */
export function valueOrNotSet(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return NOT_SET;
  const text = String(value);
  return text === "" ? NOT_SET : safe(text);
}

/**
 * A value whose column has a default (priority, mode): with no `*_set_by` nobody set it, so
 * the stored default reads "not set", never as a filled-in value (invariant 1, D4).
 */
export function setValueOrNotSet(value: string | null | undefined, setBy: string | null): string {
  return setBy === null || setBy === undefined ? NOT_SET : valueOrNotSet(value);
}

/**
 * The kernel stores a dedupe key as a JSON list of field names; shown as the
 * list, comma-separated, in full. The spec is untrusted and read by type only:
 * anything but a list of strings is shown as the kernel sent it.
 */
export function dedupeText(spec: string | null): string {
  if (spec === null) return NOT_SET;
  try {
    const parsed: unknown = JSON.parse(spec);
    if (Array.isArray(parsed) && parsed.every((f) => typeof f === "string")) return parsed.length === 0 ? NOT_SET : safe(parsed.join(", "));
  } catch {
    // Not JSON: shown as it is.
  }
  return valueOrNotSet(spec);
}

const NUMBER = new Intl.NumberFormat("en-US");

/** A counted-token figure with thousands separators (tokens, never dollars: D26). */
export function tokenFigure(tokens: number): string {
  return NUMBER.format(tokens);
}

/** The token limit per day, or "not set". */
export function limitText(limit: number | null): string {
  return limit === null ? NOT_SET : tokenFigure(limit);
}

// ---- trigger ----------------------------------------------------------------------------------

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * A playbook's trigger in words, in full (a poll's repos and filters are not
 * truncated). `spec` is untrusted: it is read by type only, and a shape this
 * reader does not know reads as the trigger's kind alone.
 */
export function triggerText(trigger: Trigger | undefined, playbook: Pick<PlaybookListing, "trigger_id">): string {
  if (trigger === undefined) return playbook.trigger_id === null ? "none" : `trigger ${playbook.trigger_id}`;
  if (trigger.kind === "poll" && typeof trigger.spec === "object" && trigger.spec !== null) {
    const spec = trigger.spec as { readonly repos?: unknown; readonly filters?: unknown; readonly interval_seconds?: unknown };
    const repos = Array.isArray(spec.repos) ? spec.repos.map(textOf).filter((r): r is string => r !== undefined) : [];
    const every = typeof spec.interval_seconds === "number" && Number.isFinite(spec.interval_seconds) ? ` every ${spec.interval_seconds}s` : "";
    const filters =
      typeof spec.filters === "object" && spec.filters !== null && !Array.isArray(spec.filters)
        ? Object.entries(spec.filters as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" || typeof v === "boolean" || typeof v === "number")
            .map(([k, v]) => `${k}=${String(v)}`)
        : [];
    const parts = [`poll${every}`, repos.join(", "), filters.join(", ")].filter((p) => p !== "");
    return safe(parts.join(" · "));
  }
  return safe(triggerSchedule(trigger));
}

// ---- the held enable approval -------------------------------------------------------------------

/**
 * The pending `kernel_playbook_enable` approval that names `playbook`, if any.
 * The playbook an enable approval is about is in its payload (`approvalSubject`
 * reads it by type); `approval.playbook` is the playbook whose session ASKED, which
 * is null for Wright's own chat and is never read as the subject while the payload
 * names one. Only a payload with no readable subject falls back to `approval.playbook`.
 */
export function pendingEnableApproval(approvals: readonly Approval[] | undefined, playbook: Pick<Playbook, "id">): Approval | undefined {
  for (const approval of approvals ?? []) {
    if (approval.status !== "pending") continue;
    const subject = approvalSubject(approval);
    if (subject !== undefined) {
      if (subject.kind === "playbook" && subject.id === playbook.id) return approval;
      continue;
    }
    if (approval.action === "kernel_playbook_enable" && approval.playbook?.id === playbook.id) return approval;
  }
  return undefined;
}

/** Where the held approval is decided. */
export const APPROVALS_HASH = "#/approvals";

// ---- runs ----------------------------------------------------------------------------------------

const RUN_KINDS: Readonly<Record<string, string>> = { dry_run: "dry run", fire: "fire", run_now: "run now" };
const RUN_STATUSES: Readonly<Record<string, string>> = {
  running: "running",
  done: "done",
  failed: "failed",
  parked: "parked",
  skipped_duplicate: "skipped: already done",
  skipped_not_enabled: "skipped: not on",
};

/** A run kind in words; an unknown kind is shown as the kernel sent it. */
export function runKindWord(kind: string): string {
  return RUN_KINDS[kind] ?? safe(kind);
}

/** A run's status in words; an unknown status is shown as the kernel sent it. */
export function runStatusWord(status: string): string {
  return RUN_STATUSES[status] ?? safe(status);
}

export type RunTone = "working" | "ok" | "danger" | "parked" | "idle";

export function runTone(status: string): RunTone {
  if (status === "running") return "working";
  if (status === "done") return "ok";
  if (status === "failed") return "danger";
  if (status === "parked") return "parked";
  return "idle";
}

/** A run's counted tokens, or "not counted yet" while it has none. */
export function runTokensText(run: Pick<PlaybookRun, "tokens">): string {
  return run.tokens === null ? NOT_COUNTED : `${tokenFigure(run.tokens)} tokens`;
}

/** The tokens the loaded runs counted, and how many of them have none yet. Never a figure for a run that has none. */
export function tokensOfRuns(runs: readonly Pick<PlaybookRun, "tokens">[]): { readonly counted: number; readonly runs: number; readonly pending: number } {
  let counted = 0;
  let pending = 0;
  for (const run of runs) {
    if (run.tokens === null) pending += 1;
    else counted += run.tokens;
  }
  return { counted, runs: runs.length, pending };
}

/** A run's item (a PR and its revision), when it has one; the revision shortened to 7 characters. */
export function runItemText(run: Pick<PlaybookRun, "item_ref" | "item_revision">): string {
  if (run.item_ref === null) return "";
  return safe(run.item_revision === null ? run.item_ref : `${run.item_ref} @ ${run.item_revision.slice(0, 7)}`);
}

// ---- versions ---------------------------------------------------------------------------------------

/** The fields a version's changes are read from, in the order the edit view shows them. */
export const VERSION_FIELDS = ["name", "intent", "dedupe_key_spec", "priority", "model", "effort", "token_limit_per_day", "mode"] as const;
export type VersionField = (typeof VERSION_FIELDS)[number];

/** The `*_set_by` column of a version field that has one (name and intent have none). */
const SET_BY_OF: Readonly<Partial<Record<VersionField, keyof Playbook>>> = {
  dedupe_key_spec: "dedupe_key_set_by",
  priority: "priority_set_by",
  model: "model_set_by",
  effort: "effort_set_by",
  token_limit_per_day: "token_limit_set_by",
  mode: "mode_set_by",
};

/** A snapshot field: `unknown` when the snapshot lacks it (an older snapshot), "not set" when it is null, else its text. Never a default. */
export function snapshotValue(snapshot: PlaybookVersion["snapshot"], field: VersionField): { readonly known: boolean; readonly text: string } {
  if (typeof snapshot !== "object" || snapshot === null || !Object.hasOwn(snapshot, field)) return { known: false, text: UNKNOWN };
  const value = (snapshot as Record<string, unknown>)[field];
  if (value === undefined) return { known: false, text: UNKNOWN };
  if (value === null) return { known: true, text: NOT_SET };
  if (field === "dedupe_key_spec") return { known: true, text: typeof value === "string" ? dedupeText(value) : safe(String(value)) };
  if (field === "token_limit_per_day" && typeof value === "number") return { known: true, text: tokenFigure(value) };
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { known: true, text: valueOrNotSet(value) };
  return { known: false, text: UNKNOWN };
}

export interface VersionChange {
  readonly field: VersionField;
  readonly from: string;
  readonly to: string;
}

export interface VersionChanges {
  /** `previous` is undefined: the version's own first values. */
  readonly created: boolean;
  /** Created: every known field as `to`. Otherwise: the fields known in both snapshots that differ. */
  readonly changes: readonly VersionChange[];
  /** Fields a snapshot does not carry, so no change is claimed for them. */
  readonly unrecorded: readonly VersionField[];
}

/** What `version` changed against `previous` (the next older one), by field. A field either snapshot lacks is listed as unrecorded, not as a change. */
export function versionChanges(version: PlaybookVersion, previous: PlaybookVersion | undefined): VersionChanges {
  const changes: VersionChange[] = [];
  const unrecorded: VersionField[] = [];
  for (const field of VERSION_FIELDS) {
    const to = snapshotValue(version.snapshot, field);
    if (previous === undefined) {
      if (to.known) changes.push({ field, from: "", to: to.text });
      else unrecorded.push(field);
      continue;
    }
    const from = snapshotValue(previous.snapshot, field);
    if (!to.known || !from.known) unrecorded.push(field);
    else if (to.text !== from.text) changes.push({ field, from: from.text, to: to.text });
  }
  return { created: previous === undefined, changes, unrecorded };
}

/** Who made a version's changes, from the `*_set_by` of the policy fields it changed: "you", "Wright", "you and Wright", or "" when it cannot say. */
export function versionActors(version: PlaybookVersion, changes: readonly VersionChange[]): string {
  const who = new Set<string>();
  for (const change of changes) {
    const column = SET_BY_OF[change.field];
    if (column === undefined) continue;
    const setBy = (version.snapshot as Record<string, unknown>)[column];
    if (setBy === "owner") who.add("you");
    else if (setBy === "wright") who.add("Wright");
  }
  return [...who].join(" and ");
}

/** The field's label in a version's changes. */
export function versionFieldLabel(field: VersionField): string {
  return field;
}

// ---- Edit in English ------------------------------------------------------------------------------------

/** The line "Edit in English" puts in Wright's composer: it names the playbook by id and slug, and the owner finishes and sends it. */
export function handoffLine(playbook: Pick<Playbook, "id" | "slug">): string {
  return `About playbook ${playbook.id} (${safe(playbook.slug)}): `;
}

// ---- the feed ------------------------------------------------------------------------------------------------

/** The event kinds that change what this screen shows: a playbook's audit events, and the sessions and queue events a run is made of. */
export function isRelevantKind(kind: string): boolean {
  return kind.startsWith("playbook_") || kind.startsWith("session_") || kind.startsWith("event_");
}

/** The id of the newest event whose kind is one this screen shows, 0 when none. */
export function newestRelevantEventId(eventLog: readonly { readonly id: number; readonly kind: string }[]): number {
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const event = eventLog[i];
    if (event !== undefined && isRelevantKind(event.kind)) return event.id;
  }
  return 0;
}

// ---- a failed read ----------------------------------------------------------------------------------------

/** Why the playbook list did not load: the sentence for the error card, and the route line under it. */
export function readError(error: ResourceError): { readonly text: string; readonly detail: string } {
  if (error.kind === "not_connected") return { text: "The kernel is not reachable, so the playbooks can't load. Nothing on this screen was changed.", detail: "GET /playbooks · no answer from the kernel" };
  if (error.kind === "bridge_failed") return { text: "The app could not ask the kernel for the playbooks. Nothing on this screen was changed.", detail: "GET /playbooks · the request did not leave this window" };
  const message = typeof error.body.message === "string" ? ` · ${safe(error.body.message)}` : "";
  return { text: "The kernel answered, but the playbooks request failed. Nothing on this screen was changed.", detail: `GET /playbooks · ${error.status} · ${safe(error.body.error)}${message}` };
}
