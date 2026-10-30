// The reads behind Budget & audit's live behaviour: `GET /budget/usage` (on mount and on
// demand, the last good answer held until a newer one lands), and the feed watcher that makes
// the screen read again.
//
// An answer is a `Reply` (`./model.ts`): the bridge's "kernel unreachable" (status 0) stays
// apart from a refusal, because an unreachable kernel is never "no usage". A thrown IPC call is
// a `failed` reply, never an exception. A failed read never drops the data held: the screen
// shows it as the last known usage.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiRequest, ApiResult, BudgetUsageResponse, StudioBridge } from "../../api/contract";
import { LIVE_THROTTLE_MS, NOT_READ, USAGE_DAYS, nextRead, replyOf } from "./model";
import type { Read, Reply } from "./model";

/** One bridge call as a `Reply`. */
export async function send<R>(api: StudioBridge, request: ApiRequest): Promise<Reply<R>> {
  let result: ApiResult<R> | undefined;
  try {
    result = await api.request<R>(request);
  } catch {
    // The IPC call itself failed (no answer from the main process): said as such, never swallowed.
    result = undefined;
  }
  return replyOf(result);
}

/** `GET /budget/usage?days=`: the last `days` days (today included), the limits against today's use, and the cap state. */
export function readUsage(api: StudioBridge, days: number = USAGE_DAYS): Promise<Reply<BudgetUsageResponse>> {
  return send<BudgetUsageResponse>(api, { method: "GET", path: "/budget/usage", query: { days: String(days) } });
}

/** `GET /budget/usage`: on mount and on demand. The last `ok` answer is kept until a newer one lands; an answer older than the latest request is dropped. */
export function useUsageRead(api: StudioBridge): { readonly read: Read<BudgetUsageResponse>; readonly refetch: () => void } {
  const [read, setRead] = useState<Read<BudgetUsageResponse>>(NOT_READ);
  const generation = useRef(0);

  const refetch = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    void readUsage(api).then((reply) => {
      if (generation.current === mine) setRead((prev) => nextRead(prev, reply));
    });
  }, [api]);

  useEffect(() => {
    refetch();
    return () => {
      // The answer in flight is dropped once the screen unmounts.
      generation.current += 1;
    };
  }, [refetch]);

  return { read, refetch };
}

/**
 * Calls `onRefetch` when a newer event id shows up in the feed, at most once per `throttleMs`: the first event of a quiet
 * period reads at once, and events inside the window share one trailing read. The id on screen at mount is the baseline:
 * events the screen already had do not read again.
 */
export function useFeedRefetch(eventId: number, onRefetch: () => void, throttleMs: number = LIVE_THROTTLE_MS): void {
  const seen = useRef(eventId);
  const latest = useRef(onRefetch);
  latest.current = onRefetch;
  const lastRead = useRef(Number.NEGATIVE_INFINITY);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (eventId <= seen.current) return;
    seen.current = eventId;
    // A read is already scheduled; it will see this event's data too.
    if (timer.current !== undefined) return;
    const fire = (): void => {
      timer.current = undefined;
      lastRead.current = Date.now();
      latest.current();
    };
    const wait = lastRead.current + throttleMs - Date.now();
    if (wait <= 0) fire();
    else timer.current = window.setTimeout(fire, wait);
  }, [eventId, throttleMs]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    },
    [],
  );
}
