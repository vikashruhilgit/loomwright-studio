// Integrations' canned kernel data (phase 6 item 11) for `startFixtureKernel({ routes })`.
//
// The kernel's four connector routes, served as the real ones answer where the
// app can tell (`kernel/src/integrations/github/routes.ts`):
//   GET  /connectors                 the GitHub row for the current state (or none)
//   POST /connectors/github/token    records the body it was sent; answers the row,
//                                    or the 422 refusals `token_invalid` and
//                                    `token_write_scoped` (with `write_permissions`)
//   POST /connectors/github/disconnect  records the call; the row reads `disconnected`
//   GET  /connectors/github/repos    records the query; `?refresh=1` re-reads, and
//                                    the answer then carries one more repo
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
// Every value here is fixture data: no real account, repo or token.
import type { Connector, ConnectorChangeResponse, ConnectorReposResponse, ConnectorsResponse, EventFrame } from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernel, FixtureKernelOptions, FixtureRequest } from "../fixture-kernel";
import { ADA, MASON, WRIGHT } from "./team";

/** A distinctive token: the secrecy checks search every page text, attribute and console line for exactly this string. */
export const TOKEN = "github_pat_E2ESECRET0123456789abcdefghij";
/** The token pasted in replace mode. */
export const NEW_TOKEN = "github_pat_E2ENEWSECRET9876543210zyxwvuts";

export const ACCOUNT = "studio-fixture";

/** The repos the token reaches, and the one a refresh adds. */
export const REPOS = ["studio-fixture/site", "studio-fixture/notes-cli", "studio-fixture/dotfiles"] as const;
export const REFRESHED_REPO = "studio-fixture/new-repo";

const DAY_MS = 86_400_000;
const CREATED = "2026-10-21T09:00:00.000Z";

export type ConnectorState = Connector["status"] | "none";
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
  /** Give the routes the started kernel, so they can append events and `dropNextRead` can close it. */
  attach(kernel: FixtureKernel): void;
  /** Change what `GET /connectors` answers next (no event: use `change` for the kernel's behaviour). */
  setConnector(state: ConnectorState): void;
  /** `setConnector`, then a `connector_status` event: the kernel changing the connector. */
  change(state: ConnectorState): void;
  /** The next token is refused with this error (`undefined`: accepted again). */
  refuse(error: Refusal | undefined): void;
  /** The token route holds each request open until `releaseToken`. */
  holdToken(): void;
  /** Answer every held token request (and stop holding). */
  releaseToken(): void;
  /** The next `GET /connectors` closes the kernel without an answer: the app's read gets status 0. */
  dropNextRead(): void;
  /** An event with the next id. */
  event(kind: string, payload: unknown): EventFrame;
}

/** The GitHub row in `state`, with the dates relative to now (so "88 days left" holds whenever the spec runs). */
export function connectorRow(state: Exclude<ConnectorState, "none">): Connector {
  const dead = state === "rejected" || state === "disconnected";
  const days = state === "expiring" ? 8 : state === "expired" ? -3 : 88;
  return {
    id: 1,
    kind: "github",
    status: state,
    account_login: dead ? null : ACCOUNT,
    permissions: dead ? null : { metadata: "read", pull_requests: "read", contents: "read" },
    reachable_repos: dead ? null : [...REPOS],
    expires_at: dead ? null : new Date(Date.now() + days * DAY_MS).toISOString(),
    verified_at: dead ? null : new Date().toISOString(),
    created_at: CREATED,
    updated_at: new Date().toISOString(),
  };
}

export function integrationsFixture(options: IntegrationsFixtureOptions = {}): IntegrationsFixture {
  const tokens: unknown[] = [];
  const disconnects: unknown[] = [];
  const repoReads: Record<string, string>[] = [];
  let state: ConnectorState = options.connector ?? "none";
  let refusal: Refusal | undefined;
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let drop = false;
  let kernel: FixtureKernel | undefined;
  let nextId = 1;
  /** The repos a `?refresh=1` read has added. */
  let refreshed = false;

  const event = (kind: string, payload: unknown): EventFrame => ({ type: "event", id: nextId++, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload });
  const change = (next: ConnectorState): void => {
    state = next;
    if (next !== "none") kernel?.appendEvent(event("connector_status", { connector_id: 1, kind: "github", status: next }));
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
    attach(started) {
      kernel = started;
    },
    setConnector(next) {
      state = next;
    },
    change,
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
          return { status: 200, body: { connectors: state === "none" ? [] : [connectorRow(state)] } satisfies ConnectorsResponse };
        },
        "POST /connectors/github/token": token,
        "POST /connectors/github/disconnect": (req) => {
          disconnects.push(req.body);
          change("disconnected");
          return { status: 200, body: { connector: connectorRow("disconnected") } satisfies ConnectorChangeResponse };
        },
        "GET /connectors/github/repos": (req) => {
          repoReads.push({ ...req.query });
          if (req.query.refresh === "1") refreshed = true;
          const repos = refreshed ? [...REPOS, REFRESHED_REPO] : [...REPOS];
          return { status: 200, body: { repos, verified_at: new Date().toISOString() } satisfies ConnectorReposResponse };
        },
      },
    },
  };
}
