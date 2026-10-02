// Personal build only (D29). Nothing may import this file statically: the
// registry loads it through a non-literal dynamic import so a distribution
// build (tsconfig.distribution.json) can leave it out of dist/ entirely.
import { stripCredentialEnv } from "./credential-env.js";
import { securityCliKeychain } from "./keychain.js";
import { readProviderMetadata } from "./metadata.js";
import { isWholeToken } from "./token-shape.js";
import { AuthProviderError } from "./types.js";
import type { AuthHealth, AuthProvider, AuthProviderDeps, BaseEnv, ChildEnv } from "./types.js";

export const SUBSCRIPTION_TOKEN_PROVIDER_ID = "subscription-token";

/** The Keychain item (service name) holding the token the owner created by hand. */
export const SUBSCRIPTION_KEYCHAIN_SERVICE = "loomwright-studio-oauth";

/** The child-environment variable the token is passed in. */
export const SUBSCRIPTION_ENV_VAR = "CLAUDE_CODE_OAUTH_TOKEN";

/** Long-lived subscription tokens last one year (D27). */
export const TOKEN_LIFETIME_DAYS = 365;

/** `health()` reports `expiring` when fewer than this many days remain. */
export const EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 86_400_000;

/** Whole days left, floored, of a token created at `createdAtIso`. */
export function tokenDaysLeft(createdAtIso: string, now: Date): number {
  const expiresAt = Date.parse(createdAtIso) + TOKEN_LIFETIME_DAYS * DAY_MS;
  return Math.floor((expiresAt - now.getTime()) / DAY_MS);
}

/**
 * The subscription-token provider: reads the token from the Keychain on every
 * call (never caches it) and passes it as `CLAUDE_CODE_OAUTH_TOKEN`, with every
 * other credential variable removed so nothing else can win over it.
 *
 * Expiry is tracked from the creation date recorded in `auth_providers`. With
 * no recorded date the expiry is unknown and a whole token reports `ok`.
 * A Keychain failure other than "not found" propagates as `KeychainError`.
 */
export function createSubscriptionTokenProvider(deps: AuthProviderDeps = {}): AuthProvider {
  const keychain = deps.keychain ?? securityCliKeychain();
  const store = deps.store;
  const now = deps.now ?? (() => new Date());
  const id = SUBSCRIPTION_TOKEN_PROVIDER_ID;

  function readWholeToken(): string {
    const value = keychain.read(SUBSCRIPTION_KEYCHAIN_SERVICE);
    if (value === undefined) {
      throw new AuthProviderError(
        "missing",
        id,
        `auth provider "${id}": Keychain item "${SUBSCRIPTION_KEYCHAIN_SERVICE}" not found`,
      );
    }
    if (!isWholeToken(value)) {
      throw new AuthProviderError(
        "invalid_shape",
        id,
        `auth provider "${id}": Keychain item "${SUBSCRIPTION_KEYCHAIN_SERVICE}" does not hold a whole token`,
      );
    }
    return value;
  }

  return {
    id,
    get account(): string {
      return (store && readProviderMetadata(store, id)?.account) || id;
    },
    buildEnv(baseEnv: BaseEnv): ChildEnv {
      const token = readWholeToken();
      // Strip first, then set: the token is the child's only credential.
      const env = stripCredentialEnv(baseEnv);
      env[SUBSCRIPTION_ENV_VAR] = token;
      return env;
    },
    health(): AuthHealth {
      const value = keychain.read(SUBSCRIPTION_KEYCHAIN_SERVICE);
      if (value === undefined) return { status: "missing" };
      if (!isWholeToken(value)) return { status: "invalid_shape" };
      const createdAt = store ? readProviderMetadata(store, id)?.token_created_at : undefined;
      if (createdAt === undefined || createdAt === null) return { status: "ok" };
      const days = tokenDaysLeft(createdAt, now());
      return days < EXPIRY_WARNING_DAYS ? { status: "expiring", days } : { status: "ok" };
    },
  };
}
