// Where the kernel is, for the shell's designed states: a stub poll. Phase 5
// item 12 replaces it with the live store (REST plus the event feed, with
// connecting / live / reconnecting states), in this directory, so the shell
// never needs an edit.
import { useEffect, useState } from "react";
import type { KernelConnectionState, StudioBridge } from "../api/contract";

export type ConnectionView = { readonly state: "checking" } | KernelConnectionState;

/** How often the stub re-checks: the band says the window reconnects on its own. */
export const CONNECTION_POLL_MS = 5_000;

/** Asks the main process where the kernel is, now and every `intervalMs`. */
export function useKernelConnection(api: StudioBridge, intervalMs: number = CONNECTION_POLL_MS): ConnectionView {
  const [view, setView] = useState<ConnectionView>({ state: "checking" });
  useEffect(() => {
    let live = true;
    const check = (): void => {
      api.connection().then(
        (state) => {
          if (live) setView(state);
        },
        () => {
          if (live) setView({ state: "unreachable", reason: "connection_failed" });
        },
      );
    };
    check();
    const timer = setInterval(check, intervalMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, intervalMs]);
  return view;
}
