// The brain's `message` handler: a queued message for Wright starts (or
// resumes) one short Wright session through the kernel's session manager
// (`ctx.sessions`), and the reply is kept on the message's `brain_messages`
// row. The kernel owns the session's lifecycle (invariant 2): the handler
// never awaits the session, so the loop is never blocked, and it never stops
// one.
//
// Steps, keyed on the event id (delivery is at least once):
//   a. the message row (idempotent on `queue_id`), and Wright's memory files
//      when absent (exclusive create, never overwritten);
//   b. the settings (`readWrightSettings`): no model ⇒ row `failed`
//      (`model_unset`), event done, no session;
//   c. the context (`buildContext`);
//   d. `runStepAsync("start-session")`: start a session, or resume the task's
//      latest Wright session when it is `interrupted`; the row becomes
//      `running` with its `session_id`;
//   e. a listener on `handle.result` (not awaited) writes the reply
//      (`replied`), or `failed` with the session's ending.
// An admission refusal parks the row (`parked`, the reason and retry time)
// and is rethrown, so the loop parks the event (phase 1 park rules). Any
// other refusal fails the row and is rethrown (the loop fails the event, with
// one notify). Messages for other agents change nothing (later phases).
//
// Imports only types from the loop and the session manager (never the
// manager itself or the Agent SDK: the `studio` CLI loads this module).
import type { LoomwrightAdapterStatus } from "../loomwright/active-install.js";
import type { EventContext, EventHandler, EventSessions } from "../loop/types.js";
import type { SessionHandle, SessionStatus } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { buildContext, loomwrightSummaryOf } from "./context.js";
import type { LoomwrightSummary } from "./context.js";
import { ensureMemoryFiles, wrightMemoryDir } from "./memory.js";
import { BRAIN_AGENTS, FINAL_MESSAGE_STATUSES, ensureBrainMessage, messageSourceOf, updateBrainMessage } from "./messages.js";
import { readWrightSettings } from "./settings.js";

export interface BrainHandlerDeps {
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** The zone the context's local time is shown in. Defaults to the host's. */
  readonly timeZone?: () => string;
  /**
   * The Loomwright part of the context. Defaults to the manifest summary of
   * the install `ctx.sessions.loomwrightStatus()` names (the kernel's session
   * manager has it), or "isn't available" when there is no such function.
   */
  readonly loomwright?: (sessions: EventSessions | undefined) => LoomwrightSummary;
}

/** The session manager as the kernel passes it: `EventSessions`, and the adapter status `GET /status` reports. */
type SessionsWithLoomwright = EventSessions & { readonly loomwrightStatus?: () => LoomwrightAdapterStatus };

function defaultLoomwright(sessions: EventSessions | undefined): LoomwrightSummary {
  const s = sessions as SessionsWithLoomwright | undefined;
  const status = typeof s?.loomwrightStatus === "function" ? () => (s.loomwrightStatus as () => LoomwrightAdapterStatus).call(s) : undefined;
  return loomwrightSummaryOf(status);
}

/**
 * An admission refusal (`AdmissionRefusedError`, code `admission_refused`),
 * told by its stable code so this module never imports the session layer at
 * runtime.
 */
function admissionRefusal(err: unknown): { readonly reason: string; readonly retryAt: string | null } | undefined {
  if (!(err instanceof Error) || (err as { code?: unknown }).code !== "admission_refused") return undefined;
  const { reason, retryAt } = err as { reason?: unknown; retryAt?: unknown };
  return { reason: typeof reason === "string" ? reason : "admission_refused", retryAt: typeof retryAt === "string" ? retryAt : null };
}

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  const line = text.split("\n", 1)[0] ?? "";
  return typeof code === "string" && !line.startsWith(code) ? `${code}: ${line}` : line;
}

/** The task's latest Wright session, when it is `interrupted` (resumable): its id. */
function interruptedWrightSession(store: Store, agent: string, taskId: number | null): number | undefined {
  if (taskId === null) return undefined;
  const latest = store
    .prepare<[number, string], { id: number; status: string }>("SELECT id, status FROM sessions WHERE task_id = ? AND agent = ? ORDER BY id DESC LIMIT 1")
    .get(taskId, agent);
  return latest?.status === "interrupted" ? latest.id : undefined;
}

/** What a session's ending means for its message: the reply, or why there is none. */
function endingOf(status: SessionStatus, reply: string | null): { status: "replied"; replyText: string } | { status: "failed"; detail: string } {
  if (reply !== null) return { status: "replied", replyText: reply };
  if (status === "completed") return { status: "failed", detail: "session_completed_without_reply: the session ended without a successful result" };
  return { status: "failed", detail: `session_${status}: the session ended ${status} without a reply` };
}

/**
 * Write the reply when the session ends. Never awaited and never throws: the
 * store may be closed by then (the kernel stopped), and the reply is then lost
 * (the row stays `running`; documented as an honest limit).
 */
function attachReply(store: Store, rowId: number, handle: SessionHandle, now: () => Date): void {
  void Promise.all([handle.done, handle.result])
    .then(([status, reply]) => {
      updateBrainMessage(store, rowId, ["running"], { ...endingOf(status, reply), sessionId: handle.id }, now());
    })
    .catch(() => {
      // The store is closed or the write failed: nothing else to do.
    });
}

/** The brain's `message` handler (see the module comment). `deps` replace the clock, zone and Loomwright reader in tests. */
export function brainMessageHandler(deps: BrainHandlerDeps = {}): EventHandler {
  const now = deps.now ?? (() => new Date());
  const timeZone = deps.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const loomwright = deps.loomwright ?? defaultLoomwright;

  return async (ctx: EventContext): Promise<void> => {
    const { event, store } = ctx;
    const agent = event.payload.agent;
    if (typeof agent !== "string" || !BRAIN_AGENTS.includes(agent)) return;
    const text = typeof event.payload.text === "string" ? event.payload.text : "";

    // a. The row (idempotent on queue_id), then the memory files.
    const row = ensureBrainMessage(store, { queueId: event.id, agent, source: messageSourceOf(event.payload), text }, now());
    if (FINAL_MESSAGE_STATUSES.includes(row.status)) return;
    const fail = (detail: string): void => {
      updateBrainMessage(store, row.id, ["queued", "parked", "running"], { status: "failed", detail }, now());
    };
    const dataDir = store.dataDir;
    try {
      ensureMemoryFiles(dataDir);
    } catch (err) {
      fail(`memory_unwritable: ${messageOf(err)}`);
      throw err;
    }

    // b. The settings: the kernel never picks a model.
    let settings;
    try {
      settings = readWrightSettings(dataDir);
    } catch (err) {
      fail(`settings_unwritable: ${messageOf(err)}`);
      throw err;
    }
    if (!settings.ok) {
      fail(settings.error === "model_unset" ? `model_unset: set "model" in ${settings.file}` : `settings_invalid: ${settings.message}`);
      return;
    }
    const sessions = ctx.sessions;
    if (sessions === undefined) {
      fail("no_session_manager: this kernel composition gives handlers no session manager");
      return;
    }

    // c. The context.
    const prompt = buildContext({ dataDir, source: row.source, text: row.text, loomwright: loomwright(sessions), now: now(), timeZone: timeZone() });

    // d. Start (or resume) the session: the step's first effect, so an admission refusal leaves nothing to repeat.
    const { model, permissionMode, policy } = settings.settings;
    const cwd = wrightMemoryDir(dataDir);
    let handle: SessionHandle | undefined;
    let started: { session_id: number };
    try {
      started = await ctx.runStepAsync("start-session", async () => {
        const resumeId = interruptedWrightSession(store, agent, event.taskId);
        handle =
          resumeId === undefined
            ? await sessions.startSession({ agent, ...(event.taskId === null ? {} : { task: event.taskId }), prompt, model, permissionMode, cwd, policy })
            : await sessions.resumeSession(resumeId, { prompt, permissionMode, cwd, policy });
        return { session_id: handle.id };
      });
    } catch (err) {
      const refusal = admissionRefusal(err);
      if (refusal !== undefined) {
        const detail = `admission_refused: ${refusal.reason}; ${refusal.retryAt === null ? "retry time unknown" : `retry at ${refusal.retryAt}`}`;
        updateBrainMessage(store, row.id, ["queued", "parked"], { status: "parked", detail }, now());
      } else {
        fail(`session_refused: ${messageOf(err)}`);
      }
      throw err;
    }
    updateBrainMessage(store, row.id, ["queued", "parked"], { status: "running", sessionId: started.session_id, detail: null }, now());

    // e. The reply, when the session ends (only the delivery that started it holds its handle).
    if (handle !== undefined) attachReply(store, row.id, handle, now);
  };
}
