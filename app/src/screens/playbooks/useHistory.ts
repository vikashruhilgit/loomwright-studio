// The Playbooks screen's own reads: `GET /playbooks/:id/runs` and
// `GET /playbooks/:id/versions` (phase 7 item 04). They are screen-local, not
// store resources: the store's table is fixed (`app/src/store/resources.ts`).
//
// Each read keeps its last `ok` answer on screen until a newer `ok` one lands, so
// a refetch never blanks or resizes anything, and an answer older than the latest
// request is dropped (a generation counter). A read is repeated when the live feed
// names a kind this screen shows (`newestRelevantEventId`), trailing, after
// `REFETCH_THROTTLE_MS`, as the store's own refetches are throttled; and again when
// the feed comes back after an answer that never reached the kernel.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult, PlaybookRun, PlaybookRunsResponse, PlaybookVersion, PlaybookVersionsResponse, StudioBridge } from "../../api/contract";
import { REFETCH_THROTTLE_MS } from "../../store/store";

/** One read: its last `ok` body, whether the latest answer failed, and whether any answer arrived. */
export interface Read<T> {
  readonly data: T | undefined;
  /** The latest answer was a refusal or never reached the kernel (the last `data` is kept). */
  readonly failed: boolean;
  /** An answer, ok or not, has arrived for this key. */
  readonly settled: boolean;
}

const UNREAD = { data: undefined, failed: false, settled: false } as const;

interface Held<T> extends Read<T> {
  readonly key: string | undefined;
}

/**
 * One keyed read. `load` runs for `key` on mount, whenever `key` changes, after
 * `eventId` moves, and when the feed comes back (`live`) after a failure. With no
 * key it reads nothing. The state of another key is never shown.
 */
function useKeyedRead<T>(key: string | undefined, load: () => Promise<ApiResult<T>>, eventId: number, live: boolean): Read<T> & { readonly refetch: () => void } {
  const [held, setHeld] = useState<Held<T>>({ key, ...UNREAD });
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refetch = useCallback(() => {
    if (key === undefined) return;
    generation.current += 1;
    const mine = generation.current;
    void loadRef
      .current()
      .catch((): ApiResult<T> => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }))
      .then((result) => {
        if (generation.current !== mine) return;
        setHeld((prev) => ({
          key,
          data: result.ok ? result.body : prev.key === key ? prev.data : undefined,
          failed: !result.ok,
          settled: true,
        }));
      });
  }, [key]);

  useEffect(() => {
    refetch();
    return () => {
      // The answer in flight is dropped once the key changes or the screen unmounts.
      generation.current += 1;
    };
  }, [refetch]);

  const handled = useRef(eventId);
  useEffect(() => {
    if (eventId === handled.current) return;
    const timer = window.setTimeout(() => {
      handled.current = eventId;
      refetch();
    }, REFETCH_THROTTLE_MS);
    return () => window.clearTimeout(timer);
  }, [eventId, refetch]);

  const failed = held.key === key && held.failed;
  useEffect(() => {
    if (live && failed) refetch();
  }, [live, failed, refetch]);

  const current = held.key === key ? held : { key, ...UNREAD };
  return { data: current.data, failed: current.failed, settled: current.settled, refetch };
}

/** `GET /playbooks/:id/runs`: the newest page (the kernel's default size), for the open playbook. */
export function useRuns(api: StudioBridge, playbookId: number | undefined, eventId: number, live: boolean): Read<readonly PlaybookRun[]> & { readonly refetch: () => void } {
  const read = useKeyedRead<PlaybookRunsResponse>(
    playbookId === undefined ? undefined : `runs:${playbookId}`,
    () => api.request<PlaybookRunsResponse>({ method: "GET", path: "/playbooks/:id/runs", params: { id: playbookId ?? 0 } }),
    eventId,
    live,
  );
  return { data: read.data?.runs, failed: read.failed, settled: read.settled, refetch: read.refetch };
}

/** `GET /playbooks/:id/versions`: every version, newest first, for the open playbook. */
export function useVersions(api: StudioBridge, playbookId: number | undefined, eventId: number, live: boolean): Read<readonly PlaybookVersion[]> & { readonly refetch: () => void } {
  const read = useKeyedRead<PlaybookVersionsResponse>(
    playbookId === undefined ? undefined : `versions:${playbookId}`,
    () => api.request<PlaybookVersionsResponse>({ method: "GET", path: "/playbooks/:id/versions", params: { id: playbookId ?? 0 } }),
    eventId,
    live,
  );
  return { data: read.data?.versions, failed: read.failed, settled: read.settled, refetch: read.refetch };
}

/** One playbook's newest run: `null` is a read that found none. */
export type LastRun = Read<PlaybookRun | null>;

/**
 * Each listed playbook's newest run (`limit=1`), for the list's Last run and Tokens.
 * One batch per mount, per change of the id list, per relevant feed event and per
 * return of the feed after a failed read; a playbook whose read fails keeps its last
 * answer. The map holds only ids asked for, so a removed playbook leaves no row.
 */
export function useLastRuns(api: StudioBridge, ids: readonly number[], eventId: number, live: boolean): ReadonlyMap<number, LastRun> {
  const key = ids.join(",");
  const [held, setHeld] = useState<ReadonlyMap<number, LastRun>>(new Map());
  const generation = useRef(0);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const refetch = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    for (const id of idsRef.current) {
      void api
        .request<PlaybookRunsResponse>({ method: "GET", path: "/playbooks/:id/runs", params: { id }, query: { limit: "1" } })
        .catch((): ApiResult<PlaybookRunsResponse> => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }))
        .then((result) => {
          if (generation.current !== mine) return;
          setHeld((prev) => {
            const next = new Map(prev);
            const before = prev.get(id);
            next.set(id, { data: result.ok ? (result.body.runs[0] ?? null) : before?.data, failed: !result.ok, settled: true });
            return next;
          });
        });
    }
  }, [api]);

  useEffect(() => {
    if (key === "") return;
    refetch();
    return () => {
      generation.current += 1;
    };
  }, [key, refetch]);

  const handled = useRef(eventId);
  useEffect(() => {
    if (eventId === handled.current) return;
    const timer = window.setTimeout(() => {
      handled.current = eventId;
      refetch();
    }, REFETCH_THROTTLE_MS);
    return () => window.clearTimeout(timer);
  }, [eventId, refetch]);

  const anyFailed = [...held.values()].some((read) => read.failed);
  useEffect(() => {
    if (live && anyFailed) refetch();
  }, [live, anyFailed, refetch]);

  return held;
}
