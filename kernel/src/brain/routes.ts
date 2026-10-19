// The brain's routes on the loopback API (reached only with the bearer
// token): what `studio ask` and `studio messages` call.
//
//   POST /ask            body {text, agent?, workspace?} (text 1-8000 characters, not blank)
//                        202 {message_id, queue_id}
//   GET  /messages/:id   200 the `brain_messages` row (status, session_id, reply_text, detail, …)
//   GET  /messages       200 {messages: [...]}, newest last: the 50 newest rows
//                        (`?all=1`: at most `MAX_MESSAGES_LIST`); `?agent=<id>` only that agent's
//
// `POST /ask` refuses, queueing nothing: `400 invalid_body`; `409
// kill_switch_engaged`; `404 no_such_agent` (an `agent` that is neither
// `wright` nor a registered crew member); `409 agent_off`; `409 model_unset`
// with the settings `file` and `field: "model"` (Wright's file is created
// first when absent, so the refusal names one that exists); `409
// settings_invalid` with the `file`; `409 settings_missing` with the `file`
// (a crew member's file is never created here: this route only reads);
// `409 workspace_not_listed` (a `workspace` not in the agent's settings
// `workspaces`; Wright lists none). `agent` absent is Wright, answered exactly
// as before crew members existed. Otherwise it queues the message for the
// agent (payload `{text, agent}`, plus `workspace` when given) and writes its
// row (`queued`, source `ask`, `from_agent` null, depth 0) in ONE
// transaction, the queue row first (the row's `queue_id` references it).
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import { getAgent } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { enqueueEvent } from "../loop/queue.js";
import { MAX_MESSAGE_CHARS } from "./context.js";
import { listedWorkspace } from "./handler.js";
import { ensureBrainMessage, getBrainMessage, listBrainMessages } from "./messages.js";
import { readWrightSettings } from "./settings.js";

const ID = /^[1-9]\d*$/;

/** The agent `studio ask` talks to when it names none. */
export const ASK_AGENT = "wright";

/** How many rows `GET /messages` answers without `all`: a display bound, not a policy. */
export const DEFAULT_MESSAGES_LIST = 50;
/** The most rows `GET /messages?all=1` answers. */
export const MAX_MESSAGES_LIST = 200;

/** The text `POST /ask` accepts: a string of 1 to `MAX_MESSAGE_CHARS` characters that is not blank. */
export function askTextProblem(text: unknown): string | undefined {
  if (typeof text !== "string") return "text must be a string";
  if (text.trim() === "") return "text must not be blank";
  if (text.length > MAX_MESSAGE_CHARS) return `text must be at most ${MAX_MESSAGE_CHARS} characters`;
  return undefined;
}

/** The settings a message for `agent` would run with: its `workspaces`, or the refusal `POST /ask` answers. Reads only (Wright's file excepted: created when absent). */
function askSettings(dataDir: string, agent: string): { readonly ok: true; readonly workspaces: readonly string[] } | ContributedRouteResponse {
  if (agent === ASK_AGENT) {
    const settings = readWrightSettings(dataDir);
    if (settings.ok) return { ok: true, workspaces: [] };
    return settings.error === "model_unset"
      ? { status: 409, body: { error: "model_unset", file: settings.file, field: "model", message: settings.message } }
      : { status: 409, body: { error: "settings_invalid", file: settings.file, message: settings.message } };
  }
  const settings = readAgentSettings(dataDir, agent);
  if (settings.ok) return { ok: true, workspaces: settings.settings.workspaces ?? [] };
  switch (settings.error) {
    case "model_unset":
      return { status: 409, body: { error: "model_unset", file: settings.file, field: "model", message: settings.message } };
    case "settings_invalid":
      return { status: 409, body: { error: "settings_invalid", file: settings.file, message: settings.message } };
    case "settings_missing":
      return { status: 409, body: { error: "settings_missing", file: settings.file, message: settings.message } };
    case "agent_id_invalid":
      return { status: 404, body: { error: "no_such_agent" } };
  }
}

async function ask(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { status: 400, body: { error: "invalid_body", message: "the body must be a JSON object {text}" } };
  const { text, agent: rawAgent, workspace } = body as { text?: unknown; agent?: unknown; workspace?: unknown };
  const problem = askTextProblem(text);
  if (problem !== undefined) return { status: 400, body: { error: "invalid_body", message: problem } };
  if (workspace !== undefined && typeof workspace !== "string") return { status: 400, body: { error: "invalid_body", message: "workspace must be a string" } };
  if (isKillSwitchEngaged(req.store)) return { status: 409, body: { error: "kill_switch_engaged" } };

  // The agent: Wright when absent; else Wright or a registered crew member that is `active`.
  const agent = rawAgent === undefined ? ASK_AGENT : rawAgent;
  if (typeof agent !== "string") return { status: 404, body: { error: "no_such_agent" } };
  if (agent !== ASK_AGENT) {
    const member = getAgent(req.store, agent);
    if (member === undefined) return { status: 404, body: { error: "no_such_agent" } };
    if (member.status !== "active") return { status: 409, body: { error: "agent_off" } };
  }

  // Before anything is queued: the one settings reader (it creates Wright's file when absent).
  const settings = askSettings(req.store.dataDir, agent);
  if (!("ok" in settings)) return settings;
  if (workspace !== undefined && listedWorkspace(settings.workspaces, workspace) === undefined) return { status: 409, body: { error: "workspace_not_listed" } };

  const at = req.now();
  const { messageId, queueId } = req.store.transaction(() => {
    const payload = { text: text as string, agent, ...(workspace === undefined ? {} : { workspace }) };
    const queued = enqueueEvent(req.store, { kind: "message", payload }, at);
    const row = ensureBrainMessage(
      req.store,
      { queueId: queued.id, agent, source: "ask", text: text as string, fromAgent: null, depth: 0, workspace: workspace ?? null },
      at,
    );
    return { messageId: row.id, queueId: queued.id };
  });
  return { status: 202, body: { message_id: messageId, queue_id: queueId } };
}

async function message(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  if (!ID.test(raw) || !Number.isSafeInteger(id)) return { status: 400, body: { error: "invalid_id" } };
  const row = getBrainMessage(req.store, id);
  return row === undefined ? { status: 404, body: { error: "not_found" } } : { status: 200, body: row };
}

async function messages(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const agent = req.query.agent;
  if (agent === "") return { status: 400, body: { error: "invalid_agent" } };
  const limit = req.query.all === "1" || req.query.all === "true" ? MAX_MESSAGES_LIST : DEFAULT_MESSAGES_LIST;
  return { status: 200, body: { messages: listBrainMessages(req.store, { ...(agent === undefined ? {} : { agent }), limit }) } };
}

export const brainRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "POST", path: "/ask", handler: ask },
  { method: "GET", path: "/messages/:id", handler: message },
  { method: "GET", path: "/messages", handler: messages },
]);
