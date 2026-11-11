// Chat's charter card in the built app against the fixture kernel (phase 8
// item 18d): a held charter past the old 4,000-character cut opens compact (no
// kernel tool name, JSON or file path), shows every character on Show full
// details, Copy all text puts the exact stored display on the clipboard (read
// back from the main process), Ask or change posts a Reply continuing the
// drafting message, a v2 collapses the withdrawn v1 to "Replaced by v2", and
// the workspace question posts a chosen folder, refuses a protected one in the
// kernel's words, and posts a clone request saying nothing was cloned.
//
// Fake data only (no real kernel); the folder picker is the main process's
// `dialog.showOpenDialog`, replaced before any click, so no native dialog opens.
// Asserts behaviour, never pixels: it writes no screenshot.
//
// Run `npm run build` first; then `npx playwright test e2e/chat-charter-card.spec.ts`.
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import type { Approval, AskBody, BrainMessage, SavedWorkspace, ThreadItem } from "../src/api/contract";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel, FixtureRequest } from "./fixture-kernel";

const AT = "2026-11-11T08:00:00.000Z";
const K = "mcp__kernel__";
const SESSION = 31;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

/** `role.md` long enough that the whole display is past 4,000 characters; its last line is what the old cut hid. */
const ROLE = ["# Mason", "", ...Array.from({ length: 60 }, (_, i) => `- Note ${i + 1}: hand acme/widgets tickets to /automate and say what changed, in plain words.`), "LAST LINE: the old cut hid this."];

function display(opts: { readonly jobs: readonly string[]; readonly workspace?: string }): string {
  return [
    'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
    "readiness: checked by the kernel before you see it",
    "  covered: duty 1 by Hand tickets to /automate: Turn acme/widgets tickets into PRs",
    opts.workspace === undefined ? "  flagged: the code jobs: it has no copy of a repo to work in (no workspace is listed)" : `  ready: the code jobs: works in acme/widgets at ${opts.workspace}`,
    ...opts.jobs.flatMap((j) => [`job: ${j}`, `  - Used for ${j.toLowerCase()}.`]),
    `enforced: never: git_push; tools: Read, ${K}kernel_automate_prepare; bash prefixes: "gh pr"; connectors: github`,
    "limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
    `workspaces: ${opts.workspace ?? "none"}`,
    "config/agents/mason.json:",
    "{",
    '  "model": "claude-sonnet-5"',
    "}",
    "memory/mason/role.md:",
    ...ROLE,
  ].join("\n");
}

const V1 = display({ jobs: ["Hand tickets to /automate"] });
const V2 = display({ jobs: ["Hand tickets to /automate", "Triage PR comments"], workspace: "/Users/me/code/widgets" });

function charter(id: number, text: string, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "wright",
    requesting_session: SESSION,
    action: "kernel_agent_create",
    payload: { tool: `${K}kernel_agent_create`, input: { charter: { id: "mason" } } },
    requested_at: AT,
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    display: text,
    ...overrides,
  };
}

function drafting(): ThreadItem {
  const m: BrainMessage = {
    id: 4,
    queue_id: 4,
    agent: "wright",
    source: "ask",
    text: "Draft me a crew member for acme/widgets.",
    status: "replied",
    session_id: SESSION,
    reply_text: "Here's Mason's charter, waiting on you.",
    detail: null,
    created_at: AT,
    updated_at: AT,
    from_agent: null,
    depth: 0,
    reply_to: null,
    workspace: null,
  };
  return { type: "message", ...m, thread_id: 4 };
}

interface Scenario {
  readonly asks: AskBody[];
  readonly saves: unknown[];
}

async function launch(opts: { readonly replaced?: boolean; readonly saved?: readonly SavedWorkspace[] } = {}): Promise<{ readonly page: Page; readonly s: Scenario }> {
  const s: Scenario = { asks: [], saves: [] };
  const pending = opts.replaced === true ? [charter(9, V2)] : [charter(9, V1)];
  const all = opts.replaced === true ? [charter(8, V1, { status: "denied", decision: "deny", decided_by: "kernel", decided_at: AT, replaced_by: 9 }), ...pending] : pending;
  const items: ThreadItem[] = [drafting()];
  fixture = await startFixtureKernel({
    routes: {
      "GET /agents": () => ({ status: 200, body: { agents: [{ id: "wright", display_name: "Wright", avatar: { shape: "whale", hue: "accent" }, status: "on", created_by: null, approval_id: null, model: null, settings_error: null, tokens_today: 0, tokens_per_day: null, sessions_running: 0, sessions_at_once: null }] } }),
      "GET /threads/:agent": () => ({ status: 200, body: { items, next_before: null, pending_approvals: pending, threads: [{ id: 4, agent: "wright", title: "Mason's charter", renamed: false, messages: 1, latest_reply_tokens: null, summary_estimated_tokens: null }] } }),
      "GET /approvals": (req: FixtureRequest) => ({ status: 200, body: { approvals: req.query.all === "1" ? all : pending } }),
      "GET /playbooks": () => ({ status: 200, body: { playbooks: [] } }),
      "GET /triggers": () => ({ status: 200, body: { triggers: [] } }),
      "GET /messages": () => ({ status: 200, body: { messages: [] } }),
      "GET /notifications": () => ({ status: 200, body: { notifications: [] } }),
      "GET /workspaces": () => ({ status: 200, body: { workspaces: opts.saved ?? [] } }),
      "POST /workspaces": (req: FixtureRequest) => {
        s.saves.push(req.body);
        const path = (req.body as { path?: unknown } | undefined)?.path;
        if (typeof path === "string" && path.includes("/Documents/")) return { status: 400, body: { error: "protected_folder", message: "~/Documents is a protected folder, so Studio won't work inside it (D31)" } };
        return { status: 200, body: { workspace: { id: 7, path, repo: "acme/widgets", added_at: AT, last_used_at: AT, state: "ready" }, note: null } };
      },
      "POST /ask": (req: FixtureRequest) => {
        s.asks.push(req.body as AskBody);
        return { status: 202, body: { message_id: 200, queue_id: 200 } };
      },
    },
  });
  app = await launchApp(fixture.env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  return { page, s };
}

/** Replace the main process's folder dialog with one answering `chosen`. */
async function scriptPicker(chosen: string): Promise<void> {
  await app?.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, chosen);
}

test("AC1 + AC2 + AC3: compact first; Show full details shows every character in its blocks; Copy all text puts the exact display on the clipboard", async () => {
  expect(V1.length).toBeGreaterThan(4000);
  const { page } = await launch();
  const card = page.getByRole("region", { name: "Drafted crew member, approval 9" });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("charter-never")).toHaveText("Push to a git remote");
  await expect(card.getByTestId("charter-limits")).toHaveText("200,000 tokens a day · 1 session at once · no delegation depth limit");
  const compact = (await card.textContent()) ?? "";
  for (const hidden of [K, "config/agents/", "role.md", '"model"']) expect(compact).not.toContain(hidden);

  // The tooltip is the button's name, on keyboard focus.
  await card.getByRole("button", { name: "Show full details" }).focus();
  await card.getByRole("button", { name: "Show full details" }).click();
  await expect(card.getByTestId("charter-total")).toHaveText(`${V1.length.toLocaleString("en-US")} characters, nothing cut`);
  await expect(card.getByTestId("charter-block-role")).toContainText("LAST LINE: the old cut hid this.");
  // Each block scrolls inside the card.
  const role = card.getByTestId("charter-block-role").getByRole("region");
  expect(await role.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  await app?.evaluate(({ clipboard }) => clipboard.writeText(""));
  await card.getByRole("button", { name: "Copy all text" }).click();
  await expect(card.getByTestId("charter-copied")).toHaveText(`Copied ${V1.length.toLocaleString("en-US")} characters`);
  await expect.poll(() => app?.evaluate(({ clipboard }) => clipboard.readText())).toBe(V1);
});

test("AC4: Ask or change posts a Reply continuing the drafting message; a v2 collapses the withdrawn v1 to Replaced by v2 with what changed", async () => {
  const first = await launch();
  const card = first.page.getByRole("region", { name: "Drafted crew member, approval 9" });
  await expect(card.getByTestId("charter-ask-where")).toContainText("“Mason's charter”");
  await card.getByRole("textbox", { name: "Ask or change" }).fill("add comment replies");
  await card.getByRole("textbox", { name: "Ask or change" }).press("Enter");
  await expect.poll(() => first.s.asks).toEqual([{ text: "From the card's Ask or change (approval 9): add comment replies", agent: "wright", continues: 4 }]);
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;

  const second = await launch({ replaced: true });
  const old = second.page.getByTestId("charter-old");
  await expect(old.locator("summary")).toHaveText("mason · v1 · Replaced by v2 · adds Triage PR comments; workspace set");
  await expect(second.page.getByRole("region", { name: "Drafted crew member, approval 9" }).locator(".chat-card-meta")).toContainText("mason · v2 · approval 9");
});

test("AC5 + AC10 + AC13: the workspace question posts a chosen folder, refuses a protected one in the kernel's words, and posts a clone request", async () => {
  const { page, s } = await launch();
  const card = page.getByRole("region", { name: "Drafted crew member, approval 9" });
  await card.getByRole("button", { name: "Choose workspace" }).click();
  const question = card.getByTestId("charter-workspace-question");
  await expect(question.getByRole("heading")).toHaveText("Where's your copy of acme/widgets?");
  // AC8: nothing saved matches: Choose folder… and Clone it for me only.
  await expect(question.getByTestId("charter-wsq-offers").getByRole("button")).toHaveText(["Choose folder…", "Clone it for me"]);

  await scriptPicker("/Users/me/Documents/widgets");
  await question.getByRole("button", { name: "Choose folder…" }).click();
  await expect(question.getByTestId("charter-wsq-refusal")).toHaveText("Not used: ~/Documents is a protected folder, so Studio won't work inside it (D31). Nothing was sent to Wright; choose another folder.");
  expect(s.asks).toEqual([]);

  await scriptPicker("/Users/me/code/widgets");
  await question.getByRole("button", { name: "Choose folder…" }).click();
  await expect.poll(() => s.asks).toEqual([{ text: "Use the workspace at /Users/me/code/widgets for mason (from the card's workspace question)", agent: "wright", continues: 4 }]);
  await expect(question.getByTestId("charter-wsq-sent")).toHaveText("Sent to Wright. It proposes a new version with this folder; nothing changes until you approve it.");

  await question.getByRole("button", { name: "Clone it for me" }).click();
  await expect.poll(() => s.asks.length).toBe(2);
  expect(s.asks[1]).toEqual({ text: "Clone acme/widgets for mason (from the card's workspace question)", agent: "wright", continues: 4 });
  await expect(question.getByTestId("charter-wsq-sent")).toHaveText("Cloning isn't built yet; nothing was cloned. Wright has your request.");
});
