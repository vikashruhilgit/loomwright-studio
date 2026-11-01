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
import { type ReactNode, type Ref, useMemo } from "react";
import type { PlaybookListing, Trigger } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { type AllFireGroup, countAllFires, filterAllGroups, groupAllFires, hasOlder, mergeFires } from "./all-fires";
import { FilterChips, FireRow, FireTable, useLoadOlderFocus } from "./History";
import { type HistoryFilter, SCHEDULES_TEST_IDS as IDS, triggerName } from "./model";
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

export function AllHistory({ triggers, triggersFailed, playbooks, view, filter, onFilter, offline, now, missedChipRef }: AllHistoryProps) {
  const { histories } = view;
  const merged = useMemo(() => mergeFires(histories), [histories]);
  const groups = useMemo(() => filterAllGroups(groupAllFires(merged), filter), [merged, filter]);
  const more = hasOlder(histories);
  // "50+" while older pages exist: the count is of what is loaded and shown.
  const countText = (f: HistoryFilter) => `${countAllFires(merged, f)}${more ? "+" : ""}`;
  const busy = view.olderBusy;
  const { section, arm } = useLoadOlderFocus(busy, more);

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
      <FireTable>
        {groups.map((group, index) => {
          const row = rowsOf(group);
          return row === undefined ? null : (
            <FireRow key={group.key} trigger={row.trigger} name={row.name} group={group} first={index === 0} now={now} testId={IDS.allFire} triggerId={group.trigger_id} nameTestId={IDS.fireTrigger} />
          );
        })}
      </FireTable>
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
        <FilterChips filter={filter} onFilter={onFilter} countText={countText} missedChipRef={missedChipRef} />
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
              arm(groups.length);
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
