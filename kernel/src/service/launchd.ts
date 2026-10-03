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
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_PROVIDER_ENV, authProviderFromEnv } from "../auth/provider-env.js";
import { DATA_DIR_ENV, resolveDataDir } from "../store/store.js";

/** The agent's launchd label. */
export const SERVICE_LABEL = "com.loomwright.studio.kernel";

/** launchctl by absolute path: never resolved through PATH. */
export const LAUNCHCTL_PATH = "/bin/launchctl";

/** Under `<dataDir>/logs/`. */
export const STDOUT_LOG_FILENAME = "kernel.out.log";
export const STDERR_LOG_FILENAME = "kernel.err.log";

/** `<homeDir>/Library/LaunchAgents/com.loomwright.studio.kernel.plist`. */
export function plistPath(homeDir: string): string {
  return join(homeDir, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

/** A `studio service` failure: one line, never launchctl's own output. */
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
 * daemonPath]`; `RunAtLoad`; `KeepAlive` = `{SuccessfulExit: false}` (launchd
 * restarts the kernel after a crash or `kill -9`, never after a graceful
 * SIGTERM exit 0); stdout/stderr to `<dataDir>/logs/kernel.{out,err}.log`; and
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
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
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

/** Runs `file` with `args` and returns its exit status; launchctl's output is never shown or returned. */
export type ServiceExec = (file: string, args: readonly string[]) => number;

const defaultExec: ServiceExec = (file, args) => {
  const result = spawnSync(file, args, { stdio: "ignore" });
  if (result.error !== undefined) {
    const code = (result.error as { code?: unknown }).code;
    throw new ServiceError(`studio service: cannot run ${file}${typeof code === "string" ? ` (${code})` : ""}`);
  }
  // Killed by a signal: no status. Never 0.
  return result.status ?? -1;
};

export interface ServiceDeps {
  /** Defaults to running the file with its output ignored. */
  readonly exec?: ServiceExec;
  /** Defaults to `process.getuid()`. */
  readonly uid?: number;
  /** Defaults to `os.homedir()`. */
  readonly homeDir?: string;
  /** Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
}

export interface ServiceOptions {
  /** Defaults to `resolveDataDir(env, homeDir)`. Either way it is the plist's logs dir parent and its `STUDIO_DATA_DIR`. */
  readonly dataDir?: string;
  /** Defaults to `process.execPath`. */
  readonly nodePath?: string;
  /** Defaults to the built `daemon.js` next to this module's dir; refused unless it exists. */
  readonly daemonPath?: string;
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ServiceResult {
  readonly label: typeof SERVICE_LABEL;
  readonly plistPath: string;
}

interface Resolved {
  readonly exec: ServiceExec;
  readonly uid: number;
  readonly homeDir: string;
}

/** Platform first: on anything but macOS, nothing is run, read or written. */
function resolveDeps(deps: ServiceDeps): Resolved {
  if ((deps.platform ?? process.platform) !== "darwin") throw new ServiceError("studio service is macOS only");
  const uid = deps.uid ?? process.getuid?.();
  if (uid === undefined || !Number.isInteger(uid) || uid < 0) throw new ServiceError("studio service: cannot determine the user id");
  return { exec: deps.exec ?? defaultExec, uid, homeDir: deps.homeDir ?? homedir() };
}

function serviceTarget(uid: number): string {
  return `gui/${uid}/${SERVICE_LABEL}`;
}

function launchctl(r: Resolved, args: readonly string[]): number {
  return r.exec(LAUNCHCTL_PATH, args);
}

function isLoaded(r: Resolved): boolean {
  return launchctl(r, ["print", serviceTarget(r.uid)]) === 0;
}

function bootout(r: Resolved): void {
  const status = launchctl(r, ["bootout", serviceTarget(r.uid)]);
  if (status !== 0) throw new ServiceError(`studio service: launchctl bootout ${serviceTarget(r.uid)} failed (exit status ${status})`);
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

/**
 * Write the plist (atomically, mode 0644) to exactly `plistPath(homeDir)`,
 * create `<dataDir>/logs` (mode 0700), boot out the agent when `launchctl
 * print` says it is already loaded, then `launchctl bootstrap gui/<uid>
 * <plist>`. A failing launchctl throws one line naming its exit status.
 */
export function installService(options: ServiceOptions = {}, deps: ServiceDeps = {}): ServiceResult {
  const r = resolveDeps(deps);
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? resolveDataDir(env, r.homeDir);
  const daemonPath = options.daemonPath ?? fileURLToPath(new URL("../daemon.js", import.meta.url));
  if (!isAbsolute(daemonPath) || !existsSync(daemonPath)) {
    throw new ServiceError(`studio service: no built daemon at ${daemonPath} (run npm run build first)`);
  }
  // Rendered (and validated) before anything is written.
  const content = renderPlist({ nodePath: options.nodePath ?? process.execPath, daemonPath, dataDir, env });

  const logs = join(dataDir, "logs");
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  chmodSync(logs, 0o700);
  const path = plistPath(r.homeDir);
  writePlistAtomic(path, content);

  if (isLoaded(r)) bootout(r);
  const status = launchctl(r, ["bootstrap", `gui/${r.uid}`, path]);
  if (status !== 0) throw new ServiceError(`studio service: launchctl bootstrap gui/${r.uid} failed (exit status ${status})`);
  return { label: SERVICE_LABEL, plistPath: path };
}

/**
 * Boot the agent out when `launchctl print` says it is loaded, then remove
 * `plistPath(homeDir)` if it exists. Idempotent: nothing loaded and no plist
 * is a success.
 */
export function uninstallService(deps: ServiceDeps = {}): ServiceResult {
  const r = resolveDeps(deps);
  const path = plistPath(r.homeDir);
  if (isLoaded(r)) bootout(r);
  rmSync(path, { force: true });
  return { label: SERVICE_LABEL, plistPath: path };
}
