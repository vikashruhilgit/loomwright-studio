// Schedules & triggers (phase 7 item 05), built to the approved mockup
// (`docs/design/mockups/gui-v2.html`, `schedulesScreen`): the upcoming timeline and
// the trigger list on the left, the open trigger's detail and its firing history
// (`./History.tsx`) on the right.
//
// Data. `GET /schedule` is read here, on mount and again when a `trigger_*`,
// `wakeup_*` or `playbook_*` event arrives on the live feed (throttled to one read
// per `REFETCH_THROTTLE_MS`), together with the open trigger's first history page.
// The trigger list is the live store's own `triggers` resource (`GET /triggers?all=1`,
// disabled ones too) and playbook names come from its `playbooks` resource; this screen
// edits no shared store file. A refetch keeps the rows on screen until the answer lands
// (no skeleton, rows keyed by id, fixed row heights), so a live update moves nothing
// already shown. A status 0 answer is "kernel unreachable", never "nothing scheduled":
// the screen keeps its last data, marks it "last known" and disables every control that
// needs the kernel; the shell draws the shared band above it.
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
import { liveStoreFor, useLiveStore, useResource } from "../../store/react";
import { setTriggerEnabled } from "./actions";
import { SCHEDULES_OWNER, schedulesCommands } from "./commands";
import { History } from "./History";
import {
  type HistoryFilter,
  SCHEDULES_TEST_IDS as IDS,
  entryName,
  failureDetail,
  iconOf,
  newestScheduleEventId,
  specLine,
  summaryText,
  timelineTime,
  toggleFailure,
  toggleOutcome,
  triggerName,
  whenLabel,
  wakeupNote,
} from "./model";
import { KindIcon, RefreshGlyph, Skeleton, WarnGlyph } from "./parts";
import { useFeedRefetch, useScheduleRead } from "./useSchedule";
import { useHistory } from "./useHistory";
import "./schedules.css";

function isEditable(target: HTMLElement): boolean {
  return target.isContentEditable || target.matches("input, textarea, select");
}

// ---- Parts ------------------------------------------------------------------------------------------

function Timeline({ entries, triggers, playbooks, now }: { readonly entries: readonly ScheduleEntry[]; readonly triggers: readonly Trigger[] | undefined; readonly playbooks: readonly PlaybookListing[] | undefined; readonly now: Date }) {
  return (
    <ul className="schedules-tl" aria-labelledby="schedules-upcoming-h" data-testid={IDS.timeline}>
      {entries.map((entry) => {
        // A trigger entry's kind and spec come from the trigger's own row; until it is loaded, a generic icon and no spec.
        const row = entry.kind === "trigger" ? triggers?.find((t) => t.id === entry.id) : undefined;
        const spec = entry.kind === "wakeup" ? wakeupNote(entry) : row === undefined ? "" : specLine(row, now);
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
              <b className="schedules-clip" data-testid={IDS.entryName}>
                {entryName(entry, playbooks)}
              </b>
              <span className="schedules-cap schedules-clip" data-testid={IDS.entrySpec}>
                {spec}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
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
        <Badge>{trigger.kind}</Badge>
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
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const selected = triggers?.find((t) => t.id === selectedId) ?? triggers?.[0];
  const history = useHistory(api, selected?.id);
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Readonly<Record<number, string>>>({});
  const [confirm, setConfirm] = useState<Confirm | undefined>(undefined);
  const inFlight = useRef(new Set<number>());
  const switchRefs = useRef(new Map<number, HTMLButtonElement>());
  const missedChip = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  // "Try again" is replaced by the schedule when the read lands; focus follows to Refresh, only if that click armed it.
  const retried = useRef(false);

  const connectionDown = connection.state === "reconnecting" || connection.state === "unreachable" || connection.state === "not_installed";
  const offline = connectionDown || read.latest?.kind === "unreachable" || history.latest?.kind === "unreachable";

  const refetchHistory = history.refetch;
  const refetchAll = useCallback(() => {
    refetchSchedule();
    refetchHistory();
  }, [refetchSchedule, refetchHistory]);
  const refetchRef = useRef(refetchAll);
  refetchRef.current = refetchAll;

  // A live event refetches the schedule and the open history.
  useFeedRefetch(newestScheduleEventId(eventLog), refetchAll);

  // "It may be restarting; this window reconnects on its own": once the feed is live again, ask again.
  const live = connection.state === "live";
  const scheduleUnanswered = read.latest?.kind === "unreachable" || read.latest?.kind === "failed";
  const historyUnanswered = history.latest?.kind === "unreachable" || history.latest?.kind === "failed";
  useEffect(() => {
    if (live && scheduleUnanswered) refetchSchedule();
  }, [live, scheduleUnanswered, refetchSchedule]);
  useEffect(() => {
    if (live && historyUnanswered) refetchHistory();
  }, [live, historyUnanswered, refetchHistory]);

  // Palette commands: registered while mounted, read through a ref so they are registered once.
  const commandState = useRef({ offline, selected });
  commandState.current = { offline, selected };
  useEffect(
    () =>
      registry.register(
        SCHEDULES_OWNER,
        schedulesCommands(
          () => ({ offline: commandState.current.offline }),
          () => ({
            showMissed: () => {
              setFilter("missed");
              const first = commandState.current.selected;
              if (first !== undefined) setSelectedId(first.id);
              missedChip.current?.focus();
            },
            refresh: () => refetchRef.current(),
          }),
        ),
      ),
    [registry],
  );

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
    if (offline || inFlight.current.has(id)) return;
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
    } else if (latest?.kind === "unreachable" || (latest === undefined && connectionDown)) {
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
            <h2 className="schedules-label" id="schedules-upcoming-h">
              Upcoming
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
                  return (
                    <li key={t.id} data-testid={IDS.trigger} data-id={t.id} data-enabled={t.enabled} data-selected={t.id === selected?.id} data-nav-row="">
                      <KindIcon kind={iconOf(t.kind)} />
                      <span className="schedules-ttext">
                        <button
                          type="button"
                          className="schedules-select schedules-clip"
                          aria-current={t.id === selected?.id ? "true" : undefined}
                          aria-describedby={`schedules-spec-${t.id}`}
                          data-nav-focus=""
                          data-testid={IDS.select}
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
            <p className="schedules-cap schedules-pad">Wake-ups appear in the timeline and have no firing history. Open a trigger to see when it fired and when it did not.</p>
          ) : (
            <div className="schedules-pad">
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

  const showTools = hasData && !nothingScheduled;
  return (
    <div className="schedules" data-testid={IDS.screen} data-offline={offline ? "true" : undefined} onKeyDown={onKeyDown}>
      <div className="schedules-tbar">
        {showTools ? (
          <span className="schedules-cap" data-testid={IDS.summary}>
            {summaryText(entries.length, (triggers ?? []).filter((t) => t.enabled).length, offline)}
          </span>
        ) : nothingScheduled ? (
          <span className="schedules-cap" data-testid={IDS.summary}>
            nothing scheduled
          </span>
        ) : null}
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
