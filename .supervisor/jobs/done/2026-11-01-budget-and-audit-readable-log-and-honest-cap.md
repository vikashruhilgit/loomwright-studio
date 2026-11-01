# Supervisor Job: Budget & audit — a readable audit log (sentences, actor, count and paging) and an honest subscription cap (stale windows, display name), on the shared shell (phase 7, item 17)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-042119/L7
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090017-budget-and-audit-readable-log-and-honest-cap.md
- **Base commit:** daed1eab9fafe3f5429ca2d3f6efd13609bc7ada

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the Electron + React app (vitest, Playwright e2e) already serve and render this screen (`kernel/src/gui/budget-audit.ts`, `app/src/screens/budget/`). |
| 2 | Dependency Availability | GO | No new dependency. The `events.actor` column (`'kernel'`/`'api'`, migration 001) and `cap_state.updated_at` (migration 001) already exist; nothing needs a migration. |
| 3 | Architecture Fit | GO | The shell's shared band, `useKernelReach` and the `ScreenDefinition.Subtitle` slot landed in item 11 (PR #192). The new route fields are additive and optional, against the contract `app/src/api/contract.ts` declares. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 20 files and ~1,500 changed lines across kernel, app, e2e and docs. That is past the single-worker bound, so the brief splits into 3 serial subtasks (`context-bound`). |
| 5 | Hard Blockers | GO | The dependency (item 11, shell) is merged at base. The owner extended this item's Touches on 2026-11-01 (LP-CLARIFY) to cover the four paths outside it. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make Budget & audit's audit log read as sentences that name who did each thing, with an "N of M events" count and working Newer / Older paging. Make the cap card mark a window whose reset has passed as stale, with its last-read time, and label the account by its display name. Move the screen onto item 11's shared unreachable band and titlebar subtitle slot.

**Problem Statement:**
The owner needs to read their own audit trail and trust the cap state, because these are how they check what Wright and the crew did and whether the subscription cap is holding work.
Currently (live run 2026-11-01, `budget-populated` / `budget-audit`):
- Detail shows raw payloads and codes (`{"from_seq":9,"to_seq":9}`, `result_success`, `group_gone`).
- Actor reads "—" on every row.
- There is no "N of N events" count.
- The cap card shows a reset time from two days ago as current ("resets Fri 30 Oct 00:30" on Sun 1 Nov) and labels the account `subscription-token` (the provider id).
- With the kernel stopped, the screen replaces everything with "Status unknown", and its count line sits under the title instead of beside it.

This makes the log unreadable and the cap card misleading.
Success looks like this: every audit row is a sentence with a named actor, the count and paging match `budget-audit`, a past reset reads stale with its last-read time, and the label reads "personal subscription". With the kernel stopped, the screen keeps its data under the shared band, matching `budget-unreachable`.

**Owner decisions (2026-11-01, Launch Pad LP-CLARIFY, binding for this brief):**
- **Touches extended** with `app/src/api/contract.ts` (additive, optional fields only), `app/e2e/fixtures/budget.ts`, `docs/evidence/phase-7-polish/budget/` (README + PNGs) and `docs/architecture/budget.md`. These join the requirement's `app/src/screens/budget`, `kernel/src/gui/budget-audit.ts`, `kernel/test/gui-budget-audit.test.ts` and `app/e2e/budget.spec.ts`. Nothing else is edited; a worker that needs another file stops and says so (the requirement's owner decision).
- **Actor rule:** the event's session's agent, when the event has a session with an agent. Otherwise "you" when the stored `events.actor` is `'api'` (the owner, through the API). Otherwise "kernel".

**Phase 7 owner decisions carried from the requirement (unchanged):**
- D3, D4, D9, D12, D22, D24, D26–D29, D34 and D36 stand, as do invariants 1–9.
- No new audit kinds.
- No dollar figure beyond the existing "≈ at API rates" estimate (D24).
- Screenshots are taken from the running app against the fixture kernel through `app/e2e/electron-harness.ts`. No owner screenshot is committed.
- The owner's approval of the PR is the polish gate (D9).

**Design notes (grounded at base; the worker confirms against live code):**
- **Route fields (`GET /audit`).** Each event gains `actor: string`: the session's agent (`sessions.agent` through the existing LEFT JOIN), else `'you'` when `e.actor = 'api'`, else `'kernel'`. Compute it in the SELECT (`CASE WHEN s.agent IS NOT NULL AND s.agent <> '' THEN s.agent WHEN e.actor = 'api' THEN 'you' ELSE 'kernel' END`). The answer gains:
  - `matching`: the count of events under the same filters, without the `before` cursor or the limit.
  - `total`: the count of every event.

  Payloads stay as stored (invariant 3). The route stays read-only.
- **Contract placement for the audit fields.** Add `export interface AuditEvent extends EventFrame { readonly actor?: string }`. `AuditResponse.events` becomes `readonly AuditEvent[]`, and `AuditResponse` gains `readonly matching?: number` and `readonly total?: number`. `EventFrame` itself is unchanged: `GET /events` and the feed carry no `actor`.
- **The unknown-slug answer.** The route's early answer for a playbook slug that names no playbook (`{ events: [], next_before: null }`) also carries `matching: 0` and the real `total`. The kernel test pins it.
- **Count shape (for the pin mutations).** The count runs over the filter conditions only. They are collected in `filterWhere`/`filterParams` before the `before` cursor condition is pushed onto `where`/`params`, and the count's SQL uses `filterWhere.join(" AND ")`.
- **Route fields (`GET /budget/usage`).** Each `cap_state` window gains `updated_at`, from `cap_state.updated_at`: when the kernel last recorded the window. `GET /status` is not edited (`kernel/src/api/server.ts` is outside Touches). So the contract gets its own budget cap type (for example `BudgetUsageCapState`, whose windows carry `updated_at?: IsoTime`). `export type BudgetCapState = StatusBody["cap_state"];` keeps meaning `/status`'s shape. Every new contract field is optional, so an older kernel's answer still type-checks and renders.
- **Cap rules for an expired `allowed_warning`** (`kernel/src/budget/cap.ts` header; `activeParks` in `kernel/src/budget/internal.ts`):
  - Only a `rejected` row whose `resets_at` is null or still ahead is a park: `WHERE account = ? AND status = 'rejected'`.
  - `allowed_warning` never parks. It records a `cap_warning` once per window.
  - So a window whose `resets_at` has passed is over. Its stored status is what was last read, and admission does not wait on it.

  The card shows such a window as **stale**. It keeps the last-read status word ("warning", "allowed", "rejected") in a neutral tone with a "stale" mark and the caption "last read {updated_at} · window ended {resets_at}". It never shows "resets {past time}" as current. The cap note still says nothing is parked unless an unexpired `rejected` window exists. A rejected window whose reset has passed is not a park either.
- **Display name.** The cap label comes from the `status` resource's `account` for the same `provider`, when that is non-empty and differs from the provider id. Otherwise it is a display name per provider id: `subscription-token` → "personal subscription", `api-key` → "API key". Any other id shows as itself. This mirrors item 18's Settings rule ("when the provider has none, the mockup's wording").
- **Sentence table.** A sentence table in one module (`app/src/screens/budget/audit-sentences.ts`) maps each event kind to a function `(payload: unknown, refs) => string`. It reads payload fields defensively and renders them as plain text: the payload is untrusted data and never becomes markup. An unknown kind reads `"{kind} · no description yet"`. No JSON object is ever rendered.

  Its test reads `kernel/src` the way `app/src/screens/menubar/kernel-mirror.test.ts` does (`const KERNEL = `…). It collects every kind the kernel writes: each string-literal kind passed to an `appendEvent(` helper or written by an `INSERT INTO events` statement, and each exported `*_AUDIT_KINDS` list. It fails if any kind has no entry. A kind the scan cannot see (one built at run time) is listed explicitly in the test with the file that writes it.
- **Count and paging.** The `budget-audit` mockup:
  - The badge beside "Audit log" reads `{matching} of {total} events`.
  - The footer reads `Showing {a}–{b} of {matching} · page {p} of {P} · newest first`.
  - Newer and Older page by the existing keyset cursor.

  When the kernel sends no counts (an older kernel), the footer falls back to the current "Showing rows a–b · page N" text and no badge is drawn.
- **Shell adoption.**
  - When `useKernelReach(api).shellBand` is true, the screen keeps its last `ok` data under the band. It marks the data "last known" (`withLastKnown`) and turns off every control that needs the kernel (`title="Needs the kernel"`).
  - "Status unknown" appears only when the screen has never had data. No raw request text (method, path, reason) shows while unreachable.
  - When the listener restarts, the screen reads again on its own.
  - The overview's count line (`summaryText`) moves into `screen.Subtitle`. The audit view's subtitle reads "Audit log", as the mockup's `sub`. The screen's own `budget-tbar` keeps only the Audit log button.

## Acceptance Criteria
- [ ] **AC1** Given Budget & audit loaded with data, when the fixture kernel's listener stops, then the screen keeps its data under the shell's one shared band, marked "last known", with Audit log, Open the full log, the filters and the paging disabled. "Status unknown" and raw request text are absent. When the listener restarts, the screen refreshes on its own. This matches `budget-unreachable`.
- [ ] **AC2** Given Budget & audit, then its count line renders inside `data-testid="titlebar-subtitle"` beside the title, matching `budget-populated`, and the screen draws no count line of its own under the title bar. Given the audit view, then the subtitle reads "Audit log".
- [ ] **AC3** Given the audit log, then every row's Detail is a sentence from `app/src/screens/budget/audit-sentences.ts`, matching `budget-audit` (for example `draft_output_recorded` → "Draft review recorded for studio-sandbox #3. Recorded, not sent."). No `{`…`}` JSON object is visible in any row. An unknown kind reads "{kind} · no description yet". A unit test fails if any kind the kernel writes (scanned from `kernel/src`) has no entry.
- [ ] **AC4** Given an event with a session whose agent is set, an event whose stored actor is `'api'`, and a kernel event, when `GET /audit` answers, then their `actor` is the agent id, `you` and `kernel` respectively (pinned in `kernel/test/gui-budget-audit.test.ts`). The Actor column shows the agent's display name from the roster, "you", or "kernel", never "—".
- [ ] **AC5** Given more events than a page (the fixture's 20 events, 8 a page), then the badge reads "20 of 20 events" and the footer reads "Showing 1–8 of 20 · page 1 of 3 · newest first". Older and Newer walk pages 1–3 without overlap. A filter narrows `matching` while `total` stays. `GET /audit` returns `matching` (the filtered count without the cursor) and `total` (pinned in the kernel test).
- [ ] **AC6** Given a cap window whose `resets_at` is before now, then the card marks it stale and shows its last-read time from `updated_at`, never the past reset as current. `GET /budget/usage` returns each window's `updated_at` (pinned in the kernel test).
- [ ] **AC7** Given the subscription provider whose `status` entry has no account label (or one equal to its id), then the cap card's label reads "personal subscription", not `subscription-token`. Given a provider with an account label, then the card reads that label.
- [ ] **AC8** Given a stored `seven_day` `allowed_warning` window whose `resets_at` has passed, then a kernel test pins what the cap rules say:
  - `GET /budget/usage` returns it with its stored status and `updated_at`.
  - `activeParks` does not count it, so it is not a park and admission does not wait on it.

  The card reads it as a stale "warning" with its last-read time, and the cap note says nothing is parked.
- [ ] **AC9** Given the polish gate, then the committed evidence file `docs/evidence/phase-7-polish/budget/README.md` names a light and a dark screenshot from the running app (fixture kernel, `app/e2e/electron-harness.ts`, `BUDGET_EVIDENCE=1`) for every mockup view this item changes (`budget-populated`, `budget-unreachable`, `budget-audit`, `budget-audit-filtered`). Each PNG is committed beside it and named against its `gui-v2.html` view, the README lists any known remaining differences, and the PR body links to it.
- [ ] **AC10** Given the change, then `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, `bash scripts/check-docs.sh` and `cd kernel && npm ci && npm run typecheck && npm test` all pass. `docs/architecture/budget.md` describes `actor`, `matching`, `total` and the windows' `updated_at` (its "there is no total" line is corrected).

## Phase 3: ANALYZE (summary)

**Tech stack:** TypeScript (strict), kernel on Node + better-sqlite3 + vitest; app on Electron + React + vitest + Playwright.

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel route + contract + docs (subtask 1) | `kernel/src/gui/budget-audit.ts` (259), `kernel/test/gui-budget-audit.test.ts` (468), `app/src/api/contract.ts` (1446 — the single authority for route shapes: the fields are appended to its existing phase 7 item 07 block), `docs/architecture/budget.md` (121) | — | HIGH |
| app screen (subtask 2) | `app/src/screens/budget/AuditLog.tsx` (306), `app/src/screens/budget/BudgetScreen.tsx` (343), `app/src/screens/budget/index.tsx` (36), `app/src/screens/budget/Tables.tsx` (303), `app/src/screens/budget/model.ts` (550 — existing `actorOf`, `summaryOf`, `footerText`, `capCaption` and `capAccountLabel` change in place or move out; no new responsibility lands here), `app/src/screens/budget/model.test.ts` (380), `app/src/screens/budget/BudgetScreen.test.tsx` (1063 — only the existing pins that this change makes wrong are updated in place: "—" actor, "Showing rows" footer, "Status unknown"; new tests go in the CREATE files), `app/src/screens/budget/budget.css` (470) | `app/src/screens/budget/audit-sentences.ts` (sentence table), `app/src/screens/budget/audit-sentences.test.ts` (per-kind entries + kernel-kind coverage scan), `app/src/screens/budget/cap.ts` (stale window view + provider display name; `capCaption`/`capAccountLabel` move here from model.ts), `app/src/screens/budget/cap.test.ts`, `app/src/screens/budget/Subtitle.tsx` (the titlebar count line), `app/src/screens/budget/shell.test.tsx` (unreachable-keeps-data, subtitle slot) | HIGH (MEDIUM for the Subtitle data path) |
| e2e + evidence (subtask 3) | `app/e2e/fixtures/budget.ts` (297), `app/e2e/budget.spec.ts` (529 — owns the `BUDGET_EVIDENCE` screenshot helper and the README guards that the new shots must go through), `docs/evidence/phase-7-polish/budget/README.md` (92), the PNGs in `docs/evidence/phase-7-polish/budget/` (regenerated) | — | HIGH |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans `docs/`; `docs/architecture/budget.md` and the evidence README are the files it may flag. `app/e2e/budget.spec.ts`'s README test requires every PNG in the evidence dir to be named in the README and a light and dark file per named view.

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| subtask 1 | subtask 2 | none (2 consumes 1's contract types) | YES (requires) |
| subtask 2 | subtask 3 | none (3 drives 2's screen) | YES (requires) |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 2 hours ago, fetched >1h |

## Touched-file invariants

> Grounded at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/gui/budget-audit.ts`** — keep:
  - It is read-only: `Both routes are read-only: nothing is written.`
  - Payloads are untrusted, and a payload condition stays guarded by `json_valid`: `returned as stored, never interpreted`.
  - Its import graph loads no SDK: `never the Agent SDK, the session manager or`.

  Reuse: `limitOf`/`positiveIntegerOf` from `./query.js` and the existing `where`/`params` builder for the `matching` count, so the count and the page share one filter. Mirror: `app/src/api/contract.ts` `export interface AuditResponse` and the budget usage type. Pinned by: `kernel/test/gui-budget-audit.test.ts` and `kernel/test/feature-seams.test.ts` (`the feature registry's module graph (AC9)`).
- **`app/src/screens/budget/budget.css`** — keep: every colour comes from a design token, and every text pair keeps 4.5:1 in both themes. `app/src/screens/budget/contrast.test.ts` reads the file (`new URL("./budget.css", import.meta.url)`) and computes its pairs, so any new style (the stale mark, the neutral badge, the count badge) uses existing token pairs that this test covers.
- **`app/src/screens/budget/index.tsx`** — keep:
  - The single `screen` export with its id `budget`, title and nav entry. The shell discovers it through `import.meta.glob("./screens/*/index.tsx")`.
  - The no-bridge branch (`This window has no connection to the kernel.`).

  The new `Subtitle` must also render safely when `getBridge()` is undefined: it renders nothing, and it never throws.
- **Comments and copy that describe the old behaviour** (all inside existing lanes) are updated to match the new behaviour:
  - In subtask 2's lanes: the header comments of `AuditLog.tsx` ("there is no total", "Actor is the payload's own `agent` or \"—\""), `useAudit.ts` ("Keyset paging has no total"), the `actorOf` comment in `model.ts`, and the related `describe` title in `model.test.ts`.
  - In subtask 3's lanes: the evidence README's "No event total in the audit footer." known difference is removed, because AC5 delivers the total.
- **`kernel/test/gui-budget-audit.test.ts`** — keep: the existing `cap_state` equality pin `answers the same windows GET /status does (labels aside)`. It now compares with `updated_at` set aside too (the extra field is the budget route's own), never deleted.
- **`app/src/api/contract.ts`** — keep: `export type BudgetCapState = StatusBody["cap_state"];` keeps meaning `/status`'s shape (`GET /status` is not edited). Every new field is optional (an older kernel still type-checks). Mirror: `kernel/src/gui/budget-audit.ts`. Consumers that `satisfies AuditResponse` (`app/e2e/fixtures/budget.ts`, `app/e2e/fixture-kernel.ts`, other fixtures) must still compile: optional fields keep them valid.
- **`app/src/screens/budget/AuditLog.tsx`, `model.ts`, `Tables.tsx`, `BudgetScreen.tsx`** — keep:
  - Payload strings stay React text children: `Every payload string is untrusted data`. The `safe(...)` helper wraps every kernel string.
  - Keyset paging (`useAudit`) with no layout shift on refetch.
  - The existing test ids in `BUDGET_TEST_IDS` (`auditActor`, `auditDetail`, `footer`), so specs keep their handles.

  Reuse: `useKernelReach` and `withLastKnown` from `app/src/shell/last-known.ts` (`export function useKernelReach`), never a second connection check. Pinned by: `app/src/screens/budget/BudgetScreen.test.tsx` (`Showing rows 1–8 · page 1 · newest first`, `'Status unknown', never 'No tokens used yet.'`) and `model.test.ts`; update those pins to the new copy, never delete them.
- **`app/e2e/fixtures/budget.ts`** — keep: it answers as the kernel route does (`satisfies AuditResponse`). Its 20 events across three pages of 8 stay. Add `actor` per event, `matching`/`total`, and a cap window with a past `resets_at` plus `updated_at`. Its `/status` entry `account: "personal subscription"` gains a variant with no label, so AC7's fallback is exercised.
- **`app/e2e/budget.spec.ts`** — keep: the evidence guard `process.env.BUDGET_EVIDENCE === "1"` (CI never writes the tracked dir) and the README-names-every-file test. Pinned by: its own AC9 tests.
- **`docs/evidence/phase-7-polish/budget/README.md`** — keep: the regenerate command `BUDGET_EVIDENCE=1` and the table naming each light/dark pair against its mockup view.
- **`docs/architecture/budget.md`** — the line `Paging is by keyset, so there is no total` is corrected to describe `matching`/`total`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/gui-budget-audit.test.ts` — an API-stored event's actor is `you` | flip `WHEN e.actor = 'api' THEN 'you'` → `WHEN e.actor = 'api' THEN 'kernel'` in `kernel/src/gui/budget-audit.ts` |
| `kernel/test/gui-budget-audit.test.ts` — a session event's actor is its agent | flip `THEN s.agent` → `THEN NULL` in `kernel/src/gui/budget-audit.ts` |
| `kernel/test/gui-budget-audit.test.ts` — `matching` on page 2 equals the whole filtered count (the cursor is not counted) | flip `filterWhere.join(" AND ")` → `where.join(" AND ")` in `kernel/src/gui/budget-audit.ts` |
| `kernel/test/gui-budget-audit.test.ts` — each cap window carries `updated_at` | flip `reset_source, updated_at FROM cap_state` → `reset_source, NULL AS updated_at FROM cap_state` in `kernel/src/gui/budget-audit.ts` (the windows SELECT, final text; verified killed) |
| `kernel/test/gui-budget-audit.test.ts` — neither an expired nor an unexpired `allowed_warning` is a park (the pin seeds both, so the status clause is tested on its own) | flip `status = 'rejected'` → `status IN ('rejected', 'allowed_warning')` in `kernel/src/budget/internal.ts` (scratch copy only; the file is not edited). The unexpired `allowed_warning` then counts as a park, and the pin turns red. |
| `app/src/screens/budget/audit-sentences.test.ts` — every kernel-written kind has an entry | delete `task_created:` in `app/src/screens/budget/audit-sentences.ts` |
| `app/src/screens/budget/audit-sentences.test.ts` — an unknown kind reads "no description yet" | flip `no description yet` → `{}` in `app/src/screens/budget/audit-sentences.ts` |
| `app/src/screens/budget/cap.test.ts` — a past reset reads stale | flip `resetMs <= nowMs` → `resetMs > nowMs` in `app/src/screens/budget/cap.ts` |
| `app/src/screens/budget/cap.test.ts` — subscription provider's display name | flip `"personal subscription"` → `"subscription-token"` in `app/src/screens/budget/cap.ts` |
| `app/src/screens/budget/shell.test.tsx` — unreachable keeps data | flip `const keepLastData = hasData && reach.shellBand;` → `const keepLastData = false;` in `app/src/screens/budget/BudgetScreen.tsx` (the worker writes the data-keeping condition as this one named line) |

Where a worker's final code uses a different literal than the ones above, it updates the row's literal to the one in its diff in the same commit, so each row stays machine-applicable.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `GET /audit` actor + matching/total, `GET /budget/usage` window `updated_at`, the expired-`allowed_warning` pin, contract types, architecture doc | AC4, AC5 (route), AC6 (route), AC8 (kernel pin), AC10 (kernel suite + `bash scripts/check-docs.sh` + `cd app && npm run typecheck`) | 4 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | App: audit sentences, actor, count and paging, stale cap + display name, shared band and titlebar subtitle | AC1–AC8 (screen), AC10 limited to `cd app && npm ci && npm run typecheck && npm test && npm run build` and `bash scripts/check-docs.sh`. `npm run e2e` is subtask 3's: the e2e fixture gains `actor` and the counts only there. | 8 modify, 6 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |
| 3 | E2E + polish evidence: fixture fields, spec checks for AC1–AC7, regenerated light/dark screenshots and README | AC1, AC2, AC3, AC5, AC6, AC7, AC9, AC10 (the full validation, `npm run e2e` included) | 3 modify (+ PNGs), 0 create | `skills/playwright-e2e/SKILL.md` | BLOCKED (by #2) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "type", path: "app/src/api/contract.ts", name: "AuditEvent"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "BudgetUsageCapState"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "matching"}
  - {kind: "symbol", path: "kernel/src/gui/budget-audit.ts", name: "filterWhere"}
requires: []
external_requires: []
lanes:
  - "kernel/src/gui/budget-audit.ts"
  - "kernel/test/gui-budget-audit.test.ts"
  - "app/src/api/contract.ts"
  - "docs/architecture/budget.md"
```

```yaml
# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/budget/audit-sentences.ts"}
  - {kind: "file", path: "app/src/screens/budget/cap.ts"}
  - {kind: "file", path: "app/src/screens/budget/Subtitle.tsx"}
  - {kind: "symbol", path: "app/src/screens/budget/index.tsx", name: "Subtitle"}
requires:
  - {from: 1, kind: "type", path: "app/src/api/contract.ts", name: "AuditEvent"}
  - {from: 1, kind: "type", path: "app/src/api/contract.ts", name: "BudgetUsageCapState"}
  - {from: 1, kind: "symbol", path: "app/src/api/contract.ts", name: "matching"}
external_requires: []
lanes:
  - "app/src/screens/budget/**"
```

```yaml
# Subtask 3
provides:
  - {kind: "symbol", path: "app/e2e/budget.spec.ts", name: "AC5: the audit log shows the 'N of M events' count and pages Older and Newer"}
  - {kind: "symbol", path: "app/e2e/fixtures/budget.ts", name: "matching"}
  - {kind: "symbol", path: "docs/evidence/phase-7-polish/budget/README.md", name: "stale"}
requires:
  - {from: 2, kind: "file", path: "app/src/screens/budget/audit-sentences.ts"}
  - {from: 2, kind: "symbol", path: "app/src/screens/budget/index.tsx", name: "Subtitle"}
  - {from: 1, kind: "symbol", path: "app/src/api/contract.ts", name: "matching"}
external_requires: []
lanes:
  - "app/e2e/fixtures/budget.ts"
  - "app/e2e/budget.spec.ts"
  - "docs/evidence/phase-7-polish/budget/**"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | YES (requires: contract types) |
| Subtask 2 | Subtask 3 | none | YES (requires: the screen the spec drives) |
| Subtask 1 | Subtask 3 | none | YES (transitively ordered) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after 1)
- **Batch 3:** Subtask 3 (after 2)
- **Recommended workers:** 1
- **Estimated batches:** 3

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` |
| 3 | `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope past one worker's context (~20 files, ~1,500 lines) — Feasibility (Phase 2.5) | MEDIUM | Three serial subtasks along the kernel → app → e2e seam (`context-bound`). Each owns disjoint lanes. |
| Many audit kinds, some written with a run-time kind string the source scan cannot see | MEDIUM | The table lives in one module. The coverage test scans `kernel/src` like `kernel-mirror.test.ts` and lists every run-time kind explicitly with the file that writes it. An unknown kind still reads "{kind} · no description yet", never JSON. |
| Prior churn (postmortem ledger): `app/src/api/contract.ts` (10 rounds), `kernel/src/gui/budget-audit.ts` (2), `app/e2e/budget.spec.ts` (1), `app/src/screens/budget/model.ts` (1); recurring class `self_heal_churn` | MEDIUM | Keep contract changes additive and optional, and mirror the kernel's field names exactly. Run the full app and kernel suites (AC10) before hand-back so Phase 4.5 does not chase type drift. |
| `matching` adds a `COUNT(*)` over `events` per page read | LOW | It is a local SQLite store, and the count reuses the page's own filter (no new index). Note it in `docs/architecture/budget.md`. |
| The Subtitle component has no props, so it needs the screen's usage data without a second fetch | MEDIUM | Keep one read: a small holder in the budget folder that the screen updates and `Subtitle.tsx` subscribes to (no edit to the shared store or shell). The worker chooses the mechanism and pins it in `shell.test.tsx`. |
| The mockup has no stale-window state, so its copy is the brief's | LOW | Use the brief's copy ("stale", "last read …", "window ended …"). The evidence README lists it under known remaining differences for the owner's D9 review. |
| An older kernel without the new fields | LOW | Every field is optional. The footer falls back to the current text and the Actor to "kernel", unit-tested in `model.test.ts`/`cap.test.ts`. |
| Screenshots differ by font between macOS and the CI run | LOW | The spec checks behaviour, never pixels (existing convention). Regenerate on macOS with `BUDGET_EVIDENCE=1`. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-budget-and-audit-readable-log-and-honest-cap.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T10:25:11Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/197
- **Branch:** feature/budget-and-audit-readable-log-and-honest-cap
- **Files changed:** 42
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** 3 serial subtasks (kernel route + contract, app screen, e2e + evidence) plus one owner-approved out-of-Touches line (app/src/shell/frame.test.tsx:94). Phase 4.5 review PASS on the first pass with 3 LOW findings dismissed below the MEDIUM floor; required CI green. Review drain not dispatched (.supervisor/config.json auto_review=false).

## Not verified
- **App screen consuming the new /audit and /budget/usage fields** — subtask 2's lane; only app typecheck run (subtask 1)
- **App test suite and e2e** — outside subtask 1 (subtask 1)
- **Packaged Electron app rendering** — e2e is subtask 3 (subtask 2)
- **Kernel stopped and restarted against a real listener** — only the scripted fake bridge in shell.test.tsx (subtask 2)
- **Audit footer text in the PNGs** — below the fold at 760 px; spec asserts the text (subtask 3)
- **Unknown-kind row in Electron** — no unknown kind in the fixture; unit-pinned (subtask 3)
- **Older-kernel fallback footer** — fixture always sends counts; unit-pinned (subtask 3)
- **npm ci steps of AC10** — node_modules already present (subtask 3)
