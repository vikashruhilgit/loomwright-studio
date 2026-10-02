import type { Migration } from "./types.js";

/**
 * The Loomwright plugin dir each session ran with (item 05, AC8), so a resume
 * and an audit can tell which plugin version a session used.
 */
export const sessionLoomwrightPath: Migration = {
  version: 3,
  name: "session_loomwright_path",
  up: "ALTER TABLE sessions ADD COLUMN loomwright_path TEXT;",
};
