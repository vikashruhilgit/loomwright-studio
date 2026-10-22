// Charter: how a crew member comes to exist (docs/design/design-system/components/Charter/README.md
// + preview.html). The same object whether Wright drafts it in Chat or the user fills it in on Team.
//
// Sections map to kernel mechanisms: Identity, Persona, Duties, Tools, Boundaries, Model, Limits
// and the first playbook's dry run. Values Wright chose carry a `proposed` tag (D4). Tools that are
// not connected are listed, never hidden. Limits are tokens and sessions; a dollar figure is only
// ever an estimate shown as "≈$x/day at API rates" or "≈$x/run at API rates" (D24). Boundaries are always shown.
//
// Every string can come from a model or the user, so each is rendered as a React text child.
import type { KeyboardEvent, ReactNode } from "react";
import "./Charter.css";

/** A charter value. `proposed` marks a value Wright chose rather than the user (D4). */
export interface CharterValue {
  readonly value: string;
  readonly proposed?: boolean;
}

/** A connector this agent may call. A not-connected tool is allowed: its playbooks stay parked. */
export interface CharterTool {
  readonly name: string;
  readonly connected: boolean;
}

/** Limits, not budgets: tokens per day and sessions at once (D17, D24). */
export interface CharterLimits {
  readonly tokensPerDay: number;
  readonly sessionsAtOnce: number;
  /** True when Wright chose these limits. */
  readonly proposed?: boolean;
  /** Optional dollar estimate per day in USD, e.g. 2.4. Shown only as "≈$2.40/day at API rates", never as a limit. */
  readonly costEstimate?: number;
}

/** The first playbook's dry run: exactly what it would have done. */
export interface CharterDryRun {
  readonly text: string;
  /** Optional dollar estimate per run in USD, e.g. 0.08. Shown only as "≈$0.08/run at API rates". */
  readonly costEstimate?: number;
}

export interface CharterProps {
  /** Identity: the crew member's name. */
  readonly name: CharterValue;
  /** Identity: the Avatar (silhouette and hue), passed in by the screen. */
  readonly avatar?: ReactNode;
  /** Identity: the current silhouette's name, shown on the Shape button, e.g. "octopus". */
  readonly shape?: string;
  /** A short description badge in the header, e.g. "personal assistant". */
  readonly summary?: string;
  /** Voice and judgement in one or two lines. */
  readonly persona: string;
  /** Plain-English duties; Wright turns each into playbooks. */
  readonly duties: readonly string[];
  readonly tools: readonly CharterTool[];
  /** What it may never do, on top of the kernel's fixed rails. Always rendered. */
  readonly boundaries: readonly string[];
  readonly model: CharterValue;
  readonly limits: CharterLimits;
  /** The first playbook's dry run; absent until a duty has been drafted into a playbook. */
  readonly firstPlaybookDryRun?: CharterDryRun;
  /** Create the crew member (primary, ⏎). */
  readonly onCreate: () => void;
  /** Revise the charter by describing the change in English (E). */
  readonly onEditInEnglish: () => void;
  /** Open the shape picker; the picker dialog itself belongs to the Team screen. */
  readonly onPickShape: () => void;
}

/** 100000 → "100k", 1500000 → "1.5M"; plain digits below 1000. */
function formatTokens(n: number): string {
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  // 999_950 would round to "1000.0k", so it already reads as millions.
  if (n >= 999_950) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
}

function Proposed({ show, label = "proposed" }: { readonly show: boolean | undefined; readonly label?: string }) {
  return show ? <span className="charter__proposed">{label}</span> : null;
}

/** The one D24 shape: "≈$2.40/day at API rates". Two decimals, so the same number always reads the same. */
function formatEstimate(usd: number, suffix: string): string {
  return `≈$${usd.toFixed(2)}${suffix} at API rates`;
}

function hasEstimate(usd: number | undefined): usd is number {
  return usd !== undefined && Number.isFinite(usd);
}

function Estimate({ usd, suffix }: { readonly usd: number; readonly suffix: string }) {
  return (
    <span className="charter__estimate" data-testid="charter-estimate">
      {formatEstimate(usd, suffix)}
    </span>
  );
}

function Lines({ items, empty }: { readonly items: readonly string[]; readonly empty: string }) {
  if (items.length === 0) return <span className="charter__empty">{empty}</span>;
  return (
    <ul className="charter__lines">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function isTextEntry(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function isControl(target: EventTarget): boolean {
  return target instanceof HTMLElement && ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function Charter(props: CharterProps) {
  const { name, avatar, shape, summary, persona, duties, tools, boundaries, model, limits, firstPlaybookDryRun, onCreate, onEditInEnglish, onPickShape } = props;

  // Shortcuts apply only while focus is inside the charter; the global keymap is the shell's.
  // Enter on a focused button is left to that button's own activation.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target)) return;
    if ((event.key === "e" || event.key === "E") && !event.shiftKey) {
      event.preventDefault();
      onEditInEnglish();
    } else if (event.key === "Enter" && !isControl(event.target)) {
      event.preventDefault();
      onCreate();
    }
  }

  const sessions = `${limits.sessionsAtOnce} ${limits.sessionsAtOnce === 1 ? "session" : "sessions"} at once`;

  return (
    <section className="charter" aria-label={`Charter for ${name.value}`} onKeyDown={onKeyDown}>
      <div className="charter__identity" role="group" aria-label="Identity" data-section="identity">
        {avatar !== undefined ? <span className="charter__avatar">{avatar}</span> : null}
        <b className="charter__name">{name.value}</b>
        <Proposed show={name.proposed} label="name proposed" />
        <span className="charter__badge">draft</span>
        {summary !== undefined ? <span className="charter__badge">{summary}</span> : null}
      </div>
      <dl className="charter__kv">
        <dt>Persona</dt>
        <dd data-section="persona">{persona}</dd>

        <dt>Duties</dt>
        <dd data-section="duties">
          <Lines items={duties} empty="No duties yet" />
        </dd>

        <dt>Tools</dt>
        <dd data-section="tools">
          {tools.length === 0 ? (
            <span className="charter__empty">No tools</span>
          ) : (
            <ul className="charter__tools">
              {tools.map((tool, i) => (
                <li key={i} className="charter__chip" data-connected={tool.connected}>
                  <span>{tool.name}</span>
                  {tool.connected ? (
                    <span className="charter__connected">
                      <span className="charter__dot" aria-hidden="true" />
                      <span className="charter__sr-only">connected</span>
                    </span>
                  ) : (
                    <span className="charter__badge charter__badge--attention">not connected</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </dd>

        <dt>Boundaries</dt>
        <dd data-section="boundaries">
          <Lines items={boundaries} empty="No extra boundaries. The kernel's fixed rails still apply." />
        </dd>

        <dt>Model</dt>
        <dd data-section="model">
          {model.value}
          <Proposed show={model.proposed} />
        </dd>

        <dt>Limits</dt>
        <dd data-section="limits" className="charter__limits">
          <span>
            {formatTokens(limits.tokensPerDay)} tokens / day · {sessions}
          </span>
          <Proposed show={limits.proposed} />
          {hasEstimate(limits.costEstimate) ? (
            <span className="charter__meta">
              {" · "}
              <Estimate usd={limits.costEstimate} suffix="/day" />
            </span>
          ) : null}
        </dd>
      </dl>
      <div className="charter__dry" data-section="dry-run">
        <span className="charter__dry-label">first playbook · </span>
        {firstPlaybookDryRun !== undefined ? (
          <>
            {firstPlaybookDryRun.text}
            {hasEstimate(firstPlaybookDryRun.costEstimate) ? (
              <span className="charter__dry-label">
                {" · "}
                <Estimate usd={firstPlaybookDryRun.costEstimate} suffix="/run" />
              </span>
            ) : null}
          </>
        ) : (
          <span className="charter__dry-label">no playbook drafted yet</span>
        )}
      </div>
      <div className="charter__actions">
        <button type="button" className="charter__btn charter__btn--primary" aria-keyshortcuts="Enter" onClick={onCreate}>
          Create {name.value}
          <kbd className="charter__kbd" aria-hidden="true">
            ⏎
          </kbd>
        </button>
        <button type="button" className="charter__btn" aria-keyshortcuts="E" onClick={onEditInEnglish}>
          Edit in English
          <kbd className="charter__kbd" aria-hidden="true">
            E
          </kbd>
        </button>
        <button type="button" className="charter__btn charter__btn--shape" aria-haspopup="dialog" onClick={onPickShape}>
          Shape
          {shape !== undefined ? (
            <>
              {" "}
              <span className="charter__shape-name">{shape}</span>
            </>
          ) : null}
        </button>
      </div>
    </section>
  );
}
