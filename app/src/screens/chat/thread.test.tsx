// @vitest-environment jsdom
// Chat's thread: message states, the reply bubble, event cards, the inline
// approval at the end, inert untrusted text, paging back, and routing.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ALWAYS_INELIGIBLE } from "./cards";
import { WRIGHT_EMPTY } from "./Thread";
import { ok } from "../../store/fake-bridge";
import { approval, eventItem, kit, message, playbook, renderChat, resetChat, thread, trigger, go } from "./testkit";
import type { Kit } from "./testkit";

afterEach(resetChat);

const XSS_IMG = "<img src=x onerror=alert(1)>";
const XSS_LINK = "[x](javascript:alert(1))";

/** The feed's event_done: the store refetches every loaded thread. */
async function done(k: Kit): Promise<void> {
  await act(async () => {
    k.fake.emit({ type: "event", id: 1, at: new Date().toISOString(), kind: "event_done", session_id: null, task_id: null, payload: {} });
  });
}

function shown(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-item]")].map((el) => el.getAttribute("data-item"));
}

/** Focus a button the way a keyboard owner does, then press it. */
async function focusAndClick(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.focus();
    fireEvent.click(button);
  });
}

async function click(name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("thread", () => {
  it("reply bubble appears only when replied", async () => {
    const row = message(1, { status: "queued", text: "Summarise my day", reply_text: "Your day: three meetings." });
    const k = kit({ threads: { wright: thread([row]) } });
    await renderChat(k);
    await screen.findByText("Summarise my day");
    expect(screen.getByText("Wright is working on it")).toBeTruthy();
    expect(screen.queryByText("Your day: three meetings.")).toBeNull();

    // The row turns replied; the feed's event_done refetches every loaded thread.
    k.state.threads.wright = thread([{ ...row, status: "replied" }]);
    await act(async () => {
      k.fake.emit({ type: "event", id: 1, at: new Date().toISOString(), kind: "event_done", session_id: null, task_id: null, payload: {} });
    });
    expect(await screen.findByText("Your day: three meetings.")).toBeTruthy();
    expect(screen.queryByText("Wright is working on it")).toBeNull();
  });

  it("renders items oldest first, with event cards between messages", async () => {
    const k = kit({
      threads: { wright: thread([message(1, { text: "first" }), eventItem(2, "session_status", "Session 4 started"), message(3, { text: "second" })]) },
    });
    const view = await renderChat(k);
    await screen.findByText("second");
    const items = [...view.container.querySelectorAll("[data-item]")].map((el) => el.getAttribute("data-item"));
    expect(items).toEqual(["message:1", "event:2", "message:3"]);
    const line = screen.getByRole("status", { name: "" });
    expect(line.getAttribute("data-kind")).toBe("session");
    expect(line.textContent).toContain("Session 4 started");
  });

  it("a message from another agent is a quoted block, never the owner's words", async () => {
    const k = kit({ threads: { pim: thread([message(1, { agent: "pim", from_agent: "wright", source: "agent:wright", text: "Check PR 12" })]) } });
    const view = await renderChat(k, "#/chat/pim");
    await screen.findByText("Check PR 12");
    const quote = view.container.querySelector("blockquote.chat-quote");
    expect(quote?.textContent).toContain("From Wright · agent:wright");
    expect(view.container.querySelector('[data-from="user"]')).toBeNull();
  });

  it("pending approval inline at the end, Allow once approves once", async () => {
    const k = kit({ threads: { wright: thread([message(1), eventItem(2, "approval_requested", "Wright requested github_comment")], { pending_approvals: [approval(7)] }) } });
    const view = await renderChat(k);
    await screen.findByText("Post a comment (approval 7)");
    const list = view.container.querySelector("ol.chat-items");
    expect(list?.lastElementChild?.getAttribute("data-testid")).toBe("chat-pending-approval");
    await click(/^Allow once/);
    await waitFor(() => expect(k.posted("POST /approvals/:id/approve")).toHaveLength(1));
    const req = k.posted("POST /approvals/:id/approve")[0];
    expect(req?.params).toEqual({ id: 7 });
    expect(req?.body).toEqual({ decision: "once" });
  });

  it("Deny posts deny", async () => {
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(7)] }) } });
    await renderChat(k);
    await screen.findByText("Post a comment (approval 7)");
    await click(/^Deny/);
    await waitFor(() => expect(k.posted("POST /approvals/:id/deny")).toHaveLength(1));
    expect(k.posted("POST /approvals/:id/deny")[0]?.params).toEqual({ id: 7 });
    expect(k.posted("POST /approvals/:id/approve")).toHaveLength(0);
  });

  it("another agent's approval is not shown", async () => {
    const k = kit({
      threads: {
        wright: thread([message(1)], {
          pending_approvals: [approval(8, { requesting_agent: "pim" }), approval(9, { requesting_agent: "pim", action: "kernel_agent_create", display: "charter for someone" })],
        }),
      },
    });
    await renderChat(k);
    await screen.findByText("answer 1");
    expect(screen.queryByText("Post a comment (approval 8)")).toBeNull();
    expect(screen.queryByText("charter for someone")).toBeNull();
    expect(screen.queryByTestId("chat-pending-approval")).toBeNull();
  });

  it("ineligible Always calls no route", async () => {
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(7, { playbook: null })] }) } });
    await renderChat(k);
    await screen.findByText("Post a comment (approval 7)");
    await click(/^Always/);
    expect((await screen.findByRole("alert")).textContent).toBe(ALWAYS_INELIGIBLE);
    expect(k.posted("POST /approvals/:id/approve")).toHaveLength(0);
  });

  it("409 always_not_supported shows the kernel's message", async () => {
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(7, { playbook: { id: 3, slug: "pr-review", version: 1 } })] }) } });
    k.state.posts["POST /approvals/:id/approve"] = () => ({ ok: false, status: 409, body: { error: "always_not_supported", message: "This action can only be approved once." } });
    await renderChat(k);
    expect(await screen.findByText("From playbook pr-review")).toBeTruthy();
    await click(/^Always/);
    expect((await screen.findByRole("alert")).textContent).toContain("This action can only be approved once.");
    expect(k.posted("POST /approvals/:id/approve")[0]?.body).toEqual({ decision: "always" });
    // The card stays.
    expect(screen.getByText("Post a comment (approval 7)")).toBeTruthy();
  });

  it("HTML and javascript: links render inert", async () => {
    const k = kit({
      threads: {
        wright: thread([message(1, { text: XSS_LINK, reply_text: `${XSS_IMG} ${XSS_LINK}` }), eventItem(2, "playbook_created", `${XSS_IMG} ${XSS_LINK}`, {})], {
          pending_approvals: [approval(7, { display: `${XSS_IMG} ${XSS_LINK}` }), approval(9, { action: "kernel_agent_create", display: `${XSS_IMG}\n${XSS_LINK}` })],
        }),
      },
    });
    const view = await renderChat(k);
    await screen.findAllByText(new RegExp("onerror=alert"));
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(view.container.querySelectorAll("a")).toHaveLength(0);
    // Each surface shows the literal text.
    expect(view.container.textContent).toContain(XSS_IMG);
    expect(screen.getByRole("status", { name: "" }).textContent).toContain(XSS_IMG);
    expect(view.container.querySelector(".chat-charter-display")?.textContent).toBe(`${XSS_IMG}\n${XSS_LINK}`);
  });

  it("failed shows the kernel's reason; parked row shows retry time", async () => {
    const k = kit({
      threads: {
        wright: thread([
          message(1, { status: "failed", detail: "session_failed: tool crashed", reply_text: null }),
          message(2, { status: "parked", detail: "admission_refused: cap; retry at 2026-10-22T09:00:00.000Z", reply_text: null }),
          message(3, { status: "parked", detail: "admission_refused: cap; retry time unknown", reply_text: null }),
        ]),
      },
    });
    const view = await renderChat(k);
    expect(await screen.findByText("session_failed: tool crashed")).toBeTruthy();
    const parked = view.container.querySelector('[data-message="2"] .chat-state');
    expect(parked?.textContent).toMatch(/^Paused: retries at /);
    expect(parked?.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-22T09:00:00.000Z");
    expect(view.container.querySelector('[data-message="3"] .chat-state')?.textContent).toBe("Paused: retry time unknown");
  });

  it("Load earlier sends before and prepends", async () => {
    const k = kit({
      threads: { wright: thread([message(5, { text: "newer" })], { next_before: "cursor-1" }) },
      pages: { "wright cursor-1": thread([message(2, { text: "older" })], { next_before: null }) },
    });
    const view = await renderChat(k);
    await screen.findByText("newer");
    await click(/^Load earlier/);
    await screen.findByText("older");
    const page = k.fake.requestsTo("GET /threads/:agent").find((r) => r.req.query?.before !== undefined);
    expect(page?.req.params).toEqual({ agent: "wright" });
    expect(page?.req.query).toEqual({ before: "cursor-1" });
    const items = [...view.container.querySelectorAll("[data-item]")].map((el) => el.getAttribute("data-item"));
    expect(items).toEqual(["message:2", "message:5"]);
    // The older page was the last: the button goes.
    expect(screen.queryByRole("button", { name: /^Load earlier/ })).toBeNull();
  });

  it("after Load earlier, an item that slides off the live first page stays in view", async () => {
    const k = kit({
      threads: { wright: thread([message(2, { text: "two" }), message(3, { text: "three" })], { next_before: "c1" }) },
      pages: { "wright c1": thread([message(1, { text: "one" })], { next_before: null }) },
    });
    const view = await renderChat(k);
    await screen.findByText("three");
    await click(/^Load earlier/);
    await screen.findByText("one");
    expect(shown(view.container)).toEqual(["message:1", "message:2", "message:3"]);
    // One new item: the live page (two items) now starts at 3, so 2 is in neither page.
    k.state.threads.wright = thread([message(3, { text: "three" }), message(4, { text: "four" })], { next_before: "c2" });
    await done(k);
    await screen.findByText("four");
    expect(shown(view.container)).toEqual(["message:1", "message:2", "message:3", "message:4"]);
  });

  it("an item that slides off the live page while the first Load earlier is in flight stays in view", async () => {
    const k = kit({ threads: { wright: thread([message(2, { text: "two" }), message(3, { text: "three" })], { next_before: "c1" }) } });
    let release: () => void = () => undefined;
    const held = new Promise<void>((go) => {
      release = go;
    });
    k.fake.route("GET /threads/:agent", async (req) => {
      if (req.query?.before === undefined) return ok(k.state.threads.wright);
      await held;
      return ok(thread([message(1, { text: "one" })], { next_before: null }));
    });
    const view = await renderChat(k);
    await screen.findByText("three");
    await click(/^Load earlier/);
    // The live page moves on while the page is held: 2 leaves it before any older page is loaded.
    k.state.threads.wright = thread([message(3, { text: "three" }), message(4, { text: "four" })], { next_before: "c2" });
    await done(k);
    await screen.findByText("four");
    await act(async () => release());
    await screen.findByText("one");
    expect(shown(view.container)).toEqual(["message:1", "message:2", "message:3", "message:4"]);
    // The page was the last: nothing else reaches 2, so it must be kept, and kept once.
    expect(screen.queryByRole("button", { name: /^Load earlier/ })).toBeNull();
    await done(k);
    expect(shown(view.container)).toEqual(["message:1", "message:2", "message:3", "message:4"]);
  });

  it("a card keeps its refusal and its in-flight guard across Load earlier", async () => {
    const k = kit({
      threads: { wright: thread([eventItem(10, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 })], { next_before: "c1" }) },
      pages: { "wright c1": thread([message(1, { text: "older" })], { next_before: null }) },
      playbooks: [playbook(3)],
    });
    k.state.posts["POST /playbooks/:id/off"] = () => ({ ok: false, status: 409, body: { error: "not_enabled", message: "pb-3 is disabled" } });
    let release: () => void = () => undefined;
    k.fake.route("POST /playbooks/:id/run", async () => {
      await new Promise<void>((go) => {
        release = go;
      });
      return { ok: true, status: 200, body: {} };
    });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /^Turn off/ }));
    });
    expect((await within(card).findByRole("alert")).textContent).toBe("pb-3 is disabled (not_enabled)");
    // A Run now in flight when the older page lands.
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /^Run now/ }));
    });
    expect(k.posted("POST /playbooks/:id/run")).toHaveLength(1);
    await click(/^Load earlier/);
    await screen.findByText("older");
    // The same card, not a remount: its refusal is still there and its guard still holds.
    expect(screen.getByRole("region", { name: "Playbook pb-3" })).toBe(card);
    expect(within(card).getByRole("alert").textContent).toBe("pb-3 is disabled (not_enabled)");
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /^Run now/ }));
    });
    expect(k.posted("POST /playbooks/:id/run")).toHaveLength(1);
    await act(async () => release());
  });

  it("the last Load earlier moves focus to the thread, not <body>", async () => {
    const k = kit({
      threads: { wright: thread([message(5, { text: "newer" })], { next_before: "cursor-1" }) },
      pages: { "wright cursor-1": thread([message(2, { text: "older" })], { next_before: null }) },
    });
    const view = await renderChat(k);
    await screen.findByText("newer");
    await focusAndClick(screen.getByRole("button", { name: /^Load earlier/ }));
    await screen.findByText("older");
    expect(screen.queryByRole("button", { name: /^Load earlier/ })).toBeNull();
    expect(document.activeElement).toBe(view.container.querySelector("ol.chat-items"));
  });

  it("two Load earlier clicks in one tick send the cursor once", async () => {
    const k = kit({
      threads: { wright: thread([message(5, { text: "newer" })], { next_before: "cursor-1" }) },
      pages: { "wright cursor-1": thread([message(2, { text: "older" })], { next_before: null }) },
    });
    await renderChat(k);
    await screen.findByText("newer");
    const button = screen.getByRole("button", { name: /^Load earlier/ });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await screen.findByText("older");
    expect(k.fake.requestsTo("GET /threads/:agent").filter((r) => r.req.query?.before !== undefined)).toHaveLength(1);
  });

  it("a decided approval's card hands focus to the next pending card, then to the composer", async () => {
    const k = kit({ threads: { wright: thread([message(1)], { pending_approvals: [approval(7), approval(8)] }) } });
    k.state.posts["POST /approvals/:id/approve"] = (req) => {
      const left = (k.state.threads.wright?.pending_approvals ?? []).filter((a) => a.id !== req.params?.id);
      k.state.threads.wright = thread([message(1)], { pending_approvals: left });
      return { ok: true, status: 200, body: {} };
    };
    const view = await renderChat(k);
    await screen.findByText("Post a comment (approval 8)");
    const card = (id: number) => view.container.querySelector(`[data-approval="${id}"]`) as HTMLElement;
    await focusAndClick(within(card(7)).getByRole("button", { name: /^Allow once/ }));
    await waitFor(() => expect(screen.queryByText("Post a comment (approval 7)")).toBeNull());
    expect(document.activeElement).toBe(within(card(8)).getByRole("button", { name: /^Allow once/ }));
    await focusAndClick(within(card(8)).getByRole("button", { name: /^Allow once/ }));
    await waitFor(() => expect(screen.queryByTestId("chat-pending-approval")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message Wright" }));
  });

  it("a Set's playbook_updated moves the playbook card after it, the same card, with Set still focused", async () => {
    const created = eventItem(10, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 });
    const later = message(11, { text: "later" });
    const k = kit({ threads: { wright: thread([created, later]) }, playbooks: [playbook(3)] });
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    const button = within(card).getByRole("button", { name: /^Set priority/ });
    await act(async () => button.focus());
    k.state.threads.wright = thread([created, later, eventItem(12, "playbook_updated", "Playbook pb-3 updated", { playbook_id: 3 })]);
    await done(k);
    await screen.findByText("Playbook pb-3 updated");
    // Moved, not remounted: a remount would drop the focused button and send focus to the composer.
    expect(view.container.querySelector('[data-item="event:12"] + li')?.contains(card)).toBe(true);
    expect(screen.getByRole("region", { name: "Playbook pb-3" })).toBe(card);
    expect(document.activeElement).toBe(button);
  });

  it("the triggers resource asks GET /triggers with all=1, so an off or spent trigger still has its card", async () => {
    const k = kit({ threads: { wright: thread([eventItem(1, "trigger_registered", "Trigger 5 registered", { trigger_id: 5 })]) }, triggers: [trigger(5, { kind: "once", enabled: false })] });
    await renderChat(k);
    await screen.findByRole("region", { name: "Trigger 5" });
    const reads = k.fake.requestsTo("GET /triggers");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.req.query).toEqual({ all: "1" });
  });

  it("a registered trigger that never fired has its card under the registered line: schedule, next fire, on, On and Off", async () => {
    const at = "2026-10-22T17:00:00.000Z";
    const k = kit({
      threads: { wright: thread([message(1, { text: "Remind me at 17:00" }), eventItem(2, "trigger_registered", "Trigger 5 registered", { trigger_id: 5 }), message(3, { text: "later" })]) },
      triggers: [trigger(5, { kind: "once", spec: { at }, next_fire_at: at })],
    });
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Trigger 5" });
    expect(card.closest("li")?.previousElementSibling?.getAttribute("data-item")).toBe("event:2");
    // The registered line reads as a playbook line, as a fired one does.
    expect(view.container.querySelector('[data-item="event:2"] [data-kind]')?.getAttribute("data-kind")).toBe("playbook");
    expect(view.container.querySelector('[data-item="event:2"]')?.textContent).toContain("Trigger 5 registered");
    expect(card.getAttribute("data-state")).toBe("on");
    expect(card.querySelector('[data-field="Schedule"]')?.textContent).toMatch(/^once at /);
    expect(card.querySelector('[data-field="Next fire"] time')?.getAttribute("dateTime")).toBe(at);
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["On", "Off"]);
  });

  it("a cron trigger registered once and fired three times has one card, directly after the third firing", async () => {
    const k = kit({
      threads: {
        wright: thread([
          eventItem(1, "trigger_registered", "Trigger 5 registered", { trigger_id: 5 }),
          eventItem(2, "trigger_fired", "Trigger 5 fired (wake)", { trigger_id: 5 }),
          message(3),
          eventItem(4, "trigger_fired", "Trigger 5 fired (wake)", { trigger_id: 5 }),
          eventItem(5, "trigger_fired", "Trigger 5 fired (wake)", { trigger_id: 5 }),
          message(6),
        ]),
      },
      triggers: [trigger(5)],
    });
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Trigger 5" });
    expect(view.container.querySelectorAll('[data-trigger="5"]')).toHaveLength(1);
    expect(card.closest("li")?.previousElementSibling?.getAttribute("data-item")).toBe("event:5");
  });

  it("a row turning replied keeps the end in view when the owner was at the end", async () => {
    const row = message(1, { status: "queued", reply_text: null });
    const k = kit({ threads: { wright: thread([row]) } });
    const view = await renderChat(k);
    await screen.findByText("Wright is working on it");
    const scroller = view.container.querySelector(".chat-scroll") as HTMLElement;
    let height = 300;
    const pins: number[] = [];
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => 0, set: (v: number) => pins.push(v) });
    // Same item count: only the row's status (and its height) changes.
    height = 520;
    k.state.threads.wright = thread([{ ...row, status: "replied", reply_text: "A long reply." }]);
    await done(k);
    await screen.findByText("A long reply.");
    expect(pins).toContain(520);
  });

  it("no Load earlier when next_before is null", async () => {
    const k = kit({ threads: { wright: thread([message(1)]) } });
    await renderChat(k);
    await screen.findByText("answer 1");
    expect(screen.queryByRole("button", { name: /^Load earlier/ })).toBeNull();
  });

  it("#/chat/pim opens Pim's thread with an Open in Team button", async () => {
    const k = kit({ threads: { pim: thread([message(1, { agent: "pim", reply_text: "pim says hi" })]) } });
    await renderChat(k, "#/chat/pim");
    expect(await screen.findByText("pim says hi")).toBeTruthy();
    expect(screen.getByText("with Pim")).toBeTruthy();
    await click("Open in Team");
    expect(window.location.hash).toBe("#/team");
  });

  it("unknown #/chat/<id> falls back to Wright", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k, "#/chat/nobody");
    expect(await screen.findByText(WRIGHT_EMPTY)).toBeTruthy();
    expect(screen.getByText("with Wright")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open in Team" })).toBeNull();
    expect(k.fake.requestsTo("GET /threads/:agent").map((r) => r.req.params?.agent)).not.toContain("nobody");
  });

  it("the designed states: loading, then empty; and an error", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    k.fake.route("GET /threads/:agent", async () => {
      await held;
      return { ok: true, status: 200, body: thread([]) };
    });
    await renderChat(k);
    expect(screen.getByTestId("chat-loading")).toBeTruthy();
    await act(async () => release());
    expect(await screen.findByTestId("chat-empty")).toBeTruthy();

    resetChat();
    const broken = kit();
    broken.fake.route("GET /threads/:agent", () => ({ ok: false, status: 500, body: { error: "internal", message: "database is locked" } }));
    await renderChat(broken);
    expect((await screen.findByTestId("chat-error")).textContent).toContain("database is locked");
  });

  it("the title row shows the agent's state, and a pending approval reads waiting on you", async () => {
    const k = kit({ threads: { wright: thread([]) }, approvals: [approval(7)] });
    const view = await renderChat(k);
    await waitFor(() => expect(within(view.container.querySelector(".chat-titlerow") as HTMLElement).getByText(/waiting on you/)).toBeTruthy());
  });

  it("keeps the thread when the hash moves to another screen and back", async () => {
    const k = kit({ threads: { wright: thread([message(1)]) } });
    await renderChat(k);
    await screen.findByText("answer 1");
    await go("#/chat/pim");
    await go("#/chat");
    expect(await screen.findByText("answer 1")).toBeTruthy();
  });
});
