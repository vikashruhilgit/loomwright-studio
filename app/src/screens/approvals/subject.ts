// What an approval is about, and where it was asked from, for the Approvals
// screen and the thread's inline approval card. Pure: nothing here builds
// markup. The payload is untrusted and read by type only; an `href` is built
// only from a safe-integer playbook id or an `encodeURIComponent`'d member id,
// and every text through `printable`.
//
// Only the three kernel-applied tools name a subject (`KERNEL_APPLIED_ACTIONS`,
// the kernel's `ALWAYS_HELD_TOOLS`): enabling a playbook names that playbook;
// creating or changing a crew member names that member.
//
// A charter create or update's display is split (`charterDisplayParts`) into
// its plain block (the granted kernel tools by job) and the raw lines beneath
// it, for `CharterDisplay`.
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

/** Whether `a` is the approval item 09 files for a merge, by its action alone. Safety gates (no Always) key on this, never on whether the fields validate. */
export function isMergeApproval(a: Approval): boolean {
  return a.action === MERGE_APPROVAL_ACTION;
}

/** Why `always` is never sent for a merge approval, on the Approvals screen and the thread's inline card alike. */
export const MERGE_ALWAYS_REFUSED = "A merge is asked every time, so there is no standing allowance for it. Nothing was sent; allow it once or deny it.";

const KERNEL_KEYS = [MERGE_PAYLOAD_KEYS.repo, MERGE_PAYLOAD_KEYS.pr, MERGE_PAYLOAD_KEYS.headSha] as const;

/** Whether `fields` carries any of the three keys the kernel authorises on. */
function carriesKernelKeys(fields: Readonly<Record<string, unknown>> | undefined): fields is Readonly<Record<string, unknown>> {
  return fields !== undefined && KERNEL_KEYS.some((key) => fields[key] !== undefined);
}

/** The tool name the rail files in `payload.tool` for a merge approval, as the kernel's `MERGE_APPROVAL_TOOL`. */
const MERGE_APPROVAL_TOOL = `mcp__kernel__${MERGE_APPROVAL_ACTION}`;

/**
 * The fields the kernel would authorise on, read exactly as its reader (`hasMergeApproval`) reads
 * them: only when `payload.tool` is the merge-approval tool, and only from `payload.input` (the
 * rail's `{tool, input, cwd}`). The payload's top level is never read, so no card is drawn for a
 * payload the owner's Allow would not count, and a top-level field can never change the PR shown.
 */
function kernelFields(payload: unknown): Readonly<Record<string, unknown>> | undefined {
  if (payloadTool(payload) !== MERGE_APPROVAL_TOOL) return undefined;
  const input = plain(inputOf(payload));
  return carriesKernelKeys(input) ? input : undefined;
}

/**
 * The merge request an approval carries, or `undefined` when it is not one: the
 * action is not `MERGE_APPROVAL_ACTION`, or `repo` (`owner/name`), `pr` (a
 * positive safe integer) or `head_sha` does not validate, so no PR URL is ever
 * built from a value that does not. The fields are read as the kernel reads them
 * (see `kernelFields`): from `payload.input` of the merge-approval tool only, never
 * the payload's top level. Only the card is keyed on this; the no-Always gate is
 * `isMergeApproval`.
 */
export function mergeApprovalOf(a: Approval): MergeApproval | undefined {
  if (!isMergeApproval(a)) return undefined;
  const fields = kernelFields(a.payload);
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

/**
 * Whether `a` is a held charter create or update (`kernel_agent_create`,
 * `kernel_agent_update`), read from the payload's `tool` as `approvalSubject`
 * reads it. Only these two have a display the kernel's pre-hold check wrote
 * from the charter (`createDisplay` / `updateDisplay` in
 * `kernel/src/agents/charter-tools.ts`); an agent's own approval request carries
 * no display at all.
 */
export function isCharterApproval(a: Approval): boolean {
  const tool = payloadTool(a.payload);
  return tool === CREATE || tool === UPDATE;
}

/**
 * The kernel's charter-display format, mirrored from
 * `kernel/src/features/catalogue.ts` (`jobDisplayLines` and
 * `DISPLAY_CATALOGUE_UNAVAILABLE`); `subject.test.ts` reads that file as text
 * and fails if either drifts.
 */
export const CHARTER_JOB_PREFIX = "job: ";
export const CHARTER_PURPOSE_PREFIX = "  - ";
export const CHARTER_CATALOGUE_UNAVAILABLE =
  "kernel tools: the kernel's tool catalogue is unavailable, so they are not grouped by job; their names are on the enforced line below";

/** One job of a charter display's plain block: its label and the purpose line of each granted tool of that job (none in the kernel's compact, label-only form). */
export interface CharterJob {
  readonly label: string;
  readonly purposes: readonly string[];
}

/**
 * A charter display split for the card. Raw (unescaped) text: every part goes
 * through `printable` where it is rendered.
 *
 * - `head`: the first line (who, and which file for an update).
 * - `jobs`: the granted kernel tools grouped by job, in the kernel's order.
 * - `note`: the kernel's one plain line when its catalogue was unavailable
 *   (then `jobs` is empty: the kernel never guesses a grouping, nor does this).
 * - `raw`: every line after the plain block, exactly as the kernel wrote it
 *   (field lines, the `enforced:` line with the raw tool names, limits,
 *   workspaces and the files).
 */
export interface CharterDisplayParts {
  readonly head: string;
  readonly jobs: readonly CharterJob[];
  readonly note: string | undefined;
  readonly raw: string;
}

/**
 * `display` split into its plain block and the raw lines beneath it, or
 * `undefined` when it has no plain block (the charter grants no kernel tool,
 * or the display is not in the kernel's format): the card then shows the
 * display as it always has. Pure. The plain block is the run of lines right
 * after the first: `job: <label>` lines, each followed by its `  - <purpose>`
 * lines, or the one catalogue-unavailable line. It ends at the first line that
 * is neither. The kernel writes every job with its purposes, or (when that
 * block would not fit the approval display) every job as its label alone, the
 * compact form: both split, the compact one into jobs with no purposes. A
 * purpose line with no job above it, or a block mixing jobs with and without
 * purposes, is not the kernel's format and splits nothing.
 */
export function charterDisplayParts(display: string): CharterDisplayParts | undefined {
  const lines = display.split("\n");
  const head = lines[0] ?? "";
  if (lines[1] === CHARTER_CATALOGUE_UNAVAILABLE) {
    return { head, jobs: [], note: CHARTER_CATALOGUE_UNAVAILABLE, raw: lines.slice(2).join("\n") };
  }
  const jobs: { label: string; purposes: string[] }[] = [];
  let i = 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.startsWith(CHARTER_JOB_PREFIX)) {
      jobs.push({ label: line.slice(CHARTER_JOB_PREFIX.length), purposes: [] });
    } else if (line.startsWith(CHARTER_PURPOSE_PREFIX)) {
      const job = jobs.at(-1);
      if (job === undefined) return undefined;
      job.purposes.push(line.slice(CHARTER_PURPOSE_PREFIX.length));
    } else {
      break;
    }
  }
  if (jobs.length === 0) return undefined;
  const compact = jobs.every((j) => j.purposes.length === 0);
  if (!compact && jobs.some((j) => j.purposes.length === 0)) return undefined;
  return { head, jobs, note: undefined, raw: lines.slice(i).join("\n") };
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
