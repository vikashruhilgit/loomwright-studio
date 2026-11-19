import { credentialFingerprint } from "./fingerprint.js";
import { readCredentialRejection } from "./metadata.js";
import type { Store } from "../store/store.js";
import type { AuthHealth } from "./types.js";

/**
 * Step 2 of `AuthHealth`: `rejected` when the server's recorded refusal names
 * `credential` (by fingerprint), `error` (`rejection_unreadable`) when the
 * record cannot be read, `undefined` otherwise. Without a store nothing is
 * recorded, so nothing is rejected.
 */
export function rejectionHealth(store: Store | undefined, providerId: string, credential: string): AuthHealth | undefined {
  if (store === undefined) return undefined;
  let rejection;
  try {
    rejection = readCredentialRejection(store, providerId);
  } catch {
    return { status: "error", reason: "rejection_unreadable" };
  }
  if (rejection === undefined || rejection.fingerprint !== credentialFingerprint(credential)) return undefined;
  return { status: "rejected", at: rejection.at };
}
