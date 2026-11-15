# Supervisor Job: A crew member without tracker access never starts a ticket run, and the enable card says why (phase 8 item 22e)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 2 (12 orphaned or stale worktrees under `.claude/worktrees/` plus `~/studio-work/v2-18d`; the source requirement is gitignored by `.supervisor/*`, so its provenance can't be verified through git)
- **Source requirement:** .supervisor/requirements/phase-8-22/2026-11-15-160000-e-a-member-without-tracker-access-never-starts-a-ticket-run.md
- **Base commit:** 787c00f6a7bdb86873368b2ac4707c261261d1ec

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest. The change stays inside `kernel/src/playbooks/` and its tests. |
| 2 | Dependency Availability | GO | No new dependency. It reuses `grantNeeds`, `holdsConnector`, `ownerStep` (`fit.ts`), `recordNotification` and SQLite `json_extract`, which is already used in 22 kernel files. |
| 3 | Architecture Fit | GO | It mirrors the existing `needs_github` park, which sits in `items.ts` and is called from `decideRun`. Mechanism only: the kernel parks and words the owner's step, and the owner keeps the grant (invariant 1). |
| 4 | Scope vs Supervisor Capability | GO | 9 files modified, 0 created, well under the `context-bound` bound. One subtask. |
| 5 | Hard Blockers | GO | `pollGrantOwnerSteps` is on `main` (PR #283, `48de35ff`). Every cited line holds at base (see Cited-line premise check). |

**Overall Verdict:** GO

## Task
**Goal:** Park a crew member's `clickup:` or `jira:` item run, before any session starts, when the member lacks that tracker's read grant. Notify the owner once per outage. Make the enable card of a `no_jobs` ticket-poll playbook carry the member's current `owner step:` line for that grant.

**Problem Statement:**
The owner of Loomwright Studio needs an enabled ticket playbook to stop spending a crew member's tokens on sessions that can't read the ticket, and needs to see that step before approving the enable.
Currently, `decideRun` (`kernel/src/playbooks/runs.ts`) checks access only for GitHub items (`isGithubItem` → `needsGithub`). So a ticket item of a member with no `clickup`/`jira` grant starts a session per new ticket or revision. The session's tracker calls are then refused, because a crew session gets only the tools its member holds. The enable card of a `no_jobs` playbook (`charterLines` returns `[]` for `no_jobs`) carries the step only inside the dry run's frozen summary. That summary goes stale when the grant changes after the dry run.
Success looks like this: such a ticket run parks `needs_tracker` with no session, one notification per outage that names the owner's step in `ownerStep`'s words, and a held `no_jobs` ticket-poll enable display that carries one `owner step:` line per currently missing tracker grant.

## Acceptance Criteria

Carried forward from the source requirement (AC1–AC9), in Given/When/Then form.

**Happy path:**
- [ ] **AC1.** Given an enabled playbook of a crew member that doesn't hold the read grant for a `clickup:` or `jira:` item's tracker, when that item's message runs, then no session starts, no tokens are spent, and the run row is `parked` (terminal, never a duplicate). Its `result_json` names a tracker-access reason, the tracker and what is missing. "Doesn't hold" means the same rule the dry run uses: the poll source's need from `grantNeeds`, checked by `holdsConnector`, as in `pollGrantOwnerSteps`. That way a dry run and a real run of the same member never disagree. The check runs after the dedupe key, as `needs_github` does, so an unchanged item that already ran `done` is still skipped quietly.
- [ ] **AC2.** Given AC1's park, then one notification is recorded per outage, with the same outage rule as `needs_github` (`docs/architecture/playbook-runs.md`, "The `needs_github` park"). Its title names the playbook and the member. Its body names the missing access in the same words as the dry run's owner step (`ownerStep`), says only the owner can grant it, and points to where the owner grants it in the app. It never points to a settings file path or a CLI command.
- [ ] **AC3.** Given the owner then grants the member that tracker's read access, when the next poll queues the same item, then it runs (starts a session) as today.
- [ ] **AC4.** Given a draft crew playbook with no jobs (`fit.status === "no_jobs"`) whose linked poll is `clickup.tasks` or `jira.issues`, and whose member lacks that read grant when the enable is held, then the held display carries one `owner step: <step>` line per missing grant, worded as `pollGrantOwnerSteps` words it. The lines are computed when the enable is held, not copied from the dry run. Given the member holds the grant at hold time, then no such line appears, whatever the dry run said.
- [ ] **AC5.** Given AC4, then the enable is still held, not refused. The missing grant doesn't open a `charter_gap` and needs no `enable_anyway`. AC1's park is what protects the runs.

**Edge cases:**
- [ ] **AC6.** Given a member whose settings file is refused or can't be read, when a ticket item's message runs, then the run parks (fails closed) with the refusal's code, as `needs_github`'s `settings_error` does, and the step does not throw.
- [ ] **AC7.** Given a member that holds the tracker grant, or a GitHub item, or a time-based fire with no item, or one of Wright's own playbooks, then the outcome is unchanged from today. That includes `needs_github` parks and their notifications.
- [ ] **AC8.** Given a crew playbook that names jobs, then its enable display is unchanged. Its `owner step:` lines already come from `fit.owner_steps`, which includes the poll source's grant. No step is shown twice.
- [ ] **AC9.** No text this item adds (park reason, notification, display line, tool description) proposes a grant or a `kernel_agent_update` that would carry one. Each names the grant as the owner's step.

**Validation (from the requirement; must pass before merge):**
- [ ] **V1 (static).** `cd kernel && npm ci && npm test` passes, with new cases in `kernel/test/playbooks-runs-items.test.ts` (AC1–AC3, AC6, AC7) and `kernel/test/playbooks-fit.test.ts` (AC4, AC5, AC8). At least one AC1 case fails on base `787c00f6` without the change: the requirement's throwaway repro, turned into a committed test whose playbook links a `clickup.tasks` poll trigger. Then `bash scripts/check-docs.sh` passes.

### Implementation contract (the design Launch Pad settled; the names are fixed so the pin mutations below apply)

1. **`kernel/src/playbooks/fit.ts`: one rule, shared.** Add `export function pollGrantGaps(store: Store, row: PlaybookRow, held: HeldConnectors): readonly PollGrantGap[]`, where `PollGrantGap` is `{ readonly kind: ConnectorKind; readonly step: string }` (`step` = `ownerStep(name, need)`). It returns `[]` when `row.owning_agent` is not a registered crew member (Wright's own playbook), on the line written exactly `if (member === undefined) return []; // Wright's own playbook: no charter`. This is the only Wright guard on the real-run path: `needsTracker` adds none of its own, so the AC7 pin below reaches it. Otherwise it returns `grantNeeds(store, row, [])` filtered by the line `.filter((need) => !holdsConnector(held, need))`, with each need mapped to `{ kind: need.kind, step: ownerStep(member.display_name, need) }`. It may throw only when the trigger read throws. Rebuild `pollGrantOwnerSteps` on it: same `memberSettings` read, same "unreadable settings ⇒ `[]`", same never-throws `try/catch`, returning `pollGrantGaps(store, row, read.settings).map((g) => g.step)`. Its output is byte-identical to today's (the dry run's `owner_step_open` text is unchanged). `playbookFit` and its stored `no_jobs` fit (`owner_steps: []`) are unchanged (non-goal).
2. **`kernel/src/playbooks/items.ts`: the park and the notice, beside `needs_github`.**
   - Extract a private `readGrantSettings(store, agent)` that returns `{ settings }` or `{ settings_error }`. It holds today's `needsGithub` read and its one-line `settings_unreadable: <first line>` error text. `needsGithub` uses it, and its exported signature, behaviour and `result_json` stay exactly as they are (`dry-run-poll.ts` imports it).
   - Add `export function trackerOfItem(item: RunItem): "jira" | "clickup" | undefined`, based on the ref's `jira:`/`clickup:` prefix.
   - Add `export interface NeedsTracker { readonly reason: "needs_tracker"; readonly tracker: "jira" | "clickup"; readonly missing: "grant"; readonly settings_error?: string }`.
   - Add `export function needsTracker(store: Store, row: PlaybookRow, item: RunItem): NeedsTracker | undefined`. It returns `undefined` for a non-ticket item. A Wright-owned playbook gets `undefined` through `pollGrantGaps`'s `[]`. A refused or unreadable settings file holds nothing (fail closed) and its `settings_error` is carried. Write that on the line exactly `const held: HeldConnectors = "settings" in read ? read.settings : {};`. It parks when `pollGrantGaps(store, row, held)` has a gap whose `kind` is the item's tracker, and never throws for a settings read.
   - Add `export const NEEDS_TRACKER_SOURCE = "kernel:needs_tracker";`.
   - Add `export function notifyNeedsTracker(...)`. Its `recordNotification` call carries the line exactly `source: NEEDS_TRACKER_SOURCE,`. The AC2 test asserts the literal string `kernel:needs_tracker` in its SQL or expectation, never the imported constant. Its title is `Playbook <slug> parked: <member display name> has no <Tracker> access`. Its body is `Playbook <slug> (#<id>) did not run for <ref>: <the gap's step>`, then, only when `settings_error` is set, a sentence naming the refusal code (never the file path), then `Its items run at the first poll after the grant is in place.`. No settings-file path and no CLI command (AC2, AC9).
   - The outage rule is one private helper `parkedSinceLastSession(store, playbook, reason)` that both notifiers call. Its SQL keeps today's `session_id IS NOT NULL AND item_ref IS NOT NULL` session boundary and adds `AND json_extract(result_json, '$.reason') = ?`. A `needs_github` park and a `needs_tracker` park then never end or merge each other's outage, and a run that starts a session ends both.
   - `items.ts` may now import `./fit.js` at runtime (its header's import list is updated to say so). `fit.ts` is CLI-safe (it already loads under the `studio` CLI through `./enable.ts`).
3. **`kernel/src/playbooks/runs.ts`: one call in `decideRun`.** Right after the existing GitHub block (after the dedupe-key check, before `// f. The run.`) add:
   `if (e.item !== null && !isGithubItem(e.item)) { const trackerPark = needsTracker(store, live, e.item); if (trackerPark !== undefined) { notifyNeedsTracker(...); return row("parked", { ...trackerPark }, dedupeKey); } }`.
   Write the guard on its own line exactly as `if (trackerPark !== undefined) {`. The notification is recorded inside the step, before the park row (a redelivery records none more). `runs.ts` still imports only `./items.js` for this, so its header's import list is unchanged. Its header and the `PLAYBOOK_RUN_STATUSES` doc comment now name the `needs_tracker` park too. The status set itself is unchanged: `parked` already exists.
4. **`kernel/src/playbooks/enable.ts`: `charterLines` gets `store`.** Its first line `if (fit === undefined || fit.status === "no_jobs") return [];` becomes two lines, written exactly:
   `if (fit === undefined) return [];`
   `if (fit.status === "no_jobs") return ticketPollOwnerSteps(store, row).map((step) => \`owner step: ${step}\`);`
   `ticketPollOwnerSteps(store, row): readonly string[]` is a small `fit.ts` export, a sibling of `pollGrantOwnerSteps` built on `pollGrantGaps`. It reads the member's settings the way `pollGrantOwnerSteps` does (unreadable ⇒ no line) and keeps only the gaps whose kind is `jira` or `clickup`. So the steps are computed at hold time, in `pollGrantOwnerSteps`'s words. `ticketPollOwnerSteps(store, row)` appears exactly once in `enable.ts`. A GitHub-poll `no_jobs` display stays as it is (out of AC4's scope). The jobs branch (`fits`/`gap`/`unchecked`) is unchanged (AC8). Nothing here touches `charterGap` / `fitGapOpen`, so the enable is held and never refused for it (AC5).
5. **Not built (the requirement's non-goals).** A real run's missing or expired tracker *connection* gets no new handling and no separate item. That handling already exists: a due ticket poll calls `mcpConnectorGate` before any fetch and queues no item when the connection is not `connected`/`expiring` (`docs/architecture/mcp-connectors.md`, "A due ticket poll whose gate is not `open` is not a fetch at all"). Also not built: dry-run read access for a ticket's body, gating the enable on the grant, changing the stored `no_jobs` fit, and Wright's own playbooks.

**Docs (same PR):**
- `docs/architecture/playbook-runs.md`: step 2's park bullet; the `parked` status row (a GitHub item's `needs_github` or a crew member's ticket item's `needs_tracker`); a new "The `needs_tracker` park" paragraph after "The `needs_github` park" (the rule, the `result_json` shape, the notification and outage rule, and that the outage is per reason); and honest-limits lines, including that an unreadable settings file parks the real run (fail closed, AC6) but does not stop the dry-run review (`pollGrantOwnerSteps` reads it as no step). So the two agree only while the settings file reads.
- `docs/architecture/playbooks.md`: the `owner_steps` bullet's "neither the stored fit nor the enable changes" sentence becomes: the stored fit is unchanged, and the enable display of a `no_jobs` `clickup.tasks`/`jira.issues` playbook carries an `owner step:` line per tracker grant missing at hold time. The display paragraph says the same.
- `docs/architecture/mcp-connectors.md`: the "A ticket item is not a GitHub item, so it never parks `needs_github`" sentence now adds that a crew member's ticket item parks `needs_tracker` when the member lacks that tracker's grant.

## Touched-file invariants

> Grounded at base `787c00f6a7bdb86873368b2ac4707c261261d1ec`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/items.ts`**
  - keep: the fail-closed grant read `granted = r.ok ? (r.settings.connectors ?? []).includes("github") : false;` (moved into `readGrantSettings`, same meaning) and the one-printable-line error `settings_unreadable: ${cutChars(line, 500)}`.
  - keep: the notify-before-row rule `Called inside the \`playbook-run\` step, BEFORE the park row is written`, and the outage boundary `session_id IS NOT NULL AND item_ref IS NOT NULL`.
  - keep: every existing export (`needsGithub`, `notifyNeedsGithub`, `NEEDS_GITHUB_SOURCE`, `isGithubItem`) with its signature, because `dry-run-poll.ts` imports `needsGithub` (`import { needsGithub } from "./items.js";`).
  - reuse: `cutChars`, `MAX_NOTIFICATION_TITLE` and `recordNotification` for the new notice.
  - mirror: the run row writer in `runs.ts` (`return row("parked", { ...park }, dedupeKey);`).
  - pinned by: `kernel/test/playbooks-runs-items.test.ts` (`result_json: '{"reason":"needs_github","missing":"grant","connector_status":"connected"}'`, and the `Playbook ${p.slug} parked: wright has no GitHub grant` title) and `kernel/test/playbooks-dry-run-poll-unit.test.ts` (`mocks.park.mockReturnValue`). The header's import list (`this module imports at`) must be updated to name `./fit.js`.
- **`kernel/src/playbooks/runs.ts`**
  - keep: `Never throws for a refusal (each is a return that`.
  - keep: the order. The tracker check sits after the dedupe check `if (doneWithKey(store, e.playbook, dedupeKey, null)) {` and after the GitHub block `if (e.item !== null && isGithubItem(e.item)) {`, and before `// f. The run.`.
  - keep: the closed status set `"skipped_not_enabled", "parked"] as const` unchanged.
  - keep: the header's runtime import list `and this feature's files (\`./items.js\`, \`./store.js\`, \`./types.js\`)` unchanged (the new symbols come from `./items.js`).
  - pinned by: `kernel/test/playbooks-runs-items.test.ts` (`expect(PLAYBOOK_RUN_STATUSES).toContain("parked");`).
- **`kernel/src/playbooks/fit.ts`**
  - keep: `pollGrantOwnerSteps`'s contract `Never throws: a failure to read is no step (the`, with byte-identical output.
  - keep: the `no_jobs` return `status: "no_jobs", lines: [` with `owner_steps: []`. The stored fit is a non-goal.
  - reuse: `ownerStep` (`only you can grant it: Team → ${name}'s inspector.`), `grantNeeds` and `holdsConnector`. Never a second wording.
  - keep: the CLI-safe import header (`The \`studio\` CLI loads this module (through \`./enable.ts\`)`). Add no import beyond `node:` builtins, the agents leaf modules, `../brain/settings.js` (`MAX_SETTINGS_BYTES`, already imported), `../features/catalogue.js`, `../features/job-needs.js` and this feature's store.
  - pinned by: `kernel/test/playbooks-fit.test.ts` (`"Mason needs ClickUp access for watching ClickUp; only you can grant it: Team → Mason's inspector."`).
- **`kernel/src/playbooks/enable.ts`**
  - keep: the jobs branch of `charterLines` (`lines.push(...fit.owner_steps.map((step) => \`owner step: ${step}\`));`), and the `owner step: ` prefix for the new lines.
  - keep: `charterGap` / `fitGapOpen` untouched (AC5).
  - pinned by: `kernel/test/playbooks-fit.test.ts` (`expect(hold.display).not.toContain("charter");` on a cron `no_jobs` playbook, which stays green because a cron trigger has no poll need).
- **`docs/architecture/playbook-runs.md`**
  - keep: the pinned strings `## Per-item runs`, `| \`parked\` |` and `` `needs_github` ``.
  - pinned by: `kernel/test/playbooks-runs-items.test.ts` (`expect(doc).toContain("| \`parked\` |");`).
  - keep: every relative link resolving (`scripts/check-docs.sh`).

## Closed enumerations touched

> Sibling grep at base `787c00f6`: `grep -rnF 'needs_github' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor --exclude-dir=.claude --exclude-dir=dist .` → hits in 14 files (src: `items.ts`, `runs.ts`, `dry-run-poll.ts`, `dry-run.ts`; docs: `playbook-runs.md`, `mcp-connectors.md`, `dry-run.md`, `agents.md`, `OPEN_QUESTIONS.md`; tests: `playbooks-runs-items`, `playbooks-dry-run-poll`, `playbooks-dry-run-poll-unit`, `integrations-mcp-trackers`, `phase-6-exit-live`).

- **`needs_tracker`** (sibling: `needs_github`). It must be named in:
  - `kernel/src/playbooks/runs.ts`: the `PLAYBOOK_RUN_STATUSES` doc comment that defines `parked` (`GitHub item's run whose agent lacked the grant or a usable connector`). Extend.
  - `kernel/src/playbooks/runs.ts`: the header's step list (`park` / `a GitHub item that needs GitHub (one notification per outage)`). Extend.
  - `kernel/src/playbooks/items.ts`: the header (`so it never parks \`needs_github\``). Extend: a crew member's ticket item now parks `needs_tracker`.
  - `docs/architecture/playbook-runs.md`: the run-status table row `| \`parked\` |` and step 2's bullet. Extend.
  - `docs/architecture/mcp-connectors.md`: `A ticket item is not a GitHub item, so it never parks \`needs_github\``. Extend.
  - `kernel/src/playbooks/dry-run-poll.ts`: `PREVIEW_INCOMPLETE_REASONS`. No change: those are the dry run's reasons, and the dry run already stops this case as `owner_step_open`.
  - `kernel/src/playbooks/dry-run.ts`: the tool description's `preview_incomplete?` list. No change, same reason.
  - `docs/architecture/dry-run.md`: the preview-incomplete table. No change, same reason.
  - `docs/architecture/agents.md`: "What it gates" describes the GitHub gate only. It is not a closed list of park reasons and is outside Touches, so no change.
  - `docs/OPEN_QUESTIONS.md`: a historical observation. No change.
  - the test files: they assert GitHub behaviour, which AC7 keeps. No change, beyond the new cases.
- **`kernel:needs_tracker`** (notification source; sibling `kernel:needs_github`, `grep -rnF 'kernel:needs_github'` → `items.ts` and `integrations-mcp-trackers.test.ts` only). No closed list of sources exists, so the new constant is its only home.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-runs-items.test.ts`: AC1 ticket item of an ungranted crew member parks `needs_tracker`, no session | flip `if (trackerPark !== undefined) {` → `if (false) {` in `kernel/src/playbooks/runs.ts` |
| `kernel/test/playbooks-runs-items.test.ts`: AC2 notification source (asserted as the literal `kernel:needs_tracker`) and once-per-outage | flip `source: NEEDS_TRACKER_SOURCE,` → `source: NEEDS_GITHUB_SOURCE,` in `kernel/src/playbooks/items.ts` |
| `kernel/test/playbooks-runs-items.test.ts`: AC2/Risk, a prior `needs_github` park of the same playbook does not swallow the first `needs_tracker` notice | flip `AND json_extract(result_json, '$.reason') = ?` → `AND ? IS NOT NULL` in `kernel/src/playbooks/items.ts` |
| `kernel/test/playbooks-runs-items.test.ts`: AC3, after the grant the same item starts a session | flip `.filter((need) => !holdsConnector(held, need))` → `.filter(() => true)` in `kernel/src/playbooks/fit.ts` |
| `kernel/test/playbooks-runs-items.test.ts`: AC6, a refused settings file parks with `settings_error` | flip `"settings" in read ? read.settings : {}` → `"settings" in read ? read.settings : { connectors: ["jira", "clickup"] }` in `kernel/src/playbooks/items.ts` |
| `kernel/test/playbooks-runs-items.test.ts`: AC7, a Wright-owned playbook's `clickup:` item still starts a session (no `needs_tracker` park) | flip `if (member === undefined) return []; // Wright's own playbook: no charter` → `if (member === undefined) return [{ kind: "clickup", step: "x" }]; // Wright's own playbook: no charter` in `kernel/src/playbooks/fit.ts` |
| `kernel/test/playbooks-runs-items.test.ts`: AC7, a GitHub item of an ungranted crew member still parks `needs_github` (not `needs_tracker`) | flip `if (e.item !== null && isGithubItem(e.item)) {` → `if (false) {` in `kernel/src/playbooks/runs.ts` |
| `kernel/test/playbooks-fit.test.ts`: AC4, a held `no_jobs` `clickup.tasks` enable display carries `owner step: Mason needs ClickUp access for watching ClickUp; only you can grant it: Team → Mason's inspector.` and none once granted | flip `ticketPollOwnerSteps(store, row)` → `[]` in `kernel/src/playbooks/enable.ts` |
| `kernel/test/playbooks-fit.test.ts`: AC5, the `no_jobs` ticket enable is held, not refused `charter_gap` | flip `fit.status === "gap" \|\| fit.status === "unchecked")` → `fit.status === "gap" \|\| fit.status === "unchecked" \|\| fit.status === "no_jobs")` in `kernel/src/playbooks/fit.ts` |
| `kernel/test/playbooks-fit.test.ts`: AC8, a jobs `clickup.tasks` playbook of an ungranted member shows its ClickUp `owner step:` line exactly once | flip `lines.push(...fit.owner_steps.map((step) => \`owner step: ${step}\`));` → `lines.push(...[...fit.owner_steps, ...fit.owner_steps].map((step) => \`owner step: ${step}\`));` in `kernel/src/playbooks/enable.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Park ungranted crew ticket runs `needs_tracker`; show the tracker owner step on a `no_jobs` enable card | all (AC1–AC9, V1) | 9 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel runs | `kernel/src/playbooks/items.ts` (318): the home of `needsTracker`, `notifyNeedsTracker`, `NEEDS_TRACKER_SOURCE`, `trackerOfItem`, and the `readGrantSettings` / `parkedSinceLastSession` extracts | — | HIGH |
| kernel runs | `kernel/src/playbooks/runs.ts` (908): about 7 lines in `decideRun`. Append reason: `decideRun` is the single place a run row is decided, and the logic is homed in `items.ts` | — | HIGH |
| kernel fit | `kernel/src/playbooks/fit.ts` (347): the home of `pollGrantGaps`, `PollGrantGap` and `ticketPollOwnerSteps`; `pollGrantOwnerSteps` is rebuilt on it | — | HIGH |
| kernel enable | `kernel/src/playbooks/enable.ts` (605): about 5 lines in `charterLines` plus a `store` parameter. Append reason: `charterLines` is the enable display's single authority, and the rule lives in `fit.ts` | — | HIGH |
| tests | `kernel/test/playbooks-runs-items.test.ts` (839): AC1–AC3, AC6, AC7 and the two-reason outage case. Append reason: the requirement's Validation names this file, and its harness (`poll`, `addMember`, `grantMember`, `runs`) is file-local, so a new file would copy it. Its `playbook()` helper gains an optional poll trigger | — | HIGH |
| tests | `kernel/test/playbooks-fit.test.ts` (653): AC4, AC5, AC8. Append reason: the requirement's Validation names this file, and its `draft`/`dryRun`/`held`/`grant` harness is file-local | — | HIGH |
| docs | `docs/architecture/playbook-runs.md` (138), `docs/architecture/playbooks.md` (152), `docs/architecture/mcp-connectors.md` (224) | — | HIGH |

**Extract rows:** extract the settings-read-and-error-line code of `needsGithub` into a private `readGrantSettings` in `kernel/src/playbooks/items.ts`, and the outage SQL of `notifyNeedsGithub` into a private `parkedSinceLastSession(store, playbook, reason)` in the same file. Both notifiers use them, so there is never a second copy.

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every `docs/**/*.md`, `CLAUDE.md` and `README.md` for relative links. Only the three docs above are edited, and any new link must resolve.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/items.ts", name: "needsTracker"}
  - {kind: "symbol", path: "kernel/src/playbooks/items.ts", name: "notifyNeedsTracker"}
  - {kind: "symbol", path: "kernel/src/playbooks/items.ts", name: "NEEDS_TRACKER_SOURCE"}
  - {kind: "type", path: "kernel/src/playbooks/items.ts", name: "NeedsTracker"}
  - {kind: "symbol", path: "kernel/src/playbooks/fit.ts", name: "pollGrantGaps"}
  - {kind: "symbol", path: "kernel/src/playbooks/fit.ts", name: "ticketPollOwnerSteps"}
  - {kind: "symbol", path: "kernel/src/playbooks/runs.ts", name: "trackerPark"}
  - {kind: "symbol", path: "docs/architecture/playbook-runs.md", name: "needs_tracker"}
requires: []
lanes:
  - "kernel/src/playbooks/items.ts"
  - "kernel/src/playbooks/runs.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/src/playbooks/fit.ts"
  - "kernel/test/playbooks-runs-items.test.ts"
  - "kernel/test/playbooks-fit.test.ts"
  - "docs/architecture/playbook-runs.md"
  - "docs/architecture/playbooks.md"
  - "docs/architecture/mcp-connectors.md"
external_requires: []
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `runs.ts:450-456` | yes (`kernel/src/playbooks/runs.ts`) | HOLDS | `if (e.item !== null && isGithubItem(e.item)) {` | tip 4 hours ago, fetched <1h |
| `items.ts:126` | yes (`kernel/src/playbooks/items.ts`) | HOLDS | `export function isGithubItem(item: RunItem): boolean {` | tip 4 hours ago, fetched <1h |
| `items.ts:19` | yes (`kernel/src/playbooks/items.ts`) | HOLDS | `not a GitHub item (\`isGithubItem\`), so it never parks \`needs_github\`.` | tip 4 hours ago, fetched <1h |
| `enable.ts:290` | yes (`kernel/src/playbooks/enable.ts`) | HOLDS | `if (fit === undefined \|\| fit.status === "no_jobs") return [];` | tip 4 hours ago, fetched <1h |
| `enable.ts:293` | yes (`kernel/src/playbooks/enable.ts`) | HOLDS | `lines.push(...fit.owner_steps.map((step) => \`owner step: ${step}\`));` | tip 4 hours ago, fetched <1h |
| `fit.ts:258` | yes (`kernel/src/playbooks/fit.ts`) | HOLDS | `return { ...base, status: "no_jobs", … owner_steps: [] };` | tip 4 hours ago, fetched <1h |
| `enable.ts:318` | yes (`kernel/src/playbooks/enable.ts`) | HOLDS | `` `dry run: ${dryRun.summary}`, `` | tip 4 hours ago, fetched <1h |
| `dry-run-poll.ts:447` | yes (`kernel/src/playbooks/dry-run-poll.ts`) | HOLDS | `The review was skipped, and no session started, until the owner takes this step:` | tip 4 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The tracker park keys on the playbook's linked poll trigger (`grantNeeds`), so a ticket item reaching a playbook whose linked trigger is not that tracker's poll would not park. This is only possible in a test harness, because real items come from the linked poll. | MEDIUM | This is AC1's chosen rule: it is the dry run's, so the two never disagree. The AC1 test builds its playbook with a `clickup.tasks` poll trigger, and the `playbook()` helper gains an optional trigger. The requirement's throwaway repro used a cron trigger, so the committed test must not reuse that shape. Say so in the test comment. |
| The shared outage rule: changing `notifyNeedsGithub`'s SQL to filter by reason could change GitHub notifications. | MEDIUM | Every `parked` row today is `needs_github`, so filtering by `needs_github` matches exactly the same rows (AC7). Pin it: the existing AC9 `needs_github` tests stay green unchanged, and a new case parks `needs_github` then `needs_tracker` on one playbook and expects one notice of each. |
| `items.ts` gains a runtime import of `./fit.js`. That could create an import cycle or pull a non-CLI-safe module into the `studio` CLI. | LOW | `fit.ts` imports only CLI-safe modules, and none of them imports `items.ts` or `runs.ts` (checked at base: only `runs.ts`, `dry-run.ts` and `dry-run-poll.ts` import `./items.js`). `fit.ts` already loads under the CLI through `enable.ts`. Run the full suite, including `tool-catalogue.test.ts`'s forbidden-import check. |
| An existing run test may assert that a ticket item of a member with no grant starts (the requirement's risk). | LOW | At base the only such test (`a ticket item's run starts with no GitHub grant and no connector`) runs as Wright, which is unchanged under AC7. If any other test expects a crew ticket run to start without a grant, change the expectation on purpose and say so in that test. |
| `pollGrantOwnerSteps`'s output must stay byte-identical once it is rebuilt on `pollGrantGaps`, or the dry run's stored `owner_step_open` text changes. | LOW | The dry-run suites (`playbooks-dry-run-poll*.test.ts`) pin it. They stay green unchanged. |
| A real run's lost tracker connection (non-goal). | LOW | It is already handled before any item is queued: a due ticket poll's `mcpConnectorGate` fetches nothing unless the connection is `connected`/`expiring`. No separate item is needed. A connection lost between the poll and the run is a narrow window that this item doesn't cover. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-15-member-without-tracker-access-parks.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-15T15:24:44Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/284
- **Branch:** feature/member-without-tracker-access-parks
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** A crew member's clickup:/jira: item run without the tracker read grant now parks needs_tracker before any session (rule shared with the dry run via pollGrantGaps), with one kernel:needs_tracker notice per outage per reason; a no_jobs ClickUp/Jira enable display carries hold-time owner-step lines. Heal iteration 1 fixed the notice wording for a refused settings file (26881cff). Suite 4758 passed; all 10 pin mutations held (reviewer-applied; the plugin pin runner reported unsupported_pin_runner). auto_review is false in config, so no drain was dispatched; /automate owns the drain.

## Not verified
- **owner's needs_tracker notification and the no_jobs enable card in the desktop app** — checked through the kernel store and held-tool display in tests only; no running app in this worker (subtask 1)
