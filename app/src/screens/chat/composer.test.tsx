// @vitest-environment jsdom
// Chat's composer: POST /ask with the thread's agent, the workspace picker
// (only the agent's listed workspaces, none for Wright), the blank guard, and
// a refusal that keeps the typed text, and the picker's per-agent memory.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ok } from "../../store/fake-bridge";
import { agent, go, kit, renderChat, resetChat, thread } from "./testkit";
import type { Kit } from "./testkit";

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
    // Pim's one workspace is preselected and sent (AC2).
    expect(k.posted("POST /ask")[0]?.body).toEqual({ text: "Skip PR 12", agent: "pim", workspace: "~/work/a" });
  });

  it("workspace picker offers only listed workspaces", async () => {
    const k = kit({ threads: { pim: thread([]) } });
    await renderChat(k, "#/chat/pim");
    const picker = (await screen.findByRole("combobox", { name: "Workspace" })) as HTMLSelectElement;
    await waitFor(() => expect([...picker.options].map((o) => o.textContent)).toEqual(["No workspace", "~/work/a"]));
    expect(screen.queryAllByRole("textbox").map((t) => t.getAttribute("aria-label"))).toEqual(["Message Pim"]);
    // The sole workspace is preselected: choose "No workspace" first, so the first send checks that nothing is sent.
    await act(async () => {
      fireEvent.change(picker, { target: { value: "" } });
    });
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

  it("a 202 clears only the text it sent: what the owner typed while it was in flight stays; Send shows busy", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    let release: () => void = () => undefined;
    k.fake.route("POST /ask", async () => {
      await new Promise<void>((go) => {
        release = go;
      });
      return { ok: true, status: 202, body: { message_id: 1, queue_id: 1 } };
    });
    await renderChat(k);
    await type("first");
    await send();
    const button = screen.getByRole("button", { name: /^Send/ });
    expect(button.getAttribute("aria-busy")).toBe("true");
    await type("second, typed while the first was in flight");
    await act(async () => release());
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
    expect(k.posted("POST /ask").map((r) => r.body)).toEqual([{ text: "first", agent: "wright" }]);
    expect(composer().value).toBe("second, typed while the first was in flight");
  });

  it("the composer holds at most 8000 characters", async () => {
    const k = kit({ threads: { wright: thread([]) } });
    await renderChat(k);
    expect(composer().maxLength).toBe(8000);
  });
});

function picker(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Workspace" }) as HTMLSelectElement;
}

/** Wait until the picker offers exactly `listed` (after "No workspace"), i.e. `GET /agents/:id` has answered. */
async function offered(listed: readonly string[]): Promise<void> {
  await waitFor(() => expect([...picker().options].map((o) => o.textContent)).toEqual(["No workspace", ...listed]));
}

async function choose(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(picker(), { target: { value } });
  });
}

/** Leave for Sessions and come back to `hash`: the thread, and its composer, unmount and mount again. */
async function awayAndBack(hash: string): Promise<void> {
  await go("#/sessions");
  await go(hash);
}

async function sendsWith(k: Kit, text: string, workspace: string | undefined): Promise<void> {
  const before = k.posted("POST /ask").length;
  await type(text, "Pim");
  await send();
  await waitFor(() => expect(k.posted("POST /ask")).toHaveLength(before + 1));
  expect(k.posted("POST /ask")[before]?.body).toEqual({ text, agent: "pim", ...(workspace === undefined ? {} : { workspace }) });
}

describe("composer workspace memory", () => {
  const two = ["~/work/a", "~/work/b"];

  it("a chosen workspace survives going to Sessions and back, and the whole view unmounting (AC1)", async () => {
    const k = kit({ threads: { wright: thread([]), pim: thread([]) }, workspaces: { pim: [...two] } });
    const view = await renderChat(k, "#/chat/pim");
    await offered(two);
    await choose("~/work/b");
    await awayAndBack("#/chat/pim");
    await offered(two);
    expect(picker().value).toBe("~/work/b");
    await sendsWith(k, "after Sessions", "~/work/b");

    // Leaving the Chat screen unmounts it; the same bridge renders it again.
    view.unmount();
    await renderChat(k, "#/chat/pim");
    await offered(two);
    expect(picker().value).toBe("~/work/b");
    await sendsWith(k, "after unmount", "~/work/b");
  });

  it("a sole workspace is preselected; with two and no choice, No workspace is (AC2)", async () => {
    const one = kit({ threads: { pim: thread([]) } });
    await renderChat(one, "#/chat/pim");
    await offered(["~/work/a"]);
    expect(picker().value).toBe("~/work/a");
    resetChat();

    const k = kit({ threads: { pim: thread([]) }, workspaces: { pim: [...two] } });
    await renderChat(k, "#/chat/pim");
    await offered(two);
    expect(picker().value).toBe("");
    await sendsWith(k, "no choice", undefined);
  });

  it("a remembered workspace the list no longer has becomes No workspace, and stays so when listed again (AC3)", async () => {
    const k = kit({ threads: { wright: thread([]), pim: thread([]) }, workspaces: { pim: [...two] } });
    await renderChat(k, "#/chat/pim");
    await offered(two);
    await choose("~/work/b");

    k.state.workspaces.pim = ["~/work/a", "~/work/c"];
    await awayAndBack("#/chat/pim");
    await offered(["~/work/a", "~/work/c"]);
    expect(picker().value).toBe("");
    await sendsWith(k, "b is gone", undefined);

    k.state.workspaces.pim = [...two];
    await awayAndBack("#/chat/pim");
    await offered(two);
    expect(picker().value).toBe("");
  });

  it("a removed workspace with one other left shows No workspace, not the one left (AC3)", async () => {
    const k = kit({ threads: { wright: thread([]), pim: thread([]) }, workspaces: { pim: [...two] } });
    await renderChat(k, "#/chat/pim");
    await offered(two);
    await choose("~/work/b");

    k.state.workspaces.pim = ["~/work/a"];
    await awayAndBack("#/chat/pim");
    await offered(["~/work/a"]);
    expect(picker().value).toBe("");
    // Typing and sending re-render the composer after the list answered: still nothing sent.
    await sendsWith(k, "one left", undefined);
    expect(picker().value).toBe("");

    await awayAndBack("#/chat/pim");
    await offered(["~/work/a"]);
    expect(picker().value).toBe("");
  });

  it("an explicit No workspace sticks: a sole workspace is not preselected again (AC4)", async () => {
    const k = kit({ threads: { wright: thread([]), pim: thread([]) } });
    await renderChat(k, "#/chat/pim");
    await offered(["~/work/a"]);
    expect(picker().value).toBe("~/work/a");
    await choose("");

    await awayAndBack("#/chat/pim");
    await offered(["~/work/a"]);
    expect(picker().value).toBe("");
    await sendsWith(k, "none please", undefined);
  });

  it("the memory is per agent (AC5)", async () => {
    const k = kit({
      roster: [agent("wright"), agent("pim"), agent("quill")],
      threads: { wright: thread([]), pim: thread([]), quill: thread([]) },
      workspaces: { pim: [...two], quill: ["~/quill/x", "~/quill/y"] },
    });
    await renderChat(k, "#/chat/pim");
    await offered(two);
    await choose("~/work/b");

    await go("#/chat/quill");
    await screen.findByRole("textbox", { name: "Message Quill" });
    await offered(["~/quill/x", "~/quill/y"]);
    expect(picker().value).toBe("");

    await go("#/chat/pim");
    await offered(two);
    expect(picker().value).toBe("~/work/b");
  });

  it("a refused list does not drop the choice (AC5)", async () => {
    const k = kit({ threads: { wright: thread([]), pim: thread([]) }, workspaces: { pim: [...two] } });
    let refuse = false;
    k.fake.route("GET /agents/:id", () =>
      refuse
        ? { ok: false, status: 500, body: { error: "boom" } }
        : ok({ agent: agent("pim"), settings: { file: "", content: {}, error: null }, never: null, workspaces: [...two], memory: { dir: "", files: [] }, charter: {} }),
    );
    await renderChat(k, "#/chat/pim");
    await offered(two);
    await choose("~/work/b");

    refuse = true;
    await awayAndBack("#/chat/pim");
    await screen.findByText("boom");
    expect(picker().value).toBe("");

    refuse = false;
    await awayAndBack("#/chat/pim");
    await offered(two);
    expect(picker().value).toBe("~/work/b");
    await sendsWith(k, "still b", "~/work/b");
  });
});
