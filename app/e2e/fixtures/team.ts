// Team's canned kernel data (phase 5 item 14) for `startFixtureKernel({ routes, events })`.
//
// The roster is Wright plus two crew members (or Wright alone, the empty
// state, or the collision variant: two crew members sharing a display name,
// with the off Ada between them in the kernel's order). Every body is typed by `app/src/api/contract.ts` and every route key
// is a `CONTRACT_ROUTES` key. The routes record what the app sent, so the
// spec asserts the exact call, not just that one happened.
//
// The feed is the only way a change reaches the cards, as with the real
// kernel: `POST /agents` answers `201` and holds the new crew member back from
// `GET /agents` until the spec calls `publishCreated()` and appends the
// `agent_created` event. So the spec can prove the card is absent after the
// `201` and appears only once the event arrives. Rename changes the roster and
// appends `agent_renamed` at once, as the kernel's rename does.
//
// Phase 6 item 08 (the owner grants an agent GitHub): the roster carries each
// agent's `connectors` (Mason holds GitHub, Wright and Ada hold none), `GET
// /connectors` answers the connector's state (`connector` in the options,
// changed by `setConnector`), and `POST /agents/:id/set` takes the shared
// interface's `{field: "connectors", value: "github" | "none"}`: it changes the
// roster, appends `agent_settings_set` (the feed is how the row changes) and
// answers `{agent, field, old, new, changed}` with `null` for no grant. Any
// other value is `400 invalid_input` with `field: "connectors"`. Wright's set
// is answered the same way.
//
// Every value here is fixture data: no real path, account or token.
import type {
  AgentChangeResponse,
  AgentCreateResponse,
  AgentDetailResponse,
  AgentRow,
  AgentSetResponse,
  Approval,
  AskResponse,
  BrainMessage,
  Connector,
  ConnectorKind,
  ConnectorsResponse,
  EventFrame,
  RosterEntry,
  SessionSummary,
  SessionsResponse,
} from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernel, FixtureKernelOptions, FixtureRequest } from "../fixture-kernel";

/** The fixture's data dir as the kernel would report it (never read: the app shows it as text). */
export const TEAM_DATA_DIR = "/srv/studio-fixture";

const AT = "2026-10-21T09:00:00.000Z";

export const WRIGHT: RosterEntry = {
  id: "wright",
  display_name: "Wright",
  avatar: { shape: "whale", hue: "accent" },
  status: "active",
  created_by: null,
  approval_id: null,
  model: "claude-opus-5-5",
  settings_error: null,
  tokens_today: 48_200,
  tokens_per_day: 500_000,
  sessions_running: 1,
  sessions_at_once: 3,
  connectors: [],
};

/** A comment-only reviewer: no daily token limit, no sessions limit (both "no limit"). */
export const MASON: RosterEntry = {
  id: "mason",
  display_name: "Mason",
  avatar: { shape: "shark", hue: "crew-teal" },
  status: "active",
  created_by: "owner",
  approval_id: null,
  model: "claude-sonnet-5",
  settings_error: null,
  tokens_today: 14_208,
  tokens_per_day: null,
  sessions_running: 0,
  sessions_at_once: null,
  connectors: ["github"],
};

/** Turned off, with numeric limits. */
export const ADA: RosterEntry = {
  id: "ada",
  display_name: "Ada",
  avatar: { shape: "octopus", hue: "crew-berry" },
  status: "off",
  created_by: "owner",
  approval_id: null,
  model: "claude-haiku-4-5",
  settings_error: null,
  tokens_today: 9_020,
  tokens_per_day: 250_000,
  sessions_running: 0,
  sessions_at_once: 2,
  connectors: [],
};

/** Mason's comment-only charter: what `GET /agents/mason` reports. */
export const MASON_CHARTER = {
  persona: "Reviews pull requests on the owner's personal repositories and leaves comments only. Plain and specific: one finding per comment, the file and line first, a suggested fix when there is one, never a push.",
  duties: ["Review each PR where the owner is the requested reviewer", "Summarise blocking findings first, then nits"],
  boundaries: ["Comment only; never approve or request changes", "Ask Wright before reviewing a PR over 2,000 lines"],
} as const;

export const MASON_TOOL_POLICY = {
  allowedTools: ["Read", "Grep", "Glob"],
  allowedBashPrefixes: ["gh pr view", "gh pr diff", "gh pr comment"],
} as const;

export const MASON_NEVER = ["git_push", "gh_pr_create", "gh_pr_review", "gh_pr_edit", "gh_pr_close"] as const;

const ADA_CHARTER = {
  persona: "Keeps the owner's notes and reading list tidy.",
  duties: ["File new notes under the right project each evening"],
  boundaries: ["Never delete a note"],
} as const;

/** Wright's running brain message, on its live session 12 (`WRIGHT_SESSION`): the populated state's working task line. */
export const WRIGHT_RUNNING: BrainMessage = {
  id: 7,
  queue_id: 31,
  agent: "wright",
  source: "trigger:3",
  text: "Triage the new comments on PR #398",
  status: "running",
  session_id: 12,
  reply_text: null,
  detail: null,
  created_at: AT,
  updated_at: AT,
  from_agent: null,
  depth: 0,
  reply_to: null,
  workspace: null,
};

/** Wright's live session 12: the session `WRIGHT_RUNNING` runs on, so the populated state's task line is working. */
export const WRIGHT_SESSION: SessionSummary = {
  id: 12,
  agent: "wright",
  status: "running",
  model: "claude-opus-5-5",
  started: AT,
  ended: null,
  tokens: 3_100,
  cwd: "/srv/repos/site",
  playbook: 3,
};

/** The collision variant's two reviewers: the same display name (one with other case and spaces), the same turtle and hue. */
export const REVIEWER_OLD: RosterEntry = {
  id: "phase4-exit-mvg8wle4cf8f26",
  display_name: "Comment-only Reviewer",
  avatar: { shape: "turtle", hue: "crew-olive" },
  status: "active",
  created_by: "owner",
  approval_id: null,
  model: "claude-sonnet-5",
  settings_error: null,
  tokens_today: 0,
  tokens_per_day: null,
  sessions_running: 0,
  sessions_at_once: null,
  connectors: [],
};
export const REVIEWER_NEW: RosterEntry = { ...REVIEWER_OLD, id: "phase5-exit-1024", display_name: "comment-only reviewer ", tokens_today: 2_400 };

const REVIEWER_CHARTER = {
  persona: "Reviews pull requests and leaves comments only.",
  duties: ["Review each PR where the owner is the requested reviewer"],
  boundaries: ["Comment only"],
} as const;

/** Mason's pending approval: the "waiting on you" state's task line. */
export const MASON_APPROVAL: Approval = {
  id: 41,
  requesting_agent: "mason",
  requesting_session: 13,
  action: "github.pr.review.post",
  payload: { pr: 412 },
  requested_at: AT,
  status: "pending",
  decision: null,
  decided_by: null,
  decided_at: null,
  playbook: { id: 2, slug: "review-requested-prs", version: 1 },
  display: "Post a review on PR #412",
};

interface CrewMember {
  entry: RosterEntry;
  readonly charter: unknown;
  readonly settings: unknown;
}

function settingsOf(entry: RosterEntry, permissionMode: string, toolPolicy: unknown, never: readonly string[], workspaces: readonly string[]): unknown {
  const limits: Record<string, number> = {};
  if (entry.tokens_per_day !== null) limits.tokens_per_day = entry.tokens_per_day;
  if (entry.sessions_at_once !== null) limits.sessions_at_once = entry.sessions_at_once;
  return { model: entry.model, permission_mode: permissionMode, tool_policy: toolPolicy, never: [...never], limits, workspaces: [...workspaces] };
}

function detailOf(member: CrewMember): AgentDetailResponse {
  const id = member.entry.id;
  const memoryDir = `${TEAM_DATA_DIR}/memory/${id}`;
  const settings = member.settings as { never?: unknown; workspaces?: unknown };
  return {
    agent: member.entry,
    settings: { file: `${TEAM_DATA_DIR}/config/agents/${id}.json`, content: member.settings, error: null },
    never: Array.isArray(settings.never) ? (settings.never as string[]) : null,
    workspaces: Array.isArray(settings.workspaces) ? (settings.workspaces as string[]) : null,
    memory: {
      dir: memoryDir,
      files: ["role.md", "preferences.md", "people.md", "lessons.md"].map((name) => ({ name, path: `${memoryDir}/${name}`, present: name !== "lessons.md" })),
    },
    charter: member.charter,
  };
}

function rowOf(entry: RosterEntry, charter: unknown): AgentRow {
  return {
    id: entry.id,
    display_name: entry.display_name,
    avatar_shape: entry.avatar.shape,
    avatar_hue: entry.avatar.hue,
    status: entry.status,
    created_by: entry.created_by ?? "owner",
    approval_id: entry.approval_id,
    charter_json: JSON.stringify(charter),
    created_at: AT,
    updated_at: AT,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The kernel's `AGENT_ID_PATTERN` (`kernel/src/agents/types.ts`), copied: the app never imports kernel code. */
const AGENT_ID = /^[a-z][a-z0-9-]{0,31}$/;

export interface TeamFixtureOptions {
  /** False: Wright alone (the empty state). Default true: Wright, Mason and Ada. */
  readonly crew?: boolean;
  /** Mason's pending approval is in `GET /approvals` from the start. */
  readonly waiting?: boolean;
  /** The collision roster in place of Mason and Ada: the two reviewers with the off Ada between them (`crew` false wins). */
  readonly collision?: boolean;
  /** The GitHub connector's state from the start: a row with this status, or none (default: none, "not connected"). */
  readonly connector?: Connector["status"] | "none";
}

export interface TeamFixture {
  /** Pass to `startFixtureKernel`. */
  readonly options: FixtureKernelOptions;
  /** Every `POST /agents` body, in order. */
  readonly creates: unknown[];
  /** Every `POST /agents/:id/rename`, in order. */
  readonly renames: { readonly id: string; readonly body: unknown }[];
  /** Every `POST /ask` body, in order. */
  readonly asks: unknown[];
  /** Every `POST /agents/:id/set`, in order. */
  readonly sets: { readonly id: string; readonly body: unknown }[];
  /** Change what `GET /connectors` answers next (append `connector_status` after, as the kernel does). */
  setConnector(status: Connector["status"] | "none"): void;
  /** Give the routes the started kernel, so rename can append its event. */
  attach(kernel: FixtureKernel): void;
  /** Move the crew member the last `201` created into `GET /agents`; returns it. Append `agent_created` after. */
  publishCreated(): RosterEntry;
  /** An event with the next id. */
  event(kind: string, payload: unknown): EventFrame;
}

export function teamFixture(options: TeamFixtureOptions = {}): TeamFixture {
  const reviewer = (entry: RosterEntry): CrewMember => ({
    entry: { ...entry },
    charter: REVIEWER_CHARTER,
    settings: settingsOf(entry, "default", { allowedTools: ["Read", "Grep"], allowedBashPrefixes: ["gh pr view", "gh pr comment"] }, ["git_push"], ["/srv/repos/site"]),
  });
  const ada = (): CrewMember => ({
    entry: { ...ADA },
    charter: ADA_CHARTER,
    settings: settingsOf(ADA, "acceptEdits", { allowedTools: ["Read", "Edit", "Write"], allowedBashPrefixes: [] }, [], ["/srv/notes"]),
  });
  const mason = (): CrewMember => ({
    entry: { ...MASON },
    charter: MASON_CHARTER,
    settings: settingsOf(MASON, "default", MASON_TOOL_POLICY, MASON_NEVER, ["/srv/repos/site", "/srv/repos/notes-cli"]),
  });
  let crew: CrewMember[] = [mason(), ada()];
  if (options.collision === true) crew = [reviewer(REVIEWER_OLD), ada(), reviewer(REVIEWER_NEW)];
  if (options.crew === false) crew = [];
  const approvals: Approval[] = options.waiting === true ? [MASON_APPROVAL] : [];
  const messages: BrainMessage[] = [WRIGHT_RUNNING];
  const sessions: SessionSummary[] = [WRIGHT_SESSION];
  const creates: unknown[] = [];
  const renames: { id: string; body: unknown }[] = [];
  const asks: unknown[] = [];
  const sets: { id: string; body: unknown }[] = [];
  const wright: { entry: RosterEntry } = { entry: { ...WRIGHT } };
  let connector: Connector["status"] | "none" = options.connector ?? "none";
  let pending: CrewMember | undefined;
  let kernel: FixtureKernel | undefined;
  let nextId = 1;

  const event = (kind: string, payload: unknown): EventFrame => ({ type: "event", id: nextId++, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload });
  const member = (id: string): CrewMember | undefined => crew.find((m) => m.entry.id === id);
  const notFound = (id: string): FixtureAnswer => ({ status: 404, body: { error: "no_such_agent", message: `no agent ${id}` } });

  const connectorRow = (status: Connector["status"]): Connector => ({
    id: 1,
    kind: "github",
    status,
    account_login: "studio-fixture",
    permissions: { pull_requests: "read", contents: "read" },
    reachable_repos: ["studio-fixture/site"],
    expires_at: null,
    verified_at: AT,
    created_at: AT,
    updated_at: AT,
  });

  /** `POST /agents/:id/set` for `connectors`: the roster changes and `agent_settings_set` follows. */
  const set = (req: FixtureRequest): FixtureAnswer => {
    const id = req.params.id ?? "";
    sets.push({ id, body: req.body });
    const found = id === "wright" ? wright : member(id);
    if (found === undefined) return notFound(id);
    const body = isRecord(req.body) ? req.body : {};
    if (body.field !== "connectors" || (body.value !== "github" && body.value !== "none")) {
      return { status: 400, body: { error: "invalid_input", field: "connectors", message: "connectors must be github or none" } };
    }
    const before: readonly ConnectorKind[] = found.entry.connectors ?? [];
    const after: readonly ConnectorKind[] = body.value === "github" ? ["github"] : [];
    const changed = before.join() !== after.join();
    found.entry = { ...found.entry, connectors: after };
    const asGrant = (list: readonly ConnectorKind[]): readonly ConnectorKind[] | null => (list.length === 0 ? null : list);
    if (changed) kernel?.appendEvent(event("agent_settings_set", { id, field: "connectors", old: asGrant(before), new: asGrant(after), ...(id === "wright" ? { by: "owner" } : {}) }));
    const answer: AgentSetResponse = { agent: found.entry, field: "connectors", old: asGrant(before), new: asGrant(after), changed };
    return { status: 200, body: answer };
  };

  const create = (req: FixtureRequest): FixtureAnswer => {
    creates.push(req.body);
    const c = isRecord(req.body) ? req.body : {};
    const id = typeof c.id === "string" ? c.id : "";
    if (!AGENT_ID.test(id)) return { status: 400, body: { error: "agent_id_invalid", field: "id", message: "an id is a lowercase letter, then lowercase letters, digits or hyphens" } };
    if (id === "wright" || member(id) !== undefined) return { status: 409, body: { error: "id_taken", field: "id", message: `${id} is taken` } };
    const avatar = isRecord(c.avatar) ? c.avatar : {};
    const limits = isRecord(c.limits) ? c.limits : {};
    const policy = isRecord(c.tool_policy) ? c.tool_policy : {};
    const entry: RosterEntry = {
      id,
      display_name: typeof c.display_name === "string" ? c.display_name : id,
      avatar: { shape: String(avatar.shape ?? ""), hue: String(avatar.hue ?? "") },
      status: "active",
      created_by: "owner",
      approval_id: null,
      model: typeof c.model === "string" ? c.model : null,
      settings_error: null,
      tokens_today: 0,
      tokens_per_day: typeof limits.tokens_per_day === "number" ? limits.tokens_per_day : null,
      sessions_running: 0,
      sessions_at_once: typeof limits.sessions_at_once === "number" ? limits.sessions_at_once : null,
      connectors: [],
    };
    const never = Array.isArray(policy.never) ? (policy.never as string[]) : [];
    const workspaces = Array.isArray(c.workspaces) ? (c.workspaces as string[]) : [];
    pending = {
      entry,
      charter: { persona: c.persona, duties: c.duties, boundaries: c.boundaries },
      settings: settingsOf(entry, String(c.permission_mode ?? ""), { allowedTools: policy.allowedTools, allowedBashPrefixes: policy.allowedBashPrefixes }, never, workspaces),
    };
    const body: AgentCreateResponse = { agent: rowOf(entry, pending.charter), files: null, files_error: null };
    return { status: 201, body };
  };

  return {
    creates,
    renames,
    asks,
    sets,
    setConnector(status) {
      connector = status;
    },
    attach(started) {
      kernel = started;
    },
    publishCreated() {
      if (pending === undefined) throw new Error("teamFixture: no POST /agents was answered 201");
      crew.push(pending);
      const entry = pending.entry;
      pending = undefined;
      return entry;
    },
    event,
    options: {
      routes: {
        "GET /agents": () => ({ status: 200, body: { agents: [wright.entry, ...crew.map((m) => m.entry)] } }),
        "GET /connectors": () => ({ status: 200, body: { connectors: connector === "none" ? [] : [connectorRow(connector)] } satisfies ConnectorsResponse }),
        "POST /agents/:id/set": set,
        "GET /agents/:id": (req) => {
          const id = req.params.id ?? "";
          if (id === "wright") return { status: 409, body: { error: "reserved", message: "wright is the lead agent; its settings are wright.json" } };
          const found = member(id);
          return found === undefined ? notFound(id) : { status: 200, body: detailOf(found) };
        },
        "POST /agents": create,
        "POST /agents/:id/rename": (req) => {
          const id = req.params.id ?? "";
          renames.push({ id, body: req.body });
          const found = member(id);
          if (found === undefined) return notFound(id);
          const name = isRecord(req.body) && typeof req.body.display_name === "string" ? req.body.display_name.trim() : "";
          if (name === "") return { status: 400, body: { error: "invalid_input", field: "display_name", message: "a name is 1-64 characters" } };
          const old = found.entry.display_name;
          found.entry = { ...found.entry, display_name: name };
          kernel?.appendEvent(event("agent_renamed", { id, old, new: name }));
          const body: AgentChangeResponse = { agent: rowOf(found.entry, found.charter), changed: old !== name };
          return { status: 200, body };
        },
        "GET /approvals": () => ({ status: 200, body: { approvals: [...approvals] } }),
        "GET /messages": () => ({ status: 200, body: { messages: [...messages] } }),
        "GET /sessions": () => {
          const body: SessionsResponse = { sessions: [...sessions] };
          return { status: 200, body };
        },
        "POST /ask": (req) => {
          asks.push(req.body);
          const body: AskResponse = { message_id: 8, queue_id: 32 };
          return { status: 202, body };
        },
      },
    },
  };
}
