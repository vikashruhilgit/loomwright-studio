// The GitHub App's credentials and installation tokens (D36): the Keychain item
// names, the App's key encoding, the App JWT, and the in-memory holder that
// mints and renews the installation token. The kernel tokens item (GitHub App
// 2) builds the port and the connector on this.
//
// Where each secret lives:
//   - the App's `pem` is in the Keychain only, as unpadded base64url
//     (`encodeAppKey`): the Keychain writer takes only `WRITE_ARG` characters,
//     and a PEM has spaces and newlines. It is read for one mint and dropped;
//   - the JWT is built, sent as one bearer and dropped;
//   - the installation token lives in the holder's memory for its hour (never in
//     the store, a file, an event or a log), shared by the polls, tools and
//     routes of the daemon process (`githubAppTokens`).
// Nothing here logs, and no failure carries a message: a result names its
// failure as a closed value (and an HTTP status), never as text built from an
// error, so no secret can ride in one. Every function and method here resolves
// or returns a typed result and never throws, whatever it is given.
//
// The `studio` CLI may load this through the port, so it imports only types,
// `node:crypto`, the Keychain module and the client: never the Agent SDK, the
// session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
import { createPrivateKey, createSign } from "node:crypto";
import { securityCliKeychain, WRITE_ARG } from "../../auth/keychain.js";
import type { KeychainReader } from "../../auth/keychain.js";
import { mintInstallationToken } from "./client.js";
import type { GitHubAppTokenSource, GitHubClientDeps } from "./client.js";

// The Keychain items (generic passwords, account `GITHUB_KEYCHAIN_ACCOUNT`).
// The PAT's own item is `GITHUB_KEYCHAIN_SERVICE` (`client.ts`).

/** The App's numeric id (the JWT's `iss`). */
export const GITHUB_APP_ID_SERVICE = "loomwright-studio-github-app-id";

/** The App's slug (`github.com/apps/<slug>`). */
export const GITHUB_APP_SLUG_SERVICE = "loomwright-studio-github-app-slug";

/** The installation's numeric id. */
export const GITHUB_APP_INSTALLATION_SERVICE = "loomwright-studio-github-app-installation";

/** The App's private key, as `encodeAppKey` writes it. */
export const GITHUB_APP_KEY_SERVICE = "loomwright-studio-github-app-key";

/**
 * The JWT's `iat` is this many seconds before the signer's clock, so a clock up
 * to this far ahead of GitHub's is still accepted (GitHub rejects an `iat` in
 * its future).
 */
export const GITHUB_APP_JWT_SKEW_SECONDS = 60;

/** The JWT's `exp` is `iat` plus this: GitHub's limit is 10 minutes. */
export const GITHUB_APP_JWT_LIFETIME_SECONDS = 600;

/** A held installation token with this much life left or less is renewed before it is handed out. */
export const GITHUB_APP_TOKEN_RENEW_MS = 5 * 60_000;

/** The most characters of PEM the encoder takes: a 4096-bit RSA key is ~3.3 KB. */
const MAX_PEM_LENGTH = 8000;

/** An App id or an installation id: a positive integer, as GitHub issues them. */
const NUMERIC_ID = /^[1-9]\d{0,14}$/;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * `pem` as unpadded base64url, or `undefined` when it is not a PEM (it must
 * start with `-----BEGIN`) or is too long. The encoded form is all
 * `[A-Za-z0-9_-]` and starts with a letter (the prefix guarantees it), so it
 * passes the Keychain writer's `WRITE_ARG`.
 */
export function encodeAppKey(pem: string): string | undefined {
  try {
    if (typeof pem !== "string" || pem.length > MAX_PEM_LENGTH || !pem.startsWith("-----BEGIN")) return undefined;
    const encoded = Buffer.from(pem, "utf8").toString("base64url");
    return WRITE_ARG.test(encoded) ? encoded : undefined;
  } catch {
    return undefined;
  }
}

/** The inverse of `encodeAppKey`, or `undefined` for anything it would not have produced. */
export function decodeAppKey(encoded: string): string | undefined {
  try {
    if (typeof encoded !== "string" || !BASE64URL.test(encoded)) return undefined;
    const pem = Buffer.from(encoded, "base64url").toString("utf8");
    // Only the canonical encoding of a PEM: re-encoding must give the input back.
    return encodeAppKey(pem) === encoded ? pem : undefined;
  } catch {
    return undefined;
  }
}

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

/**
 * The App JWT (RS256) GitHub takes to mint an installation token:
 * `iss` the App's id, `iat` `GITHUB_APP_JWT_SKEW_SECONDS` before `now`, `exp`
 * `GITHUB_APP_JWT_LIFETIME_SECONDS` after that. `undefined` when the id is not
 * a number, `now` is not a valid date, or `pem` is not an RSA private key. The
 * result is a secret: the caller sends it once and drops it.
 */
export function signAppJwt(appId: number | string, pem: string, now: Date): string | undefined {
  try {
    const iss = String(appId);
    if (!NUMERIC_ID.test(iss)) return undefined;
    const seconds = Math.floor(now.getTime() / 1000);
    if (!Number.isSafeInteger(seconds)) return undefined;
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") return undefined;
    const iat = seconds - GITHUB_APP_JWT_SKEW_SECONDS;
    const signingInput = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iat, exp: iat + GITHUB_APP_JWT_LIFETIME_SECONDS, iss }))}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    return `${signingInput}.${b64url(signer.sign(key))}`;
  } catch {
    return undefined;
  }
}

/**
 * Why the holder has no token: `no_credentials` (the App's items are not all in
 * the Keychain), `keychain_failed` (a read threw), `bad_key` (the stored key does
 * not decode or sign), or the mint's own failure (`unreachable`, `rate_limited`,
 * `http_error` with its `status`).
 */
export type GitHubAppTokenError = "no_credentials" | "keychain_failed" | "bad_key" | "unreachable" | "rate_limited" | "http_error";

/** The holder's answer: a token with its expiry and the permissions GitHub reports for it, or a typed failure. */
export type GitHubAppTokenResult =
  | { readonly ok: true; readonly token: string; readonly expires_at: string; readonly permissions: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly error: GitHubAppTokenError; readonly status?: number };

/**
 * A mint GitHub answered 401 (the key is revoked) or 404 (the installation is
 * gone): the connector reads the App as `rejected`. `at` is when it was seen
 * (ISO-8601 UTC). No other failure is recorded: a network error or a 5xx may
 * pass.
 */
export interface GitHubAppMintFailure {
  readonly status: 401 | 404;
  readonly at: string;
}

export interface GitHubAppTokens extends GitHubAppTokenSource {
  current(): Promise<GitHubAppTokenResult>;
  /** The latest mint answered 401 or 404 and no mint has succeeded since, else `undefined`. */
  readonly lastMintFailure: GitHubAppMintFailure | undefined;
  /** Forgets `lastMintFailure` (once the connector has acted on it). */
  clearMintFailure(): void;
}

export type GitHubAppTokenDeps = Pick<GitHubClientDeps, "fetch" | "timeoutMs" | "maxBodyBytes" | "now"> & {
  /** Default: `securityCliKeychain()`, built only when a call first needs it. */
  readonly keychain?: KeychainReader;
};

const NO_CREDENTIALS: GitHubAppTokenResult = Object.freeze({ ok: false, error: "no_credentials" });
const KEYCHAIN_FAILED: GitHubAppTokenResult = Object.freeze({ ok: false, error: "keychain_failed" });
const BAD_KEY: GitHubAppTokenResult = Object.freeze({ ok: false, error: "bad_key" });

interface Held {
  readonly installation: number;
  readonly token: string;
  readonly expires_at: string;
  readonly expiresMs: number;
  readonly permissions: Readonly<Record<string, string>>;
}

/**
 * The in-memory holder of one installation token. `current()` answers the held
 * token, or mints a new one when there is none, it has `GITHUB_APP_TOKEN_RENEW_MS`
 * or less left, or the Keychain's installation is not the one it was minted for
 * (one Keychain read on every call; the key is read only to mint). Concurrent
 * calls share one mint. A failed renewal is returned as a failure and keeps the
 * held token unless GitHub answered 401 or 404 (which also set `lastMintFailure`).
 * `invalidate()` forgets the token and any mint in flight (a result that arrives
 * after it is not kept) and clears `lastMintFailure`. Nothing is read when it is
 * built, and the token is never written anywhere.
 */
export function createGitHubAppTokens(deps: GitHubAppTokenDeps = {}): GitHubAppTokens {
  const now = deps.now ?? (() => new Date());
  let keychain: KeychainReader | undefined = deps.keychain;
  let held: Held | undefined;
  let inFlight: { readonly installation: number; readonly promise: Promise<GitHubAppTokenResult> } | undefined;
  let generation = 0;
  let failure: GitHubAppMintFailure | undefined;

  type Item = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly result: GitHubAppTokenResult };

  /** One Keychain item: its secret, or why there is none. Never throws. */
  function readItem(service: string): Item {
    try {
      keychain ??= securityCliKeychain();
      const value = keychain.read(service);
      return value === undefined || value === "" ? { ok: false, result: NO_CREDENTIALS } : { ok: true, value };
    } catch {
      return { ok: false, result: KEYCHAIN_FAILED };
    }
  }

  function readId(service: string): { readonly ok: true; readonly id: number } | { readonly ok: false; readonly result: GitHubAppTokenResult } {
    const item = readItem(service);
    if (!item.ok) return item;
    return NUMERIC_ID.test(item.value) ? { ok: true, id: Number(item.value) } : { ok: false, result: NO_CREDENTIALS };
  }

  async function mint(installation: number, gen: number): Promise<GitHubAppTokenResult> {
    try {
      const app = readId(GITHUB_APP_ID_SERVICE);
      if (!app.ok) return app.result;
      const encoded = readItem(GITHUB_APP_KEY_SERVICE);
      if (!encoded.ok) return encoded.result;
      const pem = decodeAppKey(encoded.value);
      if (pem === undefined) return BAD_KEY;
      const jwt = signAppJwt(app.id, pem, now());
      if (jwt === undefined) return BAD_KEY;
      const res = await mintInstallationToken(installation, jwt, deps);
      if (!res.ok) {
        const rejected = res.error === "http_error" && (res.status === 401 || res.status === 404);
        if (rejected && gen === generation) {
          held = undefined;
          failure = { status: res.status as 401 | 404, at: now().toISOString() };
        }
        return res.status === undefined ? { ok: false, error: res.error } : { ok: false, error: res.error, status: res.status };
      }
      if (gen === generation) {
        held = { installation, token: res.token, expires_at: res.expires_at, expiresMs: Date.parse(res.expires_at), permissions: res.permissions };
        failure = undefined;
      }
      return { ok: true, token: res.token, expires_at: res.expires_at, permissions: res.permissions };
    } catch {
      // Whatever threw, its message is dropped: it may carry the key or the JWT.
      return { ok: false, error: "unreachable" };
    }
  }

  return {
    configured(): boolean {
      try {
        return readItem(GITHUB_APP_INSTALLATION_SERVICE).ok && readItem(GITHUB_APP_KEY_SERVICE).ok;
      } catch {
        return false;
      }
    },

    async current(): Promise<GitHubAppTokenResult> {
      try {
        const installation = readId(GITHUB_APP_INSTALLATION_SERVICE);
        if (!installation.ok) return installation.result;
        const h = held;
        if (h !== undefined && h.installation === installation.id && h.expiresMs - now().getTime() > GITHUB_APP_TOKEN_RENEW_MS) {
          return { ok: true, token: h.token, expires_at: h.expires_at, permissions: h.permissions };
        }
        if (inFlight !== undefined && inFlight.installation === installation.id) return await inFlight.promise;
        const promise = mint(installation.id, generation);
        const mine = { installation: installation.id, promise };
        inFlight = mine;
        const clear = (): void => {
          if (inFlight === mine) inFlight = undefined;
        };
        promise.then(clear, clear);
        return await promise;
      } catch {
        return { ok: false, error: "unreachable" };
      }
    },

    invalidate(): void {
      generation += 1;
      held = undefined;
      inFlight = undefined;
      failure = undefined;
    },

    get lastMintFailure(): GitHubAppMintFailure | undefined {
      return failure;
    },

    clearMintFailure(): void {
      failure = undefined;
    },
  };
}

/** The process-wide holder: the daemon's polls, tools and routes share one installation token. Nothing is read until a call. */
export const githubAppTokens: GitHubAppTokens = createGitHubAppTokens();
