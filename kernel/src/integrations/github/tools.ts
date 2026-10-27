// The `integrations` feature's GitHub tools part (phase 6, item 06 fills it
// in: the read-only pull-request tools, each `requiresConnector: "github"`).
// Empty until then.
//
// The `studio` CLI loads it, so it imports only types and the feature seam:
// never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { IntegrationsPart } from "../types.js";

export const githubToolsPart: IntegrationsPart = Object.freeze({
  name: "github-tools",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
