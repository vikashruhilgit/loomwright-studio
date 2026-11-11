# 18a — The charter card mockup: short by default, complete on request, ready-checked

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/256

**Priority:** MVP for the set (D9: no new UI before the owner approves its mockup) · phase 8 follow-up to item 16

**As** the owner,
**I want** to see and approve how a crew member's charter card, its readiness results, its workspace question, its Ask / Change box and the saved Workspaces list will look before any of it is built,
**so that** the card I approve crew members from is simple by default and complete when I ask, as D9 requires.

## Problem

Found in the item 16 Validation 2 walk, 2026-11-10 (the packaged app built from #253 + #254):

- The Chat charter card shows the kernel's display as a raw `<pre>` block (`app/src/screens/chat/cards.tsx:146`). Item 16's plain view (`app/src/screens/approvals/CharterDisplay.tsx`) is used on the Approvals screen only.
- The display is cut at 4,000 characters (`MAX_APPROVAL_DISPLAY`, `kernel/src/approvals/store.ts:117,278`) with no mark, so the owner could not tell the card was incomplete.
- Nothing on the card said that two asked-for jobs were missing or that the member had no workspace. The owner could not have found either without reading code.

The owner asked for: plain names with what each permission is for, details hidden until asked, the full text with scroll or "more", copy and show-all icons with tooltips, an automatic readiness check, an Ask / Change box that continues the drafting thread, a workspace question when one can't be found, and saved workspaces to pick from next time.

## Scope

One mockup file, `docs/design/mockups/charter-card.html`, in the design system's tokens and components (`docs/DESIGN.md`), with these states:

1. **Compact card (default).** Who (avatar, name, repo); **Can do**: each job's plain name with a "used for" line; **Never does**: the never list in plain words; **Limits** in one line; readiness results (see 3).
2. **Details expanded.** Every raw line exactly as enforced (tools, Bash prefixes, limits, workspaces, the settings file, `role.md`), complete, scrolling inside the card, never cut silently.
3. **Readiness results.** One row per duty: ✓ covered by a job, or ⚠ "no job covers this" with an **Add** action; one row per job that needs a workspace or connector: ✓ ready, or ⚠ with a fix action.
4. **Workspace question.** "Where's your copy of <repo>?" with a picker of saved workspaces whose remote matches, **Choose folder…**, and **Clone it for me** (held for approval). A refused protected folder (D31) explained in plain words.
5. **Ask / Change box** on the card, and how the question, Wright's answer and a new card version appear in the drafting thread: the older card marked "Replaced by v2" with what changed.
6. **Icons with tooltips:** copy ("Copy all text"), expand ("Show full details"), more ("Show more"). Copy exists on the whole card and on each details block.
7. **Settings → Workspaces** list: repo, path, last used, remove.
8. Empty, loading and error states for 3, 4 and 7, keyboard order and focus, in light and dark.

`docs/DESIGN.md` links the mockup and records the approval.

## Acceptance criteria

**Happy path**

- **AC1.** Given the mockup file, when it is opened in a browser, then every state in Scope 1 to 8 is visible and reachable by keyboard, in light and dark.
- **AC2.** Given the compact card state, when it is read, then no `mcp__kernel__` name, JSON or file path is visible until the details are expanded.
- **AC3.** Given the details state, when it is read, then the full settings file and the full `role.md` are present with nothing cut, and a copy control sits on the card and on each block.
- **AC4.** Given every icon-only control, when it is focused or hovered, then it shows a tooltip and has an accessible name.

**Edge cases**

- **AC5.** Given a charter with no workspace-needing job, when the card is shown, then no workspace question appears.
- **AC6.** Given a charter update (not a create), when the card is shown, then the jobs it adds and keeps are marked as item 16's card marks them.

**Error scenarios**

- **AC7.** Given a readiness check that could not run (kernel offline, connector unreadable), when the card is shown, then it says the check did not run and why, and never shows a ✓ it did not earn.

## Non-goals

- Building any of it (18b, 18c, 18d).
- Changing the Approvals screen's layout beyond the charter card.
- Plain-language refusals with a Fix button elsewhere in the app (considered, not queued).

## Owner decisions

- 2026-11-10: details hidden by default and shown on request; all text available, by scroll or "more", never silently cut.
- 2026-11-10: copy and show-all controls are icons with tooltips.
- 2026-11-10: a readiness check (dry run) runs automatically, especially for a new kind of setup.
- 2026-11-10: the owner can ask about or change the charter from the card, and that conversation shows in the main Chat in the same thread.
- 2026-11-10: code-related jobs need a workspace; when Wright can't identify the repo's workspace it asks the owner; chosen workspaces are saved for picking next time.

## Assumptions

- The design system already has a warning style and an icon set fit for copy, expand and more; if not, the mockup adds them to `docs/DESIGN.md` for approval.

## Dependencies

- Depends on: item 17a's mockup (`docs/design/mockups/chat-threads.html`, merged), whose charter card and thread layout this extends.
- Blocks: 18c and 18d.

## Risks

- A compact card can hide something the owner should see. Mitigation: the details are one click away, the readiness rows always show, and nothing enforced is ever omitted from the details.

## Touches

docs/design/mockups/charter-card.html
docs/DESIGN.md

## Validation (must pass before merge)

1. **Static — docs check:** `bash scripts/check-docs.sh`.
2. **Running system — the owner approves the mockup:** the owner opens `docs/design/mockups/charter-card.html` in a browser, walks states 1 to 8 in light and dark, and records approval (or the changes wanted) in `docs/DESIGN.md`.

## Depends on

none

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-11T07:48:03Z
- **Brief:** .supervisor/jobs/done/2026-11-10-the-charter-card-mockup.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/256
