import { API_KEY_PROVIDER_ID, createApiKeyProvider } from "./api-key.js";
import { AuthProviderError } from "./types.js";
import type { AuthProvider, AuthProviderDeps } from "./types.js";

export const SUBSCRIPTION_TOKEN_ID = "subscription-token";

/**
 * Deliberately a non-literal specifier: `tsc` does not follow it, so a
 * distribution build (D29) can exclude the subscription provider's source and
 * nothing pulls it back in. No other file may import that module statically.
 */
const SUBSCRIPTION_MODULE: string = "./subscription-token.js";

type ProviderFactory = (deps: AuthProviderDeps) => AuthProvider;

/**
 * True only for "the subscription provider's own module is absent": Node's
 * ERR_MODULE_NOT_FOUND whose `url` is exactly that module. A module missing
 * from INSIDE the provider has a different `url` and is rethrown, never
 * swallowed (its message names the provider as importer, so the message is
 * not a safe test).
 */
function isSubscriptionModuleAbsent(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; url?: unknown };
  return (
    e.code === "ERR_MODULE_NOT_FOUND" &&
    e.url === new URL(SUBSCRIPTION_MODULE, import.meta.url).href
  );
}

async function loadSubscriptionFactory(): Promise<ProviderFactory | undefined> {
  let mod: unknown;
  try {
    mod = await import(SUBSCRIPTION_MODULE);
  } catch (err) {
    if (isSubscriptionModuleAbsent(err)) return undefined;
    throw err;
  }
  const factory = (mod as { createSubscriptionTokenProvider?: unknown }).createSubscriptionTokenProvider;
  if (typeof factory !== "function") {
    throw new Error("subscription provider module does not export createSubscriptionTokenProvider");
  }
  return factory as ProviderFactory;
}

async function factories(): Promise<Map<string, ProviderFactory>> {
  const map = new Map<string, ProviderFactory>();
  map.set(API_KEY_PROVIDER_ID, createApiKeyProvider);
  const subscription = await loadSubscriptionFactory();
  if (subscription !== undefined) map.set(SUBSCRIPTION_TOKEN_ID, subscription);
  return map;
}

/** The provider ids this build can select, sorted. */
export async function availableProviderIds(): Promise<string[]> {
  return [...(await factories()).keys()].sort();
}

/**
 * Build the provider `id`. Throws `AuthProviderError` with code `unavailable`
 * when this build has no such provider (for example `subscription-token` in a
 * distribution build).
 */
export async function selectAuthProvider(id: string, deps: AuthProviderDeps = {}): Promise<AuthProvider> {
  const factory = (await factories()).get(id);
  if (factory === undefined) {
    throw new AuthProviderError("unavailable", id, `auth provider "${id}" is not available in this build`);
  }
  return factory(deps);
}
