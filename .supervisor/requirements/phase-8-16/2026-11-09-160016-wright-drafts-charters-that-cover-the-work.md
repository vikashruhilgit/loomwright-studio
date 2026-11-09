# 16 — Wright drafts charters that cover the work, without the owner naming a tool

## Status: ready

**Priority:** MVP · ROADMAP phase 8 (blocks item 14's live run at setup step 6) · D22, D34, invariants 1, 3, 9

**As** the owner,
**I want** to tell Wright in plain words what a crew member should do and get a charter whose tools match that work, shown to me in plain language,
**so that** I can approve a crew member that works without ever learning, typing or pasting a kernel tool name.

## Problem

Found in the phase 8 live run, 2026-11-09, setup step 6. The owner asked Wright for "a developer for vikashruhilgit/studio-sandbox" that turns tickets into PRs, triages PR comments and asks for merges. Wright drafted a charter with only the four read-only `kernel_github_pr_*` tools. The playbooks in the walk call nine others: `kernel_automate_prepare`, `kernel_automate_state`, `kernel_automate_merge_check`, `kernel_merge_approval_request`, `kernel_pr_route`, `kernel_github_pr_comments`, `kernel_github_pr_reply`, `kernel_github_pr_comment` and `kernel_github_pr_request_reviewers` (see `kernel/test/phase-8-exit.test.ts:148`). The only fix on offer was for the owner to paste those names into Chat, which the owner rejected: no user can be expected to do that.

Root cause:

- **Wright drafts blind.** The `kernel_agent_create` description (`kernel/src/agents/charter-tools.ts:306`) gives the charter's shape and nothing about which kernel tools exist or what each is for. How a session uses the tools for tickets to PRs is written in `kernel/src/brain/templates.ts`, which working sessions read and Wright never reads at drafting time.
- **Nothing checks the fit.** A playbook can be drafted, dry-run and enabled for a crew member that lacks tools the playbook's run will call (`kernel/src/playbooks/drafts.ts` never reads the agent's `tool_policy`). The gap surfaces only mid-run, as refused calls.
- **The card shows raw names.** The approval card's `enforced:` line (`enforcedLine`, `charter-tools.ts:187`) lists `mcp__kernel__…` names, which the owner can't judge.
- **CI never covers it.** The phase 8 walk builds its crew member from a hard-coded charter, never a Wright draft.

`kernel_agent_update` (Wright only, always held) can already change a member's `tool_policy` after creation. The fix has a mechanism to use; what's missing is knowledge and a check.

## Scope

**Part A — the catalogue and drafting.**

1. **The kernel publishes a catalogue of the tools a crew session can be granted.** Each tool has one plain-language purpose line and the job it belongs to (for example "hand tickets to /automate", "triage PR comments", "ask for a merge", "read a PR"). The catalogue is generated from the tools as registered (the phase 1 tools and every feature's contributed tools), so a new tool can't be missed: the purpose comes from the tool's own registered description and the job from the feature that contributes it (one source, no second list to keep in step). A registered tool with no purpose or job fails a test. This is mechanism only (invariant 1). It is not a preset: nothing assigns a job to a member.
2. **Wright reads the catalogue when drafting a charter or a charter change**, through its drafting tools' context or a read tool. It maps the owner's words to the jobs the work needs. Which tools fill a job is the catalogue's to say; which jobs the member gets is Wright's proposal and the owner's call (D22, invariant 9).
3. **The approval card says it in plain language, as the merged mockup `docs/design/mockups/chat-threads.html` (item 17a) shows (D9).** The charter card (create and update) lists the granted kernel tools grouped by job, with their purpose lines, before any raw name. The raw `enforced:` names stay available beneath, never instead of the plain text. Non-kernel tools (`Read`, `Bash` and the like) and Bash prefixes are shown as they are today.

**Part B — the fit check.**

4. **A playbook whose run needs a tool its crew member lacks is caught before it's enabled.** When Wright drafts or dry-runs a playbook for a member, the kernel finds the tools the playbook's run needs that the member's `tool_policy` doesn't allow. The owner sees the gap in plain language, and Wright proposes the charter change through `kernel_agent_update` in the same flow, held for the owner, not discovered as refused calls mid-run. How the kernel learns what a run needs is the design's call; candidates are a dry run's policy refusals, or the playbook naming the catalogue jobs it uses. It must not depend on the owner typing anything technical.

## Acceptance criteria

**Happy path**

- **AC1.** Given the kernel is running, when the catalogue is read, then every tool a crew session can be granted appears exactly once, with a non-empty purpose and a job. A test enumerates the registered tools (phase 1 and contributed) and fails on any tool missing from the catalogue or lacking a purpose or job.
- **AC2.** Given Wright is asked to draft a charter, when its drafting context is assembled, then the catalogue (jobs, tools, purposes) is in it. A test pins this on the tool description or the read tool Wright is given.
- **AC3.** Given a held charter create or update, when the owner opens its approval card, then the granted kernel tools are shown grouped by job with their purpose lines, ahead of any `mcp__kernel__…` name. Kernel test on the card text, plus an app test on the rendered card.
- **AC4.** Given a crew member whose `tool_policy` lacks a tool a playbook's run needs, when Wright drafts or dry-runs that playbook for it, then the owner is shown which job is missing in plain words, and a `kernel_agent_update` proposal adding exactly the missing tools is held for the owner. The playbook can't be enabled for that member until the gap is closed or the owner chooses to enable it anyway; that choice is recorded.
- **AC5.** Given the phase 8 walk's four playbooks (GitHub tickets, ClickUp tickets, triage, merge when ready) and a member holding only the four read-only `kernel_github_pr_*` tools, when the fit check runs, then it names exactly the missing tools the walk's crew charter (`phase-8-exit.test.ts:148`) adds. Given the full walk charter, it names none.

**Edge cases**

- **AC6.** Given a tool with no job (a phase 1 tool such as `kernel_task_list`), when the catalogue is built, then the tool still appears, under a general job, never dropped.
- **AC7.** Given the owner approves a charter Wright drafted with fewer jobs than the playbooks later need, when Wright drafts the playbook, then AC4's flow closes the gap. No member is recreated and no file is hand-edited.
- **AC8.** Given a connector grant (GitHub write, ClickUp tools), when the fit check runs, then the grant is not proposed in a charter change. It stays owner-only on Team → inspector (`app/src/screens/team/Connectors.tsx`), and the check names it as the owner's step in plain words.

**Error scenarios**

- **AC9.** Given a catalogue read that fails, when Wright drafts, then it says it can't see the kernel's tools and drafts nothing that pretends otherwise. It never guesses a tool list.
- **AC10.** Untrusted text (a ticket, a PR comment) never adds a tool to a proposal. Only the owner's words in Chat and the catalogue feed Wright's draft (invariant 3).

## Non-goals

- Role presets or stock charters (D22, invariant 9). The catalogue groups tools by job; it never defines a member.
- Changing connector grants' owner-only rule or their UI.
- Making `studio agents set` edit `tool_policy`. Charter changes stay Wright-proposed and owner-approved through `kernel_agent_update`.
- Pinning a real model's drafting choices in CI (see Assumptions).
- Wright's chat losing an earlier proposal across sessions. That is a separate item.
- The live run itself (item 14, the owner).

## Owner decisions

- 2026-11-09: the owner must never paste, type or name a kernel tool, JSON or CLI to get a working crew member. A step that needs it is a product gap, not an instruction.
- 2026-11-09: the charter card's design goes into item 17a's mockup; this item builds the card as that merged mockup shows.
- 2026-11-09: write this as phase 8 item 16 through /loomwright:product-owner. It blocks resuming the live run at setup step 6.

## Assumptions

- A CI test can't pin which jobs a real model picks from a sentence. CI pins the catalogue's completeness (AC1), its presence in Wright's context (AC2), the card (AC3) and the fit check (AC4, AC5). The model's choice is proven live (Validation 2).
- The tools a crew session can be granted are exactly the registered kernel tools (phase 1 plus contributed) plus the SDK's own tools. The catalogue covers the kernel's; the SDK's are shown by name as today.

## Dependencies

- Depends on: 03 and 04 (merged), item 15 (merged), and item 17a's merged mockup for the card (D9).
- Blocks: item 14's live run, from setup step 6.

## Risks

- A fit check based on a dry run's refusals misses a tool the dry run never reached (a branch not taken). Mitigation: let the playbook name its jobs, or accept the dry run's limit and say so on the card.
- Catalogue job names drift from what Wright's brain templates say. Mitigation: AC1's test, and one source for the purpose text.

## Touches

kernel/src/agents/charter-tools.ts
kernel/src/agents/index.ts
kernel/src/features/contribution.ts
kernel/src/tools/server.ts
kernel/src/playbooks/drafts.ts
kernel/src/playbooks/dry-run.ts
kernel/src/playbooks/enable.ts
kernel/src/brain/templates.ts
kernel/test/agents-charter-tools.test.ts
kernel/test/playbooks-dry-run.test.ts
app/src/screens/approvals/subject.ts
app/src/screens/approvals/subject.test.ts
docs/architecture/agents.md
docs/architecture/playbooks.md
docs/evidence/phase-8-exit-runbook.md

## Validation (must pass before merge)

1. **Static — kernel and app suites:** `cd kernel && npm ci && npm run typecheck && npm test` (AC1 to AC10), `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` (AC3's card; item 14's app walk still passes), and `bash scripts/check-docs.sh`.
2. **Running system — Wright drafts a working developer from a plain sentence:** in the packaged app, the owner asks Wright in Chat for "a developer for vikashruhilgit/studio-sandbox that turns tickets into PRs, triages PR comments and asks for merges". The held charter card lists the needed jobs in plain language, and the owner approves it without typing a tool name. Drafting the walk's playbooks then shows no gap, or closes one through AC4's held proposal. The owner reports what the card showed.

## Depends on

../phase-8-17/2026-11-09-160017-the-thread-continuity-mockup.md

## Verify

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`
