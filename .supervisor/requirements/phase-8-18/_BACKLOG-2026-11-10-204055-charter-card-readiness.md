# Backlog — Charter card: ready-checked, plain, complete, discussable (phase 8 item 18)

## Why now

The item 16 Validation 2 walk (2026-11-10, packaged app built from #253 + #254) failed: Wright drafted the walk's developer twice (approvals #18, #19) without the "Triage PR comments" and "Ask for a merge" jobs and with no workspace, and the card gave the owner no way to see it. The card in Chat was also raw, cut at 4,000 characters without a mark, and had no copy control. 18b is the must-have for item 16 to pass; the rest makes the card something the owner can judge and change without reading code.

## Checklist

- [ ] .supervisor/requirements/phase-8-18/2026-11-10-204051-the-charter-card-mockup.md
- [ ] .supervisor/requirements/phase-8-18/2026-11-10-204052-a-charter-is-checked-ready-before-the-owner-sees-it.md
- [ ] .supervisor/requirements/phase-8-18/2026-11-10-204053-saved-workspaces.md
- [ ] .supervisor/requirements/phase-8-18/2026-11-10-204054-the-charter-card-in-chat.md

## Order

1. 18a mockup (D9: owner approves before any UI code). Shares no file with 18b, so the two can run side by side.
2. 18b readiness check: waits only on item 16 (#254) merging, because it builds on #254's catalogue and card. The must-have for item 16's Validation 2.
3. 18c saved workspaces: after 18a.
4. 18d the charter card in Chat: after 18a, 18b, 18c and item 17c (#253).

## Run

`plan-waves --max 2 --explain` (2026-11-10): wave 1 = 18a; wave 2 = 18c; 18b blocked on item 16 (#254, unmerged); 18d blocked on item 17c (#253, unmerged). Once #253 and #254 merge: 18a and 18b in one wave, then 18c, then 18d. `--parallel 2`.

## Considered and not queued

- Plain-language refusals with a Fix button across the app (for example `no_workspace` shown as "couldn't start: no copy of the repo [Fix]"): broad, no single change site yet; revisit after 18d.
- A charter checklist the owner ticks instead of typing: 18d's Ask / Change box covers changing jobs for now.
- A "Try it" button that runs one real task before approval: 18b's read-only check covers readiness without running a session.

## Revisit when

- 18d ships: decide whether plain refusals with Fix are still needed.
- A second domain (not code) needs prerequisites: check 18b's "which jobs need what" covers it.

## Owner decisions

none recorded
