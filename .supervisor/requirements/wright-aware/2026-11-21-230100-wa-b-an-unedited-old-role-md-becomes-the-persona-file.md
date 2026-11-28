# wa-b — An unedited old role.md becomes the persona file; an edited one is flagged

## Status: ready

**As the** owner who installed Studio before wa-a,
**I want** a `role.md` that is still an untouched copy of an old template to be replaced by the new persona file, and a `role.md` I edited to be left alone and flagged,
**so that** my Wright stops carrying a stale duplicate manual without the kernel ever overwriting my own words.

## Why
Every `role.md` written before wa-a holds a copy of the old manual. With wa-a the kernel supplies the guide, so that copy becomes a stale second set of rules in the same context. The owner's own `role.md` (Oct 29) byte-matches an old template; the test agents' folders under `~/.loomwright-studio/memory/` have their own copies.

## Acceptance criteria
**Happy path**
- [ ] Given Wright's `role.md` byte-matches any past `ROLE_TEMPLATE` (each version taken from git history, recorded by hash in the kernel), when the kernel next creates or checks Wright's files, then it writes the current persona template in its place and keeps the old text beside it as a backup, and records one audit event naming the file, the old hash and the backup's path.
- [ ] Given the replacement ran once, when it runs again, then nothing changes (the file now matches the current template).

**Edge cases**
- [ ] Given a `role.md` that matches no past template (the owner edited it), then the kernel never writes it, and `GET /memory` marks it as carrying an old manual; the Memory screen shows that mark with a plain line telling the owner the guide now comes from the kernel and the old sections can be removed.
- [ ] Given a crew member's `role.md`, then it is never replaced: a charter is the owner's approved text, not a template.
- [ ] Given a symbolic link at `role.md` or its folder, then nothing is written through it (the existing `symlink_refused` rule).

**Error scenarios**
- [ ] Given the backup cannot be written, then `role.md` is not replaced and the failure is recorded in the audit, never thrown into the message path.

## Non-goals
- Merging the owner's edits into the new persona.
- Replacing crew charters.

## Owner decisions
- 2026-11-21: replace only exact copies of past templates, keeping a backup; an edited file is never touched and the Memory screen flags it.

## Priority: MVP
**Rationale:** without it, every existing install (the owner's included) keeps the stale manual next to the new guide.

### Assumptions
- Every past `ROLE_TEMPLATE` can be recovered from `git log -p -- kernel/src/brain/templates.ts`.
- The backup lives in `memory/wright/` so the owner can open it from the Memory screen.

### Dependencies
- Depends on: wa-a (the persona template it writes). Blocks: none.

### Risks
- A template version missed from the hash list leaves that install flagged instead of replaced; the flag still tells the owner.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` with cases for an exact old copy (replaced, backup written, event recorded, idempotent), an edited copy (untouched, flagged), a crew `role.md` (untouched), and a symlink (refused).
2. **Static — app:** `cd app && npm test` with the Memory screen showing the flag line.
3. **Running system — the owner's install:** after the upgrade, `~/.loomwright-studio/memory/wright/role.md` is the persona file and its backup holds the Oct 29 text.

## Depends on
2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is.md

## Touches
kernel/src/brain/memory.ts
kernel/src/brain/past-templates.ts
kernel/src/gui/memory.ts
kernel/test/brain-role-upgrade.test.ts
kernel/test/gui-memory.test.ts
app/src/screens/memory/MemoryScreen.tsx
app/src/screens/memory/model.ts
app/src/screens/memory/MemoryScreen.test.tsx
