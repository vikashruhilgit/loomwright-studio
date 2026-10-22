// The Avatar's component page (phase 5 polish evidence): every state, creature
// and size rendered with the real tokens.css + Avatar.css in Electron, with
// reduced motion emulated so captures are stable, captured in light and dark
// into docs/evidence/phase-5-polish/components/avatar/.
//
// Self-contained on purpose: the app has no component gallery route, and its
// vite.config.ts / electron/main.ts belong to the shell. This spec builds a
// throwaway page into a temp dir with Vite's programmatic build
// (`configFile: false`, so app/vite.config.ts and its `emptyOutDir` on app/dist
// are never touched), opens it in a bare Electron window, and removes the temp
// dir afterwards. It only captures; it never compares against the committed
// PNGs (font rendering differs across OSes).
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-5-polish/components/avatar/", import.meta.url));
const AVATAR = join(APP_DIR, "src/components/Avatar/Avatar.tsx");
const CREATURES = join(APP_DIR, "src/components/Avatar/creatures.ts");
const TOKENS = join(APP_DIR, "src/styles/tokens.css");

const THEMES = ["light", "dark"] as const;
const SECTIONS = ["states", "creatures", "sizes"] as const;
// 12 in states (6 x Wright, 6 x Mason), 7 crew creatures, 6 sizes.
const AVATAR_COUNT = 12 + 7 + 6;

// The page mirrors preview.html's rows: states (Wright and Mason, 56px), the
// crew creatures (idle, 44px, hues assigned in the design's order), and sizes
// (Mason working; 12px is asked for to show the 16px floor).
const ENTRY = `
import { createRoot } from "react-dom/client";
import ${JSON.stringify(TOKENS)};
import "./gallery.css";
import { AVATAR_STATES, Avatar, STATE_WORDS } from ${JSON.stringify(AVATAR)};
import { CREW_CREATURES, CREW_HUES } from ${JSON.stringify(CREATURES)};

const wright = { id: "wright", name: "Wright", shape: "whale", hue: "accent" };
const mason = { id: "mason", name: "Mason", shape: "shark", hue: "teal" };

function Cell({ children, label }) {
  return <div className="cell">{children}<span>{label}</span></div>;
}

function Gallery() {
  return (
    <>
      <section id="states">
        <h2>States · 56px</h2>
        {[wright, mason].map((agent) => (
          <div className="row" key={agent.id}>
            {AVATAR_STATES.map((state) => (
              <Cell key={state} label={agent.name + " · " + STATE_WORDS[state]}>
                <Avatar agent={agent} state={state} size={56} />
              </Cell>
            ))}
          </div>
        ))}
      </section>
      <section id="creatures">
        <h2>Crew creatures · idle · 44px</h2>
        <div className="row">
          {CREW_CREATURES.map((shape, i) => (
            <Cell key={shape} label={shape + " · " + CREW_HUES[i % CREW_HUES.length]}>
              <Avatar agent={{ id: "x" + i, name: shape, shape, hue: CREW_HUES[i % CREW_HUES.length] }} state="idle" size={44} />
            </Cell>
          ))}
        </div>
      </section>
      <section id="sizes">
        <h2>Sizes · Mason working</h2>
        <div className="row">
          {[12, 16, 18, 24, 36, 56].map((size) => (
            <Cell key={size} label={size === 12 ? "12px asked → 16px" : size + "px"}>
              <Avatar agent={mason} state="working" size={size} />
            </Cell>
          ))}
        </div>
      </section>
    </>
  );
}

createRoot(document.getElementById("root")).render(<Gallery />);
`;

// Layout only, and only tokens (preview.html's page styles).
const GALLERY_CSS = `
body { margin: 0; padding: 16px; background: var(--ground); font-family: var(--font-sans); color: var(--ink); font-size: 13px; line-height: 18px; }
section { width: max-content; padding: 12px 16px 16px; background: var(--ground); }
h2 { margin: 0 0 12px; font-size: var(--type-caption-size); line-height: var(--type-caption-line); font-weight: 600; color: var(--ink-tertiary); }
.row { display: flex; gap: 22px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 16px; }
.cell { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--ink-secondary); font-size: 11px; }
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Avatar</title></head>
  <body><div id="root"></div><script type="module" src="./entry.jsx"></script></body>
</html>
`;

// A bare window over the built page: sandboxed, no preload, nothing exposed.
const MAIN_CJS = `
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true } });
  win.loadFile(process.env.AVATAR_GALLERY_HTML);
});
app.on("window-all-closed", () => app.quit());
`;

let tempDir: string | undefined;
let app: ElectronApplication | undefined;
let page: Page;

async function setTheme(theme: (typeof THEMES)[number]): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
}

/** The computed colour of a token, resolved through a probe element. */
async function tokenColour(token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

test.describe.serial("Avatar component page", () => {
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(180_000);
    tempDir = await mkdtemp(join(tmpdir(), "studio-avatar-e2e-"));
    // Bare imports in the temp entry (react, react-dom) resolve through the app's own node_modules.
    await symlink(join(APP_DIR, "node_modules"), join(tempDir, "node_modules"), "junction");
    await writeFile(join(tempDir, "entry.jsx"), ENTRY);
    await writeFile(join(tempDir, "gallery.css"), GALLERY_CSS);
    await writeFile(join(tempDir, "index.html"), INDEX_HTML);
    await writeFile(join(tempDir, "main.cjs"), MAIN_CJS);
    await build({
      configFile: false,
      root: tempDir,
      base: "./",
      logLevel: "warn",
      plugins: [react()],
      build: { outDir: join(tempDir, "dist"), emptyOutDir: true },
    });

    app = await electron.launch({
      args: [join(tempDir, "main.cjs")],
      cwd: APP_DIR,
      env: { ...process.env, AVATAR_GALLERY_HTML: join(tempDir, "dist", "index.html") } as Record<string, string>,
    });
    page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".bot")).toHaveCount(AVATAR_COUNT);
  });

  test.afterAll(async () => {
    await app?.close();
    app = undefined;
    if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("under reduced motion every avatar layer is still and each state shows its thread", async () => {
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll(".bot .drift, .bot .rig, .bot .tail, .bot .ring, .bot .st, .bot .ln, .bot .stitch")]
        .filter((el) => getComputedStyle(el).animationName !== "none")
        .map((el) => el.getAttribute("class")),
    );
    expect(moving).toEqual([]);

    const threads = await page.evaluate(() =>
      [...document.querySelectorAll("#states .bot")].map((bot) => ({
        label: bot.getAttribute("aria-label"),
        visible: [...bot.querySelectorAll(".t")]
          .filter((t) => getComputedStyle(t).display !== "none" && t.getBoundingClientRect().width > 0)
          .map((t) => [...t.classList].filter((c) => c !== "t").join(" ")),
      })),
    );
    const want: Record<string, string[]> = {
      idle: ["t-idle"],
      working: ["t-idle"],
      "waiting on you": ["t-up"],
      "paused at cap": ["t-slack"],
      done: ["t-bow"],
      killed: ["t-cut", "t-cut2"],
    };
    expect(threads).toHaveLength(12);
    for (const { label, visible } of threads) {
      const word = (label ?? "").split(" · ")[1] ?? "";
      expect(visible, label ?? "").toEqual(want[word]);
    }
    await expect(page.getByRole("img", { name: "Mason · waiting on you" })).toBeVisible();
  });

  test("identity colours come from the theme's tokens, light and dark", async () => {
    const seen: Record<string, string> = {};
    for (const theme of THEMES) {
      await setTheme(theme);
      const accent = await tokenColour("--accent");
      const teal = await tokenColour("--crew-teal");
      const knots = await page.evaluate(() => ({
        wright: getComputedStyle(document.querySelector('[aria-label="Wright · idle"] .knot') as Element).fill,
        crown: getComputedStyle(document.querySelector('[aria-label="Wright · idle"] .crown') as Element).fill,
        mason: getComputedStyle(document.querySelector('#states [aria-label="Mason · idle"] .knot') as Element).fill,
      }));
      expect(knots).toEqual({ wright: accent, crown: accent, mason: teal });
      seen[theme] = accent;
    }
    expect(seen.light).not.toBe(seen.dark);
  });

  test("captures states, creatures and sizes in light and dark", async () => {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    for (const theme of THEMES) {
      await setTheme(theme);
      for (const section of SECTIONS) {
        await page.locator(`#${section}`).screenshot({ path: join(EVIDENCE_DIR, `${section}-${theme}.png`) });
      }
    }
  });
});
