// Phase 8 exit check, the app half (item 14): acceptance test 2, "tickets become PRs through Loomwright's
// /automate; comments are triaged, a reviewer is re-requested, each merge goes through Loomwright's gate under its
// repo's policy", walked in the built app against a REAL in-process kernel and fakes, and nowhere else.
//
//   a. One GitHub issue (#11) and one ClickUp task (cu-1) become two ticket tasks, each linked to its own pull
//      request in `pr_tracks`: PR A #21 and PR B #22. The ticket playbook's session hands each ticket over
//      (`kernel_automate_prepare`) and ends; the KERNEL then starts the `/automate` stand-in run session (D44), which opens
//      the PR and parks it. The crew member's `tool_policy` is drafted from the shipped catalogue (`crewCharter`,
//      `allowedToolsForJobs`): kernel tools only, no `Read`, `Skill` or Bash prefix.
//   b. Three comments on PR A are triaged by the triage playbook's own stand-in sessions. PR A is a parked
//      /automate item, so `kernel_pr_route` answers `automate_fix` with `/loomwright:review-pr <pr url>`. The drafted crew
//      policy holds no `Skill`, so the session cannot run it (D44 names this path as open); it is not a second drain either
//      way. The question gets an answer (`createPullComment`) and the remark
//      a reply (`replyToReviewComment`), both held and sent only after the owner allows them in Approvals.
//   c. The owner is re-requested as the reviewer (`requestReviewers`), held and allowed the same way.
//   d. PR A merges under Solo through the merge-when-ready playbook (`kernel_automate_merge_check` answers `go`);
//      PR B merges under Approve in Studio after the owner allows its merge card for PR B's head in the app. Both end
//      with `pr_tracks.merged_by_gate = 1`, and the fake GitHub records no merge call from the kernel.
//   e. A `gh pr merge` in each kernel-started run session is denied `merge_blocked`, as its recorded `tool_decision`
//      shows; the crew session, drafted without a Bash grant, is denied its own attempt by the policy.
//   f. The Tasks screen shows each ticket's PR, approvals and CI at each step.
//
// Every step's effect is asserted from the kernel's own store (rows, events, decisions) and the fake GitHub's
// recorded calls; the screen is read besides, never instead. The owner's clicks are the app's: the repo policy is
// accepted and changed in Integrations, the held calls are allowed in Approvals, and PR B's merge card is opened
// from the Tasks card that waits on the owner. The playbooks, the crew member and the connector rows are seeded
// in the store (the setup the live run's runbook has the owner click through), and the merge-when-ready playbook is
// run from its own `POST /playbooks/:id/run`, the route Run now uses.
//
// The kernel is `startKernel` IN THIS PLAYWRIGHT WORKER over the contributions `./fixtures/phase-8-exit.ts` composes
// from the shipped factories over the fakes (GitHub, a ClickUp MCP server on 127.0.0.1, stand-in sessions, one
// clock): no real Keychain, GitHub, ClickUp or model is reached. The API token comes from an injected in-memory
// keychain and the app gets it through `STUDIO_APP_FIXTURE_TOKEN` (honoured unpackaged only); `STUDIO_DATA_DIR` points
// the app at the kernel's data dir. The app starts only through `launchApp` (`e2e/electron-harness.ts`), and no
// screenshot is taken: this spec writes nothing under `docs/evidence/`.
//
// One clock for both sides. The kernel tells time from `clock`, fixed at `START`; the app's window tells time from
// its own `Date.now()` (the Tasks board's "Done today" filter, every "today 14:10" fact). The window's clock is
// pinned to the same instant (`syncAppClock`) and moved with every `step`, so the walk does not depend on the
// real date: before this, it passed only on START's calendar day.
//
// The live half (the real App, ClickUp, a real model on studio-sandbox) is the owner's run:
// `kernel/test/phase-8-exit-live.test.ts` and `docs/evidence/phase-8-exit-runbook.md`.
//
// Run `npm run build` (and `cd ../kernel && npm ci`) first; then `npx playwright test e2e/phase-8-exit.spec.ts`.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { createAgent, getAgent } from "../../kernel/src/agents/index.js";
import type { AuthProvider } from "../../kernel/src/auth/index.js";
import { startKernel } from "../../kernel/src/kernel.js";
import type { Kernel, KernelDeps } from "../../kernel/src/kernel.js";
import { readRunState, summarizeRuns } from "../../kernel/src/automate/run-state.js";
import { itemFileName } from "../../kernel/src/automate/tickets-to-items.js";
import { enqueueEvent } from "../../kernel/src/loop/queue.js";
import { createPlaybook, getPlaybook, linkedTriggerOf } from "../../kernel/src/playbooks/store.js";
import { fetchPollItems } from "../../kernel/src/triggers/index.js";
import type { Store } from "../../kernel/src/store/index.js";
import { events } from "../../kernel/test/loop-helpers.js";
import { assertNoNotifierRefusals, installNotifierGuard } from "../../kernel/test/notifier-guard.js";
import type { FakeCall } from "../../kernel/test/session-fakes.js";
import { flush, makePluginDir, stubProvider } from "../../kernel/test/session-fakes.js";
import { launchApp, processEnv } from "./electron-harness";
import {
  ANSWER_TEXT,
  CLICKUP_LIST_TOOL,
  CLICKUP_REF,
  CLICKUP_TASK,
  CLICKUP_TASK_BODY,
  CLICKUP_TASK_ROW,
  COMMENT_FIX,
  COMMENT_QUESTION,
  COMMENT_REMARK,
  CREW,
  CREW_MODEL,
  HEAD_A,
  HEAD_B,
  ISSUE_NUMBER,
  ISSUE_REF,
  K,
  MERGE_MODEL,
  OWNER,
  POLL_SECONDS,
  PR_A,
  PR_B,
  READY_AT_A,
  READY_AT_B,
  REPLY_TEXT,
  REPO,
  SandboxGitHub,
  START,
  STEP_MS,
  TICKETS_MODEL,
  TRIAGE_MODEL,
  URL_A,
  URL_B,
  crewCharter,
  exitContributions,
  finish,
  gate,
  json,
  makeSandboxCheckout,
  memoryKeychain,
  mergeState,
  mutableClock,
  standIns,
  startClickup,
  tool,
  writeRunFile,
  writeWrightSettings,
} from "./fixtures/phase-8-exit";
import type { Clickup, Decision, Driver } from "./fixtures/phase-8-exit";

const API_TOKEN_SERVICE = "loomwright-studio-api";
const WAIT = { timeout: 30_000 };
/** The owner's dedupe key for the polled playbooks: an item runs once per revision (the kernel adds none of its own). */
const ITEM_KEY = ["playbook.id", "item.id", "item.revision"];
/** The run ids the stand-in /automate gives its two runs. */
const RUN_A = "2026-11-09-091000-tickets";
const RUN_B = "2026-11-09-092000-tickets";
/** The prompt of a kernel-started `/automate` run session (it runs on the ticket playbook's model, as the ticket's session does). */
const RUN_PROMPT = /\/loomwright:automate --backlog /;
const SHA_A = { pr: PR_A, head: HEAD_A, readyAt: READY_AT_A } as const;
const SHA_B = { pr: PR_B, head: HEAD_B, readyAt: READY_AT_B } as const;

/** A comment on PR A as a poll item names it. */
const commentRef = (c: { readonly kind: string; readonly id: number }): string => `github:${REPO}#${PR_A}:${c.kind}:${c.id}`;

/** The call each held tool is made with: the repeat after the owner's allow is exactly this input. */
const ANSWER = { repo: REPO, pr: PR_A, body: ANSWER_TEXT };
const REPLY = { repo: REPO, pr: PR_A, comment_id: COMMENT_REMARK.id, body: REPLY_TEXT };
const REREQUEST = { repo: REPO, pr: PR_A, reviewers: [OWNER] };
const MERGE_ASK = { repo: REPO, pr: PR_B, head_sha: HEAD_B, ci: "green", ready_at: READY_AT_B, policy: "Approve in Studio" };

/** The Integrations screen's test ids (`INTEGRATIONS_TEST_IDS` in `src/screens/integrations/model.ts`); the walk checks each against that file's source. */
const IDS = {
  rowPolicy: "integrations-row-policy",
  policyCard: "integrations-policy-card",
  policyRedetect: "integrations-policy-redetect",
  policyProposal: "integrations-policy-proposal",
  policyAccept: "integrations-policy-accept",
  policyChange: "integrations-policy-change",
  policyPreset: "integrations-policy-preset",
  policySet: "integrations-policy-set",
  policyCurrent: "integrations-policy-current",
} as const;
const MODEL_SOURCE = new URL("../src/screens/integrations/model.ts", import.meta.url);

let tmp: string | undefined;
let kernel: Kernel | undefined;
let app: ElectronApplication | undefined;
let clickup: Clickup | undefined;
const pageErrors: string[] = [];

/** On a failure only: what the kernel holds, so a red run says where the walk stopped. */
function diagnose(store: Store): string {
  const rows = (sql: string): string => JSON.stringify(store.prepare<[], unknown>(sql).all());
  return [
    `playbook_runs ${rows("SELECT id, playbook, kind, status, session_id, item_ref FROM playbook_runs ORDER BY id")}`,
    `triggers ${rows("SELECT id, kind, enabled, next_fire_at, last_result FROM triggers ORDER BY id")}`,
    `event_queue ${rows("SELECT id, kind, status, source_ref FROM event_queue ORDER BY id")}`,
    `approvals ${rows("SELECT id, action, status, decision FROM approvals ORDER BY id")}`,
    `last events ${rows("SELECT id, kind, session_id, substr(payload_json, 1, 160) AS p FROM events ORDER BY id DESC LIMIT 25")}`,
  ].join("\n");
}

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && kernel !== undefined && kernel.store.isOpen) console.log(diagnose(kernel.store));
  await app?.close();
  app = undefined;
  await kernel?.stop();
  kernel = undefined;
  await clickup?.close();
  clickup = undefined;
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  // After the test: a real notifier refused anywhere in the walk fails it here.
  assertNoNotifierRefusals();
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

// ---- Reading the store ---------------------------------------------------------------------------

interface TaskRow {
  readonly id: number;
  readonly title: string;
  readonly kind: string;
  readonly state: string;
  readonly assignee_agent: string | null;
  readonly links_json: string | null;
  readonly dedupe_key: string | null;
}
const ticketTasks = (store: Store): TaskRow[] =>
  store.prepare<[], TaskRow>("SELECT id, title, kind, state, assignee_agent, links_json, dedupe_key FROM tasks WHERE kind = 'ticket_pr' ORDER BY id").all();

interface TrackRow {
  readonly repo: string;
  readonly number: number;
  readonly head_sha: string | null;
  readonly state: string;
  readonly ticket_ref: string | null;
  readonly approvals: number;
  readonly ci_state: string | null;
  readonly owner_kind: string | null;
  readonly run_file: string | null;
  readonly item_id: string | null;
  readonly merged_by_gate: number;
}
const trackRows = (store: Store): TrackRow[] =>
  store
    .prepare<[], TrackRow>("SELECT repo, number, head_sha, state, ticket_ref, approvals, ci_state, owner_kind, run_file, item_id, merged_by_gate FROM pr_tracks ORDER BY number")
    .all();
const trackOf = (store: Store, number: number): TrackRow | undefined => trackRows(store).find((t) => t.number === number);

interface RunRow {
  readonly id: number;
  readonly playbook: number;
  readonly kind: string;
  readonly status: string;
  readonly session_id: number | null;
  readonly item_ref: string | null;
}
const runRows = (store: Store, playbook: number): RunRow[] =>
  store.prepare<[number], RunRow>("SELECT id, playbook, kind, status, session_id, item_ref FROM playbook_runs WHERE playbook = ? ORDER BY id").all(playbook);
/** The runs of `playbook` that started a session (a duplicate item is skipped with none). */
const sessionRuns = (store: Store, playbook: number): RunRow[] => runRows(store, playbook).filter((r) => r.session_id !== null);

interface ApprovalRow {
  readonly id: number;
  readonly action: string;
  readonly status: string;
  readonly decision: string | null;
  readonly requesting_agent: string;
  readonly requesting_session: number | null;
}
const approvalRows = (store: Store): ApprovalRow[] =>
  store.prepare<[], ApprovalRow>("SELECT id, action, status, decision, requesting_agent, requesting_session FROM approvals ORDER BY id").all();
const approvalOf = (store: Store, action: string): ApprovalRow | undefined => approvalRows(store).find((a) => a.action === action);

interface PolicyRow {
  readonly policy_kind: string;
  readonly set_by: string | null;
  readonly detected_json: string | null;
}
const policyRow = (store: Store): PolicyRow | undefined =>
  store.prepare<[string], PolicyRow>("SELECT policy_kind, set_by, detected_json FROM repo_policies WHERE repo = ?").get(REPO);

/** The `tool_decision` events of `session`, as {tool, decision, reason, command}. */
/** The sessions of playbook `id`, oldest first: who ran them, on which model, and how they ended. */
function playbookSessions(store: Store, id: number): { agent: string; model: string; status: string }[] {
  return store.prepare<[number], { agent: string; model: string; status: string }>("SELECT agent, model, status FROM sessions WHERE playbook = ? ORDER BY id").all(id);
}

function decisionsOf(store: Store, session: number): { tool: unknown; decision: unknown; reason: unknown; command: unknown }[] {
  return events(store, "tool_decision")
    .filter((e) => e.session_id === session)
    .map((e) => ({ tool: e.payload.tool, decision: e.payload.decision, reason: e.payload.reason, command: e.payload.command }));
}

// ---- Driving the app -----------------------------------------------------------------------------

const sidebar = (page: Page): Locator => page.getByTestId("sidebar");

async function openScreen(page: Page, name: "Integrations" | "Approvals" | "Tasks"): Promise<void> {
  await sidebar(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByTestId(`screen-${name.toLowerCase()}`)).toBeVisible();
}

/** Opens Tasks freshly read from the kernel (a reload, so the board is the kernel's answer now and not a refetch still in flight). */
async function showTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/tasks";
  });
  await page.reload();
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated", WAIT);
}

const card = (page: Page, task: number): Locator => page.getByTestId(`task-card-task:${task}`);

/** The text and tone of one badge on a ticket card: `testid` is `task-card-state`, `ticket-approvals` or `ticket-ci`. */
async function pill(page: Page, task: number, testid: "task-card-state" | "ticket-approvals" | "ticket-ci"): Promise<readonly [string | null, string | null]> {
  const badge = card(page, task).getByTestId(testid).locator(".badge");
  return [await badge.textContent(), await badge.getAttribute("data-tone")];
}

interface CardWant {
  readonly line: string;
  readonly state: readonly [string, string];
  readonly approvals: readonly [string, string];
  readonly ci: readonly [string, string];
  readonly owner: RegExp;
  readonly column: "wait" | "work" | "park" | "done";
}

/** One ticket card as the Tasks screen draws it: its ticket and PR, state, approvals, CI, owner and the column it sits in. */
async function expectCard(page: Page, task: number, want: CardWant): Promise<void> {
  await expect(card(page, task)).toBeVisible(WAIT);
  await expect(card(page, task).locator(".ticket-kind")).toHaveText(want.line);
  await expect(card(page, task)).toHaveAttribute("data-column", want.column);
  expect(await pill(page, task, "task-card-state"), `task ${task} state`).toEqual(want.state);
  expect(await pill(page, task, "ticket-approvals"), `task ${task} approvals`).toEqual(want.approvals);
  expect(await pill(page, task, "ticket-ci"), `task ${task} CI`).toEqual(want.ci);
  await expect(card(page, task).getByTestId("ticket-owner")).toHaveText(want.owner);
}

/** Select approval `id` in the Approvals inbox by clicking its row. */
async function selectApproval(page: Page, id: number): Promise<void> {
  await openScreen(page, "Approvals");
  await page.getByRole("listbox", { name: "Approvals, pending first" }).locator(`[role="option"][data-key="${id}"]`).click();
  await expect(page.getByTestId("approval-detail")).toHaveAttribute("data-approval-id", String(id));
}

/** Allow approval `id` once, from its detail in Approvals. */
async function allowOnce(page: Page, id: number): Promise<void> {
  await selectApproval(page, id);
  await page.getByRole("button", { name: /^Allow once/ }).click();
  await expect(page.getByTestId("approval-outcome")).toContainText("Allowed once by owner");
}

// ---- The stand-in sessions' steps ---------------------------------------------------------------

/** An ordinary kernel tool through the session's gate (it must be allowed), then its handler. */
async function use<T = Record<string, unknown>>(call: FakeCall, name: string, args: unknown): Promise<T> {
  const d = await gate(call, `${K}${name}`, args);
  if (d.permissionDecision !== "allow") throw new Error(`the rail refused ${name}: ${d.permissionDecisionReason}`);
  return json<T>(await tool(call, name, args));
}

/** An outward kernel tool through the gate: it is held as an approval and does not run. Answers the approval's id. */
async function hold(call: FakeCall, name: string, args: unknown): Promise<number> {
  const d = await gate(call, `${K}${name}`, args);
  const held = /^approval_required: held as approval (\d+);/.exec(d.permissionDecisionReason);
  if (d.permissionDecision !== "deny" || held === null) throw new Error(`${name} was not held: ${d.permissionDecision} ${d.permissionDecisionReason}`);
  return Number(held[1]);
}

/** The same call again after the owner's allow: the gate spends the one-shot grant, then the tool runs. */
async function repeat(call: FakeCall, name: string, args: unknown): Promise<string> {
  const d = await gate(call, `${K}${name}`, args);
  if (d.permissionDecision !== "allow" || d.permissionDecisionReason !== "approval_granted") throw new Error(`the repeated ${name} was not granted: ${d.permissionDecision} ${d.permissionDecisionReason}`);
  const r = await tool(call, name, args);
  if (r.isError) throw new Error(`the repeated ${name} was refused: ${r.text}`);
  return r.text;
}

interface TicketHandover {
  readonly ref: string;
  readonly title: string;
  readonly link: string;
  readonly body: string;
}
interface AutomateRun {
  readonly id: string;
  readonly pr: number;
  readonly head: string;
  readonly readyAt: string;
}

/** What each stand-in saw and was told, kept for the assertions after it (the kernel's store holds the effects; these are the answers). */
interface Seen {
  /** What the ticket's session saw and was told: `kernel_automate_state` before the handover, and prepare's answer (`run`, `invocation`). */
  readonly handovers: { ref: string; before: string; run: string; invocation: string }[];
  /** The kernel-started /automate run sessions: its prompt, and the run state when it started, while it worked and after it parked the PR. */
  readonly runs: { ref: string; prompt: string; started: string; during: string; after: string; mergeAttempt: Decision }[];
  /** What the fix session was refused when it tried the routed command (its drafted policy holds no `Skill`). */
  readonly refused: { tool: string; decision: string; reason: string }[];
  readonly routes: Record<string, unknown>[];
  /** The slash commands the fix session ran. */
  readonly ran: string[];
  readonly held: Record<string, number>;
  readonly checks: { pr: number; answer: Record<string, unknown> }[];
  readonly merges: { pr: number; invocation: string }[];
  readonly mergeAttempts: { command: string; decision: string; reason: string }[];
}

/** A ticket's session: look, then hand the ticket to /automate and end. The kernel starts the run (D44); this session runs nothing. */
function ticketDriver(seen: Seen, ticket: TicketHandover): Driver {
  return async (call) => {
    await flush(1);
    const before = await use<{ state: string }>(call, "kernel_automate_state", { repo: REPO });
    const prepared = await use<{ invocation: string; run: string }>(call, "kernel_automate_prepare", { repo: REPO, tickets: [ticket] });
    seen.handovers.push({ ref: ticket.ref, before: before.state, run: prepared.run, invocation: prepared.invocation });
    finish(call, `Handed ${ticket.ref} to /automate; the kernel starts the run.`);
  };
}

/** The run state of `checkout` as Loomwright's run files read it (`idle` | `live` | `parked` ...). */
function runStateOf(checkout: string): string {
  const read = readRunState(checkout);
  return read.ok ? summarizeRuns(read).state : "unreadable";
}

/**
 * The kernel-started `/automate` run session (stand-in): it reads its backlog, tries a `gh pr merge` (its policy allows `gh`; the rail
 * denies it `merge_blocked`), works (the run file is live), then opens the PR and parks it awaiting the merge (Loomwright's recorded run files).
 */
function automateRunDriver(seen: Seen, checkout: string, ticket: TicketHandover, run: AutomateRun): Driver {
  return async (call, prompt) => {
    await flush(1);
    const backlog = /\/loomwright:automate --backlog (\S+?) --inline-phases/.exec(prompt)?.[1];
    if (backlog === undefined) throw new Error(`the run session was started with an unexpected prompt: ${prompt}`);
    if (!readFileSync(backlog, "utf8").includes(`/${itemFileName(ticket.ref)}`)) throw new Error(`the run session's backlog lists no item for ${ticket.ref}`);
    const item = `.supervisor/requirements/studio/${itemFileName(ticket.ref)}`;
    const started = runStateOf(checkout);
    const mergeAttempt = await gate(call, "Bash", { command: `gh pr merge ${run.pr} --squash --delete-branch` });
    writeRunFile(checkout, { id: run.id, state: "live", item, pr: run.pr, head: run.head, readyAt: run.readyAt });
    const during = runStateOf(checkout);
    writeRunFile(checkout, { id: run.id, state: "parked", item, pr: run.pr, head: run.head, readyAt: run.readyAt });
    seen.runs.push({ ref: ticket.ref, prompt, started, during, after: runStateOf(checkout), mergeAttempt });
    finish(call, `Opened PR ${run.pr} for ${ticket.ref} and parked it awaiting the merge.`);
  };
}

// ---- The test ---------------------------------------------------------------------------------------

test("phase 8 exit: tickets become PRs, comments are triaged, the owner is re-requested and each merge goes through Loomwright's gate, in the app against a real kernel", async () => {
  test.setTimeout(420_000);
  installNotifierGuard();

  tmp = mkdtempSync(join(tmpdir(), "studio-phase8-exit-"));
  const dataDir = join(tmp, "data");
  const home = join(tmp, "home");
  mkdirSync(home);
  const checkout = makeSandboxCheckout(join(tmp, "work", "studio-sandbox"));
  writeWrightSettings(dataDir);
  const clock = mutableClock(START);
  const keychain = memoryKeychain();
  const github = new SandboxGitHub();
  clickup = await startClickup(clock);
  const s = standIns((fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  const deps: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: { ...s.deps, homeDir: home },
    selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
    availableProviderIds: async () => ["api-key"],
    now: clock.now,
    loopDeps: { tickMs: 10, now: clock.now },
    githubClient: github,
  };
  // `startKernel` wires no token minter (a live, write-granted session is refused `github_token_unavailable` without one); the session
  // manager takes it as an option, which `options.sessions` spreads into. A fixture minter stands in for the App's: no token is real.
  const sessionOptions = {
    loomwrightPath: makePluginDir(tmp),
    stopGraceMs: 150,
    sessionTokenMint: () => ({ ok: true as const, token: "ghs_fixture_session_token_0001", expires_at: "2030-01-01T00:00:00.000Z" }),
  };
  kernel = await startKernel(
    { dataDir, env: { PATH: "/usr/bin" }, sessions: sessionOptions, contributions: exitContributions({ github, reader: clickup.reader, clock }) },
    deps,
  );
  const store = kernel.store;
  const token = keychain.items.get(API_TOKEN_SERVICE) as string;
  expect(token).toMatch(/^[0-9a-f]{64}$/);

  /** The kernel's loopback API as the app calls it: the owner's token. */
  async function api(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`http://127.0.0.1:${(kernel as Kernel).api.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const noFailures = (): void => expect(s.failures).toEqual([]);
  /** Moves the clock one step: every poll that is due fires once, and the PR tracker follows each fire. */
  // Assigned once the app is launched; every step runs after that.
  let syncAppClock = async (): Promise<void> => {};
  const step = async (): Promise<void> => {
    clock.advance(STEP_MS);
    await syncAppClock();
  };
  const seen: Seen = { handovers: [], runs: [], refused: [], routes: [], ran: [], held: {}, checks: [], merges: [], mergeAttempts: [] };

  // ---- 0. Setup: what the live run's runbook has the owner click through before the walk ----
  // GitHub is connected (the connector row the App's connect writes) and reaches the sandbox repo; ClickUp is signed in against the fake server.
  store
    .prepare("INSERT INTO connectors (kind, status, account_login, permissions_json, reachable_repos_json, verified_at) VALUES ('github', 'connected', ?, ?, ?, ?)")
    .run(OWNER, JSON.stringify({ metadata: "read", pull_requests: "write", issues: "write", contents: "read" }), JSON.stringify([REPO]), clock.now().toISOString());
  await clickup.connect(store, clock);
  expect(store.prepare<[], { kind: string; status: string }>("SELECT kind, status FROM mcp_connections").all()).toEqual([{ kind: "clickup", status: "connected" }]);
  // One crew member from a charter, with the GitHub write grant and the ClickUp read tool.
  const created = createAgent(store, dataDir, crewCharter(checkout), { by: "owner", homeDir: home }, clock.now());
  expect(created.ok ? "" : created.message).toBe("");
  expect((await api("POST", `/agents/${CREW}/set`, { field: "connectors", value: "github:write" })).status).toBe(200);
  expect((await api("POST", `/agents/${CREW}/set`, { field: "connectors", value: `clickup:${CLICKUP_LIST_TOOL}` })).status).toBe(200);
  expect(getAgent(store, CREW)).toMatchObject({ status: "active", created_by: "owner" });

  app = await launchApp({ ...processEnv(), STUDIO_DATA_DIR: dataDir, STUDIO_APP_FIXTURE_TOKEN: token });
  const launched = app;
  const page = await launched.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // The window reads the kernel's time, not the wall clock's: `setFixedTime` fakes `Date` only, so the app's own timers keep running.
  syncAppClock = async (): Promise<void> => {
    await launched.context().clock.setFixedTime(clock.now());
    expect(await page.evaluate(() => Date.now()), "the app window's clock follows the kernel's").toBe(clock.now().getTime());
  };
  await syncAppClock();
  await expect(sidebar(page)).toBeVisible();
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);

  // The ids this walk targets are the ones the Integrations screen defines.
  const defined = new Set([...readFileSync(MODEL_SOURCE, "utf8").matchAll(/^\s+\w+: "([^"]+)",?$/gm)].map((match) => match[1]));
  expect(Object.values(IDS).filter((id) => !defined.has(id)), "ids this spec uses that model.ts does not define").toEqual([]);

  // The owner reads the repo's detected state and accepts the proposed policy: Solo. A proposal is never applied by itself.
  await openScreen(page, "Integrations");
  await page.getByTestId(IDS.rowPolicy).click();
  await expect(page.getByTestId(IDS.policyCard)).toHaveAttribute("data-repo", REPO);
  await page.getByTestId(IDS.policyRedetect).click();
  await expect(page.getByTestId(IDS.policyProposal)).toHaveAttribute("data-kind", "solo", WAIT);
  expect(policyRow(store)).toMatchObject({ policy_kind: "unset", set_by: null });
  expect(JSON.parse(policyRow(store)?.detected_json ?? "null")).toMatchObject({ repo: REPO, protection: "protected", required_reviews: null, required_checks: ["ci"], pushers: [OWNER], private: false });
  expect(github.callsTo("getBranchProtection").map((c) => c.args)).toEqual([[REPO, "main"]]);
  await page.getByTestId(IDS.policyAccept).click();
  await expect(page.getByTestId(IDS.policyCard)).toHaveAttribute("data-state", "set", WAIT);
  expect(policyRow(store)).toMatchObject({ policy_kind: "solo", set_by: "owner" });

  /** A playbook of the crew member, enabled and live: what the owner's `set mode live` leaves after the dry run and the held enable. */
  function playbook(name: string, intent: string, trigger: { kind: string; spec: string }, model: string, dedupe: readonly string[] | undefined, targetRepo?: string): number {
    const change = createPlaybook(store, { agent: CREW, name, intent, trigger, model, ...(dedupe === undefined ? {} : { dedupe_key: dedupe }), ...(targetRepo === undefined ? {} : { target_repo: targetRepo }) }, clock.now());
    store.prepare("UPDATE playbooks SET status = 'enabled', mode = 'live', mode_set_by = 'owner' WHERE id = ?").run(change.playbook.id);
    return change.playbook.id;
  }
  /** Waits until every run of `playbook` that started a session has ended `done`, `count` of them in all. */
  const sessionsDone = (id: number, count: number) =>
    expect.poll(() => sessionRuns(store, id).map((r) => r.status), WAIT).toEqual(Array.from({ length: count }, () => "done"));

  // ---- 1. (a) A GitHub issue becomes PR A: the tickets playbook polls issues, its session hands the ticket to /automate ----
  const ISSUE_TICKET: TicketHandover = { ref: ISSUE_REF, title: "Add a ping command", link: `https://github.com/${REPO}/issues/${ISSUE_NUMBER}`, body: "Add `studio ping`: it prints pong and exits 0." };
  const CLICKUP_TICKET: TicketHandover = { ref: CLICKUP_REF, title: CLICKUP_TASK_ROW.name, link: CLICKUP_TASK_ROW.url, body: CLICKUP_TASK_BODY };
  const issues = playbook(
    "Tickets: GitHub issues",
    "Hand each open issue on studio-sandbox to /automate and follow its pull request.",
    { kind: "poll", spec: JSON.stringify({ source: "github.issues", repos: [REPO], filters: {}, interval_seconds: POLL_SECONDS }) },
    TICKETS_MODEL,
    ITEM_KEY,
  );
  s.ready("issue #11 to /automate", TICKETS_MODEL, ticketDriver(seen, ISSUE_TICKET), new RegExp(ISSUE_REF));
  s.ready("kernel-started /automate run: issue #11", TICKETS_MODEL, automateRunDriver(seen, checkout, ISSUE_TICKET, { id: RUN_A, ...SHA_A }), RUN_PROMPT);
  await step();
  await sessionsDone(issues, 1);
  // The ticket session ended after the handover; the kernel starts the run from the event prepare queued, and the run parks PR A.
  await expect.poll(() => seen.runs.length, WAIT).toBe(1);
  noFailures();
  // The poll queued the issue as its own run of the playbook, and its session handed it over: the state it saw is idle, then live, then parked.
  expect(sessionRuns(store, issues)).toEqual([expect.objectContaining({ item_ref: ISSUE_REF, kind: "fire", status: "done" })]);
  expect(seen.handovers).toEqual([expect.objectContaining({ ref: ISSUE_REF, before: "idle", run: "started_by_kernel" })]);
  expect(seen.handovers[0]?.invocation).toMatch(/^\/automate --backlog \S+_BACKLOG\.md --inline-phases$/);
  // The run session: Loomwright's `/loomwright:automate` over the backlog, safe mode; it started with no run live, worked (live), and parked.
  expect(seen.runs).toEqual([expect.objectContaining({ ref: ISSUE_REF, started: "idle", during: "live", after: "parked" })]);
  expect(seen.runs[0]?.prompt).toMatch(/^\{.*"content":"\/loomwright:automate --backlog \S+_BACKLOG\.md --inline-phases"/);
  expect(seen.runs[0]?.prompt).not.toMatch(/--auto-merge|--parallel/);
  // It is one more session of the ticket playbook, as the crew member, on the playbook's model: two sessions in all (the ticket's and the run's).
  expect(playbookSessions(store, issues)).toEqual([
    { agent: CREW, model: TICKETS_MODEL, status: "completed" },
    { agent: CREW, model: TICKETS_MODEL, status: "completed" },
  ]);
  // (e) its `gh pr merge` was denied `merge_blocked` by the rail.
  expect(seen.runs[0]?.mergeAttempt).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "merge_blocked" });
  expect(trackRows(store)).toEqual([]);
  // The next poll finds the issue again; the owner's key skips it (no second run), and the PR tracker follows the poll's fire and finds PR A.
  await step();
  await expect.poll(() => trackRows(store).length, WAIT).toBe(1);
  expect(sessionRuns(store, issues)).toHaveLength(1);
  await expect.poll(() => runRows(store, issues).map((r) => r.status), WAIT).toEqual(["done", "skipped_duplicate"]);

  // ---- 1b. (a) A ClickUp task becomes PR B: a second playbook polls the connected tracker ----
  // A live playbook whose agent holds `github: write` needs a GitHub token for the repos of the playbook (`playbookRepos`), and a
  // `clickup.tasks` spec names none, so the playbook carries `target_repo`: its session's token is minted for that repository. The
  // ClickUp task is read by the kernel's own poll fetch over the fake server and queued as the playbook's item, exactly as a due
  // `clickup.tasks` fire queues it.
  const tasks = playbook(
    "Tickets: ClickUp tasks",
    "Hand each ClickUp task to /automate and follow its pull request.",
    { kind: "poll", spec: JSON.stringify({ source: "clickup.tasks", filters: { list: "901" }, interval_seconds: POLL_SECONDS }) },
    TICKETS_MODEL,
    ITEM_KEY,
    REPO,
  );
  s.ready("clickup cu-1 to /automate", TICKETS_MODEL, ticketDriver(seen, CLICKUP_TICKET), new RegExp(CLICKUP_REF));
  s.ready("kernel-started /automate run: clickup cu-1", TICKETS_MODEL, automateRunDriver(seen, checkout, CLICKUP_TICKET, { id: RUN_B, ...SHA_B }), RUN_PROMPT);
  const fetched = await fetchPollItems(github, { source: "clickup.tasks", filters: { list: "901" }, interval_seconds: POLL_SECONDS }, clickup.reader, store);
  expect(fetched.ok && fetched.items.map((i) => i.ref)).toEqual([CLICKUP_REF]);
  const queuedAt = clock.now();
  const tasksRow = getPlaybook(store, tasks) as NonNullable<ReturnType<typeof getPlaybook>>;
  enqueueEvent(
    store,
    {
      kind: "message",
      payload: { agent: CREW, playbook: tasks, version: tasksRow.version, trigger_id: linkedTriggerOf(store, tasksRow)?.id, scheduled_at: queuedAt.toISOString(), item: fetched.ok ? fetched.items[0] : undefined },
      sourceRef: `playbook:${tasks}:${queuedAt.toISOString()}:${CLICKUP_REF}`,
    },
    queuedAt,
  );
  await sessionsDone(tasks, 1);
  await expect.poll(() => seen.runs.length, WAIT).toBe(2);
  noFailures();
  expect(sessionRuns(store, tasks)).toEqual([expect.objectContaining({ item_ref: CLICKUP_REF, kind: "fire", status: "done" })]);
  // The second ticket found the first run paused, not live: the single drain was free.
  expect(seen.handovers[1]).toMatchObject({ ref: CLICKUP_REF, before: "parked", run: "started_by_kernel" });
  expect(seen.runs[1]).toMatchObject({ ref: CLICKUP_REF, started: "parked", during: "live", after: "parked" });
  expect(seen.runs[1]?.mergeAttempt).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "merge_blocked" });
  expect(playbookSessions(store, tasks)).toHaveLength(2);
  // The kernel read ClickUp itself through the fake server, with the poll's filters: one listing-tool call per fire.
  const clickupCalls = clickup.mcp.mcpCalls.filter((c) => c.method === "tools/call");
  expect(clickupCalls.length).toBeGreaterThanOrEqual(1);
  expect(clickupCalls.every((c) => c.name === CLICKUP_LIST_TOOL && JSON.stringify(c.arguments) === JSON.stringify({ list_ids: ["901"] }))).toBe(true);
  await step();
  await expect.poll(() => trackRows(store).length, WAIT).toBe(2);
  noFailures();

  // (a) Two ticket tasks, each linked to its own PR in `pr_tracks`; neither merged by the gate; both parked under the owner's Solo policy.
  const [taskA, taskB] = ticketTasks(store);
  expect(ticketTasks(store)).toHaveLength(2);
  const idA = (taskA as TaskRow).id;
  const idB = (taskB as TaskRow).id;
  expect(taskA).toMatchObject({ kind: "ticket_pr", state: "parked", assignee_agent: CREW, dedupe_key: `pr:${REPO}#${PR_A}`, title: ISSUE_TICKET.title });
  expect(taskB).toMatchObject({ kind: "ticket_pr", state: "parked", assignee_agent: CREW, dedupe_key: `pr:${REPO}#${PR_B}`, title: CLICKUP_TICKET.title });
  expect(JSON.parse(taskA?.links_json ?? "{}")).toMatchObject({ ticket: ISSUE_REF, pr: { repo: REPO, number: PR_A, url: URL_A }, state: "parked", approvals: "solo", ci: "green", owner_kind: "automate_parked" });
  expect(JSON.parse(taskB?.links_json ?? "{}")).toMatchObject({ ticket: CLICKUP_REF, pr: { repo: REPO, number: PR_B, url: URL_B }, state: "parked", approvals: "solo", ci: "pending", owner_kind: "automate_parked" });
  expect(trackRows(store)).toEqual([
    { repo: REPO, number: PR_A, head_sha: HEAD_A, state: "parked", ticket_ref: ISSUE_REF, approvals: 0, ci_state: "green", owner_kind: "automate_parked", run_file: RUN_A, item_id: expect.stringMatching(/^\.supervisor\/requirements\/studio\/.+\.md$/), merged_by_gate: 0 },
    { repo: REPO, number: PR_B, head_sha: HEAD_B, state: "parked", ticket_ref: CLICKUP_REF, approvals: 0, ci_state: "pending", owner_kind: "automate_parked", run_file: RUN_B, item_id: expect.stringMatching(/^\.supervisor\/requirements\/studio\/.+\.md$/), merged_by_gate: 0 },
  ]);
  expect(events(store, "pr_state_changed").map((e) => [e.payload.pr, e.payload.from, e.payload.to, e.payload.owner_kind])).toEqual([
    [PR_A, null, "parked", "automate_parked"],
    [PR_B, null, "parked", "automate_parked"],
  ]);
  expect(events(store, "task_created").map((e) => e.task_id)).toEqual([idA, idB]);

  // (f) Tasks shows each ticket's PR, approvals and CI: PR A is green, PR B's CI is still pending, both parked under Solo.
  await showTasks(page);
  await expectCard(page, idA, { line: `Issue #${ISSUE_NUMBER}→PR #${PR_A}`, state: ["parked", "parked"], approvals: ["Solo", "neutral"], ci: ["CI green", "ok"], owner: /^Mason · parked \/automate item$/i, column: "park" });
  await expectCard(page, idB, { line: `ClickUp ${CLICKUP_TASK}→PR #${PR_B}`, state: ["parked", "parked"], approvals: ["Solo", "neutral"], ci: ["CI pending", "neutral"], owner: /^Mason · parked \/automate item$/i, column: "park" });

  // ---- 2. (b, c) The triage playbook routes PR A's three comments; the fix is the parked item's own command, never a second drain ----
  const automateFiles = (): string[] => readdirSync(join(checkout, ".supervisor", "automate")).sort();
  const filesBefore = automateFiles();
  const triage = playbook(
    "Triage PR comments",
    "Triage each comment on an open pull request on studio-sandbox as fix, reply or answer.",
    { kind: "poll", spec: JSON.stringify({ source: "github.pr_comments", repos: [REPO], interval_seconds: POLL_SECONDS }) },
    TRIAGE_MODEL,
    ITEM_KEY,
  );
  // The fix: the route is read, the parked item's command run in this same session, and the owner asked to look again (held).
  s.ready("triage: fix", TRIAGE_MODEL, async (call) => {
    await flush(1);
    const route = await use(call, "kernel_pr_route", { repo: REPO, pr: PR_A });
    seen.routes.push(route);
    const command = typeof route.command === "string" ? route.command : "";
    // The route answers Loomwright's review-pr command, which the session would run itself as the Skill. The drafted crew policy holds no
    // `Skill` (D44 names this path as open), so the call is refused by the policy and nothing is run; it starts no drain either way.
    const d = await gate(call, "Skill", { skill: "loomwright:review-pr", args: URL_A });
    seen.refused.push({ tool: "Skill", decision: d.permissionDecision, reason: d.permissionDecisionReason });
    if (d.permissionDecision === "allow") seen.ran.push(command);
    seen.held.rerequest = await hold(call, "kernel_github_pr_request_reviewers", REREQUEST);
    finish(call, "I ran /loomwright:review-pr on the parked item; my re-request for review is waiting for your approval.");
  }, new RegExp(`review_comment:${COMMENT_FIX.id}`));
  // The question gets an answer, held; the remark gets a reply, held.
  s.ready("triage: question", TRIAGE_MODEL, async (call) => {
    await flush(1);
    seen.held.answer = await hold(call, "kernel_github_pr_comment", ANSWER);
    finish(call, "My answer is waiting for your approval.");
  }, new RegExp(`issue_comment:${COMMENT_QUESTION.id}`));
  s.ready("triage: remark", TRIAGE_MODEL, async (call) => {
    await flush(1);
    seen.held.reply = await hold(call, "kernel_github_pr_reply", REPLY);
    finish(call, "My reply is waiting for your approval.");
  }, new RegExp(`review_comment:${COMMENT_REMARK.id}`));
  await step();
  await sessionsDone(triage, 3);
  noFailures();
  // Three runs, one per comment, each on its own session.
  expect(sessionRuns(store, triage).map((r) => r.item_ref).sort()).toEqual([commentRef(COMMENT_FIX), commentRef(COMMENT_QUESTION), commentRef(COMMENT_REMARK)].sort());
  // (b) PR A is a parked /automate item: the route is automate_fix with that item and the review-pr command, which the drafted policy does not let the fix session run.
  expect(seen.routes).toEqual([
    expect.objectContaining({ route: "automate_fix", repo: REPO, pr: PR_A, owner_kind: "automate_parked", command: `/loomwright:review-pr ${URL_A}`, item: expect.objectContaining({ run_id: RUN_A, status: "awaiting_merge", pr: URL_A }) }),
  ]);
  expect(seen.refused).toEqual([{ tool: "Skill", decision: "deny", reason: "tool_not_allowed" }]);
  expect(seen.ran).toEqual([]);
  // Never a second drain: the triage sessions never called the handover, and no run file was written or changed.
  const triageSessions = sessionRuns(store, triage).map((r) => r.session_id as number);
  for (const session of triageSessions) expect(decisionsOf(store, session).map((d) => String(d.tool))).not.toContain(`${K}kernel_automate_prepare`);
  expect(automateFiles()).toEqual(filesBefore);
  // The three tool calls were held as approvals; nothing reached GitHub yet.
  for (const action of ["kernel_github_pr_comment", "kernel_github_pr_reply", "kernel_github_pr_request_reviewers"]) {
    expect(approvalOf(store, action), action).toMatchObject({ status: "pending", decision: null, requesting_agent: CREW });
  }
  expect(github.callsTo("createPullComment")).toEqual([]);
  expect(github.callsTo("replyToReviewComment")).toEqual([]);
  expect(github.callsTo("requestReviewers")).toEqual([]);

  // The owner allows each in Approvals; the crew member's next session repeats the call exactly, and then GitHub's fake records it.
  const allowAndRepeat = async (action: string, label: string, run: (call: FakeCall) => Promise<void>): Promise<void> => {
    const approval = approvalOf(store, action) as ApprovalRow;
    s.ready(label, CREW_MODEL, async (call) => {
      await flush(1);
      await run(call);
      finish(call, "Done.");
    }, new RegExp(`approved approval ${approval.id}: ${action}\\.`));
    await allowOnce(page, approval.id);
    expect(approvalRows(store).find((a) => a.id === approval.id)).toMatchObject({ status: "approved", decision: "once" });
  };
  await allowAndRepeat("kernel_github_pr_comment", "repeat: answer", async (call) => void (await repeat(call, "kernel_github_pr_comment", ANSWER)));
  await expect.poll(() => github.callsTo("createPullComment").length, WAIT).toBe(1);
  await allowAndRepeat("kernel_github_pr_reply", "repeat: reply", async (call) => void (await repeat(call, "kernel_github_pr_reply", REPLY)));
  await expect.poll(() => github.callsTo("replyToReviewComment").length, WAIT).toBe(1);
  await allowAndRepeat("kernel_github_pr_request_reviewers", "repeat: re-request", async (call) => void (await repeat(call, "kernel_github_pr_request_reviewers", REREQUEST)));
  await expect.poll(() => github.callsTo("requestReviewers").length, WAIT).toBe(1);
  noFailures();
  // (b) The question's answer and the remark's reply, as the fake recorded them; the fix comment got neither.
  expect(github.callsTo("createPullComment").map((c) => c.args)).toEqual([[REPO, PR_A, ANSWER_TEXT]]);
  expect(github.callsTo("replyToReviewComment").map((c) => c.args)).toEqual([[REPO, PR_A, COMMENT_REMARK.id, REPLY_TEXT]]);
  // (c) The owner is re-requested as reviewer.
  expect(github.callsTo("requestReviewers").map((c) => c.args)).toEqual([[REPO, PR_A, [OWNER]]]);
  // Each grant was spent once: one `approval_used` per allowed call, in the repeating session.
  expect(events(store, "approval_used").map((e) => e.payload.id).sort()).toEqual([seen.held.answer, seen.held.reply, seen.held.rerequest].sort());

  // PR B's CI turns green; the next poll's fire makes the tracker read it, and Tasks shows it (CI changed, nothing else did).
  github.setMergeState(REPO, PR_B, mergeState(HEAD_B, "green"));
  await step();
  await expect.poll(() => trackOf(store, PR_B)?.ci_state, WAIT).toBe("green");
  expect(events(store, "pr_state_changed").filter((e) => e.payload.pr === PR_B).map((e) => e.payload.ci)).toEqual(["pending", "green"]);
  await showTasks(page);
  await expectCard(page, idB, { line: `ClickUp ${CLICKUP_TASK}→PR #${PR_B}`, state: ["parked", "parked"], approvals: ["Solo", "neutral"], ci: ["CI green", "ok"], owner: /^Mason · parked \/automate item$/i, column: "park" });

  // ---- 3. (d, e) PR A merges under Solo: the merge-when-ready playbook's check answers go and Loomwright's gate merges ----
  const mergeReady = playbook(
    "Merge when ready",
    "For each parked PR whose repo policy is met, ask for the merge and let Loomwright's gate merge it.",
    // Run from Run now. Its linked trigger is a poll that names the repo (and finds nothing: no issue carries the label), because a live
    // write-granted session gets its GitHub token for the repos of its playbook's linked poll spec (a GitHub poll names them).
    { kind: "poll", spec: JSON.stringify({ source: "github.issues", repos: [REPO], filters: { labels: ["merge-when-ready"] }, interval_seconds: POLL_SECONDS }) },
    MERGE_MODEL,
    undefined,
  );
  const runNow = async (): Promise<void> => {
    const res = await api("POST", `/playbooks/${mergeReady}/run`);
    expect(res.status).toBe(200);
  };
  /** The stand-in Loomwright's gate: `/loomwright:automate --merge-parked <run>` merges the PR on GitHub and finishes the run. */
  const gateMerges = (pr: number, run: AutomateRun, invocation: string): void => {
    seen.merges.push({ pr, invocation });
    const item = trackOf(store, pr)?.item_id ?? "";
    writeRunFile(checkout, { id: run.id, state: "merged", item, pr: run.pr, head: run.head, readyAt: run.readyAt });
    github.markMerged(pr);
  };
  s.ready("merge-when-ready: PR A", MERGE_MODEL, async (call) => {
    await flush(1);
    // The session tries the merge itself, as a model might. Its drafted policy holds no Bash prefix, so the policy denies it before the rail.
    const direct = `gh pr merge ${PR_A} --squash`;
    const d = await gate(call, "Bash", { command: direct });
    seen.mergeAttempts.push({ command: direct, decision: d.permissionDecision, reason: d.permissionDecisionReason });
    // The check is the way: Solo is met (CI green at the READY head), nothing is live, and the item is parked awaiting the merge.
    const answer = await use(call, "kernel_automate_merge_check", { repo: REPO, pr: PR_A });
    seen.checks.push({ pr: PR_A, answer });
    if (answer.answer === "go" && typeof answer.invocation === "string") gateMerges(PR_A, { id: RUN_A, ...SHA_A }, answer.invocation);
    finish(call, `merge check for PR ${PR_A}: ${String(answer.answer)}`);
  });
  await runNow();
  await expect.poll(() => sessionRuns(store, mergeReady).map((r) => r.status), WAIT).toEqual(["done"]);
  noFailures();
  // (e) The crew session's direct `gh pr merge` was denied (no Bash grant), and its recorded decision says so; the run sessions' were merge_blocked.
  expect(seen.mergeAttempts).toEqual([{ command: `gh pr merge ${PR_A} --squash`, decision: "deny", reason: "bash_prefix_not_allowed" }]);
  const mergeSession = sessionRuns(store, mergeReady)[0]?.session_id as number;
  expect(decisionsOf(store, mergeSession).filter((d) => d.tool === "Bash")).toEqual([{ tool: "Bash", decision: "deny", reason: "bash_prefix_not_allowed", command: `gh pr merge ${PR_A} --squash` }]);
  // (d) The check answered go with Loomwright's own invocation for the parked run.
  expect(seen.checks).toEqual([{ pr: PR_A, answer: { answer: "go", repo: REPO, pr: PR_A, run_id: RUN_A, ready_sha: HEAD_A, invocation: `/loomwright:automate --merge-parked ${RUN_A}` } }]);
  expect(seen.merges).toEqual([{ pr: PR_A, invocation: `/loomwright:automate --merge-parked ${RUN_A}` }]);
  await step();
  await expect.poll(() => trackOf(store, PR_A)?.state, WAIT).toBe("merged");
  expect(trackOf(store, PR_A)).toMatchObject({ state: "merged", merged_by_gate: 1, head_sha: HEAD_A, ticket_ref: ISSUE_REF });
  expect(trackOf(store, PR_B)).toMatchObject({ state: "parked", merged_by_gate: 0 });
  expect(ticketTasks(store).map((t) => [t.id, t.state])).toEqual([
    [idA, "merged"],
    [idB, "parked"],
  ]);
  expect(events(store, "pr_state_changed").filter((e) => e.payload.pr === PR_A).map((e) => [e.payload.from, e.payload.to])).toEqual([
    [null, "parked"],
    ["parked", "merged"],
  ]);
  // (f) PR A is merged by Loomwright's gate; PR B still waits.
  await showTasks(page);
  await expectCard(page, idA, { line: `Issue #${ISSUE_NUMBER}→PR #${PR_A}`, state: ["merged", "ok"], approvals: ["Solo", "neutral"], ci: ["CI green", "ok"], owner: /^Mason · /i, column: "done" });
  await expect(card(page, idA).getByTestId("ticket-meta")).toContainText("by Loomwright's gate");
  await expect(card(page, idB)).toHaveAttribute("data-column", "park");

  // ---- 4. PR B under Approve in Studio: the owner changes the repo's policy in Integrations ----
  await openScreen(page, "Integrations");
  await page.getByTestId(IDS.rowPolicy).click();
  await expect(page.getByTestId(IDS.policyCurrent)).toContainText("Solo");
  await page.getByTestId(IDS.policyChange).click();
  await page.locator(`[data-testid="${IDS.policyPreset}"][data-kind="studio_approval"]`).check();
  await page.getByTestId(IDS.policySet).click();
  await expect(page.getByTestId(IDS.policyCurrent)).toContainText("Approve in Studio", WAIT);
  expect(policyRow(store)).toMatchObject({ policy_kind: "studio_approval", set_by: "owner" });

  // ---- 5. (d) PR B: the check waits for the owner; the session asks for the merge approval (held) ----
  s.ready("merge-when-ready: PR B asks", MERGE_MODEL, async (call) => {
    await flush(1);
    const answer = await use(call, "kernel_automate_merge_check", { repo: REPO, pr: PR_B });
    seen.checks.push({ pr: PR_B, answer });
    seen.held.merge = await hold(call, "kernel_merge_approval_request", MERGE_ASK);
    finish(call, "PR B needs your merge approval; it is waiting in Approvals.");
  });
  await step();
  await runNow();
  await expect.poll(() => sessionRuns(store, mergeReady).map((r) => r.status), WAIT).toEqual(["done", "done"]);
  noFailures();
  expect(seen.checks[1]).toMatchObject({ pr: PR_B, answer: { answer: "wait", reason: "awaiting_owner_approval" } });
  const mergeApproval = approvalOf(store, "kernel_merge_approval_request") as ApprovalRow;
  expect(mergeApproval).toMatchObject({ id: seen.held.merge, status: "pending", decision: null, requesting_agent: CREW });
  expect(github.callsTo("getPullMergeState").length).toBeGreaterThan(0);
  // (f) Tasks: PR B now says Approve in Studio and waits on the owner, with a link to the merge card for its head.
  await showTasks(page);
  await expectCard(page, idB, { line: `ClickUp ${CLICKUP_TASK}→PR #${PR_B}`, state: ["parked", "parked"], approvals: ["Approve in Studio", "attention"], ci: ["CI green", "ok"], owner: /^Mason · parked \/automate item$/i, column: "wait" });
  await expect(page.getByTestId(`ticket-card-task:${idB}`).getByTestId("ticket-waiting")).toContainText("Waiting on you");
  // The owner opens the merge card from the card that waits, reads PR B's head, and allows it once. Allowing does not merge.
  s.ready("merge approval decision", CREW_MODEL, async (call) => {
    await flush(1);
    finish(call, "Noted: the merge approval is allowed; the next merge-when-ready run will see it.");
  }, new RegExp(`approved approval ${mergeApproval.id}: kernel_merge_approval_request\\.`));
  await page.getByTestId(`ticket-card-task:${idB}`).getByRole("button", { name: `Open approval #${mergeApproval.id}` }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/approvals/${mergeApproval.id}`);
  const mergeCard = page.getByTestId("merge-card");
  await expect(mergeCard).toBeVisible();
  await expect(mergeCard.getByTestId("merge-url")).toHaveText(URL_B);
  await expect(mergeCard.getByTestId("merge-head-sha")).toHaveAttribute("title", HEAD_B);
  await expect(mergeCard.getByTestId("merge-ready")).toHaveText(READY_AT_B);
  await page.getByRole("button", { name: /^Allow once/ }).click();
  await expect(page.getByTestId("approval-outcome")).toContainText("Allowed once by owner");
  expect(approvalRows(store).find((a) => a.id === mergeApproval.id)).toMatchObject({ status: "approved", decision: "once" });
  expect(github.callsTo("requestReviewers")).toHaveLength(1);
  await expect.poll(() => s.unused().filter((l) => l === "merge approval decision"), WAIT).toEqual([]);

  // The next merge-when-ready run sees the approval at PR B's head through the check: go. Loomwright's gate merges.
  s.ready("merge-when-ready: PR B merges", MERGE_MODEL, async (call) => {
    await flush(1);
    const answer = await use(call, "kernel_automate_merge_check", { repo: REPO, pr: PR_B });
    seen.checks.push({ pr: PR_B, answer });
    if (answer.answer === "go" && typeof answer.invocation === "string") gateMerges(PR_B, { id: RUN_B, ...SHA_B }, answer.invocation);
    finish(call, `merge check for PR ${PR_B}: ${String(answer.answer)}`);
  });
  await step();
  await runNow();
  await expect.poll(() => sessionRuns(store, mergeReady).map((r) => r.status), WAIT).toEqual(["done", "done", "done"]);
  noFailures();
  expect(seen.checks[2]).toEqual({ pr: PR_B, answer: { answer: "go", repo: REPO, pr: PR_B, run_id: RUN_B, ready_sha: HEAD_B, invocation: `/loomwright:automate --merge-parked ${RUN_B}` } });
  await step();
  await expect.poll(() => trackOf(store, PR_B)?.state, WAIT).toBe("merged");

  // ---- 6. (d, e) The end state: both PRs merged by the gate, and the kernel never merged anything ----
  expect(trackRows(store).map((t) => [t.number, t.state, t.merged_by_gate, t.ticket_ref])).toEqual([
    [PR_A, "merged", 1, ISSUE_REF],
    [PR_B, "merged", 1, CLICKUP_REF],
  ]);
  expect(ticketTasks(store).map((t) => t.state)).toEqual(["merged", "merged"]);
  // The fake GitHub recorded no merge call from the kernel; every merge the kernel saw was a read of the merge state.
  expect(github.calls.map((c) => c.method).filter((m) => /merge/i.test(m) && m !== "getPullMergeState")).toEqual([]);
  // Every `gh pr merge` any session tried was denied (the run sessions' by the rail, merge_blocked; the crew session's by its policy), and none was ever held as an approval.
  const merges = events(store, "tool_decision").filter((e) => typeof e.payload.command === "string" && e.payload.command.startsWith("gh pr merge"));
  expect(merges.map((e) => [e.payload.decision, e.payload.reason]).sort()).toEqual([
    ["deny", "bash_prefix_not_allowed"],
    ["deny", "merge_blocked"],
    ["deny", "merge_blocked"],
  ]);
  expect(approvalRows(store).filter((a) => a.action.includes("merge") && a.action !== "kernel_merge_approval_request")).toEqual([]);
  // (f) Tasks: both cards are merged by Loomwright's gate, and the open card says so.
  await showTasks(page);
  for (const [task, line] of [
    [idA, `Issue #${ISSUE_NUMBER}→PR #${PR_A}`],
    [idB, `ClickUp ${CLICKUP_TASK}→PR #${PR_B}`],
  ] as const) {
    await expect(card(page, task).locator(".ticket-kind")).toHaveText(line);
    await expect(card(page, task)).toHaveAttribute("data-column", "done");
    expect(await pill(page, task, "task-card-state")).toEqual(["merged", "ok"]);
    expect(await pill(page, task, "ticket-ci")).toEqual(["CI green", "ok"]);
    await expect(card(page, task).getByTestId("ticket-meta")).toContainText("by Loomwright's gate");
    await card(page, task).click();
    await expect(page.getByTestId("task-facts")).toContainText("by Loomwright's gate");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  }
  await expect(page.getByTestId(`ticket-card-task:${idB}`).getByTestId("ticket-waiting")).toHaveCount(0);

  // Every stand-in session had its driver, and every driver ran.
  noFailures();
  expect(s.unused()).toEqual([]);
});
