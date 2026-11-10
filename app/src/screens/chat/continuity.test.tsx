// @vitest-environment jsdom
// Thread continuity in Chat and a Crew thread (phase 8 item 17c): Summarize &
// start fresh with its preview (Cancel, Edit, summary_exists), the ⓘ panel in
// tokens, Copy reference and its chip, refusals in plain words, rename in
// place, the replayed note and the kernel's titles in place of the old labels.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary, ThreadFigures, ThreadItem } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { useResource } from "../../store/react";
import { summaryPoll } from "./continuity";
import { agent, go, kit, message, renderChat, resetChat, thread } from "./testkit";
import type { Kit } from "./testkit";
import { render } from "@testing-library/react";

const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  summaryPoll.ms = 0;
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(resetChat);

type Msg = Extract<ThreadItem, { type: "message" }>;

function msg(id: number, threadId: number, overrides: Partial<Msg> = {}): Msg {
  return { ...message(id, { session_id: id + 100, updated_at: "2026-10-22T08:04:00.000Z" }), thread_id: threadId, continuation: null, session_title: null, ...overrides };
}

function fig(id: number, overrides: Partial<ThreadFigures> = {}): ThreadFigures {
  return { id, agent: "wright", title: `Thread title ${id}`, renamed: false, messages: 2, latest_reply_tokens: 1200, summary_estimated_tokens: null, ...overrides };
}

const SUMMARY = "## Decisions\n- Ship on Friday\nKeep the <img src=x onerror=alert(1)> literal.";

/** Wright's thread: thread 4 (messages 4 and 6, 6 continues it), thread 8 (summarized once, with a summary file). Pim: thread 90. */
function threadsKit(): Kit {
  const k = kit({
    threads: {
      wright: thread([msg(4, 4, { text: "Plan the release", reply_text: "Here is the plan.\nStep two" }), msg(6, 4, { text: "and then?", reply_text: "Then we ship.", continuation: "resumed" }), msg(8, 8, { reply_text: "PR 12 looks fine." })], {
        threads: [fig(4, { title: "Plan the release", messages: 4, latest_reply_tokens: 52000 }), fig(8, { title: "Review PR 12", summary_estimated_tokens: 300 })],
        thread_summarize_hint_tokens: 40000,
      }),
      pim: thread([msg(90, 90, { agent: "pim", reply_text: "Pim's answer", continuation: "replayed" })], { threads: [fig(90, { agent: "pim", title: "Docs-only PRs" })], thread_summarize_hint_tokens: null }),
    },
  });
  k.fake.route("POST /threads/:agent/:thread/summarize", (req) => ok({ message_id: 300, queue_id: 300, thread: Number(req.params?.thread), file: `memory/wright/threads/${String(req.params?.thread)}.md` }));
  k.fake.route("GET /threads/:agent/:thread/summary", (req) => ok({ thread: Number(req.params?.thread), file: `memory/wright/threads/${String(req.params?.thread)}.md`, text: SUMMARY, truncated: null }));
  k.fake.route("POST /threads/:agent/:thread/start-fresh", (req) => {
    const from = Number(req.params?.thread);
    const current = k.state.threads.wright!;
    k.state.threads.wright = { ...current, items: [...current.items, msg(20, 20, { text: "Continue from the summary", status: "queued", reply_text: null })], threads: [...(current.threads ?? []), fig(20, { title: "Plan the release (continued)", messages: 1 })] };
    return { ok: true, status: 202, body: { message_id: 20, queue_id: 20, thread: 20, from, file: `memory/wright/threads/${from}.md` } };
  });
  k.fake.route("POST /threads/:agent/:thread/rename", (req) => {
    const title = (req.body as { title: string | null }).title;
    return ok({ thread: Number(req.params?.thread), title: title ?? "Plan the release", renamed: title !== null });
  });
  return k;
}

const posted = (k: Kit, key: string) => k.fake.requestsTo(key).map((r) => r.req);

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(el);
  });
}

function section(title: string): HTMLElement {
  return screen.getByRole("heading", { name: title }).closest(".chat-item") as HTMLElement;
}

describe("Summarize & start fresh (AC3)", () => {
  it("sits on a thread's latest reply only, past the hint it is marked, and opens the preview after summarize and summary", async () => {
    const k = threadsKit();
    await renderChat(k);
    const buttons = await screen.findAllByRole("button", { name: /^Summarize & start fresh/ });
    // Thread 4's latest reply (6) and thread 8's: two, not one per reply.
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.closest("[data-message]")?.getAttribute("data-message")).toBe("6");
    expect(screen.getAllByText("past your size hint")).toHaveLength(1);
    await click(buttons[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Summary of “Plan the release”" });
    expect(posted(k, "POST /threads/:agent/:thread/summarize").map((r) => r.params)).toEqual([{ agent: "wright", thread: 4 }]);
    expect(posted(k, "GET /threads/:agent/:thread/summary")).toHaveLength(1);
    expect(posted(k, "POST /threads/:agent/:thread/start-fresh")).toHaveLength(0);
    // Text only: the heading, list and the markup stay text.
    expect(within(dialog).getByRole("heading", { name: "Decisions" })).toBeTruthy();
    expect(within(dialog).getByText("Ship on Friday").tagName).toBe("LI");
    expect(within(dialog).getByText(/onerror=alert/)).toBeTruthy();
    expect(dialog.querySelector("img")).toBeNull();
    // Tab order: the summary text, then Start fresh with this, Edit, Cancel.
    const order = [...dialog.querySelectorAll<HTMLElement>("[tabindex='0'], button")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
    expect(order).toEqual(["Summary text", "Start fresh with this", "Edit", "CancelEsc"]);
  });

  it("Cancel calls no start-fresh; Summarize again (summary_exists) opens the same preview", async () => {
    const k = threadsKit();
    await renderChat(k);
    const summarize = (await screen.findAllByRole("button", { name: /^Summarize & start fresh/ }))[0]!;
    await click(summarize);
    await click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posted(k, "POST /threads/:agent/:thread/start-fresh")).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(summarize));

    k.fake.route("POST /threads/:agent/:thread/summarize", () => ({ ok: false, status: 409, body: { error: "summary_exists", file: "memory/wright/threads/4.md" } }));
    await click(summarize);
    expect(await screen.findByRole("dialog", { name: "Summary of “Plan the release”" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(posted(k, "POST /threads/:agent/:thread/start-fresh")).toHaveLength(0);
  });

  it("waits while the summary is not written yet (no_summary), then previews it", async () => {
    const k = threadsKit();
    let reads = 0;
    k.fake.route("GET /threads/:agent/:thread/summary", () => {
      reads += 1;
      return reads < 3 ? { ok: false, status: 404, body: { error: "no_summary", file: "memory/wright/threads/4.md" } } : ok({ thread: 4, file: "memory/wright/threads/4.md", text: SUMMARY, truncated: null });
    });
    await renderChat(k);
    await click((await screen.findAllByRole("button", { name: /^Summarize & start fresh/ }))[0]!);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(reads).toBe(3);
  });

  it("after Edit the edited text is the summary sent; the old thread is marked and keeps Reply", async () => {
    const k = threadsKit();
    await renderChat(k);
    await click((await screen.findAllByRole("button", { name: /^Summarize & start fresh/ }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await click(within(dialog).getByRole("button", { name: "Edit" }));
    await act(async () => {
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Summary text" }), { target: { value: "## Decisions\n- Ship on Monday" } });
    });
    expect(within(dialog).getByText("edited by you")).toBeTruthy();
    await click(within(dialog).getByRole("button", { name: "Start fresh with this" }));
    expect(posted(k, "POST /threads/:agent/:thread/start-fresh").map((r) => [r.params, r.body])).toEqual([[{ agent: "wright", thread: 4 }, { summary: "## Decisions\n- Ship on Monday" }]]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const note = await screen.findByRole("note", { name: "" });
    await waitFor(() => expect(screen.getByText(/^Summarized: continued in/).textContent).toBe("Summarized: continued in Plan the release (continued)."));
    expect(note).toBeTruthy();
    expect(within(section("Plan the release")).getAllByRole("button", { name: /^Reply to Wright's message/ }).length).toBeGreaterThan(0);
  });

  it("Start fresh without an edit sends no summary; a refusal shows in the preview in plain words", async () => {
    const k = threadsKit();
    k.fake.route("POST /threads/:agent/:thread/start-fresh", () => ({ ok: false, status: 409, body: { error: "already_started_fresh", summarized_into: 30 } }));
    await renderChat(k);
    await click((await screen.findAllByRole("button", { name: /^Summarize & start fresh/ }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await click(within(dialog).getByRole("button", { name: "Start fresh with this" }));
    expect(posted(k, "POST /threads/:agent/:thread/start-fresh")[0]?.body).toEqual({});
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("This thread was already summarized and continued in a new thread, so nothing started. Reply still continues this one.");
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/^Summarized: continued in/).textContent).toBe("Summarized: continued in Thread #30.");
  });

  it("a summarize refusal shows under the thread in plain words (AC6)", async () => {
    const k = threadsKit();
    k.fake.route("POST /threads/:agent/:thread/summarize", () => ({ ok: false, status: 409, body: { error: "nothing_to_summarize", message: "no message of thread 4 had a session" } }));
    await renderChat(k);
    await click((await screen.findAllByRole("button", { name: /^Summarize & start fresh/ }))[0]!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No message of this thread has had a session yet, so there is nothing to summarize.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the ⓘ panel (AC4)", () => {
  it("shows the thread's figures in tokens, never a $", async () => {
    const k = threadsKit();
    await renderChat(k);
    const info = (await screen.findAllByRole("button", { name: "About Summarize & start fresh: this thread in tokens" }))[0]!;
    expect(info.getAttribute("aria-expanded")).toBe("false");
    await click(info);
    expect(info.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("region", { name: "Summarize & start fresh: this thread in tokens" });
    expect(panel.textContent).toContain("Messages so far4");
    expect(panel.textContent).toContain("52,000 tokens");
    expect(panel.textContent).toContain("Not written yet.");
    expect(panel.textContent).toContain("40,000 tokens");
    expect(panel.textContent).toContain("this thread is past it");
    expect(panel.textContent).not.toContain("$");
    // Thread 8's panel: the summary estimate.
    await click((await screen.findAllByRole("button", { name: "About Summarize & start fresh: this thread in tokens" }))[1]!);
    expect(screen.getAllByRole("region", { name: "Summarize & start fresh: this thread in tokens" }).some((p) => (p.textContent ?? "").includes("about 300 tokens"))).toBe(true);
    // Esc closes the open panel and returns focus to its ⓘ.
    const second = screen.getAllByRole("button", { name: "About Summarize & start fresh: this thread in tokens" })[1]!;
    await act(async () => {
      fireEvent.keyDown(second, { key: "Escape" });
    });
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(second);
  });
});

describe("Copy reference and the chip (AC5)", () => {
  it("copies a link; pasting it into a Crew composer gives a chip that sends as references, not text", async () => {
    const k = threadsKit();
    await renderChat(k);
    await click(await screen.findByRole("button", { name: "Copy reference to the thread Review PR 12" }));
    expect(writeText).toHaveBeenCalledWith("loomwright-studio://thread/wright/8");
    expect(screen.getByTestId("chat-thread-notice").textContent).toContain("Copied a reference to “Review PR 12”.");

    window.location.hash = "#/chat/pim";
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const field = (await screen.findByRole("textbox", { name: "Message Pim" })) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "Use what we decided" } });
      fireEvent.paste(field, { clipboardData: { getData: () => "loomwright-studio://thread/wright/8" } });
    });
    const chip = await screen.findByRole("group", { name: "Attached thread reference" });
    await waitFor(() => expect(chip.textContent).toContain("Review PR 12"));
    expect(chip.textContent).toContain("(2 messages)");
    expect(chip.textContent).toContain("· Wright");
    await click(within(chip).getByRole("button", { name: "Summary" }));
    expect(chip.textContent).toContain("about 300 tokens");
    expect(field.value).toBe("Use what we decided");
    await click(screen.getByRole("button", { name: /^Send/ }));
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: "Use what we decided", agent: "pim", workspace: "~/work/a", references: [{ thread: 8, use: "summary" }] });
    await waitFor(() => expect(screen.queryByRole("group", { name: "Attached thread reference" })).toBeNull());
  });

  it("other pasted text stays text; × removes the chip and returns focus to the composer", async () => {
    const k = threadsKit();
    await renderChat(k);
    const field = (await screen.findByRole("textbox", { name: "Message Wright" })) as HTMLTextAreaElement;
    const plain = fireEvent.paste(field, { clipboardData: { getData: () => "just words" } });
    expect(plain).toBe(true);
    expect(screen.queryByRole("group", { name: "Attached thread reference" })).toBeNull();
    await act(async () => {
      fireEvent.paste(field, { clipboardData: { getData: () => "loomwright-studio://thread/wright/4" } });
    });
    const chip = screen.getByRole("group", { name: "Attached thread reference" });
    // Same agent: no agent name; no summary: no toggle and no size.
    expect(chip.textContent).toBe("Thread: Plan the release (4 messages)");
    await click(within(chip).getByRole("button", { name: "Remove the reference to Plan the release" }));
    expect(screen.queryByRole("group", { name: "Attached thread reference" })).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("a history_too_large refusal keeps the text and the chip, in plain words (AC6)", async () => {
    const k = threadsKit();
    k.state.posts["POST /ask"] = () => ({ ok: false, status: 409, body: { error: "history_too_large", thread: 4, size: 412000, bound: 200000 } });
    await renderChat(k);
    const field = (await screen.findByRole("textbox", { name: "Message Wright" })) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "with history" } });
      fireEvent.paste(field, { clipboardData: { getData: () => "loomwright-studio://thread/wright/4" } });
    });
    await click(screen.getByRole("button", { name: /^Send/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The referenced thread #4 is 412,000 characters, past the kernel's limit of 200,000 characters. Nothing was cut and nothing was sent. Remove the reference, or attach its summary instead.");
    expect(field.value).toBe("with history");
    expect(screen.getByRole("group", { name: "Attached thread reference" })).toBeTruthy();
  });
});

describe("rename in place (AC8)", () => {
  function SessionsProbe({ k }: { readonly k: Kit }) {
    useResource("sessions", k.fake.bridge);
    return null;
  }

  it("⏎ saves through POST rename, and the thread and sessions refetch; Esc cancels; empty clears to null", async () => {
    const k = threadsKit();
    k.fake.route("GET /sessions", () => ok({ sessions: [] }));
    render(<SessionsProbe k={k} />);
    await renderChat(k);
    await click(await screen.findByRole("button", { name: "Rename the thread Plan the release" }));
    const field = screen.getByRole("textbox", { name: "Thread name" }) as HTMLInputElement;
    expect(field.value).toBe("Plan the release");
    expect(document.activeElement).toBe(field);
    await act(async () => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();
    expect(posted(k, "POST /threads/:agent/:thread/rename")).toHaveLength(0);

    const threadReads = k.fake.requestsTo("GET /threads/:agent").length;
    const sessionReads = k.fake.requestsTo("GET /sessions").length;
    await click(screen.getByRole("button", { name: "Rename the thread Plan the release" }));
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Thread name" }), { target: { value: "  Release plan  " } });
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Thread name" }), { key: "Enter" });
    });
    expect(posted(k, "POST /threads/:agent/:thread/rename").map((r) => [r.params, r.body])).toEqual([[{ agent: "wright", thread: 4 }, { title: "Release plan" }]]);
    await waitFor(() => expect(k.fake.requestsTo("GET /threads/:agent").length).toBeGreaterThan(threadReads));
    await waitFor(() => expect(k.fake.requestsTo("GET /sessions").length).toBeGreaterThan(sessionReads));
    expect(screen.queryByRole("textbox", { name: "Thread name" })).toBeNull();

    await click(screen.getByRole("button", { name: "Rename the thread Plan the release" }));
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Thread name" }), { target: { value: "   " } });
    });
    await click(screen.getByRole("button", { name: /^Save/ }));
    expect(posted(k, "POST /threads/:agent/:thread/rename")[1]?.body).toEqual({ title: null });
  });

  it("a renamed title is marked renamed by you", async () => {
    const k = threadsKit();
    const current = k.state.threads.wright!;
    k.state.threads.wright = { ...current, threads: [fig(4, { title: "Release plan", renamed: true, messages: 4 }), fig(8, { title: "Review PR 12" })] };
    await renderChat(k);
    const head = (await screen.findByRole("heading", { name: "Release plan" })).parentElement as HTMLElement;
    expect(within(head).getByText("renamed by you")).toBeTruthy();
  });
});

describe("titles and notes (AC1, AC8)", () => {
  it("a replayed reply shows Continuing from the saved conversation; a resumed one reads continued", async () => {
    const k = threadsKit();
    await renderChat(k, "#/chat/pim");
    expect(await screen.findByText("Continuing from the saved conversation")).toBeTruthy();
    await go("#/chat");
    expect((await screen.findAllByText("continued")).length).toBeGreaterThan(0);
  });

  it("Chat and Crew show the kernel's titles, never ad hoc session or playbook #N", async () => {
    const k = kit({
      roster: [agent("wright"), agent("pim")],
      threads: {
        wright: thread([msg(4, 4, { source: "trigger:3", session_title: "Review PRs where I'm requested" }), msg(8, 8, { session_title: "What changed overnight?" })], {
          threads: [fig(4, { title: "Review PRs where I'm requested" }), fig(8, { title: "What changed overnight?" })],
        }),
        pim: thread([msg(90, 90, { agent: "pim", session_title: "Skip docs-only PRs" })], { threads: [fig(90, { agent: "pim", title: "Skip docs-only PRs" })] }),
      },
    });
    const sessions: SessionSummary[] = [];
    k.fake.route("GET /sessions", () => ok({ sessions }));
    await renderChat(k);
    expect(await screen.findByRole("heading", { name: "Review PRs where I'm requested" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What changed overnight?" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/ad hoc session/);
    expect(document.body.textContent).not.toMatch(/playbook #\d+/);
    window.location.hash = "#/chat/pim";
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { name: "Skip docs-only PRs" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/ad hoc session/);
    expect(document.body.textContent).not.toMatch(/playbook #\d+/);
  });

  it("a kernel without threads draws the thread as before: no Reply, no header", async () => {
    const k = kit({ threads: { wright: thread([message(1)]) } });
    await renderChat(k);
    await screen.findByText("answer 1");
    expect(screen.queryByRole("button", { name: /^Reply/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy reference/ })).toBeNull();
  });

  it("the kernel unreachable disables Reply, Summarize and Rename", async () => {
    const k = threadsKit();
    k.fake.connectionAnswer = { state: "unreachable", reason: "connection_failed" };
    await renderChat(k);
    await waitFor(() => expect((screen.getAllByRole("button", { name: /^Reply to Wright's message/ })[0] as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getAllByRole("button", { name: /^Summarize & start fresh/ })[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Rename the thread Plan the release" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
