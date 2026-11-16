// The git lookup behind a Loomwright run session's checkout (phase 8 item 22g, review iteration 4).
//
// A run session may run `git checkout <ref>` / `git switch <ref>` (its run policy grants both), and git
// overwrites an ignored file when the checkout target tracks its path. So the session gate asks git, before it
// admits such a checkout, whether the target would change or add a file under `.supervisor/automate/`, where
// Loomwright's driver keeps the run state it trusts (`checkoutTargets`, `sessions/policy.ts`). This is the one
// place the kernel runs git for that, and it runs nothing but `git` with fixed argument shapes; it lives outside
// `src/sessions/`, whose only process spawner is `spawner.ts`.

import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

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
  const git = (args: readonly string[]): string => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
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
