// `GET /audit`, one page at a time: the page on screen, the cursor stack behind "Older" and
// "Newer", and a refetch that keeps the rows on screen until the answer lands (no skeleton, so
// no layout shift). The same hook serves the overview's three latest events (one fixed page, no
// paging) and the full log (filters, 8 rows a page).
//
// Keyset paging has no total, so the only state is the cursor stack (`./model.ts` `Paging`):
// "Older" pushes the shown page's `next_before`, "Newer" pops. A change of filter (`key`) starts
// at the first page. An answer older than the latest request is dropped, and a failed read never
// drops the page held: the screen shows it as the last known log.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditResponse, StudioBridge } from "../../api/contract";
import { FIRST_PAGE, currentCursor, nextCursor, pageNewer, pageNumber, pageOlder } from "./model";
import type { Paging, Reply } from "./model";
import { send } from "./useUsage";

/** The query for the page that `before` opens, at `nowMs`. */
export type AuditBuild = (before: string | undefined, nowMs: number) => Record<string, string>;

export interface AuditOptions {
  /** Nothing is read while false (the view is not on screen). */
  readonly enabled: boolean;
  /** The identity of the filter: a different key is a different log, from its first page. */
  readonly key: string;
  readonly build: AuditBuild;
}

interface Shown {
  readonly page: AuditResponse;
  /** The page number it is (1 for the first). */
  readonly number: number;
  /** The filter it belongs to. */
  readonly key: string;
}

export interface AuditView {
  /** The page on screen: the last good answer, `undefined` until one lands. */
  readonly shown: Shown | undefined;
  /** The newest answer to a read (a later failure does not drop `shown`). */
  readonly latest: Reply<AuditResponse> | undefined;
  /** A read is in flight. */
  readonly busy: boolean;
  /** The page being asked for is not the one on screen yet (an "Older" or "Newer" is in flight): paging waits. */
  readonly moving: boolean;
  /** The cursors behind the page being asked for. */
  readonly paging: Paging;
  readonly firstPage: boolean;
  /** The cursor of the next older page of `shown`, `null` on the last page. */
  readonly next: string | null;
  /** Read the page again (what is on screen stays until it lands). */
  readonly refetch: () => void;
  readonly older: () => void;
  readonly newer: () => void;
}

interface Held {
  readonly shown: Shown | undefined;
  readonly latest: Reply<AuditResponse> | undefined;
}

export function useAudit(api: StudioBridge, { enabled, key, build }: AuditOptions): AuditView {
  const [state, setState] = useState<{ readonly key: string; readonly paging: Paging }>({ key, paging: FIRST_PAGE });
  const [held, setHeld] = useState<Held>({ shown: undefined, latest: undefined });
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const buildRef = useRef(build);
  buildRef.current = build;

  // A paging state from another filter is not this log's: it starts again at the first page.
  const paging = state.key === key ? state.paging : FIRST_PAGE;
  const cursor = currentCursor(paging);
  const number = pageNumber(paging);

  const read = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    setBusy(true);
    void send<AuditResponse>(api, { method: "GET", path: "/audit", query: buildRef.current(cursor, Date.now()) }).then((reply) => {
      if (generation.current !== mine) return;
      setBusy(false);
      setHeld((prev) => ({ shown: reply.kind === "ok" ? { page: reply.body, number, key } : prev.shown, latest: reply }));
    });
  }, [api, cursor, number, key]);

  useEffect(() => {
    if (!enabled) return;
    read();
    return () => {
      // The answer in flight is dropped once the page, the filter or the screen changes.
      generation.current += 1;
      setBusy(false);
    };
  }, [enabled, key, read]);

  const next = nextCursor(held.shown?.page);
  const shownHere = held.shown !== undefined && held.shown.number === number && held.shown.key === key;

  const older = useCallback(() => {
    if (!shownHere || next === null) return;
    setState({ key, paging: pageOlder(paging, next) });
  }, [key, next, paging, shownHere]);

  const newer = useCallback(() => {
    if (!shownHere) return;
    setState({ key, paging: pageNewer(paging) });
  }, [key, paging, shownHere]);

  return { shown: held.shown, latest: held.latest, busy, moving: !shownHere, paging, firstPage: number === 1, next, refetch: read, older, newer };
}
