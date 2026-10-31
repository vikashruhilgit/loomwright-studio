// The app's own preferences (Settings, AC4-AC6 main-process side), with Electron
// mocked: the prefs file and its fallbacks, launch at login read from the OS,
// the theme, Reveal opening only the main process's own data dir, the refused
// patch, and the unpackaged-only seams.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  userData: "",
  // What the OS reports for the login item, and what it was last told.
  login: { openAtLogin: false, status: "not-registered" } as { openAtLogin: boolean; status?: string },
  loginSets: [] as unknown[],
  loginGetThrows: false,
  loginSetThrows: false,
  themeSource: "system",
  themeAssignments: [] as string[],
  opened: [] as string[],
  openPathAnswer: "" as string | Error,
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name !== "userData") throw new Error(`unexpected path ${name}`);
      return electron.userData;
    },
    getLoginItemSettings: () => {
      if (electron.loginGetThrows) throw new Error("no login item api");
      return { ...electron.login };
    },
    setLoginItemSettings: (settings: unknown) => {
      electron.loginSets.push(settings);
      if (electron.loginSetThrows) throw new Error("refused");
      // The OS keeps an item that needs the owner's approval where it is.
      if (electron.login.status === "requires-approval") return;
      electron.login = { openAtLogin: (settings as { openAtLogin: boolean }).openAtLogin, status: (settings as { openAtLogin: boolean }).openAtLogin ? "enabled" : "not-registered" };
    },
  },
  nativeTheme: {
    get themeSource() {
      return electron.themeSource;
    },
    set themeSource(value: string) {
      electron.themeSource = value;
      electron.themeAssignments.push(value);
    },
  },
  shell: {
    openPath: async (path: string) => {
      electron.opened.push(path);
      if (electron.openPathAnswer instanceof Error) throw electron.openPathAnswer;
      return electron.openPathAnswer;
    },
  },
}));

import {
  DEFAULT_PREFERENCES,
  FAKE_OS_ENV,
  OS_CALLS_FILENAME,
  PREFS_DIR_ENV,
  PREFS_FILENAME,
  createPreferences,
  parseStoredPreferences,
  prefsDirFor,
  usesFakeOs,
  validatePatch,
} from "./settings";
import type { Preferences } from "./settings";

const DATA_DIR = "/the/kernel/data";
const roots: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "studio-settings-test-"));
  roots.push(dir);
  return dir;
};
const read = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

/** A preferences object over a fresh userData dir (no seams). */
function fresh(): { prefs: Preferences; dir: string } {
  const dir = scratch();
  electron.userData = dir;
  return { prefs: createPreferences({ env: {}, isPackaged: false, dataDir: DATA_DIR }), dir };
}

beforeEach(() => {
  electron.userData = "";
  electron.login = { openAtLogin: false, status: "not-registered" };
  electron.loginSets.length = 0;
  electron.loginGetThrows = false;
  electron.loginSetThrows = false;
  electron.themeSource = "system";
  electron.themeAssignments.length = 0;
  electron.opened.length = 0;
  electron.openPathAnswer = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the preferences file", () => {
  it("holds the defaults when there is no file, and writes nothing until a change", async () => {
    const { prefs, dir } = fresh();
    await expect(prefs.get()).resolves.toEqual({ launchAtLogin: { enabled: false, status: "not-registered" }, notifications: true, theme: "system" });
    expect(readdirSync(dir)).toEqual([]);
    expect(DEFAULT_PREFERENCES).toEqual({ notifications: true, theme: "system" });
  });

  it("reads a valid file and applies its theme before anything else is asked", async () => {
    const { prefs, dir } = fresh();
    writeFileSync(join(dir, PREFS_FILENAME), JSON.stringify({ notifications: false, theme: "dark" }));
    await prefs.load();
    expect(electron.themeSource).toBe("dark");
    await expect(prefs.get()).resolves.toMatchObject({ notifications: false, theme: "dark" });
  });

  it("falls back to the defaults for a corrupt, truncated or invalid file, and never throws", async () => {
    for (const text of ["{not json", "", "[]", "null", "7", '{"notifications":"yes","theme":"dark"}', '{"notifications":false,"theme":"purple"}', '{"notifications":false}', '{"theme":"light"}']) {
      const { prefs, dir } = fresh();
      writeFileSync(join(dir, PREFS_FILENAME), text);
      await expect(prefs.get()).resolves.toMatchObject({ notifications: true, theme: "system" });
      expect(electron.themeSource).toBe("system");
    }
  });

  it("falls back to the defaults when the file is a directory (unreadable)", async () => {
    const { prefs, dir } = fresh();
    mkdirSync(join(dir, PREFS_FILENAME));
    await expect(prefs.get()).resolves.toMatchObject({ notifications: true, theme: "system" });
  });

  it("rewrites a corrupt file on the next change, atomically (no temp file is left)", async () => {
    const { prefs, dir } = fresh();
    writeFileSync(join(dir, PREFS_FILENAME), "{not json");
    await prefs.set({ notifications: false });
    expect(read(dir, PREFS_FILENAME)).toEqual({ notifications: false, theme: "system" });
    expect(readdirSync(dir)).toEqual([PREFS_FILENAME]);
  });

  it("writes a notifications change to prefs.json and keeps it across a relaunch", async () => {
    const { prefs, dir } = fresh();
    await expect(prefs.set({ notifications: false })).resolves.toMatchObject({ notifications: false });
    expect(read(dir, PREFS_FILENAME)).toEqual({ notifications: false, theme: "system" });
    const relaunched = createPreferences({ env: {}, isPackaged: false, dataDir: DATA_DIR });
    await expect(relaunched.get()).resolves.toMatchObject({ notifications: false });
  });

  it("creates the preferences directory when it does not exist yet", async () => {
    const dir = join(scratch(), "not", "yet");
    electron.userData = dir;
    const prefs = createPreferences({ env: {}, isPackaged: false, dataDir: DATA_DIR });
    await prefs.set({ theme: "light" });
    expect(read(dir, PREFS_FILENAME)).toEqual({ notifications: true, theme: "light" });
  });

  it("keeps the change for this run and does not throw when the file can't be written", async () => {
    const parent = scratch();
    writeFileSync(join(parent, "blocker"), "a file where the directory should be");
    electron.userData = join(parent, "blocker");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prefs = createPreferences({ env: {}, isPackaged: false, dataDir: DATA_DIR });
    await expect(prefs.set({ theme: "dark" })).resolves.toMatchObject({ theme: "dark" });
    expect(electron.themeSource).toBe("dark");
    expect(warn).toHaveBeenCalledWith("loomwright-studio: could not save preferences");
    expect(warn.mock.calls.flat().join(" ")).not.toContain(parent);
  });

  it("never writes into the kernel's data dir", async () => {
    const data = scratch();
    const dir = scratch();
    electron.userData = dir;
    const prefs = createPreferences({ env: {}, isPackaged: false, dataDir: data });
    await prefs.set({ notifications: false, theme: "dark", launchAtLogin: true });
    await prefs.revealDataDir();
    expect(readdirSync(data)).toEqual([]);
  });

  it("applies two quick changes in order, losing neither", async () => {
    const { prefs, dir } = fresh();
    await Promise.all([prefs.set({ notifications: false }), prefs.set({ theme: "dark" }), prefs.set({ notifications: true })]);
    expect(read(dir, PREFS_FILENAME)).toEqual({ notifications: true, theme: "dark" });
  });
});

describe("launch at login", () => {
  it("calls app.setLoginItemSettings with the new openAtLogin, on and off", async () => {
    const { prefs } = fresh();
    await prefs.set({ launchAtLogin: true });
    await prefs.set({ launchAtLogin: false });
    expect(electron.loginSets).toEqual([{ openAtLogin: true }, { openAtLogin: false }]);
  });

  it("reads the OS on every get, not a stored value", async () => {
    const { prefs, dir } = fresh();
    await expect(prefs.set({ launchAtLogin: true })).resolves.toMatchObject({ launchAtLogin: { enabled: true, status: "enabled" } });
    // The owner removes it in System Settings: the next read shows what the OS holds now.
    electron.login = { openAtLogin: false, status: "not-registered" };
    await expect(prefs.get()).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: "not-registered" } });
    // And an item set outside the app shows too, though this process never set it.
    electron.login = { openAtLogin: true, status: "enabled" };
    await expect(prefs.get()).resolves.toMatchObject({ launchAtLogin: { enabled: true, status: "enabled" } });
    // Launch at login is never written to the preferences file.
    await prefs.set({ notifications: false });
    expect(read(dir, PREFS_FILENAME)).toEqual({ notifications: false, theme: "system" });
  });

  it("reports an item that needs approval, or was not found, as the OS says it", async () => {
    const { prefs } = fresh();
    electron.login = { openAtLogin: false, status: "requires-approval" };
    await expect(prefs.set({ launchAtLogin: true })).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: "requires-approval" } });
    electron.login = { openAtLogin: false, status: "not-found" };
    await expect(prefs.get()).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: "not-found" } });
  });

  it("reports a null status where the OS gives none (not macOS 13+)", async () => {
    const { prefs } = fresh();
    electron.login = { openAtLogin: true };
    await expect(prefs.get()).resolves.toMatchObject({ launchAtLogin: { enabled: true, status: null } });
  });

  it("answers off, with no status, when the OS call throws, and when the set is refused", async () => {
    const { prefs } = fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    electron.loginGetThrows = true;
    await expect(prefs.get()).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: null } });
    electron.loginGetThrows = false;
    electron.loginSetThrows = true;
    await expect(prefs.set({ launchAtLogin: true })).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: "not-registered" } });
    expect(warn).toHaveBeenCalledWith("loomwright-studio: could not change the login item");
  });
});

describe("the theme", () => {
  it("applies the stored theme to nativeTheme.themeSource at start, before the window", async () => {
    const { prefs, dir } = fresh();
    writeFileSync(join(dir, PREFS_FILENAME), JSON.stringify({ notifications: true, theme: "light" }));
    expect(electron.themeAssignments).toEqual([]);
    await prefs.load();
    expect(electron.themeAssignments).toEqual(["light"]);
  });

  it("sets nativeTheme.themeSource at once on every change, and keeps it across a relaunch", async () => {
    const { prefs } = fresh();
    for (const theme of ["dark", "light", "system"] as const) {
      await prefs.set({ theme });
      expect(electron.themeSource).toBe(theme);
    }
    await prefs.set({ theme: "dark" });
    const relaunched = createPreferences({ env: {}, isPackaged: false, dataDir: DATA_DIR });
    electron.themeSource = "system";
    await relaunched.load();
    expect(electron.themeSource).toBe("dark");
  });
});

describe("a patch from the renderer", () => {
  const refused: unknown[] = [
    undefined,
    null,
    "dark",
    7,
    ["theme", "dark"],
    { theme: "purple" },
    { theme: 1 },
    { theme: undefined },
    { notifications: "yes" },
    { notifications: 1 },
    { launchAtLogin: "true" },
    { launchAtLogin: null },
    { token: "x" },
    { theme: "dark", extra: true },
    { __proto__: { theme: "dark" }, bogus: 1 },
    // One bad key refuses the whole patch: the good key beside it does not apply either.
    { notifications: false, theme: "purple" },
    { launchAtLogin: true, notifications: "no" },
  ];

  it("is refused whole when it holds an unknown key or a value that isn't valid, answering the unchanged state, and never throws", async () => {
    const { prefs, dir } = fresh();
    for (const patch of refused) {
      await expect(prefs.set(patch)).resolves.toEqual({ launchAtLogin: { enabled: false, status: "not-registered" }, notifications: true, theme: "system" });
    }
    expect(electron.loginSets).toEqual([]);
    expect(electron.themeAssignments).toEqual(["system"]);
    expect(existsSync(join(dir, PREFS_FILENAME))).toBe(false);
  });

  it("answers the changed state, not the old one, for a valid patch", async () => {
    const { prefs } = fresh();
    await expect(prefs.set({ launchAtLogin: true, notifications: false, theme: "dark" })).resolves.toEqual({
      launchAtLogin: { enabled: true, status: "enabled" },
      notifications: false,
      theme: "dark",
    });
  });

  it("treats an empty patch as no change", async () => {
    const { prefs, dir } = fresh();
    await expect(prefs.set({})).resolves.toMatchObject({ notifications: true, theme: "system" });
    expect(existsSync(join(dir, PREFS_FILENAME))).toBe(false);
  });

  it("is checked by validatePatch: known keys and valid values only", () => {
    expect(validatePatch({ theme: "dark", notifications: false, launchAtLogin: true })).toEqual({ theme: "dark", notifications: false, launchAtLogin: true });
    expect(validatePatch({})).toEqual({});
    for (const patch of refused) expect(validatePatch(patch)).toBeUndefined();
  });

  it("reads only the two known keys back from the file", () => {
    expect(parseStoredPreferences('{"notifications":false,"theme":"dark","launchAtLogin":true}')).toEqual({ notifications: false, theme: "dark" });
  });
});

describe("Reveal in Finder", () => {
  it("opens the main process's own data dir with shell.openPath and answers true", async () => {
    const { prefs } = fresh();
    await expect(prefs.revealDataDir()).resolves.toBe(true);
    expect(electron.opened).toEqual([DATA_DIR]);
  });

  it("ignores any argument: a path from the renderer is never opened", async () => {
    const { prefs } = fresh();
    const reveal = prefs.revealDataDir as unknown as (...args: unknown[]) => Promise<boolean>;
    await reveal("/etc");
    await reveal({ path: "/Users/o/.ssh" }, "/");
    expect(electron.opened).toEqual([DATA_DIR, DATA_DIR]);
  });

  it("answers false when the folder can't be opened (an error message, or a throw)", async () => {
    const { prefs } = fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    electron.openPathAnswer = "Failed to open path";
    await expect(prefs.revealDataDir()).resolves.toBe(false);
    electron.openPathAnswer = new Error(`no such folder ${DATA_DIR}`);
    await expect(prefs.revealDataDir()).resolves.toBe(false);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(DATA_DIR);
  });
});

describe("the unpackaged-only seams", () => {
  const seams = (dir: string): Record<string, string> => ({ [PREFS_DIR_ENV]: dir, [FAKE_OS_ENV]: "1" });

  it("moves prefs.json to STUDIO_APP_PREFS_DIR in an unpackaged run", async () => {
    const userData = scratch();
    const seam = scratch();
    electron.userData = userData;
    const prefs = createPreferences({ env: { [PREFS_DIR_ENV]: seam }, isPackaged: false, dataDir: DATA_DIR });
    await prefs.set({ notifications: false });
    expect(existsSync(join(seam, PREFS_FILENAME))).toBe(true);
    expect(readdirSync(userData)).toEqual([]);
  });

  it("is ignored by a packaged build: prefs.json stays in userData and the real OS is used", async () => {
    const userData = scratch();
    const seam = scratch();
    electron.userData = userData;
    const prefs = createPreferences({ env: seams(seam), isPackaged: true, dataDir: DATA_DIR });
    await prefs.set({ notifications: false, launchAtLogin: true });
    await prefs.revealDataDir();
    expect(existsSync(join(userData, PREFS_FILENAME))).toBe(true);
    expect(readdirSync(seam)).toEqual([]);
    expect(electron.loginSets).toEqual([{ openAtLogin: true }]);
    expect(electron.opened).toEqual([DATA_DIR]);
    expect(prefsDirFor(seams(seam), true, () => userData)).toBe(userData);
    expect(prefsDirFor(seams(seam), false, () => userData)).toBe(seam);
    expect(prefsDirFor({ [PREFS_DIR_ENV]: "" }, false, () => userData)).toBe(userData);
    expect(usesFakeOs(seams(seam), true)).toBe(false);
    expect(usesFakeOs(seams(seam), false)).toBe(true);
    expect(usesFakeOs({ [FAKE_OS_ENV]: "0" }, false)).toBe(false);
    expect(usesFakeOs({}, false)).toBe(false);
  });

  it("replaces the login item and Reveal with a fake that records each call and keeps the login-item state", async () => {
    const seam = scratch();
    electron.userData = scratch();
    const prefs = createPreferences({ env: seams(seam), isPackaged: false, dataDir: DATA_DIR });
    await expect(prefs.get()).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: "not-registered" } });
    await prefs.set({ launchAtLogin: true });
    await expect(prefs.revealDataDir()).resolves.toBe(true);
    expect(electron.loginSets).toEqual([]);
    expect(electron.opened).toEqual([]);
    expect(read(seam, OS_CALLS_FILENAME)).toEqual({
      loginItem: { openAtLogin: true, status: "enabled" },
      calls: [{ op: "setLoginItemSettings", openAtLogin: true }, { op: "reveal", path: DATA_DIR }],
    });
    // A relaunch over the same directory reads the fake OS's state back, not a stored value.
    const relaunched = createPreferences({ env: seams(seam), isPackaged: false, dataDir: DATA_DIR });
    await expect(relaunched.get()).resolves.toMatchObject({ launchAtLogin: { enabled: true, status: "enabled" } });
    await relaunched.set({ launchAtLogin: false });
    await expect(relaunched.get()).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: "not-registered" } });
  });

  it("keeps a seeded requires-approval state through a set, so the needs-approval case can be tried", async () => {
    const seam = scratch();
    electron.userData = scratch();
    writeFileSync(join(seam, OS_CALLS_FILENAME), JSON.stringify({ loginItem: { openAtLogin: false, status: "requires-approval" }, calls: [] }));
    const prefs = createPreferences({ env: seams(seam), isPackaged: false, dataDir: DATA_DIR });
    await expect(prefs.set({ launchAtLogin: true })).resolves.toMatchObject({ launchAtLogin: { enabled: false, status: "requires-approval" } });
    expect(read(seam, OS_CALLS_FILENAME)).toMatchObject({ calls: [{ op: "setLoginItemSettings", openAtLogin: true }] });
  });

  it("starts the fake over a corrupt os-calls.json rather than throwing", async () => {
    const seam = scratch();
    electron.userData = scratch();
    writeFileSync(join(seam, OS_CALLS_FILENAME), "{broken");
    const prefs = createPreferences({ env: seams(seam), isPackaged: false, dataDir: DATA_DIR });
    await expect(prefs.revealDataDir()).resolves.toBe(true);
    expect(read(seam, OS_CALLS_FILENAME)).toMatchObject({ calls: [{ op: "reveal", path: DATA_DIR }] });
  });
});
