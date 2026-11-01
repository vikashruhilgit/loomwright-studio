// The history's sentences and actors: what each event reads as, who it happened under, and that no JSON object
// from a payload can reach the screen.
import { describe, expect, it } from "vitest";
import type { EventFrame } from "../../api/contract";
import { actorOf, historyLine } from "./history";
import type { HistoryContext } from "./history";

const ESC = String.fromCharCode(0x1b);
const RLO = String.fromCharCode(0x202e);

function event(kind: string, payload: unknown, sessionId: number | null = null, id = 5): EventFrame {
  return { type: "event", id, at: "2026-10-30T12:00:00.000Z", kind, session_id: sessionId, task_id: 9, payload };
}

const none: HistoryContext = { sessions: [], card: { creator_agent: null, creator_session: null } };

describe("the sentences", () => {
  it("reads task_created as Created “<title>” · state <state>", () => {
    expect(historyLine(event("task_created", { title: "Review PR #3", state: "working" }), none).sentence).toBe("Created “Review PR #3” · state working");
    expect(historyLine(event("task_created", { title: "Decide how often", state: "waiting on owner" }), none).sentence).toBe("Created “Decide how often” · state waiting on owner");
  });

  it("reads task_updated as Changed <fields> · state <state>, with the state only when the event has one", () => {
    expect(historyLine(event("task_updated", { fields: ["state", "next_check_at"], state: "parked" }), none).sentence).toBe("Changed state, next_check_at · state parked");
    expect(historyLine(event("task_updated", { fields: ["title"] }), none).sentence).toBe("Changed title");
  });

  it("still reads a sentence when a payload lacks the usual fields", () => {
    expect(historyLine(event("task_created", {}), none).sentence).toBe("Created the task");
    expect(historyLine(event("task_created", null), none).sentence).toBe("Created the task");
    expect(historyLine(event("task_updated", { fields: "state" }), none).sentence).toBe("Changed the task");
    expect(historyLine(event("task_updated", [1, 2]), none).sentence).toBe("Changed the task");
    expect(historyLine(event("task_created", { title: 5, state: {} }), none).sentence).toBe("Created the task");
  });

  it("reads an event kind with no sentence as '<kind> recorded', with no payload text", () => {
    const line = historyLine(event("draft_output_recorded", { note: "Draft review recorded", nested: { a: 1 } }), none);
    expect(line.sentence).toBe("draft_output_recorded recorded");
    expect(historyLine(event("trigger_fired", {}), none).sentence).toBe("trigger_fired recorded");
    expect(historyLine(event("trigger_fired", null), none).sentence).toBe("trigger_fired recorded");
  });

  it("never shows a JSON object: no brace and no quoted key in any line, whatever the kind or payload", () => {
    const payloads = [{ title: "x", state: "y", extra: { deep: [1, 2] } }, { fields: ["a"], note: "n" }, { a: 1 }, null, [], "text", 7];
    for (const kind of ["task_created", "task_updated", "session_started", "anything_new"]) {
      for (const payload of payloads) {
        const line = historyLine(event(kind, payload), none);
        const shown = `${line.kind} ${line.actor} ${line.sentence}`;
        expect(shown, `${kind} ${JSON.stringify(payload)}`).not.toContain("{");
        expect(shown).not.toContain('"title":');
        expect(shown).not.toContain("}");
      }
    }
  });

  it("escapes every untrusted word and cuts a long one", () => {
    const hostile = historyLine(event(`kind${ESC}`, null), none);
    expect(hostile.kind).toBe("kind\\x1b");
    expect(hostile.sentence).toBe("kind\\x1b recorded");
    const made = historyLine(event("task_created", { title: `Pick${ESC}[31m${RLO}`, state: `wa${ESC}it` }), none);
    expect(made.sentence).toBe("Created “Pick\\x1b[31m\\u202e” · state wa\\x1bit");
    // eslint-disable-next-line no-control-regex
    expect(`${made.sentence}${made.kind}`).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
    const long = historyLine(event("task_created", { title: "x".repeat(1000), state: "working" }), none);
    expect(long.sentence.length).toBeLessThan(300);
    expect(long.sentence.endsWith("… (cut)")).toBe(true);
  });

  it("keeps the event's id and a clock time", () => {
    const line = historyLine(event("task_created", {}, null, 77), none);
    expect(line.id).toBe(77);
    expect(line.time).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(historyLine({ ...event("task_created", {}), at: "not a time" }, none).time).toBe("");
  });
});

describe("the actor", () => {
  const ctx: HistoryContext = { sessions: [{ id: 41, agent: "mason" }, { id: 42, agent: null }], card: { creator_agent: "wright", creator_session: 81 } };

  it("is the agent of the event's session, from the history's sessions", () => {
    expect(actorOf(event("x", {}, 41), ctx)).toBe("mason");
  });

  it("is the card's creator agent when the session is its creator_session (not among the history's sessions)", () => {
    expect(actorOf(event("task_created", {}, 81), ctx)).toBe("wright");
  });

  it("is 'kernel' when the event has no session", () => {
    expect(actorOf(event("trigger_fired", {}, null), ctx)).toBe("kernel");
  });

  it("is 'session #N' for any other session, and when the session's agent is unknown", () => {
    expect(actorOf(event("x", {}, 99), ctx)).toBe("session #99");
    expect(actorOf(event("x", {}, 42), ctx)).toBe("session #42");
    // The creator session with no creator agent recorded.
    expect(actorOf(event("x", {}, 81), { sessions: [], card: { creator_agent: null, creator_session: 81 } })).toBe("session #81");
  });

  it("escapes the agent", () => {
    expect(actorOf(event("x", {}, 41), { sessions: [{ id: 41, agent: `ma${ESC}son` }], card: { creator_agent: null, creator_session: null } })).toBe("ma\\x1bson");
  });
});
