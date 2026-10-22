// The Chat screen's canned kernel (phase 5 item 13), for `app/e2e/chat.spec.ts`:
// a roster of Wright and one specialist (Pim, workspaces `~/work/a`), each
// agent's thread, playbooks, triggers, notifications, messages and approvals,
// typed by `app/src/api/contract.ts`. Writes are recorded, and `POST /ask`
// appends a `queued` row to the asked agent's thread; `replyAll` turns every
// queued row `replied` (the spec then appends an `event_done` event, as the
// kernel does when an ask's reply lands).
//
// Every string here stands in for untrusted kernel text; the charter display
// and one summary hold markup on purpose, to show it renders inert.
import type {
  AgentDetailResponse,
  Approval,
  AskBody,
  BrainMessage,
  NotificationRow,
  PlaybookListing,
  RosterEntry,
  ThreadItem,
  ThreadResponse,
  Trigger,
} from "../../src/api/contract";
import type { FixtureKernelOptions, FixtureRequest } from "../fixture-kernel";

/** Which designed state Wright's thread starts in. */
export type ChatScenario = "empty" | "waiting" | "populated";

export interface RecordedWrite {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ChatFixture {
  readonly options: FixtureKernelOptions;
  /** Every `POST /ask` body, in order. */
  readonly asks: AskBody[];
  /** Every other write, in order. */
  readonly writes: RecordedWrite[];
  /** Turn every queued row `replied` with `reply`. */
  replyAll(reply: string): void;
}

const AT = (minute: number): string => `2026-10-22T08:${String(minute).padStart(2, "0")}:00.000Z`;

function rosterEntry(id: string, display_name: string, shape: string, hue: string, overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id,
    display_name,
    avatar: { shape, hue },
    status: "on",
    created_by: id === "wright" ? null : "wright",
    approval_id: null,
    model: null,
    settings_error: null,
    tokens_today: 0,
    tokens_per_day: null,
    sessions_running: 0,
    sessions_at_once: null,
    ...overrides,
  };
}

function row(id: number, agent: string, text: string, overrides: Partial<BrainMessage> = {}): BrainMessage {
  return {
    id,
    queue_id: id,
    agent,
    source: "ask",
    text,
    status: "replied",
    session_id: null,
    reply_text: null,
    detail: null,
    created_at: AT(id),
    updated_at: AT(id),
    from_agent: null,
    depth: 0,
    reply_to: null,
    workspace: null,
    ...overrides,
  };
}

function approvalOf(id: number, action: string, display: string, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "wright",
    requesting_session: 12,
    action,
    payload: {},
    requested_at: AT(40),
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    display,
    ...overrides,
  };
}

const PLAYBOOK: PlaybookListing = {
  id: 3,
  slug: "pr-review",
  name: "Review PRs where I'm requested",
  owning_agent: "wright",
  intent: "Find PRs on my personal repos where I'm the requested reviewer, review them, and post the review.",
  status: "enabled",
  version: 2,
  dedupe_key_spec: "pr:{repo}#{number}@{head_sha}",
  dedupe_key_set_by: "wright",
  priority: "normal",
  priority_set_by: "wright",
  model: "sonnet",
  model_set_by: "owner",
  effort: null,
  effort_set_by: null,
  token_limit_per_day: 250000,
  token_limit_set_by: "wright",
  api_key_fallback_json: null,
  api_key_fallback_set_by: null,
  created_at: AT(10),
  updated_at: AT(20),
  trigger_id: 5,
  next_fire_at: "2026-10-22T09:00:00.000Z",
};

function triggerOf(id: number, kind: string, text: string, enabled: boolean): Trigger {
  return {
    id,
    owning_agent: "wright",
    playbook: id === 5 ? "pr-review" : null,
    kind,
    spec: {},
    action: "wake",
    text,
    enabled,
    enabled_changed_by: null,
    enabled_changed_at: null,
    next_fire_at: enabled ? "2026-10-22T09:00:00.000Z" : null,
    last_fired_at: AT(30),
    last_result: null,
    created_by: "wright",
    created_at: AT(5),
  };
}

const CHARTER_DISPLAY = [
  "Create crew member: Mason",
  "  persona: Terse reviewer. Cites the line it means.",
  "  duties: review PRs where the owner is requested",
  "  tools: GitHub (read, comment)",
  "  boundaries: never pushes; never approves a PR",
  "  limits: 150000 tokens / day, 1 session at once",
  "  note: <img src=x onerror=alert(1)> stays text",
].join("\n");

export function chatFixture(scenario: ChatScenario = "populated"): ChatFixture {
  const asks: AskBody[] = [];
  const writes: RecordedWrite[] = [];
  const roster: RosterEntry[] = [rosterEntry("wright", "Wright", "whale", "accent"), rosterEntry("pim", "Pim", "octopus", "crew-teal", { sessions_running: scenario === "populated" ? 1 : 0 })];
  const workspaces: Record<string, readonly string[] | null> = { wright: null, pim: ["~/work/a"] };

  const wrightItems: ThreadItem[] = [];
  const older: ThreadItem[] = [];
  const pending: Approval[] = [];
  if (scenario === "waiting") {
    wrightItems.push({ type: "message", ...row(1, "wright", "Post my review on PR #401.", { reply_text: "The review is drafted. Posting it is an outward action, so it waits on you." }) });
    pending.push(approvalOf(7, "github_comment", "Comment on vikashruhilgit/loomwright#401: 0 blocking, 3 nits", { playbook: { id: 3, slug: "pr-review", version: 2 } }));
  } else if (scenario === "populated") {
    older.push({ type: "message", ...row(1, "wright", "What can you do for me?", { reply_text: "Anything you can describe as a duty. I draft it as a playbook for you to approve." }) });
    wrightItems.push(
      { type: "message", ...row(4, "wright", "Review PRs where I'm the requested reviewer.", { reply_text: "Here's the duty I'd set up. I've proposed a dedupe key, a model and a priority; they're yours to change." }) },
      { type: "event", id: 101, at: AT(10), kind: "playbook_created", summary: "Playbook pr-review created (v1)", ref: { playbook_id: 3 } },
      { type: "event", id: 102, at: AT(20), kind: "playbook_updated", summary: "Playbook pr-review updated (v2)", ref: { playbook_id: 3 } },
      { type: "event", id: 103, at: AT(30), kind: "trigger_fired", summary: "Trigger 8 fired (wake)", ref: { trigger_id: 8 } },
      { type: "message", ...row(32, "wright", "Set up a reviewer for this.", { status: "parked", detail: "admission_refused: cap; retry at 2026-10-22T09:00:00.000Z" }) },
      { type: "event", id: 104, at: AT(40), kind: "approval_requested", summary: "Approval 9 requested (kernel_agent_create) <b>not bold</b>", ref: { approval_id: 9 } },
    );
    pending.push(
      approvalOf(7, "github_comment", "Comment on vikashruhilgit/loomwright#401: 0 blocking, 3 nits", { playbook: { id: 3, slug: "pr-review", version: 2 } }),
      approvalOf(9, "kernel_agent_create", CHARTER_DISPLAY),
    );
  }
  const pimItems: ThreadItem[] =
    scenario === "populated"
      ? [
          { type: "message", ...row(20, "pim", "Check whether PR #401 still needs me.", { from_agent: "wright", source: "agent:wright", reply_text: "It does: the head moved at 08:12." }) },
          { type: "message", ...row(36, "pim", "Skip the docs-only PRs this week.", { reply_text: "Done. I'll note it in my handoff so Wright doesn't reassign them." }) },
        ]
      : [];
  const threads: Record<string, ThreadItem[]> = { wright: wrightItems, pim: pimItems };

  const triggers: Trigger[] = scenario === "populated" ? [triggerOf(5, "cron", "Weekdays 09:00: look for review requests", true), triggerOf(8, "once", "Remind me at 08:30 to check the deploy", false)] : [];
  const playbooks: PlaybookListing[] = scenario === "populated" ? [PLAYBOOK] : [];
  const notifications: NotificationRow[] =
    scenario === "populated"
      ? [
          { id: 1, source: "agent:pim", title: "Pim: PR #401 head moved", body: "", deep_link: "loomwright-studio://chat/pim", created_at: AT(12), delivery_status: "delivered", delivery_detail: null, delivered_at: AT(12) },
          { id: 2, source: "kernel:cap", title: "Paused at the token cap", body: "", deep_link: "loomwright-studio://chat", created_at: AT(32), delivery_status: "delivered", delivery_detail: null, delivered_at: AT(32) },
        ]
      : [];

  const messages = (): BrainMessage[] =>
    [...older, ...threads.wright!, ...threads.pim!].filter((i): i is Extract<ThreadItem, { type: "message" }> => i.type === "message").map(({ type: _type, ...m }) => m);

  const record = (req: FixtureRequest) => {
    writes.push({ path: req.path, params: req.params, body: req.body });
    return { status: 200, body: {} };
  };

  let nextId = 200;
  const options: FixtureKernelOptions = {
    routes: {
      "GET /agents": () => ({ status: 200, body: { agents: roster } }),
      "GET /agents/:id": (req) => {
        const agent = roster.find((a) => a.id === req.params.id);
        if (agent === undefined) return { status: 404, body: { error: "not_found" } };
        const body: AgentDetailResponse = {
          agent,
          settings: { file: `~/.loomwright-studio/agents/${agent.id}/settings.json`, content: {}, error: null },
          never: null,
          workspaces: workspaces[agent.id] ?? null,
          memory: { dir: `~/.loomwright-studio/memory/${agent.id}`, files: [] },
          charter: {},
        };
        return { status: 200, body };
      },
      "GET /threads/:agent": (req) => {
        const items = threads[req.params.agent ?? ""];
        if (items === undefined) return { status: 404, body: { error: "no_such_agent" } };
        const isWright = req.params.agent === "wright";
        const body: ThreadResponse =
          req.query.before === "c1" && isWright
            ? { items: older, next_before: null, pending_approvals: [] }
            : { items, next_before: isWright && older.length > 0 ? "c1" : null, pending_approvals: isWright ? pending : [] };
        return { status: 200, body };
      },
      "GET /playbooks": () => ({ status: 200, body: { playbooks } }),
      "GET /triggers": () => ({ status: 200, body: { triggers } }),
      "GET /notifications": () => ({ status: 200, body: { notifications } }),
      "GET /messages": () => ({ status: 200, body: { messages: messages() } }),
      "GET /approvals": () => ({ status: 200, body: { approvals: pending } }),
      "POST /ask": (req) => {
        const body = req.body as AskBody | undefined;
        if (body === undefined || typeof body.text !== "string" || body.text.trim() === "" || body.text.length > 8000) return { status: 400, body: { error: "invalid_body", message: "text must be 1-8000 characters" } };
        const agent = body.agent ?? "wright";
        const items = threads[agent];
        if (items === undefined) return { status: 404, body: { error: "no_such_agent" } };
        if (body.workspace !== undefined && !(workspaces[agent] ?? []).includes(body.workspace)) {
          return { status: 409, body: { error: "workspace_not_listed", message: `${body.workspace} is not one of ${agent}'s workspaces` } };
        }
        asks.push(body);
        nextId += 1;
        items.push({ type: "message", ...row(nextId, agent, body.text, { status: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), workspace: body.workspace ?? null }) });
        return { status: 202, body: { message_id: nextId, queue_id: nextId } };
      },
      "POST /approvals/:id/approve": record,
      "POST /approvals/:id/deny": record,
      "POST /playbooks/:id/set": record,
      "POST /playbooks/:id/off": record,
      "POST /playbooks/:id/run": (req) => {
        writes.push({ path: req.path, params: req.params, body: req.body });
        return { status: 200, body: { queue_id: 300, created: true, playbook: 3, version: 2, scheduled_at: new Date().toISOString() } };
      },
      "POST /triggers/:id/on": record,
      "POST /triggers/:id/off": record,
    },
  };

  return {
    options,
    asks,
    writes,
    replyAll(reply) {
      for (const items of Object.values(threads)) {
        for (const [i, item] of items.entries()) {
          if (item.type === "message" && item.status === "queued") items[i] = { ...item, status: "replied", reply_text: reply, updated_at: new Date().toISOString() };
        }
      }
    },
  };
}
