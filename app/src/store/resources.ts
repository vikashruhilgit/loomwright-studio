// The live store's resource table and its event routing (phase 5 item 12).
//
// A resource is one contract read (`GET` only), loaded through the preload
// bridge: `status` eagerly, every other one on its first use. The feed then
// tells the store WHICH resources to refetch, by the event's `kind` alone:
// `payload` is the stored JSON, untrusted, and never interpreted
// (`app/src/api/contract.ts`, `EventFrame`).
//
// Plain TypeScript: no React, no DOM-only API, no `import.meta` (the e2e
// imports it under `tsconfig.node.json`).
import type {
  AgentsResponse,
  ApprovalsResponse,
  GrantsResponse,
  MessagesResponse,
  NotificationsResponse,
  PlaybooksResponse,
  SessionsResponse,
  StatusBody,
  ThreadResponse,
  TriggersResponse,
} from "../api/contract";

/** One read: a contract route (method and path exactly as in `CONTRACT_ROUTES`), its query, and its path params. */
export interface ResourceRequest {
  readonly method: "GET";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, string>>;
}

/** The resources with one fixed route each, and the body each one holds. */
export interface FixedResourceBodies {
  readonly status: StatusBody;
  readonly approvals: ApprovalsResponse;
  readonly grants: GrantsResponse;
  readonly agents: AgentsResponse;
  readonly messages: MessagesResponse;
  readonly sessions: SessionsResponse;
  readonly playbooks: PlaybooksResponse;
  readonly triggers: TriggersResponse;
  readonly notifications: NotificationsResponse;
}

export type FixedResourceName = keyof FixedResourceBodies;

/** A thread is keyed per agent (`GET /threads/:agent`, first page only: paging backwards is item 13's). */
export type ThreadResourceName = `thread:${string}`;

export type ResourceName = FixedResourceName | ThreadResourceName;

/** The body a resource holds once the kernel has answered it. */
export type ResourceBody<N extends ResourceName> = N extends FixedResourceName ? FixedResourceBodies[N] : ThreadResponse;

/** The resource table: name -> contract read. */
export const FIXED_RESOURCES: { readonly [N in FixedResourceName]: ResourceRequest } = Object.freeze({
  status: { method: "GET", path: "/status" },
  approvals: { method: "GET", path: "/approvals" },
  grants: { method: "GET", path: "/approvals/grants" },
  agents: { method: "GET", path: "/agents" },
  messages: { method: "GET", path: "/messages", query: { all: "1" } },
  sessions: { method: "GET", path: "/sessions" },
  playbooks: { method: "GET", path: "/playbooks" },
  triggers: { method: "GET", path: "/triggers" },
  notifications: { method: "GET", path: "/notifications" },
});

const THREAD_PREFIX = "thread:";

/** The thread resource for `agent`. */
export function threadResource(agent: string): ThreadResourceName {
  return `${THREAD_PREFIX}${agent}`;
}

export function isThreadResource(name: string): name is ThreadResourceName {
  return name.startsWith(THREAD_PREFIX) && name.length > THREAD_PREFIX.length;
}

export function isResourceName(name: string): name is ResourceName {
  return Object.hasOwn(FIXED_RESOURCES, name) || isThreadResource(name);
}

/** The contract read behind `name`. */
export function resourceRequest(name: ResourceName): ResourceRequest {
  if (isThreadResource(name)) return { method: "GET", path: "/threads/:agent", params: { agent: name.slice(THREAD_PREFIX.length) } };
  return FIXED_RESOURCES[name];
}

/**
 * The `kind` -> resources routing table: prefix match on `EventFrame.kind`,
 * first match wins (so `agent_message_` sits above `agent_`). Every routed
 * event ALSO refetches each loaded thread (the store adds those). Prefixes
 * checked against the kernel's `appendEvent(` call sites at base 58c2e4c.
 */
export const KIND_ROUTES: readonly { readonly prefix: string; readonly resources: readonly FixedResourceName[] }[] = Object.freeze([
  { prefix: "approval_", resources: ["approvals", "grants"] },
  { prefix: "agent_message_", resources: ["messages"] },
  { prefix: "agent_", resources: ["agents"] },
  { prefix: "playbook_", resources: ["playbooks", "triggers"] },
  { prefix: "trigger_", resources: ["triggers"] },
  // `wakeup_scheduled` also changes `GET /status`'s `wakeups`.
  { prefix: "wakeup_", resources: ["triggers", "status"] },
  { prefix: "notification_", resources: ["notifications"] },
  { prefix: "notify", resources: ["notifications"] },
  { prefix: "session_", resources: ["sessions", "status"] },
  { prefix: "stop_", resources: ["sessions", "status"] },
  { prefix: "tool_decision", resources: ["sessions", "status"] },
  // `event_enqueued` / `event_done` / `event_failed` / `event_parked`: the
  // queue in `GET /status`, and a brain message's status (an ask's reply ends
  // in `event_done`, with no `agent_message_*` event).
  { prefix: "event_", resources: ["status", "messages"] },
]);

/** Anything no prefix matches. */
export const DEFAULT_ROUTE: readonly FixedResourceName[] = Object.freeze(["status"]);

/** The fixed resources an event of `kind` makes stale (threads are added by the store). */
export function resourcesForKind(kind: string): readonly FixedResourceName[] {
  return KIND_ROUTES.find((route) => kind.startsWith(route.prefix))?.resources ?? DEFAULT_ROUTE;
}
