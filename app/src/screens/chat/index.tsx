// Chat (phase 5 item 13): Wright's thread at `#/chat` and one thread per
// specialist at `#/chat/<agent-id>` (`GET /threads/:agent`, live through the
// store), and the sidebar's Crew group, which also registers Chat's ⌘K
// commands. The pieces live beside this file: `Thread.tsx`, `cards.tsx`,
// `ChatComposer.tsx`, `CrewSection.tsx`, `commands.ts` and `model.ts`.
import type { ScreenDefinition } from "../types";
import { CrewSection } from "./CrewSection";
import { ChatScreen } from "./Thread";

export const screen: ScreenDefinition = {
  id: "chat",
  title: "Chat",
  nav: { label: "Chat", order: 1, shortcut: "⌘1" },
  Component: ChatScreen,
  SidebarSection: CrewSection,
};
