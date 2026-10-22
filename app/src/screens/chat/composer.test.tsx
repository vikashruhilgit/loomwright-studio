// @vitest-environment jsdom
// Chat's composer: POST /ask with the thread's agent, the workspace picker
// (only the agent's listed workspaces, none for Wright), the blank guard, and
// a refusal that keeps the typed text.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { kit, renderChat, resetChat, thread } from "./testkit";

afterEach(resetChat);

function composer(name = "Wright"): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: `Message ${name}` }) as HTMLTextAreaElement;
}

async function type(text: string, name = "Wright"): Promise<void> {
  await act(async () => {
    fireEvent.change(composer(name), { target: { value: text } });
  });
}

async function send(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
  });
}

describe("composer", () => {
  it("sends POST /ask with agent wright", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    await type("What changed overnight?");
    await send();
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: "What changed overnight?", agent: "wright" });
    // A 202 clears the composer.
    await waitFor(() => expect(composer().value).toBe(""));
  });

  it("Enter sends and Shift+Enter does not", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    await type("line one");
    await act(async () => {
      fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    });
    expect(k.posted("POST /ask")).toHaveLength(0);
    await act(async () => {
      fireEvent.keyDown(composer(), { key: "Enter" });
    });
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
  });

  it("crew thread sends agent: pim", async () => {
    const k = kit({ threads: { pim: thread([]) } });
    await renderChat(k, "#/chat/pim");
    await type("Skip PR 12", "Pim");
    await send();
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: "Skip PR 12", agent: "pim" });
  });

  it("workspace picker offers only listed workspaces", async () => {
    const k = kit({ threads: { pim: thread([]) } });
    await renderChat(k, "#/chat/pim");
    const picker = (await screen.findByRole("combobox", { name: "Workspace" })) as HTMLSelectElement;
    await waitFor(() => expect([...picker.options].map((o) => o.textContent)).toEqual(["No workspace", "~/work/a"]));
    expect(screen.queryAllByRole("textbox").map((t) => t.getAttribute("aria-label"))).toEqual(["Message Pim"]);
    // A workspace not in the list cannot be chosen: the select keeps no such value, and nothing unlisted is sent.
    await act(async () => {
      fireEvent.change(picker, { target: { value: "~/elsewhere" } });
    });
    expect(picker.value).not.toBe("~/elsewhere");
    await type("one", "Pim");
    await send();
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(1));
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: "one", agent: "pim" });

    await act(async () => {
      fireEvent.change(picker, { target: { value: "~/work/a" } });
    });
    await type("two", "Pim");
    await send();
    await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(2));
    expect(k.posted("POST /ask")[1]?.body).toEqual({ text: "two", agent: "pim", workspace: "~/work/a" });
  });

  it("a null workspace list offers only No workspace", async () => {
    const k = kit({ threads: { pim: thread([]) }, workspaces: { pim: null } });
    await renderChat(k, "#/chat/pim");
    await waitFor(() => expect(k.fake.requestsTo("GET /agents/:id")).toHaveLength(1));
    const picker = screen.getByRole("combobox", { name: "Workspace" }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["No workspace"]);
  });

  it("Wright shows no workspace picker", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    await screen.findByTestId("chat-empty");
    expect(screen.queryByRole("combobox", { name: "Workspace" })).toBeNull();
    expect(k.fake.requestsTo("GET /agents/:id")).toHaveLength(0);
  });

  it("blank text cannot send", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    await send();
    await type("   \n  ");
    await send();
    await act(async () => {
      fireEvent.keyDown(composer(), { key: "Enter" });
    });
    expect(k.posted("POST /ask")).toHaveLength(0);
  });

  it("refusal keeps the typed text", async () => {
    const k = kit({ threads: { pim: thread([]) } });
    k.state.posts["POST /ask"] = () => ({ ok: false, status: 409, body: { error: "workspace_not_listed", message: "~/work/b is not one of pim's workspaces" } });
    await renderChat(k, "#/chat/pim");
    await type("Look at ~/work/b", "Pim");
    await send();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("workspace_not_listed");
    expect(alert.textContent).toContain("is not one of pim's workspaces");
    expect(composer("Pim").value).toBe("Look at ~/work/b");
  });

  it("a double Enter while the first ask is in flight sends once", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    k.fake.route("POST /ask", async () => {
      await held;
      return { ok: true, status: 202, body: { message_id: 1, queue_id: 1 } };
    });
    await renderChat(k);
    await type("once only");
    await act(async () => {
      fireEvent.keyDown(composer(), { key: "Enter" });
      fireEvent.keyDown(composer(), { key: "Enter" });
    });
    await act(async () => release());
    await waitFor(() => expect(composer().value).toBe(""));
    expect(k.posted("POST /ask")).toHaveLength(1);
  });

  it("the composer holds at most 8000 characters", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    expect(composer().maxLength).toBe(8000);
  });
});
