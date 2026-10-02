// Shared fixtures for the event-loop and kernel-tool tests: a temp data dir,
// a controllable clock, and "restart" = close the Store and open a new one on
// the same data dir. Never the real SDK or a model.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store/index.js";

export interface LoopEnv {
  readonly dataDir: string;
  readonly clock: { at: Date };
  readonly now: () => Date;
  /** The live store (replaced by `restart`). */
  readonly store: Store;
  /** Close the store and open a new one on the same data dir, like a kernel restart. */
  restart(): Store;
  advance(ms: number): void;
  cleanup(): void;
}

export function loopEnv(start = "2026-10-02T10:00:00.000Z"): LoopEnv {
  const dir = mkdtempSync(join(tmpdir(), "studio-loop-"));
  const dataDir = join(dir, "data");
  const clock = { at: new Date(start) };
  let store = new Store({ dataDir });
  return {
    dataDir,
    clock,
    now: () => clock.at,
    get store() {
      return store;
    },
    restart() {
      store.close();
      store = new Store({ dataDir });
      return store;
    },
    advance(ms: number) {
      clock.at = new Date(clock.at.getTime() + ms);
    },
    cleanup() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface EventRow {
  readonly id: number;
  readonly kind: string;
  readonly actor: string | null;
  readonly session_id: number | null;
  readonly task_id: number | null;
  readonly payload: Record<string, unknown>;
}

export function events(store: Store, kind?: string): EventRow[] {
  return store
    .prepare<[], { id: number; kind: string; actor: string | null; session_id: number | null; task_id: number | null; payload_json: string }>(
      "SELECT id, kind, actor, session_id, task_id, payload_json FROM events ORDER BY id",
    )
    .all()
    .filter((r) => kind === undefined || r.kind === kind)
    .map((r) => ({ id: r.id, kind: r.kind, actor: r.actor, session_id: r.session_id, task_id: r.task_id, payload: JSON.parse(r.payload_json) }));
}

export function count(store: Store, sql: string, ...params: unknown[]): number {
  return store.prepare<unknown[], number>(sql).pluck().get(...params) ?? 0;
}
