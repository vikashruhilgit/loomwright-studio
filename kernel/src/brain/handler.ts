// The brain's `message` handler: a queued message for an agent (Wright, or an
// `active` registered crew member) starts (or resumes) one short session of
// that agent through the kernel's session manager (`ctx.sessions`), and the
// reply is kept on the message's `brain_messages` row. The kernel owns the
// session's lifecycle (invariant 2): the handler never awaits the session, so
// the loop is never blocked, and it never stops one.
//
// Routing: a payload with no string `agent` changes nothing (no row). Any
// other message writes its row first; then `wright` takes Wright's path, and
// a crew id takes the crew path, or fails its row `no_such_agent` (no such
// row, or an invalid or reserved id) or `agent_off`, event done, no session.
//
// Steps, keyed on the event id (delivery is at least once):
//   a. the message row (idempotent on `queue_id`, with the payload's phase 4
//      fields), and the agent's files when absent (exclusive create, never
//      overwritten): Wright's memory files, or a crew member's files
//      re-created from its charter (`ensureAgentFiles`);
//   b. the settings (`readWrightSettings`, or `readAgentSettings` for a crew
//      member, its `never` added to the policy): no model ⇒ row `failed`
//      (`model_unset`), event done, no session; a `workspace` on the message
//      not in the settings `workspaces` ⇒ `workspace_not_listed`, the same;
//   c. the context (`buildContext`, the agent's own memory);
//   d. `runStepAsync("start-session")`: start a session, or resume the task's
//      latest session of the agent when it is `interrupted`; the cwd is the
//      workspace, else the agent's memory folder; the row becomes `running`
//      with its `session_id`;
//   e. a listener on `handle.result` (not awaited) writes the reply
//      (`replied`), or `failed` with the session's ending.
// An admission refusal parks the row (`parked`, the reason and retry time)
// and is rethrown, so the loop parks the event (phase 1 park rules). Any
// other refusal fails the row and is rethrown (the loop fails the event, with
// one notify). A redelivery that finds its row `running` with the session the
// session manager still reports live (`sessionStillLive`) never fails the row
// on a fault before step d (a throw is still rethrown), so that session's
// reply is kept; a row whose session is gone fails as above.
//
// Reply-back: a delegation (a row with `from_agent` set and no `reply_to`)
// that ends `replied` or `failed` through this handler queues ONE `message`
// back to its sender (`replyBack`: the reply, or the failure), in the same
// transaction as the final row write, and only when that write moved the row;
// a work step keyed on the row makes it once per row. A reply is never
// replied to.
//
// A message whose payload carries `playbook` is a playbook's run, not a
// message: it goes to `handlePlaybookMessage` (`../playbooks/runs.ts`) before
// anything above, and writes no `brain_messages` row (its record is the
// `playbook_runs` row).
//
// Imports only types from the loop and the session manager (never the
// manager itself or the Agent SDK: the `studio` CLI loads this module); its
// runtime imports beyond its siblings are `node:*`, the playbook runs, the
// agents feature's SDK-free leaves (registry, settings, charter files,
// memory), `../loop/queue.js` and `../loop/steps.js`.
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { ensureAgentFiles } from "../agents/charter-files.js";
import { agentMemoryDir } from "../agents/memory.js";
import { getAgent } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import type { AgentSettingsRefusal } from "../agents/settings.js";
import type { LoomwrightAdapterStatus } from "../loomwright/active-install.js";
import { enqueueEvent } from "../loop/queue.js";
import { runStep } from "../loop/steps.js";
import type { EventContext, EventHandler, EventSessions } from "../loop/types.js";
import type { AllowedPermissionMode, SessionHandle, SessionStatus, ToolPolicy } from "../sessions/types.js";
import { handlePlaybookMessage } from "../playbooks/runs.js";
import type { Store } from "../store/store.js";
import { MAX_MESSAGE_CHARS, buildContext, loomwrightSummaryOf } from "./context.js";
import type { LoomwrightSummary } from "./context.js";
import { cutChars, ensureMemoryFiles, wrightMemoryDir } from "./memory.js";
import { FINAL_MESSAGE_STATUSES, ensureBrainMessage, messageFieldsOf, messageSourceOf, updateBrainMessage } from "./messages.js";
import type { BrainMessageRow, BrainMessageStatus } from "./messages.js";
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

/**
 * Whether the session manager reports the session live (`starting` or
 * `running`). Never inferred from the message row: an absent session,
 * `interrupted`, `orphaned` or a terminal status is not live. The two
 * literals are compared inline, so nothing is imported from the session layer
 * at runtime.
 */
function sessionStillLive(sessions: EventSessions | undefined, sessionId: number | null): boolean {
  if (sessionId === null || sessions === undefined) return false;
  const status = sessions.getSession(sessionId)?.status;
  return status === "starting" || status === "running";
}

/** The task's latest session of `agent`, when it is `interrupted` (resumable): its id. */
export function interruptedAgentSession(store: Store, agent: string, taskId: number | null): number | undefined {
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

/** A final write: `replied` with the reply, or `failed` with the reason. */
type FinalWrite = { readonly status: "replied"; readonly replyText: string; readonly sessionId?: number } | { readonly status: "failed"; readonly detail: string; readonly sessionId?: number };

/**
 * Queue the one answer to delegation `row` for its sender: a `message` event
 * `{agent: from_agent, text, from_agent: agent, depth, reply_to: id}`, the
 * text the reply (`(empty reply)` for an empty one) or `Delegation to <agent>
 * failed: <detail>`, cut to `MAX_MESSAGE_CHARS`. `enqueueEvent`, not
 * `enqueueMessage`, which refuses blank text. One work step keyed on the row,
 * so a redelivery or a repeated refusal never queues a second one.
 */
function replyBack(store: Store, row: BrainMessageRow, outcome: FinalWrite, sessionId: number | null, at: Date): void {
  const text = outcome.status === "replied" ? (outcome.replyText === "" ? "(empty reply)" : outcome.replyText) : `Delegation to ${row.agent} failed: ${outcome.detail}`;
  runStep(
    store,
    `brain:reply-back:${row.id}`,
    () => {
      const payload = { agent: row.from_agent, text: cutChars(text, MAX_MESSAGE_CHARS), from_agent: row.agent, depth: row.depth, reply_to: row.id };
      return { queue_id: enqueueEvent(store, { kind: "message", payload, sessionId }, at).id };
    },
    { now: () => at },
  );
}

/**
 * Move `row` to its final state and, for a delegation (`from_agent` set, not
 * itself a reply: `reply_to === null`), queue its reply-back, in ONE
 * transaction: a crash never leaves a delegation final without its reply
 * queued. The reply-back runs only when the write moved the row.
 */
function finish(store: Store, row: BrainMessageRow, from: readonly BrainMessageStatus[], to: FinalWrite, at: Date): void {
  store.transaction(() => {
    if (!updateBrainMessage(store, row.id, from, to, at)) return;
    if (row.from_agent !== null && row.reply_to === null) replyBack(store, row, to, to.sessionId ?? row.session_id, at);
  });
}

/**
 * Write the reply when the session ends. Never awaited and never throws: the
 * store may be closed by then (the kernel stopped), and the reply is then lost
 * (the row stays `running`; documented as an honest limit).
 */
function attachReply(store: Store, row: BrainMessageRow, handle: SessionHandle, now: () => Date): void {
  void Promise.all([handle.done, handle.result])
    .then(([status, reply]) => {
      finish(store, row, ["running"], { ...endingOf(status, reply), sessionId: handle.id }, now());
    })
    .catch(() => {
      // The store is closed or the write failed: nothing else to do.
    });
}

/** What a session of the agent starts with, once its files and settings are read. */
interface AgentSession {
  readonly model: string;
  readonly permissionMode: AllowedPermissionMode;
  readonly policy: ToolPolicy;
  /** The agent's memory folder: the cwd when the message names no workspace. */
  readonly memoryCwd: string;
  /** The settings `workspaces` (none for Wright). */
  readonly workspaces: readonly string[];
}

/**
 * `workspace` as the folder it names, when it is one of `workspaces`: both
 * sides `resolve`d (`.`, `..` and a trailing `/` normalised), and absolute.
 * Undefined when it is not listed.
 */
export function listedWorkspace(workspaces: readonly string[], workspace: string): string | undefined {
  if (!isAbsolute(workspace)) return undefined;
  const wanted = resolve(workspace);
  return workspaces.some((w) => resolve(w) === wanted) ? wanted : undefined;
}

/** A settings refusal as a row's detail, naming the agent's file. */
function settingsRefusalDetail(r: AgentSettingsRefusal): string {
  switch (r.error) {
    case "model_unset":
      return `model_unset: set "model" in ${r.file}`;
    case "settings_invalid":
      return `settings_invalid: ${r.message}`;
    case "settings_missing":
      return `settings_missing: ${r.message}`;
    case "agent_id_invalid":
      return `no_such_agent: ${r.message}`;
  }
}

/**
 * Whether `ensureAgentFiles` threw because the member's `role.md` is absent
 * (it never creates one when something, such as a dangling symlink, is at the
 * path, and `ensureAgentMemoryFiles` then reports `charter_missing`, which
 * `writeCharterFiles` throws as a plain Error). Told by that exact message
 * (no filesystem `code`) and `role.md` still absent, so a real write error
 * (which carries a `code`) stays `memory_unwritable`. `ensureAgentFiles`
 * returning `ok` means `role.md` was present at its own check, so this is the
 * one place `charter_missing` is decided.
 */
function isCharterMissing(err: unknown, agent: string, role: string): boolean {
  if (!(err instanceof Error) || (err as { code?: unknown }).code !== undefined) return false;
  return err.message === `memory files for ${agent}: charter_missing (${role})` && !existsSync(role);
}

/**
 * A crew member's session settings, or undefined once `fail` has failed the
 * row with the refusal: `no_such_agent`, `agent_off`, the files' own refusal
 * (`charter_invalid`), `charter_missing` (`role.md` absent: a refusal, the
 * event done), or a settings refusal. A write error fails the row
 * (`memory_unwritable`, `settings_unwritable`) and is rethrown.
 */
function crewSession(store: Store, agent: string, fail: (detail: string) => void): AgentSession | undefined {
  const dataDir = store.dataDir;
  const member = getAgent(store, agent);
  if (member === undefined) {
    fail(`no_such_agent: no agent ${JSON.stringify(agent)} (neither wright nor a registered crew member)`);
    return undefined;
  }
  if (member.status !== "active") {
    fail(`agent_off: ${agent} is off: it takes no messages`);
    return undefined;
  }
  const role = join(agentMemoryDir(dataDir, agent), "role.md");
  let files;
  try {
    files = ensureAgentFiles(store, dataDir, agent);
  } catch (err) {
    if (isCharterMissing(err, agent, role)) {
      fail(`charter_missing: ${role}`);
      return undefined;
    }
    fail(`memory_unwritable: ${messageOf(err)}`);
    throw err;
  }
  if (!files.ok) {
    fail(files.error === "charter_invalid" ? `charter_invalid: ${files.message}` : `no_such_agent: ${files.message}`);
    return undefined;
  }
  let settings;
  try {
    settings = readAgentSettings(dataDir, agent);
  } catch (err) {
    fail(`settings_unwritable: ${messageOf(err)}`);
    throw err;
  }
  if (!settings.ok) {
    fail(settingsRefusalDetail(settings));
    return undefined;
  }
  const s = settings.settings;
  return {
    model: s.model,
    permissionMode: s.permissionMode,
    policy: { ...s.policy, ...(s.never ? { never: s.never } : {}) },
    memoryCwd: agentMemoryDir(dataDir, agent),
    workspaces: s.workspaces ?? [],
  };
}

/** The brain's `message` handler (see the module comment). `deps` replace the clock, zone and Loomwright reader in tests. */
export function brainMessageHandler(deps: BrainHandlerDeps = {}): EventHandler {
  const now = deps.now ?? (() => new Date());
  const timeZone = deps.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const loomwright = deps.loomwright ?? defaultLoomwright;

  return async (ctx: EventContext): Promise<void> => {
    // A playbook's message: its run (no `brain_messages` row).
    if (ctx.event.payload.playbook !== undefined) return handlePlaybookMessage(ctx, { now, timeZone, loomwright });
    const { event, store } = ctx;
    const agent = event.payload.agent;
    if (typeof agent !== "string") return;
    const text = typeof event.payload.text === "string" ? event.payload.text : "";

    // a. The row (idempotent on queue_id, with the phase 4 fields), then the agent's files.
    const fields = messageFieldsOf(store, event.payload);
    const row = ensureBrainMessage(store, { queueId: event.id, agent, source: messageSourceOf(event.payload), text, ...fields }, now());
    if (FINAL_MESSAGE_STATUSES.includes(row.status)) return;
    // A redelivery that found the row `running` with its session still live
    // writes nothing: that session's listener writes the reply (only from
    // `running`). The caller still throws or returns as it would. A
    // delegation's failure queues its reply-back with the failed row.
    const fail = (detail: string): void => {
      if (row.status === "running" && sessionStillLive(ctx.sessions, row.session_id)) return;
      finish(store, row, ["queued", "parked", "running"], { status: "failed", detail }, now());
    };
    const dataDir = store.dataDir;
    let session: AgentSession;
    if (agent === "wright") {
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
      const { model, permissionMode, policy } = settings.settings;
      session = { model, permissionMode, policy, memoryCwd: wrightMemoryDir(dataDir), workspaces: [] };
    } else {
      // A crew member: routed only when registered and `active`; its own files and settings (steps a and b).
      const crew = crewSession(store, agent, fail);
      if (crew === undefined) return;
      session = crew;
    }
    // The message's workspace, when it names one, must be listed in the agent's settings.
    let cwd = session.memoryCwd;
    if (row.workspace !== null) {
      const listed = listedWorkspace(session.workspaces, row.workspace);
      if (listed === undefined) {
        fail(`workspace_not_listed: ${JSON.stringify(row.workspace)} is not one of ${agent}'s settings workspaces`);
        return;
      }
      cwd = listed;
    }
    const sessions = ctx.sessions;
    if (sessions === undefined) {
      fail("no_session_manager: this kernel composition gives handlers no session manager");
      return;
    }

    // c. The context.
    const prompt = buildContext({ dataDir, agent, source: row.source, text: row.text, loomwright: loomwright(sessions), now: now(), timeZone: timeZone() });

    // d. Start (or resume) the session: the step's first effect, so an admission refusal leaves nothing to repeat.
    const { model, permissionMode, policy } = session;
    let handle: SessionHandle | undefined;
    let started: { session_id: number };
    try {
      started = await ctx.runStepAsync("start-session", async () => {
        const resumeId = interruptedAgentSession(store, agent, event.taskId);
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
    if (handle !== undefined) attachReply(store, row, handle, now);
  };
}
