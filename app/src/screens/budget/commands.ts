// Budget & audit's ⌘K commands (phase 7 item 07, AC6): owner `budget`, ids prefixed `budget.`, the
// mockup's three. `BudgetScreen.tsx` registers them while it is mounted and unregisters them on
// unmount (the shell renders only the current screen), through the registry's own unregister. Each
// command calls the same handler as its control, so both reach the same view.
//
// The palette reads `enabled` when it opens, so the flags and handlers are passed as functions:
// the screen reads them through a ref its every render refreshes, and the commands are registered
// once, never again when the kernel's reachability or the filters change.
//   Open the audit log                    always, but not while the kernel is unreachable.
//   Show refused starts in the audit log  the audit view with `kind=admission_refused`; the same.
//   Clear audit filters                   only while the audit view has a filter on (the mockup's
//                                         "While a filter is on"); it changes the view alone.
import type { Command } from "../../commands/registry";

/** The registry owner every Budget & audit command is registered under. */
export const BUDGET_OWNER = "budget";

/** The palette group the commands appear under (the mockup's "Budget & audit"). */
export const BUDGET_GROUP = "Budget & audit";

/** The kind of the event the kernel writes when it refuses a start (`docs/architecture/budget.md` §"Events"). */
export const REFUSED_KIND = "admission_refused";

export interface BudgetCommandHandlers {
  readonly openAudit: () => void;
  /** Opens the audit view filtered to `kind`. */
  readonly showKind: (kind: string) => void;
  readonly clearFilters: () => void;
}

/** What decides `enabled`, read at the moment the palette asks. */
export interface BudgetCommandFlags {
  /** The kernel cannot be asked right now. */
  readonly offline: boolean;
  /** The audit view is open with a filter on. */
  readonly filtered: boolean;
}

/** The commands over `flags` and `handlers` (both read when a command is asked, never captured). */
export function budgetCommands(flags: () => BudgetCommandFlags, handlers: () => BudgetCommandHandlers): Command[] {
  return [
    {
      id: "budget.open-audit",
      title: "Open the audit log",
      group: BUDGET_GROUP,
      keywords: ["events", "history", "log", "audit", "usage"],
      enabled: () => !flags().offline,
      run: () => handlers().openAudit(),
    },
    {
      id: "budget.show-refused",
      title: "Show refused starts in the audit log",
      group: BUDGET_GROUP,
      keywords: ["admission", "refused", "limit", "cap", "parked", "audit"],
      enabled: () => !flags().offline,
      run: () => handlers().showKind(REFUSED_KIND),
    },
    {
      id: "budget.clear-filters",
      title: "Clear audit filters",
      group: BUDGET_GROUP,
      keywords: ["reset", "filter", "audit"],
      enabled: () => flags().filtered,
      run: () => handlers().clearFilters(),
    },
  ];
}
