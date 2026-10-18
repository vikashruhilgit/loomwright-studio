// The agents feature's `roster` part: empty until phase 4 item 02 fills it in
// (the owner creates, lists, renames, sets and turns off crew members). Only
// this file changes when it is filled in: `./index.ts` merges every part in
// `AGENT_PARTS` into the one `agents` contribution.
import type { AgentPart } from "./types.js";

export const rosterPart: AgentPart = Object.freeze({
  name: "roster",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
