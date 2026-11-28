# wa-c — An unedited proposed tool list gets the current proposed tools

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/317

**As the** owner,
**I want** Wright's tool list, while it is still the kernel's unedited proposal, to follow the current proposal when the kernel adds tools, and a list I changed to be left alone with the new tools shown to me,
**so that** new abilities (the Studio read tools, lesson proposals) reach my existing Wright without the kernel ever overriding a tool policy I set.

## Why
`config/agents/wright.json` stores the tool list as a fixed copy on first run (`status: "proposed"`, 25 tools on the owner's install, checked 2026-11-21). `PROPOSED_ALLOWED_TOOLS` in `kernel/src/brain/settings.ts` can grow, but an existing file never does, so wa-e and wa-f's tools would never reach an existing Wright. Same create-once cause as wa-a/wa-b, on the settings side.

## Acceptance criteria
**Happy path**
- [ ] Given `wright.json` has `tool_policy.status` `proposed` and its `allowedTools` exactly equals (as a set) a past proposed list recorded in the kernel, when the kernel reads Wright's settings, then it writes the current proposed list, keeps a backup of the old file, and records one audit event with the tools added.
- [ ] Given the upgrade ran, then the next read changes nothing.

**Edge cases**
- [ ] Given a list the owner changed (any difference from every past proposed list), or a status other than `proposed`, then the file is never written, and `GET /settings` names the proposed tools the list lacks; the Settings screen shows them in plain words (the job each tool does, from the catalogue) for the owner to add.
- [ ] Given a malformed `wright.json`, then the existing `settings_invalid` refusal is unchanged and nothing is written.
- [ ] Given a crew member's settings, then nothing is upgraded: a crew member's tools come only from its approved charter.

**Error scenarios**
- [ ] Given the write fails, then the old file stays in place, the session runs with the old list, and the failure is in the audit.

## Non-goals
- Upgrading crew tool lists.
- Removing tools from any list.

## Owner decisions
- 2026-11-21: upgrade only unedited proposed lists, with backup and audit event; an edited list is left alone and Settings flags the missing tools.

## Priority: MVP
**Rationale:** wa-e and wa-f deliver nothing to an existing Wright without it.

### Assumptions
- Every past `PROPOSED_ALLOWED_TOOLS` can be recovered from git history of `kernel/src/brain/settings.ts`; the upgrade lives in the shared reader (`kernel/src/agents/settings.ts`), which already receives the current proposed list, so `kernel/src/brain/settings.ts` is read, not changed.
- `kernel/src/protected-paths.ts` keeps sessions from writing `config/`; this write is the kernel's own.

### Dependencies
- Depends on: none. Blocks: wa-e, wa-f.

### Risks
- Silently widening an agent's tools is a safety-kernel concern (D5); the rule is limited to lists that are byte-for-byte the kernel's own earlier proposal, and every upgrade is audited.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` with cases for an exact past list (upgraded, backup, event, idempotent), an edited list (untouched, missing tools reported), a non-`proposed` status, a malformed file and a crew file.
2. **Static — app:** `cd app && npm test` with Settings listing the missing tools by job.
3. **Running system — the owner's install:** after the upgrade, the owner's `wright.json` holds the current proposed list and its backup holds the 25-tool list.

## Depends on
none

## Touches
kernel/src/agents/settings.ts
kernel/src/agents/past-tool-lists.ts
kernel/src/gui/settings.ts
kernel/test/agents-settings-upgrade.test.ts
app/src/screens/settings/SettingsScreen.tsx
app/src/screens/settings/model.ts
app/src/screens/settings/SettingsScreen.test.tsx

## Carried from wa-a (PR #316)

The owner routed these wa-a follow-ups to this item on 2026-11-28 (review findings the drain dismissed as known limits). This item's plan covers them, or says why it cannot:
- Part of this (with wa-d): playbookPrompt and crewPlaybookPrompt are not wired to the tool catalogue: a playbook session's guide says its tool list is unavailable, and a crew playbook session gets no guide. Recorded in docs/architecture/brain.md "Known limits" by wa-a (PR #316).

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-28T11:18:18Z
- **Brief:** .supervisor/jobs/done/2026-11-28-wa-c-unedited-proposed-tool-list-upgrade.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/317
