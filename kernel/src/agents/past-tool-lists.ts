// The kernel's past proposed tool lists for Wright, and the one kernel rewrite
// of `config/agents/wright.json` they allow (wa-c).
//
// `wright.json` is created once, with the proposed list of the day. That list
// (`PROPOSED_ALLOWED_TOOLS`, `../brain/settings.ts`) grows as the kernel gains
// tools, so an install keeps the list it was first given. A file whose
// `tool_policy.status` is `"proposed"` and whose `allowedTools` is, as a set
// (order and duplicates ignored), exactly one of the lists the kernel once
// proposed is provably unedited: the shared reader (`./settings.ts`) then
// rewrites its `allowedTools` to the current proposal. Any other list, any
// other status (absent included) and every crew member's file is never
// written: a crew member's tools come only from its approved charter.
//
// Every upgrade is audited. It runs only when an audit sink is registered for
// the data dir (`registerProposedToolsAudit`, which `startKernel` calls over
// its open store); with none (the `studio` CLI, a test without the kernel) the
// file is left as it is, so an upgrade is never unaudited. It also runs only at
// a top-level read: a read made while the store already has a transaction open
// (budget admission, the meter) leaves the file alone, because an outer
// rollback would drop the event while the renamed file stays; the next
// top-level read upgrades. The write mirrors the roster's `set`
// (`./roster.ts`): the old bytes are copied to a backup beside the file
// (exclusive create, mode 0600), the new text goes to a temporary sibling, and
// inside the sink's own (top-level) transaction the file is re-read (an
// owner's edit since the first read wins: no rename, no event, the backup
// stays), the `wright_tool_policy_upgraded` event is appended and the rename
// runs last. A failed step before the rename leaves the old file byte for
// byte, removes the backup (the file itself still holds those bytes), records
// `wright_tool_policy_upgrade_failed {file, step, code}` once and never
// throws; a sink that throws is swallowed the same way. The failure is
// remembered in-process for that registration, keyed by the sha256 of the old
// bytes, so a lasting failure (a read-only file, a full disk) is not retried
// and recorded on every read; a changed file, a new registration (a kernel
// restart) or an unregister forgets it. Like the roster's `set`, the rename is
// not part of the transaction: a kill -9 between the rename and the COMMIT
// keeps the new file with no event (the backup of the old bytes stays).
//
// `GET /settings` reads the file raw through `readWrightToolPolicy` (never
// creating it, never upgrading it), names the proposed tools the list lacks
// through `proposedToolsMissing`, and reports whether the upgrade will rewrite
// it through `isUpgradableToolPolicy` (the upgrade's own condition).
//
// Imports only `node:*` and `../brain/settings.js`. That module imports
// `./settings.js`, which imports this one: a cycle that is safe only at call
// time, so `PROPOSED_ALLOWED_TOOLS` and `MAX_SETTINGS_BYTES` are read only
// inside functions, never at module load.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_SETTINGS_BYTES, PROPOSED_ALLOWED_TOOLS, wrightSettingsPath } from "../brain/settings.js";

/** The audit kinds of the upgrade (one line: the app's audit sentence scan reads this form). */
export const PROPOSED_TOOLS_AUDIT_KINDS = ["wright_tool_policy_upgraded", "wright_tool_policy_upgrade_failed"] as const;

export type ProposedToolsAuditKind = (typeof PROPOSED_TOOLS_AUDIT_KINDS)[number];

/**
 * Every list the kernel has proposed for Wright, oldest first, recovered from
 * the git history of `kernel/src/brain/settings.ts`. Each is a subset of the
 * next and of the current proposal (a test pins it), so an upgrade never
 * removes a tool. When `PROPOSED_ALLOWED_TOOLS` changes, the list it was
 * before is appended here, or an install still holding it is never upgraded.
 */
export const PAST_PROPOSED_TOOL_LISTS: readonly (readonly string[])[] = Object.freeze([
  // 15 tools: `181849a6` (also `1de480ed`, `450e500c`).
  Object.freeze([
    "mcp__kernel__kernel_task_create",
    "mcp__kernel__kernel_task_update",
    "mcp__kernel__kernel_task_list",
    "mcp__kernel__kernel_task_get",
    "mcp__kernel__kernel_trigger_register",
    "mcp__kernel__kernel_trigger_remove",
    "mcp__kernel__kernel_trigger_list",
    "mcp__kernel__kernel_notify",
    "mcp__kernel__kernel_approval_request",
    "mcp__kernel__kernel_loomwright_capabilities",
    "mcp__kernel__kernel_schedule_wakeup",
    "mcp__kernel__kernel_request_stop",
    "Read",
    "Glob",
    "Grep",
  ]),
  // 21 tools: `bc6d53f6` (the 15 plus the six playbook tools).
  Object.freeze([
    "mcp__kernel__kernel_task_create",
    "mcp__kernel__kernel_task_update",
    "mcp__kernel__kernel_task_list",
    "mcp__kernel__kernel_task_get",
    "mcp__kernel__kernel_trigger_register",
    "mcp__kernel__kernel_trigger_remove",
    "mcp__kernel__kernel_trigger_list",
    "mcp__kernel__kernel_notify",
    "mcp__kernel__kernel_approval_request",
    "mcp__kernel__kernel_loomwright_capabilities",
    "mcp__kernel__kernel_playbook_create",
    "mcp__kernel__kernel_playbook_update",
    "mcp__kernel__kernel_playbook_list",
    "mcp__kernel__kernel_playbook_disable",
    "mcp__kernel__kernel_playbook_dry_run",
    "mcp__kernel__kernel_playbook_enable",
    "mcp__kernel__kernel_schedule_wakeup",
    "mcp__kernel__kernel_request_stop",
    "Read",
    "Glob",
    "Grep",
  ]),
  // 25 tools: `845564ce` through `b4450b80` (the 21 plus the four agent tools; the proposal at wa-c).
  Object.freeze([
    "mcp__kernel__kernel_task_create",
    "mcp__kernel__kernel_task_update",
    "mcp__kernel__kernel_task_list",
    "mcp__kernel__kernel_task_get",
    "mcp__kernel__kernel_trigger_register",
    "mcp__kernel__kernel_trigger_remove",
    "mcp__kernel__kernel_trigger_list",
    "mcp__kernel__kernel_notify",
    "mcp__kernel__kernel_approval_request",
    "mcp__kernel__kernel_loomwright_capabilities",
    "mcp__kernel__kernel_playbook_create",
    "mcp__kernel__kernel_playbook_update",
    "mcp__kernel__kernel_playbook_list",
    "mcp__kernel__kernel_playbook_disable",
    "mcp__kernel__kernel_playbook_dry_run",
    "mcp__kernel__kernel_playbook_enable",
    "mcp__kernel__kernel_schedule_wakeup",
    "mcp__kernel__kernel_request_stop",
    "mcp__kernel__kernel_agent_create",
    "mcp__kernel__kernel_agent_update",
    "mcp__kernel__kernel_agent_list",
    "mcp__kernel__kernel_agent_message",
    "Read",
    "Glob",
    "Grep",
  ]),
]);

/** Whether `a` and `b` hold the same names, order and duplicates ignored. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const name of left) if (!right.has(name)) return false;
  return true;
}

/**
 * Whether `allowedTools` is, as a set, exactly one of the recorded past lists
 * and not already the current proposal: the one list the upgrade rewrites. A
 * list with one tool more or one tool fewer than every past list is the
 * owner's, never matched. Pure.
 */
export function isPastProposedList(allowedTools: readonly string[]): boolean {
  if (sameSet(allowedTools, PROPOSED_ALLOWED_TOOLS)) return false;
  return PAST_PROPOSED_TOOL_LISTS.some((past) => sameSet(allowedTools, past));
}

/**
 * Whether `policy` is the one file the upgrade rewrites: `status` `"proposed"`
 * and a list that is, as a set, a past proposed list (`isPastProposedList`).
 * The upgrade and `GET /settings`' `upgrade_pending` both decide by it. Pure.
 */
export function isUpgradableToolPolicy(policy: WrightToolPolicy): boolean {
  return policy.status === "proposed" && isPastProposedList(policy.allowedTools);
}

/** The current proposed tools `allowedTools` lacks, in `PROPOSED_ALLOWED_TOOLS` order. Pure. */
export function proposedToolsMissing(allowedTools: readonly string[]): string[] {
  const held = new Set(allowedTools);
  return PROPOSED_ALLOWED_TOOLS.filter((name) => !held.has(name));
}

/** Wright's tool policy as `wright.json` holds it, read raw. */
export interface WrightToolPolicy {
  /** `tool_policy.status`, or null when the file sets none. */
  readonly status: string | null;
  readonly allowedTools: readonly string[];
}

/**
 * Wright's tool policy, read raw from `<dataDir>/config/agents/wright.json`:
 * never created, never upgraded, nothing written. Null when the file is
 * absent, unreadable, over `MAX_SETTINGS_BYTES`, not JSON, or not a settings
 * object with a `tool_policy` whose `status` (when set) is a string and whose
 * `allowedTools` is an array of strings. Never throws.
 */
export function readWrightToolPolicy(dataDir: string): WrightToolPolicy | null {
  try {
    const file = wrightSettingsPath(dataDir);
    if (statSync(file).size > MAX_SETTINGS_BYTES) return null;
    const buf = readFileSync(file);
    if (buf.length > MAX_SETTINGS_BYTES) return null;
    return toolPolicyOf(JSON.parse(buf.toString("utf8")));
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolPolicyOf(json: unknown): WrightToolPolicy | null {
  if (!isObject(json) || !isObject(json.tool_policy)) return null;
  const { status, allowedTools } = json.tool_policy;
  if (status !== undefined && typeof status !== "string") return null;
  if (!Array.isArray(allowedTools) || !allowedTools.every((name): name is string => typeof name === "string")) return null;
  return { status: status ?? null, allowedTools };
}

/** What records the upgrade's audit events over a kernel's open store. */
export interface ProposedToolsAuditSink {
  /** Whether the store already has a transaction open: then `transaction` would only be a savepoint, and the read never upgrades. */
  readonly inTransaction: () => boolean;
  /** Runs `fn` in one store transaction: it commits when `fn` returns and rolls back when it throws. */
  readonly transaction: <T>(fn: () => T) => T;
  /** Appends one audit event (inside `transaction` when called from it). */
  readonly record: (kind: ProposedToolsAuditKind, payload: Record<string, unknown>) => void;
}

/**
 * One registration: its sink, and the sha256 of every file content whose
 * upgrade failed under it (never retried, never recorded again while the
 * bytes stay the same). Owned by the registration, so it goes with it.
 */
interface Registration {
  readonly sink: ProposedToolsAuditSink;
  readonly failed: Set<string>;
}

/** The registered sinks, one per data dir (resolved). */
const sinks = new Map<string, Registration>();

/**
 * Registers `sink` for `dataDir`: Wright's settings reads there may upgrade an
 * unedited proposed list. A new registration starts with no remembered
 * failures. Returns the unregister function, which removes the registration
 * (and its remembered failures) only while it is still the one registered
 * (call it before the store closes, so no sink outlives its store).
 */
export function registerProposedToolsAudit(dataDir: string, sink: ProposedToolsAuditSink): () => void {
  const key = resolve(dataDir);
  const registration: Registration = { sink, failed: new Set() };
  sinks.set(key, registration);
  return () => {
    if (sinks.get(key) === registration) sinks.delete(key);
  };
}

/** The steps an upgrade can fail at, as the `wright_tool_policy_upgrade_failed` event's `step` names them. */
export type ProposedToolsUpgradeStep = "size" | "backup" | "write" | "rename" | "record";

/** An upgrade step that failed, with the error's code (`ENOSPC`, `EACCES`; `error` when it has none). */
class StepError extends Error {
  constructor(
    readonly step: ProposedToolsUpgradeStep,
    readonly code: string,
  ) {
    super(`${step}: ${code}`);
  }
}

/** Thrown inside the transaction when the file changed (or went) since it was read: the owner's edit wins. */
class ChangedError extends Error {}

function codeOf(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && code !== "" ? code.slice(0, 64) : "error";
}

/** `fn`, with a throw turned into the failure of `step`. */
function at<T>(step: ProposedToolsUpgradeStep, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new StepError(step, codeOf(err));
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already renamed or gone.
  }
}

/** `<UTC stamp>-<random hex>`: two backups in the same millisecond never collide. */
function backupSuffix(): string {
  return `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(4).toString("hex")}`;
}

/** `record` through the sink, swallowing a sink that throws (the read must still return). */
function recordQuietly(sink: ProposedToolsAuditSink, kind: ProposedToolsAuditKind, payload: Record<string, unknown>): void {
  try {
    sink.record(kind, payload);
  } catch {
    // A sink that throws is swallowed.
  }
}

/** Whether the sink reports an open transaction; a sink that throws counts as one (no upgrade, fail closed). */
function inOuterTransaction(sink: ProposedToolsAuditSink): boolean {
  try {
    return sink.inTransaction();
  } catch {
    return true;
  }
}

/**
 * The upgrade, called by `readAgentSettings` for Wright only, after the file
 * passed every check (schema, `never`/`workspaces`, `connectors`). `base` is
 * the file's bytes as read and `json` their parse (the raw JSON, never the
 * schema's output, so every key, an unknown one included, keeps its value in
 * the rewrite). Returns the list now in the file when it was rewritten, else
 * undefined (the caller keeps the list it parsed). Runs only at a top-level
 * read (no store transaction open) and never for bytes whose upgrade already
 * failed under this registration. Never throws.
 */
export function upgradeProposedTools(dataDir: string, file: string, base: Buffer, json: unknown): readonly string[] | undefined {
  const registration = sinks.get(resolve(dataDir));
  if (registration === undefined) return undefined;
  const { sink, failed } = registration;
  const policy = toolPolicyOf(json);
  if (policy === null || !isUpgradableToolPolicy(policy)) return undefined;
  // Inside an outer transaction the event would roll back with it while the rename stays: wait for a top-level read.
  if (inOuterTransaction(sink)) return undefined;
  const digest = createHash("sha256").update(base).digest("hex");
  if (failed.has(digest)) return undefined;
  const next = [...PROPOSED_ALLOWED_TOOLS];
  const added = proposedToolsMissing(policy.allowedTools);
  const root = json as Record<string, unknown>;
  const text = `${JSON.stringify({ ...root, tool_policy: { ...(root.tool_policy as Record<string, unknown>), allowedTools: next } }, null, 2)}\n`;
  const backup = `${file}.bak-${backupSuffix()}`;
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let backedUp = false;
  let renamed = false;
  try {
    if (Buffer.byteLength(text) > MAX_SETTINGS_BYTES) throw new StepError("size", "over_limit");
    at("backup", () => writeFileSync(backup, base, { flag: "wx", mode: 0o600 }));
    backedUp = true;
    try {
      at("write", () => writeFileSync(temp, text, { flag: "wx", mode: 0o600 }));
      sink.transaction(() => {
        // Re-read just before the rename: an owner's hand edit since the first read wins.
        let now: Buffer;
        try {
          now = readFileSync(file);
        } catch {
          throw new ChangedError();
        }
        if (!now.equals(base)) throw new ChangedError();
        sink.record("wright_tool_policy_upgraded", { file, backup, added });
        at("rename", () => renameSync(temp, file));
        renamed = true;
      });
    } catch (err) {
      removeQuietly(temp);
      if (err instanceof StepError || err instanceof ChangedError) throw err;
      // The sink's record or its COMMIT threw.
      throw new StepError("record", codeOf(err));
    }
    return next;
  } catch (err) {
    // The owner's edit is not a failure: no event, the backup stays, and the next read leaves the edited list alone.
    if (err instanceof ChangedError) return undefined;
    if (renamed) {
      // The rename ran but the COMMIT did not: the file holds the new list, so the event is recorded on its own.
      recordQuietly(sink, "wright_tool_policy_upgraded", { file, backup, added });
      return next;
    }
    // Before the rename: the file still holds the old bytes, so their backup is redundant.
    if (backedUp) removeQuietly(backup);
    // Remembered before recording, so a sink that throws is not retried on every read either.
    failed.add(digest);
    const failure = err instanceof StepError ? err : new StepError("record", codeOf(err));
    recordQuietly(sink, "wright_tool_policy_upgrade_failed", { file, step: failure.step, code: failure.code });
    return undefined;
  }
}
