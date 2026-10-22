# Supervisor Job: The Team screen — agent cards, the inspector, and creating a crew member from a charter (phase 5 item 14)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-071939/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140014-the-team-screen.md
- **Base commit:** 3f3b9f4d73f64051c0b0f9f44c5745e8b1bd6940

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is Electron + React 19 + TypeScript + Vite, vitest + RTL, Playwright Electron (`app/package.json`). The screen is React in `app/src/screens/team/`. |
| 2 | Dependency Availability | GO | No new npm dependency needed: primitives (`Card`, `Dialog`, `Input`, `Badge`, `Button`, `StatusDot`, `Toast`, `List`), `Avatar`, `Charter`, the live store (`useResource`) and the command registry are all on `main`. A new dependency is out of scope (requirement: stop and say so). |
| 3 | Architecture Fit | CAUTION | The shell discovers `src/screens/<id>/index.tsx` itself (`App.tsx` `import.meta.glob`), so the screen edits only its own directory. But three contract gaps exist (no kernel change is allowed): (a) `GET /agents` (`RosterEntry`) carries no role and no current task, so the card's role comes from a per-crew `GET /agents/:id` (`charter.persona`) and the task from the `messages` resource; (b) `GET /agents/wright` answers `409 reserved` (`memberOf` in `kernel/src/agents/roster.ts`), and no route reports Wright's current `effort` or `delegation_depth`; (c) `AgentCard` (`app/src/components/Card/Card.tsx`) needs a numeric `budget.limit` and has no "no limit", sessions-at-once or status slot. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 10 code files plus about 12 screenshots, roughly 1,500 changed lines: over the 800-line `context-bound` bound, so two subtasks (screen, then e2e + evidence). |
| 5 | Hard Blockers | GO | Every dependency item (01, 07, 08, 09, 10, 11, 12) is merged on `main` (`git log`: PR #106 item 07, #110–#114 items 08–12). Every route the screen calls is in `CONTRACT_ROUTES`. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Replace the Team placeholder (`app/src/screens/team/index.tsx`) with the designed Team screen: a roster of agent cards (Wright first, as the whale), a 320px inspector that shows and edits an agent through the existing owner routes, a New crew member charter form that calls `POST /agents`, and ⌘K commands for every Team action. Ship it with a Playwright spec against the fixture kernel and committed light/dark screenshots of every designed state.

**Problem Statement:**
The owner needs to see every agent's limits and usage, and to create, rename, set, and turn crew members off and on, from the app. Today the only way is the `studio agents` CLI.
Currently Team is a placeholder ("Wright and your crew arrive here.").
Success looks like this: with the fixture kernel, the owner reaches every Team action by mouse and by keyboard alone, each action calls the contract route, and the result shows up through the live feed.

**Owner decisions that bind this item (from the requirement, 2026-10-20):** live data comes from REST plus the one WebSocket event feed (the store, item 12). Wright's model, effort and limits are editable from Team's inspector through item 07's widened `POST /agents/:id/set`. The polish gate is the evidence committed on the PR. No role presets (invariant 9). Tokens and sessions are the limits, and dollars appear only as "≈ … at API rates" (D24). Every kernel string is untrusted data, rendered as React text children (invariant 3).

## Acceptance Criteria
- [ ] AC1: Given the kernel's `GET /agents` returns Wright and two crew members, when Team opens, then three cards show in a `CardGrid` (`auto-fill` grid, equal rows), Wright first with the whale `Avatar` (`creatureFor` → `whale`), and each card shows avatar, name, role, the current task line, today's tokens against `tokens_per_day` (or the words "no limit" when it is `null`), `sessions_running` against `sessions_at_once` (or "no limit"), and status (`active`/`off`). The task line is chosen in this order, as the mockup's `renderTeam` does. First, when the agent has a `pending` approval in `useResource("approvals")` (`requesting_agent` = the agent's id), it reads "Waiting on you · <the approval's `display` or `action`>" with the waiting dot. Next, the agent's `running` brain message text from `useResource("messages")`, with the working dot. Otherwise "idle". All of it is shown as text.
- [ ] AC2: Given a crew role (charter persona) longer than two lines, when its card renders, then the role is clamped at two lines and ends in an ellipsis, and the full text is the card's tooltip (`title`) and appears unclamped in the inspector.
- [ ] AC3: Given the inspector open for a comment-only reviewer whose `GET /agents/:id` returns `never: ["git_push", …]`, then the kernel-enforced permissions render labelled "enforced": the allowed tools and Bash prefixes (from `settings.content.tool_policy.allowedTools` / `.allowedBashPrefixes`, the parsed `config/agents/<id>.json` that `renderAgentSettingsJson` in `kernel/src/agents/charter-files.ts` writes; read defensively because `content` is `unknown`, and when it is `null` or malformed show "settings file unreadable" plus `settings.error`'s message) and the `never` list. They are visibly separate from the charter's prose `boundaries` (labelled guidance), next to model, limits, workspaces and the memory files as plain paths.
- [ ] AC4: Given a crew member's inspector, when the owner renames it, sets a scalar field (`model`, `effort`, `permission_mode`, `limits.tokens_per_day`, `limits.sessions_at_once`, `limits.delegation_depth`), or turns it Off or On, then `POST /agents/:id/rename`, `/set` (`{field, value}` as strings, `none` clears), `/off` or `/on` is called. A refusal's `error`/`message` is shown as text, and the card updates from the feed (`agent_*` events refetch `agents`).
- [ ] AC5: Given Wright's inspector, when the owner changes Wright's model, then `POST /agents/wright/set` is called with `{field: "model", value}` (item 07). Only `WrightSetField` fields (`model`, `effort`, the three limits) are editable. `tool_policy`, `permission_mode` and every other Wright field are not offered and are shown read-only with "edit `wright.json`". The inspector never calls `GET /agents/wright` (the kernel refuses it `409 reserved`).
- [ ] AC6: Given the New crew member form completed (identity, avatar shape and hue, persona, duties, boundaries, model, effort, permission mode, tool policy with the tool picker in its own `Dialog`, limits, workspaces), when the owner creates it, then `POST /agents` is called once with the charter object. A `400 charter_invalid`/`agent_id_invalid` refusal shows its `field` and `message`. On `201` the new card appears from the feed (the fixture appends an `agent_created` event), not from a local insert. The form starts empty, with no presets (invariant 9).
- [ ] AC7: Given the New crew member entry point, when the owner picks "Ask Wright to draft it", then the app opens Chat (`#/chat`) with the request. The request goes through `POST /ask` to Wright or is pre-filled for the owner to send. Subtask 1 states the path it chose and why in a code comment at the "Ask Wright to draft it" handler, and Subtask 2 records the same choice and reason in the committed evidence file `docs/evidence/phase-5-polish/team/README.md`, which the PR body links to. Nothing is created without the owner.
- [ ] AC8: Given the ⌘K palette, then Team registers its own commands (owner `team`, ids prefixed `team.`): New crew member, Rename, Set a field, Turn on, Turn off, and Open thread (opens `#/chat` on that agent) for each agent. Commands that cannot run now (Wright rename/off, on for an active member) are `enabled: () => false` or absent. Each command runs the same route as its button. Scope: the commands are registered while the Team screen is mounted and unregistered on unmount, because the shell renders only the current screen. `team.test.tsx` pins both the registration and the unregister.
- [ ] AC9: Given keyboard-only use, then every Team action (open a card, every inspector control, the New crew member form, the tool-picker dialog, create, cancel) is reachable with Tab/Shift-Tab, Enter/Space and Escape, with a visible focus ring, and `team.spec.ts` drives at least create and rename without a pointer.
- [ ] AC10: Given the running app against the fixture kernel, then screenshots of every designed state (populated, empty (Wright only), loading, error with the kernel-unreachable band, waiting on you, inspector open, New crew member form) in light and dark mode are committed under `docs/evidence/phase-5-polish/team/`, and a committed evidence file `docs/evidence/phase-5-polish/team/README.md` lists each screenshot, the designed state it shows, and the `docs/design/mockups/gui-v1.html` Team screen state it matches, each contract gap found (risk rows 1–3), and AC7's chosen path and reason. The PR body links to it.
- [ ] AC11: Given the change, when `cd app && npm ci && npm run typecheck && npm test && npm run build` runs, then it passes, and `npx playwright test e2e/team.spec.ts --workers=1` passes. Every existing suite stays green, including `app/src/App.test.tsx` and `app/e2e/smoke.spec.ts`.

**Evidence rule:** AC10's evidence lives in the committed `docs/evidence/phase-5-polish/team/README.md` and screenshots, never only in the PR body.

## Touched-file invariants

> Grounded at base `3f3b9f4d73f64051c0b0f9f44c5745e8b1bd6940`. The worker re-checks these before hand-back.

- **`app/src/screens/team/index.tsx`**: keep the module's one export, `export const screen: ScreenDefinition`, with `id: "team"`, `title: "Team"` and `nav: { label: "Team", order: 2, shortcut: "⌘2" }`. The shell discovers it by `import.meta.glob<ScreenModule>("./screens/*/index.tsx", { eager: true })` in `app/src/App.tsx`, so no shared list is edited. Keep the root element's `data-testid="screen-team"`. It is pinned by `app/src/App.test.tsx` (`for (const id of ["team", "approvals", "sessions", "chat"])` → `screen.getByTestId(\`screen-${id}\`)`, and `["screens.team", "Screens", "⌘2"]`) and by `app/e2e/smoke.spec.ts` (`for (const entry of ["Chat", "Team", "Approvals", "Sessions"])`). Reuse: data through `useResource(…)` from `app/src/store/react.ts` (`export function useResource`), never a hand-rolled fetch or poll. Calls go through `getBridge().request(…)` with the `ApiRequest` shape (`params` fill `:segments`). Commands go through `commandRegistry.register(owner, commands)`, whose unregister must run on unmount ("Two owners of one command id are refused" in `app/src/commands/registry.ts`). Mirror: every body and response type comes from `app/src/api/contract.ts` (`AgentSetBody`, `WrightSetField`, `AgentCreateBody`, `AgentDetailResponse`, `RosterEntry`). Never widen or edit the contract (item 01 owns it).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/team/team.test.tsx`: Wright's card is first and is the whale | reverse the roster order in the Team view model (put crew before Wright) |
| `app/src/screens/team/team.test.tsx`: "no limit" when `tokens_per_day` is `null` | render `0` instead of the "no limit" words in the Team card's budget line |
| `app/src/screens/team/team.test.tsx`: the `never` list is labelled enforced | drop the "enforced" label from the inspector's `never` section |
| `app/src/screens/team/team.test.tsx`: Wright's inspector offers no `tool_policy`/`permission_mode` control | add `permission_mode` to the editable fields offered for Wright |
| `app/src/screens/team/team.test.tsx`: create calls `POST /agents` with the charter | change the create request's path from `/agents` to `/agents/:id/set` |
| `app/src/screens/team/team.test.tsx`: the app's never-category list equals the kernel's `NEVER_CATEGORIES` (read as text from `kernel/src/sessions/policy.ts`, the `Avatar.test.tsx` pattern) | delete `"git_push",` from the Team never-category list |
| `app/src/screens/team/team.test.tsx`: the shape picker offers exactly the kernel's `AVATAR_SHAPES` | delete `"crab"` from the Team form's shape list |
| `app/src/screens/team/team.test.tsx`: the hue picker offers exactly the kernel's `AVATAR_HUES` | delete `"crew-slate"` from the Team form's hue list |
| `app/src/screens/team/team.test.tsx`: a pending approval for the agent makes its task line "Waiting on you · …" | drop the pending-approval branch from the Team task-line selection |
| `app/src/screens/team/team.test.tsx`: Wright's inspector never requests `GET /agents/wright` | fetch `GET /agents/:id` on inspector open for every roster entry, Wright included |
| `app/e2e/team.spec.ts`: create and rename are driven by keyboard alone | set `tabIndex={-1}` on the New crew member Create control |
| `app/src/screens/team/team.test.tsx`: the permission-mode select offers exactly the keys of the kernel's `PERMISSION_MODES` (charter validator) | delete `"plan"` from the Team form's permission-mode list |
| `app/src/screens/team/team.test.tsx`: the inspector labels allowed tools and Bash prefixes as enforced | drop the allowed-tools section from the inspector's enforced block |
| `app/e2e/team.spec.ts`: the new card is absent after the `201` and appears only once the feed's `agent_created` event arrives (the fixture's `POST /agents` handler answers `201` first and appends the event only after the spec has asserted the card is absent) | in the Team create handler under `app/src/screens/team/`, add the returned agent to the roster locally on the `201` from `POST /agents` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Team screen: cards, inspector, New crew member form, ⌘K commands, unit tests | AC1–AC8, AC7's code comment, AC9's keyboard reachability and focus ring (unit tests), AC11 (typecheck/test/build) | 1 modify, 6 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Team e2e spec, fixture data, light/dark evidence of every designed state | AC1, AC3, AC6 (feed-driven card), AC7's README record, AC9's pointer-free Playwright drive of create and rename, AC10, AC11 (Playwright) | 0 modify, 3 create + screenshots | `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| screen | `app/src/screens/team/index.tsx` | `app/src/screens/team/model.ts` (roster + details + messages → card view model), `app/src/screens/team/Inspector.tsx`, `app/src/screens/team/NewCrewMember.tsx` (charter form + tool-picker `Dialog`, `Charter` as the preview), `app/src/screens/team/commands.ts`, `app/src/screens/team/team.css`, `app/src/screens/team/team.test.tsx` | HIGH for the directory, MEDIUM for the exact file split inside it |
| e2e + evidence | — | `app/e2e/fixtures/team.ts`, `app/e2e/team.spec.ts`, `docs/evidence/phase-5-polish/team/README.md`, `docs/evidence/phase-5-polish/team/*-light.png` / `*-dark.png` | HIGH |

Every path is inside the requirement's Touches (`app/src/screens/team/`, `app/e2e/fixtures/team.ts`, `app/e2e/team.spec.ts`, `docs/evidence/phase-5-polish/team/`). Nothing outside them is edited.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/team/index.tsx"}
  - {kind: "symbol", path: "app/src/screens/team/index.tsx", name: "screen"}
  - {kind: "file", path: "app/src/screens/team/Inspector.tsx"}
  - {kind: "file", path: "app/src/screens/team/NewCrewMember.tsx"}
  - {kind: "file", path: "app/src/screens/team/commands.ts"}
  - {kind: "file", path: "app/src/screens/team/team.test.tsx"}
requires: []
lanes:
  - "app/src/screens/team/**"
external_requires:
  - "kernel routes GET /agents, GET /agents/:id, POST /agents, POST /agents/:id/rename|set|off|on (merged; item 07 widened set for wright)"

# Subtask 2
provides:
  - {kind: "file", path: "app/e2e/fixtures/team.ts"}
  - {kind: "file", path: "app/e2e/team.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/README.md"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/screens/team/index.tsx", name: "screen"}
lanes:
  - "app/e2e/fixtures/team.ts"
  - "app/e2e/team.spec.ts"
  - "docs/evidence/phase-5-polish/team/**"
external_requires:
  - "Playwright Electron (xvfb on Linux CI) via app/e2e/electron-harness.ts launchApp/launchGallery"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (Subtask 2 drives what Subtask 1 renders) | YES (dependency: the spec and screenshots need the built screen) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/playwright-e2e/SKILL.md` |

(Both tables list the same skills.)

**Patterns to follow (read before writing):**
- Screen module: `app/src/screens/types.ts` (`ScreenDefinition`), and the placeholder's `export const screen`.
- Store: `app/src/store/react.ts` (`useResource`), `app/src/store/resources.ts` (`KIND_ROUTES`: `agent_` → `agents`; `agent_message_` → `messages`). Per-agent detail (`GET /agents/:id`) is not a store resource, so fetch it through the bridge on inspector open and when an `agent_*` event arrives (read `eventLog`/`lastEventId` from `useLiveStore`). Never add a resource to the shared table.
- Fake bridge for unit tests: `app/src/store/fake-bridge.ts`. RTL setup and the CSS mock: `app/src/components/Charter/Charter.test.tsx`.
- Kernel lists read as text in a test: `app/src/components/Avatar/Avatar.test.tsx` (`readFileSync`, the `export const NAME = Object.freeze([...])` regex). Use that same frozen-list pattern for `NEVER_CATEGORIES` (`kernel/src/sessions/policy.ts`) and `AVATAR_SHAPES`/`AVATAR_HUES` (`kernel/src/agents/types.ts`). The permission modes are NOT a frozen list. The create form feeds the charter validator, whose modes are the keys of the object literal `const PERMISSION_MODES = {` in `kernel/src/agents/charter-files.ts` (exported as `CHARTER_PERMISSION_MODES`). The session manager's `const PERMISSION_MODE_SET = {` in `kernel/src/sessions/manager.ts` holds the same values. The mode pin reads the charter-files literal's `key: true` lines with a small regex of its own and throws when it finds none, never by reusing `kernelFrozenList`.
- e2e: `app/e2e/fixture-kernel.ts` (`startFixtureKernel({ routes, events })`, `appendEvent`, `cannedStatus`, `unreachableDataDir`), `app/e2e/fixtures/README.md` (keys exactly as in `CONTRACT_ROUTES`), `app/e2e/electron-harness.ts` (`launchApp` hidden window; never `electron.launch` directly), and the evidence-writing pattern of `app/e2e/components.primitives.spec.ts` (an env flag writes into the evidence dir, else `testInfo.outputPath`). The mockup's Team (`renderTeam` in `docs/design/mockups/gui-v1.html`) and `docs/DESIGN.md`'s card layout rules.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): `RosterEntry` has no role or current task. | MEDIUM | Role = the crew member's `charter.persona` from `GET /agents/:id` (one call per crew member, cached in the screen and refetched on `agent_*` events). Wright's role is the fixed words "Lead agent". The current task is the agent's `running` brain message text from the `messages` resource (untrusted, as text), else "idle". Record this as a contract finding in the evidence README. Never edit the kernel or `contract.ts`. |
| Feasibility (Phase 2.5): no route reports Wright's current `effort` or `delegation_depth` (`GET /agents/wright` → `409 reserved`; the roster has only `model`, `tokens_per_day`, `sessions_at_once`). | MEDIUM | Show the known values from the roster. Effort and delegation depth stay editable through `POST /agents/wright/set`, and their current value shows as "not reported" (or the last `AgentSetResponse.new` this session) and is never guessed. Name the gap as a finding in the README and the PR (requirement: "a missing route or field is a finding, so stop and say so"). Never call `GET /agents/wright`. |
| Feasibility (Phase 2.5): `AgentCard` cannot show "no limit", sessions at once or status, and `Card.tsx` is outside this item's Touches. | MEDIUM | Do not edit `app/src/components/**`. Use `AgentCard` where its props fit. Where they don't, compose a Team-local card in `app/src/screens/team/` from `CardGrid` and the exported helpers (`formatTokens`, `budgetPercent`, `BUDGET_ATTENTION_PERCENT`) and the `card-*` classes, matching DESIGN.md's card rules (role two-line clamp, budget meter the only divider). Record the gap as a finding in the README. |
| Feasibility (Phase 2.5): the scope is over the `context-bound` bound. | MEDIUM | Two dependency-ordered subtasks (screen, then e2e + evidence), one worker. |
| The `Charter` component is a read-only preview (`onCreate`, `onEditInEnglish`, `onPickShape`) with no inputs, so the form is new Team code. | MEDIUM | Build the inputs from the `Input` primitives (`TextField`, `SelectField`) and show `Charter` as the live preview whose ⏎ Create calls `POST /agents`. The tool picker and the shape picker are `Dialog`s owned by Team. Start empty, with no presets. |
| The loading state is hard to capture: fixture routes answer synchronously. | LOW | Capture it with a Team-local gallery through `launchGallery` and a bridge that never answers (the components specs' pattern), kept inside `app/e2e/team.spec.ts`/`fixtures/team.ts`. `FixtureRoute` is synchronous, so a fixture route cannot hang. Never edit `fixture-kernel.ts` (item 01's). |
| AC7's prefill and AC8's "Open thread" depend on how Chat (item 13, sibling lane L1 this wave) reads the hash. `screenForHash` takes only the first segment. | LOW | Prefer the `POST /ask` path for AC7, which needs nothing from Chat. If Chat does not honour an agent or prefill hash, Team opens `#/chat` and records the gap as a finding in the evidence README. Never edit `app/src/screens/chat/`. |
| ⌘K id collisions with sibling lanes in this wave (L1 Chat, L3 Approvals) throw `CommandCollisionError`. | LOW | Own every command under owner `team` with ids `team.*`. Do not register "Message <agent>" (Chat's, item 13). Team's thread command opens `#/chat`. |
| Untrusted strings (names, persona, duties, refusal messages) reach the DOM. | MEDIUM | Render them only as React text children or `title` attributes, never `dangerouslySetInnerHTML` (invariant 3, `contract.ts` header). |
| Dollar figures shown as limits break D24. | LOW | Only `formatEstimate(…)` "≈ … at API rates" text, never a dollar field in the form or the limits. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-the-team-screen.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T08:51:53Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/117
- **Branch:** feature/the-team-screen
- **Files changed:** 26
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 3
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Team screen built (cards, inspector, charter form, team.* commands) with unit pins, a Playwright spec, and light/dark evidence. All 3 heal rounds found new instances of one class ("unread kernel state shown as a definite value"). Each was fixed (15958fc, 298cb75, f2879af), but the round-3 fix was not re-reviewed. Open: the Avatar has no unknown state (needs components/**). Driver note: supervisor-next-step.sh parsed the File Impact Map table as subtasks (ids Group, screen). The sidecar was corrected to the brief's two subtasks.

## Not verified
- **Team screen in running Electron against the fixture kernel** — not run by the subtask 1 worker; subtask 2 covered it (subtask 1)
- **#/chat/<agent> route from Open thread** — Chat is sibling lane item 13 (subtask 1)
- **visual two-line role clamp and focus ring rendering** — jsdom has no layout (subtask 1)
- **dark-mode sidebar vibrancy** — hidden-window captures render it flat grey; cause not established (subtask 2)
- **pointer path, Set a field, Turn off/on and team.* commands in Electron** — covered only by team.test.tsx in jsdom (subtask 2)
- **evidence screenshots under Linux CI fonts** — captured on macOS only (subtask 2)
