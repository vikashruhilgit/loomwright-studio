// The Playbooks screen's own reads: `GET /playbooks/:id/runs`,
// `GET /playbooks/:id/versions` (phase 7 item 04) and `GET /budget/usage?days=1` for
// the list's Tokens today (item 15). They are screen-local, not store resources: the
// store's table is fixed (`app/src/store/resources.ts`).
//
// Each read keeps its last `ok` answer on screen until a newer `ok` one lands, so
// a refetch never blanks or resizes anything, and an answer older than the latest
// request is dropped (a generation counter). A read is repeated when the live feed
// names a kind this screen shows (`newestRelevantEventId`), trailing, after
// `REFETCH_THROTTLE_MS`, as the store's own refetches are throttled; when the feed
// comes back after an answer that never reached the kernel; and when the connection
// returns from an offline state, even if no read failed (nothing was asked while the
// kernel was away).
//
// The last `ok` answers also live in a module-level hold keyed by the bridge, so a
// remount (the owner went to another screen and back while the kernel was away)
// starts from the last known answers instead of an empty map. The hold is per
// bridge object, so one kernel's answers never reach another bridge's screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResult, BudgetUsageResponse, PlaybookRun, PlaybookRunsResponse, PlaybookVersion, PlaybookVersionsResponse, StudioBridge } from "../../api/contract";
import { useKernelReach } from "../../shell/last-known";
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

/** What one bridge's screen last read ok: the keyed reads' bodies and each listed playbook's newest run (`null`: it has none). */
interface Hold {
  readonly keyed: Map<string, unknown>;
  readonly lastRuns: Map<number, PlaybookRun | null>;
}

const holds = new WeakMap<StudioBridge, Hold>();

function holdOf(api: StudioBridge): Hold {
  let hold = holds.get(api);
  if (hold === undefined) {
    hold = { keyed: new Map(), lastRuns: new Map() };
    holds.set(api, hold);
  }
  return hold;
}

/** The answer a read starts from for `key`: its held body if one was ever read ok, else unread. */
function startOf<T>(hold: Hold, key: string | undefined): Held<T> {
  if (key === undefined || !hold.keyed.has(key)) return { key, ...UNREAD };
  return { key, data: hold.keyed.get(key) as T, failed: false, settled: true };
}

/**
 * Repeat a read when the connection returns from an offline state (`reconnecting`, `unreachable`, `not_installed`),
 * even when no read failed: nothing was asked while the kernel was away, so nothing marked a read as failed.
 */
function useRefetchOnReturn(api: StudioBridge, live: boolean, refetch: () => void): void {
  const { offline } = useKernelReach(api);
  const away = useRef(false);
  useEffect(() => {
    if (offline) away.current = true;
    else if (live && away.current) {
      away.current = false;
      refetch();
    }
  }, [offline, live, refetch]);
}

/**
 * One keyed read. `load` runs for `key` on mount, whenever `key` changes, after
 * `eventId` moves, when the feed comes back (`live`) after a failure, and when the
 * connection returns from offline. With no key it reads nothing. The state of another
 * key is never shown; a key's own last `ok` answer is (it is held per bridge).
 */
function useKeyedRead<T>(api: StudioBridge, key: string | undefined, load: () => Promise<ApiResult<T>>, eventId: number, live: boolean): Read<T> & { readonly refetch: () => void } {
  const [held, setHeld] = useState<Held<T>>(() => startOf<T>(holdOf(api), key));
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
        if (result.ok) holdOf(api).keyed.set(key, result.body);
        // A failed answer keeps the last ok one: the state's own, or (when the key just changed) the one held for this key.
        setHeld((prev) => ({
          key,
          data: result.ok ? result.body : prev.key === key ? prev.data : startOf<T>(holdOf(api), key).data,
          failed: !result.ok,
          settled: true,
        }));
      });
  }, [api, key]);

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
  useRefetchOnReturn(api, live, refetch);

  const current = held.key === key ? held : startOf<T>(holdOf(api), key);
  return { data: current.data, failed: current.failed, settled: current.settled, refetch };
}

/** `GET /playbooks/:id/runs`: the newest page (the kernel's default size), for the open playbook. */
export function useRuns(api: StudioBridge, playbookId: number | undefined, eventId: number, live: boolean): Read<readonly PlaybookRun[]> & { readonly refetch: () => void } {
  const read = useKeyedRead<PlaybookRunsResponse>(
    api,
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
    api,
    playbookId === undefined ? undefined : `versions:${playbookId}`,
    () => api.request<PlaybookVersionsResponse>({ method: "GET", path: "/playbooks/:id/versions", params: { id: playbookId ?? 0 } }),
    eventId,
    live,
  );
  return { data: read.data?.versions, failed: read.failed, settled: read.settled, refetch: read.refetch };
}

/** The counted tokens each playbook has used today, by slug: the kernel's own `limits[]` rows of scope `playbook`. */
function tokensTodayBySlug(usage: BudgetUsageResponse): ReadonlyMap<string, number> {
  return new Map(usage.limits.filter((limit) => limit.scope === "playbook").map((limit) => [limit.id, limit.tokens_today]));
}

/**
 * `GET /budget/usage?days=1`: each playbook's counted tokens today, by slug, for the list's Tokens today. A slug
 * the answer does not list is absent from the map (the cell reads "unknown", never 0). `enabled` false (a view
 * that does not show the list) reads nothing; the held answer is kept for the next time the list shows.
 */
export function useTokensToday(
  api: StudioBridge,
  eventId: number,
  live: boolean,
  enabled = true,
): Read<ReadonlyMap<string, number>> & { readonly refetch: () => void } {
  const read = useKeyedRead<BudgetUsageResponse>(
    api,
    enabled ? "budget:today" : undefined,
    () => api.request<BudgetUsageResponse>({ method: "GET", path: "/budget/usage", query: { days: "1" } }),
    eventId,
    live,
  );
  const data = useMemo(() => (read.data === undefined ? undefined : tokensTodayBySlug(read.data)), [read.data]);
  return { data, failed: read.failed, settled: read.settled, refetch: read.refetch };
}

/** One playbook's newest run: `null` is a read that found none. */
export type LastRun = Read<PlaybookRun | null>;

/** The held newest runs of `ids`, each as an answered read. */
function lastRunsFrom(hold: Hold, ids: readonly number[]): ReadonlyMap<number, LastRun> {
  const map = new Map<number, LastRun>();
  for (const id of ids) if (hold.lastRuns.has(id)) map.set(id, { data: hold.lastRuns.get(id), failed: false, settled: true });
  return map;
}

/**
 * Each listed playbook's newest run (`limit=1`), for the list's Last run.
 * One batch per mount, per change of the id list, per relevant feed event, per
 * return of the feed after a failed read and per return of the connection from
 * offline; a playbook whose read fails keeps its last answer, which a remount
 * starts from. The map holds only ids asked for, so a removed playbook leaves no row.
 */
export function useLastRuns(api: StudioBridge, ids: readonly number[], eventId: number, live: boolean): ReadonlyMap<number, LastRun> {
  const key = ids.join(",");
  const [held, setHeld] = useState<ReadonlyMap<number, LastRun>>(() => lastRunsFrom(holdOf(api), ids));
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
          const hold = holdOf(api).lastRuns;
          // Only ids still listed are kept, so a removed playbook leaves no row and neither the map nor the hold outgrows the list.
          const listed = new Set(idsRef.current);
          for (const heldId of [...hold.keys()]) if (!listed.has(heldId)) hold.delete(heldId);
          if (result.ok) hold.set(id, result.body.runs[0] ?? null);
          setHeld((prev) => {
            const next = new Map([...prev].filter(([heldId]) => listed.has(heldId)));
            // A failed answer keeps the last ok one, which a mount started from (the hold).
            next.set(id, { data: result.ok ? (result.body.runs[0] ?? null) : prev.get(id)?.data, failed: !result.ok, settled: true });
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
  useRefetchOnReturn(api, live, refetch);

  return held;
}
