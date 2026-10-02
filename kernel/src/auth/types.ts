import type { Store } from "../store/store.js";
import type { KeychainReader } from "./keychain.js";

/**
 * The result of `AuthProvider.health()`. Exactly four variants, checked in
 * this order of precedence:
 *
 * - `missing`: the Keychain item does not exist.
 * - `invalid_shape`: the stored value is not a whole credential (for example a
 *   token cut off while pasting).
 * - `expiring`: fewer than 30 days remain of the credential's recorded life.
 *   `days` is whole days left, floored; it is `0` or negative once the
 *   credential has lapsed (there is no separate `expired` variant).
 * - `ok`: none of the above. A credential with no recorded creation date has
 *   an unknown expiry and reports `ok` when its shape is whole.
 */
export type AuthHealth =
  | { readonly status: "ok" }
  | { readonly status: "missing" }
  | { readonly status: "invalid_shape" }
  | { readonly status: "expiring"; readonly days: number };

/** An environment as the kernel receives it (for example `process.env`). */
export type BaseEnv = Readonly<Record<string, string | undefined>>;

/** An environment for a child session: every value is a string. */
export type ChildEnv = Record<string, string>;

/**
 * One way of authenticating an agent session on exactly one account.
 *
 * A provider never caches its secret: each `buildEnv`/`health` call reads the
 * Keychain afresh, so inspecting or serialising a provider can never show it.
 */
export interface AuthProvider {
  /** Stable provider id, for example `api-key`. */
  readonly id: string;
  /** A human label for the account this provider authenticates. Never a secret. */
  readonly account: string;
  /**
   * Return a NEW environment for a child session: `baseEnv` with every
   * credential and billing-routing variable removed, then this provider's one
   * credential variable set. Never mutates `baseEnv`. Fails closed: throws
   * `AuthProviderError` (`missing` or `invalid_shape`) rather than hand a
   * session a credential that cannot work.
   */
  buildEnv(baseEnv: BaseEnv): ChildEnv;
  /** Check the stored credential without building an environment. */
  health(): AuthHealth;
}

/** What every provider factory accepts. All of it is injectable for tests. */
export interface AuthProviderDeps {
  /** Defaults to the real `/usr/bin/security` reader. */
  readonly keychain?: KeychainReader;
  /**
   * Where non-secret provider metadata (account label, token creation date)
   * lives. Without a store the account label is the provider id and the
   * expiry is unknown.
   */
  readonly store?: Store;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export type AuthProviderErrorCode = "missing" | "invalid_shape" | "unavailable";

/**
 * A provider could not produce a usable environment, or does not exist in this
 * build. The message names the provider and Keychain service only: it never
 * carries the credential or any process output.
 */
export class AuthProviderError extends Error {
  readonly code: AuthProviderErrorCode;
  readonly providerId: string;

  constructor(code: AuthProviderErrorCode, providerId: string, message: string) {
    super(message);
    this.name = "AuthProviderError";
    this.code = code;
    this.providerId = providerId;
  }
}
