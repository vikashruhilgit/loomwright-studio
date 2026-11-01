// Settings' title-bar subtitle (phase 7 item 18), as the mockup's `settingsScreen` sets `R.sub`: "last known"
// while the kernel cannot be asked and the screen holds a view, nothing otherwise. The shell draws it beside
// the title (`ScreenDefinition.Subtitle`); the sections themselves carry no such mark.
//
// "Offline" is the shell's `KernelReach.offline` (`../../shell/last-known.ts`). In the moment a status 0 read
// lands before the feed notices, the sections are offline while this is still empty; that is expected.
import { useCallback, useSyncExternalStore } from "react";
import { getBridge } from "../../api/bridge";
import type { StudioBridge } from "../../api/contract";
import { LAST_KNOWN, useKernelReach } from "../../shell/last-known";
import { getLastView, subscribeLastView } from "./lastKnown";

/** The subtitle for `api`: "last known" while offline with a remembered view, else nothing. */
export function SettingsSubtitleView({ api }: { readonly api: StudioBridge }) {
  const { offline } = useKernelReach(api);
  const subscribe = useCallback((listener: () => void) => subscribeLastView(api, listener), [api]);
  const held = useSyncExternalStore(subscribe, () => getLastView(api)) !== undefined;
  return offline && held ? <>{LAST_KNOWN}</> : null;
}

/** What the shell mounts: nothing in a window with no bridge. */
export function SettingsSubtitle() {
  const api = getBridge() as StudioBridge | undefined;
  return api === undefined ? null : <SettingsSubtitleView api={api} />;
}
