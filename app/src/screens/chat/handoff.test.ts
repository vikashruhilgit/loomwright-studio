// @vitest-environment jsdom
// The composer handoff: a line stored for an agent is taken once, and Wright's
// thread takes it on mount into the composer, focused, sending nothing.
import { StrictMode, createElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handOffComposerText, takeComposerHandoff } from "./handoff";
import { ChatScreen } from "./Thread";
import { kit, renderChat, resetChat, thread } from "./testkit";

beforeEach(() => {
  // A handoff a failed test left behind must not leak into the next.
  takeComposerHandoff("wright");
  takeComposerHandoff("pim");
});
afterEach(resetChat);

const LINE = "About playbook 7 (pb-7): ";

function composer(name = "Wright"): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: `Message ${name}` }) as HTMLTextAreaElement;
}

describe("handoff store", () => {
  it("has nothing to take until a line is handed off", () => {
    expect(takeComposerHandoff("wright")).toBeUndefined();
  });

  it("a taken handoff is cleared: it is taken once", () => {
    handOffComposerText("wright", LINE);
    expect(takeComposerHandoff("wright")).toBe(LINE);
    expect(takeComposerHandoff("wright")).toBeUndefined();
  });

  it("is per agent: another agent's take leaves the line in place", () => {
    handOffComposerText("wright", LINE);
    expect(takeComposerHandoff("pim")).toBeUndefined();
    expect(takeComposerHandoff("wright")).toBe(LINE);
  });

  it("a second handoff for the same agent replaces the first", () => {
    handOffComposerText("wright", "first");
    handOffComposerText("wright", "second");
    expect(takeComposerHandoff("wright")).toBe("second");
    expect(takeComposerHandoff("wright")).toBeUndefined();
  });

  it("keeps an empty line as a line, and keeps hostile text as plain text", () => {
    handOffComposerText("wright", "");
    expect(takeComposerHandoff("wright")).toBe("");
    const hostile = "<img src=x onerror=alert(1)>";
    handOffComposerText("wright", hostile);
    expect(takeComposerHandoff("wright")).toBe(hostile);
  });
});

describe("Wright's thread after a handoff", () => {
  it("fills the composer on mount, focuses it, and sends nothing", async () => {
    handOffComposerText("wright", LINE);
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    expect(composer().value).toBe(LINE);
    expect(document.activeElement).toBe(composer());
    expect(k.posted("POST /ask")).toHaveLength(0);
    // Taken: nothing is left for the next mount.
    expect(takeComposerHandoff("wright")).toBeUndefined();
  });

  it("holds the line under StrictMode's double effects, and still sends nothing", async () => {
    handOffComposerText("wright", LINE);
    const k = kit({ threads: { wright: thread([]) } });
    window.location.hash = "#/chat";
    render(createElement(StrictMode, null, createElement(ChatScreen, { api: k.fake.bridge })));
    await act(async () => undefined);
    expect(composer().value).toBe(LINE);
    expect(document.activeElement).toBe(composer());
    expect(k.posted("POST /ask")).toHaveLength(0);
  });

  it("mounts empty and unfocused by the handoff when none was handed off", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    expect(composer().value).toBe("");
    expect(document.activeElement).not.toBe(composer());
  });

  it("a line for Wright never fills a specialist's composer", async () => {
    // (Before the roster answers, `#/chat/pim` shows Wright's thread, which takes the line: the handoff is for `#/chat`.)
    handOffComposerText("wright", LINE);
    const k = kit({ threads: { pim: thread([]) } });
    await renderChat(k, "#/chat/pim");
    expect(composer("Pim").value).toBe("");
  });
});
