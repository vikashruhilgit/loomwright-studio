// Settings' canned kernel data (phase 7 item 08) for `startFixtureKernel({ routes })`. The body is
// typed by the contract (`SettingsResponse`), so `npm run typecheck` checks it.
//
// It answers the way the kernel's route does where the screen can tell (`kernel/src/gui/settings.ts`):
//   GET /settings   the active provider's id, account, health and token creation time, the data
//                   location, the notifier and the Loomwright install; never a secret
// in three states of the provider: `ok` (a token made 100 days ago), `expiring` (made 347 days ago,
// so 18 days left) and `missing` (nothing in the Keychain, no creation time).
//
// The state is mutable and the fixture is a script for a spec: `holdSettings` keeps the next read
// open (the loading state), `failSettings` answers it 500 (the route-failure card), and `update`
// changes the view AND appends the event the screen follows, which is how the screen learns. A
// fixture can also carry a token-shaped extra field in the body, to show the screen never keeps it.
// The creation times are relative to the moment the fixture is made, so "18 days left" holds
// whenever the spec runs.
//
// Every value here is fixture data: no real account, token or path.
import type { AuthHealth, EventFrame, LoomwrightAdapterStatus, NotifierKind, RouteKey, SettingsResponse } from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernel, FixtureKernelOptions, FixtureRoute } from "../fixture-kernel";
import { cannedStatus } from "../fixture-kernel";

const DAY = 86_400_000;

/** A value shaped like a long-lived token that must appear nowhere on the screen. Not a real token. */
export const FIXTURE_SECRET = "sk-ant-oat01-NOT-A-REAL-TOKEN-fixture-0123456789abcdef";

export type SettingsState = "ok" | "expiring" | "missing";

export interface SettingsFixtureOptions {
  /** The provider's state. Default `ok`. */
  readonly state?: SettingsState;
  /** Extra fields added to the body at the top and in `provider` (a careless screen would show or keep them). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** What `update` may change: the provider's state, and the kernel part's facts. */
export interface SettingsChange {
  readonly state?: SettingsState;
  readonly data_dir?: string;
  readonly notifier?: NotifierKind;
  readonly loomwright?: LoomwrightAdapterStatus;
}

export interface SettingsFixture {
  /** Pass to `startFixtureKernel`. */
  readonly options: FixtureKernelOptions;
  /** Give the routes the started kernel, so they can append events. */
  attach(kernel: FixtureKernel): void;
  /** The next `GET /settings` is not answered until `releaseSettings`: the screen shows its loading state. */
  holdSettings(): void;
  releaseSettings(): void;
  /** `GET /settings` answers `500 {"error": "store_unreadable"}` from now on (`false`: it answers normally again). */
  failSettings(failing: boolean): void;
  /** Change what `GET /settings` answers, then append an event of `kind` (default `auth_token_expiring`) with the payload the kernel would put on it. */
  update(change: SettingsChange, kind?: string, payload?: unknown): void;
  /** How many times `GET /settings` was asked. */
  reads(): number;
  /** The data location the view reports. */
  readonly dataDir: string;
}

/** The provider's health, and when its token was made, for a state. */
function providerOf(state: SettingsState): SettingsResponse["provider"] {
  const base = { id: "subscription-token", account: "personal subscription" };
  // A little under a whole number of days ago, so the whole days left are exact however long the spec runs.
  const made = (days: number): string => new Date(Date.now() - days * DAY + 3_600_000).toISOString();
  if (state === "missing") return { ...base, health: { status: "missing" } satisfies AuthHealth, token_created_at: null };
  if (state === "expiring") return { ...base, health: { status: "expiring", days: 18 } satisfies AuthHealth, token_created_at: made(347) };
  return { ...base, health: { status: "ok" } satisfies AuthHealth, token_created_at: made(100) };
}

export function settingsFixture(options: SettingsFixtureOptions = {}): SettingsFixture {
  const dataDir = "/Users/owner/.loomwright-studio";
  let view: SettingsResponse = {
    provider: providerOf(options.state ?? "ok"),
    data_dir: dataDir,
    notifier: "osascript",
    loomwright: { status: "ok", install_path: "/Users/owner/.claude/plugins/cache/atelier/loomwright/17.22.0", plugin_version: "17.22.0", contract_schema_version: 1, host_switch: true },
  };
  let kernel: FixtureKernel | undefined;
  let nextEvent = 1;
  let hold: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let failing = false;
  let reads = 0;

  const event = (kind: string, payload: unknown): EventFrame => ({ type: "event", id: nextEvent++, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload });

  const settings = async (): Promise<FixtureAnswer> => {
    reads += 1;
    if (hold !== undefined) await hold;
    if (failing) return { status: 500, body: { error: "store_unreadable" } };
    const extra = options.extra ?? {};
    return { status: 200, body: { ...view, ...extra, provider: { ...view.provider, ...extra } } };
  };

  const routes: Partial<Record<RouteKey, FixtureRoute>> = {
    "GET /status": () => ({ status: 200, body: cannedStatus() }),
    "GET /settings": settings,
    // The sidebar's Crew section reads these; nothing here is about them.
    "GET /agents": () => ({ status: 200, body: { agents: [] } }),
    "GET /approvals": () => ({ status: 200, body: { approvals: [] } }),
    "GET /messages": () => ({ status: 200, body: { messages: [] } }),
    "GET /notifications": () => ({ status: 200, body: { notifications: [] } }),
  };

  return {
    options: { routes },
    dataDir,
    attach(started) {
      kernel = started;
    },
    holdSettings() {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseSettings() {
      release?.();
      hold = undefined;
      release = undefined;
    },
    failSettings(value) {
      failing = value;
    },
    update(change, kind = "auth_token_expiring", payload = {}) {
      view = {
        provider: change.state === undefined ? view.provider : providerOf(change.state),
        data_dir: change.data_dir ?? view.data_dir,
        notifier: change.notifier ?? view.notifier,
        loomwright: change.loomwright ?? view.loomwright,
      };
      kernel?.appendEvent(event(kind, payload));
    },
    reads: () => reads,
  };
}
