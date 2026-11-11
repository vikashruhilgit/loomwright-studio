# 18c — Saved workspaces: pick a repo's folder once, reuse it next time

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/260

**Priority:** Phase 2 (follow-up) · D31, D34, invariants 1, 3, 8

**As** the owner,
**I want** the folders I choose as a repo's workspace to be remembered in one list I can see and edit,
**so that** next time a crew member needs that repo, Wright offers the folder and I pick it instead of browsing again.

## Problem

Today each crew member's settings file holds its own `workspaces` (`config/agents/<id>.json`, D34; shown read-only on Team → inspector, `app/src/screens/team/Inspector.tsx:426`). Nothing is shared or remembered between members, so the owner re-enters the same path per member, and Wright can't suggest one it has seen before. The owner asked, 2026-11-10, for chosen workspaces to be saved and offered as an option next time.

## Scope

1. **A saved list of workspaces** kept by the kernel: for each, the folder path, the repo its git remote names (the existing parse, `kernel/src/automate/checkout.ts`), and when it was last used. Saving refuses a macOS-protected folder (D31, `kernel/src/protected-paths.ts`) with a plain reason, and a folder that is not a git checkout.
2. **Settings → Workspaces** shows the list (repo, path, last used) with remove, and an add by folder picker, as 18a's mockup shows.
3. **Lookup by repo** for Wright and the charter card: given `<owner>/<repo>`, the saved workspaces whose remote names it, re-read fresh (a moved or deleted folder is reported as such, never offered as ready).
4. When the owner picks or chooses a folder for a member (18d's card), it is saved here and its last-used time updated.

The list is the owner's: no session writes it (as `config/` is protected today); Wright can read it and propose, never add.

## Acceptance criteria

**Happy path**

- **AC1.** Given the owner adds a folder that is a git checkout of `o/r` outside protected folders, when it is saved, then Settings → Workspaces lists it with repo `o/r`, its path and a last-used time.
- **AC2.** Given two saved workspaces for `o/r` and one for `o/s`, when the lookup asks for `o/r`, then exactly the two are returned, most recently used first.
- **AC3.** Given the owner removes a saved workspace, when the list is read, then it is gone, and no crew member's settings file changes.

**Edge cases**

- **AC4.** Given a saved folder that was moved or deleted, when the lookup runs, then it is returned marked missing, never as ready, and Settings shows it as missing.
- **AC5.** Given a folder whose remote is not GitHub or has no remote, when it is saved, then it is saved with no repo and the owner is told it won't be matched to a repo.

**Error scenarios**

- **AC6.** Given a folder inside `~/Documents`, `~/Desktop`, `~/Downloads` or iCloud Drive, when the owner tries to save it, then it is refused with D31's plain reason, and nothing is saved.
- **AC7.** Given a session (Wright or crew) tries to add or remove a saved workspace, when the call is made, then it is refused: the list is the owner's.

## Non-goals

- Cloning a repo (18d's "Clone it for me", held for approval).
- Changing how a member's own `workspaces` are enforced (D34 stands; choosing a saved workspace for a member still goes through a held charter update).
- Syncing the list between machines.

## Owner decisions

- 2026-11-10: chosen workspaces are saved so the next time the owner can select one.

## Assumptions

- The list lives in the kernel's store with console routes, like integrations' connections; the design picks the exact table and routes.
- "Last used" updates when a saved workspace is chosen for a member, not on every session start.

## Dependencies

- Depends on: 18a (the Settings → Workspaces mockup, D9).
- Blocks: 18d's workspace picker.

## Risks

- A saved path can go stale silently. Mitigation: AC4, every lookup re-reads the folder.

## Touches

kernel/src/store/migrations/index.ts
kernel/src/console/index.ts
kernel/src/automate/checkout.ts
kernel/src/protected-paths.ts
app/src/api/contract.ts
app/src/screens/settings/SettingsScreen.tsx
app/src/screens/settings/SettingsScreen.test.tsx
docs/architecture/agents.md

## Validation (must pass before merge)

1. **Static — kernel and app suites:** `cd kernel && npm ci && npm run typecheck && npm test` (AC1 to AC7), `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh`.
2. **Running system — save once, see it listed:** in the packaged app, the owner adds a checkout of vikashruhilgit/studio-sandbox in Settings → Workspaces, sees it listed with its repo, tries a folder in `~/Documents` and sees the plain refusal. The owner reports what each showed.

## Depends on

2026-11-10-204051-the-charter-card-mockup.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-11T11:31:32Z
- **Brief:** .supervisor/jobs/done/2026-11-11-saved-workspaces.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/260
