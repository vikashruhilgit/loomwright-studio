// The overview's sections (phase 7 item 07), built to the mockup's `budgetScreen`: tokens counted per
// day, by agent and by playbook against their limits, the three latest audit events, and the
// inspector (the subscription cap, today's total).
//
// Rows are keyed by their day, agent id, playbook slug or event id and have fixed heights, so a live
// refetch that changes a figure changes text inside a row and moves nothing. The first row of each
// table is the one tab stop; J and K move between the rest (`BudgetScreen.tsx`'s key handler).
// Every name, slug and payload string is untrusted: a React text child, never markup.
import type { BudgetCapState, BudgetLimitUsage, PlaybookListing, RosterEntry } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { formatEstimate } from "../../components/formatEstimate";
import {
  BUDGET_TEST_IDS as IDS,
  busiestMeterLabel,
  busiestShare,
  capAccountLabel,
  capCaption,
  capMeterLabel,
  capNote,
  capStatusView,
  formatTokens,
  limitFigure,
  agentName,
  playbookName,
  safe,
  sessionsLabel,
  utilizationPercent,
  whenText,
} from "./model";
import type { AuditRow, DayFigure } from "./model";
import { LimitCell, Meter } from "./parts";

const rowTab = (first: boolean): number => (first ? 0 : -1);

export function DayTable({ days }: { readonly days: readonly DayFigure[] }) {
  const busiest = Math.max(0, ...days.map((d) => d.counted));
  return (
    <section className="budget-blk" aria-labelledby="budget-day-h">
      <div className="budget-sech">
        <h2 className="budget-label" id="budget-day-h">
          Tokens counted per day
        </h2>
        <span className="budget-cap">Limits are per agent and per playbook, below.</span>
      </div>
      <table className="budget-table budget-day" data-testid={IDS.dayTable} data-nav-group="days">
        <caption className="budget-sr-only">Tokens counted per day</caption>
        <colgroup>
          <col className="budget-c-day" />
          <col />
          <col className="budget-c-cache" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Counted tokens</th>
            <th scope="col">Cache reads (not counted)</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, index) => (
            <tr key={d.day} data-testid={IDS.dayRow} data-day={d.day} data-today={d.today ? "true" : undefined} data-nav-row="" tabIndex={rowTab(index === 0)}>
              <td>{d.label}</td>
              <td>
                <span className="budget-tn">
                  <b>{formatTokens(d.counted)}</b>
                </span>
                <Meter percent={busiestShare(d.counted, busiest)} label={busiestMeterLabel(busiestShare(d.counted, busiest))} />
              </td>
              <td className="budget-tn budget-dim">{formatTokens(d.cacheReads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function avatarState(limit: BudgetLimitUsage, atLimit: boolean): AvatarState {
  if (atLimit) return "waiting";
  return limit.sessions_running > 0 ? "working" : "idle";
}

export function AgentTable({ limits, roster }: { readonly limits: readonly BudgetLimitUsage[]; readonly roster: readonly RosterEntry[] | undefined }) {
  return (
    <section className="budget-blk" aria-labelledby="budget-agent-h">
      <div className="budget-sech">
        <h2 className="budget-label" id="budget-agent-h">
          By agent · today
        </h2>
        <span className="budget-cap">Daily token limit and sessions at once</span>
      </div>
      <table className="budget-table budget-agents" data-testid={IDS.agentTable} data-nav-group="agents">
        <caption className="budget-sr-only">Tokens today by agent</caption>
        <colgroup>
          <col className="budget-c-name" />
          <col />
          <col className="budget-c-sessions" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">Tokens against its daily limit</th>
            <th scope="col">Sessions at once</th>
          </tr>
        </thead>
        <tbody>
          {limits.map((l, index) => {
            const figure = limitFigure(l.tokens_today, l.tokens_per_day);
            const entry = roster?.find((a) => a.id === l.id);
            const name = agentName(l.id, roster);
            return (
              <tr key={l.id} data-testid={IDS.agentRow} data-agent={l.id} data-waiting={figure.atLimit ? "true" : undefined} data-nav-row="" tabIndex={rowTab(index === 0)}>
                <td>
                  <span className="budget-by">
                    <Avatar agent={{ id: l.id, name, shape: entry?.avatar.shape, hue: entry?.avatar.hue }} state={avatarState(l, figure.atLimit)} size={20} />
                    <span className="budget-clip" data-testid={IDS.agentName}>
                      {name}
                    </span>
                  </span>
                </td>
                <td>
                  <LimitCell figure={figure} testId={IDS.agentLimit} />
                </td>
                <td className="budget-tn" data-testid={IDS.agentSessions}>
                  {sessionsLabel(l.sessions_running, l.sessions_at_once)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function PlaybookTable({
  limits,
  playbooks,
  roster,
}: {
  readonly limits: readonly BudgetLimitUsage[];
  readonly playbooks: readonly PlaybookListing[] | undefined;
  readonly roster: readonly RosterEntry[] | undefined;
}) {
  return (
    <section className="budget-blk" aria-labelledby="budget-playbook-h">
      <div className="budget-sech">
        <h2 className="budget-label" id="budget-playbook-h">
          By playbook · today
        </h2>
        <span className="budget-cap">Daily token limit</span>
      </div>
      <table className="budget-table budget-playbooks" data-testid={IDS.playbookTable} data-nav-group="playbooks">
        <caption className="budget-sr-only">Tokens today by playbook</caption>
        <thead>
          <tr>
            <th scope="col">Playbook</th>
            <th scope="col">Tokens against its daily limit</th>
          </tr>
        </thead>
        <tbody>
          {limits.map((l, index) => {
            const listing = playbooks?.find((p) => p.slug === l.id);
            const owner = listing === undefined ? "" : agentName(listing.owning_agent, roster);
            const off = listing !== undefined && listing.status !== "enabled";
            return (
              <tr key={l.id} data-testid={IDS.playbookRow} data-playbook={l.id} data-nav-row="" tabIndex={rowTab(index === 0)}>
                <td>
                  <b className="budget-clip">{playbookName(l.id, playbooks)}</b>
                  <span className="budget-cap budget-clip">{`${owner}${off ? (owner === "" ? "off" : " · off") : ""}`}</span>
                </td>
                <td>
                  <LimitCell figure={limitFigure(l.tokens_today, l.tokens_per_day)} testId={IDS.playbookLimit} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** "Latest in the audit log": the newest events as the mockup's `evc` cards, and the way into the full log. */
export function Latest({
  rows,
  loading,
  offline,
  now,
  onOpen,
}: {
  readonly rows: readonly AuditRow[];
  readonly loading: boolean;
  readonly offline: boolean;
  readonly now: Date;
  readonly onOpen: () => void;
}) {
  return (
    <section className="budget-blk" aria-labelledby="budget-latest-h" data-testid={IDS.latest}>
      <div className="budget-sech">
        <h2 className="budget-label" id="budget-latest-h">
          Latest in the audit log
        </h2>
        <span className="budget-spacer" />
        <Button size="row" variant="ghost" disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={onOpen} data-opener="latest" data-testid={IDS.openLog}>
          Open the full log
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="budget-cap budget-latest-note">{loading ? "Loading the latest events…" : "Nothing has been written to the log yet."}</p>
      ) : (
        <ul className="budget-evs" aria-labelledby="budget-latest-h" data-nav-group="latest">
          {rows.map((r, index) => (
            <li key={r.id} className="budget-evc" data-testid={IDS.latestCard} data-id={r.id} data-nav-row="" tabIndex={rowTab(index === 0)}>
              <div className="budget-evc-top">
                <b className="budget-mono budget-clip">{r.kind}</b>
                <span className="budget-clip">{r.actor}</span>
                <time className="budget-tn budget-cap" dateTime={r.at}>
                  {whenText(r.at, now)}
                </time>
              </div>
              <p className="budget-clip">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The inspector: the subscription cap with each window's reset, and today's total with its one estimate. */
export function Inspector({
  cap,
  statusCap,
  todayTokens,
  todayCost,
  todayCacheReads,
  lastKnown,
  now,
}: {
  readonly cap: BudgetCapState;
  readonly statusCap: BudgetCapState | undefined;
  readonly todayTokens: number;
  readonly todayCost: number | null;
  readonly todayCacheReads: number;
  readonly lastKnown: boolean;
  readonly now: Date;
}) {
  const estimate = todayCost === null ? null : formatEstimate(todayCost);
  return (
    <aside className="budget-inspector" aria-label="Cap and estimate">
      <section className="budget-blk" aria-labelledby="budget-cap-h" data-testid={IDS.cap}>
        <div className="budget-sech">
          <h2 className="budget-label" id="budget-cap-h">
            Subscription cap
          </h2>
        </div>
        {cap.map((entry) => (
          <div key={`${entry.provider}:${entry.account}`} className="budget-blk">
            <span className="budget-cap">{`${capAccountLabel(entry, statusCap)}${lastKnown ? " · last known" : ""}`}</span>
            {entry.limits.map((w) => {
              const status = capStatusView(w.status);
              const percent = utilizationPercent(w.utilization);
              return (
                <div key={w.rate_limit_type} className="budget-blk budget-window" data-testid={IDS.capWindow} data-window={w.rate_limit_type}>
                  <div className="budget-sech">
                    <b className="budget-mono">{safe(w.rate_limit_type)}</b>
                    <span className="budget-spacer" />
                    <span data-testid={IDS.capStatus}>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </span>
                  </div>
                  {percent === null ? null : <Meter percent={percent} label={capMeterLabel(w.rate_limit_type, percent)} />}
                  <span className="budget-cap budget-tn" data-testid={IDS.capText}>
                    {capCaption(w, now)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        <span className="budget-cap">{capNote(cap)}</span>
      </section>
      <section className="budget-blk" aria-labelledby="budget-now-h" data-testid={IDS.today}>
        <h2 className="budget-label" id="budget-now-h">
          Today
        </h2>
        <div className="budget-tn" data-testid={IDS.todayTokens}>
          <b>{formatTokens(todayTokens)}</b> tokens counted
        </div>
        {estimate === null ? null : (
          <span className="budget-cap" data-testid={IDS.todayEstimate}>
            {`${estimate}. An estimate from list prices, not a bill.`}
          </span>
        )}
        <span className="budget-cap">{`Cache reads (${formatTokens(todayCacheReads)}) are shown, never counted. A limit counts input, output and cache-write tokens.`}</span>
      </section>
    </aside>
  );
}
