// Budget & audit (phase 7 item 07), built to the approved mockup (`docs/design/mockups/gui-v2.html`,
// `budgetScreen` and `auditScreen`): tokens counted per day, per agent and per playbook against
// each limit (tokens and sessions at once, never dollars), the subscription cap with its reset
// times, today's total with its one "≈ at API rates" estimate, the three latest audit events, and
// the full audit log (`./AuditLog.tsx`) as a sub-view of this screen.
//
// Data. `GET /budget/usage` is read on mount and again when a new event arrives on the live feed
// (at most once per `liveThrottleMs`), together with the latest three audit events on the overview,
// or the first page of the log in the audit view. Agent names and avatars come from the live store's
// `agents` resource, playbook names from its `playbooks` resource, and the cap account's label from
// its `status`; this screen edits no shared store file. A refetch keeps the rows on screen until the
// answer lands (no skeleton, rows keyed by day, agent id, playbook slug or event id, fixed row
// heights), so a live update moves nothing already shown. A status 0 answer is "kernel unreachable",
// never "no usage": the screen keeps its last data, marks it "last known" and disables every control
// that needs the kernel; the shell draws the shared band above it.
//
// Policy. The screen only shows limits; setting one is Team's (an agent's) and Playbooks' (a
// playbook's). "At limit" is the figure reaching its limit, nothing more.
//
// Keys. Everything is reachable by Tab, Enter and Space; J and K move between the rows of a table;
// Escape in the audit log returns to the overview and focus returns to the control that opened it.
//
// Every string from the kernel (a name, a slug, an event's kind and payload, a cap status) is
// untrusted data: a React text child, never markup.
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { StudioBridge } from "../../api/contract";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Button } from "../../components/Button/Button";
import { useLiveStore, useResource } from "../../store/react";
import { AuditLog } from "./AuditLog";
import { BUDGET_OWNER, budgetCommands } from "./commands";
import {
  BUDGET_TEST_IDS as IDS,
  CHAT_HASH,
  LATEST_COUNT,
  LIVE_THROTTLE_MS,
  NO_FILTER,
  TEAM_HASH,
  agentLimits,
  agentName,
  auditRows,
  bandText,
  count,
  daySeries,
  failureDetail,
  filterActive,
  isEmptyUsage,
  latestQuery,
  newestEventId,
  playbookLimits,
  summaryText,
  waitingAgents,
} from "./model";
import type { AuditFilter } from "./model";
import { HistoryGlyph, Skeleton, WarnGlyph } from "./parts";
import { AgentTable, DayTable, Inspector, Latest, PlaybookTable } from "./Tables";
import { useAudit } from "./useAudit";
import { useFeedRefetch, useUsageRead } from "./useUsage";
import "./budget.css";

type View = "overview" | "audit";

function isEditable(target: HTMLElement): boolean {
  return target.isContentEditable || target.matches("input, textarea, select");
}

const latestBuild = (): Record<string, string> => latestQuery(LATEST_COUNT);

export interface BudgetScreenProps {
  readonly api: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
  /** The clock (the screen's "today"); tests pass a fixed one. */
  readonly now?: () => Date;
  /** At most one live refetch per this many ms. */
  readonly liveThrottleMs?: number;
}

export function BudgetScreen({ api, registry = commandRegistry, now = () => new Date(), liveThrottleMs = LIVE_THROTTLE_MS }: BudgetScreenProps) {
  const { connection, eventLog, status } = useLiveStore(api);
  const agentsRes = useResource("agents", api);
  const playbooksRes = useResource("playbooks", api);
  const { read, refetch: refetchUsage } = useUsageRead(api);
  const roster = agentsRes?.data?.agents;
  const playbooks = playbooksRes?.data?.playbooks;

  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState<AuditFilter>(NO_FILTER);
  const latestView = useAudit(api, { enabled: view === "overview", key: "latest", build: latestBuild });

  const root = useRef<HTMLDivElement>(null);
  const kindSelect = useRef<HTMLSelectElement>(null);
  // Which control opened the audit log ("toolbar" or "latest"): focus goes back to it when the overview returns.
  const openedBy = useRef<string | undefined>(undefined);
  const retried = useRef(false);

  const live = connection.state === "live";
  const connectionDown = connection.state === "reconnecting" || connection.state === "unreachable" || connection.state === "not_installed";
  const offline = connectionDown || read.latest?.kind === "unreachable" || (view === "overview" && latestView.latest?.kind === "unreachable");

  // A live event reads the usage again, and what the current view shows of the log (the overview's three events; the audit view follows itself).
  const refetchLatest = latestView.refetch;
  const liveRefetch = useCallback(() => {
    refetchUsage();
    if (view === "overview") refetchLatest();
  }, [refetchUsage, refetchLatest, view]);
  useFeedRefetch(newestEventId(eventLog), liveRefetch, liveThrottleMs);

  // "It may be restarting; this window reconnects on its own": once the feed is live again, ask again.
  const usageUnanswered = read.latest?.kind === "unreachable" || read.latest?.kind === "failed";
  useEffect(() => {
    if (live && usageUnanswered) refetchUsage();
  }, [live, usageUnanswered, refetchUsage]);
  const latestUnanswered = latestView.latest?.kind === "unreachable" || latestView.latest?.kind === "failed";
  useEffect(() => {
    if (live && latestUnanswered && view === "overview") refetchLatest();
  }, [live, latestUnanswered, view, refetchLatest]);

  const openAudit = useCallback((patch?: Partial<AuditFilter>) => {
    const focused = document.activeElement;
    openedBy.current = (focused instanceof HTMLElement ? focused.closest<HTMLElement>("[data-opener]")?.dataset.opener : undefined) ?? "toolbar";
    setFilter({ ...NO_FILTER, ...patch });
    setView("audit");
  }, []);
  const closeAudit = useCallback(() => setView("overview"), []);
  // Clearing the filters leaves focus on the Kind select, the first filter (the Clear button disables itself).
  const clearFilters = useCallback(() => {
    setFilter(NO_FILTER);
    kindSelect.current?.focus({ preventScroll: true });
  }, []);

  // The overview is back: focus returns to the control that opened the log (or, if it is gone, the screen).
  useEffect(() => {
    if (view !== "overview" || openedBy.current === undefined) return;
    const opener = openedBy.current;
    openedBy.current = undefined;
    (root.current?.querySelector<HTMLElement>(`[data-opener="${opener}"]`) ?? root.current)?.focus({ preventScroll: true });
  }, [view]);

  // Palette commands: registered while mounted, read through a ref so they are registered once.
  const commandState = useRef({ offline, filtered: view === "audit" && filterActive(filter) });
  commandState.current = { offline, filtered: view === "audit" && filterActive(filter) };
  const handlers = useRef({ openAudit, clearFilters });
  handlers.current = { openAudit, clearFilters };
  useEffect(
    () =>
      registry.register(
        BUDGET_OWNER,
        budgetCommands(
          () => commandState.current,
          () => ({
            openAudit: () => handlers.current.openAudit(),
            showKind: (kind) => handlers.current.openAudit({ kind }),
            clearFilters: () => handlers.current.clearFilters(),
          }),
        ),
      ),
    [registry],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape" && view === "audit") {
      event.preventDefault();
      closeAudit();
      return;
    }
    if (event.shiftKey) return;
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
    next?.focus();
  };

  const nowDate = now();
  const usage = read.lastOk;
  const hasData = usage !== undefined;
  const failed = read.latest !== undefined && (read.latest.kind === "refused" || read.latest.kind === "failed") ? read.latest : undefined;
  const empty = hasData && isEmptyUsage(usage);

  useEffect(() => {
    if (!retried.current || !hasData) return;
    retried.current = false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) root.current?.focus({ preventScroll: true });
  }, [hasData]);

  let content: ReactNode;
  if (view === "audit") {
    content = (
      <AuditLog
        api={api}
        filter={filter}
        onFilter={setFilter}
        onClear={clearFilters}
        roster={roster}
        playbooks={playbooks}
        offline={offline}
        live={live}
        eventId={newestEventId(eventLog)}
        throttleMs={liveThrottleMs}
        now={nowDate}
        onBack={closeAudit}
        kindRef={kindSelect}
      />
    );
  } else if (!hasData) {
    if (failed !== undefined) {
      content = (
        <div className="budget-fail" role="alert" data-testid={IDS.error}>
          <div className="budget-fail-head">
            <WarnGlyph />
            <h2 className="budget-title">Couldn't load usage</h2>
          </div>
          <p>{failed.kind === "refused" ? `The kernel answered, but the usage request failed (${failed.status}). Nothing on this screen was changed.` : "The kernel did not answer the usage request. Nothing on this screen was changed."}</p>
          <div className="budget-fail-detail budget-mono" data-testid={IDS.errorDetail}>
            {failureDetail("GET /budget/usage", failed)}
          </div>
          <div>
            <Button
              size="row"
              variant="secondary"
              disabled={offline}
              onClick={() => {
                retried.current = true;
                refetchUsage();
              }}
              data-testid={IDS.retry}
            >
              Try again
            </Button>
          </div>
        </div>
      );
    } else if (read.latest?.kind === "unreachable" || (read.latest === undefined && connectionDown)) {
      content = (
        <div className="budget-empty" data-testid={IDS.unknown}>
          <h2 className="budget-title">Status unknown</h2>
          <p>Studio can't tell what was used until the kernel answers.</p>
        </div>
      );
    } else content = <Skeleton testId={IDS.loading} what="usage" />;
  } else if (empty) {
    content = (
      <div className="budget-empty" data-testid={IDS.empty}>
        <h2 className="budget-title">No tokens used yet.</h2>
        <p>
          Usage appears here once a session ends: tokens per day, per agent and per playbook, against the limits you set. Limits are in tokens and sessions at once, never dollars. Set an agent's in Team
          and a playbook's in Playbooks.
        </p>
        <Button
          variant="primary"
          onClick={() => {
            window.location.hash = CHAT_HASH;
          }}
          data-testid={IDS.emptyAsk}
        >
          Ask Wright
        </Button>
      </div>
    );
  } else {
    const days = daySeries(usage.rows, nowDate);
    const today = days[0];
    const waiting = waitingAgents(usage).map((l) => ({ id: l.id, name: agentName(l.id, roster), used: count(l.tokens_today), limit: l.tokens_per_day ?? 0 }));
    content = (
      <>
        {waiting.length === 0 ? null : (
          <div className="budget-band" role="status" data-testid={IDS.band}>
            <WarnGlyph />
            <span>{bandText(waiting)}</span>
            <Button
              size="row"
              variant="ghost"
              onClick={() => {
                window.location.hash = TEAM_HASH;
              }}
              data-testid={IDS.openTeam}
            >
              Open Team
            </Button>
          </div>
        )}
        {failed === undefined ? null : (
          <p className="budget-notice" data-tone="danger" role="alert" data-testid={IDS.notice}>
            {`Couldn't refresh the usage: ${failureDetail("GET /budget/usage", failed)}. What is shown is the last read.`}
          </p>
        )}
        <div className="budget-content">
          <div className="budget-scroll">
            <div className="budget-pad">
              <DayTable days={days} />
              <AgentTable limits={agentLimits(usage)} roster={roster} />
              <PlaybookTable limits={playbookLimits(usage)} playbooks={playbooks} roster={roster} />
              <Latest rows={auditRows(latestView.shown?.page, playbooks).slice(0, LATEST_COUNT)} loading={latestView.shown === undefined} offline={offline} now={nowDate} onOpen={() => openAudit()} />
            </div>
          </div>
          <Inspector
            cap={usage.cap_state}
            statusCap={status?.cap_state}
            todayTokens={today?.counted ?? 0}
            todayCost={today?.cost ?? null}
            todayCacheReads={today?.cacheReads ?? 0}
            lastKnown={offline}
            now={nowDate}
          />
        </div>
      </>
    );
  }

  const showTools = view === "overview" && hasData && !empty;
  const todayTokens = hasData ? (daySeries(usage.rows, nowDate)[0]?.counted ?? 0) : 0;
  return (
    <div className="budget" ref={root} tabIndex={-1} data-testid={IDS.screen} data-offline={offline ? "true" : undefined} data-view={view} onKeyDown={onKeyDown}>
      {view === "overview" ? (
        <div className="budget-tbar">
          {showTools ? (
            <span className="budget-cap" data-testid={IDS.summary}>
              {summaryText(todayTokens, offline)}
            </span>
          ) : null}
          <span className="budget-spacer" />
          {showTools ? (
            <Button size="row" variant="secondary" icon={<HistoryGlyph />} disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={() => openAudit()} data-opener="toolbar" data-testid={IDS.auditButton}>
              Audit log
            </Button>
          ) : null}
        </div>
      ) : null}
      {content}
    </div>
  );
}
