// The list's two data cells (phase 7 item 04, item 15): Last run and Tokens today. Each is two lines (a value and
// a caption), reserved before the answer arrives so a row never changes height.
//
// What a cell says is the kernel's own answer, never a guess:
// - an answer held from before the kernel went away stays, with the caption "last known" while the kernel cannot
//   be asked (`offline`); the last `ok` answer is kept by `./useHistory.ts`, also across a remount;
// - no answer ever held reads "unknown": offline with the caption "last known: none", live with "could not be read"
//   (the kernel answered, and refused);
// - a playbook the usage answer does not list reads "unknown", never 0.
// Tokens are counted figures, never dollars (D26).
import type { ReactNode } from "react";
import type { PlaybookListing, PlaybookRun } from "../../api/contract";
import { LAST_KNOWN } from "../../shell/last-known";
import { when } from "../chat/model";
import { COULD_NOT_READ, LAST_KNOWN_NONE, NO_RUNS, UNKNOWN, runKindWord, tokensTodayText } from "./model";
import { RunStatus } from "./parts";
import type { LastRun, Read } from "./useHistory";

const READING = "reading…";

function Cell({ value, caption }: { readonly value: ReactNode; readonly caption: ReactNode }) {
  return (
    <div className="pb-cell">
      <span className="pb-tn">{value}</span>
      <span className="pb-cap">{caption}</span>
    </div>
  );
}

/** The caption of an "unknown" value: why there is no value to show. */
function unknownCaption(offline: boolean): string {
  return offline ? LAST_KNOWN_NONE : COULD_NOT_READ;
}

/** The newest run's start, with its kind and status; "last known" in place of those while the kernel cannot be asked. */
export function LastRunCell({ read, offline }: { readonly read: LastRun | undefined; readonly offline: boolean }) {
  if (read === undefined || !read.settled) return <Cell value={READING} caption="" />;
  if (read.data === undefined) return <Cell value={UNKNOWN} caption={unknownCaption(offline)} />;
  if (read.data === null) return <Cell value={NO_RUNS} caption={offline ? LAST_KNOWN : ""} />;
  const run: PlaybookRun = read.data;
  return (
    <Cell
      value={<time dateTime={run.started}>{when(run.started)}</time>}
      caption={
        offline ? (
          LAST_KNOWN
        ) : (
          <>
            {runKindWord(run.kind)} · <RunStatus status={run.status} />
          </>
        )
      }
    />
  );
}

/**
 * Tokens counted today against the playbook's own daily limit ("38.2k of 200k"), or the figure alone with
 * "no limit set". `read` is the usage answer's tokens by slug.
 */
export function TokensTodayCell({ playbook, read, offline }: { readonly playbook: PlaybookListing; readonly read: Read<ReadonlyMap<string, number>> | undefined; readonly offline: boolean }) {
  if (read === undefined || !read.settled) return <Cell value={READING} caption="" />;
  if (read.data === undefined) return <Cell value={UNKNOWN} caption={unknownCaption(offline)} />;
  const today = read.data.get(playbook.slug);
  if (today === undefined) return <Cell value={UNKNOWN} caption={offline ? LAST_KNOWN : "not listed"} />;
  const text = tokensTodayText(today, playbook.token_limit_per_day);
  return <Cell value={text.value} caption={offline ? LAST_KNOWN : text.caption} />;
}
