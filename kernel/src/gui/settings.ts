// The `gui` feature's `settings` part (phase 7, item 08): the one read route the
// Settings screen calls. Mechanism only (invariant 1): the kernel reports how it
// is set up and sets no policy. Every gui route is an owner route that needs the
// API token: none sets `unauthenticated`. The route is read-only: nothing is written.
//
//   GET /settings   {provider, data_dir, notifier, loomwright}
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
import { readProviderMetadata } from "../auth/metadata.js";
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
  const provider = view.auth(req.now())[0];
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
      data_dir: req.store.dataDir,
      notifier: notifierKindOf(chooseNotifier()),
      loomwright,
    },
  };
}

export const settingsRoutes: readonly ContributedRoute[] = Object.freeze([
  Object.freeze({ method: "GET", path: "/settings", handler: settings }),
]);

export const settingsPart: GuiPart = Object.freeze({
  name: "settings",
  tools: Object.freeze([]),
  routes: settingsRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
