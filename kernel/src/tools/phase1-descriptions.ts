// The phase 1 six's descriptions: the one source the tool server publishes
// (`kernelToolDefinitions` in `./server.ts`) and the kernel's tool catalogue
// reads (`buildToolCatalogue` in `../features/catalogue.ts`), so the catalogue's
// purpose line for a phase 1 tool is the description a session is offered.
//
// A CLI-safe leaf, like the feature seam: the `studio` CLI loads the catalogue
// through the feature registry, so this module imports only type-level kernel
// modules and `../loop/wakeups.js` (a constant): never `./server.js`,
// `../kernel.js` or the Agent SDK (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import type { PHASE1_TOOL_NAMES } from "../features/contribution.js";
import { RESERVED_WAKEUP_REASON_PREFIXES } from "../loop/wakeups.js";

/** A phase 1 tool's name (`PHASE1_TOOL_NAMES`). */
export type Phase1ToolName = (typeof PHASE1_TOOL_NAMES)[number];

/** `kernel_task_list`'s largest `limit`. */
export const PHASE1_TASK_LIST_MAX = 200;

/** `kernel_task_list`'s `limit` when none is given. */
export const PHASE1_TASK_LIST_DEFAULT = 50;

const REPEAT = "Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ.";

/** The words the Tasks board reads as a task's state (the app owns the grouping; the kernel still stores any word). */
const BOARD_WORDS = "The Tasks board reads four state words: waiting (needs the owner), working, parked, done. Any other word you choose is kept and shows under Other with that exact word.";

/** Each phase 1 tool's description, in `PHASE1_TOOL_NAMES` order. Frozen. */
export const PHASE1_DESCRIPTIONS: Readonly<Record<Phase1ToolName, string>> = Object.freeze({
  kernel_task_create: `Create a task row. state is free text you choose; the kernel defines no states. ${BOARD_WORDS} ${REPEAT}`,
  kernel_task_update: `Update the given fields of a task (null clears an optional field). state is free text. ${BOARD_WORDS} With an idempotency_key: ${REPEAT}`,
  kernel_task_list: `List tasks in id order, filtered by state, assignee_agent or parent_task_id (limit 1-${PHASE1_TASK_LIST_MAX}, default ${PHASE1_TASK_LIST_DEFAULT}).`,
  kernel_task_get: "Get one task by id.",
  kernel_schedule_wakeup: `Schedule a wake-up at an ISO-8601 instant with a time zone (a past time fires on the next tick). The reason is free text, except that ${RESERVED_WAKEUP_REASON_PREFIXES.join(" and ")} are reserved for the kernel. ${REPEAT}`,
  kernel_request_stop: `End this session: the kernel writes your handoff note (markdown) to memory and then stops the session. ${REPEAT}`,
});
