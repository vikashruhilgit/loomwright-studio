// The `integrations` feature's drafts part (phase 6, item 07 fills it in:
// draft mode records outward calls in `draft_outputs` instead of sending
// them, and `GET /drafts`, `GET /drafts/:id`). Empty until then.
//
// The `studio` CLI loads it, so it imports only types and the feature seam:
// never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { IntegrationsPart } from "./types.js";

export const draftsPart: IntegrationsPart = Object.freeze({
  name: "drafts",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
