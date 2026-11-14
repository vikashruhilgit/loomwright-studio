// The kernel's tool catalogue (phase 8 item 16): every kernel tool a crew
// session can be granted, each with one job and one plain purpose line,
// generated from the registered tools themselves, never kept as a second list.
//
// - The job is declared on the tool (`ContributedTool.job`, beside its name),
//   from the closed vocabulary `TOOL_JOBS`; `mergeContributions` refuses any
//   other. A tool with no job (the phase 1 six) is under `general`, never
//   dropped.
// - The purpose line is the tool's own registered description's first
//   sentence (`purposeOf`), so the catalogue and the tool a session is offered
//   say the same thing. A leading `Read-only.` sentence is skipped and the next
//   sentence used with ` (read only)` added, so no line reads only "Read-only.".
//
// Mechanism only (invariant 1): the catalogue says what each tool does; which
// jobs a crew member gets is the owner's, through a charter Wright drafts and
// the owner approves. The tool server (`../tools/server.ts`) builds it from the
// composition's own tools and appends `catalogueText` to the drafting tools'
// descriptions; the charter display groups granted kernel tools by job with
// `jobDisplayLines`; both reach it through `ContributedToolContext.catalogue`,
// never by importing the feature registry (no module-load cycle).
//
// CLI-safe like the feature seam (`./contribution.ts`): it imports only
// type-level kernel modules and the phase 1 descriptions leaf, never
// `../tools/server.js`, `../kernel.js` or the Agent SDK.
import type { ConnectorKind } from "../integrations/types.js";
import { PHASE1_DESCRIPTIONS } from "../tools/phase1-descriptions.js";
import type { ContributedTool } from "./contribution.js";
import type { LoomwrightCommandNeedsTable } from "./job-needs.js";

/** A Claude tool or a Bash prefix a job needs, with the plain words for it (never the raw name on a readiness line). */
export interface NeedLabel {
  readonly name: string;
  readonly label: string;
}

/** A connector grant a job needs beyond what its tools declare: `write` for the write level. */
export interface ConnectorNeedDeclaration {
  readonly kind: ConnectorKind;
  readonly write: boolean;
}

/**
 * What a job's work needs, beyond its kernel tools (those are the catalogue's
 * tools of the job, never listed again). `loomwrightCommands` are the
 * invocations of the Loomwright commands it reaches, keyed as
 * `LOOMWRIGHT_COMMAND_NEEDS` is (`./job-needs.ts`); their needs are resolved
 * there (`resolveJobNeeds`), contract first.
 */
export interface JobNeedsDeclaration {
  readonly claudeTools: readonly NeedLabel[];
  readonly bashPrefixes: readonly NeedLabel[];
  readonly connectors: readonly ConnectorNeedDeclaration[];
  /**
   * The job works in a copy of a repo: its tools find the member's checkout
   * through `../automate/checkout.ts` (`checkoutOf`, refused `no_workspace`
   * without one). The charter readiness check (`../agents/charter-readiness.ts`)
   * reads it through `jobNeedsWorkspace`. A job's connector needs stay on its
   * tools (`requiresConnector` / `requiresConnectorLevel`), read from the catalogue.
   */
  readonly workspace: boolean;
  readonly loomwrightCommands: readonly string[];
}

/** One job's definition: the plain label the owner reads, and what the job needs beyond its tools. */
export interface ToolJobDefinition {
  readonly label: string;
  readonly needs: JobNeedsDeclaration;
}

/** A job's needs declaration (frozen). A job that needs nothing beyond its tools still declares it: a test fails otherwise. */
function needs(declared: Partial<JobNeedsDeclaration> = {}): JobNeedsDeclaration {
  return Object.freeze({
    claudeTools: Object.freeze([...(declared.claudeTools ?? [])]),
    bashPrefixes: Object.freeze([...(declared.bashPrefixes ?? [])]),
    connectors: Object.freeze([...(declared.connectors ?? [])]),
    workspace: declared.workspace ?? false,
    loomwrightCommands: Object.freeze([...(declared.loomwrightCommands ?? [])]),
  });
}

/**
 * The closed job vocabulary, one definition per job: the ONE place a job is
 * declared (`TOOL_JOBS` below is derived from it). The four jobs of the phase 8
 * walk use the approved mockup's labels exactly
 * (`docs/design/mockups/chat-threads.html`, `const JOBS`). The order is the
 * order jobs are listed in (the catalogue text and the charter display).
 * Frozen.
 */
export const TOOL_JOB_DEFINITIONS = Object.freeze({
  // D44: the kernel starts `/loomwright:automate` under its own frozen policy, so the job needs no Claude tool or shell prefix.
  automate_tickets: Object.freeze({ label: "Hand tickets to /automate", needs: needs({ workspace: true, loomwrightCommands: ["/loomwright:automate"] }) }),
  // D44-open: the crew session runs `/loomwright:review-pr` itself (the kernel does not launch this route yet).
  triage_pr_comments: Object.freeze({ label: "Triage PR comments", needs: needs({ workspace: true, loomwrightCommands: ["/loomwright:review-pr"] }) }),
  // D44-open: the crew session runs `/loomwright:automate --merge-parked` itself.
  ask_for_merge: Object.freeze({ label: "Ask for a merge", needs: needs({ workspace: true, loomwrightCommands: ["/loomwright:automate --merge-parked"] }) }),
  read_pr: Object.freeze({ label: "Read a PR", needs: needs() }),
  comment_on_issues: Object.freeze({ label: "Comment on issues", needs: needs() }),
  manage_playbooks: Object.freeze({ label: "Manage playbooks", needs: needs() }),
  manage_schedules: Object.freeze({ label: "Manage schedules", needs: needs() }),
  manage_crew: Object.freeze({ label: "Manage the crew", needs: needs() }),
  message_agents: Object.freeze({ label: "Message another agent", needs: needs() }),
  ask_for_approval: Object.freeze({ label: "Ask the owner to approve an action", needs: needs() }),
  notify_owner: Object.freeze({ label: "Notify the owner", needs: needs() }),
  general: Object.freeze({ label: "General", needs: needs() }),
} as const satisfies Record<string, ToolJobDefinition>);

/** `TOOL_JOB_DEFINITIONS`' labels, by id: the shape every reader of `TOOL_JOBS` reads. */
type ToolJobLabels = { readonly [K in keyof typeof TOOL_JOB_DEFINITIONS]: (typeof TOOL_JOB_DEFINITIONS)[K]["label"] };

/**
 * The closed job vocabulary: id → the plain label the owner reads, derived
 * from `TOOL_JOB_DEFINITIONS` (same ids, same order, same labels). Frozen; a
 * tool's `job` outside it is refused at composition.
 */
export const TOOL_JOBS = Object.freeze(
  Object.fromEntries(Object.entries(TOOL_JOB_DEFINITIONS).map(([id, definition]) => [id, definition.label])) as ToolJobLabels,
);

/** A job's id (a key of `TOOL_JOBS`). */
export type ToolJob = keyof typeof TOOL_JOBS;

/** Whether job `job` works in a copy of a repo (`JobNeedsDeclaration.workspace`). */
export function jobNeedsWorkspace(job: ToolJob): boolean {
  return TOOL_JOB_DEFINITIONS[job].needs.workspace;
}

/** Every job id, in `TOOL_JOBS` order. Frozen. */
export const TOOL_JOB_IDS: readonly ToolJob[] = Object.freeze(Object.keys(TOOL_JOBS) as ToolJob[]);

/** The job of a tool that declares none (the phase 1 six). */
export const GENERAL_JOB: ToolJob = "general";

/** Whether `value` is a job id of `TOOL_JOBS`. */
export function isToolJob(value: unknown): value is ToolJob {
  return typeof value === "string" && Object.hasOwn(TOOL_JOBS, value);
}

/** The prefix the SDK gives a kernel tool's name (`mcp__kernel__<name>`), as a charter's `allowedTools` lists it. */
export const KERNEL_TOOL_PREFIX = "mcp__kernel__";

/** One tool in the catalogue. */
export interface CatalogueTool {
  /** The tool's name (`kernel_…`, without the `mcp__kernel__` prefix). */
  readonly name: string;
  readonly job: ToolJob;
  /** One plain line: `purposeOf` its registered description. */
  readonly purpose: string;
  /** The connector grant a session needs to be offered it (`ContributedTool.requiresConnector`). */
  readonly requiresConnector?: ConnectorKind;
  /** `"write"`: that grant's write level (`ContributedTool.requiresConnectorLevel`). */
  readonly requiresConnectorLevel?: "write";
}

/** One job with its tools, in catalogue order. */
export interface CatalogueJob {
  readonly id: ToolJob;
  readonly label: string;
  readonly tools: readonly CatalogueTool[];
}

/**
 * The catalogue: `tools` in registration order (the phase 1 six, then the
 * contributed tools in composition order), each exactly once; `jobs` in
 * `TOOL_JOBS` order, only the jobs with at least one tool. Frozen.
 */
export interface ToolCatalogue {
  readonly tools: readonly CatalogueTool[];
  readonly jobs: readonly CatalogueJob[];
  /**
   * The needs of the Loomwright commands the jobs reach, resolved once when the
   * catalogue is built (the active install's contract where it declares them,
   * else the pinned table: `commandNeedsTable` in `./job-needs.ts`). Absent
   * when the builder was given none; `resolveJobNeeds` then uses the pinned
   * table, and `catalogueText` names a command without its needs.
   */
  readonly commandNeeds?: LoomwrightCommandNeedsTable;
}

/** `text` on one line: every run of whitespace as one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * `text`'s sentences: each ends at `.`, `!` or `?` followed by whitespace or
 * the end, outside brackets (`()`, `[]`, `{}`) and backticks, so a sentence
 * that carries a shape (`{id, …}`) or a parenthesised aside stays whole.
 * Whatever follows the last end is one more sentence.
 */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "`") quoted = !quoted;
    if (quoted) continue;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if ((c === ")" || c === "]" || c === "}") && depth > 0) depth--;
    else if (depth === 0 && (c === "." || c === "!" || c === "?") && (i + 1 === text.length || /\s/.test(text[i + 1] as string))) {
      const sentence = text.slice(start, i + 1).trim();
      if (sentence !== "") out.push(sentence);
      start = i + 1;
    }
  }
  const rest = text.slice(start).trim();
  if (rest !== "") out.push(rest);
  return out;
}

/** The leading sentence `purposeOf` skips. */
const READ_ONLY_SENTENCE = "Read-only.";

/**
 * A tool's purpose line from its registered description: the first sentence
 * (on one line). When that sentence is only `Read-only.`, the next sentence
 * instead, with ` (read only)` before its closing stop. `""` when there is
 * nothing to use (an empty description, or `Read-only.` alone); the catalogue
 * build refuses that.
 */
export function purposeOf(description: string): string {
  const sentences = sentencesOf(oneLine(description));
  const first = sentences[0] ?? "";
  if (first !== READ_ONLY_SENTENCE) return first;
  const next = sentences[1];
  if (next === undefined) return "";
  const stop = /[.!?]$/.exec(next)?.[0] ?? ".";
  return `${next.replace(/[.!?]$/, "")} (read only)${stop}`;
}

/** The part of a tool the catalogue reads. */
type CataloguedTool = Pick<ContributedTool, "name" | "description" | "job" | "requiresConnector" | "requiresConnectorLevel">;

/** A catalogue that cannot be built: a duplicate name, a job outside `TOOL_JOBS` or a tool with no purpose. */
export class ToolCatalogueError extends Error {
  readonly code = "tool_catalogue_invalid";

  constructor(message: string) {
    super(message);
    this.name = "ToolCatalogueError";
  }
}

/**
 * The catalogue of the phase 1 six (job `general`, purpose from
 * `PHASE1_DESCRIPTIONS`) and `contributed`, in that order. `contributed` is
 * the composition's merged tools (`MergedContributions.tools`): an MCP
 * connector's proxy tools are built per launch and are connector grants, not
 * catalogue entries, so the composition never passes them. A contributed tool
 * with no `job` is under `general`. `commandNeeds` rides on the result (see
 * `ToolCatalogue.commandNeeds`). Throws `ToolCatalogueError` for a name
 * listed twice, a `job` outside `TOOL_JOBS` or an empty purpose.
 */
export function buildToolCatalogue(contributed: readonly CataloguedTool[], commandNeeds?: LoomwrightCommandNeedsTable): ToolCatalogue {
  const phase1: CataloguedTool[] = Object.entries(PHASE1_DESCRIPTIONS).map(([name, description]) => ({ name, description }));
  const seen = new Set<string>();
  const tools: CatalogueTool[] = [];
  for (const t of [...phase1, ...contributed]) {
    if (seen.has(t.name)) throw new ToolCatalogueError(`${t.name} is listed twice`);
    seen.add(t.name);
    const job = t.job ?? GENERAL_JOB;
    if (!isToolJob(job)) throw new ToolCatalogueError(`${t.name}'s job ${JSON.stringify(job)} is not one of ${TOOL_JOB_IDS.join(", ")}`);
    const purpose = purposeOf(typeof t.description === "string" ? t.description : "");
    if (purpose === "") throw new ToolCatalogueError(`${t.name} has no purpose line: its description has no sentence to use`);
    tools.push(
      Object.freeze({
        name: t.name,
        job,
        purpose,
        ...(t.requiresConnector === undefined ? {} : { requiresConnector: t.requiresConnector }),
        ...(t.requiresConnectorLevel === undefined ? {} : { requiresConnectorLevel: t.requiresConnectorLevel }),
      }),
    );
  }
  const jobs = TOOL_JOB_IDS.flatMap((id): CatalogueJob[] => {
    const of = tools.filter((t) => t.job === id);
    return of.length === 0 ? [] : [Object.freeze({ id, label: TOOL_JOBS[id], tools: Object.freeze(of) })];
  });
  return Object.freeze({ tools: Object.freeze(tools), jobs: Object.freeze(jobs), ...(commandNeeds === undefined ? {} : { commandNeeds }) });
}

/** The tool named `name` (without the `mcp__kernel__` prefix) in `catalogue`, if it has one. */
export function catalogueTool(catalogue: ToolCatalogue, name: string): CatalogueTool | undefined {
  return catalogue.tools.find((t) => t.name === name);
}

// ---- Granted jobs and their connector needs -----------------------------------------
//
// The one rule for "a member has a job" and "a member holds the connector grant
// a tool needs", shared by the playbook fit check (`../playbooks/fit.ts`) and the
// charter readiness check (`../agents/charter-readiness.ts`), so the two never
// disagree on the same charter.

/** The full names (`mcp__kernel__<name>`) of `job`'s catalogue tools that `allowed` lacks, in catalogue order. */
export function jobLackingTools(catalogue: ToolCatalogue, job: ToolJob, allowed: ReadonlySet<string>): string[] {
  return catalogue.tools
    .filter((t) => t.job === job)
    .map((t) => `${KERNEL_TOOL_PREFIX}${t.name}`)
    .filter((name) => !allowed.has(name));
}

/**
 * Whether `allowed` grants `job`: the catalogue has at least one tool of it
 * and `allowed` lists every one. A job the catalogue has no tool for (its
 * feature is not composed) is never granted, so neither check calls a job
 * covered that no session could do (fail closed).
 */
export function jobGranted(catalogue: ToolCatalogue, job: ToolJob, allowed: ReadonlySet<string>): boolean {
  return catalogue.tools.some((t) => t.job === job) && jobLackingTools(catalogue, job, allowed).length === 0;
}

/** Each connector kind's name as the owner reads it. */
export const CONNECTOR_LABELS: Readonly<Record<ConnectorKind, string>> = Object.freeze({ github: "GitHub", jira: "Jira", clickup: "ClickUp" });

/** A connector grant some tools need: `write` only for the write level; `job` is the job of the tool that set it. */
export interface ConnectorNeed {
  readonly kind: ConnectorKind;
  readonly write: boolean;
  readonly job: ToolJob;
}

/** The grants `tools` need (`requiresConnector` / `requiresConnectorLevel`), one per kind in first-seen order, a write need folded over a read one. */
export function connectorNeeds(tools: readonly CatalogueTool[]): ConnectorNeed[] {
  const needs: ConnectorNeed[] = [];
  for (const t of tools) {
    if (t.requiresConnector === undefined) continue;
    const need: ConnectorNeed = { kind: t.requiresConnector, write: t.requiresConnectorLevel === "write", job: t.job };
    const same = needs.findIndex((n) => n.kind === need.kind);
    if (same < 0) needs.push(need);
    else if (need.write && !(needs[same] as ConnectorNeed).write) needs.splice(same, 1, need);
  }
  return needs;
}

/** What a member's connector grant holds: the kinds, and the GitHub write level. */
export interface HeldConnectors {
  readonly connectors?: readonly ConnectorKind[];
  readonly githubWrite?: boolean;
}

/**
 * Whether `held` meets `need`: the kind is granted and, for a write need, the
 * write level is too. The session's own tool filter's rule
 * (`toolsForConnectors`, `../integrations/tool-filter.ts`).
 */
export function holdsConnector(held: HeldConnectors, need: { readonly kind: ConnectorKind; readonly write: boolean }): boolean {
  if (!(held.connectors ?? []).includes(need.kind)) return false;
  return !need.write || held.githubWrite === true;
}

/** The access a need names, as the owner reads it: `GitHub access`, `GitHub write access`. */
export function connectorAccessText(need: { readonly kind: ConnectorKind; readonly write: boolean }): string {
  return `${CONNECTOR_LABELS[need.kind]}${need.write ? " write" : ""} access`;
}

// ---- The drafting text ------------------------------------------------------------

/** A tool's connector need, for the catalogue text: `""` when it needs none. */
function connectorNote(t: CatalogueTool): string {
  if (t.requiresConnector === undefined) return "";
  return t.requiresConnectorLevel === "write" ? ` [needs the ${t.requiresConnector} connector's write grant]` : ` [needs the ${t.requiresConnector} connector grant]`;
}

/** `a`, `a and b`, `a, b and c` (the one list joiner of the catalogue, the fit and the charter readiness). */
export function andList(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) as string}`;
}

/**
 * A job's declared needs as the lines `catalogueText` puts after its tools
 * (AC5): `  needs: …` (its kernel tools above, then the connector access, the
 * Claude tools and shell commands and the workspace the job itself needs, each
 * owner-only one marked) and one `  reaches …` line per Loomwright command the
 * job reaches. Plain words, never a raw tool or prefix name.
 */
function needsLines(job: CatalogueJob, table: LoomwrightCommandNeedsTable | undefined): string[] {
  const declared = TOOL_JOB_DEFINITIONS[job.id].needs;
  const owner = " (only the owner can grant it)";
  const parts = [
    "its kernel tools above",
    ...[...connectorNeeds(job.tools), ...declared.connectors].map((n) => `${connectorAccessText(n)}${owner}`),
    ...declared.claudeTools.map((n) => n.label),
    ...declared.bashPrefixes.map((n) => n.label),
    ...(declared.workspace ? [`a copy of a repo to work in${owner}`] : []),
  ];
  const lines = [`  needs: ${parts.join("; ")}`];
  for (const invocation of declared.loomwrightCommands) {
    const row = table?.[invocation];
    if (row === undefined) lines.push(`  reaches ${invocation}`);
    else if (row.launch === "kernel") {
      lines.push(`  reaches ${invocation}: the kernel starts it under its own fixed policy (D44), so it adds no Claude tool or shell command to a charter; never draft one for it`);
    } else {
      const asks = andList([...row.claudeTools, ...row.bashPrefixes].map((n) => n.label));
      lines.push(
        `  reaches ${invocation}: the crew session runs it itself and it needs ${asks}, which no charter should hold (D44: the kernel does not launch this route yet); propose no grant for it, the owner can enable the playbook anyway`,
      );
    }
  }
  return lines;
}

/**
 * The catalogue as the text the drafting tools' descriptions carry: how a
 * charter grants a job, then each job (label and id) with its tools and
 * purposes, and after its tools what the job needs beyond them (`needsLines`).
 * Plain prose (no schema), one job and one tool per line.
 */
export function catalogueText(catalogue: ToolCatalogue): string {
  return [
    "The kernel's tool catalogue: every kernel tool a crew member can be granted, by job.",
    `To give a crew member a job, list every tool of that job in its tool_policy.allowedTools as ${KERNEL_TOOL_PREFIX}<tool>; draft the list from the jobs the owner's words need.`,
    "Tell the owner the jobs in plain words, never the tool names.",
    "A tool marked [needs the … grant] is offered only to a member holding that connector grant. The grant is the owner's: a create may propose it in connectors, the owner sets the write level in Team, and kernel_agent_update never changes it.",
    `${TOOL_JOBS.triage_pr_comments} also needs ${TOOL_JOBS.read_pr}, to read the comments.`,
    "Each job's `needs:` line says what its work needs beyond its tools. Only the owner can grant GitHub write, a connector, live mode and a workspace: name them to the owner as their step, never as a change you draft. A `reaches` line for a route the crew session runs itself names a Skill or shell need no charter should hold: propose no grant for it.",
    ...catalogue.jobs.flatMap((j) => [
      `Job ${j.id} "${j.label}":`,
      ...j.tools.map((t) => `- ${t.name}: ${t.purpose}${connectorNote(t)}`),
      ...needsLines(j, catalogue.commandNeeds),
    ]),
  ].join("\n");
}

/**
 * The `tool_policy.allowedTools` a charter is drafted to for `jobs`: every
 * `mcp__kernel__<tool>` of each named job, in catalogue order, plus the tools
 * of `read_pr` when `triage_pr_comments` is named (the rule `catalogueText`
 * states). The one deterministic form of the instruction a drafting session
 * follows, so a walk that needs a crew policy builds it from the shipped
 * catalogue instead of writing tool names by hand. A job the catalogue has no
 * tool for contributes nothing.
 */
export function allowedToolsForJobs(catalogue: ToolCatalogue, jobs: readonly ToolJob[]): string[] {
  const wanted = new Set<ToolJob>(jobs);
  if (wanted.has("triage_pr_comments")) wanted.add("read_pr");
  return catalogue.tools.filter((t) => wanted.has(t.job)).map((t) => `${KERNEL_TOOL_PREFIX}${t.name}`);
}

/** What the drafting tools' descriptions carry when the catalogue could not be built: no tool list is guessed. */
export const CATALOGUE_UNAVAILABLE_TEXT =
  "The kernel's tool catalogue is unavailable, so you cannot see the kernel's tools: tell the owner you can't see the kernel's tools, and draft no tool list.";

// ---- The charter display ------------------------------------------------------------

/** The line a display shows instead of a grouping when the catalogue is unavailable (the names stay on the enforced line). */
export const DISPLAY_CATALOGUE_UNAVAILABLE =
  "kernel tools: the kernel's tool catalogue is unavailable, so they are not grouped by job; their names are on the enforced line below";

/** The heading of the kernel tools a charter grants that the catalogue does not list (an unknown or connector proxy name). */
export const DISPLAY_NOT_IN_CATALOGUE = "other kernel tools, not in the catalogue";

/**
 * The plain lines a charter display shows ahead of its `enforced:` line for
 * the kernel tools `allowedTools` grants (`mcp__kernel__<name>`; every other
 * tool is left to the enforced line). The format:
 *
 *     job: <label>          one per job with a granted tool, in TOOL_JOBS order
 *       - <purpose>         one per granted tool of that job, in catalogue order
 *     job: other kernel tools, not in the catalogue
 *       - <name>            a granted kernel tool the catalogue does not list
 *
 * (an update's display may end a line with ` (added)`, or a compact job line
 * with ` (gains tools)`: see `held` below).
 *
 * None when no kernel tool is granted (the display is as it always was). One
 * line, `DISPLAY_CATALOGUE_UNAVAILABLE`, when `catalogue` is undefined: never a
 * guessed grouping.
 *
 * `purposes: false` is the compact form a display falls back to when the full
 * one would not fit the part the owner must see whole (`MAX_APPROVAL_DISPLAY`):
 * the `job:` lines alone, no `  - ` line at all (the not-in-catalogue heading
 * too; those names are on the enforced line). Its size is bounded by the job
 * vocabulary (one short line per `TOOL_JOBS` job plus that heading, a few
 * hundred characters at most), never by how many tools are granted.
 *
 * `held` (an update's display: the member's tool list before the change)
 * marks what the change adds, with `DISPLAY_ADDED` after the line:
 *
 * - a job line, when `held` grants no tool of that job (the job was not
 *   represented before; the not-in-catalogue heading likewise, when `held`
 *   grants no kernel tool the catalogue lacks). Every other job line is a
 *   job the update keeps, even when it gains a tool.
 * - with `purposes`, the purpose line (or name) of each tool `held` lacks
 *   under a kept job; under an added job every tool is new, so only the job
 *   line is marked.
 * - without `purposes` (no purpose line to mark), a kept job line, when the
 *   change adds a tool to it: `DISPLAY_GAINS_TOOLS` after the line.
 *
 * Undefined `held` (a create) marks nothing. The compact form's marks are at
 * most one per job, so it stays bounded by the job vocabulary. A compact
 * display is still never longer than the full one: a gained tool's marked
 * purpose line (`\n  - <purpose> (added)`, a non-empty purpose or name) is
 * at least as long as `DISPLAY_GAINS_TOOLS`.
 */
export function jobDisplayLines(allowedTools: readonly string[], catalogue: ToolCatalogue | undefined, purposes = true, held?: readonly string[]): string[] {
  const granted = kernelToolNames(allowedTools);
  if (granted.length === 0) return [];
  if (catalogue === undefined) return [DISPLAY_CATALOGUE_UNAVAILABLE];
  const had = held === undefined ? undefined : new Set(kernelToolNames(held));
  const isNew = (name: string): boolean => had !== undefined && !had.has(name);
  const mark = (added: boolean): string => (added ? DISPLAY_ADDED : "");
  const gains = (added: boolean, names: readonly string[]): string => (!purposes && !added && names.some(isNew) ? DISPLAY_GAINS_TOOLS : "");
  const lines: string[] = [];
  for (const job of catalogue.jobs) {
    const tools = job.tools.filter((t) => granted.includes(t.name));
    if (tools.length === 0) continue;
    const added = had !== undefined && !job.tools.some((t) => had.has(t.name));
    lines.push(`job: ${job.label}${mark(added)}${gains(added, tools.map((t) => t.name))}`, ...(purposes ? tools.map((t) => `  - ${t.purpose}${mark(!added && isNew(t.name))}`) : []));
  }
  const unknown = granted.filter((name) => catalogueTool(catalogue, name) === undefined);
  if (unknown.length > 0) {
    const added = had !== undefined && ![...had].some((name) => catalogueTool(catalogue, name) === undefined);
    lines.push(`job: ${DISPLAY_NOT_IN_CATALOGUE}${mark(added)}${gains(added, unknown)}`, ...(purposes ? unknown.map((name) => `  - ${name}${mark(!added && isNew(name))}`) : []));
  }
  return lines;
}

/** The label of the group `jobGroups` ends with: the granted kernel tools the catalogue does not list, named, never hidden. */
export const JOB_GROUP_OTHER_LABEL = "Other tools";

/** One job of a member's granted kernel tools: `AgentJobGroup` in `app/src/api/contract.ts`. */
export interface JobGroup {
  /** The catalogue job's id; `null` for the group of tools the catalogue does not list. */
  readonly job: ToolJob | null;
  /** The job's label, or `JOB_GROUP_OTHER_LABEL`. */
  readonly label: string;
  /** The granted kernel tools' names (`kernel_…`, without the `mcp__kernel__` prefix): the job's, in catalogue order. */
  readonly tools: readonly string[];
}

/**
 * The granted kernel tools of `allowedTools` grouped by job, the same grouping and
 * order as `jobDisplayLines`: one group per job with a granted tool, in catalogue
 * order, then, last, the granted kernel tools the catalogue does not list as one group
 * (`job: null`, `JOB_GROUP_OTHER_LABEL`). Every other entry (a Claude tool, a Bash
 * prefix) is left to the enforced list. `[]` when no kernel tool is granted.
 * Mechanism only (invariant 1): it reads what is granted and grants nothing.
 */
export function jobGroups(allowedTools: readonly string[], catalogue: ToolCatalogue): JobGroup[] {
  const granted = kernelToolNames(allowedTools);
  const groups: JobGroup[] = [];
  for (const job of catalogue.jobs) {
    const tools = job.tools.filter((t) => granted.includes(t.name)).map((t) => t.name);
    if (tools.length > 0) groups.push({ job: job.id, label: job.label, tools });
  }
  const unknown = granted.filter((name) => catalogueTool(catalogue, name) === undefined);
  if (unknown.length > 0) groups.push({ job: null, label: JOB_GROUP_OTHER_LABEL, tools: unknown });
  return groups;
}

/** What an update's display puts after a job line, purpose line or name the change adds (`jobDisplayLines`' `held`). */
export const DISPLAY_ADDED = " (added)";

/** What an update's compact display puts after a kept job line the change adds a tool to (`jobDisplayLines`' `held`). */
export const DISPLAY_GAINS_TOOLS = " (gains tools)";

/** The kernel tool names `allowedTools` grants (`mcp__kernel__<name>`, without the prefix), each once, in order. */
function kernelToolNames(allowedTools: readonly string[]): string[] {
  // A bare prefix names no tool: left to the enforced line, like any other entry.
  return [...new Set(allowedTools.filter((t) => t.startsWith(KERNEL_TOOL_PREFIX)).map((t) => t.slice(KERNEL_TOOL_PREFIX.length)))].filter((name) => name !== "");
}
