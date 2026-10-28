// Team's 320px inspector (`--inspector-width`): one agent, shown and edited
// through the owner's routes (AC3-AC5).
//
// - A crew member: its role (the charter persona, unclamped), duties, and its
//   prose boundaries labelled guidance; then, visibly apart and labelled
//   enforced, the kernel-enforced permissions read from its settings file
//   (allowed tools, Bash prefixes) and its `never` list; then model, limits,
//   workspaces and the memory files as plain paths. Rename, Set a field, Off
//   and On call `POST /agents/:id/rename|set|off|on`.
// - Wright: only the `WrightSetField` fields are offered (`POST
//   /agents/wright/set`, item 07). Its permission mode and tool policy are
//   shown read-only with "edit wright.json". `GET /agents/wright` is never
//   called (the kernel refuses it `409 reserved`). Its model is the roster's
//   live read. Its effort and delegation depth read "not reported" unless set
//   this session, when the value is marked "set this session" (no route reads
//   it back), and "unknown" while the roster says wright.json does not read ok.
// - Both: a Connectors row (phase 6 item 08) with the GitHub grant (the roster's
//   `connectors`) and the connector's state (`GET /connectors`, read by the
//   screen), and Grant GitHub or Revoke through `POST /agents/:id/set`.
// - The header avatar carries the card's state (`avatar`, from the task line),
//   never a fixed one.
//
// A refusal's `error: message` is shown as text. A change reaches the card
// through the feed (`agent_*` events refetch `agents`), never a local edit.
// Every kernel string is a React text child (invariant 3).
import { type FormEvent, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import type { AgentDetailResponse, AgentSetField, RosterEntry, StudioBridge, WrightSetField } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { formatTokens } from "../../components/Card/Card";
import { SelectField, TextField } from "../../components/Input/Input";
import { setAgentField, turnAgent } from "./actions";
import { Connectors, type GrantChange, changeGithubGrant } from "./Connectors";
import {
  CLEAR_VALUE,
  CREW_SET_FIELDS,
  FIELD_LABELS,
  NO_LIMIT,
  PERMISSION_MODES,
  WRIGHT_SET_FIELDS,
  type ConnectorsState,
  acceptedSettings,
  agentSessionsText,
  charterProse,
  enforcedToolPolicy,
  githubGranted,
  isRecord,
  isWright,
  rosterModel,
  settingText,
  settingsRead,
  threadHash,
  tokensLimitWords,
  UNKNOWN,
} from "./model";

/** A crew member's `GET /agents/:id`, as the screen holds it. */
export type DetailState =
  | { readonly status: "loading" }
  | { readonly status: "ok"; readonly detail: AgentDetailResponse }
  | { readonly status: "error"; readonly message: string };

/** Wright's values the owner set this session (`AgentSetResponse.new`): no route reports its effort or delegation depth. */
export type WrightSetValues = Partial<Record<WrightSetField, string>>;

/** The avatar's state and label action, as the agent's card shows them (TeamView's `avatarFor`). */
export interface AvatarLook {
  readonly state: AvatarState;
  readonly action?: string;
}

/** The words that mark a value known only from this session's `set` answer: no route reads it back. */
export const SET_THIS_SESSION = "set this session";

export interface InspectorProps {
  readonly api: StudioBridge;
  readonly agent: RosterEntry;
  /** The header avatar's state, the same as the agent's card. */
  readonly avatar: AvatarLook;
  /** A crew member's detail; always undefined for Wright (never fetched). */
  readonly detail: DetailState | undefined;
  readonly wrightSet: WrightSetValues;
  /** `GET /connectors`, as the screen holds it: the GitHub connector's state. */
  readonly connectors: ConnectorsState;
  readonly onWrightSet: (field: WrightSetField, value: string) => void;
  /** Open the rename dialog (crew only). */
  readonly onRename: () => void;
  readonly onClose: () => void;
  /** Move focus to the Set a field control on open (the ⌘K "Set a field" command). */
  readonly focusSet?: boolean;
}

type Notice = { readonly kind: "ok" | "error"; readonly text: string } | undefined;

/** A charter section that does not parse: not read, never "None stated". */
const CHARTER_UNREAD = "Not read: the charter does not parse.";

function Section({ title, note, testId, children }: { readonly title: string; readonly note?: string; readonly testId?: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <section className="team-insp-sec" aria-labelledby={id} data-testid={testId}>
      <h3 className="team-insp-label" id={id}>
        {title}
        {note === undefined ? null : <span className="team-insp-note"> · {note}</span>}
      </h3>
      {children}
    </section>
  );
}

function List({ items, empty, mono = false, testId }: { readonly items: readonly string[]; readonly empty: string; readonly mono?: boolean; readonly testId?: string }) {
  if (items.length === 0) return <p className="team-insp-empty" data-testid={testId}>{empty}</p>;
  return (
    <ul className={mono ? "team-insp-list team-insp-mono" : "team-insp-list"} data-testid={testId}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function tokensLine(agent: RosterEntry): string {
  if (agent.tokens_per_day === null) return `${formatTokens(agent.tokens_today)} tokens today · ${tokensLimitWords(agent)}`;
  return `${formatTokens(agent.tokens_today)} of ${formatTokens(agent.tokens_per_day)} tokens today`;
}

/** The kernel-enforced block of a crew member: the settings file's tool policy and the `never` list. */
function Enforced({ detail }: { readonly detail: AgentDetailResponse }) {
  // Only a file the kernel accepted is shown as enforced: a refused one arrives as parsed content too.
  const policy = enforcedToolPolicy(acceptedSettings(detail));
  return (
    <Section title="Permissions" note="enforced by the kernel" testId="team-enforced">
      {detail.settings.error !== null || policy === null ? (
        <p className="team-insp-error" data-testid="team-settings-unreadable">
          settings file unreadable{detail.settings.error === null ? "" : `: ${detail.settings.error.message}`}
        </p>
      ) : (
        <>
          <div className="team-insp-sub" data-testid="team-enforced-tools">
            <span className="team-insp-subhead">
              Allowed tools <Badge tone="accent">enforced</Badge>
            </span>
            <List items={policy.allowedTools} empty="None" mono />
          </div>
          <div className="team-insp-sub" data-testid="team-enforced-bash">
            <span className="team-insp-subhead">
              Bash prefixes <Badge tone="accent">enforced</Badge>
            </span>
            <List items={policy.allowedBashPrefixes} empty="None" mono />
          </div>
        </>
      )}
      <div className="team-insp-sub" data-testid="team-enforced-never">
        <span className="team-insp-subhead">
          Never <Badge tone="accent">enforced</Badge>
        </span>
        {detail.never === null ? (
          <p className="team-insp-empty">Not read: the settings file does not read ok.</p>
        ) : (
          <List items={detail.never} empty="Nothing extra" mono />
        )}
      </div>
    </Section>
  );
}

/** The Set a field form: a field, a value, and Set. Wright's offer is `WRIGHT_SET_FIELDS` only. */
function SetField({
  fields,
  busy,
  onSet,
  selectRef,
}: {
  readonly fields: readonly AgentSetField[];
  readonly busy: boolean;
  readonly onSet: (field: AgentSetField, value: string) => Promise<boolean>;
  readonly selectRef: RefObject<HTMLSelectElement | null>;
}) {
  const [field, setField] = useState<AgentSetField>(fields[0] ?? "model");
  const [value, setValue] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (await onSet(field, value)) setValue("");
  };
  const clears = field !== "model" && field !== "permission_mode";
  return (
    <form className="team-insp-set" onSubmit={(e) => void submit(e)} aria-label="Set a field">
      <SelectField
        ref={selectRef}
        label="Field"
        value={field}
        onChange={(e) => {
          setField(e.target.value as AgentSetField);
          setValue("");
        }}
        data-testid="team-set-field"
      >
        {fields.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABELS[f]}
          </option>
        ))}
      </SelectField>
      {field === "permission_mode" ? (
        <SelectField label="Value" value={value} onChange={(e) => setValue(e.target.value)} data-testid="team-set-value">
          <option value="">Pick a mode</option>
          {PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>
      ) : (
        <TextField
          label="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          hint={clears ? `${CLEAR_VALUE} clears it` : undefined}
          data-testid="team-set-value"
        />
      )}
      <Button type="submit" size="row" variant="secondary" loading={busy}>
        Set
      </Button>
    </form>
  );
}

export function Inspector({ api, agent, avatar, detail, wrightSet, connectors, onWrightSet, onRename, onClose, focusSet = false }: InspectorProps) {
  const lead = isWright(agent);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(undefined);

  // On open, focus moves into the inspector: its Set a field control when a command asked for it, else its heading.
  useEffect(() => {
    if (focusSet) selectRef.current?.focus();
    else headingRef.current?.focus();
  }, [focusSet]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  const onSet = async (field: AgentSetField, value: string): Promise<boolean> => {
    setBusy(true);
    setNotice(undefined);
    try {
      const outcome = await setAgentField(api, agent.id, field, value);
      if (!outcome.ok) {
        setNotice({ kind: "error", text: outcome.message });
        return false;
      }
      const shown = outcome.body.new === null ? "cleared" : `set to ${String(outcome.body.new)}`;
      setNotice({ kind: "ok", text: outcome.body.changed ? `${FIELD_LABELS[field]} ${shown}.` : `${FIELD_LABELS[field]} was already ${outcome.body.new === null ? "unset" : String(outcome.body.new)}.` });
      if (lead) onWrightSet(field as WrightSetField, outcome.body.new === null ? CLEAR_VALUE : String(outcome.body.new));
      return true;
    } finally {
      setBusy(false);
    }
  };

  const onTurn = async (to: "on" | "off") => {
    setBusy(true);
    setNotice(undefined);
    try {
      const outcome = await turnAgent(api, agent.id, to);
      if (!outcome.ok) setNotice({ kind: "error", text: outcome.message });
      else setNotice({ kind: "ok", text: outcome.body.changed ? `Turned ${to}.` : `Already ${to}.` });
    } finally {
      setBusy(false);
    }
  };

  // A grant or revoke posts the owner's route; the row changes only when the feed's `agent_*` event refetches the roster.
  const onGrant = async (change: GrantChange) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const outcome = await changeGithubGrant(api, agent, change);
      setNotice({ kind: outcome.ok ? "ok" : "error", text: outcome.text });
    } finally {
      setBusy(false);
    }
  };

  const ok = detail?.status === "ok" ? detail.detail : undefined;
  const prose = ok === undefined ? undefined : charterProse(ok);
  // A charter list that does not parse is null: shown as not read, never as "None stated".
  const duties = prose?.duties ?? null;
  const boundaries = prose?.boundaries ?? null;
  // A setting reads "unknown" unless the detail answered and the kernel accepted its settings file:
  // loading, a refused detail and a file the kernel refused (even one that parses) never read as a
  // value, "no limit" or "not set". The model falls back to the roster's own read of the same file,
  // which says itself whether it read ok.
  const content = ok === undefined ? undefined : acceptedSettings(ok);
  const value = (field: AgentSetField, absent: string): string => settingText(content, field, absent);
  const model = isRecord(content) ? value("model", "not set") : rosterModel(agent);
  // Wright's effort and delegation depth: no route reports them, so a value is shown only as this
  // session's set answer, marked so, and only while the roster says wright.json reads ok.
  const wrightValue = (field: WrightSetField): string => {
    if (!settingsRead(agent)) return UNKNOWN;
    const set = wrightSet[field];
    return set === undefined ? "not reported" : `${set} · ${SET_THIS_SESSION}`;
  };

  return (
    <aside className="team-insp" aria-labelledby={headingId} data-testid="team-inspector" onKeyDown={onKeyDown}>
      <div className="team-insp-head">
        <Avatar agent={{ id: agent.id, name: agent.display_name, shape: agent.avatar.shape, hue: agent.avatar.hue }} state={avatar.state} size={36} action={avatar.action} />
        <div className="team-insp-title">
          <h2 className="team-insp-name" id={headingId} ref={headingRef} tabIndex={-1}>
            {agent.display_name}
          </h2>
          <div className="team-insp-kind">{lead ? "Lead agent" : `Crew member · ${agent.status}`}</div>
        </div>
        {lead ? null : (
          <Button size="row" variant="ghost" onClick={onRename}>
            Rename
          </Button>
        )}
        <Button size="row" variant="ghost" onClick={onClose} aria-label="Close inspector">
          ×
        </Button>
      </div>

      {notice === undefined ? null : (
        <p className={notice.kind === "error" ? "team-insp-error" : "team-insp-ok"} role={notice.kind === "error" ? "alert" : "status"} data-testid="team-insp-notice">
          {notice.text}
        </p>
      )}

      {lead ? null : detail === undefined || detail.status === "loading" ? (
        <p className="team-insp-empty" role="status">
          Loading {agent.display_name}…
        </p>
      ) : detail.status === "error" ? (
        <p className="team-insp-error" role="alert" data-testid="team-detail-error">
          {detail.message}
        </p>
      ) : (
        <>
          <Section title="Role">
            <p className="team-insp-prose" data-testid="team-insp-role">
              {prose?.persona ?? "The charter does not parse."}
            </p>
          </Section>
          <Section title="Duties">
            {duties === null ? <p className="team-insp-empty">{CHARTER_UNREAD}</p> : <List items={duties} empty="None stated" />}
          </Section>
          <Section title="Boundaries" note="guidance, not enforced" testId="team-guidance">
            {boundaries === null ? (
              <p className="team-insp-empty">{CHARTER_UNREAD}</p>
            ) : (
              <List items={boundaries} empty="None stated. The kernel's fixed rails still apply." />
            )}
          </Section>
          {ok === undefined ? null : <Enforced detail={ok} />}
        </>
      )}

      <Section title="Model and limits" testId="team-insp-limits">
        <dl className="team-insp-kv">
          <dt>Model</dt>
          <dd>{lead ? rosterModel(agent) : model}</dd>
          <dt>Effort</dt>
          <dd>{lead ? wrightValue("effort") : value("effort", "not set")}</dd>
          <dt>Today</dt>
          <dd className="team-tabular">{tokensLine(agent)}</dd>
          <dt>Sessions</dt>
          <dd className="team-tabular">{agentSessionsText(agent)}</dd>
          <dt>Delegation</dt>
          <dd>{lead ? wrightValue("limits.delegation_depth") : value("limits.delegation_depth", NO_LIMIT)}</dd>
          <dt>Permission</dt>
          <dd>{lead ? <span data-testid="team-wright-readonly">read-only · edit <code className="team-code">wright.json</code></span> : value("permission_mode", "not set")}</dd>
          {lead ? (
            <>
              <dt>Tool policy</dt>
              <dd>
                read-only · edit <code className="team-code">wright.json</code>
              </dd>
            </>
          ) : null}
        </dl>
        {agent.settings_error === null ? null : <p className="team-insp-error">Settings: {agent.settings_error}</p>}
        <SetField fields={lead ? WRIGHT_SET_FIELDS : CREW_SET_FIELDS} busy={busy} onSet={onSet} selectRef={selectRef} />
      </Section>

      <Section title="Connectors" note="granted per agent" testId="team-insp-connectors">
        <Connectors granted={githubGranted(agent)} state={connectors} busy={busy} onChange={(change) => void onGrant(change)} />
      </Section>

      {ok === undefined ? null : (
        <>
          <Section title="Workspaces">
            {ok.workspaces === null ? <p className="team-insp-empty">Not read: the settings file does not read ok.</p> : <List items={ok.workspaces} empty="None" mono />}
          </Section>
          <Section title="Memory" note="plain files" testId="team-insp-memory">
            <ul className="team-insp-list team-insp-mono">
              <li>{ok.settings.file}</li>
              {ok.memory.files.map((f) => (
                <li key={f.path}>
                  {f.path}
                  {f.present ? null : <span className="team-insp-note"> (missing)</span>}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      <div className="team-insp-actions">
        <a className="btn team-link" data-variant="secondary" data-size="row" href={threadHash(agent.id)}>
          <span className="btn-label">Open thread</span>
        </a>
        {lead ? null : agent.status === "off" ? (
          <Button size="row" variant="secondary" loading={busy} onClick={() => void onTurn("on")}>
            Turn on
          </Button>
        ) : agent.status === "active" ? (
          <Button size="row" variant="ghost" loading={busy} onClick={() => void onTurn("off")}>
            Turn off
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
