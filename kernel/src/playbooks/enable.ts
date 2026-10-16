// The playbooks feature's `enable` part: empty until phase 3 item 07 fills it
// in (enabling a playbook: `kernel_playbook_enable`). Every call to that tool
// is held for the owner by the kernel's PreToolUse rail (`ALWAYS_HELD_TOOLS`
// in `../sessions/policy.ts`), never by this part. Only this file changes
// when it is filled in: `./index.ts` merges every part in `PLAYBOOK_PARTS`
// into the one `playbooks` contribution.
import type { PlaybookPart } from "./types.js";

export const enablePart: PlaybookPart = Object.freeze({
  name: "enable",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
