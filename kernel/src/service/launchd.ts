// The kernel as a per-user launchd agent (item 09, AC1; D11): `studio service
// install` writes ONE plist and loads it, `studio service uninstall` unloads
// and removes it. macOS only.
//
// It touches exactly `~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`:
// never a glob, a listing or any other file in `LaunchAgents/`. The plist holds
// absolute paths (launchd's PATH is minimal) and at most two non-secret
// environment variables, never a token: the kernel reads its credentials from
// the Keychain at start.
//
// One data dir: `STUDIO_DATA_DIR` in the plist is always the same absolute
// dir its logs go under, so the daemon resolves exactly the dir the installing
// CLI chose, whatever the installer's own environment held.
//
// The kernel runs from an install copy (H07, D31), never from the checkout:
// install copies the built kernel (`dist/`, `package.json` and the production
// `node_modules`) to `<dataDir>/app/<kernel version>/` and the plist runs that
// copy's `dist/daemon.js`. A launchd job can't read a macOS-protected folder
// (`~/Documents`, …), where a checkout may well live; an install target inside
// one is refused (`PROTECTED_LOCATIONS`).
//
// Install reports success only on a verified start (`verifyServiceStart`): the
// new kernel answers `GET /status`. A kernel that does not is booted out and
// its plist removed, so launchd can't restart it in a loop or at next login.
//
// launchctl's stdout is read only for `launchctl print` in the start check,
// bounded, and only its `pid =` and `last exit code =` lines are parsed. A
// failing launchctl's error carries its exit status and the first line of its
// stderr (H01), which holds no secret (the plist holds none).
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../api/token.js";
import type { KeychainReader } from "../auth/keychain.js";
import { AUTH_PROVIDER_ENV, authProviderFromEnv } from "../auth/provider-env.js";
import { isProtectedPath, protectedLocationsText } from "../protected-paths.js";
import { DATA_DIR_ENV, resolveDataDir } from "../store/store.js";

/** The agent's launchd label. */
export const SERVICE_LABEL = "com.loomwright.studio.kernel";

/** launchctl by absolute path: never resolved through PATH. */
export const LAUNCHCTL_PATH = "/bin/launchctl";

/** The daemon argument that selects its launchd exit statuses (`daemon-exit.ts`). */
export const LAUNCHD_ARGUMENT = "--launchd";

/** The plist's `ThrottleInterval`: launchd restarts a failing kernel at most once a minute. */
export const THROTTLE_INTERVAL_SECONDS = 60;

/** How long `installService` waits for a booted-out agent to be gone before it gives up. */
export const BOOTOUT_WAIT_MS = 5_000;
/** How often it asks `launchctl print` meanwhile. */
export const BOOTOUT_POLL_MS = 200;
/** `launchctl bootout`'s EINPROGRESS (unverified, `docs/OPEN_QUESTIONS.md` 5(a)): taken as "still unloading", so the poll decides. */
export const BOOTOUT_IN_PROGRESS_STATUS = 36;
/** `launchctl bootstrap`'s exit status for an I/O error, e.g. the old job not fully gone: retried once. */
export const BOOTSTRAP_RETRY_STATUS = 5;
/** The wait before that one retry. */
export const BOOTSTRAP_RETRY_DELAY_MS = 1_000;
/** launchctl's stderr line in an error is cut to this many characters. */
export const STDERR_LINE_MAX = 500;

/** Under `<dataDir>/logs/`. */
export const STDOUT_LOG_FILENAME = "kernel.out.log";
export const STDERR_LOG_FILENAME = "kernel.err.log";

/** `<dataDir>/app/`: one dir per installed kernel version (H07). */
export const APP_DIRNAME = "app";

/** How long `verifyServiceStart` waits for the new kernel to answer `GET /status`. */
export const START_CHECK_TIMEOUT_MS = 15_000;
/** How often it probes meanwhile. */
export const START_CHECK_POLL_MS = 250;
/** One `GET /status` probe's own bound (cut further to the time left). */
export const START_CHECK_FETCH_TIMEOUT_MS = 2_000;
/** A failed start check prints this many last lines of `kernel.err.log`. */
export const START_FAILURE_LOG_LINES = 20;
/** Only this many last bytes of `kernel.err.log` are read for them. */
export const LOG_TAIL_MAX_BYTES = 64 * 1024;
/** `launchctl print`'s stdout is captured up to this many bytes; more is a failed probe. */
export const PRINT_STDOUT_MAX_BYTES = 1024 * 1024;

/**
 * Node version-manager dirs under the home dir (H07, A4). A `nodePath` inside
 * one is warned about: the agent breaks when that Node version is removed.
 */
export const VERSION_MANAGER_DIRS: readonly string[] = [".nvm", ".volta", ".asdf", ".fnm", ".nodenv", join(".local", "share", "fnm")];

/** The daemon's `<dataDir>/api.json` (`kernel.ts` `API_INFO_FILENAME`; not imported: that module loads the Agent SDK). */
const API_INFO_FILENAME = "api.json";
/** The API's loopback host (`api/server.ts`). */
const API_HOST = "127.0.0.1";

/** `<homeDir>/Library/LaunchAgents/com.loomwright.studio.kernel.plist`. */
export function plistPath(homeDir: string): string {
  return join(homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

/** A `studio service` failure: one line; at most launchctl's first stderr line, never its stdout. */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface PlistParams {
  /** Absolute path of the `node` binary. */
  readonly nodePath: string;
  /** Absolute path of the built `daemon.js`. */
  readonly daemonPath: string;
  /** Absolute data dir: the logs go to `<dataDir>/logs/`, and it is always the plist's `STUDIO_DATA_DIR`. */
  readonly dataDir: string;
  /** Read for `STUDIO_AUTH_PROVIDER` only; any other key (`STUDIO_DATA_DIR` included) is ignored. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const XML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Refuse a newline or NUL (a plist value split over lines, or truncated), then XML-escape. */
function xmlString(name: string, value: string): string {
  if (/[\r\n\0]/.test(value)) throw new ServiceError(`studio service: ${name} contains a newline or NUL character`);
  return `<string>${value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c)}</string>`;
}

function absolute(name: string, value: string): string {
  if (!isAbsolute(value)) throw new ServiceError(`studio service: ${name} must be an absolute path`);
  return value;
}

/**
 * The agent's plist (pure): `Label`; `ProgramArguments` = `[nodePath,
 * daemonPath, "--launchd"]`; `RunAtLoad`; `KeepAlive` = `{SuccessfulExit:
 * false}` (launchd restarts the kernel after any non-zero exit: a crash, a
 * `kill -9` or a start failure that may clear; never after exit 0: a graceful
 * stop or a start failure a retry can't fix); `ThrottleInterval` 60 (those
 * restarts at most once a minute); stdout/stderr to
 * `<dataDir>/logs/kernel.{out,err}.log`; and
 * `EnvironmentVariables` with only `STUDIO_DATA_DIR` (always: the normalized
 * absolute `dataDir`, the same dir the logs go under, so the daemon's
 * `resolveDataDir` lands there) and `STUDIO_AUTH_PROVIDER` (when
 * `authProviderFromEnv(env)`, the kernel's own check, selects one).
 * Every string is XML-escaped; a newline or NUL in any of them is refused.
 */
export function renderPlist(params: PlistParams): string {
  const env = params.env ?? {};
  // Normalized once: the logs and STUDIO_DATA_DIR derive from this one value.
  const dataDir = resolve(absolute("dataDir", params.dataDir));
  const vars: [string, string][] = [[DATA_DIR_ENV, dataDir]];
  const provider = authProviderFromEnv(env);
  if (provider !== undefined) vars.push([AUTH_PROVIDER_ENV, provider]);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  ${xmlString("Label", SERVICE_LABEL)}`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    ${xmlString("nodePath", absolute("nodePath", params.nodePath))}`,
    `    ${xmlString("daemonPath", absolute("daemonPath", params.daemonPath))}`,
    `    ${xmlString("argument", LAUNCHD_ARGUMENT)}`,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ThrottleInterval</key>",
    `  <integer>${THROTTLE_INTERVAL_SECONDS}</integer>`,
    "  <key>StandardOutPath</key>",
    `  ${xmlString("dataDir", join(dataDir, "logs", STDOUT_LOG_FILENAME))}`,
    "  <key>StandardErrorPath</key>",
    `  ${xmlString("dataDir", join(dataDir, "logs", STDERR_LOG_FILENAME))}`,
  ];
  lines.push("  <key>EnvironmentVariables</key>", "  <dict>");
  for (const [key, value] of vars) lines.push(`    <key>${key}</key>`, `    ${xmlString(key, value)}`);
  lines.push("  </dict>");
  lines.push("</dict>", "</plist>", "");
  return lines.join("\n");
}

/** A launchctl run: its exit status, its stderr, and its stdout only when asked for. */
export interface ServiceExecResult {
  readonly status: number;
  readonly stderr: string;
  /** Set only when `ServiceExecOptions.captureStdout` was (`launchctl print` in the start check). */
  readonly stdout?: string;
}

export interface ServiceExecOptions {
  /** Capture stdout, at most `PRINT_STDOUT_MAX_BYTES`. Default: stdout is ignored. */
  readonly captureStdout?: boolean;
}

/** Runs `file` with `args`; returns its exit status and stderr (and stdout when asked for). */
export type ServiceExec = (file: string, args: readonly string[], options?: ServiceExecOptions) => ServiceExecResult;

/**
 * Runs the file with stderr captured and stdout ignored, or captured up to
 * `PRINT_STDOUT_MAX_BYTES` when asked for (more ⇒ `ENOBUFS`, thrown). Throws
 * when it can't be run.
 */
export const defaultExec: ServiceExec = (file, args, options = {}) => {
  const capture = options.captureStdout === true;
  const result = spawnSync(file, args, {
    stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
    encoding: "utf8",
    maxBuffer: PRINT_STDOUT_MAX_BYTES,
  });
  if (result.error !== undefined) {
    const code = (result.error as { code?: unknown }).code;
    throw new ServiceError(`studio service: cannot run ${file}${typeof code === "string" ? ` (${code})` : ""}`);
  }
  // Killed by a signal: no status. Never 0.
  const status = result.status ?? -1;
  const stderr = result.stderr ?? "";
  return capture ? { status, stderr, stdout: result.stdout ?? "" } : { status, stderr };
};

/** The two keys the start check reads from `launchctl print`; anything else in it is ignored. */
export interface LaunchctlPrintFacts {
  /** The running job's pid; absent while it is not running. */
  readonly pid?: number;
  /** As launchctl prints it (e.g. `1`, `78: EX_CONFIG`, `(never exited)`), cut to 100 characters. */
  readonly lastExitCode?: string;
}

/** Parse `launchctl print`'s first `pid = N` and `last exit code = …` lines (pure). */
export function parseLaunchctlPrint(stdout: string): LaunchctlPrintFacts {
  const pid = /^[ \t]*pid = (\d+)[ \t]*$/m.exec(stdout)?.[1];
  const code = /^[ \t]*last exit code = (.+?)[ \t]*$/m.exec(stdout)?.[1];
  const n = pid === undefined ? undefined : Number(pid);
  return {
    ...(n !== undefined && Number.isSafeInteger(n) && n > 0 ? { pid: n } : {}),
    ...(code === undefined ? {} : { lastExitCode: code.slice(0, 100) }),
  };
}

/** Blocks the thread for `ms` without a busy loop: `installService` stays synchronous. */
function defaultSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface ServiceDeps {
  /** Defaults to `defaultExec`. */
  readonly exec?: ServiceExec;
  /** Defaults to `process.getuid()`. */
  readonly uid?: number;
  /** Defaults to `os.homedir()`. */
  readonly homeDir?: string;
  /** Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** `installService`'s waits (the bootout poll, the bootstrap retry). Defaults to blocking the thread. */
  readonly sleep?: (ms: number) => void;
  /** Milliseconds, for the bootout poll's and the start check's bounds. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** The start check's wait between probes (it is async). Defaults to a real timer. */
  readonly delay?: (ms: number) => Promise<void>;
  /** Copies one file or dir tree for the install copy. Defaults to `fs.cpSync` (recursive, symlinks kept verbatim). */
  readonly copy?: (from: string, to: string) => void;
  /** A one-line install warning (the version-manager `node`). Defaults to `process.stderr`. */
  readonly warn?: (line: string) => void;
}

export interface ServiceOptions {
  /** Defaults to `resolveDataDir(env, homeDir)`. Either way it is the plist's logs dir parent and its `STUDIO_DATA_DIR`, and the install copy goes under `<dataDir>/app/`. */
  readonly dataDir?: string;
  /** Defaults to `process.execPath`. */
  readonly nodePath?: string;
  /**
   * The built kernel to copy: the dir holding `dist/daemon.js`, `package.json`,
   * `package-lock.json` and `node_modules/`. Defaults to the kernel dir this
   * module was loaded from (`dist/service/` ⇒ two levels up).
   */
  readonly sourceRoot?: string;
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ServiceResult {
  readonly label: typeof SERVICE_LABEL;
  readonly plistPath: string;
}

export interface InstallResult extends ServiceResult {
  /** The data dir the plist names. */
  readonly dataDir: string;
  /** The install copy: `<dataDir>/app/<version>`. */
  readonly appDir: string;
  /** The copied kernel's `package.json` version. */
  readonly version: string;
}

export interface UninstallResult extends ServiceResult {
  /** `<dataDir>/app`, removed. */
  readonly appRoot: string;
}

interface Resolved {
  readonly exec: ServiceExec;
  readonly uid: number;
  readonly homeDir: string;
  readonly sleep: (ms: number) => void;
  readonly now: () => number;
  readonly delay: (ms: number) => Promise<void>;
  readonly copy: (from: string, to: string) => void;
  readonly warn: (line: string) => void;
}

function defaultCopy(from: string, to: string): void {
  cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Platform first: on anything but macOS, nothing is run, read or written. */
function resolveDeps(deps: ServiceDeps): Resolved {
  if ((deps.platform ?? process.platform) !== "darwin") throw new ServiceError("studio service is macOS only");
  const uid = deps.uid ?? process.getuid?.();
  if (uid === undefined || !Number.isInteger(uid) || uid < 0) throw new ServiceError("studio service: cannot determine the user id");
  return {
    exec: deps.exec ?? defaultExec,
    uid,
    homeDir: deps.homeDir ?? homedir(),
    sleep: deps.sleep ?? defaultSleep,
    now: deps.now ?? Date.now,
    delay: deps.delay ?? defaultDelay,
    copy: deps.copy ?? defaultCopy,
    warn: deps.warn ?? ((line) => void process.stderr.write(`${line}\n`)),
  };
}

function serviceTarget(uid: number): string {
  return `gui/${uid}/${SERVICE_LABEL}`;
}

function launchctl(r: Resolved, args: readonly string[], options?: ServiceExecOptions): ServiceExecResult {
  return options === undefined ? r.exec(LAUNCHCTL_PATH, args) : r.exec(LAUNCHCTL_PATH, args, options);
}

/** The first non-empty line of launchctl's stderr, cut to `STDERR_LINE_MAX` characters. */
function stderrLine(stderr: string): string {
  const line = stderr.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  return line.length > STDERR_LINE_MAX ? `${line.slice(0, STDERR_LINE_MAX)}...` : line;
}

/** `… failed (exit status <n>)`, then `: <stderr line>` when launchctl wrote one. */
function launchctlFailed(command: string, result: ServiceExecResult): ServiceError {
  const line = stderrLine(result.stderr);
  return new ServiceError(`studio service: launchctl ${command} failed (exit status ${result.status})${line === "" ? "" : `: ${line}`}`);
}

function isLoaded(r: Resolved): boolean {
  return launchctl(r, ["print", serviceTarget(r.uid)]).status === 0;
}

/**
 * `launchctl bootout`. Exit status 0 or `BOOTOUT_IN_PROGRESS_STATUS` (the
 * unload has started and may finish asynchronously) returns; any other
 * non-zero status throws. Neither return proves the agent is gone: `install`
 * then polls (`waitUntilBootedOut`), `uninstall` does not wait.
 */
function bootout(r: Resolved): void {
  const result = launchctl(r, ["bootout", serviceTarget(r.uid)]);
  if (result.status === 0 || result.status === BOOTOUT_IN_PROGRESS_STATUS) return;
  throw launchctlFailed(`bootout ${serviceTarget(r.uid)}`, result);
}

/**
 * After `bootout`: ask `launchctl print` every `BOOTOUT_POLL_MS` until the
 * agent is gone. Still loaded after `BOOTOUT_WAIT_MS` ⇒ throws: bootstrapping
 * now would start a kernel that finds the old one still holding the store
 * lock, and that start failure is never restarted.
 */
function waitUntilBootedOut(r: Resolved): void {
  const deadline = r.now() + BOOTOUT_WAIT_MS;
  while (isLoaded(r)) {
    const left = deadline - r.now();
    if (left <= 0) {
      throw new ServiceError(
        `studio service: ${SERVICE_LABEL} still loaded ${BOOTOUT_WAIT_MS / 1000} s after bootout; the previous kernel may still be stopping, run service install again`,
      );
    }
    r.sleep(Math.min(BOOTOUT_POLL_MS, left));
  }
}

/** `launchctl bootstrap gui/<uid> <plist>`, retried once after `BOOTSTRAP_RETRY_DELAY_MS` on exit status 5 only. */
function bootstrap(r: Resolved, path: string): void {
  const args = ["bootstrap", `gui/${r.uid}`, path];
  let result = launchctl(r, args);
  if (result.status === BOOTSTRAP_RETRY_STATUS) {
    r.sleep(BOOTSTRAP_RETRY_DELAY_MS);
    result = launchctl(r, args);
  }
  if (result.status !== 0) throw launchctlFailed(`bootstrap gui/${r.uid}`, result);
}

/** Temp file in the same dir, then rename: a reader never sees a half-written plist. */
function writePlistAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, content, { encoding: "utf8", mode: 0o644 });
    // The mode option is masked by umask: launchd needs it readable, never writable by others.
    chmodSync(tmp, 0o644);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}


/** `path` with symlinks resolved when it exists, else just resolved. */
function realOrResolved(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function isSameOrInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/** The first line of an error's message, for a one-line `ServiceError`. */
function firstLine(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n", 1)[0] ?? "") : String(err);
}

/** A version usable as one dir name under `<dataDir>/app/`: no separator, no leading dot. */
const VERSION_DIR = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/** The version in `<sourceRoot>/package.json`: what `kernelVersion()` reads in the copy. */
function sourceVersion(sourceRoot: string): string {
  const path = join(sourceRoot, "package.json");
  let version: unknown;
  try {
    const pkg: unknown = JSON.parse(readFileSync(path, "utf8"));
    version = typeof pkg === "object" && pkg !== null ? (pkg as { version?: unknown }).version : undefined;
  } catch {
    throw new ServiceError(`studio service: cannot read the kernel version from ${path}`);
  }
  if (typeof version !== "string" || !VERSION_DIR.test(version)) throw new ServiceError(`studio service: ${path} has no usable version`);
  return version;
}

/**
 * The `node_modules/…` entries the install copy needs, derived offline from
 * `<sourceRoot>/package-lock.json` (lockfile v2 or later): every `packages`
 * entry not marked `"dev": true` that exists on disk (an optional platform
 * package for another system is not installed, so it is skipped), minus one
 * a copied ancestor already holds (a nested `node_modules`). Includes
 * `better-sqlite3` (its compiled `.node`) and the installed
 * `@anthropic-ai/claude-agent-sdk-<platform>` package (the CLI binary). No
 * `npm` run, no network.
 */
export function productionModules(sourceRoot: string): string[] {
  const path = join(sourceRoot, "package-lock.json");
  let packages: unknown;
  try {
    const lock: unknown = JSON.parse(readFileSync(path, "utf8"));
    packages = typeof lock === "object" && lock !== null ? (lock as { packages?: unknown }).packages : undefined;
  } catch {
    throw new ServiceError(`studio service: cannot read ${path} (the install copy's dependencies come from it)`);
  }
  if (typeof packages !== "object" || packages === null) {
    throw new ServiceError(`studio service: ${path} has no packages map (lockfile v2 or later needed)`);
  }
  const keys = Object.entries(packages)
    .filter(([key, entry]) => {
      const segments = key.split("/");
      if (segments[0] !== "node_modules" || segments.includes("..") || segments.includes(".bin")) return false;
      return !(typeof entry === "object" && entry !== null && (entry as { dev?: unknown }).dev === true);
    })
    .map(([key]) => key)
    .sort();
  const chosen: string[] = [];
  for (const key of keys) {
    if (chosen.some((c) => key.startsWith(`${c}/`))) continue;
    if (existsSync(join(sourceRoot, key))) chosen.push(key);
  }
  return chosen;
}

/**
 * Copy the built kernel at `sourceRoot` (`dist/`, `package.json` and every
 * `productionModules` entry) to `<appRoot>/<version>` (H07). Atomic: the copy
 * is written to `<appRoot>/.<version>.<pid>.tmp` and renamed into place, so a
 * half-written copy is never used. An existing `<version>` dir (a same-version
 * reinstall) is renamed aside, the new one renamed in, then the old one
 * removed. A failure removes the temp dir and leaves an existing copy as it
 * was. Other versions are never touched here (`removeOldKernelApps`, after a
 * verified start). Returns the copy's path.
 */
export function copyKernelApp(
  sourceRoot: string,
  appRoot: string,
  version: string,
  copy: (from: string, to: string) => void = defaultCopy,
): string {
  if (!VERSION_DIR.test(version)) throw new ServiceError(`studio service: ${JSON.stringify(version)} is not a usable version dir name`);
  const modules = productionModules(sourceRoot);
  const target = join(appRoot, version);
  const tmp = join(appRoot, `.${version}.${process.pid}.tmp`);
  const aside = join(appRoot, `.${version}.${process.pid}.old`);
  mkdirSync(appRoot, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  try {
    mkdirSync(tmp);
    copy(join(sourceRoot, "dist"), join(tmp, "dist"));
    copy(join(sourceRoot, "package.json"), join(tmp, "package.json"));
    for (const module of modules) {
      mkdirSync(dirname(join(tmp, module)), { recursive: true });
      copy(join(sourceRoot, module), join(tmp, module));
    }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw new ServiceError(`studio service: copying the kernel to ${target} failed: ${firstLine(err)}`);
  }
  rmSync(aside, { recursive: true, force: true });
  const replacing = existsSync(target);
  try {
    if (replacing) renameSync(target, aside);
    renameSync(tmp, target);
  } catch (err) {
    // Put the previous copy back where it was, then drop the new one.
    if (replacing && !existsSync(target) && existsSync(aside)) renameSync(aside, target);
    rmSync(tmp, { recursive: true, force: true });
    throw new ServiceError(`studio service: moving the kernel copy into ${target} failed: ${firstLine(err)}`);
  }
  rmSync(aside, { recursive: true, force: true });
  return target;
}

/**
 * Remove every entry of `<dataDir>/app/` except `keepVersion` (older versions,
 * an interrupted install's temp dir). Called only after the start check
 * passed. Never throws: returns the entries it could not remove.
 */
export function removeOldKernelApps(dataDir: string, keepVersion: string): string[] {
  const appRoot = join(dataDir, APP_DIRNAME);
  let entries: string[];
  try {
    entries = readdirSync(appRoot);
  } catch {
    return [];
  }
  const failed: string[] = [];
  for (const entry of entries) {
    if (entry === keepVersion) continue;
    try {
      rmSync(join(appRoot, entry), { recursive: true, force: true });
    } catch {
      failed.push(join(appRoot, entry));
    }
  }
  return failed;
}

/** The one-line warning for a `nodePath` under a version manager's dir (`VERSION_MANAGER_DIRS`), else `undefined`. */
export function versionManagerWarning(nodePath: string, homeDir: string): string | undefined {
  for (const dir of VERSION_MANAGER_DIRS) {
    if (isSameOrInside(resolve(nodePath), join(resolve(homeDir), dir))) {
      return `studio service: warning: node ${nodePath} is under ~/${dir}; the agent stops working if that Node version is removed (then run service install again with another node)`;
    }
  }
  return undefined;
}

/**
 * Copy the kernel to `<dataDir>/app/<version>` (`copyKernelApp`), write the
 * plist (atomically, mode 0644) to exactly `plistPath(homeDir)` running that
 * copy's `dist/daemon.js`, create `<dataDir>/logs` (mode 0700), boot out the
 * agent when `launchctl print` says it is already loaded (a bootout exiting
 * 36, in progress, is not a failure) and wait (at most `BOOTOUT_WAIT_MS`)
 * until it is gone, then `launchctl bootstrap gui/<uid> <plist>`, retried once
 * on exit status 5. A failing launchctl throws one line naming its exit
 * status and its first stderr line.
 *
 * Refused before anything is copied, written or loaded: no built daemon in
 * `sourceRoot`, an install target inside a protected folder (D31), or a
 * `sourceRoot` that is itself under `<dataDir>/app/` (install runs from the
 * checkout, never copies an installed copy onto itself). A `nodePath` under a
 * version manager is warned about (`deps.warn`), not refused.
 *
 * Loaded is not running: the caller runs `verifyServiceStart` next, and only
 * then removes older versions (`removeOldKernelApps`).
 */
export function installService(options: ServiceOptions = {}, deps: ServiceDeps = {}): InstallResult {
  const r = resolveDeps(deps);
  const env = options.env ?? process.env;
  const dataDir = resolve(absolute("dataDir", options.dataDir ?? resolveDataDir(env, r.homeDir)));
  const sourceRoot = resolve(options.sourceRoot ?? fileURLToPath(new URL("../..", import.meta.url)));
  const builtDaemon = join(sourceRoot, "dist", "daemon.js");
  if (!existsSync(builtDaemon)) throw new ServiceError(`studio service: no built daemon at ${builtDaemon} (run npm run build first)`);
  const version = sourceVersion(sourceRoot);
  const appRoot = join(dataDir, APP_DIRNAME);
  const appDir = join(appRoot, version);
  // D31: refused before anything is copied, written or loaded.
  if (isProtectedPath(appDir, r.homeDir)) {
    throw new ServiceError(
      `studio service: install target ${appDir} is inside a macOS-protected folder (${protectedLocationsText()}) that a launchd agent can't read (D31); set STUDIO_DATA_DIR to a dir outside them`,
    );
  }
  if (isSameOrInside(realOrResolved(sourceRoot), realOrResolved(appRoot))) {
    throw new ServiceError(`studio service: ${sourceRoot} is an installed copy; run service install from the kernel checkout`);
  }
  const nodePath = options.nodePath ?? process.execPath;
  // Rendered (and validated) before anything is written.
  const content = renderPlist({ nodePath, daemonPath: join(appDir, "dist", "daemon.js"), dataDir, env });
  const warning = versionManagerWarning(nodePath, r.homeDir);
  if (warning !== undefined) r.warn(warning);

  copyKernelApp(sourceRoot, appRoot, version, r.copy);
  const logs = join(dataDir, "logs");
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  chmodSync(logs, 0o700);
  const path = plistPath(r.homeDir);
  writePlistAtomic(path, content);

  if (isLoaded(r)) {
    bootout(r);
    waitUntilBootedOut(r);
  }
  bootstrap(r, path);
  return { label: SERVICE_LABEL, plistPath: path, dataDir, appDir, version };
}

/** What `verifyServiceStart` reads to tell the new kernel is answering; the CLI's own deps. */
export interface StartCheckProbe {
  readonly keychain: KeychainReader;
  readonly fetch: typeof fetch;
  /** Checked before the token is read or sent, as the CLI does. */
  readonly isPidAlive: (pid: number) => boolean;
}

export interface StartCheckOptions {
  /** The data dir the plist names (`InstallResult.dataDir`): its `api.json` and `logs/kernel.err.log`. */
  readonly dataDir: string;
  /** Default `START_CHECK_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Default `START_CHECK_POLL_MS`. */
  readonly pollMs?: number;
}

export type StartCheckResult =
  | { readonly ok: true; readonly pid: number; readonly version: string }
  /** The failure output, one entry per line; the agent was booted out and its plist removed. */
  | { readonly ok: false; readonly lines: readonly string[] };

type Probe = { readonly up: true; readonly pid: number; readonly version: string } | { readonly up: false; readonly why: string };

/** `<dataDir>/api.json`'s port and pid, or `undefined` when missing or unreadable. */
function readApiInfoFile(dataDir: string): { port: number; pid: number } | undefined {
  try {
    const info: unknown = JSON.parse(readFileSync(join(dataDir, API_INFO_FILENAME), "utf8"));
    const { port, pid } = (typeof info === "object" && info !== null ? info : {}) as { port?: unknown; pid?: unknown };
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) return undefined;
    return { port, pid };
  } catch {
    return undefined;
  }
}

/** `launchctl print` with its stdout parsed; `undefined` when it fails or the job is not loaded. */
function printFacts(r: Resolved): LaunchctlPrintFacts | undefined {
  try {
    const result = launchctl(r, ["print", serviceTarget(r.uid)], { captureStdout: true });
    return result.status === 0 ? parseLaunchctlPrint(result.stdout ?? "") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One probe. The new kernel is up only when `launchctl print` reports the
 * job's pid, `api.json` names that same pid (a stale `api.json` from the
 * previous kernel names another, or a pid launchd no longer runs), that pid
 * is alive, the API token is in the Keychain, and `GET /status` with it
 * answers 200 naming that pid. Everything else is "not up yet", never a
 * failure on its own.
 */
async function probeOnce(r: Resolved, dataDir: string, probe: StartCheckProbe, deadline: number): Promise<Probe> {
  const facts = printFacts(r);
  if (facts === undefined) return { up: false, why: "the agent is not loaded" };
  if (facts.pid === undefined) return { up: false, why: "the agent has no running process" };
  const info = readApiInfoFile(dataDir);
  if (info === undefined) return { up: false, why: `no readable ${join(dataDir, API_INFO_FILENAME)}` };
  if (info.pid !== facts.pid) return { up: false, why: `${API_INFO_FILENAME} names pid ${info.pid}, not the agent's pid ${facts.pid}` };
  if (!probe.isPidAlive(info.pid)) return { up: false, why: `pid ${info.pid} is gone` };
  let token: string | undefined;
  try {
    token = probe.keychain.read(API_TOKEN_KEYCHAIN_SERVICE);
  } catch {
    return { up: false, why: `Keychain read of "${API_TOKEN_KEYCHAIN_SERVICE}" failed` };
  }
  if (token === undefined || token === "") return { up: false, why: `no API token in Keychain item "${API_TOKEN_KEYCHAIN_SERVICE}" yet` };
  const timeoutMs = Math.max(1, Math.min(START_CHECK_FETCH_TIMEOUT_MS, deadline - r.now()));
  let res: Response;
  try {
    res = await probe.fetch(`http://${API_HOST}:${info.port}/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { up: false, why: `GET /status on ${API_HOST}:${info.port} did not answer` };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    return { up: false, why: `GET /status answered ${res.status}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { up: false, why: "GET /status sent an unreadable answer" };
  }
  const kernel = typeof body === "object" && body !== null ? (body as { kernel?: { version?: unknown; pid?: unknown } }).kernel : undefined;
  if (typeof kernel?.pid === "number" && kernel.pid !== info.pid) return { up: false, why: `GET /status answered for pid ${kernel.pid}` };
  return { up: true, pid: info.pid, version: typeof kernel?.version === "string" ? kernel.version : "unknown" };
}

/** The last `n` lines of `path` (at most `LOG_TAIL_MAX_BYTES` read, each cut to `STDERR_LINE_MAX`), or `undefined` when unreadable. */
function tailLines(path: string, n: number): string[] | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, LOG_TAIL_MAX_BYTES);
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, size - length);
    let lines = buffer.subarray(0, read).toString("utf8").split(/\r?\n/);
    // A read that starts mid-file starts mid-line.
    if (length < size) lines = lines.slice(1);
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-n).map((l) => (l.length > STDERR_LINE_MAX ? `${l.slice(0, STDERR_LINE_MAX)}...` : l));
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** A log line about a failed or timed-out Keychain read or write (`KeychainError`, `keychain.ts`). */
function isKeychainFailure(line: string): boolean {
  return /keychain/i.test(line) && /fail|timed? ?out|SIGTERM/i.test(line);
}

/** The hint line a Keychain failure in the log tail adds. */
export const KEYCHAIN_PROMPT_HINT =
  "studio service: hint: a Keychain prompt for /usr/bin/security may be waiting: choose Always Allow, then run studio service install again";

/** The failure output, after reading `last exit code`, the log tail, then booting the agent out and removing the plist. */
function startFailure(r: Resolved, dataDir: string, timeoutMs: number, last: string): string[] {
  const lines = [`studio service: the kernel did not answer GET /status within ${timeoutMs / 1000} s (last: ${last})`];
  // Before the bootout: afterwards launchctl print knows no job.
  lines.push(`studio service: launchctl print: last exit code = ${printFacts(r)?.lastExitCode ?? "unknown"}`);
  const logPath = join(dataDir, "logs", STDERR_LOG_FILENAME);
  const tail = tailLines(logPath, START_FAILURE_LOG_LINES);
  if (tail === undefined || tail.length === 0) {
    lines.push(`studio service: nothing in ${logPath}`);
  } else {
    lines.push(`studio service: last ${tail.length} lines of ${logPath}:`, ...tail.map((l) => `  ${l}`));
    if (tail.some(isKeychainFailure)) lines.push(KEYCHAIN_PROMPT_HINT);
  }
  // So launchd neither restarts it in a loop now nor starts it at the next login (RunAtLoad).
  const path = plistPath(r.homeDir);
  let unloaded = true;
  try {
    if (isLoaded(r)) bootout(r);
  } catch (err) {
    unloaded = false;
    lines.push(`${firstLine(err)}; run studio service uninstall`);
  }
  try {
    rmSync(path, { force: true });
    lines.push(
      `studio service: ${unloaded ? `${SERVICE_LABEL} booted out and ` : ""}${path} removed; the install copy and ${dataDir} are kept`,
    );
  } catch (err) {
    lines.push(`studio service: cannot remove ${path}: ${firstLine(err)}`);
  }
  return lines;
}

/**
 * The start check after `installService` (H07): probe every `pollMs` until
 * the new kernel answers `GET /status` (`probeOnce`) or `timeoutMs` (15 s)
 * runs out. A missing or unreadable `api.json`, a pid other than the job's, no
 * API token yet (a first install's kernel creates it), a refused connection
 * or a non-200 answer all mean "not up yet". The deadline is checked between
 * probes; one probe's Keychain read (`security`, at most 10 s, `keychain.ts`)
 * can't be cut short, so a hung read can run past it once.
 *
 * Passing ⇒ `{ok: true, pid, version}` (from `/status`). Failing ⇒ the
 * failure output (the last probe's reason, `launchctl print`'s `last exit
 * code`, the last `START_FAILURE_LOG_LINES` lines of `kernel.err.log`, and a
 * Keychain-prompt hint when that tail shows a Keychain failure); the agent is
 * booted out and the plist removed (the install copy and the data dir are
 * kept), so launchd can't restart a broken kernel in a loop or at the next
 * login.
 */
export async function verifyServiceStart(
  options: StartCheckOptions,
  probe: StartCheckProbe,
  deps: ServiceDeps = {},
): Promise<StartCheckResult> {
  const r = resolveDeps(deps);
  const timeoutMs = options.timeoutMs ?? START_CHECK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? START_CHECK_POLL_MS;
  const deadline = r.now() + timeoutMs;
  let last = "not probed";
  for (;;) {
    const result = await probeOnce(r, options.dataDir, probe, deadline);
    if (result.up) return { ok: true, pid: result.pid, version: result.version };
    last = result.why;
    const left = deadline - r.now();
    if (left <= 0) break;
    await r.delay(Math.min(pollMs, left));
  }
  return { ok: false, lines: startFailure(r, options.dataDir, timeoutMs, last) };
}

/**
 * Boot the agent out when `launchctl print` says it is loaded (exit status 0
 * or 36, in progress), then remove `plistPath(homeDir)` if it exists, then
 * `<dataDir>/app/` (the install copies). The data dir's logs, store and
 * everything else stay. Idempotent: nothing loaded, no plist and no app dir
 * is a success. A failing bootout throws and removes nothing.
 */
export function uninstallService(options: Pick<ServiceOptions, "dataDir" | "env"> = {}, deps: ServiceDeps = {}): UninstallResult {
  const r = resolveDeps(deps);
  const env = options.env ?? process.env;
  const dataDir = resolve(absolute("dataDir", options.dataDir ?? resolveDataDir(env, r.homeDir)));
  const path = plistPath(r.homeDir);
  if (isLoaded(r)) bootout(r);
  rmSync(path, { force: true });
  const appRoot = join(dataDir, APP_DIRNAME);
  rmSync(appRoot, { recursive: true, force: true });
  return { label: SERVICE_LABEL, plistPath: path, appRoot };
}
