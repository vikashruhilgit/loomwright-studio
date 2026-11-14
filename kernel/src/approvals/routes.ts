// The owner's approval decisions, on the loopback API (bearer token, like
// every route): what `studio approvals` / `approve` / `deny` call.
//
//   GET  /approvals[?all=1]           {approvals: [...]}: pending first (oldest first); all=1 adds decided ones (newest first)
//   POST /approvals/:id/approve       body {decision: "once" | "always", owner_grant?: {kind: "jira" | "clickup", tools: [...]}};
//                                     "always" only for a rail approval from a playbook session; owner_grant only with "once", for
//                                     a held kernel_agent_create / kernel_agent_update (item 21b)
//   POST /approvals/:id/deny
//   GET  /approvals/grants            {grants: [...]}: every standing grant not revoked (oldest first)
//   POST /approvals/grants/:id/revoke {grant}: the grant, now revoked
//
// A decision or revoke is the owner's (`by: "owner"`). A decision gets the
// kernel's applier (`req.approvalApplier`), so an approved kernel-applied
// action is applied in the decision's transaction (`decideApproval`); its
// answer's approval then carries `applied` or `apply_refused` / `apply_detail`.
// `owner_grant` is the owner's own tracker grant, ticked on the held card: only this
// route reads it (Wright's charter can never carry one, `charter-files.ts`), the kernel
// checks every tool against the connection's stored tool list and applies it inside the
// decision, recorded as the owner's. Refusals write nothing:
// `400 invalid_id` / `invalid_body` (a malformed `decision`, or an `owner_grant` that is not
// `{kind, tools}` of a jira or clickup tool list) / `invalid_approval` (an `owner_grant` the
// kernel refuses: a tool the connection does not list, or an approval it can't ride on),
// `404 no_such_approval`,
// `409 approval_not_pending` (with the current `status`),
// `409 always_not_supported` (with a message saying which condition failed),
// `404 no_such_grant`, `409 grant_revoked`.
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { parseConnectorsGrant } from "../agents/settings.js";
import { isMcpKind } from "../integrations/mcp/rows.js";
import { ApprovalError, OWNER, approvalView, decideApproval, getApproval, listApprovals, listGrants, revokeGrant } from "./store.js";
import type { ApprovalDecision, OwnerGrant } from "./store.js";

const ID = /^[1-9]\d{0,15}$/;

function idOf(req: ContributedRouteRequest): number | undefined {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  return ID.test(raw) && Number.isSafeInteger(id) ? id : undefined;
}

/** Whether a body is absent or a plain object (what `deny` and `revoke` take). */
function objectOrAbsent(body: unknown): boolean {
  return body === undefined || (typeof body === "object" && body !== null && !Array.isArray(body));
}

/** The decision a request asks for, or `undefined` for a malformed body. `deny` takes no body (or an empty object). */
function decisionOf(req: ContributedRouteRequest, approve: boolean): ApprovalDecision | undefined {
  const body = req.body;
  if (!objectOrAbsent(body)) return undefined;
  if (!approve) return "deny";
  const decision = (body as { decision?: unknown } | undefined)?.decision;
  return decision === "once" || decision === "always" ? decision : undefined;
}

/** The `owner_grant` an approve body carries: none when absent, a message when it is not `{kind, tools}` of a jira or clickup tool list. */
function ownerGrantOf(body: unknown): { readonly grant?: OwnerGrant } | { readonly message: string } {
  const raw = (body as { owner_grant?: unknown } | undefined)?.owner_grant;
  if (raw === undefined) return {};
  const bad = (why: string): { readonly message: string } => ({ message: `owner_grant must be {"kind": "jira" | "clickup", "tools": ["<tool>", ...]}: ${why}` });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("it is not an object");
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.includes("kind") || !keys.includes("tools")) return bad("it takes exactly kind and tools");
  const { kind, tools } = raw as { kind: unknown; tools: unknown };
  if (!isMcpKind(kind)) return bad("kind is not an MCP tracker");
  // The settings reader's own rule for a kind's tool list (non-empty, bounded, named), so a tick that passes here is a grant the file can hold.
  const read = parseConnectorsGrant({ [kind]: tools });
  if (!read.ok) return bad(read.message);
  return { grant: { kind, tools: read.grant.mcp[kind] ?? [] } };
}

function decide(approve: boolean): (req: ContributedRouteRequest) => Promise<ContributedRouteResponse> {
  return async (req) => {
    const id = idOf(req);
    if (id === undefined) return { status: 400, body: { error: "invalid_id" } };
    const decision = decisionOf(req, approve);
    if (decision === undefined) return { status: 400, body: { error: "invalid_body", message: 'approve needs {"decision": "once"} or {"decision": "always"}' } };
    // Only an approve reads an owner_grant; a malformed one decides nothing.
    const owner = approve ? ownerGrantOf(req.body) : {};
    if ("message" in owner) return { status: 400, body: { error: "invalid_body", message: owner.message } };
    try {
      const input = { id, decision, by: OWNER, ...(owner.grant === undefined ? {} : { ownerGrant: owner.grant }) };
      return { status: 200, body: { approval: approvalView(req.store, decideApproval(req.store, input, req.now(), req.approvalApplier)) } };
    } catch (err) {
      if (!(err instanceof ApprovalError)) throw err;
      if (err.code === "no_such_approval") return { status: 404, body: { error: "no_such_approval" } };
      if (err.code === "approval_not_pending") return { status: 409, body: { error: "approval_not_pending", status: getApproval(req.store, id)?.status ?? null } };
      if (err.code === "always_not_supported") return { status: 409, body: { error: "always_not_supported", message: err.message } };
      return { status: 400, body: { error: err.code, message: err.message } };
    }
  };
}

async function revoke(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const id = idOf(req);
  if (id === undefined) return { status: 400, body: { error: "invalid_id" } };
  if (!objectOrAbsent(req.body)) return { status: 400, body: { error: "invalid_body", message: "revoke takes no body" } };
  try {
    return { status: 200, body: { grant: revokeGrant(req.store, { id, by: OWNER }, req.now()) } };
  } catch (err) {
    if (!(err instanceof ApprovalError)) throw err;
    if (err.code === "no_such_grant") return { status: 404, body: { error: "no_such_grant" } };
    if (err.code === "grant_revoked") return { status: 409, body: { error: "grant_revoked" } };
    return { status: 400, body: { error: err.code, message: err.message } };
  }
}

export const approvalRoutes: readonly ContributedRoute[] = Object.freeze([
  {
    method: "GET",
    path: "/approvals",
    handler: async (req) => ({ status: 200, body: { approvals: listApprovals(req.store, { all: req.query.all === "1" || req.query.all === "true" }) } }),
  },
  { method: "POST", path: "/approvals/:id/approve", handler: decide(true) },
  { method: "POST", path: "/approvals/:id/deny", handler: decide(false) },
  { method: "GET", path: "/approvals/grants", handler: async (req) => ({ status: 200, body: { grants: listGrants(req.store) } }) },
  { method: "POST", path: "/approvals/grants/:id/revoke", handler: revoke },
]);
