#!/usr/bin/env node
// The `studio` CLI (item 08, AC4): talks to the kernel's loopback API.
//
//   studio status [--json]   a short summary of GET /status (or its raw JSON)
//   studio stop --all        POST /stop-all: the kill switch
//   studio resume            POST /resume: release the kill switch
//   studio service install   write and load the launchd agent (item 09, macOS)
//   studio service uninstall unload and remove it
//
// `service` runs locally and needs no daemon, api.json or Keychain. The others
// only ever connect to 127.0.0.1 on the port in <dataDir>/api.json, and read
// or send the Keychain token only after checking that api.json's pid is
// alive. The CLI never prints the token.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { StatusBody } from "../api/server.js";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../api/token.js";
import { securityCliKeychain } from "../auth/keychain.js";
import type { KeychainReader } from "../auth/keychain.js";
import { ServiceError, installService, uninstallService } from "../service/launchd.js";
import type { ServiceDeps, ServiceOptions } from "../service/launchd.js";
// The leaf modules, not the sessions index: that one loads the Agent SDK.
import { KILL_GROUP_DEADLINE_MS, LEADER_EXIT_WAIT_MS } from "../sessions/spawner.js";
import { DEFAULT_STOP_GRACE_MS } from "../sessions/types.js";
import { resolveDataDir } from "../store/store.js";

const HOST = "127.0.0.1";
const API_INFO_FILENAME = "api.json";
/** How long `status` and `resume` wait for the daemon's answer. */
export const CLI_TIMEOUT_MS = 5_000;
/**
 * Slack on top of one session's worst-case stop for `stop --all`: the loop's
 * in-flight event finishing (`loop.stop()`), the `ps` identity probes and the
 * `stop_all_completed` write.
 */
export const STOP_ALL_MARGIN_MS = 25_000;
/**
 * How long `stop --all` waits. Sessions stop concurrently, and one session's
 * worst case is its stop grace, then the group kill's deadline, then the wait
 * for the killed leader's exit; derived from those constants so it cannot
 * drift below them. A daemon started with a longer `stopGraceMs` than the
 * default needs `CliDeps.stopAllTimeoutMs`.
 */
export const STOP_ALL_TIMEOUT_MS = DEFAULT_STOP_GRACE_MS + KILL_GROUP_DEADLINE_MS + LEADER_EXIT_WAIT_MS + STOP_ALL_MARGIN_MS;

export const USAGE = "usage: studio status [--json] | studio stop --all | studio resume | studio service install|uninstall";

/** Where the CLI writes; `process.stdout` / `process.stderr` satisfy it. */
export interface CliOutput {
  write(chunk: string): unknown;
}

export interface CliDeps {
  /** Defaults to `resolveDataDir(process.env)`. */
  readonly dataDir?: string;
  /** Defaults to the real `/usr/bin/security` reader. */
  readonly keychain?: KeychainReader;
  readonly fetch?: typeof fetch;
  /** Defaults to `process.kill(pid, 0)`; `ESRCH` or `EPERM` (another user's process) ⇒ not alive. */
  readonly isPidAlive?: (pid: number) => boolean;
  readonly stdout?: CliOutput;
  readonly stderr?: CliOutput;
  /** `status` and `resume`. Default `CLI_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** `stop --all`. Default `STOP_ALL_TIMEOUT_MS`. */
  readonly stopAllTimeoutMs?: number;
  /** `service install|uninstall`: the launchd module's options and deps (exec, uid, homeDir, platform). */
  readonly service?: { readonly options?: ServiceOptions; readonly deps?: ServiceDeps };
}

type Command =
  | { readonly kind: "status"; readonly json: boolean }
  | { readonly kind: "stop-all" }
  | { readonly kind: "resume" }
  | { readonly kind: "service"; readonly action: "install" | "uninstall" };

/** A failure that ends the CLI with one stderr line and exit code 1. */
class CliFailure extends Error {}

function parse(argv: readonly string[]): Command | undefined {
  const [cmd, ...rest] = argv;
  if (cmd === "status" && rest.length === 0) return { kind: "status", json: false };
  if (cmd === "status" && rest.length === 1 && rest[0] === "--json") return { kind: "status", json: true };
  if (cmd === "stop" && rest.length === 1 && rest[0] === "--all") return { kind: "stop-all" };
  if (cmd === "resume" && rest.length === 0) return { kind: "resume" };
  if (cmd === "service" && rest.length === 1 && (rest[0] === "install" || rest[0] === "uninstall")) return { kind: "service", action: rest[0] };
  return undefined;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: no such process. EPERM: another user's process, never this
    // user's daemon. Anything else: unknown, so never send the token to it.
    return false;
  }
}

function readApiInfo(dataDir: string): { port: number; pid: number } {
  const path = join(dataDir, API_INFO_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new CliFailure(`studio: kernel daemon is not running (no ${path})`);
  }
  let info: unknown;
  try {
    info = JSON.parse(raw);
  } catch {
    throw new CliFailure(`studio: kernel daemon is not running (unreadable ${path})`);
  }
  const { port, pid } = (typeof info === "object" && info !== null ? info : {}) as { port?: unknown; pid?: unknown };
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535 || typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) {
    throw new CliFailure(`studio: kernel daemon is not running (unreadable ${path})`);
  }
  return { port, pid };
}

function errorCode(err: unknown): string | undefined {
  for (let e: unknown = err; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function isTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TimeoutError";
}

function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const parts = d > 0 ? [`${d}d`, `${h}h`, `${m}m`] : h > 0 ? [`${h}h`, `${m}m`] : m > 0 ? [`${m}m`, `${s % 60}s`] : [`${s}s`];
  return parts.join(" ");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Statuses a session can end a kill-switch stop with in which it is known not
 * to be running and its group is not left alive: it had already ended on its
 * own (`completed`, `interrupted`), or ended `failed:auth` and the stop
 * confirmed its group gone. The session manager reports a `failed:auth`
 * session whose group it could not confirm gone as `stop_failed`
 * (`kill_incomplete`), never `failed:auth`, so that one is not confirmed
 * stopped. Reported by status, never counted as `stopped`.
 */
const ALREADY_ENDED: ReadonlySet<string> = new Set(["completed", "interrupted", "failed:auth"]);

/**
 * Summarize `/stop-all`'s per-session outcomes for the kill switch's
 * confirmation line. Only `stopped` counts as stopped; an outcome that ended on
 * its own is listed by status; anything else (`failed`, e.g. `kill_incomplete`
 * with the group not confirmed gone, `stop_failed`, `orphaned`, or a status
 * this CLI does not know) is "not confirmed stopped" and makes `confirmed`
 * false, so the command exits non-zero.
 */
export function summarizeStopAll(sessions: unknown): { readonly text: string; readonly confirmed: boolean } {
  const outcomes = (Array.isArray(sessions) ? sessions : []) as readonly { id?: unknown; status?: unknown }[];
  const label = (o: { id?: unknown; status?: unknown }): string => `#${String(o.id ?? "?")} ${String(o.status ?? "unknown")}`;
  const stopped = outcomes.filter((o) => o.status === "stopped");
  const ended = outcomes.filter((o) => typeof o.status === "string" && ALREADY_ENDED.has(o.status));
  const unconfirmed = outcomes.filter((o) => o.status !== "stopped" && !(typeof o.status === "string" && ALREADY_ENDED.has(o.status)));
  const parts = [`${plural(stopped.length, "session")} stopped`];
  if (ended.length > 0) parts.push(`${ended.length} already ended (${ended.map(label).join(", ")})`);
  if (unconfirmed.length > 0) {
    parts.push(`${unconfirmed.length} not confirmed stopped (${unconfirmed.map(label).join(", ")}), see studio status`);
  }
  return { text: parts.join("; "), confirmed: unconfirmed.length === 0 };
}

/** A short human summary of `/status`. */
export function formatStatus(status: StatusBody): string {
  const lines: string[] = [];
  lines.push(`kernel ${status.kernel.version}, pid ${status.kernel.pid}, up ${duration(status.kernel.uptime_s)}`);
  lines.push(
    status.kill_switch.engaged
      ? `kill switch: ENGAGED since ${status.kill_switch.since ?? "unknown"} (studio resume releases it)`
      : "kill switch: off",
  );
  for (const p of status.auth) {
    const h = p.health;
    const health = h.status === "expiring" ? `expiring (${h.days} days left)` : h.status;
    lines.push(`auth: ${p.id} (${p.account ?? "unknown account"}): ${health}`);
  }
  lines.push(`sessions: ${status.sessions.length} running`);
  for (const s of status.sessions) {
    lines.push(`  #${s.id} ${s.agent ?? "-"} ${s.model ?? "-"} ${s.status}, pgid ${s.pgid ?? "-"}, started ${s.started_at ?? "-"}`);
  }
  // `?? []`: a daemon older than this CLI does not send the field.
  const unconfirmed = status.kill_unconfirmed ?? [];
  if (unconfirmed.length > 0) {
    lines.push(`kill unconfirmed: ${plural(unconfirmed.length, "session")} whose group may still be alive (the reaper retries the kill)`);
    for (const s of unconfirmed) {
      lines.push(`  #${s.id} ${s.agent ?? "-"} ${s.status}, pgid ${s.pgid ?? "-"}, kill gave up at ${s.kill_incomplete_at}`);
    }
  }
  lines.push(`queue: ${plural(status.queue.pending, "pending event")}, ${plural(status.wakeups.pending, "pending wake-up")}`);
  const tokens = status.tokens_today.agents.map((a) => `${a.agent ?? "(none)"} ${a.counted_tokens}`);
  lines.push(`tokens today (${status.tokens_today.day}): ${tokens.length === 0 ? "none" : tokens.join(", ")}`);
  if (status.cap_state.length === 0) lines.push("cap: no state recorded");
  for (const c of status.cap_state) {
    const limits = c.limits.map((l) => `${l.rate_limit_type} ${l.status}${l.resets_at === null ? "" : ` until ${l.resets_at}`}`);
    lines.push(`cap ${c.account}: ${limits.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Run one CLI command; resolves to the exit code. Bad usage ⇒ usage on
 * stderr, 2. "Daemon not running" (no or unreadable `api.json`, its pid not
 * alive, no API token in the Keychain, a connection error or timeout) or a
 * non-2xx answer ⇒ exactly one stderr line, 1. `stop --all` waits
 * `STOP_ALL_TIMEOUT_MS`, the others `CLI_TIMEOUT_MS`; a `stop --all` that
 * times out says the kill switch may already be engaged (one stderr line, 1).
 * `stop --all` with any session not confirmed stopped (see
 * `summarizeStopAll`) ⇒ its summary on stdout, 1.
 * `service install|uninstall` runs locally, before `api.json` or the Keychain
 * is read: one stdout line naming the label and plist, 0; a failure (not
 * macOS, no built daemon, launchctl failed) ⇒ one stderr line, 1.
 * Never throws, never sets `process.exitCode`, never prints the token.
 */
export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const command = parse(argv);
  if (command === undefined) {
    stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    if (command.kind === "service") {
      // Needs no daemon: dispatched before api.json or the Keychain is read.
      const service = deps.service ?? {};
      if (command.action === "install") {
        const options = deps.dataDir === undefined ? (service.options ?? {}) : { dataDir: deps.dataDir, ...service.options };
        const r = installService(options, service.deps);
        stdout.write(`studio: service ${r.label} installed and loaded (${r.plistPath})\n`);
      } else {
        const r = uninstallService(service.deps);
        stdout.write(`studio: service ${r.label} unloaded and removed (${r.plistPath})\n`);
      }
      return 0;
    }
    const dataDir = deps.dataDir ?? resolveDataDir(process.env);
    const { port, pid } = readApiInfo(dataDir);
    // Before the token is read or sent: a stale api.json (left by a `kill -9`)
    // must never send it to whatever now holds that port.
    if (!(deps.isPidAlive ?? defaultIsPidAlive)(pid)) {
      throw new CliFailure(`studio: kernel daemon is not running (pid ${pid} in ${join(dataDir, API_INFO_FILENAME)} is gone)`);
    }
    let token: string | undefined;
    try {
      token = (deps.keychain ?? securityCliKeychain()).read(API_TOKEN_KEYCHAIN_SERVICE);
    } catch (err) {
      // KeychainError carries the service and exit status only.
      throw new CliFailure(`studio: ${err instanceof Error ? err.message : "Keychain read failed"}`);
    }
    if (token === undefined || token === "") {
      throw new CliFailure(`studio: kernel daemon is not running (no API token in Keychain item "${API_TOKEN_KEYCHAIN_SERVICE}")`);
    }

    const method = command.kind === "status" ? "GET" : "POST";
    const path = command.kind === "status" ? "/status" : command.kind === "stop-all" ? "/stop-all" : "/resume";
    const timeoutMs = command.kind === "stop-all" ? (deps.stopAllTimeoutMs ?? STOP_ALL_TIMEOUT_MS) : (deps.timeoutMs ?? CLI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(`http://${HOST}:${port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err) && command.kind === "stop-all") {
        // The daemon engages the kill switch before it stops anything, so a
        // slow answer is not "daemon down": the switch may already be on.
        throw new CliFailure(
          `studio: kernel daemon did not answer ${method} ${path} within ${timeoutMs / 1_000} s (${HOST}:${port}); the kill switch may already be engaged, run studio status`,
        );
      }
      if (isTimeout(err)) throw new CliFailure(`studio: kernel daemon did not answer within ${timeoutMs / 1_000} s (${HOST}:${port})`);
      const code = errorCode(err);
      throw new CliFailure(`studio: kernel daemon is not running (cannot connect to ${HOST}:${port}${code === undefined ? "" : `: ${code}`})`);
    }
    if (!res.ok) throw new CliFailure(`studio: kernel API answered ${res.status} to ${method} ${path}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new CliFailure(`studio: kernel API sent an unreadable answer to ${method} ${path}`);
    }

    if (command.kind === "status") {
      stdout.write(command.json ? `${JSON.stringify(body, null, 2)}\n` : formatStatus(body as StatusBody));
    } else if (command.kind === "stop-all") {
      const summary = summarizeStopAll((body as { sessions?: unknown }).sessions);
      stdout.write(`kill switch engaged: ${summary.text}; the event loop is halted until studio resume\n`);
      return summary.confirmed ? 0 : 1;
    } else {
      stdout.write("kill switch off: the event loop is running\n");
    }
    return 0;
  } catch (err) {
    stderr.write(`${err instanceof CliFailure || err instanceof ServiceError ? err.message : `studio: ${err instanceof Error ? err.message.split("\n", 1)[0] : String(err)}`}\n`);
    return 1;
  }
}

/** True only when this module is the process entry point (`realpath` resolves npm's `bin` symlink). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
