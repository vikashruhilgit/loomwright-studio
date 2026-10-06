// The launchd service module (item 09, AC1; H01; H07): the plist is rendered
// purely, and install/uninstall run against a temp homeDir, data dir and a
// fake built kernel with an injected exec, sleep, delay and clock; the start
// check gets an in-memory Keychain and a scripted fetch. Never the real
// launchctl, the Keychain, the real ~/Library/LaunchAgents or a real wait;
// `defaultExec` runs fake executables in the temp dir only.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeychainReader } from "../src/auth/keychain.js";
import { authProviderFromEnv } from "../src/auth/provider-env.js";
import {
  BOOTOUT_IN_PROGRESS_STATUS,
  BOOTOUT_POLL_MS,
  BOOTOUT_WAIT_MS,
  BOOTSTRAP_RETRY_DELAY_MS,
  KEYCHAIN_PROMPT_HINT,
  LAUNCHCTL_PATH,
  SERVICE_LABEL,
  START_CHECK_POLL_MS,
  START_CHECK_TIMEOUT_MS,
  START_FAILURE_LOG_LINES,
  STDERR_LINE_MAX,
  ServiceError,
  THROTTLE_INTERVAL_SECONDS,
  VERSION_MANAGER_DIRS,
  copyKernelApp,
  defaultExec,
  installService,
  parseLaunchctlPrint,
  plistPath,
  productionModules,
  removeOldKernelApps,
  renderPlist,
  uninstallService,
  verifyServiceStart,
  versionManagerWarning,
} from "../src/service/index.js";
import type { ServiceDeps, ServiceExec, ServiceExecResult } from "../src/service/index.js";
import { resolveDataDir } from "../src/store/store.js";

const UID = 501;
const SIBLING = "com.example.other.plist";
const SIBLING_BODY = "<plist>someone else's agent</plist>\n";

let tmp: string;
let homeDir: string;
let dataDir: string;
let sourceRoot: string;
let installedDaemon: string;
let agents: string;

const VERSION = "1.2.3";

/**
 * A built kernel to copy: `dist/`, `package.json`, and a `package-lock.json`
 * whose production closure (non-dev, on disk) is better-sqlite3 (with its
 * compiled `.node`), the SDK, the SDK's installed platform package and a
 * package with a nested `node_modules`. A dev package, another platform's
 * (absent) optional package and `node_modules/.bin` must not be copied.
 */
function makeSourceKernel(root: string, version = VERSION): void {
  const file = (rel: string, body: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  file("dist/daemon.js", "// built daemon\n");
  file("dist/service/launchd.js", "// built module\n");
  file("package.json", `${JSON.stringify({ name: "loomwright-studio-kernel", version, type: "module" })}\n`);
  file("src/daemon.ts", "// source: never copied\n");
  file("node_modules/better-sqlite3/package.json", "{}");
  file("node_modules/better-sqlite3/build/Release/better_sqlite3.node", "native");
  file("node_modules/@anthropic-ai/claude-agent-sdk/package.json", "{}");
  file("node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude", "cli binary");
  file("node_modules/body-parser/index.js", "");
  file("node_modules/body-parser/node_modules/content-type/index.js", "nested");
  file("node_modules/vitest/index.js", "dev only");
  file("node_modules/.bin/vitest", "link");
  file(
    "package-lock.json",
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "loomwright-studio-kernel", version },
        "node_modules/better-sqlite3": { version: "13.0.3" },
        "node_modules/@anthropic-ai/claude-agent-sdk": { version: "0.3.284" },
        "node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64": { version: "0.3.284", optional: true },
        "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64": { version: "0.3.284", optional: true },
        "node_modules/body-parser": { version: "2.0.0" },
        "node_modules/body-parser/node_modules/content-type": { version: "1.0.5" },
        "node_modules/vitest": { version: "5.0.3", dev: true },
      },
    }),
  );
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-service-"));
  homeDir = join(tmp, "home");
  dataDir = join(tmp, "data");
  agents = join(homeDir, "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, SIBLING), SIBLING_BODY);
  sourceRoot = join(tmp, "kernel");
  makeSourceKernel(sourceRoot);
  installedDaemon = join(dataDir, "app", VERSION, "dist", "daemon.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

/** The plist's `<key>` string value (none of these tests' values need unescaping). */
function plistString(xml: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\n\\s*<string>([^<]*)</string>`).exec(xml)?.[1];
}

/**
 * The data dir the plist's logs go under, and the one the daemon resolves under
 * launchd (whose environment holds only the plist's variables): they must agree.
 */
function plistDataDirs(xml: string, home: string): { logs: string; daemon: string } {
  const out = plistString(xml, "StandardOutPath");
  const err = plistString(xml, "StandardErrorPath");
  expect(out).toBeDefined();
  expect(dirname(err ?? "")).toBe(dirname(out ?? ""));
  const env = plistString(xml, "STUDIO_DATA_DIR");
  return { logs: dirname(dirname(out ?? "")), daemon: resolveDataDir(env === undefined ? {} : { STUDIO_DATA_DIR: env }, home) };
}

const OK: ServiceExecResult = { status: 0, stderr: "" };

/**
 * A scripted launchctl that records every call. `print` answers 0 while the
 * agent is loaded, else 113; a `bootout` unloads it, after `stillLoaded` more
 * `print`s that still answer 0. `fail` makes that verb exit 5; `bootout` is
 * the bootout's exit status (36, in progress, still unloads it); `bootstrap`
 * scripts the statuses of successive bootstraps (then 0). A failure writes
 * `stderr`. `sleep` and `delay` advance a fake clock and are recorded: nothing
 * waits. A loaded agent's `print` with stdout captured reports `pid` (a
 * number, or a function of the fake clock; none ⇒ no pid line) and
 * `lastExitCode`. `warn` lines are collected.
 */
function launchctl(
  o: {
    loaded?: boolean;
    stillLoaded?: number;
    fail?: string;
    bootout?: number;
    bootstrap?: number[];
    stderr?: string;
    pid?: number | ((clock: number) => number | undefined);
    lastExitCode?: string;
  } = {},
) {
  const calls: { file: string; args: readonly string[]; captureStdout?: boolean }[] = [];
  const slept: number[] = [];
  const waited: number[] = [];
  const warnings: string[] = [];
  let clock = 0;
  let loaded = o.loaded === true;
  let stillLoaded = o.stillLoaded ?? 0;
  let bootedOut = false;
  const bootstraps = [...(o.bootstrap ?? [])];
  const failed = (status: number): ServiceExecResult => (status === 0 ? OK : { status, stderr: o.stderr ?? "" });
  const printOut = (): string => {
    const pid = typeof o.pid === "function" ? o.pid(clock) : o.pid;
    const lines = [`gui/${UID}/${SERVICE_LABEL} = {`, "\tactive count = 1", "\tstate = running"];
    if (pid !== undefined) lines.push(`\tpid = ${pid}`);
    lines.push(`\tlast exit code = ${o.lastExitCode ?? "(never exited)"}`, "}");
    return `${lines.join("\n")}\n`;
  };
  const exec: ServiceExec = (file, args, options) => {
    calls.push(options?.captureStdout === true ? { file, args, captureStdout: true } : { file, args });
    switch (args[0]) {
      case "print":
        if (loaded && bootedOut && stillLoaded-- <= 0) loaded = false;
        if (!loaded) return { status: 113, stderr: `Could not find service "${SERVICE_LABEL}" in domain for user gui: ${UID}\n` };
        return options?.captureStdout === true ? { ...OK, stdout: printOut() } : OK;
      case "bootout":
        if (o.fail === "bootout") return failed(5);
        if (o.bootout !== undefined && o.bootout !== BOOTOUT_IN_PROGRESS_STATUS) return failed(o.bootout);
        bootedOut = true;
        return failed(o.bootout ?? 0);
      case "bootstrap": {
        const status = bootstraps.shift() ?? (o.fail === "bootstrap" ? 5 : 0);
        if (status === 0) {
          loaded = true;
          bootedOut = false;
        }
        return failed(status);
      }
      default:
        return OK;
    }
  };
  const deps: ServiceDeps = {
    exec,
    uid: UID,
    homeDir,
    platform: "darwin",
    sleep: (ms) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    delay: async (ms) => {
      waited.push(ms);
      clock += ms;
    },
    warn: (line) => warnings.push(line),
  };
  return { calls, deps, slept, waited, warnings, verbs: () => calls.map((c) => c.args[0]) };
}

/** The message `fn` throws ("" when it does not). */
function thrown(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return "";
}

/** A `#!/bin/sh` executable in the temp dir: `defaultExec` runs these, never the real launchctl. */
function fakeBinary(name: string, body: string): string {
  const path = join(tmp, "bin", name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function siblingUnchanged(): void {
  expect(readFileSync(join(agents, SIBLING), "utf8")).toBe(SIBLING_BODY);
}

describe("renderPlist", () => {
  const params = { nodePath: "/usr/local/bin/node", daemonPath: "/opt/studio/dist/daemon.js", dataDir: "/Users/me/.loomwright-studio" };

  it("carries the label, absolute ProgramArguments with --launchd, RunAtLoad, KeepAlive on a non-zero exit, ThrottleInterval 60 and both logs under <dataDir>/logs", () => {
    const xml = renderPlist(params);
    expect(xml).toContain(`<key>Label</key>\n  <string>${SERVICE_LABEL}</string>`);
    expect(xml).toContain(
      "<key>ProgramArguments</key>\n  <array>\n    <string>/usr/local/bin/node</string>\n    <string>/opt/studio/dist/daemon.js</string>\n    <string>--launchd</string>\n  </array>",
    );
    expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(xml).toContain("<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>");
    // H01: a start failure that may clear is retried at most once a minute (the daemon's line says so too).
    expect(xml).toContain("<key>ThrottleInterval</key>\n  <integer>60</integer>");
    expect(THROTTLE_INTERVAL_SECONDS).toBe(60);
    expect(xml).toContain("<key>StandardOutPath</key>\n  <string>/Users/me/.loomwright-studio/logs/kernel.out.log</string>");
    expect(xml).toContain("<key>StandardErrorPath</key>\n  <string>/Users/me/.loomwright-studio/logs/kernel.err.log</string>");
    // STUDIO_DATA_DIR is always the logs' data dir; no provider unless env selects one.
    expect(xml).toContain(
      "<key>EnvironmentVariables</key>\n  <dict>\n    <key>STUDIO_DATA_DIR</key>\n    <string>/Users/me/.loomwright-studio</string>\n  </dict>",
    );
  });

  it("STUDIO_DATA_DIR is always the normalized dir the logs go under, whatever env holds", () => {
    for (const env of [{}, { STUDIO_DATA_DIR: "" }, { STUDIO_DATA_DIR: "  " }, { STUDIO_DATA_DIR: "/somewhere/else" }]) {
      const xml = renderPlist({ ...params, dataDir: "/Users/me/x/../data/", env });
      expect(plistString(xml, "STUDIO_DATA_DIR")).toBe("/Users/me/data");
      expect(plistDataDirs(xml, "/Users/me")).toEqual({ logs: "/Users/me/data", daemon: "/Users/me/data" });
    }
  });

  it("STUDIO_AUTH_PROVIDER is carried exactly when the kernel's own check selects it", () => {
    for (const value of [undefined, "", "  ", "\t", "api-key", " api-key "]) {
      const env = value === undefined ? {} : { STUDIO_AUTH_PROVIDER: value };
      expect(plistString(renderPlist({ ...params, env }), "STUDIO_AUTH_PROVIDER")).toBe(authProviderFromEnv(env));
    }
  });

  it("passes only STUDIO_DATA_DIR and STUDIO_AUTH_PROVIDER, never another variable or a token", () => {
    const xml = renderPlist({
      ...params,
      env: {
        STUDIO_DATA_DIR: "relative/dir",
        STUDIO_AUTH_PROVIDER: "api-key",
        ANTHROPIC_API_KEY: "sk-ant-api03-secret",
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-secret",
        PATH: "/usr/bin",
        HOME: "/Users/me",
      },
    });
    const env = /<key>EnvironmentVariables<\/key>\n {2}<dict>\n([\s\S]*?)\n {2}<\/dict>/.exec(xml)?.[1] ?? "";
    expect([...env.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])).toEqual(["STUDIO_DATA_DIR", "STUDIO_AUTH_PROVIDER"]);
    // The absolute data dir, never the relative value launchd would resolve against /.
    expect(env).toContain("<string>/Users/me/.loomwright-studio</string>");
    expect(xml).not.toMatch(/sk-ant|ANTHROPIC|OAUTH|<key>PATH<\/key>|<key>HOME<\/key>/);
  });

  it("XML-escapes every string and refuses a newline, NUL or relative path", () => {
    const xml = renderPlist({ ...params, daemonPath: "/opt/a&b<c>/'d\"/daemon.js" });
    expect(xml).toContain("<string>/opt/a&amp;b&lt;c&gt;/&apos;d&quot;/daemon.js</string>");
    expect(() => renderPlist({ ...params, daemonPath: "/opt/x\n<key>evil</key>/daemon.js" })).toThrow(/newline or NUL/);
    expect(() => renderPlist({ ...params, dataDir: "/data\0x" })).toThrow(/newline or NUL/);
    expect(() => renderPlist({ ...params, nodePath: "node" })).toThrow(/absolute/);
  });
});

describe("installService", () => {
  it("writes exactly one plist, creates <dataDir>/logs, then print + bootstrap gui/<uid> by absolute path", () => {
    const l = launchctl();
    const result = installService({ dataDir, sourceRoot, nodePath: "/usr/local/bin/node", env: {} }, l.deps);

    const path = plistPath(homeDir);
    expect(path).toBe(join(homeDir, "Library", "LaunchAgents", "com.loomwright.studio.kernel.plist"));
    expect(result).toEqual({ label: SERVICE_LABEL, plistPath: path, dataDir, appDir: join(dataDir, "app", VERSION), version: VERSION });
    expect(readdirSync(agents).sort()).toEqual([SIBLING, `${SERVICE_LABEL}.plist`].sort());
    siblingUnchanged();
    expect(readFileSync(path, "utf8")).toBe(renderPlist({ nodePath: "/usr/local/bin/node", daemonPath: installedDaemon, dataDir, env: {} }));
    expect(statSync(path).mode & 0o777).toBe(0o644);
    expect(statSync(join(dataDir, "logs")).mode & 0o777).toBe(0o700);

    expect(l.calls).toEqual([
      { file: LAUNCHCTL_PATH, args: ["print", `gui/${UID}/${SERVICE_LABEL}`] },
      { file: LAUNCHCTL_PATH, args: ["bootstrap", `gui/${UID}`, path] },
    ]);
    expect(LAUNCHCTL_PATH).toBe("/bin/launchctl");
  });

  it("boots the loaded agent out and checks it is gone before bootstrapping it again", () => {
    const l = launchctl({ loaded: true });
    installService({ dataDir, sourceRoot, env: {} }, l.deps);
    expect(l.verbs()).toEqual(["print", "bootout", "print", "bootstrap"]);
    expect(l.calls[1]?.args).toEqual(["bootout", `gui/${UID}/${SERVICE_LABEL}`]);
    expect(l.calls[2]?.args).toEqual(["print", `gui/${UID}/${SERVICE_LABEL}`]);
    expect(l.slept).toEqual([]);
  });

  it("after bootout, polls launchctl print until the agent is gone, then bootstraps", () => {
    const l = launchctl({ loaded: true, stillLoaded: 3 });
    installService({ dataDir, sourceRoot, env: {} }, l.deps);
    expect(l.verbs()).toEqual(["print", "bootout", "print", "print", "print", "print", "bootstrap"]);
    expect(l.slept).toEqual([BOOTOUT_POLL_MS, BOOTOUT_POLL_MS, BOOTOUT_POLL_MS]);
  });

  it("an agent still loaded after the bound: throws one line naming it, and never bootstraps", () => {
    const l = launchctl({ loaded: true, stillLoaded: Number.POSITIVE_INFINITY });
    expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, l.deps))).toBe(
      `studio service: ${SERVICE_LABEL} still loaded 5 s after bootout; the previous kernel may still be stopping, run service install again`,
    );
    expect(l.verbs()).not.toContain("bootstrap");
    // The poll never waits past the bound, and asks once more at it.
    expect(BOOTOUT_WAIT_MS).toBe(5_000);
    expect(l.slept.reduce((a, b) => a + b, 0)).toBe(BOOTOUT_WAIT_MS);
    expect(l.slept.every((ms) => ms > 0 && ms <= BOOTOUT_POLL_MS)).toBe(true);
    expect(l.verbs().filter((v) => v === "print")).toHaveLength(2 + BOOTOUT_WAIT_MS / BOOTOUT_POLL_MS);
  });

  const IN_PROGRESS = "Boot-out failed: 36: Operation now in progress\n";

  it("a bootout exiting 36 (in progress) is not a failure: it polls until the agent is gone, then bootstraps", () => {
    expect(BOOTOUT_IN_PROGRESS_STATUS).toBe(36);
    const l = launchctl({ loaded: true, bootout: 36, stderr: IN_PROGRESS });
    expect(installService({ dataDir, sourceRoot, env: {} }, l.deps).plistPath).toBe(plistPath(homeDir));
    expect(l.verbs()).toEqual(["print", "bootout", "print", "bootstrap"]);

    const slow = launchctl({ loaded: true, stillLoaded: 2, bootout: 36, stderr: IN_PROGRESS });
    installService({ dataDir, sourceRoot, env: {} }, slow.deps);
    expect(slow.verbs()).toEqual(["print", "bootout", "print", "print", "print", "bootstrap"]);
    expect(slow.slept).toEqual([BOOTOUT_POLL_MS, BOOTOUT_POLL_MS]);
  });

  it("a bootout exiting 36 with the agent still loaded after the bound: throws the same line, and never bootstraps", () => {
    const l = launchctl({ loaded: true, stillLoaded: Number.POSITIVE_INFINITY, bootout: 36, stderr: IN_PROGRESS });
    expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, l.deps))).toBe(
      `studio service: ${SERVICE_LABEL} still loaded 5 s after bootout; the previous kernel may still be stopping, run service install again`,
    );
    expect(l.verbs()).not.toContain("bootstrap");
    expect(l.slept.reduce((a, b) => a + b, 0)).toBe(BOOTOUT_WAIT_MS);
  });

  it("any other failing bootout throws one line with its status and stderr line: no poll, no bootstrap", () => {
    for (const status of [5, 1, 35, 37, -1]) {
      const l = launchctl({ loaded: true, bootout: status, stderr: `Boot-out failed: ${status}: boom\n` });
      expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, l.deps))).toBe(
        `studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status ${status}): Boot-out failed: ${status}: boom`,
      );
      expect(l.verbs()).toEqual(["print", "bootout"]);
      expect(l.slept).toEqual([]);
    }
  });

  it("a bootstrap exiting 5 is retried once after a short wait", () => {
    const l = launchctl({ bootstrap: [5, 0] });
    expect(installService({ dataDir, sourceRoot, env: {} }, l.deps).plistPath).toBe(plistPath(homeDir));
    expect(l.verbs()).toEqual(["print", "bootstrap", "bootstrap"]);
    expect(l.slept).toEqual([BOOTSTRAP_RETRY_DELAY_MS]);
  });

  it("a bootstrap exiting 5 twice throws one line with the status and launchctl's stderr line", () => {
    const l = launchctl({ loaded: true, bootstrap: [5, 5], stderr: "\nBootstrap failed: 5: Input/output error\nTry re-running the command as root.\n" });
    expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, l.deps))).toBe(
      `studio service: launchctl bootstrap gui/${UID} failed (exit status 5): Bootstrap failed: 5: Input/output error`,
    );
    expect(l.verbs()).toEqual(["print", "bootout", "print", "bootstrap", "bootstrap"]);
    siblingUnchanged();
  });

  it("a failing bootstrap with no stderr throws one line naming the exit status; only status 5 is retried", () => {
    const l = launchctl({ fail: "bootstrap" });
    expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, l.deps))).toBe(
      `studio service: launchctl bootstrap gui/${UID} failed (exit status 5)`,
    );
    siblingUnchanged();

    const other = launchctl({ bootstrap: [37], stderr: "boom" });
    expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, other.deps))).toBe(
      `studio service: launchctl bootstrap gui/${UID} failed (exit status 37): boom`,
    );
    expect(other.verbs()).toEqual(["print", "bootstrap"]);
    expect(other.slept).toEqual([]);
  });

  it("launchctl's stderr line is cut to a bounded length", () => {
    const l = launchctl({ bootstrap: [1], stderr: `${"x".repeat(STDERR_LINE_MAX + 100)}\nsecond line\n` });
    const message = thrown(() => installService({ dataDir, sourceRoot, env: {} }, l.deps));
    expect(message).toBe(`studio service: launchctl bootstrap gui/${UID} failed (exit status 1): ${"x".repeat(STDERR_LINE_MAX)}...`);
    expect(message).not.toContain("\n");
  });

  it("refuses an invalid user id and runs nothing", () => {
    for (const uid of [-1, 1.5]) {
      const l = launchctl();
      const deps = { ...l.deps, uid };
      expect(() => installService({ dataDir, sourceRoot, env: {} }, deps)).toThrow("studio service: cannot determine the user id");
      expect(() => uninstallService({ dataDir }, deps)).toThrow("studio service: cannot determine the user id");
      expect(l.calls).toEqual([]);
    }
    expect(existsSync(plistPath(homeDir))).toBe(false);
  });

  it("refuses a source with no built daemon, before copying, writing or running anything", () => {
    rmSync(join(sourceRoot, "dist"), { recursive: true });
    const l = launchctl();
    expect(() => installService({ dataDir, sourceRoot, env: {} }, l.deps)).toThrow(
      `studio service: no built daemon at ${join(sourceRoot, "dist", "daemon.js")} (run npm run build first)`,
    );
    expect(l.calls).toEqual([]);
    expect(existsSync(plistPath(homeDir))).toBe(false);
    expect(existsSync(join(dataDir, "logs"))).toBe(false);
    expect(existsSync(join(dataDir, "app"))).toBe(false);
  });

  it("a plist write that fails removes its temp file and propagates the error, before running anything", () => {
    // A directory where the plist goes: the rename over it fails.
    const path = plistPath(homeDir);
    mkdirSync(path);
    const l = launchctl();
    expect(() => installService({ dataDir, sourceRoot, env: {} }, l.deps)).toThrow(/EISDIR|EEXIST|ENOTEMPTY|EPERM/);
    expect(existsSync(join(agents, `.${SERVICE_LABEL}.plist.${process.pid}.tmp`))).toBe(false);
    expect(readdirSync(agents).sort()).toEqual([SIBLING, `${SERVICE_LABEL}.plist`].sort());
    expect(statSync(path).isDirectory()).toBe(true);
    expect(l.calls).toEqual([]);
  });

  it("refuses a source dir that does not exist, before writing or running anything", () => {
    const l = launchctl();
    expect(() => installService({ dataDir, sourceRoot: join(tmp, "missing"), env: {} }, l.deps)).toThrow(/no built daemon/);
    expect(l.calls).toEqual([]);
    expect(existsSync(plistPath(homeDir))).toBe(false);
  });

  it("defaults the data dir from STUDIO_DATA_DIR, else ~/.loomwright-studio under homeDir", () => {
    installService({ sourceRoot, env: {} }, launchctl().deps);
    expect(existsSync(join(homeDir, ".loomwright-studio", "logs"))).toBe(true);
    installService({ sourceRoot, env: { STUDIO_DATA_DIR: dataDir } }, launchctl().deps);
    expect(readFileSync(plistPath(homeDir), "utf8")).toContain(`<key>STUDIO_DATA_DIR</key>\n    <string>${dataDir}</string>`);
  });

  it("a whitespace STUDIO_DATA_DIR: the plist's logs, its STUDIO_DATA_DIR and the installer all resolve one dir", () => {
    // resolveDataDir treats "  " as a relative override: keep it inside tmp.
    vi.spyOn(process, "cwd").mockReturnValue(tmp);
    const env = { STUDIO_DATA_DIR: "  " };
    const installer = resolveDataDir(env, homeDir);
    expect(installer).toBe(join(tmp, "  "));
    installService({ sourceRoot, env }, launchctl().deps);
    const dirs = plistDataDirs(readFileSync(plistPath(homeDir), "utf8"), homeDir);
    expect(dirs).toEqual({ logs: installer, daemon: installer });
    expect(existsSync(join(installer, "logs"))).toBe(true);
    expect(existsSync(join(homeDir, ".loomwright-studio"))).toBe(false);
  });

  it("an explicit dataDir with an empty env: the daemon resolves that dir, not ~/.loomwright-studio", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    const dirs = plistDataDirs(readFileSync(plistPath(homeDir), "utf8"), homeDir);
    expect(dirs).toEqual({ logs: dataDir, daemon: dataDir });
    expect(existsSync(join(dataDir, "logs"))).toBe(true);
  });
});

describe("the install copy (H07, A1)", () => {
  it("copies dist, package.json and the production node_modules to <dataDir>/app/<version>, and the plist runs that copy", () => {
    const l = launchctl();
    const result = installService({ dataDir, sourceRoot, nodePath: "/usr/local/bin/node", env: {} }, l.deps);
    const app = join(dataDir, "app", VERSION);
    expect(result.appDir).toBe(app);
    for (const rel of [
      "dist/daemon.js",
      "dist/service/launchd.js",
      "package.json",
      "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      "node_modules/@anthropic-ai/claude-agent-sdk/package.json",
      "node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
      "node_modules/body-parser/node_modules/content-type/index.js",
    ]) {
      expect(readFileSync(join(app, rel), "utf8")).toBe(readFileSync(join(sourceRoot, rel), "utf8"));
    }
    // Dev-only, another platform's, the CLI shims and the sources: never copied.
    for (const rel of ["node_modules/vitest", "node_modules/.bin", "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64", "src", "package-lock.json"]) {
      expect(existsSync(join(app, rel))).toBe(false);
    }
    // No temp dir left; the plist runs the copy, never the checkout.
    expect(readdirSync(join(dataDir, "app"))).toEqual([VERSION]);
    const xml = readFileSync(plistPath(homeDir), "utf8");
    expect(xml).toContain(`<string>${installedDaemon}</string>`);
    expect(xml).not.toContain(sourceRoot);
  });

  it("productionModules: the lockfile's non-dev entries present on disk, nested ones covered by their parent", () => {
    expect(productionModules(sourceRoot)).toEqual([
      "node_modules/@anthropic-ai/claude-agent-sdk",
      "node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64",
      "node_modules/better-sqlite3",
      "node_modules/body-parser",
    ]);
    rmSync(join(sourceRoot, "package-lock.json"));
    expect(thrown(() => productionModules(sourceRoot))).toBe(
      `studio service: cannot read ${join(sourceRoot, "package-lock.json")} (the install copy's dependencies come from it)`,
    );
  });

  it("re-installing the same version replaces the copy", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    writeFileSync(join(dataDir, "app", VERSION, "stale.txt"), "from the previous copy");
    writeFileSync(join(sourceRoot, "dist", "daemon.js"), "// rebuilt daemon\n");
    installService({ dataDir, sourceRoot, env: {} }, launchctl({ loaded: true }).deps);
    expect(readFileSync(installedDaemon, "utf8")).toBe("// rebuilt daemon\n");
    expect(existsSync(join(dataDir, "app", VERSION, "stale.txt"))).toBe(false);
    expect(readdirSync(join(dataDir, "app"))).toEqual([VERSION]);
  });

  it("a copy that fails removes its temp dir, leaves the existing copy and plist as they were, and runs no launchctl", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    const plist = readFileSync(plistPath(homeDir), "utf8");
    writeFileSync(join(sourceRoot, "dist", "daemon.js"), "// rebuilt daemon\n");
    const l = launchctl();
    const deps: ServiceDeps = {
      ...l.deps,
      copy: (from, to) => {
        if (from.endsWith("better-sqlite3")) throw new Error("EACCES: permission denied\nsecond line");
        cpSync(from, to, { recursive: true });
      },
    };
    expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, deps))).toBe(
      `studio service: copying the kernel to ${join(dataDir, "app", VERSION)} failed: EACCES: permission denied`,
    );
    expect(readdirSync(join(dataDir, "app"))).toEqual([VERSION]);
    expect(readFileSync(installedDaemon, "utf8")).toBe("// built daemon\n");
    expect(readFileSync(plistPath(homeDir), "utf8")).toBe(plist);
    expect(l.calls).toEqual([]);
  });

  it("copyKernelApp: the copy is renamed into place from a temp sibling", () => {
    const appRoot = join(dataDir, "app");
    const seen: string[] = [];
    const target = copyKernelApp(sourceRoot, appRoot, VERSION, (from, to) => {
      seen.push(to);
      cpSync(from, to, { recursive: true });
    });
    expect(target).toBe(join(appRoot, VERSION));
    const tmpDir = join(appRoot, `.${VERSION}.${process.pid}.tmp`);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((to) => to.startsWith(`${tmpDir}/`))).toBe(true);
    expect(existsSync(tmpDir)).toBe(false);
    expect(readdirSync(appRoot)).toEqual([VERSION]);
    expect(thrown(() => copyKernelApp(sourceRoot, appRoot, "../x"))).toMatch(/not a usable version dir name/);
  });

  it("older versions stay through install; removeOldKernelApps (after a verified start) removes all but the new one", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    makeSourceKernel(sourceRoot, "1.2.4");
    const r = installService({ dataDir, sourceRoot, env: {} }, launchctl({ loaded: true }).deps);
    expect(r.version).toBe("1.2.4");
    expect(readdirSync(join(dataDir, "app")).sort()).toEqual([VERSION, "1.2.4"]);
    expect(readFileSync(plistPath(homeDir), "utf8")).toContain(join(dataDir, "app", "1.2.4", "dist", "daemon.js"));
    mkdirSync(join(dataDir, "app", ".1.2.4.999.tmp"));
    expect(removeOldKernelApps(dataDir, "1.2.4")).toEqual([]);
    expect(readdirSync(join(dataDir, "app"))).toEqual(["1.2.4"]);
    expect(removeOldKernelApps(join(tmp, "no-such-dir"), "1.2.4")).toEqual([]);
  });

  it("refuses to copy an installed copy onto itself (install runs from the checkout)", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    const installed = join(dataDir, "app", VERSION);
    const l = launchctl();
    expect(thrown(() => installService({ dataDir, sourceRoot: installed, env: {} }, l.deps))).toBe(
      `studio service: ${installed} is an installed copy; run service install from the kernel checkout`,
    );
    expect(l.calls).toEqual([]);
    expect(readFileSync(installedDaemon, "utf8")).toBe("// built daemon\n");
  });

  it("refuses a package.json without a usable version", () => {
    writeFileSync(join(sourceRoot, "package.json"), JSON.stringify({ version: "../../evil" }));
    const l = launchctl();
    expect(thrown(() => installService({ dataDir, sourceRoot, env: {} }, l.deps))).toBe(
      `studio service: ${join(sourceRoot, "package.json")} has no usable version`,
    );
    expect(l.calls).toEqual([]);
  });
});

describe("a protected install target (D31, A2)", () => {
  it("is refused with one line naming D31, before anything is copied, written or loaded", () => {
    for (const rel of ["Documents/studio", "Desktop", "downloads/x", "Library/Mobile Documents/com~apple~CloudDocs/studio"]) {
      const target = join(homeDir, rel);
      const l = launchctl();
      const message = thrown(() => installService({ dataDir: target, sourceRoot, env: {} }, l.deps));
      expect(message).toBe(
        `studio service: install target ${join(target, "app", VERSION)} is inside a macOS-protected folder (~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents) that a launchd agent can't read (D31); set STUDIO_DATA_DIR to a dir outside them`,
      );
      expect(l.calls).toEqual([]);
      expect(l.warnings).toEqual([]);
      expect(existsSync(join(target, "app"))).toBe(false);
      expect(existsSync(join(target, "logs"))).toBe(false);
      expect(existsSync(plistPath(homeDir))).toBe(false);
    }
  });

  it("is refused through a symlink into a protected folder", () => {
    mkdirSync(join(homeDir, "Documents"));
    symlinkSync(join(homeDir, "Documents"), join(tmp, "link"));
    const l = launchctl();
    expect(thrown(() => installService({ dataDir: join(tmp, "link", "data"), sourceRoot, env: {} }, l.deps))).toMatch(/\(D31\)/);
    expect(l.calls).toEqual([]);
    expect(existsSync(join(homeDir, "Documents", "data"))).toBe(false);
  });
});

describe("a version-manager node (A4)", () => {
  it("prints one warning line and still installs", () => {
    for (const dir of VERSION_MANAGER_DIRS) {
      const l = launchctl();
      const nodePath = join(homeDir, dir, "versions", "node", "v22.14.0", "bin", "node");
      installService({ dataDir, sourceRoot, nodePath, env: {} }, l.deps);
      expect(l.warnings).toEqual([
        `studio service: warning: node ${nodePath} is under ~/${dir}; the agent stops working if that Node version is removed (then run service install again with another node)`,
      ]);
      expect(l.verbs()).toContain("bootstrap");
    }
    expect(VERSION_MANAGER_DIRS).toEqual([".nvm", ".volta", ".asdf", ".fnm", ".nodenv", join(".local", "share", "fnm")]);
    const other = launchctl();
    installService({ dataDir, sourceRoot, nodePath: "/usr/local/bin/node", env: {} }, other.deps);
    expect(other.warnings).toEqual([]);
    expect(versionManagerWarning(join(homeDir, ".nvmrc-not-a-dir", "node"), homeDir)).toBeUndefined();
  });
});

describe("verifyServiceStart (H07, A3)", () => {
  const TOKEN = "ab".repeat(32);
  const PID = 4242;
  const PORT = 4100;

  function writeApiInfo(pid: number): void {
    writeFileSync(join(dataDir, "api.json"), JSON.stringify({ port: PORT, host: "127.0.0.1", pid, started_at: "2026-10-06T00:00:00.000Z" }));
  }

  /** The probe: an in-memory Keychain (the token from the `tokenAfter`-th read on), a scripted fetch, a pid check. */
  function probe(o: { tokenAfter?: number; answers?: (number | "refused")[]; alive?: boolean } = {}) {
    const reads: string[] = [];
    const answers = [...(o.answers ?? [])];
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const next = answers.shift() ?? 200;
      if (next === "refused") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      return new Response(JSON.stringify({ kernel: { version: "1.2.3", pid: PID } }), { status: next });
    });
    const keychain: KeychainReader = {
      read: (service) => {
        reads.push(service);
        return reads.length > (o.tokenAfter ?? 0) ? TOKEN : undefined;
      },
    };
    return { reads, fetchFn, value: { keychain, fetch: fetchFn as unknown as typeof fetch, isPidAlive: () => o.alive ?? true } };
  }

  function installed(o: Parameters<typeof launchctl>[0] = {}) {
    const l = launchctl(o);
    installService({ dataDir, sourceRoot, env: {} }, l.deps);
    return l;
  }

  it("passes once the new kernel answers GET /status with 200, with the Keychain token", async () => {
    const l = installed({ pid: PID });
    writeApiInfo(PID);
    const p = probe();
    expect(await verifyServiceStart({ dataDir }, p.value, l.deps)).toEqual({ ok: true, pid: PID, version: "1.2.3" });
    expect(p.fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = p.fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:${PORT}/status`);
    expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(p.reads).toEqual(["loomwright-studio-api"]);
    expect(l.calls.filter((c) => c.captureStdout === true).map((c) => c.args)).toEqual([["print", `gui/${UID}/${SERVICE_LABEL}`]]);
    expect(existsSync(plistPath(homeDir))).toBe(true);
    expect(START_CHECK_TIMEOUT_MS).toBe(15_000);
  });

  it("keeps polling while the token, api.json or the pid are not there yet, and a refused or non-200 answer", async () => {
    // No pid until 1 s, then api.json from 2 s; the token from the 3rd read; refused, then 503, then 200.
    const l = installed({ pid: (clock) => (clock >= 1_000 ? PID : undefined) });
    const p = probe({ tokenAfter: 2, answers: ["refused", 503] });
    let polls = 0;
    const deps: ServiceDeps = {
      ...l.deps,
      delay: async (ms) => {
        polls++;
        await l.deps.delay?.(ms);
        if (l.deps.now?.() === 2_000) writeApiInfo(PID);
      },
    };
    expect(await verifyServiceStart({ dataDir }, p.value, deps)).toEqual({ ok: true, pid: PID, version: "1.2.3" });
    expect(p.reads).toHaveLength(5);
    expect(p.fetchFn).toHaveBeenCalledTimes(3);
    expect(polls).toBe(2_000 / START_CHECK_POLL_MS + 2 + 2);
    expect(l.waited.every((ms) => ms === START_CHECK_POLL_MS)).toBe(true);
    expect(l.verbs()).not.toContain("bootout");
    expect(existsSync(plistPath(homeDir))).toBe(true);
  });

  it("a stale api.json (another pid than the job's) never counts: the token is never read or sent", async () => {
    const l = installed({ pid: 5555, lastExitCode: "(never exited)" });
    writeApiInfo(PID);
    const p = probe();
    const result = await verifyServiceStart({ dataDir }, p.value, l.deps);
    expect(result.ok).toBe(false);
    expect(p.reads).toEqual([]);
    expect(p.fetchFn).not.toHaveBeenCalled();
    expect(l.waited.reduce((a, b) => a + b, 0)).toBe(START_CHECK_TIMEOUT_MS);
    expect(result.ok ? [] : result.lines[0]).toBe(
      `studio service: the kernel did not answer GET /status within 15 s (last: api.json names pid ${PID}, not the agent's pid 5555)`,
    );
  });

  it("a dead api.json pid never gets the token", async () => {
    const l = installed({ pid: PID });
    writeApiInfo(PID);
    const p = probe({ alive: false });
    expect((await verifyServiceStart({ dataDir }, p.value, l.deps)).ok).toBe(false);
    expect(p.reads).toEqual([]);
  });

  it("failing: prints the reason, last exit code and the log's last 20 lines, boots the agent out, removes the plist, keeps the copy and the data", async () => {
    const l = installed({ lastExitCode: "1" });
    const log = join(dataDir, "logs", "kernel.err.log");
    writeFileSync(log, `${Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n")}\n`);
    const result = await verifyServiceStart({ dataDir }, probe().value, l.deps);
    expect(result).toEqual({
      ok: false,
      lines: [
        "studio service: the kernel did not answer GET /status within 15 s (last: the agent has no running process)",
        "studio service: launchctl print: last exit code = 1",
        `studio service: last ${START_FAILURE_LOG_LINES} lines of ${log}:`,
        ...Array.from({ length: 20 }, (_, i) => `  line ${i + 11}`),
        `studio service: ${SERVICE_LABEL} booted out and ${plistPath(homeDir)} removed; the install copy and ${dataDir} are kept`,
      ],
    });
    expect(l.verbs().slice(-3)).toEqual(["print", "print", "bootout"]);
    expect(existsSync(plistPath(homeDir))).toBe(false);
    expect(existsSync(installedDaemon)).toBe(true);
    expect(existsSync(log)).toBe(true);
    expect(l.waited.reduce((a, b) => a + b, 0)).toBe(START_CHECK_TIMEOUT_MS);
  });

  it("a Keychain failure in the log tail adds the Always Allow hint; no log file says so", async () => {
    const l = installed();
    writeFileSync(
      join(dataDir, "logs", "kernel.err.log"),
      'studio kernel: Keychain read of service "Claude Code-credentials" failed (/usr/bin/security terminated by SIGTERM)\n',
    );
    const result = await verifyServiceStart({ dataDir }, probe().value, l.deps);
    expect(result.ok ? [] : result.lines).toContain(KEYCHAIN_PROMPT_HINT);
    expect(KEYCHAIN_PROMPT_HINT).toContain("Always Allow");

    const quiet = installed();
    rmSync(join(dataDir, "logs", "kernel.err.log"));
    const none = await verifyServiceStart({ dataDir }, probe().value, quiet.deps);
    expect(none.ok ? [] : none.lines).not.toContain(KEYCHAIN_PROMPT_HINT);
    expect(none.ok ? [] : none.lines).toContain(`studio service: nothing in ${join(dataDir, "logs", "kernel.err.log")}`);
  });

  it("a bootout that fails during the rollback is reported, and the plist is still removed", async () => {
    const l = installed({ fail: "bootout", stderr: "Boot-out failed: 5: Input/output error\n" });
    const result = await verifyServiceStart({ dataDir }, probe().value, l.deps);
    const lines = result.ok ? [] : result.lines;
    expect(lines).toContain(
      `studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status 5): Boot-out failed: 5: Input/output error; run studio service uninstall`,
    );
    expect(lines.at(-1)).toBe(`studio service: ${plistPath(homeDir)} removed; the install copy and ${dataDir} are kept`);
    expect(existsSync(plistPath(homeDir))).toBe(false);
  });
});

describe("parseLaunchctlPrint", () => {
  it("reads only the pid and last exit code lines", () => {
    const out = "gui/501/x = {\n\tactive count = 1\n\tpath = /p\n\tpid = 812\n\tlast exit code = 78: EX_CONFIG\n}\n";
    expect(parseLaunchctlPrint(out)).toEqual({ pid: 812, lastExitCode: "78: EX_CONFIG" });
    expect(parseLaunchctlPrint("\tstate = not running\n\tlast exit code = (never exited)\n")).toEqual({ lastExitCode: "(never exited)" });
    expect(parseLaunchctlPrint("")).toEqual({});
    expect(parseLaunchctlPrint("\tpid = 0\n")).toEqual({});
    expect(parseLaunchctlPrint(`\tlast exit code = ${"x".repeat(500)}\n`).lastExitCode).toHaveLength(100);
  });
});

describe("uninstallService", () => {
  it("boots the label out and removes only its plist", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    const l = launchctl({ loaded: true });
    expect(uninstallService({ dataDir }, l.deps)).toEqual({ label: SERVICE_LABEL, plistPath: plistPath(homeDir), appRoot: join(dataDir, "app") });
    expect(l.calls).toEqual([
      { file: LAUNCHCTL_PATH, args: ["print", `gui/${UID}/${SERVICE_LABEL}`] },
      { file: LAUNCHCTL_PATH, args: ["bootout", `gui/${UID}/${SERVICE_LABEL}`] },
    ]);
    expect(readdirSync(agents)).toEqual([SIBLING]);
    siblingUnchanged();
  });

  it("removes <dataDir>/app/ (every install copy) and keeps the logs, the store and everything else (A6)", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    mkdirSync(join(dataDir, "app", "0.9.0"));
    writeFileSync(join(dataDir, "studio.db"), "store");
    writeFileSync(join(dataDir, "logs", "kernel.err.log"), "log");
    expect(uninstallService({ dataDir }, launchctl({ loaded: true }).deps).appRoot).toBe(join(dataDir, "app"));
    expect(existsSync(join(dataDir, "app"))).toBe(false);
    expect(readdirSync(dataDir).sort()).toEqual(["logs", "studio.db"]);
    expect(readFileSync(join(dataDir, "logs", "kernel.err.log"), "utf8")).toBe("log");
    // A failing bootout removes nothing.
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    expect(() => uninstallService({ dataDir }, launchctl({ loaded: true, fail: "bootout" }).deps)).toThrow(/bootout/);
    expect(existsSync(installedDaemon)).toBe(true);
  });

  it("is idempotent when nothing is loaded and no plist exists", () => {
    const l = launchctl();
    expect(() => uninstallService({ dataDir }, l.deps)).not.toThrow();
    expect(() => uninstallService({ dataDir }, l.deps)).not.toThrow();
    expect(l.verbs()).toEqual(["print", "print"]);
    expect(readdirSync(agents)).toEqual([SIBLING]);
  });

  it("a failing bootout throws one line and keeps the plist", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    const l = launchctl({ loaded: true, fail: "bootout" });
    expect(thrown(() => uninstallService({ dataDir }, l.deps))).toBe(`studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status 5)`);
    expect(existsSync(plistPath(homeDir))).toBe(true);

    const withStderr = launchctl({ loaded: true, fail: "bootout", stderr: "Boot-out failed: 5: Input/output error\n" });
    expect(thrown(() => uninstallService({ dataDir }, withStderr.deps))).toBe(
      `studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status 5): Boot-out failed: 5: Input/output error`,
    );
    expect(existsSync(plistPath(homeDir))).toBe(true);
  });

  it("a bootout exiting 36 (in progress) is not a failure: the plist is removed, nothing waits", () => {
    installService({ dataDir, sourceRoot, env: {} }, launchctl().deps);
    const l = launchctl({ loaded: true, bootout: 36, stderr: "Boot-out failed: 36: Operation now in progress\n" });
    expect(uninstallService({ dataDir }, l.deps)).toEqual({ label: SERVICE_LABEL, plistPath: plistPath(homeDir), appRoot: join(dataDir, "app") });
    expect(l.verbs()).toEqual(["print", "bootout"]);
    expect(l.slept).toEqual([]);
    expect(readdirSync(agents)).toEqual([SIBLING]);
  });
});

describe("defaultExec (fake executables in the temp dir, never the real launchctl)", () => {
  it("returns the exit status and stderr, and never reads stdout", () => {
    const bin = fakeBinary("launchctl", 'echo "on stdout"\necho "Bootstrap failed: 5: Input/output error" >&2\nexit 5');
    expect(defaultExec(bin, ["bootstrap", "gui/501"])).toEqual({ status: 5, stderr: "Bootstrap failed: 5: Input/output error\n" });
    expect(defaultExec(fakeBinary("ok", "exit 0"), [])).toEqual({ status: 0, stderr: "" });
  });

  it("captures stdout only when asked for (launchctl print in the start check)", () => {
    const bin = fakeBinary("print", 'printf "\\tpid = 812\\n"\necho "warn" >&2');
    expect(defaultExec(bin, ["print"], { captureStdout: true })).toEqual({ status: 0, stderr: "warn\n", stdout: "\tpid = 812\n" });
    expect(defaultExec(bin, ["print"])).toEqual({ status: 0, stderr: "warn\n" });
  });

  it("a file it cannot run throws a ServiceError naming the file and the code", () => {
    const missing = join(tmp, "bin", "absent");
    let err: unknown;
    try {
      defaultExec(missing, ["print"]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as Error).message).toBe(`studio service: cannot run ${missing} (ENOENT)`);
  });

  it("killed by a signal: status -1, never 0", () => {
    expect(defaultExec(fakeBinary("killed", "kill -9 $$"), []).status).toBe(-1);
  });
});

describe("on a platform other than macOS", () => {
  it("install and uninstall refuse with one line and run nothing", () => {
    const l = launchctl();
    const deps = { ...l.deps, platform: "linux" as const };
    expect(() => installService({ dataDir, sourceRoot, env: {} }, deps)).toThrow("studio service is macOS only");
    expect(() => uninstallService({ dataDir }, deps)).toThrow("studio service is macOS only");
    expect(l.calls).toEqual([]);
    expect(existsSync(join(dataDir, "logs"))).toBe(false);
    expect(readdirSync(agents)).toEqual([SIBLING]);
  });
});
