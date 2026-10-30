// The thread's actionable cards: a pending approval (EventCard's approval
// variant, with a link to what it is about), the charter card (a `kernel_agent_create` approval), the
// playbook card and the trigger card. Each action is one contract write
// through the bridge; a refusal shows the kernel's words as text and leaves
// the card in place. Every kernel string is a React text child only.
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { Approval, PlaybookListing, StudioBridge, Trigger } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { EventCard } from "../../components/EventCard/EventCard";
import { POLICY_FIELDS, PolicyEditor, policyRows, provenance } from "../../components/PlaybookPolicy/PlaybookPolicy";
import type { PolicyField } from "../../components/PlaybookPolicy/PlaybookPolicy";
import type { ResourceName } from "../../store/resources";
import { approvalLink, approvalSourceText } from "../approvals/subject";
import { focusLost, inFlightGuard, navigate, rehashIfCurrent, triggerSchedule, triggerState, when, write } from "./model";

/** What Always says when the approval did not come from a playbook session. */
export const ALWAYS_INELIGIBLE = "Always needs an approval from a playbook session; approve once";

export const LAST_DRY_RUN_GAP = "Last dry run: not available from the kernel yet";

function Refusal({ text }: { readonly text: string }) {
  return text === "" ? null : (
    <p className="chat-card-refusal" role="alert">
      {text}
    </p>
  );
}

/**
 * A card's actions share one in-flight guard: while one write is pending, any
 * second click on the card is dropped (two Run now clicks would queue two
 * runs). `busy` names the pending action, for its Button's `loading`.
 */
function useCardAction(): { readonly busy: string | null; readonly act: (key: string, fn: () => Promise<void>) => void } {
  const [guard] = useState(inFlightGuard);
  const [busy, setBusy] = useState<string | null>(null);
  const act = (key: string, fn: () => Promise<void>): void => {
    void guard.run(async () => {
      setBusy(key);
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  };
  return { busy, act };
}

function approvalChanges(agent: string): ResourceName[] {
  return [`thread:${agent}`, "approvals", "grants", "agents", "playbooks", "triggers"];
}

export interface ApprovalCardProps {
  readonly api: StudioBridge;
  readonly approval: Approval;
  /** The agent whose thread this is. */
  readonly agent: string;
  /** The kernel's playbooks, for the link's slug; `undefined` while unread. */
  readonly playbooks: readonly PlaybookListing[] | undefined;
}

/** A pending approval, inline at the end of the thread, with a link to what it is about when it names one. */
export function ApprovalCard({ api, approval, agent, playbooks }: ApprovalCardProps) {
  const [refusal, setRefusal] = useState("");
  // EventCard's approval buttons take no `loading`, so the guard only drops repeats here.
  const { act } = useCardAction();
  const changes = approvalChanges(agent);
  const params = { id: approval.id };
  const link = approvalLink(approval, playbooks);
  const decide = (decision: "once" | "always"): void =>
    act(decision, async () => {
      const outcome = await write(api, "/approvals/:id/approve", params, { decision }, changes);
      setRefusal(outcome.ok ? "" : outcome.text);
    });
  return (
    <div className="chat-approval" data-approval={approval.id}>
      <EventCard
        variant="approval"
        threadAgent={agent}
        approval={{
          id: String(approval.id),
          requestingAgent: approval.requesting_agent,
          title: approval.action,
          summary: approval.display ?? approval.action,
          reason: approvalSourceText(approval),
        }}
        onAllowOnce={() => decide("once")}
        onAlways={() => {
          // The app sees only this part of the kernel's `alwaysRefusal`; the kernel's 409 covers the rest.
          if (approval.playbook === null) {
            setRefusal(ALWAYS_INELIGIBLE);
            return;
          }
          decide("always");
        }}
        onDeny={() =>
          act("deny", async () => {
            const outcome = await write(api, "/approvals/:id/deny", params, undefined, changes);
            setRefusal(outcome.ok ? "" : outcome.text);
          })
        }
        onFullPayload={() => navigate("#/approvals")}
      />
      {/* A link, not a button: it only navigates. The same href again still scrolls to the card. */}
      {link === undefined ? null : (
        <a className="chat-approval-link" href={link.href} data-testid="chat-approval-link" onClick={() => rehashIfCurrent(link.href)}>{link.text}</a>
      )}
      <Refusal text={refusal} />
    </div>
  );
}

export interface CharterCardProps {
  readonly api: StudioBridge;
  readonly approval: Approval;
  readonly agent: string;
  /** Edit in English: put `text` in the composer and focus it. Sends nothing. */
  readonly onEditInEnglish: (text: string) => void;
}

/** A pending `kernel_agent_create`: the charter as the kernel displays it, never parsed. */
export function CharterCard({ api, approval, agent, onEditInEnglish }: CharterCardProps) {
  const [refusal, setRefusal] = useState("");
  const { busy, act } = useCardAction();
  const changes = approvalChanges(agent);
  const params = { id: approval.id };
  const decide = (key: "create" | "deny", path: string, body: unknown): void =>
    act(key, async () => {
      const outcome = await write(api, path, params, body, changes);
      setRefusal(outcome.ok ? "" : outcome.text);
    });
  return (
    <section className="chat-card chat-charter" aria-label={`Drafted crew member, approval ${approval.id}`} data-approval={approval.id}>
      <div className="chat-card-head">
        <span className="chat-card-title">Waiting on you · new crew member</span>
        <span className="chat-card-meta">approval {approval.id}</span>
      </div>
      <pre className="chat-charter-display">{approval.display ?? ""}</pre>
      <div className="chat-card-actions">
        <Button variant="primary" size="row" loading={busy === "create"} onClick={() => decide("create", "/approvals/:id/approve", { decision: "once" })}>
          Create
        </Button>
        <Button variant="secondary" size="row" onClick={() => onEditInEnglish(`About the charter in approval ${approval.id}: `)}>
          Edit in English
        </Button>
        <Button variant="danger" size="row" loading={busy === "deny"} onClick={() => decide("deny", "/approvals/:id/deny", undefined)}>
          Deny
        </Button>
      </div>
      <Refusal text={refusal} />
    </section>
  );
}

/** A value and its provenance tag, as text. */
function FieldValue({ value, setBy, mono = false }: { readonly value: string; readonly setBy?: string | null; readonly mono?: boolean }) {
  const tag = setBy === undefined ? "" : provenance(setBy);
  return (
    <span className="chat-kv-value">
      <span className={mono ? "chat-mono" : undefined}>{value}</span>
      {tag === "" ? null : <span className={tag === "proposed" ? "chat-tag proposed" : "chat-tag owner"}>{tag}</span>}
    </span>
  );
}

function Field({ label, value, setBy, mono = false }: { readonly label: string; readonly value: string; readonly setBy?: string | null; readonly mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-field={label}>
        <FieldValue value={value} setBy={setBy} mono={mono} />
      </dd>
    </>
  );
}

/** The kernel has no owner route that turns a disabled playbook back on (only an approved draft is enabled). */
export const TURN_ON_GAP = "Turn on: not available from the kernel";

/** The Turn off write's path, which is also its key in the card's in-flight guard. */
const OFF = "/playbooks/:id/off";

function playbookChanges(agent: string): ResourceName[] {
  return ["playbooks", "triggers", `thread:${agent}`];
}

export interface PlaybookCardProps {
  readonly api: StudioBridge;
  readonly playbookId: number;
  readonly playbook: PlaybookListing | undefined;
  readonly trigger: Trigger | undefined;
  readonly agent: string;
}

/**
 * A playbook named by a `playbook_created` / `playbook_updated` card: its
 * policy, each value's provenance (an unset value reads "not set"), an Edit on
 * each owner-settable row, and its actions. No Enable: enabling stays an
 * approval. A disabled playbook keeps its card (the list is read with
 * `all=1`) with no Run now or Turn off (the kernel runs only an enabled one),
 * and still offers each row's Set (the kernel keeps it disabled).
 */
export function PlaybookCard({ api, playbookId, playbook, trigger, agent }: PlaybookCardProps) {
  const [refusal, setRefusal] = useState("");
  // While a write is pending, which editor is open never changes (every Edit, and the open
  // editor's Cancel and Escape, wait for the answer), so a Set's answer is always its own editor's.
  // The one exception, a Turn off whose list already says disabled, has no Set pending (`editHeld`).
  const [editing, setEditing] = useState<PolicyField | null>(null);
  const { busy, act } = useCardAction();
  const editRefs = useRef(new Map<PolicyField, HTMLButtonElement>());
  const cardRef = useRef<HTMLElement>(null);
  // Opening or closing a row's editor, or a Turn off swapping the actions for the Turn on gap,
  // unmounts the focused control: say where focus goes ("card": the first row's control).
  const focusAfterSwap = useRef<PolicyField | "card" | null>(null);
  const status = playbook?.status;
  // Keyed on the status too. A Turn off arms "card" before its write, and the target waits, still
  // armed, for the render that swaps the actions out, whichever lands first: the write's answer or
  // the refetched list that disables the playbook (the feed's playbook_disabled can beat the answer).
  useLayoutEffect(() => {
    const target = focusAfterSwap.current;
    if (target === null || (target === "card" && status !== "disabled")) return;
    focusAfterSwap.current = null;
    if (!focusLost()) return;
    if (target !== "card") {
      editRefs.current.get(target)?.focus();
      return;
    }
    // The first row's Edit, or its editor's field when that row is open: focus stays in the card.
    for (const field of POLICY_FIELDS) {
      const control =
        field === editing ? cardRef.current?.querySelector<HTMLElement>('[data-editing="true"] .field-control') : editRefs.current.get(field);
      if (control === null || control === undefined || (control instanceof HTMLButtonElement && control.disabled)) continue;
      control.focus();
      return;
    }
  }, [editing, status]);
  if (playbook === undefined) {
    return (
      <section className="chat-card" aria-label={`Playbook ${playbookId}`}>
        <p className="chat-card-meta">Playbook {playbookId} is not in the kernel's playbook list.</p>
      </section>
    );
  }
  const params = { id: playbook.id };
  const changes = playbookChanges(agent);
  const run = (path: string, body?: unknown): void =>
    act(path, async () => {
      // A disabled playbook has no actions row: the focused Turn off unmounts once the list says
      // disabled, which may be before this write answers. Armed only once the guard let the write
      // through; a refusal disarms it, so a stale target never moves focus later.
      if (path === OFF) focusAfterSwap.current = "card";
      const outcome = await write(api, path, params, body, changes);
      setRefusal(outcome.ok ? "" : outcome.text);
      if (!outcome.ok && focusAfterSwap.current === "card") focusAfterSwap.current = null;
    });
  const confirm = (field: PolicyField, value: string): void =>
    act(`set:${field}`, async () => {
      const outcome = await write(api, "/playbooks/:id/set", params, { field, value }, changes);
      if (!outcome.ok) {
        // The row stays in edit mode with the owner's text, under the kernel's words.
        setRefusal(outcome.text);
        return;
      }
      setRefusal("");
      focusAfterSwap.current = field;
      setEditing(null);
    });
  const cancel = (field: PolicyField): void => {
    focusAfterSwap.current = field;
    setEditing(null);
  };
  const disabled = playbook.status === "disabled";
  // A control that cannot act while another write is pending says so (the guard would drop it).
  const heldFor = (key: string): boolean => busy !== null && busy !== key;
  // Once the list says disabled, a pending Turn off has nothing left to change on this card (its
  // answer sets only the refusal line), so it no longer holds the row Edits: the one Turn off's
  // focus moves to stays focusable, whether the answer or the list landed first.
  const editHeld = (field: PolicyField): boolean => heldFor(`set:${field}`) && !(disabled && busy === OFF);
  return (
    <section ref={cardRef} className="chat-card chat-playbook" aria-label={`Playbook ${playbook.slug}`} data-playbook={playbook.id}>
      <div className="chat-card-head">
        <span className="chat-card-title">{playbook.name}</span>
        <span className="chat-card-meta chat-mono">{playbook.slug}</span>
        <span className="chat-card-meta">{playbook.status}</span>
      </div>
      <dl className="chat-kv">
        <Field label="Intent" value={playbook.intent} />
        <Field
          label="Trigger"
          value={
            trigger === undefined
              ? playbook.trigger_id === null
                ? "none"
                : `trigger ${playbook.trigger_id}`
              : `${trigger.kind}${trigger.next_fire_at === null ? "" : ` · next ${when(trigger.next_fire_at)}`}`
          }
        />
        {policyRows(playbook).map((row) => (
          <Fragment key={row.field}>
            <dt>{row.label}</dt>
            <dd className="chat-kv-row" data-field={row.label} data-editing={editing === row.field ? "true" : undefined}>
              {editing === row.field ? (
                <PolicyEditor
                  row={row}
                  busy={busy === `set:${row.field}`}
                  held={busy !== null}
                  onConfirm={(value) => confirm(row.field, value)}
                  onCancel={() => cancel(row.field)}
                />
              ) : (
                <>
                  <FieldValue value={row.shown} setBy={row.setBy} mono={row.mono} />
                  <Button
                    variant="ghost"
                    size="row"
                    className="chat-kv-edit"
                    aria-label={`Edit ${row.name}`}
                    // Its own Set's answer may render it before the guard clears: it stays focusable for that.
                    disabled={editHeld(row.field)}
                    ref={(el) => {
                      if (el === null) editRefs.current.delete(row.field);
                      else editRefs.current.set(row.field, el);
                    }}
                    onClick={() => setEditing(row.field)}
                  >
                    Edit
                  </Button>
                </>
              )}
            </dd>
          </Fragment>
        ))}
        {/* `mode` (READ_ONLY_POLICY_FIELDS): only `draft` is accepted in phase 6, so it is shown, not edited. */}
        <Field label="Mode" value={playbook.mode} setBy={playbook.mode_set_by} />
        {/* Not owner-settable (`PLAYBOOK_POLICY_FIELDS` has no such field): read-only. */}
        <Field label="API-key fallback" value={playbook.api_key_fallback_json ?? "not set"} setBy={playbook.api_key_fallback_set_by} mono />
      </dl>
      <p className="chat-card-dry">{LAST_DRY_RUN_GAP}</p>
      {disabled ? (
        <p className="chat-card-meta">{TURN_ON_GAP}</p>
      ) : (
        <div className="chat-card-actions">
          <Button variant="primary" size="row" loading={busy === "/playbooks/:id/run"} disabled={heldFor("/playbooks/:id/run")} onClick={() => run("/playbooks/:id/run")}>
            Run now
          </Button>
          <Button variant="secondary" size="row" loading={busy === OFF} disabled={heldFor(OFF)} onClick={() => run(OFF)}>
            Turn off
          </Button>
        </div>
      )}
      {trigger === undefined ? null : <TriggerCard api={api} trigger={trigger} agent={agent} nested />}
      <Refusal text={refusal} />
    </section>
  );
}

export interface TriggerCardProps {
  readonly api: StudioBridge;
  readonly trigger: Trigger;
  readonly agent: string;
  /** Shown inside a playbook card. */
  readonly nested?: boolean;
}

/**
 * A trigger: its kind, schedule, next fire, text and state (on, off, or off ·
 * spent), with On and Off. A past `once` asks the owner once before it fires.
 */
export function TriggerCard({ api, trigger, agent, nested = false }: TriggerCardProps) {
  const [refusal, setRefusal] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const { busy, act } = useCardAction();
  const onRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Swapping the actions for the confirm group (and back) unmounts the focused button: say where focus goes.
  const focusAfterSwap = useRef<"on" | "cancel" | null>(null);
  useLayoutEffect(() => {
    const target = focusAfterSwap.current;
    focusAfterSwap.current = null;
    if (target === null || !focusLost()) return;
    (target === "on" ? onRef : cancelRef).current?.focus();
  }, [confirm]);
  const params = { id: trigger.id };
  const changes: ResourceName[] = ["triggers", "playbooks", `thread:${agent}`];
  const turnOn = (confirmed: boolean): void =>
    act(confirmed ? "confirm" : "on", async () => {
      const outcome = await write(api, "/triggers/:id/on", params, confirmed ? { confirm: true } : {}, changes);
      if (!outcome.ok && outcome.code === "needs_confirmation" && !confirmed) {
        setRefusal("");
        // Cancel, not Turn on and fire: a stray Enter must not fire the trigger.
        focusAfterSwap.current = "cancel";
        setConfirm(outcome.text);
        return;
      }
      if (confirmed) focusAfterSwap.current = "on";
      setConfirm(null);
      setRefusal(outcome.ok ? "" : outcome.text);
    });
  const state = triggerState(trigger);
  return (
    <section
      className={nested ? "chat-card chat-trigger nested" : "chat-card chat-trigger"}
      aria-label={`Trigger ${trigger.id}`}
      data-trigger={trigger.id}
      data-state={state}
    >
      <div className="chat-card-head">
        <span className="chat-card-title">Trigger {trigger.id}</span>
        <span className="chat-card-meta">{trigger.kind}</span>
        <span className={state === "on" ? "chat-tag on" : "chat-tag"}>{state === "spent" ? "off · spent" : state}</span>
      </div>
      <p className="chat-card-meta">
        <span data-field="Schedule">{triggerSchedule(trigger)}</span>
        {" · "}
        <span data-field="Next fire">
          {trigger.next_fire_at === null ? (
            "no next fire"
          ) : (
            <>
              next fire <time dateTime={trigger.next_fire_at}>{when(trigger.next_fire_at)}</time>
            </>
          )}
        </span>
      </p>
      <p className="chat-card-text">{trigger.text}</p>
      {confirm === null ? (
        <div className="chat-card-actions">
          <Button variant="secondary" size="row" ref={onRef} loading={busy === "on"} onClick={() => turnOn(false)}>
            On
          </Button>
          <Button
            variant="secondary"
            size="row"
            loading={busy === "off"}
            onClick={() =>
              act("off", async () => {
                const outcome = await write(api, "/triggers/:id/off", params, undefined, changes);
                setRefusal(outcome.ok ? "" : outcome.text);
              })
            }
          >
            Off
          </Button>
        </div>
      ) : (
        <div className="chat-confirm" role="group" aria-label={`Confirm turning on trigger ${trigger.id}`}>
          <p className="chat-card-text">{confirm} Turn it on anyway?</p>
          <div className="chat-card-actions">
            <Button variant="primary" size="row" loading={busy === "confirm"} onClick={() => turnOn(true)}>
              Turn on and fire
            </Button>
            <Button
              variant="ghost"
              size="row"
              ref={cancelRef}
              onClick={() => {
                focusAfterSwap.current = "on";
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <Refusal text={refusal} />
    </section>
  );
}
