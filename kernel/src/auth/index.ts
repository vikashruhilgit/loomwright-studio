// Public surface of the auth layer. The subscription-token provider is NOT
// re-exported: it is reachable only through `selectAuthProvider`, so a
// distribution build can leave it out (D29). Studio never runs a login flow;
// creating a token is the owner's manual step (invariant 6).
export { AuthProviderError } from "./types.js";
export type {
  AuthHealth,
  AuthProvider,
  AuthProviderDeps,
  AuthProviderErrorCode,
  BaseEnv,
  ChildEnv,
} from "./types.js";
export { KeychainError, SECURITY_BIN, securityCliKeychain, securityCliKeychainWriter } from "./keychain.js";
export type { ExecFileSyncLike, ExecOptions, KeychainReader, KeychainWriter } from "./keychain.js";
export { CREDENTIAL_ENV_PREFIX, CREDENTIAL_ENV_VARS, isCredentialEnvVar, stripCredentialEnv } from "./credential-env.js";
export { isPlausibleApiKey, isWholeToken } from "./token-shape.js";
export { readProviderMetadata, recordTokenCreated } from "./metadata.js";
export type { ProviderMetadata } from "./metadata.js";
export { API_KEY_ENV_VAR, API_KEY_KEYCHAIN_SERVICE, API_KEY_PROVIDER_ID, createApiKeyProvider } from "./api-key.js";
export { SUBSCRIPTION_TOKEN_ID, availableProviderIds, selectAuthProvider } from "./registry.js";
export { AUTH_EXPIRING_REASON, checkAuthHealth } from "./notify.js";
