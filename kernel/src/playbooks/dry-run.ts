// The playbooks feature's `dry-run` part (phase 3 item 07): Wright runs a
// playbook's current version once in a dry-run session (`../sessions/dry-run.ts`:
// it can read but never act) and gets back what it would do. `./index.ts`
// merges this part with the others in `PLAYBOOK_PARTS`.
//
//   tool  kernel_playbook_dry_run(id, idempotency_key)  (Wright: its own draft playbooks and its crew's)
//
// The call refuses before any session: a crew member's session
// (`crew_cannot_draft`), a playbook the caller may not manage (`mayManage`,
// `./drafts.ts`), the owner's off, one that is not a draft, one with no model
// (the kernel never picks a model), then the owning agent's settings that
// cannot start a session: Wright's (`wright.json`) for Wright's playbook, the
// member's own (`config/agents/<id>.json`) for a crew member's, which first
// refuses an `off` member (`agent_off`). Otherwise it starts the owning
// agent's dry-run session (the intent verbatim as its prompt, the playbook's
// model, that agent's permission mode and policy, its `never` list for a
// crew member, cwd that agent's memory dir, `sessions.playbook` /
// `playbook_version` set), stores one `playbook_runs` row of kind `dry_run`,
// appends one `playbook_dry_run` event, rewrites the mirror and returns the
// summary. The session is started inside a work step keyed
// `ctx.stepKey(idempotency_key)`, so a repeat returns the stored result and
// starts no second session; an admission refusal (or a refusal before the
// session) releases the step, so nothing is left to repeat. A repeat replays
// only while the playbook is still at the version the stored run dry-ran: a
// same-key call after an edit (a new version) is refused naming both
// versions, so an old version's summary is never returned as the new one's.
//
// `latestDryRun` (the newest `done` dry run of one version) is what the
// enable part (`./enable.ts`) requires and what the mirror shows. The dedupe
// key here is a PREVIEW over the closed `DEDUPE_KEY_FIELDS`; what a fire
// skips is item 08's (`./runs.ts`).
//
// The `studio` CLI loads this module: besides zod and `node:` builtins it
// imports only the feature seam, `../loop/*`, the brain's settings and memory
// paths (`node:` and zod only), the agents feature's leaf modules
// (`../agents/registry.js`, `settings.js`, `memory.js`: never its index), the
// triggers feature's public index, type-only session and budget modules and
// this feature's files, never the Agent SDK, the session manager or
// `kernel.ts`. It and `./drafts.ts` import each other's functions (a cycle
// used only at call time, never at module load).
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { agentMemoryDir, ensureAgentMemoryFiles } from "../agents/memory.js";
import { getAgent } from "../agents/registry.js";
import { readAgentSettings } from "../agents/settings.js";
import { wrightMemoryDir } from "../brain/memory.js";
import { readWrightSettings } from "../brain/settings.js";
import type { UsageTotals } from "../budget/types.js";
import { defineTool } from "../features/contribution.js";
import type { ContributedTool, ContributedToolContext } from "../features/contribution.js";
import { appendEvent } from "../loop/internal.js";
import { getWorkStep, runStepAsync } from "../loop/steps.js";
import type { AllowedPermissionMode, SessionHandle, ToolPolicy, WouldDoEntry } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { nextCronFire } from "../triggers/index.js";
import type { TriggerView } from "../triggers/index.js";
import { afterPlaybookStep, mayManage, namedAsync, refuseCrewDrafting } from "./drafts.js";
import type { MirrorDryRun } from "./mirror.js";
import { PlaybookError, getPlaybook, linkedTriggerOf, refuseIfOwnerTurnedOff } from "./store.js";
import type { PlaybookRow } from "./store.js";
import { DEDUPE_KEY_FIELDS } from "./types.js";
import type { DedupeKeyField, PlaybookPart } from "./types.js";

export const DRY_RUN_TOOL_NAME = "kernel_playbook_dry_run";

/** How many fire times a dry run shows. */
export const DRY_RUN_NEXT_FIRES = 3;

/** The summary names at most this many would-do entries (then how many more), each input cut to `SUMMARY_INPUT_CHARS`. */
const SUMMARY_ENTRIES = 10;
const SUMMARY_INPUT_CHARS = 160;

/** `playbook_runs.status` of a dry run (item 08 owns the closed list for every kind). */
type DryRunStatus = "running" | "done" | "failed";

/** What a dry run returns to Wright, and what its work step stores. */
export interface DryRunToolResult {
  readonly run_id: number;
  /** The playbook's id. */
  readonly playbook: number;
  readonly version: number;
  /** `done` when the session completed, `failed` otherwise. */
  readonly status: "done" | "failed";
  readonly would_do: readonly WouldDoEntry[];
  /** UTC ISO-8601 instants, at most `DRY_RUN_NEXT_FIRES`. */
  readonly next_fires: readonly string[];
  readonly dedupe_key: string | null;
  readonly tokens: number;
  /** The one-paragraph text the mirror and the enable approval show. */
  readonly summary: string;
}

/** A stored, finished dry run (`latestDryRun`). */
export interface DryRunRecord {
  readonly run_id: number;
  readonly playbook: number;
  readonly version: number;
  readonly would_do: readonly WouldDoEntry[];
  readonly next_fires: readonly string[];
  readonly dedupe_key: string | null;
  readonly tokens: number;
  readonly ended_at: string | null;
  readonly summary: string;
}

/** What the summary is built from. */
export interface DryRunSummaryInput {
  readonly run_id: number;
  readonly version: number;
  readonly status: "done" | "failed";
  readonly would_do: readonly WouldDoEntry[];
  readonly next_fires: readonly string[];
  readonly dedupe_key: string | null;
  readonly tokens: number;
}

// ---- The summary ---------------------------------------------------------------

function clipped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function wouldDoText(e: WouldDoEntry): string {
  const how = e.would === "held" ? `held for approval${e.action === undefined ? "" : `: ${e.action}`}` : "would run";
  return `${e.tool} "${clipped(e.input_summary, SUMMARY_INPUT_CHARS)}" (${how})`;
}

/**
 * The dry run as one paragraph: version, ending, tokens, what it would do,
 * the next fires (UTC) and the dedupe key's preview. The would-do inputs are
 * the model's untrusted text, copied as data: every reader renders it inert
 * (the mirror as a code span, `studio approvals` escaped and indented).
 */
export function formatDryRunSummary(run: DryRunSummaryInput): string {
  const shown = run.would_do.slice(0, SUMMARY_ENTRIES).map(wouldDoText);
  const more = run.would_do.length - shown.length;
  const doing =
    run.would_do.length === 0 ? "it would do nothing that acts" : `it would do ${run.would_do.length} call${run.would_do.length === 1 ? "" : "s"}: ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
  return (
    `Dry run ${run.run_id} of version ${run.version} ${run.status === "done" ? "completed" : "did not complete"}, ${run.tokens} tokens; ${doing}. ` +
    `Next fires (UTC): ${run.next_fires.length === 0 ? "none" : run.next_fires.join(", ")}. ` +
    `Dedupe key for the next fire (preview): ${run.dedupe_key ?? "none"}.`
  );
}

// ---- Next fires and the dedupe-key preview ---------------------------------------

/** The local date (`YYYY-MM-DD`) of instant `ms` in IANA zone `tz`. */
function dateIn(ms: number, tz: string): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms))) {
    parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The next fires of `trigger` after `now` (UTC ISO-8601), and the first one's local date in the trigger's zone. */
export function nextFiresOf(trigger: Pick<TriggerView, "kind" | "spec"> | null, now: Date): { readonly fires: string[]; readonly firstDate: string | null } {
  const spec = (typeof trigger?.spec === "object" && trigger.spec !== null ? trigger.spec : {}) as { at?: unknown; cron?: unknown; tz?: unknown };
  if (trigger?.kind === "cron" && typeof spec.cron === "string" && typeof spec.tz === "string") {
    const fires: Date[] = [];
    try {
      let after = now;
      while (fires.length < DRY_RUN_NEXT_FIRES) {
        const next = nextCronFire(spec.cron, spec.tz, after);
        if (next === undefined) break;
        fires.push(next);
        after = next;
      }
    } catch {
      // A stored spec the parser refuses has no next fire to show.
    }
    const first = fires[0];
    return { fires: fires.map((f) => f.toISOString()), firstDate: first === undefined ? null : dateIn(first.getTime(), spec.tz) };
  }
  if (trigger?.kind === "once" && typeof spec.at === "string") {
    const ms = Date.parse(spec.at);
    if (!Number.isFinite(ms) || ms <= now.getTime()) return { fires: [], firstDate: null };
    // A once spec carries its own offset: its date part is the local date there.
    const own = /^(\d{4}-\d{2}-\d{2})T/.exec(spec.at);
    return { fires: [new Date(ms).toISOString()], firstDate: own?.[1] ?? new Date(ms).toISOString().slice(0, 10) };
  }
  return { fires: [], firstDate: null };
}

/** The values a dedupe key is built from, for one fire. */
export interface DedupeFire {
  readonly playbookId: number;
  readonly playbookVersion: number;
  readonly triggerId: number;
  /** The fire's UTC ISO-8601 instant. */
  readonly scheduledAt: string;
  /** The fire's local date in the trigger's zone. */
  readonly date: string;
}

/**
 * The dedupe key `spec` (a `dedupe_key_spec`: a JSON array of
 * `DEDUPE_KEY_FIELDS`) would give for `fire`: `<field>=<value>` joined with
 * `|`, in the spec's order. Pure. `null` with no spec, no fire, or a spec
 * that is not a list of known fields. A preview only: item 08 owns the
 * fire-time evaluation. A polled item's fields (`item.id`, `item.revision`)
 * show as `<per item>`: each item a poll finds has its own.
 */
export function previewDedupeKey(spec: string | null, fire: DedupeFire | null): string | null {
  if (spec === null || fire === null) return null;
  let fields: unknown;
  try {
    fields = JSON.parse(spec);
  } catch {
    return null;
  }
  if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => (DEDUPE_KEY_FIELDS as readonly unknown[]).includes(f))) return null;
  const values: Record<DedupeKeyField, string> = {
    "playbook.id": String(fire.playbookId),
    "playbook.version": String(fire.playbookVersion),
    "trigger.id": String(fire.triggerId),
    "trigger.scheduled_at": fire.scheduledAt,
    date: fire.date,
    "item.id": "<per item>",
    "item.revision": "<per item>",
  };
  return (fields as DedupeKeyField[]).map((f) => `${f}=${values[f]}`).join("|");
}

/** Input + output + cache-write + cache-read tokens over every model of a report's usage. */
export function dryRunTokens(usage: Readonly<Record<string, UsageTotals>>): number {
  let total = 0;
  for (const u of Object.values(usage)) total += u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
  return total;
}

// ---- Stored runs ----------------------------------------------------------------

interface RunRow {
  readonly id: number;
  readonly playbook: number;
  readonly version: number;
  readonly status: string;
  readonly tokens: number | null;
  readonly result_json: string | null;
  readonly ended_at: string | null;
}

function isWouldDo(value: unknown): value is WouldDoEntry {
  const e = value as Partial<WouldDoEntry> | null;
  return typeof e === "object" && e !== null && typeof e.tool === "string" && typeof e.input_summary === "string" && (e.would === "run" || e.would === "held");
}

function recordOf(row: RunRow): DryRunRecord {
  let result: { would_do?: unknown; next_fires?: unknown; dedupe_key?: unknown } = {};
  try {
    const parsed = JSON.parse(row.result_json ?? "null") as unknown;
    if (typeof parsed === "object" && parsed !== null) result = parsed as typeof result;
  } catch {
    // Unreadable: shown as having no entries.
  }
  const wouldDo = Array.isArray(result.would_do) ? result.would_do.filter(isWouldDo) : [];
  const nextFires = Array.isArray(result.next_fires) ? result.next_fires.filter((f): f is string => typeof f === "string") : [];
  const dedupeKey = typeof result.dedupe_key === "string" ? result.dedupe_key : null;
  const tokens = row.tokens ?? 0;
  return {
    run_id: row.id,
    playbook: row.playbook,
    version: row.version,
    would_do: wouldDo,
    next_fires: nextFires,
    dedupe_key: dedupeKey,
    tokens,
    ended_at: row.ended_at,
    summary: formatDryRunSummary({ run_id: row.id, version: row.version, status: "done", would_do: wouldDo, next_fires: nextFires, dedupe_key: dedupeKey, tokens }),
  };
}

/**
 * The newest dry run of playbook `playbookId` at `version` that ended `done`,
 * or null. Only `done` rows count: a `running` row (in flight, or left by a
 * crash) or a `failed` one is never a dry run of that version.
 */
export function latestDryRun(store: Store, playbookId: number, version: number): DryRunRecord | null {
  const row = store
    .prepare<[number, number], RunRow>(
      `SELECT id, playbook, version, status, tokens, result_json, ended_at FROM playbook_runs
        WHERE playbook = ? AND version = ? AND kind = 'dry_run' AND status = 'done' ORDER BY id DESC LIMIT 1`,
    )
    .get(playbookId, version);
  return row === undefined ? null : recordOf(row);
}

/** What the mirror's last line shows for `row`: its current version's last dry run, or that only earlier versions have one. */
export function mirrorDryRunOf(store: Store, row: Pick<PlaybookRow, "id" | "version">): MirrorDryRun | undefined {
  const latest = latestDryRun(store, row.id, row.version);
  if (latest !== null) return { summary: latest.summary };
  const earlier = store
    .prepare<[number], number>("SELECT 1 FROM playbook_runs WHERE playbook = ? AND kind = 'dry_run' AND status = 'done' LIMIT 1")
    .pluck()
    .get(row.id);
  return earlier === undefined ? undefined : { onlyEarlierVersions: true };
}

/**
 * Mark failed every `running` dry run of playbook `playbookId` whose session
 * is not live (its row is gone, terminal, `interrupted` or `orphaned`): what
 * a kernel restart mid dry run leaves. Returns how many it marked.
 */
export function failStaleDryRuns(store: Store, playbookId: number, now: Date): number {
  return store
    .prepare(
      `UPDATE playbook_runs SET status = 'failed', ended_at = ?
        WHERE playbook = ? AND kind = 'dry_run' AND status = 'running'
          AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = playbook_runs.session_id AND s.status IN ('starting', 'running'))`,
    )
    .run(now.toISOString(), playbookId).changes;
}

// ---- The tool ---------------------------------------------------------------------

function invalid(message: string): PlaybookError {
  return new PlaybookError("invalid_input", message);
}

/** An admission refusal (`AdmissionRefusedError`), told by its stable code so this module never imports the session layer at runtime. */
function isAdmissionRefusal(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === "admission_refused";
}

/** Playbook `id` if the caller may dry-run it: one it may manage (`mayManage`), not turned off by the owner, a draft. */
function ownDraft(store: Store, id: number, agent: string): PlaybookRow {
  const row = getPlaybook(store, id);
  if (row === undefined) throw new PlaybookError("not_found", `no playbook ${id}`);
  if (!mayManage(store, agent, row.owning_agent)) throw new PlaybookError("not_owner", `playbook ${row.id} belongs to agent ${row.owning_agent}; an agent can dry-run only its own playbooks`);
  refuseIfOwnerTurnedOff(store, row.id);
  if (row.status === "enabled") throw invalid(`playbook ${row.id} is already enabled at version ${row.version}; change it to make a new draft version to dry-run`);
  if (row.status !== "draft") throw invalid(`playbook ${row.id} is ${row.status}; only a draft is dry-run`);
  return row;
}

/**
 * A step already `done` for this key replays its stored result only when that
 * result is a dry run of playbook `id` (a key is scoped to the session, not to
 * a playbook) and the playbook is still at the version it dry-ran. Otherwise
 * the same key is refused (use a new key): a stored result is never returned
 * for another playbook or an older version, and a refusal names a version
 * only of the playbook its result dry-ran.
 */
function refuseStaleReplay(store: Store, key: string, id: number): void {
  const step = getWorkStep(store, key);
  if (step?.status !== "done") return;
  const result = step.result as { playbook?: unknown; version?: unknown } | null | undefined;
  const storedPlaybook = result?.playbook;
  if (storedPlaybook !== id) {
    throw invalid(
      `idempotency_key already used in this session for the dry run of playbook ${String(storedPlaybook ?? "unknown")}; ` +
        `use a new key to dry-run playbook ${id}`,
    );
  }
  const stored = result?.version;
  const current = getPlaybook(store, id)?.version;
  if (current === undefined) {
    throw invalid(`idempotency_key already used in this session for the dry run of playbook ${id}, which no longer exists; nothing was run`);
  }
  if (stored !== current) {
    throw invalid(
      `idempotency_key already used in this session for the dry run of version ${String(stored ?? "unknown")}; ` +
        `playbook ${id} is now at version ${current}: use a new key to dry-run it`,
    );
  }
}

/** Where a run's work is, for the step's no-effect rule: nothing started yet, the session being asked for, or started. */
type Phase = "checks" | "starting" | "started";

/** What the owning agent's dry-run session starts as: its agent, permission mode, policy and cwd. */
interface DryRunAs {
  readonly agent: string;
  readonly permissionMode: AllowedPermissionMode;
  readonly policy: ToolPolicy;
  readonly cwd: string;
}

/**
 * A registered crew member's playbook runs as that member: refused
 * `agent_off` unless it is `active`; its memory files made (a missing
 * `role.md` is refused naming it); its own settings (a refusal names its
 * file); its permission mode, its policy with its `never` list, cwd its
 * memory folder. Every refusal is before any session (the `checks` phase).
 */
function crewDryRunAs(store: Store, owner: string, status: string): DryRunAs {
  if (status !== "active") throw new PlaybookError("agent_off", `agent_off: ${owner} is off; its playbooks do not run`);
  const memory = ensureAgentMemoryFiles(store.dataDir, owner);
  if (!memory.ok) throw invalid(memory.error === "charter_missing" ? `charter_missing: ${memory.file} is missing (the crew member's charter)` : memory.message);
  const read = readAgentSettings(store.dataDir, owner);
  if (!read.ok) throw invalid(read.error === "model_unset" ? `model_unset: set "model" in ${read.file}` : read.message);
  const s = read.settings;
  return { agent: owner, permissionMode: s.permissionMode, policy: { ...s.policy, ...(s.never !== undefined ? { never: s.never } : {}) }, cwd: agentMemoryDir(store.dataDir, owner) };
}

/** Wait for the dry-run session, then store its run's ending and its audit event. */
async function finishRun(ctx: ContributedToolContext, row: PlaybookRow, trigger: TriggerView | null, handle: SessionHandle): Promise<DryRunToolResult> {
  const { store } = ctx;
  const runId = Number(
    store
      .prepare("INSERT INTO playbook_runs (playbook, version, kind, status, session_id, started_at) VALUES (?, ?, 'dry_run', 'running', ?, ?)")
      .run(row.id, row.version, handle.id, ctx.now().toISOString()).lastInsertRowid,
  );
  const status = await handle.done;
  const report = (await handle.dryRun) ?? null;
  const wouldDo = report?.wouldDo ?? [];
  const usage = report?.usage ?? {};
  const tokens = dryRunTokens(usage);
  const { fires, firstDate } = nextFiresOf(trigger, ctx.now());
  const first = fires[0];
  const dedupeKey =
    trigger === null || first === undefined || firstDate === null
      ? null
      : previewDedupeKey(row.dedupe_key_spec, { playbookId: row.id, playbookVersion: row.version, triggerId: trigger.id, scheduledAt: first, date: firstDate });
  const runStatus: Exclude<DryRunStatus, "running"> = status === "completed" ? "done" : "failed";
  const resultJson = JSON.stringify({ would_do: wouldDo, next_fires: fires, dedupe_key: dedupeKey, final_text: report?.finalText ?? null, usage });
  const at = ctx.now().toISOString();
  store.transaction(() => {
    // By this run's own outcome, whatever a concurrent stale-row cleanup wrote meanwhile.
    store.prepare("UPDATE playbook_runs SET status = ?, ended_at = ?, tokens = ?, result_json = ? WHERE id = ?").run(runStatus, at, tokens, resultJson, runId);
    appendEvent(
      store,
      "playbook_dry_run",
      { sessionId: ctx.sessionId, taskId: null },
      { playbook_id: row.id, version: row.version, run_id: runId, status: runStatus, tokens, would_do: wouldDo.length },
      at,
    );
  });
  const summary = formatDryRunSummary({ run_id: runId, version: row.version, status: runStatus, would_do: wouldDo, next_fires: fires, dedupe_key: dedupeKey, tokens });
  return { run_id: runId, playbook: row.id, version: row.version, status: runStatus, would_do: wouldDo, next_fires: fires, dedupe_key: dedupeKey, tokens, summary };
}

const dryRunTool = defineTool({
  name: DRY_RUN_TOOL_NAME,
  description:
    "Dry-run a draft playbook you own, or (Wright) one of a registered crew member's: run its current version once, as its agent would when it fires, in a session that can read but never act. " +
    "A crew member's playbook runs as that member (its settings, policy and never list, its memory folder); an off member's is refused. " +
    "Every call that would act (a comment, a push, a write, a kernel change) is recorded as something it would do and does not run. " +
    "The playbook must have a model (the kernel never picks one). The run's tokens count against the owning agent's limits. " +
    "Returns {run_id, playbook, version, status: done|failed, would_do, next_fires (UTC), dedupe_key (a preview for the next fire), tokens, summary}; " +
    "the summary is also written to the playbook's mirror. kernel_playbook_enable needs a done dry run of the current version. " +
    "Repeating a call with the same idempotency_key in this session returns the first result and starts no second run, while the playbook is at that version; after an edit, use a new key.",
  shape: { id: z.number().int().positive(), idempotency_key: z.string().min(1).max(200) },
  handler: (a, ctx) =>
    namedAsync(DRY_RUN_TOOL_NAME, async () => {
      // A crew member's session is refused first: nothing below runs or writes.
      const agent = refuseCrewDrafting(ctx);
      // Before the step, so a same-key repeat clears what a crash left too.
      failStaleDryRuns(ctx.store, a.id, ctx.now());
      // Synchronous up to the step's claim: no call interleaves between this read and it.
      refuseStaleReplay(ctx.store, ctx.stepKey(a.idempotency_key), a.id);
      let phase: Phase = "checks";
      const result = await runStepAsync(
        ctx.store,
        ctx.stepKey(a.idempotency_key),
        async (): Promise<DryRunToolResult> => {
          const row = ownDraft(ctx.store, a.id, agent);
          // The playbook's own model first: before the owning agent's settings are read and before any session.
          if (row.model === null) throw invalid(`model: playbook ${row.id} has no model; the kernel never picks one (the owner sets it with studio playbooks set ${row.id} model <id>)`);
          // A registered crew member's playbook runs as that member; any other (Wright's, or an unregistered agent's own) as before.
          const crew = row.owning_agent === "wright" ? undefined : getAgent(ctx.store, row.owning_agent);
          let as: DryRunAs;
          if (crew === undefined) {
            const settings = readWrightSettings(ctx.store.dataDir);
            if (!settings.ok) throw invalid(`wright.json: ${settings.message}`);
            as = { agent, permissionMode: settings.settings.permissionMode, policy: settings.settings.policy, cwd: wrightMemoryDir(ctx.store.dataDir) };
          } else {
            as = crewDryRunAs(ctx.store, row.owning_agent, crew.status);
          }
          const sessions = ctx.sessions;
          if (sessions.startSession === undefined) throw invalid("this kernel composition gives tools no session manager, so no dry-run session can start");
          mkdirSync(as.cwd, { recursive: true, mode: 0o700 });
          const trigger = linkedTriggerOf(ctx.store, row);
          phase = "starting";
          // The step's first effect: an admission refusal releases the step (nothing to repeat).
          const handle = await sessions.startSession({
            agent: as.agent,
            prompt: row.intent,
            model: row.model,
            permissionMode: as.permissionMode,
            cwd: as.cwd,
            policy: as.policy,
            dryRun: true,
            playbook: row.id,
            playbookVersion: row.version,
          });
          phase = "started";
          return finishRun(ctx, row, trigger, handle);
        },
        { now: ctx.now, noEffect: (err) => phase === "checks" || (phase === "starting" && isAdmissionRefusal(err)) },
      );
      return afterPlaybookStep(ctx, result.playbook, result);
    }),
});

/** The part's one tool. */
export const dryRunTools: readonly ContributedTool[] = Object.freeze([dryRunTool]);

export const dryRunPart: PlaybookPart = Object.freeze({
  name: "dry-run",
  tools: dryRunTools,
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
