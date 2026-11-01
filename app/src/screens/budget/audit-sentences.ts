// The audit log's Detail column as sentences (phase 7 item 17): one table, one entry per event kind the
// kernel writes, each a function `(payload, refs) => string`. `audit-sentences.test.ts` scans `kernel/src`
// for every kind the kernel writes and fails when one has no entry here.
//
// A payload is untrusted data (invariant 3). Every field is read defensively (a missing or odd field
// drops its phrase, it never throws and never shows `undefined`), and every value is made inert text
// by `safe` and clipped: nothing here builds markup, and no JSON object is ever rendered. An unknown kind
// reads as its name, a middle dot and the words in `NO_DESCRIPTION`.
//
// The sentences state what the event records and nothing the kernel does not know. Policy is the
// owner's per playbook (invariant 1), so no sentence says what a playbook "usually" does, and no
// sentence carries a dollar figure (D24).
import { safe } from "../schedules/model";

/** What a sentence may need beyond its payload: the event's own refs and the screen's name lookups. */
export interface SentenceRefs {
  readonly taskId: number | null;
  readonly sessionId: number | null;
  /** A playbook's name for a slug or a numeric id, when the screen knows it. */
  readonly playbook: (value: unknown) => string | undefined;
  /** An agent's display name for its id (the id itself when the roster has none). */
  readonly agent: (id: string) => string;
  /** An ISO instant as the screen writes times ("today 17:00"). */
  readonly time: (iso: string) => string;
}

export type Sentence = (payload: unknown, refs: SentenceRefs) => string;

const MAX_TEXT = 100;
const TOKENS = new Intl.NumberFormat("en-US");

function fields(payload: unknown): Readonly<Record<string, unknown>> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Readonly<Record<string, unknown>>) : {};
}

function clip(text: string, max: number = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A string or a number as inert text; anything else (null, an object, an array, a boolean) is `undefined`. */
function plain(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : clip(safe(value));
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** A code as words: `agent_sessions_at_once` reads "agent sessions at once". */
function words(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.replaceAll("_", " ");
}

/** A list of plain values as "a, b, c" (at most five), or `undefined`. */
function listed(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = (value as unknown[]).map(plain).filter((s): s is string => s !== undefined);
  if (items.length === 0) return undefined;
  return items.length > 5 ? `${items.slice(0, 5).join(", ")} and ${items.length - 5} more` : items.join(", ");
}

/** A whole number with thousands separators, or `undefined`. */
function amount(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? TOKENS.format(value) : undefined;
}

/** A field reader for one payload. */
function reader(payload: unknown): (key: string) => string | undefined {
  const f = fields(payload);
  return (key) => plain(f[key]);
}

const sessionNo = (r: SentenceRefs): string => (r.sessionId === null ? "A session" : `Session ${r.sessionId}`);
const taskNo = (r: SentenceRefs): string => (r.taskId === null ? "A task" : `Task ${r.taskId}`);
const withText = (text: string | undefined, lead: string): string => (text === undefined ? "" : `${lead}${text}`);
const forOf = (name: string | undefined): string => (name === undefined ? "" : ` for ${name}`);
const paren = (text: string | undefined): string => (text === undefined ? "" : ` (${text})`);
const forAgent = (r: SentenceRefs, id: string | undefined): string => (id === undefined ? "" : ` for ${r.agent(id)}`);
/** "Approval 7" when the payload names its id, else "An approval" / "A standing approval". */
const numbered = (noun: string, id: string | undefined): string =>
  id === undefined ? `${/^[aeiou]/.test(noun) ? "An" : "A"} ${noun}` : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${id}`;
const agentOf = (r: SentenceRefs, id: string | undefined, fallback: string): string => (id === undefined ? fallback : r.agent(id));

/** The playbook an event names, by `playbook` (a slug) or `playbook_id` (a number), else its slug field. */
function playbookOf(payload: unknown, r: SentenceRefs): string | undefined {
  const f = fields(payload);
  const named = r.playbook(f.playbook) ?? r.playbook(f.playbook_id);
  if (named !== undefined) return clip(safe(named));
  return plain(f.slug) ?? plain(f.playbook) ?? (typeof f.playbook_id === "number" ? `#${f.playbook_id}` : undefined);
}

function timeOf(value: unknown, r: SentenceRefs): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? clip(safe(r.time(value))) : undefined;
}

/** A utilization the kernel reports as a fraction (0.83) or a percent (83), as "83%". */
function percentOf(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

const NO_DESCRIPTION = "no description yet";

/** The table: one entry per kind the kernel writes. */
export const AUDIT_SENTENCES: Readonly<Record<string, Sentence>> = {
  admission_refused: (p, r) => {
    const g = reader(p);
    return `A session ${g("kind") ?? "start"}${forAgent(r, g("agent"))} was refused: ${words(g("reason")) ?? "no reason recorded"}${withText(timeOf(fields(p).retry_at, r), ". Retry ")}.`;
  },
  agent_created: (p, r) => {
    const g = reader(p);
    return `${agentOf(r, g("id"), "An agent")} was created${withText(g("by"), " by ")}.`;
  },
  agent_message_queued: (p, r) => {
    const g = reader(p);
    return `${agentOf(r, g("from"), "An agent")} sent a message to ${agentOf(r, g("to"), "another agent")}.`;
  },
  agent_message_refused: (p, r) => {
    const g = reader(p);
    return `${agentOf(r, g("from"), "An agent")}'s message to ${agentOf(r, g("to"), "another agent")} was refused: ${words(g("reason")) ?? "no reason recorded"}.`;
  },
  agent_renamed: (p, r) => {
    const g = reader(p);
    return `${agentOf(r, g("id"), "An agent")} was renamed${withText(g("old"), " from ")}${withText(g("new"), " to ")}.`;
  },
  agent_settings_set: (p, r) => {
    const g = reader(p);
    return `${agentOf(r, g("id"), "An agent")}'s ${g("field") ?? "setting"} was changed${withText(g("old"), " from ")}${withText(g("new"), " to ")}${withText(g("by"), " by ")}.`;
  },
  agent_status_changed: (p, r) => {
    const g = reader(p);
    return `${agentOf(r, g("id"), "An agent")} went${withText(g("old"), " from ")}${withText(g("new"), " to ")}${withText(g("by"), " by ")}.`;
  },
  agent_updated: (p, r) => {
    const g = reader(p);
    return `${agentOf(r, g("id"), "An agent")} was updated${withText(listed(fields(p).fields), ": ")}${paren(withText(g("approval_id"), "approval "))}.`;
  },
  api_key_ceiling_reached: (p, r) => `Playbook ${playbookOf(p, r) ?? "unknown"} reached its API-key fallback ceiling.`,
  api_key_fallback_admitted: (p, r) => {
    const g = reader(p);
    return `A session ${g("kind") ?? "start"}${forAgent(r, g("agent"))} was admitted on the API-key fallback.`;
  },
  approval_decided: (p) => {
    const g = reader(p);
    return `${numbered("approval", g("id"))} was ${g("decision") ?? "decided"}${withText(g("by"), " by ")}${withText(g("action"), " · ")}.`;
  },
  approval_grant_revoked: (p) => {
    const g = reader(p);
    return `${numbered("standing approval", g("id"))} was revoked${withText(g("by"), " by ")}.`;
  },
  approval_grant_used: (p) => {
    const g = reader(p);
    return `${numbered("standing approval", g("id"))} was used${withText(g("tool"), " for ")}.`;
  },
  approval_requested: (p, r) => {
    const g = reader(p);
    const what = g("display") ?? g("action") ?? "an action";
    return `${agentOf(r, g("agent"), "An agent")} asked for approval to ${what}${paren(withText(g("id"), "approval "))}.`;
  },
  approval_used: (p) => {
    const g = reader(p);
    return `${numbered("approval", g("id"))} was used${withText(g("tool"), " for ")}.`;
  },
  budget_baseline_reset: (p) => {
    const g = reader(p);
    return `The usage baseline${withText(g("model"), " for ")} was reset${paren(words(g("reason")))}.`;
  },
  budget_limit_reached: (p, r) => {
    const g = reader(p);
    const f = fields(p);
    const limit = amount(f.limit);
    return `${agentOf(r, g("agent"), "An agent")} reached its daily limit${limit === undefined ? "" : ` of ${limit} tokens`}${withText(timeOf(f.retry_at, r), ". New sessions wait until ")}.`;
  },
  budget_usage_ignored: (p) => `A usage report was ignored: ${words(reader(p)("reason")) ?? "no reason recorded"}.`,
  cap_allowed_while_parked: (p) => {
    const g = reader(p);
    return `The ${g("rate_limit_type") ?? "cap"} window reported ${words(g("status")) ?? "a status"} while a park stands, so the park stays.`;
  },
  cap_event_ignored: (p) => {
    const g = reader(p);
    return `A rate-limit event was ignored: ${words(g("reason")) ?? "no reason recorded"}${paren(g("status"))}.`;
  },
  cap_park_merged: (p) => `A ${reader(p)("rate_limit_type") ?? "rate-limit"} rejection was merged into the text-fallback park.`,
  cap_park_superseded: (p, r) => {
    const f = fields(p);
    return `A ${plain(f.rate_limit_type) ?? "rate-limit"} rejection replaced the text-fallback park${withText(timeOf(f.resets_at, r), "; it resets ")}.`;
  },
  cap_rejected: (p, r) => {
    const f = fields(p);
    return `The ${plain(f.rate_limit_type) ?? "cap"} window was rejected${withText(timeOf(f.resets_at, r), "; it resets ")}${f.extended_from === undefined ? "" : " (extended)"}.`;
  },
  cap_text_fallback: (p, r) => `The cap was reached (read from a session's text)${withText(timeOf(fields(p).resets_at, r), "; recheck ")}.`,
  cap_transient: (p) => {
    const g = reader(p);
    return `A rate limit hit${paren(withText(g("attempt"), "attempt "))}; the session retries after a backoff.`;
  },
  cap_warning: (p, r) => {
    const f = fields(p);
    return `The ${plain(f.rate_limit_type) ?? "cap"} window is near its cap${withText(percentOf(f.utilization), " at ")}${withText(timeOf(f.resets_at, r), " · resets ")}.`;
  },
  connector_status: (p) => {
    const g = reader(p);
    return `The ${g("kind") ?? "connector"} connector is ${g("status") ?? "unknown"}${paren(withText(words(g("refused")), "refused: "))}.`;
  },
  draft_output_recorded: (p) => {
    const g = reader(p);
    const tool = g("tool");
    const summary = g("summary");
    // The kernel writes the summary as "<tool> <target>"; the target is what the draft was for.
    const target = summary === undefined ? undefined : tool !== undefined && summary.startsWith(tool) ? summary.slice(tool.length).trim() || undefined : summary;
    const noun = tool === undefined ? "output" : (words(tool.split(/\s+/).pop()) ?? tool);
    return `Draft ${noun} recorded${withText(target, " for ")}. Recorded, not sent.`;
  },
  due_work_failed: (p) => {
    const g = reader(p);
    return `Due work${withText(g("contributor"), " from ")} failed${withText(g("error"), ": ")}.`;
  },
  event_done: (p) => {
    const g = reader(p);
    return `The queued ${g("kind") ?? "event"}${withText(g("queue_id"), " #")} was handled.`;
  },
  event_enqueued: (p) => {
    const g = reader(p);
    return `A ${g("kind") ?? "new"} event was queued${paren(withText(g("queue_id"), "#"))}.`;
  },
  event_failed: (p) => {
    const g = reader(p);
    return `The queued ${g("kind") ?? "event"}${withText(g("queue_id"), " #")} failed${withText(g("error"), ": ")}.`;
  },
  event_parked: (p, r) => {
    const g = reader(p);
    return `The queued ${g("kind") ?? "event"}${withText(g("queue_id"), " #")} is parked${withText(words(g("reason")), ": ")}${withText(timeOf(fields(p).retry_at, r), ". Retry ")}.`;
  },
  event_unhandled: (p) => {
    const g = reader(p);
    return `The queued ${g("kind") ?? "event"}${withText(g("queue_id"), " #")} had no handler.`;
  },
  kill_switch_engaged: () => "The kill switch was engaged. No trigger fires while it is on.",
  kill_switch_released: () => "The kill switch was released.",
  loop_error: (p) => `The event loop hit an error${withText(reader(p)("error"), ": ")}.`,
  memory_updated: (p) => {
    const g = reader(p);
    return `${g("path") ?? "A memory file"} was updated${withText(g("by"), " by ")}.`;
  },
  notification_created: (p) => {
    const g = reader(p);
    return `Notification${withText(g("id"), " ")} was created${withText(g("source"), " by ")}.`;
  },
  notification_delivery_failed: (p) => {
    const g = reader(p);
    return `Notification${withText(g("id"), " ")} could not be delivered${withText(g("error"), ": ")}.`;
  },
  notify: (p) => `A notice was raised${withText(words(reader(p)("reason")), ": ")}.`,
  observer_error: (p) => `An observer failed${withText(reader(p)("error"), ": ")}.`,
  pause_engaged: (p) => {
    const g = reader(p);
    return `New work was paused${withText(g("by"), " by ")}${paren(g("via"))}.`;
  },
  pause_released: (p) => {
    const g = reader(p);
    return `New work was resumed${withText(g("by"), " by ")}${paren(g("via"))}.`;
  },
  playbook_created: (p, r) => {
    const g = reader(p);
    return `Playbook ${playbookOf(p, r) ?? "unknown"} was created${withText(g("by"), " by ")}.`;
  },
  playbook_disabled: (p, r) => {
    const g = reader(p);
    return `Playbook ${playbookOf(p, r) ?? "unknown"} was turned off${withText(g("by"), " by ")}.`;
  },
  playbook_dry_run: (p, r) => {
    const g = reader(p);
    return `Dry run of playbook ${playbookOf(p, r) ?? "unknown"}${withText(g("version"), " v")} ${g("status") ?? "was recorded"}.`;
  },
  playbook_enabled: (p, r) => {
    const g = reader(p);
    return `Playbook ${playbookOf(p, r) ?? "unknown"}${withText(g("version"), " v")} was turned on${withText(g("by"), " by ")}.`;
  },
  playbook_limit_reached: (p, r) => {
    const limit = amount(fields(p).limit);
    return `Playbook ${playbookOf(p, r) ?? "unknown"} reached its daily limit${limit === undefined ? "" : ` of ${limit} tokens`}.`;
  },
  playbook_updated: (p, r) => {
    const g = reader(p);
    return `Playbook ${playbookOf(p, r) ?? "unknown"} was updated${withText(g("version"), " to v")}${withText(listed(fields(p).fields), ": ")}${withText(g("by"), " by ")}.`;
  },
  poll_item_queued: (p) => {
    const g = reader(p);
    return `A poll found ${g("item_ref") ?? "an item"}${withText(g("revision"), " at ")} and queued a run for it.`;
  },
  poll_item_skipped: (p) => {
    const g = reader(p);
    return `A poll item${withText(g("item_ref"), " ")} was skipped: its dedupe key was already seen.`;
  },
  route_failed: (p) => {
    const g = reader(p);
    return `A route${withText(g("method"), " ")}${withText(g("path"), " ")}${withText(g("contributor"), " from ")} failed${withText(g("error"), ": ")}.`;
  },
  session_dry_run: (p, r) => `${sessionNo(r)} started as a dry run${fields(p).forceDraft === true ? " (drafts only)" : ""}.`,
  session_group_command_changed: (p, r) => `${sessionNo(r)}'s recorded process group${withText(reader(p)("pgid"), " ")} changed its command.`,
  session_group_kill_error: (p, r) => `Stopping a leftover process group${withText(reader(p)("pgid"), " ")} of ${sessionNo(r).toLowerCase()} failed${withText(reader(p)("error"), ": ")}.`,
  session_group_kill_incomplete: (p, r) => `A leftover process group${withText(reader(p)("pgid"), " ")} of ${sessionNo(r).toLowerCase()} is still running; the next reap retries.`,
  session_group_killed: (p, r) => `A leftover process group${withText(reader(p)("pgid"), " ")} of ${sessionNo(r).toLowerCase()} was stopped.`,
  session_group_recorded: (p, r) => `${sessionNo(r)} started a process group${withText(reader(p)("pgid"), " ")}.`,
  session_group_skipped: (p, r) => `A leftover process group${withText(reader(p)("pgid"), " ")} of ${sessionNo(r).toLowerCase()} was skipped: ${words(reader(p)("reason")) ?? "no reason recorded"}.`,
  session_id_changed: (_p, r) => `${sessionNo(r)}'s SDK session id changed.`,
  session_kill_error: (p, r) => `Stopping ${sessionNo(r).toLowerCase()}'s process group failed${withText(reader(p)("error"), ": ")}.`,
  session_kill_incomplete: (_p, r) => `${sessionNo(r)}'s process group did not stop before the deadline.`,
  session_kill_retried: (p, r) => `Stopping ${sessionNo(r).toLowerCase()}'s process group was retried${withText(words(reader(p)("reason")), ": ")}.`,
  session_output_appended: (p, r) => {
    const f = fields(p);
    const from = amount(f.from_seq);
    const to = amount(f.to_seq);
    if (from === undefined || to === undefined) return `${sessionNo(r)} wrote output.`;
    return `${sessionNo(r)} wrote output (${from === to ? `entry ${from}` : `entries ${from}–${to}`}).`;
  },
  session_reap_deferred: (p, r) => `${sessionNo(r)} could not be reaped yet${withText(words(reader(p)("reason")), ": ")}.`,
  session_refused: (p, r) => `${sessionNo(r)} was refused${withText(words(reader(p)("reason")), ": ")}.`,
  session_resume_failed: (p, r) => {
    const g = reader(p);
    return `Resuming ${sessionNo(r).toLowerCase()} failed${paren(withText(g("attempt"), "attempt "))}${withText(g("error"), ": ")}.`;
  },
  session_resume_refused: (p, r) => `Resuming ${sessionNo(r).toLowerCase()} was refused${withText(words(reader(p)("reason")), ": ")}.`,
  session_spawn_after_stop: (p, r) => `${sessionNo(r)} was started again after a stop${paren(withText(reader(p)("attempt"), "attempt "))}.`,
  session_status: (p, r) => {
    const g = reader(p);
    const to = g("to");
    const move = to === undefined ? "changed status" : g("from") === undefined ? `started as ${to}` : `went from ${g("from")} to ${to}`;
    return `${sessionNo(r)} ${move}${paren(words(g("reason")))}.`;
  },
  session_stop_requested: (p, r) => {
    const g = reader(p);
    return `${g("by") === "owner" ? "You" : (g("by") ?? "Someone")} asked ${sessionNo(r).toLowerCase()} to stop${paren(g("mode"))}.`;
  },
  stop_all_completed: (p) => {
    const sessions = fields(p).sessions;
    return Array.isArray(sessions) ? `Stop all finished for ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}.` : "Stop all finished.";
  },
  stop_failed: (p, r) => `Stopping ${sessionNo(r).toLowerCase()} failed${withText(reader(p)("error"), ": ")}.`,
  stop_requested: (_p, r) => `${sessionNo(r)} asked to stop and left a handoff.`,
  task_created: (p, r) => {
    const g = reader(p);
    return `${taskNo(r)} was created${withText(g("title"), ": ")}${withText(g("state"), " · state ")}.`;
  },
  task_updated: (p, r) => {
    const g = reader(p);
    return `${taskNo(r)} was updated${withText(listed(fields(p).fields), ": ")}${withText(g("state"), " · state ")}.`;
  },
  tool_decision: (p) => {
    const g = reader(p);
    const verdict = g("decision") === "allow" ? "allowed" : g("decision") === "deny" ? "denied" : "decided";
    return `${g("tool") ?? "A tool call"} was ${verdict}${paren(words(g("reason")))}.`;
  },
  trigger_fired: (p, r) => {
    const g = reader(p);
    const items = amount(fields(p).items);
    return `Trigger${withText(g("trigger_id"), " ")} fired${forOf(playbookOf(p, r))}${items === undefined ? "" : ` · ${items} ${items === "1" ? "item" : "items"} found`}.`;
  },
  trigger_missed: (p) => {
    const g = reader(p);
    return `Trigger${withText(g("trigger_id"), " ")} did not fire: ${words(g("reason")) ?? "no reason recorded"}.`;
  },
  trigger_registered: (p) => {
    const g = reader(p);
    return `Trigger${withText(g("trigger_id"), " ")} was registered${paren(g("kind"))}${withText(g("text"), ": ")}.`;
  },
  trigger_removed: (p) => {
    const g = reader(p);
    return `Trigger${withText(g("trigger_id"), " ")} was removed${withText(g("by"), " by ")}.`;
  },
  trigger_toggled: (p) => {
    const g = reader(p);
    const enabled = fields(p).enabled;
    return `Trigger${withText(g("trigger_id"), " ")} was turned ${enabled === true ? "on" : enabled === false ? "off" : "on or off"}${withText(g("by"), " by ")}.`;
  },
  trigger_updated: (p) => {
    const g = reader(p);
    return `Trigger${withText(g("trigger_id"), " ")} was updated${paren(g("kind"))}.`;
  },
  wakeup_scheduled: (p, r) => {
    const g = reader(p);
    return `Wake-up${withText(g("wakeup_id"), " #")} is due ${timeOf(fields(p).due_at, r) ?? "later"}${withText(g("reason"), ": ")}.`;
  },
};

/** The sentence for an event of `kind`; an unknown kind (or a sentence that cannot read its payload) reads "{kind} · {NO_DESCRIPTION}". */
export function auditSentence(kind: string, payload: unknown, refs: SentenceRefs): string {
  const entry = Object.hasOwn(AUDIT_SENTENCES, kind) ? AUDIT_SENTENCES[kind] : undefined;
  if (entry !== undefined) {
    try {
      return entry(payload, refs).replace(/\s+/g, " ").trim();
    } catch {
      // A payload no sentence can read is no worse than a kind without one.
    }
  }
  return `${safe(kind)} · ${NO_DESCRIPTION}`;
}
