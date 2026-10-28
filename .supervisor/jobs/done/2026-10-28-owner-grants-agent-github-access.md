# Supervisor Job: The owner grants an agent GitHub access, from the CLI or Team's inspector (phase 6 item 08)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-27-114124/L6
- **CLAUDE.md:** ✓ Found (fresh: every path it names exists; `kernel/` strict TS + vitest, `app/` Electron + React)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095108-the-owner-grants-an-agent-github-access.md
- **Base commit:** f3f2ee52e8ffb003922c5795ccbe917081fb8a37

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel TS route/verb in `kernel/src/agents/roster.ts`; React inspector in `app/src/screens/team/`. Same stack as phase 5 item 07. |
| 2 | Dependency Availability | CAUTION | The foundation (item 01) is merged: `connectors: z.array(z.enum(CONNECTOR_KINDS)).optional()` in `kernel/src/agents/settings.ts`, `connectorsFor(dataDir)` in `kernel/src/kernel.ts`, `toolsForConnectors` in `kernel/src/integrations/tool-filter.ts`, and `GET /connectors` (item 03) is served. But item 06's GitHub tools are not built: `githubToolsPart.tools` is `Object.freeze([])` in `kernel/src/integrations/github/tools.ts`. So AC1/AC2 ("lists the GitHub tools") are proven with a stub `requiresConnector: "github"` tool, the idiom `kernel/test/integrations-foundation.test.ts` already uses (`kernel_fake_github_read`). |
| 3 | Architecture Fit | GO | `set` is the one owner write path for agent settings (temporary sibling, re-read, rename inside the event's transaction). `config/` is protected (`PROTECTED_DATA_DIRS = ["config", "app"]` in `kernel/src/sessions/policy.ts`). `kernel_agent_update`'s `changesSchema` is `.strict()` and has no `connectors` key. |
| 4 | Scope vs Supervisor Capability | GO | 23 files across kernel and app (6 in subtask 1, 17 in subtask 2, the 4 PNGs included). Split into two subtasks (context-bound: more than 12 files). |
| 5 | Hard Blockers | GO | None. Sequencing note: the requirement says phase 6 should run after phase 5's live exit. `docs/evidence/phase-5-exit-live-2026-10-25.json` now exists, so this is recorded as a risk, not a blocker. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Let the owner grant or revoke GitHub access per agent (crew member or Wright) with `studio agents set <id> connectors github|none` / `POST /agents/:id/set {field: "connectors", value}`, show and toggle it in Team's inspector (button and ⌘K), and render the grant into `role.md` and the docs. No agent session can widen it.

**Problem Statement:**
The owner needs to choose which crew members can read their repos, because phase 6's GitHub tools and PR polling must be a real per-agent boundary.
Currently, the `connectors` field exists in the settings schema, but nothing sets it: `set` refuses it (`AGENT_SET_FIELDS` has only scalar fields), and the inspector does not show it. The owner would have to hand-edit `config/agents/<id>.json`.
Success looks like this: one CLI verb or one inspector click (or ⌘K) writes `connectors: ["github"]` or removes it, appends one `agent_settings_set` event, and changes which tools that agent's next session lists. A session can never do the same.

**Design decisions this brief fixes (mechanism only, invariant 1):**
- **One accepted field, kept apart from the scalar lists.** The route takes the contract's existing `AgentConnectorsSetBody` (`{field: "connectors", value: string}`, `app/src/api/contract.ts`) for crew members AND Wright. `AGENT_SET_FIELDS` and `WRIGHT_SET_FIELDS` keep their current content. A separate exported constant (`CONNECTORS_FIELD = "connectors"` in `roster.ts`) names the extra field, mirroring the contract, which keeps it apart from `AgentSetField`/`WrightSetField`.
- **Values.** `github` writes `connectors: ["github"]`. `none` removes the `connectors` key (as `none` removes `effort` or a limit). Any other value is `400 invalid_input`, `field: "connectors"`, message `connectors must be github or none`. A file holding `connectors: []` and the value `none` read as the same value (no grant): `changed: false` and no event.
- **Answer and event.** `200 {agent, field: "connectors", old, new, changed}`, where `old`/`new` are the array or `null` (no grant). The event is the existing `agent_settings_set` `{id, field: "connectors", old, new}`, with `by: "owner"` for Wright, as for its other fields. No new event kind.
- **Granting while GitHub is not connected** is allowed and recorded. The kernel never reads the connector's state to decide the grant.
- **The roster says who holds it.** `RosterEntry` (kernel `roster.ts`) gains `connectors: readonly ConnectorKind[] | null`: the file's grants (`[]` when none), or `null` when the settings file does not read ok (for Wright, also when `wright.json` is absent). The app contract's `RosterEntry` gains it as OPTIONAL (`readonly connectors?: readonly ConnectorKind[] | null`), so the chat and sessions fixtures need no edit. The inspector reads a missing value as unknown.
- **Sessions can't set it.** `kernel_agent_update` already refuses a `connectors` change (strict `changesSchema`), and a session's Write/Edit/Bash to `config/agents/*.json` is refused by the protected-path rail. This item adds the pins for both and changes neither.
- **role.md.** `renderRoleMd(charter, connectors?)` lists the granted connectors in "What the kernel enforces" ("your model, permission mode, tool policy, never list, limits, workspaces and connectors (GitHub)"). It renders byte-identical to today when nothing is granted, so the `role-example` doc block and its pin stay unchanged. `writeCharterFiles` (used by `ensureAgentFiles`) passes the settings file's `connectors`, read through `readAgentSettings` after the settings file exists. `set` never rewrites an existing `role.md` (the owner's edits win, invariant 8). "Regenerated" means re-created by `ensureAgentFiles`, and the docs state this limit.

## Acceptance Criteria
- [ ] 1. Given crew member `reviewer` with no grant, when the owner runs `studio agents set reviewer connectors github`, then `config/agents/reviewer.json` holds `"connectors": ["github"]` with every other key unchanged, exactly one `agent_settings_set` event `{id: "reviewer", field: "connectors", old: null, new: ["github"]}` is appended, and a session the kernel starts for `reviewer` next (the `SessionManager` `mcpServers` factory fed by `connectorsFor(dataDir)` and `toolsForConnectors`) lists a stub `requiresConnector: "github"` tool.
- [ ] 2. Given `reviewer` holds the grant, when the owner runs `studio agents set reviewer connectors none`, then the `connectors` key is gone from the file, one event `{field: "connectors", old: ["github"], new: null}` is appended, and the next session lists no `requiresConnector: "github"` tool. Running `none` again answers `changed: false` and appends no event.
- [ ] 3. Given `studio agents set wright connectors github`, then `config/agents/wright.json` holds `"connectors": ["github"]`, the event carries `by: "owner"`, and Wright's next session lists the stub GitHub tool. Given GitHub is not connected, the grant still succeeds.
- [ ] 4. Given a value other than `github` or `none` (e.g. `gitlab`, `GitHub`, `""`), when posted to `POST /agents/reviewer/set {field: "connectors", value}`, then it answers `400 invalid_input` with `field: "connectors"`, and the file and the events are unchanged.
- [ ] 5. Given an agent's session calls `kernel_agent_update` with `changes: {connectors: ["github"]}` (Wright updating `reviewer`), or a crew session's Write/Edit/Bash targets its own `config/agents/<id>.json`, then the call is refused, the settings file's bytes are unchanged, and no `agent_settings_set`/`agent_updated` event is appended.
- [ ] 6. Given `GET /agents`, then every entry carries `connectors`: `["github"]` for a granted agent, `[]` for one without a grant, and `null` for one whose settings file does not read ok.
- [ ] 7. Given `role.md` re-created by `ensureAgentFiles` after `reviewer` was granted GitHub, then its "What the kernel enforces" paragraph names GitHub. Given no grant, `renderRoleMd` output is byte-identical to the base commit's (the `role-example` doc block pin in `kernel/test/agents-roster.test.ts` stays green, unedited).
- [ ] 8. Given Team's inspector on a granted agent (crew member or Wright), then a Connectors row shows "GitHub" and the connector's state, read from `GET /connectors`: "connected" or "expiring" from the row's status, "not connected" for no row or `rejected`/`disconnected`/`expired`, and "state unknown" when the fetch fails. The row refetches on a `connector_status` feed event.
- [ ] 9. Given the inspector on a granted agent, when the owner clicks Revoke or runs the ⌘K command `Revoke GitHub from <name>` (id `team.revoke-github.<id>`), then each calls `POST /agents/:id/set {field: "connectors", value: "none"}`, and the row updates only from the `agent_*` feed refetch, never a local edit. Given a non-granted agent, Grant GitHub and `Grant GitHub to <name>` (id `team.grant-github.<id>`) call it with `"github"`. Each command is `enabled` only in its matching state, and the commands re-register when an agent's `connectors` change.
- [ ] 10. Given the e2e Team spec run with `TEAM_EVIDENCE=1`, then `docs/evidence/phase-5-polish/team/` contains `team-connectors-connected-{light,dark}.png` and `team-connectors-not-connected-{light,dark}.png`, and a committed evidence file `docs/evidence/phase-5-polish/team/README.md` lists those four screenshots (the states and what each shows). The PR body links to it.
- [ ] 11. Given `docs/architecture/agents.md`, then it documents `connectors`: the field, its values, that only the owner's `set` route and verb set it (for crew members and Wright), what it gates (item 06's `requiresConnector` tools, item 05's "needs GitHub" parking, item 07's `gh` deny), the roster's `connectors`, the `role.md` line, and the honest limit that an existing `role.md` is not rewritten.
- [ ] 12. `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test && npm run build` and `bash scripts/check-docs.sh` all pass. `agents-roster.test.ts` and the Team tests are green.

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## File Impact Map

Module layout threshold: 500 lines (`skills/supervisor-readiness/SKILL.md` §"Module layout"). Line counts are at the base commit.

| Path | Action | Confidence | Home / reason |
|------|--------|-----------|---------------|
| `kernel/src/agents/roster.ts` (692) | MODIFY | HIGH | (692 — the single owner write path for agent settings: the connectors branch must reuse `set`'s temp-sibling/re-read/rename and event, not a second writer). Adds `CONNECTORS_FIELD`, the `connectors` value parse, list-aware `valueAt`/`withValue`, `RosterEntry.connectors`, verb usage text and `formatAgent`'s `connectors:` line. |
| `kernel/src/agents/charter-files.ts` (537) | MODIFY | HIGH | (537 — the single authority for `role.md` text). `renderRoleMd(charter, connectors?)` and `writeCharterFiles` reading the settings file's grants. |
| `kernel/test/agents-connectors-grant.test.ts` | CREATE | HIGH | New responsibility's tests (AC1–AC7). It does not go in `agents-roster.test.ts` (866) or `agents-charter-tools.test.ts` (896), both past the threshold. |
| `kernel/test/agents-roster.test.ts` (866) | MODIFY | MEDIUM | Only existing pins the change breaks (roster entry shape, `set` usage text). Nothing new is appended. |
| `kernel/test/agents-wright-settings.test.ts` (415) | MODIFY | HIGH | Two edits. (a) Its pin of Wright's `reserved` message (`set takes only model, effort, ...`) is updated to name `connectors`. (b) The block `describe("connectors is not settable yet (phase 6 item 08)"` is INVERTED. Its expectations that a connectors set is refused (`409 reserved` for Wright, `[400, "invalid_input", "field"]` for a crew member, the CLI non-zero, `events(env.store, "agent_settings_set")` `[]`) are deleted, because AC1–AC4 in `agents-connectors-grant.test.ts` replace them. Its still-true assertions stay: both scalar lists do not contain `connectors`, and a set of another field keeps the grant. The block is renamed for what it now pins. |
| `docs/architecture/agents.md` (299) | MODIFY | HIGH | AC11. |
| `app/src/api/contract.ts` (931) | MODIFY | HIGH | (931 — the one app↔kernel contract). Optional `RosterEntry.connectors`, `AgentSetResponse.field`/`old`/`new` widened for `"connectors"` and arrays, and the item-08 comments updated. |
| `app/src/screens/team/Connectors.tsx` | CREATE | HIGH | The inspector's Connectors row (a separate concern; `Inspector.tsx` renders it). |
| `app/src/screens/team/Inspector.tsx` (411) | MODIFY | HIGH | Renders `<Connectors>` and passes the grant and connector state. |
| `app/src/screens/team/actions.ts` (62) | MODIFY | HIGH | `setAgentConnectors(api, id, value)` and `fetchConnectors(api)`. |
| `app/src/screens/team/commands.ts` (89) | MODIFY | HIGH | Grant/Revoke commands. `rosterKey` includes `connectors`. |
| `app/src/screens/team/model.ts` (491) | MODIFY | HIGH | Pure helpers: `connectorStateText(connectors response)` and `githubGranted(entry)` (true / false / unknown). |
| `app/src/screens/team/TeamView.tsx` (533) | MODIFY | MEDIUM | (533 — it owns the screen's fetches and the feed refetch). `GET /connectors` on mount and on `connector_status`, plus the new command handlers. |
| `app/src/screens/team/team.css` (379) | MODIFY | LOW | Connectors row layout, only if the phase 5 components need it. |
| `app/src/screens/team/team.test.tsx` (1391) | MODIFY | HIGH | Only the ⌘K id-list pin (`expect(ids).toEqual([`), extended with `team.grant-github.<id>` / `team.revoke-github.<id>` for wright, mason and pim in `teamCommands` order. Nothing new is appended. |
| `app/src/screens/team/connectors.test.tsx` | CREATE | HIGH | AC8/AC9 unit tests. It does not go in `team.test.tsx` (1391). |
| `app/e2e/team.spec.ts` (661) | MODIFY | HIGH | (661 — the Team spec owns the fixture launch, the `screenshots` helper and `EVIDENCE_DIR`. A second spec would make a ninth copy of the per-spec `screenshots` helper.) Adds the connectors states and screenshots. |
| `app/e2e/fixtures/team.ts` (372) | MODIFY | HIGH | Roster `connectors`, a `GET /connectors` fixture route (connected and none), and `POST /agents/:id/set` for `connectors`. |
| `docs/evidence/phase-5-polish/team/README.md` (112) | MODIFY | HIGH | AC10 evidence file: lists the four new screenshots. |
| `docs/evidence/phase-5-polish/team/team-connectors-{connected,not-connected}-{light,dark}.png` | CREATE | HIGH | Four PNGs written by the spec under `TEAM_EVIDENCE=1`. |

## Touched-file invariants

> Grounded at base `f3f2ee52e8ffb003922c5795ccbe917081fb8a37`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/agents/roster.ts`**. Keep: the one write path, `writeFileSync(temp, text, { flag: "wx", mode: 0o600 })`, then the re-read `if (!readFileSync(file).equals(base)) throw new ConcurrentEditError();`, then `renameSync(temp, file)` inside `req.store.transaction`. Keep: the field and value are checked before any filesystem call ("so a refused Wright set never creates `wright.json`"). Keep: a file the reader refuses is never rewritten (`if (!check.ok && !(check.error === "model_unset" && field === "model"))`). Reuse: `appendEvent(req.store, "agent_settings_set" satisfies AgentAuditKind, ...)`, `refusal(...)` and `CLEAR_VALUE`. Mirror: the contract's `AgentConnectorsSetBody` (`readonly field: "connectors";`) in `app/src/api/contract.ts`. Imports: the `studio` CLI loads this module, so it imports only types, zod, `node:*` and leaf modules (`kernel/test/feature-seams.test.ts` pins the graph). `ConnectorKind` comes type-only from `../integrations/types.js`. Pinned by: `kernel/test/agents-roster.test.ts` (`studio("agents", "set", "mason", "limits.delegation_depth", "2")`) and `kernel/test/agents-wright-settings.test.ts` (`Wright is not a crew member: set takes only model, effort, limits.tokens_per_day, limits.sessions_at_once or`).
- **`kernel/src/agents/charter-files.ts`**. Keep: `writeIfAbsent`. An existing file, the owner's edit included, is never touched ("An existing file, the owner's edit included, is never touched"). Keep: `renderRoleMd(charter)` called with one argument stays byte-identical. Pinned by: `kernel/test/agents-roster.test.ts` (`expect(docBlock("role-example", "```markdown")).toBe(renderRoleMd(example.charter));`) and `kernel/test/agents-charter-tools.test.ts` (`for (const line of renderRoleMd(c).trimEnd().split("\n")) expect(block).toContain`). Keep: the module imports only zod, `node:*`, store types and leaf modules (`never the Agent SDK`).
- **`kernel/test/agents-roster.test.ts`**. Keep every existing assertion's intent. Edit only an expected value that the new `connectors` roster key or the `connectors` mention in the usage text changes. The `role-example` pin is not edited (AC7).
- **`kernel/test/agents-wright-settings.test.ts`**. Keep every assertion's intent EXCEPT in `describe("connectors is not settable yet (phase 6 item 08)"`. Its refusal expectations are the ones this item deliberately inverts (see the File Impact Map row). Keep in it `expect(AGENT_SET_FIELDS as readonly string[]).not.toContain("connectors");`, the `WRIGHT_SET_FIELDS` twin and `expect(wrightJson().connectors).toEqual(["github"]);` after a `model` set. Update `RESERVED_MESSAGE` to the new text.
- **`docs/architecture/agents.md`**. Keep: the `role-example` fenced block under `### The rendered \`role.md\`` unchanged (pinned by `docBlock("role-example"`). Keep: every relative link resolving (`bash scripts/check-docs.sh`).
- **`app/src/api/contract.ts`**. Keep: `CONTRACT_ROUTES` unchanged ("Phase 6 item 08 adds no route: it widens `POST /agents/:id/set` to take"), mirrored by `kernel/test/console-contract.test.ts`. Keep: `AgentSetField` and `WrightSetField` unchanged (the Team set-field form lists them, pinned by `team.test.tsx`'s `toEqual(["model", "effort", "permission_mode", "limits.tokens_per_d`).
- **`app/src/screens/team/commands.ts`**. Keep: owner `TEAM_OWNER = "team"`, ids prefixed `team.`, and "Each command calls the same handler as its button". Reuse: `useTeamCommands`'s ref-forwarding (`latest.current.handlers`), adding the new handlers to `forward`.
- **`app/src/screens/team/actions.ts`**. Keep: every call goes through `call<R>(api, request)` (the preload bridge), "never a hand-rolled fetch".
- **`app/src/screens/team/Inspector.tsx`, `TeamView.tsx`, `model.ts`, `team.css`**. Keep: "A change reaches the card through the feed (`agent_*` events refetch `agents`), never a local edit." Keep: every kernel string is a React text child (invariant 3). Keep: `GET /agents/wright` is never called. Wright's grant comes from the roster entry.
- **`app/src/screens/team/team.test.tsx`**. Keep every assertion except the `expect(ids).toEqual([` list (from `"team.new-crew-member",` to `"team.thread.pim",`), which gains `team.grant-github.<id>` / `team.revoke-github.<id>` for wright, mason and pim in `teamCommands` order. Keep unedited the set-field option pins (`toEqual(["model", "effort", "permission_mode", "limits.tokens_per_d` and the Wright twin) and the `team.on.mason` / `team.off.mason` `enabled` pins. Append no new tests (they go in `connectors.test.tsx`).
- **`app/e2e/team.spec.ts`, `app/e2e/fixtures/team.ts`**. Keep: Electron launched only via `launchApp`/`launchGallery` from `./electron-harness` (house rule). Reuse: the spec's own `screenshots(page, state, testInfo)` and `EVIDENCE_DIR`, so screenshots go to the committed dir only under `TEAM_EVIDENCE=1` ("so CI never dirties tracked files"). The spec asserts behaviour, never pixels.

## Closed enumerations touched

> Sibling grep at base `f3f2ee52e8ffb003922c5795ccbe917081fb8a37`: `grep -rnF 'limits.delegation_depth' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` → 52 hits in 19 files (the lists of fields `set` takes).

- **`connectors`** as a field `set` takes (sibling: `limits.delegation_depth`). It must be named in:
  - `kernel/src/agents/roster.ts`: the route's field check and the `set` usage `(field: ${AGENT_SET_FIELDS.join(", ")}; ...)`. Extend: accept `CONNECTORS_FIELD` beside `AGENT_SET_FIELDS` and `WRIGHT_SET_FIELDS`, and name it in the usage and `wrightFieldReserved` text. The two arrays themselves: no change (they are the contract's scalar `AgentSetField`/`WrightSetField` mirrors).
  - `app/src/api/contract.ts` `AgentSetField` / `WrightSetField`: no change (the contract keeps `connectors` in `AgentConnectorsSetBody`). `AgentSetResponse.field`: extend to `AgentSetField | "connectors"`.
  - `docs/architecture/agents.md`, the `set` bullet ("changes one scalar field") and "Wright's settable fields": extend (name `connectors`).
  - `kernel/test/agents-wright-settings.test.ts` reserved message pin: extend (the message names `connectors`).
  - `app/src/screens/team/model.ts` `CREW_SET_FIELDS` / `WRIGHT_SET_FIELDS` / `FIELD_LABELS`: no change (the Set-a-field form stays scalar; the grant has its own row).
  - `app/src/screens/team/Inspector.tsx`, and `team.test.tsx`'s set-field option pins (`toEqual(["model", "effort", "permission_mode", ...`): no change (scalar form fields).
  - `kernel/src/agents/charter-tools.ts` `changesSchema` / `FILE_FIELDS`: no change on purpose (a session must never set `connectors`; AC5 pins the refusal).
  - `kernel/test/agents-wright-settings.test.ts`, `describe("connectors is not settable yet (phase 6 item 08)"`: invert (see the File Impact Map).
  - `kernel/test/agents-roster.test.ts` (`studio("agents", "set", "mason", "limits.delegation_depth", "2")`, its event list) and `kernel/test/agents-charter-tools.test.ts` (tool description, update display): no change (they exercise one limit, not the list of fields `set` takes).
  - `kernel/test/tools-sdk-list.test.ts`, `agents-delegation.test.ts`, `agents-foundation.test.ts`, `phase-4-exit.test.ts`, `delegate.ts`, `docs/architecture/delegation.md`, `budget.md`, `brain.md`, `OPEN_QUESTIONS.md`: no change (each names the limit itself, not the list of fields `set` takes).
- **`team.grant-github.<id>` / `team.revoke-github.<id>`** (sibling: `team.off.`): new ⌘K ids, registered for every agent, Wright included.
  - `app/src/screens/team/commands.ts` `teamCommands`: extend.
  - `app/src/screens/team/team.test.tsx` `expect(ids).toEqual([`: extend (the exact registered id list).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-connectors-grant.test.ts`, AC1: the session lists the stub GitHub tool after `set ... github` | delete `renameSync(temp, file);` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-connectors-grant.test.ts`, AC4: `gitlab` refused `invalid_input` | flip `"github"` → `"gitlab"` in the connectors value check in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-connectors-grant.test.ts`, AC5: `kernel_agent_update` with `connectors` refused | delete `  .strict()` (the `changesSchema` one) in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/agents-connectors-grant.test.ts`, AC7: a re-created role.md names GitHub | remove the `connectors` argument from `writeCharterFiles`'s `renderRoleMd(...)` call in `kernel/src/agents/charter-files.ts` |
| `app/src/screens/team/connectors.test.tsx`, AC9: Revoke posts `value: "none"` | flip `"none"` → `"github"` in `setAgentConnectors`'s revoke call in `app/src/screens/team/Connectors.tsx` |
| `app/src/screens/team/connectors.test.tsx`, AC9: commands re-register when connectors change | remove `connectors` from `rosterKey` in `app/src/screens/team/commands.ts` |
| `kernel/test/agents-connectors-grant.test.ts`, AC2: `none` removes the key; a second `none` is `changed: false` with no event | make `withValue`'s `connectors` branch write `[]` instead of deleting the key, in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-connectors-grant.test.ts`, AC3: Wright's connectors event carries `by: "owner"` | delete `...eventBy` from the `agent_settings_set` payload in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-connectors-grant.test.ts`, AC3: a grant succeeds while GitHub is not connected | add a refusal when no `connectors` row is `connected` to the connectors branch in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-connectors-grant.test.ts`, AC6: roster `connectors` is `["github"]` / `[]` / `null` | flip `?? []` → `?? null` in `memberEntry`'s `connectors` in `kernel/src/agents/roster.ts` |
| `app/src/screens/team/connectors.test.tsx`, AC8: `expiring` shows "expiring" | flip `"expiring"` → `"not connected"` in `connectorStateText` in `app/src/screens/team/model.ts` |
| `app/src/screens/team/connectors.test.tsx`, AC8: refetch on `connector_status` | delete the `connector_status` refetch condition in `app/src/screens/team/TeamView.tsx` |
| `kernel/test/agents-wright-settings.test.ts`, the inverted block: the scalar lists still exclude `connectors` | add `"connectors"` to `AGENT_SET_FIELDS` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`, `RESERVED_MESSAGE` now names `connectors` | delete the `connectors` mention from `wrightFieldReserved` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-roster.test.ts`, the roster-entry shape with `connectors` | delete the `connectors:` key from `wrightEntry` in `kernel/src/agents/roster.ts` |
| `app/src/screens/team/team.test.tsx`, `expect(ids).toEqual([` with the grant/revoke ids | delete the `team.revoke-github.` push in `app/src/screens/team/commands.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: the `connectors` grant on `set`, roster, role.md and docs | 1, 2, 3, 4, 5, 6, 7, 11, 12 (kernel + docs) | 5 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: Team inspector Connectors row, ⌘K, e2e and polish screenshots | 8, 9, 10, 12 (app) | 11 modify, 6 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

**Shared interface (fixed by this brief, so both run in parallel):** `POST /agents/:id/set` body `{field: "connectors", value: "github" | "none"}` → `200 {agent, field: "connectors", old: string[] | null, new: string[] | null, changed}` or `400 invalid_input {field: "connectors"}`. Every `GET /agents` entry carries `connectors: string[] | null`. Subtask 2 codes against this shape through `app/e2e/fixtures/team.ts` and unit-test bridges, never against subtask 1's code.

```yaml
# Subtask 1 — Kernel grant (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "CONNECTORS_FIELD"}
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "connectors must be github or none"}
  - {kind: "file", path: "kernel/test/agents-connectors-grant.test.ts"}
  - {kind: "symbol", path: "docs/architecture/agents.md", name: "connectors"}
requires: []
lanes:
  - "kernel/src/agents/roster.ts"
  - "kernel/src/agents/charter-files.ts"
  - "kernel/test/agents-connectors-grant.test.ts"
  - "kernel/test/agents-roster.test.ts"
  - "kernel/test/agents-wright-settings.test.ts"
  - "docs/architecture/agents.md"
external_requires: []

# Subtask 2 — App inspector row (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/screens/team/Connectors.tsx"}
  - {kind: "symbol", path: "app/src/screens/team/actions.ts", name: "setAgentConnectors"}
  - {kind: "symbol", path: "app/src/screens/team/actions.ts", name: "fetchConnectors"}
  - {kind: "symbol", path: "app/src/screens/team/commands.ts", name: "team.revoke-github."}
  - {kind: "file", path: "app/src/screens/team/connectors.test.tsx"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-connectors-connected-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-connectors-connected-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-connectors-not-connected-light.png"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/team/team-connectors-not-connected-dark.png"}
  - {kind: "symbol", path: "docs/evidence/phase-5-polish/team/README.md", name: "team-connectors-connected"}
requires: []
lanes:
  - "app/src/api/contract.ts"
  - "app/src/screens/team/Connectors.tsx"
  - "app/src/screens/team/Inspector.tsx"
  - "app/src/screens/team/actions.ts"
  - "app/src/screens/team/commands.ts"
  - "app/src/screens/team/model.ts"
  - "app/src/screens/team/TeamView.tsx"
  - "app/src/screens/team/team.css"
  - "app/src/screens/team/connectors.test.tsx"
  - "app/src/screens/team/team.test.tsx"
  - "app/e2e/team.spec.ts"
  - "app/e2e/fixtures/team.ts"
  - "docs/evidence/phase-5-polish/team/*"
external_requires:
  - "A macOS host that can run the Electron e2e (`cd app && npm run build && TEAM_EVIDENCE=1 npx playwright test e2e/team.spec.ts --workers=1`) to write the committed screenshots"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent; codes against the shared interface above)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/agents/settings.ts:66` | yes | HOLDS (moved to 73) | `connectors: z.array(z.enum(CONNECTOR_KINDS)).optional(),` | base f3f2ee5 |
| `docs/OPEN_QUESTIONS.md:112` | yes | UNCLEAR | phase 5 live exit evidence now exists (`docs/evidence/phase-5-exit-live-2026-10-25.json`) | base f3f2ee5 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Item 06's GitHub tools are not built (`githubToolsPart.tools` is empty), so "lists the GitHub tools" can't be shown with real tools (source: Feasibility (Phase 2.5)) | MEDIUM | Prove AC1–AC3 with a stub `requiresConnector: "github"` tool through the real `connectorsFor(dataDir)` → `SessionManager` `mcpServers` → `toolsForConnectors` path, as `integrations-foundation.test.ts` does. Item 06 then inherits the gating unchanged. |
| The two subtasks implement the shared interface differently | MEDIUM | The brief fixes the body, answer, `null`/`[]` semantics and roster key. Phase 4.5's integrated review checks the app fixture against the kernel route. |
| Prior churn (postmortem ledger): `docs/architecture/agents.md` (7), `settings.ts` (4), `team.spec.ts`, `TeamView.tsx`, `model.ts` (3 each); recurring class `self_heal_churn` (15), `drain_churn` (3) | MEDIUM | Keep docs precise to the code (names, codes, exact messages) and reread the Touched-file invariants before hand-back. Most past rounds were review findings on doc/code drift. |
| An existing `role.md` keeps its old "What the kernel enforces" text after a grant, so it disagrees with the JSON until it is re-created | LOW | Intentional: memory files are never overwritten (invariant 8; `writeIfAbsent`). The kernel enforces only the JSON (D34). Documented as an honest limit in `agents.md` (AC11). |
| Adding `connectors` to `RosterEntry` breaks exact-shape kernel test pins | LOW | Subtask 1 updates only the expected values (Touched-file invariants). The app-side field is optional, so the chat and sessions fixtures stay untouched. |
| Screenshots need a local Electron run, and CI never writes them | LOW | Run with `TEAM_EVIDENCE=1` on macOS and commit the four PNGs plus the README entry (AC10). |
| Sequencing: phase 6 was to run after phase 5's live exit (Cited-line premise UNCLEAR) | LOW | Live exit evidence for 2026-10-25 exists. No code dependency. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-28-owner-grants-agent-github-access.md
```


## Outcome
- **Status:** completed
- **Completed:** 2026-10-28T10:06:12Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/149
- **Branch:** feature/owner-grants-agent-github-access
- **Files changed:** 23
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel connectors grant on set (crew + Wright), roster connectors, role.md line, agents.md docs; Team inspector Connectors row with Grant/Revoke and ⌘K; e2e + 4 polish screenshots. Phase 4.5: iteration 1 PASS with 2 MEDIUM doc-precision findings (fixed in 929ef54 with a new model-less-Wright test), iteration 2 PASS clean. Pin mutations 1–16 held per reviewer repros (script itself reported all unverified). Drain not dispatched (.auto_review false; /automate owns the drain). CI read: required=green. rules_check: none; rules_audit: clean; house_rules: followed 1.
