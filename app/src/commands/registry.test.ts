import { describe, expect, it, vi } from "vitest";
import { CommandCollisionError, createCommandRegistry } from "./registry";

const command = (id: string) => ({ id, title: id, group: "Test", run: () => undefined });

describe("the command registry", () => {
  it("lists what each owner registers, in order, with its owner", () => {
    const registry = createCommandRegistry();
    registry.register("approvals", [command("approvals.approve")]);
    registry.register("sessions", [command("sessions.stop"), command("sessions.kill")]);
    expect(registry.list().map((c) => [c.owner, c.id])).toEqual([
      ["approvals", "approvals.approve"],
      ["sessions", "sessions.stop"],
      ["sessions", "sessions.kill"],
    ]);
  });

  it("refuses a second owner of an id, naming both, and registers none of that batch", () => {
    const registry = createCommandRegistry();
    registry.register("approvals", [command("shared.id")]);
    expect(() => registry.register("sessions", [command("sessions.stop"), command("shared.id")])).toThrow(CommandCollisionError);
    expect(() => registry.register("sessions", [command("shared.id")])).toThrow(/approvals and sessions/);
    expect(registry.list().map((c) => c.id)).toEqual(["shared.id"]);
  });

  it("unregisters exactly what one call registered, and tells subscribers", () => {
    const registry = createCommandRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const off = registry.register("team", [command("team.rename")]);
    registry.register("chat", [command("chat.send")]);
    off();
    off();
    expect(registry.list().map((c) => c.id)).toEqual(["chat.send"]);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
