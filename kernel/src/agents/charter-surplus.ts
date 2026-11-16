// What a charter holds that no crew member needs (phase 8 item 22g, AC7): a
// held `Skill` or `Agent`, or a Loomwright shell prefix, that no job the
// charter grants needs. Under D44 and D45 the kernel starts every Loomwright
// command a job reaches (the ticket run, the fix and the merge) as its own
// session under a frozen run policy, so a crew charter needs none of these.
// An older member can still hold one (approval 32 gave `studio-sandbox-dev`
// `Skill`, and Wright copied it into approval 43), so the readiness card flags
// it, in plain words, for the owner to decide. A held `Skill` is never counted
// as covering a need: it is named here instead.
//
// Mechanism only (invariant 1): this compares lists and reads nothing. It
// never refuses a draft; the owner decides on the card.
//
// `charterReadiness` (`./charter-readiness.ts`) calls it and passes its own
// line builder, so this module imports the readiness format only as a type (no
// load cycle) and stays CLI-safe: the catalogue's needs resolver and type-level
// modules, never the Agent SDK, the session manager or `kernel.ts`.
import { andList } from "../features/catalogue.js";
import type { ToolCatalogue, ToolJob } from "../features/catalogue.js";
import { LOOMWRIGHT_COMMAND_NEEDS, bashPrefixHeld, bashPrefixNeed, claudeToolNeed, resolveJobNeeds } from "../features/job-needs.js";
import type { Charter } from "./charter-files.js";
import type { ReadinessItem } from "./charter-readiness.js";

/** The Claude tools a crew charter holds for no crew member's need: Loomwright's own (D45), started by the kernel. */
export const SURPLUS_CLAUDE_TOOLS: readonly string[] = Object.freeze(["Skill", "Agent"]);

/**
 * The Loomwright command prefixes that only read (`git diff`: see changes with
 * git). A crew member may hold one for its own review work, so holding it is
 * never flagged; every other prefix a Loomwright command asks for commits,
 * pushes or works with pull requests.
 */
export const READ_ONLY_LOOMWRIGHT_PREFIXES: readonly string[] = Object.freeze(["git diff"]);

/** What a surplus line says the charter holds (AC7), in plain words. */
export const SURPLUS_FLAG = "a permission no crew member needs";

/** What `charterSurplus` compares: the charter's own tool policy, the catalogue and the jobs it grants a tool of. */
export interface SurplusInput {
  readonly charter: Pick<Charter, "tool_policy">;
  readonly catalogue: ToolCatalogue;
  /** The jobs the charter grants a kernel tool of, in `TOOL_JOBS` order. */
  readonly jobs: readonly ToolJob[];
}

/** Builds a flagged `permission` readiness item from its line text and its short form (`charterReadiness`'s own builder). */
export type SurplusFlag = (text: string, brief: string) => ReadinessItem;

/**
 * The plain words of what `input.charter` holds and no granted job needs: each
 * held `SURPLUS_CLAUDE_TOOLS` tool, then each held Bash prefix that is a
 * Loomwright shell prefix: exactly a prefix a Loomwright command asks for (the
 * catalogue's command-needs table, else the pinned one), other than
 * `READ_ONLY_LOOMWRIGHT_PREFIXES`. So `git push` and `gh pr` are; a broader
 * `git` (a member's own git access, which its `never` list bounds, as the
 * phase 4 reviewer's charter has it) and a narrower `gh pr view` are not. A
 * held prefix that holds a need of a granted job is not surplus. Deduplicated,
 * in that order.
 */
export function surplusLabels(input: SurplusInput): string[] {
  const { allowedTools, allowedBashPrefixes } = input.charter.tool_policy;
  const needs = input.jobs.map((job) => resolveJobNeeds(job, input.catalogue));
  const neededTools = new Set(needs.flatMap((n) => n.claudeTools.map((t) => t.name)));
  const neededPrefixes = needs.flatMap((n) => n.bashPrefixes.map((p) => p.name));
  const table = input.catalogue.commandNeeds ?? LOOMWRIGHT_COMMAND_NEEDS;
  const loomwrightPrefixes = [...new Set(Object.values(table).flatMap((row) => row.bashPrefixes.map((p) => p.name)))].filter((p) => !READ_ONLY_LOOMWRIGHT_PREFIXES.includes(p));
  const labels: string[] = [];
  for (const tool of SURPLUS_CLAUDE_TOOLS) {
    if (allowedTools.includes(tool) && !neededTools.has(tool)) labels.push(claudeToolNeed(tool).label);
  }
  for (const held of allowedBashPrefixes) {
    if (neededPrefixes.some((need) => bashPrefixHeld([held], need))) continue;
    if (loomwrightPrefixes.includes(held)) labels.push(bashPrefixNeed(held).label);
  }
  return [...new Set(labels)];
}

/**
 * The readiness items for what `input.charter` holds and no crew member needs
 * (AC7): one flagged `permission` item (built by `flag`) naming all of it in
 * plain words, or none. The block stays bounded: one line, however many tools
 * and prefixes are held. Never a raw tool name or prefix on the line.
 */
export function charterSurplus(input: SurplusInput, flag: SurplusFlag): ReadinessItem[] {
  const labels = surplusLabels(input);
  if (labels.length === 0) return [];
  const what = andList(labels);
  return [flag(`permission to ${what}: this charter holds ${SURPLUS_FLAG} (Studio runs that work itself)`, `holds ${SURPLUS_FLAG} (${what})`)];
}
