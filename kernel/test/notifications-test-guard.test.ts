// Pins the run-wide notifier guard (`notifier-guard.ts`, installed by
// `setup-no-real-notifier.ts` through `kernel/vitest.config.ts`): while
// `STUDIO_LIVE` is not "1", a test run cannot spawn terminal-notifier or
// osascript, and the test that tried fails naming the binary. (a), (b) and
// (e) attempt a real notifier, so they skip unless the guard is installed
// (it never is under `STUDIO_LIVE=1`): no run posts from this file. (b) boots a
// kernel with the shipped contributions and runs only on macOS (elsewhere
// the shipped notifier is `none` and never spawns; (a) is the proof there).
// (f) and (g) guard a stand-in `child_process` through `guardChildProcess`, so
// they always run. See `docs/architecture/notifications.md#testing`.
import * as childProcess from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { SECURITY_BIN, securityCliKeychain, securityCliKeychainDeleter, securityCliKeychainWriter } from "../src/auth/keychain.js";
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
    expect(() => assertNoNotifierRefusals()).toThrow(/a real notifier or Keychain was refused in this test: .*osascript/);
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

  it("(a2) refuses the shipped Keychain reader, writer and deleter before /usr/bin/security runs, and records each", () => {
    expect(() => securityCliKeychain().read("loomwright-studio-guard-probe")).toThrow();
    expect(() => securityCliKeychainWriter().add("loomwright-studio-guard-probe", "loomwright-studio", "value")).toThrow();
    expect(() => securityCliKeychainDeleter().delete("loomwright-studio-guard-probe")).toThrow();
    expect(takeNotifierRefusals()).toEqual([{ file: SECURITY_BIN }, { file: SECURITY_BIN }, { file: SECURITY_BIN }]);
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

type Fn = (...args: unknown[]) => unknown;
const promised = (fn: unknown): Fn => promisify(fn as Fn) as Fn;
const customOf = (fn: unknown): unknown => (fn as { [promisify.custom]?: unknown })[promisify.custom];

/**
 * A `child_process`-shaped stand-in whose `execFile` and `exec` only record
 * their calls (and answer a trailing callback). Their promisified form is the
 * function itself (`"self"`), or Node's shape once anything promisified it
 * (`"node"`): a separate form whose own `promisify.custom` is itself.
 */
function standIn(shape: "self" | "node"): { record: Record<string, unknown>; calls: string[]; promisedCalls: string[] } {
  const calls: string[] = [];
  const promisedCalls: string[] = [];
  const callable = (name: string): Fn => {
    const fn = function (...args: unknown[]): void {
      calls.push(String(args[0]));
      const callback = args.at(-1);
      if (typeof callback === "function") (callback as Fn)(null, "out");
    };
    Object.defineProperty(fn, "name", { value: name });
    let custom: Fn = fn;
    if (shape === "node") {
      custom = (...args: unknown[]): Promise<string> => {
        promisedCalls.push(String(args[0]));
        return Promise.resolve("out");
      };
      Object.defineProperty(custom, promisify.custom, { value: custom, configurable: true });
    }
    Object.defineProperty(fn, promisify.custom, { value: custom, configurable: true });
    return fn;
  };
  return { record: { execFile: callable("execFile"), exec: callable("exec") }, calls, promisedCalls };
}

// Stand-ins only: nothing here calls the real `node:child_process` with a notifier, so it runs under STUDIO_LIVE=1 too.
describe("the notifier guard on a stand-in child_process", () => {
  it.each(["self", "node"] as const)("(f) guards an execFile whose promisified form points at itself (%s) without recursing, refusing a notifier through both forms", async (shape) => {
    const cp = standIn(shape);
    expect(() => guard.guardChildProcess(cp.record)).not.toThrow();
    const execFile = cp.record.execFile as Fn;

    expect(() => execFile("terminal-notifier", [])).toThrow(`${REFUSED}terminal-notifier (`);
    expect(takeNotifierRefusals()).toEqual([{ file: "terminal-notifier" }]);
    // A synchronous throw and a rejection both land here as a rejection.
    await expect(Promise.resolve().then(() => promised(execFile)("terminal-notifier", []))).rejects.toThrow(`${REFUSED}terminal-notifier (`);
    expect(takeNotifierRefusals()).toEqual([{ file: "terminal-notifier" }]);
    expect(cp.calls).toEqual([]);
    expect(cp.promisedCalls).toEqual([]);

    // Anything else still runs, through the promisified form the stand-in carries.
    expect(execFile("/bin/echo", [])).toBeUndefined();
    await expect(promised(execFile)("/bin/echo", [])).resolves.toBe("out");
    expect([...cp.calls, ...cp.promisedCalls]).toEqual(["/bin/echo", "/bin/echo"]);
    expect(takeNotifierRefusals()).toEqual([]);
  });

  it.each(["self", "node"] as const)("(h) refuses the real Keychain (%s) by path and by name, through both forms", async (shape) => {
    const cp = standIn(shape);
    guard.guardChildProcess(cp.record);
    const execFile = cp.record.execFile as Fn;

    expect(() => execFile(SECURITY_BIN, ["find-generic-password", "-s", "x", "-w"])).toThrow(`real Keychain refused in a test run: ${SECURITY_BIN} (`);
    expect(() => execFile("security", ["-i"])).toThrow("real Keychain refused in a test run: security (");
    await expect(Promise.resolve().then(() => promised(execFile)(SECURITY_BIN, []))).rejects.toThrow("real Keychain refused in a test run: ");
    expect(takeNotifierRefusals()).toEqual([{ file: SECURITY_BIN }, { file: "security" }, { file: SECURITY_BIN }]);
    expect(cp.calls).toEqual([]);
    expect(cp.promisedCalls).toEqual([]);
  });

  it("(g) applied twice (and installed again on the real module) is a no-op: each call is guarded once", async () => {
    const cp = standIn("node");
    guard.guardChildProcess(cp.record);
    const first = { execFile: cp.record.execFile, exec: cp.record.exec };
    const firstCustom = { execFile: customOf(first.execFile), exec: customOf(first.exec) };
    guard.guardChildProcess(cp.record);
    expect(cp.record.execFile).toBe(first.execFile);
    expect(cp.record.exec).toBe(first.exec);
    expect(customOf(cp.record.execFile)).toBe(firstCustom.execFile);
    expect(customOf(cp.record.exec)).toBe(firstCustom.exec);

    // An unwrapped function whose promisified form is already guarded gets that form as-is, not wrapped again.
    const unwrapped = (): void => {};
    Object.defineProperty(unwrapped, promisify.custom, { value: firstCustom.execFile, configurable: true });
    const other: Record<string, unknown> = { execFile: unwrapped };
    guard.guardChildProcess(other);
    expect(other.execFile).not.toBe(unwrapped);
    expect(customOf(other.execFile)).toBe(firstCustom.execFile);

    const real = { execFile: childProcess.execFile, exec: childProcess.exec };
    const realCustom = { execFile: customOf(real.execFile), exec: customOf(real.exec) };
    guard.installNotifierGuard();
    expect(childProcess.execFile).toBe(real.execFile);
    expect(childProcess.exec).toBe(real.exec);
    expect(customOf(childProcess.execFile)).toBe(realCustom.execFile);
    expect(customOf(childProcess.exec)).toBe(realCustom.exec);

    const execFile = cp.record.execFile as Fn;
    const exec = cp.record.exec as Fn;
    expect(() => execFile("terminal-notifier")).toThrow(`${REFUSED}terminal-notifier (`);
    expect(() => exec("osascript -e 'return 1'")).toThrow(`${REFUSED}osascript (`);
    await expect(Promise.resolve().then(() => promised(exec)("terminal-notifier -help"))).rejects.toThrow(`${REFUSED}terminal-notifier (`);
    expect(takeNotifierRefusals()).toEqual([{ file: "terminal-notifier" }, { file: "osascript" }, { file: "terminal-notifier" }]);

    expect(execFile("/bin/echo")).toBeUndefined();
    await expect(promised(exec)("/bin/echo hi")).resolves.toBe("out");
    expect(cp.calls).toEqual(["/bin/echo"]);
    expect(cp.promisedCalls).toEqual(["/bin/echo hi"]);
    expect(takeNotifierRefusals()).toEqual([]);
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
