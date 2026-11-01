// The owner's home folder from the bridge's read-only `homeDir` (main answers `app.getPath("home")`),
// for `formatHomePath`. `undefined` until it answers, when the bridge has no such member (a test
// fake), when the call fails, or when the answer is not a non-empty string: the caller then shows the
// path in full. Asked once per bridge; the home folder does not change while the window is open.
import { useEffect, useState } from "react";
import type { StudioBridge } from "../api/contract";

export function useHomeDir(api: StudioBridge): string | undefined {
  const [home, setHome] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setHome(undefined);
    if (api.homeDir === undefined) return undefined;
    void (async () => {
      try {
        const answer = await api.homeDir?.();
        if (alive && typeof answer === "string" && answer !== "") setHome(answer);
      } catch {
        // A failed call leaves home unknown: the path shows in full.
      }
    })();
    return () => {
      alive = false;
    };
  }, [api]);
  return home;
}
