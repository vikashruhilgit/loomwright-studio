// Approvals (phase 5 item 15): the inbox, the exact payload, Allow once,
// Always for this playbook, Deny, and the standing grants. The screen itself
// is `./ApprovalsScreen.tsx`; the shell discovers this module's `screen`.
import type { ScreenDefinition } from "../types";
import { ApprovalsScreen } from "./ApprovalsScreen";

export const screen: ScreenDefinition = {
  id: "approvals",
  title: "Approvals",
  nav: { label: "Approvals", order: 3, shortcut: "⌘3" },
  Component: ApprovalsScreen,
};
