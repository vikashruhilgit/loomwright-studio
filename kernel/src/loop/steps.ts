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
//   happened. It runs the work again only when the step was declared
//   re-runnable (the effect is idempotent, like rewriting the same file) by
//   the call that first started it: that value is stored on the row and
//   decides every replay, whatever a later caller passes; otherwise the step
//   becomes `failed:interrupted` and the user is notified (one `notify`).
//   Nothing makes a non-idempotent external effect exactly once.
// - A step's result is its JSON form, on the first call as on every repeat:
//   both return `JSON.parse(JSON.stringify(value))` of what `fn` returned, so
//   a `Date` comes back as its ISO string, an `undefined` property is dropped
//   and a class instance becomes a plain object, every time. `T` is not
//   narrowed to JSON-safe types; return JSON-shaped values. A `fn` returning
//   `undefined` (or anything JSON cannot represent at the top level) stores
//   NULL and returns `undefined` both times. A result `JSON.stringify` cannot
//   serialize (a `BigInt`, a cycle, a throwing `toJSON`) throws, and the step
//   is not recorded `done`. In `runStep` that throw rolls back the one
//   transaction, `fn`'s writes included, so nothing happened and a later call
//   runs `fn` again, as for any throw. In `runStepAsync` `fn` has already
//   resolved, so its effect happened: the step is recorded `failed:error`
//   (not left `started`, where a re-runnable step would be run again blindly)
//   and the serialization error propagates.
// - A rejection that the caller's `opts.noEffect` predicate accepts is the
//   caller's statement that `fn` did nothing (for example an admission refusal
//   thrown before any side effect). The claim is then released instead of
//   recorded as `failed:error`, so a later call for the key runs `fn` again.
//   This module never decides which errors mean "no effect"; the caller does.
// - That statement is about the step whose own `fn` raised the error, so it
//   counts only there: the innermost step. Every error that leaves a work step
//   is tagged with that step's key (`workStepOrigin`), and an outer step whose
//   `fn` passes on an error already tagged by an inner step never consults
//   `noEffect`: its `fn` may have made an effect before calling the inner
//   step, so it records `failed:error` instead of being released and run
//   again. An error that is not an object cannot be tagged, so it is never
//   treated as effect-free.
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

/** `result`'s stored JSON (see the header). Throws when JSON cannot serialize it (a `BigInt`, a cycle). */
function resultJson(result: unknown): string | null {
  // JSON.stringify(undefined) is undefined: a step with no result stores NULL.
  return (JSON.stringify(result) as string | undefined) ?? null;
}

/** Record `done` with the result's `json`; returns the stored result as a repeat will read it (see the header). */
function markDone(store: Store, key: string, json: string | null, at: string): unknown {
  store
    .prepare("UPDATE work_steps SET status = 'done', result_json = ?, failure_reason = NULL, updated_at = ? WHERE key = ?")
    .run(json, at, key);
  return parseResult(json);
}

function markFailed(store: Store, key: string, reason: WorkStepFailureReason, at: string): void {
  store.prepare("UPDATE work_steps SET status = 'failed', failure_reason = ?, updated_at = ? WHERE key = ?").run(reason, at, key);
}

/** `started` left by a crash and not re-runnable: `failed:interrupted` plus one `notify`. Call inside a transaction. */
function markInterrupted(store: Store, key: string, at: string): void {
  markFailed(store, key, "interrupted", at);
  appendEvent(store, "notify", NO_REF, { reason: "work_step_interrupted", key }, at);
}

/**
 * Record `failed:error` after `fn` of `runStepAsync` failed or its result
 * could not be stored. If the write itself fails, the row stays `started` and
 * a later call treats it as a crash leftover (see the header).
 */
function failSafely(store: Store, key: string, now: () => Date): void {
  try {
    store.transaction(() => markFailed(store, key, "error", now().toISOString()));
  } catch {
    // The row stays `started`; a later call treats it as a crash leftover.
  }
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
 * leftover: no call for it is in flight here) ⇒ run again when the row was
 * stored re-runnable, else mark it interrupted; absent ⇒ insert `started`
 * with `rerunnable` and run. `rerunnable` is used only for that insert: the
 * value stored when the step was first started decides a replay, never this
 * caller's option, and is never rewritten.
 */
function claim(store: Store, key: string, rerunnable: boolean, at: string): Claim {
  const row = readRow(store, key);
  if (row === undefined) {
    insertStarted(store, key, rerunnable, at);
    return { kind: "run", fresh: true };
  }
  if (row.status === "done") return { kind: "done", value: parseResult(row.result_json) };
  if (row.status === "failed") throw new WorkStepFailedError(key, row.failure_reason);
  if (row.rerunnable !== 1) {
    markInterrupted(store, key, at);
    return { kind: "interrupted" };
  }
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

/** The key of the innermost work step each error came out of (see the header). */
const origins = new WeakMap<object, string>();

function isTaggable(err: unknown): err is object {
  return (typeof err === "object" && err !== null) || typeof err === "function";
}

/** Tag `err` as having come out of step `key`, unless an inner step already did. */
function tagOrigin(err: unknown, key: string): void {
  if (isTaggable(err) && !origins.has(err)) origins.set(err, key);
}

/**
 * The key of the innermost work step `err` came out of (whose `fn` threw it,
 * or which refused to run), or `undefined` when no step has seen it.
 */
export function workStepOrigin(err: unknown): string | undefined {
  return isTaggable(err) ? origins.get(err) : undefined;
}

/**
 * Whether this step may release its claim for `err`: only when its own `fn`
 * raised it (no inner step tagged it first) and `opts.noEffect` accepts it.
 */
function isNoEffect(opts: StepOptions, err: unknown): boolean {
  if (opts.noEffect === undefined) return false;
  // Passed on from an inner step (or untaggable): this fn may have had an effect first.
  if (!isTaggable(err) || origins.has(err)) return false;
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
 * - absent: runs `fn` and returns its result as stored (its JSON form, see
 *   the header); `opts.rerunnable` is stored on the row.
 * - `done`: returns the stored result without calling `fn`.
 * - `failed`: throws `WorkStepFailedError` without calling `fn`.
 * - `started` (left by a crashed `runStepAsync`): runs `fn` again when the
 *   row was stored re-runnable (by the call that first started it;
 *   `opts.rerunnable` here does not change it); otherwise marks it
 *   `failed:interrupted`, appends one `notify` and throws
 *   `WorkStepInterruptedError`.
 * - `fn` throws, or returns a value JSON cannot serialize: the transaction
 *   rolls back (no row remains, `fn`'s writes undone) and the error
 *   propagates; nothing was committed, so a later call runs `fn` again
 *   (`opts.noEffect` is not needed here: the rollback already releases).
 *
 * `fn` must be synchronous: a returned promise is refused (use
 * `runStepAsync`). Called inside an outer transaction, this nests as a
 * savepoint and the outer rollback undoes it, interrupted mark included.
 */
export function runStep<T>(store: Store, key: string, fn: () => T, opts: StepOptions = {}): T {
  checkKey(key);
  try {
    if (flightsOf(store).has(key)) throw new Error(`work step ${key} is already running in this process`);
    const now = opts.now ?? (() => new Date());
    const at = now().toISOString();
    const outcome = store.transaction((): { readonly interrupted: true } | { readonly interrupted: false; readonly value: unknown } => {
      const c = claim(store, key, opts.rerunnable === true, at);
      if (c.kind === "interrupted") return { interrupted: true };
      if (c.kind === "done") return { interrupted: false, value: c.value };
      const value = fn();
      if (isThenable(value)) throw new TypeError(`work step ${key}: runStep needs a synchronous fn; use runStepAsync`);
      // A serialization throw here rolls back with fn's writes (see the header).
      return { interrupted: false, value: markDone(store, key, resultJson(value), now().toISOString()) };
    });
    // Thrown after the commit, so the interrupted mark and its notify persist.
    if (outcome.interrupted) throw new WorkStepInterruptedError(key);
    return outcome.value as T;
  } catch (err) {
    // An enclosing runStepAsync must not take this error as its own fn's.
    tagOrigin(err, key);
    throw err;
  }
}

/**
 * Run work with external effects (a file, a session stop) at most once per
 * `key`: commit `started` (with `opts.rerunnable`), `await fn()`, then commit
 * `done` with its JSON result and resolve to that stored result (its JSON
 * form, as a repeat returns it). See the header for the limits of this.
 *
 * - `done`: resolves to the stored result without calling `fn`.
 * - `failed`: rejects with `WorkStepFailedError` without calling `fn`.
 * - `started` with no call for `key` in flight in this process (a crash
 *   leftover): runs `fn` again when the row was stored re-runnable (by the
 *   call that first started it; `opts.rerunnable` here does not change it);
 *   otherwise marks it `failed:interrupted`, appends one `notify` and rejects
 *   with `WorkStepInterruptedError`.
 * - `fn` rejects with an error `opts.noEffect` accepts (the caller's word
 *   that `fn` did nothing) and that `fn` raised itself, not passed on from an
 *   inner step (`workStepOrigin` is unset): the claim is released (see
 *   `releaseClaim`) and the error propagates, so a later call runs `fn`
 *   again. An error passed on from an inner step is `failed:error` here
 *   whatever `noEffect` says: `fn` may have had an effect before. If the release
 *   cannot be written, or the process dies before it, the row stays
 *   `started` and a later call treats it as a crash leftover.
 * - `fn` rejects otherwise: the row becomes `failed:error` and the error propagates.
 * - `fn` resolves to a value JSON cannot serialize: its effect happened, so
 *   the row becomes `failed:error` (never released, never left `started` to
 *   be re-run) and the serialization error propagates.
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
      if (isNoEffect(opts, err)) {
        try {
          store.transaction(() => releaseClaim(store, key, c.fresh));
        } catch {
          // The row stays `started`; a later call treats it as a crash leftover.
        }
      } else failSafely(store, key, now);
      throw err;
    }
    let json: string | null;
    try {
      json = resultJson(value);
    } catch (err) {
      // fn resolved, so its effect happened: a re-run would repeat it.
      failSafely(store, key, now);
      throw err;
    }
    return store.transaction(() => markDone(store, key, json, now().toISOString())) as T;
  };

  // Every rejection leaves tagged with this key (an inner step's tag wins), so
  // an enclosing step never releases itself for it.
  const promise = run().catch((err: unknown) => {
    tagOrigin(err, key);
    throw err;
  });
  flights.set(key, promise);
  const release = (): void => {
    if (flights.get(key) === promise) flights.delete(key);
  };
  promise.then(release, release);
  return promise;
}
