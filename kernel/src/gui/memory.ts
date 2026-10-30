// The `gui` feature's `memory` part (phase 7, item 06): empty until that item
// fills it in. The routes live in one named array, so the item edits one
// array in this one file. Mechanism only (invariant 1). Every gui route is an
// owner route that needs the API token: none sets `unauthenticated`.
import type { ContributedRoute } from "../features/contribution.js";
import type { GuiPart } from "./types.js";

export const memoryRoutes: readonly ContributedRoute[] = Object.freeze([]);

export const memoryPart: GuiPart = Object.freeze({
  name: "memory",
  tools: Object.freeze([]),
  routes: memoryRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
