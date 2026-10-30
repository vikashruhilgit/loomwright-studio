// The `gui` feature's `budget-audit` part (phase 7, item 07): empty until that item
// fills it in. The routes live in one named array, so the item edits one
// array in this one file. Mechanism only (invariant 1). Every gui route is an
// owner route that needs the API token: none sets `unauthenticated`.
import type { ContributedRoute } from "../features/contribution.js";
import type { GuiPart } from "./types.js";

export const budgetAuditRoutes: readonly ContributedRoute[] = Object.freeze([]);

export const budgetAuditPart: GuiPart = Object.freeze({
  name: "budget-audit",
  tools: Object.freeze([]),
  routes: budgetAuditRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
