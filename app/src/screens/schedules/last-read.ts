// What Schedules last read from the kernel, held per bridge, beyond any one mount of the screen.
//
// The screen keeps its last data under the shell's band when the kernel stops. That has to survive leaving the
// screen and coming back while the kernel is still stopped, so the last good `GET /schedule` answer and the
// per-trigger firing histories live here (one holder per bridge, like the live store's own data), not in a hook's
// state. The title bar's count line (`./Subtitle.tsx`) reads the same holder: it is drawn by the shell, outside the
// screen, so it cannot share the screen's React state. The trigger list and the playbooks are the live store's own
// resources, which the store already keeps per bridge.
//
// Only `useScheduleRead` and `useAllFires` write here, and only when an answer lands that is still the newest.
import { useMemo, useSyncExternalStore } from "react";
import type { ScheduleResponse, StudioBridge } from "../../api/contract";
import type { History } from "./model";

export interface LastRead {
  /** The newest `ok` answer of `GET /schedule`, kept while later reads fail. */
  readonly schedule: ScheduleResponse | undefined;
  /** The newest answer to `GET /schedule` was status 0 (the kernel could not be asked). */
  readonly scheduleUnreachable: boolean;
  /** Each trigger's loaded firing history. */
  readonly histories: ReadonlyMap<number, History>;
}

const NOTHING: LastRead = Object.freeze({ schedule: undefined, scheduleUnreachable: false, histories: new Map<number, History>() });

interface Holder {
  value: LastRead;
  readonly listeners: Set<() => void>;
}

const held = new WeakMap<StudioBridge, Holder>();

function holderFor(api: StudioBridge): Holder {
  let holder = held.get(api);
  if (holder === undefined) {
    holder = { value: NOTHING, listeners: new Set() };
    held.set(api, holder);
  }
  return holder;
}

/** What `api` last read (nothing, before the first answer). */
export function readLast(api: StudioBridge): LastRead {
  return holderFor(api).value;
}

/** Replace the named parts of what `api` last read and tell every reader. */
export function recordLast(api: StudioBridge, change: Partial<LastRead>): void {
  const holder = holderFor(api);
  holder.value = { ...holder.value, ...change };
  for (const listener of [...holder.listeners]) listener();
}

function subscribe(api: StudioBridge): (listener: () => void) => () => void {
  return (listener) => {
    const holder = holderFor(api);
    holder.listeners.add(listener);
    return () => {
      holder.listeners.delete(listener);
    };
  };
}

/** What `api` last read, re-rendering when it changes. */
export function useLastRead(api: StudioBridge): LastRead {
  const listen = useMemo(() => subscribe(api), [api]);
  return useSyncExternalStore(listen, () => holderFor(api).value);
}
