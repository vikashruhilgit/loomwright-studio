// The Approvals screen (phase 5 item 15): every pending approval in one
// inbox, the exact payload, and the decision in one key.
//
// - The list pane (`--list-pane-width`, 360px): pending first, oldest first
//   (`requested_at`, then id), then the ones decided here and, on request, the
//   kernel's decided ones (`GET /approvals?all=1`). The selection is an
//   approval id, never a list index, so an approval arriving or leaving never
//   moves it.
// - The detail: the action; the requesting agent and session; `from playbook
//   <slug> v<n>`; the cwd; for a kernel-applied tool, what the kernel will do;
//   the display and the exact payload. Every untrusted field is escaped by
//   `printable` (the kernel's own escaping) and rendered as text in a
//   monospace `<pre>`.
// - Decisions: Allow once (A), Always for this playbook (⇧A) and Deny (D),
//   each a registered command (so the ⌘K palette lists it). After a decision:
//   the kernel's applied or refused line, then the message the agent gets
//   (the `approval:<id>` brain message).
// - Grants: every standing grant, `current: false` marked, each with Revoke,
//   which asks first.
//
// The shell hands screens no bridge, so the exported component reads
// `window.api` itself and calls no store hook before that check: with no
// bridge (a unit test of the shell) it renders a plain state, never a throw.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type {
  ApiRequest,
  ApiResult,
  Approval,
  ApprovalDecisionResponse,
  ApprovalsResponse,
  BrainMessage,
  Grant,
  RevokeGrantResponse,
  SessionSummary,
  StudioBridge,
} from "../../api/contract";
import { isComposingKey, isEditableTarget } from "../../commands/keyboard";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { List } from "../../components/List/List";
import type { ListDataItem } from "../../components/List/List";
import { liveStoreFor, useResource } from "../../store/react";
import type { ResourceError } from "../../store/store";
import { alwaysRefusalFor, kernelWillLine, playbookText } from "./kernel-mirror";
import { payloadText, printable } from "./printable";
import "./approvals.css";

/** The command ids this screen registers (owner `approvals`). */
export const APPROVAL_COMMANDS = {
  approveOnce: "approvals.approve-once",
  approveAlways: "approvals.approve-always",
  deny: "approvals.deny",
  showGrants: "approvals.show-grants",
  showDecided: "approvals.show-decided",
} as const;

export const EMPTY_TITLE = "Nothing waiting on you.";

type Decision = "once" | "always" | "deny";

/** A line beside the decision buttons: the kernel's refusal, or why nothing was sent. */
interface Notice {
  readonly tone: "attention" | "danger";
  readonly text: string;
}

export interface ApprovalsScreenProps {
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

/** The screen. Reads `window.api` defensively: the shell does not pass the bridge to screens. */
export function ApprovalsScreen({ registry = commandRegistry }: ApprovalsScreenProps) {
  const api = (window as unknown as { api?: StudioBridge }).api;
  if (api === undefined) {
    return (
      <div className="approvals approvals-single" data-testid="screen-approvals" data-state="no-bridge">
        <div className="approvals-empty">
          <h2 className="approvals-empty-title">Approvals</h2>
          <p className="approvals-empty-note">This window has no connection to the kernel, so there is nothing to show.</p>
        </div>
      </div>
    );
  }
  return <ApprovalsInbox api={api} registry={registry} />;
}

// ---- helpers ---------------------------------------------------------------------

function byRequested(a: Approval, b: Approval): number {
  return a.requested_at < b.requested_at ? -1 : a.requested_at > b.requested_at ? 1 : a.id - b.id;
}

function byDecidedNewest(a: Approval, b: Approval): number {
  const x = a.decided_at ?? "";
  const y = b.decided_at ?? "";
  return x < y ? 1 : x > y ? -1 : b.id - a.id;
}

/** `HH:MM` in the owner's locale; the raw value, escaped, when it is not a time. */
function clock(iso: string | null): string {
  if (iso === null) return "unknown time";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return printable(iso);
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function decisionWord(a: Approval): string {
  if (a.status === "pending") return "waiting on you";
  if (a.status === "denied") return "denied";
  return a.decision === "always" ? "always for this playbook" : "allowed once";
}

function decisionSentence(a: Approval): string {
  const by = a.decided_by === null ? "" : ` by ${printable(a.decided_by)}`;
  const at = a.decided_at === null ? "" : ` at ${clock(a.decided_at)}`;
  if (a.status === "denied") return `Denied${by}${at}.`;
  return `${a.decision === "always" ? "Always allowed for this playbook" : "Allowed once"}${by}${at}.`;
}

/** The cwd the action runs in: the payload's own `cwd`, else the requesting session's, else unknown. Escaped. */
function cwdOf(a: Approval, sessions: readonly SessionSummary[] | undefined): string {
  const fromPayload = typeof a.payload === "object" && a.payload !== null ? (a.payload as { cwd?: unknown }).cwd : undefined;
  if (typeof fromPayload === "string") return printable(fromPayload);
  const session = a.requesting_session === null ? undefined : sessions?.find((s) => s.id === a.requesting_session);
  if (typeof session?.cwd === "string") return printable(session.cwd);
  return "cwd unknown";
}

/** The newest `approval:<id>` brain message: what the agent was told. */
function messageFor(id: number, messages: readonly BrainMessage[] | undefined): BrainMessage | undefined {
  const source = `approval:${id}`;
  let found: BrainMessage | undefined;
  for (const m of messages ?? []) if (m.source === source && (found === undefined || m.id > found.id)) found = m;
  return found;
}

/** A refusal's words, escaped: the kernel's `message` when it gave one, else its code. */
function refusalText(result: ApiResult<unknown> | undefined, what: string): string {
  if (result === undefined) return `The request failed before it reached the kernel; nothing was ${what}.`;
  if (result.ok) return "";
  if ("connection" in result) return `Couldn't reach the kernel; nothing was ${what}.`;
  const message = typeof result.body.message === "string" ? printable(result.body.message) : undefined;
  const code = printable(String(result.body.error));
  return message === undefined ? `The kernel refused (${code}); nothing was ${what}.` : message;
}

function errorText(error: ResourceError): string {
  if (error.kind === "not_connected") return "The kernel isn't answering, so nothing here can be read or decided until it is back.";
  if (error.kind === "bridge_failed") return "The request failed before it reached the kernel.";
  const message = typeof error.body.message === "string" ? `: ${printable(error.body.message)}` : "";
  return `The kernel refused the read (${error.status} ${printable(String(error.body.error))})${message}.`;
}

async function send<R>(api: StudioBridge, req: ApiRequest): Promise<ApiResult<R> | undefined> {
  try {
    return await api.request<R>(req);
  } catch {
    return undefined;
  }
}

// ---- the inbox -------------------------------------------------------------------------

interface DecidedRead {
  readonly approvals: readonly Approval[];
  readonly loading: boolean;
  readonly error: string | undefined;
}

function ApprovalsInbox({ api, registry }: { readonly api: StudioBridge; readonly registry: CommandRegistry }) {
  const approvals = useResource("approvals", api);
  const grants = useResource("grants", api);
  const messages = useResource("messages", api);
  const sessions = useResource("sessions", api);
  const store = liveStoreFor(api);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [decided, setDecided] = useState<DecidedRead>({ approvals: [], loading: false, error: undefined });
  /** Approvals decided in this window: the kernel's answer to the decision. */
  const [outcomes, setOutcomes] = useState<ReadonlyMap<number, Approval>>(new Map());
  const [notices, setNotices] = useState<ReadonlyMap<number, Notice>>(new Map());
  const [busy, setBusy] = useState<number | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Grant | null>(null);
  const [revokeBusy, setRevokeBusy] = useState<number | null>(null);
  const [grantNotice, setGrantNotice] = useState<string | undefined>(undefined);
  const inFlight = useRef(new Set<number>());
  const mounted = useRef(true);
  const grantsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- the rows --------------------------------------------------------------------

  // A decision only moves an approval out of `pending`, never back: one decided
  // here stays decided even if a read sent before the decision answers after it.
  const pending = useMemo(
    () => [...(approvals?.data?.approvals ?? [])].filter((a) => a.status === "pending" && !outcomes.has(a.id)).sort(byRequested),
    [approvals?.data, outcomes],
  );
  const decidedRows = useMemo(() => {
    const pendingIds = new Set(pending.map((a) => a.id));
    const rows = new Map<number, Approval>();
    for (const a of outcomes.values()) if (!pendingIds.has(a.id)) rows.set(a.id, a);
    // The kernel's own read is the newer copy of an approval decided here.
    if (showDecided) for (const a of decided.approvals) if (a.status !== "pending" && !pendingIds.has(a.id)) rows.set(a.id, a);
    return [...rows.values()].sort(byDecidedNewest);
  }, [pending, outcomes, showDecided, decided.approvals]);
  const rows = useMemo(() => [...pending, ...decidedRows], [pending, decidedRows]);

  // Selected by id. A missing id (decided elsewhere) falls back to the first row, which then becomes the selection.
  const selected = rows.find((a) => a.id === selectedId) ?? rows[0];
  useEffect(() => {
    if (selected !== undefined && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  // ---- the decided read (on request) ------------------------------------------------

  const approvalsAnsweredAt = approvals?.updatedAt ?? null;
  useEffect(() => {
    if (!showDecided) return;
    let live = true;
    setDecided((d) => ({ ...d, loading: true }));
    void send<ApprovalsResponse>(api, { method: "GET", path: "/approvals", query: { all: "1" } }).then((result) => {
      if (!live) return;
      if (result?.ok === true) setDecided({ approvals: result.body.approvals, loading: false, error: undefined });
      else setDecided((d) => ({ ...d, loading: false, error: refusalText(result, "read") }));
    });
    return () => {
      live = false;
    };
  }, [api, showDecided, approvalsAnsweredAt]);

  // ---- actions ---------------------------------------------------------------------------

  const setNotice = useCallback((id: number, notice: Notice | undefined) => {
    setNotices((current) => {
      const next = new Map(current);
      if (notice === undefined) next.delete(id);
      else next.set(id, notice);
      return next;
    });
  }, []);

  const decide = useCallback(
    async (approval: Approval, decision: Decision): Promise<void> => {
      if (approval.status !== "pending" || inFlight.current.has(approval.id)) return;
      if (decision === "always") {
        // The one refusal the app can tell before asking: nothing is sent.
        const refused = alwaysRefusalFor(approval);
        if (refused !== undefined) {
          setNotice(approval.id, { tone: "attention", text: refused });
          return;
        }
      }
      inFlight.current.add(approval.id);
      setBusy(approval.id);
      const req: ApiRequest =
        decision === "deny"
          ? { method: "POST", path: "/approvals/:id/deny", params: { id: approval.id } }
          : { method: "POST", path: "/approvals/:id/approve", params: { id: approval.id }, body: { decision } };
      const result = await send<ApprovalDecisionResponse>(api, req);
      inFlight.current.delete(approval.id);
      if (!mounted.current) return;
      setBusy((current) => (current === approval.id ? null : current));
      if (result?.ok === true) {
        const answered = result.body.approval;
        setOutcomes((current) => new Map(current).set(answered.id, answered));
        setNotice(approval.id, undefined);
        // The feed's `approval_*` event refetches these too; asking now shows the agent's message sooner.
        store.refetch("approvals");
        store.refetch("grants");
        store.refetch("messages");
        return;
      }
      setNotice(approval.id, { tone: "danger", text: refusalText(result, "decided") });
      if (result !== undefined && !result.ok && "body" in result && result.body.error === "approval_not_pending") store.refetch("approvals");
    },
    [api, store, setNotice],
  );

  const revoke = useCallback(
    async (grant: Grant): Promise<void> => {
      if (revokeBusy !== null) return;
      setRevokeBusy(grant.id);
      const result = await send<RevokeGrantResponse>(api, { method: "POST", path: "/approvals/grants/:id/revoke", params: { id: grant.id } });
      if (!mounted.current) return;
      setRevokeBusy(null);
      if (result?.ok === true) {
        setGrantNotice(`Revoked grant #${grant.id}. ${printable(grant.requesting_agent)} asks again next time.`);
        store.refetch("grants");
        return;
      }
      setGrantNotice(refusalText(result, "revoked"));
      store.refetch("grants");
    },
    [api, store, revokeBusy],
  );

  const showGrants = useCallback(() => {
    const heading = grantsHeading.current;
    heading?.scrollIntoView({ block: "start" });
    heading?.focus();
  }, []);

  // ---- commands and keys -------------------------------------------------------------

  const dialogOpen = revokeTarget !== null;
  const canDecide = selected !== undefined && selected.status === "pending" && busy === null && !dialogOpen;
  const latest = useRef({ selected, canDecide, decide, showGrants, dialogOpen, rows });
  useLayoutEffect(() => {
    latest.current = { selected, canDecide, decide, showGrants, dialogOpen, rows };
  });

  useEffect(() => {
    const run = (decision: Decision) => () => {
      const { selected: current, canDecide: can, decide: act } = latest.current;
      if (current !== undefined && can) void act(current, decision);
    };
    return registry.register("approvals", [
      {
        id: APPROVAL_COMMANDS.approveOnce,
        title: "Allow once",
        group: "Approvals",
        shortcut: "A",
        keywords: ["approve", "allow", "once"],
        enabled: () => latest.current.canDecide,
        run: run("once"),
      },
      {
        id: APPROVAL_COMMANDS.approveAlways,
        title: "Always for this playbook",
        group: "Approvals",
        shortcut: "⇧A",
        keywords: ["approve", "always", "grant"],
        enabled: () => {
          const { selected: current, canDecide: can } = latest.current;
          return can && current !== undefined && alwaysRefusalFor(current) === undefined;
        },
        run: run("always"),
      },
      {
        id: APPROVAL_COMMANDS.deny,
        title: "Deny",
        group: "Approvals",
        shortcut: "D",
        keywords: ["deny", "refuse", "reject"],
        enabled: () => latest.current.canDecide,
        run: run("deny"),
      },
      {
        id: APPROVAL_COMMANDS.showGrants,
        title: "Show grants",
        group: "Approvals",
        keywords: ["grants", "standing", "revoke"],
        enabled: () => !latest.current.dialogOpen,
        run: () => latest.current.showGrants(),
      },
      {
        id: APPROVAL_COMMANDS.showDecided,
        title: "Show decided approvals",
        group: "Approvals",
        keywords: ["decided", "history", "all"],
        enabled: () => !latest.current.dialogOpen,
        run: () => setShowDecided((on) => !on),
      },
    ]);
  }, [registry]);

  // The keys, for while no global keyboard map claims them. The map listens on
  // `window` in the capture phase and prevents the default of every key it runs,
  // so this bubble-phase listener never runs a key twice; it only acts on a key
  // nothing else handled (the List prevents J/K itself while it has focus).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isComposingKey(event) || isEditableTarget(event.target)) return;
      // Nothing runs behind an open dialog (this screen's confirm, the palette, the kill switch).
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      const key = event.key;
      const { selected: current, rows: list, canDecide: can, decide: act } = latest.current;
      if ((key === "j" || key === "k") && !event.shiftKey) {
        if (list.length === 0) return;
        event.preventDefault();
        const at = current === undefined ? -1 : list.findIndex((a) => a.id === current.id);
        const next = list[Math.min(list.length - 1, Math.max(0, at + (key === "j" ? 1 : -1)))];
        if (next !== undefined) setSelectedId(next.id);
        return;
      }
      const decision: Decision | undefined =
        key === "a" && !event.shiftKey ? "once" : key === "A" && event.shiftKey ? "always" : (key === "d" || key === "D") && !event.shiftKey ? "deny" : undefined;
      if (decision === undefined || current === undefined) return;
      event.preventDefault();
      if (event.repeat || !can) return;
      void act(current, decision);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---- render ----------------------------------------------------------------------------

  const listItems = useMemo(
    (): ListDataItem[] =>
      rows.map((a) => ({
        kind: "data",
        key: String(a.id),
        // A decided row is settled, not a live state: `idle`, with the decision in its words.
        status: a.status === "pending" ? "waiting" : "idle",
        statusLabel: decisionWord(a),
        subject: printable(a.action),
        meta: `${printable(a.requesting_agent)} · ${a.playbook === null ? "no playbook" : playbookText(a.playbook)}${a.status === "pending" ? "" : ` · ${decisionWord(a)}`}`,
        aside: clock(a.requested_at),
      })),
    [rows],
  );

  let state: "loading" | "error" | "empty" | "populated";
  if (approvals?.data === undefined) state = approvals?.error === undefined ? "loading" : "error";
  else state = rows.length === 0 ? "empty" : "populated";

  const grantsSection = (
    <GrantsSection
      grants={grants?.data?.grants}
      error={grants?.error}
      loading={grants === undefined || (grants.data === undefined && grants.error === undefined)}
      headingRef={grantsHeading}
      notice={grantNotice}
      busyId={revokeBusy}
      onRevoke={(grant) => {
        setGrantNotice(undefined);
        setRevokeTarget(grant);
      }}
    />
  );

  const bar = (
    <div className="approvals-bar">
      <span className="approvals-count" data-testid="approvals-count">
        {pending.length === 0 ? "inbox" : `${pending.length} pending`}
      </span>
      <span className="approvals-spacer" />
      {state === "error" ? null : (
        <>
          <Button size="row" variant="ghost" aria-pressed={showDecided} onClick={() => setShowDecided((on) => !on)}>
            {showDecided ? "Hide decided" : "Show decided"}
          </Button>
          <Button size="row" variant="ghost" onClick={showGrants}>
            Show grants
          </Button>
        </>
      )}
    </div>
  );

  const revokeDialog =
    revokeTarget === null ? null : (
      <Dialog
        kind="confirm"
        title="Revoke this grant?"
        description={
          <>
            {printable(revokeTarget.requesting_agent)} will ask again before every {printable(revokeTarget.action)} from {playbookText(revokeTarget.playbook)}.
          </>
        }
        action={{
          label: "Revoke",
          onAction: () => {
            const grant = revokeTarget;
            setRevokeTarget(null);
            void revoke(grant);
          },
        }}
        onCancel={() => setRevokeTarget(null)}
      />
    );

  if (state === "error" || state === "empty") {
    return (
      <div className="approvals approvals-single" data-testid="screen-approvals" data-state={state}>
        {bar}
        <div className="approvals-column">
          {state === "error" ? (
            <div className="approvals-empty" role="alert" data-testid="approvals-error">
              <h2 className="approvals-empty-title">Couldn't load approvals.</h2>
              <p className="approvals-empty-note">{approvals?.error === undefined ? "" : errorText(approvals.error)}</p>
              <p className="approvals-empty-note">This screen reloads on its own once the kernel answers.</p>
            </div>
          ) : (
            <div className="approvals-empty" data-testid="approvals-empty">
              <h2 className="approvals-empty-title">{EMPTY_TITLE}</h2>
              <p className="approvals-empty-note">
                Approvals appear here the moment an agent wants to do something outward or persistent: post, push, message, or change a hook.
                Each one shows exactly what will happen.
              </p>
              <Button
                onClick={() => {
                  window.location.hash = "#/sessions";
                }}
              >
                See what's running
              </Button>
            </div>
          )}
          {state === "empty" ? grantsSection : null}
        </div>
        {revokeDialog}
      </div>
    );
  }

  return (
    <div className="approvals" data-testid="screen-approvals" data-state={state}>
      {bar}
      <div className="approvals-inbox">
        <div className="approvals-list-pane">
          <List
            label="Approvals, pending first"
            items={listItems}
            loading={state === "loading"}
            selectedKey={selected === undefined ? null : String(selected.id)}
            onSelect={(item) => setSelectedId(Number(item.key))}
          />
          {showDecided && decided.error !== undefined ? <p className="approvals-note">{decided.error}</p> : null}
          {showDecided && decided.loading ? <p className="approvals-note">Reading decided approvals…</p> : null}
        </div>
        <div className="approvals-detail-pane">
          {selected === undefined ? (
            <div className="approvals-detail" aria-hidden="true" />
          ) : (
            <ApprovalDetail
              key={selected.id}
              approval={selected}
              sessions={sessions?.data?.sessions}
              message={messageFor(selected.id, messages?.data?.messages)}
              notice={notices.get(selected.id)}
              busy={busy === selected.id}
              disabled={busy !== null || dialogOpen}
              onDecide={(decision) => void decide(selected, decision)}
            />
          )}
          {state === "populated" ? grantsSection : null}
        </div>
      </div>
      {revokeDialog}
    </div>
  );
}

// ---- the detail --------------------------------------------------------------------------

interface ApprovalDetailProps {
  readonly approval: Approval;
  readonly sessions: readonly SessionSummary[] | undefined;
  readonly message: BrainMessage | undefined;
  readonly notice: Notice | undefined;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onDecide: (decision: Decision) => void;
}

function ApprovalDetail({ approval: a, sessions, message, notice, busy, disabled, onDecide }: ApprovalDetailProps) {
  const titleId = useId();
  const reasonId = useId();
  const willLine = kernelWillLine(a);
  const alwaysRefused = alwaysRefusalFor(a);
  const pending = a.status === "pending";

  return (
    <section className="approvals-detail" aria-labelledby={titleId} data-testid="approval-detail" data-approval-id={a.id}>
      <header className="approvals-head">
        <h2 className="approvals-title" id={titleId} data-testid="approval-action">
          {printable(a.action)}
        </h2>
        <div className="approvals-meta">
          <span className="approvals-agent" data-testid="approval-agent">
            {printable(a.requesting_agent)}
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="approval-session">{a.requesting_session === null ? "no session" : `session #${a.requesting_session}`}</span>
          {a.playbook === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span data-testid="approval-playbook">from {playbookText(a.playbook)}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>
            #{a.id} · requested <time dateTime={a.requested_at}>{clock(a.requested_at)}</time>
          </span>
        </div>
        <div className="approvals-cwd">
          <span className="approvals-label">cwd</span>
          <code className="approvals-mono" data-testid="approval-cwd">
            {cwdOf(a, sessions)}
          </code>
        </div>
      </header>

      {/* Once decided, what the kernel did and what the agent was told come first. */}
      {pending ? null : <Outcome approval={a} message={message} />}

      {willLine === undefined || !pending ? null : (
        <p className="approvals-will" data-testid="approval-kernel-will">
          {willLine}
        </p>
      )}

      {a.display === undefined ? null : (
        <div className="approvals-well">
          <div className="approvals-well-head">
            <span>Display</span>
            <span className="approvals-spacer" />
            <span className="approvals-well-note">untrusted text</span>
          </div>
          <pre className="approvals-pre" data-testid="approval-display">
            {printable(a.display, true)}
          </pre>
        </div>
      )}

      <div className="approvals-well">
        <div className="approvals-well-head">
          <span>Payload</span>
          <span className="approvals-spacer" />
          <span className="approvals-well-note">exact, untrusted</span>
        </div>
        <pre className="approvals-pre" data-testid="approval-payload">
          {payloadText(a.payload)}
        </pre>
      </div>

      {pending ? (
        <div className="approvals-decide">
          <div className="approvals-actions">
            <Button variant="primary" kbd="A" aria-keyshortcuts="A" loading={busy} disabled={disabled && !busy} onClick={() => onDecide("once")}>
              Allow once
            </Button>
            <Button
              variant="secondary"
              kbd="⇧A"
              aria-keyshortcuts="Shift+A"
              disabled={alwaysRefused !== undefined || disabled}
              aria-describedby={alwaysRefused === undefined ? undefined : reasonId}
              onClick={() => onDecide("always")}
            >
              Always for this playbook
            </Button>
            <Button variant="danger" kbd="D" aria-keyshortcuts="D" disabled={disabled} onClick={() => onDecide("deny")}>
              Deny
            </Button>
          </div>
          {alwaysRefused === undefined ? null : (
            <p className="approvals-reason" id={reasonId} data-testid="always-reason">
              {alwaysRefused}
            </p>
          )}
          {notice === undefined ? null : (
            <p className="approvals-notice" data-tone={notice.tone} role="status" data-testid="approval-notice">
              {notice.text}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Outcome({ approval: a, message }: { readonly approval: Approval; readonly message: BrainMessage | undefined }) {
  return (
    <div className="approvals-outcome" data-testid="approval-outcome" role="status">
      <p className="approvals-decision">
        <Badge tone={a.status === "denied" ? "danger" : "ok"}>{decisionWord(a)}</Badge>
        <span>{decisionSentence(a)}</span>
      </p>
      {a.applied === undefined ? null : (
        <p className="approvals-applied" data-testid="approval-applied">
          <span className="approvals-label">Kernel</span>
          <span>{printable(a.applied)}</span>
        </p>
      )}
      {a.apply_refused === undefined ? null : (
        <div className="approvals-applied" data-testid="approval-refused">
          <span className="approvals-label">Not applied</span>
          <span>{printable(a.apply_refused)}</span>
          {a.apply_detail === undefined ? null : <pre className="approvals-pre approvals-pre-inline">{printable(a.apply_detail, true)}</pre>}
        </div>
      )}
      <div className="approvals-well">
        <div className="approvals-well-head">
          <span>The message {printable(a.requesting_agent)} gets</span>
          <span className="approvals-spacer" />
          <span className="approvals-well-note">{message === undefined ? "" : printable(message.status)}</span>
        </div>
        {message === undefined ? (
          <p className="approvals-note" data-testid="approval-message-pending">
            The kernel queues it with the decision; it shows here once the kernel has it.
          </p>
        ) : (
          <pre className="approvals-pre" data-testid="approval-message">
            {printable(message.text, true)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---- grants ------------------------------------------------------------------------------------

interface GrantsSectionProps {
  readonly grants: readonly Grant[] | undefined;
  readonly error: ResourceError | undefined;
  readonly loading: boolean;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly notice: string | undefined;
  readonly busyId: number | null;
  readonly onRevoke: (grant: Grant) => void;
}

function GrantsSection({ grants, error, loading, headingRef, notice, busyId, onRevoke }: GrantsSectionProps) {
  const headingId = useId();
  let body: ReactNode;
  if (grants === undefined && error !== undefined) body = <p className="approvals-note">Couldn't load grants. {errorText(error)}</p>;
  else if (grants === undefined || loading) body = <p className="approvals-note">Reading grants…</p>;
  else if (grants.length === 0)
    body = <p className="approvals-note">No standing grants. "Always for this playbook" adds one; it shows here with Revoke.</p>;
  else
    body = (
      <ul className="approvals-grants" aria-labelledby={headingId}>
        {grants.map((g) => (
          <li key={g.id} className="approvals-grant" data-testid={`grant-${g.id}`}>
            <div className="approvals-grant-main">
              <div className="approvals-grant-top">
                <span className="approvals-grant-action">{printable(g.action)}</span>
                {g.current ? null : (
                  <span data-testid="grant-not-current">
                    <Badge tone="attention">not current</Badge>
                  </span>
                )}
              </div>
              <div className="approvals-grant-meta">
                {playbookText(g.playbook)} · {printable(g.requesting_agent)} · #{g.id} · granted {clock(g.granted_at)}
                {g.current ? "" : " · the playbook has a newer version, so it no longer matches"}
              </div>
              <pre className="approvals-pre approvals-pre-small">{payloadText(g.payload)}</pre>
            </div>
            <Button size="row" variant="secondary" loading={busyId === g.id} onClick={() => onRevoke(g)} aria-label={`Revoke grant #${g.id}`}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    );
  return (
    <section className="approvals-grants-section" aria-labelledby={headingId} data-testid="approvals-grants">
      <h2 className="approvals-section-title" id={headingId} ref={headingRef} tabIndex={-1}>
        Standing grants{grants === undefined || grants.length === 0 ? "" : ` (${grants.length})`}
      </h2>
      {body}
      {notice === undefined ? null : (
        <p className="approvals-note" role="status" data-testid="grant-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
