// Phase 5 exit check, deterministic part: "everything in phases 2-4 can be
// done from the app, with nothing typed in a terminal" (it starts after
// setup). The built app is the kernel's only client: ONE test walks every
// owner verb of phases 2-4 through the app's UI, in order, against a real
// kernel, and asserts each step's effect from the kernel's own store (rows,
// events, decisions), never only from what the screen shows.
//
//   1. Phase 2: a reminder asked for in Chat registers a trigger; past its
//      instant it fires (`fired`, `trigger_fired`), its card shows in Chat,
//      and its notification's deep link opens it in the app.
//   2. Phase 3: a playbook draft card in Chat; its priority set from the card;
//      its dry run shown (the held enable's display in Approvals); the enable
//      approved in Approvals, so the kernel enables it; Run now from the card.
//   3. Phase 4: a comment-only reviewer drafted by Wright, created from its
//      card; in its own session a `git push` is denied `agent_boundary` (shown
//      in Sessions' output) and its `gh pr comment` is held, then denied in
//      Approvals.
//   4. Sessions: Stop one running session (graceful, `owner_stop`) and Kill
//      another after its confirm (`owner_kill`, no grace).
//   5. Menu bar: Pause all from the tray; a trigger due while paused is
//      `missed_paused`, never fired; Resume clears the pause; the tray's kill
//      switch, confirmed, is recorded engaged.
//   6. Team: Wright's model set in its inspector lands in `wright.json`.
//
// The kernel is `startKernel` (kernel/src/kernel.ts) IN THIS PLAYWRIGHT
// WORKER, over `stubNotifierContributions()` with the brain's `message`
// handler reading the test's clock and zone (phase 4's pattern). Sessions are
// the fakes (kernel/test/session-fakes.ts): stand-in Wright, reviewer and
// playbook sessions, routed by model, never the real SDK, a model or the
// network. One mutable clock is read by `KernelDeps.now`, `loopDeps.now` and
// the brain's handler. The API token comes from an injected in-memory
// keychain, and the app gets that same token through
// `STUDIO_APP_FIXTURE_TOKEN` (honoured unpackaged only); `STUDIO_DATA_DIR`
// points the app at the kernel's data dir, where it reads `api.json` (port 0,
// OS-assigned). The app and the renderer import no kernel code: only this
// spec does, in the test process. The tray is driven through its e2e seam
// (`globalThis.__studioTray`), and the native kill confirm is stood in by
// replacing `dialog.showMessageBox`, as `menubar.spec.ts` does.
//
// No step uses the command line: nothing here imports or spawns it.
//
// The live half (the packaged app, the launchd service, a real model) is the
// owner's run: kernel/test/phase-5-exit-live.test.ts and
// docs/evidence/phase-5-exit-runbook.md.
//
// Run `npm run build` (and `cd ../kernel && npm ci`) first.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { getAgent } from "../../kernel/src/agents/index.js";
import { KeychainError } from "../../kernel/src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../../kernel/src/auth/index.js";
import { KILL_SWITCH_ENGAGED, isKillSwitchEngaged } from "../../kernel/src/api/kill-switch.js";
import { PROPOSED_ALLOWED_TOOLS, brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightSettingsPath } from "../../kernel/src/brain/index.js";
import { SESSION_STOP_REQUESTED } from "../../kernel/src/console/control.js";
import { PAUSE_ENGAGED, PAUSE_RELEASED, isPaused } from "../../kernel/src/console/pause.js";
import { SHIPPED_CONTRIBUTIONS } from "../../kernel/src/features/index.js";
import type { FeatureContribution } from "../../kernel/src/features/index.js";
import { startKernel } from "../../kernel/src/kernel.js";
import type { Kernel, KernelDeps } from "../../kernel/src/kernel.js";
import { getWorkStep } from "../../kernel/src/loop/steps.js";
import { getPlaybook } from "../../kernel/src/playbooks/index.js";
import { NEVER_CATEGORIES } from "../../kernel/src/sessions/policy.js";
import type { Store } from "../../kernel/src/store/index.js";
import type { KernelToolResult } from "../../kernel/src/tools/server.js";
import { events } from "../../kernel/test/loop-helpers.js";
import { assertNoNotifierRefusals, installNotifierGuard } from "../../kernel/test/notifier-guard.js";
import { stubNotifierContributions } from "../../kernel/test/notifier-stub.js";
import type { FakeCall } from "../../kernel/test/session-fakes.js";
import { fakeMsg, fakeSessions, flush, makePluginDir, stubProvider } from "../../kernel/test/session-fakes.js";
import { TRAY_SEAM_ENV, TRAY_SEAM_GLOBAL } from "../src/screens/menubar/state";
import type { TrayModel } from "../src/screens/menubar/state";
import { launchApp, processEnv } from "./electron-harness";

/** Wright's model (`wright.json`): its sessions are told apart from the reviewer's and the playbook's by it. */
const WRIGHT_MODEL = "claude-haiku-4-5";
/** The reviewer's model (its charter): its own sessions run it. */
const REVIEWER_MODEL = "claude-sonnet-4-5";
/** The playbook's model: its dry run and its run now run it. */
const PLAYBOOK_MODEL = "claude-opus-4-1";
/** The model the owner sets for Wright in Team (flow 6). */
const NEW_WRIGHT_MODEL = "claude-sonnet-4-6";
/** The brain's context zone (no DST): every spec below is written in it. */
const ZONE = "Asia/Kolkata";
/** 09:00 in `ZONE` on 2026-10-23. */
const START = "2026-10-23T03:30:00.000Z";
/** Flow 1's reminder: 09:05 in `ZONE`, as Wright writes it, and as the kernel stores it. */
const REMIND_SPEC = "2026-10-23T09:05:00+05:30";
const REMIND_AT = "2026-10-23T03:35:00.000Z";
/** Flow 5's reminder, due while paused: 09:20 in `ZONE`. */
const STRETCH_SPEC = "2026-10-23T09:20:00+05:30";
const STRETCH_AT = "2026-10-23T03:50:00.000Z";
/** The playbook's own trigger: a month out, so it never comes due in this walk. */
const PLAYBOOK_SPEC = "2026-11-23T09:00:00+05:30";
/** The stop grace: distinct, so the injected scheduler can tell a stop's grace from any other timer. */
const STOP_GRACE_MS = 150;
const K = "mcp__kernel__";
const CREATE = `${K}kernel_agent_create`;
const ENABLE = `${K}kernel_playbook_enable`;
const PUSH = "git push origin main";
const COMMENT = 'gh pr comment 1 -b "LGTM"';
/** The reviewer's `never`: the push and every PR/issue write but the comment (phase 4's mason). */
const REVIEWER_NEVER: readonly string[] = NEVER_CATEGORIES.filter((c) => c === "git_push" || (c.startsWith("gh_") && c !== "gh_pr_comment"));
const API_TOKEN_SERVICE = "loomwright-studio-api";

const ASK_REMIND = "Remind me at 09:05 to check the deploy.";
const REMIND_TEXT = "check the deploy";
const REPLY_REMIND = "I'll remind you at 09:05 to check the deploy.";
const ASK_PLAYBOOK = "Every month, review the open pull requests on my repo and comment on each.";
const REPLY_PLAYBOOK = "I drafted the playbook; check its values before I dry-run it.";
const ASK_ENABLE = "Dry-run the playbook and ask me to enable it.";
const REPLY_ENABLE = "The dry run is done; enabling it is waiting for your approval.";
const DRY_RUN_TEXT = "DRY RUN: would comment on PR 7.";
const ASK_REVIEWER = "Make me a reviewer that only leaves review comments on pull requests and never pushes anything.";
const REPLY_REVIEWER = "I drafted Mason, a comment-only reviewer; it is waiting for your approval.";
const ASK_PUSH = "Push your commit, then comment LGTM on PR 1.";
const REPLY_PUSH = "I can't push: my settings forbid it. My review comment is waiting for your approval.";
const ASK_WATCH = "Watch the deploy until I stop you.";
const ASK_LONG_REVIEW = "Review PR 7 and keep going.";
const ASK_STRETCH = "Remind me at 09:20 to stretch.";
const STRETCH_TEXT = "stretch";
const REPLY_STRETCH = "I'll remind you at 09:20 to stretch.";

// ---- The kernel's side: clock, keychain, settings, contributions -------------------

/** One mutable instant, read by `KernelDeps.now`, `loopDeps.now` and the brain's handler alike. */
function mutableClock(iso: string) {
  let ms = Date.parse(iso);
  return {
    now: (): Date => new Date(ms),
    set: (to: string): void => {
      ms = Date.parse(to);
    },
  };
}

/** A keychain in memory: the kernel generates its API token into it on first start. */
function memoryKeychain() {
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

/** Wright's settings: its model and the proposed tool policy (the kernel's playbook and agent tools among them). */
function writeWrightSettings(dataDir: string): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  const policy = { status: "owner", allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] };
  writeFileSync(file, `${JSON.stringify({ ...settings, model: WRIGHT_MODEL, tool_policy: policy, limits: { delegation_depth: 1 } }, null, 2)}\n`);
}

/** The shipped contributions, the brain's `message` handler on the test's clock and zone, then the stub notifier. */
function exitContributions(clock: ReturnType<typeof mutableClock>): readonly FeatureContribution[] {
  const brain: FeatureContribution = Object.freeze({
    ...brainContribution,
    handlers: Object.freeze({ message: brainMessageHandler({ now: clock.now, timeZone: () => ZONE }) }),
  });
  return stubNotifierContributions(Object.freeze(SHIPPED_CONTRIBUTIONS.map((c) => (c === brainContribution ? brain : c))));
}

/** The reviewer's charter, as the stand-in Wright drafts it from the owner's sentence. */
function reviewerCharter(): Record<string, unknown> {
  return {
    id: "mason",
    display_name: "Mason",
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful reviewer who comments on pull requests.",
    duties: ["Review the pull requests and leave review comments."],
    boundaries: ["Never push code, and never open, edit, approve or close a pull request or issue."],
    model: REVIEWER_MODEL,
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read", "Grep", "Bash"], allowedBashPrefixes: ["git", "gh pr view", "gh pr diff", "gh pr comment"], never: [...REVIEWER_NEVER] },
    workspaces: [],
  };
}

// ---- The stand-in sessions -------------------------------------------------------

type SdkMessage = Parameters<FakeCall["stream"]["push"]>[0];
const sdk = (m: Record<string, unknown>): SdkMessage => m as unknown as SdkMessage;
const success = (text: string): SdkMessage => sdk({ type: "result", subtype: "success", is_error: false, result: text, modelUsage: {} });
const said = (text: string): SdkMessage =>
  sdk({ type: "assistant", parent_tool_use_id: null, session_id: "s", message: { role: "assistant", content: [{ type: "text", text }] } });
const toolUse = (id: string, name: string, input: unknown): SdkMessage =>
  sdk({ type: "assistant", parent_tool_use_id: null, session_id: "s", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });

interface RegisteredTool {
  handler(args: unknown, extra: unknown): Promise<KernelToolResult>;
}

/** Call a tool on `call`'s kernel MCP server, as the session would. */
async function tool(call: FakeCall, name: string, args: unknown): Promise<KernelToolResult> {
  const server = (call.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  const t = (server?.instance as { _registeredTools: Record<string, RegisteredTool> } | undefined)?._registeredTools[name];
  if (t === undefined) throw new Error(`no tool ${name} on the kernel server`);
  return t.handler(args, {});
}

/** A tool result's JSON value; throws on a refusal. */
function value<T = Record<string, unknown>>(r: KernelToolResult): T {
  if (r.isError === true) throw new Error(`the kernel refused: ${r.content[0]?.text ?? ""}`);
  return JSON.parse(r.content[0]?.text ?? "null") as T;
}

interface Decision {
  readonly permissionDecision: string;
  readonly permissionDecisionReason: string;
}
type PreToolUseHook = (input: unknown, toolUseId: string, options: { signal: AbortSignal }) => Promise<unknown>;

/** `call`'s PreToolUse gate, called as the CLI would from the session's working directory. */
function gate(call: FakeCall, toolName: string, toolInput: unknown, toolUseId: string): Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as unknown as PreToolUseHook;
  const input = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId, session_id: "s", transcript_path: "/dev/null", cwd: call.options.cwd };
  return hook(input, toolUseId, { signal: new AbortController().signal }).then((r) => (r as { hookSpecificOutput: Decision }).hookSpecificOutput);
}

/** What one stand-in session does after its `system/init`. */
type Driver = (call: FakeCall) => Promise<void>;

/** Reply `text` and end. */
const reply =
  (text: string): Driver =>
  async (call) => {
    call.stream.push(success(text));
    call.stream.end();
  };

/** Say `text` and stay open: the session runs until the owner stops or kills it. */
const keepRunning =
  (text: string): Driver =>
  async (call) => {
    await flush(1);
    call.stream.push(said(text));
  };

/**
 * The fake sessions with three queues of stand-ins, by the session's model. A
 * session with no driver queued is a failure (ended at once, so nothing
 * waits on it).
 */
function standIns(schedule: (fn: () => void, ms: number) => () => void) {
  const wright: Driver[] = [];
  const reviewer: Driver[] = [];
  const playbook: Driver[] = [];
  const failures: unknown[] = [];
  const fakes = fakeSessions({
    script: (call) => {
      call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
      const model = call.options.model;
      const queue = model === REVIEWER_MODEL ? reviewer : model === PLAYBOOK_MODEL ? playbook : wright;
      const driver = queue.shift();
      if (driver === undefined) {
        failures.push(new Error(`a session on ${String(model)} started with no driver queued`));
        call.stream.push(success("unexpected"));
        call.stream.end();
        return;
      }
      void driver(call).catch((err: unknown) => {
        failures.push(err);
        call.stream.end();
      });
    },
  });
  return { fakes, deps: { ...fakes.deps, schedule }, wright, reviewer, playbook, failures };
}

// ---- Reading the store -------------------------------------------------------------

interface SessionRow {
  readonly id: number;
  readonly agent: string;
  readonly status: string;
  readonly model: string;
  readonly playbook: number | null;
}
const sessionRows = (store: Store): SessionRow[] => store.prepare<[], SessionRow>("SELECT id, agent, status, model, playbook FROM sessions ORDER BY id").all();

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

interface TriggerRow {
  readonly id: number;
  readonly owning_agent: string;
  readonly kind: string;
  readonly action: string;
  readonly action_payload: string;
  readonly enabled: number;
  readonly next_fire_at: string | null;
  readonly last_result: string | null;
}
const triggerRows = (store: Store): TriggerRow[] =>
  store.prepare<[], TriggerRow>("SELECT id, owning_agent, kind, action, action_payload, enabled, next_fire_at, last_result FROM triggers ORDER BY id").all();

const notificationRows = (store: Store): { id: number; source: string; title: string; body: string; deep_link: string }[] =>
  store.prepare<[], { id: number; source: string; title: string; body: string; deep_link: string }>("SELECT id, source, title, body, deep_link FROM notifications ORDER BY id").all();

const runRows = (store: Store, playbook: number): { kind: string; status: string; version: number; session_id: number | null }[] =>
  store
    .prepare<[number], { kind: string; status: string; version: number; session_id: number | null }>("SELECT kind, status, version, session_id FROM playbook_runs WHERE playbook = ? ORDER BY id")
    .all(playbook);

/** The status of the brain message the decision on approval `id` queued, once it has a row. */
const decisionMessageStatus = (store: Store, id: number): string | undefined =>
  store.prepare<[string], string>("SELECT status FROM brain_messages WHERE source = ?").pluck().get(`approval:${id}`);

/** The work step result of trigger `id`'s instant `at` (`fireStepKey` in kernel/src/triggers/store.ts). */
const instantResult = (store: Store, id: number, at: string): unknown => (getWorkStep(store, `trigger:${id}:${at}`)?.result as { result?: unknown } | undefined)?.result;

/** The terminal `session_status` of session `id`: its `to` and `reason`, once it has one. */
function endOf(store: Store, id: number): { to: unknown; reason: unknown } | undefined {
  const last = events(store, "session_status")
    .filter((e) => e.session_id === id)
    .at(-1);
  return last === undefined || last.payload.to === "running" ? undefined : { to: last.payload.to, reason: last.payload.reason };
}

// ---- Driving the app -----------------------------------------------------------------

const sidebar = (page: Page) => page.getByTestId("sidebar");

async function openScreen(page: Page, name: "Chat" | "Team" | "Approvals" | "Sessions"): Promise<void> {
  await sidebar(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByTestId(`screen-${name.toLowerCase()}`)).toBeVisible();
}

/** Send `text` from the open thread's composer, as the owner types it. */
async function send(page: Page, agentName: string, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: `Message ${agentName}` });
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

/** Select approval `id` in the Approvals inbox by clicking its row. */
async function selectApproval(page: Page, id: number): Promise<void> {
  await openScreen(page, "Approvals");
  await page.getByRole("listbox", { name: "Approvals, pending first" }).locator(`[role="option"][data-key="${id}"]`).click();
  await expect(page.getByTestId("approval-detail")).toHaveAttribute("data-approval-id", String(id));
}

/** Select session `id` in the Sessions list by clicking its row. */
async function selectSession(page: Page, id: number): Promise<void> {
  await openScreen(page, "Sessions");
  await page.getByTestId(`session-row-${id}`).click();
  await expect(page.getByTestId("session-detail")).toHaveAttribute("data-session-id", String(id));
}

/**
 * The one-line card a `trigger_fired` event makes in Chat. Chat's full trigger
 * card (`TriggerCard`) is drawn only for a trigger in the app's `GET /triggers`
 * read, which lists enabled triggers only, so a spent `once` reminder never
 * gets one; and no thread event kind marks a trigger's registration, so none
 * shows before it fires either.
 */
function firedCard(page: Page, triggerId: number) {
  return page.getByTestId("screen-chat").getByRole("button", { name: `Trigger ${triggerId} fired (notify)` });
}

/** A link, delivered as macOS delivers a notification's click: `open-url` on `app`. */
async function openUrl(app: ElectronApplication, url: string): Promise<void> {
  await app.evaluate(({ app: electronApp }, link) => {
    electronApp.emit("open-url", { preventDefault() {} }, link);
  }, url);
}

async function trayModel(app: ElectronApplication): Promise<TrayModel | undefined> {
  return app.evaluate((_electron, key) => (globalThis as unknown as Record<string, { model(): TrayModel } | undefined>)[key]?.model(), TRAY_SEAM_GLOBAL);
}

/** Press a tray item through the seam; settles after its work and its re-read. */
async function trayClick(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(
    async (_electron, [key, item]) => {
      await (globalThis as unknown as Record<string, { click(id: string): Promise<void> }>)[key as string]?.click(item as string);
    },
    [TRAY_SEAM_GLOBAL, id] as const,
  );
}

/** Stand in for the native kill confirm: every later ask answers Engage (1) and is counted. */
async function engageOnConfirm(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __killAsks?: number };
    g.__killAsks = 0;
    dialog.showMessageBox = (() => {
      g.__killAsks = (g.__killAsks ?? 0) + 1;
      return Promise.resolve({ response: 1, checkboxChecked: false });
    }) as typeof dialog.showMessageBox;
  });
}

const killAsks = (app: ElectronApplication): Promise<number> => app.evaluate(() => (globalThis as unknown as { __killAsks?: number }).__killAsks ?? 0);

/**
 * `kernel/test/notifier-guard.ts` recurses without end in this worker
 * (RangeError) when `execFile`'s promisified form already points at itself:
 * Node's `util.promisify` sets that self-reference the first time anything
 * promisifies `execFile`, and Playwright's runner does so before any spec
 * loads (vitest installs the guard before that can happen, so the kernel's
 * suite never meets it). The guard's own `guarded()` should skip a
 * self-referencing `promisify.custom`; until it does, the self-reference is
 * removed here first. It is configurable and read only by `promisify` itself,
 * which sets it again on its next call.
 */
function installGuardInThisWorker(): void {
  const cp = createRequire(import.meta.url)("node:child_process") as Record<string, Record<symbol, unknown> | undefined>;
  const custom = cp.execFile?.[promisify.custom] as Record<symbol, unknown> | undefined;
  if (custom !== undefined && custom[promisify.custom] === custom) delete custom[promisify.custom];
  installNotifierGuard();
}

// ---- The test ------------------------------------------------------------------------

let tmp: string | undefined;
let kernel: Kernel | undefined;
let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await kernel?.stop();
  kernel = undefined;
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  // After the test: a real notifier refused anywhere in the walk fails it here.
  assertNoNotifierRefusals();
});

test("phase 5 exit: every phase 2-4 owner verb done in the app against a real kernel, each effect read from its store", async () => {
  test.setTimeout(240_000);
  installGuardInThisWorker();

  tmp = mkdtempSync(join(tmpdir(), "studio-phase5-exit-"));
  const dataDir = join(tmp, "data");
  const home = join(tmp, "home");
  mkdirSync(home);
  writeWrightSettings(dataDir);
  const clock = mutableClock(START);
  const keychain = memoryKeychain();
  /** Every stop grace the session manager starts (a timer of exactly `STOP_GRACE_MS`). */
  const graces: number[] = [];
  const schedule = (fn: () => void, ms: number): (() => void) => {
    if (ms === STOP_GRACE_MS) graces.push(ms);
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  };
  const s = standIns(schedule);
  const deps: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: { ...s.deps, homeDir: home },
    selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
    availableProviderIds: async () => ["api-key"],
    now: clock.now,
    loopDeps: { tickMs: 10, now: clock.now },
  };
  kernel = await startKernel(
    { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: STOP_GRACE_MS }, contributions: exitContributions(clock) },
    deps,
  );
  const store = kernel.store;
  const calls = s.fakes.calls;
  const noFailures = (): void => expect(s.failures).toEqual([]);

  // The kernel generated its API token into the injected keychain; the app gets that same token.
  const token = keychain.items.get(API_TOKEN_SERVICE);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect(kernel.api.port).toBeGreaterThan(0);
  expect(JSON.parse(readFileSync(kernel.apiInfoPath, "utf8"))).toMatchObject({ port: kernel.api.port, pid: process.pid });

  app = await launchApp({ ...processEnv(), STUDIO_DATA_DIR: dataDir, STUDIO_APP_FIXTURE_TOKEN: token as string, [TRAY_SEAM_ENV]: "1" });
  const launched = app;
  const page = await launched.firstWindow();
  await expect(sidebar(page)).toBeVisible();
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await openScreen(page, "Chat");
  await expect(page.getByTestId("chat-empty")).toBeVisible();

  // ---- 1. Phase 2: a reminder from Chat registers a trigger; past its instant it fires, and its notification shows ----
  s.wright.push(async (call) => {
    await flush(1);
    value(await tool(call, "kernel_trigger_register", { kind: "once", spec: REMIND_SPEC, action: "notify", text: REMIND_TEXT, idempotency_key: "remind-1" }));
    await reply(REPLY_REMIND)(call);
  });
  await send(page, "Wright", ASK_REMIND);
  await expect(page.getByText(REPLY_REMIND)).toBeVisible();
  noFailures();
  expect(calls[0]?.options.model).toBe(WRIGHT_MODEL);
  const [remind, ...otherTriggers] = triggerRows(store);
  expect(otherTriggers).toEqual([]);
  expect(remind).toMatchObject({ owning_agent: "wright", kind: "once", action: "notify", action_payload: REMIND_TEXT, enabled: 1, next_fire_at: REMIND_AT, last_result: null });
  const remindId = (remind as TriggerRow).id;
  // Registered, not yet fired.
  expect(events(store, "trigger_fired")).toEqual([]);
  expect(notificationRows(store)).toEqual([]);

  clock.set("2026-10-23T03:35:01.000Z");
  await expect.poll(() => instantResult(store, remindId, REMIND_AT)).toBe("fired");
  expect(triggerRows(store)[0]).toMatchObject({ id: remindId, enabled: 0, next_fire_at: null, last_result: "fired" });
  const fired = events(store, "trigger_fired").filter((e) => e.payload.trigger_id === remindId);
  expect(fired.map((e) => e.payload)).toEqual([expect.objectContaining({ trigger_id: remindId, action: "notify", scheduled_at: REMIND_AT })]);
  const [notification, ...moreNotifications] = notificationRows(store);
  expect(moreNotifications).toEqual([]);
  expect(notification).toMatchObject({ source: `trigger:${remindId}`, body: REMIND_TEXT, id: fired[0]?.payload.notification_id });
  // The trigger's card in Chat: its firing's card, from the kernel's trigger_fired event. (The full
  // trigger card is not reachable for a spent `once`: see the note on `firedCard`.)
  await expect(firedCard(page, remindId)).toBeVisible();
  // Its notification in the app: its own deep link, delivered as macOS delivers a click (`open-url`),
  // makes the app read the row from the kernel (GET /notifications/:id) and open the thread it names.
  expect(notification?.deep_link).toBe(`loomwright-studio://notifications/${notification?.id}`);
  await openScreen(page, "Team");
  await openUrl(launched, notification?.deep_link ?? "");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/chat");
  await expect(firedCard(page, remindId)).toBeVisible();

  // ---- 2. Phase 3: a playbook draft card; its priority set from the card; its dry run shown; enable approved in Approvals; Run now ----
  let draft: { id: number; slug: string; version: number } | undefined;
  s.wright.push(async (call) => {
    await flush(1);
    draft = value(
      await tool(call, "kernel_playbook_create", {
        name: "PR review sweep",
        intent: "Review the open pull requests on the repo and comment on each.",
        trigger: { kind: "once", spec: PLAYBOOK_SPEC },
        priority: "low",
        model: PLAYBOOK_MODEL,
        idempotency_key: "pb-1",
      }),
    );
    await reply(REPLY_PLAYBOOK)(call);
  });
  await send(page, "Wright", ASK_PLAYBOOK);
  await expect(page.getByText(REPLY_PLAYBOOK)).toBeVisible();
  noFailures();
  if (draft === undefined) throw new Error("the stand-in Wright created no playbook");
  const pb = draft;
  expect(getPlaybook(store, pb.id)).toMatchObject({ owning_agent: "wright", status: "draft", version: 1, priority: "low", priority_set_by: "wright", model: PLAYBOOK_MODEL });
  const card = page.getByRole("region", { name: `Playbook ${pb.slug}` });
  await expect(card).toBeVisible();
  // Set its priority from the card: the store's row carries it, set by the owner.
  await card.getByRole("combobox", { name: "Field" }).selectOption("priority");
  await card.getByRole("combobox", { name: "Value" }).selectOption("high");
  await card.getByRole("button", { name: /^Set priority/ }).click();
  await expect.poll(() => getPlaybook(store, pb.id)?.priority).toBe("high");
  expect(getPlaybook(store, pb.id)).toMatchObject({ status: "draft", version: 2, priority: "high", priority_set_by: "owner" });
  await expect(page.getByRole("region", { name: `Playbook ${pb.slug}` }).locator('[data-field="Priority"]')).toContainText("high");

  // Wright dry-runs it and asks to enable it: the dry run runs the playbook's model; the enable is held.
  let dry: { run_id: number; version: number; status: string; summary: string } | undefined;
  let enableHeld: Decision | undefined;
  s.wright.push(async (call) => {
    await flush(1);
    dry = value(await tool(call, "kernel_playbook_dry_run", { id: pb.id, idempotency_key: "dry-1" }));
    enableHeld = await gate(call, ENABLE, { id: pb.id, idempotency_key: "enable-1" }, "toolu_enable");
    await reply(REPLY_ENABLE)(call);
  });
  s.playbook.push(async (call) => {
    await flush(1);
    call.stream.push(said(DRY_RUN_TEXT));
    await reply("DRY RUN DONE")(call);
  });
  await send(page, "Wright", ASK_ENABLE);
  await expect(page.getByText(REPLY_ENABLE)).toBeVisible();
  noFailures();
  expect(dry).toMatchObject({ version: 2, status: "done" });
  expect(runRows(store, pb.id)).toEqual([expect.objectContaining({ kind: "dry_run", status: "done", version: 2 })]);
  expect(enableHeld?.permissionDecision).toBe("deny");
  const enableApproval = approvalRows(store).find((a) => a.action === "kernel_playbook_enable");
  expect(enableApproval).toMatchObject({ status: "pending", decision: null, requesting_agent: "wright" });
  expect(enableHeld?.permissionDecisionReason).toMatch(new RegExp(`^approval_required: held as approval ${enableApproval?.id};`));
  expect(getPlaybook(store, pb.id)?.status).toBe("draft");
  const enableId = (enableApproval as ApprovalRow).id;
  // Its dry run, shown with the held enable; the owner approves it in Approvals and the kernel enables it.
  await selectApproval(page, enableId);
  await expect(page.getByTestId("approval-display")).toContainText(`dry run: ${dry?.summary ?? ""}`);
  s.wright.push(reply("Noted: the playbook is enabled."));
  await page.getByRole("button", { name: /^Allow once/ }).click();
  await expect(page.getByTestId("approval-outcome")).toBeVisible();
  await expect.poll(() => getPlaybook(store, pb.id)?.status).toBe("enabled");
  expect(approvalRows(store).find((a) => a.id === enableId)).toMatchObject({ status: "approved", decision: "once" });
  expect(events(store, "playbook_enabled").map((e) => e.payload)).toEqual([expect.objectContaining({ playbook_id: pb.id, version: 2, approval_id: enableId, by: "owner" })]);
  await expect.poll(() => decisionMessageStatus(store, enableId)).toBe("replied");
  noFailures();
  // Run now, from the playbook's card in Chat: its session starts on the playbook's model.
  s.playbook.push(reply("RUN NOW DONE"));
  await openScreen(page, "Chat");
  await page.getByRole("region", { name: `Playbook ${pb.slug}` }).getByRole("button", { name: /^Run now/ }).click();
  await expect.poll(() => runRows(store, pb.id).filter((r) => r.kind === "run_now").map((r) => r.status)).toEqual(["done"]);
  noFailures();
  const runNow = runRows(store, pb.id).find((r) => r.kind === "run_now");
  expect(sessionRows(store).find((r) => r.id === runNow?.session_id)).toMatchObject({ agent: "wright", status: "completed", model: PLAYBOOK_MODEL, playbook: pb.id });

  // ---- 3. Phase 4: a comment-only reviewer created from its card; its push denied agent_boundary; its comment held, then denied ----
  let createHeld: Decision | undefined;
  s.wright.push(async (call) => {
    await flush(1);
    createHeld = await gate(call, CREATE, { charter: reviewerCharter(), idempotency_key: "create-mason" }, "toolu_create");
    await reply(REPLY_REVIEWER)(call);
  });
  await send(page, "Wright", ASK_REVIEWER);
  await expect(page.getByText(REPLY_REVIEWER)).toBeVisible();
  noFailures();
  expect(createHeld?.permissionDecision).toBe("deny");
  const createApproval = approvalRows(store).find((a) => a.action === "kernel_agent_create");
  expect(createApproval).toMatchObject({ status: "pending", requesting_agent: "wright" });
  expect(getAgent(store, "mason")).toBeUndefined();
  const createId = (createApproval as ApprovalRow).id;
  s.wright.push(reply("Noted: Mason exists."));
  const charterCard = page.getByRole("region", { name: `Drafted crew member, approval ${createId}` });
  await expect(charterCard).toBeVisible();
  await charterCard.getByRole("button", { name: /^Create/ }).click();
  await expect.poll(() => getAgent(store, "mason")?.status).toBe("active");
  expect(getAgent(store, "mason")).toMatchObject({ status: "active", created_by: "wright", approval_id: createId });
  expect(approvalRows(store).find((a) => a.id === createId)).toMatchObject({ status: "approved", decision: "once" });
  await expect.poll(() => decisionMessageStatus(store, createId)).toBe("replied");
  noFailures();

  // In the reviewer's own thread and session: the push is denied agent_boundary, the comment held.
  const decisions: { push?: Decision; comment?: Decision } = {};
  s.reviewer.push(async (call) => {
    await flush(1);
    call.stream.push(toolUse("toolu_push", "Bash", { command: PUSH }));
    decisions.push = await gate(call, "Bash", { command: PUSH }, "toolu_push");
    call.stream.push(toolUse("toolu_comment", "Bash", { command: COMMENT }));
    decisions.comment = await gate(call, "Bash", { command: COMMENT }, "toolu_comment");
    call.stream.push(said(REPLY_PUSH));
    await reply(REPLY_PUSH)(call);
  });
  await sidebar(page).getByRole("button", { name: /^Mason/ }).click();
  await expect(page.getByText("with Mason")).toBeVisible();
  await send(page, "Mason", ASK_PUSH);
  await expect(page.getByTestId("screen-chat").getByText(REPLY_PUSH).first()).toBeVisible();
  noFailures();
  const reviewerSession = sessionRows(store).find((r) => r.agent === "mason");
  expect(reviewerSession).toMatchObject({ status: "completed", model: REVIEWER_MODEL });
  const reviewerId = (reviewerSession as SessionRow).id;
  expect(decisions.push?.permissionDecision).toBe("deny");
  expect(decisions.push?.permissionDecisionReason.startsWith("agent_boundary: git_push")).toBe(true);
  const reviewerDecisions = events(store, "tool_decision").filter((e) => e.session_id === reviewerId);
  expect(reviewerDecisions.filter((e) => e.payload.command === PUSH).map((e) => e.payload)).toEqual([
    expect.objectContaining({ decision: "deny", reason: "agent_boundary", category: "git_push" }),
  ]);
  // No approval for the push: the one this session holds is the comment's.
  expect(approvalRows(store).filter((a) => a.requesting_session === reviewerId).map((a) => a.action)).toEqual(["gh pr comment"]);
  expect(approvalRows(store).some((a) => a.action.includes("push"))).toBe(false);
  expect(decisions.comment?.permissionDecisionReason).toMatch(/^approval_required: held as approval \d+;/);
  // The Sessions screen's output shows the boundary decision.
  await selectSession(page, reviewerId);
  const log = page.getByRole("log", { name: "Session output" });
  await expect(log).toContainText(`Bash denied · agent_boundary · ${PUSH}`);
  await expect(log).toContainText("Bash held · approval #");
  // The held comment: the owner presses Deny in Approvals.
  const commentApproval = approvalRows(store).find((a) => a.requesting_session === reviewerId) as ApprovalRow;
  expect(commentApproval).toMatchObject({ action: "gh pr comment", status: "pending", requesting_agent: "mason" });
  s.reviewer.push(reply("Understood: no comment."));
  await selectApproval(page, commentApproval.id);
  await page.getByRole("button", { name: /^Deny/ }).click();
  await expect.poll(() => approvalRows(store).find((a) => a.id === commentApproval.id)?.decision).toBe("deny");
  expect(approvalRows(store).find((a) => a.id === commentApproval.id)).toMatchObject({ status: "denied", decision: "deny" });
  await expect(page.getByTestId("approval-outcome")).toContainText("Denied by owner");
  await expect.poll(() => decisionMessageStatus(store, commentApproval.id)).toBe("replied");
  noFailures();

  // ---- 4. Sessions: Stop one running session (graceful, owner_stop); Kill another after its confirm (owner_kill, no grace) ----
  s.wright.push(keepRunning("Watching the deploy."));
  await openScreen(page, "Chat");
  await sidebar(page).getByRole("button", { name: /^Chat/ }).click();
  await send(page, "Wright", ASK_WATCH);
  await expect.poll(() => sessionRows(store).filter((r) => r.agent === "wright" && r.status === "running").length).toBe(1);
  const watching = sessionRows(store).find((r) => r.agent === "wright" && r.status === "running") as SessionRow;
  s.reviewer.push(keepRunning("Reviewing PR 7."));
  await sidebar(page).getByRole("button", { name: /^Mason/ }).click();
  await send(page, "Mason", ASK_LONG_REVIEW);
  await expect.poll(() => sessionRows(store).filter((r) => r.agent === "mason" && r.status === "running").length).toBe(1);
  const reviewing = sessionRows(store).find((r) => r.agent === "mason" && r.status === "running") as SessionRow;
  noFailures();

  const gracesBeforeStop = graces.length;
  await selectSession(page, watching.id);
  await page.getByTestId("session-detail").getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => endOf(store, watching.id)).toEqual({ to: "stopped", reason: "owner_stop" });
  expect(sessionRows(store).find((r) => r.id === watching.id)?.status).toBe("stopped");
  expect(events(store, SESSION_STOP_REQUESTED).filter((e) => e.session_id === watching.id).map((e) => e.payload)).toEqual([{ by: "owner", mode: "stop" }]);
  // Graceful: it waited out one stop grace.
  expect(graces.length).toBe(gracesBeforeStop + 1);
  await expect(page.getByTestId(`session-row-${watching.id}`).getByTestId("session-status")).toHaveText("stopped");
  await expect(page.getByTestId(`session-row-${watching.id}`).getByTestId("session-reason")).toHaveText(" · owner_stop");

  const gracesBeforeKill = graces.length;
  await selectSession(page, reviewing.id);
  await page.getByTestId("session-detail").getByRole("button", { name: "Kill", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`Kill session #${reviewing.id}?`);
  await confirm.getByRole("button", { name: "Kill" }).click();
  await expect.poll(() => endOf(store, reviewing.id)).toEqual({ to: "stopped", reason: "owner_kill" });
  expect(sessionRows(store).find((r) => r.id === reviewing.id)?.status).toBe("stopped");
  expect(events(store, SESSION_STOP_REQUESTED).filter((e) => e.session_id === reviewing.id).map((e) => e.payload)).toEqual([{ by: "owner", mode: "kill" }]);
  // No grace: the kill started none.
  expect(graces.length).toBe(gracesBeforeKill);
  await expect(page.getByTestId(`session-row-${reviewing.id}`).getByTestId("session-status")).toHaveText("stopped");
  await expect(page.getByTestId(`session-row-${reviewing.id}`).getByTestId("session-reason")).toHaveText(" · owner_kill");
  noFailures();

  // ---- 5. Menu bar: Pause all; a trigger due while paused is missed_paused, never fired; Resume; the kill switch, confirmed ----
  s.wright.push(async (call) => {
    await flush(1);
    value(await tool(call, "kernel_trigger_register", { kind: "once", spec: STRETCH_SPEC, action: "notify", text: STRETCH_TEXT, idempotency_key: "stretch-1" }));
    await reply(REPLY_STRETCH)(call);
  });
  await openScreen(page, "Chat");
  await sidebar(page).getByRole("button", { name: /^Chat/ }).click();
  await send(page, "Wright", ASK_STRETCH);
  await expect(page.getByText(REPLY_STRETCH)).toBeVisible();
  noFailures();
  const stretch = triggerRows(store).find((t) => t.action_payload === STRETCH_TEXT) as TriggerRow;
  expect(stretch).toMatchObject({ enabled: 1, next_fire_at: STRETCH_AT, last_result: null });

  await expect.poll(async () => (await trayModel(launched))?.state).not.toBe("unknown");
  await trayClick(launched, "pause-all");
  await expect.poll(() => isPaused(store)).toBe(true);
  expect(events(store, PAUSE_ENGAGED)).toHaveLength(1);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("paused");
  clock.set("2026-10-23T03:50:01.000Z");
  await expect.poll(() => instantResult(store, stretch.id, STRETCH_AT)).toBe("missed_paused");
  expect(triggerRows(store).find((t) => t.id === stretch.id)).toMatchObject({ enabled: 0, last_result: "missed_paused" });
  expect(events(store, "trigger_missed").filter((e) => e.payload.trigger_id === stretch.id).map((e) => e.payload)).toEqual([
    expect.objectContaining({ trigger_id: stretch.id, reason: "paused", scheduled_at: STRETCH_AT }),
  ]);
  expect(events(store, "trigger_fired").filter((e) => e.payload.trigger_id === stretch.id)).toEqual([]);
  expect(notificationRows(store).filter((n) => n.source === `trigger:${stretch.id}`)).toEqual([]);

  await trayClick(launched, "resume");
  await expect.poll(() => isPaused(store)).toBe(false);
  expect(events(store, PAUSE_RELEASED)).toHaveLength(1);
  await expect.poll(async () => (await trayModel(launched))?.state).not.toBe("paused");

  await engageOnConfirm(launched);
  await trayClick(launched, "kill-switch");
  expect(await killAsks(launched)).toBe(1);
  await expect.poll(() => events(store, KILL_SWITCH_ENGAGED).length).toBe(1);
  expect(isKillSwitchEngaged(store)).toBe(true);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("killed");

  // ---- 6. Team: Wright's model set in its inspector; wright.json carries it ----
  await openScreen(page, "Team");
  await page.getByRole("group", { name: "Agents" }).getByRole("button", { name: "Wright", exact: true }).click();
  const inspector = page.getByTestId("team-inspector");
  await expect(inspector.getByRole("heading", { name: "Wright", level: 2 })).toBeVisible();
  await inspector.getByTestId("team-set-field").selectOption("model");
  await inspector.getByTestId("team-set-value").fill(NEW_WRIGHT_MODEL);
  await inspector.getByRole("button", { name: "Set", exact: true }).click();
  await expect.poll(() => (JSON.parse(readFileSync(wrightSettingsPath(dataDir), "utf8")) as { model?: unknown }).model).toBe(NEW_WRIGHT_MODEL);
  await expect(inspector.getByText(`Model set to ${NEW_WRIGHT_MODEL}.`)).toBeVisible();

  // Every stand-in session had its driver, and every driver ran.
  noFailures();
  expect([s.wright.length, s.reviewer.length, s.playbook.length]).toEqual([0, 0, 0]);
});
