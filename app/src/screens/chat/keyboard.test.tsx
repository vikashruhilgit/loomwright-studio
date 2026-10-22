// @vitest-environment jsdom
// Every Chat action is in the Tab order (jsdom has no native Tab, so the
// order is read the way a browser builds it: focusable elements in DOM order,
// minus `tabIndex < 0` and disabled ones). The real Tab / Shift+Tab walk and
// Enter / Space activation run in Electron in `app/e2e/chat.spec.ts`.
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
      // The playbook card, its form, and its trigger.
      "Run now",
      "Turn off",
      "Field",
      "Value",
      "Set priority",
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

  it("a specialist's workspace picker sits before its composer and Send", async () => {
    const k = kit({ threads: { pim: thread([]) } });
    const view = await renderChat(k, "#/chat/pim");
    await screen.findByTestId("chat-empty");
    await waitFor(() => expect(tabOrder(view.container).slice(-4)).toEqual(["Open in Team", "Workspace", "Message Pim", "Send"]));
  });
});
