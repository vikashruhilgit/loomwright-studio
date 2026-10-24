# Supervisor Job: Wright points the owner to the app's controls, not to `studio` commands

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L4
- **CLAUDE.md:** ✓ Found (fresh; its `kernel/` + `docs/` description predates `app/`, nothing it states is contradicted)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115023-wright-points-to-the-app-not-cli-commands.md
- **Base commit:** e6233a90e050fb930a318e275fcdcb3b00f0987d

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel + vitest; the change is one template-literal string in `kernel/src/sessions/manager.ts`, one exported string constant in `kernel/src/brain/templates.ts`, their test pins and one doc block. |
| 2 | Dependency Availability | GO | No new dependency. The app controls the guidance names exist on main: the Approvals screen (`app/src/screens/approvals/index.tsx`: `title: "Approvals"`), the playbook card's `Run now`, `Turn off` and `Set {field}` buttons (`app/src/screens/chat/cards.tsx`), and the Team screen's inspector (`app/src/screens/team/Inspector.tsx`; `app/src/screens/team/index.tsx`: `title: "Team"`). |
| 3 | Architecture Fit | GO | Invariant 1 holds (guidance text only, no policy); invariant 8 holds (`role.md` stays an inspectable file written once, the owner's edits win). No CLI command is removed (non-goal). |
| 4 | Scope vs Supervisor Capability | GO | Single subtask: 7 files, one concern, no file-conflict / context-bound / genuine-parallelism reason to split. |
| 5 | Hard Blockers | CAUTION | AC3 (Wright's replies in the live rerun) is the owner's observation after merge and cannot be verified by the worker. `role.md` is written only when absent (`kernel/src/brain/memory.ts` / `docs/architecture/brain.md`: "an existing file is never overwritten"), so the owner's existing `~/.loomwright-studio/memory/wright/role.md` keeps the old text in the rerun unless the owner updates it. See Risk Assessment. |

**Overall Verdict:** CAUTION (check 5; findings carried into Risk Assessment)

## Task

**Goal:** Wright's replies, and the kernel texts Wright repeats, send the owner to the app's controls (Approvals; a playbook card's Set, Run now, Turn off; Team's inspector), not to `studio` commands.

**Problem Statement:**
In the phase 5 live exit run Wright told the owner to type `studio playbooks set 3 model <id>` and `studio approve 6` / `studio deny 6`, though the app already does both. Wright repeats the kernel: a held call's tool result says "The owner decides (studio approve <id> once, or studio deny <id>)" (`kernel/src/sessions/manager.ts`), and Wright's first-run guidance (`ROLE_TEMPLATE` in `kernel/src/brain/templates.ts`) never says the owner works in the app.

Do three things (the requirement's Scope 1–3):

1. **Held-call text** (`kernel/src/sessions/manager.ts`, the `permissionDecisionReason` built when `outcome.kind !== "granted"`): replace `The owner decides (studio approve ${outcome.id} once, or studio deny ${outcome.id})` with `The owner decides in Studio's Approvals (approval ${outcome.id})`. The full held reason becomes, byte for byte:
   `approval_required: held as approval ${id}; it did not run. The owner decides in Studio's Approvals (approval ${id}) and the decision arrives as a new message. End your turn now; if it is approved, ${ifApproved}`
   Keep the `approval_required: held as approval <id>; it did not run. ` prefix, "End your turn now", and the `ifApproved` branch on `KERNEL_APPLIED_ACTIONS` unchanged. Update every test that pins the old text (the File Impact Map lists them, including `kernel/test/playbooks-dry-run.test.ts`, which pins the whole string twice and is not in the requirement's Touches but must change for `npm test` to pass).
2. **Wright's guidance** (`ROLE_TEMPLATE`): add one section, placed after `## Who decides` and before `## Your crew`, with exactly this text, line breaks included, byte for byte (in the `templates.ts` template literal the two backticks around `studio` are escaped as `` \` ``, as `kernel/src/agents/charter-tools.ts` does; the `brain.md` copy uses plain backticks; the new text contains no `${`):

   ```markdown
   ## Where the owner acts

   The owner works in the Studio app. When you tell the owner how to decide an
   approval or change a value, name the app's control: Approvals for a held call
   or an approval request; a playbook card's Set, Run now and Turn off; Team's
   inspector for a crew member. Mention a `studio` command only when the owner
   asks for the CLI.
   ```

   Copy the new `ROLE_TEMPLATE` verbatim into `docs/architecture/brain.md`'s `<!-- role-template:start -->` block (the companions rule: `.agent/companions.json` maps `kernel/src/brain/templates.ts` → `docs/architecture/brain.md` + `kernel/test/brain.test.ts`). Add a `brain.test.ts` test that pins the section in the form AC2 gives.
3. **Other model-read `studio` commands** (Scope 3): grep `kernel/src` for `studio ` inside text a model reads (tool results, tool errors and refusals, hold reasons, files an agent reads). Change only those inside the requirement's Touches (that is, only manager.ts's held text above). Record every other hit in a committed evidence file for a follow-up item (AC4). Launch Pad's grep at base found these candidates (the worker re-greps and classifies each; this list is a starting point, not the answer):
   - `kernel/src/approvals/tool.ts` — `messageFor`: `Approval ${id} is pending: the owner decides (studio approve ${id} once, or studio deny ${id}). ` (the `kernel_approval_request` tool result; model-read).
   - `kernel/src/playbooks/dry-run.ts` — `the owner sets it with studio playbooks set ${row.id} model <id>` (a dry-run refusal Wright reads; the likely source of the live run's "set one with `studio playbooks set 3 model <id>`").
   - `kernel/src/agents/charter-tools.ts` — `` (or with \`studio agents set\` for a scalar field, \`studio agents rename\` for the display name) `` (a charter-update refusal).
   - `kernel/src/playbooks/mirror.ts` — `the owner changes a playbook with \`studio playbooks set\` and turns it off with \`studio playbooks off\`` (the generated mirror file's header, a file an agent may Read).
   - `kernel/src/approvals/store.ts` (`Decide: studio approve ${id} once, or studio deny ${id}.`) and `kernel/src/playbooks/runs.ts` (`Turn it on with studio agents on ${e.agent}.`) — notification bodies; the worker records whether any model reads them.
   - CLI help, usage and stdout/stderr lines (`kernel/src/approvals/cli.ts`, `kernel/src/cli/index.ts`, `kernel/src/agents/roster.ts`, `kernel/src/playbooks/drafts.ts`, `kernel/src/brain/cli.ts`, …) are the owner's CLI output, not model-read; the evidence file says so in one line, without listing each.

Non-goal: removing or renaming any CLI command; the CLI stays for the owner.

## Acceptance Criteria

- [ ] **AC1 — held-call text.** Given a held call (the rail holds an allowed outward call as a pending approval), when the PreToolUse gate answers, then `permissionDecisionReason` contains `The owner decides in Studio's Approvals (approval <id>)` and contains no `studio approve` and no `studio deny`. Pinned in `kernel/test/approvals.test.ts` (the rail test that today asserts `toContain("studio approve 1 once")`), and the two whole-string `toBe` pins in `kernel/test/playbooks-dry-run.test.ts` (one kernel-applied, one repeat-once) are updated to the new text byte for byte.
- [ ] **AC2 — Wright's guidance pinned.** Given `ROLE_TEMPLATE` in `kernel/src/brain/templates.ts`, then a new test in `kernel/test/brain.test.ts`: (a) takes `section` = the slice of `ROLE_TEMPLATE` from `indexOf("## Where the owner acts")` (asserted `> -1`) to the next `"\n## "` after it, and `flat` = `section.replace(/\s+/g, " ")` (so the pins do not depend on the line wrap); (b) asserts `flat` contains `Approvals for a held call`, `Set, Run now and Turn off`, `Team's inspector` and ``Mention a `studio` command only when the owner asks for the CLI.``; (c) asserts `ROLE_TEMPLATE` contains no `studio approve`, `studio deny` or `studio playbooks`. The existing `docs/architecture/brain.md` doc==template test stays green with the doc block updated verbatim.
- [ ] **AC3 — the live rerun (owner, after merge).** Given the phase 5 live rerun, then Wright's replies in flows 2–3 contain no `studio` command. This is the owner's observation; the worker cannot verify it, and it is recorded in the evidence file (AC4) as "owner check at the phase 5 rerun", together with the prerequisite that the owner's existing `memory/wright/role.md` must carry the new section (the kernel never overwrites an existing `role.md`).
- [ ] **AC4 — Scope 3 follow-up list.** Then a committed evidence file `docs/evidence/phase-5-wright-app-guidance.md` contains the grep command used, every model-read `studio` command hit in `kernel/src` outside this item's Touches (file, the quoted text, who reads it, proposed app-control wording), the classification of the notification-body and CLI-output hits, and the AC3 rerun note; and the PR body links to it.
- [ ] **AC5 — validation.** `cd kernel && npm ci && npm run typecheck && npm test` passes, and `bash scripts/check-docs.sh` passes.

## File Impact Map

| File | Action | Confidence | Why |
|------|--------|------------|-----|
| `kernel/src/sessions/manager.ts` | modify | HIGH | The held reason string (`The owner decides (studio approve ${outcome.id} once, `). One string; nothing else. |
| `kernel/test/approvals.test.ts` | modify | HIGH | The rail test asserts `toContain("studio approve 1 once")`; replace with the AC1 pins. |
| `kernel/test/playbooks-dry-run.test.ts` | modify | HIGH | Two whole-string `toBe` pins of the held reason (`"approval_required: held as approval 1; it did not run. The owner decides (studio approve 1 once, or studio deny 1) and the decision arrives as a new message. "`). Not in the requirement's Touches; required for `npm test`. |
| `kernel/test/sessions.test.ts` | no change expected | HIGH | Pins only the prefix (`toMatch(/^approval_required: held as approval 1; it did not run\. /)`), which stays. Listed because the requirement's Touches name it; modify only if a pin breaks. |
| `kernel/src/brain/templates.ts` | modify | HIGH | Add the `## Where the owner acts` section to `ROLE_TEMPLATE`. |
| `docs/architecture/brain.md` | modify | HIGH | The `<!-- role-template:start -->` block must equal `ROLE_TEMPLATE` (pinned by `brain.test.ts`). |
| `kernel/test/brain.test.ts` | modify | HIGH | New AC2 pin beside the AC9 doc==template test. |
| `docs/evidence/phase-5-wright-app-guidance.md` | create | HIGH | AC4 evidence file (Markdown). |

Verified unchanged by this item: `kernel/test/sessions-boundary.test.ts`, `kernel/test/agents-charter-tools.test.ts` (`/^approval_required: held as approval 1; .*the kernel applies it itself .*do not repeat the call\.$/`), `kernel/test/playbooks-crew.test.ts`, `kernel/test/sessions-dry-run.test.ts` pin only the prefix or the `ifApproved` tail, both of which stay. `docs/architecture/approvals.md` describes the hold reason without quoting the CLI command, so it stays accurate.

### File Overlap Detection
Single subtask; no overlap.

## Touched-file invariants

> Grounded at base `e6233a9`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/manager.ts`** — keep: the prefix `approval_required: held as approval ${outcome.id}; it did not run.` and `End your turn now; if it is approved, ${ifApproved}`; keep the `ifApproved` branch `(KERNEL_APPLIED_ACTIONS as readonly string[]).includes(tool)` with both tails (`the kernel applies it itself and that message says what it did; do not repeat the call.` / `run exactly the same call again, once.`) untouched; keep `outcome.kind === "granted" ? "approval_granted"`. Change nothing else in the gate (one transaction, fail-closed `kernel_gate_error`). pinned by: `kernel/test/sessions.test.ts` and `kernel/test/sessions-boundary.test.ts` (`held as approval 1; it did not run\.`), `kernel/test/agents-charter-tools.test.ts` (`the kernel applies it itself .*do not repeat the call`), `kernel/test/playbooks-dry-run.test.ts` (`End your turn now; if it is approved, run exactly the same call again, once.`).
- **`kernel/src/brain/templates.ts`** — keep: `No imports: the \`studio\` CLI loads this module.` (no import added); keep every existing `ROLE_TEMPLATE` section and its text (`## How you act`, `## Who decides`, `## Your crew`, `## Untrusted text`, `## Memory`); keep the other four templates unchanged; the new section's backticks are escaped inside the template literal and it adds no `${`. mirror: `docs/architecture/brain.md` block between `<!-- role-template:start -->` and `<!-- role-template:end -->` must equal `ROLE_TEMPLATE` byte for byte (plus the trailing newline). pinned by: `kernel/test/brain.test.ts` (`shows role.md's first-run template verbatim (doc == templates.ts)`).
- **`kernel/test/approvals.test.ts`, `kernel/test/playbooks-dry-run.test.ts`, `kernel/test/brain.test.ts`** (test files sharing one rule: change only the pins this item names) — keep: in `approvals.test.ts` the rail test's prefix pin `toMatch(/^approval_required: held as approval 1; it did not run\. /)` stays, only the `toContain("studio approve 1 once")` line is replaced by the AC1 pins; in `playbooks-dry-run.test.ts` each `toBe` pin keeps its `+`-joined second half (`"End your turn now; if it is approved, the kernel applies it itself and that message says what it did; do not repeat the call."` and `"End your turn now; if it is approved, run exactly the same call again, once."`) and only the first half's `The owner decides (studio approve 1 once, or studio deny 1)` changes; in `brain.test.ts` the AC9 test `shows role.md's first-run template verbatim (doc == templates.ts)` stays unchanged, and the new AC2 test sits beside it importing `ROLE_TEMPLATE` the way the file already does.
- **`docs/architecture/brain.md`** — keep: the `<!-- role-template:start -->` / `<!-- role-template:end -->` markers and the ```` ```markdown ```` fence; every relative link still resolves (`scripts/check-docs.sh`). pinned by: `kernel/test/brain.test.ts` (`role-template:start`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/approvals.test.ts` — AC1: reason contains `Studio's Approvals (approval 1)`, no `studio approve` | flip `in Studio's Approvals (approval ${outcome.id})` → `(studio approve ${outcome.id} once, or studio deny ${outcome.id})` in `kernel/src/sessions/manager.ts` |
| `kernel/test/playbooks-dry-run.test.ts` — the two whole-string `toBe` held-reason pins | flip `in Studio's Approvals (approval ${outcome.id})` → `(studio approve ${outcome.id} once, or studio deny ${outcome.id})` in `kernel/src/sessions/manager.ts` |
| `kernel/test/brain.test.ts` — AC2(b): `flat` contains ``Mention a `studio` command only when the owner asks for the CLI.`` | delete `asks for the CLI.` in `kernel/src/brain/templates.ts` |
| `kernel/test/brain.test.ts` — AC2(b): `flat` contains `Set, Run now and Turn off` | delete `or an approval request; a playbook card's Set, Run now and Turn off; Team's` in `kernel/src/brain/templates.ts` |
| `kernel/test/brain.test.ts` — AC2(a): `indexOf("## Where the owner acts") > -1` | delete `## Where the owner acts` in `kernel/src/brain/templates.ts` |
| `kernel/test/brain.test.ts` — AC2(c): `ROLE_TEMPLATE` contains no `studio approve` | flip `command only when the owner` → `command such as studio approve only when the owner` in `kernel/src/brain/templates.ts` |

The mutation literals must each stay on one source line (do not split `in Studio's Approvals (approval ${outcome.id})` across a `+` concatenation; keep the section's line breaks exactly as written above, so `asks for the CLI.`, `## Where the owner acts`, `or an approval request; a playbook card's Set, Run now and Turn off; Team's` and `command only when the owner` each sit on one line), so `scripts/run-pin-mutations.sh` can apply them.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Held-call text and Wright's guidance point to the app; follow-up list | AC1, AC2, AC3 (note only), AC4, AC5 | 6 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/brain/templates.ts", name: "ROLE_TEMPLATE"}
  - {kind: "file", path: "docs/evidence/phase-5-wright-app-guidance.md"}
requires: []
lanes:
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/playbooks-dry-run.test.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/src/brain/templates.ts"
  - "kernel/test/brain.test.ts"
  - "docs/architecture/brain.md"
  - "docs/evidence/phase-5-wright-app-guidance.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
1 (no dependencies)

### File Overlap Matrix
Single subtask; none.

### Batch Plan
- single-agent (no fan-out): Batch 1 = subtask 1
- **Recommended workers:** 1

## Skill References
- `skills/unit-testing/SKILL.md` — vitest pins (`toBe` / `toContain` / `not.toContain`)

## Risk Assessment

| Risk | Severity | Source | Mitigation |
|------|----------|--------|------------|
| The owner's existing `~/.loomwright-studio/memory/wright/role.md` keeps the old text (written once, never overwritten — invariant 8), so the new guidance does not reach Wright in the rerun by itself. | HIGH | Feasibility (Phase 2.5) | Do not add any overwrite or migration (it would break invariant 8). The evidence file (AC4) and the PR body tell the owner to copy the `## Where the owner acts` section into their `role.md` (or remove it to regenerate) before the rerun. The held-call text needs no owner step. |
| AC3 is only verifiable by the owner in the live rerun. | MEDIUM | Feasibility (Phase 2.5) | Recorded as an owner check in the evidence file; not a worker gate. |
| Other model-read `studio` commands outside Touches (`tool.ts`'s `kernel_approval_request` result, `dry-run.ts`'s missing-model refusal, `charter-tools.ts`, `mirror.ts`) still teach Wright CLI commands, so the rerun may still show one. | MEDIUM | Requirement Scope 3 | Listed in the evidence file for a follow-up item; not changed here (Scope 3: "Change only those inside this item's Touches"). |
| `kernel/test/playbooks-dry-run.test.ts` is outside the requirement's Touches but pins the whole held string. | LOW | Analysis (Phase 3) | Included in the File Impact Map; only the two string literals change. |
| `manager.ts` is a kernel hotspot. | LOW | Requirement | One string; the Touched-file invariants keep everything else. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-wright-points-to-the-app-not-cli-commands.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-24T07:35:03Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/127
- **Branch:** feature/wright-points-to-the-app-not-cli-commands
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** The held-call reason now reads "The owner decides in Studio's Approvals (approval <id>)", and ROLE_TEMPLATE gains a "## Where the owner acts" section (mirrored in brain.md and pinned in brain.test.ts). The remaining model-read studio commands are listed in docs/evidence/phase-5-wright-app-guidance.md for a follow-up. Phase 4.5 code review: PASS on the first pass, with 1 LOW nit dismissed. All 6 pin mutations held (applied by the reviewer). Typecheck, 1975 tests and check-docs pass. Resumed via --continue after the earlier session parked at the finalize children check.

## Not verified
- **AC3 live rerun** — the owner checks this at the phase 5 rerun. The owner's existing role.md must carry the new section first. (subtask 1)
- **GitHub-rendered markdown of the evidence file** — not checked. (subtask 1)
