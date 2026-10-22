// @vitest-environment jsdom
// Chat's ⌘K commands, registered by the Crew section into an injected
// registry: ask commands, playbook and trigger commands, one per recent
// notification (navigation only), and unregistered on unmount.
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NOTIFICATION_COMMANDS, notificationThread } from "./commands";
import { CrewSection } from "./CrewSection";
import { agent, kit, notification, playbook, renderChat, resetChat, thread, trigger } from "./testkit";
import type { Kit } from "./testkit";

afterEach(resetChat);

function commandKit(): Kit {
  return kit({
    threads: { wright: thread([]) },
    playbooks: [playbook(3, { slug: "pr-review" })],
    triggers: [trigger(5, { enabled: true, text: "weekdays 17:00" }), trigger(6, { enabled: false, text: "once at 9" })],
    notifications: [notification(1, "agent:pim", "Pim posted a digest"), notification(2, "kernel:cap", "Paused at cap"), notification(3, "agent:ghost", "Ghost said hi")],
  });
}

async function loaded(k: Kit): Promise<void> {
  await waitFor(() => expect(k.registry.get("chat.notification.3")).toBeDefined());
  await waitFor(() => expect(k.registry.get("chat.ask.pim")).toBeDefined());
  await waitFor(() => expect(k.registry.get("chat.trigger.6.on")).toBeDefined());
  await waitFor(() => expect(k.registry.get("chat.playbook.3.run")).toBeDefined());
}

describe("commands", () => {
  it("registers ask, playbook, trigger and notification commands", async () => {
    const k = commandKit();
    await renderChat(k);
    await loaded(k);
    expect(k.registry.list().map((c) => [c.id, c.title, c.group])).toEqual([
      ["chat.ask.wright", "Ask Wright", "Agents"],
      ["chat.ask.pim", "Ask Pim", "Agents"],
      ["chat.playbook.3.run", "Run pr-review", "Playbooks"],
      ["chat.playbook.3.off", "Turn off pr-review", "Playbooks"],
      ["chat.playbook.3.priority.high", "Set pr-review priority high", "Playbooks"],
      ["chat.playbook.3.priority.normal", "Set pr-review priority normal", "Playbooks"],
      ["chat.playbook.3.priority.low", "Set pr-review priority low", "Playbooks"],
      ["chat.trigger.5.off", "Turn off trigger 5: weekdays 17:00", "Playbooks"],
      ["chat.trigger.6.on", "Turn on trigger 6: once at 9", "Playbooks"],
      ["chat.notification.3", "Ghost said hi", "Notifications"],
      ["chat.notification.2", "Paused at cap", "Notifications"],
      ["chat.notification.1", "Pim posted a digest", "Notifications"],
    ]);
  });

  it("Set <slug> priority high command posts set", async () => {
    const k = commandKit();
    await renderChat(k);
    await loaded(k);
    await act(async () => {
      await k.registry.get("chat.playbook.3.priority.high")?.run();
    });
    expect(k.posted("POST /playbooks/:id/set").map((r) => [r.params, r.body])).toEqual([[{ id: 3 }, { field: "priority", value: "high" }]]);
    expect(screen.getByRole("status", { name: "" }).textContent).toBe("Set pr-review priority high: done.");
  });

  it("run and turn off commands post their routes; trigger commands follow the trigger's state", async () => {
    const k = commandKit();
    await renderChat(k);
    await loaded(k);
    await act(async () => {
      await k.registry.get("chat.playbook.3.run")?.run();
      await k.registry.get("chat.playbook.3.off")?.run();
      await k.registry.get("chat.trigger.5.off")?.run();
      await k.registry.get("chat.trigger.6.on")?.run();
    });
    expect(k.posted("POST /playbooks/:id/run")).toHaveLength(1);
    expect(k.posted("POST /playbooks/:id/off")).toHaveLength(1);
    expect(k.posted("POST /triggers/:id/off").map((r) => r.params)).toEqual([{ id: 5 }]);
    expect(k.posted("POST /triggers/:id/on").map((r) => [r.params, r.body])).toEqual([[{ id: 6 }, {}]]);
  });

  it("notification command only navigates", async () => {
    const k = commandKit();
    // The Crew section alone: navigating loads no thread, so every request after `before` would be the command's.
    render(<CrewSection api={k.fake.bridge} registry={k.registry} />);
    await loaded(k);
    await act(async () => new Promise((done) => setTimeout(done, 300)));
    const before = k.fake.requests.length;
    await act(async () => {
      await k.registry.get("chat.notification.1")?.run();
    });
    expect(window.location.hash).toBe("#/chat/pim");
    await act(async () => {
      await k.registry.get("chat.notification.2")?.run();
    });
    expect(window.location.hash).toBe("#/chat");
    window.location.hash = "#/team";
    await act(async () => {
      await k.registry.get("chat.notification.3")?.run();
    });
    // `ghost` is not on the roster: Wright's thread.
    expect(window.location.hash).toBe("#/chat");
    expect(k.fake.requests.slice(before)).toEqual([]);
  });

  it("at most 20 notifications, newest first", async () => {
    const many = Array.from({ length: 25 }, (_, i) => notification(i + 1, "kernel:x", `n${i + 1}`));
    const k = kit({ threads: { wright: thread([]) }, notifications: many });
    await renderChat(k);
    await waitFor(() => expect(k.registry.get("chat.notification.25")).toBeDefined());
    const ids = k.registry
      .list()
      .filter((c) => c.group === "Notifications")
      .map((c) => c.id);
    expect(ids).toHaveLength(NOTIFICATION_COMMANDS);
    expect(ids[0]).toBe("chat.notification.25");
    expect(ids).not.toContain("chat.notification.5");
  });

  it("Ask commands open the thread", async () => {
    const k = commandKit();
    await renderChat(k, "#/team");
    await loaded(k);
    await act(async () => {
      await k.registry.get("chat.ask.pim")?.run();
    });
    expect(window.location.hash).toBe("#/chat/pim");
    await act(async () => {
      await k.registry.get("chat.ask.wright")?.run();
    });
    expect(window.location.hash).toBe("#/chat");
  });

  it("unregisters on unmount", async () => {
    const k = commandKit();
    const view = await renderChat(k);
    await loaded(k);
    view.unmount();
    expect(k.registry.list()).toEqual([]);
  });

  it("notificationThread maps agent:<id> on the roster, else Wright", () => {
    const roster = [agent("wright"), agent("pim")];
    expect(notificationThread("agent:pim", roster)).toBe("#/chat/pim");
    expect(notificationThread("agent:wright", roster)).toBe("#/chat");
    expect(notificationThread("agent:unknown", roster)).toBe("#/chat");
    expect(notificationThread("trigger:4", roster)).toBe("#/chat");
  });
});
