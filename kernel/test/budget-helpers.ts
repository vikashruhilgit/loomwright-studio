// Shared fixtures for the budget tests: a temp store, session rows, a
// controllable clock on UTC days (so results never depend on the host's time
// zone), and the recorded SDK message fixtures. Never the real SDK or a model.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BudgetAuth, BudgetDeps } from "../src/budget/index.js";
import { Store } from "../src/store/index.js";

export const AUTH: BudgetAuth = { id: "stub-provider", account: "owner@example.test" };

export interface TestEnv {
  readonly store: Store;
  readonly clock: { at: Date };
  readonly deps: Required<BudgetDeps>;
  cleanup(): void;
}

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function nextUtcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
}

export function testEnv(start = "2026-10-02T10:00:00.000Z"): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), "studio-budget-"));
  const store = new Store({ dataDir: join(dir, "data") });
  const clock = { at: new Date(start) };
  return {
    store,
    clock,
    deps: { now: () => clock.at, dayOf: utcDay, startOfNextDay: nextUtcMidnight },
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function insertSession(
  store: Store,
  fields: { agent?: string | null; account?: string | null; status?: string; task?: number | null } = {},
): number {
  return Number(
    store
      .prepare("INSERT INTO sessions (agent, status, auth_account, task_id) VALUES (?, ?, ?, ?)")
      .run(
        fields.agent === undefined ? "wright" : fields.agent,
        fields.status ?? "running",
        fields.account === undefined ? AUTH.account : fields.account,
        fields.task ?? null,
      ).lastInsertRowid,
  );
}

export interface EventRow {
  readonly kind: string;
  readonly session_id: number | null;
  readonly task_id: number | null;
  readonly at: string;
  readonly payload: Record<string, unknown>;
}

export function events(store: Store, kind?: string): EventRow[] {
  return store
    .prepare<[], { kind: string; session_id: number | null; task_id: number | null; at: string; payload_json: string }>(
      "SELECT kind, session_id, task_id, at, payload_json FROM events ORDER BY id",
    )
    .all()
    .filter((r) => kind === undefined || r.kind === kind)
    .map((r) => ({ kind: r.kind, session_id: r.session_id, task_id: r.task_id, at: r.at, payload: JSON.parse(r.payload_json) }));
}

export function fixture(name: string): SDKMessage {
  return JSON.parse(readFileSync(new URL(`./fixtures/sdk/${name}`, import.meta.url), "utf8")) as SDKMessage;
}

export interface UsageFigures {
  readonly input?: number;
  readonly output?: number;
  readonly cacheWrite?: number;
  readonly cacheRead?: number;
  readonly thinking?: number;
  readonly cost?: number;
}

/** A `result` message whose `modelUsage` has one entry per model. */
export function result(usage: Record<string, UsageFigures>, extra: Record<string, unknown> = {}): SDKMessage {
  const modelUsage: Record<string, unknown> = {};
  for (const [model, u] of Object.entries(usage)) {
    modelUsage[model] = {
      inputTokens: u.input ?? 0,
      outputTokens: u.output ?? 0,
      cacheCreationInputTokens: u.cacheWrite ?? 0,
      cacheReadInputTokens: u.cacheRead ?? 0,
      ...(u.thinking === undefined ? {} : { thinkingTokens: u.thinking }),
      webSearchRequests: 0,
      costUSD: u.cost ?? 0,
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
    };
  }
  return { type: "result", subtype: "success", is_error: false, result: "ok", modelUsage, ...extra } as unknown as SDKMessage;
}

export function rateLimitEvent(info: Record<string, unknown>): SDKMessage {
  return { type: "rate_limit_event", rate_limit_info: info, uuid: "u", session_id: "s" } as unknown as SDKMessage;
}

export function assistantError(error: string, text?: string): SDKMessage {
  return {
    type: "assistant",
    message: { content: text === undefined ? [] : [{ type: "text", text }] },
    parent_tool_use_id: null,
    error,
  } as unknown as SDKMessage;
}

export function errorResult(errors: string[]): SDKMessage {
  return { type: "result", subtype: "error_during_execution", is_error: true, errors, modelUsage: {} } as unknown as SDKMessage;
}

export function isErrorSuccessResult(text: string): SDKMessage {
  return { type: "result", subtype: "success", is_error: true, result: text, modelUsage: {} } as unknown as SDKMessage;
}
