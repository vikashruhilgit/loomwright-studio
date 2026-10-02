// Store helpers shared by the loop and the kernel tools. Not part of the
// module's public surface.
import type { Store } from "../store/store.js";

/** Cap for free text copied into an event or a queue row (an error message, for example). */
export const MAX_EVENT_TEXT = 2_000;

export interface EventRef {
  readonly sessionId: number | null;
  readonly taskId: number | null;
}

export const NO_REF: EventRef = { sessionId: null, taskId: null };

/** Append one `actor 'kernel'` audit row to `events`. */
export function appendEvent(store: Store, kind: string, ref: EventRef, payload: Record<string, unknown>, at: string): void {
  store
    .prepare("INSERT INTO events (at, kind, actor, task_id, session_id, payload_json) VALUES (?, ?, 'kernel', ?, ?, ?)")
    .run(at, kind, ref.taskId, ref.sessionId, JSON.stringify(payload));
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function clip(text: string, max: number = MAX_EVENT_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * An ISO-8601 instant (date, time and an explicit `Z` or offset) normalized to
 * UTC with milliseconds, like the schema's `NOW`; `undefined` when `value` is
 * not one. A local time without an offset is refused: it is ambiguous.
 */
export function normalizeInstant(value: unknown): string | undefined {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
