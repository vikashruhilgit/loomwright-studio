// The open trigger's "Firing history" (phase 7 item 05): the mockup's When · Trigger ·
// Result table with its "All · N" / "Not fired · N" chips and a "Load older" control
// driven by the route's `next_before` cursor. Consecutive repeats of one kind and
// reason are one row with a count and the first and last time (a busy poll
// that is missed every two minutes would otherwise bury the page); the grouping runs
// over every page loaded, so a group continues across "Load older".
//
// Each missed row shows a label and, beneath it in mono, the reason the kernel
// recorded, verbatim. A missed poll with no connector links to Integrations, whose own
// screen holds the action; this screen holds none. Every string from the kernel (the
// reason, the trigger's name) is untrusted: a React text child, never markup.
//
// Rows are a fixed height and keyed by their oldest fire's id, so a refetch that
// changes a group's count changes text inside the row and moves nothing.
import { type ReactNode, type Ref, useEffect, useRef } from "react";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import type { Trigger } from "../../api/contract";
import { Skeleton } from "./parts";
import type { HistoryView } from "./useHistory";
import {
  type FireGroup,
  type HistoryFilter,
  INTEGRATIONS_HASH,
  NO_REASON_TEXT,
  SCHEDULES_TEST_IDS as IDS,
  countFires,
  failureDetail,
  filterGroups,
  fireTime,
  fireView,
  groupFires,
  linksToIntegrations,
  safe,
} from "./model";

export interface HistoryProps {
  readonly trigger: Trigger;
  /** The trigger's name (its playbook's, else its text). */
  readonly name: string;
  readonly view: HistoryView;
  readonly filter: HistoryFilter;
  readonly onFilter: (filter: HistoryFilter) => void;
  /** The kernel cannot be asked: every control that needs it is disabled. */
  readonly offline: boolean;
  readonly now: Date;
  /** The "Not fired" chip, for the palette's "Show missed fires" to focus. */
  readonly missedChipRef?: Ref<HTMLButtonElement>;
}

/** The Trigger cell's second line: one fire's due time and session, or a group's count and span. */
function caption(trigger: Trigger, group: FireGroup, now: Date): string {
  if (group.count > 1) return `${safe(trigger.kind)} · ${group.count} times, ${fireTime(group.oldest.at, now)} to ${fireTime(group.newest.at, now)}`;
  const fire = group.newest;
  const due = fire.scheduled_at === null ? "" : ` · due ${fireTime(fire.scheduled_at, now)}`;
  const session = fire.session_id === null ? "" : ` · session #${fire.session_id}`;
  return `${safe(trigger.kind)}${due}${session}`;
}

function Row({ trigger, name, group, first, now }: { readonly trigger: Trigger; readonly name: string; readonly group: FireGroup; readonly first: boolean; readonly now: Date }) {
  const result = fireView(group.newest);
  const missed = group.kind === "trigger_missed";
  return (
    <tr
      className="schedules-fire"
      data-testid={IDS.fire}
      data-kind={group.kind}
      data-reason={group.reason ?? ""}
      data-count={group.count}
      data-nav-row=""
      tabIndex={first ? 0 : -1}
    >
      <td className="schedules-tn">
        <time dateTime={group.newest.at}>{fireTime(group.newest.at, now)}</time>
      </td>
      <td>
        <b className="schedules-clip">{name}</b>
        <span className="schedules-cap schedules-clip">{caption(trigger, group, now)}</span>
        {linksToIntegrations(group.newest) ? (
          <a className="schedules-link" href={INTEGRATIONS_HASH} data-testid={IDS.fireLink}>
            Connect it in Integrations
          </a>
        ) : null}
      </td>
      <td>
        <span className="schedules-result">
          <span data-testid={IDS.fireBadge}>
            <Badge tone={result.tone}>{result.label}</Badge>
          </span>
          {group.count > 1 ? (
            <span className="schedules-count">
              <span aria-hidden="true">{`×${group.count}`}</span>
              <span className="schedules-sr-only">{`${group.count} times`}</span>
            </span>
          ) : null}
        </span>
        {missed ? (
          <span className="schedules-mono schedules-clip schedules-reason" data-testid={IDS.fireReason}>
            {group.reason === null ? NO_REASON_TEXT : safe(group.reason)}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function History({ trigger, name, view, filter, onFilter, offline, now, missedChipRef }: HistoryProps) {
  const { history, latest } = view;
  const fires = history?.fires ?? [];
  const groups = filterGroups(groupFires(fires), filter);
  const more = history?.cursor !== null && history?.cursor !== undefined;
  // "50+" while older pages exist: the count is of what is loaded.
  const countText = (f: HistoryFilter) => `${countFires(fires, f)}${more ? "+" : ""}`;
  const section = useRef<HTMLElement>(null);
  // "Load older" unmounts at the last page; when that click was the user's, focus moves to the first row it added
  // (else the pressed filter chip) instead of falling to the page. Armed only by the click, so a live refetch never moves focus.
  const resume = useRef<number | undefined>(undefined);
  const busy = view.olderBusy;
  useEffect(() => {
    if (busy || resume.current === undefined) return;
    const before = resume.current;
    resume.current = undefined;
    if (more) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const root = section.current;
    const added = root?.querySelectorAll<HTMLElement>("[data-nav-row]")[before];
    (added ?? root?.querySelector<HTMLElement>('.schedules-chip[aria-pressed="true"]'))?.focus();
  }, [busy, more]);
  const failed = latest !== undefined && (latest.kind === "refused" || latest.kind === "failed") ? latest : undefined;

  let body: ReactNode;
  if (history === undefined) {
    if (latest === undefined) body = <Skeleton testId={IDS.historyLoading} what="the firing history" />;
    else if (latest.kind === "unreachable") {
      body = (
        <p className="schedules-cap" data-testid={IDS.historyError}>
          The firing history is unavailable while the kernel is unreachable.
        </p>
      );
    } else if (failed !== undefined) {
      body = (
        <p className="schedules-notice" data-tone="danger" role="alert" data-testid={IDS.historyError}>
          {`Couldn't load the firing history: ${failureDetail(`GET /triggers/${trigger.id}/fires`, failed)}`}
        </p>
      );
    } else body = <Skeleton testId={IDS.historyLoading} what="the firing history" />;
  } else if (groups.length === 0) {
    body = (
      <p className="schedules-cap" data-testid={IDS.historyEmpty}>
        {filter === "missed" && fires.length > 0 ? "No missed fires in the history loaded so far." : "Nothing has fired or been missed yet."}
      </p>
    );
  } else {
    body = (
      <table className="schedules-table" data-testid={IDS.table} data-nav-group="history">
        <caption className="schedules-sr-only">Firing history</caption>
        <colgroup>
          <col className="schedules-c1" />
          <col />
          <col className="schedules-c3" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Trigger</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, index) => (
            <Row key={group.key} trigger={trigger} name={name} group={group} first={index === 0} now={now} />
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <section ref={section} className="schedules-sec" aria-labelledby="schedules-history-h" data-testid={IDS.history}>
      <div className="schedules-sech">
        <h3 className="schedules-label" id="schedules-history-h">
          Firing history
        </h3>
        <span className="schedules-spacer" />
        <span className="schedules-chips" role="group" aria-label="Filter history">
          <button type="button" className="schedules-chip" aria-pressed={filter === "all"} onClick={() => onFilter("all")} data-testid={IDS.filterAll}>
            {`All · ${countText("all")}`}
          </button>
          <button type="button" className="schedules-chip" aria-pressed={filter === "missed"} onClick={() => onFilter("missed")} ref={missedChipRef} data-testid={IDS.filterMissed}>
            {`Not fired · ${countText("missed")}`}
          </button>
        </span>
      </div>
      {failed !== undefined && history !== undefined ? (
        <p className="schedules-notice" data-tone="danger" role="alert" data-testid={IDS.historyError}>
          {`Couldn't refresh the firing history: ${failureDetail(`GET /triggers/${trigger.id}/fires`, failed)}. The rows below are the last read.`}
        </p>
      ) : null}
      {body}
      {more ? (
        <div className="schedules-more">
          <Button size="row" variant="secondary" loading={view.olderBusy} disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={() => {
              resume.current = groups.length;
              view.loadOlder();
            }}
            data-testid={IDS.loadOlder}>
            Load older
          </Button>
          {view.olderError === undefined ? null : (
            <span className="schedules-cap" role="alert">{`Couldn't load older fires: ${view.olderError}`}</span>
          )}
        </div>
      ) : null}
      <p className="schedules-cap">A fire that did not happen keeps its reason, written to the audit log when it was due.</p>
    </section>
  );
}
