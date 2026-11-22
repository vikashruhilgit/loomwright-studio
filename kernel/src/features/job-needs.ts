// What a catalogue job's work needs (phase 8 item 20c): the one place a job's
// full needs are resolved and compared with what a crew member holds, shared by
// the charter readiness check (`../agents/charter-readiness.ts`), the playbook
// fit and dry run (`../playbooks/fit.ts`) and Wright's drafting text
// (`catalogueText` in `./catalogue.ts`), so the three never disagree on the
// same charter (the way `jobGranted` / `holdsConnector` are shared).
//
// A job's needs have five parts (AC1):
//   - kernel tools: the catalogue's tools of that job (never listed a second
//     time: `./catalogue.ts` is generated from the registered tools);
//   - Claude tools (`Skill`, `Agent`, ...) and Bash prefixes: the job's own
//     declaration (`TOOL_JOB_DEFINITIONS[job].needs`) plus the needs of any
//     Loomwright command it reaches;
//   - connectors at a level (`connectorNeeds` of its tools, its own declaration
//     and its commands');
//   - a workspace (a copy of a repo to work in).
//
// Where a Loomwright command's needs come from (T4, contract first): the
// active install's `capabilities.json` `commands[].needs` where it declares
// them (`../loomwright/contract.ts`), else the pinned table below. The kernel
// reads the contract once, when it builds the tool catalogue
// (`loadCommandNeeds`, fail-safe), and the resolved table rides on the
// `ToolCatalogue` (`commandNeeds`), so readiness, fit and the dry run read it
// from `ctx.catalogue` with no new plumbing.
//
// Under D44 and D45 (kernel-owned launch) a command a job reaches is launched
// either by the KERNEL (`launch: "kernel"`: `/loomwright:automate`,
// `/loomwright:review-pr` and `/loomwright:automate --merge-parked`, each under
// its own frozen run policy in `../automate/launch.ts`; their Claude tools and
// Bash prefixes are the kernel's, never a crew need) or by the CREW session
// (`launch: "crew"`). No row is crew-launched today, so no job's needs include
// `Skill`, `Agent`, `Bash` or a Loomwright shell prefix, and Wright drafts none.
// The `crew` value stays as a mechanism: a crew-launched command's needs would
// be declared truthfully, as a gap no charter change should close
// (`closable: false`), because a crew member must not hold `Skill` or a
// Loomwright shell prefix (invariant 3).
//
// A kernel-launched command's outward needs (phase 8 item 25g) are read from
// the frozen run policy the kernel launches it under (`runPolicy`), through the
// rail's own labels (`neverCategoriesAdmitted` in `../sessions/policy.ts`),
// never from a hand list: the run session inherits the crew member's `never`
// list (D45), so a `never` entry naming one of them defeats the job, and
// `jobNeedsGaps` reports it as a `"never"` gap only the owner can close.
//
// Mechanism only (invariant 1): this module compares lists and grants nothing.
//
// CLI-safe like the catalogue: it imports the catalogue, the active-install
// resolver (node `fs`), the run policies (`../automate/launch.js`, itself
// CLI-loaded), the rail's pure category reader (`../sessions/policy.js`) and
// type-level modules, never `../tools/server.js`, `../kernel.js` or the Agent
// SDK. `../automate/launch.js` closes a runtime import cycle (`launch.ts` →
// `playbooks/runs.ts` → `playbooks/items.ts` → `playbooks/fit.ts` → this
// module), so its constants are read only inside functions (each row's lazy
// `runPolicy`), never while this module loads.
import { AUTOMATE_RUN_POLICY, MERGE_PARKED_RUN_POLICY, REVIEW_PR_RUN_POLICY } from "../automate/launch.js";
import type { ConnectorKind } from "../integrations/types.js";
import { resolveLoomwrightInstall } from "../loomwright/active-install.js";
import type { ResolveLoomwrightInstallOptions } from "../loomwright/active-install.js";
import type { LoomwrightContractEntry } from "../loomwright/contract.js";
import { NEVER_CATEGORIES, neverCategoriesAdmitted } from "../sessions/policy.js";
import type { NeverCategory } from "../sessions/policy.js";
import type { ToolPolicy } from "../sessions/types.js";
import {
  CONNECTOR_LABELS,
  KERNEL_TOOL_PREFIX,
  TOOL_JOB_DEFINITIONS,
  TOOL_JOBS,
  connectorAccessText,
  connectorNeeds,
  holdsConnector,
} from "./catalogue.js";
import type { ConnectorNeedDeclaration, HeldConnectors, NeedLabel, ToolCatalogue, ToolJob } from "./catalogue.js";

// ---- Plain-words labels ----------------------------------------------------------------

/**
 * A Claude tool's name → what it lets a session do, in plain words. The raw
 * name is shown only on a display's `enforced:` line, never in a readiness or
 * fit line.
 */
export const CLAUDE_TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  Skill: "run skills",
  Bash: "run shell commands",
  Agent: "start helper agents",
  Read: "read files",
  Write: "write files",
  Edit: "edit files",
  Glob: "find files",
  Grep: "search files",
  AskUserQuestion: "ask the owner a question",
});

/** The label of a Claude tool no table names (a newer Loomwright contract may declare one). */
export const UNKNOWN_CLAUDE_TOOL_LABEL = "use a tool Loomwright asks for";

/** A Bash prefix → what it lets a session do, in plain words. */
export const BASH_PREFIX_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "git commit": "commit with git",
  "git push": "push with git",
  "git diff": "see changes with git",
  "git fetch": "fetch with git",
  "gh pr": "work with pull requests on GitHub",
});

/** The label of a Bash prefix no table names. */
export const UNKNOWN_BASH_PREFIX_LABEL = "run another shell command Loomwright asks for";

/** `name`'s label with its plain words (a Claude tool). */
export function claudeToolNeed(name: string): NeedLabel {
  return { name, label: CLAUDE_TOOL_LABELS[name] ?? UNKNOWN_CLAUDE_TOOL_LABEL };
}

/** `prefix`'s label with its plain words (a Bash prefix). */
export function bashPrefixNeed(prefix: string): NeedLabel {
  return { name: prefix, label: BASH_PREFIX_LABELS[prefix] ?? UNKNOWN_BASH_PREFIX_LABEL };
}

/** The plain words for a workspace need (the app keys its fix on `no copy of a repo to work in`, so readiness words it `no …`). */
export const WORKSPACE_NEED_LABEL = "a copy of a repo to work in";

/**
 * A `never` category → the outward action it forbids, in plain words, as the
 * end of "needs to …" (`push with git`, `open a PR`). Every category has words
 * (the `Record` type keeps it total); the raw category is never on a readiness
 * or fit line.
 */
export const NEVER_ACTION_LABELS: Readonly<Record<NeverCategory, string>> = Object.freeze({
  git_push: "push with git",
  alias_define: "define a command alias",
  gh_pr_create: "open a PR",
  gh_pr_comment: "comment on a PR",
  gh_pr_review: "review a PR",
  gh_pr_edit: "edit a PR",
  gh_pr_close: "close a PR",
  gh_pr_request_reviewers: "ask for reviewers on a PR",
  gh_pr_comment_reply: "reply to a PR comment",
  gh_issue_create: "open an issue",
  gh_issue_comment: "comment on an issue",
  gh_issue_edit: "edit an issue",
  gh_issue_close: "close an issue",
  gh_api_write: "write through the GitHub API",
  mcp_write: "write through a connector's tools",
  settings_write: "change Claude's settings files",
  hooks_write: "change hooks files",
});

// ---- The pinned Loomwright command table -----------------------------------------------

/** The Loomwright version `LOOMWRIGHT_COMMAND_NEEDS` was read from. A newer install may declare its own needs (contract first). */
export const LOOMWRIGHT_COMMAND_NEEDS_VERSION = "17.37.0";

/** Who starts a command a job reaches (D44): the kernel, under its frozen policy, or the crew session itself. */
export type CommandLaunch = "kernel" | "crew";

/** One command a job reaches, and what running it needs. */
export interface CommandNeeds {
  /** The invocation the kernel or the crew session runs, without its arguments' values: the key of the table. */
  readonly invocation: string;
  /** The command's name in Loomwright's contract (`commands[].name`): a contract's `needs` for it overrides this row. */
  readonly command: string;
  readonly launch: CommandLaunch;
  readonly claudeTools: readonly NeedLabel[];
  readonly bashPrefixes: readonly NeedLabel[];
  readonly connectors: readonly ConnectorNeedDeclaration[];
  readonly workspace: boolean;
  /**
   * A kernel-launched command's frozen run policy (`../automate/launch.ts`),
   * read lazily: only when `resolveJobNeeds` runs, never while this module
   * loads (the import cycle above). Its outward needs are what it admits
   * (`neverCategoriesAdmitted`). Absent for a crew-launched command. Like
   * `launch`, never read from a contract.
   */
  readonly runPolicy?: () => ToolPolicy;
}

/** Command needs by invocation. */
export type LoomwrightCommandNeedsTable = Readonly<Record<string, CommandNeeds>>;

const frozenRow = (row: CommandNeeds): CommandNeeds =>
  Object.freeze({ ...row, claudeTools: Object.freeze([...row.claudeTools]), bashPrefixes: Object.freeze([...row.bashPrefixes]), connectors: Object.freeze([...row.connectors]) });

/**
 * The commands a catalogue job reaches, pinned from Loomwright
 * `LOOMWRIGHT_COMMAND_NEEDS_VERSION` (no command's `capabilities.json` entry
 * declares needs there, only `name` and `description`). Used for every command
 * the active install's contract declares no `needs` for. Frozen.
 *
 * Every row is `launch: "kernel"` (D44, D45): the kernel starts the command
 * as its own session under a frozen run policy (`../automate/launch.ts`), so
 * the rows' Claude tools and prefixes (the main ones each command asks for)
 * are the kernel's, never a crew need.
 * - `/loomwright:automate` (`automate_tickets`): the ticket run, under
 *   `AUTOMATE_RUN_POLICY`.
 * - `/loomwright:review-pr` (`triage_pr_comments`: `kernel_pr_route`'s
 *   `automate_fix` and `review_pr` routes): the fix.
 * - `/loomwright:automate --merge-parked` (`ask_for_merge`:
 *   `kernel_automate_merge_check`'s `go`): the merge, under
 *   `MERGE_PARKED_RUN_POLICY`.
 * The fix runs under `REVIEW_PR_RUN_POLICY`. Each row's `runPolicy` reads its
 * constant only when called (the import cycle in the header).
 */
export const LOOMWRIGHT_COMMAND_NEEDS: LoomwrightCommandNeedsTable = Object.freeze({
  "/loomwright:automate": frozenRow({
    invocation: "/loomwright:automate",
    command: "automate",
    launch: "kernel",
    claudeTools: [claudeToolNeed("Skill"), claudeToolNeed("Bash"), claudeToolNeed("Agent")],
    bashPrefixes: [bashPrefixNeed("git commit"), bashPrefixNeed("git push"), bashPrefixNeed("gh pr")],
    connectors: [],
    workspace: true,
    runPolicy: () => AUTOMATE_RUN_POLICY,
  }),
  "/loomwright:review-pr": frozenRow({
    invocation: "/loomwright:review-pr",
    command: "review-pr",
    launch: "kernel",
    claudeTools: [claudeToolNeed("Skill"), claudeToolNeed("Bash"), claudeToolNeed("Agent")],
    bashPrefixes: [bashPrefixNeed("git diff"), bashPrefixNeed("git commit"), bashPrefixNeed("git push"), bashPrefixNeed("gh pr")],
    connectors: [],
    workspace: true,
    runPolicy: () => REVIEW_PR_RUN_POLICY,
  }),
  "/loomwright:automate --merge-parked": frozenRow({
    invocation: "/loomwright:automate --merge-parked",
    command: "automate",
    launch: "kernel",
    claudeTools: [claudeToolNeed("Skill"), claudeToolNeed("Bash")],
    bashPrefixes: [bashPrefixNeed("gh pr")],
    connectors: [],
    workspace: true,
    runPolicy: () => MERGE_PARKED_RUN_POLICY,
  }),
});

/**
 * The command-needs table: `LOOMWRIGHT_COMMAND_NEEDS`, each row's needs
 * replaced by the install's contract where the contract's entry for the row's
 * `command` declares `needs` (contract first, AC2). `launch` is never read from
 * the contract (it is the kernel's own fact, D44), and neither is `runPolicy`
 * (the row's own lazy run-policy accessor is kept). `commands` undefined (no
 * install, or none read) is the pinned table as it is. A declared connector
 * whose kind the kernel does not know is dropped.
 */
export function commandNeedsTable(commands?: readonly LoomwrightContractEntry[]): LoomwrightCommandNeedsTable {
  if (commands === undefined) return LOOMWRIGHT_COMMAND_NEEDS;
  const rows: Record<string, CommandNeeds> = {};
  for (const [invocation, row] of Object.entries(LOOMWRIGHT_COMMAND_NEEDS)) {
    const declared = commands.find((c) => c.name === row.command)?.needs;
    rows[invocation] =
      declared === undefined
        ? row
        : frozenRow({
            ...row,
            claudeTools: declared.claude_tools.map(claudeToolNeed),
            bashPrefixes: declared.bash_prefixes.map(bashPrefixNeed),
            connectors: declared.connectors.filter((c): c is { kind: ConnectorKind; write: boolean } => Object.hasOwn(CONNECTOR_LABELS, c.kind)),
            workspace: declared.workspace,
          });
  }
  return Object.freeze(rows);
}

/**
 * The command-needs table of the active Loomwright install (`commandNeedsTable`
 * of its contract), read once. Fail-safe: no install, an unreadable install or
 * a bad contract is the pinned table, never a throw, so it never stops
 * `startKernel`. `resolve` is the install resolver (default
 * `resolveLoomwrightInstall`; tests inject).
 */
export function loadCommandNeeds(
  options: ResolveLoomwrightInstallOptions = {},
  resolve: (options: ResolveLoomwrightInstallOptions) => { readonly contract: { readonly commands: readonly LoomwrightContractEntry[] } } = resolveLoomwrightInstall,
): LoomwrightCommandNeedsTable {
  try {
    return commandNeedsTable(resolve(options).contract.commands);
  } catch {
    return LOOMWRIGHT_COMMAND_NEEDS;
  }
}

// ---- A job's resolved needs --------------------------------------------------------------

/** One Claude tool or Bash prefix a job's work needs. */
export interface JobNeedItem {
  readonly name: string;
  /** Plain words: what it lets a session do. */
  readonly label: string;
  /** `false` when it comes from a crew-launched command (no row is, today): no charter should hold it. */
  readonly closable: boolean;
  /** The command (invocation) it comes from; absent for the job's own declaration. */
  readonly command?: string;
}

/** One connector grant a job's work needs. */
export interface JobConnectorNeed {
  readonly kind: ConnectorKind;
  readonly write: boolean;
  /** `tool`: a kernel tool of the job declares it; `job`: the job's own declaration; `command`: a crew-launched command's. */
  readonly source: "tool" | "job" | "command";
  readonly command?: string;
}

/** One command a job reaches, as resolved. */
export interface JobCommandReach {
  readonly invocation: string;
  readonly launch: CommandLaunch;
  readonly claudeTools: readonly NeedLabel[];
  readonly bashPrefixes: readonly NeedLabel[];
  /**
   * The outward actions its kernel run policy admits (`neverCategoriesAdmitted`
   * of the row's `runPolicy`), in `NEVER_CATEGORIES` order: what a `never`
   * entry can defeat. Empty for a crew-launched command or a row with no run policy.
   */
  readonly outward: readonly NeverCategory[];
}

/** A job's full needs (AC1): all five parts. */
export interface JobNeeds {
  readonly job: ToolJob;
  readonly label: string;
  /** The catalogue's tools of the job, as a charter lists them (`mcp__kernel__<name>`); empty without a catalogue. */
  readonly kernelTools: readonly string[];
  /** The job's own Claude tools, then the crew-launched commands' (a kernel-launched command's are the kernel's and not here). */
  readonly claudeTools: readonly JobNeedItem[];
  readonly bashPrefixes: readonly JobNeedItem[];
  readonly connectors: readonly JobConnectorNeed[];
  readonly workspace: boolean;
  /** Every command the job reaches, kernel-launched ones included (so a display can say who starts it). */
  readonly commands: readonly JobCommandReach[];
}

/**
 * The full needs of `job`: its catalogue tools (`catalogue`; none without one),
 * its own declaration and its commands' needs. A command's needs come from
 * `catalogue.commandNeeds` (the active install's contract where it declares
 * them, resolved when the catalogue was built), else the pinned table. A
 * kernel-launched command's Claude tools, prefixes and connectors are the
 * kernel's own policy and are not the job's needs (D44); a crew-launched
 * command's are, marked `closable: false`.
 */
export function resolveJobNeeds(job: ToolJob, catalogue?: ToolCatalogue): JobNeeds {
  const declared = TOOL_JOB_DEFINITIONS[job].needs;
  const table = catalogue?.commandNeeds ?? LOOMWRIGHT_COMMAND_NEEDS;
  const tools = (catalogue?.tools ?? []).filter((t) => t.job === job);
  const reached = declared.loomwrightCommands.flatMap((invocation) => (table[invocation] === undefined ? [] : [table[invocation]]));
  const crew = reached.filter((c) => c.launch === "crew");

  const claudeTools: JobNeedItem[] = declared.claudeTools.map((n) => ({ ...n, closable: true }));
  const bashPrefixes: JobNeedItem[] = declared.bashPrefixes.map((n) => ({ ...n, closable: true }));
  const connectors: JobConnectorNeed[] = [
    ...connectorNeeds(tools).map((n): JobConnectorNeed => ({ kind: n.kind, write: n.write, source: "tool" })),
    ...declared.connectors.map((n): JobConnectorNeed => ({ kind: n.kind, write: n.write, source: "job" })),
  ];
  for (const c of crew) {
    for (const n of c.claudeTools) claudeTools.push({ ...n, closable: false, command: c.invocation });
    for (const n of c.bashPrefixes) bashPrefixes.push({ ...n, closable: false, command: c.invocation });
    for (const n of c.connectors) connectors.push({ kind: n.kind, write: n.write, source: "command", command: c.invocation });
  }
  return {
    job,
    label: TOOL_JOBS[job],
    kernelTools: tools.map((t) => `${KERNEL_TOOL_PREFIX}${t.name}`),
    claudeTools,
    bashPrefixes,
    connectors,
    workspace: declared.workspace || crew.some((c) => c.workspace),
    commands: reached.map((c) => ({
      invocation: c.invocation,
      launch: c.launch,
      claudeTools: c.claudeTools,
      bashPrefixes: c.bashPrefixes,
      // Read here, at call time, never at module load (the import cycle in the header).
      outward: c.launch === "kernel" && c.runPolicy !== undefined ? neverCategoriesAdmitted(c.runPolicy()) : [],
    })),
  };
}

// ---- Comparing needs with what a member holds --------------------------------------------

/**
 * What a crew member holds, as far as the caller wants compared. A part left
 * undefined is not compared (`connectors`, `workspace`), so a caller that
 * already checks the connector grant or the workspace its own way (the
 * readiness block and the fit check do, for the tools' connectors and
 * `jobNeedsWorkspace`) asks only for the rest.
 */
export interface HeldNeeds {
  /** The member's `allowedTools` (Claude tools by name, kernel tools as `mcp__kernel__<name>`). */
  readonly allowedTools: readonly string[];
  /** The member's `allowedBashPrefixes`. */
  readonly allowedBashPrefixes: readonly string[];
  /** The member's connector grant: compared when present. */
  readonly connectors?: HeldConnectors;
  /** Whether the member has a workspace (a copy of a repo): compared when present. */
  readonly workspace?: boolean;
  /**
   * The member's `never` list: compared when present, with the outward actions
   * each kernel-launched command's run policy admits (the run inherits it, D45).
   */
  readonly never?: readonly NeverCategory[];
}

/** What a missing need is. `never`: an outward action a job's kernel run needs that the member's `never` list forbids. */
export type NeedsGapKind = "claude_tool" | "bash_prefix" | "connector" | "workspace" | "never";

/** One declared need a member lacks. */
export interface NeedsGap {
  readonly job: ToolJob;
  readonly kind: NeedsGapKind;
  /** The raw name (a Claude tool, a Bash prefix, a connector kind, a `never` category): for an `enforced:` line or a proposed update, never for a readiness or fit line. */
  readonly name: string;
  /** The plain words for `name`: `run skills`, `GitHub write access`, `a copy of a repo to work in`, `open a PR`. */
  readonly label: string;
  /** `true` when a charter change can close it (a Claude tool or prefix the job itself declares); `false` when only the owner can (a connector grant, a workspace, a `never` entry) or no charter should (a crew-launched command's `Skill` and prefixes, D44). */
  readonly closable: boolean;
  /** The command (invocation) the need comes from, when it is a command's. */
  readonly command?: string;
  /** For a connector gap: whether the missing grant is the write level, and where the need was declared (a tool's, which readiness and fit already check, or the job's or a command's). */
  readonly write?: boolean;
  readonly source?: JobConnectorNeed["source"];
}

/**
 * Whether `held` covers the Bash prefix `need`: some held prefix is `need` or a
 * word-boundary prefix of it (`git` or `git push` hold `git push`; `git pu`
 * does not), the rule the session's own Bash filter uses.
 */
export function bashPrefixHeld(held: readonly string[], need: string): boolean {
  return held.some((p) => p === need || need.startsWith(`${p} `));
}

/**
 * Every declared need of `needs` that `held` lacks, in a stable order: Claude
 * tools, Bash prefixes, connectors, the workspace, then (when `held.never` is
 * given) each outward action a kernel-launched command's run policy admits that
 * `held.never` forbids, once per category in `NEVER_CATEGORIES` order, never
 * closable (removing a `never` entry is the owner's call). Kernel tools are not
 * compared (`jobGranted` / `jobLackingTools` in `./catalogue.ts` are the one
 * rule for them). A job or command that needs Bash prefixes lists `Bash` among
 * its Claude tools too, so a prefix without the tool is a gap of its own.
 */
export function jobNeedsGaps(needs: JobNeeds, held: HeldNeeds): NeedsGap[] {
  const gaps: NeedsGap[] = [];
  const tools = new Set(held.allowedTools);
  for (const n of needs.claudeTools) {
    if (tools.has(n.name)) continue;
    gaps.push({ job: needs.job, kind: "claude_tool", name: n.name, label: n.label, closable: n.closable, ...(n.command === undefined ? {} : { command: n.command }) });
  }
  for (const n of needs.bashPrefixes) {
    if (bashPrefixHeld(held.allowedBashPrefixes, n.name)) continue;
    gaps.push({ job: needs.job, kind: "bash_prefix", name: n.name, label: n.label, closable: n.closable, ...(n.command === undefined ? {} : { command: n.command }) });
  }
  if (held.connectors !== undefined) {
    for (const n of needs.connectors) {
      if (holdsConnector(held.connectors, n)) continue;
      gaps.push({ job: needs.job, kind: "connector", name: n.kind, label: connectorAccessText(n), closable: false, write: n.write, source: n.source, ...(n.command === undefined ? {} : { command: n.command }) });
    }
  }
  if (held.workspace === false && needs.workspace) gaps.push({ job: needs.job, kind: "workspace", name: "workspace", label: WORKSPACE_NEED_LABEL, closable: false });
  if (held.never !== undefined) {
    const never = held.never;
    for (const category of NEVER_CATEGORIES) {
      if (!never.includes(category)) continue;
      const from = needs.commands.find((c) => c.outward.includes(category));
      if (from === undefined) continue;
      gaps.push({ job: needs.job, kind: "never", name: category, label: NEVER_ACTION_LABELS[category], closable: false, command: from.invocation });
    }
  }
  return gaps;
}
