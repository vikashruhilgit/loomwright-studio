// A paused Loomwright run on the Tasks board (phase 8 item 23j): the "Parked run" card in the Parked column, and its
// Resume. A run that parks before it picked an item (for example `pause_reason: trail_pr_open`) has no task and no PR,
// so no other card shows it; this one is the owner's only way to continue it. A stranded run (23l: its session ended
// mid-item, so its file still reads `running` with no live lock holder) is drawn the same way, badged `stranded`.
//
// - The data is the kernel's `GET /automate/paused-runs` (`kernel/src/gui/paused-runs.ts`), read by `./TasksScreen.tsx`
//   on the board's own cadence (every refetch of `GET /tasks`).
// - Resume is `POST /automate/paused-runs/:run_id/resume` with the body exactly `{agent, checkout}`. It is enabled only
//   when the kernel says nothing blocks it (`blocked === null`); otherwise the card says why in plain words, and the
//   kernel checks it all again on the POST (a 409 or 404 is shown in the card). Off while the kernel is away.
// - Mechanism only: the kernel queues its own resume run; when to resume is the owner's click.
// - Reply: a run session can end its turn on a question to the owner. The card shows the run's newest session's last
//   message (`last_session`, model text: untrusted, a text child with its line breaks) and a reply box; Send is
//   `POST /automate/paused-runs/:run_id/reply`, which continues THAT session with the owner's words. A Resume would
//   start a new session that asks the same question again.
// - Retire (phase 8 item 27b): `POST /automate/paused-runs/:run_id/retire` with the body exactly `{agent, checkout}`,
//   after one confirm in the card. The kernel records that the owner set the run aside: it is no longer listed or
//   resumable, and no later handover carries its unfinished items. Loomwright's run file is left exactly as it is. Off
//   while the kernel is away and while the run is live or a resume or continuation is queued (the kernel refuses
//   those with a 409, shown in the card); any other block (for example a run Studio didn't start) does not stop it.
//   Focus is never dropped: opening the confirm moves it to "Retire run", closing it (Keep it, or a refused retire)
//   back to Retire, and a card that leaves the board while it holds focus reports it (`onFocusLost`), as a board card
//   does, so the board hands focus on.
//
// Every string from the run file (the title, the pause reason, the item, the PR URL) and the checkout path is
// untrusted: it passes through `printable` and is a text child only. The PR URL is shown as text, never an `href`
// (the window opens no links, as `../chat/integrationCards.tsx` does it).
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ApiResult, PausedRunBlock, PausedRunReplyResponse, PausedRunResumeResponse, PausedRunRetireResponse, PausedRunView, PausedRunsResponse, StudioBridge } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarAgent } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { Icon } from "../../components/icons";
import { printable } from "../approvals/printable";
import { clockText, table } from "./model";
import "./ticket-pr.css";

// ---- the calls ---------------------------------------------------------------------------------

const NO_ANSWER = { ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } } as const;

/** One read of `GET /automate/paused-runs`. A throw, or a body that is not the response, is a failed read, never data. */
export async function readPausedRuns(api: StudioBridge): Promise<ApiResult<PausedRunsResponse>> {
  let result: ApiResult<PausedRunsResponse>;
  try {
    result = await api.request<PausedRunsResponse>({ method: "GET", path: "/automate/paused-runs" });
  } catch {
    return NO_ANSWER;
  }
  if (result.ok && !Array.isArray((result.body as Partial<PausedRunsResponse> | null)?.runs)) {
    return { ok: false, status: result.status, body: { error: "invalid_response" } };
  }
  return result;
}

/** Resume one paused run: the body is exactly `{agent, checkout}`, the run id a path param. */
export async function resumePausedRun(api: StudioBridge, run: Pick<PausedRunView, "agent" | "checkout" | "run_id">): Promise<ApiResult<PausedRunResumeResponse>> {
  try {
    return await api.request<PausedRunResumeResponse>({
      method: "POST",
      path: "/automate/paused-runs/:run_id/resume",
      params: { run_id: run.run_id },
      body: { agent: run.agent, checkout: run.checkout },
    });
  } catch {
    return NO_ANSWER;
  }
}

/** Retire one paused run (27b): the body is exactly `{agent, checkout}`, the run id a path param. */
export async function retirePausedRun(api: StudioBridge, run: Pick<PausedRunView, "agent" | "checkout" | "run_id">): Promise<ApiResult<PausedRunRetireResponse>> {
  try {
    return await api.request<PausedRunRetireResponse>({
      method: "POST",
      path: "/automate/paused-runs/:run_id/retire",
      params: { run_id: run.run_id },
      body: { agent: run.agent, checkout: run.checkout },
    });
  } catch {
    return NO_ANSWER;
  }
}

/** The longest reply the kernel takes (`RUN_REPLY_MAX`). */
export const RUN_REPLY_MAX = 4000;

/** Reply to the run's last message: the body is exactly `{agent, checkout, text}`, the run id a path param. */
export async function replyToRun(api: StudioBridge, run: Pick<PausedRunView, "agent" | "checkout" | "run_id">, text: string): Promise<ApiResult<PausedRunReplyResponse>> {
  try {
    return await api.request<PausedRunReplyResponse>({
      method: "POST",
      path: "/automate/paused-runs/:run_id/reply",
      params: { run_id: run.run_id },
      body: { agent: run.agent, checkout: run.checkout, text },
    });
  } catch {
    return NO_ANSWER;
  }
}

// ---- the words -----------------------------------------------------------------------------------

/** Why Resume is off, in the owner's words. */
const BLOCK_WORDS = table<string>({
  no_kernel_run: "Studio didn't start this run",
  run_live: "A run is going in this workspace",
  resume_queued: "Resume queued",
  continuation_queued: "Your reply or decision is queued; the run carries on from it next",
  playbook_not_live: "Its playbook isn't live",
  agent_not_active: "Its crew member is off",
  kill_switch_engaged: "Studio is stopped",
  lock_settling: "Waiting for the stopped run's lock to clear",
} satisfies Record<PausedRunBlock, string>);

/** The plain words for a block (or a 409's `error`); an unknown word is shown escaped, never guessed. */
export function blockText(block: string): string {
  return BLOCK_WORDS[block] ?? printable(block);
}

/** What a refused or failed Resume says in the card. */
export function resumeErrorText(result: ApiResult<unknown>): string {
  if (result.ok) return "";
  if ("connection" in result) return "Couldn't reach the kernel; nothing was resumed.";
  const code = String(result.body.error);
  if (result.status === 409) return `Couldn't resume: ${blockText(code)}.`;
  if (result.status === 404) return "Couldn't resume: this run is no longer paused here.";
  const message = typeof result.body.message === "string" ? `: ${printable(result.body.message)}` : "";
  return `The kernel refused (${result.status} ${printable(code)})${message}.`;
}

/** The blocks that also stop a Retire: the run is live, or a launch of it is queued. */
const RETIRE_BLOCKS: ReadonlySet<PausedRunBlock> = new Set<PausedRunBlock>(["run_live", "resume_queued", "continuation_queued"]);

/** Whether the list says the run can't be retired now (the kernel checks again on the POST). */
export function retireBlocked(run: Pick<PausedRunView, "blocked">): boolean {
  return run.blocked !== null && RETIRE_BLOCKS.has(run.blocked);
}

/** The retire-only 409 words (the rest are `blockText`'s). */
const RETIRE_WORDS = table<string>({
  approval_pending: "A held call of its run is waiting for your decision in Approvals",
});

/** What a refused or failed Retire says in the card. */
export function retireErrorText(result: ApiResult<unknown>): string {
  if (result.ok) return "";
  if ("connection" in result) return "Couldn't reach the kernel; nothing was retired.";
  const code = String(result.body.error);
  if (result.status === 409) return `Couldn't retire: ${RETIRE_WORDS[code] ?? blockText(code)}.`;
  if (result.status === 404) return "Couldn't retire: this run is no longer listed here.";
  const message = typeof result.body.message === "string" ? `: ${printable(result.body.message)}` : "";
  return `The kernel refused (${result.status} ${printable(code)})${message}.`;
}

/** What a refused or failed reply says in the card. */
export function replyErrorText(result: ApiResult<unknown>): string {
  if (result.ok) return "";
  if ("connection" in result) return "Couldn't reach the kernel; the reply was not sent.";
  const code = String(result.body.error);
  if (code === "no_run_session") return "Couldn't send: Studio started no session for this run to reply to.";
  if (result.status === 409) return `Couldn't send: ${blockText(code)}.`;
  if (result.status === 404) return "Couldn't send: this run is no longer paused here.";
  return `The kernel refused the reply (${result.status} ${printable(code)}).`;
}

/** Whether the card offers a reply: the kernel started a session for this run, it has ended, and nothing but a settling lock blocks. */
export function canReply(run: PausedRunView): boolean {
  const last = run.last_session;
  return last !== undefined && last !== null && last.status !== "running" && last.status !== "starting" && (run.blocked === null || run.blocked === "lock_settling");
}

/** The card's React key: a run id is unique only within its agent's checkout. */
export function parkedRunKey(run: Pick<PausedRunView, "agent" | "checkout" | "run_id">): string {
  return `paused:${run.agent}:${run.checkout}:${run.run_id}`;
}

// ---- drawing -------------------------------------------------------------------------------------

export interface ParkedRunCardProps {
  readonly run: PausedRunView;
  readonly agent: AvatarAgent;
  /** The kernel is not answering: Resume is off. */
  readonly offline: boolean;
  /** Sends the Resume (`resumePausedRun`) and, when it was queued, reads the board again. */
  readonly onResume: (run: PausedRunView) => Promise<ApiResult<unknown>>;
  /** Sends a reply (`replyToRun`) and, when it was queued, reads the board again. Absent: no reply box. */
  readonly onReply?: (run: PausedRunView, text: string) => Promise<ApiResult<unknown>>;
  /** Sends the Retire (`retirePausedRun`) and, when the kernel answered, reads the board again. Absent: no Retire. */
  readonly onRetire?: (run: PausedRunView) => Promise<ApiResult<unknown>>;
  /** Told the card's key (`parkedRunKey`) when the card leaves the DOM while it holds focus, so the board hands focus on. */
  readonly onFocusLost?: (key: string) => void;
}

/** The Parked run card: what the run is, whose and where, why it paused, and Resume (or why not). */
export function ParkedRunCard({ run, agent, offline, onResume, onReply, onRetire, onFocusLost }: ParkedRunCardProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [retireError, setRetireError] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyNote, setReplyNote] = useState<{ readonly ok: boolean; readonly text: string } | undefined>();
  const replyId = useId();
  const footRef = useRef<HTMLDivElement>(null);
  const retireRef = useRef<HTMLButtonElement>(null);
  const confirmYesRef = useRef<HTMLButtonElement>(null);
  const confirmWasOpen = useRef(false);
  // The confirm replaces the focused Retire (and closing it removes the focused "Retire run" or "Keep it"): move focus
  // with it, but only when focus was dropped or is still in the card's foot, never away from where the owner moved it.
  useEffect(() => {
    const wasOpen = confirmWasOpen.current;
    confirmWasOpen.current = confirmRetire;
    if (confirmRetire === wasOpen) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !(footRef.current?.contains(active) ?? false)) return;
    (confirmRetire ? confirmYesRef : retireRef).current?.focus();
  }, [confirmRetire]);
  const cardKey = parkedRunKey(run);
  // Reports the card leaving the DOM while it holds focus (a retired run's card goes), as a board card does.
  const watch = useCallback(
    (node: HTMLLIElement | null) => {
      if (node === null || onFocusLost === undefined) return undefined;
      return () => {
        if (node.contains(document.activeElement)) onFocusLost(cardKey);
      };
    },
    [cardKey, onFocusLost],
  );
  const last = run.last_session ?? null;
  const replyable = onReply !== undefined && canReply(run);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (onReply === undefined || offline || !replyable || sending || text === "" || text.length > RUN_REPLY_MAX) return;
    setSending(true);
    setReplyNote(undefined);
    const result = await onReply(run, text);
    setSending(false);
    if (result.ok) {
      setDraft("");
      setReplyNote({ ok: true, text: "Sent. The run carries on from where it stopped." });
    } else setReplyNote({ ok: false, text: replyErrorText(result) });
  };
  const title = run.title.trim() === "" ? `Run ${printable(run.run_id)}` : printable(run.title);
  const where = printable(run.repo ?? run.checkout);
  const blocked = run.blocked;

  const resume = async (): Promise<void> => {
    if (offline || blocked !== null || pending) return;
    setPending(true);
    setError(undefined);
    const result = await onResume(run);
    setPending(false);
    if (!result.ok) setError(resumeErrorText(result));
  };

  const retireOff = offline || retireBlocked(run);
  const retire = async (): Promise<void> => {
    if (onRetire === undefined || retireOff || retiring) return;
    setRetiring(true);
    setRetireError(undefined);
    const result = await onRetire(run);
    setRetiring(false);
    setConfirmRetire(false);
    if (!result.ok) setRetireError(retireErrorText(result));
  };

  return (
    <li className="ticket-card" ref={watch} data-testid={`parked-run-${run.run_id}`}>
      <div className="tasks-card ticket-face parked-run-face">
        <span className="tasks-card-kind">
          <span className="tasks-card-label">
            <Icon name="run" className="tasks-glyph" />
            Parked run
          </span>
          <span className="tasks-card-state">
            <Badge tone="parked">{run.stranded ? "stranded" : "paused"}</Badge>
          </span>
        </span>
        <span className="tasks-card-title" data-testid="parked-run-title">
          {title}
        </span>
        <span className="tasks-card-why" data-testid="parked-run-reason">
          {run.stranded
            ? "Stopped mid-item: its session ended while the run was going"
            : run.pause_reason === null
              ? "Paused"
              : `Paused: ${printable(run.pause_reason)}`}
        </span>
        {run.item === null ? null : (
          <span className="tasks-card-meta parked-run-text" data-testid="parked-run-item">
            {`Item: ${printable(run.item)}`}
          </span>
        )}
        {run.pr === null ? null : (
          <span className="tasks-card-meta parked-run-text" data-testid="parked-run-pr">
            {`PR: ${printable(run.pr)}`}
          </span>
        )}
        {last === null || last.message === null ? null : (
          <span className="tasks-card-meta parked-run-last" data-testid="parked-run-last">
            <span className="parked-run-last-head">{`Last message (session #${last.id})`}</span>
            <span className="parked-run-last-text" data-testid="parked-run-last-text">
              {printable(last.message, true)}
            </span>
          </span>
        )}
        <span className="tasks-card-meta">
          <Avatar agent={agent} state="parked" size={20} />
          <span className="parked-run-text" data-testid="parked-run-where">{`${agent.name} · ${where}`}</span>
        </span>
      </div>
      <div className="ticket-foot" ref={footRef} data-testid="parked-run-foot">
        {blocked === null ? null : (
          <span className="ticket-foot-note" data-testid="parked-run-blocked">
            {blocked === "lock_settling" && clockText(run.resume_at) !== "" ? `Can resume at ${clockText(run.resume_at)}` : blockText(blocked)}
          </span>
        )}
        <Button
          variant={blocked === null ? "primary" : "secondary"}
          size="row"
          disabled={blocked !== null}
          loading={pending}
          aria-disabled={offline && blocked === null ? true : undefined}
          data-testid="parked-run-resume"
          onClick={() => void resume()}
        >
          Resume
        </Button>
        {onRetire === undefined || confirmRetire ? null : (
          <Button
            variant="ghost"
            size="row"
            disabled={retireOff}
            ref={retireRef}
            data-testid="parked-run-retire"
            onClick={() => {
              setRetireError(undefined);
              setConfirmRetire(true);
            }}
          >
            Retire
          </Button>
        )}
        {error === undefined ? null : (
          <span className="ticket-foot-note ticket-foot-full" role="status" data-testid="parked-run-error">
            {error}
          </span>
        )}
        {onRetire === undefined || !confirmRetire ? null : (
          <>
            <span className="ticket-foot-note ticket-foot-full" data-testid="parked-run-retire-confirm">
              Retire this run? Studio stops showing it and never hands its unfinished items to a later run. Loomwright's run file is left as it is.
            </span>
            <Button variant="danger" size="row" disabled={retireOff} loading={retiring} ref={confirmYesRef} data-testid="parked-run-retire-confirm-yes" onClick={() => void retire()}>
              Retire run
            </Button>
            <Button variant="ghost" size="row" disabled={retiring} data-testid="parked-run-retire-cancel" onClick={() => setConfirmRetire(false)}>
              Keep it
            </Button>
          </>
        )}
        {retireError === undefined ? null : (
          <span className="ticket-foot-note ticket-foot-full" role="status" data-tone="danger" data-testid="parked-run-retire-error">
            {retireError}
          </span>
        )}
        {!replyable ? null : (
          <form
            className="parked-run-reply ticket-foot-full"
            data-testid="parked-run-reply"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="field-label" htmlFor={replyId}>
              Reply to the run
            </label>
            <textarea
              id={replyId}
              className="field-control parked-run-reply-text"
              rows={2}
              maxLength={RUN_REPLY_MAX}
              disabled={sending || offline}
              placeholder="Answer its last message, for example: Redo it."
              value={draft}
              data-testid="parked-run-reply-text"
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
            <Button variant="secondary" size="row" type="submit" loading={sending} disabled={offline || draft.trim() === ""} data-testid="parked-run-reply-send">
              Send reply
            </Button>
          </form>
        )}
        {replyNote === undefined ? null : (
          <span className="ticket-foot-note ticket-foot-full" role="status" data-tone={replyNote.ok ? "ok" : "danger"} data-testid="parked-run-reply-note">
            {replyNote.text}
          </span>
        )}
      </div>
    </li>
  );
}
