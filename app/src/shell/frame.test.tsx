// @vitest-environment jsdom
// The window's frame, from the approved mockup (gui-v2.html): the title bar's optional count line
// (`ScreenDefinition.Subtitle`), and the sidebar's glyphs, divider, labels, accessible names and bottom row (the
// kernel's state word with its dot, and the ⌘K hint). The bottom row is driven by the live store in fake time,
// through the real `App`, so a state the store reads is the state the row shows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, SCREENS } from "../App";
import type { StatusBody } from "../api/contract";
import { createCommandRegistry } from "../commands/registry";
import type { ScreenDefinition } from "../screens/types";
import { fakeBridge, ok } from "../store/fake-bridge";
import type { FakeBridge } from "../store/fake-bridge";
import { liveStoreFor } from "../store/react";
import { REFETCH_THROTTLE_MS } from "../store/store";
import { NAV_GROUP_END, Sidebar, kernelWord } from "./Sidebar";
import { Titlebar } from "./Titlebar";

const STATUS: StatusBody = {
  kernel: { version: "1.2.3", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-22", agents: [] },
  cap_state: [],
};

const SESSION: StatusBody["sessions"][number] = { id: 1, agent: "pim", model: null, pgid: 9, started_at: null, status: "running", cwd: null };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-22T09:30:15Z"));
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Render the real shell over `fake` and let the first connection check settle. */
async function renderShell(fake: FakeBridge): Promise<void> {
  render(<App api={fake.bridge} registry={createCommandRegistry()} />);
  await act(async () => undefined);
}

/** Make the store live: the feed proves itself with a heartbeat and the status read lands. */
async function goLive(fake: FakeBridge): Promise<void> {
  act(() => fake.emit({ type: "heartbeat", latest_id: 0 }));
  await advance(REFETCH_THROTTLE_MS * 4);
  expect(liveStoreFor(fake.bridge).getSnapshot().connection).toEqual({ state: "live" });
}

const statusRow = (): HTMLElement => screen.getByRole("status", { name: /^Kernel: / });
/** The row's dot (the shared StatusDot's `data-state`): `failed` is the danger dot. */
const dotState = (): string | null => statusRow().querySelector(".status-dot")?.getAttribute("data-state") ?? null;

describe("the title bar", () => {
  const Count = () => <>12 tasks</>;
  const plain: ScreenDefinition = { id: "plain", title: "Plain", Component: () => null };
  const counted: ScreenDefinition = { id: "counted", title: "Counted", Component: () => null, Subtitle: Count };

  it("a screen that declares a Subtitle shows it beside the title", () => {
    render(<Titlebar screen={counted} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Counted");
    const subtitle = screen.getByTestId("titlebar-subtitle");
    expect(subtitle.textContent).toBe("12 tasks");
    // Beside the title, in the same bar, after it.
    expect(subtitle.parentElement).toBe(screen.getByRole("banner", { hidden: true }) as HTMLElement);
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling).toBe(subtitle);
  });

  it("a screen that declares none shows the title alone, with no empty subtitle element", () => {
    const { container } = render(<Titlebar screen={plain} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plain");
    expect(screen.queryByTestId("titlebar-subtitle")).toBeNull();
    expect(container.querySelector(".titlebar-subtitle")).toBeNull();
    expect(container.querySelector("header")?.children).toHaveLength(1);
  });

  it("no screen declares one yet (each screen's item moves its own count line)", () => {
    expect(SCREENS.filter((s) => s.Subtitle !== undefined).map((s) => s.id)).toEqual(["budget"]);
  });
});

describe("the sidebar's entries", () => {
  async function renderSidebar(): Promise<HTMLElement> {
    const fake = fakeBridge();
    render(<Sidebar api={fake.bridge} screens={SCREENS} currentId="chat" onGo={() => undefined} />);
    await act(async () => undefined);
    return screen.getByRole("navigation", { name: "Screens" });
  }

  it("every entry has a decorative glyph, and its accessible name is its label alone (no shortcut, no glyph)", async () => {
    const nav = await renderSidebar();
    const entries = SCREENS.filter((s) => s.nav !== undefined);
    expect(entries).toHaveLength(11);
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(entries.length);
    entries.forEach((s, index) => {
      const button = buttons[index] as HTMLElement;
      const svg = button.querySelector("svg");
      expect(svg, `${s.id} has a glyph`).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden"), `${s.id}'s glyph is decorative`).toBe("true");
      expect(within(nav).getByRole("button", { name: s.nav?.label as string })).toBe(button);
    });
  });

  it("the entries are labelled as the mockup labels them, Schedules & triggers included", async () => {
    const nav = await renderSidebar();
    expect(within(nav).getAllByRole("button").map((b) => b.querySelector(".nav-text")?.textContent)).toEqual([
      "Chat",
      "Team",
      "Approvals",
      "Sessions",
      "Integrations",
      "Tasks",
      "Playbooks",
      "Schedules & triggers",
      "Memory",
      "Budget & audit",
      "Settings",
    ]);
  });

  it("one divider, between Integrations and Tasks", async () => {
    const nav = await renderSidebar();
    const dividers = within(nav).getAllByRole("separator");
    expect(dividers).toHaveLength(1);
    const divider = dividers[0] as HTMLElement;
    expect(NAV_GROUP_END).toBe("integrations");
    expect(divider.previousElementSibling).toBe(within(nav).getByRole("button", { name: "Integrations" }));
    expect(divider.nextElementSibling).toBe(within(nav).getByRole("button", { name: "Tasks" }));
  });

  it("the current entry is marked, and a click goes to its screen", async () => {
    const fake = fakeBridge();
    const go = vi.fn();
    render(<Sidebar api={fake.bridge} screens={SCREENS} currentId="tasks" onGo={go} />);
    await act(async () => undefined);
    expect(within(screen.getByRole("navigation", { name: "Screens" })).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.querySelector(".nav-text")?.textContent)).toEqual(["Tasks"]);
    act(() => screen.getByRole("button", { name: "Memory" }).click());
    expect(go).toHaveBeenCalledWith("memory");
  });

  it("the Crew group sits after the entries, and the bottom row after the Crew group", async () => {
    await renderSidebar();
    const aside = screen.getByTestId("sidebar");
    const order = [...aside.children].map((el) => el.className || el.tagName);
    expect(order.indexOf("nav")).toBeLessThan(order.indexOf("nav-group"));
    expect(order.indexOf("nav-group")).toBeLessThan(order.indexOf("sidebar-foot"));
  });
});

describe("the sidebar's bottom row", () => {
  it("the ⌘K hint is labelled Command palette and sits outside the status region", async () => {
    await renderShell(fakeBridge());
    const hint = screen.getByRole("img", { name: "Command palette" });
    expect(hint.textContent).toBe("⌘K");
    expect(statusRow().contains(hint)).toBe(false);
  });

  it("connecting until the store is live: the idle ring, the word connecting", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    await renderShell(fake);
    expect(liveStoreFor(fake.bridge).getSnapshot().connection.state).toBe("connecting");
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: connecting");
    expect(statusRow().textContent).toBe("connecting");
    expect(dotState()).toBe("idle");
  });

  it("live and at rest: idle; a running session: working; paused or the kill switch engaged: paused", async () => {
    const fake = fakeBridge();
    let body: StatusBody = STATUS;
    fake.route("GET /status", () => ok(body));
    await renderShell(fake);
    await goLive(fake);
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: idle");
    expect(dotState()).toBe("idle");

    body = { ...STATUS, sessions: [SESSION] };
    act(() => liveStoreFor(fake.bridge).refetch("status"));
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: working");
    expect(dotState()).toBe("working");

    body = { ...STATUS, paused: true };
    act(() => liveStoreFor(fake.bridge).refetch("status"));
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: paused");
    expect(dotState()).toBe("paused");

    body = { ...STATUS, kill_switch: { engaged: true, since: "2026-10-22T09:00:00.000Z" } };
    act(() => liveStoreFor(fake.bridge).refetch("status"));
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: paused");
  });

  it("no api.json before the store was live: kernel unreachable with the danger dot", async () => {
    await renderShell(fakeBridge({ state: "unreachable", reason: "connection_failed" }));
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: kernel unreachable");
    expect(statusRow().textContent).toBe("kernel unreachable");
    expect(dotState()).toBe("failed");
    expect(statusRow().querySelector(".status-dot")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("live, then the feed closes (the store reads reconnecting): kernel unreachable with the danger dot, as the band says", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    await renderShell(fake);
    await goLive(fake);
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: idle");

    act(() => fake.emit({ type: "closed", code: 1006, reason: "" }));
    expect(liveStoreFor(fake.bridge).getSnapshot().connection.state).toBe("reconnecting");
    expect(statusRow().getAttribute("aria-label")).toBe("Kernel: kernel unreachable");
    expect(dotState()).toBe("failed");
    expect(screen.getAllByTestId("kernel-unreachable-band")).toHaveLength(1);
  });

  it("the word is derived only from the connection and GET /status", () => {
    expect(kernelWord({ state: "connecting" }, undefined)).toBe("connecting");
    expect(kernelWord({ state: "live" }, undefined)).toBe("connecting");
    expect(kernelWord({ state: "live" }, STATUS)).toBe("idle");
    expect(kernelWord({ state: "live" }, { ...STATUS, sessions: [SESSION] })).toBe("working");
    // Paused beats working: a kernel that holds new work is not "working".
    expect(kernelWord({ state: "live" }, { ...STATUS, paused: true, sessions: [SESSION] })).toBe("paused");
    expect(kernelWord({ state: "reconnecting", lastUpdated: 1 }, STATUS)).toBe("kernel unreachable");
    expect(kernelWord({ state: "unreachable", reason: "daemon_not_running" }, STATUS)).toBe("kernel unreachable");
    expect(kernelWord({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" }, undefined)).toBe("kernel unreachable");
  });
});

// WCAG 2.1 AA for the frame's text (AC6): each rule below really declares the token it is listed with (so a changed
// colour turns this red whatever its ratio), and the pair is at least 4.5:1 in the light and the dark theme, from
// `tokens.css`. The sidebar is translucent over the window's vibrancy, so its text is checked against the opaque
// `ground`, the lightest (light) and darkest (dark) thing it can sit on; no new colour is introduced.
describe("the frame's contrast", () => {
  // The token parsing and ratio of `styles/test-support.ts`, in brief: that module reads `tokens.css` through `new URL(..., import.meta.url)`,
  // which Node's `readFileSync` refuses under this file's jsdom environment (the DOM needs it), so the same few lines are repeated here.
  const TOKENS = readFileSync(join(import.meta.dirname, "../styles/tokens.css"), "utf8");
  const tokensOf = (marker: string): Map<string, string> => {
    const start = TOKENS.indexOf(marker);
    const body = TOKENS.slice(TOKENS.indexOf("{", start) + 1, TOKENS.indexOf("}", start));
    return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
  };
  const light = tokensOf(":root {");
  const dark = new Map([...light, ...tokensOf(':root[data-theme="dark"]')]);
  const hex = (theme: Map<string, string>, name: string): string => {
    let value = theme.get(name);
    while (value !== undefined && value.startsWith("var(")) value = theme.get(value.slice(6, -1));
    if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a 6-digit hex: ${String(value)}`);
    return value;
  };
  const luminance = (color: string): number => {
    const channel = (i: number): number => {
      const c = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  const APP_CSS = readFileSync(join(import.meta.dirname, "../styles/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const CHAT_CSS = readFileSync(join(import.meta.dirname, "../screens/chat/chat.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  /** The `color:` token the last rule for exactly `selector` declares in `css`. */
  function colorToken(css: string, selector: string): string | undefined {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, header]) => (header as string).split(",").some((h) => h.trim() === selector));
    const colors = rules.map(([, , body]) => /(?:^|[;\s])color:\s*var\(--([\w-]+)\)/.exec(body as string)?.[1]).filter((c) => c !== undefined);
    return colors.at(-1);
  }

  /** [stylesheet, selector, foreground token, background token, where it is used]. */
  const TEXT: readonly (readonly [string, string, string, string, string])[] = [
    [APP_CSS, ".nav-item", "ink-secondary", "ground", "an entry at rest"],
    [APP_CSS, ".nav-item:hover", "ink", "surface-sunken", "an entry under the pointer"],
    [APP_CSS, ".nav-item.selected", "accent", "accent-soft", "the current entry"],
    [APP_CSS, ".nav-key", "ink-tertiary", "ground", "an entry's shortcut"],
    [APP_CSS, ".nav-item.selected .nav-key", "accent", "accent-soft", "the current entry's shortcut"],
    [APP_CSS, ".sidebar-foot", "ink-tertiary", "ground", "the status word"],
    [APP_CSS, ".sidebar-kbd", "ink-tertiary", "surface-sunken", "the ⌘K hint"],
    [APP_CSS, ".titlebar-subtitle", "ink-tertiary", "ground", "the count line in the bar"],
    [CHAT_CSS, ".chat-crew-name", "ink", "ground", "a crew member's name"],
    [CHAT_CSS, ".chat-crew-last", "ink-tertiary", "ground", "a crew member's last line"],
    [CHAT_CSS, ".chat-crew-row.selected .chat-crew-last", "ink-secondary", "accent-soft", "the last line in the current thread's row"],
    [CHAT_CSS, ".chat-crew-row.selected .chat-crew-off", "ink-secondary", "accent-soft", "the word off in the current thread's row"],
    [CHAT_CSS, ".chat-crew-row.selected .chat-crew-id", "ink-secondary", "accent-soft", "the shared-name id in the current thread's row"],
  ];

  it.each(TEXT.map((row) => [row[1], row[4], ...row] as const))("%s (%s) declares its token and is at least 4.5:1 in both themes", (_selector, _what, css, selector, fg, bg) => {
    expect(colorToken(css, selector), `${selector} declares color: var(--${fg})`).toBe(fg);
    for (const theme of [light, dark]) expect(ratio(hex(theme, fg), hex(theme, bg)), `--${fg} on --${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("the frame's stylesheet takes every colour from a token", () => {
    for (const css of [APP_CSS]) expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
