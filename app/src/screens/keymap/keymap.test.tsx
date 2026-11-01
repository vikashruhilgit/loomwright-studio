// @vitest-environment jsdom
// The Keyboard map screen (phase 7 item 13): the three tables of the mockup's `keymap` view, read from the
// screens the shell discovered and from the command registry so they cannot drift from the keys, and a Back
// control that returns to the screen the map was opened from.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCREENS } from "../../App";
import { RESERVED_SHORTCUTS } from "../../commands/keyboard";
import { createCommandRegistry } from "../../commands/registry";
import { ScreensContext } from "../../shell/ScreensContext";
import { Sidebar } from "../../shell/Sidebar";
import { fakeBridge } from "../../store/fake-bridge";
import { screen as keymapScreen } from "./index";
import { KEYMAP_TEST_IDS, KeymapScreen, KeymapSubtitle } from "./KeymapScreen";
import { FALLBACK_HASH, installOpenerTracker, openerHash, openerScreenId } from "./opener";

let stop: (() => void) | undefined;

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  stop?.();
  stop = undefined;
  window.location.hash = "";
});

function renderMap(props: Parameters<typeof KeymapScreen>[0] = {}, registry = createCommandRegistry()) {
  render(
    <ScreensContext.Provider value={SCREENS}>
      <KeymapScreen registry={registry} {...props} />
    </ScreensContext.Provider>,
  );
  return registry;
}

const cells = (table: HTMLElement): string[][] =>
  [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((td) => td.textContent ?? ""));

describe("the screen definition", () => {
  it("is #/keymap titled Keyboard map, with no sidebar entry (so no screens.* command)", () => {
    expect(keymapScreen.id).toBe("keymap");
    expect(keymapScreen.title).toBe("Keyboard map");
    expect(keymapScreen.nav).toBeUndefined();
    expect(SCREENS.some((s) => s.id === "keymap")).toBe(true);
  });

  it("says what it lists in the title bar's count line", () => {
    render(<KeymapSubtitle />);
    expect(document.body.textContent).toBe("every shortcut and palette command");
  });
});

describe("Go to a screen", () => {
  it("lists each sidebar screen with its shortcut, or none / palette only, read from the shell's screens", () => {
    renderMap();
    const rows = cells(screen.getByTestId(KEYMAP_TEST_IDS.screens));
    const expected = SCREENS.filter((s) => s.nav !== undefined).map((s) => [
      s.nav?.label,
      s.nav?.shortcut ?? "none",
      s.nav?.shortcut === undefined ? "palette only" : "shortcut, or the palette",
    ]);
    expect(rows).toEqual(expected);
    // The mockup's own rows: Chat ⌘1 … Memory ⌘9, Budget & audit with no key, Settings ⌘,.
    expect(rows[0]).toEqual(["Chat", "⌘1", "shortcut, or the palette"]);
    expect(rows.find((r) => r[0] === "Budget & audit")).toEqual(["Budget & audit", "none", "palette only"]);
    expect(rows.at(-1)?.slice(0, 2)).toEqual(["Settings", "⌘,"]);
    expect(rows.some((r) => r[0] === "Keyboard map")).toBe(false);
  });

  it("follows the screens it is given", () => {
    const only = SCREENS.filter((s) => s.id === "tasks");
    render(
      <ScreensContext.Provider value={only}>
        <KeymapScreen registry={createCommandRegistry()} />
      </ScreensContext.Provider>,
    );
    expect(cells(screen.getByTestId(KEYMAP_TEST_IDS.screens))).toEqual([["Tasks", "⌘6", "shortcut, or the palette"]]);
  });
});

describe("Anywhere", () => {
  it("names ⌘K or /, ?, J K, Enter, Esc, Tab and every reserved chord", () => {
    renderMap();
    const table = screen.getByTestId(KEYMAP_TEST_IDS.anywhere);
    const text = table.textContent ?? "";
    for (const chord of RESERVED_SHORTCUTS) expect(text, `the reserved chord ${chord}`).toContain(chord);
    expect(cells(table).map((r) => r[1])).toEqual([
      "Open the command palette",
      "Open this keyboard map",
      "Move to the next / previous card, row or file",
      "Open the card, row or file you are on; press a switch or button",
      "Close the palette or a dialog",
      "Move between controls; in a dialog or the palette focus stays inside it",
      "Ask to engage the kill switch; nothing stops until you confirm",
    ]);
    expect([...table.querySelectorAll("kbd")].map((k) => k.textContent)).toContain("/");
  });
});

describe("Palette commands by screen", () => {
  it("lists what the registry holds, grouped, with each shortcut, and follows a later registration", () => {
    const registry = createCommandRegistry();
    registry.register("shell", [
      { id: "screens.tasks", title: "Tasks", group: "Screens", shortcut: "⌘6", run: () => undefined },
      { id: "shell.keymap", title: "Keyboard map", group: "Help", shortcut: "?", run: () => undefined },
    ]);
    renderMap({}, registry);
    const table = screen.getByTestId(KEYMAP_TEST_IDS.commands);
    expect(cells(table)).toEqual([
      ["Screens", "Tasks", "⌘6"],
      ["Help", "Keyboard map", "?"],
    ]);
    act(() => {
      registry.register("budget", [{ id: "budget.open-audit", title: "Open the audit log", group: "Budget & audit", run: () => undefined }]);
    });
    expect(cells(table).at(-1)).toEqual(["Budget & audit", "Open the audit log", ""]);
  });

  it("a group's later rows name their group for a screen reader, without repeating it on screen", () => {
    const registry = createCommandRegistry();
    registry.register("a", [
      { id: "a.1", title: "One", group: "Actions", run: () => undefined },
      { id: "a.2", title: "Two", group: "Actions", run: () => undefined },
    ]);
    renderMap({}, registry);
    const second = screen.getByTestId(KEYMAP_TEST_IDS.commands).querySelectorAll("tbody tr")[1] as HTMLElement;
    expect(second.querySelector("td .keymap-sr")?.textContent).toBe("Actions");
  });
});

describe("Back", () => {
  it("takes focus when the map opens", () => {
    renderMap();
    expect(document.activeElement).toBe(screen.getByTestId(KEYMAP_TEST_IDS.back));
  });

  it("opens at the top: the scrolling element above it (the shell's .content) is reset to scrollTop 0", () => {
    const content = document.createElement("div");
    // `overflow-y`, since jsdom does not expand the `overflow` shorthand into the computed `overflowY`.
    content.style.overflowY = "auto";
    content.scrollTop = 240;
    expect(content.scrollTop, "the stand-in scrolls").toBe(240);
    document.body.append(content);
    render(
      <ScreensContext.Provider value={SCREENS}>
        <KeymapScreen registry={createCommandRegistry()} />
      </ScreensContext.Provider>,
      { container: content.appendChild(document.createElement("div")) },
    );
    expect(content.scrollTop).toBe(0);
    content.remove();
  });

  it("returns to the screen the map was opened from, whichever screen that was", () => {
    window.location.hash = "#/tasks";
    stop = installOpenerTracker();
    window.location.hash = "#/keymap";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    renderMap();
    fireEvent.click(screen.getByTestId(KEYMAP_TEST_IDS.back));
    expect(window.location.hash).toBe("#/tasks");
  });

  it("calls onBack when given one", () => {
    const onBack = vi.fn();
    renderMap({ onBack });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("the opener tracker", () => {
  it("remembers the last hash that was not the map's own", () => {
    window.location.hash = "#/memory";
    stop = installOpenerTracker();
    expect(openerHash()).toBe("#/memory");
    window.location.hash = "#/keymap";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(openerHash()).toBe("#/memory");
    window.location.hash = "#/playbooks";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(openerHash()).toBe("#/playbooks");
  });

  it("counts the default screen (no hash) as an opener", () => {
    window.location.hash = "";
    stop = installOpenerTracker();
    expect(openerHash()).toBe("");
  });

  it("falls back to Settings when the window opened on the map itself", () => {
    window.location.hash = "#/keymap";
    stop = installOpenerTracker();
    expect(openerHash()).toBe(FALLBACK_HASH);
  });

  it("stops listening when stopped", () => {
    window.location.hash = "#/team";
    const off = installOpenerTracker();
    off();
    window.location.hash = "#/sessions";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(openerHash()).toBe("#/team");
    stop = installOpenerTracker();
  });
});

describe("the screen the map was opened from (openerScreenId)", () => {
  it("reads the opener's hash as a screen id; no hash is the default screen, Chat", () => {
    window.location.hash = "";
    stop = installOpenerTracker();
    expect(openerScreenId()).toBe("chat");
    window.location.hash = "#/memory";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(openerScreenId()).toBe("memory");
    window.location.hash = "#/budget?x=1";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(openerScreenId()).toBe("budget");
  });

  it("is Settings when the window opened on the map itself (a deep link)", () => {
    window.location.hash = "#/keymap";
    stop = installOpenerTracker();
    expect(openerScreenId()).toBe("settings");
  });
});

describe("the sidebar while the map is open", () => {
  const marked = async (currentId: string): Promise<string[]> => {
    const fake = fakeBridge();
    render(<Sidebar api={fake.bridge} screens={SCREENS} currentId={currentId} onGo={() => undefined} />);
    await act(async () => undefined);
    const nav = screen.getByRole("navigation", { name: "Screens" });
    const current = [...nav.querySelectorAll('[aria-current="page"]')].map((b) => b.querySelector(".nav-text")?.textContent ?? "");
    const selected = [...nav.querySelectorAll(".nav-item.selected")].map((b) => b.querySelector(".nav-text")?.textContent ?? "");
    expect(selected, "the selected class and aria-current mark the same entry").toEqual(current);
    return current;
  };

  it("marks the entry of the screen it was opened from, whichever that was", async () => {
    window.location.hash = "#/settings";
    stop = installOpenerTracker();
    window.location.hash = "#/tasks";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.location.hash = "#/settings";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.location.hash = "#/keymap";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await marked("keymap")).toEqual(["Settings"]);
    cleanup();
    window.location.hash = "#/tasks";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.location.hash = "#/keymap";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await marked("keymap")).toEqual(["Tasks"]);
  });

  it("marks Settings for a deep link onto the map, and Chat when the map was opened from the default screen", async () => {
    window.location.hash = "#/keymap";
    stop = installOpenerTracker();
    expect(await marked("keymap")).toEqual(["Settings"]);
    cleanup();
    stop?.();
    window.location.hash = "";
    stop = installOpenerTracker();
    expect(await marked("keymap")).toEqual(["Chat"]);
  });

  it("outside the map the marked entry is still exactly the current screen", async () => {
    window.location.hash = "#/settings";
    stop = installOpenerTracker();
    expect(await marked("tasks")).toEqual(["Tasks"]);
  });
});
