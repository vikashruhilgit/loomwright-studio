// The native notifier (macOS): which one to use, the exact argv it gets, and
// one post. Chosen from the p11 probe run under a launchd agent
// (`docs/evidence/phase-2-notifier-probe.md`):
//
// - `terminal-notifier` (Homebrew, third-party), from a fixed absolute path
//   only, never `PATH` and never installed by Studio: the one candidate with a
//   click action (`-execute`). Its click opens Terminal on
//   `studio notifications show <id>`.
// - else `/usr/bin/osascript` `display notification` (ships with macOS): no
//   click action, so the row is `unsupported` and says why.
//
// Notification text is untrusted data (invariant 3) and never reaches a
// shell or a parser: every process is spawned with an argv array (never a
// shell string, never `shell: true`). osascript gets the text as `on run argv`
// items after a `--`, never in the script source: without the end-of-options
// marker a title of `-e` is read as an option and the body becomes AppleScript
// source (a `property p : (do shell script …)` runs at compile time).
// terminal-notifier gets the body on stdin
// and the title as a quoted plist string, because Cocoa parses a `-key value`
// argument as a property list (p11: an unquoted `(a, b)` title hung it). The
// click's shell command holds only the kernel's own paths and the integer id.
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { clip, errorMessage } from "../loop/internal.js";

/** Where terminal-notifier may be: Homebrew on Apple silicon, then on Intel. Nothing else is looked at. */
export const TERMINAL_NOTIFIER_PATHS: readonly string[] = ["/opt/homebrew/bin/terminal-notifier", "/usr/local/bin/terminal-notifier"];
export const OSASCRIPT_PATH = "/usr/bin/osascript";
/** One post's bound; a notifier still running is killed and the delivery is `failed`. */
export const NOTIFIER_TIMEOUT_MS = 10_000;
/** The `-group` of notification `id` (terminal-notifier; `-list <group>` reads it back). */
export const notifierGroup = (id: number): string => `loomwright-studio-notification-${id}`;

const MAX_OUTPUT = 4_096;

/** How a notifier process ended. `timedOut`: killed after the timeout. */
export interface NotifierRun {
  readonly status: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawn `file` with `args` (never a shell) and `input` on stdin; rejects only when it cannot be spawned. */
export type NotifierExec = (file: string, args: readonly string[], input: string, timeoutMs: number) => Promise<NotifierRun>;

/** One notifier call: the binary, its argv and its stdin. */
export interface NotifierInvocation {
  readonly file: string;
  readonly args: readonly string[];
  readonly input: string;
}

export interface NotifierDeps {
  /** Defaults to `process.platform`. */
  readonly platform?: string;
  /** Defaults to `accessSync(path, X_OK)`. */
  readonly isExecutable?: (path: string) => boolean;
  /** Defaults to `spawnNotifier`. */
  readonly exec?: NotifierExec;
  /** Default `NOTIFIER_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** The `node` the click runs the CLI with. Defaults to `process.execPath`. */
  readonly nodePath?: string;
  /** The CLI entry the click runs. Defaults to this build's `cli/index.js`. */
  readonly cliPath?: string;
}

/** What one delivery attempt came to. `posted`: a native notification was handed to macOS. */
export interface DeliveryOutcome {
  readonly status: "delivered" | "failed" | "unsupported";
  readonly detail: string;
  readonly posted: boolean;
}

/** An old-style plist string: Cocoa reads it back as exactly `text` (p11). */
export function plistQuote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** One POSIX shell word holding exactly `text`. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function checkId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError(`a notification id must be a positive integer, got ${String(id)}`);
}

/**
 * The command a click runs in Terminal: `studio notifications show <id>` with
 * this kernel's `node` and CLI, against its data dir. Only kernel-owned paths
 * (each one shell word) and the validated integer id.
 */
export function showCommand(id: number, dataDir: string, deps: NotifierDeps = {}): string {
  checkId(id);
  const nodePath = deps.nodePath ?? process.execPath;
  const cliPath = deps.cliPath ?? fileURLToPath(new URL("../cli/index.js", import.meta.url));
  return `STUDIO_DATA_DIR=${shellQuote(dataDir)} ${shellQuote(nodePath)} ${shellQuote(cliPath)} notifications show ${id}`;
}

/**
 * terminal-notifier's `-execute` value: a shell command (terminal-notifier
 * runs it with a shell on click) that has Terminal run `command`, passed to
 * osascript as an `on run argv` item after `--`, never in the script source.
 */
export function clickShellCommand(command: string): string {
  return [OSASCRIPT_PATH, "-e", "on run argv", "-e", 'tell application "Terminal"', "-e", "activate", "-e", "do script (item 1 of argv)", "-e", "end tell", "-e", "end run", "--", command]
    .map(shellQuote)
    .join(" ");
}

/** terminal-notifier at `path`: the title as a plist string, the body on stdin, the group and the click. */
export function terminalNotifierInvocation(path: string, n: { readonly id: number; readonly title: string; readonly body: string }, click: string): NotifierInvocation {
  checkId(n.id);
  return { file: path, args: ["-title", plistQuote(n.title), "-group", plistQuote(notifierGroup(n.id)), "-execute", plistQuote(click)], input: n.body };
}

/** osascript `display notification`: the text as `argv` items 1 (title) and 2 (body), after `--` so a leading `-` is data. No click action. */
export function osascriptInvocation(n: { readonly title: string; readonly body: string }): NotifierInvocation {
  return {
    file: OSASCRIPT_PATH,
    args: ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", "--", n.title, n.body],
    input: "",
  };
}

/** Which notifier a post uses now: one with a click, one without (and why), or none (and why). */
export type NotifierChoice =
  | { readonly kind: "click"; readonly path: string }
  | { readonly kind: "plain"; readonly path: string; readonly reason: string }
  | { readonly kind: "none"; readonly reason: string };

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Not macOS ⇒ none; terminal-notifier at a fixed path ⇒ click; else osascript ⇒ plain; else none. Checked per post. */
export function chooseNotifier(deps: NotifierDeps = {}): NotifierChoice {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") return { kind: "none", reason: `not macOS (${platform})` };
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const clickPath = TERMINAL_NOTIFIER_PATHS.find((p) => isExecutable(p));
  if (clickPath !== undefined) return { kind: "click", path: clickPath };
  const missing = `no click-capable notifier (no terminal-notifier at ${TERMINAL_NOTIFIER_PATHS.join(" or ")})`;
  if (isExecutable(OSASCRIPT_PATH)) return { kind: "plain", path: OSASCRIPT_PATH, reason: missing };
  return { kind: "none", reason: `${missing}, and no ${OSASCRIPT_PATH}` };
}

/** The env a notifier runs with: a fixed PATH and the user's identity, nothing of the daemon's own (no credential). */
function notifierEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  for (const key of ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * After the notifier exits, how long its output may still drain. 'close' waits
 * for every holder of the stdio pipes, and a descendant the notifier left
 * behind can hold them for as long as it lives.
 */
const DRAIN_MS = 250;
/** After the timeout's SIGKILL, how long to wait for 'exit' before settling anyway. */
const KILL_GRACE_MS = 1_000;

/**
 * The default `NotifierExec`: `spawn` with an argv array (no shell), bounded
 * output, SIGKILL after `timeoutMs`. A hard bound of `timeoutMs` plus
 * `KILL_GRACE_MS`: it settles exactly once, on 'close', or `DRAIN_MS` after
 * 'exit', or `KILL_GRACE_MS` after the kill, whichever is first. Settling
 * destroys the pipes and unrefs the child, so a descendant still holding the
 * pipes neither stretches the wait nor keeps the event loop alive. Once the
 * timeout has fired, an 'exit' inside the grace may settle sooner but never
 * later than the grace.
 *
 * A failed spawn (ENOENT, EACCES, EMFILE …) rejects once, through the child's
 * 'error' event, which is listened for before anything else is touched: on
 * EMFILE Node returns a child with no stdio and emits 'error' on the next
 * tick, so dereferencing a pipe first would throw and leave that 'error'
 * unhandled (an uncaught exception in the daemon).
 */
export const spawnNotifier: NotifierExec = (file, args, input, timeoutMs) =>
  spawnNotifierWith(spawn, file, args, input, timeoutMs);

/** `spawnNotifier` over an injectable `spawn` (a test seam). */
export function spawnNotifierWith(
  spawnImpl: typeof spawn,
  file: string,
  args: readonly string[],
  input: string,
  timeoutMs: number,
): Promise<NotifierRun> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, [...args], { stdio: ["pipe", "pipe", "pipe"], env: notifierEnv() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let drainTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const release = (): void => {
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      clearTimeout(graceTimer);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    };
    // First, before any pipe is touched: a failed spawn reports only here.
    child.on("error", (err) => {
      if (settled) return;
      release();
      reject(err);
    });
    const { stdin, stdout: out, stderr: errOut } = child;
    // No stdio (undefined on EMFILE, despite the typing) means the spawn
    // failed; its queued 'error' rejects.
    if (!stdin || !out || !errOut) return;
    const settle = (status: number | null, signal: string | null): void => {
      if (settled) return;
      release();
      resolve({ status, signal, timedOut, stdout, stderr });
    };
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      graceTimer = setTimeout(() => settle(child.exitCode, child.signalCode ?? "SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);
    out.setEncoding("utf8").on("data", (c: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += c;
    });
    errOut.setEncoding("utf8").on("data", (c: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += c;
    });
    child.once("exit", (status, signal) => {
      if (settled) return;
      clearTimeout(timer);
      // graceTimer (armed only after a timeout) stays: it is the hard cap.
      drainTimer = setTimeout(() => settle(status, signal), DRAIN_MS);
    });
    child.once("close", (status, signal) => settle(status, signal));
    // A notifier that exits without reading stdin is not an error of the post.
    stdin.on("error", () => {});
    stdin.end(input);
  });
}

/** Why `run` is a failed post, or `undefined` when it exited 0. */
function failureOf(file: string, run: NotifierRun, timeoutMs: number): string | undefined {
  if (run.timedOut) return `${file} did not finish within ${timeoutMs / 1_000} s (killed)`;
  if (run.status === 0) return undefined;
  const output = (run.stderr.trim() || run.stdout.trim()).split("\n", 1)[0] ?? "";
  const ended = run.status === null ? `was killed by ${run.signal ?? "a signal"}` : `exited ${run.status}`;
  return `${file} ${ended}${output === "" ? "" : `: ${output}`}`;
}

/**
 * Post notification `n` once, natively. Never throws for a failed post: not
 * macOS or no notifier ⇒ `unsupported`, not posted; no click-capable notifier
 * ⇒ posted with osascript, `unsupported` with the reason; terminal-notifier ⇒
 * `delivered`, its click running `showCommand(n.id, dataDir)` in Terminal; a
 * notifier that cannot be spawned, exits non-zero or times out ⇒ `failed`
 * with the clipped error. Exactly one notifier process per call.
 */
export async function postNotification(
  n: { readonly id: number; readonly title: string; readonly body: string },
  dataDir: string,
  deps: NotifierDeps = {},
): Promise<DeliveryOutcome> {
  checkId(n.id);
  const choice = chooseNotifier(deps);
  if (choice.kind === "none") return { status: "unsupported", detail: `${choice.reason}: not posted`, posted: false };
  const invocation =
    choice.kind === "click" ? terminalNotifierInvocation(choice.path, n, clickShellCommand(showCommand(n.id, dataDir, deps))) : osascriptInvocation(n);
  const timeoutMs = deps.timeoutMs ?? NOTIFIER_TIMEOUT_MS;
  let run: NotifierRun;
  try {
    run = await (deps.exec ?? spawnNotifier)(invocation.file, invocation.args, invocation.input, timeoutMs);
  } catch (err) {
    return { status: "failed", detail: clip(`${invocation.file} could not be run: ${errorMessage(err)}`), posted: false };
  }
  const failure = failureOf(invocation.file, run, timeoutMs);
  if (failure !== undefined) return { status: "failed", detail: clip(failure), posted: false };
  if (choice.kind === "plain") return { status: "unsupported", detail: `${choice.reason}: posted without a click action by ${choice.path}`, posted: true };
  return { status: "delivered", detail: `posted by ${choice.path}; a click runs studio notifications show ${n.id} in Terminal`, posted: true };
}
