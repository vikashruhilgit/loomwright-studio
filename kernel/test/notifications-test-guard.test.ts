// Pins the run-wide notifier guard (`notifier-guard.ts`, installed by
// `setup-no-real-notifier.ts` through `kernel/vitest.config.ts`): while
// `STUDIO_LIVE` is not "1", a test run cannot spawn terminal-notifier or
// osascript, and the test that tried fails naming the binary. (a), (b) and
// (e) attempt a real notifier, so they skip unless the guard is installed
// (it never is under `STUDIO_LIVE=1`): no run posts from this file. (b) boots a
// kernel with the shipped contributions and runs only on macOS (elsewhere
// the shipped notifier is `none` and never spawns; (a) is the proof there).
// See `docs/architecture/notifications.md#testing`.
import * as childProcess from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import { OSASCRIPT_PATH, TERMINAL_NOTIFIER_PATHS, getNotification, postNotification, recordNotification, spawnNotifier } from "../src/notifications/index.js";
import * as guard from "./notifier-guard.js";
import { assertNoNotifierRefusals, notifierGuardEnabled, notifierGuardInstalled, takeNotifierRefusals } from "./notifier-guard.js";
import { fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";

const REFUSED = "real notifier refused in a test run: ";
const TERMINAL_NOTIFIER = TERMINAL_NOTIFIER_PATHS[0] ?? "";

let tmp: string;
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-notifier-guard-"));
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  rmSync(tmp, { recursive: true, force: true });
});

// Installed implies enabled. Skipping unless installed also keeps a run
// without the setup file from posting for real here; (c) fails instead.
describe.skipIf(!notifierGuardInstalled())("the notifier guard (STUDIO_LIVE unset)", () => {
  it("(a) refuses the real spawnNotifier, postNotification on darwin and a direct spawn, records each, and fails the test from afterEach", async () => {
    await expect(spawnNotifier(OSASCRIPT_PATH, [], "", 1_000)).rejects.toThrow(`${REFUSED}${OSASCRIPT_PATH} (`);
    await expect(spawnNotifier(TERMINAL_NOTIFIER, [], "", 1_000)).rejects.toThrow(`${REFUSED}${TERMINAL_NOTIFIER} (`);

    const outcome = await postNotification({ id: 1, title: "t", body: "b" }, tmp, { platform: "darwin", isExecutable: (p) => p === OSASCRIPT_PATH });
    expect(outcome).toMatchObject({ status: "failed", posted: false });
    expect(outcome.detail).toContain(`${REFUSED}${OSASCRIPT_PATH}`);
    expect(outcome.detail).toContain("docs/architecture/notifications.md#testing");

    expect(() => childProcess.spawn("terminal-notifier")).toThrow(`${REFUSED}terminal-notifier (`);
    expect(() => childProcess.execFileSync("osascript")).toThrow(`${REFUSED}osascript (`);

    expect(takeNotifierRefusals()).toEqual([
      { file: OSASCRIPT_PATH },
      { file: TERMINAL_NOTIFIER },
      { file: OSASCRIPT_PATH },
      { file: "terminal-notifier" },
      { file: "osascript" },
    ]);
    expect(takeNotifierRefusals()).toEqual([]);

    // What the setup's afterEach does with a refusal: throw, naming the binary (and clear).
    expect(() => childProcess.spawn(OSASCRIPT_PATH)).toThrow(REFUSED);
    expect(() => assertNoNotifierRefusals()).toThrow(/a real notifier was refused in this test: .*osascript/);
    expect(takeNotifierRefusals()).toEqual([]);
  });

  it("(a) lets every other executable through, whatever its arguments say", () => {
    const r = childProcess.spawnSync("/bin/sh", ["-c", `echo ${OSASCRIPT_PATH} terminal-notifier`], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${OSASCRIPT_PATH} terminal-notifier\n`);
    expect(childProcess.execFileSync("/bin/echo", ["osascript"], { encoding: "utf8" })).toBe("osascript\n");
    expect(takeNotifierRefusals()).toEqual([]);
  });

  it("(a) judges a shell: true by-file call by the command's first word, refusing a notifier and running anything else", () => {
    // Non-posting commands on an empty PATH: if the guard regresses, sh fails to find them (127) instead of posting.
    expect(() => childProcess.spawn("osascript -e 'return 1'", { shell: true, env: { PATH: "/nonexistent" } })).toThrow(`${REFUSED}osascript (`);
    expect(() => childProcess.spawnSync("terminal-notifier -help", { shell: true, env: { PATH: "/nonexistent" } })).toThrow(`${REFUSED}terminal-notifier (`);
    expect(takeNotifierRefusals()).toEqual([{ file: "osascript" }, { file: "terminal-notifier" }]);

    const r = childProcess.spawnSync("/bin/echo osascript", { shell: true, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("osascript\n");
    expect(takeNotifierRefusals()).toEqual([]);
  });

  it.runIf(process.platform === "darwin")("(b) a kernel on the shipped contributions settles a notification failed with the guard's error, and nothing is posted", async () => {
    const items = new Map<string, string>();
    const keychain: KeychainReader = { read: (service) => items.get(service) };
    const writer: KeychainWriter = { add: (service, _account, secret) => void items.set(service, secret) };
    // No `contributions`: the shipped list, whose delivery is the real notifier. Sandboxed install (`loomwrightPath`).
    const kernel = await startKernel(
      { dataDir: join(tmp, "data"), env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 } },
      {
        keychain,
        keychainWriter: writer,
        sessionDeps: fakeSessions().deps,
        selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
        availableProviderIds: async () => ["api-key"],
        loopDeps: { tickMs: 10 },
      },
    );
    kernels.push(kernel);
    const { id } = recordNotification(kernel.store, { source: "kernel:test", title: "guard pin", body: "never posted" }, new Date());
    await vi.waitFor(() => expect(getNotification(kernel.store, id)?.delivery_status).not.toBe("pending"), { timeout: 5_000 });
    const row = getNotification(kernel.store, id);
    expect(row?.delivery_status).toBe("failed");
    expect(row?.delivery_detail).toMatch(new RegExp(`real notifier refused in a test run: (${[...TERMINAL_NOTIFIER_PATHS, OSASCRIPT_PATH].join("|")}) \\(`));
    const refused = takeNotifierRefusals();
    expect(refused.length).toBeGreaterThan(0);
    expect([...TERMINAL_NOTIFIER_PATHS, OSASCRIPT_PATH]).toContain(refused[0]?.file);
  });

  it("(e) a second evaluation of the guard module shares the refusal list with the installed wrapper", async () => {
    // A runtime-built specifier (tsc does not resolve it): a separate module instance of notifier-guard.ts.
    const spec: string = `${new URL("./notifier-guard.ts", import.meta.url).href}?copy`;
    const copy = (await import(spec)) as typeof guard;
    expect(copy).not.toBe(guard);
    expect(copy.takeNotifierRefusals).not.toBe(guard.takeNotifierRefusals);
    copy.installNotifierGuard(); // already installed: a no-op
    expect(copy.notifierGuardInstalled()).toBe(true);
    expect(() => childProcess.spawn("osascript")).toThrow(REFUSED);
    expect(copy.takeNotifierRefusals()).toEqual([{ file: "osascript" }]);
    expect(guard.takeNotifierRefusals()).toEqual([]);
  });
});

describe("the notifier guard's switch and wiring", () => {
  it("(c) is on unless STUDIO_LIVE is 1, and is installed exactly when on", () => {
    expect(notifierGuardEnabled({})).toBe(true);
    expect(notifierGuardEnabled({ STUDIO_LIVE: "0" })).toBe(true);
    expect(notifierGuardEnabled({ STUDIO_LIVE: "1" })).toBe(false);
    expect(notifierGuardInstalled()).toBe(notifierGuardEnabled(process.env));
  });

  it("(d) the setup file fails the offending test (afterEach) and a file whose teardown was refused (afterAll)", () => {
    const setup = readFileSync(fileURLToPath(new URL("./setup-no-real-notifier.ts", import.meta.url)), "utf8");
    expect(setup).toContain("installNotifierGuard();");
    expect(setup).toContain("afterEach(assertNoNotifierRefusals);");
    expect(setup).toContain("afterAll(assertNoNotifierRefusals);");
  });
});
