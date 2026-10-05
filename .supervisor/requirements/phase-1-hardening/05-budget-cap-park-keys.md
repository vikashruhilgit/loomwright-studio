# H05: cap parks key on the provider, one notify per cap hit, no stale wake-ups

## Status: ready

**Priority:** MVP · **Safety kernel (invariant 3): budget ceilings and cap detection**

## Story

As the owner, I want a subscription-cap park to:

- survive the account label changing;
- notify me once per cap hit;
- leave no stale wake-ups behind;

so that a capped account stays parked until its window ends and I'm not told twice about one event.

## Evidence (verified against `main` at 4429d4b on 2026-10-03; all three reproduced with the real `CapTracker`/`BudgetAdmission`)

- **F06-1 (still present).** Parks and admission key on the provider's live account label:
  - `kernel/src/budget/cap.ts:188` and `admission.ts:66` read `this.#auth.account`;
  - `activeParks` (`budget/internal.ts:110`) filters `WHERE account = ?`.

  `account` is `auth_providers.account` when that row exists, else the provider id (`subscription-token.ts:69`, `api-key.ts:30`). The only writer is `recordTokenCreated` (`auth/metadata.ts:20`), and nothing on `main` calls it yet. In the reproduction, relabelling `a@x`→`b@x` turned `{admitted:false, cap_parked}` into `{admitted:true}`, and the next rejection parked `b@x` and notified a second time. No production trigger exists today; the first `recordTokenCreated` call (a future setup or rotation flow) will be one.
- **F06-2 (still present).** `cap.ts:248-250`: a `rejected` event checks only for a park of the same type, while `#textFallback` (`cap.ts:199`) checks for any park. A text-detected hit followed by a `rejected` event for the same hit leaves two `cap_state` rows, two notifies and two wake-ups.
- **F06-3 (partially present).** `scheduleWakeupOnce` (`internal.ts:121`) dedupes on reason+due_at and never cancels the earlier row, so a park extended from 16:20 to 17:20 leaves both `cap_reset` wake-ups pending (`cap.ts:316`). Today they are inert: `fireDueWakeups` (`loop/wakeups.ts:76-96`) turns them into generic `wakeup` events, the daemon passes no handlers, and the loop closes them `event_unhandled` (`loop/loop.ts:129-131`). Parked work is redriven by its own `not_before`, which re-runs `BudgetAdmission.check`. Nothing documents that a `cap_*` wake-up means "ask admission again", never "the park ended".

## Acceptance criteria

1. **Given** a park in force, **when** the provider's account label changes (through `recordTokenCreated` or otherwise), **then** admission still refuses until the park's window ends. Parks and admission key on the stable `provider.id`. A migration moves existing `cap_state` rows (and anything else keyed on the label) to the provider id. The label stays as display text, for example in `/status`. A test relabels while parked and asserts the refusal.
2. **Given** a text-detected park followed by a `rejected` rate-limit event for the same hit, **when** both are processed, **then** one park row remains: the later, more precise window wins. The owner is notified once, unless the window actually extends.
3. **Given** a park whose window is extended, **when** the new `cap_*` wake-up is scheduled, **then** the superseded pending wake-up for the same account is cancelled or marked superseded, so only one pending `cap_*` wake-up per account and type exists.
4. **Given** the doc comments on `fireDueWakeups` and the loop's `EventHandler` type, **when** someone reads them, **then** they say that a `cap_*` wake-up means "ask admission again" and never "the park ended", so a future playbook handler can't release work on it.

## Out of scope

Dollar limits (invariant 9: tokens and sessions only). Changing how the cap is detected.

## Dependencies

Phase 1 items 01–09 (merged). H03 if it adds a migration first; take the next free migration number when implementing.

## Risks

- AC 1's migration rewrites budget state. A park in force must keep its window across the migration; test with a live park row.
- `/status` and any CLI output that shows parks by account must keep showing a readable label.

## Source

Dismissed review findings from run `automate-2026-09-30-211858`, re-verified 2026-10-03: `proposed/…--06-budget-meter-and-cap-3cd83f--dismissed-ee519faa.md` and `proposed/…--06-budget-meter-and-cap-3cd83f--dismissed-summary.md` entries 1–2.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-05T01:41:05Z
- **Brief:** .supervisor/jobs/done/2026-10-05-h05-budget-cap-park-keys.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/31
