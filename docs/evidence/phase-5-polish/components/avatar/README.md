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

The avatar's strokes and fills are non-text graphics painted only with `var(--bot)`. That resolves to `--accent` for Wright and to a `--crew-*` token for everyone else. In [tokens.json](../../../../design/tokens.json), every `crew-*` usage note rates the hue "3:1+ on ground and surface in both themes", and `accent` is rated "6.4:1 on surface in both themes". The avatar adds no hue of its own, but the design's opacities lower the contrast of some parts, so the avatar does not inherit the tokens' 3:1+ everywhere.

These figures were computed from `tokens.json` with WCAG relative luminance. They were not measured from the screenshots. Each part is measured against what it is actually drawn on, which is one of two backgrounds:

- **`--ground`**: outside the silhouette. That covers Wright's crown (above the whale's body), the `.stitch` circle (radius 16.5, clear of every silhouette), the waiting ring (outside the SVG), the outer half of each `.st` outline, the crab's eyes, and the lines and threads that leave the body.
- **The `.fill` tint**: inside the silhouette, the creature's own hue at 28% over `--ground`. That covers the inner half of each `.st` outline, every eye but the crab's, the inner lines (for example the fish's ribs, the line across the whale's belly, the turtle's shell and the jellyfish's bell line), and the threads that cross the body (for example the fish's `t-idle` and `t-up`, and the crab's `t-up`).

For a part over the tint, the tint is composited at 28% over `--ground` first, then the part at its own opacity over that. While parked, the whole avatar is composited as one group at 72%, so the tint and the part are both dimmed against the undimmed `--ground`.

| Part, opacity | Drawn on | Lowest (light) | Lowest (dark) | Meets 3:1? |
|---|---|---|---|---|
| `.crown` at 100% (Wright only, accent) | `--ground` | 5.95 | 6.90 | yes |
| `.st` outline, `.t` thread, `.knot` at 100% | `--ground` | 4.99 (crew-teal) | 6.90 (accent) | yes |
| `.st` outline, `.t` thread, `.knot` at 100% | `.fill` tint | 3.37 (crew-teal) | 4.17 (accent) | yes |
| `.ln` inner lines at 85% | `--ground` | 3.81 (crew-teal, crew-olive) | 5.31 (accent) | yes |
| `.ln` inner lines at 85% | `.fill` tint | **2.78 (crew-teal)**, 2.83 (crew-olive), 2.87 (crew-sky) | 3.46 (accent) | no in light (teal, olive, sky) |
| Full-hue parts while parked (whole avatar at 72%) | `--ground` | **2.99 (crew-olive)**, 3.03 (crew-teal) | 4.16 (accent) | no for light olive |
| Full-hue parts while parked | `.fill` tint | 2.29 (crew-olive, crew-teal) | 2.96 (accent) | no in light; no for dark accent |
| `.ln` while parked (85% × 72%) | `--ground` | 2.47 (crew-olive) | 3.36 (accent) | no in light |
| `.ln` while parked | `.fill` tint | 1.99 (crew-olive) | 2.54 (accent) | no |
| `.stitch` ring at 45% (idle, working, waiting) | `--ground` | 1.89 (crew-olive) | 2.39 (accent) | no |
| `.stitch` while parked (50% × 72%), killed (60%), done (90%) | `--ground` | 1.65, 2.42, 4.17 | 1.96, 3.28, 5.81 | parked and light killed: no |
| Waiting ring, `--attention` at 70% under reduced motion | `--ground` | 2.97 | 5.30 | no in light |

Where two `.fill` shapes overlap (the shark's fin and body, the whale's body and tail, the turtle's body and head), the tint doubles to about 48%. The `.st` outline crossing that sliver drops to 2.46:1 in light (crew-teal) and 2.70:1 in dark (accent).

Dark `accent` on `--surface` computes to 6.34:1, slightly under the 6.4:1 its usage note gives. `.fill` carries nothing alone. The parked state's own `t-slack` thread hangs below the body on `--ground`, and it is dimmed with the rest, so in light crew-olive the thread that carries "paused at cap" is itself 2.99:1. Owner finding 8 covers this.

`Avatar.test.tsx` fails on any hex literal or CSS colour function (`rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()`, `color-mix()`, `light-dark()`, in any case) in `Avatar.tsx`, `Avatar.css` or `creatures.ts`, and on any semantic token in `Avatar.tsx` or `creatures.ts`. For `Avatar.css` it uses an allowlist. Every declaration is either a listed non-colour property, which may read only `var(--s)` and `var(--seed)`, or it is treated as colour-bearing. An unlisted property counts as colour-bearing. Each word of a colour-bearing value must be one of these: `var(--bot)`, `var(--bot, var(--accent))`, a `var(--crew-*)` hue, `var(--attention)` on a `.ring` rule only, `var(--ground)` as the crown's stroke only, or a length, number, line style or `none`/`transparent`/CSS-wide keyword. So a named colour, `currentColor`, a fallback such as `var(--nope, red)`, a bare `var(--accent)` and any semantic token all fail. `Avatar.css` may declare no custom property, so no rule can re-point `--bot` by state or role. A second test feeds the guard known bypasses and checks that each one fails. Finally, the test renders every state for Wright and Mason. It fails if any element carries a colour attribute, or if any element carries an inline style other than the root's `--s`, `--bot` and `--seed` and the tail's `transform-origin`, each checked against the only value shape it may take. On the root, `--bot` must be `accent` for Wright and a crew hue for anyone else.

## Owner findings (the design is ported as is; these need a decision)

1. **Hover nod vs reduced motion.** In `avatar.css`, `.bot:hover .rig{animation:nod …!important}` (specificity 0,3,0) out-specifies the reduced-motion `.bot .rig{animation:none!important}` (0,2,0). So in the design, hovering plays the nod even with motion reduced. The component adds `.bot:hover .rig{animation:none!important}` inside its reduced-motion block. The source CSS still has the gap.
2. **The running stitches ignore reduced motion in the source.** The README says "every animation stops", but the source's reduced-motion block leaves the `run` animation on `.st`, `.ln` and `.stitch` running for `working`. The component stops them too.
3. **`idle` and `working` share the `t-idle` thread.** With motion off, the thread shape alone can't tell them apart: `working` differs only by its running stitches, which reduced motion stops. This is implemented as designed. The label still says "working", but the picture does not.
4. **Unported selectors.** `avatar.css` styles `.wind` (with `.bot.working .wind` and `@keyframes winding`), `.frame`, `.thread` and `.stripe`, but `avatar.js` never renders those elements. They are not ported. The showcase-only `.shapes` and `.states` rules are not ported either, because they carry hex literals and belong to the mockup page.
5. **`avatar.js` lets anyone be the whale, or wear accent.** `avatarHTML` accepts any `shape` in `SHAPES` (including `whale`) and any `hue` in `HUES` (including `accent`). The README forbids both. The component follows the README: a crew member asking for the whale gets the fish, and an unknown hue (including `accent` or a semantic name) gets slate.
6. **Sizes.** `preview.html`'s sizes row uses 16/18/24/36, while the README lists 16/24/36/56. The page shows both sets.
7. **Thread display.** The source renders all six thread paths and toggles them with `display` rules per state. The component renders only the active state's path(s), so the state is legible from the markup alone, without CSS (Avatar.test.tsx asserts it). The picture is the same.
8. **The design's opacities and its own tint take some parts below 3:1.** The tokens' "3:1+" holds for the full-hue parts, but not after the design's dimming, nor for some parts drawn over the creature's own 28% `.fill` tint (see Contrast). In light, the inner lines (`.ln` at 85%) over the tint are 2.78:1 (crew-teal), 2.83:1 (crew-olive) and 2.87:1 (crew-sky). In light, the parked state's 72% opacity puts crew-olive at 2.99:1 on `--ground`, and every full-hue part drawn over the tint at 2.29 to 2.50:1. Where two fills overlap, the outline over the doubled tint is 2.46:1 in light. The `.stitch` ring at 45% is 1.89 to 2.85:1 across hues and themes, and it partly carries the parked, done and killed states. The waiting ring's `--attention` at 70% is 2.97:1 in light. The port keeps the design's opacities. The owner needs to decide whether the dimmed parts must also meet 3:1.
