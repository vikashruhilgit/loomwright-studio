# 22 — A notification click opens the app on what it names, not Terminal

## Status: ready

**Priority:** MVP, blocking the phase 5 rerun · phase 5 decision "the kernel posts them, and the app opens their links" · D11

**As** the owner,
**I want** clicking a Studio notification to open Loomwright Studio on the thread or approval it names,
**so that** a notification never drops me into a Terminal window running a `studio` command.

## Problem

In the 2026-10-24 live run, clicking the reminder's notification (#21) opened Terminal running `studio notifications show 21`. The kernel posts through terminal-notifier with `-execute`, a shell command that has Terminal run the CLI (`kernel/src/notifications/notifier.ts:7`, :105-118). Every notification row already has a `deep_link` (`loomwright-studio://notifications/<id>`, `kernel/src/notifications/record.ts:102`), and the app registers that scheme (phase 5 item 17). terminal-notifier supports `-open URL` ("The URL of a resource to open when the user clicks the notification", from `terminal-notifier -help` on this Mac, 2026-10-24). The deterministic e2e uses a stub notifier, so it never saw the click.

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. **Post with `-open <deep_link>`** instead of `-execute`, in `terminalNotifierInvocation`. The URL is kernel-built (`deepLinkFor(id)`), never notification text, and is still passed as one argv item (no shell).
2. **No app installed:** if nothing handles `loomwright-studio://`, keep the row's `delivery_detail` honest ("click opens loomwright-studio://…; needs Loomwright Studio.app"). Never fall back to Terminal.
3. **Drop the Terminal click path** (`clickShellCommand` and the click's use of the show command) if nothing else uses it. `studio notifications show <id>` stays as a CLI command.
4. **Docs:** the click in `docs/architecture/notifications.md`.

## Non-goals

- The app's handling of the link (phase 5 item 17 already does it). osascript notifications (still no click action).

## Acceptance criteria

- [ ] Given a notification, when terminal-notifier is invoked, then its argv has `-open loomwright-studio://notifications/<id>` and no `-execute`. Pinned in `notifications.test.ts`.
- [ ] Given a title or body containing `loomwright-studio://approvals/9` or shell metacharacters, then the `-open` value is still the kernel-built link for its own id.
- [ ] Given the live rerun, when the owner clicks a reminder's notification, then the app comes forward on Wright's thread (the owner's observation, recorded in the evidence).

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- terminal-notifier 2.0's `-open` hands a custom scheme to LaunchServices, as it does for https. To be observed in the rerun.

## Risks

- None beyond the assumption. No test may post a real notification (#99's guard applies).

## Depends on
none

## Touches
kernel/src/notifications/notifier.ts
kernel/test/notifications.test.ts
docs/architecture/notifications.md
