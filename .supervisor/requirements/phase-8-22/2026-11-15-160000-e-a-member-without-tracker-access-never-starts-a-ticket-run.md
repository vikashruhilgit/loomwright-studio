# 22e — A crew member without tracker access never starts a ticket run, and the enable card says why

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/284

**Ready (2026-11-15):** PR #283 merged (`48de35ff`), so `pollGrantOwnerSteps` is on `main`. Every line cited below was re-checked on `main` `787c00f6` (after #282 and #283) and is unchanged.

**As** the owner of Loomwright Studio,
**I want** a crew member's ClickUp or Jira ticket run to park, not start, when the member can't read that tracker, and the enable card to name that missing access on its own line,
**so that** an enabled playbook never spends the member's tokens on sessions that can't read the ticket, and I see the step that's mine before I approve the enable.

## Why

PR #283's review drain (phase 8 item 22a, 2026-11-15) fixed this gap for the dry run only. Neither the enable nor real runs check it.

**Real runs: reproduced by test.** Real runs check access only for GitHub items. `runs.ts:450-456` calls `needsGithub` only when `isGithubItem(e.item)` (`items.ts:126`), and `items.ts:19` says it outright: "A Jira or ClickUp item is not a GitHub item ..., so it never parks `needs_github`". Nothing parks a ticket item for a missing tracker grant. A throwaway vitest case on `main` `1949901e` (in `kernel/test/playbooks-runs-items.test.ts`'s harness, not committed) set up crew member `mason` with no `connectors` and an enabled playbook keyed `[playbook.id, item.id, item.revision]`, then queued two revisions of a `clickup:` item, one `jira:` item and one `github:` item. Result: the three ticket items each started a session and ended `done`, and only the GitHub item parked. So an enabled playbook starts one session per new ticket or revision under that key (not one per poll, since a `done` run dedupes). Each session's tracker calls are refused, because a crew session gets only the tools its member holds. That claim comes from the code and #283's own reasoning; no real run has been observed. For cost: the 22a walk's run 192 was a dry-run review for a member without ClickUp access and spent 50,752 tokens. It was not a real run, and real-run cost hasn't been measured.

**The enable card: read from code.** `charterLines` returns nothing for a `no_jobs` fit (`enable.ts:290`), and its `owner step:` lines come only from `fit.owner_steps` (`enable.ts:293`). `playbookFit` sets that to `[]` for `no_jobs` before it reads any grant (`fit.ts:258`). So a `no_jobs` card never has an `owner step:` line. After #283 the card does carry the step in one place: inside its `dry run: <summary>` line (`enable.ts:318`). That works because the stored summary of an `owner_step_open` dry run says "until the owner takes this step: <step>" (`dry-run-poll.ts:447`). But that text is frozen at dry-run time. A grant removed after the dry run leaves the card silent. A grant added after it leaves the card naming a step that's already done. And a playbook with jobs gets the same step as its own `owner step:` line. This half is a consistency and staleness fix, not a bug proven by a run.

The kernel adds the mechanism: a park and a display line built from the member's current grant. The owner keeps the policy: whether to grant access and whether to enable anyway. A tracker grant stays the owner's to give. Kernel text names it as the owner's step and never proposes it (`kernel_agent_update` can't carry a connector grant).

## Acceptance Criteria

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

## Non-goals

- A missing, expired or disconnected Jira or ClickUp *connection* on a real run (the dry run's `connector_missing`). If Launch Pad finds no real-run handling for it, it is filed as its own item, not folded in here.
- Letting a dry-run review session read a ticket's body (22a's Finding 1: its read-only tool set admits no `kernel_mcp_r_*` proxy).
- Gating the enable on the grant, or changing `playbookFit`'s stored `no_jobs` fit.
- Wright's own playbooks. `pollGrantOwnerSteps` returns nothing for them, and this item keeps that.

## Owner decisions

none recorded

## Priority: Phase 1

**Rationale:** an enabled ticket playbook for a member without tracker access spends that member's daily token limit on sessions that can't do the work, and the owner gets no notice. The enable card is the owner's last look before that happens.

## Assumptions

- The park reason's name (for example `needs_tracker`) and its `result_json` fields are Launch Pad's call. They should mirror `needs_github`'s `{reason, missing, ...}` shape so the run docs read the same.
- The tracker read need for an item can be found from the playbook's linked poll trigger (`grantNeeds`) or from the item's ref prefix. Either works if AC1's rule matches the dry run's.

## Dependencies

- Depends on: none (PR #283, which adds `pollGrantOwnerSteps`, merged as `48de35ff`).

## Risks

- An existing run test may assert that a ticket item of a member with no grant starts. That expectation changes on purpose, and the test should say so.
- Outage bookkeeping is shared with `needs_github`. A tracker park and a GitHub park of the same playbook must not end or merge each other's outage.

## Success Metrics

- AC1 to AC9 are pinned by tests. At least one AC1 case fails on today's `main`: the throwaway repro above turned into a committed test.

## Handoff

- `/automate --folder .supervisor/requirements/phase-8-22` (this item is `ready`).

## Validation (must pass before merge)
1. **Static (kernel suite and docs):** run `cd kernel && npm ci && npm test` with new cases in `kernel/test/playbooks-runs-items.test.ts` (AC1 to AC3, AC6, AC7) and `kernel/test/playbooks-fit.test.ts` (AC4, AC5, AC8). At least one AC1 case must fail without the change. Then run `bash scripts/check-docs.sh`.

## Depends on
none

## Touches
kernel/src/playbooks/items.ts
kernel/src/playbooks/runs.ts
kernel/src/playbooks/enable.ts
kernel/src/playbooks/fit.ts
kernel/test/playbooks-runs-items.test.ts
kernel/test/playbooks-fit.test.ts
docs/architecture/playbook-runs.md
docs/architecture/playbooks.md
docs/architecture/mcp-connectors.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-15T17:08:20Z
- **Brief:** .supervisor/jobs/done/2026-11-15-member-without-tracker-access-parks.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/284
