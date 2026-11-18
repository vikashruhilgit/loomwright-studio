// The Loomwright driver and helper scripts a kernel run policy admits, by exact
// path (D45, phase 8 item 22g, AC15/AC16). A run policy constant names its scripts
// by basename (`ToolPolicy.loomwrightScripts`, for example `AUTOMATE_RUN_POLICY`
// in `automate/launch.ts`); the session manager turns those names plus the
// install the session itself loads (its `loomwrightPath`, the one passed to
// `plugins: [{ type: "local", path }]`) into the exact paths
// `ToolPolicy.admittedScriptPaths` holds, at start and at each resume (a resume
// reuses the row's recorded `loomwright_path`, so an update is picked up at the
// next launch, never mid-session). `decideToolUse` (`policy.ts`) then admits
// `bash <path>` or `bash "<path>"`, optionally followed by arguments, only for a
// path in that set, only after its shell-metacharacter check, and never with a
// subcommand that merges, pushes or starts an unowned process
// (`LOOMWRIGHT_DENIED_SUBCOMMANDS`), nor with a driver option that turns the
// run toward a merge or trust its policy's profile refuses
// (`LOOMWRIGHT_DRIVER_ARGUMENTS`, `ToolPolicy.loomwrightDriverProfile`).
//
// It never admits a prefix: not `bash`, and not `bash <install>/scripts/`. A
// name is kept only when its path has no `..` segment, is a regular file, and
// resolves (`resolvedPath`, symlinks and the macOS firmlink) to exactly
// `<resolved install>/scripts/<name>`, so no symlink and no `..` escapes the
// directory and no renamed file stands in for a listed one. `isInsidePath` is
// never used here: it over-approximates on purpose so that a refusal fails
// closed, which would make an admission fail open.
//
// A leaf module: it imports node's `fs` and `path` and the one path resolution
// in `../protected-paths.ts`, so `policy.ts` stays light for its importers.
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { resolvedPath } from "../protected-paths.js";

/** The install's directory of driver and helper scripts: `<install>/scripts/`. */
export const LOOMWRIGHT_SCRIPTS_DIR = "scripts";

/**
 * `loomwrightScriptPaths`'s answer: the admitted paths (frozen, in the order
 * named, without repeats; a missing or escaping name is left out), or why the
 * install's `scripts/` directory itself cannot be read (`path` names it).
 */
export type LoomwrightScriptPathsResult =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly path: string; readonly message: string };

const NONE: readonly string[] = Object.freeze([]);

/** True when `path` is a regular file (symlinks followed); false for anything else or a failed stat. */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The `code` of a node `fs` error (`ENOENT`, `EACCES`, ...), else its message. */
function fsReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.message : String(err);
}

/**
 * The exact paths `names` admit under `installPath`'s `scripts/` directory.
 *
 * No names (absent or empty) ⇒ `{ok: true, paths: []}` without touching the
 * disk, so a policy that runs no script never depends on the install's layout.
 * Otherwise `installPath` must be absolute and `<installPath>/scripts` a directory the kernel can read
 * and search, else `{ok: false}` names it (the manager refuses the start or
 * resume: `install_path_invalid`). Each candidate is the lexical
 * `join(installPath, "scripts", name)` (the form the session sees, from the
 * same `installPath` string), kept only when:
 * - no segment of `<installPath>/scripts/<name>` is `..`;
 * - it is a regular file;
 * - its `resolvedPath` equals `join(resolvedPath(installPath), "scripts", name)`.
 */
export function loomwrightScriptPaths(installPath: string, names: readonly string[] | undefined): LoomwrightScriptPathsResult {
  const wanted = [...new Set(names ?? [])].filter((n) => typeof n === "string" && n !== "");
  if (wanted.length === 0) return { ok: true, paths: NONE };
  // A relative install would admit relative paths, which the session's cwd would resolve: never.
  if (!isAbsolute(installPath)) return { ok: false, path: installPath, message: `the Loomwright install path ${JSON.stringify(installPath)} is not absolute` };
  const dir = join(installPath, LOOMWRIGHT_SCRIPTS_DIR);
  try {
    if (!statSync(dir).isDirectory()) return { ok: false, path: dir, message: `the Loomwright install's scripts directory ${dir} is not a directory` };
    accessSync(dir, constants.R_OK | constants.X_OK);
  } catch (err) {
    return { ok: false, path: dir, message: `the Loomwright install's scripts directory ${dir} cannot be read (${fsReason(err)})` };
  }
  const root = join(resolvedPath(installPath), LOOMWRIGHT_SCRIPTS_DIR);
  const paths: string[] = [];
  for (const name of wanted) {
    // Before `join`, which would fold a `..` away: `../x.sh` must never name a file beside `scripts/`.
    if (`${installPath}${sep}${LOOMWRIGHT_SCRIPTS_DIR}${sep}${name}`.split(sep).includes("..")) continue;
    const candidate = join(installPath, LOOMWRIGHT_SCRIPTS_DIR, name);
    if (!isRegularFile(candidate)) continue;
    // No symlink out of `scripts/` and no rename: the file itself must be `<resolved install>/scripts/<name>`.
    if (resolvedPath(candidate) !== join(root, name)) continue;
    paths.push(candidate);
  }
  return { ok: true, paths: Object.freeze(paths) };
}

/**
 * The subcommands an admitted script may never run when the SESSION calls it
 * directly, by script basename (fixed: part of the safety kernel, the same in
 * every run policy). Read from the Loomwright 17.38.0 install: each one merges,
 * pushes, opens a PR, or starts a headless `claude` or a detached watcher the
 * kernel does not own. The drivers (`automate-next-step.sh`,
 * `review-heal-next-step.sh`) still call them internally where Loomwright's
 * own flow needs them (the `--merge-parked` gate's `gate-eval`, a close-out's
 * trail PR), which the rail never sees; only the session's own direct call is
 * refused.
 *
 * - `automate-helpers.sh` reads only its first argument as the subcommand
 *   (`main "$@"`): `gate-eval` (the plugin's one `gh pr merge --squash`);
 *   `trail-pr` (commit, `git push`, `gh pr create`) and the three that reach it
 *   (`closeout`, `closeout-others`, `finalize-empty`); `wave-build` (forwarded
 *   to `automate-wave.sh`: `git push -u`, `gh pr create`); and every
 *   subcommand it forwards to `automate-lanes.sh` except the read-only
 *   `lane-info` the start runs (`lane-launch`, `lane-answer`, `phase-launch`
 *   and `phase-answer` start or resume headless `claude -p`; `lane-create`
 *   clones; `lane-convert-ready` and `lane-remove` run `trail-pr`; the rest are
 *   `--parallel` coordinator steps a safe-mode run never takes).
 * - `meta-sync.sh` takes its subcommand at any position, so any argument
 *   word `push` is refused (it pushes the metadata branch).
 */
type DeniedSubcommands = { readonly anyPosition: boolean; readonly subcommands: readonly string[] };

// `pick-guard` is not here: it only reads lane tables and prints `ok` or `refuse: …` (17.38.0
// `automate-lanes.d/notify-guards.sh`), and a new run calls it before intake (review iteration 3).
const LANE_FORWARDED_SUBCOMMANDS: readonly string[] = [
  "lane-create", "lane-launch", "relay-hook", "lane-answer", "lane-remove", "lane-convert-ready", "lane-park", "init-check",
  "branch-check", "lane-status", "lane-feed", "lane-readiness", "lane-drain-check", "validation-gate",
  "lane-park-notify", "lane-wait", "phase-check", "phase-launch", "phase-wait", "phase-answer", "fleet-closeout", "wave-plan",
];

export const LOOMWRIGHT_DENIED_SUBCOMMANDS: Readonly<Record<string, DeniedSubcommands>> = Object.freeze({
  "automate-helpers.sh": Object.freeze({
    anyPosition: false,
    subcommands: Object.freeze(["gate-eval", "trail-pr", "closeout", "closeout-others", "finalize-empty", "wave-build", ...LANE_FORWARDED_SUBCOMMANDS]),
  }),
  "meta-sync.sh": Object.freeze({ anyPosition: true, subcommands: Object.freeze(["push"]) }),
  // `--force-unlock` breaks the run lock unconditionally: Loomwright's own header calls it a human-only escape hatch,
  // and a session passing it would break `/automate`'s single-drain ownership (invariant 4). run-lock.sh reads its
  // options at any position (review iteration 3).
  "run-lock.sh": Object.freeze({ anyPosition: true, subcommands: Object.freeze(["--force-unlock"]) }),
  // 23k: the children-settled check and the pre-flight sync are skipped only on the owner's own flag, never on the
  // session's: both the Supervisor driver and the finalize-gate marker writer read the flags at any position.
  "supervisor-next-step.sh": Object.freeze({ anyPosition: true, subcommands: Object.freeze(["--skip-children-check", "--skip-preflight-sync"]) }),
  "guard-finalize-publish.sh": Object.freeze({ anyPosition: true, subcommands: Object.freeze(["--skip-children-check"]) }),
});

/**
 * True when `args` (the text after the script's path, as the session wrote it)
 * asks `script` for a subcommand `LOOMWRIGHT_DENIED_SUBCOMMANDS` refuses, or
 * cannot be read exactly (`shellWords`: fail closed, bash could read it as a
 * denied name). The words are compared as bash passes them, so a quoted name
 * (`"gate-eval"`) is still the denied name, a glob or brace (`gate-ev?l`,
 * `{gate-eval,}`) is refused unread, and a quoted value is read as one word.
 * That last part is why it reads words, not a plain-word pattern: the
 * Supervisor driver is answered with `--result '<json>'`, and a rule refusing
 * every quote or brace refused every answer (seen live in session 215, 23k
 * follow-up). Pure: no I/O.
 */
function asksDeniedSubcommand(script: string, args: string): boolean {
  const denied = LOOMWRIGHT_DENIED_SUBCOMMANDS[basenameOf(script)];
  if (denied === undefined) return false;
  const words = shellWords(args);
  if (words === undefined) return true;
  const read = denied.anyPosition ? words : words.slice(0, 1);
  return read.some((w) => denied.subcommands.some((s) => w === s || w.startsWith(`${s}=`)));
}

/**
 * The closed set of driver argument profiles a run policy names
 * (`ToolPolicy.loomwrightDriverProfile`): which of `automate-next-step.sh`'s
 * mode, trust and entry options the session may pass (review iteration 2).
 * Absent on a policy ⇒ `automate_run`, the profile under which no driver call
 * can reach a merge.
 */
export const LOOMWRIGHT_DRIVER_PROFILES = Object.freeze(["automate_run", "merge_parked", "merge_parked_trust_unprotected"] as const);

/** One of `LOOMWRIGHT_DRIVER_PROFILES`. */
export type LoomwrightDriverProfile = (typeof LOOMWRIGHT_DRIVER_PROFILES)[number];

/** The driver whose arguments the profiles read: the one script that reaches `gate-eval` from its own argv. */
export const LOOMWRIGHT_ARGUMENT_DRIVER = "automate-next-step.sh";

/**
 * A profile's driver arguments: `denied` options are refused at any position,
 * alone or as `--option=value`; `--mode` is admitted only as `--mode <v>` for a
 * `v` in `modeValues` (empty: never), and `--mode=…` never.
 */
type DriverArguments = { readonly denied: readonly string[]; readonly modeValues: readonly string[] };

/**
 * The driver options each profile refuses (fixed: part of the safety kernel,
 * never read from a charter or settings). Read from the Loomwright 17.38.0
 * driver (`automate-next-step.sh`): it takes `--mode safe|auto-merge` and
 * `--trust-unprotected` from its own argv (persisting them for the item's tail)
 * and feeds them to `gate-eval`, the plugin's one `gh pr merge --squash`, and
 * `--merge-parked` runs `gate-eval` directly. So a session that passed them
 * itself would merge without `kernel_automate_merge_check`, the repo's D40
 * policy or the owner's recorded trust choice.
 *
 * - `automate_run` (the ticket run, D44 safe mode): never `--merge-parked`,
 *   `--trust-unprotected` or `--auto-merge`; `--mode` only as `--mode safe`
 *   (the per-item loop passes it on `--start run` and the GATE report).
 * - `merge_parked` (`/loomwright:automate --merge-parked <run_id>`): its one
 *   entry is `--merge-parked <dir> --run <id> --session-id <sid>` (asks are
 *   answered on `<run_file> --result …`), so never `--start` or `--resume`
 *   (the per-item loop, whose tail could gate under another mode), never
 *   `--mode`, `--auto-merge` or `--trust-unprotected`.
 * - `merge_parked_trust_unprotected`: the same, except `--trust-unprotected`,
 *   which the skill passes to every driver call "as /automate received it":
 *   the kernel names this profile only when its launched prompt carried the
 *   flag (`loomwrightMergeFlags`, the owner's recorded choice).
 *
 * `--auto-merge` is no driver option (the driver refuses it); it is denied
 * anyway so no later driver that adds it is admitted by default.
 */
export const LOOMWRIGHT_DRIVER_ARGUMENTS: Readonly<Record<LoomwrightDriverProfile, DriverArguments>> = Object.freeze({
  automate_run: Object.freeze({ denied: Object.freeze(["--merge-parked", "--trust-unprotected", "--auto-merge"]), modeValues: Object.freeze(["safe"]) }),
  merge_parked: Object.freeze({ denied: Object.freeze(["--start", "--resume", "--trust-unprotected", "--auto-merge"]), modeValues: Object.freeze([]) }),
  merge_parked_trust_unprotected: Object.freeze({ denied: Object.freeze(["--start", "--resume", "--auto-merge"]), modeValues: Object.freeze([]) }),
});

/**
 * An unquoted character the calling shell may expand or reinterpret: bash's
 * glob, brace and tilde, plus zsh's extended-glob `^` and `#` and `!` (the
 * Bash tool may run either shell; a comment `#` is refused rather than read).
 */
const UNQUOTED_EXPANSION = /[*?[\]{}~^#!]/;

/**
 * The words bash passes for `args` (already free of every shell
 * metacharacter: `decideToolUse` checks first), or `undefined` when they
 * cannot be read exactly: an unterminated quote, a trailing backslash, or an
 * unquoted `UNQUOTED_EXPANSION` character (fail closed: the shell could expand
 * it into a denied option, for example a glob matching a file the session
 * named `--trust-unprotected`). Single quotes are literal; inside double
 * quotes a backslash escapes only `"` and `\`; an unquoted backslash escapes
 * the next character. Pure: no I/O.
 */
function shellWords(args: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let i = 0;
  while (i < args.length) {
    const c = args[i] as string;
    if (c === " " || c === "\t") {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      i += 1;
    } else if (c === "'") {
      const close = args.indexOf("'", i + 1);
      if (close === -1) return undefined;
      word += args.slice(i + 1, close);
      inWord = true;
      i = close + 1;
    } else if (c === '"') {
      i += 1;
      for (;;) {
        if (i >= args.length) return undefined;
        const d = args[i] as string;
        if (d === '"') break;
        if (d === "\\" && (args[i + 1] === '"' || args[i + 1] === "\\")) {
          word += args[i + 1];
          i += 2;
        } else {
          word += d;
          i += 1;
        }
      }
      inWord = true;
      i += 1;
    } else if (c === "\\") {
      if (i + 1 >= args.length) return undefined;
      word += args[i + 1];
      inWord = true;
      i += 2;
    } else {
      if (UNQUOTED_EXPANSION.test(c)) return undefined;
      word += c;
      inWord = true;
      i += 1;
    }
  }
  if (inWord) words.push(word);
  return words;
}

/**
 * True when `args` asks `automate-next-step.sh` for an option `profile`
 * refuses (`LOOMWRIGHT_DRIVER_ARGUMENTS`), or cannot be read exactly
 * (`shellWords`). Every word is compared, values included: a denied option
 * spelled as another option's value is refused too (never needed). Pure.
 */
function asksDeniedDriverArgument(args: string, profile: LoomwrightDriverProfile, runId?: string): boolean {
  const words = shellWords(args);
  if (words === undefined) return true;
  if (isMergeProfile(profile) && namesOtherRun(words, runId)) return true;
  const rules = LOOMWRIGHT_DRIVER_ARGUMENTS[profile];
  return words.some((w, i) => {
    if (rules.denied.some((d) => w === d || w.startsWith(`${d}=`))) return true;
    if (w.startsWith("--mode=")) return true;
    return w === "--mode" && !rules.modeValues.includes(words[i + 1] ?? "");
  });
}

/**
 * A Loomwright run id as the kernel accepts one (the same shape as
 * `isRunId`, `automate/run-state.ts`, kept here so `sessions/` does not import
 * `automate/`): a letter or digit, then up to 127 of letters, digits, `.`, `_`, `-`.
 */
export const LOOMWRIGHT_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Whether a profile is one of the two merge profiles, whose driver calls are pinned to one run (`ToolPolicy.loomwrightRunId`). */
function isMergeProfile(profile: LoomwrightDriverProfile): boolean {
  return profile === "merge_parked" || profile === "merge_parked_trust_unprotected";
}

/**
 * `automate-next-step.sh`'s options that take the next word as their value,
 * read from the Loomwright 17.38.0 driver's argument loop. Every other option
 * it knows is a bare flag (`DRIVER_FLAG_OPTIONS`).
 */
const DRIVER_VALUE_OPTIONS: readonly string[] = [
  "--owner-command", "--start", "--resume", "--merge-parked", "--run", "--max-tokens", "--result", "--result-file", "--mode", "--root", "--session-id",
];

/** `automate-next-step.sh`'s bare flag options (17.38.0). */
const DRIVER_FLAG_OPTIONS: readonly string[] = ["--inline-phases", "--notify", "--cheap", "--no-cheap", "--non-interactive", "--trust-unprotected", "-h", "--help"];

/**
 * True when a merge-profile driver call (`args`, already read by `shellWords`)
 * could act on a run other than `runId`, or on any run while no run is pinned
 * (fail closed). The words are walked as the 17.38.0 driver walks them: an
 * option in `DRIVER_VALUE_OPTIONS` takes the next word as its value, one in
 * `DRIVER_FLAG_OPTIONS` takes none, and any other word that does not start
 * with `-` is the run file, which the driver accepts at ANY position (one run
 * file only). So every `--run` value must equal `runId`, and every run-file
 * word must be a path whose last segment is exactly `<runId>.md`. An option
 * the driver does not know (also `--option=value`, which the driver does not
 * parse) is refused, so a later driver option that takes a value cannot hide
 * a run file. Without the pin, a merge run launched for one parked item could
 * answer or merge another run's item, past `kernel_automate_merge_check`'s
 * `go` for this one. Pure.
 */
function namesOtherRun(words: readonly string[], runId: string | undefined): boolean {
  const pinned = runId !== undefined && LOOMWRIGHT_RUN_ID.test(runId) ? runId : undefined;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i] as string;
    if (DRIVER_VALUE_OPTIONS.includes(w)) {
      const value = words[i + 1];
      if (value === undefined) return true;
      if (w === "--run" && (pinned === undefined || value !== pinned)) return true;
      i += 1;
    } else if (DRIVER_FLAG_OPTIONS.includes(w)) {
      continue;
    } else if (w.startsWith("-")) {
      return true;
    } else if (pinned === undefined || basenameOf(w) !== `${pinned}.md`) {
      return true;
    }
  }
  return false;
}

/** The last `/`-separated segment of an absolute path (pure; `node:path`'s `basename` reads the same here). */
function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The program word a driver call starts with, and the one space after it. */
const BASH_WORD = "bash ";

/**
 * An unquoted path word bash reads as written: absolute, and only characters
 * that no expansion touches (no quote, backslash, glob, brace, tilde, `!`,
 * `#`, space or tab).
 */
const PLAIN_PATH = /^\/[A-Za-z0-9_./@%+=:,-]*$/;

/**
 * The admitted path `command` runs, or `undefined`. Pure: no I/O.
 *
 * `command` is `bash <path>` or `bash "<path>"`, then nothing or a space and
 * arguments (read as the prefix rule reads them), where `<path>` equals one of
 * `admitted` exactly. An unquoted path must be a `PLAIN_PATH` word; a
 * double-quoted one is absolute too (the session's cwd never picks the file)
 * and holds no backslash, `$` or backtick. A single-quoted path,
 * another program, a flag before the path (`bash -c`, `bash -x`), a second
 * space, or anything glued to the closing quote is no match. Nor is a call
 * that asks the script for a subcommand `LOOMWRIGHT_DENIED_SUBCOMMANDS`
 * refuses, nor a call of `automate-next-step.sh` with an option `profile`
 * refuses (`LOOMWRIGHT_DRIVER_ARGUMENTS`; absent ⇒ `automate_run`). The caller
 * then denies it `bash_prefix_not_allowed`, as for any unlisted command. The
 * caller runs the shell-metacharacter check first (`decideToolUse`); beyond
 * those two checks this does not read the arguments.
 */
export function matchLoomwrightScript(
  command: string,
  admitted: readonly string[],
  profile: LoomwrightDriverProfile = "automate_run",
  runId?: string,
): string | undefined {
  if (admitted.length === 0 || !command.startsWith(BASH_WORD)) return undefined;
  const rest = command.slice(BASH_WORD.length);
  let path: string;
  let after: string;
  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    if (close === -1) return undefined;
    path = rest.slice(1, close);
    if (!path.startsWith("/") || /[\\$`]/.test(path)) return undefined;
    after = rest.slice(close + 1);
  } else {
    const space = rest.indexOf(" ");
    path = space === -1 ? rest : rest.slice(0, space);
    if (!PLAIN_PATH.test(path)) return undefined;
    after = space === -1 ? "" : rest.slice(space);
  }
  if (after !== "" && !after.startsWith(" ")) return undefined;
  if (!admitted.includes(path)) return undefined;
  if (asksDeniedSubcommand(path, after)) return undefined;
  if (basenameOf(path) === LOOMWRIGHT_ARGUMENT_DRIVER && asksDeniedDriverArgument(after, profile, runId)) return undefined;
  return path;
}
