// The Keyboard map view (docs/design/mockups/gui-v2.html, `keymapScreen`): a Back control that returns to the
// screen it was opened from, "Go to a screen" (each sidebar screen with its shortcut, read from the screens the
// shell discovered), "Anywhere" (the keys that work on every screen) and "Palette commands by screen" (read
// from the command registry, so the table cannot drift from the commands). The shell draws the one `h1`.
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { groupCommands } from "../../components/CommandPalette/fuzzy";
import { Kbd } from "../../components/Badge/Badge";
import { Crumb } from "../../shell/Crumb";
import { useScreens } from "../../shell/ScreensContext";
import { openerHash, openerScreen } from "./opener";

/** The screen's test ids. */
export const KEYMAP_TEST_IDS = {
  screen: "screen-keymap",
  back: "keymap-back",
  screens: "keymap-screens",
  anywhere: "keymap-anywhere",
  commands: "keymap-commands",
} as const;

/** The title bar's count line, the mockup's `sub`. */
export function KeymapSubtitle() {
  return <>every shortcut and palette command</>;
}


/** The "Anywhere" rows: the keys that work on every screen. `⌘K` and `⌘⇧K` are `RESERVED_SHORTCUTS`. */
const ANYWHERE: readonly { readonly id: string; readonly keys: ReactNode; readonly does: string }[] = [
  {
    id: "palette",
    keys: (
      <>
        <Kbd>⌘K</Kbd> or <Kbd>/</Kbd>
      </>
    ),
    does: "Open the command palette",
  },
  { id: "keymap", keys: <Kbd>?</Kbd>, does: "Open this keyboard map" },
  {
    id: "move",
    keys: (
      <>
        <Kbd>J</Kbd> <Kbd>↓</Kbd> / <Kbd>K</Kbd> <Kbd>↑</Kbd>
      </>
    ),
    does: "Move to the next / previous card, row or file",
  },
  { id: "open", keys: <Kbd>⏎</Kbd>, does: "Open the card, row or file you are on; press a switch or button" },
  { id: "close", keys: <Kbd>Esc</Kbd>, does: "Close the palette or a dialog" },
  {
    id: "tab",
    keys: (
      <>
        <Kbd>Tab</Kbd> <Kbd>Shift+Tab</Kbd>
      </>
    ),
    does: "Move between controls; in a dialog or the palette focus stays inside it",
  },
  { id: "kill", keys: <Kbd>⌘⇧K</Kbd>, does: "Ask to engage the kill switch; nothing stops until you confirm" },
];

export interface KeymapScreenProps {
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
  /** Where Back goes (default: the hash of the screen the map was opened from). */
  readonly onBack?: () => void;
}

function goBack(): void {
  window.location.hash = openerHash();
}

export function KeymapScreen({ registry = commandRegistry, onBack = goBack }: KeymapScreenProps) {
  const screens = useScreens();
  const commands = useSyncExternalStore(registry.subscribe, registry.list);
  const groups = useMemo(() => groupCommands(commands, ""), [commands]);
  const rows = screens.filter((s) => s.nav !== undefined);
  // The crumb names where Back goes: the screen the map was opened from, the one the sidebar marks (`openerScreen`).
  const opener = openerScreen(screens);
  const parent = opener?.nav?.label ?? opener?.title ?? "Chat";

  // Opening the map puts focus on Back, as the mockup does; Esc from the palette returns it here.
  const back = useRef<HTMLButtonElement>(null);
  // `.content` is one scrolling element shared by every screen, so the map would open at the previous screen's
  // offset. Reset the nearest scrolling ancestor before paint, so the map's first frame is its top.
  const top = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (let el = top.current?.parentElement ?? null; el !== null; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === "auto" || overflowY === "scroll") {
        el.scrollTop = 0;
        return;
      }
    }
  }, []);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={top} className="keymap" data-testid={KEYMAP_TEST_IDS.screen}>
      <div className="keymap-pad">
        <Crumb ref={back} className="keymap-crumb" glyphClassName="keymap-glyph" parent={parent} current="Keyboard map" onBack={onBack} testId={KEYMAP_TEST_IDS.back} />
        <p className="keymap-text">
          The shortcuts use <Kbd>⌘</Kbd>. Focus returns to the control that opened a dialog or the palette, or to a stable row if that control is gone.
        </p>

        <section className="keymap-blk" aria-labelledby="keymap-h-screens">
          <h2 className="keymap-label" id="keymap-h-screens">
            Go to a screen
          </h2>
          <table className="keymap-tbl" data-testid={KEYMAP_TEST_IDS.screens}>
            <caption className="keymap-sr">Screen shortcuts</caption>
            <colgroup>
              <col className="keymap-c1" />
              <col className="keymap-c2" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Screen</th>
                <th scope="col">Shortcut</th>
                <th scope="col">By keyboard</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} data-screen={s.id}>
                  <td>{s.nav?.label}</td>
                  <td>{s.nav?.shortcut === undefined ? <span className="keymap-dim">none</span> : <Kbd>{s.nav.shortcut}</Kbd>}</td>
                  <td className="keymap-dim">{s.nav?.shortcut === undefined ? "palette only" : "shortcut, or the palette"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="keymap-blk" aria-labelledby="keymap-h-anywhere">
          <h2 className="keymap-label" id="keymap-h-anywhere">
            Anywhere
          </h2>
          <table className="keymap-tbl" data-testid={KEYMAP_TEST_IDS.anywhere}>
            <caption className="keymap-sr">Keys that work on every screen</caption>
            <colgroup>
              <col className="keymap-c1" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Keys</th>
                <th scope="col">What they do</th>
              </tr>
            </thead>
            <tbody>
              {ANYWHERE.map((row) => (
                <tr key={row.id} data-row={row.id}>
                  <td>{row.keys}</td>
                  <td>{row.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="keymap-blk" aria-labelledby="keymap-h-commands">
          <div className="keymap-sech">
            <h2 className="keymap-label" id="keymap-h-commands">
              Palette commands by screen
            </h2>
            <span className="keymap-cap">Open the palette, then type to filter.</span>
          </div>
          <table className="keymap-tbl" data-testid={KEYMAP_TEST_IDS.commands}>
            <caption className="keymap-sr">Palette commands</caption>
            <colgroup>
              <col className="keymap-c1" />
              <col />
              <col className="keymap-c2" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Screen</th>
                <th scope="col">Command</th>
                <th scope="col">Key</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((group) =>
                group.commands.map((command, index) => (
                  <tr key={command.id} data-command-id={command.id}>
                    <td>{index === 0 ? group.name : <span className="keymap-sr">{group.name}</span>}</td>
                    <td>{command.title}</td>
                    <td>{command.shortcut === undefined ? null : <Kbd>{command.shortcut}</Kbd>}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <p className="keymap-cap">A screen&rsquo;s own commands are listed while that screen is open.</p>
        </section>
      </div>
    </div>
  );
}
