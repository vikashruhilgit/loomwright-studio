The menu-bar icon: the app icon's Möbius ribbon redrawn as a macOS template image, 18pt, black with alpha. macOS recolours it for a light or dark bar and for the open-menu highlight, so a state is told by shape, strength and motion, never by colour. It is drawn in code by `app/electron/tray-glyph.ts` (no asset files); the preview here draws the same geometry as SVG.

| State | Glyph | Motion |
|---|---|---|
| idle | the ribbon at rest: six fine threads, a hairline edge | still |
| working | fourteen finer threads, each carrying a light shaped like a speed line: a round head tapering smoothly to a point | the lights run the threads, each at its own speed (one loop in 10–13 s) |
| waiting on you | the ribbon at full strength, the count beside it as the tray's title | breathes from faint to full every 2.2 s until you act |
| paused at cap / paused | the ribbon faded, two pause bars in its opening | still |
| killed | the ribbon faded, cut by a slash knocked out of it | still |

**Use:** only in the menu bar. Everywhere else in the app the kernel state is a StatusDot with its word. The tooltip carries the state word verbatim ("Loomwright Studio: waiting on you"), and the menu's first line repeats it with the count.

**Motion:** only working and waiting move, and nothing in the menu bar blinks, hops or bounces. Under reduce motion the glyph holds one still frame: working with its lights where they start, waiting at full strength.

**Don't:** colour it (a template image cannot carry colour, and macOS ignores it); add a badge or a second mark; thicken the threads to make it bolder (they are fine lines on purpose, like the icon's); show a state the kernel has not reported.
