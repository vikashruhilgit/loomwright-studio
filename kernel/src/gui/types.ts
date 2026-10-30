// The `gui` feature's part shape (phase 7). Type-only imports: the `studio`
// CLI loads the feature registry, which loads this feature, so nothing here
// may pull in the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ConsolePart } from "../console/types.js";

/**
 * One sub-file's share of the `gui` contribution: the read (and, for memory,
 * write) routes the phase 7 screens call. Each phase 7 screen item fills in
 * only the part it owns (`tasks` item 03, `playbook-history` item 04,
 * `schedules` item 05, `memory` item 06, `budget-audit` item 07, `settings`
 * item 08); a part is empty until then. Every gui route is an owner route
 * that needs the API token (none sets `unauthenticated`).
 */
export type GuiPart = ConsolePart;
