// Sessions: a placeholder. Phase 5 item 16 builds it (the 360px list pane,
// `--list-pane-width`, and each session's live output log).
import type { ScreenDefinition } from "../types";

function SessionsScreen() {
  return (
    <div className="placeholder" data-testid="screen-sessions">
      <p className="placeholder-title">Sessions</p>
      <p className="placeholder-note">Running and finished sessions arrive here.</p>
    </div>
  );
}

export const screen: ScreenDefinition = {
  id: "sessions",
  title: "Sessions",
  nav: { label: "Sessions", order: 4, shortcut: "⌘4" },
  Component: SessionsScreen,
};
