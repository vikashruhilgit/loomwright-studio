# Supervisor Job: Draft outputs, poll results and connector changes appear as cards in the agent's thread

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-28-211751/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095112-draft-output-and-poll-cards-in-threads.md
- **Base commit:** a7e454e559d34bc95621ec3e2d4d6a0417b4a83e

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + strict TypeScript renderer (`app/src`), vitest + Testing Library units, Playwright-on-Electron e2e through `app/e2e/electron-harness.ts`. No kernel file is touched (requirement non-goal). |
| 2 | Dependency Availability | GO | Both dependencies are merged on `main`: item 01 lists the four kinds in `THREAD_EVENT_KINDS` (`kernel/src/console/threads.ts`), and item 07 serves `GET /drafts` and `GET /drafts/:id` (`kernel/src/integrations/drafts.ts`), with `DraftOutput` / `DraftsResponse` / `DraftDetailResponse` already in `app/src/api/contract.ts`. Items 04/05 write `poll_item_queued` / `poll_item_skipped`, item 03 writes `connector_status`. No new package. |
| 3 | Architecture Fit | CAUTION | The thread route's event item is `{id, at, kind, summary, ref}` only: a poll item's `ref` is `{playbook_id}` and its `summary` is `Playbook <slug> queued item <ref>` with no revision and no dedupe key. The fields the cards need are in the event's stored payload (`{trigger_id, playbook_id, item_ref, revision, queue_id}` for queued, `{playbook_id, item_ref, item_revision, dedupe_key}` for skipped), which the app already reads as `EventFrame.payload` from `GET /events` (the live store does this for truncated frames). So the requirement's assumption holds (the payloads carry the fields), and the cards read them app-side. No kernel edit. The draft card's ref is `DraftOutput.item_ref` from `GET /drafts`. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 10 source/test files plus 10 evidence PNGs and roughly 1,000 changed lines (cards, grouping, J/K, unit tests, an e2e spec with its fixture and a screenshot README). That is over the `context-bound` bound, so it is split in two serial subtasks. |
| 5 | Hard Blockers | GO | None. Electron denies `window.open` and in-page navigation (`app/electron/main.ts`: `setWindowOpenHandler(() => ({ action: "deny" }))`), so a clickable external PR link cannot open anything without a main-process change. That is out of this item's scope, and the brief shows the link as selectable text (see Risk Assessment). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Render the phase 6 thread event kinds as cards in the Chat/Crew thread: a draft card that expands to the draft's body from `GET /drafts/:id` as inert text, poll cards for queued and skipped PRs (consecutive skips collapse into one card with a count), and a one-line connector card in Wright's thread. All of them are reachable with J/K and expand with Enter.

**Problem Statement:**
The owner needs to read a duty's would-be reviews, and see why an unchanged PR was not reviewed, in the thread where they already talk to the agent.
Today the kernel's thread route returns `draft_output_recorded`, `poll_item_queued`, `poll_item_skipped` and `connector_status` items. The thread renders every one of them as a generic one-line `EventCard` with the kernel's summary: the draft's body cannot be opened, there is no short SHA, no dedupe key, and no collapse, so a five-PR re-poll is five identical lines.
Success looks like this: a draft card says "Draft review for <owner>/<repo>#<n> (not sent)" with a permanent "Draft mode: nothing was posted" label, and expands to the body as inert text. Five consecutive skips read "5 unchanged PRs skipped" and expand to the five refs and the key. J/K and Enter reach and expand every card. The polish-gate screenshots are committed in light and dark.

## Acceptance Criteria

- [ ] **AC1** — Given a thread fixture with one `draft_output_recorded` event (`ref: {session_id, draft_output_id}`) and `GET /drafts?agent=<thread agent>` listing that draft with `item_ref: "github:<owner>/<repo>#<n>"`, then the collapsed draft card reads "Draft review for <owner>/<repo>#<n> (not sent)", shows the PR URL `https://github.com/<owner>/<repo>/pull/<n>` as text, and always shows the label "Draft mode: nothing was posted". When it is expanded (click or Enter on its toggle), then exactly one `GET /drafts/:id` request is made for that id and the card shows the draft's body: `payload.body` for a `gh_pr_review` / `gh_pr_comment` payload, `payload.command` for `command`, and `payload.input_json` for `input`. A refused or failed detail read shows the kernel's words as text and the card stays. A draft missing from the list reads "Draft review (not sent)" with its draft id until the detail answers. An `item_ref` that does not match `^github:([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)#([1-9][0-9]*)$` shows as text with no URL.
- [ ] **AC2** — Given a draft body containing `<script>alert(1)</script>`, a markdown link `[click](https://evil.example)`, `</untrusted-data>`, an ANSI escape (the character U+001B, written in the test source as the JS escape `"\u001b[31m"`) and a bidi control (the character U+202E RIGHT-TO-LEFT OVERRIDE, written in the test source as `"\u202e"`), when the card is expanded, then (pinned in a unit test) the rendered body contains no `script` element and no `a` element, and its text content contains the literal `<script>`, `[click](https://evil.example)` and `</untrusted-data>` strings. The raw U+001B and U+202E characters are absent from the text content: they appear as the visible four-character text `\x1b` and the six-character text `\u202e` (what `printable` writes). The text passes through `printable(text, true)` (`app/src/screens/approvals/printable.ts`) and renders as a React text child, never `dangerouslySetInnerHTML` and never a markdown renderer.
- [ ] **AC3** — Given five consecutive `poll_item_skipped` thread items for one playbook (no other item between them; each payload, read from `GET /events`, has a distinct `item_ref` and an `item_revision`), and that playbook's `dedupe_key_spec` the JSON text `'["item.id","item.revision"]'` (`string | null` on the wire, parsed with type checks only, the way `cards.tsx`'s `dedupeDraft` reads it; a spec that does not parse to a list of strings counts as no spec), then exactly one collapsed card says "5 unchanged PRs skipped". Expanding it lists the five refs, each as "Skipped <ref>: unchanged under key item.id, item.revision". A single skip renders as one line "Skipped <ref>: unchanged under key <fields>". A `poll_item_queued` item renders "Reviewing <ref> @ <first 7 chars of revision>". Two skip runs split by any other item, or skips from two playbooks, are two cards. With no dedupe spec in the playbook list, the key reads as the payload's `dedupe_key` value as text. With no payload (the read failed or the row is gone), the card falls back to the kernel's `summary` line.
- [ ] **AC4** — Given a thread with phase 5 event lines and the phase 6 cards (a draft card, a skip group, a queued line and a `connector_status` line in Wright's thread), when focus is in the thread list (not in a text field), then J moves focus to the next card and K to the previous one in display order. Only J and K move between cards: ↑/↓ keep their native behaviour (scrolling the thread), because `listMove` from `app/src/commands/keyboard.ts` also answers arrows, so the handler acts only when `event.key` is `j`/`k` (no modifier) and then uses `listMove`'s direction. J/K typed in a field stay text (`isEditableTarget`), and a key a nested card handler already took (`event.defaultPrevented`) is left alone. Enter on a draft card's or a skip group's toggle expands it (`aria-expanded` flips to `true`) and again collapses it. This is pinned in a unit test and exercised with real keys in Electron in `app/e2e/chat-integrations.spec.ts`. The `connector_status` card is one line, "Connector github: connected" from the kernel's summary, with its subject linking to `#/integrations`.
- [ ] **AC5** — Given the existing chat suites (`app/src/screens/chat/*.test.tsx`, `app/e2e/chat.spec.ts`), then they pass unchanged, including the Tab-order pin in `keyboard.test.tsx` and the phase 5 screenshot set in `docs/evidence/phase-5-polish/chat/`. A committed evidence file `docs/evidence/phase-6-polish/chat-cards/README.md` lists the polish-gate screenshots written by `app/e2e/chat-integrations.spec.ts` in light and dark: `draft-collapsed`, `draft-expanded`, `draft-long-body`, `skips-collapsed` and `skips-expanded`, each as `chat-cards-<state>-<theme>.png`. A spec test fails if the README and the folder drift apart. The PR body links to the README.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build`; and, to write the evidence, `cd app && npx playwright test e2e/chat-integrations.spec.ts e2e/chat.spec.ts --workers=1`.

## House Rules

> Advisory house rules from `.agent/rules/` (`read-rules.sh --with-ids`), routed to this brief's paths. Subordinate to CLAUDE.md.

- **testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it** (advisory, applies to `app/e2e/*`): E2E specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), which keeps every window hidden. Never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts` enforces it). `app/e2e/chat-integrations.spec.ts` imports `launchApp` the way `chat.spec.ts` does.

## Touched-file invariants

> Grounded at base `a7e454e559d34bc95621ec3e2d4d6a0417b4a83e`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/chat/Thread.tsx`** — keep: one flat keyed list (`{/* One flat keyed list (no Fragment per item), so a card whose newest event moves keeps its state. */}`). Every row is keyed by what it shows, never by position (`key={itemKey(item)}`). A skip group's key is its first skip's `itemKey`, so Load earlier never remounts an open group. Keep every kernel string a text child (`Every kernel string is a React text child only.`). Keep the playbook/trigger card placement (`playbookAt` / `triggerAt`) and the pending-approval rows unchanged. reuse: `refId(item.ref, "draft_output_id")` from `./model` for the draft id, and `isEditableTarget` / `listMove` from `../../commands/keyboard` for J/K (no new key parser). The J/K handler sits on the thread list (`<ol className="chat-items"`), so arrows and J/K in the composer, which sits outside the list, are never taken. Its first lines are `if (event.defaultPrevented) return;` and `if (isEditableTarget(event.target)) return;`, so the nested handlers keep their keys: `EventCard`'s approval keys, `cards.tsx`'s editor Escape (`if (event.key !== "Escape") return;`), and the others. It acts on `j`/`k` only, never on arrows. pinned by: `app/src/screens/chat/keyboard.test.tsx` (`expect(order).toEqual([`, the Tab order, which the J/K handler must not change because it adds no tab stop), `app/src/screens/chat/thread.test.tsx`.
- **`app/src/screens/chat/chat.css`** — keep: existing selectors unchanged. New card styles use the existing card tokens and classes (`.chat-card`, `.chat-card-head`, `.chat-card-meta`) so light and dark both follow the theme. No colour literal: tokens only, as the file does.
- **`app/src/screens/chat/testkit.tsx`** — keep: the existing helper signatures (`export function eventItem(id: number, kind: string, summary: string, ref: unknown = {})`, `export function kit(initial: Partial<KitState> = {}): Kit {`) and the default routes. Add only new helpers (a `draft(...)` row and a `GET /events` / `GET /drafts` responder) whose defaults answer empty, so every existing test sees the same requests and answers.
- **`app/e2e/fixtures/chat.ts`** — keep: `export function chatFixture(scenario: ChatScenario = "populated"): ChatFixture {` and its canned data byte-identical in behaviour. `chat.spec.ts`'s screenshot test deletes and re-lists every PNG in its own folder (`const EVIDENCE_DIR = resolve(APP_DIR, "..", "docs/evidence/phase-5-polish/chat");`), so no phase 6 screenshot is ever written there. The only allowed edit is `export` on existing helpers the new fixture reuses.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/chat/integrationCards.test.tsx` — AC1 "expanding fetches GET /drafts/:id once" | in `app/src/screens/chat/integrationCards.tsx`, render the body from the `GET /drafts` list row instead of issuing the detail read on expand → the detail-request count is 0 and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC1 "Draft mode: nothing was posted" always visible | in `app/src/screens/chat/integrationCards.tsx`, render the label only when expanded → the collapsed assertion goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC2 inert body | in `app/src/screens/chat/integrationCards.tsx`, render the body with `dangerouslySetInnerHTML={{ __html: text }}` instead of a text child → a `script` / `a` element appears and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC2 controls escaped | in `app/src/screens/chat/integrationCards.tsx`, drop the `printable(…, true)` call around the body → the raw U+001B / U+202E characters reach the DOM, the visible `\x1b` / `\u202e` texts are absent, and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC1 non-matching `item_ref` gets no URL (e.g. `github:a/b#1 https://evil.example`) | flip `#([1-9][0-9]*)$/` → `#([1-9][0-9]*)/` in `app/src/screens/chat/integrationCards.tsx` (the `prUrlOf` regex loses its end anchor; a trailing-junk ref then builds a URL and the pin goes red) |
| `app/src/screens/chat/integrationCards.test.tsx` — AC3 two skip runs split by another item, and skips from two playbooks, are two cards | in `app/src/screens/chat/integrationCards.tsx`'s `groupThreadRows`, drop the same-`playbook_id` comparison (or keep folding across a non-skip item) → one card renders where two are expected and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC3 no payload falls back to the kernel `summary` | in `app/src/screens/chat/integrationCards.tsx`, render `Skipped ` with an empty ref instead of the summary when the payload is missing → the summary text is absent and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC4 Enter flips `aria-expanded` | in `app/src/screens/chat/integrationCards.tsx`, hard-code the toggle's `aria-expanded={false}` → after Enter it still reads `false` and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC4 J/K typed in a field stay text | delete `if (isEditableTarget(event.target)) return;` in `app/src/screens/chat/Thread.tsx` → J typed in an open playbook-row editor moves focus and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC4 a key a nested card already handled is left alone | delete `if (event.defaultPrevented) return;` in `app/src/screens/chat/Thread.tsx` → a J the nested handler prevented also moves focus and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC4 ↑/↓ never move between cards | in `app/src/screens/chat/Thread.tsx`, act on every non-zero `listMove(event)` without the `j`/`k` key check → ↓ moves focus and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC3 "5 unchanged PRs skipped" | in `app/src/screens/chat/integrationCards.tsx`'s grouping, stop merging consecutive skips (each skip its own group) → five cards render and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC3 key fields shown | in `app/src/screens/chat/integrationCards.tsx`, omit the key text from the skip line → "unchanged under key item.id, item.revision" is absent and the pin goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC3 queued short SHA | in `app/src/screens/chat/integrationCards.tsx`, show the full revision instead of its first 7 characters → the "@ <7 chars>" assertion goes red |
| `app/src/screens/chat/integrationCards.test.tsx` — AC4 J/K moves focus | in `app/src/screens/chat/Thread.tsx`, delete the thread list's `onKeyDown` J/K handler → focus does not move and the pin goes red |
| `app/e2e/chat-integrations.spec.ts` — AC5 README lists every screenshot | delete `chat-cards-skips-expanded-dark.png` in `docs/evidence/phase-6-polish/chat-cards/README.md` → the README misses a screenshot the spec expects and the README drift test goes red |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Draft, poll and connector cards in the thread, J/K and Enter, unit pins | AC1, AC2, AC3, AC4 (unit), AC5 (existing unit suites green) | 3 modify, 2 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Real-key e2e and polish-gate screenshots in light and dark | AC4 (Electron), AC5 (evidence, `chat.spec.ts` green) | 0–1 modify, 3 create (+10 PNGs) | `skills/playwright-e2e/SKILL.md`, `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |

### Subtask notes

- **Subtask 1.** CREATE `app/src/screens/chat/integrationCards.tsx`. It holds `DraftCard`, `PollQueuedLine`, `SkipGroupCard`, `ConnectorLine`, the pure `groupThreadRows(items)` (it folds consecutive `poll_item_skipped` items with the same `refId(ref, "playbook_id")` into one group row and passes every other item through), `prUrlOf(itemRef)` (the strict regex in AC1; `undefined` otherwise) and `useEventPayloads(api, ids)`. That last hook resolves each event id's `EventFrame.payload` from the live store's `eventLog` when present, else from `GET /events?after=<id-1>&limit=1`, caches per bridge and event id, and reads every field by type only (`typeof x === "string"`), as `refId` does. The draft card reads the list `GET /drafts?agent=<agent>&limit=200` once per thread view for the collapsed ref. On expand it reads `GET /drafts/:id`, at most once per card until the card remounts. Card headers are `button`s with `aria-expanded` and `aria-controls`; each card's first control carries `data-thread-card` so J/K can find it. In `Thread.tsx`, map rows through `groupThreadRows`, render the four kinds with the new components (other kinds keep `EventView`), and add the list's `onKeyDown`: `isEditableTarget(event.target)` returns early, then `listMove(event)` moves focus among `[data-thread-card]` elements and phase 5 event-line subject buttons in DOM order. In `testkit.tsx`, add `draft(...)` and `GET /events` / `GET /drafts` / `GET /drafts/:id` default responders (empty). In `chat.css`, add the card styles. CREATE `app/src/screens/chat/integrationCards.test.tsx` with the AC1–AC4 pins. `cards.tsx` (643) and `cards.test.tsx` (709) are not modified (see Module layout).
- **Subtask 2.** CREATE `app/e2e/fixtures/chat-integrations.ts`. It builds on `chatFixture("populated")`'s options (spread its routes) and adds Wright's thread with a draft event, five consecutive skips, a queued line and a `connector_status` line, the `GET /events`, `GET /drafts` and `GET /drafts/:id` routes, and a long draft body (about 120 lines, with markup and a fake `</untrusted-data>`). CREATE `app/e2e/chat-integrations.spec.ts`. Launch through `launchApp` (house rule). It presses real J/K/Enter keys and asserts focus and `aria-expanded`, then writes the five states × light/dark into `docs/evidence/phase-6-polish/chat-cards/` the way `chat.spec.ts` does (delete only that folder's PNGs first). Add a README-drift test. CREATE `docs/evidence/phase-6-polish/chat-cards/README.md` with the screenshot table, how to regenerate, and an "Owner findings" heading. There is no mockup for these cards, so the README says the gate matches the phase 5 card styles (`EventCard`, `.chat-card`) rather than a mockup frame. Run `e2e/chat.spec.ts` too, to prove AC5's "unchanged".

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/chat/integrationCards.tsx"}
  - {kind: "symbol", path: "app/src/screens/chat/integrationCards.tsx", name: "DraftCard"}
  - {kind: "symbol", path: "app/src/screens/chat/integrationCards.tsx", name: "SkipGroupCard"}
  - {kind: "symbol", path: "app/src/screens/chat/integrationCards.tsx", name: "groupThreadRows"}
  - {kind: "symbol", path: "app/src/screens/chat/integrationCards.tsx", name: "prUrlOf"}
  - {kind: "symbol", path: "app/src/screens/chat/Thread.tsx", name: "data-thread-card"}
  - {kind: "file", path: "app/src/screens/chat/integrationCards.test.tsx"}
requires: []
lanes:
  - "app/src/screens/chat/integrationCards.tsx"
  - "app/src/screens/chat/integrationCards.test.tsx"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/testkit.tsx"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "app/e2e/fixtures/chat-integrations.ts"}
  - {kind: "file", path: "app/e2e/chat-integrations.spec.ts"}
  - {kind: "symbol", path: "app/e2e/chat-integrations.spec.ts", name: "SHOTS"}
  - {kind: "file", path: "docs/evidence/phase-6-polish/chat-cards/README.md"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/screens/chat/integrationCards.tsx", name: "DraftCard"}
  - {from: "1", kind: "symbol", path: "app/src/screens/chat/Thread.tsx", name: "data-thread-card"}
lanes:
  - "app/e2e/fixtures/chat-integrations.ts"
  - "app/e2e/fixtures/chat.ts"
  - "app/e2e/chat-integrations.spec.ts"
  - "docs/evidence/phase-6-polish/chat-cards/*"
external_requires:
  - "Electron binary installed for Playwright (node node_modules/electron/install.js)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 renders 1's components through the built app) | YES (dependency: 2 needs 1's cards to exist) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

### Module layout

| Path | Lines at base | Home for the new responsibility |
|------|---------------|----------------------------------|
| `app/src/screens/chat/cards.tsx` | 643 | not modified. The requirement's Touches names it, but it is past the threshold and holds phase 5's actionable cards; the new read-only cards are a separate concern → CREATE `app/src/screens/chat/integrationCards.tsx` |
| `app/src/screens/chat/cards.test.tsx` | 709 | not modified; new pins → CREATE `app/src/screens/chat/integrationCards.test.tsx` |
| `app/src/screens/chat/Thread.tsx` | 551 | append (~30 lines): row grouping call, the four-kind dispatch and the list's J/K `onKeyDown`. It is the single place that maps thread items to rows; all logic lives in `integrationCards.tsx` |
| `app/src/screens/chat/chat.css` | 440 | append (under threshold) |
| `app/src/screens/chat/testkit.tsx` | 253 | append (under threshold) |
| `app/src/screens/chat/model.ts` | 371 | not modified; reuse `refId`, `clock`, `navigate` |
| `app/e2e/chat.spec.ts` | 498 | not modified; new e2e → CREATE `app/e2e/chat-integrations.spec.ts` |
| `app/e2e/fixtures/chat.ts` | 338 | `export` on existing helpers only, if the new fixture needs them; new data → CREATE `app/e2e/fixtures/chat-integrations.ts` |
| untrusted-text rendering | — | reuse `printable` from `app/src/screens/approvals/printable.ts` (no new escaper, no markdown renderer) |
| list keyboard | — | reuse `listMove` / `isEditableTarget` from `app/src/commands/keyboard.ts` |

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 2 | `skills/playwright-e2e/SKILL.md`, `skills/frontend-ui/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/console/threads.ts:58` | yes | HOLDS (moved to 65) | `export const THREAD_EVENT_KINDS: Readonly<Record<string, ThreadEventTie>> = Object.freeze({` lists `draft_output_recorded: "session"`, `poll_item_skipped: "playbook"`, `poll_item_queued: "playbook"`, `connector_status: "owner"` | tip a7e454e, fetched <1h |
| `docs/OPEN_QUESTIONS.md:112` | yes | STALE | the phase 5 live exit the requirement says is owed has passed (`docs/evidence/phase-5-exit-live-2026-10-25.json` exists) | tip a7e454e, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The thread item carries no revision or dedupe key (`ref` is `{playbook_id}` only) — Feasibility (Phase 2.5) | MEDIUM | Read each poll event's stored payload app-side (`eventLog`, else `GET /events?after=<id-1>&limit=1`, cached per id); fall back to the kernel `summary` when unavailable (AC3). No kernel edit (requirement non-goal) |
| Scope over one worker's context — Feasibility (Phase 2.5) | MEDIUM | Split `context-bound` into cards+units (1) and e2e+evidence (2), serial |
| "As phase 5's cards are": phase 5's chat cards are reachable by Tab only, and no J/K exists in the thread today (J/K exist only in Sessions and Approvals lists) — requirement premise | MEDIUM | AC4 adds J/K over the thread's event cards (phase 5 lines and phase 6 cards) via the shared `listMove`, with no tab-order change (the `keyboard.test.tsx` pin stays green) |
| "With the PR link": Electron denies `window.open` and navigation (`app/electron/main.ts`), so an external anchor would do nothing | MEDIUM | The PR URL is shown as selectable text, built only from a strict `item_ref` parse. Opening it in a browser (a main-process `shell.openExternal` seam) is left for a later item and recorded in the evidence README's findings |
| Rendering model-written PR text (requirement risk) | HIGH | Reuse `printable(text, true)` as a React text child; AC2 pins `<script>`, a markdown link, `</untrusted-data>`, ANSI and bidi; pin mutations 3 and 4 |
| "Consecutive skips from one poll": the skip payload has no trigger or fire id, so "one poll" cannot be told apart from two back-to-back polls with nothing in between | LOW | Group by consecutive position + same `playbook_id` (AC3); recorded as an honest limit in the evidence README |
| The skip line's "key <fields>" comes from the playbook's current `dedupe_key_spec`, which may differ from the spec at skip time | LOW | Use the current spec (the owner's policy now), falling back to the payload's evaluated `dedupe_key` value when no spec is listed (AC3) |
| No mockup frame exists for these cards (D9) | MEDIUM | They are built from the approved `EventCard` and `.chat-card` styles, and the evidence README says so; the owner reviews the screenshots on the PR |
| Parallel lane L1 (item 11, the Integrations screen) edits `app/src/screens/integrations/*` | LOW | No lane overlap; the connector line only links `#/integrations`. Rebase onto `main` before merge if L1 lands first |
| Requirement premise at `docs/OPEN_QUESTIONS.md:112` is stale (phase 5 exit passed 2026-10-25) — Cited-line premise (Phase 3) | MEDIUM | No action: the sequencing precondition is met |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-28-draft-and-poll-cards-in-threads.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-28T17:20:53Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/156
- **Branch:** feature/draft-and-poll-cards-in-threads
- **Files changed:** 19
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Draft, poll (queued, skip group) and connector cards in the thread, with J/K and Enter, unit pins, and an Electron e2e with 10 light/dark screenshots. 6 review findings fixed over 3 heal rounds (Enter auto-repeat, live draft refetch, batched GET /events, coverage pins x2, skip-group open state across Load earlier). The final round's fix (82f261c) was not re-reviewed. Iterations 2 and 3 were reviewer PASS with one MEDIUM each. chat.spec.ts AC9 fails on base a7e454e as well (pre-existing, "Pim, unread").

## Not verified
- **cards in the built Electron app (real J/K/Enter keys, light and dark rendering, long-body scrolling)** — no Electron run in this subtask; subtask 2 covers it with e2e and screenshots (subtask 1)
- **GET /drafts, GET /drafts/:id and GET /events against the real kernel** — only the fake bridge was used (subtask 1)
- **skip groups when a Load earlier page extends an open group** — not exercised by subtask 1; fixed and pinned in heal iteration 3 (82f261c), not re-reviewed (subtask 1)
- **chat.spec.ts AC9 steps after 'Tab reaches Pim'** — the test fails at base before reaching them (subtask 2)
- **Phase 5 PNGs byte-identical after a chat.spec.ts re-run** — a re-run rewrites them with pixel differences, so they were reverted (subtask 2)
