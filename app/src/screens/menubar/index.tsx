// The menu bar (phase 5 item 17), the window's side: the status panel at
// `#/menubar` (`./MenubarPanel.tsx`, the mockup's menu-bar dropdown) and the
// always-mounted host (`./MenubarHost.tsx`) that takes deep links from the
// main process, registers the Kernel ⌘K commands, and renders the kill confirm
// and the toasts. No sidebar entry: the shell pins exactly four, and the
// panel is reached by route. The native tray is `app/electron/tray.ts`; both
// read the shared model in `./state.ts`.
import type { ScreenDefinition } from "../types";
import { MenubarHost } from "./MenubarHost";
import { MenubarPanel } from "./MenubarPanel";

export const screen: ScreenDefinition = {
  id: "menubar",
  title: "Menu bar",
  Component: MenubarPanel,
  SidebarSection: MenubarHost,
};
