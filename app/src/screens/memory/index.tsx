// Memory (phase 7): a placeholder until its screen item builds the real one. The
// shell discovers this module's `screen` (`import.meta.glob` in App.tsx); the
// item replaces `Component` and keeps the id, title and nav entry unless its
// mockup says otherwise.
import type { ScreenDefinition } from "../types";
import { ScreenPlaceholder } from "../placeholder";

function MemoryScreen() {
  return <ScreenPlaceholder id="memory" title="Memory" note="Each agent's memory files and the shared memory, to read and edit." />;
}

export const screen: ScreenDefinition = {
  id: "memory",
  title: "Memory",
  nav: { label: "Memory", order: 9, shortcut: "⌘9" },
  Component: MemoryScreen,
};
