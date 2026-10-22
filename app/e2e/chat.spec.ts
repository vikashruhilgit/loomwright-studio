// The Chat screen in the built app against the fixture kernel (phase 5 item
// 13): sending to Wright and seeing the reply when the row turns `replied`
// (AC1), a crew thread with its workspace picker (AC2), a keyboard-only walk
// that reaches every action with Tab / Shift+Tab and runs them with Enter or
// Space (AC9), and one screenshot per designed state per theme, written to
// docs/evidence/phase-5-polish/chat/ (AC9).
//
// The loading state needs a thread read that has not answered yet: a small
// loopback proxy in front of the fixture holds `GET /threads/wright` open
// (everything else, the feed's upgrade included, passes through).
//
// Run `npm run build` first; then `npx playwright test e2e/chat.spec.ts`.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { connect } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import type { EventFrame } from "../src/api/contract";
import { APP_DIR, launchApp } from "./electron-harness";
import { FIXTURE_HOST, appEnv, startFixtureKernel, tempDataDir, unreachableDataDir } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { chatFixture } from "./fixtures/chat";
import type { ChatScenario } from "./fixtures/chat";

const EVIDENCE_DIR = resolve(APP_DIR, "..", "docs/evidence/phase-5-polish/chat");
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** Tall enough that the populated thread's cards are all in view. */
const SHOT_SIZE = { width: 1180, height: 1500 } as const;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
let proxy: { close(): Promise<void> } | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await proxy?.close();
  proxy = undefined;
  await fixture?.close();
  fixture = undefined;
});

function eventDone(id: number): EventFrame {
  return { type: "event", id, at: new Date().toISOString(), kind: "event_done", session_id: null, task_id: null, payload: {} };
}

async function open(env: Readonly<Record<string, string>>, hash = "#/chat"): Promise<Page> {
  app = await launchApp(env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  return page;
}

async function launchScenario(scenario: ChatScenario, hash = "#/chat"): Promise<{ readonly page: Page; readonly chat: ReturnType<typeof chatFixture> }> {
  const chat = chatFixture(scenario);
  fixture = await startFixtureKernel(chat.options);
  return { page: await open(fixture.env, hash), chat };
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
}

async function resize(size: { readonly width: number; readonly height: number }): Promise<void> {
  await app?.evaluate(({ BrowserWindow }, s) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(s.width, s.height);
  }, size);
}

/** The focused element's name: aria-label, its label, else its text without kbd hints. */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el === document.body) return "";
    const label = el.getAttribute("aria-label");
    if (label !== null) return label;
    const labelled = el.id === "" ? null : document.querySelector(`label[for="${el.id}"]`);
    if (labelled !== null) return labelled.textContent?.trim() ?? "";
    const copy = el.cloneNode(true) as HTMLElement;
    for (const hint of copy.querySelectorAll("kbd, [aria-hidden='true']")) hint.remove();
    return copy.textContent?.trim() ?? "";
  });
}

/** Tab until the focused element is `name` (inside `within` when given), at most `limit` presses. */
async function tabTo(page: Page, name: string, within?: string, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    const here = await focusedName(page);
    const inside = within === undefined ? true : await page.evaluate((sel) => document.activeElement?.closest(sel) !== null, within);
    if (here === name && inside) return;
  }
  throw new Error(`Tab never reached ${name}${within === undefined ? "" : ` in ${within}`}`);
}

/** A loopback proxy to `target` that never answers a request `hold` matches. */
async function holdingProxy(target: number, hold: (req: IncomingMessage) => boolean): Promise<{ readonly port: number; close(): Promise<void> }> {
  const held: ServerResponse[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    if (hold(req)) {
      held.push(res);
      return;
    }
    const upstream = httpRequest({ host: FIXTURE_HOST, port: target, method: req.method, path: req.url, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const upstream = connect(target, FIXTURE_HOST, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  const port = await new Promise<number>((done) => server.listen(0, FIXTURE_HOST, () => done((server.address() as AddressInfo).port)));
  return {
    port,
    close: async () => {
      for (const res of held) res.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

test("AC1: sending to Wright posts agent wright, and the reply appears once the row turns replied", async () => {
  const { page, chat } = await launchScenario("empty");
  await expect(page.getByTestId("chat-empty")).toContainText("Ask Wright anything.");
  const composer = page.getByRole("textbox", { name: "Message Wright" });
  await composer.fill("What changed in Loomwright since yesterday?");
  await composer.press("Enter");
  await expect.poll(() => chat.asks).toEqual([{ text: "What changed in Loomwright since yesterday?", agent: "wright" }]);
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Wright is working on it")).toBeVisible();

  chat.replyAll("Loomwright moved from 15.8.0 to 15.9.0 overnight.");
  fixture?.appendEvent(eventDone(1));
  await expect(page.getByText("Loomwright moved from 15.8.0 to 15.9.0 overnight.")).toBeVisible();
  await expect(page.getByText("Wright is working on it")).toHaveCount(0);
});

test("AC2: a crew thread posts agent pim, with only its listed workspaces on offer", async () => {
  const { page, chat } = await launchScenario("populated");
  // Wright's composer has no picker.
  await expect(page.getByRole("textbox", { name: "Message Wright" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Workspace" })).toHaveCount(0);

  await page.getByTestId("sidebar").getByRole("button", { name: /^Pim/ }).click();
  await expect(page.getByText("with Pim")).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Workspace" });
  await expect(picker.locator("option")).toHaveText(["No workspace", "~/work/a"]);
  await picker.selectOption("~/work/a");
  const composer = page.getByRole("textbox", { name: "Message Pim" });
  await composer.fill("Look at the failing test in ~/work/a.");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => chat.asks).toEqual([{ text: "Look at the failing test in ~/work/a.", agent: "pim", workspace: "~/work/a" }]);
  await expect(composer).toHaveValue("");
});

test("AC9: the keyboard alone reaches every action with Tab / Shift+Tab and runs it with Enter or Space", async () => {
  const { page, chat } = await launchScenario("populated");
  await resize(SHOT_SIZE);
  await expect(page.getByRole("region", { name: "Drafted crew member, approval 9" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Playbook pr-review" })).toBeVisible();

  // One full Tab cycle from the top: every action is in it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  for (let i = 0; i < 70; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(await focusedName(page));
  }
  for (const action of [
    "Pim",
    "Load earlier",
    "Run now",
    "Turn off",
    "Field",
    "Value",
    "Set priority",
    "On",
    "Off",
    "Allow once",
    "Always",
    "Deny",
    "Full payload",
    "Create",
    "Edit in English",
    "Message Wright",
    "Send",
  ]) {
    expect(seen, `Tab reaches ${action}`).toContain(action);
  }
  // Shift+Tab walks back.
  await tabTo(page, "Always");
  await page.keyboard.press("Shift+Tab");
  expect(await focusedName(page)).toBe("Allow once");

  // Enter runs a button; Space runs one too.
  await page.keyboard.press("Enter");
  await expect.poll(() => chat.writes.map((w) => [w.path, w.body])).toContainEqual(["/approvals/7/approve", { decision: "once" }]);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, "Run now");
  await page.keyboard.press("Space");
  await expect.poll(() => chat.writes.map((w) => w.path)).toContain("/playbooks/3/run");
  await tabTo(page, "Set priority");
  await page.keyboard.press("Enter");
  await expect.poll(() => chat.writes.map((w) => [w.path, w.body])).toContainEqual(["/playbooks/3/set", { field: "priority", value: "high" }]);
  await tabTo(page, "Edit in English");
  await page.keyboard.press("Space");
  await expect(page.getByRole("textbox", { name: "Message Wright" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Message Wright" })).toHaveValue("About the charter in approval 9: ");
  expect(chat.asks).toEqual([]);
  await tabTo(page, "Load earlier");
  await page.keyboard.press("Enter");
  await expect(page.getByText("What can you do for me?")).toBeVisible();

  // The Crew row, the workspace picker and Send in Pim's thread.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, "Pim");
  await page.keyboard.press("Enter");
  await expect(page.getByText("with Pim")).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, "Workspace");
  // Type-ahead picks an option on every platform (on macOS an arrow key opens the popup instead).
  await page.keyboard.type("~");
  await expect(page.getByRole("combobox", { name: "Workspace" })).toHaveValue("~/work/a");
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("Message Pim");
  await page.keyboard.type("From the keyboard.");
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("Send");
  await page.keyboard.press("Enter");
  await expect.poll(() => chat.asks).toEqual([{ text: "From the keyboard.", agent: "pim", workspace: "~/work/a" }]);
});

test("AC6: untrusted text in the running app renders inert", async () => {
  const { page } = await launchScenario("populated");
  await expect(page.getByRole("region", { name: "Drafted crew member, approval 9" })).toContainText("<img src=x onerror=alert(1)> stays text");
  await expect(page.getByText("Approval 9 requested (kernel_agent_create) <b>not bold</b>")).toBeVisible();
  await expect(page.getByTestId("screen-chat").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("screen-chat").locator("b")).toHaveCount(0);
});

// ---- AC9 evidence: every designed state, light and dark --------------------------------

interface Shot {
  readonly state: string;
  readonly setup: () => Promise<Page>;
  readonly ready: (page: Page) => Promise<void>;
}

const SHOTS: readonly Shot[] = [
  {
    state: "empty",
    setup: async () => (await launchScenario("empty")).page,
    ready: async (page) => {
      await expect(page.getByTestId("chat-empty")).toBeVisible();
    },
  },
  {
    state: "loading",
    setup: async () => {
      fixture = await startFixtureKernel(chatFixture("populated").options);
      const front = await holdingProxy(fixture.port, (req) => req.method === "GET" && (req.url ?? "").startsWith("/threads/wright"));
      proxy = front;
      const dataDir = tempDataDir();
      writeFileSync(join(dataDir, "api.json"), `${JSON.stringify({ pid: process.pid, port: front.port })}\n`, { mode: 0o600 });
      return open(appEnv(dataDir));
    },
    ready: async (page) => {
      await expect(page.getByTestId("chat-loading")).toBeVisible();
      await expect(page.getByTestId("sidebar").getByRole("button", { name: /^Pim/ })).toBeVisible();
    },
  },
  {
    state: "error",
    setup: async () => open(appEnv(await unreachableDataDir())),
    ready: async (page) => {
      await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible();
      await expect(page.getByTestId("chat-error")).toBeVisible();
    },
  },
  {
    state: "waiting",
    setup: async () => (await launchScenario("waiting")).page,
    ready: async (page) => {
      await expect(page.getByTestId("chat-pending-approval")).toBeVisible();
    },
  },
  {
    state: "populated",
    setup: async () => (await launchScenario("populated")).page,
    ready: async (page) => {
      await expect(page.getByRole("region", { name: "Playbook pr-review" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Trigger 8" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Drafted crew member, approval 9" })).toBeVisible();
      await expect(page.getByText("Paused: retries at")).toBeVisible();
    },
  },
  {
    state: "crew-thread",
    setup: async () => (await launchScenario("populated", "#/chat/pim")).page,
    ready: async (page) => {
      await expect(page.getByText("with Pim")).toBeVisible();
      await expect(page.getByText("It does: the head moved at 08:12.")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Workspace" }).locator("option")).toHaveCount(2);
    },
  },
];

function shotName(state: string, theme: Theme): string {
  return `chat-${state}-${theme}.png`;
}

test("every designed state is screenshot in light and dark", async () => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
  for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png")) rmSync(join(EVIDENCE_DIR, file));
  for (const shot of SHOTS) {
    const page = await shot.setup();
    await resize(SHOT_SIZE);
    await shot.ready(page);
    await page.mouse.move(0, 0);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await shot.ready(page);
      await page.screenshot({ path: join(EVIDENCE_DIR, shotName(shot.state, theme)), scale: "css" });
    }
    await app?.close();
    app = undefined;
    await proxy?.close();
    proxy = undefined;
    await fixture?.close();
    fixture = undefined;
  }
  const written = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png"));
  expect(written.sort()).toEqual(SHOTS.flatMap((s) => THEMES.map((t) => shotName(s.state, t))).sort());
});

test("the evidence README lists every screenshot, and nothing else", async () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const listed = new Set(readme.match(/chat-[a-z-]+-(?:light|dark)\.png/g) ?? []);
  const expected = SHOTS.flatMap((s) => THEMES.map((t) => shotName(s.state, t)));
  expect([...listed].sort()).toEqual([...expected].sort());
});
