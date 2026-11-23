// The git lookup behind a Loomwright run session's checkout (phase 8 item 22g, review iteration 4).
//
// A run session may run `git checkout <ref>` / `git switch <ref>` (its run policy grants both), and git
// overwrites an ignored file when the checkout target tracks its path. So the session gate asks git, before it
// admits such a checkout, whether the target would change or add a file under `.supervisor/automate/`, where
// Loomwright's driver keeps the run state it trusts (`checkoutTargets`, `sessions/policy.ts`). This is the one
// place the kernel runs git for that, and it runs nothing but `git` with fixed argument shapes; it lives outside
// `src/sessions/`, whose only process spawner is `spawner.ts`. It also answers whether git ignores a path in a
// checkout (`gitIgnores`, 23t: the kernel writes Loomwright's config there only when no worker could commit it).
// And it is the I/O half of a run session's checkout confinement (phase 8 item 25c, `checkoutConfinement`): the
// session's worktree roots, each confined operand resolved on disk, and whether a merge names a local branch. The
// shape half is pure (`sessions/run-confinement.ts`). And it reads a run's declared checks from the base branch's
// committed files (phase 8 item 25d, `committedReads`): the parsing half is `automate/declared-checks.ts`.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { isInsideResolved, resolvedPath } from "../protected-paths.js";
import type { RunGateView } from "../sessions/policy.js";
import { confinementVerdict } from "../sessions/run-confinement.js";
import type { ConfinementRefusal, ResolvedOperand } from "../sessions/run-confinement.js";

/** `git -C <cwd> <args>`: the module's one process call, every use a fixed argument shape. */
function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * `git -C <cwd> -c safe.bareRepository=explicit <args>`: every lookup the run-session gate makes (25c review
 * iteration 3). A directory the session can write (`evil/HEAD`, `evil/config`, `evil/objects/`, `evil/refs/`) is an
 * implicit bare repository to git, whose config git would read and act on (`core.sshCommand`, `core.fsmonitor`); with
 * `explicit`, git refuses to treat a directory it discovered as a bare repository, so a lookup run in a
 * session-chosen directory fails (closed) there.
 */
function lookupGit(cwd: string, args: readonly string[]): string {
  return runGit(cwd, ["-c", "safe.bareRepository=explicit", ...args]);
}

/**
 * Whether git ignores `relPath` in the checkout at absolute `cwd` (`git check-ignore -q --`): `true`, `false`, or
 * `undefined` when git can't say (not a checkout, another error, a timeout, a relative `cwd`).
 */
export function gitIgnores(cwd: string, relPath: string): boolean | undefined {
  if (!cwd.startsWith("/")) return undefined;
  try {
    runGit(cwd, ["check-ignore", "-q", "--", relPath]);
    return true;
  } catch (err) {
    return (err as { status?: unknown }).status === 1 ? false : undefined;
  }
}

/** Whether `path` is a regular file (`lstat`: a symlink is not). */
function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** A path under a `.supervisor/automate/` directory, case-folded (APFS compares case-insensitively by default). */
const RUN_STATE_PATH = /(^|\/)\.supervisor\/automate\//i;

/**
 * Whether checking out `target` in `cwd` could change a run-state file
 * (review iteration 4). Git overwrites an ignored file when the checkout
 * target tracks its path (reproduced with git 2.55.0), so a branch carrying a
 * forged run file or sidecar would replace the run's own. `target` is read as
 * git reads it (`git rev-parse --verify <target>^{tree}`); a word git does not
 * read as a tree-ish (a new branch name or a pathspec, exit 1) is not a target.
 * For a tree, every entry under a `.supervisor/automate/` directory must be a
 * regular-file blob whose id equals the local file's (`git hash-object`): a
 * checkout then writes the same bytes. Any entry that would create a file the
 * work tree lacks, change one, or is not a plain blob reads as `true`. So a
 * repo whose default branch tracks Loomwright's finished run files (branch
 * mode off, trail PRs) still checks it out while those files are in sync.
 * Fails closed: no absolute `cwd`, any other git error, or a timeout.
 */
export function refTracksRunState(cwd: unknown, target: string): boolean {
  if (typeof cwd !== "string" || !cwd.startsWith("/")) return true;
  const git = (args: readonly string[]): string => lookupGit(cwd, args);
  let tree: string;
  try {
    tree = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${target}^{tree}`]).trim();
  } catch (err) {
    return (err as { status?: unknown }).status !== 1;
  }
  try {
    const root = git(["rev-parse", "--show-toplevel"]).trim();
    for (const entry of git(["ls-tree", "-r", "-z", tree]).split("\0")) {
      const tab = entry.indexOf("\t");
      if (tab === -1) continue;
      const path = entry.slice(tab + 1);
      if (!RUN_STATE_PATH.test(path)) continue;
      const [mode, type, blob] = entry.slice(0, tab).split(" ");
      if (type !== "blob" || (mode !== "100644" && mode !== "100755")) return true;
      const local = join(root, path);
      if (!isRegularFile(local)) return true;
      if (git(["hash-object", "--no-filters", "--", local]).trim() !== blob) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// ---- 25c: a run session's file operations, `git -C` and `git merge` stay inside its checkout ----

/** Whether two paths name the same place once resolved (`isInsideResolved` both ways: case-folded, firmlink-free). */
function sameResolved(a: string, b: string): boolean {
  return isInsideResolved(a, b) && isInsideResolved(b, a);
}

/** The text of a regular file (`lstat`: never through a symlink), else `undefined`. */
function regularFileText(path: string): string | undefined {
  try {
    return lstatSync(path).isFile() ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** A path git wrote in a link file (`<root>/.git`'s `gitdir:` line, `.git/worktrees/<id>/gitdir`): one line, absolute or relative to `dir`. */
function linkTarget(dir: string, text: string): string | undefined {
  const line = text.replace(/\r?\n$/, "");
  if (line === "" || line.includes("\n")) return undefined;
  return resolvedPath(line.startsWith("/") ? line : join(dir, line));
}

/**
 * Whether a worktree git listed is one git itself made for this repository, judged on files the session cannot write
 * (review iteration 2), with `common` the repository's resolved common `.git` directory:
 * - the main worktree: `<path>/.git` is a directory (`lstat`: not a symlink) that resolves to `common`;
 * - a linked worktree: `<path>/.git` is a regular file whose `gitdir:` line resolves to a directory directly under
 *   `<common>/worktrees/`, and that entry's own `gitdir` file resolves back to `<path>/.git`.
 * A forged `.git/worktrees/<id>` entry naming an existing directory elsewhere fails the second rule unless that
 * directory already holds a `.git` file pointing back at the entry, and a run session writes neither (the policy and
 * the gate refuse a Write, Edit or NotebookEdit under a `.git` segment, resolved on disk: `writeTargetInGitDir`).
 */
function trustedWorktree(path: string, common: string): boolean {
  const dotGit = join(path, ".git");
  let stat;
  try {
    stat = lstatSync(dotGit);
  } catch {
    return false;
  }
  if (stat.isDirectory()) return sameResolved(dotGit, common);
  const text = stat.isFile() ? regularFileText(dotGit) : undefined;
  const m = text === undefined ? null : /^gitdir: (.+)$/.exec(text.replace(/\r?\n$/, ""));
  if (m === null) return false;
  const admin = linkTarget(path, m[1] as string);
  if (admin === undefined || !sameResolved(dirname(admin), join(common, "worktrees"))) return false;
  try {
    if (!lstatSync(admin).isDirectory()) return false;
  } catch {
    return false;
  }
  const back = regularFileText(join(admin, "gitdir"));
  const backTarget = back === undefined ? undefined : linkTarget(admin, back);
  return backTarget !== undefined && sameResolved(backTarget, dotGit);
}

/**
 * The roots a run session's confined commands stay inside (25c): its checkout (`checkout`, the session row's
 * recorded cwd) and every worktree `git worktree list --porcelain -z` names for it (the main one included), each
 * `resolvedPath`'d. git builds that list from `.git/worktrees/*` and their `gitdir` files, so a listed path is kept
 * only when the files git made for it agree (`trustedWorktree`): not flagged `prunable`, not `bare`, and its `.git`
 * links back to the entry that listed it (review iterations 1 and 2). A forged entry naming a path outside the
 * checkout is how that path would otherwise become a root. `undefined`, so the gate refuses, when the checkout is not
 * an absolute path, git fails or times out, git lists a worktree path that is not absolute, or any root resolves to
 * `/` (fail closed).
 */
export function confinementRoots(checkout: unknown): readonly string[] | undefined {
  return confinementRepo(checkout)?.roots;
}

/** `confinementRoots` and the repository's resolved common `.git` directory (`common`), which `sameRepository` matches. */
function confinementRepo(checkout: unknown): { readonly roots: readonly string[]; readonly common: string } | undefined {
  if (typeof checkout !== "string" || !checkout.startsWith("/")) return undefined;
  let listed: string;
  let common: string;
  try {
    listed = lookupGit(checkout, ["worktree", "list", "--porcelain", "-z"]);
    const dir = lookupGit(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
    if (!dir.startsWith("/")) return undefined;
    common = resolvedPath(dir);
  } catch {
    return undefined;
  }
  // One record per worktree: a `worktree <path>` field, then its attribute fields (`HEAD`, `branch`, `bare`, `locked`,
  // `prunable <reason>`, …), each NUL-terminated, records separated by an empty field.
  const records: { path: string; dropped: boolean }[] = [];
  for (const field of listed.split("\0")) {
    if (field.startsWith("worktree ")) {
      const path = field.slice("worktree ".length);
      if (!path.startsWith("/")) return undefined;
      records.push({ path, dropped: false });
    } else if ((field === "prunable" || field.startsWith("prunable ") || field === "bare") && records.length > 0) {
      (records[records.length - 1] as { dropped: boolean }).dropped = true;
    }
  }
  const kept = records.filter((r) => !r.dropped && trustedWorktree(r.path, common));
  const roots = [resolvedPath(checkout), ...kept.map((r) => resolvedPath(r.path))];
  return roots.some((r) => r === "/") ? undefined : { roots: [...new Set(roots)], common };
}

/**
 * Whether git, run in `dir`, works on this checkout's own repository (25c review iteration 3): its common `.git`
 * directory resolves to `common` and its work-tree top level to one of `roots`, asked with
 * `safe.bareRepository=explicit` (`lookupGit`). A directory the session wrote as a bare repository (`HEAD`, `config`,
 * `objects/`, `refs/`) is refused by git there, and a nested repository, a submodule or a `.git` file redirecting the
 * work tree answers another common dir or top level. So `git -C <dir> <rest>` never runs a repository config the
 * session could author. `false` on any git error, a timeout, or output that is not two absolute lines (fail closed).
 */
function sameRepository(dir: string, roots: readonly string[], common: string): boolean {
  let out: string;
  try {
    out = lookupGit(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"]);
  } catch {
    return false;
  }
  const lines = out.replace(/\n$/, "").split("\n");
  const [gitCommon, top] = lines;
  if (lines.length !== 2 || gitCommon === undefined || top === undefined || !gitCommon.startsWith("/") || !top.startsWith("/")) return false;
  return sameResolved(gitCommon, common) && roots.some((r) => sameResolved(top, r));
}

/**
 * `word` resolved against the absolute `base` as the kernel resolves a path: segment by segment, each prefix through
 * `resolvedPath` (symlinks as far as they exist), so a `..` after a symlink leaves the symlink's target, not its
 * written parent (`resolve()` would fold `link/..` away lexically).
 */
export function physicalPath(base: string, word: string): string {
  let current = resolvedPath(word.startsWith("/") ? "/" : base);
  for (const seg of word.split("/")) {
    if (seg === "" || seg === ".") continue;
    current = seg === ".." ? dirname(current) : resolvedPath(join(current, seg));
  }
  return current;
}

/**
 * `word` resolved against the absolute `base` as a file tool writes it: segment by segment, every symlink followed
 * through `readlink` (a dangling one too, since a write through it creates its target), then `resolvedPath`. A word
 * that does not exist yet is kept as written past its longest existing prefix. `undefined` past 40 links, or on any
 * error but "not there" (fail closed).
 */
function writtenPath(base: string, word: string): string | undefined {
  const pending = (word.startsWith("/") ? word : `${base}/${word}`).split("/");
  let current = "/";
  let links = 0;
  while (pending.length > 0) {
    const seg = pending.shift() as string;
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, seg);
    let link: string | undefined;
    try {
      if (lstatSync(next).isSymbolicLink()) link = readlinkSync(next);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return undefined;
    }
    if (link === undefined) {
      current = next;
      continue;
    }
    links += 1;
    if (links > 40) return undefined;
    pending.unshift(...link.split("/"));
    if (link.startsWith("/")) current = "/";
  }
  return resolvedPath(current);
}

/**
 * Whether a run session's Write, Edit or NotebookEdit of `path` lands under a `.git` segment (or on one: a worktree's
 * `.git` file) once resolved on disk (review iteration 2): `path` against the hook's absolute `hookCwd`, every
 * symlink followed (`writtenPath`), so a committed `docs -> .git` or a final-component link into `.git` is caught,
 * which the policy's text check (`writesGitDir`, `sessions/policy.ts`) cannot see. `true` (refuse) when a relative
 * path has no absolute `hookCwd`, or the path cannot be resolved.
 */
export function writeTargetInGitDir(path: string, hookCwd: unknown): boolean {
  if (!path.startsWith("/") && (typeof hookCwd !== "string" || !hookCwd.startsWith("/"))) return true;
  const written = writtenPath(typeof hookCwd === "string" ? hookCwd : "/", path);
  return written === undefined || written.toLowerCase().split("/").includes(".git");
}

/**
 * Whether `name` is a local branch in the checkout at absolute `cwd`: git's own reading of it
 * (`rev-parse --symbolic-full-name --verify --end-of-options <name>`, the reading `git merge` uses) must be exactly
 * `refs/heads/<name>`. A remote ref, a tag (which also wins an ambiguous name), a SHA, `HEAD`, `@{-1}`, an
 * expression, an unknown name, any git error or a timeout is `false`.
 */
export function isLocalBranch(cwd: string, name: string): boolean {
  try {
    return lookupGit(cwd, ["rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", name]).trim() === `refs/heads/${name}`;
  } catch {
    return false;
  }
}

/** `checkoutConfinement`'s answer: refused and why, or admitted with the directory git runs in (the `git -C` one, else the hook's cwd). */
export type CheckoutConfinement =
  | { readonly kind: "deny"; readonly reason: "checkout_confinement" | "loomwright_run_state" }
  | { readonly kind: "ok"; readonly gitCwd: unknown };

/** A refusal's reason: run state (or the run lock) is `loomwright_run_state`, as the policy's own guard says it; the rest `checkout_confinement`. */
function refusalReason(why: ConfinementRefusal): "checkout_confinement" | "loomwright_run_state" {
  return why === "run_state" ? "loomwright_run_state" : "checkout_confinement";
}

/**
 * The session gate's check of a run session's allowed shell command (25c), after `decideToolUse` admitted its
 * shape (`view`, `runGateView`). A command with no `git -C` directory and no confined shape needs nothing (and runs
 * no git). Otherwise, failing closed on no absolute hook `cwd` and on unreadable roots (`confinementRoots` of
 * `checkout()`, the session row's cwd):
 * - the `git -C` directory, resolved against the hook's `cwd` (`physicalPath`), must be inside a root, pass
 *   `confinementVerdict`, and have no `.supervisor` segment (`loomwright_run_state`: git reads the rest's relative
 *   words against it, the policy's run-state guard reads them as text; review iteration 2), and git there must work
 *   on the checkout's own repository (`sameRepository`, review iteration 3); the command's operands are then
 *   resolved against it;
 * - every operand of `rm`, `mv`, `chmod`, `git rm`, `git mv` must pass `confinementVerdict` (inside a root, not
 *   under `<homeDir>/.claude`, a `.git` directory, `.supervisor/automate/` or `.supervisor/run.lock`, not a
 *   `.supervisor` directory in any position, and for a recursive form or a move's source neither a root nor an
 *   ancestor of one);
 * - a `git merge`'s branch must be a local branch (`isLocalBranch`) whose tree tracks no run state
 *   (`refTracksRunState`: a merge brings in a tracked run file as a checkout does).
 */
export function checkoutConfinement(view: RunGateView, hookCwd: unknown, checkout: () => unknown, homeDir: string): CheckoutConfinement {
  if (view.dir === undefined && view.shape.kind === "none") return { kind: "ok", gitCwd: hookCwd };
  const deny = (reason: "checkout_confinement" | "loomwright_run_state"): CheckoutConfinement => ({ kind: "deny", reason });
  if (view.shape.kind === "refuse") return deny("checkout_confinement");
  if (typeof hookCwd !== "string" || !hookCwd.startsWith("/")) return deny("checkout_confinement");
  const repo = confinementRepo(checkout());
  if (repo === undefined) return deny("checkout_confinement");
  const { roots, common } = repo;
  const claude = join(homeDir, ".claude");
  const operandOf = (path: string): ResolvedOperand => ({ path, inside: roots.some((r) => isInsideResolved(path, r)), underClaude: isInsideResolved(path, claude) });
  let base = hookCwd;
  if (view.dir !== undefined) {
    base = physicalPath(hookCwd, view.dir);
    const why = confinementVerdict([operandOf(base)], roots, false);
    if (why !== undefined) return deny(refusalReason(why));
    // git reads `<rest>`'s relative words against `<dir>`, while the policy's run-state guard reads them as text
    // (`git -C .supervisor add -f automate/r1.md`): a `<dir>` at or under a `.supervisor` directory is refused
    // outright (review iteration 2). Outside one, a word reaching run state must name `supervisor` itself, which
    // the guard reads.
    if (base.toLowerCase().split("/").includes(".supervisor")) return deny("loomwright_run_state");
    // Inside a root is not enough: a directory the session wrote as a bare repository would have git run its config
    // (`core.sshCommand` on a fetch). git in `<dir>` must work on the checkout's own repository (review iteration 3).
    if (!sameRepository(base, roots, common)) return deny("checkout_confinement");
  }
  if (view.shape.kind === "paths") {
    const why = confinementVerdict(view.shape.operands.map((w) => operandOf(physicalPath(base, w))), roots, view.shape.recursive, view.shape.moved);
    if (why !== undefined) return deny(refusalReason(why));
  }
  if (view.shape.kind === "merge") {
    if (!isLocalBranch(base, view.shape.branch)) return deny("checkout_confinement");
    if (refTracksRunState(base, view.shape.branch)) return deny("loomwright_run_state");
  }
  return { kind: "ok", gitCwd: base };
}

// ---- 25d: a run's declared checks, read from the base branch's committed files ----

/** A commit id as git prints it (SHA-1 or SHA-256). */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The largest committed file the declared-check reader takes (a bigger one reads `too_large`). */
export const MAX_COMMITTED_FILE_BYTES = 1024 * 1024;

/** One committed file at a commit: its text, or that the commit has none there, or why it can't be read. */
export type CommittedFile =
  | { readonly kind: "file"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly why: "not_a_regular_file" | "too_large" | "git_failed" };

/** The base commit's reads the declared-check reader takes (`automate/declared-checks.ts`): git, never the working tree. */
export interface CommittedReads {
  /** The commit `ref` names (`<ref>^{commit}`), else `undefined`. */
  readonly commitOf: (ref: string) => string | undefined;
  /** The ref `refs/remotes/origin/HEAD` points at (`refs/remotes/origin/<branch>`), else `undefined`. */
  readonly originHead: () => string | undefined;
  /** The names of the regular files directly under `dir` at commit `sha`; `[]` when it has no such directory, `undefined` when git can't say. */
  readonly listFiles: (sha: string, dir: string) => readonly string[] | undefined;
  /** The file at `path` in commit `sha`. */
  readonly readFile: (sha: string, path: string) => CommittedFile;
}

/** One `git ls-tree -z -l` entry: mode, type, object id, size and path. */
interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly id: string;
  readonly size: number | undefined;
  readonly path: string;
}

/** `git ls-tree -z -l --full-tree --end-of-options <sha> -- <path>` in `cwd`, parsed; `undefined` on any git error. */
function lsTree(cwd: string, sha: string, path: string): readonly TreeEntry[] | undefined {
  let out: string;
  try {
    out = lookupGit(cwd, ["ls-tree", "-z", "-l", "--full-tree", "--end-of-options", sha, "--", path]);
  } catch {
    return undefined;
  }
  const entries: TreeEntry[] = [];
  for (const field of out.split("\0")) {
    const tab = field.indexOf("\t");
    if (tab === -1) continue;
    const [mode, type, id, size] = field.slice(0, tab).split(/ +/);
    if (mode === undefined || type === undefined || id === undefined) return undefined;
    entries.push({ mode, type, id, size: size !== undefined && /^\d+$/.test(size) ? Number(size) : undefined, path: field.slice(tab + 1) });
  }
  return entries;
}

/** Whether a tree entry is a regular file (a blob of mode 100644 or 100755: never a symlink or a submodule). */
function isRegularBlob(entry: TreeEntry): boolean {
  return entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755");
}

/**
 * The committed reads a run's declared checks are taken from (25d), in the checkout at absolute `cwd`: each a fixed
 * argument shape through `lookupGit`, failing closed (`undefined`, `unreadable`) on any git error or timeout. Only
 * committed objects are read (`rev-parse`, `symbolic-ref`, `ls-tree`, `cat-file` of a commit id), never the working
 * tree or the index. The kernel never fetches: the refs are what the checkout last fetched.
 */
export function committedReads(cwd: string): CommittedReads {
  const absolute = cwd.startsWith("/");
  return {
    commitOf(ref) {
      if (!absolute) return undefined;
      try {
        const sha = lookupGit(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]).trim();
        return COMMIT_ID.test(sha) ? sha : undefined;
      } catch {
        return undefined;
      }
    },
    originHead() {
      if (!absolute) return undefined;
      try {
        const ref = lookupGit(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).trim();
        return ref.startsWith("refs/remotes/origin/") && !ref.includes("\n") ? ref : undefined;
      } catch {
        return undefined;
      }
    },
    listFiles(sha, dir) {
      if (!absolute || !COMMIT_ID.test(sha)) return undefined;
      const entries = lsTree(cwd, sha, `${dir.replace(/\/+$/, "")}/`);
      if (entries === undefined) return undefined;
      const prefix = `${dir.replace(/\/+$/, "")}/`;
      return entries.filter((e) => isRegularBlob(e) && e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes("/")).map((e) => e.path.slice(prefix.length));
    },
    readFile(sha, path) {
      if (!absolute || !COMMIT_ID.test(sha)) return { kind: "unreadable", why: "git_failed" };
      const entries = lsTree(cwd, sha, path);
      if (entries === undefined) return { kind: "unreadable", why: "git_failed" };
      const entry = entries.find((e) => e.path === path);
      if (entry === undefined) return { kind: "absent" };
      if (!isRegularBlob(entry) || !COMMIT_ID.test(entry.id)) return { kind: "unreadable", why: "not_a_regular_file" };
      if (entry.size === undefined || entry.size > MAX_COMMITTED_FILE_BYTES) return { kind: "unreadable", why: "too_large" };
      try {
        return { kind: "file", text: lookupGit(cwd, ["cat-file", "blob", "--end-of-options", entry.id]) };
      } catch {
        return { kind: "unreadable", why: "git_failed" };
      }
    },
  };
}
