// `kernel_notify(title, body, idempotency_key)`: an agent records a
// notification for the owner. Its text is stored as given and only ever shown
// as plain text (invariant 3). Imports only zod, the feature seam and kernel
// modules that never load the Agent SDK (the `studio` CLI loads this module).
import { z } from "zod";
import { defineTool } from "../features/contribution.js";
import { runStep } from "../loop/steps.js";
import { MAX_NOTIFICATION_BODY, MAX_NOTIFICATION_TITLE, recordNotification } from "./record.js";

/** What `kernel_notify` returns (the same value on a repeat with the same key). */
export interface KernelNotifyResult {
  readonly id: number;
  readonly deep_link: string;
  readonly delivery_status: string;
}

// A NUL is refused at argument validation, before the step runs (`recordNotification` refuses it too).
const noNul = (text: string): boolean => !text.includes("\u0000");
const NO_NUL = "must not contain a NUL character";

/**
 * Runs as one work step keyed `ctx.stepKey(idempotency_key)`
 * (`kernel_notify:session-<id>:<key>`), so a repeat in the same session (also
 * after a resume or a restart) returns the first notification instead of
 * recording another. Source `agent:<the session's agent, or "unknown">`; the
 * `notification_created` event is linked to the session.
 */
export const notifyTool = defineTool({
  name: "kernel_notify",
  description:
    "Send the owner a notification: a native macOS notification plus an entry in studio notifications. Plain text, shown as given. " +
    "Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ.",
  shape: {
    title: z.string().min(1).max(MAX_NOTIFICATION_TITLE).refine(noNul, NO_NUL),
    body: z.string().max(MAX_NOTIFICATION_BODY).refine(noNul, NO_NUL),
    idempotency_key: z.string().min(1).max(200),
  },
  handler: (args, ctx): KernelNotifyResult =>
    runStep(
      ctx.store,
      ctx.stepKey(args.idempotency_key),
      () => {
        const agent = ctx.sessions.getSession(ctx.sessionId)?.agent;
        const source = `agent:${agent === undefined || agent === null || agent === "" ? "unknown" : agent}`;
        const row = recordNotification(ctx.store, { source, title: args.title, body: args.body, sessionId: ctx.sessionId }, ctx.now());
        return { id: row.id, deep_link: row.deep_link, delivery_status: row.delivery_status };
      },
      { now: ctx.now },
    ),
});
