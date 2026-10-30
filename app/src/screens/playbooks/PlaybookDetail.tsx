// One playbook (phase 7 item 04): its intent, every policy value with who set it,
// its trigger, the On switch, its tokens and its recent runs, and the actions:
// Edit in English, Edit fields, Version history and Run now. Every value is the
// kernel's own answer (the live store and the screen's two reads); nothing here is
// predicted or defaulted, and an unset value reads "not set".
import type { Approval, PlaybookListing, PlaybookRun, Trigger } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import type { BadgeTone } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { when } from "../chat/model";
import {
  NOT_COUNTED,
  NOT_SET,
  NO_RUNS,
  PLAYBOOKS_TEST_IDS as IDS,
  dedupeText,
  isOn,
  limitText,
  runItemText,
  runKindWord,
  runTokensText,
  safe,
  safeBlock,
  stateOf,
  tokenFigure,
  tokensOfRuns,
  setValueOrNotSet,
  triggerText,
  valueOrNotSet,
} from "./model";
import type { Read } from "./useHistory";
import { type Notice, type PlaybookActions, PlaybookSwitch, RunStatus, SetBy, Skeleton, TurnOnNote } from "./parts";

const STATE_TONE: Readonly<Record<string, BadgeTone>> = { on: "ok", draft: "attention", off: "neutral" };

/** How many of the newest runs the inspector lists. */
export const RECENT_RUNS = 10;

export interface PlaybookDetailProps {
  readonly playbook: PlaybookListing;
  readonly trigger: Trigger | undefined;
  /** The pending enable approval that names this playbook, if any. */
  readonly approval: Approval | undefined;
  readonly runs: Read<readonly PlaybookRun[]>;
  readonly actions: PlaybookActions;
  /** The switch was clicked in the off position: show how it turns on. */
  readonly turnOnOpen: boolean;
  /** A Turn off refusal, in the kernel's words. */
  readonly offNotice: Notice | undefined;
  /** Run now's answer (queued, or the kernel's refusal). */
  readonly runNotice: Notice | undefined;
  readonly onBack: () => void;
  readonly onEdit: () => void;
  readonly onHistory: () => void;
}

/** The "Playbooks / name" line with its back button. */
export function Crumb({ label, name, onBack }: { readonly label: string; readonly name: string; readonly onBack: () => void }) {
  return (
    <div className="pb-crumb">
      <Button variant="ghost" size="standalone" data-pb-back="" onClick={onBack}>
        {label}
      </Button>
      <span aria-hidden="true">/</span>
      <span>{name}</span>
    </div>
  );
}

function PolicyRow({ label, value, setBy, mono = false, note }: { readonly label: string; readonly value: string; readonly setBy: string | null; readonly mono?: boolean; readonly note?: string }) {
  return (
    <div className="pb-row" data-testid={IDS.field} data-field={label}>
      <dt>{label}</dt>
      <dd>
        <span className="pb-value">
          <span className={mono ? "pb-mono" : undefined}>{value}</span>
          <SetBy setBy={value === NOT_SET ? null : setBy} />
          {note === undefined ? null : <span className="pb-cap">{note}</span>}
        </span>
      </dd>
    </div>
  );
}

function RunsSection({ runs }: { readonly runs: Read<readonly PlaybookRun[]> }) {
  if (runs.data === undefined) {
    return (
      <section className="pb-block" aria-labelledby="pb-h-runs" data-testid={IDS.runs}>
        <h3 id="pb-h-runs">Recent runs</h3>
        {runs.failed ? <p className="pb-cap">The runs could not be read from the kernel.</p> : <Skeleton rows={1} />}
      </section>
    );
  }
  const shown = runs.data.slice(0, RECENT_RUNS);
  return (
    <section className="pb-block" aria-labelledby="pb-h-runs" data-testid={IDS.runs}>
      <h3 id="pb-h-runs">Recent runs</h3>
      {runs.failed ? <p className="pb-cap">Last known: the runs could not be refreshed.</p> : null}
      {shown.length === 0 ? (
        <p className="pb-cap">{NO_RUNS}</p>
      ) : (
        <ul className="pb-runs">
          {shown.map((run) => (
            <li key={run.id} data-testid={IDS.run} data-run={run.id}>
              <span>
                <RunStatus status={run.status} />
                <b>{runKindWord(run.kind)}</b>
                <span className="pb-spacer" />
                <time className="pb-cap" dateTime={run.started}>
                  {when(run.started)}
                </time>
              </span>
              <span className="pb-cap pb-tn">{`${runTokensText(run)} · version ${run.version}`}</span>
              {runItemText(run) === "" ? null : <span className="pb-cap">{runItemText(run)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TokensSection({ playbook, runs }: { readonly playbook: PlaybookListing; readonly runs: Read<readonly PlaybookRun[]> }) {
  const sums = runs.data === undefined ? undefined : tokensOfRuns(runs.data);
  return (
    <section className="pb-block" aria-labelledby="pb-h-tokens" data-testid={IDS.tokens}>
      <h3 id="pb-h-tokens">Tokens</h3>
      {sums === undefined ? (
        <p className="pb-cap">{runs.failed ? "Not known: the runs could not be read." : "Reading the runs…"}</p>
      ) : sums.runs === 0 ? (
        <p className="pb-cap">{NO_RUNS}</p>
      ) : (
        <>
          <div className="pb-figure">
            <b>{tokenFigure(sums.counted)}</b> tokens counted in the last {sums.runs} {sums.runs === 1 ? "run" : "runs"}
          </div>
          {sums.pending === 0 ? null : <span className="pb-cap">{`${sums.pending} ${sums.pending === 1 ? "run" : "runs"}: ${NOT_COUNTED}`}</span>}
        </>
      )}
      <span className="pb-cap">{`Limit per day: ${limitText(playbook.token_limit_per_day)}${playbook.token_limit_per_day === null ? "" : " tokens"}`}</span>
      <span className="pb-cap">Counted tokens, never dollars.</span>
    </section>
  );
}

export function PlaybookDetail({ playbook, trigger, approval, runs, actions, turnOnOpen, offNotice, runNotice, onBack, onEdit, onHistory }: PlaybookDetailProps) {
  const state = stateOf(playbook);
  const on = isOn(playbook);
  const nextFire = playbook.next_fire_at ?? trigger?.next_fire_at ?? null;
  const runBusy = actions.pending === `run:${playbook.id}`;
  return (
    <div className="pb-split" data-testid={IDS.detail} data-playbook={playbook.id}>
      <div className="pb-main">
        <Crumb label="Playbooks" name={safe(playbook.name)} onBack={onBack} />
        <div className="pb-head">
          <h2>{safe(playbook.name)}</h2>
          <Badge tone={STATE_TONE[state] ?? "neutral"}>{state === "on" ? "on" : state === "draft" ? "draft" : "off"}</Badge>
          <Badge>{`v${playbook.version}`}</Badge>
          {playbook.mode_set_by === null ? null : <Badge>{safe(playbook.mode)}</Badge>}
          <span className="pb-cap pb-mono">{safe(playbook.slug)}</span>
        </div>
        <div className="pb-actions">
          <Button variant="primary" size="standalone" data-testid={IDS.editEnglish} disabled={actions.offline} onClick={() => actions.editInEnglish(playbook)}>
            Edit in English
          </Button>
          <Button variant="secondary" size="standalone" data-testid={IDS.editFields} onClick={onEdit}>
            Edit fields
          </Button>
          <Button variant="ghost" size="standalone" data-testid={IDS.history} onClick={onHistory}>
            Version history
          </Button>
          <Button
            variant="secondary"
            size="standalone"
            data-testid={IDS.runNow}
            loading={runBusy}
            disabled={actions.offline || !on || (actions.pending !== null && !runBusy)}
            onClick={() => actions.runNow(playbook)}
          >
            Run now
          </Button>
        </div>
        <p className="pb-status-line" role="status" data-tone={runNotice?.tone} data-testid={IDS.runNowStatus}>
          {runNotice?.text ?? (on ? "" : "Run now needs the playbook on.")}
        </p>
        <section className="pb-block" aria-labelledby="pb-h-intent">
          <h3 id="pb-h-intent">Intent</h3>
          <p className="pb-text">{safeBlock(playbook.intent)}</p>
        </section>
        <section className="pb-block" aria-labelledby="pb-h-policy">
          <h3 id="pb-h-policy">Policy</h3>
          <span className="pb-cap">Every value shows who set it. A value nobody set reads "not set".</span>
          <dl className="pb-rows">
            <PolicyRow label="Dedupe key" value={dedupeText(playbook.dedupe_key_spec)} setBy={playbook.dedupe_key_set_by} mono />
            <PolicyRow label="Priority" value={setValueOrNotSet(playbook.priority, playbook.priority_set_by)} setBy={playbook.priority_set_by} />
            <PolicyRow label="Model" value={valueOrNotSet(playbook.model)} setBy={playbook.model_set_by} />
            <PolicyRow label="Effort" value={valueOrNotSet(playbook.effort)} setBy={playbook.effort_set_by} note="recorded only" />
            <PolicyRow
              label="Token limit per day"
              value={limitText(playbook.token_limit_per_day)}
              setBy={playbook.token_limit_set_by}
              note={playbook.token_limit_per_day === null ? undefined : "tokens"}
            />
            <PolicyRow label="Mode" value={setValueOrNotSet(playbook.mode, playbook.mode_set_by)} setBy={playbook.mode_set_by} note="outward calls are recorded, never sent" />
          </dl>
        </section>
        <section className="pb-block" aria-labelledby="pb-h-trigger">
          <h3 id="pb-h-trigger">Trigger</h3>
          <dl className="pb-kv">
            <dt>Fires on</dt>
            <dd>{triggerText(trigger, playbook)}</dd>
            <dt>Next fire</dt>
            <dd className="pb-tn">{nextFire === null ? "not scheduled" : when(nextFire)}</dd>
            <dt>Last result</dt>
            <dd>{trigger === undefined ? "none" : trigger.last_result === null ? "none yet" : safe(trigger.last_result)}</dd>
            <dt>Owner</dt>
            <dd>{safe(playbook.owning_agent)}</dd>
          </dl>
        </section>
      </div>
      <aside className="pb-inspector" aria-label="Runs and tokens">
        <div className="pb-inspector-head">
          <h3>{`Playbook is ${on ? "on" : "off"}`}</h3>
          <PlaybookSwitch playbook={playbook} actions={actions} />
        </div>
        {offNotice === undefined ? null : (
          <p className="pb-notice" data-tone={offNotice.tone} role="alert">
            {offNotice.text}
          </p>
        )}
        {turnOnOpen && !on ? <TurnOnNote playbook={playbook} approval={approval} actions={actions} /> : null}
        <TokensSection playbook={playbook} runs={runs} />
        <RunsSection runs={runs} />
      </aside>
    </div>
  );
}
