/// <reference types="node" />
// @vitest-environment jsdom
// List: the README's navigation, data and Crew rows, skeleton loading rows and
// the empty Crew text (AC1); j/k and arrow keys, Enter opens, aria-current on
// the selected navigation row (AC4); scroll anchoring on insert-above with
// stubbed layout metrics (AC2, unit part; the real-renderer check is the e2e
// gallery spec); keyboard reach and naming (AC8); and the token-only source
// rule (AC7, AC9). CSS is read from disk with readFileSync, never `?raw`:
// vitest's css-disable plugin turns `*.css?raw` into an empty string.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { List, type ListDataItem } from "./List";
import { crewItems, dataItems, navItems, states } from "./List.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./List.css");

/** The declarations of the first top-level rule whose selector list is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return match[1];
}

const sessions = (count: number, prefix: string): ListDataItem[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: "data",
    key: `${prefix}${index}`,
    status: "working",
    subject: `Session ${prefix}${index}`,
    meta: "running 0m 10s",
  }));

const keyOf = (element: Element) => (element as HTMLElement).dataset.key;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("List rows (AC1)", () => {
  it("navigation rows: icon, label, kbd or count pill; the selected row is accent-soft, accent, 500 and aria-current=page", () => {
    render(<List label="Screens" items={navItems} defaultSelectedKey="sessions" />);
    const listbox = screen.getByRole("listbox", { name: "Screens" });
    const sessionsRow = within(listbox).getByRole("option", { name: "Sessions" });
    expect(sessionsRow.getAttribute("aria-current")).toBe("page");
    expect(sessionsRow.getAttribute("aria-selected")).toBe("true");
    const chat = within(listbox).getByRole("option", { name: "Chat" });
    expect(chat.getAttribute("aria-current")).toBeNull();
    expect(chat.getAttribute("aria-selected")).toBe("false");
    expect(chat.querySelector(".list-icon svg")).toBeTruthy();
    expect(chat.querySelector(".list-kbd")?.textContent).toBe("⌘1");
    expect(chat.getAttribute("aria-describedby")).toBe(chat.querySelector(".list-kbd")?.id);
    // The count pill replaces the kbd and its unit joins the row's name.
    const approvals = within(listbox).getByRole("option", { name: "Approvals 3 pending" });
    expect(within(approvals).getByRole("img", { name: "3 pending" }).textContent).toBe("3");
    expect(approvals.querySelector(".list-kbd")).toBeNull();

    expect(ruleBody(css, '.list-row[data-kind="nav"]')).toMatch(/height:\s*var\(--row-height\)/);
    const selected = ruleBody(css, '.list-row[data-kind="nav"][aria-selected="true"]');
    expect(selected).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(selected).toMatch(/color:\s*var\(--accent\)/);
    expect(selected).toMatch(/font-weight:\s*500/);
    expect(ruleBody(css, ".list-kbd")).toMatch(/color:\s*var\(--ink-tertiary\)/);
  });

  it("data rows: an 8px StatusDot, the subject in body-strong, a tabular ink-tertiary caption meta and a right column, 44px high", () => {
    render(<List label="Sessions" items={dataItems} defaultSelectedKey="s1" />);
    const row = screen.getByRole("option", { name: "Mason · review PR 412" });
    expect(row.querySelector(".status-dot[data-state='working']")).toBeTruthy();
    expect(within(row).getByRole("img", { name: "working" })).toBeTruthy();
    expect(row.querySelector(".list-subject")?.textContent).toBe("Mason · review PR 412");
    expect(row.querySelector(".list-meta")?.textContent).toBe("running 4m 12s · 14.2k tokens");
    expect(row.querySelector(".list-aside")?.textContent).toBe("Sonnet 5");
    expect(row.getAttribute("aria-current")).toBeNull();
    // A verified ok carries its dot; the waiting row its attention dot.
    const done = screen.getByRole("option", { name: "Mason · review PR 401" });
    expect(done.querySelector(".status-dot[data-state='ok']")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Ada · post review on PR 405" }).querySelector(".status-dot[data-state='waiting']")).toBeTruthy();

    const data = ruleBody(css, '.list-row[data-kind="data"]');
    expect(data).toMatch(/height:\s*44px/);
    expect(ruleBody(css, '.list-row[data-kind="data"][aria-selected="true"]')).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(ruleBody(css, '.list-row[data-kind="data"]:hover')).toMatch(/background:\s*var\(--surface\)/);
    expect(ruleBody(css, ".list-subject,\n.list-name")).toMatch(/font-weight:\s*var\(--type-body-strong-weight\)/);
    const meta = ruleBody(css, ".list-meta,\n.list-aside,\n.list-time");
    expect(meta).toMatch(/color:\s*var\(--ink-tertiary\)/);
    expect(meta).toMatch(/font-size:\s*var\(--type-caption-size\)/);
    expect(meta).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("a verified ok shows its verification time on screen beside the dot, as every StatusDot consumer does (AC5)", () => {
    render(<List label="Sessions" items={dataItems} />);
    const done = screen.getByRole("option", { name: "Mason · review PR 401" });
    expect(done.querySelector(".list-status .status-meta")?.textContent).toBe("· verified 14:02");
    // No rule in List.css hides StatusDot's meta (one rule for List, Card and Toast).
    expect(css).not.toMatch(/\.status-meta/);
  });

  it("an unverified ok in a data row stays a guess: no dot", () => {
    render(<List label="Sessions" items={[{ kind: "data", key: "g", status: "ok", subject: "Maybe merged" }]} />);
    const row = screen.getByRole("option", { name: "Maybe merged" });
    expect(row.querySelector(".status-dot")).toBeNull();
    expect(row.querySelector(".status-guess")).toBeTruthy();
  });

  it("Crew rows: a 24px avatar slot, the name with an accent unread dot, a tabular time and a caption line, never a StatusDot", () => {
    render(<List label="Crew" heading="Crew" items={crewItems} />);
    expect(screen.getByText("Crew").className).toBe("list-heading");
    const mason = screen.getByRole("option", { name: "Mason" });
    expect(within(mason).getByRole("img", { name: "Mason · waiting on you" })).toBeTruthy();
    expect(within(mason).getByRole("img", { name: "unread" }).className).toBe("list-unread");
    expect(mason.querySelector(".list-time")?.textContent).toBe("14:08");
    expect(mason.querySelector(".list-meta")?.textContent).toBe("Waiting on you · post review on PR 412");
    const ada = screen.getByRole("option", { name: "Ada" });
    expect(ada.querySelector(".list-unread")).toBeNull();
    expect(screen.getByRole("listbox").querySelector(".status-dot")).toBeNull();

    expect(ruleBody(css, '.list-row[data-kind="crew"]')).toMatch(/height:\s*44px/);
    expect(ruleBody(css, ".list-avatar")).toMatch(/width:\s*24px/);
    expect(ruleBody(css, ".list-unread")).toMatch(/background:\s*var\(--accent\)/);
  });

  it("loading renders skeleton rows on surface-sunken at the real row heights, never a spinner", () => {
    const { container } = render(<List label="Sessions" items={dataItems} loading skeletonRows={4} />);
    const root = container.querySelector(".list");
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll(".list-skeleton[data-kind='data']")).toHaveLength(4);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
    expect(container.querySelector(".list-skeleton")?.closest("[aria-hidden='true']")).toBeTruthy();
    // Skeletons are static: List.css declares no animation at all.
    expect(css).not.toMatch(/@keyframes|animation/);
    expect(ruleBody(css, ".list-skeleton i")).toMatch(/background:\s*var\(--surface-sunken\)/);
    expect(ruleBody(css, ".list-skeleton")).toMatch(/height:\s*44px/);
    expect(ruleBody(css, '.list-skeleton[data-kind="nav"]')).toMatch(/height:\s*var\(--row-height\)/);
  });

  it("an empty Crew group says the README's words", () => {
    const { container } = render(
      <List label="Crew" heading="Crew" items={[]} emptyText="No specialists yet. Wright proposes one when a duty needs it." />,
    );
    expect(screen.getByText("No specialists yet. Wright proposes one when a duty needs it.")).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(container.querySelector(".list-empty")).toBeTruthy();
  });

  it("the Crew empty-state state uses the exact README text", () => {
    const empty = states.find((state) => state.id === "crew-empty");
    expect(empty).toBeTruthy();
    if (!empty) return;
    render(empty.render());
    expect(screen.getByText("No specialists yet. Wright proposes one when a duty needs it.")).toBeTruthy();
  });

  it("a streaming meta update changes the text in place; every line is a fixed single line", () => {
    const { rerender } = render(<List label="Sessions" items={dataItems} />);
    const row = screen.getByRole("option", { name: "Mason · review PR 412" });
    const first = dataItems[0];
    if (!first) throw new Error("fixture");
    rerender(<List label="Sessions" items={[{ ...first, meta: "running 4m 13s · 14.3k tokens" }, ...dataItems.slice(1)]} />);
    expect(screen.getByRole("option", { name: "Mason · review PR 412" })).toBe(row);
    expect(row.querySelector(".list-meta")?.textContent).toBe("running 4m 13s · 14.3k tokens");
    expect(ruleBody(css, ".list-meta,\n.list-aside,\n.list-time")).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody(css, ".list-subject,\n.list-name")).toMatch(/white-space:\s*nowrap/);
  });

  it("has no zebra stripes", () => {
    expect(css).not.toMatch(/nth-(?:child|of-type)/);
  });

  it("renders every gallery state", () => {
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    for (const state of states) {
      const { container, unmount } = render(state.render());
      expect(container.querySelector(".list")).toBeTruthy();
      unmount();
    }
  });
});

describe("List keyboard (AC4, AC8)", () => {
  it("Tab reaches exactly one row: the selected one, or the first when nothing is selected", () => {
    const { unmount } = render(<List label="Sessions" items={dataItems} defaultSelectedKey="s3" />);
    const tabbable = screen.getAllByRole("option").filter((row) => row.tabIndex === 0);
    expect(tabbable.map(keyOf)).toEqual(["s3"]);
    unmount();
    render(<List label="Sessions" items={dataItems} />);
    expect(screen.getAllByRole("option").filter((row) => row.tabIndex === 0).map(keyOf)).toEqual(["s1"]);
  });

  it("j moves the selection down one row and the focus with it", () => {
    render(<List label="Sessions" items={dataItems} defaultSelectedKey="s1" />);
    const start = screen.getByRole("option", { selected: true });
    start.focus();
    fireEvent.keyDown(start, { key: "j" });
    const next = screen.getByRole("option", { selected: true });
    expect(keyOf(next)).toBe("s2");
    expect(document.activeElement).toBe(next);
    expect(next.tabIndex).toBe(0);
    expect(start.tabIndex).toBe(-1);
  });

  it("ArrowDown moves down, k and ArrowUp move up, and the ends clamp", () => {
    const onSelect = vi.fn();
    render(<List label="Sessions" items={dataItems} defaultSelectedKey="s1" onSelect={onSelect} />);
    const selectedKey = () => keyOf(screen.getByRole("option", { selected: true }));
    screen.getByRole("option", { selected: true }).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(selectedKey()).toBe("s2");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(selectedKey()).toBe("s3");
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(selectedKey()).toBe("s2");
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(selectedKey()).toBe("s1");
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(selectedKey()).toBe("s1");
    expect(onSelect.mock.calls.map(([item]) => item.key)).toEqual(["s2", "s3", "s2", "s1"]);
    expect(document.activeElement).toBe(screen.getByRole("option", { selected: true }));
  });

  it("j with nothing selected selects the first row", () => {
    render(<List label="Sessions" items={dataItems} />);
    const first = screen.getAllByRole("option")[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "j" });
    expect(keyOf(screen.getByRole("option", { selected: true }))).toBe("s1");
  });

  it("leaves Cmd/Ctrl/Alt chords to the app (Cmd+K is the palette)", () => {
    render(<List label="Sessions" items={dataItems} defaultSelectedKey="s2" />);
    const row = screen.getByRole("option", { selected: true });
    row.focus();
    fireEvent.keyDown(row, { key: "k", metaKey: true });
    fireEvent.keyDown(row, { key: "j", ctrlKey: true });
    expect(keyOf(screen.getByRole("option", { selected: true }))).toBe("s2");
  });

  it("Enter calls the open handler with the focused row", () => {
    const onOpen = vi.fn();
    render(<List label="Sessions" items={dataItems} defaultSelectedKey="s1" onOpen={onOpen} />);
    const row = screen.getByRole("option", { selected: true });
    row.focus();
    fireEvent.keyDown(row, { key: "j" });
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ key: "s2", subject: "Wright · triage comments on PR 398" });
  });

  it("Space and a click also open the row; a click selects it", () => {
    const onOpen = vi.fn();
    render(<List label="Screens" items={navItems} defaultSelectedKey="chat" onOpen={onOpen} />);
    const team = screen.getByRole("option", { name: "Team" });
    fireEvent.click(team);
    expect(team.getAttribute("aria-current")).toBe("page");
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ key: "team" }));
    team.focus();
    fireEvent.keyDown(team, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("controlled selection: the List reports moves and follows the selectedKey prop", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<List label="Screens" items={navItems} selectedKey="chat" onSelect={onSelect} />);
    const chat = screen.getByRole("option", { name: "Chat" });
    chat.focus();
    fireEvent.keyDown(chat, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "team" }));
    // Not moved until the owner says so.
    expect(chat.getAttribute("aria-current")).toBe("page");
    rerender(<List label="Screens" items={navItems} selectedKey="team" onSelect={onSelect} />);
    const team = screen.getByRole("option", { name: "Team" });
    expect(team.getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(team);
  });

  it("removing the focused row moves focus to the row now at its index and selects it (uncontrolled); j keeps working", () => {
    const items = sessions(4, "s");
    const { rerender } = render(<List label="Sessions" items={items} defaultSelectedKey="s1" />);
    act(() => screen.getByRole("option", { name: "Session s1" }).focus());
    rerender(<List label="Sessions" items={items.filter((item) => item.key !== "s1")} defaultSelectedKey="s1" />);
    const next = screen.getByRole("option", { name: "Session s2" });
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("aria-selected")).toBe("true");
    expect(next.tabIndex).toBe(0);
    fireEvent.keyDown(next, { key: "j" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Session s3" }));
  });

  it("removing the focused last row moves focus to the new last row; a controlled List only moves focus", () => {
    const onSelect = vi.fn();
    const items = sessions(3, "s");
    const { rerender } = render(<List label="Sessions" items={items} selectedKey="s2" onSelect={onSelect} />);
    act(() => screen.getByRole("option", { name: "Session s2" }).focus());
    rerender(<List label="Sessions" items={items.slice(0, 2)} selectedKey="s2" onSelect={onSelect} />);
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Session s1" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("removing a row never steals focus that is outside the list", () => {
    const items = sessions(3, "s");
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <List label="Sessions" items={items} defaultSelectedKey="s1" />
      </>,
    );
    act(() => screen.getByRole("option", { name: "Session s1" }).focus());
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    act(() => elsewhere.focus());
    rerender(
      <>
        <button type="button">Elsewhere</button>
        <List label="Sessions" items={items.filter((item) => item.key !== "s1")} defaultSelectedKey="s1" />
      </>,
    );
    expect(document.activeElement).toBe(elsewhere);
  });

  it("shows the focus ring on the row on :focus-visible", () => {
    expect(ruleBody(css, ".list-row:focus-visible")).toMatch(/outline:\s*2px solid var\(--focus\)/);
  });
});

describe("List scroll anchoring (AC2, unit part)", () => {
  const ROW = 44;
  const VIEWPORT = 220;

  /** jsdom has no layout: rows stack at 44px, the List is a 220px viewport at y=0. */
  function stubLayout() {
    const original = HTMLElement.prototype.getBoundingClientRect;
    const box = (top: number, height: number) =>
      ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("list")) return box(0, VIEWPORT);
      if (this.classList.contains("list-row") && this.parentElement) {
        const index = Array.from(this.parentElement.children).indexOf(this);
        const scroller = this.closest<HTMLElement>(".list");
        return box(index * ROW - (scroller?.scrollTop ?? 0), ROW);
      }
      return original.call(this);
    });
  }

  it("inserting three rows above the selected row keeps its key and on-screen top: scrollTop grows by their height", () => {
    stubLayout();
    const initial = sessions(12, "r");
    const { container, rerender } = render(<List label="Sessions" items={initial} selectedKey="r5" />);
    const list = container.querySelector<HTMLElement>(".list");
    if (!list) throw new Error("no list");
    // Scroll the selected row into the middle of the viewport.
    list.scrollTop = 120;
    fireEvent.scroll(list);
    const selected = screen.getByRole("option", { selected: true });
    const before = selected.getBoundingClientRect().top;
    expect(before).toBe(5 * ROW - 120);

    rerender(<List label="Sessions" items={[...sessions(3, "n"), ...initial]} selectedKey="r5" />);

    expect(list.scrollTop).toBe(120 + 3 * ROW);
    const after = screen.getByRole("option", { selected: true });
    expect(keyOf(after)).toBe("r5");
    expect(after).toBe(selected);
    expect(after.getBoundingClientRect().top).toBe(before);
  });

  it("with no selected row on screen it anchors the first visible row", () => {
    stubLayout();
    const initial = sessions(12, "r");
    const { container, rerender } = render(<List label="Sessions" items={initial} />);
    const list = container.querySelector<HTMLElement>(".list");
    if (!list) throw new Error("no list");
    list.scrollTop = 2 * ROW;
    fireEvent.scroll(list);
    rerender(<List label="Sessions" items={[...sessions(2, "n"), ...initial]} />);
    expect(list.scrollTop).toBe(4 * ROW);
  });

  it("when the selected row is removed in the same update, it falls back to the previous first visible row", () => {
    stubLayout();
    const initial = sessions(12, "r");
    const { container, rerender } = render(<List label="Sessions" items={initial} selectedKey="r5" />);
    const list = container.querySelector<HTMLElement>(".list");
    if (!list) throw new Error("no list");
    list.scrollTop = 120;
    fireEvent.scroll(list);
    // r2 is the first visible row (top -32); r5 (selected) leaves as three rows arrive above.
    rerender(<List label="Sessions" items={[...sessions(3, "n"), ...initial.filter((item) => item.key !== "r5")]} selectedKey="r5" />);
    expect(list.scrollTop).toBe(120 + 3 * ROW);
  });

  it("appending below or updating meta never moves the scroll position", () => {
    stubLayout();
    const initial = sessions(12, "r");
    const { container, rerender } = render(<List label="Sessions" items={initial} selectedKey="r5" />);
    const list = container.querySelector<HTMLElement>(".list");
    if (!list) throw new Error("no list");
    list.scrollTop = 120;
    fireEvent.scroll(list);
    rerender(<List label="Sessions" items={[...initial, ...sessions(3, "z")]} selectedKey="r5" />);
    expect(list.scrollTop).toBe(120);
    rerender(<List label="Sessions" items={[...initial.map((item) => ({ ...item, meta: "running 0m 11s" })), ...sessions(3, "z")]} selectedKey="r5" />);
    expect(list.scrollTop).toBe(120);
  });

  it("a scroll event measures O(log n) rows, not every row", () => {
    stubLayout();
    const initial = sessions(512, "r");
    const { container, rerender } = render(<List label="Sessions" items={initial} selectedKey="r0" />);
    const list = container.querySelector<HTMLElement>(".list");
    if (!list) throw new Error("no list");
    const spy = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    spy.mockClear();
    list.scrollTop = 200 * ROW + 10;
    fireEvent.scroll(list);
    const rowReads = spy.mock.contexts.filter((el) => (el as HTMLElement).classList.contains("list-row")).length;
    expect(rowReads).toBeGreaterThan(0);
    expect(rowReads).toBeLessThanOrEqual(16);
    // The search still found the right anchor: inserting above keeps the first visible row put.
    rerender(<List label="Sessions" items={[...sessions(3, "n"), ...initial]} selectedKey="r0" />);
    expect(list.scrollTop).toBe(203 * ROW + 10);
  });

  it("native overflow-anchor is off so the List's own anchoring is the only one", () => {
    expect(ruleBody(css, ".list")).toMatch(/overflow-anchor:\s*none/);
  });
});

describe("List source (AC7, AC9)", () => {
  const sources = { "List.css": css, "List.tsx": read("./List.tsx"), "List.states.tsx": read("./List.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("has no dollar figure", () => {
    for (const source of Object.values(sources)) expect(source).not.toMatch(/\$\d/);
  });

  it("carries a prefers-reduced-motion block that zeroes the row transition", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.list-row\s*\{\s*transition-duration:\s*0s;/);
  });
});
