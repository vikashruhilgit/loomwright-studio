# Phase 5 polish: app primitives, gallery evidence

This is the evidence for phase 5 item 08, which built eight primitives under `app/src/components/<Name>/`: Button, Badge, Input, StatusDot, Dialog, List, Card and Toast. The 16 screenshots below show every state each component's `<Name>.states.tsx` exports, rendered in the real Electron renderer in light and dark mode. The **Owner findings** section lists every place where the build, a component README and its `preview.html` disagree. The design was not changed to resolve any of them. Each one is yours to decide, except finding 9, a class-name collision that this item fixed in its own files.

## How the screenshots were produced

The implementing agent ran these commands on 2026-10-22 at about 05:00 UTC, on macOS 26.6.2 (25G83), Apple Silicon (arm64), with Node v24.11.1, Electron 44.9.2 and Playwright 1.64.1. The branch was based on `ee1dee7` (the three component lanes merged). No human step was involved. The screenshots were regenerated the same way after the first review round's fixes, which made the List rows' verification time visible and loaded `app.css` in the gallery.

```
cd app && npm ci && npm run build && PRIMITIVES_EVIDENCE=1 npm run e2e
```

The screenshots come from [`app/e2e/components.primitives.spec.ts`](../../../../../app/e2e/components.primitives.spec.ts). The app has no gallery route, so the spec builds its own gallery: it writes an `index.html` and `entry.tsx` into the gitignored `app/node_modules/.cache/components-gallery/`, builds them with Vite's `build()` and `configFile: false` (so `app/vite.config.ts` and `app/dist/` are never touched), and launches a throwaway Electron main that `loadFile`s the result. The window is 1200×900 and the theme is set with `document.documentElement.dataset.theme`. Animations are disabled and reduced motion is emulated, so the working dot is captured static. The PNGs are 2× (Retina).

When `PRIMITIVES_EVIDENCE=1` isn't set, the same spec writes its screenshots to Playwright's `test-results/`, which is gitignored. CI and other lanes' e2e runs therefore never rewrite these files. I checked this by running `npm run e2e` without the flag after the evidence run: all 16 PNGs kept identical SHA-1s.

Fonts differ between macOS and the ubuntu CI run, so the spec never pixel-diffs. It asserts behaviour in the same renderer:

- **Every state renders.** Each component's section shows as many states as its `states` array exports, and every state frame has a non-zero height.
- **AC2 (List scroll anchoring).** In a 220px List scrolled so the selected row (`row-15`) sits mid-viewport, inserting three rows above keeps the selected key and the row's `boundingBox().y`. `scrollTop` grows by exactly the three rows' height.
- **AC6 (no-shift toasts).** Showing a toast, dismissing it, and then showing four toasts never changes the `boundingBox()` of the content block or the page's scroll height. At most three toasts are shown, with a "1 earlier" line for the rest.
- **AC3 (Dialog focus).** The checks run on a live, non-inline `decision` dialog opened with the keyboard:
  - initial focus lands on the first non-destructive control;
  - seven Tabs and seven Shift+Tabs each stay inside the dialog and cycle through all three controls;
  - Escape closes it and returns focus to the opener.
- **AC3 (destructive confirm).** A destructive `confirm` focuses Cancel, ignores Escape, and returns focus to its opener when cancelled.
- **Band vs the shell's `.band`.** The gallery loads the shell's `app.css`, as `main.tsx` does in the real app. Each Band state then has `0px` side margins and exactly its frame's width, and the shell's `.band` rule is confirmed to be on the page.
- **AC9 (reduced motion).** The working dot's computed `animationName` is `status-breathe` normally and `none` under `prefers-reduced-motion: reduce`.

I mutation-checked each behaviour test on a throwaway copy of the app, and each test failed against its mutation:

- removing List's `scrollTop` adjustment failed AC2;
- making Escape cancel a `confirm` failed the confirm test;
- making the toast stack `position: static` failed AC6;
- deleting `animation: none` failed AC9;
- deleting the trap's wrap-around `focus()` failed the Tab cycle;
- deleting the refocus of the opener failed both AC3 tests.

## Screenshots

| Component | Light | Dark | Matches | States shown |
|---|---|---|---|---|
| Button | [button-light.png](button-light.png) | [button-dark.png](button-dark.png) | [Button/preview.html](../../../../design/design-system/components/Button/preview.html) | Variants, standalone (32px); inside a row (28px); loading; disabled |
| Badge | [badge-light.png](badge-light.png) | [badge-dark.png](badge-dark.png) | [Badge/preview.html](../../../../design/design-system/components/Badge/preview.html) | Semantic tones; neutral; count pill; chips (agent and linked PR); kbd and mono |
| Input | [input-light.png](input-light.png) | [input-dark.png](input-dark.png) | [Input/preview.html](../../../../design/design-system/components/Input/preview.html) | Text, search, select and error; disabled; composer; composer while Wright is streaming |
| StatusDot | [statusdot-light.png](statusdot-light.png) | [statusdot-dark.png](statusdot-dark.png) | [StatusDot/preview.html](../../../../design/design-system/components/StatusDot/preview.html) | The four kernel states; verified outcomes; unverified ok as a guess (no dot); dot only with the word as `aria-label` |
| Dialog | [dialog-light.png](dialog-light.png) | [dialog-dark.png](dialog-dark.png) | [Dialog/preview.html](../../../../design/design-system/components/Dialog/preview.html) | Confirm (destructive, the kill switch); decision with a mono well and a narrowing checkbox; decision, wide (480px) for a diff. All `inline`. |
| List | [list-light.png](list-light.png) | [list-dark.png](list-dark.png) | [List/preview.html](../../../../design/design-system/components/List/preview.html) | Sidebar navigation rows (selected row, kbd shortcuts, count pill); Crew rows; empty Crew group; data rows with a selected row; loading skeletons |
| Card | [card-light.png](card-light.png) | [card-dark.png](card-dark.png) | [Card/preview.html](../../../../design/design-system/components/Card/preview.html) | Agent cards (working, waiting on you, idle); budget at 80% or more, with a long name and role clamped; task card |
| Toast | [toast-light.png](toast-light.png) | [toast-dark.png](toast-dark.png) | [Toast/preview.html](../../../../design/design-system/components/Toast/preview.html) | Toasts with an action and plain; a stack of five showing three plus "2 earlier"; Band danger, parked and attention |

**Avatar placeholder.** The Avatar component (item 09) is built in parallel and isn't on `main`, so no primitive imports it. The Card agent cards (36px), the List Crew rows (24px) and the Badge agent chip (14px) take an `avatar` slot. Their states fill it with a plain circle at the right size, filled with a token colour (`--accent` for Wright, `--crew-*` for the others) and named with `role="img"`. Those circles are what the screenshots show; they aren't the real avatar.

## Owner findings

Each finding below was checked against the cited source line. None of them was redesigned.

1. **Destructive confirm and Escape (required).**
   - The requirement (Scope 2) says Escape does not close a destructive `confirm`, and the build follows it: Escape is ignored, and the confirm's Cancel carries no `Esc` chip.
   - The design says otherwise. [Dialog/README.md](../../../../design/design-system/components/Dialog/README.md) says "`Esc` cancels" without exception, and the "Kill everything?" panel in [Dialog/preview.html](../../../../design/design-system/components/Dialog/preview.html) shows `Cancel Esc`.
   - The preview's "Always allow" decision shows a plain `Cancel` with no chip. The build is the reverse: decision dialogs show `Cancel Esc`, because Escape does cancel them.
   - **Decide:** which rule wins, so that the README and preview can be updated to match.
2. **Button `danger` is outlined; the kill-switch preview fills it.** [Button/README.md](../../../../design/design-system/components/Button/README.md) defines `danger` as "`danger` text and edge, `danger-soft` on hover", and [Button/preview.html](../../../../design/design-system/components/Button/preview.html) draws it outlined. The build follows both. The "Kill all" button in [Dialog/preview.html](../../../../design/design-system/components/Dialog/preview.html) is a filled `.dng` (`background: var(--danger); color: #fff`), so the dialog screenshot shows an outlined "Kill all" where the preview shows a filled one.
3. **Count pill text colour.** The build uses `var(--on-accent)`. [Badge/preview.html](../../../../design/design-system/components/Badge/preview.html) and [List/preview.html](../../../../design/design-system/components/List/preview.html) hard-code `#fff` (light) and `#1a1200` (dark) on the `attention` fill. AC7 bans hex colour literals, and no token exists for "text on attention". **Decide:** whether to add an `--on-attention` token.
4. **Neutral badge weight.** [Badge/README.md](../../../../design/design-system/components/Badge/README.md) says all badges use weight 600, and the build follows it. The preview's `.neu` rule sets `font-weight: 500`.
5. **Translucent hex vs `color-mix`.** The previews use translucent hex for several washes:
   - Button kbd chip `#0000000f` and `#ffffff33`;
   - spinner track `#ffffff55`;
   - List nav hover `#0000000a`.

   AC7 bans hex literals, so the build uses `color-mix(in srgb, <token> N%, transparent)`:
   - Button.css lines 91 and 105;
   - List.css lines 54 and 154 (the second is the hover wash on Crew rows).

   The look is close but not identical, and the dark theme inherits the same mix. **Decide:** whether to add tokens for these washes.
6. **Card meta row hairline.** [Card/README.md](../../../../design/design-system/components/Card/README.md) says "The meter is the only divider: no hairline above the meta row", and the build follows it. The `.meta` rule in [Card/preview.html](../../../../design/design-system/components/Card/preview.html) draws `border-top: 1px solid var(--hairline)`.
7. **PR references read "PR 412", not "#412".** The previews write `#412`, `#398` and `#405` (for example the Badge chip "vikashruhilgit/loomwright #412", the List data rows and the Toast text). The component states write "PR 412", because AC7's hex-literal check (`/#[0-9a-fA-F]{3,8}\b/`) matches `#412` in a `.states.tsx` source file. Screens that render real PR numbers at run time are unaffected. **Decide:** whether the AC7 check should exempt text content.
8. **A verified `ok` shows its verification time in every StatusDot consumer (one rule, from AC5).**
   - AC5 says a verified `ok` shows its verification time in its meta. StatusDot renders `· verified <time>` beside the dot, and List, Card and Toast now all leave it visible. List used to hide it visually inside data rows; that rule is gone.
   - So a toast reads "● · verified 14:03 **Playbook enabled.** …", and a done List row shows "● · verified 14:02" before its subject (visible in the toast and list screenshots).
   - [Toast/preview.html](../../../../design/design-system/components/Toast/preview.html) shows a bare dot followed by the bold clause, so the toast differs from its preview here.
   - **Decide (optional):** whether AC5 should allow a consumer to show the time elsewhere, for example in the row's own meta line. If so, apply that rule to every consumer at once.
9. **Toast's `Band` collided with the shell's `.band` class. Fixed in this item.**
   - `app/src/styles/app.css` (item 01) styles `.band` for the shell's kernel-unreachable band, with `margin: var(--space-3) var(--space-5) 0`. `main.tsx` always loads it, so in the real app that rule would have added side margins to every `Band` on top of its `width: 100%`, and Toast.css's `.band` would have leaked into the shell band.
   - The fix stays inside this item's files. Toast's classes are now `toast-band`, `toast-band-icon`, `toast-band-text` and `toast-band-action`. The shell band is unchanged.
   - Two checks guard it. The gallery now loads `app.css`, and the e2e asserts the Band's margins and width with the shell rule on the page. A unit test in `Toast.test.tsx` fails if any component stylesheet shares a class name with `app.css`.
