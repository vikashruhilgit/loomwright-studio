// The `gui` feature's `tasks` part (phase 7, item 03): empty until that item
// fills it in. The routes live in one named array, so the item edits one
// array in this one file. Mechanism only (invariant 1). Every gui route is an
// owner route that needs the API token: none sets `unauthenticated`.
import type { ContributedRoute } from "../features/contribution.js";
import type { GuiPart } from "./types.js";

export const tasksRoutes: readonly ContributedRoute[] = Object.freeze([]);

export const tasksPart: GuiPart = Object.freeze({
  name: "tasks",
  tools: Object.freeze([]),
  routes: tasksRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
