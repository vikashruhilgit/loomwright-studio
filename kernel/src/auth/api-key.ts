import { stripCredentialEnv } from "./credential-env.js";
import { securityCliKeychain } from "./keychain.js";
import { readProviderMetadata } from "./metadata.js";
import { isPlausibleApiKey } from "./token-shape.js";
import { AuthProviderError } from "./types.js";
import type { AuthHealth, AuthProvider, AuthProviderDeps, BaseEnv, ChildEnv } from "./types.js";

export const API_KEY_PROVIDER_ID = "api-key";

/** The Keychain item (service name) holding the API key. */
export const API_KEY_KEYCHAIN_SERVICE = "loomwright-studio-api-key";

/** The child-environment variable the key is passed in. */
export const API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

/**
 * The api-key provider (D16): reads the key from the Keychain on every call
 * (never caches it) and passes it as `ANTHROPIC_API_KEY`, with every other
 * credential variable (including `CLAUDE_CODE_OAUTH_TOKEN`) removed. Stub-tested
 * only until a commercial launch (invariant 6). API keys have no tracked
 * expiry, so `health()` never reports `expiring`.
 */
export function createApiKeyProvider(deps: AuthProviderDeps = {}): AuthProvider {
  const keychain = deps.keychain ?? securityCliKeychain();
  const store = deps.store;
  const id = API_KEY_PROVIDER_ID;

  return {
    id,
    get account(): string {
      return (store && readProviderMetadata(store, id)?.account) || id;
    },
    buildEnv(baseEnv: BaseEnv): ChildEnv {
      const key = keychain.read(API_KEY_KEYCHAIN_SERVICE);
      if (key === undefined) {
        throw new AuthProviderError(
          "missing",
          id,
          `auth provider "${id}": Keychain item "${API_KEY_KEYCHAIN_SERVICE}" not found`,
        );
      }
      if (!isPlausibleApiKey(key)) {
        throw new AuthProviderError(
          "invalid_shape",
          id,
          `auth provider "${id}": Keychain item "${API_KEY_KEYCHAIN_SERVICE}" does not hold a whole key`,
        );
      }
      // Strip first, then set: the key is the child's only credential.
      const env = stripCredentialEnv(baseEnv);
      env[API_KEY_ENV_VAR] = key;
      return env;
    },
    health(): AuthHealth {
      const key = keychain.read(API_KEY_KEYCHAIN_SERVICE);
      if (key === undefined) return { status: "missing" };
      if (!isPlausibleApiKey(key)) return { status: "invalid_shape" };
      return { status: "ok" };
    },
  };
}
