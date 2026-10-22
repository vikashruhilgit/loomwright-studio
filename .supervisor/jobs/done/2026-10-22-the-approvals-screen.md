# Supervisor Job: The Approvals screen — the inbox, the exact payload, Allow once, Always for this playbook, Deny, and grants

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-071939/L3
- **CLAUDE.md:** ✓ Found (fresh — its `kernel/` + `docs/` description predates `app/`, which is documented by `app/e2e/fixtures/README.md` and the phase-5 requirements; no pattern it states is contradicted)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140015-the-approvals-screen.md
- **Base commit:** 3f3b9f4d73f64051c0b0f9f44c5745e8b1bd6940

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is Electron + React 19 + TypeScript + Vite, vitest + RTL, Playwright Electron e2e — the stack the requirement names. |
| 2 | Dependency Availability | GO | No new npm dependency: the contract (`app/src/api/contract.ts`), store (`useResource`), command registry, keyboard map, `List`/`Dialog`/`Button`/`Badge`/`Band`/`Charter` components and the fixture kernel all exist on main. |
| 3 | Architecture Fit | GO | Screens are auto-discovered from `src/screens/<id>/index.tsx` (`import.meta.glob` in `App.tsx`), commands register from the screen's own module (`commandRegistry.register`), and the feed already routes `approval_*` events to the `approvals` and `grants` resources (`KIND_ROUTES`), so the screen edits only its own Touches. |
| 4 | Scope vs Supervisor Capability | GO | One screen, one worker: ~8 authored code files plus the evidence folder; no split reason fires (see Configuration). |
| 5 | Hard Blockers | CAUTION | The contract carries no field saying whether the kernel would accept `always` for a given approval, nor its reason; the kernel decides only on `POST /approvals/:id/approve` (`alwaysRefusal` in `kernel/src/approvals/store.ts`, answered as `409 always_not_supported` with a `message`). The requirement forbids kernel changes ("a missing route or field is a finding, so stop and say so"), so the screen derives the one condition the view exposes (`playbook === null`) and records the gap as a finding — see Risk Assessment. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Replace the Approvals placeholder (`app/src/screens/approvals/index.tsx`) with the designed screen: a 360px pending-first inbox, a detail pane that shows the exact untrusted payload escaped, keyboard decisions (A / ⇧A / D) with the kernel's outcome and the agent's message, a standing-grants section with confirmed Revoke, and ⌘K commands — plus a Playwright spec against the fixture kernel that commits light/dark screenshots of every designed state.

**Problem Statement:**
The owner needs every pending approval in one inbox showing exactly what will happen, decided with one key, because today deciding means `studio approvals`, `approve`, `deny` and `revoke` in a terminal.
Currently, item 01 left a placeholder ("What waits on you arrives here.") at `app/src/screens/approvals/index.tsx`. This causes every approval to stall until the owner opens a terminal.
Success looks like: the routes `GET /approvals[?all=1]`, `POST /approvals/:id/approve` (`once` / `always`), `POST /approvals/:id/deny`, `GET /approvals/grants` and `POST /approvals/grants/:id/revoke` are all reachable from the screen by keyboard alone, and the polish-gate screenshots are committed.

**Design notes for the worker (grounded on main):**
- **Bridge guard (required — the shell does not pass the bridge to screens):** `App.tsx` gives its `api` prop only to `useKernelConnection(bridge)` and renders `<Screen />` with no props; `App.test.tsx` passes `fakeBridge` as that prop and never sets `window.api`. `useResource(name)` defaults to `getBridge()` = `window.api` (`app/src/store/react.ts`, `app/src/api/bridge.ts`), and `entryFor(undefined)` throws on its `WeakMap`. So the exported screen component calls NO store hook itself: it reads `window.api` defensively (`(window as { api?: StudioBridge }).api`), renders the root `data-testid="screen-approvals"` in a plain no-bridge state when it is undefined, and otherwise mounts an inner component that calls `useResource`. A unit test mounts the screen with no `window.api` and expects the root testid and no throw. Do not edit `App.tsx` or `App.test.tsx`; if the owner wants the shell to hand screens the bridge, that is a finding for item 01.
- Reads go through the live store (inside the inner component): `useResource("approvals")`, `useResource("grants")`, `useResource("messages")` (`app/src/store/react.ts`; the table is `FIXED_RESOURCES` in `app/src/store/resources.ts`). The `approvals` resource is `GET /approvals` (pending only); "decided ones on request" is a local `GET /approvals?all=1` read through `getBridge().request` (the store's table is item 12's file — do not edit it).
- Actions go through `getBridge().request(...)` (`app/src/api/bridge.ts`) with the `ApiRequest` shape; the answer is an `ApiResult` (`ok: false` carries `body.error` / `body.message`). After an action, the feed's `approval_*` event refetches `approvals` + `grants` on its own (`KIND_ROUTES` prefix `approval_`).
- The kernel's outcome sentence is on the decided `Approval`: `applied`, or `apply_refused` + `apply_detail` (contract `Approval`). The message the agent gets is the `BrainMessage` in `GET /messages?all=1` whose `source` is `approval:<id>` (kernel `sourceRef: \`approval:${id}\`` in `kernel/src/approvals/store.ts`; contract `BrainMessage.source` doc lists `approval:<id>`). Its `text` is untrusted.
- "For a kernel-applied action, what the kernel will do": the payload's string `tool` is one of the kernel's `KERNEL_APPLIED_ACTIONS` (`mcp__kernel__kernel_playbook_enable`, `mcp__kernel__kernel_agent_create`, `mcp__kernel__kernel_agent_update` in `kernel/src/approvals/store.ts`). The app has no copy of that list; the screen keeps a local mirror in its own directory, with a unit test that reads the kernel file and fails if the three names drift.
- Escaping: mirror the kernel's `printable` (`kernel/src/notifications/cli.ts`): C0/C1 controls and DEL as `\xNN`, bidi controls U+202A–U+202E, U+2066–U+2069, U+061C, U+200E, U+200F and U+2028/U+2029 as `\uNNNN`. Apply it to `payload` (after `JSON.stringify(payload, null, 2)`), `display`, `apply_detail`, `action`, `requesting_agent`, the playbook slug and the agent message `text`; render in a monospace `<pre>` as a React text child (never `dangerouslySetInnerHTML`). Multi-line fields (payload, `display`, `apply_detail`, the agent message) use `printable(text, true)` (keepNewlines) so the pretty-printed payload keeps its lines; single-line fields (action, agent, slug, cwd) use the default, which writes `\n` literally.
- Detail fields (requirement Scope 2): the `action`; `requesting_agent` and `session #<requesting_session>` (or "no session"); `from playbook <slug> v<version>` when `playbook` is not null (slug and version from `Approval.playbook`); the `display` and the exact payload; the cwd; and, for a `KERNEL_APPLIED_ACTIONS` tool, one line naming what the kernel will do (e.g. "The kernel creates this crew member when you allow it"). The contract's `Approval` has no `cwd`: use the payload's string `cwd` when present (a Bash rail payload is `{tool, command, cwd}`, `kernel/src/approvals/store.ts`), else the requesting session's `SessionSummary.cwd` from `useResource("sessions")`, else "cwd unknown" — escaped either way. Record the missing `cwd` on `Approval` in the evidence README with the other findings.
- ⇧A eligibility: disabled when `approval.playbook === null`, and no request is sent. The explanation is the kernel's own exported sentence `ALWAYS_REFUSED` (`kernel/src/approvals/store.ts`: `always needs an approval the rail held from a playbook session`) followed by `; approve it once`. It is true for both refusals `alwaysRefusal` can give a no-playbook approval (not rail-held — checked first — or no playbook), which the app cannot tell apart because the contract's `Approval` has no `source` field. When the playbook is present, ⇧A sends `{decision: "always"}`; a `409 always_not_supported` answer shows the kernel's `message` verbatim (escaped) beside the button and leaves the approval pending.
- Keyboard: register commands with `commandRegistry.register("approvals", [...])` from the screen module (ids `approvals.approve-once`, `approvals.approve-always`, `approvals.deny`, `approvals.show-grants`; shortcuts `A`, `⇧A`, `D`), each with `enabled` reflecting the selection, unregistered on unmount. The keyboard map (`app/src/commands/keyboard.ts`) binds registered shortcuts and skips editable targets; `listMove` gives J/K. Revoke opens `Dialog` (`app/src/components/Dialog/Dialog.tsx`) and calls revoke only on confirm.
- Layout: the list pane uses the `--list-pane-width` token (360px, `app/src/styles/tokens.css`); a new approval arriving keeps the selected id selected (select by id, never by index). Visual reference: `docs/design/mockups/gui-v1.html` §Approvals (`/* Approvals */`).

## Acceptance Criteria
- [ ] AC1 — Given two pending approvals #1 and #2 in the fixture, when the screen opens, then the oldest (#1, earliest `requested_at`) is first and selected; when a third (#3) arrives through the feed, then #1 stays selected and the first two keep their order; and given the owner has pressed J to select #2, when the fixture's `GET /approvals` next answers without #1 (decided elsewhere) and an `approval_*` event is pushed, then #2 is still the selected approval (selection is by id, never by list index).
- [ ] AC1b — Given a pending approval from a playbook session for `mcp__kernel__kernel_agent_create` with a requesting session, when it is selected, then the detail pane shows its action, the requesting agent and `session #<id>`, `from playbook <slug> v<n>`, the cwd (payload `cwd`, else the session's `cwd`, else "cwd unknown"), and the line saying what the kernel will do.
- [ ] AC2 — Given a pending charter-create approval (payload `tool: "mcp__kernel__kernel_agent_create"`) selected, when the owner presses A, then exactly one `POST /approvals/:id/approve` with body `{"decision":"once"}` is sent, and the kernel's `applied` sentence from the answer shows in the detail pane, followed by the agent's message (the `approval:<id>` brain message's text).
- [ ] AC3 — Given a pending approval with `playbook: null` selected, when the owner presses ⇧A (or opens the button), then "Always for this playbook" is disabled, its explanation reads `always needs an approval the rail held from a playbook session; approve it once` (the kernel's `ALWAYS_REFUSED` sentence), and no request is sent; given a playbook approval whose `always` the kernel refuses (409 `always_not_supported`), then the kernel's `message` shows and the approval stays pending.
- [ ] AC4 — Given a payload (and a `display`) containing an ANSI escape (`\u001b[31m`) and a bidi override (U+202E), when it is shown, then the detail pane renders the literal text `\x1b[31m` and `\u202e` in monospace and no raw control or bidi character reaches the DOM text.
- [ ] AC5 — Given a grant with `current: false`, then its row in the grants section shows a visible "not current" badge (a grant with `current: true` shows none); and given a standing grant, when the owner chooses Revoke, then a confirm dialog opens; on Cancel nothing is sent; on Confirm exactly one `POST /approvals/grants/:id/revoke` is sent.
- [ ] AC6 — Given the fixture kernel, when `e2e/approvals.spec.ts` runs in evidence mode (an env flag such as `APPROVALS_EVIDENCE=1`, the pattern `e2e/components.primitives.spec.ts` uses with `PRIMITIVES_EVIDENCE`), then screenshots of every designed state — empty, loading, error with the kernel-unreachable band, waiting on you, populated (detail + grants), decided — exist in both light and dark under `docs/evidence/phase-5-polish/approvals/` and are committed; and a committed evidence file `docs/evidence/phase-5-polish/approvals/README.md` lists each screenshot with the `docs/design/mockups/gui-v1.html` screen it matches, and records the contract findings (no `always`-eligibility field, no `source` rail/request field and no `cwd` on `Approval`), and the PR body links to it.
- [ ] AC7 — Given keyboard-only use, then every action (select with J/K, A, ⇧A, D, show grants, Revoke and its confirm, show decided) is reachable without a pointer, and each of A / ⇧A / D / show grants is a ⌘K palette command.
- [ ] AC8 — `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and `npm run e2e` passes including `e2e/approvals.spec.ts`.

**Evidence rule:** AC6's mockup mapping and the contract finding live in the committed `docs/evidence/phase-5-polish/approvals/README.md`, never only in the PR body.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| screen | `app/src/screens/approvals/index.tsx` | `app/src/screens/approvals/ApprovalsScreen.tsx`, `app/src/screens/approvals/printable.ts`, `app/src/screens/approvals/approvals.css`, `app/src/screens/approvals/ApprovalsScreen.test.tsx`, `app/src/screens/approvals/printable.test.ts`, `app/src/screens/approvals/kernel-mirror.test.ts` | HIGH (exact split of files inside the directory is the worker's call) |
| e2e | — | `app/e2e/fixtures/approvals.ts`, `app/e2e/approvals.spec.ts` | HIGH |
| evidence | — | `docs/evidence/phase-5-polish/approvals/README.md`, `docs/evidence/phase-5-polish/approvals/*.png` (≈12 generated screenshots: 6 states × 2 themes) | HIGH |

**Total estimated files:** 1 modify + 10 authored creates (+ ≈12 generated PNGs written by the spec in evidence mode)

## Touched-file invariants

> Grounded at base `3f3b9f4d73f64051c0b0f9f44c5745e8b1bd6940`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/approvals/index.tsx`** — keep: the module's one export `export const screen: ScreenDefinition` (the shell discovers it via `import.meta.glob<ScreenModule>("./screens/*/index.tsx"` in `app/src/App.tsx`), with `id: "approvals"`, `title: "Approvals"` and `nav: { label: "Approvals", order: 3, shortcut: "⌘3" }` unchanged; the root element keeps `data-testid="screen-approvals"` in EVERY state (no bridge, loading, error, empty, populated), because `App.test.tsx` mounts the screen with `window.api` unset (it passes `fakeBridge` only as `App`'s `api` prop, which reaches `useKernelConnection` alone) — so the exported component calls no store hook before the bridge guard (Design notes); the screen renders no `<h1>` (the shell's `titlebar-title` is the only one; use `<h2>` or below); reuse: the shared primitives under `app/src/components/` and the store hooks (`useResource`) rather than new fetch code; mirror: `ScreenDefinition` in `app/src/screens/types.ts`; pinned by: `app/src/App.test.tsx` — `"Approvals⌘3"` (the sidebar order), `getByRole("heading", { level: 1 })` (exactly one `<h1>`), `screen.getByTestId(\`screen-${id}\`)` and `["screens.approvals", "Screens", "⌘3"]` (the shell's own screen command — the screen must NOT register an id `screens.approvals`; its ids start `approvals.`). The registry throws `CommandCollisionError` on a duplicate id, and the keyboard map reports two enabled commands sharing a shortcut — so `A` / `⇧A` / `D` must be `enabled` only while the Approvals screen is mounted with a selection.

## Pin mutations

All pins are new (no existing pin changes). The worker names the test files as below; each mutation is applied to the code the pin protects, in a scratch copy, and must turn the pin red.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/approvals/kernel-mirror.test.ts` — the three `KERNEL_APPLIED_ACTIONS` names | delete `"mcp__kernel__kernel_agent_create",` in `kernel/src/approvals/store.ts` |
| `app/src/screens/approvals/kernel-mirror.test.ts` — the `ALWAYS_REFUSED` sentence | flip `always needs an approval the rail held from a playbook session` → `always needs a rail approval` in `kernel/src/approvals/store.ts` |
| `app/src/screens/approvals/printable.test.ts` — U+202E is written `\u202e` | flip `\u202a-\u202e` → `\u202a-\u202d` in `app/src/screens/approvals/printable.ts` |
| `app/src/screens/approvals/printable.test.ts` — ESC is written `\x1b` | flip `\u0000-\u001f` → `\u0000-\u001a` in `app/src/screens/approvals/printable.ts` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — no bridge renders the root testid without throwing (bridge guard) | delete the `window.api === undefined` early return in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — ⇧A on `playbook: null` sends nothing | delete the `playbook === null` disabled check in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `app/e2e/approvals.spec.ts` — AC5 revoke is sent only after Confirm | call revoke from the Revoke button's handler directly instead of from the `Dialog` confirm action in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `app/e2e/approvals.spec.ts` — AC1 #2 stays selected after #1 leaves the list | select by list index instead of by approval id in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — AC1b shows the session's cwd when the payload has none | delete the `SessionSummary.cwd` fallback in `app/src/screens/approvals/ApprovalsScreen.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Approvals screen, fixture, e2e spec and polish evidence | all (AC1, AC1b, AC2–AC8) | 1 modify, 10 create (+ generated PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/src/screens/approvals/index.tsx", name: "screen"}
  - {kind: "file", path: "app/src/screens/approvals/printable.ts"}
  - {kind: "symbol", path: "app/src/screens/approvals/printable.ts", name: "printable"}
  - {kind: "file", path: "app/e2e/fixtures/approvals.ts"}
  - {kind: "file", path: "app/e2e/approvals.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/approvals/README.md"}
requires: []
lanes:
  - "app/src/screens/approvals/**"
  - "app/e2e/fixtures/approvals.ts"
  - "app/e2e/approvals.spec.ts"
  - "docs/evidence/phase-5-polish/approvals/**"
external_requires:
  - "Electron + Playwright available locally for `npm run e2e` (CI runs it under xvfb in .github/workflows/ci.yml)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the contract has no `always`-eligibility field, so the app can tell only the `playbook === null` case before sending; the other `alwaysRefusal` conditions (not rail-held, stale playbook version, unnamed/mismatched agent, always-held tool) are known only from the `409 always_not_supported` answer. | MEDIUM | Disable ⇧A for `playbook === null` with the kernel's own sentence for that case; for the rest, send and show the 409 `message` verbatim (escaped). Record the missing field as a finding in `docs/evidence/phase-5-polish/approvals/README.md`; do NOT change the kernel or the contract (requirement Non-goals). |
| The ⇧A reason sentence and the `KERNEL_APPLIED_ACTIONS` list are mirrored app-side and can drift from the kernel. | MEDIUM | A unit test in `app/src/screens/approvals/` reads `kernel/src/approvals/store.ts` and asserts the `ALWAYS_REFUSED` sentence `always needs an approval the rail held from a playbook session` and the three tool names are still present (see Pin mutations). |
| Contract finding: `Approval` has no `source` (rail / agent request) field, so the app cannot show which of `alwaysRefusal`'s first two refusals applies to a no-playbook approval. | LOW | Show the kernel's `ALWAYS_REFUSED` sentence, true for both; record the missing field in the evidence README beside the eligibility finding. |
| Untrusted text (payload, display, apply_detail, agent message, slug) rendered unescaped. | HIGH | One `printable` mirror of the kernel's escaping, applied to every untrusted field, rendered as text children in `<pre>`; AC4 unit + e2e test asserts no raw U+001B / U+202E in DOM text. |
| Screen shortcuts A / ⇧A / D collide with another screen's registered commands (keyboard map refuses enabled duplicates). | MEDIUM | Register under owner `approvals` with ids `approvals.*`; `enabled` true only while mounted with a selection; unregister on unmount. |
| The selection jumps when a new approval arrives (DESIGN.md: "new approvals arrive without moving the list"). | MEDIUM | Track the selected approval by id; AC1 e2e pushes a third approval through the fixture feed and asserts the selection. |
| File count: ≈12 generated PNGs push the raw changed-file count above the 12-file context bound. | LOW | The PNGs are spec output, not worker-authored context; authored files are ~10. Splitting screen from e2e would be a serial chain with no parallelism, so it stays one subtask. |
| Another lane in this wave needs a shared file (the store table, `App.tsx`, `tokens.css`). | MEDIUM | Requirement rule: stop and say so; do not edit files outside the lanes above. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-the-approvals-screen.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T09:10:40Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/119
- **Branch:** feature/the-approvals-screen
- **Files changed:** 23
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 4
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Approvals screen, fixture kernel spec, and light/dark evidence for all 6 states, plus an evidence README with the contract findings. The heal loop ran 3 fix rounds (13eef07 → 59c0c4e → 86df235 → 72b396c) covering 11 findings. Iteration 3's reviewer returned PASS with 4 MEDIUM findings at the floor. Fix round 3 addressed them, but no reviewer re-checked that round, so the run escalated at the bound. The supervisor re-ran typecheck, 639/639 unit tests, the build and 8/8 approvals e2e on 72b396c, and required CI was green on 86df235. Remaining open, from the fixer reports: focus is lost when the view switches from loading to error; a failed sessions read shows no note; and focus lands on body when the same approval id comes back pending after the empty state. App.tsx mounts no CommandPaletteHost, so the ⌘K palette is not in the running app (a finding for item 01).

## Not verified
- **⌘K palette listing approvals.* commands in the running app** — the shell mounts no CommandPaletteHost; registration verified only in unit tests (subtask 1)
- **app/e2e/approvals.spec.ts under CI Linux/xvfb** — run on macOS only (subtask 1)
