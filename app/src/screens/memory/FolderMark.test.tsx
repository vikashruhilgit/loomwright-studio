// @vitest-environment jsdom
// The mark a Memory folder wears (phase 7 item 26): the roster's avatar for an agent's folder, the avatar's own
// fallback when the roster has no entry or has not answered, and the shared icon for `shared`. The slot is
// decorative (`aria-hidden`), so the avatar is found by its `.bot` class, not by role.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RosterEntry } from "../../api/contract";
import { FolderMark } from "./FolderMark";

afterEach(cleanup);

function entry(id: string, name: string, shape: string, hue: string): RosterEntry {
  return {
    id,
    display_name: name,
    avatar: { shape, hue },
    status: "active",
    created_by: null,
    approval_id: null,
    model: null,
    settings_error: null,
    tokens_today: 0,
    tokens_per_day: null,
    sessions_running: 0,
    sessions_at_once: null,
  };
}

const ROSTER = [entry("wright", "Wright", "whale", "accent"), entry("mason", "Mason", "octopus", "crew-berry")];

describe("FolderMark", () => {
  it("draws the roster's avatar for an agent's folder, in a decorative slot", () => {
    const { container } = render(<FolderMark folder="mason" label="Mason" roster={ROSTER} />);
    const slot = container.querySelector(".memory-mark");
    expect(slot?.getAttribute("aria-hidden")).toBe("true");
    const bot = slot?.querySelector(".bot");
    expect(bot).not.toBeNull();
    expect(bot?.getAttribute("style")).toContain("var(--crew-berry)");
    expect(slot?.querySelector(".memory-mark-icon")).toBeNull();
  });

  it("draws Wright's whale, wearing the accent", () => {
    const { container } = render(<FolderMark folder="wright" label="Wright" roster={ROSTER} />);
    const bot = container.querySelector(".bot");
    expect(bot?.classList.contains("lead")).toBe(true);
    expect(bot?.getAttribute("style")).toContain("var(--accent)");
  });

  it("falls back to the avatar's own fish and slate when the roster has no entry for the folder", () => {
    const { container } = render(<FolderMark folder="phase4-exit-mvg8wle4cf8f26" label="Phase4-exit-mvg8wle4cf8f26" roster={ROSTER} />);
    const bot = container.querySelector(".bot");
    expect(bot).not.toBeNull();
    expect(bot?.getAttribute("style")).toContain("var(--crew-slate)");
  });

  it("falls back the same way while the roster has not answered", () => {
    const { container } = render(<FolderMark folder="mason" label="Mason" roster={undefined} />);
    const bot = container.querySelector(".bot");
    expect(bot).not.toBeNull();
    expect(bot?.getAttribute("style")).toContain("var(--crew-slate)");
  });

  it("draws the shared icon, not an avatar, for the shared folder", () => {
    const { container } = render(<FolderMark folder="shared" label="Shared" roster={ROSTER} />);
    expect(container.querySelector(".bot")).toBeNull();
    const icon = container.querySelector("svg.memory-mark-icon");
    expect(icon).not.toBeNull();
    // The shared icon is two circles and a path; the file icon is two paths and no circle.
    expect(icon?.querySelectorAll("circle").length).toBe(2);
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the roster's display name in the avatar's tooltip, never the markup it might carry", () => {
    const hostile = [entry("mason", "<img src=x onerror=alert(1)>", "octopus", "crew-berry")];
    const { container } = render(<FolderMark folder="mason" label="Mason" roster={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".bot")?.getAttribute("title")).toContain("<img");
  });
});
