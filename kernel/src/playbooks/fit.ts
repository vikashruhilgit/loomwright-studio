// The playbook fit check (phase 8 item 16): does a crew member's charter cover
// the jobs its playbook names? Wright drafts a playbook (and its jobs) from
// the owner's words; this compares those jobs' kernel tools with the tools
// the member's `tool_policy.allowedTools` allows, and when some are missing
// says so in plain words and proposes the exact `kernel_agent_update` that
// adds exactly them (held for the owner like any charter change). The
// playbook's create, update and dry run carry the result as `fit`, and its
// enable is refused `charter_gap` while a gap is open (`./enable.ts`), unless
// the owner enables it anyway.
//
// Inputs, and nothing else (invariant 3, AC10): the playbook's stored jobs
// (`jobs_json`), the kernel's tool catalogue (`ContributedToolContext.catalogue`)
// and the member's settings file, read through the leaf reader
// `../agents/settings.ts`. Its linked trigger's poll source is read for the
// owner's connector steps only. The playbook's intent, a polled ticket or a PR
// comment is never read here, so text naming a tool never adds one.
//
// Connector grants are the owner's (AC8): a grant the jobs' tools need
// (`requiresConnector` / `requiresConnectorLevel`) or the poll source needs is
// never in `proposed_update`; it is named as the owner's step on Team, in the
// member's inspector. `kernel_agent_update` never changes a grant anyway.
//
// The declared-jobs limit: the check sees only the jobs the playbook names. A
// playbook whose jobs are under-declared passes the check and meets the
// kernel's refusal mid-run, as before.
//
// Mechanism only (invariant 1): which jobs a playbook needs is Wright's
// proposal and the owner's decision; this only compares two lists.
//
// The `studio` CLI loads this module (through `./enable.ts`): it imports only
// `node:` builtins, the agents feature's leaf modules (`../agents/registry.js`,
// `../agents/settings.js`), the brain's settings size limit
// (`../brain/settings.js`, as `../agents/settings.ts` does), the CLI-safe
// catalogue (`../features/catalogue.js`) and this feature's store, never the
// Agent SDK, the session manager or `kernel.ts`.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { MAX_SETTINGS_BYTES } from "../brain/settings.js";
import { getAgent } from "../agents/registry.js";
import { agentSettingsPath, readAgentSettings } from "../agents/settings.js";
import type { AgentSettings } from "../agents/settings.js";
import { CONNECTOR_LABELS, TOOL_JOBS, connectorAccessText, connectorNeeds, holdsConnector, isToolJob, jobGranted, jobLackingTools } from "../features/catalogue.js";
import type { CatalogueTool, ToolCatalogue, ToolJob } from "../features/catalogue.js";
import type { ConnectorKind } from "../integrations/types.js";
import type { Store } from "../store/store.js";
import { linkedTriggerOf, playbookJobsOf } from "./store.js";
import type { PlaybookRow } from "./store.js";

/**
 * What the check found. `fits`: the member holds every tool of every named
 * job. `gap`: it lacks some (`missing`, `proposed_update`). `no_jobs`: the
 * playbook names none, so nothing was checked. `unchecked`: the check could
 * not run (no catalogue, or the member's settings could not be read whole);
 * `reason` says why, and an enable treats it as an open gap (fail closed).
 */
export type PlaybookFitStatus = "fits" | "gap" | "no_jobs" | "unchecked";

/** One named job the member lacks tools of. */
export interface MissingJob {
  readonly id: ToolJob;
  readonly label: string;
  /** The job's tools the member lacks, as `mcp__kernel__<name>`, in catalogue order; empty when the catalogue has no tool of the job. */
  readonly tools: readonly string[];
}

/** The exact `kernel_agent_update` arguments that close the gap (the caller adds its own `idempotency_key`). */
export interface ProposedAgentUpdate {
  readonly id: string;
  readonly changes: {
    readonly tool_policy: {
      /** The member's current `allowedTools`, then exactly the missing tools. */
      readonly allowedTools: readonly string[];
      /** The member's current `allowedBashPrefixes`, unchanged. */
      readonly allowedBashPrefixes: readonly string[];
    };
  };
  /** The sha256 of the settings file these were read from: an owner's edit since is refused `config_changed`. */
  readonly expected_sha256: string;
}

/** The fit of a crew member's playbook. */
export interface PlaybookFit {
  readonly status: PlaybookFitStatus;
  /** The crew member (the playbook's `owning_agent`). */
  readonly agent: string;
  /** The jobs the playbook names, in `TOOL_JOBS` order. */
  readonly jobs: readonly ToolJob[];
  /** Plain lines for the owner: the missing jobs, or that every job is covered, or why it was not checked. */
  readonly lines: readonly string[];
  /** `gap`: the named jobs the member lacks tools of. */
  readonly missing: readonly MissingJob[];
  /** `gap`: the update Wright passes to `kernel_agent_update` (held for the owner). Never a connector grant. Absent when no missing job has a tool to add. */
  readonly proposed_update?: ProposedAgentUpdate;
  /** Connector grants only the owner can give, in plain words (Team → the member's inspector). */
  readonly owner_steps: readonly string[];
  /** `unchecked`: why. */
  readonly reason?: string;
}

/** A connector grant a playbook needs: `write` only for GitHub's write level. */
interface GrantNeed {
  readonly kind: ConnectorKind;
  readonly write: boolean;
  /** Why, in plain words: a job's label, or the trigger's watch. */
  readonly why: string;
}

/** The connector a poll source reads through (`POLL_SOURCES`, `../triggers/poll.ts`); undefined for an unknown source. */
function sourceConnector(source: unknown): ConnectorKind | undefined {
  if (typeof source !== "string") return undefined;
  if (source.startsWith("github.")) return "github";
  if (source === "jira.issues") return "jira";
  if (source === "clickup.tasks") return "clickup";
  return undefined;
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The settings file's sha256, or undefined when it can't be read (missing, too large, unreadable). */
function fileSha(file: string): string | undefined {
  try {
    if (statSync(file).size > MAX_SETTINGS_BYTES) return undefined;
    const bytes = readFileSync(file);
    return bytes.length > MAX_SETTINGS_BYTES ? undefined : sha256Of(bytes);
  } catch {
    return undefined;
  }
}

/** The member's settings and the sha256 of the very bytes they were read from, or why they can't be had. */
function memberSettings(dataDir: string, agent: string): { readonly settings: AgentSettings; readonly sha256: string } | { readonly reason: string } {
  const file = agentSettingsPath(dataDir, agent);
  const before = fileSha(file);
  const read = readAgentSettings(dataDir, agent);
  if (!read.ok) return { reason: `its settings file can't be read (${read.error})` };
  const after = fileSha(file);
  // Hashed before and after the read: equal, so the policy read is the one the hash names.
  if (before === undefined || before !== after) return { reason: "its settings file changed while it was read; check again" };
  return { settings: read.settings, sha256: before };
}

/**
 * The grants the jobs' tools need (`connectorNeeds`, the catalogue's one fold:
 * GitHub write over GitHub read), then the trigger's poll source's read grant
 * when no tool already needs that kind.
 */
function grantNeeds(store: Store, row: PlaybookRow, tools: readonly CatalogueTool[]): GrantNeed[] {
  const needs: GrantNeed[] = connectorNeeds(tools).map((n) => ({ kind: n.kind, write: n.write, why: TOOL_JOBS[n.job] }));
  const trigger = linkedTriggerOf(store, row);
  if (trigger?.kind === "poll") {
    const kind = sourceConnector((trigger.spec as { source?: unknown } | null)?.source);
    if (kind !== undefined && !needs.some((n) => n.kind === kind)) needs.push({ kind, write: false, why: `watching ${CONNECTOR_LABELS[kind]}` });
  }
  return needs;
}

/** Whether a stored, non-null `jobs_json` reads whole: a non-empty JSON array of `TOOL_JOBS` ids (what `checkJobs` writes). */
function storedJobsReadable(jobsJson: string): boolean {
  try {
    const parsed = JSON.parse(jobsJson) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isToolJob);
  } catch {
    return false;
  }
}

/** The owner's step for a grant the member lacks, in plain words. */
function ownerStep(name: string, need: GrantNeed): string {
  return `${name} needs ${connectorAccessText(need)} for ${need.why}; only you can grant it: Team → ${name}'s inspector.`;
}

/**
 * The fit of playbook `row` for its crew member, or `undefined` when its
 * `owning_agent` is not a registered crew member (Wright's own playbook: no
 * charter to check). Reads only `row.jobs_json`, `catalogue`, the member's
 * settings file and the linked trigger's poll source; never the intent or a
 * polled item. Never throws: a failure to read is `unchecked` with its reason.
 */
export function playbookFit(store: Store, row: PlaybookRow, catalogue: ToolCatalogue | undefined): PlaybookFit | undefined {
  const member = getAgent(store, row.owning_agent);
  if (member === undefined) return undefined;
  const agent = member.id;
  const name = member.display_name;
  const jobs = playbookJobsOf(row);
  const base = { agent, jobs };
  const unchecked = (reason: string): PlaybookFit => ({ ...base, status: "unchecked", reason, lines: [`Wright can't check that ${name} has the jobs this playbook needs: ${reason}.`], missing: [], owner_steps: [] });
  // A stored value that does not read whole is never "no jobs" (fail closed): only null is.
  if (row.jobs_json !== null && !storedJobsReadable(row.jobs_json)) return unchecked("the playbook's stored jobs can't be read");
  if (jobs.length === 0) {
    return { ...base, status: "no_jobs", lines: [`This playbook names no jobs, so ${name}'s tools were not checked against it.`], missing: [], owner_steps: [] };
  }
  if (catalogue === undefined) return unchecked("the kernel's tool catalogue is unavailable");
  let read: ReturnType<typeof memberSettings>;
  try {
    read = memberSettings(store.dataDir, agent);
  } catch (err) {
    return unchecked(`its settings file can't be read (${err instanceof Error ? err.message : String(err)})`);
  }
  if ("reason" in read) return unchecked(read.reason);
  const { settings, sha256 } = read;
  const allowed = new Set(settings.policy.allowedTools);
  const jobTools = catalogue.tools.filter((t) => jobs.includes(t.job));
  const missing: MissingJob[] = [];
  for (const job of jobs) {
    // The catalogue's one rule (`jobGranted`): a job with no catalogue tool is missing too, with no tool to add.
    if (!jobGranted(catalogue, job, allowed)) missing.push({ id: job, label: TOOL_JOBS[job], tools: jobLackingTools(catalogue, job, allowed) });
  }
  let owner_steps: string[];
  try {
    owner_steps = grantNeeds(store, row, jobTools)
      .filter((need) => !holdsConnector(settings, need))
      .map((need) => ownerStep(name, need));
  } catch (err) {
    return unchecked(`its trigger can't be read (${err instanceof Error ? err.message : String(err)})`);
  }
  if (missing.length === 0) {
    return { ...base, status: "fits", lines: [`${name} has every job this playbook needs: ${jobs.map((j) => TOOL_JOBS[j]).join(", ")}.`], missing: [], owner_steps };
  }
  const added = missing.flatMap((m) => m.tools);
  const current = settings.policy.allowedTools;
  return {
    ...base,
    status: "gap",
    lines: missing.map((m) => {
      const total = jobTools.filter((t) => t.job === m.id).length;
      if (total === 0) return `This playbook needs ${m.label}; the kernel has no tool for it, so no charter change can give it to ${name}.`;
      return m.tools.length === total ? `This playbook needs ${m.label}; ${name} doesn't have it.` : `This playbook needs ${m.label}; ${name} has only part of it.`;
    }),
    missing,
    // No tool to add (every missing job has none in the catalogue): no update to propose.
    ...(added.length === 0
      ? {}
      : {
          proposed_update: {
            id: agent,
            changes: { tool_policy: { allowedTools: [...current, ...added.filter((t) => !current.includes(t))], allowedBashPrefixes: [...settings.policy.allowedBashPrefixes] } },
            expected_sha256: sha256,
          },
        }),
    owner_steps,
  };
}

/** Whether `fit` leaves a gap an enable must not pass without the owner's word: `gap`, or `unchecked` (fail closed). */
export function fitGapOpen(fit: PlaybookFit | undefined): fit is PlaybookFit & { readonly status: "gap" | "unchecked" } {
  return fit !== undefined && (fit.status === "gap" || fit.status === "unchecked");
}
