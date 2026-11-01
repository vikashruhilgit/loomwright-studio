// Schedules & triggers (phase 7 items 05 and 16), built to the approved mockup
// (`docs/design/mockups/gui-v2.html`, `schedulesScreen`): the upcoming timeline ("Upcoming ·
// Today", then "Later") and the trigger list on the left; on the right the firing history of
// every trigger (`./AllHistory.tsx`), or, once a trigger is chosen in the list, that trigger's
// detail and its own history (`./History.tsx`), with a button back to all triggers. The count
// line ("5 upcoming · 4 triggers on") is the title bar's, declared as `screen.Subtitle`
// (`./Subtitle.tsx`); this screen draws none of its own.
//
// Data. `GET /schedule` is read here, on mount and again when a `trigger_*`,
// `wakeup_*` or `playbook_*` event arrives on the live feed (throttled to one read
// per `REFETCH_THROTTLE_MS`), together with the first history page of every trigger (one request per
// trigger: no route serves every trigger's fires) and of the open trigger.
// The trigger list is the live store's own `triggers` resource (`GET /triggers?all=1`,
// disabled ones too) and playbook names and status come from its `playbooks` resource (`all=1`, the
// ones that are off too); this screen edits no shared store file. A trigger whose playbook is off
// (`isPlaybookOff`: the kernel's own gate) says so on its row and in the upcoming list. A refetch
// keeps the rows on screen until the answer lands (no skeleton, rows keyed by id), so a live update
// moves nothing already shown. A status 0 answer is "kernel unreachable", never "nothing
// scheduled": the screen keeps its last data (held per bridge in `./last-read.ts`, so leaving and coming back
// keeps it too), marks it "last known" and disables every control that needs the kernel; the shell
// draws the shared band above it.
//
// Writes. A switch calls `POST /triggers/:id/on|off`. A `409 needs_confirmation` (a
// `once` whose time has passed) asks first and resends with `{"confirm": true}` only
// after the owner confirms; any other refusal shows the kernel's `error` code in the
// row. The screen reads the result through the same routes as ever, never a local edit.
//
// Keys. Everything is reachable by Tab, Enter and Space; J and K move between the rows
// of the trigger list and of the history; Escape closes the confirm and focus returns
// to the switch that opened it (or, if it is gone, to the trigger's row).
//
// Every string from the kernel (a trigger's text, a wake-up's reason, a playbook's name,
// a fire's reason) is untrusted data: a React text child, never markup.
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { PlaybookListing, ScheduleEntry, StudioBridge, Trigger } from "../../api/contract";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { KernelBand } from "../../shell/KernelStates";
import { useKernelReach } from "../../shell/last-known";
import { liveStoreFor, useLiveStore, useResource } from "../../store/react";
import { setTriggerEnabled } from "./actions";
import { AllHistory } from "./AllHistory";
import { SCHEDULES_OWNER, schedulesCommands } from "./commands";
import { History } from "./History";
import {
  type HistoryFilter,
  SCHEDULES_TEST_IDS as IDS,
  entryName,
  failureDetail,
  iconOf,
  isPlaybookOff,
  newestScheduleEventId,
  safe,
  specLine,
  splitUpcoming,
  timelineTime,
  OFFLINE_TOGGLE_TEXT,
  toggleFailure,
  toggleOutcome,
  triggerName,
  whenLabel,
  wakeupNote,
} from "./model";
import { BackGlyph, KindIcon, PlaybookOffNote, RefreshGlyph, Skeleton, WarnGlyph } from "./parts";
import { useAllFires } from "./useAllFires";
import { useFeedRefetch, useScheduleRead } from "./useSchedule";
import { useHistory } from "./useHistory";
import "./schedules.css";

function isEditable(target: HTMLElement): boolean {
  return target.isContentEditable || target.matches("input, textarea, select");
}

// ---- Parts ------------------------------------------------------------------------------------------

interface TimelineProps {
  readonly entries: readonly ScheduleEntry[];
  readonly triggers: readonly Trigger[] | undefined;
  readonly playbooks: readonly PlaybookListing[] | undefined;
  readonly now: Date;
}

/** One list of upcoming entries (the Today list or the Later one), named by the heading `labelledBy`. */
function Entries({ entries, triggers, playbooks, now, labelledBy }: TimelineProps & { readonly labelledBy: string }) {
  return (
    <ul className="schedules-tl" aria-labelledby={labelledBy}>
      {entries.map((entry) => {
        // A trigger entry's kind and spec come from the trigger's own row; until it is loaded, a generic icon and no spec.
        const row = entry.kind === "trigger" ? triggers?.find((t) => t.id === entry.id) : undefined;
        const spec = entry.kind === "wakeup" ? wakeupNote(entry) : row === undefined ? "" : specLine(row, now);
        const name = entryName(entry, playbooks);
        return (
          <li key={`${entry.kind}-${entry.id}`} data-testid={IDS.entry} data-kind={entry.kind} data-id={entry.id}>
            <time className="schedules-cap schedules-tn" dateTime={entry.at}>
              {timelineTime(entry.at, now)}
            </time>
            <span className="schedules-rail">
              <span className="schedules-pip">
                <KindIcon kind={entry.kind === "wakeup" ? "wakeup" : iconOf(row?.kind)} />
              </span>
            </span>
            <div className="schedules-item">
              {/* Up to two lines; one still too long ends in an ellipsis and carries its full text as a tooltip. */}
              <b className="schedules-clip schedules-clamp" data-testid={IDS.entryName} title={name}>
                {name}
              </b>
              <span className="schedules-cap schedules-clip" data-testid={IDS.entrySpec}>
                {spec}
              </span>
              {entry.kind === "trigger" && isPlaybookOff(entry.playbook, playbooks) ? <PlaybookOffNote /> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The region under the "Upcoming · Today" heading: the entries due on `now`'s local day, then, under "Later", the rest, so
 * nothing the route sent is hidden. The region is the one `IDS.timeline` element; every entry is an `IDS.entry`.
 */
function Timeline(props: TimelineProps) {
  const { today, later } = splitUpcoming(props.entries, props.now);
  return (
    <div className="schedules-tlr" data-testid={IDS.timeline}>
      {today.length === 0 ? (
        <p className="schedules-cap schedules-pad" data-testid={IDS.todayEmpty}>
          Nothing else is due today.
        </p>
      ) : (
        <Entries {...props} entries={today} labelledBy="schedules-upcoming-h" />
      )}
      {later.length === 0 ? null : (
        <>
          <h3 className="schedules-label" id="schedules-later-h" data-testid={IDS.laterHeading}>
            Later
          </h3>
          <Entries {...props} entries={later} labelledBy="schedules-later-h" />
        </>
      )}
    </div>
  );
}

function Detail({ trigger, name, now }: { readonly trigger: Trigger; readonly name: string; readonly now: Date }) {
  const spec = specLine(trigger, now);
  const next = trigger.next_fire_at === null ? (trigger.enabled ? "not scheduled" : "not scheduled while off") : whenLabel(trigger.next_fire_at, now);
  return (
    <section className="schedules-detail" aria-labelledby="schedules-detail-h" data-testid={IDS.detail} data-id={trigger.id}>
      <div className="schedules-dhead">
        <h2 id="schedules-detail-h" className="schedules-title" data-testid={IDS.detailName}>
          {name}
        </h2>
        <Badge>{safe(trigger.kind)}</Badge>
        <Badge tone={trigger.enabled ? "ok" : "neutral"}>{trigger.enabled ? "on" : "off"}</Badge>
      </div>
      <dl className="schedules-kv">
        <dt>Fires on</dt>
        <dd>{spec}</dd>
        <dt>Next fire</dt>
        <dd data-testid={IDS.detailNext}>{next}</dd>
        <dt>Last result</dt>
        <dd>{trigger.last_result === null ? "none yet" : <span className="schedules-mono">{trigger.last_result}</span>}</dd>
        <dt>Owner</dt>
        <dd>{trigger.owning_agent}</dd>
      </dl>
    </section>
  );
}

// ---- The screen ---------------------------------------------------------------------------------------

export interface SchedulesScreenProps {
  readonly api: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

interface Confirm {
  readonly id: number;
  readonly name: string;
}

export function SchedulesScreen({ api, registry = commandRegistry }: SchedulesScreenProps) {
  const { connection, eventLog } = useLiveStore(api);
  const triggersRes = useResource("triggers", api);
  const playbooksRes = useResource("playbooks", api);
  const { read, refetch: refetchSchedule } = useScheduleRead(api);

  const triggers = triggersRes?.data?.triggers;
  const playbooks = playbooksRes?.data?.playbooks;
  // No trigger is chosen by default: the right pane is the firing history of every trigger.
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const selected = triggers?.find((t) => t.id === selectedId);
  const history = useHistory(api, selected?.id);
  const allFires = useAllFires(api, triggers?.map((t) => t.id));
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Readonly<Record<number, string>>>({});
  const [confirm, setConfirm] = useState<Confirm | undefined>(undefined);
  const inFlight = useRef(new Set<number>());
  const switchRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectRefs = useRef(new Map<number, HTMLButtonElement>());
  const missedChip = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  // "Try again" is replaced by the schedule when the read lands; focus follows to Refresh, only if that click armed it.
  const retried = useRef(false);

  // The shell draws the one band while the store reads `reconnecting` or `unreachable`; this screen draws it only
  // when its own read answered status 0 before the store noticed, so exactly one band is on screen.
  const reach = useKernelReach(api);
  const scheduleUnreachable = read.latest?.kind === "unreachable";
  const offline = reach.offline || scheduleUnreachable || allFires.unreachable || history.latest?.kind === "unreachable";

  const refetchHistory = history.refetch;
  const refetchFires = allFires.refetch;
  const refetchAll = useCallback(() => {
    refetchSchedule();
    refetchFires();
    refetchHistory();
  }, [refetchSchedule, refetchFires, refetchHistory]);
  const refetchRef = useRef(refetchAll);
  refetchRef.current = refetchAll;

  // A live event refetches the schedule, every trigger's history and the open one.
  useFeedRefetch(newestScheduleEventId(eventLog), refetchAll);

  // "It may be restarting; this window reconnects on its own": once the feed is live again, ask again.
  const live = connection.state === "live";
  const scheduleUnanswered = read.latest?.kind === "unreachable" || read.latest?.kind === "failed";
  const historyUnanswered = history.latest?.kind === "unreachable" || history.latest?.kind === "failed";
  const firesUnanswered = allFires.unreachable || allFires.failure !== undefined;
  useEffect(() => {
    if (live && scheduleUnanswered) refetchSchedule();
  }, [live, scheduleUnanswered, refetchSchedule]);
  useEffect(() => {
    if (live && historyUnanswered) refetchHistory();
  }, [live, historyUnanswered, refetchHistory]);
  useEffect(() => {
    if (live && firesUnanswered) refetchFires();
  }, [live, firesUnanswered, refetchFires]);

  // Palette commands: registered while mounted, read through a ref so they are registered once.
  const commandState = useRef({ offline });
  commandState.current = { offline };
  // "Show missed fires" goes back to the all-triggers history on the "Not fired" filter and focuses its chip; the chip
  // of the pane it leaves is about to unmount, so the focus is also armed for after the commit.
  const focusMissed = useRef(false);
  useEffect(
    () =>
      registry.register(
        SCHEDULES_OWNER,
        schedulesCommands(
          () => ({ offline: commandState.current.offline }),
          () => ({
            showMissed: () => {
              setFilter("missed");
              setSelectedId(undefined);
              focusMissed.current = true;
              missedChip.current?.focus();
            },
            refresh: () => refetchRef.current(),
          }),
        ),
      ),
    [registry],
  );

  useEffect(() => {
    if (!focusMissed.current) return;
    focusMissed.current = false;
    missedChip.current?.focus();
  });

  // "All triggers" unmounts the button that was pressed: focus goes back to the row that opened that trigger.
  const returnTo = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (selectedId !== undefined || returnTo.current === undefined) return;
    const id = returnTo.current;
    returnTo.current = undefined;
    selectRefs.current.get(id)?.focus();
  }, [selectedId]);

  // The confirm is gone: focus is back on the switch that opened it (the dialog restores it); if that is gone, on the trigger's switch.
  const confirmedId = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (confirm !== undefined) {
      confirmedId.current = confirm.id;
      return;
    }
    const id = confirmedId.current;
    confirmedId.current = undefined;
    if (id === undefined) return;
    const active = document.activeElement;
    if (active === null || active === document.body) switchRefs.current.get(id)?.focus();
  }, [confirm]);

  const toggle = async (id: number, name: string, enabled: boolean, confirmed: boolean) => {
    if (inFlight.current.has(id)) return;
    // Offline, the switch is disabled, but a confirm dialog opened before the kernel dropped can still ask: say so in the row.
    if (offline) {
      setRowErrors((prev) => ({ ...prev, [id]: toggleFailure(enabled, OFFLINE_TOGGLE_TEXT) }));
      return;
    }
    inFlight.current.add(id);
    setBusy(new Set(inFlight.current));
    setRowErrors((prev) => {
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
    const reply = await setTriggerEnabled(api, id, enabled, confirmed);
    inFlight.current.delete(id);
    setBusy(new Set(inFlight.current));
    const outcome = toggleOutcome(reply, confirmed);
    if (outcome.kind === "done") {
      // The kernel's `trigger_toggled` event would bring the same answer; asking now keeps the screen from waiting on the feed.
      liveStoreFor(api).refetch("triggers");
      refetchRef.current();
    } else if (outcome.kind === "confirm") setConfirm({ id, name });
    else setRowErrors((prev) => ({ ...prev, [id]: toggleFailure(enabled, outcome.text) }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== "j" && key !== "k") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || isEditable(target)) return;
    const group = target.closest<HTMLElement>("[data-nav-group]");
    if (group === null) return;
    const rows = [...group.querySelectorAll<HTMLElement>("[data-nav-row]")];
    const at = rows.findIndex((row) => row.contains(target));
    if (at < 0) return;
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + (key === "j" ? 1 : -1)))];
    event.preventDefault();
    (next?.querySelector<HTMLElement>("[data-nav-focus]") ?? next)?.focus();
  };

  const now = new Date();
  const entries = read.lastOk?.entries;
  const hasData = entries !== undefined;
  const latest = read.latest;
  const failed = latest !== undefined && (latest.kind === "refused" || latest.kind === "failed") ? latest : undefined;
  const triggersLoaded = triggers !== undefined;
  const nothingScheduled = hasData && entries.length === 0 && triggersLoaded && triggers.length === 0;

  let body: ReactNode;
  if (!hasData) {
    if (failed !== undefined) {
      body = (
        <div className="schedules-fail" role="alert" data-testid={IDS.error}>
          <div className="schedules-fail-head">
            <WarnGlyph />
            <h2 className="schedules-title">Couldn't load the schedule</h2>
          </div>
          <p>{failed.kind === "refused" ? `The kernel answered, but the schedule request failed (${failed.status}). Nothing on this screen was changed.` : "The kernel did not answer the schedule request. Nothing on this screen was changed."}</p>
          <div className="schedules-fail-detail schedules-mono" data-testid={IDS.errorDetail}>
            {failureDetail("GET /schedule", failed)}
          </div>
          <div>
            <Button size="row" variant="secondary" disabled={offline} onClick={() => {
                retried.current = true;
                refetchSchedule();
              }}
              data-testid={IDS.retry}
            >
              Try again
            </Button>
          </div>
        </div>
      );
    } else if (latest?.kind === "unreachable" || (latest === undefined && reach.offline)) {
      body = (
        <div className="schedules-empty" data-testid={IDS.unknown}>
          <h2 className="schedules-title">Status unknown</h2>
          <p>Studio can't tell what is scheduled until the kernel answers.</p>
        </div>
      );
    } else body = <Skeleton testId={IDS.loading} what="the schedule" />;
  } else if (nothingScheduled) {
    body = (
      <div className="schedules-empty" data-testid={IDS.empty}>
        <h2 className="schedules-title">Nothing is scheduled.</h2>
        <p>No triggers and no wake-ups. A playbook gets a trigger when you and Wright set one up: a poll, a cron time or a single moment. Studio ships none.</p>
        <Button
          variant="primary"
          onClick={() => {
            window.location.hash = "#/chat";
          }}
          data-testid={IDS.emptyAsk}
        >
          Ask Wright to schedule something
        </Button>
      </div>
    );
  } else {
    const selectedName = selected === undefined ? "" : triggerName(selected, playbooks);
    body = (
      <div className="schedules-split">
        <div className="schedules-list" data-testid={IDS.list}>
          {/* Two regions of one height each, scrolling on their own: a timeline that gains an entry never pushes the trigger list. */}
          <div className="schedules-lsec">
            <h2 className="schedules-label" id="schedules-upcoming-h" data-testid={IDS.todayHeading}>
              Upcoming · Today
            </h2>
            {entries.length === 0 ? (
              <p className="schedules-cap schedules-pad" data-testid={IDS.timelineEmpty}>
                Nothing is due. A trigger that is on appears here with its next fire.
              </p>
            ) : (
              <Timeline entries={entries} triggers={triggers} playbooks={playbooks} now={now} />
            )}
          </div>
          <div className="schedules-lsec">
            <h2 className="schedules-label" data-testid={IDS.triggersHeading}>
              {triggers === undefined ? "Triggers" : `Triggers · ${triggers.length}`}
            </h2>
            {triggers === undefined ? (
              triggersRes?.error === undefined ? (
                <Skeleton testId={IDS.triggersLoading} what="the triggers" />
              ) : (
                <p className="schedules-notice" data-tone="danger" role="alert">
                  Couldn't read the triggers.
                </p>
              )
            ) : (
              <ul className="schedules-box" aria-label="Triggers" data-testid={IDS.triggers} data-nav-group="triggers">
                {triggers.map((t) => {
                  const name = triggerName(t, playbooks);
                  const rowError = rowErrors[t.id];
                  const onOff = t.enabled ? "on" : "off";
                  // Off triggers fire nothing, so only a trigger that is on has fires to skip.
                  const playbookOff = t.enabled && isPlaybookOff(t.playbook, playbooks);
                  return (
                    <li key={t.id} data-testid={IDS.trigger} data-id={t.id} data-enabled={t.enabled} data-selected={t.id === selected?.id} data-nav-row="">
                      <KindIcon kind={iconOf(t.kind)} />
                      <span className="schedules-ttext">
                        <button
                          type="button"
                          className="schedules-select schedules-clip schedules-clamp"
                          aria-current={t.id === selected?.id ? "true" : undefined}
                          aria-describedby={playbookOff ? `schedules-spec-${t.id} schedules-off-${t.id}` : `schedules-spec-${t.id}`}
                          title={name}
                          data-nav-focus=""
                          data-testid={IDS.select}
                          ref={(node) => {
                            if (node) selectRefs.current.set(t.id, node);
                            else selectRefs.current.delete(t.id);
                          }}
                          onClick={() => setSelectedId(t.id)}
                        >
                          {name}
                        </button>
                        {rowError === undefined ? (
                          <span id={`schedules-spec-${t.id}`} className="schedules-cap schedules-clip">
                            {specLine(t, now)}
                          </span>
                        ) : (
                          <span id={`schedules-spec-${t.id}`} className="schedules-cap schedules-clip" data-tone="danger" role="alert" data-testid={IDS.rowError}>
                            {rowError}
                          </span>
                        )}
                        {playbookOff ? <PlaybookOffNote id={`schedules-off-${t.id}`} /> : null}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        className="schedules-sw"
                        aria-checked={t.enabled}
                        aria-label={`${name} trigger is ${onOff}`}
                        aria-busy={busy.has(t.id) ? "true" : undefined}
                        disabled={offline}
                        title={offline ? "Needs the kernel" : undefined}
                        data-testid={IDS.toggle}
                        ref={(node) => {
                          if (node) switchRefs.current.set(t.id, node);
                          else switchRefs.current.delete(t.id);
                        }}
                        onClick={() => void toggle(t.id, name, !t.enabled, false)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="schedules-pane">
          {selected === undefined ? (
            <div className="schedules-pad">
              <AllHistory triggers={triggers} triggersFailed={triggers === undefined && triggersRes?.error !== undefined} playbooks={playbooks} view={allFires} filter={filter} onFilter={setFilter} offline={offline} now={now} missedChipRef={missedChip} />
              <p className="schedules-cap">Wake-ups appear in the timeline and have no firing history. Choose a trigger to see its own detail and history.</p>
            </div>
          ) : (
            <div className="schedules-pad">
              <div>
                <Button
                  size="row"
                  variant="ghost"
                  icon={<BackGlyph />}
                  onClick={() => {
                    returnTo.current = selected.id;
                    setSelectedId(undefined);
                  }}
                  data-testid={IDS.allTriggers}
                >
                  All triggers
                </Button>
              </div>
              <Detail trigger={selected} name={selectedName} now={now} />
              <History trigger={selected} name={selectedName} view={history} filter={filter} onFilter={setFilter} offline={offline} now={now} missedChipRef={missedChip} />
            </div>
          )}
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!retried.current) return;
    if (!hasData) return;
    retried.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) refreshButton.current?.focus();
  }, [hasData]);

  return (
    <div className="schedules" data-testid={IDS.screen} data-offline={offline ? "true" : undefined} onKeyDown={onKeyDown}>
      {scheduleUnreachable && !reach.shellBand ? <KernelBand testId={IDS.band} /> : null}
      <div className="schedules-tbar">
        <span className="schedules-spacer" />
        {hasData ? (
          <Button ref={refreshButton} size="row" variant="ghost" icon={<RefreshGlyph />} disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={refetchAll}>
            Refresh
          </Button>
        ) : null}
      </div>
      {hasData && failed !== undefined ? (
        <p className="schedules-notice" data-tone="danger" role="alert" data-testid={IDS.notice}>
          {`Couldn't refresh the schedule: ${failureDetail("GET /schedule", failed)}. What is shown is the last read.`}
        </p>
      ) : null}
      {body}
      {confirm === undefined ? null : (
        <Dialog
          kind="decision"
          title="Turn on and fire now?"
          description={
            <>
              <b>{confirm.name}</b> was set for a moment that has passed. Turning it on would fire it at once.
            </>
          }
          action={{
            label: "Turn on and fire now",
            onAction: () => {
              setConfirm(undefined);
              void toggle(confirm.id, confirm.name, true, true);
            },
          }}
          onCancel={() => setConfirm(undefined)}
        />
      )}
    </div>
  );
}
