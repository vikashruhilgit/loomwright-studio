// A run's declared checks (phase 8 item 25d): the commands the repo itself declares on its base branch, which a
// kernel-launched `backlog`, `resume` or `review_pr` run session may run, each exactly as declared
// (`declared_check`, `sessions/policy.ts`). Read at launch from ONE resolved base commit, never the working tree:
//   - every job's `run:` value in `.github/workflows/*.yml` and `*.yaml`, read by a small line reader that takes only
//     a single-line plain or simply quoted scalar (a block scalar is `multi_line`; an anchor, alias, tag, flow value,
//     escape or other form it cannot read is `unreadable_yaml`: fail closed, never a guess);
//   - `npm test` when `package.json` has `scripts.test`, and `npm run <name>` for each `scripts` key.
// Each value is read by the policy's own parser (`parseBashCommand`): a pipe, `&&`, a redirect, `$` or a line break is
// skipped `shell_metacharacter`, a form it does not model `unparsed`. What is skipped is kept with its reason, for the
// launch's `run_declared_checks` event.
//
// The base commit is the stored repo policy's `default_branch` as `refs/remotes/origin/<branch>`, else the target of
// `refs/remotes/origin/HEAD`; when neither resolves the run declares nothing (`base_unresolved`), never `HEAD` and
// never the working tree. So a script or workflow the run adds on its own branch, committed or not, is never declared.
// The ref lives in the run's own checkout, which the run session can write. The routes found to it from a session's
// own commands are refused (`sessions/run-confinement.ts` and the session gate): a fetch or push that names a
// remote-tracking or replace ref destination and `git stash export` (`ref_destination`), any fetch / push / ls-remote
// option outside a closed set, abbreviations of `--refmap` and `--upload-pack` included (`option`), `--output=<file>`
// on `git log` / `show` / `diff` / `stash` (`file_output`), a `git branch` deleting a remote-tracking branch
// (`remote_branch`), a `git worktree add|move|repair` destination inside the git dir, and a file tool's write under
// `.git/` or into the user's global git config. That closes known routes, not every route: `committedReads` reads the
// exact ref with replace objects off, and what can still move it is listed in `docs/architecture/automate.md` ("What
// can still move the base"). Re-reading the base at each launch is the brief's design; pinning it is the owner's call.
//
// Runnable (phase 8 item 27a): a declared check stays admitted whatever the run's PATH holds (the policy above is the
// only input to the grant), but `unrunnableDeclaredChecks` names each one whose executable the run's PATH cannot find,
// so the launch's `run_declared_checks` event says so before the run spends tokens finding out.
//
// This module starts no process and reads no repo file itself: its git reads are `committedReads`
// (`loomwright/run-state-checkout.ts`, the kernel's one git caller for a run checkout), passed in. Its one filesystem
// touch is `unrunnableDeclaredChecks`' default probe, which stats candidate files in the run PATH's dirs.
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { clip } from "../loop/internal.js";
import { parseBashCommand } from "../sessions/shell-words.js";
import type { CommittedFile, CommittedReads } from "../loomwright/run-state-checkout.js";

/** Where the workflows live at the base commit. */
export const WORKFLOWS_DIR = ".github/workflows";

/** Why a declaration is not admitted (recorded in the `run_declared_checks` event's `skipped`). Closed. */
export const DECLARED_CHECK_SKIP_REASONS = Object.freeze([
  /** A block scalar (`run: |`, `run: >`), a plain scalar continued on the next line, or a quoted one left open. */
  "multi_line",
  /** A value the line reader does not read as one plain or simply quoted scalar (anchor, alias, tag, flow, escape, mapping). */
  "unreadable_yaml",
  /** An empty `run:` value. */
  "empty",
  /** A `run:` key outside a job under the workflow's top-level `jobs:`. */
  "not_in_job",
  /** The command holds a shell metacharacter the policy refuses (`|`, `&&`, `;`, a redirect, `$`, a line break). */
  "shell_metacharacter",
  /** The command is a form the policy's parser does not model (an open quote, a heredoc, `$'…'`). */
  "unparsed",
  /** A `package.json` script name that is not exactly one plain word, or that starts with `-` (npm would read an option). */
  "not_one_word",
  /** A `package.json` that does not parse as JSON, is not an object, or whose `scripts` (or one script) is not a string map. */
  "invalid_package_json",
  /** A committed file git could not read: not a regular file, too large, or a git error. */
  "unreadable_file",
] as const);

/** One of `DECLARED_CHECK_SKIP_REASONS`. */
export type DeclaredCheckSkipReason = (typeof DECLARED_CHECK_SKIP_REASONS)[number];

/** One admitted check: the command line as declared, its parsed words (what the policy matches), and where it came from. */
export interface DeclaredCheck {
  readonly command: string;
  readonly words: readonly string[];
  /** `workflow <file> job <id>` or `package.json scripts.<name>`. */
  readonly source: string;
}

/** One declaration not admitted, with its text, where it came from and why. */
export interface SkippedDeclaration {
  readonly text: string;
  readonly source: string;
  readonly reason: DeclaredCheckSkipReason;
}

/** What a launch read: the base it read at (or why there was none), the admitted checks and the skipped lines. */
export interface DeclaredChecksRead {
  readonly base_ref: string | null;
  readonly base_sha: string | null;
  /** Present only when no base resolved (`base_sha: null`). */
  readonly reason?: "base_unresolved";
  readonly admitted: readonly DeclaredCheck[];
  readonly skipped: readonly SkippedDeclaration[];
}

/** The longest declaration text kept in a result (a longer one is cut, with `…`). */
const MAX_TEXT = 200;

/** A branch name the kernel builds a remote ref from: git's own characters, no `..`, no leading `-` or `/`, no empty segment. */
function isBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith("-") &&
    !name.includes("..") &&
    name.split("/").every((seg) => seg !== "" && !seg.startsWith(".") && !seg.endsWith(".lock"))
  );
}

/**
 * The base the declarations are read at: `refs/remotes/origin/<defaultBranch>` when the stored default branch is a
 * branch name that resolves, else the target of `refs/remotes/origin/HEAD` when that resolves, else none. Never
 * `HEAD`, a local branch or the working tree (fail closed).
 */
export function resolveDeclaredBase(defaultBranch: string | null, reads: Pick<CommittedReads, "commitOf" | "originHead">): { readonly ref: string; readonly sha: string } | undefined {
  const candidates: string[] = [];
  if (defaultBranch !== null && isBranchName(defaultBranch)) candidates.push(`refs/remotes/origin/${defaultBranch}`);
  const head = reads.originHead();
  if (head !== undefined && isBranchName(head.slice("refs/remotes/origin/".length)) && !candidates.includes(head)) candidates.push(head);
  for (const ref of candidates) {
    const sha = reads.commitOf(ref);
    if (sha !== undefined) return { ref, sha };
  }
  return undefined;
}

/**
 * The repo's declared checks at its base branch (see the module comment): `defaultBranch` is the stored repo
 * policy's, and `reads` the checkout's committed reads. Never throws.
 */
export function readDeclaredChecks(defaultBranch: string | null, reads: CommittedReads): DeclaredChecksRead {
  const base = resolveDeclaredBase(defaultBranch, reads);
  if (base === undefined) return { base_ref: null, base_sha: null, reason: "base_unresolved", admitted: [], skipped: [] };
  return { base_ref: base.ref, base_sha: base.sha, ...declaredChecksAt(base.sha, reads) };
}

/** The declarations in commit `sha`'s workflows and `package.json`, read through `reads` (committed files only). Never throws. */
export function declaredChecksAt(sha: string, reads: Pick<CommittedReads, "listFiles" | "readFile">): { readonly admitted: readonly DeclaredCheck[]; readonly skipped: readonly SkippedDeclaration[] } {
  const admitted: DeclaredCheck[] = [];
  const skipped: SkippedDeclaration[] = [];
  const consider = (text: string, source: string): void => {
    const parsed = parseBashCommand(text);
    if (parsed.kind === "metacharacter") skipped.push({ text: clip(text, MAX_TEXT), source, reason: "shell_metacharacter" });
    else if (parsed.kind === "unparsed") skipped.push({ text: clip(text, MAX_TEXT), source, reason: "unparsed" });
    else if (parsed.words.length === 0) skipped.push({ text: clip(text, MAX_TEXT), source, reason: "empty" });
    else admitted.push({ command: clip(text, MAX_TEXT), words: Object.freeze([...parsed.words]), source });
  };

  const names = reads.listFiles(sha, WORKFLOWS_DIR);
  if (names === undefined) skipped.push({ text: WORKFLOWS_DIR, source: WORKFLOWS_DIR, reason: "unreadable_file" });
  for (const name of [...(names ?? [])].filter((n) => n.endsWith(".yml") || n.endsWith(".yaml")).sort()) {
    const path = `${WORKFLOWS_DIR}/${name}`;
    const file = reads.readFile(sha, path);
    if (file.kind !== "file") {
      if (file.kind === "unreadable") skipped.push({ text: path, source: `workflow ${path}`, reason: "unreadable_file" });
      continue;
    }
    for (const line of workflowRunLines(file.text)) {
      const source = line.job === undefined ? `workflow ${path}` : `workflow ${path} job ${line.job}`;
      if (line.kind === "skip") skipped.push({ text: clip(line.text, MAX_TEXT), source, reason: line.reason });
      else if (line.job === undefined) skipped.push({ text: clip(line.text, MAX_TEXT), source, reason: "not_in_job" });
      else consider(line.text, source);
    }
  }

  npmChecks(reads.readFile(sha, "package.json"), consider, skipped);
  return { admitted, skipped };
}

/** `npm test` and `npm run <name>` for `package.json`'s scripts (see the module comment). */
function npmChecks(file: CommittedFile, consider: (text: string, source: string) => void, skipped: SkippedDeclaration[]): void {
  if (file.kind === "absent") return;
  if (file.kind === "unreadable") {
    skipped.push({ text: "package.json", source: "package.json", reason: "unreadable_file" });
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch {
    json = undefined;
  }
  const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isMap(json) || (json.scripts !== undefined && !isMap(json.scripts))) {
    skipped.push({ text: "package.json", source: "package.json", reason: "invalid_package_json" });
    return;
  }
  const scripts = (json.scripts ?? {}) as Record<string, unknown>;
  if (typeof scripts.test === "string") consider("npm test", "package.json scripts.test");
  for (const [name, body] of Object.entries(scripts)) {
    const source = `package.json scripts.${clip(name, MAX_TEXT)}`;
    if (typeof body !== "string") {
      skipped.push({ text: clip(name, MAX_TEXT), source, reason: "invalid_package_json" });
      continue;
    }
    const own = parseBashCommand(name);
    if (own.kind !== "words" || own.words.length !== 1 || own.words[0] !== name || name.startsWith("-")) {
      skipped.push({ text: clip(name, MAX_TEXT), source, reason: "not_one_word" });
      continue;
    }
    consider(`npm run ${name}`, source);
  }
}

/** One `run:` key the workflow reader found: a single-line value with its job, or why the value is skipped. */
type RunLine =
  | { readonly kind: "value"; readonly text: string; readonly job: string | undefined }
  | { readonly kind: "skip"; readonly text: string; readonly job: string | undefined; readonly reason: DeclaredCheckSkipReason };

/** A block-mapping key line: indentation, an optional `- ` list marker, the key and the rest after `:`. */
const KEY_LINE = /^( *)((?:- +)*)([A-Za-z0-9_][A-Za-z0-9_.-]*):(?: (.*))?$/;

/** The indentation of a line (spaces only). */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Every `run:` key in a workflow's text, in order, each with its job (the key under the top-level `jobs:` it sits in)
 * and its value read as one single-line scalar (`scalarOf`), or why not. A line reader, not a YAML parser: lines
 * inside any block scalar (`key: |`, `key: >`) are content and never read as keys; a `run:` whose value goes on past
 * its line (a block scalar, an indented continuation, an open quote) is `multi_line`. Pure.
 */
export function workflowRunLines(text: string): readonly RunLine[] {
  const lines = text.split(/\r?\n/);
  const out: RunLine[] = [];
  /** While inside a block scalar: the column its content must stay deeper than. */
  let blockUnder: number | undefined;
  let inJobs = false;
  let jobColumn: number | undefined;
  let job: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = indentOf(line);
    if (blockUnder !== undefined) {
      if (indent > blockUnder) continue;
      blockUnder = undefined;
    }
    const m = KEY_LINE.exec(line.replace(/\s+$/, ""));
    if (m === null) continue;
    const column = indent + (m[2] as string).length;
    const key = m[3] as string;
    const rest = (m[4] ?? "").trim();
    // The top-level `jobs:` mapping and its job ids (the keys at its first deeper column).
    if (column === 0) {
      inJobs = key === "jobs" && m[2] === "";
      jobColumn = undefined;
      job = undefined;
    } else if (inJobs && m[2] === "") {
      if (jobColumn === undefined) jobColumn = column;
      if (column === jobColumn) job = key;
    }
    const block = /^[|>][-+0-9]*(?:\s+#.*)?$/.test(rest);
    if (key !== "run") {
      // A block scalar's lines, or a quoted value's lines past an open quote, are text: never keys.
      if (block || ((rest.startsWith("'") || rest.startsWith('"')) && scalarOf(rest).kind === "open")) blockUnder = column;
      continue;
    }
    if (block) {
      blockUnder = column;
      out.push({ kind: "skip", text: rest, job, reason: "multi_line" });
      continue;
    }
    // A value continued on the next deeper line (a plain multi-line scalar, a mapping, or a quote left open).
    let next = i + 1;
    while (next < lines.length && ((lines[next] as string).trim() === "" || (lines[next] as string).trim().startsWith("#"))) next += 1;
    const continued = next < lines.length && indentOf(lines[next] as string) > column;
    if (rest === "" || rest.startsWith("#")) {
      out.push(continued ? { kind: "skip", text: rest, job, reason: "unreadable_yaml" } : { kind: "skip", text: rest, job, reason: "empty" });
      continue;
    }
    const value = scalarOf(rest);
    if (value.kind === "open" || continued) {
      if (value.kind === "open") blockUnder = column;
      out.push({ kind: "skip", text: rest, job, reason: "multi_line" });
    } else if (value.kind === "unreadable") out.push({ kind: "skip", text: rest, job, reason: "unreadable_yaml" });
    else out.push({ kind: "value", text: value.text, job });
  }
  return out;
}

/**
 * A one-line YAML value as a string: a plain scalar (a trailing ` #` comment dropped), a single-quoted one (`''` is
 * one `'`) or a double-quoted one with no backslash escape, each followed by nothing but an optional comment.
 * `open` for a quote that does not close on the line; `unreadable` for any other form (an anchor, alias, tag, flow
 * value, a `: ` inside a plain scalar, an escape). Pure.
 */
function scalarOf(rest: string): { readonly kind: "scalar"; readonly text: string } | { readonly kind: "open" } | { readonly kind: "unreadable" } {
  const OPEN = { kind: "open" } as const;
  const UNREADABLE = { kind: "unreadable" } as const;
  const scalar = (text: string) => ({ kind: "scalar", text }) as const;
  const first = rest[0] as string;
  if (first === "'") {
    let value = "";
    for (let i = 1; i < rest.length; i += 1) {
      const c = rest[i] as string;
      if (c !== "'") {
        value += c;
        continue;
      }
      if (rest[i + 1] === "'") {
        value += "'";
        i += 1;
        continue;
      }
      return trailerOk(rest.slice(i + 1)) ? scalar(value) : UNREADABLE;
    }
    return OPEN;
  }
  if (first === '"') {
    const close = rest.indexOf('"', 1);
    if (close === -1) return rest.includes("\\") ? UNREADABLE : OPEN;
    const value = rest.slice(1, close);
    if (value.includes("\\")) return UNREADABLE;
    return trailerOk(rest.slice(close + 1)) ? scalar(value) : UNREADABLE;
  }
  // A plain scalar may not start with an indicator character.
  if (/^[[\]{}&*!|>%@`,]/.test(rest) || /^[-?:](\s|$)/.test(rest)) return UNREADABLE;
  const comment = rest.search(/\s#/);
  const value = (comment === -1 ? rest : rest.slice(0, comment)).trim();
  if (value === "" || value.includes(": ") || value.endsWith(":")) return UNREADABLE;
  return scalar(value);
}

/** Whether what follows a closed quote is nothing or a comment. */
function trailerOk(after: string): boolean {
  const t = after.trim();
  return t === "" || (t.startsWith("#") && /^\s/.test(after));
}

/** One admitted check the run's PATH cannot run (27a): its command, the executable not found, and the line the owner reads. */
export interface UnrunnableCheck {
  readonly command: string;
  readonly executable: string;
  /** `<command> is declared but <executable> is not on the run's PATH`. */
  readonly line: string;
}

/** Whether `path` is an executable regular file (a dir, a non-executable file or a missing path is not). Never throws. */
function isExecutableRegularFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The admitted checks whose executable is not on `runPath` (27a), one per distinct command line, in admitted order.
 * The executable is the check's first word when that word holds no `/` (a word with a `/` is a path, never looked up,
 * so never named here); it is found when some absolute, non-`..` PATH entry holds it as an executable regular file
 * (`isExecutable`, the default stats the file). An `npm …` check whose `npm` is found is also named when `node`, which
 * npm runs on, is not. Mechanism only: the policy is untouched and the check stays admitted. Never throws.
 */
export function unrunnableDeclaredChecks(read: DeclaredChecksRead, runPath: string | undefined, isExecutable: (path: string) => boolean = isExecutableRegularFile): readonly UnrunnableCheck[] {
  const dirs = (runPath ?? "").split(":").filter((dir) => isAbsolute(dir) && !dir.split("/").includes(".."));
  const known = new Map<string, boolean>();
  const onPath = (name: string): boolean => {
    let found = known.get(name);
    if (found === undefined) {
      found = dirs.some((dir) => {
        try {
          return isExecutable(join(dir, name));
        } catch {
          return false;
        }
      });
      known.set(name, found);
    }
    return found;
  };
  const out: UnrunnableCheck[] = [];
  const seen = new Set<string>();
  for (const check of read.admitted) {
    if (seen.has(check.command)) continue;
    seen.add(check.command);
    const first = check.words[0];
    if (first === undefined || first === "" || first.includes("/")) continue;
    const missing = !onPath(first) ? first : first === "npm" && !onPath("node") ? "node" : undefined;
    if (missing === undefined) continue;
    const executable = clip(missing, MAX_TEXT);
    out.push({ command: check.command, executable, line: `${check.command} is declared but ${executable} is not on the run's PATH` });
  }
  return Object.freeze(out);
}

/** The admitted checks' word lists, one per distinct command line (what `ToolPolicy.declaredChecks` holds). */
export function declaredCheckWords(read: DeclaredChecksRead): readonly (readonly string[])[] {
  const seen = new Set<string>();
  const out: (readonly string[])[] = [];
  for (const check of read.admitted) {
    const key = JSON.stringify(check.words);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(check.words);
  }
  return Object.freeze(out);
}
