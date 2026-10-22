// @vitest-environment jsdom
// Chat's cards: the playbook card (provenance, Set, Run now, Turn off, no
// Enable), the trigger card (On / Off, needs_confirmation), and the charter
// card (Create, Edit in English, Deny).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LAST_DRY_RUN_GAP } from "./cards";
import { approval, eventItem, kit, playbook, renderChat, resetChat, thread, trigger } from "./testkit";
import type { Kit } from "./testkit";

afterEach(resetChat);

async function press(scope: HTMLElement, name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(within(scope).getByRole("button", { name }));
  });
}

function playbookKit(): Kit {
  return kit({
    threads: { wright: thread([eventItem(1, "playbook_created", "Playbook pb-3 created", { playbook_id: 3 }), eventItem(2, "playbook_updated", "Playbook pb-3 updated", { playbook_id: 3 })]) },
    playbooks: [playbook(3, { trigger_id: 5 })],
    triggers: [trigger(5)],
  });
}

async function playbookCard(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Playbook pb-3" });
}

function priority(card: HTMLElement): string {
  return card.querySelector('dd[data-field="Priority"]')?.textContent ?? "";
}

describe("cards", () => {
  it("a playbook card shows once, after its newest event, with every field and the dry-run gap", async () => {
    const k = playbookKit();
    const view = await renderChat(k);
    const card = await playbookCard();
    expect(view.container.querySelectorAll("[data-playbook]")).toHaveLength(1);
    // After event 2, the newest playbook_* event naming it.
    expect(card.closest("li")?.previousElementSibling?.getAttribute("data-item")).toBe("event:2");
    expect(card.textContent).toContain("Review PRs where I am requested");
    expect(card.querySelector('dd[data-field="Dedupe key"]')?.textContent).toBe("pr:{number}:{head_sha}proposed");
    expect(card.querySelector('dd[data-field="Model"]')?.textContent).toBe("haikuset by owner");
    expect(card.querySelector('dd[data-field="Token limit per day"]')?.textContent).toBe("100000proposed");
    expect(card.querySelector('dd[data-field="Trigger"]')?.textContent).toMatch(/^cron · next /);
    expect(card.textContent).toContain(LAST_DRY_RUN_GAP);
  });

  it("Set priority high posts and shows set by owner", async () => {
    const k = playbookKit();
    await renderChat(k);
    const card = await playbookCard();
    expect(priority(card)).toBe("normalproposed");
    k.state.playbooks = [playbook(3, { trigger_id: 5, priority: "high", priority_set_by: "owner" })];
    const form = within(card).getByRole("form", { name: "Set a field of pb-3" });
    await act(async () => {
      fireEvent.change(within(form).getByRole("combobox", { name: "Field" }), { target: { value: "priority" } });
      fireEvent.change(within(form).getByRole("combobox", { name: "Value" }), { target: { value: "high" } });
    });
    await press(form, "Set priority");
    await waitFor(() => expect(k.posted("POST /playbooks/:id/set")).toHaveLength(1));
    expect(k.posted("POST /playbooks/:id/set")[0]?.params).toEqual({ id: 3 });
    expect(k.posted("POST /playbooks/:id/set")[0]?.body).toEqual({ field: "priority", value: "high" });
    await waitFor(() => expect(priority(card)).toBe("highset by owner"));
  });

  it("Set a text field sends its typed value as a string", async () => {
    const k = playbookKit();
    await renderChat(k);
    const form = within(await playbookCard()).getByRole("form");
    await act(async () => {
      fireEvent.change(within(form).getByRole("combobox", { name: "Field" }), { target: { value: "token_limit" } });
    });
    await act(async () => {
      fireEvent.change(within(form).getByRole("textbox", { name: "Value" }), { target: { value: "5000" } });
    });
    await press(form, "Set token_limit");
    await waitFor(() => expect(k.posted("POST /playbooks/:id/set")[0]?.body).toEqual({ field: "token_limit", value: "5000" }));
  });

  it("Run now / Turn off routes", async () => {
    const k = playbookKit();
    await renderChat(k);
    const card = await playbookCard();
    await press(card, "Run now");
    await waitFor(() => expect(k.posted("POST /playbooks/:id/run")).toHaveLength(1));
    expect(k.posted("POST /playbooks/:id/off")).toHaveLength(0);
    await press(card, "Turn off");
    await waitFor(() => expect(k.posted("POST /playbooks/:id/off")).toHaveLength(1));
    expect(k.posted("POST /playbooks/:id/run")).toHaveLength(1);
    expect(k.posted("POST /playbooks/:id/off")[0]?.params).toEqual({ id: 3 });
  });

  it("a refused playbook action shows the kernel's words and keeps the card", async () => {
    const k = playbookKit();
    k.state.posts["POST /playbooks/:id/run"] = () => ({ ok: false, status: 409, body: { error: "not_enabled", message: "pb-3 is disabled" } });
    await renderChat(k);
    const card = await playbookCard();
    await press(card, "Run now");
    expect((await within(card).findByRole("alert")).textContent).toBe("pb-3 is disabled (not_enabled)");
    expect(screen.getByRole("region", { name: "Playbook pb-3" })).toBeTruthy();
  });

  it("no Enable action on a playbook card", async () => {
    const k = playbookKit();
    await renderChat(k);
    const card = await playbookCard();
    const names = within(card)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    expect(names.some((n) => /enable/i.test(n))).toBe(false);
    expect(names).toEqual(["Run now", "Turn off", "Set priority", "On", "Off"]);
  });

  it("trigger On / Off routes", async () => {
    const k = kit({ threads: { wright: thread([eventItem(1, "trigger_fired", "Trigger 5 fired (wake)", { trigger_id: 5 })]) }, triggers: [trigger(5, { enabled: false })] });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Trigger 5" });
    expect(card.textContent).toContain("trigger text 5");
    expect(card.textContent).toContain("off");
    await press(card, "On");
    await waitFor(() => expect(k.posted("POST /triggers/:id/on")).toHaveLength(1));
    expect(k.posted("POST /triggers/:id/on")[0]?.params).toEqual({ id: 5 });
    expect(k.posted("POST /triggers/:id/on")[0]?.body).toEqual({});
    expect(k.posted("POST /triggers/:id/off")).toHaveLength(0);
    await press(card, "Off");
    await waitFor(() => expect(k.posted("POST /triggers/:id/off")).toHaveLength(1));
    expect(k.posted("POST /triggers/:id/on")).toHaveLength(1);
  });

  it("needs_confirmation resends with confirm", async () => {
    const k = kit({ threads: { wright: thread([eventItem(1, "trigger_fired", "Trigger 5 fired", { trigger_id: 5 })]) }, triggers: [trigger(5, { enabled: false, kind: "once" })] });
    k.state.posts["POST /triggers/:id/on"] = (req) =>
      (req.body as { confirm?: boolean } | undefined)?.confirm === true
        ? { ok: true, status: 200, body: { trigger: trigger(5), changed: true } }
        : { ok: false, status: 409, body: { error: "needs_confirmation", message: "trigger 5 was due at 08:00; turning it on fires it now" } };
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Trigger 5" });
    await press(card, "On");
    const ask = await within(card).findByRole("group", { name: "Confirm turning on trigger 5" });
    expect(ask.textContent).toContain("turning it on fires it now");
    // Cancel sends nothing more.
    await press(ask, "Cancel");
    expect(k.posted("POST /triggers/:id/on")).toHaveLength(1);
    await press(card, "On");
    await press(await within(card).findByRole("group"), "Turn on and fire");
    await waitFor(() => expect(k.posted("POST /triggers/:id/on")).toHaveLength(3));
    expect(k.posted("POST /triggers/:id/on").map((r) => r.body)).toEqual([{}, {}, { confirm: true }]);
    await waitFor(() => expect(within(card).queryByRole("group")).toBeNull());
  });

  it("a playbook card's trigger shows inside it, not again on its own", async () => {
    const k = kit({
      threads: { wright: thread([eventItem(1, "playbook_created", "created", { playbook_id: 3 }), eventItem(2, "trigger_fired", "fired", { trigger_id: 5 })]) },
      playbooks: [playbook(3, { trigger_id: 5 })],
      triggers: [trigger(5)],
    });
    const view = await renderChat(k);
    await playbookCard();
    expect(view.container.querySelectorAll('[data-trigger="5"]')).toHaveLength(1);
  });

  it("charter card shows the display text as-is", async () => {
    const display = "Name: Pim\nPersona: brief\n  Duties:\n  - digest";
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(9, { action: "kernel_agent_create", display })] }) } });
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Drafted crew member, approval 9" });
    expect(card.querySelector("pre")?.textContent).toBe(display);
    // The charter card replaces the plain approval card.
    expect(view.container.querySelector(".eventcard-approval")).toBeNull();
  });

  it("charter Create approves once", async () => {
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(9, { action: "kernel_agent_create" })] }) } });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Drafted crew member, approval 9" });
    await press(card, "Create");
    await waitFor(() => expect(k.posted("POST /approvals/:id/approve")).toHaveLength(1));
    expect(k.posted("POST /approvals/:id/approve")[0]?.body).toEqual({ decision: "once" });
    expect(k.posted("POST /approvals/:id/approve")[0]?.params).toEqual({ id: 9 });
  });

  it("charter Deny posts deny", async () => {
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(9, { action: "kernel_agent_create" })] }) } });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Drafted crew member, approval 9" });
    await press(card, "Deny");
    await waitFor(() => expect(k.posted("POST /approvals/:id/deny")).toHaveLength(1));
    expect(k.posted("POST /approvals/:id/approve")).toHaveLength(0);
  });

  it("charter Edit in English fills the composer, sends nothing", async () => {
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(9, { action: "kernel_agent_create" })] }) } });
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Drafted crew member, approval 9" });
    await press(card, "Edit in English");
    const composer = screen.getByRole("textbox", { name: "Message Wright" }) as HTMLTextAreaElement;
    expect(composer.value).toBe("About the charter in approval 9: ");
    expect(document.activeElement).toBe(composer);
    expect(k.posted("POST /ask")).toHaveLength(0);
    expect(k.fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(0);
  });
});
