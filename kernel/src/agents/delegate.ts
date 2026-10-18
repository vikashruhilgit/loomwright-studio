// The agents feature's `delegate` part (phase 4 item 06): an agent hands work
// to another agent through one kernel tool, never through a session it owns
// (invariant 2). `./index.ts` merges every part in `AGENT_PARTS` into the one
// `agents` contribution; only this file defines this part.
//
//   tool  kernel_agent_message(agent, text, workspace?, idempotency_key)
//
// It queues one `message` event `{agent, text, from_agent, depth, workspace?}`
// for the target and returns at once: the reply arrives later as a new
// message (the receiving side is phase 4 item 05's). Not held (owner
// decision): the target's own policy and the rail decide every action it
// takes. `text` is stored as given (untrusted data, invariant 3); the
// receiving side wraps it as data from `agent:<sender>`.
//
// Depth. The caller's depth is that of the newest `brain_messages` row its
// session handles (an owner's message is 0); a session with no row (a
// playbook fire, a dry run) counts 0. The delegation's depth is the caller's
// plus 1. Mechanism only (invariant 1): the limit is the CALLER's own
// `limits.delegation_depth` (`./settings.ts`); unset, or settings that do not
// read `ok`, means no limit. The kernel picks none.
//
// Checks, in order, each a refusal (`DELEGATION_REFUSALS`): `no_agent` (the
// session has no agent), `self_delegation`, `no_such_agent` (neither `wright`
// nor a registered row), `agent_off` (registered, not routable),
// `workspace_not_listed` (a `workspace` not exactly in the TARGET's settings
// `workspaces`), `delegation_depth`. A refusal commits one
// `agent_message_refused` event in its own transaction (and, for
// `delegation_depth`, one notification per refused chain, a work step keyed
// on the caller's message row), then throws `DelegationRefused`: the tool
// server answers it as an error result naming the reason. Nothing is queued.
//
// A success is one work step keyed `ctx.stepKey(idempotency_key)`: the queue
// row and one `agent_message_queued` event commit together, and a repeat
// returns the first result (checked before anything else, so a repeat is
// never re-refused after the target changed). A refusal is not a step: a
// refused call repeated with its key is checked again.
//
// The `studio` CLI loads this module through `./index.ts`: it imports only
// zod, the feature seam and SDK-free leaf modules, never the Agent SDK, the
// session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
import { z } from "zod";
import { defineTool } from "../features/contribution.js";
import type { ContributedToolContext } from "../features/contribution.js";
import { appendEvent } from "../loop/internal.js";
import { enqueueEvent } from "../loop/queue.js";
import { getWorkStep, runStep } from "../loop/steps.js";
import { recordNotification } from "../notifications/record.js";
import { getAgent, isRoutable } from "./registry.js";
import { readAgentSettings } from "./settings.js";
import type { AgentPart } from "./types.js";

export const AGENT_MESSAGE_TOOL_NAME = "kernel_agent_message";

/** Why `kernel_agent_message` queued nothing: the only list of them, in check order. */
export const DELEGATION_REFUSALS = Object.freeze(["no_agent", "self_delegation", "no_such_agent", "agent_off", "workspace_not_listed", "delegation_depth"] as const);
export type DelegationRefusal = (typeof DELEGATION_REFUSALS)[number];

/** The longest `text` a delegation may carry. */
export const MAX_DELEGATION_TEXT = 8_000;

/** The notification source of a `delegation_depth` refusal. */
export const DELEGATION_DEPTH_SOURCE = "kernel:delegation_depth";

/**
 * A refused delegation: nothing was queued. `reason` is one of
 * `DELEGATION_REFUSALS`; the message starts with it (`delegation_depth: …`),
 * since the tool's error result is the message alone.
 */
export class DelegationRefused extends Error {
  readonly reason: DelegationRefusal;

  constructor(reason: DelegationRefusal, detail: string) {
    super(`${reason}: ${detail}; nothing was queued`);
    this.name = "DelegationRefused";
    this.reason = reason;
  }
}

/** What `kernel_agent_message` returns (the same value on a repeat with the same key). */
export interface AgentMessageResult {
  /** The queued `message` event's `event_queue` id. */
  readonly queue_id: number;
  readonly agent: string;
  readonly depth: number;
  /** For the model: the reply arrives later as a new message. */
  readonly note: string;
}

// A NUL is refused at argument validation, as `kernel_notify` refuses one.
const noNul = (text: string): boolean => !text.includes("\u0000");
const NO_NUL = "must not contain a NUL character";

const shape = {
  agent: z.string().min(1).max(64),
  text: z.string().min(1).max(MAX_DELEGATION_TEXT).refine(noNul, NO_NUL),
  workspace: z.string().optional(),
  idempotency_key: z.string().min(1).max(200),
};

type Args = { readonly agent: string; readonly text: string; readonly workspace?: string | undefined; readonly idempotency_key: string };

/** The message the caller's session handles: its newest `brain_messages` row, or none. */
interface CallerMessage {
  readonly id: number;
  readonly depth: number;
}

function callerMessage(ctx: ContributedToolContext): CallerMessage | undefined {
  return ctx.store.prepare<[number], CallerMessage>("SELECT depth, id FROM brain_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(ctx.sessionId);
}

/** A delegation the checks let through. */
interface Admitted {
  readonly caller: string;
  readonly depth: number;
}

/**
 * The caller's `limits.delegation_depth`, or undefined (no limit): also when
 * its settings do not read `ok` (missing, invalid, no model). Never a guess.
 */
function delegationLimit(ctx: ContributedToolContext, caller: string): number | undefined {
  const r = readAgentSettings(ctx.store.dataDir, caller);
  return r.ok ? r.settings.limits?.delegation_depth : undefined;
}

/** Whether `workspace` is exactly one of the target's settings `workspaces` (unreadable settings or none listed: no). */
function workspaceListed(ctx: ContributedToolContext, target: string, workspace: string): boolean {
  const r = readAgentSettings(ctx.store.dataDir, target);
  return r.ok && (r.settings.workspaces ?? []).includes(workspace);
}

/**
 * Record the refusal (one `agent_message_refused` event, in its own
 * transaction) and throw `DelegationRefused`. `beforeThrow` runs after the
 * event commits (the depth refusal's one notification).
 */
function refuse(ctx: ContributedToolContext, r: { from: string | null; to: string; depth: number; reason: DelegationRefusal; detail: string }, beforeThrow?: () => void): never {
  const at = ctx.now().toISOString();
  ctx.store.transaction(() =>
    appendEvent(ctx.store, "agent_message_refused", { sessionId: ctx.sessionId, taskId: null }, { from: r.from, to: r.to, depth: r.depth, reason: r.reason }, at),
  );
  beforeThrow?.();
  throw new DelegationRefused(r.reason, r.detail);
}

/**
 * The depth refusal's notification: one per refused chain, a work step keyed
 * on the caller's message row (`…:message-<id>`), or on the session when it
 * handles none (`…:session-<id>`), so a repeated refusal records nothing more.
 */
function notifyDepthRefusal(ctx: ContributedToolContext, row: CallerMessage | undefined, n: { caller: string; target: string; depth: number; limit: number }): void {
  const anchor = row === undefined ? `session-${ctx.sessionId}` : `message-${row.id}`;
  runStep(
    ctx.store,
    `${AGENT_MESSAGE_TOOL_NAME}:depth-notify:${anchor}`,
    () => {
      const created = recordNotification(
        ctx.store,
        {
          source: DELEGATION_DEPTH_SOURCE,
          title: `Delegation refused: ${n.caller} reached its delegation depth`,
          body: `${n.caller} tried to delegate to ${n.target} at depth ${n.depth}, past its limits.delegation_depth of ${n.limit}. Nothing was queued. Further refused delegations in this chain are not notified again.`,
          sessionId: ctx.sessionId,
        },
        ctx.now(),
      );
      return { notification_id: created.id };
    },
    { now: ctx.now },
  );
}

/** Run the checks in order (see the header); throws `DelegationRefused` for the first that fails. */
function admit(ctx: ContributedToolContext, a: Args): Admitted {
  const agent = ctx.sessions.getSession(ctx.sessionId)?.agent;
  const caller = agent === undefined || agent === null || agent === "" ? null : agent;
  const row = callerMessage(ctx);
  const depth = (row?.depth ?? 0) + 1;
  const target = a.agent;
  const base = { from: caller, to: target, depth };
  if (caller === null) refuse(ctx, { ...base, reason: "no_agent", detail: `session ${ctx.sessionId} has no agent to delegate as` });
  if (target === caller) refuse(ctx, { ...base, reason: "self_delegation", detail: `${caller} cannot delegate to itself` });
  if (target !== "wright" && getAgent(ctx.store, target) === undefined) {
    refuse(ctx, { ...base, reason: "no_such_agent", detail: `no agent ${JSON.stringify(target)} (neither wright nor a registered crew member)` });
  }
  if (!isRoutable(ctx.store, target)) refuse(ctx, { ...base, reason: "agent_off", detail: `${target} is off: it takes no messages` });
  if (a.workspace !== undefined && !workspaceListed(ctx, target, a.workspace)) {
    refuse(ctx, { ...base, reason: "workspace_not_listed", detail: `${JSON.stringify(a.workspace)} is not one of ${target}'s settings workspaces` });
  }
  const limit = delegationLimit(ctx, caller);
  if (limit !== undefined && depth > limit) {
    refuse(ctx, { ...base, reason: "delegation_depth", detail: `${caller} may delegate to depth ${limit}; this delegation would be depth ${depth}` }, () =>
      notifyDepthRefusal(ctx, row, { caller, target, depth, limit }),
    );
  }
  return { caller, depth };
}

/** The success step's work: one queued `message` event and one `agent_message_queued` event. */
function queueMessage(ctx: ContributedToolContext, a: Args, ok: Admitted): AgentMessageResult {
  const now = ctx.now();
  const payload = { agent: a.agent, text: a.text, from_agent: ok.caller, depth: ok.depth, ...(a.workspace !== undefined ? { workspace: a.workspace } : {}) };
  const queued = enqueueEvent(ctx.store, { kind: "message", payload, sessionId: ctx.sessionId }, now);
  appendEvent(ctx.store, "agent_message_queued", { sessionId: ctx.sessionId, taskId: null }, { from: ok.caller, to: a.agent, depth: ok.depth, queue_id: queued.id }, now.toISOString());
  return {
    queue_id: queued.id,
    agent: a.agent,
    depth: ok.depth,
    note: `Queued for ${a.agent}. Its reply arrives later as a new message; do not wait for it: end your turn.`,
  };
}

const agentMessageTool = defineTool({
  name: AGENT_MESSAGE_TOOL_NAME,
  description:
    "Hand work to another agent (a crew member, or wright): queues your text as a new message for it and returns at once with {queue_id, agent, depth}. " +
    "Its reply arrives later as a new message to you; do not wait or poll for it: end your turn. " +
    "workspace (optional) must be one of the target's settings workspaces; it becomes the folder its session works in. " +
    "Refused (nothing queued) with no_agent, self_delegation, no_such_agent, agent_off, workspace_not_listed or delegation_depth (past your own limits.delegation_depth). " +
    "Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ.",
  shape,
  handler: (a, ctx): AgentMessageResult => {
    const key = ctx.stepKey(a.idempotency_key);
    // A repeat of a queued delegation returns its first result (the step's stored JSON), never re-checked: the target may be off by now.
    const done = getWorkStep(ctx.store, key);
    if (done?.status === "done") return done.result as AgentMessageResult;
    const admitted = admit(ctx, a);
    return runStep(ctx.store, key, () => queueMessage(ctx, a, admitted), { now: ctx.now });
  },
});

export const delegatePart: AgentPart = Object.freeze({
  name: "delegate",
  tools: Object.freeze([agentMessageTool]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
