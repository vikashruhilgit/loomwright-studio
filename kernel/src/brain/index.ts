// The `brain` feature (phase 2, item 06): the owner talks to Wright. A
// `message` event for Wright starts (or resumes) one short Wright session
// through the kernel's session manager, built from role and memory files the
// owner reads and edits (`<dataDir>/memory/`) and a settings file the owner
// sets (`<dataDir>/config/agents/wright.json`); the reply is kept on the
// message's `brain_messages` row (migration 12) and read back through
// `GET /messages/:id`. `studio ask` (`POST /ask`, then polling) is the owner's
// way in. Mechanism only (invariant 1): the kernel never chooses a model, and
// the tool policy in the settings file is a proposal the owner sees and
// changes. `startKernel` and `runCli` merge it through `SHIPPED_CONTRIBUTIONS`
// (`../features/index.ts`).
//
// The `studio` CLI loads it,
// so it imports only types and zod: never the Agent SDK.
// Beyond zod, `node:*` and type-level kernel modules, its runtime imports are
// its own files, `../loop/queue.js` (and its `../loop/internal.js`), `../api/kill-switch.js`,
// the Loomwright adapter's pure modules and the triggers feature's `cron.js`
// (time formatting); none of them loads the session manager or the SDK.
import type { FeatureContribution } from "../features/contribution.js";
import { askSubcommand } from "./cli.js";
import { brainMessageHandler } from "./handler.js";
import { brainRoutes } from "./routes.js";

export { ASK_HELP, ASK_POLL_MS, ASK_SUBCOMMAND, DEFAULT_ASK_TIMEOUT_S, MAX_ASK_TIMEOUT_S, askSubcommand, terminalText } from "./cli.js";
export type { AskSubcommandDeps } from "./cli.js";
export {
  MAX_CONTEXT_CHARS,
  MAX_MANIFEST_CHARS,
  MAX_MEMORY_FILE_CHARS,
  MAX_MESSAGE_CHARS,
  buildContext,
  defuseWrapperTags,
  isOwnerSource,
  localTimeLine,
  loomwrightSummaryOf,
} from "./context.js";
export type { ContextInput, LoomwrightSummary } from "./context.js";
export { brainMessageHandler } from "./handler.js";
export type { BrainHandlerDeps } from "./handler.js";
export { MEMORY_FILES, ensureMemoryFiles, memoryDir, readMemoryFile, wrightMemoryDir } from "./memory.js";
export type { MemoryFile, MemoryRead } from "./memory.js";
export {
  BRAIN_AGENTS,
  BRAIN_MESSAGE_STATUSES,
  FINAL_MESSAGE_STATUSES,
  ensureBrainMessage,
  getBrainMessage,
  getBrainMessageByQueueId,
  messageSourceOf,
  updateBrainMessage,
} from "./messages.js";
export type { BrainMessageRow, BrainMessageStatus } from "./messages.js";
export { ASK_AGENT, askTextProblem, brainRoutes } from "./routes.js";
export {
  MAX_SETTINGS_BYTES,
  PROPOSED_ALLOWED_TOOLS,
  WRIGHT_SETTINGS_RELATIVE_PATH,
  defaultWrightSettingsJson,
  readWrightSettings,
  wrightSettingsPath,
} from "./settings.js";
export type { WrightSettings, WrightSettingsRefusal, WrightSettingsResult } from "./settings.js";
export { LESSONS_TEMPLATE, PEOPLE_TEMPLATE, PREFERENCES_TEMPLATE, ROLE_TEMPLATE, SHARED_README_TEMPLATE } from "./templates.js";

export const brainContribution: FeatureContribution = Object.freeze({
  name: "brain",
  routes: brainRoutes,
  subcommands: Object.freeze([askSubcommand()]),
  handlers: Object.freeze({ message: brainMessageHandler() }),
});
