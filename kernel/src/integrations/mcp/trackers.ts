// The Jira and ClickUp definitions and the kernel's ticket reader (phase 8
// item 07, D38). `MCP_TRACKERS` names, per MCP kind, the hosted server's
// address and the one tool a poll calls to list tickets; `connector.ts` fills
// `MCP_SERVERS` from it. `createMcpTicketReader` is how a due `jira.issues` or
// `clickup.tasks` poll (and the dry run) reaches the server: the kernel's own
// call with the owner's Keychain sign-in, never inside a session, and not under
// the per-agent tool grant (which governs sessions only).
//
// The server is untrusted (invariant 3): a tool name here is data, checked
// against the tool list the row recorded from the server's own `tools/list` at
// connect (`tool_unavailable` and no call when it is not there), and a failure
// is a fixed code. What the server says about a failure is never kept: no
// server text, and no token, reaches a row, an event, a notification, an
// answer or a log from this file. Nothing here logs.
//
// ClickUp's tool name (`clickup_filter_tasks`), its arguments and its response
// shape were read from the live server on 2026-11-13 and are recorded in
// `docs/evidence/phase-8-20g-clickup-reader.md`; its list lookup (`clickup_get_list`,
// used at draft time to turn a list name into an ID, and why a space name has no
// lookup) is recorded in `docs/evidence/phase-8-21a-clickup-list-by-name.md`.
//
// Imports: the MCP client, the credential and row modules, the store and the
// Keychain reader's type and constructor; never `connector.ts` (which imports
// this file), `tools.ts`, the Agent SDK, the session manager or `kernel.ts`.
import { securityCliKeychain } from "../../auth/keychain.js";
import type { KeychainReader } from "../../auth/keychain.js";
import type { Store } from "../../store/store.js";
import { McpClientError, callMcpTool } from "./client.js";
import type { McpHttpOptions } from "./client.js";
import { readMcpCredential } from "./credential.js";
import { isUsableMcpStatus, mcpRow, storedToolsOf } from "./rows.js";
import type { McpKind } from "./rows.js";

/** What the kernel knows of one ticket tracker's hosted server. */
export interface McpTrackerDefinition {
  /** The server's MCP address (Streamable HTTP). */
  readonly url: string;
  /** The server's own name of the tool a poll calls to list tickets. */
  readonly tool: string;
  /** How the owner reads the tracker's name. */
  readonly label: string;
  /**
   * The server's own names of the read-only tools that turn a name the owner gave at
   * draft time into an ID (`resolveClickupNames`), by what the name is of. Each is
   * checked against the connection's stored tool list like `tool`. A kind that has
   * no tool for a name is absent here, and a tracker with no lookup has no `lookup`.
   */
  readonly lookup?: { readonly list?: string; readonly space?: string };
}

/**
 * The trackers built in, by kind. The Jira address is Atlassian Rovo's v1
 * endpoint (a v2 endpoint is documented too: NEEDS VERIFICATION in
 * `docs/architecture/mcp-connectors.md`); Jira is never called live from here
 * (the owner's work account). The ClickUp tool is the one its server lists for
 * filtering tasks (probed, `docs/evidence/phase-8-20g-clickup-reader.md`).
 */
export const MCP_TRACKERS: Readonly<Record<McpKind, McpTrackerDefinition>> = Object.freeze({
  jira: Object.freeze({ url: "https://mcp.atlassian.com/v1/mcp", tool: "searchJiraIssuesUsingJql", label: "Jira" }),
  clickup: Object.freeze({ url: "https://mcp.clickup.com/mcp", tool: "clickup_filter_tasks", label: "ClickUp", lookup: Object.freeze({ list: "clickup_get_list" }) }),
});

/** Every way a ticket read fails: a closed set of fixed codes, each the whole of the failure. */
export const MCP_TICKET_FAILURES = Object.freeze([
  "connector_missing",
  "connector_expired",
  "tool_unavailable",
  "keychain_failed",
  "mcp_unauthorized",
  "mcp_timeout",
  "mcp_unreachable",
  "mcp_protocol",
  "mcp_tool_error",
] as const);

/** One of `MCP_TICKET_FAILURES`. */
export type McpTicketFailure = (typeof MCP_TICKET_FAILURES)[number];

/** A ticket read's outcome: the tool's text (untrusted: the caller parses it as data), or a fixed code. Never a throw. */
export type McpTicketResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: McpTicketFailure };

/** The kernel's ticket reader: one method, so a test injects a fake and the real one is built lazily. */
export interface McpTicketReader {
  /** Call `tool` of the `kind` connector with `args`, as the kernel, with the owner's sign-in. Resolves; never throws or rejects. */
  call(store: Store, kind: McpKind, tool: string, args: Record<string, unknown>): Promise<McpTicketResult>;
}

/** What the reader reads and calls. Every default resolves only when a call needs it. */
export interface McpTicketReaderDeps {
  /** Default: `securityCliKeychain()`, built on the first call that gets as far as the Keychain. */
  readonly keychain?: KeychainReader;
  /** The HTTP knobs; tests turn loopback `http` on. */
  readonly http?: McpHttpOptions;
  /** Which server a kind means; `undefined` is no server (`connector_missing`). Default: the definition's address (`MCP_TRACKERS`). */
  readonly serverFor?: (kind: McpKind, store: Store) => string | undefined;
  /** The clock the sign-in's expiry is read against. Default: the wall clock. */
  readonly now?: () => Date;
}

/**
 * The reader over `deps`. Checks, in order, and stops at the first that fails
 * with no call made: the row is usable (`connector_missing`), the row's stored
 * tool list has `tool` (`tool_unavailable`), the Keychain item is readable
 * (`keychain_failed`) and holds a sign-in that has not lapsed
 * (`connector_expired`). Then the server is called: a transport failure is
 * `mcp_unauthorized | mcp_timeout | mcp_unreachable | mcp_protocol`, and a tool
 * that ran and failed is `mcp_tool_error` (its text dropped).
 */
export function createMcpTicketReader(deps: McpTicketReaderDeps = {}): McpTicketReader {
  let reader: KeychainReader | undefined = deps.keychain;
  const keychain = (): KeychainReader => (reader ??= securityCliKeychain());
  const now = deps.now ?? ((): Date => new Date());

  async function call(store: Store, kind: McpKind, tool: string, args: Record<string, unknown>): Promise<McpTicketResult> {
    try {
      const row = mcpRow(store, kind);
      if (row === undefined || !isUsableMcpStatus(row.status)) return { ok: false, error: "connector_missing" };
      const url = deps.serverFor !== undefined ? deps.serverFor(kind, store) : MCP_TRACKERS[kind].url;
      if (url === undefined) return { ok: false, error: "connector_missing" };
      if (!storedToolsOf(row.granted_tools).some((t) => t.name === tool)) return { ok: false, error: "tool_unavailable" };

      let credential;
      try {
        credential = readMcpCredential(keychain(), kind);
      } catch {
        return { ok: false, error: "keychain_failed" };
      }
      if (credential === undefined) return { ok: false, error: "connector_expired" };
      if (credential.expires_at !== undefined && !(Date.parse(credential.expires_at) > now().getTime())) return { ok: false, error: "connector_expired" };

      let answer;
      try {
        answer = await callMcpTool(url, credential.access_token, tool, args, deps.http);
      } catch (err) {
        const code = err instanceof McpClientError ? err.code : "protocol";
        return { ok: false, error: code === "refused_url" ? "mcp_unreachable" : (`mcp_${code}` as McpTicketFailure) };
      }
      if (answer.is_error) return { ok: false, error: "mcp_tool_error" };
      return { ok: true, text: answer.text };
    } catch {
      // The store or the clock failed: a fixed code, never the error's text (it can quote a path or a value).
      return { ok: false, error: "connector_missing" };
    }
  }

  return { call };
}
