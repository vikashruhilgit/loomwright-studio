// The notifications feature (phase 2): the record, per-tick native delivery
// (at most once, no retry), `kernel_notify`, the API routes and `studio
// notifications`. The notifier is always a stub (`NotifierDeps.exec`)
// asserting the exact argv and stdin; the only real processes spawned are
// `/bin/sh`, `/bin/echo`, `/bin/cat`, `/bin/sleep` and `/usr/bin/env`, to pin
// the quoting and the no-shell spawn. Never a real notification.
import { spawnSync } from "node:child_process";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE, startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { runCli } from "../src/cli/index.js";
import { mergeContributions } from "../src/features/index.js";
import { EventLoop } from "../src/loop/loop.js";
import {
  InvalidNotificationError,
  OSASCRIPT_PATH,
  TERMINAL_NOTIFIER_PATHS,
  clickShellCommand,
  createDeliveryDueWork,
  deliverPendingNotifications,
  getNotification,
  notificationsContribution,
  notifyTool,
  osascriptInvocation,
  pendingNotificationIds,
  postNotification,
  plistQuote,
  printable,
  recordNotification,
  shellQuote,
  showCommand,
  spawnNotifier,
} from "../src/notifications/index.js";
import type { NotifierDeps, NotifierExec, NotifierRun } from "../src/notifications/index.js";
import { spawnNotifierWith } from "../src/notifications/notifier.js";
import type { Store } from "../src/store/index.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolContext } from "../src/tools/server.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TITLE = 'Build "done" $(rm -rf ~) `id`; |& -execute';
const BODY = "line 1; echo $HOME\n'single' \"double\" \\ back\n$(touch /tmp/studio-never) && rm -rf / (a, b)";
const NODE = "/usr/local/bin/node";
const CLI = "/opt/studio/dist/cli/index.js";
const TN = TERMINAL_NOTIFIER_PATHS[0] as string;

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  env.cleanup();
});

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly input: string;
  readonly timeoutMs: number;
}

/** A notifier stub: records every call and answers `result` (an `Error` rejects, as a failed spawn). */
function stubExec(result: Partial<NotifierRun> | Error = {}): { calls: Call[]; exec: NotifierExec } {
  const calls: Call[] = [];
  const exec: NotifierExec = async (file, args, input, timeoutMs) => {
    calls.push({ file, args: [...args], input, timeoutMs });
    if (result instanceof Error) throw result;
    return { status: 0, signal: null, timedOut: false, stdout: "", stderr: "", ...result };
  };
  return { calls, exec };
}

/** macOS with the given notifiers present (default: terminal-notifier and osascript). */
function darwin(exec: NotifierExec, present: readonly string[] = [TN, OSASCRIPT_PATH]): NotifierDeps {
  return { platform: "darwin", isExecutable: (p) => present.includes(p), exec, nodePath: NODE, cliPath: CLI };
}

const tick = (deps: NotifierDeps, store: Store = env.store): Promise<void> => deliverPendingNotifications({ store, now: env.now }, deps);

const record = (input: { source?: string; title?: string; body?: string; sessionId?: number } = {}) =>
  recordNotification(env.store, { source: "kernel:test", title: TITLE, body: BODY, ...input }, env.now());

describe("recordNotification", () => {
  it("writes one pending row whose deep link names its own id, with one notification_created event, in one transaction", () => {
    // Another row first: the link must come from the inserted row's id, never a counter.
    env.store.prepare("INSERT INTO notifications (id, source, title, body, deep_link) VALUES (41, 'kernel:x', 't', 'b', 'x')").run();
    const row = record({ source: "trigger:3" });
    expect(row).toEqual({
      id: 42,
      source: "trigger:3",
      title: TITLE,
      body: BODY,
      deep_link: "loomwright-studio://notifications/42",
      created_at: "2026-10-02T10:00:00.000Z",
      delivery_status: "pending",
      delivery_detail: null,
      delivered_at: null,
    });
    expect(getNotification(env.store, 42)).toEqual(row);
    expect(events(env.store, "notification_created")).toEqual([
      { id: expect.any(Number), kind: "notification_created", actor: "kernel", session_id: null, task_id: null, payload: { id: 42, source: "trigger:3" } },
    ]);

    // The event's write fails: the row is rolled back with it.
    const prepare = env.store.prepare.bind(env.store);
    vi.spyOn(env.store, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("INSERT INTO events")) throw new Error("disk I/O error");
      return prepare(sql);
    }) as typeof env.store.prepare);
    expect(() => record()).toThrow("disk I/O error");
    vi.restoreAllMocks();
    expect(count(env.store, "SELECT count(*) FROM notifications")).toBe(2);
  });

  it("accepts trigger:<id>, agent:<name> and kernel:<reason> sources; refuses anything else before touching the store", () => {
    for (const source of ["trigger:1", "trigger:123", "agent:wright", "agent:code reviewer", "kernel:work_step_interrupted"]) {
      expect(record({ source }).source).toBe(source);
    }
    const transaction = vi.spyOn(env.store, "transaction");
    const prepare = vi.spyOn(env.store, "prepare");
    const bad = ["", "trigger:", "trigger:0", "trigger:01", "trigger:abc", "trigger:1 ", "agent:", "kernel:", "user:x", "wright", "agent:a\nb", "kernel:\u001b[31m", `agent:${"a".repeat(200)}`];
    for (const source of bad) expect(() => record({ source }), source).toThrow(InvalidNotificationError);
    expect(() => record({ title: "" })).toThrow(InvalidNotificationError);
    expect(() => record({ title: "t".repeat(201) })).toThrow(InvalidNotificationError);
    expect(() => record({ body: "b".repeat(4_001) })).toThrow(InvalidNotificationError);
    expect(transaction).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(count(env.store, "SELECT count(*) FROM notifications")).toBe(5);
    expect(events(env.store, "notification_created")).toHaveLength(5);
    // An empty body and the maximum lengths are fine.
    expect(record({ title: "t".repeat(200), body: "" }).body).toBe("");
  });

  it("refuses a NUL anywhere in the title or the body (no notifier can carry one), before touching the store", () => {
    const transaction = vi.spyOn(env.store, "transaction");
    const prepare = vi.spyOn(env.store, "prepare");
    for (const input of [{ title: "a\u0000b" }, { title: "\u0000" }, { body: "a\u0000" }, { body: "\u0000" }]) {
      expect(() => record(input), JSON.stringify(input)).toThrow(new InvalidNotificationError("the title and body must not contain a NUL character"));
    }
    expect(transaction).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(count(env.store, "SELECT count(*) FROM notifications")).toBe(0);
    expect(events(env.store, "notification_created")).toEqual([]);
  });
});

describe("delivery (the due work)", () => {
  it("posts once with terminal-notifier: argv only, the title a plist string, the body on stdin, the click opening Terminal on studio notifications show <id>", async () => {
    const { calls, exec } = stubExec();
    record();
    await tick(darwin(exec));
    const show = `STUDIO_DATA_DIR='${env.dataDir}' '/usr/local/bin/node' '/opt/studio/dist/cli/index.js' notifications show 1`;
    const execute =
      `'/usr/bin/osascript' '-e' 'on run argv' '-e' 'tell application "Terminal"' '-e' 'activate' '-e' 'do script (item 1 of argv)' ` +
      `'-e' 'end tell' '-e' 'end run' '--' '${show.replace(/'/g, "'\\''")}'`;
    expect(calls).toEqual([
      {
        file: "/opt/homebrew/bin/terminal-notifier",
        args: [
          "-title",
          '"Build \\"done\\" $(rm -rf ~) `id`; |& -execute"',
          "-group",
          '"loomwright-studio-notification-1"',
          "-execute",
          `"${execute.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
        ],
        input: BODY,
        timeoutMs: 10_000,
      },
    ]);
    expect(getNotification(env.store, 1)).toMatchObject({
      delivery_status: "delivered",
      delivery_detail: "posted by /opt/homebrew/bin/terminal-notifier; a click runs studio notifications show 1 in Terminal",
      delivered_at: "2026-10-02T10:00:00.000Z",
    });
    // Later ticks never post it again.
    await tick(darwin(exec));
    await tick(darwin(exec));
    expect(calls).toHaveLength(1);
    expect(events(env.store, "notification_delivery_failed")).toEqual([]);
  });

  it("runs from the event loop's tick, oldest first", async () => {
    const { calls, exec } = stubExec();
    record({ title: "first" });
    record({ title: "second" });
    const loop = new EventLoop({ store: env.store, handlers: {}, dueWork: [{ owner: "notifications", run: createDeliveryDueWork(darwin(exec)) }] }, { now: env.now });
    await loop.tick();
    expect(calls.map((c) => c.args[1])).toEqual(['"first"', '"second"']);
    await loop.tick();
    expect(calls).toHaveLength(2);
  });

  it("without terminal-notifier: posted by osascript with the text as argv items, no click, unsupported with the reason", async () => {
    const { calls, exec } = stubExec();
    record();
    await tick(darwin(exec, [OSASCRIPT_PATH]));
    expect(calls).toEqual([
      {
        file: "/usr/bin/osascript",
        args: ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", "--", TITLE, BODY],
        input: "",
        timeoutMs: 10_000,
      },
    ]);
    expect(getNotification(env.store, 1)).toMatchObject({
      delivery_status: "unsupported",
      delivery_detail:
        "no click-capable notifier (no terminal-notifier at /opt/homebrew/bin/terminal-notifier or /usr/local/bin/terminal-notifier): posted without a click action by /usr/bin/osascript",
      delivered_at: "2026-10-02T10:00:00.000Z",
    });
    // The Intel Homebrew path counts too.
    record();
    const intel = stubExec();
    await tick(darwin(intel.exec, ["/usr/local/bin/terminal-notifier", OSASCRIPT_PATH]));
    expect(intel.calls.map((c) => c.file)).toEqual(["/usr/local/bin/terminal-notifier"]);
  });

  it("text starting with '-' is data to every notifier: osascript gets it after --, terminal-notifier only as a quoted plist value or on stdin", async () => {
    const title = "-e";
    const body = '-e property p : (do shell script "touch /tmp/studio-never")';
    const { calls, exec } = stubExec();
    record({ title, body });
    await tick(darwin(exec, [OSASCRIPT_PATH]));
    record({ title: "--", body: "-" });
    await tick(darwin(exec));
    expect(calls).toEqual([
      {
        file: "/usr/bin/osascript",
        args: ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", "--", "-e", body],
        input: "",
        timeoutMs: 10_000,
      },
      {
        file: "/opt/homebrew/bin/terminal-notifier",
        args: ["-title", '"--"', "-group", '"loomwright-studio-notification-2"', "-execute", expect.stringMatching(/^"/)],
        input: "-",
        timeoutMs: 10_000,
      },
    ]);
  });

  it("not macOS: unsupported, nothing spawned; no notifier at all: unsupported, nothing spawned", async () => {
    const { calls, exec } = stubExec();
    record();
    await tick({ ...darwin(exec), platform: "linux" });
    expect(getNotification(env.store, 1)).toMatchObject({ delivery_status: "unsupported", delivery_detail: "not macOS (linux): not posted", delivered_at: null });
    record();
    await tick(darwin(exec, []));
    expect(getNotification(env.store, 2)).toMatchObject({
      delivery_status: "unsupported",
      delivery_detail:
        "no click-capable notifier (no terminal-notifier at /opt/homebrew/bin/terminal-notifier or /usr/local/bin/terminal-notifier), and no /usr/bin/osascript: not posted",
    });
    expect(calls).toEqual([]);
    expect(events(env.store, "notification_delivery_failed")).toEqual([]);
  });

  it("a failed post: failed with the error, exactly one notification_delivery_failed event, never retried", async () => {
    const cases: readonly [Partial<NotifierRun> | Error, string][] = [
      [{ status: 1, stderr: "boom\nsecond line" }, "/opt/homebrew/bin/terminal-notifier exited 1: boom"],
      [{ status: null, signal: "SIGTERM" }, "/opt/homebrew/bin/terminal-notifier was killed by SIGTERM"],
      [{ status: null, signal: "SIGKILL", timedOut: true }, "/opt/homebrew/bin/terminal-notifier did not finish within 10 s (killed)"],
      [new Error("spawn EACCES"), "/opt/homebrew/bin/terminal-notifier could not be run: spawn EACCES"],
    ];
    for (const [i, [result, detail]] of cases.entries()) {
      const { calls, exec } = stubExec(result);
      const { id } = record();
      await tick(darwin(exec));
      await tick(darwin(exec));
      await tick(darwin(exec));
      expect(calls, detail).toHaveLength(1);
      expect(getNotification(env.store, id), detail).toMatchObject({ delivery_status: "failed", delivery_detail: detail, delivered_at: null });
      const failed = events(env.store, "notification_delivery_failed");
      expect(failed, detail).toHaveLength(i + 1);
      expect(failed.at(-1)).toMatchObject({ actor: "kernel", payload: { id, error: detail } });
      // A settled row is never selected again (the step key would also refuse it: two guards).
      expect(pendingNotificationIds(env.store, 100), detail).toEqual([]);
    }
  });

  it("a crash between the post and its record: the next tick never posts again; the row ends failed (interrupted)", async () => {
    record();
    // The first attempt posts and never comes back: the process dies here.
    const hung: Call[] = [];
    const hang: NotifierExec = (file, args, input, timeoutMs) => {
      hung.push({ file, args: [...args], input, timeoutMs });
      return new Promise<NotifierRun>(() => {});
    };
    void tick(darwin(hang));
    await vi.waitFor(() => expect(hung).toHaveLength(1));
    const store = env.restart();

    const { calls, exec } = stubExec();
    await tick(darwin(exec), store);
    await tick(darwin(exec), store);
    expect(calls).toEqual([]);
    expect(getNotification(store, 1)).toMatchObject({ delivery_status: "failed", delivery_detail: "interrupted" });
    expect(events(store, "notification_delivery_failed").map((e) => e.payload)).toEqual([{ id: 1, error: "interrupted" }]);
    expect(events(store, "notify").map((e) => e.payload)).toEqual([{ reason: "work_step_interrupted", key: "notification:1:deliver" }]);
  });

  it("a crash after the post was recorded but before the row was written: the next tick writes the stored outcome without posting", async () => {
    record();
    const { calls, exec } = stubExec();
    const prepare = env.store.prepare.bind(env.store);
    vi.spyOn(env.store, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("UPDATE notifications SET delivery_status")) throw new Error("the process died here");
      return prepare(sql);
    }) as typeof env.store.prepare);
    await expect(tick(darwin(exec))).rejects.toThrow("the process died here");
    vi.restoreAllMocks();
    expect(getNotification(env.store, 1)?.delivery_status).toBe("pending");
    await tick(darwin(exec));
    expect(calls).toHaveLength(1);
    expect(getNotification(env.store, 1)).toMatchObject({ delivery_status: "delivered" });
  });

  it("a step left failed:error, or done with something that is not an outcome: the row ends failed with the error, nothing posted", async () => {
    record();
    record();
    const insert = env.store.prepare("INSERT INTO work_steps (key, status, result_json, failure_reason, rerunnable, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'x', 'x')");
    insert.run("notification:1:deliver", "failed", null, "error");
    insert.run("notification:2:deliver", "done", '"junk"', null);
    const { calls, exec } = stubExec();
    await tick(darwin(exec));
    expect(calls).toEqual([]);
    expect(getNotification(env.store, 1)).toMatchObject({ delivery_status: "failed", delivery_detail: expect.stringMatching(/^error: work step notification:1:deliver already failed \(failed:error\)/) });
    expect(getNotification(env.store, 2)).toMatchObject({ delivery_status: "failed", delivery_detail: "error: the delivery step stored no outcome" });
    expect(events(env.store, "notification_delivery_failed").map((e) => e.payload.id)).toEqual([1, 2]);
  });

  it("a step already failed:interrupted while its row is still pending (a crash between the mark and the row write): the row ends failed (interrupted), nothing posted, one event", async () => {
    record();
    env.store
      .prepare("INSERT INTO work_steps (key, status, result_json, failure_reason, rerunnable, created_at, updated_at) VALUES ('notification:1:deliver', 'failed', NULL, 'interrupted', 0, 'x', 'x')")
      .run();
    const { calls, exec } = stubExec();
    await tick(darwin(exec));
    await tick(darwin(exec));
    expect(calls).toEqual([]);
    expect(getNotification(env.store, 1)).toMatchObject({ delivery_status: "failed", delivery_detail: "interrupted", delivered_at: null });
    expect(events(env.store, "notification_delivery_failed").map((e) => e.payload)).toEqual([{ id: 1, error: "interrupted" }]);
  });

  it("an empty body is posted to terminal-notifier as exactly empty stdin and ends delivered (the probe: it exits 0 on one)", async () => {
    const { calls, exec } = stubExec();
    record({ body: "" });
    await tick(darwin(exec));
    expect(calls.map((c) => [c.file, c.input])).toEqual([["/opt/homebrew/bin/terminal-notifier", ""]]);
    expect(getNotification(env.store, 1)).toMatchObject({ delivery_status: "delivered", delivered_at: "2026-10-02T10:00:00.000Z" });
  });

  it("a notifier exiting non-zero with no output: failed with just the exit status", async () => {
    const { exec } = stubExec({ status: 2 });
    record();
    await tick(darwin(exec));
    expect(getNotification(env.store, 1)?.delivery_detail).toBe("/opt/homebrew/bin/terminal-notifier exited 2");
  });

  it("posts at most 20 per tick; the rest go on the next", async () => {
    const { calls, exec } = stubExec();
    for (let i = 0; i < 25; i++) record({ title: `n${i}` });
    await tick(darwin(exec));
    expect(calls).toHaveLength(20);
    await tick(darwin(exec));
    expect(calls).toHaveLength(25);
    expect(count(env.store, "SELECT count(*) FROM notifications WHERE delivery_status = 'delivered'")).toBe(25);
  });
});

describe("the quoting and the spawn (no shell ever sees notification text)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-notify-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("plistQuote escapes backslashes and double quotes only, inside double quotes", () => {
    expect(plistQuote('a "b" \\c\n(d)')).toBe('"a \\"b\\" \\\\c\n(d)"');
    expect(plistQuote("")).toBe('""');
  });

  it("the click's shell command, read by a real /bin/sh, is exactly osascript's argv; nothing in it runs", () => {
    const marker = join(dir, "ran");
    const command = `it's "x" $(touch ${marker}) \`touch ${marker}\`; touch ${marker}\nsecond`;
    const r = spawnSync("/bin/sh", ["-c", `printf '%s\\0' ${clickShellCommand(command)}`], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\0").slice(0, -1)).toEqual([
      "/usr/bin/osascript", "-e", "on run argv", "-e", 'tell application "Terminal"', "-e", "activate", "-e", "do script (item 1 of argv)", "-e", "end tell", "-e", "end run", "--", command,
    ]);
    expect(existsSync(marker)).toBe(false);
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });

  it.skipIf(process.platform !== "darwin")("a real osascript, given osascriptInvocation's argv, reads a title of -e and an AppleScript body as argv items; nothing in them runs", () => {
    const marker = join(dir, "pwned");
    const title = "-e";
    const body = `property p : (do shell script "touch ${marker}")`;
    const { file, args } = osascriptInvocation({ title, body });
    // The same argv with `display notification` swapped for a `return`, so no notification is posted.
    const display = args.indexOf("display notification (item 2 of argv) with title (item 1 of argv)");
    expect(display).toBeGreaterThan(-1);
    const probe = args.map((a, i) => (i === display ? 'return ((count of argv) as text) & "|" & (item 1 of argv) & "|" & (item 2 of argv)' : a));
    const r = spawnSync(file, probe, { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`2|-e|${body}\n`);
    expect(existsSync(marker)).toBe(false);
  });

  it("the Terminal command runs the kernel's CLI on `notifications show <id>` against its data dir, every path one word", () => {
    const script = join(dir, "show.sh");
    writeFileSync(script, 'printf "%s\\n" "dir=$STUDIO_DATA_DIR" "$@"\n');
    const dataDir = join(dir, "data it's $(x) dir");
    const command = showCommand(7, dataDir, { nodePath: "/bin/sh", cliPath: script });
    const r = spawnSync("/bin/sh", ["-c", command], { encoding: "utf8" });
    expect(r.stdout).toBe(`dir=${dataDir}\nnotifications\nshow\n7\n`);
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 53]) expect(() => showCommand(bad, dataDir)).toThrow(RangeError);
  });

  it("spawnNotifier: argv and stdin reach the process literally (no shell), output is captured, a timeout kills it, the env carries no credential", async () => {
    const marker = join(dir, "ran");
    const echoed = await spawnNotifier("/bin/echo", [`$(touch ${marker})`, "a;b", "`id`"], "", 5_000);
    expect(echoed).toEqual({ status: 0, signal: null, timedOut: false, stdout: `$(touch ${marker}) a;b \`id\`\n`, stderr: "" });
    expect(existsSync(marker)).toBe(false);
    expect((await spawnNotifier("/bin/cat", [], BODY, 5_000)).stdout).toBe(BODY);
    const slept = await spawnNotifier("/bin/sleep", ["5"], "", 100);
    expect(slept).toMatchObject({ timedOut: true, signal: "SIGKILL" });
    await expect(spawnNotifier(join(dir, "missing"), [], "", 5_000)).rejects.toThrow(/ENOENT/);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-real");
    const envOut = (await spawnNotifier("/usr/bin/env", [], "", 5_000)).stdout;
    vi.unstubAllEnvs();
    expect(envOut).not.toContain("ANTHROPIC_API_KEY");
    expect(envOut).toContain("PATH=/usr/bin:/bin:/usr/sbin:/sbin");
  });

  /** Kill the descendants a `sh -c '… & echo $!'` printed, so none outlives the test. */
  function killPrinted(stdout: string): void {
    for (const pid of stdout.split("\n").filter((l) => /^\d+$/.test(l))) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  /** Child-process handles still open, once a destroyed pipe's asynchronous close (a couple of loop turns) has run. */
  const handles = async (): Promise<number> => {
    await new Promise((r) => setTimeout(r, 50));
    return process.getActiveResourcesInfo().filter((r) => r === "PipeWrap" || r === "ProcessWrap").length;
  };

  it("spawnNotifier: a descendant holding the pipes cannot stretch the timeout, and leaves no handle behind", async () => {
    const before = await handles();
    const started = Date.now();
    const run = await spawnNotifier("/bin/sh", ["-c", "/bin/sleep 30 & echo $!; /bin/sleep 30"], "", 300);
    const took = Date.now() - started;
    killPrinted(run.stdout);
    expect(run).toMatchObject({ timedOut: true, signal: "SIGKILL" });
    expect(run.stdout).toMatch(/^\d+\n$/);
    expect(took).toBeLessThan(3_000);
    expect(await handles()).toBe(before);
  });

  it("spawnNotifier: a notifier that exits 0 and leaves a descendant holding the pipes settles with its own status, not the timeout", async () => {
    const before = await handles();
    const started = Date.now();
    const run = await spawnNotifier("/bin/sh", ["-c", "/bin/sleep 30 & echo $!"], "", 10_000);
    const took = Date.now() - started;
    killPrinted(run.stdout);
    expect(run).toMatchObject({ status: 0, signal: null, timedOut: false });
    expect(took).toBeLessThan(3_000);
    expect(await handles()).toBe(before);
  });

  it("spawnNotifier: a spawn that fails with no stdio (EMFILE) rejects exactly once, and its 'error' never goes unhandled", async () => {
    // What Node returns when it cannot create the pipes (observed under
    // `ulimit -n` with the fds exhausted): a child whose stdio is undefined and
    // whose 'error' is emitted on the next tick.
    let unhandled: unknown;
    let spawned = 0;
    const fakeSpawn = (() => {
      spawned += 1;
      const child = Object.assign(new EventEmitter(), { stdin: undefined, stdout: undefined, stderr: undefined, exitCode: null, signalCode: null, unref: () => {}, kill: () => true });
      process.nextTick(() => {
        try {
          child.emit("error", Object.assign(new Error("spawn /bin/echo EMFILE"), { code: "EMFILE" }));
        } catch (err) {
          unhandled = err;
        }
      });
      return child;
    }) as unknown as typeof spawn;
    let settledCount = 0;
    const outcome = spawnNotifierWith(fakeSpawn, "/bin/echo", [], "", 5_000).then(
      () => (settledCount += 1, "resolved"),
      (err: Error) => (settledCount += 1, err.message),
    );
    expect(await outcome).toBe("spawn /bin/echo EMFILE");
    await new Promise((r) => setTimeout(r, 20));
    expect({ spawned, settledCount, unhandled }).toEqual({ spawned: 1, settledCount: 1, unhandled: undefined });
    // Through postNotification it is a failed post, never a throw.
    const exec: NotifierExec = (file, args, input, timeoutMs) => spawnNotifierWith(fakeSpawn, file, args, input, timeoutMs);
    expect(await postNotification({ id: 1, title: "t", body: "b" }, dir, darwin(exec))).toMatchObject({
      status: "failed",
      detail: `${TN} could not be run: spawn /bin/echo EMFILE`,
      posted: false,
    });
    expect(unhandled).toBeUndefined();
  });
});

describe("kernel_notify", () => {
  function ctx(agent: string | null): KernelToolContext {
    const sessionId = Number(env.store.prepare("INSERT INTO sessions (agent, status) VALUES (?, 'running')").run(agent).lastInsertRowid);
    const sessions = {
      getSession: (id: number) => env.store.prepare("SELECT * FROM sessions WHERE id = ?").get(id),
      stopSession: async () => "stopped",
    } as unknown as KernelToolContext["sessions"];
    return { store: env.store, sessions, sessionId, now: env.now };
  }

  const call = async (c: KernelToolContext, args: unknown) => {
    const result = await contributedToolHandler(notifyTool, c)(args);
    const text = result.content[0]?.text ?? "null";
    // An error result is its message, not JSON.
    return { isError: result.isError === true, value: result.isError === true ? text : (JSON.parse(text) as unknown) };
  };

  it("twice with the same key in one session: one notification, the same result; source agent:<agent>; the event carries the session id", async () => {
    const c = ctx("wright");
    const first = await call(c, { title: TITLE, body: BODY, idempotency_key: "k1" });
    expect(first).toEqual({ isError: false, value: { id: 1, deep_link: "loomwright-studio://notifications/1", delivery_status: "pending" } });
    expect(await call(c, { title: "other", body: "other", idempotency_key: "k1" })).toEqual(first);
    expect(count(env.store, "SELECT count(*) FROM notifications")).toBe(1);
    expect(count(env.store, `SELECT count(*) FROM work_steps WHERE key = 'kernel_notify:session-${c.sessionId}:k1' AND status = 'done'`)).toBe(1);
    expect(getNotification(env.store, 1)).toMatchObject({ source: "agent:wright", title: TITLE, body: BODY });
    expect(events(env.store, "notification_created")).toEqual([
      expect.objectContaining({ session_id: c.sessionId, payload: { id: 1, source: "agent:wright" } }),
    ]);
    // A new key is a new notification.
    expect((await call(c, { title: "t", body: "b", idempotency_key: "k2" })).value).toMatchObject({ id: 2 });
  });

  it("a session with no agent records source agent:unknown; bad arguments are an isError result and record nothing", async () => {
    const c = ctx(null);
    await call(c, { title: "t", body: "b", idempotency_key: "k" });
    expect(getNotification(env.store, 1)?.source).toBe("agent:unknown");
    for (const bad of [{ title: "", body: "b", idempotency_key: "k2" }, { title: "t", body: "b" }, { title: "t".repeat(201), body: "b", idempotency_key: "k3" }]) {
      expect((await call(c, bad)).isError).toBe(true);
    }
    expect(count(env.store, "SELECT count(*) FROM notifications")).toBe(1);
  });

  it("a NUL in the title or body is refused at argument validation: an isError result naming the field, no row, no work step", async () => {
    const c = ctx("wright");
    expect(await call(c, { title: "a\u0000b", body: "b", idempotency_key: "k1" })).toEqual({
      isError: true,
      value: "kernel_notify: invalid input: ✖ must not contain a NUL character\n  → at title",
    });
    expect(await call(c, { title: "t", body: "b\u0000", idempotency_key: "k2" })).toEqual({
      isError: true,
      value: "kernel_notify: invalid input: ✖ must not contain a NUL character\n  → at body",
    });
    expect(count(env.store, "SELECT count(*) FROM notifications")).toBe(0);
    expect(count(env.store, `SELECT count(*) FROM work_steps WHERE key LIKE 'kernel_notify:session-${c.sessionId}:%'`)).toBe(0);
  });
});

describe("the API routes and studio notifications", () => {
  const TOKEN = "0123456789abcdef".repeat(4);
  let server: ApiServer;

  beforeEach(async () => {
    server = await startApiServer(
      {
        store: env.store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [stubProvider()],
        token: TOKEN,
        routes: mergeContributions([notificationsContribution]).routes,
      },
      { now: env.now },
    );
    writeFileSync(join(env.dataDir, "api.json"), JSON.stringify({ port: server.port, host: "127.0.0.1", pid: process.pid, started_at: "x" }));
  });

  afterEach(async () => {
    await server.close();
  });

  const get = async (path: string) => {
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    return { status: res.status, body: (await res.json()) as unknown };
  };

  async function studio(...argv: string[]) {
    const chunks = { out: [] as string[], err: [] as string[] };
    const code = await runCli(argv, {
      dataDir: env.dataDir,
      contributions: [notificationsContribution],
      keychain: { read: (s) => (s === API_TOKEN_KEYCHAIN_SERVICE ? TOKEN : undefined) },
      isPidAlive: () => true,
      stdout: { write: (c: string) => chunks.out.push(c) },
      stderr: { write: (c: string) => chunks.err.push(c) },
    });
    return { code, stdout: chunks.out.join(""), stderr: chunks.err.join("") };
  }

  function seed(): void {
    const triggerId = Number(
      env.store
        .prepare(
          "INSERT INTO triggers (owning_agent, kind, spec_json, action, action_payload, created_by, next_fire_at) VALUES ('wright', 'cron', '{}', 'notify', 'x', 'owner', '2026-10-03T17:00:00.000Z')",
        )
        .run().lastInsertRowid,
    );
    const sessionId = Number(env.store.prepare("INSERT INTO sessions (agent, status) VALUES ('wright', 'completed')").run().lastInsertRowid);
    record({ source: `trigger:${triggerId}`, title: "5pm reminder", body: "stand up" });
    record({ source: "agent:wright", title: "Bad \u001b[31mred\u001b[0m\ntitle", body: "line one\nline \u001b]0;two\u0007", sessionId });
    record({ source: "kernel:work_step_interrupted", title: "kernel", body: "" });
    record({ source: "trigger:999", title: "gone", body: "" });
  }

  it("GET /notifications lists newest first (limit 1-500, default 50); GET /notifications/:id adds the source's details; unknown ⇒ 404 no_such_notification", async () => {
    seed();
    const all = await get("/notifications");
    expect(all.status).toBe(200);
    expect((all.body as { notifications: { id: number }[] }).notifications.map((n) => n.id)).toEqual([4, 3, 2, 1]);
    expect((await get("/notifications?limit=2")).body).toMatchObject({ notifications: [{ id: 4 }, { id: 3 }] });
    for (const bad of ["0", "501", "x", "-1", "1.5"]) expect(await get(`/notifications?limit=${bad}`)).toEqual({ status: 400, body: { error: "invalid_limit" } });

    expect(await get("/notifications/1")).toEqual({
      status: 200,
      body: { notification: expect.objectContaining({ id: 1, deep_link: "loomwright-studio://notifications/1" }), trigger: { id: 1, action: "notify", next_fire_at: "2026-10-03T17:00:00.000Z" } },
    });
    expect((await get("/notifications/2")).body).toMatchObject({ session: { id: 1, status: "completed" } });
    expect(await get("/notifications/3")).toEqual({ status: 200, body: { notification: expect.objectContaining({ id: 3 }) } });
    expect((await get("/notifications/4")).body).toMatchObject({ trigger: null });
    expect(await get("/notifications/99")).toEqual({ status: 404, body: { error: "no_such_notification" } });
    expect(await get("/notifications/abc")).toEqual({ status: 400, body: { error: "invalid_id" } });
    // The bearer token is required, as for every route.
    expect((await fetch(`http://127.0.0.1:${server.port}/notifications`)).status).toBe(401);
  });

  it("studio notifications lists newest first with every control character escaped; --limit and --json", async () => {
    seed();
    const list = await studio("notifications");
    expect(list).toEqual({
      code: 0,
      stderr: "",
      stdout:
        "#4  2026-10-02T10:00:00.000Z  trigger:999  pending  gone  loomwright-studio://notifications/4\n" +
        "#3  2026-10-02T10:00:00.000Z  kernel:work_step_interrupted  pending  kernel  loomwright-studio://notifications/3\n" +
        "#2  2026-10-02T10:00:00.000Z  agent:wright  pending  Bad \\x1b[31mred\\x1b[0m\\ntitle  loomwright-studio://notifications/2\n" +
        "#1  2026-10-02T10:00:00.000Z  trigger:1  pending  5pm reminder  loomwright-studio://notifications/1\n",
    });
    expect((await studio("notifications", "--limit", "1")).stdout).toBe("#4  2026-10-02T10:00:00.000Z  trigger:999  pending  gone  loomwright-studio://notifications/4\n");
    const json = await studio("notifications", "--json", "--limit", "2");
    expect(json.code).toBe(0);
    expect((JSON.parse(json.stdout) as { notifications: { id: number }[] }).notifications.map((n) => n.id)).toEqual([4, 3]);
  });

  it("studio notifications show <id> prints the full record with the deep link and the trigger or session; unknown ⇒ no such notification, 1", async () => {
    seed();
    await deliverPendingNotifications({ store: env.store, now: env.now }, darwin(stubExec().exec));
    expect(await studio("notifications", "show", "1")).toEqual({
      code: 0,
      stderr: "",
      stdout: [
        "notification #1",
        "  created:   2026-10-02T10:00:00.000Z",
        "  source:    trigger:1",
        "  delivery:  delivered (posted by /opt/homebrew/bin/terminal-notifier; a click runs studio notifications show 1 in Terminal)",
        "  delivered: 2026-10-02T10:00:00.000Z",
        "  deep link: loomwright-studio://notifications/1",
        "  title:     5pm reminder",
        "  body:",
        "    stand up",
        "  trigger:   #1, action notify, next fire 2026-10-03T17:00:00.000Z",
        "",
      ].join("\n"),
    });
    const agent = await studio("notifications", "show", "2");
    expect(agent.stdout).toContain("  title:     Bad \\x1b[31mred\\x1b[0m\\ntitle\n  body:\n    line one\n    line \\x1b]0;two\\x07\n  session:   #1, status completed\n");
    expect(agent.stdout).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
    expect((await studio("notifications", "show", "4")).stdout).toContain("  trigger:   999 (no longer exists)\n");
    expect(await studio("notifications", "show", "99")).toEqual({ code: 1, stdout: "", stderr: "studio: no such notification 99\n" });
  });

  it("studio notifications show and the list escape the bidi controls and U+2028/U+2029 as \\uNNNN; none reaches the terminal raw", async () => {
    const all = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u061c\u200e\u200f\u2028\u2029";
    expect(printable(`a${all}b`)).toBe(
      "a\\u202a\\u202b\\u202c\\u202d\\u202e\\u2066\\u2067\\u2068\\u2069\\u061c\\u200e\\u200f\\u2028\\u2029b",
    );
    // A separator is never taken for the line break `keepNewlines` keeps.
    expect(printable("x\u2028y\nz", true, "  ")).toBe("x\\u2028y\n  z");
    record({ source: "kernel:test", title: "evil\u202egpj.exe\u2028fake line\u061c", body: "one\u2029two\u2066" });
    const raw = /[\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
    const show = await studio("notifications", "show", "1");
    expect(show.code).toBe(0);
    expect(show.stdout).toContain("  title:     evil\\u202egpj.exe\\u2028fake line\\u061c\n  body:\n    one\\u2029two\\u2066\n");
    expect(show.stdout).not.toMatch(raw);
    const list = await studio("notifications");
    expect(list.stdout).toBe("#1  2026-10-02T10:00:00.000Z  kernel:test  pending  evil\\u202egpj.exe\\u2028fake line\\u061c  loomwright-studio://notifications/1\n");
  });

  it("studio notifications show for an agent: notification whose session is null, or whose session row no longer exists, prints it and exits 0", async () => {
    record({ source: "agent:wright", title: "no session", body: "" });
    record({ source: "agent:wright", title: "gone session", body: "", sessionId: 999 });
    const none = await studio("notifications", "show", "1");
    expect(none).toMatchObject({ code: 0, stderr: "" });
    expect(none.stdout).toContain("  title:     no session\n  body:\n    \n  session:   unknown\n");
    const gone = await studio("notifications", "show", "2");
    expect(gone).toMatchObject({ code: 0, stderr: "" });
    expect(gone.stdout).toContain("  title:     gone session\n  body:\n    \n  session:   #999, status unknown (no such row)\n");
  });

  it("any other answer from the API is one stderr line and 1", async () => {
    const answer = (status: number, body: string): typeof fetch => (async () => new Response(body, { status })) as typeof fetch;
    const run = async (fetchFn: typeof fetch, ...argv: string[]) => {
      const err: string[] = [];
      const code = await runCli(["notifications", ...argv], {
        dataDir: env.dataDir,
        contributions: [notificationsContribution],
        keychain: { read: () => TOKEN },
        isPidAlive: () => true,
        fetch: fetchFn,
        stdout: { write: () => true },
        stderr: { write: (c: string) => err.push(c) },
      });
      return { code, stderr: err.join("") };
    };
    expect(await run(answer(500, '{"error":"internal_error"}'))).toEqual({ code: 1, stderr: "studio: kernel API answered 500 to GET /notifications\n" });
    expect(await run(answer(500, "{}"), "show", "3")).toEqual({ code: 1, stderr: "studio: kernel API answered 500 to GET /notifications/3\n" });
    expect(await run(answer(200, '{"rows":[]}'), "--limit", "5")).toEqual({ code: 1, stderr: "studio: kernel API sent an unreadable answer to GET /notifications?limit=5\n" });
  });

  it("bad usage prints the subcommand's usage and exits 2, without calling the API", async () => {
    for (const argv of [["show"], ["show", "x"], ["show", "0"], ["show", "1", "2"], ["--limit"], ["--limit", "0"], ["--limit", "501"], ["--json", "--json"], ["nope"]]) {
      expect(await studio("notifications", ...argv), argv.join(" ")).toEqual({
        code: 2,
        stdout: "",
        stderr: "usage: studio notifications [--limit N] [--json] | studio notifications show <id>\n",
      });
    }
    expect(printable("a\tb\u0085c")).toBe("a\\x09b\\x85c");
  });
});
