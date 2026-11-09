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

/** `owner/repo` of a GitHub remote URL (`https://github.com/o/r.git`, `git@github.com:o/r`, `ssh://git@github.com/o/r`), else `undefined`. */
export function repoOfRemote(url: string): string | undefined {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m === null ? undefined : `${m[1] as string}/${m[2] as string}`;
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

/** The GitHub repos the checkout at `workspace` has as remotes (empty when it is not a git checkout or its config cannot be read). */
export function remoteRepos(workspace: string): readonly string[] {
  try {
    const dir = gitConfigDir(workspace);
    if (dir === undefined) return [];
    const found: string[] = [];
    for (const line of readFileSync(join(dir, "config"), "utf8").split("\n")) {
      const m = /^\s*url\s*=\s*(.+)$/.exec(line);
      const repo = m === null ? undefined : repoOfRemote(m[1] as string);
      if (repo !== undefined) found.push(repo);
    }
    return found;
  } catch {
    return [];
  }
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
