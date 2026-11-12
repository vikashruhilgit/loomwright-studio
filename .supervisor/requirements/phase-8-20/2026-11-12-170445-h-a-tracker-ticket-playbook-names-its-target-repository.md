# 20h — A ClickUp or Jira ticket playbook names its target repository

**As** the owner of Loomwright Studio,
**I want** a ClickUp ticket playbook to know which repository its PRs go to,
**so that** its runs get a token for that repo and are not refused `no_repos`.

## Why

**What the runbook assumed:** a `clickup.tasks` poll names no repository, so the playbook must first link a `github.pulls` poll that does.

**What happened** in the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129): Wright reported "the kernel allows one poll per playbook, so the ClickUp poll replaced the PR poll on the same link rather than sitting beside it". The layout described by the runbook, `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` can't be built through Wright.

## Acceptance Criteria

**Happy path:**
- [ ] Given a ticket playbook whose poll names no repository, when Wright drafts it, then it carries its target repository as one owner-visible field, and its runs' session token is minted for that repository.
- [ ] Given that field, then the runbook's "Known preconditions" and both exit walks use it, and the two-poll workaround is removed.

**Error scenarios:**
- [ ] Given a ClickUp or Jira ticket playbook with no target repository, when its enable is requested, then it is refused with a plain reason, not at run time.
- [ ] Given a target repository the GitHub App does not reach, then the enable is refused naming it.

## Non-goals
- More than one poll per playbook.
- Reading ClickUp (20g).

## Owner decisions
none recorded

## Priority: MVP
**Rationale:** The walk's ClickUp ticket cannot reach a PR without it.

## Assumptions
- A playbook field (stored with the playbook's version) is enough; no new trigger kind is needed.

## Dependencies
- Depends on: none

## Risks
- The field is a contract change for the playbook API and the drafting tool; both are updated here, with their tests.

## Validation (must pass before merge)
1. **Static — kernel suite and exit e2e:** `cd kernel && npm test`; `app/e2e/phase-8-exit.spec.ts` with the field instead of the second poll.

## Depends on
none

## Touches
kernel/src/playbooks/store.ts
kernel/src/playbooks/drafts.ts
kernel/src/triggers/poll.ts
kernel/test/playbooks-drafts-poll.test.ts
docs/architecture/playbooks.md
