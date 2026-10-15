// The triggers feature's kernel tools: an agent registers, removes and lists
// its own `once` / `cron` triggers. Creating one needs no approval; the owner
// sees and toggles every trigger (`studio triggers`, `routes.ts`).
//
// Tool input is untrusted data (invariant 3): the tool server validates the
// zod shape first, and every refusal here is a throw the server turns into an
// `isError` result with the message (never a throw through the SDK). Register
// and remove run as a work step keyed `ctx.stepKey(idempotency_key)`, so a
// repeat in the same session returns the first result; a refused call rolls
// back with its step, so nothing of it is stored (no row, no event). The one
// exception to the repeat: a register repeated after the owner turned its
// trigger off is refused (`owner_off`), as a new register of it would be.
import { z } from "zod";
import { defineTool } from "../features/contribution.js";
import type { ContributedTool, ContributedToolContext } from "../features/contribution.js";
import { errorMessage } from "../loop/internal.js";
import { runStep } from "../loop/steps.js";
import { MAX_CRON_LENGTH } from "./cron.js";
import { MAX_TRIGGER_TEXT, TRIGGER_ACTIONS, TRIGGER_KINDS, TriggerError, listTriggers, refuseIfOwnerOff, registerTrigger, removeTrigger } from "./store.js";

export const TRIGGER_TOOL_NAMES = ["kernel_trigger_register", "kernel_trigger_remove", "kernel_trigger_list"] as const;

const idempotencyKey = z.string().min(1).max(200);

const REPEAT = "Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ.";

/** The calling session's agent: the owner of the triggers it creates. */
function owningAgent(ctx: ContributedToolContext): string {
  const agent = ctx.sessions.getSession(ctx.sessionId)?.agent;
  if (typeof agent !== "string" || agent === "") {
    throw new TriggerError("invalid_input", `session ${ctx.sessionId} runs no named agent; a trigger needs an owning agent`);
  }
  return agent;
}

/** Run `body`, prefixing a refusal's message with the tool name. */
function named<T>(name: string, body: () => T): T {
  try {
    return body();
  } catch (err) {
    throw new Error(`${name}: ${errorMessage(err)}`);
  }
}

const register = defineTool({
  name: "kernel_trigger_register",
  description:
    "Create a time trigger you own. kind once: spec is an ISO-8601 instant WITH a time zone (2026-10-14T17:00:00+05:30), in the future. " +
    "kind cron: spec is a 5-field cron expression (minute hour day-of-month month day-of-week) and tz an IANA zone (Asia/Kolkata). " +
    "action notify posts text as a notification; action wake_agent queues text as a message to you. Returns {id, next_fire_at} (UTC): " +
    "tell the user when it fires. The owner sees and can turn off every trigger; one the owner turned off cannot be turned back on or " +
    `re-registered by an agent (a repeat of this call then returns that error too). ${REPEAT}`,
  shape: {
    kind: z.enum(TRIGGER_KINDS),
    spec: z.string().min(1).max(MAX_CRON_LENGTH),
    tz: z.string().min(1).max(64).optional(),
    action: z.enum(TRIGGER_ACTIONS),
    text: z.string().min(1).max(MAX_TRIGGER_TEXT),
    idempotency_key: idempotencyKey,
  },
  handler: (a, ctx) =>
    named("kernel_trigger_register", () => {
      const agent = owningAgent(ctx);
      const registered = runStep(
        ctx.store,
        ctx.stepKey(a.idempotency_key),
        () => registerTrigger(ctx.store, { agent, kind: a.kind, spec: a.spec, tz: a.tz, action: a.action, text: a.text, sessionId: ctx.sessionId }, ctx.now()),
        { now: ctx.now },
      );
      // A repeat replays the first result, which predates any owner's off: the
      // agent must not be told its trigger is on when the owner turned it off.
      refuseIfOwnerOff(ctx.store, registered.id);
      return registered;
    }),
});

const remove = defineTool({
  name: "kernel_trigger_remove",
  description: `Delete a trigger you own (not one the owner turned off). ${REPEAT}`,
  shape: { id: z.number().int().positive(), idempotency_key: idempotencyKey },
  handler: (a, ctx) =>
    named("kernel_trigger_remove", () => {
      const agent = owningAgent(ctx);
      return runStep(ctx.store, ctx.stepKey(a.idempotency_key), () => removeTrigger(ctx.store, { id: a.id, agent, sessionId: ctx.sessionId }, ctx.now()), {
        now: ctx.now,
      });
    }),
});

const list = defineTool({
  name: "kernel_trigger_list",
  description: "List the triggers you own, enabled and disabled, in id order, with their next fire (UTC) and last result.",
  shape: {},
  handler: (_a, ctx) => named("kernel_trigger_list", () => ({ triggers: listTriggers(ctx.store, { all: true, agent: owningAgent(ctx) }) })),
});

/** The three tools, in `TRIGGER_TOOL_NAMES` order. */
export const triggerTools: readonly ContributedTool[] = Object.freeze([register, remove, list]);
