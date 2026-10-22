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
  WrightSetField,
} from "../../api/contract";

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

// ---- The task line ------------------------------------------------------------------

export type TaskState = "waiting" | "working" | "idle";

export interface TaskLine {
  readonly state: TaskState;
  readonly text: string;
}

/**
 * The card's current-task line, in the mockup's `renderTeam` order: a pending
 * approval the agent requested ("Waiting on you · <display or action>"), else
 * its running brain message's text, else "idle". The newest of each wins.
 */
export function taskLineFor(agentId: string, approvals: readonly Approval[], messages: readonly BrainMessage[]): TaskLine {
  const pending = approvals.filter((a) => a.status === "pending" && a.requesting_agent === agentId);
  const approval = pending.reduce<Approval | undefined>((newest, a) => (newest === undefined || a.id > newest.id ? a : newest), undefined);
  if (approval !== undefined) {
    const what = typeof approval.display === "string" && approval.display.trim() !== "" ? approval.display : approval.action;
    return { state: "waiting", text: `Waiting on you · ${what}` };
  }
  const running = messages.filter((m) => m.status === "running" && m.agent === agentId);
  const message = running.reduce<BrainMessage | undefined>((newest, m) => (newest === undefined || m.id > newest.id ? m : newest), undefined);
  if (message !== undefined) return { state: "working", text: message.text };
  return { state: "idle", text: "idle" };
}

// ---- Limits -----------------------------------------------------------------------------

/** "no limit" for an unset limit; the words are the honest form of `null`, never a zero. */
export const NO_LIMIT = "no limit";

/** Sessions in words: "1 of 2 sessions", or "1 session · no limit". */
export function sessionsText(running: number, atOnce: number | null): string {
  if (atOnce === null) return `${running} ${running === 1 ? "session" : "sessions"} · ${NO_LIMIT}`;
  return `${running} of ${atOnce} ${atOnce === 1 ? "session" : "sessions"}`;
}

// ---- Details (GET /agents/:id) ------------------------------------------------------------

/** A crew member's charter prose, read defensively (`AgentDetailResponse.charter` is `unknown`). */
export interface CharterProse {
  readonly persona: string | null;
  readonly duties: readonly string[];
  readonly boundaries: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

/** The charter prose from a detail body; null when `charter` is null or not an object. */
export function charterProse(detail: AgentDetailResponse): CharterProse | null {
  const c = detail.charter;
  if (!isRecord(c)) return null;
  return {
    persona: typeof c.persona === "string" ? c.persona : null,
    duties: stringList(c.duties) ?? [],
    boundaries: stringList(c.boundaries) ?? [],
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

/** A limit as typed: omitted when blank, a number when it is digits, else the text (the kernel refuses it, naming the field). */
function limitOf(text: string): number | string | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  return /^\d{1,16}$/.test(t) ? Number(t) : t;
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
