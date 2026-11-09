// The `automate` feature (phase 8): the kernel's mechanism for driving
// Loomwright's `/automate`, tracking the pull requests it parks and routing
// what the tracker finds. One contribution built from three parts, so each
// phase 8 item edits only the part it owns: `runner` gives a live playbook's own
// session the tools to hand tickets to `/automate` and to check a merge (item
// 09; no tool starts a session, owner decision 2026-11-03), `tracker` follows a
// PR through its states, and `routing` decides where a finding goes (fix, reply
// or answer). A part is empty until its item fills it in. Mechanism only
// (invariant 1): the repo's merge policy is the user's, and the kernel never
// merges (invariant 4, D40).
// `startKernel` and `runCli` merge it through `SHIPPED_CONTRIBUTIONS`
// (`../features/index.ts`), eleventh and last, after phase 7's `gui`.
//
// The `studio` CLI loads it, so it imports only types, the feature seam, the
// console's part merge and its own parts (which may read the repo policy module,
// already in the registry's graph through `integrations/index.ts`, and node
// `fs`/`path`): never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { consoleContributionOf } from "../console/index.js";
import { emptyConsolePart } from "../console/types.js";
import type { ConsolePart } from "../console/types.js";
import type { FeatureContribution } from "../features/contribution.js";
import { runnerPart } from "./runner.js";

/** The contribution's name. */
export const AUTOMATE_NAME = "automate";

/** One sub-part of the `automate` contribution: the console's part shape, empty until its item fills it in. */
export type AutomatePart = ConsolePart;

/**
 * The runner part (item 09): `kernel_automate_prepare`, `kernel_automate_state`,
 * `kernel_automate_merge_check` and the held `kernel_merge_approval_request`,
 * built in `./runner.ts`. They help a live playbook's own session hand tickets to
 * `/automate` and check a merge; no tool starts a session or merges.
 */
export { runnerPart };

/** The tracker part: follows a pull request through its states (empty until its item). */
export const trackerPart: AutomatePart = emptyConsolePart("tracker");

/** The routing part: routes a finding to fix, reply or answer (empty until its item). */
export const routingPart: AutomatePart = emptyConsolePart("routing");

/** Every part, in merge order: tools, routes, subcommands and due work keep this order. */
export const AUTOMATE_PARTS: readonly AutomatePart[] = Object.freeze([runnerPart, trackerPart, routingPart]);

/**
 * The contribution `parts` make: `name` always, and only the non-empty keys
 * beside it. The console's merge, reused as it is (one merge for every
 * feature's parts): it throws `ContributionConflictError` naming both parts
 * when two claim one handler kind, and leaves tool, route and subcommand
 * collisions to `mergeContributions`.
 */
export function automateContributionOf(parts: readonly AutomatePart[]): FeatureContribution {
  return Object.freeze({ ...consoleContributionOf(parts), name: AUTOMATE_NAME });
}

/** The shipped contribution: `AUTOMATE_PARTS` merged at module load (no part claims a handler kind, so it does not throw). */
export const automateContribution: FeatureContribution = automateContributionOf(AUTOMATE_PARTS);
