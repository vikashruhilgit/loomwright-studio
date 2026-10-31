// The two reads behind Settings: `GET /settings` (the kernel's view, read on mount and on
// demand) and the app's own preferences (`window.api.prefs`, the main process's, which
// need no kernel).
//
// The kernel's answer is a `Reply` (`../schedules/model.ts`): the bridge's "kernel
// unreachable" (status 0) stays apart from a refusal, because an unreachable kernel is
// never "nothing to show". A thrown IPC call is a `failed` reply, never an exception. The
// last `ok` view is kept until a newer one lands, so a refetch never empties the screen.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppPreferences, AppPreferencesPatch, SettingsResponse, StudioBridge } from "../../api/contract";
import { NO_ANSWER_TEXT, NOT_READ, type Read, type Reply, nextRead, replyOf } from "../schedules/model";
import { type SettingsView, viewReply } from "./model";

/** `GET /settings`, as a reply holding the view of its known fields. */
export async function readSettings(api: StudioBridge): Promise<Reply<SettingsView>> {
  try {
    return viewReply(replyOf(await api.request<SettingsResponse>({ method: "GET", path: "/settings" })));
  } catch {
    // The IPC call itself failed (no answer from the main process): said as such, never swallowed.
    return { kind: "failed", message: NO_ANSWER_TEXT };
  }
}

/** `GET /settings`: on mount and on demand. The last `ok` view is kept until a newer one lands; an answer older than the latest request is dropped. */
export function useSettingsRead(api: StudioBridge): { readonly read: Read<SettingsView>; readonly refetch: () => void } {
  const [read, setRead] = useState<Read<SettingsView>>(NOT_READ);
  const generation = useRef(0);

  const refetch = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    void readSettings(api).then((reply) => {
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

/** The app's preferences one control changes. */
export type PrefKey = "login" | "notifications" | "theme";

export interface Preferences {
  /** The bridge has a `prefs` member at all (a bridge without one cannot read or change them). */
  readonly available: boolean;
  /** What the main process last reported; `undefined` until it answered. */
  readonly prefs: AppPreferences | undefined;
  /** A call to the main process failed (no answer). */
  readonly failed: boolean;
  /** The last launch-at-login change was asked and the OS read-back says it did not take. */
  readonly loginRefused: boolean;
  /** The controls whose change is in flight. */
  readonly busy: ReadonlySet<PrefKey>;
  /** Apply `patch` for `key`; one change per control at a time. The answer is the state read back from the main process. */
  readonly change: (key: PrefKey, patch: AppPreferencesPatch) => Promise<void>;
  /** Reveal the main process's own data folder in Finder; `false` when it could not be opened. Sends no path. */
  readonly reveal: () => Promise<boolean>;
}

export function usePreferences(api: StudioBridge): Preferences {
  const bridge = api.prefs;
  const [prefs, setPrefs] = useState<AppPreferences | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [loginRefused, setLoginRefused] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<PrefKey>>(new Set());
  const inFlight = useRef(new Set<PrefKey>());

  useEffect(() => {
    if (bridge === undefined) return;
    let current = true;
    bridge.get().then(
      (answer) => {
        if (current) setPrefs(answer);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [bridge]);

  const change = useCallback(
    async (key: PrefKey, patch: AppPreferencesPatch): Promise<void> => {
      if (bridge === undefined || inFlight.current.has(key)) return;
      inFlight.current.add(key);
      setBusy(new Set(inFlight.current));
      try {
        const next = await bridge.set(patch);
        setPrefs(next);
        setFailed(false);
        if (patch.launchAtLogin !== undefined) setLoginRefused(next.launchAtLogin.enabled !== patch.launchAtLogin);
      } catch {
        setFailed(true);
      } finally {
        inFlight.current.delete(key);
        setBusy(new Set(inFlight.current));
      }
    },
    [bridge],
  );

  const reveal = useCallback(async (): Promise<boolean> => {
    try {
      return (await bridge?.revealDataDir()) === true;
    } catch {
      return false;
    }
  }, [bridge]);

  return { available: bridge !== undefined, prefs, failed, loginRefused, busy, change, reveal };
}
