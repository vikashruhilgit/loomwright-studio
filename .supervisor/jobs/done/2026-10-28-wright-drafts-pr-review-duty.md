# Supervisor Job: Wright drafts a PR-review duty from one sentence — poll trigger and mode on kernel_playbook_create, a proposable connectors grant on charters, and guidance that calls every value a proposal

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-28-121118/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095110-wright-drafts-a-pr-review-duty-from-one-sentence.md
- **Base commit:** 165cdb6b254f79ab47fb868d27f2a9471d28a576

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + zod + vitest in `kernel/`; no new dependency |
| 2 | Dependency Availability | GO | Items 01, 04, 05, 07, 08 are merged on `main` (#142, #146, #145, #150, #149): `TRIGGER_KINDS` includes `poll`, `checkPollSpec` refuses `poll_interval_below_floor` / `poll_repo_not_reachable`, `DEDUPE_KEY_FIELDS` has `item.id`/`item.revision`, `PLAYBOOK_MODES` + `live_mode_not_in_phase_6` exist, `connectors` is a settings-file key |
| 3 | Architecture Fit | GO | Mechanism stays in the kernel; Wright only proposes (D3, D4, invariant 1); the grant reaches `config/agents/<id>.json` only through the existing held create (D34) |
| 4 | Scope vs Supervisor Capability | CAUTION | 14 files (11 modify + 3 create, docs included) — over the 12-file `context-bound` bound, so the brief splits into 3 subtasks |
| 5 | Hard Blockers | GO | None; no migration needed (`playbooks.mode` is migration 17, `connectors` is a settings-file key) |

**Overall Verdict:** CAUTION

## Task
**Goal:** Let Wright turn one sentence ("review every open PR on studio-sandbox when it changes, draft only") into a drafted poll playbook — and, when no crew member fits, a drafted comment-only reviewer charter with the GitHub grant proposed — where every value is a proposal the owner sees and can change.

**Problem Statement:**
The owner needs Wright to build a PR-review duty from one sentence, because phase 6's acceptance test 1 ("PR-review duty built from one sentence") is the phase's exit.
Currently, `kernel_playbook_create` (`kernel/src/playbooks/drafts.ts`) already takes `mode` and the `item.id`/`item.revision` dedupe fields, but its `trigger` is `{kind, spec: string ≤ 200 chars, tz?}`: a poll can only be passed as hand-serialised JSON text that a multi-repo spec overflows, and `tools/list` publishes nothing of the `PollSpec` shape. The playbook mirror (`kernel/src/playbooks/mirror.ts`) has no `Mode` line and prints a poll schedule as raw JSON. A charter (`kernel/src/agents/charter-files.ts`) refuses a `connectors` key outright (`docs/architecture/agents.md`: "a charter cannot carry it"), so Wright cannot propose the GitHub grant. Wright's `role.md` template (`kernel/src/brain/templates.ts`) says nothing about polls, connectors or draft mode.
Success looks like: a stand-in Wright's `kernel_playbook_create` with a structured poll, a per-item key and `mode: draft` stores a draft whose every value is `set_by = wright` and shown `(proposed)`; a charter proposing `connectors: ["github"]` writes the grant only when the owner approves the held create; and the template guidance is pinned to name every value a proposal, with no fixed repo, interval or key — and nothing preinstalled.

## Acceptance Criteria

Carried forward from the requirement (AC1–AC7), plus refinements (AC8–AC10) the analysis found necessary to meet them.

- [ ] **AC1** — Given a GitHub connector row whose `reachable_repos_json` includes `vikashruhilgit/studio-sandbox`, when a stand-in Wright session calls `kernel_playbook_create` with `trigger: {kind: "poll", poll: {source: "github.pulls", repos: ["vikashruhilgit/studio-sandbox"], filters: {state: "open"}, interval_seconds: 300}}`, `dedupe_key: ["playbook.id","item.id","item.revision"]` and `mode: "draft"`, then a `draft` version-1 playbook and its linked `poll` trigger (spec = that `PollSpec`) are stored, `dedupe_key_set_by` and `mode_set_by` are `wright`, and `memory/playbooks/<slug>.md` shows the dedupe key and `- Mode: \`draft\` (proposed)` as proposed and the poll schedule (source, each repo, every filter, the interval) as proposed.
- [ ] **AC2** — Given the same call with `interval_seconds: 30`, then it is refused with a message containing `poll_interval_below_floor`; given a repo the connector does not reach, then it is refused with a message containing `poll_repo_not_reachable`; given an unknown filter key (e.g. `label`), then it is refused with `poll_filter_unknown` (item 04's reasons, never a zod shape error); in each case no playbook row and no trigger row is written.
- [ ] **AC3** — Given `mode: "live"`, then `kernel_playbook_create` is refused with `live_mode_not_in_phase_6` and nothing is written.
- [ ] **AC4** — Given a stand-in Wright's `kernel_agent_create` whose charter carries `connectors: ["github"]`, when the owner approves the held call `once`, then `config/agents/<id>.json` holds `"connectors": ["github"]` and `memory/<id>/role.md` names GitHub under "What the kernel enforces"; when the owner denies it, then no `agents` row, no settings file and no memory file is written.
- [ ] **AC5** — Given a playbook Wright drafted, when the owner sets `dedupe_key` or `mode` (`setPlaybookPolicy` / `POST /playbooks/:id/set`), then a subsequent `kernel_playbook_update` from Wright changing that field is refused with a message naming the field and saying the owner set it, and the stored value is unchanged.
- [ ] **AC6** — Given `ROLE_TEMPLATE` in `kernel/src/brain/templates.ts`, then `kernel/test/brain.test.ts` pins that its duty-drafting guidance section calls every value it describes (repos, filters, interval, dedupe key, mode, crew member, connectors grant) a proposal the owner can change, contains no `owner/name` repo, no digit (no interval), no dedupe-key field list, and never calls a value a "default" except to forbid doing so.
- [ ] **AC7** — Given the shipped kernel, then a test (a) starts a fresh store/kernel and finds zero `playbooks` rows, zero `agents` rows and no `config/agents/*.json` other than Wright's own, and (b) greps `kernel/src/**/*.ts` and finds `createPlaybook(` / `createAgent(` called only from the tool, route and approval-apply sites that run on a request (an explicit allowlist), and finds no charter or playbook literal (e.g. a `"github.pulls"` poll or a `never` list) in `kernel/src/brain/templates.ts`.
- [ ] **AC8** — Given a held `kernel_agent_create` whose charter proposes `connectors: ["github"]`, then the approval display's enforced line ends `; connectors: github` (the owner sees the grant before approving); given a charter with no `connectors`, then the display, `renderAgentSettingsJson` and `renderRoleMd` output are byte-identical to today's (existing pins in `agents-charter-tools.test.ts`, `phase-4-exit.test.ts` and `docs/architecture/agents.md` stay green unchanged).
- [ ] **AC9** — Given the shipped tools listed through the SDK's own `tools/list` (`kernel/test/tools-sdk-list.test.ts`), then `kernel_playbook_create` / `kernel_playbook_update` publish `trigger.poll.source` as an `enum` of `POLL_SOURCES` and `trigger.poll.interval_seconds` as a positive integer, `kernel_agent_create` publishes `charter.connectors[]` as an `enum` of `CONNECTOR_KINDS`, and the listing still succeeds (#95).
- [ ] **AC10** — Given `kernel_agent_update` with `changes: {connectors: ["github"]}`, then it is still refused (the grant is never changed by an update; `agents-connectors-grant.test.ts` stays green unchanged).

**Validation (must pass before merge):** `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh`.

## Touched-file invariants

> Grounded at base `165cdb6b254f79ab47fb868d27f2a9471d28a576`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/drafts.ts`** — keep: closed sets come from the store's own lists, never a copy (`// The closed sets are the store's own (never a copied list)`), so the poll object's `source` uses the triggers index's `POLL_SOURCES` and its filter keys are NOT closed in zod (an unknown filter must reach `parsePollSpec` to be refused `poll_filter_unknown`, so the filters object is loose/passthrough, never strict and never stripping); keep the interval as a positive integer only in zod — the 60 s floor stays `parsePollSpec`'s (`poll_interval_below_floor: interval_seconds`), so AC2's reason comes from item 04; keep the crew/owner checks before the work step (`const agent = draftOwner(ctx.store, refuseCrewDrafting(ctx), a.agent);`) and the step key (`ctx.stepKey(a.idempotency_key)`); keep the module's import rule (`the triggers feature's public index and this feature's files`) — import `POLL_SOURCES` from `../triggers/index.js`, which already re-exports it (`export { MAX_POLL_ITEMS, POLL_FILTER_KEYS, POLL_SOURCES, firePollTriggers } from "./poll.js";`). mirror: the store's `checkTriggerInput` takes `spec` as a string only (`typeof t.spec !== "string"` in `kernel/src/playbooks/store.ts`), so the handler serialises a `poll` object to JSON text before `createPlaybook` / `updatePlaybook`; a `poll` with `spec` also given, or a `poll` on a `once`/`cron` kind, is refused `invalid_input` naming `trigger`; `{kind: "poll", spec: "<JSON text>"}` keeps working (documented in `docs/architecture/playbooks.md`: `with the \`PollSpec\` as JSON text and no \`tz\``). reuse: `named("kernel_playbook_create"` refusal prefixing and `afterStep`. pinned by: `kernel/test/playbooks-drafts.test.ts`, `kernel/test/tools-sdk-list.test.ts` (`kernel_playbook_create: playbookSets("")`).
- **`kernel/src/playbooks/mirror.ts`** — keep: the inert rendering (`policyLine` renders every value through `inline`, and the sentence `A value marked (proposed) was proposed by an agent; the owner can change any value.`); keep once/cron schedule lines byte-identical (`if (trigger.kind === "cron" && typeof spec.cron === "string"`) — the new poll rendering is a new branch before the raw-JSON fallback, and only a `poll` schedule line gains ` (proposed)` (its repos, filters and interval are values only an agent drafts in phase 6 — no owner path sets a playbook's trigger — while once/cron lines keep their pinned bytes). reuse: `policyLine(label, value, setBy)` for the new `Mode` line (after `Token limit per day`, before `Effort`). pinned by: `kernel/test/playbooks-drafts.test.ts` full-mirror expectation (`"- Schedule: cron \`0 9 * * 1-5\` in \`Asia/Kolkata\` (trigger 1)"`), which gains the Mode line.
- **`kernel/src/agents/charter-files.ts`** — keep: the charter schema stays strict (`// Strict: a misspelt limit is refused, never silently unenforced.`) — `connectors` is added as an optional top-level key `z.array(z.enum(CONNECTOR_KINDS))` with no repeats, so a misspelt key is still refused; keep `CHARTER_JSON_SCHEMA` derived from the one schema (`const { $schema: _document, ...schema } = z.toJSONSchema(charterSchema);`); keep `renderAgentSettingsJson` byte-identical when `connectors` is absent or empty (written only when non-empty, after `workspaces`, matching the settings reader's `connectors: z.array(z.enum(CONNECTOR_KINDS)).optional(),` in `kernel/src/agents/settings.ts`); keep `writeCharterFiles` reading the grant from the written settings file (`const settings = readAgentSettings(dataDir, charter.id`), so `role.md` names it without a second source. pinned by: `kernel/test/agents-roster.test.ts` and `docs/architecture/agents.md` (the mason example, `\`effort\` and \`limits\` are written only when the charter sets them`).
- **`kernel/src/agents/charter-tools.ts`** — keep: the enforced line byte-identical with no grant (`return \`enforced: never: ${listText(never)}; tools: ${listText(allowedTools)}; bash prefixes: ${listText(prefixes, true)}\`;`), appending `; connectors: <list>` only when the charter proposes one; keep the head-fit refusal over the head that now includes it (`displayFitRefusal("the display's enforced, limits and workspaces lines", createHead(checked.charter))`); keep `createDisplay` passing the proposed grant to `renderRoleMd` so the shown `role.md` matches what the kernel writes; keep `kernel_agent_update`'s `changesSchema` strict with no `connectors` key. pinned by: `kernel/test/agents-charter-tools.test.ts`, `kernel/test/phase-4-exit.test.ts` (`enforced: never:`), `kernel/test/agents-connectors-grant.test.ts` (`Wright's kernel_agent_update with changes {connectors: [github]} is refused`).
- **`kernel/src/brain/templates.ts`** — keep: no imports (`No imports: the \`studio\` CLI loads this module.`); keep the CLI out of the template (`expect(ROLE_TEMPLATE).not.toContain("studio playbooks");` in `kernel/test/brain.test.ts`); keep the tools lists unchanged (`\n- playbooks: ${PLAYBOOK_TOOL_NAMES.join(", ")}\n`). mirror: `docs/architecture/brain.md` shows `ROLE_TEMPLATE` verbatim and `brain.test.ts` pins it (`expect(\`${block.slice(open + 1, close).join("\n")}\n\`).toBe(ROLE_TEMPLATE);`), so the doc block changes in the same subtask.
- **`kernel/test/playbooks-drafts.test.ts`** — keep: every expectation unchanged except the literal full-mirror array (the block holding `"- Token limit per day: \`1000\` (proposed)",`), which gains only the `- Mode: \`draft\`` line between `Token limit per day` and `Effort` (no `(proposed)` there: those drafts give no `mode`, so `mode_set_by` stays null); the CLI `show` and `set` expectations (`"  model: claude-sonnet-4-5 (proposed)",`, `live_mode_not_in_phase_6: mode live is not available in phase 6`) stay byte-identical. The `toContain` line list holding `"- Token limit per day: \`50000\` (proposed)",` and the `expectedMirror(...)` comparisons need no edit: they still pass. New poll tests go to the CREATE file, never here.
- **`kernel/test/brain.test.ts`** — keep: the template↔doc pin (`expect(\`${block.slice(open + 1, close).join("\n")}\n\`).toBe(ROLE_TEMPLATE);`), the CLI-absence pins (`expect(ROLE_TEMPLATE).not.toContain("studio playbooks");`) and the tool-list pins (`expect(ROLE_TEMPLATE).toContain(\`\n- playbooks: ${PLAYBOOK_TOOL_NAMES.join(", ")}\n\`);`) unchanged; append-only: the AC6 pins go in a new `it(...)` reading the `## Drafting a duty` section the way the existing `## Where the owner acts` pin slices its section (`const start = ROLE_TEMPLATE.indexOf("## Where the owner acts");`).
- **`kernel/test/tools-sdk-list.test.ts`** — keep: the non-vacuity list unchanged (`["kernel_agent_create", "kernel_agent_update", "kernel_github_pr_diff", "kernel_playbook_create", "kernel_playbook_update", "kernel_trigger_register"]`); add the new sets through the existing helpers (`function playbookSets(prefix: string)` for `trigger.poll.source` / `trigger.poll.interval_seconds`; `kernel_agent_create` only for `charter.connectors[]`, since `charterSets` also serves `kernel_agent_update`, which has no `connectors`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/tools-sdk-list.test.ts` — `trigger.poll.source` enum | flip `z.enum(POLL_SOURCES)` → `z.string()` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/tools-sdk-list.test.ts` — `charter.connectors[]` enum | flip `z.array(z.enum(CONNECTOR_KINDS))` → `z.array(z.string())` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC1 mirror `- Mode: \`draft\` (proposed)` | delete `policyLine("Mode"` in `kernel/src/playbooks/mirror.ts` |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC1 stored poll trigger | in `kernel/src/playbooks/drafts.ts`, drop the line that serialises `poll` into the trigger's `spec` (the create then fails `trigger must be …`) |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC2 unknown filter refused `poll_filter_unknown` | in `kernel/src/playbooks/drafts.ts`, make the poll filters object strict (zod refuses first, so the reason is not item 04's) |
| `kernel/test/agents-charter-connectors.test.ts` — AC4 settings file holds the grant | in `kernel/src/agents/charter-files.ts`, delete the line in `renderAgentSettingsJson` that adds `connectors` to `settings` |
| `kernel/test/agents-charter-connectors.test.ts` — AC8 display shows `; connectors: github` | in `kernel/src/agents/charter-tools.ts`, delete the `connectors` append in `enforcedLine` |
| `kernel/test/brain.test.ts` — AC6 no interval in the guidance | in `kernel/src/brain/templates.ts`, add `every 300 seconds` to the `## Drafting a duty` section |
| `kernel/test/brain.test.ts` — AC6 every value a proposal | in `kernel/src/brain/templates.ts`, delete the `## Drafting a duty` section's proposal sentence |
| `kernel/test/no-preset.test.ts` — AC7 (b) call-site allowlist | add a `createPlaybook(` call to `kernel/src/daemon.ts` |
| `kernel/test/tools-sdk-list.test.ts` — `trigger.poll.interval_seconds` positive integer | in `kernel/src/playbooks/drafts.ts`, flip the poll shape's `interval_seconds: z.number().int().positive()` to `interval_seconds: z.number()` |
| `kernel/test/brain.test.ts` — AC6 no `owner/name` repo | in `kernel/src/brain/templates.ts`, add `vikashruhilgit/studio-sandbox` to the `## Drafting a duty` section |
| `kernel/test/brain.test.ts` — AC6 no dedupe-key field list | in `kernel/src/brain/templates.ts`, add `item.revision` to the `## Drafting a duty` section |
| `kernel/test/brain.test.ts` — AC6 "default" only to forbid | in `kernel/src/brain/templates.ts`, add `draft mode by default` to the `## Drafting a duty` section |
| `kernel/test/no-preset.test.ts` — AC7 (a) zero rows on a fresh store | in `kernel/src/kernel.ts`, insert one `playbooks` row during `startKernel` |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC1 readable poll schedule line ending ` (proposed)` | in `kernel/src/playbooks/mirror.ts`, delete the new poll branch of `schedule()` (a poll falls back to the raw-JSON line) |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC2 interval 30 refused `poll_interval_below_floor` | in `kernel/src/playbooks/drafts.ts`, add `.min(60)` to the poll shape's `interval_seconds` (the refusal becomes a zod shape error) |
| `kernel/test/playbooks-drafts-poll.test.ts` — AC2 unreachable repo refused `poll_repo_not_reachable` | in `kernel/src/playbooks/drafts.ts`, pass the poll to the store as `{kind: "cron"}` (the refusal's reason is no longer the connector check) |
| `kernel/test/agents-charter-connectors.test.ts` — AC4 `role.md` names GitHub | in `kernel/src/agents/charter-files.ts`, stop passing the settings file's `connectors` to `renderRoleMd` in `writeCharterFiles` |
| `kernel/test/no-preset.test.ts` — AC7 (b) no playbook/charter literal in templates | in `kernel/src/brain/templates.ts`, add `"github.pulls"` to the `## Drafting a duty` section |
| `kernel/test/agents-charter-connectors.test.ts` — AC4 deny writes nothing | in `kernel/src/agents/charter-tools.ts`, have the deny path call `createAgent` (the test sees a row and a settings file) |

AC3 (`live_mode_not_in_phase_6`), AC5 (owner-locked field refused) and AC10 (`kernel_agent_update` refuses `connectors`) re-check behaviour that already exists on `main` and is already pinned (`kernel/test/playbooks-drafts.test.ts`, `kernel/test/agents-connectors-grant.test.ts`). They add no new pin to mutate.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | kernel_playbook_create takes a structured poll; the mirror shows mode and the poll as proposed | AC1, AC2, AC3, AC5 | 4 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | A charter can propose the GitHub grant; the held display shows it; tools/list publishes the new closed sets | AC4, AC8, AC9, AC10 | 4 modify, 1 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |
| 3 | Wright's guidance drafts a duty as proposals; nothing is preinstalled | AC6, AC7 | 3 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask notes

- **Subtask 1.** In `drafts.ts`: add `pollTriggerShape` (the `PollSpec` as an object: `source` enum `POLL_SOURCES`, `repos` a non-empty string array, `filters` an optional loose object, `interval_seconds` a positive integer) as an optional `poll` key of `triggerShape`, with `spec` optional; the handler builds the store's `{kind, spec}` (JSON text for a poll) for create and update. Update the create/update tool descriptions: name the poll form, say every poll value is a proposal, and keep `REPEAT`/`LIMITS`. In `mirror.ts`: the `Mode` policy line, and a readable poll schedule ending ` (proposed)`. In `playbooks-drafts.test.ts`: only the full-mirror expectations gain the `Mode` line. New `kernel/test/playbooks-drafts-poll.test.ts` holds AC1–AC3 and AC5 (with a `connectors` row seeded as `connected` with `reachable_repos_json`, as `kernel/test/` poll tests already do). `docs/architecture/playbooks.md`: the trigger bullet (structured `poll`), the mirror's field list (item 6 gains Mode) and the poll schedule line, plus one honest-limit sentence: the poll's repos, filters and interval are Wright's proposals, which the owner changes by asking Wright (a `kernel_playbook_update` makes a new version for review) or by turning the playbook off. No owner control sets a trigger directly, so the poll schedule line always reads `(proposed)`.
- **Subtask 2.** In `charter-files.ts`: the optional `connectors` key (schema, `Charter` type, settings render). In `charter-tools.ts`: the enforced line, `createDisplay`'s `role.md`, and the create description (the grant is a proposal, applied only on the owner's approval). New `kernel/test/agents-charter-connectors.test.ts` holds AC4, AC8 and AC10's non-regression. `tools-sdk-list.test.ts` gains the two poll sets (via `playbookSets`) and `charter.connectors[]` on `kernel_agent_create`. `docs/architecture/agents.md`: replace "a charter cannot carry it" / "`connectors` is never written from a charter" with the held-create path (proposed by Wright, written only on the owner's approval; `update` still refuses it).
- **Subtask 3.** In `templates.ts`: a new `## Drafting a duty` section in `ROLE_TEMPLATE` (after `## Your crew`) saying, in plain words with no CLI and no concrete values: for a request to watch something (such as pull requests), propose a poll on the repos the owner named, with filters, an interval and a per-item dedupe key, and draft mode, naming each as a proposal the owner can change; prefer an existing crew member whose charter fits (`kernel_agent_list`); otherwise draft a comment-only reviewer charter (its never list covering pushes and every GitHub write it does not need; the kernel always blocks merges) with the GitHub grant proposed, together with the playbook, and show both; never pick a value silently and never call one a default. It also says how the owner changes each value: the policy values (dedupe key, mode and the rest) in the playbook card's Set, and the poll's repos, filters and interval by asking Wright to change them or by turning the playbook off. It must not imply a direct control for the trigger. Update `docs/architecture/brain.md`'s verbatim block and add one honest-limit line there: the template reaches a fresh data dir only (`role.md` is the owner's after first run), so the tool descriptions (subtasks 1 and 2) carry the proposal rules for an existing install. New `kernel/test/no-preset.test.ts` holds AC7. `brain.test.ts` gains the AC6 pins (append: the AC names this file and the template↔doc pin lives here).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "pollTriggerShape"}
  - {kind: "symbol", path: "kernel/src/playbooks/mirror.ts", name: "Mode"}
  - {kind: "file", path: "kernel/test/playbooks-drafts-poll.test.ts"}
requires: []
lanes:
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/playbooks/mirror.ts"
  - "kernel/test/playbooks-drafts.test.ts"
  - "kernel/test/playbooks-drafts-poll.test.ts"
  - "docs/architecture/playbooks.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "CONNECTOR_KINDS"}
  - {kind: "symbol", path: "kernel/src/agents/charter-tools.ts", name: "connectors"}
  - {kind: "file", path: "kernel/test/agents-charter-connectors.test.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "pollTriggerShape"}
lanes:
  - "kernel/src/agents/charter-files.ts"
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/test/agents-charter-connectors.test.ts"
  - "kernel/test/tools-sdk-list.test.ts"
  - "docs/architecture/agents.md"
external_requires: []

# Subtask 3
provides:
  - {kind: "symbol", path: "kernel/src/brain/templates.ts", name: "## Drafting a duty"}
  - {kind: "symbol", path: "docs/architecture/brain.md", name: "## Drafting a duty"}
  - {kind: "file", path: "kernel/test/no-preset.test.ts"}
requires: []
lanes:
  - "kernel/src/brain/templates.ts"
  - "kernel/test/brain.test.ts"
  - "kernel/test/no-preset.test.ts"
  - "docs/architecture/brain.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2   (tools-sdk-list.test.ts classifies subtask 1's trigger.poll sets)
Subtask 3 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none in lanes; subtask 2's `tools-sdk-list.test.ts` pins subtask 1's `trigger.poll` shape | YES (requires) |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 3 (parallel)
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 2
- **Estimated batches:** 2

### Module layout

| Path | Lines at base | Home for the new responsibility |
|------|---------------|----------------------------------|
| `kernel/src/playbooks/drafts.ts` | 734 | append `pollTriggerShape` (~20 lines) — the tool's input shape is defined beside the tool (`const triggerShape = z.object({`), its single authority |
| `kernel/src/playbooks/mirror.ts` | 200 | append (under threshold) |
| `kernel/src/agents/charter-files.ts` | 551 | append the `connectors` key (~5 lines) — `charterSchema` is the single authority for the charter and its JSON Schema |
| `kernel/src/agents/charter-tools.ts` | 854 | append (~5 lines) — `enforcedLine`/`createDisplay` are the single authority for the held display |
| `kernel/src/brain/templates.ts` | 95 | append (under threshold) |
| `kernel/test/playbooks-drafts.test.ts` | 897 | expectation edits only (the Mode line in existing full-mirror pins); new tests go to CREATE `kernel/test/playbooks-drafts-poll.test.ts` |
| `kernel/test/agents-charter-tools.test.ts` | 896 | not modified; new tests go to CREATE `kernel/test/agents-charter-connectors.test.ts` |
| `kernel/test/brain.test.ts` | 1238 | append (~30 lines) — AC6 names this file, and the `ROLE_TEMPLATE` ↔ doc pin it extends lives here |
| `kernel/test/tools-sdk-list.test.ts` | 368 | append to `CLOSED_VALUE_SETS` / `playbookSets` (under threshold) |
| AC7 no-preset check | — | CREATE `kernel/test/no-preset.test.ts` (a separate concern) |
| `docs/architecture/playbooks.md` | 127 | edit in place |
| `docs/architecture/agents.md` | 313 | edit in place |
| `docs/architecture/brain.md` | 222 | edit in place |

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/playbooks/drafts.ts:149` | yes | STALE | `mode: z.enum(PLAYBOOK_MODES).optional(),` (line 155) and `dedupe_key: z.array(z.enum(DEDUPE_KEY_FIELDS))` (line 151): the tool already takes `mode` and the item fields; what is missing is a structured poll | tip 2 hours ago, fetched <1h |
| `docs/OPEN_QUESTIONS.md:112` | yes | STALE | `- [x] **Phase 5 exit: live run (item 18, owner).** … **Passed 2026-10-25**`: the phase 5 live exit the requirement says is owed has passed | tip 2 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope over one worker's context (14 files) — Feasibility (Phase 2.5) | MEDIUM | Split into 3 subtasks (`context-bound`); subtask 2 serialised after 1 on `tools-sdk-list.test.ts` |
| Guidance or tool text that reads as a default (D4) | HIGH | AC6 pins: every value named a proposal, no repo/interval/key literal, "default" only in "never call it a default"; reviewer reads the section against D4 |
| `ROLE_TEMPLATE` reaches only a fresh data dir; an existing owner's `role.md` keeps its old text, so a live Wright may not see the new guidance | MEDIUM | The proposal rules also live in the `kernel_playbook_create` / `kernel_agent_create` descriptions every session receives; `docs/architecture/brain.md` records the honest limit; item 13's live exit observes a real Wright |
| A zod shape the SDK's bundled serialiser rejects (a loose object, an optional `spec`) empties every session's `tools/list` (#95) | HIGH | `tools-sdk-list.test.ts` lists through the SDK's own server; `startKernel`'s `assertKernelToolsList` refuses a start that would not list; fall back to a strict filters object with `POLL_FILTER_KEYS` only if the loose one fails to list, keeping AC2's reason by checking unknown keys in the handler before zod strips them |
| A zod-level check pre-empts item 04's refusals (min 60 on the interval, strict filters) and AC2's reasons become shape errors | MEDIUM | Touched-file invariant on `drafts.ts`; AC2 asserts the reason tokens; pin mutation row 5 |
| Docs say a charter can never carry `connectors` (`docs/architecture/agents.md`), now false | MEDIUM | Subtask 2 rewrites both sentences; `kernel_agent_update` keeps refusing it (AC10) |
| Once a charter carries `connectors`, `charter_json` holds the grant. `ensureAgentFiles` re-creates a missing settings file from `charter_json`, so a grant the owner revoked (`connectors none`) comes back if the settings file is later deleted | LOW | Subtask 2 records this in `docs/architecture/agents.md`'s honest limits. The same already holds for `model` and `limits` |
| Lane L1 (item 09, dry run) runs in parallel | LOW | Its Touches (`kernel/src/playbooks/dry-run.ts`, `kernel/src/sessions/dry-run.ts`, `docs/architecture/dry-run.md`, a new test) do not overlap this brief's lanes; `drafts.ts` imports `mirrorDryRunOf` from `dry-run.ts`, so rebase onto `main` before merge if 09 lands first |
| Requirement premise at `kernel/src/playbooks/drafts.ts:149` is stale ("no mode and no item fields") — Cited-line premise (Phase 3) | MEDIUM | The brief plans only the real gap (a structured poll, the mirror's Mode and poll lines); mode and item fields are tested, not rebuilt |
| Requirement premise at `docs/OPEN_QUESTIONS.md:112` is stale (phase 5 exit now passed 2026-10-25) — Cited-line premise (Phase 3) | MEDIUM | No action: the sequencing precondition is met |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-28-wright-drafts-pr-review-duty.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-28T13:59:59Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/154
- **Branch:** feature/wright-drafts-pr-review-duty
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** 3 subtasks (structured poll on kernel_playbook_create + mirror Mode/poll lines; charter connectors grant via the held create; Wright's Drafting a duty guidance + no-preset test) merged; Phase 4.5 fix iteration 1 fixed 2 MEDIUM (guidance named the card's Set for mode; untested spec-required branch), re-review PASS; 4 LOW + 1 nit dismissed below floor. Reviewer hand-applied all 21 brief pin mutations (all held). Typecheck, 2385 tests, check-docs green.

## Not verified
- **tools/list schema for trigger.poll.source/interval_seconds** — pins belong to subtask 2 (subtask 1)
- **no-preset fresh-store mutation row 8** — failure message not read (subtask 3)
