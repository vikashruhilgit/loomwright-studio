// The screen contract for a kernel that does not answer. The shell draws the one red band (`KernelBand`)
// above the screen while the store reads `reconnecting` or `unreachable`; a screen that has data keeps its last
// `ok` data under it, marks it "last known", and turns every write off with `title="Needs the kernel"`.
//
// A screen whose own read answered status 0 while the store still reads live (the moment before the feed
// notices) draws `<KernelBand testId=... />` itself, but only when `!shellBand`, so exactly one band is on screen.
import type { StudioBridge } from "../api/contract";
import { useKernelConnection } from "../store/connection";

/** What a screen needs to know about the kernel's reach. */
export interface KernelReach {
  /** The shell is showing the band now (`reconnecting` or `unreachable`). */
  readonly shellBand: boolean;
  /** The kernel cannot be asked: `shellBand`, or no kernel installed. A screen keeps its last data and disables its writes. */
  readonly offline: boolean;
}

/** The mark on data kept from before the kernel went away. */
export const LAST_KNOWN = "last known";

/** `line` with ` · last known` appended while `offline`, else `line` unchanged. */
export function withLastKnown(line: string, offline: boolean): string {
  return offline ? `${line} · ${LAST_KNOWN}` : line;
}

/** Where the kernel is, for a screen: see `KernelReach`. */
export function useKernelReach(api: StudioBridge): KernelReach {
  const { state } = useKernelConnection(api);
  const shellBand = state === "reconnecting" || state === "unreachable";
  return { shellBand, offline: shellBand || state === "not_installed" };
}
