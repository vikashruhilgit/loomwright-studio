// The shell's screen list, handed down the tree. `App.tsx` discovers the screens (`import.meta.glob`) and
// provides them here, so a screen that must describe the others (the Keyboard map's "Go to a screen" table)
// reads them without importing `App.tsx` back (a cycle that would put `SCREENS` in its temporal dead zone
// whenever that screen's module is the first one loaded).
import { createContext, useContext } from "react";
import type { ScreenDefinition } from "../screens/types";

export const ScreensContext = createContext<readonly ScreenDefinition[]>([]);

/** Every screen the shell discovered, in `nav.order` (empty outside the shell). */
export function useScreens(): readonly ScreenDefinition[] {
  return useContext(ScreensContext);
}
