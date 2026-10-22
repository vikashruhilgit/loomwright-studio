// The window's shell: the approved layout (DESIGN.md "What the mockups commit
// phase 5 to"): a `--sidebar-width` vibrancy sidebar, a `--titlebar-height`
// title bar, and the main column, routing to one screen per item. Screens are
// discovered from `src/screens/<id>/index.tsx`, so no item edits this file.
import { useEffect, useMemo, useState } from "react";
import type { StudioBridge } from "./api/contract";
import { getBridge } from "./api/bridge";
import { commandRegistry } from "./commands/registry";
import type { CommandRegistry } from "./commands/registry";
import type { ScreenDefinition, ScreenModule } from "./screens/types";
import { NotInstalledState, ReconnectingBand, UnreachableBand } from "./shell/KernelStates";
import { useKernelConnection } from "./store/connection";

const modules = import.meta.glob<ScreenModule>("./screens/*/index.tsx", { eager: true });

/** Every screen, its sidebar entries in `nav.order`. */
export const SCREENS: readonly ScreenDefinition[] = Object.values(modules)
  .map((m) => m.screen)
  .sort((a, b) => (a.nav?.order ?? Number.MAX_SAFE_INTEGER) - (b.nav?.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));

export const DEFAULT_SCREEN = "chat";

/** The screen a `#/<id>` hash names, or the default. */
export function screenForHash(hash: string): ScreenDefinition {
  const id = /^#\/([a-z][a-z0-9-]*)/.exec(hash)?.[1];
  return SCREENS.find((s) => s.id === id) ?? (SCREENS.find((s) => s.id === DEFAULT_SCREEN) as ScreenDefinition);
}

function useHashScreen(): ScreenDefinition {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return screenForHash(hash);
}

function go(id: string): void {
  window.location.hash = `#/${id}`;
}

/** Each screen's sidebar entry is also a palette command (the "Screens" group). */
function useScreenCommands(registry: CommandRegistry): void {
  useEffect(
    () =>
      registry.register(
        "shell",
        SCREENS.filter((s) => s.nav !== undefined).map((s) => ({
          id: `screens.${s.id}`,
          title: s.title,
          group: "Screens",
          ...(s.nav?.shortcut === undefined ? {} : { shortcut: s.nav.shortcut }),
          run: () => go(s.id),
        })),
      ),
    [registry],
  );
}

export interface AppProps {
  /** Defaults to `window.api`. */
  readonly api?: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

export function App({ api, registry = commandRegistry }: AppProps) {
  const bridge = useMemo(() => api ?? getBridge(), [api]);
  const connection = useKernelConnection(bridge);
  const current = useHashScreen();
  useScreenCommands(registry);
  const Screen = current.Component;

  return (
    <div className="window">
      <aside className="sidebar" data-testid="sidebar">
        <div className="sidebar-titlebar" />
        <nav className="nav" aria-label="Screens">
          {SCREENS.filter((s) => s.nav !== undefined).map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === current.id ? "nav-item selected" : "nav-item"}
              aria-current={s.id === current.id ? "page" : undefined}
              onClick={() => go(s.id)}
            >
              <span className="nav-text">{s.nav?.label}</span>
              {s.nav?.shortcut === undefined ? null : <span className="nav-key">{s.nav.shortcut}</span>}
            </button>
          ))}
        </nav>
        {SCREENS.map((s) => (s.SidebarSection === undefined ? null : <s.SidebarSection key={s.id} />))}
      </aside>
      <main className="main">
        <header className="titlebar">
          <h1 className="titlebar-title">{current.title}</h1>
        </header>
        <div className="content">
          {connection.state === "unreachable" ? <UnreachableBand /> : null}
          {connection.state === "reconnecting" ? <ReconnectingBand lastUpdated={connection.lastUpdated} /> : null}
          {connection.state === "not_installed" ? <NotInstalledState dataDir={connection.dataDir} /> : <Screen />}
        </div>
      </main>
    </div>
  );
}
