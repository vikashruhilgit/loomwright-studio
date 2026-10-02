// The handoff note `kernel_request_stop` writes (AC4): markdown under the
// Studio data dir (invariant 8), at `memory/<agent>/handoffs/<task>.md`.
import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** An agent id usable as one path segment: no separator, no leading dot, so no traversal. */
export const AGENT_DIR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The directory for a session that has no agent. */
export const UNASSIGNED_AGENT_DIR = "_unassigned";

export class HandoffPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffPathError";
  }
}

export interface HandoffRef {
  readonly agent: string | null;
  readonly taskId: number | null;
  readonly sessionId: number;
}

/**
 * `<dataDir>/memory/<agentDir>/handoffs/<taskName>.md`: `agentDir` is the
 * agent id (it must match `AGENT_DIR_PATTERN`) or `_unassigned`; `taskName`
 * is the task id, or `session-<id>` when the session has no task. Throws
 * `HandoffPathError` for an agent id that could escape its directory.
 */
export function handoffPath(dataDir: string, ref: HandoffRef): string {
  let agentDir = UNASSIGNED_AGENT_DIR;
  if (ref.agent !== null) {
    if (!AGENT_DIR_PATTERN.test(ref.agent)) {
      throw new HandoffPathError(`agent id ${JSON.stringify(ref.agent)} cannot be used as a memory directory name`);
    }
    agentDir = ref.agent;
  }
  if (!Number.isSafeInteger(ref.sessionId) || ref.sessionId <= 0) throw new HandoffPathError("session id must be a positive integer");
  if (ref.taskId !== null && (!Number.isSafeInteger(ref.taskId) || ref.taskId <= 0)) {
    throw new HandoffPathError("task id must be a positive integer");
  }
  const taskName = ref.taskId === null ? `session-${ref.sessionId}` : String(ref.taskId);
  return join(dataDir, "memory", agentDir, "handoffs", `${taskName}.md`);
}

/** A short header naming agent, task, session and time, then the handoff text verbatim. */
export function renderHandoff(ref: HandoffRef, at: string, text: string): string {
  const lines = [
    "# Handoff",
    "",
    `- Agent: ${ref.agent ?? "(none)"}`,
    `- Task: ${ref.taskId === null ? "(none)" : String(ref.taskId)}`,
    `- Session: ${ref.sessionId}`,
    `- Written: ${at}`,
    "",
    "---",
    "",
    text,
  ];
  return `${lines.join("\n")}${text.endsWith("\n") ? "" : "\n"}`;
}

/**
 * Write `content` to `path` atomically: create the parent directories (mode
 * 0700), write a temp file in the same directory (mode 0600), then rename it
 * over `path`. A reader sees the old file or the new one, never a torn one;
 * rewriting the same content is idempotent.
 */
export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
