import { basename, resolve } from "node:path";
import { firmlinkForms, withoutFirmlink } from "../protected-paths.js";
import type { ToolPolicy } from "./types.js";

export type ToolDecisionReason =
  | "tool_allowed"
  | "tool_not_allowed"
  | "bash_prefix_allowed"
  | "bash_prefix_not_allowed"
  | "bash_command_not_string"
  | "bash_shell_metacharacter"
  /** Allowed by the policy, but in the fixed outward set: held as a pending approval, not run. */
  | "approval_required"
  /** Allowed by the policy, in the outward set, and matched one unused one-shot grant (consumed now). */
  | "approval_granted"
  /** Names a protected kernel path: denied whatever the policy, never an approval. */
  | "protected_kernel_path"
  /** `gh pr merge` (or a merge through `gh api`): denied whatever the policy, never an approval. */
  | "merge_blocked";

export interface ToolDecision {
  readonly decision: "allow" | "deny";
  readonly reason: ToolDecisionReason;
}

/**
 * Shell control and substitution characters: `;` `&` `|` `<` `>` `(` `)` `$`
 * backtick, newline and carriage return. A Bash command containing any of them
 * is denied before prefix matching, so a prefix cannot be chained into
 * another command (`echo hi; rm x` would otherwise match `echo`). It does not
 * limit what an allowed program itself runs (see `decideToolUse`). A
 * parser-grade Bash gate is out of scope.
 */
const SHELL_METACHARACTERS = /[;&|<>()$`\n\r]/;

/**
 * The kernel's tool decision. Pure: no I/O. Deny by default.
 *
 * - `Bash` is gated by `allowedBashPrefixes` ONLY — `Bash` in `allowedTools`
 *   does not allow arbitrary commands. A command is allowed when it is a
 *   string, contains no shell metacharacter, and equals an allowlisted prefix
 *   or starts with it followed by a space. Empty or whitespace-only prefixes
 *   are ignored (they would match anything starting with a space).
 * - Allowing a program that runs other programs grants arbitrary execution
 *   through its arguments, with no metacharacter needed: `find` (`-exec`),
 *   `xargs`, `env`, `git` (aliases, `-c`, hooks), `npx`, `npm` (scripts),
 *   `sed` (`e`/`w`), `awk` (`system()`), `sh`, `bash`. The kernel adds no
 *   blocklist for them: the policy is the user's (invariant 1), and listing
 *   such a prefix is a decision to allow whatever it can run.
 * - Any other tool is allowed only when its exact name is in `allowedTools`.
 *
 * `toolInput` is untrusted data from the model: it is only inspected here,
 * never executed or interpolated.
 */
export function decideToolUse(policy: ToolPolicy, toolName: string, toolInput: unknown): ToolDecision {
  if (toolName === "Bash") {
    const command = bashCommandOf(toolInput);
    if (command === undefined) return { decision: "deny", reason: "bash_command_not_string" };
    if (SHELL_METACHARACTERS.test(command)) return { decision: "deny", reason: "bash_shell_metacharacter" };
    const allowed = policy.allowedBashPrefixes.some(
      (prefix) => prefix.trim() !== "" && (command === prefix || command.startsWith(`${prefix} `)),
    );
    return allowed
      ? { decision: "allow", reason: "bash_prefix_allowed" }
      : { decision: "deny", reason: "bash_prefix_not_allowed" };
  }
  return policy.allowedTools.includes(toolName)
    ? { decision: "allow", reason: "tool_allowed" }
    : { decision: "deny", reason: "tool_not_allowed" };
}

/** `tool_input.command` when `tool_input` is an object whose `command` is a string. */
export function bashCommandOf(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

// ---- The fixed rail: protected kernel paths, the merge block, the outward set ----

/**
 * What an approval holds and a one-shot grant matches exactly: a Bash command,
 * or another tool's whole input, with the directory the call runs in (`cwd`,
 * the hook input's, `/` when absent), so a grant for one repo never lets an
 * identical call through in another.
 */
export type ApprovalPayload =
  | { readonly tool: "Bash"; readonly command: string; readonly cwd: string }
  | { readonly tool: string; readonly input: unknown; readonly cwd: string };

/**
 * `classifyToolCall`'s answer for a call the policy already allowed:
 * - `ordinary`: run it as the policy says.
 * - `deny`: refused whatever the policy, never an approval.
 * - `outward`: in the fixed outward/persistent set, so it runs only with a
 *   one-shot grant for exactly `payload`; otherwise it is held as an approval.
 */
export type ToolCallClass =
  | { readonly kind: "ordinary" }
  | { readonly kind: "deny"; readonly reason: "protected_kernel_path" | "merge_blocked" }
  | { readonly kind: "outward"; readonly action: string; readonly payload: ApprovalPayload };

export interface RailContext {
  /** The Studio data dir (`Store.dataDir`). */
  readonly dataDir: string;
  /** The owner's home dir (for `~/` and `~/.claude/`). */
  readonly homeDir: string;
  /** The directory a relative path is resolved against (the hook input's `cwd`); `/` when absent or not absolute. */
  readonly cwd?: string;
}

/**
 * The data dir's files the kernel owns (`store/store.ts` `DB_FILENAME` and its
 * SQLite side files, `store/lock.ts` `LOCK_DB_FILENAME` / `LOCK_PID_FILENAME`,
 * the CLI's `api.json`). Kept here as literals so this module stays a leaf;
 * `kernel/test/approvals.test.ts` pins them against the owners' constants.
 */
export const PROTECTED_DATA_FILES: readonly string[] = [
  "studio.db",
  "studio.db-wal",
  "studio.db-shm",
  "studio.db-journal",
  "studio.lock",
  "studio.lock-journal",
  "studio.lock.pid",
  "api.json",
];

/** The data dir's directories the kernel owns, protected with everything inside: agent settings and the install copy (`service/launchd.ts` `APP_DIRNAME`). */
export const PROTECTED_DATA_DIRS: readonly string[] = ["config", "app"];

/** The tools whose path argument is a write. */
const WRITE_TOOLS: Readonly<Record<string, string>> = { Write: "file_path", Edit: "file_path", NotebookEdit: "notebook_path" };

/** `gh pr` / `gh issue` write subcommands, each with the subcommand it is (gh's built-in `new` alias is `create`). */
const GH_PR_OUTWARD: readonly (readonly [string, string])[] = [
  ["create", "create"],
  ["new", "create"],
  ["comment", "comment"],
  ["review", "review"],
  ["edit", "edit"],
  ["close", "close"],
];
const GH_ISSUE_OUTWARD: readonly (readonly [string, string])[] = [
  ["create", "create"],
  ["new", "create"],
  ["comment", "comment"],
  ["edit", "edit"],
  ["close", "close"],
];
/** `gh alias` subcommands that define an alias: a later `gh <alias>` could merge or push under any name. */
const GH_ALIAS_OUTWARD = ["set", "import"] as const;
/**
 * git words that send commits or mail out, whichever position they take
 * (`git push`, `git subtree push`, `git lfs push`, `git --attr-source X push`):
 * any word after `git` equal to one of these holds the command. Over-holding
 * (`git commit -m push`) is the safe direction.
 */
const GIT_OUTWARD: readonly (readonly [string, string])[] = [
  ["push", "git push"],
  ["send-pack", "git send-pack"],
  ["http-push", "git http-push"],
  ["dcommit", "git svn dcommit"],
  ["set-tree", "git svn set-tree"],
  ["send-email", "git send-email"],
  ["imap-send", "git imap-send"],
  ["cvsexportcommit", "git cvsexportcommit"],
];
/**
 * A git word that defines or pulls in an alias, or turns on autocorrect (which
 * runs a mistyped `psuh` as `push`), as globs (`-c alias.p=push`, `git config
 * alias.p push`, `include.path`, `-c help.autocorrect=immediate`,
 * `--config-env`); a globbed word that could expand to one counts.
 */
const GIT_ALIAS_CONFIG: readonly string[] = ["*alias.*", "*include.path*", "*includeif.*", "*help.autocorrect*", "--config-env*"];
/** The GraphQL mutations that merge a pull request or queue it for merging. */
const API_MERGE_MUTATION = /mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest/i;

/**
 * The fixed rail for a call `decideToolUse` ALREADY allowed (it never widens a
 * policy: call it only after an allow). Pure: path math only, no I/O; nothing
 * here is configurable (invariant 3). `toolInput` is untrusted data: inspected,
 * never executed or interpolated.
 *
 * In order:
 * 1. `protected_kernel_path`: a Write/Edit/NotebookEdit to, or a Bash command
 *    with any word that names or could expand to, `<dataDir>` itself,
 *    anything under `<dataDir>/config/` or `<dataDir>/app/`, or one of
 *    `PROTECTED_DATA_FILES` in `<dataDir>`.
 * 2. `merge_blocked`: `gh pr merge …`, or `gh api` reaching a pull request's
 *    `…/pulls/<n>/merge` with a non-GET method (query and fragment ignored),
 *    naming the GraphQL `mergePullRequest` / `enablePullRequestAutoMerge` /
 *    `enqueuePullRequest` mutation, or sending a GraphQL query whose text the
 *    rail cannot read (`-F field=@file`, `--input`).
 * 3. `outward`: git with any later word `push` (or another word in
 *    `GIT_OUTWARD`, or `submit` after `p4`), or defining an alias or
 *    autocorrect (`GIT_ALIAS_CONFIG`, `--config-env`);
 *    `gh pr create|new|comment|review|edit|close`;
 *    `gh issue create|new|comment|edit|close`; `gh alias set|import`; `gh api`
 *    with a non-GET method (`-X`/`--method`, or any `-f`/`-F`/`--field`/
 *    `--raw-field`/`--input` without an explicit method, which gh sends as
 *    POST); a write to, or a Bash command naming or globbing, anything under
 *    `~/.claude/`, any `settings*.json`, any `hooks.json`, or anything under a
 *    `.git/hooks` or `.claude/…/hooks` dir.
 *
 * Bash recognition is argv-shaped: the command is split into shell words
 * (`shellWords`), and only the program's basename (case-folded) and the words
 * after it are read. `env git push`, an alias defined earlier, a script,
 * `sh -c` or any allowed program that runs others is NOT recognised: allowing
 * such a program grants what it can run (see `decideToolUse`). A Bash word is
 * read as the shell could expand it, failing closed: brace expansion is
 * expanded (more than `MAX_BRACE_EXPANSIONS` results reads as "anything");
 * `*`, `?`, `[…]` and a `**` segment are matched as globs against the protected
 * and outward paths (a word that COULD match one is treated as naming it);
 * `~`/`~/…` is the home dir, `~+` the cwd, and any other `~…` (`~user`,
 * `~-`) "any directory"; a word is also read as the paths a program could take
 * from it (`bashPathPatterns`: after `=`, `@`, `:`, from any `/`,
 * percent-decoded), and gh's flags as cobra/pflag could read them
 * (`ghPositionals`, `ghApiForm`). Paths compare case-insensitively (APFS is by default),
 * on a path-segment boundary, after `..` is applied and a leading
 * `/System/Volumes/Data` firmlink is removed; symlinks are not followed.
 */
export function classifyToolCall(toolName: string, toolInput: unknown, ctx: RailContext): ToolCallClass {
  const base = typeof ctx.cwd === "string" && ctx.cwd.startsWith("/") ? ctx.cwd : "/";
  const homeDir = resolve(ctx.homeDir);
  const targets = railTargets(resolve(ctx.dataDir), homeDir);

  if (toolName === "Bash") {
    const command = bashCommandOf(toolInput);
    if (command === undefined) return { kind: "ordinary" };
    const words = shellWords(command);
    const patterns = words.flatMap((w) => bashPathPatterns(w, base, homeDir));
    if (patterns.some((p) => targets.protectedPaths.some((t) => couldMatch(p, t)))) return { kind: "deny", reason: "protected_kernel_path" };
    const payload: ApprovalPayload = { tool: "Bash", command, cwd: base };
    const form = commandForm(words);
    if (form === "merge") return { kind: "deny", reason: "merge_blocked" };
    if (form !== undefined) return { kind: "outward", action: form, payload };
    const label = outwardLabel(patterns, targets);
    if (label !== undefined) return { kind: "outward", action: `Bash naming ${label}`, payload };
    return { kind: "ordinary" };
  }

  const field = Object.prototype.hasOwnProperty.call(WRITE_TOOLS, toolName) ? WRITE_TOOLS[toolName] : undefined;
  if (field === undefined || typeof toolInput !== "object" || toolInput === null) return { kind: "ordinary" };
  const raw = (toolInput as Record<string, unknown>)[field];
  if (typeof raw !== "string" || raw === "") return { kind: "ordinary" };
  // A tool's path is not shell-expanded: its characters are literal.
  const pattern = patternOf(withoutFirmlink(expandPath(raw, base, homeDir)), false);
  if (targets.protectedPaths.some((t) => couldMatch(pattern, t))) return { kind: "deny", reason: "protected_kernel_path" };
  const label = outwardLabel([pattern], targets);
  return label === undefined ? { kind: "ordinary" } : { kind: "outward", action: `${toolName} ${label}`, payload: { tool: toolName, input: toolInput, cwd: base } };
}

/**
 * `command` split into words as the shell would before running it, for
 * inspection only: whitespace separates words; single quotes keep everything
 * up to the next `'`; double quotes keep everything up to the next unescaped
 * `"` (a backslash there escapes a `"` or `\`); a backslash outside
 * quotes escapes the next character (`Application\ Support` is one word).
 * Adjacent quoted and unquoted parts join into one word; an unterminated quote
 * runs to the end. No expansion here (the policy already refused `$`,
 * backticks and the other shell metacharacters); the rail reads globs, braces
 * and `~` itself, failing closed (`classifyToolCall`).
 */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (c === "'") {
      inWord = true;
      const end = command.indexOf("'", i + 1);
      word += command.slice(i + 1, end === -1 ? command.length : end);
      i = end === -1 ? command.length : end;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < command.length && command[i] !== '"'; i++) {
        // As in bash, a backslash in double quotes escapes only `"`, `\` (and `$`, a backtick: refused by the policy).
        if (command[i] === "\\" && (command[i + 1] === '"' || command[i + 1] === "\\")) i++;
        word += command[i];
      }
    } else if (c === "\\") {
      inWord = true;
      if (i + 1 < command.length) word += command[++i];
    } else if (/\s/.test(c)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      inWord = true;
      word += c;
    }
  }
  if (inWord) words.push(word);
  return words;
}

// ---- Path patterns: what a word names, or could expand to ----

/** One char-level glob token: a literal character (length 1), or `ANY` / `STAR` (length 2, never a literal). */
const ANY = "\0?";
const STAR = "\0*";
/** A path segment that matches any number of segments (a zsh recursive `**` segment, and "anywhere" for an unknown `~user`). */
const GLOBSTAR: "**" = "**";
/** A path segment: its glob tokens (case-folded), or `GLOBSTAR`. */
type Seg = readonly string[] | typeof GLOBSTAR;

/** More brace-expansion results than this read as "anything" (fail closed). */
export const MAX_BRACE_EXPANSIONS = 64;

/** `segment` as glob tokens (`*` `?` `[…]` when `glob`), case-folded; a `[…]` class reads as any one character. */
function segment(part: string, glob: boolean): readonly string[] {
  const toks: string[] = [];
  const lower = part.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i] as string;
    if (glob && c === "*") {
      if (toks[toks.length - 1] !== STAR) toks.push(STAR);
    } else if (glob && c === "?") toks.push(ANY);
    else if (glob && c === "[" && lower.indexOf("]", i + 2) !== -1) {
      toks.push(ANY);
      i = lower.indexOf("]", i + 2);
    } else toks.push(c);
  }
  return toks;
}

/**
 * `path` (absolute) normalised as text: empty and `.` segments dropped, `..`
 * applied. When `glob`, a glob segment followed by `..` is its parent (the shell only expands `x*` to
 * an existing dir), and a `**` segment followed by `..` stays `**` (it could be any depth).
 */
function normalisePath(path: string, glob: boolean): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      const last = out.pop();
      if (glob && last !== undefined && /^\*\*+$/.test(last)) out.push(last);
      continue;
    }
    out.push(part);
  }
  return `/${out.join("/")}`;
}

/** A normalised absolute path as segments; when `glob`, a `**` segment other than the last is `GLOBSTAR` (as in zsh; a last `**` is `*`). */
function patternOf(path: string, glob: boolean): Seg[] {
  const parts = path.split("/").filter((p) => p !== "");
  return parts.map((p, i) => (glob && /^\*\*+$/.test(p) && i < parts.length - 1 ? GLOBSTAR : segment(p, glob)));
}

/** A literal path segment. */
const lit = (name: string): Seg => segment(name, false);

/**
 * Whether some string matches both token lists `a` and `b` (or, one level up,
 * some path matches both segment lists): a search over the product of the two
 * patterns. `isStar(t)` marks a token that matches any run (including none);
 * `compatible(x, y)` says whether two other tokens can match the same item.
 */
function intersects<T>(a: readonly T[], b: readonly T[], isStar: (t: T) => boolean, compatible: (x: T, y: T) => boolean): boolean {
  const width = b.length + 1;
  const seen = new Set<number>();
  const stack: [number, number][] = [[0, 0]];
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number];
    if (seen.has(i * width + j)) continue;
    seen.add(i * width + j);
    if (i === a.length && j === b.length) return true;
    const sa = i < a.length && isStar(a[i] as T);
    const sb = j < b.length && isStar(b[j] as T);
    if (sa) {
      stack.push([i + 1, j]);
      if (j < b.length && !sb) stack.push([i, j + 1]);
    }
    if (sb) {
      stack.push([i, j + 1]);
      if (i < a.length && !sa) stack.push([i + 1, j]);
    }
    if (i < a.length && j < b.length && !sa && !sb && compatible(a[i] as T, b[j] as T)) stack.push([i + 1, j + 1]);
  }
  return false;
}

const tokensIntersect = (a: readonly string[], b: readonly string[]): boolean =>
  intersects(a, b, (t) => t === STAR, (x, y) => x === ANY || y === ANY || x === y);

/** Whether some path matches both segment patterns (`GLOBSTAR` on either side). */
function couldMatch(path: readonly Seg[], target: readonly Seg[]): boolean {
  return intersects(
    path,
    target,
    (s) => s === GLOBSTAR,
    (x, y) => tokensIntersect(x as readonly string[], y as readonly string[]),
  );
}

/**
 * `word` after the shell's brace expansion: `{a,b}` alternatives (nested and
 * repeated) and a `{1..9}` / `{a..z}` sequence (read as `*`: it never yields a
 * `/`). More than `MAX_BRACE_EXPANSIONS` results reads as "any path" (fail closed).
 */
export function braceExpand(word: string): string[] {
  const out: string[] = [];
  return expandBraces(word, 0, out) ? out : ["/**/*"];
}

const BRACE_SEQUENCE = /^(-?\d+\.\.-?\d+|[a-z]\.\.[a-z])(\.\.-?\d+)?$/i;

function expandBraces(s: string, from: number, out: string[]): boolean {
  for (let i = s.indexOf("{", from); i !== -1; i = s.indexOf("{", i + 1)) {
    let depth = 0;
    let close = -1;
    const commas: number[] = [];
    for (let j = i; j < s.length && close === -1; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) close = j;
      else if (s[j] === "," && depth === 1) commas.push(j);
    }
    if (close === -1) continue;
    const pre = s.slice(0, i);
    const post = s.slice(close + 1);
    if (commas.length > 0) {
      let start = i + 1;
      for (const end of [...commas, close]) {
        if (!expandBraces(pre + s.slice(start, end) + post, i, out)) return false;
        start = end + 1;
      }
      return true;
    }
    if (BRACE_SEQUENCE.test(s.slice(i + 1, close))) return expandBraces(`${pre}*${post}`, i, out);
  }
  if (out.length >= MAX_BRACE_EXPANSIONS) return false;
  out.push(s);
  return true;
}

/** `raw` (a tool's literal path) as an absolute, normalised path: `~` / `~/…` under `homeDir`, anything else resolved against `base`. */
function expandPath(raw: string, base: string, homeDir: string): string {
  if (raw === "~") return homeDir;
  if (raw.startsWith("~/")) return resolve(homeDir, raw.slice(2));
  return resolve(base, raw);
}

/** A shell word's value as an absolute path: `~`/`~/…` home, `~+` the cwd, any other `~…` (`~user`, `~-`, a named dir) "any directory". */
function shellPath(value: string, base: string, homeDir: string): string {
  if (!value.startsWith("~")) return value.startsWith("/") ? value : `${base}/${value}`;
  const slash = value.indexOf("/");
  const head = slash === -1 ? value : value.slice(0, slash);
  const rest = slash === -1 ? "" : value.slice(slash);
  if (head === "~") return `${homeDir}${rest}`;
  if (head === "~+") return `${base}${rest}`;
  return `/**${rest === "" ? "/*" : rest}`;
}

/**
 * Every path pattern a Bash word could name, as the program reading it might
 * (failing closed): the word brace-expanded, both raw and percent-decoded
 * (`file:///…/Loomwright%20Studio/api.json`), and when it holds a `:` also
 * with any `?query` / `#fragment` cut off; then for each of those the whole
 * text, the text after EVERY `=` (`--file=…`, `key=…`), `@` (`-d @file`,
 * `-d@file`) and `:` (`file:api.json`), the rest of a glued short option
 * (`-C/path`), and every substring starting at a `/` (`file:///abs`,
 * `-d@/abs`, `x/../abs`) or at a `~/` inside the word. Each is `~`-expanded,
 * resolved against `base`, normalised and without a `/System/Volumes/Data`
 * firmlink prefix.
 */
function bashPathPatterns(word: string, base: string, homeDir: string): Seg[][] {
  return bashPathValues(word).map((v) => patternOf(withoutFirmlink(normalisePath(shellPath(v, base, homeDir), true)), true));
}

/** The texts `bashPathPatterns` reads as paths in one Bash word. */
function bashPathValues(word: string): string[] {
  const values = new Set<string>();
  for (const expanded of braceExpand(word)) {
    const forms = new Set([expanded, percentDecoded(expanded)]);
    for (const f of [...forms]) if (f.includes(":")) forms.add(f.replace(/[?#].*$/, ""));
    for (const e of forms) {
      values.add(e);
      if (/^-[^-]./.test(e)) values.add(e.slice(2));
      for (let k = 0; k < e.length; k++) {
        const c = e[k] as string;
        if ((c === "=" || c === "@" || c === ":") && k < e.length - 1) values.add(e.slice(k + 1));
        if (k > 0 && (c === "/" || (c === "~" && (k === e.length - 1 || e[k + 1] === "/")))) values.add(e.slice(k));
      }
    }
  }
  return [...values].filter((v) => v !== "");
}

/** `text` percent-decoded, or as it is when its percent-encoding is malformed. */
function percentDecoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

interface RailTargets {
  /** Protected kernel paths, in both firmlink spellings of the data dir. */
  readonly protectedPaths: readonly Seg[][];
  /** The outward paths with the short label an approval's action shows. */
  readonly outward: readonly (readonly [string, readonly Seg[]])[];
}

function railTargets(dataDir: string, homeDir: string): RailTargets {
  const protectedPaths = firmlinkForms(dataDir).flatMap((d): Seg[][] => {
    const root = patternOf(normalisePath(d, false), false);
    return [root, ...PROTECTED_DATA_DIRS.map((n) => [...root, lit(n), GLOBSTAR]), ...PROTECTED_DATA_FILES.map((f) => [...root, lit(f)])];
  });
  const outward: (readonly [string, readonly Seg[]])[] = [
    ...firmlinkForms(homeDir).map((h): readonly [string, readonly Seg[]] => ["~/.claude/", [...patternOf(normalisePath(h, false), false), lit(".claude"), GLOBSTAR]]),
    ["a settings*.json file", [GLOBSTAR, segment("settings*.json", true)]],
    ["a hooks file", [GLOBSTAR, lit("hooks.json")]],
    ["a hooks file", [GLOBSTAR, lit(".git"), lit("hooks"), GLOBSTAR]],
    ["a hooks file", [GLOBSTAR, lit(".claude"), GLOBSTAR, lit("hooks"), GLOBSTAR]],
  ];
  return { protectedPaths, outward };
}

/** Why one of `patterns` is in the outward set (a short label for the approval's action), or `undefined`. */
function outwardLabel(patterns: readonly Seg[][], targets: RailTargets): string | undefined {
  for (const [label, target] of targets.outward) if (patterns.some((p) => couldMatch(p, target))) return label;
  return undefined;
}

/** Whether a shell word could be `literal` (case-folded), after brace expansion and as a glob. */
function wordCouldBe(word: string, literal: string): boolean {
  const target = segment(literal, false);
  return braceExpand(word).some((e) => tokensIntersect(segment(e, true), target));
}

// ---- Command forms ----

/** Shell glob characters: a word holding one could expand to another word. */
const GLOB_CHARS = /[*?[]/;
/** A flag word the shell could expand (`-[X]`): the rail cannot tell which flag it is. */
const isGlobbedFlag = (word: string): boolean => word.startsWith("-") && GLOB_CHARS.test(word);
/** More readings of gh's command words than this reads as a merge (fail closed). */
const MAX_GH_READINGS = 64;

/** Whether a shell word (a glob) and `glob` could match the same text, case-folded. */
const globsMeet = (word: string, glob: string): boolean => tokensIntersect(segment(word, true), segment(glob, true));

/** The recognised outward form of a Bash command's words (`git push`, `gh pr create`, `gh api POST`), `"merge"`, or `undefined`. */
function commandForm(words: readonly string[]): string | undefined {
  // Brace expansion can turn one word into several argv words (`gh {pr,merge} 12` is `gh pr merge 12`).
  const [program, ...rest] = words.flatMap(braceExpand);
  if (program === undefined) return undefined;
  const name = basename(program).toLowerCase();
  // `git-push` (git's libexec spelling) is `git push`.
  if (name === "git") return gitForm(rest);
  if (name.startsWith("git-")) return gitForm([name.slice(4), ...rest]);
  if (name !== "gh") return undefined;
  // A flag word could take the next word as its value or not: every reading is checked, a merge in any wins.
  const readings = ghPositionals(rest);
  if (readings === undefined) return "merge";
  let form: string | undefined;
  for (const reading of readings) {
    const f = ghForm(rest, reading);
    if (f === "merge") return f;
    form ??= f;
  }
  return form;
}

/** `gh`'s outward form for one reading of its command words. */
function ghForm(args: readonly string[], [group, sub]: readonly { word: string; index: number }[]): string | undefined {
  if (group === undefined) return undefined;
  const is = (w: { word: string } | undefined, literal: string): boolean => w !== undefined && wordCouldBe(w.word, literal);
  if (is(group, "pr") && is(sub, "merge")) return "merge";
  if (is(group, "pr")) for (const [s, label] of GH_PR_OUTWARD) if (is(sub, s)) return `gh pr ${label}`;
  if (is(group, "issue")) for (const [s, label] of GH_ISSUE_OUTWARD) if (is(sub, s)) return `gh issue ${label}`;
  if (is(group, "alias")) for (const s of GH_ALIAS_OUTWARD) if (is(sub, s)) return `gh alias ${s}`;
  if (is(group, "api")) return ghApiForm(args.slice(group.index + 1));
  return undefined;
}

/**
 * git's outward form: any word after `git` that could be one of `GIT_OUTWARD`
 * (so no option spelling before the subcommand can hide a push), `submit`
 * after `p4`, or an alias definition (`GIT_ALIAS_CONFIG`, `--config-env`).
 */
function gitForm(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string;
    for (const [sub, label] of GIT_OUTWARD) if (wordCouldBe(word, sub)) return label;
    if (wordCouldBe(word, "submit") && args.slice(0, i).some((w) => wordCouldBe(w, "p4"))) return "git p4 submit";
  }
  if (args.some((w) => GIT_ALIAS_CONFIG.some((g) => globsMeet(w, g)))) return "git alias";
  return undefined;
}

/**
 * Whether a gh flag word could take the next word as its value when gh looks
 * up its subcommand: cobra skips the next word after any two-character short
 * flag and any `--long` flag without `=` it does not know as a bool (an
 * unknown one included), and pflag after a short group ending in `-R`'s
 * letter (`-hR o/r`); a globbed flag could be any of them. Only `-h`,
 * `--help` and `--` are known to take none.
 */
function ghFlagCouldTakeNext(a: string): boolean {
  if (isGlobbedFlag(a)) return true;
  if (a === "-h" || a === "--help" || a === "--" || a.includes("=")) return false;
  return a.length === 2 || a.startsWith("--") || a.endsWith("R");
}

/**
 * Every reading of `gh`'s first two command words (with their index in
 * `args`): a flag that could take the next word as its value
 * (`ghFlagCouldTakeNext`) is read both ways, so `gh pr -R o/r merge 12` and
 * `gh pr -b x merge 12` are merges in one reading. More than
 * `MAX_GH_READINGS` readings is `undefined` (the caller fails closed).
 */
function ghPositionals(args: readonly string[]): { word: string; index: number }[][] | undefined {
  const readings: { word: string; index: number }[][] = [];
  const walk = (from: number, found: readonly { word: string; index: number }[]): boolean => {
    const words = [...found];
    for (let i = from; i < args.length && words.length < 2; i++) {
      const a = args[i] as string;
      if (!a.startsWith("-")) words.push({ word: a, index: i });
      else if (ghFlagCouldTakeNext(a) && i + 1 < args.length && !walk(i + 2, words)) return false;
    }
    readings.push(words);
    return readings.length <= MAX_GH_READINGS;
  };
  return walk(0, []) ? readings : undefined;
}

/** The REST merge endpoint and the GraphQL endpoint, as segment patterns. */
const MERGE_ENDPOINT: readonly Seg[] = [GLOBSTAR, lit("pulls"), [STAR], lit("merge")];
const GRAPHQL_ENDPOINT: readonly Seg[] = [GLOBSTAR, lit("graphql")];

/**
 * Whether a `gh api` word could reach `target`: brace-expanded, read both
 * with its `?query` / `#fragment` cut off and as a glob, percent-decoded or
 * not, with empty, `.` and `..` segments normalised.
 */
function endpointCouldBe(word: string, target: readonly Seg[]): boolean {
  return braceExpand(word).some((e) => {
    let decoded = e;
    try {
      decoded = decodeURIComponent(e);
    } catch {
      // Malformed percent-encoding: the raw text is still compared.
    }
    return [e, decoded].some((v) => [v, v.replace(/[?#].*$/, "")].some((x) => couldMatch(patternOf(normalisePath(`/${x}`, true), true), target)));
  });
}

/** `gh api`'s boolean short flags (`-i`/`--include`): pflag lets them lead a group (`-iX PUT`). */
const GH_API_SHORT_BOOL = "i";
/** `gh api`'s short flags that take a value (glued, after `=`, or the next word). */
const GH_API_SHORT_VALUE = "XfFHpqt";

/**
 * `gh api …`'s form: `merge` for a merge (or a GraphQL query the rail cannot
 * read), `gh api <METHOD>` for a non-GET method (`gh api (flag unread)` when
 * a flag the rail cannot account for could hide it), `undefined` for a GET.
 *
 * A single-dash word is read as pflag reads it, a group of short flags
 * (`-iX PUT`, `-iXPUT`, `-if body=x`, `-X=PUT`): `i` is a bool, and the first
 * of `X`/`f`/`F`/`H`/`p`/`q`/`t` takes the rest of the word (after an `=`) or,
 * for `X`/`f`/`F`, the next word. A group holding any other character (a
 * glob, a flag the rail does not know) is unread: fail closed.
 */
function ghApiForm(args: readonly string[]): string | undefined {
  let method: string | undefined;
  let fields = false;
  // A body the rail cannot read: a field read from a file (`-F k=@file`), `--input`, or a globbed word.
  let opaque = false;
  // A flag the rail cannot account for (a glob, an unknown short flag) could be `-X PUT`, `--input` or anything else.
  let unread = args.some(isGlobbedFlag);
  const field = (flag: string, value: string): void => {
    fields = true;
    if (flag === "F" && value.includes("=@")) opaque = true;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--method") method = args[++i] ?? "";
    else if (a.startsWith("--method=")) method = a.slice("--method=".length);
    else if (a === "--input" || a.startsWith("--input=")) {
      fields = true;
      opaque = true;
      if (a === "--input") i++;
    } else if (a === "--field" || a === "--raw-field") field(a === "--field" ? "F" : "f", args[++i] ?? "");
    else if (/^--(field|raw-field)=/.test(a)) field(a.startsWith("--field=") ? "F" : "f", a.slice(a.indexOf("=") + 1));
    else if (/^-[^-]/.test(a)) {
      let accounted = false;
      for (let j = 1; j < a.length && !accounted; j++) {
        const c = a[j] as string;
        if (GH_API_SHORT_BOOL.includes(c)) {
          // `-i=true`: a bool's value ends the group.
          if (a[j + 1] === "=") accounted = true;
          else if (j === a.length - 1) accounted = true;
          continue;
        }
        if (!GH_API_SHORT_VALUE.includes(c)) break;
        accounted = true;
        const glued = a.slice(j + 1);
        const takesNext = glued === "" && "XfF".includes(c);
        const value = takesNext ? (args[++i] ?? "") : glued.replace(/^=/, "");
        if (c === "X") method = value;
        else if (c === "f" || c === "F") field(c, value);
      }
      if (!accounted) unread = true;
    }
  }
  if (unread || args.some((a) => GLOB_CHARS.test(a))) opaque = true;
  // A flag with no value (`gh api -X`) is gh's own usage error; it is read as no explicit method.
  const verb = (method === undefined || method === "" ? (fields ? "POST" : "GET") : method).toUpperCase();
  if (args.some((a) => API_MERGE_MUTATION.test(a))) return "merge";
  if (opaque && args.some((a) => endpointCouldBe(a, GRAPHQL_ENDPOINT))) return "merge";
  if (verb === "GET" && !unread) return undefined;
  if (args.some((a) => endpointCouldBe(a, MERGE_ENDPOINT))) return "merge";
  return verb === "GET" ? "gh api (flag unread)" : `gh api ${verb}`;
}

/** A defensive, frozen copy: later changes to the caller's arrays cannot reach the gate. */
export function freezePolicy(policy: ToolPolicy): ToolPolicy {
  return Object.freeze({
    allowedTools: Object.freeze([...policy.allowedTools]),
    allowedBashPrefixes: Object.freeze([...policy.allowedBashPrefixes]),
  });
}
