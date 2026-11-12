# Chat 1 — Chat shows when Wright is working, with a clear working mark, and where an Ask or change reply lands

**As** the owner of Loomwright Studio,
**I want** the chat to show plainly when Wright is working, even while an approval waits on me, and to take me to Wright's answer after I use a card's Ask or change,
**so that** I never wonder whether my message was received or where the reply went.

## Why

Found on 2026-11-12 during phase 8 item 19a's Validation 2 walk, in the packaged app built from `main`:

1. **A pending approval hides "working" in the title row.** The owner sent Wright two messages from approval 27's card. The sidebar footer said "working" while Wright replied, but the "with Wright" chip stayed on "waiting on you" the whole time. Cause: `agentAvatarState` in `app/src/screens/chat/model.ts` (around line 98) checks pending approvals before `sessions_running`, and `Thread.tsx` builds the chip from it with `chipFor(agentAvatarState(entry, approvals))`. While any approval from Wright is pending, the chip can never say "working".
2. **The working mark is too faint.** Today's `working` StatusDot is an 8px dot that breathes from scale 1 to 0.85. Beside a word, it reads as still. With motion off it is a filled dot, the same shape as "waiting on you" in another colour.
3. **An Ask or change reply is out of sight.** `CharterAsk.tsx` posts the text as a Reply in the thread where Wright drafted the charter. The only trace is the grey line "Sent to Wright in “…”. Wright answers there; …". That thread sits above the pending cards, and a 10-duty card is several screens tall. The owner could not find the message or Wright's two replies (brain_messages 93 and 94) without help.

## The working mark: "the hoop sews" (decided with the owner, 2026-11-12)

The owner asked for the mark to come from the avatar's own circle and to be nothing generic. It is the avatar's stitched hoop (`.stitch` in `app/src/components/Avatar/Avatar.css`) with no creature in it, sewing. The owner reviewed it in a mock, `2026-11-12-121226-working-mark-mock.html` (in the owner's checkout only; the metadata branch carries Markdown alone). The spec below is complete and authoritative.

- **Shape:** an inline SVG, 14×14 (viewBox `0 0 16 16`), group `rotate(-90 8 8)` so the first stitch sits at 12 o'clock.
  - **The hoop:** `circle cx=8 cy=8 r=5.6 pathLength=40`, no fill, stroke `--working`, width 1.8, round caps, `stroke-dasharray: 2.6 2.4` (8 stitches), `stroke-dashoffset: 1.3`, opacity 0.8.
  - **The stitch being laid:** the same circle drawn again, width 2.1, round caps.
- **Motion, one beat every 1.1s** (`cubic-bezier(.6,0,.15,1)`, infinite):
  - The laid stitch is pulled in from nothing at the top: `stroke-dasharray` goes from `0 40` to `2.6 37.4` over the first 40%, in `--ink` (bright).
  - Then the whole hoop steps round by exactly one stitch, `stroke-dashoffset` 1.3 → −3.7 between 45% and 100%. The laid stitch moves with it and settles to `--working` at opacity 0.8.
  - The dash period is 5 of 40, so −3.7 draws the same picture as 1.3, and the loop has no seam.
  - It moves in beats, like cloth under a sewing machine, never a smooth spin. That is what keeps it from reading as a loading spinner.
- **Motion off** (`prefers-reduced-motion`): no animation. The stitched hoop is drawn with its top stitch in `--ink`. No other state has stitches: idle is a plain ring, waiting on you a solid amber dot, paused at cap a dot with a bar.
- **Where:** it replaces the `working` form of `StatusDot` everywhere, because StatusDot is "the same mark everywhere so the user learns it once":
  - the chat title row, the thread's "<name> is working on it" line and the sidebar footer;
  - Sessions, Tasks, Playbooks and the menu-bar panel.
  - `hideLabel` keeps the word as the mark's `aria-label`. The other states' dots keep their 8px size, centred in the same 14px slot, so the words line up across states. The menu-bar tray glyph (`app/electron/tray-glyph.ts`) and Avatars are unchanged.
- **Rejected along the way, so the implementer does not drift back:**
  - Today's breathing dot is too faint.
  - Radial fading ticks read as the stock activity spinner.
  - A hoop with a hanging thread and knot read as a magnifying glass, and with the thread at the top right as the ♂ sign; a circle with any tail drifts toward a common symbol.
  - Typing dots and a smooth spinner are generic.
- **Words do not change.** The four kernel state words stay verbatim (`idle`, `working`, `waiting on you`, `paused at cap`). There is no "thinking" or "busy".

## Acceptance Criteria

**Happy path:**
- [ ] AC1: Given Wright has a session running and no approval pending, then the "with Wright" title row shows the sewing hoop and the word "working".
- [ ] AC2: Given Wright has a session running and N approvals from Wright pending, then the title row shows the sewing hoop, "working", and the meta "· N waiting on you" (StatusDot's `meta`). It never shows "waiting on you" alone while a Wright session runs.
- [ ] AC3: Given no Wright session is running and N approvals from Wright are pending, then the title row shows "waiting on you" with the meta "· N", as today.
- [ ] AC4: Given the `working` StatusDot anywhere in the app, then it renders the sewing hoop as specified above. It steps one stitch per 1.1s beat, keeps the 6px gap to its word, and does not change the line's height. The other states' marks sit centred in the same 14px slot.
- [ ] AC5: Given I send from a card's Ask or change (or its workspace question), then the card's confirmation line includes a link, "Go to the reply", that scrolls the chat to my Reply in the drafting thread and gives it a brief highlight. The link keeps working after the card re-renders.
- [ ] AC6: Given Wright's answer to that Reply arrives, then the card shows "Wright answered · View", which scrolls to the answer. Until the answer arrives, the line says "Wright is working on it".

**Edge cases:**
- [ ] AC7: Given `prefers-reduced-motion`, then the hoop is still, with its top stitch in `--ink`, and still differs in shape from every other state. The Reply highlight is an opacity fade capped at `duration-instant`.
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
- 2026-11-12: the working mark is "the hoop sews", made from the avatar's stitched hoop as specified above. The owner rejected a generic mark and asked for the avatar's circle; this was fixed in the 19a follow-up conversation and passed to this requirement.
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
