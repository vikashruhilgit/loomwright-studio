// Chat's charter card (phase 8 item 18d; docs/DESIGN.md §"Charter card (phase
// 8 item 18a)", the mockup `docs/design/mockups/charter-card.html`): a held
// charter create or update (`isCharterApproval`), inline at the end of the
// thread.
//
// - The compact plain view first, the full details on request, and copy:
//   `CharterDisplay`, as on the Approvals screen.
// - When the kernel's readiness block flags a missing workspace, Choose
//   workspace on that line opens the workspace question (`WorkspaceQuestion`).
// - When it flags a ticket duty's tracker the member can't read yet (ClickUp or
//   Jira, phase 8 item 21b), Choose access on that line opens the tracker's
//   capabilities in words (`CapabilityList`, the Team inspector's own list), and
//   what the owner ticks rides on Create (or Approve) as `owner_grant`, granted in
//   the same approval as the owner's own. Nothing is ticked for the owner; a
//   tracker that isn't connected offers Connect (Integrations) and nothing else.
// - The Ask or change box (`CharterAsk`) posts the owner's words as a Reply
//   into the thread the charter was drafted in.
// - Versions: when Wright holds a newer charter call for the same member, the
//   kernel withdraws the older one (`replaced_by`, the owner's 2026-11-11
//   decision 1). Above the live card, each older version shows collapsed:
//   "<member> · v<k> · Replaced by v<k+1> · <what changed>", opening a
//   read-only card (no Create, no Deny, no Ask).
// - Create (or Approve, for an update) and Deny: one contract write each; a
//   refusal shows the kernel's words as text and leaves the card in place.
//
// Every kernel string is untrusted: `printable`, as a React text child only.
import { useEffect, useRef, useState } from "react";
import type { Approval, ApprovalsResponse, ConnectorsResponse, McpCapability, McpConnection, McpConnectionKind, OwnerGrant, StudioBridge, ThreadFigures, ThreadItem } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { useResource } from "../../store/react";
import { CharterDisplay } from "../approvals/CharterDisplay";
import { WORKSPACE_FLAG, charterBlocks, nextOwnerGrant, repoCandidates, trackerLine, whatChanged } from "../approvals/charterBlocks";
import type { TrackerLine } from "../approvals/charterBlocks";
import { printable } from "../approvals/printable";
import { approvalSubject, charterDisplayParts } from "../approvals/subject";
import { CharterAsk, WorkspaceQuestion } from "./CharterAsk";
import { CapabilityList } from "../team/Connectors";
import { MCP_KIND_LABELS } from "../team/model";
import { Refusal, approvalChanges, useCardAction } from "./cardActions";
import { navigate, write } from "./model";
import "./chat.css";

/** The older version's line: "<member> · v<k> · Replaced by v<k+1> · <what changed>". */
export const REPLACED_BY = "Replaced by";

/** The readiness line's fix that opens the workspace question. */
export const CHOOSE_WORKSPACE = "Choose workspace";

/** The tracker line's fix when the owner can grant access: opens the capability list. */
export const CHOOSE_ACCESS = "Choose access";

/** The tracker line's fix when the tracker isn't connected: goes to Integrations, grants nothing. */
export const CONNECT_TRACKER = "Connect";

/** The Integrations route the Connect fix opens. */
const INTEGRATIONS_HASH = "#/integrations";

/** What the card says when the decided approvals could not be read: older versions may be missing, never "there are none". */
export const VERSIONS_FAILED = "Couldn't read this charter's earlier versions from the kernel, so they may be missing here.";

/**
 * The approvals the kernel decided too (`GET /approvals?all=1`), read again
 * whenever the approvals list changes. `failed` is set when the latest read
 * failed, so a failed read is never shown as "no older versions".
 */
function useAllApprovals(api: StudioBridge): { readonly all: readonly Approval[] | undefined; readonly failed: boolean } {
  const approvals = useResource("approvals", api);
  const answeredAt = approvals?.updatedAt ?? null;
  const [all, setAll] = useState<readonly Approval[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      let answer;
      try {
        answer = await api.request<ApprovalsResponse>({ method: "GET", path: "/approvals", query: { all: "1" } });
      } catch {
        answer = undefined;
      }
      if (!live) return;
      if (answer?.ok === true) {
        setAll(answer.body.approvals);
        setFailed(false);
      } else {
        setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, answeredAt]);
  return { all, failed };
}

export { CapabilityList };

/** The tracker's connection as `GET /connectors` answers it: reading, read (the row, or none), or a failed read. */
type TrackerConnection = { readonly status: "loading" } | { readonly status: "error" } | { readonly status: "ok"; readonly row: McpConnection | undefined };

/** One read of `GET /connectors` for `kind`'s row, made when the panel opens (never "not connected" on a failed read). */
function useTrackerConnection(api: StudioBridge, kind: McpConnectionKind): TrackerConnection {
  const [state, setState] = useState<TrackerConnection>({ status: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      let answer;
      try {
        answer = await api.request<ConnectorsResponse>({ method: "GET", path: "/connectors" });
      } catch {
        answer = undefined;
      }
      if (!live) return;
      setState(answer?.ok === true ? { status: "ok", row: (answer.body.mcp_connections ?? []).find((row) => row.kind === kind) } : { status: "error" });
    })();
    return () => {
      live = false;
    };
  }, [api, kind]);
  return state;
}

/**
 * The control on a readiness line about a ticket duty's tracker (item 21b), for `CharterDisplay`'s `readinessFix`:
 * Choose access (toggles the tracker's capability panel) when the member lacks access, Connect (to Integrations)
 * when the tracker isn't connected, nothing for any other line. It only opens things; it grants nothing.
 */
export function trackerFix(line: TrackerLine | undefined, open: boolean, onToggle: (kind: McpConnectionKind) => void) {
  if (line === undefined) return null;
  if (line.state === "not_connected") {
    return (
      <Button variant="secondary" size="row" onClick={() => navigate(INTEGRATIONS_HASH)}>
        {CONNECT_TRACKER}
      </Button>
    );
  }
  return (
    <Button variant="secondary" size="row" aria-expanded={open} onClick={() => onToggle(line.kind)}>
      {CHOOSE_ACCESS}
    </Button>
  );
}

export interface TrackerPanelProps {
  readonly api: StudioBridge;
  readonly kind: McpConnectionKind;
  /** The member the card is about. */
  readonly member: string;
  /** What the owner has ticked on this card so far (one kind at a time). */
  readonly grant: OwnerGrant | undefined;
  readonly onToggle: (kind: McpConnectionKind, capability: McpCapability, on: boolean) => void;
  /** Whether the card says Create or Approve, for the words. */
  readonly verb: string;
  readonly disabled?: boolean;
}

/**
 * A tracker's capabilities for the owner to tick on a held crew create or update (item 21b): the same
 * `CapabilityList` the Team inspector shows, with the ticks kept on the card until Create or Approve posts
 * them as `owner_grant`. Nothing is ticked by default (invariant 1). A connection the list can't be built
 * for, or that isn't connected, says so and offers no tick.
 */
export function TrackerPanel({ api, kind, member, grant, onToggle, verb, disabled = false }: TrackerPanelProps) {
  const label = MCP_KIND_LABELS[kind];
  const connection = useTrackerConnection(api, kind);
  const row = connection.status === "ok" ? connection.row : undefined;
  const connected = row !== undefined && (row.status === "connected" || row.status === "expiring");
  let body;
  if (connection.status === "loading") {
    body = <p className="chat-card-hint" role="status">Reading {label}'s tools…</p>;
  } else if (connection.status === "error") {
    body = <p className="chat-card-refusal" role="alert">Couldn't read the {label} connection, so its access can't be chosen here. {verb} still works; grant it in Team afterwards.</p>;
  } else if (!connected) {
    body = (
      <p className="chat-card-hint">
        {label} isn't connected on Integrations, so there is nothing to grant yet.{" "}
        <Button variant="secondary" size="row" onClick={() => navigate(INTEGRATIONS_HASH)}>
          {CONNECT_TRACKER}
        </Button>
      </p>
    );
  } else if (row.capabilities === undefined || row.capabilities === null) {
    body = <p className="chat-card-hint" data-testid="charter-tracker-plain-unavailable">The plain list of what {label} can do is unavailable, so nothing can be ticked here. Grant it in Team afterwards.</p>;
  } else {
    const other = grant !== undefined && grant.kind !== kind;
    body = (
      <>
        <p className="chat-card-hint">
          Tick what {printable(member)} may do in {label}. It is granted as your own grant when you {verb.toLowerCase()}; nothing is ticked for you.
          {other ? ` ${MCP_KIND_LABELS[grant.kind]} access is ticked already: clear it to choose ${label} access (one tracker per approval).` : ""}
        </p>
        <CapabilityList
          kind={kind}
          capabilities={row.capabilities}
          otherTools={row.other_tools ?? []}
          held={grant?.kind === kind ? grant.tools : []}
          disabled={disabled || other}
          onToggle={(capability, on) => onToggle(kind, capability, on)}
          testId={`charter-tracker-${kind}`}
        />
      </>
    );
  }
  return (
    <div className="chat-charter-tracker" data-testid="charter-tracker-panel" data-kind={kind}>
      {body}
    </div>
  );
}

/**
 * The versions `approval` replaced, oldest first: the approval whose
 * `replaced_by` is this one's id, then the one that one replaced, and so on.
 * Each is the kernel's own record; a loop in the chain stops it.
 */
export function olderVersions(all: readonly Approval[], approval: Approval): Approval[] {
  const out: Approval[] = [];
  const seen = new Set<number>([approval.id]);
  let current = approval.id;
  for (;;) {
    const older = all.find((a) => a.replaced_by === current && !seen.has(a.id));
    if (older === undefined) break;
    seen.add(older.id);
    out.unshift(older);
    current = older.id;
  }
  return out;
}

/** The member a charter approval is about, as its payload names it; the requesting agent's words otherwise. */
function memberOf(approval: Approval): string {
  const subject = approvalSubject(approval);
  return subject?.kind === "member" ? subject.id : "the crew member";
}

/** One older version, collapsed to its line; opening it shows its read-only card. */
function OlderVersion({ approval, version, next, nextDisplay }: { readonly approval: Approval; readonly version: number; readonly next: number; readonly nextDisplay: string }) {
  const [open, setOpen] = useState(false);
  const display = approval.display ?? "";
  const parts = charterDisplayParts(display);
  const changed = whatChanged(display, nextDisplay);
  return (
    <details className="chat-charter-old" data-testid="charter-old" data-approval={approval.id} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="chat-charter-old-line">
        {printable(memberOf(approval))} · v{version} · {REPLACED_BY} v{next} · {printable(changed)}
      </summary>
      {open ? (
        parts === undefined ? (
          <pre className="chat-charter-display">{printable(display, true)}</pre>
        ) : (
          <CharterDisplay parts={parts} display={display} />
        )
      ) : null}
    </details>
  );
}

export interface CharterCardProps {
  readonly api: StudioBridge;
  readonly approval: Approval;
  /** The agent whose thread this is. */
  readonly agent: string;
  /** The thread's loaded items (every page), where the drafting message is looked for. */
  readonly items?: readonly ThreadItem[];
  /** The kernel's figures of each thread on the page, for the drafting thread's title. */
  readonly threads?: readonly ThreadFigures[];
}

/** A pending charter create or update, with its older versions collapsed above it. */
export function CharterCard({ api, approval, agent, items, threads }: CharterCardProps) {
  const [refusal, setRefusal] = useState("");
  const { busy, act } = useCardAction();
  const [question, setQuestion] = useState(false);
  /** The tracker whose capability panel is open, and what the owner ticked (sent as `owner_grant` on Create or Approve). */
  const [trackerOpen, setTrackerOpen] = useState<McpConnectionKind | null>(null);
  const [ownerGrant, setOwnerGrant] = useState<OwnerGrant | undefined>(undefined);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const { all, failed: versionsFailed } = useAllApprovals(api);
  const changes = approvalChanges(agent);
  const params = { id: approval.id };
  const decide = (key: "create" | "deny", path: string, body: unknown): void =>
    act(key, async () => {
      const outcome = await write(api, path, params, body, changes);
      setRefusal(outcome.ok ? "" : outcome.text);
    });
  const display = approval.display ?? "";
  const parts = charterDisplayParts(display);
  const update = parts?.update ?? approval.action === "kernel_agent_update";
  const member = memberOf(approval);
  const older = all === undefined ? [] : olderVersions(all, approval);
  const version = older.length + 1;
  const repos = parts === undefined ? [] : repoCandidates(display, parts, charterBlocks(display, parts));
  const closeQuestion = (): void => {
    setQuestion(false);
    // The question unmounts with focus in it: back to the control that opened it.
    requestAnimationFrame(() => chooseRef.current?.focus());
  };

  return (
    <>
      {older.map((a, i) => (
        <OlderVersion key={a.id} approval={a} version={i + 1} next={i + 2} nextDisplay={(older[i + 1] ?? approval).display ?? ""} />
      ))}
      <section className="chat-card chat-charter" aria-label={`Drafted crew member, approval ${approval.id}`} data-approval={approval.id}>
        <div className="chat-card-head">
          <span className="chat-card-title">Waiting on you · {update ? "crew member update" : "new crew member"}</span>
          <span className="chat-card-meta">
            {printable(member)}
            {older.length === 0 ? null : ` · v${version}`} · approval {approval.id} · proposed by Wright
          </span>
        </div>
        {versionsFailed ? (
          <p className="chat-card-refusal" role="alert" data-testid="charter-versions-failed">
            {VERSIONS_FAILED}
          </p>
        ) : null}
        {parts === undefined ? (
          // Not the kernel's charter format: shown exactly as the kernel wrote it, as text.
          <pre className="chat-charter-display">{printable(display, true)}</pre>
        ) : (
          <CharterDisplay
            parts={parts}
            display={display}
            readinessFix={(line) =>
              line.status !== "flagged" ? null : line.text.includes(WORKSPACE_FLAG) ? (
                <Button variant="secondary" size="row" ref={chooseRef} aria-expanded={question} onClick={() => setQuestion((q) => !q)}>
                  {CHOOSE_WORKSPACE}
                </Button>
              ) : (
                trackerFix(trackerLine(line.text), trackerOpen === trackerLine(line.text)?.kind, (kind) => setTrackerOpen((open) => (open === kind ? null : kind)))
              )
            }
            afterReadiness={
              <>
                {question ? <WorkspaceQuestion api={api} approval={approval} member={member} repos={repos} items={items} threads={threads} onClose={closeQuestion} /> : null}
                {trackerOpen === null ? null : (
                  <TrackerPanel
                    api={api}
                    kind={trackerOpen}
                    member={member}
                    grant={ownerGrant}
                    onToggle={(kind, capability, on) => setOwnerGrant((current) => nextOwnerGrant(current, kind, capability, on))}
                    verb={update ? "Approve" : "Create"}
                    disabled={busy !== null}
                  />
                )}
              </>
            }
          >
            <CharterAsk api={api} approval={approval} items={items} threads={threads} />
          </CharterDisplay>
        )}
        {parts === undefined ? <CharterAsk api={api} approval={approval} items={items} threads={threads} /> : null}
        <div className="chat-card-actions">
          <Button variant="primary" size="row" loading={busy === "create"} onClick={() => decide("create", "/approvals/:id/approve", ownerGrant === undefined ? { decision: "once" } : { decision: "once", owner_grant: ownerGrant })}>
            {update ? "Approve" : "Create"}
          </Button>
          <Button variant="danger" size="row" loading={busy === "deny"} onClick={() => decide("deny", "/approvals/:id/deny", undefined)}>
            Deny
          </Button>
        </div>
        <Refusal text={refusal} />
      </section>
    </>
  );
}
