// The Approvals screen's canned kernel (phase 5 item 15), for
// `startFixtureKernel({ routes })`. Every body is typed by the contract.
//
// It answers the five approval routes the way the kernel does where the
// screen can tell (`kernel/src/approvals/routes.ts` and `store.ts`):
//
// - `GET /approvals` lists the pending ones; `?all=1` adds the decided ones.
// - `POST /approvals/:id/approve` takes `{ decision: "once" | "always" }`.
//   A decided approval answers `409 approval_not_pending`; an `always` with no
//   playbook, or one the test marks refused, answers `409
//   always_not_supported` with the kernel's message. A decision records the
//   `approval:<id>` brain message the agent gets and, for a kernel-applied
//   tool, the kernel's `applied` sentence.
// - `POST /approvals/:id/deny`, `GET /approvals/grants` and
//   `POST /approvals/grants/:id/revoke`.
//
// The state is mutable, so a spec can make an approval arrive or leave, and
// every POST is recorded with its params and body. `onChange` is called after
// each decision and revoke with the event kind the kernel would append, so a
// spec can push it through the feed.
import type { Approval, BrainMessage, EventFrame, Grant, RouteKey, SessionSummary, ThreadItem, ThreadResponse } from "../../src/api/contract";
import type { FixtureAnswer, FixtureRequest, FixtureRoute } from "../fixture-kernel";

export const KERNEL_AGENT_CREATE = "mcp__kernel__kernel_agent_create";
export const KERNEL_PLAYBOOK_ENABLE = "mcp__kernel__kernel_playbook_enable";

/** The kernel's sentence for an approval asked for by its agent (the first refusal `alwaysRefusal` gives). */
export function notRailHeldMessage(id: number): string {
  return `always needs an approval the rail held: approval ${id} was asked for by its agent (kernel_approval_request); approve it once`;
}

/** The kernel's sentence for an always-held tool. */
export function alwaysHeldMessage(tool: string): string {
  return `always never covers ${tool}: the owner decides every call to it; approve it once`;
}

export interface RecordedPost {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ApprovalsKernel {
  /** Every approval, pending and decided. */
  approvals: Approval[];
  grants: Grant[];
  messages: BrainMessage[];
  sessions: SessionSummary[];
  /** The `applied` sentence the kernel answers when it allows an approval once. */
  readonly applied: Map<number, string>;
  /** The message text the agent gets for a decision, by approval id. */
  readonly agentMessages: Map<number, string>;
  /** An `always` the kernel refuses, by approval id, with its `message`. */
  readonly alwaysRefused: Map<number, string>;
  /** Every POST, in order. */
  readonly posts: RecordedPost[];
  /** Called with the event kind after a decision or a revoke. */
  onChange: (kind: string) => void;
}

const BASE = Date.parse("2026-10-22T08:00:00.000Z");

/** `minutes` after 08:00 UTC on the fixture's day. */
export function at(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

export function approval(id: number, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "ada",
    requesting_session: null,
    action: `approval ${id}`,
    payload: {},
    requested_at: at(id),
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...overrides,
  };
}

/** #1: a charter create, held from a playbook session, applied by the kernel on Allow once. The payload is the rail's `{tool, input, cwd}`. */
export function charterApproval(id = 1): Approval {
  return approval(id, {
    requesting_agent: "wright",
    requesting_session: 12,
    action: "kernel_agent_create",
    requested_at: at(1),
    playbook: { id: 2, slug: "crew-setup", version: 2 },
    payload: {
      tool: KERNEL_AGENT_CREATE,
      input: {
        charter: {
          id: "sable",
          display_name: "Sable",
          persona: "Short, dry, no hashtags unless asked.",
          duties: ["Draft posts from what shipped this week", "Summarise replies each evening"],
          model: "sonnet",
          limits: { tokens_per_day: 250000, sessions: 1 },
        },
        idempotency_key: "crew-setup-sable",
      },
      // The hook's cwd: session #12's (`cannedSessions`).
      cwd: "/Users/owner/src/studio",
    },
    display: [
      "Sable · social",
      "Persona: Short, dry, no hashtags unless asked.",
      "Duties:",
      "  - Draft posts from what shipped this week",
      "  - Summarise replies each evening",
      "Model: sonnet · 250,000 tokens/day · 1 session",
    ].join("\n"),
  });
}

/**
 * Approval 6 of the phase 5 live run: Wright's chat session (no playbook)
 * asking to enable playbook 3, which the chat fixture serves as `pr-review`.
 */
export function enableApproval(id = 6): Approval {
  return approval(id, {
    requesting_agent: "wright",
    requesting_session: 12,
    action: "kernel_playbook_enable",
    requested_at: at(9),
    playbook: null,
    payload: { tool: KERNEL_PLAYBOOK_ENABLE, input: { id: 3, idempotency_key: "k" }, cwd: "/" },
    display: "Enable playbook pr-review (v2)",
  });
}

/**
 * A `GET /threads/:agent` whose playbook 3 card is one page back: Wright's
 * first page is twelve replied messages with cursor `c1`; page `c1` is
 * playbook 3's `playbook_created` and twelve older ones. Any other agent's
 * thread is empty.
 */
export function pagedWrightThread(): FixtureRoute {
  const replied = (id: number): ThreadItem => ({
    type: "message",
    ...brainMessage(id, "wright", "ask", `Question ${id} about this week's reviews.`),
    status: "replied",
    reply_text: `Answer ${id}: two PRs are waiting on you, one is blocked on CI, and the rest are merged.`,
  });
  const range = (from: number): ThreadItem[] => Array.from({ length: 12 }, (_, i) => replied(from + i));
  const created: ThreadItem = { type: "event", id: 101, at: at(1), kind: "playbook_created", summary: "Playbook pr-review created (v1)", ref: { playbook_id: 3 } };
  return (req) => {
    if (req.params.agent !== "wright") return ok({ items: [], next_before: null, pending_approvals: [] } satisfies ThreadResponse);
    if (req.query.before === "c1") return ok({ items: [created, ...range(1)], next_before: null, pending_approvals: [] } satisfies ThreadResponse);
    return ok({ items: range(20), next_before: "c1", pending_approvals: [] } satisfies ThreadResponse);
  };
}

/** #2: a rail-held Bash call from a playbook session, with its own cwd. */
export function reviewApproval(id = 2): Approval {
  return approval(id, {
    requesting_agent: "ada",
    requesting_session: 14,
    action: "Bash",
    requested_at: at(3),
    playbook: { id: 5, slug: "review-prs", version: 3 },
    payload: { tool: "Bash", command: "gh pr review 412 --request-changes --body-file review.md", cwd: "/Users/owner/src/loomwright" },
    display: "gh pr review 412 --request-changes --body-file review.md",
  });
}

/** #3: an agent's own request (no playbook): always is refused before asking. */
export function requestApproval(id = 3): Approval {
  return approval(id, {
    requesting_agent: "reeve",
    requesting_session: null,
    action: "post a status note",
    requested_at: at(5),
    playbook: null,
    payload: { channel: "#standup", text: "Two tickets moved to review; one blocker older than two days." },
  });
}

/** An approval whose untrusted fields carry an ANSI escape and a bidi override. */
export function hostileApproval(id = 4): Approval {
  return approval(id, {
    requesting_agent: "ada",
    requesting_session: 14,
    action: "Bash",
    requested_at: at(7),
    playbook: { id: 5, slug: "review-prs", version: 3 },
    payload: { tool: "Bash", command: "printf '\u001b[31mOK\u001b[0m' > notes\u202etxt.exe", cwd: "/tmp/work" },
    display: "\u001b[31mOK\u001b[0m written to notes\u202etxt.exe",
  });
}

export function grant(id: number, overrides: Partial<Grant> = {}): Grant {
  return {
    id,
    playbook: { id: 5, slug: "review-prs", version: 3 },
    action: "Bash",
    payload: { tool: "Bash", command: "gh pr comment 405 --body-file summary.md" },
    requesting_agent: "ada",
    granted_at: at(-600),
    current: true,
    ...overrides,
  };
}

/** Two standing grants: one current, one whose playbook has a newer version. */
export function cannedGrants(): Grant[] {
  return [
    grant(21),
    grant(17, {
      playbook: { id: 6, slug: "weekly-ship-post", version: 1 },
      action: "mcp__x__post",
      payload: { tool: "mcp__x__post", text: "This week: the approvals inbox." },
      requesting_agent: "sable",
      granted_at: at(-2_000),
      current: false,
    }),
  ];
}

export function session(id: number, agent: string, cwd: string | null): SessionSummary {
  return { id, agent, status: "running", model: "sonnet", started: at(0), ended: null, tokens: 1200, cwd, playbook: null };
}

export function cannedSessions(): SessionSummary[] {
  return [session(12, "wright", "/Users/owner/src/studio"), session(14, "ada", "/Users/owner/src/loomwright")];
}

export function brainMessage(id: number, agent: string, source: string, text: string): BrainMessage {
  return {
    id,
    queue_id: id,
    agent,
    source,
    text,
    status: "queued",
    session_id: null,
    reply_text: null,
    detail: null,
    created_at: at(30),
    updated_at: at(30),
    from_agent: null,
    depth: 0,
    reply_to: null,
    workspace: null,
  };
}

export interface ApprovalsKernelInit {
  readonly approvals?: readonly Approval[];
  readonly grants?: readonly Grant[];
  readonly sessions?: readonly SessionSummary[];
  readonly messages?: readonly BrainMessage[];
}

export function approvalsKernel(init: ApprovalsKernelInit = {}): ApprovalsKernel {
  return {
    approvals: [...(init.approvals ?? [])],
    grants: [...(init.grants ?? [])],
    messages: [...(init.messages ?? [])],
    sessions: [...(init.sessions ?? cannedSessions())],
    applied: new Map(),
    agentMessages: new Map(),
    alwaysRefused: new Map(),
    posts: [],
    onChange: () => undefined,
  };
}

const ok = (body: unknown): FixtureAnswer => ({ status: 200, body });
const refused = (status: number, error: string, message?: string): FixtureAnswer => ({
  status,
  body: message === undefined ? { error } : { error, message },
});

function decide(kernel: ApprovalsKernel, req: FixtureRequest, decision: "once" | "always" | "deny"): FixtureAnswer {
  kernel.posts.push({ path: req.path, params: req.params, body: req.body });
  const id = Number(req.params.id);
  const index = kernel.approvals.findIndex((a) => a.id === id);
  const current = kernel.approvals[index];
  if (current === undefined) return refused(404, "no_such_approval", `no approval ${id}`);
  if (current.status !== "pending") return refused(409, "approval_not_pending", `approval ${id} is ${current.status}`);
  if (decision === "always") {
    const message = current.playbook === null ? notRailHeldMessage(id) : kernel.alwaysRefused.get(id);
    if (message !== undefined) return refused(409, "always_not_supported", message);
  }
  const applied = decision === "once" ? kernel.applied.get(id) : undefined;
  const decided: Approval = {
    ...current,
    status: decision === "deny" ? "denied" : "approved",
    decision,
    decided_by: "owner",
    decided_at: new Date().toISOString(),
    ...(applied === undefined ? {} : { applied }),
  };
  kernel.approvals[index] = decided;
  const text =
    kernel.agentMessages.get(id) ??
    (decision === "deny" ? `The owner denied approval ${id} (${current.action}).` : `The owner approved approval ${id} (${current.action}) ${decision}.`);
  kernel.messages.push(brainMessage(1_000 + id, current.requesting_agent, `approval:${id}`, text));
  kernel.onChange("approval_decided");
  return ok({ approval: decided });
}

/** The routes, over `kernel`'s live state. */
export function approvalsRoutes(kernel: ApprovalsKernel): Partial<Record<RouteKey, FixtureRoute>> {
  return {
    "GET /approvals": (req) => {
      const pending = kernel.approvals.filter((a) => a.status === "pending");
      if (req.query.all !== "1") return ok({ approvals: pending });
      const decided = kernel.approvals.filter((a) => a.status !== "pending").sort((a, b) => (b.decided_at ?? "").localeCompare(a.decided_at ?? ""));
      return ok({ approvals: [...pending, ...decided] });
    },
    "POST /approvals/:id/approve": (req) => {
      const decision = (req.body as { decision?: unknown } | undefined)?.decision;
      if (decision !== "once" && decision !== "always") {
        kernel.posts.push({ path: req.path, params: req.params, body: req.body });
        return refused(400, "invalid_decision");
      }
      return decide(kernel, req, decision);
    },
    "POST /approvals/:id/deny": (req) => decide(kernel, req, "deny"),
    "GET /approvals/grants": () => ok({ grants: kernel.grants }),
    "POST /approvals/grants/:id/revoke": (req) => {
      kernel.posts.push({ path: req.path, params: req.params, body: req.body });
      const id = Number(req.params.id);
      const found = kernel.grants.find((g) => g.id === id);
      if (found === undefined) return refused(404, "no_such_grant", `no standing grant ${id}`);
      kernel.grants = kernel.grants.filter((g) => g.id !== id);
      kernel.onChange("approval_grant_revoked");
      return ok({ grant: found });
    },
    "GET /messages": () => ok({ messages: kernel.messages }),
    "GET /sessions": () => ok({ sessions: kernel.sessions }),
  };
}

/** An `events` row of `kind`, for `FixtureKernel.appendEvent`. */
export function approvalEvent(id: number, kind: string): EventFrame {
  return { type: "event", id, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload: {} };
}
