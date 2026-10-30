// Memory (phase 7 item 06): each agent's memory files and the shared memory, to read and
// edit, on ⌘9. The screen is `./MemoryScreen.tsx`; this module's one export is the screen the
// shell discovers (`import.meta.glob("./screens/*/index.tsx")` in App.tsx).
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { ScreenDefinition } from "../types";
import { MemoryScreen } from "./MemoryScreen";
import { MemoryNoKernel } from "./MemoryViews";

/**
 * The screen the shell mounts. The bridge is the preload's `window.api`; a window with none
 * (the shell rendered without a preload, as `App.test.tsx` does) cannot reach a kernel, so it
 * says so instead of starting a store. The shell draws the one `h1`, so neither branch renders one.
 */
function MemoryRoute() {
  const api = getBridge() as StudioBridge | undefined;
  if (api === undefined) return <MemoryNoKernel />;
  return <MemoryScreen api={api} />;
}

export const screen: ScreenDefinition = {
  id: "memory",
  title: "Memory",
  nav: { label: "Memory", order: 9, shortcut: "⌘9" },
  Component: MemoryRoute,
};
