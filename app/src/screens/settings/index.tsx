// Settings (phase 7 item 08): the auth provider read-only with its health and the terminal
// commands that change it, the data location with Reveal in Finder, the notifier and the
// Loomwright install, and the app's own preferences (launch at login, notifications,
// theme), on ⌘,. The screen is `./SettingsScreen.tsx`; this module's one export is the
// screen the shell discovers (`import.meta.glob("./screens/*/index.tsx")` in App.tsx). The
// id, title and nav entry are the placeholder's, unchanged.
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { ScreenDefinition } from "../types";
import { SETTINGS_TEST_IDS } from "./model";
import { SettingsScreen } from "./SettingsScreen";
import "./settings.css";

/**
 * The screen the shell mounts. The bridge is the preload's `window.api`; a window with
 * none (the shell rendered without a preload) can reach neither the kernel nor the app's
 * preferences, so it says so instead of starting a store. The shell draws the one `h1`,
 * so neither branch renders one.
 */
function SettingsRoute() {
  const api = getBridge() as StudioBridge | undefined;
  if (api === undefined) {
    return (
      <div className="settings-state" data-testid={SETTINGS_TEST_IDS.screen}>
        <p className="settings-state-title">Settings</p>
        <p className="settings-state-note">This window has no connection to the kernel.</p>
      </div>
    );
  }
  return <SettingsScreen api={api} />;
}

export const screen: ScreenDefinition = {
  id: "settings",
  title: "Settings",
  nav: { label: "Settings", order: 11, shortcut: "⌘," },
  Component: SettingsRoute,
};
