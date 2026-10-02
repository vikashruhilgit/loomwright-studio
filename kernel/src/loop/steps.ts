// Idempotent work steps over `work_steps` (D2, AC2).
//
// What "exactly once" means here (AC8; requirement item 07, Risks):
//
// - Exactly once holds ONLY for effects inside SQLite that commit in the
//   step's own transaction. `runStep` runs a synchronous `fn` inside one
//   transaction with the `started` and `done` writes, so either all of it
//   commits (and a repeat returns the stored result without calling `fn`) or
//   none of it does (and a repeat runs `fn` again: nothing happened).
// - External effects (a file write, a session stop, a `gh` comment) are at
//   most once only through the key plus this check: `runStepAsync` commits
//   `started` before the effect and `done` after it, so a crash between the
//   two leaves `started`, and the next call cannot know whether the effect
//   happened. It runs the work again only when the caller declared the step
//   re-runnable (the effect is idempotent, like rewriting the same file);
//   otherwise the step becomes `failed:interrupted` and the user is notified.
//   Nothing makes a non-idempotent external effect exactly once.
// - A rejection that the caller's `opts.noEffect` predicate accepts is the
//   caller's statement that `fn` did nothing (for example an admission refusal
//   thrown before any side effect). The claim is then released instead of
//   recorded as `failed:error`, so a later call for the key runs `fn` again.
//   This module never decides which errors mean "no effect"; the caller does.
import type { Store } from "../store/store.js";
import { appendEvent, NO_REF } from "./internal.js";
import type { StepOptions } from "./types.js";

/** Why a step is `failed`: a crash left it `started` (`interrupted`), or its work threw (`error`). */
export type WorkStepFailureReason = "interrupted" | "error";

/** One `work_steps` row, as the API reports it. */
export interface WorkStep {
  readonly key: string;
  readonly status: "started" | "done" | "failed";
  /** `failed:interrupted` / `failed:error` for a failed row, else `status`. */
  readonly label: string;
  readonly failureReason: string | null;
  readonly rerunnable: boolean;
  /** The stored result (parsed), `undefined` unless `done`. */
  readonly result: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A crash left the step `started` and it was not declared re-runnable (`failed:interrupted`). */
export class WorkStepInterruptedError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`work step ${key} was interrupted by a crash and is not re-runnable (failed:interrupted)`);
    this.name = "WorkStepInterruptedError";
    this.key = key;
  }
}

/** The step already failed; `failed` is terminal for its key (the caller picks a new key to try again). */
export class WorkStepFailedError extends Error {
  readonly key: string;
  readonly reason: string | null;

  constructor(key: string, reason: string | null) {
    super(`work step ${key} already failed${reason === null ? "" : ` (failed:${reason})`}; use a new key to try again`);
    this.name = "WorkStepFailedError";
    this.key = key;
    this.reason = reason;
  }
}

interface StepRow {
  readonly key: string;
  readonly status: "started" | "done" | "failed";
  readonly result_json: string | null;
  readonly failure_reason: string | null;
  readonly rerunnable: number;
  readonly created_at: string;
  readonly updated_at: string;
}

function readRow(store: Store, key: string): StepRow | undefined {
  return store
    .prepare<[string], StepRow>(
      "SELECT key, status, result_json, failure_reason, rerunnable, created_at, updated_at FROM work_steps WHERE key = ?",
    )
    .get(key);
}

function parseResult(json: string | null): unknown {
  return json === null ? undefined : (JSON.parse(json) as unknown);
}

/** The stored step for `key`, or `undefined`. */
export function getWorkStep(store: Store, key: string): WorkStep | undefined {
  const row = readRow(store, key);
  if (row === undefined) return undefined;
  return {
    key: row.key,
    status: row.status,
    label: row.status === "failed" && row.failure_reason !== null ? `failed:${row.failure_reason}` : row.status,
    failureReason: row.failure_reason,
    rerunnable: row.rerunnable === 1,
    result: row.status === "done" ? parseResult(row.result_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function checkKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key === "") throw new TypeError("a work step key must be a non-empty string");
}

function isThenable(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function insertStarted(store: Store, key: string, rerunnable: boolean, at: string): void {
  store
    .prepare("INSERT INTO work_steps (key, status, rerunnable, created_at, updated_at) VALUES (?, 'started', ?, ?, ?)")
    .run(key, rerunnable ? 1 : 0, at, at);
}

function markDone(store: Store, key: string, result: unknown, at: string): void {
  // JSON.stringify(undefined) is undefined: a step with no result stores NULL.
  const json = JSON.stringify(result) as string | undefined;
  store
    .prepare("UPDATE work_steps SET status = 'done', result_json = ?, failure_reason = NULL, updated_at = ? WHERE key = ?")
    .run(json ?? null, at, key);
}

function markFailed(store: Store, key: string, reason: WorkStepFailureReason, at: string): void {
  store.prepare("UPDATE work_steps SET status = 'failed', failure_reason = ?, updated_at = ? WHERE key = ?").run(reason, at, key);
}

/** `started` left by a crash and not re-runnable: `failed:interrupted` plus one `notify`. Call inside a transaction. */
function markInterrupted(store: Store, key: string, at: string): void {
  markFailed(store, key, "interrupted", at);
  appendEvent(store, "notify", NO_REF, { reason: "work_step_interrupted", key }, at);
}

/** Steps of `runStepAsync` running in this process, per store, so a concurrent call is not misread as a crash. */
const inFlight = new WeakMap<Store, Map<string, Promise<unknown>>>();

function flightsOf(store: Store): Map<string, Promise<unknown>> {
  let flights = inFlight.get(store);
  if (flights === undefined) {
    flights = new Map();
    inFlight.set(store, flights);
  }
  return flights;
}

/** `fresh`: this claim inserted the `started` row (false: it re-runs a crash leftover). */
type Claim =
  | { readonly kind: "done"; readonly value: unknown }
  | { readonly kind: "run"; readonly fresh: boolean }
  | { readonly kind: "interrupted" };

/**
 * Read `key` and decide (inside the caller's transaction): `done` ⇒ the
 * stored result; `failed` ⇒ throw `WorkStepFailedError`; `started` (a crash
 * leftover: no call for it is in flight here) ⇒ run again when re-runnable,
 * else mark it interrupted; absent ⇒ insert `started` and run.
 */
function claim(store: Store, key: string, rerunnable: boolean, at: string): Claim {
  const row = readRow(store, key);
  if (row === undefined) {
    insertStarted(store, key, rerunnable, at);
    return { kind: "run", fresh: true };
  }
  if (row.status === "done") return { kind: "done", value: parseResult(row.result_json) };
  if (row.status === "failed") throw new WorkStepFailedError(key, row.failure_reason);
  if (!rerunnable) {
    markInterrupted(store, key, at);
    return { kind: "interrupted" };
  }
  store.prepare("UPDATE work_steps SET rerunnable = 1, updated_at = ? WHERE key = ?").run(at, key);
  return { kind: "run", fresh: false };
}

/**
 * `fn` rejected with an error the caller declared effect-free: undo this
 * call's claim. A row this call inserted is deleted (the key is unclaimed
 * again); a crash leftover it re-ran stays `started`, because an earlier
 * attempt may have had an effect and the next call must still see that.
 */
function releaseClaim(store: Store, key: string, fresh: boolean): void {
  if (fresh) store.prepare("DELETE FROM work_steps WHERE key = ? AND status = 'started'").run(key);
}

function isNoEffect(opts: StepOptions, err: unknown): boolean {
  if (opts.noEffect === undefined) return false;
  try {
    return opts.noEffect(err) === true;
  } catch {
    // A predicate that throws proves nothing: keep the safe default (failed:error).
    return false;
  }
}

/**
 * Run synchronous, local work `fn` at most once per `key` (AC2). One
 * transaction holds the `started` write, `fn` (and every store write it
 * makes) and the `done` write with `fn`'s JSON result, so its SQLite effects
 * happen exactly once (see the header).
 *
 * - `done`: returns the stored result without calling `fn`.
 * - `failed`: throws `WorkStepFailedError` without calling `fn`.
 * - `started` (left by a crashed `runStepAsync`): runs `fn` again when
 *   `opts.rerunnable`; otherwise marks it `failed:interrupted`, appends one
 *   `notify` and throws `WorkStepInterruptedError`.
 * - `fn` throws: the transaction rolls back (no row remains) and the error
 *   propagates; nothing was committed, so a later call runs `fn` again
 *   (`opts.noEffect` is not needed here: the rollback already releases).
 *
 * `fn` must be synchronous: a returned promise is refused (use
 * `runStepAsync`). Called inside an outer transaction, this nests as a
 * savepoint and the outer rollback undoes it, interrupted mark included.
 */
export function runStep<T>(store: Store, key: string, fn: () => T, opts: StepOptions = {}): T {
  checkKey(key);
  if (flightsOf(store).has(key)) throw new Error(`work step ${key} is already running in this process`);
  const now = opts.now ?? (() => new Date());
  const at = now().toISOString();
  const outcome = store.transaction((): { readonly interrupted: true } | { readonly interrupted: false; readonly value: unknown } => {
    const c = claim(store, key, opts.rerunnable === true, at);
    if (c.kind === "interrupted") return { interrupted: true };
    if (c.kind === "done") return { interrupted: false, value: c.value };
    const value = fn();
    if (isThenable(value)) throw new TypeError(`work step ${key}: runStep needs a synchronous fn; use runStepAsync`);
    markDone(store, key, value, now().toISOString());
    return { interrupted: false, value };
  });
  // Thrown after the commit, so the interrupted mark and its notify persist.
  if (outcome.interrupted) throw new WorkStepInterruptedError(key);
  return outcome.value as T;
}

/**
 * Run work with external effects (a file, a session stop) at most once per
 * `key`: commit `started` (with `opts.rerunnable`), `await fn()`, then commit
 * `done` with its JSON result. See the header for the limits of this.
 *
 * - `done`: resolves to the stored result without calling `fn`.
 * - `failed`: rejects with `WorkStepFailedError` without calling `fn`.
 * - `started` with no call for `key` in flight in this process (a crash
 *   leftover): runs `fn` again when `opts.rerunnable`; otherwise marks it
 *   `failed:interrupted`, appends one `notify` and rejects with
 *   `WorkStepInterruptedError`.
 * - `fn` rejects with an error `opts.noEffect` accepts (the caller's word
 *   that `fn` did nothing): the claim is released (see `releaseClaim`) and
 *   the error propagates, so a later call runs `fn` again. If the release
 *   cannot be written, or the process dies before it, the row stays
 *   `started` and a later call treats it as a crash leftover.
 * - `fn` rejects otherwise: the row becomes `failed:error` and the error propagates.
 * - A concurrent call for a `key` already in flight here returns the same
 *   promise; `fn` runs once.
 */
export function runStepAsync<T>(store: Store, key: string, fn: () => Promise<T>, opts: StepOptions = {}): Promise<T> {
  checkKey(key);
  const flights = flightsOf(store);
  const running = flights.get(key);
  if (running !== undefined) return running as Promise<T>;

  const now = opts.now ?? (() => new Date());
  const run = async (): Promise<T> => {
    // Synchronous up to the first await: no other call for `key` interleaves with the claim.
    const c = store.transaction(() => claim(store, key, opts.rerunnable === true, now().toISOString()));
    if (c.kind === "done") return c.value as T;
    if (c.kind === "interrupted") throw new WorkStepInterruptedError(key);
    let value: T;
    try {
      value = await fn();
    } catch (err) {
      try {
        if (isNoEffect(opts, err)) store.transaction(() => releaseClaim(store, key, c.fresh));
        else store.transaction(() => markFailed(store, key, "error", now().toISOString()));
      } catch {
        // The row stays `started`; a later call treats it as interrupted.
      }
      throw err;
    }
    store.transaction(() => markDone(store, key, value, now().toISOString()));
    return value;
  };

  const promise = run();
  flights.set(key, promise);
  const release = (): void => {
    if (flights.get(key) === promise) flights.delete(key);
  };
  promise.then(release, release);
  return promise;
}
