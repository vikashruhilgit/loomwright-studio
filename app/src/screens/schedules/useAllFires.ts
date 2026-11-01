// The all-triggers firing history's reads (`GET /triggers/:id/fires`, one per trigger): the first page of every
// trigger on mount and whenever the trigger list changes or the screen is told to refetch, and the next older page of
// the triggers at the merge horizon on demand (`./all-fires.ts` explains the horizon).
//
// The cost is one request per trigger on each refetch: there is no route for every trigger's fires, and the
// owner chose this fan-out for a personal build with a handful of triggers. A refetch keeps what is on screen until the
// answers land and keeps the older pages already loaded when a fresh first page touches them (`mergeFirstPage`). An
// answer older than the latest request is dropped, and so is an older page whose cursor is no longer its trigger's. A
// failed read never drops what is held. The loaded histories also go to `./last-read.ts`, so a screen mounted again
// while the kernel is stopped starts from them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudioBridge, TriggerFiresResponse } from "../../api/contract";
import { readFires } from "./actions";
import { nextPageTargets } from "./all-fires";
import { readLast, recordLast } from "./last-read";
import { type History, type Reply, appendOlderPage, failureDetail, mergeFirstPage } from "./model";

interface State {
  readonly histories: ReadonlyMap<number, History>;
  /** The newest answer to each trigger's first-page read. */
  readonly latest: ReadonlyMap<number, Reply<TriggerFiresResponse>>;
  readonly olderBusy: boolean;
  /** Why the last "Load older" did not land. */
  readonly olderError: string | undefined;
}

export interface AllFiresView {
  readonly histories: ReadonlyMap<number, History>;
  /** Some trigger's first page has been answered, or the screen started from what an earlier mount read. */
  readonly answered: boolean;
  /** The newest answer of some trigger was status 0. */
  readonly unreachable: boolean;
  /** The first newest answer that was a refusal or a failed call, in words (`GET /triggers/3/fires · 500 · code`). */
  readonly failure: string | undefined;
  readonly olderBusy: boolean;
  readonly olderError: string | undefined;
  /** Read every trigger's first page again (what is shown stays until the answers land). */
  readonly refetch: () => void;
  /** Read the next older page of the triggers at the merge horizon. */
  readonly loadOlder: () => void;
}

/** `ids`: the triggers whose fires to read, in list order; `undefined` while the trigger list has not loaded. */
export function useAllFires(api: StudioBridge, ids: readonly number[] | undefined): AllFiresView {
  const [state, setState] = useState<State>(() => ({ histories: readLast(api).histories, latest: new Map(), olderBusy: false, olderError: undefined }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const generation = useRef(0);
  const olderSeq = useRef(0);
  const olderInFlight = useRef(false);

  // The triggers as one comparable value: a new array with the same ids is not a change.
  const idsKey = ids === undefined ? undefined : ids.join(",");

  const refetch = useCallback(() => {
    const list = idsRef.current;
    if (list === undefined) return;
    generation.current += 1;
    const mine = generation.current;
    for (const id of list) {
      void readFires(api, id).then((reply) => {
        if (generation.current !== mine) return;
        setState((prev) => {
          const latest = new Map(prev.latest).set(id, reply);
          if (reply.kind !== "ok") return { ...prev, latest };
          const histories = new Map(prev.histories).set(id, mergeFirstPage(prev.histories.get(id), reply.body));
          return { ...prev, latest, histories };
        });
      });
    }
  }, [api]);

  useEffect(() => {
    if (idsKey === undefined) return;
    const known = new Set(idsKey === "" ? [] : idsKey.split(",").map(Number));
    // A trigger that is gone takes its history with it.
    setState((prev) => {
      const keeps = [...prev.histories.keys()].every((id) => known.has(id)) && [...prev.latest.keys()].every((id) => known.has(id));
      // A "Load older" in flight is dropped with the triggers it was for (`olderSeq` below), so it no longer holds the button busy.
      if (keeps && !prev.olderBusy) return prev;
      return {
        ...prev,
        histories: keeps ? prev.histories : new Map([...prev.histories].filter(([id]) => known.has(id))),
        latest: keeps ? prev.latest : new Map([...prev.latest].filter(([id]) => known.has(id))),
        olderBusy: false,
      };
    });
    olderSeq.current += 1;
    olderInFlight.current = false;
    refetch();
    return () => {
      // The answers in flight are dropped once the triggers change or the screen unmounts.
      generation.current += 1;
    };
  }, [idsKey, refetch]);

  useEffect(() => {
    recordLast(api, { histories: state.histories });
  }, [api, state.histories]);

  const loadOlder = useCallback(() => {
    if (olderInFlight.current) return;
    const current = stateRef.current.histories;
    const targets = nextPageTargets(current).flatMap((id) => {
      const cursor = current.get(id)?.cursor;
      return cursor === null || cursor === undefined ? [] : [{ id, cursor }];
    });
    if (targets.length === 0) return;
    olderInFlight.current = true;
    olderSeq.current += 1;
    const mine = olderSeq.current;
    setState((prev) => ({ ...prev, olderBusy: true, olderError: undefined }));
    void Promise.all(targets.map(async (target) => ({ ...target, reply: await readFires(api, target.id, target.cursor) }))).then((pages) => {
      if (olderSeq.current !== mine) return;
      olderInFlight.current = false;
      setState((prev) => {
        const histories = new Map(prev.histories);
        let error: string | undefined;
        for (const { id, cursor, reply } of pages) {
          if (reply.kind !== "ok") {
            error ??= reply.kind === "refused" ? reply.error : reply.message;
            continue;
          }
          // A refetch moved the cursor meanwhile: this page no longer follows that trigger's history.
          const held = histories.get(id);
          if (held !== undefined && held.cursor === cursor) histories.set(id, appendOlderPage(held, reply.body));
        }
        return { ...prev, histories, olderBusy: false, olderError: error };
      });
    });
  }, [api]);

  return useMemo(() => {
    let unreachable = false;
    let failure: string | undefined;
    for (const [id, reply] of state.latest) {
      if (reply.kind === "unreachable") unreachable = true;
      else if (reply.kind === "refused" || reply.kind === "failed") failure ??= failureDetail(`GET /triggers/${id}/fires`, reply);
    }
    // No triggers at all is an answer too: there is nothing to wait for.
    const answered = idsKey === "" || state.latest.size > 0 || state.histories.size > 0;
    return { histories: state.histories, answered, unreachable, failure, olderBusy: state.olderBusy, olderError: state.olderError, refetch, loadOlder };
  }, [state, idsKey, refetch, loadOlder]);
}
