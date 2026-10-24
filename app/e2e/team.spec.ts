// The Team screen (phase 5 item 14) in the built app against the fixture
// kernel (`./fixtures/team.ts`): the cards (AC1), the reviewer's inspector
// with its enforced permissions apart from its guidance (AC3), create and
// rename driven by the keyboard alone (AC9), the new card arriving from the
// feed and never from a local insert (AC6), "Ask Wright to draft it" (AC7),
// a light and a dark screenshot of every designed state (AC10), and two
// members of the same name told apart, with the off one last in the Crew
// sidebar (`told-apart`). Run `npm run build` first.
//
// Loading cannot be held open by the fixture (a `FixtureRoute` answers
// synchronously), so that one state is the real `App` in a gallery window
// (`launchGallery`) over a bridge whose reads never answer, built the
// components specs' way into the gitignored `app/node_modules/.cache/`.
//
// Screenshots: with `TEAM_EVIDENCE=1` they are written to the committed
// evidence dir `docs/evidence/phase-5-polish/team/`; otherwise to
// Playwright's per-test output dir, so CI never dirties tracked files. The
// spec asserts behaviour, never pixels: fonts differ between macOS and CI.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { SHAPES } from "../src/components/Avatar/creatures";
import { APP_DIR, launchApp, launchGallery } from "./electron-harness";
import type { Gallery } from "./electron-harness";
import { appEnv, cannedStatus, startFixtureKernel, unreachableDataDir } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { MASON_APPROVAL, MASON_CHARTER, MASON_NEVER, MASON_TOOL_POLICY, REVIEWER_NEW, REVIEWER_OLD, TEAM_DATA_DIR, WRIGHT_RUNNING, teamFixture } from "./fixtures/team";
import type { TeamFixture } from "./fixtures/team";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-5-polish/team/", import.meta.url));
const THEMES = ["light", "dark"] as const;
/** The app window's size (`electron/main.ts`), for the gallery too. */
const WINDOW = { width: 1180, height: 760 } as const;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
let gallery: Gallery | undefined;
let galleryTemp: string | undefined;
const pageErrors: string[] = [];

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await gallery?.close();
  gallery = undefined;
  if (galleryTemp !== undefined) rmSync(galleryTemp, { recursive: true, force: true });
  galleryTemp = undefined;
  await fixture?.close();
  fixture = undefined;
  // Drained per test, so an error is reported against the test that caused it.
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

function watch(page: Page): Page {
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return page;
}

/** Launch the built app on `env` and wait for the shell. */
async function launch(env: Readonly<Record<string, string>>): Promise<Page> {
  app = await launchApp(env);
  const page = watch(await app.firstWindow());
  await expect(page.getByTestId("sidebar")).toBeVisible();
  return page;
}

/** Start `team`'s fixture kernel, launch the app on it, and open Team. */
async function openTeam(team: TeamFixture): Promise<Page> {
  fixture = await startFixtureKernel(team.options);
  team.attach(fixture);
  const page = await launch(fixture.env);
  await page.evaluate(() => {
    window.location.hash = "#/team";
  });
  await expect(page.getByTestId("screen-team")).toBeVisible();
  return page;
}

function grid(page: Page): Locator {
  return page.getByRole("group", { name: "Agents" });
}

function card(page: Page, name: string): Locator {
  return grid(page).getByRole("button", { name, exact: true });
}

async function setTheme(page: Page, theme: (typeof THEMES)[number] | undefined): Promise<void> {
  await page.evaluate((value) => {
    if (value === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  }, theme);
}

/** Resolves after two animation frames, so any pending React commit and layout have landed. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** `team-<state>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  const evidence = process.env.TEAM_EVIDENCE === "1";
  if (evidence) mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = `team-${state}-${theme}.png`;
    const path = evidence ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

/** Counts pointer input from here on: the keyboard-only tests assert it stays 0. */
async function countPointer(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __pointerInput?: number };
    w.__pointerInput = 0;
    for (const type of ["pointerdown", "mousedown", "click"]) {
      window.addEventListener(
        type,
        (event) => {
          // A keyboard activation of a button fires a synthetic click with detail 0; a pointer's has detail >= 1.
          if (event.type !== "click" || (event as MouseEvent).detail > 0) w.__pointerInput = (w.__pointerInput ?? 0) + 1;
        },
        true,
      );
    }
  });
  return () => page.evaluate(() => (window as unknown as { __pointerInput?: number }).__pointerInput ?? -1);
}

/** Press Tab until `target` has focus; fails when it never does. */
async function tabTo(page: Page, target: Locator, what: string, max = 60): Promise<void> {
  await expect(target, `${what} is on the page`).toHaveCount(1);
  for (let i = 0; i <= max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    if (i < max) await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${what} in ${max} presses`);
}

test("AC1: Wright and two crew members are three cards, Wright first as the whale, each with role, task, tokens, sessions and status", async ({}, testInfo) => {
  const page = await openTeam(teamFixture());
  const cards = grid(page).getByTestId("team-card");
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-agent-id")))).toEqual(["wright", "mason", "ada"]);
  await expect(grid(page)).toHaveCSS("display", "grid");

  // Wright is the whale with the crown; the crew are not.
  const whaleBody = SHAPES.whale.parts.find((p) => p.tag === "path");
  expect(whaleBody?.tag).toBe("path");
  const wright = card(page, "Wright");
  await expect(wright.locator(".bot.lead .crown")).toHaveCount(1);
  await expect(wright.locator("g.rig > path").first()).toHaveAttribute("d", whaleBody?.tag === "path" ? whaleBody.d : "");
  await expect(card(page, "Mason").locator(".crown")).toHaveCount(0);
  await expect(card(page, "Ada").locator(".crown")).toHaveCount(0);

  const rows: readonly (readonly [string, string, string, string, string, string, string])[] = [
    // name, role, task, dot, tokens, sessions, status
    ["Wright", "Lead agent", WRIGHT_RUNNING.text, "working", "48k of 500k today", "1 of 3 sessions", "active"],
    ["Mason", MASON_CHARTER.persona, "idle", "idle", "14k today · no limit", "0 sessions · no limit", "active"],
    ["Ada", "Keeps the owner's notes and reading list tidy.", "idle", "idle", "9k of 250k today", "0 of 2 sessions", "off"],
  ];
  for (const [name, role, task, dot, tokens, sessions, status] of rows) {
    const c = card(page, name);
    await expect(c.getByTestId("team-card-role")).toHaveText(role);
    await expect(c.getByTestId("team-card-task")).toHaveText(task);
    await expect(c.locator(".card-task-dot .status-dot")).toHaveAttribute("data-state", dot);
    await expect(c.getByTestId("team-card-budget")).toHaveText(tokens);
    await expect(c.getByTestId("team-card-sessions")).toHaveText(sessions);
    await expect(c.getByTestId("team-card-status")).toHaveText(status);
  }

  // The long persona is clamped at two lines in the real layout, and whole in the tooltip.
  const role = card(page, "Mason").getByTestId("team-card-role");
  await expect(card(page, "Mason")).toHaveAttribute("title", MASON_CHARTER.persona);
  const clamp = await role.evaluate((el) => ({ lines: getComputedStyle(el).webkitLineClamp, clipped: el.scrollHeight > el.clientHeight + 1 }));
  expect(clamp).toEqual({ lines: "2", clipped: true });

  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await screenshots(page, "populated", testInfo);
});

test("waiting on you: a crew member's pending approval is its task line", async ({}, testInfo) => {
  const page = await openTeam(teamFixture({ waiting: true }));
  const mason = card(page, "Mason");
  await expect(mason.getByTestId("team-card-task")).toHaveText(`Waiting on you · ${MASON_APPROVAL.display ?? ""}`);
  await expect(mason.locator(".card-task-dot .status-dot")).toHaveAttribute("data-state", "waiting");
  // The others are unchanged.
  await expect(card(page, "Wright").getByTestId("team-card-task")).toHaveText(WRIGHT_RUNNING.text);
  await expect(card(page, "Ada").getByTestId("team-card-task")).toHaveText("idle");
  await screenshots(page, "waiting", testInfo);
});

test("told apart: two members of the same name show their ids on Team and in the Crew sidebar; the off Ada is last, dimmed and says off", async ({}, testInfo) => {
  const page = await openTeam(teamFixture({ collision: true }));
  const cards = grid(page).getByTestId("team-card");
  await expect(cards).toHaveCount(4);
  // Team keeps the kernel's order (Wright first); only the Crew sidebar moves off members last.
  expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-agent-id")))).toEqual(["wright", REVIEWER_OLD.id, "ada", REVIEWER_NEW.id]);
  for (const reviewer of [REVIEWER_OLD, REVIEWER_NEW]) {
    const c = grid(page).locator(`[data-agent-id="${reviewer.id}"]`);
    await expect(c.getByTestId("team-card-id")).toHaveText(reviewer.id);
    await expect(c.locator(".card-name")).toHaveAttribute("title", reviewer.id);
  }
  await expect(card(page, "Ada").getByTestId("team-card-id")).toHaveCount(0);
  await expect(card(page, "Wright").getByTestId("team-card-id")).toHaveCount(0);
  // Wright's running message is on its live session 12: still working.
  await expect(card(page, "Wright").getByTestId("team-card-task")).toHaveText(WRIGHT_RUNNING.text);

  const crew = page.getByRole("region", { name: "Crew" });
  const rows = crew.getByRole("button");
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-agent")))).toEqual([REVIEWER_OLD.id, REVIEWER_NEW.id, "ada"]);
  for (const reviewer of [REVIEWER_OLD, REVIEWER_NEW]) {
    const row = crew.locator(`[data-agent="${reviewer.id}"]`);
    await expect(row.getByTestId("crew-id")).toHaveText(reviewer.id);
    await expect(row).toHaveAttribute("title", reviewer.id);
    await expect(row).toHaveAttribute("aria-label", `${reviewer.display_name} (${reviewer.id})`);
  }
  const ada = crew.getByRole("button", { name: "Ada, off", exact: true });
  await expect(ada).toHaveClass(/(^|\s)off(\s|$)/);
  await expect(ada.getByTestId("crew-off")).toHaveText("off");
  await expect(ada.getByTestId("crew-id")).toHaveCount(0);
  // Dimmed, never hidden: the row is shown at the dimmed opacity and is still a working button.
  expect(Number(await ada.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
  await expect(ada).toBeVisible();
  await expect(ada).toBeEnabled();

  await screenshots(page, "told-apart", testInfo);
});

test("empty: Wright alone is one card and the crew's empty note", async ({}, testInfo) => {
  const page = await openTeam(teamFixture({ crew: false }));
  await expect(grid(page).getByTestId("team-card")).toHaveCount(1);
  await expect(card(page, "Wright")).toBeVisible();
  await expect(page.getByTestId("team-empty")).toHaveText("No crew members yet. Create one from a charter, or ask Wright to propose one from a duty.");
  await expect(page.getByTestId("screen-team").getByText("1 agent", { exact: true })).toBeVisible();
  await screenshots(page, "empty", testInfo);
});

test("error: with no kernel answering, Team shows its error under the kernel-unreachable band", async ({}, testInfo) => {
  const page = await launch(appEnv(await unreachableDataDir()));
  await page.evaluate(() => {
    window.location.hash = "#/team";
  });
  await expect(page.getByTestId("kernel-unreachable-band")).toContainText("Couldn't reach the kernel");
  const error = page.getByTestId("team-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Couldn't load the team");
  await expect(page.getByTestId("team-card")).toHaveCount(0);
  await screenshots(page, "error", testInfo);
});

test("loading: before GET /agents answers, Team shows three skeleton cards", async ({}, testInfo) => {
  test.setTimeout(120_000);
  // A gallery of the real App over a bridge whose reads never answer (only /status does).
  const src = join(APP_DIR, "node_modules", ".cache", "team-gallery");
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  writeFileSync(
    join(src, "index.html"),
    `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" /><title>Team loading</title></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>\n`,
  );
  writeFileSync(
    join(src, "entry.tsx"),
    `// Generated by app/e2e/team.spec.ts. Do not edit: rewritten on every run.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles/tokens.css";
import "../../../src/styles/app.css";
import { App } from "../../../src/App";

const STATUS = ${JSON.stringify(cannedStatus())};
const connected = { state: "connected", port: 1 };
Object.defineProperty(window, "api", {
  value: {
    connection: async () => connected,
    request: (req) => (req.method === "GET" && req.path === "/status" ? Promise.resolve({ ok: true, status: 200, body: STATUS }) : new Promise(() => undefined)),
    feed: { subscribe: async () => connected, unsubscribe: async () => undefined, onFrame: () => () => undefined },
    onNavigate: () => () => undefined,
  },
});
window.location.hash = "#/team";
const root = document.getElementById("root");
if (!root) throw new Error("gallery: #root missing");
createRoot(root).render(<StrictMode><App /></StrictMode>);
`,
  );
  galleryTemp = mkdtempSync(join(tmpdir(), "team-gallery-"));
  const outDir = join(galleryTemp, "dist");
  try {
    await build({ root: src, configFile: false, base: "./", plugins: [react()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
  gallery = await launchGallery({ file: join(outDir, "index.html") }, WINDOW);
  const page = watch(gallery.page);
  await expect(page.getByTestId("screen-team")).toBeVisible();
  await expect(page.getByTestId("team-loading").locator(".team-skeleton")).toHaveCount(3);
  await expect(page.getByRole("status").filter({ hasText: "Loading the team…" })).toHaveCount(1);
  await expect(page.getByTestId("team-card")).toHaveCount(0);
  await screenshots(page, "loading", testInfo);
});

test("AC3: the reviewer's inspector shows its enforced permissions apart from its guidance, and Wright's is never fetched", async ({}, testInfo) => {
  const page = await openTeam(teamFixture());
  await card(page, "Mason").click();
  const inspector = page.getByTestId("team-inspector");
  await expect(inspector.getByRole("heading", { name: "Mason", level: 2 })).toBeVisible();
  await expect(inspector.getByTestId("team-insp-role")).toHaveText(MASON_CHARTER.persona);

  const enforced = inspector.getByTestId("team-enforced");
  await expect(enforced.getByRole("heading", { level: 3 })).toHaveText("Permissions · enforced by the kernel");
  const items = (testId: string) => enforced.getByTestId(testId).getByRole("listitem");
  await expect(enforced.getByTestId("team-enforced-tools")).toContainText("Allowed tools");
  await expect(items("team-enforced-tools")).toHaveText([...MASON_TOOL_POLICY.allowedTools]);
  await expect(enforced.getByTestId("team-enforced-bash")).toContainText("Bash prefixes");
  await expect(items("team-enforced-bash")).toHaveText([...MASON_TOOL_POLICY.allowedBashPrefixes]);
  await expect(items("team-enforced-never")).toHaveText([...MASON_NEVER]);
  for (const sub of ["team-enforced-tools", "team-enforced-bash", "team-enforced-never"]) {
    await expect(enforced.getByTestId(sub).getByText("enforced", { exact: true })).toBeVisible();
  }

  // The charter's prose boundaries are guidance, in their own section.
  const guidance = inspector.getByTestId("team-guidance");
  await expect(guidance.getByRole("heading", { level: 3 })).toHaveText("Boundaries · guidance, not enforced");
  await expect(guidance.getByRole("listitem")).toHaveText([...MASON_CHARTER.boundaries]);
  await expect(guidance).not.toContainText("git_push");
  await expect(enforced).not.toContainText(MASON_CHARTER.boundaries[0]);

  // Model, limits, workspaces and memory files as plain paths.
  const limits = inspector.getByTestId("team-insp-limits");
  await expect(limits).toContainText("claude-sonnet-5");
  await expect(limits).toContainText("14k tokens today · no limit");
  await expect(limits).toContainText("default");
  await expect(inspector.getByText("/srv/repos/site", { exact: true })).toBeVisible();
  const memory = inspector.getByTestId("team-insp-memory").getByRole("listitem");
  await expect(memory.first()).toHaveText(`${TEAM_DATA_DIR}/config/agents/mason.json`);
  await expect(memory.nth(1)).toHaveText(`${TEAM_DATA_DIR}/memory/mason/role.md`);
  await expect(memory.nth(4)).toHaveText(`${TEAM_DATA_DIR}/memory/mason/lessons.md (missing)`);
  await screenshots(page, "inspector", testInfo);

  // Wright's inspector: read-only fields say where to edit them, and its detail is never requested.
  await card(page, "Wright").click();
  await expect(inspector.getByRole("heading", { name: "Wright", level: 2 })).toBeVisible();
  await expect(inspector.getByTestId("team-wright-readonly")).toHaveText("read-only · edit wright.json");
  await expect(inspector.getByTestId("team-enforced")).toHaveCount(0);
  const kernel = fixture;
  expect(kernel?.requests.some((r) => r.method === "GET" && r.path === "/agents/mason"), "crew details were fetched (non-vacuous)").toBe(true);
  expect(kernel?.requests.filter((r) => r.path === "/agents/wright")).toEqual([]);
});

test("AC6 + AC9: create by keyboard alone calls POST /agents once; the card appears only from the feed's agent_created", async ({}, testInfo) => {
  const team = teamFixture();
  const page = await openTeam(team);
  await expect(grid(page).getByTestId("team-card")).toHaveCount(3);
  const pointer = await countPointer(page);
  const kb = page.keyboard;

  await tabTo(page, page.getByRole("button", { name: "New crew member" }), "New crew member");
  await kb.press("Enter");
  const form = page.getByTestId("team-new");
  await expect(form.getByRole("heading", { name: "New crew member" })).toBeFocused();
  // The designed state as it opens: empty, no presets.
  await expect(form.getByRole("textbox", { name: "Id" })).toHaveValue("");
  await expect(form.getByRole("combobox", { name: "Permission mode" })).toHaveValue("");
  await screenshots(page, "new-crew-member", testInfo);

  const field = async (name: string, text: string) => {
    await tabTo(page, form.getByRole("textbox", { name, exact: true }), name);
    await kb.type(text);
  };
  await field("Id", "scout");
  await field("Name", "Scout");

  // The shape picker: its own dialog, a radio group.
  await tabTo(page, form.getByRole("button", { name: "Pick a shape…" }), "Pick a shape…");
  await kb.press("Enter");
  const shapes = page.getByRole("dialog", { name: "Shape" });
  await tabTo(page, shapes.getByRole("radio", { name: "shark" }), "the first shape");
  await kb.press("ArrowRight");
  await expect(shapes.getByRole("radio", { name: "seahorse" })).toBeChecked();
  await tabTo(page, shapes.getByRole("button", { name: "Use shape" }), "Use shape");
  await kb.press("Enter");
  await expect(shapes).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Shape: seahorse" })).toBeFocused();

  await tabTo(page, form.getByRole("combobox", { name: "Hue" }), "Hue");
  await kb.type("teal");
  await expect(form.getByRole("combobox", { name: "Hue" })).toHaveValue("crew-teal");
  await field("Persona", "Watches the site's uptime and says so plainly.");
  await field("Duties", "Check the site every morning\nReport an outage in the thread");
  await field("Boundaries", "Never restart anything");
  await field("Model", "claude-sonnet-5");
  await tabTo(page, form.getByRole("combobox", { name: "Permission mode" }), "Permission mode");
  await kb.type("default");
  await expect(form.getByRole("combobox", { name: "Permission mode" })).toHaveValue("default");

  // The tool picker: its own dialog.
  await tabTo(page, form.getByRole("button", { name: "Choose tools…" }), "Choose tools…");
  await kb.press("Enter");
  const tools = page.getByRole("dialog", { name: "Tools Scout may use" });
  await tabTo(page, tools.getByRole("textbox", { name: "Allowed tools" }), "Allowed tools");
  await kb.type("Read Grep");
  await tabTo(page, tools.getByRole("textbox", { name: "Bash prefixes" }), "Bash prefixes");
  await kb.type("curl -sI");
  await tabTo(page, tools.getByRole("checkbox", { name: "git_push" }), "never git_push");
  await kb.press("Space");
  await expect(tools.getByRole("checkbox", { name: "git_push" })).toBeChecked();
  await tabTo(page, tools.getByRole("button", { name: "Use these" }), "Use these");
  await kb.press("Enter");
  await expect(tools).toHaveCount(0);
  await expect(form.getByTestId("team-tool-summary")).toHaveText("tools: Read, Grep · Bash: curl -sI · never: git_push");

  await field("Tokens per day", "200000");
  await field("Sessions at once", "1");
  await field("Workspaces", "/srv/repos/site");

  await tabTo(page, form.getByRole("button", { name: "Create" }), "Create");
  await kb.press("Enter");

  // The 201: the form closes and says the card arrives from the feed.
  await expect(page.getByTestId("team-notice")).toHaveText("Scout was created. Its card appears as soon as the kernel's feed reports it.");
  await expect(form).toHaveCount(0);
  expect(team.creates).toEqual([
    {
      id: "scout",
      display_name: "Scout",
      avatar: { shape: "seahorse", hue: "crew-teal" },
      persona: "Watches the site's uptime and says so plainly.",
      duties: ["Check the site every morning", "Report an outage in the thread"],
      boundaries: ["Never restart anything"],
      model: "claude-sonnet-5",
      permission_mode: "default",
      tool_policy: { allowedTools: ["Read", "Grep"], allowedBashPrefixes: ["curl -sI"], never: ["git_push"] },
      limits: { tokens_per_day: 200000, sessions_at_once: 1 },
      workspaces: ["/srv/repos/site"],
    },
  ]);

  // Not from a local insert: no card until the feed says so (past the store's refetch throttle).
  const cards = grid(page).getByTestId("team-card");
  await page.waitForTimeout(750);
  await expect(cards).toHaveCount(3);
  await expect(card(page, "Scout")).toHaveCount(0);

  const created = team.publishCreated();
  fixture?.appendEvent(team.event("agent_created", { id: created.id, by: "owner", approval_id: null }));
  await expect(cards).toHaveCount(4);
  const scout = card(page, "Scout");
  await expect(scout.getByTestId("team-card-role")).toHaveText("Watches the site's uptime and says so plainly.");
  await expect(scout.getByTestId("team-card-budget")).toHaveText("0 of 200k today");
  await expect(scout.getByTestId("team-card-sessions")).toHaveText("0 of 1 session");
  expect(team.creates).toHaveLength(1);
  expect(await pointer(), "no pointer input").toBe(0);
});

test("AC9: rename by keyboard alone calls POST /agents/:id/rename, and the card takes the name from the feed", async () => {
  const team = teamFixture();
  const page = await openTeam(team);
  await expect(grid(page).getByTestId("team-card")).toHaveCount(3);
  const pointer = await countPointer(page);
  const kb = page.keyboard;

  await tabTo(page, card(page, "Mason"), "Mason's card");
  await kb.press("Enter");
  const inspector = page.getByTestId("team-inspector");
  await expect(inspector.getByRole("heading", { name: "Mason", level: 2 })).toBeFocused();
  await tabTo(page, inspector.getByRole("button", { name: "Rename" }), "Rename");
  await kb.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename Mason" });
  const name = dialog.getByRole("textbox", { name: "Name" });
  await tabTo(page, name, "the name field");
  await kb.press("ControlOrMeta+A");
  await kb.type("Marlow");
  await expect(name).toHaveValue("Marlow");
  await kb.press("Enter");

  await expect(dialog).toHaveCount(0);
  expect(team.renames).toEqual([{ id: "mason", body: { display_name: "Marlow" } }]);
  await expect(card(page, "Marlow")).toBeVisible();
  await expect(card(page, "Mason")).toHaveCount(0);
  expect(await grid(page).getByTestId("team-card").evaluateAll((els) => els.map((el) => el.getAttribute("data-agent-id")))).toEqual(["wright", "mason", "ada"]);

  // Focus is back on the inspector's Rename; Escape closes the inspector and gives focus back to the card.
  await expect(inspector.getByRole("button", { name: "Rename" })).toBeFocused();
  await kb.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(card(page, "Marlow")).toBeFocused();
  expect(await pointer(), "no pointer input").toBe(0);
});

test("AC7: Ask Wright to draft it sends the owner's words through POST /ask and opens Chat; nothing is created", async () => {
  const team = teamFixture();
  const page = await openTeam(team);
  const kb = page.keyboard;
  await tabTo(page, page.getByRole("button", { name: "New crew member" }), "New crew member");
  await kb.press("Enter");
  const form = page.getByTestId("team-new");
  await tabTo(page, form.getByRole("textbox", { name: "What should it do?" }), "What should it do?");
  await kb.type("Watch my site's uptime every morning.");
  await tabTo(page, form.getByRole("button", { name: "Ask Wright to draft it" }), "Ask Wright to draft it");
  await kb.press("Enter");

  await expect(page.getByTestId("screen-chat")).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe("#/chat");
  expect(team.asks).toEqual([
    { text: "Draft a charter for a new crew member, for me to review before anything is created. What it should do, in my words: Watch my site's uptime every morning." },
  ]);
  expect(team.creates).toEqual([]);
  expect(fixture?.requests.filter((r) => r.method === "POST" && r.path === "/agents")).toEqual([]);
});
