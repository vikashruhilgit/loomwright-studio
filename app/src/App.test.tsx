// @vitest-environment jsdom
// The shell: the sidebar's six entries (Chat, Team, Approvals, Sessions,
// Integrations and the Crew group), routing to each screen, the "kernel
// unreachable" band and the "kernel not installed" state with the setup
// commands, and each sidebar entry registered as a palette command.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App, SCREENS } from "./App";
import type { KernelConnectionState, StudioBridge } from "./api/contract";
import { createCommandRegistry } from "./commands/registry";

function fakeBridge(state: KernelConnectionState): StudioBridge {
  return {
    connection: async () => state,
    request: async () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }),
    feed: { subscribe: async () => state, unsubscribe: async () => undefined, onFrame: () => () => undefined },
    onNavigate: () => () => undefined,
  };
}

async function renderApp(state: KernelConnectionState, registry = createCommandRegistry()) {
  render(<App api={fakeBridge(state)} registry={registry} />);
  // Let the first connection check settle.
  await act(async () => undefined);
  return registry;
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("the shell", () => {
  it("shows the sidebar's six entries: five buttons, Integrations on ⌘5, and the Crew group", async () => {
    await renderApp({ state: "connected", port: 1 });
    const sidebar = within(screen.getByTestId("sidebar"));
    expect(sidebar.getAllByRole("button").map((b) => b.textContent)).toEqual(["Chat⌘1", "Team⌘2", "Approvals⌘3", "Sessions⌘4", "Integrations⌘5"]);
    expect(sidebar.getByRole("heading", { name: "Crew" })).toBeTruthy();
  });

  it("routes each entry to its screen, Chat first", async () => {
    await renderApp({ state: "connected", port: 1 });
    expect(screen.getByTestId("screen-chat")).toBeTruthy();
    for (const id of ["team", "approvals", "sessions", "integrations", "chat"]) {
      const entry = SCREENS.find((s) => s.id === id);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${entry?.nav?.label}`) }));
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      expect(screen.getByTestId(`screen-${id}`)).toBeTruthy();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(entry?.title);
    }
  });

  it("connected: no band, no setup state", async () => {
    await renderApp({ state: "connected", port: 1 });
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
    expect(screen.queryByTestId("kernel-not-installed")).toBeNull();
  });

  it("unreachable: the band over the screen", async () => {
    await renderApp({ state: "unreachable", reason: "daemon_not_running" });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the kernel");
    expect(screen.getByTestId("screen-chat")).toBeTruthy();
  });

  it("not installed: the exact setup commands in place of the screen", async () => {
    await renderApp({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" });
    const setup = within(screen.getByTestId("kernel-not-installed"));
    expect(setup.getAllByText(/./, { selector: "code.setup-command" }).map((c) => c.textContent)).toEqual([
      "claude setup-token",
      "security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w",
      "studio service install",
    ]);
    expect(setup.getByText("/Users/o/.loomwright-studio/api.json")).toBeTruthy();
    expect(screen.queryByTestId("screen-chat")).toBeNull();
  });

  it("registers each sidebar entry as a palette command", async () => {
    const registry = await renderApp({ state: "connected", port: 1 });
    expect(registry.list().map((c) => [c.id, c.group, c.shortcut])).toEqual([
      ["screens.chat", "Screens", "⌘1"],
      ["screens.team", "Screens", "⌘2"],
      ["screens.approvals", "Screens", "⌘3"],
      ["screens.sessions", "Screens", "⌘4"],
      ["screens.integrations", "Screens", "⌘5"],
    ]);
  });
});
