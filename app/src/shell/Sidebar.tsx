// The window's sidebar, from the approved mockup (docs/design/mockups/gui-v2.html): one glyph beside each
// entry, a divider after Integrations (`NAV_ORDER`'s `'|'`), a screen-owned group after the entries (Chat's Crew),
// and the bottom row: the kernel's state word with its dot, and the ⌘K hint. The shell owns the sidebar, so the
// glyph per screen is a map here, keyed by screen id; no screen folder changes for glyphs.
import type { ReactNode } from "react";
import type { StatusBody, StudioBridge } from "../api/contract";
import { Glyph } from "../components/Glyph";
import { StatusDot } from "../components/StatusDot/StatusDot";
import type { StatusState } from "../components/StatusDot/StatusDot";
import { openerScreenId } from "../screens/keymap/opener";
import type { ScreenDefinition } from "../screens/types";
import { useLiveStore } from "../store/react";
import type { LiveConnection } from "../store/store";
import { KEYMAP_SCREEN } from "./KeyboardHost";

/** The divider sits after this entry, as the mockup's `NAV_ORDER` has it (Chat … Integrations, then Tasks … Settings). */
export const NAV_GROUP_END = "integrations";

/** The mockup's glyph per screen (its `I.chat`, `I.team`, `I.list`, …): the paths inside a 24px line-icon frame. */
export const NAV_GLYPHS: Readonly<Record<string, ReactNode>> = {
  chat: <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12Z" />,
  team: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20a6 6 0 0 1 12 0M15 19a4.5 4.5 0 0 1 7 0" />
    </>
  ),
  approvals: <path d="M4 6h16M4 12h10M4 18h7" />,
  sessions: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 20h10M8 9l3 3-3 3M13 15h3" />
    </>
  ),
  integrations: <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />,
  tasks: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="10" rx="1" />
      <rect x="17" y="4" width="4" height="6" rx="1" />
    </>
  ),
  playbooks: <path d="M4 19.5V5a2 2 0 0 1 2-2h14v14H6.5a2.5 2.5 0 0 0 0 5H20" />,
  schedules: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  memory: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  budget: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 18 4-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
};

/** What the status row says, derived only from the connection and `GET /status`. */
export type KernelWord = "idle" | "working" | "paused" | "connecting" | "kernel unreachable";

/**
 * The state word. A kernel that does not answer (`reconnecting`, `unreachable`) or is not installed reads
 * "kernel unreachable", the same as the shell's band; before the store is live it is "connecting". Live: "paused"
 * while new work is paused or the kill switch is engaged, "working" while a session is starting or running (the
 * kernel's `GET /status` lists only those), else "idle".
 */
export function kernelWord(connection: LiveConnection, status: StatusBody | undefined): KernelWord {
  switch (connection.state) {
    case "reconnecting":
    case "unreachable":
    case "not_installed":
      return "kernel unreachable";
    case "live":
      if (status === undefined) return "connecting";
      if (status.paused === true || status.kill_switch.engaged) return "paused";
      return status.sessions.length > 0 ? "working" : "idle";
    default:
      return "connecting";
  }
}

/** The shared StatusDot's state for each word: the danger dot is its `failed`, and a connecting kernel shows the idle ring. */
const DOT_STATE: Readonly<Record<KernelWord, StatusState>> = {
  idle: "idle",
  working: "working",
  paused: "paused",
  connecting: "idle",
  "kernel unreachable": "failed",
};

export interface SidebarProps {
  readonly api: StudioBridge;
  /** Every screen, in sidebar order. */
  readonly screens: readonly ScreenDefinition[];
  /** The screen on show. */
  readonly currentId: string;
  readonly onGo: (id: string) => void;
}

export function Sidebar({ api, screens, currentId, onGo }: SidebarProps) {
  const { connection, status } = useLiveStore(api);
  const word = kernelWord(connection, status);
  const entries = screens.filter((s) => s.nav !== undefined);
  const dividerAfter = entries.findIndex((s) => s.id === NAV_GROUP_END);
  // The Keyboard map has no entry of its own: while it is open the entry of the screen it was opened from is marked,
  // as the mockup's `navHTML` marks the map's parent. Everywhere else the marked entry is `currentId`.
  const markedId = currentId === KEYMAP_SCREEN ? openerScreenId() : currentId;
  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-titlebar" />
      <nav className="nav" aria-label="Screens">
        {entries.map((s, index) => (
          <NavEntry key={s.id} screen={s} selected={s.id === markedId} divider={index === dividerAfter && index < entries.length - 1} onGo={onGo} />
        ))}
      </nav>
      {screens.map((s) => (s.SidebarSection === undefined ? null : <s.SidebarSection key={s.id} />))}
      <div className="sidebar-foot">
        <div className="sidebar-status" role="status" aria-label={`Kernel: ${word}`}>
          <StatusDot state={DOT_STATE[word]} label={word} />
        </div>
        <kbd className="sidebar-kbd" role="img" aria-label="Command palette">
          ⌘K
        </kbd>
      </div>
    </aside>
  );
}

function NavEntry({ screen, selected, divider, onGo }: { readonly screen: ScreenDefinition; readonly selected: boolean; readonly divider: boolean; readonly onGo: (id: string) => void }) {
  const glyph = NAV_GLYPHS[screen.id];
  const nav = screen.nav as NonNullable<ScreenDefinition["nav"]>;
  return (
    <>
      <button
        type="button"
        className={selected ? "nav-item selected" : "nav-item"}
        aria-current={selected ? "page" : undefined}
        onClick={() => onGo(screen.id)}
      >
        {glyph === undefined ? null : <Glyph className="nav-glyph">{glyph}</Glyph>}
        <span className="nav-text">{nav.label}</span>
        {/* A hint for the eye: the entry's accessible name is its label alone (the glyph and the key are aria-hidden). */}
        {nav.shortcut === undefined ? null : (
          <span className="nav-key" aria-hidden="true">
            {nav.shortcut}
          </span>
        )}
      </button>
      {divider ? <hr className="nav-divider" /> : null}
    </>
  );
}
