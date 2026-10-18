// The `brain` feature (phase 2, item 06; crew routing, phase 4 item 05): the
// owner talks to Wright and the crew. A `message` event for Wright, or for an
// `active` crew member, starts (or resumes) one short session of that agent
// through the kernel's session manager, built from role and memory files the
// owner reads and edits (`<dataDir>/memory/`) and a settings file the owner
// sets (`<dataDir>/config/agents/<id>.json`); the reply is kept on the
// message's `brain_messages` row (migrations 12 and 14) and read back through
// `GET /messages/:id`, and a delegation's reply (or failure) is queued back to
// its sender. `studio ask` (`POST /ask`, then polling) is the owner's way in;
// `studio messages` (`GET /messages`) lists the rows. Mechanism only
// (invariant 1): the kernel never chooses a model, and the tool policy in the
// settings file is a proposal the owner sees and changes. `startKernel` and
// `runCli` merge it through `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`).
//
// The `studio` CLI loads it,
// so it imports only types and zod: never the Agent SDK.
// Beyond zod, `node:*` and type-level kernel modules, its runtime imports are
// its own files, `../loop/queue.js` (and its `../loop/internal.js`), `../loop/steps.js`,
// `../api/kill-switch.js`, the agents feature's leaves (`../agents/registry.js`,
// `../agents/settings.js`, `../agents/charter-files.js`, `../agents/memory.js`,
// `../agents/types.js`), the playbook runs, the Loomwright adapter's pure modules
// and the triggers feature's `cron.js` (time formatting); none of them loads the
// session manager or the SDK.
import type { FeatureContribution } from "../features/contribution.js";
import { askSubcommand, messagesSubcommand } from "./cli.js";
import { brainMessageHandler } from "./handler.js";
import { brainRoutes } from "./routes.js";

export {
  ASK_HELP,
  ASK_POLL_MS,
  ASK_SUBCOMMAND,
  DEFAULT_ASK_TIMEOUT_S,
  MAX_ASK_TIMEOUT_S,
  MESSAGES_HELP,
  MESSAGES_SUBCOMMAND,
  askSubcommand,
  messagesSubcommand,
  terminalText,
} from "./cli.js";
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
export { brainMessageHandler, interruptedAgentSession, listedWorkspace } from "./handler.js";
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
  listBrainMessages,
  messageFieldsOf,
  messageSourceOf,
  updateBrainMessage,
} from "./messages.js";
export type { BrainMessageRow, BrainMessageStatus, MessageFields } from "./messages.js";
export { ASK_AGENT, DEFAULT_MESSAGES_LIST, MAX_MESSAGES_LIST, askTextProblem, brainRoutes } from "./routes.js";
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
  subcommands: Object.freeze([askSubcommand(), messagesSubcommand()]),
  handlers: Object.freeze({ message: brainMessageHandler() }),
});
