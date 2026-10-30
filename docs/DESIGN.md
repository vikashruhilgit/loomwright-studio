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
| Integrations mockup (phase 6): the Integrations screen, the Connect GitHub sheet, every state in light and dark, clickable | `docs/design/mockups/integrations.html` | One HTML file, no build. Its token block is the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging the PR that adds it (D9). Screenshots and the token audit: [evidence](evidence/phase-6-integrations-mockup/README.md). The GitHub App views (D36) are in the same file: [evidence](evidence/github-app-mockup/README.md) |
| GUI v2 mockup (phase 7): Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit, Settings and the Integrations token-to-App path, every state in light and dark, clickable | `docs/design/mockups/gui-v2.html` | One HTML file, no build. Its token block is the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging the PR that adds it (D9). Screenshots, the token audit and the field map: [evidence](evidence/gui-v2-mockup/README.md). What it commits items 03–09 to: [Phase 7: GUI v2](#phase-7-gui-v2) |

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

The Integrations screen moved from GUI v2 to phase 6 by the owner's 2026-10-24 decision. ROADMAP's phase 6 row takes precedence over every GUI v2 listing that still names the screen: ROADMAP's own phase 7 row; `UI.md`, which keeps it under GUI v2 until phase 6 item 01 (the phase 6 foundation) adds its note there; and the toast `design/mockups/gui-v1.html` shows for an unconnected tool, "Integrations is GUI v2." This file's "Not in v1" list below no longer names it. Phase 6 builds the screen with GitHub as its only connector, and later phases add the other connectors. As D9 requires, the mockup comes before any screen code: `design/mockups/integrations.html`, with its screenshots in [the evidence folder](evidence/phase-6-integrations-mockup/README.md). Open it in a browser and use the review strip, or force a view with the URL hash (`#view=connected&theme=dark`). Phase 6 item 14 adds the owner's declaration to the sheet and a `connected-declared` view (below).

### What the mockup commits phase 6 item 11 (the Integrations screen) to

- **Place and layout:** Integrations is the fifth sidebar screen, after Sessions, on `⌘5`. Its main column splits into a list pane (`list-pane-width`) and a detail pane, as Approvals and Sessions do. The list holds only GitHub in phase 6, then a quiet line: "More connectors come later. Studio works with none connected." It has no placeholder entries.
- **Detail pane:**
  - A header row with the GitHub label (name and mark in `ink`), a `read-only` badge, Replace token, and Disconnect.
  - Status: the StatusDot, the word, and the verification time.
  - Account login.
  - Token: fine-grained, kept in the Keychain item `loomwright-studio-github`. The value is never shown.
  - Expiry, with the days left.
  - Each permission the kernel read, with its level, when GitHub reported them. When the owner declared the token read-only instead (GitHub reports none for a fine-grained token), the section reads "Read-only, declared by you" with the declaration time and a caption that this is the owner's word, not something Studio checked. It shows no permission list, and no permissions text says "verified" or "read from GitHub". The header badge reads `read-only · declared`, and the status line says only that the account and repos were checked.
  - The reachable repos, with Refresh and the rule that a poll trigger can name only these.
  - The agents holding the grant (`connectors: ["github"]`), as agent Cards without Team's budget block. The agents without the grant are named in a caption, and the grant itself is set in Team.
- **The Connect GitHub sheet** (Dialog, 480px variant):
  - It says what token to create: fine-grained, "Only select repositories" limited to personal repos, and Pull requests and Contents each Read-only.
  - It has a link-out to GitHub's token page, a password field, and Connect.
  - Its copy says the token is kept in the Keychain and never shown again, and that the field clears the moment you press Connect.
  - **A required confirmation, "This is a fine-grained token, and every permission I gave it is Read"** (a checkbox under the token field, with a caption: GitHub doesn't tell Studio what a fine-grained token can do, so Studio keeps this as your word, never as checked). Connect stays disabled until the field holds something and the box is ticked, and Enter in the field does not submit while it is disabled. The request sends `declared_read_only: true`. The box is unticked each time the sheet opens, and ticked (disabled while connecting) in the connecting and refused views. A token whose permissions GitHub does not report and that was sent without the confirmation is refused `token_permissions_unknown`, and the sheet's copy for it points at the confirmation: "GitHub doesn't report what this token can do. Tick the box that says every permission you gave it is Read, then connect again."
  - There is no OAuth button and no "use gh login" option. The GitHub App is a separate choice that comes before this sheet (see "GitHub App connect" below), and it is not a login either.
  - Replacing a connected or expiring token uses the same sheet, and the current token stays in use until the new one passes the check. Replacing an expired token says only that the new one replaces it once it passes, since nothing uses the expired one.
- **Refusals render inline in the sheet**, under the field in Input's error state.
  - `token_invalid` says what to check.
  - `token_write_scoped` names each permission to change, in the form "Pull requests: Read and write → set to Read-only".
  - The field is already cleared, so Connect stays unavailable until a new or changed token is pasted.
- **Every state is designed, and the review strip and URL hash force each:**
  - **Not connected:** an `idle` ring. The detail pane shows the empty state: a `display` line, one `body` line, and one primary action, Connect GitHub.
  - **Connecting:** a `working` dot. The sheet's Connect shows Button's loading spinner with `aria-busy`, and the field is disabled and already empty.
  - **Connected:** `ok`, shown only after the kernel verified the token, with the time it did.
  - **Connected, declared by you** (`#view=connected-declared`): the same, except the permissions section is the owner's declaration ("declared by you", with the time) in place of the checked list, as above. A connect from the sheet always lands here, since a fine-grained token's permissions are never reported.
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
- **Components and tokens:** the mockup uses List, Card, Badge, StatusDot, Dialog and Input, plus Button, CommandPalette and Avatar as they already are. The confirmation is a native checkbox, 16px, in `accent` (no new component, no new token). The evidence README lists every value outside `tokens.json`.

### Open points for the owner (on this PR)

- Phase 6 item 14 (the owner's declaration): the sheet's confirmation wording, its caption, the "declared by you" permissions section and the refusal copy above are proposals. The owner approves them by merging the PR; the app's sheet and connected state use the mockup's copy.
- Phase 6 item 11's requirement (the Integrations screen) names the third palette command "Refresh reachable repos". The phase 6 job brief and this mockup use "Show reachable repos" in the palette, with Refresh as a button in the repos section. Pick one name for phase 6 item 11. (item 11 used 'Refresh reachable repos'; see the evidence README)
- The expiry warning starts at 14 days, a proposal that matches phase 6 item 03's planned 14-day expiry notice (the GitHub connector, not built yet).

### GitHub App connect

D36 adds a GitHub App connect beside the token path; the contract is in [integrations](architecture/integrations.md#github-app-connect). As D9 requires, its screens come before any screen code: `design/mockups/integrations.html` gains the views below, each in light and dark and forced by the URL hash (`#view=app-choice&theme=dark`). The review strip has a second group, "GitHub App view", for them. The ten existing views (`not-connected` to `sheet`) render as before. The screenshots, and the commands that regenerate them, are in [the evidence folder](evidence/github-app-mockup/README.md). The owner approves the mockup by merging the PR that adds it.

| View (`#view=`) | What it shows | Refusal |
|---|---|---|
| `app-choice` | The Connect sheet's choice: "Install GitHub App" (suggested; permissions are checked by GitHub) and "Paste a token" (permissions are declared by you) | |
| `app-setup-create` | Setup in progress, step 1 of 2: waiting for the owner on GitHub to click Create. Cancel and "Open GitHub again" | |
| `app-setup-install` | Step 2 of 2: Create is done, waiting for the owner to pick repos and click Install | |
| `app-connected` | Connected through the App: the App's name and slug, the account, the installation, the repos chosen at install, "Read-only, checked by GitHub" with the permissions GitHub reported, and the access token's expiry shown as "renews automatically" | |
| `app-expired` | Setup timed out: the window closed before GitHub came back | `setup_expired` |
| `app-cancelled` | Setup cancelled, with Set up again | |
| `app-write-scoped` | The App reports a write permission, named in the form "Contents: Read and write → set to Read-only" | `token_write_scoped` |
| `app-revoked` | Status `rejected` (a `danger` dot): the App was uninstalled, its key revoked or the App deleted on GitHub; the parked playbook is named; Set up again is the primary | `rejected` (a status, not a setup refusal) |
| `app-failed` | Setup didn't finish: GitHub did not hand the key over, or the install did not complete | `conversion_failed`, `install_failed` |
| `app-unreachable` | The shared Kernel unreachable band; the status reads "unknown" with no dot; the last-read data stays visible with its time; Disconnect and Refresh are disabled | |
| `app-disconnect` | The Disconnect confirm: what Studio removes (the App's key, from the Keychain) and what only the owner can remove on GitHub (uninstall the App, or delete it), with a link to each page | |

### What the mockup commits the app's Connect sheet to (wave 2)

- **Connect GitHub opens the choice** when nothing is connected, from the empty state's button and from `⌘K`. "Paste a token" opens the token sheet above, unchanged. Replace token on a token connection still opens the token sheet directly. Studio keeps one GitHub connection at a time, so an App connection has no Replace token: `⌘K` lists Connect GitHub disabled with "disconnect first". The one exception is the proposed switch in [Phase 7: GUI v2](#the-token-to-app-switch-a-proposal): while it runs, the token stays in use until the App connects, so the two exist together for those minutes and never after.
- **The setup dialog** (Dialog, 480px) says the two clicks on GitHub are the owner's and that Studio receives the key itself, lists the two steps with StatusDots (`working` for the step the owner is on, `ok` and a "done" Badge for a finished one, `idle` for the next), says what the App asks for, and shows when the window closes. Cancel, `Esc` and a click on the backdrop all cancel the setup, since the one window must not be left open, and land on the cancelled view. "Open GitHub again" reopens github.com.
- **A connected App's detail pane** is the token's, with these differences: a `GitHub App` Badge beside `read-only`; rows for the App, the installation and the key (kept in the Keychain, never shown); the access token's expiry with a "renews automatically" Badge in place of the days left (no expiry band, since the owner does nothing); permissions read "Read-only, checked by GitHub" with the list GitHub reported, never "declared by you"; the repos section reads "Repos chosen at install" and says a poll trigger can name only these. There is no Replace token. Disconnect always confirms.
- **Refusals and failures render in the same dialog** as setup, in `danger` text as the token sheet's refusals do, each with Close and "Set up again" (primary), and with "Paste a token instead" where a token is a way out. The expired, cancelled and write-scoped views link to the owner's GitHub Apps page, since an App the owner already created stays on their account until they delete it.
- **`rejected`** is the status row's word, as for a token. The detail pane keeps the last-read permissions and repos with their time, and Disconnect still confirms.
- **Branding (invariant 7):** the same as the sheet above. GitHub's name and mark appear only as the connector's label, in `ink`, with no GitHub colours. The App choice uses a shield icon and the token a key, both Lucide, in `ink`. The mockup adds no raw colour value and leaves its token block as the generator wrote it; the evidence README repeats both checks.
- **Components:** Dialog, Card (the two options; the suggested one has an `accent` edge), Badge, StatusDot, Input's error text, Button, List and the Band. No new component and no new token.

### Open points for the owner (GitHub App, on this PR)

- All the copy above is a proposal the owner can change on this PR, as with the token sheet.
- The setup window closes 10 minutes after it opens (the mockup shows 14:12 for a 14:02 start). The length is the kernel setup item's call; 10 minutes is a proposal.
- Studio keeps one GitHub connection at a time. This point is replaced by a proposal in [Phase 7: GUI v2](#the-token-to-app-switch-a-proposal): a token connection gets a "Switch to GitHub App" control, so it no longer needs Disconnect first. Going from the App back to a token still disconnects first.
- The expired and cancelled copy says an App the owner already created stays on GitHub until they delete it, and does not say whether setting up again creates a new App or reuses that one. The write-scoped copy says only "set it up again". Both depend on the kernel setup item.
- The kernel's other two setup refusals, `setup_not_open` and `state_mismatch`, are answered to the browser tab, so the mockup shows no app state for them. If the app item finds one needs a screen, it adds it with the owner's approval.
- The empty state's body line still reads "a token you create", since the existing views are unchanged. The app item should widen it to both ways when it builds the choice.
- The mockup does not name the Keychain item that holds the App's key; the kernel tokens item does.

## Phase 7: GUI v2

Phase 7 builds six screens (Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit and Settings) and a polish pass on Integrations. As D9 requires, the mockup comes before any screen code: `design/mockups/gui-v2.html`, one HTML file with every screen and every designed state, in light and dark. Its screenshots, its token audit and the map from every field to a kernel column or route are in [the evidence folder](evidence/gui-v2-mockup/README.md). Open the file in a browser and use the review strip, or force a view with the URL hash (`#view=tasks-waiting&theme=dark`). The owner approves the design by merging the PR that adds it. Its token block is the verbatim output of `node app/scripts/tokens.mjs`. The mockup adds no route and no code: items 03–09 build the screens to it, and each adds the routes it reads.

Two owner decisions (2026-10-30) shape it:

- **Hooks moved to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback), and `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts`). Phase 7 has no Hooks screen and the mockup draws none. `UI.md` gets the same note from phase 7 item 01.
- **Tasks shows today's kernel data.** Tasks, playbook runs and sessions, grouped by state, with a click-through to their history and their session log. Linked PRs and tickets, approvals counts and CI state join in phase 8, so the mockup shows none of them.

Each screen has an empty, a loading, a populated, an error and a `Kernel unreachable` view, and a waiting-on-you view where it applies. The error view is a route failure: a card inside the screen's body that says which request failed, distinct from the shared band, which means the kernel itself is unreachable. Tasks, Playbooks, Budget & audit and Settings have a waiting-on-you view. Schedules & triggers and Memory have none, and [the evidence](evidence/gui-v2-mockup/README.md#screens-without-a-waiting-on-you-view) says why.

### What the mockup commits items 03–09 to

- **Shell (every item):** the GUI v1 window (240px sidebar, 52px title bar, 320px inspector, 360px list pane, all tokens), its `Kernel unreachable` band, and `integrations.html`'s URL-hash state hook (`#view=<view>&theme=<light|dark|system>`, its own-keys-only view lookup and its fall-back to the default view on an odd hash). The sidebar lists Chat, Team, Approvals, Sessions and Integrations, a rule, then Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit and Settings. Every action is reachable by keyboard: `Esc` closes, focus is trapped in a dialog and returns to the control that opened it (to a stable row when that control is gone), and `J`/`K` move between cards, rows and files. A stale read stays visible with "last known" while the band shows, and every control that needs the kernel is disabled.
- **Keyboard map (every item):** `⌘5` Integrations (unchanged), `⌘6` Tasks, `⌘7` Playbooks, `⌘8` Schedules & triggers, `⌘9` Memory, `⌘,` Settings, Budget & audit by `⌘K` only. In a browser tab `⌃` replaces `⌘`, as in GUI v1. `?` opens a keyboard map that lists every shortcut and every palette command by screen. This is a proposal (open point 5).
- **Tasks (item 03):**
  - A board of four columns: Waiting on you, Working, Parked, Done today. A card is one of three kinds (task, playbook run, session) and shows its kind, id, a state Badge, its title and who it is for. A session or a run is its own card only when no task owns it.
  - A card opens a click-through: the item's facts, its history as EventCards, and its session log (StreamingLog, with `live` or `kept`).
  - A card that waits on you has an `attention` edge. The empty state is "No tasks yet." with one action, Ask Wright.
  - It shows no linked PRs, approvals counts or CI state.
- **Playbooks (item 04):**
  - A Table of intent, trigger, dedupe key, priority, model, mode, last run, tokens today against the limit (dollars only as "≈ at API rates", D24) and an on/off switch.
  - A detail page shows who set each policy field ("set by you", "proposed by Wright"), the trigger, recent runs and tokens, with Edit in English (opens Wright's thread with the playbook named), Edit fields and Version history.
  - Field-level edit shows a live diff and saves as the next version through `POST /playbooks/:id/set`. Save stays off while a field holds a value the kernel would refuse, and each refused field shows its reason in `danger` under it: an empty name or intent, a dedupe key naming a field outside the kernel's closed set of seven or listing a field twice (each key field is listed once), or a token limit that is not a whole number above 0, of at most 16 digits and within the safe-integer range. Item 04 shows the kernel's own refusal text when the route answers with one. Version history is read-only: going back writes a new version.
  - A change makes an enabled playbook a draft again, as the kernel does, and the page says so.
- **Schedules & triggers (item 05):**
  - A timeline of upcoming wake-ups, polls and cron fires, with a list of the triggers and an on/off switch for each.
  - A firing history that keeps each missed fire's reason (`missed_paused`, `missed_kill_switch`, `rate_limited`, `connector_missing`, `source_error`), filterable to the fires that did not happen.
  - A missed poll caused by a missing connector points to Integrations; the screen holds no action of its own.
- **Memory (item 06):**
  - A per-agent tree (role, preferences, people, lessons) and shared memory; a file view with its path, size, modified time and content hash; an edit with a live diff and Save.
  - **Changed since you opened it:** a save is checked against the hash it was opened at. When the file changed, nothing is overwritten. The screen shows the file on disk beside the owner's edit and the diff between them, with four ways out: see who wrote it in the audit log, Discard my edit, Copy my version, and Edit on top of the current version (which carries over the lines the owner added, not the ones removed).
  - Only files under `memory/` can be edited here; the settings the kernel enforces live in `config/agents/<id>.json`, which Team owns.
- **Budget & audit (item 07):**
  - Tokens counted per day (cache reads shown, never counted); per agent against its daily limit and its sessions at once; per playbook against its daily limit; the subscription cap windows with their reset times. Every limit is in tokens or sessions at once, and a dollar figure is only "≈ at API rates" (D24).
  - A meter turns `attention` only at the limit, and an agent at its limit is the waiting-on-you view.
  - The audit log is the full event log, newest first, with Kind, Agent, Playbook and Time range filters, 8 rows a page and a note that it is append-only. The palette opens it, and "Show refused starts" opens it already filtered.
- **Settings (item 08):**
  - The auth provider is read-only: the provider, the account, its health, the token's creation and life, and the Keychain item that holds it (never the value). The terminal commands that change it are the three the app already shows (`claude setup-token`, `security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w`, `studio service install`), each with Copy. There is no secret field, no OAuth button and no sign-in of any kind (invariant 6).
  - Then the kernel's data location, the notifier in use and the Loomwright install (read-only), and the app's own settings: launch at login, notifications and theme. Those three live in the app, never in the kernel's store.
- **Integrations (item 09):** polish only. The one change is the token-to-App switch below. Every other Integrations view is approved in `integrations.html` and unchanged.
- **Components and tokens:** List, Card, Badge, StatusDot, Dialog, Input, Toast, DiffView, StreamingLog, EventCard and Avatar, plus Button, CommandPalette and Table, as the design system defines them. The mockup adds no token. It adds the classes and values the [evidence README](evidence/gui-v2-mockup/README.md#token-audit) names and justifies one by one, and it names where it departs from a component README (open point 13).
- **Branding (invariant 7):** "Wright, powered by Claude" appears only as the palette's attribution. Nothing says or looks like the Claude command-line tool.

### The token-to-App switch (a proposal)

Today a token connection's detail offers Replace token and Disconnect, so moving to the GitHub App means pressing Disconnect first (the owner had to on 2026-10-30). The mockup proposes one added control, "Switch to GitHub App", on the token-connected detail. The owner approves it on this PR, as with the rest of the mockup. It replaces the earlier "disconnects first" open point under "GitHub App connect", and it qualifies the "one GitHub connection at a time" line there.

- **The token stays in use until the App connects.** The switch opens the existing App setup dialog over the token connection. While it runs, GitHub stays connected through the token and the row reads "connected · token · setting up the App".
- **A cancel, `Esc` or a failed setup leaves the token connected.** The failed view says nothing changed.
- **When the install succeeds,** the connection becomes the App's and the token's Keychain item is removed (the view "App connected, token gone").
- **Going from the App back to a token** still disconnects first, and an App connection still has no Replace token.
- The interim state maps to the existing `connectors` row: `method` stays `token` until the install succeeds, so no column and no migration is new ([the field map](evidence/gui-v2-mockup/README.md#integrations-the-proposed-token-to-app-path)). The kernel already supports this; item 09 builds the control.

### Open points for the owner (on this PR)

The mockup's copy and layout are proposals the owner can change on this PR, as with the earlier mockups. These need a decision, or an owner's word that the proposal stands:

1. **`tasks.state` is free text** (`kernel_task_create`: "the kernel defines no states"). The four columns are the screen's grouping, and the mockup shows no "other" column. Either the kernel closes the set, or the screen maps the words it knows and shows the rest somewhere.
2. **Memory shows four files per agent plus `shared/`.** `handoffs/` and the playbook mirrors are not shown. Say whether they should be.
3. **`memory_updated` is not an event the kernel writes today** ([open questions](OPEN_QUESTIONS.md)). Item 06 plans one for the owner's own writes. The audit log shows one for Mason's lesson and the conflict's "See who wrote it in the audit log" depends on it, so until an agent's write is recorded too, a write by an agent leaves nothing to find. Decide whether the kernel tracks memory writes by agents, or the button and the row go.
4. **`studio auth …` is not a command.** The phase 7 requirement names it in Settings' copy, and the only commands that exist are the three above. The mockup shows those three. A real `studio auth` is a later decision.
5. **The keymap is a proposal:** `⌘6`–`⌘9` for Tasks, Playbooks, Schedules & triggers and Memory, `⌘,` for Settings, and Budget & audit by `⌘K` only (no digit).
6. **Field-level edit shows eight fields; the owner's write route takes five.** `POST /playbooks/:id/set` takes `dedupe_key`, `priority`, `model`, `token_limit` and `mode`. Name, intent and effort have no owner write route today, and `mode: live` is refused in phase 6. Item 04 adds a write for the three, or the edit shows them read-only.
7. **A saved edit makes an enabled playbook a draft again** (the kernel's rule: a changed playbook is reviewed before it runs). The mockup says so. Say whether that is right for an owner's one-field edit.
8. **The On switch.** Only turning a playbook off has an owner route. Turning a draft or disabled playbook on is Wright's request plus the owner's approval, so item 04 decides what the switch does when it is off.
9. **The token-to-App switch** is the proposal above. It replaces the "disconnects first" point.
10. **A trigger has no name.** A trigger shows its playbook's name, or its action's text when it has none (Friday wrap-up, Rotate the sandbox token). A wake-up's firing history has no route in item 05's plan.
11. **The audit log needs two derivations.** The existing `GET /events` omits `actor`, and `events` has no agent or playbook column, so item 07's `GET /audit` returns the actor and derives the Agent and Playbook filters from the session or the payload.
12. **The App's display name** is not a `connectors` column (only `app_slug`). The approved App views already show it, and this mockup copies them.
13. **Departures from component READMEs:** the switch is 32×18 (Table README: 26×16); the usage meter is 4px (Card README: 3px) and turns `attention` only at the limit (Card README: from 80%); table cells wrap (Table README: truncate); a toast stays 4s in the mock (Toast README: 6s). Say which side moves.

## Not in v1 (deferred to GUI v2 or later)

A group thread with several agents, and any tool connectors beyond GitHub and Loomwright. The playbook and memory work this list used to carry is designed in Phase 7: GUI v2, above.
