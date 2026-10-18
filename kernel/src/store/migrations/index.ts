import { initial } from "./001_initial.js";
import { authProviders } from "./002_auth_providers.js";
import { sessionLoomwrightPath } from "./003_session_loomwright_path.js";
import { sessionLeaderStartedAt } from "./004_session_leader_started_at.js";
import { sessionKillIncompleteAt } from "./005_session_kill_incomplete_at.js";
import { budgetCapDetails } from "./006_budget_cap_details.js";
import { eventLoop } from "./007_event_loop.js";
import { eventsExplicitIdGuard } from "./008_events_explicit_id_guard.js";
import { capKeysProviderId } from "./009_cap_keys_provider_id.js";
import { sessionGroups } from "./010_session_groups.js";
import { phase2Tables } from "./011_phase_2_tables.js";
import { brainMessages } from "./012_brain_messages.js";
import { playbooks } from "./013_playbooks.js";
import { agentRegistry } from "./014_agents.js";
import type { Migration } from "./types.js";

export type { Migration } from "./types.js";

/** Every migration, in ascending version order. Append only; never edit a shipped one. */
export const migrations: readonly Migration[] = [
  initial,
  authProviders,
  sessionLoomwrightPath,
  sessionLeaderStartedAt,
  sessionKillIncompleteAt,
  budgetCapDetails,
  eventLoop,
  eventsExplicitIdGuard,
  capKeysProviderId,
  sessionGroups,
  phase2Tables,
  brainMessages,
  playbooks,
  agentRegistry,
];
