// Budget & audit (phase 7): a placeholder until its screen item builds the real one. The
// shell discovers this module's `screen` (`import.meta.glob` in App.tsx); the
// item replaces `Component` and keeps the id, title and nav entry unless its
// mockup says otherwise.
import type { ScreenDefinition } from "../types";
import { ScreenPlaceholder } from "../placeholder";

function BudgetScreen() {
  return <ScreenPlaceholder id="budget" title="Budget & audit" note="Usage per day, playbook and agent against the limits, and the event log." />;
}

export const screen: ScreenDefinition = {
  id: "budget",
  title: "Budget & audit",
  nav: { label: "Budget & audit", order: 10 },
  Component: BudgetScreen,
};
