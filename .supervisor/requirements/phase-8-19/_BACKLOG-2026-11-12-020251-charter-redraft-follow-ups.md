# Backlog — Charter redrafts: fit large charters, tell Wright what was withdrawn (phase 8 item 19)

## Why now

Item 18d's Validation 2 walk (2026-11-11, packaged app and installed kernel built from #262's head `36916378`) passed, but it found two problems outside 18d's code. Both are recorded in `docs/evidence/phase-8-18d-charter-card-in-chat.md`.

- A 10-duty charter fills the 4,000-character approval head, because its readiness lines quote every duty in full. Ask or change ("add comment replies", 615 over) and Choose workspace (60 over) were then refused instead of producing a v2. This blocks the phase 8 live run's step 6, which creates exactly that kind of crew member.
- After the kernel withdraws v1, Wright still tells the owner to "reject 21". The held call's answer never says what was withdrawn.

## Checklist

- [ ] .supervisor/requirements/phase-8-19/2026-11-12-020249-a-large-charter-still-gets-a-new-version.md
- [ ] .supervisor/requirements/phase-8-19/2026-11-12-020250-wright-knows-the-old-version-was-withdrawn.md

## Order

1. 19a shortens readiness quotes so large charters fit. It is the must-have for the live run's step 6.
2. 19b tells Wright which approvals were withdrawn. It shares no file with 19a, so the two can run side by side.

## Run

`plan-waves .supervisor/requirements/phase-8-19 --max 2 --explain` (2026-11-12): one wave, 19a and 19b together. `/automate --backlog <this file> --parallel 2`.

## Considered and not queued

- Raising `MAX_APPROVAL_DISPLAY`, moving readiness lines below the enforced lines, or having Wright split a charter into create plus update: the owner chose shortened readiness quotes instead (2026-11-12, 19a's gate).
- The held clone action ("Clone it for me"): already its own follow-up (18d decision 2), and not part of these two problems.
- The dismissed 18d review finding (four round-2 branches unpinned), which is a draft in `.supervisor/requirements/proposed/`: test coverage of 18d's own code, unrelated to these two.

## Revisit when

- 19a ships: rerun the 10-duty walk. If a real charter still overflows after shortening, revisit the head's other lines.
- A second redraft path appears (another held tool that names a subject): check that 19b's answer covers it.

## Owner decisions

none recorded
