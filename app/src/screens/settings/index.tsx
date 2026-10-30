// Settings (phase 7): a placeholder until its screen item builds the real one. The
// shell discovers this module's `screen` (`import.meta.glob` in App.tsx); the
// item replaces `Component` and keeps the id, title and nav entry unless its
// mockup says otherwise.
import type { ScreenDefinition } from "../types";
import { ScreenPlaceholder } from "../placeholder";

function SettingsScreen() {
  return <ScreenPlaceholder id="settings" title="Settings" note="The auth provider, data location, notifier and Loomwright install." />;
}

export const screen: ScreenDefinition = {
  id: "settings",
  title: "Settings",
  nav: { label: "Settings", order: 11, shortcut: "⌘," },
  Component: SettingsScreen,
};
