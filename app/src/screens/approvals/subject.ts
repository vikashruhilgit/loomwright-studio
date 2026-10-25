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
