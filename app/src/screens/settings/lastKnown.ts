// The last `ok` Settings view, kept across a remount (phase 7 item 18). The shell mounts only the current
// screen, so leaving Settings and coming back while the kernel is down starts a new `useSettingsRead` with
// nothing to show: the first read answers status 0 and the screen would say "Status unknown" over data it
// held a moment ago. This module remembers the last view per bridge (a window has one), so the new mount
// starts from it (`useSettings.ts`) and the title bar's subtitle can tell that there is a view to mark "last
// known" (`SettingsSubtitle.tsx`).
//
// It only seeds `lastOk`; a mount still reads, and the answer replaces the view. No React here: the store has
// `get`/`set`/`subscribe` for `useSyncExternalStore`.
import type { StudioBridge } from "../../api/contract";
import type { SettingsView } from "./model";

let views = new WeakMap<StudioBridge, SettingsView>();
const listeners = new WeakMap<StudioBridge, Set<() => void>>();

/** The last `ok` view read through `api`, or `undefined` when none was. */
export function getLastView(api: StudioBridge): SettingsView | undefined {
  return views.get(api);
}

/** Remember `view` as the last `ok` one read through `api`, and tell whoever watches. */
export function setLastView(api: StudioBridge, view: SettingsView): void {
  views.set(api, view);
  for (const listener of [...(listeners.get(api) ?? [])]) listener();
}

/** Call `listener` whenever the view for `api` is set; returns the way to stop. */
export function subscribeLastView(api: StudioBridge, listener: () => void): () => void {
  let set = listeners.get(api);
  if (set === undefined) {
    set = new Set();
    listeners.set(api, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

/** Forget every remembered view. For a test that reuses a bridge; the app never calls it. */
export function resetLastViews(): void {
  views = new WeakMap();
}
