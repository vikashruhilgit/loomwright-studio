// The menu bar's shared model (item 17): one definition of the kernel's
// at-a-glance state, the `loomwright-studio://` link grammar, the route the
// main process sends the renderer for a link, and the tray's e2e seam.
//
// Pure on purpose: no React, no DOM and no `electron` import, because the main
// process (`app/electron/tray.ts`, `app/electron/deeplink.ts`), the renderer
// (`app/src/screens/menubar/`) and the Playwright spec (plain Node) all import it.
import type { StatusBody } from "../../api/contract";

/** The kernel's state as the menu bar shows it. */
export type MenubarState = "idle" | "working" | "waiting" | "cap" | "paused" | "killed";

/**
 * The `StatusDot` state each menubar state renders as. A subset of
 * `StatusState` in `app/src/components/StatusDot/StatusDot.tsx`, restated here
 * because that module is React (the main process cannot load it).
 */
export type MenubarDotState = "idle" | "working" | "waiting" | "paused" | "failed";

/** The word for each state. */
export const MENUBAR_WORDS: Readonly<Record<MenubarState, string>> = Object.freeze({
  idle: "idle",
  working: "working",
  waiting: "waiting on you",
  cap: "paused at cap",
  paused: "paused",
  killed: "killed",
});

/** The dot each state renders as. The kill switch is a stop, not a park, so `killed` is `failed`. */
export const MENUBAR_DOTS: Readonly<Record<MenubarState, MenubarDotState>> = Object.freeze({
  idle: "idle",
  working: "working",
  waiting: "waiting",
  cap: "paused",
  paused: "paused",
  killed: "failed",
});

/** The rate-limit status the kernel records when an account is at its cap (`RATE_LIMIT_STATUSES` in `kernel/src/budget/cap.ts`). */
export const CAP_REJECTED_STATUS = "rejected";

/**
 * The state for `status` with `pendingApprovals` waiting. Precedence:
 * killed > paused > waiting > cap > working > idle.
 */
export function menubarState(status: StatusBody, pendingApprovals: number): MenubarState {
  if (status.kill_switch.engaged) return "killed";
  if (status.paused === true) return "paused";
  if (pendingApprovals > 0) return "waiting";
  if (status.cap_state.some((account) => account.limits.some((limit) => limit.status === CAP_REJECTED_STATUS))) return "cap";
  if (status.sessions.length > 0) return "working";
  return "idle";
}

// ---- Deep links ---------------------------------------------------------------------

/** The kernel's notification link prefix (`DEEP_LINK_PREFIX` in `kernel/src/notifications/record.ts`). */
export const DEEP_LINK_PREFIX = "loomwright-studio://notifications/";

/** A positive id of at most 16 digits, no leading zero (the kernel's row ids). */
const ID_PATTERN = "[1-9][0-9]{0,15}";

/**
 * The whole grammar: exactly the prefix and an id. No query, fragment,
 * credentials, port, trailing slash or extra segment, and no other host.
 */
const DEEP_LINK = new RegExp(`^${DEEP_LINK_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(${ID_PATTERN})$`);

export type DeepLink = { readonly kind: "notification"; readonly id: number } | { readonly kind: "invalid" };

/** Parses `url` through the closed grammar. A link is untrusted input: anything else is `invalid`. */
export function parseDeepLink(url: unknown): DeepLink {
  if (typeof url !== "string") return { kind: "invalid" };
  const match = DEEP_LINK.exec(url);
  const id = match === null ? Number.NaN : Number(match[1]);
  // 16 digits reach past 2^53: such an id cannot be named exactly, so it is not one.
  return Number.isSafeInteger(id) ? { kind: "notification", id } : { kind: "invalid" };
}

// ---- The route sent over `CHANNELS.navigate` ------------------------------------------

/** The route for a link the grammar refused. */
export const INVALID_LINK_ROUTE = "invalid-link";

/** The route for notification `id`. */
export function notificationRoute(id: number): string {
  return `notification/${id}`;
}

/** The only two routes the main process ever sends the renderer for a link. */
export function navigateRouteFor(link: DeepLink): string {
  return link.kind === "notification" ? notificationRoute(link.id) : INVALID_LINK_ROUTE;
}

export type NavigateRoute = { readonly kind: "notification"; readonly id: number } | { readonly kind: "invalid-link" };

const NOTIFICATION_ROUTE = new RegExp(`^notification/(${ID_PATTERN})$`);

/**
 * The renderer's side of `navigateRouteFor`. Anything that is not a
 * notification route, including a malformed one, reads as `invalid-link`.
 */
export function parseNavigateRoute(route: unknown): NavigateRoute {
  if (typeof route !== "string") return { kind: "invalid-link" };
  const match = NOTIFICATION_ROUTE.exec(route);
  const id = match === null ? Number.NaN : Number(match[1]);
  return Number.isSafeInteger(id) ? { kind: "notification", id } : { kind: "invalid-link" };
}

// ---- The tray's e2e seam ------------------------------------------------------------

/**
 * Set to "1" in an unpackaged run (the e2e harness) and the tray exposes its
 * model on `globalThis[TRAY_SEAM_GLOBAL]`, for `electronApp.evaluate`. A packaged
 * app never does.
 */
export const TRAY_SEAM_ENV = "STUDIO_APP_TRAY_SEAM";

/** The `globalThis` key the seam is set on. */
export const TRAY_SEAM_GLOBAL = "__studioTray";

/** The tray's menu items. `pause-all` and `unpause` are never both present. */
export type TrayItemId = "status" | "open" | "pause-all" | "unpause" | "kill-switch" | "resume" | "quit";

/** The tray's state: `unknown` until a `GET /status` answer has been read. */
export type TrayModelState = MenubarState | "unknown";

export interface TrayModelItem {
  readonly id: TrayItemId;
  readonly label: string;
  readonly enabled: boolean;
}

export interface TrayModel {
  readonly state: TrayModelState;
  /** Pending approvals, as last read. */
  readonly count: number;
  /** The text beside the icon: the count, empty at 0. */
  readonly title: string;
  readonly tooltip: string;
  readonly items: readonly TrayModelItem[];
}

export interface TraySeam {
  model(): TrayModel;
  /** Presses item `id` as the menu would; a missing or disabled item does nothing. Settles after the item's work and re-read. */
  click(id: string): Promise<void>;
}
