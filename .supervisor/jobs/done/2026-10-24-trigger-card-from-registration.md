# Supervisor Job: A trigger has its card in Chat from the moment it is registered

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L1
- **CLAUDE.md:** ✓ Found (fresh. Its `kernel/` + `docs/` description predates `app/`, which `docs/ARCHITECTURE.md` and the phase-5 requirements document. Nothing it states is contradicted.)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-101650-a-trigger-has-its-card-from-the-moment-it-is-registered.md
- **Base commit:** e6233a90e050fb930a318e275fcdcb3b00f0987d

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel: strict TypeScript + vitest (`kernel/`). App: Electron + React + TypeScript + vitest/RTL + Playwright Electron e2e (`app/`). Nothing new. |
| 2 | Dependency Availability | GO | No new dependency. `trigger_registered` already exists (`TRIGGER_AUDIT_KINDS` in `kernel/src/triggers/store.ts`), and its payload carries `trigger_id` and `owning_agent` (`registerTrigger`'s `appendEvent(` call), so the requirement's assumption holds. `GET /triggers?all=1` already exists (`kernel/src/triggers/routes.ts`), and the contract already types it (`TriggersQuery { readonly all?: "1" }` in `app/src/api/contract.ts`). The contract's `Trigger` already carries `spec`, `next_fire_at`, `last_fired_at`, `last_result`, `enabled_changed_by` and `enabled_changed_at`. |
| 3 | Architecture Fit | CAUTION | The requirement's Touches miss four files the binding acceptance criteria need: (a) `app/src/screens/chat/cards.tsx`, because today's `TriggerCard` shows kind, text and on/off only, and AC1 asks for its schedule and next fire, AC3 for "spent"; (b) `app/src/screens/chat/model.ts`, because `eventKindOf` maps only `trigger_fired` to the playbook line, so a `trigger_registered` card would read as a `hook` line; (c) `docs/architecture/threads.md`, the documented closed list of thread kinds ("A new kind becomes a card only by adding it to `THREAD_EVENT_KINDS`"); (d) `docs/ARCHITECTURE.md`, whose Chat bullet describes the gap this item closes ("drawn only under the trigger's `trigger_fired` event"). This brief adds them to the lanes below; they are flagged in the Task and in Risk Assessment. |
| 4 | Scope vs Supervisor Capability | CAUTION | 14 files are modified (the requirement's 10 Touches + the 4 above), above the 12-file `context-bound` bound. Split into a kernel subtask and an app + e2e + docs subtask (see Configuration). |
| 5 | Hard Blockers | GO | None. `docs/OPEN_QUESTIONS.md` is out of scope by the requirement (updated in the phase 5 close-out commit). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make `trigger_registered` a thread card kind in the kernel, read every trigger in the app (`GET /triggers?all=1`), and attach Chat's full `TriggerCard` (schedule, next fire, on/off/spent, On and Off) once per trigger under the latest of its registered or fired cards, then update the phase 5 e2e, its runbook and the thread docs to the card that now shows.

**Problem Statement:**
The owner needs to see and turn off any reminder or trigger from its agent's thread in the app.
Today Chat's `TriggerCard` is attached only under a `trigger_fired` card, the thread kinds tie only `trigger_fired` to a trigger, and the app reads `GET /triggers` without `all=1` (enabled triggers only). So a trigger has no card before it fires, a fired one-time reminder (spent) shows only the one-line "fired" card, and a trigger still on that never fired can only be turned off with `studio triggers off` in a terminal.
Success looks like this: a trigger's card (schedule, next fire, state, On and Off) shows in its agent's thread from the moment it is registered, exactly once per trigger, and updates in place when it is toggled or fires.

**Owner decisions (2026-10-24, binding, from the requirement):** gap 1 is fixed by a card at creation, from the trigger's `trigger_registered` event; the app reads `GET /triggers?all=1`, so a spent or off trigger still shows its state; the one-line "fired" card stays as it is. These land before phase 6 (which also edits `kernel/src/console/threads.ts`).

**Scope beyond the requirement's Touches (derived by Launch Pad from the acceptance criteria, not owner-confirmed):** `app/src/screens/chat/cards.tsx`, `app/src/screens/chat/model.ts`, `docs/architecture/threads.md`, `docs/ARCHITECTURE.md` (Feasibility row 3). `app/src/screens/chat/chat.css` is in subtask 2's lanes only in case the schedule line needs a class; no other file outside the lanes below may be edited. Anything else is a finding to stop and report. `docs/OPEN_QUESTIONS.md` is NOT edited (the requirement's "Not here"); the PR body says which gap it closes (informational; no criterion depends on it).

**Design notes for the workers (grounded at the base commit):**
- **Kernel (subtask 1, `kernel/src/console/threads.ts`).** Add `trigger_registered: "trigger",` to `THREAD_EVENT_KINDS`, next to `trigger_fired: "trigger",`. The existing `trigger` tie in `newestEvents` (`EXISTS (SELECT 1 FROM triggers t WHERE t.id = json_extract(e.pj, '$.trigger_id') AND t.owning_agent = ?)`) then covers it with no SQL change. In `eventItemOf`'s `case "trigger": {`, add, as its own line before the fired return, `` if (row.kind === "trigger_registered") return card(`${name} registered`, { trigger_id: id }); `` so the summary is `Trigger <id> registered` (or `A trigger registered` when `trigger_id` is absent or mistyped), and the ref is `{trigger_id}` as for a firing. Add no value import (the module graph is pinned by `kernel/test/feature-seams.test.ts`); do not import `TRIGGER_AUDIT_KINDS`.
- **A removed trigger** (`trigger_removed` deletes its row) keeps its one-line registered card in history only if the tie still finds the row; with the row gone the tie drops it, exactly as for its `trigger_fired` cards today. No change.
- **App read (subtask 2, `app/src/store/resources.ts`).** `triggers: { method: "GET", path: "/triggers", query: { all: "1" } },`, the same idiom as `messages`. `KIND_ROUTES`' `trigger_` prefix already refetches `triggers` and every loaded thread on `trigger_registered`, `trigger_toggled` and `trigger_fired`; no routing change. The ⌘K commands (`commands.ts`, built from the same resource) already handle a disabled trigger ("Turn on trigger N"); they are not edited.
- **Placement (subtask 2, `app/src/screens/chat/Thread.tsx`).** In the `items.forEach` that fills `triggerAt`, the branch becomes `} else if (item.kind === "trigger_fired" || item.kind === "trigger_registered") {`, keeping `if (id !== undefined) triggerAt.set(id, index);` so the LATEST of a trigger's registered or fired cards wins. Everything else stays: one card per trigger keyed `card:tr:<id>` (never by position, so it moves rather than remounts), the `shownInPlaybook` suppression for a trigger its playbook's card already shows, and no card when the trigger is not in the triggers list (a removed one): the one-line card alone shows. Update the comment above (`each fired trigger once, after its newest firing`) to say registered or fired.
- **The card (subtask 2, `app/src/screens/chat/cards.tsx` + pure helpers in `model.ts`).** `TriggerCard` keeps its root (`section`, `aria-label="Trigger <id>"`, `data-trigger`), its On and Off buttons (no new button: the playbook card test pins the nested card's buttons), its confirm path and its `changes` list. It adds:
  - **Schedule**, from `triggerSchedule(trigger)` in `model.ts`: `spec` is `unknown` and untrusted. `{at: <ISO string>}` → `once at <when(at)>`; `{cron: <string>, tz: <string>}` → `cron <cron> (<tz>)`; anything else (the test kit's `spec: {}`) → the kind alone. Strings are React text children only.
  - **Next fire**: `next fire <when(next_fire_at)>` with a `<time dateTime=…>`, or `no next fire` when it is null.
  - **State**: `triggerState(trigger)` in `model.ts` returns `"on" | "off" | "spent"`. `spent` mirrors the kernel's `spentOnce` (`kernel/src/triggers/store.ts`) as far as `GET /triggers` lets the app see: `kind === "once" && !enabled && (enabled_changed_by === null || (last_fired_at !== null && enabled_changed_at !== null && last_fired_at > enabled_changed_at))`. The tag keeps the word `off` for both off states and adds `spent` for a spent one (for example `off · spent`), and the root carries `data-state="on" | "off" | "spent"`. On stays for every state (turning on a spent or past `once` already asks to confirm, `409 needs_confirmation`).
  - The card updates in place: its data comes from the `triggers` resource, refetched by the write's `changes` and by the feed's `trigger_*` events, so no remount and no layout jump (the card keeps its key and its slot).
  - `eventKindOf` in `model.ts` maps `trigger_registered` to `"playbook"`, as it does `trigger_fired`, by appending ` || kind === "trigger_registered"` as the last clause of the existing condition, so the line ends `kind === "trigger_registered") return "playbook";`.
- **Fixtures and e2e (subtask 2).** `app/e2e/fixtures/chat.ts`'s populated thread gains a `trigger_registered` event for trigger 8 before its `trigger_fired` (id and time chosen so the existing `event:501` / `event:502` ids of the move test stay as they are), and `GET /triggers` keeps answering the full list (it ignores the query, like the kernel's `all=1`). `app/e2e/phase-5-exit.spec.ts` (real kernel) adds a helper `function registeredCard(page: Page, triggerId: number)` beside `firedCard` (the one-line `Trigger <id> registered` card). Flow 1: after Wright registers the reminder and before the clock passes `REMIND_AT`, the one-line `Trigger <id> registered` card and its `TriggerCard` (state `on`, the reminder's next fire) show in Wright's thread; after the fire, the card shows `spent` and `firedCard(page, remindId)` still shows. Flow 5: the stretch reminder's registered card and its `TriggerCard` show before Pause all; after the `missed_paused` miss its card shows `spent` (a `once` off without a toggle). The `firedCard` doc comment drops the absence claim. Launch only through `launchApp` (house rule).

## Acceptance Criteria
- [ ] AC1. Given a `trigger_registered` event whose `trigger_id` names a trigger owned by `mason`, when `GET /threads/mason` is read, then it has an event card with kind `trigger_registered`, summary `Trigger <id> registered` and ref `{trigger_id: <id>}`, and `GET /threads/wright` does not have it (pinned in `kernel/test/console-threads.test.ts`, including the closed-list test that sees every `THREAD_EVENT_KINDS` kind and a mistyped payload's generic `A trigger registered`).
- [ ] AC2. Given Wright registers a reminder, when its thread loads, then a "registered" card shows and, under it, the full `TriggerCard` with the trigger's schedule, its next fire, its state `on`, and On and Off, before any `trigger_fired` (`thread.test.tsx` / `cards.test.tsx` over the test kit; `phase-5-exit.spec.ts` flow 1 over the real kernel).
- [ ] AC3. Given that card's Off, when it is pressed, then exactly one `POST /triggers/:id/off` with params `{id}` is sent, and the same card element (not a remounted one) shows it off once the `triggers` resource answers with it off, without a reload.
- [ ] AC4. Given a one-time reminder that fired (kind `once`, off, never toggled), then its card shows it spent (`off · spent`, `data-state="spent"`) with On still offered, and the one-line `Trigger <id> fired (…)` card still shows.
- [ ] AC5. Given a cron trigger with one `trigger_registered` and three `trigger_fired` cards in the thread, then exactly one `TriggerCard` for it shows, directly after the third fired card.
- [ ] AC6. Given the app's live store, when the `triggers` resource loads, then it requests `GET /triggers` with query `{all: "1"}` (pinned in `thread.test.tsx` through the test kit's request log), so an off or spent trigger still has its card.
- [ ] AC7. Phase 5's chat unit tests (`app/src/screens/chat/*.test.tsx`), `app/e2e/chat.spec.ts` and `app/e2e/phase-5-exit.spec.ts` pass, updated where they asserted the old absence: `phase-5-exit.spec.ts` flows 1 and 5 assert the registered card and its `TriggerCard` before the fire or miss, and the spent card after it.
- [ ] AC8. `docs/evidence/phase-5-exit-runbook.md` flows 1 and 5 and its cleanup note describe the card that now shows (a trigger has its card from registration; a spent reminder's card says spent; a trigger still on is turned off with Off on its card), with the evidence template's `owner` keys unchanged; `docs/architecture/threads.md`'s kinds table lists `trigger_registered` with its tie and example summary; `docs/ARCHITECTURE.md`'s Chat bullet no longer says a trigger has no card before it fires.
- [ ] AC9. `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test && npm run build`, and `bash scripts/check-docs.sh` pass.

**Evidence rule:** every criterion's evidence is in the diff (tests, e2e, runbook, docs). None lives in the PR body.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel (subtask 1) | `kernel/src/console/threads.ts`, `kernel/test/console-threads.test.ts`, `docs/architecture/threads.md` | — | HIGH |
| app (subtask 2) | `app/src/store/resources.ts`, `app/src/screens/chat/Thread.tsx`, `app/src/screens/chat/cards.tsx`, `app/src/screens/chat/model.ts`, `app/src/screens/chat/thread.test.tsx`, `app/src/screens/chat/cards.test.tsx` (`app/src/screens/chat/chat.css` only if a class is needed) | — | HIGH |
| e2e + docs (subtask 2) | `app/e2e/chat.spec.ts`, `app/e2e/fixtures/chat.ts`, `app/e2e/phase-5-exit.spec.ts`, `docs/evidence/phase-5-exit-runbook.md`, `docs/ARCHITECTURE.md` | — | HIGH (chat.spec.ts may need no change beyond what the fixture forces) |

**Total estimated files:** 14 modify (+1 optional) + 0 create

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans relative links in `docs/`, `CLAUDE.md` and `README.md`, decision numbers and the CLAUDE.md table. The two edited docs keep their existing links; no new link is required.

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| kernel | app + e2e + docs | none (subtask 2's real-kernel e2e and its docs describe the kernel kind subtask 1 adds) | YES (dependency, not overlap) |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/screens/chat/Thread.tsx:330` | yes | HOLDS | `` if (trigger !== undefined) out.push({ key: `card:tr:${id}`, node: <TriggerCard … /> }); `` | tip 12 minutes ago, fetched <1h |
| `kernel/src/console/threads.ts:70` | yes | HOLDS | `trigger_fired: "trigger",` | tip 12 minutes ago, fetched <1h |
| `kernel/src/triggers/store.ts:92` | yes | HOLDS | `export const TRIGGER_AUDIT_KINDS = ["trigger_registered", …` | tip 12 minutes ago, fetched <1h |
| `app/src/store/resources.ts:64` | yes | HOLDS | `triggers: { method: "GET", path: "/triggers" },` | tip 12 minutes ago, fetched <1h |
| `kernel/src/triggers/routes.ts:5` | yes | HOLDS | `GET  /triggers[?all=1]       {triggers: [...]}: enabled ones; all=1 adds disabled ones` | tip 12 minutes ago, fetched <1h |
| `docs/evidence/phase-5-exit-runbook.md:172` | yes | HOLDS | `A trigger has a card in Chat only after it has fired` | tip 12 minutes ago, fetched <1h |
| `kernel/src/console/threads.ts:267` | yes | HOLDS | `const id = isId(p.trigger_id) ? p.trigger_id : null;` | tip 12 minutes ago, fetched <1h |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

Applies to `app/e2e/chat.spec.ts` and `app/e2e/phase-5-exit.spec.ts` (subtask 2), which already launch through the harness and must keep doing so.

## Touched-file invariants

> Grounded at base `e6233a90e050fb930a318e275fcdcb3b00f0987d`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/console/threads.ts`** — keep: the closed list `export const THREAD_EVENT_KINDS: Readonly<Record<string, ThreadEventTie>> = Object.freeze({` (only listed kinds are cards), the existing tie `trigger_fired: "trigger",`, the typed-field reads (`const id = isId(p.trigger_id) ? p.trigger_id : null;`) with a generic sentence for a mistyped payload, never a throw, and every stored string through `shown(` (`shown(p.action)`). Mechanism only and read-only. reuse: the existing `trigger` tie in `newestEvents` (no SQL change) and the `card(` helper. keep the module graph: no new value import (`kernel/test/feature-seams.test.ts` pins it). pinned by: `kernel/test/console-threads.test.ts`, `expect(new Set(eventsOf(body).map((e) => e.kind))).toEqual(new Set(Object.keys(THREAD_EVENT_KINDS)));` (every closed-list kind must have a card in that test).
- **`kernel/test/console-threads.test.ts`** — keep: every existing `it(` and assertion except the two that enumerate the kinds, which are extended, not weakened: `expect(mason.items.map((i) => i.kind)).toEqual(["session_status", "playbook_created", "approval_requested", "agent_renamed", "trigger_fired"]);` gains `trigger_registered` in its place, and `expect(eventsOf(body)).toHaveLength(15);` grows by the added cards.
- **`docs/architecture/threads.md`** — keep: the closed-list statement `A new kind becomes a card only by adding it to` and the table's columns. The `trigger_fired` row gains a `trigger_registered` sibling (same tie, example `Trigger 3 registered`).
- **`app/src/store/resources.ts`** — keep: "Plain TypeScript" with `no React, no DOM-only API` (the e2e imports it under `tsconfig.node.json`), the query idiom `messages: { method: "GET", path: "/messages", query: { all: "1" } },`, and the routing row `{ prefix: "trigger_", resources: ["triggers"] },` unchanged. pinned by: `app/src/store/store.test.ts` `expect(resourcesForKind("trigger_fired")).toEqual(["triggers"]);` (unchanged, not in lanes).
- **`app/src/screens/chat/Thread.tsx`** — keep: `Every kernel string is a React text child only.`; one card per trigger keyed by what it shows (`` key: `card:tr:${id}` ``, the comment "never by its position"); the latest index wins (`if (id !== undefined) triggerAt.set(id, index);`); the playbook suppression (`if (at !== index || shownInPlaybook.has(id)) continue;`); no card for a trigger missing from the list (`if (trigger !== undefined) out.push(`). pinned by: `app/e2e/chat.spec.ts` `await expect(page.locator('[data-item="event:502"] + li').locator(triggerCard)).toBeVisible();` (the card moves after its newest event and keeps focus).
- **`app/src/screens/chat/cards.tsx`** — keep: the root `` aria-label={`Trigger ${trigger.id}`} data-trigger={trigger.id} ``, the write's refetch list `` const changes: ResourceName[] = ["triggers", "playbooks", `thread:${agent}`]; ``, the confirm path (`// Cancel, not Turn on and fire: a stray Enter must not fire the trigger.`), and On and Off as the card's only buttons. Untrusted `spec` is read by type checks only. pinned by: `app/src/screens/chat/cards.test.tsx` `expect(names).toEqual(["Run now", "Turn off", "Set priority", "On", "Off"]);` and `expect(card.textContent).toContain("off");`.
- **`app/src/screens/chat/model.ts`** — keep: `eventKindOf`'s other mappings; extend `if (kind.startsWith("playbook_") || kind === "trigger_fired") return "playbook";` to also map `trigger_registered`. New helpers (`triggerSchedule`, `triggerState`) are pure, with no React or DOM.
- **`app/src/screens/chat/thread.test.tsx`, `app/src/screens/chat/cards.test.tsx`** — keep: every existing test and assertion; only add tests (the existing `trigger_fired`-only cases stay green).
- **`app/e2e/chat.spec.ts`** — keep: launch only through the harness (`import { APP_DIR, launchApp } from "./electron-harness";`, house rule); the move test's `await expect(page.locator('[data-item="event:502"] + li').locator(triggerCard)).toBeVisible();` and its focus assertion; every other test unchanged. Edit only what the fixture's new `trigger_registered` event forces (for example a count of event cards).
- **`app/e2e/fixtures/chat.ts`** — keep: `"GET /triggers": () => ({ status: 200, body: { triggers } }),`, trigger 8's past-`once` confirm handler (`"POST /triggers/:id/on": (req) => {`), and the event ids the move test relies on (`event:501`, `event:502`).
- **`app/e2e/phase-5-exit.spec.ts`** — keep: launch through the harness, every existing kernel-store assertion of flows 1-6 (`expect(events(store, "trigger_fired")).toEqual([]);` before the fire, the notification and deep-link checks), and `function firedCard(page: Page, triggerId: number) {`. Only add the card assertions and rewrite the `firedCard` doc comment.
- **`docs/evidence/phase-5-exit-runbook.md`** — keep: the evidence template's `owner` keys, which `kernel/test/phase-5-exit-live.test.ts` pins (`"1_reminder_fires": ["asked_in_chat", "fired_card_seen_in_chat", "notification_appeared_on_screen", "notification_click_opened_thread"],`). Rewrite only the prose of flow 1 (`no trigger card shows yet (the app draws nothing for a trigger before it fires)`), flow 5 (`No card shows for it: the app draws a trigger's card only once it fires, and this one never does.`) and the cleanup note (`A trigger has a card in Chat only after it has fired`).
- **`docs/ARCHITECTURE.md`** — keep: the Chat bullet's structure and links; rewrite only its trigger clause (`drawn only under the trigger's`).

## Closed enumerations touched

> Sibling grep at base `e6233a90e050fb930a318e275fcdcb3b00f0987d`: `git grep -nF 'trigger_fired' -- ':!.supervisor' ':!CHANGELOG.md'` → 82 hits in 27 files.

- **`trigger_registered`** (sibling: `trigger_fired`) — must be named in:
  - `kernel/src/console/threads.ts` — `THREAD_EVENT_KINDS` (`trigger_fired: "trigger",`) — extend (subtask 1).
  - `docs/architecture/threads.md` — the kinds table (the `trigger_fired` row) — extend (subtask 1).
  - `kernel/test/console-threads.test.ts` — the AC5 kinds list and the every-kind card test — extend (subtask 1).
  - `app/src/screens/chat/model.ts` — `eventKindOf` (`kind === "trigger_fired") return "playbook";`) — extend (subtask 2).
  - `app/src/screens/chat/Thread.tsx` — the card-placement branch (`} else if (item.kind === "trigger_fired") {`) — extend (subtask 2).
  - `app/src/store/resources.ts` / `app/src/store/store.test.ts` — `KIND_ROUTES` matches by prefix (`trigger_`) — no change: `trigger_registered` already routes to `triggers` and every loaded thread.
  - `kernel/src/triggers/store.ts` (`TRIGGER_AUDIT_KINDS`) and `docs/architecture/triggers.md` (payloads) — no change: both already name `trigger_registered`.
  - `docs/ARCHITECTURE.md`, `docs/evidence/phase-5-exit-runbook.md`, `app/e2e/phase-5-exit.spec.ts`, `app/e2e/fixtures/chat.ts`, `app/e2e/chat.spec.ts`, `app/src/screens/chat/cards.test.tsx` — prose, fixtures or assertions about the fired card, not closed lists; edited by this job only where an acceptance criterion says so.
  - `docs/OPEN_QUESTIONS.md` — no change: out of scope by the requirement (phase 5 close-out).
  - `app/src/screens/chat/keyboard.test.tsx`, `docs/architecture/pause.md`, `docs/evidence/phase-2-exit-runbook.md`, the `docs/evidence/*.json` evidence files and the remaining `kernel/test/*.test.ts` hits (`console-pause`, `phase-2-exit-live`, `phase-5-exit-live`, `playbooks-runs`, `sessions-playbook-admission`, `triggers-crash`, `triggers`) — no change: they count or describe firings, not the thread's kinds.

## Pin mutations

All pins are new or extended. Each mutation is applied to the code the pin protects, in a scratch copy, and must turn the pin red.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-threads.test.ts` — a `trigger_registered` card is in mason's thread | delete `trigger_registered: "trigger",` in `kernel/src/console/threads.ts` |
| `kernel/test/console-threads.test.ts` — its summary is `Trigger <id> registered` | delete `if (row.kind === "trigger_registered")` in `kernel/src/console/threads.ts` |
| `app/src/screens/chat/thread.test.tsx` — the triggers resource asks `GET /triggers` with `{all: "1"}` | flip `path: "/triggers", query: { all: "1" } }` → `path: "/triggers" }` in `app/src/store/resources.ts` |
| `app/src/screens/chat/thread.test.tsx` — a registered, never-fired trigger has its `TriggerCard` | flip `item.kind === "trigger_registered") {` → `item.kind === "trigger_registered_x") {` in `app/src/screens/chat/Thread.tsx` |
| `app/src/screens/chat/thread.test.tsx` — registered + three fired: one card, after the third fired card | flip `if (id !== undefined) triggerAt.set(id, index);` → `if (id !== undefined && !triggerAt.has(id)) triggerAt.set(id, index);` in `app/src/screens/chat/Thread.tsx` |
| `app/src/screens/chat/cards.test.tsx` — the card shows its schedule and next fire | delete the next-fire line from `TriggerCard` in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — a fired `once` never toggled shows `spent` | make `triggerState` return `"off"` for every off trigger in `app/src/screens/chat/model.ts` |
| `app/src/screens/chat/cards.test.tsx` — Off updates the same card element to off without a reload | flip `const changes: ResourceName[] = ["triggers", "playbooks",` → `const changes: ResourceName[] = ["playbooks",` in `app/src/screens/chat/cards.tsx` |
| `app/e2e/phase-5-exit.spec.ts` — flow 1: the `Trigger <id> registered` card (`registeredCard`) shows before the fire | delete `trigger_registered: "trigger",` in `kernel/src/console/threads.ts` |
| `app/e2e/phase-5-exit.spec.ts` — flows 1 and 5: the reminder's `TriggerCard` shows before the fire or the miss | flip `item.kind === "trigger_registered") {` → `item.kind === "trigger_registered_x") {` in `app/src/screens/chat/Thread.tsx` |
| `app/e2e/phase-5-exit.spec.ts` — flows 1 and 5: the card shows `spent` after the fire or the `missed_paused` miss | make `triggerState` return `"off"` for every off trigger in `app/src/screens/chat/model.ts` |
| `app/e2e/phase-5-exit.spec.ts` — the reminder's card (state off) shows at all once it is spent | flip `path: "/triggers", query: { all: "1" } }` → `path: "/triggers" }` in `app/src/store/resources.ts` |
| `app/src/screens/chat/thread.test.tsx` — a `trigger_registered` line reads as the playbook kind | flip `kind === "trigger_registered") return "playbook";` → `kind === "trigger_registered_x") return "playbook";` in `app/src/screens/chat/model.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `trigger_registered` thread card, its tests and the thread kinds doc | AC1, AC9 (kernel), AC8 (`docs/architecture/threads.md`) | 3 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | App: read every trigger, card from registration (schedule, next fire, spent), e2e, runbook, ARCHITECTURE | AC2, AC3, AC4, AC5, AC6, AC7, AC8 (runbook, ARCHITECTURE), AC9 (app, check-docs) | 11 modify (+1 optional), 0 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/console/threads.ts", name: "trigger_registered"}
  - {kind: "symbol", path: "kernel/test/console-threads.test.ts", name: "trigger_registered"}
  - {kind: "symbol", path: "docs/architecture/threads.md", name: "trigger_registered"}
requires: []
lanes:
  - "kernel/src/console/threads.ts"
  - "kernel/test/console-threads.test.ts"
  - "docs/architecture/threads.md"
external_requires: []
```

```yaml
# Subtask 2
provides:
  - {kind: "symbol", path: "app/src/screens/chat/model.ts", name: "triggerState"}
  - {kind: "symbol", path: "app/src/screens/chat/model.ts", name: "triggerSchedule"}
  - {kind: "symbol", path: "app/src/screens/chat/Thread.tsx", name: "trigger_registered"}
  - {kind: "symbol", path: "app/src/screens/chat/cards.tsx", name: "triggerState"}
  - {kind: "symbol", path: "app/src/screens/chat/cards.tsx", name: "triggerSchedule"}
  - {kind: "symbol", path: "app/e2e/phase-5-exit.spec.ts", name: "registeredCard"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/console/threads.ts", name: "trigger_registered"}
lanes:
  - "app/src/store/resources.ts"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/cards.tsx"
  - "app/src/screens/chat/model.ts"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/thread.test.tsx"
  - "app/src/screens/chat/cards.test.tsx"
  - "app/e2e/chat.spec.ts"
  - "app/e2e/fixtures/chat.ts"
  - "app/e2e/phase-5-exit.spec.ts"
  - "docs/evidence/phase-5-exit-runbook.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "Electron + Playwright available locally for `npm run e2e` (CI runs it under xvfb in .github/workflows/ci.yml)"
```

## Parallelism Analysis

### Dependency Graph
```
1 (kernel kind + docs) → 2 (app, e2e, runbook, ARCHITECTURE)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | YES (subtask 2's real-kernel `phase-5-exit.spec.ts` needs subtask 1's kind) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1 at a time
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): four files outside the requirement's Touches (`cards.tsx`, `model.ts`, `docs/architecture/threads.md`, `docs/ARCHITECTURE.md`). | MEDIUM | Each is forced by a binding criterion or the repo's own doc rule (Feasibility row 3), and each is named in a lane and a touched-file invariant. No concurrent lane of this run touches them (L2: `app/src/screens/menubar/`; L3: `kernel/src/notifications/`; L4: `kernel/src/brain/`, `kernel/src/sessions/`). Any other file is a stop-and-report finding. |
| Feasibility (Phase 2.5): context-bound size (14 modified files). | MEDIUM | Two serial subtasks with no file overlap (Configuration `Split reason`). |
| Prior churn (postmortem ledger): `docs/ARCHITECTURE.md` (44 entries), `docs/architecture/threads.md` (2), `kernel/src/console/threads.ts` (2), `app/e2e/chat.spec.ts` (1), `app/e2e/fixtures/chat.ts` (1); recurring classes `self_heal_churn`, `drain_churn`, `convention_mismatch`; no `self_heal_miss`. | MEDIUM | Keep the doc edits to the one clause each criterion names (convention_mismatch), mirror the existing `trigger_fired` idioms exactly in code and tests, and run every validation command before hand-back so review rounds are not spent on drift. |
| The app's "spent" reading can differ from the kernel's `spentOnce`, which reads `trigger_toggled` events the app does not get from `GET /triggers`: a `once` the owner turned on and that was then missed (not fired) reads `off`, not `spent`. | LOW | Mirror the kernel rule as far as the row allows (Design notes) and pin the common cases (never toggled; fired after a turn-on). Record the limit in a doc comment on `triggerState` in `app/src/screens/chat/model.ts` (in the diff), and mention it in the PR body. Adding a `spent` field to the trigger view is a contract change outside this item. |
| `all=1` grows the ⌘K palette: every off or spent trigger gets a "Turn on trigger N" command. | LOW | `commands.ts` already offers that for a disabled trigger, and a past `once` already answers `needs_confirmation` with a notice to confirm on the card. Not edited here; mention in the PR body. |
| The new card lines (schedule, next fire) change the Chat polish screenshots under `docs/evidence/phase-5-polish/chat/`. | LOW | The screenshots are written only in evidence mode and are not regenerated by this item; the e2e assertions use roles and text, not pixels. |
| Item 115025 (the playbook card, a later wave) edits `cards.tsx`, `Thread.tsx`, `resources.ts`, `chat.spec.ts` and `fixtures/chat.ts`. | LOW | It is not in this run's concurrent lanes; it rebases on this merge. Keep this change surgical so its rebase stays small. |
| A spent or removed trigger whose row is gone has no card. | LOW | Intended: the one-line registered and fired cards still show; `Thread.tsx` already skips a trigger missing from the list. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Split reason:** context-bound
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-trigger-card-from-registration.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-24T07:57:22Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/128
- **Branch:** feature/trigger-card-from-registration
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** The kernel makes trigger_registered a thread card kind. The app reads GET /triggers?all=1 and shows Chat's TriggerCard (schedule, next fire, on/off/spent) once per trigger, under its newest registered or fired card. Tests, e2e, runbook and docs are updated. Phase 4.5 fixed 2 MEDIUM findings (the app.md resource list; stale chat-populated screenshots) and dismissed 2 LOW ones.

## Not verified
- **app Chat rendering of a trigger_registered card** — app consumer is subtask 2's lane; not run here (subtask 1)
- **runbook flows 1 and 5 in the packaged app with a real model** — owner-only live run; covered here by phase-5-exit.spec.ts over a real kernel with fake sessions (subtask 2)
