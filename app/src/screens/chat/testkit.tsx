// Test-only: canned kernel rows and a scriptable bridge for Chat's unit tests
// (imported by the `*.test.tsx` files beside it, never by the app).
import { act, cleanup, render } from "@testing-library/react";
import type {
  ApiRequest,
  ApiResult,
  Approval,
  BrainMessage,
  NotificationRow,
  PlaybookListing,
  RosterEntry,
  ThreadItem,
  ThreadResponse,
  Trigger,
} from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { CrewSection } from "./CrewSection";
import { resetSeenMemory } from "./model";
import { ChatScreen } from "./Thread";

export const T0 = "2026-10-22T08:00:00.000Z";

export function agent(id: string, overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id,
    display_name: id === "wright" ? "Wright" : id.charAt(0).toUpperCase() + id.slice(1),
    avatar: { shape: id === "wright" ? "whale" : "octopus", hue: "crew-teal" },
    status: "on",
    created_by: id === "wright" ? null : "owner",
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

export function message(id: number, overrides: Partial<BrainMessage> = {}): Extract<ThreadItem, { type: "message" }> {
  return {
    type: "message",
    id,
    queue_id: id,
    agent: "wright",
    source: "ask",
    text: `question ${id}`,
    status: "replied",
    session_id: null,
    reply_text: `answer ${id}`,
    detail: null,
    created_at: T0,
    updated_at: T0,
    from_agent: null,
    depth: 0,
    reply_to: null,
    workspace: null,
    ...overrides,
  };
}

export function eventItem(id: number, kind: string, summary: string, ref: unknown = {}): Extract<ThreadItem, { type: "event" }> {
  return { type: "event", id, at: T0, kind, summary, ref };
}

export function approval(id: number, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "wright",
    requesting_session: null,
    action: "github_comment",
    payload: {},
    requested_at: T0,
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    display: `Post a comment (approval ${id})`,
    ...overrides,
  };
}

export function playbook(id: number, overrides: Partial<PlaybookListing> = {}): PlaybookListing {
  return {
    id,
    slug: `pb-${id}`,
    name: `Playbook ${id}`,
    owning_agent: "wright",
    intent: "Review PRs where I am requested",
    status: "enabled",
    version: 1,
    dedupe_key_spec: "pr:{number}:{head_sha}",
    dedupe_key_set_by: "wright",
    priority: "normal",
    priority_set_by: "wright",
    model: "haiku",
    model_set_by: "owner",
    effort: null,
    effort_set_by: null,
    token_limit_per_day: 100000,
    token_limit_set_by: "wright",
    api_key_fallback_json: null,
    api_key_fallback_set_by: null,
    created_at: T0,
    updated_at: T0,
    trigger_id: null,
    next_fire_at: null,
    ...overrides,
  };
}

export function trigger(id: number, overrides: Partial<Trigger> = {}): Trigger {
  return {
    id,
    owning_agent: "wright",
    playbook: null,
    kind: "cron",
    spec: {},
    action: "wake",
    text: `trigger text ${id}`,
    enabled: true,
    enabled_changed_by: null,
    enabled_changed_at: null,
    next_fire_at: "2026-10-22T17:00:00.000Z",
    last_fired_at: null,
    last_result: null,
    created_by: "wright",
    created_at: T0,
    ...overrides,
  };
}

export function notification(id: number, source: string, title: string): NotificationRow {
  return { id, source, title, body: "", deep_link: "loomwright-studio://chat", created_at: `2026-10-22T08:${String(id % 60).padStart(2, "0")}:00.000Z`, delivery_status: "delivered", delivery_detail: null, delivered_at: null };
}

/** The kernel the tests script: every list is mutable, read at answer time. */
export interface KitState {
  roster: RosterEntry[];
  approvals: Approval[];
  messages: BrainMessage[];
  playbooks: PlaybookListing[];
  triggers: Trigger[];
  notifications: NotificationRow[];
  threads: Record<string, ThreadResponse>;
  /** Older pages, keyed `<agent> <before>`. */
  pages: Record<string, ThreadResponse>;
  workspaces: Record<string, readonly string[] | null>;
  /** POST answers by `"POST <path>"`, defaulting to 200 `{}` (202 for `/ask`). */
  posts: Record<string, (req: ApiRequest) => ApiResult<unknown>>;
}

export interface Kit {
  readonly fake: FakeBridge;
  readonly state: KitState;
  readonly registry: CommandRegistry;
  posted(key: string): ApiRequest[];
}

export function thread(items: readonly ThreadItem[], overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return { items, next_before: null, pending_approvals: [], ...overrides };
}

const POSTS = [
  "/ask",
  "/approvals/:id/approve",
  "/approvals/:id/deny",
  "/playbooks/:id/set",
  "/playbooks/:id/off",
  "/playbooks/:id/run",
  "/triggers/:id/on",
  "/triggers/:id/off",
];

export function kit(initial: Partial<KitState> = {}): Kit {
  const state: KitState = {
    roster: [agent("wright"), agent("pim")],
    approvals: [],
    messages: [],
    playbooks: [],
    triggers: [],
    notifications: [],
    threads: {},
    pages: {},
    workspaces: { pim: ["~/work/a"] },
    posts: {},
    ...initial,
  };
  const fake = fakeBridge();
  fake.route("GET /agents", () => ok({ agents: state.roster }));
  fake.route("GET /approvals", () => ok({ approvals: state.approvals }));
  fake.route("GET /messages", () => ok({ messages: state.messages }));
  fake.route("GET /playbooks", () => ok({ playbooks: state.playbooks }));
  fake.route("GET /triggers", () => ok({ triggers: state.triggers }));
  fake.route("GET /notifications", () => ok({ notifications: state.notifications }));
  fake.route("GET /threads/:agent", (req) => {
    const who = String(req.params?.agent);
    const before = req.query?.before;
    if (before !== undefined) return ok(state.pages[`${who} ${before}`] ?? thread([]));
    const found = state.threads[who];
    return found === undefined ? { ok: false, status: 404, body: { error: "no_such_agent" } } : ok(found);
  });
  fake.route("GET /agents/:id", (req) => {
    const id = String(req.params?.id);
    const entry = state.roster.find((a) => a.id === id);
    if (entry === undefined) return { ok: false, status: 404, body: { error: "not_found" } };
    return ok({ agent: entry, settings: { file: "", content: {}, error: null }, never: null, workspaces: state.workspaces[id] ?? null, memory: { dir: "", files: [] }, charter: {} });
  });
  for (const path of POSTS) {
    const key = `POST ${path}`;
    fake.route(key, (req) => state.posts[key]?.(req) ?? (path === "/ask" ? { ok: true, status: 202, body: { message_id: 100, queue_id: 100 } } : ok({})));
  }
  return { fake, state, registry: createCommandRegistry(), posted: (key) => fake.requestsTo(key).map((r) => r.req) };
}

/** Render the Crew section and the screen over `k`, at `hash`. */
export async function renderChat(k: Kit, hash = "#/chat") {
  window.location.hash = hash;
  const view = render(
    <>
      <CrewSection api={k.fake.bridge} registry={k.registry} />
      <ChatScreen api={k.fake.bridge} />
    </>,
  );
  await act(async () => undefined);
  return view;
}

/** Go to `hash` the way the shell sees it. */
export async function go(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

export function resetChat(): void {
  cleanup();
  window.location.hash = "";
  try {
    window.localStorage.clear();
  } catch {
    // A test stubbed storage.
  }
  resetSeenMemory();
}
