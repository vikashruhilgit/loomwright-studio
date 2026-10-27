// The `integrations` feature's GitHub routes part (phase 6, item 03 fills it
// in: `GET /connectors`, `POST /connectors/github/token`,
// `POST /connectors/github/disconnect`, `GET /connectors/github/repos`).
// Empty until then.
//
// The `studio` CLI loads it, so it imports only types and the feature seam:
// never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { IntegrationsPart } from "../types.js";

export const githubRoutesPart: IntegrationsPart = Object.freeze({
  name: "github-routes",
  tools: Object.freeze([]),
  routes: Object.freeze([]),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
