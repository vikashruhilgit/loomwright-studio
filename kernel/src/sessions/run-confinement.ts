// What a kernel run session's file operations, `git -C` and `git merge` may name (phase 8 item 25c).
//
// A run session (a policy naming `loomwrightScripts`) may `rm`, `mv`, `chmod`, `git rm` and `git mv` files, run
// `git -C <dir> <subcommand>` and `git merge <local-branch>`, but only inside its own checkout and the checkout's
// git worktrees. The decision has two halves:
// - the shape, here and pure: which words are path operands, which options each program may take (a closed set
//   per program; any other option fails closed), and which words the shell or git would expand (a glob, a brace, a
//   `~` form, a `..` segment, git pathspec magic), which are refused unread. `decideToolUse` (`policy.ts`) reads it.
// - the file system, in the session gate: `kernel/src/loomwright/run-state-checkout.ts` resolves each operand and
//   the confinement roots (the session row's realpath cwd and `git worktree list`) with `resolvedPath`, and passes
//   them back to `confinementVerdict` here, which decides on the resolved paths alone.
//
// Pure: string and path math only. No `node:fs`, no `node:child_process` (`automate-launch.test.ts` pins that the
// I/O lives in run-state-checkout.ts). The words are untrusted data from the model: read, never executed.

/**
 * Characters an operand may not hold: a glob or brace the shell could expand (and git matches a glob in a pathspec
 * across `/`, so `'*.md'` reaches files no word names). Quoting does not matter: a quoted `*` is refused too (fail
 * closed: the words here are already unquoted).
 */
const EXPANDING = /[*?[\]{}]/;

/**
 * Whether a word is a literal path the shell passes as written: no glob or brace character, and not a `~` form
 * (`~`, `~/x`, `~user`, `~+`). The `git -C` directory, every confined operand and every 23f install-read word must be
 * one. Pure.
 */
export function isLiteralWord(word: string): boolean {
  return word !== "" && !EXPANDING.test(word) && !word.startsWith("~");
}

/** Why a shape is refused (`checkout_confinement`); each is pinned by a test. */
export type ShapeRefusal =
  /** An option outside the program's closed set (or an option cluster holding one). */
  | "option"
  /** An option whose value is a path (`mv -t <dir>`, `--target-directory`), which the operand walk would not read. */
  | "path_option"
  /** An operand the shell or git would expand or reinterpret: a glob, a brace, a `~` form, a `..` segment, a leading `:` (git pathspec magic). */
  | "pattern"
  /** Too few operands for the program (`rm` with none, `mv a`), or a `chmod` with no valid mode. */
  | "operands"
  /** `git -C` with any other global option before the subcommand (`-c`, `--git-dir`, `--work-tree`, `--exec-path`, a second `-C`). */
  | "global_option"
  /** A `git merge` that is not `git merge <name> [--no-ff] [-m <msg>]`. */
  | "merge_shape"
  /**
   * A command that could write a ref the kernel reads a run's base from (25d, `refShape`): a `git fetch` refspec
   * naming a destination (`<src>:<dst>`, a leading `+`); a `git push` destination that could name a remote-tracking or
   * replace ref (`refs/…` outside `refs/heads/` and `refs/tags/`, or `origin…`, `remotes/…`, `replace/…`, which git's
   * push matching expands under `refs/`); `git stash export` (its `--to-ref` writes any ref). An option outside
   * fetch's, push's or ls-remote's closed set (`--refmap`, `--upload-pack`, any abbreviation of either) is `option`.
   */
  | "ref_destination"
  /**
   * `--output` or `--output=<file>` on `git log`, `git show`, `git diff` or `git stash` (`stash show`, `stash list`):
   * it writes the command's output to any path, `.git/` included (25d review iteration 2).
   */
  | "file_output";

/**
 * A confined command's shape (`confinedShape`):
 * - `none`: not a confined program; nothing more to check here.
 * - `refuse`: the shape is refused (`checkout_confinement`).
 * - `paths`: every word of `operands` must resolve inside the checkout or a worktree (`confinementVerdict`);
 *   `recursive` when an option walks a tree (`-r`, `-R`); `moved` is how many leading operands a move takes away
 *   (`mv`, `git mv`: every operand but the last, the destination; 0 for every other program).
 * - `merge`: `branch` must be a local branch (`refs/heads/<branch>`), asked of git by the session gate.
 */
export type ConfinedShape =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly why: ShapeRefusal }
  | { readonly kind: "paths"; readonly operands: readonly string[]; readonly recursive: boolean; readonly moved: number }
  | { readonly kind: "merge"; readonly branch: string };

/** One program's closed option set: the short letters it takes (alone or clustered), the long options, and the letters that walk a tree. */
interface OptionSet {
  readonly letters: string;
  readonly long: readonly string[];
  readonly recursive: string;
  /** Whether `--` ends the options (only `git rm` lists it). */
  readonly endOfOptions: boolean;
  /** At least this many operands. */
  readonly minOperands: number;
  /** Whether the program moves its leading operands away (`mv`, `git mv`; `-t` is refused, so the last operand is the destination). */
  readonly moves: boolean;
}

/**
 * The closed option sets (25c's brief): `rm` `-f -r -R -v`; `mv` `-f -n -v`; `chmod` `-R -v` and a mode operand;
 * `git rm` `-r -f -q --cached --`; `git mv` `-f -k -n -v`. A cluster of listed letters is one option word (`-rf`).
 * Any other word starting with `-` is refused, so a later option that runs or writes something is never admitted by
 * default.
 */
const OPTION_SETS: Readonly<Record<"rm" | "mv" | "chmod" | "git rm" | "git mv", OptionSet>> = Object.freeze({
  rm: { letters: "frRv", long: [], recursive: "rR", endOfOptions: false, minOperands: 1, moves: false },
  mv: { letters: "fnv", long: [], recursive: "", endOfOptions: false, minOperands: 2, moves: true },
  chmod: { letters: "Rv", long: [], recursive: "R", endOfOptions: false, minOperands: 1, moves: false },
  "git rm": { letters: "rfq", long: ["--cached"], recursive: "r", endOfOptions: true, minOperands: 1, moves: false },
  "git mv": { letters: "fknv", long: [], recursive: "", endOfOptions: false, minOperands: 2, moves: true },
});

/**
 * Options whose value is a path, refused by name before the closed-set check, so the refusal says so (`path_option`):
 * `mv -t <dir>` / `--target-directory` (GNU), `-S` / `--suffix` (a backup suffix), and their glued forms.
 */
const PATH_VALUE_OPTIONS: readonly string[] = ["-t", "--target-directory", "-S", "--suffix"];

/** A `chmod` mode: octal (`755`), or symbolic clauses (`+x`, `u+x,g-w`, `a=r`). */
const CHMOD_MODE = /^([0-7]{1,4}|[ugoa]*[-+=][rwxXstugo]*([-+=][rwxXstugo]*)*(,[ugoa]*[-+=][rwxXstugo]*([-+=][rwxXstugo]*)*)*)$/;

/**
 * Whether an operand is refused unread: not literal, a `..` segment (no Loomwright step needs one, and refusing it
 * leaves no lexical-versus-physical `..` question), or git pathspec magic (`:`).
 */
function patternOperand(word: string, git: boolean): boolean {
  if (!isLiteralWord(word)) return true;
  if (word.split("/").includes("..")) return true;
  return git && word.startsWith(":");
}

/** `words` (the program's own words, after the program and any subcommand) read against `set`. */
function pathShape(args: readonly string[], set: OptionSet, mode: boolean, git: boolean): ConfinedShape {
  const operands: string[] = [];
  let recursive = false;
  let options = true;
  let modeSeen = !mode;
  for (const w of args) {
    if (options && w.startsWith("-") && w !== "-") {
      if (set.endOfOptions && w === "--") {
        options = false;
        continue;
      }
      if (PATH_VALUE_OPTIONS.some((o) => w === o || w.startsWith(o.startsWith("--") ? `${o}=` : o))) return { kind: "refuse", why: "path_option" };
      if (w.startsWith("--")) {
        if (!set.long.includes(w)) return { kind: "refuse", why: "option" };
        continue;
      }
      const letters = w.slice(1);
      if (![...letters].every((c) => set.letters.includes(c))) return { kind: "refuse", why: "option" };
      if ([...letters].some((c) => set.recursive.includes(c))) recursive = true;
      continue;
    }
    if (!modeSeen) {
      if (!CHMOD_MODE.test(w)) return { kind: "refuse", why: "operands" };
      modeSeen = true;
      continue;
    }
    if (patternOperand(w, git)) return { kind: "refuse", why: "pattern" };
    operands.push(w);
  }
  if (!modeSeen || operands.length < set.minOperands) return { kind: "refuse", why: "operands" };
  return { kind: "paths", operands, recursive, moved: set.moves ? operands.length - 1 : 0 };
}

/**
 * `git merge`'s admitted shape: exactly one operand, the branch, plus `--no-ff` and `-m <msg>` (the message any
 * word). No other option (`-s`, `-X`, `--strategy`, `--strategy-option`, `--abort`, `--continue`, `--squash`,
 * `--into-name`, a glued `-mx`), and the branch a literal name that is no option and no pathspec. Whether the
 * name is a local branch is the session gate's question to git (`refs/heads/<name>`, never a remote ref, a tag, a
 * SHA or an expression).
 */
function mergeShape(args: readonly string[]): ConfinedShape {
  const names: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const w = args[i] as string;
    if (w === "--no-ff") continue;
    if (w === "-m") {
      if (args[i + 1] === undefined) return { kind: "refuse", why: "merge_shape" };
      i += 1;
      continue;
    }
    if (w.startsWith("-")) return { kind: "refuse", why: "merge_shape" };
    names.push(w);
  }
  const branch = names[0];
  if (names.length !== 1 || branch === undefined || !isLiteralWord(branch) || branch.includes(":") || branch.includes("..")) {
    return { kind: "refuse", why: "merge_shape" };
  }
  return { kind: "merge", branch };
}

/**
 * Whether a `git push` destination could name a ref outside the checkout's branches and tags (25d). A qualified one
 * (`refs/…`) is admitted only under `refs/heads/` or `refs/tags/`. An unqualified one is matched by git against the
 * target's existing refs through `refs/%s`, `refs/remotes/%s` and `refs/remotes/%s/HEAD`, so a first segment of
 * `origin`, `remotes` or `replace` is refused (`HEAD:origin/main` pushed to `.` or to a worktree path moves
 * `refs/remotes/origin/main`). Case-folded: on a case-insensitive file system `refs/REMOTES/…` is the same loose ref.
 */
function pushDestinationRefused(dst: string): boolean {
  const d = dst.toLowerCase();
  if (d.startsWith("refs/")) return !(d.startsWith("refs/heads/") || d.startsWith("refs/tags/"));
  const first = d.split("/")[0];
  return first === "origin" || first === "remotes" || first === "replace";
}

/**
 * The closed option sets of `git fetch`, `git push` and `git ls-remote` in a run policy (25d review iteration 2). git's
 * option parser takes any unambiguous abbreviation of a long option (`--refm=` is `--refmap=`, `--upload-pa=` is
 * `--upload-pack=`) and a value as the next word (`--upload-pack <cmd>`), so naming the dangerous options cannot
 * close them; only these exact words are admitted, and every other word starting with `-` is refused (`option`). No
 * listed option takes a value, so the operands are read right. Each set holds the options the forms in the Loomwright
 * 18.1.2 install use (`git fetch -q origin`, `git fetch --quiet origin`, `git push -u origin <branch>`,
 * `git push -q origin main`, `git push origin --delete <branch>`, `git ls-remote --exit-code --heads origin`; the
 * conformance test decides the extracted ones) plus flags that only change what is printed or limit what is listed. Left out on purpose: `--upload-pack`,
 * `--receive-pack`, `--exec` (each runs a shell command over a local transport), `--refmap`, `--repo`, `--mirror`,
 * `--all`, `--multiple`, `--stdin` (each changes which refs are written or which words are refspecs), `-f`/`--force*`,
 * `--recurse-submodules`, and every option that takes a value (`-o`, `--depth`, `--server-option`).
 */
const REF_OPTION_SETS: Readonly<Record<"fetch" | "push" | "ls-remote", { readonly letters: string; readonly long: readonly string[] }>> = Object.freeze({
  fetch: { letters: "qvptn", long: ["--quiet", "--verbose", "--prune", "--tags", "--no-tags", "--dry-run", "--porcelain", "--progress", "--no-progress"] },
  push: { letters: "qvund", long: ["--quiet", "--verbose", "--set-upstream", "--dry-run", "--porcelain", "--progress", "--no-progress", "--delete"] },
  "ls-remote": { letters: "qtb", long: ["--quiet", "--tags", "--branches", "--heads", "--refs", "--exit-code", "--get-url", "--symref"] },
});

/**
 * `git fetch`, `git push` and `git ls-remote` (25d): the kernel reads a run's declared checks at
 * `refs/remotes/origin/<default>` (or the target of `refs/remotes/origin/HEAD`) and reads committed objects, which a
 * replace ref (`refs/replace/<sha>`) can stand in for, so a run session may not write those refs into its own
 * repository, and may not name a program for git to run. `args` are the words after the subcommand.
 * - options: each word starting with `-` before `--` must be in `REF_OPTION_SETS` (a cluster of listed letters is one
 *   word, `-qv`), else `option`. So the first operand (a word not starting with `-`, or any word after `--`) is the
 *   repository and every later operand a refspec (fetch, push) or a pattern (ls-remote, which writes no ref).
 * - fetch: a refspec with a leading `+` or a `:` (an explicit destination: `git fetch . +HEAD:refs/remotes/origin/main`
 *   writes the run's commit there, and git expands an unqualified one) is `ref_destination`. `git fetch`,
 *   `git fetch origin`, `git fetch origin <branch>` stay `none`: what they write comes from the configured remote,
 *   which a run session cannot change (no file tool writes under `.git/`, and `--output` is `file_output`).
 * - push: a refspec's destination (after its last `:`, else the refspec itself, a leading `+` dropped) is
 *   `ref_destination` when `pushDestinationRefused`. Pushing a branch (`git push -u origin <branch>`,
 *   `git push origin HEAD:<branch>`, `HEAD:refs/heads/<branch>`) stays `none`.
 * Pure.
 */
function refShape(sub: "fetch" | "push" | "ls-remote", args: readonly string[]): ConfinedShape {
  const REFUSE = { kind: "refuse", why: "ref_destination" } as const;
  const set = REF_OPTION_SETS[sub];
  let options = true;
  let operand = 0;
  for (const w of args) {
    if (options && w === "--") {
      options = false;
      continue;
    }
    if (options && w.startsWith("-")) {
      const known = w.startsWith("--") ? set.long.includes(w) : w.length > 1 && [...w.slice(1)].every((c) => set.letters.includes(c));
      if (!known) return { kind: "refuse", why: "option" };
      continue;
    }
    if (sub === "ls-remote") continue;
    operand += 1;
    if (operand === 1) continue;
    if (sub === "fetch" && (w.startsWith("+") || w.includes(":"))) return REFUSE;
    if (sub === "push") {
      const spec = w.startsWith("+") ? w.slice(1) : w;
      const colon = spec.lastIndexOf(":");
      if (pushDestinationRefused(colon === -1 ? spec : spec.slice(colon + 1))) return REFUSE;
    }
  }
  return { kind: "none" };
}

/**
 * The admitted read subcommands that take git's diff and log options, among them `--output=<file>` (25d review
 * iteration 2): `git log`, `git show`, `git diff`, and `git stash` (`stash show` and `stash list` take them too).
 * These take hundreds of formatting options, so they are not given a closed set: the one option that writes a file
 * is refused instead (`outputShape`). Every other option the run prefixes admit was checked against
 * `git <sub> -h` (git 2.55.0) for one that writes a file, writes a ref or runs a program: `stash export --to-ref`
 * writes any ref (`ref_destination`); the rest read (`-F`, `--pathspec-from-file`) or run only what git config or
 * the environment names (an editor, a hook, a diff driver), which a run session cannot write inside the checkout.
 */
const OUTPUT_SUBCOMMANDS: readonly string[] = ["log", "show", "diff", "stash"];

/**
 * `--output` on an `OUTPUT_SUBCOMMANDS` command: the word `--output` (git takes its value as the next word) or
 * `--output=<file>`, anywhere (a `--` before it fails closed too). Matching the full name is enough: these options
 * are parsed with abbreviations off, so `--outp=`, `--outpu=` and `--out=` are `unrecognized argument` (git 2.55.0,
 * `git log`, `git show`, `git diff`, reproduced 2026-11-23). `--output-indicator-new=` and its siblings only change
 * a diff's prefix characters and stay admitted. `git stash export` is `ref_destination`. Pure.
 */
function outputShape(sub: string, args: readonly string[]): ConfinedShape {
  if (args.some((w) => w === "--output" || w.startsWith("--output="))) return { kind: "refuse", why: "file_output" };
  if (sub === "stash" && args.includes("export")) return { kind: "refuse", why: "ref_destination" };
  return { kind: "none" };
}

/**
 * The shape of a run session's command `words` (already parsed by `parseBashCommand`, and for `git -C` already
 * stripped of `-C <dir>`): `rm`, `mv`, `chmod` (the program word exactly), `git rm`, `git mv` and `git merge`,
 * `git fetch` / `git push` / `git ls-remote` (a closed option set, `refShape`), and `git log` / `git show` /
 * `git diff` / `git stash` (`outputShape`), each refused or `none`. Every other command is `none`. A git global
 * option before the subcommand (`git -c k=v status`) matches no run prefix, and `git -C <dir>` with another one is
 * `global_option` (`splitGitC`). Pure.
 */
export function confinedShape(words: readonly string[]): ConfinedShape {
  const [program, sub] = words;
  if (program === "rm" || program === "mv") return pathShape(words.slice(1), OPTION_SETS[program], false, false);
  if (program === "chmod") return pathShape(words.slice(1), OPTION_SETS.chmod, true, false);
  if (program !== "git" || sub === undefined) return { kind: "none" };
  if (sub === "rm") return pathShape(words.slice(2), OPTION_SETS["git rm"], false, true);
  if (sub === "mv") return pathShape(words.slice(2), OPTION_SETS["git mv"], false, true);
  if (sub === "merge") return mergeShape(words.slice(2));
  if (sub === "fetch" || sub === "push" || sub === "ls-remote") return refShape(sub, words.slice(2));
  if (OUTPUT_SUBCOMMANDS.includes(sub)) return outputShape(sub, words.slice(2));
  return { kind: "none" };
}

/**
 * Run-policy prefixes admitted only as the whole command (25c): `git remote -v` and nothing after it, since
 * `git remote -v add <name> <url>` adds a remote (git 2.55.0, reproduced 2026-11-22). Read by `decideToolUse` for
 * the prefix a run session's command matched.
 */
export const EXACT_RUN_PREFIXES: readonly string[] = Object.freeze(["git remote -v"]);

/**
 * `git -C <dir> <rest>`, read before the prefix list (`decideToolUse`, run policies only):
 * - `none`: not a `git -C` form (no `-C` among git's leading options).
 * - `refuse`: a `-C` form with another global option anywhere before the subcommand (`git --git-dir=x -C d …`,
 *   `git -C d -c k=v …`, `git -C d --work-tree=/ …`, `git -C a -C b …`), no directory, or a directory word that is
 *   not literal (`global_option` / `pattern`).
 * - `split`: `dir` as written (the session gate resolves it against the hook's cwd and confines it), and the words
 *   `git <rest>` the policy judges exactly as it judges `git <rest>` in `dir`.
 * Pure.
 */
export type GitCSplit =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly why: ShapeRefusal }
  | { readonly kind: "split"; readonly dir: string; readonly words: readonly string[] };

export function splitGitC(words: readonly string[]): GitCSplit {
  if (words[0] !== "git") return { kind: "none" };
  // git's leading options run up to the first word that is not one; a `-C` among them makes this a `-C` form.
  let end = 1;
  while (end < words.length && (words[end] as string).startsWith("-")) end += words[end] === "-C" ? 2 : 1;
  const leading = words.slice(1, Math.min(end, words.length));
  if (!leading.includes("-C")) return { kind: "none" };
  if (words[1] !== "-C") return { kind: "refuse", why: "global_option" };
  const dir = words[2];
  if (dir === undefined) return { kind: "refuse", why: "global_option" };
  // A `..` is admitted here (the parallel path's `git -C ../<worktree>`): the gate resolves the directory segment by
  // segment, as the kernel does, so a symlink before a `..` is followed first.
  if (!isLiteralWord(dir)) return { kind: "refuse", why: "pattern" };
  const rest = words.slice(3);
  if (rest[0] === undefined || rest[0].startsWith("-")) return { kind: "refuse", why: "global_option" };
  return { kind: "split", dir, words: ["git", ...rest] };
}

/** Why a resolved operand is refused (`confinementVerdict`). */
export type ConfinementRefusal =
  /** Not inside the checkout or any of its worktrees. */
  | "outside"
  /** Under the owner's `~/.claude/`. */
  | "claude_dir"
  /** Under a `.git` directory: the repository itself (history, config, hooks), never a work file. */
  | "git_dir"
  /** Under `.supervisor/automate/` (run state, D45) or Loomwright's run lock `.supervisor/run.lock` (single drain, invariant 4). */
  | "run_state"
  /**
   * A recursive form (`rm -r`, `chmod -R`, `git rm -r`) or a move (`mv`, `git mv` source) whose operand is the
   * checkout or a worktree root, or an ancestor of one (`rm -rf .claude` above `.claude/worktrees/w1`), which would
   * delete or detach a worker's worktree.
   */
  | "checkout_root";

/** One confined operand after the session gate resolved it (`resolvedPath`, segment by segment). */
export interface ResolvedOperand {
  /** The absolute resolved path. */
  readonly path: string;
  /** `isInsideResolved` against the checkout or one of its worktrees. */
  readonly inside: boolean;
  /** `isInsideResolved` against `<home>/.claude`. */
  readonly underClaude: boolean;
}

/** The path's segments, case-folded (APFS compares case-insensitively by default). */
function segmentsOf(path: string): string[] {
  return path.toLowerCase().split("/").filter((s) => s !== "" && s !== ".");
}

/** Whether `path` (absolute, resolved) is `root` or an ancestor of it, case-folded, on a segment boundary. */
function isSameOrAncestor(path: string, root: string): boolean {
  const p = segmentsOf(path);
  const r = segmentsOf(root);
  return p.length <= r.length && p.every((s, i) => r[i] === s);
}

/** Whether a resolved path is under `.supervisor/automate/` or `.supervisor/run.lock` (or is either directory). */
function isRunStatePath(path: string): boolean {
  const segs = segmentsOf(path);
  return segs.some((s, i) => s === ".supervisor" && (segs[i + 1] === "automate" || segs[i + 1] === "run.lock"));
}

/** Whether a resolved path is a `.supervisor` directory itself: an ancestor of `.supervisor/automate/` and the run lock. */
function isRunStateAncestor(path: string): boolean {
  const segs = segmentsOf(path);
  return segs[segs.length - 1] === ".supervisor";
}

/**
 * The verdict on a confined command's resolved operands (pure; the session gate resolves them): the first refusal
 * that applies to any operand, else `undefined` (admitted). `roots` are the resolved checkout and worktree roots.
 * An operand that resolves to a `.supervisor` directory (an ancestor of run state and the run lock) is `run_state` in
 * every position: a move's source or destination, a `chmod` target, a `git rm` / `git mv` operand (review iteration
 * 3: `mv automate sv` through a committed `sv -> .supervisor` would create `.supervisor/automate/`, and `chmod 000 sv`
 * would lock the driver out). A recursive form, and the first `moved` operands (a move's sources), sweep everything
 * under the operand, so they are judged on ancestry too: an operand that is a root or an ancestor of one is
 * `checkout_root`.
 */
export function confinementVerdict(operands: readonly ResolvedOperand[], roots: readonly string[], recursive: boolean, moved = 0): ConfinementRefusal | undefined {
  for (const [i, op] of operands.entries()) {
    if (!op.inside) return "outside";
    if (op.underClaude) return "claude_dir";
    if (segmentsOf(op.path).includes(".git")) return "git_dir";
    if (isRunStatePath(op.path)) return "run_state";
    if (isRunStateAncestor(op.path)) return "run_state";
    const sweeps = recursive || i < moved;
    if (sweeps && roots.some((root) => isSameOrAncestor(op.path, root))) return "checkout_root";
  }
  return undefined;
}

// ---- 23f: read-only programs naming the session's own Loomwright install ----

/**
 * The read-only programs whose literal install paths the rail does not read as a `~/.claude/` target (23f). Each
 * only reads: no option of theirs writes or runs a file (`cat`, `grep`, `head`, `tail`, `wc`, `ls`, `jq`). The
 * program word must be exactly one of them, as the script exemption's `bash` must be exactly `bash`.
 */
export const INSTALL_READ_PROGRAMS: readonly string[] = Object.freeze(["cat", "grep", "head", "tail", "wc", "ls", "jq"]);

/** `path` (absolute) normalised as text: empty and `.` segments dropped, `..` applied. */
function normalised(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/**
 * The one Loomwright install root the session's admitted scripts share (23f): each path is
 * `<install>/scripts/<name>` (absolute, `<name>` one segment), and every path must give the same `<install>`;
 * otherwise (none, a path of another shape, two roots) `undefined`, and no word is exempt. Pure.
 */
export function loomwrightInstallRoot(admittedScriptPaths: readonly string[] | undefined): string | undefined {
  let root: string | undefined;
  for (const path of admittedScriptPaths ?? []) {
    const m = /^(\/.+)\/scripts\/[^/]+$/.exec(path);
    if (m === null) return undefined;
    const own = normalised(m[1] as string);
    if (own === "/") return undefined;
    if (root !== undefined && root !== own) return undefined;
    root = own;
  }
  return root;
}

/**
 * The indices of `words` the rail does not read as an outward target because they name the session's own
 * Loomwright install (23f): `words[0]` is exactly one of `INSTALL_READ_PROGRAMS`, and the word is a literal
 * (`isLiteralWord`) absolute path whose normalised form is `root` or under it (case-folded, on a segment boundary).
 * A `~` form is never exempt, even one that would expand under the install (`homeDir` is read only to see where it
 * would land, so the literal check is what refuses it). Every other word, and every word of any other program, is
 * read as usual. Pure.
 */
export function installReadWords(words: readonly string[], admittedScriptPaths: readonly string[] | undefined, homeDir: string): ReadonlySet<number> {
  const exempt = new Set<number>();
  const program = words[0];
  if (program === undefined || !INSTALL_READ_PROGRAMS.includes(program)) return exempt;
  const root = loomwrightInstallRoot(admittedScriptPaths);
  if (root === undefined) return exempt;
  const r = segmentsOf(root);
  words.forEach((w, i) => {
    if (i === 0 || !isLiteralWord(w)) return;
    const abs = w.startsWith("~/") ? `${homeDir}/${w.slice(2)}` : w;
    if (!abs.startsWith("/")) return;
    const segs = segmentsOf(normalised(abs));
    if (segs.length >= r.length && r.every((s, k) => segs[k] === s)) exempt.add(i);
  });
  return exempt;
}

// ---- Monitor: a shell watch, decided as a Bash call ----

/** The `Monitor` tool's input keys (Agent SDK 0.3.284 `sdk-tools.d.ts` `MonitorInput`, read 2026-11-22). */
export const MONITOR_INPUT_KEYS: readonly string[] = Object.freeze(["command", "description", "timeout_ms", "ws"]);

/** The `Monitor` input keys refused whatever their value: `ws` opens a WebSocket, an outward channel (as `web-tools` refuses WebFetch). */
export const MONITOR_REFUSED_KEYS: readonly string[] = Object.freeze(["ws"]);

/**
 * A `Monitor` call's shell `command`, when it is admitted as a shell watch: an object whose keys are all
 * `MONITOR_INPUT_KEYS`, none of `MONITOR_REFUSED_KEYS`, and whose `command` is a string. `undefined` otherwise (an
 * unknown key fails closed). The caller decides the command exactly as a Bash call. Pure.
 */
export function monitorCommandOf(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null || Array.isArray(toolInput)) return undefined;
  const keys = Object.keys(toolInput);
  if (keys.some((k) => !MONITOR_INPUT_KEYS.includes(k) || MONITOR_REFUSED_KEYS.includes(k))) return undefined;
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}
