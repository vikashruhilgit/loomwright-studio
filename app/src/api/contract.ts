// The app's API contract: TypeScript types for every kernel route the app
// calls, and for the live feed's frames. It is the one file later items code
// against. The kernel's routes are the truth: each kernel item makes its route
// match this file, and `kernel/test/console-contract.test.ts` pins
// `CONTRACT_ROUTES`' methods and paths (it reads this file as text, so keep
// each entry on one line, in the `{ method: "…", path: "…", … }` form).
//
// Every string the kernel returns that came from a model, a tool, a PR, a
// ticket or a person is untrusted data (invariant 3): render it as text, never
// as markup, and never act on it.
//
// Every request is authenticated by the main process with the Keychain bearer
// token; the renderer never sees it (see `app/electron/kernel-connection.ts`).

/** An HTTP method the API serves. */
export type HttpMethod = "GET" | "POST";

/**
 * Where a route comes from: the phase that built it (existing at the phase 5
 * base), the phase 5 item that adds it (`item-NN`), or the phase 6 item that
 * adds it (`p6-item-NN`).
 */
export type RouteOrigin =
  | "phase-1"
  | "brain"
  | "notifications"
  | "approvals"
  | "triggers"
  | "playbooks"
  | "agents"
  | "item-02"
  | "item-03"
  | "item-04"
  | "item-05"
  | "item-06"
  | "p6-item-03"
  | "p6-item-07";

export interface ContractRoute {
  readonly method: HttpMethod;
  /** The kernel's declared path: an exact path or `:param` segments, as `ContributedRoute.path`. */
  readonly path: string;
  readonly origin: RouteOrigin;
}

/**
 * Every route the app calls, each listed once. `origin` names an existing
 * feature for a route the kernel serves at the phase 5 base, and `item-NN` for
 * one a phase 5 item adds. Item 07 adds no route: it widens the existing
 * `POST /agents/:id/set` to accept `wright` (see `AgentSetBody`).
 *
 * Phase 6's routes are `p6-item-NN`: the GitHub connector's four (item 03)
 * and the draft outputs' two (item 07). The phase 6 foundation lists them
 * before the kernel serves them; until its item lands each one answers 404.
 * Phase 6 item 08 adds no route: it widens `POST /agents/:id/set` to take
 * `connectors` (see `AgentConnectorsSetBody`).
 */
export const CONTRACT_ROUTES: readonly ContractRoute[] = Object.freeze([
  { method: "GET", path: "/status", origin: "phase-1" },
  { method: "POST", path: "/stop-all", origin: "phase-1" },
  { method: "POST", path: "/resume", origin: "phase-1" },
  { method: "POST", path: "/sessions/:id/abandon", origin: "phase-1" },
  { method: "POST", path: "/ask", origin: "brain" },
  { method: "GET", path: "/messages", origin: "brain" },
  { method: "GET", path: "/messages/:id", origin: "brain" },
  { method: "GET", path: "/notifications", origin: "notifications" },
  { method: "GET", path: "/notifications/:id", origin: "notifications" },
  { method: "GET", path: "/approvals", origin: "approvals" },
  { method: "POST", path: "/approvals/:id/approve", origin: "approvals" },
  { method: "POST", path: "/approvals/:id/deny", origin: "approvals" },
  { method: "GET", path: "/approvals/grants", origin: "approvals" },
  { method: "POST", path: "/approvals/grants/:id/revoke", origin: "approvals" },
  { method: "GET", path: "/triggers", origin: "triggers" },
  { method: "POST", path: "/triggers/:id/on", origin: "triggers" },
  { method: "POST", path: "/triggers/:id/off", origin: "triggers" },
  { method: "GET", path: "/playbooks", origin: "playbooks" },
  { method: "GET", path: "/playbooks/:ref", origin: "playbooks" },
  { method: "POST", path: "/playbooks/:id/set", origin: "playbooks" },
  { method: "POST", path: "/playbooks/:id/off", origin: "playbooks" },
  { method: "POST", path: "/playbooks/:id/run", origin: "playbooks" },
  { method: "GET", path: "/agents", origin: "agents" },
  { method: "GET", path: "/agents/:id", origin: "agents" },
  { method: "POST", path: "/agents", origin: "agents" },
  { method: "POST", path: "/agents/:id/rename", origin: "agents" },
  { method: "POST", path: "/agents/:id/set", origin: "agents" },
  { method: "POST", path: "/agents/:id/off", origin: "agents" },
  { method: "POST", path: "/agents/:id/on", origin: "agents" },
  { method: "GET", path: "/events", origin: "item-02" },
  { method: "GET", path: "/events/stream", origin: "item-02" },
  { method: "GET", path: "/sessions", origin: "item-03" },
  { method: "GET", path: "/sessions/:id/output", origin: "item-03" },
  { method: "POST", path: "/sessions/:id/stop", origin: "item-04" },
  { method: "POST", path: "/sessions/:id/kill", origin: "item-04" },
  { method: "POST", path: "/pause", origin: "item-05" },
  { method: "POST", path: "/unpause", origin: "item-05" },
  { method: "GET", path: "/threads/:agent", origin: "item-06" },
  { method: "GET", path: "/connectors", origin: "p6-item-03" },
  { method: "POST", path: "/connectors/github/token", origin: "p6-item-03" },
  { method: "POST", path: "/connectors/github/disconnect", origin: "p6-item-03" },
  { method: "GET", path: "/connectors/github/repos", origin: "p6-item-03" },
  { method: "GET", path: "/drafts", origin: "p6-item-07" },
  { method: "GET", path: "/drafts/:id", origin: "p6-item-07" },
]);

// ---- Shared shapes -------------------------------------------------------------

/** UTC ISO-8601, as the kernel writes it (`toISOString()`). */
export type IsoTime = string;

/** Every refusal: a stable machine code, plus fields some routes add (a `message`, the current `status`, a `file`). */
export interface ApiError {
  readonly error: string;
  readonly message?: string;
  readonly [extra: string]: unknown;
}

/** The kernel's session statuses (`SESSION_STATUSES` in `kernel/src/sessions/types.ts`), kept open: render an unknown one as text. */
export type SessionStatus = string;

// ---- Phase 1: GET /status, POST /stop-all, POST /resume, POST /sessions/:id/abandon ----

export type AuthHealth =
  | { readonly status: "ok" }
  | { readonly status: "missing" }
  | { readonly status: "invalid_shape" }
  | { readonly status: "expiring"; readonly days: number }
  | { readonly status: "error"; readonly reason: string };

export interface KillSwitchState {
  readonly engaged: boolean;
  readonly since: IsoTime | null;
}

export type LoomwrightAdapterStatus =
  | {
      readonly status: "ok";
      readonly install_path: string;
      readonly plugin_version: string;
      readonly contract_schema_version: number;
      readonly host_switch: boolean;
    }
  | { readonly status: "error"; readonly reason: string; readonly path: string; readonly message: string };

/** `GET /status` (`StatusBody` in `kernel/src/api/server.ts`). Item 05 adds `paused`. */
export interface StatusBody {
  readonly kernel: { readonly version: string; readonly uptime_s: number; readonly pid: number };
  readonly kill_switch: KillSwitchState;
  /** Item 05: whether new work is paused. Absent from a kernel before item 05. */
  readonly paused?: boolean;
  readonly auth: readonly { readonly id: string; readonly account: string | null; readonly health: AuthHealth }[];
  readonly sessions: readonly {
    readonly id: number;
    readonly agent: string | null;
    readonly model: string | null;
    readonly pgid: number | null;
    readonly started_at: IsoTime | null;
    readonly status: SessionStatus;
    readonly cwd: string | null;
  }[];
  readonly kill_unconfirmed: readonly {
    readonly id: number;
    readonly agent: string | null;
    readonly status: SessionStatus;
    readonly pgid: number | null;
    readonly kill_incomplete_at: IsoTime;
    readonly tool_groups?: readonly { readonly pgid: number; readonly command: string; readonly kill_incomplete_at: IsoTime }[];
  }[];
  readonly orphaned: readonly {
    readonly id: number;
    readonly agent: string | null;
    readonly pgid: number | null;
    readonly reason: string | null;
    readonly updated_at: IsoTime;
  }[];
  readonly queue: {
    readonly pending: number;
    readonly events: readonly {
      readonly id: number;
      readonly kind: string;
      readonly enqueued_at: IsoTime;
      readonly not_before: IsoTime | null;
      readonly attempts: number;
    }[];
  };
  readonly wakeups: {
    readonly pending: number;
    readonly items: readonly { readonly id: number; readonly due_at: IsoTime; readonly reason: string; readonly task_id: number | null }[];
  };
  readonly tokens_today: { readonly day: string; readonly agents: readonly { readonly agent: string | null; readonly counted_tokens: number }[] };
  readonly cap_state: readonly {
    readonly account: string;
    readonly provider: string;
    readonly limits: readonly {
      readonly rate_limit_type: string;
      readonly status: string;
      readonly resets_at: IsoTime | null;
      readonly utilization: number | null;
      readonly reset_source: string | null;
    }[];
  }[];
  readonly loomwright?: LoomwrightAdapterStatus;
}

export type StopAllOutcome =
  | { readonly id: number; readonly status: SessionStatus; readonly ended_on_its_own?: true }
  | { readonly id: number; readonly status: "stop_failed"; readonly error: string };

export interface StopAllResponse {
  readonly engaged: true;
  readonly sessions: readonly StopAllOutcome[];
}

/** `POST /resume`: releases the kill switch (and, after item 05, a pause). */
export interface ResumeResponse {
  readonly engaged: false;
}

export interface AbandonResponse {
  readonly id: number;
  readonly status: "abandoned";
}

// ---- The brain: POST /ask, GET /messages, GET /messages/:id ----------------------

export type BrainMessageStatus = "queued" | "running" | "replied" | "failed" | "parked";

/** A `brain_messages` row. `text`, `reply_text` and `detail` are untrusted. */
export interface BrainMessage {
  readonly id: number;
  readonly queue_id: number;
  readonly agent: string;
  /** `ask`, `trigger:<id>`, `approval:<id>`, `agent:<id>` or `message`. */
  readonly source: string;
  readonly text: string;
  readonly status: BrainMessageStatus;
  readonly session_id: number | null;
  readonly reply_text: string | null;
  readonly detail: string | null;
  readonly created_at: IsoTime;
  readonly updated_at: IsoTime;
  readonly from_agent: string | null;
  readonly depth: number;
  readonly reply_to: number | null;
  readonly workspace: string | null;
}

/** `POST /ask`: `text` 1-8000 characters, not blank; `agent` absent is Wright. */
export interface AskBody {
  readonly text: string;
  readonly agent?: string;
  readonly workspace?: string;
}

/** `202`. */
export interface AskResponse {
  readonly message_id: number;
  readonly queue_id: number;
}

export interface MessagesQuery {
  readonly agent?: string;
  readonly all?: "1";
}

export interface MessagesResponse {
  readonly messages: readonly BrainMessage[];
}

// ---- Notifications: GET /notifications, GET /notifications/:id -----------------

export interface NotificationRow {
  readonly id: number;
  /** `trigger:<id>`, `agent:<name>` or `kernel:<reason>`. */
  readonly source: string;
  readonly title: string;
  readonly body: string;
  /** A `loomwright-studio://` link the app opens. */
  readonly deep_link: string;
  readonly created_at: IsoTime;
  readonly delivery_status: string;
  readonly delivery_detail: string | null;
  readonly delivered_at: IsoTime | null;
}

export interface NotificationsQuery {
  /** 1-500, default 50. */
  readonly limit?: string;
}

export interface NotificationsResponse {
  readonly notifications: readonly NotificationRow[];
}

export interface NotificationDetailResponse {
  readonly notification: NotificationRow;
  readonly trigger?: { readonly id: number; readonly action: string; readonly next_fire_at: IsoTime | null } | null;
  readonly session?: { readonly id: number; readonly status: SessionStatus | null } | null;
}

// ---- Approvals ---------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "denied";
export type ApprovalDecision = "once" | "always" | "deny";

export interface ApprovalPlaybook {
  readonly id: number;
  readonly slug: string | null;
  readonly version: number | null;
}

/** An approval as the API shows it. `payload`, `display` and `apply_detail` are untrusted. */
export interface Approval {
  readonly id: number;
  readonly requesting_agent: string;
  readonly requesting_session: number | null;
  readonly action: string;
  readonly payload: unknown;
  readonly requested_at: IsoTime;
  readonly status: ApprovalStatus;
  readonly decision: ApprovalDecision | null;
  readonly decided_by: string | null;
  readonly decided_at: IsoTime | null;
  readonly playbook: ApprovalPlaybook | null;
  readonly display?: string;
  readonly applied?: string;
  readonly apply_refused?: string;
  readonly apply_detail?: string;
}

export interface ApprovalsQuery {
  readonly all?: "1";
}

export interface ApprovalsResponse {
  readonly approvals: readonly Approval[];
}

/** `POST /approvals/:id/approve`. `always` only for a rail approval from a playbook session. */
export interface ApproveBody {
  readonly decision: "once" | "always";
}

/** Approve and deny both answer the approval after the decision. */
export interface ApprovalDecisionResponse {
  readonly approval: Approval;
}

export interface Grant {
  readonly id: number;
  readonly playbook: ApprovalPlaybook;
  readonly action: string;
  readonly payload: unknown;
  readonly requesting_agent: string;
  readonly granted_at: IsoTime | null;
  readonly current: boolean;
}

export interface GrantsResponse {
  readonly grants: readonly Grant[];
}

export interface RevokeGrantResponse {
  readonly grant: Grant;
}

// ---- Triggers ------------------------------------------------------------------------

export interface Trigger {
  readonly id: number;
  readonly owning_agent: string;
  readonly playbook: string | null;
  readonly kind: string;
  readonly spec: unknown;
  readonly action: string;
  readonly text: string;
  readonly enabled: boolean;
  readonly enabled_changed_by: string | null;
  readonly enabled_changed_at: IsoTime | null;
  readonly next_fire_at: IsoTime | null;
  readonly last_fired_at: IsoTime | null;
  readonly last_result: string | null;
  readonly created_by: string;
  readonly created_at: IsoTime;
}

export interface TriggersQuery {
  readonly all?: "1";
}

export interface TriggersResponse {
  readonly triggers: readonly Trigger[];
}

/** `POST /triggers/:id/on`: a past `once` trigger needs `confirm` (else `409 needs_confirmation`). */
export interface TriggerOnBody {
  readonly confirm?: true;
}

export interface TriggerToggleResponse {
  readonly trigger: Trigger;
  readonly changed: boolean;
}

// ---- Playbooks -----------------------------------------------------------------------

/** A `playbooks` row. `name` and `intent` are untrusted. */
export interface Playbook {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly owning_agent: string;
  readonly intent: string;
  readonly status: string;
  readonly version: number;
  readonly dedupe_key_spec: string | null;
  readonly dedupe_key_set_by: string | null;
  readonly priority: string;
  readonly priority_set_by: string | null;
  readonly model: string | null;
  readonly model_set_by: string | null;
  readonly effort: string | null;
  readonly effort_set_by: string | null;
  readonly token_limit_per_day: number | null;
  readonly token_limit_set_by: string | null;
  readonly api_key_fallback_json: string | null;
  readonly api_key_fallback_set_by: string | null;
  readonly created_at: IsoTime;
  readonly updated_at: IsoTime;
  /** The kernel's `PLAYBOOK_MODES` value (`draft` / `live`; migration 17, default `draft`). Phase 6 accepts only `draft`. */
  readonly mode: string;
  readonly mode_set_by: string | null;
}

export interface PlaybookListing extends Playbook {
  readonly trigger_id: number | null;
  readonly next_fire_at: IsoTime | null;
}

export interface PlaybooksQuery {
  readonly all?: "1";
}

export interface PlaybooksResponse {
  readonly playbooks: readonly PlaybookListing[];
}

/** `GET /playbooks/:ref` (an id or a slug). */
export interface PlaybookDetailResponse {
  readonly playbook: Playbook;
  readonly versions: readonly { readonly version: number; readonly created_at: IsoTime }[];
  readonly trigger: Trigger | null;
}

/** `POST /playbooks/:id/set`: both strings, the value as typed on the CLI (`none` clears). */
export interface PlaybookSetBody {
  readonly field: string;
  readonly value: string;
}

export interface PlaybookChangeResponse {
  readonly playbook: Playbook;
  readonly changed: boolean;
  readonly mirror_error?: string;
}

/** `POST /playbooks/:id/run`: the body is empty or `{}`. */
export interface PlaybookRunResponse {
  readonly queue_id: number;
  readonly created: boolean;
  readonly playbook: number;
  readonly version: number;
  readonly scheduled_at: IsoTime;
}

// ---- Agents ----------------------------------------------------------------------------

export interface RosterEntry {
  readonly id: string;
  readonly display_name: string;
  readonly avatar: { readonly shape: string; readonly hue: string };
  readonly status: string;
  readonly created_by: string | null;
  readonly approval_id: number | null;
  readonly model: string | null;
  readonly settings_error: string | null;
  readonly tokens_today: number;
  readonly tokens_per_day: number | null;
  readonly sessions_running: number;
  readonly sessions_at_once: number | null;
}

export interface AgentsResponse {
  readonly agents: readonly RosterEntry[];
}

/** An `agents` row. `display_name` and `charter_json` are untrusted. */
export interface AgentRow {
  readonly id: string;
  readonly display_name: string;
  readonly avatar_shape: string;
  readonly avatar_hue: string;
  readonly status: string;
  readonly created_by: string;
  readonly approval_id: number | null;
  readonly charter_json: string;
  readonly created_at: IsoTime;
  readonly updated_at: IsoTime;
}

export interface AgentDetailResponse {
  readonly agent: RosterEntry;
  readonly settings: {
    readonly file: string;
    readonly content: unknown;
    readonly error: { readonly error: string; readonly field?: string; readonly message: string } | null;
  };
  readonly never: readonly string[] | null;
  readonly workspaces: readonly string[] | null;
  readonly memory: { readonly dir: string; readonly files: readonly { readonly name: string; readonly path: string; readonly present: boolean }[] };
  readonly charter: unknown;
}

/** `POST /agents`: a charter, as the owner saw it (the kernel validates it whole). */
export type AgentCreateBody = Readonly<Record<string, unknown>>;

/** `201`. */
export interface AgentCreateResponse {
  readonly agent: AgentRow;
  readonly files: unknown;
  readonly files_error: unknown;
}

export interface AgentRenameBody {
  readonly display_name: string;
}

/** Rename, off and on answer the row after the change. */
export interface AgentChangeResponse {
  readonly agent: AgentRow;
  readonly changed: boolean;
}

/** The fields `POST /agents/:id/set` takes for a crew member. */
export type AgentSetField = "model" | "effort" | "permission_mode" | "limits.tokens_per_day" | "limits.sessions_at_once" | "limits.delegation_depth";

/**
 * Item 07: the fields `POST /agents/wright/set` takes. `permission_mode` (and
 * `tool_policy`, and every other field) stays refused `reserved` for Wright.
 */
export type WrightSetField = "model" | "effort" | "limits.tokens_per_day" | "limits.sessions_at_once" | "limits.delegation_depth";

/**
 * Phase 6 item 08: the owner's GitHub grant, `POST /agents/:id/set` with field
 * `connectors` and the value as typed on the CLI (`github`, or `none` to
 * clear). Kept apart from `AgentSetField`, which the Team screen handles
 * field by field: the kernel refuses this field until item 08 makes it
 * settable, and item 08 settles its answer.
 */
export interface AgentConnectorsSetBody {
  readonly field: "connectors";
  readonly value: string;
}

/** `POST /agents/:id/set`: both strings, the value as typed on the CLI (`none` clears effort or a limit). `id` `wright` takes only `WrightSetField` (item 07). */
export type AgentSetBody =
  | { readonly field: AgentSetField; readonly value: string }
  | { readonly field: WrightSetField; readonly value: string }
  | AgentConnectorsSetBody;

export interface AgentSetResponse {
  readonly agent: AgentRow | RosterEntry;
  readonly field: AgentSetField;
  readonly old: string | number | null;
  readonly new: string | number | null;
  readonly changed: boolean;
}

// ---- Item 02: GET /events and the feed (GET /events/stream) ----------------------

/** One `events` row, as the feed and `GET /events` send it. `payload` is the stored JSON, untrusted, never interpreted. */
export interface EventFrame {
  readonly type: "event";
  readonly id: number;
  readonly at: IsoTime;
  readonly kind: string;
  readonly session_id: number | null;
  readonly task_id: number | null;
  readonly payload: unknown;
}

/** A frame over 1 MiB: fetch the row through `GET /events?after=<id - 1>&limit=1`. */
export interface TruncatedEventFrame {
  readonly type: "event";
  readonly id: number;
  readonly kind: string;
  readonly truncated: true;
}

/** Every 15 s. */
export interface HeartbeatFrame {
  readonly type: "heartbeat";
  readonly latest_id: number;
}

/** The client's first (and only) frame: every event with id > `after` (0 for all), oldest first, then each new one. */
export interface SubscribeFrame {
  readonly type: "subscribe";
  readonly after: number;
}

/** What the kernel sends on the feed. */
export type FeedServerFrame = EventFrame | TruncatedEventFrame | HeartbeatFrame;

/** What the app sends on the feed. */
export type FeedClientFrame = SubscribeFrame;

/**
 * The feed's close codes (item 02): 1013 a fifth client (and the phase 5
 * foundation's stub, "not yet"); 1011 a client too slow to keep up (resume
 * from the last id); 1003 a malformed client frame.
 */
export const FEED_CLOSE_CODES = Object.freeze({ tryAgainLater: 1013, tooSlow: 1011, malformedFrame: 1003 } as const);

export interface EventsQuery {
  readonly after?: string;
  /** At most 500. */
  readonly limit?: string;
}

/** `GET /events`: the same frames as the feed, as JSON (at most 500). */
export interface EventsResponse {
  readonly events: readonly (EventFrame | TruncatedEventFrame)[];
}

// ---- Item 03: GET /sessions and GET /sessions/:id/output -----------------------------

/** The session output kinds. Mirrors `SESSION_OUTPUT_KINDS` in `kernel/src/console/output.ts` (pinned by `kernel/test/console-contract.test.ts`). */
export type SessionOutputKind = "assistant_text" | "tool_call" | "tool_decision" | "tool_result" | "result" | "system";

export interface SessionsQuery {
  readonly status?: string;
  readonly limit?: string;
}

export interface SessionSummary {
  readonly id: number;
  readonly agent: string | null;
  readonly status: SessionStatus;
  readonly model: string | null;
  readonly started: IsoTime | null;
  readonly ended: IsoTime | null;
  readonly tokens: number | null;
  readonly cwd: string | null;
  readonly playbook: number | null;
}

export interface SessionsResponse {
  readonly sessions: readonly SessionSummary[];
}

/** One `session_output` row. Every string in `payload` is untrusted data: escape it wherever it is printed. */
export interface SessionOutputRow {
  readonly id: number;
  readonly session_id: number;
  readonly seq: number;
  readonly kind: SessionOutputKind;
  readonly payload: unknown;
  readonly created_at: IsoTime;
}

export interface SessionOutputQuery {
  readonly after?: string;
  readonly limit?: string;
}

export interface SessionOutputResponse {
  readonly rows: readonly SessionOutputRow[];
}

// ---- Item 04: POST /sessions/:id/stop and POST /sessions/:id/kill ----------------------

/** Both answer `200 {id, status, reason}`; refusals `400 invalid_id`, `404 not_found`, `409 not_running` (with the current `status`). */
export interface SessionControlResponse {
  readonly id: number;
  readonly status: SessionStatus;
  /**
   * The reason of the session's last `session_status` event, whatever it is: `owner_stop`, `owner_kill`,
   * `kill_incomplete` (a kill that could not confirm the group gone), or the session's own outcome when its stream
   * had already ended (for example `result_success`). `null` when that event carries no readable reason.
   */
  readonly reason: string | null;
}

// ---- Item 05: POST /pause and POST /unpause --------------------------------------------

export interface PauseResponse {
  readonly paused: boolean;
}

// ---- Item 06: GET /threads/:agent ---------------------------------------------------------

export interface ThreadsQuery {
  /** The opaque cursor from `next_before`. */
  readonly before?: string;
  /** Default 50, at most 200. */
  readonly limit?: string;
}

export type ThreadItem =
  | ({ readonly type: "message" } & BrainMessage)
  | {
      readonly type: "event";
      readonly id: number;
      readonly at: IsoTime;
      readonly kind: string;
      /** A one-line kernel-written sentence; stored names inside it are escaped. */
      readonly summary: string;
      readonly ref: unknown;
    };

export interface ThreadResponse {
  readonly items: readonly ThreadItem[];
  /** `null` once the oldest item is in this page. */
  readonly next_before: string | null;
  readonly pending_approvals: readonly Approval[];
}

// ---- Phase 6 item 03: GET /connectors, POST /connectors/github/token, POST /connectors/github/disconnect, GET /connectors/github/repos ----

/** The connector kinds: `CONNECTOR_KINDS` in `kernel/src/integrations/types.ts` (phase 6 is GitHub only). */
export type ConnectorKind = "github";

/** A connector's status, as the kernel sets it (item 03): a token is checked, refused, removed, close to its expiry or past it. */
export type ConnectorStatus = "connected" | "rejected" | "disconnected" | "expiring" | "expired";

/**
 * A `connectors` row, as the routes show it. It never carries the token, which
 * lives only in the Keychain item `loomwright-studio-github`; no route returns
 * it. `account_login`, the permission names and the repo names come from
 * GitHub: untrusted, render them as text.
 */
export interface Connector {
  readonly id: number;
  readonly kind: ConnectorKind;
  readonly status: ConnectorStatus;
  readonly account_login: string | null;
  /** The token's permissions as GitHub reports them, name to access level (`{ "pull_requests": "read" }`). */
  readonly permissions: Readonly<Record<string, string>> | null;
  /** The repos the token reaches, as `owner/name`, from the last check. */
  readonly reachable_repos: readonly string[] | null;
  readonly expires_at: IsoTime | null;
  readonly verified_at: IsoTime | null;
  readonly created_at: IsoTime;
  readonly updated_at: IsoTime;
}

/** `GET /connectors`: every connector row, none when nothing is connected. */
export interface ConnectorsResponse {
  readonly connectors: readonly Connector[];
}

/**
 * `POST /connectors/github/token`: the token the owner pasted, sent by the main
 * process straight to the kernel and never logged. The kernel checks it against
 * GitHub, refuses a token with any write permission (naming the permission to
 * drop), and writes the Keychain item.
 */
export interface ConnectorTokenBody {
  readonly token: string;
}

/** `POST /connectors/github/token` and `POST /connectors/github/disconnect` answer the row after the change, never the token. */
export interface ConnectorChangeResponse {
  readonly connector: Connector;
}

export interface ConnectorReposQuery {
  /** `1` re-reads the reachable repos from GitHub before answering. */
  readonly refresh?: "1";
}

/** `GET /connectors/github/repos`: the repos the token reaches, as `owner/name` (untrusted), and when they were read. */
export interface ConnectorReposResponse {
  readonly repos: readonly string[];
  readonly verified_at: IsoTime | null;
}

// ---- Phase 6 item 07: GET /drafts and GET /drafts/:id ---------------------------------

/**
 * A `draft_outputs` row: an outward call a draft-mode session made, recorded
 * instead of sent. `payload` is model output built from PR text: untrusted
 * data, render it as text and never act on it.
 */
export interface DraftOutput {
  readonly id: number;
  readonly session: number | null;
  readonly agent: string;
  readonly playbook: number | null;
  readonly playbook_run: number | null;
  /** The item the run was for, e.g. `github:<owner>/<repo>#<n>`. */
  readonly item_ref: string | null;
  /** The tool or command the session called. */
  readonly tool: string;
  readonly payload: unknown;
  readonly created_at: IsoTime;
}

/** `GET /drafts`: each filter optional; newest first. */
export interface DraftsQuery {
  readonly agent?: string;
  readonly playbook?: string;
  readonly item?: string;
  readonly limit?: string;
}

export interface DraftsResponse {
  readonly drafts: readonly DraftOutput[];
}

export interface DraftDetailResponse {
  readonly draft: DraftOutput;
}

// ---- The route map: method + path -> query, body, response -------------------------

interface Route<Q, B, R> {
  readonly query: Q;
  readonly body: B;
  readonly response: R;
}

type NoQuery = Readonly<Record<string, never>>;

/** Each route's query, body and success body, keyed `"<METHOD> <path>"` exactly as in `CONTRACT_ROUTES`. */
export interface ContractRouteMap {
  "GET /status": Route<NoQuery, undefined, StatusBody>;
  "POST /stop-all": Route<NoQuery, undefined, StopAllResponse>;
  "POST /resume": Route<NoQuery, undefined, ResumeResponse>;
  "POST /sessions/:id/abandon": Route<NoQuery, undefined, AbandonResponse>;
  "POST /ask": Route<NoQuery, AskBody, AskResponse>;
  "GET /messages": Route<MessagesQuery, undefined, MessagesResponse>;
  "GET /messages/:id": Route<NoQuery, undefined, BrainMessage>;
  "GET /notifications": Route<NotificationsQuery, undefined, NotificationsResponse>;
  "GET /notifications/:id": Route<NoQuery, undefined, NotificationDetailResponse>;
  "GET /approvals": Route<ApprovalsQuery, undefined, ApprovalsResponse>;
  "POST /approvals/:id/approve": Route<NoQuery, ApproveBody, ApprovalDecisionResponse>;
  "POST /approvals/:id/deny": Route<NoQuery, undefined, ApprovalDecisionResponse>;
  "GET /approvals/grants": Route<NoQuery, undefined, GrantsResponse>;
  "POST /approvals/grants/:id/revoke": Route<NoQuery, undefined, RevokeGrantResponse>;
  "GET /triggers": Route<TriggersQuery, undefined, TriggersResponse>;
  "POST /triggers/:id/on": Route<NoQuery, TriggerOnBody | undefined, TriggerToggleResponse>;
  "POST /triggers/:id/off": Route<NoQuery, undefined, TriggerToggleResponse>;
  "GET /playbooks": Route<PlaybooksQuery, undefined, PlaybooksResponse>;
  "GET /playbooks/:ref": Route<NoQuery, undefined, PlaybookDetailResponse>;
  "POST /playbooks/:id/set": Route<NoQuery, PlaybookSetBody, PlaybookChangeResponse>;
  "POST /playbooks/:id/off": Route<NoQuery, undefined, PlaybookChangeResponse>;
  "POST /playbooks/:id/run": Route<NoQuery, undefined, PlaybookRunResponse>;
  "GET /agents": Route<NoQuery, undefined, AgentsResponse>;
  "GET /agents/:id": Route<NoQuery, undefined, AgentDetailResponse>;
  "POST /agents": Route<NoQuery, AgentCreateBody, AgentCreateResponse>;
  "POST /agents/:id/rename": Route<NoQuery, AgentRenameBody, AgentChangeResponse>;
  "POST /agents/:id/set": Route<NoQuery, AgentSetBody, AgentSetResponse>;
  "POST /agents/:id/off": Route<NoQuery, undefined, AgentChangeResponse>;
  "POST /agents/:id/on": Route<NoQuery, undefined, AgentChangeResponse>;
  "GET /events": Route<EventsQuery, undefined, EventsResponse>;
  /** The WebSocket upgrade: never called through `request`; frames are `FeedClientFrame` / `FeedServerFrame`. */
  "GET /events/stream": Route<NoQuery, undefined, never>;
  "GET /sessions": Route<SessionsQuery, undefined, SessionsResponse>;
  "GET /sessions/:id/output": Route<SessionOutputQuery, undefined, SessionOutputResponse>;
  "POST /sessions/:id/stop": Route<NoQuery, undefined, SessionControlResponse>;
  "POST /sessions/:id/kill": Route<NoQuery, undefined, SessionControlResponse>;
  "POST /pause": Route<NoQuery, undefined, PauseResponse>;
  "POST /unpause": Route<NoQuery, undefined, PauseResponse>;
  "GET /threads/:agent": Route<ThreadsQuery, undefined, ThreadResponse>;
  "GET /connectors": Route<NoQuery, undefined, ConnectorsResponse>;
  "POST /connectors/github/token": Route<NoQuery, ConnectorTokenBody, ConnectorChangeResponse>;
  "POST /connectors/github/disconnect": Route<NoQuery, undefined, ConnectorChangeResponse>;
  "GET /connectors/github/repos": Route<ConnectorReposQuery, undefined, ConnectorReposResponse>;
  "GET /drafts": Route<DraftsQuery, undefined, DraftsResponse>;
  "GET /drafts/:id": Route<NoQuery, undefined, DraftDetailResponse>;
}

export type RouteKey = keyof ContractRouteMap;

// ---- The bridge: what the preload exposes as `window.api` -------------------------------

/** What the main process found when it looked for the kernel. Never carries the token. */
export type KernelConnectionState =
  | { readonly state: "connected"; readonly port: number }
  /** No `api.json`: the kernel was never started here (the "kernel not installed" state, with the setup commands). */
  | { readonly state: "not_installed"; readonly dataDir: string }
  /** `api.json` exists but its pid is gone, the Keychain token is unreadable, or the API did not answer. */
  | { readonly state: "unreachable"; readonly reason: KernelUnreachableReason };

export type KernelUnreachableReason = "api_info_unreadable" | "daemon_not_running" | "token_unavailable" | "token_rejected" | "connection_failed" | "timeout";

/** One API call's outcome, as the main process hands it to the renderer. */
export type ApiResult<R> =
  | { readonly ok: true; readonly status: number; readonly body: R }
  | { readonly ok: false; readonly status: number; readonly body: ApiError }
  | { readonly ok: false; readonly status: 0; readonly connection: Exclude<KernelConnectionState, { readonly state: "connected" }> };

/** A request: `params` fill the path's `:segments`. */
export interface ApiRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** What the main process forwards from the feed: each server frame, and the socket's close. */
export type FeedRelayFrame = FeedServerFrame | { readonly type: "closed"; readonly code: number; readonly reason: string };

/** `window.api`: the ONE key the preload exposes. Every call crosses to the main process; the token never crosses back. */
export interface StudioBridge {
  /** Where the kernel is (re-checked on every call). */
  connection(): Promise<KernelConnectionState>;
  /** One API call, made by the main process with the bearer token. */
  request<R = unknown>(request: ApiRequest): Promise<ApiResult<R>>;
  readonly feed: {
    /** Open (or reopen) the feed from `after`; frames arrive through `onFrame`. */
    subscribe(after: number): Promise<KernelConnectionState>;
    unsubscribe(): Promise<void>;
    /** Returns the unsubscribe for this listener. */
    onFrame(listener: (frame: FeedRelayFrame) => void): () => void;
  };
  /** A `loomwright-studio://` link the app was opened with (item 17), as an app route. */
  onNavigate(listener: (route: string) => void): () => void;
}
