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
| Integrations mockup (phase 6): the Integrations screen, the Connect GitHub sheet, every state in light and dark, clickable | `docs/design/mockups/integrations.html` | One HTML file, no build. Its token block is the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging the PR that adds it (D9). Screenshots and the token audit: [evidence](evidence/phase-6-integrations-mockup/README.md) |

The artefact links are private to the owner; the repo copies are the reviewable record. When the design system changes, update the artefact first, then re-copy here in the same commit.

## What the review changed (and why)

1. **Crew members are general-purpose, defined by a charter** (D22). The first mockup offered role presets (Reviewer, Builder, Researcher), which contradicted D3. A crew member is now created from a charter: identity, persona, duties, tools, boundaries, model, limits, plus the first playbook's dry run. Wright drafts it from a sentence in Chat, or the user fills it in from Team → New crew member. The charter is `memory/<agent>/role.md`.
2. **Sidebar: Chat is Wright; Crew is one thread per specialist** (D25). Team is where agents are configured. A group-of-threads layout was tried and reverted at the owner's request.
3. **Avatars are sea creatures stitched from thread; Wright is the crowned whale** (D23). Four directions were reviewed: a blob with eyes (rejected as indistinguishable from Grok Bot), spools and a shuttle, and the creatures. The thread end carries the state; see the Avatar component.
4. **Limits are tokens, not dollars** (D24). On the subscription the kernel cannot meter money; the charter, Team cards, inspector, sessions and menu bar show tokens per day and sessions at once, with dollars only as "≈ at API rates".
5. **Presence and a heterogeneous transcript.** Crew rows show the last line and time; threads carry EventCard lines for everything the kernel did (session started, playbook created, memory updated with its path, approval decided); an agent's pending approval appears inline at the end of its thread with Allow / Always / Deny.
6. **Tools have their own picker** with a one-line purpose, connection state and Connect; not-connected tools may be chosen, and the agent's playbooks park until the connector exists.
7. **Card layout rules** learned from a real bug: `auto-fill` grid with equal rows; roles wrap to two lines instead of truncating at one, and anything longer ends in an ellipsis with the full role in the tooltip and the inspector; the budget meter is the only divider.

## What the mockups commit phase 5 to

- Window: 240px vibrancy sidebar, 52px title bar with inset traffic lights, a 320px inspector on Team, and a 360px list pane on Approvals and Sessions; the column layout is specified in `design/brand-book.md` §Layout, and every width is a token in `design/tokens.json`.
- Every action reachable by keyboard: `⌘K` palette, `⌘1–4`, `J/K`, `A ⇧A D` on approvals, `⌘.` stop, `⌘⇧K` kill switch (always confirms).
- Every screen has designed empty, loading, error (kernel unreachable band) and waiting-on-you states; the mockup's review strip forces each.
- Streaming never animates and never shifts layout; new approvals arrive without moving the list.
- Honest status: `ok` only after the kernel verified; "proposed" on every value Wright chose (D4).
- Avatars: the phase 5 implementation must hit the gestures in the Avatar component (a small spring library is acceptable; the design specifies the gestures, not the library).

## Phase 6: Integrations

The Integrations screen moved from GUI v2 to phase 6 by the owner's 2026-10-24 decision. ROADMAP's phase 6 row takes precedence over every GUI v2 listing that still names the screen: ROADMAP's own phase 7 row; `UI.md`, which keeps it under GUI v2 until phase 6 item 01 (the phase 6 foundation) adds its note there; and the toast `design/mockups/gui-v1.html` shows for an unconnected tool, "Integrations is GUI v2." This file's "Not in v1" list below no longer names it. Phase 6 builds the screen with GitHub as its only connector, and later phases add the other connectors. As D9 requires, the mockup comes before any screen code: `design/mockups/integrations.html`, with its screenshots in [the evidence folder](evidence/phase-6-integrations-mockup/README.md). Open it in a browser and use the review strip, or force a view with the URL hash (`#view=connected&theme=dark`).

### What the mockup commits phase 6 item 11 (the Integrations screen) to

- **Place and layout:** Integrations is the fifth sidebar screen, after Sessions, on `⌘5`. Its main column splits into a list pane (`list-pane-width`) and a detail pane, as Approvals and Sessions do. The list holds only GitHub in phase 6, then a quiet line: "More connectors come later. Studio works with none connected." It has no placeholder entries.
- **Detail pane:**
  - A header row with the GitHub label (name and mark in `ink`), a `read-only` badge, Replace token, and Disconnect.
  - Status: the StatusDot, the word, and the verification time.
  - Account login.
  - Token: fine-grained, kept in the Keychain item `loomwright-studio-github`. The value is never shown.
  - Expiry, with the days left.
  - Each permission the kernel read, with its level.
  - The reachable repos, with Refresh and the rule that a poll trigger can name only these.
  - The agents holding the grant (`connectors: ["github"]`), as agent Cards without Team's budget block. The agents without the grant are named in a caption, and the grant itself is set in Team.
- **The Connect GitHub sheet** (Dialog, 480px variant):
  - It says what token to create: fine-grained, "Only select repositories" limited to personal repos, and Pull requests and Contents each Read-only.
  - It has a link-out to GitHub's token page, a password field, and Connect.
  - Its copy says the token is kept in the Keychain and never shown again, and that the field clears the moment you press Connect.
  - There is no OAuth button and no "use gh login" option.
  - Replacing a connected or expiring token uses the same sheet, and the current token stays in use until the new one passes the check. Replacing an expired token says only that the new one replaces it once it passes, since nothing uses the expired one.
- **Refusals render inline in the sheet**, under the field in Input's error state.
  - `token_invalid` says what to check.
  - `token_write_scoped` names each permission to change, in the form "Pull requests: Read and write → set to Read-only".
  - The field is already cleared, so Connect stays unavailable until a new or changed token is pasted.
- **Every state is designed, and the review strip and URL hash force each:**
  - **Not connected:** an `idle` ring. The detail pane shows the empty state: a `display` line, one `body` line, and one primary action, Connect GitHub.
  - **Connecting:** a `working` dot. The sheet's Connect shows Button's loading spinner with `aria-busy`, and the field is disabled and already empty.
  - **Connected:** `ok`, shown only after the kernel verified the token, with the time it did.
  - **Token rejected:** two variants, invalid and write-scoped, as above.
  - **Expiring:** an `attention` dot, band and badge from 14 days before expiry. The 14 days is a design proposal the owner can change on this PR. Replace token becomes the primary action.
  - **Expired:** a `danger` dot and band that names the parked playbooks. Replace token is the primary action.
  - **Kernel unreachable:** the shared band at the top of the main column. The status reads "unknown" with no dot (honest status), and the last-read data stays visible with its time. Replace token, Disconnect and Refresh are disabled.
- **Disconnect always confirms** (Dialog, `alertdialog`). It says that the token is deleted from the Keychain, which playbooks park (for an expired token, which stay parked, since they already are), and that grants are kept.
- **Keyboard:** `⌘5` (`⌃5` in a browser tab) opens the screen. `⌘K` offers three commands:
  - Connect GitHub.
  - Disconnect GitHub, which goes through its confirm.
  - Show reachable repos, which moves focus to the repos section.

  A command that can't run in the current state stays listed but disabled, with the reason. `Esc` closes, focus is trapped in a dialog, and it returns to where it came from: the control that opened the dialog or the palette, or the same control once the screen re-renders. When that control no longer exists (Connect GitHub after a connect succeeds, Disconnect after a disconnect), focus goes to the GitHub row, never to the page itself.
- **Branding (invariant 7):** GitHub's name and mark appear only as the connector's label, in `ink`, with no GitHub colours or styling. The palette footer reads "Wright, powered by Claude".
- **Components and tokens:** the mockup uses List, Card, Badge, StatusDot, Dialog and Input, plus Button, CommandPalette and Avatar as they already are. It adds no component and no token. The evidence README lists every value outside `tokens.json`.

### Open points for the owner (on this PR)

- Phase 6 item 11's requirement (the Integrations screen) names the third palette command "Refresh reachable repos". The phase 6 job brief and this mockup use "Show reachable repos" in the palette, with Refresh as a button in the repos section. Pick one name for phase 6 item 11.
- The expiry warning starts at 14 days, a proposal that matches phase 6 item 03's planned 14-day expiry notice (the GitHub connector, not built yet).

## Not in v1 (deferred to GUI v2 or later)

Field-level playbook editing, memory file viewing, a group thread with several agents, and any tool connectors beyond GitHub and Loomwright.
