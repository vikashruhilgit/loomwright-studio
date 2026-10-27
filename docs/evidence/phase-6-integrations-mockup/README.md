# Integrations mockup: screenshot and token evidence (phase 6 item 02, the Integrations screen mockup)

These are screenshots of every designed view of `docs/design/mockups/integrations.html`, in light and dark, plus the audit of its token block and of every value outside it. The mockup is static: it runs no kernel and makes no GitHub call. Each view is forced by the URL hash (`#view=<view>&theme=<light|dark>`), so each screenshot comes from one headless-browser command. No script is committed. The owner approves the design by merging the PR that adds it (D9). What it commits phase 6 item 11 (the Integrations screen) to is in `docs/DESIGN.md` §"Phase 6: Integrations".

## Screenshots

Each image is the full page: the intro line, the 1180×760 window, and the review strip under it with the forced view highlighted. The viewport is 1280×1000 CSS px.

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `not-connected` | The designed empty state: the GitHub row with an `idle` ring, then a `display` line, one `body` line and one primary action, Connect GitHub | [integrations-not-connected-light.png](integrations-not-connected-light.png) | [integrations-not-connected-dark.png](integrations-not-connected-dark.png) |
| `connecting` | The sheet after Connect: the field is disabled and already cleared, Connect shows the loading spinner with `aria-busy`, and the row shows a `working` dot | [integrations-connecting-light.png](integrations-connecting-light.png) | [integrations-connecting-dark.png](integrations-connecting-dark.png) |
| `connected` | The detail pane: status `ok` with its verification time, the account, the Keychain item, expiry with days left, three read-only permissions, three reachable repos with Refresh, Mason's card under the grant, Replace token and Disconnect | [integrations-connected-light.png](integrations-connected-light.png) | [integrations-connected-dark.png](integrations-connected-dark.png) |
| `rejected-invalid` | The sheet with the `token_invalid` refusal inline under the field, in Input's error state; Connect is unavailable | [integrations-rejected-invalid-light.png](integrations-rejected-invalid-light.png) | [integrations-rejected-invalid-dark.png](integrations-rejected-invalid-dark.png) |
| `rejected-write` | The sheet with the `token_write_scoped` refusal naming each permission to change ("Pull requests: Read and write → set to Read-only", "Contents: Read and write → set to Read-only"); Connect stays unavailable until a token is pasted again | [integrations-rejected-write-light.png](integrations-rejected-write-light.png) | [integrations-rejected-write-dark.png](integrations-rejected-write-dark.png) |
| `expiring` | 8 days left: an `attention` dot, band and badge, with Replace token as the primary | [integrations-expiring-light.png](integrations-expiring-light.png) | [integrations-expiring-dark.png](integrations-expiring-dark.png) |
| `expired` | A `danger` dot, a band naming the parked playbook, the last-read permissions and repos with their date, and Replace token as the primary | [integrations-expired-light.png](integrations-expired-light.png) | [integrations-expired-dark.png](integrations-expired-dark.png) |
| `unreachable` | The shared `Kernel unreachable` band (gui-v1's copy), the status as "unknown" with no dot, the last-read data with its time, and every action that needs the kernel disabled | [integrations-unreachable-light.png](integrations-unreachable-light.png) | [integrations-unreachable-dark.png](integrations-unreachable-dark.png) |
| `sheet` | The Connect GitHub sheet as it opens: what token to create, the link-out to GitHub's token page, the password field, the Keychain copy, and Cancel and Connect (disabled until something is pasted) | [integrations-sheet-light.png](integrations-sheet-light.png) | [integrations-sheet-dark.png](integrations-sheet-dark.png) |

No forced view covers two surfaces, so they have no screenshot here: the Disconnect confirm (Disconnect, or ⌘K → Disconnect GitHub) and the ⌘K palette. Both open from the page. The interactive paths were driven once in headless Chromium with a scratch script outside the repo:

- typing a token enables Connect;
- Connect clears the field and moves to `connecting`;
- a token containing `write` lands on `rejected-write`, any other non-`github_pat_` value on `rejected-invalid`, and `github_pat_…` on `connected`, after which the value appears nowhere in the DOM;
- `⌃K` → "disc" → Enter opens the confirm, and `Esc` closes it;
- focus returns to the control that opened a dialog or the palette, or to the same control after a re-render, and to the GitHub row when that control is gone or nothing was focused; it never lands on the page body. Driven on 2026-10-27: `⌃K` → "connect" → Enter → `Esc`; the same with a valid `github_pat_` token; the empty state's Connect GitHub → `Esc`, Cancel, the backdrop, and a valid token; Replace token → `Esc`, a valid token, a refused token, and `Esc` while connecting (no late refocus); Disconnect → `Esc`, Cancel and Disconnect; `⌃K` → Disconnect GitHub → `Esc` from the page and from Replace token; and a Crew row → `⌃K` → Connect GitHub → `Esc`;
- replacing an expired token says the new one replaces it, not that the expired one stays in use, and the expired view's Disconnect confirm says the playbook is already parked;
- "Show reachable repos" focuses the repos section;
- a command that can't run stays open, marked `aria-disabled`;
- `⌃5` focuses the GitHub row, and Tab cycles inside the sheet;
- in `unreachable`, Replace token, Disconnect and Refresh are disabled.

The run reported no console errors.

## How to regenerate

Setup, once: the Playwright CLI at the version `app/package-lock.json` pins (1.64.1), with its Chromium.

```sh
cd app && npm ci && npx playwright install chromium
```

These shots were taken with the same CLI version installed outside the repo, so `app/` was untouched: `npm i @playwright/test@1.64.1 && npx playwright install chromium` in an empty directory. Either setup runs the commands below unchanged.

Then run each command from the directory where Playwright is installed. `<repo>` is the absolute path of your checkout.

```sh
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=not-connected&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-not-connected-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=not-connected&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-not-connected-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=connecting&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-connecting-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=connecting&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-connecting-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=connected&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-connected-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=connected&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-connected-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=rejected-invalid&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-rejected-invalid-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=rejected-invalid&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-rejected-invalid-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=rejected-write&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-rejected-write-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=rejected-write&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-rejected-write-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=expiring&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-expiring-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=expiring&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-expiring-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=expired&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-expired-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=expired&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-expired-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=unreachable&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-unreachable-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=unreachable&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-unreachable-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=sheet&theme=light' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-sheet-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=sheet&theme=dark' <repo>/docs/evidence/phase-6-integrations-mockup/integrations-sheet-dark.png
```

The hash's `theme` sets `data-theme` on the page, and `--color-scheme` matches it, so a shot never depends on the host's appearance setting. `--wait-for-timeout=600` lets the sheet's open animation (`duration-slow`, 240ms) finish. The `working` dot and the spinner animate, so their frame in a regenerated `connecting` shot can differ by a few pixels.

## Token audit

### The token block is the generator's output, verbatim

The mockup's `<style>` opens with the stdout of `node app/scripts/tokens.mjs`, pasted between the `/* tokens:begin */` and `/* tokens:end */` comment lines. Generator names are used throughout (`--radius-lg`, `--duration-base`, `--ease-standard`, `--space-4`, `--type-body-size`), never gui-v1's short forms (`--r-lg`, `--d-base`, `--ease`). To check, run this from the repo root (bash, for the process substitution):

```sh
diff <(node app/scripts/tokens.mjs) <(awk '/\/\* tokens:end \*\//{f=0} f; /\/\* tokens:begin \*\//{f=1}' docs/design/mockups/integrations.html); echo "exit $?"
```

Result, 2026-10-27: no diff output, then `exit 0`. The block is 195 lines, the same as the generator's stdout.

### Values outside the block

The rest of the `<style>` is in two parts. The **harness** block (`harness:begin` … `harness:end`) is copied from gui-v1. The **app UI** part uses `var(--…)` tokens, plus the literals below.

The table names every literal value outside the token block, found by listing each number and colour in the CSS outside the block, plus the values the script passes inline. Structural values are not listed: `0`, `100%`, `1fr`, `auto`, `max-content`, `minmax(0, 1fr)`, `flex: 1` and `grid-row: 2` lay out the page and carry no design value. The colour keywords `transparent` (no fill or edge: Button's resting border, the field's input, the spinner's open quarter) and `currentColor` (the text colour of the element itself: icons, the GitHub mark, the spinner, the key chip on a primary Button) are structural too, since neither adds a colour. Other CSS keywords (`uppercase`, `nowrap`, `balance`, `tabular-nums`, `underline`, `infinite`, display and alignment values) are not listed: each restates a rule in the component READMEs or `brand-book.md` and carries no number or colour. SVG geometry is not listed either: `viewBox` and path data of the Lucide icons, the Avatar creatures and the GitHub mark.

| Value | Where | Marking |
|---|---|---|
| `--desk` `#3a3d52` / `#101118`, `--desk-ink` `#eef0ff` / `#d9dbef` | The desk the window sits on, the intro line and the review strip (light / dark) | review-harness chrome (not app UI) |
| `--win-shadow` `0 24px 80px #00000059, 0 0 0 1px #00000026` / `0 24px 80px #000000b3, 0 0 0 1px #ffffff1f` | The window's drop shadow on the desk, applied to `.win` | review-harness chrome (not app UI) |
| `#ff5f57`, `#febc2e`, `#28c840`; 12px circles at `50%` radius, `8px` gap and padding | The macOS traffic lights (the real app gets them from the OS, `titleBarStyle: 'hiddenInset'`) | review-harness chrome (not app UI) |
| `#ffffff14`, `#ffffff33`, `#ffffff26`, `#ffffff1f` | Review strip fill, borders, the selected segment and the key chips | review-harness chrome (not app UI) |
| `1240px`, `26px`, `12px`, `15px`, `20px`, `16px`, `24px`, `-16px`, `10px`, `18px`, `6px`, `5px`, `4px`, `1px`, `2px`; opacity `.7`, `.75`, `.9`; weights `500`, `600`; `max-width: 1280px` media query | Page, intro and review-strip sizes, type, padding, gaps, radii and focus ring; the breakpoint under which the intro and the strip go full width | review-harness chrome (not app UI) |
| `1180px` × `760px` | The window | new — the default window size; gui-v1 and phase 5's polish evidence ("The default window is 1180×760") |
| `blur(24px) saturate(1.4)` | Sidebar vibrancy | new — specified in `brand-book.md` §Layout; tokens.json has no filter values |
| `1px` | Hairline and border widths; the visually hidden live region's size | new — component READMEs specify "a `hairline` edge" and tokens.json has edge colours but no widths |
| `2px` | Focus ring width and offset; the `idle` ring's stroke; the spinner's stroke | new — `brand-book.md` §Colour: "2px solid with a 2px offset"; the StatusDot idle ring and Button spinner as in gui-v1 |
| `8px` (and `calc((var(--type-body-line) - 8px) / 2)`) | StatusDot size; the list row's dot column; centring the dot on the subject line | new — StatusDot README: "An 8px dot" |
| `16px`, `14px`, `12px`; stroke widths `1.5`, `1.75`, `2` | Lucide icon sizes (rows, buttons and badges, checks) and the Button loading spinner | new — `brand-book.md` §Iconography (16px at 1.5px stroke; 14px in badges), Button README ("a 12px spinner"), gui-v1's icon classes |
| `20px` | Badge height | new — Badge README: "All 20px tall" |
| `24px`, `36px` (inline `--s`), `32px` (Avatar's default `--s`) | Avatar sizes in Crew rows and on the grant card | new — List README (24px Crew avatar), Card README (36px agent avatar), `avatar.css` default |
| `32px` | The Disconnect confirm's icon disc | new — Dialog README: "a 32px `danger-soft` icon disc" |
| `44px` | Crew row height; the palette's search row | new — List README (44px two-line and Crew rows), CommandPalette README ("a 44px search row") |
| `250px` | Agent card grid minimum | new — Card README: "`auto-fill` with a 250px minimum" |
| `360px`, `480px` | Dialog widths (the confirm; the Connect sheet) | new — Dialog README: "360px (480px when it carries a diff)"; the sheet carries steps, a link and a field, so it uses the wide variant |
| `560px`, `20%`, `360px` | Palette width, its offset from the top, and its list's maximum height | new — CommandPalette README ("560px", "centred at 20% from the top"); the list height is gui-v1's |
| `65ch` | Maximum width of the empty state's lines | new — `brand-book.md` §Type: "Running text stays under 65 characters" |
| `500` | Font weight of buttons, the selected sidebar row and the neutral badge | new — List README ("weight 500" when selected), gui-v1's buttons and neutral badge; tokens.json defines 500 only for `kbd` |
| `50%`, `.55`, `.85` | The `working` dot's breathing keyframe (its midpoint, opacity, scale) | new — gui-v1's StatusDot `pulse`; the duration is `--duration-pulse` |
| `.98` | Dialog and palette open scale | new — Dialog and CommandPalette READMEs: "scaling from 0.98" |
| `1turn`, `linear` | The Button loading spinner, one constant-speed turn per `--duration-pulse` | new — a spinner turns at constant speed; tokens.json has no linear curve |
| `50` | Overlay `z-index` | new — gui-v1's overlay stacking |
| `inset(50%)` | `clip-path` of the visually hidden live region | new — standard visually-hidden pattern for the `aria-live` announcer |
| Opacity `.28`, `.45`, `.85`; stroke widths `1.6`, `1.2`, `1.9`; dash arrays `2.6 1.5`, `1.8 1.4`, `2.4 2.6` | The Avatar's fill, stitches, lines and loose thread (static idle pose) | new — copied unchanged from `docs/design/avatar/avatar.css`; no avatar value is a token there either |
| `1200` ms (script) | How long the mockup pretends GitHub takes to check a pasted token | new — mock behaviour only, not a design duration; phase 6 item 11's screen shows `connecting` for as long as the kernel takes |

## Branding check (phase 6 item 02's AC5, invariant 7)

```sh
grep -c "Claude Code" docs/design/mockups/integrations.html
grep -n -i -E "#(24292f|2da44e|1f883d|238636|2ea043|0969da|f6f8fa|57606a|d0d7de|161b22|0d1117|8b949e|30363d|58a6ff|1a7f37|6e7781|eaeef2)\b" docs/design/mockups/integrations.html
```

Results, 2026-10-27:

- The first command prints `0`.
- The second prints nothing and exits 1. It checks for GitHub's Primer greys, greens and blues, including `#24292f` and `#2da44e`.

The GitHub mark is drawn in `currentColor` (`ink`), only next to the name "GitHub" in the list row and the detail header. The screen uses the app's own palette. The only attribution is "Wright, powered by Claude", in the palette footer. "GitHub" also appears in plain-text copy, which tells the owner what to create on GitHub. None of it is styled as GitHub.
