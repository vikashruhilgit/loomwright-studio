// The app's own preferences, kept by the main process (the Settings screen's
// "This app" section). `main.ts` only wires this: it applies the theme before
// the window exists and answers the three prefs channels, each for the owner's
// window alone.
//
// - Stored: `prefs.json` in `app.getPath("userData")`, `{ notifications, theme }`.
//   A missing, unreadable or invalid file means the defaults (never a throw),
//   and the file is rewritten only by the next change, atomically (temp file,
//   then rename). Never in the kernel's store or data dir.
// - Launch at login is NOT stored: every read asks the OS
//   (`app.getLoginItemSettings()`), so the switch shows what the OS holds.
// - Theme: `nativeTheme.themeSource` at start and on every change. The
//   renderer's tokens follow `prefers-color-scheme`, so it re-themes at once.
// - Reveal opens the main process's own resolved data dir. It takes no
//   argument, so a path the renderer sends is never opened (invariant 3).
//
// Two test seams, honoured in an unpackaged run only (the `tokenReaderFor`
// rule): `STUDIO_APP_PREFS_DIR` moves `prefs.json`, and `STUDIO_APP_FAKE_OS=1`
// replaces the login-item calls and Reveal with a fake that records each call in
// `os-calls.json` beside `prefs.json` and keeps the login-item state there.
// A packaged build ignores both.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app, nativeTheme, shell } from "electron";
import type { AppPreferences, AppPreferencesPatch, ThemePreference } from "../src/api/contract";

export const PREFS_DIR_ENV = "STUDIO_APP_PREFS_DIR";
export const FAKE_OS_ENV = "STUDIO_APP_FAKE_OS";
export const PREFS_FILENAME = "prefs.json";
export const OS_CALLS_FILENAME = "os-calls.json";

/** The themes the owner may pick. */
export const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

/** What `prefs.json` holds. */
export interface StoredPreferences {
  readonly notifications: boolean;
  readonly theme: ThemePreference;
}

export const DEFAULT_PREFERENCES: StoredPreferences = Object.freeze({ notifications: true, theme: "system" });

/** One call the fake OS recorded (`os-calls.json`, `calls`). */
export type FakeOsCall = { readonly op: "setLoginItemSettings"; readonly openAtLogin: boolean } | { readonly op: "reveal"; readonly path: string };

/**
 * `os-calls.json`: the fake OS's whole state. `loginItem` is what the fake reports as the OS's login item.
 * A `requires-approval` status survives a set (the call is recorded, the state is not changed), which is how a
 * test seeds the "needs approval" case.
 */
export interface FakeOsState {
  readonly loginItem: { readonly openAtLogin: boolean; readonly status: string };
  readonly calls: readonly FakeOsCall[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isTheme = (value: unknown): value is ThemePreference => typeof value === "string" && (THEMES as readonly string[]).includes(value);

/** Reads `prefs.json`'s text: the defaults for anything that is not exactly a valid file. */
export function parseStoredPreferences(text: string | undefined): StoredPreferences {
  if (text === undefined) return DEFAULT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (!isRecord(parsed) || typeof parsed.notifications !== "boolean" || !isTheme(parsed.theme)) return DEFAULT_PREFERENCES;
  return { notifications: parsed.notifications, theme: parsed.theme };
}

const PATCH_KEYS = ["launchAtLogin", "notifications", "theme"] as const;

/** A patch the renderer sent, or `undefined` when it is anything but known keys with valid values. Never throws. */
export function validatePatch(patch: unknown): AppPreferencesPatch | undefined {
  if (!isRecord(patch)) return undefined;
  for (const key of Object.keys(patch)) if (!(PATCH_KEYS as readonly string[]).includes(key)) return undefined;
  const { launchAtLogin, notifications, theme } = patch;
  if (launchAtLogin !== undefined && typeof launchAtLogin !== "boolean") return undefined;
  if (notifications !== undefined && typeof notifications !== "boolean") return undefined;
  if (theme !== undefined && !isTheme(theme)) return undefined;
  // A key that is present must carry a value: `{ theme: undefined }` is not a patch.
  for (const key of Object.keys(patch)) if (patch[key] === undefined) return undefined;
  return {
    ...(launchAtLogin === undefined ? {} : { launchAtLogin }),
    ...(notifications === undefined ? {} : { notifications }),
    ...(theme === undefined ? {} : { theme }),
  };
}

/** Where `prefs.json` lives: the seam's directory in an unpackaged run, else the app's `userData`. */
export function prefsDirFor(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean, userData: () => string): string {
  const override = env[PREFS_DIR_ENV];
  if (!isPackaged && override !== undefined && override !== "") return resolve(override);
  return userData();
}

/** Whether the fake OS replaces the real login item and Reveal: an unpackaged run that asked for it. */
export function usesFakeOs(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): boolean {
  return !isPackaged && env[FAKE_OS_ENV] === "1";
}

function parseFakeOs(text: string | undefined): FakeOsState {
  const fresh: FakeOsState = { loginItem: { openAtLogin: false, status: "not-registered" }, calls: [] };
  if (text === undefined) return fresh;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return fresh;
    const item = parsed.loginItem;
    const loginItem =
      isRecord(item) && typeof item.openAtLogin === "boolean" && typeof item.status === "string" ? { openAtLogin: item.openAtLogin, status: item.status } : fresh.loginItem;
    const calls = Array.isArray(parsed.calls) ? (parsed.calls as FakeOsCall[]) : [];
    return { loginItem, calls };
  } catch {
    return fresh;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Writes `text` to `path` atomically: a temp file in the same directory, then a rename. */
async function writeAtomically(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export interface PreferencesOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isPackaged: boolean;
  /** The main process's own resolved data dir (`resolveDataDir`): the one path Reveal ever opens. */
  readonly dataDir: string;
}

export interface Preferences {
  /** Reads `prefs.json` and applies the theme. Idempotent; the other calls await it. Never rejects. */
  load(): Promise<void>;
  get(): Promise<AppPreferences>;
  /** `patch` is untrusted: a patch that is not known keys with valid values changes nothing. */
  set(patch: unknown): Promise<AppPreferences>;
  /** Opens the data dir the main process resolved. Takes no argument on purpose. */
  revealDataDir(): Promise<boolean>;
}

export function createPreferences(options: PreferencesOptions): Preferences {
  const fake = usesFakeOs(options.env, options.isPackaged);
  const dir = (): string => prefsDirFor(options.env, options.isPackaged, () => app.getPath("userData"));
  let stored: StoredPreferences = DEFAULT_PREFERENCES;
  let loaded: Promise<void> | undefined;
  // Every change runs after the one before it, so two quick changes never interleave their file writes.
  let tail: Promise<unknown> = Promise.resolve();
  const serially = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };

  const load = (): Promise<void> => {
    loaded ??= (async () => {
      let file: string | undefined;
      try {
        file = join(dir(), PREFS_FILENAME);
      } catch {
        // No `userData` to read from: the defaults, as for any unreadable file.
      }
      stored = file === undefined ? DEFAULT_PREFERENCES : parseStoredPreferences(await readText(file));
      nativeTheme.themeSource = stored.theme;
    })();
    return loaded;
  };

  const persist = async (next: StoredPreferences): Promise<void> => {
    try {
      await mkdir(dir(), { recursive: true });
      await writeAtomically(join(dir(), PREFS_FILENAME), `${JSON.stringify(next)}\n`);
    } catch {
      // Reasons only: no path, no content. The change holds for this run and is retried by the next one.
      console.warn("loomwright-studio: could not save preferences");
    }
  };

  /** Reads the fake OS's file, applies `change` to it, writes it back; returns what `change` returns. */
  const updateFakeOs = async <T>(change: (state: FakeOsState) => { state: FakeOsState; result: T }): Promise<T> => {
    const file = join(dir(), OS_CALLS_FILENAME);
    const { state, result } = change(parseFakeOs(await readText(file)));
    await mkdir(dir(), { recursive: true });
    await writeAtomically(file, `${JSON.stringify(state, null, 2)}\n`);
    return result;
  };

  const readLoginItem = async (): Promise<AppPreferences["launchAtLogin"]> => {
    try {
      if (fake) {
        const { loginItem } = parseFakeOs(await readText(join(dir(), OS_CALLS_FILENAME)));
        return { enabled: loginItem.openAtLogin, status: loginItem.status };
      }
      const item = app.getLoginItemSettings();
      return { enabled: item.openAtLogin === true, status: typeof item.status === "string" ? item.status : null };
    } catch {
      // The OS would not say: show it off, with no status to claim.
      return { enabled: false, status: null };
    }
  };

  const setLoginItem = async (openAtLogin: boolean): Promise<void> => {
    try {
      if (fake) {
        await updateFakeOs((state) => ({
          state: {
            loginItem: state.loginItem.status === "requires-approval" ? state.loginItem : { openAtLogin, status: openAtLogin ? "enabled" : "not-registered" },
            calls: [...state.calls, { op: "setLoginItemSettings", openAtLogin }],
          },
          result: undefined,
        }));
        return;
      }
      app.setLoginItemSettings({ openAtLogin });
    } catch {
      // The caller reads the state back from the OS, so a refusal shows as it is.
      console.warn("loomwright-studio: could not change the login item");
    }
  };

  const snapshot = async (): Promise<AppPreferences> => ({
    launchAtLogin: await readLoginItem(),
    notifications: stored.notifications,
    theme: stored.theme,
  });

  return {
    load,
    async get() {
      await load();
      return snapshot();
    },
    set(patch) {
      return serially(async () => {
        await load();
        const valid = validatePatch(patch);
        if (valid === undefined) return snapshot();
        if (valid.launchAtLogin !== undefined) await setLoginItem(valid.launchAtLogin);
        const next: StoredPreferences = { notifications: valid.notifications ?? stored.notifications, theme: valid.theme ?? stored.theme };
        if (next.notifications !== stored.notifications || next.theme !== stored.theme) {
          // The theme first: it takes effect at once, before the file is written.
          nativeTheme.themeSource = next.theme;
          stored = next;
          await persist(next);
        }
        return snapshot();
      });
    },
    revealDataDir() {
      return serially(async () => {
        try {
          if (fake) {
            await updateFakeOs((state) => ({ state: { ...state, calls: [...state.calls, { op: "reveal", path: options.dataDir }] }, result: undefined }));
            return true;
          }
          // `openPath` answers an error message, or "" when it opened.
          return (await shell.openPath(options.dataDir)) === "";
        } catch {
          console.warn("loomwright-studio: could not reveal the data folder");
          return false;
        }
      });
    },
  };
}
