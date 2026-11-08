// Loomwright's `/automate` run state, read from a checkout (phase 8 item 09). Read
// only: nothing here writes a run file, starts a run or touches the lock.
//
// Where it lives (probes p14 and p15 read it there; Loomwright 17.34.2,
// `skills/automate-loop/run-file.md`):
//   - run files: `<checkout>/.supervisor/automate/<run_id>.md`. A RUN file is a
//     file whose first line is `# Automate Run: <title>`; the same folder also
//     holds sidecars (`<run_id>.supervisor-result.md`, `<run_id>.review-heal-result.md`)
//     that carry no such title and are never runs. So a run file is found by its
//     title, never by its name or as "the last `.md`" (p15's sidecar trap).
//   - `## Status: running | paused | done`, and under `## Current` the item line
//     `- item: <path> | status: <s> | pr: <url> | branch: <b>`, `- pause_reason: <r>`
//     and, after a READY drain, `- ready_sha: <sha> | ready_at: <ISO> | termination_reason: <t>`.
//   - the run lock: `<checkout>/.supervisor/run.lock/meta` (tab-separated `key<TAB>value`,
//     with a `pid` key), `scripts/run-lock.sh`.
//
// Fail closed: a folder, file or lock this module cannot read answers
// `{ok: false, reason}`, never "no runs", so a caller never reads an unreadable
// state as an idle one. Every value read from a file is data (a path, a URL, a
// branch name can come from a ticket): it is cut to one short line with no
// control characters before it is returned, and never run or interpolated.
//
// The `studio` CLI loads this module through the feature registry, so it imports
// only `node:` builtins: never the Agent SDK, the session manager or `kernel.ts`.
import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { oneLine } from "./text-rules.js";

/** The title line that makes a file in `.supervisor/automate/` a run file. */
export const RUN_FILE_TITLE = "# Automate Run:";

/** A run file larger than this is not read (a run file is a few KiB of lines): the state is unreadable. */
export const MAX_RUN_FILE_BYTES = 1024 * 1024;

/** The longest value kept from a run file's line. */
const MAX_VALUE = 300;

/** A run id the kernel will put in an invocation: Loomwright's ids are a date, a time and a slug. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Whether `id` is usable as a run id in an invocation. */
export function isRunId(id: unknown): id is string {
  return typeof id === "string" && RUN_ID.test(id);
}

/** `## Status:` of a run file. `unknown` for any other word. */
export type RunStatus = "running" | "paused" | "done" | "unknown";

/** The item a run file's `## Current` names. Every field but `item` and `status` may be absent. */
export interface CurrentItem {
  readonly item: string;
  /** The item's own status: `running`, `awaiting_merge`, `escalated`, `done`, … (Loomwright's list). */
  readonly status: string;
  readonly pr: string | null;
  readonly branch: string | null;
  readonly pause_reason: string | null;
  readonly ready_sha: string | null;
  readonly ready_at: string | null;
  readonly termination_reason: string | null;
}

/** One run file, as read. */
export interface RunFile {
  readonly run_id: string;
  readonly title: string;
  readonly status: RunStatus;
  readonly current: CurrentItem | null;
}

/** The run lock, as read. `held` is true when its recorded holder is alive. */
export interface RunLock {
  readonly held: boolean;
  readonly pid: number | null;
}

/** What `readRunState` answers. */
export type RunStateRead =
  | { readonly ok: true; readonly runs: readonly RunFile[]; readonly lock: RunLock }
  | { readonly ok: false; readonly reason: string };

/** A parked item: a paused run's current item that is not done (it waits on a person, a merge or a fix). */
export interface ParkedItem {
  readonly run_id: string;
  readonly item: string;
  readonly status: string;
  readonly pr: string | null;
  readonly pr_number: number | null;
  readonly branch: string | null;
  readonly reason: string | null;
  readonly ready_sha: string | null;
  readonly ready_at: string | null;
}

/** `kernel_automate_state`'s answer, before the tool adds its repo. */
export interface RunSummary {
  readonly state: "live" | "parked" | "idle";
  /** The live run's id (a `running` run file); `null` when none is live, or when only the lock says so. */
  readonly run_id: string | null;
  readonly parked: readonly ParkedItem[];
}

/** One line, no control characters, at most `MAX_VALUE` characters. */
function clean(text: string): string {
  const line = oneLine(text);
  return line.length > MAX_VALUE ? `${line.slice(0, MAX_VALUE - 1)}…` : line;
}

/** `null` for an absent or `null` value. */
function valueOf(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const v = clean(raw);
  return v === "" || v === "null" ? null : v;
}

/** The `key: value` pairs of a `- a: x | b: y` line (the leading `- ` already removed). */
function pairsOf(line: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of line.split(" | ")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    if (!pairs.has(key)) pairs.set(key, part.slice(at + 1).trim());
  }
  return pairs;
}

/** The run file's `## Current` block as an item, or `null` when it names none. */
function currentOf(lines: readonly string[]): CurrentItem | null {
  const start = lines.findIndex((l) => l.trim() === "## Current");
  if (start < 0) return null;
  let item: Map<string, string> | undefined;
  let pause: string | null = null;
  let ready: Map<string, string> | undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2);
    if (body.startsWith("item:") && item === undefined) item = pairsOf(body);
    else if (body.startsWith("pause_reason:") && pause === null) pause = valueOf(body.slice("pause_reason:".length));
    else if (body.startsWith("ready_sha:") && ready === undefined) ready = pairsOf(body);
  }
  const path = valueOf(item?.get("item"));
  const status = valueOf(item?.get("status"));
  if (item === undefined || path === null || status === null) return null;
  return {
    item: path,
    status,
    pr: valueOf(item.get("pr")),
    branch: valueOf(item.get("branch")),
    pause_reason: pause,
    ready_sha: valueOf(ready?.get("ready_sha")),
    ready_at: valueOf(ready?.get("ready_at")),
    termination_reason: valueOf(ready?.get("termination_reason")),
  };
}

function statusOf(lines: readonly string[]): RunStatus {
  const line = lines.find((l) => l.startsWith("## Status:"));
  const word = line === undefined ? "" : (/^## Status:\s*([a-z_]+)/.exec(line)?.[1] ?? "");
  return word === "running" || word === "paused" || word === "done" ? word : "unknown";
}

/** The first bytes of a file as text, so a title check never loads a large sidecar. */
function head(path: string, bytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Parses a run file's text. `undefined` when it is not a run file (no title line first). */
export function parseRunFile(runId: string, text: string): RunFile | undefined {
  const lines = text.split(/\r?\n/);
  const first = lines[0] ?? "";
  if (!first.startsWith(RUN_FILE_TITLE)) return undefined;
  return { run_id: runId, title: clean(first.slice(RUN_FILE_TITLE.length)), status: statusOf(lines), current: currentOf(lines) };
}

/** Whether `pid` names a live process (`kill -0`: a process we may not signal is alive too). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown }).code === "EPERM";
  }
}

/**
 * The run lock of `checkout`. Absent (no `meta`) is not held; a `meta` whose `pid`
 * is not a plain positive integer has no holder to wait for, as `run-lock.sh` reads it.
 * A `meta` that cannot be read otherwise is thrown for the caller to fail closed on.
 */
function readLock(checkout: string): RunLock {
  let text: string;
  try {
    text = readFileSync(join(checkout, ".supervisor", "run.lock", "meta"), "utf8");
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { held: false, pid: null };
    throw err;
  }
  const line = text.split("\n").find((l) => l.startsWith("pid\t"));
  const raw = line === undefined ? "" : line.slice("pid\t".length).trim();
  if (!/^[1-9]\d{0,9}$/.test(raw)) return { held: false, pid: null };
  const pid = Number(raw);
  return { held: alive(pid), pid };
}

/**
 * Loomwright's run state in `checkout`: every run file found by its title, and the
 * run lock. A folder that does not exist is no runs; anything else that cannot be
 * read (the folder, a candidate file, an oversize run file, a run file whose name
 * is not a usable run id, the lock) is `{ok: false}` with the reason. Never throws.
 */
export function readRunState(checkout: string): RunStateRead {
  try {
    const dir = join(checkout, ".supervisor", "automate");
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return { ok: false, reason: "run_folder_unreadable" };
      names = [];
    }
    const runs: RunFile[] = [];
    for (const name of names) {
      const path = join(dir, name);
      // A symlink or anything but a regular file is not a run file Loomwright wrote.
      if (!lstatSync(path).isFile()) continue;
      if (!head(path, RUN_FILE_TITLE.length + 1).startsWith(RUN_FILE_TITLE)) continue;
      const runId = name.slice(0, -".md".length);
      if (!isRunId(runId)) return { ok: false, reason: "run_file_name_unusable" };
      if (lstatSync(path).size > MAX_RUN_FILE_BYTES) return { ok: false, reason: "run_file_too_large" };
      const run = parseRunFile(runId, readFileSync(path, "utf8"));
      if (run !== undefined) runs.push(run);
    }
    return { ok: true, runs, lock: readLock(checkout) };
  } catch {
    return { ok: false, reason: "run_state_unreadable" };
  }
}

/** `<owner>/<repo>` and the number of a GitHub pull request URL, or `undefined`. */
export function parsePullUrl(url: string | null): { readonly repo: string; readonly number: number } | undefined {
  if (url === null) return undefined;
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d{0,9})$/.exec(url);
  return m === null ? undefined : { repo: `${m[1] as string}/${m[2] as string}`, number: Number(m[3]) };
}

/**
 * `live` when a run file reads `running` or the run lock's holder is alive (a second
 * run is refused either way: single drain); else `parked` when a paused run's
 * current item is not done; else `idle`. Parked items are listed in every case.
 */
export function summarizeRuns(read: Extract<RunStateRead, { ok: true }>): RunSummary {
  const running = read.runs.find((r) => r.status === "running");
  const parked: ParkedItem[] = [];
  for (const run of read.runs) {
    const cur = run.current;
    if (run.status !== "paused" || cur === null || cur.status === "done" || cur.status === "running") continue;
    parked.push({
      run_id: run.run_id,
      item: cur.item,
      status: cur.status,
      pr: cur.pr,
      pr_number: parsePullUrl(cur.pr)?.number ?? null,
      branch: cur.branch,
      reason: cur.pause_reason,
      ready_sha: cur.ready_sha,
      ready_at: cur.ready_at,
    });
  }
  if (running !== undefined || read.lock.held) return { state: "live", run_id: running?.run_id ?? null, parked };
  return { state: parked.length > 0 ? "parked" : "idle", run_id: null, parked };
}
