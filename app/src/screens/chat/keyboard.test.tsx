// @vitest-environment jsdom
// Every Chat action is in the Tab order (jsdom has no native Tab, so the
// order is read the way a browser builds it: focusable elements in DOM order,
// minus `tabIndex < 0` and disabled ones). The real Tab / Shift+Tab walk and
// Enter / Space activation run in Electron in `app/e2e/chat.spec.ts`.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ok } from "../../store/fake-bridge";
import { approval, eventItem, kit, message, playbook, renderChat, resetChat, thread, trigger } from "./testkit";

afterEach(resetChat);

const FOCUSABLE = "button, select, textarea, input, a[href], [tabindex]";

/** The Tab order's names: aria-label, else the label element, else the text without hidden kbd hints. */
function tabOrder(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.closest("[hidden],[inert]") === null)
    .map((el) => {
      const label = el.getAttribute("aria-label");
      if (label !== null) return label;
      const id = el.getAttribute("id");
      const forLabel = id === null ? null : root.querySelector(`label[for="${id}"]`);
      if (forLabel !== null) return forLabel.textContent ?? "";
      // The visible name, without the kbd hints (aria-hidden).
      const copy = el.cloneNode(true) as HTMLElement;
      for (const hint of copy.querySelectorAll("kbd, [aria-hidden='true']")) hint.remove();
      return (copy.textContent ?? "").trim();
    });
}

describe("keyboard", () => {
  it("every action reachable by Tab", async () => {
    const k = kit({
      threads: {
        wright: thread(
          [message(4), eventItem(5, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 }), eventItem(6, "trigger_fired", "Trigger 8 fired", { trigger_id: 8 })],
          { next_before: "c1", pending_approvals: [approval(7), approval(9, { action: "kernel_agent_create" })] },
        ),
      },
      playbooks: [playbook(3, { trigger_id: 5 })],
      triggers: [trigger(5), trigger(8)],
    });
    const view = await renderChat(k);
    await screen.findByRole("region", { name: "Playbook pb-3" });
    await screen.findByRole("region", { name: "Trigger 8" });
    const order = tabOrder(view.container);
    expect(order).toEqual([
      // The Crew row.
      "Pim",
      "Load earlier",
      // The event lines' subjects.
      "Playbook pb-3 created",
      // The playbook card: each settable row's Edit, its actions, and its trigger.
      "Edit dedupe key",
      "Edit priority",
      "Edit model",
      "Edit token limit per day",
      "Run now",
      "Turn off",
      "On",
      "Off",
      "Trigger 8 fired",
      // The fired trigger's own card.
      "On",
      "Off",
      // The inline approval.
      "Allow once",
      "Always",
      "Deny",
      "Full payload",
      // The charter card.
      "Create",
      "Edit in English",
      "Deny",
      // The composer.
      "Message Wright",
      "Send",
    ]);
  });

  it("a row in edit mode: its field, Set and Cancel in order where its Edit was; Enter in the field sets, focus back on Edit", async () => {
    const k = kit({ threads: { wright: thread([eventItem(5, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 })]) }, playbooks: [playbook(3)] });
    k.state.posts["POST /playbooks/:id/set"] = () => {
      k.state.playbooks = [playbook(3, { model: "opus", model_set_by: "owner" })];
      return ok({});
    };
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Playbook pb-3" });
    // Tab reaches Edit model; Enter activates it (a button's Enter is its click).
    await act(async () => {
      const edit = within(card).getByRole("button", { name: "Edit model" });
      edit.focus();
      fireEvent.click(edit);
    });
    const input = within(card).getByRole("textbox", { name: "New model" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(tabOrder(card)).toEqual(["Edit dedupe key", "Edit priority", "New model", "Set model", "Cancel", "Edit token limit per day", "Run now", "Turn off"]);
    // Type, then Enter: the form's implicit submit.
    await act(async () => {
      fireEvent.change(input, { target: { value: "opus" } });
    });
    await act(async () => {
      fireEvent.submit(input.form as HTMLFormElement);
    });
    await waitFor(() => expect(k.posted("POST /playbooks/:id/set").map((r) => r.body)).toEqual([{ field: "model", value: "opus" }]));
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Edit model" })));
  });

  it("a specialist's workspace picker sits before its composer and Send", async () => {
    const k = kit({ threads: { pim: thread([]) } });
    const view = await renderChat(k, "#/chat/pim");
    await screen.findByTestId("chat-empty");
    await waitFor(() => expect(tabOrder(view.container).slice(-4)).toEqual(["Open in Team", "Workspace", "Message Pim", "Send"]));
  });
});
