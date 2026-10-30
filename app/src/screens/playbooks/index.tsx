// Playbooks (phase 7): a placeholder until its screen item builds the real one. The
// shell discovers this module's `screen` (`import.meta.glob` in App.tsx); the
// item replaces `Component` and keeps the id, title and nav entry unless its
// mockup says otherwise.
import type { ScreenDefinition } from "../types";
import { ScreenPlaceholder } from "../placeholder";

function PlaybooksScreen() {
  return <ScreenPlaceholder id="playbooks" title="Playbooks" note="Every playbook Wright has written, with its runs and versions." />;
}

export const screen: ScreenDefinition = {
  id: "playbooks",
  title: "Playbooks",
  nav: { label: "Playbooks", order: 7, shortcut: "⌘7" },
  Component: PlaybooksScreen,
};
