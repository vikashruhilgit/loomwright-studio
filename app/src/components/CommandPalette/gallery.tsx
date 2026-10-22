// The palette's e2e gallery (gallery.html): a `CommandPaletteHost` over a
// fixture registry carrying every state the README and preview.html show —
// every group in order, kbd chips, linked ids (`#412`, `LW-104`), a disabled
// action, and a Tasks group past eight rows (Show all). The spec drives it by
// keyboard. The kill switch is a test double rendering a `role="alertdialog"`
// (item 17 wires item 08's Dialog and `POST /stop-all`).
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../styles/tokens.css";
import "../../styles/app.css";
import type { KillSwitch } from "../../commands/keyboard";
import { createCommandRegistry } from "../../commands/registry";
import type { Command, CommandRegistry, RegisteredCommand } from "../../commands/registry";
import { CommandPaletteHost } from "./CommandPalette";

const theme = new URLSearchParams(window.location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

function fixtureRegistry(ran: (id: string) => void): CommandRegistry {
  const registry = createCommandRegistry();
  const cmd = (id: string, title: string, group: string, extra: Partial<Command> = {}): Command => ({ id, title, group, run: () => ran(id), ...extra });
  // Registered out of group order on purpose: the palette orders them.
  registry.register("sessions", [cmd("sessions.mason-412", "Mason · review PR #412", "Sessions", { keywords: ["#412"] })]);
  registry.register("shell", [
    cmd("screens.chat", "Chat", "Screens", { shortcut: "⌘1" }),
    cmd("screens.team", "Team", "Screens", { shortcut: "⌘2" }),
    cmd("screens.approvals", "Approvals", "Screens", { shortcut: "⌘3" }),
    cmd("screens.sessions", "Sessions", "Screens", { shortcut: "⌘4" }),
  ]);
  registry.register("approvals", [
    cmd("approvals.review-412", "Review approval: Mason · post review on #412", "Actions", { keywords: ["#412"] }),
    cmd("duties.new", "New duty: review PRs…", "Actions", { shortcut: "⌘N" }),
    cmd("sessions.retry", "Retry failed session", "Actions", { enabled: () => false }),
  ]);
  registry.register("team", [cmd("agents.mason", "Mason", "Agents"), cmd("agents.wright", "Wright", "Agents")]);
  registry.register("playbooks", [
    cmd("playbooks.review-prs", "Review PRs where I'm requested", "Playbooks"),
    cmd("playbooks.triage", "Triage review comments", "Playbooks"),
  ]);
  registry.register(
    "tasks",
    Array.from({ length: 11 }, (_, i) => cmd(`tasks.lw-${101 + i}`, `Task LW-${101 + i}: follow up on review ${i + 1}`, "Tasks", { keywords: [`LW-${101 + i}`] })),
  );
  return registry;
}

function Gallery() {
  const [lastRun, setLastRun] = useState("nothing yet");
  const [inspected, setInspected] = useState("nothing yet");
  const [engaged, setEngaged] = useState(0);
  const [pending, setPending] = useState(false);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const registry = useMemo(() => fixtureRegistry(setLastRun), []);

  const killSwitch = useMemo<KillSwitch>(
    () => ({
      confirm: () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setPending(true);
        }),
      engage: () => setEngaged((n) => n + 1),
    }),
    [],
  );
  const answer = (confirmed: boolean): void => {
    setPending(false);
    resolver.current?.(confirmed);
    resolver.current = null;
  };

  return (
    <main className="gallery">
      <h1>CommandPalette gallery</h1>
      <p>Press ⌘K to open the palette, ⌘⇧K for the kill switch.</p>
      <button type="button">Opener</button>
      <output data-testid="last-run">Last run: {lastRun}</output>
      <output data-testid="inspected">Inspected: {inspected}</output>
      <output data-testid="engaged">Engaged: {engaged}</output>
      <CommandPaletteHost registry={registry} killSwitch={killSwitch} onOpenInInspector={(c: RegisteredCommand) => setInspected(c.id)} />
      {pending ? (
        <div className="gallery-confirm">
          <div role="alertdialog" aria-modal="true" aria-label="Stop every session?">
            <strong>Stop every session?</strong>
            <button type="button" onClick={() => answer(true)}>
              Stop everything
            </button>
            <button type="button" onClick={() => answer(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("gallery.html has no #root");
createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
