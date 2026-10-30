// Schedules (phase 7): a placeholder until its screen item builds the real one. The
// shell discovers this module's `screen` (`import.meta.glob` in App.tsx); the
// item replaces `Component` and keeps the id, title and nav entry unless its
// mockup says otherwise.
import type { ScreenDefinition } from "../types";
import { ScreenPlaceholder } from "../placeholder";

function SchedulesScreen() {
  return <ScreenPlaceholder id="schedules" title="Schedules" note="Upcoming wake-ups, polls and cron jobs, and the trigger firing history." />;
}

export const screen: ScreenDefinition = {
  id: "schedules",
  title: "Schedules",
  nav: { label: "Schedules", order: 8, shortcut: "⌘8" },
  Component: SchedulesScreen,
};
