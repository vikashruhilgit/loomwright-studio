// Playbooks (phase 7 item 04): every playbook, its runs and versions, and
// field-level edits, on ⌘7 after Tasks. The screen is `./PlaybooksScreen.tsx`; this
// module's one export is the screen the shell discovers (`import.meta.glob` in
// App.tsx).
import type { ScreenDefinition } from "../types";
import { PlaybooksScreen } from "./PlaybooksScreen";

export const screen: ScreenDefinition = {
  id: "playbooks",
  title: "Playbooks",
  nav: { label: "Playbooks", order: 7, shortcut: "⌘7" },
  Component: PlaybooksScreen,
};
