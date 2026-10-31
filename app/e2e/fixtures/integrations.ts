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
// Every value here is fixture data: no real account, repo or token.
import type { Connector, ConnectorChangeResponse, ConnectorReposResponse, ConnectorsResponse, EventFrame, GitHubAppSetupCancelResponse, GitHubAppSetupRefusal, GitHubAppSetupResponse } from "../../src/api/contract";
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

/** The App's states: Create is done (no installation yet), installed and connected, and refused by GitHub after it was installed. */
export type AppState = "app-created" | "app-connected" | "app-revoked";
export type ConnectorState = Connector["status"] | AppState | "none";
export type Refusal = "token_invalid" | "token_write_scoped";

export interface IntegrationsFixtureOptions {
  /** The GitHub connector's state from the start (default: none, "not connected"). */
  readonly connector?: ConnectorState;
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
  /** An event with the next id. */
  event(kind: string, payload: unknown): EventFrame;
}

/** The status the kernel gives a row in `state`. */
function statusOf(state: Exclude<ConnectorState, "none">): Connector["status"] {
  if (state === "app-connected") return "connected";
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
 * the permissions GitHub reported, the two repos chosen at install and an access token that expires within the hour.
 * `app-revoked`: GitHub refused the key after the install (`rejected`, slug and installation kept, the last read kept).
 */
export function appConnectorRow(state: AppState): Connector {
  const created = state === "app-created";
  return {
    id: 1,
    kind: "github",
    status: statusOf(state),
    account_login: created ? null : ACCOUNT,
    permissions: created ? null : { metadata: "read", pull_requests: "read", contents: "read" },
    permissions_source: created ? null : "reported",
    permissions_declared_at: null,
    method: "app",
    app_slug: APP_SLUG,
    installation_id: created ? null : APP_INSTALLATION,
    reachable_repos: created ? null : [...APP_REPOS],
    expires_at: state === "app-connected" ? new Date(Date.now() + 55 * 60_000).toISOString() : null,
    verified_at: created ? null : new Date(Date.now() - (state === "app-revoked" ? 3 * 3_600_000 : 0)).toISOString(),
    created_at: CREATED,
    updated_at: new Date().toISOString(),
  };
}

/** The row for any state but `none`. */
function rowOf(state: Exclude<ConnectorState, "none">): Connector {
  return state === "app-created" || state === "app-connected" || state === "app-revoked" ? appConnectorRow(state) : connectorRow(state);
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

  const event = (kind: string, payload: unknown): EventFrame => ({ type: "event", id: nextId++, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload });
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
    event,
    options: {
      routes: {
        "GET /agents": () => ({ status: 200, body: { agents: [WRIGHT, MASON, ADA] } }),
        "GET /connectors": async () => {
          if (drop) {
            drop = false;
            // The kernel goes away while the app asks: the sockets are destroyed, nothing is answered.
            void kernel?.close();
            return new Promise<FixtureAnswer>(() => undefined);
          }
          return { status: 200, body: { connectors: state === "none" ? [] : [answerRow(state)] } satisfies ConnectorsResponse };
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
          const own = state === "app-connected" || state === "app-revoked" ? APP_REPOS : REPOS;
          const repos = refreshed ? [...own, REFRESHED_REPO] : [...own];
          return { status: 200, body: { repos, verified_at: new Date().toISOString() } satisfies ConnectorReposResponse };
        },
      },
    },
  };
}
