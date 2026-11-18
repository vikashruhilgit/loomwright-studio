// When a run session may run Loomwright's `release-refold.sh` (phase 8 item 23q).
//
// The Supervisor's finalize step tells the session to run `scripts/release-refold.sh` before any push
// (Loomwright 17.38.0 `supervisor-next-step.sh`, the FINALIZE commit procedure), and refuses to push
// without it (`release_refold_refused`, seen live 2026-11-17 in session 224). The script runs the
// PROJECT's own `scripts/bump-version.sh --refold` and `--check` when the project has one, which is
// code from the repo run past the per-command rail (invariant 3); when the project has none it prints
// `release-refold: skipped` and runs nothing. So a run session may call it only while no
// `scripts/bump-version.sh` exists where it would look: the `--root <dir>` it is given, or else (its
// default is the cwd's git top level) the cwd and every directory above it.
//
// Honest limit: the check is made when the call is decided; a worker running in parallel could add
// the file between the check and the script's own look. A project that has the convention is refused
// and its run parks, for the owner to decide.
//
// File checks only (`lstat`): no process, no network.
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { matchLoomwrightScript } from "../sessions/loomwright-scripts.js";

/** The script this gate is for. */
export const RELEASE_REFOLD_SCRIPT = "release-refold.sh";

/** A word that needs no reading: no quote, backslash, glob, brace or tilde. */
const PLAIN = /^[A-Za-z0-9_./@%+=:,-]+$/;

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    // Anything but "not there" (a permission error, a loop) is read as there: refused, never guessed.
    const code = (err as { code?: unknown }).code;
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

/** `dir` and every directory above it, up to the root. */
function upward(dir: string): string[] {
  const out: string[] = [];
  for (let d = resolve(dir); ; d = dirname(d)) {
    out.push(d);
    if (dirname(d) === d) return out;
  }
}

/**
 * True when `command` is a call of the admitted `release-refold.sh` that must be
 * refused: arguments other than none or `--root <absolute dir>`, no absolute
 * cwd to read the default root from, or a `scripts/bump-version.sh` where the
 * script would find one. False for any other command (this gate does not apply).
 */
export function refoldRunsRepoCode(command: string, cwd: unknown, admitted: readonly string[]): boolean {
  const refold = admitted.filter((p) => p.endsWith(`/${RELEASE_REFOLD_SCRIPT}`));
  const path = matchLoomwrightScript(command, refold);
  if (path === undefined) return false;
  const rest = command.slice(command.indexOf(path) + path.length).replace(/^"/, "");
  const words = rest.split(/[ \t]+/).filter((w) => w !== "");
  let roots: string[];
  if (words.length === 0) {
    if (typeof cwd !== "string" || !isAbsolute(cwd)) return true;
    roots = upward(cwd);
  } else if (words.length === 2 && words[0] === "--root" && PLAIN.test(words[1] as string) && isAbsolute(words[1] as string)) {
    roots = [resolve(words[1] as string)];
  } else {
    return true;
  }
  return roots.some((r) => exists(join(r, "scripts", "bump-version.sh")));
}
