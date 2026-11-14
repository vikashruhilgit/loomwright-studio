# 21e — A dry run names the owner's missing grant instead of running a review that can't act

## Status: ready

**As** the owner of Loomwright Studio,
**I want** a poll playbook's dry run to tell me plainly when its crew member lacks a grant its jobs need, and not spend a session on a review that can't use those jobs,
**so that** I see the one real fix (a grant only I can give) instead of a confusing review that blames missing tools, and no tokens go on a preview that can't show anything.

## Why

Found 2026-11-14 during phase 8 item 21a's Validation 2 walk (kernel at `140076a6`, dry run 187 of playbook 9, Ticket Runner).
- The poll preview worked: one ClickUp task, `would run`.
- Then the dry run started its one review session (session 146, 103,932 tokens; phase 6 item 09). That session ran without `kernel_automate_prepare` and `kernel_automate_state`: both declare `requiresConnector: "github"`, `requiresConnectorLevel: "write"` (`kernel/src/automate/runner.ts`), and Ticket Runner holds no GitHub grant, so the tools are not offered.
- The session's own text, stored as the run's `final_text`, told the owner the tools "don't exist", that the working directory "is not a git repository" (a dry run's cwd is the member's memory dir by design, `dry-run.ts:451`), and to "grant this playbook's agent the automate tools and the capabilities tool". That points at the wrong fix and uses raw tool names.
- The kernel already knew the real cause before the session started. The same result's `fit.owner_steps` said: "Ticket Runner needs GitHub write access for Hand tickets to /automate; only you can grant it: Team → Ticket Runner's inspector."
- There is a precedent. A poll that can't be read because the member lacks the GitHub grant already starts no session and reports `preview_incomplete: needs_github` (`kernel/src/playbooks/dry-run-poll.ts:62`, `:174`).

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given a poll playbook whose member lacks a connector grant one of the playbook's jobs needs (a non-empty `fit.owner_steps`), when it is dry-run, then the poll preview still runs and lists its items as today, no review session starts, and the result's `poll.preview_incomplete` is a new reason, `owner_step_open`, added to `PREVIEW_INCOMPLETE_REASONS`.
- [ ] **AC2.** Given that dry run, then its summary and Wright's reply name the open owner step in plain words, taken from `fit.owner_steps` (for example "Ticket Runner needs GitHub write access for Hand tickets to /automate; only you can grant it: Team → Ticket Runner's inspector"), and say the review was skipped until then. No raw tool name, error token or file path is shown to the owner above the result's machine fields.
- [ ] **AC3.** Given that dry run, then it uses no session tokens (`tokens` 0 or null, as for `needs_github`), and the run is stored `done` with the preview, `fit` and the skip reason.

**Edge cases:**
- [ ] **AC4.** Given a playbook whose `fit` has only `refused_calls` that no grant can close (the D44 crew route, `closable: false`), then the review still runs as today: those calls are named as today and do not count as an open owner step.
- [ ] **AC5.** Given the owner grants the missing access, when the playbook is dry-run again, then the review session runs as today (phase 6 item 09).
- [ ] **AC6.** Given a Wright-owned playbook, or a playbook whose `fit` is `unchecked`, then behaviour is unchanged.

**Error scenarios:**
- [ ] **AC7.** Given a review session that does run and ends with text blaming missing tools, then the stored run still carries `fit` beside `final_text`, so the owner-facing summary is the kernel's, never only the session's.

## Non-goals
- Changing the dry run's cwd or its read-only tool set (phase 6 item 09).
- Rewording `needs_github`'s fix line, which names a settings file path (`dry-run-poll.ts:174`); a separate item if wanted.
- Granting anything: connector grants stay the owner's (AC8 of item 16; 21b covers granting in plain words).

## Owner decisions
- none recorded

## Priority: MVP
**Rationale:** The phase 8 exit re-run dry-runs ticket playbooks before granting GitHub write; today each such dry run spends about 100k tokens and shows a misleading cause.

## Assumptions
- `playbookFit` is available before the session starts (the dry run already calls it for `refused`, `dry-run.ts:472`).
- `fit.owner_steps` lists only grants the jobs' tools need or the poll source needs (`fit.ts` `grantNeeds`); a poll-source grant gap is already caught earlier by `needs_github` or `connector_missing`.

## Dependencies
- Depends on: none.
- Related: 21b (crew grants in plain words) makes the owner step easier to take; this item only names it.

## Risks
- `PREVIEW_INCOMPLETE_REASONS` is a frozen list that tests pin (`kernel/test/playbooks-dry-run-poll.test.ts`, `kernel/test/playbooks-dry-run-poll-unit.test.ts`); adding a value changes that contract and the dry-run tool's description.

## Success Metrics
- A dry run of a ticket playbook for a member without GitHub write uses 0 session tokens and names the GitHub grant as the owner's step.

## Handoff
Ready for: `/launch-pad goal: ".supervisor/requirements/phase-8-21/2026-11-14-120300-e-a-dry-run-names-the-owner-step-instead-of-a-review-that-cannot-act.md"`

## Validation (must pass before merge)
1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm test`, with `kernel/test/playbooks-dry-run-poll.test.ts` and `kernel/test/playbooks-dry-run-poll-unit.test.ts` covering AC1 to AC7; `bash scripts/check-docs.sh`.
2. **Running system — a dry run with an open owner step:** in the packaged app with the kernel installed from the PR head, dry-run a ClickUp ticket playbook whose crew member has ClickUp access but no GitHub write. The poll preview lists the task, no review session starts (0 tokens), and Wright's reply names the GitHub grant as your step in Team. Record it in `docs/evidence/phase-8-21e-dry-run-owner-step.md` with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
kernel/src/playbooks/dry-run.ts
kernel/src/playbooks/dry-run-poll.ts
kernel/test/playbooks-dry-run-poll.test.ts
kernel/test/playbooks-dry-run-poll-unit.test.ts
docs/architecture/dry-run.md
docs/evidence/phase-8-21e-dry-run-owner-step.md
