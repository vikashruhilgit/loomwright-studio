// Budget & audit's count line in the title bar (phase 7 item 17), beside the title as the mockup draws it:
// the overview's "61,924 tokens today" (with " · last known" while the kernel cannot be asked) and the audit
// view's "Audit log". The shell mounts it as `ScreenDefinition.Subtitle`, with no props and outside the screen;
// it reads what the screen published (`./subtitle-state.ts`). With no budget screen mounted, or no data to
// count yet, it renders nothing, and it never reads the bridge, so a window with no connection cannot throw here.
import { withLastKnown } from "../../shell/last-known";
import { BUDGET_TEST_IDS as IDS, summaryText } from "./model";
import { useSubtitleState } from "./subtitle-state";

export function Subtitle() {
  const state = useSubtitleState();
  if (state === null) return null;
  if (state.view === "audit") return <span data-testid={IDS.summary}>Audit log</span>;
  if (state.todayTokens === null) return null;
  return <span data-testid={IDS.summary}>{withLastKnown(summaryText(state.todayTokens), state.lastKnown)}</span>;
}
