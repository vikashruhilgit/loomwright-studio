// The per-agent tool filter (phase 6): a contributed tool marked
// `requiresConnector` is offered only to a session whose agent holds that
// connector grant. Mechanism only: which agent holds which grant is the
// owner's, in the agent's enforced settings.
//
// An MCP connector's proxy tool (phase 8 item 06, `./mcp/tools.ts`) is narrowed
// one step further: holding the `jira` grant is not enough, the owner's grant
// must name that server tool. A proxy tool is listed only when `mcpGrants` names
// it, so a call without grants lists none (a session lists fewer tools, never more).
//
// Type-only imports, so the `studio` CLI can load it with the feature
// registry: never the Agent SDK, the session manager or `kernel.ts`.
import type { ContributedTool } from "../features/contribution.js";
import type { McpProxyTool, McpToolGrants } from "./mcp/tools.js";
import type { ConnectorKind } from "./types.js";

/** Whether `tool` is an MCP connector's proxy tool (it carries the server's own tool name, the key of a grant). */
function isMcpProxy(tool: ContributedTool): tool is McpProxyTool {
  const t = tool as Partial<McpProxyTool>;
  return typeof t.serverTool === "string" && typeof t.mcpKind === "string";
}

/**
 * The tools a session whose agent holds `connectors` may list: every tool
 * without `requiresConnector`, and each tool whose required connector is
 * granted, except a write-level tool (`requiresConnectorLevel: "write"`),
 * which is listed only when `githubWrite` is true (the agent's `github:
 * write` grant, not the playbook's mode). An MCP proxy tool is also listed
 * only when `mcpGrants` names its server tool under its kind. A new list, in
 * `tools`' order; `tools` is never mutated. It only narrows: a tool a session
 * never lists can't be called.
 */
export function toolsForConnectors(
  tools: readonly ContributedTool[],
  connectors: readonly ConnectorKind[],
  githubWrite = false,
  mcpGrants: McpToolGrants = {},
): readonly ContributedTool[] {
  return tools.filter((t) => {
    if (isMcpProxy(t)) return connectors.includes(t.mcpKind) && (mcpGrants[t.mcpKind] ?? []).includes(t.serverTool);
    return (t.requiresConnector === undefined || connectors.includes(t.requiresConnector)) && (t.requiresConnectorLevel !== "write" || githubWrite);
  });
}
