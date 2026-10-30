// The small pieces the Playbooks screen's views share: who set a value, a run's
// status beside its dot, the On switch, and the note a switch in the off position
// reveals. Every kernel string arrives already passed through `safe` (model.ts)
// and is rendered as a React text child, never as markup.
import type { ReactNode } from "react";
import type { Approval, PlaybookListing } from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { APPROVALS_HASH, type RunTone, PLAYBOOKS_TEST_IDS as IDS, isOn, runStatusWord, runTone, safe, setByWord, stateOf, switchName } from "./model";

/** A line under a view's controls: a refusal, or a status. */
export interface Notice {
  readonly tone: "danger" | "ok";
  readonly text: string;
}

/** What the views call; the screen owns every write, its in-flight guard and the navigation. */
export interface PlaybookActions {
  /** The kernel cannot be asked: every write is disabled, the data on screen is the last known. */
  readonly offline: boolean;
  /** A write is in flight (its key), so the others wait: the guard would drop them. */
  readonly pending: string | null;
  readonly turnOff: (playbook: PlaybookListing) => void;
  /** The switch in the off position: reveals the held approval, or says how it turns on. Never writes. */
  readonly revealTurnOn: (playbook: PlaybookListing) => void;
  readonly runNow: (playbook: PlaybookListing) => void;
  readonly editInEnglish: (playbook: PlaybookListing) => void;
}

/** `compact`: plain caption text that wraps (the list's narrow cells); otherwise a Badge. */
export function SetBy({ setBy, compact = false }: { readonly setBy: string | null; readonly compact?: boolean }) {
  const word = setByWord(setBy);
  if (word === "") return null;
  if (compact) {
    return (
      <span className="pb-cap pb-setby" data-by={setBy === "owner" ? "owner" : "wright"}>
        {word}
      </span>
    );
  }
  return (
    <span className="pb-setby" data-by={setBy === "owner" ? "owner" : "wright"}>
      <Badge tone={setBy === "owner" ? "neutral" : "accent"}>{word}</Badge>
    </span>
  );
}

/** A run's dot with its status in words beside it: the dot alone says nothing to a screen reader. */
export function RunStatus({ status }: { readonly status: string }) {
  const tone: RunTone = runTone(status);
  return (
    <span className="pb-run-status">
      <span className="pb-dot" data-tone={tone} aria-hidden="true" />
      <span>{runStatusWord(status)}</span>
    </span>
  );
}

export interface PlaybookSwitchProps {
  readonly playbook: PlaybookListing;
  readonly actions: PlaybookActions;
}

/** The On switch: on sends Turn off; off reveals how it turns on. It is the same control on the list and the detail. */
export function PlaybookSwitch({ playbook, actions }: PlaybookSwitchProps) {
  const on = isOn(playbook);
  const busy = actions.pending === `off:${playbook.id}`;
  return (
    <button
      type="button"
      role="switch"
      className="pb-switch"
      aria-checked={on}
      aria-label={switchName(playbook)}
      aria-busy={busy ? "true" : undefined}
      disabled={actions.offline || (actions.pending !== null && !busy)}
      data-testid={IDS.switch}
      data-playbook={playbook.id}
      onClick={() => (on ? actions.turnOff(playbook) : actions.revealTurnOn(playbook))}
    />
  );
}

export interface TurnOnNoteProps {
  readonly playbook: PlaybookListing;
  /** The pending `kernel_playbook_enable` approval that names this playbook, if there is one. */
  readonly approval: Approval | undefined;
  readonly actions: PlaybookActions;
}

/**
 * What a switch in the off position reveals. The owner has no route that turns a
 * playbook on: only the approval Wright asks for does. So this note shows the held
 * approval and links to it in Approvals, or says that Wright asks and the owner
 * approves and offers Edit in English. It sends nothing.
 */
export function TurnOnNote({ playbook, approval, actions }: TurnOnNoteProps) {
  const state = stateOf(playbook);
  return (
    <div className="pb-turnon" role="status" data-testid={IDS.turnOn} data-playbook={playbook.id}>
      <p className="pb-turnon-head">
        {safe(playbook.name)} is {state === "draft" ? "a draft" : "off"}.
      </p>
      {approval === undefined ? (
        <>
          <p>No approval is waiting. This playbook turns on when Wright asks and you approve it.</p>
          <Button variant="secondary" size="row" data-testid={IDS.turnOnAsk} disabled={actions.offline} onClick={() => actions.editInEnglish(playbook)}>
            Edit in English
          </Button>
        </>
      ) : (
        <>
          <p data-testid={IDS.turnOnApproval}>{`An approval to turn it on is waiting: ${safe(approval.display ?? approval.action)}`}</p>
          <a className="pb-link" href={APPROVALS_HASH} data-testid={IDS.turnOnLink}>
            Review it in Approvals
          </a>
        </>
      )}
    </div>
  );
}

/** The screen's two placeholders: a few skeleton rows at the real row height, never a spinner. */
export function Skeleton({ rows }: { readonly rows: number }): ReactNode {
  return (
    <div className="pb-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="pb-skel" key={i}>
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

/** `text` with a line-break opportunity after each comma, dot and slash, so a long dedupe key wraps between its fields, never inside one. */
export function Breakable({ text }: { readonly text: string }): ReactNode {
  return text.split(/(?<=[,./])/).map((part, i) => (
    <span key={i}>
      {i === 0 ? null : <wbr />}
      {part}
    </span>
  ));
}
