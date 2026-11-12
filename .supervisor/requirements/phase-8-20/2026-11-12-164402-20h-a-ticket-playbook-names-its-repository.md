# 20h — A ClickUp or Jira ticket playbook names its repository

**As** the owner, **I want** a ClickUp ticket playbook to know which repository its PRs go to, **so that** its runs get a token for that repo and are not refused `no_repos`.

## Why

the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): the runbook's precondition says a `clickup.tasks` poll names no repository, so the playbook must first link a `github.pulls` poll that does. Wright reported "the kernel allows one poll per playbook, so the ClickUp poll replaced the PR poll on the same link rather than sitting beside it". The layout the runbook, `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` describe cannot be built through Wright.

## Acceptance Criteria
- [ ] AC1: A ticket playbook whose poll names no repository carries its target repository itself (one owner-visible field), and the session token is minted for it.
- [ ] AC2: The runbook's "Known preconditions" and both exit walks use that field; the two-poll workaround is removed.
- [ ] AC3: A ClickUp playbook with no target repository is refused at enable with a plain reason, not at run time.

## Validation (must pass before merge)
1. **Static:** `cd kernel && npm test`; the phase 8 e2e walk.

## Depends on
none

## Touches
kernel/src/playbooks/store.ts
kernel/src/playbooks/drafts.ts
kernel/src/triggers/poll.ts
docs/architecture/playbooks.md
docs/evidence/phase-8-exit-runbook.md
