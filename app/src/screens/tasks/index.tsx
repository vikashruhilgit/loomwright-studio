// Tasks (phase 7 item 03): today's work as a board of four columns, each card
// opening to its history and its session's log. The view is `./TasksScreen.tsx`;
// this module's one export is the screen the shell discovers
// (`import.meta.glob("./screens/*/index.tsx")` in App.tsx).
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { ScreenDefinition } from "../types";
import { TasksScreen } from "./TasksScreen";
import { TasksNoKernel } from "./TasksViews";

/**
 * The screen the shell mounts. The bridge is the preload's `window.api`; a
 * window with none (the shell rendered without a preload, as `App.test.tsx`
 * does) cannot reach a kernel, so it says so instead of starting a store.
 */
function TasksRoute() {
  const api = getBridge() as StudioBridge | undefined;
  if (api === undefined) return <TasksNoKernel />;
  return <TasksScreen api={api} />;
}

export const screen: ScreenDefinition = {
  id: "tasks",
  title: "Tasks",
  nav: { label: "Tasks", order: 6, shortcut: "⌘6" },
  Component: TasksRoute,
};
