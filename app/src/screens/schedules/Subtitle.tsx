// The title bar's count line for Schedules & triggers (phase 7 item 16): "5 upcoming · 4 triggers on", declared as
// `screen.Subtitle` in `./index.tsx` and drawn by the shell beside the title, as the mockup's `<span class="cap">`
// after the `<h1>`. The shell draws it outside the screen, so it reads what the screen last read from
// `./last-read.ts` (the schedule) and the live store's own `triggers` resource, never the screen's React state.
//
// While the kernel cannot be asked it keeps the last count and ends it in " · last known" (`withLastKnown`). It renders
// nothing before the first answer, so the title bar shows the title alone. The text carries `IDS.summary`, the id the
// count line has always had, so a check on it follows the line to the title bar.
import type { StudioBridge } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import { useKernelReach, withLastKnown } from "../../shell/last-known";
import { useResource } from "../../store/react";
import { useLastRead } from "./last-read";
import { SCHEDULES_TEST_IDS as IDS, summaryText } from "./model";

/** The count line for `api`'s kernel; `Subtitle` is this on the window's own bridge. */
export function SubtitleFor({ api }: { readonly api: StudioBridge }) {
  const last = useLastRead(api);
  const triggersRes = useResource("triggers", api);
  const { offline } = useKernelReach(api);
  const entries = last.schedule?.entries;
  if (entries === undefined) return null;
  const triggers = triggersRes?.data?.triggers;
  const on = (triggers ?? []).filter((t) => t.enabled).length;
  const text = entries.length === 0 && triggers !== undefined && triggers.length === 0 ? "nothing scheduled" : withLastKnown(summaryText(entries.length, on, false), offline || last.scheduleUnreachable);
  return <span data-testid={IDS.summary}>{text}</span>;
}

/** The shell mounts this with no props: a window with no bridge has no kernel to count, so it draws nothing. */
export function Subtitle() {
  const api = getBridge() as StudioBridge | undefined;
  return api === undefined ? null : <SubtitleFor api={api} />;
}
