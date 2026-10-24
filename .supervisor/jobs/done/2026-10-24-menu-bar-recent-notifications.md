# Supervisor Job: The menu-bar panel lists recent notifications, each opening what it links to

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-101651-the-menu-bar-panel-lists-recent-notifications.md
- **Base commit:** e6233a90e050fb930a318e275fcdcb3b00f0987d

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript screen in `app/` (vitest unit tests, Playwright Electron e2e), the same stack the panel already uses. |
| 2 | Dependency Availability | GO | No new dependency. The kernel already serves `GET /notifications` (`kernel/src/notifications/routes.ts`, `listNotifications` is `ORDER BY id DESC`), rows carry `deep_link` and `delivery_status`; the app store already has a `notifications` resource (`app/src/store/resources.ts`: `notifications: { method: "GET", path: "/notifications" }`) refetched on `notification_*` / `notify` events. The requirement's assumption holds, so no kernel change is needed. |
| 3 | Architecture Fit | GO | App-only change (requirement non-goal: "any kernel change"). Opening a row reuses the host's existing deep-link path (`navigateQueue` -> `GET /notifications/:id` -> `linkTarget` in `./links.ts`). The design-system `List` component (`app/src/components/List/List.tsx`) already gives `data` rows, arrow/`Enter` keyboard, `loading` skeletons and scroll anchoring. |
| 4 | Scope vs Supervisor Capability | GO | Single subtask: 8 hand-edited files plus the panel's regenerated light/dark screenshots (one command writes them). No split reason fires. |
| 5 | Hard Blockers | GO | None. The polish-gate screenshots need the Electron e2e on macOS (`MENUBAR_EVIDENCE=1`), which this machine runs. |

**Overall Verdict:** GO

## Task
**Goal:** Add a "Recent" section to the menu-bar status panel (`#/menubar`) that lists the latest 20 notifications newest first, each with its title, age and delivery-status badge, where opening a row (click or Enter) goes through the same deep-link handler a notification click uses.

**Problem Statement:**
The owner needs to see and reopen notifications from inside the app because a notification is only ever seen on screen.
Currently, the panel (`app/src/screens/menubar/MenubarPanel.tsx`) reads only `GET /status` and `GET /approvals`; the app reads `GET /notifications/:id` only when a `loomwright-studio://` link is clicked (`MenubarHost.tsx`). A notification missed on screen, or one with no click action (delivery `unsupported` without terminal-notifier), has no row anywhere in the app (`docs/OPEN_QUESTIONS.md`, "Known gaps the e2e found" (2); `docs/evidence/phase-5-exit-runbook.md` flow 1).
Success looks like: the panel shows up to 20 recent notifications with delivery status, a new one appears from the feed without reload or layout shift, and opening a row lands exactly where its deep link would.

**Design notes (binding from the requirement; how is the worker's call):**
- Data: `useResource("notifications", api)` (the store's existing resource; do NOT change `app/src/store/resources.ts` or add a route to the contract). Show the first 20 rows of the answer, in the kernel's order (newest first). The kernel's default list is 50, so cap client-side.
- Rows: prefer the design-system `List` with `kind: "data"` rows (title as `subject`, age as `meta`/`aside`), a delivery-status indication for `delivered`, `unsupported`, `failed` (and `pending`, the fourth value of the kernel's closed set `NOTIFICATION_STATUSES` in `kernel/src/notifications/record.ts`), using existing components and tokens only (`Badge` tones / `StatusDot` states). Untrusted text goes through `printable` (`../approvals/printable`), as the panel already does for kernel text.
- Opening: a row calls the host's deep-link path. The simplest faithful route is `navigateQueue.receive(notificationRoute(row.id))` (both already exported: `MenubarHost.tsx`, `./state.ts`), so the host does the `GET /notifications/:id` and `linkTarget` mapping exactly as for a click. Never map `source` to a hash in the panel itself (that would be a second, divergent copy of `links.ts`). The unit-test `mount` in `menubar.test.tsx` gives the host its own queue (`const queue = createNavigateQueue(() => now);` -> `<MenubarHost queue={queue} …/>`), so `MenubarPanel` takes an optional `queue?: NavigateQueue` prop defaulting to `navigateQueue`, the same way `actions` defaults to `menubarActions`; `mount` passes the same `queue` to host and panel. A row opens only through `queue.receive(notificationRoute(id))`.
- Fixtures: `menubarKernel()` defaults `notifications` to `cannedNotifications()` (#7, #3, both `delivered`), which the deep-link tests keep. The fixture adds `GET /notifications` over that same map (id descending) and lets the `notification()` builder take a delivery status (e.g. an optional `delivery_status` argument). The evidence test seeds `notifications: new Map()` before the `idle` shot (empty Recent section), then adds three rows with `delivered`, `unsupported` and `failed`, pushes `notification_created`, and shoots `recent`. The unit-test builder in `menubar.test.tsx` (which hard-codes `delivery_status: "delivered"`) gets the same delivery-status argument for AC1's unit pin.
- Height: the list scrolls within the panel (cap at 20 rows); the panel must not grow past the window.
- States: empty -> "No notifications yet"; list loading -> skeleton rows (List `loading`), never a spinner; kernel unreachable -> the existing error view and the shell's shared band (the panel's `error` view already renders it).
- The runbook (scope item 4): update flow 1's note in `docs/evidence/phase-5-exit-runbook.md` ("The app has no list of notifications, so there is no row of it to look for in the app.") to say the notification's row now shows in the menu-bar panel's Recent list with its delivery status and opens the same thread.
- Architecture doc: `docs/ARCHITECTURE.md` says the same stale thing (`The app has no list of notifications: a notification is seen on screen, and clicking it opens the app on what it names.`). Change only that clause, so it names the menu-bar panel's Recent list; no other sibling item touches this file.
- A failed list read: when `GET /notifications` fails while `GET /status` answers, the Recent section shows its own one-line error (design-system text styles), and the panel's `data-state` and the `menubar-stale` line are unchanged.
- Not here: `docs/OPEN_QUESTIONS.md` (the phase 5 close-out commit updates it), any kernel change, a Notifications screen, dismiss / mark-read.

## Acceptance Criteria
- [ ] AC1: Given three notifications in the fixture kernel (`GET /notifications` answering them newest first, with delivery statuses `delivered`, `unsupported` and `failed`), when the menu-bar panel opens, then three rows show newest first, each with its title, its age and its delivery status (pinned in `menubar.test.tsx` and `menubar.spec.ts`).
- [ ] AC2: Given a row for an approval's notification (`kernel:approval`, titled `Approval 7: …`), when it is opened by click or by keyboard (arrow to it, `Enter`), then the app makes exactly one `GET /notifications/7` and lands on `#/approvals/7`, exactly as the `loomwright-studio://notifications/7` deep link does, and sends no POST.
- [ ] AC3: Given `GET /notifications` answers an empty list, when the panel opens, then the empty state "No notifications yet" shows and no row renders.
- [ ] AC4: Given the panel is open with N rows, when a `notification_created` event arrives on the feed and the kernel's list now has one more, then a new row appears at the top without a reload, and the rows already shown keep their position on screen (no layout shift: the List's scroll anchoring holds, and the panel's height does not change once the list is at its cap or its scroll container height).
- [ ] AC5: Given more than 20 notifications, when the panel opens, then exactly 20 rows render and the list scrolls within the panel.
- [ ] AC6: Given the list has not answered yet, then skeleton rows show (no spinner); given the kernel is unreachable, then the panel's existing error view and the shell's band show (no stale rows invented).
- [ ] AC7: `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and `bash scripts/check-docs.sh` passes; `menubar.test.tsx` and `menubar.spec.ts` pass.
- [ ] AC8: Given the e2e is run with `MENUBAR_EVIDENCE=1`, then the committed folder `docs/evidence/phase-5-polish/menubar/` holds this run's light and dark screenshot of every designed state, including a new `recent` state (three rows with their statuses) and the empty Recent section inside the re-shot `idle` state, and its `README.md` lists exactly those files (the spec's last test pins README and folder against `STATES`).
- [ ] AC9: Given `docs/evidence/phase-5-exit-runbook.md` flow 1, then its note no longer says the app has no list of notifications; it says the notification's row shows in the menu-bar panel's Recent list with its delivery status and opens the thread it names; and `docs/ARCHITECTURE.md` no longer says "The app has no list of notifications" — it names the menu-bar panel's Recent list.
- [ ] AC10: Given `GET /notifications` fails while `GET /status` and `GET /approvals` answer, when the panel opens, then the Recent section shows its own error line, the panel's `data-state` is the state `GET /status` gives, and `menubar-stale` does not appear (pinned in `menubar.test.tsx`).

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| panel | `app/src/screens/menubar/MenubarPanel.tsx`, `app/src/screens/menubar/menubar.css` | — | HIGH |
| unit tests | `app/src/screens/menubar/menubar.test.tsx` | — | HIGH |
| e2e | `app/e2e/menubar.spec.ts`, `app/e2e/fixtures/menubar.ts` | — | HIGH |
| evidence | `docs/evidence/phase-5-polish/menubar/README.md`, every `docs/evidence/phase-5-polish/menubar/*.png` (regenerated by `MENUBAR_EVIDENCE=1`) | `docs/evidence/phase-5-polish/menubar/recent-light.png`, `docs/evidence/phase-5-polish/menubar/recent-dark.png` | HIGH |
| runbook + architecture | `docs/evidence/phase-5-exit-runbook.md`, `docs/ARCHITECTURE.md` | — | HIGH |
| host (only if needed) | `app/src/screens/menubar/MenubarHost.tsx` — only to export a named helper for "open notification `id`" if `navigateQueue.receive(notificationRoute(id))` is not used directly | — | LOW |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans every `docs/**/*.md` relative link — the runbook and the evidence README edits must keep their links resolving (the README links each PNG by name, so every listed PNG must exist).

## Touched-file invariants

> Grounded at base `e6233a90e050fb930a318e275fcdcb3b00f0987d`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/menubar/MenubarPanel.tsx`** — keep: the panel reads the bridge defensively and renders the `no-bridge` note without one (`if (api === undefined) {`); the state shown is only what the kernel said (`data-state={view}` from `menubarState(data, pending)`), so the Recent list must not change `view` or the `stale` line (`const stale = data !== undefined && (status?.error !== undefined || approvals?.error !== undefined);`) — a failed notifications read gets its own handling, not a new panel state; the focus-handoff effect only walks `[data-action]` buttons (`card.querySelectorAll<HTMLButtonElement>("[data-action]")`) — rows must not carry `data-action`; kernel text is shown through `printable`. reuse: `useResource` from `../../store/react`, `List` from `../../components/List/List`, `Badge`/`StatusDot`. mirror: open a row through the host's queue (`navigateQueue` in `MenubarHost.tsx`, `notificationRoute` in `./state.ts`), never a second copy of `linkTarget`; the queue is an optional prop defaulting to `navigateQueue` (as `actions = menubarActions` in `export function MenubarPanel({ actions = menubarActions }: MenubarPanelProps)`), so a test can hand panel and host the same injected queue.
- **`app/src/screens/menubar/MenubarHost.tsx`** (only if touched) — keep: the host is the ONE place a notification link becomes a request (`const result = await request(api, { method: "GET", path: "/notifications/:id", params: { id: route.id } });`) and only the newest link navigates (`linkSeq.current += 1;`); the queue drops a repeat within `ROUTE_DEDUPE_MS` (`export const ROUTE_DEDUPE_MS = 2000;`). pinned by: `menubar.test.tsx` and `kernel-mirror.test.ts`.
- **`app/src/screens/menubar/menubar.css`** — keep: tokens only (`var(--space-1)`, `var(--surface-raised)`, `var(--ink-tertiary)`); the card's width rule (`width: min(100%, var(--list-pane-width));`). No raw hex colours or px literals where a token exists.
- **`app/src/screens/menubar/menubar.test.tsx`** — keep: the fake kernel in `mount` (`const kernel: Kernel = { status: statusBody(), approvals: [], notifications: new Map(), applies: true, ...initial };`) and its `GET /notifications/:id` route; the fake bridge answers an unrouted read with a 404 (`app/src/store/fake-bridge.ts`: `responder === undefined ? { ok: false as const, status: 404, body: { error: "not_found" } }`), so add a `GET /notifications` route rather than relying on the 404; `mount` renders `<MenubarPanel actions={actions} />` beside `<MenubarHost queue={queue} actions={actions} registry={registry} />` — pass the same `queue` to the panel.
- **`app/e2e/menubar.spec.ts`** — keep: Electron launches only via `launchApp` (`import { launchApp } from "./electron-harness";`, house rule above, enforced by `app/scripts/hidden-windows.test.ts`: `const LAUNCHES = /electron\.launch\s*\(|new\s+BrowserWindow\s*\(/;`); screenshots go to `EVIDENCE_DIR` only under `MENUBAR_EVIDENCE` (`const EVIDENCE = process.env.MENUBAR_EVIDENCE === "1";`); the AC6 test's last assertion compares written files to `STATES` (`expect([...new Set(written)].sort()).toEqual(STATES.flatMap((s) => THEMES.map((t) => \`${s}-${t}.png\`)).sort());`); the invalid-link test filters `r.path.startsWith("/notifications/")`, which the list read `/notifications` does not match — keep it that way (do not loosen the filter). mirror: the `push` helper's kind union (`push: (kind?: "event_done" | "approval_requested") => void`) and the fixture's `kernelEvent` union must stay in step.
- **`app/e2e/fixtures/menubar.ts`** — keep: every body typed by the contract (`import type { Approval, EventFrame, NotificationRow, RosterEntry, RouteKey, StatusBody } from "../../src/api/contract";`); the canned notifications #7 (`[7, notification(7, "kernel:approval", "Approval 7: Bash")]`) and #3 that AC4's deep-link tests open; the `notification()` builder (`deep_link: \`loomwright-studio://notifications/${id}\``). Add `GET /notifications` over the same `kernel.notifications` map, answering newest first (id descending), as the kernel does (`ORDER BY id DESC` in `kernel/src/notifications/record.ts`).
- **`docs/evidence/phase-5-polish/menubar/README.md`** — keep: one table row per state with both theme links (`| [kill-confirm-light.png](kill-confirm-light.png) | [kill-confirm-dark.png](kill-confirm-dark.png) |`); the count sentence (`The last test checks that this README and the folder list exactly the eighteen files below.`) must be updated to the new total. pinned by: `menubar.spec.ts`'s last test (`readme.match(/\b[a-z]+(?:-[a-z]+)*-(?:light|dark)\.png/g)`).
- **`docs/evidence/phase-5-exit-runbook.md`** — keep: flow 1's structure (`### Flow 1: a reminder (phase 2)`) and every other flow untouched; change only the sentence `The app has no list of notifications, so there is no row of it to look for in the app.` and what follows from it in that note.
- **`docs/ARCHITECTURE.md`** — keep: the paragraph's other sentences (`Closing the window leaves the tray running, and there is no autostart.`) unchanged; change only the clause `The app has no list of notifications: a notification is seen on screen, and clicking it opens the app on what it names.`; every relative link still resolves (`scripts/check-docs.sh`).

## Closed enumerations touched

> Sibling grep at base `e6233a90e050fb930a318e275fcdcb3b00f0987d`: `grep -rnF 'kill-confirm-' docs app` (excluding `*.png`) → 1 hit in 1 file; `grep -rnF 'kill-confirm' app` → 2 hits in 1 file; `grep -rnF '"event_done" | "approval_requested"' app` → 3 hits in 2 files.

- **`recent`** (a new screenshot state; sibling: `kill-confirm`) — must be named in:
  - `app/e2e/menubar.spec.ts` — the closed `STATES` list (`const STATES = ["loading", "error", "idle", "working", "waiting", "paused", "cap", "killed", "kill-confirm"] as const;`) — extend.
  - `app/e2e/menubar.spec.ts` — the `shoot(page, "kill-confirm", testInfo)` call — no change: a call site, not a list; add a sibling `shoot(page, "recent", testInfo)`.
  - `docs/evidence/phase-5-polish/menubar/README.md` — the state table (`| [kill-confirm-light.png](kill-confirm-light.png) |`) and the "eighteen files" count — extend (add the `recent` row; eighteen -> twenty).
- **`notification_created`** (a feed event kind the e2e pushes; sibling: `approval_requested`) — must be named in:
  - `app/e2e/fixtures/menubar.ts` — `kernelEvent`'s kind union (`kind: "event_done" | "approval_requested" = "event_done"`) — extend.
  - `app/e2e/menubar.spec.ts` — `startKernel`'s `push` type and its default (`const push = (kind: "event_done" | "approval_requested" = "event_done"): void => {`) — extend (both lines 72 and 77).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/menubar/menubar.test.tsx` — three rows newest first with statuses (AC1) | reverse the rows' order in `MenubarPanel.tsx` (e.g. `.reverse()` the list before render), or drop the status badge element |
| `app/src/screens/menubar/menubar.test.tsx` — opening a row reads `GET /notifications/:id` and lands on `#/approvals/7` (AC2) | delete the `queue.receive(notificationRoute(id))` call in the row's open handler in `MenubarPanel.tsx` |
| `app/src/screens/menubar/menubar.test.tsx` — a failed `GET /notifications` leaves `data-state` and `menubar-stale` unchanged (AC10) | add the notifications resource's `error` to the `stale` expression in `MenubarPanel.tsx` |
| `app/src/screens/menubar/menubar.test.tsx` — empty state text (AC3) | change the empty-state string `No notifications yet` in `MenubarPanel.tsx` |
| `app/src/screens/menubar/menubar.test.tsx` — cap at 20 (AC5) | delete the 20-row cap (the `.slice(0, …)`) in `MenubarPanel.tsx` with 21+ rows in the fixture |
| `app/src/screens/menubar/menubar.test.tsx` — a `notification_created` event adds a row without remount (AC4) | flip `{ prefix: "notification_", resources: ["notifications"] }` → `{ prefix: "notification_", resources: [] }` in `app/src/store/resources.ts` (scratch copy only; this file is not in the lanes) |
| `app/src/screens/menubar/menubar.test.tsx` — skeleton rows, no spinner, while `GET /notifications` is unanswered (AC6) | drop the `loading` prop from the Recent `List` in `MenubarPanel.tsx` (or render a spinner in its place) |
| `app/src/screens/menubar/menubar.test.tsx` — no rows shown when the kernel is unreachable (AC6) | render the last cached rows in the panel's `error` view in `MenubarPanel.tsx` |
| `app/e2e/menubar.spec.ts` — rows keep their position and the panel height does not change when a row arrives (AC4) | delete the Recent list's bounded height (`max-height`) rule in `app/src/screens/menubar/menubar.css` |
| `app/e2e/menubar.spec.ts` — three rows newest first with statuses (AC1, e2e) | reverse the rows' order in `MenubarPanel.tsx` (`.reverse()` before render) |
| `app/e2e/menubar.spec.ts` — a row opened by click and by `Enter` makes one `GET /notifications/7` and lands on `#/approvals/7` (AC2, e2e) | replace the row's open handler in `MenubarPanel.tsx` with a no-op |
| `app/e2e/menubar.spec.ts` — README and folder list exactly `STATES` × themes | delete the `recent` row from `docs/evidence/phase-5-polish/menubar/README.md` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Recent notifications list in the menu-bar panel, its tests, screenshots, runbook and architecture notes | all | 8 modify (+18 regenerated PNGs), 2 create (PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/menubar/MenubarPanel.tsx"}
  - {kind: "file", path: "app/e2e/fixtures/menubar.ts"}
  - {kind: "symbol", path: "app/e2e/menubar.spec.ts", name: "recent"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/menubar/recent-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/menubar/recent-dark.png"}
  - {kind: "symbol", path: "docs/evidence/phase-5-polish/menubar/README.md", name: "recent-light.png"}
requires: []
lanes:
  - "app/src/screens/menubar/**"
  - "app/e2e/menubar.spec.ts"
  - "app/e2e/fixtures/menubar.ts"
  - "docs/evidence/phase-5-polish/menubar/**"
  - "docs/evidence/phase-5-exit-runbook.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "Electron e2e on macOS for MENUBAR_EVIDENCE=1 screenshots (npm run e2e in app/)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/api/contract.ts:54-55` | yes | HOLDS | `{ method: "GET", path: "/notifications", origin: "notifications" },` | tip 10 minutes ago, fetched <1h |
| `menubar.test.tsx:128` | yes (unique suffix: `app/src/screens/menubar/menubar.test.tsx`) | HOLDS | `fake.route("GET /notifications/:id", (req) => {` | tip 10 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The panel grows too tall with 20 rows (requirement risk). | MEDIUM | Cap at 20 rows client-side; the list is its own scroll container with a bounded height inside the panel (List is already a scroll container). |
| A second copy of the link mapping drifts from `links.ts`, so a row and a click land differently. | HIGH | Open a row only through the host's queue (`navigateQueue.receive(notificationRoute(id))`); AC2 pins row and deep link landing identically, with one `GET /notifications/7`. |
| The queue's 2 s repeat-drop (`ROUTE_DEDUPE_MS`) swallows a second open of the same row within 2 s. | LOW | Acceptable (the first open already navigated); do not bypass the dedupe. Note it in a code comment if relevant. |
| New rows in Tab order break `menubar.spec.ts` AC7's `tabTo` keyboard walk, or the List's roving tabindex steals arrow keys. | MEDIUM | List rows take one Tab stop (roving tabindex); re-run AC7 and keep its order assertions; add keyboard assertions for the rows (arrows + Enter). |
| Every existing menu-bar screenshot changes (the panel gains a section), so the evidence folder must be regenerated wholesale. | LOW | Regenerate with `MENUBAR_EVIDENCE=1` in one run (the spec deletes stale PNGs first) and update the README's state table and file count. |
| Prior churn (postmortem ledger) on `MenubarPanel.tsx`, `menubar.css`, `menubar.test.tsx`, `menubar.spec.ts`, `fixtures/menubar.ts`: recurring `self_heal_churn` (2 rounds), no `self_heal_miss`. Source: Prior churn (postmortem ledger). | MEDIUM | Expect review rounds on these files; run the full validation list before hand-back rather than only the touched tests. |
| Sibling item 19 (`2026-10-24-101650-a-trigger-has-its-card-from-the-moment-it-is-registered.md`) also edits flow 1 of `docs/evidence/phase-5-exit-runbook.md`, so the two PRs can conflict on that paragraph. | LOW | Change only the notification-list sentence (Touched-file invariants); whichever PR lands second rebases and keeps both edits. |
| A failed `GET /notifications` read flips the panel's `stale` line or `data-state`. | MEDIUM | The list's failure is local to the Recent section; `view` and `stale` keep reading only status and approvals (Touched-file invariants). |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-menu-bar-recent-notifications.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-24T08:18:08Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/129
- **Branch:** feature/menu-bar-recent-notifications
- **Files changed:** 25
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Recent list (20 newest notifications, title/age/delivery status, rows opened only via queue.receive(notificationRoute(id))) added to the menu-bar panel with empty/skeleton/error states, tests, regenerated evidence and doc sentences. Heal loop: iter 1 MEDIUM (new row out of view) fixed c71fbb2 with a "new above" hint; iter 2 two MEDIUM (untested hint branches, README drift) fixed 305ed9d; iter 3 HIGH (hint focused newest row without selecting it, breaking arrow keys) fixed cb028ab but not re-reviewed (loop bound reached). Required CI green at every review; AC1-AC10 judged addressed in every review.

## Not verified
- **docs/OPEN_QUESTIONS.md Known gaps (2)** — still says the app has no list of notifications; out of scope per the brief (phase 5 close-out updates it) (subtask 1)
- **Recent row age ticking (30 s interval)** — not observed ticking in a running app; ageText is unit-tested at fixed times (subtask 1)
