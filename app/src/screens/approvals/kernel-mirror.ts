// The two kernel facts the Approvals screen needs and the contract does not
// carry, mirrored from `kernel/src/approvals/store.ts`. The app has no other
// copy of them; `kernel-mirror.test.ts` reads the kernel file and fails if
// either drifts.
import type { Approval } from "../../api/contract";
import { printable } from "./printable";

/**
 * The kernel tools the kernel applies itself when the owner allows them once
 * (`KERNEL_APPLIED_ACTIONS`), each with the one line the screen shows about
 * what the kernel will do.
 */
export const KERNEL_APPLIED_ACTIONS = {
  mcp__kernel__kernel_playbook_enable: "The kernel enables this playbook when you allow it.",
  mcp__kernel__kernel_agent_create: "The kernel creates this crew member when you allow it.",
  mcp__kernel__kernel_agent_update: "The kernel changes this crew member's charter when you allow it.",
} as const satisfies Readonly<Record<string, string>>;

/**
 * The kernel's general `always` refusal (`ALWAYS_REFUSED`). For an approval
 * with no playbook it is true for both refusals the kernel can give (asked
 * for by its agent, or held from a session with no playbook), which the
 * contract's `Approval` cannot tell apart: it has no `source` field.
 */
export const ALWAYS_REFUSED = "always needs an approval the rail held from a playbook session";

/** The payload's `tool`, when it is a string. */
export function payloadTool(payload: unknown): string | undefined {
  const tool = typeof payload === "object" && payload !== null ? (payload as { tool?: unknown }).tool : undefined;
  return typeof tool === "string" ? tool : undefined;
}

/** What the kernel will do on Allow once, for a kernel-applied tool; `undefined` otherwise. */
export function kernelWillLine(approval: Approval): string | undefined {
  const tool = payloadTool(approval.payload);
  if (tool === undefined || !Object.hasOwn(KERNEL_APPLIED_ACTIONS, tool)) return undefined;
  return KERNEL_APPLIED_ACTIONS[tool as keyof typeof KERNEL_APPLIED_ACTIONS];
}

/**
 * Why "Always for this playbook" cannot be sent, when the app can tell before
 * asking: only `playbook === null` (the contract has no eligibility field).
 * Every other refusal is the kernel's `409 always_not_supported` answer.
 */
export function alwaysRefusalFor(approval: Approval): string | undefined {
  if (approval.playbook === null) return `${ALWAYS_REFUSED}; approve it once`;
  return undefined;
}

/** `playbook <slug> v<n>`, escaped: its id when the slug is unknown, no version when none was recorded (the CLI's `playbookText`). */
export function playbookText(playbook: NonNullable<Approval["playbook"]>): string {
  const name = playbook.slug === null ? `#${playbook.id}` : printable(playbook.slug);
  return `playbook ${name}${playbook.version === null ? "" : ` v${playbook.version}`}`;
}
