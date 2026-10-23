// The menu bar's always-mounted host (item 17): the shell renders every
// screen's `SidebarSection`, so this component lives for the window's whole
// life. It renders nothing inside the sidebar (no button: the shell pins
// exactly four); its toasts and the kill confirm render through portals to
// `document.body`. It does three things:
//
// 1. Deep links. The main process sends only `notification/<id>` or
//    `invalid-link` on `CHANNELS.navigate` (`app/electron/deeplink.ts`). This
//    module subscribes `window.api.onNavigate` when it is evaluated (screens
//    are eager-imported, so before the page's load event, and so before the
//    main process's `did-finish-load` re-send) and buffers routes in a queue
//    the mounted host drains. A route identical to the last one received
//    less than `ROUTE_DEDUPE_MS` earlier is dropped at the queue: the
//    cold-window delivery can bring one route twice. A link is navigation
//    only (invariant 3): its one possible request is `GET /notifications/:id`,
//    mapped through `./links.ts`, and `invalid-link` makes no request at all.
// 2. The ⌘K commands `menubar.pause-all`, `menubar.unpause`,
//    `menubar.kill-switch` and `menubar.resume` (group "Kernel"), enabled from
//    the kernel's own `GET /status`, unregistered on unmount.
// 3. The actions shared with the status panel (`./MenubarPanel.tsx`): one
//    request each, never an optimistic state (the panel and the commands
//    read `GET /status` again after the answer), and the kill switch only
//    from the confirm's own action.
//
// The shell hands screens no bridge, so the host reads `window.api` itself
// and renders nothing without one (`App.test.tsx` mounts it that way).
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ApiRequest, ApiResult, StatusBody, StudioBridge } from "../../api/contract";
import { commandRegistry } from "../../commands/registry";
import type { Command, CommandRegistry } from "../../commands/registry";
import { Dialog } from "../../components/Dialog/Dialog";
import { ToastStack } from "../../components/Toast/Toast";
import type { ToastItem } from "../../components/Toast/Toast";
import { liveStoreFor, useResource } from "../../store/react";
import { printable } from "../approvals/printable";
import { LINK_NOTHING_TITLE, linkTarget } from "./links";
import { INVALID_LINK_ROUTE, notificationRoute, parseNavigateRoute } from "./state";
import type { NavigateRoute } from "./state";

// ---- the navigate queue ------------------------------------------------------------------

/** A route identical to the last one received less than this many ms earlier is dropped. */
export const ROUTE_DEDUPE_MS = 2000;

export interface NavigateQueue {
  /** A route from the main process (untrusted until parsed: anything else reads as `invalid-link`). */
  receive(route: unknown): void;
  /** Takes every buffered route, oldest first. */
  drain(): NavigateRoute[];
  /** Called after each route that is buffered (never for a dropped repeat). */
  subscribe(listener: () => void): () => void;
  /** Listen to `api.onNavigate` (once per bridge; a new bridge replaces the old listener). */
  attach(api: StudioBridge): void;
}

export function createNavigateQueue(now: () => number = Date.now): NavigateQueue {
  const pending: NavigateRoute[] = [];
  const listeners = new Set<() => void>();
  let last: { readonly key: string; readonly at: number } | undefined;
  let attached: StudioBridge | undefined;
  let detach: (() => void) | undefined;
  const queue: NavigateQueue = {
    receive(route) {
      const parsed = parseNavigateRoute(route);
      const key = parsed.kind === "notification" ? notificationRoute(parsed.id) : INVALID_LINK_ROUTE;
      const at = now();
      // The cold-window delivery (deeplink.ts) can send one route twice: the repeat is dropped here.
      if (last !== undefined && last.key === key && at - last.at < ROUTE_DEDUPE_MS) return;
      last = { key, at };
      pending.push(parsed);
      for (const listener of [...listeners]) listener();
    },
    drain() {
      return pending.splice(0);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach(api) {
      if (attached === api) return;
      detach?.();
      attached = api;
      detach = api.onNavigate((route) => queue.receive(route));
    },
  };
  return queue;
}

/** The window's one queue, subscribed at module evaluation when the preload's bridge is there. */
export const navigateQueue: NavigateQueue = createNavigateQueue();
const bridgeAtLoad = typeof window === "undefined" ? undefined : (window as unknown as { api?: StudioBridge }).api;
if (bridgeAtLoad !== undefined) navigateQueue.attach(bridgeAtLoad);

// ---- the actions -------------------------------------------------------------------------

export type KernelAction = "pause-all" | "unpause" | "kill-switch" | "resume";

/** Each action's one request. */
export const ACTION_PATHS: Readonly<Record<KernelAction, "/pause" | "/unpause" | "/stop-all" | "/resume">> = Object.freeze({
  "pause-all": "/pause",
  unpause: "/unpause",
  "kill-switch": "/stop-all",
  resume: "/resume",
});

const ACTION_NAMES: Readonly<Record<KernelAction, string>> = Object.freeze({
  "pause-all": "Pause all",
  unpause: "Unpause",
  "kill-switch": "The kill switch",
  resume: "Resume",
});

/** Whether `action` can run on the kernel `status` describes. Nothing runs before the kernel has answered. */
export function actionEnabled(status: StatusBody | undefined, action: KernelAction): boolean {
  if (status === undefined) return false;
  const paused = status.paused === true;
  const killed = status.kill_switch.engaged;
  switch (action) {
    case "pause-all":
      return !paused;
    case "unpause":
      return paused;
    case "resume":
      return killed || paused;
    case "kill-switch":
      return !killed;
  }
}

export interface MenubarActionsSnapshot {
  /** The actions whose request is in flight. */
  readonly busy: ReadonlySet<KernelAction>;
  /** The kill confirm is open. */
  readonly confirmingKill: boolean;
  /** Oldest first. */
  readonly toasts: readonly ToastItem[];
  /**
   * The last action that did not go through, kept until a later action goes
   * through or a `GET /status` answer shows its goal reached. The toast closes
   * on its own; this does not, so a kill switch that did not engage stays said.
   */
  readonly lastFailure: { readonly action: KernelAction; readonly text: string } | undefined;
}

/** Whether `status` already shows what `action` asked for (so its earlier failure no longer applies). */
export function actionReached(status: StatusBody, action: KernelAction): boolean {
  const paused = status.paused === true;
  const killed = status.kill_switch.engaged;
  switch (action) {
    case "pause-all":
      return paused;
    case "unpause":
      return !paused;
    case "resume":
      return !paused && !killed;
    case "kill-switch":
      return killed;
  }
}

export interface MenubarActions {
  getSnapshot(): MenubarActionsSnapshot;
  subscribe(listener: () => void): () => void;
  /** Sends `action`'s one request; a second press while it is in flight sends nothing. */
  run(api: StudioBridge, action: Exclude<KernelAction, "kill-switch">): Promise<void>;
  /** Opens the kill confirm. Nothing is sent. */
  askKill(): void;
  /** Closes the kill confirm. Nothing is sent. */
  cancelKill(): void;
  /** The confirm's own action: closes it and sends exactly one `POST /stop-all`. */
  confirmKill(api: StudioBridge): Promise<void>;
  toast(item: Omit<ToastItem, "id">): void;
  dismiss(id: string): void;
  /** A new `GET /status` answer: clears `lastFailure` when the answer shows its action's goal reached. */
  observeStatus(status: StatusBody | undefined): void;
}

/** A refusal's words, escaped: the kernel's `message` when it gave one, else its code. Never a body otherwise. */
function failureText(result: ApiResult<unknown> | undefined): string {
  if (result === undefined) return "The request failed before it reached the kernel; nothing changed.";
  if (result.ok) return "";
  if ("connection" in result) return "Couldn't reach the kernel; nothing changed.";
  const message = typeof result.body.message === "string" ? printable(result.body.message) : undefined;
  return message ?? `The kernel refused (${printable(String(result.body.error))}); nothing changed.`;
}

async function request(api: StudioBridge, req: ApiRequest): Promise<ApiResult<unknown> | undefined> {
  try {
    return await api.request<unknown>(req);
  } catch {
    return undefined;
  }
}

export function createMenubarActions(): MenubarActions {
  let snapshot: MenubarActionsSnapshot = { busy: new Set(), confirmingKill: false, toasts: [], lastFailure: undefined };
  const listeners = new Set<() => void>();
  let toastId = 0;
  const set = (next: Partial<MenubarActionsSnapshot>): void => {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  };

  const actions: MenubarActions = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run(api, action) {
      await send(api, action);
    },
    askKill() {
      if (snapshot.confirmingKill || snapshot.busy.has("kill-switch")) return;
      set({ confirmingKill: true });
    },
    cancelKill() {
      if (snapshot.confirmingKill) set({ confirmingKill: false });
    },
    async confirmKill(api) {
      if (!snapshot.confirmingKill) return;
      set({ confirmingKill: false });
      await send(api, "kill-switch");
    },
    toast(item) {
      toastId += 1;
      set({ toasts: [...snapshot.toasts, { ...item, id: `menubar-${toastId}` }] });
    },
    dismiss(id) {
      if (snapshot.toasts.some((t) => t.id === id)) set({ toasts: snapshot.toasts.filter((t) => t.id !== id) });
    },
    observeStatus(status) {
      const failed = snapshot.lastFailure;
      if (failed !== undefined && status !== undefined && actionReached(status, failed.action)) set({ lastFailure: undefined });
    },
  };

  /** One request; its answer only asks for `GET /status` again (never an optimistic state). */
  async function send(api: StudioBridge, action: KernelAction): Promise<void> {
    if (snapshot.busy.has(action)) return;
    set({ busy: new Set(snapshot.busy).add(action) });
    const result = await request(api, { method: "POST", path: ACTION_PATHS[action] });
    const busy = new Set(snapshot.busy);
    busy.delete(action);
    set({ busy });
    if (result?.ok !== true) {
      const text = failureText(result);
      set({ lastFailure: { action, text: `${ACTION_NAMES[action]} didn't go through. ${text}` } });
      actions.toast({ status: { state: "failed", label: "not done" }, title: `${ACTION_NAMES[action]} didn't go through.`, body: text });
    } else if (snapshot.lastFailure !== undefined) {
      set({ lastFailure: undefined });
    }
    liveStoreFor(api).refetch("status");
  }

  return actions;
}

/** The window's one set of actions, shared by the host, the panel and the commands. */
export const menubarActions: MenubarActions = createMenubarActions();

export function useMenubarActions(actions: MenubarActions): MenubarActionsSnapshot {
  return useSyncExternalStore(actions.subscribe, actions.getSnapshot);
}

/** The kill confirm's words. */
export const KILL_CONFIRM = Object.freeze({
  title: "Engage the kill switch?",
  action: "Engage kill switch",
});

// ---- the commands ------------------------------------------------------------------------

/** The registry owner and the palette group. */
export const MENUBAR_OWNER = "menubar";
export const MENUBAR_GROUP = "Kernel";

export const MENUBAR_COMMANDS: Readonly<Record<KernelAction, string>> = Object.freeze({
  "pause-all": "menubar.pause-all",
  unpause: "menubar.unpause",
  "kill-switch": "menubar.kill-switch",
  resume: "menubar.resume",
});

const COMMAND_TITLES: Readonly<Record<KernelAction, string>> = Object.freeze({
  "pause-all": "Pause all",
  unpause: "Unpause",
  "kill-switch": "Kill switch…",
  resume: "Resume",
});

const COMMAND_KEYWORDS: Readonly<Record<KernelAction, readonly string[]>> = Object.freeze({
  "pause-all": ["pause", "park", "stop new work"],
  unpause: ["unpause", "continue"],
  "kill-switch": ["kill", "stop all", "emergency"],
  resume: ["resume", "release", "unpause"],
});

function menubarCommands(api: StudioBridge, actions: MenubarActions, status: () => StatusBody | undefined): Command[] {
  const order: readonly KernelAction[] = ["pause-all", "unpause", "kill-switch", "resume"];
  return order.map((action) => ({
    id: MENUBAR_COMMANDS[action],
    title: COMMAND_TITLES[action],
    group: MENUBAR_GROUP,
    keywords: COMMAND_KEYWORDS[action],
    enabled: () => actionEnabled(status(), action),
    run: () => {
      if (!actionEnabled(status(), action)) return;
      if (action === "kill-switch") actions.askKill();
      else void actions.run(api, action);
    },
  }));
}

// ---- the host ----------------------------------------------------------------------------

const LINK_TOAST: Omit<ToastItem, "id"> = {
  status: { state: "idle", label: "nothing opened" },
  title: LINK_NOTHING_TITLE,
};

/** Navigate to `hash`; the same hash again still tells the screen (Approvals re-selects its id). */
function openHash(hash: string): void {
  if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else window.location.hash = hash;
}

export interface MenubarHostProps {
  /** Defaults to `window.api`; with neither, the host renders nothing. */
  readonly api?: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
  /** Defaults to the window's one queue. */
  readonly queue?: NavigateQueue;
  /** Defaults to the window's one set of actions. */
  readonly actions?: MenubarActions;
}

export function MenubarHost({ api: apiProp, registry = commandRegistry, queue = navigateQueue, actions = menubarActions }: MenubarHostProps) {
  const api = apiProp ?? (window as unknown as { api?: StudioBridge }).api;
  if (api === undefined) return null;
  return <Host api={api} registry={registry} queue={queue} actions={actions} />;
}

interface HostProps {
  readonly api: StudioBridge;
  readonly registry: CommandRegistry;
  readonly queue: NavigateQueue;
  readonly actions: MenubarActions;
}

function Host({ api, registry, queue, actions }: HostProps) {
  const status = useResource("status", api);
  const snapshot = useMenubarActions(actions);
  const latestStatus = useRef<StatusBody | undefined>(status?.data);
  useLayoutEffect(() => {
    latestStatus.current = status?.data;
  });
  // A new status answer can show a failed action's goal reached (the tray or a terminal did it): its failure line goes.
  const statusData = status?.data;
  useEffect(() => {
    actions.observeStatus(statusData);
  }, [statusData, actions]);

  // ---- links ----
  const mounted = useRef(false);
  /** Only the newest notification link navigates: an older one answering late is dropped. */
  const linkSeq = useRef(0);
  useEffect(() => {
    mounted.current = true;
    queue.attach(api);
    const handle = async (route: NavigateRoute): Promise<void> => {
      if (route.kind === "invalid-link") {
        actions.toast(LINK_TOAST);
        return;
      }
      linkSeq.current += 1;
      const mine = linkSeq.current;
      const result = await request(api, { method: "GET", path: "/notifications/:id", params: { id: route.id } });
      if (!mounted.current || mine !== linkSeq.current) return;
      const target = linkTarget(result);
      if (target.kind === "open") openHash(target.hash);
      else if (target.kind === "nothing") actions.toast(LINK_TOAST);
    };
    const drain = (): void => {
      for (const route of queue.drain()) void handle(route);
    };
    const off = queue.subscribe(drain);
    // Routes buffered before this mount (the launch link).
    drain();
    return () => {
      mounted.current = false;
      off();
    };
  }, [api, queue, actions]);

  // ---- commands ----
  useEffect(() => registry.register(MENUBAR_OWNER, menubarCommands(api, actions, () => latestStatus.current)), [registry, api, actions]);

  // ---- the kill confirm ----
  // A destructive confirm ignores Escape in `Dialog`; this one is dismissable by keyboard (AC7): Escape cancels, nothing is sent.
  useEffect(() => {
    if (!snapshot.confirmingKill) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") actions.cancelKill();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snapshot.confirmingKill, actions]);

  const running = status?.data?.sessions.length ?? 0;
  return (
    <>
      <Dialog
        kind="confirm"
        open={snapshot.confirmingKill}
        title={KILL_CONFIRM.title}
        description={
          <>
            Every running session is stopped ({running === 1 ? "1 is running now" : `${running} are running now`}) and no new work starts until you choose
            Resume. The kernel itself keeps running.
          </>
        }
        action={{ label: KILL_CONFIRM.action, onAction: () => void actions.confirmKill(api) }}
        onCancel={actions.cancelKill}
      />
      {createPortal(<ToastStack toasts={snapshot.toasts} onDismiss={actions.dismiss} />, document.body)}
    </>
  );
}
