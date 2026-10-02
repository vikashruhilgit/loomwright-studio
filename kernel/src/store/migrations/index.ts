import { initial } from "./001_initial.js";
import type { Migration } from "./types.js";

export type { Migration } from "./types.js";

/** Every migration, in ascending version order. Append only; never edit a shipped one. */
export const migrations: readonly Migration[] = [initial];
