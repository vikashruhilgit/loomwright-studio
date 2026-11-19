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
// never a kernel default. It never overrides a `required_checks` already in the
// file (the owner's or Loomwright's), keeps every other key, and writes only when
// git ignores the file in that checkout, so nothing a worker could commit appears.
// Honest limit: the detection is as fresh as its `read_at`; re-detect the repo in
// Studio after changing protection on GitHub.
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
  | { readonly kind: "skipped"; readonly reason: "no_detection" | "not_protected" | "no_required_checks" | "already_set" | "config_unreadable" | "not_ignored" | "git_unavailable" | "write_failed" };

/** The detected required checks for `repo`, or why there are none to hand over. */
function detectedChecks(store: Store, repo: string): { readonly checks: readonly string[] } | { readonly reason: "no_detection" | "not_protected" | "no_required_checks" } {
  const raw = store.prepare<[string], string | null>("SELECT detected_json FROM repo_policies WHERE repo = ?").pluck().get(repo);
  if (raw === undefined || raw === null) return { reason: "no_detection" };
  let detection: unknown;
  try {
    detection = JSON.parse(raw);
  } catch {
    return { reason: "no_detection" };
  }
  if (typeof detection !== "object" || detection === null) return { reason: "no_detection" };
  const d = detection as { protection?: unknown; required_checks?: unknown };
  if (d.protection !== "protected") return { reason: "not_protected" };
  if (!Array.isArray(d.required_checks)) return { reason: "no_required_checks" };
  const checks = d.required_checks.filter((c): c is string => typeof c === "string" && CHECK_NAME.test(c));
  return checks.length === 0 ? { reason: "no_required_checks" } : { checks };
}

/**
 * Hand `repo`'s detected required checks to the run in `checkout` (see the file
 * header). Never throws: every failure is a `skipped` outcome naming why.
 */
export function handRequiredChecks(store: Store, repo: string, checkout: string): RequiredChecksOutcome {
  const detected = detectedChecks(store, repo);
  if ("reason" in detected) return { kind: "skipped", reason: detected.reason };
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
    if (Object.prototype.hasOwnProperty.call(config, "required_checks")) return { kind: "skipped", reason: "already_set" };
  }
  const ignored = gitIgnores(checkout, LOOMWRIGHT_CONFIG);
  if (ignored === undefined) return { kind: "skipped", reason: "git_unavailable" };
  if (!ignored) return { kind: "skipped", reason: "not_ignored" };
  try {
    writeFileAtomic(path, `${JSON.stringify({ ...config, required_checks: detected.checks }, null, 2)}\n`);
  } catch {
    return { kind: "skipped", reason: "write_failed" };
  }
  return { kind: "written", checks: detected.checks };
}
