// 23t: the kernel hands a repo's detected required checks to a run through the checkout's Loomwright config, since the
// session's down-scoped token (D39, no administration) can't read branch protection (live: PR 20's drain ESCALATED
// `required_checks_unavailable` on a repo whose main requires `ci`). Real temporary git checkouts; no GitHub.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOOMWRIGHT_CONFIG, handRequiredChecks } from "../src/loomwright/required-checks.js";
import { Store } from "../src/store/index.js";

const REPO = "o/sandbox";
let tmp: string;
let store: Store;
let checkout: string;

function detected(json: Record<string, unknown> | null): void {
  store
    .prepare("INSERT INTO repo_policies (repo, policy_kind, detected_json, set_by, set_at) VALUES (?, 'solo', ?, 'owner', '2026-11-12T15:27:31.829Z')")
    .run(REPO, json === null ? null : JSON.stringify(json));
}

const PROTECTED = { repo: REPO, protection: "protected", required_reviews: null, required_checks: ["ci"], default_branch: "main", private: false, read_at: "2026-11-12T15:27:13.350Z" };
const config = () => JSON.parse(readFileSync(join(checkout, LOOMWRIGHT_CONFIG), "utf8")) as Record<string, unknown>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-reqchecks-"));
  store = new Store({ dataDir: join(tmp, "data") });
  checkout = join(tmp, "sandbox");
  mkdirSync(checkout);
  execFileSync("git", ["init", "-q", checkout]);
  // As the owner's sandbox has it: `.supervisor/` excluded locally, so the file is never something a worker commits.
  writeFileSync(join(checkout, ".git", "info", "exclude"), ".supervisor/\n");
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("handRequiredChecks (23t)", () => {
  it("writes the detected required checks into an absent, git-ignored config", () => {
    detected(PROTECTED);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "written", checks: ["ci"] });
    expect(config()).toEqual({ required_checks: ["ci"] });
  });

  it("keeps every other key, and never overrides a required_checks already set", () => {
    detected(PROTECTED);
    mkdirSync(join(checkout, ".supervisor"));
    writeFileSync(join(checkout, LOOMWRIGHT_CONFIG), JSON.stringify({ fix_floor: "HIGH" }));
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "written", checks: ["ci"] });
    expect(config()).toEqual({ fix_floor: "HIGH", required_checks: ["ci"] });
    writeFileSync(join(checkout, LOOMWRIGHT_CONFIG), JSON.stringify({ required_checks: ["lint"] }));
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "already_set" });
    expect(config()).toEqual({ required_checks: ["lint"] });
  });

  it("writes nothing a worker could commit: a config git does not ignore is left alone", () => {
    detected(PROTECTED);
    writeFileSync(join(checkout, ".git", "info", "exclude"), "");
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "not_ignored" });
    expect(existsSync(join(checkout, LOOMWRIGHT_CONFIG))).toBe(false);
  });

  it("hands over only what GitHub's protection says: no detection, unprotected, an empty or malformed list", () => {
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "no_detection" });
    detected({ ...PROTECTED, protection: "unreadable" });
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "not_protected" });
    store.prepare("UPDATE repo_policies SET detected_json = ? WHERE repo = ?").run(JSON.stringify({ ...PROTECTED, required_checks: [] }), REPO);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "no_required_checks" });
    store.prepare("UPDATE repo_policies SET detected_json = ? WHERE repo = ?").run(JSON.stringify({ ...PROTECTED, required_checks: ["bad\nname", 7] }), REPO);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "no_required_checks" });
    expect(existsSync(join(checkout, LOOMWRIGHT_CONFIG))).toBe(false);
  });

  it("an unreadable config or a folder that is not a git checkout is skipped, never thrown", () => {
    detected(PROTECTED);
    mkdirSync(join(checkout, ".supervisor"));
    writeFileSync(join(checkout, LOOMWRIGHT_CONFIG), "[1, 2]");
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "config_unreadable" });
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    expect(handRequiredChecks(store, REPO, plain)).toEqual({ kind: "skipped", reason: "git_unavailable" });
  });

  // 23u (review of PR #292): the list the kernel wrote is the kernel's, so it follows the detection; only a list the
  // kernel did not write is the owner's (or Loomwright's) and left alone.
  it("refreshes its own earlier list after the owner re-detects changed protection", () => {
    detected(PROTECTED);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "written", checks: ["ci"] });
    store.prepare("UPDATE repo_policies SET detected_json = ? WHERE repo = ?").run(JSON.stringify({ ...PROTECTED, required_checks: ["ci", "e2e"] }), REPO);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "written", checks: ["ci", "e2e"] });
    expect(config()).toEqual({ required_checks: ["ci", "e2e"] });
  });

  it("removes its own earlier list once the branch is no longer protected, and keeps every other key", () => {
    detected(PROTECTED);
    mkdirSync(join(checkout, ".supervisor"));
    writeFileSync(join(checkout, LOOMWRIGHT_CONFIG), JSON.stringify({ fix_floor: "HIGH" }));
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "written", checks: ["ci"] });
    store.prepare("UPDATE repo_policies SET detected_json = ? WHERE repo = ?").run(JSON.stringify({ ...PROTECTED, protection: "unprotected", required_checks: [] }), REPO);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "removed", checks: ["ci"] });
    expect(config()).toEqual({ fix_floor: "HIGH" });
  });

  it("an unchanged detection rewrites nothing and records nothing", () => {
    detected(PROTECTED);
    handRequiredChecks(store, REPO, checkout);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "unchanged" });
    expect(store.prepare("SELECT count(*) FROM events WHERE kind = 'run_required_checks'").pluck().get()).toBe(1);
  });

  it("a list the owner edited after the kernel's write is the owner's from then on", () => {
    detected(PROTECTED);
    handRequiredChecks(store, REPO, checkout);
    writeFileSync(join(checkout, LOOMWRIGHT_CONFIG), JSON.stringify({ required_checks: ["ci", "lint"] }));
    store.prepare("UPDATE repo_policies SET detected_json = ? WHERE repo = ?").run(JSON.stringify({ ...PROTECTED, required_checks: ["build"] }), REPO);
    expect(handRequiredChecks(store, REPO, checkout)).toEqual({ kind: "skipped", reason: "already_set" });
    expect(config()).toEqual({ required_checks: ["ci", "lint"] });
  });
});
