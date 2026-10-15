// The `loomwright` feature (phase 2): the adapter to the Loomwright install a
// session loads (D32). It finds the active install from
// `installed_plugins.json` (never a cache scan), reads and validates that
// install's `capabilities.json` contract, reports the adapter's state, and
// contributes one tool, `kernel_loomwright_capabilities`, and one due work,
// the version watcher (`version-note.ts`: a note and a notification when the
// active Loomwright's version changes). Both are mechanisms: they report,
// they decide nothing (invariant 1). `startKernel` and `runCli` merge the
// contribution through `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`).
// The `studio` CLI loads it, so
// it imports only types and zod: never the Agent SDK. (Beyond types and zod,
// its modules import only `node:*`, each other, the feature seam, and
// `../notifications/record.js` with, through it, `../loop/internal.js`;
// neither loads the Agent SDK.)
import type { FeatureContribution } from "../features/contribution.js";
import { capabilitiesTool } from "./capabilities.js";
import { versionWatchDueWork } from "./version-note.js";

export const loomwrightContribution: FeatureContribution = Object.freeze({
  name: "loomwright",
  tools: Object.freeze([capabilitiesTool]),
  dueWork: Object.freeze([versionWatchDueWork]),
});

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
  parseLoomwrightContract,
  readLoomwrightContract,
  readLoomwrightContractText,
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
export {
  BREAKING_KINDS,
  CONTRACT_ENTRY_GROUPS,
  HOOK_CHANGE_KINDS,
  HOST_SWITCH_FIELDS,
  KNOWN_CONTRACT_SCHEMA_VERSION,
  NO_CONTRACT_TITLE,
  VERSION_CHECK_INTERVAL_MS,
  VERSION_NOTES_DIR,
  VERSION_NOTE_SOURCE,
  checkLoomwrightVersion,
  containedNotePath,
  createVersionWatchDueWork,
  diffLoomwrightContracts,
  isDowngrade,
  renderVersionNote,
  safeVersionComponent,
  versionNoteCounts,
  versionNoteMarker,
  versionWatchDueWork,
  writeVersionNote,
} from "./version-note.js";
export type {
  BreakingKind,
  BreakingSignal,
  ContractDiffEntry,
  ContractEntryGroup,
  ContractVersion,
  DescriptionChange,
  HookChange,
  HookChangeKind,
  HostSwitchChange,
  HostSwitchField,
  HostSwitchNames,
  LoomwrightContractDiff,
  ObservedContract,
  ResultSchemaVersionChange,
  VersionCheckOutcome,
  VersionNoteMeta,
  VersionWatchOptions,
} from "./version-note.js";
