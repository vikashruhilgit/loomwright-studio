// The `gui` feature's `memory` part (phase 7, item 06): the routes behind the
// Memory screen, on the loopback API (bearer token, like every route):
//
//   GET /memory                      {agents, shared}: each agent's markdown files, then the shared ones
//   GET /memory/file?path=<path>     {path, content, content_hash}: one file's text and the hash of its bytes
//   PUT /memory/file                 {path, content, base_hash}: the owner's edit, written only if the file
//                                    still has the hash the owner read (else 409 `changed_since_read`)
//
// The routes live in one named array. Mechanism only (invariant 1). Every gui route is an
// owner route that needs the API token: none sets `unauthenticated`. A file's text and its
// names are untrusted data (invariant 3): returned as stored, never interpreted. Which file
// a path may name is `./memory-paths.ts`'s one guard, shared by both file routes.
//
// The PUT reads the file, compares its hash with `base_hash`, renames the new text over it
// and records one `memory_updated` event, with no `await` between the read and the rename,
// so no other kernel request runs between them. Another PROCESS (a session writing the file
// itself) still can: the check is not atomic against it (documented in
// `docs/architecture/brain.md`, "Honest limits"). An agent's own memory write records no event.
//
// The `studio` CLI loads this module, so it imports only types, the feature seam and helpers
// that load no SDK: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isValidAgentId } from "../agents/types.js";
import { memoryDir } from "../brain/memory.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { NO_REF, appendEvent } from "../loop/internal.js";
import { writeFileAtomic } from "../tools/handoff.js";
import { MAX_MEMORY_FILE_BYTES, MEMORY_UPDATED, resolveMemoryPath } from "./memory-paths.js";
import type { GuiPart } from "./types.js";

export { MEMORY_UPDATED };

/** A crew member's own files come first, in this order; any other file follows by name. */
const AGENT_FILE_ORDER = ["role.md", "preferences.md", "people.md", "lessons.md"];

/** One listed file (the contract's `MemoryFileEntry`). */
interface FileEntry {
  readonly path: string;
  readonly size: number;
  readonly modified: string;
}

interface AgentFiles {
  readonly agent: string;
  readonly files: FileEntry[];
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `memory/<folder>`'s regular `*.md` files directly in it (a link or a subfolder is never listed); a folder that cannot be read lists none. */
function listFiles(root: string, folder: string): FileEntry[] {
  let entries;
  try {
    entries = readdirSync(join(root, folder), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: FileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    try {
      const stat = lstatSync(join(root, folder, entry.name));
      files.push({ path: `${folder}/${entry.name}`, size: stat.size, modified: stat.mtime.toISOString() });
    } catch {
      // Gone between the listing and the stat: not listed.
    }
  }
  return files;
}

/** The position of a file name in `AGENT_FILE_ORDER`, or past the end. */
const fileRank = (path: string): number => {
  const at = AGENT_FILE_ORDER.indexOf(path.slice(path.indexOf("/") + 1));
  return at === -1 ? AGENT_FILE_ORDER.length : at;
};

// ---- GET /memory ------------------------------------------------------------------

/** `GET /memory`: every agent's files (Wright first, then by id), then the shared files. No `memory/` answers an empty tree. */
function treeHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const root = memoryDir(req.store.dataDir);
  let folders;
  try {
    folders = readdirSync(root, { withFileTypes: true });
  } catch {
    return Promise.resolve({ status: 200, body: { agents: [], shared: [] } });
  }
  const agents: AgentFiles[] = [];
  for (const entry of folders) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name !== "wright" && !isValidAgentId(name)) continue;
    const files = listFiles(root, name).sort((a, b) => fileRank(a.path) - fileRank(b.path) || byText(a.path, b.path));
    agents.push({ agent: name, files });
  }
  agents.sort((a, b) => (a.agent === "wright" ? -1 : b.agent === "wright" ? 1 : byText(a.agent, b.agent)));
  const shared = listFiles(root, "shared").sort((a, b) => byText(a.path, b.path));
  return Promise.resolve({ status: 200, body: { agents, shared } });
}

// ---- GET /memory/file -------------------------------------------------------------

/** The refusal a guard answered, as the route's response. */
const refusal = (status: number, error: string): ContributedRouteResponse => ({ status, body: { error } });

/** `GET /memory/file?path=…`: the file's text and the hash of its bytes, past the same guard as the write. */
function readHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const resolved = resolveMemoryPath(req.store.dataDir, req.query["path"] ?? "");
  if (!resolved.ok) return Promise.resolve(refusal(resolved.status, resolved.error));
  try {
    if (statSync(resolved.target).size > MAX_MEMORY_FILE_BYTES) return Promise.resolve(refusal(400, "too_large"));
    const bytes = readFileSync(resolved.target);
    if (bytes.length > MAX_MEMORY_FILE_BYTES) return Promise.resolve(refusal(400, "too_large"));
    return Promise.resolve({ status: 200, body: { path: resolved.relative, content: bytes.toString("utf8"), content_hash: sha256(bytes) } });
  } catch {
    return Promise.resolve(refusal(404, "not_found"));
  }
}

// ---- PUT /memory/file -------------------------------------------------------------

interface WriteBody {
  readonly path: string;
  readonly content: string;
  readonly base_hash: string;
}

/** The body `{path, content, base_hash}` (three strings), or undefined. */
function writeBodyOf(body: unknown): WriteBody | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const { path, content, base_hash: baseHash } = body as Record<string, unknown>;
  if (typeof path !== "string" || typeof content !== "string" || typeof baseHash !== "string") return undefined;
  return { path, content, base_hash: baseHash };
}

/**
 * `PUT /memory/file`: the owner's edit of an existing file. Every refusal leaves
 * the file as it was and records no event. The read, the hash check and the
 * rename are synchronous (no `await`), and the event follows the rename. It does
 * not queue on `req.serialized`: that queue is the kill switch's, never for file IO.
 */
function writeHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const body = writeBodyOf(req.body);
  if (body === undefined) return Promise.resolve(refusal(400, "invalid_body"));
  const resolved = resolveMemoryPath(req.store.dataDir, body.path);
  if (!resolved.ok) return Promise.resolve(refusal(resolved.status, resolved.error));
  if (Buffer.byteLength(body.content, "utf8") > MAX_MEMORY_FILE_BYTES) return Promise.resolve(refusal(400, "too_large"));

  let current: Buffer;
  try {
    // A file already over the cap could not have been opened by the owner: refuse before reading it whole.
    if (statSync(resolved.target).size > MAX_MEMORY_FILE_BYTES) return Promise.resolve(refusal(400, "too_large"));
    current = readFileSync(resolved.target);
  } catch {
    return Promise.resolve(refusal(404, "not_found"));
  }
  const currentHash = sha256(current);
  if (currentHash !== body.base_hash) {
    return Promise.resolve({
      status: 409,
      body: {
        error: "changed_since_read",
        message: "the file changed after you opened it; nothing was written",
        current_content: current.toString("utf8"),
        current_hash: currentHash,
      },
    });
  }

  // The write goes to the real target: a link inside `memory/` stays a link.
  writeFileAtomic(resolved.target, body.content);
  const written = Buffer.from(body.content, "utf8");
  const hash = sha256(written);
  const size = written.length;
  const at = req.now().toISOString();
  appendEvent(req.store, MEMORY_UPDATED, NO_REF, { path: resolved.relative, by: "owner", size, content_hash: hash }, at);
  return Promise.resolve({
    status: 200,
    body: { path: resolved.relative, content_hash: hash, size, modified: statSync(resolved.target).mtime.toISOString() },
  });
}

export const memoryRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/memory", handler: treeHandler },
  { method: "GET", path: "/memory/file", handler: readHandler },
  { method: "PUT", path: "/memory/file", handler: writeHandler },
] satisfies ContributedRoute[]);

export const memoryPart: GuiPart = Object.freeze({
  name: "memory",
  tools: Object.freeze([]),
  routes: memoryRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
