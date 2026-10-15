// A trigger instant fires at most once across `kill -9` (phase 2 item 04,
// AC4), with the phase 1 crash harness pattern: the kernel is a separate OS
// process (`fixtures/triggers-crash.mjs` over a kernel built into a temp dir
// by `buildKernel()`), it is SIGKILLed at a chosen point of a tick and run
// again on the same data dir, and the data dir is read read-only from here.
//
// - After the fire committed and before the tick ended: the fixture's second
//   due-work function signals readiness and blocks; SIGKILL; a fresh process
//   ticks again. Exactly one notification for the instant.
// - Inside the fire, after the notification INSERT and before its work step
//   commits: nothing of it is on disk; the next process fires it, once.
//
// Every process this file starts is its own child, killed in afterEach.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildKernel, withDb } from "./crash-helpers.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/triggers-crash.mjs", import.meta.url));
const AT = "2026-10-14T11:30:00.000Z";

let build: { root: string; outDir: string };
let tmp: string;
let dataDir: string;
const children: ChildProcess[] = [];

beforeAll(() => {
  build = buildKernel();
}, 120_000);

afterAll(() => {
  rmSync(build.root, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-triggers-crash-"));
  dataDir = join(tmp, "data");
});

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
});

interface Run {
  readonly child: ChildProcess;
  /** The first stdout line, parsed (`{ready}` or `{done}`), or `undefined` if it exited without one. */
  readonly firstLine: Promise<Record<string, unknown> | undefined>;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stderr(): string;
}

function run(args: readonly string[]): Run {
  const child = spawn(process.execPath, [FIXTURE, "--out-dir", build.outDir, "--data-dir", dataDir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  let err = "";
  child.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const firstLine = new Promise<Record<string, unknown> | undefined>((resolve) => {
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const nl = out.indexOf("\n");
      if (nl >= 0) resolve(JSON.parse(out.slice(0, nl)) as Record<string, unknown>);
    });
    void exited.then(() => resolve(undefined));
  });
  return { child, firstLine, exited, stderr: () => err };
}

const REGISTER = JSON.stringify({ agent: "wright", kind: "once", spec: "2026-10-14T17:00:00+05:30", action: "notify", text: "check X" });

function scalar(sql: string, ...params: unknown[]): unknown {
  return withDb(dataDir, (db) => db.prepare(sql).pluck().get(...params));
}

function count(sql: string, ...params: unknown[]): number {
  return Number(scalar(sql, ...params));
}

/** The assertions both scenarios end with: one effect row for the instant, the trigger spent, one fire recorded. */
function assertFiredOnce(): void {
  expect(count("SELECT count(*) FROM notifications")).toBe(1);
  expect(count("SELECT count(*) FROM notifications WHERE source = 'trigger:1' AND body = 'check X'")).toBe(1);
  expect(count("SELECT count(*) FROM events WHERE kind = 'trigger_fired'")).toBe(1);
  expect(count("SELECT count(*) FROM work_steps WHERE key = ? AND status = 'done'", `trigger:1:${AT}`)).toBe(1);
  expect(withDb(dataDir, (db) => db.prepare("SELECT enabled, last_result FROM triggers WHERE id = 1").get())).toEqual({ enabled: 0, last_result: "fired" });
  expect(count("SELECT count(*) FROM events WHERE kind = 'due_work_failed'")).toBe(0);
}

describe("kill -9 around a trigger's fire, then a fresh process (AC4)", () => {
  it("after the fire committed and before the tick ended: the restarted process does not fire the instant again", async () => {
    const first = run(["--register", REGISTER, "--register-now", "2026-10-14T10:00:00.000Z", "--now", "2026-10-14T11:30:01.000Z", "--pause"]);
    const ready = await first.firstLine;
    expect(ready, first.stderr()).toEqual({ ready: true, pid: first.child.pid });
    // The fire is on disk while the process is still inside the tick.
    expect(count("SELECT count(*) FROM notifications")).toBe(1);
    first.child.kill("SIGKILL");
    expect((await first.exited).signal).toBe("SIGKILL");

    const second = run(["--now", "2026-10-14T11:30:02.000Z"]);
    expect(await second.firstLine, second.stderr()).toEqual({ done: true, pid: second.child.pid });
    expect((await second.exited).code).toBe(0);
    assertFiredOnce();
  }, 60_000);

  it("inside the fire, after the notification INSERT and before its work step commits: nothing is on disk, and the next process fires it once", async () => {
    const first = run(["--register", REGISTER, "--register-now", "2026-10-14T10:00:00.000Z", "--now", "2026-10-14T11:30:01.000Z", "--fault", "notification-insert"]);
    expect(await first.firstLine).toBeUndefined();
    expect((await first.exited).signal, first.stderr()).toBe("SIGKILL");
    // The registration committed before the tick; nothing of the fire did.
    expect(count("SELECT count(*) FROM triggers WHERE enabled = 1 AND next_fire_at = ?", AT)).toBe(1);
    expect(count("SELECT count(*) FROM notifications")).toBe(0);
    expect(count("SELECT count(*) FROM work_steps")).toBe(0);
    expect(count("SELECT count(*) FROM events WHERE kind = 'trigger_fired'")).toBe(0);

    const second = run(["--now", "2026-10-14T11:30:02.000Z"]);
    expect(await second.firstLine, second.stderr()).toEqual({ done: true, pid: second.child.pid });
    assertFiredOnce();
    // And a third process finds nothing left to fire.
    const third = run(["--now", "2026-10-14T11:31:00.000Z"]);
    expect((await third.exited).code, third.stderr()).toBe(0);
    assertFiredOnce();
  }, 60_000);
});
