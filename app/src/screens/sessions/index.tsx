// Sessions (phase 5 item 16): every session the kernel lists, its output
// streaming, and Stop (⌘.), Kill and Abandon. The screen itself is
// `./SessionsScreen.tsx`; the shell discovers this module's `screen`.
import type { ScreenDefinition } from "../types";
import { SessionsScreen } from "./SessionsScreen";

export const screen: ScreenDefinition = {
  id: "sessions",
  title: "Sessions",
  nav: { label: "Sessions", order: 4, shortcut: "⌘4" },
  Component: SessionsScreen,
};
