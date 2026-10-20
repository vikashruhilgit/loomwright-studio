// A stub notifier for tests that boot a kernel: the shipped contributions
// with only the notifications feature's delivery swapped for one that never
// reaches a real notifier (the exit tests' `testContributions` pattern).
// With `platform: "linux"` the notifier resolves to `none` and the stub
// `exec` is never called: the same `unsupported` rows CI already sees, so no
// assertion moves. Every other contribution passes through by identity.
// See `docs/architecture/notifications.md#testing`.
import type { FeatureContribution } from "../src/features/contribution.js";
import { SHIPPED_CONTRIBUTIONS } from "../src/features/index.js";
import { createDeliveryDueWork, notificationsContribution } from "../src/notifications/index.js";
import type { NotifierExec } from "../src/notifications/index.js";

/** `base` with `notificationsContribution`'s due work replaced by a stub delivery; everything else unchanged. */
export function stubNotifierContributions(base: readonly FeatureContribution[] = SHIPPED_CONTRIBUTIONS): readonly FeatureContribution[] {
  const exec: NotifierExec = async () => ({ status: 0, signal: null, timedOut: false, stdout: "", stderr: "" });
  const deliver = createDeliveryDueWork({ platform: "linux", exec });
  return Object.freeze(base.map((c) => (c === notificationsContribution ? Object.freeze({ ...c, dueWork: Object.freeze([deliver]) }) : c)));
}
