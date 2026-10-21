// The `console` feature's part shape (phase 5). Type-only imports: the
// `studio` CLI loads the feature registry, which loads this feature, so
// nothing here may pull in the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ContributedRoute, ContributedSubcommand, ContributedTool, DueWorkFn } from "../features/contribution.js";
import type { EventHandler, EventKind } from "../loop/types.js";

/**
 * One sub-file's share of the `console` contribution. Each phase 5 item fills
 * in only the part it owns (`events`, `output`, `control`, `pause`,
 * `threads`); a part is empty until then. The console serves the app over the
 * loopback API; a part may also add `studio` CLI verbs (`subcommands`, item
 * 03's `studio sessions`), and setup stays in the terminal.
 */
export interface ConsolePart {
  readonly name: string;
  readonly tools: readonly ContributedTool[];
  readonly routes: readonly ContributedRoute[];
  readonly handlers: Readonly<Partial<Record<EventKind, EventHandler>>>;
  /** Run once per loop tick, in part order (the contribution's `dueWork`). Absent: none. */
  readonly dueWork?: readonly DueWorkFn[];
  /** `studio <name> …` verbs, in part order (the contribution's `subcommands`). Absent: none. */
  readonly subcommands?: readonly ContributedSubcommand[];
}

/** A part with nothing in it: what every console part is until its item fills it in. */
export function emptyConsolePart(name: string): ConsolePart {
  return Object.freeze({ name, tools: Object.freeze([]), routes: Object.freeze([]), handlers: Object.freeze({}) });
}
