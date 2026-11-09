// A ticket's pull request on the Tasks board (phase 8 item 14): the card the mockup's `prCard` draws, the words and
// tones it carries, the column it sits in and the link to the merge approval that waits on the owner. This module is
// the ONE home of that responsibility: `./TasksViews.tsx` mounts the card, `./TaskDetail.tsx` draws the open card's
// facts and band from the same functions, and `./TasksScreen.tsx` places it with `ticketColumnOf`.
//
// Honest status. Every value comes from `TaskBoardItem.ticket_pr`, the kernel-written `pr_tracks` row (item 10), never
// from the agent-written task links:
// - A badge is green (`ok`) only for what the kernel recorded as done: PR state `merged`, CI `green`, an `n/N` approvals
//   word with n reached N. `pending` CI, `0/2`, `open`, a `null` CI and an out-of-set word are never green.
// - "Waiting on you" is never inferred from the state word: it needs a PENDING merge approval in the store's
//   `approvals` resource whose repo (case-insensitive) and PR number are this card's, read through `mergeApprovalOf`
//   (the kernel's own reader). With no such approval the card shows none, however the PR reads.
// - The triage tally (fix / reply / answer counts) is NOT drawn: the kernel serves none (`TaskTicketPr` has no tally
//   field and no kernel code records a comment route), so a number here would be a guess.
// - The open footer link only navigates (`#/approvals/<id>`, `#/integrations`); it writes nothing, and it is off
//   while the kernel is away.
//
// Every string from the kernel (the ticket ref, the repo, the title, the head commit, an unknown word) is untrusted: it
// passes through `printable` and is a text child only.
import type { Ref } from "react";
import type { Approval, TaskBoardItem, TaskTicketPr } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarAgent, AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import type { BadgeTone } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/icons";
import { mergeApprovalOf } from "../approvals/subject";
import { printable } from "../approvals/printable";
import { approvalHash } from "../menubar/links";
import { cardLabel, cardTitle, metaText, table } from "./model";
import type { BoardCard, ColumnId, Fact } from "./model";
import "./ticket-pr.css";

// ---- the ticket -----------------------------------------------------------------------------------

/** One ticket source: its `ref` prefix as the kernel's poll sources write it, and how its id reads. */
interface Source {
  readonly prefix: string;
  /** The full name: the open card's facts and the accessible name. */
  readonly label: string;
  /** The card's short name. */
  readonly short: string;
  readonly mark: "github" | "ticket";
  /** The id inside the ref after the prefix, or `undefined` when it is not one of the shapes the source writes. */
  readonly idOf: (rest: string) => string | undefined;
}

const GITHUB_ISSUE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#([1-9][0-9]*)$/;
const CLICKUP_ID = /^[A-Za-z0-9_-]+$/;
const JIRA_KEY = /^[^/\s]+\/([A-Za-z][A-Za-z0-9_]*-[0-9]+)$/;

/** `github:<repo>#<n>`, `clickup:<id>`, `jira:<site>/<key>`: the only sources read; any other ref is shown raw. */
const SOURCES: readonly Source[] = [
  { prefix: "github:", label: "GitHub Issue", short: "Issue", mark: "github", idOf: (rest) => { const m = GITHUB_ISSUE.exec(rest); return m === null ? undefined : `#${m[1]}`; } },
  { prefix: "clickup:", label: "ClickUp", short: "ClickUp", mark: "ticket", idOf: (rest) => (CLICKUP_ID.test(rest) ? rest : undefined) },
  { prefix: "jira:", label: "Jira", short: "Jira", mark: "ticket", idOf: (rest) => JIRA_KEY.exec(rest)?.[1] },
];

/** A ticket as the card names it: a known source and its id, or the escaped raw ref with no source. */
export interface TicketRef {
  readonly source: Pick<Source, "label" | "short" | "mark"> | null;
  /** Escaped. */
  readonly id: string;
}

/** The ticket a ref names. `null` (no ticket) is `undefined`: no ticket line. The source is read only from the ref's prefix. */
export function ticketRef(ref: string | null): TicketRef | undefined {
  if (ref === null) return undefined;
  for (const source of SOURCES) {
    if (!ref.startsWith(source.prefix)) continue;
    const id = source.idOf(ref.slice(source.prefix.length));
    if (id !== undefined) return { source, id: printable(id) };
  }
  return { source: null, id: printable(ref) };
}

/** `Issue #14` on a card, `GitHub Issue #14` in full; a raw ref is just its escaped text. */
export function ticketText(ticket: TicketRef, full = false): string {
  return ticket.source === null ? ticket.id : `${full ? ticket.source.label : ticket.source.short} ${ticket.id}`;
}

// ---- the words and tones ----------------------------------------------------------------------------

/** The one PR state that is green: what the kernel recorded as done. */
const OK_TICKET_STATE = "merged";

const STATE_TONES = table<BadgeTone>({ ready: "accent", parked: "parked" });

/** The state badge's tone: `ok` only for `merged`; `open`, `draft`, `closed` and any word not listed are neutral. */
export function stateToneOf(state: string): BadgeTone {
  if (state === OK_TICKET_STATE) return "ok";
  return STATE_TONES[state] ?? "neutral";
}

export interface WordView {
  /** Escaped. */
  readonly text: string;
  readonly tone: BadgeTone;
}

const APPROVAL_WORDS = table<WordView>({
  solo: { text: "Solo", tone: "neutral" },
  no_policy: { text: "No policy", tone: "parked" },
});

const FRACTION = /^([0-9]{1,6})\/([0-9]{1,6})$/;

/**
 * The approvals word as the card reads it: `solo` is "Solo" (neutral), `studio_approval` "Approve in Studio" (attention
 * only while an approval waits on the owner, else neutral), `no_policy` "No policy" (parked), `n/N` "n/N approvals"
 * (ok only when n reached N), any other word its escaped self (neutral). `0/0` is no requirement, never green.
 */
export function approvalsView(word: string, waiting: boolean): WordView {
  if (word === "studio_approval") return { text: "Approve in Studio", tone: waiting ? "attention" : "neutral" };
  const known = APPROVAL_WORDS[word];
  if (known !== undefined) return known;
  const fraction = FRACTION.exec(word);
  if (fraction !== null) {
    const have = Number(fraction[1]);
    const need = Number(fraction[2]);
    if (need > 0) return { text: `${have}/${need} approvals`, tone: have >= need ? "ok" : "neutral" };
  }
  return { text: printable(word), tone: "neutral" };
}

export interface CiView extends WordView {
  /** The dot before the words: a filled green or red one, or the hollow idle one. */
  readonly dot: "ok" | "danger" | "idle";
}

/** Honest CI (the mockup's `ciChip`): green only when the kernel recorded green; pending, none and unknown are neutral with the hollow dot. */
const CI_VIEWS = table<CiView>({
  green: { text: "CI green", tone: "ok", dot: "ok" },
  failing: { text: "CI failing", tone: "danger", dot: "danger" },
  pending: { text: "CI pending", tone: "neutral", dot: "idle" },
  none: { text: "No CI checks", tone: "neutral", dot: "idle" },
});

const CI_UNKNOWN: CiView = { text: "CI not recorded", tone: "neutral", dot: "idle" };

/** The CI chip for the kernel's `ci` (`null` is a state the kernel did not recognise). */
export function ciView(ci: string | null): CiView {
  return ci === null ? CI_UNKNOWN : (CI_VIEWS[ci] ?? CI_UNKNOWN);
}

/** The mockup's `OWN[*].short`: who holds the PR. */
const OWNER_WORDS = table<string>({
  automate_live: "live /automate run",
  automate_parked: "parked /automate item",
  owner: "you or the App",
  other: "someone else",
});

/** The owner kind's words; `undefined` for `null` and for a kind this table does not list. */
export function ownerWord(kind: string | null): string | undefined {
  return kind === null ? undefined : OWNER_WORDS[kind];
}

/** What the card says about a merge the kernel's gate did: text only, never an action. */
export const BY_GATE = "by Loomwright's gate";

// ---- where it sits ---------------------------------------------------------------------------------

/** `ticket_pr.state` to a column: working states, parked, done today. A state not listed goes to Other, never guessed. */
const TICKET_COLUMNS = table<ColumnId>({ open: "work", draft: "work", ready: "work", parked: "park", merged: "done", closed: "done" });

/** The pending merge approval for this PR: its id, or `undefined`. Repo is compared case-insensitively; a decided approval never counts. */
export function pendingMergeApproval(ticket: Pick<TaskTicketPr, "repo" | "number">, approvals: readonly Approval[] | undefined): number | undefined {
  const repo = ticket.repo.toLowerCase();
  const ids = (approvals ?? [])
    .filter((a) => a.status === "pending" && matches(a, repo, ticket.number))
    .map((a) => a.id);
  // The newest request when more than one names the PR (a new head commit asks again).
  return ids.length === 0 ? undefined : Math.max(...ids);
}

function matches(approval: Approval, repo: string, pr: number): boolean {
  const merge = mergeApprovalOf(approval);
  return merge !== undefined && merge.pr === pr && merge.repo.toLowerCase() === repo;
}

/** The approval a PARKED card waits on, or `undefined`: a PR in any other state is never "waiting on you". */
export function waitingApprovalOf(ticket: TaskTicketPr, approvals: readonly Approval[] | undefined): number | undefined {
  return ticket.state === "parked" ? pendingMergeApproval(ticket, approvals) : undefined;
}

/** The column of a ticket card, or `undefined` for a plain card (which keeps `model.ts`'s mapping). Waiting on you needs a matching pending approval. */
export function ticketColumnOf(item: TaskBoardItem, approvals: readonly Approval[] | undefined): ColumnId | undefined {
  const ticket = item.ticket_pr;
  if (ticket === null) return undefined;
  if (waitingApprovalOf(ticket, approvals) !== undefined) return "wait";
  return TICKET_COLUMNS[ticket.state] ?? "other";
}

/** The avatar state: green only for `merged`; else the column's. */
export function ticketAvatarState(ticket: TaskTicketPr, fallback: AvatarState): AvatarState {
  return stateToneOf(ticket.state) === "ok" ? "done" : fallback;
}

// ---- the words the card is read as ---------------------------------------------------------------------

/**
 * The card button's accessible name: the board's `Kind id: title, state` first (`cardLabel`, which the board's role
 * check pins), then the ticket, PR, approvals, CI, owner and "Waiting on you." words.
 */
export function ticketLabel(item: TaskBoardItem, ticket: TaskTicketPr, approvalId: number | undefined, offline: boolean): string {
  const ref = ticketRef(ticket.ticket);
  const words = [
    ref === undefined ? undefined : ticketText(ref, true),
    `PR ${ticket.number} ${printable(ticket.state)}`,
    approvalsView(ticket.approvals, approvalId !== undefined).text,
    ciView(ticket.ci).text,
    ownerWord(ticket.owner_kind),
    ticket.merged_by_gate ? `merged ${BY_GATE}` : undefined,
    approvalId === undefined ? undefined : "Waiting on you",
    offline ? "Last known" : undefined,
  ].filter((w): w is string => w !== undefined);
  return `${cardLabel(item)}. ${words.join(". ")}.`;
}

/** The open card's facts for a ticket PR (the card's words, in the mockup's order). */
export function ticketFacts(ticket: TaskTicketPr, approvalId: number | undefined): Fact[] {
  const ref = ticketRef(ticket.ticket);
  const approvals = approvalsView(ticket.approvals, approvalId !== undefined);
  const ci = ciView(ticket.ci);
  const owner = ownerWord(ticket.owner_kind);
  const facts: Fact[] = [];
  if (ref !== undefined) facts.push({ label: "Ticket", text: ticketText(ref, true) });
  facts.push({ label: "Pull request", text: `#${ticket.number} · ${printable(ticket.repo)}` });
  facts.push({ label: "State", text: printable(ticket.state), tone: stateToneOf(ticket.state) });
  if (ticket.head_sha !== null) facts.push({ label: "Head commit", text: printable(ticket.head_sha.slice(0, 7)) });
  facts.push({ label: "Approvals", text: approvals.text, tone: approvals.tone });
  facts.push({ label: "CI", text: ci.text, tone: ci.tone });
  if (owner !== undefined) facts.push({ label: "Owner", text: owner });
  if (ticket.merged_by_gate) facts.push({ label: "Merged", text: BY_GATE });
  return facts;
}

// ---- drawing -----------------------------------------------------------------------------------------

const GITHUB_MARK =
  "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z";

function SourceMark({ mark }: { readonly mark: "github" | "ticket" }) {
  if (mark === "ticket") return <Icon name="task" className="ticket-glyph" />;
  return (
    <svg className="ticket-glyph" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={GITHUB_MARK} />
    </svg>
  );
}

function PrMark() {
  return (
    <Glyph className="ticket-glyph">
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v8M18 16V10a4 4 0 0 0-4-4h-2" />
    </Glyph>
  );
}

function LockMark() {
  return (
    <Glyph className="ticket-glyph">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Glyph>
  );
}

function TicketChip({ ticket }: { readonly ticket: TicketRef }) {
  return (
    <span className="ticket-src">
      {ticket.source === null ? null : <SourceMark mark={ticket.source.mark} />}
      {ticketText(ticket)}
    </span>
  );
}

function CiBadge({ view }: { readonly view: CiView }) {
  return (
    <Badge tone={view.tone} icon={<span className="ticket-dot" data-dot={view.dot} />}>
      {view.text}
    </Badge>
  );
}

/** Where a footer link goes. Navigation only: nothing is sent to the kernel, and nothing happens while the kernel is away. */
function go(hash: string, offline: boolean): void {
  if (!offline) window.location.hash = hash;
}

/** The one navigation to a pending merge approval (`#/approvals/<id>`, which the Approvals screen selects): the card's footer, the open card's band and its approvals list all use it. */
function openApproval(approvalId: number, offline: boolean): void {
  go(approvalHash(approvalId), offline);
}

/** The "Waiting on you" row: the lock, the words and the link to the pending merge approval. */
function WaitingFooter({ approvalId, offline }: { readonly approvalId: number; readonly offline: boolean }) {
  return (
    <div className="ticket-foot" data-testid="ticket-waiting">
      <LockMark />
      <span className="ticket-foot-note">Waiting on you</span>
      <Button variant="primary" size="row" aria-disabled={offline ? true : undefined} onClick={() => openApproval(approvalId, offline)}>
        {`Open approval #${approvalId}`}
      </Button>
    </div>
  );
}

/** A parked PR whose repo has no merge policy: the note and a link to Integrations (where the owner sets it). No write. */
function PolicyFooter({ offline }: { readonly offline: boolean }) {
  return (
    <div className="ticket-foot" data-testid="ticket-policy-note">
      <span className="ticket-foot-note ticket-foot-full">Set this repo's merge policy to move it on.</span>
      <Button size="row" aria-disabled={offline ? true : undefined} onClick={() => go("#/integrations", offline)}>
        Open repo policy
      </Button>
    </div>
  );
}

export interface TicketPrCardProps {
  readonly card: BoardCard;
  readonly ticket: TaskTicketPr;
  readonly agent: AvatarAgent;
  readonly avatarState: AvatarState;
  /** The pending merge approval this PR waits on (`waitingApprovalOf`), if any. */
  readonly approvalId: number | undefined;
  /** The kernel is not answering: the card and its links are off, and the card is marked last known. */
  readonly offline: boolean;
  readonly tabbable: boolean;
  /** The board's focus-loss watch (`TasksViews.tsx`'s `CardView` owns it). */
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onOpen: (card: BoardCard) => void;
  readonly onFocused: (key: string) => void;
}

/**
 * The ticket card: the board's one card button (so J / K, Enter and Esc work as on any card) with its ticket, PR,
 * state, approvals, CI and owner inside, and the footer link beside it, never inside it (no button in a button).
 */
export function TicketPrCard({ card, ticket, agent, avatarState, approvalId, offline, tabbable, buttonRef, onOpen, onFocused }: TicketPrCardProps) {
  const { item, key, column } = card;
  const ref = ticketRef(ticket.ticket);
  const approvals = approvalsView(ticket.approvals, approvalId !== undefined);
  const ci = ciView(ticket.ci);
  const owner = ownerWord(ticket.owner_kind);
  const parkedWithoutPolicy = ticket.state === "parked" && ticket.approvals === "no_policy";
  return (
    <li className={column === "wait" ? "ticket-card ticket-card-wait" : "ticket-card"} data-testid={`ticket-card-${key}`}>
      <button
        type="button"
        ref={buttonRef}
        className="tasks-card ticket-face"
        data-card-key={key}
        data-column={column}
        data-testid={`task-card-${key}`}
        aria-label={ticketLabel(item, ticket, approvalId, offline)}
        aria-disabled={offline ? true : undefined}
        tabIndex={tabbable ? 0 : -1}
        onFocus={() => onFocused(key)}
        onClick={() => {
          if (!offline) onOpen(card);
        }}
      >
        <span className="tasks-card-kind ticket-kind">
          {ref === undefined ? null : (
            <>
              <TicketChip ticket={ref} />
              <span aria-hidden="true">→</span>
            </>
          )}
          <span className="ticket-pr">
            <PrMark />
            {`PR #${ticket.number}`}
          </span>
        </span>
        <span className="tasks-card-title">{cardTitle(item)}</span>
        <span className="ticket-pills">
          <span data-testid="task-card-state">
            <Badge tone={stateToneOf(ticket.state)}>{printable(ticket.state)}</Badge>
          </span>
          <span data-testid="ticket-approvals">
            <Badge tone={approvals.tone}>{approvals.text}</Badge>
          </span>
          <span data-testid="ticket-ci">
            <CiBadge view={ci} />
          </span>
        </span>
        <span className="tasks-card-meta">
          <Avatar agent={agent} state={avatarState} size={20} />
          <span data-testid="ticket-owner">{owner === undefined ? agent.name : `${agent.name} · ${owner}`}</span>
        </span>
        <span className="tasks-card-meta" data-testid="ticket-meta">
          {ticket.merged_by_gate ? `${metaText(card)} · ${BY_GATE}` : metaText(card)}
        </span>
        {offline ? (
          <span className="ticket-last-known" data-testid="ticket-last-known">
            <Icon name="clock" className="ticket-glyph" />
            Last known
          </span>
        ) : null}
      </button>
      {approvalId !== undefined ? <WaitingFooter approvalId={approvalId} offline={offline} /> : parkedWithoutPolicy ? <PolicyFooter offline={offline} /> : null}
    </li>
  );
}

/** The open card's "Waiting on you" band: the same words and link as the card's footer. */
export function TicketWaitingBand({ approvalId, pr, offline }: { readonly approvalId: number; readonly pr: number; readonly offline: boolean }) {
  return (
    <div className="tasks-band ticket-band" role="status" data-testid="ticket-waiting-band">
      <span className="tasks-band-dot" aria-hidden="true" />
      <span className="ticket-band-text">{`Waiting on you: approval #${approvalId} for PR #${pr}.`}</span>
      <Button variant="primary" size="row" aria-disabled={offline ? true : undefined} onClick={() => openApproval(approvalId, offline)}>
        {`Open approval #${approvalId}`}
      </Button>
    </div>
  );
}

/** A link to a pending approval from the history's list; the same navigation as the footer. */
export function OpenApprovalButton({ approvalId, offline }: { readonly approvalId: number; readonly offline: boolean }) {
  return (
    <Button size="row" variant="ghost" aria-disabled={offline ? true : undefined} onClick={() => openApproval(approvalId, offline)}>
      {`Open approval #${approvalId}`}
    </Button>
  );
}
