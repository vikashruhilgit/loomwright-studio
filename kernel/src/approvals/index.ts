// The `approvals` feature (phase 2). Its one contribution is empty until the
// item that builds this feature fills it in (invariant 1: nothing is
// preinstalled). `startKernel` and `runCli` merge it through
// `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`). The `studio` CLI loads
// it, so it imports only types and zod: never the Agent SDK.
import type { FeatureContribution } from "../features/contribution.js";

export const approvalsContribution: FeatureContribution = Object.freeze({ name: "approvals" });
