// runStep / runStepAsync over `work_steps` (AC2, AC7, AC8). Temp store,
// injected clock; a "crash" is a throw after `started` was committed, or a
// hand-inserted `started` row followed by a restart.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStepFailedError, WorkStepInterruptedError, getWorkStep, runStep, runStepAsync } from "../src/loop/index.js";
import type { Store } from "../src/store/index.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv();
});

afterEach(() => {
  env.cleanup();
});

function insertStarted(store: Store, key: string): void {
  store.prepare("INSERT INTO work_steps (key, status) VALUES (?, 'started')").run(key);
}

function taskCount(store: Store): number {
  return count(store, "SELECT count(*) FROM tasks");
}

describe("runStep (synchronous, local)", () => {
  it("records done with the result, then returns the stored result without calling fn", () => {
    const fn = vi.fn(() => ({ answer: 42 }));
    expect(runStep(env.store, "k", fn, { now: env.now })).toEqual({ answer: 42 });
    expect(runStep(env.store, "k", fn, { now: env.now })).toEqual({ answer: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getWorkStep(env.store, "k")).toMatchObject({ status: "done", label: "done", result: { answer: 42 }, failureReason: null });
  });

  it("commits fn's own writes in the same transaction: exactly once, also across a restart", () => {
    const insert = (store: Store) => () =>
      Number(store.prepare("INSERT INTO tasks (title, state) VALUES ('t', 's')").run().lastInsertRowid);
    const first = runStep(env.store, "create", insert(env.store));
    const store = env.restart();
    expect(runStep(store, "create", insert(store))).toBe(first);
    expect(taskCount(store)).toBe(1);
  });

  it("a throwing fn rolls back everything (no step row, no writes) and a retry runs fn again", () => {
    let calls = 0;
    const fn = () => {
      calls++;
      env.store.prepare("INSERT INTO tasks (title, state) VALUES ('t', 's')").run();
      if (calls === 1) throw new Error("boom");
      return "ok";
    };
    expect(() => runStep(env.store, "k", fn)).toThrow("boom");
    expect(getWorkStep(env.store, "k")).toBeUndefined();
    expect(taskCount(env.store)).toBe(0);
    expect(runStep(env.store, "k", fn)).toBe("ok");
    expect(calls).toBe(2);
    expect(taskCount(env.store)).toBe(1);
  });

  it("refuses an async fn and stores nothing", () => {
    expect(() => runStep(env.store, "k", () => Promise.resolve(1))).toThrow(/runStepAsync/);
    expect(getWorkStep(env.store, "k")).toBeUndefined();
  });

  it("a started row left by a crash: not re-runnable ⇒ failed:interrupted, one notify, fn not called", () => {
    insertStarted(env.store, "k");
    const store = env.restart();
    const fn = vi.fn(() => 1);
    expect(() => runStep(store, "k", fn, { now: env.now })).toThrow(WorkStepInterruptedError);
    expect(fn).not.toHaveBeenCalled();
    expect(getWorkStep(store, "k")).toMatchObject({ status: "failed", failureReason: "interrupted", label: "failed:interrupted" });
    expect(events(store, "notify").map((e) => e.payload)).toEqual([{ reason: "work_step_interrupted", key: "k" }]);
    // Terminal for the key: a later call neither runs fn nor notifies again.
    expect(() => runStep(store, "k", fn)).toThrow(WorkStepFailedError);
    expect(fn).not.toHaveBeenCalled();
    expect(events(store, "notify")).toHaveLength(1);
  });

  it("a started row left by a crash: re-runnable ⇒ fn runs again and the step is done", () => {
    insertStarted(env.store, "k");
    const store = env.restart();
    expect(runStep(store, "k", () => "again", { rerunnable: true })).toBe("again");
    expect(getWorkStep(store, "k")).toMatchObject({ status: "done", rerunnable: true, result: "again" });
    expect(events(store, "notify")).toHaveLength(0);
  });
});

describe("runStepAsync (external effects)", () => {
  it("crash between started and done (fn throws after started was committed): failed:error, later call ⇒ WorkStepFailedError", async () => {
    const seen: (string | undefined)[] = [];
    const fn = vi.fn(async () => {
      seen.push(getWorkStep(env.store, "k")?.status);
      throw new Error("effect failed");
    });
    await expect(runStepAsync(env.store, "k", fn)).rejects.toThrow("effect failed");
    expect(seen).toEqual(["started"]);
    expect(getWorkStep(env.store, "k")).toMatchObject({ status: "failed", label: "failed:error" });
    await expect(runStepAsync(env.store, "k", fn)).rejects.toBeInstanceOf(WorkStepFailedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a crash that leaves started (simulated by a hand-inserted row + restart): not re-runnable ⇒ interrupted, fn not called", async () => {
    insertStarted(env.store, "k");
    const store = env.restart();
    const fn = vi.fn(async () => 1);
    await expect(runStepAsync(store, "k", fn)).rejects.toBeInstanceOf(WorkStepInterruptedError);
    expect(fn).not.toHaveBeenCalled();
    expect(getWorkStep(store, "k")?.label).toBe("failed:interrupted");
    expect(events(store, "notify")).toHaveLength(1);
  });

  it("re-runnable ⇒ fn runs again after the crash and the step ends done", async () => {
    insertStarted(env.store, "k");
    const store = env.restart();
    await expect(runStepAsync(store, "k", async () => ({ path: "/x" }), { rerunnable: true })).resolves.toEqual({ path: "/x" });
    expect(getWorkStep(store, "k")).toMatchObject({ status: "done", result: { path: "/x" } });
  });

  it("records done after fn resolves and returns the stored result after a restart", async () => {
    const fn = vi.fn(async () => "first");
    await expect(runStepAsync(env.store, "k", fn)).resolves.toBe("first");
    const store = env.restart();
    await expect(runStepAsync(store, "k", fn)).resolves.toBe("first");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls for the same key run fn once and are not misread as a crash", async () => {
    let release!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => (release = r)));
    const a = runStepAsync(env.store, "k", fn);
    const b = runStepAsync(env.store, "k", fn);
    expect(() => runStep(env.store, "k", () => "sync")).toThrow(/already running/);
    release("once");
    await expect(Promise.all([a, b])).resolves.toEqual(["once", "once"]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(events(env.store, "notify")).toHaveLength(0);
    expect(getWorkStep(env.store, "k")?.status).toBe("done");
  });

  it("refuses an empty key", () => {
    expect(() => runStepAsync(env.store, "", async () => 1)).toThrow(TypeError);
    expect(() => runStep(env.store, "", () => 1)).toThrow(TypeError);
  });
});
