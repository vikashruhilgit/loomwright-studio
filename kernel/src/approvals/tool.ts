// `kernel_approval_request(action, payload, idempotency_key)`: an agent asks
// the owner to approve an action. It records a `pending` approval (and its
// `kernel:approval` notification) and returns at once: the session is never
// kept running while the owner decides. The decision arrives later as a new
// `message` event (`decideApproval`). An approval requested this way never
// lets a tool call through the rail; only an approval the rail itself held
// does (`holdOrUseGrant`). Tool input is untrusted data (invariant 3): stored
// as given, shown as data. Imports only zod, the feature seam and kernel
// modules that never load the Agent SDK (the `studio` CLI loads this module).
import { z } from "zod";
import { defineTool } from "../features/contribution.js";
import { runStep } from "../loop/steps.js";
import { MAX_APPROVAL_ACTION, MAX_REQUEST_PAYLOAD_JSON, canonicalJson, getApproval, requestApproval } from "./store.js";
import type { ApprovalStatus } from "./store.js";

/** What `kernel_approval_request` returns. A repeat with the same key returns the same id with its current status. */
export interface KernelApprovalRequestResult {
  readonly id: number;
  readonly status: ApprovalStatus;
  readonly action: string;
  readonly message: string;
}

function messageFor(id: number, status: ApprovalStatus): string {
  if (status === "pending") {
    return (
      `Approval ${id} is pending: the owner decides (studio approve ${id} once, or studio deny ${id}). ` +
      `The decision arrives as a new message ("approved approval ${id}: …" or "denied approval ${id}: …"). ` +
      "Do not wait or poll for it: end your turn now."
    );
  }
  return `Approval ${id} is already decided: ${status}.`;
}

/**
 * Runs as one work step keyed `ctx.stepKey(idempotency_key)`
 * (`kernel_approval_request:session-<id>:<key>`), so a repeat in the same
 * session (also after a resume or a restart) returns the first approval
 * instead of recording another. The requesting agent is the session's
 * (`unknown` when it has none).
 */
export const approvalRequestTool = defineTool({
  name: "kernel_approval_request",
  description:
    "Ask the owner to approve an action before you take it. action: a short description (one line). payload: the exact details " +
    "(a JSON object), shown to the owner as data. Returns at once with {id, status: \"pending\"}; the owner's decision arrives later " +
    "as a new message, so end your turn after calling this. " +
    "Repeating a call with the same idempotency_key in this session returns the first approval, even if other arguments differ.",
  shape: {
    // A NUL is refused at argument validation, before the step runs (`requestApproval` refuses it too).
    action: z
      .string()
      .min(1)
      .max(MAX_APPROVAL_ACTION)
      .refine((text) => !text.includes("\u0000"), "must not contain a NUL character"),
    // Not `z.record`: it rebuilds the object in a plain `{}`, dropping a `__proto__` key (an own property of the
    // parsed arguments). This passes the object through as given, so the payload is stored exactly as sent.
    payload: z
      .unknown()
      .refine((v) => typeof v === "object" && v !== null && !Array.isArray(v), { message: "payload must be a JSON object" })
      .meta({ type: "object" }),
    idempotency_key: z.string().min(1).max(200),
  },
  handler: (args, ctx): KernelApprovalRequestResult => {
    const { id } = runStep(
      ctx.store,
      ctx.stepKey(args.idempotency_key),
      () => {
        if (canonicalJson(args.payload).length > MAX_REQUEST_PAYLOAD_JSON) {
          throw new Error(`kernel_approval_request: the payload must be at most ${MAX_REQUEST_PAYLOAD_JSON} characters as JSON`);
        }
        const agent = ctx.sessions.getSession(ctx.sessionId)?.agent ?? null;
        const row = requestApproval(ctx.store, { agent, sessionId: ctx.sessionId, action: args.action, payload: args.payload, source: "tool" }, ctx.now());
        return { id: row.id };
      },
      { now: ctx.now },
    );
    const row = getApproval(ctx.store, id);
    if (row === undefined) throw new Error(`kernel_approval_request: approval ${id} no longer exists`);
    return { id, status: row.status, action: row.action, message: messageFor(id, row.status) };
  },
});
