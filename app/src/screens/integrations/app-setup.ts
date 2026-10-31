// The GitHub App setup's model (GitHub App 4): which view the dialog is on, how a
// refusal becomes one of the mockup's views, the GitHub links the views show, and
// the clock check on the setup window. Plain TypeScript: no React, no DOM.
//
// The mockup (`docs/design/mockups/integrations.html`, views `app-*`) has four
// outcome views: setup-expired, setup-cancelled, write-scoped and setup-failed.
// The kernel's refusals (`GitHubAppSetupRefusal`) map onto them in
// `OUTCOME_OF_REFUSAL`; a reason the mockup has no view for (`setup_not_open`,
// `state_mismatch`, `not_implemented`, anything unknown) shows setup-failed's
// copy, because a new view needs the owner's approval (DESIGN.md "Open points").
// The kernel's own `message` is never shown: the views carry the mockup's copy.
//
// Everything read from an event or a refusal body is untrusted: the `refused`
// field is only ever checked against the closed list, `app_slug` against the
// slug shape the open-external allowlist uses, and nothing here builds markup.
import type { ApiError, Connector, EventFrame, GitHubAppSetupRefusal, TruncatedEventFrame } from "../../api/contract";
import { type Reply, type RowDot, writePermissionsOf } from "./model";

// ---- Outcomes ---------------------------------------------------------------------------------

/** The mockup's outcome views of the setup dialog. */
export type AppSetupOutcome = "expired" | "cancelled" | "write-scoped" | "failed";

/**
 * Each setup refusal's view. A `Record` over the type, so a reason added to
 * `GitHubAppSetupRefusal` fails `npm run typecheck` until it is mapped here.
 */
export const OUTCOME_OF_REFUSAL: Readonly<Record<GitHubAppSetupRefusal, AppSetupOutcome>> = Object.freeze({
  setup_not_open: "failed",
  state_mismatch: "failed",
  setup_expired: "expired",
  conversion_failed: "failed",
  install_failed: "failed",
  token_write_scoped: "write-scoped",
});

/** The runtime mirror of `GitHubAppSetupRefusal`: the closed list a `refused` value is checked against. */
export const APP_SETUP_REFUSALS: readonly GitHubAppSetupRefusal[] = Object.freeze(Object.keys(OUTCOME_OF_REFUSAL) as GitHubAppSetupRefusal[]);

/** Whether `value` is one of the kernel's setup refusal reasons. */
export function isSetupRefusal(value: unknown): value is GitHubAppSetupRefusal {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OUTCOME_OF_REFUSAL, value);
}

/** The view for a refusal reason: the mapped one, else setup-failed (an unknown code is never a crash and never raw text). */
export function outcomeOfRefusal(reason: unknown): AppSetupOutcome {
  return isSetupRefusal(reason) ? OUTCOME_OF_REFUSAL[reason] : "failed";
}

// ---- What the dialog is on -----------------------------------------------------------------------

/**
 * `starting`: the setup call is out. `create` and `install` are the mockup's step
 * 1 and step 2. `outcome` is one of the four ended views.
 */
export type AppSetupPhase =
  | { readonly kind: "starting" }
  | { readonly kind: "create" }
  | { readonly kind: "install" }
  | { readonly kind: "outcome"; readonly outcome: AppSetupOutcome };

/** The setup is still running (a window may be open): closing the dialog cancels it. */
export function isInProgress(phase: AppSetupPhase): boolean {
  return phase.kind !== "outcome";
}

/** The list row's words while the dialog is open: the mockup's `rowMeta` for the setup sheets. */
export function appRowMeta(phase: AppSetupPhase): { readonly dot: "working" | "idle"; readonly text: string } {
  if (phase.kind !== "outcome") return { dot: "working", text: "setting up the GitHub App · waiting for you on GitHub" };
  const note: Readonly<Record<AppSetupOutcome, string>> = {
    expired: "setup timed out",
    cancelled: "setup cancelled",
    "write-scoped": "the App can write",
    failed: "setup did not finish",
  };
  return { dot: "idle", text: `not connected · ${note[phase.outcome]}` };
}

/**
 * The list row's words while the dialog is open over a token in use (the switch): the token's own words (`token`,
 * what `rowMeta` says for it) with `token` after them, and `setting up the App` while the setup runs. A cancelled or
 * failed setup leaves the token's words, because the connection is untouched. Never "not connected".
 */
export function switchRowMeta(phase: AppSetupPhase, token: { readonly dot: RowDot; readonly text: string }): { readonly dot: RowDot; readonly text: string } {
  return { dot: token.dot, text: `${token.text} · token${phase.kind === "outcome" ? "" : " · setting up the App"}` };
}

// ---- What an event or a refusal says -----------------------------------------------------------------

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** An App's slug if it has the shape the open-external allowlist accepts, else `undefined`. Untrusted input. */
export function slugOf(value: unknown): string | undefined {
  return typeof value === "string" && SLUG.test(value) ? value : undefined;
}

/** What a `connector_status` event says about a setup. */
export type AppSignal =
  /** Not a refusal: the connector changed (step 1 is done, or the install landed). */
  | { readonly kind: "progress"; readonly slug: string | undefined }
  /** A refusal: `refused` was set. Its view, the write permissions it named and the slug it carried. */
  | { readonly kind: "refused"; readonly outcome: AppSetupOutcome; readonly drops: readonly string[]; readonly slug: string | undefined };

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * The event's meaning for a running setup. Only `connector_status` counts. A
 * `refused` that is not null, undefined or an empty string is a refusal, mapped
 * through the closed list (an unknown code reads as setup-failed). A frame
 * without a payload (over the size cap) is a non-refusal change.
 */
export function signalOfEvent(event: EventFrame | TruncatedEventFrame): AppSignal | undefined {
  if (event.kind !== "connector_status") return undefined;
  const payload = "payload" in event ? recordOf(event.payload) : undefined;
  if (payload === undefined) return { kind: "progress", slug: undefined };
  const slug = slugOf(payload.app_slug);
  const refused = payload.refused;
  if (refused === undefined || refused === null || refused === "") return { kind: "progress", slug };
  return { kind: "refused", outcome: outcomeOfRefusal(refused), drops: writePermissionsOf(payload as ApiError), slug };
}

/** What a non-ok answer of `POST /connectors/github/app/setup` shows: the refusal's view (the error code, not its message). */
export function outcomeOfReply(reply: Exclude<Reply<unknown>, { readonly kind: "ok" }>): { readonly outcome: AppSetupOutcome; readonly drops: readonly string[] } {
  if (reply.kind !== "refused") return { outcome: "failed", drops: [] };
  return { outcome: outcomeOfRefusal(reply.error), drops: writePermissionsOf(reply.body) };
}

/**
 * Step 1 is done and the owner is on GitHub's install page: the row is an App
 * connection with its slug set and no installation yet.
 */
export function stepOneDoneRow(row: Connector | undefined): boolean {
  return row?.method === "app" && slugOf(row.app_slug) !== undefined && (row.installation_id === null || row.installation_id === undefined);
}

// ---- GitHub links ------------------------------------------------------------------------------------

/** "Open Installed GitHub Apps": the owner uninstalls the App here. One of the channel's three allowed forms. */
export const INSTALLATIONS_URL = "https://github.com/settings/installations";

/** The bare GitHub Apps page is not on the channel's allowlist, so it is shown as text (the `TOKEN_PAGE` precedent). */
export const GITHUB_APPS_TEXT = "github.com/settings/apps";

/** The App's own page, `https://github.com/settings/apps/<slug>`, when the slug is well-formed; else `undefined`. */
export function appPageUrl(slug: unknown): string | undefined {
  const valid = slugOf(slug);
  return valid === undefined ? undefined : `https://github.com/settings/apps/${valid}`;
}

// ---- The setup window's clock --------------------------------------------------------------------------

/** The longest delay `setTimeout` takes; a longer one fires at once. */
export const MAX_TIMER_MS = 2_147_483_647;

/** Milliseconds from `nowMs` to `iso`; `undefined` when `iso` is not a time. Negative once past. */
export function msUntil(iso: string | null | undefined, nowMs: number): number | undefined {
  if (iso === null || iso === undefined) return undefined;
  const at = new Date(iso).getTime();
  return Number.isNaN(at) ? undefined : at - nowMs;
}

/** "14:12" (local time) for the window's close, or `undefined` when `iso` is not a time. */
export function closesAtText(iso: string | null | undefined): string | undefined {
  if (iso === null || iso === undefined) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** The setup route's answer, read defensively: both fields are checked, nothing is trusted to be a string. */
export function setupWindowOf(body: unknown): { readonly setupUrl: string; readonly expiresAt: string | undefined } | undefined {
  const record = recordOf(body);
  if (record === undefined || typeof record.setup_url !== "string" || record.setup_url === "") return undefined;
  return { setupUrl: record.setup_url, expiresAt: typeof record.expires_at === "string" ? record.expires_at : undefined };
}
