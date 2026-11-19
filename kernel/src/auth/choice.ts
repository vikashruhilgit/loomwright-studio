// The owner's choice of auth provider (D42): which provider the kernel's
// sessions run on, kept as an inspectable file, `<dataDir>/config/auth.json`
// (`{"provider": "<id>"}`). Mechanism only: the kernel never picks for the
// owner beyond the build default when nothing is chosen. The file never holds a
// credential; keys and tokens stay in the Keychain.
//
// Precedence at kernel start: `--auth-provider`, then `STUDIO_AUTH_PROVIDER`,
// then this file, then the build default. A flag or env var overrides the
// choice, so the Settings switch refuses while one is set (it would not apply).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../tools/handoff.js";
import type { KeychainDeleter, KeychainReader, KeychainWriter } from "./keychain.js";

/** Where the choice is kept, under the data dir. */
export const AUTH_CHOICE_FILE = join("config", "auth.json");

/** Where the in-use provider's id came from. */
export type AuthProviderSource = "flag" | "env" | "choice" | "default";

/** The chosen provider id, or `undefined` when no valid choice is recorded (absent, unreadable or malformed file). */
export function readAuthChoice(dataDir: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, AUTH_CHOICE_FILE), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const provider = (parsed as { provider?: unknown }).provider;
  return typeof provider === "string" && provider.trim() !== "" ? provider : undefined;
}

/** Record `providerId` as the owner's choice (atomic write, the config dir created 0700). */
export function writeAuthChoice(dataDir: string, providerId: string): void {
  writeFileAtomic(join(dataDir, AUTH_CHOICE_FILE), `${JSON.stringify({ provider: providerId }, null, 2)}\n`);
}

/**
 * What the Settings auth routes may do, as the kernel wires it: the in-use
 * provider and where it came from, the providers this build has, the Keychain
 * calls that store an API key, and a restart that applies a new choice.
 * Never a provider object or a credential.
 */
export interface AuthControl {
  /** The provider the running kernel's sessions use. */
  readonly inUse: string;
  readonly source: AuthProviderSource;
  /** Every provider id this build can select, sorted. */
  readonly available: readonly string[];
  readonly dataDir: string;
  readonly keychainReader: KeychainReader;
  readonly keychainWriter: KeychainWriter;
  readonly keychainDeleter: KeychainDeleter;
  /**
   * Close admission, count the running sessions, and with none stop the kernel
   * gracefully and exit so launchd starts it again on the new choice. With one
   * running, admission opens again and nothing restarts (`restarting: false`,
   * `running` the count, or `null` when it could not be read). Absent when
   * nothing would start the kernel again (one started by hand): the switch is
   * then recorded and applies at the next start.
   */
  readonly restart?: () => RestartOutcome;
}

/** What a requested restart did (`AuthControl.restart`). */
export type RestartOutcome = { readonly restarting: true } | { readonly restarting: false; readonly running: number | null };
