// Chat's charter card (phase 8 item 18d; docs/DESIGN.md §"Charter card (phase
// 8 item 18a)", the mockup `docs/design/mockups/charter-card.html`): a held
// charter create or update (`isCharterApproval`), inline at the end of the
// thread.
//
// - The compact plain view first, the full details on request, and copy:
//   `CharterDisplay`, as on the Approvals screen.
// - When the kernel's readiness block flags a missing workspace, Choose
//   workspace on that line opens the workspace question (`WorkspaceQuestion`).
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
import type { Approval, ApprovalsResponse, StudioBridge, ThreadFigures, ThreadItem } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { useResource } from "../../store/react";
import type { ResourceName } from "../../store/resources";
import { CharterDisplay } from "../approvals/CharterDisplay";
import { WORKSPACE_FLAG, charterBlocks, repoCandidates, whatChanged } from "../approvals/charterBlocks";
import { printable } from "../approvals/printable";
import { approvalSubject, charterDisplayParts } from "../approvals/subject";
import { CharterAsk, WorkspaceQuestion } from "./CharterAsk";
import { inFlightGuard, write } from "./model";
import "./chat.css";

/** The older version's line: "<member> · v<k> · Replaced by v<k+1> · <what changed>". */
export const REPLACED_BY = "Replaced by";

/** The readiness line's fix that opens the workspace question. */
export const CHOOSE_WORKSPACE = "Choose workspace";

/** The approvals the kernel decided too (`GET /approvals?all=1`), read again whenever the approvals list changes. */
function useAllApprovals(api: StudioBridge): readonly Approval[] | undefined {
  const approvals = useResource("approvals", api);
  const answeredAt = approvals?.updatedAt ?? null;
  const [all, setAll] = useState<readonly Approval[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      let answer;
      try {
        answer = await api.request<ApprovalsResponse>({ method: "GET", path: "/approvals", query: { all: "1" } });
      } catch {
        answer = undefined;
      }
      if (live && answer?.ok === true) setAll(answer.body.approvals);
    })();
    return () => {
      live = false;
    };
  }, [api, answeredAt]);
  return all;
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

function Refusal({ text }: { readonly text: string }) {
  return text === "" ? null : (
    <p className="chat-card-refusal" role="alert">
      {text}
    </p>
  );
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
  const [busy, setBusy] = useState<string | null>(null);
  const [guard] = useState(inFlightGuard);
  const [question, setQuestion] = useState(false);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const all = useAllApprovals(api);
  const changes: ResourceName[] = [`thread:${agent}`, "approvals", "grants", "agents", "playbooks", "triggers"];
  const params = { id: approval.id };
  const decide = (key: "create" | "deny", path: string, body: unknown): void => {
    void guard.run(async () => {
      setBusy(key);
      try {
        const outcome = await write(api, path, params, body, changes);
        setRefusal(outcome.ok ? "" : outcome.text);
      } finally {
        setBusy(null);
      }
    });
  };
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
        {parts === undefined ? (
          // Not the kernel's charter format: shown exactly as the kernel wrote it, as text.
          <pre className="chat-charter-display">{printable(display, true)}</pre>
        ) : (
          <CharterDisplay
            parts={parts}
            display={display}
            readinessFix={(line) =>
              line.status === "flagged" && line.text.includes(WORKSPACE_FLAG) ? (
                <Button variant="secondary" size="row" ref={chooseRef} aria-expanded={question} onClick={() => setQuestion((q) => !q)}>
                  {CHOOSE_WORKSPACE}
                </Button>
              ) : null
            }
            afterReadiness={
              question ? <WorkspaceQuestion api={api} approval={approval} member={member} repos={repos} items={items} threads={threads} onClose={closeQuestion} /> : null
            }
          >
            <CharterAsk api={api} approval={approval} items={items} threads={threads} />
          </CharterDisplay>
        )}
        {parts === undefined ? <CharterAsk api={api} approval={approval} items={items} threads={threads} /> : null}
        <div className="chat-card-actions">
          <Button variant="primary" size="row" loading={busy === "create"} onClick={() => decide("create", "/approvals/:id/approve", { decision: "once" })}>
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
