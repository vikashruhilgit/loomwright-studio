// The Jira and ClickUp definitions and the kernel's ticket reader (phase 8
// item 07, D38). `MCP_TRACKERS` names, per MCP kind, the hosted server's
// address and the one tool a poll calls to list tickets; `connector.ts` fills
// `MCP_SERVERS` from it. `createMcpTicketReader` is how a due `jira.issues` or
// `clickup.tasks` poll (and the dry run) reaches the server: the kernel's own
// call with the owner's Keychain sign-in, never inside a session, and not under
// the per-agent tool grant (which governs sessions only).
//
// `MCP_TRACKER_CAPABILITIES` is the same tools in the owner's words (phase 8 item 21b): a
// fixed list of capabilities per tracker, each naming exact server tool names, so the Team
// screen offers "Read tickets" rather than ~58 raw names and a held charter can say whether a
// member can read its tracker's tickets. `trackerCapabilities` answers it for one connection.
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

// ---- Capabilities: a tracker's tools in the owner's words ------------------------------

/** One thing an owner may let a crew member do in a tracker, by the server's own tool names. */
export interface McpCapabilityDefinition {
  /** A stable id (`TRACKER_READ_CAPABILITY` is the one Part C's readiness checks). */
  readonly id: string;
  /** How the owner reads it ("Read tickets"). */
  readonly label: string;
  /** True when the capability writes, deletes or posts (a tick lets the member change things in the tracker); false for a pure read. */
  readonly changes: boolean;
  /** The server's exact tool names. A tool is in at most one capability of a kind. Data, matched against the connection's stored tool list. */
  readonly tools: readonly string[];
}

/** The id of each tracker's "read tickets" capability: the one a ticket-working member needs. It holds that tracker's poll tool (`MCP_TRACKERS[kind].tool`). */
export const TRACKER_READ_CAPABILITY = "read";

const capability = (id: string, label: string, changes: boolean, tools: readonly string[]): McpCapabilityDefinition =>
  Object.freeze({ id, label, changes, tools: Object.freeze([...tools]) });

/**
 * The capabilities, per tracker, in the order the owner sees them: a fixed, exact-name list the
 * kernel owns (phase 8 item 21b), because only the kernel knows which tools mean "read tickets". Mechanism
 * only (invariant 1): nothing is ticked or granted by it; a tick is the owner's.
 *
 * Each name is the server's own, matched exactly against the connection's stored tool list; a
 * name the server does not list is simply absent from the answer, and a listed tool no capability
 * names is an `other_tools` entry, never granted by a capability tick (`trackerCapabilities`).
 * ClickUp's names are from a read-only `tools/list` of the owner's personal ClickUp on 2026-11-14
 * (`docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md`). Jira's are AUTHORED from
 * Atlassian's Rovo MCP supported-tools page and never checked against the live server (Jira is
 * the owner's work account): NEEDS VERIFICATION in `docs/OPEN_QUESTIONS.md`.
 */
export const MCP_TRACKER_CAPABILITIES: Readonly<Record<McpKind, readonly McpCapabilityDefinition[]>> = Object.freeze({
  jira: Object.freeze([
    capability(TRACKER_READ_CAPABILITY, "Read tickets", false, [
      "searchJiraIssuesUsingJql",
      "getJiraIssue",
      "getVisibleJiraProjects",
      "getJiraProjectIssueTypesMetadata",
      "getJiraIssueTypeMetaWithFields",
      "getJiraIssueRemoteIssueLinks",
      "getTransitionsForJiraIssue",
      "lookupJiraAccountId",
      "getAccessibleAtlassianResources",
      "atlassianUserInfo",
    ]),
    capability("comment", "Comment on tickets", true, ["addCommentToJiraIssue"]),
    capability("update", "Change a ticket's status or fields", true, ["editJiraIssue", "transitionJiraIssue"]),
    capability("create", "Create tickets", true, ["createJiraIssue"]),
  ]),
  clickup: Object.freeze([
    capability(TRACKER_READ_CAPABILITY, "Read tickets", false, [
      "clickup_filter_tasks",
      "clickup_get_task",
      "clickup_search",
      "clickup_get_list",
      "clickup_get_folder",
      "clickup_get_list_location",
      "clickup_get_workspace_hierarchy",
      "clickup_get_custom_fields",
      "clickup_get_task_time_in_status",
      "clickup_get_bulk_tasks_time_in_status",
      "clickup_get_workspace_members",
      "clickup_find_member_by_name",
      "clickup_resolve_assignees",
      "clickup_get_user",
      "clickup_get_schema",
    ]),
    capability("comment", "Comment on tickets", true, ["clickup_get_task_comments", "clickup_get_threaded_comments", "clickup_create_comment", "clickup_create_task_comment", "clickup_update_comment"]),
    capability("update", "Change a ticket's status or fields", true, [
      "clickup_update_task",
      "clickup_move_task",
      "clickup_add_task_to_list",
      "clickup_remove_task_from_list",
      "clickup_create_space_tag",
      "clickup_add_tag_to_task",
      "clickup_remove_tag_from_task",
      "clickup_add_task_dependency",
      "clickup_remove_task_dependency",
      "clickup_add_task_link",
      "clickup_remove_task_link",
    ]),
    capability("create", "Create tickets", true, ["clickup_create_task"]),
    capability("delete", "Delete or merge tickets, or delete comments", true, ["clickup_delete_task", "clickup_merge_tasks", "clickup_delete_comment"]),
    capability("chat", "Read and send chat messages", true, [
      "clickup_get_chat_channels",
      "clickup_get_chat_channel_messages",
      "clickup_get_chat_message_replies",
      "clickup_send_chat_message",
      "clickup_react_to_chat_message",
      "clickup_update_chat_message",
      "clickup_delete_chat_message",
    ]),
  ]),
});

/** One capability as `GET /connectors` shows it: its listed tools only (`McpCapability` in `app/src/api/contract.ts`). */
export interface McpCapabilityView {
  readonly id: string;
  readonly label: string;
  readonly changes: boolean;
  /** The capability's tools the connection lists, in the capability's order. Never empty: a capability with none listed is left out. */
  readonly tools: readonly string[];
}

/** A connection's tools in the owner's words: the capabilities the connection can offer, and the listed tools no capability covers. */
export interface McpCapabilityList {
  readonly capabilities: readonly McpCapabilityView[];
  /** Listed tools no capability names, in the listed order, each once. Named, never hidden, and never granted by a capability tick. */
  readonly other_tools: readonly string[];
}

/**
 * `listed` (the connection's stored tool names) in the owner's words: each capability of `kind` with only the
 * tools the connection lists (a capability with none is left out: there is nothing to tick), and `other_tools`,
 * the listed tools no capability names. A tool in no capability is never put in one, and a name a capability
 * declares but the connection does not list is never answered (the answer is the intersection, never the
 * declared list). `null` for a kind with no table.
 */
export function trackerCapabilities(kind: McpKind, listed: readonly string[]): McpCapabilityList | null {
  const table = MCP_TRACKER_CAPABILITIES[kind] as readonly McpCapabilityDefinition[] | undefined;
  if (table === undefined) return null;
  const present = new Set(listed);
  const covered = new Set(table.flatMap((c) => c.tools));
  const capabilities: McpCapabilityView[] = [];
  for (const c of table) {
    const tools = c.tools.filter((t) => present.has(t));
    if (tools.length > 0) capabilities.push({ id: c.id, label: c.label, changes: c.changes, tools });
  }
  return { capabilities, other_tools: [...new Set(listed.filter((t) => !covered.has(t)))] };
}

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
