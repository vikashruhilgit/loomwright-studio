// Tasks (phase 7): a placeholder until its screen item builds the real one. The
// shell discovers this module's `screen` (`import.meta.glob` in App.tsx); the
// item replaces `Component` and keeps the id, title and nav entry unless its
// mockup says otherwise.
import type { ScreenDefinition } from "../types";
import { ScreenPlaceholder } from "../placeholder";

function TasksScreen() {
  return <ScreenPlaceholder id="tasks" title="Tasks" note="A board of tasks grouped by state, with their history and session logs." />;
}

export const screen: ScreenDefinition = {
  id: "tasks",
  title: "Tasks",
  nav: { label: "Tasks", order: 6, shortcut: "⌘6" },
  Component: TasksScreen,
};
