// The `integrations` feature's GitHub connector part (phase 6, item 03 fills
// it in: set, replace and disconnect the token, its expiry check, and the
// `connectors` row). Empty until then.
//
// The `studio` CLI loads it, so it imports only types and the feature seam:
// never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { IntegrationsPart } from "../types.js";

export const githubConnectorPart: IntegrationsPart = Object.freeze({
  name: "github-connector",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
