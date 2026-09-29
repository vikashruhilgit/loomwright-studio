# Design (phase 0 outcome)

Phase 0 is done: the owner approved the design system and the GUI v1 mockups on 2026-09-28 after three review rounds. This file records where the approved artefacts live, what the review changed, and what the mockups commit us to. Decisions taken during the review are D22–D25 in `DECISIONS.md`.

## Approved artefacts

| Artefact | Where | Notes |
|---|---|---|
| Design system (tokens, brand book, 16 components with live previews) | https://claude.ai/artifact/CR6rcJB17wFroMmtsXyRfd (private) | Source of truth for tokens and component rules. Sources mirrored under `docs/design/` |
| GUI v1 mockups (menu bar, Chat, Team, Approvals, Sessions), clickable | https://claude.ai/artifact/1Kw9eisGsAnUekWyStnmEc (private) | One HTML file, no build. Source: `docs/design/mockups/gui-v1.html` |
| Tokens | `docs/design/tokens.json` | Colour (light + dark), type, spacing, radius, shadow, duration, easing |
| Brand book | `docs/design/brand-book.md` | Voice, colour, type, layout, keyboard, motion, states, presence, limits |
| Component guidelines and previews | `docs/design/design-system/components/` | One folder per component: `README.md` + `preview.html` |
| Avatar system | `docs/design/avatar/avatar.css`, `avatar.js` | The stitched sea creatures and their motion, as used by the mockup |

The artefact links are private to the owner; the repo copies are the reviewable record. When the design system changes, update the artefact first, then re-copy here in the same commit.

## What the review changed (and why)

1. **Crew members are general-purpose, defined by a charter** (D22). The first mockup offered role presets (Reviewer, Builder, Researcher), which contradicted D3. A crew member is now created from a charter: identity, persona, duties, tools, boundaries, model, limits, plus the first playbook's dry run. Wright drafts it from a sentence in Chat, or the user fills it in from Team → New crew member. The charter is `memory/<agent>/role.md`.
2. **Sidebar: Chat is Wright; Crew is one thread per specialist** (D25). Team is where agents are configured. A group-of-threads layout was tried and reverted at the owner's request.
3. **Avatars are sea creatures stitched from thread; Wright is the crowned whale** (D23). Four directions were reviewed: a blob with eyes (rejected as indistinguishable from Grok Bot), spools and a shuttle, and the creatures. The thread end carries the state; see the Avatar component.
4. **Limits are tokens, not dollars** (D24). On the subscription the kernel cannot meter money; the charter, Team cards, inspector, sessions and menu bar show tokens per day and sessions at once, with dollars only as "≈ at API rates".
5. **Presence and a heterogeneous transcript.** Crew rows show the last line and time; threads carry EventCard lines for everything the kernel did (session started, playbook created, memory updated with its path, approval decided); an agent's pending approval appears inline at the end of its thread with Allow / Always / Deny.
6. **Tools have their own picker** with a one-line purpose, connection state and Connect; not-connected tools may be chosen, and the agent's playbooks park until the connector exists.
7. **Card layout rules** learned from a real bug: `auto-fill` grid with equal rows; roles wrap to two lines, never truncate; the budget meter is the only divider.

## What the mockups commit phase 5 to

- Window: 240px vibrancy sidebar, 52px title bar with inset traffic lights, a 320px inspector on Team, and a 360px list pane on Approvals and Sessions; the column layout is specified in `design/brand-book.md` §Layout, and every width is a token in `design/tokens.json`.
- Every action reachable by keyboard: `⌘K` palette, `⌘1–4`, `J/K`, `A ⇧A D` on approvals, `⌘.` stop, `⌘⇧K` kill switch (always confirms).
- Every screen has designed empty, loading, error (kernel unreachable band) and waiting-on-you states; the mockup's review strip forces each.
- Streaming never animates and never shifts layout; new approvals arrive without moving the list.
- Honest status: `ok` only after the kernel verified; "proposed" on every value Wright chose (D4).
- Avatars: the phase 5 implementation must hit the gestures in the Avatar component (a small spring library is acceptable; the design specifies the gestures, not the library).

## Not in v1 (deferred to GUI v2 or later)

Field-level playbook editing, the Integrations screen (connect a tool), memory file viewing, a group thread with several agents, and any tool connectors beyond GitHub and Loomwright.
