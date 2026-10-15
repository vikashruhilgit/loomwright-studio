// The `approvals` feature (phase 2): the `kernel_approval_request` tool, the
// `/approvals` routes and the owner's `studio approvals` / `approve` / `deny`
// subcommands. The fixed outward set itself is enforced in the kernel's
// PreToolUse rail (`sessions/policy.ts` `classifyToolCall`, wired in the
// session manager's gate through `holdOrUseGrant`), not by this contribution,
// so no agent can edit it (invariant 3). Nothing is preinstalled (invariant 1):
// no approval, no grant, no `always` rule. `startKernel` and `runCli` merge it
// through `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`). The `studio` CLI
// loads it, so it imports only types and zod: never the Agent SDK. (Beyond
// types and zod, its modules import only each other, the feature seam, the
// loop's work steps, queue and audit helpers, and the notifications record and
// CLI escape.)
import type { FeatureContribution } from "../features/contribution.js";
import { approvalsSubcommand, approveSubcommand, denySubcommand } from "./cli.js";
import { approvalRoutes } from "./routes.js";
import { approvalRequestTool } from "./tool.js";

export const approvalsContribution: FeatureContribution = Object.freeze({
  name: "approvals",
  tools: Object.freeze([approvalRequestTool]),
  routes: approvalRoutes,
  subcommands: Object.freeze([approvalsSubcommand, approveSubcommand, denySubcommand]),
});

export { APPROVALS_HELP, APPROVE_HELP, DENY_HELP, approvalsSubcommand, approveSubcommand, denySubcommand, formatApprovals, payloadText, shown } from "./cli.js";
export { approvalRoutes } from "./routes.js";
export {
  ALWAYS_REFUSED,
  APPROVAL_AUDIT_KINDS,
  APPROVAL_DECISIONS,
  APPROVAL_STATUSES,
  ApprovalError,
  MAX_APPROVAL_ACTION,
  MAX_DECIDED_LIST,
  MAX_REQUEST_PAYLOAD_JSON,
  OWNER,
  UNKNOWN_AGENT,
  approvalView,
  canonicalJson,
  decideApproval,
  getApproval,
  holdOrUseGrant,
  listApprovals,
  requestApproval,
} from "./store.js";
export type { ApprovalDecision, ApprovalRequest, ApprovalRow, ApprovalSource, ApprovalStatus, ApprovalView, DecisionInput, RailCall, RailOutcome } from "./store.js";
export { approvalRequestTool } from "./tool.js";
export type { KernelApprovalRequestResult } from "./tool.js";
