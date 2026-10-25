// @vitest-environment jsdom
// Chat's thread: message states, the reply bubble, event cards, the inline
// approval at the end, inert untrusted text, paging back, routing, and the
// `#/chat?playbook=<id>` route that scrolls to a playbook's card.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALWAYS_INELIGIBLE } from "./cards";
import { playbookCardHash, playbookFromHash } from "./model";
import { WRIGHT_EMPTY } from "./Thread";
import { ok } from "../../store/fake-bridge";
import { agent, approval, eventItem, kit, message, playbook, renderChat, resetChat, thread, trigger, go } from "./testkit";
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
    expect(await screen.findByText("Requested by playbook pr-review v1")).toBeTruthy();
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
    // As the kernel does: every Set writes playbook_updated, so the card moves after the new event.
    k.state.posts["POST /playbooks/:id/set"] = () => {
      k.state.playbooks = [playbook(3, { priority: "high", priority_set_by: "owner" })];
      k.state.threads.wright = thread([created, later, eventItem(12, "playbook_updated", "Playbook pb-3 updated", { playbook_id: 3 })]);
      return ok({});
    };
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    // The row path from the keyboard: Edit priority, high, Set priority.
    await focusAndClick(within(card).getByRole("button", { name: "Edit priority" }));
    await act(async () => {
      fireEvent.change(within(card).getByRole("combobox", { name: "New priority" }), { target: { value: "high" } });
    });
    await focusAndClick(within(card).getByRole("button", { name: "Set priority" }));
    await waitFor(() => expect(k.posted("POST /playbooks/:id/set").map((r) => r.body)).toEqual([{ field: "priority", value: "high" }]));
    await done(k);
    await screen.findByText("Playbook pb-3 updated");
    // Moved, not remounted: a remount would drop the focused button and send focus to the composer.
    expect(view.container.querySelector('[data-item="event:12"] + li')?.contains(card)).toBe(true);
    expect(screen.getByRole("region", { name: "Playbook pb-3" })).toBe(card);
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Edit priority" }));
  });

  it("Turn off keeps the card: disabled, no Run now or Turn off, the Turn on gap, every row's Edit, and its trigger card", async () => {
    const k = kit({
      threads: { wright: thread([eventItem(10, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 })]) },
      playbooks: [playbook(3, { trigger_id: 5 })],
      triggers: [trigger(5)],
    });
    // As the kernel does: off turns the playbook disabled, and `GET /playbooks?all=1` still lists it.
    k.state.posts["POST /playbooks/:id/off"] = () => {
      k.state.playbooks = [playbook(3, { trigger_id: 5, status: "disabled" })];
      return ok({});
    };
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    expect(card.textContent).not.toContain("Turn on: not available from the kernel");
    await focusAndClick(within(card).getByRole("button", { name: /^Turn off/ }));
    await waitFor(() => expect(card.querySelector(".chat-card-head")?.textContent).toContain("disabled"));
    // The focused Turn off unmounted: focus stays on the card (its first row's Edit), not the composer.
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Edit dedupe key" }));
    expect(k.posted("POST /playbooks/:id/off").map((r) => r.params)).toEqual([{ id: 3 }]);
    expect(screen.getByRole("region", { name: "Playbook pb-3" })).toBe(card);
    expect(within(card).queryByRole("button", { name: /^Run now/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /^Turn off/ })).toBeNull();
    expect(card.textContent).toContain("Turn on: not available from the kernel");
    expect(within(card).queryByRole("button", { name: /^Turn on/ })).toBeNull();
    for (const row of ["dedupe key", "priority", "model", "token limit per day"]) expect(within(card).getByRole("button", { name: `Edit ${row}` })).toBeTruthy();
    const nested = within(card).getByRole("region", { name: "Trigger 5" });
    expect(within(nested).getAllByRole("button").map((b) => b.textContent)).toEqual(["On", "Off"]);
    for (const read of k.fake.requestsTo("GET /playbooks")) expect(read.req.query).toEqual({ all: "1" });
  });

  it("Turn off with the dedupe key editor open leaves focus in the card, on that editor's field, not the composer", async () => {
    const k = kit({
      threads: { wright: thread([eventItem(10, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 })]) },
      playbooks: [playbook(3, { trigger_id: 5 })],
      triggers: [trigger(5)],
    });
    k.state.posts["POST /playbooks/:id/off"] = () => {
      k.state.playbooks = [playbook(3, { trigger_id: 5, status: "disabled" })];
      return ok({});
    };
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    await focusAndClick(within(card).getByRole("button", { name: "Edit dedupe key" }));
    await focusAndClick(within(card).getByRole("button", { name: /^Turn off/ }));
    await waitFor(() => expect(card.querySelector(".chat-card-head")?.textContent).toContain("disabled"));
    expect(document.activeElement).toBe(within(card).getByRole("textbox", { name: "New dedupe key" }));
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Message Wright" }));
  });

  /**
   * Turn off whose answer is held: the kernel has already disabled the playbook, and the feed's
   * playbook_disabled refetches the list, which lands before the POST answers.
   */
  async function offAnsweredAfterTheList(withEditor: boolean): Promise<{ readonly k: Kit; readonly card: HTMLElement; readonly release: () => Promise<void> }> {
    const k = kit({
      threads: { wright: thread([eventItem(10, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 })]) },
      playbooks: [playbook(3, { trigger_id: 5 })],
      triggers: [trigger(5)],
    });
    let answer: () => void = () => undefined;
    k.fake.route("POST /playbooks/:id/off", async () => {
      k.state.playbooks = [playbook(3, { trigger_id: 5, status: "disabled" })];
      await new Promise<void>((go) => {
        answer = go;
      });
      return ok({});
    });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    if (withEditor) await focusAndClick(within(card).getByRole("button", { name: "Edit dedupe key" }));
    await focusAndClick(within(card).getByRole("button", { name: /^Turn off/ }));
    await act(async () => {
      k.fake.emit({ type: "event", id: 2, at: new Date().toISOString(), kind: "playbook_disabled", session_id: null, task_id: null, payload: {} });
    });
    await waitFor(() => expect(card.querySelector(".chat-card-head")?.textContent).toContain("disabled"));
    // The list landed first: Turn off is gone while its write is still pending.
    expect(within(card).queryByRole("button", { name: /^Turn off/ })).toBeNull();
    return { k, card, release: async () => act(async () => answer()) };
  }

  it("Turn off whose refetched disabled list lands before the off answer still leaves focus on the card's first Edit", async () => {
    const { k, card, release } = await offAnsweredAfterTheList(false);
    const edit = within(card).getByRole("button", { name: "Edit dedupe key" });
    expect(document.activeElement).toBe(edit);
    await release();
    await waitFor(() => expect(k.posted("POST /playbooks/:id/off")).toHaveLength(1));
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Edit dedupe key" }));
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Message Wright" }));
    expect(within(card).queryByRole("alert")).toBeNull();
  });

  it("Turn off whose refetched disabled list lands before the off answer, with the dedupe key editor open, leaves focus on its field", async () => {
    const { card, release } = await offAnsweredAfterTheList(true);
    expect(document.activeElement).toBe(within(card).getByRole("textbox", { name: "New dedupe key" }));
    await release();
    expect(document.activeElement).toBe(within(card).getByRole("textbox", { name: "New dedupe key" }));
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Message Wright" }));
  });

  it("a disabled playbook's row Set still posts (the kernel keeps it disabled)", async () => {
    const k = kit({ threads: { wright: thread([eventItem(10, "playbook_created", "created", { playbook_id: 3 })]) }, playbooks: [playbook(3, { status: "disabled" })] });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    await focusAndClick(within(card).getByRole("button", { name: "Edit priority" }));
    await focusAndClick(within(card).getByRole("button", { name: "Set priority" }));
    await waitFor(() => expect(k.posted("POST /playbooks/:id/set").map((r) => r.body)).toEqual([{ field: "priority", value: "normal" }]));
  });

  it("a kernel approval decision (source approval:<id>) renders as the kernel's card, never the owner's bubble", async () => {
    const decision = message(1, { source: "approval:6", text: "approved approval 6: github_comment.", reply_text: "Posted the review." });
    const k = kit({ threads: { wright: thread([decision]) } });
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Kernel decision, approval 6" });
    expect(card.textContent).toContain("Kernel");
    expect(within(card).getByText("approved approval 6: github_comment.")).toBeTruthy();
    expect(view.container.querySelector('[data-message="1"] [data-from="user"]')).toBeNull();
    expect(within(view.container.querySelector('[data-message="1"]') as HTMLElement).queryByText("You")).toBeNull();
    // The agent's reply under it renders as today.
    expect(screen.getByText("Posted the review.")).toBeTruthy();
  });

  it("an ask stays the owner's bubble, even one whose text reads like a decision", async () => {
    const k = kit({ threads: { wright: thread([message(1, { source: "ask", text: "Summarise my day" }), message(2, { source: "ask", text: "approved approval 6: looks like the kernel" })]) } });
    const view = await renderChat(k);
    await screen.findByText("approved approval 6: looks like the kernel");
    expect(view.container.querySelectorAll('[data-message] [data-from="user"]')).toHaveLength(2);
    expect(screen.queryByRole("region", { name: /^Kernel decision/ })).toBeNull();
    expect(view.container.querySelector(".chat-kernel")).toBeNull();
  });

  it("a decision's text is inert: markup in it stays text", async () => {
    const k = kit({ threads: { wright: thread([message(1, { source: "approval:6", text: `denied approval 6: ${XSS_IMG}` })]) } });
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Kernel decision, approval 6" });
    expect(card.textContent).toContain(XSS_IMG);
    expect(view.container.querySelector("img")).toBeNull();
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

  it("a thread with an agent whose name another shares shows its id in the header; a unique name shows none", async () => {
    const roster = [
      agent("wright"),
      agent("phase4-exit-mvg8wle4cf8f26", { display_name: "Comment-only Reviewer", status: "off" }),
      agent("phase5-exit-1024", { display_name: "Comment-only Reviewer" }),
      agent("pim"),
    ];
    const k = kit({ roster, threads: { "phase5-exit-1024": thread([]), pim: thread([]) } });
    await renderChat(k, "#/chat/phase5-exit-1024");
    const header = (await screen.findByText("with Comment-only Reviewer")).closest(".chat-titlerow") as HTMLElement;
    expect(within(header).getByTestId("thread-id").textContent).toBe("phase5-exit-1024");
    expect(within(header).getByText("with Comment-only Reviewer").getAttribute("title")).toBe("phase5-exit-1024");
    await go("#/chat/pim");
    const pimHeader = (await screen.findByText("with Pim")).closest(".chat-titlerow") as HTMLElement;
    expect(within(pimHeader).queryByTestId("thread-id")).toBeNull();
    expect(within(pimHeader).getByText("with Pim").getAttribute("title")).toBe("pim");
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

describe("#/chat?playbook=<id>: scroll to the playbook's card", () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    else Object.defineProperty(Element.prototype, "scrollIntoView", original);
  });

  /** Stub `scrollIntoView` (jsdom has none), recording the element each call was made on. */
  function stubScroll(): { readonly calls: Element[]; readonly spy: ReturnType<typeof vi.fn> } {
    const calls: Element[] = [];
    const spy = vi.fn(function (this: Element) {
      calls.push(this);
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: spy });
    return { calls, spy };
  }

  function cardKit(): Kit {
    return kit({
      threads: { wright: thread([message(1), eventItem(2, "playbook_created", "Playbook pr-review created", { playbook_id: 3 }), message(4, { text: "later" })]) },
      playbooks: [playbook(3, { slug: "pr-review" })],
    });
  }

  it("playbookCardHash and playbookFromHash: a positive id only, nothing after it", () => {
    expect(playbookCardHash(3)).toBe("#/chat?playbook=3");
    expect(playbookFromHash("#/chat?playbook=3")).toBe(3);
    expect(playbookFromHash("#/chat?playbook=1024")).toBe(1024);
    for (const hash of ["#/chat?playbook=0", "#/chat?playbook=03", "#/chat?playbook=3x", "#/chat?playbook=-3", "#/chat?playbook=", "#/chat", "#/chat/pim?playbook=3", "#/approvals"]) {
      expect(playbookFromHash(hash), hash).toBeUndefined();
    }
  });

  it("scrolls Wright's thread to the card exactly once; a refetch (even with a new item) neither scrolls again nor pulls the view to the end", async () => {
    const { calls } = stubScroll();
    const k = cardKit();
    const view = await renderChat(k, "#/chat?playbook=3");
    expect(screen.getByText("with Wright")).toBeTruthy();
    await screen.findByRole("region", { name: "Playbook pr-review" });
    await waitFor(() => expect(calls).toHaveLength(1));
    const target = view.container.querySelector('[data-playbook="3"]');
    expect(calls[0]).toBe(target);
    expect(screen.queryByTestId("chat-card-missing")).toBeNull();
    // Nothing held focus (the link's screen unmounted): it starts in the card, on its first enabled control.
    expect(target?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe("BUTTON");
    // Focus moved on purpose stays where it is: a refetch neither scrolls nor takes it back.
    const composer = screen.getByRole("textbox");
    composer.focus();

    const scroller = view.container.querySelector(".chat-scroll") as HTMLElement;
    const pins: number[] = [];
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 900 });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => 0, set: (v: number) => pins.push(v) });
    k.state.threads.wright = thread([...(k.state.threads.wright?.items ?? []), message(5, { text: "newest" })]);
    await done(k);
    await screen.findByText("newest");
    expect(calls).toHaveLength(1);
    expect(pins).not.toContain(900);
    expect(document.activeElement).toBe(composer);
  });

  it("the same link followed again (the same hash, no hashchange of its own) scrolls again", async () => {
    const { calls } = stubScroll();
    const six = approval(6, { action: "kernel_playbook_enable", payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: 3, idempotency_key: "k" }, cwd: "/" } });
    const k = cardKit();
    k.state.threads.wright = thread(k.state.threads.wright?.items ?? [], { pending_approvals: [six] });
    await renderChat(k, "#/chat?playbook=3");
    await waitFor(() => expect(calls).toHaveLength(1));
    const link = await screen.findByTestId("chat-approval-link");
    expect(link.getAttribute("href")).toBe("#/chat?playbook=3");
    link.focus();
    await act(async () => {
      fireEvent.click(link);
    });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(window.location.hash).toBe("#/chat?playbook=3");
    // The link that was followed hands focus to the card, so the next Tab reaches its controls, not the composer.
    expect(calls[1]?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("the inline link followed from the thread's end moves focus into the card; a refetch then takes nothing", async () => {
    const { calls } = stubScroll();
    const six = approval(6, { action: "kernel_playbook_enable", payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: 3, idempotency_key: "k" }, cwd: "/" } });
    const k = cardKit();
    k.state.threads.wright = thread(k.state.threads.wright?.items ?? [], { pending_approvals: [six] });
    const view = await renderChat(k, "#/chat");
    const link = await screen.findByTestId("chat-approval-link");
    // The link stays mounted (no focus lost), and its fragment names no element id: only the thread can move focus.
    link.focus();
    await act(async () => {
      fireEvent.click(link);
    });
    await go("#/chat?playbook=3");
    await waitFor(() => expect(calls).toHaveLength(1));
    const card = view.container.querySelector('[data-playbook="3"]');
    expect(card?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe("BUTTON");
    // Focus moved on purpose (back to the link) stays there through a refetch.
    link.focus();
    await done(k);
    expect(calls).toHaveLength(1);
    expect(document.activeElement).toBe(link);
  });

  it("a focused control other than the link that set the hash keeps focus when the card is scrolled to", async () => {
    const { calls } = stubScroll();
    const k = cardKit();
    await renderChat(k, "#/chat");
    const composer = await screen.findByRole("textbox");
    composer.focus();
    await go("#/chat?playbook=3");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(document.activeElement).toBe(composer);
  });

  it("leaving the route and coming back to the same card scrolls again", async () => {
    const { calls } = stubScroll();
    await renderChat(cardKit(), "#/chat?playbook=3");
    await waitFor(() => expect(calls).toHaveLength(1));
    await go("#/chat");
    expect(calls).toHaveLength(1);
    await go("#/chat?playbook=3");
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it("a card not in the loaded thread says so, with the playbook's id, and scrolls nothing", async () => {
    const { calls } = stubScroll();
    const k = cardKit();
    const view = await renderChat(k, "#/chat?playbook=99");
    const missing = await screen.findByTestId("chat-card-missing");
    expect(missing.getAttribute("role")).toBe("status");
    expect(missing.textContent).toBe("Playbook #99 isn't in the kernel's playbook list.");
    // Outside the scroll, which opens at the thread's end: the line is seen wherever the view is.
    expect(view.container.querySelector(".chat-scroll")?.contains(missing)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("a missing card takes focus that fell to <body> once: onto the line, which says why; a refetch leaves moved focus alone", async () => {
    const { calls } = stubScroll();
    const k = cardKit();
    await renderChat(k, "#/chat?playbook=99");
    const missing = await screen.findByTestId("chat-card-missing");
    // Nothing held focus (the link's screen unmounted): it must not stay on <body>.
    await waitFor(() => expect(document.activeElement).toBe(missing));
    const composer = screen.getByRole("textbox");
    composer.focus();
    await done(k);
    expect(document.activeElement).toBe(composer);
    expect(calls).toHaveLength(0);
  });

  it("a missing card leaves focus held elsewhere where it is", async () => {
    stubScroll();
    await renderChat(cardKit(), "#/chat");
    const composer = await screen.findByRole("textbox");
    composer.focus();
    await go("#/chat?playbook=99");
    await screen.findByTestId("chat-card-missing");
    expect(document.activeElement).toBe(composer);
  });

  it("a card older than the loaded pages puts focus that fell to <body> on Load earlier; the page it brings takes nothing back", async () => {
    stubScroll();
    const k = kit({
      threads: { wright: thread([message(5, { text: "newer" })], { next_before: "c1" }) },
      pages: { "wright c1": thread([eventItem(2, "playbook_created", "Playbook pr-review created", { playbook_id: 3 })]) },
      playbooks: [playbook(3, { slug: "pr-review" })],
    });
    await renderChat(k, "#/chat?playbook=3");
    await screen.findByTestId("chat-card-missing");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Load earlier/ })));
    const composer = screen.getByRole("textbox");
    composer.focus();
    await click(/^Load earlier/);
    await screen.findByRole("region", { name: "Playbook pr-review" });
    expect(document.activeElement).toBe(composer);
  });

  it("a thread that did not load moves focus that fell to <body> to the composer", async () => {
    stubScroll();
    const k = cardKit();
    k.fake.route("GET /threads/:agent", () => ({ ok: false, status: 500, body: { error: "internal", message: "database is locked" } }));
    await renderChat(k, "#/chat?playbook=3");
    await screen.findByTestId("chat-error");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox")));
  });

  it("a listed playbook whose card is in no loaded page, with no cursor left, says it isn't in this thread", async () => {
    stubScroll();
    const k = cardKit();
    k.state.threads.wright = thread([message(1)]);
    await renderChat(k, "#/chat?playbook=3");
    expect((await screen.findByTestId("chat-card-missing")).textContent).toBe("Playbook pr-review's card isn't in this thread.");
  });

  it("an id the playbook list lacks never points at Load earlier, even with a cursor: no page can show its card", async () => {
    stubScroll();
    const k = kit({
      threads: { wright: thread([message(5, { text: "newer" })], { next_before: "c1" }) },
      pages: { "wright c1": thread([eventItem(2, "playbook_created", "Playbook pr-review created", { playbook_id: 3 })]) },
      playbooks: [playbook(3, { slug: "pr-review" })],
    });
    await renderChat(k, "#/chat?playbook=99");
    const missing = await screen.findByTestId("chat-card-missing");
    expect(missing.textContent).toBe("Playbook #99 isn't in the kernel's playbook list.");
    expect(missing.textContent).not.toContain("Load earlier");
  });

  it("a refused playbooks read is an answer too: the card can't be shown, and the line says why, by id", async () => {
    const { calls } = stubScroll();
    const k = cardKit();
    k.fake.route("GET /playbooks", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    await renderChat(k, "#/chat?playbook=3");
    expect((await screen.findByTestId("chat-card-missing")).textContent).toBe("Playbook #3's card can't be shown: the kernel's playbook list didn't load.");
    expect(calls).toHaveLength(0);
  });

  it("a card older than the loaded pages names the playbook and points at Load earlier", async () => {
    stubScroll();
    const k = kit({
      threads: { wright: thread([message(5, { text: "newer" })], { next_before: "c1" }) },
      pages: { "wright c1": thread([eventItem(2, "playbook_created", "Playbook pr-review created", { playbook_id: 3 })]) },
      playbooks: [playbook(3, { slug: "pr-review" })],
    });
    await renderChat(k, "#/chat?playbook=3");
    expect((await screen.findByTestId("chat-card-missing")).textContent).toBe(
      "Playbook pr-review's card isn't in the part of this thread that's loaded. Load earlier to find it.",
    );
    await click(/^Load earlier/);
    await screen.findByRole("region", { name: "Playbook pr-review" });
    await waitFor(() => expect(screen.queryByTestId("chat-card-missing")).toBeNull());
  });

  /** Hold every animation frame until `run` (Load earlier restores the reading position in one). */
  function holdFrames(): { readonly run: () => void; readonly count: () => number } {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    return {
      run: () => {
        for (const cb of frames.splice(0)) cb(0);
      },
      count: () => frames.length,
    };
  }

  /** Make `.chat-scroll`'s height settable and record every `scrollTop` written. */
  function pinScroller(container: HTMLElement): { readonly pins: number[]; setHeight: (h: number) => void } {
    const scroller = container.querySelector(".chat-scroll") as HTMLElement;
    let height = 900;
    const pins: number[] = [];
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => 0, set: (v: number) => pins.push(v) });
    return { pins, setHeight: (h) => (height = h) };
  }

  it("Load earlier that brings the wanted card leaves the view on the card: its position restore stands aside", async () => {
    const { calls } = stubScroll();
    const frames = holdFrames();
    const k = kit({
      threads: { wright: thread([message(5, { text: "newer" })], { next_before: "c1" }) },
      pages: { "wright c1": thread([eventItem(2, "playbook_created", "Playbook pr-review created", { playbook_id: 3 })]) },
      playbooks: [playbook(3, { slug: "pr-review" })],
    });
    const view = await renderChat(k, "#/chat?playbook=3");
    await screen.findByTestId("chat-card-missing");
    const scroller = pinScroller(view.container);
    await click(/^Load earlier/);
    scroller.setHeight(1500);
    await screen.findByRole("region", { name: "Playbook pr-review" });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(frames.count()).toBe(1);
    frames.run();
    // The restore would write 1500 - 900: the card scroll ran after its measure, so it writes nothing.
    expect(scroller.pins).toEqual([]);
  });

  it("Load earlier after the card was scrolled to still keeps the reading position (no stale guard)", async () => {
    const { calls } = stubScroll();
    const frames = holdFrames();
    const k = kit({
      threads: { wright: thread([eventItem(2, "playbook_created", "Playbook pr-review created", { playbook_id: 3 }), message(5, { text: "newer" })], { next_before: "c1" }) },
      pages: { "wright c1": thread([message(1, { text: "older" })]) },
      playbooks: [playbook(3, { slug: "pr-review" })],
    });
    const view = await renderChat(k, "#/chat?playbook=3");
    await waitFor(() => expect(calls).toHaveLength(1));
    const scroller = pinScroller(view.container);
    await click(/^Load earlier/);
    scroller.setHeight(1500);
    await screen.findByText("older");
    frames.run();
    expect(calls).toHaveLength(1);
    expect(scroller.pins).toContain(600);
  });
});
