// Where the kernel is, for the shell's designed states, backed by the live
// store (`./store.ts`: REST plus the event feed, with resubscribe and
// backoff). The view is the kernel's own answer, never a guess:
//
// - `connecting` until the first attempt succeeds (the main process's
//   `GET /status` answered, then the feed proved itself open);
// - `live` while the feed is open;
// - `reconnecting` once it was live and is not now, with `lastUpdated`, the
//   time the store last received data from the kernel (the reconnecting band);
// - `unreachable` / `not_installed`: the bridge's answer, passed through
//   unchanged (its own `reason` / `dataDir`), before the store was ever live.
import type { StudioBridge } from "../api/contract";
import { useLiveStore } from "./react";
import type { LiveConnection } from "./store";

export type ConnectionView = LiveConnection;

/** The live store's connection view for `api`. */
export function useKernelConnection(api: StudioBridge): ConnectionView {
  return useLiveStore(api).connection;
}
