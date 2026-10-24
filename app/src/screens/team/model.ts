// Team's view model (phase 5 item 14): the roster, the per-agent details and
// the brain's messages and approvals, turned into what a card and the
// inspector show. Plain TypeScript: no React, no DOM.
//
// Every string here can come from the kernel, and so from a model, a person or
// a charter: it is untrusted data (invariant 3). Nothing in this file builds
// markup; the components render each value as a React text child.
//
// The vocabularies the New crew member form offers (shapes, hues, permission
// modes, never categories) mirror the kernel's own lists. The app never
// imports kernel code, so `team.test.tsx` reads each kernel list as text and
// pins these copies to it.
import type {
  AgentCreateBody,
  AgentDetailResponse,
  AgentSetField,
  ApiResult,
  Approval,
  BrainMessage,
  RosterEntry,
  SessionSummary,
  WrightSetField,
} from "../../api/contract";
import { isLive } from "../sessions/model";

/** The lead agent's id: listed first, never a crew member (`GET /agents/wright` answers `409 reserved`). */
export const WRIGHT_ID = "wright";

/** Mirrors the kernel's `AVATAR_SHAPES` (`kernel/src/agents/types.ts`): the creatures a charter may pick. */
export const AVATAR_SHAPES: readonly string[] = Object.freeze(["shark", "seahorse", "octopus", "turtle", "jellyfish", "fish", "crab"]);

/** Mirrors the kernel's `AVATAR_HUES` (`kernel/src/agents/types.ts`): the crew identity hues, as the wire sends them. */
export const AVATAR_HUES: readonly string[] = Object.freeze(["crew-teal", "crew-sky", "crew-berry", "crew-olive", "crew-slate"]);

/** Mirrors the keys of the charter validator's `PERMISSION_MODES` (`kernel/src/agents/charter-files.ts`). */
export const PERMISSION_MODES: readonly string[] = Object.freeze(["default", "acceptEdits", "plan", "dontAsk", "auto"]);

/** Mirrors the kernel's `NEVER_CATEGORIES` (`kernel/src/sessions/policy.ts`): what a crew member may never do, enforced. */
export const NEVER_CATEGORIES: readonly string[] = Object.freeze([
  "git_push",
  "alias_define",
  "gh_pr_create",
  "gh_pr_comment",
  "gh_pr_review",
  "gh_pr_edit",
  "gh_pr_close",
  "gh_issue_create",
  "gh_issue_comment",
  "gh_issue_edit",
  "gh_issue_close",
  "gh_api_write",
  "settings_write",
  "hooks_write",
]);

/** The scalar fields `POST /agents/:id/set` takes for a crew member (the contract's `AgentSetField`). */
export const CREW_SET_FIELDS: readonly AgentSetField[] = Object.freeze([
  "model",
  "effort",
  "permission_mode",
  "limits.tokens_per_day",
  "limits.sessions_at_once",
  "limits.delegation_depth",
]);

/**
 * The fields `POST /agents/wright/set` takes (item 07, the contract's
 * `WrightSetField`). `permission_mode`, `tool_policy` and every other Wright
 * field stay the owner's hand edit of `wright.json`: never offered here.
 */
export const WRIGHT_SET_FIELDS: readonly WrightSetField[] = Object.freeze([
  "model",
  "effort",
  "limits.tokens_per_day",
  "limits.sessions_at_once",
  "limits.delegation_depth",
]);

/** The value `set` reads as "clear" (effort, or a limit: no limit). */
export const CLEAR_VALUE = "none";

/** A set field in words. */
export const FIELD_LABELS: Readonly<Record<AgentSetField, string>> = {
  model: "Model",
  effort: "Effort",
  permission_mode: "Permission mode",
  "limits.tokens_per_day": "Tokens per day",
  "limits.sessions_at_once": "Sessions at once",
  "limits.delegation_depth": "Delegation depth",
};

export function isWright(agent: { readonly id: string }): boolean {
  return agent.id === WRIGHT_ID;
}

/** The roster in card order: Wright first (the whale), then every crew member in the kernel's order. */
export function orderRoster(agents: readonly RosterEntry[]): RosterEntry[] {
  const wright = agents.filter(isWright);
  const crew = agents.filter((a) => !isWright(a));
  return [...wright, ...crew];
}

/** The crew members' ids (everyone but Wright), in roster order: the agents whose details are fetched. */
export function crewIds(agents: readonly RosterEntry[]): string[] {
  return agents.filter((a) => !isWright(a)).map((a) => a.id);
}

/** The key two display names collide on: the same words, ignoring case and surrounding whitespace. */
const nameKey = (a: { readonly display_name: string }): string => a.display_name.trim().toLowerCase();

/**
 * The ids of every roster entry (Wright included) whose display name collides
 * with another entry's (`nameKey`): the agents a screen shows with their id, so
 * two members of the same name can be told apart.
 */
export function sharedNames(agents: readonly { readonly id: string; readonly display_name: string }[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const a of agents) counts.set(nameKey(a), (counts.get(nameKey(a)) ?? 0) + 1);
  return new Set(agents.filter((a) => (counts.get(nameKey(a)) ?? 0) > 1).map((a) => a.id));
}

// ---- The task line ------------------------------------------------------------------

/** `unknown`: the approvals, messages or sessions it is read from have not answered (loading) or were refused. */
export type TaskState = "waiting" | "working" | "idle" | "unknown";

export interface TaskLine {
  readonly state: TaskState;
  readonly text: string;
}

/** The task line's words when its sources have not been read: loading, or refused. */
export const TASK_LOADING = "checking status…";
export const TASK_UNAVAILABLE = "status unavailable";

/**
 * The card's current-task line, in the mockup's `renderTeam` order: a pending
 * approval the agent requested ("Waiting on you · <display or action>"), else,
 * when the agent has a live session (`isLive`: starting or running), the text
 * of its running brain message on one of those sessions ("Session <id>
 * running" when none names one), else "idle". The newest of each wins.
 *
 * Working and idle come from the sessions, never from a message's status
 * alone: the kernel can leave a brain message `running` after its session
 * ended (a reply that was never written back), and that row must not read as
 * work. `GET /sessions` answers its newest rows only (50 by default); a live
 * session is among the newest in practice, so an older one is not looked for.
 *
 * A list is `undefined` when it was not read (loading or refused). A state is
 * shown only when the lists it depends on were read: waiting needs the
 * approvals; working and idle need all three (a pending approval outranks a
 * running message). Otherwise the line is `unknown` with `unread` as its
 * words, never "idle".
 */
export function taskLineFor(
  agentId: string,
  approvals: readonly Approval[] | undefined,
  messages: readonly BrainMessage[] | undefined,
  sessions: readonly SessionSummary[] | undefined,
  unread: string = TASK_UNAVAILABLE,
): TaskLine {
  if (approvals !== undefined) {
    const pending = approvals.filter((a) => a.status === "pending" && a.requesting_agent === agentId);
    const approval = pending.reduce<Approval | undefined>((newest, a) => (newest === undefined || a.id > newest.id ? a : newest), undefined);
    if (approval !== undefined) {
      const what = typeof approval.display === "string" && approval.display.trim() !== "" ? approval.display : approval.action;
      return { state: "waiting", text: `Waiting on you · ${what}` };
    }
  }
  if (approvals === undefined || messages === undefined || sessions === undefined) return { state: "unknown", text: unread };
  const live = sessions.filter((s) => s.agent === agentId && isLive(s.status));
  const newestLive = live.reduce<SessionSummary | undefined>((newest, s) => (newest === undefined || s.id > newest.id ? s : newest), undefined);
  if (newestLive === undefined) return { state: "idle", text: "idle" };
  const liveIds = new Set(live.map((s) => s.id));
  const running = messages.filter((m) => m.status === "running" && m.agent === agentId && m.session_id !== null && liveIds.has(m.session_id));
  const message = running.reduce<BrainMessage | undefined>((newest, m) => (newest === undefined || m.id > newest.id ? m : newest), undefined);
  if (message !== undefined) return { state: "working", text: message.text };
  return { state: "working", text: `Session ${newestLive.id} running` };
}

// ---- Limits -----------------------------------------------------------------------------

/** "no limit" for an unset limit; the words are the honest form of `null`, never a zero. */
export const NO_LIMIT = "no limit";

/**
 * "unknown" for a setting whose source was not read (the settings file did not
 * read ok, the detail was refused or is still loading): never "no limit" or
 * "not set", which would state a value the kernel may be enforcing otherwise.
 */
export const UNKNOWN = "unknown";

/**
 * The settings reader's refusal when the file parsed and validated and only its
 * `model` is missing (`kernel/src/agents/settings.ts`): every other value in
 * the file was read.
 */
export const MODEL_UNSET = "model_unset";

/**
 * Whether the roster's limits come from a settings file the kernel read. The
 * kernel sends `null` for both an unset limit and an unread file, so
 * `settings_error` is what tells them apart: null (read ok, or Wright with no
 * `wright.json` yet) reads them. So does Wright's `model_unset`: the kernel's
 * `wrightEntry` sends that file's limits (`kernel/src/agents/roster.ts`). A
 * crew member's `model_unset` does not: its `memberEntry` sends null limits
 * for any refusal, so they are unknown.
 */
export function settingsRead(agent: { readonly id: string; readonly settings_error: string | null }): boolean {
  return agent.settings_error === null || (isWright(agent) && agent.settings_error === MODEL_UNSET);
}

/** Sessions in words: "1 of 2 sessions", "1 session · no limit", or "1 session · limit unknown" when the settings file did not read ok. */
export function sessionsText(running: number, atOnce: number | null, read = true): string {
  if (atOnce === null) return `${running} ${running === 1 ? "session" : "sessions"} · ${read ? NO_LIMIT : `limit ${UNKNOWN}`}`;
  return `${running} of ${atOnce} ${atOnce === 1 ? "session" : "sessions"}`;
}

/** A roster entry's sessions against its limit, honest about an unread settings file. */
export function agentSessionsText(agent: RosterEntry): string {
  return sessionsText(agent.sessions_running, agent.sessions_at_once, settingsRead(agent));
}

/** The words after today's tokens when there is no daily number: "no limit", or "limit unknown" when the settings file did not read ok. */
export function tokensLimitWords(agent: RosterEntry): string {
  return settingsRead(agent) ? NO_LIMIT : `limit ${UNKNOWN}`;
}

/**
 * A roster entry's model: the model; "not set" when the file read ok without
 * one (or Wright has no file yet) or the reader refused it `model_unset` (the
 * file has no usable model, for Wright and a crew member alike); "unknown" when
 * any other refusal left the file unread.
 */
export function rosterModel(agent: RosterEntry): string {
  if (agent.model !== null) return agent.model;
  return agent.settings_error === null || agent.settings_error === MODEL_UNSET ? "not set" : UNKNOWN;
}

// ---- Details (GET /agents/:id) ------------------------------------------------------------

/** A crew member's charter prose, read defensively (`AgentDetailResponse.charter` is `unknown`). */
export interface CharterProse {
  readonly persona: string | null;
  /** Null when the charter holds something other than a list of strings: not read, never "none". */
  readonly duties: readonly string[] | null;
  readonly boundaries: readonly string[] | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

/** A charter list: empty when absent (the kernel sends `null`), null when it holds anything but strings. */
function proseList(value: unknown): string[] | null {
  return value === undefined || value === null ? [] : stringList(value);
}

/** The charter prose from a detail body; null when `charter` is null or not an object. */
export function charterProse(detail: AgentDetailResponse): CharterProse | null {
  const c = detail.charter;
  if (!isRecord(c)) return null;
  return {
    persona: typeof c.persona === "string" ? c.persona : null,
    duties: proseList(c.duties),
    boundaries: proseList(c.boundaries),
  };
}

/** The role a card shows: Wright is the lead agent; a crew member's role is its charter persona. */
export function roleOf(agent: RosterEntry, detail: AgentDetailResponse | undefined): string | undefined {
  if (isWright(agent)) return "Lead agent";
  if (detail === undefined) return undefined;
  return charterProse(detail)?.persona ?? undefined;
}

/** The enforced tool policy read from the settings file's parsed content. */
export interface EnforcedToolPolicy {
  readonly allowedTools: readonly string[];
  readonly allowedBashPrefixes: readonly string[];
}

/**
 * The settings content the inspector may show values from: `content` only when
 * the kernel's reader accepted the file (`settings.error === null`). The
 * kernel sends `content` as the raw `JSON.parse` of the file, apart from its
 * validation, so a file it refused (an unknown key, a bad workspace,
 * `model_unset`) still arrives as a record: none of its values is applied, so
 * none is shown.
 */
export function acceptedSettings(detail: AgentDetailResponse): unknown {
  return detail.settings.error === null ? detail.settings.content : undefined;
}

/**
 * `settings.content.tool_policy`, the parsed `config/agents/<id>.json` the
 * kernel's `renderAgentSettingsJson` writes. `content` is `unknown`, so it is
 * read defensively: null when it is null, not an object, or its tool policy is
 * not two string lists.
 */
export function enforcedToolPolicy(content: unknown): EnforcedToolPolicy | null {
  if (!isRecord(content) || !isRecord(content.tool_policy)) return null;
  const allowedTools = stringList(content.tool_policy.allowedTools);
  const allowedBashPrefixes = stringList(content.tool_policy.allowedBashPrefixes);
  if (allowedTools === null || allowedBashPrefixes === null) return null;
  return { allowedTools, allowedBashPrefixes };
}

/** A scalar setting from the settings file's content, as text; undefined when absent or not a scalar. */
export function settingValue(content: unknown, field: AgentSetField): string | undefined {
  if (!isRecord(content)) return undefined;
  const raw = field.startsWith("limits.") ? (isRecord(content.limits) ? content.limits[field.slice("limits.".length)] : undefined) : content[field];
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
}

/**
 * A setting as the inspector shows it: the value; `absent` only when the
 * content is a readable record and the field (or its `limits` block) is
 * missing or null; `UNKNOWN` when the content was not read (null, not an
 * object) or the field holds something other than a scalar. An unread file is
 * never shown as "no limit" or "not set".
 */
export function settingText(content: unknown, field: AgentSetField, absent: string): string {
  if (!isRecord(content)) return UNKNOWN;
  const value = settingValue(content, field);
  if (value !== undefined) return value;
  let raw: unknown;
  if (field.startsWith("limits.")) {
    if (content.limits === undefined || content.limits === null) return absent;
    if (!isRecord(content.limits)) return UNKNOWN;
    raw = content.limits[field.slice("limits.".length)];
  } else {
    raw = content[field];
  }
  return raw === undefined || raw === null ? absent : UNKNOWN;
}

// ---- Refusals ------------------------------------------------------------------------------

/** One call's outcome, as Team shows it: the body, or a refusal in words (never markup). */
export type CallOutcome<R> = { readonly ok: true; readonly status: number; readonly body: R } | { readonly ok: false; readonly message: string; readonly field?: string };

/** The bridge's answer as a `CallOutcome`: a refusal's `error`, `field` and `message`, or the connection state. */
export function outcomeOf<R>(result: ApiResult<R> | undefined): CallOutcome<R> {
  if (result === undefined) return { ok: false, message: "The request did not reach the kernel." };
  if (result.ok) return { ok: true, status: result.status, body: result.body };
  if ("connection" in result) {
    const c = result.connection;
    return { ok: false, message: c.state === "not_installed" ? "The kernel isn't installed." : `Couldn't reach the kernel (${c.reason}).` };
  }
  const body = result.body as { readonly error?: unknown; readonly message?: unknown; readonly field?: unknown; readonly file?: unknown };
  const error = typeof body.error === "string" ? body.error : `HTTP ${result.status}`;
  const message = typeof body.message === "string" && body.message !== "" ? `${error}: ${body.message}` : error;
  const field = typeof body.field === "string" ? body.field : typeof body.file === "string" ? body.file : undefined;
  return field === undefined ? { ok: false, message } : { ok: false, message, field };
}

// ---- The New crew member form -> a charter -------------------------------------------------

/** The form as typed. Every field starts empty: no presets (invariant 9). */
export interface CharterForm {
  readonly id: string;
  readonly displayName: string;
  readonly shape: string;
  readonly hue: string;
  readonly persona: string;
  /** One duty per line. */
  readonly duties: string;
  /** One boundary per line (guidance, not enforced). */
  readonly boundaries: string;
  readonly model: string;
  readonly effort: string;
  readonly permissionMode: string;
  /** Tool names, separated by commas, spaces or new lines. */
  readonly allowedTools: string;
  /** One Bash prefix per line. */
  readonly allowedBashPrefixes: string;
  readonly never: readonly string[];
  readonly tokensPerDay: string;
  readonly sessionsAtOnce: string;
  readonly delegationDepth: string;
  /** One absolute folder per line. */
  readonly workspaces: string;
}

export const EMPTY_FORM: CharterForm = Object.freeze({
  id: "",
  displayName: "",
  shape: "",
  hue: "",
  persona: "",
  duties: "",
  boundaries: "",
  model: "",
  effort: "",
  permissionMode: "",
  allowedTools: "",
  allowedBashPrefixes: "",
  never: Object.freeze([]) as readonly string[],
  tokensPerDay: "",
  sessionsAtOnce: "",
  delegationDepth: "",
  workspaces: "",
});

/** Non-blank lines, each trimmed. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** Tool names: split on commas and whitespace (a tool name has no whitespace). */
export function toolsOf(text: string): string[] {
  return text.split(/[\s,]+/).filter((t) => t !== "");
}

/**
 * A limit as typed: omitted when blank, a number when it is digits that a
 * double holds exactly (a safe integer), else the text, so the kernel sees
 * what was typed and refuses it, naming the field. Digits past 2^53 - 1 stay
 * text: `Number()` would round them to a different value.
 */
export function limitOf(text: string): number | string | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return /^\d+$/.test(t) && Number.isSafeInteger(n) ? n : t;
}

/**
 * The charter `POST /agents` takes, built from what the owner typed and
 * nothing else: the kernel's `validateCharter` is the one validator, and its
 * refusal (`field`, `message`) is shown as it comes. Blank effort and blank
 * limits are left out (unset: no limit); the kernel picks no value either.
 */
export function charterOf(form: CharterForm): AgentCreateBody {
  const limits: Record<string, number | string> = {};
  const tokens = limitOf(form.tokensPerDay);
  const sessions = limitOf(form.sessionsAtOnce);
  const depth = limitOf(form.delegationDepth);
  if (tokens !== undefined) limits.tokens_per_day = tokens;
  if (sessions !== undefined) limits.sessions_at_once = sessions;
  if (depth !== undefined) limits.delegation_depth = depth;
  const effort = form.effort.trim();
  return {
    id: form.id.trim(),
    display_name: form.displayName.trim(),
    avatar: { shape: form.shape, hue: form.hue },
    persona: linesOf(form.persona).join("\n"),
    duties: linesOf(form.duties),
    boundaries: linesOf(form.boundaries),
    model: form.model.trim(),
    ...(effort === "" ? {} : { effort }),
    permission_mode: form.permissionMode,
    tool_policy: { allowedTools: toolsOf(form.allowedTools), allowedBashPrefixes: linesOf(form.allowedBashPrefixes), never: [...form.never] },
    ...(Object.keys(limits).length === 0 ? {} : { limits }),
    workspaces: linesOf(form.workspaces),
  };
}

/** The `#/chat` route for an agent's thread. The shell routes on the first segment; the agent is the second. */
export function threadHash(agentId: string): string {
  return `#/chat/${encodeURIComponent(agentId)}`;
}
