// The thread's actionable cards: a pending approval (EventCard's approval
// variant), the charter card (a `kernel_agent_create` approval), the
// playbook card and the trigger card. Each action is one contract write
// through the bridge; a refusal shows the kernel's words as text and leaves
// the card in place. Every kernel string is a React text child only.
import { useLayoutEffect, useRef, useState } from "react";
import type { Approval, PlaybookListing, StudioBridge, Trigger } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { EventCard } from "../../components/EventCard/EventCard";
import { SelectField, TextField } from "../../components/Input/Input";
import type { ResourceName } from "../../store/resources";
import { focusLost, inFlightGuard, navigate, triggerSchedule, triggerState, when, write } from "./model";

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
}

/** A pending approval, inline at the end of the thread. */
export function ApprovalCard({ api, approval, agent }: ApprovalCardProps) {
  const [refusal, setRefusal] = useState("");
  // EventCard's approval buttons take no `loading`, so the guard only drops repeats here.
  const { act } = useCardAction();
  const changes = approvalChanges(agent);
  const params = { id: approval.id };
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
          reason: approval.playbook?.slug ? `From playbook ${approval.playbook.slug}` : "Not from a playbook",
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

/** "proposed" when Wright set a value, "set by owner" when the owner did, nothing otherwise. */
export function provenance(setBy: string | null): string {
  if (setBy === "wright") return "proposed";
  if (setBy === "owner") return "set by owner";
  return "";
}

function Field({ label, value, setBy, mono = false }: { readonly label: string; readonly value: string; readonly setBy?: string | null; readonly mono?: boolean }) {
  const tag = setBy === undefined ? "" : provenance(setBy);
  return (
    <>
      <dt>{label}</dt>
      <dd data-field={label}>
        <span className={mono ? "chat-mono" : undefined}>{value}</span>
        {tag === "" ? null : <span className={tag === "proposed" ? "chat-tag proposed" : "chat-tag owner"}>{tag}</span>}
      </dd>
    </>
  );
}

/** The policy fields the card's Set form offers (the kernel's own names). */
export const SET_FIELDS = ["dedupe_key", "priority", "model", "token_limit"] as const;
type SetField = (typeof SET_FIELDS)[number];

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

/** A playbook named by a `playbook_created` / `playbook_updated` card: its policy, each value's provenance, and its actions. No Enable: enabling stays an approval. */
export function PlaybookCard({ api, playbookId, playbook, trigger, agent }: PlaybookCardProps) {
  const [refusal, setRefusal] = useState("");
  const [field, setField] = useState<SetField>("priority");
  const [value, setValue] = useState("high");
  const { busy, act } = useCardAction();
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
      const outcome = await write(api, path, params, body, changes);
      setRefusal(outcome.ok ? "" : outcome.text);
    });
  return (
    <section className="chat-card chat-playbook" aria-label={`Playbook ${playbook.slug}`} data-playbook={playbook.id}>
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
        <Field label="Dedupe key" value={playbook.dedupe_key_spec ?? "none"} setBy={playbook.dedupe_key_set_by} mono />
        <Field label="Priority" value={playbook.priority} setBy={playbook.priority_set_by} />
        <Field label="Model" value={playbook.model ?? "default"} setBy={playbook.model_set_by} />
        <Field
          label="Token limit per day"
          value={playbook.token_limit_per_day === null ? "none" : String(playbook.token_limit_per_day)}
          setBy={playbook.token_limit_set_by}
        />
        <Field label="API-key fallback" value={playbook.api_key_fallback_json ?? "none"} setBy={playbook.api_key_fallback_set_by} mono />
      </dl>
      <p className="chat-card-dry">{LAST_DRY_RUN_GAP}</p>
      <div className="chat-card-actions">
        <Button variant="primary" size="row" loading={busy === "/playbooks/:id/run"} onClick={() => run("/playbooks/:id/run")}>
          Run now
        </Button>
        <Button variant="secondary" size="row" loading={busy === "/playbooks/:id/off"} onClick={() => run("/playbooks/:id/off")}>
          Turn off
        </Button>
      </div>
      <form
        className="chat-set"
        aria-label={`Set a field of ${playbook.slug}`}
        onSubmit={(event) => {
          event.preventDefault();
          // Enter in the Value field submits too, so the guard sits here, not only on the button.
          run("/playbooks/:id/set", { field, value });
        }}
      >
        <SelectField
          label="Field"
          value={field}
          onChange={(event) => {
            const next = event.target.value as SetField;
            setField(next);
            setValue(next === "priority" ? "high" : "");
          }}
        >
          {SET_FIELDS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </SelectField>
        {field === "priority" ? (
          <SelectField label="Value" value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </SelectField>
        ) : (
          <TextField label="Value" value={value} onChange={(event) => setValue(event.target.value)} hint="none clears it" />
        )}
        <Button variant="secondary" size="row" type="submit" loading={busy === "/playbooks/:id/set"}>
          Set {field}
        </Button>
      </form>
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
