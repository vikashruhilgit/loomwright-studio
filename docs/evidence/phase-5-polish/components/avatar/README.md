# Avatar: phase 5 polish evidence

The stitched sea-creature avatar (D23), ported to `app/src/components/Avatar/` from the approved design: [avatar.css](../../../../design/avatar/avatar.css), [avatar.js](../../../../design/avatar/avatar.js), the component's [README](../../../../design/design-system/components/Avatar/README.md) and [preview.html](../../../../design/design-system/components/Avatar/preview.html). The design was not changed. Where the sources disagree, the README wins, and every disagreement is listed under owner findings below.

## Screenshots

[`app/e2e/components.avatar.spec.ts`](../../../../../app/e2e/components.avatar.spec.ts) writes these when `npm run e2e` runs. It renders the component with the real `tokens.css` and `Avatar.css` in Electron, and emulates `prefers-reduced-motion: reduce` so every capture is still. It sets the theme through `data-theme` on `<html>`. Retina captures are 2x.

| Screenshot | What it shows | `preview.html` row it matches |
|---|---|---|
| [states-light.png](states-light.png) | Wright and Mason (shark, teal) in all 6 states at 56px: idle, working, waiting on you, paused at cap, done, killed | `#states` (Wright × 6 states, then Mason × 6 states, 56px) |
| [states-dark.png](states-dark.png) | The same, dark theme | `#states` |
| [creatures-light.png](creatures-light.png) | The 7 crew creatures (shark, seahorse, octopus, turtle, jellyfish, fish, crab), idle, 44px, with hues in the design's order (teal, berry, sky, olive, slate, then teal and berry again) | `#shapes` (`SHAPE_ORDER` × `CREW_HUES[i % 5]`, idle, 44px) |
| [creatures-dark.png](creatures-dark.png) | The same, dark theme | `#shapes` |
| [sizes-light.png](sizes-light.png) | Mason working at 16, 18, 24, 36 and 56px, plus a 12px request that renders at the 16px floor | `#sizes` (Mason working at 16/18/24/36). 56 is added because the README lists it as the showcase size |
| [sizes-dark.png](sizes-dark.png) | The same, dark theme | `#sizes` |

The whale only ever appears as Wright, so it is shown in the states row and not in the creatures row, which matches `preview.html`.

The spec also asserts what the pictures show. Under reduced motion no drift, rig, tail, ring or stitch layer has an animation. Each state shows exactly its thread path(s). In both themes, Wright's knot and crown resolve to that theme's `--accent` and Mason's knot to `--crew-teal`, and the light and dark accents differ.

## Motion

The gestures are the CSS keyframes ported from `avatar.css`: `run`, `swirl`, `sway`, `lean`, `flutter`, `hop`, `beckon`, `nod`, `ring`, `sink`, `tip`, `orbit` and `spin`. No JS-driven gesture exists, so no animation library is used, not even `@react-spring/web`. Under `prefers-reduced-motion: reduce` every avatar animation stops (drift, rig, tail, ring and the `.st`/`.ln`/`.stitch` running stitches), including the hover nod. The thread's shape alone then carries the state. `Avatar.test.tsx` pins that block textually, because jsdom applies no CSS.

## Contrast

The avatar's strokes and fills are non-text graphics painted only with `var(--bot)`. That resolves to `--accent` for Wright and to a `--crew-*` token for everyone else. In [tokens.json](../../../../design/tokens.json), every `crew-*` usage note rates the hue "3:1+ on ground and surface in both themes", and `accent` is rated "6.4:1 on surface in both themes". The avatar adds no colour of its own, so it inherits that contrast from the tokens. `Avatar.test.tsx` fails on any hex, `rgb()` or `hsl()` literal in `Avatar.tsx`, `Avatar.css` or `creatures.ts`. It also fails if an identity part (`.fill`, `.st`, `.ln`, `.knot`, `.stitch`, `.t`, `.crown`) is painted with a semantic token. The only state colour is the waiting ring's `--attention`.

## Owner findings (the design is ported as is; these need a decision)

1. **Hover nod vs reduced motion.** In `avatar.css`, `.bot:hover .rig{animation:nod …!important}` (specificity 0,3,0) out-specifies the reduced-motion `.bot .rig{animation:none!important}` (0,2,0). So in the design, hovering plays the nod even with motion reduced. The component adds `.bot:hover .rig{animation:none!important}` inside its reduced-motion block. The source CSS still has the gap.
2. **The running stitches ignore reduced motion in the source.** The README says "every animation stops", but the source's reduced-motion block leaves the `run` animation on `.st`, `.ln` and `.stitch` running for `working`. The component stops them too.
3. **`idle` and `working` share the `t-idle` thread.** With motion off, the thread shape alone can't tell them apart: `working` differs only by its running stitches, which reduced motion stops. This is implemented as designed. The label still says "working", but the picture does not.
4. **Unported selectors.** `avatar.css` styles `.wind` (with `.bot.working .wind` and `@keyframes winding`), `.frame`, `.thread` and `.stripe`, but `avatar.js` never renders those elements. They are not ported. The showcase-only `.shapes` and `.states` rules are not ported either, because they carry hex literals and belong to the mockup page.
5. **`avatar.js` lets anyone be the whale, or wear accent.** `avatarHTML` accepts any `shape` in `SHAPES` (including `whale`) and any `hue` in `HUES` (including `accent`). The README forbids both. The component follows the README: a crew member asking for the whale gets the fish, and an unknown hue (including `accent` or a semantic name) gets slate.
6. **Sizes.** `preview.html`'s sizes row uses 16/18/24/36, while the README lists 16/24/36/56. The page shows both sets.
7. **Thread display.** The source renders all six thread paths and toggles them with `display` rules per state. The component renders only the active state's path(s), so the state is legible from the markup alone, without CSS (Avatar.test.tsx asserts it). The picture is the same.
