The desktop app for Wright, an always-available partner that owns your work queue. Loomwright is the craft; Loomwright Studio is the workshop; Wright is the master who directs the crew. The UI exists to make a deterministic kernel legible: what is running, what is waiting on you, what it will do before it does it. Target bar: Linear and Raycast. Platform: macOS only, in an Electron shell that must not look like one.

## Voice and content

- **Wright speaks in the first person, plainly.** "I found three PRs where you're the requested reviewer." Never "Wright has found". No exclamation marks, no emoji, no praise of the user.
- **Say what will happen, then what happened.** A button says "Enable playbook"; its toast says "Playbook enabled". An approval shows the exact payload (the review text, the hook diff, the message) before Allow is possible.
- **The four kernel states are the only status words:** `idle`, `working`, `waiting on you`, `paused at cap`. Use them verbatim in the menu bar, badges and the sidebar. Never invent a fifth ("thinking", "busy").
- **Honest status.** Nothing turns `ok` (green) unless the kernel verified it. A PR shows "CI green" only after the kernel read the check; a hook shows "verified to fire" only after the firing check. Until then it is `ink-tertiary` text, not a colour.
- **Names.** The app is "Loomwright Studio"; the lead agent is "Wright"; the toolkit is "Loomwright". Keep them strict so Wright and Loomwright are never confused. Specialists carry the names the user gave them (Mason, Ada, …). Attribution reads "Wright, powered by Claude". Never "Claude Code", and nothing that looks like it.
- **Errors say what went wrong and the next step.** "Couldn't reach the kernel. It may be restarting; this window reconnects on its own." No apologies.
- **Sentence case** everywhere, including titles and buttons. Uppercase only in `label`.
- **Numbers are tabular** (`font-variant-numeric: tabular-nums`) wherever they sit in a column: tokens, cost, times.

## Colour

Cool slate neutrals with an indigo accent, the colour of dyed warp thread. Light is the primary theme. Dark is drawn separately: surfaces lift by a step (`surface` above `ground`, `surface-raised` above that) rather than by inverting.

- Paint the window `ground`; panels, cards and rows `surface`; anything that floats `surface-raised` with `shadow-2` or `shadow-3`.
- Text: `ink` for subjects, `ink-secondary` for descriptions, `ink-tertiary` for meta. All three hold 4.5:1 on `ground`, `surface` and `surface-sunken` in both themes.
- Separate with `hairline`. Use `border` only where the edge carries meaning (inputs, outline buttons, unchecked controls): it holds 3:1.
- `accent` is the only brand colour and it does one job at a time: the primary action, the selected item, the focus ring, the working dot. A screen never has two primary buttons.
- Semantic colours are separate from the accent and each maps to one kernel state or one verified outcome: `ok` (verified good), `attention` (waiting on you), `danger` (failed, denied, killed, the kill switch), `parked` (paused at cap). `working` is an alias of `accent`; `idle` is an alias of `ink-tertiary`.
- Every status carries a word or a glyph as well as a colour. `ok` and `danger` differ in lightness, not only hue, and `attention` is amber so it never competes with `danger`.
- Text on an `accent` fill is `on-accent`, which is dark in the dark theme. Never literal white.
- The focus ring is `focus`, 2px solid with a 2px offset, on every focusable element, in both themes. It is never removed.

## Type

The system font: SF Pro through `-apple-system`, SF Mono through `ui-monospace`. No web fonts. Sizes follow macOS controls, so `body` is 13px and everything else scales from it.

- `body` for lists, tables, buttons, inputs and sidebar items. `body-strong` for the row subject.
- `chat` (14px) for chat bubbles and playbook intents: read, not scanned.
- `title-1` in the title bar, `title-2` on cards and dialogs, `display` once per empty screen.
- `caption` in `ink-tertiary` for timestamps and counts; `label` uppercase in `ink-tertiary` for group headers.
- `mono` for logs, diffs, dedupe keys, paths and exact payloads; `kbd` inside a kbd chip.
- Headings get `text-wrap: balance`. Running text stays under 65 characters.

## Spacing, radius, elevation

A 4px grid. Rows are `row-height` (28px); standalone controls `control-height` (32px). Card padding `space-4`; dialog and inspector padding `space-5`; the main column `space-6`.

Radii are small: `radius-sm` on controls, `radius-md` on cards and bubbles, `radius-lg` only on floating surfaces and dialogs, `radius-full` on dots and avatars. Elevation is borders first; shadows only on what floats, and every shadow includes a 1px ring.

## Layout

The window is three columns: a vibrancy **sidebar** (`sidebar-width`, `sidebar` tint over `backdrop-filter: blur(24px) saturate(1.4)`), the **main** column on `ground`, and an optional **inspector** (`inspector-width`) on `surface`. The **title bar** is `titlebar-height` with the traffic lights inset (Electron `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: {x: 16, y: 18}`) and is fully draggable. Windows restore their last position and size.

The sidebar is two groups. First the screens: **Chat** (always your thread with Wright), **Team** (configure the crew), **Approvals** (count pill in `attention` when something is waiting), **Sessions**. Then **Crew**: one row per specialist, each its own thread, with presence (see below). Wright never appears under Crew, so there is exactly one place to talk to each agent. The selected item is `accent-soft` with `accent` text.

## Presence and the transcript

An agent is a persistent teammate, so the interface answers three questions wherever an agent appears: who is this, what is it doing, and how much do I need to know.

- **Who:** the Avatar carries identity (silhouette and hue) and never changes colour with state.
- **What:** the Avatar's expression and motion carry the kernel state; hovering shows the current action; a Crew row's second line shows the last thing that happened in that thread, or "Waiting on you · …" when the agent needs you.
- **How much:** three levels, each one click deeper: the menu-bar icon (state and count), the Sessions screen (live log, Stop and Kill), the Approvals inbox (the exact payload).

A thread is a timeline, not only a conversation. Everything the kernel did on the user's behalf appears in the relevant thread as an EventCard line (session started, playbook created, memory updated with the file path, approval decided, hook verified), and an agent's pending approval appears inline at the end of its thread so the user can decide without leaving it. Structured objects (a drafted playbook, a Charter, a diff) render as cards inside the reply that produced them, never as prose.

## Limits on the subscription

The personal build runs on a Claude subscription (D15), so the kernel cannot meter dollars. Limits are tokens per day and sessions at once, per agent, set in the charter; the kernel parks an agent at its daily limit and parks everything at the weekly cap (D17). Show tokens as the primary figure everywhere (cards, inspector, sessions, menu bar); show dollars only as "≈ at API rates", and never as a control. On an API-key build the same fields become real spend.

## Keyboard

Every action is reachable without the mouse.

- `⌘K` opens the palette from anywhere. `⌘1`…`⌘5` switch screens. `⌘,` Settings.
- `↑ ↓` or `J K` move in lists; `Enter` opens; `Esc` closes or clears.
- In Approvals: `A` allow once, `⇧A` always for this playbook, `D` deny, with the shortcut shown on the button.
- In Sessions: `⌘.` stops the focused session. Kill is never a single key: it opens a confirm dialog.
- `⌘⇧K` is the kill switch from anywhere and always confirms.
- Shortcuts are shown as kbd chips in menus, tooltips and the palette.

## Motion

Native controls, not a web page. `duration-instant` for hover and focus, `duration-fast` for toggles and toasts leaving, `duration-base` for popovers and toasts arriving, `duration-slow` for the palette, dialogs and the inspector. Curves: `ease-standard`, `ease-enter`, `ease-exit`; the palette alone uses `ease-palette`.

- **Streaming never animates.** Log lines and chat tokens append with no transition and no layout shift; the container reserves height and pins to the bottom until the user scrolls up.
- **New approvals never shift layout.** They arrive at the top of the inbox with a `duration-base` fade; the list below does not move until the user acts.
- The `working` dot breathes on `duration-pulse`.
- **Avatars are the one place the UI has character.** The body is the actor: it breathes and glances when idle, bobs and squints when working, squashes then hops when waiting on you, sinks when paused, spins once when done, shudders once when killed (see Avatar). Idle clocks are staggered per agent. Nothing else in the app bounces.
- Under `prefers-reduced-motion`: every duration becomes 0 except opacity fades, which cap at `duration-instant`; the working dot is static; avatars hold their expressions with no motion; the palette uses `ease-enter`.

## States

Every screen designs four states; none is left as a default.

- **Empty**: a `display` line in `ink`, one `body` line in `ink-secondary`, one primary action. Chat: "Ask Wright anything, or tell it a duty." Approvals: "Nothing waiting on you."
- **Loading**: skeleton rows on `surface-sunken` at `row-height`, never a spinner in a list. A spinner (16px, `accent`) appears only inside a button that is doing something.
- **Error**: a `danger-soft` band with `danger` text, the cause, and the next step. Kernel unreachable is a persistent band at the top of the main column, not a toast.
- **Waiting on you**: an `attention-soft` band or badge with the count and the shortcut to act.

## Iconography

Lucide, 16px at 1.5px stroke in rows and buttons, 14px inside badges, 20px in empty states, always `currentColor`. Agents are never icons or initials: they are Avatars (a sea creature stitched from thread in their own hue, D23), so a status dot is never placed next to one. The menu-bar icon is a macOS template image (monochrome, 18pt): a hollow ring for idle, a filled circle for working, a filled circle with a count for waiting on you, a paused circle for paused at cap. There is no logo yet; the name is set in plain type. Nothing in the icon set or the menu bar may resemble Claude Code's marks.

## Accessibility

WCAG 2.1 AA in both themes. Every control has a visible label or `aria-label`; every status dot has text; live regions announce new approvals and session state changes politely. Streaming logs are `aria-live="off"` with a manual "Read latest" action so screen readers are not flooded. The palette is a proper combobox. Nothing depends on hover.
