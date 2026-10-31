// Budget & audit (phase 7 item 07): tokens counted per day, per agent and per playbook against
// their limits, the subscription cap with its resets, and the full audit log. No shortcut: the
// mockup reaches it by the palette only. The screen is `./BudgetScreen.tsx`; this module's one
// export is the screen the shell discovers (`import.meta.glob("./screens/*/index.tsx")` in
// App.tsx) and it keeps the id, title and nav entry the placeholder had.
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { ScreenDefinition } from "../types";
import { BUDGET_TEST_IDS } from "./model";
import { BudgetScreen } from "./BudgetScreen";
import "./budget.css";

/**
 * The screen the shell mounts. The bridge is the preload's `window.api`; a window with none
 * (the shell rendered without a preload, as `App.test.tsx` does) cannot reach a kernel, so it
 * says so instead of starting a store. The shell draws the one `h1`, so neither branch renders one.
 */
function BudgetRoute() {
  const api = getBridge() as StudioBridge | undefined;
  if (api === undefined) {
    return (
      <div className="budget-state" data-testid={BUDGET_TEST_IDS.screen}>
        <p className="budget-state-title">Budget &amp; audit</p>
        <p className="budget-state-note">This window has no connection to the kernel.</p>
      </div>
    );
  }
  return <BudgetScreen api={api} />;
}

export const screen: ScreenDefinition = {
  id: "budget",
  title: "Budget & audit",
  nav: { label: "Budget & audit", order: 10 },
  Component: BudgetRoute,
};
