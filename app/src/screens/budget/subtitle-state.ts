// The one holder between Budget & audit's screen and its title-bar subtitle (phase 7 item 17). The shell draws
// `ScreenDefinition.Subtitle` in the title bar, outside the screen's own tree and without props, so the screen
// publishes what the line says here and `./Subtitle.tsx` reads it. One read feeds both: the subtitle never asks
// the kernel itself. The screen clears it when it unmounts, so a window with no budget screen has no subtitle.
import { useSyncExternalStore } from "react";

/** What the title bar's line says: the overview's count of today's tokens, or the audit view's name. */
export interface SubtitleState {
  readonly view: "overview" | "audit";
  /** Today's counted tokens; `null` on the audit view. */
  readonly todayTokens: number | null;
  /** The figure is from before the kernel went away. */
  readonly lastKnown: boolean;
}

let current: SubtitleState | null = null;
const listeners = new Set<() => void>();

function same(a: SubtitleState | null, b: SubtitleState | null): boolean {
  return a === b || (a !== null && b !== null && a.view === b.view && a.todayTokens === b.todayTokens && a.lastKnown === b.lastKnown);
}

/** Publish the subtitle's state (`null`: nothing to say). Listeners run only when it changed. */
export function setSubtitleState(next: SubtitleState | null): void {
  if (same(current, next)) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The published state; `null` when no budget screen is mounted. Safe anywhere: it reads no bridge. */
export function useSubtitleState(): SubtitleState | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
