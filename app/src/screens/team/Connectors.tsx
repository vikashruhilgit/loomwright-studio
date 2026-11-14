// The inspector's Connectors row (phase 6 item 08): whether the owner granted
// this agent GitHub, the connector's own state, and the buttons that change the
// grant. The grant is `connectors` on the agent's settings file; the connector's
// state is `GET /connectors`, read by the screen. All come in as props.
//
// A crew member's grant is None, Read or Write (phase 8 item 20): `githubLevel`
// reads it from the member's `GET /agents/:id` `settings.content.connectors`
// (the roster reports only that GitHub is held, never the level), and the row
// offers the other two levels in place. Write adds one line saying what it lets
// the member's live playbooks do. Wright has no detail route, so its row stays
// the roster's `granted` / `not granted` / `grant unknown` with one Grant GitHub
// (read) or Revoke button.
//
// Every button and ⌘K command calls the same `changeGithubGrant`, which posts
// `{field: "connectors", value}` to `POST /agents/:id/set` with `github:none`,
// `github` or `github:write` (never `none`, which would also drop the member's
// Jira and ClickUp tools). Nothing here edits the row: it changes only when the
// feed's `agent_*` event refetches the roster and the detail, as with every
// other Team write. The grant is allowed while GitHub is not connected (the
// kernel never reads the connector to decide it), which is why the state is
// shown beside it. Every string is a React text child.
//
// Beside the GitHub row, one row per connected MCP kind (Jira, ClickUp; phase 8,
// D38) shows which of that kind's `granted_tools` the agent holds, read from the
// agent's `GET /agents/:id` `settings.content.connectors[<kind>]`. The grant is
// offered as a short list of capabilities in words (`CapabilityList`, phase 8 item
// 21b: "Read tickets", "Comment on tickets", …), each granted, not granted or
// partly granted (n of m), with its raw tool names one expand away. Ticking one
// calls `changeCapabilityGrant`, which builds the kind's whole next tool set (what
// the member holds plus the capability's tools, or minus them on an untick) and
// posts it through `changeMcpGrant` as `<kind>:<tool>[,<tool>…]` (or `<kind>:none`)
// to the same route. A listed tool no capability names is shown as "Other tools",
// by name, and no capability tick ever grants it. When the connection answers no
// `capabilities` (an older kernel, or its list could not be read) the row keeps the
// raw per-tool checkboxes it always had, with a line saying the plain list is
// unavailable. Nothing is ticked or granted by default (invariant 1). Wright has no
// detail route, so its per-tool grant is unknown (no checkboxes), never "not
// granted". As with GitHub, the row changes only when the feed's `agent_*` event
// refetches the detail.
import { useEffect, useRef } from "react";
import type { McpCapability, McpConnection, McpConnectionKind, RosterEntry, StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { type GithubGrantValue, setAgentConnectors, setAgentMcpTools } from "./actions";
import { type ConnectorsState, connectorStateText, githubGranted, isRecord, MCP_KIND_LABELS, mcpToolsHeld } from "./model";

/** The GitHub level the owner can give an agent: none, read (`github`), or write (`github:write`). */
export type GithubLevel = "none" | "read" | "write";

/** The value each level posts: `github:none` drops only the GitHub key, so the member's MCP tools are kept. */
const GITHUB_GRANT_VALUES: Readonly<Record<GithubLevel, GithubGrantValue>> = { none: "github:none", read: "github", write: "github:write" };

/** The levels in the order the row offers them. */
export const GITHUB_LEVELS: readonly GithubLevel[] = ["none", "read", "write"];

/** The level words in the crew member's row and its buttons. */
export const LEVEL_WORDS: Readonly<Record<GithubLevel, string>> = { none: "None", read: "Read", write: "Write" };

/** The line under a Write grant: what Write lets the member's live playbooks do. */
export const WRITE_LINE = "Write lets this member's live playbooks push and comment on GitHub, each through the approval gate.";

/** The result of one grant or revoke, in words: the owner's route answered, or refused. */
export interface GrantOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** The grant words in the row: unknown when the roster did not report the agent's `connectors`. */
export const GRANT_WORDS = { granted: "granted", notGranted: "not granted", unknown: "grant unknown" } as const;

/**
 * A crew member's GitHub level from its settings file `content` (`GET /agents/:id`
 * `settings.content`, untrusted file text): absent, null or `[]` is none; `["github"]`
 * or `{github: "read"}` is read; `{github: "write"}` is write (an object without a
 * `github` key holds only MCP tools: none). Undefined (unknown, never none) when the
 * roster's own grant is unknown (checked first: its `connectors` is null or missing,
 * so the settings file did not read ok), the content was not read or is not an
 * object, or `connectors` is a shape the kernel does not write.
 */
export function githubLevel(content: unknown, agent: Pick<RosterEntry, "connectors">): GithubLevel | undefined {
  if (githubGranted(agent) === undefined) return undefined;
  if (!isRecord(content)) return undefined;
  const grant = content.connectors;
  if (grant === undefined || grant === null) return "none";
  if (Array.isArray(grant)) {
    if (grant.length === 0) return "none";
    return grant.length === 1 && grant[0] === "github" ? "read" : undefined;
  }
  if (!isRecord(grant)) return undefined;
  const level = grant.github;
  if (level === undefined) return "none";
  return level === "read" || level === "write" ? level : undefined;
}

/**
 * Set `agent`'s GitHub level through `POST /agents/:id/set`. The one call every
 * Connectors button and ⌘K command makes: `github:none`, `github` or `github:write`,
 * each changing only the GitHub key.
 */
export async function changeGithubGrant(api: StudioBridge, agent: { readonly id: string; readonly display_name: string }, level: GithubLevel): Promise<GrantOutcome> {
  const outcome = await setAgentConnectors(api, agent.id, GITHUB_GRANT_VALUES[level]);
  if (!outcome.ok) return { ok: false, text: outcome.message };
  const name = agent.display_name;
  const changed = outcome.body.changed;
  if (level === "none") return { ok: true, text: changed ? `GitHub revoked from ${name}.` : `${name} already has no GitHub.` };
  if (level === "write") return { ok: true, text: changed ? `GitHub write granted to ${name}.` : `${name} already has GitHub write.` };
  return { ok: true, text: changed ? `GitHub granted to ${name}.` : `${name} already has GitHub.` };
}

/** What a capability tick or untick changed, for the result line: the capability's words and which way. */
export interface CapabilityChange {
  readonly label: string;
  readonly on: boolean;
}

/**
 * Replace one MCP kind's tool grant for `agent` through `POST /agents/:id/set`
 * (`<kind>:<tool>[,<tool>…]`, or `<kind>:none` for no tools). The one call every
 * tool checkbox and capability tick makes. A tool name holding a comma is refused
 * here, unsent: the kernel splits the value on commas, so it would grant two other
 * tools. A `capability` makes the result line name it instead of counting tools.
 */
export async function changeMcpGrant(
  api: StudioBridge,
  agent: { readonly id: string; readonly display_name: string },
  kind: McpConnectionKind,
  tools: readonly string[],
  capability?: CapabilityChange,
): Promise<GrantOutcome> {
  const label = MCP_KIND_LABELS[kind];
  if (tools.some((tool) => tool.includes(","))) return { ok: false, text: `A ${label} tool name holds a comma, which a grant cannot carry. Nothing was changed.` };
  const outcome = await setAgentMcpTools(api, agent.id, kind, tools);
  if (!outcome.ok) return { ok: false, text: outcome.message };
  if (!outcome.body.changed) return { ok: true, text: `${agent.display_name}'s ${label} tools were already as set.` };
  if (capability !== undefined) return { ok: true, text: `${label}: ${capability.label} ${capability.on ? "granted to" : "revoked from"} ${agent.display_name}.` };
  if (tools.length === 0) return { ok: true, text: `${label} tools revoked from ${agent.display_name}.` };
  return { ok: true, text: `${label}: ${tools.length} ${tools.length === 1 ? "tool" : "tools"} granted to ${agent.display_name}.` };
}

/**
 * Tick (`on`) or untick one capability for `agent`: the kind's next whole tool set is
 * what the member `held` plus the capability's tools (or minus them), so every other
 * tool it holds, a capability's or an other tool, is kept. Posted through
 * `changeMcpGrant`, never a second POST shape. `held` undefined (the grant is
 * unknown) changes nothing and says so.
 */
export async function changeCapabilityGrant(
  api: StudioBridge,
  agent: { readonly id: string; readonly display_name: string },
  kind: McpConnectionKind,
  capability: McpCapability,
  held: readonly string[] | undefined,
  on: boolean,
): Promise<GrantOutcome> {
  if (held === undefined) return { ok: false, text: `${agent.display_name}'s ${MCP_KIND_LABELS[kind]} grant is unknown. Nothing was changed.` };
  const next = on ? [...held, ...capability.tools.filter((tool) => !held.includes(tool))] : held.filter((tool) => !capability.tools.includes(tool));
  return changeMcpGrant(api, agent, kind, next, { label: capability.label, on });
}

/** One connected MCP kind in the row: the tools it lists and the ones the agent holds (undefined: unknown). */
export interface McpGrantRow {
  readonly kind: McpConnectionKind;
  /** The tools to show: the connection's `granted_tools`, then any held tool it no longer lists. */
  readonly tools: readonly string[];
  readonly held: readonly string[] | undefined;
  /** The connection's capabilities in words (`GET /connectors`); null when it answered none (an older kernel, or the list could not be built). */
  readonly capabilities: readonly McpCapability[] | null;
  /** The listed tools no capability names; null with `capabilities`. */
  readonly otherTools: readonly string[] | null;
}

/** A connected (or expiring) MCP row is one the agent can be granted tools of. */
function isConnectedMcp(row: McpConnection): boolean {
  return row.status === "connected" || row.status === "expiring";
}

/**
 * The row's MCP kinds from `GET /connectors`: one per connected `mcp_connections`
 * row, in the response's order. `settingsContent` is the agent's settings file
 * content, undefined when it was not read (Wright, loading, a refused detail).
 * A missing `mcp_connections` reads as none; a failed read shows no MCP row.
 */
export function mcpGrantRows(state: ConnectorsState, settingsContent: unknown): readonly McpGrantRow[] {
  if (state.status !== "ok") return [];
  return (state.connectors.mcp_connections ?? []).filter(isConnectedMcp).map((row) => {
    const held = settingsContent === undefined ? undefined : mcpToolsHeld(settingsContent, row.kind);
    const listed = row.granted_tools;
    const capabilities = row.capabilities ?? null;
    return {
      kind: row.kind,
      tools: [...listed, ...(held ?? []).filter((tool) => !listed.includes(tool))],
      held,
      capabilities,
      otherTools: capabilities === null ? null : (row.other_tools ?? []),
    };
  });
}

/** The words after an MCP kind's name: the count held, or unknown. */
function mcpGrantWords(row: McpGrantRow): string {
  if (row.held === undefined) return GRANT_WORDS.unknown;
  if (row.held.length === 0) return "no tools granted";
  return `${row.held.length} of ${row.tools.length} ${row.tools.length === 1 ? "tool" : "tools"} granted`;
}

export interface ConnectorsProps {
  /** Wright's row: the roster's read of the grant: true, false, or undefined when unknown. */
  readonly granted: boolean | undefined;
  /** Wright: the roster-based Grant GitHub / Revoke row. A crew member gets the three-level row. */
  readonly lead: boolean;
  /** A crew member's level (`githubLevel`); undefined is unknown, and ignored for Wright. */
  readonly level?: GithubLevel | undefined;
  /** `GET /connectors`, as the screen holds it. */
  readonly state: ConnectorsState;
  readonly busy: boolean;
  /** The level the owner chose. */
  readonly onChange: (level: GithubLevel) => void;
  /** The connected MCP kinds and what the agent holds of each (`mcpGrantRows`); none by default. */
  readonly mcp?: readonly McpGrantRow[];
  /** The agent's full tool set for one kind after the owner ticked or cleared a tool (a row with no capabilities). */
  readonly onMcpChange?: (kind: McpConnectionKind, tools: readonly string[]) => void;
  /** The owner ticked (`on`) or unticked one capability of a kind; the screen posts it through `changeCapabilityGrant`. */
  readonly onCapabilityChange?: (kind: McpConnectionKind, capability: McpCapability, on: boolean) => void;
}

/** How much of one capability a member holds: all its listed tools, some of them, or none. */
export interface CapabilityState {
  readonly status: "granted" | "partly" | "none";
  readonly held: number;
  readonly of: number;
  /** "granted", "not granted" or "partly granted (n of m)". */
  readonly words: string;
}

/** `capability`'s state for a member holding `held`, counted against the tools the connection lists for it. */
export function capabilityState(capability: McpCapability, held: readonly string[]): CapabilityState {
  const of = capability.tools.length;
  const count = capability.tools.filter((tool) => held.includes(tool)).length;
  if (count === of && of > 0) return { status: "granted", held: count, of, words: GRANT_WORDS.granted };
  if (count === 0) return { status: "none", held: 0, of, words: GRANT_WORDS.notGranted };
  return { status: "partly", held: count, of, words: `partly ${GRANT_WORDS.granted} (${count} of ${of})` };
}

/** A capability's checkbox: a partly held one is indeterminate, and ticking it grants the rest. */
function CapabilityBox({ label, state, disabled, onToggle }: { readonly label: string; readonly state: CapabilityState; readonly disabled: boolean; readonly onToggle: (on: boolean) => void }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = state.status === "partly";
  }, [state.status]);
  return (
    <label>
      <input ref={box} type="checkbox" checked={state.status === "granted"} disabled={disabled} onChange={(event) => onToggle(event.target.checked)} /> {label}
    </label>
  );
}

export interface CapabilityListProps {
  readonly kind: McpConnectionKind;
  /** The connection's capabilities, each with only the tools it lists. */
  readonly capabilities: readonly McpCapability[];
  /** The listed tools no capability names: shown by name, never granted by a tick. */
  readonly otherTools: readonly string[];
  /** The tools the member holds of this kind; a card that has not created the member yet passes what the owner ticked. */
  readonly held: readonly string[];
  readonly disabled?: boolean;
  /** The owner ticked (`on`) or unticked one capability. Absent: the boxes are read-only. */
  readonly onToggle?: (capability: McpCapability, on: boolean) => void;
  /** Prefix of the list's test ids; default `team-connector-mcp-<kind>-capabilities`. */
  readonly testId?: string;
}

/** The folded "Other tools" line, in words: how many, that a tick never grants them, and how many are held. */
export function otherToolsSummary(count: number, granted: number): string {
  const what = `${count} other ${count === 1 ? "tool" : "tools"}`;
  return `${what} · no capability covers ${count === 1 ? "it" : "these"}, so a tick never grants ${count === 1 ? "it" : "them"}${granted > 0 ? ` · ${granted} granted` : ""}`;
}

/**
 * A tracker grant as a short list of capabilities in words (phase 8 item 21b): each
 * granted, not granted or partly granted (n of m), a "changes things" mark on one that
 * writes, deletes or posts, and its raw tool names one expand away as the enforced
 * detail. Then "Other tools": the listed tools no capability names (plus any held tool
 * the connection no longer lists), by name, never hidden and never ticked, folded under
 * a line in words (`otherToolsSummary`) like every other raw name. Controlled
 * and pure of any route: the Team row posts a tick through `changeCapabilityGrant`; the
 * held card keeps the ticks until its approve. Every kernel string is a text child.
 */
export function CapabilityList({ kind, capabilities, otherTools, held, disabled = false, onToggle, testId = `team-connector-mcp-${kind}-capabilities` }: CapabilityListProps) {
  const label = MCP_KIND_LABELS[kind];
  const named = new Set([...capabilities.flatMap((c) => c.tools), ...otherTools]);
  const others = [...otherTools, ...held.filter((tool) => !named.has(tool))];
  return (
    <div className="team-insp-sub" data-testid={testId}>
      <ul className="team-insp-list team-cap-list" aria-label={`${label} capabilities`}>
        {capabilities.map((capability) => {
          const state = capabilityState(capability, held);
          return (
            <li key={capability.id} className="team-cap" data-testid={`${testId}-${capability.id}`}>
              <div className="team-cap-head">
                <CapabilityBox label={capability.label} state={state} disabled={disabled || onToggle === undefined} onToggle={(on) => onToggle?.(capability, on)} />
                <span className="team-cap-state" data-status={state.status} data-testid={`${testId}-${capability.id}-state`}>
                  {state.words}
                </span>
                {capability.changes ? (
                  <span className="team-cap-changes" data-testid={`${testId}-${capability.id}-changes`}>
                    changes things
                  </span>
                ) : null}
              </div>
              <details className="team-cap-names">
                <summary>Tool names</summary>
                <ul className="team-insp-list team-insp-mono" aria-label={`${capability.label} tool names`} data-testid={`${testId}-${capability.id}-tools`}>
                  {capability.tools.map((tool) => (
                    <li key={tool}>{tool}</li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      {others.length === 0 ? null : (
        // Listed by name and never hidden (AC10), but folded like every other raw name, so the owner reads only words
        // until they open it: a live ClickUp server lists 21 tools no capability covers (21b Validation 2, step 2).
        <details className="team-cap-other" data-testid={`${testId}-other`}>
          <summary className="team-insp-subhead" data-testid={`${testId}-other-summary`}>
            {otherToolsSummary(others.length, others.filter((tool) => held.includes(tool)).length)}
          </summary>
          <ul className="team-insp-list team-insp-mono" aria-label={`${label} other tools`}>
            {others.map((tool) => (
              <li key={tool}>
                {tool}
                {held.includes(tool) ? <span className="team-insp-note"> (granted)</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function McpRow({ row, busy, onMcpChange, onCapabilityChange }: { readonly row: McpGrantRow; readonly busy: boolean; readonly onMcpChange?: ConnectorsProps["onMcpChange"]; readonly onCapabilityChange?: ConnectorsProps["onCapabilityChange"] }) {
  const held = row.held;
  const label = MCP_KIND_LABELS[row.kind];
  // The next set keeps the listed order, so the posted value is stable however the owner ticks.
  const toggle = (tool: string, on: boolean) => {
    if (held === undefined) return;
    onMcpChange?.(row.kind, row.tools.filter((t) => (t === tool ? on : held.includes(t))));
  };
  return (
    <>
      <dl className="team-insp-kv" data-testid={`team-connector-mcp-${row.kind}`}>
        <dt>{label}</dt>
        <dd data-testid={`team-connector-mcp-${row.kind}-grant`}>{mcpGrantWords(row)}</dd>
      </dl>
      {held === undefined || row.tools.length === 0 ? null : row.capabilities !== null ? (
        <CapabilityList
          kind={row.kind}
          capabilities={row.capabilities}
          otherTools={row.otherTools ?? []}
          held={held}
          disabled={busy}
          onToggle={onCapabilityChange === undefined ? undefined : (capability, on) => onCapabilityChange(row.kind, capability, on)}
        />
      ) : (
        <>
          <p className="team-insp-empty" data-testid={`team-connector-mcp-${row.kind}-plain-unavailable`}>
            The plain list of what {label} can do is unavailable, so its raw tool names are shown.
          </p>
          <ul className="team-insp-list team-insp-mono" aria-label={`${label} tools`} data-testid={`team-connector-mcp-${row.kind}-tools`}>
            {row.tools.map((tool) => (
              <li key={tool}>
                <label>
                  <input type="checkbox" checked={held.includes(tool)} disabled={busy || onMcpChange === undefined} onChange={(event) => toggle(tool, event.target.checked)} /> {tool}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** A crew member's GitHub row: its level (or unknown), the other two levels as buttons, and the Write line at Write. */
function CrewGrant({ level, state, busy, onChange }: { readonly level: GithubLevel | undefined; readonly state: ConnectorsState; readonly busy: boolean; readonly onChange: ConnectorsProps["onChange"] }) {
  // The button the owner just used is the one that unmounts when the feed's refetch changes the level (only the other
  // two levels render), which would drop a keyboard user's focus to the body. A browser fires no blur when a focused
  // node is removed, so `inGroup` still says focus was here at the swap, and focus moves to the group instead.
  const group = useRef<HTMLDivElement>(null);
  const inGroup = useRef(false);
  const shown = useRef(level);
  useEffect(() => {
    const changed = shown.current !== level;
    shown.current = level;
    if (!changed || !inGroup.current) return;
    const active = document.activeElement;
    if (group.current !== null && (active === null || active === document.body)) group.current.focus();
  }, [level]);
  return (
    <>
      <dl className="team-insp-kv" data-testid="team-connector-github">
        <dt>GitHub</dt>
        <dd>
          <span data-testid="team-connector-grant">{level === undefined ? GRANT_WORDS.unknown : LEVEL_WORDS[level]}</span>
          {" · "}
          <span data-testid="team-connector-state">{connectorStateText(state)}</span>
        </dd>
      </dl>
      {level === "write" ? (
        <p className="team-insp-empty" data-testid="team-connector-write-line">
          {WRITE_LINE}
        </p>
      ) : null}
      {level === undefined ? null : (
        <div className="team-insp-subhead" role="group" aria-label="Change the GitHub grant" tabIndex={-1} ref={group} onFocus={() => { inGroup.current = true; }} onBlur={() => { inGroup.current = false; }} data-testid="team-connector-levels">
          {GITHUB_LEVELS.filter((other) => other !== level).map((other) => (
            <Button key={other} size="row" variant={other === "none" ? "ghost" : "secondary"} loading={busy} data-testid={`team-connector-level-${other}`} onClick={() => onChange(other)}>
              {LEVEL_WORDS[other]}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}

export function Connectors({ granted, lead, level, state, busy, onChange, mcp = [], onMcpChange, onCapabilityChange }: ConnectorsProps) {
  const grantWords = granted === undefined ? GRANT_WORDS.unknown : granted ? GRANT_WORDS.granted : GRANT_WORDS.notGranted;
  const mcpRows = mcp.map((row) => <McpRow key={row.kind} row={row} busy={busy} onMcpChange={onMcpChange} onCapabilityChange={onCapabilityChange} />);
  if (!lead) {
    return (
      <>
        <CrewGrant level={level} state={state} busy={busy} onChange={onChange} />
        {mcpRows}
      </>
    );
  }
  return (
    <>
      <dl className="team-insp-kv" data-testid="team-connector-github">
        <dt>GitHub</dt>
        <dd>
          <span data-testid="team-connector-grant">{grantWords}</span>
          {" · "}
          <span data-testid="team-connector-state">{connectorStateText(state)}</span>
        </dd>
      </dl>
      {granted === undefined ? null : granted ? (
        <Button className="team-insp-conn-action" size="row" variant="ghost" loading={busy} onClick={() => onChange("none")}>
          Revoke
        </Button>
      ) : (
        <Button className="team-insp-conn-action" size="row" variant="secondary" loading={busy} onClick={() => onChange("read")}>
          Grant GitHub
        </Button>
      )}
      {mcpRows}
    </>
  );
}
