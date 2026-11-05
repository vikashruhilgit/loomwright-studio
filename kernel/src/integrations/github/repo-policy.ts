// The per-repo merge policy (phase 8 item 08, D40): detect a repo's real state
// from GitHub, propose a policy from it, record the owner's choice, and answer
// whether one pull request at one head SHA meets the policy. Mechanism only
// (invariant 1): the kernel ships no policy and no number. A proposal is a
// suggestion the owner accepts or changes; the kernel never applies it, and
// nothing here merges anything (invariant 4). The routes are
// `repo-policy-routes.ts`; there is no agent tool.
//
// A repo's policy lives in `repo_policies` (migration 20). Detection needs a row
// to live on while the owner has set nothing, and `policy_kind` is NOT NULL, so a
// detected repo with no policy holds the sentinel `unset`. `unset` is closed in
// code beside the three kinds (`REPO_POLICY_ROW_KINDS`) and always reads as
// `kind: null` and `no_policy`, exactly like no row at all.
//
// What `detected_json` records (`RepoDetection`): `protection` is `protected`,
// `unprotected` (GitHub answered 404 for the default branch's protection),
// `protection_unavailable` (403 on a repo whose info says `private`: GitHub cannot
// enforce protection here, a private repo on GitHub Free; a 403 on a public repo is a
// token lacking administration:read and reads `unreadable`) or `unreadable` (anything else); `required_reviews` and
// `required_checks` from the protection; `pushers` (the push collaborators, `null`
// when unreadable); `default_branch`, `private` and `read_at`. Honest limits: a private
// repo read with a permission-less token also answers 403, so it still reads
// `protection_unavailable`; a 404
// can also mean the token may not read protection at all, so `unprotected` is the
// read, not a guarantee; it only changes a suggestion, never a policy.
//
// `policyMet` re-reads GitHub on every call (no cache) and answers
// `{met: true}` or `{met: false, reason}`; it never throws. A playbook's own
// `merge_requirement` can only add to its repo's policy. `loomwrightMergeFlags`
// exposes the repo's recorded `trust_unprotected` choice as the flag item 09
// passes to Loomwright's merge gate.
//
// The `studio` CLI loads it, so it imports only types, the store type, the
// Keychain module and the GitHub client modules: never the Agent SDK, the
// session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
import { securityCliKeychain } from "../../auth/keychain.js";
import type { Store } from "../../store/store.js";
import type { GitHubPullMergeState, GitHubRepoPolicyReads } from "../types.js";
import { githubAppTokens } from "./app-token.js";
import { NAME_SEGMENT, createGitHubClient, resolveGitHubTokenProvider } from "./client.js";

// ---- Closed sets -----------------------------------------------------------------

/** Every policy kind the owner can set, closed in code (`repo_policies.policy_kind` has no SQL CHECK). */
export const REPO_POLICY_KINDS = Object.freeze(["solo", "studio_approval", "reviews"] as const);

/** One of `REPO_POLICY_KINDS`. */
export type RepoPolicyKind = (typeof REPO_POLICY_KINDS)[number];

/** Every value `repo_policies.policy_kind` holds: `unset` (a detected repo with no policy) beside the three kinds. */
export const REPO_POLICY_ROW_KINDS = Object.freeze(["unset", "solo", "studio_approval", "reviews"] as const);

/** One of `REPO_POLICY_ROW_KINDS`. */
export type RepoPolicyRowKind = (typeof REPO_POLICY_ROW_KINDS)[number];

/** What detection records for the default branch's protection. */
export const REPO_PROTECTIONS = Object.freeze(["protected", "unprotected", "protection_unavailable", "unreadable"] as const);

/** One of `REPO_PROTECTIONS`. */
export type RepoProtection = (typeof REPO_PROTECTIONS)[number];

/** The choices a proposal offers where GitHub cannot enforce protection; none is picked for the owner. */
export const REPO_POLICY_CHOICES = Object.freeze(["make_public_or_upgrade", "trust_unprotected", "safe_mode"] as const);

/** One of `REPO_POLICY_CHOICES`. */
export type RepoPolicyChoice = (typeof REPO_POLICY_CHOICES)[number];

/** Why `policyMet` answers not met. */
export const POLICY_NOT_MET_REASONS = Object.freeze([
  "no_policy",
  "head_moved",
  "ci_not_green",
  "awaiting_owner_approval",
  "reviews_short",
  "changes_requested",
  "unreadable",
] as const);

/** One of `POLICY_NOT_MET_REASONS`. */
export type PolicyNotMetReason = (typeof POLICY_NOT_MET_REASONS)[number];

/** The `approvals.action` of the owner's merge approval (item 09 files it; payload `repo`, `pr`, `head_sha`). */
export const MERGE_APPROVAL_ACTION = "kernel_merge_approval_request";

/** The flag Loomwright's merge gate takes to waive its protection condition for a repo the owner trusts unprotected. */
const TRUST_UNPROTECTED_FLAG = "--trust-unprotected";

// ---- Shapes ----------------------------------------------------------------------

/** What one detection read of a repo found (the `detected_json` document). */
export interface RepoDetection {
  /** `<owner>/<repo>`. */
  readonly repo: string;
  readonly protection: RepoProtection;
  /** The approvals the default branch's protection requires; `null` with no review rule, or when protection was not read. */
  readonly required_reviews: number | null;
  readonly required_checks: readonly string[];
  /** The logins that can push; `null` when GitHub would not say. */
  readonly pushers: readonly string[] | null;
  readonly default_branch: string | null;
  readonly private: boolean | null;
  /** ISO time of the read. */
  readonly read_at: string;
}

/** A policy suggestion made from a detection. `choices` is present only where GitHub cannot enforce protection, and then `kind` is `null`: none is picked. */
export interface RepoPolicyProposal {
  readonly kind: RepoPolicyKind | null;
  readonly required_reviews: number | null;
  readonly choices?: readonly RepoPolicyChoice[];
}

/** A repo's policy as the routes answer it (the contract's `RepoPolicy`). `kind` is `null` for no row and for `unset`. */
export interface RepoPolicyView {
  readonly repo: string;
  readonly kind: RepoPolicyKind | null;
  readonly required_reviews: number | null;
  readonly trust_unprotected: boolean;
  readonly detected: Readonly<Record<string, unknown>> | null;
  readonly proposal: RepoPolicyProposal | null;
  readonly set_by: string | null;
  readonly set_at: string | null;
}

/** `policyMet`'s answer. */
export type PolicyMet = { readonly met: true } | { readonly met: false; readonly reason: PolicyNotMetReason };

/** What detection and `policyMet` read GitHub through, and the clock. */
export interface RepoPolicyDeps {
  /** The GitHub reads. Default: a client over the stored credential (`createRepoPolicyClient`). */
  readonly client?: () => GitHubRepoPolicyReads;
  readonly now?: () => Date;
}

/** `policyMet`'s dependencies: the store holds the policy and the owner's approvals. */
export interface PolicyMetDeps extends RepoPolicyDeps {
  readonly store: Store;
}

/** What the owner sets for a repo (`setRepoPolicy`); already checked by the caller (`parseRepoPolicyBody`). */
export interface RepoPolicyInput {
  readonly kind: RepoPolicyKind;
  /** The approvals `reviews` needs; `undefined` for the other kinds. */
  readonly required?: number;
  /** Absent leaves the recorded choice as it was. */
  readonly trust_unprotected?: boolean;
}

// ---- The GitHub client -------------------------------------------------------------

/**
 * A GitHub client over the stored credential (the PAT, else the App's installation
 * token: `resolveGitHubTokenProvider`) with the repo-policy reads. The same holder
 * as `createResolvingGitHubClient` (`connector.ts`, typed `GitHubClient` only, so
 * it cannot hand out these reads). Nothing runs until a read is called.
 */
export function createRepoPolicyClient(): GitHubRepoPolicyReads {
  const keychain = securityCliKeychain();
  return createGitHubClient({ keychain, tokenProvider: resolveGitHubTokenProvider(keychain, githubAppTokens) });
}

// ---- Names -----------------------------------------------------------------------

/** Whether `repo` is `<owner>/<repo>` in GitHub's characters, with neither segment `.` or `..`. */
export function isRepoName(repo: unknown): repo is string {
  if (typeof repo !== "string") return false;
  const parts = repo.split("/");
  return parts.length === 2 && parts.every((seg) => NAME_SEGMENT.test(seg) && seg !== "." && seg !== "..");
}

// ---- Stored rows -----------------------------------------------------------------

interface PolicyRow {
  readonly repo: string;
  readonly policy_kind: string;
  readonly required_reviews: number | null;
  readonly trust_unprotected: number;
  readonly detected_json: string | null;
  readonly set_by: string | null;
  readonly set_at: string | null;
}

const COLUMNS = "repo, policy_kind, required_reviews, trust_unprotected, detected_json, set_by, set_at";

function rowOf(store: Store, repo: string): PolicyRow | undefined {
  return store.prepare<[string], PolicyRow>(`SELECT ${COLUMNS} FROM repo_policies WHERE repo = ?`).get(repo);
}

function kindOf(row: PolicyRow | undefined): RepoPolicyKind | null {
  return row !== undefined && (REPO_POLICY_KINDS as readonly string[]).includes(row.policy_kind) ? (row.policy_kind as RepoPolicyKind) : null;
}

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

/** A stored `detected_json` as a plain object, or `null` when it is absent or not one. */
function parseDetected(json: string | null): Record<string, unknown> | null {
  if (json === null) return null;
  try {
    const v: unknown = JSON.parse(json);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A stored detection checked against the `RepoDetection` shape, or `null` when it does not have it (no proposal is made from it). */
function asDetection(d: Record<string, unknown> | null): RepoDetection | null {
  if (d === null) return null;
  const ok =
    typeof d["repo"] === "string" &&
    (REPO_PROTECTIONS as readonly unknown[]).includes(d["protection"]) &&
    (d["required_reviews"] === null || isCount(d["required_reviews"])) &&
    isStringList(d["required_checks"]) &&
    (d["pushers"] === null || isStringList(d["pushers"])) &&
    (d["default_branch"] === null || typeof d["default_branch"] === "string") &&
    (d["private"] === null || typeof d["private"] === "boolean") &&
    typeof d["read_at"] === "string";
  return ok ? (d as unknown as RepoDetection) : null;
}

function viewOf(repo: string, row: PolicyRow | undefined): RepoPolicyView {
  const kind = kindOf(row);
  const detected = parseDetected(row?.detected_json ?? null);
  const detection = asDetection(detected);
  return {
    repo,
    kind,
    required_reviews: kind === "reviews" ? (row?.required_reviews ?? null) : null,
    trust_unprotected: row?.trust_unprotected === 1,
    detected,
    proposal: detection === null ? null : proposeRepoPolicy(detection),
    set_by: row?.set_by ?? null,
    set_at: row?.set_at ?? null,
  };
}

/**
 * `repo`'s policy as the routes answer it: what is stored, with the proposal made
 * from the stored detection. No row and an `unset` row both read `kind: null`.
 * Reads only the store.
 */
export function getRepoPolicy(store: Store, repo: string): RepoPolicyView {
  return viewOf(repo, rowOf(store, repo));
}

/** Every `repo_policies` row as a view, ordered by repo. */
export function listRepoPolicies(store: Store): readonly RepoPolicyView[] {
  return store
    .prepare<[], PolicyRow>(`SELECT ${COLUMNS} FROM repo_policies ORDER BY repo`)
    .all()
    .map((row) => viewOf(row.repo, row));
}

/**
 * The flags item 09 passes to Loomwright's merge gate for `repo`:
 * `["--trust-unprotected"]` when the owner recorded that choice, else `[]`. Waives
 * Loomwright's protection condition only, never anything else.
 */
export function loomwrightMergeFlags(store: Store, repo: string): readonly string[] {
  return rowOf(store, repo)?.trust_unprotected === 1 ? [TRUST_UNPROTECTED_FLAG] : [];
}

// ---- Detection -------------------------------------------------------------------

/** The default client is built once, on first use. */
let defaultClient: GitHubRepoPolicyReads | undefined;

function clientOf(deps: RepoPolicyDeps): GitHubRepoPolicyReads {
  if (deps.client !== undefined) return deps.client();
  defaultClient ??= createRepoPolicyClient();
  return defaultClient;
}

/** Reads the repo's state from GitHub: the repo, its default branch's protection and its push collaborators. Never throws. */
async function readDetection(repo: string, reads: GitHubRepoPolicyReads, at: Date): Promise<RepoDetection> {
  const nothing: RepoDetection = {
    repo,
    protection: "unreadable",
    required_reviews: null,
    required_checks: [],
    pushers: null,
    default_branch: null,
    private: null,
    read_at: at.toISOString(),
  };
  try {
    const info = await reads.getRepoInfo(repo);
    if (!info.ok) return nothing;
    const protection = await reads.getBranchProtection(repo, info.data.default_branch);
    const pushers = await reads.listPushCollaborators(repo);
    const found = { ...nothing, default_branch: info.data.default_branch, private: info.data.private, pushers: pushers.ok ? [...pushers.data] : null };
    if (protection.ok) {
      return { ...found, protection: "protected", required_reviews: protection.data.required_approving_review_count, required_checks: [...protection.data.required_checks] };
    }
    if (protection.error === "http_error" && protection.status === 404) return { ...found, protection: "unprotected" };
    // A 403 means "GitHub cannot enforce protection here" only on a private repo; on a public one it is a token without administration:read, so it stays unreadable.
    if (protection.error === "http_error" && protection.status === 403 && info.data.private === true) return { ...found, protection: "protection_unavailable" };
    return found;
  } catch {
    return nothing;
  }
}

/**
 * Reads `repo`'s real state from GitHub and records it as `detected_json`. A repo
 * with no row gets one with `policy_kind = 'unset'`; an existing row keeps its
 * `policy_kind`, `required_reviews`, `trust_unprotected`, `set_by` and `set_at`
 * untouched. Answers the policy as the routes show it. A GitHub failure is
 * recorded as `protection: "unreadable"`, never thrown; a malformed `repo` throws `RangeError`.
 */
export async function detectRepoPolicy(store: Store, repo: string, deps: RepoPolicyDeps = {}): Promise<RepoPolicyView> {
  if (!isRepoName(repo)) throw new RangeError("repo must be <owner>/<repo>");
  const detection = await readDetection(repo, clientOf(deps), (deps.now ?? (() => new Date()))());
  store
    .prepare<[string, string]>("INSERT INTO repo_policies (repo, policy_kind, detected_json) VALUES (?, 'unset', ?) ON CONFLICT(repo) DO UPDATE SET detected_json = excluded.detected_json")
    .run(repo, JSON.stringify(detection));
  return getRepoPolicy(store, repo);
}

// ---- Proposal --------------------------------------------------------------------

/**
 * The policy a detection suggests, or `null` when none applies. Pure; the kernel
 * never applies it.
 *
 * 1. `protection_unavailable`: no kind, and the choices the owner picks from (none is picked).
 * 2. Protection requires N >= 1 approving reviews: `reviews` with N from GitHub.
 * 3. The repo's owner (the `<owner>` of `<owner>/<repo>`) is the only one who can push, and protection requires checks: `solo`.
 * 4. Unprotected, and someone other than the owner can push: `studio_approval`.
 * 5. Anything else (unreadable, unprotected and solo, protected with no checks and no reviews): `null`.
 */
export function proposeRepoPolicy(detection: RepoDetection): RepoPolicyProposal | null {
  if (detection.protection === "protection_unavailable") {
    return { kind: null, required_reviews: null, choices: [...REPO_POLICY_CHOICES] };
  }
  if (detection.protection === "protected" && detection.required_reviews !== null && detection.required_reviews >= 1) {
    return { kind: "reviews", required_reviews: detection.required_reviews };
  }
  const owner = detection.repo.split("/")[0]?.toLowerCase() ?? "";
  const pushers = detection.pushers;
  const onlyOwnerPushes = pushers !== null && pushers.length >= 1 && pushers.every((login) => login.toLowerCase() === owner);
  if (detection.protection === "protected" && onlyOwnerPushes && detection.required_checks.length > 0) {
    return { kind: "solo", required_reviews: null };
  }
  if (detection.protection === "unprotected" && pushers !== null && pushers.some((login) => login.toLowerCase() !== owner)) {
    return { kind: "studio_approval", required_reviews: null };
  }
  return null;
}

// ---- Setting a policy ------------------------------------------------------------

/**
 * Records the owner's policy for `repo` (`set_by = 'owner'`, `set_at` = now) and
 * answers it. `detected_json` is left as it is; an omitted `trust_unprotected`
 * leaves the recorded choice as it was. The caller has checked `input`
 * (`parseRepoPolicyBody`); a malformed `repo` throws `RangeError`.
 */
export function setRepoPolicy(store: Store, repo: string, input: RepoPolicyInput, now: () => Date): RepoPolicyView {
  if (!isRepoName(repo)) throw new RangeError("repo must be <owner>/<repo>");
  const trust = input.trust_unprotected === undefined ? null : input.trust_unprotected ? 1 : 0;
  store
    .prepare<[string, string, number | null, number | null, string, number | null]>(
      `INSERT INTO repo_policies (repo, policy_kind, required_reviews, trust_unprotected, set_by, set_at)
       VALUES (?, ?, ?, COALESCE(?, 0), 'owner', ?)
       ON CONFLICT(repo) DO UPDATE SET
         policy_kind = excluded.policy_kind,
         required_reviews = excluded.required_reviews,
         trust_unprotected = COALESCE(?, trust_unprotected),
         set_by = excluded.set_by,
         set_at = excluded.set_at`,
    )
    .run(repo, input.kind, input.kind === "reviews" ? (input.required ?? null) : null, trust, now().toISOString(), trust);
  return getRepoPolicy(store, repo);
}

/**
 * The owner's set-policy body, checked: `kind` one of the three kinds; `reviews`
 * needs `required` as a whole number >= 1, the other kinds refuse `required`;
 * `trust_unprotected` an optional boolean; no other key. A failure is the message to answer.
 */
export function parseRepoPolicyBody(body: unknown): { readonly ok: true; readonly value: RepoPolicyInput } | { readonly ok: false; readonly message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, message: 'needs {"kind": "solo" | "studio_approval" | "reviews", "required"?, "trust_unprotected"?}' };
  const b = body as Record<string, unknown>;
  const unknownKey = Object.keys(b).find((k) => k !== "kind" && k !== "required" && k !== "trust_unprotected");
  if (unknownKey !== undefined) return { ok: false, message: "kind, required and trust_unprotected are the only fields" };
  const kind = b["kind"];
  if (typeof kind !== "string" || !(REPO_POLICY_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: `kind must be one of ${REPO_POLICY_KINDS.join(", ")}` };
  }
  const required = b["required"];
  if (kind === "reviews") {
    if (typeof required !== "number" || !Number.isSafeInteger(required) || required < 1) return { ok: false, message: "reviews needs required as a whole number of at least 1" };
  } else if (required !== undefined) {
    return { ok: false, message: `${kind} takes no required` };
  }
  const trust = b["trust_unprotected"];
  if (trust !== undefined && typeof trust !== "boolean") return { ok: false, message: "trust_unprotected must be true or false" };
  return {
    ok: true,
    value: {
      kind: kind as RepoPolicyKind,
      ...(kind === "reviews" ? { required: required as number } : {}),
      ...(trust === undefined ? {} : { trust_unprotected: trust }),
    },
  };
}

// ---- Is the policy met? ----------------------------------------------------------

/** A playbook's `merge_requirement` (`none`, `studio_approval` or `reviews:<N>`, N >= 1), parsed; `undefined` when it is none of those. */
function parseRequirement(v: string | null | undefined): { readonly kind: "none" | "studio_approval" | "reviews"; readonly reviews: number } | undefined {
  if (v === undefined || v === null || v === "none") return { kind: "none", reviews: 0 };
  if (v === "studio_approval") return { kind: "studio_approval", reviews: 0 };
  const m = /^reviews:([1-9][0-9]{0,8})$/.exec(v);
  return m === null ? undefined : { kind: "reviews", reviews: Number(m[1]) };
}

/** Whether the owner approved merging `repo`#`pr` at `headSha`: an approved `MERGE_APPROVAL_ACTION` approval whose payload names exactly that. */
function hasMergeApproval(store: Store, repo: string, pr: number, headSha: string): boolean {
  const found = store
    .prepare<[string, string, number, string], { readonly one: number }>(
      `SELECT 1 AS one FROM approvals
       WHERE action = ? AND status = 'approved'
         AND CASE WHEN json_valid(payload_json)
               THEN json_extract(payload_json, '$.repo') = ? AND json_extract(payload_json, '$.pr') = ? AND json_extract(payload_json, '$.head_sha') = ?
               ELSE 0 END
       LIMIT 1`,
    )
    .get(MERGE_APPROVAL_ACTION, repo, pr, headSha);
  return found !== undefined;
}

function reviewsMet(state: GitHubPullMergeState, needed: number): PolicyMet {
  if (state.changes_requested) return { met: false, reason: "changes_requested" };
  return state.approvals >= needed ? { met: true } : { met: false, reason: "reviews_short" };
}

const MET: PolicyMet = Object.freeze({ met: true });

function notMet(reason: PolicyNotMetReason): PolicyMet {
  return { met: false, reason };
}

/**
 * Whether pull request `pr` of `repo`, at `headSha`, meets the repo's policy.
 * GitHub is read afresh on every call (no cache); the answer is for the head GitHub
 * reports now, and `head_moved` when that is not `headSha`. Never throws: a GitHub
 * failure, a policy row that cannot be read as a policy, or a requirement that is
 * none of `none` / `studio_approval` / `reviews:<N>` answers `unreadable`.
 *
 * - No policy (no row, or `unset`): `no_policy`, and GitHub is not called.
 * - `solo`: CI is `green`.
 * - `studio_approval`: an approved `MERGE_APPROVAL_ACTION` approval for this repo, PR and head.
 * - `reviews`: at least the repo's N approvals at the head, and nothing requests changes.
 * - `playbookRequirement` adds its own condition: `studio_approval` adds the approval check; `reviews:N` raises the approvals needed to max(N, the repo's N).
 */
export async function policyMet(repo: string, pr: number, headSha: string, deps: PolicyMetDeps, playbookRequirement?: string | null): Promise<PolicyMet> {
  try {
    const row = rowOf(deps.store, repo);
    // No row, and a detected repo the owner set nothing for (`unset`), are the same: no policy, no merge.
    if (row === undefined || row.policy_kind === "unset") return notMet("no_policy");
    // A kind that is none of the three cannot be read as a policy.
    const kind = kindOf(row);
    if (kind === null) return notMet("unreadable");
    const requirement = parseRequirement(playbookRequirement);
    if (requirement === undefined) return notMet("unreadable");
    const repoReviews = row.required_reviews;
    if (kind === "reviews" && (repoReviews === null || !Number.isSafeInteger(repoReviews) || repoReviews < 1)) return notMet("unreadable");
    const res = await clientOf(deps).getPullMergeState(repo, pr);
    if (!res.ok) return notMet("unreadable");
    const state = res.data;
    if (state.head_sha !== headSha) return notMet("head_moved");
    const approved = (): boolean => hasMergeApproval(deps.store, repo, pr, headSha);
    if (kind === "solo" && state.ci !== "green") return notMet("ci_not_green");
    if (kind === "studio_approval" && !approved()) return notMet("awaiting_owner_approval");
    if (requirement.kind === "studio_approval" && !approved()) return notMet("awaiting_owner_approval");
    const repoNeeds = kind === "reviews" ? (repoReviews ?? 0) : 0;
    const needed = Math.max(repoNeeds, requirement.kind === "reviews" ? requirement.reviews : 0);
    if (needed > 0) return reviewsMet(state, needed);
    return MET;
  } catch {
    return notMet("unreadable");
  }
}
