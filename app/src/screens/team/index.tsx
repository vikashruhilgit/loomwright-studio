// Team (phase 5 item 14): the roster of agent cards, the inspector, the New
// crew member charter form and Team's ⌘K commands. The view is `./TeamView.tsx`;
// this module's one export is the screen the shell discovers
// (`import.meta.glob("./screens/*/index.tsx")` in App.tsx).
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { ScreenDefinition } from "../types";
import { TeamView } from "./TeamView";

/**
 * The screen the shell mounts. The bridge is the preload's `window.api`; a
 * window with none (the shell rendered without a preload, as `App.test.tsx`
 * does) cannot reach a kernel, so it says so instead of starting a store.
 */
function TeamScreen() {
  const api = getBridge() as StudioBridge | undefined;
  if (api === undefined) {
    return (
      <div className="team-state" data-testid="screen-team">
        <p className="team-state-title">Team</p>
        <p className="team-state-note">This window has no connection to the kernel.</p>
      </div>
    );
  }
  return <TeamView api={api} />;
}

export const screen: ScreenDefinition = {
  id: "team",
  title: "Team",
  nav: { label: "Team", order: 2, shortcut: "⌘2" },
  Component: TeamScreen,
};
