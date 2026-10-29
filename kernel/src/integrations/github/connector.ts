// The `integrations` feature's GitHub connector part (phase 6, item 03): set,
// replace and disconnect the token, re-read the repos it reaches, its expiry
// check (due work), the `connectors` row, and the `studio connectors` CLI verb.
//
// The token lives only in the Keychain item `GITHUB_KEYCHAIN_SERVICE`
// (`loomwright-studio-github`). It is validated BEFORE anything is written:
// GitHub must accept it (`GET /user`), report its permissions, and every one
// of them must be read-only; then its reachable repos are read. Three
// refusals, each writing nothing to the Keychain:
//   - `token_invalid`: GitHub refuses it (401), or it is not a token's shape;
//   - `token_write_scoped`: a permission above read, named with the setting to change;
//   - `token_permissions_unknown`: GitHub did not report its permissions. GitHub
//     publishes none for a fine-grained token (probe p12, 2026-10-29), so the
//     real client reports `null`: such a token is refused unless the OWNER
//     declares that every permission they gave it is Read.
// The declaration (`opts.declaredReadOnly`) is the owner's word, recorded as
// such (`permissions_source: "declared"` and `permissions_declared_at`), never
// as GitHub-verified. It is consulted only when GitHub reported no
// permissions: a reported write permission is refused `token_write_scoped`
// with or without it.
// A refusal while a good token is in use (`connected` or `expiring`) leaves
// the row and the Keychain item unchanged; otherwise the row reads `rejected`.
// Replace is validate, then delete the old item, add the new one (never an
// overwrite), and read it back: only a read-back that matches is `connected`.
//
// The token never reaches a response, a row, an event, a log or an error:
// nothing here logs, every failure is a fixed code and a fixed message, and a
// caught error's message is never kept (a `KeychainError` names only the
// service and an exit status, but nothing relies on that).
//
// Mechanism only (invariant 1): the kernel checks, stores and warns. The
// warning thresholds (`GITHUB_EXPIRY_NOTICE_DAYS`) are the safety kernel's,
// fixed, like the read-only rule (invariant 3).
//
// The `studio` CLI loads it, so it imports only types, the feature seam, the
// Keychain module, the client, the store helpers and its CLI verb: never the
// Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { WRITE_ARG, securityCliKeychain, securityCliKeychainDeleter, securityCliKeychainWriter } from "../../auth/keychain.js";
import type { KeychainDeleter, KeychainReader, KeychainWriter } from "../../auth/keychain.js";
import type { DueWorkFn } from "../../features/contribution.js";
import { appendEvent } from "../../loop/internal.js";
import { recordNotification } from "../../notifications/record.js";
import type { Store } from "../../store/store.js";
import { connectorsSubcommand } from "../cli.js";
import { CONNECTOR_PERMISSIONS_SOURCES } from "../types.js";
import type { ConnectorKind, ConnectorPermissionsSource, ConnectorRow, ConnectorStatus, GitHubClient, GitHubFailure, IntegrationsPart } from "../types.js";
import { GITHUB_KEYCHAIN_SERVICE, createGitHubClient } from "./client.js";

/** The connector kind this file owns. */
export const GITHUB_KIND: ConnectorKind = "github";

/** The Keychain item's account label: a fixed constant, never the GitHub login or the OS user name. */
export const GITHUB_KEYCHAIN_ACCOUNT = "loomwright-studio";

/** Days before `expires_at` the owner is notified, once each per token: the safety kernel's, fixed. */
export const GITHUB_EXPIRY_NOTICE_DAYS: readonly number[] = Object.freeze([14, 1]);

/** A notification's source for the warning at `days` days: `kernel:<reason>`. */
export function githubExpiryNoticeSource(days: number): string {
  return `kernel:github_token_expiring_${days}d`;
}

/** The access levels that cannot write: `none` (no access) and `read`. Any other level, a level unknown here included, is write-scoped (fail-closed). */
export const READ_ONLY_LEVELS: readonly string[] = Object.freeze(["read", "none"]);

/** The three token refusals. */
export const GITHUB_TOKEN_REFUSALS = Object.freeze(["token_invalid", "token_write_scoped", "token_permissions_unknown"] as const);
export type GitHubTokenRefusal = (typeof GITHUB_TOKEN_REFUSALS)[number];

/**
 * Every failure code a connector call answers: the three refusals, then
 * failures that change nothing (GitHub's rate limit, GitHub unreachable or
 * answering an error, the Keychain failing), an unexpected failure
 * (`connector_failed`: the store, or a bug; its message is never kept), then
 * a call on a connector that has no row or no token in use.
 */
export type ConnectorErrorCode =
  | GitHubTokenRefusal
  | "rate_limited"
  | "github_unreachable"
  | "github_error"
  | "keychain_failed"
  | "connector_failed"
  | "no_connector"
  | "not_connected";

/** The longest token accepted (GitHub's fine-grained tokens are ~93 characters). */
export const MAX_GITHUB_TOKEN_LENGTH = 255;

/** The statuses whose token is in use: a refusal leaves them unchanged, and `?refresh=1` reads with it. */
const TOKEN_IN_USE: readonly ConnectorStatus[] = ["connected", "expiring"];

const DAY_MS = 86_400_000;

/** A `connectors` row as the routes answer it: the contract's `Connector` (`app/src/api/contract.ts`). Never the token. */
export interface ConnectorView {
  readonly id: number;
  readonly kind: ConnectorKind;
  readonly status: ConnectorStatus;
  readonly account_login: string | null;
  readonly permissions: Readonly<Record<string, string>> | null;
  readonly reachable_repos: readonly string[] | null;
  readonly expires_at: string | null;
  readonly verified_at: string | null;
  /** Who vouched for `permissions`: GitHub (`reported`) or the owner (`declared`); `null` when unset. */
  readonly permissions_source: ConnectorPermissionsSource | null;
  /** When the owner declared the permissions; `null` unless the source is `declared`. */
  readonly permissions_declared_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** One permission above read: its name and level, as GitHub reported them (untrusted). */
export interface WritePermission {
  readonly permission: string;
  readonly level: string;
}

/** A connector call that changed what it was asked to: the row after the change. */
export interface ConnectorSuccess {
  readonly ok: true;
  readonly connector: ConnectorView;
}

/**
 * A connector call that refused or failed. `message` is a fixed sentence (it
 * names a permission GitHub reported, never the token). `connector` is the
 * row after the call (`null` when there is none).
 */
export interface ConnectorFailure {
  readonly ok: false;
  readonly error: ConnectorErrorCode;
  readonly message: string;
  readonly connector: ConnectorView | null;
  /** `token_write_scoped`: every permission above read. */
  readonly write_permissions?: readonly WritePermission[];
  /** `rate_limited`: when GitHub's limit resets. */
  readonly resets_at?: string;
  /** `github_error`: GitHub's HTTP status. */
  readonly github_status?: number;
}

export type ConnectorOutcome = ConnectorSuccess | ConnectorFailure;

/** What the connector reads, writes and calls. Every default resolves only when a call needs it, so building the shipped part touches nothing. */
export interface GitHubConnectorDeps {
  /** Default: `securityCliKeychain()`. */
  readonly keychain?: KeychainReader;
  /** Default: `securityCliKeychainWriter()`. */
  readonly writer?: KeychainWriter;
  /** Default: `securityCliKeychainDeleter()`. */
  readonly deleter?: KeychainDeleter;
  /**
   * A client over `readToken` (a candidate being validated), or over the
   * Keychain item when `readToken` is `undefined`. Default: `createGitHubClient`.
   */
  readonly clientFor?: (readToken: (() => string | undefined) | undefined, keychain: KeychainReader) => GitHubClient;
}

/** What `setToken` is told beside the token. */
export interface SetTokenOptions {
  /** The owner declares that every permission they gave this token is Read. Only `true` declares; used only when GitHub reports no permissions. */
  readonly declaredReadOnly?: boolean;
}

/** The GitHub connector's calls. One instance serializes its own calls (set, disconnect, refresh), so two never interleave their Keychain steps. */
export interface GitHubConnector {
  /** Validate `token`, then store it (a replace when one is stored). Never throws. */
  setToken(store: Store, token: string, now: () => Date, opts?: SetTokenOptions): Promise<ConnectorOutcome>;
  /** Delete the Keychain item and mark the row `disconnected` (kept, never deleted). Never throws. */
  disconnect(store: Store, now: () => Date): Promise<ConnectorOutcome>;
  /** Re-read the repos the stored token reaches. Never throws. */
  refreshRepos(store: Store, now: () => Date): Promise<ConnectorOutcome>;
}

// ---- The row --------------------------------------------------------------------

const COLUMNS =
  "id, kind, status, account_login, permissions_json, reachable_repos_json, expires_at, verified_at, permissions_source, permissions_declared_at, created_at, updated_at";

/** Every `connectors` row, by id. */
export function listConnectorRows(store: Store): ConnectorRow[] {
  return store.prepare<[], ConnectorRow>(`SELECT ${COLUMNS} FROM connectors ORDER BY id`).all();
}

/** The GitHub connector's row (the oldest, if there were ever two), or `undefined`. */
export function githubConnectorRow(store: Store): ConnectorRow | undefined {
  return store.prepare<[string], ConnectorRow>(`SELECT ${COLUMNS} FROM connectors WHERE kind = ? ORDER BY id LIMIT 1`).get(GITHUB_KIND);
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function permissionsOf(text: string | null): Readonly<Record<string, string>> | null {
  const v = parseJson(text);
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  return Object.values(v).every((level) => typeof level === "string") ? (v as Record<string, string>) : null;
}

function reposOf(text: string | null): readonly string[] | null {
  const v = parseJson(text);
  return Array.isArray(v) && v.every((r) => typeof r === "string") ? (v as string[]) : null;
}

/** The source column as a known source, or `null` (an unknown value is never passed on). */
function sourceOf(value: string | null): ConnectorPermissionsSource | null {
  return CONNECTOR_PERMISSIONS_SOURCES.find((s) => s === value) ?? null;
}

/** `row` in the contract's `Connector` shape: the JSON columns parsed (an unreadable one is `null`). */
export function connectorView(row: ConnectorRow): ConnectorView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    account_login: row.account_login,
    permissions: permissionsOf(row.permissions_json),
    reachable_repos: reposOf(row.reachable_repos_json),
    expires_at: row.expires_at,
    verified_at: row.verified_at,
    permissions_source: sourceOf(row.permissions_source),
    permissions_declared_at: row.permissions_declared_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Every connector, in the contract's shape (`GET /connectors`). */
export function listConnectors(store: Store): ConnectorView[] {
  return listConnectorRows(store).map(connectorView);
}

/**
 * One `connector_status` event: `{connector_id, kind, status}`, plus `refused`
 * (the code) for a refusal, or `permissions_source` for a successful set.
 * Never a secret.
 */
function statusEvent(store: Store, row: ConnectorRow, at: string, refused?: GitHubTokenRefusal, permissionsSource?: ConnectorPermissionsSource): void {
  const payload: Record<string, unknown> = { connector_id: row.id, kind: row.kind, status: row.status };
  if (refused !== undefined) payload["refused"] = refused;
  if (permissionsSource !== undefined) payload["permissions_source"] = permissionsSource;
  appendEvent(store, "connector_status", { sessionId: null, taskId: null }, payload, at);
}

/**
 * The GitHub row, created with `status` when there is none (the other columns
 * null). Appends no event: a caller that creates the row appends its one
 * event itself, so never follow this with `changeStatus` to the same status
 * (that is a no-op and the event is lost); use `setStatus` for that.
 */
function ensureRow(store: Store, status: ConnectorStatus, at: string): ConnectorRow {
  const existing = githubConnectorRow(store);
  if (existing !== undefined) return existing;
  store.prepare("INSERT INTO connectors (kind, status, created_at, updated_at) VALUES (?, ?, ?, ?)").run(GITHUB_KIND, status, at, at);
  return githubConnectorRow(store) as ConnectorRow;
}

/** Sets the row's status (and `updated_at`) and appends its event, only when the status changes. */
function changeStatus(store: Store, row: ConnectorRow, status: ConnectorStatus, at: string): ConnectorRow {
  if (row.status === status) return row;
  store.prepare("UPDATE connectors SET status = ?, updated_at = ? WHERE id = ?").run(status, at, row.id);
  const changed = githubConnectorRow(store) as ConnectorRow;
  statusEvent(store, changed, at);
  return changed;
}

/**
 * Sets the GitHub row's status, creating the row when there is none, with
 * one event for a new row or a changed status and none for an unchanged one.
 */
function setStatus(store: Store, status: ConnectorStatus, at: string): ConnectorRow {
  const existing = githubConnectorRow(store);
  if (existing !== undefined) return changeStatus(store, existing, status, at);
  const created = ensureRow(store, status, at);
  statusEvent(store, created, at);
  return created;
}

// ---- Validation -------------------------------------------------------------------

/** Whether `token` has a token's shape: what the Keychain writer and the client accept. */
export function isGitHubTokenShape(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token.length <= MAX_GITHUB_TOKEN_LENGTH && WRITE_ARG.test(token);
}

/** Every permission whose level is not read-only, in GitHub's order. */
export function writePermissionsOf(permissions: Readonly<Record<string, string>>): WritePermission[] {
  return Object.entries(permissions)
    .filter(([, level]) => !READ_ONLY_LEVELS.includes(level))
    .map(([permission, level]) => ({ permission, level }));
}

/** The refusal's sentence for `writes`: each permission and the setting to change (`pull_requests: write → set to read`). */
export function writeScopedMessage(writes: readonly WritePermission[]): string {
  return `the token can write; change each of these to read-only and paste it again: ${writes.map((w) => `${w.permission}: ${w.level} → set to read`).join("; ")}`;
}

const MESSAGES = {
  token_shape: "this is not a GitHub token's shape: paste the whole token, with no spaces, quotes or line breaks",
  token_invalid: "GitHub did not accept the token: check it was copied whole, and that it has not expired or been revoked",
  token_permissions_unknown:
    "GitHub did not report this token's permissions (it publishes none for a fine-grained token), so Studio cannot check that they are all read-only. If every permission you gave this token is Read, declare it: tick the confirmation in the Connect sheet, answer yes at the studio connectors github set prompt, or send declared_read_only: true",
  github_unreachable: "GitHub could not be reached, or answered something unreadable; nothing changed",
  keychain_failed: `the Keychain item "${GITHUB_KEYCHAIN_SERVICE}" could not be changed; nothing else changed`,
  keychain_lost: `the Keychain item "${GITHUB_KEYCHAIN_SERVICE}" did not hold the new token after it was added, and the old one was already deleted: the connector is disconnected; set the token again`,
  keychain_missing: `the Keychain item "${GITHUB_KEYCHAIN_SERVICE}" is missing or unreadable: set the token again`,
  connector_failed: "the connector could not finish; check what is in use with studio connectors github status",
  no_connector: "GitHub is not connected: studio connectors github set connects it",
  not_connected: "no GitHub token is in use: studio connectors github set connects one",
} as const;

// ---- The connector ------------------------------------------------------------------

/** Builds the connector over `deps`. Nothing is read, written or called until a method runs. */
export function createGitHubConnector(deps: GitHubConnectorDeps = {}): GitHubConnector {
  let reader: KeychainReader | undefined = deps.keychain;
  let writer: KeychainWriter | undefined = deps.writer;
  let deleter: KeychainDeleter | undefined = deps.deleter;
  const keychain = (): KeychainReader => (reader ??= securityCliKeychain());
  const clientFor = (readToken: (() => string | undefined) | undefined): GitHubClient =>
    deps.clientFor !== undefined
      ? deps.clientFor(readToken, keychain())
      : createGitHubClient(readToken !== undefined ? { readToken } : { keychain: keychain() });

  // One call at a time: a set, disconnect or refresh waits for the one before it to settle.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive(fn: () => Promise<ConnectorOutcome>): Promise<ConnectorOutcome> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  /** Any throw from `fn` (a store failure, a bug) answers a fixed failure: no message of it is kept. */
  async function guarded(store: Store, fn: () => Promise<ConnectorOutcome>): Promise<ConnectorOutcome> {
    try {
      return await fn();
    } catch {
      let row: ConnectorRow | undefined;
      try {
        row = githubConnectorRow(store);
      } catch {
        row = undefined;
      }
      return failure("connector_failed", MESSAGES.connector_failed, row);
    }
  }

  function failure(error: ConnectorErrorCode, message: string, row: ConnectorRow | undefined, extra: Partial<ConnectorFailure> = {}): ConnectorFailure {
    return { ok: false, error, message, connector: row === undefined ? null : connectorView(row), ...extra };
  }

  /**
   * A refusal of the token offered: nothing is written to the Keychain. With
   * a token in use the row is unchanged; otherwise it reads `rejected` (made
   * when there is none). One `connector_status` event either way.
   */
  function refuse(store: Store, code: GitHubTokenRefusal, message: string, at: string, extra: Partial<ConnectorFailure> = {}): ConnectorFailure {
    const row = store.transaction(() => {
      let r = ensureRow(store, "rejected", at);
      if (!TOKEN_IN_USE.includes(r.status) && r.status !== "rejected") {
        store.prepare("UPDATE connectors SET status = 'rejected', updated_at = ? WHERE id = ?").run(at, r.id);
        r = githubConnectorRow(store) as ConnectorRow;
      }
      statusEvent(store, r, at, code);
      return r;
    });
    return failure(code, message, row, extra);
  }

  /** A GitHub failure while validating: a 401 refuses the token; anything else changes nothing. */
  function githubFailure(store: Store, res: GitHubFailure, at: string, refuseOn401: boolean): ConnectorFailure {
    if (res.error === "rate_limited") {
      return failure("rate_limited", `GitHub's rate limit is spent until ${res.resets_at}; nothing changed`, githubConnectorRow(store), { resets_at: res.resets_at });
    }
    if (res.error === "http_error") {
      if (res.status === 401) {
        return refuseOn401 ? refuse(store, "token_invalid", MESSAGES.token_invalid, at) : failure("token_invalid", MESSAGES.token_invalid, githubConnectorRow(store));
      }
      return failure("github_error", `GitHub answered HTTP ${res.status}; nothing changed`, githubConnectorRow(store), { github_status: res.status });
    }
    return failure("github_unreachable", MESSAGES.github_unreachable, githubConnectorRow(store));
  }

  async function setToken(store: Store, token: string, now: () => Date, opts: SetTokenOptions): Promise<ConnectorOutcome> {
    if (!isGitHubTokenShape(token)) return refuse(store, "token_invalid", MESSAGES.token_shape, now().toISOString());

    // 1. Validate, writing nothing: the candidate is the client's only token source.
    const candidate = clientFor(() => token);
    const info = await candidate.getTokenInfo();
    if (!info.ok) return githubFailure(store, info, now().toISOString(), true);
    const permissions = info.data.permissions;
    // The write check runs first, on whatever GitHub reported: a declaration
    // never overrides a reported write permission. Only when GitHub reported
    // nothing does the owner's declaration matter.
    const reported = permissions !== null && Object.keys(permissions).length > 0;
    if (reported) {
      const writes = writePermissionsOf(permissions);
      if (writes.length > 0) {
        return refuse(store, "token_write_scoped", writeScopedMessage(writes), now().toISOString(), { write_permissions: writes });
      }
    } else if (opts.declaredReadOnly !== true) {
      return refuse(store, "token_permissions_unknown", MESSAGES.token_permissions_unknown, now().toISOString());
    }
    const source: ConnectorPermissionsSource = reported ? "reported" : "declared";
    const repos = await candidate.listReachableRepos();
    if (!repos.ok) return githubFailure(store, repos, now().toISOString(), true);

    // 2. Swap: delete the old item (none is fine), add the new one (never an
    // overwrite), and trust only the read-back (`security -i` can exit 0 on failure).
    try {
      (deleter ??= securityCliKeychainDeleter()).delete(GITHUB_KEYCHAIN_SERVICE);
    } catch {
      return failure("keychain_failed", MESSAGES.keychain_failed, githubConnectorRow(store));
    }
    try {
      (writer ??= securityCliKeychainWriter()).add(GITHUB_KEYCHAIN_SERVICE, GITHUB_KEYCHAIN_ACCOUNT, token);
    } catch {
      // The read-back below decides.
    }
    let stored: string | undefined;
    try {
      stored = keychain().read(GITHUB_KEYCHAIN_SERVICE);
    } catch {
      stored = undefined;
    }
    const at = now().toISOString();
    if (stored !== token) {
      // The old token is gone and the new one is not in place: never `connected`.
      const row = store.transaction(() => setStatus(store, "disconnected", at));
      return failure("keychain_failed", MESSAGES.keychain_lost, row);
    }

    // 3. The row: what was verified (or declared by the owner), then one event.
    const row = store.transaction(() => {
      const r = ensureRow(store, "connected", at);
      store
        .prepare(
          `UPDATE connectors SET status = 'connected', account_login = ?, permissions_json = ?, reachable_repos_json = ?,
             expires_at = ?, verified_at = ?, permissions_source = ?, permissions_declared_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          info.data.login,
          reported ? JSON.stringify(permissions) : null,
          JSON.stringify(repos.data.map((r2) => r2.full_name)),
          info.data.expires_at,
          at,
          source,
          source === "declared" ? at : null,
          at,
          r.id,
        );
      const updated = githubConnectorRow(store) as ConnectorRow;
      statusEvent(store, updated, at, undefined, source);
      return updated;
    });
    return { ok: true, connector: connectorView(row) };
  }

  async function disconnect(store: Store, now: () => Date): Promise<ConnectorOutcome> {
    try {
      // `false` (exit status 44) is "already gone": the same outcome.
      (deleter ??= securityCliKeychainDeleter()).delete(GITHUB_KEYCHAIN_SERVICE);
    } catch {
      return failure("keychain_failed", MESSAGES.keychain_failed, githubConnectorRow(store));
    }
    const at = now().toISOString();
    const row = store.transaction(() => {
      const r = githubConnectorRow(store);
      return r === undefined ? undefined : changeStatus(store, r, "disconnected", at);
    });
    if (row === undefined) return failure("no_connector", MESSAGES.no_connector, undefined);
    return { ok: true, connector: connectorView(row) };
  }

  async function refreshRepos(store: Store, now: () => Date): Promise<ConnectorOutcome> {
    const before = githubConnectorRow(store);
    if (before === undefined) return failure("no_connector", MESSAGES.no_connector, undefined);
    if (!TOKEN_IN_USE.includes(before.status)) return failure("not_connected", MESSAGES.not_connected, before);
    let present: boolean;
    try {
      present = keychain().read(GITHUB_KEYCHAIN_SERVICE) !== undefined;
    } catch {
      present = false;
    }
    if (!present) return failure("keychain_failed", MESSAGES.keychain_missing, before);
    // The client reads the Keychain item itself, fresh on each call.
    const repos = await clientFor(undefined).listReachableRepos();
    if (!repos.ok) return githubFailure(store, repos, now().toISOString(), false);
    const at = now().toISOString();
    const row = store.transaction(() => {
      store
        .prepare("UPDATE connectors SET reachable_repos_json = ?, verified_at = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(repos.data.map((r) => r.full_name)), at, at, before.id);
      return githubConnectorRow(store) as ConnectorRow;
    });
    return { ok: true, connector: connectorView(row) };
  }

  return {
    setToken: (store, token, now, opts = {}) => exclusive(() => guarded(store, () => setToken(store, token, now, opts))),
    disconnect: (store, now) => exclusive(() => guarded(store, () => disconnect(store, now))),
    refreshRepos: (store, now) => exclusive(() => guarded(store, () => refreshRepos(store, now))),
  };
}

// ---- Expiry ------------------------------------------------------------------------

/**
 * Whether the warning at `days` (or a nearer one) was already recorded for
 * the token expiring at `expiresAt`. A token's identity here is its expiry:
 * the notification's body names it, so a replaced token (a new expiry) is
 * warned afresh and the same token is never warned twice.
 */
function alreadyNotified(store: Store, days: number, expiresAt: string): boolean {
  const sources = GITHUB_EXPIRY_NOTICE_DAYS.filter((d) => d <= days).map(githubExpiryNoticeSource);
  const marks = sources.map(() => "?").join(", ");
  return (
    store
      .prepare<string[], number>(`SELECT 1 FROM notifications WHERE source IN (${marks}) AND instr(body, ?) > 0 LIMIT 1`)
      .pluck()
      .get(...sources, expiryMark(expiresAt)) !== undefined
  );
}

function expiryMark(expiresAt: string): string {
  return `(expires ${expiresAt})`;
}

/**
 * The expiry check, run as due work on every loop tick. For the GitHub row
 * with a token in use and a known `expires_at`:
 *   - past `expires_at`: the status becomes `expired` (one event);
 *   - within a `GITHUB_EXPIRY_NOTICE_DAYS` threshold: `connected` becomes
 *     `expiring` (one event), and the nearest threshold crossed is notified
 *     through `recordNotification` once per token (a nearer one already sent
 *     covers a farther one).
 * Reads and writes the store only: never the Keychain or GitHub.
 */
export function checkGitHubExpiry(store: Store, now: Date): void {
  const at = now.getTime();
  if (!Number.isFinite(at)) return;
  const row = githubConnectorRow(store);
  if (row === undefined || !TOKEN_IN_USE.includes(row.status) || row.expires_at === null) return;
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires)) return;
  const left = expires - at;
  const iso = now.toISOString();
  if (left <= 0) {
    store.transaction(() => changeStatus(store, row, "expired", iso));
    return;
  }
  const crossed = GITHUB_EXPIRY_NOTICE_DAYS.filter((d) => left <= d * DAY_MS);
  if (crossed.length === 0) return;
  const nearest = Math.min(...crossed);
  const expiresAt = row.expires_at;
  store.transaction(() => {
    changeStatus(store, row, "expiring", iso);
    if (alreadyNotified(store, nearest, expiresAt)) return;
    const days = Math.ceil(left / DAY_MS);
    recordNotification(
      store,
      {
        source: githubExpiryNoticeSource(nearest),
        title: `GitHub token expires in ${days} ${days === 1 ? "day" : "days"}`,
        body: `The GitHub token in the Keychain item ${GITHUB_KEYCHAIN_SERVICE} expires soon ${expiryMark(expiresAt)}. Create a new fine-grained, read-only token and replace it in Integrations, or with studio connectors github set.`,
      },
      now,
    );
  });
}

/** The expiry check as due work, on the loop's clock. */
export const githubExpiryDueWork: DueWorkFn = (ctx) => checkGitHubExpiry(ctx.store, ctx.now());

// ---- The part --------------------------------------------------------------------

/** The shipped connector: real Keychain and GitHub, each resolved only when a route runs. */
export const githubConnector: GitHubConnector = createGitHubConnector();

export const githubConnectorPart: IntegrationsPart = Object.freeze({
  name: "github-connector",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  subcommands: Object.freeze([connectorsSubcommand()]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([githubExpiryDueWork]),
});
