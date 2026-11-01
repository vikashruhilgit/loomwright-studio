// Where the kernel is, for the shell's designed states, backed by the live
// store (`./store.ts`: REST plus the event feed, with resubscribe and
// backoff). The view is the kernel's own answer, never a guess:
//
// - `connecting` until the first attempt succeeds (the main process's
//   `GET /status` answered, then the feed proved itself open);
// - `live` while the feed is open;
// - `reconnecting` once it was live and is not now, with `lastUpdated`, the
//   time the store last received data from the kernel;
// - `unreachable` / `not_installed`: the bridge's answer, passed through
//   unchanged (its own `reason` / `dataDir`), before the store was ever live.
//
// The shell shows the one red band for `reconnecting` and `unreachable`; a
// screen reads that through `useKernelReach` (`../shell/last-known.ts`), whose
// type is re-exported here (types only, so the two files do not import each other at run time).
import type { StudioBridge } from "../api/contract";
import { useLiveStore } from "./react";
import type { LiveConnection } from "./store";

export type ConnectionView = LiveConnection;
export type { KernelReach } from "../shell/last-known";

/** The live store's connection view for `api`. */
export function useKernelConnection(api: StudioBridge): ConnectionView {
  return useLiveStore(api).connection;
}
