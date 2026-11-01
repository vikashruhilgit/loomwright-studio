// The window's title bar: the screen's title (the shell draws the only h1) and, beside it, the count line the
// screen declares as `ScreenDefinition.Subtitle` (the mockup's `<h1>` then `<span class="cap">`). A screen that
// declares none gets the title alone, with no empty subtitle element.
import type { ScreenDefinition } from "../screens/types";

export function Titlebar({ screen }: { readonly screen: ScreenDefinition }) {
  const Subtitle = screen.Subtitle;
  return (
    <header className="titlebar">
      <h1 className="titlebar-title">{screen.title}</h1>
      {Subtitle === undefined ? null : (
        <span className="titlebar-subtitle" data-testid="titlebar-subtitle">
          <Subtitle />
        </span>
      )}
    </header>
  );
}
