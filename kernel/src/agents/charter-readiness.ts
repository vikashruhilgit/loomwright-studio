// The charter readiness check (phase 8 item 18b): before a held charter create
// or update reaches the owner, the kernel checks that every duty names jobs the
// charter grants, and that every granted job's prerequisites (a copy of a repo
// to work in, a connector grant) exist. The result is shown first on the
// approval's display, in plain words (`ReadinessResult.lines`), and told to
// Wright as the fix to propose (`agentNote`, appended by the gate to the held
// reason); the kernel's apply names what was still open in its applied
// sentence (`openFlagsSentence`), as the owner's choice to proceed.
//
// Inputs, and nothing else (invariant 3): the charter's own `duties[].jobs` and
// `tool_policy.allowedTools`, its `workspaces`, the connectors it proposes (a
// create) or the member's stored grant (an update), the kernel's tool catalogue
// and each workspace's git config (read through `../automate/checkout.ts`'s one
// remote parse). A duty's text is shown, never read for a job: text that looks
// like a job id or a JSON entry adds nothing.
//
// Mechanism only (invariant 1): which jobs a duty needs is Wright's draft and
// the owner's decision; this only compares lists and reads files. It never
// holds or refuses anything but a bare-string duty in Wright's own create
// (`wrightDutyRefusal`); every other finding is shown, and the owner decides.
//
// The `studio` CLI loads this module (through `./charter-tools.ts`), so it
// imports only `node:os`, the CLI-safe catalogue and its needs resolver
// (`../features/job-needs.js`), the leaf modules
// `../protected-paths.js`, `./settings.js` and `../automate/checkout.js`, and
// this feature's charter types: never the Agent SDK, the session manager or
// `kernel.ts`.
import { homedir } from "node:os";
import { readWorkspaceRepos } from "../automate/checkout.js";
import { KERNEL_TOOL_PREFIX, TOOL_JOBS, connectorAccessText, connectorNeeds, holdsConnector, jobGranted, jobLackingTools, jobNeedsWorkspace } from "../features/catalogue.js";
import type { ConnectorNeed, ToolCatalogue, ToolJob } from "../features/catalogue.js";
import { jobNeedsGaps, resolveJobNeeds } from "../features/job-needs.js";
import type { NeedsGap } from "../features/job-needs.js";
import type { ConnectorKind } from "../integrations/types.js";
import { PROTECTED_FOLDER_WHY, isInsidePath, isProtectedPath, protectedLocationsText } from "../protected-paths.js";
import type { Charter } from "./charter-files.js";
import { parseConnectorsGrant } from "./settings.js";

// ---- The display format ------------------------------------------------------------
//
// The readiness block, right after a display's first line (a create's head line,
// an update's head line):
//
//     readiness: checked by the kernel before you see it     READINESS_HEADING (starts READINESS_HEADING_PREFIX)
//       covered: duty <n> <how>: <duty excerpt>               READINESS_COVERED_PREFIX
//       flagged: duty <n> <why>: <duty excerpt>               READINESS_FLAG_PREFIX
//       ready: <prerequisite> for <job labels>: <what it has>  READINESS_READY_PREFIX
//       flagged: <prerequisite> for <job labels>: <missing>    READINESS_FLAG_PREFIX
//       flagged: permission to <plain words> for <job label>: <why>   READINESS_FLAG_PREFIX
//       not checked: <duty n, or prerequisite …>: <why not>    READINESS_NOT_CHECKED_PREFIX
//
// A duty is quoted by an excerpt of its text (`dutyExcerpt`: the whole text when
// it is at most `READINESS_DUTY_EXCERPT_MAX` characters, else its leading words
// and one `…`), so a charter with many long duties still fits the head the
// owner must see whole; the full text is in the display's `role.md`. The duty
// number keeps two duties whose excerpts look alike apart.
//
// One line per duty, in charter order, then one line per prerequisite the
// granted jobs need, naming those jobs in `TOOL_JOBS` order: a copy of a repo
// (every granted code job), then each connector's access at each level its
// jobs need (`GitHub access`, `GitHub write access`), then one line per granted
// job and kind of permission it lacks beyond its kernel tools (Claude tools and
// shell commands: `permission to run skills for Triage PR comments`; item 20c,
// declared on the job and on the Loomwright commands it reaches, resolved by
// `../features/job-needs.ts`), in plain words only: a raw tool name or shell
// prefix is shown on the display's `enforced:` line, never on a readiness line.
// A job with no prerequisite has no line. So the block grows with the duties
// and the granted jobs, never with the number of granted tools (at most one
// repo line, two per connector and two permission lines per job). Every line starts with exactly one of these prefixes; a duty's
// text is always last on its line, after the kernel's own words, so it can't
// pose as a status.

/** The block's first line starts with this. */
export const READINESS_HEADING_PREFIX = "readiness: ";
/** The block's first line, always the same (the lines below say what was found), so its length never varies. */
export const READINESS_HEADING = "readiness: checked by the kernel before you see it";
/** A duty whose every job the charter grants (or that needs no kernel tool). */
export const READINESS_COVERED_PREFIX = "  covered: ";
/** A job prerequisite that exists. */
export const READINESS_READY_PREFIX = "  ready: ";
/** A finding the owner should see before approving: a duty not covered, a job missing a prerequisite. */
export const READINESS_FLAG_PREFIX = "  flagged: ";
/** A check that could not run (a read failed, the catalogue is unavailable): never "ready". */
export const READINESS_NOT_CHECKED_PREFIX = "  not checked: ";

/** Each line's status, by its prefix. */
export type ReadinessStatus = "covered" | "ready" | "flagged" | "not_checked";

const PREFIXES: Readonly<Record<ReadinessStatus, string>> = Object.freeze({
  covered: READINESS_COVERED_PREFIX,
  ready: READINESS_READY_PREFIX,
  flagged: READINESS_FLAG_PREFIX,
  not_checked: READINESS_NOT_CHECKED_PREFIX,
});

/**
 * What a finding is about: a duty, the code jobs' copy of a repo, the jobs'
 * connector access, a granted job's Claude tool or shell permission
 * (`permission`), or every job (no catalogue).
 */
export type ReadinessSubject = "duty" | "workspace" | "connector" | "permission" | "jobs";

/** One finding: its display line, and a short form (no duty text) for Wright's note and the applied sentence. */
export interface ReadinessItem {
  readonly subject: ReadinessSubject;
  readonly status: ReadinessStatus;
  readonly line: string;
  readonly brief: string;
  /** The jobs a `workspace`, `connector` or `permission` finding is about, in `TOOL_JOBS` order. */
  readonly jobs?: readonly ToolJob[];
}

/** What the check found. */
export interface ReadinessResult {
  /** The heading, then one line per item, in order. */
  readonly lines: readonly string[];
  readonly items: readonly ReadinessItem[];
  /** The items still open: flagged or not checked, in order. */
  readonly open: readonly ReadinessItem[];
  /** What Wright is told after the held reason: the flags and the fix to propose. Absent when nothing is open. */
  readonly agentNote?: string;
}

/**
 * The connector grant the member would have:
 *
 * - `proposed`: a create's `charter.connectors` (each kind at its read level:
 *   a write level is only ever the owner's, set in Team);
 * - `stored`: an update's settings file `connectors` value as stored (absent:
 *   `undefined`), read with `parseConnectorsGrant`, the reader's own parse;
 * - `unread`: the grant could not be read (`reason`): its checks did not run.
 */
export type ReadinessGrant =
  | { readonly kind: "proposed"; readonly connectors: readonly ConnectorKind[] }
  | { readonly kind: "stored"; readonly raw: unknown }
  | { readonly kind: "unread"; readonly reason: string };

export interface ReadinessInput {
  /** `create` or `update`: only the wording of the fix Wright is told differs. */
  readonly action: "create" | "update";
  /** The parsed charter (for an update, the merged result: the member's stored duties and the new settings). */
  readonly charter: Charter;
  /** The kernel's tool catalogue; undefined when unavailable (then no job is guessed). */
  readonly catalogue: ToolCatalogue | undefined;
  readonly grant: ReadinessGrant;
  /** The data dir: a workspace may not be it, inside it or hold it. */
  readonly dataDir: string;
  /** The home dir the protected folders are under (default `os.homedir()`); a seam for tests. */
  readonly homeDir?: string;
}

// ---- The plain words ------------------------------------------------------------------

/** `a, b and c`. */
function andList(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) as string}`;
}

/** `text` on one line: every run of whitespace as one space (every value here is already one line; defence in depth). */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The most characters a readiness line quotes of a duty's text, the cut mark included (`dutyExcerpt`). */
export const READINESS_DUTY_EXCERPT_MAX = 72;

/** The kernel's cut mark (as `clip` in `../loop/internal.ts`, not imported: this module stays CLI-safe). */
const CUT_MARK = "…";

/**
 * A duty's text as its readiness line quotes it: on one line, whole when it is
 * at most `READINESS_DUTY_EXCERPT_MAX` characters; else its leading words, cut
 * at a space, then one `CUT_MARK`, at most `READINESS_DUTY_EXCERPT_MAX` in all.
 * A first word longer than that is the one case cut inside a word (never inside
 * a surrogate pair), still with one `CUT_MARK`.
 */
export function dutyExcerpt(text: string): string {
  const whole = oneLine(text);
  if (whole.length <= READINESS_DUTY_EXCERPT_MAX) return whole;
  // The first MAX characters: a space among them ends the last whole word that leaves room for the mark.
  const head = whole.slice(0, READINESS_DUTY_EXCERPT_MAX);
  const space = head.lastIndexOf(" ");
  let words = space > 0 ? whole.slice(0, space) : whole.slice(0, READINESS_DUTY_EXCERPT_MAX - 1);
  if (/[\uD800-\uDBFF]$/.test(words)) words = words.slice(0, -1);
  return `${words}${CUT_MARK}`;
}

function item(subject: ReadinessSubject, status: ReadinessStatus, text: string, brief: string, jobs?: readonly ToolJob[]): ReadinessItem {
  return { subject, status, line: `${PREFIXES[status]}${oneLine(text)}`, brief: oneLine(brief), ...(jobs === undefined ? {} : { jobs }) };
}

/** The jobs' labels as `a, b and c`. */
function labels(jobs: readonly ToolJob[]): string {
  return andList(jobs.map((j) => TOOL_JOBS[j]));
}

// ---- The duties ------------------------------------------------------------------------

interface DutyFindings {
  readonly items: ReadinessItem[];
  /** The jobs uncovered duty entries name that the charter does not grant, in `TOOL_JOBS` order. */
  readonly missingJobs: ToolJob[];
  readonly legacy: boolean;
}

function dutyFindings(charter: Charter, catalogue: ToolCatalogue | undefined, allowed: ReadonlySet<string>): DutyFindings {
  const items: ReadinessItem[] = [];
  const missing = new Set<ToolJob>();
  let legacy = false;
  for (const [i, duty] of charter.duties.entries()) {
    const n = `duty ${i + 1}`;
    // The duty's excerpt, never its whole text past READINESS_DUTY_EXCERPT_MAX (the full text is in role.md).
    const text = dutyExcerpt(typeof duty === "string" ? duty : duty.text);
    if (typeof duty === "string") {
      // Design decision 6: a duty written before duties named their jobs is flagged, never covered.
      legacy = true;
      items.push(item("duty", "flagged", `${n} names no job (written before duties named their jobs): ${text}`, `${n} names no job`));
      continue;
    }
    if (duty.jobs.length === 0) {
      items.push(item("duty", "covered", `${n} with no tool (it needs no kernel tool): ${text}`, `${n} needs no tool`));
      continue;
    }
    if (catalogue === undefined) {
      items.push(item("duty", "not_checked", `${n} (the kernel's tool catalogue is unavailable): ${text}`, `${n} was not checked (no tool catalogue)`));
      continue;
    }
    const lacking = duty.jobs.filter((job) => !jobGranted(catalogue, job, allowed));
    if (lacking.length === 0) {
      items.push(item("duty", "covered", `${n} by ${andList(duty.jobs.map((j) => TOOL_JOBS[j]))}: ${text}`, `${n} is covered`));
      continue;
    }
    for (const job of lacking) missing.add(job);
    const needs = andList(lacking.map((j) => TOOL_JOBS[j]));
    items.push(item("duty", "flagged", `${n} not covered (needs ${needs}, which this charter does not grant): ${text}`, `${n} is not covered (needs ${needs})`));
  }
  const missingJobs = (Object.keys(TOOL_JOBS) as ToolJob[]).filter((j) => missing.has(j));
  return { items, missingJobs, legacy };
}

// ---- The workspaces --------------------------------------------------------------------

/** What one workspace is to a code job. */
type WorkspaceFinding =
  | { readonly path: string; readonly kind: "usable"; readonly repos: readonly string[] }
  | { readonly path: string; readonly kind: "unusable"; readonly detail: string }
  | { readonly path: string; readonly kind: "unreadable"; readonly detail: string };

/** Each workspace, read once: usable (a git checkout with a GitHub remote, outside the protected folders and the data dir), unusable (why), or unreadable (why). */
function workspaceFindings(workspaces: readonly string[], dataDir: string, homeDir: string): WorkspaceFinding[] {
  return workspaces.map((path): WorkspaceFinding => {
    try {
      if (isProtectedPath(path, homeDir)) {
        return { path, kind: "unusable", detail: `${path} can't be used: it is inside a macOS-protected folder (${protectedLocationsText()}), and ${PROTECTED_FOLDER_WHY}` };
      }
      if (isInsidePath(path, dataDir) || isInsidePath(dataDir, path)) return { path, kind: "unusable", detail: `${path} can't be used: it is the kernel's data dir, inside it or holds it` };
      const read = readWorkspaceRepos(path);
      if (read.kind === "unreadable") return { path, kind: "unreadable", detail: `${path}: ${read.detail}` };
      if (read.kind === "not_checkout") return { path, kind: "unusable", detail: `${path}: ${read.detail}` };
      if (read.repos.length === 0) return { path, kind: "unusable", detail: `${path} has no GitHub remote` };
      return { path, kind: "usable", repos: [...new Set(read.repos)] };
    } catch (err) {
      return { path, kind: "unreadable", detail: `${path} can't be read (${err instanceof Error ? err.message : String(err)})` };
    }
  });
}

/** What the repo line names: the prerequisite and the jobs needing it. */
function repoSubject(jobs: readonly ToolJob[]): string {
  return `copy of a repo for ${labels(jobs)}`;
}

/** The code jobs' one workspace line: ready (the repos found and where), flagged (no copy of a repo) or not checked (a read failed). */
function workspaceItem(jobs: readonly ToolJob[], found: readonly WorkspaceFinding[]): ReadinessItem {
  const subject = repoSubject(jobs);
  const usable = found.filter((f): f is Extract<WorkspaceFinding, { kind: "usable" }> => f.kind === "usable");
  if (usable.length > 0) {
    return item("workspace", "ready", `${subject}: works in ${usable.map((f) => `${f.repos.join(", ")} at ${f.path}`).join("; ")}`, `${subject}: has one`, jobs);
  }
  const details = found.map((f) => (f.kind === "usable" ? "" : f.detail)).join("; ");
  if (found.some((f) => f.kind === "unreadable")) {
    return item("workspace", "not_checked", `${subject}: can't tell whether it has one (${details})`, `${subject}: not checked (a workspace can't be read)`, jobs);
  }
  const why = found.length === 0 ? " (no workspace is listed)" : `: ${details}`;
  return item("workspace", "flagged", `${subject}: it has no copy of a repo to work in${why}`, `no copy of a repo to work in (for ${labels(jobs)})`, jobs);
}

/**
 * The shortest the code jobs' workspace line can be, for any workspaces: its
 * ready form with the shortest repo (`a/b`) at the shortest path (`/`). Every
 * real line for `jobs` (ready, flagged or not checked) is at least this long.
 */
function shortestWorkspaceLine(jobs: readonly ToolJob[]): string {
  return `${READINESS_READY_PREFIX}${repoSubject(jobs)}: works in a/b at /`;
}

// ---- The connectors --------------------------------------------------------------------

/** What the member holds: whether a need is met (`holdsConnector`, the catalogue's one rule), or why that can't be told. */
type GrantView = { readonly holds: (need: ConnectorNeed) => boolean; readonly source: string } | { readonly unread: string };

function grantView(grant: ReadinessGrant): GrantView {
  if (grant.kind === "unread") return { unread: grant.reason };
  if (grant.kind === "proposed") {
    // A create's proposal is a read grant; the write level is only ever set by the owner, in Team.
    return { holds: (need) => holdsConnector({ connectors: grant.connectors, githubWrite: false }, need), source: "proposed in this charter" };
  }
  if (grant.raw === undefined || grant.raw === null) return { holds: () => false, source: "granted" };
  const read = parseConnectorsGrant(grant.raw);
  if (!read.ok) return { unread: `the member's connectors grant can't be read: ${read.message}` };
  const g = read.grant;
  return { holds: (need) => holdsConnector(g, need), source: "granted" };
}

/** One connector access line: the access (`GitHub write access`) and the jobs whose granted tools need it. */
function connectorItem(need: ConnectorNeed, jobs: readonly ToolJob[], view: GrantView): ReadinessItem {
  const subject = `${connectorAccessText(need)} for ${labels(jobs)}`;
  if ("unread" in view) return item("connector", "not_checked", `${subject}: not checked (${view.unread})`, `${subject}: not checked`, jobs);
  if (view.holds(need)) return item("connector", "ready", `${subject}: ${view.source}`, `${subject}: ${view.source}`, jobs);
  return item("connector", "flagged", `${subject}: only you can grant it (Team, in the member's inspector)`, `${subject}: the owner's step in Team`, jobs);
}

// ---- The permissions ---------------------------------------------------------------------

/** What a granted job's missing permissions come to: the plain-words lines, and what Wright may propose for them. */
interface PermissionFindings {
  readonly items: readonly ReadinessItem[];
  /** The raw Claude tools a charter change can close (for Wright's note only, never a readiness line). */
  readonly fixTools: readonly string[];
  readonly fixPrefixes: readonly string[];
  /** The jobs with a gap no charter should close (a crew-launched Loomwright command's `Skill` and shell prefixes, D44). */
  readonly routeJobs: readonly ToolJob[];
  /** The commands those jobs' crew session runs itself. */
  readonly routeCommands: readonly string[];
  /** A connector grant the job or its command declares and the member lacks: the owner's step. */
  readonly ownerGrant: boolean;
}

/** The kinds of missing permission that get one line per job, in line order. */
const PERMISSION_KINDS = ["claude_tool", "bash_prefix"] as const;

/**
 * One permission line per granted job and kind (Claude tools, shell commands):
 * `permission to run skills and start helper agents for Triage PR comments:
 * ...`, from `jobNeedsGaps`, the one comparison fit shares. A connector need
 * the job or a command declares beyond its tools' own (those have their
 * connector lines) is a line of its own, in the connector's words. Plain
 * words only. A gap a charter change can close says so; a crew-launched
 * command's says no charter should grant it.
 */
function permissionFindings(
  catalogue: ToolCatalogue,
  jobs: readonly ToolJob[],
  charter: Charter,
  view: GrantView,
  toolNeeds: readonly { readonly need: ConnectorNeed; readonly jobs: readonly ToolJob[] }[],
): PermissionFindings {
  const items: ReadinessItem[] = [];
  const fixTools: string[] = [];
  const fixPrefixes: string[] = [];
  const routeJobs: ToolJob[] = [];
  const routeCommands: string[] = [];
  let ownerGrant = false;
  const held = { allowedTools: charter.tool_policy.allowedTools, allowedBashPrefixes: charter.tool_policy.allowedBashPrefixes };
  for (const job of jobs) {
    const needs = resolveJobNeeds(job, catalogue);
    const gaps = jobNeedsGaps(needs, held);
    for (const kind of PERMISSION_KINDS) {
      const ofKind = gaps.filter((g) => g.kind === kind);
      if (ofKind.length === 0) continue;
      items.push(permissionItem(job, ofKind));
      for (const g of ofKind) {
        if (g.closable) (kind === "claude_tool" ? fixTools : fixPrefixes).push(g.name);
        else {
          if (!routeJobs.includes(job)) routeJobs.push(job);
          if (g.command !== undefined && !routeCommands.includes(g.command)) routeCommands.push(g.command);
        }
      }
    }
    const extra = needs.connectors.filter((n) => n.source !== "tool" && !toolNeeds.some((t) => t.need.kind === n.kind && t.need.write === n.write && t.jobs.includes(job)));
    for (const n of extra) {
      const subject = `permission to use ${connectorAccessText(n)} for ${TOOL_JOBS[job]}`;
      if ("unread" in view) {
        items.push(item("permission", "not_checked", `${subject}: not checked (${view.unread})`, `${subject}: not checked`, [job]));
      } else if (!view.holds({ kind: n.kind, write: n.write, job })) {
        ownerGrant = true;
        items.push(item("permission", "flagged", `${subject}: only you can grant it (Team, in the member's inspector)`, `${subject}: the owner's step in Team`, [job]));
      }
    }
  }
  return { items, fixTools: [...new Set(fixTools)], fixPrefixes: [...new Set(fixPrefixes)], routeJobs, routeCommands, ownerGrant };
}

/** The line for one job's missing permissions of one kind. */
function permissionItem(job: ToolJob, gaps: readonly NeedsGap[]): ReadinessItem {
  const subject = `permission to ${andList(gaps.map((g) => g.label))} for ${TOOL_JOBS[job]}`;
  const crew = gaps.filter((g) => !g.closable).length;
  const why =
    crew === 0
      ? "this charter does not grant it"
      : crew === gaps.length
        ? "no charter should grant it"
        : "this charter does not grant it; part of it is for no charter to grant";
  return item("permission", "flagged", `${subject}: ${why}`, `${subject}: ${crew === gaps.length ? "not granted, and not for a charter to grant" : "not granted"}`, [job]);
}

// ---- The check ---------------------------------------------------------------------------

/**
 * The readiness of `input.charter`: one line per duty, then one per
 * prerequisite of each job the charter grants a tool of (a code job's copy of a
 * repo, a connector grant its granted tools need), and the note Wright is told
 * when anything is open. Reads each workspace's git config; writes nothing;
 * never throws (a read that fails is "not checked", never "ready").
 */
export function charterReadiness(input: ReadinessInput): ReadinessResult {
  const { charter, catalogue } = input;
  const allowed = new Set(charter.tool_policy.allowedTools);
  const duties = dutyFindings(charter, catalogue, allowed);
  const items: ReadinessItem[] = [...duties.items];
  let noRepo = false;
  let unreadableRepo = false;
  let ownerGrant = false;
  let permissions: PermissionFindings | undefined;
  if (catalogue === undefined) {
    if (allowed.size > 0 && [...allowed].some((t) => t.startsWith(KERNEL_TOOL_PREFIX))) {
      items.push(item("jobs", "not_checked", "jobs: the kernel's tool catalogue is unavailable, so the jobs' needs were not checked", "the jobs' needs were not checked (no tool catalogue)"));
    }
  } else {
    // The jobs the charter grants a tool of, in TOOL_JOBS order, each with its granted tools' grant needs.
    const codeJobs: ToolJob[] = [];
    const grantedJobs: ToolJob[] = [];
    const needs: { readonly need: ConnectorNeed; readonly jobs: ToolJob[] }[] = [];
    for (const job of catalogue.jobs) {
      const granted = job.tools.filter((t) => allowed.has(`${KERNEL_TOOL_PREFIX}${t.name}`));
      if (granted.length === 0) continue;
      grantedJobs.push(job.id);
      if (jobNeedsWorkspace(job.id)) codeJobs.push(job.id);
      for (const need of connectorNeeds(granted)) {
        const same = needs.find((n) => n.need.kind === need.kind && n.need.write === need.write);
        if (same === undefined) needs.push({ need, jobs: [job.id] });
        else same.jobs.push(job.id);
      }
    }
    if (codeJobs.length > 0) {
      const line = workspaceItem(codeJobs, workspaceFindings(charter.workspaces, input.dataDir, input.homeDir ?? homedir()));
      if (line.status === "flagged") noRepo = true;
      if (line.status === "not_checked") unreadableRepo = true;
      items.push(line);
    }
    const view = grantView(input.grant);
    // Each connector's read line before its write line.
    for (const { need, jobs } of [...needs].sort((a, b) => Number(a.need.write) - Number(b.need.write))) {
      const line = connectorItem(need, jobs, view);
      if (line.status === "flagged") ownerGrant = true;
      items.push(line);
    }
    // Then each granted job's Claude tool and shell permissions (item 20c), one line per job and kind.
    permissions = permissionFindings(catalogue, grantedJobs, charter, view, needs);
    items.push(...permissions.items);
    if (permissions.ownerGrant) ownerGrant = true;
  }
  const open = items.filter((i) => i.status === "flagged" || i.status === "not_checked");
  const lines = [READINESS_HEADING, ...items.map((i) => i.line)];
  if (open.length === 0) return { lines, items, open };
  // A missing job the catalogue has no tool for is still missing (`jobGranted` fails closed), but no tool can be
  // added for it: it is named apart, never in the fix (as `../playbooks/fit.ts` does).
  const lackingTools = catalogue === undefined ? [] : duties.missingJobs.map((job) => ({ job, tools: jobLackingTools(catalogue, job, allowed) }));
  const fixableJobs = lackingTools.filter((m) => m.tools.length > 0);
  const agentNote = noteText({
    action: input.action,
    open,
    fixableJobs: fixableJobs.map((m) => m.job),
    missingTools: fixableJobs.flatMap((m) => m.tools),
    toollessJobs: lackingTools.filter((m) => m.tools.length === 0).map((m) => m.job),
    noRepo,
    unreadableRepo,
    ownerGrant,
    legacy: duties.legacy,
    fixTools: permissions?.fixTools ?? [],
    fixPrefixes: permissions?.fixPrefixes ?? [],
    routeJobs: permissions?.routeJobs ?? [],
    routeCommands: permissions?.routeCommands ?? [],
  });
  return { lines, items, open, agentNote };
}

interface NoteParts {
  readonly action: "create" | "update";
  readonly open: readonly ReadinessItem[];
  /** The missing jobs the catalogue has at least one tool for, in `TOOL_JOBS` order. */
  readonly fixableJobs: readonly ToolJob[];
  /** The fixable jobs' ungranted tools (their exact `mcp__kernel__` names). */
  readonly missingTools: readonly string[];
  /** The missing jobs the catalogue has no tool for: no charter change can give them. */
  readonly toollessJobs: readonly ToolJob[];
  readonly noRepo: boolean;
  readonly unreadableRepo: boolean;
  readonly ownerGrant: boolean;
  readonly legacy: boolean;
  /** The Claude tools and shell prefixes (exact names) a charter change can add to close a declared job need. */
  readonly fixTools: readonly string[];
  readonly fixPrefixes: readonly string[];
  /** The granted jobs whose gap no charter should close, and the crew-launched commands behind it (D44). */
  readonly routeJobs: readonly ToolJob[];
  readonly routeCommands: readonly string[];
}

/**
 * Wright's note: the open findings in short form, then the fix to propose. The
 * only change it proposes to the charter is adding the missing jobs' tools
 * (their exact `mcp__kernel__` names), and a missing job with no catalogue tool
 * is named apart, with no change; a copy of a repo is asked of the owner;
 * a connector grant and a duty are the owner's own, never drafted by Wright.
 */
function noteText(p: NoteParts): string {
  const how =
    p.action === "create"
      ? "draft the charter again with kernel_agent_create and a new idempotency_key"
      : "propose a kernel_agent_update with a new idempotency_key";
  const sentences = [
    `The kernel checked this charter before the owner sees it; open: ${p.open.map((i) => i.brief).join("; ")}.`,
    "Tell the owner these in plain words, in the thread.",
  ];
  if (p.missingTools.length > 0) {
    sentences.push(
      `The fix to propose: add ${labels(p.fixableJobs)} to tool_policy.allowedTools (${p.missingTools.join(", ")}); if the owner agrees, ${how}.`,
    );
  }
  if (p.fixTools.length > 0 || p.fixPrefixes.length > 0) {
    const adds = [
      ...(p.fixTools.length > 0 ? [`${p.fixTools.join(", ")} to tool_policy.allowedTools`] : []),
      ...(p.fixPrefixes.length > 0 ? [`${p.fixPrefixes.join(", ")} to tool_policy.allowedBashPrefixes`] : []),
    ];
    sentences.push(`Also add ${adds.join(" and ")}, which the granted jobs declare they need; if the owner agrees, ${how}.`);
  }
  if (p.routeJobs.length > 0) {
    const cmds = p.routeCommands.length === 0 ? "a Loomwright command" : p.routeCommands.join(", ");
    sentences.push(
      `${labels(p.routeJobs)} reaches ${cmds}, which the member's own session would have to run and the kernel does not start for it yet (D44): ` +
        "it needs permissions no crew charter should hold, so propose no tool or shell grant for it; the owner decides whether to approve the charter as it is.",
    );
  }
  if (p.toollessJobs.length > 0) {
    const them = p.toollessJobs.length === 1 ? "it" : "them";
    sentences.push(`This charter needs ${labels(p.toollessJobs)}; the kernel has no tool for ${them}, so no charter change can give ${them} to this member: propose no tool change for ${them}.`);
  }
  if (p.noRepo) {
    sentences.push(
      `Ask the owner where their copy of the repo is (a git checkout with a GitHub remote, outside ${protectedLocationsText()} and the kernel's data dir), to list it in workspaces.`,
    );
  }
  if (p.unreadableRepo) sentences.push("Ask the owner to check that the kernel can read the workspace named above.");
  if (p.ownerGrant) sentences.push("Connector access is the owner's own step, in Team: tell the owner what is needed; it is never a change you draft.");
  if (p.legacy) sentences.push("A duty that names no job was written before duties named their jobs; only the owner changes duties, so propose no change to it.");
  return sentences.join(" ");
}

/** What a request to the same fields may change: the granted tools (`tool_policy`), the workspaces. */
export interface ReadinessFloorSets {
  readonly tools: boolean;
  readonly workspaces: boolean;
}

/** The shortest duty line a request setting `tool_policy` can give `duty` (number `n`), from its real line `actual`. */
function shortestDutyLine(duty: Charter["duties"][number], n: number, actual: string, catalogue: ToolCatalogue | undefined): string {
  // A bare line, a duty needing no tool, or no catalogue: the line does not depend on the tools.
  if (typeof duty === "string" || duty.jobs.length === 0 || catalogue === undefined) return actual;
  // The same excerpt `dutyFindings` quotes, so this stays a lower bound of the real line.
  const excerpt = dutyExcerpt(duty.text);
  const covered = `${READINESS_COVERED_PREFIX}duty ${n} by ${andList(duty.jobs.map((j) => TOOL_JOBS[j]))}: ${excerpt}`;
  const label = duty.jobs.map((j) => TOOL_JOBS[j]).reduce((a, b) => (b.length < a.length ? b : a));
  const flagged = `${READINESS_FLAG_PREFIX}duty ${n} not covered (needs ${label}, which this charter does not grant): ${excerpt}`;
  return covered.length <= flagged.length ? covered : flagged;
}

/**
 * A lower bound on the readiness lines of any update to the same fields as
 * the one whose readiness is `actual` (`updateFloor`): the lines themselves
 * when the request sets neither the tools nor the workspaces (nothing else
 * changes them); otherwise the heading (always the same), each duty's line at
 * its shortest (exact when it can't vary: a bare line, a duty needing no tool,
 * no catalogue; else the shorter of covered by all its jobs and not covered
 * for its shortest job label), and, unless the tools change (a request can
 * grant no kernel tool, so no job line), each prerequisite line: a connector
 * line as it is (the grant and the tools stay), the code jobs' workspace line
 * at its shortest ready form (`shortestWorkspaceLine`).
 */
export function readinessFloorLines(charter: Charter, catalogue: ToolCatalogue | undefined, actual: ReadinessResult, sets: ReadinessFloorSets): string[] {
  if (!sets.tools && !sets.workspaces) return [...actual.lines];
  const lines = [READINESS_HEADING];
  const duties = actual.items.filter((i) => i.subject === "duty");
  for (const [i, duty] of charter.duties.entries()) {
    const real = duties[i]?.line ?? "";
    lines.push(sets.tools ? shortestDutyLine(duty, i + 1, real, catalogue) : real);
  }
  if (sets.tools) return lines;
  for (const it of actual.items) {
    if (it.subject === "duty") continue;
    lines.push(it.subject === "workspace" && it.jobs !== undefined ? shortestWorkspaceLine(it.jobs) : it.line);
  }
  return lines;
}

/**
 * The clause the kernel's apply adds to its applied sentence when the owner
 * approved with findings still open (AC8): ` The owner chose to proceed with
 * these still open: <brief>; <brief>.`, or `""` when nothing is open.
 */
export function openFlagsSentence(readiness: ReadinessResult): string {
  return readiness.open.length === 0 ? "" : ` The owner chose to proceed with these still open: ${readiness.open.map((i) => i.brief).join("; ")}.`;
}

// ---- Wright's create ------------------------------------------------------------------

/**
 * Why Wright's create is refused (`invalid_input`): a bare-string duty, which
 * names no job, so the kernel could not check the charter covers it. Only
 * Wright's `kernel_agent_create` asks this; the owner's own create, stored
 * charters and updates keep bare strings. Undefined when every duty is an entry.
 */
export function wrightDutyRefusal(charter: Charter): string | undefined {
  const i = charter.duties.findIndex((d) => typeof d === "string");
  if (i < 0) return undefined;
  return (
    `duties.${i}: write each duty as {"text": "<the duty>", "jobs": [<the catalogue job ids that do it>]} ` +
    "([] for a duty that needs no kernel tool), so the kernel can check that the charter grants every job a duty needs"
  );
}
