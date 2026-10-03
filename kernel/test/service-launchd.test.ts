// The launchd service module (item 09, AC1): the plist is rendered purely, and
// install/uninstall run against a temp homeDir with an injected exec. Never
// the real launchctl or the real ~/Library/LaunchAgents.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authProviderFromEnv } from "../src/auth/provider-env.js";
import { LAUNCHCTL_PATH, SERVICE_LABEL, installService, plistPath, renderPlist, uninstallService } from "../src/service/index.js";
import type { ServiceDeps } from "../src/service/index.js";
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

/** An exec that records every call and answers `print` with `loaded ? 0 : 113`. */
function launchctl(o: { loaded?: boolean; fail?: string } = {}) {
  const calls: { file: string; args: readonly string[] }[] = [];
  const exec = (file: string, args: readonly string[]): number => {
    calls.push({ file, args });
    if (args[0] === "print") return o.loaded === true ? 0 : 113;
    return args[0] === o.fail ? 5 : 0;
  };
  const deps: ServiceDeps = { exec, uid: UID, homeDir, platform: "darwin" };
  return { calls, deps, verbs: () => calls.map((c) => c.args[0]) };
}

function siblingUnchanged(): void {
  expect(readFileSync(join(agents, SIBLING), "utf8")).toBe(SIBLING_BODY);
}

describe("renderPlist", () => {
  const params = { nodePath: "/usr/local/bin/node", daemonPath: "/opt/studio/dist/daemon.js", dataDir: "/Users/me/.loomwright-studio" };

  it("carries the label, absolute ProgramArguments, RunAtLoad, KeepAlive on crash and both logs under <dataDir>/logs", () => {
    const xml = renderPlist(params);
    expect(xml).toContain(`<key>Label</key>\n  <string>${SERVICE_LABEL}</string>`);
    expect(xml).toContain(
      "<key>ProgramArguments</key>\n  <array>\n    <string>/usr/local/bin/node</string>\n    <string>/opt/studio/dist/daemon.js</string>\n  </array>",
    );
    expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(xml).toContain("<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>");
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

  it("boots the loaded agent out before bootstrapping it again", () => {
    const l = launchctl({ loaded: true });
    installService({ dataDir, daemonPath, env: {} }, l.deps);
    expect(l.verbs()).toEqual(["print", "bootout", "bootstrap"]);
    expect(l.calls[1]?.args).toEqual(["bootout", `gui/${UID}/${SERVICE_LABEL}`]);
  });

  it("a failing bootstrap throws one line naming the exit status", () => {
    const l = launchctl({ fail: "bootstrap" });
    let message = "";
    try {
      installService({ dataDir, daemonPath, env: {} }, l.deps);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe(`studio service: launchctl bootstrap gui/${UID} failed (exit status 5)`);
    siblingUnchanged();
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
    expect(() => uninstallService(l.deps)).toThrow(`studio service: launchctl bootout gui/${UID}/${SERVICE_LABEL} failed (exit status 5)`);
    expect(existsSync(plistPath(homeDir))).toBe(true);
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
