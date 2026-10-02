import { initial } from "./001_initial.js";
import { authProviders } from "./002_auth_providers.js";
import { sessionLoomwrightPath } from "./003_session_loomwright_path.js";
import { sessionLeaderStartedAt } from "./004_session_leader_started_at.js";
import { sessionKillIncompleteAt } from "./005_session_kill_incomplete_at.js";
import type { Migration } from "./types.js";

export type { Migration } from "./types.js";

/** Every migration, in ascending version order. Append only; never edit a shipped one. */
export const migrations: readonly Migration[] = [
  initial,
  authProviders,
  sessionLoomwrightPath,
  sessionLeaderStartedAt,
  sessionKillIncompleteAt,
];
