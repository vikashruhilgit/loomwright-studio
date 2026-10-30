// The `integrations` feature's GitHub connector part (phase 6, item 03): set,
// replace and disconnect the token, re-read the repos it reaches, its expiry
// check and the App mint check (two due works), the `connectors` row, and the `studio connectors` CLI verb.
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
// The row also knows the GitHub App method (D36): `method` is `token` (the PAT
// above) or `app` (an installation token minted from the App's key; the port in
// `app-port.ts` writes that row, `app-token.ts` holds the token in memory only).
// One credential is current at a time, and the Keychain decides it per call: the
// PAT item present means `token`, otherwise the App's items present means `app`
// (`resolveGitHubTokenProvider`). Every writer keeps the row's `method` in step:
// a set writes `method = 'token'` and deletes the App's items (the row keeps
// the App's slug and installation id only while one of them could not be
// deleted, so `removeApp` can still find it), the App's installation deletes
// the PAT item, and a disconnect deletes every GitHub credential item. An
// `app` row raises no expiry warning (the installation token renews silently
// every hour); a mint that GitHub answers 401 or 404 makes the row read
// `rejected`, with one notification (`checkGitHubAppMint`).
//
// The connector and the App port change the same Keychain items, row columns
// and token holder, so both run on one queue (`credential-lock.ts`): a token
// set never interleaves with an App installation or removal.
//
// Mechanism only (invariant 1): the kernel checks, stores and warns. The
// warning thresholds (`GITHUB_EXPIRY_NOTICE_DAYS`) are the safety kernel's,
// fixed, like the read-only rule (invariant 3).
//
// The `studio` CLI loads it, so it imports only types, the feature seam, the
// Keychain module, the client, the credential lock, the store helpers and its
// CLI verb: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { WRITE_ARG, securityCliKeychain, securityCliKeychainDeleter, securityCliKeychainWriter } from "../../auth/keychain.js";
import type { KeychainDeleter, KeychainReader, KeychainWriter } from "../../auth/keychain.js";
import type { DueWorkFn } from "../../features/contribution.js";
import { appendEvent } from "../../loop/internal.js";
import { recordNotification } from "../../notifications/record.js";
import type { Store } from "../../store/store.js";
import { connectorsSubcommand } from "../cli.js";
import { CONNECTOR_METHODS, CONNECTOR_PERMISSIONS_SOURCES } from "../types.js";
import type {
  ConnectorKind,
  ConnectorMethod,
  ConnectorPermissionsSource,
  ConnectorRow,
  ConnectorStatus,
  GitHubClient,
  GitHubFailure,
  IntegrationsPart,
} from "../types.js";
import {
  GITHUB_APP_ID_SERVICE,
  GITHUB_APP_INSTALLATION_SERVICE,
  GITHUB_APP_KEY_SERVICE,
  GITHUB_APP_SLUG_SERVICE,
  READ_ONLY_LEVELS,
  createGitHubAppTokens,
  githubAppTokens,
  writePermissionsOf,
} from "./app-token.js";
import type { GitHubAppTokens, WritePermission } from "./app-token.js";
import { GITHUB_KEYCHAIN_SERVICE, createGitHubClient, resolveGitHubTokenProvider } from "./client.js";
import type { GitHubClientDeps } from "./client.js";
import { githubCredentialLock } from "./credential-lock.js";
import type { GitHubCredentialLock } from "./credential-lock.js";

/** The connector kind this file owns. */
export const GITHUB_KIND: ConnectorKind = "github";

/** The Keychain item's account label: a fixed constant, never the GitHub login or the OS user name. */
export const GITHUB_KEYCHAIN_ACCOUNT = "loomwright-studio";

/** A notification's source when the App's credentials are rejected: `kernel:<reason>`, once, on the transition into `rejected`. */
export const GITHUB_APP_REJECTED_SOURCE = "kernel:github_app_rejected";

/** The App's four Keychain items (`app-token.ts`): its id, slug, installation id and key. */
export const GITHUB_APP_SERVICES: readonly string[] = Object.freeze([
  GITHUB_APP_ID_SERVICE,
  GITHUB_APP_SLUG_SERVICE,
  GITHUB_APP_INSTALLATION_SERVICE,
  GITHUB_APP_KEY_SERVICE,
]);

/** Every GitHub credential item: the PAT's, then the App's. A disconnect deletes all of them, whichever method is current. */
export const GITHUB_CREDENTIAL_SERVICES: readonly string[] = Object.freeze([GITHUB_KEYCHAIN_SERVICE, ...GITHUB_APP_SERVICES]);

/** Days before `expires_at` the owner is notified, once each per token: the safety kernel's, fixed. */
export const GITHUB_EXPIRY_NOTICE_DAYS: readonly number[] = Object.freeze([14, 1]);

/** A notification's source for the warning at `days` days: `kernel:<reason>`. */
export function githubExpiryNoticeSource(days: number): string {
  return `kernel:github_token_expiring_${days}d`;
}

// `READ_ONLY_LEVELS`, `WritePermission` and `writePermissionsOf` live in `app-token.ts`
// (the holder checks every mint's permissions); they are re-exported below.
export { READ_ONLY_LEVELS, writePermissionsOf };
export type { WritePermission };

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

/** The statuses whose credential is in use: a refusal leaves them unchanged, and `?refresh=1` reads with it. */
const TOKEN_IN_USE: readonly ConnectorStatus[] = ["connected", "expiring"];

/** Whether a row in `status` has a credential in use (`connected` or `expiring`). */
export function isCredentialInUse(status: ConnectorStatus): boolean {
  return TOKEN_IN_USE.includes(status);
}

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
  /** How it is connected: `token` or `app`; a row from before migration 19 reads `token`. */
  readonly method?: ConnectorMethod | undefined;
  /** The App's slug, for `method: app`; `null` otherwise. Not secret. */
  readonly app_slug: string | null;
  /** The App installation's id, for `method: app`; `null` otherwise. Not secret. */
  readonly installation_id: number | null;
  readonly created_at: string;
  readonly updated_at: string;
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
  /** The App's installation-token holder. Default: `githubAppTokens`, the process-wide one. */
  readonly tokens?: GitHubAppTokens;
  /**
   * A client over `readToken` (a candidate being validated), or, when
   * `readToken` is `undefined`, over the credential in use (the PAT item, else
   * the App's installation token). Default: `createGitHubClient`, over the
   * method rule.
   */
  readonly clientFor?: (readToken: (() => string | undefined) | undefined, keychain: KeychainReader) => GitHubClient;
  /** The queue every call runs on. Default: `githubCredentialLock`, the one the App port shares. */
  readonly lock?: GitHubCredentialLock;
}

/** What `setToken` is told beside the token. */
export interface SetTokenOptions {
  /** The owner declares that every permission they gave this token is Read. Only `true` declares; used only when GitHub reports no permissions. */
  readonly declaredReadOnly?: boolean;
}

/**
 * The GitHub connector's calls. They run one at a time on the queue the App
 * port shares (`githubCredentialLock` by default), so no two credential
 * changes (set, disconnect, refresh, or the App's store, installation or
 * removal) interleave their Keychain or row steps.
 */
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
  "id, kind, status, account_login, permissions_json, reachable_repos_json, expires_at, verified_at, permissions_source, permissions_declared_at, method, app_slug, installation_id, created_at, updated_at";

/** A `connectors` row as SQLite returns it: `method` is null for a row from before migration 19 (never backfilled). */
type StoredRow = Omit<ConnectorRow, "method"> & { readonly method: string | null };

/** The read boundary: a null (or unknown) method is read as `token`, so nothing downstream sees a missing one. */
function rowOf(stored: StoredRow): ConnectorRow {
  return { ...stored, method: CONNECTOR_METHODS.find((m) => m === stored.method) ?? "token" };
}

/** Every `connectors` row, by id. */
export function listConnectorRows(store: Store): ConnectorRow[] {
  return store.prepare<[], StoredRow>(`SELECT ${COLUMNS} FROM connectors ORDER BY id`).all().map(rowOf);
}

/** The GitHub connector's row (the oldest, if there were ever two), or `undefined`. */
export function githubConnectorRow(store: Store): ConnectorRow | undefined {
  const stored = store.prepare<[string], StoredRow>(`SELECT ${COLUMNS} FROM connectors WHERE kind = ? ORDER BY id LIMIT 1`).get(GITHUB_KIND);
  return stored === undefined ? undefined : rowOf(stored);
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
    method: row.method,
    app_slug: row.app_slug ?? null,
    installation_id: row.installation_id ?? null,
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
export function statusEvent(store: Store, row: ConnectorRow, at: string, refused?: GitHubTokenRefusal, permissionsSource?: ConnectorPermissionsSource): void {
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
export function ensureRow(store: Store, status: ConnectorStatus, at: string): ConnectorRow {
  const existing = githubConnectorRow(store);
  if (existing !== undefined) return existing;
  store.prepare("INSERT INTO connectors (kind, status, created_at, updated_at) VALUES (?, ?, ?, ?)").run(GITHUB_KIND, status, at, at);
  return githubConnectorRow(store) as ConnectorRow;
}

/** Sets the row's status (and `updated_at`) and appends its event, only when the status changes. */
export function changeStatus(store: Store, row: ConnectorRow, status: ConnectorStatus, at: string): ConnectorRow {
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
export function setStatus(store: Store, status: ConnectorStatus, at: string): ConnectorRow {
  const existing = githubConnectorRow(store);
  if (existing !== undefined) return changeStatus(store, existing, status, at);
  const created = ensureRow(store, status, at);
  statusEvent(store, created, at);
  return created;
}

// ---- The client over the method rule --------------------------------------------------

/**
 * A GitHub client over the per-call method rule (`resolveGitHubTokenProvider`):
 * the PAT item when present, otherwise the App's installation token. Built over
 * `deps` it reads nothing and requests nothing until a method is called. With
 * no injected Keychain or `fetch` it shares the process-wide holder
 * (`githubAppTokens`), so polls, tools and routes use one installation token; a
 * client built over injected deps gets a holder of its own over the same deps
 * (so it never touches the real Keychain). An explicit `readToken` or
 * `tokenProvider` in `deps` wins, as it does for `createGitHubClient`.
 */
export function createResolvingGitHubClient(deps: GitHubClientDeps = {}, tokens?: GitHubAppTokens): GitHubClient {
  if (deps.readToken !== undefined || deps.tokenProvider !== undefined) return createGitHubClient(deps);
  const keychain = deps.keychain ?? securityCliKeychain();
  const holder =
    tokens ??
    (deps.keychain === undefined && deps.fetch === undefined
      ? githubAppTokens
      : createGitHubAppTokens({
          keychain,
          ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
          ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
          ...(deps.maxBodyBytes !== undefined ? { maxBodyBytes: deps.maxBodyBytes } : {}),
          ...(deps.now !== undefined ? { now: deps.now } : {}),
        }));
  return createGitHubClient({ ...deps, keychain, tokenProvider: resolveGitHubTokenProvider(keychain, holder) });
}

// ---- Validation -------------------------------------------------------------------

/** Whether `token` has a token's shape: what the Keychain writer and the client accept. */
export function isGitHubTokenShape(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token.length <= MAX_GITHUB_TOKEN_LENGTH && WRITE_ARG.test(token);
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
  keychain_failed: `a GitHub credential in the Keychain (the item "${GITHUB_KEYCHAIN_SERVICE}" or the GitHub App's) could not be changed; nothing else changed`,
  keychain_lost: `the Keychain item "${GITHUB_KEYCHAIN_SERVICE}" did not hold the new token after it was added, and the old one was already deleted: the connector is disconnected; set the token again`,
  keychain_missing: `the Keychain item "${GITHUB_KEYCHAIN_SERVICE}" (or the GitHub App's) is missing or unreadable: set the token again`,
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
  const tokens = deps.tokens ?? githubAppTokens;
  const keychain = (): KeychainReader => (reader ??= securityCliKeychain());
  const clientFor = (readToken: (() => string | undefined) | undefined): GitHubClient =>
    deps.clientFor !== undefined
      ? deps.clientFor(readToken, keychain())
      : readToken !== undefined
        ? createGitHubClient({ readToken })
        : createResolvingGitHubClient({ keychain: keychain() }, tokens);

  // One call at a time, on the queue the App port shares (`credential-lock.ts`): a set,
  // disconnect or refresh waits for any connector or App port call before it to settle.
  const lock = deps.lock ?? githubCredentialLock;
  function exclusive(fn: () => Promise<ConnectorOutcome>): Promise<ConnectorOutcome> {
    return lock.run(fn);
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

    // 3. The token replaces any App connection: the App's items go (each tried
    // even after one fails, as a disconnect does) and the held token with them.
    // The set stands either way, since the PAT item is current; but only when
    // every App item is gone does the row forget the App, so a later
    // `removeApp` can still find what was left.
    let appDropped = true;
    for (const service of GITHUB_APP_SERVICES) {
      try {
        // `false` (exit status 44) is "already gone": the same outcome.
        (deleter ??= securityCliKeychainDeleter()).delete(service);
      } catch {
        appDropped = false;
      }
    }
    tokens.invalidate();

    // 4. The row: what was verified (or declared by the owner), then one event.
    const row = store.transaction(() => {
      const r = ensureRow(store, "connected", at);
      store
        .prepare(
          `UPDATE connectors SET status = 'connected', account_login = ?, permissions_json = ?, reachable_repos_json = ?,
             expires_at = ?, verified_at = ?, permissions_source = ?, permissions_declared_at = ?,
             method = 'token', app_slug = CASE WHEN ? THEN NULL ELSE app_slug END,
             installation_id = CASE WHEN ? THEN NULL ELSE installation_id END, updated_at = ? WHERE id = ?`,
        )
        .run(
          info.data.login,
          reported ? JSON.stringify(permissions) : null,
          JSON.stringify(repos.data.map((r2) => r2.full_name)),
          info.data.expires_at,
          at,
          source,
          source === "declared" ? at : null,
          appDropped ? 1 : 0,
          appDropped ? 1 : 0,
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
    // Every GitHub credential item, whichever method is current. Each is tried
    // even after one fails, so a failure leaves as little behind as it can.
    let failed = false;
    for (const service of GITHUB_CREDENTIAL_SERVICES) {
      try {
        // `false` (exit status 44) is "already gone": the same outcome.
        (deleter ??= securityCliKeychainDeleter()).delete(service);
      } catch {
        failed = true;
      }
    }
    tokens.invalidate();
    if (failed) return failure("keychain_failed", MESSAGES.keychain_failed, githubConnectorRow(store));
    const at = now().toISOString();
    const row = store.transaction(() => {
      const r = githubConnectorRow(store);
      if (r === undefined) return undefined;
      store.prepare("UPDATE connectors SET app_slug = NULL, installation_id = NULL WHERE id = ?").run(r.id);
      return changeStatus(store, githubConnectorRow(store) as ConnectorRow, "disconnected", at);
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
      present = keychain().read(GITHUB_KEYCHAIN_SERVICE) !== undefined || tokens.configured();
    } catch {
      present = false;
    }
    if (!present) return failure("keychain_failed", MESSAGES.keychain_missing, before);
    // The client resolves the credential itself, fresh on each call: the PAT item, else the App's token.
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
 * A `method: app` row is skipped (its installation token renews itself).
 * Reads and writes the store only: never the Keychain or GitHub.
 */
export function checkGitHubExpiry(store: Store, now: Date): void {
  const at = now.getTime();
  if (!Number.isFinite(at)) return;
  const row = githubConnectorRow(store);
  if (row === undefined || !TOKEN_IN_USE.includes(row.status) || row.expires_at === null) return;
  // An installation token renews silently every hour: its expiry is never owner-actionable.
  if (row.method === "app") return;
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

// ---- A rejected App ------------------------------------------------------------------

/**
 * Applies a mint failure the holder recorded (`lastMintFailure`: GitHub answered
 * 401, the App's key is revoked, or 404, the installation is gone, or a renewed
 * token reports a write permission) to the row. A
 * `method: app` row in use becomes `rejected` (one `connector_status` event)
 * and the owner is notified once (`GITHUB_APP_REJECTED_SOURCE`), on that
 * transition only: a row already `rejected` or `disconnected`, or one that is
 * not `app`, is left as it is. The failure is cleared whether or not it applied,
 * so it is acted on once. Reads and writes the store only.
 */
export function applyGitHubAppMintFailure(store: Store, now: Date, tokens: GitHubAppTokens = githubAppTokens): void {
  const failure = tokens.lastMintFailure;
  if (failure === undefined) return;
  const at = now.toISOString();
  store.transaction(() => {
    const row = githubConnectorRow(store);
    tokens.clearMintFailure();
    if (row === undefined || row.method !== "app" || !TOKEN_IN_USE.includes(row.status)) return;
    changeStatus(store, row, "rejected", at);
    recordNotification(
      store,
      {
        source: GITHUB_APP_REJECTED_SOURCE,
        title: "GitHub no longer accepts Studio's GitHub App",
        body:
          "status" in failure
            ? `GitHub refused to give Studio an access token for its GitHub App (HTTP ${failure.status}): the App's key was revoked, or the App was uninstalled. Studio cannot read GitHub until you set the App up again in Integrations.`
            : `GitHub's access token for Studio's GitHub App can now write (${failure.write_permissions.map((w) => `${w.permission}: ${w.level}`).join("; ")}), and Studio only reads. Studio refused the token. Set each of these App permissions back to read-only on GitHub, then set the App up again in Integrations.`,
      },
      now,
    );
  });
}

/** The mint-failure check as due work, on the loop's clock, over the process-wide holder. */
export const checkGitHubAppMint: DueWorkFn = (ctx) => applyGitHubAppMintFailure(ctx.store, ctx.now());

// ---- The part --------------------------------------------------------------------

/** The shipped connector: real Keychain and GitHub, each resolved only when a route runs. */
export const githubConnector: GitHubConnector = createGitHubConnector();

export const githubConnectorPart: IntegrationsPart = Object.freeze({
  name: "github-connector",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  subcommands: Object.freeze([connectorsSubcommand()]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([
    githubExpiryDueWork,
    checkGitHubAppMint,
  ]),
});
