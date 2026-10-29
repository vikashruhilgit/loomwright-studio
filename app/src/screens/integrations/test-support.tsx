// Test-only support for Integrations' two screen suites (`integrations.test.tsx`,
// `connect-sheet.test.tsx`): the fixtures, and a scripted kernel over
// `fake-bridge.ts` with the four connector routes, each answer swappable per
// test. Imported by tests only; never by the app.
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import type { ApiRequest, ApiResult, Connector, ConnectorStatus, EventFrame, RosterEntry, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { IntegrationsView } from "./IntegrationsView";
import { INTEGRATIONS_TEST_IDS as IDS } from "./model";

export const STATUS: StatusBody = {
  kernel: { version: "1.0.0", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-28", agents: [] },
  cap_state: [],
};

/** A distinctive pasted token: the secrecy pins search for exactly this string. */
export const TOKEN = "github_pat_SECRETtoken0123456789abcdef";

/** A github row 30 days from expiring or so; every field the screen reads is set. */
export function connector(status: ConnectorStatus, overrides: Partial<Connector> = {}): Connector {
  return {
    id: 1,
    kind: "github",
    status,
    account_login: "octo-owner",
    permissions: { metadata: "read", contents: "read", pull_requests: "read" },
    permissions_source: "reported",
    permissions_declared_at: null,
    reachable_repos: ["octo-owner/site", "octo-owner/docs"],
    expires_at: new Date(Date.now() + 88 * 86_400_000).toISOString(),
    verified_at: new Date().toISOString(),
    created_at: "2026-10-01T09:00:00.000Z",
    updated_at: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

export function agent(id: string, name: string, connectors: RosterEntry["connectors"]): RosterEntry {
  return {
    id,
    display_name: name,
    avatar: { shape: id === "wright" ? "whale" : "shark", hue: id === "wright" ? "accent" : "crew-teal" },
    status: "active",
    created_by: id === "wright" ? null : "owner",
    approval_id: null,
    model: "claude-sonnet",
    settings_error: null,
    tokens_today: 0,
    tokens_per_day: null,
    sessions_running: 0,
    sessions_at_once: null,
    ...(connectors === undefined ? {} : { connectors }),
  };
}

export const WRIGHT = agent("wright", "Wright", []);
export const MASON = agent("mason", "Mason", ["github"]);
export const PIM = agent("pim", "Pim", []);

export function refused(status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> {
  return { ok: false, status, body };
}

export const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };

export function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Answer = ApiResult<unknown> | Promise<ApiResult<unknown>>;

export interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  roster: RosterEntry[];
  /** `GET /connectors`. */
  connectors: (req: ApiRequest) => Answer;
  /** `POST /connectors/github/token`. */
  token: (req: ApiRequest) => Answer;
  /** `POST /connectors/github/disconnect`. */
  disconnect: (req: ApiRequest) => Answer;
  /** `GET /connectors/github/repos`. */
  repos: (req: ApiRequest) => Answer;
}

export interface Setup {
  readonly roster?: RosterEntry[];
  readonly connectors?: Kernel["connectors"];
  readonly token?: Kernel["token"];
  readonly disconnect?: Kernel["disconnect"];
  readonly repos?: Kernel["repos"];
}

/** A kernel that answers the four routes, with the defaults of a connected token. */
export function createKernel(setup: Setup = {}): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = {
    fake,
    registry: createCommandRegistry(),
    roster: setup.roster ?? [WRIGHT, MASON, PIM],
    connectors: setup.connectors ?? (() => ok({ connectors: [connector("connected")] })),
    token: setup.token ?? (() => ok({ connector: connector("connected") })),
    disconnect: setup.disconnect ?? (() => ok({ connector: connector("disconnected") })),
    repos: setup.repos ?? (() => ok({ repos: ["octo-owner/site", "octo-owner/docs"], verified_at: new Date().toISOString() })),
  };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /agents", () => ok({ agents: kernel.roster }));
  fake.route("GET /connectors", (req) => kernel.connectors(req));
  fake.route("POST /connectors/github/token", (req) => kernel.token(req));
  fake.route("POST /connectors/github/disconnect", (req) => kernel.disconnect(req));
  fake.route("GET /connectors/github/repos", (req) => kernel.repos(req));
  return kernel;
}

/** Render the screen over `kernel` and wait until the first connectors answer is on it. */
export async function mountScreen(kernel: Kernel): Promise<void> {
  render(<IntegrationsView api={kernel.fake.bridge} registry={kernel.registry} />);
  await waitFor(() => expect(screen.getByTestId(IDS.listMeta).textContent).not.toBe("checking…"));
}

export async function startScreen(setup: Setup = {}): Promise<Kernel> {
  const kernel = createKernel(setup);
  await mountScreen(kernel);
  return kernel;
}

let nextEventId = 1;

/** A feed event of `kind` (the screen follows `kind` only). */
export function emit(kernel: Kernel, kind: string): void {
  const id = nextEventId;
  nextEventId += 1;
  const frame: EventFrame = { type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload: {} };
  act(() => kernel.fake.emit(frame));
}

export function requests(kernel: Kernel, key: string): ApiRequest[] {
  return kernel.fake.requestsTo(key).map((r) => r.req);
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
