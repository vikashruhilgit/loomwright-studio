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

/** One job's definition: the plain label the owner reads, and what the job needs beyond its tools. */
export interface ToolJobDefinition {
  readonly label: string;
  /**
   * The job works in a copy of a repo: its tools find the member's checkout
   * through `../automate/checkout.ts` (`checkoutOf`, refused `no_workspace`
   * without one). The charter readiness check (`../agents/charter-readiness.ts`)
   * reads it. A job's connector needs stay on its tools
   * (`requiresConnector` / `requiresConnectorLevel`), read from the catalogue.
   */
  readonly needsWorkspace: boolean;
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
  automate_tickets: Object.freeze({ label: "Hand tickets to /automate", needsWorkspace: true }),
  triage_pr_comments: Object.freeze({ label: "Triage PR comments", needsWorkspace: true }),
  ask_for_merge: Object.freeze({ label: "Ask for a merge", needsWorkspace: true }),
  read_pr: Object.freeze({ label: "Read a PR", needsWorkspace: false }),
  comment_on_issues: Object.freeze({ label: "Comment on issues", needsWorkspace: false }),
  manage_playbooks: Object.freeze({ label: "Manage playbooks", needsWorkspace: false }),
  manage_schedules: Object.freeze({ label: "Manage schedules", needsWorkspace: false }),
  manage_crew: Object.freeze({ label: "Manage the crew", needsWorkspace: false }),
  message_agents: Object.freeze({ label: "Message another agent", needsWorkspace: false }),
  ask_for_approval: Object.freeze({ label: "Ask the owner to approve an action", needsWorkspace: false }),
  notify_owner: Object.freeze({ label: "Notify the owner", needsWorkspace: false }),
  general: Object.freeze({ label: "General", needsWorkspace: false }),
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

/** Whether job `job` works in a copy of a repo (`ToolJobDefinition.needsWorkspace`). */
export function jobNeedsWorkspace(job: ToolJob): boolean {
  return TOOL_JOB_DEFINITIONS[job].needsWorkspace;
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
 * with no `job` is under `general`. Throws `ToolCatalogueError` for a name
 * listed twice, a `job` outside `TOOL_JOBS` or an empty purpose.
 */
export function buildToolCatalogue(contributed: readonly CataloguedTool[]): ToolCatalogue {
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
  return Object.freeze({ tools: Object.freeze(tools), jobs: Object.freeze(jobs) });
}

/** The tool named `name` (without the `mcp__kernel__` prefix) in `catalogue`, if it has one. */
export function catalogueTool(catalogue: ToolCatalogue, name: string): CatalogueTool | undefined {
  return catalogue.tools.find((t) => t.name === name);
}

// ---- The drafting text ------------------------------------------------------------

/** A tool's connector need, for the catalogue text: `""` when it needs none. */
function connectorNote(t: CatalogueTool): string {
  if (t.requiresConnector === undefined) return "";
  return t.requiresConnectorLevel === "write" ? ` [needs the ${t.requiresConnector} connector's write grant]` : ` [needs the ${t.requiresConnector} connector grant]`;
}

/**
 * The catalogue as the text the drafting tools' descriptions carry: how a
 * charter grants a job, then each job (label and id) with its tools and
 * purposes. Plain prose (no schema), one job and one tool per line.
 */
export function catalogueText(catalogue: ToolCatalogue): string {
  return [
    "The kernel's tool catalogue: every kernel tool a crew member can be granted, by job.",
    `To give a crew member a job, list every tool of that job in its tool_policy.allowedTools as ${KERNEL_TOOL_PREFIX}<tool>; draft the list from the jobs the owner's words need.`,
    "Tell the owner the jobs in plain words, never the tool names.",
    "A tool marked [needs the … grant] is offered only to a member holding that connector grant. The grant is the owner's: a create may propose it in connectors, the owner sets the write level in Team, and kernel_agent_update never changes it.",
    `${TOOL_JOBS.triage_pr_comments} also needs ${TOOL_JOBS.read_pr}, to read the comments.`,
    ...catalogue.jobs.flatMap((j) => [`Job ${j.id} "${j.label}":`, ...j.tools.map((t) => `- ${t.name}: ${t.purpose}${connectorNote(t)}`)]),
  ].join("\n");
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

/** What an update's display puts after a job line, purpose line or name the change adds (`jobDisplayLines`' `held`). */
export const DISPLAY_ADDED = " (added)";

/** What an update's compact display puts after a kept job line the change adds a tool to (`jobDisplayLines`' `held`). */
export const DISPLAY_GAINS_TOOLS = " (gains tools)";

/** The kernel tool names `allowedTools` grants (`mcp__kernel__<name>`, without the prefix), each once, in order. */
function kernelToolNames(allowedTools: readonly string[]): string[] {
  // A bare prefix names no tool: left to the enforced line, like any other entry.
  return [...new Set(allowedTools.filter((t) => t.startsWith(KERNEL_TOOL_PREFIX)).map((t) => t.slice(KERNEL_TOOL_PREFIX.length)))].filter((name) => name !== "");
}
