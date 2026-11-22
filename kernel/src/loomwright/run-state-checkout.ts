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
// shape half is pure (`sessions/run-confinement.ts`).

import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
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
  const git = (args: readonly string[]): string => runGit(cwd, args);
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

/**
 * The roots a run session's confined commands stay inside (25c): its checkout (`checkout`, the session row's
 * recorded cwd) and every worktree `git worktree list --porcelain -z` names for it (the main one included), each
 * `resolvedPath`'d. `undefined`, so the gate refuses, when the checkout is not an absolute path, git fails or times
 * out, git lists a worktree path that is not absolute, or any root resolves to `/` (fail closed).
 */
export function confinementRoots(checkout: unknown): readonly string[] | undefined {
  if (typeof checkout !== "string" || !checkout.startsWith("/")) return undefined;
  let listed: string;
  try {
    listed = runGit(checkout, ["worktree", "list", "--porcelain", "-z"]);
  } catch {
    return undefined;
  }
  const roots = [resolvedPath(checkout)];
  for (const field of listed.split("\0")) {
    if (!field.startsWith("worktree ")) continue;
    const path = field.slice("worktree ".length);
    if (!path.startsWith("/")) return undefined;
    roots.push(resolvedPath(path));
  }
  return roots.some((r) => r === "/") ? undefined : [...new Set(roots)];
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
 * Whether `name` is a local branch in the checkout at absolute `cwd`: git's own reading of it
 * (`rev-parse --symbolic-full-name --verify --end-of-options <name>`, the reading `git merge` uses) must be exactly
 * `refs/heads/<name>`. A remote ref, a tag (which also wins an ambiguous name), a SHA, `HEAD`, `@{-1}`, an
 * expression, an unknown name, any git error or a timeout is `false`.
 */
export function isLocalBranch(cwd: string, name: string): boolean {
  try {
    return runGit(cwd, ["rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", name]).trim() === `refs/heads/${name}`;
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
 * - the `git -C` directory, resolved against the hook's `cwd` (`physicalPath`), must be inside a root and pass
 *   `confinementVerdict`; the command's operands are then resolved against it;
 * - every operand of `rm`, `mv`, `chmod`, `git rm`, `git mv` must pass `confinementVerdict` (inside a root, not
 *   under `<homeDir>/.claude`, a `.git` directory, `.supervisor/automate/` or `.supervisor/run.lock`, and for a
 *   recursive form not a root itself);
 * - a `git merge`'s branch must be a local branch (`isLocalBranch`) whose tree tracks no run state
 *   (`refTracksRunState`: a merge brings in a tracked run file as a checkout does).
 */
export function checkoutConfinement(view: RunGateView, hookCwd: unknown, checkout: () => unknown, homeDir: string): CheckoutConfinement {
  if (view.dir === undefined && view.shape.kind === "none") return { kind: "ok", gitCwd: hookCwd };
  const deny = (reason: "checkout_confinement" | "loomwright_run_state"): CheckoutConfinement => ({ kind: "deny", reason });
  if (view.shape.kind === "refuse") return deny("checkout_confinement");
  if (typeof hookCwd !== "string" || !hookCwd.startsWith("/")) return deny("checkout_confinement");
  const roots = confinementRoots(checkout());
  if (roots === undefined) return deny("checkout_confinement");
  const claude = join(homeDir, ".claude");
  const operandOf = (path: string): ResolvedOperand => ({ path, inside: roots.some((r) => isInsideResolved(path, r)), underClaude: isInsideResolved(path, claude) });
  let base = hookCwd;
  if (view.dir !== undefined) {
    base = physicalPath(hookCwd, view.dir);
    const why = confinementVerdict([operandOf(base)], roots, false);
    if (why !== undefined) return deny(refusalReason(why));
  }
  if (view.shape.kind === "paths") {
    const why = confinementVerdict(view.shape.operands.map((w) => operandOf(physicalPath(base, w))), roots, view.shape.recursive);
    if (why !== undefined) return deny(refusalReason(why));
  }
  if (view.shape.kind === "merge") {
    if (!isLocalBranch(base, view.shape.branch)) return deny("checkout_confinement");
    if (refTracksRunState(base, view.shape.branch)) return deny("loomwright_run_state");
  }
  return { kind: "ok", gitCwd: base };
}
