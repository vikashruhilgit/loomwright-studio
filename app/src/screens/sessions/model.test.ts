// The Sessions screen's model: the order (running first), the status the
// kernel answered (never an assumed `stopped`), and each output row as one
// escaped StreamingLog line.
import { describe, expect, it } from "vitest";
import type { SessionOutputKind, SessionOutputRow, SessionSummary } from "../../api/contract";
import {
  agentText,
  displayOrder,
  durationText,
  effectiveStatus,
  elapsedText,
  groupSessions,
  rowToLine,
  sortSessions,
  statusLine,
  statusView,
  taskText,
  tokensText,
} from "./model";

const ESC = "\u001b";
const RLO = "\u202e";

function session(id: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    agent: "ada",
    status: "completed",
    model: "sonnet",
    started: "2026-10-22T08:00:00.000Z",
    ended: "2026-10-22T08:05:00.000Z",
    tokens: 100,
    cwd: "/tmp",
    playbook: null,
    ...overrides,
  };
}

function row(id: number, kind: SessionOutputKind, payload: unknown): SessionOutputRow {
  return { id, session_id: 1, seq: id, kind, payload, created_at: "2026-10-22T08:00:00.000Z" };
}

describe("order", () => {
  it("running sessions sort first, newest started first; then the rest by ended (or started), newest first", () => {
    const sorted = sortSessions([
      session(1, { status: "completed", ended: "2026-10-22T09:00:00.000Z" }),
      session(2, { status: "running", started: "2026-10-22T07:00:00.000Z", ended: null }),
      session(3, { status: "stopped", ended: "2026-10-22T10:00:00.000Z" }),
      session(4, { status: "starting", started: "2026-10-22T08:30:00.000Z", ended: null }),
      session(5, { status: "orphaned", started: "2026-10-22T09:30:00.000Z", ended: null }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual([4, 2, 3, 5, 1]);
  });

  it("a running session started long ago still sorts above one that ended a second ago", () => {
    const sorted = sortSessions([
      session(1, { status: "stopped", ended: "2026-10-22T12:00:00.000Z" }),
      session(2, { status: "running", started: "2026-10-01T00:00:00.000Z", ended: null }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual([2, 1]);
  });

  it("groups: running, then waiting on you (running with a pending approval), then recent; display order walks them", () => {
    const groups = groupSessions(
      [
        session(1, { status: "running", ended: null }),
        session(2, { status: "running", ended: null, started: "2026-10-22T08:10:00.000Z" }),
        session(3, { status: "failed", ended: "2026-10-22T08:20:00.000Z" }),
        session(4, { status: "completed" }),
      ],
      new Set([2, 3]),
    );
    expect(groups.map((g) => [g.id, g.sessions.map((s) => s.id)])).toEqual([
      ["running", [1]],
      ["waiting", [2]],
      ["recent", [3, 4]],
    ]);
    expect(groups[0]?.label).toBe("Running · 1");
    expect(displayOrder(groups).map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("the words on a row", () => {
  it("the task is the playbook, else ad hoc (the contract has no task field)", () => {
    expect(taskText({ playbook: 7 })).toBe("playbook #7");
    expect(taskText({ playbook: null })).toBe("ad hoc session");
  });

  it("the agent is escaped, or unknown", () => {
    expect(agentText({ agent: `m${ESC}[31mason${RLO}` })).toBe("m\\x1b[31mason\\u202e");
    expect(agentText({ agent: null })).toBe("unknown agent");
  });

  it("tokens, or — when the kernel has no count", () => {
    expect(tokensText(14208)).toBe("14,208 tokens");
    expect(tokensText(null)).toBe("—");
  });

  it("running time: live from started while running; started → ended otherwise; — when unknown", () => {
    const start = Date.parse("2026-10-22T08:00:00.000Z");
    expect(elapsedText(session(1, { status: "running", ended: null }), start + 252_000)).toBe("4m 12s");
    expect(elapsedText(session(1, { status: "stopped" }), start + 999_999_999)).toBe("5m 00s");
    expect(elapsedText(session(1, { started: null }), start)).toBe("—");
    expect(elapsedText(session(1, { status: "orphaned", ended: null }), start)).toBe("—");
    expect(durationText(3_720_000)).toBe("1h 02m");
    expect(durationText(-1)).toBe("—");
  });
});

describe("status", () => {
  it("{status: failed, reason: kill_incomplete} renders failed with a danger badge, never stopped", () => {
    const view = statusView("failed", "kill_incomplete");
    expect(view.word).toBe("failed");
    expect(view.word).not.toBe("stopped");
    expect(view.reason).toBe("kill_incomplete");
    expect(view.danger).toBe(true);
    expect(statusLine(view)).toBe("failed · kill_incomplete");
    // Any failed status is a danger; a kill_incomplete reason is one whatever the status.
    expect(statusView("failed", null)).toEqual({ word: "failed", reason: null, danger: true });
    expect(statusView("failed:auth", null).danger).toBe(true);
    expect(statusView("orphaned", "kill_incomplete").danger).toBe(true);
    expect(statusView("stopped", "owner_stop")).toEqual({ word: "stopped", reason: "owner_stop", danger: false });
  });

  it("an unknown status renders as its own text, escaped", () => {
    expect(statusView(`paused${ESC}`, null).word).toBe("paused\\x1b");
  });

  it("a stop in flight reads stopping…, never stopped; the answer shows while the list still says running", () => {
    expect(effectiveStatus("running", { phase: "pending", verb: "stop" })).toEqual({ status: "stopping…", reason: null, pending: true });
    expect(effectiveStatus("running", { phase: "pending", verb: "kill" }).status).toBe("killing…");
    const answered = { phase: "answered", verb: "stop", status: "stopped", reason: "owner_stop" } as const;
    expect(effectiveStatus("running", answered)).toEqual({ status: "stopped", reason: "owner_stop", pending: false });
    // The list caught up: it wins; the reason stays while it agrees.
    expect(effectiveStatus("stopped", answered)).toEqual({ status: "stopped", reason: "owner_stop", pending: false });
    expect(effectiveStatus("completed", answered)).toEqual({ status: "completed", reason: null, pending: false });
    // A refusal with no status leaves the list's.
    expect(effectiveStatus("running", { phase: "refused", verb: "stop", notice: "x" }).status).toBe("running");
    // An abandon answered while the list still says orphaned.
    expect(effectiveStatus("orphaned", { phase: "answered", verb: "abandon", status: "abandoned", reason: null }).status).toBe("abandoned");
  });

  it("a kill answered failed / kill_incomplete stays failed while the list still says running", () => {
    const shown = effectiveStatus("running", { phase: "answered", verb: "kill", status: "failed", reason: "kill_incomplete" });
    expect(shown.status).toBe("failed");
    expect(statusView(shown.status, shown.reason).danger).toBe(true);
  });
});

describe("output rows → log lines", () => {
  it("a tool_decision deny row maps to an error line carrying its reason", () => {
    const line = rowToLine(row(5, "tool_decision", { tool: "Bash", decision: "deny", reason: "never_category" }));
    expect(line.kind).toBe("error");
    expect(line.text).toBe("Bash denied · never_category");
    expect(line.id).toBe("5");
  });

  it("a held decision (approval_required) names its approval", () => {
    const line = rowToLine(row(6, "tool_decision", { tool: "Bash", decision: "deny", reason: "approval_required", approval_id: 7, command: "gh pr merge 1" }));
    expect(line.kind).toBe("error");
    expect(line.text).toBe("Bash held · approval #7 · approval_required · gh pr merge 1");
  });

  it("an allow is ok", () => {
    expect(rowToLine(row(7, "tool_decision", { tool: "Read", decision: "allow", reason: "policy_allow" }))).toMatchObject({ kind: "ok", text: "Read allowed · policy_allow" });
  });

  it("assistant text is prose; a tool call is a tool line; a tool result is output, or error when is_error", () => {
    expect(rowToLine(row(1, "assistant_text", { text: "Looking.\nNext." }))).toMatchObject({ kind: "prose", text: "Looking.\nNext." });
    expect(rowToLine(row(2, "tool_call", { tool_use_id: "t1", name: "Bash", input_json: '{"command":"ls"}' }))).toMatchObject({
      kind: "tool",
      tool: "Bash",
      text: '{"command":"ls"}',
    });
    expect(rowToLine(row(3, "tool_result", { tool_use_id: "t1", is_error: false, content: "a\nb" }))).toMatchObject({ kind: "output", text: "a\nb" });
    expect(rowToLine(row(4, "tool_result", { tool_use_id: "t1", is_error: true, content: "boom" }))).toMatchObject({ kind: "error", text: "boom" });
  });

  it("a result is ok on success, else error, with its tokens; system rows say init and the cut", () => {
    expect(rowToLine(row(1, "result", { subtype: "success", counted_tokens: 1200 }))).toMatchObject({ kind: "ok", text: "success · 1200 tokens" });
    expect(rowToLine(row(2, "result", { subtype: "error_max_turns", counted_tokens: 9 }))).toMatchObject({ kind: "error", text: "error_max_turns · 9 tokens" });
    expect(rowToLine(row(3, "system", { subtype: "init", model: "sonnet", tool_count: 12 }))).toMatchObject({ kind: "output", text: "init · model sonnet · 12 tools" });
    expect(rowToLine(row(4, "system", { subtype: "output_cut", reason: "rows" }))).toMatchObject({ kind: "output", text: "output cut (rows): nothing more is kept" });
  });

  it("a cut field appends … (cut)", () => {
    expect(rowToLine(row(1, "assistant_text", { text: "long", cut: { original_chars: 9000 } })).text).toBe("long … (cut)");
    expect(rowToLine(row(2, "tool_call", { name: "Read", input_json: "{", cut: { original_chars: 5000 } })).text).toBe("{ … (cut)");
  });

  it("every payload string is escaped: ANSI and bidi in text, tool names, results and reasons", () => {
    const text = rowToLine(row(1, "assistant_text", { text: `${ESC}[31mred${RLO}` })).text;
    expect(text).toBe("\\x1b[31mred\\u202e");
    expect(rowToLine(row(2, "tool_call", { name: `B${RLO}`, input_json: `${ESC}` })).tool).toBe("B\\u202e");
    expect(rowToLine(row(3, "tool_result", { content: `${ESC}[0m` })).text).toBe("\\x1b[0m");
    expect(rowToLine(row(4, "tool_decision", { tool: "Bash", decision: "deny", reason: `x${RLO}` })).text).toBe("Bash denied · x\\u202e");
  });

  it("a malformed payload never throws: missing fields read -", () => {
    expect(rowToLine(row(1, "assistant_text", null)).text).toBe("-");
    expect(rowToLine(row(2, "tool_decision", "nope"))).toMatchObject({ kind: "output", text: "- · -" });
    expect(rowToLine({ ...row(3, "system", {}), kind: "mystery" as SessionOutputKind, payload: { a: `${ESC}` } }).text).toBe('mystery {   "a": "\\x1b" }');
  });
});
