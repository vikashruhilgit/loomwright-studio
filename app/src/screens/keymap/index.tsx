// The Keyboard map (phase 7 item 13): every shortcut and palette command, reached by `?`, by the palette's
// "Keyboard map" command (`shell/KeyboardHost.tsx`) or at `#/keymap`. It has no `nav`, so it is not a sidebar
// entry and not a `screens.*` command: the mockup's `keymap` view (`k:''`, `parent:'settings'`) is reached by
// route or palette only. This module's one export is the screen the shell discovers
// (`import.meta.glob("./screens/*/index.tsx")` in App.tsx).
import type { ScreenDefinition } from "../types";
import { KeymapScreen, KeymapSubtitle } from "./KeymapScreen";
import { installOpenerTracker } from "./opener";
import "./keymap.css";

installOpenerTracker();

export const screen: ScreenDefinition = {
  id: "keymap",
  title: "Keyboard map",
  Component: KeymapScreen,
  Subtitle: KeymapSubtitle,
};
