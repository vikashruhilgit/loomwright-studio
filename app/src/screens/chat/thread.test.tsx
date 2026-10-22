// @vitest-environment jsdom
// Chat's thread: message states, the reply bubble, event cards, the inline
// approval at the end, inert untrusted text, paging back, and routing.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ALWAYS_INELIGIBLE } from "./cards";
import { WRIGHT_EMPTY } from "./Thread";
import { approval, eventItem, kit, message, renderChat, resetChat, thread, go } from "./testkit";

afterEach(resetChat);

const XSS_IMG = "<img src=x onerror=alert(1)>";
const XSS_LINK = "[x](javascript:alert(1))";

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
