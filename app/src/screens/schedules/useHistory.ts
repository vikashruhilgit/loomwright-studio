// The open trigger's firing history (`GET /triggers/:id/fires`): the first page on
// open, again whenever the screen is told to refetch, and older pages on demand.
//
// A refetch keeps the history on screen until the answer lands (no skeleton, so no
// layout shift) and keeps the older pages already loaded when the fresh first page
// touches them (`mergeFirstPage`). An answer older than the latest request is
// dropped; so is an older page whose cursor is no longer the history's. A failed
// read never drops what is held: the screen shows it as the last known history.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioBridge, TriggerFiresResponse } from "../../api/contract";
import { readFires } from "./actions";
import { type History, type Reply, appendOlderPage, mergeFirstPage } from "./model";

interface Held {
  /** The trigger this state belongs to; a different open trigger starts empty. */
  readonly id: number | undefined;
  readonly history: History | undefined;
  /** The newest answer to a first-page read. */
  readonly latest: Reply<TriggerFiresResponse> | undefined;
  readonly olderBusy: boolean;
  /** Why the last "Load older" did not land. */
  readonly olderError: string | undefined;
}

const NONE: Held = { id: undefined, history: undefined, latest: undefined, olderBusy: false, olderError: undefined };

export interface HistoryView {
  readonly history: History | undefined;
  readonly latest: Reply<TriggerFiresResponse> | undefined;
  readonly olderBusy: boolean;
  readonly olderError: string | undefined;
  /** Read the first page again (the history stays on screen until it lands). */
  readonly refetch: () => void;
  /** Read the next older page, when there is one. */
  readonly loadOlder: () => void;
}

export function useHistory(api: StudioBridge, triggerId: number | undefined): HistoryView {
  const [held, setHeld] = useState<Held>(NONE);
  const heldRef = useRef(held);
  heldRef.current = held;
  const generation = useRef(0);
  const olderSeq = useRef(0);
  const olderInFlight = useRef(false);

  const refetch = useCallback(() => {
    if (triggerId === undefined) return;
    generation.current += 1;
    const mine = generation.current;
    void readFires(api, triggerId).then((reply) => {
      if (generation.current !== mine) return;
      setHeld((prev) => {
        const base: Held = prev.id === triggerId ? prev : { ...NONE, id: triggerId };
        return { ...base, history: reply.kind === "ok" ? mergeFirstPage(base.history, reply.body) : base.history, latest: reply };
      });
    });
  }, [api, triggerId]);

  useEffect(() => {
    olderSeq.current += 1;
    olderInFlight.current = false;
    setHeld((prev) => (prev.id === triggerId ? prev : { ...NONE, id: triggerId }));
    refetch();
    return () => {
      // The answer in flight is dropped once the trigger changes or the screen unmounts.
      generation.current += 1;
    };
  }, [refetch, triggerId]);

  const loadOlder = useCallback(() => {
    if (triggerId === undefined || olderInFlight.current) return;
    const current = heldRef.current;
    const cursor = current.id === triggerId ? current.history?.cursor : undefined;
    if (cursor === undefined || cursor === null) return;
    olderInFlight.current = true;
    olderSeq.current += 1;
    const mine = olderSeq.current;
    setHeld((prev) => (prev.id === triggerId ? { ...prev, olderBusy: true, olderError: undefined } : prev));
    void readFires(api, triggerId, cursor).then((reply) => {
      if (olderSeq.current === mine) olderInFlight.current = false;
      setHeld((prev) => {
        if (prev.id !== triggerId) return prev;
        if (reply.kind !== "ok") return { ...prev, olderBusy: false, olderError: reply.kind === "refused" ? reply.error : reply.message };
        // A refetch moved the cursor meanwhile: this page no longer follows the history.
        if (prev.history === undefined || prev.history.cursor !== cursor) return { ...prev, olderBusy: false };
        return { ...prev, olderBusy: false, history: appendOlderPage(prev.history, reply.body) };
      });
    });
  }, [api, triggerId]);

  const mine = held.id === triggerId ? held : NONE;
  return { history: mine.history, latest: mine.latest, olderBusy: mine.olderBusy, olderError: mine.olderError, refetch, loadOlder };
}
