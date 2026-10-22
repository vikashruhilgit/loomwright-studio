/// <reference types="node" />
// @vitest-environment jsdom
// Card: the agent and task cards are focusable and open on Enter (AC1, AC8),
// the README's layout rules (one-line name, reserved two-line role with the
// full role as tooltip, two-line task clamp, budget block pinned to the bottom
// with the meter turning attention from 80%, a meta row that never wraps and
// no hairline above it, auto-fill 250px grid with 1fr rows), no buttons on the
// face, no dollar figure, and the token-only source rule (AC7, AC9). CSS is
// read from disk with readFileSync, never `?raw`: vitest's css-disable plugin
// turns `*.css?raw` into an empty string.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chip } from "../Badge/Badge";
import { AgentCard, budgetPercent, CardGrid, formatTokens, TaskCard } from "./Card";
import { states } from "./Card.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./Card.css");

/** The declarations of the first top-level rule whose selector list is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return match[1];
}

const mason = (overrides: Partial<Parameters<typeof AgentCard>[0]> = {}) => (
  <AgentCard
    avatar={<span role="img" aria-label="Mason · waiting on you" />}
    name="Mason"
    role="Reviewer · comments only, can't push"
    task="Waiting on you · post review on PR 412"
    taskState="waiting"
    budget={{ used: 98_000, limit: 160_000, period: "today" }}
    model="Sonnet 5"
    {...overrides}
  />
);

afterEach(cleanup);

describe("AgentCard (AC1)", () => {
  it("is a focusable card named by the agent and described by role, task and budget", () => {
    render(mason());
    const card = screen.getByRole("button", { name: "Mason" });
    expect(card.tabIndex).toBe(0);
    expect(card.getAttribute("aria-describedby")?.split(" ")).toHaveLength(4);
    expect(within(card).getByRole("img", { name: "Mason · waiting on you" }).parentElement?.className).toBe("card-avatar");
    expect(card.querySelector(".card-role")?.textContent).toBe("Reviewer · comments only, can't push");
    expect(card.querySelector(".status-dot[data-state='waiting']")).toBeTruthy();
    expect(card.querySelector(".card-meta-label")?.textContent).toBe("98k of 160k today");
    expect(card.querySelector(".card-meta-model")?.textContent).toBe("Sonnet 5");
  });

  it("opens on Enter, Space and click", () => {
    const onOpen = vi.fn();
    render(mason({ onOpen }));
    const card = screen.getByRole("button", { name: "Mason" });
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(card, { key: "Enter", metaKey: true });
    fireEvent.keyDown(card, { key: "a" });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("puts no button on the card face", () => {
    const card = render(mason()).container.querySelector(".card");
    if (!(card instanceof HTMLElement)) throw new Error("no card");
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(card.querySelector("button, a, input")).toBeNull();
  });

  it("the full role is the card's tooltip and the full task the task line's", () => {
    render(mason());
    const card = screen.getByRole("button", { name: "Mason" });
    expect(card.getAttribute("title")).toBe("Reviewer · comments only, can't push");
    expect(card.querySelector(".card-task")?.getAttribute("title")).toBe("Waiting on you · post review on PR 412");
  });

  it("the meter is accent below 80% and attention from 80%", () => {
    const { unmount } = render(mason({ budget: { used: 79, limit: 100 } }));
    const low = document.querySelector<HTMLElement>(".card-meter");
    expect(low?.dataset.level).toBe("normal");
    expect(low?.querySelector<HTMLElement>(".card-meter-fill")?.style.width).toBe("79%");
    unmount();
    render(mason({ budget: { used: 80, limit: 100 } }));
    expect(document.querySelector<HTMLElement>(".card-meter")?.dataset.level).toBe("high");
    expect(ruleBody(css, ".card-meter-fill")).toMatch(/background:\s*var\(--accent\)/);
    expect(ruleBody(css, '.card-meter[data-level="high"] .card-meter-fill')).toMatch(/background:\s*var\(--attention\)/);
    expect(ruleBody(css, ".card-meter")).toMatch(/height:\s*3px/);
  });

  it("clamps the budget share and formats tokens, never dollars", () => {
    expect(budgetPercent(500, 250)).toBe(100);
    expect(budgetPercent(-5, 250)).toBe(0);
    expect(budgetPercent(10, 0)).toBe(100);
    expect(budgetPercent(0, 0)).toBe(0);
    expect(budgetPercent(Number.NaN, 100)).toBe(0);
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(9_000)).toBe("9k");
    expect(formatTokens(9_400)).toBe("9.4k");
    expect(formatTokens(142_000)).toBe("142k");
    expect(formatTokens(999_700)).toBe("1M");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(-1)).toBe("0");
    render(mason({ budget: { used: 142_000, limit: 375_000 } }));
    const label = document.querySelector(".card-meta-label")?.textContent ?? "";
    expect(label).toBe("142k of 375k");
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it("an idle task line is ink-tertiary; a card with no task omits the line", () => {
    const { unmount } = render(mason({ task: "idle · last ran 09:41", taskState: "idle" }));
    expect(document.querySelector(".card-task")?.getAttribute("data-idle")).toBe("true");
    expect(ruleBody(css, '.card-task[data-idle="true"]')).toMatch(/color:\s*var\(--ink-tertiary\)/);
    unmount();
    render(mason({ task: undefined, taskState: undefined }));
    expect(document.querySelector(".card-task-line")).toBeNull();
    expect(screen.getByRole("button", { name: "Mason" }).getAttribute("aria-describedby")?.split(" ")).toHaveLength(3);
  });

  it("follows the README's layout rules", () => {
    const card = ruleBody(css, ".card");
    expect(card).toMatch(/background:\s*var\(--surface\)/);
    expect(card).toMatch(/border:\s*1px solid var\(--hairline\)/);
    expect(card).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(card).toMatch(/padding:\s*var\(--space-4\)/);
    // No shadow at rest (the transition names box-shadow; no declaration sets one).
    expect(card).not.toMatch(/\bbox-shadow:/);
    expect(card).not.toMatch(/border-left/);
    expect(ruleBody(css, ".card:hover")).toMatch(/box-shadow:\s*var\(--shadow-1\)/);
    expect(ruleBody(css, ".card:focus-visible")).toMatch(/outline:\s*2px solid var\(--focus\)/);
    const name = ruleBody(css, ".card-name");
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/font-size:\s*var\(--type-title-2-size\)/);
    const role = ruleBody(css, ".card-role");
    expect(role).toMatch(/-webkit-line-clamp:\s*2/);
    expect(role).toMatch(/height:\s*calc\(2 \* var\(--type-caption-line\)\)/);
    expect(ruleBody(css, ".card-task")).toMatch(/-webkit-line-clamp:\s*2/);
    expect(ruleBody(css, ".card-budget")).toMatch(/margin-top:\s*auto/);
    const meta = ruleBody(css, ".card-meta");
    expect(meta).toMatch(/white-space:\s*nowrap/);
    expect(meta).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(meta).not.toMatch(/border/);
    expect(ruleBody(css, ".card-avatar")).toMatch(/width:\s*36px/);
  });
});

describe("TaskCard (AC1)", () => {
  it("shows the subject, linked chips and a state line where each fact is a Badge; opens on Enter", () => {
    const onOpen = vi.fn();
    render(
      <TaskCard
        subject="Review the onboarding flow"
        chips={<Chip>loomwright PR 412</Chip>}
        facts={[{ label: "1/2 approvals" }, { label: "CI green", tone: "ok" }, { label: "waiting on Mason", tone: "attention" }]}
        onOpen={onOpen}
      />,
    );
    const card = screen.getByRole("button", { name: "Review the onboarding flow" });
    expect(within(card).getByText("loomwright PR 412").closest(".chip")).toBeTruthy();
    const badges = Array.from(card.querySelectorAll(".card-facts .badge"));
    expect(badges.map((badge) => [badge.textContent, badge.getAttribute("data-tone")])).toEqual([
      ["1/2 approvals", "neutral"],
      ["CI green", "ok"],
      ["waiting on Mason", "attention"],
    ]);
    card.focus();
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
  });

  it("renders without chips or facts", () => {
    const { container } = render(<TaskCard subject="Draft the release notes" />);
    expect(container.querySelector(".card-chips")).toBeNull();
    expect(container.querySelector(".card-facts")).toBeNull();
    expect(screen.getByRole("button", { name: "Draft the release notes" }).getAttribute("aria-describedby")).toBeNull();
  });
});

describe("CardGrid (AC1)", () => {
  it("is auto-fill with a 250px minimum and equal 1fr rows, and Tab reaches every card in order", () => {
    render(
      <CardGrid label="Team">
        {mason()}
        <TaskCard subject="Draft the release notes" />
      </CardGrid>,
    );
    const group = screen.getByRole("group", { name: "Team" });
    expect(within(group).getAllByRole("button").map((card) => [card.tabIndex, card.getAttribute("aria-labelledby") !== null])).toEqual([
      [0, true],
      [0, true],
    ]);
    const rule = ruleBody(css, ".card-grid");
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(250px,\s*1fr\)\)/);
    expect(rule).toMatch(/grid-auto-rows:\s*1fr/);
  });

  it("renders every gallery state", () => {
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    for (const state of states) {
      const { container, unmount } = render(state.render());
      expect(container.querySelectorAll(".card").length).toBeGreaterThan(0);
      expect(container.textContent).not.toMatch(/\$/);
      unmount();
    }
  });
});

describe("Card source (AC7, AC9)", () => {
  const sources = { "Card.css": css, "Card.tsx": read("./Card.tsx"), "Card.states.tsx": read("./Card.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("carries a prefers-reduced-motion block that zeroes the hover transition", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.card\s*\{\s*transition-duration:\s*0s;/);
  });
});
