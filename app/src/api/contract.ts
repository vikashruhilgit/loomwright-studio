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
//
// Phase 7's twelve routes (`p7-item-NN`) are declared here before the kernel
// serves them, as phase 6's were: the six GUI screens (items 03-08) each read
// their own routes against the shapes below, and `kernel/test/console-contract.test.ts`
// lists them as not yet served until their item lands. They add the app's one
// `PUT` (the memory write), which the kernel already accepts.

/** An HTTP method the API serves. */
export type HttpMethod = "GET" | "POST" | "PUT";

/**
 * Where a route comes from: the phase that built it (existing at the phase 5
 * base), the phase 5 item that adds it (`item-NN`), the phase 6 item that
 * adds it (`p6-item-NN`), the phase 7 item that adds it (`p7-item-NN`), or the
 * GitHub App connect (`github-app`, D36).
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
  | "p6-item-07"
  | "p7-item-03"
  | "p7-item-04"
  | "p7-item-05"
  | "p7-item-06"
  | "p7-item-07"
  | "p7-item-08"
  | "github-app";

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
 *
 * The GitHub App connect's two owner routes (D36) are `github-app`: the kernel
 * serves them: setup answers `setup_url` and `expires_at`, cancel answers
 * `cancelled`. The three token-free browser routes are served by
 * `github/app-setup.ts` and are not contract entries.
 *
 * Phase 7's twelve routes are `p7-item-NN`, each served by the item that owns
 * its screen: the Tasks board (item 03: `/tasks`, `/tasks/:kind/:id`), a
 * playbook's runs and versions (item 04), the schedule and a trigger's fires
 * (item 05), the Memory tree, file and guarded write (item 06, the one `PUT`),
 * budget usage and the audit log (item 07), and Settings (item 08). The phase 7
 * foundation lists them before the kernel serves them; until its item lands
 * each one answers 404. Every one is an owner route that needs the API token.
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
  { method: "POST", path: "/connectors/github/app/setup", origin: "github-app" },
  { method: "POST", path: "/connectors/github/app/setup/cancel", origin: "github-app" },
  { method: "GET", path: "/tasks", origin: "p7-item-03" },
  { method: "GET", path: "/tasks/:kind/:id", origin: "p7-item-03" },
  { method: "GET", path: "/playbooks/:id/runs", origin: "p7-item-04" },
  { method: "GET", path: "/playbooks/:id/versions", origin: "p7-item-04" },
  { method: "GET", path: "/schedule", origin: "p7-item-05" },
  { method: "GET", path: "/triggers/:id/fires", origin: "p7-item-05" },
  { method: "GET", path: "/memory", origin: "p7-item-06" },
  { method: "GET", path: "/memory/file", origin: "p7-item-06" },
  { method: "PUT", path: "/memory/file", origin: "p7-item-06" },
  { method: "GET", path: "/budget/usage", origin: "p7-item-07" },
  { method: "GET", path: "/audit", origin: "p7-item-07" },
  { method: "GET", path: "/settings", origin: "p7-item-08" },
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
  /**
   * Phase 6 item 08: the connectors the owner granted this agent (`["github"]`),
   * `[]` for none, `null` when its settings file does not read ok (for Wright,
   * also when `wright.json` is absent). Optional, so a roster that predates the
   * grant still types; a missing value reads as unknown, never as no grant.
   */
  readonly connectors?: readonly ConnectorKind[] | null;
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
 * field by field. Any other value is refused `400 invalid_input` with
 * `field: "connectors"`. Only the owner's route and verb set it: a session
 * cannot. Granting while GitHub is not connected is allowed and recorded.
 */
export interface AgentConnectorsSetBody {
  readonly field: "connectors";
  readonly value: string;
}

/** `POST /agents/:id/set`: both strings, the value as typed on the CLI (`none` clears effort or a limit). `id` `wright` takes only `WrightSetField` (item 07) and the connectors grant (item 08). */
export type AgentSetBody =
  | { readonly field: AgentSetField; readonly value: string }
  | { readonly field: WrightSetField; readonly value: string }
  | AgentConnectorsSetBody;

export interface AgentSetResponse {
  readonly agent: AgentRow | RosterEntry;
  readonly field: AgentSetField | "connectors";
  /** A scalar field's value, or for `connectors` the granted kinds (`["github"]`); `null` is unset (no grant). */
  readonly old: string | number | readonly string[] | null;
  readonly new: string | number | readonly string[] | null;
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
 * Who vouched for a connector's permissions: `reported` (GitHub listed them) or
 * `declared` (GitHub reports none for a fine-grained token, and the owner said
 * every permission is Read). Mirrors `CONNECTOR_PERMISSIONS_SOURCES` in
 * `kernel/src/integrations/types.ts`. A declared token is the owner's word, never GitHub-verified.
 */
export type ConnectorPermissionsSource = "reported" | "declared";

/**
 * How a connector is connected: a pasted `token`, or a GitHub `app` (D36). Mirrors
 * `CONNECTOR_METHODS` in `kernel/src/integrations/types.ts`. For `app`,
 * `permissions_source` is always `reported` and `expires_at` is the current
 * installation token's expiry, which renews.
 */
export type ConnectorMethod = "token" | "app";

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
  /** Who vouched for the permissions; `null` on a row from before the field existed (never backfilled). */
  readonly permissions_source: ConnectorPermissionsSource | null;
  /** When the owner declared the token read-only; set only when `permissions_source` is `declared`. */
  readonly permissions_declared_at: IsoTime | null;
  /** How the connector is connected; absent on a row from before the App connect, which reads `token`. */
  readonly method?: ConnectorMethod;
  /** The GitHub App's slug, for `method: "app"`; `null` or absent otherwise. */
  readonly app_slug?: string | null;
  /** The App installation's id, for `method: "app"`; `null` or absent otherwise. */
  readonly installation_id?: number | null;
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
  /**
   * The owner's declaration that this is a fine-grained token and every permission
   * they gave it is Read. Only `true` declares; the kernel answers 400 `invalid_body` for a non-boolean.
   * A token whose permissions GitHub does not report is refused `token_permissions_unknown` without it.
   */
  readonly declared_read_only?: boolean;
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

// ---- GitHub App: POST /connectors/github/app/setup, POST /connectors/github/app/setup/cancel ----

/**
 * Why a GitHub App setup refuses or fails. Mirrors `GITHUB_APP_SETUP_REFUSALS` in
 * `kernel/src/integrations/types.ts`. `token_write_scoped` here is the App's: an
 * installation token carried a write permission.
 */
export type GitHubAppSetupRefusal = "setup_not_open" | "state_mismatch" | "setup_expired" | "conversion_failed" | "install_failed" | "token_write_scoped";

/**
 * `POST /connectors/github/app/setup`: opens the one setup window and answers the
 * loopback URL the owner opens in the browser, with when the window expires.
 */
export interface GitHubAppSetupResponse {
  readonly setup_url: string;
  /** When the window closes (single-use, short-lived). */
  readonly expires_at: IsoTime;
}

/** `POST /connectors/github/app/setup/cancel`: closes the open setup window. */
export interface GitHubAppSetupCancelResponse {
  readonly cancelled: boolean;
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

// ---- Phase 7 item 03: GET /tasks and GET /tasks/:kind/:id ------------------------------

/** What a Tasks board card is: a `tasks` row, a `playbook_runs` row or a `sessions` row. */
export type TaskBoardKind = "task" | "playbook_run" | "session";

/**
 * One card on the Tasks board. `state` is the source's own value, verbatim and
 * open (`tasks.state`, `playbook_runs.status`, `sessions.status`): the three
 * sources have different vocabularies and the kernel invents no state. `title`
 * is the task's `title`, a playbook run's playbook name, or `null` for a session;
 * it and `item_ref` are untrusted (they can carry PR or ticket text).
 */
export interface TaskBoardItem {
  readonly kind: TaskBoardKind;
  readonly id: number;
  readonly title: string | null;
  readonly state: string;
  /** `tasks.assignee_agent`, `sessions.agent`, or a run's playbook owner; `null` when unset. */
  readonly agent: string | null;
  /** The playbook (`playbooks.id`) of a run or a playbook's session; `null` otherwise. */
  readonly playbook: number | null;
  /** A run's `item_ref` (e.g. `github:<owner>/<repo>#<n>`); `null` for everything else. */
  readonly item_ref: string | null;
  /** The session: a task's `owner_session_id`, a run's `session_id`; `null` for a session card and when none. */
  readonly session: number | null;
  /** Counted tokens (D26) when the kernel recorded them (a run's `tokens`, a session's total); `null` otherwise. */
  readonly tokens: number | null;
  readonly started: IsoTime | null;
  readonly ended: IsoTime | null;
  /** When the row last changed; the board orders newest first by it. */
  readonly updated: IsoTime;
}

/** One state's cards: the board groups by the source's `state`, in the page's order. */
export interface TaskBoardGroup {
  readonly state: string;
  readonly items: readonly TaskBoardItem[];
}

export interface TasksQuery {
  /** The opaque cursor from `next_before`. */
  readonly before?: string;
  /** Default 50, at most 200. */
  readonly limit?: string;
}

export interface TasksResponse {
  readonly groups: readonly TaskBoardGroup[];
  /** `null` once the oldest card is in this page. */
  readonly next_before: string | null;
}

/** `GET /tasks/:kind/:id`: the card, and everything that names it. Every string in an event `payload` is untrusted. */
export interface TaskHistoryResponse {
  readonly item: TaskBoardItem;
  /** The item's events (its task or session), oldest first. */
  readonly events: readonly EventFrame[];
  /** The playbook runs for it: a playbook run's own row, a task's or session's runs; empty for none. */
  readonly runs: readonly PlaybookRun[];
  readonly sessions: readonly SessionSummary[];
  /** The approvals that name it (its session or playbook), pending first. */
  readonly approvals: readonly Approval[];
}

// ---- Phase 7 item 04: GET /playbooks/:id/runs and GET /playbooks/:id/versions ----------

/** A `playbook_runs` row. `item_ref` and `item_revision` come from the source item (a PR): untrusted. */
export interface PlaybookRun {
  readonly id: number;
  /** The playbook's id. */
  readonly playbook: number;
  /** The playbook version the run used. */
  readonly version: number;
  /** The kernel's run kind (`dry_run`, `fire` or `run_now`), kept open. */
  readonly kind: string;
  /** The run's own status (`running` until it ends), kept open: render an unknown one as text. */
  readonly status: string;
  readonly item_ref: string | null;
  /** The source item's revision (e.g. a head SHA); `null` for a run that is not an item's. */
  readonly item_revision: string | null;
  /** Counted tokens (D26); `null` until the run ends. */
  readonly tokens: number | null;
  readonly session: number | null;
  readonly started: IsoTime;
  readonly ended: IsoTime | null;
}

export interface PlaybookRunsQuery {
  /** The opaque cursor from `next_before`. */
  readonly before?: string;
  /** Default 50, at most 200. */
  readonly limit?: string;
}

/** `GET /playbooks/:id/runs`: newest first. */
export interface PlaybookRunsResponse {
  readonly runs: readonly PlaybookRun[];
  readonly next_before: string | null;
}

/** A `playbook_versions` row. */
export interface PlaybookVersion {
  readonly playbook: number;
  readonly version: number;
  /**
   * The playbook row as it was at that version (`snapshot_json`). Partial: a
   * snapshot taken before a column existed lacks it (for example `mode`), and a
   * missing value reads as unknown, never as a default. `name` and `intent` are untrusted.
   */
  readonly snapshot: Readonly<Partial<Playbook>>;
  readonly created_at: IsoTime;
}

/** `GET /playbooks/:id/versions`: newest first. */
export interface PlaybookVersionsResponse {
  readonly versions: readonly PlaybookVersion[];
}

// ---- Phase 7 item 05: GET /schedule and GET /triggers/:id/fires -------------------------

/** What a schedule entry is: an enabled trigger's next fire, or a pending wake-up. */
export type ScheduleEntryKind = "trigger" | "wakeup";

/** One upcoming fire. `text` is untrusted: a trigger's `text`, or a wake-up's `reason`. */
export interface ScheduleEntry {
  readonly kind: ScheduleEntryKind;
  /** The trigger's id, or the wake-up's id. */
  readonly id: number;
  /** When it is next due: a trigger's `next_fire_at`, a wake-up's `due_at`. */
  readonly at: IsoTime;
  /** A trigger's `owning_agent`; `null` for a wake-up. */
  readonly agent: string | null;
  /** A trigger's playbook (its slug); `null` otherwise. */
  readonly playbook: string | null;
  /** A trigger's `action`; `null` for a wake-up. */
  readonly action: string | null;
  readonly text: string;
  /** A wake-up's task (`wakeups.task_id`); `null` otherwise. */
  readonly task_id: number | null;
}

export interface ScheduleQuery {
  /** Default 50, at most 200. */
  readonly limit?: string;
}

/** `GET /schedule`: the next fires of every enabled trigger and every pending wake-up, soonest first, bounded by `limit`. */
export interface ScheduleResponse {
  readonly entries: readonly ScheduleEntry[];
}

/**
 * One `trigger_fired` or `trigger_missed` event for a trigger. A missed fire
 * carries its `reason` (a kernel code such as `already_done`, `missed_paused` or
 * `playbook_not_enabled`); a fired one has none.
 */
export interface TriggerFire {
  /** The event's id. */
  readonly id: number;
  readonly kind: "trigger_fired" | "trigger_missed";
  /** When the kernel recorded it. */
  readonly at: IsoTime;
  /** The instant it was due, when the event records one. */
  readonly scheduled_at: IsoTime | null;
  readonly reason: string | null;
  readonly session_id: number | null;
}

export interface TriggerFiresQuery {
  /** The opaque cursor from `next_before`. */
  readonly before?: string;
  /** Default 50, at most 200. */
  readonly limit?: string;
}

/** `GET /triggers/:id/fires`: newest first. */
export interface TriggerFiresResponse {
  readonly fires: readonly TriggerFire[];
  readonly next_before: string | null;
}

// ---- Phase 7 item 06: GET /memory, GET /memory/file, PUT /memory/file --------------------

/** One markdown file under `<dataDir>/memory/`. `path` is relative to `memory/` (`wright/role.md`), shown to the owner (invariant 8). */
export interface MemoryFileEntry {
  readonly path: string;
  /** Bytes. */
  readonly size: number;
  readonly modified: IsoTime;
}

/** One agent's files (Wright's or a crew member's: `memory/<agent>/`). */
export interface MemoryAgentFiles {
  readonly agent: string;
  readonly files: readonly MemoryFileEntry[];
}

/** `GET /memory`: each agent's files, then the shared files (`memory/shared/`). */
export interface MemoryTreeResponse {
  readonly agents: readonly MemoryAgentFiles[];
  readonly shared: readonly MemoryFileEntry[];
}

export interface MemoryFileQuery {
  /** Relative to `memory/`. */
  readonly path: string;
}

/** `GET /memory/file`. `content` is a file an agent may have written: untrusted, render it as text. */
export interface MemoryFileResponse {
  readonly path: string;
  readonly content: string;
  /** A hash of `content`, opaque to the app: send it back as `base_hash` on a write. */
  readonly content_hash: string;
}

/** `PUT /memory/file`: the whole new text, and the hash of the text the owner read. */
export interface MemoryWriteBody {
  readonly path: string;
  readonly content: string;
  readonly base_hash: string;
}

/** `200`: the file is written atomically and one `memory_updated` event is recorded. */
export interface MemoryWriteResponse {
  readonly path: string;
  /** The hash of the text now on disk: the next write's `base_hash`. */
  readonly content_hash: string;
  readonly size: number;
  readonly modified: IsoTime;
}

/**
 * Why `PUT /memory/file` refuses (the `error` code; nothing is written). `changed_since_read`
 * is `409` and answers a `MemoryConflictError`; the others are `400` or `404`.
 */
export type MemoryWriteRefusal =
  | "invalid_body"
  | "invalid_path"
  | "path_outside_memory"
  | "path_protected"
  | "not_markdown"
  | "too_large"
  | "not_found"
  | "changed_since_read";

/** `409`: the file changed after the owner read it. Nothing was overwritten; both versions are on the screen. */
export interface MemoryConflictError extends ApiError {
  readonly error: "changed_since_read";
  /** The text on disk now: untrusted. */
  readonly current_content: string;
  readonly current_hash: string;
}

// ---- Phase 7 item 07: GET /budget/usage and GET /audit -----------------------------------

export interface BudgetUsageQuery {
  /** How many days back, today included. */
  readonly days?: string;
}

/**
 * One `budget` day for an agent and a playbook. Tokens are counted per D26
 * (input + output + cache writes); cache reads are shown and never counted.
 * `cost_estimate_usd` is "≈ at API rates" (D24): an estimate from the recorded
 * `cost_usd`, never a charge on the subscription build; `null` when none was recorded.
 */
export interface BudgetUsageRow {
  /** `YYYY-MM-DD`. */
  readonly day: string;
  readonly agent: string | null;
  /** A playbook's slug, or `null` outside a playbook. */
  readonly playbook: string | null;
  readonly counted_tokens: number;
  /** Shown, not counted. */
  readonly cache_read_tokens: number;
  readonly cost_estimate_usd: number | null;
}

/** One limit against today's use: an agent's or a playbook's tokens per day, and an agent's sessions at once. A limit the owner never set is `null`. */
export interface BudgetLimitUsage {
  readonly scope: "agent" | "playbook";
  /** The agent's id, or the playbook's slug. */
  readonly id: string;
  readonly tokens_today: number;
  readonly tokens_per_day: number | null;
  readonly sessions_running: number;
  /** `null` for a playbook (it has no sessions-at-once limit) and for an unset one. */
  readonly sessions_at_once: number | null;
}

/** The per-account cap state with its reset times, as `GET /status` shows it. */
export type BudgetCapState = StatusBody["cap_state"];

export interface BudgetUsageResponse {
  readonly rows: readonly BudgetUsageRow[];
  readonly limits: readonly BudgetLimitUsage[];
  readonly cap_state: BudgetCapState;
}

export interface AuditQuery {
  /** An event kind. */
  readonly kind?: string;
  readonly agent?: string;
  /** A playbook's slug. */
  readonly playbook?: string;
  /** Inclusive ISO-8601 bounds on the event's time. */
  readonly since?: string;
  readonly until?: string;
  /** The opaque cursor from `next_before`. */
  readonly before?: string;
  /** Default 50, at most 200. */
  readonly limit?: string;
}

/** `GET /audit`: events, newest first. Every string in a `payload` is untrusted. */
export interface AuditResponse {
  readonly events: readonly EventFrame[];
  readonly next_before: string | null;
}

// ---- Phase 7 item 08: GET /settings ------------------------------------------------------

/** The notifier the kernel delivers with (`none` when it has no way to). */
export type NotifierKind = "terminal-notifier" | "osascript" | "none";

/**
 * `GET /settings`: read-only. It never carries a secret: the provider's health
 * and when its token was made, never the token (invariant 6 keeps sign-in out of the app).
 */
export interface SettingsResponse {
  readonly provider: {
    readonly id: string;
    readonly account: string | null;
    readonly health: AuthHealth;
    /** When the credential was created (`auth_providers.token_created_at`), for expiry; `null` when unknown. */
    readonly token_created_at: IsoTime | null;
  };
  readonly data_dir: string;
  readonly notifier: NotifierKind;
  /** The Loomwright install the adapter resolved, or why it did not. */
  readonly loomwright: LoomwrightAdapterStatus;
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
  "POST /connectors/github/app/setup": Route<NoQuery, undefined, GitHubAppSetupResponse>;
  "POST /connectors/github/app/setup/cancel": Route<NoQuery, undefined, GitHubAppSetupCancelResponse>;
  "GET /tasks": Route<TasksQuery, undefined, TasksResponse>;
  "GET /tasks/:kind/:id": Route<NoQuery, undefined, TaskHistoryResponse>;
  "GET /playbooks/:id/runs": Route<PlaybookRunsQuery, undefined, PlaybookRunsResponse>;
  "GET /playbooks/:id/versions": Route<NoQuery, undefined, PlaybookVersionsResponse>;
  "GET /schedule": Route<ScheduleQuery, undefined, ScheduleResponse>;
  "GET /triggers/:id/fires": Route<TriggerFiresQuery, undefined, TriggerFiresResponse>;
  "GET /memory": Route<NoQuery, undefined, MemoryTreeResponse>;
  "GET /memory/file": Route<MemoryFileQuery, undefined, MemoryFileResponse>;
  "PUT /memory/file": Route<NoQuery, MemoryWriteBody, MemoryWriteResponse>;
  "GET /budget/usage": Route<BudgetUsageQuery, undefined, BudgetUsageResponse>;
  "GET /audit": Route<AuditQuery, undefined, AuditResponse>;
  "GET /settings": Route<NoQuery, undefined, SettingsResponse>;
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
  /**
   * Open one address in the system browser. The main process refuses (answers `false`) anything off its
   * allowlist: the kernel's GitHub App start page, and two GitHub settings pages. Optional so a bridge
   * without it (a test fake) compiles; a caller treats a missing method as `false`.
   */
  openExternal?(url: string): Promise<boolean>;
}
