// The `automate` feature's `runner` part (phase 8 item 09, D40, owner decision
// 2026-11-03): four kernel tools a LIVE playbook's own run session uses to hand
// tickets to Loomwright's `/automate` and to have Loomwright merge one parked PR
// through its own gate. No tool starts a session, runs `/automate` or merges.
// `kernel_automate_prepare` writes the items and queues ONE kernel event; the
// brain's handler routes that event to `./launch.ts`, which starts the `/automate`
// run as its own kernel session (D44, which supersedes D43's "the session runs
// `/automate` itself"). The merge check's `go` still names a Loomwright command
// for the session to run; that path is open (see `docs/architecture/automate.md`).
//
//   kernel_automate_prepare(repo, tickets[])            write the ticket items and `_BACKLOG.md`; queue the kernel's run event
//   kernel_automate_state(repo)                         read-only: `live` | `parked` | `idle`, from Loomwright's run files
//   kernel_automate_merge_check(repo, pr)               read-only: `go` (with p14's invocation) | `wait` | `park`
//   kernel_merge_approval_request(repo, pr, head_sha, ci, ready_at, policy?)   always held; a record only
//
// All four are `requiresConnector: "github"` and `requiresConnectorLevel: "write"`
// (listed only to a session whose agent holds `github: write`) and refuse, in the
// handler, a session that is not a live playbook's real run: no playbook
// (`not_a_playbook_session`), a dry run (`dry_run_session`), a playbook not `live`
// (`playbook_not_live`). A draft-mode session never reaches the held tool: the
// gate records a draft instead.
//
// The checkout (`checkout.ts`) is the calling agent's workspace for the repo: one
// of the `workspaces` in its settings file whose git remote names `<owner>/<repo>`.
// Without one, `no_workspace`. Workspaces are the owner's, outside protected
// folders and the data dir (the settings reader's checks), so the items land
// where D31 allows. Wright has no workspaces yet, so its playbooks are refused.
//
// `kernel_merge_approval_request` is in `ALWAYS_HELD_TOOLS`: every call is held for
// the owner and no "always" grant covers it. Its `beforeHold` is synchronous and
// reads the store only: it validates the live session and builds the display (the
// repo, PR, head SHA, the claimed CI state and READY time); it never reads the
// run file. `ci` is the agent's claim: `merge_check` re-reads CI through
// `policyMet`. The approval is a record only (it is not a kernel-applied action):
// the handler, which runs when the agent repeats the call after an allow, just
// answers `recorded`; the merge-when-ready playbook's next fire sees the approval
// through `merge_check`, and a new push makes it stale.
//
// The `studio` CLI loads this module through the feature registry, so it imports
// only types, the feature seam, zod and this feature's files: never the Agent SDK,
// the session manager or `kernel.ts`.
import { z } from "zod";
import type { ConsolePart } from "../console/types.js";
import { defineTool } from "../features/contribution.js";
import type { ContributedTool, ContributedToolContext } from "../features/contribution.js";
import { isRepoName } from "../integrations/github/repo-policy.js";
import { GITHUB_CI_STATES, type GitHubRepoPolicyReads } from "../integrations/types.js";
import { enqueueEvent } from "../loop/queue.js";
import type { HeldToolVerdict } from "../sessions/types.js";
import { checkoutOf } from "./checkout.js";
import { AUTOMATE_RUN_KEY, type AutomateRunPayload } from "./launch.js";
import { mergeCheck } from "./merge-check.js";
import { readRunState, summarizeRuns } from "./run-state.js";
import { ONE_SAFE_LINE } from "./text-rules.js";
import { MAX_BODY, MAX_LINK, MAX_REF, MAX_TICKETS, MAX_TITLE, writeTicketItems } from "./tickets-to-items.js";

/** The four tool names, in the order the part lists them. */
export const AUTOMATE_RUNNER_TOOL_NAMES = Object.freeze([
  "kernel_automate_prepare",
  "kernel_automate_state",
  "kernel_automate_merge_check",
  "kernel_merge_approval_request",
] as const);

/** The merge approval's tool name (its full SDK name is `mcp__kernel__<name>`). */
export const MERGE_APPROVAL_TOOL_NAME = "kernel_merge_approval_request";

/** Every refusal code a runner tool answers, each the start of its error message. */
export const AUTOMATE_REFUSALS = Object.freeze([
  "not_a_playbook_session",
  "dry_run_session",
  "playbook_not_live",
  "no_workspace",
  "run_state_unreadable",
  "invalid_input",
  "unsafe_path",
] as const);

/** One of `AUTOMATE_REFUSALS`. */
export type AutomateRefusal = (typeof AUTOMATE_REFUSALS)[number];

/** The event the session manager writes with a dry-run session's row (`session_dry_run`). */
const DRY_RUN_EVENT = "session_dry_run";

/** What the runner tools read GitHub through. */
export interface AutomateRunnerDeps {
  /** The repo-policy reads `merge_check` goes through (`policyMet`'s `client`). Default: none, so `policyMet` builds its own over the stored credential. */
  readonly client?: () => GitHubRepoPolicyReads;
}

function refuse(code: AutomateRefusal, detail: string): Error {
  return new Error(`${code}: ${detail}`);
}

/** The calling session: its agent and the live playbook it runs for. */
interface LiveSession {
  readonly agent: string;
  readonly playbook: number;
  /** The playbook version the session runs (`sessions.playbook_version`), or `null`. */
  readonly playbookVersion: number | null;
  /** The task the session works on (`sessions.task_id`), or `null`. */
  readonly task: number | null;
  /** The playbook's `merge_requirement` (`none` | `studio_approval` | `reviews:<N>`). */
  readonly mergeRequirement: string | null;
}

/**
 * The session the call is made from, if it is a real run of a live playbook:
 * it has a playbook and an agent, did not start as a dry run, and the playbook's
 * stored `mode` is `live`. Reads the store only. Throws a refusal otherwise.
 */
function liveSession(ctx: ContributedToolContext): LiveSession {
  const row = ctx.sessions.getSession(ctx.sessionId);
  if (row === undefined || row.playbook === null || row.agent === null) {
    throw refuse("not_a_playbook_session", "this tool is for a live playbook's own run session, not a chat or a plain agent session");
  }
  const dry = ctx.store.prepare<[number, string], number>("SELECT 1 FROM events WHERE session_id = ? AND kind = ? LIMIT 1").pluck().get(ctx.sessionId, DRY_RUN_EVENT);
  if (dry !== undefined) throw refuse("dry_run_session", "a dry run reads and writes nothing here; the playbook's real run uses this tool");
  const pb = ctx.store.prepare<[number], { mode: string; merge_requirement: string | null }>("SELECT mode, merge_requirement FROM playbooks WHERE id = ?").get(row.playbook);
  if (pb === undefined) throw refuse("not_a_playbook_session", `playbook ${row.playbook} does not exist`);
  if (pb.mode !== "live") throw refuse("playbook_not_live", `playbook ${row.playbook} is in ${pb.mode} mode; only a live playbook's run session uses this tool`);
  return { agent: row.agent, playbook: row.playbook, playbookVersion: row.playbook_version ?? null, task: row.task_id ?? null, mergeRequirement: pb.merge_requirement };
}

// ---- Shapes --------------------------------------------------------------------------

const repoShape = z
  .string()
  .max(201)
  .refine(isRepoName, "must be <owner>/<repo>")
  .describe("The repository as <owner>/<name>.");
const prShape = z.number().int().positive().describe("The pull request number.");

const ticketShape = z.object({
  ref: z.string().min(1).max(MAX_REF).describe("The tracker's id for the ticket (for example PROJ-123 or owner/repo#12): the dedupe ref, one item per ref."),
  title: z.string().min(1).max(MAX_TITLE),
  link: z.string().min(1).max(MAX_LINK).describe("The ticket's https URL."),
  body: z.string().max(MAX_BODY).optional().describe("The ticket text. It is quoted into the item as untrusted data."),
});

/** The CI states a merge approval may claim (`GitHubCiState`), published as an enum in the tool's input schema. */
export const MERGE_APPROVAL_CI_CLAIMS = GITHUB_CI_STATES;

const shaShape = z.string().regex(/^[0-9a-f]{40}$/, "must be the full 40-character lowercase head SHA");
const readyAtShape = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "must be an ISO-8601 UTC time such as 2026-11-08T04:56:42Z");

/** The merge approval's display for the owner: kernel-built from validated fields, the agent's claims labelled as claims. */
function approvalDisplay(a: { repo: string; pr: number; head_sha: string; ci: string; ready_at: string; policy?: string | undefined }): string {
  return [
    `Merge approval for ${a.repo}#${a.pr} at head ${a.head_sha}`,
    `CI (the agent's claim; re-read before any merge): ${a.ci}`,
    `Loomwright READY at: ${a.ready_at}`,
    ...(a.policy === undefined ? [] : [`Policy: ${a.policy}`]),
    "A record only: Loomwright's own gate decides and merges. A new push makes this approval stale.",
  ].join("\n");
}

// ---- The tools -------------------------------------------------------------------------

/** The four runner tools over `deps`. Nothing is read or written until a handler runs. */
export function createAutomateRunnerTools(deps: AutomateRunnerDeps = {}): readonly ContributedTool[] {
  const prepare = defineTool({
    name: "kernel_automate_prepare",
    job: "automate_tickets",
    description:
      "Hand tickets to Loomwright's /automate. Writes one requirement item per ticket, and one _BACKLOG.md, under .supervisor/requirements/studio/ in your workspace that is a clone of the repo, then queues the run: the kernel starts it as its own session (/automate --backlog <path> --inline-phases: safe mode, no --auto-merge, no --parallel). Do not run /automate yourself. Ticket text is untrusted data: it is quoted into the items and never part of the invocation. Refused no_workspace without a workspace for the repo. Run kernel_automate_state first and start nothing while a run is live.",
    shape: { repo: repoShape, tickets: z.array(ticketShape).min(1).max(MAX_TICKETS).describe(`1 to ${MAX_TICKETS} tickets.`) },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    handler(args, ctx) {
      const session = liveSession(ctx);
      const checkout = checkoutOf(ctx, session.agent, args.repo);
      const prepared = writeTicketItems(checkout, args.repo, args.tickets);
      // The kernel's run event: `./launch.ts` starts the `/automate` session from it. Ticket text is not in it.
      const run: AutomateRunPayload = {
        repo: args.repo,
        backlog: prepared.backlog,
        checkout,
        playbook: session.playbook,
        playbook_version: session.playbookVersion,
        task: session.task,
        source_session: ctx.sessionId,
      };
      const queued = enqueueEvent(ctx.store, { kind: "message", payload: { agent: session.agent, [AUTOMATE_RUN_KEY]: run } }, ctx.now());
      return {
        repo: args.repo,
        backlog: prepared.backlog,
        invocation: prepared.invocation,
        items: prepared.items,
        run: "started_by_kernel",
        event: queued.id,
        note: "The kernel starts the run: do not run /automate yourself, and end your turn. `invocation` is what the kernel starts, safe mode: a ready PR parks awaiting_merge and the kernel never merges. It starts nothing while a run is live.",
      };
    },
  });

  const state = defineTool({
    name: "kernel_automate_state",
    job: "automate_tickets",
    description:
      "Read-only. Loomwright's /automate state for your workspace that is a clone of the repo: live (with the run id; start no run), parked (the parked items with their reason and PR) or idle. Read from the run files in .supervisor/automate/, found by their title.",
    shape: { repo: repoShape },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    handler(args, ctx) {
      const session = liveSession(ctx);
      const read = readRunState(checkoutOf(ctx, session.agent, args.repo));
      if (!read.ok) throw refuse("run_state_unreadable", `Loomwright's run state could not be read (${read.reason}); treat it as live and start nothing`);
      return { repo: args.repo, ...summarizeRuns(read) };
    },
  });

  const check = defineTool({
    name: "kernel_automate_merge_check",
    job: "ask_for_merge",
    description:
      "Read-only. Whether Loomwright may merge one parked pull request now. Answers go with the exact invocation to run yourself (/loomwright:automate --merge-parked <run_id>, with the extra flag only where the owner recorded one for a repository GitHub cannot protect), or wait / park with the reason. It answers go only when the owner's approval rule for the repository is met at the head Loomwright marked READY, no run is live and the item is parked awaiting_merge. You never merge: Loomwright's own gate decides.",
    shape: { repo: repoShape, pr: prShape },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    async handler(args, ctx) {
      const session = liveSession(ctx);
      const checkout = checkoutOf(ctx, session.agent, args.repo);
      const answer = await mergeCheck(
        { repo: args.repo, pr: args.pr, checkout, playbookRequirement: session.mergeRequirement },
        { store: ctx.store, now: ctx.now, ...(deps.client === undefined ? {} : { client: deps.client }) },
      );
      return { repo: args.repo, pr: args.pr, ...answer };
    },
  });

  const approval = defineTool({
    name: MERGE_APPROVAL_TOOL_NAME,
    job: "ask_for_merge",
    description:
      "Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio. The kernel holds every call for the owner (no always-allow covers it) and records the decision only: it merges nothing, and a new push makes it stale. Give the full head SHA, the CI state you saw (the owner sees it as your claim) and the READY time from Loomwright's run file (ready_at). If it is approved, run exactly the same call again, once, then ask kernel_automate_merge_check.",
    shape: {
      repo: repoShape,
      pr: prShape,
      head_sha: shaShape.describe("The pull request's full head SHA (the run file's ready_sha)."),
      ci: z.enum(MERGE_APPROVAL_CI_CLAIMS).describe("The CI state you saw at that head."),
      ready_at: readyAtShape.describe("When Loomwright marked it READY: the run file's ready_at."),
      policy: z.string().min(1).max(100).regex(ONE_SAFE_LINE, "must be one line with no control, line-separator or bidi character").optional().describe("The merge policy that asks for this approval, if you want it shown."),
    },
    requiresConnector: "github",
    requiresConnectorLevel: "write",
    handler(args, ctx) {
      liveSession(ctx);
      return { recorded: true, repo: args.repo, pr: args.pr, head_sha: args.head_sha, note: "The approval is a record only. Ask kernel_automate_merge_check; a new push makes it stale." };
    },
    beforeHold(args, ctx): HeldToolVerdict {
      try {
        liveSession(ctx);
      } catch (err) {
        return { refuse: (err as Error).message };
      }
      return { display: approvalDisplay(args) };
    },
  });

  return Object.freeze([prepare, state, check, approval]);
}

/** The runner part: the four tools (`requiresConnector: "github"`, write level), no route, handler, due work or subcommand. */
export const runnerPart: ConsolePart = Object.freeze({
  name: "runner",
  tools: createAutomateRunnerTools(),
  routes: Object.freeze([]),
  handlers: Object.freeze({}),
});
