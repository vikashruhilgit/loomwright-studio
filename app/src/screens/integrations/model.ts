// Integrations' view model (phase 6 item 11): the GitHub connector row turned
// into the mockup's designed states (`docs/design/mockups/integrations.html`:
// `S.base` none / connected / expiring / expired / unreachable), the words the
// list row and the detail pane show, and the kernel's refusals to the token
// route turned into the sheet's copy. Plain TypeScript: no React, no DOM.
//
// Every string from the kernel or GitHub (`account_login`, permission names,
// repo names, a refusal's `message`) is untrusted data (invariant 3): nothing
// here builds markup, and the components render each value as a React text
// child. The pasted token is not in this file at all: it never leaves
// `ConnectSheet.tsx`'s submit handler and the one call in `actions.ts`.
import type {
  AgentDetailResponse,
  ApiError,
  ApiResult,
  Connector,
  ConnectorStatus,
  ConnectorsResponse,
  McpConnection,
  McpConnectionKind,
  RepoPolicy,
  RepoPolicyKind,
  RepoPolicyProposal,
  RepoPolicySetBody,
  RosterEntry,
} from "../../api/contract";
import { acceptedSettings, githubGranted, isRecord, isWright, MCP_KIND_LABELS, mcpToolsHeld, orderRoster, outcomeOf } from "../team/model";

/** The ids the unit tests and the e2e spec target; the screen sets no other test id. */
export const INTEGRATIONS_TEST_IDS = {
  screen: "screen-integrations",
  list: "integrations-list",
  listRow: "integrations-row-github",
  listMeta: "integrations-row-meta",
  listDot: "integrations-row-dot",
  count: "integrations-count",
  band: "integrations-band",
  readError: "integrations-read-error",
  notice: "integrations-notice",
  loading: "integrations-loading",
  empty: "integrations-empty",
  emptyConnect: "integrations-connect",
  detail: "integrations-detail",
  detailHeader: "integrations-detail-header",
  replace: "integrations-replace",
  switchToApp: "integrations-switch-to-app",
  disconnect: "integrations-disconnect",
  status: "integrations-status",
  account: "integrations-account",
  expires: "integrations-expires",
  inBand: "integrations-in-band",
  permissions: "integrations-permissions",
  repos: "integrations-repos",
  reposHeading: "integrations-repos-heading",
  refresh: "integrations-refresh",
  agents: "integrations-agents",
  agentCard: "integrations-agent",
  agentsNote: "integrations-agents-note",
  sheet: "integrations-sheet",
  sheetToken: "integrations-token",
  sheetDeclare: "integrations-sheet-declare",
  sheetConnect: "integrations-sheet-connect",
  sheetCancel: "integrations-sheet-cancel",
  sheetError: "integrations-sheet-error",
  sheetStatus: "integrations-sheet-status",
  sheetPage: "integrations-token-page",
  // The GitHub App path (GitHub App 4): the choice, the setup dialog, the App's detail pane and its disconnect confirm.
  choice: "integrations-choice",
  choiceApp: "integrations-choice-app",
  choiceToken: "integrations-choice-token",
  choiceCancel: "integrations-choice-cancel",
  appSetup: "integrations-app-setup",
  appSteps: "integrations-app-steps",
  appStep1: "integrations-app-step-1",
  appStep2: "integrations-app-step-2",
  appCloses: "integrations-app-closes",
  appStatus: "integrations-app-status",
  appOpenAgain: "integrations-app-open-again",
  appCancel: "integrations-app-cancel",
  appClose: "integrations-app-close",
  appAgain: "integrations-app-again",
  appPasteToken: "integrations-app-paste-token",
  appOutcome: "integrations-app-outcome",
  appLink: "integrations-app-link",
  appName: "integrations-app-name",
  appInstallation: "integrations-app-installation",
  appKey: "integrations-app-key",
  appAccess: "integrations-app-access",
  appChecked: "integrations-app-checked",
  appSessionScope: "integrations-app-session-scope",
  appSetUpAgain: "integrations-app-set-up-again",
  appConfirm: "integrations-app-confirm",
  appConfirmInstalled: "integrations-app-confirm-installed",
  appConfirmApps: "integrations-app-confirm-apps",
  // Phase 8: the list rows beside GitHub's, the Jira / ClickUp pane, the App upgrade and the repo policy card.
  rowPolicy: "integrations-row-policy",
  rowJira: "integrations-row-jira",
  rowClickup: "integrations-row-clickup",
  mcp: "integrations-mcp",
  mcpStub: "integrations-mcp-stub",
  mcpConnect: "integrations-mcp-connect",
  mcpWait: "integrations-mcp-wait",
  mcpWaitCloses: "integrations-mcp-wait-closes",
  mcpOpenAgain: "integrations-mcp-open-again",
  mcpCancel: "integrations-mcp-cancel",
  mcpRefused: "integrations-mcp-refused",
  mcpRefusedMessage: "integrations-mcp-refused-message",
  mcpRetry: "integrations-mcp-retry",
  mcpDismiss: "integrations-mcp-dismiss",
  mcpExpired: "integrations-mcp-expired",
  mcpReconnect: "integrations-mcp-reconnect",
  mcpDisconnect: "integrations-mcp-disconnect",
  mcpDisconnectConfirm: "integrations-mcp-disconnect-confirm",
  mcpNotice: "integrations-mcp-notice",
  mcpWorkspace: "integrations-mcp-workspace",
  mcpTools: "integrations-mcp-tools",
  mcpTool: "integrations-mcp-tool",
  mcpToolCell: "integrations-mcp-tool-cell",
  mcpTeam: "integrations-mcp-team",
  upgrade: "integrations-upgrade",
  upgradeAccept: "integrations-upgrade-accept",
  upgradeAddress: "integrations-upgrade-address",
  upgradeCheck: "integrations-upgrade-check",
  upgradeError: "integrations-upgrade-error",
  upgradeScope: "integrations-upgrade-scope",
  policy: "integrations-policy",
  policyEmpty: "integrations-policy-empty",
  policyError: "integrations-policy-error",
  policyChip: "integrations-policy-chip",
  policyCard: "integrations-policy-card",
  policyDetected: "integrations-policy-detected",
  policyRedetect: "integrations-policy-redetect",
  policyProposal: "integrations-policy-proposal",
  policyAccept: "integrations-policy-accept",
  policyNone: "integrations-policy-none",
  policyChoices: "integrations-policy-choices",
  policyMakePublic: "integrations-policy-make-public",
  policyUpgrade: "integrations-policy-upgrade",
  policyLinkError: "integrations-policy-link-error",
  policyTrust: "integrations-policy-trust",
  policyTrustConfirm: "integrations-policy-trust-confirm",
  policyTrusting: "integrations-policy-trusting",
  policySafe: "integrations-policy-safe",
  policySafeView: "integrations-policy-safe-view",
  policySafeAgain: "integrations-policy-safe-again",
  policyPreset: "integrations-policy-preset",
  policyReviews: "integrations-policy-reviews",
  policySet: "integrations-policy-set",
  policyCurrent: "integrations-policy-current",
  policyChange: "integrations-policy-change",
  policyNotice: "integrations-policy-notice",
  policyStatus: "integrations-policy-status",
} as const;

// ---- One call's answer ------------------------------------------------------------------------

/**
 * The bridge's answer, kept apart where this screen must tell them apart:
 * `unreachable` (status 0 with a `connection`: the kernel could not be asked,
 * which is never "not connected"), `refused` (the kernel answered no, with its
 * whole body for `write_permissions`) and `failed` (the IPC call itself failed).
 */
export type Reply<R> =
  | { readonly kind: "ok"; readonly status: number; readonly body: R }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "refused"; readonly status: number; readonly error: string; readonly message: string | undefined; readonly body: ApiError }
  | { readonly kind: "failed"; readonly message: string };

/** Team's wording for a call that did not answer ok (a failed IPC call, or the kernel not reachable). */
function unansweredText(result: ApiResult<unknown> | undefined): string {
  const said = outcomeOf(result);
  return said.ok ? "" : said.message;
}

/** `result` as a `Reply`; `undefined` is a failed IPC call. The wording is Team's `outcomeOf`, not a second copy. */
export function replyOf<R>(result: ApiResult<R> | undefined): Reply<R> {
  if (result === undefined) return { kind: "failed", message: unansweredText(undefined) };
  if (result.ok) return { kind: "ok", status: result.status, body: result.body };
  if ("connection" in result) return { kind: "unreachable", message: unansweredText(result) };
  const body: ApiError = typeof result.body === "object" && result.body !== null ? result.body : { error: `HTTP ${result.status}` };
  const error = typeof body.error === "string" && body.error !== "" ? body.error : `HTTP ${result.status}`;
  const message = typeof body.message === "string" && body.message !== "" ? body.message : undefined;
  return { kind: "refused", status: result.status, error, message, body };
}

/** A non-ok reply in words: the kernel's `message` if it sent one, else its error code. */
export function replyText(reply: Exclude<Reply<unknown>, { readonly kind: "ok" }>): string {
  if (reply.kind === "refused") return reply.message ?? reply.error;
  return reply.message;
}

// ---- Status to designed state -----------------------------------------------------------------

/**
 * The mockup's `S.base`: `none` (no token in use), a token's state, or `revoked` (an
 * App GitHub no longer accepts: `app-revoked`). `unreachable` is the read's phase, not a row state.
 */
export type DesignedState = "none" | "connected" | "expiring" | "expired" | "revoked";

/**
 * Each row status's designed state. A `rejected` row (the kernel writes one
 * after a refused first connect) and a `disconnected` one have no token in
 * use: both are the empty state, `rejected` with the refused note in the list row.
 */
export const STATE_OF_STATUS: Readonly<Record<ConnectorStatus, DesignedState>> = Object.freeze({
  connected: "connected",
  expiring: "expiring",
  expired: "expired",
  needs_permissions: "connected",
  rejected: "none",
  disconnected: "none",
});

/** Whether the row is a GitHub App connection (`method: "app"`); a row without `method` reads as a token. */
export function isAppRow(row: Connector | undefined): boolean {
  return row?.method === "app";
}

/**
 * An App GitHub refused after it had been installed: `rejected` with the App's slug and installation both
 * recorded. A `rejected` App row without them is a setup that was refused, which reads as not connected.
 */
export function isRevokedApp(row: Connector | undefined): boolean {
  return row !== undefined && isAppRow(row) && row.status === "rejected" && typeof row.app_slug === "string" && row.app_slug !== "" && typeof row.installation_id === "number";
}

/** The GitHub row of a `GET /connectors` answer, if the kernel has one. */
export function githubRow(answer: ConnectorsResponse | undefined): Connector | undefined {
  return answer?.connectors.find((c) => c.kind === "github");
}

/** What the screen has read so far: the newest answer, and the newest answer that was `ok` (kept while a later one fails). */
export interface ConnectorsRead {
  readonly latest: Reply<ConnectorsResponse> | undefined;
  readonly lastOk: ConnectorsResponse | undefined;
}

export type Phase = "loading" | "ready" | "unreachable" | "error";

export interface IntegrationsView {
  readonly phase: Phase;
  /** The designed state of the row shown (from the last `ok` answer): `none` with no row, or a dead one. */
  readonly state: DesignedState;
  /** The row behind a token state, for the detail pane; `undefined` in `none`. */
  readonly row: Connector | undefined;
  /** The last token the kernel saw was refused (`rejected` row). */
  readonly refused: boolean;
  /** Why the latest read failed, for `unreachable` and `error`. */
  readonly message: string | undefined;
}

/**
 * The view of `read`. A status 0 answer is `unreachable` (the last good row
 * stays, read-only; with none, "status unknown"), never `none`; a refused one
 * is `error`; neither drops the last good answer.
 */
export function viewOf(read: ConnectorsRead): IntegrationsView {
  const row = githubRow(read.lastOk);
  const state: DesignedState = row === undefined ? "none" : isRevokedApp(row) ? "revoked" : STATE_OF_STATUS[row.status];
  const shown = { state, row: state === "none" ? undefined : row, refused: row?.status === "rejected" };
  const { latest } = read;
  if (latest === undefined) return { phase: "loading", ...shown, message: undefined };
  if (latest.kind === "ok") return { phase: "ready", ...shown, message: undefined };
  if (latest.kind === "unreachable") return { phase: "unreachable", ...shown, message: latest.message };
  return { phase: "error", ...shown, message: replyText(latest) };
}

/** Whether a connection is in use (connected, expiring, expired or a revoked App): Disconnect exists. */
export function hasToken(view: IntegrationsView): boolean {
  return view.state !== "none";
}

/** The connection in use is a GitHub App: it has no Replace token, and Connect GitHub waits for a disconnect. */
export function isAppConnection(view: IntegrationsView): boolean {
  return isAppRow(view.row);
}

/**
 * "Switch to GitHub App" exists: a token is in use (connected, expiring or expired) and no App is. A revoked App, a
 * rejected or disconnected row and a read that has not answered yet are not a token in use.
 */
export function switchToApp(view: IntegrationsView): boolean {
  return !isAppRow(view.row) && (view.state === "connected" || view.state === "expiring" || view.state === "expired");
}

/** The kernel cannot be asked right now: every write is disabled. */
export function isOffline(view: IntegrationsView): boolean {
  return view.phase === "unreachable";
}

// ---- Dates ------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dateOf(iso: string | null | undefined): Date | undefined {
  if (iso === null || iso === undefined) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Whole days from `now` to the expiry, rounded up (23 h left is 1 day); negative once past. */
export function daysLeft(expiresAt: string | null, now: Date): number | undefined {
  const at = dateOf(expiresAt);
  if (at === undefined) return undefined;
  return Math.ceil((at.getTime() - now.getTime()) / DAY_MS);
}

export interface ExpiryView {
  /** "23 Jan 2027" (UTC date), or "No expiry" when GitHub reported none. */
  readonly date: string;
  /** "88 days left", "expired 2 days ago"; `undefined` with no expiry. */
  readonly left: string | undefined;
  readonly badge: "renew soon" | "expired" | undefined;
}

/** The Expires line for a token state. */
export function expiryOf(expiresAt: string | null, state: DesignedState, now: Date): ExpiryView {
  const at = dateOf(expiresAt);
  const badge = state === "expiring" ? "renew soon" : state === "expired" ? "expired" : undefined;
  if (at === undefined) return { date: "No expiry", left: undefined, badge };
  const date = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()] ?? ""} ${at.getUTCFullYear()}`;
  const ms = at.getTime() - now.getTime();
  if (ms > 0) return { date, left: `${plural(Math.ceil(ms / DAY_MS), "day", "days")} left`, badge };
  const ago = Math.floor(-ms / DAY_MS);
  return { date, left: ago === 0 ? "expired today" : `expired ${plural(ago, "day", "days")} ago`, badge };
}

/** "today 14:02" for a time on `now`'s day, else "24 Oct 09:12" (local time); "never" with no time. */
export function whenText(iso: string | null, now: Date): string {
  const at = dateOf(iso);
  if (at === undefined) return "never";
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? `today ${clock}` : `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""} ${clock}`;
}

// ---- The list row ------------------------------------------------------------------------------

export type RowDot = "ok" | "waiting" | "danger" | "idle" | "working" | "none";

/** The list row's dot and words for each designed state (the mockup's `rowMeta`). */
export function rowMeta(view: IntegrationsView, connecting: boolean, now: Date): { readonly dot: RowDot; readonly text: string } {
  if (connecting) return { dot: "working", text: "connecting · checking the token with GitHub" };
  if (view.phase === "loading") return { dot: "idle", text: "checking…" };
  if (view.phase === "unreachable") return { dot: "none", text: "status unknown · kernel unreachable" };
  const { row } = view;
  if (view.state === "none") {
    if (view.phase === "error") return { dot: "none", text: "status unknown" };
    return { dot: "idle", text: view.refused ? "not connected · the last token was refused" : "not connected" };
  }
  const who = row?.account_login ? ` · ${row.account_login}` : "";
  if (view.state === "revoked") return { dot: "danger", text: "rejected · GitHub no longer accepts the App" };
  if (row?.status === "needs_permissions") return { dot: "waiting", text: `needs new permissions${who}${isAppRow(row) ? " · GitHub App" : ""}` };
  if (view.state === "connected") return { dot: "ok", text: `connected${who}${isAppRow(row) ? " · GitHub App" : ""}` };
  if (view.state === "expired") return { dot: "danger", text: `expired${who}` };
  const days = daysLeft(row?.expires_at ?? null, now);
  return { dot: "waiting", text: `${days === undefined ? "expiring" : `expiring in ${plural(Math.max(days, 0), "day", "days")}`}${who}` };
}

// ---- Permissions ---------------------------------------------------------------------------------

/** "pull_requests" -> "Pull requests". The key is GitHub's: only its separators and first letter change. */
export function permissionLabel(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced === "" ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * GitHub's level as reported, in the mockups' words: `read` is "Read-only" and
 * `write` is "Read and write" (`phase-8.html`, D39's App). Any other level is shown
 * as GitHub sent it, so nothing is ever called read-only unless GitHub said `read`.
 */
export function levelLabel(level: string): string {
  if (level === "read") return "Read-only";
  if (level === "write") return "Read and write";
  return level;
}

export interface PermissionLine {
  readonly label: string;
  readonly level: string;
}

/** A row's permissions, in the order the kernel sent them. */
export function permissionLines(permissions: Readonly<Record<string, string>> | null): PermissionLine[] {
  if (permissions === null) return [];
  return Object.entries(permissions).map(([key, level]) => ({ label: permissionLabel(key), level: levelLabel(String(level)) }));
}

// ---- Refusals of the token route --------------------------------------------------------------------

/** What the Connect sheet shows after the kernel refuses (or cannot take) a token. */
export type Refusal =
  | { readonly kind: "invalid" }
  | { readonly kind: "write"; readonly drops: readonly string[] }
  /** `token_permissions_unknown`: the sheet's own copy, which points at the confirmation box. */
  | { readonly kind: "permissions_unknown" }
  | { readonly kind: "other"; readonly text: string };

/** "Pull requests: write → set to Read-only": one line per write permission, with GitHub's level as reported. */
export function dropLine(permission: string, level: string): string {
  return `${permissionLabel(permission)}: ${level} → set to Read-only`;
}

/**
 * The write permissions a `token_write_scoped` body names. Read defensively
 * from the open keys of `ApiError`: anything that is not a `{permission, level}`
 * pair of strings is skipped.
 */
export function writePermissionsOf(body: ApiError): string[] {
  const listed = body.write_permissions;
  if (!Array.isArray(listed)) return [];
  const lines: string[] = [];
  for (const item of listed as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { permission, level } = item as { readonly permission?: unknown; readonly level?: unknown };
    if (typeof permission === "string" && typeof level === "string") lines.push(dropLine(permission, level));
  }
  return lines;
}

/** The sheet's copy for a non-ok answer of `POST /connectors/github/token`. */
export function refusalOf(reply: Exclude<Reply<unknown>, { readonly kind: "ok" }>): Refusal {
  if (reply.kind === "refused" && reply.error === "token_invalid") return { kind: "invalid" };
  if (reply.kind === "refused" && reply.error === "token_write_scoped") return { kind: "write", drops: writePermissionsOf(reply.body) };
  if (reply.kind === "refused" && reply.error === "token_permissions_unknown") return { kind: "permissions_unknown" };
  return { kind: "other", text: replyText(reply) };
}

// ---- Agents ------------------------------------------------------------------------------------------

/** The agents the roster says hold GitHub (`githubGranted(agent) === true`), Wright first; an unreported grant is not a grant. */
export function grantedAgents(roster: readonly RosterEntry[]): RosterEntry[] {
  return orderRoster(roster).filter((agent) => githubGranted(agent) === true);
}

/** The agents the roster says hold no GitHub; one whose grant the roster did not report is in neither list. */
export function ungrantedAgents(roster: readonly RosterEntry[]): RosterEntry[] {
  return orderRoster(roster).filter((agent) => githubGranted(agent) === false);
}

/** "Mason and Pim don't have it." / "Mason doesn't have it." / `undefined` when every reported agent holds it. */
export function ungrantedNote(roster: readonly RosterEntry[]): string | undefined {
  const names = ungrantedAgents(roster).map((a) => a.display_name);
  if (names.length === 0) return undefined;
  const list = names.length === 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  return `${list} ${names.length === 1 ? "doesn't" : "don't"} have it.`;
}

// ---- Phase 8: Jira and ClickUp (MCP) ----------------------------------------------------------------
// Design source: `docs/design/mockups/phase-8.html` (`listHTML`, `cnPane`, `toolsTable`, `jiraNote`). Everything read
// from `mcp_connections` (the workspace address, the tool names) and from a refusal (its code and `message`) is the
// server's or the kernel's text: untrusted, rendered as a React text child.

/** The MCP kinds the screen lists, in the order of the mockup's list. */
export const MCP_KINDS: readonly McpConnectionKind[] = Object.freeze(["jira", "clickup"] as const);

export interface McpVendor {
  /** The connector's name in the list and the headings. */
  readonly name: string;
  /** Who runs the hosted server the owner approves Studio at. */
  readonly vendor: string;
  /** What stays the owner's to do at the vendor after a disconnect (`cnDialog`'s disconnect view). */
  readonly revoke: string;
}

export const MCP_VENDORS: Readonly<Record<McpConnectionKind, McpVendor>> = Object.freeze({
  jira: { name: MCP_KIND_LABELS.jira, vendor: "Atlassian", revoke: "Remove “Loomwright Studio” from the apps connected to your Atlassian account" },
  clickup: { name: MCP_KIND_LABELS.clickup, vendor: "ClickUp", revoke: "Remove “Loomwright Studio” from the apps connected to your ClickUp account" },
});

/** The Keychain item an MCP kind's tokens live in (`docs/architecture/mcp-connectors.md`); named here, never read. */
export function mcpKeychainItem(kind: McpConnectionKind): string {
  return `loomwright-studio-mcp-${kind}`;
}

/** The `mcp_connections` rows of a `GET /connectors` answer; the field is optional, so a missing one is `[]`. */
export function mcpRowsOf(answer: ConnectorsResponse | undefined): readonly McpConnection[] {
  return answer?.mcp_connections ?? [];
}

export function mcpRowOf(rows: readonly McpConnection[], kind: McpConnectionKind): McpConnection | undefined {
  return rows.find((row) => row.kind === kind);
}

/** An MCP row's designed state: `connected` (also `expiring`), `expired`, else `none` (no row, `disconnected`, `rejected`). */
export type McpState = "none" | "connected" | "expired";

export function mcpStateOf(row: McpConnection | undefined): McpState {
  if (row === undefined) return "none";
  if (row.status === "connected" || row.status === "expiring") return "connected";
  if (row.status === "expired") return "expired";
  return "none";
}

/** The list row's dot and words for an MCP kind (the mockup's `lstat`). */
export function mcpRowMeta(row: McpConnection | undefined, view: Pick<IntegrationsView, "phase">, connecting: boolean, hasData: boolean): { readonly dot: RowDot; readonly text: string } {
  if (connecting) return { dot: "working", text: "connecting · waiting for you" };
  if (view.phase === "unreachable") return { dot: "none", text: "status unknown · kernel unreachable" };
  if (!hasData) return view.phase === "loading" ? { dot: "idle", text: "checking…" } : { dot: "none", text: "status unknown" };
  const state = mcpStateOf(row);
  if (state === "connected") return { dot: "ok", text: row?.server_url ? `connected · ${row.server_url}` : "connected" };
  if (state === "expired") return { dot: "danger", text: "expired" };
  return { dot: "idle", text: "not connected" };
}

// ---- A connect's refusal ----

/**
 * Why a connect ended without a connection. The kernel's codes are a closed set (`MCP_ERROR_STATUS` in
 * `kernel/src/integrations/mcp/routes.ts`) that the app neither imports nor copies: two codes have their own sentence,
 * any other is the generic sentence plus the code. `not_opened` and `unanswered` are the app's own: the system browser
 * would not open the address, or the kernel could not be asked.
 */
export type McpRefusal =
  | { readonly kind: "denied" }
  | { readonly kind: "window_expired" }
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "not_opened" }
  | { readonly kind: "unanswered" };

export interface McpRefusalView {
  readonly refusal: McpRefusal;
  /** The kernel's own words for it, when it sent some; text only. */
  readonly message: string | undefined;
}

const CODE_CLIP = 80;
const MESSAGE_CLIP = 300;

function clipped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** The refusal for a code from a connect answer or a `connector_status` event's `refused`. */
export function mcpRefusalOfCode(code: string, message?: string): McpRefusalView {
  const said = message === undefined || message === "" ? undefined : clipped(message, MESSAGE_CLIP);
  if (code === "authorization_denied") return { refusal: { kind: "denied" }, message: said };
  if (code === "window_expired") return { refusal: { kind: "window_expired" }, message: said };
  return { refusal: { kind: "code", code: clipped(code, CODE_CLIP) }, message: said };
}

/** The refusal behind a non-ok answer of the connect route: any non-2xx is one refused state. */
export function mcpRefusalOfReply(reply: Exclude<Reply<unknown>, { readonly kind: "ok" }>): McpRefusalView {
  if (reply.kind === "refused") return mcpRefusalOfCode(reply.error, reply.message);
  return { refusal: { kind: "unanswered" }, message: undefined };
}

/** The refusal a `connector_status` event of `kind` carries (`payload.refused`), else `undefined`. */
export function mcpRefusalOfEvent(payload: unknown, kind: McpConnectionKind): McpRefusalView | undefined {
  if (!isRecord(payload) || payload["kind"] !== kind) return undefined;
  const refused = payload["refused"];
  if (typeof refused !== "string" || refused === "") return undefined;
  const message = payload["message"];
  return mcpRefusalOfCode(refused, typeof message === "string" ? message : undefined);
}

export interface McpRefusalCopy {
  readonly title: string;
  readonly text: string;
}

/** The words for a refusal (the mockup's `int-refused` view, with the copy for each kind of ending). */
export function mcpRefusalCopy(kind: McpConnectionKind, refusal: McpRefusal): McpRefusalCopy {
  const { name, vendor } = MCP_VENDORS[kind];
  const kept = "Nothing was connected, and no token was kept.";
  switch (refusal.kind) {
    case "denied":
      return { title: `${vendor} refused access`, text: `${vendor} didn't grant access (authorization_denied). You chose Deny there, or the account doesn't allow Studio. ${kept}` };
    case "window_expired":
      return { title: "The sign-in window closed", text: `The window closed (window_expired) before ${vendor} came back to Studio. ${kept}` };
    case "code":
      return { title: `${name} didn't connect`, text: `Studio couldn't connect ${name} (${refusal.code}). ${kept}` };
    case "not_opened":
      return { title: `${name} didn't connect`, text: `Studio couldn't open ${vendor}'s page in your browser, so the sign-in never started. ${kept}` };
    case "unanswered":
      return { title: `${name} didn't connect`, text: `Studio couldn't reach the kernel to connect ${name}. ${kept}` };
  }
}

// ---- The tools and who holds each ----

export type ToolCell = "granted" | "not_granted" | "unknown";

/** The crew members whose roster entry says they hold `kind` at all, or who are unreported: the ones whose detail is read. */
export function needsToolRead(agent: RosterEntry, kind: McpConnectionKind): boolean {
  if (isWright(agent)) return false;
  const held = agent.connectors;
  return held === undefined || held === null || held.includes(kind);
}

/**
 * One cell of the tools table. A roster that says the agent does not hold the kind is "not granted" for every tool; Wright
 * has no detail route, so with the kind held its per-tool grant is unknown, never "not granted".
 */
export function toolCell(agent: RosterEntry, kind: McpConnectionKind, tool: string, details: ReadonlyMap<string, AgentDetailResponse>): ToolCell {
  const held = agent.connectors;
  if (held !== undefined && held !== null && !held.includes(kind)) return "not_granted";
  if (isWright(agent)) return "unknown";
  const detail = details.get(agent.id);
  const tools = detail === undefined ? undefined : mcpToolsHeld(acceptedSettings(detail), kind);
  if (tools === undefined) return "unknown";
  return tools.includes(tool) ? "granted" : "not_granted";
}

// ---- Phase 8: the GitHub App upgrade ----------------------------------------------------------------

/** The permissions a session's token is cut down to (`SESSION_TOKEN_PERMISSIONS`, D39): the mockup's `SESSION_PERMS`. */
export const SESSION_TOKEN_PERMISSIONS: readonly string[] = Object.freeze(["Pull requests", "Contents", "Issues", "Checks"]);

/** The App row reads `needs_permissions`: the kernel says its installation holds fewer permissions than Studio now asks for. */
export function needsUpgrade(row: Connector | undefined): boolean {
  return isAppRow(row) && row?.status === "needs_permissions";
}

// ---- Phase 8: the repo policy card ----------------------------------------------------------------------

export interface PolicyPreset {
  readonly kind: RepoPolicyKind;
  readonly label: string;
  readonly blurb: string;
}

/** The mockup's `POLN` and `POLD`: the three presets, which are the three kinds the kernel closes in code. */
export const POLICY_PRESETS: readonly PolicyPreset[] = Object.freeze([
  { kind: "solo", label: "Solo", blurb: "Nobody is asked. When CI is green and Loomwright's review passes, Loomwright's gate merges the PR. Studio and the kernel merge nothing." },
  { kind: "studio_approval", label: "Approve in Studio", blurb: "Each PR parks until you allow it in Approvals. Then Loomwright's gate merges it when its own checks pass." },
  { kind: "reviews", label: "N GitHub reviews", blurb: "The PR waits for N approving reviews on GitHub, with CI green and Loomwright's review passed. Then Loomwright's gate merges it." },
]);

export function policyLabel(kind: RepoPolicyKind): string {
  return POLICY_PRESETS.find((preset) => preset.kind === kind)?.label ?? kind;
}

/** "Solo", "Approve in Studio", "2 GitHub reviews". */
export function policyWords(kind: RepoPolicyKind, required: number | null): string {
  if (kind !== "reviews") return policyLabel(kind);
  return required === null ? "GitHub reviews" : `${required} GitHub ${required === 1 ? "review" : "reviews"}`;
}

/** A whole number from 1 to 999: the mockup's `nOk`. */
export function reviewsValid(text: string): boolean {
  return /^[1-9]\d{0,2}$/.test(text.trim());
}

/** The body that sets a preset: `reviews` carries the typed N (`required`), the others carry only their kind. `undefined` for an N that is not valid. */
export function presetBody(kind: RepoPolicyKind, reviews: string, trustUnprotected: boolean): RepoPolicySetBody | undefined {
  const trust = trustUnprotected ? { trust_unprotected: true } : {};
  if (kind !== "reviews") return { kind, ...trust };
  if (!reviewsValid(reviews)) return undefined;
  return { kind, required: Number(reviews.trim()), ...trust };
}

/** The body that accepts a proposal: its kind, plus its `required_reviews` when the kind is `reviews`. `undefined` when it names no kind. */
export function acceptBody(proposal: RepoPolicyProposal): RepoPolicySetBody | undefined {
  if (proposal.kind === null) return undefined;
  if (proposal.kind === "reviews" && proposal.required_reviews !== null) return { kind: "reviews", required: proposal.required_reviews };
  return { kind: proposal.kind };
}

/** What the kernel's detection found for the default branch, read defensively from `detected` (the open record the route sends). */
export function protectionOf(detected: RepoPolicy["detected"]): string | undefined {
  const value = isRecord(detected) ? detected["protection"] : undefined;
  return typeof value === "string" ? value : undefined;
}

export interface DetectionLine {
  readonly label: string;
  readonly value: string;
  /** The value is a check or login list: set in the mono face. */
  readonly mono: boolean;
}

export interface DetectionView {
  readonly lines: readonly DetectionLine[];
  /** "read today 14:20", or "never read". */
  readonly read: string;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

/** The card's "On GitHub" lines (the mockup's `polCard` rows) from a detection, else `undefined` before the first one. */
export function detectionOf(detected: RepoPolicy["detected"], now: Date): DetectionView | undefined {
  if (!isRecord(detected)) return undefined;
  const protection = protectionOf(detected);
  const unavailable = protection === "protection_unavailable";
  const protectedBranch = protection === "protected";
  const branch = typeof detected["default_branch"] === "string" && detected["default_branch"] !== "" ? detected["default_branch"] : undefined;
  const reviews = typeof detected["required_reviews"] === "number" ? detected["required_reviews"] : null;
  const checks = strings(detected["required_checks"]) ?? [];
  const pushers = strings(detected["pushers"]);
  const readAt = typeof detected["read_at"] === "string" ? detected["read_at"] : null;

  const protectionText =
    protection === "protected"
      ? `On${branch === undefined ? "" : `, on ${branch}`}`
      : protection === "unprotected"
        ? `None${branch === undefined ? "" : ` on ${branch}`}`
        : unavailable
          ? "GitHub can't enforce it (a private repo on Free)"
          : protection === "unreadable"
            ? "Couldn't be read"
            : "Not reported";
  const reviewsText = unavailable ? "Can't be required" : protectedBranch && reviews !== null && reviews > 0 ? `${reviews} approving ${reviews === 1 ? "review" : "reviews"}` : "None";
  const checksText = unavailable ? "Can't be required" : protectedBranch && checks.length > 0 ? checks.join(", ") : "None";
  const pushText = pushers === undefined ? "GitHub would not say" : pushers.length === 0 ? "No one reported" : pushers.join(", ");
  return {
    read: readAt === null ? "never read" : `read ${whenText(readAt, now)}`,
    lines: [
      { label: "Branch protection", value: protectionText, mono: false },
      { label: "Required reviews", value: reviewsText, mono: false },
      { label: "Required checks", value: checksText, mono: protectedBranch && checks.length > 0 },
      { label: "Who can push", value: pushText, mono: false },
    ],
  };
}

/** `owner/name` as the two path params of the policy routes, else `undefined` (nothing is sent for a repo that does not read so). */
export function splitRepo(repo: string): { readonly owner: string; readonly name: string } | undefined {
  const parts = repo.split("/");
  if (parts.length !== 2) return undefined;
  const [owner, name] = parts as [string, string];
  return owner === "" || name === "" ? undefined : { owner, name };
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * The repo's GitHub settings page (`https://github.com/<owner>/<repo>/settings`), built only from a name that matches
 * GitHub's own pattern (the open-external allowlist checks the same shape), else `undefined`.
 */
export function repoSettingsUrl(repo: string): string | undefined {
  const parts = splitRepo(repo);
  if (parts === undefined || !OWNER_PATTERN.test(parts.owner) || !NAME_PATTERN.test(parts.name) || parts.name === "." || parts.name === "..") return undefined;
  return `https://github.com/${parts.owner}/${parts.name}/settings`;
}

/** Where a private repo on GitHub Free is upgraded: the one fixed address the allowlist adds beside the repo settings page. */
export const BILLING_PLANS_URL = "https://github.com/settings/billing/plans";

/** What the read of `GET /repos/policy` holds: the last good list, and why the latest read failed. */
export interface PolicyRead {
  /** `idle`: not read yet (the pane has not been opened); `loading`: the first read is out. */
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly repos: readonly RepoPolicy[];
  /** The latest read failed: the list stays, with this beside it. */
  readonly error: string | undefined;
}

/** The "Repo policy" list row's dot and words (the mockup's `lstat`). */
export function policyRowMeta(read: PolicyRead, offline: boolean): { readonly dot: RowDot; readonly text: string } {
  if (read.phase === "idle") return { dot: "idle", text: "open to read the repos" };
  if (read.phase === "loading") return { dot: "idle", text: "checking…" };
  if (read.phase === "error" && read.repos.length === 0) return { dot: "none", text: "status unknown" };
  if (offline) return { dot: "none", text: "status unknown · kernel unreachable" };
  if (read.repos.length === 0) return { dot: "idle", text: "no repos reached yet" };
  const set = read.repos.filter((repo) => repo.kind !== null).length;
  return set === read.repos.length ? { dot: "ok", text: "all repos set" } : { dot: "waiting", text: `${set} of ${read.repos.length} repos set` };
}
