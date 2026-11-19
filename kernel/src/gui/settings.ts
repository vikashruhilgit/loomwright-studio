// The `gui` feature's `settings` part (phase 7, item 08): the one read route the
// Settings screen calls. Mechanism only (invariant 1): the kernel reports how it
// is set up and sets no policy. Every gui route is an owner route that needs the
// API token: none sets `unauthenticated`. The route is read-only: nothing is written.
//
//   GET /settings                {provider, providers, provider_source, pending_provider, data_dir, notifier, loomwright}
//   PUT /settings/auth-provider  {provider}  the owner's choice of provider (D42)
//   PUT /settings/api-key        {key}       store the owner's API key in the Keychain (D42)
//
// The two PUTs are the owner's own settings, made in the app: the key is
// written to the Keychain and never echoed, logged or put in an event. A switch
// is refused while a session runs (it restarts the kernel), while a flag or env
// var overrides the choice, or while the chosen provider has no usable
// credential; otherwise it is recorded in `config/auth.json` and the kernel
// restarts on it (launchd), or it applies at the next start.
//
// The shape mirrors `app/src/api/contract.ts` (`SettingsResponse`, `NotifierKind`).
//   - `provider`: the first auth provider as `/status` reports it (`id`,
//     `account`, `health`) plus `token_created_at` from the provider metadata
//     row (`null` when none). It is read through the request's `StatusView`,
//     built from `/status`'s own helpers, so a provider's `health()` stays the
//     one Keychain read. The body is built field by field: never a token, a key,
//     Keychain output or the provider object.
//   - `data_dir`: the store's data dir.
//   - `notifier`: `chooseNotifier()`'s choice, as `terminal-notifier`
//     (`click`), `osascript` (`plain`) or `none`.
//   - `loomwright`: the adapter's state (`status_threw` when its reader threw).
// A missing piece is a refusal, never a throw: `503 {"error":"settings_unavailable","reason":...}`
// with reason `no_status_view` (the request carries no `StatusView`),
// `no_auth_provider` or `no_loomwright_reader`.
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { API_KEY_KEYCHAIN_SERVICE, API_KEY_PROVIDER_ID } from "../auth/api-key.js";
import { readAuthChoice, writeAuthChoice } from "../auth/choice.js";
import { WRITE_ARG } from "../auth/keychain.js";
import { readProviderMetadata } from "../auth/metadata.js";
import { isWholeApiKey } from "../auth/token-shape.js";
import { chooseNotifier } from "../notifications/notifier.js";
import type { NotifierChoice } from "../notifications/notifier.js";
import type { GuiPart } from "./types.js";

/** `app/src/api/contract.ts` `NotifierKind`. */
export type SettingsNotifierKind = "terminal-notifier" | "osascript" | "none";

export type SettingsUnavailableReason = "no_status_view" | "no_auth_provider" | "no_loomwright_reader";

/** The notifier the kernel would use, as the contract names it: `click` is terminal-notifier, `plain` osascript. */
export function notifierKindOf(choice: NotifierChoice): SettingsNotifierKind {
  switch (choice.kind) {
    case "click":
      return "terminal-notifier";
    case "plain":
      return "osascript";
    case "none":
      return "none";
  }
}

function unavailable(reason: SettingsUnavailableReason): ContributedRouteResponse {
  return { status: 503, body: { error: "settings_unavailable", reason } };
}

/** The recorded token creation date, or `null` when none is recorded (or the row cannot be read). */
function tokenCreatedAt(req: ContributedRouteRequest, providerId: string): string | null {
  try {
    return readProviderMetadata(req.store, providerId)?.token_created_at ?? null;
  } catch {
    return null;
  }
}

async function settings(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const view = req.status;
  if (view === undefined) return unavailable("no_status_view");
  // One read of every provider's health: the in-use one first.
  const all = view.auth(req.now());
  const provider = all[0];
  if (provider === undefined) return unavailable("no_auth_provider");
  const loomwright = view.loomwright();
  if (loomwright === undefined) return unavailable("no_loomwright_reader");
  return {
    status: 200,
    body: {
      provider: {
        id: provider.id,
        account: provider.account,
        health: provider.health,
        token_created_at: tokenCreatedAt(req, provider.id),
      },
      // Every provider this build has, the in-use one first (D42).
      providers: all.map((p) => ({ id: p.id, account: p.account, health: p.health, in_use: p.id === provider.id })),
      provider_source: req.auth?.source ?? null,
      // The recorded choice when it differs from the provider in use and this build has it (23u): a switch whose
      // restart was deferred, or one made with no restart wired. It applies at the next start unless the owner keeps
      // the current one. `null` when nothing is pending, or a flag or env var picks the provider.
      pending_provider: pendingProvider(req, provider.id),
      data_dir: req.store.dataDir,
      notifier: notifierKindOf(chooseNotifier()),
      loomwright,
    },
  };
}

function pendingProvider(req: ContributedRouteRequest, inUse: string): string | null {
  const auth = req.auth;
  if (auth === undefined || auth.source === "flag" || auth.source === "env") return null;
  const chosen = readAuthChoice(auth.dataDir);
  return chosen !== undefined && chosen !== inUse && auth.available.includes(chosen) ? chosen : null;
}

/** How long after the answer the restart runs, so the answer reaches the app first. */
export const RESTART_DELAY_MS = 250;

function bodyField(body: unknown, field: string): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function runningSessions(req: ContributedRouteRequest): number {
  return req.store.prepare<[], { n: number }>("SELECT count(*) AS n FROM sessions WHERE status IN ('starting', 'running')").get()?.n ?? 0;
}

// Each kind is written literally, so the app's audit sentence table can check it covers every kind the kernel writes.
function recordProviderChosen(req: ContributedRouteRequest, payload: Record<string, unknown>): void {
  req.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'auth_provider_chosen', 'api', ?)").run(req.now().toISOString(), JSON.stringify(payload));
}

function recordSwitchWithdrawn(req: ContributedRouteRequest, payload: { kept: string; withdrawn: string }): void {
  req.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'auth_provider_switch_withdrawn', 'api', ?)").run(req.now().toISOString(), JSON.stringify(payload));
}

function recordApiKeySet(req: ContributedRouteRequest): void {
  req.store.prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'auth_api_key_set', 'api', ?)").run(req.now().toISOString(), JSON.stringify({ provider: API_KEY_PROVIDER_ID }));
}

/**
 * `PUT /settings/auth-provider {provider}`. Refusals: `400 invalid_body`;
 * `400 unknown_provider` (not in this build); `409 provider_overridden` (a flag
 * or env var picks the provider, so a choice would not apply); `409
 * provider_not_ready` (its health is not `ok` or `expiring`, so every session
 * would fail); `409 sessions_running` (the restart would stop them). The same
 * provider as in use only records the choice; when that withdraws a pending
 * choice (a deferred switch, 23u), `auth_provider_switch_withdrawn {kept,
 * withdrawn}` is appended, and nothing when none was pending. Otherwise the choice is recorded,
 * an `auth_provider_chosen` event appended, and the kernel restarts on it
 * (`restarting: true`) or, with no restart wired, applies it at the next start.
 */
async function chooseProvider(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const auth = req.auth;
  const view = req.status;
  if (auth === undefined || view === undefined) return unavailable("no_status_view");
  const provider = bodyField(req.body, "provider");
  if (provider === undefined) return { status: 400, body: { error: "invalid_body", message: "the body is {provider}, a provider id" } };
  if (!auth.available.includes(provider)) return { status: 400, body: { error: "unknown_provider", available: auth.available } };
  if (auth.source === "flag" || auth.source === "env") return { status: 409, body: { error: "provider_overridden", source: auth.source } };
  if (provider === auth.inUse) {
    const pending = pendingProvider(req, auth.inUse);
    writeAuthChoice(auth.dataDir, provider);
    if (pending !== null) recordSwitchWithdrawn(req, { kept: provider, withdrawn: pending });
    return { status: 200, body: { in_use: auth.inUse, chosen: provider, restarting: false } };
  }
  const health = view.auth(req.now()).find((p) => p.id === provider)?.health;
  if (health === undefined || (health.status !== "ok" && health.status !== "expiring")) {
    return { status: 409, body: { error: "provider_not_ready", provider, health: health ?? null } };
  }
  const running = runningSessions(req);
  if (running > 0) return { status: 409, body: { error: "sessions_running", count: running } };
  writeAuthChoice(auth.dataDir, provider);
  recordProviderChosen(req, { from: auth.inUse, to: provider, restarting: auth.restart !== undefined });
  const restart = auth.restart;
  // The restart closes admission before it counts running sessions (23u), so none can start between the count and the
  // stop. A session admitted in the delay defers it: nothing restarts, `auth_provider_restart_deferred` is recorded,
  // and `GET /settings` shows the choice as pending until the next start (or until the owner keeps the current one).
  if (restart !== undefined) {
    setTimeout(() => {
      try {
        const outcome = restart();
        if (outcome.restarting) return;
        req.store
          .prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'auth_provider_restart_deferred', 'kernel', ?)")
          .run(req.now().toISOString(), JSON.stringify({ to: provider, running: outcome.running }));
      } catch {
        // The kernel is already stopping (its store closed): nothing to restart or record, and never an uncaught throw.
      }
    }, RESTART_DELAY_MS).unref();
  }
  return { status: 202, body: { in_use: auth.inUse, chosen: provider, restarting: restart !== undefined } };
}

/**
 * `PUT /settings/api-key {key}`: replace the Keychain item the `api-key`
 * provider reads, then read it back (the only proof it was stored). The key is
 * never echoed, logged or recorded; refusals name the field, never the value.
 * `400 invalid_key` (not a whole API key, `isWholeApiKey`: no `sk-ant-` prefix,
 * a subscription token, 80 characters or fewer, whitespace, or a character the
 * Keychain writer cannot take); `500 keychain_write_failed`. Appends `auth_api_key_set` (no
 * key). The provider in use is not changed.
 */
async function setApiKey(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const auth = req.auth;
  if (auth === undefined) return unavailable("no_status_view");
  if (!auth.available.includes(API_KEY_PROVIDER_ID)) return { status: 400, body: { error: "unknown_provider", available: auth.available } };
  const key = bodyField(req.body, "key");
  if (key === undefined) return { status: 400, body: { error: "invalid_body", message: "the body is {key}, the API key" } };
  if (!isWholeApiKey(key) || !WRITE_ARG.test(key)) {
    return { status: 400, body: { error: "invalid_key", message: "not a whole API key: it starts sk-ant- (not a sk-ant-oat subscription token), is longer than 80 characters, and has no whitespace or character the Keychain cannot take" } };
  }
  // The Keychain has no replace: the old item is deleted before the add. So the old key is read first and put back if
  // the new one does not read back (23u: a failed add used to leave no key at all, while the app said nothing changed).
  let previous: string | undefined;
  try {
    previous = auth.keychainReader.read(API_KEY_KEYCHAIN_SERVICE);
  } catch {
    // The old key can't be read, so it couldn't be put back: nothing is touched.
    return { status: 500, body: { error: "keychain_write_failed", previous_key: "kept" } };
  }
  if (!storeKey(auth, key)) {
    // Deliberately drop the errors: a Keychain error never carries the key, but nothing here risks it.
    const previousKey = previous === undefined ? "none" : storeKey(auth, previous) ? "kept" : "removed";
    return { status: 500, body: { error: "keychain_write_failed", previous_key: previousKey } };
  }
  recordApiKeySet(req);
  const health = req.status?.auth(req.now()).find((p) => p.id === API_KEY_PROVIDER_ID)?.health ?? null;
  return { status: 200, body: { stored: true, health } };
}

/** Replace the API key item with `secret` and read it back; `true` only when the read-back matches. Never throws. */
function storeKey(auth: NonNullable<ContributedRouteRequest["auth"]>, secret: string): boolean {
  try {
    auth.keychainDeleter.delete(API_KEY_KEYCHAIN_SERVICE);
    auth.keychainWriter.add(API_KEY_KEYCHAIN_SERVICE, API_KEY_PROVIDER_ID, secret);
    return auth.keychainReader.read(API_KEY_KEYCHAIN_SERVICE) === secret;
  } catch {
    return false;
  }
}

export const settingsRoutes: readonly ContributedRoute[] = Object.freeze([
  Object.freeze({ method: "GET", path: "/settings", handler: settings }),
  Object.freeze({ method: "PUT", path: "/settings/auth-provider", handler: chooseProvider }),
  Object.freeze({ method: "PUT", path: "/settings/api-key", handler: setApiKey }),
]);

export const settingsPart: GuiPart = Object.freeze({
  name: "settings",
  tools: Object.freeze([]),
  routes: settingsRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
