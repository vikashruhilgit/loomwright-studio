// Settings' view model (phase 7 item 08): the pure logic behind the screen built to
// `docs/design/mockups/gui-v2.html` (`settingsScreen`). Plain TypeScript: no React, no
// DOM, and no import that reaches a `.tsx` file, so the e2e project (`tsconfig.node.json`,
// no `jsx`) can import `SETTINGS_TEST_IDS` instead of copying it.
//
// `GET /settings` is read-only and never carries a secret (`SettingsResponse` in the
// contract), and the screen must not be the way one gets in: `parseSettings` builds the
// held view from the known fields only, field by field, so an extra field in a body (a
// token-shaped string, say) is never shown and never kept. Every string the kernel sent
// (the account, a path, a reason) is untrusted data (invariant 3): it passes through
// `printable` (the kernel's own escaping), nothing here builds markup, and the components
// render each value as a React text child.
//
// What lives here: the test ids, the held view and its parse, the health's words and
// tone, the token's life (365 days, as `TOKEN_LIFETIME_DAYS` in
// `kernel/src/auth/subscription-token.ts`), the band, the login item's honest note, and
// the feed events that make the screen read again.
import type { AppPreferences, SettingsResponse } from "../../api/contract";
import { printable } from "../approvals/printable";
import type { Reply } from "../schedules/model";

/** The ids the unit tests and the e2e spec target. */
export const SETTINGS_TEST_IDS = {
  screen: "screen-settings",
  toolbar: "settings-toolbar",
  lastKnown: "settings-last-known",
  band: "settings-band",
  notice: "settings-notice",
  loading: "settings-loading",
  error: "settings-error",
  errorDetail: "settings-error-detail",
  retry: "settings-retry",
  unknown: "settings-unknown",
  auth: "settings-auth",
  provider: "settings-provider",
  account: "settings-account",
  health: "settings-health",
  healthNote: "settings-health-note",
  tokenCreated: "settings-token-created",
  tokenLife: "settings-token-life",
  renewSoon: "settings-renew-soon",
  token: "settings-token",
  commands: "settings-commands",
  step: "settings-step",
  command: "settings-command",
  copy: "settings-copy",
  copied: "settings-copied",
  kernel: "settings-kernel",
  dataDir: "settings-data-dir",
  reveal: "settings-reveal",
  revealNote: "settings-reveal-note",
  notifier: "settings-notifier",
  loomwright: "settings-loomwright",
  app: "settings-app",
  prefsUnavailable: "settings-prefs-unavailable",
  prefsError: "settings-prefs-error",
  login: "settings-login",
  loginNote: "settings-login-note",
  notifications: "settings-notifications",
  themeGroup: "settings-theme",
  themeSystem: "settings-theme-system",
  themeLight: "settings-theme-light",
  themeDark: "settings-theme-dark",
  row: "settings-row",
} as const;

/** The Keychain item the subscription token is kept in (`SUBSCRIPTION_KEYCHAIN_SERVICE` in the kernel). A name, never a value. */
export const KEYCHAIN_ITEM = "loomwright-studio-oauth";

/** How long a subscription token lives, in days (`TOKEN_LIFETIME_DAYS` in the kernel). */
export const TOKEN_LIFETIME_DAYS = 365;

const DAY_MS = 86_400_000;

// ---- The held view ------------------------------------------------------------------------------------

/** The provider's health as the screen holds it: the contract's five states, or a word this build does not know, kept as inert text. */
export type HealthState =
  | { readonly status: "ok" }
  | { readonly status: "missing" }
  | { readonly status: "invalid_shape" }
  | { readonly status: "expiring"; readonly days: number }
  | { readonly status: "error"; readonly reason: string }
  | { readonly status: "unknown"; readonly word: string };

/** What the screen holds of `GET /settings`: the contract's known fields and nothing else, every string already inert. */
export interface SettingsView {
  readonly provider: {
    readonly id: string;
    readonly account: string | null;
    readonly health: HealthState;
    readonly tokenCreatedAt: string | null;
  };
  readonly dataDir: string;
  /** `terminal-notifier`, `osascript` or `none`; a word this build does not know is kept as inert text. */
  readonly notifier: string;
  readonly loomwright: { readonly ok: true; readonly installPath: string } | { readonly ok: false; readonly reason: string };
}

/** Kernel text as inert, single-line text. */
export function safe(text: string): string {
  return printable(text);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function healthOf(raw: unknown): HealthState | undefined {
  if (!isRecord(raw) || typeof raw.status !== "string") return undefined;
  switch (raw.status) {
    case "ok":
    case "missing":
    case "invalid_shape":
      return { status: raw.status };
    case "expiring":
      return typeof raw.days === "number" && Number.isFinite(raw.days) ? { status: "expiring", days: Math.trunc(raw.days) } : undefined;
    case "error":
      return { status: "error", reason: typeof raw.reason === "string" ? safe(raw.reason) : "unknown" };
    default:
      return { status: "unknown", word: safe(raw.status) };
  }
}

/**
 * The view of a `GET /settings` body, built field by field; `undefined` when the body is not the shape the
 * contract declares (so the screen says it could not understand the answer, never throws on it).
 */
export function parseSettings(body: unknown): SettingsView | undefined {
  if (!isRecord(body) || !isRecord(body.provider) || !isRecord(body.loomwright)) return undefined;
  const { provider, loomwright } = body;
  const health = healthOf(provider.health);
  if (typeof provider.id !== "string" || health === undefined || typeof body.data_dir !== "string") return undefined;
  if (provider.account !== null && typeof provider.account !== "string") return undefined;
  const created = provider.token_created_at;
  return {
    provider: {
      id: safe(provider.id),
      account: provider.account === null ? null : safe(provider.account as string),
      health,
      tokenCreatedAt: typeof created === "string" ? created : null,
    },
    dataDir: safe(body.data_dir),
    notifier: typeof body.notifier === "string" ? safe(body.notifier) : "none",
    loomwright:
      loomwright.status === "ok" && typeof loomwright.install_path === "string"
        ? { ok: true, installPath: safe(loomwright.install_path) }
        : { ok: false, reason: typeof loomwright.reason === "string" ? safe(loomwright.reason) : "unknown" },
  };
}

/** A `GET /settings` reply with its body turned into the view; a body that is not the contract's shape is a `failed` reply. */
export function viewReply(reply: Reply<SettingsResponse>): Reply<SettingsView> {
  if (reply.kind !== "ok") return reply;
  const view = parseSettings(reply.body);
  return view === undefined ? { kind: "failed", message: "the settings answer was not understood" } : { kind: "ok", status: reply.status, body: view };
}

// ---- Health -----------------------------------------------------------------------------------------

export type Tone = "ok" | "attention" | "danger" | "neutral";

export interface HealthView {
  /** The word beside the dot (`ok`, `missing`, `expiring`, `invalid_shape`, `error`). */
  readonly label: string;
  readonly tone: Tone;
  /** What the mockup says in caption beside it, or `undefined`. */
  readonly note: string | undefined;
}

export function daysLeftText(days: number): string {
  if (days < 0) return "expired";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** The dot's tone, the word and the caption beside it. Colour is never the only signal: the word is always there. */
export function healthView(health: HealthState): HealthView {
  switch (health.status) {
    case "ok":
      return { label: "ok", tone: "ok", note: undefined };
    case "missing":
      return { label: "missing", tone: "danger", note: "no token in the Keychain item" };
    case "expiring":
      return { label: "expiring", tone: "attention", note: daysLeftText(health.days) };
    case "invalid_shape":
      return { label: "invalid_shape", tone: "danger", note: "the Keychain item does not hold a whole token" };
    case "error":
      return { label: "error", tone: "danger", note: health.reason };
    default:
      return { label: health.word, tone: "neutral", note: undefined };
  }
}

// ---- The token's life -------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `4 May 2026`, in the owner's local day; `undefined` for an instant that is not a date. */
export function dateLabel(instant: string | Date): string | undefined {
  const at = typeof instant === "string" ? new Date(instant) : instant;
  if (!Number.isFinite(at.getTime())) return undefined;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

export interface TokenLife {
  /** The creation day, `4 May 2026`. */
  readonly created: string;
  /** The day the token ends, `created` plus 365 days. */
  readonly ends: string;
  /** Whole days left, floored as the kernel does; negative once the token is past its end. */
  readonly daysLeft: number;
  /** `365 days · 186 days left · ends 4 May 2027`. */
  readonly text: string;
}

/** The token's life from its creation instant, or `undefined` when the instant is not a date. */
export function tokenLife(createdAt: string, now: Date): TokenLife | undefined {
  const created = new Date(createdAt);
  const made = dateLabel(created);
  if (made === undefined || !Number.isFinite(now.getTime())) return undefined;
  const end = new Date(created.getTime() + TOKEN_LIFETIME_DAYS * DAY_MS);
  const ends = dateLabel(end) as string;
  const daysLeft = Math.floor((end.getTime() - now.getTime()) / DAY_MS);
  return { created: made, ends, daysLeft, text: `${TOKEN_LIFETIME_DAYS} days · ${daysLeftText(daysLeft)} · ${daysLeft < 0 ? "ended" : "ends"} ${ends}` };
}

// ---- The band, and the terminal commands' heading -------------------------------------------------------

export interface BandView {
  readonly tone: "attention" | "danger";
  /** `status` for a band that asks for attention, `alert` for one that says something is broken now. */
  readonly role: "status" | "alert";
  readonly text: string;
}

/** The band above the sections: the mockup's attention band for `expiring` and danger band for `missing`; also the same for a token that is not whole. */
export function bandOf(view: SettingsView, now: Date): BandView | undefined {
  const { health, tokenCreatedAt } = view.provider;
  if (health.status === "expiring") {
    const ends = tokenCreatedAt === null ? undefined : tokenLife(tokenCreatedAt, now)?.ends;
    const when = health.days < 0 ? "has expired" : `expires in ${health.days} ${health.days === 1 ? "day" : "days"}${ends === undefined ? "" : `, on ${ends}`}`;
    return { tone: "attention", role: "status", text: `The subscription token ${when}. Create a new one with the commands below, or sessions stop with failed:auth.` };
  }
  if (health.status === "missing") return { tone: "danger", role: "alert", text: "There is no token in the Keychain. Without one the crew can't start sessions." };
  if (health.status === "invalid_shape") return { tone: "danger", role: "alert", text: "The Keychain item does not hold a whole token. Without one the crew can't start sessions. Replace it with the commands below." };
  return undefined;
}

/** The terminal commands' section heading: set up when there is no token, change otherwise. */
export function commandsHeading(health: HealthState): string {
  return health.status === "missing" ? "Set it up in your terminal" : "Change it in your terminal";
}

/** Whether a token exists in the Keychain, so the creation date and life rows apply. */
export function hasToken(health: HealthState): boolean {
  return health.status !== "missing" && health.status !== "invalid_shape";
}

// ---- The app's own preferences ----------------------------------------------------------------------------

/**
 * What to say under "Launch at login" when the OS did not simply do what was asked: the OS's own `status`
 * (macOS 13+) when it needs the owner's approval or cannot find the item, or a refusal (`refused`: the toggle
 * was asked to change and the OS read-back says it did not). `undefined` when there is nothing to add.
 */
export function loginNote(launchAtLogin: AppPreferences["launchAtLogin"], refused: boolean): string | undefined {
  if (launchAtLogin.status === "requires-approval") return "Needs your approval: allow Loomwright Studio in System Settings, General, Login Items.";
  if (launchAtLogin.status === "not-found") return "macOS can't find this app's login item. An app that moved or was not installed can cause this.";
  if (refused) return "macOS did not change it. Check System Settings, General, Login Items.";
  return undefined;
}

export const LOGIN_DESCRIPTION = "Open Studio when you log in to this Mac.";
/** Says only what the switch does: it is the app's own preference, which the kernel's notifier does not read (a departure from the mockup's caption, recorded in the evidence README). */
export const NOTIFICATIONS_DESCRIPTION = "Kept as this app's own preference. The kernel's macOS notifications don't follow it yet.";
export const THEME_DESCRIPTION = "System follows your Mac.";
export const NOTIFIER_CAPTION = "terminal-notifier if installed, else osascript, else none";

// ---- Live: the feed's events that make the screen read again ----------------------------------------------

/**
 * The kinds that change what the screen shows: a provider's or the Loomwright adapter's state moved. A grep of
 * `kernel/src` on 2026-10-30 finds no event the kernel appends whose kind starts `auth_` or `loomwright_`; the
 * auth signals on the feed are `notify` events whose payload `reason` starts `auth_` (`auth_token_expiring` from
 * `kernel/src/auth/notify.ts`, `auth_failed` from `kernel/src/sessions/manager.ts`). Both are followed, so a
 * kernel that later names its own `auth_*` or `loomwright_*` kind needs no change here.
 */
export const SETTINGS_KIND_PREFIXES: readonly string[] = ["auth_", "loomwright_"];

/** Whether `event` is one the screen reads again for. */
export function isSettingsEvent(event: { readonly kind: string; readonly payload?: unknown }): boolean {
  if (SETTINGS_KIND_PREFIXES.some((prefix) => event.kind.startsWith(prefix))) return true;
  if (event.kind !== "notify" || !isRecord(event.payload)) return false;
  const reason = event.payload.reason;
  return typeof reason === "string" && SETTINGS_KIND_PREFIXES.some((prefix) => reason.startsWith(prefix));
}

/** The id of the newest event in the feed that makes the screen read again, 0 when none. */
export function newestSettingsEventId(eventLog: readonly { readonly id: number; readonly kind: string; readonly payload?: unknown }[]): number {
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const e = eventLog[i];
    if (e !== undefined && isSettingsEvent(e)) return e.id;
  }
  return 0;
}
