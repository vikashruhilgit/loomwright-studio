# Chat 1 — Chat shows when Wright is working, with a clear working mark, and where an Ask or change reply lands

**As** the owner of Loomwright Studio,
**I want** the chat to show plainly when Wright is working, even while an approval waits on me, and to take me to Wright's answer after I use a card's Ask or change,
**so that** I never wonder whether my message was received or where the reply went.

## Why

Found on 2026-11-12 during phase 8 item 19a's Validation 2 walk, in the packaged app built from `main`:

1. **A pending approval hides "working" in the title row.** The owner sent Wright two messages from approval 27's card. The sidebar footer said "working" while Wright replied, but the "with Wright" chip stayed on "waiting on you" the whole time. Cause: `agentAvatarState` in `app/src/screens/chat/model.ts` (around line 98) checks pending approvals before `sessions_running`, and `Thread.tsx` builds the chip from it with `chipFor(agentAvatarState(entry, approvals))`. While any approval from Wright is pending, the chip can never say "working".
2. **The working mark is too faint.** Today's `working` StatusDot is an 8px dot that breathes from scale 1 to 0.85. Beside a word, it reads as still. With motion off it is a filled dot, the same shape as "waiting on you" in another colour.
3. **An Ask or change reply is out of sight.** `CharterAsk.tsx` posts the text as a Reply in the thread where Wright drafted the charter. The only trace is the grey line "Sent to Wright in “…”. Wright answers there; …". That thread sits above the pending cards, and a 10-duty card is several screens tall. The owner could not find the message or Wright's two replies (brain_messages 93 and 94) without help.

## The working mark: "the thread sews the hoop" (decided with the owner, 2026-11-12)

The owner asked for the mark to come from the avatar's own circle and to be nothing generic. They compared five takes on the hoop, chose this one ("the thread draws the hoop") and asked for it to be tuned. The tuned version is in a mock, `2026-11-12-121226-working-mark-mock.html`, which is in the owner's checkout only because the metadata branch carries Markdown alone. The spec below is complete and authoritative.

**What it shows:** the avatar's stitched hoop (`.stitch` in `app/src/components/Avatar/Avatar.css`), **drawn** while the agent works.
- A needle draws the hoop as one continuous line from 12 o'clock. The stitches come out of the line right behind it, the freshest brightest, and the lap eases in and out like a hand drawing a circle.
- At the top it ties the knot: a soft swell and a small cinch.
- It then laps again, pulling the thread out behind it, so it arrives back at the top empty and starts drawing again without a break.
- A faint hoop stays underneath throughout.
- The owner asked for exactly this: "I want to see it feel like it's drawing". The line must stay attached to the needle at every frame.

**Shape:** an inline SVG, 14×14, viewBox `0 0 16 16`, `shape-rendering: geometricPrecision`. Ids come from React's `useId()`, so every instance has its own masks.
- **Masks:** two masks, `maskUnits="userSpaceOnUse" x=-2 y=-2 w=20 h=20`.
  - The reveal mask holds `circle.reveal cx=8 cy=8 r=5.6 pathLength=100`, stroke white, width 4, `stroke-dasharray: 100 100`.
  - The trail mask holds `circle.trail`, the same circle with `stroke-dasharray: 0 100` at rest.
  - The mask circles are **not rotated**. Mask content is drawn in the masked group's space, which is already rotated. Rotating both draws the line from 9 o'clock.
- **Group `.cinch`** (transform-origin `8px 8px`) contains:
  - **Ghost:** `circle cx=8 cy=8 r=5.6`, no fill, stroke `--working`, width 1.2, opacity 0.16, never animated.
  - **A group `rotate(-90 8 8)`**, so drawing starts at 12 o'clock and runs clockwise, containing:
    - **under the reveal mask:** the running **thread**, the circle with `pathLength=100`, stroke `--working`, width 0.7, opacity 0.75; and the **stitches**, the same circle, stroke `--working`, width 1.8, round caps, `stroke-dasharray: 7.5 5`, `stroke-dashoffset: -2.5` (8 stitches);
    - **under the trail mask:** the **fresh** stitches, the same dashes in `--ink`.
- **Needle**, outside `.cinch`: `circle r=1.15`, fill `--ink`, `offset-path: path("M8 2.4A5.6 5.6 0 1 1 7.99 2.4")`, `offset-rotate: 0deg`.

**Motion:** one cycle of 3.2s, infinite. Percentages are of the cycle. The lap curve is `cubic-bezier(.55,.06,.42,.96)`, written **literally** in every keyframe that uses it: a CSS variable there is ignored for `offset-distance`, and the needle then runs ahead of its line.
- **Draw, 0–45%, lap curve:**
  - The needle's `offset-distance` goes 0% → 100%.
  - `.reveal`'s `stroke-dashoffset` goes 100 → 0 on the same keyframes and curve, so the line ends exactly at the needle.
  - `.trail`: from 0% to 8% (lap curve), `stroke-dasharray` goes `0 100` → `14 86` and `stroke-dashoffset` 0 → −4. From 8% to 45% (lap curve), `stroke-dashoffset` goes −4 → −86. At 52% it is `0 100`, offset −100.
- **Tie, 45–55%** (`cubic-bezier(.45,0,.25,1)`): the needle scales 1 → 1.55 at 50%, back to 1 at 55%. `.cinch` scales 1 → 0.93 at 50%, back to 1 by 57%.
- **Pull out, 55–100%, lap curve:**
  - The needle jumps from 100% to 0% at 55.01%. That is the same point on the circle, so nothing visibly moves. It then laps 0% → 100% again.
  - `.reveal`'s `stroke-dashoffset` goes 0 → −100 on the same curve, so the thread disappears exactly behind the needle.
  - The cycle ends empty with the needle at the top, where the next draw begins.

**Motion off** (`prefers-reduced-motion`): no animation. The hoop is shown five-eighths drawn:
- `.reveal` `stroke-dashoffset: 37.5`;
- `.trail` `stroke-dasharray: 12 88`, `stroke-dashoffset: -50.5`;
- the needle at `offset-distance: 62.5%`, at the head of the line.

No other state looks like this: idle is a plain ring, waiting on you a solid amber dot, paused at cap a dot with a bar.

**Where:** it replaces the `working` form of `StatusDot` everywhere, because StatusDot is "the same mark everywhere so the user learns it once":
- the chat title row, the thread's "<name> is working on it" line and the sidebar footer;
- Sessions, Tasks, Playbooks and the menu-bar panel.

`hideLabel` keeps the word as the mark's `aria-label`. The other states' 8px dots sit centred in the same 14px slot, so the words line up across states. The menu-bar tray glyph (`app/electron/tray-glyph.ts`) and Avatars are unchanged.

**Rejected along the way, so the implementer does not drift back:**
- Today's breathing dot is too faint.
- Radial fading ticks read as the stock activity spinner.
- A hoop with a hanging thread and knot read as a magnifying glass, and with the thread at the top right as the ♂ sign.
- Typing dots and a smooth spinner are generic.
- The embroidery double ring, the crowned hoop and the "pulled tight" pulse were shown and not chosen.

**Words do not change.** The four kernel state words stay verbatim (`idle`, `working`, `waiting on you`, `paused at cap`). There is no "thinking" or "busy".

## Acceptance Criteria

**Happy path:**
- [ ] AC1: Given Wright has a session running and no approval pending, then the "with Wright" title row shows the sewing hoop and the word "working".
- [ ] AC2: Given Wright has a session running and N approvals from Wright pending, then the title row shows the sewing hoop, "working", and the meta "· N waiting on you" (StatusDot's `meta`). It never shows "waiting on you" alone while a Wright session runs.
- [ ] AC3: Given no Wright session is running and N approvals from Wright are pending, then the title row shows "waiting on you" with the meta "· N", as today.
- [ ] AC4: Given the `working` StatusDot anywhere in the app, then it renders the sewing hoop as specified above: the needle draws the hoop with the line attached to it, ties the knot, and laps again pulling the thread out, in a 3.2s cycle, with no visible jump. It keeps the 6px gap to its word and does not change the line's height. The other states' marks sit centred in the same 14px slot.
- [ ] AC5: Given I send from a card's Ask or change (or its workspace question), then the card's confirmation line includes a link, "Go to the reply", that scrolls the chat to my Reply in the drafting thread and gives it a brief highlight. The link keeps working after the card re-renders.
- [ ] AC6: Given Wright's answer to that Reply arrives, then the card shows "Wright answered · View", which scrolls to the answer. Until the answer arrives, the line says "Wright is working on it".

**Edge cases:**
- [ ] AC7: Given `prefers-reduced-motion`, then the hoop is still, five-eighths drawn with the needle at the head of the line, and still differs in shape from every other state. The Reply highlight is an opacity fade capped at `duration-instant`.
- [ ] AC8: Given the drafting thread is not loaded (older than the current page), then "Go to the reply" loads it before scrolling. If the thread is gone, the link is replaced by the plain sentence "Wright answers in “<thread title>”".
- [ ] AC9: Given a specialist's thread (not Wright), then AC1–AC3 apply to that agent's title row in the same way.

**Error scenarios:**
- [ ] AC10: Given the Reply fails or is parked (`failed` / `parked`), then the card's line says so in the thread's own words ("Failed: …"), with the link to it, and never says "Wright answered".

**Always:**
- [ ] AC11: The crew avatars' own states (`agentAvatarState` for the Avatar) are unchanged. Only the title-row chip's choice changes. If the chip needs its own function, it is a new one beside `chipFor`, not a change to the avatar rule.
- [ ] AC12: Colour comes only from `tokens.css` custom properties. Nothing looks like Claude Code (invariant 7).

## Non-goals
- The menu-bar tray glyph and Avatars (already distinct; unchanged).
- Moving pending cards or changing the thread layout. AC5–AC6 add a way to reach the reply instead.
- The Settings and auth work in this backlog (Auth 2–4).

## Owner decisions
- 2026-11-12: the working mark is "the thread sews the hoop", made from the avatar's stitched hoop as specified above. The owner rejected a generic mark, asked for the avatar's circle, chose variant B of five and asked for it to be tuned. This was fixed in the 19a follow-up conversation and passed to this requirement.
- 2026-11-12: queue this with the auth-switch backlog; it may run in the same wave, since it shares no file with Auth 2–4.

## Priority: High
**Rationale:** The owner could not tell that Wright was working or where Wright's reply went, during an ordinary approval flow.

## Assumptions
- `Thread.tsx` already knows the running sessions per agent (`entry.sessions_running` from the roster) and the pending approvals, so AC1–AC3 need no new kernel field.
- The Reply's message id is available to `CharterAsk.tsx` from the POST's response. If it is not, the implementer finds it from the thread's newest Reply with the card's approval id in its text.

## Dependencies
- Depends on: none
- Blocks: none

## Risks
- StatusDot is used on 15 screens and components. A layout change in the mark (a 14px slot instead of 8px) can wrap a tight row. Check the menu-bar panel and the sidebar footer at their narrowest.
- Snapshot or DOM tests that assert the `.status-dot[data-state="working"]` element: keep `data-state="working"` on the new mark so selectors hold.

## Validation (must pass before merge)
1. **Static, app tests:** `cd app && npm run typecheck && npm test`. Unit tests cover the chip for AC1–AC3 and AC9 (running and pending, pending only, neither), StatusDot's working form (the hoop SVG present, `data-state="working"`, no animation under reduced motion), and CharterAsk's link and answered line (AC5, AC6, AC8, AC10).
2. **Static, e2e:** `app/e2e/chat-charter-card.spec.ts` covers Ask or change, then "Go to the reply" scrolling to the Reply, then "Wright answered · View" once the fixture replies.
3. **Running system, the owner's app:** in the packaged app with the kernel as the installed service, with an approval from Wright pending, send Wright a message. The title row shows the sewing hoop and "working · 1 waiting on you" while Wright replies, then "waiting on you · 1". From a charter card's Ask or change, send a change, use "Go to the reply", and see Wright's answer. Record screenshots and a `Verdict: PASS for Validation 3` line in `docs/evidence/chat-working-mark-and-reply-link.md`.

## Depends on
none

## Touches
app/src/components/StatusDot
app/src/screens/chat/model.ts
app/src/screens/chat/Thread.tsx
app/src/screens/chat/CharterAsk.tsx
app/src/screens/chat/chat.css
app/src/screens/chat/thread.test.tsx
app/src/screens/chat/model.test.ts
app/e2e/chat-charter-card.spec.ts
docs/design/design-system/components/StatusDot
docs/design/brand-book.md
docs/evidence/chat-working-mark-and-reply-link.md
