// The phase 8 exit walk's canned world (item 14), for `app/e2e/phase-8-exit.spec.ts`: everything a REAL
// in-process kernel needs to walk acceptance test 2 (tickets to PRs through Loomwright's `/automate`)
// with no real account, token, Keychain, network or model. The spec runs `startKernel` in the Playwright
// worker (phase 5's pattern) over the contributions composed here, and drives the built app against it.
//
// What is canned, and where it comes from (nothing is copied, nothing under `kernel/` is edited):
//   - the fake GitHub is `kernel/test/fixtures/github-fake.ts`'s `FakeGitHubClient`, subclassed once so a pull
//     request can be moved to `merged` the way GitHub reports it (the base fake's pulls are fixed data);
//   - the ClickUp ticket reader is `createMcpTicketReader` over `kernel/test/fixtures/mcp-fake.ts`'s fake MCP
//     server and fake Keychain, listing the tool the pinned `mcp-trackers/clickup-tools.json` names;
//   - the stand-in `/automate` writes Loomwright's recorded run files, cut from
//     `kernel/test/fixtures/loomwright-run-files/` (`live/` and `parked/`) with the walk's own ids substituted;
//   - the stand-in sessions are `kernel/test/session-fakes.ts`'s fake spawner and query, told apart by model
//     and by what their prompt says (`standIns`);
//   - one mutable clock is read by `KernelDeps.now`, `loopDeps.now`, the brain's handler, the ticket reader and
//     the MCP connector alike.
//
// The shared walk (the kernel half is `kernel/test/phase-8-exit.test.ts`; each half holds its own copy of the data):
//   tickets   GitHub issue #11 and ClickUp task cu-1 on vikashruhilgit/studio-sandbox become PR A #21 and PR B #22
//   comments  on PR A: "fix: rename ping to pong", "question: why exit 0?" and "remark: nice"
//   the rest  one re-request of the owner; PR A under Solo; PR B under Approve in Studio; a direct `gh pr merge`
//
// Composing the kernel without real clients: `SHIPPED_CONTRIBUTIONS` with three entries rebuilt from their own
// factories over the fakes (the shipped ones would build the Keychain-backed clients on first use), the brain's
// `message` handler on the test's clock, and the stub notifier. No part lacked a deps seam.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KeychainError } from "../../../kernel/src/auth/index.js";
import type { KeychainReader, KeychainWriter } from "../../../kernel/src/auth/index.js";
import { AUTOMATE_PARTS, automateContributionOf } from "../../../kernel/src/automate/index.js";
import { createAutomateRunnerTools } from "../../../kernel/src/automate/runner.js";
import { createRoutingTools } from "../../../kernel/src/automate/routing.js";
import { createTrackerDueWork } from "../../../kernel/src/automate/tracker.js";
import { PROPOSED_ALLOWED_TOOLS, brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightSettingsPath } from "../../../kernel/src/brain/index.js";
import { SHIPPED_CONTRIBUTIONS } from "../../../kernel/src/features/index.js";
import type { DueWorkFn, FeatureContribution } from "../../../kernel/src/features/index.js";
import { INTEGRATIONS_PARTS, createGitHubTools, integrationsContributionOf, repoPolicyRoutes } from "../../../kernel/src/integrations/index.js";
import { createGitHubWriteTools } from "../../../kernel/src/integrations/github/write-tools.js";
import { createMcpConnector } from "../../../kernel/src/integrations/mcp/connector.js";
import { createMcpTicketReader } from "../../../kernel/src/integrations/mcp/trackers.js";
import type { McpTicketReader } from "../../../kernel/src/integrations/mcp/trackers.js";
import type {
  GitHubIssueSummary,
  GitHubPrComment,
  GitHubPull,
  GitHubPullMergeState,
  GitHubResponse,
} from "../../../kernel/src/integrations/types.js";
import type { QueryFn } from "../../../kernel/src/sessions/index.js";
import type { Store } from "../../../kernel/src/store/index.js";
import { fireDueTriggers, firePollTriggers, triggersContribution } from "../../../kernel/src/triggers/index.js";
import { FakeGitHubClient } from "../../../kernel/test/fixtures/github-fake.js";
import { fakeKeychain, startFakeMcp } from "../../../kernel/test/fixtures/mcp-fake.js";
import type { FakeKeychain, FakeMcp } from "../../../kernel/test/fixtures/mcp-fake.js";
import { stubNotifierContributions } from "../../../kernel/test/notifier-stub.js";
import { fakeMsg, fakeSessions } from "../../../kernel/test/session-fakes.js";
import type { FakeCall } from "../../../kernel/test/session-fakes.js";

// ---- The walk's names and values ---------------------------------------------------------

/** The throwaway repo the walk is about, and its owner's login (the GitHub account the connector is for). */
export const REPO = "vikashruhilgit/studio-sandbox";
export const OWNER = "vikashruhilgit";
export const CREW = "mason";

/** The tickets and the pull requests they become. */
export const ISSUE_NUMBER = 11;
export const CLICKUP_TASK = "cu-1";
export const ISSUE_REF = `github:${REPO}#${ISSUE_NUMBER}`;
export const CLICKUP_REF = `clickup:${CLICKUP_TASK}`;
export const PR_A = 21;
export const PR_B = 22;
export const HEAD_A = "a1".repeat(20);
export const HEAD_B = "b2".repeat(20);
export const URL_A = `https://github.com/${REPO}/pull/${PR_A}`;
export const URL_B = `https://github.com/${REPO}/pull/${PR_B}`;
/** The time Loomwright marked each PR READY (a run file's `ready_at`; a merge approval names it). */
export const READY_AT_A = "2026-11-08T07:36:18Z";
export const READY_AT_B = "2026-11-08T07:41:02Z";

/** The three comments on PR A, with the ids they have on GitHub, and what the stand-in session answers. */
export const COMMENT_FIX = { kind: "review_comment", id: 301, text: "fix: rename ping to pong" } as const;
export const COMMENT_QUESTION = { kind: "issue_comment", id: 302, text: "question: why exit 0?" } as const;
export const COMMENT_REMARK = { kind: "review_comment", id: 303, text: "remark: nice" } as const;
export const ANSWER_TEXT = "Exit 0 is the ping command's success status; it has no other meaning.";
export const REPLY_TEXT = "Thanks.";

/** Every session's model: a stand-in is told from the others by it (and by what its prompt says). */
export const WRIGHT_MODEL = "claude-haiku-4-5";
export const CREW_MODEL = "claude-sonnet-4-5";
export const TICKETS_MODEL = "claude-opus-4-1";
export const TRIAGE_MODEL = "claude-sonnet-4-6";
export const MERGE_MODEL = "claude-opus-4-5";

/** The injected clock starts here and the polls run every five minutes. */
export const START = "2026-11-09T09:00:00.000Z";
export const POLL_SECONDS = 300;
/** One step of the walk: past the next poll instant, so every poll that is due fires once. */
export const STEP_MS = (POLL_SECONDS + 1) * 1000;

export const K = "mcp__kernel__";
/** The kernel tools the crew member's policy allows (their full SDK names). */
export const CREW_TOOLS: readonly string[] = [
  "kernel_automate_state",
  "kernel_automate_prepare",
  "kernel_automate_merge_check",
  "kernel_merge_approval_request",
  "kernel_pr_route",
  "kernel_github_pr_reply",
  "kernel_github_pr_comment",
  "kernel_github_pr_request_reviewers",
].map((name) => `${K}${name}`);

// ---- One clock, one Keychain ------------------------------------------------------------------

/** One mutable instant, read by everything that tells time. */
export function mutableClock(iso: string) {
  let ms = Date.parse(iso);
  return {
    now: (): Date => new Date(ms),
    advance: (by: number): void => {
      ms += by;
    },
  };
}
export type Clock = ReturnType<typeof mutableClock>;

/** A Keychain in memory for the kernel's own API token: the kernel generates it on first start. */
export function memoryKeychain() {
  const items = new Map<string, string>();
  const reader: KeychainReader = { read: (service) => items.get(service) };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { items, reader, writer };
}

// ---- The fake GitHub ---------------------------------------------------------------------------

function pull(number: number, title: string, head: string): GitHubPull {
  return {
    number,
    title,
    author: OWNER,
    draft: false,
    head_sha: head,
    url: `https://github.com/${REPO}/pull/${number}`,
    updated_at: "2026-11-09T08:50:00.000Z",
    body: `Opened by /automate for ${REPO}.`,
    state: "open",
    base_ref: "main",
    head_ref: `feature/pr-${number}`,
    labels: [],
  };
}

const ISSUE: GitHubIssueSummary = {
  number: ISSUE_NUMBER,
  title: "Add a ping command",
  body: "Add `studio ping`: it prints pong and exits 0.",
  author: OWNER,
  labels: [],
  url: `https://github.com/${REPO}/issues/${ISSUE_NUMBER}`,
  updated_at: "2026-11-09T08:00:00.000Z",
};

function comment(c: { readonly kind: GitHubPrComment["kind"]; readonly id: number; readonly text: string }): GitHubPrComment {
  const tail = c.kind === "issue_comment" ? `#issuecomment-${c.id}` : `#discussion_r${c.id}`;
  return { kind: c.kind, id: c.id, pr: PR_A, author: "alice", body: c.text, url: `${URL_A}${tail}`, updated_at: "2026-11-09T08:55:00.000Z" };
}

/** What `getPullMergeState` answers for a head: no approvals, nothing requested, and the CI given. */
export function mergeState(head: string, ci: GitHubPullMergeState["ci"]): GitHubPullMergeState {
  return { head_sha: head, approvals: 0, changes_requested: false, ci };
}

/**
 * The sandbox repo as GitHub shows it. The base fake serves fixed pulls; this one can also move a pull request
 * to `merged`, as GitHub reports it once Loomwright's gate merged it. It has no merge method at all: the
 * `GitHubClient` interface the kernel codes against has none (the kernel never merges, invariant 4).
 */
export class SandboxGitHub extends FakeGitHubClient {
  readonly #merged = new Set<number>();

  constructor() {
    super({
      tokenInfo: { login: OWNER, expires_at: null, permissions: { metadata: "read", pull_requests: "write", issues: "write", contents: "read" } },
      repos: [{ full_name: REPO, private: false }],
      pulls: { [REPO]: [pull(PR_A, "Add the ping command", HEAD_A), pull(PR_B, "Add the greeting banner", HEAD_B)] },
      issues: { [REPO]: [ISSUE] },
      prComments: { [REPO]: [comment(COMMENT_FIX), comment(COMMENT_QUESTION), comment(COMMENT_REMARK)] },
      // What detection reads: a public repo whose `main` requires the `ci` check, and only the owner can push: the proposal is Solo.
      repoInfo: { [REPO]: { default_branch: "main", private: false } },
      protection: { [REPO]: { required_approving_review_count: null, required_checks: ["ci"] } },
      pushers: { [REPO]: [OWNER] },
      mergeStates: { [`${REPO}#${PR_A}`]: mergeState(HEAD_A, "green"), [`${REPO}#${PR_B}`]: mergeState(HEAD_B, "pending") },
    });
  }

  /** Loomwright's gate merged `number`: from now on GitHub reports it merged and closed. */
  markMerged(number: number): void {
    this.#merged.add(number);
  }

  override async getPull(repo: string, number: number): Promise<GitHubResponse<GitHubPull>> {
    const res = await super.getPull(repo, number);
    if (res.ok && this.#merged.has(number)) return { ...res, data: { ...res.data, merged: true, state: "closed" } };
    return res;
  }
}

// ---- The fake ClickUp --------------------------------------------------------------------------

const CLICKUP_TOOLS = (JSON.parse(readFileSync(fileURLToPath(new URL("../../../kernel/test/fixtures/mcp-trackers/clickup-tools.json", import.meta.url)), "utf8")) as { tools: unknown[] }).tools;
/** The one tool a ClickUp poll calls (`MCP_TRACKERS.clickup.tool`). */
const CLICKUP_LIST_TOOL = "get_workspace_tasks";

/** The task the ClickUp poll finds. `date_updated` is epoch milliseconds, as ClickUp sends it. */
export const CLICKUP_TASK_ROW = {
  id: CLICKUP_TASK,
  name: "Add a greeting banner",
  description: "Print a banner when the app starts.",
  status: { status: "open" },
  tags: [],
  url: `https://app.clickup.com/t/${CLICKUP_TASK}`,
  date_updated: String(Date.parse("2026-11-09T08:10:00.000Z")),
};

export interface Clickup {
  /** The kernel's ticket reader, over the fake server and the fake Keychain. */
  readonly reader: McpTicketReader;
  readonly mcp: FakeMcp;
  readonly keychain: FakeKeychain;
  /** The ClickUp connection the owner's sign-in makes, against the fake authorization server (no token leaves this process). */
  connect(store: Store, clock: Clock): Promise<void>;
  close(): Promise<void>;
}

/**
 * A fake ClickUp MCP server on 127.0.0.1 listing `CLICKUP_TASK_ROW`, a fake Keychain, and the kernel's own
 * ticket reader over both. The access token carries no `expires_in`, so the connection never comes due for a
 * renewal (the shipped `mcp` part's renewal would otherwise read the real Keychain as the clock moves).
 */
export async function startClickup(clock: Clock): Promise<Clickup> {
  const mcp = await startFakeMcp({
    tools: CLICKUP_TOOLS,
    accessTtlSeconds: null,
    callResult: (name) => (name === CLICKUP_LIST_TOOL ? { content: [{ type: "text", text: JSON.stringify({ tasks: [CLICKUP_TASK_ROW] }) }] } : undefined),
  });
  const keychain = fakeKeychain();
  const connector = createMcpConnector({ keychain: keychain.reader, writer: keychain.writer, deleter: keychain.deleter, serverFor: () => ({ url: mcp.mcpUrl }), allowLoopbackHttp: true });
  const reader = createMcpTicketReader({ keychain: keychain.reader, http: { allowLoopbackHttp: true }, serverFor: () => mcp.mcpUrl, now: clock.now });
  return {
    reader,
    mcp,
    keychain,
    async connect(store, at) {
      const opened = await connector.connect(store, "clickup", at.now);
      if (!opened.ok) throw new Error(`the fake ClickUp refused the connect: ${opened.error}`);
      await mcp.browse(opened.authorize_url);
      const outcome = await opened.done;
      if (!outcome.ok) throw new Error(`the fake ClickUp connect failed: ${outcome.reason}`);
    },
    async close() {
      connector.cancel("clickup");
      await mcp.close();
    },
  };
}

// ---- The kernel, composed over the fakes -----------------------------------------------------------

/** What the composed kernel reads outward through: the fake GitHub and the ClickUp ticket reader. */
export interface World {
  readonly github: SandboxGitHub;
  readonly reader: McpTicketReader;
  readonly clock: Clock;
}

/** The triggers contribution with its due work reading the fakes: time-based triggers, then the polls (a lone failure is rethrown, two are thrown as one). */
function triggersOver(world: World): FeatureContribution {
  const due: DueWorkFn = async ({ store, now }) => {
    const failures: unknown[] = [];
    try {
      fireDueTriggers(store, now());
    } catch (err) {
      failures.push(err);
    }
    try {
      await firePollTriggers(store, world.github, now(), world.reader);
    } catch (err) {
      failures.push(err);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new Error(failures.map(String).join("; "));
  };
  return Object.freeze({ ...triggersContribution, dueWork: Object.freeze([due]) });
}

/**
 * `SHIPPED_CONTRIBUTIONS` with `automate`, `integrations` and `triggers` rebuilt over `world` (each from its own factories),
 * the brain's `message` handler on the test's clock, and the stub notifier. Every other contribution is the shipped one.
 */
export function exitContributions(world: World): readonly FeatureContribution[] {
  const client = () => world.github;
  const automate = automateContributionOf([
    ...AUTOMATE_PARTS.map((part) => {
      if (part.name === "runner") return { ...part, tools: createAutomateRunnerTools({ client }) };
      if (part.name === "tracker") return { ...part, dueWork: [createTrackerDueWork({ client })] };
      if (part.name === "routing") return { ...part, tools: createRoutingTools({ client }) };
      return part;
    }),
  ]);
  // All seven parts, in their order; only the GitHub tools and the repo-policy routes are rebuilt (the other five keep the shipped part).
  const integrations = integrationsContributionOf(
    INTEGRATIONS_PARTS.map((part) => {
      if (part.name === "github-tools") return { ...part, tools: [...createGitHubTools({ client }), ...createGitHubWriteTools({ client })] };
      if (part.name === "repo-policy") return { ...part, routes: repoPolicyRoutes({ client }) };
      return part;
    }),
  );
  const brain: FeatureContribution = Object.freeze({
    ...brainContribution,
    handlers: Object.freeze({ message: brainMessageHandler({ now: world.clock.now, timeZone: () => "UTC" }) }),
  });
  const triggers = triggersOver(world);
  const composed = SHIPPED_CONTRIBUTIONS.map((c) => {
    if (c === brainContribution) return brain;
    if (c.name === automate.name) return automate;
    if (c.name === integrations.name) return integrations;
    if (c.name === triggers.name) return triggers;
    return c;
  });
  return stubNotifierContributions(Object.freeze(composed));
}

/** Wright's settings: its model and the proposed tool policy. Wright does nothing in this walk, but the kernel starts with its file in place. */
export function writeWrightSettings(dataDir: string): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  const policy = { status: "owner", allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [], never: [] };
  writeFileSync(file, `${JSON.stringify({ ...settings, model: WRIGHT_MODEL, tool_policy: policy }, null, 2)}\n`);
}

/**
 * The crew member's charter: the one the owner approves in the live run (its grants are set by the owner after it).
 * Its policy lets it use the kernel's automate, routing and GitHub write tools, and names `gh pr merge` as a Bash prefix, so
 * a direct merge reaches the rail (which denies it `merge_blocked`) rather than the policy's own prefix check.
 */
export function crewCharter(workspace: string): Record<string, unknown> {
  return {
    id: CREW,
    display_name: "Mason",
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful engineer who turns tickets into pull requests and looks after them.",
    duties: ["Hand each ticket to /automate and follow its pull request.", "Triage the comments on a pull request: fix, reply or answer."],
    boundaries: ["Never push to a branch that is not yours, and never merge: Loomwright's gate does that."],
    model: CREW_MODEL,
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read", "Skill", ...CREW_TOOLS], allowedBashPrefixes: ["gh pr merge"], never: ["git_push"] },
    workspaces: [workspace],
  };
}

// ---- Loomwright's run files, as the stand-in /automate writes them ------------------------------------------

const RUN_FILES = fileURLToPath(new URL("../../../kernel/test/fixtures/loomwright-run-files/", import.meta.url));

/** A recorded run file's text: the scenario folder's file whose first line is the run title (a sidecar has none). */
function recorded(scenario: "live" | "parked"): string {
  const dir = join(RUN_FILES, scenario);
  for (const name of readdirSync(dir).sort()) {
    const text = readFileSync(join(dir, name), "utf8");
    if (text.startsWith("# Automate Run:")) return text;
  }
  throw new Error(`no run file in ${dir}`);
}

/** Replace every occurrence of `from` by `to`; throws when `from` is absent, so a changed fixture is noticed here. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`the recorded run file no longer holds ${JSON.stringify(from)}`);
  return text.split(from).join(to);
}

/** What a run file is in: running (no PR yet), paused awaiting the merge, or done after Loomwright's gate merged. */
export type RunState = "live" | "parked" | "merged";

export interface RunFileInput {
  readonly id: string;
  readonly state: RunState;
  /** The requirement item the run is on, relative to the checkout (`.supervisor/requirements/studio/<file>.md`). */
  readonly item: string;
  readonly pr: number;
  readonly head: string;
  readonly readyAt: string;
}

/** Writes `<checkout>/.supervisor/automate/<id>.md` from the recorded fixture of its state. Returns the path. */
export function writeRunFile(checkout: string, run: RunFileInput): string {
  let text: string;
  if (run.state === "live") {
    text = swap(recorded("live"), "2026-11-09-100000-stories", run.id);
    text = swap(text, "stories/01-add-greeting.md", run.item);
  } else {
    text = swap(recorded("parked"), "2026-11-08-072502-stories", run.id);
    text = swap(text, "stories/02-add-farewell.md", run.item);
    text = swap(text, "https://github.com/o/r/pull/7", `https://github.com/${REPO}/pull/${run.pr}`);
    text = swap(text, "feature/add-farewell", `feature/pr-${run.pr}`);
    text = swap(text, "a".repeat(40), run.head);
    text = swap(text, "2026-11-08T07:36:18Z", run.readyAt);
    if (run.state === "merged") {
      // After `--merge-parked`: the run is done, its item done, and the READY line is kept (the kernel reads it to tell the gate merged it).
      text = swap(text, "## Status: paused", "## Status: done");
      text = swap(text, "status: awaiting_merge | pr:", "status: done | pr:");
      text = swap(text, "- pause_reason: awaiting_merge", "- pause_reason: null");
    }
  }
  const dir = join(checkout, ".supervisor", "automate");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${run.id}.md`);
  writeFileSync(file, text);
  return file;
}

/** The crew member's checkout skeleton: a `.git/config` with one `origin` remote (all the kernel reads of a clone). */
export function makeSandboxCheckout(dir: string): string {
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/${REPO}.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  return dir;
}

// ---- The stand-in sessions ----------------------------------------------------------------------------

export type SdkMessage = Parameters<FakeCall["stream"]["push"]>[0];
export const sdk = (m: Record<string, unknown>): SdkMessage => m as unknown as SdkMessage;
export const success = (text: string): SdkMessage => sdk({ type: "result", subtype: "success", is_error: false, result: text, modelUsage: {} });
export const said = (text: string): SdkMessage =>
  sdk({ type: "assistant", parent_tool_use_id: null, session_id: "s", message: { role: "assistant", content: [{ type: "text", text }] } });

/** What one stand-in session does after its `system/init`. `prompt` is what the kernel told it (JSON text of its first message). */
export type Driver = (call: FakeCall, prompt: string) => Promise<void>;

/** One stand-in waiting for its session: the first unused slot of the session's model whose `when` matches its prompt gets it. */
interface Slot {
  readonly label: string;
  readonly model: string;
  readonly when: RegExp | undefined;
  readonly run: Driver;
  used: boolean;
}

/**
 * The fake sessions with a list of stand-in slots. A session no slot matches is a failure (it ends at once, so nothing waits
 * on it). `calls` are the fake spawner's launches; `failures` hold every driver error and unmatched session.
 */
export function standIns(schedule: (fn: () => void, ms: number) => () => void) {
  const slots: Slot[] = [];
  const failures: unknown[] = [];
  const started: { readonly label: string; readonly model: string; readonly call: FakeCall }[] = [];
  const prompts = new WeakMap<object, Promise<string>>();
  const fakes = fakeSessions({
    script: (call) => {
      call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
      const first = prompts.get(call.options) ?? Promise.resolve("");
      void first.then(async (prompt) => {
        const model = call.options.model;
        const slot = slots.find((s) => !s.used && s.model === model && (s.when === undefined || s.when.test(prompt)));
        if (slot === undefined) {
          failures.push(new Error(`a session on ${String(model)} started with no stand-in waiting for it: ${prompt.slice(0, 240)}`));
          call.stream.push(success("unexpected"));
          call.stream.end();
          return;
        }
        slot.used = true;
        started.push({ label: slot.label, model: slot.model, call });
        try {
          await slot.run(call, prompt);
        } catch (err) {
          failures.push(new Error(`stand-in ${slot.label}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
          call.stream.end();
        }
      });
    },
  });
  // The prompt is the first message the manager pushes right after it creates the query; tee it so a stand-in can read what it was told.
  const baseQuery = fakes.deps.query as QueryFn;
  const query: QueryFn = (args) => {
    let settle!: (text: string) => void;
    const first = new Promise<string>((resolve) => {
      settle = resolve;
    });
    prompts.set(args.options as object, first);
    async function* tee(): AsyncGenerator<Parameters<QueryFn>[0]["prompt"] extends AsyncIterable<infer M> ? M : never> {
      let seen = false;
      for await (const message of args.prompt) {
        if (!seen) {
          seen = true;
          settle(JSON.stringify(message));
        }
        yield message;
      }
      if (!seen) settle("");
    }
    return baseQuery({ ...args, prompt: tee() });
  };
  return {
    fakes,
    deps: { ...fakes.deps, query, schedule },
    failures,
    started,
    /** Readies a stand-in for the next session on `model` whose prompt matches `when` (the first unused slot takes it); `run` is what it does. */
    ready(label: string, model: string, run: Driver, when?: RegExp): void {
      slots.push({ label, model, when, run, used: false });
    },
    /** The labels of the slots no session has taken yet. */
    unused(): string[] {
      return slots.filter((s) => !s.used).map((s) => s.label);
    },
  };
}

interface RegisteredTool {
  handler(args: unknown, extra: unknown): Promise<{ readonly isError?: boolean; readonly content: readonly { readonly text?: string }[] }>;
}

/** What a tool answered: its text, and whether it refused. */
export interface ToolAnswer {
  readonly isError: boolean;
  readonly text: string;
}

/** Call a tool on `call`'s kernel MCP server, as the session would. */
export async function tool(call: FakeCall, name: string, args: unknown): Promise<ToolAnswer> {
  const server = (call.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  const t = (server?.instance as { _registeredTools: Record<string, RegisteredTool> } | undefined)?._registeredTools[name];
  if (t === undefined) throw new Error(`no tool ${name} on the kernel server`);
  const r = await t.handler(args, {});
  return { isError: r.isError === true, text: r.content[0]?.text ?? "" };
}

/** A tool answer's JSON value; throws on a refusal. */
export function json<T = Record<string, unknown>>(r: ToolAnswer): T {
  if (r.isError) throw new Error(`the kernel refused: ${r.text}`);
  return JSON.parse(r.text) as T;
}

export interface Decision {
  readonly permissionDecision: string;
  readonly permissionDecisionReason: string;
}
type PreToolUseHook = (input: unknown, toolUseId: string, options: { signal: AbortSignal }) => Promise<unknown>;

let toolUses = 0;

/** `call`'s PreToolUse gate, called as the CLI would from the session's working directory. */
export function gate(call: FakeCall, toolName: string, toolInput: unknown): Promise<Decision> {
  const id = `toolu_${++toolUses}`;
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as unknown as PreToolUseHook;
  const input = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: id, session_id: "s", transcript_path: "/dev/null", cwd: call.options.cwd };
  return hook(input, id, { signal: new AbortController().signal }).then((r) => (r as { hookSpecificOutput: Decision }).hookSpecificOutput);
}

/** Reply `text` and end the session. */
export function finish(call: FakeCall, text: string): void {
  call.stream.push(success(text));
  call.stream.end();
}
