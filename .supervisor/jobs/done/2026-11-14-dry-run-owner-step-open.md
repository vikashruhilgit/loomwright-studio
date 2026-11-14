# Supervisor Job: A poll playbook's dry run names the owner's missing grant instead of running a review that can't act (phase 8 item 21e)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-14-103216/L3
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-21/2026-11-14-120300-e-a-dry-run-names-the-owner-step-instead-of-a-review-that-cannot-act.md
- **Base commit:** 02244df1bc2943059840a681ab57b4a0571f7e21

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel + vitest; no new language or framework |
| 2 | Dependency Availability | GO | No new dependency: `playbookFit` (`kernel/src/playbooks/fit.ts`) already computes `owner_steps` and the dry run already calls it (`refusedOf`) |
| 3 | Architecture Fit | GO | Same shape as the existing `preview_incomplete` path (`finishWithoutSession`): a kernel-side refusal before any session (invariant 2: the kernel, not the model, decides whether a session starts) |
| 4 | Scope vs Supervisor Capability | GO | 5 modify + 1 create, one module; single subtask |
| 5 | Hard Blockers | GO | None; Validation 2 needs the packaged app (owner-run running-system step) |

**Overall Verdict:** GO

## Task
**Goal:** When a crew member's poll playbook is dry-run and its fit has a non-empty `owner_steps` (a connector grant only the owner can give), the kernel lists the poll's items as today but starts no review session, records `poll.preview_incomplete.reason = "owner_step_open"` with the owner step(s) in plain words, stores the run `done` with 0 tokens and its `fit`, and the summary says the review is skipped until the owner takes that step.

**Problem Statement:**
The owner of Loomwright Studio needs a dry run of a ticket playbook whose crew member lacks a grant (e.g. GitHub write for "Hand tickets to /automate") to name that one owner step, because today the dry run spends ~100k tokens on a review session that cannot use the jobs' tools and whose `final_text` blames missing tools, a non-git cwd and raw tool names.
Currently `dry-run.ts` starts the review whenever `previewPoll` picks an item; `playbookFit` already knows `owner_steps` before the session starts but is only used for `refused` and the tool result's `fit`. This causes wasted tokens and a misleading cause shown to the owner.
Success looks like: a dry run of Ticket Runner (ClickUp access, no GitHub write) uses 0 session tokens and names the GitHub grant as the owner's step in Team.

## Acceptance Criteria
- [ ] **AC1.** Given a poll playbook whose crew member lacks a connector grant one of the playbook's jobs needs (non-empty `fit.owner_steps`), when it is dry-run, then the poll preview still runs and lists its items (`poll.items` with `would` verdicts as today), no review session starts (`sessions.startSession` is never called; `poll.reviewed` is `null`; `poll.drafts` is `[]`), and `poll.preview_incomplete.reason` is the new value `owner_step_open`, added to `PREVIEW_INCOMPLETE_REASONS` (and kept by `pollOf` when a stored result is read back).
- [ ] **AC2.** Given that dry run, then `poll.preview_incomplete.fix` and the result's `summary` name each open owner step in plain words, taken verbatim from `fit.owner_steps` (e.g. "Ticket Runner needs GitHub write access for Hand tickets to /automate; only you can grant it: Team → Ticket Runner's inspector."), and say the review was skipped until then; the poll part of the summary contains no raw tool name (`mcp__`, `kernel_`), no reason/error token (`owner_step_open`) and no file path, and for the Ticket Runner shape (owner step open, empty `refused`) the whole `summary` contains none of `owner_step_open`, `charter_gap`, `mcp__`, `kernel_` (a summary that also carries non-empty `refused` keeps item 20c's existing `refusedText` wording, out of scope here). The dry-run tool's description names `owner_step_open` and tells Wright to name `fit.owner_steps` to the owner as their step in plain words (never propose them).
- [ ] **AC3.** Given that dry run, then the `playbook_runs` row is stored `kind = 'dry_run'`, `status = 'done'`, `session_id` NULL, `tokens` 0 (as for `needs_github`), and its `result_json` carries the `poll` preview (items + `preview_incomplete`), the `fit` used for the decision, and the skip reason; the `playbook_dry_run` audit event records `tokens: 0`, and `latestDryRun` / `recordOf` re-read it with the same summary.
- [ ] **AC4.** Given a crew playbook whose `fit` has only `refused_calls` that no grant can close (`closable: false`, the D44 crew route) and an empty `owner_steps`, when it is dry-run, then the review session still runs as today and those calls are named as today (`refused`); they do not count as an open owner step.
- [ ] **AC5.** Given the owner grants the missing access (the member's settings now hold the grant, so `owner_steps` is empty), when the playbook is dry-run again with a new key, then the review session runs as today (phase 6 item 09).
- [ ] **AC6.** Given a Wright-owned playbook (`playbookFit` returns `undefined`) or a crew playbook whose `fit.status` is `unchecked` (or `no_jobs`), when it is dry-run, then behaviour is unchanged (the review runs when `previewPoll` picks an item). A playbook whose poll preview already stops (`connector_missing`, `needs_github`, `rate_limited`, `source_error`, zero items, unreadable dedupe spec) keeps that earlier reason: the owner-step check applies only when `previewPoll` returned a `review` item.
- [ ] **AC7.** Given a crew playbook's review session that does run (e.g. `owner_steps` empty) and ends with text blaming missing tools, then the stored run's `result_json` carries `fit` beside `final_text`, so the owner-facing summary is the kernel's, never only the session's.
- [ ] **AC8.** Given the change is merged-ready, then a committed evidence file `docs/evidence/phase-8-21e-dry-run-owner-step.md` records Validation 1 (the `cd kernel && npm ci && npm test` and `bash scripts/check-docs.sh` results) and Validation 2 (the packaged-app dry run of a ClickUp ticket playbook whose member has ClickUp access but no GitHub write: preview lists the task, 0 tokens, Wright's reply names the GitHub grant as the owner's step in Team) with the line `Verdict: PASS for Validation 2` at column 0 outside any fence, and the PR body links to it.

**Evidence rule:** AC8's evidence lives in the committed `docs/evidence/phase-8-21e-dry-run-owner-step.md`, never only in the PR body. Validation 2 is a running-system step in the packaged app: the worker writes the file with the Validation 1 results and a Validation 2 section to be completed by the owner-run walk; the `/automate` validation gate reads the `Verdict:` line.

## Touched-file invariants

> Grounded at base `02244df1bc2943059840a681ab57b4a0571f7e21`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/dry-run-poll.ts`** — keep: the closed reason list is defined once here: `export const PREVIEW_INCOMPLETE_REASONS = Object.freeze([`; the stored-result reader drops unknown reasons via `(PREVIEW_INCOMPLETE_REASONS as readonly unknown[]).includes(v.reason)` (so the new value must be in the list or `pollOf` silently drops it); the module's import boundary: `` `./dry-run.ts` imports it, never the other way round `` and it imports no session manager or SDK — do NOT import `./fit.ts` here: pass the owner-step strings in from `dry-run.ts` to a pure helper; the existing `function incomplete(spec: PollSpec, reason: PreviewIncompleteReason, fix: string): PollPlan` returns `items: []` — the new reason keeps the items, so it needs its own constructor rather than `incomplete(`; reuse: `inline(` for cutting/flattening summary text; mirror: `formatPollSummary`'s incomplete branch says `a real run parks until this is fixed`, which is false for `owner_step_open` (a real run would be refused calls, not parked) — the new branch lists the items like the normal path (`The poll found`) and then says the review was skipped until the owner step is taken; pinned by: `kernel/test/playbooks-dry-run-poll-unit.test.ts` (`preview_incomplete: { reason: "nope", fix: "f" }` — unknown reasons dropped) and `kernel/test/playbooks-dry-run-poll.test.ts` (`expect((PREVIEW_INCOMPLETE_REASONS as readonly string[]).includes(reason)).toBe(true);`).
- **`kernel/src/playbooks/dry-run.ts`** — keep: the decision happens in the `checks` phase, before `phase = "starting";`, so a refusal writes nothing and `noEffect: (err) => phase === "checks"` still releases the step; the no-session store path is `finishWithoutSession` (`INSERT INTO playbook_runs (playbook, version, kind, status, session_id, started_at, ended_at, tokens, result_json) VALUES (?, ?, 'dry_run', 'done', NULL, ?, ?, 0, ?)`) — reuse it, do not add a second insert; the poll branch's gate `if (plan !== undefined && plan.review === null) return finishWithoutSession(ctx, row, trigger, plan.poll);` must still catch the earlier reasons first (AC6); `refusedOf` never throws (`} catch {`) — the owner-step read of `playbookFit` must likewise never throw (a fit failure = no owner step, review runs as today); reuse: `playbookFit(ctx.store, row, ctx.catalogue)` — compute the fit once per run and use it for `refused`, the owner-step check and the stored `fit`; mirror: the tool description string `preview_incomplete? (connector_missing, needs_github, rate_limited or source_error: no session started)` must name `owner_step_open`; `recordOf` re-reads `result_json` keys (`would_do`, `next_fires`, `dedupe_key`, `poll`, `refused`) and rebuilds the summary via `formatDryRunSummary` — the stored `poll.preview_incomplete.fix` must carry the owner-step text so a re-read summary is identical; `withFit` adds the live fit to the tool result (`never stored in the step`) — storing `fit` in `result_json` is additive and does not change that; pinned by: `kernel/test/playbooks-dry-run-needs.test.ts` (refused calls / `charter_gap`, read-only reference for crew fixtures) and `kernel/test/playbooks-dry-run-poll.test.ts`.
- **`kernel/test/playbooks-dry-run-poll.test.ts`, `kernel/test/playbooks-dry-run-poll-unit.test.ts`** — keep: the `expectIncomplete` helper and its `expect(poll.items).toEqual([]);` assertion stay as they are for the four existing reasons; never call `expectIncomplete` for `owner_step_open` (its items are non-empty), so write the new cases in their own `describe`; keep the unknown-reason case `preview_incomplete: { reason: "nope", fix: "f" }` still dropped by `pollOf`; keep every existing ClickUp/Jira/GitHub preview case green unchanged (they are Wright-owned or unregistered-agent playbooks, so `playbookFit` is `undefined` and AC6 holds); reuse: the crew-member fixture setup (registered agent, settings file, catalogue) from `kernel/test/playbooks-dry-run-needs.test.ts` (`describe("AC4: the dry run names the calls a real run would be refused, and the enable is refused charter_gap"`) — copy the pattern, do not modify that file; the unit test's `vi.mock("../src/playbooks/items.js"` / `needsGithub: mocks.park` mocking stays as is.
- **`docs/architecture/dry-run.md`** — keep: the reasons table under `**An incomplete preview, still enable-able.**` (`| \`needs_github\` | a GitHub poll only`) lists every reason; the `poll = { spec, items: ...` result shape line; `bash scripts/check-docs.sh` link check (relative links must resolve).

## Closed enumerations touched

> Sibling grep at base `02244df1`: `grep -rnF '"needs_github"' --exclude-dir=node_modules --exclude-dir=.git .` → 18 hits in 7 files; `grep -rnE 'connector_missing.{0,40}needs_github|preview_incomplete' app kernel/src docs` for the reason lists.

- **`owner_step_open`** (sibling: `needs_github`) — must be named in:
  - `kernel/src/playbooks/dry-run-poll.ts` — the closed list `export const PREVIEW_INCOMPLETE_REASONS = Object.freeze(["connector_missing", "needs_github", "rate_limited", "source_error"] as const);` — extend, in alphabetical position: `["connector_missing", "needs_github", "owner_step_open", "rate_limited", "source_error"]`.
  - `kernel/src/playbooks/dry-run.ts` — the tool description's reason list `preview_incomplete? (connector_missing, needs_github, rate_limited or source_error: no session started)` — extend.
  - `docs/architecture/dry-run.md` — the `| \`reason\` | When | \`fix\` names |` table — extend with an `owner_step_open` row (crew playbook, non-empty `fit.owner_steps`, items still listed, the owner steps in plain words).
  - `kernel/src/playbooks/items.ts`, `docs/architecture/playbook-runs.md`, `kernel/test/playbooks-runs-items.test.ts` — the real run's `needs_github` park reason (`reason: "needs_github"` in `result_json`) — no change: a different closed set (real-run park reasons), not preview reasons.
  - `kernel/test/phase-6-exit-live.test.ts` — treats any `preview_incomplete` as a stage-3 failure — no change: a live judge, not a closed list; an owner step open is correctly not a complete dry run.
  - `app/` — no hit for `preview_incomplete` or `needs_github`: the app renders `summary`, no reason list to extend.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `playbooks-dry-run-poll-unit.test.ts` — `pollOf` keeps a stored `owner_step_open` incomplete with its items | flip `"owner_step_open", "rate_limited"` → `"rate_limited"` in `kernel/src/playbooks/dry-run-poll.ts` |
| `playbooks-dry-run-poll-unit.test.ts` — `formatPollSummary` for `owner_step_open` lists the items, names the owner step, says the review was skipped, and does not contain `owner_step_open` | replace the new `owner_step_open` branch's return with the existing `Poll preview incomplete (` sentence in `kernel/src/playbooks/dry-run-poll.ts` (reviewer-applied) |
| `playbooks-dry-run-poll.test.ts` — AC1/AC3: crew member without the grant ⇒ no session (session starter throws), `tokens` 0, row `done`, `session_id` NULL, items listed | flip the owner-step condition itself (the `owner_steps.length > 0` test in `kernel/src/playbooks/dry-run.ts`) to `false` (reviewer-applied) |
| `playbooks-dry-run-poll.test.ts` — AC3: the no-session run's stored `result_json` carries `fit` | delete the `fit` spread from the `resultJson` of `finishWithoutSession` in `kernel/src/playbooks/dry-run.ts` (reviewer-applied) |
| `playbooks-dry-run-poll.test.ts` — AC7: a run whose session ran stores `fit` beside `final_text` | delete the `fit` spread from the `resultJson` of `finishRun` in `kernel/src/playbooks/dry-run.ts` (reviewer-applied) |
| `playbooks-dry-run-poll.test.ts` — AC2: Ticket Runner shape (owner step open, empty `refused`) ⇒ the whole `summary` contains the owner step and none of `owner_step_open`, `charter_gap`, `mcp__`, `kernel_` | flip the new summary branch's owner-step text to `preview_incomplete.reason` in `kernel/src/playbooks/dry-run-poll.ts` (reviewer-applied) |
| `playbooks-dry-run-poll.test.ts` — AC4/AC6: `refused_calls` only (empty `owner_steps`) / Wright-owned ⇒ the review session starts | flip the owner-step condition to also fire on `refused_calls.length > 0` in `kernel/src/playbooks/dry-run.ts` (reviewer-applied) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Skip the dry-run review on an open owner step, name it, store fit | all (AC1–AC8) | 5 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| preview reasons + summary | `kernel/src/playbooks/dry-run-poll.ts` (422) — home of the new reason, a pure helper turning a `PollPlan` + owner-step strings into the `owner_step_open` plan (items kept, `review: null`), and the summary branch | — | HIGH |
| dry-run orchestration | `kernel/src/playbooks/dry-run.ts` (635 — appended: the single point where the poll plan and the fit meet before a session starts; only a call site, the stored `fit` key and the tool description change, all new logic lives in `dry-run-poll.ts`) | — | HIGH |
| tests | `kernel/test/playbooks-dry-run-poll-unit.test.ts` (154) — pure helper, `pollOf`, `formatPollSummary` cases; `kernel/test/playbooks-dry-run-poll.test.ts` (1106 — appended: the requirement's Touches names it as the playbook-layer poll dry-run suite; one new `describe` for the crew owner-step cases AC1, AC3–AC7, crew fixtures copied in from `kernel/test/playbooks-dry-run-needs.test.ts` patterns) | — | HIGH |
| docs + evidence | `docs/architecture/dry-run.md` (176) | `docs/evidence/phase-8-21e-dry-run-owner-step.md` | HIGH |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans every `docs/**/*.md` for relative links; the new evidence file and the `dry-run.md` edit must keep all relative links resolvable.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/dry-run-poll.ts", name: "owner_step_open"}
  - {kind: "symbol", path: "kernel/src/playbooks/dry-run-poll.ts", name: "PREVIEW_INCOMPLETE_REASONS"}
  - {kind: "symbol", path: "kernel/src/playbooks/dry-run.ts", name: "owner_step_open"}
  - {kind: "symbol", path: "docs/architecture/dry-run.md", name: "owner_step_open"}
  - {kind: "symbol", path: "kernel/test/playbooks-dry-run-poll.test.ts", name: "owner_step_open"}
  - {kind: "symbol", path: "kernel/test/playbooks-dry-run-poll-unit.test.ts", name: "owner_step_open"}
  - {kind: "file", path: "docs/evidence/phase-8-21e-dry-run-owner-step.md"}
requires: []
lanes:
  - "kernel/src/playbooks/dry-run.ts"
  - "kernel/src/playbooks/dry-run-poll.ts"
  - "kernel/test/playbooks-dry-run-poll.test.ts"
  - "kernel/test/playbooks-dry-run-poll-unit.test.ts"
  - "docs/architecture/dry-run.md"
  - "docs/evidence/phase-8-21e-dry-run-owner-step.md"
external_requires:
  - "Packaged Loomwright Studio app with the kernel installed from the PR head (Validation 2, owner-run)"
```

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `dry-run.ts:451` | yes (`kernel/src/playbooks/dry-run.ts`) | HOLDS | `return { agent: owner, permissionMode: s.permissionMode, policy: …, cwd: agentMemoryDir(store.dataDir, owner) };` | tip 19 minutes ago, fetched <1h |
| `kernel/src/playbooks/dry-run-poll.ts:62` | yes | HOLDS (moved to 64) | `export const PREVIEW_INCOMPLETE_REASONS = Object.freeze(["connector_missing", "needs_github", "rate_limited", "source_error"] as const);` | tip 19 minutes ago, fetched <1h |
| `dry-run-poll.ts:174` | yes (`kernel/src/playbooks/dry-run-poll.ts`) | HOLDS (moved to 176) | `return incomplete(spec, "needs_github", \`Add "github" to "connectors" in ${agentSettingsPath(store.dataDir, agent)}.${refused}\`);` | tip 19 minutes ago, fetched <1h |
| `dry-run.ts:472` | yes (`kernel/src/playbooks/dry-run.ts`) | HOLDS | `return (playbookFit(ctx.store, row, ctx.catalogue)?.refused_calls ?? []).map(…)` | tip 19 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `PREVIEW_INCOMPLETE_REASONS` is a frozen list pinned by tests and the tool description; until now every incomplete preview had `items: []` (the `expectIncomplete` helper asserts `expect(poll.items).toEqual([]);`) | MEDIUM | New reason gets its own plan constructor and its own test `describe`; do not reuse `incomplete(` or `expectIncomplete`; extend all three closed lists in one change (see Closed enumerations) |
| `fit.owner_steps` also includes a poll-source read grant (`watching ClickUp`/`Jira`) that the ticket preview does not check (`mcpConnectorGate` checks only the connection) | MEDIUM | By the requirement's AC1 definition any non-empty `owner_steps` skips the review — this is intended (a real run would lack that grant too); the fix text names each step verbatim, so the owner sees which one |
| The summary's existing `refusedText` names `charter_gap` when `refused` is non-empty, which AC2's "no error token" could be read to forbid | LOW | Out of scope (item 20c's wording); AC2's no-token assertion targets the poll part of the summary; the Ticket Runner case has empty `refused` (connector gaps sourced from tools are filtered into `owner_steps`) |
| `playbookFit` throwing or reading settings mid-change | LOW | Same never-throw pattern as `refusedOf`: on any failure no owner step, review runs as today |
| The poll test file is 1106 lines | LOW | Append one focused `describe`; most branch coverage goes in the 154-line unit test |
| Validation 2 needs the packaged app | MEDIUM | Owner-run step; evidence file carries the `Verdict: PASS for Validation 2` line once walked |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-14-dry-run-owner-step-open.md
```

## Plan Review: PASS (attempt 2/3)
Open LOW notes (below the MEDIUM fix floor, carried as-is):
- docs/architecture/dry-run.md paragraphs at "Checked before any fetch, in order" and "In each of them no session starts", and the dry-run-poll.ts header comment, describe every incomplete reason as pre-fetch with no items and a real run that parks; update them so owner_step_open is the one reason decided after the fetch, keeps its items, and a real run is refused rather than parked.
- AC2's whole-summary no-token rule covers the Ticket Runner shape (empty `refused`); the mixed case keeps item 20c's `charter_gap` wording.
- Optional: pin the tool description's `owner_step_open` mention with a unit assertion.

## Outcome
- **Status:** completed
- **Completed:** 2026-11-14T05:33:58Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/277
- **Branch:** feature/dry-run-owner-step-open
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** A crew poll dry run with non-empty fit.owner_steps now lists the poll's items and starts no review session (reason owner_step_open). The fix and summary name each owner step verbatim, and the run is stored done with 0 tokens and its fit. A session that does run stores fit beside final_text. Kernel suite 4621 passed. The Phase 4.5 review PASSed with 0 issues, and all 7 pin mutations held. Validation 2 (packaged-app walk) is pending the owner: the evidence file says Verdict: PENDING (owner-run).

## Not verified
- **Validation 2: packaged-app dry run of a ClickUp ticket playbook whose member lacks GitHub write.** Needs the packaged app, a live ClickUp connection and a walk by the owner. The evidence file says Verdict: PENDING (owner-run), not PASS. (subtask 1)
- **A ClickUp-source poll through the real kernel tool path.** That path can't inject an MCP ticket reader, so the integration tests use a GitHub source. (subtask 1)
