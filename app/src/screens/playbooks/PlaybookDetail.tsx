// One playbook (phase 7 item 04): its intent, every policy value with who set it,
// its trigger, the On switch, its tokens and its recent runs, and the actions:
// Edit in English, Edit fields, Version history and Run now, and the Mode control (Draft or
// Live; Live asks first and only on an enabled playbook). Every value is the
// kernel's own answer (the live store and the screen's two reads); nothing here is
// predicted or defaulted, and an unset value reads "not set".
import { useState } from "react";
import type { Approval, PlaybookChangeResponse, PlaybookListing, PlaybookRun, RosterEntry, Trigger } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import type { BadgeTone } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { Icon } from "../../components/icons";
import type { KernelPolicyField } from "../../components/PlaybookPolicy/PlaybookPolicy";
import { navigate, when } from "../chat/model";
import type { WriteOutcome } from "../chat/model";
import {
  ASK_DRY_RUN_ENABLE_LABEL,
  LIVE_EXPLANATION,
  LIVE_NEEDS_ENABLE_TEXT,
  LIVE_NEXT_STEP_TEXT,
  NOT_COUNTED,
  NOT_SET,
  NO_RUNS,
  PLAYBOOKS_TEST_IDS as IDS,
  SCHEDULES_HASH,
  dedupeText,
  isOn,
  limitText,
  liveChoosable,
  modeCaption,
  modeSavedText,
  runItemText,
  runKindWord,
  runTokensText,
  safe,
  safeBlock,
  shortModel,
  stateOf,
  tokenFigure,
  tokensOfRuns,
  setValueOrNotSet,
  triggerText,
  valueOrNotSet,
} from "./model";
import type { Read } from "./useHistory";
import { type Notice, type PlaybookActions, PlaybookCrumb, PlaybookSwitch, RunStatus, SetBy, Skeleton, TurnOnNote } from "./parts";

const STATE_TONE: Readonly<Record<string, BadgeTone>> = { on: "ok", draft: "attention", off: "neutral" };

/** How many of the newest runs the inspector lists. */
export const RECENT_RUNS = 10;

export interface PlaybookDetailProps {
  readonly playbook: PlaybookListing;
  readonly trigger: Trigger | undefined;
  /** The owning agent from the roster and its avatar state; `undefined` when the roster does not list it (or is not read yet). */
  readonly owner: { readonly agent: RosterEntry; readonly state: AvatarState } | undefined;
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
  /** The Live confirm is open (the screen holds it, so the ⌘K command can open it). */
  readonly liveAskOpen: boolean;
  /** Choosing Live: open the confirm. Sends nothing. */
  readonly onAskLive: (playbook: PlaybookListing) => void;
  /** The confirm's Cancel (and Escape): close it. Sends nothing. */
  readonly onCancelLive: () => void;
  /** One field's Set, through the screen's guard; `undefined` when the guard dropped it. */
  readonly onSet: (playbook: PlaybookListing, field: KernelPolicyField, value: string) => Promise<WriteOutcome<PlaybookChangeResponse> | undefined>;
  /** Put the dry-run-and-enable line in Wright's composer and open his thread. Sends nothing. */
  readonly onAskDryRunEnable: (playbook: PlaybookListing) => void;
}

/**
 * One policy row, drawn as the mockup's `.pf`: label, value (with its caption beside it), then who set it
 * in the row's right column. `title` carries the full stored value when the shown text is shortened.
 */
function PolicyRow({ label, value, setBy, mono = false, note, title }: { readonly label: string; readonly value: string; readonly setBy: string | null; readonly mono?: boolean; readonly note?: string; readonly title?: string }) {
  const chip = <SetBy setBy={value === NOT_SET ? null : setBy} />;
  return (
    <div className="pb-row" data-testid={IDS.field} data-field={label}>
      <dt>{label}</dt>
      <dd>
        <span className="pb-value">
          <span className={mono ? "pb-mono" : undefined} title={title}>
            {value}
          </span>
          {note === undefined ? null : <span className="pb-cap">{note}</span>}
        </span>
      </dd>
      <dd className="pb-chipcell">{chip}</dd>
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
  // The same newest runs Recent runs lists, so "the last N runs" names runs the owner can see below.
  const sums = runs.data === undefined ? undefined : tokensOfRuns(runs.data.slice(0, RECENT_RUNS));
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

/** The card's Mode control: Draft or Live, the stored mode marked chosen. Lives below the Policy rows, never inside a row's chip cell. */
function ModeControl({
  playbook,
  actions,
  liveAskOpen,
  onAskLive,
  onCancelLive,
  onSet,
  onAskDryRunEnable,
}: Pick<PlaybookDetailProps, "playbook" | "actions" | "liveAskOpen" | "onAskLive" | "onCancelLive" | "onSet" | "onAskDryRunEnable">) {
  const [note, setNote] = useState<Notice | undefined>(undefined);
  // Live was set and the kernel wrote a version: the next step (dry run, then enable) is Wright's to start.
  const [next, setNext] = useState(false);
  const isLive = playbook.mode === "live";
  const held = actions.offline || actions.pending !== null;

  const settle = async (answer: Promise<WriteOutcome<PlaybookChangeResponse> | undefined>, toLive: boolean): Promise<void> => {
    const outcome = await answer;
    // Dropped by the guard: an earlier write is still pending, and its answer is the one to show.
    if (outcome === undefined) return;
    if (!outcome.ok) {
      setNote({ tone: "danger", text: outcome.text });
      setNext(false);
      return;
    }
    setNote({ tone: "ok", text: modeSavedText(outcome.body) });
    setNext(toLive && outcome.body.changed);
  };
  const confirmLive = (): void => {
    onCancelLive();
    setNote(undefined);
    setNext(false);
    void settle(onSet(playbook, "mode", "live"), true);
  };
  const chooseDraft = (): void => {
    if (!isLive) return;
    setNote(undefined);
    setNext(false);
    void settle(onSet(playbook, "mode", "draft"), false);
  };
  const chooseLive = (): void => {
    if (liveChoosable(playbook)) onAskLive(playbook);
  };

  return (
    <div className="pb-mode" data-testid={IDS.modeControl}>
      <div className="pb-actions" role="radiogroup" aria-label="Mode">
        <Button
          variant={isLive ? "ghost" : "primary"}
          size="row"
          role="radio"
          aria-checked={playbook.mode !== "live"}
          data-testid={IDS.modeDraft}
          disabled={held}
          onClick={chooseDraft}
        >
          Draft
        </Button>
        <Button
          variant={isLive ? "primary" : "ghost"}
          size="row"
          role="radio"
          aria-checked={playbook.mode === "live"}
          data-testid={IDS.modeLive}
          disabled={held || (!isLive && !liveChoosable(playbook))}
          onClick={chooseLive}
        >
          Live
        </Button>
      </div>
      {isLive || isOn(playbook) ? null : (
        <span className="pb-cap" data-testid={IDS.modeNeedsEnable}>
          {LIVE_NEEDS_ENABLE_TEXT}
        </span>
      )}
      {note === undefined ? null : (
        <p className="pb-notice" data-tone={note.tone} role={note.tone === "danger" ? "alert" : "status"} data-testid={IDS.modeNote}>
          {note.text}
        </p>
      )}
      {next ? (
        <div className="pb-actions" data-testid={IDS.modeNextStep}>
          <span className="pb-cap">{LIVE_NEXT_STEP_TEXT}</span>
          <Button variant="secondary" size="row" data-testid={IDS.askDryRunEnable} icon={<Icon name="chat" className="pb-glyph" />} disabled={actions.offline} onClick={() => onAskDryRunEnable(playbook)}>
            {ASK_DRY_RUN_ENABLE_LABEL}
          </Button>
        </div>
      ) : null}
      {liveAskOpen ? (
        <Dialog
          kind="decision"
          title={`Turn on live mode for “${safe(playbook.name)}”?`}
          description={LIVE_EXPLANATION}
          action={{ label: "Set live", onAction: confirmLive }}
          onCancel={onCancelLive}
        />
      ) : null}
    </div>
  );
}

export function PlaybookDetail({
  playbook,
  trigger,
  owner,
  approval,
  runs,
  actions,
  turnOnOpen,
  offNotice,
  runNotice,
  onBack,
  onEdit,
  onHistory,
  liveAskOpen,
  onAskLive,
  onCancelLive,
  onSet,
  onAskDryRunEnable,
}: PlaybookDetailProps) {
  const state = stateOf(playbook);
  const on = isOn(playbook);
  const nextFire = playbook.next_fire_at ?? trigger?.next_fire_at ?? null;
  const runBusy = actions.pending === `run:${playbook.id}`;
  return (
    <div className="pb-split" data-testid={IDS.detail} data-playbook={playbook.id}>
      <div className="pb-main">
        <PlaybookCrumb parent="Playbooks" current={safe(playbook.name)} onBack={onBack} />
        <div className="pb-head">
          <h2>{safe(playbook.name)}</h2>
          <Badge tone={STATE_TONE[state] ?? "neutral"}>{state === "on" ? "on" : state === "draft" ? "draft" : "off"}</Badge>
          <Badge>{`v${playbook.version}`}</Badge>
          {playbook.mode_set_by === null ? null : <Badge>{safe(playbook.mode)}</Badge>}
        </div>
        <div className="pb-actions">
          <Button variant="primary" size="standalone" data-testid={IDS.editEnglish} icon={<Icon name="chat" className="pb-glyph" />} disabled={actions.offline} onClick={() => actions.editInEnglish(playbook)}>
            Edit in English
          </Button>
          <Button variant="secondary" size="standalone" data-testid={IDS.editFields} icon={<Icon name="pencil" className="pb-glyph" />} onClick={onEdit}>
            Edit fields
          </Button>
          <Button variant="ghost" size="standalone" data-testid={IDS.history} icon={<Icon name="history" className="pb-glyph" />} onClick={onHistory}>
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
          <dl className="pb-rows pb-rows-policy">
            <PolicyRow label="Dedupe key" value={dedupeText(playbook.dedupe_key_spec)} setBy={playbook.dedupe_key_set_by} mono />
            <PolicyRow label="Priority" value={setValueOrNotSet(playbook.priority, playbook.priority_set_by)} setBy={playbook.priority_set_by} />
            <PolicyRow label="Model" value={shortModel(playbook.model)} setBy={playbook.model_set_by} title={playbook.model === null ? undefined : safe(playbook.model)} />
            <PolicyRow label="Effort" value={valueOrNotSet(playbook.effort)} setBy={playbook.effort_set_by} note="recorded only" />
            <PolicyRow
              label="Token limit per day"
              value={limitText(playbook.token_limit_per_day)}
              setBy={playbook.token_limit_set_by}
              note={playbook.token_limit_per_day === null ? undefined : "tokens"}
            />
            <PolicyRow label="Mode" value={setValueOrNotSet(playbook.mode, playbook.mode_set_by)} setBy={playbook.mode_set_by} note={modeCaption(playbook)} />
          </dl>
          <ModeControl playbook={playbook} actions={actions} liveAskOpen={liveAskOpen} onAskLive={onAskLive} onCancelLive={onCancelLive} onSet={onSet} onAskDryRunEnable={onAskDryRunEnable} />
        </section>
        <section className="pb-block" aria-labelledby="pb-h-trigger">
          <div className="pb-sech">
            <h3 id="pb-h-trigger">Trigger</h3>
            <span className="pb-spacer" />
            <Button variant="ghost" size="row" data-testid={IDS.schedulesLink} icon={<Icon name="clock" className="pb-glyph" />} onClick={() => navigate(SCHEDULES_HASH)}>
              Schedules &amp; triggers
            </Button>
          </div>
          <dl className="pb-kv">
            <dt>Fires on</dt>
            <dd>{triggerText(trigger, playbook)}</dd>
            <dt>Next fire</dt>
            <dd className="pb-tn">{nextFire === null ? "not scheduled" : when(nextFire)}</dd>
            <dt>Last result</dt>
            <dd>{trigger === undefined ? "none" : trigger.last_result === null ? "none yet" : safe(trigger.last_result)}</dd>
            <dt>Owner</dt>
            <dd data-testid={IDS.owner}>
              {owner === undefined ? (
                safe(playbook.owning_agent)
              ) : (
                <span className="pb-owner">
                  <Avatar agent={{ id: owner.agent.id, name: safe(owner.agent.display_name), shape: owner.agent.avatar.shape, hue: owner.agent.avatar.hue }} state={owner.state} size={20} />
                  <span>{safe(owner.agent.display_name)}</span>
                </span>
              )}
            </dd>
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
