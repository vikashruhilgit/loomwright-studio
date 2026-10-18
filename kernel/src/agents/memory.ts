// Every agent's memory folder (invariant 8: plain markdown under
// `<dataDir>/memory/`, which the owner reads and edits). Wright's is
// `memory/wright` and is made by `ensureMemoryFiles` (`../brain/memory.ts`),
// unchanged. A crew member's is `memory/<id>`: the kernel creates its
// `preferences.md`, `people.md` and `lessons.md` when absent, with exclusive
// create (`flag: "wx"`), so an existing file (the owner's edit included) is
// never overwritten. It never creates `role.md`: a crew member's charter is
// the one the owner saw and approved (D22, no role presets), written by the
// item that creates the member, so a missing one is reported, never filled in.
// Imports only `node:*` and its siblings (the `studio` CLI loads this module).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryFiles, memoryDir, wrightMemoryDir } from "../brain/memory.js";
import { isValidAgentId } from "./types.js";

/** The crew files the kernel creates, with their first-run text (never `role.md`). */
const CREW_FILES: ReadonlyArray<{ readonly name: string; readonly template: (id: string) => string }> = Object.freeze([
  { name: "preferences.md", template: (id: string) => `# Preferences\n\nHow the owner likes ${id}'s work done. The owner edits this file.\n` },
  { name: "people.md", template: (id: string) => `# People\n\nWho ${id} works with. The owner edits this file.\n` },
  { name: "lessons.md", template: (id: string) => `# Lessons\n\nWhat went wrong in ${id}'s work and how to avoid it. The owner edits this file.\n` },
]);

/** `<dataDir>/memory/wright` for `wright`, else `<dataDir>/memory/<id>` (no id check: callers check first). */
export function agentMemoryDir(dataDir: string, id: string): string {
  return id === "wright" ? wrightMemoryDir(dataDir) : join(memoryDir(dataDir), id);
}

export type EnsureAgentMemoryResult =
  | { readonly ok: true }
  /** The crew member's `role.md` is absent. The other three files were created (when absent). */
  | { readonly ok: false; readonly error: "charter_missing"; readonly file: string }
  /** The id breaks the id grammar or is reserved. Nothing was touched. */
  | { readonly ok: false; readonly error: "agent_id_invalid"; readonly message: string };

/** True for a Node error whose `code` is `code`. */
function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/**
 * Make `id`'s memory files exist. For `wright`, exactly `ensureMemoryFiles`.
 * For a crew id: the folder (mode 0700), then each of `preferences.md`,
 * `people.md` and `lessons.md` that is absent (exclusive create, mode 0600);
 * never `role.md`, and `charter_missing` (naming it) when it is absent. An id
 * failing `isValidAgentId` is `agent_id_invalid` before any filesystem call.
 * Any other write error (a read-only disk, a directory where a file should
 * be) is thrown.
 */
export function ensureAgentMemoryFiles(dataDir: string, id: string): EnsureAgentMemoryResult {
  if (id === "wright") {
    ensureMemoryFiles(dataDir);
    return { ok: true };
  }
  if (!isValidAgentId(id)) {
    return { ok: false, error: "agent_id_invalid", message: `agent id ${JSON.stringify(id)} is not a crew member's id` };
  }
  const dir = agentMemoryDir(dataDir, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const file of CREW_FILES) {
    try {
      writeFileSync(join(dir, file.name), file.template(id), { flag: "wx", mode: 0o600 });
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
    }
  }
  const role = join(dir, "role.md");
  return existsSync(role) ? { ok: true } : { ok: false, error: "charter_missing", file: role };
}
