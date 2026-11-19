// The repo's required checks, handed to a kernel run (phase 8 item 23t). A run's
// owned review drain (`/review-pr --until-mergeable`) gates READY on the default
// branch's required checks, which it reads from branch protection. Inside a
// kernel session the GitHub token is the down-scoped one (D39: pull requests,
// contents, issues, checks; never administration), and reading protection needs
// administration, so the drain could never read the list and always ended
// ESCALATED `required_checks_unavailable` (live 2026-11-18, PR 20 on
// studio-sandbox, whose main requires `ci`).
//
// Studio already knows the list: the repo policy's detection (`repo_policies.
// detected_json`, read with the App's own token, phase 8 item 08). Loomwright's
// documented input for a host that knows it is `required_checks` in the
// checkout's own `.supervisor/config.json`, read only when protection cannot be
// read. So before a run session starts, the kernel writes that key there.
//
// Mechanism only (invariant 1): the list is GitHub's own protection as detected,
// never a kernel default. It keeps every other key, and writes only when git
// ignores the file in that checkout, so nothing a worker could commit appears.
//
// Whose list it is (23u): the kernel's own earlier write is the list its last
// `run_required_checks` event for this checkout recorded as `written`. That list
// follows the detection: rewritten when the detected list changes, removed when
// the detection says the branch is unprotected or requires no checks. Any other
// `required_checks` in the file (the owner's, Loomwright's, or the kernel's list
// edited by hand) is left alone. A detection that can't say (none, unreadable)
// changes nothing. Every write or removal is recorded here, so the record and the
// file can't drift. Honest limit: the detection is as fresh as its `read_at`;
// re-detect the repo in Studio after changing protection on GitHub.
//
// It lives here, not under `src/automate/` (which starts no process, its scan
// test), and asks git only through `run-state-checkout.ts` (`gitIgnores`), the
// one file here that runs git.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../tools/handoff.js";
import { gitIgnores } from "./run-state-checkout.js";
import type { Store } from "../store/index.js";

/** Where Loomwright reads a checkout's own config. */
export const LOOMWRIGHT_CONFIG = join(".supervisor", "config.json");

/** A check name as GitHub reports it: printable, no control characters, at most 200 characters. */
const CHECK_NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;

export type RequiredChecksOutcome =
  | { readonly kind: "written"; readonly checks: readonly string[] }
  | { readonly kind: "removed"; readonly checks: readonly string[] }
  | { readonly kind: "skipped"; readonly reason: RequiredChecksSkip };

export type RequiredChecksSkip = "no_detection" | "not_protected" | "no_required_checks" | "unchanged" | "already_set" | "config_unreadable" | "not_ignored" | "git_unavailable" | "write_failed";

/** Skips that are no news (nothing to hand over, or already handed over): not recorded. */
export const QUIET_SKIPS: ReadonlySet<RequiredChecksSkip> = new Set(["no_detection", "not_protected", "no_required_checks", "unchanged"]);

type Detected =
  | { readonly checks: readonly string[] }
  /** The detection says plainly that there is nothing to require: the kernel's own list goes. */
  | { readonly reason: "not_protected" | "no_required_checks"; readonly definite: true }
  /** The detection can't say: nothing changes. */
  | { readonly reason: "no_detection" | "not_protected" | "no_required_checks"; readonly definite: false };

/** The detected required checks for `repo`, or why there are none to hand over. */
function detectedChecks(store: Store, repo: string): Detected {
  const raw = store.prepare<[string], string | null>("SELECT detected_json FROM repo_policies WHERE repo = ?").pluck().get(repo);
  if (raw === undefined || raw === null) return { reason: "no_detection", definite: false };
  let detection: unknown;
  try {
    detection = JSON.parse(raw);
  } catch {
    return { reason: "no_detection", definite: false };
  }
  if (typeof detection !== "object" || detection === null) return { reason: "no_detection", definite: false };
  const d = detection as { protection?: unknown; required_checks?: unknown };
  if (d.protection === "unprotected") return { reason: "not_protected", definite: true };
  if (d.protection !== "protected") return { reason: "not_protected", definite: false };
  if (!Array.isArray(d.required_checks)) return { reason: "no_required_checks", definite: false };
  const checks = d.required_checks.filter((c): c is string => typeof c === "string" && CHECK_NAME.test(c));
  if (checks.length === 0) return d.required_checks.length === 0 ? { reason: "no_required_checks", definite: true } : { reason: "no_required_checks", definite: false };
  return { checks };
}

/** The list the kernel last wrote into `checkout`, or `undefined` when its last record there is none or a removal. */
function lastWritten(store: Store, checkout: string): readonly string[] | undefined {
  const raw = store
    .prepare<[string], string>(
      `SELECT payload_json FROM events WHERE kind = 'run_required_checks' AND json_extract(payload_json, '$.checkout') = ?
         AND (json_extract(payload_json, '$.written') IS NOT NULL OR json_extract(payload_json, '$.removed') IS NOT NULL)
       ORDER BY id DESC LIMIT 1`,
    )
    .pluck()
    .get(checkout);
  if (raw === undefined) return undefined;
  const written = (JSON.parse(raw) as { written?: unknown }).written;
  return Array.isArray(written) && written.every((c) => typeof c === "string") ? (written as string[]) : undefined;
}

function sameList(a: unknown, b: readonly string[] | undefined): boolean {
  return b !== undefined && Array.isArray(a) && a.length === b.length && a.every((c, i) => c === b[i]);
}

/** Record a hand-over outcome that is news (see `QUIET_SKIPS`); the record of a write is what makes the list the kernel's. */
function record(store: Store, repo: string, checkout: string, outcome: RequiredChecksOutcome): RequiredChecksOutcome {
  if (outcome.kind === "skipped" && QUIET_SKIPS.has(outcome.reason)) return outcome;
  const detail = outcome.kind === "written" ? { written: outcome.checks } : outcome.kind === "removed" ? { removed: outcome.checks } : { skipped: outcome.reason };
  store
    .prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'run_required_checks', 'kernel', ?)")
    .run(new Date().toISOString(), JSON.stringify({ repo, checkout, ...detail }));
  return outcome;
}

/**
 * Hand `repo`'s detected required checks to the run in `checkout` (see the file
 * header), and record the outcome when it is news. Never throws: every failure
 * is a `skipped` outcome naming why.
 */
export function handRequiredChecks(store: Store, repo: string, checkout: string): RequiredChecksOutcome {
  return record(store, repo, checkout, handOver(store, repo, checkout));
}

function handOver(store: Store, repo: string, checkout: string): RequiredChecksOutcome {
  const detected = detectedChecks(store, repo);
  if ("reason" in detected && !detected.definite) return { kind: "skipped", reason: detected.reason };
  const path = join(checkout, LOOMWRIGHT_CONFIG);
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { kind: "skipped", reason: "config_unreadable" };
      config = parsed as Record<string, unknown>;
    } catch {
      return { kind: "skipped", reason: "config_unreadable" };
    }
  }
  const present = Object.prototype.hasOwnProperty.call(config, "required_checks");
  const ours = present ? lastWritten(store, checkout) : undefined;
  const isOurs = present && sameList(config.required_checks, ours);
  if ("reason" in detected) {
    // Nothing to require now: only the kernel's own earlier list is taken back.
    if (!isOurs || ours === undefined) return { kind: "skipped", reason: detected.reason };
    const { required_checks: _gone, ...rest } = config;
    const failed = writeIgnored(checkout, path, rest);
    return failed ?? { kind: "removed", checks: ours };
  }
  if (present && !isOurs) return { kind: "skipped", reason: "already_set" };
  if (isOurs && sameList(config.required_checks, detected.checks)) return { kind: "skipped", reason: "unchanged" };
  const failed = writeIgnored(checkout, path, { ...config, required_checks: detected.checks });
  return failed ?? { kind: "written", checks: detected.checks };
}

/** Write `config` to `path` when git ignores it in `checkout`; the skip naming why not, or `undefined` once written. */
function writeIgnored(checkout: string, path: string, config: Record<string, unknown>): RequiredChecksOutcome | undefined {
  const ignored = gitIgnores(checkout, LOOMWRIGHT_CONFIG);
  if (ignored === undefined) return { kind: "skipped", reason: "git_unavailable" };
  if (!ignored) return { kind: "skipped", reason: "not_ignored" };
  try {
    writeFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
  } catch {
    return { kind: "skipped", reason: "write_failed" };
  }
  return undefined;
}
