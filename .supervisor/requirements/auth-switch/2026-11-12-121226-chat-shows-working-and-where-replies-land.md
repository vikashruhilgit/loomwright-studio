# Chat 1 — Chat shows when Wright is working, with a clear working mark, and where an Ask or change reply lands

**As** the owner of Loomwright Studio,
**I want** the chat to show plainly when Wright is working, even while an approval waits on me, and to take me to Wright's answer after I use a card's Ask or change,
**so that** I never wonder whether my message was received or where the reply went.

## Why

Found on 2026-11-12 during phase 8 item 19a's Validation 2 walk, in the packaged app built from `main`:

1. **A pending approval hides "working" in the title row.** The owner sent Wright two messages from approval 27's card. The sidebar footer said "working" while Wright replied, but the "with Wright" chip stayed on "waiting on you" the whole time. Cause: `agentAvatarState` in `app/src/screens/chat/model.ts` (around line 98) checks pending approvals before `sessions_running`, and `Thread.tsx` builds the chip from it with `chipFor(agentAvatarState(entry, approvals))`. While any approval from Wright is pending, the chip can never say "working".
2. **The working mark is too faint.** Today's `working` StatusDot is an 8px dot that breathes from scale 1 to 0.85. Beside a word, it reads as still. With motion off it is a filled dot, the same shape as "waiting on you" in another colour.
3. **An Ask or change reply is out of sight.** `CharterAsk.tsx` posts the text as a Reply in the thread where Wright drafted the charter. The only trace is the grey line "Sent to Wright in “…”. Wright answers there; …". That thread sits above the pending cards, and a 10-duty card is several screens tall. The owner could not find the message or Wright's two replies (brain_messages 93 and 94) without help.

## The working mark: "two rings sliding through" (decided with the owner, 2026-11-12)

After several rounds the owner chose this one. Their direction was to use circles: two rings of the same kind that overlap and move, with their colours switching. They compared four combinations (both solid or both stitched, sliding or orbiting) and picked **both solid, sliding through**. The reference is the mock `2026-11-12-121226-working-mark-mock.html`, which is in the owner's checkout only because the metadata branch carries Markdown alone. The spec below is complete and authoritative.

**What it shows:** two smooth rings of the same size.
- They slide across each other and back: apart, through each other, apart on the opposite sides, and back.
- Each time they cross, they swap colours. The accent ring becomes ink and the ink ring becomes the accent, with a short blend at the crossing.

**Shape:** an inline SVG, 16×16, viewBox `0 0 16 16`, `shape-rendering: geometricPrecision`, two circles, no fill:
- **Ring B** (drawn first, underneath): `circle cx=8 cy=8 r=4.4`, stroke width 1.4.
- **Ring A** (drawn on top): the same circle.

**Motion:** one cycle of 2.4s, infinite. Each ring runs two animations on the same cycle:
- **Slide**, `cubic-bezier(.65,0,.35,1)`:
  - Ring A goes `translateX(-2px)` → `translateX(2px)` at 50% → `translateX(-2px)` at 100%.
  - Ring B does the opposite (+2px → −2px → +2px).
  - The rings are exactly on top of each other at 25% and 75%.
- **Swap**, linear:
  - Ring A is `--working` from 0% to 20%, blends to `--ink` by 30%, holds to 70%, and blends back to `--working` by 80%, holding to 100%.
  - Ring B is the inverse: `--ink`, then `--working` from 30% to 70%, then `--ink`.
  - The blends are centred on the crossings at 25% and 75%.

**Motion off** (`prefers-reduced-motion`): no animation. The rings sit overlapped, Ring A at `translateX(-1.6px)` in `--working` and Ring B at `translateX(1.6px)` in `--ink`. No other state looks like this: idle is a single plain ring, waiting on you a solid amber dot, paused at cap a dot with a bar.

**Where:** it replaces the `working` form of `StatusDot` everywhere, because StatusDot is "the same mark everywhere so the user learns it once":
- the chat title row, the thread's "<name> is working on it" line and the sidebar footer;
- Sessions, Tasks, Playbooks and the menu-bar panel.

`hideLabel` keeps the word as the mark's `aria-label`. The other states' 8px dots sit centred in the same 16px slot, so the words line up across states. The menu-bar tray glyph (`app/electron/tray-glyph.ts`) and Avatars are unchanged.

**Shown and not chosen, so the implementer does not drift back:**
- Today's breathing dot (too faint).
- Radial fading ticks (the stock spinner).
- A hoop with a hanging thread (read as a magnifying glass or the ♂ sign).
- Typing dots and a smooth spinner (generic).
- The sewing-hoop and drawing-hoop animations.
- A stitched ring with a solid ring.
- Two stitched rings.
- Two orbiting rings.

**Words do not change.** The four kernel state words stay verbatim (`idle`, `working`, `waiting on you`, `paused at cap`). There is no "thinking" or "busy".

## Acceptance Criteria

**Happy path:**
- [ ] AC1: Given Wright has a session running and no approval pending, then the "with Wright" title row shows the two sliding rings and the word "working".
- [ ] AC2: Given Wright has a session running and N approvals from Wright pending, then the title row shows the two sliding rings, "working", and the meta "· N waiting on you" (StatusDot's `meta`). It never shows "waiting on you" alone while a Wright session runs.
- [ ] AC3: Given no Wright session is running and N approvals from Wright are pending, then the title row shows "waiting on you" with the meta "· N", as today.
- [ ] AC4: Given the `working` StatusDot anywhere in the app, then it renders the two rings as specified above: they slide through each other and back, swapping colours at each crossing, in a 2.4s cycle. It keeps the 6px gap to its word and does not change the line's height. The other states' marks sit centred in the same 16px slot.
- [ ] AC5: Given I send from a card's Ask or change (or its workspace question), then the card's confirmation line includes a link, "Go to the reply", that scrolls the chat to my Reply in the drafting thread and gives it a brief highlight. The link keeps working after the card re-renders.
- [ ] AC6: Given Wright's answer to that Reply arrives, then the card shows "Wright answered · View", which scrolls to the answer. Until the answer arrives, the line says "Wright is working on it".

**Edge cases:**
- [ ] AC7: Given `prefers-reduced-motion`, then the two rings are still, overlapped (accent left, ink right), and still differ in shape from every other state. The Reply highlight is an opacity fade capped at `duration-instant`.
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
- 2026-11-12: the working mark is "two rings sliding through", as specified above. The owner directed it (two circles of the same kind, overlapping and moving, the colours switching) and chose option 1 of four in the 19a follow-up conversation.
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
- StatusDot is used on 15 screens and components. A layout change in the mark (a 16px slot instead of 8px) can wrap a tight row. Check the menu-bar panel and the sidebar footer at their narrowest.
- Snapshot or DOM tests that assert the `.status-dot[data-state="working"]` element: keep `data-state="working"` on the new mark so selectors hold.

## Validation (must pass before merge)
1. **Static, app tests:** `cd app && npm run typecheck && npm test`. Unit tests cover the chip for AC1–AC3 and AC9 (running and pending, pending only, neither), StatusDot's working form (the two-ring SVG present, `data-state="working"`, no animation under reduced motion), and CharterAsk's link and answered line (AC5, AC6, AC8, AC10).
2. **Static, e2e:** `app/e2e/chat-charter-card.spec.ts` covers Ask or change, then "Go to the reply" scrolling to the Reply, then "Wright answered · View" once the fixture replies.
3. **Running system, the owner's app:** in the packaged app with the kernel as the installed service, with an approval from Wright pending, send Wright a message. The title row shows the two sliding rings and "working · 1 waiting on you" while Wright replies, then "waiting on you · 1". From a charter card's Ask or change, send a change, use "Go to the reply", and see Wright's answer. Record screenshots and a `Verdict: PASS for Validation 3` line in `docs/evidence/chat-working-mark-and-reply-link.md`.

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
