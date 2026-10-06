#!/usr/bin/env node
// The `studio` CLI (item 08, AC4): talks to the kernel's loopback API.
//
//   studio status [--json]   a short summary of GET /status (or its raw JSON)
//   studio stop --all        POST /stop-all: the kill switch
//   studio resume            POST /resume: release the kill switch
//   studio session abandon <id> [--yes]
//                            POST /sessions/<id>/abandon: release an orphaned
//                            leader_unverified row (asks first unless --yes)
//   studio service install   copy the kernel to <dataDir>/app/<version>, write
//                            and load the launchd agent, and check it starts
//                            (item 09, H07, macOS)
//   studio service uninstall unload and remove it and <dataDir>/app/
//
// `service` needs no running daemon to begin with; install's start check then
// reads the new kernel's api.json and the Keychain token, with the same rules
// as the other commands. Those only ever connect to 127.0.0.1 on the port in
// <dataDir>/api.json, and read or send the Keychain token only after checking
// that api.json's pid is alive. The CLI never prints the token.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import type { StatusBody } from "../api/server.js";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../api/token.js";
import { securityCliKeychain } from "../auth/keychain.js";
import type { KeychainReader } from "../auth/keychain.js";
import { ServiceError, installService, removeOldKernelApps, uninstallService, verifyServiceStart } from "../service/launchd.js";
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

export const USAGE =
  "usage: studio status [--json] | studio stop --all | studio resume | studio session abandon <id> [--yes] | studio service install|uninstall";

/** Sent with an abandon so the kernel records `via: "cli"` (the API's `CLIENT_HEADER`). */
const CLIENT_HEADER = "x-studio-client";

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
  /**
   * `service install|uninstall`: the launchd module's options and deps (exec,
   * uid, homeDir, platform, clock). Install's start check also uses this
   * CLI's `keychain`, `fetch` and `isPidAlive`.
   */
  readonly service?: { readonly options?: ServiceOptions; readonly deps?: ServiceDeps };
  /** `session abandon` without `--yes`: whether a person can answer. Defaults to `process.stdin.isTTY === true`. */
  readonly isInteractive?: () => boolean;
  /** `session abandon` without `--yes`: ask, `true` to proceed. Defaults to `readlineConfirm()` (`y`/`yes`; EOF or an input error is a no). */
  readonly confirm?: (question: string) => Promise<boolean>;
}

type Command =
  | { readonly kind: "status"; readonly json: boolean }
  | { readonly kind: "stop-all" }
  | { readonly kind: "resume" }
  | { readonly kind: "abandon"; readonly id: number; readonly yes: boolean }
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
  if (cmd === "session" && rest[0] === "abandon" && (rest.length === 2 || (rest.length === 3 && rest[2] === "--yes"))) {
    const raw = rest[1] as string;
    const id = Number(raw);
    if (/^[1-9]\d*$/.test(raw) && Number.isSafeInteger(id)) return { kind: "abandon", id, yes: rest.length === 3 };
  }
  return undefined;
}

function defaultIsInteractive(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * The default `confirm`: ask on `input`/`output` (`process.stdin`, and
 * `process.stderr` so stdout stays the command's output). Always settles:
 * `true` only for a `y`/`yes` line; an input that ends (Ctrl-D, EOF) or
 * errors before a line is answered, or had already ended, is a `false`.
 */
export function readlineConfirm(
  input: Readable = process.stdin,
  output: Writable = process.stderr,
): (question: string) => Promise<boolean> {
  return (question) => {
    if (input.readableEnded || input.destroyed) return Promise.resolve(false);
    const rl = createInterface({ input, output });
    return new Promise((resolve) => {
      // The first resolve wins: an answered question closes `rl` after resolving.
      rl.once("close", () => resolve(false));
      rl.once("error", () => {
        resolve(false);
        rl.close();
      });
      rl.question(question, (answer) => {
        resolve(isYes(answer));
        rl.close();
      });
    });
  };
}

function isYes(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === "y" || a === "yes";
}

/** The API's stable error code from an error body, or `unknown`; never any other text from it. */
async function apiErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" && /^[a-z_]{1,64}$/.test(body.error) ? body.error : "unknown";
  } catch {
    return "unknown";
  }
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
 * stopped. Reported by status, never counted as `stopped`. Kept for a daemon
 * older than `ended_on_its_own` (see `summarizeStopAll`).
 */
const ALREADY_ENDED: ReadonlySet<string> = new Set(["completed", "interrupted", "failed:auth"]);

/**
 * Summarize `/stop-all`'s per-session outcomes for the kill switch's
 * confirmation line. Only `stopped` counts as stopped. An outcome is "already
 * ended" (listed by status, not counted as stopped) when it carries
 * `ended_on_its_own: true` (the manager's own record that the session had
 * ended before the stop and its group is confirmed gone, e.g. a `failed`
 * result error) OR its status is in `ALREADY_ENDED`. The CLI cannot tell an
 * older daemon (no field) from a newer one, so the rule is that union; it is
 * safe because a newer daemon's really-ended `completed`/`failed:auth`
 * outcomes carry the field anyway, and a `failed:auth` whose group is not
 * confirmed gone is `stop_failed`, never `failed:auth`. Anything else
 * (`failed` without the field, e.g. `kill_incomplete`, `stop_failed`,
 * `orphaned`, or a status this CLI does not know) is "not confirmed stopped"
 * and makes `confirmed` false, so the command exits non-zero.
 */
export function summarizeStopAll(sessions: unknown): { readonly text: string; readonly confirmed: boolean } {
  type Outcome = { id?: unknown; status?: unknown; ended_on_its_own?: unknown };
  const outcomes = (Array.isArray(sessions) ? sessions : []) as readonly Outcome[];
  const label = (o: Outcome): string => `#${String(o.id ?? "?")} ${String(o.status ?? "unknown")}`;
  const isStopped = (o: Outcome): boolean => o.status === "stopped";
  const hadEnded = (o: Outcome): boolean =>
    !isStopped(o) && (o.ended_on_its_own === true || (typeof o.status === "string" && ALREADY_ENDED.has(o.status)));
  const stopped = outcomes.filter(isStopped);
  const ended = outcomes.filter(hadEnded);
  const unconfirmed = outcomes.filter((o) => !isStopped(o) && !hadEnded(o));
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
    const health =
      h.status === "expiring"
        ? `expiring (${h.days} days left)`
        : h.status === "error"
          ? // `?? "unknown"`: a daemon older than this CLI sends `{status: "error"}` with no reason.
            `error (${h.reason ?? "unknown"})`
          : h.status;
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
      // `?? []`: absent when no tool group (H08) is flagged, and from an older daemon.
      for (const g of s.tool_groups ?? []) {
        lines.push(`    tool group pgid ${g.pgid} (${g.command}), not confirmed gone since ${g.kill_incomplete_at}`);
      }
    }
  }
  // `?? []`: a daemon older than this CLI does not send the field.
  const orphaned = status.orphaned ?? [];
  if (orphaned.length > 0) {
    lines.push(`orphaned: ${plural(orphaned.length, "session")} whose group may still be alive (never resumed while it may be)`);
    for (const s of orphaned) lines.push(`  #${s.id} ${s.agent ?? "-"}, pgid ${s.pgid ?? "-"}, reason ${s.reason ?? "unknown"}`);
    lines.push("  studio session abandon <id> releases a leader_unverified row (the kernel never signals its group)");
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
 * `service install` copies the kernel and loads the agent (a version-manager
 * `node` ⇒ one warning line on stderr), then runs the start check
 * (`verifyServiceStart`, 15 s): passing ⇒ older install copies removed and
 * one stdout line naming the kernel version, the install copy and the plist,
 * 0; failing ⇒ the check's failure output on stderr (the agent booted out and
 * its plist removed), 1. `service uninstall` ⇒ one stdout line, 0. Any other
 * failure (not macOS, no built daemon, a protected install target,
 * launchctl failed) ⇒ one stderr line, 1.
 * `session abandon <id>` asks for confirmation after the `api.json` pid check
 * and before the Keychain is read or anything is sent (`y`/`yes` proceeds;
 * anything else, including stdin ending or failing before an answer ⇒ one
 * stderr line, 1, nothing sent); `--yes` skips the
 * question; with no TTY on stdin and no `--yes` it refuses at once (usage, 2)
 * instead of waiting for an answer. A 400/404/409 answer ⇒ one stderr line
 * with the API's stable error code, 1. An abandon that times out or loses its
 * connection after connecting ⇒ one stderr line saying the session may or may
 * not be abandoned and to run `studio status`, 1 (only a refused connection
 * is "not running": nothing was sent).
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
  if (command.kind === "abandon" && !command.yes && !(deps.isInteractive ?? defaultIsInteractive)()) {
    // Nobody can answer the question: refuse rather than wait for stdin.
    stderr.write(`studio: session abandon needs a terminal to confirm, or --yes\n${USAGE}\n`);
    return 2;
  }
  try {
    if (command.kind === "service") {
      // Needs no running daemon: dispatched before api.json or the Keychain is read.
      const service = deps.service ?? {};
      const options = deps.dataDir === undefined ? (service.options ?? {}) : { dataDir: deps.dataDir, ...service.options };
      if (command.action === "install") {
        const serviceDeps = { warn: (line: string) => void stderr.write(`${line}\n`), ...service.deps };
        const r = installService(options, serviceDeps);
        const check = await verifyServiceStart(
          { dataDir: r.dataDir },
          { keychain: deps.keychain ?? securityCliKeychain(), fetch: deps.fetch ?? fetch, isPidAlive: deps.isPidAlive ?? defaultIsPidAlive },
          serviceDeps,
        );
        if (!check.ok) {
          for (const line of check.lines) stderr.write(`${line}\n`);
          return 1;
        }
        // Only now: a failed start keeps the previous version's copy.
        for (const left of removeOldKernelApps(r.dataDir, r.version)) stderr.write(`studio service: warning: could not remove ${left}\n`);
        stdout.write(
          `studio: service ${r.label} installed and loaded: kernel ${check.version} (pid ${check.pid}) running from ${r.appDir} (${r.plistPath})\n`,
        );
      } else {
        const r = uninstallService(options, service.deps);
        stdout.write(`studio: service ${r.label} unloaded and removed (${r.plistPath}, ${r.appRoot})\n`);
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
    if (command.kind === "abandon" && !command.yes) {
      const question =
        `Abandon session ${command.id}? It becomes abandoned for good and the kernel never signals its process group, ` +
        "which may still be running: check its pgid (studio status) first. [y/N] ";
      if (!(await (deps.confirm ?? readlineConfirm())(question))) {
        throw new CliFailure(`studio: session ${command.id} not abandoned (not confirmed)`);
      }
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
    const path =
      command.kind === "status"
        ? "/status"
        : command.kind === "stop-all"
          ? "/stop-all"
          : command.kind === "abandon"
            ? `/sessions/${command.id}/abandon`
            : "/resume";
    const timeoutMs = command.kind === "stop-all" ? (deps.stopAllTimeoutMs ?? STOP_ALL_TIMEOUT_MS) : (deps.timeoutMs ?? CLI_TIMEOUT_MS);
    let res: Response;
    try {
      res = await (deps.fetch ?? fetch)(`http://${HOST}:${port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(command.kind === "abandon" ? { [CLIENT_HEADER]: "cli" } : {}) },
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
      const code = errorCode(err);
      if (command.kind === "abandon" && (isTimeout(err) || code !== "ECONNREFUSED")) {
        // Sent, but no answer: the daemon skips an abandon whose client has
        // gone before its turn, yet one already applied (or applied just as the
        // wait ran out) stays applied. Only a refused connection sent nothing.
        const what = isTimeout(err)
          ? `kernel daemon did not answer ${method} ${path} within ${timeoutMs / 1_000} s (${HOST}:${port})`
          : `connection to the kernel daemon failed during ${method} ${path} (${HOST}:${port}${code === undefined ? "" : `: ${code}`})`;
        throw new CliFailure(`studio: ${what}; session ${command.id} may or may not be abandoned, run studio status`);
      }
      if (isTimeout(err)) throw new CliFailure(`studio: kernel daemon did not answer within ${timeoutMs / 1_000} s (${HOST}:${port})`);
      throw new CliFailure(`studio: kernel daemon is not running (cannot connect to ${HOST}:${port}${code === undefined ? "" : `: ${code}`})`);
    }
    if (command.kind === "abandon" && (res.status === 400 || res.status === 404 || res.status === 409)) {
      throw new CliFailure(`studio: session ${command.id} not abandoned: ${await apiErrorCode(res)}`);
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
    } else if (command.kind === "abandon") {
      stdout.write(`studio: session ${command.id} abandoned; the kernel will never signal its process group\n`);
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
