# Supervisor Job: The owner grants a crew member GitHub None, Read or Write in its Team inspector

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-12-180247/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-20/2026-11-12-170445-d-the-owner-grants-github-write-in-team.md
- **Base commit:** cfb3d428d99db7dcd83ab2c77c5d972738ab7500

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript app screen and the strict-TS kernel route it calls; vitest on both sides. |
| 2 | Dependency Availability | GO | No new dependency. The kernel already accepts `github:write` on `POST /agents/:id/set` (`kernel/src/agents/roster.ts`: `if (raw === "github:write") return { change: { kind: "github", level: "write" } };`), so the requirement's assumption holds for Write. |
| 3 | Architecture Fit | CAUTION | The kernel has no value that clears GitHub alone: `none` sets the whole `connectors` key to null (`if (raw === CLEAR_VALUE) return { value: null };`), which also drops a member's Jira/ClickUp tools, so "None" cannot meet the ClickUp/Jira AC with today's route. `mergeConnectorsGrant` already supports `{ kind: "github", level: null }`; only the parser lacks a value for it. Plan adds `github:none` in the kernel (the requirement's Assumptions allow the route change). Needs files outside Touches — asked once at Phase 6 action 1a. |
| 4 | Scope vs Supervisor Capability | GO | One worker: a 2-line kernel parser change plus one Team screen row; no split reason fires. |
| 5 | Hard Blockers | GO | None. The roster reports only the granted kinds (`connectors: ["github"]`) for read and write alike, so the level is read from the crew member's `GET /agents/:id` `settings.content.connectors`, which TeamView already fetches for every crew member (`useAgentDetails(api, crew, …)`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** In a crew member's Team inspector, the GitHub row shows and sets the grant as None, Read or Write (with a ⌘K command for each change), without touching the member's Jira/ClickUp grants; Wright's row behaves as today.

**Problem Statement:**
The owner needs to grant a crew member GitHub write in Team because a charter's readiness tells them to grant it there ("only you can grant it (Team, in the member's inspector)").
Currently the inspector's GitHub row offers only Grant (read) and Revoke (`setAgentConnectors` sends `"github" | "none"`), so the phase 8 exit live run (2026-11-12, `studio-sandbox-dev`) fell back on `studio agents set studio-sandbox-dev connectors github:write`. Revoke also sends `none`, which drops every connectors key, so it silently removes the member's Jira/ClickUp tools as well.
Success looks like: the owner sets None/Read/Write in the row or from ⌘K, the kernel stores exactly that GitHub level, every MCP tool grant stays as it was, and a refusal is shown in words with the row unchanged.

## Acceptance Criteria
- [ ] AC1 — Given a crew member (not Wright), when I open its inspector, then the GitHub row shows the grant as None, Read or Write (read from its `GET /agents/:id` `settings.content.connectors`: absent/null/`[]` → None, `["github"]` or `{github: "read"}` → Read, `{github: "write"}` → Write; content not read, a shape the kernel does not write, or the roster's own grant unknown (`githubGranted(agent) === undefined`, i.e. roster `connectors` null or missing — the settings file does not read ok) → unknown, never None; the roster check comes first, so a roster `null` reads unknown whatever the detail holds) and offers the other two levels in place; choosing one posts `{field: "connectors", value}` to `POST /agents/:id/set` with `github:none` / `github` / `github:write`, and the row changes only when the feed's `agent_*` event refetches (as every Team write does today).
- [ ] AC2 — Given the member's GitHub grant is Write, then one line under the row says that Write lets the member's live playbooks push and comment on GitHub, each through the approval gate; the line is absent at None and Read.
- [ ] AC3 — Given the member holds Jira or ClickUp tools, when I change the GitHub grant to any level (None included), then those tool grants are unchanged: the app never sends `none` for a GitHub change, and the kernel accepts `github:none` on `POST /agents/:id/set` (and `studio agents set <id> connectors github:none`), dropping only the `github` key through `mergeConnectorsGrant` (a grant left with no key removes `connectors`, as today).
- [ ] AC4 — Given Wright (the lead), then its row behaves as today: the grant words `granted` / `not granted` / `grant unknown`, a Grant GitHub button (read, posts `github`) or a Revoke button, no Write option and no write command; Revoke now posts `github:none` (so Wright's MCP grant, which Team cannot read, is never dropped by a GitHub revoke).
- [ ] AC5 — Given the kernel refuses a change (any non-ok outcome), then the inspector's notice says why in words (the kernel's message, as today) and the row keeps the old level (no local edit of the row).
- [ ] AC6 — Every GitHub change has a ⌘K command: for every agent, `Grant GitHub to <name>` (read) and `Revoke GitHub from <name>` (none), keeping their ids `team.grant-github.<id>` / `team.revoke-github.<id>`; for every crew member also `Grant GitHub write to <name>` (`team.github-write.<id>`). Each runs the same `changeGithubGrant` the row calls and is `enabled` only when its level differs from the member's known level (Grant: level None, or Write for a crew member; Revoke: Read or Write; write: None or Read); none is enabled while the level is unknown. Wright's two commands keep today's roster-based `enabled`.
- [ ] AC7 — `cd kernel && npm test`, `cd app && npm run typecheck && npm test` and `cd app && npm run e2e` (the CI `app` job's E2E step) pass, including the Team connectors tests, the updated `app/src/screens/team/team.test.tsx` command-id list, the updated `app/e2e/team.spec.ts` "phase 6 item 08" Connectors test, and new tests for: the level reader, the three-level row, the Write line, a refusal keeping the row, the write command, and the kernel's `github:none` keeping a Jira grant.
- [ ] AC8 — The docs that list the connectors values name `github:none` (only the GitHub key is dropped; `none` still clears all): `docs/architecture/agents.md` (the `set` bullet and "The field and its values" bullet) and `docs/architecture/mcp-connectors.md` ("Setting it" bullet), and the CLI's `set` usage line in `kernel/src/agents/roster.ts`.

## Scope widening
- app/src/screens/team/Inspector.tsx
- app/src/screens/team/TeamView.tsx
- app/src/screens/team/github-level.test.tsx
- app/src/screens/team/team.test.tsx
- app/e2e/team.spec.ts
- app/e2e/fixtures/team.ts
- docs/architecture/agents.md
- docs/architecture/mcp-connectors.md
- kernel/src/agents/roster.ts
- kernel/test/agents-connectors-grant.test.ts
- accepted: AUT-OVERLAP 2026-11-13

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

(Applies to the edit of the existing `app/e2e/team.spec.ts` test: it keeps launching through the harness's `launchApp`; no new `electron.launch` or `BrowserWindow`.)

## File Impact Map

| Path | Action | Lines at base | Confidence | Why |
|------|--------|---------------|------------|-----|
| `kernel/src/agents/roster.ts` | MODIFY | 766 | HIGH | `parseSetValue` accepts `github:none` → `{ change: { kind: "github", level: null } }`; the `set` usage line names it. Appended here: (766 — `parseSetValue` is the single parser of the route's and the CLI's connectors values). |
| `kernel/test/agents-connectors-grant.test.ts` | MODIFY | 434 | HIGH | Route + CLI tests: `github:none` drops only github from `{github: "write", jira: [...]}`, removes `connectors` when github was the only key, and is `changed: false` when github is not held. |
| `app/src/screens/team/actions.ts` | MODIFY | 87 | HIGH | `setAgentConnectors` value widens to a named `GithubGrantValue` (`"github" | "github:write" | "github:none"`); `none` is no longer sent for a GitHub change. Its docstring and `setAgentMcpTools`'s ("whose `github | none` value is never widened") are updated to the three GitHub values. |
| `app/src/screens/team/Connectors.tsx` | MODIFY | 168 | HIGH | Home of the new responsibility "GitHub level": `GithubLevel` type, the pure `githubLevel(content)` reader, `changeGithubGrant(api, agent, level)`, the three-level control for a crew member, the Write line, Wright's unchanged Grant/Revoke. |
| `app/src/screens/team/Inspector.tsx` | MODIFY | 458 | HIGH | Passes the member's level (from `acceptedSettings` content; undefined for Wright) and `lead` to `Connectors`; `onGrant` takes a level. |
| `app/src/screens/team/TeamView.tsx` | MODIFY | 593 | HIGH | `changeGrant(agent, level)`; computes each crew member's level from the `details` map it already holds and passes it to `useTeamCommands`. Appended here: (593 — the one place the screen wires its command handlers; a few lines). |
| `app/src/screens/team/commands.ts` | MODIFY | 112 | HIGH | Handler `setGithub(agent, level)` replaces `grantGithub`/`revokeGithub`; adds `team.github-write.<id>`; level-based `enabled` for crew; the levels join the re-register key. |
| `app/src/screens/team/connectors.test.tsx` | MODIFY | 534 | HIGH | Existing crew-member assertions move to the three-level row (see its Touched-file invariants entry for the full list); the `detail()` fixture carries `connectors: agent.connectors` so Mason reads Read. No new describes: (534 — at threshold, so new tests go to the CREATE below). |
| `app/src/screens/team/github-level.test.tsx` | CREATE | — | HIGH | New tests for AC1–AC6 (level reader, three-level row, Write line, refusal keeps the row, MCP untouched payloads, write command enabled states). |
| `app/src/screens/team/team.test.tsx` | MODIFY | 1397 | HIGH | The exact command-id list (`expect(ids).toEqual([`) gains `team.github-write.mason` and `team.github-write.pim` after each member's `team.revoke-github.<id>` (or wherever `teamCommands` pushes it). Edit only: (1397 — the one pin of the full id list; two lines). |
| `app/e2e/team.spec.ts` | MODIFY | 734 | HIGH | The "phase 6 item 08 … Revoke and Grant GitHub" test: Mason's row uses the three-level control (Read shown, choose None posts `github:none`, choose Read posts `github`, choose Write posts `github:write` and shows the Write line); Wright's part (Grant GitHub posts `github`, its detail never requested) is unchanged. Edit only: (734 — the existing test of this row; no new test file for one flow). |
| `app/e2e/fixtures/team.ts` | MODIFY | 441 | HIGH | The `POST /agents/:id/set` fake accepts `github`, `github:write`, `github:none` (and keeps `none`), keeps the grant level per agent, and serves it in Mason's `GET /agents/:id` `settings.content.connectors` so the row reads it after the feed's refetch. |
| `docs/architecture/agents.md` | MODIFY | 384 | HIGH | AC8: name `github:none` in the `set` bullet and "The field and its values" bullet. |
| `docs/architecture/mcp-connectors.md` | MODIFY | 197 | HIGH | AC8: "Setting it" bullet names `connectors github:none` as dropping only the GitHub key. |

Not changed: `app/src/screens/team/model.ts` (560, at threshold — `githubGranted` stays the roster's read for Wright and the commands' fallback); `app/src/api/contract.ts` (`AgentConnectorsSetBody.value` is already `string`); `kernel/src/agents/settings.ts` (`mergeConnectorsGrant` already handles `level: null`).

## Touched-file invariants

> Grounded at base `cfb3d428d99db7dcd83ab2c77c5d972738ab7500`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/agents/roster.ts`** — keep: a refused value names the field and the one message: `return parseMcpGrantValue(raw) ?? { message: CONNECTORS_VALUE_MESSAGE };`; keep `none` meaning "clear every connector" (`if (raw === CLEAR_VALUE) return { value: null };`) for the CLI; reuse: the merge path `mergeConnectorsGrant(json[CONNECTORS_FIELD], parsed.change)` — `github:none` must be a `change`, never a `value`; mirror: `ConnectorsGrantChange`'s `{ readonly kind: "github"; readonly level: "read" | "write" | null }` in `kernel/src/agents/settings.ts`; pinned by: `kernel/test/phase-8-foundation.test.ts` (`for (const value of ["github:read", "github:", "GITHUB:write", "github:write "])` stay refused with `connectors must be github or none`) and `kernel/test/agents-connectors-grant.test.ts` (`"connectors must be github or none"`) — keep `CONNECTORS_VALUE_MESSAGE` text unchanged.
- **`kernel/test/agents-connectors-grant.test.ts`** — keep: the existing refusal assertions (`"connectors must be github or none"`) and the CLI stderr shape (`studio: agent reviewer not changed: invalid_input: connectors must be github or none`); the new `github:none` tests (route and CLI) sit in a new `describe` beside the existing connectors-set tests and reuse the file's own fixtures and set helper, never a second settings writer.
- **`app/src/screens/team/actions.ts`** — keep: every call goes through the file's own `call<R>` helper over the preload bridge (`never a hand-rolled fetch`); keep `setAgentMcpTools` a separate setter.
- **`app/src/screens/team/Connectors.tsx`** — keep: unknown is never "not granted" (`GRANT_WORDS = { granted: "granted", notGranted: "not granted", unknown: "grant unknown" }`); keep: nothing edits the row locally — it changes only on the feed's refetch ("Nothing here edits\n// the row"); keep every string a React text child; keep `changeMcpGrant` and `McpRow` unchanged.
- **`app/src/screens/team/Inspector.tsx`** — keep: Wright has no detail route (`const mcpSettings = lead ? undefined : content;`) — Wright's level is never read from detail; keep: a refused or unread settings file is unknown (`acceptedSettings(ok)`).
- **`app/src/screens/team/TeamView.tsx`** — keep: `// The row changes only from the feed's `agent_*` refetch of the roster, never from this answer.`; keep error notices named for the agent (`` `${agent.display_name}: ${outcome.text}` ``).
- **`app/src/screens/team/commands.ts`** — keep ids `team.grant-github.${agent.id}` and `team.revoke-github.${agent.id}`; keep re-registration only on a key change (`function rosterKey`), with handlers read through the ref (`latest.current.handlers`); pinned by: `app/src/screens/team/connectors.test.tsx` (`describe("Grant GitHub and Revoke GitHub commands"`).
- **`app/src/screens/team/connectors.test.tsx`** — keep its existing describes and every Wright-path assertion. Fixture decision: `function detail(agent: RosterEntry` adds `connectors: agent.connectors` to `settings.content` (before `...extra`) only when `agent.connectors` is a non-null array, so a crew member's level matches its roster grant (Mason Read, Pim None). The roster-`connectors: null` "grant unknown" test keeps its detail as is and still expects unknown with no level control, because AC1's reader checks the roster first (`githubGranted(agent) === undefined` → unknown). These crew-member assertions change to the three-level row: the grant words for Mason (`"granted"` → Read), the `connectors: null` "grant unknown" case (stays unknown, no level control), the test that clicks "Revoke" on Mason (now chooses None, posts `github:none`), the test that clicks "Grant GitHub" on Pim (now chooses Read, posts `github`), the commands' crew `enabled` expectations (now level-based), and the Revoke command's posted value (`"none"` → `"github:none"`). The MCP describes (`mcpToolsHeld and mcpGrantRows`, `changeMcpGrant`, `the Connectors row's MCP grant`) are unchanged.
- **`app/src/screens/team/team.test.tsx`** — keep the order rule of `expect(ids).toEqual([`: the list stays the exact registry order; only the two write-command ids are added.
- **`app/e2e/team.spec.ts`** — keep: `const page = await openTeam(team);` (launch through the harness), `screenshots(page, "connectors-connected", testInfo)`, and Wright's part including `"Wright's detail is never requested"`.
- **`app/e2e/fixtures/team.ts`** — keep: the refusal shape `message: "connectors must be github or none"` for any other value, and `kernel?.appendEvent(event("agent_settings_set"` after a change (the row follows the feed).

## Closed enumerations touched

> Sibling grep at base `cfb3d428d99db7dcd83ab2c77c5d972738ab7500`: `grep -rnF 'github:write' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor --exclude-dir=.git .` → 19 hits in 8 files.

- **`github:none`** (sibling: `github:write`) — must be named in:
  - `kernel/src/agents/roster.ts` — `parseSetValue` (`if (raw === "github:write") return { change: { kind: "github", level: "write" } };`) — extend; the `set` usage line (`${CONNECTORS_FIELD} github:write for the GitHub write level`) — extend; the header comment (`connectors github:write`) — extend; `// \`github:write\` is the owner's write grant` comment and the object-form display (`github:write jira:a,b`) — no change: the display prints a stored grant, and `github:none` is never stored.
  - `kernel/src/agents/settings.ts` — `parseMcpGrantValue`'s doc (`caller handles \`github\`, \`github:write\`, \`none\``) — no change: a doc comment, not a closed list; extending it is optional and outside lanes.
  - `docs/architecture/agents.md` — the `set` bullet's value list (`` `github`, `github:write`, `jira:<tool>[,<tool>…]` ``) and "The field and its values" (`studio agents set <id> connectors github:write`) — extend; "The `github: write` level" bullet — no change (it describes the write level).
  - `docs/architecture/mcp-connectors.md` — "Setting it" (`` `connectors github` and `connectors github:write` change only the GitHub level ``) — extend.
  - `docs/ARCHITECTURE.md` — the closed sets paragraph (`CONNECTOR_KINDS` is `github`, `jira`, `clickup`) — no change: it lists kinds, not `set` values.
  - `app/src/screens/team/actions.ts` — the new `GithubGrantValue` union is itself the app's closed list — create with all three.
  - `app/e2e/fixtures/team.ts` — the fake's accepted values (`body.value !== "github" && body.value !== "none"`) — extend.
  - `app/e2e/phase-8-exit.spec.ts`, `kernel/test/phase-8-foundation.test.ts`, `kernel/test/integrations-mcp-connector.test.ts` — no change: they post `github:write` to the real kernel; none lists the accepted values (the refused list in phase-8-foundation does not contain `github:none`).
  - `CONNECTORS_VALUE_MESSAGE` (`connectors must be github or none`) — deliberately unchanged: pinned by three tests.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-connectors-grant.test.ts` — `github:none` keeps the jira tools | delete `if (raw === "github:none") return { change: { kind: "github", level: null } };` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-connectors-grant.test.ts` — `github:none` on `["github"]` removes the `connectors` key | flip `if (raw === "github:none") return { change: { kind: "github", level: null } };` → `if (raw === "github:none") return { value: [] };` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-connectors-grant.test.ts` — `github:none` with no github held answers `changed: false` | delete `if (JSON.stringify(old) === JSON.stringify(next)) return` in `kernel/src/agents/roster.ts` |
| `app/src/screens/team/github-level.test.tsx` — a refusal shows the kernel's message and the row keeps the old level | make `onGrant` in `app/src/screens/team/Inspector.tsx` set the chosen level locally before the call resolves |
| `app/src/screens/team/github-level.test.tsx` — the ⌘K level commands are disabled while the level is unknown | make `team.github-write.<id>` `enabled` when the level is undefined in `app/src/screens/team/commands.ts` |
| `app/src/screens/team/github-level.test.tsx` — a roster `connectors: null` reads unknown even with a detail holding a grant | delete the `githubGranted(agent) === undefined` check in `app/src/screens/team/Connectors.tsx` |
| `app/src/screens/team/github-level.test.tsx` — choosing None posts `github:none` | flip `"github:none"` → `"none"` in `app/src/screens/team/Connectors.tsx` |
| `app/src/screens/team/github-level.test.tsx` — the Write line shows only at Write | delete the line rendering the Write explanation in `app/src/screens/team/Connectors.tsx` |
| `app/src/screens/team/github-level.test.tsx` — `team.github-write.<id>` registered for a crew member, absent for Wright | delete the `team.github-write.` command push in `app/src/screens/team/commands.ts` |
| `app/src/screens/team/connectors.test.tsx` — Revoke button and Revoke command post `github:none` | flip `"github:none"` → `"none"` in `app/src/screens/team/Connectors.tsx` |
| `app/src/screens/team/connectors.test.tsx` — Mason (roster `["github"]`, detail `["github"]`) reads Read | make `githubLevel` return `"none"` for the array form in `app/src/screens/team/Connectors.tsx` |
| `app/src/screens/team/connectors.test.tsx` — crew Revoke command disabled at None | make `team.revoke-github.<id>` `enabled` at level None in `app/src/screens/team/commands.ts` |
| `app/src/screens/team/team.test.tsx` — exact command-id list with `team.github-write.mason` | delete the `team.github-write.` command push in `app/src/screens/team/commands.ts` |
| `app/e2e/team.spec.ts` — choosing None on Mason posts `github:none` | flip `"github:none"` → `"none"` in `app/src/screens/team/Connectors.tsx` |
| `app/e2e/team.spec.ts` — choosing Write posts `github:write` and shows the Write line | delete the line rendering the Write explanation in `app/src/screens/team/Connectors.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | GitHub None/Read/Write in Team, with `github:none` in the kernel | AC1–AC8 | 13 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — GitHub None/Read/Write in Team (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "github:none"}
  - {kind: "type", path: "app/src/screens/team/Connectors.tsx", name: "GithubLevel"}
  - {kind: "symbol", path: "app/src/screens/team/Connectors.tsx", name: "githubLevel"}
  - {kind: "symbol", path: "app/src/screens/team/Connectors.tsx", name: "changeGithubGrant"}
  - {kind: "type", path: "app/src/screens/team/actions.ts", name: "GithubGrantValue"}
  - {kind: "symbol", path: "app/src/screens/team/commands.ts", name: "team.github-write."}
  - {kind: "file", path: "app/src/screens/team/github-level.test.tsx"}
requires: []
lanes:
  - "kernel/src/agents/roster.ts"
  - "kernel/test/agents-connectors-grant.test.ts"
  - "app/src/screens/team/actions.ts"
  - "app/src/screens/team/Connectors.tsx"
  - "app/src/screens/team/Inspector.tsx"
  - "app/src/screens/team/TeamView.tsx"
  - "app/src/screens/team/commands.ts"
  - "app/src/screens/team/connectors.test.tsx"
  - "app/src/screens/team/github-level.test.tsx"
  - "app/src/screens/team/team.test.tsx"
  - "app/e2e/team.spec.ts"
  - "app/e2e/fixtures/team.ts"
  - "docs/architecture/agents.md"
  - "docs/architecture/mcp-connectors.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (single)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | — | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): plan needs files outside the requirement's Touches (kernel parser + test, Inspector, TeamView, a new test file, team.test.tsx, the Team E2E spec and fixture, two architecture docs) | HIGH | Recorded in `## Scope widening` as `pending-coordinator`; the kernel change is two lines on the existing merge path. |
| Feasibility (Phase 2.5): `none` drops Jira/ClickUp tools with GitHub | MEDIUM | The app sends `github:none` for every GitHub change (Wright's Revoke included); a kernel test pins that `github:none` keeps a jira grant. |
| The roster cannot tell Read from Write | MEDIUM | Level read from the crew member's detail `settings.content` (already fetched); unknown while loading or refused, never None; ⌘K commands disabled while unknown. |
| A downgrade or revoke of write is a security-relevant change | LOW | Every write still goes through the approval gate (D39/D41 unchanged); the row never edits itself, so a refused change can't show a level the kernel didn't store. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
`/supervisor job: .supervisor/jobs/pending/2026-11-12-github-write-grant-in-team.md` in a fresh session.

## Outcome
- **Status:** completed
- **Completed:** 2026-11-13T02:30:55Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/269
- **Branch:** feature/github-write-grant-in-team
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** A crew member's Team GitHub row shows and sets None / Read / Write (with ⌘K commands and a Write line); the kernel accepts `github:none`, which drops only the GitHub key, so Jira/ClickUp grants survive. Phase 4.5 round 1 raised one MEDIUM (focus lost after a level change), fixed in 8ad8c398; round 2 PASS with one LOW dismissed (below floor). Pin mutations: script could not apply any row (15 unverified); reviewers applied 11 by hand in scratch copies — all held.

## Not verified
- **Connectors row visual layout (level buttons beside the Write line) in light and dark** — screenshots written but not viewed; spacing with reused team-insp-subhead class unchecked (subtask 1)
- **Real kernel with the app (end-to-end github:none from the Team UI)** — E2E uses a fixture kernel; the kernel route is covered by its own tests only (subtask 1)
