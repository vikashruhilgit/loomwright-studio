// The `gui` feature's `playbook-history` part (phase 7, item 04): empty until that item
// fills it in. The routes live in one named array, so the item edits one
// array in this one file. Mechanism only (invariant 1). Every gui route is an
// owner route that needs the API token: none sets `unauthenticated`.
import type { ContributedRoute } from "../features/contribution.js";
import type { GuiPart } from "./types.js";

export const playbookHistoryRoutes: readonly ContributedRoute[] = Object.freeze([]);

export const playbookHistoryPart: GuiPart = Object.freeze({
  name: "playbook-history",
  tools: Object.freeze([]),
  routes: playbookHistoryRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
