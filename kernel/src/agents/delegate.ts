// The agents feature's `delegate` part: empty until phase 4 item 06 fills it
// in (delegating work to a crew member: `kernel_agent_message`). Only this
// file changes when it is filled in: `./index.ts` merges every part in
// `AGENT_PARTS` into the one `agents` contribution.
import type { AgentPart } from "./types.js";

export const delegatePart: AgentPart = Object.freeze({
  name: "delegate",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
