// The test run's notifier guard: while `STUDIO_LIVE` is not "1", no test can
// spawn `terminal-notifier` or `osascript`. `installNotifierGuard()` wraps
// `spawn`, `spawnSync`, `execFile`, `execFileSync` (the file argument, or the
// command's first word when the options say `shell: true`) and `exec`,
// `execSync` (the command string's first word) on `node:child_process` and
// syncs the patch into the ESM namespace, so `notifier.ts`'s own named `spawn`
// import is wrapped too. A refused call throws synchronously (no
// process exists) and is recorded; `assertNoNotifierRefusals()` turns the
// record into a failing test. Only the executable is looked at, never the
// arguments: a `/bin/sh -c` whose script mentions osascript still runs.
//
// No vitest hooks here: `setup-no-real-notifier.ts` (wired by
// `kernel/vitest.config.ts`) installs it and registers the hooks. All state
// sits on one `globalThis` record, so a second evaluation of this module in a
// worker shares the refusal list with the wrapper already installed.
// See `docs/architecture/notifications.md#testing`.
import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { promisify } from "node:util";
import { OSASCRIPT_PATH, TERMINAL_NOTIFIER_PATHS } from "../src/notifications/notifier.js";

/** The shared record: the refusals not yet taken, and whether the wrapper is in place. */
interface GuardRecord {
  installed: boolean;
  readonly refusals: { file: string }[];
}

const RECORD_KEY = Symbol.for("studio.notifierGuard");
/** Marks a function this guard already wrapped, so nothing is wrapped twice. */
const WRAPPED = Symbol.for("studio.notifierGuard.wrapped");

const REFUSED_NAMES: ReadonlySet<string> = new Set(["terminal-notifier", "osascript"]);
const REFUSED_PATHS: ReadonlySet<string> = new Set([...TERMINAL_NOTIFIER_PATHS, OSASCRIPT_PATH]);

function record(): GuardRecord {
  const g = globalThis as { [RECORD_KEY]?: GuardRecord };
  let r = g[RECORD_KEY];
  if (r === undefined) {
    r = { installed: false, refusals: [] };
    g[RECORD_KEY] = r;
  }
  return r;
}

/** On unless `STUDIO_LIVE` is "1" (the live harnesses' own test). */
export function notifierGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STUDIO_LIVE !== "1";
}

/** Whether this process's `node:child_process` is wrapped. */
export function notifierGuardInstalled(): boolean {
  return record().installed;
}

/** The refusals recorded since the last take, cleared. */
export function takeNotifierRefusals(): readonly { file: string }[] {
  return record().refusals.splice(0);
}

/** Throws, naming each refused binary, when a real notifier was refused since the last take (and clears the list). */
export function assertNoNotifierRefusals(): void {
  const refused = takeNotifierRefusals();
  if (refused.length > 0) throw new Error(`a real notifier was refused in this test: ${refused.map((r) => r.file).join(", ")}`);
}

function refused(file: string): boolean {
  return REFUSED_NAMES.has(basename(file)) || REFUSED_PATHS.has(file);
}

/** Records and throws when `file` is a notifier; otherwise returns. */
function check(file: unknown): void {
  if (typeof file !== "string" || !refused(file)) return;
  record().refusals.push({ file });
  throw new Error(
    `real notifier refused in a test run: ${file} (set STUDIO_LIVE=1 for a live harness, or inject a stub notifier: docs/architecture/notifications.md#testing)`,
  );
}

/** The executable of a shell command string: its first word, without surrounding quotes. */
function firstWord(command: unknown): unknown {
  if (typeof command !== "string") return command;
  const word = command.trim().split(/\s+/, 1)[0] ?? "";
  return word.replace(/^(['"])(.*)\1$/, "$2");
}

type AnyFn = (...args: unknown[]) => unknown;
/** Picks the executable a call would run from its arguments. */
type Executable = (args: readonly unknown[]) => unknown;

function isOptions(value: unknown): value is { shell?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The executable of a by-file call (`spawn(file, args?, options?)` and kin):
 * the file, or the command's first word when `options.shell` is truthy (node
 * then joins the file and any array args into one shell command string).
 */
function byFile(args: readonly unknown[]): unknown {
  const options = isOptions(args[1]) ? args[1] : isOptions(args[2]) ? args[2] : undefined;
  return options?.shell ? firstWord(args[0]) : args[0];
}

/** The executable of a by-command call (`exec(command, …)`): the command's first word. */
function byCommand(args: readonly unknown[]): unknown {
  return firstWord(args[0]);
}

function guarded(original: AnyFn, executable: Executable): AnyFn {
  const wrapper = function (this: unknown, ...args: unknown[]): unknown {
    check(executable(args));
    return original.apply(this, args);
  };
  Object.defineProperty(wrapper, "name", { value: original.name });
  Object.defineProperty(wrapper, WRAPPED, { value: true });
  // `exec` / `execFile` carry a custom promisified form; guard it too, or `promisify(execFile)` would bypass the guard.
  const custom = (original as { [promisify.custom]?: AnyFn })[promisify.custom];
  if (typeof custom === "function") Object.defineProperty(wrapper, promisify.custom, { value: guarded(custom, executable), configurable: true });
  return wrapper;
}

const BY_FILE = ["spawn", "spawnSync", "execFile", "execFileSync"] as const;
const BY_COMMAND = ["exec", "execSync"] as const;

/**
 * Wrap `node:child_process` once per process (a no-op when the record says
 * it is installed, or when the guard is disabled), then sync the patch into
 * the builtin's ESM namespace so named imports see it.
 */
export function installNotifierGuard(): void {
  const r = record();
  if (r.installed || !notifierGuardEnabled()) return;
  const cp = createRequire(import.meta.url)("node:child_process") as Record<string, AnyFn>;
  for (const name of BY_FILE) {
    const original = cp[name];
    if (typeof original === "function" && !(WRAPPED in original)) cp[name] = guarded(original, byFile);
  }
  for (const name of BY_COMMAND) {
    const original = cp[name];
    if (typeof original === "function" && !(WRAPPED in original)) cp[name] = guarded(original, byCommand);
  }
  syncBuiltinESMExports();
  r.installed = true;
}
