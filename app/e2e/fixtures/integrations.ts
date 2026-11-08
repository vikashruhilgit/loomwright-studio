// Integrations' canned kernel data (phase 6 item 11) for `startFixtureKernel({ routes })`.
//
// The kernel's connector routes, served as the real ones answer where the
// app can tell (`kernel/src/integrations/github/routes.ts`):
//   GET  /connectors                 the GitHub row for the current state (or none)
//   POST /connectors/github/token    records the body it was sent; answers the row,
//                                    or the 422 refusals `token_invalid` and
//                                    `token_write_scoped` (with `write_permissions`)
//   POST /connectors/github/disconnect  records the call; the row reads `disconnected`
//   GET  /connectors/github/repos    records the query; `?refresh=1` re-reads, and
//                                    the answer then carries one more repo
//   POST /connectors/github/app/setup         records the call; answers the loopback `setup_url`
//                                    (this kernel's port, the `/connectors/github/app/start`
//                                    path, a `state` query) and the window's `expires_at`, or
//                                    a 422 refusal in the setup reasons (`refuseSetup`)
//   POST /connectors/github/app/setup/cancel  records the call; answers `{cancelled: true}`
// Every change appends a `connector_status` event, as the kernel does, and that
// event is how the screen learns: the spec never edits the screen. A refused
// first connect leaves a `rejected` row (the kernel's `refuse(`), a refused
// replace leaves the current row unchanged.
//
// The token route can be held open (`holdToken` / `releaseToken`) to show the
// sheet's "connecting" phase, and `GET /connectors` can be made to drop the
// connection (`dropNextRead`: the kernel goes away while the app asks), which
// the app reports as status 0, the kernel-unreachable state. The roster
// (`GET /agents`) is Team's fixture roster: Mason holds the GitHub grant,
// Wright and Ada do not.
//
// The GitHub App path (GitHub App 4) is driven the way `docs/architecture/app.md` defines its signals,
// because the contract fixes neither: `change("app-created")` is "Create done, now Install" (the row
// becomes an App with its slug and no installation, plus a non-refusal `connector_status`, which moves
// the sheet to step 2), `change("app-connected")` is the install landing, `change("app-revoked")` is GitHub
// refusing the key later, and `refuseSetup(reason)` / `refuseEvent(reason)` are a refusal answered by the
// setup route or arriving as the `refused` field of a `connector_status` payload. Every refusal carries
// `RAW_REFUSAL_MESSAGE`, which the screen must never show. The fixture carries only the fields `Connector`
// has (`method`, `app_slug`, `installation_id`), never an invented App name.
//
// The switch from a token (phase 7 item 09) is driven by `appStored()`, which is the kernel's `storeApp` over the
// row that exists (`kernel/src/integrations/github/app-port.ts`): the App's slug is recorded on the row, `method`,
// `status`, the account, the repos and the permissions stay as they were (a token stays in use), and exactly one
// `connector_status` event is appended, with the row's unchanged status and no `refused`. That event is the setup
// dialog's step-2 signal. It is not an `AppState` and it is not `app-created`: that one makes an App row, which a
// token connection never becomes before the install. The install itself is `change("app-connected")`, which mirrors
// `recordInstallation` (the token item gone, the row an App, connected).
//
// Phase 8 (Jira and ClickUp connect, the App upgrade, the repo policy card) adds, all opt-in so every phase 6 and 7 spec
// sees the answers it always did (no MCP row, no repo, `GET /connectors` carrying `mcp_connections: []`):
//   POST /connectors/mcp/:kind/connect          records the kind; answers an `authorize_url` (a distinct https address per
//                                    call, `https://auth.example.test/<kind>/authorize?state=fixture-mcp-<n>`) with the
//                                    window's `expires_at`, or the refusal set by `refuseMcpConnect`
//   POST /connectors/mcp/:kind/connect/cancel   records the kind; answers `{cancelled: true}`
//   POST /connectors/mcp/:kind/disconnect       records the kind; the row reads `disconnected`, with an event
//   GET  /connectors/github/app/upgrade         records the read; answers the `url` (`setUpgradeUrl`, default `UPGRADE_URL`)
//   GET  /repos/policy                          records the read; answers the repos given as `policies`
//   POST /repos/policy/:owner/:repo             records the repo and body; answers the repo with that policy set
//   POST /repos/policy/:owner/:repo/detect      records the repo; answers the repo with a fresh `read_at`
//   GET  /agents/:id                            Mason's detail only, carrying `settings.content.connectors[<kind>]`
// `changeMcp(kind, state)` is the kernel changing an MCP row (state, then a `connector_status` event, which is how the
// screen learns); `refuseMcpEvent` is a connect refused as the `refused` field of a `connector_status` payload. An MCP
// refusal's `message` is `MCP_REFUSAL_MESSAGE`: the screen shows it as plain text beside the code, never as markup.
//
// Every value here is fixture data: no real account, repo or token.
import type {
  AgentDetailResponse,
  Connector,
  ConnectorChangeResponse,
  ConnectorReposResponse,
  ConnectorsResponse,
  EventFrame,
  GitHubAppSetupCancelResponse,
  GitHubAppSetupRefusal,
  GitHubAppSetupResponse,
  GitHubAppUpgradeResponse,
  McpConnection,
  McpConnectResponse,
  RepoPoliciesResponse,
  RepoPolicy,
  RepoPolicySetBody,
  RosterEntry,
} from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernel, FixtureKernelOptions, FixtureRequest } from "../fixture-kernel";
import { ADA, MASON, WRIGHT } from "./team";

/** A distinctive token: the secrecy checks search every page text, attribute and console line for exactly this string. */
export const TOKEN = "github_pat_E2ESECRET0123456789abcdefghij";
/** The token pasted in replace mode. */
export const NEW_TOKEN = "github_pat_E2ENEWSECRET9876543210zyxwvuts";

export const ACCOUNT = "studio-fixture";

/** The fixture App's slug and installation, and the two repos chosen at install (not the token's three, so the lists cannot be confused). */
export const APP_SLUG = "studio-fixture-reader";
export const APP_INSTALLATION = 51234567;
export const APP_REPOS = ["studio-fixture/site", "studio-fixture/notes-cli"] as const;

/** A kernel `message` on every App refusal: the screen shows the mockup's copy and must never show this. */
export const RAW_REFUSAL_MESSAGE = "RAW-KERNEL-MESSAGE do not render this";

/** The repos the token reaches, and the one a refresh adds. */
export const REPOS = ["studio-fixture/site", "studio-fixture/notes-cli", "studio-fixture/dotfiles"] as const;
export const REFRESHED_REPO = "studio-fixture/new-repo";

const DAY_MS = 86_400_000;
const CREATED = "2026-10-21T09:00:00.000Z";

/**
 * The address `GET /connectors/github/app/upgrade` answers by default: where the owner accepts the App's new permissions.
 * Its path ends in `/permissions`, which none of the main process's fixed GitHub forms allows, so the channel opens it
 * only because the kernel answered it.
 */
export const UPGRADE_URL = `https://github.com/settings/apps/${APP_SLUG}/permissions`;

/** The MCP kinds Studio lists (`McpConnectionKind`). */
export type McpKind = "jira" | "clickup";
export const MCP_KINDS: readonly McpKind[] = ["jira", "clickup"];
/** An MCP row: no row yet, connected, past its refresh, or disconnected (the row the kernel keeps). */
export type McpRowState = "none" | "connected" | "expired" | "disconnected";

/** Each kind's workspace address and the tools the kernel kept after connect (invented; Jira is a stub in the real build). */
export const MCP_SERVER: Readonly<Record<McpKind, string>> = {
  jira: "https://mcp.jira.example.test/studio-fixture",
  clickup: "https://mcp.clickup.example.test/studio-fixture",
};
export const MCP_TOOLS: Readonly<Record<McpKind, readonly string[]>> = {
  jira: ["getJiraIssue", "searchJiraIssues", "transitionJiraIssue"],
  clickup: ["get_task", "search_tasks", "update_task"],
};
/** The tools Mason holds, when the fixture gives him any (`masonTools`): the reads, not the tool that changes things. */
export const MASON_MCP_TOOLS: Readonly<Record<McpKind, readonly string[]>> = {
  jira: ["getJiraIssue", "searchJiraIssues"],
  clickup: ["get_task", "search_tasks"],
};
/** A refusal's `message` as the vendor or kernel might send it: markup the screen must show as text, never as elements. */
export const MCP_REFUSAL_MESSAGE = "<b>MCP-KERNEL-MESSAGE</b> keep this as text";

/** A connect the kernel refuses: any non-2xx answer is one refused state in the screen. */
export interface McpConnectRefusal {
  readonly status: number;
  readonly error: string;
  readonly message?: string;
}

/** The GitHub App's states: Create is done (no installation yet), installed and connected, refused by GitHub after it was installed, and installed but holding fewer permissions than Studio now asks for. */
export type AppState = "app-created" | "app-connected" | "app-revoked" | "app-needs-permissions";
export type ConnectorState = Connector["status"] | AppState | "none";
export type Refusal = "token_invalid" | "token_write_scoped";

/** The repos the policy card is drawn for: one with a proposal, one with a detection and no proposal, two GitHub cannot protect. */
export const POLICY_REPOS = {
  proposed: "studio-fixture/site",
  none: "studio-fixture/notes-cli",
  trust: "studio-fixture/dotfiles",
  safe: "studio-fixture/vault",
} as const;

/** A detection as the kernel reads it from GitHub, dated now. */
export function detection(repo: string, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { repo, protection: "protected", required_reviews: 2, required_checks: ["ci"], pushers: ["studio-fixture", "studio-dev"], default_branch: "main", private: false, read_at: new Date().toISOString(), ...overrides };
}

/** The four repos of `POLICY_REPOS`, none with a policy set yet (a fresh copy each call; pass as `policies`). */
export function policyRepos(): RepoPolicy[] {
  const unset = { kind: null, required_reviews: null, trust_unprotected: false, set_by: null, set_at: null } as const;
  const unavailable = (repo: string): RepoPolicy => ({
    ...unset,
    repo,
    detected: detection(repo, { protection: "protection_unavailable", required_reviews: null, required_checks: [], private: true }),
    proposal: { kind: null, required_reviews: null, choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"] },
  });
  return [
    { ...unset, repo: POLICY_REPOS.proposed, detected: detection(POLICY_REPOS.proposed), proposal: { kind: "reviews", required_reviews: 2 } },
    { ...unset, repo: POLICY_REPOS.none, detected: detection(POLICY_REPOS.none, { protection: "unprotected", required_reviews: null, required_checks: [] }), proposal: null },
    unavailable(POLICY_REPOS.trust),
    unavailable(POLICY_REPOS.safe),
  ];
}

export interface IntegrationsFixtureOptions {
  /** The GitHub connector's state from the start (default: none, "not connected"). */
  readonly connector?: ConnectorState;
  /** Each MCP kind's row from the start (default: no row, "not connected"). */
  readonly mcp?: Readonly<Partial<Record<McpKind, McpRowState>>>;
  /** What `GET /repos/policy` answers (default: no repos reached). */
  readonly policies?: readonly RepoPolicy[];
  /** What `GET /connectors/github/app/upgrade` answers (default: `UPGRADE_URL`; `null`: the install needs nothing). */
  readonly upgradeUrl?: string | null;
  /** The MCP tools Mason holds per kind: the roster then says he holds the kind, and his `GET /agents/mason` lists them. */
  readonly masonTools?: Readonly<Partial<Record<McpKind, readonly string[]>>>;
}

export interface IntegrationsFixture {
  /** Pass to `startFixtureKernel`. */
  readonly options: FixtureKernelOptions;
  /** Every `POST /connectors/github/token` body, in order (what the main process posted). */
  readonly tokens: unknown[];
  /** Every `POST /connectors/github/disconnect` body, in order. */
  readonly disconnects: unknown[];
  /** Every `GET /connectors/github/repos` query, in order. */
  readonly repoReads: Readonly<Record<string, string>>[];
  /** Every `POST /connectors/github/app/setup` body, in order. */
  readonly setups: unknown[];
  /** Every `POST /connectors/github/app/setup/cancel` body, in order. */
  readonly cancels: unknown[];
  /** The `setup_url` each setup call answered, in order (the address the sheet must open through the channel). */
  readonly setupUrls: string[];
  /** The kind of every `POST /connectors/mcp/:kind/connect`, in order (refused ones included). */
  readonly mcpConnects: McpKind[];
  /** The kind of every `POST /connectors/mcp/:kind/connect/cancel`, in order. */
  readonly mcpCancels: McpKind[];
  /** The kind of every `POST /connectors/mcp/:kind/disconnect`, in order. */
  readonly mcpDisconnects: McpKind[];
  /** The `authorize_url` each accepted connect answered, in order (the address the pane must open through the channel). */
  readonly mcpUrls: string[];
  /** The `expires_at` each accepted connect answered, in order. */
  readonly mcpExpiries: string[];
  /** Every `GET /connectors/github/app/upgrade` query, in order. */
  readonly upgradeReads: Readonly<Record<string, string>>[];
  /** Every `GET /repos/policy` query, in order. */
  readonly policyReads: Readonly<Record<string, string>>[];
  /** Every `POST /repos/policy/:owner/:repo` (`repo` as `owner/name`, with the body it was sent), in order. */
  readonly policySets: { readonly repo: string; readonly body: unknown }[];
  /** The repo (`owner/name`) of every `POST /repos/policy/:owner/:repo/detect`, in order. */
  readonly policyDetects: string[];
  /** Give the routes the started kernel, so they can append events and `dropNextRead` can close it. */
  attach(kernel: FixtureKernel): void;
  /** Change what `GET /connectors` answers next (no event: use `change` for the kernel's behaviour). */
  setConnector(state: ConnectorState): void;
  /** `setConnector`, then a `connector_status` event: the kernel changing the connector. */
  change(state: ConnectorState): void;
  /**
   * The kernel's `storeApp` over the current row: the App's slug is recorded on it, its method, status and the rest stay
   * as they were, and one non-refusal `connector_status` event is appended (the setup dialog's step-2 signal). With no
   * row at all it creates one, which is `change("app-created")`.
   */
  appStored(): void;
  /** The next token is refused with this error (`undefined`: accepted again). */
  refuse(error: Refusal | undefined): void;
  /** The token route holds each request open until `releaseToken`. */
  holdToken(): void;
  /** Answer every held token request (and stop holding). */
  releaseToken(): void;
  /** The next `GET /connectors` closes the kernel without an answer: the app's read gets status 0. */
  dropNextRead(): void;
  /** The next setup call is refused with this reason (`undefined`: accepted again). */
  refuseSetup(reason: GitHubAppSetupRefusal | undefined): void;
  /**
   * The kernel refusing a running setup: a `connector_status` event whose payload carries `refused: reason`
   * (and `write_permissions` for `token_write_scoped`, `app_slug` when given). The row does not change.
   */
  refuseEvent(reason: GitHubAppSetupRefusal, extra?: Readonly<Record<string, unknown>>): void;
  /** Change what `GET /connectors` answers for `kind` next (no event: use `changeMcp` for the kernel's behaviour). */
  setMcp(kind: McpKind, state: McpRowState): void;
  /** `setMcp`, then a `connector_status` event: the kernel changing the MCP connection. */
  changeMcp(kind: McpKind, state: McpRowState): void;
  /** The next connect is refused with this answer (`undefined`: accepted again). */
  refuseMcpConnect(refusal: McpConnectRefusal | undefined): void;
  /** The kernel refusing a waiting connect: a `connector_status` event of `kind` whose payload carries `refused: code` and `MCP_REFUSAL_MESSAGE`. The row does not change. */
  refuseMcpEvent(kind: McpKind, code: string): void;
  /** What `GET /connectors/github/app/upgrade` answers next. */
  setUpgradeUrl(url: string | null): void;
  /** An event with the next id. */
  event(kind: string, payload: unknown): EventFrame;
}

/** The status the kernel gives a row in `state`. */
function statusOf(state: Exclude<ConnectorState, "none">): Connector["status"] {
  if (state === "app-connected") return "connected";
  if (state === "app-needs-permissions") return "needs_permissions";
  if (state === "app-created" || state === "app-revoked") return "rejected";
  return state;
}

/** The GitHub row in a token `state`, with the dates relative to now (so "88 days left" holds whenever the spec runs). */
export function connectorRow(state: Exclude<ConnectorState, "none" | AppState>): Connector {
  const dead = state === "rejected" || state === "disconnected";
  const days = state === "expiring" ? 8 : state === "expired" ? -3 : 88;
  return {
    id: 1,
    kind: "github",
    status: state,
    account_login: dead ? null : ACCOUNT,
    permissions: dead ? null : { metadata: "read", pull_requests: "read", contents: "read" },
    permissions_source: dead ? null : "reported",
    permissions_declared_at: null,
    reachable_repos: dead ? null : [...REPOS],
    expires_at: dead ? null : new Date(Date.now() + days * DAY_MS).toISOString(),
    verified_at: dead ? null : new Date().toISOString(),
    created_at: CREATED,
    updated_at: new Date().toISOString(),
  };
}

/**
 * The GitHub row of an App connection. `app-created`: Create is done, so the App's slug is known and nothing is installed
 * (a `rejected` row without an installation, which the screen reads as not connected). `app-connected`: installed, with
 * the permissions GitHub reported (D39's levels), the two repos chosen at install and an access token that expires within the hour.
 * `app-revoked`: GitHub refused the key after the install (`rejected`, slug and installation kept, the last read kept).
 */
export function appConnectorRow(state: AppState): Connector {
  const created = state === "app-created";
  return {
    id: 1,
    kind: "github",
    status: statusOf(state),
    account_login: created ? null : ACCOUNT,
    // D39: the App holds every repository permission at write, except Metadata (read). An install that predates it
    // (`app-needs-permissions`) still holds the old read set: the kernel reads it `needs_permissions` until GitHub reports the new one.
    permissions: created ? null : state === "app-needs-permissions" ? { metadata: "read", pull_requests: "read", contents: "read" } : { metadata: "read", pull_requests: "write", contents: "write" },
    permissions_source: created ? null : "reported",
    permissions_declared_at: null,
    method: "app",
    app_slug: APP_SLUG,
    installation_id: created ? null : APP_INSTALLATION,
    reachable_repos: created ? null : [...APP_REPOS],
    expires_at: state === "app-connected" || state === "app-needs-permissions" ? new Date(Date.now() + 55 * 60_000).toISOString() : null,
    verified_at: created ? null : new Date(Date.now() - (state === "app-revoked" ? 3 * 3_600_000 : 0)).toISOString(),
    created_at: CREATED,
    updated_at: new Date().toISOString(),
  };
}

/** The row for any state but `none`. */
function rowOf(state: Exclude<ConnectorState, "none">): Connector {
  return state === "app-created" || state === "app-connected" || state === "app-revoked" || state === "app-needs-permissions" ? appConnectorRow(state) : connectorRow(state);
}

/** The `mcp_connections` row of `kind` in `state`; `none` has no row. Dates are relative to now. */
function mcpConnectionRow(kind: McpKind, state: Exclude<McpRowState, "none">): McpConnection {
  const live = state === "connected" || state === "expired";
  return {
    kind,
    server_url: live ? MCP_SERVER[kind] : null,
    status: state,
    granted_tools: live ? [...MCP_TOOLS[kind]] : [],
    token_expiry: state === "connected" ? new Date(Date.now() + 55 * 60_000).toISOString() : null,
  };
}

/** The connector row a disconnect answers (the contract's `ConnectorChangeResponse` carries a `Connector`). */
function disconnectedRow(kind: McpKind): Connector {
  return { ...connectorRow("disconnected"), id: kind === "jira" ? 2 : 3, kind };
}

/** The roster as `GET /agents` answers it: Team's, with Mason holding each MCP kind he is given tools of. */
function rosterOf(masonTools: IntegrationsFixtureOptions["masonTools"]): RosterEntry[] {
  const kinds = MCP_KINDS.filter((kind) => masonTools?.[kind] !== undefined);
  return [WRIGHT, { ...MASON, connectors: [...(MASON.connectors ?? []), ...kinds] }, ADA];
}

/** Mason's `GET /agents/:id`: the parsed settings carry `connectors[<kind>]` for each MCP kind he holds. */
function masonDetail(masonTools: IntegrationsFixtureOptions["masonTools"]): AgentDetailResponse {
  const [, mason] = rosterOf(masonTools) as [RosterEntry, RosterEntry, RosterEntry];
  const connectors = Object.fromEntries(MCP_KINDS.flatMap((kind) => (masonTools?.[kind] === undefined ? [] : [[kind, masonTools[kind]]])));
  return { agent: mason, settings: { file: "config/agents/mason.json", content: { connectors }, error: null }, never: null, workspaces: null, memory: { dir: "", files: [] }, charter: null };
}

/** How long the setup window stays open. */
const SETUP_WINDOW_MS = 10 * 60_000;

export function integrationsFixture(options: IntegrationsFixtureOptions = {}): IntegrationsFixture {
  const tokens: unknown[] = [];
  const disconnects: unknown[] = [];
  const repoReads: Record<string, string>[] = [];
  const setups: unknown[] = [];
  const cancels: unknown[] = [];
  const setupUrls: string[] = [];
  let setupRefusal: GitHubAppSetupRefusal | undefined;
  let state: ConnectorState = options.connector ?? "none";
  let refusal: Refusal | undefined;
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let drop = false;
  let kernel: FixtureKernel | undefined;
  let nextId = 1;
  /** `storeApp` has recorded the App's slug on the token row (a row the kernel keeps, even after a Disconnect). */
  let slugStored = false;
  /** The repos a `?refresh=1` read has added. */
  let refreshed = false;
  // Phase 8.
  const mcpConnects: McpKind[] = [];
  const mcpCancels: McpKind[] = [];
  const mcpDisconnects: McpKind[] = [];
  const mcpUrls: string[] = [];
  const mcpExpiries: string[] = [];
  const upgradeReads: Record<string, string>[] = [];
  const policyReads: Record<string, string>[] = [];
  const policySets: { repo: string; body: unknown }[] = [];
  const policyDetects: string[] = [];
  const mcp: Record<McpKind, McpRowState> = { jira: options.mcp?.jira ?? "none", clickup: options.mcp?.clickup ?? "none" };
  let mcpRefusal: McpConnectRefusal | undefined;
  let upgradeUrl: string | null = options.upgradeUrl === undefined ? UPGRADE_URL : options.upgradeUrl;
  let policies: RepoPolicy[] = (options.policies ?? []).map((policy) => ({ ...policy }));

  const event =(kind: string, payload: unknown): EventFrame => ({ type: "event", id: nextId++, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload });
  const change = (next: ConnectorState): void => {
    state = next;
    if (next !== "none") kernel?.appendEvent(event("connector_status", { connector_id: 1, kind: "github", status: statusOf(next) }));
  };
  /** The row `GET /connectors` answers: for a token's row, with the App's slug once `storeApp` recorded it (nothing else changes). */
  const answerRow = (current: Exclude<ConnectorState, "none">): Connector => {
    const row = rowOf(current);
    return slugStored && row.method !== "app" ? { ...row, app_slug: APP_SLUG } : row;
  };
  /** A token is in use: connected, expiring or expired. */
  const hasToken = (): boolean => state === "connected" || state === "expiring" || state === "expired";
  const connectorIdOf = (kind: McpKind): number => (kind === "jira" ? 2 : 3);
  const setMcp = (kind: McpKind, next: McpRowState): void => {
    mcp[kind] = next;
  };
  const changeMcp = (kind: McpKind, next: McpRowState): void => {
    setMcp(kind, next);
    if (next !== "none") kernel?.appendEvent(event("connector_status", { connector_id: connectorIdOf(kind), kind, status: next }));
  };
  /** The MCP kind a route's `:kind` names, else `undefined` (the kernel would refuse it). */
  const mcpKindOf = (req: FixtureRequest): McpKind | undefined => MCP_KINDS.find((kind) => kind === req.params.kind);
  const unknownKind: FixtureAnswer = { status: 404, body: { error: "unknown_connector" } };
  /** `owner/name` of a policy route's params. */
  const repoOf = (req: FixtureRequest): string => `${req.params.owner ?? ""}/${req.params.repo ?? ""}`;
  /** Replaces the repo's policy in the list and answers it, or the 404 the kernel gives a repo it never reached. */
  const updatePolicy = (repo: string, update: (before: RepoPolicy) => RepoPolicy): FixtureAnswer => {
    const before = policies.find((policy) => policy.repo === repo);
    if (before === undefined) return { status: 404, body: { error: "unknown_repo" } };
    const after = update(before);
    policies = policies.map((policy) => (policy.repo === repo ? after : policy));
    return { status: 200, body: after satisfies RepoPolicy };
  };

  const mcpConnect = (req: FixtureRequest): FixtureAnswer => {
    const kind = mcpKindOf(req);
    if (kind === undefined) return unknownKind;
    mcpConnects.push(kind);
    if (mcpRefusal !== undefined) return { status: mcpRefusal.status, body: { error: mcpRefusal.error, ...(mcpRefusal.message === undefined ? {} : { message: mcpRefusal.message }), connector: kind } };
    // The vendor's consent page, a distinct address per call (the single-use state); any host, https only.
    const url = `https://auth.example.test/${kind}/authorize?state=fixture-mcp-${mcpUrls.length + 1}`;
    const expires = new Date(Date.now() + SETUP_WINDOW_MS).toISOString();
    mcpUrls.push(url);
    mcpExpiries.push(expires);
    return { status: 200, body: { authorize_url: url, expires_at: expires } satisfies McpConnectResponse };
  };

  const token = async (req: FixtureRequest): Promise<FixtureAnswer> => {
    tokens.push(req.body);
    if (gate !== undefined) await gate;
    if (refusal === "token_invalid") {
      if (!hasToken()) change("rejected");
      return { status: 422, body: { error: "token_invalid", message: "GitHub did not accept this token.", connector: "github" } };
    }
    if (refusal === "token_write_scoped") {
      if (!hasToken()) change("rejected");
      return {
        status: 422,
        body: {
          error: "token_write_scoped",
          message: "this token can write; Studio takes read-only tokens only.",
          connector: "github",
          write_permissions: [{ permission: "pull_requests", level: "write" }],
        },
      };
    }
    refreshed = false;
    change("connected");
    return { status: 200, body: { connector: connectorRow("connected") } satisfies ConnectorChangeResponse };
  };

  return {
    tokens,
    disconnects,
    repoReads,
    setups,
    cancels,
    setupUrls,
    mcpConnects,
    mcpCancels,
    mcpDisconnects,
    mcpUrls,
    mcpExpiries,
    upgradeReads,
    policyReads,
    policySets,
    policyDetects,
    attach(started) {
      kernel = started;
    },
    setConnector(next) {
      state = next;
    },
    change,
    appStored() {
      if (state === "none") {
        change("app-created");
        return;
      }
      slugStored = true;
      kernel?.appendEvent(event("connector_status", { connector_id: 1, kind: "github", status: statusOf(state) }));
    },
    refuse(error) {
      refusal = error;
    },
    holdToken() {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    releaseToken() {
      open?.();
      gate = undefined;
      open = undefined;
    },
    dropNextRead() {
      drop = true;
    },
    refuseSetup(reason) {
      setupRefusal = reason;
    },
    refuseEvent(reason, extra = {}) {
      const writes = reason === "token_write_scoped" ? { write_permissions: [{ permission: "contents", level: "write" }] } : {};
      kernel?.appendEvent(event("connector_status", { connector_id: 1, kind: "github", status: "rejected", refused: reason, message: RAW_REFUSAL_MESSAGE, ...writes, ...extra }));
    },
    setMcp,
    changeMcp,
    refuseMcpConnect(next) {
      mcpRefusal = next;
    },
    refuseMcpEvent(kind, code) {
      kernel?.appendEvent(event("connector_status", { connector_id: connectorIdOf(kind), kind, status: mcp[kind], refused: code, message: MCP_REFUSAL_MESSAGE }));
    },
    setUpgradeUrl(next) {
      upgradeUrl = next;
    },
    event,
    options: {
      routes: {
        "GET /agents": () => ({ status: 200, body: { agents: rosterOf(options.masonTools) } }),
        // Mason's detail only, and only for the kinds he is given tools of; every other crew member is a 404 (unknown, as before phase 8).
        "GET /agents/:id": ({ params }) => (params.id === "mason" ? { status: 200, body: masonDetail(options.masonTools) } : { status: 404, body: { error: "unknown_agent" } }),
        "GET /connectors": async () => {
          if (drop) {
            drop = false;
            // The kernel goes away while the app asks: the sockets are destroyed, nothing is answered.
            void kernel?.close();
            return new Promise<FixtureAnswer>(() => undefined);
          }
          const mcpConnections = MCP_KINDS.flatMap((kind) => (mcp[kind] === "none" ? [] : [mcpConnectionRow(kind, mcp[kind] as Exclude<McpRowState, "none">)]));
          return { status: 200, body: { connectors: state === "none" ? [] : [answerRow(state)], mcp_connections: mcpConnections } satisfies ConnectorsResponse };
        },
        "POST /connectors/mcp/:kind/connect": mcpConnect,
        "POST /connectors/mcp/:kind/connect/cancel": (req) => {
          const kind = mcpKindOf(req);
          if (kind === undefined) return unknownKind;
          mcpCancels.push(kind);
          return { status: 200, body: { cancelled: true } satisfies GitHubAppSetupCancelResponse };
        },
        "POST /connectors/mcp/:kind/disconnect": (req) => {
          const kind = mcpKindOf(req);
          if (kind === undefined) return unknownKind;
          mcpDisconnects.push(kind);
          changeMcp(kind, "disconnected");
          return { status: 200, body: { connector: disconnectedRow(kind) } satisfies ConnectorChangeResponse };
        },
        "GET /connectors/github/app/upgrade": (req) => {
          upgradeReads.push({ ...req.query });
          return { status: 200, body: { url: upgradeUrl } satisfies GitHubAppUpgradeResponse };
        },
        "GET /repos/policy": (req) => {
          policyReads.push({ ...req.query });
          return { status: 200, body: { repos: policies } satisfies RepoPoliciesResponse };
        },
        "POST /repos/policy/:owner/:repo/detect": (req) => {
          const repo = repoOf(req);
          policyDetects.push(repo);
          // A fresh read of GitHub: the detection is dated now, and nothing else about the repo changes.
          return updatePolicy(repo, (before) => ({ ...before, detected: { ...(before.detected ?? {}), read_at: new Date().toISOString() } }));
        },
        "POST /repos/policy/:owner/:repo": (req) => {
          const repo = repoOf(req);
          const body = req.body as RepoPolicySetBody;
          policySets.push({ repo, body });
          return updatePolicy(repo, (before) => ({
            ...before,
            kind: body.kind,
            required_reviews: body.kind === "reviews" ? (body.required ?? null) : null,
            trust_unprotected: body.trust_unprotected ?? before.trust_unprotected,
            set_by: "owner",
            set_at: new Date().toISOString(),
          }));
        },
        "POST /connectors/github/token": token,
        "POST /connectors/github/disconnect": (req) => {
          disconnects.push(req.body);
          change("disconnected");
          return { status: 200, body: { connector: connectorRow("disconnected") } satisfies ConnectorChangeResponse };
        },
        "POST /connectors/github/app/setup": (req) => {
          setups.push(req.body);
          if (setupRefusal !== undefined) return { status: 422, body: { error: setupRefusal, message: RAW_REFUSAL_MESSAGE, connector: "github" } };
          // The kernel's start page on this kernel's port, with the window's single-use `state` (the only query the channel accepts).
          const url = `http://127.0.0.1:${kernel?.port ?? 0}/connectors/github/app/start?state=fixture-state-${setups.length}`;
          setupUrls.push(url);
          return { status: 200, body: { setup_url: url, expires_at: new Date(Date.now() + SETUP_WINDOW_MS).toISOString() } satisfies GitHubAppSetupResponse };
        },
        "POST /connectors/github/app/setup/cancel": (req) => {
          cancels.push(req.body);
          return { status: 200, body: { cancelled: true } satisfies GitHubAppSetupCancelResponse };
        },
        "GET /connectors/github/repos": (req) => {
          repoReads.push({ ...req.query });
          if (req.query.refresh === "1") refreshed = true;
          const own = state === "app-connected" || state === "app-revoked" || state === "app-needs-permissions" ? APP_REPOS : REPOS;
          const repos = refreshed ? [...own, REFRESHED_REPO] : [...own];
          return { status: 200, body: { repos, verified_at: new Date().toISOString() } satisfies ConnectorReposResponse };
        },
      },
    },
  };
}
