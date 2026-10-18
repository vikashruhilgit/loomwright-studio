// The agents feature's `charter-tools` part: empty until phase 4 item 07
// fills it in (`kernel_agent_create` / `kernel_agent_update`: Wright drafts a
// charter, the owner approves it). Every call to those two tools is held for
// the owner by the kernel's PreToolUse rail (`ALWAYS_HELD_TOOLS` in
// `../sessions/policy.ts`) and applied by the kernel (`KERNEL_APPLIED_ACTIONS`
// in `../approvals/store.ts`), never by this part. Only this file changes when
// it is filled in: `./index.ts` merges every part in `AGENT_PARTS` into the one
// `agents` contribution.
import type { AgentPart } from "./types.js";

export const charterToolsPart: AgentPart = Object.freeze({
  name: "charter-tools",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
