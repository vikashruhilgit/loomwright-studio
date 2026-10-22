// Card (docs/design/design-system/components/Card): one thing the user can
// open, an agent on Team or a task on the board. `surface` on `ground`, a
// `hairline` edge, `radius-md`, `space-4` padding, `shadow-1` on hover only.
// The whole card is the one action: it is focusable and opens on `Enter`,
// Space or a click. No buttons on its face; rename and create live in the
// inspector or a dialog.
//
// - `AgentCard`: a 36px `avatar` slot (this component never imports Avatar),
//   the name in `title-2` on one line with an ellipsis, the role (the
//   permission boundary in plain words) wrapping to a reserved two-line height
//   with the full role as the card's tooltip, the current task clamped at two
//   lines with the full text as its tooltip, then the budget block pinned to
//   the bottom: a 3px meter in `accent` (`attention` from 80%) with its
//   caption label directly beneath it ("142k of 375k today") and the model,
//   tabular, on a meta row that never wraps. The meter is the only divider.
//   Budgets are tokens, never dollars, on the subscription build.
// - `TaskCard`: the subject, linked PR/ticket chips (a slot for Badge's
//   `Chip`), and a state line of verified facts, each fact a Badge.
// - `CardGrid`: `auto-fill` columns with a 250px minimum and
//   `grid-auto-rows: 1fr`, so every card in the grid keeps the same height.
import { type KeyboardEvent, type ReactNode, useId } from "react";
import { Badge, type BadgeTone } from "../Badge/Badge";
import { type StatusState, StatusDot } from "../StatusDot/StatusDot";
import "./Card.css";

/** The meter turns `attention` at this share of the budget (Card README). */
export const BUDGET_ATTENTION_PERCENT = 80;

/** Tokens in the card's short form: 950, 9.4k, 142k, 1.2M. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  const oneDecimal = (value: number) => String(Math.round(value * 10) / 10);
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 10_000) return `${oneDecimal(tokens / 1000)}k`;
  if (Math.round(tokens / 1000) < 1000) return `${Math.round(tokens / 1000)}k`;
  return `${oneDecimal(tokens / 1_000_000)}M`;
}

/** The share of the budget used, clamped to 0–100. A zero limit with any use is full. */
export function budgetPercent(used: number, limit: number): number {
  if (!(limit > 0)) return used > 0 ? 100 : 0;
  const percent = (used / limit) * 100;
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

interface CardFrameProps {
  readonly kind: "agent" | "task";
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly tooltip?: string;
  readonly onOpen?: () => void;
  readonly children: ReactNode;
}

function CardFrame({ kind, labelledBy, describedBy, tooltip, onOpen, children }: CardFrameProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter" || event.key === " ") {
      // Space would otherwise scroll the page.
      event.preventDefault();
      onOpen?.();
    }
  };
  return (
    <div
      className="card"
      data-kind={kind}
      role="button"
      tabIndex={0}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy || undefined}
      title={tooltip}
      onClick={() => onOpen?.()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

export interface AgentBudget {
  /** Tokens used in the period. */
  readonly used: number;
  /** The token ceiling for the period. */
  readonly limit: number;
  /** The period's word in the label, for example "today". */
  readonly period?: string;
}

export interface AgentCardProps {
  /** The agent's 36px avatar, which carries identity and state. */
  readonly avatar?: ReactNode;
  readonly name: string;
  /** The permission boundary in plain words: "Reviewer · comments only, can't push". */
  readonly role: string;
  /** The current task, or what the agent last did. */
  readonly task?: string;
  /** The task line's StatusDot state. */
  readonly taskState?: StatusState;
  /** Required for an `ok` task dot (StatusDot's honest-ok rule). */
  readonly taskVerified?: { readonly at: string };
  readonly budget: AgentBudget;
  readonly model: string;
  readonly onOpen?: () => void;
}

export function AgentCard({ avatar, name, role, task, taskState, taskVerified, budget, model, onOpen }: AgentCardProps) {
  const id = useId();
  const percent = budgetPercent(budget.used, budget.limit);
  const label = `${formatTokens(budget.used)} of ${formatTokens(budget.limit)}${budget.period ? ` ${budget.period}` : ""}`;
  const describedBy = [`${id}-role`, task ? `${id}-task` : "", `${id}-budget`, `${id}-model`].filter(Boolean).join(" ");
  return (
    <CardFrame kind="agent" labelledBy={`${id}-name`} describedBy={describedBy} tooltip={role} onOpen={onOpen}>
      <div className="card-head">
        <span className="card-avatar">{avatar}</span>
        <div className="card-heading">
          <div className="card-name" id={`${id}-name`}>
            {name}
          </div>
          <div className="card-role" id={`${id}-role`}>
            {role}
          </div>
        </div>
      </div>
      {task ? (
        <div className="card-task-line">
          {taskState ? (
            <span className="card-task-dot">
              <StatusDot state={taskState} verified={taskVerified} hideLabel />
            </span>
          ) : null}
          <span className="card-task" id={`${id}-task`} data-idle={taskState === "idle" ? "true" : undefined} title={task}>
            {task}
          </span>
        </div>
      ) : null}
      <div className="card-budget">
        <span className="card-meter" data-level={percent >= BUDGET_ATTENTION_PERCENT ? "high" : "normal"} aria-hidden="true">
          <span className="card-meter-fill" style={{ width: `${percent}%` }} />
        </span>
        <div className="card-meta">
          <span className="card-meta-label" id={`${id}-budget`}>
            {label}
          </span>
          <span className="card-meta-model" id={`${id}-model`}>
            {model}
          </span>
        </div>
      </div>
    </CardFrame>
  );
}

export interface TaskFact {
  readonly label: string;
  /** Semantic colour only for a kernel state or a verified outcome; otherwise neutral. */
  readonly tone?: BadgeTone;
}

export interface TaskCardProps {
  readonly subject: string;
  /** Linked PR/ticket chips: pass Badge's `Chip` elements. */
  readonly chips?: ReactNode;
  /** The state line, built from verified facts only: "1/2 approvals", "CI green". */
  readonly facts?: readonly TaskFact[];
  readonly onOpen?: () => void;
}

export function TaskCard({ subject, chips, facts = [], onOpen }: TaskCardProps) {
  const id = useId();
  return (
    <CardFrame kind="task" labelledBy={`${id}-subject`} describedBy={facts.length > 0 ? `${id}-facts` : undefined} onOpen={onOpen}>
      <div className="card-subject" id={`${id}-subject`} title={subject}>
        {subject}
      </div>
      {chips ? <div className="card-chips">{chips}</div> : null}
      {facts.length > 0 ? (
        <div className="card-facts" id={`${id}-facts`}>
          {facts.map((fact, index) => (
            <Badge key={`${index}-${fact.label}`} tone={fact.tone}>
              {fact.label}
            </Badge>
          ))}
        </div>
      ) : null}
    </CardFrame>
  );
}

export interface CardGridProps {
  readonly label?: string;
  readonly children: ReactNode;
}

export function CardGrid({ label, children }: CardGridProps) {
  return (
    <div className="card-grid" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
