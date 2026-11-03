// The GitHub App connect's port (D36, D39): stores the converted App's credentials,
// records its installation (minting the first installation token and recording
// what GitHub reports for it: the row reads `needs_permissions` until that is
// the whole `GITHUB_APP_PERMISSIONS`), and removes the App. The setup flow
// (GitHub App 3) calls it with what GitHub's manifest conversion returned.
// `mintSessionToken` is the one other export: a down-scoped, one-hour token for a
// session, never held, stored or logged here.
// Never throws or rejects, whatever it is given: every method resolves a typed result.
//
// Where each secret lives (`app-token.ts` has the full account):
//   - the App's id, slug and key, and the installation's id, are four Keychain
//     items; the key is stored as unpadded base64url (`encodeAppKey`) so it fits
//     the Keychain writer. Every write is replace-by-delete-then-add and is
//     trusted only after a read-back that matches (`security -i` can exit 0 on a
//     failure);
//   - the installation token lives in the holder's memory only;
//   - the store holds the App's slug, its installation id and what GitHub
//     reported (permissions, repos): never the `pem`, a JWT or a token.
// `client_secret` is not a parameter anywhere; a failure's message is a fixed
// sentence, so no caught error's text, and no secret, reaches a result.
//
// One credential is current at a time (the PAT item first, else the App's
// items: `resolveGitHubTokenProvider`). `recordInstallation` makes the App
// current by deleting the PAT item as its last step; a refusal leaves a PAT in
// use exactly as it was.
//
// The port and the token connector change the same Keychain items, row columns
// and token holder, so their calls share one queue (`credential-lock.ts`): an
// App installation never interleaves with a token set.
//
// The `studio` CLI loads it, so it imports only types: never the Agent SDK, the
// session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph), only the connector, the token holder, the client,
// the credential lock and the Keychain module.
import { WRITE_ARG, securityCliKeychain, securityCliKeychainDeleter, securityCliKeychainWriter } from "../../auth/keychain.js";
import type { KeychainDeleter, KeychainReader, KeychainWriter } from "../../auth/keychain.js";
import type { Store } from "../../store/store.js";
import type { ConnectorRow, GitHubAppConversion, GitHubAppPort, GitHubAppPortError, GitHubAppPortResult, GitHubClient } from "../types.js";
import {
  GITHUB_APP_ID_SERVICE,
  GITHUB_APP_INSTALLATION_SERVICE,
  GITHUB_APP_KEY_SERVICE,
  GITHUB_APP_PERMISSIONS,
  GITHUB_APP_SLUG_SERVICE,
  SESSION_TOKEN_PERMISSIONS,
  encodeAppKey,
  createGitHubAppTokens,
  githubAppTokens,
  holdsPermissions,
} from "./app-token.js";
import type { GitHubAppTokenError, GitHubAppTokens } from "./app-token.js";
import { GITHUB_KEYCHAIN_SERVICE, createGitHubClient } from "./client.js";
import type { GitHubTokenProvider, GitHubTokenProviderResolver } from "./client.js";
import { githubCredentialLock } from "./credential-lock.js";
import type { GitHubCredentialLock } from "./credential-lock.js";
import {
  GITHUB_APP_SERVICES,
  GITHUB_KEYCHAIN_ACCOUNT,
  changeStatus,
  connectorView,
  ensureRow,
  githubConnectorRow,
  isCredentialInUse,
  statusEvent,
} from "./connector.js";

/** What the port reads, writes and calls. Every default resolves only when a call needs it, so building the shipped port touches nothing. */
export interface GitHubAppPortDeps {
  /** Default: `securityCliKeychain()`. */
  readonly keychain?: KeychainReader;
  /** Default: `securityCliKeychainWriter()`. */
  readonly writer?: KeychainWriter;
  /** Default: `securityCliKeychainDeleter()`. */
  readonly deleter?: KeychainDeleter;
  /** The installation-token holder. Default: `githubAppTokens`, the process-wide one (it reads the real Keychain on its own); with `keychain` given, a holder over that reader. */
  readonly tokens?: GitHubAppTokens;
  /** The client the installed repos are read through, over the credential `tokenProvider` picks. Default: `createGitHubClient`. */
  readonly clientFor?: (tokenProvider: GitHubTokenProviderResolver) => GitHubClient;
  /** The queue every call runs on. Default: `githubCredentialLock`, the one the token connector shares. */
  readonly lock?: GitHubCredentialLock;
}

/** The largest App or installation id stored: what the holder reads back (`app-token.ts`, `NUMERIC_ID`). */
const MAX_ID = 999_999_999_999_999;

/** The longest App slug stored: GitHub's own limit is far below it. */
const MAX_SLUG_LENGTH = 100;

const MESSAGES = {
  bad_conversion: "GitHub's conversion did not give a usable App id and slug; nothing was stored",
  bad_key: "the App's private key is not a PEM (-----BEGIN ...); nothing was stored",
  store_keychain: "the Keychain could not hold the GitHub App's credentials; they were removed",
  bad_installation: "the installation id is not a positive whole number",
  no_app: "no GitHub App is stored: create the App first",
  install_keychain: "the Keychain could not hold the installation id; it was removed",
  mint_credentials: "the stored GitHub App credentials are missing or unreadable, so no installation token could be minted",
  mint_rejected: "GitHub did not accept the App's key, or does not know this installation, so no installation token could be minted",
  mint_unreachable: "GitHub could not be reached, or answered something unreadable, so no installation token could be minted",
  no_permissions: "GitHub reported no permissions for the installation token, so Studio cannot tell which ones the App holds",
  reach_failed: "GitHub did not list the installation's repositories",
  pat_kept: "the token connection could not be replaced: its Keychain item is still there, so the token stays in use",
  remove_keychain: "the GitHub App's Keychain items could not all be deleted",
  failed_store: "the GitHub App could not be stored",
  failed_install: "the GitHub App's installation could not be recorded",
  failed_remove: "the GitHub App could not be removed",
} as const;

function fail(error: GitHubAppPortError, message: string): GitHubAppPortResult<never> {
  return { ok: false, error, message };
}

/** A positive whole number that fits the holder's id shape. */
function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_ID;
}

/** The credential provider for the App alone, whatever else is in the Keychain: renewal drops the held token and mints another. */
function appProvider(tokens: GitHubAppTokens): GitHubTokenProvider {
  const token = async (): Promise<string | undefined> => {
    const res = await tokens.current();
    return res.ok ? res.token : undefined;
  };
  return {
    method: "app",
    token,
    renew: () => {
      tokens.invalidate();
      return token();
    },
  };
}

/** The account that owns `repos` (the part before the `/` of the first), or `null` when none is listed. */
function accountOf(repos: readonly { readonly full_name: string }[]): string | null {
  const first = repos[0]?.full_name;
  const owner = first === undefined ? "" : first.split("/")[0] ?? "";
  return owner === "" ? null : owner;
}

/**
 * The installation-token holder for `deps`: an injected one, else (with an injected Keychain) a holder
 * of its own over that reader, since the process-wide one reads the real Keychain, else the process-wide one.
 */
function holderOf(deps: GitHubAppPortDeps): GitHubAppTokens {
  return deps.tokens ?? (deps.keychain !== undefined ? createGitHubAppTokens({ keychain: deps.keychain }) : githubAppTokens);
}

/** Builds the port over `deps`. Nothing is read, written or called until a method runs. */
export function createGitHubAppPort(deps: GitHubAppPortDeps = {}): GitHubAppPort {
  let reader: KeychainReader | undefined = deps.keychain;
  let writer: KeychainWriter | undefined = deps.writer;
  let deleter: KeychainDeleter | undefined = deps.deleter;
  // An injected Keychain gets its own holder (as `createResolvingGitHubClient` does): the
  // process-wide one reads the real Keychain, which a caller that injected one never meant.
  const tokens = holderOf(deps);
  const keychain = (): KeychainReader => (reader ??= securityCliKeychain());
  const clientFor = deps.clientFor ?? ((tokenProvider: GitHubTokenProviderResolver): GitHubClient => createGitHubClient({ tokenProvider }));

  // One call at a time, on the queue the token connector shares (`credential-lock.ts`): a store,
  // installation or removal waits for any App port or connector call before it to settle.
  const lock = deps.lock ?? githubCredentialLock;
  function exclusive<T>(fn: () => Promise<GitHubAppPortResult<T>>, failed: GitHubAppPortResult<never>): Promise<GitHubAppPortResult<T>> {
    const guarded = async (): Promise<GitHubAppPortResult<T>> => {
      try {
        return await fn();
      } catch {
        // Whatever threw, its message is dropped: it may carry a secret.
        return failed;
      }
    };
    return lock.run(guarded);
  }

  /** Replaces one item: delete (none is fine), add (never an overwrite), then trust only the read-back. Never throws. */
  function putItem(service: string, secret: string): boolean {
    try {
      (deleter ??= securityCliKeychainDeleter()).delete(service);
    } catch {
      return false;
    }
    try {
      (writer ??= securityCliKeychainWriter()).add(service, GITHUB_KEYCHAIN_ACCOUNT, secret);
    } catch {
      // The read-back below decides.
    }
    try {
      return keychain().read(service) === secret;
    } catch {
      return false;
    }
  }

  /** Deletes each of `services` (every one is tried); `false` when any failed. A missing item is fine. Never throws. */
  function dropItems(services: readonly string[]): boolean {
    let all = true;
    for (const service of services) {
      try {
        (deleter ??= securityCliKeychainDeleter()).delete(service);
      } catch {
        all = false;
      }
    }
    return all;
  }

  /** An App row in use whose credentials were just removed reads `rejected`, never `connected`. Best effort. */
  function markLost(store: Store, at: string): void {
    try {
      store.transaction(() => {
        const row = githubConnectorRow(store);
        if (row !== undefined && row.method === "app" && isCredentialInUse(row.status)) changeStatus(store, row, "rejected", at);
      });
    } catch {
      // The failure being answered is the one to report.
    }
  }

  /** Why no installation token came: the holder's typed failure as a fixed sentence. */
  function mintMessage(res: { readonly error: string; readonly status?: number }): string {
    if (res.error === "no_credentials" || res.error === "keychain_failed" || res.error === "bad_key") return MESSAGES.mint_credentials;
    return res.error === "http_error" && (res.status === 401 || res.status === 404) ? MESSAGES.mint_rejected : MESSAGES.mint_unreachable;
  }

  async function storeApp(store: Store, conversion: GitHubAppConversion, pem: string, now: () => Date): Promise<GitHubAppPortResult<ConnectorRow>> {
    const at = now().toISOString();
    githubConnectorRow(store);
    const appId = conversion.app_id;
    const slug = conversion.slug;
    if (!isId(appId) || typeof slug !== "string" || slug.length > MAX_SLUG_LENGTH || !WRITE_ARG.test(slug)) return fail("conversion_failed", MESSAGES.bad_conversion);
    const encoded = encodeAppKey(pem);
    if (encoded === undefined) return fail("conversion_failed", MESSAGES.bad_key);

    // A new App's key replaces the old one: the held installation token is the old App's.
    tokens.invalidate();
    if (!(putItem(GITHUB_APP_ID_SERVICE, String(appId)) && putItem(GITHUB_APP_SLUG_SERVICE, slug) && putItem(GITHUB_APP_KEY_SERVICE, encoded))) {
      dropItems([GITHUB_APP_ID_SERVICE, GITHUB_APP_SLUG_SERVICE, GITHUB_APP_KEY_SERVICE]);
      markLost(store, at);
      return fail("conversion_failed", MESSAGES.store_keychain);
    }

    // The row records the slug only: method and status stay as they are (a PAT may be in use).
    // One `connector_status` event, with the status unchanged, whether the row is new or
    // existing: it is the setup flow's step-2 signal (the App is stored; install it next).
    // `ensureRow` appends none for an existing row, and none for a new one here, so this is never a second.
    const row = store.transaction(() => {
      const r = ensureRow(store, "disconnected", at);
      store.prepare("UPDATE connectors SET app_slug = ?, updated_at = ? WHERE id = ?").run(slug, at, r.id);
      const updated = githubConnectorRow(store) as ConnectorRow;
      statusEvent(store, updated, at);
      return updated;
    });
    return { ok: true, value: row };
  }

  async function recordInstallation(store: Store, installationId: number, now: () => Date): Promise<GitHubAppPortResult<ConnectorRow>> {
    const at = now().toISOString();
    githubConnectorRow(store);
    if (!isId(installationId)) return fail("install_failed", MESSAGES.bad_installation);
    let slug: string | undefined;
    try {
      slug = keychain().read(GITHUB_APP_SLUG_SERVICE);
    } catch {
      slug = undefined;
    }
    if (slug === undefined || slug === "") return fail("install_failed", MESSAGES.no_app);

    /** The installation did not come through: its item is removed so nothing half-set stays current. */
    const abandon = (message: string): GitHubAppPortResult<never> => {
      dropItems([GITHUB_APP_INSTALLATION_SERVICE]);
      tokens.invalidate();
      markLost(store, at);
      return fail("install_failed", message);
    };

    // 1. The installation id, replaced and read back.
    if (!putItem(GITHUB_APP_INSTALLATION_SERVICE, String(installationId))) return abandon(MESSAGES.install_keychain);

    // 2. The first installation token, minted fresh for this installation.
    tokens.invalidate();
    const minted = await tokens.current();
    if (!minted.ok) return abandon(mintMessage(minted));

    // 3. The permissions are GitHub's word, not ours: what it reports for the token. The App may write (D39), so
    // nothing is refused here; an install short of `GITHUB_APP_PERMISSIONS` is recorded as `needs_permissions` below.
    if (Object.keys(minted.permissions).length === 0) return abandon(MESSAGES.no_permissions);

    // 4. The repos the installation reaches (`GET /installation/repositories`), through the App's token alone.
    const provider = appProvider(tokens);
    const repos = await clientFor(() => provider).listReachableRepos();
    if (!repos.ok) return abandon(MESSAGES.reach_failed);

    // 5. The App replaces the token connection: its Keychain item goes. A PAT left behind would stay current.
    try {
      (deleter ??= securityCliKeychainDeleter()).delete(GITHUB_KEYCHAIN_SERVICE);
    } catch {
      return fail("install_failed", MESSAGES.pat_kept);
    }

    // 6. The row: what GitHub reported, then one event. `connected` when it reports the whole
    // `GITHUB_APP_PERMISSIONS`, else `needs_permissions` (the owner accepts the rest on github.com).
    const status = holdsPermissions(minted.permissions, GITHUB_APP_PERMISSIONS) ? "connected" : "needs_permissions";
    const row = store.transaction(() => {
      const r = ensureRow(store, status, at);
      store
        .prepare(
          `UPDATE connectors SET status = ?, account_login = ?, permissions_json = ?, reachable_repos_json = ?,
             expires_at = ?, verified_at = ?, permissions_source = 'reported', permissions_declared_at = NULL,
             method = 'app', app_slug = ?, installation_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(status, accountOf(repos.data), JSON.stringify(minted.permissions), JSON.stringify(repos.data.map((x) => x.full_name)), minted.expires_at, at, slug, installationId, at, r.id);
      const updated = githubConnectorRow(store) as ConnectorRow;
      statusEvent(store, updated, at, undefined, "reported");
      return updated;
    });
    return { ok: true, value: row };
  }

  async function removeApp(store: Store, now: () => Date): Promise<GitHubAppPortResult<ConnectorRow>> {
    const at = now().toISOString();
    githubConnectorRow(store);
    const dropped = dropItems(GITHUB_APP_SERVICES);
    tokens.invalidate();
    if (!dropped) return fail("install_failed", MESSAGES.remove_keychain);
    const row = store.transaction(() => {
      const existing = githubConnectorRow(store);
      const r = ensureRow(store, "disconnected", at);
      if (existing === undefined) {
        statusEvent(store, r, at);
        return r;
      }
      store.prepare("UPDATE connectors SET app_slug = NULL, installation_id = NULL WHERE id = ?").run(r.id);
      const current = githubConnectorRow(store) as ConnectorRow;
      // A token connection is not the App's to end: only an App row reads `disconnected`.
      return current.method === "app" ? changeStatus(store, current, "disconnected", at) : current;
    });
    return { ok: true, value: row };
  }

  const port: GitHubAppPort = {
    storeApp: (store, conversion, pem, now) => exclusive(() => storeApp(store, conversion, pem, now), fail("conversion_failed", MESSAGES.failed_store)),
    recordInstallation: (store, installationId, now) => exclusive(() => recordInstallation(store, installationId, now), fail("install_failed", MESSAGES.failed_install)),
    removeApp: (store, now) => exclusive(() => removeApp(store, now), fail("install_failed", MESSAGES.failed_remove)),
  };
  return Object.freeze(port);
}

/** The shipped port: real Keychain, GitHub and the process-wide token holder, each resolved only when a method runs. */
export const githubAppPort: GitHubAppPort = Object.freeze(createGitHubAppPort());

// ---- A session's token (D39) ----------------------------------------------------------

/**
 * Why `mintSessionToken` gave no token: `repo_not_reached` (no repo named, a name
 * that is not `owner/name`, an owner other than the installation's account, or a
 * repo the installation does not list), `needs_permissions` (the row does not
 * report every `SESSION_TOKEN_PERMISSIONS` entry at write), or the holder's own
 * failure (`no_credentials` when no App is in use, `http_error` with its status,
 * and so on). A closed set; none carries a message.
 */
export type GitHubSessionTokenError = "repo_not_reached" | "needs_permissions" | GitHubAppTokenError;

/** The answer: a one-hour installation token and its expiry (ISO-8601 UTC), or a typed failure. The token is a secret: use it once, never log or store it. */
export type GitHubSessionTokenResult =
  | { readonly ok: true; readonly token: string; readonly expires_at: string }
  | { readonly ok: false; readonly error: GitHubSessionTokenError; readonly status?: number };

/** `owner/name`, as GitHub spells them: an owner of letters, digits and hyphens, a name of those plus `.` and `_`. */
const FULL_NAME = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

/** The most repos one session token may name. */
const MAX_SESSION_REPOS = 100;

const NOT_REACHED: GitHubSessionTokenResult = Object.freeze({ ok: false, error: "repo_not_reached" });
const NEEDS_PERMISSIONS: GitHubSessionTokenResult = Object.freeze({ ok: false, error: "needs_permissions" });
const NO_APP: GitHubSessionTokenResult = Object.freeze({ ok: false, error: "no_credentials" });

/**
 * Mints a down-scoped installation token for a session: `POST
 * /app/installations/{id}/access_tokens` with `permissions` exactly
 * `SESSION_TOKEN_PERMISSIONS` and `repositories` the named repos' names (GitHub
 * takes no owner there, so every repo must belong to the row's `account_login`).
 * Nothing is sent unless the row is an App in use, every repo is in its reach
 * list (case-insensitive) and it reports every session permission at write. An
 * empty list is refused (a mint with no `repositories` would reach every repo).
 * The token is returned once: never stored, held, logged or put in an event or a
 * row. Runs on the shared credential lock. Never throws or rejects.
 */
export function mintSessionToken(store: Store, repos: readonly string[], deps: GitHubAppPortDeps = {}): Promise<GitHubSessionTokenResult> {
  const lock = deps.lock ?? githubCredentialLock;
  const unreachable: GitHubSessionTokenResult = { ok: false, error: "unreachable" };
  const guarded = async (): Promise<GitHubSessionTokenResult> => {
    try {
      if (!Array.isArray(repos) || repos.length === 0 || repos.length > MAX_SESSION_REPOS) return NOT_REACHED;
      const row = githubConnectorRow(store);
      if (row === undefined || row.method !== "app" || !isCredentialInUse(row.status)) return NO_APP;
      const view = connectorView(row);
      const account = view.account_login?.toLowerCase();
      const reach = new Map((view.reachable_repos ?? []).map((full) => [full.toLowerCase(), full]));
      const names: string[] = [];
      for (const repo of repos as readonly unknown[]) {
        if (typeof repo !== "string") return NOT_REACHED;
        const parts = FULL_NAME.exec(repo);
        if (parts === null) return NOT_REACHED;
        const owner = parts[1] as string;
        const canonical = reach.get(repo.toLowerCase());
        if (account === undefined || owner.toLowerCase() !== account || canonical === undefined) return NOT_REACHED;
        const name = canonical.slice(canonical.indexOf("/") + 1);
        if (!names.includes(name)) names.push(name);
      }
      if (view.permissions === null || !holdsPermissions(view.permissions, SESSION_TOKEN_PERMISSIONS)) return NEEDS_PERMISSIONS;
      const res = await holderOf(deps).mintScoped({ repositories: names, permissions: SESSION_TOKEN_PERMISSIONS });
      return res.ok ? { ok: true, token: res.token, expires_at: res.expires_at } : res.status === undefined ? { ok: false, error: res.error } : { ok: false, error: res.error, status: res.status };
    } catch {
      // Whatever threw, its message is dropped: it may carry a secret.
      return unreachable;
    }
  };
  return lock.run(guarded).catch(() => unreachable);
}
