// The menu bar's status panel at `#/menubar` (item 17): the mockup's menu-bar
// dropdown (`docs/design/mockups/gui-v1.html`, `.mbmenu`) rendered in the
// window, from the kernel's own `GET /status` and `GET /approvals`:
//
// - the state's `StatusDot` and word (`./state.ts`, the same model the tray
//   uses), then "N running · N waiting on you";
// - Approvals with the pending count (-> `#/approvals`);
// - Pause all / Unpause, Kill switch… (the confirm, through the host) and
//   Resume, enabled by the same rules as the ⌘K commands (`actionEnabled`);
// - Recent: the newest `RECENT_LIMIT` notifications of `GET /notifications`
//   (the kernel's order, newest first), each with its title, its age and its
//   delivery status; opening a row (click, or arrow to it and Enter) hands
//   `notification/<id>` to the host's navigate queue, so the host makes the one
//   `GET /notifications/:id` and maps it through `./links.ts` exactly as for a
//   clicked `loomwright-studio://` link. The panel never maps a notification
//   itself. A failed list read is the section's own line: it never changes
//   the panel's state or its stale line, which read only status and approvals.
//   A row that arrives while the list is scrolled away from its top lands above
//   the view (the List's scroll anchoring keeps the rows on screen where they
//   were), so a "new above" hint floats over the list's top edge (no layout
//   shift); activating it, or scrolling to the top, shows the row and clears it;
// - one line saying Open and Quit live in the menu-bar icon's menu.
//
// The state shown is only what the kernel said: an action's answer never
// changes it; the next `GET /status` does. The shell renders the title bar's
// `<h1>` and, while the kernel is unreachable, its band above this panel.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NotificationRow, StatusBody, StudioBridge } from "../../api/contract";
import { CountPill } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { List } from "../../components/List/List";
import type { ListDataItem } from "../../components/List/List";
import { StatusDot } from "../../components/StatusDot/StatusDot";
import type { StatusState } from "../../components/StatusDot/StatusDot";
import { useResource } from "../../store/react";
import type { ResourceError } from "../../store/store";
import { printable } from "../approvals/printable";
import { actionEnabled, menubarActions, navigateQueue, useMenubarActions } from "./MenubarHost";
import type { KernelAction, MenubarActions, NavigateQueue } from "./MenubarHost";
import { CAP_REJECTED_STATUS, MENUBAR_DOTS, MENUBAR_WORDS, menubarState, notificationRoute } from "./state";
import type { MenubarState } from "./state";
import "./menubar.css";

/** The panel's one line about the items only the menu-bar icon has. */
export const TRAY_ONLY_NOTE = "Open and Quit are in the menu-bar icon's menu; quitting the app leaves the kernel running.";

export type PanelView = "no-bridge" | "loading" | "error" | MenubarState;

/** How many notifications Recent shows. The kernel's list answers up to 50 by default, so the cap is the panel's. */
export const RECENT_LIMIT = 20;

/** The hint's words for `count` rows that arrived above the view. */
export function newAboveText(count: number): string {
  return count === 1 ? "1 new notification above" : `${count} new notifications above`;
}

/** Recent's words when the kernel has no notification. */
export const RECENT_EMPTY_TEXT = "No notifications yet";

/** The kernel's closed set of delivery statuses (`NOTIFICATION_STATUSES` in `kernel/src/notifications/record.ts`, pinned by `kernel-mirror.test.ts`). */
export type DeliveryStatus = "pending" | "delivered" | "failed" | "unsupported";

/**
 * Each delivery status's dot; the status word is always the meta line and the
 * dot's accessible name. `failed` is a failure; `unsupported` (not posted, or
 * posted with no click action) is parked, not failed; `delivered` and
 * `pending` are at rest. Not `ok` for `delivered`: a verified `ok` puts
 * StatusDot's "· verified <time>" beside the dot, which pushes that row's
 * title out of line with every other row's in the List's status column.
 */
export const DELIVERY_DOTS: Readonly<Record<DeliveryStatus, StatusState>> = Object.freeze({
  pending: "idle",
  delivered: "idle",
  failed: "failed",
  unsupported: "paused",
});

function isDeliveryStatus(status: string): status is DeliveryStatus {
  return Object.hasOwn(DELIVERY_DOTS, status);
}

/** A notification's age at `now`: `just now`, `5m ago`, `3h ago`, `2d ago`; `—` for a value that is not a time. */
export function ageText(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  // A clock behind the kernel's reads as just now, never as a negative age.
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** One Recent row: the title as subject, the delivery status (and the kernel's detail) as meta, the age aside. Kernel text through `printable`. */
export function recentItem(row: NotificationRow, now: number): ListDataItem {
  const word = printable(row.delivery_status);
  return {
    kind: "data",
    key: String(row.id),
    status: isDeliveryStatus(row.delivery_status) ? DELIVERY_DOTS[row.delivery_status] : "idle",
    statusLabel: word,
    subject: printable(row.title),
    meta: row.delivery_detail === null || row.delivery_detail === "" ? word : `${word} · ${printable(row.delivery_detail)}`,
    aside: ageText(row.created_at, now),
  };
}

export interface MenubarPanelProps {
  /** Defaults to the window's one set of actions (the host renders their confirm and toasts). */
  readonly actions?: MenubarActions;
  /** Where an opened Recent row goes: defaults to the window's one queue, which the host drains (as for a clicked link). */
  readonly queue?: NavigateQueue;
}

/** The screen. Reads `window.api` defensively: the shell does not pass the bridge to screens. */
export function MenubarPanel({ actions = menubarActions, queue = navigateQueue }: MenubarPanelProps) {
  const api = (window as unknown as { api?: StudioBridge }).api;
  if (api === undefined) {
    return (
      <div className="menubar" data-testid="screen-menubar" data-state="no-bridge">
        <p className="menubar-note">This window has no connection to the kernel, so there is nothing to show.</p>
      </div>
    );
  }
  return <Panel api={api} actions={actions} queue={queue} />;
}

/** `HH:MM` in the owner's locale, or `undefined` for a value that is not a time. */
function clock(iso: string | null): string | undefined {
  if (iso === null) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** The earliest reset among the limits at their cap, as `HH:MM`. */
function capReset(status: StatusBody): string | undefined {
  let earliest: string | undefined;
  for (const account of status.cap_state)
    for (const limit of account.limits)
      if (limit.status === CAP_REJECTED_STATUS && limit.resets_at !== null && (earliest === undefined || limit.resets_at < earliest)) earliest = limit.resets_at;
  return earliest === undefined ? undefined : clock(earliest);
}

function errorText(error: ResourceError): string {
  if (error.kind === "not_connected") return "The kernel isn't answering, so its state can't be read until it is back.";
  if (error.kind === "bridge_failed") return "The request failed before it reached the kernel.";
  const message = typeof error.body.message === "string" ? `: ${printable(error.body.message)}` : "";
  return `The kernel refused the read (${error.status} ${printable(String(error.body.error))})${message}.`;
}

/** A clock that ticks every 30 s, so a row's age moves while the panel is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Recent section. Its read is its own: loading shows the List's skeleton
 * rows, a failed read its own line, and neither touches the panel's state.
 */
function Recent({ api, queue }: { readonly api: StudioBridge; readonly queue: NavigateQueue }) {
  const notifications = useResource("notifications", api);
  const now = useNow();
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** The row keys at the last commit; `null` before the first. An arrival into an empty list is never hinted (nothing was scrolled). */
  const prevKeysRef = useRef<readonly string[] | null>(null);
  /** How many rows arrived above the view since the list was last at its top. */
  const [unseen, setUnseen] = useState(0);
  const data = notifications?.data;
  const error = notifications?.error;
  const items = useMemo(() => (data?.notifications ?? []).slice(0, RECENT_LIMIT).map((row) => recentItem(row, now)), [data, now]);

  // Runs after the List's own layout effect (children first), so the anchoring has already moved `scrollTop`:
  // a list not at its top after rows were inserted above the old first row has those rows out of view.
  useLayoutEffect(() => {
    const keys = items.map((item) => item.key);
    const prev = prevKeysRef.current;
    prevKeysRef.current = keys;
    if (prev === null || prev.length === 0) return;
    const seen = new Set(prev);
    let arrived = 0;
    for (const key of keys) {
      if (seen.has(key)) break;
      arrived += 1;
    }
    const list = bodyRef.current?.querySelector<HTMLElement>(".menubar-recent-list");
    if (arrived > 0 && list !== null && list !== undefined && list.scrollTop > 0) setUnseen((count) => count + arrived);
  }, [items]);

  // Reaching the top, by the hint or by the owner's own scroll, shows every new row: the hint clears.
  // Scroll does not bubble, so the section listens in the capture phase.
  useEffect(() => {
    const section = sectionRef.current;
    if (section === null) return;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains("menubar-recent-list") || target.scrollTop > 0) return;
      // A hint that holds focus is about to go: focus the newest row, never <body>.
      if (document.activeElement?.closest(".menubar-recent-new") != null) target.querySelector<HTMLElement>('[role="option"]')?.focus({ preventScroll: true });
      setUnseen(0);
    };
    section.addEventListener("scroll", onScroll, true);
    return () => section.removeEventListener("scroll", onScroll, true);
  }, []);

  const showNewest = () => {
    const list = bodyRef.current?.querySelector<HTMLElement>(".menubar-recent-list");
    if (list === null || list === undefined || list.scrollTop <= 0) {
      // Already at the top: no scroll follows, so the hint clears here. It goes under focus: hand focus to the
      // newest row first, never to <body>. Nothing scrolled, so this commit cannot fight the List's anchoring.
      list?.querySelector<HTMLElement>('[role="option"]')?.focus({ preventScroll: true });
      setUnseen(0);
      return;
    }
    // No state change here: a commit before the List's own scroll handler re-measures its anchor would scroll
    // the rows straight back. The scroll this causes reaches the listener above, which clears the hint (and its
    // render is scheduled after this scroll event's dispatch, so the List's onScroll has measured by then).
    list.scrollTop = 0;
    // The hint is about to go under focus: hand focus to the newest row, never to <body>.
    list.querySelector<HTMLElement>('[role="option"]')?.focus({ preventScroll: true });
  };
  const hinted = Math.min(unseen, items.length);

  return (
    <section className="menubar-recent" aria-labelledby={headingId} data-testid="menubar-recent" ref={sectionRef}>
      <h3 className="menubar-heading" id={headingId}>
        Recent
      </h3>
      {data === undefined && error !== undefined ? (
        <p className="menubar-meta menubar-recent-line" role="status" data-testid="menubar-recent-error">
          Couldn't read the notifications. {errorText(error)}
        </p>
      ) : (
        <div className="menubar-recent-body" ref={bodyRef}>
          <List
            className="menubar-recent-list"
            label="Recent notifications, newest first"
            items={items}
            loading={data === undefined}
            emptyText={RECENT_EMPTY_TEXT}
            // The host's own path for a link: one GET /notifications/:id, then `linkTarget`. The queue drops the same
            // route again within ROUTE_DEDUPE_MS, so a second open of one row inside 2 s does nothing (the first navigated).
            onOpen={(item) => queue.receive(notificationRoute(Number(item.key)))}
          />
          {/* Over the list's top edge, so showing it moves no row; the live region is always there, so the arrival is announced. */}
          <div className="menubar-recent-new" aria-live="polite">
            {hinted > 0 ? (
              <Button variant="secondary" size="row" className="menubar-recent-new-button" data-testid="menubar-recent-new" onClick={showNewest}>
                {newAboveText(hinted)}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {data !== undefined && error !== undefined ? (
        <p className="menubar-meta menubar-recent-line" role="status" data-testid="menubar-recent-error">
          These are the last notifications the kernel listed; the latest read failed.
        </p>
      ) : null}
    </section>
  );
}

function Panel({ api, actions, queue }: { readonly api: StudioBridge; readonly actions: MenubarActions; readonly queue: NavigateQueue }) {
  const status = useResource("status", api);
  const approvals = useResource("approvals", api);
  const snapshot = useMenubarActions(actions);
  const headingId = useId();
  const cardRef = useRef<HTMLElement>(null);

  const data = status?.data;
  const pending = (approvals?.data?.approvals ?? []).filter((a) => a.status === "pending").length;
  const view: PanelView = data === undefined ? (status?.error === undefined ? "loading" : "error") : menubarState(data, pending);

  // An action can disable the button that holds focus (Kill switch… once killed, Resume once resumed):
  // hand focus to the next action still enabled (Kill switch… -> Resume, Resume -> Pause all), else the card,
  // never to <body>.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const focused = document.activeElement;
    if (card === null || !(focused instanceof HTMLButtonElement) || !focused.disabled || !card.contains(focused)) return;
    const buttons = [...card.querySelectorAll<HTMLButtonElement>("[data-action]")];
    const at = buttons.indexOf(focused);
    let next: HTMLButtonElement | undefined;
    for (let step = 1; step < buttons.length && next === undefined; step += 1) {
      const candidate = buttons[(at + step) % buttons.length];
      if (candidate !== undefined && !candidate.disabled) next = candidate;
    }
    (next ?? card).focus();
  });

  if (view === "loading" || view === "error") {
    return (
      <div className="menubar" data-testid="screen-menubar" data-state={view}>
        <section className="menubar-card" aria-labelledby={headingId} aria-busy={view === "loading" ? "true" : undefined} ref={cardRef} tabIndex={-1}>
          <h2 className="menubar-heading" id={headingId}>
            Kernel
          </h2>
          {view === "loading" ? (
            <div className="menubar-loading" data-testid="menubar-loading">
              <p className="menubar-meta">Reading the kernel's state…</p>
              <i className="menubar-skeleton" aria-hidden="true" />
              <i className="menubar-skeleton" aria-hidden="true" />
              <i className="menubar-skeleton" aria-hidden="true" />
            </div>
          ) : (
            <div className="menubar-error" data-testid="menubar-error">
              <p className="menubar-error-title">Couldn't read the kernel's state.</p>
              <p className="menubar-meta">{status?.error === undefined ? "" : errorText(status.error)}</p>
              <p className="menubar-meta">This panel updates on its own once the kernel answers.</p>
            </div>
          )}
          <hr className="menubar-rule" />
          <p className="menubar-note">{TRAY_ONLY_NOTE}</p>
        </section>
      </div>
    );
  }

  const paused = data?.paused === true;
  const running = data?.sessions.length ?? 0;
  const reset = view === "cap" && data !== undefined ? capReset(data) : undefined;
  // Either read failing means what is shown is the last state read, not a live one.
  const stale = data !== undefined && (status?.error !== undefined || approvals?.error !== undefined);
  const pauseAction: KernelAction = paused ? "unpause" : "pause-all";
  const press = (action: Exclude<KernelAction, "kill-switch">) => () => void actions.run(api, action);

  return (
    <div className="menubar" data-testid="screen-menubar" data-state={view}>
      <section className="menubar-card" aria-labelledby={headingId} ref={cardRef} tabIndex={-1}>
        <h2 className="menubar-heading" id={headingId}>
          Kernel
        </h2>
        <div className="menubar-status" data-testid="menubar-status">
          <StatusDot state={MENUBAR_DOTS[view]} label={MENUBAR_WORDS[view]} />
          <p className="menubar-meta" data-testid="menubar-meta">
            {running} running · {pending} waiting on you{reset === undefined ? "" : ` · resets ${reset}`}
          </p>
          {stale ? (
            <p className="menubar-meta" role="status" data-testid="menubar-stale">
              This is the last state the kernel reported; the latest read failed.
            </p>
          ) : null}
        </div>
        <hr className="menubar-rule" />
        <Button
          variant="ghost"
          className="menubar-item"
          onClick={() => {
            window.location.hash = "#/approvals";
          }}
        >
          Approvals
          {pending === 0 ? null : (
            <span className="menubar-pill">
              <CountPill count={pending} aria-label={`${pending} pending`} />
            </span>
          )}
        </Button>
        <hr className="menubar-rule" />
        <div className="menubar-actions" role="group" aria-label="Kernel actions">
          {/* One button that changes its word, so focus stays on it when the kernel says it is paused. */}
          <Button
            variant="ghost"
            className="menubar-item"
            data-action={pauseAction}
            disabled={!actionEnabled(data, pauseAction)}
            loading={snapshot.busy.has(pauseAction)}
            onClick={press(pauseAction === "unpause" ? "unpause" : "pause-all")}
          >
            {paused ? "Unpause" : "Pause all"}
          </Button>
          <Button
            variant="ghost"
            className="menubar-item"
            data-action="kill-switch"
            data-tone="danger"
            disabled={!actionEnabled(data, "kill-switch")}
            loading={snapshot.busy.has("kill-switch")}
            onClick={() => actions.askKill()}
          >
            Kill switch…
          </Button>
          <Button
            variant="ghost"
            className="menubar-item"
            data-action="resume"
            disabled={!actionEnabled(data, "resume")}
            loading={snapshot.busy.has("resume")}
            onClick={press("resume")}
          >
            Resume
          </Button>
        </div>
        {snapshot.lastFailure === undefined ? null : (
          <p className="menubar-failure" role="alert" data-testid="menubar-failure">
            {snapshot.lastFailure.text}
          </p>
        )}
        <hr className="menubar-rule" />
        <Recent api={api} queue={queue} />
        <hr className="menubar-rule" />
        <p className="menubar-note">{TRAY_ONLY_NOTE}</p>
      </section>
    </div>
  );
}
