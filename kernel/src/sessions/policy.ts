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
  | "merge_blocked"
  /** A Bash command longer than `MAX_RAIL_COMMAND_LENGTH`, or naming more path text than `MAX_RAIL_PATH_TEXT`: the rail does not read it, so it is denied. */
  | "bash_command_too_large"
  /**
   * An outward call in one of the session policy's `never` categories
   * (`boundaryDecision`): denied whatever the policy, never held, never
   * covered by a grant. The hook's reason is `boundaryDenyReason`'s text.
   */
  | "agent_boundary"
  /**
   * An outward call in a draft-mode playbook session (`draftDecision`): the
   * kernel did not send it, it recorded it as a `draft_outputs` row for the
   * owner. Denied without an approval, whatever the policy or any grant. The
   * hook's reason is `draftDenyReason`'s text.
   */
  | "draft_mode"
  /**
   * A Bash `gh` call in a session whose agent holds the `github` grant
   * (`githubCliDecision`): the agent reads GitHub through the kernel's tools.
   * The hook's reason is `GITHUB_CLI_DENY_REASON`.
   */
  | "use_kernel_github_tools";

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
/**
 * Why the rail denies a call whatever the policy (never an approval). The two
 * Bash-only reasons are the rail refusing a command it will not read:
 * `bash_shell_metacharacter` for a character the shell could split or read
 * differently from what `shellWords` sees (`UNREADABLE_BASH_CHARS`), and
 * `bash_command_too_large` past its fixed size bounds.
 */
export type RailDenyReason = "protected_kernel_path" | "merge_blocked" | "bash_shell_metacharacter" | "bash_command_too_large";

export type ToolCallClass =
  | { readonly kind: "ordinary" }
  | { readonly kind: "deny"; readonly reason: RailDenyReason }
  | {
      readonly kind: "outward";
      readonly action: string;
      readonly payload: ApprovalPayload;
      /**
       * The other outward forms the rail read in the same call (another gh
       * reading, `git alias` beside `git push`, a path label), present only
       * when one of them is in a `NeverCategory` that `action`'s own mapping
       * lacks (`neverCategoriesOf`). `boundaryDecision` reads it; the
       * approval stores `action` and `payload` only.
       */
      readonly alsoReads?: readonly string[];
    };

export interface RailContext {
  /** The Studio data dir (`Store.dataDir`). */
  readonly dataDir: string;
  /** The owner's home dir (for `~/` and `~/.claude/`). */
  readonly homeDir: string;
  /**
   * The hook input's `cwd`. When absolute, a relative path is ALSO resolved
   * against it; a relative path is always read as anchored elsewhere too
   * (`relativeTargets`), since this may be stale after a persisted `cd`. When
   * absent or not absolute, a relative path is never resolved against `/`:
   * it is read only as anchored in any directory. The payload records `/`.
   */
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

/**
 * The tools in the fixed outward set by name: every call is held for the
 * owner as a pending approval (`classifyToolCall` answers `outward`, whatever
 * the input), so an allowing policy only lets the session ask. An "always"
 * grant may NEVER cover a name in this list: the item that adds "always"
 * grants (phase 3 item 05) must check it. Closed: a name is added only by a
 * kernel change, never by a policy or a playbook.
 *
 * - `mcp__kernel__kernel_playbook_enable`: enabling a playbook lets it run on
 *   its own (persistent), so the owner sees each enable.
 * - `mcp__kernel__kernel_agent_create` / `mcp__kernel__kernel_agent_update`:
 *   a crew member's charter and enforced settings persist and shape every
 *   later session it runs, so the owner sees each one (phase 4).
 */
export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([
  "mcp__kernel__kernel_playbook_enable",
  "mcp__kernel__kernel_agent_create",
  "mcp__kernel__kernel_agent_update",
]);

/**
 * The closed categories a session policy's `never` list may name: one per
 * outward form the rail already emits (`classifyToolCall` step 3). Each maps
 * to the rail's own labels (the `outward` action, `neverCategoriesOf`), which
 * `boundaryDecision` matches:
 *
 * - `git_push`: every `GIT_OUTWARD` label and `git p4 submit` (`git push`,
 *   `git send-pack`, `git http-push`, `git svn dcommit`, `git svn set-tree`,
 *   `git send-email`, `git imap-send`, `git cvsexportcommit`,
 *   `git p4 submit`): every git form that sends commits or patches off the
 *   machine. Also `git alias`: the rail holds an inline alias or autocorrect
 *   because it can run a push (`git -c alias.p=push p`).
 * - `alias_define`: `git alias`, and `gh alias set` / `gh alias import`.
 * - `gh_pr_create`, `gh_pr_comment`, `gh_pr_review`, `gh_pr_edit`,
 *   `gh_pr_close`: `gh pr create` (also its `new` alias), `comment`,
 *   `review`, `edit`, `close`.
 * - `gh_issue_create`, `gh_issue_comment`, `gh_issue_edit`,
 *   `gh_issue_close`: `gh issue create` (also `new`), `comment`, `edit`,
 *   `close`. The rail has no `gh issue review` form, so there is no
 *   `gh_issue_review` category.
 * - `gh_api_write`: `gh api <VERB>` for a method other than GET, and
 *   `gh api (flag unread)`.
 * - `settings_write`: the `~/.claude/` and `a settings*.json file` targets,
 *   both the Bash form (`Bash naming …`) and the Write/Edit/NotebookEdit form.
 * - `hooks_write`: the `a hooks file` target, both forms.
 *
 * A merge (`merge_blocked`) and a protected kernel path are denied for every
 * session already, so neither is a category. Closed: a category is added only
 * by a kernel change. Which categories a crew member never takes is the
 * owner's policy (invariant 1); the kernel ships none as a default.
 */
export const NEVER_CATEGORIES = Object.freeze([
  "git_push",
  "alias_define",
  "gh_pr_create",
  "gh_pr_comment",
  "gh_pr_review",
  "gh_pr_edit",
  "gh_pr_close",
  "gh_issue_create",
  "gh_issue_comment",
  "gh_issue_edit",
  "gh_issue_close",
  "gh_api_write",
  "settings_write",
  "hooks_write",
] as const);

export type NeverCategory = (typeof NEVER_CATEGORIES)[number];

/**
 * Whether an outward call crosses the session policy's `never` boundary. The
 * gate calls it for every `outward` call BEFORE the dry-run branch and before
 * any hold or grant lookup: a `boundary` answer is denied outright
 * (`agent_boundary`), never held as an approval, never covered by a grant,
 * and denied in a dry run too. Pure: no I/O.
 *
 * It answers `boundary` when any outward form the rail read in the call (its
 * `action`, and every form in `alsoReads`) maps (`neverCategoriesOf`) to a
 * category in `policy.never`, naming the first such category in
 * `NEVER_CATEGORIES` order; otherwise, and always with no `never` (or an empty
 * one), `none`. No new matcher: the forms are the rail's own labels, so a
 * form the rail does not recognise (`env git push`, `sh -c`, a script) is not
 * covered either.
 */
export function boundaryDecision(
  policy: ToolPolicy,
  rail: Extract<ToolCallClass, { kind: "outward" }>,
): { readonly kind: "none" } | { readonly kind: "boundary"; readonly category: NeverCategory } {
  const never = policy.never ?? [];
  const read = new Set([rail.action, ...(rail.alsoReads ?? [])].flatMap(neverCategoriesOf));
  const category = NEVER_CATEGORIES.find((c) => read.has(c) && never.includes(c));
  return category === undefined ? { kind: "none" } : { kind: "boundary", category };
}

/**
 * The hook's reason for an `agent_boundary` deny: it names the category and
 * tells the model that the owner's settings forbid it for this agent, so it
 * neither asks for an approval nor retries.
 */
export function boundaryDenyReason(category: NeverCategory): string {
  return (
    `agent_boundary: ${category} is in this agent's never list. The owner's settings forbid it for this agent; it did not run. ` +
    "Do not ask for an approval and do not retry it."
  );
}

/**
 * The `NeverCategory` values an outward action label (`classifyToolCall`'s
 * `action`, or a form in `alsoReads`) is in, from the rail's own label
 * tables; none for an `ALWAYS_HELD_TOOLS` action or any other text. Pure.
 */
export function neverCategoriesOf(action: string): readonly NeverCategory[] {
  if (action === "git p4 submit" || GIT_OUTWARD.some(([, label]) => label === action)) return ["git_push"];
  // An inline alias or autocorrect can run a push (`git -c alias.p=push p`): that is why the rail holds it.
  if (action === "git alias") return ["git_push", "alias_define"];
  if (GH_ALIAS_OUTWARD.some((sub) => action === `gh alias ${sub}`)) return ["alias_define"];
  for (const [, sub] of GH_PR_OUTWARD) if (action === `gh pr ${sub}`) return NEVER_CATEGORIES.filter((c) => c === `gh_pr_${sub}`);
  for (const [, sub] of GH_ISSUE_OUTWARD) if (action === `gh issue ${sub}`) return NEVER_CATEGORIES.filter((c) => c === `gh_issue_${sub}`);
  // `gh api <METHOD>` (any non-GET method) and `gh api (flag unread)`.
  if (action.startsWith("gh api ")) return ["gh_api_write"];
  for (const [label, category] of OUTWARD_PATH_CATEGORIES) {
    if (action === `Bash naming ${label}` || Object.keys(WRITE_TOOLS).some((tool) => action === `${tool} ${label}`)) return [category];
  }
  return [];
}

/** The rail's outward path labels (`railTargets`), each with the category its Bash and Write/Edit/NotebookEdit forms are in. */
const OUTWARD_PATH_CATEGORIES: readonly (readonly [string, NeverCategory])[] = [
  ["~/.claude/", "settings_write"],
  ["a settings*.json file", "settings_write"],
  ["a hooks file", "hooks_write"],
];

/** The kernel MCP server's tool-name prefix, dropped from an always-held tool's approval action. */
const KERNEL_TOOL_PREFIX = "mcp__kernel__";

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
/**
 * Characters in a Bash command the rail refuses to read (`bash_shell_metacharacter`):
 * every control character (C0, DEL, C1) but tab, every Unicode space and line or
 * paragraph separator but the ASCII space, and every format character (zero-width
 * spaces and joiners, bidi controls, the BOM, a soft hyphen). bash splits words
 * only on space and tab (newline is refused by the policy), so `shellWords`
 * splits only there; refusing the rest means no character can be split one way
 * by the rail and another by the shell, or hide a word from the owner.
 */
const UNREADABLE_BASH_CHARS = /(?![\t ])[\p{Cc}\p{Z}\p{Cf}]/u;
/**
 * A Bash command longer than this (UTF-16 code units) is denied
 * (`bash_command_too_large`) before the rail reads it, bounding the rail's
 * synchronous cost in the daemon's hook (brace expansion and gh's readings scan a word per brace or flag).
 */
export const MAX_RAIL_COMMAND_LENGTH = 8192;
/**
 * The most path text (the summed length of the distinct texts
 * `bashPathValues` reads as paths, across the command) the rail reads; more
 * is denied (`bash_command_too_large`). Every `/`-starting substring of a word
 * is a path, so a slash-heavy word is quadratic in its length: this bound
 * keeps the rail's cost and memory linear in it.
 */
export const MAX_RAIL_PATH_TEXT = 262144;
/** The GraphQL mutations that merge a pull request or queue it for merging. */
const API_MERGE_MUTATION = /mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest/i;

/**
 * The fixed rail for a call `decideToolUse` ALREADY allowed (it never widens a
 * policy: call it only after an allow). Pure: path math only, no I/O; nothing
 * here is configurable (invariant 3). `toolInput` is untrusted data: inspected,
 * never executed or interpolated.
 *
 * In order:
 * 0. A Bash command the rail will not read is denied: `bash_shell_metacharacter`
 *    for any `UNREADABLE_BASH_CHARS` character, `bash_command_too_large` past
 *    `MAX_RAIL_COMMAND_LENGTH` or `MAX_RAIL_PATH_TEXT`.
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
 *    `.git/hooks` or `.claude/…/hooks` dir; and every call to a tool in
 *    `ALWAYS_HELD_TOOLS`, whatever its input (action: the name without its
 *    `mcp__kernel__` prefix, e.g. `kernel_playbook_enable`; payload
 *    `{tool, input, cwd}`).
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
 * (`ghPositionals`, `ghApiForm`); an empty word is no command word (bash drops
 * an unquoted one, cobra skips a quoted one). Paths compare case-insensitively (APFS is by default),
 * on a path-segment boundary, after `..` is applied and a leading
 * `/System/Volumes/Data` firmlink is removed; symlinks are not followed.
 *
 * A relative path (a Bash word's value, `~+…`, or a tool's path not starting
 * with `/` or `~/`) fails closed whatever the hook's `cwd` says: it is resolved
 * against an absolute `cwd` (never against `/`), and ALSO read as anchored in
 * any directory the session could be in (`relativeTargets`), because the
 * `cwd` may be absent or stale after a persisted `cd` (NEEDS VERIFICATION,
 * OPEN_QUESTIONS).
 */
export function classifyToolCall(toolName: string, toolInput: unknown, ctx: RailContext): ToolCallClass {
  const cwd = typeof ctx.cwd === "string" && ctx.cwd.startsWith("/") ? ctx.cwd : undefined;
  // What the payload records (a grant is scoped to it); never a base a path is resolved against.
  const payloadCwd = cwd ?? "/";
  const homeDir = resolve(ctx.homeDir);
  const targets = railTargets(resolve(ctx.dataDir), homeDir);

  if (toolName === "Bash") {
    const command = bashCommandOf(toolInput);
    if (command === undefined) return { kind: "ordinary" };
    if (UNREADABLE_BASH_CHARS.test(command)) return { kind: "deny", reason: "bash_shell_metacharacter" };
    if (command.length > MAX_RAIL_COMMAND_LENGTH) return { kind: "deny", reason: "bash_command_too_large" };
    const words = shellWords(command);
    const read = bashPathPatterns(words, cwd, homeDir);
    if (read === undefined) return { kind: "deny", reason: "bash_command_too_large" };
    // A `cd`/`pushd` operand can land anywhere on `CDPATH`, so it is read as anchored in any directory.
    const protectedRel = cwd === undefined || changesDirectory(words) ? targets.protectedRelAny : targets.protectedRelReachable;
    if (namesAny(read, targets.protectedPaths, protectedRel)) return { kind: "deny", reason: "protected_kernel_path" };
    const payload: ApprovalPayload = { tool: "Bash", command, cwd: payloadCwd };
    const forms = commandForms(words);
    if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };
    // The action is the command's first form, else its first path label; the rest only feed `alsoReads`.
    const [action, ...others] = [...forms, ...outwardLabels(read, targets).map((label) => `Bash naming ${label}`)];
    return action === undefined ? { kind: "ordinary" } : outwardClass(action, others, payload);
  }

  if (ALWAYS_HELD_TOOLS.includes(toolName)) {
    const action = toolName.startsWith(KERNEL_TOOL_PREFIX) ? toolName.slice(KERNEL_TOOL_PREFIX.length) : toolName;
    return { kind: "outward", action, payload: { tool: toolName, input: toolInput, cwd: payloadCwd } };
  }

  const field = Object.prototype.hasOwnProperty.call(WRITE_TOOLS, toolName) ? WRITE_TOOLS[toolName] : undefined;
  if (field === undefined || typeof toolInput !== "object" || toolInput === null) return { kind: "ordinary" };
  const raw = (toolInput as Record<string, unknown>)[field];
  if (typeof raw !== "string" || raw === "") return { kind: "ordinary" };
  // A tool's path is not shell-expanded: its characters are literal.
  const read = toolPathPatterns(raw, cwd, homeDir);
  if (namesAny(read, targets.protectedPaths, cwd === undefined ? targets.protectedRelAny : targets.protectedRelReachable)) {
    return { kind: "deny", reason: "protected_kernel_path" };
  }
  const [action, ...others] = outwardLabels(read, targets).map((label) => `${toolName} ${label}`);
  return action === undefined ? { kind: "ordinary" } : outwardClass(action, others, { tool: toolName, input: toolInput, cwd: payloadCwd });
}

/** An `outward` class, with `alsoReads` only for the `others` that add a `NeverCategory` `action` is not in. */
function outwardClass(action: string, others: readonly string[], payload: ApprovalPayload): ToolCallClass {
  const own = neverCategoriesOf(action);
  const alsoReads = [...new Set(others)].filter((form) => neverCategoriesOf(form).some((c) => !own.includes(c)));
  return alsoReads.length === 0 ? { kind: "outward", action, payload } : { kind: "outward", action, payload, alsoReads };
}

/**
 * The paths a call names: `abs`, absolute patterns; `rel`, relative patterns
 * (their segments, `..` applied, a leading `..` dropped) that are matched
 * against `relativeTargets`, since the directory they are relative to is not
 * known for certain.
 */
interface PathRead {
  readonly abs: readonly Seg[][];
  readonly rel: readonly Seg[][];
}

/** Whether `read` could name one of `absTargets`, or (a relative path) one of `relTargets`. */
function namesAny(read: PathRead, absTargets: readonly (readonly Seg[])[], relTargets: readonly (readonly Seg[])[]): boolean {
  return read.abs.some((p) => absTargets.some((t) => couldMatch(p, t))) || read.rel.some((p) => relTargets.some((t) => couldMatch(p, t)));
}

/** Whether the Bash command is a directory change (`cd`, `pushd`, as the program word could expand). */
function changesDirectory(words: readonly string[]): boolean {
  const program = words.flatMap(braceExpand).find((w) => w !== "");
  return program !== undefined && (wordCouldBe(basename(program), "cd") || wordCouldBe(basename(program), "pushd"));
}

/** A tool's literal path: `~` / `~/…` under the home dir; anything else absolute, or relative (resolved against `cwd` when known). */
function toolPathPatterns(raw: string, cwd: string | undefined, homeDir: string): PathRead {
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("/")) {
    return { abs: [patternOf(withoutFirmlink(expandPath(raw, "/", homeDir)), false)], rel: [] };
  }
  const abs = cwd === undefined ? [] : [patternOf(withoutFirmlink(expandPath(raw, cwd, homeDir)), false)];
  return { abs, rel: [patternOf(normalisePath(`/${raw}`, false), false)] };
}

/**
 * `command` split into words as the shell would before running it, for
 * inspection only: a space or tab separates words (as in bash; the rail
 * refuses any other whitespace or control character before splitting,
 * `UNREADABLE_BASH_CHARS`); single quotes keep everything
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
    } else if (c === " " || c === "\t") {
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

/**
 * A shell word's value as a path: absolute (`/…`; `~`/`~/…` home; any other
 * `~…` but `~+` — `~user`, `~-`, a named dir — "any directory"), or relative
 * (anything else, and `~+`/`~+/…`, the cwd), with the relative text.
 */
function shellPath(value: string, homeDir: string): { readonly abs: string } | { readonly rel: string } {
  if (!value.startsWith("~")) return value.startsWith("/") ? { abs: value } : { rel: value };
  const slash = value.indexOf("/");
  const head = slash === -1 ? value : value.slice(0, slash);
  const rest = slash === -1 ? "" : value.slice(slash);
  if (head === "~") return { abs: `${homeDir}${rest}` };
  if (head === "~+") return { rel: rest };
  return { abs: `/**${rest === "" ? "/*" : rest}` };
}

/**
 * Every path pattern the Bash `words` could name, as the program reading each might
 * (failing closed): the word brace-expanded, both raw and percent-decoded
 * (`file:///…/Loomwright%20Studio/api.json`), and when it holds a `:` also
 * with any `?query` / `#fragment` cut off; then for each of those the whole
 * text, the text after EVERY `=` (`--file=…`, `key=…`), `@` (`-d @file`,
 * `-d@file`) and `:` (`file:api.json`), the rest of a glued short option
 * (`-C/path`), and every substring starting at a `/` (`file:///abs`,
 * `-d@/abs`, `x/../abs`) or at a `~/` inside the word. Each is `~`-expanded,
 * normalised and without a `/System/Volumes/Data` firmlink prefix; a relative
 * one is read both as relative (`PathRead.rel`) and, when `cwd` is known,
 * resolved against it; texts that normalise to the same path are read once.
 * `undefined` when the distinct texts sum to more than `MAX_RAIL_PATH_TEXT`
 * characters (the caller denies).
 */
function bashPathPatterns(words: readonly string[], cwd: string | undefined, homeDir: string): PathRead | undefined {
  const budget = { left: MAX_RAIL_PATH_TEXT };
  const seen = new Set<string>();
  const abs: Seg[][] = [];
  const rel: Seg[][] = [];
  const addAbs = (text: string): void => {
    const path = withoutFirmlink(normalisePath(text, true));
    if (seen.has(path)) return;
    seen.add(path);
    abs.push(patternOf(path, true));
  };
  for (const word of words) {
    const values = bashPathValues(word, budget);
    if (values === undefined) return undefined;
    for (const v of values) {
      const p = shellPath(v, homeDir);
      if ("abs" in p) {
        addAbs(p.abs);
        continue;
      }
      if (cwd !== undefined) addAbs(`${cwd}/${p.rel}`);
      const path = normalisePath(`/${p.rel}`, true);
      if (seen.has(`rel:${path}`)) continue;
      seen.add(`rel:${path}`);
      rel.push(patternOf(path, true));
    }
  }
  return { abs, rel };
}

/**
 * The texts `bashPathPatterns` reads as paths in one Bash word, each new one
 * charged to `budget` by its length; `undefined` as soon as the budget runs
 * out, before any more text is built.
 */
function bashPathValues(word: string, budget: { left: number }): string[] | undefined {
  const values = new Set<string>();
  const add = (v: string): boolean => {
    if (v === "" || values.has(v)) return true;
    budget.left -= v.length;
    values.add(v);
    return budget.left >= 0;
  };
  for (const expanded of braceExpand(word)) {
    const forms = new Set([expanded, percentDecoded(expanded)]);
    for (const f of [...forms]) if (f.includes(":")) forms.add(f.replace(/[?#].*$/, ""));
    for (const e of forms) {
      if (!add(e)) return undefined;
      if (/^-[^-]./.test(e) && !add(e.slice(2))) return undefined;
      for (let k = 0; k < e.length; k++) {
        const c = e[k] as string;
        if ((c === "=" || c === "@" || c === ":") && k < e.length - 1 && !add(e.slice(k + 1))) return undefined;
        if (k > 0 && (c === "/" || (c === "~" && (k === e.length - 1 || e[k + 1] === "/"))) && !add(e.slice(k))) return undefined;
      }
    }
  }
  return [...values];
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
  /**
   * The protected paths as a relative path could name them from a directory
   * the session can reach (`relativeTargets` with the cut at the data dir's
   * own name): used when the hook's `cwd` is known (at worst stale).
   */
  readonly protectedRelReachable: readonly Seg[][];
  /** The protected paths as a relative path could name them from any directory outside each entry: no `cwd`, or a `cd`. */
  readonly protectedRelAny: readonly Seg[][];
  /** The outward paths with the short label an approval's action shows. */
  readonly outward: readonly (readonly [string, readonly Seg[]])[];
  /** The outward paths as a relative path could name them from any directory outside each entry. */
  readonly outwardRel: readonly (readonly [string, readonly Seg[]])[];
}

/**
 * `target` as a relative path could name it from a directory the session is
 * in but the rail does not know: every tail of `target` that starts at one of
 * its segments before `limit` (default: before its last named segment, so the
 * directory is an ancestor of the entry, never inside it), keeping a trailing
 * `GLOBSTAR`. A tail starting at a `GLOBSTAR` covers every directory that
 * `GLOBSTAR` could stand for. (`[…, .git, hooks, **]` gives `.git/hooks/…` and
 * `hooks/…`; `<dataDir>/config/**` gives `config/…`, `Loomwright Studio/config/…`
 * and so on up to the root.)
 */
function relativeTargets(target: readonly Seg[], limit?: number): Seg[][] {
  const named = target[target.length - 1] === GLOBSTAR ? target.length - 1 : target.length;
  const end = Math.min(limit ?? named, named);
  const tails: Seg[][] = [];
  for (let i = 0; i < end; i++) tails.push(target.slice(i));
  return tails;
}

function railTargets(dataDir: string, homeDir: string): RailTargets {
  const protectedPaths: Seg[][] = [];
  const protectedRelReachable: Seg[][] = [];
  const protectedRelAny: Seg[][] = [];
  for (const d of firmlinkForms(dataDir)) {
    const root = patternOf(normalisePath(d, false), false);
    for (const t of [root, ...PROTECTED_DATA_DIRS.map((n) => [...root, lit(n), GLOBSTAR]), ...PROTECTED_DATA_FILES.map((f) => [...root, lit(f)])]) {
      protectedPaths.push(t);
      // A session cannot `cd` to or into the data dir: every `cd` that names it is denied. If it started there,
      // its reported cwd (at worst stale, still that start) resolves every relative path inside and denies it.
      // So with a known cwd a tail must start at or above the data dir's own name.
      protectedRelReachable.push(...relativeTargets(t, root.length));
      protectedRelAny.push(...relativeTargets(t));
    }
  }
  const outward: (readonly [string, readonly Seg[]])[] = [
    ...firmlinkForms(homeDir).map((h): readonly [string, readonly Seg[]] => ["~/.claude/", [...patternOf(normalisePath(h, false), false), lit(".claude"), GLOBSTAR]]),
    ["a settings*.json file", [GLOBSTAR, segment("settings*.json", true)]],
    ["a hooks file", [GLOBSTAR, lit("hooks.json")]],
    ["a hooks file", [GLOBSTAR, lit(".git"), lit("hooks"), GLOBSTAR]],
    ["a hooks file", [GLOBSTAR, lit(".claude"), GLOBSTAR, lit("hooks"), GLOBSTAR]],
  ];
  const outwardRel = outward.flatMap(([label, t]) => relativeTargets(t).map((tail): readonly [string, readonly Seg[]] => [label, tail]));
  return { protectedPaths, protectedRelReachable, protectedRelAny, outward, outwardRel };
}

/**
 * Every reason the paths `read` names are in the outward set (the short labels
 * an approval's action shows), each once, absolute matches first: the first
 * is the call's label, the rest feed `alsoReads`. Empty when none.
 */
function outwardLabels(read: PathRead, targets: RailTargets): string[] {
  const labels: string[] = [];
  for (const [label, target] of targets.outward) if (!labels.includes(label) && read.abs.some((p) => couldMatch(p, target))) labels.push(label);
  for (const [label, target] of targets.outwardRel) if (!labels.includes(label) && read.rel.some((p) => couldMatch(p, target))) labels.push(label);
  return labels;
}

/** Whether a shell word could be `literal` (case-folded), after brace expansion and as a glob. */
function wordCouldBe(word: string, literal: string): boolean {
  const target = segment(literal, false);
  return braceExpand(word).some((e) => tokensIntersect(segment(e, true), target));
}

/**
 * Whether the Bash `command`'s program could be `name`, read as the rail reads
 * it: the first non-empty brace-expanded shell word, its basename, case-folded
 * and compared as a glob (`gh`, `/usr/bin/gh`, `GH` and `g{h,x}` are `gh`).
 * `env gh …`, `sh -c …` and a script are not: the rail's documented limit.
 * Pure.
 */
export function programCouldBe(command: string, name: string): boolean {
  // Expand word by word and stop at the first non-empty result: later words are never brace-expanded.
  let program: string | undefined;
  for (const word of shellWords(command)) {
    program = braceExpand(word).find((w) => w !== "");
    if (program !== undefined) break;
  }
  return program !== undefined && wordCouldBe(basename(program), name);
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

/**
 * Every recognised outward form of a Bash command's words (`git push`, `gh pr
 * create`, `gh api POST`), each once, the call's action first; `["merge"]` when
 * any reading is a merge; empty when none.
 */
function commandForms(words: readonly string[]): string[] {
  // Brace expansion can turn one word into several argv words (`gh {pr,merge} 12` is `gh pr merge 12`).
  // An empty word is dropped: bash removes an unquoted empty one (`{,} gh pr merge`, `gh api -X {,} PUT …`),
  // cobra skips a quoted one when it looks up a subcommand, and reading one away only over-holds.
  const [program, ...rest] = words.flatMap(braceExpand).filter((w) => w !== "");
  if (program === undefined) return [];
  const name = basename(program).toLowerCase();
  // `git-push` (git's libexec spelling) is `git push`.
  if (name === "git") return gitForms(rest);
  if (name.startsWith("git-")) return gitForms([name.slice(4), ...rest]);
  if (name !== "gh") return [];
  // A flag word could take the next word as its value or not: every reading is checked, a merge in any wins.
  const readings = ghPositionals(rest);
  if (readings === undefined) return ["merge"];
  const forms: string[] = [];
  for (const reading of readings) {
    const f = ghForm(rest, reading);
    if (f === "merge") return [f];
    if (f !== undefined && !forms.includes(f)) forms.push(f);
  }
  return forms;
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
 * git's outward forms, each once, in the order the words give them: any word
 * after `git` that could be one of `GIT_OUTWARD` (so no option spelling before
 * the subcommand can hide a push), `submit` after `p4`, then an alias
 * definition (`GIT_ALIAS_CONFIG`, `--config-env`).
 */
function gitForms(args: readonly string[]): string[] {
  const forms: string[] = [];
  const add = (form: string): void => {
    if (!forms.includes(form)) forms.push(form);
  };
  let p4 = false;
  for (const word of args) {
    for (const [sub, label] of GIT_OUTWARD) if (wordCouldBe(word, sub)) add(label);
    if (p4 && wordCouldBe(word, "submit")) add("git p4 submit");
    p4 ||= wordCouldBe(word, "p4");
  }
  if (args.some((w) => GIT_ALIAS_CONFIG.some((g) => globsMeet(w, g)))) add("git alias");
  return forms;
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
 * `args`; an empty word is neither a command word nor a flag): a flag that could take the next word as its value
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
      // cobra skips an empty word when it looks up a subcommand (`gh pr '' merge` is `gh pr merge`).
      if (a === "") continue;
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

/** A defensive, frozen copy: later changes to the caller's arrays cannot reach the gate. `never` is copied only when present. */
export function freezePolicy(policy: ToolPolicy): ToolPolicy {
  return Object.freeze({
    allowedTools: Object.freeze([...policy.allowedTools]),
    allowedBashPrefixes: Object.freeze([...policy.allowedBashPrefixes]),
    ...(policy.never === undefined ? {} : { never: Object.freeze([...policy.never]) }),
  });
}
