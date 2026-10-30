// The `gui` feature's `schedules` part (phase 7, item 05): empty until that item
// fills it in. The routes live in one named array, so the item edits one
// array in this one file. Mechanism only (invariant 1). Every gui route is an
// owner route that needs the API token: none sets `unauthenticated`.
import type { ContributedRoute } from "../features/contribution.js";
import type { GuiPart } from "./types.js";

export const schedulesRoutes: readonly ContributedRoute[] = Object.freeze([]);

export const schedulesPart: GuiPart = Object.freeze({
  name: "schedules",
  tools: Object.freeze([]),
  routes: schedulesRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
