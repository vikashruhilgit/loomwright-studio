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
// agent's `GET /agents/:id` `settings.content.connectors[<kind>]`. A checkbox per
// tool calls `changeMcpGrant`, which posts `<kind>:<tool>[,<tool>…]` (or
// `<kind>:none`) to the same route. Wright has no detail route, so its per-tool
// grant is unknown (no checkboxes), never "not granted". As with GitHub, the row
// changes only when the feed's `agent_*` event refetches the detail.
import { useEffect, useRef } from "react";
import type { McpConnection, McpConnectionKind, RosterEntry, StudioBridge } from "../../api/contract";
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

/**
 * Replace one MCP kind's tool grant for `agent` through `POST /agents/:id/set`
 * (`<kind>:<tool>[,<tool>…]`, or `<kind>:none` for no tools). The one call every
 * tool checkbox makes. A tool name holding a comma is refused here, unsent: the
 * kernel splits the value on commas, so it would grant two other tools.
 */
export async function changeMcpGrant(api: StudioBridge, agent: { readonly id: string; readonly display_name: string }, kind: McpConnectionKind, tools: readonly string[]): Promise<GrantOutcome> {
  const label = MCP_KIND_LABELS[kind];
  if (tools.some((tool) => tool.includes(","))) return { ok: false, text: `A ${label} tool name holds a comma, which a grant cannot carry. Nothing was changed.` };
  const outcome = await setAgentMcpTools(api, agent.id, kind, tools);
  if (!outcome.ok) return { ok: false, text: outcome.message };
  if (!outcome.body.changed) return { ok: true, text: `${agent.display_name}'s ${label} tools were already as set.` };
  if (tools.length === 0) return { ok: true, text: `${label} tools revoked from ${agent.display_name}.` };
  return { ok: true, text: `${label}: ${tools.length} ${tools.length === 1 ? "tool" : "tools"} granted to ${agent.display_name}.` };
}

/** One connected MCP kind in the row: the tools it lists and the ones the agent holds (undefined: unknown). */
export interface McpGrantRow {
  readonly kind: McpConnectionKind;
  /** The tools to show: the connection's `granted_tools`, then any held tool it no longer lists. */
  readonly tools: readonly string[];
  readonly held: readonly string[] | undefined;
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
    return { kind: row.kind, tools: [...listed, ...(held ?? []).filter((tool) => !listed.includes(tool))], held };
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
  /** The agent's full tool set for one kind after the owner ticked or cleared a tool. */
  readonly onMcpChange?: (kind: McpConnectionKind, tools: readonly string[]) => void;
}

function McpRow({ row, busy, onMcpChange }: { readonly row: McpGrantRow; readonly busy: boolean; readonly onMcpChange?: ConnectorsProps["onMcpChange"] }) {
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
      {held === undefined || row.tools.length === 0 ? null : (
        <ul className="team-insp-list team-insp-mono" aria-label={`${label} tools`} data-testid={`team-connector-mcp-${row.kind}-tools`}>
          {row.tools.map((tool) => (
            <li key={tool}>
              <label>
                <input type="checkbox" checked={held.includes(tool)} disabled={busy || onMcpChange === undefined} onChange={(event) => toggle(tool, event.target.checked)} /> {tool}
              </label>
            </li>
          ))}
        </ul>
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

export function Connectors({ granted, lead, level, state, busy, onChange, mcp = [], onMcpChange }: ConnectorsProps) {
  const grantWords = granted === undefined ? GRANT_WORDS.unknown : granted ? GRANT_WORDS.granted : GRANT_WORDS.notGranted;
  const mcpRows = mcp.map((row) => <McpRow key={row.kind} row={row} busy={busy} onMcpChange={onMcpChange} />);
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
