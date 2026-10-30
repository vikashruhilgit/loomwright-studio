// The Tasks model: the one state -> column table, pinned row by row; honest
// badge tones (green only for done / done / completed); the "Done today"
// filter in local time; the feed refetch predicate; the words a card shows,
// escaped.
import { describe, expect, it } from "vitest";
import type { EventFrame, SessionSummary, TaskBoardItem, TaskBoardKind, TruncatedEventFrame } from "../../api/contract";
import { isLive } from "../sessions/model";
import {
  BOARD_COLUMNS,
  buildBoard,
  cardLabel,
  cardOrder,
  cardTitle,
  columnOf,
  eventLine,
  factsOf,
  isToday,
  logSessionOf,
  metaText,
  outputAnnounced,
  reasonText,
  refetchMark,
  refetchWanted,
  toneOf,
} from "./model";
import type { ColumnId } from "./model";

const ESC = String.fromCharCode(0x1b);
const RLO = String.fromCharCode(0x202e);

/** A fixed "now": Fri 30 Oct 2026 14:22, local time. */
const NOW = new Date(2026, 9, 30, 14, 22, 0).getTime();
const at = (h: number, m: number, day = 30): string => new Date(2026, 9, day, h, m, 0).toISOString();

function item(kind: TaskBoardKind, id: number, state: string, overrides: Partial<TaskBoardItem> = {}): TaskBoardItem {
  return { kind, id, title: kind === "session" ? null : `Title ${id}`, state, agent: "mason", playbook: null, item_ref: null, session: null, tokens: null, started: at(13, 0), ended: null, updated: at(14, 0), ...overrides };
}

describe("the columns", () => {
  it("are the mockup's four, in its order, with its labels and empty notes", () => {
    expect(BOARD_COLUMNS.map((c) => [c.id, c.label, c.none])).toEqual([
      ["wait", "Waiting on you", "Nothing waits on you."],
      ["work", "Working", "Nothing is running."],
      ["park", "Parked", "Nothing is parked."],
      ["done", "Done today", "Nothing finished yet."],
    ]);
  });
});

describe("columnOf: the state -> column table, row by row", () => {
  const cases: readonly [TaskBoardKind, string, ColumnId][] = [
    ["task", "waiting", "wait"],
    ["task", "working", "work"],
    ["task", "parked", "park"],
    ["task", "done", "done"],
    ["playbook_run", "running", "work"],
    ["playbook_run", "parked", "park"],
    ["playbook_run", "done", "done"],
    ["playbook_run", "failed", "done"],
    ["playbook_run", "skipped_duplicate", "done"],
    ["playbook_run", "skipped_not_enabled", "done"],
    ["session", "failed:auth", "wait"],
    ["session", "starting", "work"],
    ["session", "running", "work"],
    ["session", "interrupted", "park"],
    ["session", "orphaned", "park"],
    ["session", "completed", "done"],
    ["session", "failed", "done"],
    ["session", "stopped", "done"],
    ["session", "abandoned", "done"],
  ];
  it.each(cases)("%s %s is in %s", (kind, state, column) => {
    expect(columnOf({ kind, state })).toBe(column);
  });

  it("puts an unknown task state in Working, never hidden", () => {
    expect(columnOf({ kind: "task", state: "Waiting On Review" })).toBe("work");
    expect(columnOf({ kind: "task", state: "" })).toBe("work");
    // Case matters: the state is the kernel's own word.
    expect(columnOf({ kind: "task", state: "Done" })).toBe("work");
  });

  it("treats a word that is a property of every object as an unknown state", () => {
    for (const state of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      for (const kind of ["task", "playbook_run", "session"] as const) expect(columnOf({ kind, state })).toBe("work");
    }
  });

  it("puts a run or session status a newer kernel adds in Working too", () => {
    expect(columnOf({ kind: "playbook_run", state: "queued" })).toBe("work");
    expect(columnOf({ kind: "session", state: "resuming" })).toBe("work");
  });
});

describe("toneOf: honest status", () => {
  const known: Readonly<Record<TaskBoardKind, readonly string[]>> = {
    task: ["waiting", "working", "parked", "done"],
    playbook_run: ["running", "parked", "done", "failed", "skipped_duplicate", "skipped_not_enabled"],
    session: ["failed:auth", "starting", "running", "interrupted", "orphaned", "completed", "failed", "stopped", "abandoned"],
  };

  it("is green (ok) only for task done, run done and session completed", () => {
    const green: string[] = [];
    for (const kind of Object.keys(known) as TaskBoardKind[]) {
      for (const state of known[kind]) if (toneOf(kind, state) === "ok") green.push(`${kind}:${state}`);
    }
    expect(green.sort()).toEqual(["playbook_run:done", "session:completed", "task:done"]);
  });

  it("never turns an unknown, free-text or look-alike word green", () => {
    for (const word of ["Done", "completed", "success", "ok", "finished", "done "]) expect(toneOf("task", word)).not.toBe("ok");
    expect(toneOf("session", "done")).not.toBe("ok");
    expect(toneOf("playbook_run", "completed")).not.toBe("ok");
    expect(toneOf("task", "constructor")).toBe("neutral");
  });

  it("follows the mockup's STATE_BADGE: a failure is danger, and starting / orphaned / stopped are neutral", () => {
    expect(toneOf("task", "waiting")).toBe("attention");
    expect(toneOf("task", "working")).toBe("accent");
    expect(toneOf("playbook_run", "running")).toBe("accent");
    expect(toneOf("task", "parked")).toBe("parked");
    expect(toneOf("session", "interrupted")).toBe("parked");
    expect(toneOf("playbook_run", "failed")).toBe("danger");
    expect(toneOf("session", "failed")).toBe("danger");
    expect(toneOf("session", "failed:auth")).toBe("danger");
    for (const state of ["starting", "orphaned", "stopped", "abandoned"]) expect(toneOf("session", state)).toBe("neutral");
    for (const state of ["skipped_duplicate", "skipped_not_enabled"]) expect(toneOf("playbook_run", state)).toBe("neutral");
    expect(toneOf("task", "Waiting On Review")).toBe("neutral");
  });
});

describe("Done today", () => {
  it("isToday compares the local calendar day", () => {
    expect(isToday(new Date(2026, 9, 30, 0, 0, 1).toISOString(), NOW)).toBe(true);
    expect(isToday(new Date(2026, 9, 30, 23, 59, 59).toISOString(), NOW)).toBe(true);
    expect(isToday(new Date(2026, 9, 29, 23, 59, 59).toISOString(), NOW)).toBe(false);
    expect(isToday(new Date(2026, 9, 31, 0, 0, 1).toISOString(), NOW)).toBe(false);
    // A time that is not one is not known to be earlier.
    expect(isToday("not a time", NOW)).toBe(true);
  });

  it("keeps a terminal card only when `ended ?? updated` is today", () => {
    const board = buildBoard(
      [
        {
          state: "done",
          items: [
            item("task", 1, "done", { updated: at(9, 0), ended: null }),
            item("task", 2, "done", { updated: at(9, 0, 29) }),
            item("playbook_run", 3, "done", { updated: at(9, 0, 29), ended: at(8, 0) }),
            item("playbook_run", 4, "failed", { updated: at(9, 0), ended: at(8, 0, 29) }),
            item("session", 5, "completed", { updated: at(9, 0, 28), ended: at(10, 0, 28) }),
          ],
        },
      ],
      NOW,
    );
    expect(cardOrder(board).map((c) => c.key)).toEqual(["task:1", "playbook_run:3"]);
    expect(board.total).toBe(2);
  });

  it("keeps a working, parked or waiting card of any age", () => {
    const board = buildBoard(
      [
        { state: "waiting", items: [item("task", 1, "waiting", { updated: at(9, 0, 1) })] },
        { state: "working", items: [item("task", 2, "working", { updated: at(9, 0, 2) })] },
        { state: "parked", items: [item("session", 3, "interrupted", { updated: at(9, 0, 3), ended: at(9, 0, 3) })] },
      ],
      NOW,
    );
    expect(board.columns.map((c) => c.cards.map((k) => k.key))).toEqual([["task:1"], ["task:2"], ["session:3"], []]);
  });
});

describe("buildBoard", () => {
  it("always has the four columns in order, even with no rows", () => {
    const board = buildBoard([], NOW);
    expect(board.columns.map((c) => c.column.id)).toEqual(["wait", "work", "park", "done"]);
    expect(board.total).toBe(0);
    expect(board.waiting).toBe(0);
    expect(board.working).toBe(0);
  });

  it("merges the kernel's per-state groups into columns, newest first, then kind, then id descending", () => {
    const board = buildBoard(
      [
        { state: "working", items: [item("task", 9, "working", { updated: at(14, 10) }), item("task", 8, "working", { updated: at(14, 0) })] },
        { state: "running", items: [item("playbook_run", 18, "running", { updated: at(14, 16) }), item("session", 44, "running", { updated: at(14, 10) })] },
        { state: "starting", items: [item("session", 45, "starting", { updated: at(14, 10) })] },
      ],
      NOW,
    );
    expect(board.columns[1]?.cards.map((c) => c.key)).toEqual(["playbook_run:18", "session:45", "session:44", "task:9", "task:8"]);
    expect(board.working).toBe(5);
  });

  it("counts what waits on you, and shows a card once even if the kernel repeats it", () => {
    const board = buildBoard(
      [
        { state: "waiting", items: [item("task", 12, "waiting")] },
        { state: "failed:auth", items: [item("session", 39, "failed:auth", { ended: at(13, 55) })] },
        { state: "waiting", items: [item("task", 12, "waiting")] },
      ],
      NOW,
    );
    expect(board.waiting).toBe(2);
    expect(board.total).toBe(2);
  });

  it("keys cards by kind and id, so a task and a session with one id are two cards", () => {
    const board = buildBoard([{ state: "x", items: [item("task", 3, "working"), item("session", 3, "running")] }], NOW);
    expect(cardOrder(board).map((c) => c.key).sort()).toEqual(["session:3", "task:3"]);
  });

  it("orders J / K column by column, top to bottom", () => {
    const board = buildBoard(
      [
        { state: "a", items: [item("task", 1, "done", { updated: at(9, 0) }), item("task", 2, "waiting"), item("task", 3, "parked"), item("task", 4, "working")] },
      ],
      NOW,
    );
    expect(cardOrder(board).map((c) => c.key)).toEqual(["task:2", "task:4", "task:3", "task:1"]);
  });
});

describe("the feed", () => {
  const frame = (id: number, kind: string, sessionId: number | null = null): EventFrame => ({ type: "event", id, at: "2026-10-30T12:00:00.000Z", kind, session_id: sessionId, task_id: null, payload: {} });
  const truncated = (id: number, kind: string): TruncatedEventFrame => ({ type: "event", id, kind, truncated: true });

  it("refetches the board for every event kind except session_output_appended", () => {
    expect(refetchWanted("session_output_appended")).toBe(false);
    for (const kind of ["task_updated", "session_status", "playbook_run", "draft_output_recorded", "anything_new"]) expect(refetchWanted(kind)).toBe(true);
  });

  it("marks the newest event that wants a refetch, skipping output events", () => {
    expect(refetchMark([])).toBe(0);
    expect(refetchMark([frame(1, "task_created"), frame(2, "session_output_appended"), frame(3, "session_output_appended")])).toBe(1);
    expect(refetchMark([frame(1, "task_created"), frame(2, "session_output_appended"), frame(3, "task_updated")])).toBe(3);
    expect(refetchMark([truncated(7, "session_status")])).toBe(7);
  });

  it("reads the open session's log only for output announced for it, or frames it may have missed", () => {
    expect(outputAnnounced([frame(1, "x"), frame(2, "session_output_appended", 31)], 1, 31)).toBe(true);
    expect(outputAnnounced([frame(1, "x"), frame(2, "session_output_appended", 32)], 1, 31)).toBe(false);
    expect(outputAnnounced([frame(1, "x"), frame(2, "task_updated", 31)], 1, 31)).toBe(false);
    // Nothing new.
    expect(outputAnnounced([frame(1, "session_output_appended", 31)], 1, 31)).toBe(false);
    // A truncated frame carries no session id: it may be this one's.
    expect(outputAnnounced([frame(1, "x"), truncated(2, "session_output_appended")], 1, 31)).toBe(true);
    // The log was reset (a wiped event table).
    expect(outputAnnounced([frame(1, "x")], 40, 31)).toBe(true);
    // More arrived at once than the log keeps: some are gone unseen.
    expect(outputAnnounced([frame(50, "x"), frame(51, "x")], 10, 31)).toBe(true);
    // Nothing seen yet: the first id says nothing about what was missed.
    expect(outputAnnounced([frame(50, "x"), frame(51, "x")], 0, 31)).toBe(false);
    expect(outputAnnounced([frame(50, "x"), frame(51, "session_output_appended", 31)], 0, 31)).toBe(true);
  });
});

describe("the words on a card", () => {
  it("labels a card as the mockup does: kind, id, title, state", () => {
    expect(cardLabel(item("task", 12, "waiting", { title: "Pick the repos" }))).toBe("Task 12: Pick the repos, waiting");
    expect(cardLabel(item("playbook_run", 18, "running", { title: "Weekly changelog draft" }))).toBe("Playbook run 18: Weekly changelog draft, running");
    expect(cardLabel(item("session", 39, "failed:auth", { agent: "ada", playbook: 2 }))).toBe("Session 39: ada · playbook #2, failed:auth");
  });

  it("names a session by its agent and what it ran from; an unnamed row by its kind and id", () => {
    expect(cardTitle(item("session", 44, "running", { agent: "wright" }))).toBe("wright · ad hoc session");
    expect(cardTitle(item("session", 44, "running", { agent: null }))).toBe("unknown agent · ad hoc session");
    expect(cardTitle(item("task", 5, "done", { title: "  " }))).toBe("Task #5");
  });

  it("shows every untrusted string escaped: the title, the agent and the state word", () => {
    const hostile = item("task", 1, `wait${ESC}[31ming`, { title: `Pick${ESC}[31m the repos${RLO}`, agent: `ma${RLO}son` });
    const label = cardLabel(hostile);
    expect(label).toBe("Task 1: Pick\\x1b[31m the repos\\u202e, wait\\x1b[31ming");
    // eslint-disable-next-line no-control-regex
    expect(label).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
  });

  it("says why only for the one state the mapping explains", () => {
    expect(reasonText({ kind: "session", state: "failed:auth" })).toBe("Paused: the subscription token was refused.");
    expect(reasonText({ kind: "session", state: "failed" })).toBeNull();
    expect(reasonText({ kind: "task", state: "failed:auth" })).toBeNull();
  });

  it("shows `since` for a working card and the time it last changed for the others", () => {
    const board = buildBoard(
      [
        {
          state: "x",
          items: [item("task", 1, "working", { started: at(14, 10), updated: at(14, 20) }), item("task", 2, "parked", { updated: at(14, 0) })],
        },
      ],
      NOW,
    );
    const [working, parked] = [board.columns[1]?.cards[0], board.columns[2]?.cards[0]];
    expect(working && metaText(working)).toMatch(/^since \d\d:\d\d$/);
    expect(parked && metaText(parked)).toMatch(/^\d\d:\d\d$/);
  });
});

describe("facts", () => {
  it("lists a task's, a run's and a session's own facts, and leaves out what the kernel has no value for", () => {
    const task = factsOf(item("task", 9, "working", { agent: "mason", session: 41 }), NOW);
    expect(task.map((f) => f.label)).toEqual(["State", "Assignee", "Session", "Created", "Updated"]);
    expect(task[0]).toEqual({ label: "State", text: "working", tone: "accent" });

    const run = factsOf(item("playbook_run", 18, "running", { title: "Weekly changelog draft", playbook: 2, tokens: 4210, session: 42, ended: null }), NOW);
    expect(run.map((f) => f.label)).toEqual(["Playbook", "Status", "Tokens", "Session", "Started", "Ended"]);
    expect(run.find((f) => f.label === "Ended")?.text).toBe("still running");
    expect(run.find((f) => f.label === "Tokens")?.text).toBe("4,210 tokens");

    const bare = factsOf(item("task", 1, "waiting", { agent: null, session: null }), NOW);
    expect(bare.map((f) => f.label)).not.toContain("Assignee");
    expect(bare.map((f) => f.label)).not.toContain("Session");
  });

  it("takes the run kind, version and revision from the run's own row, and the model from the session", () => {
    const summary: SessionSummary = { id: 41, agent: "mason", status: "running", model: "sonnet", started: at(14, 10), ended: null, tokens: 5, cwd: null, playbook: null };
    const session = factsOf(item("session", 41, "running", { title: null }), NOW, summary);
    expect(session.find((f) => f.label === "Model")?.text).toBe("sonnet");
    expect(session.find((f) => f.label === "Ended")?.text).toBe("still running");
    const run = factsOf(item("playbook_run", 18, "done", { ended: at(14, 0) }), NOW, undefined, {
      id: 18,
      playbook: 2,
      version: 3,
      kind: "dry_run",
      status: "done",
      item_ref: null,
      item_revision: "a1b2c3d",
      tokens: null,
      session: null,
      started: at(13, 0),
      ended: at(14, 0),
    });
    expect(run.find((f) => f.label === "Run kind")?.text).toBe("dry_run");
    expect(run.find((f) => f.label === "Version")?.text).toBe("v3");
    expect(run.find((f) => f.label === "Revision")?.text).toBe("a1b2c3d");
    expect(run.find((f) => f.label === "Status")?.tone).toBe("ok");
  });
});

describe("history events", () => {
  const event = (payload: unknown, kind = "task_updated"): EventFrame => ({ type: "event", id: 5, at: "2026-10-30T12:00:00.000Z", kind, session_id: null, task_id: 9, payload });

  it("shows the payload as escaped data on one line, and nothing for an empty one", () => {
    expect(eventLine(event({})).text).toBe("");
    expect(eventLine(event(null)).text).toBe("");
    const line = eventLine(event({ note: `hi${ESC}[31m${RLO}`, n: 1 }, `kind${ESC}`));
    expect(line.kind).toBe("kind\\x1b");
    expect(line.text).not.toContain("\n");
    expect(line.text).toContain("hi\\x1b[31m\\u202e");
    // eslint-disable-next-line no-control-regex
    expect(line.text).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
  });

  it("cuts a long payload", () => {
    const line = eventLine(event({ blob: "x".repeat(1000) }));
    expect(line.text.length).toBeLessThan(300);
    expect(line.text.endsWith("… (cut)")).toBe(true);
  });
});

describe("the session whose log a card shows", () => {
  const s = (id: number, status: string): SessionSummary => ({ id, agent: null, status, model: null, started: null, ended: null, tokens: null, cwd: null, playbook: null });

  it("is a session card's own id, a task's or run's named session, else the running one, else the newest", () => {
    expect(logSessionOf(item("session", 39, "failed"), [], isLive)).toBe(39);
    expect(logSessionOf(item("task", 9, "working", { session: 41 }), [s(40, "running")], isLive)).toBe(41);
    expect(logSessionOf(item("task", 9, "working"), [s(40, "completed"), s(38, "running"), s(41, "stopped")], isLive)).toBe(38);
    expect(logSessionOf(item("task", 9, "working"), [s(40, "completed"), s(41, "stopped")], isLive)).toBe(41);
    expect(logSessionOf(item("task", 9, "working"), [], isLive)).toBeNull();
  });
});
