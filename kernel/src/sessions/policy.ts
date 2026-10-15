import { basename, join, resolve, sep } from "node:path";
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

/** What an approval holds and a one-shot grant matches exactly: a Bash command, or another tool's whole input. */
export type ApprovalPayload = { readonly tool: "Bash"; readonly command: string } | { readonly tool: string; readonly input: unknown };

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

const GH_PR_OUTWARD = new Set(["create", "comment", "review", "edit", "close"]);
const GH_ISSUE_OUTWARD = new Set(["create", "comment", "edit", "close"]);
/** `git` options before the subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
/** A GitHub merge reached through `gh api`: the REST merge endpoint or the GraphQL merge mutations. */
const API_MERGE_PATH = /(^|\/)pulls\/[^/]+\/merge\/?$/i;
const API_MERGE_MUTATION = /mergePullRequest|enablePullRequestAutoMerge/i;

/**
 * The fixed rail for a call `decideToolUse` ALREADY allowed (it never widens a
 * policy: call it only after an allow). Pure: path math only, no I/O; nothing
 * here is configurable (invariant 3). `toolInput` is untrusted data: inspected,
 * never executed or interpolated.
 *
 * In order:
 * 1. `protected_kernel_path`: a Write/Edit/NotebookEdit to, or a Bash command
 *    with any word naming, `<dataDir>` itself, anything under `<dataDir>/config/`
 *    or `<dataDir>/app/`, or one of `PROTECTED_DATA_FILES` in `<dataDir>`.
 * 2. `merge_blocked`: `gh pr merge …`, or `gh api` reaching a pull request's
 *    `…/pulls/<n>/merge` with a non-GET method or naming the GraphQL
 *    `mergePullRequest` / `enablePullRequestAutoMerge` mutation.
 * 3. `outward`: `git [options] push …`; `gh pr create|comment|review|edit|close`;
 *    `gh issue create|comment|edit|close`; `gh api` with a non-GET method
 *    (`-X`/`--method`, or any `-f`/`-F`/`--field`/`--raw-field`/`--input`
 *    without an explicit method, which gh sends as POST); a write to, or a Bash
 *    command naming, anything under `~/.claude/`, any `settings*.json`, any
 *    `hooks.json`, or anything under a `.git/hooks` or `.claude/…/hooks` dir.
 *
 * Bash recognition is argv-shaped: the command is split into shell words
 * (`shellWords`: quotes and backslash escapes as the shell reads them), and
 * only the program's basename (case-folded) and the words after it are read. `env git push`, an alias, a script, `sh -c`
 * or any allowed program that runs others is NOT recognised: allowing such a
 * program grants what it can run (see `decideToolUse`). Paths are compared
 * lexically (case-insensitive, on a segment boundary), after `~/` expansion and
 * resolution against `ctx.cwd`; symlinks are not followed.
 */
export function classifyToolCall(toolName: string, toolInput: unknown, ctx: RailContext): ToolCallClass {
  const base = typeof ctx.cwd === "string" && ctx.cwd.startsWith("/") ? ctx.cwd : "/";
  const dataDir = resolve(ctx.dataDir);
  const homeDir = resolve(ctx.homeDir);

  if (toolName === "Bash") {
    const command = bashCommandOf(toolInput);
    if (command === undefined) return { kind: "ordinary" };
    const words = shellWords(command);
    const paths = words.flatMap((w) => pathsNamedBy(w, base, homeDir));
    if (paths.some((p) => isProtectedKernelPath(p, dataDir))) return { kind: "deny", reason: "protected_kernel_path" };
    const payload: ApprovalPayload = { tool: "Bash", command };
    const form = commandForm(words);
    if (form === "merge") return { kind: "deny", reason: "merge_blocked" };
    if (form !== undefined) return { kind: "outward", action: form, payload };
    const label = paths.map((p) => outwardPathLabel(p, homeDir)).find((l) => l !== undefined);
    if (label !== undefined) return { kind: "outward", action: `Bash naming ${label}`, payload };
    return { kind: "ordinary" };
  }

  const field = Object.prototype.hasOwnProperty.call(WRITE_TOOLS, toolName) ? WRITE_TOOLS[toolName] : undefined;
  if (field === undefined || typeof toolInput !== "object" || toolInput === null) return { kind: "ordinary" };
  const raw = (toolInput as Record<string, unknown>)[field];
  if (typeof raw !== "string" || raw === "") return { kind: "ordinary" };
  const path = expandPath(raw, base, homeDir);
  if (isProtectedKernelPath(path, dataDir)) return { kind: "deny", reason: "protected_kernel_path" };
  const label = outwardPathLabel(path, homeDir);
  return label === undefined ? { kind: "ordinary" } : { kind: "outward", action: `${toolName} ${label}`, payload: { tool: toolName, input: toolInput } };
}

/**
 * `command` split into words as the shell would before running it, for
 * inspection only: whitespace separates words; single quotes keep everything
 * up to the next `'`; double quotes keep everything up to the next unescaped
 * `"` (a backslash there escapes a `"` or `\`); a backslash outside
 * quotes escapes the next character (`Application\ Support` is one word).
 * Adjacent quoted and unquoted parts join into one word; an unterminated quote
 * runs to the end. No expansion of any kind (the policy already refused `$`,
 * backticks and the other shell metacharacters).
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

/** `raw` as an absolute, normalised path: `~` / `~/…` under `homeDir`, anything else resolved against `base`. */
function expandPath(raw: string, base: string, homeDir: string): string {
  if (raw === "~") return homeDir;
  if (raw.startsWith("~/")) return resolve(homeDir, raw.slice(2));
  return resolve(base, raw);
}

/** Every path a Bash word could name: the word itself, and the value after its first `=` (`--file=…`, `key=…`). */
function pathsNamedBy(word: string, base: string, homeDir: string): string[] {
  const values = [word];
  const eq = word.indexOf("=");
  if (eq >= 0 && eq < word.length - 1) values.push(word.slice(eq + 1));
  return values.map((v) => expandPath(v, base, homeDir));
}

/** Case-insensitive (APFS is by default), on a path-segment boundary. */
function isInside(path: string, root: string): boolean {
  const p = path.toLowerCase();
  const r = root.toLowerCase().replace(/[\\/]+$/, "");
  return p === r || p.startsWith(`${r}${sep}`);
}

function isProtectedKernelPath(path: string, dataDir: string): boolean {
  if (path.toLowerCase() === dataDir.toLowerCase()) return true;
  if (PROTECTED_DATA_DIRS.some((d) => isInside(path, join(dataDir, d)))) return true;
  return PROTECTED_DATA_FILES.some((f) => path.toLowerCase() === join(dataDir, f).toLowerCase());
}

/** Why `path` is in the outward set (a short label for the approval's action), or `undefined`. */
function outwardPathLabel(path: string, homeDir: string): string | undefined {
  if (isInside(path, join(homeDir, ".claude"))) return "~/.claude/";
  const name = basename(path).toLowerCase();
  if (/^settings.*\.json$/.test(name)) return "a settings*.json file";
  if (name === "hooks.json") return "a hooks file";
  const segments = path.toLowerCase().split(sep);
  for (let i = 1; i < segments.length; i++) {
    if (segments[i] !== "hooks") continue;
    if (segments[i - 1] === ".git" || segments.slice(0, i).includes(".claude")) return "a hooks file";
  }
  return undefined;
}

/** The recognised outward form of a Bash command's words (`git push`, `gh pr create`, `gh api POST`), `"merge"`, or `undefined`. */
function commandForm(words: readonly string[]): string | undefined {
  const [program, ...rest] = words;
  if (program === undefined) return undefined;
  const name = basename(program).toLowerCase();
  if (name === "git") return gitSubcommand(rest) === "push" ? "git push" : undefined;
  if (name !== "gh") return undefined;
  const positional = ghPositionals(rest);
  const [group, sub] = positional;
  if (group === "pr" && sub === "merge") return "merge";
  if (group === "pr" && sub !== undefined && GH_PR_OUTWARD.has(sub)) return `gh pr ${sub}`;
  if (group === "issue" && sub !== undefined && GH_ISSUE_OUTWARD.has(sub)) return `gh issue ${sub}`;
  if (group === "api") return ghApiForm(rest.slice(rest.findIndex((w) => w.toLowerCase() === "api") + 1));
  return undefined;
}

/** The first word after `git`'s own options (`-C <dir>`, `-c <k=v>`, `--git-dir <dir>`, `--no-pager`, …), case-folded. */
function gitSubcommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (GIT_VALUE_OPTIONS.has(a) || GIT_VALUE_OPTIONS.has(a.toLowerCase())) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return a.toLowerCase();
  }
  return undefined;
}

/** `gh`'s first two command words, case-folded, skipping flags (and `-R`/`--repo`'s value). */
function ghPositionals(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length && out.length < 2; i++) {
    const a = args[i] as string;
    if (a === "-R" || a === "--repo") {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    out.push(a.toLowerCase());
  }
  return out;
}

/** `gh api …`'s form: `merge` for a merge, `gh api <METHOD>` for a non-GET method, `undefined` for a GET. */
function ghApiForm(args: readonly string[]): string | undefined {
  let method: string | undefined;
  let fields = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "-X" || a === "--method") method = args[++i] ?? "";
    else if (a.startsWith("--method=")) method = a.slice("--method=".length);
    else if (a.startsWith("-X")) method = a.slice(2);
    else if (["-f", "-F", "--field", "--raw-field", "--input"].includes(a)) {
      fields = true;
      i++;
    } else if (/^(-f|-F).+/.test(a) || /^--(field|raw-field|input)=/.test(a)) fields = true;
  }
  // A flag with no value (`gh api -X`) is gh's own usage error; it is read as no explicit method.
  const verb = (method === undefined || method === "" ? (fields ? "POST" : "GET") : method).toUpperCase();
  if (args.some((a) => API_MERGE_MUTATION.test(a))) return "merge";
  if (verb === "GET") return undefined;
  if (args.some((a) => API_MERGE_PATH.test(a))) return "merge";
  return `gh api ${verb}`;
}

/** A defensive, frozen copy: later changes to the caller's arrays cannot reach the gate. */
export function freezePolicy(policy: ToolPolicy): ToolPolicy {
  return Object.freeze({
    allowedTools: Object.freeze([...policy.allowedTools]),
    allowedBashPrefixes: Object.freeze([...policy.allowedBashPrefixes]),
  });
}
