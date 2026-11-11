// The automate feature's workspace lookup (phase 8 item 09, extracted in item 10
// so the runner tools, the PR tracker and the routing tool share one copy).
//
// The checkout is the calling agent's workspace for a repo: one of the
// `workspaces` in its settings file whose git remote names `<owner>/<repo>`.
// Without one, `no_workspace`. Workspaces are the owner's, outside protected
// folders and the data dir (the settings reader's checks). Reads the settings
// file and the checkout's git config only; it runs no process and writes nothing.
//
// The `studio` CLI loads this module through the feature registry, so it imports
// only types, the feature seam, the settings reader and node `fs`/`path`: never
// the Agent SDK, the session manager or `kernel.ts`.
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readAgentSettings } from "../agents/settings.js";
import type { ContributedToolContext } from "../features/contribution.js";

/** An error whose message starts with the refusal code, the shape every automate tool answers. */
function refuse(code: "no_workspace", detail: string): Error {
  return new Error(`${code}: ${detail}`);
}

// Remote URL shapes that name a repo on github.com, anchored at both ends so the
// host is exactly `github.com` (case-insensitive): never a path segment of
// another host (`https://evil.example/github.com/o/r`), a longer host
// (`github.com.evil.example`) or a host that merely ends in it (`evilgithub.com`).
// The https form allows userinfo (`https://user@github.com/o/r`) but no `@` or
// `/` inside it, so `https://github.com@evil.example/o/r` does not read as GitHub.
const GITHUB_REMOTES: readonly RegExp[] = [
  /^https?:\/\/(?:[^@/\s]+@)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  /^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
];

/**
 * `owner/repo` of a GitHub remote URL, else `undefined`. Accepted:
 * `https://github.com/o/r(.git)`, `http(s)://user@github.com/o/r`,
 * `git@github.com:o/r(.git)` and `ssh://git@github.com/o/r(.git)`; the host
 * must be exactly `github.com`.
 */
export function repoOfRemote(url: string): string | undefined {
  const trimmed = url.trim();
  for (const re of GITHUB_REMOTES) {
    const m = re.exec(trimmed);
    if (m === null) continue;
    const owner = m[1] as string;
    const repo = m[2] as string;
    if (owner === "." || owner === ".." || repo === "." || repo === "..") return undefined;
    return `${owner}/${repo}`;
  }
  return undefined;
}

/** The directory holding a checkout's git config: `.git` itself, or the common dir a worktree's `.git` file points to. */
export function gitConfigDir(workspace: string): string | undefined {
  const dotGit = join(workspace, ".git");
  const st = lstatSync(dotGit);
  if (st.isDirectory()) return dotGit;
  if (!st.isFile()) return undefined;
  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
  if (pointer === null) return undefined;
  const gitdir = resolve(workspace, (pointer[1] as string).trim());
  try {
    return resolve(gitdir, readFileSync(join(gitdir, "commondir"), "utf8").trim());
  } catch {
    return gitdir;
  }
}

/** The GitHub repos a git config's text names as remote URLs (`repoOfRemote`, the one remote parse), in order. */
function reposOfConfig(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*url\s*=\s*(.+)$/.exec(line);
    const repo = m === null ? undefined : repoOfRemote(m[1] as string);
    if (repo !== undefined) found.push(repo);
  }
  return found;
}

/**
 * What reading a workspace's GitHub remotes found (`readWorkspaceRepos`):
 * `repos` (a git checkout; the list is empty when no remote is on GitHub),
 * `not_checkout` (nothing there, or no git checkout: a definite answer), or
 * `unreadable` (a read failed, so whether it is a checkout is unknown).
 * `detail` says which, in plain words.
 */
export type WorkspaceRepos =
  | { readonly kind: "repos"; readonly repos: readonly string[] }
  | { readonly kind: "not_checkout"; readonly detail: string }
  | { readonly kind: "unreadable"; readonly detail: string };

/** An error's `code` (`ENOENT`, `EACCES`, …), or undefined. */
function codeOf(err: unknown): string | undefined {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** A missing path: the answer is "not there", never "unknown". */
function isMissing(err: unknown): boolean {
  const code = codeOf(err);
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Whether anything is at `path` (false only when it is definitely missing). */
function pathPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    return !isMissing(err);
  }
}

/**
 * The GitHub remotes of the checkout at `workspace`, telling a definite "not a
 * checkout" (a missing folder, `.git` or git config) from a read that failed
 * (`EACCES`, `EPERM`, …: `unreadable`, never "not a checkout"), for the
 * charter readiness check. The same `gitConfigDir` and remote parse as
 * `remoteRepos`. Reads only; never throws.
 */
export function readWorkspaceRepos(workspace: string): WorkspaceRepos {
  const unreadable = (err: unknown, what: string): WorkspaceRepos => ({ kind: "unreadable", detail: `its ${what} can't be read (${codeOf(err) ?? "error"})` });
  let dir: string | undefined;
  try {
    dir = gitConfigDir(workspace);
  } catch (err) {
    if (!isMissing(err)) return unreadable(err, ".git");
    return { kind: "not_checkout", detail: pathPresent(workspace) ? "it is not a git checkout" : "the folder does not exist" };
  }
  if (dir === undefined) return { kind: "not_checkout", detail: "it is not a git checkout" };
  let text: string;
  try {
    text = readFileSync(join(dir, "config"), "utf8");
  } catch (err) {
    if (isMissing(err)) return { kind: "not_checkout", detail: "it has no git config" };
    return unreadable(err, "git config");
  }
  return { kind: "repos", repos: reposOfConfig(text) };
}

/** The GitHub repos the checkout at `workspace` has as remotes (empty when it is not a git checkout or its config cannot be read). */
export function remoteRepos(workspace: string): readonly string[] {
  const read = readWorkspaceRepos(workspace);
  return read.kind === "repos" ? read.repos : [];
}

/** The agent's workspace that is a checkout of `repo`, else a `no_workspace` refusal. */
export function checkoutOf(ctx: ContributedToolContext, agent: string, repo: string): string {
  const settings = readAgentSettings(ctx.store.dataDir, agent);
  if (!settings.ok) throw refuse("no_workspace", `agent ${agent}'s settings do not read (${settings.error}), so it has no workspace for ${repo}`);
  const want = repo.toLowerCase();
  const found = (settings.settings.workspaces ?? []).find((ws) => remoteRepos(ws).some((r) => r.toLowerCase() === want));
  if (found === undefined) {
    throw refuse("no_workspace", `agent ${agent} has no workspace that is a git clone of ${repo}; the owner lists one in the agent's settings (workspaces)`);
  }
  return found;
}
