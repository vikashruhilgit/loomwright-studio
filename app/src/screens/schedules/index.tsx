// Schedules & triggers (phase 7 item 05): the upcoming timeline, the trigger list with
// its on/off switches and each trigger's firing history, on ⌘8. The screen is
// `./SchedulesScreen.tsx`; this module's one export is the screen the shell
// discovers (`import.meta.glob("./screens/*/index.tsx")` in App.tsx). The sidebar
// label stays "Schedules" (the mockup's sidebar says "Schedules & triggers"; the
// title bar, which is this `title`, carries the full name).
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { ScreenDefinition } from "../types";
import { SCHEDULES_TEST_IDS } from "./model";
import { SchedulesScreen } from "./SchedulesScreen";
import "./schedules.css";

/**
 * The screen the shell mounts. The bridge is the preload's `window.api`; a
 * window with none (the shell rendered without a preload, as `App.test.tsx`
 * does) cannot reach a kernel, so it says so instead of starting a store. The
 * shell draws the one `h1`, so neither branch renders one.
 */
function SchedulesRoute() {
  const api = getBridge() as StudioBridge | undefined;
  if (api === undefined) {
    return (
      <div className="schedules-state" data-testid={SCHEDULES_TEST_IDS.screen}>
        <p className="schedules-state-title">Schedules &amp; triggers</p>
        <p className="schedules-state-note">This window has no connection to the kernel.</p>
      </div>
    );
  }
  return <SchedulesScreen api={api} />;
}

export const screen: ScreenDefinition = {
  id: "schedules",
  title: "Schedules & triggers",
  nav: { label: "Schedules", order: 8, shortcut: "⌘8" },
  Component: SchedulesRoute,
};
