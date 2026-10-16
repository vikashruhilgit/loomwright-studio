// The playbooks feature's `runs` part: empty until phase 3 item 08 fills it
// in (the playbook runs, `playbook_runs` from migration 13). Only this file
// changes when it does: `./index.ts` merges every part in `PLAYBOOK_PARTS`
// into the one `playbooks` contribution.
import type { PlaybookPart } from "./types.js";

export const runsPart: PlaybookPart = Object.freeze({
  name: "runs",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
