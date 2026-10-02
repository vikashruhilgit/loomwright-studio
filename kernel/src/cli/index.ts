#!/usr/bin/env node
// The `studio` CLI (item 08, AC4): talks to the kernel's loopback API.
//
//   studio status [--json]   a short summary of GET /status (or its raw JSON)
//   studio stop --all        POST /stop-all: the kill switch
//   studio resume            POST /resume: release the kill switch
//
// It only ever connects to 127.0.0.1 on the port in <dataDir>/api.json, and
// reads or sends the Keychain token only after checking that api.json's pid
// is alive. It never prints the token.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { StatusBody } from "../api/server.js";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../api/token.js";
import { securityCliKeychain } from "../auth/keychain.js";
import type { KeychainReader } from "../auth/keychain.js";
import { resolveDataDir } from "../store/store.js";

const HOST = "127.0.0.1";
const API_INFO_FILENAME = "api.json";
export const CLI_TIMEOUT_MS = 5_000;

export const USAGE = "usage: studio status [--json] | studio stop --all | studio resume";

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
  /** Default `CLI_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

type Command =
  | { readonly kind: "status"; readonly json: boolean }
  | { readonly kind: "stop-all" }
  | { readonly kind: "resume" };

/** A failure that ends the CLI with one stderr line and exit code 1. */
class CliFailure extends Error {}

function parse(argv: readonly string[]): Command | undefined {
  const [cmd, ...rest] = argv;
  if (cmd === "status" && rest.length === 0) return { kind: "status", json: false };
  if (cmd === "status" && rest.length === 1 && rest[0] === "--json") return { kind: "status", json: true };
  if (cmd === "stop" && rest.length === 1 && rest[0] === "--all") return { kind: "stop-all" };
  if (cmd === "resume" && rest.length === 0) return { kind: "resume" };
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
 * non-2xx answer ⇒ exactly one stderr line, 1. Never throws, never sets
 * `process.exitCode`, never prints the token.
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
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(`http://${HOST}:${port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(deps.timeoutMs ?? CLI_TIMEOUT_MS),
      });
    } catch (err) {
      if (isTimeout(err)) throw new CliFailure(`studio: kernel daemon did not answer within ${(deps.timeoutMs ?? CLI_TIMEOUT_MS) / 1_000} s (${HOST}:${port})`);
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
      const outcomes = ((body as { sessions?: unknown }).sessions ?? []) as readonly { status?: unknown }[];
      const failed = outcomes.filter((o) => o.status === "stop_failed").length;
      stdout.write(
        `kill switch engaged: ${plural(outcomes.length - failed, "session")} stopped` +
          `${failed === 0 ? "" : `, ${failed} failed to stop`}; the event loop is halted until studio resume\n`,
      );
    } else {
      stdout.write("kill switch off: the event loop is running\n");
    }
    return 0;
  } catch (err) {
    stderr.write(`${err instanceof CliFailure ? err.message : `studio: ${err instanceof Error ? err.message.split("\n", 1)[0] : String(err)}`}\n`);
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
