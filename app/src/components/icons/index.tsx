// The shared in-content icon set: the line icons of the GUI v2 mockup's `I` map
// (`docs/design/mockups/gui-v2.html`) that click-through views draw beside their text, each with
// the mockup's path data verbatim and drawn through `Glyph`. Decorative (`aria-hidden`), like
// `Glyph`: the text beside an icon names the thing. Like `Glyph`, the set carries no CSS of its
// own; the caller passes the class its screen styles (`budget-glyph`).
//
// Mockup key -> name here: back=back, chat=chat, pen=pencil, hist=history, mem=file, team=shared,
// list=task, term=session, book=run, clock=clock. Tasks, Playbooks and Memory adopt the set in
// their own items; the names and the `Icon` props are settled here so they do not reshape it.
import type { ReactNode } from "react";
import { Glyph } from "../Glyph";

export const ICON_NAMES = [
  "back",
  "chat",
  "pencil",
  "history",
  "file",
  "shared",
  "task",
  "session",
  "run",
  "clock",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  back: <path d="m15 18-6-6 6-6" />,
  chat: <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12Z" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  shared: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20a6 6 0 0 1 12 0M15 19a4.5 4.5 0 0 1 7 0" />
    </>
  ),
  task: <path d="M4 6h16M4 12h10M4 18h7" />,
  session: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 20h10M8 9l3 3-3 3M13 15h3" />
    </>
  ),
  run: <path d="M4 19.5V5a2 2 0 0 1 2-2h14v14H6.5a2.5 2.5 0 0 0 0 5H20" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

export function Icon({ name, className }: { readonly name: IconName; readonly className: string }) {
  return <Glyph className={className}>{PATHS[name]}</Glyph>;
}
