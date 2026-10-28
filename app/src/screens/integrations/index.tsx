// Integrations (phase 6 item 11): the GitHub connector screen on ⌘5, after
// Sessions. The view is `./IntegrationsView.tsx`; this module's one export is the
// screen the shell discovers (`import.meta.glob("./screens/*/index.tsx")` in
// App.tsx).
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { ScreenDefinition } from "../types";
import { IntegrationsView } from "./IntegrationsView";
import { INTEGRATIONS_TEST_IDS } from "./model";
import "./integrations.css";

/**
 * The screen the shell mounts. The bridge is the preload's `window.api`; a
 * window with none (the shell rendered without a preload, as `App.test.tsx`
 * does) cannot reach a kernel, so it says so instead of starting a store.
 */
function IntegrationsScreen() {
  const api = getBridge() as StudioBridge | undefined;
  if (api === undefined) {
    return (
      <div className="integrations-state" data-testid={INTEGRATIONS_TEST_IDS.screen}>
        <p className="integrations-state-title">Integrations</p>
        <p className="integrations-state-note">This window has no connection to the kernel.</p>
      </div>
    );
  }
  return <IntegrationsView api={api} />;
}

export const screen: ScreenDefinition = {
  id: "integrations",
  title: "Integrations",
  nav: { label: "Integrations", order: 5, shortcut: "⌘5" },
  Component: IntegrationsScreen,
};
