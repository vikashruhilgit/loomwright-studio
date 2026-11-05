// What an approval is about, and where it was asked from, for the Approvals
// screen and the thread's inline approval card. Pure: nothing here builds
// markup. The payload is untrusted and read by type only; an `href` is built
// only from a safe-integer playbook id or an `encodeURIComponent`'d member id,
// and every text through `printable`.
//
// Only the three kernel-applied tools name a subject (`KERNEL_APPLIED_ACTIONS`,
// the kernel's `ALWAYS_HELD_TOOLS`): enabling a playbook names that playbook;
// creating or changing a crew member names that member.
import type { Approval, PlaybookListing } from "../../api/contract";
import { playbookCardHash } from "../chat/model";
import { memberHash } from "../team/model";
import { KERNEL_APPLIED_ACTIONS, payloadTool, playbookText } from "./kernel-mirror";
import { printable } from "./printable";

type KernelAppliedTool = keyof typeof KERNEL_APPLIED_ACTIONS;

const ENABLE: KernelAppliedTool = "mcp__kernel__kernel_playbook_enable";
const CREATE: KernelAppliedTool = "mcp__kernel__kernel_agent_create";
const UPDATE: KernelAppliedTool = "mcp__kernel__kernel_agent_update";

export type ApprovalSubject = { readonly kind: "playbook"; readonly id: number } | { readonly kind: "member"; readonly id: string };

/** The payload's `input`, when it is a plain object (never `null` or an array). */
function inputOf(payload: unknown): Readonly<Record<string, unknown>> | undefined {
  const input = typeof payload === "object" && payload !== null ? (payload as { input?: unknown }).input : undefined;
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function memberId(id: unknown): ApprovalSubject | undefined {
  return typeof id === "string" && id !== "" ? { kind: "member", id } : undefined;
}

/** The playbook or crew member a kernel-applied approval is about; `undefined` for anything else, or a field of the wrong type. */
export function approvalSubject(a: Approval): ApprovalSubject | undefined {
  const tool = payloadTool(a.payload);
  const input = inputOf(a.payload);
  if (input === undefined) return undefined;
  if (tool === ENABLE) {
    const id = input.id;
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? { kind: "playbook", id } : undefined;
  }
  if (tool === CREATE) {
    const charter = input.charter;
    return typeof charter === "object" && charter !== null && !Array.isArray(charter) ? memberId((charter as { id?: unknown }).id) : undefined;
  }
  if (tool === UPDATE) return memberId(input.id);
  return undefined;
}

/**
 * The action of the approval item 09 files to ask the owner before Loomwright's
 * gate merges a PR. Mirrors `MERGE_APPROVAL_ACTION` in
 * `kernel/src/integrations/github/repo-policy.ts`; `console-contract.test.ts`
 * reads this file as text and fails if the two differ.
 */
export const MERGE_APPROVAL_ACTION = "kernel_merge_approval_request";

/**
 * The payload keys the merge card reads, all in one place so item 09's filing can
 * be matched to them. `repo`, `pr` and `head_sha` are the three the kernel's own
 * reader (`hasMergeApproval`) uses as `$.repo`, `$.pr`, `$.head_sha`; `ci`,
 * `ready_at` and `policy` are NOT fixed by any code yet (item 09 owns them), so a
 * different name there reads "not in the request" on the card, never a guess.
 */
export const MERGE_PAYLOAD_KEYS = { repo: "repo", pr: "pr", headSha: "head_sha", ci: "ci", readyAt: "ready_at", policy: "policy" } as const;

/** What a merge approval says, read from its payload by type only. The optional three are `undefined` when missing or not a string. */
export interface MergeApproval {
  readonly repo: string;
  readonly pr: number;
  /** The full head SHA: lowercase hex, 7 to 40 characters. */
  readonly headSha: string;
  readonly ci: string | undefined;
  readonly readyAt: string | undefined;
  readonly policy: string | undefined;
}

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const HEAD_SHA = /^[0-9a-f]{7,40}$/;

/** A plain object (never `null` or an array), else `undefined`. */
function plain(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * The merge request an approval carries, or `undefined` when it is not one: the
 * action is not `MERGE_APPROVAL_ACTION`, or `repo` (`owner/name`), `pr` (a
 * positive safe integer) or `head_sha` does not validate, so no PR URL is ever
 * built from a value that does not. The fields are read from `payload.input`
 * when the payload is the rail's `{tool, input, cwd}`, else from the payload
 * itself, so either shape item 09 files is read.
 */
export function mergeApprovalOf(a: Approval): MergeApproval | undefined {
  if (a.action !== MERGE_APPROVAL_ACTION) return undefined;
  const fields = plain(inputOf(a.payload)) ?? plain(a.payload);
  if (fields === undefined) return undefined;
  const repo = fields[MERGE_PAYLOAD_KEYS.repo];
  const pr = fields[MERGE_PAYLOAD_KEYS.pr];
  const headSha = fields[MERGE_PAYLOAD_KEYS.headSha];
  if (typeof repo !== "string" || !REPO.test(repo) || repo.endsWith("/.") || repo.endsWith("/..")) return undefined;
  if (typeof pr !== "number" || !Number.isSafeInteger(pr) || pr <= 0) return undefined;
  if (typeof headSha !== "string" || !HEAD_SHA.test(headSha)) return undefined;
  const ci = fields[MERGE_PAYLOAD_KEYS.ci];
  const readyAt = fields[MERGE_PAYLOAD_KEYS.readyAt];
  const policy = fields[MERGE_PAYLOAD_KEYS.policy];
  return {
    repo,
    pr,
    headSha,
    ci: typeof ci === "string" ? ci : undefined,
    readyAt: typeof readyAt === "string" ? readyAt : undefined,
    policy: typeof policy === "string" ? policy : undefined,
  };
}

/** Where an approval with no playbook was asked from. The contract has no `source` field: every one reads this. */
export const IN_CHAT = "in chat";

/** `Requested by Wright in chat`, `Requested by <agent> in chat`, or `Requested by playbook <slug> v<n>`; escaped. */
export function approvalSourceText(a: Approval): string {
  if (a.playbook !== null) return `Requested by ${playbookText(a.playbook)}`;
  const agent = a.requesting_agent === "wright" ? "Wright" : printable(a.requesting_agent);
  return `Requested by ${agent} ${IN_CHAT}`;
}

/**
 * The link to what the approval is about: `Open playbook <slug>` to that
 * playbook's card in Wright's thread (`#<id>` when the list does not have it
 * or is unread), or `Open in Team` to that member. A create links only once it
 * was allowed and the kernel applied it, which needs the kernel's `applied`
 * record: before that, after a deny or a refused apply, or for an approval an
 * agent asked for itself (never applied), the member does not exist. An
 * update's member always does.
 */
export function approvalLink(a: Approval, playbooks: readonly PlaybookListing[] | undefined): { readonly text: string; readonly href: string } | undefined {
  const subject = approvalSubject(a);
  if (subject === undefined) return undefined;
  if (subject.kind === "playbook") {
    const listed = playbooks?.find((p) => p.id === subject.id);
    const name = listed === undefined ? `#${subject.id}` : printable(listed.slug);
    return { text: `Open playbook ${name}`, href: playbookCardHash(subject.id) };
  }
  if (payloadTool(a.payload) === UPDATE) return { text: "Open in Team", href: memberHash(subject.id) };
  const applied = a.status === "approved" && a.applied !== undefined;
  return applied ? { text: "Open in Team", href: memberHash(subject.id) } : undefined;
}
