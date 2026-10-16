// The playbooks feature's `dry-run` part: empty until phase 3 item 07 fills
// it in (the dry run: `kernel_playbook_dry_run`). Only this file changes when
// it does: `./index.ts` merges every part in `PLAYBOOK_PARTS` into the one
// `playbooks` contribution.
import type { PlaybookPart } from "./types.js";

export const dryRunPart: PlaybookPart = Object.freeze({
  name: "dry-run",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
