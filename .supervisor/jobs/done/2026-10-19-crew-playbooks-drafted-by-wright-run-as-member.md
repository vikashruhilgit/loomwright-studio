# Supervisor Job: Wright drafts playbooks a crew member owns, and their dry runs and fires run as that member

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-19-001356/L3 (lane clone of loomwright-studio)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041108-wright-drafts-playbooks-a-crew-member-runs.md
- **Base commit:** f387cec5402a6ed6575c7ee5694da93d3d8563bf

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`; every change is inside the playbooks feature's sub-files. |
| 2 | Dependency Availability | GO | Items 01–04 are merged: `isRoutable` / `getAgent` (`kernel/src/agents/registry.ts`), `readAgentSettings` (`kernel/src/agents/settings.ts`), `agentMemoryDir` / `ensureAgentMemoryFiles` (`kernel/src/agents/memory.ts`), `createAgent` (`kernel/src/agents/charter-files.ts`), the never boundary (`boundaryDecision`, read before the dry-run branch in `SessionManager.#gate`), per-agent admission limits (item 04). |
| 3 | Architecture Fit | GO | Ownership already lives in the playbook row (`owning_agent`); the trigger fire already queues `{agent: playbook.owning_agent, …}` (`kernel/src/triggers/store.ts`); the brain hands any message carrying `playbook` to `handlePlaybookMessage` BEFORE its `BRAIN_AGENTS` check, so crew fires reach `runs.ts` without touching the brain. |
| 4 | Scope vs Supervisor Capability | GO | ~11 files, one coherent module group (single agent). |
| 5 | Hard Blockers | CAUTION | Item 05 (crew message routing and the crew context builder in `kernel/src/brain/context.ts`) runs in a parallel lane and is NOT on `main`. `buildContext` reads only Wright's memory files, so a crew fire's prompt must NOT use it (it would hand Wright's memory to the member). This item builds the crew prompt inside `runs.ts` without editing `kernel/src/brain/*` (see Design note 6); shared notes and the Loomwright summary in a crew playbook prompt are an honest limit until item 05's builder lands. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Let Wright draft, update, list, disable, dry-run and request enabling of a playbook owned by a registered crew member, refuse every playbook-drafting tool to crew sessions (`crew_cannot_draft`), and run that playbook's dry run and every fire / run-now as the owning member (its settings, policy with `never`, cwd `memory/<id>`, session-row `agent`, admission limits), refusing an `off` owner (`agent_off`).

**Problem Statement:**
The owner needs a crew member's scheduled duty to run bounded by that member's own policy, `never` list and limits because Wright's are wider.
Currently playbooks are Wright's alone: `owningAgent(ctx)` is the calling session's agent (`kernel/src/playbooks/drafts.ts`), a dry run uses Wright's settings and `memory/wright` (`dry-run.ts`), enable's `draftOf` refuses `not_owner` for any playbook not owned by the requesting agent (`enable.ts`), and a fire for any agent not in `BRAIN_AGENTS` fails `agent_not_routed` (`runs.ts`) and otherwise uses Wright's settings and memory dir.
Success looks like: Wright drafts a playbook for `mason`; its dry run and fires run as `mason` (a push is denied `agent_boundary`, never held); an `off` mason refuses; and every Wright playbook behaves byte-identically to today.

## Acceptance Criteria
- [ ] AC1 — Given a stand-in Wright session and an `active` crew member `mason` created with `createAgent`, when it calls `kernel_playbook_create({…, agent: "mason"})`, then the row's `owning_agent` is `mason`, the linked trigger's `owning_agent` is `mason`, and the mirror contains the line `- Agent: \`mason\``. Given `agent: "ghost"` (unregistered) the tool error's text starts `kernel_playbook_create: agent:`; given `agent: "mason"` while mason is `off` it starts `kernel_playbook_create: agent_off:`; in both cases no playbook row, version, trigger, event, work step or mirror file is written.
- [ ] AC2 — Given that draft (with a model), when Wright calls `kernel_playbook_dry_run`, then the dry-run session is started with `agent: "mason"`, `cwd` = `agentMemoryDir(dataDir, "mason")`, `permissionMode` and `policy.allowedTools` / `allowedBashPrefixes` from mason's settings, `policy.never` equal to mason's `never`, `dryRun: true` and the playbook's model; the session row's `agent` is `mason`. With the real session manager's gate, a `git push` call in that session is denied `agent_boundary` (mason's `never` includes `git_push`) or `dry_run`, and no approval row is written.
- [ ] AC3 — Given mason is `off`, when Wright dry-runs the crew draft, then the tool error's text starts `kernel_playbook_dry_run: agent_off:` and no session starts. Given mason's settings file is invalid JSON, then the tool error's text names mason's file (`config/agents/mason.json`) and no session starts.
- [ ] AC4 — Given a done dry run of the crew draft, when Wright calls `kernel_playbook_enable` and the owner approves it `once`, then the kernel enables it (`playbook_enabled` appended, row `enabled`), with no `not_owner` refusal at the hold (`beforeHold`) or at the apply (`applyOnApproval` / `enableApproved`).
- [ ] AC5 — Given the enabled crew playbook fires (or is run now), then `startSession` is called with `agent: "mason"`, mason's permission mode and policy (its `never` included), `cwd` `memory/mason`, the snapshot's model, `playbook` and `playbookVersion`; the prompt contains the playbook heading and intent and contains NONE of Wright's memory file contents (a sentinel string written into `memory/wright/*.md` is absent). Given mason is `off` at fire time, then the run row is `failed` with `result_json` `{"error":"agent_off"}`, exactly one notification is recorded for it (a redelivery of the same event records none more), and no session starts.
- [ ] AC6 — Given a session whose agent is a registered crew member, when it calls `kernel_playbook_create`, `kernel_playbook_update`, `kernel_playbook_disable`, `kernel_playbook_dry_run` or `kernel_playbook_enable`, then each tool error's text starts `<tool name>: crew_cannot_draft:` (for enable, the gate's `beforeHold` refusal text starts `kernel_playbook_enable: crew_cannot_draft:`) and nothing is written (for enable: nothing is held, no approval row).
- [ ] AC7 — Given Wright and a crew-owned playbook, then `kernel_playbook_update` and `kernel_playbook_disable` from Wright act on it, and `kernel_playbook_list` from Wright lists Wright's own playbooks and every registered crew member's, each entry carrying `owning_agent`. A playbook owned by an unregistered agent id (e.g. `scout`) stays `not_owner` for Wright and is not listed (the existing test `list shows the caller's own playbooks, every status, with the linked trigger; another agent's playbook is not_owner` passes unchanged).
- [ ] AC8 — Given Wright's own playbooks, then every existing test in `kernel/test/playbooks-drafts.test.ts`, `playbooks-dry-run.test.ts`, `playbooks-runs.test.ts`, `playbooks-foundation.test.ts`, `sessions-dry-run.test.ts`, `sessions-playbook-admission.test.ts` and `budget-playbook.test.ts` passes unchanged (Wright's mirror bytes, dry-run `cwd: wrightMemoryDir(dataDir)`, and the `agent_not_routed` row for the unregistered `scout` included), and `cd kernel && npm run typecheck && npm test` passes.
- [ ] AC9 — Given the change is complete, when `docs/architecture/playbooks.md`, `dry-run.md` and `playbook-runs.md` are read, then they document crew ownership (Wright drafts for an `active` crew member; the crew rule for update / disable / list / enable), the dry run and fire running as the owning member, the refusals `crew_cannot_draft` and `agent_off`, the narrowed `agent_not_routed`, the crew prompt and its honest limit; `docs/architecture/approvals.md`'s `apply_refused` table gains `crew_cannot_draft` ("The first six" becomes "The first seven"); `docs/architecture/budget.md`'s sentence saying crew playbooks are not routed is corrected; and `bash scripts/check-docs.sh` passes.

## Touched-file invariants

> Grounded at base `f387cec5402a6ed6575c7ee5694da93d3d8563bf`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/drafts.ts`** — keep: `owningAgent(ctx)` keeps returning the CALLING session's agent and its refusal (`runs no named agent; a playbook needs an owning agent`) — the new crew rule is a separate helper, never a change to what `owningAgent` returns (dry-run and enable import it); every change still runs as a work step keyed `ctx.stepKey(a.idempotency_key)` and ends in `afterStep` (`return afterPlaybookStep(ctx, result.id, result);`); the CLI-load rule in the header (`imports only \`../features/contribution.js\`, \`../loop/*\`, \`../tools/handoff.js\`,`) is widened in the comment only by the leaf `../agents/registry.js` (types + `Store` only); reuse: `named(…)` for every refusal so messages read `<tool>: <code>: …`; pinned by: `kernel/test/playbooks-drafts.test.ts` (`belongs to agent scout`, the `renderPlaybookMirror(r.playbook, r.trigger, "Asia/Kolkata")` byte pin).
- **`kernel/src/playbooks/store.ts`** — keep: the owner checks in `updatePlaybook` / `disablePlaybook` (`if (row.owning_agent !== agent) throw new PlaybookError("not_owner"`) are unchanged — callers pass the playbook's owning agent as `agent` only after the crew rule allowed it; extend only the `PlaybookErrorCode` union; pinned by: `kernel/test/playbooks-drafts.test.ts`, `kernel/test/triggers.test.ts`.
- **`kernel/src/playbooks/mirror.ts`** — keep: `renderPlaybookMirror` is pure and Wright's rendering is byte-identical (the agent line is emitted ONLY when `row.owning_agent !== "wright"`); reuse: `inline(…)` for the agent id; pinned by: `kernel/test/playbooks-drafts.test.ts` (`"- Status: \`draft\`",`).
- **`kernel/src/playbooks/dry-run.ts`** — keep: the check order before any session (owner/draft → `row.model === null` → settings → session manager), `noEffect: (err) => phase === "checks" || (phase === "starting" && isAdmissionRefusal(err))`, `failStaleDryRuns` before the step, `refuseStaleReplay` synchronous before the step's claim; Wright's path keeps `readWrightSettings(ctx.store.dataDir)` and `wrightMemoryDir(ctx.store.dataDir)` (the test pins `cwd: wrightMemoryDir(dataDir)`); pinned by: `kernel/test/playbooks-dry-run.test.ts` (`dryRun: true, playbook: id, playbookVersion: 1, cwd: wrightMemoryDir(dataDir)`), `kernel/test/sessions-dry-run.test.ts`.
- **`kernel/src/playbooks/enable.ts`** — keep: `beforeHold` only narrows (returns `{ refuse }` for a `PlaybookError`, rethrows anything else); `enableApproved` stays the ONE enable both paths use and keeps its check order (`draftOf` → `version_changed` → `no_dry_run` → `enablePlaybook`); a refusal writes nothing; `applyOnApproval` uses `approval.agent` (the requesting session's agent), never a stored requester; pinned by: `kernel/test/playbooks-dry-run.test.ts` (`apply_refused: "not_owner"` for another agent's playbook — that agent is unregistered, so it stays `not_owner`), `kernel/test/approvals.test.ts`.
- **`kernel/src/playbooks/runs.ts`** — keep: steps b–f are ONE work step that never throws for a refusal (`Never throws for a refusal (each is a return that writes its row)`); the `start-session` step's stored-result discipline (`startedOf`) and that every write after it comes from the stored result; an admission refusal is rethrown so the loop parks the event (`// Still \`running\`: the loop parks the event`); Wright's path keeps `ensureMemoryFiles(dataDir)`, `readWrightSettings(dataDir)`, `cwd: wrightMemoryDir(dataDir)` and `playbookPrompt` byte-identical; the CLI-load comment (`never \`../brain/index.js\` or \`handler.js\``) stays true; pinned by: `kernel/test/playbooks-runs.test.ts` (`'{"error":"agent_not_routed"}'`, the `playbookPrompt` test `the heading, the intent (wrapper tags defused), then Wright's context`).

## Closed enumerations touched

> Sibling grep at base `f387cec`: `grep -rnF '"not_owner"' kernel/src/playbooks` → hits in `kernel/src/playbooks/{store,enable,dry-run}.ts`; `grep -rnF 'agent_not_routed' kernel/src kernel/test docs` → `kernel/src/playbooks/runs.ts`, `kernel/test/playbooks-runs.test.ts`, `kernel/test/budget-agent-limits.test.ts` (a comment), `docs/architecture/playbook-runs.md`, `docs/architecture/budget.md`.

- **`crew_cannot_draft`**, **`agent_off`** (sibling: `not_owner`) — must be named in:
  - `kernel/src/playbooks/store.ts` — `export type PlaybookErrorCode = "invalid_input" | "not_found" | "not_owner" | "owner_off";` — extend with both.
  - `kernel/src/playbooks/enable.ts` — `readonly reason: "not_found" | "not_owner" | "turned_off_by_owner" | "not_draft" | "version_changed" | "no_dry_run";` — extend with `crew_cannot_draft` (the defence in `draftOf`), and map it in `playbookErrorOf`.
  - `kernel/src/playbooks/dry-run.ts` / `store.ts` / `enable.ts` `"not_owner"` throw sites — no change: they produce the existing code.
  - `docs/architecture/playbooks.md` and `dry-run.md` refusal lists — extend.
  - `docs/architecture/approvals.md` — the closed `apply_refused` table (`The first six are the enable's`) — extend with `crew_cannot_draft` and make it "The first seven".
- **`agent_off`** as a run-row error (sibling: `agent_not_routed`):
  - `kernel/src/playbooks/runs.ts` — `return row("failed", { error: "agent_not_routed" })` — add the `agent_off` row before it; `result_json.error` is not a closed list in code.
  - `docs/architecture/playbook-runs.md` — the refusal bullet — extend; `docs/architecture/budget.md` line `Crew playbooks are not routed yet` — correct.
  - `kernel/test/budget-agent-limits.test.ts` — a comment only — no change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-crew.test.ts` — AC1 crew owner recorded | pass `owningAgent(ctx)` instead of the resolved crew agent to `createPlaybook` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC1 `ghost` / `off` refused, nothing written | drop the `isRoutable` check of the `agent` argument in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC1 mirror names mason | delete the agent line push in `renderPlaybookMirror` in `kernel/src/playbooks/mirror.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC2 dry run as mason | pass `agent` (the caller) instead of the row's `owning_agent` to `startSession` in `kernel/src/playbooks/dry-run.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC2 `never` carried into the dry-run policy | drop the `never` spread from the crew policy in `kernel/src/playbooks/dry-run.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC3 off owner refused at dry run | delete the `agent_off` check in `kernel/src/playbooks/dry-run.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC4 enable applied for a crew playbook | make `draftOf` compare `row.owning_agent !== agent` only (drop the crew rule) in `kernel/src/playbooks/enable.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC5 fire runs as mason | use `wrightMemoryDir(dataDir)` as `cwd` for every agent in `kernel/src/playbooks/runs.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC5 crew prompt carries no Wright memory | build the crew prompt with `playbookPrompt` (Wright's `buildContext`) in `kernel/src/playbooks/runs.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC5 off owner at fire: `agent_off` row + one notification | map an `off` agent to `agent_not_routed` (drop the `agent_off` branch) in `kernel/src/playbooks/runs.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC6 crew session refused `crew_cannot_draft` | delete the crew-session refusal call in the `kernel_playbook_create` handler in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-crew.test.ts` — AC7 Wright lists crew playbooks | filter `kernel_playbook_list` by `agent: owningAgent(ctx)` only in `kernel/src/playbooks/drafts.ts` |

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| playbooks | `kernel/src/playbooks/drafts.ts`, `kernel/src/playbooks/store.ts` (error-code union only), `kernel/src/playbooks/mirror.ts`, `kernel/src/playbooks/dry-run.ts`, `kernel/src/playbooks/enable.ts`, `kernel/src/playbooks/runs.ts` | — | HIGH |
| tests | — | `kernel/test/playbooks-crew.test.ts` | HIGH |
| docs | `docs/architecture/playbooks.md`, `docs/architecture/dry-run.md`, `docs/architecture/playbook-runs.md`, `docs/architecture/budget.md` (one sentence), `docs/architecture/approvals.md` (`apply_refused` table row) | — | HIGH |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Crew-owned playbooks: drafting rule, dry run / enable / fires as the owner, docs | all | 10 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/test/playbooks-crew.test.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "crew_cannot_draft"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "agent_off"}
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "isRoutable"}
  - {kind: "symbol", path: "kernel/src/playbooks/dry-run.ts", name: "readAgentSettings"}
  - {kind: "symbol", path: "kernel/src/playbooks/runs.ts", name: "agent_off"}
  - {kind: "symbol", path: "docs/architecture/playbooks.md", name: "crew_cannot_draft"}
  - {kind: "symbol", path: "docs/architecture/playbook-runs.md", name: "agent_off"}
requires: []
lanes:
  - "kernel/src/playbooks/**"
  - "kernel/test/playbooks-crew.test.ts"
  - "docs/architecture/playbooks.md"
  - "docs/architecture/dry-run.md"
  - "docs/architecture/playbook-runs.md"
  - "docs/architecture/budget.md"
  - "docs/architecture/approvals.md"
external_requires: []
```

### Design notes (binding on the worker)

1. **The crew rule — one helper in `drafts.ts`, used by every part.** Export from `drafts.ts`: (a) `refuseCrewDrafting(ctx)` — when the calling session's agent is a REGISTERED crew member (`getAgent(store, agent) !== undefined`), throw `PlaybookError("crew_cannot_draft", "crew_cannot_draft: crew members don't draft playbooks; Wright drafts a crew member's playbooks")`. An unregistered non-Wright agent (the tests' `scout`) is NOT refused (AC7/AC8 keep its behaviour). (b) `mayManage(store, caller, owner): boolean` — `caller === owner`, or `caller === "wright"` and `getAgent(store, owner) !== undefined` (any status: an `off` member's playbook may still be listed, updated or disabled by Wright; its dry run and fire refuse `agent_off`). (c) `actingAgentFor(ctx, id)` — the playbook's `owning_agent` when `mayManage(caller, owner)`, else the caller (so the store's existing `not_owner` refusal fires with its existing text). `create`, `update`, `disable` call `refuseCrewDrafting` first, inside `named(…)` and BEFORE the work step; `update` / `disable` pass `actingAgentFor` to the unchanged store functions. `kernel_playbook_list`: a crew caller keeps today's `{agent: caller}` filter; Wright lists `listPlaybooks(store, {all: true})` filtered to `owner === "wright" || getAgent(store, owner) !== undefined` (rows already carry `owning_agent`).
2. **Create's `agent` argument.** Optional `agent: z.string().max(64).optional()`. Omitted ⇒ the caller (today). Given: only a `wright` session may pass it (any other caller ⇒ `crew_cannot_draft` if registered crew, else `invalid_input` `agent: only Wright drafts a playbook for another agent`); `agent === "wright"` is the caller itself; otherwise `getAgent(store, agent)?.status === "off"` ⇒ `PlaybookError("agent_off", "agent_off: <id> is off; turn it on before drafting its playbooks")`; `!isRoutable(store, agent)` ⇒ `invalid_input` `agent: <id> is not an active registered crew member`. All checks run before `runStep`, so a refusal writes nothing. The tool description says the `agent` argument exists and that the member's dry run and fires run as that member.
3. **Mirror.** `renderPlaybookMirror` adds `- Agent: \`<owning_agent>\`` right after the `- Version:` line ONLY when `row.owning_agent !== "wright"`; Wright's mirror is byte-identical.
4. **Dry run as the owner (`dry-run.ts`).** `ownDraft` uses `mayManage` (refusal text unchanged for a non-manageable playbook). The tool handler calls `refuseCrewDrafting` first. After the model check: when `row.owning_agent === "wright"`, today's code exactly; otherwise `getAgent(store, owner)?.status !== "active"` ⇒ `PlaybookError("agent_off", "agent_off: <owner> is off; its playbooks do not run")` (an unregistered owner never reaches here: `mayManage` refused it), then `ensureAgentMemoryFiles(dataDir, owner)` (a `charter_missing` result ⇒ `invalid_input` naming the file), then `readAgentSettings(dataDir, owner)` — a refusal ⇒ `invalid_input` whose message names the owner's file (`<file>: …`, e.g. for `model_unset` `model_unset: set "model" in <file>`); then `startSession({agent: owner, prompt: row.intent, model: row.model, permissionMode: s.permissionMode, cwd: agentMemoryDir(dataDir, owner), policy: { ...s.policy, ...(s.never !== undefined ? { never: s.never } : {}) }, dryRun: true, playbook, playbookVersion})`. All of this stays in the `checks` phase (no effect) until `phase = "starting"`. Update the tool descriptions: dry_run's "The run's tokens count against your limits" becomes "against the owning agent's limits", and every "you own" / "your own playbooks" in the update, disable, list, dry_run and enable descriptions says Wright may also act on a registered crew member's playbooks.
5. **Enable (`enable.ts`).** `draftOf(store, id, agent)`: after `not_found`, a registered crew `agent` ⇒ `EnableRefused("crew_cannot_draft", …)` (defence: a crew session can never be held, see `beforeHold`), then `not_owner` unless `agent !== null && mayManage(store, agent, row.owning_agent)` — so Wright's approved enable of a crew playbook applies. `beforeHold` refuses a crew caller (`crew_cannot_draft`, nothing held) before `ownDraft`; the handler calls `refuseCrewDrafting` first. `playbookErrorOf` maps `crew_cannot_draft` to `PlaybookError("crew_cannot_draft", …)`.
6. **Fires and run-now as the owner (`runs.ts`).** In `decideRun` step d, replace `!BRAIN_AGENTS.includes(e.agent)` with: `e.agent !== "wright"` and `getAgent(store, e.agent)?.status === "off"` ⇒ `failed` `{error: "agent_off"}` AND, inside the same step (so a redelivery replays it and records nothing more), one `recordNotification(store, {source: "kernel:agent_off", title: "Playbook not run: <agent> is off", body: "Playbook <slug> (#<id>) fired for <scheduled_at> but its agent <agent> is off; nothing ran. Turn it on with studio agents on <agent>."}, now)` (`isNotificationSource` accepts only `trigger:<id>`, `agent:<name>` or `kernel:<reason>`; match `NotificationInput`'s other fields exactly); else `!isRoutable(store, e.agent)` ⇒ `failed` `{error: "agent_not_routed"}` (the unregistered `scout` keeps this). In the `start-session` step: `wright` ⇒ today's code byte-identically. A crew agent ⇒ `ensureAgentMemoryFiles(dataDir, agent)` (throw ⇒ stored `memory_unwritable` fail with `fail_event`; `charter_missing` ⇒ stored fail `charter_missing: <file>`), `readAgentSettings(dataDir, agent)` (refusal ⇒ stored fail exactly as Wright's: `model_unset: set "model" in <file>` / `settings_invalid: <message>` / `settings_missing: <message>`), the same `lateSkip`, then the crew prompt and `startSession({agent, prompt, model, permissionMode, cwd: agentMemoryDir(dataDir, agent), policy: {...s.policy, never when set}, playbook, playbookVersion})`. **Crew prompt:** a new exported `crewPlaybookPrompt(input & {agent})` in `runs.ts` = the same heading and instruction lines as `playbookPrompt` (defused intent), then the member's own memory files `role.md`, `preferences.md`, `people.md`, `lessons.md` read with `readMemoryFile(dataDir, "<agent>/<file>", MAX_MEMORY_FILE_CHARS)` (each under a `## memory/<agent>/<file>` heading; a missing/unreadable file noted as `(memory/<agent>/<file> is missing)`), then `## Now` with `localTimeLine(now, timeZone)`, then the kernel-built line (`Playbook <slug> fired for <scheduled_at>.` / `run now by the owner.`), unwrapped (it is kernel text: slug and instant only). The whole prompt is capped at `MAX_CONTEXT_CHARS` (import it): the memory sections are cut in order with a one-line cut note when the total would exceed it, exactly the way the bound is stated in `buildContext`'s comment; the heading, instruction, time and kernel line are always kept. It NEVER calls `buildContext` and never reads `memory/wright/*`. Import only exported helpers (`readMemoryFile`, `MAX_MEMORY_FILE_CHARS`, `localTimeLine`, `defuseWrapperTags`); do NOT edit any `kernel/src/brain/*` file (item 05 edits `context.ts` in a parallel lane). Admission (item 04) applies the member's limits automatically because `startSession` carries `agent`: a parked fire stays parked (existing rethrow path).
7. **Imports.** `drafts.ts`, `dry-run.ts`, `enable.ts`, `runs.ts` may import `../agents/registry.js`, `../agents/settings.js`, `../agents/memory.js` and `../notifications/record.js` directly (leaf modules; never `../agents/index.js`, which pulls the roster/delegate parts); update each file's header comment that lists its imports. `kernel/test/feature-seams.test.ts`'s "module graph" SDK check must still pass.
8. **Tests (`kernel/test/playbooks-crew.test.ts`).** Reuse the existing harnesses' patterns from `playbooks-drafts.test.ts`, `playbooks-dry-run.test.ts` and `playbooks-runs.test.ts` (stand-in sessions recording `startSession` params; the real manager + gate for AC2's push). Create members with `createAgent` (item 02), never hand-written files; set `off` through the same store path the roster's `off` uses. Never edit an existing test file.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Item 05 (parallel lane) owns the crew context builder in `kernel/src/brain/context.ts`; this item's crew prompt is a local, narrower builder (Feasibility (Phase 2.5)) | MEDIUM | Never edit `kernel/src/brain/*`; the crew prompt carries the member's own four files, the time and the kernel line, never Wright's memory; document "no shared notes / Loomwright summary in a crew playbook prompt yet" as an honest limit in `playbook-runs.md` and leave a follow-up note there to switch to item 05's builder. |
| Three playbook sub-files change in one item; phase 3's per-file pins guard Wright's path | MEDIUM | Wright's branches stay byte-identical (mirror bytes, dry-run `cwd`, `playbookPrompt`, `agent_not_routed` for unregistered ids); run the full suite; never edit an existing test. |
| An unregistered non-Wright agent (`scout` in tests) must keep today's behaviour | MEDIUM | The crew rule keys on `getAgent(store, id) !== undefined`, never on `id !== "wright"`. |
| `agent_off` notification repeated on redelivery | LOW | Recorded inside the `playbook-run` work step, which replays its stored result and never re-evaluates. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-19-crew-playbooks-drafted-by-wright-run-as-member.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-18T20:05:49Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/90
- **Branch:** feature/crew-playbooks-drafted-by-wright-run-as-member
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Wright drafts crew-owned playbooks (create's optional agent, update/disable/list/enable under one crew rule); crew sessions refused crew_cannot_draft; dry run and fires/run-now run as the owning member (settings, policy with never, memory/<id>, session agent, admission limits); off owner refused agent_off (fire: failed row + one notification); agent_not_routed narrowed to ids isRoutable rejects; crew prompt carries only the member's own memory. Phase 4.5: iteration 1 PASS, 2 LOW dismissed (stale test comment; member may remove its playbook's trigger). Rules none, CI green. risk_classification: high_risk true (auth/token content, size 1313 lines). red_team_advisory: disabled. ground_truth: skipped.

## Not verified
- **crew playbook session under the real Agent SDK / CLI** — only the fake spawner and stand-in sessions were exercised (subtask 1)
- **studio playbooks verbs and mirror for a crew playbook via the live API server** — handlers were called directly (subtask 1)
