// Run-wide setup (wired by `kernel/vitest.config.ts`): no test reaches the
// real notifier. Installs the guard (`notifier-guard.ts`; off under
// `STUDIO_LIVE=1`) and fails the test that tried, naming the binary. Delivery
// runs on the loop tick, so a refusal can land after that test's `afterEach`
// (in teardown): the `afterAll` then fails the file.
// See `docs/architecture/notifications.md#testing`.
import { afterAll, afterEach } from "vitest";
import { assertNoNotifierRefusals, installNotifierGuard } from "./notifier-guard.js";

installNotifierGuard();
afterEach(assertNoNotifierRefusals);
afterAll(assertNoNotifierRefusals);
