// The `notifications` feature (phase 2): `recordNotification` (other features
// call it), a native macOS post per notification on the next loop tick (its
// click opens the notification's deep link in the app), the
// `kernel_notify` tool, the `GET /notifications` routes and the `studio
// notifications` subcommand. Every notification carries the deep link
// `loomwright-studio://notifications/<id>`. `startKernel` and `runCli` merge
// the contribution through `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`).
// The `studio` CLI loads it, so it imports only types and zod: never the
// Agent SDK. (Beyond types and zod, its modules import only `node:*`, each
// other, the feature seam and the loop's work steps and audit helpers.)
import type { FeatureContribution } from "../features/contribution.js";
import { notificationsSubcommand } from "./cli.js";
import { deliveryDueWork } from "./deliver.js";
import { notificationRoutes } from "./routes.js";
import { notifyTool } from "./tool.js";

export const notificationsContribution: FeatureContribution = Object.freeze({
  name: "notifications",
  tools: Object.freeze([notifyTool]),
  routes: notificationRoutes,
  subcommands: Object.freeze([notificationsSubcommand]),
  dueWork: Object.freeze([deliveryDueWork]),
});

export { NOTIFICATIONS_HELP, formatNotification, notificationsSubcommand, printable } from "./cli.js";
export { DELIVERY_BATCH, createDeliveryDueWork, deliverPendingNotifications, deliveryDueWork, deliveryStepKey } from "./deliver.js";
export {
  NOTIFIER_TIMEOUT_MS,
  OSASCRIPT_PATH,
  TERMINAL_NOTIFIER_PATHS,
  chooseNotifier,
  notifierGroup,
  osascriptInvocation,
  plistQuote,
  postNotification,
  spawnNotifier,
  terminalNotifierInvocation,
} from "./notifier.js";
export type { DeliveryOutcome, NotifierChoice, NotifierDeps, NotifierExec, NotifierInvocation, NotifierRun } from "./notifier.js";
export {
  DEEP_LINK_PREFIX,
  InvalidNotificationError,
  MAX_NOTIFICATION_BODY,
  MAX_NOTIFICATION_SOURCE,
  MAX_NOTIFICATION_TITLE,
  NOTIFICATION_STATUSES,
  deepLinkFor,
  getNotification,
  isNotificationSource,
  listNotifications,
  pendingNotificationIds,
  recordNotification,
} from "./record.js";
export type { NotificationInput, NotificationRow, NotificationStatus } from "./record.js";
export { DEFAULT_NOTIFICATION_LIST, MAX_NOTIFICATION_LIST, notificationDetail, notificationRoutes } from "./routes.js";
export type { NotificationDetail, NotificationSession, NotificationTrigger } from "./routes.js";
export { notifyTool } from "./tool.js";
export type { KernelNotifyResult } from "./tool.js";
