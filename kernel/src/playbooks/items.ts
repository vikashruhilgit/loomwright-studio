// The playbooks feature's per-item runs (phase 6 item 05): what `./runs.ts`
// does with a playbook message that carries a polled `item`. Each such
// message is its own run: the run row records `item_ref` / `item_revision`,
// the owner's dedupe key may name `item.id` / `item.revision` (the kernel
// never adds them: invariant 1), a skip appends one `poll_item_skipped`
// event, the item reaches the prompt only wrapped as untrusted data
// (invariant 3), and a GitHub item whose agent lacks the grant or a usable
// connector parks the run `needs_github` with one notification per outage.
//
// The payload contract (item 04 queues it): `item` is `{ref, revision,
// title?, url?, updated_at?}` (`SourceItem` with the display fields
// optional). `ref` matches `GITHUB_ITEM_REF` (at most 512 characters): it
// becomes the wrapper's source, which the frame prints raw outside the
// wrapper, so a ref that could carry words is refused, never wrapped.
//
// Called only from `./runs.ts`, inside its work steps, so a redelivery
// replays the stored decision and writes no second row, event or
// notification. The `studio` CLI loads `./runs.ts`, so this module imports at
// runtime only `../agents/settings.js`, `../brain/context.js`,
// `../brain/memory.js` (`cutChars`), `../loop/internal.js` and
// `../notifications/record.js`; never the Agent SDK, the session manager or
// `kernel.ts`.
import { agentSettingsPath, readAgentSettings } from "../agents/settings.js";
import { wrapUntrusted } from "../brain/context.js";
import { cutChars } from "../brain/memory.js";
import type { SourceItem } from "../integrations/types.js";
import { NO_REF, appendEvent } from "../loop/internal.js";
import { MAX_NOTIFICATION_TITLE, recordNotification } from "../notifications/record.js";
import type { Store } from "../store/store.js";

// ---- The payload's item ----------------------------------------------------------

/** The item an item-carrying playbook message is about: `SourceItem` with the display fields optional. */
export type RunItem = Pick<SourceItem, "ref" | "revision"> & Partial<Pick<SourceItem, "title" | "url" | "updated_at">>;

/** A GitHub item's ref, `github:<owner>/<repo>#<n>`: the only shape a ref may have (the only source kind is `github.pulls`). */
export const GITHUB_ITEM_REF = /^github:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#[1-9][0-9]{0,9}$/;

export const MAX_ITEM_REF_CHARS = 512;
export const MAX_ITEM_REVISION_CHARS = 200;
export const MAX_ITEM_URL_CHARS = 2_000;
export const MAX_ITEM_UPDATED_AT_CHARS = 64;
/** The title has no bound in the payload; the prompt shows at most this many characters of it. */
export const MAX_ITEM_TITLE_PROMPT_CHARS = 1_000;

/** C0 and C1 control characters (DEL included). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Step a's `item`: `undefined` (absent) is `null`, a per-instant message as
 * before; anything else must be the contract's object, or this throws a
 * `TypeError` naming what is wrong (the loop fails the event, one notify).
 */
export function runItemOf(eventId: number, value: unknown): RunItem | null {
  if (value === undefined) return null;
  const bad = (what: string): TypeError => new TypeError(`event ${eventId}: a playbook message needs ${what}`);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw bad("item, absent or an object");
  const { ref, revision, title, url, updated_at: updatedAt } = value as Record<string, unknown>;
  if (typeof ref !== "string" || ref.length > MAX_ITEM_REF_CHARS || !GITHUB_ITEM_REF.test(ref)) {
    throw bad(`item.ref, github:<owner>/<repo>#<n> of at most ${MAX_ITEM_REF_CHARS} characters`);
  }
  if (typeof revision !== "string" || revision === "" || revision.length > MAX_ITEM_REVISION_CHARS || CONTROL.test(revision)) {
    throw bad(`item.revision, a non-empty string of at most ${MAX_ITEM_REVISION_CHARS} characters with no control characters`);
  }
  if (title !== undefined && typeof title !== "string") throw bad("item.title, absent or a string");
  if (url !== undefined && (typeof url !== "string" || url.length > MAX_ITEM_URL_CHARS || CONTROL.test(url))) {
    throw bad(`item.url, absent or a string of at most ${MAX_ITEM_URL_CHARS} characters with no control characters`);
  }
  if (updatedAt !== undefined && (typeof updatedAt !== "string" || updatedAt.length > MAX_ITEM_UPDATED_AT_CHARS)) {
    throw bad(`item.updated_at, absent or a string of at most ${MAX_ITEM_UPDATED_AT_CHARS} characters`);
  }
  return {
    ref,
    revision,
    ...(title !== undefined ? { title } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

/** Whether `item` is a GitHub item (`github:<owner>/<repo>#<n>`): only those need the grant and the connector. */
export function isGithubItem(item: RunItem): boolean {
  return item.ref.startsWith("github:");
}

// ---- The GitHub grant and connector ------------------------------------------------

/** The notification source of a playbook parked for want of GitHub. */
export const NEEDS_GITHUB_SOURCE = "kernel:needs_github";

/** Why a GitHub item's run parks: the park row's `result_json`. */
export interface NeedsGithub {
  readonly reason: "needs_github";
  /** `grant`: the agent's settings do not grant `github`; `connector`: no usable `github` connector. */
  readonly missing: "grant" | "connector";
  /** The newest `github` connector row's status, or `null` when there is none. */
  readonly connector_status: string | null;
  /** Set when the agent's settings were refused (the refusal's code) or the read threw (settings_unreadable, then the error's first line). */
  readonly settings_error?: string;
}

/** A connector that counts: `connected`, or `expiring` (verified, and its token expires soon). */
function connectorUsable(status: string | null): boolean {
  return status === "connected" || status === "expiring";
}

/**
 * Whether a GitHub item's run of `agent` must park, and why: `undefined`
 * when the agent's settings grant `github` and the newest `github`
 * connector row is usable. The grant is read with the rule `connectorsFor`
 * (`../kernel.ts`) applies, so any refusal grants none (fail closed); a read
 * that throws (Wright's file is created when absent) grants none too, and
 * never throws out of the step. The connector is read with direct SQL.
 */
export function needsGithub(store: Store, agent: string): NeedsGithub | undefined {
  let granted = false;
  let settingsError: string | undefined;
  try {
    const r = readAgentSettings(store.dataDir, agent);
    granted = r.ok ? (r.settings.connectors ?? []).includes("github") : false;
    if (!r.ok) settingsError = r.error;
  } catch (err) {
    // One printable line: it is shown in the park row and the notification (which refuses a NUL).
    const line = ((err instanceof Error ? err.message : String(err)).split("\n", 1)[0] ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
    settingsError = `settings_unreadable: ${cutChars(line, 500)}`;
  }
  const status = store.prepare<[], string>("SELECT status FROM connectors WHERE kind = 'github' ORDER BY id DESC LIMIT 1").pluck().get() ?? null;
  const park = (missing: NeedsGithub["missing"]): NeedsGithub => ({
    reason: "needs_github",
    missing,
    connector_status: status,
    ...(settingsError !== undefined ? { settings_error: settingsError } : {}),
  });
  if (!granted) return park("grant");
  if (!connectorUsable(status)) return park("connector");
  return undefined;
}

/** What `notifyNeedsGithub` names: the playbook, its agent, the item and why it parked. */
export interface NeedsGithubNotice {
  readonly playbook: number;
  readonly slug: string;
  readonly agent: string;
  readonly item: RunItem;
  readonly park: NeedsGithub;
}

/**
 * Tell the owner a playbook's GitHub item parked: one notification per
 * outage. A missing grant with an unusable connector names both fixes. It
 * records one only when no `parked` row of the playbook exists after its newest item run that started a session (a skip or failed row
 * never ends an outage, nor does a time-based fire, which has no item).
 * Called inside the `playbook-run` step, BEFORE the park row is written, so a
 * redelivery records none more.
 */
export function notifyNeedsGithub(store: Store, n: NeedsGithubNotice, now: Date): void {
  const parkedSinceLastSession =
    store
      .prepare<[number, number], number>(
        "SELECT 1 FROM playbook_runs WHERE playbook = ? AND status = 'parked' AND id > (SELECT COALESCE(MAX(id), 0) FROM playbook_runs WHERE playbook = ? AND session_id IS NOT NULL AND item_ref IS NOT NULL) LIMIT 1",
      )
      .pluck()
      .get(n.playbook, n.playbook) !== undefined;
  if (!parkedSinceLastSession) {
    const { park } = n;
    // A missing grant hides the connector check, and a later park in this outage
    // (`missing: "connector"`) notifies nothing: so name both fixes now.
    const noGrant = park.missing === "grant";
    const noConnector = !noGrant || !connectorUsable(park.connector_status);
    const notConnected = "GitHub is not connected";
    const what = noGrant ? `${n.agent} has no GitHub grant${noConnector ? ` and ${notConnected}` : ""}` : notConnected;
    const grantFix = noGrant ? `Add "github" to "connectors" in ${agentSettingsPath(store.dataDir, n.agent)}.` : "";
    const connectorFix = noConnector ? `Connect GitHub (the github connector is ${park.connector_status ?? "absent"}).` : "";
    const fix = [grantFix, connectorFix].filter((s) => s !== "").join(" ");
    const settings = park.settings_error !== undefined ? ` The settings file was refused (${park.settings_error}): fix it first.` : "";
    recordNotification(
      store,
      {
        source: NEEDS_GITHUB_SOURCE,
        title: cutChars(`Playbook ${n.slug} parked: ${what}`, MAX_NOTIFICATION_TITLE),
        body: `Playbook ${n.slug} (#${n.playbook}) did not run for ${n.item.ref}: ${what}. ${fix}${settings} Its items run at the first poll after the grant and connector are both in place.`,
      },
      now,
    );
  }
}

// ---- The skip event ---------------------------------------------------------------------

/**
 * Append one `poll_item_skipped` event for an item whose run was skipped as a
 * duplicate. Called inside a work step only (`playbook-run`, or
 * `start-session`'s late re-check), so a redelivery appends none more.
 */
export function appendItemSkipped(store: Store, playbook: number, item: RunItem, dedupeKey: string, now: Date): void {
  appendEvent(store, "poll_item_skipped", NO_REF, { playbook_id: playbook, item_ref: item.ref, item_revision: item.revision, dedupe_key: dedupeKey }, now.toISOString());
}

// ---- The prompt's item block ------------------------------------------------------------

/** The block: a heading and the item's fields, wrapped as data from the item's ref. */
function renderItemBlock(ref: string, fields: string): string {
  return `## The item\n\n${wrapUntrusted(ref, fields)}\n\n`;
}

function itemFields(ref: string, revision: string, title: string, url: string): string {
  return `ref: ${ref}\nrevision: ${revision}\ntitle: ${title}\nurl: ${url}`;
}

/**
 * The longest item block: the frame and labels around a ref at its bound,
 * plus every field at its bound grown by `defuseWrapperTags` (each 15-character
 * `<untrusted-data` becomes 18: at most 1.2 times).
 */
export const MAX_ITEM_BLOCK_CHARS =
  renderItemBlock("x".repeat(MAX_ITEM_REF_CHARS), itemFields("", "", "", "")).length +
  Math.ceil((MAX_ITEM_REF_CHARS + MAX_ITEM_REVISION_CHARS + MAX_ITEM_TITLE_PROMPT_CHARS + MAX_ITEM_URL_CHARS) * 1.2);

/**
 * The prompt's item block (both playbook prompts, after the instruction):
 * `## The item`, then the item's ref, revision, title (cut at
 * `MAX_ITEM_TITLE_PROMPT_CHARS`) and URL, an absent one shown as `(none)`,
 * wrapped as untrusted data from the ref. At most `MAX_ITEM_BLOCK_CHARS`.
 */
export function itemPromptBlock(item: RunItem): string {
  const title = item.title === undefined ? "(none)" : cutChars(item.title, MAX_ITEM_TITLE_PROMPT_CHARS);
  return renderItemBlock(item.ref, itemFields(item.ref, item.revision, title, item.url ?? "(none)"));
}
