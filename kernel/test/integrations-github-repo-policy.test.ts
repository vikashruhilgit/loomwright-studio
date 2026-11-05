// The per-repo merge policy (phase 8 item 08, D40): detection, the proposal,
// `policyMet`, the three owner routes and the absence of any agent tool. Every
// test runs against `FakeGitHubClient` (nothing reaches GitHub or the Keychain),
// on a temp store with an injected clock. The playbook half of item 08
// (`merge_requirement`, `playbook_looser_than_repo`) is tested beside the
// playbooks (`playbooks-foundation.test.ts`).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHIPPED_CONTRIBUTIONS, mergeContributions, PHASE1_RESERVED } from "../src/features/index.js";
import type { ContributedRoute, ContributedRouteResponse } from "../src/features/index.js";
import {
  MERGE_APPROVAL_ACTION,
  POLICY_NOT_MET_REASONS,
  REPO_POLICY_CHOICES,
  REPO_POLICY_KINDS,
  REPO_POLICY_ROW_KINDS,
  REPO_PROTECTIONS,
  detectRepoPolicy,
  getRepoPolicy,
  loomwrightMergeFlags,
  policyMet,
  proposeRepoPolicy,
} from "../src/integrations/github/repo-policy.js";
import type { RepoDetection } from "../src/integrations/github/repo-policy.js";
import { repoPolicyPart, repoPolicyRoutes } from "../src/integrations/github/repo-policy-routes.js";
import type { GitHubPullMergeState } from "../src/integrations/types.js";
import { FakeGitHubClient } from "./fixtures/github-fake.js";
import type { FakeGitHubData } from "./fixtures/github-fake.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);
const T0 = "2026-11-04T10:00:00.000Z";
const A = "a".repeat(40);
const B = "b".repeat(40);

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv(T0);
});

afterEach(() => {
  env.cleanup();
});

/** A fake whose `o/r` is a public repo; `over` adds or replaces canned data. */
function fakeFor(over: FakeGitHubData = {}): FakeGitHubClient {
  return new FakeGitHubClient({ repoInfo: { "o/r": { default_branch: "main", private: false } }, ...over });
}

const state = (over: Partial<GitHubPullMergeState> = {}): GitHubPullMergeState => ({ head_sha: A, approvals: 0, changes_requested: false, ci: "green", ...over });

function routeOf(fake: FakeGitHubClient, method: string, path: string): ContributedRoute {
  const found = repoPolicyRoutes({ client: () => fake }).find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

function list(fake = fakeFor()): Promise<ContributedRouteResponse> {
  return routeOf(fake, "GET", "/repos/policy").handler({ params: {}, query: {}, body: undefined, store: env.store, now: env.now });
}

function detect(fake: FakeGitHubClient, owner = "o", repo = "r"): Promise<ContributedRouteResponse> {
  return routeOf(fake, "POST", "/repos/policy/:owner/:repo/detect").handler({ params: { owner, repo }, query: {}, body: undefined, store: env.store, now: env.now });
}

function setPolicy(body: unknown, owner = "o", repo = "r", fake = fakeFor()): Promise<ContributedRouteResponse> {
  return routeOf(fake, "POST", "/repos/policy/:owner/:repo").handler({ params: { owner, repo }, query: {}, body, store: env.store, now: env.now });
}

/** The raw row, outside the module under test. */
function rowOf(repo = "o/r"): Record<string, unknown> | undefined {
  return env.store.prepare("SELECT policy_kind, required_reviews, trust_unprotected, detected_json, set_by, set_at FROM repo_policies WHERE repo = ?").get(repo) as Record<string, unknown> | undefined;
}

function insertRow(kind: string, required: number | null = null, extra: { trust?: number } = {}): void {
  env.store
    .prepare("INSERT INTO repo_policies (repo, policy_kind, required_reviews, trust_unprotected, set_by, set_at) VALUES ('o/r', ?, ?, ?, 'owner', ?)")
    .run(kind, required, extra.trust ?? 0, T0);
}

function approval(over: { action?: string; status?: string; payload?: unknown } = {}): void {
  const payload = over.payload === undefined ? { repo: "o/r", pr: 7, head_sha: A } : over.payload;
  env.store
    .prepare("INSERT INTO approvals (requesting_agent, action, payload_json, status) VALUES ('kernel', ?, ?, ?)")
    .run(over.action ?? MERGE_APPROVAL_ACTION, typeof payload === "string" ? payload : JSON.stringify(payload), over.status ?? "approved");
}

const detection = (over: Partial<RepoDetection> = {}): RepoDetection => ({
  repo: "o/r",
  protection: "protected",
  required_reviews: null,
  required_checks: [],
  pushers: ["o"],
  default_branch: "main",
  private: false,
  read_at: T0,
  ...over,
});

const met = (fake: FakeGitHubClient, head = A, playbook?: string | null) => policyMet("o/r", 7, head, { store: env.store, client: () => fake, now: env.now }, playbook);

// ---------------------------------------------------------------------------
// The closed sets
// ---------------------------------------------------------------------------

describe("the closed sets", () => {
  it("are frozen and have exactly their values; `unset` is a row kind, never a policy kind", () => {
    expect(REPO_POLICY_KINDS).toEqual(["solo", "studio_approval", "reviews"]);
    expect(REPO_POLICY_ROW_KINDS).toEqual(["unset", "solo", "studio_approval", "reviews"]);
    expect(REPO_PROTECTIONS).toEqual(["protected", "unprotected", "protection_unavailable", "unreadable"]);
    expect(REPO_POLICY_CHOICES).toEqual(["make_public_or_upgrade", "trust_unprotected", "safe_mode"]);
    expect(POLICY_NOT_MET_REASONS).toEqual(["no_policy", "head_moved", "ci_not_green", "awaiting_owner_approval", "reviews_short", "changes_requested", "unreadable"]);
    expect(MERGE_APPROVAL_ACTION).toBe("kernel_merge_approval_request");
    for (const list of [REPO_POLICY_KINDS, REPO_POLICY_ROW_KINDS, REPO_PROTECTIONS, REPO_POLICY_CHOICES, POLICY_NOT_MET_REASONS]) expect(Object.isFrozen(list)).toBe(true);
  });

  it("are mirrored by the app contract (the kinds, the protections and the proposal's choices)", () => {
    const text = readFileSync(CONTRACT, "utf8");
    const union = (name: string): string[] => {
      const m = new RegExp(`export type ${name} =([^;]*);`).exec(text);
      if (m === null) throw new Error(`no type ${name}`);
      return [...(m[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1] ?? "");
    };
    expect(union("RepoPolicyKind")).toEqual([...REPO_POLICY_KINDS]);
    expect(union("RepoProtection")).toEqual([...REPO_PROTECTIONS]);
    expect(union("RepoPolicyChoice")).toEqual([...REPO_POLICY_CHOICES]);
    expect(text).toContain("export interface RepoPolicyProposal {");
    expect(text).toMatch(/export interface RepoPolicy \{[^}]*readonly proposal: RepoPolicyProposal \| null;/s);
  });
});

// ---------------------------------------------------------------------------
// AC1, AC2: detection and the proposal
// ---------------------------------------------------------------------------

describe("detection (AC1, AC2)", () => {
  it("AC1: a 403 for a private repo records protection_unavailable and proposes the three choices, picking none; the repo has no policy", async () => {
    const fake = fakeFor({ repoInfo: { "o/r": { default_branch: "main", private: true } }, protection: { "o/r": 403 }, pushers: { "o/r": ["o"] } });
    const res = await detect(fake);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body["kind"]).toBeNull();
    expect(body["proposal"]).toEqual({ kind: null, required_reviews: null, choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"] });
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toEqual({
      repo: "o/r",
      protection: "protection_unavailable",
      required_reviews: null,
      required_checks: [],
      pushers: ["o"],
      default_branch: "main",
      private: true,
      read_at: T0,
    });
    expect(rowOf()).toMatchObject({ policy_kind: "unset", required_reviews: null, trust_unprotected: 0, set_by: null, set_at: null });
    expect(fake.calls.map((c) => c.method)).toEqual(["getRepoInfo", "getBranchProtection", "listPushCollaborators"]);
    expect(fake.callsTo("getBranchProtection")[0]?.args).toEqual(["o/r", "main"]);
  });

  it("AC2: protection requiring 2 approving reviews proposes reviews with N from GitHub; the stored kind stays unset", async () => {
    const fake = fakeFor({ protection: { "o/r": { required_approving_review_count: 2, required_checks: ["ci"] } }, pushers: { "o/r": ["o", "teammate"] } });
    const body = (await detect(fake)).body as { proposal: unknown; kind: unknown };
    expect(body.proposal).toEqual({ kind: "reviews", required_reviews: 2 });
    expect(body.kind).toBeNull();
    expect(rowOf()?.["policy_kind"]).toBe("unset");
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toMatchObject({ protection: "protected", required_reviews: 2, required_checks: ["ci"], pushers: ["o", "teammate"] });
  });

  it("AC2: required check `ci` and only the repo owner pushing proposes solo", async () => {
    const fake = fakeFor({ protection: { "o/r": { required_approving_review_count: null, required_checks: ["ci"] } }, pushers: { "o/r": ["o"] } });
    expect(((await detect(fake)).body as { proposal: unknown }).proposal).toEqual({ kind: "solo", required_reviews: null });
    expect(rowOf()?.["policy_kind"]).toBe("unset");
  });

  it("AC2: a 404 (unprotected) with another pusher proposes studio_approval", async () => {
    const fake = fakeFor({ protection: { "o/r": 404 }, pushers: { "o/r": ["o", "teammate"] } });
    const body = (await detect(fake)).body as { proposal: unknown };
    expect(body.proposal).toEqual({ kind: "studio_approval", required_reviews: null });
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toMatchObject({ protection: "unprotected", required_reviews: null, required_checks: [] });
    expect(rowOf()?.["policy_kind"]).toBe("unset");
  });

  it("the proposal rules, in order (pure): reviews first, solo needs owner-only pushers and checks, unprotected needs another pusher, anything else is null", () => {
    // Reviews are checked first, even when only the owner pushes and checks are required.
    expect(proposeRepoPolicy(detection({ required_reviews: 1, required_checks: ["ci"] }))).toEqual({ kind: "reviews", required_reviews: 1 });
    expect(proposeRepoPolicy(detection({ required_reviews: 0, required_checks: ["ci"] }))).toEqual({ kind: "solo", required_reviews: null });
    // Solo: the owner segment, compared case-insensitively; another pusher, no pushers, or unknown pushers is not solo.
    expect(proposeRepoPolicy(detection({ repo: "Acme/r", required_checks: ["ci"], pushers: ["acme"] }))).toEqual({ kind: "solo", required_reviews: null });
    expect(proposeRepoPolicy(detection({ required_checks: ["ci"], pushers: ["o", "x"] }))).toBeNull();
    expect(proposeRepoPolicy(detection({ required_checks: ["ci"], pushers: [] }))).toBeNull();
    expect(proposeRepoPolicy(detection({ required_checks: ["ci"], pushers: null }))).toBeNull();
    // Protected with no checks and no reviews, unprotected and solo, unreadable: nothing applies.
    expect(proposeRepoPolicy(detection())).toBeNull();
    expect(proposeRepoPolicy(detection({ protection: "unprotected", pushers: ["o"] }))).toBeNull();
    expect(proposeRepoPolicy(detection({ protection: "unprotected", pushers: null }))).toBeNull();
    expect(proposeRepoPolicy(detection({ protection: "unreadable", required_reviews: 3, required_checks: ["ci"], pushers: ["o", "x"] }))).toBeNull();
    // Unavailable protection wins over everything and picks nothing.
    expect(proposeRepoPolicy(detection({ protection: "protection_unavailable", required_reviews: 3, pushers: ["o", "x"] }))).toEqual({
      kind: null,
      required_reviews: null,
      choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"],
    });
    // The choices are present only for protection_unavailable.
    expect("choices" in (proposeRepoPolicy(detection({ required_reviews: 2 })) ?? {})).toBe(false);
  });

  it("a read that fails is recorded, never thrown: a repo that cannot be read, a rate limit and a 500 are `unreadable`; unreadable pushers are null", async () => {
    const noInfo = fakeFor({ repoInfo: {} });
    expect(((await detect(noInfo)).body as { proposal: unknown }).proposal).toBeNull();
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toEqual({
      repo: "o/r",
      protection: "unreadable",
      required_reviews: null,
      required_checks: [],
      pushers: null,
      default_branch: null,
      private: null,
      read_at: T0,
    });
    expect(noInfo.calls.map((c) => c.method)).toEqual(["getRepoInfo"]);

    const limited = fakeFor({ failures: { getBranchProtection: { ok: false, error: "rate_limited", resets_at: T0, rateLimit: { limit: 1, remaining: 0, reset_at: T0 } } } });
    await detect(limited);
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toMatchObject({ protection: "unreadable", default_branch: "main", private: false });

    const server = fakeFor({ protection: { "o/r": 500 }, failures: { listPushCollaborators: { ok: false, error: "unreachable", rateLimit: null } } });
    await detect(server);
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toMatchObject({ protection: "unreadable", pushers: null });
  });

  it("a client that throws is `unreadable` too (the answer is still 200 and typed)", async () => {
    const throwing = { ...fakeFor(), getRepoInfo: () => Promise.reject(new Error("socket hang up")) } as unknown as FakeGitHubClient;
    const res = await routeOf(throwing, "POST", "/repos/policy/:owner/:repo/detect").handler({ params: { owner: "o", repo: "r" }, query: {}, body: undefined, store: env.store, now: env.now });
    expect(res.status).toBe(200);
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toMatchObject({ protection: "unreadable" });
  });

  it("detection never touches the policy the owner set: kind, reviews, trust, set_by and set_at survive, detected_json is replaced", async () => {
    await setPolicy({ kind: "reviews", required: 3, trust_unprotected: true });
    const before = rowOf();
    env.advance(60_000);
    const fake = fakeFor({ protection: { "o/r": { required_approving_review_count: 1, required_checks: [] } } });
    const body = (await detect(fake)).body as { kind: unknown; required_reviews: unknown; trust_unprotected: unknown; set_by: unknown; proposal: unknown };
    expect(body).toMatchObject({ kind: "reviews", required_reviews: 3, trust_unprotected: true, set_by: "owner", proposal: { kind: "reviews", required_reviews: 1 } });
    const after = rowOf();
    expect({ ...after, detected_json: null }).toEqual({ ...before, detected_json: null });
    expect(JSON.parse(String(after?.["detected_json"]))).toMatchObject({ required_reviews: 1, read_at: "2026-11-04T10:01:00.000Z" });
  });

  it("a second detection replaces the first; there is one row per repo", async () => {
    await detect(fakeFor({ protection: { "o/r": 404 }, pushers: { "o/r": ["o", "x"] } }));
    await detect(fakeFor({ protection: { "o/r": 403 } }));
    expect(env.store.prepare("SELECT COUNT(*) AS n FROM repo_policies").get()).toEqual({ n: 1 });
    expect(JSON.parse(String(rowOf()?.["detected_json"]))).toMatchObject({ protection: "protection_unavailable" });
  });

  it("a path segment that is not a repo name is 400 invalid_repo, and no GitHub call is made", async () => {
    for (const [owner, repo] of [["o", "r r"], ["..", "r"], ["o", ".."], ["", "r"], ["o", "r?x=1"], ["o".repeat(101), "r"]] as const) {
      const fake = fakeFor();
      const res = await detect(fake, owner, repo);
      expect(res.status, `${owner}/${repo}`).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_repo" });
      expect(fake.calls).toEqual([]);
    }
    expect(env.store.prepare("SELECT COUNT(*) AS n FROM repo_policies").get()).toEqual({ n: 0 });
  });

  it("a store that fails is a fixed 500 policy_failed that does not carry the error's message", async () => {
    const broken = { ...env.store, prepare: () => { throw new Error("disk I/O error: /secret/path"); } } as unknown as typeof env.store;
    const res = await routeOf(fakeFor(), "POST", "/repos/policy/:owner/:repo/detect").handler({ params: { owner: "o", repo: "r" }, query: {}, body: undefined, store: broken, now: env.now });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "policy_failed", message: "the repo policy could not be read or recorded" });
  });
});

// ---------------------------------------------------------------------------
// AC3, AC4, AC5: policyMet
// ---------------------------------------------------------------------------

describe("policyMet (AC3, AC4, AC5)", () => {
  it("AC3: no row, and an unset row, answer no_policy and make no GitHub call", async () => {
    const fake = fakeFor({ mergeStates: { "o/r#7": state() } });
    expect(await met(fake)).toEqual({ met: false, reason: "no_policy" });
    await detect(fakeFor({ protection: { "o/r": 404 }, pushers: { "o/r": ["o", "x"] } }));
    expect(rowOf()?.["policy_kind"]).toBe("unset");
    expect(await met(fake)).toEqual({ met: false, reason: "no_policy" });
    expect(await met(fake, A, "reviews:1")).toEqual({ met: false, reason: "no_policy" });
    expect(fake.calls).toEqual([]);
  });

  it("a policy kind that is none of the three cannot be read as a policy: unreadable, no GitHub call", async () => {
    insertRow("merge-anyone");
    const fake = fakeFor({ mergeStates: { "o/r#7": state() } });
    expect(await met(fake)).toEqual({ met: false, reason: "unreadable" });
    expect(fake.calls).toEqual([]);
  });

  it("AC4: reviews with required 2: 1 approval is reviews_short, 2 is met; a moved head answers head_moved for the old head and reviews_short for the new; every call re-reads GitHub", async () => {
    insertRow("reviews", 2);
    const fake = fakeFor({ mergeStates: { "o/r#7": state({ approvals: 1 }) } });
    expect(await met(fake)).toEqual({ met: false, reason: "reviews_short" });
    fake.setMergeState("o/r", 7, state({ approvals: 2 }));
    expect(await met(fake)).toEqual({ met: true });
    fake.setMergeState("o/r", 7, state({ head_sha: B, approvals: 0 }));
    expect(await met(fake, A)).toEqual({ met: false, reason: "head_moved" });
    expect(await met(fake, B)).toEqual({ met: false, reason: "reviews_short" });
    expect(fake.callsTo("getPullMergeState")).toHaveLength(4);
    expect(fake.callsTo("getPullMergeState").every((c) => c.args[0] === "o/r" && c.args[1] === 7)).toBe(true);
  });

  it("reviews: nothing may request changes (even with enough approvals), and the reason names it", async () => {
    insertRow("reviews", 1);
    const fake = fakeFor({ mergeStates: { "o/r#7": state({ approvals: 3, changes_requested: true }) } });
    expect(await met(fake)).toEqual({ met: false, reason: "changes_requested" });
  });

  it("reviews: a corrupt row (no usable count) is unreadable, not met", async () => {
    for (const bad of [null, 0, -1, 1.5]) {
      env.store.prepare("DELETE FROM repo_policies").run();
      env.store.prepare("INSERT INTO repo_policies (repo, policy_kind, required_reviews) VALUES ('o/r', 'reviews', ?)").run(bad);
      expect(await met(fakeFor({ mergeStates: { "o/r#7": state({ approvals: 9 }) } })), String(bad)).toEqual({ met: false, reason: "unreadable" });
    }
  });

  it("AC5: solo is met only when CI is green; pending, failing and none are ci_not_green", async () => {
    insertRow("solo");
    for (const ci of ["pending", "failing", "none"] as const) {
      expect(await met(fakeFor({ mergeStates: { "o/r#7": state({ ci }) } })), ci).toEqual({ met: false, reason: "ci_not_green" });
    }
    expect(await met(fakeFor({ mergeStates: { "o/r#7": state({ ci: "green" }) } }))).toEqual({ met: true });
  });

  it("solo: a moved head is checked before CI", async () => {
    insertRow("solo");
    expect(await met(fakeFor({ mergeStates: { "o/r#7": state({ head_sha: B, ci: "failing" }) } }), A)).toEqual({ met: false, reason: "head_moved" });
  });

  it("AC5: studio_approval is met only by an approved kernel_merge_approval_request for this repo, PR and head", async () => {
    insertRow("studio_approval");
    const fake = fakeFor({ mergeStates: { "o/r#7": state({ ci: "failing" }) } });
    expect(await met(fake)).toEqual({ met: false, reason: "awaiting_owner_approval" });
    // None of these is the owner's approval of this head.
    approval({ status: "pending" });
    approval({ status: "denied" });
    approval({ action: "kernel_github_pr_comment" });
    approval({ payload: { repo: "o/other", pr: 7, head_sha: A } });
    approval({ payload: { repo: "o/r", pr: 8, head_sha: A } });
    approval({ payload: "not json {" });
    approval({ payload: { repo: "o/r", pr: "7", head_sha: A } });
    expect(await met(fake)).toEqual({ met: false, reason: "awaiting_owner_approval" });
    // The exact one, approved: met whatever the CI says (the owner's approval is the policy).
    approval();
    expect(await met(fake)).toEqual({ met: true });
    // A different head has no approval of its own.
    fake.setMergeState("o/r", 7, state({ head_sha: B }));
    expect(await met(fake, B)).toEqual({ met: false, reason: "awaiting_owner_approval" });
    expect(await met(fake, A)).toEqual({ met: false, reason: "head_moved" });
  });

  it("a GitHub failure is unreadable (a 404 pull, a rate limit, no connection), never met and never thrown", async () => {
    insertRow("solo");
    expect(await met(fakeFor())).toEqual({ met: false, reason: "unreadable" });
    const limited = fakeFor({ mergeStates: { "o/r#7": state() }, failures: { getPullMergeState: { ok: false, error: "rate_limited", resets_at: T0, rateLimit: { limit: 1, remaining: 0, reset_at: T0 } } } });
    expect(await met(limited)).toEqual({ met: false, reason: "unreadable" });
    const throwing = { getPullMergeState: () => Promise.reject(new Error("boom")) } as unknown as FakeGitHubClient;
    expect(await met(throwing)).toEqual({ met: false, reason: "unreadable" });
    const noStore = await policyMet("o/r", 7, A, { store: { prepare: () => { throw new Error("closed"); } } as unknown as typeof env.store, client: () => fakeFor() });
    expect(noStore).toEqual({ met: false, reason: "unreadable" });
  });

  it("a playbook's requirement only adds to the repo's policy", async () => {
    // solo + reviews:2: CI green is not enough.
    insertRow("solo");
    const fake = fakeFor({ mergeStates: { "o/r#7": state({ approvals: 1 }) } });
    expect(await met(fake, A, "none")).toEqual({ met: true });
    expect(await met(fake, A, null)).toEqual({ met: true });
    expect(await met(fake, A, "reviews:2")).toEqual({ met: false, reason: "reviews_short" });
    expect(await met(fake, A, "reviews:1")).toEqual({ met: true });
    fake.setMergeState("o/r", 7, state({ approvals: 5, changes_requested: true }));
    expect(await met(fake, A, "reviews:2")).toEqual({ met: false, reason: "changes_requested" });
    // solo + studio_approval: the owner's approval is needed as well as CI.
    fake.setMergeState("o/r", 7, state({ ci: "green" }));
    expect(await met(fake, A, "studio_approval")).toEqual({ met: false, reason: "awaiting_owner_approval" });
    approval();
    expect(await met(fake, A, "studio_approval")).toEqual({ met: true });
    fake.setMergeState("o/r", 7, state({ ci: "pending" }));
    expect(await met(fake, A, "studio_approval")).toEqual({ met: false, reason: "ci_not_green" });
  });

  it("reviews:N raises the approvals needed to max(N, the repo's N), never lowers them", async () => {
    insertRow("reviews", 2);
    const fake = fakeFor({ mergeStates: { "o/r#7": state({ approvals: 2 }) } });
    expect(await met(fake, A, "reviews:1")).toEqual({ met: true });
    expect(await met(fake, A, "reviews:2")).toEqual({ met: true });
    expect(await met(fake, A, "reviews:3")).toEqual({ met: false, reason: "reviews_short" });
    fake.setMergeState("o/r", 7, state({ approvals: 1 }));
    expect(await met(fake, A, "reviews:1")).toEqual({ met: false, reason: "reviews_short" });
    // studio_approval on a reviews repo adds the approval on top of the reviews.
    fake.setMergeState("o/r", 7, state({ approvals: 2 }));
    expect(await met(fake, A, "studio_approval")).toEqual({ met: false, reason: "awaiting_owner_approval" });
    approval();
    expect(await met(fake, A, "studio_approval")).toEqual({ met: true });
  });

  it("a requirement that is none of none / studio_approval / reviews:<N> is unreadable (fail closed), with no GitHub call", async () => {
    insertRow("solo");
    const fake = fakeFor({ mergeStates: { "o/r#7": state() } });
    for (const bad of ["reviews:0", "reviews:x", "reviews:-1", "reviews:01", "reviews:", "solo", "", "reviews:1e3"]) {
      expect(await met(fake, A, bad), bad).toEqual({ met: false, reason: "unreadable" });
    }
    expect(fake.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC6: the owner routes
// ---------------------------------------------------------------------------

describe("POST /repos/policy/:owner/:repo (AC6)", () => {
  it("sets reviews with its count: the row reads reviews, 2, set_by owner, set_at now", async () => {
    const res = await setPolicy({ kind: "reviews", required: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ repo: "o/r", kind: "reviews", required_reviews: 2, trust_unprotected: false, set_by: "owner", set_at: T0, detected: null, proposal: null });
    expect(rowOf()).toMatchObject({ policy_kind: "reviews", required_reviews: 2, trust_unprotected: 0, set_by: "owner", set_at: T0 });
    expect(getRepoPolicy(env.store, "o/r")).toEqual(res.body);
  });

  it("refuses, with 400 and no change: reviews without required, solo with required, an unknown kind, a bad count, extra keys, a non-object body", async () => {
    const bad: unknown[] = [
      { kind: "reviews" },
      { kind: "solo", required: 1 },
      { kind: "studio_approval", required: 0 },
      { kind: "other" },
      { kind: "unset" },
      { kind: null },
      {},
      { required: 2 },
      { kind: "reviews", required: 0 },
      { kind: "reviews", required: -1 },
      { kind: "reviews", required: 1.5 },
      { kind: "reviews", required: "2" },
      { kind: "reviews", required: Number.NaN },
      { kind: "reviews", required: 2, trust_unprotected: "yes" },
      { kind: "solo", trust_unprotected: 1 },
      { kind: "solo", set_by: "wright" },
      "reviews",
      [],
      null,
      undefined,
    ];
    for (const body of bad) {
      const res = await setPolicy(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_body" });
    }
    expect(rowOf()).toBeUndefined();
    // And over an existing policy, a refused body changes nothing.
    await setPolicy({ kind: "solo" });
    const before = rowOf();
    for (const body of bad) await setPolicy(body);
    expect(rowOf()).toEqual(before);
  });

  it("a path that is not a repo name is 400 invalid_repo and writes nothing", async () => {
    const res = await setPolicy({ kind: "solo" }, "o", "r/x");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_repo" });
    expect((await setPolicy({ kind: "solo" }, "..", "r")).status).toBe(400);
    expect(env.store.prepare("SELECT COUNT(*) AS n FROM repo_policies").get()).toEqual({ n: 0 });
  });

  it("studio_approval with trust_unprotected is recorded, and loomwrightMergeFlags answers the flag for that repo only", async () => {
    await setPolicy({ kind: "studio_approval", trust_unprotected: true });
    expect(rowOf()).toMatchObject({ policy_kind: "studio_approval", required_reviews: null, trust_unprotected: 1, set_by: "owner" });
    expect(loomwrightMergeFlags(env.store, "o/r")).toEqual(["--trust-unprotected"]);
    expect(loomwrightMergeFlags(env.store, "o/other")).toEqual([]);
    expect(loomwrightMergeFlags(env.store, "not a repo")).toEqual([]);
  });

  it("an omitted trust_unprotected keeps the recorded choice; an explicit false clears it; a new kind drops a stale count", async () => {
    await setPolicy({ kind: "reviews", required: 2, trust_unprotected: true });
    env.advance(1000);
    const res = await setPolicy({ kind: "solo" });
    expect(res.body).toMatchObject({ kind: "solo", required_reviews: null, trust_unprotected: true, set_at: "2026-11-04T10:00:01.000Z" });
    expect(rowOf()?.["required_reviews"]).toBeNull();
    expect(loomwrightMergeFlags(env.store, "o/r")).toEqual(["--trust-unprotected"]);
    await setPolicy({ kind: "solo", trust_unprotected: false });
    expect(loomwrightMergeFlags(env.store, "o/r")).toEqual([]);
  });

  it("setting a policy on a detected repo keeps its detection and turns the unset row into a policy", async () => {
    await detect(fakeFor({ protection: { "o/r": { required_approving_review_count: 2, required_checks: [] } } }));
    const detected = rowOf()?.["detected_json"];
    const res = await setPolicy({ kind: "reviews", required: 2 });
    expect(res.body).toMatchObject({ kind: "reviews", required_reviews: 2, proposal: { kind: "reviews", required_reviews: 2 } });
    expect(rowOf()?.["detected_json"]).toBe(detected);
  });

  it("a policy set by the owner is what policyMet then reads", async () => {
    await setPolicy({ kind: "reviews", required: 1 });
    expect(await met(fakeFor({ mergeStates: { "o/r#7": state({ approvals: 1 }) } }))).toEqual({ met: true });
  });
});

describe("GET /repos/policy", () => {
  it("is empty with nothing reached and no rows", async () => {
    const res = await list();
    expect(res).toEqual({ status: 200, body: { repos: [] } });
  });

  it("is the union of the connector's reachable repos and the stored rows, sorted, each with detected, proposal and the set policy; it makes no GitHub call", async () => {
    env.store
      .prepare(
        `INSERT INTO connectors (kind, status, account_login, reachable_repos_json, created_at, updated_at)
         VALUES ('github', 'connected', 'o', '["o/b-reached","o/r","not a repo"]', ?, ?)`,
      )
      .run(T0, T0);
    await detect(fakeFor({ protection: { "o/r": 403 } }));
    await setPolicy({ kind: "solo" }, "o", "z-only-stored");
    const fake = fakeFor();
    const res = await list(fake);
    expect(res.status).toBe(200);
    const repos = (res.body as { repos: { repo: string; kind: unknown; detected: unknown; proposal: unknown; set_by: unknown }[] }).repos;
    expect(repos.map((r) => r.repo)).toEqual(["o/b-reached", "o/r", "o/z-only-stored"]);
    expect(repos[0]).toEqual({ repo: "o/b-reached", kind: null, required_reviews: null, trust_unprotected: false, detected: null, proposal: null, set_by: null, set_at: null });
    expect(repos[1]).toMatchObject({ repo: "o/r", kind: null, set_by: null, proposal: { kind: null, choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"] } });
    expect(repos[1]?.detected).toMatchObject({ protection: "protection_unavailable" });
    expect(repos[2]).toMatchObject({ repo: "o/z-only-stored", kind: "solo", set_by: "owner", detected: null, proposal: null });
    expect(fake.calls).toEqual([]);
  });

  it("a stored detection that does not have the detection shape is shown as stored, with no proposal made from it", async () => {
    env.store.prepare("INSERT INTO repo_policies (repo, policy_kind, detected_json) VALUES ('o/r', 'unset', ?)").run('{"protection":"???"}');
    env.store.prepare("INSERT INTO repo_policies (repo, policy_kind, detected_json) VALUES ('o/s', 'unset', 'not json')").run();
    env.store.prepare("INSERT INTO repo_policies (repo, policy_kind, detected_json) VALUES ('o/t', 'unset', '[1,2]')").run();
    env.store.prepare("INSERT INTO repo_policies (repo, policy_kind, required_reviews) VALUES ('o/u', 'reviews', NULL)").run();
    const repos = ((await list()).body as { repos: { repo: string; kind: unknown; required_reviews: unknown; detected: unknown; proposal: unknown }[] }).repos;
    expect(repos.map((r) => [r.repo, r.detected, r.proposal])).toEqual([
      ["o/r", { protection: "???" }, null],
      ["o/s", null, null],
      ["o/t", null, null],
      ["o/u", null, null],
    ]);
    // A reviews row with no count is shown as stored (policyMet treats it as unreadable).
    expect(repos[3]).toMatchObject({ kind: "reviews", required_reviews: null });
  });
});

// ---------------------------------------------------------------------------
// AC8, AC11: owner-only, served as the contract says
// ---------------------------------------------------------------------------

describe("no agent tool (AC8) and the shipped composition (AC11)", () => {
  it("repoPolicyPart contributes exactly the three owner routes and no tool, subcommand, handler or due work", () => {
    expect(repoPolicyPart.name).toBe("repo-policy");
    expect(repoPolicyPart.tools).toEqual([]);
    expect(Object.isFrozen(repoPolicyPart.tools)).toBe(true);
    expect(repoPolicyPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /repos/policy", "POST /repos/policy/:owner/:repo/detect", "POST /repos/policy/:owner/:repo"]);
    expect(repoPolicyPart.routes.every((r) => r.unauthenticated === undefined)).toBe(true);
    expect(repoPolicyPart.subcommands ?? []).toEqual([]);
    expect(repoPolicyPart.handlers).toEqual({});
    expect(repoPolicyPart.dueWork ?? []).toEqual([]);
    expect(Object.isFrozen(repoPolicyPart)).toBe(true);
  });

  it("no merged tool's name or description sets or changes a repo's policy", () => {
    const merged = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED);
    expect(merged.tools.length).toBeGreaterThan(0);
    for (const tool of merged.tools) {
      const text = `${tool.name} ${tool.description}`;
      expect(text, tool.name).not.toMatch(/repo.{0,12}polic|merge.{0,12}polic|polic.{0,20}(repo|merge)|trust.?unprotected|repos\/policy/i);
    }
  });

  it("the three routes are served by the shipped composition under the integrations owner, token-gated", () => {
    const merged = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED);
    const served = merged.routes.filter((r) => r.path.startsWith("/repos/policy"));
    expect(served.map((r) => `${r.owner} ${r.method} ${r.path}`)).toEqual([
      "integrations GET /repos/policy",
      "integrations POST /repos/policy/:owner/:repo/detect",
      "integrations POST /repos/policy/:owner/:repo",
    ]);
    expect(served.every((r) => r.unauthenticated !== true)).toBe(true);
  });

  it("no session tool or playbook module can set a policy: none names setRepoPolicy (the routes' writer)", () => {
    const sources = ["../src/integrations/github/tools.ts", "../src/integrations/github/write-tools.ts", "../src/integrations/mcp/tools.ts", "../src/playbooks/enable.ts", "../src/playbooks/drafts.ts"];
    for (const file of sources) expect(readFileSync(new URL(file, import.meta.url), "utf8"), file).not.toMatch(/setRepoPolicy|parseRepoPolicyBody/);
  });
});
