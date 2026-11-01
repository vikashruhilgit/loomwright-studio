// The Tasks screen's count line, for the shell's title bar (`ScreenDefinition.Subtitle`). The title bar renders
// `<Subtitle />` with no props, so the screen, which knows the line, writes it here and `Subtitle` reads it.
//
// A tiny external store: one string, a set of listeners. The screen sets the line while it is mounted and clears
// it when it leaves, so the title bar never shows a count from a screen that is gone.
import { useSyncExternalStore } from "react";

let line = "";
const listeners = new Set<() => void>();

/** The line the title bar shows now. */
export function subtitleLine(): string {
  return line;
}

/** Sets the line (an empty string shows nothing beside the title). Listeners run only when it changed. */
export function setSubtitleLine(next: string): void {
  if (next === line) return;
  line = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The line, live. */
export function useSubtitleLine(): string {
  return useSyncExternalStore(subscribe, subtitleLine, subtitleLine);
}
