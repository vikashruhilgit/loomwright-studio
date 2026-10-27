// Integrations: a placeholder on ⌘5, after Sessions (phase 6 foundation).
// Phase 6 item 11 replaces it with the GitHub connector screen (connect,
// disconnect, permissions, expiry, status and the repos the token reaches),
// matching the mockup item 02 adds. It fetches nothing: the connector routes
// (`GET /connectors` and the rest, item 03) are in the contract but not served
// yet.
import type { ScreenDefinition } from "../types";

function IntegrationsScreen() {
  return (
    <div className="placeholder" data-testid="screen-integrations">
      <p className="placeholder-title">Integrations</p>
      <p className="placeholder-note">Connectors arrive here, GitHub first. Studio works with none.</p>
    </div>
  );
}

export const screen: ScreenDefinition = {
  id: "integrations",
  title: "Integrations",
  nav: { label: "Integrations", order: 5, shortcut: "⌘5" },
  Component: IntegrationsScreen,
};
