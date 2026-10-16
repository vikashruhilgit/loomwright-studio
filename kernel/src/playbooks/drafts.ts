// The playbooks feature's `drafts` part: empty until phase 3 item 02 fills it
// in (drafting, updating, listing and disabling playbooks:
// `kernel_playbook_create`, `_update`, `_list`, `_disable`). Only this file
// changes when it does: `./index.ts` merges every part in `PLAYBOOK_PARTS`
// into the one `playbooks` contribution.
import type { PlaybookPart } from "./types.js";

export const draftsPart: PlaybookPart = Object.freeze({
  name: "drafts",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
