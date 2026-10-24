// @vitest-environment jsdom
// The sidebar's Crew group: specialists only (never Wright), each a button
// with its avatar, last line, time and unread dot; the empty line with no
// button; and both Chat components rendering with no bridge or storage.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREW_EMPTY_TEXT } from "../../components/List/List";
import { CrewSection } from "./CrewSection";
import { ChatScreen } from "./Thread";
import { agent, approval, go, kit, message, renderChat, resetChat, thread } from "./testkit";

afterEach(() => {
  vi.restoreAllMocks();
  resetChat();
});

function crew(): HTMLElement {
  return screen.getByRole("region", { name: "Crew" });
}

const PIM_ROW = message(5, { agent: "pim", text: "What did you find?", reply_text: "Two PRs need you.\nSecond line.", created_at: "2026-10-22T08:30:00.000Z" });

describe("crew", () => {
  it("Wright is never under Crew", async () => {
    const k = kit({ roster: [agent("wright"), agent("pim")], threads: { wright: thread([]) } });
    await renderChat(k);
    await waitFor(() => expect(within(crew()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Pim"]));
    expect(within(crew()).queryByText("Wright")).toBeNull();
  });

  it("no specialists renders no button", async () => {
    const k = kit({ roster: [agent("wright")], threads: { wright: thread([]) } });
    await renderChat(k);
    await waitFor(() => expect(k.fake.requestsTo("GET /agents").length).toBeGreaterThan(0));
    await act(async () => undefined);
    expect(within(crew()).queryAllByRole("button")).toHaveLength(0);
    expect(within(crew()).getByText(CREW_EMPTY_TEXT)).toBeTruthy();
    expect(within(crew()).getByRole("heading", { name: "Crew" }).id).toBe("nav-crew");
  });

  it("a row shows the avatar with its state, the last line, the time and an unread dot", async () => {
    const k = kit({ roster: [agent("wright"), agent("pim", { sessions_running: 1 })], messages: [PIM_ROW], threads: { wright: thread([]) } });
    await renderChat(k);
    const row = await within(crew()).findByRole("button", { name: "Pim, unread" });
    expect(row.textContent?.startsWith("Pim")).toBe(true);
    expect(within(row).getByRole("img").getAttribute("aria-label")).toContain("working");
    expect(row.querySelector(".chat-crew-last")?.textContent).toBe("Two PRs need you. Second line.");
    expect(row.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-22T08:30:00.000Z");
    expect(within(row).getByTestId("crew-unread")).toBeTruthy();
  });

  it("a row's name is its agent, and its time and last line are its description", async () => {
    const k = kit({ messages: [PIM_ROW], threads: { wright: thread([]) } });
    await renderChat(k);
    const row = await within(crew()).findByRole("button", { name: "Pim, unread" });
    const described = (row.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("Two PRs need you. Second line.");
    expect(described).toContain(row.querySelector("time")?.textContent ?? "missing");
    expect(row.querySelector("time")?.textContent).not.toBe("");
  });

  it("a Crew row opened from another thread focuses the new thread's composer", async () => {
    const k = kit({ threads: { wright: thread([]), pim: thread([]) } });
    await renderChat(k);
    await screen.findByTestId("chat-empty");
    await act(async () => {
      // The click's request lands before the hashchange, while Wright's composer is still mounted.
      fireEvent.click(within(crew()).getByRole("button", { name: "Pim" }));
    });
    await act(async () => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByText("with Pim");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message Pim" }));
  });

  it("avatar states: off reads killed, a pending approval reads waiting", async () => {
    const k = kit({ roster: [agent("wright"), agent("pim", { status: "off" }), agent("mason")], approvals: [approval(1, { requesting_agent: "mason" })], threads: { wright: thread([]) } });
    await renderChat(k);
    const pim = await within(crew()).findByRole("button", { name: "Pim, off" });
    await waitFor(() => expect(within(pim).getByRole("img").getAttribute("aria-label")).toContain("killed"));
    await waitFor(() => expect(within(within(crew()).getByRole("button", { name: "Mason" })).getByRole("img").getAttribute("aria-label")).toContain("waiting on you"));
  });

  it("two members of the same name show their ids, have distinct names, and each row's title is its id", async () => {
    const k = kit({
      roster: [
        agent("wright"),
        agent("phase4-exit-mvg8wle4cf8f26", { display_name: "Comment-only Reviewer" }),
        agent("phase5-exit-1024", { display_name: " comment-only reviewer " }),
        agent("pim"),
      ],
      threads: { wright: thread([]) },
    });
    await renderChat(k);
    const old = await within(crew()).findByRole("button", { name: "Comment-only Reviewer (phase4-exit-mvg8wle4cf8f26)" });
    // The label is "<display name> (<id>)" exactly; the accessible name the browser computes trims the name's spaces.
    const fresh = within(crew()).getByRole("button", { name: /^comment-only reviewer \(phase5-exit-1024\)$/ });
    expect(fresh.getAttribute("aria-label")).toBe(" comment-only reviewer  (phase5-exit-1024)");
    expect(old).not.toBe(fresh);
    for (const [row, id] of [
      [old, "phase4-exit-mvg8wle4cf8f26"],
      [fresh, "phase5-exit-1024"],
    ] as const) {
      const shown = within(row).getByTestId("crew-id");
      expect(shown.textContent).toBe(id);
      expect(row.querySelector(".chat-crew-name")?.contains(shown)).toBe(false);
      expect(shown.parentElement?.classList.contains("chat-crew-text")).toBe(true);
    }
    const pim = within(crew()).getByRole("button", { name: "Pim" });
    expect(within(pim).queryByTestId("crew-id")).toBeNull();
    for (const row of within(crew()).getAllByRole("button")) expect(row.getAttribute("title")).toBe(row.getAttribute("data-agent"));
  });

  it("off members sort last in the kernel's order, dimmed, saying off, and still open their thread", async () => {
    const k = kit({
      roster: [agent("wright"), agent("offa", { status: "off" }), agent("b"), agent("offc", { status: "off" }), agent("d")],
      threads: { wright: thread([]), offa: thread([]) },
    });
    await renderChat(k);
    await waitFor(() => expect(within(crew()).getAllByRole("button").map((b) => b.getAttribute("data-agent"))).toEqual(["b", "d", "offa", "offc"]));
    for (const id of ["offa", "offc"]) {
      const row = crew().querySelector(`[data-agent="${id}"]`) as HTMLElement;
      expect(row.classList.contains("off")).toBe(true);
      expect(within(row).getByTestId("crew-off").textContent).toBe("off");
      expect(row.getAttribute("aria-label")?.endsWith(", off")).toBe(true);
      expect(row.hasAttribute("disabled")).toBe(false);
    }
    for (const id of ["b", "d"]) {
      const row = crew().querySelector(`[data-agent="${id}"]`) as HTMLElement;
      expect(row.classList.contains("off")).toBe(false);
      expect(within(row).queryByTestId("crew-off")).toBeNull();
      expect(row.getAttribute("aria-label")?.endsWith(", off")).toBe(false);
    }
    await act(async () => {
      fireEvent.click(within(crew()).getByRole("button", { name: "Offa, off" }));
    });
    expect(window.location.hash).toBe("#/chat/offa");
  });

  it("unread dot clears once the thread is opened", async () => {
    const k = kit({ messages: [PIM_ROW], threads: { wright: thread([]), pim: thread([PIM_ROW]) } });
    await renderChat(k);
    const row = await within(crew()).findByRole("button", { name: "Pim, unread" });
    await act(async () => {
      fireEvent.click(row);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("#/chat/pim");
    await screen.findByText("Two PRs need you.");
    // Away from Pim's thread, the row is no longer selected, and it stays read.
    await go("#/team");
    await waitFor(() => expect(within(crew()).getByRole("button", { name: "Pim" })).toBeTruthy());
    expect(within(crew()).queryByTestId("crew-unread")).toBeNull();
    // A newer message makes it unread again.
    k.state.messages = [PIM_ROW, message(6, { agent: "pim", reply_text: "One more." })];
    await act(async () => {
      k.fake.emit({ type: "event", id: 1, at: new Date().toISOString(), kind: "event_done", session_id: null, task_id: null, payload: {} });
    });
    expect(await within(crew()).findByRole("button", { name: "Pim, unread" })).toBeTruthy();
  });

  it("the selected thread's row is marked current", async () => {
    const k = kit({ threads: { pim: thread([]) } });
    await renderChat(k, "#/chat/pim");
    const row = await within(crew()).findByRole("button", { name: "Pim" });
    expect(row.getAttribute("aria-current")).toBe("page");
  });

  it("renders without storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    const k = kit({ messages: [PIM_ROW], threads: { wright: thread([]), pim: thread([PIM_ROW]) } });
    await renderChat(k);
    const row = await within(crew()).findByRole("button", { name: "Pim, unread" });
    await act(async () => {
      fireEvent.click(row);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await screen.findByText("Two PRs need you.");
    await go("#/team");
    // Kept in memory: still read.
    await waitFor(() => expect(within(crew()).getByRole("button", { name: "Pim" })).toBeTruthy());
  });

  it("renders with window.api undefined", async () => {
    expect((window as unknown as { api?: unknown }).api).toBeUndefined();
    render(
      <>
        <CrewSection />
        <ChatScreen />
      </>,
    );
    await act(async () => undefined);
    expect(within(crew()).getByText(CREW_EMPTY_TEXT)).toBeTruthy();
    expect(within(crew()).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("screen-chat")).toBeTruthy();
    expect(await screen.findByTestId("chat-error")).toBeTruthy();
    // The screen renders no h1: the shell owns the only one.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
