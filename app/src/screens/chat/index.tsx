// Chat: a placeholder. Phase 5 item 13 builds it (Wright's thread and each
// crew member's, against `GET /threads/:agent`), and the Crew group's list.
import type { ScreenDefinition } from "../types";

function ChatScreen() {
  return (
    <div className="placeholder" data-testid="screen-chat">
      <p className="placeholder-title">Chat</p>
      <p className="placeholder-note">Your thread with Wright arrives here.</p>
    </div>
  );
}

/** The sidebar's Crew group: direct threads with each specialist. Placeholder until item 13. */
function CrewSection() {
  return (
    <section className="nav-group" aria-labelledby="nav-crew">
      <h2 className="nav-label" id="nav-crew" title="Direct threads with each specialist">
        Crew
      </h2>
      <p className="nav-empty">No specialists yet. Wright proposes one when a duty needs it.</p>
    </section>
  );
}

export const screen: ScreenDefinition = {
  id: "chat",
  title: "Chat",
  nav: { label: "Chat", order: 1, shortcut: "⌘1" },
  Component: ChatScreen,
  SidebarSection: CrewSection,
};
