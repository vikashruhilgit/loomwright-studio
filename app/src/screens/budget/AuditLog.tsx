// The full audit log (phase 7 item 07), the mockup's `auditScreen`: the filter bar (Kind, Agent,
// Playbook, Time range, Clear filters), a table of the events newest first (Id · When · Kind ·
// Actor · Detail) and "Newer" / "Older" paging by the route's `next_before` cursor, 8 rows a page.
//
// Paging is keyset, so there is no total: the footer reads "Showing rows a–b · page N · newest
// first" where the mockup's reads "of 20" (a recorded departure). On the first page a new event
// on the live feed reads the page again, keeping the rows on screen until the answer lands; an
// older page does not move. While the kernel cannot be asked the rows stay as last read and the
// filters and paging are disabled.
//
// Actor is the payload's own `agent` or "—": `EventFrame` carries no actor, and the stored one
// is `'kernel'` or `'api'`, so the screen never guesses. Every payload string is untrusted data:
// a React text child, never markup.
import { type ReactNode, type Ref, useEffect, useRef } from "react";
import type { PlaybookListing, RosterEntry, StudioBridge } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { SelectField } from "../../components/Input/Input";
import {
  AUDIT_PAGE_SIZE,
  BUDGET_TEST_IDS as IDS,
  RANGES,
  auditQuery,
  auditRows,
  failureDetail,
  filterActive,
  filterKey,
  footerText,
  isAuditRange,
  kindOptions,
  safe,
  whenText,
} from "./model";
import type { AuditFilter } from "./model";
import { BackGlyph, Skeleton, WarnGlyph } from "./parts";
import { useAudit } from "./useAudit";
import { useFeedRefetch } from "./useUsage";

export interface AuditLogProps {
  readonly api: StudioBridge;
  readonly filter: AuditFilter;
  readonly onFilter: (filter: AuditFilter) => void;
  /** Clear every filter (the screen also moves focus to the Kind select, as the mockup does). */
  readonly onClear: () => void;
  readonly roster: readonly RosterEntry[] | undefined;
  readonly playbooks: readonly PlaybookListing[] | undefined;
  /** The kernel cannot be asked: the filters and paging are disabled, the rows are the last read. */
  readonly offline: boolean;
  /** The feed is live (so a read that went unanswered is asked again). */
  readonly live: boolean;
  /** The newest event id on the feed. */
  readonly eventId: number;
  readonly throttleMs: number;
  readonly now: Date;
  readonly onBack: () => void;
  /** The Kind select, for the screen's "Clear audit filters" to focus. */
  readonly kindRef?: Ref<HTMLSelectElement>;
}

function Option({ value, children }: { readonly value: string; readonly children: ReactNode }) {
  return <option value={value}>{children}</option>;
}

export function AuditLog({ api, filter, onFilter, onClear, roster, playbooks, offline, live, eventId, throttleMs, now, onBack, kindRef }: AuditLogProps) {
  const key = filterKey(filter);
  const view = useAudit(api, { enabled: true, key, build: (before, nowMs) => auditQuery(filter, AUDIT_PAGE_SIZE, before, nowMs) });
  const { shown, latest } = view;
  // The kernel cannot be asked: the store says so, or this log's own read found it gone.
  const down = offline || latest?.kind === "unreachable";
  const rows = auditRows(shown?.page, playbooks);
  const active = filterActive(filter);

  // The first page follows the feed; an older page does not move under the owner.
  const refetchRef = useRef(view);
  refetchRef.current = view;
  useFeedRefetch(
    eventId,
    () => {
      if (refetchRef.current.firstPage) refetchRef.current.refetch();
    },
    throttleMs,
  );

  // "It may be restarting; this window reconnects on its own": once the feed is live again, ask again.
  const unanswered = latest?.kind === "unreachable" || latest?.kind === "failed";
  const refetch = view.refetch;
  useEffect(() => {
    if (live && unanswered) refetch();
  }, [live, unanswered, refetch]);

  // The kinds seen so far stay selectable, so narrowing by agent does not remove the kind chosen before it.
  const seen = useRef(new Set<string>());
  for (const row of rows) seen.current.add(row.kind);

  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  // A page change can leave focus on a button that is now disabled (the last Older): it moves to the other direction, else the first row.
  const olderRef = useRef<HTMLButtonElement>(null);
  const newerRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const pageShown = shown?.number;
  useEffect(() => {
    if (pageShown === undefined) return;
    const focused = document.activeElement;
    const lost = focused === null || focused === document.body || (focused instanceof HTMLButtonElement && focused.disabled);
    if (!lost) return;
    const target = [olderRef.current, newerRef.current].find((b) => b !== null && !b.disabled) ?? tableRef.current?.querySelector<HTMLElement>("[data-nav-row]");
    target?.focus({ preventScroll: true });
  }, [pageShown]);

  const failed = latest !== undefined && (latest.kind === "refused" || latest.kind === "failed") ? latest : undefined;
  const set = (patch: Partial<AuditFilter>): void => onFilter({ ...filter, ...patch });
  const clear = onClear;

  const agentChoices = (roster ?? []).map((a) => [a.id, safe(a.display_name.trim() === "" ? a.id : a.display_name)] as const);
  if (filter.agent !== "" && !agentChoices.some(([id]) => id === filter.agent)) agentChoices.push([filter.agent, safe(filter.agent)]);
  const playbookChoices = (playbooks ?? []).map((p) => [p.slug, safe(p.name.trim() === "" ? p.slug : p.name)] as const);
  if (filter.playbook !== "" && !playbookChoices.some(([slug]) => slug === filter.playbook)) playbookChoices.push([filter.playbook, safe(filter.playbook)]);

  let body: ReactNode;
  if (shown === undefined) {
    if (latest === undefined) body = <Skeleton testId={IDS.auditLoading} what="the audit log" />;
    else if (latest.kind === "unreachable") {
      body = (
        <p className="budget-cap budget-pad" data-testid={IDS.auditError}>
          The audit log is unavailable while the kernel is unreachable.
        </p>
      );
    } else if (failed !== undefined) {
      body = (
        <div className="budget-fail" role="alert" data-testid={IDS.auditError}>
          <div className="budget-fail-head">
            <WarnGlyph />
            <h2 className="budget-title">Couldn't load the audit log</h2>
          </div>
          <p>{failed.kind === "refused" ? `The kernel answered, but the audit request failed (${failed.status}). Nothing on this screen was changed.` : "The kernel did not answer the audit request. Nothing on this screen was changed."}</p>
          <div className="budget-fail-detail budget-mono">{failureDetail("GET /audit", failed)}</div>
          <div>
            <Button size="row" variant="secondary" disabled={down} onClick={refetch} data-testid={IDS.auditRetry}>
              Try again
            </Button>
          </div>
        </div>
      );
    } else body = <Skeleton testId={IDS.auditLoading} what="the audit log" />;
  } else if (rows.length === 0 && shown.number > 1) {
    // A full last page has a cursor, and the page after it is empty: say so instead of "No events match."
    body = (
      <p className="budget-cap budget-pad" data-testid={IDS.auditEmpty}>
        No older events.
      </p>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="budget-empty" data-testid={IDS.auditEmpty}>
        <h2 className="budget-title">No events match.</h2>
        <p>Nothing in the log fits these filters. Widen the time range or clear a filter.</p>
        <Button variant="secondary" disabled={!active} onClick={clear}>
          Clear filters
        </Button>
      </div>
    );
  } else {
    body = (
      <table className="budget-table budget-audit-table" data-testid={IDS.table} data-nav-group="audit" aria-busy={view.busy ? "true" : undefined}>
        <caption className="budget-sr-only">Audit log, newest first</caption>
        <colgroup>
          <col className="budget-c-id" />
          <col className="budget-c-when" />
          <col className="budget-c-kind" />
          <col className="budget-c-actor" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Id</th>
            <th scope="col">When</th>
            <th scope="col">Kind</th>
            <th scope="col">Actor</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, index) => (
            <tr key={r.id} className="budget-audit-row" data-testid={IDS.auditRow} data-id={r.id} data-kind={r.kind} data-nav-row="" tabIndex={index === 0 ? 0 : -1}>
              <td className="budget-tn budget-dim" data-testid={IDS.auditId}>
                {r.id}
              </td>
              <td className="budget-tn">
                <time dateTime={r.at}>{whenText(r.at, now)}</time>
              </td>
              <td>
                <span className="budget-mono budget-clip" data-testid={IDS.auditKind}>
                  {r.kind}
                </span>
              </td>
              <td>
                <span className="budget-clip" data-testid={IDS.auditActor}>
                  {r.actor}
                </span>
              </td>
              <td>
                <span className="budget-clip" data-testid={IDS.auditDetail}>
                  {r.summary}
                </span>
                {r.refs === "" ? null : <span className="budget-cap budget-clip">{r.refs}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="budget-auditview" data-testid={IDS.audit}>
      <div className="budget-pad budget-tight">
        <div className="budget-crumb">
          <Button ref={backRef} size="row" variant="ghost" icon={<BackGlyph />} onClick={onBack} data-testid={IDS.back}>
            Back
          </Button>
          <span aria-hidden="true">·</span>
          <span>Budget &amp; audit</span>
          <span aria-hidden="true">/</span>
          <span>Audit log</span>
        </div>
        <div className="budget-dhead">
          <h2 className="budget-title">Audit log</h2>
          {active ? (
            <span data-testid={IDS.filtered}>
              <Badge tone="accent">filtered</Badge>
            </span>
          ) : null}
        </div>
        <div className="budget-fbar" role="group" aria-label="Filter the audit log" data-testid={IDS.filters}>
          <SelectField ref={kindRef} label="Kind" value={filter.kind} disabled={down} onChange={(e) => set({ kind: e.target.value })} data-testid={IDS.filterKind}>
            <Option value="">All kinds</Option>
            {kindOptions(seen.current, filter.kind).map((k) => (
              <Option key={k} value={k}>
                {k}
              </Option>
            ))}
          </SelectField>
          <SelectField label="Agent" value={filter.agent} disabled={down} onChange={(e) => set({ agent: e.target.value })} data-testid={IDS.filterAgent}>
            <Option value="">Any agent</Option>
            {agentChoices.map(([id, name]) => (
              <Option key={id} value={id}>
                {name}
              </Option>
            ))}
          </SelectField>
          <SelectField label="Playbook" value={filter.playbook} disabled={down} onChange={(e) => set({ playbook: e.target.value })} data-testid={IDS.filterPlaybook}>
            <Option value="">Any playbook</Option>
            {playbookChoices.map(([slug, name]) => (
              <Option key={slug} value={slug}>
                {name}
              </Option>
            ))}
          </SelectField>
          <SelectField
            label="Time range"
            value={filter.range}
            disabled={down}
            onChange={(e) => {
              if (isAuditRange(e.target.value)) set({ range: e.target.value });
            }}
            data-testid={IDS.filterRange}
          >
            {RANGES.map((r) => (
              <Option key={r.value} value={r.value}>
                {r.label}
              </Option>
            ))}
          </SelectField>
          <Button size="row" variant="ghost" disabled={down || !active} onClick={clear} data-testid={IDS.clear}>
            Clear filters
          </Button>
        </div>
        {failed !== undefined && shown !== undefined ? (
          <p className="budget-notice" data-tone="danger" role="alert" data-testid={IDS.auditError}>
            {`Couldn't refresh the audit log: ${failureDetail("GET /audit", failed)}. The rows below are the last read.`}
          </p>
        ) : null}
      </div>
      <div className="budget-tblw" ref={tableRef}>
        {body}
        <div className="budget-pager">
          <span className="budget-cap budget-tn" data-testid={IDS.footer}>
            {`${footerText(shown?.number ?? view.paging.cursors.length, rows.length)}${down ? " · last known" : ""}`}
          </span>
          <span className="budget-spacer" />
          <Button ref={newerRef} size="row" variant="secondary" disabled={down || view.moving || view.firstPage} onClick={view.newer} data-testid={IDS.newer}>
            Newer
          </Button>
          <Button ref={olderRef} size="row" variant="secondary" disabled={down || view.moving || view.next === null} onClick={view.older} data-testid={IDS.older}>
            Older
          </Button>
        </div>
        <p className="budget-cap">The log is append-only: no event can be changed or deleted.</p>
      </div>
    </div>
  );
}
