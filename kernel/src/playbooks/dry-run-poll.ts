// The playbooks feature's poll preview (phase 6 item 09): what
// `kernel_playbook_dry_run` (`./dry-run.ts`) does for a playbook whose linked
// trigger is a `poll`. It polls the source once WITHOUT recording anything,
// says per open item whether the owner's dedupe key would run or skip it, and
// picks the one item the dry-run session reviews. Mechanism only (invariant
// 1): the key, the filters and the repos are the user's, evaluated as stored.
//
// Read only. It calls the same fetch a due poll uses (`fetchPollItems`) and
// the same key evaluator and "already done" check a real run uses
// (`evaluateDedupeKey`, `doneWithKey`), and writes nothing: no queue row, no
// `poll_item_*` or `trigger_*` event, no `triggers` update and no work step
// keyed `trigger:<id>:<instant>`. The caller (`./dry-run.ts`) owns the run
// row, the session and the audit event.
//
// Checked before any fetch, in order: a usable `github` connector and a wired
// client (`connector_missing`), then the owning agent's `github` grant
// (`needs_github`). A fetch that fails is `rate_limited` or `source_error`.
// Each is a `preview_incomplete`: no session starts, the parsed spec is still
// returned, and the dry run still counts (the enable stays possible: a real
// run parks at run time instead, item 05).
//
// The session reviews the first `would run` item, or the first item when every
// item would skip; the item reaches the prompt only wrapped as untrusted data
// (`itemPromptBlock`, invariant 3). Zero items, or a dedupe spec that cannot be
// evaluated, starts no session.
//
// The `studio` CLI loads this module through `./dry-run.ts`: besides
// `node:` builtins it imports only `../agents/settings.js`, `../brain/context.js`
// (the untrusted-data wrapper), `../loop/internal.js`,
// the triggers feature's public index, type-only integrations and feature
// modules and this feature's files; never the Agent SDK, the session manager
// or `kernel.ts`. `./dry-run.ts` imports it, never the other way round.
import { agentSettingsPath } from "../agents/settings.js";
import type { GitHubClient, PollSpec } from "../integrations/types.js";
import { wrapUntrusted } from "../brain/context.js";
import type { DraftPayloadKind } from "../sessions/draft-mode.js";
import type { WouldDoEntry } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { fetchPollItems, githubConnectorState, parsePollSpec } from "../triggers/index.js";
import type { TriggerView } from "../triggers/index.js";
import { needsGithub } from "./items.js";
import type { RunItem } from "./items.js";
import { doneWithKey, evaluateDedupeKey } from "./runs.js";
import { PlaybookError } from "./store.js";
import type { PlaybookRow } from "./store.js";

/** Why a poll preview is incomplete (closed here, defined once): no session started, the enable is still possible. */
export const PREVIEW_INCOMPLETE_REASONS = Object.freeze(["connector_missing", "needs_github", "rate_limited", "source_error"] as const);
export type PreviewIncompleteReason = (typeof PREVIEW_INCOMPLETE_REASONS)[number];

/** What one polled item would do under the owner's dedupe key (closed here). */
export const POLL_WOULD = Object.freeze(["run", "skip"] as const);
export type PollWould = (typeof POLL_WOULD)[number];

/** The refusals `evaluateDedupeKey` answers with (`DedupeKeyResult`), as a preview reports them. */
type DedupeError = "dedupe_spec_invalid" | "dedupe_zone_invalid";

/** Longest title a result keeps: it is the PR author's text (untrusted data), shown for a reader's orientation only. */
const MAX_TITLE_CHARS = 200;

/** The summary names at most this many items (then how many more), each key cut to `SUMMARY_KEY_CHARS`. */
const SUMMARY_ITEMS = 10;
const SUMMARY_KEY_CHARS = 160;
const SUMMARY_TARGET_CHARS = 80;

export interface PreviewIncomplete {
  readonly reason: PreviewIncompleteReason;
  /** One sentence naming what to do about it. */
  readonly fix: string;
}

/** One open item the poll found, and what the owner's dedupe key says about it. */
export interface PollPreviewItem {
  readonly ref: string;
  readonly revision: string;
  /** The PR's title: its author's text, untrusted data, control characters made spaces, cut to `MAX_TITLE_CHARS`. */
  readonly title: string;
  readonly would: PollWould;
  /** The evaluated key (`{"item.id":"github:o/r#7","item.revision":"abc123"}`), or `null` with no dedupe spec or an unreadable one. */
  readonly dedupe_key: string | null;
  /** Set (with `would: "skip"` and a null key) when the spec cannot be evaluated: a real run of the item records `failed` with this error. */
  readonly dedupe_error?: DedupeError;
}

/** A draft the dry-run session recorded (`draft_outputs`), tagged so a reader never takes it for a real one. */
export interface PollDraft {
  readonly id: number;
  /** A closed label for the draft's kind (`DRAFT_TOOL_LABELS`, else `other`), never the rail's own label: that can carry the model's text (`gh api -X <text>`). */
  readonly tool: string;
  /** The PR the call named, or `null` when the draft is not a `gh pr` call. Model output: untrusted data. */
  readonly target: string | null;
  /** The text it would post, or `null`. Model output: untrusted data. */
  readonly body: string | null;
  /** A review's event flag (`--approve`, `--comment`, `--request-changes`), when it had one. */
  readonly event?: string;
  readonly tag: "dry_run";
}

/** The `poll` object of a poll playbook's dry run (additive on the result and on `result_json`). */
export interface PollDryRun {
  /** The trigger's parsed spec: `{source, repos, filters, interval_seconds}`. */
  readonly spec: PollSpec;
  readonly items: readonly PollPreviewItem[];
  /** The ref of the item the session reviewed, or `null` when none was. */
  readonly reviewed: string | null;
  readonly drafts: readonly PollDraft[];
  readonly preview_incomplete?: PreviewIncomplete;
}

/** What the preview decided before any session: the poll object and the item to review (`null`: no session starts). */
export interface PollPlan {
  readonly poll: PollDryRun;
  readonly review: RunItem | null;
}

/** What the preview reads: the store, the client the kernel wires (absent: none), the clock and the agent the dry-run session runs as (whose grant counts). */
export interface PollPreviewDeps {
  readonly store: Store;
  readonly github: GitHubClient | undefined;
  readonly now: Date;
  readonly agent: string;
}

function incomplete(spec: PollSpec, reason: PreviewIncompleteReason, fix: string): PollPlan {
  return { poll: { spec, items: [], reviewed: null, drafts: [], preview_incomplete: { reason, fix } }, review: null };
}

/** The kernel host's zone, as `./drafts.ts` reads it: what the key's `date` field is evaluated in. */
function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The poll preview of playbook `row`, whose linked trigger is the `poll`
 * `trigger`. `scheduledAt` for the key is the trigger's `next_fire_at` when
 * set, else the dry run's now (a key naming `trigger.scheduled_at` or `date`
 * depends on it; the check at fire time is what really skips). Throws
 * `PlaybookError` `invalid_input` for a stored spec that cannot be read; never
 * for a source that fails (that is `preview_incomplete`).
 */
export async function previewPoll(
  deps: PollPreviewDeps,
  row: Pick<PlaybookRow, "id" | "version" | "dedupe_key_spec">,
  trigger: Pick<TriggerView, "id" | "spec" | "next_fire_at">,
): Promise<PollPlan> {
  const { store, github, now, agent } = deps;
  let spec: PollSpec;
  try {
    spec = parsePollSpec(JSON.stringify(trigger.spec));
  } catch (err) {
    throw new PlaybookError("invalid_input", `the poll trigger ${trigger.id}'s stored spec cannot be read: ${err instanceof Error ? err.message : String(err)}`);
  }

  const connector = githubConnectorState(store);
  if (!connector.usable || github === undefined) {
    const status = connector.status ?? "absent";
    return incomplete(
      spec,
      "connector_missing",
      github === undefined && connector.usable
        ? `Connect GitHub in Integrations (the github connector is ${status}), and run a kernel that wires a GitHub client: this one has none, so it cannot list pull requests.`
        : `Connect GitHub in Integrations (the github connector is ${status}).`,
    );
  }
  const park = needsGithub(store, agent);
  if (park?.missing === "grant") {
    const refused = park.settings_error !== undefined ? ` The settings file was refused (${park.settings_error}): fix it first.` : "";
    return incomplete(spec, "needs_github", `Add "github" to "connectors" in ${agentSettingsPath(store.dataDir, agent)}.${refused}`);
  }
  if (park !== undefined) {
    // The connector read above found it usable, so this is a connector that changed meanwhile: the same fix.
    return incomplete(spec, "connector_missing", `Connect GitHub in Integrations (the github connector is ${park.connector_status ?? "absent"}).`);
  }

  const fetched = await fetchPollItems(github, spec);
  if (!fetched.ok) {
    if (fetched.error === "rate_limited") {
      return incomplete(spec, "rate_limited", `GitHub rate-limited the poll of ${fetched.repo}; try the dry run again after ${fetched.resets_at}.`);
    }
    // The client's error message is outside text (a response body can carry a PR author's): kept out of the fix the model reads.
    const detail = fetched.status !== undefined ? ` (HTTP ${fetched.status})` : "";
    return incomplete(spec, "source_error", `GitHub could not be read for ${fetched.repo}: ${fetched.error}${detail}. Check the connector and the repository, then dry-run again.`);
  }
  if (fetched.items.length === 0) return { poll: { spec, items: [], reviewed: null, drafts: [] }, review: null };

  const scheduledAt = trigger.next_fire_at ?? now.toISOString();
  const timeZone = hostTimeZone();
  const items: PollPreviewItem[] = fetched.items.map((item) => {
    const shown = { ref: item.ref, revision: item.revision, title: inline(item.title, MAX_TITLE_CHARS) };
    if (row.dedupe_key_spec === null) return { ...shown, would: "run", dedupe_key: null };
    const key = evaluateDedupeKey(row.dedupe_key_spec, { playbook: row.id, version: row.version, triggerId: trigger.id, scheduledAt, item: { ref: item.ref, revision: item.revision } }, timeZone);
    if (!key.ok) return { ...shown, would: "skip", dedupe_key: null, dedupe_error: key.error };
    return { ...shown, would: doneWithKey(store, row.id, key.key, null) ? "skip" : "run", dedupe_key: key.key };
  });

  // An unreadable spec fails every item alike (a real run records `failed`): nothing is worth reviewing.
  if (items.some((i) => i.dedupe_error !== undefined)) return { poll: { spec, items, reviewed: null, drafts: [] }, review: null };
  const index = Math.max(0, items.findIndex((i) => i.would === "run"));
  const picked = fetched.items[index] as RunItem;
  return { poll: { spec, items, reviewed: picked.ref, drafts: [] }, review: picked };
}

/** What a draft's `tool` shows per stored payload kind: a closed set, so no text of the model's reaches the field. */
const DRAFT_TOOL_LABELS: Readonly<Record<DraftPayloadKind, string>> = Object.freeze({
  gh_pr_review: "gh pr review",
  gh_pr_comment: "gh pr comment",
  command: "command",
  input: "input",
});

/** `tool` as a draft shows it: one of the closed labels, else `other` (a result stored before the labels were closed may hold the rail's own text). */
function closedDraftTool(tool: string): string {
  return (Object.values(DRAFT_TOOL_LABELS) as readonly string[]).includes(tool) ? tool : "other";
}

/** The drafts session `sessionId` recorded, oldest first, each tagged `dry_run`. */
export function readDryRunDrafts(store: Store, sessionId: number): PollDraft[] {
  const rows = store
    .prepare<[number], { id: number; payload_json: string }>("SELECT id, payload_json FROM draft_outputs WHERE session = ? ORDER BY id")
    .all(sessionId);
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(r.payload_json) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      // Unreadable: shown with no target or body.
    }
    const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
    const event = text(payload["event"]);
    const kind = text(payload["kind"]);
    const tool = kind !== null && Object.hasOwn(DRAFT_TOOL_LABELS, kind) ? DRAFT_TOOL_LABELS[kind as DraftPayloadKind] : "other";
    return { id: r.id, tool, target: text(payload["target"]), body: text(payload["body"]), ...(event === null ? {} : { event }), tag: "dry_run" as const };
  });
}

// ---- Reading a stored result ---------------------------------------------------------

function isIncomplete(value: unknown): value is PreviewIncomplete {
  const v = value as Partial<PreviewIncomplete> | null;
  return typeof v === "object" && v !== null && (PREVIEW_INCOMPLETE_REASONS as readonly unknown[]).includes(v.reason) && typeof v.fix === "string";
}

function isItem(value: unknown): value is PollPreviewItem {
  const v = value as Partial<PollPreviewItem> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.ref === "string" &&
    typeof v.revision === "string" &&
    typeof v.title === "string" &&
    (POLL_WOULD as readonly unknown[]).includes(v.would) &&
    (v.dedupe_key === null || typeof v.dedupe_key === "string")
  );
}

function isDraft(value: unknown): value is PollDraft {
  const v = value as Partial<PollDraft> | null;
  return typeof v === "object" && v !== null && typeof v.id === "number" && typeof v.tool === "string" && v.tag === "dry_run";
}

/** The `poll` object a stored `result_json` holds, or `undefined` for a non-poll run (or one that cannot be read). */
export function pollOf(value: unknown): PollDryRun | undefined {
  const v = value as { spec?: unknown; items?: unknown; reviewed?: unknown; drafts?: unknown; preview_incomplete?: unknown } | null;
  if (typeof v !== "object" || v === null || typeof v.spec !== "object" || v.spec === null || !Array.isArray(v.items)) return undefined;
  return {
    spec: v.spec as PollSpec,
    items: v.items.filter(isItem),
    reviewed: typeof v.reviewed === "string" ? v.reviewed : null,
    drafts: Array.isArray(v.drafts) ? v.drafts.filter(isDraft).map((d) => ({ ...d, tool: closedDraftTool(d.tool) })) : [],
    ...(isIncomplete(v.preview_incomplete) ? { preview_incomplete: v.preview_incomplete } : {}),
  };
}

// ---- The tool result's untrusted text ---------------------------------------------------

/**
 * `poll` as the tool result shows it to the model: the same shape, with every
 * field that carries a PR author's or the model's text (an item's `title`, a
 * draft's `target` and `body`) wrapped as untrusted data, as every kernel
 * GitHub tool wraps its text (invariant 3). A title is wrapped from its own
 * item's ref; a draft's text from the reviewed item's. The stored
 * `result_json` keeps the raw text: readers other than the model render it
 * themselves.
 */
export function wrapPollForModel(poll: PollDryRun): PollDryRun {
  const draftSource = poll.reviewed ?? "dry_run";
  return {
    ...poll,
    items: poll.items.map((i) => ({ ...i, title: wrapUntrusted(i.ref, i.title) })),
    drafts: poll.drafts.map((d) => ({
      ...d,
      target: d.target === null ? null : wrapUntrusted(draftSource, d.target),
      body: d.body === null ? null : wrapUntrusted(draftSource, d.body),
    })),
  };
}

/**
 * A poll dry run's would-do entries as the tool result shows them to the
 * model: each `input_summary` (cut text of a call the review session made
 * after reading a PR) wrapped as untrusted data from the reviewed item's ref,
 * and a `gh api` action's method (the model's `-X` text) closed.
 */
export function wrapWouldDoForModel(entries: readonly WouldDoEntry[], poll: PollDryRun): WouldDoEntry[] {
  const source = poll.reviewed ?? "dry_run";
  return entries.map((e) => ({ ...e, input_summary: wrapUntrusted(source, e.input_summary), ...(e.action === undefined ? {} : { action: closedAction(e.action) }) }));
}

/** The methods `gh api` is shown with: any other text of the model's (`-X <text>`) is not echoed. */
const API_METHODS: readonly string[] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** The rail's approval action with the one part the model can write (`gh api <METHOD>`, from `-X`) closed. */
export function closedAction(action: string): string {
  return action.startsWith("gh api ") && action !== "gh api (flag unread)" && !API_METHODS.includes(action.slice("gh api ".length)) ? "gh api (other method)" : action;
}

// ---- The summary -----------------------------------------------------------------------

/** One line of text: control characters (which a model's or a PR's text could carry) become spaces, then cut. */
function inline(text: string, max: number): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The poll's part of a dry run's summary (appended to the phase 3 text only
 * for a poll playbook): the preview's incompleteness and why, the items and
 * their verdicts (at most ten, then how many more), the reviewed item and the
 * drafts it recorded (tool and target, never a body). Item refs are
 * validated; keys and targets are cut and flattened to one line.
 */
export function formatPollSummary(poll: PollDryRun): string {
  if (poll.preview_incomplete !== undefined) {
    return `Poll preview incomplete (${poll.preview_incomplete.reason}): ${inline(poll.preview_incomplete.fix, 400)} No session started; the enable stays possible, and a real run parks until this is fixed.`;
  }
  if (poll.items.length === 0) return "The poll found no open pull requests, so no review session started.";
  const run = poll.items.filter((i) => i.would === "run").length;
  const shown = poll.items.slice(0, SUMMARY_ITEMS).map((i) => {
    if (i.dedupe_error !== undefined) return `${i.ref} would skip (${i.dedupe_error})`;
    return i.would === "run" ? `${i.ref} would run` : `${i.ref} would skip (key ${inline(i.dedupe_key ?? "none", SUMMARY_KEY_CHARS)})`;
  });
  const more = poll.items.length - shown.length;
  const found = `The poll found ${poll.items.length} open pull request${poll.items.length === 1 ? "" : "s"}: ${run} would run, ${poll.items.length - run} would skip: ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`;
  if (poll.reviewed === null) return `${found} No review session started: the dedupe key could not be evaluated.`;
  const drafted =
    poll.drafts.length === 0
      ? "it drafted nothing"
      : `it drafted ${poll.drafts.length} output${poll.drafts.length === 1 ? "" : "s"} (not sent): ${poll.drafts.map((d) => inline(d.tool, SUMMARY_TARGET_CHARS)).join("; ")}`;
  return `${found} It reviewed ${poll.reviewed} in a draft-only session; ${drafted}.`;
}
