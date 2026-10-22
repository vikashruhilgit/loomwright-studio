# Conversation components: evidence (phase 5, item 10)

Screenshots of every state of ChatBubble, Charter, EventCard, DiffView and StreamingLog, rendered in Electron in light and dark mode (`data-theme="light"` / `"dark"`), plus one focused control per component. They are evidence for the owner's polish review, not visual-regression baselines: the spec never compares pixels.

## How they were produced

```sh
cd app && npx playwright test e2e/components.conversation.spec.ts
```

The spec is `app/e2e/components.conversation.spec.ts`. It starts a Vite dev server (root `app/`) that serves a gallery page importing `src/styles/tokens.css`, `src/styles/app.css` and the five `src/components/<Name>/<Name>.gallery.tsx` files. A throwaway Electron main script in the OS temp dir then opens a sandboxed window on that page. It needs no built `dist/` and touches no app source. Each state renders in a wrapper tagged `data-state-id="<Component>/<id>"`, and every screenshot is named from that tag: `<Component>-<id>-<theme>.png`. Screenshots are element shots at CSS pixel scale (1x), taken on macOS with Electron 44.

Before taking its screenshots, a full run deletes the `*.png` files in this folder and writes them again, so the folder always matches the current galleries. The spec's last test fails if this README and the folder disagree in either direction. CI runs the spec under `npm run e2e` (Linux, xvfb). Its screenshots stay in the CI checkout and are never committed.

Besides the screenshots, the spec checks these in a real layout engine:

| Check | What it asserts |
|---|---|
| Every state renders | Each gallery's `galleryStates` length matches its wrappers. No state hit the error boundary, and the page logged no error. |
| Dark tokens apply | After the theme is toggled, `color-scheme` on `<html>` reads `dark` (or `light`) before any screenshot is taken. |
| AC2, inert text | Each component has an `untrusted*` state. In each one, the string `<img src=x onerror=alert(1)>` is visible as text, and the state has no `img`, no `[onerror]`, no `a[href^="javascript:"]` and no `[href]` at all. The page has no `img` anywhere, and no dialog ever opened. |
| AC4, StreamingLog scroll | In `StreamingLog/append-harness`: the log starts pinned and stays pinned when 50 lines arrive ("Following"). After a wheel scroll up, the pill reads "Jump to latest", and 50 more lines leave `scrollTop` exactly unchanged. "Jump to latest" returns to the bottom and resumes following. Every line has `animation-name: none` and `transition-duration: 0s`. |
| AC7, other agent's approval | The `EventCard/approval-other-agent` stage has no child element. |
| AC9, keyboard | The check runs in each theme and each component. Tab from just before the component visits every keyboard stop in DOM order and then leaves. Each stop is a native `button` or a focusable scroll region (`role` log, region or group) with a non-empty name. Each is `:focus-visible` with a 2px solid outline whose colour equals the resolved `var(--focus)`. |
| AC9, reduced motion | With `prefers-reduced-motion: no-preference` some hover transitions exist, which shows the emulation is real. With `reduce`, no element inside any state has an animation or a non-zero transition. |

These checks were each shown to fail against a deliberate mutation, made in a scratch copy and never committed:

- Rendering EventCard's text through `dangerouslySetInnerHTML` fails AC2: "EventCard/untrusted-text: no img element".
- Dropping StreamingLog's "reader at the bottom" check fails AC4: `scrollTop` 824.5 became 2324.5.
- Setting a Charter button's ring to `var(--danger)` fails the ring-colour check.
- Adding a top-level `transition` to `DiffView.css` fails the reduced-motion check.

### Limits of the e2e checks (honest)

- `src/styles/app.css` has a global `:focus-visible { outline: 2px solid var(--focus) }`. The ring check would therefore still pass if a component's own `:focus-visible` rule were deleted. The component rule is proven by each folder's unit test, which reads `<Name>.css` (AC9).
- A click-only `div` would be invisible to the Tab walk, because it is not a keyboard stop. That every control is a native `button` is proven by the RTL tests, not here.
- Enter/Space activation is not exercised in Electron, because the gallery handlers are no-ops. The RTL tests prove it.
- The append-harness button ("Append 50 lines") is gallery scaffolding, so it is unstyled.

## Screenshots

Each screenshot matches its component's design-system preview: `docs/design/design-system/components/<Name>/preview.html`. The last column says which part of that `preview.html` the state corresponds to. "README" means the state is specified in the component's `README.md` but not drawn in `preview.html`. "AC" means the state exists to prove an acceptance criterion.

### ChatBubble (`docs/design/design-system/components/ChatBubble/preview.html`)

| State | Light | Dark | Matches |
|---|---|---|---|
| User turn: right, accent-soft, no edge | [light](ChatBubble-user-light.png) | [dark](ChatBubble-user-dark.png) | preview.html: the "You · 14:06" turn |
| Wright turn: left, surface, hairline edge | [light](ChatBubble-wright-light.png) | [dark](ChatBubble-wright-dark.png) | preview.html: the Wright bubble (without its draft card) |
| Specialist turn | [light](ChatBubble-specialist-light.png) | [dark](ChatBubble-specialist-dark.png) | README: "Wright and specialists sit left" |
| Wright turn with a drafted playbook and its dry run | [light](ChatBubble-playbook-draft-light.png) | [dark](ChatBubble-playbook-draft-dark.png) | preview.html: the "Review PRs where I'm requested" draft card |
| Drafted playbook with every value set by the user | [light](ChatBubble-playbook-draft-user-set-light.png) | [dark](ChatBubble-playbook-draft-user-set-dark.png) | README: proposed tags only on Wright's choices (AC5, the negative case) |
| Streaming turn: meta reads streaming, static caret | [light](ChatBubble-streaming-light.png) | [dark](ChatBubble-streaming-dark.png) | preview.html: the "Wright streaming" turn |
| Long text wraps at the 520px cap | [light](ChatBubble-long-wrap-light.png) | [dark](ChatBubble-long-wrap-dark.png) | README: "Bubbles cap at 520px and wrap" |
| Untrusted text renders inert | [light](ChatBubble-untrusted-text-light.png) | [dark](ChatBubble-untrusted-text-dark.png) | AC2 (not in preview.html) |
| Focused control: Enable in the draft card | [light](ChatBubble-focused-control-light.png) | [dark](ChatBubble-focused-control-dark.png) | AC9 focus ring (`var(--focus)`) |

### Charter (`docs/design/design-system/components/Charter/preview.html`)

| State | Light | Dark | Matches |
|---|---|---|---|
| Drafted by Wright, with proposed values | [light](Charter-drafted-light.png) | [dark](Charter-drafted-dark.png) | preview.html: the "Pim" charter |
| Every value set by the user, all tools connected | [light](Charter-user-set-light.png) | [dark](Charter-user-set-dark.png) | README: proposed tags only on Wright's choices (AC5, the negative case) |
| Dollar figures only as estimates at API rates | [light](Charter-estimates-light.png) | [dark](Charter-estimates-dark.png) | README: "Limits, not budgets" (AC6, D24) |
| No extra boundaries, no playbook yet | [light](Charter-no-boundaries-no-playbook-light.png) | [dark](Charter-no-boundaries-no-playbook-dark.png) | README: "create an agent without showing its boundaries" is a Don't |
| Untrusted text renders inert | [light](Charter-untrusted-text-light.png) | [dark](Charter-untrusted-text-dark.png) | AC2 (not in preview.html) |
| Focused control: Create | [light](Charter-focused-control-light.png) | [dark](Charter-focused-control-dark.png) | AC9 focus ring (`var(--focus)`) |

### EventCard (`docs/design/design-system/components/EventCard/preview.html`)

| State | Light | Dark | Matches |
|---|---|---|---|
| Event · session started | [light](EventCard-session-started-light.png) | [dark](EventCard-session-started-dark.png) | preview.html: the "Session started" line |
| Event · session killed | [light](EventCard-session-killed-light.png) | [dark](EventCard-session-killed-dark.png) | README: session kinds (terminal icon) |
| Event · memory updated (path in mono) | [light](EventCard-memory-updated-light.png) | [dark](EventCard-memory-updated-dark.png) | preview.html: the "Updated memory/mason/lessons.md" line |
| Event · playbook created | [light](EventCard-playbook-created-light.png) | [dark](EventCard-playbook-created-dark.png) | preview.html: the "Created playbook" line |
| Event · agent renamed | [light](EventCard-agent-renamed-light.png) | [dark](EventCard-agent-renamed-dark.png) | README: agent kinds (people icon) |
| Event · approval decided | [light](EventCard-approval-decided-light.png) | [dark](EventCard-approval-decided-dark.png) | README: approval decided (list icon) |
| Event · hook applied and verified | [light](EventCard-hook-verified-light.png) | [dark](EventCard-hook-verified-dark.png) | README: hook applied and verified (check icon) |
| Inline approval · waiting on you | [light](EventCard-approval-inline-light.png) | [dark](EventCard-approval-inline-dark.png) | preview.html: the "Waiting on you · Post review on loomwright #412" card |
| Inline approval · another agent's (renders nothing) | [light](EventCard-approval-other-agent-light.png) | [dark](EventCard-approval-other-agent-dark.png) | README: Don't show another agent's approval (AC7); the shot is only the caption |
| Untrusted text stays inert | [light](EventCard-untrusted-text-light.png) | [dark](EventCard-untrusted-text-dark.png) | AC2 (not in preview.html) |
| Focused control: the event subject | [light](EventCard-focused-control-light.png) | [dark](EventCard-focused-control-dark.png) | AC9 focus ring (`var(--focus)`) |

### DiffView (`docs/design/design-system/components/DiffView/preview.html`)

| State | Light | Dark | Matches |
|---|---|---|---|
| Hook change in an approval (project scope) | [light](DiffView-hook-change-light.png) | [dark](DiffView-hook-change-dark.png) | preview.html: the `.claude/settings.json` diff |
| Playbook edit, two hunks, none collapsed (global scope) | [light](DiffView-playbook-edit-light.png) | [dark](DiffView-playbook-edit-dark.png) | README: "a playbook edit"; "collapse hunks by default" is a Don't |
| Long line scrolls horizontally inside the diff | [light](DiffView-long-line-light.png) | [dark](DiffView-long-line-dark.png) | README: "Long lines scroll horizontally inside the diff" |
| No changes (Allow stays gated) | [light](DiffView-empty-light.png) | [dark](DiffView-empty-dark.png) | README: "Allow is not enabled until the diff has rendered" |
| Untrusted text stays inert | [light](DiffView-untrusted-text-light.png) | [dark](DiffView-untrusted-text-dark.png) | AC2 (not in preview.html) |
| Focused control: the diff body (scroll region) | [light](DiffView-focused-control-light.png) | [dark](DiffView-focused-control-dark.png) | AC9 focus ring (`var(--focus)`) |

### StreamingLog (`docs/design/design-system/components/StreamingLog/preview.html`)

| State | Light | Dark | Matches |
|---|---|---|---|
| Running, following, with a cost estimate | [light](StreamingLog-running-light.png) | [dark](StreamingLog-running-dark.png) | preview.html: the "Mason · review PR #412" log |
| Running, tokens only (no cost passed) | [light](StreamingLog-running-no-cost-light.png) | [dark](StreamingLog-running-no-cost-dark.png) | AC1: cost omitted when not passed |
| Just started: no output yet, caret at the live end | [light](StreamingLog-starting-light.png) | [dark](StreamingLog-starting-dark.png) | README: "The live end shows a block caret" |
| Stopped: no caret, Stop and Kill unavailable | [light](StreamingLog-stopped-light.png) | [dark](StreamingLog-stopped-dark.png) | README: state changes (stopped) |
| Killed, ending on an error line | [light](StreamingLog-killed-light.png) | [dark](StreamingLog-killed-dark.png) | README: state changes (killed), errors in `danger` |
| A long log, pinned to the bottom | [light](StreamingLog-long-light.png) | [dark](StreamingLog-long-dark.png) | README: "pins to the bottom while the user hasn't scrolled" |
| Untrusted text renders inert | [light](StreamingLog-untrusted-light.png) | [dark](StreamingLog-untrusted-dark.png) | AC2 (not in preview.html) |
| Live append harness (AC4) | [light](StreamingLog-append-harness-light.png) | [dark](StreamingLog-append-harness-dark.png) | AC4 harness (not in preview.html); the shot is taken before the scroll checks run |
| Focused control: Read latest | [light](StreamingLog-focused-control-light.png) | [dark](StreamingLog-focused-control-dark.png) | AC9 focus ring (`var(--focus)`) |

## Mismatches between a README and its preview.html (findings for the owner)

These were found while building the components. They are recorded here as findings, not redesigns: each line says what the README and `preview.html` say and what was built.

1. **Primary-button kbd chip colour (ChatBubble, Charter, EventCard).** All three `preview.html` files style the chip on a primary button as `kbd{…background:#ffffff33}`, a literal colour that no token defines. It was built as `color-mix(in srgb, var(--on-accent) 20%, transparent)`, which stays a token, as the AC8 rule requires. In light mode this is the preview's colour, because `--on-accent` is white. In dark mode `--on-accent` is a dark ink, so the chip darkens where the preview's literal white would lighten it. The owner should confirm which one is intended (compare `ChatBubble-playbook-draft-dark.png`).
2. **Unlabelled dollar figures (ChatBubble, Charter, StreamingLog).** The ChatBubble preview's dry run ends `≈$0.60` and the Charter preview's first playbook ends `≈$0.08/run`, both without "at API rates". The StreamingLog preview's header shows `≈$0.11`, and its README lists "tokens and cost" in the header, both unlabelled. The Charter README and D24 say a dollar figure is only ever an estimate labelled "≈ at API rates", so all three were built with the label, in one form: `≈$x at API rates`, with `/day` or `/run` after the amount where the figure is a rate.
3. **Charter shape picker.** The Charter preview draws an inline shape `radiogroup` (seven silhouettes) in the action row. The README says only "a shape picker", and Avatar silhouettes belong to the Team screen's picker dialog (item 14). It was built as a "Shape" button that calls `onPickShape`.
4. **ChatBubble avatar on user turns.** The README says "A chat turn is a 24px avatar…". The preview's user turn has no avatar (`.turn.user{grid-template-columns:1fr}`). It was built per the preview: user turns carry no avatar.
5. **EventCard icons.** The README names a Lucide icon per kind. The preview draws only the session (terminal), memory (file), playbook (plus) and approval icons. For the README's "people" icon (agent created/renamed) and its "check" icon (hook applied/verified), the component uses Lucide's own `users` and `check` paths in the same 14px `currentColor` stroke style. Neither icon is in `preview.html`.
6. **DiffView counts.** The preview's file header says `+9 −1`, but its visible rows show 6 additions and 1 deletion. The component counts from the hunks it is given, so the same diff reads `+6 −1` (see `DiffView-hook-change-*.png`).
7. **StreamingLog pill hint.** The preview's pill reads "Following · press ↑ to pause". The README says only that the pill reads "Following" and becomes "Jump to latest" when the user scrolls up. It was built per the README, so the "press ↑ to pause" hint is dropped. The StreamingLog gallery adds an "Append 50 lines" harness state that exists only for the AC4 check.

## Other findings and follow-ups

- **One dollar label form across components.** ChatBubble, Charter and StreamingLog each take a numeric `costEstimate` (USD) and render it with two decimals as `≈$x at API rates`: ChatBubble `≈$0.60 at API rates`, Charter `≈$2.40/day at API rates` and `≈$0.08/run at API rates`, StreamingLog `≈$0.11 at API rates`. A non-finite number renders no estimate.
- **Primitives are slots for now.** Avatar (item 09), Badge, Button, StatusDot and Dialog (item 08) were built in sibling lanes and were absent at this item's base commit. So ChatBubble and Charter take the avatar as a `ReactNode` slot (the dashed circle in the shots is a gallery placeholder), and StreamingLog takes its status indicator as a slot (a gallery stand-in dot). DiffView draws its own scope label, and actions are native `<button>`s styled in each component's CSS. Swapping the primitives in is a screen-item follow-up (items 13–16). StreamingLog's Kill calls `onKillRequest`, and its confirmation dialog is the Sessions screen's (item 16).
- **EventCard subjects are buttons, not links.** The README says each event "links to the thing it names". The subject is built as a native `button` calling `onOpen(target)`, so no `href` is ever built from kernel text (AC2).
- **Unit tests read `<Name>.css` from disk.** Under vitest, `import css from "./<Name>.css?raw"` returns an empty string, so the AC8/AC9 CSS-file assertions read the file from disk instead, through `process.getBuiltinModule("node:fs")` and `import.meta.dirname` with a local minimal `NodeFs` type, so `app/tsconfig.json` gets no Node types and the renderer program never sees Node globals. The root fix is a `test.css` setting in `app/vite.config.ts`, which is item 01's file and was not changed here.
