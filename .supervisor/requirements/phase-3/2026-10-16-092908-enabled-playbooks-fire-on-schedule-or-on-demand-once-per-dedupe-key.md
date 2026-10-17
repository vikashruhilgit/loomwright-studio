# 08 — Enabled playbooks fire on schedule or on demand, run under their own policy, and skip work their dedupe key says is done

## Status: ready

**Priority:** MVP · ROADMAP phase 3 exit · ARCHITECTURE main loop step 3 ("checks the playbook's dedupe key against past work … and drops duplicates") · invariants 1, 2 · D4

**As** the owner,
**I want** an enabled playbook to wake Wright on its schedule (or when I say "run now") with the model, priority and limits I set, and to skip work its dedupe key says was already done,
**so that** recurring work happens on time, the way I configured it, and never twice.

## Problem

A linked trigger (item 07) has nowhere to go: triggers fire `notify` or `wake_agent` with stored text only. Sessions never carry a playbook's model or id, and no dedupe-key check exists.

## Owner decisions (2026-10-16, binding)

- **Dry run = a read-only agent run.** The owning agent runs the playbook once in a dry-run session: read-only tools work, and every outward or persistent tool call is denied by the kernel and recorded as "would do". The result (what it would do, what the dedupe key would skip, next fire times, tokens used) is stored and shown. Tokens count against limits.
- **Storage = SQLite + a markdown mirror.** The kernel's `playbooks` table is the source of truth. A read-only markdown copy under the data dir (`memory/playbooks/<slug>.md`) is rewritten on every change so the owner can read it (invariant 8).
- **Enabling = Wright requests, the owner approves once.** Wright drafts and dry-runs, then calls `kernel_playbook_enable`, which the approval gate always holds; the owner approves or denies it in `studio approvals`, which shows the dry run. Enable is refused unless the playbook's current version has a dry run. Any edit makes a new version and returns the playbook to draft (a new dry run and a new approval). This keeps D3 and invariant 3 as they are.
- **What starts a playbook:** the existing `once` / `cron` triggers, linked to the playbook, plus a manual "run now" by the owner. Event triggers (a new PR, a ticket) wait for connectors (phase 6).
- **What a fire does:** it wakes the owning agent (Wright in phase 3; crew is phase 4) with the playbook's intent as its instruction, under the playbook's model, priority, approvals and limits.
- **Priority = `low` / `normal` / `high`.** Pending events run high first, then normal, then low; oldest first within a level.
- **In phase 3:** priority ordering, "always allow" per playbook, per-playbook token limits, and the per-playbook API-key fallback (D28).
- **Policy is the user's (invariant 1, D4).** Every policy field (dedupe key, priority, model, token limit, fallback) records who set it: `wright` (shown as "proposed") or `owner`. No playbook ships preinstalled.

## Scope

1. **Firing** (triggers): a trigger with a playbook enqueues a `message` event for the owning agent with payload `{playbook, version, trigger_id, scheduled_at}`, the playbook's priority (item 04's `enqueueEvent` option, or the column directly if item 04 has not merged; both read the same column), and `sourceRef` `playbook:<id>:<scheduled_at>`. A disabled or draft playbook's trigger does not fire (recorded as skipped). Unlinked triggers are unchanged.
2. **Run now:** `studio playbooks run <id>` (the owner's verb, via item 01's seam, in `runs.ts`) and its route enqueue the same event with `scheduled_at` = now; refused for a draft or disabled playbook.
3. **Dedupe** (`runs.ts`): before the session starts, evaluate the playbook's dedupe-key spec over the closed field list (item 01) for this event; if a `fire` / `run_now` run of this playbook with the same key ended `done`, record a `skipped_duplicate` run and start nothing. No spec ⇒ no dedupe.
4. **The session** (brain handler): a playbook event starts the owning agent with the playbook's intent (the version named in the event) as the instruction, the playbook's model (never the agent's default), and `sessions.playbook` / `playbook_version` set, so items 05 and 06 apply. A `playbook_runs` row of kind `fire` / `run_now` records session, key, status and tokens.
5. Doc page `docs/architecture/playbook-runs.md`; `docs/architecture/triggers.md` (linked triggers) and `brain.md` (playbook messages) updated outside the pinned template block.

## Non-goals

- Event triggers from connectors (phase 6). Crew agents (phase 4): only `wright` is routed.

## Acceptance criteria

- [ ] Given an enabled playbook with a cron trigger, when the instant comes, then one `message` event with the playbook payload and the playbook's priority is queued, and the brain starts a session with the playbook's model and `sessions.playbook` set.
- [ ] Given a draft or disabled playbook, when its trigger comes due, then nothing is queued and the skip is recorded.
- [ ] Given a dedupe spec `{date}` and a run that ended `done` today, when it fires again today, then a `skipped_duplicate` run is recorded and no session starts; tomorrow it runs.
- [ ] Given `studio playbooks run <id>` on an enabled playbook, when run, then one event is queued with `scheduled_at` = now; on a draft, it is refused.
- [ ] Given a crash after the event is queued and before the session starts, when the kernel restarts, then the playbook runs at most once for that instant (phase 1 `sourceRef` and work-step rules).
- [ ] Given an unlinked phase 2 trigger, when it fires, then behaviour is unchanged (existing triggers tests pass).
- [ ] Tests in `kernel/test/playbooks-runs.test.ts` (stand-in Wright, injected clock).

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- "Done" for dedupe means the run's session ended normally (`kernel_request_stop` or a normal end); a failed or parked run does not count.

## Risks

- Brain handler changes must keep `studio ask` behaviour identical (existing brain tests pass).

## Depends on
2026-10-16-092902-wright-drafts-playbooks-the-owner-reads-changes-and-turns-off.md

## Touches
kernel/src/playbooks/runs.ts
kernel/src/triggers/store.ts
kernel/src/brain/handler.ts
kernel/test/playbooks-runs.test.ts
docs/architecture/playbook-runs.md
docs/architecture/triggers.md
docs/architecture/brain.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-17T05:59:54Z
- **Brief:** .supervisor/jobs/done/2026-10-17-playbooks-fire-run-now-dedupe.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/73
