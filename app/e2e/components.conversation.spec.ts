// The conversation components evidence page (phase 5, item 10, AC10): every
// state of the ChatBubble, Charter, EventCard, DiffView and StreamingLog
// galleries rendered in Electron, light and dark, with one screenshot per
// state per theme written to docs/evidence/phase-5-polish/components/conversation/.
// It also re-checks in a real layout engine what jsdom cannot: untrusted text
// stays inert (AC2), StreamingLog keeps a scrolled-up reader where they are
// (AC4), and every control is reachable by Tab with a `var(--focus)` ring and
// nothing moves under reduced motion (AC9).
//
// The harness lives entirely in this file, because the app window only loads
// dist/index.html and blocks navigation: a Vite dev server (started here, root
// app/) serves a gallery page whose module imports the tokens, the shell CSS and
// the five `*.gallery.tsx` files, and a throwaway Electron main script in the OS
// temp dir opens a window on it. Nothing here needs a built dist/. This file
// never imports `src/` (tsconfig.node.json has no JSX): the page tags each
// state's wrapper with `data-state-id="<Component>/<id>"` and the spec reads
// the states from the DOM.
//
// Run: cd app && npx playwright test e2e/components.conversation.spec.ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE_DIR = resolve(APP_DIR, "..", "docs/evidence/phase-5-polish/components/conversation");
const COMPONENTS = ["ChatBubble", "Charter", "EventCard", "DiffView", "StreamingLog"] as const;
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const XSS_IMG = "<img src=x onerror=alert(1)>";

const PAGE_PATH = "/conversation-gallery.html";
const ENTRY_URL = "/@conversation-gallery/entry.js";
const ENTRY_ID = "\0conversation-gallery-entry";

// The page's own chrome uses tokens only, like the components it shows.
const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Conversation components</title>
    <style>
      html, body, #root { height: auto; }
      body { background: var(--ground); user-select: text; }
      .gallery { padding: var(--space-4, 16px); max-width: 800px; }
      .gallery h2 { margin: var(--space-4, 16px) 0 var(--space-2, 8px); font-size: var(--type-title-2-size); line-height: var(--type-title-2-line); font-weight: var(--type-title-2-weight); color: var(--ink); }
      .gallery figure { margin: 0 0 var(--space-2, 8px); padding: var(--space-3, 12px) var(--space-4, 16px) var(--space-4, 16px); background: var(--ground); }
      .gallery figcaption { margin-bottom: var(--space-2, 8px); font-size: var(--type-caption-size); line-height: var(--type-caption-line); color: var(--ink-tertiary); }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${ENTRY_URL}"></script>
  </body>
</html>
`;

// Plain JS (no JSX): Vite serves it as-is, after rewriting the imports.
const ENTRY_SOURCE = `
import "/src/styles/tokens.css";
import "/src/styles/app.css";
import { Component, StrictMode, createElement as h, useEffect } from "react";
import { createRoot } from "react-dom/client";
${COMPONENTS.map((name) => `import { galleryStates as ${name} } from "/src/components/${name}/${name}.gallery.tsx";`).join("\n")}

const galleries = [${COMPONENTS.map((name) => `["${name}", ${name}]`).join(", ")}];

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    return this.state.error ? h("pre", { "data-render-error": String(this.state.error) }) : this.props.children;
  }
}

function Gallery() {
  useEffect(() => { document.body.dataset.galleryReady = "true"; }, []);
  return h("main", { className: "gallery" }, galleries.map(([name, states]) =>
    h("section", { key: name, "data-component": name, "data-state-count": String(states.length) },
      h("span", { tabIndex: -1, "data-gallery-start": name }),
      h("h2", null, name),
      states.map((state) =>
        h("figure", { key: state.id, "data-state-id": name + "/" + state.id },
          h("figcaption", null, state.title),
          h("div", { "data-stage": "" }, h(Boundary, null, state.element)))))));
}

createRoot(document.getElementById("root")).render(h(StrictMode, null, h(Gallery)));
`;

function galleryPlugin(): Plugin {
  return {
    name: "conversation-gallery",
    resolveId(id) {
      return id === ENTRY_URL ? ENTRY_ID : undefined;
    },
    load(id) {
      return id === ENTRY_ID ? ENTRY_SOURCE : undefined;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== PAGE_PATH) return next();
        server
          .transformIndexHtml(PAGE_PATH, PAGE_HTML)
          .then((html) => {
            res.setHeader("Content-Type", "text/html");
            res.end(html);
          })
          .catch(next);
      });
    },
  };
}

// A minimal window: sandboxed, no preload, no Node, on the dev server's page.
const MAIN_SOURCE = `
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 880,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(process.env.GALLERY_URL);
});
app.on("window-all-closed", () => app.quit());
`;

let server: ViteDevServer | undefined;
let app: ElectronApplication | undefined;
let page: Page;
let tempDir: string | undefined;
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const dialogs: string[] = [];
const written: string[] = [];

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: APP_DIR,
    logLevel: "warn",
    clearScreen: false,
    plugins: [react(), galleryPlugin()],
    // Pre-bundle up front, so a late dependency discovery never reloads the page mid-test.
    optimizeDeps: { include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"] },
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const { port } = server.httpServer?.address() as AddressInfo;

  tempDir = mkdtempSync(join(tmpdir(), "conversation-gallery-"));
  const mainPath = join(tempDir, "main.cjs");
  writeFileSync(mainPath, MAIN_SOURCE);

  app = await electron.launch({
    args: [mainPath],
    cwd: APP_DIR,
    env: { ...process.env, GALLERY_URL: `http://127.0.0.1:${port}${PAGE_PATH}` } as Record<string, string>,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("dialog", (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await expect(page.locator("body[data-gallery-ready='true']")).toHaveCount(1, { timeout: 60_000 });
});

test.afterAll(async () => {
  await app?.close();
  app = undefined;
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

async function setTheme(theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  // The dark tokens actually apply: tokens.css flips color-scheme with the theme.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
}

async function stateIds(): Promise<string[]> {
  return page.locator("[data-state-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-state-id") ?? ""));
}

function stateLocator(id: string): Locator {
  return page.locator(`[data-state-id="${id}"]`);
}

function shotName(id: string, theme: Theme): string {
  return `${id.replace("/", "-")}-${theme}.png`;
}

async function shoot(target: Locator, file: string): Promise<void> {
  await target.screenshot({ path: join(EVIDENCE_DIR, file), scale: "css" });
  written.push(file);
}

test("every state of the five galleries renders, and is screenshot in light and dark", async () => {
  const ids = await stateIds();
  for (const name of COMPONENTS) {
    const section = page.locator(`section[data-component="${name}"]`);
    await expect(section).toHaveCount(1);
    const declared = Number(await section.getAttribute("data-state-count"));
    expect(declared, `${name} gallery has states`).toBeGreaterThan(0);
    // Every entry of galleryStates got a wrapper (none was dropped or duplicated).
    expect(ids.filter((id) => id.startsWith(`${name}/`))).toHaveLength(declared);
  }
  expect(new Set(ids).size).toBe(ids.length);
  await expect(page.locator("[data-render-error]")).toHaveCount(0);

  // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png")) rmSync(join(EVIDENCE_DIR, file));

  await page.mouse.move(0, 0);
  for (const theme of THEMES) {
    await setTheme(theme);
    for (const id of ids) {
      const state = stateLocator(id);
      await expect(state).toBeVisible();
      await shoot(state, shotName(id, theme));
    }
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("AC2: the <img onerror> and javascript: strings render as inert text in all five components", async () => {
  await setTheme("light");
  const ids = await stateIds();
  for (const name of COMPONENTS) {
    const untrusted = ids.filter((id) => id.startsWith(`${name}/untrusted`));
    expect(untrusted, `${name} has an untrusted-text state`).not.toHaveLength(0);
    for (const id of untrusted) {
      const state = stateLocator(id);
      // The string is on screen, literally, as text.
      await expect(state.getByText(XSS_IMG, { exact: false }).first()).toBeVisible();
      expect(await state.locator("img").count(), `${id}: no img element`).toBe(0);
      expect(await state.locator("[onerror]").count(), `${id}: no onerror attribute`).toBe(0);
      expect(await state.locator('a[href^="javascript:"]').count(), `${id}: no javascript: link`).toBe(0);
      // No element's href is built from message text at all.
      expect(await state.locator("[href]").count(), `${id}: no href`).toBe(0);
    }
  }
  // Across the whole page: no img was ever created, so no onerror ever ran.
  expect(await page.locator("img").count()).toBe(0);
  expect(dialogs).toEqual([]);
});

test("AC4: StreamingLog keeps a scrolled-up reader in place, follows at the bottom, and Jump to latest resumes", async () => {
  await setTheme("light");
  const harness = stateLocator("StreamingLog/append-harness");
  const log = harness.getByRole("log");
  const pill = harness.getByTestId("streaming-log-pill");
  const append = harness.getByRole("button", { name: "Append 50 lines" });
  const metrics = () =>
    log.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight }));

  await harness.scrollIntoViewIfNeeded();
  // The log overflows, so scrolling is real.
  const start = await metrics();
  expect(start.height).toBeGreaterThan(start.client);
  // At the bottom: following, and new lines keep the view pinned.
  expect(start.gap).toBeLessThanOrEqual(1);
  await expect(pill).toHaveText("Following");
  await append.click();
  await expect.poll(async () => (await metrics()).height).toBeGreaterThan(start.height);
  const pinned = await metrics();
  expect(pinned.gap).toBeLessThanOrEqual(1);
  expect(pinned.top).toBeGreaterThan(start.top);
  await expect(pill).toHaveText("Following");

  // The reader scrolls up with the wheel: following pauses.
  await log.hover();
  await page.mouse.wheel(0, -600);
  await expect(pill).toHaveText("Jump to latest");
  const up = await metrics();
  expect(up.gap).toBeGreaterThan(1);

  // 50 lines arrive: the reader stays exactly where they were.
  await append.click();
  await expect.poll(async () => (await metrics()).height).toBeGreaterThan(up.height);
  expect((await metrics()).top).toBe(up.top);
  await expect(pill).toHaveText("Jump to latest");

  // Jump to latest returns to the bottom and resumes following.
  await harness.getByRole("button", { name: "Jump to latest" }).click();
  await expect(pill).toHaveText("Following");
  expect((await metrics()).gap).toBeLessThanOrEqual(1);
  await append.click();
  await expect.poll(async () => (await metrics()).gap).toBeLessThanOrEqual(1);
  await expect(pill).toHaveText("Following");

  // Lines append with no CSS transition or animation.
  const motion = await log.locator(".streaming-log__line").evaluateAll((els) =>
    els.map((el) => ({ animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionDuration })),
  );
  expect(motion.length).toBeGreaterThan(100);
  for (const m of motion) expect(m).toEqual({ animation: "none", transition: "0s" });
});

test("AC7: an inline approval for another agent renders nothing", async () => {
  const stage = stateLocator("EventCard/approval-other-agent").locator("[data-stage]");
  await expect(stage).toHaveCount(1);
  expect(await stage.evaluate((el) => el.childElementCount)).toBe(0);
});

type Focused = {
  readonly tag: string;
  readonly role: string | null;
  readonly name: string;
  readonly state: string | null;
  readonly focusVisible: boolean;
  readonly outlineStyle: string;
  readonly outlineWidth: string;
  readonly outlineColor: string;
  readonly index: number;
};

test("AC9: Tab reaches every control in DOM order, each named, each with a var(--focus) ring; one focused control per component is screenshot", async () => {
  for (const theme of THEMES) {
    await setTheme(theme);
    const focusColor = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--focus)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    for (const name of COMPONENTS) {
      const section = page.locator(`section[data-component="${name}"]`);
      // Every keyboard stop in the section, in DOM order.
      const tabbable = await section.evaluate((root) =>
        Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")).filter(
          (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
        ).length,
      );
      expect(tabbable, `${name} has keyboard stops`).toBeGreaterThan(0);

      await page.locator(`[data-gallery-start="${name}"]`).focus();
      const visited: Focused[] = [];
      for (let step = 0; step < tabbable + 1; step += 1) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate((component): Focused | null => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || !el.closest(`section[data-component="${component}"]`)) return null;
          const all = Array.from(document.querySelectorAll(`section[data-component="${component}"] *`));
          const style = getComputedStyle(el);
          return {
            tag: el.tagName,
            role: el.getAttribute("role"),
            name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
            state: el.closest("[data-state-id]")?.getAttribute("data-state-id") ?? null,
            focusVisible: el.matches(":focus-visible"),
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            outlineColor: style.outlineColor,
            index: all.indexOf(el),
          };
        }, name);
        if (info === null) break;
        visited.push(info);
      }

      // Every stop was reached, in DOM order, and Tab then left the section.
      expect(visited, `${name}: Tab visits every control`).toHaveLength(tabbable);
      const order = visited.map((v) => v.index);
      expect(order, `${name}: Tab follows DOM order`).toEqual([...order].sort((a, b) => a - b));
      for (const v of visited) {
        const where = `${theme} ${v.state}: ${v.tag} "${v.name}"`;
        // A native button, or a focusable scroll region the keyboard must be able to scroll.
        expect(v.tag === "BUTTON" || v.tag === "A" || ["log", "region", "group"].includes(v.role ?? ""), where).toBe(true);
        expect(v.name, `${where} has an accessible name`).not.toBe("");
        expect(v.focusVisible, `${where} is :focus-visible`).toBe(true);
        expect(v.outlineStyle, `${where} ring style`).toBe("solid");
        expect(v.outlineWidth, `${where} ring width`).toBe("2px");
        expect(v.outlineColor, `${where} ring colour is var(--focus)`).toBe(focusColor);
      }

      // One focused control per component, in this theme.
      const first = visited[0];
      expect(first?.state).toBeTruthy();
      await page.locator(`[data-gallery-start="${name}"]`).focus();
      await page.keyboard.press("Tab");
      await shoot(stateLocator(first?.state ?? ""), `${name}-focused-control-${theme}.png`);
    }
  }
});

test("AC9: under prefers-reduced-motion nothing in the five components moves", async () => {
  const motionOf = () =>
    page.locator("section[data-component] [data-stage] *").evaluateAll((els) =>
      els
        .map((el) => {
          const style = getComputedStyle(el);
          const moving = style.animationName !== "none" || style.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
          return moving ? `${el.closest("[data-state-id]")?.getAttribute("data-state-id")} ${el.tagName}.${el.className}` : null;
        })
        .filter((m): m is string => m !== null),
    );
  // The emulation is real: with motion allowed, the hover transitions exist.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect((await motionOf()).length).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await motionOf()).toEqual([]);
  await page.emulateMedia({ reducedMotion: null });
});

test("the evidence README lists every screenshot this run wrote, and nothing else", async () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const listed = new Set(readme.match(/[A-Za-z]+-[a-z0-9-]+-(?:light|dark)\.png/g) ?? []);
  const onDisk = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png"));
  expect(onDisk.length).toBeGreaterThan(0);
  // In a full run, the folder holds exactly what this run wrote (run alone with -g, only the README is compared).
  if (written.length > 0) expect([...onDisk].sort()).toEqual([...new Set(written)].sort());
  expect([...listed].sort()).toEqual([...onDisk].sort());
});
