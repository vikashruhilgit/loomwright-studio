# 18b — A charter is checked ready before the owner sees it: every duty covered, every job able to run

## Status: ready

**Priority:** MVP · needed for item 16's Validation 2 to pass · D3, D22, D34, invariants 1, 3, 9

**As** the owner,
**I want** the kernel to check every charter Wright drafts — that each duty I asked for has a job that does it, and that each job has what it needs to run — and show me the result on the card before I decide,
**so that** I never approve a crew member that silently can't do part of the work, and I don't need to read code to find out.

## Problem

Found in the item 16 Validation 2 walk, 2026-11-10 (packaged app, #253 + #254, approvals #18 and #19). The owner asked Wright for "a developer for vikashruhilgit/studio-sandbox that turns tickets into PRs, triages PR comments and asks for merges". Twice, Wright drafted a charter whose **duties** named all four asks but whose **jobs** were only "Hand tickets to /automate" and "Read a PR":

- "Triage PR comments" and "Ask for a merge" were missing, though #254's catalogue has tools for both (`kernel/src/integrations/github/write-tools.ts:98,112,140`, `kernel/src/automate/routing.ts:167`, `kernel/src/automate/runner.ts:194,213`). The role text even promised replies to comments while the never list blocked `gh_issue_comment`.
- `workspaces: none`, so the one code job it had is refused `no_workspace` at run time (`kernel/src/automate/runner.ts:21-25`).

Item 16 gave Wright the catalogue (AC2) and checks a **playbook**'s fit (AC4), but nothing checks a **charter** against its own duties, and nothing checks that a job's prerequisites exist. Wright's choice of jobs is a model's choice; the check must be the kernel's.

## Scope

**Part A — every duty names its jobs.** A charter's duties each name the catalogue job or jobs that carry them out, or say none is needed (a duty such as "keep reports short" needs no kernel tool). The kernel refuses a create or update whose duty names an unknown job, and finds every duty whose named job the charter does not grant.

**Part B — every job can run.** For each job the charter grants, the kernel checks, read-only, what it needs: a job that works on code (today: "Hand tickets to /automate", "Triage PR comments", "Ask for a merge") needs a workspace whose git remote names the repo (the existing remote parse in `kernel/src/automate/checkout.ts`), outside macOS-protected folders (D31, `kernel/src/protected-paths.ts`); a job whose tools need a connector needs that connector granted. Which jobs need what is declared once with the job, not in a second list.

**Part C — the result is on the card, in plain words.** The held create or update's display carries a readiness block ahead of the raw lines: one line per duty (covered, or "no job covers this") and one per job prerequisite (ready, or what is missing). The Approvals screen's plain view (`CharterDisplay.tsx`) shows it in the plain section using the design system's existing warning style. When anything is uncovered or missing, Wright says so in the thread and proposes the fix: the missing job added, or the owner asked for the workspace.

## Acceptance criteria

**Happy path**

- **AC1.** Given a charter whose every duty names jobs the charter grants, and whose every job's prerequisites exist, when it is held for the owner, then the card's readiness block shows every duty covered and every job ready, and nothing is flagged.
- **AC2.** Given the walk's request drafted as approval #19's charter (duties: tickets to PRs, triage comments, ask for merges; jobs: automate and read a PR), when it is held, then the card flags "Triage PR comments" and "Ask for a merge" as not covered, names them in plain words, and Wright proposes adding exactly those jobs. Kernel test on this exact charter.
- **AC3.** Given a granted code job and no workspace whose remote names the repo, when the charter is held, then the card says the member has no copy of the repo to work in, in plain words, and Wright asks the owner where it is.
- **AC4.** Given a duty marked as needing no job, when the charter is held, then it shows as covered with no tool.

**Edge cases**

- **AC5.** Given a workspace inside a macOS-protected folder (D31), when the charter is checked, then the card says why that folder can't be used, never "ready".
- **AC6.** Given a job whose tools need a connector the member lacks, when the charter is checked, then the card names the connector as the owner's step (item 16 AC8: connector grants stay owner-only), and Wright does not propose it in the charter.
- **AC7.** Given a charter update that removes a job a duty still names, when it is held, then the card flags that duty.
- **AC8.** Given the owner approves a charter with a flag still open, when it is approved, then the approval records that the owner chose to proceed with the named flags open.

**Error scenarios**

- **AC9.** Given a duty naming a job outside the catalogue, when the create or update is requested, then it is refused with a message naming the unknown job; nothing is held.
- **AC10.** Given a check that cannot run (settings unreadable, workspace path unreadable), when the card is shown, then it says which check did not run and why, never "ready".
- **AC11.** Untrusted text (tickets, PR comments) never adds a duty or a job (invariant 3).

## Non-goals

- A playbook's fit check (item 16 AC4, done).
- Saved workspaces and the workspace picker (18c, 18d).
- The compact card, copy and full-text work (18d).
- Running any job or session as part of the check: it reads settings, files and git config only.
- Pinning in CI which jobs a real model picks (proven live, Validation 2).

## Owner decisions

- 2026-11-10: the owner must be able to find a missing job or prerequisite from the card, without reading code; the app suggests the fix.
- 2026-11-10: code-related jobs need a workspace; when Wright can't identify the repo's workspace it asks the owner.
- 2026-11-10: a readiness check (dry run) runs automatically, especially for a new kind of setup.
- 2026-11-10: this is the must-have for item 16 (#254) to pass Validation 2; the rest of the set is follow-up.

## Assumptions

- Proposed form (open for the owner to change in review): a charter's `duties` become entries `{ text, jobs }`, `jobs` being catalogue job ids, empty for a duty needing no kernel tool; a bare-string duty is refused with a message telling Wright to name its jobs. Existing members' `role.md` files are not rewritten.
- "Which jobs need a workspace or connector" is declared beside the job in the catalogue (`kernel/src/features/catalogue.ts`), keeping one source (item 16's AC1 rule).
- The readiness block fits the part of the display the owner must see whole; if not, the hold is refused as item 16's head check does.

## Dependencies

- Depends on: item 16 (`../phase-8-16/2026-11-09-160016-wright-drafts-charters-that-cover-the-work.md`, PR #254): this builds on its catalogue and card.
- Blocks: item 16's Validation 2 passing, and item 14's live run from setup step 6.

## Risks

- Wright may mark a real duty "no job needed" to avoid a flag. Mitigation: the card shows that line to the owner as "covered with no tool", where it is easy to question.
- A workspace that is ready at drafting time can move later. Mitigation: the run-time `no_workspace` refusal stays; this check is the early warning, not the only one.

## Touches

kernel/src/agents/charter-tools.ts
kernel/src/agents/charter-files.ts
kernel/src/features/catalogue.ts
kernel/src/automate/checkout.ts
kernel/src/protected-paths.ts
kernel/test/agents-charter-tools.test.ts
app/src/screens/approvals/subject.ts
app/src/screens/approvals/subject.test.ts
app/src/screens/approvals/CharterDisplay.tsx
app/src/screens/approvals/CharterDisplay.test.tsx
docs/architecture/agents.md

## Validation (must pass before merge)

1. **Static — kernel and app suites:** `cd kernel && npm ci && npm run typecheck && npm test` (AC1 to AC11; AC2 on approval #19's exact charter), `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh`.
2. **Running system — the walk's request no longer drafts a broken member unnoticed:** in the packaged app, the owner asks Wright for "a developer for vikashruhilgit/studio-sandbox that turns tickets into PRs, triages PR comments and asks for merges". The held card either lists all four jobs as covered and ready, or flags in plain words what is missing (a job, the workspace) and Wright proposes the fix in the thread. The owner reports what the card showed.

## Depends on

../phase-8-16/2026-11-09-160016-wright-drafts-charters-that-cover-the-work.md
