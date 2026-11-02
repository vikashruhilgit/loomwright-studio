// @vitest-environment jsdom
// Settings' polish (phase 7 item 18) against a scripted bridge (`fake-bridge.ts`): the last `ok` view
// kept across a remount while the kernel is down, "last known" in the title bar's subtitle (and nowhere
// else), home paths as `~/…`, the account's words, the theme row's help text and the cache module. The
// rest of the screen is `SettingsScreen.test.tsx`; the built app is `e2e/settings.spec.ts`.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, StudioBridge } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { getLastView, resetLastViews, setLastView, subscribeLastView } from "./lastKnown";
import { SETTINGS_TEST_IDS as IDS, parseSettings } from "./model";
import type { SettingsView } from "./model";
import { SettingsScreen } from "./SettingsScreen";
import { STATUS, UNREACHABLE, mountSubtitle, settingsBody } from "./test-support";

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.restoreAllMocks();
});

const HOME = "/Users/owner";

interface Kernel {
  readonly fake: FakeBridge;
  answer: () => ApiResult<unknown>;
}

/** A scripted kernel whose `GET /settings` answers whatever `answer` returns now. `home` is the bridge's `homeDir` (`null`: the member is absent). */
function kernelOf(answer: () => ApiResult<unknown> = () => ok(settingsBody()), home: string | null = HOME): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = { fake, answer };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /settings", () => kernel.answer());
  if (home !== null) fake.bridge.homeDir = async () => home;
  return kernel;
}

const registry = createCommandRegistry();
const mountScreen = (api: StudioBridge) => render(<SettingsScreen api={api} registry={registry} />);
const text = (testId: string): string => screen.getByTestId(testId).textContent ?? "";
const subtitle = (): string => text("titlebar-subtitle");
const button = (testId: string): HTMLButtonElement => screen.getByTestId(testId) as HTMLButtonElement;
/** The feed opens and then closes: the shell's `reconnecting`, the band's state. */
async function feedLost(fake: FakeBridge): Promise<void> {
  await act(async () => undefined);
  act(() => fake.emit({ type: "heartbeat", latest_id: 0 }));
  act(() => fake.emit({ type: "closed", code: 1006, reason: "" }));
}

// ---- The last view across a remount -------------------------------------------------------------------------

describe("the last view across a remount", () => {
  it("going back to Settings while the kernel is down shows the last data, not 'Status unknown'", async () => {
    const kernel = kernelOf();
    const first = mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    expect(text(IDS.provider)).toBe("subscription-token");

    // The kernel goes away, and the owner leaves Settings and comes back: a new mount, the same window.
    kernel.answer = () => UNREACHABLE;
    first.unmount();
    mountScreen(kernel.fake.bridge);

    // The remount reads, the read answers status 0, and the rows are still the last read.
    await waitFor(() => expect(kernel.fake.requestsTo("GET /settings")).toHaveLength(2));
    await waitFor(() => expect(button(IDS.reveal).disabled).toBe(true));
    expect(text(IDS.provider)).toBe("subscription-token");
    // Offline, Health keeps its last word but carries its own "last known" mark (item 27).
    expect(text(IDS.health)).toBe("oklast known");
    expect(text(IDS.dataDir)).toContain("~/.loomwright-studio");
    expect(screen.queryByTestId(IDS.unknown)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.queryByTestId(IDS.notice)).toBeNull();
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
  });

  it("the remount shows the last data at once, before its own read lands", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    cleanup();
    kernel.answer = () => new Promise<ApiResult<unknown>>(() => undefined) as never;
    mountScreen(kernel.fake.bridge);
    expect(text(IDS.provider)).toBe("subscription-token");
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
  });

  it("a remount reads again, and the answer replaces the remembered view", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    cleanup();
    kernel.answer = () => ok(settingsBody({ dataDir: `${HOME}/moved` }));
    mountScreen(kernel.fake.bridge);
    await waitFor(() => expect(text(IDS.dataDir)).toContain("~/moved"));
    expect(kernel.fake.requestsTo("GET /settings")).toHaveLength(2);
    expect(getLastView(kernel.fake.bridge)?.dataDir).toBe(`${HOME}/moved`);
  });

  it("with no data ever read and the kernel unreachable it still says the status is unknown", async () => {
    const kernel = kernelOf(() => UNREACHABLE);
    mountScreen(kernel.fake.bridge);
    expect(await screen.findByTestId(IDS.unknown)).toBeTruthy();
    expect(screen.queryByTestId(IDS.auth)).toBeNull();
    expect(getLastView(kernel.fake.bridge)).toBeUndefined();
  });

  it("is kept per bridge: another window's screen starts empty", async () => {
    const one = kernelOf();
    mountScreen(one.fake.bridge);
    await screen.findByTestId(IDS.auth);
    cleanup();
    const other = kernelOf(() => UNREACHABLE);
    mountScreen(other.fake.bridge);
    expect(await screen.findByTestId(IDS.unknown)).toBeTruthy();
  });

  it("a refused or failed read never drops or replaces the remembered view", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    const held = getLastView(kernel.fake.bridge);
    cleanup();
    kernel.answer = () => ({ ok: false, status: 500, body: { error: "store_unreadable" } });
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.notice);
    expect(getLastView(kernel.fake.bridge)).toBe(held);
    expect(text(IDS.provider)).toBe("subscription-token");
  });
});

// ---- The Health row, marked last known while the kernel is unreachable (item 27) -------------------------------------

/** The Health row's dot and word tones, in document order (the dot, then the word). */
const healthTones = (): (string | null)[] => Array.from(screen.getByTestId(IDS.health).querySelectorAll("[data-tone]")).map((el) => el.getAttribute("data-tone"));

describe("Health marked last known", () => {
  it("offline with a held ok view: a neutral dot, a neutral word and the 'last known' mark", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    expect(healthTones()).toEqual(["ok", "ok"]);
    expect(screen.queryByTestId(IDS.healthLastKnown)).toBeNull();
    cleanup();
    kernel.answer = () => UNREACHABLE;
    mountScreen(kernel.fake.bridge);
    await waitFor(() => expect(button(IDS.reveal).disabled).toBe(true));
    expect(healthTones()).toEqual(["neutral", "neutral"]);
    expect(text(IDS.healthLastKnown)).toBe("last known");
    expect(text(IDS.health)).toBe("oklast known");
  });

  it("offline with a held expiring view: still neutral, and '18 days left' stays beside the mark", async () => {
    const kernel = kernelOf(() => ok(settingsBody({ health: { status: "expiring", days: 18 } })));
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    expect(healthTones()).toEqual(["attention", "attention"]);
    cleanup();
    kernel.answer = () => UNREACHABLE;
    mountScreen(kernel.fake.bridge);
    await waitFor(() => expect(button(IDS.reveal).disabled).toBe(true));
    expect(healthTones()).toEqual(["neutral", "neutral"]);
    expect(text(IDS.healthNote)).toBe("18 days left");
    expect(text(IDS.healthLastKnown)).toBe("last known");
    expect(text(IDS.health)).toBe("expiring18 days leftlast known");
  });

  it("an answer landing again brings the live tone back and removes the mark", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    cleanup();
    kernel.answer = () => UNREACHABLE;
    mountScreen(kernel.fake.bridge);
    await waitFor(() => expect(text(IDS.healthLastKnown)).toBe("last known"));
    kernel.answer = () => ok(settingsBody());
    // The screen reads again on a feed event of its own kinds; the feed's retry may take its backoff.
    await waitFor(
      () => {
        act(() => kernel.fake.emit({ type: "event", id: Date.now(), at: new Date().toISOString(), kind: "auth_health_changed", session_id: null, task_id: null, payload: {} }));
        expect(screen.queryByTestId(IDS.healthLastKnown)).toBeNull();
      },
      { timeout: 5000 },
    );
    expect(healthTones()).toEqual(["ok", "ok"]);
    expect(text(IDS.health)).toBe("ok");
    expect(button(IDS.reveal).disabled).toBe(false);
  });
});

// ---- The title bar's subtitle ----------------------------------------------------------------------------------------

describe("the title bar's subtitle", () => {
  it("is empty while the kernel is live", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    mountSubtitle(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    act(() => kernel.fake.emit({ type: "heartbeat", latest_id: 0 }));
    expect(subtitle()).toBe("");
  });

  it("reads 'last known' while the shell is offline and the screen holds a view, and clears when the feed is back", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    mountSubtitle(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    await feedLost(kernel.fake);
    await waitFor(() => expect(subtitle()).toBe("last known"));
    await waitFor(
      () => {
        act(() => kernel.fake.emit({ type: "heartbeat", latest_id: 0 }));
        expect(subtitle()).toBe("");
      },
      { timeout: 5000 },
    );
  });

  it("reads 'last known' on a remount while the kernel is down", async () => {
    const kernel = kernelOf();
    const first = mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    first.unmount();
    kernel.answer = () => UNREACHABLE;
    mountScreen(kernel.fake.bridge);
    mountSubtitle(kernel.fake.bridge);
    await feedLost(kernel.fake);
    await waitFor(() => expect(subtitle()).toBe("last known"));
  });

  it("is empty when the kernel is offline and no view was ever read", async () => {
    const kernel = kernelOf(() => UNREACHABLE);
    mountScreen(kernel.fake.bridge);
    mountSubtitle(kernel.fake.bridge);
    await screen.findByTestId(IDS.unknown);
    await feedLost(kernel.fake);
    await waitFor(() => expect(button(IDS.login).disabled).toBe(false));
    expect(subtitle()).toBe("");
  });

  it("follows a view that lands after it mounted", async () => {
    const kernel = kernelOf();
    mountSubtitle(kernel.fake.bridge);
    await feedLost(kernel.fake);
    expect(subtitle()).toBe("");
    act(() => setLastView(kernel.fake.bridge, parseSettings(settingsBody()) as SettingsView));
    expect(subtitle()).toBe("last known");
  });

  it("the section headings carry no 'last known' mark, offline or not", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.auth);
    expect(screen.queryAllByTestId(IDS.lastKnown)).toHaveLength(0);
    kernel.answer = () => UNREACHABLE;
    await feedLost(kernel.fake);
    await waitFor(() => expect(button(IDS.reveal).disabled).toBe(true));
    expect(screen.queryAllByTestId(IDS.lastKnown)).toHaveLength(0);
    // Offline, the one "last known" on the page is the Health row's own mark (item 27), not a heading's.
    expect(document.body.textContent?.split("last known").length).toBe(2);
    expect(text(IDS.health)).toContain("last known");
  });
});

// ---- Home paths -----------------------------------------------------------------------------------------------------------

describe("home paths", () => {
  it("a data location and a Loomwright install under the home folder read ~/…", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await waitFor(() => expect(text(IDS.dataDir)).toContain("~/.loomwright-studio"));
    expect(text(IDS.dataDir)).not.toContain(HOME);
    expect(text(IDS.loomwright)).toBe("~/.claude/plugins/loomwright");
  });

  it("a path outside the home folder reads in full, including one that only starts with the home's name", async () => {
    const kernel = kernelOf(() => ok(settingsBody({ dataDir: "/Volumes/data/studio", installPath: `${HOME}2/plugins/loomwright` })));
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.kernel);
    // Let the home folder answer; the paths must still be whole.
    await act(async () => undefined);
    expect(text(IDS.dataDir)).toContain("/Volumes/data/studio");
    expect(text(IDS.loomwright)).toBe(`${HOME}2/plugins/loomwright`);
  });

  it("a bridge with no homeDir member shows the paths in full", async () => {
    const kernel = kernelOf(undefined, null);
    expect(kernel.fake.bridge.homeDir).toBeUndefined();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.kernel);
    await act(async () => undefined);
    expect(text(IDS.dataDir)).toContain(`${HOME}/.loomwright-studio`);
    expect(text(IDS.loomwright)).toBe(`${HOME}/.claude/plugins/loomwright`);
  });

  it("the commands stay as they are: no path in them is shortened", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await screen.findByTestId(IDS.kernel);
    for (const command of screen.getAllByTestId(IDS.command)) expect(command.textContent).not.toContain("~");
  });
});

// ---- The account ------------------------------------------------------------------------------------------------------------

describe("the account", () => {
  it("reads 'personal subscription' when the kernel answers the provider's id", async () => {
    mountScreen(kernelOf(() => ok(settingsBody({ account: "subscription-token" }))).fake.bridge);
    await screen.findByTestId(IDS.auth);
    expect(text(IDS.account)).toBe("personal subscription");
    expect(text(IDS.provider)).toBe("subscription-token");
  });

  it("shows a recorded label, and 'none recorded' for another provider with none", async () => {
    mountScreen(kernelOf(() => ok(settingsBody({ account: "Vikash" }))).fake.bridge);
    await screen.findByTestId(IDS.auth);
    expect(text(IDS.account)).toBe("Vikash");
    cleanup();
    mountScreen(kernelOf(() => ok(settingsBody({ id: "api-key", account: null }))).fake.bridge);
    await screen.findByTestId(IDS.auth);
    expect(text(IDS.account)).toBe("none recorded");
  });
});

// ---- The theme row's help text ---------------------------------------------------------------------------------------------------

describe("the theme row's help text", () => {
  it("describes the pressed theme and changes when another is pressed", async () => {
    const kernel = kernelOf();
    mountScreen(kernel.fake.bridge);
    await waitFor(() => expect(button(IDS.login).disabled).toBe(false));
    const help = (): string => screen.getByText(/(follows|Always)/).textContent ?? "";
    expect(help()).toBe("System follows your Mac.");
    fireEvent.click(button(IDS.themeDark));
    await waitFor(() => expect(help()).toBe("Always dark, whatever your Mac uses."));
    fireEvent.click(button(IDS.themeLight));
    await waitFor(() => expect(help()).toBe("Always light, whatever your Mac uses."));
    fireEvent.click(button(IDS.themeSystem));
    await waitFor(() => expect(help()).toBe("System follows your Mac."));
  });

  it("says the System text before the preferences have answered", () => {
    const kernel = kernelOf();
    delete kernel.fake.bridge.prefs;
    mountScreen(kernel.fake.bridge);
    expect(screen.getByText("System follows your Mac.")).toBeTruthy();
  });
});

// ---- The cache module -------------------------------------------------------------------------------------------------------------

describe("the last-view store", () => {
  const view = parseSettings(settingsBody()) as SettingsView;

  it("remembers the last view set per bridge, and tells its watchers", () => {
    const one = fakeBridge().bridge;
    const two = fakeBridge().bridge;
    const seen = vi.fn();
    const stop = subscribeLastView(one, seen);
    expect(getLastView(one)).toBeUndefined();
    setLastView(one, view);
    expect(getLastView(one)).toBe(view);
    expect(getLastView(two)).toBeUndefined();
    expect(seen).toHaveBeenCalledTimes(1);
    setLastView(two, view);
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    setLastView(one, view);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("forgets everything on reset", () => {
    const bridge = fakeBridge().bridge;
    setLastView(bridge, view);
    resetLastViews();
    expect(getLastView(bridge)).toBeUndefined();
  });
});
