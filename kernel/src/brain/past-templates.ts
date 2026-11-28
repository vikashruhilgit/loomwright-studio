// The kernel's past `role.md` templates for Wright, and the audit sink of the
// one kernel rewrite of `memory/wright/role.md` they allow (wa-b). It mirrors
// `../agents/past-tool-lists.ts` (wa-c) rule for rule.
//
// `role.md` is created once, from the `ROLE_TEMPLATE` of the day
// (`./templates.ts`). Until wa-a that template held the whole manual (the
// rules, the tool list); since wa-a it holds only who Wright is, and the rules
// are the kernel's Studio guide (`./guide.ts`), built for every context. An
// install made before wa-a keeps its old copy, a second, outdated manual. A
// `role.md` whose bytes hash (sha256 of the whole file) to one of the
// templates the kernel once shipped is provably unedited: `ensureMemoryFiles`
// (`./memory.ts`) then replaces it with the current template. Any other text
// and every crew member's `role.md` (the owner's approved charter, D22) is
// never written; `GET /memory` (`../gui/memory.ts`) marks a Wright `role.md`
// that still carries the old manual's headings (`carriesOldManual`) so the
// owner can see it.
//
// Every upgrade is audited. It runs only while an audit sink is registered
// for the data dir (`registerRoleUpgradeAudit`, which `startKernel` calls over
// its open store); with none (the `studio` CLI, a test without the kernel) the
// file is left as it is, so an upgrade is never unaudited. It also runs only
// at a top-level call: a call made while the store already has a transaction
// open leaves the file alone, because an outer rollback would drop the event
// while the renamed file stays. A failed upgrade is remembered in-process for
// that registration, keyed by the sha256 of the old bytes, so a lasting
// failure is not retried and recorded on every Wright message; changed bytes,
// a new registration (a kernel restart) or an unregister forget it. The
// steps themselves (backup, temporary file, the in-transaction re-read, the
// event, the rename last) are `./memory.ts`'s.
//
// Imports only `node:*`: `./memory.ts` imports this module, and the `studio`
// CLI loads that one.
import { resolve } from "node:path";

/** The audit kinds of the upgrade (one line: the app's audit sentence scan reads this form). */
export const ROLE_UPGRADE_AUDIT_KINDS = ["wright_role_upgraded", "wright_role_upgrade_failed"] as const;

export type RoleUpgradeAuditKind = (typeof ROLE_UPGRADE_AUDIT_KINDS)[number];

/**
 * The sha256 (hex, of the UTF-8 bytes) of every `ROLE_TEMPLATE` the kernel
 * shipped before the current one, oldest first. Recovered by evaluating
 * `ROLE_TEMPLATE` from `git show <sha>:kernel/src/brain/templates.ts` for
 * every commit in `git log -- kernel/src/brain/templates.ts`; the table is in
 * `docs/evidence/wa-b-role-upgrade.md`. The current template (`37d46b7e`,
 * `070b81c079cd…`) is not here (a test pins it), so an upgraded file is
 * never upgraded again. When `ROLE_TEMPLATE` changes, the hash of the text it
 * was before is appended here, or an install still holding it is only marked,
 * never replaced.
 */
export const PAST_ROLE_TEMPLATE_HASHES: readonly string[] = Object.freeze([
  // `181849a6` (2026-10-15, 1558 bytes).
  "e14f33ad758b8545fdf0eb805264ebeaaed34553c15cbc93890359de09a7a0dd",
  // `ab3d8c75` (2026-10-15, 1592 bytes).
  "5013a269b49dfce932e7f4c3cc38dd35dcde78f6357f86f31c5617d835b16c11",
  // `bc6d53f6` (2026-10-16, 1748 bytes).
  "177ded7579881bb501edbba54bd6d3765af3a9a37a8f6c1f14e7ca9a06e3e623",
  // `845564ce` (2026-10-18, 2368 bytes).
  "ff34c1099d8e65bd751daa07a1161e54d718717586ec4ab76bc446142212cefe",
  // `714f28ce` (2026-10-24, 2718 bytes).
  "58de5dc40658740e570908c76d79623f31d24efa4b2f10fde47c3b14c7752156",
  // `e93bac93` (2026-10-28, 4093 bytes).
  "11dddbf55c9644eec81ffbcf9f9a21bce4977a2461fb9de10cb242f4d35ee509",
  // `99bdce81` (2026-10-28, 4183 bytes).
  "7569bebe1ccc624f9c91bc26fd849ae540840e79b7f9b1b7a07a8801e136f7b7",
  // `1540566c` (2026-10-29, 4519 bytes).
  "97d294d96595ef425d7de584e5466a606203910e373dea06e25d63f97b78d5bf",
  // `d739dfb2` (2026-10-29, 4864 bytes).
  "8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345",
  // `ad404e4f` (2026-11-09, 6438 bytes).
  "96a753d2b12ecb746f805a7bdf8b21087d5eed8178ac05a2e504f70ca6a55335",
  // `0f00bc16` (2026-11-09, 7889 bytes).
  "72da7a5d260f52e72322a1b006aaef70c8bbf4b277949505410b660b54430746",
  // `d0052809` (2026-11-09, 8206 bytes).
  "d3a6d29d0856eb5db358dbbdb56f8ccf69ba3fb25ab9add5b55e07339d2dd8b6",
  // `27fbba3b` (2026-11-10, 8666 bytes).
  "0d366f9d6afc79e8ec8026c6d358a92ef18e4591b944d4d54ade65b7e6f7e367",
  // `2927ef11` (2026-11-13, 8763 bytes).
  "d371acfdc5718300787ff930dcd4bc6e9d96b96574ea2b66a6bf771d7900f050",
  // `ff127a5d` (2026-11-14, 9180 bytes).
  "bd5d7e04a891f182ac6d70dc336f7d82165ad68d8f483eb64240b0ee1a7cd2e4",
  // `7da35cc9` (2026-11-16, 9469 bytes).
  "1852559e15176fe17ea5ef7aca4e9fb56c3b57199cb767821b0ef55cc7230dd4",
]);

/**
 * The headings of the old manual: every past template carries all four, the
 * current one none (a test pins both). A Wright `role.md` that still has one
 * of them as a line carries (a part of) the old manual.
 */
export const OLD_MANUAL_HEADINGS: readonly string[] = Object.freeze(["## Untrusted text", "## Memory", "## Who decides", "## How you act"]);

/** The largest `role.md` the upgrade reads (every past template is under 10 KiB). */
export const MAX_ROLE_UPGRADE_BYTES = 64 * 1024;

/**
 * Whether `text` has one of `OLD_MANUAL_HEADINGS` as a whole line (trailing
 * whitespace and a CR ignored): the `old_manual` mark of `GET /memory`. Pure;
 * the text is data, only compared.
 */
export function carriesOldManual(text: string): boolean {
  return text.split("\n").some((line) => OLD_MANUAL_HEADINGS.includes(line.trimEnd()));
}

/** What records the upgrade's audit events over a kernel's open store (the shape of wa-c's `ProposedToolsAuditSink`). */
export interface RoleUpgradeAuditSink {
  /** Whether the store already has a transaction open: then `transaction` would only be a savepoint, and the call never upgrades. */
  readonly inTransaction: () => boolean;
  /** Runs `fn` in one store transaction: it commits when `fn` returns and rolls back when it throws. */
  readonly transaction: <T>(fn: () => T) => T;
  /** Appends one audit event (inside `transaction` when called from it). */
  readonly record: (kind: RoleUpgradeAuditKind, payload: Record<string, unknown>) => void;
}

/**
 * One registration: its sink, and the sha256 of every `role.md` content whose
 * upgrade failed under it (never retried, never recorded again while the
 * bytes stay the same). Owned by the registration, so it goes with it.
 */
export interface RoleUpgradeRegistration {
  readonly sink: RoleUpgradeAuditSink;
  readonly failed: Set<string>;
}

/** The registered sinks, one per data dir (resolved). */
const sinks = new Map<string, RoleUpgradeRegistration>();

/**
 * Registers `sink` for `dataDir`: `ensureMemoryFiles` there may replace an
 * unedited past `role.md`. A new registration starts with no remembered
 * failures. Returns the unregister function, which removes the registration
 * (and its remembered failures) only while it is still the one registered
 * (call it before the store closes, so no sink outlives its store).
 */
export function registerRoleUpgradeAudit(dataDir: string, sink: RoleUpgradeAuditSink): () => void {
  const key = resolve(dataDir);
  const registration: RoleUpgradeRegistration = { sink, failed: new Set() };
  sinks.set(key, registration);
  return () => {
    if (sinks.get(key) === registration) sinks.delete(key);
  };
}

/**
 * The registration an upgrade of `dataDir`'s `role.md` runs under, or
 * undefined when it must not run: no sink is registered (never unaudited), or
 * the store already has a transaction open (or the sink's check throws: fail
 * closed). Never throws.
 */
export function roleUpgradeRegistration(dataDir: string): RoleUpgradeRegistration | undefined {
  const registration = sinks.get(resolve(dataDir));
  // No registration ⇒ no upgrade: an upgrade is never unaudited.
  if (registration === undefined) return undefined;
  const { sink } = registration;
  try {
    if (sink.inTransaction()) return undefined;
  } catch {
    return undefined;
  }
  return registration;
}
