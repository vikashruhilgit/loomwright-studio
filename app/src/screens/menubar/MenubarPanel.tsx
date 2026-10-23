// The menu bar's status panel at `#/menubar` (item 17): the mockup's menu-bar
// dropdown (`docs/design/mockups/gui-v1.html`, `.mbmenu`) rendered in the
// window, from the kernel's own `GET /status` and `GET /approvals`:
//
// - the state's `StatusDot` and word (`./state.ts`, the same model the tray
//   uses), then "N running · N waiting on you";
// - Approvals with the pending count (-> `#/approvals`);
// - Pause all / Unpause, Kill switch… (the confirm, through the host) and
//   Resume, enabled by the same rules as the ⌘K commands (`actionEnabled`);
// - one line saying Open and Quit live in the menu-bar icon's menu.
//
// The state shown is only what the kernel said: an action's answer never
// changes it; the next `GET /status` does. The shell renders the title bar's
// `<h1>` and, while the kernel is unreachable, its band above this panel.
import { useId, useLayoutEffect, useRef } from "react";
import type { StatusBody, StudioBridge } from "../../api/contract";
import { CountPill } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { StatusDot } from "../../components/StatusDot/StatusDot";
import { useResource } from "../../store/react";
import type { ResourceError } from "../../store/store";
import { printable } from "../approvals/printable";
import { actionEnabled, menubarActions, useMenubarActions } from "./MenubarHost";
import type { KernelAction, MenubarActions } from "./MenubarHost";
import { CAP_REJECTED_STATUS, MENUBAR_DOTS, MENUBAR_WORDS, menubarState } from "./state";
import type { MenubarState } from "./state";
import "./menubar.css";

/** The panel's one line about the items only the menu-bar icon has. */
export const TRAY_ONLY_NOTE = "Open and Quit are in the menu-bar icon's menu; quitting the app leaves the kernel running.";

export type PanelView = "no-bridge" | "loading" | "error" | MenubarState;

export interface MenubarPanelProps {
  /** Defaults to the window's one set of actions (the host renders their confirm and toasts). */
  readonly actions?: MenubarActions;
}

/** The screen. Reads `window.api` defensively: the shell does not pass the bridge to screens. */
export function MenubarPanel({ actions = menubarActions }: MenubarPanelProps) {
  const api = (window as unknown as { api?: StudioBridge }).api;
  if (api === undefined) {
    return (
      <div className="menubar" data-testid="screen-menubar" data-state="no-bridge">
        <p className="menubar-note">This window has no connection to the kernel, so there is nothing to show.</p>
      </div>
    );
  }
  return <Panel api={api} actions={actions} />;
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

function Panel({ api, actions }: { readonly api: StudioBridge; readonly actions: MenubarActions }) {
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
        <p className="menubar-note">{TRAY_ONLY_NOTE}</p>
      </section>
    </div>
  );
}
