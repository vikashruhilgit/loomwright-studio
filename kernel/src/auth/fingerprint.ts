import { createHash } from "node:crypto";

/**
 * A short, one-way fingerprint of a credential: the first 16 hex characters of
 * its SHA-256. It tells two credentials apart (has the owner replaced the
 * rejected one?) and nothing more. The credential is never stored; a 64-bit
 * prefix of the hash of a high-entropy secret cannot be turned back into it.
 */
export function credentialFingerprint(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex").slice(0, 16);
}
