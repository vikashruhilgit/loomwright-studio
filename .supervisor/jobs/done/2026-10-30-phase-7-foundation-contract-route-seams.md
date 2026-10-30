# Supervisor Job: Phase 7 foundation: the GUI v2 contract, the `gui` kernel route seams, and six screen stubs

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-142644/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140001-phase-7-foundation-contract-route-seams-and-screen-stubs.md
- **Base commit:** 94cc13ca0bd810e4258c2b335d4a08228a2a67fd

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TS kernel (vitest) + React/Electron app (vitest, Playwright); everything here is types, empty parts, stubs and tests in the existing stack |
| 2 | Dependency Availability | GO | No new dependency |
| 3 | Architecture Fit | GO | Same foundation shape as phase 6 (`INTEGRATIONS_PARTS` of empty parts, `consoleContributionOf` merge) and phase 5 (contract first, read as text by `console-contract.test.ts`) |
| 4 | Scope vs Supervisor Capability | CAUTION | ~28 small files; above the one-worker bound (>12 files), split three ways with zero file overlap |
| 5 | Hard Blockers | CAUTION | The memory write is `PUT /memory/file`; the app's `HttpMethod` is `"GET" \| "POST"` and `app/src/api/contract.test.ts` asserts only GET/POST. The kernel already accepts PUT (`ROUTE_METHODS` in `kernel/src/features/contribution.ts`). This item widens the app side |

**Overall Verdict:** CAUTION

## Task
**Goal:** Declare every phase 7 request/response shape in the app contract, add an empty six-part `gui` kernel feature registered last, add six placeholder screens with nav entries, answer every new route from the e2e fixture kernel, and record the phase 7 scope notes in the docs. The six screen items can then run in parallel without editing shared files.

**Problem Statement:**
The builder of phase 7's six screens (items 03–08) needs the app contract, the kernel route seams and an empty stub for each screen in place first. Without them, every screen item edits `app/src/api/contract.ts`, `kernel/src/features/index.ts`, `app/e2e/fixture-kernel.ts`, the sidebar pins and the docs, and the parallel lanes collide.
Currently, no read route exists for tasks, playbook runs and versions, the schedule, trigger fires, memory, budget usage, audit or settings, and the contract declares none of their shapes.
Success looks like the six screen items each touching only their own `kernel/src/gui/<part>.ts`, `app/src/screens/<id>/` and their own tests.

## Acceptance Criteria
- [ ] **AC1:** Given `app/src/api/contract.ts`, when the shapes are reviewed, then it declares every request and response shape items 03–08 serve or read (listed in **Contract shapes** below), each route has a `CONTRACT_ROUTES` entry and a `ContractRouteMap` entry, and `HttpMethod` admits `"PUT"`. And `kernel/test/console-contract.test.ts` pins the 12 phase 7 routes by origin as not yet served (`p7-item-NN`, never counted as existing).
- [ ] **AC2:** Given a fresh kernel, when `SHIPPED_CONTRIBUTIONS` is merged, then the `gui` contribution (`kernel/src/gui/index.ts`) is tenth and last and merges with no conflict. `GUI_PARTS` names `tasks`, `playbook-history`, `schedules`, `memory`, `budget-audit`, `settings` in that order, each present and empty. `kernel/test/gui-foundation.test.ts` pins the order, that each part is empty, and that no gui part route sets `unauthenticated` (every gui route is an owner route that needs the API token). And `feature-seams.test.ts`, `console-foundation.test.ts` and `integrations-foundation.test.ts` pass with their registry pins updated.
- [ ] **AC3:** Given the app, when it renders, then each of `tasks`, `playbooks`, `schedules`, `memory`, `budget`, `settings` is reachable from its sidebar entry and, where one is set, its shortcut. The entries are Tasks ⌘6, Playbooks ⌘7, Schedules ⌘8, Memory ⌘9, Budget & audit (no shortcut), Settings ⌘, at nav orders 6–11. Each renders the shared "coming in this phase" placeholder. `App.test.tsx` and `app/e2e/smoke.spec.ts` pin the eleven entries and the palette commands.
- [ ] **AC4:** Given the fixture kernel with no per-spec routes, when any of the 11 new GET routes is called, then it answers 200 with a body typed `satisfies <its contract response type>` (empty lists, `null` cursors, a canned settings view), so `npm run typecheck` (tsconfig.node.json includes `e2e`) checks each body against the contract. `PUT /memory/file` gets no default; item 06 adds it.
- [ ] **AC5:** Given `docs/UI.md`, when read, then it records that Hooks moved to phase 9 (owner, 2026-10-30) and what Tasks shows in phase 7. Given `docs/ARCHITECTURE.md`, then a `## Phase 7 features` section names the `gui` feature, its six parts and the `p7-item-NN` routes. And `bash scripts/check-docs.sh` passes.
- [ ] **AC6:** Given the validation commands, when run, then `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test && npm run build`, and `bash scripts/check-docs.sh` all pass. Subtask 3 also runs `cd app && npx playwright test e2e/smoke.spec.ts --workers=1` (CI's e2e job runs the full suite).

### Contract shapes (AC1)

Declare these in `app/src/api/contract.ts` under one `// ---- Phase 7 …` banner per item, following the file's conventions: `readonly` fields, `IsoTime` for times, open `string` for kernel enums the app renders as text, and untrusted strings commented as such. Ground every field in a real column or existing kernel type: `tasks`, `playbook_runs`, `playbook_versions`, `wakeups`, `events`, `budget` and `cap_state` in `kernel/src/store/migrations/`, plus `kernel/src/brain/memory.ts` and `kernel/src/agents/memory.ts` for the memory layout. Never invent a column. Paged lists take `before`/`limit` query strings and answer a `next_before: … | null` cursor. Tokens are counted per D26. Dollars appear only as an estimate field named `*_estimate_usd` and documented as "≈ at API rates" (D24).

| Origin | Route (`CONTRACT_ROUTES`, one line each) | Types to declare |
|---|---|---|
| `p7-item-03` | `GET /tasks` | `TaskBoardKind` (`"task" \| "playbook_run" \| "session"`), `TaskBoardItem`, `TaskBoardGroup` (one state, its items), `TasksQuery`, `TasksResponse` |
| `p7-item-03` | `GET /tasks/:kind/:id` | `TaskHistoryResponse` (the item, its events as `EventFrame`s, its runs, its sessions as `SessionSummary`, approvals naming it as `Approval`) |
| `p7-item-04` | `GET /playbooks/:id/runs` | `PlaybookRun` (status, item ref, revision, tokens, session, started, ended), `PlaybookRunsQuery`, `PlaybookRunsResponse` |
| `p7-item-04` | `GET /playbooks/:id/versions` | `PlaybookVersion`, `PlaybookVersionsResponse` |
| `p7-item-05` | `GET /schedule` | `ScheduleEntryKind` (`"trigger" \| "wakeup"`), `ScheduleEntry`, `ScheduleQuery`, `ScheduleResponse` |
| `p7-item-05` | `GET /triggers/:id/fires` | `TriggerFire` (the event kind, time, a missed fire's reason), `TriggerFiresQuery`, `TriggerFiresResponse` |
| `p7-item-06` | `GET /memory` | `MemoryFileEntry` (path, size, modified time), `MemoryAgentFiles`, `MemoryTreeResponse` (agents' files and shared files) |
| `p7-item-06` | `GET /memory/file` | `MemoryFileQuery` (`path`), `MemoryFileResponse` (path, content, content hash) |
| `p7-item-06` | `PUT /memory/file` | `MemoryWriteBody` (path, content, base hash), `MemoryWriteResponse`, `MemoryWriteRefusal` (closed union of refusal codes, `changed_since_read` included), `MemoryConflictError` (`ApiError` with `error: "changed_since_read"` plus the current content and hash) |
| `p7-item-07` | `GET /budget/usage` | `BudgetUsageQuery` (`days`), `BudgetUsageRow` (day, agent, playbook, counted tokens, cache reads shown and not counted, `*_estimate_usd`), `BudgetLimitUsage` (sessions at once and tokens per day against each limit), `BudgetUsageResponse` (rows, limits, the cap state) |
| `p7-item-07` | `GET /audit` | `AuditQuery` (kind, agent, playbook, since, until, before, limit), `AuditResponse` (`EventFrame`s, newest first, `next_before`) |
| `p7-item-08` | `GET /settings` | `NotifierKind` (`"terminal-notifier" \| "osascript" \| "none"`), `SettingsResponse` (active provider, its `AuthHealth` and token state, never a secret; the data dir; the notifier; the Loomwright install the adapter resolved) |

`RouteOrigin` gains `"p7-item-03"` … `"p7-item-08"`. The `CONTRACT_ROUTES` doc comment and the file header gain one paragraph on phase 7's origins, in the existing phase 6 paragraph's style.

## Touched-file invariants

> Grounded at base `94cc13ca0bd810e4258c2b335d4a08228a2a67fd`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/api/contract.ts`** — keep: every `CONTRACT_ROUTES` entry on one line in the exact form `{ method: "…", path: "…", origin: "…" },` (the header says `keep each entry on one line, in the \`{ method: "…", path: "…", … }\` form`; `console-contract.test.ts` parses with `ENTRY_LINE` and throws `CONTRACT_ROUTES line is not one entry` on any other line, comments included); the list stays `Object.freeze([` … `]);`; `ContractRouteMap` is keyed `"<METHOD> <path>"` exactly as in `CONTRACT_ROUTES` (`Each route's query, body and success body, keyed`); `SessionOutputKind` stays untouched. mirror: `app/electron/kernel-connection.ts` derives `CALLABLE` from `CONTRACT_ROUTES` by method + segments (`const CALLABLE = CONTRACT_ROUTES.filter`), so a new route is callable as soon as it is listed. pinned by: `kernel/test/console-contract.test.ts` (`EXPECTED_ROUTES`), `app/src/api/contract.test.ts` (`holds only GET and POST routes`).
- **`app/src/api/contract.test.ts`** — keep: `lists each route once`, `is frozen`, the path regex `/^(\/(:?[a-z][a-z0-9-]*))+$/` (all 12 new paths match it). Change `expect(["GET", "POST"]).toContain(route.method)` to admit `PUT`, and add a pin that `PUT` appears only on `PUT /memory/file`.
- **`kernel/test/console-contract.test.ts`** — keep: it reads contract.ts as TEXT, never imports it (`is read as TEXT, never imported`); `EXPECTED_ROUTES` stays a literal list in contract order; the existing-route count `toHaveLength(31)` stays 31, because phase 7 adds no existing route. Widen `isExisting`, currently `!/^(p6-)?item-\d{2}$/.test(entry.origin)`, to treat `p7-item-NN` as not existing. Otherwise the 12 new routes count as existing and fail `unserved`. Add a `lists phase 7's twelve routes as not yet served` pin beside `lists phase 6's six routes as not yet served`, and update the header comment's pin list.
- **`kernel/src/features/index.ts`** — keep: the `Object.freeze([` registry and the header rule that the CLI loads it, so `neither it nor anything it loads may import the Agent SDK, the session manager or` `kernel.ts`; `guiContribution` is appended after `integrationsContribution,`, and the header comment's feature list gains phase 7's `gui`. Companion (`.agent/companions.json`): `"when": "kernel/src/features/index.ts", "add": ["kernel/test/feature-seams.test.ts"]`.
- **`kernel/test/feature-seams.test.ts`** — keep everything except the three contributor lists ending `"console", "integrations"]` (the `SHIPPED_CONTRIBUTIONS.map((c) => c.name)`, `merged.contributors` and `kernel.contributions.contributors` assertions), which gain `"gui"`. The module-graph pin must keep passing, so `kernel/src/gui/**` imports only types, `../console/index.js` (`consoleContributionOf`) and its own parts.
- **`kernel/test/integrations-foundation.test.ts`** — the test `it("is registered last, after console", …)` stops holding on both of its lines. Retitle it `is ninth, after console, before gui`. Change `expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name).slice(-2)).toEqual(["console", INTEGRATIONS_NAME]);` to `.slice(7, 9)`. Change `expect(SHIPPED_CONTRIBUTIONS.at(-1)).toBe(integrationsContribution);` to `SHIPPED_CONTRIBUTIONS[8]`, matching `console-foundation.test.ts`'s `expect(SHIPPED_CONTRIBUTIONS[8]?.name).toBe("integrations");`. Keep the rest. In `kernel/test/feature-seams.test.ts`, the title `the nine features in a fixed order` becomes `the ten features in a fixed order`.
- **`kernel/src/integrations/index.ts`** — a comment-only edit: `ninth and last, after` `console` becomes ninth, after `console`, before phase 7's `gui`. No code change.
- **`kernel/src/gui/*` (new, mirrors integrations)** — reuse: each part file has the shape of the phase 6 empty part (`Object.freeze({ name, tools: Object.freeze([]), routes: Object.freeze([]), subcommands: Object.freeze([]), handlers: Object.freeze({}), dueWork: Object.freeze([]) })`), typed `GuiPart = ConsolePart` from `kernel/src/gui/types.ts`. It also exports its routes as a named frozen empty array (`tasksRoutes`, … `settingsRoutes`), so a screen item fills one array in one file. The contribution is `consoleContributionOf(GUI_PARTS)` with `name: GUI_NAME` (`"gui"`), as `integrationsContributionOf` does. `GUI_PARTS` stays on one line in part order.
- **`app/e2e/fixture-kernel.ts`** — keep: `DEFAULT_ROUTES: Partial<Record<RouteKey, FixtureRoute>>` and the `satisfies <Response>` idiom of `"GET /drafts": () => ({ status: 200, body: { drafts: [] } satisfies DraftsResponse })`; per-spec `routes` still merge over defaults; the `FixtureKernelOptions.routes` doc comment lists the new defaults.
- **`app/src/App.test.tsx`** and **`app/e2e/smoke.spec.ts`** — keep the shell's other pins (band, not-installed setup commands, Chat first). The sidebar list `["Chat⌘1", "Team⌘2", "Approvals⌘3", "Sessions⌘4", "Integrations⌘5"]`, the routing loop's ids and the palette list `["screens.integrations", "Screens", "⌘5"]` gain the six new entries in nav order. Budget & audit shows no key, and its palette row carries an `undefined` shortcut. The smoke test's title and comments stop saying "six entries".
- **`docs/ARCHITECTURE.md`** / **`docs/UI.md`** — keep relative links resolving (`check-docs.sh` check 1). ARCHITECTURE gains `## Phase 7 features` after `## Phase 6 features`, in that section's style. UI.md gets its notes after the paragraph `**Integrations is phase 6, GitHub only**`, and leaves the `| **Hooks** |` row as it is.

## Closed enumerations touched

> Sibling grep at base `94cc13c`: `grep -rnF 'p6-item-' kernel app docs` → hits in `app/src/api/contract.ts`, `kernel/test/console-contract.test.ts`, `kernel/test/integrations-github-connector.test.ts`, `docs/ARCHITECTURE.md`. `grep -rnF '"console", "integrations"' kernel app docs` → 3 hits in `kernel/test/feature-seams.test.ts`. `grep -rn 'SHIPPED_CONTRIBUTIONS\.at(\|SHIPPED_CONTRIBUTIONS\[' kernel/test` → `console-foundation.test.ts`, `playbooks-foundation.test.ts`, `integrations-foundation.test.ts`, `agents-foundation.test.ts`, `loomwright-adapter.test.ts`. `grep -rn '"GET" | "POST"\|\["GET", "POST"\]' app` → `contract.ts`, `contract.test.ts`.

- **`p7-item-03` … `p7-item-08`** (sibling: `p6-item-03`). Must be named in:
  - `app/src/api/contract.ts`: `export type RouteOrigin =`, a closed union. Extend.
  - `kernel/test/console-contract.test.ts`: `const isExisting = (entry: ContractEntry): boolean => !/^(p6-)?item-\d{2}$/.test(entry.origin);` and `EXPECTED_ROUTES`. Extend.
  - `kernel/test/integrations-github-connector.test.ts`: `the shipped routes part serves exactly the contract's four p6-item-03 routes`. No change: it filters by its own origin.
  - `docs/ARCHITECTURE.md`: prose. Extend in the new Phase 7 section.
- **`"gui"`** (sibling: `"integrations"` in the registry). Must be named in:
  - `kernel/test/feature-seams.test.ts`: the three `toEqual([... "console", "integrations"])` lists. Extend.
  - `kernel/test/integrations-foundation.test.ts`: `SHIPPED_CONTRIBUTIONS.map((c) => c.name).slice(-2)` and `SHIPPED_CONTRIBUTIONS.at(-1)`. Change to `.slice(7, 9)` and index 8, and retitle the test. (A second grep, `grep -rn 'SHIPPED_CONTRIBUTIONS.map((c) => c.name).slice' kernel/test`, found this hit; it has no other hits.)
  - `kernel/test/feature-seams.test.ts`: the title `the nine features`. Change to `the ten features`.
  - `kernel/test/console-foundation.test.ts`: `SHIPPED_CONTRIBUTIONS[8]?.name).toBe("integrations")`. No change: the index still holds.
  - `kernel/test/playbooks-foundation.test.ts`, `agents-foundation.test.ts`, `loomwright-adapter.test.ts`: indices 0, 5 and 6. No change.
- **`"PUT"`** (sibling: `"POST"` in the app's method set). Must be named in:
  - `app/src/api/contract.ts`: `export type HttpMethod = "GET" | "POST";`. Extend.
  - `app/src/api/contract.test.ts`: `expect(["GET", "POST"]).toContain(route.method)`. Extend.
  - `kernel/src/features/contribution.ts`: `ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]`. No change: it already has PUT.
  - `kernel/test/console-contract.test.ts`: `ENTRY_LINE` method group `([A-Z]+)`. No change: it already matches PUT.
- **Sidebar entries** (sibling: `"Integrations⌘5"`). Must be named in `app/src/App.test.tsx` and `app/e2e/smoke.spec.ts`. Extend both.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-contract.test.ts` — `are exactly the routes listed here` and the phase 7 not-served pin | flip `{ method: "PUT", path: "/memory/file", origin: "p7-item-06" },` → `{ method: "POST", path: "/memory/file", origin: "p7-item-06" },` in `app/src/api/contract.ts` |
| `kernel/test/console-contract.test.ts` — `every route marked existing is one the kernel serves` (the widened `isExisting`) | flip `{ method: "GET", path: "/settings", origin: "p7-item-08" },` → `{ method: "GET", path: "/settings", origin: "settings" },` in `app/src/api/contract.ts` (an unserved route marked existing goes red) |
| `app/src/api/contract.test.ts` — PUT only on `/memory/file` | flip `{ method: "GET", path: "/audit", origin: "p7-item-07" },` → `{ method: "PUT", path: "/audit", origin: "p7-item-07" },` in `app/src/api/contract.ts` |
| `kernel/test/feature-seams.test.ts` — the contributor lists | delete `  guiContribution,` in `kernel/src/features/index.ts` |
| `kernel/test/gui-foundation.test.ts` — part order | flip `budgetAuditPart, settingsPart` → `settingsPart, budgetAuditPart` in `kernel/src/gui/index.ts` |
| `kernel/test/gui-foundation.test.ts` — gui is tenth and last in the registry | delete `  guiContribution,` in `kernel/src/features/index.ts` |
| `app/src/App.test.tsx` — sidebar entries and palette shortcuts | flip `shortcut: "⌘,"` → `shortcut: "⌘0"` in `app/src/screens/settings/index.tsx` |
| `kernel/test/gui-foundation.test.ts` — each part is empty, and no gui route sets `unauthenticated` | flip `export const tasksRoutes: readonly ContributedRoute[] = Object.freeze([]);` → `export const tasksRoutes: readonly ContributedRoute[] = Object.freeze([{ method: "GET", path: "/tasks", unauthenticated: true, handler: () => ({ status: 200, body: {} }) } as unknown as ContributedRoute]);` in `kernel/src/gui/tasks.ts`. This turns the empty-part pin red, and the test's unauthenticated pin is written to also fail on this route. Subtask 1 writes `tasksRoutes` as exactly that one-line declaration. The test must check `unauthenticated` across `GUI_PARTS.flatMap((p) => p.routes)` so the pin bites when items fill the parts |
| `app/e2e/fixture-kernel.ts` — `satisfies` typecheck of the new defaults (`npm run typecheck`) | flip `next_before: null } satisfies TasksResponse` → `} satisfies TasksResponse` in `app/e2e/fixture-kernel.ts` (dropping a required field fails tsc) |
| `app/e2e/smoke.spec.ts` — the eleven sidebar entries | flip `nav: { label: "Budget & audit", order: 10 },` → `nav: undefined,` in `app/src/screens/budget/index.tsx` (also red in `App.test.tsx`) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel `gui` feature: six empty parts, registered last, with its foundation test | AC2, AC6 (kernel) | 4 modify, 9 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | App contract: phase 7 shapes and routes, PUT, the kernel-side pin, fixture defaults | AC1, AC4, AC6 (kernel + app) | 4 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 3 | Six screen stubs, the shared placeholder, sidebar pins, docs | AC3, AC5, AC6 (app + docs) | 4 modify, 7 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 kernel-gui | `kernel/src/features/index.ts` (65), `kernel/test/feature-seams.test.ts` (1150 — three list literals only; the registry's single test authority, companion-declared), `kernel/test/integrations-foundation.test.ts` (876 — one assertion), `kernel/src/integrations/index.ts` (106 — comment only) | `kernel/src/gui/index.ts`, `kernel/src/gui/types.ts`, `kernel/src/gui/tasks.ts`, `kernel/src/gui/playbook-history.ts`, `kernel/src/gui/schedules.ts`, `kernel/src/gui/memory.ts`, `kernel/src/gui/budget-audit.ts`, `kernel/src/gui/settings.ts`, `kernel/test/gui-foundation.test.ts` | HIGH |
| 2 contract | `app/src/api/contract.ts` (1012 — appended: the requirement names it the single file every screen item codes against, and the kernel pin reads it as text), `app/src/api/contract.test.ts` (23), `kernel/test/console-contract.test.ts` (245), `app/e2e/fixture-kernel.ts` (248) | — | HIGH |
| 3 screens+docs | `app/src/App.test.tsx` (89), `app/e2e/smoke.spec.ts` (66), `docs/ARCHITECTURE.md` (278), `docs/UI.md` (60) | `app/src/screens/placeholder.tsx` (the one home for the "coming in this phase" placeholder; the shell globs only `./screens/*/index.tsx`, so it is never mounted as a screen), `app/src/screens/tasks/index.tsx`, `app/src/screens/playbooks/index.tsx`, `app/src/screens/schedules/index.tsx`, `app/src/screens/memory/index.tsx`, `app/src/screens/budget/index.tsx`, `app/src/screens/settings/index.tsx` | HIGH |

Module layout: `contract.ts` (1012) and `feature-seams.test.ts` (1150) are past the 500-line threshold. The reasons for appending are given inline above. The kernel's six parts each get their own CREATE file, and the placeholder gets one shared CREATE module instead of six copies.

**Total estimated files:** 12 modify + 16 create

### Subtask Contracts

```yaml
# Subtask 1 — kernel gui feature (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/gui/index.ts"}
  - {kind: "symbol", path: "kernel/src/gui/index.ts", name: "GUI_PARTS"}
  - {kind: "symbol", path: "kernel/src/gui/index.ts", name: "GUI_NAME"}
  - {kind: "symbol", path: "kernel/src/gui/index.ts", name: "guiContribution"}
  - {kind: "symbol", path: "kernel/src/gui/index.ts", name: "guiContributionOf"}
  - {kind: "type", path: "kernel/src/gui/types.ts", name: "GuiPart"}
  - {kind: "symbol", path: "kernel/src/gui/tasks.ts", name: "tasksPart"}
  - {kind: "symbol", path: "kernel/src/gui/playbook-history.ts", name: "playbookHistoryPart"}
  - {kind: "symbol", path: "kernel/src/gui/schedules.ts", name: "schedulesPart"}
  - {kind: "symbol", path: "kernel/src/gui/memory.ts", name: "memoryPart"}
  - {kind: "symbol", path: "kernel/src/gui/budget-audit.ts", name: "budgetAuditPart"}
  - {kind: "symbol", path: "kernel/src/gui/settings.ts", name: "settingsPart"}
  - {kind: "symbol", path: "kernel/src/features/index.ts", name: "guiContribution"}
  - {kind: "file", path: "kernel/test/gui-foundation.test.ts"}
requires: []
lanes:
  - "kernel/src/gui/**"
  - "kernel/src/features/index.ts"
  - "kernel/src/integrations/index.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/gui-foundation.test.ts"
external_requires: []

# Subtask 2 — app contract (LAUNCHABLE)
provides:
  - {kind: "type", path: "app/src/api/contract.ts", name: "TasksResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "TaskHistoryResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "PlaybookRunsResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "PlaybookVersionsResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "ScheduleResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "TriggerFiresResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "MemoryTreeResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "MemoryFileResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "MemoryWriteBody"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "MemoryConflictError"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "BudgetUsageResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "AuditResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "SettingsResponse"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "p7-item-06"}
  - {kind: "symbol", path: "kernel/test/console-contract.test.ts", name: "p7-item-08"}
  - {kind: "symbol", path: "app/e2e/fixture-kernel.ts", name: "GET /settings"}
requires: []
lanes:
  - "app/src/api/contract.ts"
  - "app/src/api/contract.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "app/e2e/fixture-kernel.ts"
external_requires: []

# Subtask 3 — screen stubs and docs (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/screens/placeholder.tsx"}
  - {kind: "symbol", path: "app/src/screens/tasks/index.tsx", name: "screen"}
  - {kind: "symbol", path: "app/src/screens/playbooks/index.tsx", name: "screen"}
  - {kind: "symbol", path: "app/src/screens/schedules/index.tsx", name: "screen"}
  - {kind: "symbol", path: "app/src/screens/memory/index.tsx", name: "screen"}
  - {kind: "symbol", path: "app/src/screens/budget/index.tsx", name: "screen"}
  - {kind: "symbol", path: "app/src/screens/settings/index.tsx", name: "screen"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "## Phase 7 features"}
  - {kind: "symbol", path: "docs/UI.md", name: "phase 9"}
requires: []
lanes:
  - "app/src/screens/placeholder.tsx"
  - "app/src/screens/tasks/**"
  - "app/src/screens/playbooks/**"
  - "app/src/screens/schedules/**"
  - "app/src/screens/memory/**"
  - "app/src/screens/budget/**"
  - "app/src/screens/settings/**"
  - "app/src/App.test.tsx"
  - "app/e2e/smoke.spec.ts"
  - "docs/ARCHITECTURE.md"
  - "docs/UI.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
Subtask 3 (independent)
```

No subtask consumes another's output at build time. The kernel never imports the app package. The stubs import only `../types` and `../placeholder`. The docs name the routes and parts this brief fixes. Every name in this brief (part names, origins, route paths, type names, shortcuts) is the shared interface, so the three lanes must use these names exactly.

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (`console-contract.test.ts` is in 2; it merges `SHIPPED_CONTRIBUTIONS`, and gui adds no route, so the count of 31 holds) | NO |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2, Subtask 3 (parallel)
- **Recommended workers:** 3
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 51 minutes ago, fetched <1h |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Contract drift: a screen item finds a shape missing and edits `contract.ts`, colliding with siblings (requirement Risks) | HIGH | Declare every shape in the table above. Ground every field in a store column or existing type. A late gap becomes a new small item, never an edit inside a screen lane |
| Scope vs Supervisor capability: ~28 files exceed one worker's bound — Feasibility (Phase 2.5) | MEDIUM | Split three ways on `genuine-parallelism` with zero overlap. The shared names are fixed in this brief |
| `PUT /memory/file` is the app's first non-GET/POST route: `HttpMethod`, `contract.test.ts` and the main process's `send` (method passed through `doFetch`) must all accept it — Feasibility (Phase 2.5) | MEDIUM | Subtask 2 widens `HttpMethod` and the test. `kernel-connection.ts` matches by `r.method === req.method` and passes `method` through, so it needs no change. Whether the kernel's API server reads a PUT body is item 06's to verify |
| A screen item's route overlaps an existing one (`mergeContributions` refuses the same method with overlapping paths) | MEDIUM | Checked here: `GET /playbooks/:id/runs` and `/versions` have 3 segments against `/playbooks/:ref`'s 2, and `GET /triggers/:id/fires` differs from `POST /triggers/:id/on` by method. No overlap |
| The shortcuts are a proposal; item 02's mockup (`docs/design/mockups/gui-v2.html`, not yet merged) sets the final ones | LOW | Use the proposal. Items 03–08 adjust their own `index.tsx` and pins later (requirement Assumptions) |
| `⌘,` may clash with an app-menu accelerator | LOW | The app binds shortcuts only through `app/src/commands/keyboard.ts` (`parseShortcut` takes one key after modifiers, so `,` parses). Neither `app/electron` nor `app/src` binds a menu accelerator (`CmdOrCtrl` has no hits) |
| Prior churn on touched paths: `docs/ARCHITECTURE.md` (55), `feature-seams.test.ts` (15), `integrations-foundation.test.ts` (9), `contract.ts` (7) — Prior churn (postmortem ledger) | MEDIUM | The recurring classes are `self_heal_churn` and `drain_churn`, with some `convention_mismatch`. Mirror each file's own idiom exactly (Touched-file invariants), keep the doc edits to the sections named, and run all three validation commands before hand-back |
| The registry's module-graph pin: a gui file importing a runtime kernel module would put the SDK in the CLI's graph | MEDIUM | `kernel/src/gui/**` imports only types, `../console/index.js` and its own parts (as `kernel/src/integrations/index.ts` does). `feature-seams.test.ts` catches any regression |

## Configuration
- **Workers:** 3
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** genuine-parallelism

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-phase-7-foundation-contract-route-seams.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T09:32:16Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/177
- **Branch:** feature/phase-7-foundation-contract-route-seams
- **Files changed:** 29
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Resumed (--continue) at EXECUTE with all three workers finished; committed and merged the three subtask branches cleanly, removed worktrees. Integrated HEAD green: kernel 2995 passed/15 skipped, app 1475 passed + build, smoke e2e 3/3, check-docs OK. Phase 4.5: iteration 1 reviewer PASS with 1 MEDIUM (ROADMAP still listed Hooks in phase 7) converted to a fix round by the MEDIUM fix floor; fix ebd8ab7 updated docs/ROADMAP.md; iteration 2 PASS with no issues. 3 LOW findings dismissed below the floor (marker comment posted). Drain not dispatched: .supervisor/config.json auto_review=false (/automate owns the drain). Finalize-gate marker refused (no_active_session: resumed state.md read status failed), so the push guard was inert at its check (ii).

## Not verified
- **The 12 phase 7 routes against a running kernel** — the kernel serves none of them until items 03–08 land (subtask 2)
