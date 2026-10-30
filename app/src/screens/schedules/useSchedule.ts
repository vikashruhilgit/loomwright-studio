// The two reads behind Schedules' live behaviour: `GET /schedule`, and the feed
// watcher that makes the screen read again.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduleResponse, StudioBridge } from "../../api/contract";
import { REFETCH_THROTTLE_MS } from "../../store/store";
import { readSchedule } from "./actions";
import { NOT_READ, type Read, nextRead } from "./model";

/** `GET /schedule`: on mount and on demand. The last `ok` answer is kept until a newer one lands; an answer older than the latest request is dropped. */
export function useScheduleRead(api: StudioBridge): { readonly read: Read<ScheduleResponse>; readonly refetch: () => void } {
  const [read, setRead] = useState<Read<ScheduleResponse>>(NOT_READ);
  const generation = useRef(0);

  const refetch = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    void readSchedule(api).then((reply) => {
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
 * Calls `onRefetch` once per `REFETCH_THROTTLE_MS` window after a newer relevant event id shows up in the feed. The
 * id on screen at mount is the baseline: events the screen already had do not read again.
 */
export function useFeedRefetch(eventId: number, onRefetch: () => void): void {
  const baseline = useRef(eventId);
  const latest = useRef(onRefetch);
  latest.current = onRefetch;
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (eventId <= baseline.current || timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      latest.current();
    }, REFETCH_THROTTLE_MS);
  }, [eventId]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    },
    [],
  );
}
