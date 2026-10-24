// @vitest-environment jsdom
// Chat's cards: the playbook card (provenance, Set, Run now, Turn off, no
// Enable), the trigger card (schedule, next fire, on / off / spent, On / Off,
// needs_confirmation), and the charter
// card (Create, Edit in English, Deny).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ok } from "../../store/fake-bridge";
import { LAST_DRY_RUN_GAP } from "./cards";
import { inFlightGuard, triggerSchedule, triggerState, when } from "./model";
import { T0, approval, eventItem, kit, playbook, renderChat, resetChat, thread, trigger } from "./testkit";
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
  it("the in-flight guard drops a call while one is pending and releases on a throw", async () => {
    const guard = inFlightGuard();
    let release: () => void = () => undefined;
    const first = guard.run(
      () =>
        new Promise<void>((go) => {
          release = go;
        }),
    );
    expect(guard.pending()).toBe(true);
    expect(await guard.run(async () => undefined)).toBe(false);
    release();
    expect(await first).toBe(true);
    await expect(guard.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(guard.pending()).toBe(false);
    expect(await guard.run(async () => undefined)).toBe(true);
  });

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

  it("a double click on Run now posts once while the first run is in flight, and the button shows busy", async () => {
    const k = playbookKit();
    let release: () => void = () => undefined;
    k.fake.route("POST /playbooks/:id/run", async () => {
      await new Promise<void>((go) => {
        release = go;
      });
      return { ok: true, status: 200, body: {} };
    });
    await renderChat(k);
    const card = await playbookCard();
    const button = within(card).getByRole("button", { name: "Run now" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(button.getAttribute("aria-busy")).toBe("true");
    // Another action on the same card waits too.
    await press(card, "Turn off");
    await act(async () => release());
    expect(k.posted("POST /playbooks/:id/run")).toHaveLength(1);
    expect(k.posted("POST /playbooks/:id/off")).toHaveLength(0);
    // The guard releases once the run answered.
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
    await press(card, "Run now");
    await act(async () => release());
    await waitFor(() => expect(k.posted("POST /playbooks/:id/run")).toHaveLength(2));
  });

  it("a double click on an approval or charter action posts once", async () => {
    const k = kit({ threads: { wright: thread([], { pending_approvals: [approval(7), approval(9, { action: "kernel_agent_create" })] }) } });
    const held: (() => void)[] = [];
    k.fake.route("POST /approvals/:id/approve", async () => {
      await new Promise<void>((go) => held.push(go));
      return { ok: true, status: 200, body: {} };
    });
    const view = await renderChat(k);
    const charter = await screen.findByRole("region", { name: "Drafted crew member, approval 9" });
    const approvalCard = view.container.querySelector('[data-approval="7"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(approvalCard).getByRole("button", { name: /^Allow once/ }));
      fireEvent.click(within(approvalCard).getByRole("button", { name: /^Allow once/ }));
      fireEvent.click(within(approvalCard).getByRole("button", { name: /^Deny/ }));
      fireEvent.click(within(charter).getByRole("button", { name: "Create" }));
      fireEvent.click(within(charter).getByRole("button", { name: "Create" }));
    });
    expect(k.posted("POST /approvals/:id/approve").map((r) => r.params)).toEqual([{ id: 7 }, { id: 9 }]);
    expect(k.posted("POST /approvals/:id/deny")).toHaveLength(0);
    await act(async () => {
      for (const go of held) go();
    });
  });

  it("the confirm step never drops focus: On to Cancel, Cancel to On, Turn on and fire to On", async () => {
    const k = kit({ threads: { wright: thread([eventItem(1, "trigger_fired", "Trigger 5 fired", { trigger_id: 5 })]) }, triggers: [trigger(5, { enabled: false, kind: "once" })] });
    k.state.posts["POST /triggers/:id/on"] = (req) =>
      (req.body as { confirm?: boolean } | undefined)?.confirm === true
        ? { ok: true, status: 200, body: { trigger: trigger(5), changed: true } }
        : { ok: false, status: 409, body: { error: "needs_confirmation", message: "turning it on fires it now" } };
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Trigger 5" });
    const focusAndPress = async (scope: HTMLElement, name: string): Promise<void> => {
      await act(async () => {
        const button = within(scope).getByRole("button", { name });
        button.focus();
        fireEvent.click(button);
      });
    };
    await focusAndPress(card, "On");
    const group = await within(card).findByRole("group");
    expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Cancel" }));
    await focusAndPress(group, "Cancel");
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "On" }));
    await focusAndPress(card, "On");
    await focusAndPress(await within(card).findByRole("group"), "Turn on and fire");
    await waitFor(() => expect(within(card).queryByRole("group")).toBeNull());
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "On" }));
  });

  it("a trigger card shows its schedule and its next fire", async () => {
    const at = "2026-10-22T17:00:00.000Z";
    const k = kit({
      threads: {
        wright: thread([
          eventItem(1, "trigger_registered", "Trigger 5 registered", { trigger_id: 5 }),
          eventItem(2, "trigger_registered", "Trigger 6 registered", { trigger_id: 6 }),
          eventItem(3, "trigger_registered", "Trigger 7 registered", { trigger_id: 7 }),
        ]),
      },
      triggers: [
        trigger(5, { kind: "once", spec: { at }, next_fire_at: at }),
        trigger(6, { spec: { cron: "0 9 * * 1-5", tz: "Asia/Kolkata" } }),
        trigger(7, { spec: {}, enabled: false, next_fire_at: null }),
      ],
    });
    await renderChat(k);
    const once = await screen.findByRole("region", { name: "Trigger 5" });
    expect(once.querySelector('[data-field="Schedule"]')?.textContent).toBe(`once at ${when(at)}`);
    expect(once.querySelector('[data-field="Next fire"]')?.textContent).toBe(`next fire ${when(at)}`);
    expect(once.querySelector('[data-field="Next fire"] time')?.getAttribute("dateTime")).toBe(at);
    const cron = screen.getByRole("region", { name: "Trigger 6" });
    expect(cron.querySelector('[data-field="Schedule"]')?.textContent).toBe("cron 0 9 * * 1-5 (Asia/Kolkata)");
    // An unreadable spec reads as the kind alone; no next fire says so.
    const off = screen.getByRole("region", { name: "Trigger 7" });
    expect(off.querySelector('[data-field="Schedule"]')?.textContent).toBe("cron");
    expect(off.querySelector('[data-field="Next fire"]')?.textContent).toBe("no next fire");
    expect(off.querySelector("time")).toBeNull();
  });

  it("the schedule reads the untrusted spec by type only", () => {
    expect(triggerSchedule(trigger(1, { kind: "once", spec: { at: 42 } }))).toBe("once");
    expect(triggerSchedule(trigger(1, { spec: { cron: "* * * * *" } }))).toBe("cron");
    expect(triggerSchedule(trigger(1, { spec: null }))).toBe("cron");
    expect(triggerSchedule(trigger(1, { spec: "0 9 * * *" }))).toBe("cron");
    expect(triggerSchedule(trigger(1, { kind: "once", spec: { at: "<b>not a time</b>" } }))).toBe("once at <b>not a time</b>");
  });

  it("a trigger's state: on, off, or spent as far as the row shows it", () => {
    const later = "2026-10-22T09:00:00.000Z";
    expect(triggerState(trigger(1))).toBe("on");
    expect(triggerState(trigger(1, { kind: "once" }))).toBe("on");
    // A cron that is off is off, never spent.
    expect(triggerState(trigger(1, { enabled: false }))).toBe("off");
    // A once off and never toggled: spent (fired, or its instant recorded as a miss).
    expect(triggerState(trigger(1, { kind: "once", enabled: false }))).toBe("spent");
    // A once someone turned off (after its last fire, or before any): off.
    expect(triggerState(trigger(1, { kind: "once", enabled: false, enabled_changed_by: "owner", enabled_changed_at: later }))).toBe("off");
    expect(triggerState(trigger(1, { kind: "once", enabled: false, enabled_changed_by: "owner", enabled_changed_at: later, last_fired_at: T0 }))).toBe("off");
    // A once turned on, then fired: spent.
    expect(triggerState(trigger(1, { kind: "once", enabled: false, enabled_changed_by: "owner", enabled_changed_at: T0, last_fired_at: later }))).toBe("spent");
  });

  it("a fired once never toggled shows spent, with On still offered, and its fired line still shows", async () => {
    const k = kit({
      threads: { wright: thread([eventItem(1, "trigger_registered", "Trigger 5 registered", { trigger_id: 5 }), eventItem(2, "trigger_fired", "Trigger 5 fired (notify)", { trigger_id: 5 })]) },
      triggers: [trigger(5, { kind: "once", enabled: false, next_fire_at: null, last_fired_at: T0, last_result: "fired" })],
    });
    const view = await renderChat(k);
    const card = await screen.findByRole("region", { name: "Trigger 5" });
    expect(card.getAttribute("data-state")).toBe("spent");
    expect(card.querySelector(".chat-tag")?.textContent).toBe("off · spent");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["On", "Off"]);
    expect(view.container.querySelector('[data-item="event:2"]')?.textContent).toContain("Trigger 5 fired (notify)");
    expect(card.closest("li")?.previousElementSibling?.getAttribute("data-item")).toBe("event:2");
  });

  it("Off sends one write and the same card shows off once the triggers list answers it off, with no reload", async () => {
    const k = kit({ threads: { wright: thread([eventItem(1, "trigger_registered", "Trigger 5 registered", { trigger_id: 5 })]) }, triggers: [trigger(5)] });
    k.state.posts["POST /triggers/:id/off"] = () => {
      k.state.triggers = [trigger(5, { enabled: false, enabled_changed_by: "owner", enabled_changed_at: "2026-10-22T08:05:00.000Z" })];
      return ok({ trigger: k.state.triggers[0], changed: true });
    };
    await renderChat(k);
    const card = await screen.findByRole("region", { name: "Trigger 5" });
    expect(card.getAttribute("data-state")).toBe("on");
    await press(card, "Off");
    await waitFor(() => expect(card.getAttribute("data-state")).toBe("off"));
    expect(k.posted("POST /triggers/:id/off").map((r) => r.params)).toEqual([{ id: 5 }]);
    expect(card.querySelector(".chat-tag")?.textContent).toBe("off");
    // The same element, not a remount.
    expect(screen.getByRole("region", { name: "Trigger 5" })).toBe(card);
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
