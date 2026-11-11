// The console's saved-workspaces part (phase 8 item 18c): the owner's one
// list of repo folders (`saved_workspaces`, migration 24), shown and edited in
// Settings → Workspaces, and looked up by `<owner>/<repo>`.
//
//   GET  /workspaces[?repo=<owner>/<repo>]
//       200 {workspaces: [{id, path, repo, added_at, last_used_at, state}]}:
//       every saved row, most recently used first (`last_used_at`, then id,
//       descending), each folder re-read now (`readWorkspaceRepos`): `state`
//       is `ready` (a git checkout whose remotes were read), `missing` (the
//       folder or its `.git` is gone: moved, renamed or deleted) or
//       `unreadable` (a read failed, `EACCES`/`EPERM`); never `ready` unless
//       the read found a checkout. `repo` is the first GitHub remote the
//       folder named when it was saved (null when none). With `repo` it is
//       the lookup (`lookupSavedWorkspaces`): the rows whose remotes, read
//       now, name that repo (case-insensitive), plus the rows saved with that
//       repo that now read `missing` or `unreadable`, in the same order.
//       400 invalid_input (a `repo` that is not `<owner>/<repo>`)
//   POST /workspaces   body {path}
//       200 {workspace, note}: saves the folder, or touches it when it is
//       already saved: `repo` is its first GitHub remote read now (or null),
//       `last_used_at` is now (a new row's `added_at` too). `path` is stored
//       resolved (`resolvedPath`), so a symlinked or firmlinked spelling of a
//       saved folder touches that row. `note` is null, or (when `repo` is
//       null) a plain sentence saying it won't be matched to a repo. Refused
//       before anything is written: 400 invalid_input (not an absolute path),
//       protected_folder (inside a macOS-protected folder, D31; the message
//       is `protectedFolderRefusal`), not_checkout (missing, or not a git
//       checkout) or unreadable (a read failed)
//   POST /workspaces/:id/remove
//       200 {removed: id}: deletes that row only; 404 not_found for an id
//       that is not a positive integer or names no row. It never reads or
//       writes any crew member's settings file (`config/agents/*.json`).
//
// Owner-only: the three routes are console routes behind the API's bearer
// token, which no session holds; `studio.db` is a protected data file a
// session's file tools can't write (`PROTECTED_DATA_FILES`); and this part
// contributes no tool and no `studio` subcommand. Wright has no tool to read
// the list in 18c; `lookupSavedWorkspaces` is the one implementation a later
// tool and the route share.
//
// Mechanism only (invariant 1): which folders are listed is the owner's. The
// `studio` CLI loads this part through the feature registry, so its value
// imports are CLI-safe leaf modules (`../automate/checkout.js`,
// `../protected-paths.js`): never the Agent SDK, the session manager or
// `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the module graph).
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { readWorkspaceRepos } from "../automate/checkout.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { isProtectedPath, protectedFolderRefusal, resolvedPath } from "../protected-paths.js";
import type { Store } from "../store/store.js";
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

/** What re-reading a saved folder found: `ready` (a git checkout), `missing` (gone or not a checkout) or `unreadable` (a read failed). */
export type SavedWorkspaceState = "ready" | "missing" | "unreadable";

/** One `saved_workspaces` row as the routes answer it (the contract's `SavedWorkspace`). */
export interface SavedWorkspace {
  readonly id: number;
  /** Absolute, resolved (`resolvedPath`). */
  readonly path: string;
  /** The first GitHub remote (`owner/repo`) when it was saved; null when it had none. */
  readonly repo: string | null;
  readonly added_at: string;
  readonly last_used_at: string;
  /** Read now, never stored. */
  readonly state: SavedWorkspaceState;
}

/** A row as stored. */
interface SavedWorkspaceRow {
  readonly id: number;
  readonly path: string;
  readonly repo: string | null;
  readonly added_at: string;
  readonly last_used_at: string;
}

const COLUMNS = "id, path, repo, added_at, last_used_at";

/** Most recently used first; the id breaks a tie (the later row first). */
const ORDER = "ORDER BY last_used_at DESC, id DESC";

/** `<owner>/<repo>` as GitHub names them (the characters `repoOfRemote` accepts); `.` and `..` are refused separately. */
const REPO = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/;

/** Whether `repo` is an `<owner>/<repo>` name. */
export function isRepoName(repo: string): boolean {
  const m = REPO.exec(repo);
  if (m === null) return false;
  return ![m[1], m[2]].some((part) => part === "." || part === "..");
}

/** A saved path's longest accepted length (PATH_MAX on macOS). */
const MAX_PATH_CHARS = 1024;

/** What a folder's fresh read found, as a state and its remotes (empty unless `ready`). */
function readState(path: string): { readonly state: SavedWorkspaceState; readonly repos: readonly string[] } {
  const read = readWorkspaceRepos(path);
  if (read.kind === "repos") return { state: "ready", repos: read.repos };
  if (read.kind === "unreadable") return { state: "unreadable", repos: [] };
  return { state: "missing", repos: [] };
}

function allRows(store: Store): SavedWorkspaceRow[] {
  return store.prepare<[], SavedWorkspaceRow>(`SELECT ${COLUMNS} FROM saved_workspaces ${ORDER}`).all();
}

/** Every saved workspace, most recently used first, each folder re-read now. */
export function listSavedWorkspaces(store: Store): SavedWorkspace[] {
  return allRows(store).map((row) => ({ ...row, state: readState(row.path).state }));
}

/**
 * The saved workspaces for `repo` (`<owner>/<repo>`), most recently used
 * first, each folder re-read now: every row whose remotes, read now, name
 * `repo` (case-insensitive), plus every row saved with `repo` that now reads
 * `missing` or `unreadable` (so a moved or deleted folder is reported, never
 * offered as `ready`). A `ready` row whose remotes no longer name `repo` is
 * left out. Empty for a `repo` that is not an `<owner>/<repo>` name
 * (`isRepoName`; the route refuses one first). The one implementation the
 * route and a later Wright tool share.
 */
export function lookupSavedWorkspaces(store: Store, repo: string): SavedWorkspace[] {
  if (!isRepoName(repo)) return [];
  const want = repo.toLowerCase();
  const found: SavedWorkspace[] = [];
  for (const row of allRows(store)) {
    const read = readState(row.path);
    const matches = read.state === "ready" ? read.repos.some((r) => r.toLowerCase() === want) : row.repo !== null && row.repo.toLowerCase() === want;
    if (matches) found.push({ ...row, state: read.state });
  }
  return found;
}

/** The answer to a refused add: 400 with the code and a plain sentence. */
const refused = (error: string, message: string): ContributedRouteResponse => ({ status: 400, body: { error, message } });

/** `POST /workspaces`'s answer when it saved (`saveWorkspace`). */
export interface SavedWorkspaceAnswer {
  readonly workspace: SavedWorkspace;
  /** Null, or (for a folder with no GitHub remote) why it won't be matched to a repo. */
  readonly note: string | null;
}

/** The plain sentence for a saved folder with no GitHub remote. */
export function noRemoteNote(path: string): string {
  return `${path} has no GitHub remote, so it won't be matched to a repo; it is saved, but a lookup by repo won't offer it`;
}

/**
 * Save `rawPath` (or touch it when already saved) at `at`, or the refusal,
 * before anything is written: `invalid_input` (not an absolute path),
 * `protected_folder` (D31, under `homeDir`), `not_checkout` or `unreadable`.
 * The stored path is `resolvedPath(rawPath)`; `repo` is its first GitHub
 * remote read now (null when none).
 */
export function saveWorkspace(store: Store, rawPath: unknown, at: Date, homeDir: string): { readonly ok: true; readonly answer: SavedWorkspaceAnswer } | { readonly ok: false; readonly response: ContributedRouteResponse } {
  if (typeof rawPath !== "string" || rawPath === "" || !isAbsolute(rawPath) || rawPath.length > MAX_PATH_CHARS || rawPath.includes("\0")) {
    return { ok: false, response: refused("invalid_input", `path must be an absolute folder path (at most ${MAX_PATH_CHARS} characters)`) };
  }
  if (isProtectedPath(rawPath, homeDir)) return { ok: false, response: refused("protected_folder", protectedFolderRefusal(rawPath)) };
  const path = resolvedPath(rawPath);
  const read = readWorkspaceRepos(path);
  if (read.kind === "not_checkout") return { ok: false, response: refused("not_checkout", `${rawPath} can't be saved: ${read.detail}`) };
  if (read.kind === "unreadable") return { ok: false, response: refused("unreadable", `${rawPath} can't be saved: ${read.detail}`) };
  const repo = read.repos[0] ?? null;
  const now = at.toISOString();
  const row = store
    .prepare<[string, string | null, string, string], SavedWorkspaceRow>(
      `INSERT INTO saved_workspaces (path, repo, added_at, last_used_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET repo = excluded.repo, last_used_at = excluded.last_used_at
       RETURNING ${COLUMNS}`,
    )
    .get(path, repo, now, now) as SavedWorkspaceRow;
  return { ok: true, answer: { workspace: { ...row, state: "ready" }, note: repo === null ? noRemoteNote(path) : null } };
}

/** Delete saved workspace `id`; whether a row was there. Touches nothing else. */
export function removeSavedWorkspace(store: Store, id: number): boolean {
  return store.prepare<[number]>("DELETE FROM saved_workspaces WHERE id = ?").run(id).changes > 0;
}

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

/** What the part reads from outside: the home dir the protected folders are under (read per request; default `os.homedir()`). A seam for tests. */
export interface WorkspacesPartOptions {
  readonly homeDir?: () => string;
}

/** `GET /workspaces[?repo=]`: the list, or the lookup for `repo`. */
async function listOrLookup(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const repo = req.query.repo;
  if (repo === undefined) return { status: 200, body: { workspaces: listSavedWorkspaces(req.store) } };
  if (!isRepoName(repo)) return refused("invalid_input", "repo must be <owner>/<repo>");
  return { status: 200, body: { workspaces: lookupSavedWorkspaces(req.store, repo) } };
}

/** `POST /workspaces/:id/remove`: that row only, or 404 not_found. */
async function removeRoute(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  if (!POSITIVE_INT.test(raw) || !Number.isSafeInteger(id) || !removeSavedWorkspace(req.store, id)) {
    return { status: 404, body: { error: "not_found", message: `no saved workspace ${JSON.stringify(raw.slice(0, 32))}` } };
  }
  return { status: 200, body: { removed: id } };
}

/** The part with its routes reading `options`; the shipped `workspacesPart` reads the real home dir. */
export function workspacesPartWith(options: WorkspacesPartOptions = {}): ConsolePart {
  const homeDirOf = options.homeDir ?? homedir;
  /** `POST /workspaces`: save or touch `{path}`, or the refusal. */
  const addRoute = async (req: ContributedRouteRequest): Promise<ContributedRouteResponse> => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return refused("invalid_input", "the body must be a JSON object {path}");
    const saved = saveWorkspace(req.store, (body as { path?: unknown }).path, req.now(), homeDirOf());
    return saved.ok ? { status: 200, body: saved.answer } : saved.response;
  };
  const routes: readonly ContributedRoute[] = Object.freeze([
    { method: "GET", path: "/workspaces", handler: listOrLookup },
    { method: "POST", path: "/workspaces", handler: addRoute },
    { method: "POST", path: "/workspaces/:id/remove", handler: removeRoute },
  ]);
  return Object.freeze({ ...emptyConsolePart("workspaces"), routes });
}

export const workspacesPart: ConsolePart = workspacesPartWith();
