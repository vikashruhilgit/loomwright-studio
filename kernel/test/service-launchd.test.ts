// The launchd service module (item 09, AC1; H01): the plist is rendered purely,
// and install/uninstall run against a temp homeDir with an injected exec,
// sleep and clock. Never the real launchctl, the real ~/Library/LaunchAgents
// or a real wait; `defaultExec` runs fake executables in the temp dir only.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authProviderFromEnv } from "../src/auth/provider-env.js";
import {
  BOOTOUT_IN_PROGRESS_STATUS,
  BOOTOUT_POLL_MS,
  BOOTOUT_WAIT_MS,
  BOOTSTRAP_RETRY_DELAY_MS,
  LAUNCHCTL_PATH,
  SERVICE_LABEL,
  STDERR_LINE_MAX,
  ServiceError,
  THROTTLE_INTERVAL_SECONDS,
  defaultExec,
  installService,
  plistPath,
  renderPlist,
  uninstallService,
} from "../src/service/index.js";
import type { ServiceDeps, ServiceExec, ServiceExecResult } from "../src/service/index.js";
import { resolveDataDir } from "../src/store/store.js";

const UID = 501;
const SIBLING = "com.example.other.plist";
const SIBLING_BODY = "<plist>someone else's agent</plist>\n";

let tmp: string;
let homeDir: string;
let dataDir: string;
let daemonPath: string;
let agents: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-service-"));
  homeDir = join(tmp, "home");
  dataDir = join(tmp, "data");
  agents = join(homeDir, "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, SIBLING), SIBLING_BODY);
  daemonPath = join(tmp, "dist", "daemon.js");
  mkdirSync(join(tmp, "dist"));
  writeFileSync(daemonPath, "// built daemon\n");
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
 * `stderr`. `sleep` advances a fake clock and is recorded: nothing waits.
 */
function launchctl(o: { loaded?: boolean; stillLoaded?: number; fail?: string; bootout?: number; bootstrap?: number[]; stderr?: string } = {}) {
  const calls: { file: string; args: readonly string[] }[] = [];
  const slept: number[] = [];
  let clock = 0;
  let loaded = o.loaded === true;
  let stillLoaded = o.stillLoaded ?? 0;
  let bootedOut = false;
  const bootstraps = [...(o.bootstrap ?? [])];
  const failed = (status: number): ServiceExecResult => (status === 0 ? OK : { status, stderr: o.stderr ?? "" });
  const exec: ServiceExec = (file, args) => {
    calls.push({ file, args });
    switch (args[0]) {
      case "print":
        if (loaded && bootedOut && stillLoaded-- <= 0) loaded = false;
        return loaded ? OK : { status: 113, stderr: `Could not find service "${SERVICE_LABEL}" in domain for user gui: ${UID}\n` };
      case "bootout":
        if (o.fail === "bootout") return failed(5);
        if (o.bootout !== undefined && o.bootout !== BOOTOUT_IN_PROGRESS_STATUS) return failed(o.bootout);
        bootedOut = true;
        return failed(o.bootout ?? 0);
      case "bootstrap":
        return failed(bootstraps.shift() ?? (o.fail === "bootstrap" ? 5 : 0));
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
  };
  return { calls, deps, slept, verbs: () => calls.map((c) => c.args[0]) };
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
    const result = installService({ dataDir, daemonPath, nodePath: "/usr/local/bin/node", env: {} }, l.deps);

    const path = plistPath(homeDir);
    expect(path).toBe(join(homeDir, "Library", "LaunchAgents", "com.loomwright.studio.kernel.plist"));
    expect(result).toEqual({ label: SERVICE_LABEL, plistPath: path });
    expect(readdirSync(agents).sort()).toEqual([SIBLING, `${SERVICE_LABEL}.plist`].sort());
    siblingUnchanged();
    expect(readFileSync(path, "utf8")).toBe(renderPlist({ nodePath: "/usr/local/bin/node", daemonPath, dataDir, env: {} }));
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
    installService({ dataDir, daemonPath, env: {} }, l.deps);
    expect(l.verbs()).toEqual(["print", "bootout", "print", "bootstrap"]);
    expect(l.calls[1]?.args).toEqual(["bootout", `gui/${UID}/${SERVICE_LABEL}`]);
    expect(l.calls[2]?.args).toEqual(["print", `gui/${UID}/${SERVICE_LABEL}`]);
    expect(l.slept).toEqual([]);
  });

  it("after bootout, polls launchctl print until the agent is gone, then bootstraps", () => {
    const l = launchctl({ loaded: true, stillLoaded: 3 });
    installService({ dataDir, daemonPath, env: {} }, l.deps);
    expect(l.verbs()).toEqual(["print", "bootout", "print", "print", "print", "print", "bootstrap"]);
    expect(l.slept).toEqual([BOOTOUT_POLL_MS, BOOTOUT_POLL_MS, BOOTOUT_POLL_MS]);
  });

  it("an agent still loaded after the bound: throws one line naming it, and never bootstraps", () => {
    const l = launchctl({ loaded: true, stillLoaded: Number.POSITIVE_INFINITY });
    expect(thrown(() => installService({ dataDir, daemonPath, env: {} }, l.deps))).toBe(
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
    expect(installService({ dataDir, daemonPath, env: {} }, l.deps).plistPath).toBe(plistPath(homeDir));
    expect(l.verbs()).toEqual(["print", "bootout", "print", "bootstrap"]);

    const slow = launchctl({ loaded: true, stillLoaded: 2, bootout: 36, stderr: IN_PROGRESS });
    installService({ dataDir, daemonPath, env: {} }, slow.deps);
    expect(slow.verbs()).toEqual(["print", "bootout", "print", "print", "print", "bootstrap"]);
    expect(slow.slept).toEqual([BOOTOUT_POLL_MS, BOOTOUT_POLL_MS]);
  });

  it("a bootout exiting 36 with the agent still loaded after the bound: throws the same line, and never bootstraps", () => {
    const l = launchctl({ loaded: true, stillLoaded: Number.POSITIVE_INFINITY, bootout: 36, stderr: IN_PROGRESS });
    expect(thrown(() => installService({ dataDir, daemonPath, env: {} }, l.deps))).toBe(
      `studio service: ${SERVICE_LABEL} still loaded 5 s after bootout; the previous kernel may still be stopping, run service install again`,
    );
    expect(l.verbs()).not.toContain("bootstrap");
    expect(l.slept.reduce((a, b) => a + b, 0)).toBe(BOOTOUT_WAIT_MS);
  });

  it("any other failing bootout throws one line with its status and stderr line: no poll, no bootstrap", () => {
    for (const status of [5, 1, 35, 37, -1]) {
      const l = launchctl({ loaded: true, bootout: status, stderr: `Boot-out failed: ${status}: boom\n` });
      expect(thrown(() => installService({ dataDir, daemonPath, env: {} }, l.deps))).toBe(
        `studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status ${status}): Boot-out failed: ${status}: boom`,
      );
      expect(l.verbs()).toEqual(["print", "bootout"]);
      expect(l.slept).toEqual([]);
    }
  });

  it("a bootstrap exiting 5 is retried once after a short wait", () => {
    const l = launchctl({ bootstrap: [5, 0] });
    expect(installService({ dataDir, daemonPath, env: {} }, l.deps).plistPath).toBe(plistPath(homeDir));
    expect(l.verbs()).toEqual(["print", "bootstrap", "bootstrap"]);
    expect(l.slept).toEqual([BOOTSTRAP_RETRY_DELAY_MS]);
  });

  it("a bootstrap exiting 5 twice throws one line with the status and launchctl's stderr line", () => {
    const l = launchctl({ loaded: true, bootstrap: [5, 5], stderr: "\nBootstrap failed: 5: Input/output error\nTry re-running the command as root.\n" });
    expect(thrown(() => installService({ dataDir, daemonPath, env: {} }, l.deps))).toBe(
      `studio service: launchctl bootstrap gui/${UID} failed (exit status 5): Bootstrap failed: 5: Input/output error`,
    );
    expect(l.verbs()).toEqual(["print", "bootout", "print", "bootstrap", "bootstrap"]);
    siblingUnchanged();
  });

  it("a failing bootstrap with no stderr throws one line naming the exit status; only status 5 is retried", () => {
    const l = launchctl({ fail: "bootstrap" });
    expect(thrown(() => installService({ dataDir, daemonPath, env: {} }, l.deps))).toBe(
      `studio service: launchctl bootstrap gui/${UID} failed (exit status 5)`,
    );
    siblingUnchanged();

    const other = launchctl({ bootstrap: [37], stderr: "boom" });
    expect(thrown(() => installService({ dataDir, daemonPath, env: {} }, other.deps))).toBe(
      `studio service: launchctl bootstrap gui/${UID} failed (exit status 37): boom`,
    );
    expect(other.verbs()).toEqual(["print", "bootstrap"]);
    expect(other.slept).toEqual([]);
  });

  it("launchctl's stderr line is cut to a bounded length", () => {
    const l = launchctl({ bootstrap: [1], stderr: `${"x".repeat(STDERR_LINE_MAX + 100)}\nsecond line\n` });
    const message = thrown(() => installService({ dataDir, daemonPath, env: {} }, l.deps));
    expect(message).toBe(`studio service: launchctl bootstrap gui/${UID} failed (exit status 1): ${"x".repeat(STDERR_LINE_MAX)}...`);
    expect(message).not.toContain("\n");
  });

  it("refuses an invalid user id and runs nothing", () => {
    for (const uid of [-1, 1.5]) {
      const l = launchctl();
      const deps = { ...l.deps, uid };
      expect(() => installService({ dataDir, daemonPath, env: {} }, deps)).toThrow("studio service: cannot determine the user id");
      expect(() => uninstallService(deps)).toThrow("studio service: cannot determine the user id");
      expect(l.calls).toEqual([]);
    }
    expect(existsSync(plistPath(homeDir))).toBe(false);
  });

  it("refuses a relative daemon path, before writing or running anything", () => {
    const l = launchctl();
    expect(() => installService({ dataDir, daemonPath: "dist/daemon.js", env: {} }, l.deps)).toThrow(
      "studio service: no built daemon at dist/daemon.js (run npm run build first)",
    );
    expect(l.calls).toEqual([]);
    expect(existsSync(plistPath(homeDir))).toBe(false);
    expect(existsSync(join(dataDir, "logs"))).toBe(false);
  });

  it("a plist write that fails removes its temp file and propagates the error, before running anything", () => {
    // A directory where the plist goes: the rename over it fails.
    const path = plistPath(homeDir);
    mkdirSync(path);
    const l = launchctl();
    expect(() => installService({ dataDir, daemonPath, env: {} }, l.deps)).toThrow(/EISDIR|EEXIST|ENOTEMPTY|EPERM/);
    expect(existsSync(join(agents, `.${SERVICE_LABEL}.plist.${process.pid}.tmp`))).toBe(false);
    expect(readdirSync(agents).sort()).toEqual([SIBLING, `${SERVICE_LABEL}.plist`].sort());
    expect(statSync(path).isDirectory()).toBe(true);
    expect(l.calls).toEqual([]);
  });

  it("refuses a daemon path that does not exist, before writing or running anything", () => {
    const l = launchctl();
    expect(() => installService({ dataDir, daemonPath: join(tmp, "missing.js"), env: {} }, l.deps)).toThrow(/no built daemon/);
    expect(l.calls).toEqual([]);
    expect(existsSync(plistPath(homeDir))).toBe(false);
  });

  it("defaults the data dir from STUDIO_DATA_DIR, else ~/.loomwright-studio under homeDir", () => {
    installService({ daemonPath, env: {} }, launchctl().deps);
    expect(existsSync(join(homeDir, ".loomwright-studio", "logs"))).toBe(true);
    installService({ daemonPath, env: { STUDIO_DATA_DIR: dataDir } }, launchctl().deps);
    expect(readFileSync(plistPath(homeDir), "utf8")).toContain(`<key>STUDIO_DATA_DIR</key>\n    <string>${dataDir}</string>`);
  });

  it("a whitespace STUDIO_DATA_DIR: the plist's logs, its STUDIO_DATA_DIR and the installer all resolve one dir", () => {
    // resolveDataDir treats "  " as a relative override: keep it inside tmp.
    vi.spyOn(process, "cwd").mockReturnValue(tmp);
    const env = { STUDIO_DATA_DIR: "  " };
    const installer = resolveDataDir(env, homeDir);
    expect(installer).toBe(join(tmp, "  "));
    installService({ daemonPath, env }, launchctl().deps);
    const dirs = plistDataDirs(readFileSync(plistPath(homeDir), "utf8"), homeDir);
    expect(dirs).toEqual({ logs: installer, daemon: installer });
    expect(existsSync(join(installer, "logs"))).toBe(true);
    expect(existsSync(join(homeDir, ".loomwright-studio"))).toBe(false);
  });

  it("an explicit dataDir with an empty env: the daemon resolves that dir, not ~/.loomwright-studio", () => {
    installService({ dataDir, daemonPath, env: {} }, launchctl().deps);
    const dirs = plistDataDirs(readFileSync(plistPath(homeDir), "utf8"), homeDir);
    expect(dirs).toEqual({ logs: dataDir, daemon: dataDir });
    expect(existsSync(join(dataDir, "logs"))).toBe(true);
  });
});

describe("uninstallService", () => {
  it("boots the label out and removes only its plist", () => {
    installService({ dataDir, daemonPath, env: {} }, launchctl().deps);
    const l = launchctl({ loaded: true });
    expect(uninstallService(l.deps)).toEqual({ label: SERVICE_LABEL, plistPath: plistPath(homeDir) });
    expect(l.calls).toEqual([
      { file: LAUNCHCTL_PATH, args: ["print", `gui/${UID}/${SERVICE_LABEL}`] },
      { file: LAUNCHCTL_PATH, args: ["bootout", `gui/${UID}/${SERVICE_LABEL}`] },
    ]);
    expect(readdirSync(agents)).toEqual([SIBLING]);
    siblingUnchanged();
  });

  it("is idempotent when nothing is loaded and no plist exists", () => {
    const l = launchctl();
    expect(() => uninstallService(l.deps)).not.toThrow();
    expect(() => uninstallService(l.deps)).not.toThrow();
    expect(l.verbs()).toEqual(["print", "print"]);
    expect(readdirSync(agents)).toEqual([SIBLING]);
  });

  it("a failing bootout throws one line and keeps the plist", () => {
    installService({ dataDir, daemonPath, env: {} }, launchctl().deps);
    const l = launchctl({ loaded: true, fail: "bootout" });
    expect(thrown(() => uninstallService(l.deps))).toBe(`studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status 5)`);
    expect(existsSync(plistPath(homeDir))).toBe(true);

    const withStderr = launchctl({ loaded: true, fail: "bootout", stderr: "Boot-out failed: 5: Input/output error\n" });
    expect(thrown(() => uninstallService(withStderr.deps))).toBe(
      `studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status 5): Boot-out failed: 5: Input/output error`,
    );
    expect(existsSync(plistPath(homeDir))).toBe(true);
  });

  it("a bootout exiting 36 (in progress) is not a failure: the plist is removed, nothing waits", () => {
    installService({ dataDir, daemonPath, env: {} }, launchctl().deps);
    const l = launchctl({ loaded: true, bootout: 36, stderr: "Boot-out failed: 36: Operation now in progress\n" });
    expect(uninstallService(l.deps)).toEqual({ label: SERVICE_LABEL, plistPath: plistPath(homeDir) });
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
    expect(() => installService({ dataDir, daemonPath, env: {} }, deps)).toThrow("studio service is macOS only");
    expect(() => uninstallService(deps)).toThrow("studio service is macOS only");
    expect(l.calls).toEqual([]);
    expect(existsSync(join(dataDir, "logs"))).toBe(false);
    expect(readdirSync(agents)).toEqual([SIBLING]);
  });
});
