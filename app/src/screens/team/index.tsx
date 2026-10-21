// Team: a placeholder. Phase 5 item 14 builds it (the roster, and the
// 320px inspector, `--inspector-width`).
import type { ScreenDefinition } from "../types";

function TeamScreen() {
  return (
    <div className="placeholder" data-testid="screen-team">
      <p className="placeholder-title">Team</p>
      <p className="placeholder-note">Wright and your crew arrive here.</p>
    </div>
  );
}

export const screen: ScreenDefinition = {
  id: "team",
  title: "Team",
  nav: { label: "Team", order: 2, shortcut: "⌘2" },
  Component: TeamScreen,
};
