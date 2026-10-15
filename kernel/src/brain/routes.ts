// The brain's routes on the loopback API (reached only with the bearer
// token): what `studio ask` calls.
//
//   POST /ask            body {text} (1-8000 characters, not blank)
//                        202 {message_id, queue_id}
//   GET  /messages/:id   200 the `brain_messages` row (status, session_id, reply_text, detail, …)
//
// `POST /ask` refuses, queueing nothing: `400 invalid_body`; `409
// kill_switch_engaged`; `409 model_unset` with the settings `file` and
// `field: "model"` (the file is created first when absent, so the refusal
// names one that exists); `409 settings_invalid` with the `file`. Otherwise
// it queues the message for Wright and writes its row (`queued`, source
// `ask`) in ONE transaction, the queue row first (the row's `queue_id`
// references it).
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { enqueueMessage } from "../loop/queue.js";
import { MAX_MESSAGE_CHARS } from "./context.js";
import { ensureBrainMessage, getBrainMessage } from "./messages.js";
import { readWrightSettings } from "./settings.js";

const ID = /^[1-9]\d*$/;

/** The agent `studio ask` talks to. */
export const ASK_AGENT = "wright";

/** The text `POST /ask` accepts: a string of 1 to `MAX_MESSAGE_CHARS` characters that is not blank. */
export function askTextProblem(text: unknown): string | undefined {
  if (typeof text !== "string") return "text must be a string";
  if (text.trim() === "") return "text must not be blank";
  if (text.length > MAX_MESSAGE_CHARS) return `text must be at most ${MAX_MESSAGE_CHARS} characters`;
  return undefined;
}

async function ask(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { status: 400, body: { error: "invalid_body", message: "the body must be a JSON object {text}" } };
  const text = (body as { text?: unknown }).text;
  const problem = askTextProblem(text);
  if (problem !== undefined) return { status: 400, body: { error: "invalid_body", message: problem } };
  if (isKillSwitchEngaged(req.store)) return { status: 409, body: { error: "kill_switch_engaged" } };

  // Before anything is queued: the one settings reader (it creates the file when absent).
  const settings = readWrightSettings(req.store.dataDir);
  if (!settings.ok) {
    return settings.error === "model_unset"
      ? { status: 409, body: { error: "model_unset", file: settings.file, field: "model", message: settings.message } }
      : { status: 409, body: { error: "settings_invalid", file: settings.file, message: settings.message } };
  }

  const at = req.now();
  const { messageId, queueId } = req.store.transaction(() => {
    const queued = enqueueMessage(req.store, { text: text as string, agent: ASK_AGENT }, at);
    const row = ensureBrainMessage(req.store, { queueId: queued.id, agent: ASK_AGENT, source: "ask", text: text as string }, at);
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

export const brainRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "POST", path: "/ask", handler: ask },
  { method: "GET", path: "/messages/:id", handler: message },
]);
