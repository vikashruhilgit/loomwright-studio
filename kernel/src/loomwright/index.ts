// The `loomwright` feature (phase 2): the adapter to the Loomwright install a
// session loads (D32). It finds the active install from
// `installed_plugins.json` (never a cache scan), reads and validates that
// install's `capabilities.json` contract, reports the adapter's state, and
// contributes one tool, `kernel_loomwright_capabilities` (a mechanism: it
// reports, it decides nothing — invariant 1). `startKernel` and `runCli`
// merge the contribution through `SHIPPED_CONTRIBUTIONS`
// (`../features/index.ts`). The `studio` CLI loads
// it, so it imports only types and zod: never the Agent SDK. (Beyond types and
// zod, its modules import only `node:*`, each other and the feature seam.)
import type { FeatureContribution } from "../features/contribution.js";
import { capabilitiesTool } from "./capabilities.js";

export const loomwrightContribution: FeatureContribution = Object.freeze({ name: "loomwright", tools: Object.freeze([capabilitiesTool]) });

export {
  LOOMWRIGHT_ADAPTER_STATUS_REASONS,
  defaultInstalledPluginsPath,
  loomwrightAdapterStatus,
  resolveLoomwrightInstall,
} from "./active-install.js";
export type {
  LoomwrightAdapterStatus,
  LoomwrightAdapterStatusReason,
  LoomwrightInstall,
  ResolveLoomwrightInstallOptions,
} from "./active-install.js";
export {
  MANIFEST_TRUNCATED_MARKER,
  capabilitiesTool,
  loomwrightCapabilities,
  loomwrightManifestSummary,
} from "./capabilities.js";
export type { LoomwrightCapabilities, ManifestSummaryOptions } from "./capabilities.js";
export {
  CONTRACT_FILE,
  LOOMWRIGHT_CONTRACT_ERROR_REASONS,
  LoomwrightContractError,
  MAX_CONTRACT_BYTES,
  MIN_CONTRACT_SCHEMA_VERSION,
  readLoomwrightContract,
  requireHostSwitch,
} from "./contract.js";
export type {
  LoomwrightContract,
  LoomwrightContractEntry,
  LoomwrightContractErrorReason,
  LoomwrightContractHook,
  LoomwrightHostSwitch,
  LoomwrightResultSchema,
} from "./contract.js";
