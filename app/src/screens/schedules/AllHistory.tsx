// The "Firing history" of every trigger (phase 7 item 16), the right pane's default as in the mockup
// (`docs/design/mockups/gui-v2.html`, `schedulesScreen`): one When · Trigger · Result table, newest first by event
// id across all triggers, each row naming its trigger, with the "All · N" / "Not fired · N" chips and a "Load older"
// control. The merge, the horizon that keeps the paging honest and the grouping are the pure `./all-fires.ts`; the
// reads (one first page per trigger) are `./useAllFires.ts`. Choosing a trigger in the list swaps this for that
// trigger's own detail and history (`./History.tsx`).
//
// Consecutive repeats of one trigger, kind and reason are one row with a count. Each missed row shows its label and,
// beneath it in mono, the reason the kernel recorded, verbatim; a trigger whose playbook is off has its
// `playbook_not_enabled` misses read "playbook off: fires are skipped" (`reasonView`). A missed poll with no connector
// links to Integrations, whose own screen holds the action; this screen holds none. Every string from the kernel
// (the reason, a trigger's name) is untrusted: a React text child, never markup.
//
// Rows are a fixed height and keyed by their oldest fire's id, so a refetch moves nothing already shown. Only one
// history table is mounted at a time, so this one shares the ids of `./History.tsx` (table, chips, badges, reasons,
// "Load older") and adds its own for its rows and the trigger's name.
import { type ReactNode, type Ref, useEffect, useMemo, useRef } from "react";
import type { PlaybookListing, Trigger } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { type AllFireGroup, countAllFires, filterAllGroups, groupAllFires, hasOlder, mergeFires } from "./all-fires";
import { caption } from "./History";
import { type HistoryFilter, INTEGRATIONS_HASH, NO_REASON_TEXT, SCHEDULES_TEST_IDS as IDS, fireTime, fireView, linksToIntegrations, safe, triggerName } from "./model";
import { Skeleton } from "./parts";
import type { AllFiresView } from "./useAllFires";

export interface AllHistoryProps {
  /** The trigger list; `undefined` while it has not loaded. */
  readonly triggers: readonly Trigger[] | undefined;
  /** The trigger list could not be read: the history, which is read per trigger, cannot start. */
  readonly triggersFailed: boolean;
  readonly playbooks: readonly Pick<PlaybookListing, "slug" | "name">[] | undefined;
  readonly view: AllFiresView;
  readonly filter: HistoryFilter;
  readonly onFilter: (filter: HistoryFilter) => void;
  /** The kernel cannot be asked: every control that needs it is disabled. */
  readonly offline: boolean;
  readonly now: Date;
  /** The "Not fired" chip, for the palette's "Show missed fires" to focus. */
  readonly missedChipRef?: Ref<HTMLButtonElement>;
}

function Row({ trigger, name, group, first, now }: { readonly trigger: Trigger; readonly name: string; readonly group: AllFireGroup; readonly first: boolean; readonly now: Date }) {
  const result = fireView(group.newest);
  const missed = group.kind === "trigger_missed";
  return (
    <tr
      className="schedules-fire"
      data-testid={IDS.allFire}
      data-trigger={group.trigger_id}
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
        <b className="schedules-clip" data-testid={IDS.fireTrigger} title={name}>
          {name}
        </b>
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

export function AllHistory({ triggers, triggersFailed, playbooks, view, filter, onFilter, offline, now, missedChipRef }: AllHistoryProps) {
  const { histories } = view;
  const merged = useMemo(() => mergeFires(histories), [histories]);
  const groups = useMemo(() => filterAllGroups(groupAllFires(merged), filter), [merged, filter]);
  const more = hasOlder(histories);
  // "50+" while older pages exist: the count is of what is loaded and shown.
  const countText = (f: HistoryFilter) => `${countAllFires(merged, f)}${more ? "+" : ""}`;
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

  const rowsOf = (group: AllFireGroup): { readonly trigger: Trigger; readonly name: string } | undefined => {
    const trigger = triggers?.find((t) => t.id === group.trigger_id);
    return trigger === undefined ? undefined : { trigger, name: triggerName(trigger, playbooks) };
  };

  let body: ReactNode;
  if (triggers === undefined) {
    body =
      triggersFailed ? (
        <p className="schedules-cap" data-testid={IDS.historyError}>
          The firing history is read per trigger, and the trigger list could not be read.
        </p>
      ) : (
        <Skeleton testId={IDS.historyLoading} what="the firing history" />
      );
  } else if (!view.answered) {
    body = <Skeleton testId={IDS.historyLoading} what="the firing history" />;
  } else if (histories.size === 0 && triggers.length > 0) {
    // Nothing was ever read of any trigger: say why instead of "nothing has fired".
    body =
      view.unreachable ? (
        <p className="schedules-cap" data-testid={IDS.historyError}>
          The firing history is unavailable while the kernel is unreachable.
        </p>
      ) : view.failure !== undefined ? (
        <p className="schedules-notice" data-tone="danger" role="alert" data-testid={IDS.historyError}>
          {`Couldn't load the firing history: ${view.failure}`}
        </p>
      ) : (
        <Skeleton testId={IDS.historyLoading} what="the firing history" />
      );
  } else if (groups.length === 0) {
    body = (
      <p className="schedules-cap" data-testid={IDS.historyEmpty}>
        {filter === "missed" && merged.length > 0 ? "No missed fires in the history loaded so far." : "Nothing has fired or been missed yet."}
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
          {groups.map((group, index) => {
            const row = rowsOf(group);
            return row === undefined ? null : <Row key={group.key} trigger={row.trigger} name={row.name} group={group} first={index === 0} now={now} />;
          })}
        </tbody>
      </table>
    );
  }

  const stale = histories.size > 0 && view.failure !== undefined;
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
      {stale ? (
        <p className="schedules-notice" data-tone="danger" role="alert" data-testid={IDS.historyError}>
          {`Couldn't refresh the firing history: ${view.failure}. The rows below are the last read.`}
        </p>
      ) : null}
      {body}
      {more ? (
        <div className="schedules-more">
          <Button
            size="row"
            variant="secondary"
            loading={view.olderBusy}
            disabled={offline}
            title={offline ? "Needs the kernel" : undefined}
            onClick={() => {
              resume.current = groups.length;
              view.loadOlder();
            }}
            data-testid={IDS.loadOlder}
          >
            Load older
          </Button>
          {view.olderError === undefined ? null : <span className="schedules-cap" role="alert">{`Couldn't load older fires: ${view.olderError}`}</span>}
        </div>
      ) : null}
      <p className="schedules-cap">A fire that did not happen keeps its reason, written to the audit log when it was due.</p>
    </section>
  );
}
