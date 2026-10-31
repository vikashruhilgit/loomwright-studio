// Settings' ⌘K commands (phase 7 item 08, AC8): owner `settings`, ids prefixed
// `settings.`. `SettingsScreen.tsx` registers them while it is mounted and unregisters
// them on unmount (the shell renders only the current screen), through the registry's
// own unregister. Each command calls the same handler as its control, so both reach the
// same bridge call; the pattern is Schedules' (`../schedules/commands.ts`).
//
// The palette reads `enabled` when it opens, so the flags and handlers are passed as
// functions: the screen reads them through a ref its every render refreshes. A command's
// title is a plain string, so the two toggles' titles ("Turn launch at login on" or
// "off") are decided by the `state` the screen registers with; the screen registers
// again when a switch changes, so the palette always names the action it would take.
//   Theme: System | Light | Dark   the app's theme preference (the main process applies it)
//   Reveal the data folder in Finder   needs the kernel's data location on screen, so it is
//                                  disabled while the kernel is unreachable (as the button)
//   Turn launch at login on|off    the OS's login item (needs the preferences bridge)
//   Turn notifications on|off      the app's own notifications preference
import type { Command } from "../../commands/registry";
import type { ThemePreference } from "../../api/contract";

/** The registry owner every Settings command is registered under. */
export const SETTINGS_OWNER = "settings";

/** The palette group Settings' commands appear under. */
export const SETTINGS_GROUP = "Settings";

/** What each command does: the same handlers the screen's controls call. */
export interface SettingsCommandHandlers {
  readonly setTheme: (theme: ThemePreference) => void | Promise<void>;
  readonly reveal: () => void | Promise<void>;
  readonly toggleLogin: () => void | Promise<void>;
  readonly toggleNotifications: () => void | Promise<void>;
}

/** What decides `enabled`, read at the moment the palette asks. */
export interface SettingsCommandFlags {
  /** The kernel cannot be asked right now. */
  readonly offline: boolean;
  /** The preferences bridge answered (the app's own settings can be read and changed). */
  readonly prefsReady: boolean;
}

/** What the two toggles currently are (`undefined` before the preferences were read), for their titles. */
export interface SettingsToggleState {
  readonly launchAtLogin: boolean | undefined;
  readonly notifications: boolean | undefined;
}

const THEME_TITLES: readonly (readonly [ThemePreference, string])[] = [
  ["system", "Theme: System"],
  ["light", "Theme: Light"],
  ["dark", "Theme: Dark"],
];

/** The palette title of a toggle: it names the action it would take ("Turn launch at login off" while it is on). */
export function toggleTitle(what: string, on: boolean | undefined): string {
  return `Turn ${what} ${on === true ? "off" : "on"}`;
}

/** Settings' commands over `flags` and `handlers` (both read when a command is asked, never captured). */
export function settingsCommands(flags: () => SettingsCommandFlags, handlers: () => SettingsCommandHandlers, state: SettingsToggleState): Command[] {
  const prefs = (): boolean => flags().prefsReady;
  return [
    ...THEME_TITLES.map(
      ([theme, title]): Command => ({
        id: `settings.theme-${theme}`,
        title,
        group: SETTINGS_GROUP,
        keywords: ["appearance", "dark mode", "light mode", "colour", "color"],
        enabled: prefs,
        run: () => handlers().setTheme(theme),
      }),
    ),
    {
      id: "settings.reveal-data",
      title: "Reveal the data folder in Finder",
      group: SETTINGS_GROUP,
      keywords: ["data location", "folder", "directory", "finder", "open"],
      enabled: () => prefs() && !flags().offline,
      run: () => handlers().reveal(),
    },
    {
      id: "settings.toggle-login",
      title: toggleTitle("launch at login", state.launchAtLogin),
      group: SETTINGS_GROUP,
      keywords: ["startup", "login item", "open at login", "start with mac"],
      enabled: prefs,
      run: () => handlers().toggleLogin(),
    },
    {
      id: "settings.toggle-notifications",
      title: toggleTitle("notifications", state.notifications),
      group: SETTINGS_GROUP,
      keywords: ["notify", "alerts", "banner"],
      enabled: prefs,
      run: () => handlers().toggleNotifications(),
    },
  ];
}
