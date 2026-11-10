// Thread continuity's plain helpers (phase 8 item 17c): the ask body, the
// reference link, each refusal in plain words, the size-hint check, the
// thread grouping and the summarized-into memory.
import { describe, expect, it } from "vitest";
import type { StudioBridge, ThreadFigures } from "../../api/contract";
import {
  askBodyOf,
  firstLine,
  hintFromThreads,
  joinThreads,
  messagesText,
  parseReference,
  pastHint,
  referenceLink,
  refusalWords,
  rememberSummarized,
  summarizedInto,
  threadTitle,
} from "./continuity";
import { hintOf } from "../settings/model";
import { INERT_BRIDGE } from "./model";

function figures(overrides: Partial<ThreadFigures> = {}): ThreadFigures {
  return { id: 4, agent: "wright", title: "Plan the release", renamed: false, messages: 4, latest_reply_tokens: 52000, summary_estimated_tokens: null, ...overrides };
}

describe("askBodyOf", () => {
  it("a plain send is exactly the body before threads: no continues, no references key", () => {
    const body = askBodyOf({ text: "hi", agent: "wright" });
    expect(body).toEqual({ text: "hi", agent: "wright" });
    expect(Object.keys(body)).toEqual(["text", "agent"]);
    expect(JSON.stringify(askBodyOf({ text: "hi", agent: "pim", workspace: "~/w" }))).toBe('{"text":"hi","agent":"pim","workspace":"~/w"}');
    expect(Object.keys(askBodyOf({ text: "hi", agent: "wright", references: [] }))).toEqual(["text", "agent"]);
  });

  it("a Reply carries continues: the message id", () => {
    expect(askBodyOf({ text: "and then?", agent: "wright", continues: 6 })).toEqual({ text: "and then?", agent: "wright", continues: 6 });
  });

  it("AC5: the Summary toggle sends use summary, Full thread use exchanges", () => {
    expect(askBodyOf({ text: "see this", agent: "pim", references: [{ thread: 8, use: "summary" }] }).references).toEqual([{ thread: 8, use: "summary" }]);
    expect(askBodyOf({ text: "see this", agent: "pim", references: [{ thread: 8, use: "exchanges" }] }).references).toEqual([{ thread: 8, use: "exchanges" }]);
  });
});

describe("the reference link", () => {
  it("round-trips an agent and a thread", () => {
    const link = referenceLink({ agent: "pim", thread: 90 });
    expect(link).toBe("loomwright-studio://thread/pim/90");
    expect(parseReference(link)).toEqual({ agent: "pim", thread: 90 });
    expect(parseReference(`  ${link}\n`)).toEqual({ agent: "pim", thread: 90 });
  });

  it("anything but one whole link is plain text", () => {
    for (const text of ["", "hello", "see loomwright-studio://thread/pim/90", "loomwright-studio://thread/pim/0", "loomwright-studio://thread/pim/9x", "loomwright-studio://thread//9", "loomwright-studio://thread/pim/90/extra", "loomwright-studio://thread/%E0%A4%A/9", "https://thread/pim/9"]) {
      expect(parseReference(text)).toBeUndefined();
    }
  });
});

describe("refusalWords", () => {
  const codes: readonly [string, unknown][] = [
    ["continues_invalid", { error: "continues_invalid", reason: "no_such_message", continues: 6 }],
    ["continues_invalid", { error: "continues_invalid", reason: "other_agent", continues: 6 }],
    ["continues_invalid", { error: "continues_invalid", reason: "never_started", continues: 6 }],
    ["history_too_large", { error: "history_too_large", thread: 8, size: 412000, bound: 200000 }],
    ["history_too_large", { error: "history_too_large", thread: null, size: 412000, bound: 200000 }],
    ["already_started_fresh", { error: "already_started_fresh", summarized_into: 20 }],
    ["summary_exists", { error: "summary_exists", file: "memory/wright/threads/4.md" }],
    ["no_summary", { error: "no_summary" }],
    ["nothing_to_summarize", { error: "nothing_to_summarize" }],
    ["summary_unreadable", { error: "summary_unreadable", problem: "EACCES" }],
    ["summary_unwritable", { error: "summary_unwritable" }],
    ["agent_off", { error: "agent_off" }],
    ["kill_switch_engaged", { error: "kill_switch_engaged" }],
    ["workspace_not_listed", { error: "workspace_not_listed", message: "~/b is not one of pim's workspaces" }],
  ];

  it("AC6: each refusal code maps to a plain sentence, never the bare code", () => {
    const seen = new Set<string>();
    for (const [code, body] of codes) {
      const words = refusalWords({ status: 409, code, text: `(${code})`, body });
      expect(words).not.toContain(code);
      expect(words).toMatch(/^[A-Z].*\.$/s);
      seen.add(words);
    }
    // The three continues_invalid reasons each get their own sentence.
    expect(seen.size).toBe(codes.length);
  });

  it("history_too_large names size and bound in characters", () => {
    expect(refusalWords({ status: 409, code: "history_too_large", text: "", body: { thread: 8, size: 412000, bound: 200000 } })).toBe(
      "The referenced thread #8 is 412,000 characters, past the kernel's limit of 200,000 characters. Nothing was cut and nothing was sent. Remove the reference, or attach its summary instead.",
    );
    expect(refusalWords({ status: 409, code: "history_too_large", text: "", body: { thread: 4, size: 90000, bound: 60000 } }, "start-fresh")).toContain("The summary is 90,000 characters");
  });

  it("the unreachable kernel is plain words, and any other code keeps refusalOf's text", () => {
    expect(refusalWords({ status: 0, code: "unreachable", text: "The kernel is not reachable." })).toBe("The kernel isn't reachable, so nothing was sent. Your text is kept; try again once it's back.");
    expect(refusalWords({ status: 0, code: "unreachable", text: "" }, "summarize")).toContain("nothing was summarized");
    expect(refusalWords({ status: 400, code: "invalid_body", text: "text must be 1-8000 characters (invalid_body)" })).toBe("text must be 1-8000 characters (invalid_body)");
  });

  it("never prints a currency", () => {
    for (const [code, body] of codes) expect(refusalWords({ status: 409, code, text: "", body })).not.toContain("$");
  });
});

describe("the size hint", () => {
  it("only a positive safe integer is a hint, as in Settings → Threads; unset never highlights", () => {
    expect(hintFromThreads(40000)).toBe(40000);
    expect(hintFromThreads(1)).toBe(1);
    expect(hintFromThreads(null)).toBeNull();
    expect(hintFromThreads(undefined)).toBeNull();
    expect(hintFromThreads(0)).toBeNull();
    expect(hintFromThreads(-5)).toBeNull();
    expect(hintFromThreads(1.5)).toBeNull();
    expect(hintFromThreads(Number.NaN)).toBeNull();
    expect(hintFromThreads(Number.POSITIVE_INFINITY)).toBeNull();
    expect(hintFromThreads("40000")).toBeNull();
    // The same values read the same in Settings → Threads.
    for (const v of [40000, 1, null, undefined, 0, -5, 1.5, Number.NaN, "40000"]) expect(hintFromThreads(v)).toBe(hintOf({ thread_summarize_hint_tokens: v }) ?? null);
    expect(pastHint(figures(), null)).toBe(false);
    expect(pastHint(figures({ latest_reply_tokens: 52000 }), 40000)).toBe(true);
    expect(pastHint(figures({ latest_reply_tokens: 40000 }), 40000)).toBe(false);
    expect(pastHint(figures({ latest_reply_tokens: null }), 40000)).toBe(false);
  });
});

describe("words", () => {
  it("titles, first lines and counts", () => {
    expect(threadTitle(figures(), 4)).toBe("Plan the release");
    expect(threadTitle(undefined, 4, "From the session")).toBe("From the session");
    expect(threadTitle(undefined, 4)).toBe("Thread #4");
    expect(firstLine("\n  First line  \nsecond")).toBe("First line");
    expect(firstLine("x".repeat(100))).toHaveLength(80);
    expect(firstLine(null)).toBe("");
    expect(messagesText(1)).toBe("1 message");
    expect(messagesText(1200)).toBe("1,200 messages");
  });
});

describe("joinThreads", () => {
  it("puts a reply right after its thread's last row; everything else keeps its order", () => {
    const rows = [
      { id: 1, t: 1 },
      { id: 2, t: 2 },
      { id: 3, t: undefined },
      { id: 4, t: 1 },
      { id: 5, t: 2 },
      { id: 6, t: 1 },
    ];
    expect(joinThreads(rows, (r) => r.t).map((r) => r.id)).toEqual([1, 4, 6, 2, 5, 3]);
  });
});

describe("summarized-into memory", () => {
  it("is per bridge and per agent", () => {
    const other: StudioBridge = { ...INERT_BRIDGE };
    rememberSummarized(INERT_BRIDGE, "wright", 4, 20);
    expect(summarizedInto(INERT_BRIDGE, "wright", 4)).toBe(20);
    expect(summarizedInto(INERT_BRIDGE, "pim", 4)).toBeUndefined();
    expect(summarizedInto(other, "wright", 4)).toBeUndefined();
  });
});
