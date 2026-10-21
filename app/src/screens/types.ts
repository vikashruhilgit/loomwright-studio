// What a screen module exports. The shell discovers every
// `src/screens/<id>/index.tsx` on its own (`import.meta.glob` in App.tsx), so
// a screen item edits only its own directory, never a shared list.
import type { ComponentType } from "react";

export interface ScreenDefinition {
  /** The route: `#/<id>`. Matches the directory name. */
  readonly id: string;
  /** The title bar's text. */
  readonly title: string;
  /** A sidebar entry, in `order`; a screen without one is reached only by route (a deep link, the palette). */
  readonly nav?: { readonly label: string; readonly order: number; readonly shortcut?: string };
  readonly Component: ComponentType;
  /** A sidebar group the screen owns, shown after the entries (Chat's Crew group). */
  readonly SidebarSection?: ComponentType;
}

/** A screen module: `export const screen: ScreenDefinition`. */
export interface ScreenModule {
  readonly screen: ScreenDefinition;
}
