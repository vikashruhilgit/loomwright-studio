// The `mcp_connections` table's read side (migration 20): the row type, the
// kinds an MCP connector can be, and the stored tool list. Reads only; the
// writes (connect, refresh, disconnect) are `connector.ts`'s, the one place
// that changes a row. It is a file of its own so `tools.ts` (which builds a
// session's proxy tools from a row) and `connector.ts` (which plans those
// tools when a connect completes) can both read a row without importing each
// other.
//
// A row never holds a secret: the connector's tokens live only in the
// Keychain item `loomwright-studio-mcp-<kind>` (`credential.ts`).
//
// The `studio` CLI loads it through the integrations feature, so it imports
// only types, the connector kinds and the store: never the Agent SDK, the
// session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import type { Store } from "../../store/store.js";
import { CONNECTOR_KINDS } from "../types.js";
import type { ConnectorKind, ConnectorStatus } from "../types.js";

/** The MCP connector kinds (D38): every `ConnectorKind` but `github`. Derived from `CONNECTOR_KINDS`, so a new kind there is seen here. */
export type McpKind = Exclude<ConnectorKind, "github">;

/** Every `McpKind`, in `CONNECTOR_KINDS`' order. */
export const MCP_KINDS: readonly McpKind[] = Object.freeze(CONNECTOR_KINDS.filter((kind): kind is McpKind => kind !== "github"));

/** Whether `value` is an MCP connector kind. */
export function isMcpKind(value: unknown): value is McpKind {
  return typeof value === "string" && (MCP_KINDS as readonly string[]).includes(value);
}

/**
 * The statuses whose credential is in use: a tool call may be made under them
 * and a poll that needs the connector may run. `expired`, `disconnected` and
 * `rejected` (and no row at all) are not.
 */
export const MCP_USABLE_STATUSES: readonly ConnectorStatus[] = Object.freeze(["connected", "expiring"] as const);

/** Whether a row in `status` has a credential in use. */
export function isUsableMcpStatus(status: string | null | undefined): boolean {
  return (MCP_USABLE_STATUSES as readonly (string | null | undefined)[]).includes(status);
}

/**
 * One server tool the kernel kept at connect, as `granted_tools` stores it.
 * `name` is the server's own name (untrusted text; the key of a grant),
 * `proxy` the name the kernel fixed for it (`tools.ts`), `read_only` whether
 * the server hinted `readOnlyHint: true` (read from this row, never from
 * session input), and `description` / `schema` the clipped, control-stripped
 * server text a proxy tool's description is made from (untrusted data).
 */
export interface McpStoredTool {
  readonly name: string;
  readonly proxy: string;
  readonly read_only: boolean;
  readonly description: string;
  readonly schema: string;
}

/** An `mcp_connections` row as SQLite returns it. */
export interface McpRow {
  readonly id: number;
  readonly kind: McpKind;
  readonly server_url: string | null;
  readonly status: ConnectorStatus;
  /** JSON text: the kept tools (`McpStoredTool[]`); null before the first connect. */
  readonly granted_tools: string | null;
  readonly token_expiry: string | null;
}

const COLUMNS = "id, kind, server_url, status, granted_tools, token_expiry";

/** The row of `kind`, or `undefined`. */
export function mcpRow(store: Store, kind: McpKind): McpRow | undefined {
  return store.prepare<[string], McpRow>(`SELECT ${COLUMNS} FROM mcp_connections WHERE kind = ?`).get(kind);
}

/** Every MCP connector row (a row whose kind is not an MCP kind is never shown), by id. */
export function mcpRows(store: Store): McpRow[] {
  return store
    .prepare<[], McpRow>(`SELECT ${COLUMNS} FROM mcp_connections ORDER BY id`)
    .all()
    .filter((row) => isMcpKind(row.kind));
}

/** A stored entry's shape check: the four strings and the flag. */
function isStoredTool(value: unknown): value is McpStoredTool {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return typeof o["name"] === "string" && typeof o["proxy"] === "string" && typeof o["read_only"] === "boolean" && typeof o["description"] === "string" && typeof o["schema"] === "string";
}

/** The kept tools `granted_tools` holds; an unreadable value, or an entry that is not a stored tool, reads as no tool (fewer, never more). */
export function storedToolsOf(text: string | null): McpStoredTool[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isStoredTool) : [];
  } catch {
    return [];
  }
}
