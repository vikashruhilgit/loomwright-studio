# Phase 8 gaps before the next live walk — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
Every phase 8 live run since 2026-11-12 stopped on a different denial, found one at a time. The 2026-11-20 run (session 249) went further than any before: Launch Pad, the Supervisor and a worker all ran on Loomwright 18.1.2. It then stopped because the worker couldn't run its own script (24a).

Three read-only audits on 2026-11-20 found the remaining gaps:
- every command 18.1.2 instructs, checked against the rail;
- all 274 denials from sessions 82–249;
- the true status of items 23a–24c.

This set closes those gaps, and 25a makes the next one fail in CI instead of in a live run.

## Owner decisions
- 2026-11-20: 24a: a run may run the repo's declared checks (25d).
- 2026-11-20: the rail becomes quote-aware (25b).
- 2026-11-20: file operations, `git -C`, local `git merge`, `TaskOutput` and `Monitor` are allowed when confined to the checkout (25c).
- 2026-11-20: D45's triage fix is probed first, then decided (25f Part B).
- 2026-11-20: built through /automate waves.

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 25a | A conformance test: every command the installed Loomwright instructs is allowed or excluded with a true reason. Part B: a probe of what admitted scripts do past the rail | none | 25b, 25f, 25g |
| 25b | The quote-aware rail (new D-number) | none | 25a, 25f, 25g |
| 25f | Probes of the walk order (R1, R2, step 6) and of the triage fix (Part B); the runbook and OPEN_QUESTIONS updated | none | 25a, 25b, 25g |
| 25g | Readiness flags a `never` entry that blocks a member's job (23b) | none | 25a, 25b, 25f |
| 25c | File operations, git reads, subagent waits and the wrongly excluded scripts, allowed inside the checkout | 25b (policy.ts) | — |
| 25d | The repo's declared checks; removes 25a's closed exclusions and turns on the stale-exclusion check | 25a, 25c | — |

## Run
`/automate --backlog .supervisor/requirements/phase-8-25/_BACKLOG-2026-11-20-121000-phase-8-gaps-before-the-next-walk.md --parallel 4`, safe mode, no new follow-up items.
- **Why `--parallel 4`:** wave 1 has four independent items, the four "Can run in parallel" rows above.
- **The waves** (`plan-waves --max 4`): wave 1 = 25a, 25b, 25f, 25g; wave 2 = 25c; wave 3 = 25d.
- **Serialisation:** `kernel/src/sessions/policy.ts` (25b, then 25c, then 25d) and `kernel/src/automate/launch.ts` (25c, then 25d).
- **Branch mode:** push these requirement files to `loomwright-meta` before `--parallel`, or lane-create aborts.
- **After the set:** reinstall the kernel, and re-run the walk in 25f's order with new tickets.

## Considered and not queued
- **23c**, live mode in one decision (costs two dry runs per playbook): polish; not a walk blocker.
- **23d**, the tracker panel hanging on first open: still needs a reproduction.
- **23i**, a skipped launch being invisible: partial; no walk step depends on it.
- **23s**, discarding a failed attempt from Studio: polish; between attempts the owner cleans up by hand.
- **23m's remaining rows** (lanes, ground truth, webhooks, memory writes): kernel-owned paths; 25a Part B records what runs past the rail first.
- **Per-playbook extra commands** for 24a: not chosen.

## Revisit when
- **25f Part B shows the fix comment is lost:** the owner decides the D45 amendment.
- **25a Part B marks a row "needs a kernel-owned path":** it becomes an owner decision and an item.
- **A new Loomwright release:** refresh 25a's fixture. The test names anything new.

## Checklist
- [ ] .supervisor/requirements/phase-8-25/2026-11-20-120000-25a-a-conformance-test-catches-every-loomwright-command-the-rail-denies.md
- [ ] .supervisor/requirements/phase-8-25/2026-11-20-120100-25b-the-rail-reads-quoted-text-as-text.md
- [ ] .supervisor/requirements/phase-8-25/2026-11-20-120500-25f-the-walk-matches-how-loomwright-runs-two-tickets-and-a-merge-after-triage.md
- [ ] .supervisor/requirements/phase-8-25/2026-11-20-120600-25g-readiness-flags-a-never-entry-that-blocks-a-members-own-job.md
- [ ] .supervisor/requirements/phase-8-25/2026-11-20-120200-25c-run-sessions-may-manage-files-and-wait-on-subagents-inside-their-checkout.md
- [ ] .supervisor/requirements/phase-8-25/2026-11-20-120300-25d-a-run-may-run-the-repos-declared-checks.md
