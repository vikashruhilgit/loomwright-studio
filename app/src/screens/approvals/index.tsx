// Approvals: a placeholder. Phase 5 item 15 builds it (the 360px list pane,
// `--list-pane-width`, the decision and the standing grants).
import type { ScreenDefinition } from "../types";

function ApprovalsScreen() {
  return (
    <div className="placeholder" data-testid="screen-approvals">
      <p className="placeholder-title">Approvals</p>
      <p className="placeholder-note">What waits on you arrives here.</p>
    </div>
  );
}

export const screen: ScreenDefinition = {
  id: "approvals",
  title: "Approvals",
  nav: { label: "Approvals", order: 3, shortcut: "⌘3" },
  Component: ApprovalsScreen,
};
