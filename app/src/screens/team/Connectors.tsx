// The inspector's Connectors row (phase 6 item 08): whether the owner granted
// this agent GitHub, the connector's own state, and the one button that grants
// or revokes it. The grant is `connectors` on the agent's settings file, read
// from the roster (`RosterEntry.connectors`); the connector's state is
// `GET /connectors`, read by the screen. Both come in as props.
//
// The button and the ⌘K command call the same `changeGithubGrant`, which posts
// `{field: "connectors", value}` to `POST /agents/:id/set`. Nothing here edits
// the row: it changes only when the feed's `agent_*` event refetches the
// roster, as with every other Team write. The grant is allowed while GitHub is
// not connected (the kernel never reads the connector to decide it), which is
// why the state is shown beside it. Every string is a React text child.
//
// Beside the GitHub row, one row per connected MCP kind (Jira, ClickUp; phase 8,
// D38) shows which of that kind's `granted_tools` the agent holds, read from the
// agent's `GET /agents/:id` `settings.content.connectors[<kind>]`. A checkbox per
// tool calls `changeMcpGrant`, which posts `<kind>:<tool>[,<tool>…]` (or
// `<kind>:none`) to the same route. Wright has no detail route, so its per-tool
// grant is unknown (no checkboxes), never "not granted". As with GitHub, the row
// changes only when the feed's `agent_*` event refetches the detail.
import type { McpConnection, McpConnectionKind, StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { setAgentConnectors, setAgentMcpTools } from "./actions";
import { type ConnectorsState, connectorStateText, MCP_KIND_LABELS, mcpToolsHeld } from "./model";

/** What the owner asked for: give the agent GitHub, or take it away. */
export type GrantChange = "grant" | "revoke";

/** The result of one grant or revoke, in words: the owner's route answered, or refused. */
export interface GrantOutcome {
  readonly ok: boolean;
  readonly text: string;
}

/** The grant words in the row: unknown when the roster did not report the agent's `connectors`. */
export const GRANT_WORDS = { granted: "granted", notGranted: "not granted", unknown: "grant unknown" } as const;

/**
 * Grant or revoke GitHub for `agent` through `POST /agents/:id/set`. The one
 * call both the Connectors button and the ⌘K commands make.
 */
export async function changeGithubGrant(api: StudioBridge, agent: { readonly id: string; readonly display_name: string }, change: GrantChange): Promise<GrantOutcome> {
  const outcome = await setAgentConnectors(api, agent.id, change === "grant" ? "github" : "none");
  if (!outcome.ok) return { ok: false, text: outcome.message };
  if (change === "grant") return { ok: true, text: outcome.body.changed ? `GitHub granted to ${agent.display_name}.` : `${agent.display_name} already has GitHub.` };
  return { ok: true, text: outcome.body.changed ? `GitHub revoked from ${agent.display_name}.` : `${agent.display_name} already has no GitHub.` };
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
  /** The roster's read of the grant: true, false, or undefined when unknown. */
  readonly granted: boolean | undefined;
  /** `GET /connectors`, as the screen holds it. */
  readonly state: ConnectorsState;
  readonly busy: boolean;
  readonly onChange: (change: GrantChange) => void;
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

export function Connectors({ granted, state, busy, onChange, mcp = [], onMcpChange }: ConnectorsProps) {
  const grantWords = granted === undefined ? GRANT_WORDS.unknown : granted ? GRANT_WORDS.granted : GRANT_WORDS.notGranted;
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
        <Button className="team-insp-conn-action" size="row" variant="ghost" loading={busy} onClick={() => onChange("revoke")}>
          Revoke
        </Button>
      ) : (
        <Button className="team-insp-conn-action" size="row" variant="secondary" loading={busy} onClick={() => onChange("grant")}>
          Grant GitHub
        </Button>
      )}
      {mcp.map((row) => (
        <McpRow key={row.kind} row={row} busy={busy} onMcpChange={onMcpChange} />
      ))}
    </>
  );
}
