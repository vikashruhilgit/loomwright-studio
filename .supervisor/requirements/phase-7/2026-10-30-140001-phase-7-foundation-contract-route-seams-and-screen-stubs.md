# 01 — Phase 7 foundation: the GUI v2 contract, route seams and screen stubs

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D24, invariants 1, 3, 8

**As** the builder of phase 7's screens,
**I want** the app contract, the kernel route seams and an empty stub for each new screen in place first,
**so that** the six screen items run in parallel without editing the same shared files.

## Problem

Phase 7 adds six screens, and five of them read data no route serves yet (Problem lines in items 03–07). The shared files every screen would touch are `app/src/api/contract.ts` (with `kernel/test/console-contract.test.ts`, a declared companion), `kernel/src/features/index.ts` (with `kernel/test/feature-seams.test.ts`), `app/e2e/fixture-kernel.ts`, and the docs index. Screens themselves need no shared list: the shell discovers `app/src/screens/<id>/index.tsx` on its own (`app/src/screens/types.ts`). Phase 6 item 01 and D36 wave 1 solved the same problem with a foundation that declares the contract and stubs, then items that fill them.

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Scope

1. **The contract.** Declare in `app/src/api/contract.ts` every request and response shape items 03–08 serve or read: tasks (list grouped by state, one task's history), playbook runs and versions, trigger fires and upcoming wake-ups, the memory tree, one memory file with its content hash, a memory write with its base hash and its refusals, budget usage by day, agent and playbook (tokens counted per D26, dollars only as "≈ at API rates" estimates, D24), filtered audit events with paging, and the settings view. `kernel/test/console-contract.test.ts` pins each shape.
2. **The route seams.** A new kernel feature, `gui` (`kernel/src/gui/index.ts`), registered last in `SHIPPED_CONTRIBUTIONS`, made of six empty parts in the integrations feature's shape (`INTEGRATIONS_PARTS`): `tasks`, `playbook-history`, `schedules`, `memory`, `budget-audit`, `settings`. Each part file exports its routes, empty here; each screen item fills only its own part. `kernel/test/gui-foundation.test.ts` pins the part order and that each part's routes are owner routes (API token required).
3. **Screen stubs.** `app/src/screens/{tasks,playbooks,schedules,memory,budget,settings}/index.tsx`, each a `ScreenDefinition` with its nav label, order and shortcut as item 02's mockup sets them (proposal: Tasks ⌘6, Playbooks ⌘7, Schedules ⌘8, Memory ⌘9, Budget & audit with no digit, Settings ⌘,), rendering the designed "coming in this phase" placeholder only until its item lands.
4. **The fixture kernel.** `app/e2e/fixture-kernel.ts` answers every new route with fixture data shaped by the contract, so each screen's e2e has a source.
5. **Docs.** `docs/ARCHITECTURE.md` gains a "Phase 7 features" section naming the `gui` feature and its parts. `docs/UI.md` gets the note that Hooks moved to phase 9 (owner, 2026-10-30) and the note on what Tasks shows in phase 7; item 02 records the same in `docs/DESIGN.md`.

## Non-goals

- Any route body or screen content (items 03–09).
- Any migration: every phase 7 screen reads tables that already exist.

## Acceptance criteria

- [ ] Given the contract, then every shape items 03–08 name is declared, and `console-contract.test.ts` pins it.
- [ ] Given a fresh kernel, then the `gui` feature merges with no conflict, each part is present and empty, and `feature-seams.test.ts` still passes.
- [ ] Given the app, then each of the six stubs is reachable from the sidebar and its shortcut, and `App.test.tsx` passes.
- [ ] Given the fixture kernel, then each new route answers a contract-shaped body.
- [ ] Given UI.md, then Hooks is recorded as phase 9 and Tasks' phase 7 scope is stated. `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`

## Assumptions

- The shortcut proposal is a proposal: item 02's mockup sets the final ones, and this item follows the mockup if it merges first, else items 03–08 adjust their own `index.tsx`.
- The six-part `gui` feature is the right seam; a screen whose routes belong to an existing feature (for example `/playbooks/:id/runs` beside `/playbooks`) may instead add a part there, named in its item.

## Risks

- Contract drift: a screen item that finds a shape missing changes `contract.ts` in its own PR, which collides with sibling items. Declaring every shape here is the mitigation; a late gap is a new small item, not an edit in a lane.

## Depends on
none

## Touches
app/src/api/contract.ts
kernel/test/console-contract.test.ts
kernel/src/gui
kernel/src/features/index.ts
kernel/test/feature-seams.test.ts
kernel/test/gui-foundation.test.ts
app/src/screens/tasks/index.tsx
app/src/screens/playbooks/index.tsx
app/src/screens/schedules/index.tsx
app/src/screens/memory/index.tsx
app/src/screens/budget/index.tsx
app/src/screens/settings/index.tsx
app/e2e/fixture-kernel.ts
app/src/App.test.tsx
docs/ARCHITECTURE.md
docs/UI.md
