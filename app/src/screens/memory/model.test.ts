// The Memory screen's pure rules (phase 7 item 06): the feed kinds, the line diff and the
// carry-over of the owner's added lines, the draft and its line breaks, the tree's order, and
// the size, time and version text. No DOM: `model.ts` is plain TypeScript.
import { describe, expect, it } from "vitest";
import type { ApiResult, EventFrame, MemoryConflictError, MemoryTreeResponse } from "../../api/contract";
import {
  MAX_DIFF_CELLS,
  MEMORY_REFETCH_KINDS,
  bytesOf,
  carryOver,
  contentToSend,
  countText,
  draftOnTop,
  entryOf,
  fileCount,
  fileLabel,
  fileName,
  fileOrder,
  folderOf,
  fullPath,
  groupsOf,
  helpText,
  isConflictBody,
  isDirty,
  isFileBody,
  isTreeBody,
  lf,
  lineDiff,
  memoryRefetchMark,
  memoryRefetchWanted,
  memoryRoot,
  modifiedText,
  notSavedText,
  openDraft,
  refusalLine,
  refusalOf,
  sizeText,
  versionOf,
} from "./model";
import type { DiffHunk, DiffLine } from "./model";

const frame = (id: number, kind: string): EventFrame => ({ type: "event", id, at: "2026-10-30T10:00:00.000Z", kind, session_id: null, task_id: null, payload: null });

describe("the feed kinds that make the screen read again", () => {
  it("are memory_updated and session_status, and nothing else", () => {
    expect([...MEMORY_REFETCH_KINDS]).toEqual(["memory_updated", "session_status"]);
    expect(memoryRefetchWanted("memory_updated")).toBe(true);
    expect(memoryRefetchWanted("session_status")).toBe(true);
    for (const kind of ["session_output_appended", "approval_requested", "playbook_changed", "memory_updated_extra", ""]) expect(memoryRefetchWanted(kind), kind).toBe(false);
  });

  it("the mark is the id of the newest event of those kinds, 0 when there is none", () => {
    expect(memoryRefetchMark([])).toBe(0);
    expect(memoryRefetchMark([frame(1, "approval_requested"), frame(2, "session_output_appended")])).toBe(0);
    expect(memoryRefetchMark([frame(1, "memory_updated"), frame(2, "approval_requested"), frame(3, "session_status"), frame(4, "event_done")])).toBe(3);
    expect(memoryRefetchMark([frame(1, "session_status"), frame(2, "memory_updated")])).toBe(2);
    expect(memoryRefetchMark([{ type: "event", id: 9, kind: "memory_updated", truncated: true }])).toBe(9);
  });
});

// ---- the line diff -------------------------------------------------------------------------------------------

const flat = (hunks: readonly DiffHunk[] | null): DiffLine[] => (hunks ?? []).flatMap((h) => [...h.lines]);
const kinds = (hunks: readonly DiffHunk[] | null): string[] => flat(hunks).map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`);

describe("lineDiff", () => {
  it("answers no hunk when the texts are equal", () => {
    expect(lineDiff("a\nb\nc", "a\nb\nc")).toEqual([]);
    expect(lineDiff("", "")).toEqual([]);
  });

  it("marks an added line as added, with its new line number and no old one", () => {
    const hunks = lineDiff("a\nb\nc", "a\nb\nNEW\nc");
    const added = flat(hunks).filter((l) => l.kind === "add");
    expect(added).toEqual([{ kind: "add", newNumber: 3, text: "NEW" }]);
    expect(kinds(hunks)).toEqual([" a", " b", "+NEW", " c"]);
  });

  it("marks a removed line as deleted, with its old line number and no new one", () => {
    const hunks = lineDiff("a\nb\nc", "a\nc");
    expect(flat(hunks).filter((l) => l.kind === "del")).toEqual([{ kind: "del", oldNumber: 2, text: "b" }]);
    expect(kinds(hunks)).toEqual([" a", "-b", " c"]);
  });

  it("numbers every context line on both sides", () => {
    const lines = flat(lineDiff("a\nb\nc", "a\nX\nb\nc"));
    expect(lines.filter((l) => l.kind === "context")).toEqual([
      { kind: "context", oldNumber: 1, newNumber: 1, text: "a" },
      { kind: "context", oldNumber: 2, newNumber: 3, text: "b" },
      { kind: "context", oldNumber: 3, newNumber: 4, text: "c" },
    ]);
  });

  it("shows a replaced line as the old line deleted and the new one added", () => {
    expect(kinds(lineDiff("a\nold\nc", "a\nnew\nc"))).toEqual([" a", "-old", "+new", " c"]);
  });

  it("writes a header with the line range of each side", () => {
    const hunks = lineDiff("a\nb\nc", "a\nb\nNEW\nc") as readonly DiffHunk[];
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.header).toBe("@@ -1,3 +1,4 @@");
  });

  it("keeps three lines of context around a change and splits distant changes into two hunks", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const after = [...before];
    after[1] = "CHANGED 2";
    after[27] = "CHANGED 28";
    const hunks = lineDiff(before.join("\n"), after.join("\n")) as readonly DiffHunk[];
    expect(hunks).toHaveLength(2);
    const first = hunks[0] as DiffHunk;
    expect(first.lines.map((l) => l.text)).toEqual(["line 1", "line 2", "CHANGED 2", "line 3", "line 4", "line 5"]);
    expect(first.header).toBe("@@ -1,5 +1,5 @@");
    const second = hunks[1] as DiffHunk;
    expect(second.lines[0]).toEqual({ kind: "context", oldNumber: 25, newNumber: 25, text: "line 25" });
    expect(second.header).toBe("@@ -25,6 +25,6 @@");
  });

  it("merges changes whose context touches into one hunk", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const after = [...before];
    after[4] = "X";
    after[10] = "Y";
    expect(lineDiff(before.join("\n"), after.join("\n"))).toHaveLength(1);
  });

  it("handles an empty side", () => {
    expect(kinds(lineDiff("", "one\ntwo"))).toEqual(["-", "+one", "+two"]);
    expect(kinds(lineDiff("one\ntwo", ""))).toEqual(["-one", "-two", "+"]);
  });

  it("rebuilds both texts from its lines (before without the added ones, after without the deleted ones)", () => {
    const pairs: [string, string][] = [
      ["a\nb\nc\nd", "a\nc\nd\ne"],
      ["x\ny\nz", "y\nz\nx"],
      ["", "a\nb"],
      ["a\nb", ""],
      ["same\nsame\nsame", "same\nsame"],
      ["# L\n- one\n", "# L\n- one\n- two\n"],
    ];
    // A cheap deterministic generator: texts of at most four lines, so the three lines of context reach every line.
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let k = 0; k < 40; k += 1) {
      const make = (): string => Array.from({ length: next(5) }, () => String.fromCharCode(97 + next(4))).join("\n");
      pairs.push([make(), make()]);
    }
    for (const [before, after] of pairs) {
      const lines = flat(lineDiff(before, after));
      if (before === after) {
        expect(lines).toEqual([]);
        continue;
      }
      expect(lines.filter((l) => l.kind !== "add").map((l) => l.text), `before of ${JSON.stringify([before, after])}`).toEqual(before.split("\n"));
      expect(lines.filter((l) => l.kind !== "del").map((l) => l.text), `after of ${JSON.stringify([before, after])}`).toEqual(after.split("\n"));
    }
  });

  it("refuses, answering null, when the lines that differ pass MAX_DIFF_CELLS, and compares a long file that differs in one place", () => {
    const side = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const a = Array.from({ length: side }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: side }, (_, i) => `b${i}`).join("\n");
    expect(lineDiff(a, b)).toBeNull();
    // The same count of lines, one different: the common head and tail are trimmed, so the table is tiny.
    const long = Array.from({ length: 6000 }, (_, i) => `row ${i}`);
    const edited = [...long];
    edited[3000] = "edited";
    const hunks = lineDiff(long.join("\n"), edited.join("\n"));
    expect(hunks).not.toBeNull();
    expect(kinds(hunks)).toEqual([" row 2997", " row 2998", " row 2999", "-row 3000", "+edited", " row 3001", " row 3002", " row 3003"]);
  });
});

// ---- carrying the owner's lines over ------------------------------------------------------------------------------

describe("carryOver", () => {
  const base = "# Lessons\n\n- A retry loop must reset its counter.";
  const mine = `${base}\n- Quote the file and line.`;
  const disk = `${base}\n- Wait until a PR's head commit is stable.`;

  it("keeps the text on disk whole and adds only the lines the owner added", () => {
    expect(carryOver(base, mine, disk)).toBe(`${disk}\n- Quote the file and line.`);
  });

  it("does not carry over a line the owner removed", () => {
    expect(carryOver(base, "# Lessons\n", disk)).toBe(disk);
  });

  it("carries every added line, in the order the owner wrote them", () => {
    const two = `${base}\n- first\n- second`;
    expect(carryOver(base, two, disk)).toBe(`${disk}\n- first\n- second`);
  });

  it("returns the disk text when the owner added nothing", () => {
    expect(carryOver(base, base, disk)).toBe(disk);
  });

  it("puts the added lines after the last line of a text that ends in a newline, with no blank line between", () => {
    expect(carryOver("a\n", "a\nmine\n", "a\ndisk\n")).toBe("a\ndisk\nmine\n");
    expect(carryOver("a\n", "a\n", "a\ndisk\n")).toBe("a\ndisk\n");
  });

  it("answers null when the texts are too large to compare", () => {
    const side = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1;
    const a = Array.from({ length: side }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: side }, (_, i) => `b${i}`).join("\n");
    expect(carryOver(a, b, "disk")).toBeNull();
  });
});

// ---- the draft ------------------------------------------------------------------------------------------------------

describe("the draft", () => {
  const file = { path: "mason/lessons.md", content: "# Lessons\n\n- one\n", content_hash: "a".repeat(64) };

  it("starts as the file as read: nothing changed, based on the hash the file was read at", () => {
    const draft = openDraft(file);
    expect(draft).toEqual({ path: "mason/lessons.md", text: "# Lessons\n\n- one\n", baseHash: "a".repeat(64), baseText: "# Lessons\n\n- one\n", eol: "\n" });
    expect(isDirty(draft)).toBe(false);
    expect(isDirty({ ...draft, text: `${draft.text}- two\n` })).toBe(true);
  });

  it("holds a CRLF file's line breaks as LF, is not dirty for them, and sends them back as CRLF", () => {
    const draft = openDraft({ ...file, content: "a\r\nb\r\n" });
    expect(draft.text).toBe("a\nb\n");
    expect(draft.eol).toBe("\r\n");
    expect(isDirty(draft)).toBe(false);
    expect(contentToSend(draft)).toBe("a\r\nb\r\n");
    expect(contentToSend({ ...draft, text: "a\nb\nc\n" })).toBe("a\r\nb\r\nc\r\n");
    expect(contentToSend(openDraft(file))).toBe(file.content);
    expect(lf("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("an edit on top of the disk text is based on the disk's version, with the owner's added lines", () => {
    const draft = { ...openDraft(file), text: "# Lessons\n\n- one\n- mine\n" };
    const conflict: MemoryConflictError = { error: "changed_since_read", current_content: "# Lessons\n\n- one\n- theirs\n", current_hash: "b".repeat(64) };
    const next = draftOnTop(draft, conflict);
    expect(next).toEqual({ path: "mason/lessons.md", text: "# Lessons\n\n- one\n- theirs\n- mine\n", baseHash: "b".repeat(64), baseText: "# Lessons\n\n- one\n- theirs\n", eol: "\n" });
    expect(isDirty(next as NonNullable<typeof next>)).toBe(true);
  });

  it("recognises a conflict body only when it carries both versions", () => {
    expect(isConflictBody({ error: "changed_since_read", current_content: "x", current_hash: "h" })).toBe(true);
    expect(isConflictBody({ error: "changed_since_read", current_content: "x" })).toBe(false);
    expect(isConflictBody({ error: "invalid_path", current_content: "x", current_hash: "h" })).toBe(false);
    expect(isConflictBody(null)).toBe(false);
    expect(isConflictBody("changed_since_read")).toBe(false);
  });
});

// ---- the tree -----------------------------------------------------------------------------------------------------

const entry = (path: string, size = 100) => ({ path, size, modified: "2026-10-30T09:00:00.000Z" });
const TREE: MemoryTreeResponse = {
  agents: [
    { agent: "wright", files: [entry("wright/role.md"), entry("wright/lessons.md")] },
    { agent: "ghost", files: [] },
    { agent: "mason", files: [entry("mason/role.md"), entry("mason/notes.md")] },
  ],
  shared: [entry("shared/README.md"), entry("shared/about-me.md")],
};

describe("the tree", () => {
  it("lists each agent's files in the order the kernel sent them, then the shared files, and leaves out a folder with no file", () => {
    expect(groupsOf(TREE).map((g) => [g.folder, g.label, g.files.length])).toEqual([
      ["wright", "Wright", 2],
      ["mason", "Mason", 2],
      ["shared", "Shared", 2],
    ]);
    expect(fileOrder(TREE)).toEqual(["wright/role.md", "wright/lessons.md", "mason/role.md", "mason/notes.md", "shared/README.md", "shared/about-me.md"]);
    expect(fileCount(TREE)).toBe(6);
    expect(fileCount({ agents: [], shared: [] })).toBe(0);
    expect(fileOrder({ agents: [], shared: [] })).toEqual([]);
  });

  it("finds a file's row by path, and a path's parts", () => {
    expect(entryOf(TREE, "mason/notes.md")?.size).toBe(100);
    expect(entryOf(TREE, "mason/none.md")).toBeUndefined();
    expect(entryOf(undefined, "mason/notes.md")).toBeUndefined();
    expect(fileName("mason/lessons.md")).toBe("lessons.md");
    expect(folderOf("mason/lessons.md")).toBe("mason");
    expect(folderOf("lessons.md")).toBe("");
  });

  it("shows the memory root under the data folder, and just memory/ until Settings has answered", () => {
    expect(memoryRoot("/Users/me/.loomwright-studio")).toBe("/Users/me/.loomwright-studio/memory/");
    expect(memoryRoot("/Users/me/.loomwright-studio///")).toBe("/Users/me/.loomwright-studio/memory/");
    expect(memoryRoot(undefined)).toBe("memory/");
    expect(memoryRoot("")).toBe("memory/");
    expect(fullPath("/data", "mason/lessons.md")).toBe("/data/memory/mason/lessons.md");
    expect(fullPath(undefined, "mason/lessons.md")).toBe("memory/mason/lessons.md");
  });

  it("writes a control character in a path as an escape, so a name cannot hide what it is", () => {
    expect(fullPath("/data", "mason/a\u001b[2Jb.md")).toBe("/data/memory/mason/a\\x1b[2Jb.md");
    expect(fileLabel({ path: "mason/a‮b.md", size: 3, modified: "2026-10-30T09:00:00.000Z" }, Date.parse("2026-10-30T12:00:00.000Z"))).toContain("a\\u202eb.md");
  });

  it("checks the shape of the bodies it draws", () => {
    expect(isTreeBody(TREE)).toBe(true);
    expect(isTreeBody({ agents: [], shared: [] })).toBe(true);
    expect(isTreeBody({ agents: [] })).toBe(false);
    expect(isTreeBody({ agents: [{ agent: "x" }], shared: [] })).toBe(false);
    expect(isTreeBody({ agents: [], shared: [{ path: "x" }] })).toBe(false);
    expect(isTreeBody(null)).toBe(false);
    expect(isFileBody({ path: "a/b.md", content: "", content_hash: "h" })).toBe(true);
    expect(isFileBody({ path: "a/b.md", content: "" })).toBe(false);
    expect(isFileBody(undefined)).toBe(false);
  });
});

// ---- size, time, version ---------------------------------------------------------------------------------------------

describe("size, time and version text", () => {
  it("writes a size in bytes under 1 KB and in KB above, counting UTF-8 bytes", () => {
    expect(sizeText(0)).toBe("0 B");
    expect(sizeText(1023)).toBe("1023 B");
    expect(sizeText(1024)).toBe("1.0 KB");
    expect(sizeText(1536)).toBe("1.5 KB");
    expect(bytesOf("abc")).toBe(3);
    expect(bytesOf("é")).toBe(2);
  });

  it("is the first 8 characters of the content hash", () => {
    expect(versionOf("0123456789abcdef".repeat(4))).toBe("01234567");
    expect(versionOf("abc")).toBe("abc");
  });

  it("says 'today 13:10' for today and 'Wed 28 Oct' for another day, with the year when it is not this one", () => {
    const now = new Date(2026, 9, 30, 15, 0).getTime();
    expect(modifiedText(new Date(2026, 9, 30, 13, 10).toISOString(), now)).toBe("today 13:10");
    expect(modifiedText(new Date(2026, 9, 28, 9, 5).toISOString(), now)).toBe("Wed 28 Oct");
    expect(modifiedText(new Date(2025, 11, 31, 9, 5).toISOString(), now)).toBe("Wed 31 Dec 2025");
    expect(modifiedText("not a date", now)).toBe("not a date");
  });

  it("names a file button '<path>, <size>, modified <time>'", () => {
    const now = new Date(2026, 9, 30, 15, 0).getTime();
    expect(fileLabel({ path: "mason/lessons.md", size: 1536, modified: new Date(2026, 9, 28, 9, 5).toISOString() }, now)).toBe("mason/lessons.md, 1.5 KB, modified Wed 28 Oct");
    expect(countText(1)).toBe("1 file");
    expect(countText(12)).toBe("12 files");
  });

  it("explains lessons, role and any other file as the mockup does", () => {
    expect(helpText("mason/lessons.md")).toMatch(/your save is refused and you see both versions/);
    expect(helpText("mason/role.md")).toMatch(/config\/agents\/<id>\.json, which Team owns/);
    expect(helpText("shared/README.md")).toBe("Plain markdown. Only files under memory/ can be edited here.");
  });
});

// ---- reading an answer --------------------------------------------------------------------------------------------------

describe("reading an answer", () => {
  const refused = (status: number, error: unknown): ApiResult<unknown> => ({ ok: false, status, body: { error } as never });

  it("takes the status and the code of a refusal, and the reason a kernel did not answer", () => {
    expect(refusalOf({ ok: true, status: 200, body: {} })).toBeUndefined();
    expect(refusalOf(refused(400, "not_markdown"))).toEqual({ status: 400, code: "not_markdown" });
    expect(refusalOf(refused(413, "body_too_large"))).toEqual({ status: 413, code: "body_too_large" });
    expect(refusalOf(refused(500, 7))).toEqual({ status: 500, code: "unknown_error" });
    expect(refusalOf({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } })).toEqual({ status: 0, code: "timeout" });
    expect(refusalOf({ ok: false, status: 0, connection: { state: "not_installed", dataDir: "/x" } })).toEqual({ status: 0, code: "not_installed" });
  });

  it("writes a code that carries a control character as an escape", () => {
    expect(refusalOf(refused(400, "bad\u001bcode"))).toEqual({ status: 400, code: "bad\\x1bcode" });
  });

  it("says a save was not saved, names the status and the code, and says the edit is kept", () => {
    expect(notSavedText({ status: 400, code: "not_markdown" })).toBe("Not saved: the kernel refused it (400 · not_markdown). Your edit is kept here.");
    expect(notSavedText({ status: 0, code: "timeout" })).toMatch(/^Not saved: the kernel did not answer \(timeout\)\. Your edit is kept here/);
    expect(refusalLine("GET /memory", { status: 500, code: "store_unreadable" })).toBe("GET /memory · 500 · store_unreadable");
    expect(refusalLine("GET /memory", { status: 0, code: "timeout" })).toBe("GET /memory · no answer · timeout");
  });
});
