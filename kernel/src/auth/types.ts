import type { Store } from "../store/store.js";
import type { KeychainReader } from "./keychain.js";

/**
 * Why `AuthProvider.health()` (or `/status` around it) reports `error`. Never
 * a message, Keychain output or the credential: only one of these names.
 *
 * - `keychain_unreadable`: reading the Keychain item failed for a reason other
 *   than "not found" (the `security` tool failed, timed out, was denied, ...).
 *   The error itself is dropped, since it may carry Keychain output.
 * - `clock_unreadable`: the instant the check runs at is not a valid date
 *   (`getTime()` is not finite) or the provider's clock threw, so no day count
 *   can be computed.
 * - `token_created_at_unreadable`: the recorded creation date cannot be read
 *   (not a strict ISO-8601 UTC timestamp of a real calendar date, after the
 *   instant the check runs at, the metadata read failed, or the day count it
 *   gives is not finite). `parseTokenCreatedAt` decides the date part.
 * - `health_threw`: used ONLY by `/status`'s defensive wrapper, for a provider
 *   whose `health()` still throws (a test stub, a future provider). The
 *   providers in this package never return it.
 */
export type AuthHealthErrorReason =
  | "keychain_unreadable"
  | "token_created_at_unreadable"
  | "clock_unreadable"
  | "health_threw";

/**
 * The result of `AuthProvider.health()`. Exactly five variants. `health()` is
 * total: every failure is one of these values, never a throw and never a false
 * `ok`. It decides in this order:
 *
 * 1. ONE Keychain read yields exactly one of:
 *    - `error` (`keychain_unreadable`): the read threw;
 *    - `missing`: the Keychain item does not exist;
 *    - `invalid_shape`: the stored value is not a whole credential (for
 *      example a token cut off while pasting).
 *    A missing or broken credential comes first: it is the more urgent fact.
 * 2. The clock: `error` (`clock_unreadable`) when the instant is not a valid
 *    date, even when no creation date is recorded.
 * 3. The recorded creation date: `error` (`token_created_at_unreadable`) when
 *    it cannot be read.
 * 4. `expiring`: fewer than 30 days remain of the credential's recorded life.
 *    `days` is whole days left, floored; it is `0` or negative once the
 *    credential has lapsed (there is no separate `expired` variant).
 * 5. `ok`: none of the above. A credential with no recorded creation date has
 *    an unknown expiry and reports `ok` when its shape is whole.
 *
 * The api-key provider has no expiry and ignores the clock by design: it only
 * ever reports `error` (`keychain_unreadable`), `missing`, `invalid_shape` or
 * `ok`. See `AuthHealthErrorReason` for what each `error` reason means.
 */
export type AuthHealth =
  | { readonly status: "ok" }
  | { readonly status: "missing" }
  | { readonly status: "invalid_shape" }
  | { readonly status: "expiring"; readonly days: number }
  | { readonly status: "error"; readonly reason: AuthHealthErrorReason };

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
   * session a credential that cannot work; any other Keychain failure
   * propagates as `KeychainError`.
   */
  buildEnv(baseEnv: BaseEnv): ChildEnv;
  /**
   * Check the stored credential without building an environment. Total: never
   * throws; every failure is an `error` value (see `AuthHealth`).
   *
   * `at` is the ONE clock: a caller that holds an instant (`checkAuthHealth`,
   * `/status`) passes it, so the day count and the caller's own timestamps
   * agree. When omitted the provider reads its `deps.now()`.
   */
  health(at?: Date): AuthHealth;
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
