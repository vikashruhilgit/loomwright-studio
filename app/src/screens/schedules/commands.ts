// Schedules & triggers' ⌘K commands (phase 7 item 05, AC6): owner `schedules`, ids
// prefixed `schedules.`. `SchedulesScreen.tsx` registers them while it is mounted and
// unregisters them on unmount (the shell renders only the current screen), through the
// registry's own unregister. Each command calls the same handler as its control, so
// both reach the same route; the pattern is Integrations' (`../integrations/commands.ts`).
//
// The palette reads `enabled` when it opens, so the flags and handlers are passed as
// functions: the screen reads them through a ref its every render refreshes, and the
// commands are registered once, never again when the kernel's reachability changes.
//   Show missed fires   the mockup's palette entry: the history's "Not fired" filter. It changes
//                       what is shown of data already held, so it needs no kernel.
//   Refresh schedule    reads the schedule and the open trigger's history again; disabled while
//                       the kernel is unreachable.
import type { Command } from "../../commands/registry";

/** The registry owner every Schedules command is registered under. */
export const SCHEDULES_OWNER = "schedules";

/** The palette group Schedules' commands appear under (the mockup's "Every screen" actions group). */
export const SCHEDULES_GROUP = "Schedules";

/** What each command does: the same handlers the screen's controls call. */
export interface SchedulesCommandHandlers {
  /** Opens the history on the "Not fired" filter, on the open trigger (the first one when none is open). */
  readonly showMissed: () => void;
  readonly refresh: () => void | Promise<void>;
}

/** What decides `enabled`, read at the moment the palette asks. */
export interface SchedulesCommandFlags {
  /** The kernel cannot be asked right now. */
  readonly offline: boolean;
}

/** Schedules' commands over `flags` and `handlers` (both read when a command is asked, never captured). */
export function schedulesCommands(flags: () => SchedulesCommandFlags, handlers: () => SchedulesCommandHandlers): Command[] {
  return [
    {
      id: "schedules.show-missed",
      title: "Show missed fires",
      group: SCHEDULES_GROUP,
      keywords: ["not fired", "history", "paused", "kill switch", "trigger", "schedule"],
      run: () => handlers().showMissed(),
    },
    {
      id: "schedules.refresh",
      title: "Refresh schedule",
      group: SCHEDULES_GROUP,
      keywords: ["reload", "upcoming", "triggers", "history"],
      enabled: () => !flags().offline,
      run: () => handlers().refresh(),
    },
  ];
}
