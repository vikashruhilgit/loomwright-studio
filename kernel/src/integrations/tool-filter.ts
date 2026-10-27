// The per-agent tool filter (phase 6): a contributed tool marked
// `requiresConnector` is offered only to a session whose agent holds that
// connector grant. Mechanism only: which agent holds which grant is the
// owner's, in the agent's enforced settings.
//
// Type-only imports, so the `studio` CLI can load it with the feature
// registry: never the Agent SDK, the session manager or `kernel.ts`.
import type { ContributedTool } from "../features/contribution.js";
import type { ConnectorKind } from "./types.js";

/**
 * The tools a session whose agent holds `connectors` may list: every tool
 * without `requiresConnector`, and each tool whose required connector is
 * granted. A new list, in `tools`' order; `tools` is never mutated. It only
 * narrows: a tool a session never lists can't be called.
 */
export function toolsForConnectors(tools: readonly ContributedTool[], connectors: readonly ConnectorKind[]): readonly ContributedTool[] {
  return tools.filter((t) => t.requiresConnector === undefined || connectors.includes(t.requiresConnector));
}
