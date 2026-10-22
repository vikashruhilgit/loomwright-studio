# Chat and Crew threads: polish-gate evidence (phase 5, item 13)

Screenshots of every designed Chat state, in light and dark, taken from the built app (`app/dist`, `app/dist-electron`) running against the fixture kernel (`app/e2e/fixture-kernel.ts` with the canned data in `app/e2e/fixtures/chat.ts`). Each window is hidden (`app/e2e/electron-harness.ts`) and resized to 1180×1500 CSS px so the whole populated thread fits in one image. The default window is 1180×760.

## Screenshots

| State | Light | Dark | Matches in `docs/design/mockups/gui-v1.html` |
|---|---|---|---|
| Empty: Wright's thread with no items | `chat-empty-light.png` | `chat-empty-dark.png` | `renderChat`, `empty && isW` branch (the copy is the brief's: "Ask Wright anything. It drafts playbooks and crew for you to approve.") |
| Loading: the thread read has not answered | `chat-loading-light.png` | `chat-loading-dark.png` | `renderChat`, `S.force.loading` branch (three skeleton rows) |
| Error: the kernel-unreachable band above the screen's error state | `chat-error-light.png` | `chat-error-dark.png` | `bands('chat')` plus `renderChat` with the thread unavailable |
| Waiting on you: a pending approval inline at the end | `chat-waiting-light.png` | `chat-waiting-dark.png` | `renderChat`, `inlineApprovals(a)` |
| Populated: messages, event lines, a playbook card (with its trigger), a fired trigger's card, a parked row, an approval and a charter card | `chat-populated-light.png` | `chat-populated-dark.png` | `renderChat` thread with `turnHTML` (`t.ev` lines, `t.draft` and `t.charter` cards) and `inlineApprovals(a)` |
| Crew thread: Pim's thread, with a quoted delegation from Wright, the workspace picker, and Pim selected under Crew | `chat-crew-thread-light.png` | `chat-crew-thread-dark.png` | `renderChat` with `S.chatWith` a specialist, and `#crewnav` with that row `sel` |

## How to regenerate

```sh
cd app
npm ci
node node_modules/electron/install.js   # once, if the Electron binary is missing
npm run build
npx playwright test e2e/chat.spec.ts --workers=1
```

The test "every designed state is screenshot in light and dark" deletes every PNG in this folder, then writes the 12 above. The test "the evidence README lists every screenshot, and nothing else" fails if this table and the files drift apart. The loading state comes from a loopback proxy in the spec that holds `GET /threads/wright` open and passes everything else, including the feed's upgrade, through to the fixture.

## Owner findings

These are gaps this item could not close inside its own files. The brief's rule applies: a missing route or field is a finding, never a patch.

### Feasibility gaps

- **(a) No route serves a playbook's last dry run.** `playbook_dry_run` is not in the kernel's `THREAD_EVENT_KINDS` (`kernel/src/console/threads.ts`), and `PlaybookDetailResponse` has no dry-run field. The playbook card reads "Last dry run: not available from the kernel yet". Candidate fix: add `playbook_dry_run` to the thread's kinds, or add a `last_dry_run` field to `GET /playbooks/:ref`.
- **(b) A parked message's retry time exists only inside `detail` text** (`admission_refused: <reason>; retry at <ISO>` or `retry time unknown`, written in `kernel/src/brain/handler.ts`). The screen parses it with one regex anchored at the end of the string (`app/src/screens/chat/model.ts`, `parseRetryAt`). Any other wording reads as "retry time unknown". Candidate fix: a typed `retry_at` field on the message row.
- **(c) `EventCard`'s approval variant always renders Always**, with no prop to hide it, and the app sees only part of the kernel's `alwaysRefusal` conditions. The screen treats an approval as eligible for Always only when `approval.playbook !== null`. For an ineligible approval, Always calls no route and shows "Always needs an approval from a playbook session; approve once". A kernel `409 always_not_supported` shows the kernel's `message`. Candidate fix: an `alwaysEligible` prop on `EventCard` (item 10's file).
- **(d) `CommandPaletteHost` is not mounted in `App.tsx`.** Chat registers its ⌘K commands into the app's registry from the always-mounted Crew section, and unit tests pin them through an injected registry. Until the shell mounts the palette, no keystroke reaches them. The e2e does not drive ⌘K. Candidate fix: mount the palette in the shell (item 01 / 17).

### Other findings

- **The shell lets `.main` grow with its content.** `.window`'s single grid row is `auto` and `.main` has no `min-height: 0`, so `.content` never becomes a scroll container: a long thread pushed the composer below the window. `chat.css` scopes a fix to Chat with `:has()` (`.main:has(.chat)` and `.content:has(> .chat)`), so the thread scrolls and the composer stays in view. The proper fix is `min-height: 0` (or `grid-template-rows: 100%`) in `app/src/styles/app.css`, which this item may not edit.
- **The `Notifications` palette group is not in `GROUP_ORDER`** (`app/src/components/CommandPalette/fuzzy.ts`, item 11). The palette sorts an unknown group after the known ones, so notification commands show last. Add it to the list if it should sort elsewhere.
- **A palette command cannot confirm a past `once` trigger.** "Turn on trigger <id>: …" posts `{}`. On `409 needs_confirmation`, the Crew section's status line shows the kernel's message and points to the trigger's card in Chat, which asks the owner once and resends `{confirm: true}`. The palette has no confirm step of its own.
- **Paging and the live first page.** "Load earlier" prepends older pages, and the live store keeps refetching only the first page (`GET /threads/:agent` with no cursor, 50 items). Once older pages are loaded, a single new item pushes the oldest item of that page out of it, and that item is in neither the live page nor the older pages. The screen keeps every item that leaves the live page next to the older pages (`Thread.tsx`), so nothing drops out of view. The limit: a kept item is the copy last read, so a row that slid off while `queued` or `running` keeps showing that status until the thread is reopened. No route returns items newer than a cursor, or one message row by id. Candidate fix: an `after` cursor on `GET /threads/:agent`.
- **`EventCard`'s approval buttons take no `loading` prop** (item 10's file). The approval card drops a second Allow once, Always or Deny while the first is in flight, but it cannot show the pending action as busy the way the other cards' `Button`s do. Candidate fix: a `busy` prop on the approval variant.

### Mockup and component mismatches

- **Crew rows are buttons, not `List`'s crew rows.** `List` renders crew rows as `role="option"` in a listbox with a roving tabindex. The brief needs each row as a button, the mockup's `#crewnav` has buttons too, and the `App.test.tsx` and `smoke.spec.ts` pins count sidebar buttons. So the rows are buttons styled to List's crew metrics: 44px row, 24px avatar, unread dot, tabular time, ellipsised last line. They reuse List's `CREW_EMPTY_TEXT`.
- **Crew row accessible names start with the agent's name.** The mockup labels a row "Chat with Pim". The screen labels it "Pim" (", unread" when unread), because `smoke.spec.ts` finds the Chat entry with `/^Chat/` and the row must never match it.
- **Event lines use the whole kernel summary as `EventCard`'s subject.** `EventCard` expects a sentence split into `before`, a linked `subject` and `after`. The kernel sends one escaped sentence (`summary`), and parsing it would mean interpreting kernel text. So the whole sentence is the subject button, which opens the screen for its kind: Sessions, Team, Approvals, or Chat for playbook lines.
- **The charter card is not the `Charter` component.** `Charter` takes structured fields (persona, duties, tools, limits). The approval carries only `display` text, which the brief says to show preformatted and never parse. The card shows `display` in mono with Create, Edit in English and Deny.
- **The playbook card is not `ChatBubble`'s draft card.** The mockup and `ChatBubble`'s `draft` put an Enable button on the drafted playbook. In the kernel, enabling is an approval, so the card has no Enable action: Run now, Turn off and Set only. It also shows the policy fields the kernel serves, each marked "proposed" (set by Wright) or "set by owner". The draft card's rows (name, action, approval) do not map onto `Playbook`.
- **No streaming reply and no Stop.** The mockup streams the reply and turns Send into Stop. The kernel's message row goes `queued` → `running` → `replied`, with no partial text, so the screen shows "Wright is working on it" until `replied`.
- **No suggestion chips on the empty state.** The mockup's empty states offer canned prompts. The brief gives Wright's empty copy only, and canned prompts would be preset behaviour (invariant 1), so there are none.
- **The composer reuses `Composer`'s markup and CSS, not the component.** `Composer` keeps its own blank-text guard. The screen needs its guard in the handler that posts `POST /ask`, and that handler keeps the text on a refusal. So it renders the same `.composer` / `.composer-input` markup with the Send `Button`.
