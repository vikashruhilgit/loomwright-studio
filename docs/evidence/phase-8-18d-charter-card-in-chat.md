# Phase 8 item 18d evidence: the charter card in Chat

**What shipped:** the kernel stores a held approval's display whole (bounded by `MAX_REQUEST_PAYLOAD_JSON`, 64,000), `studio approvals` cuts at `MAX_APPROVAL_DISPLAY` (4,000) with a mark naming what it left out, and a new charter hold for a member withdraws the older pending one (`replaced_by`, the owner's 2026-11-11 decision 1). Chat's charter card, and the Approvals screen's, open compact (who, Can do, Never does, Limits, then 18b's readiness block). The full details sit behind Show full details, with copy on the card and on each block. An Ask or change box posts a Reply into the thread the charter was drafted in, older versions collapse to "Replaced by v2" with what changed, and a workspace question offers saved folders, Choose folder… and Clone it for me. Design: [DESIGN.md, Charter card](../DESIGN.md#charter-card-phase-8-item-18a) (with the owner's 2026-11-11 answers), [app.md, The charter card](../architecture/app.md#the-charter-card-phase-8-item-18d) and [approvals.md](../architecture/approvals.md) (kernel).

This file holds the committed tests behind each criterion and the owner's running-system check (Validation 2). The worker that wrote it does not write the Validation 2 verdict. Only the owner's report does.

## Static suites

Run on macOS (Darwin 25.6.0, Node v24.11.1) on 2026-11-11, from the working tree of branch `feature/the-charter-card-in-chat` over base `327c6e3b` with both subtasks' changes applied. Each command was run as written, and the counts are copied from its output.

| Command | Result |
|---|---|
| `cd app && npm run typecheck` | exit 0, both `tsc` projects clean |
| `cd app && npx vitest run src electron scripts` | exit 0. 105 test files, **3230 passed** (0 failed) |
| `cd app && npm run build && npx playwright test e2e/chat-charter-card.spec.ts e2e/chat.spec.ts e2e/approvals.spec.ts e2e/phase-5-exit.spec.ts e2e/keyboard.spec.ts --workers=1` | exit 0, **46 passed** (0 failed). The full `npm run e2e` was not run for this file |
| `cd kernel && npx vitest run test/approvals-replace.test.ts test/agents-charter-tools.test.ts test/playbooks-dry-run.test.ts test/approvals.test.ts` | exit 0. 4 files, **191 passed** |
| `bash scripts/check-docs.sh` | exit 0, `check-docs: OK` |

## Each criterion and the committed test that shows it

| AC | Shown by |
|---|---|
| AC1 compact first, on both screens | `app/src/screens/chat/CharterCard.test.tsx` ("AC1: the compact plain view first …"), `CharterDisplay.test.tsx` (details hidden by default), `ApprovalsScreen.test.tsx` ("AC1: the details start hidden …"), e2e `chat-charter-card.spec.ts` ("AC1 + AC2 + AC3") |
| AC2 whole display in its blocks | Kernel: `kernel/test/approvals-replace.test.ts` ("a 4,001+-character display is stored and listed whole; one over 64,000 is cut to 64,000"), `kernel/test/agents-charter-tools.test.ts` and `kernel/test/playbooks-dry-run.test.ts` (their cut pins now expect the whole display). App: `CharterCard.test.tsx` ("AC2: a display past 4,000 characters is shown whole …"), `charterBlocks.test.ts` (four blocks, no line lost), e2e "AC1 + AC2 + AC3" (the `role.md` block's last line and the block scrolling inside the card) |
| AC3 copy is byte-equal | `CharterCard.test.tsx` ("AC3: Copy all text writes approval.display exactly …"), `ApprovalsScreen.test.tsx`, e2e "AC1 + AC2 + AC3" (the clipboard read back from the main process equals the display) |
| AC4 Ask or change, then v2 | `CharterCard.test.tsx` (both "AC4" tests), `continuity.test.ts` (`draftingMessage`), `ApprovalsScreen.test.tsx` ("AC4: a pending charter's Ask or change …"), `keyboard.test.tsx` (the card's tab order), e2e "AC4" and `chat.spec.ts` "AC9" (Tab to Ask or change, Send posts `continues: 4`) |
| AC5 a saved or chosen folder posts a Reply | `CharterCard.test.tsx` (both "AC5" tests), e2e "AC5 + AC10 + AC13" |
| AC6 the CLI cut is marked | `kernel/test/approvals-replace.test.ts` (`formatApprovals` names the characters left out) |
| AC7 never a guessed thread | `CharterCard.test.tsx` (both "AC7" tests: not loaded, so Send is disabled and nothing posts; summarized and started fresh, so the Reply continues the latest version's drafting message) |
| AC8 Choose folder… and Clone it for me only | `CharterCard.test.tsx` ("AC8"), e2e "AC5 + AC10 + AC13" |
| AC9 a refused clipboard says so | `CharterCard.test.tsx` ("AC9: a refused clipboard write shows an alert …") |
| AC10 a protected folder is refused | `CharterCard.test.tsx` ("AC10"), e2e "AC5 + AC10 + AC13" |
| AC11 untrusted text | `CharterCard.test.tsx` ("AC11: every part is untrusted text"), `thread.test.tsx` (the XSS pin, moved to the charter card's parts), kernel `approvals-replace.test.ts` (the CLI's cut mark stays inside the `display:` block) |
| AC12 the kernel withdraws the older hold | `kernel/test/approvals-replace.test.ts` |
| AC13 Clone posts and says nothing was cloned | `CharterCard.test.tsx` ("AC13"), e2e "AC5 + AC10 + AC13" |
| AC14 an update is the charter card | `thread.test.tsx` ("AC14 (18d)"), `CharterCard.test.tsx` ("AC14") |

**Mutation checks (app side, from the brief's pin table):** each mutation was applied to the working tree, the named test file run with `npx vitest run`, and the file restored.

- `isCharterApproval(approval)` → `approval.action === "kernel_agent_create"` in `Thread.tsx`: `thread.test.tsx` 1 failed.
- The `<CharterAsk …>` element removed from Chat's `CharterCard.tsx`: `keyboard.test.tsx` 1 failed.
- `continues: drafting.message` removed in `CharterAsk.tsx`: `CharterCard.test.tsx` 5 failed.
- Copy all text writing `display.slice(0, 4000)` instead of `display`: 1 failed.
- `CLONE_NOT_BUILT` replaced by `""`: 1 failed.
- `REPLACED_BY` removed from the older version's line: 1 failed.
- `"/approvals/:id/approve"` → `""`: 1 failed.
- `{printable(parts.head)}` → `{null}` in `CharterDisplay.tsx`: `thread.test.tsx` 1 failed.
- `open={detailsOpen}` → `open`: `CharterDisplay.test.tsx` 3 failed.
- `if (!copied)` → `if (false)`: 1 failed.
- `if (drafting === undefined) return;` removed, and `if (!saved.ok) return;` removed: each run failed (exit 1) on an unhandled `TypeError` (reading `agent`, and reading `path`), with every assertion still passing. The crash itself stops the post, so the assertions cannot tell the two apart. These two pins fail closed through the crash, not through an assertion.

The pin table's row "delete `continues: drafting.message` in `app/src/screens/chat/CharterCard.tsx`" names a line that lives in `CharterAsk.tsx` (`postToDrafting`), shared by both screens. The `CharterAsk.tsx` mutation above is that pin. The table's `copyText(display)` is written `copy("all", display)` in `CharterDisplay.tsx`, and the copy-all mutation above is that pin.

### What the static suites do not show

- **Wright's own v2.** That Wright answers the Reply and holds a v2 for the same member needs a live model turn. The tests drive a fixture v2 with `replaced_by` on v1. The kernel's withdraw is covered by `approvals-replace.test.ts`.
- **The app against the real kernel.** The e2e uses the fixture kernel. The real routes are covered by the kernel suites.
- **The native folder picker.** In e2e, `dialog.showOpenDialog` is replaced before any click.
- **Clone.** Cloning is not built (decision 2). The card says so, and a follow-up item builds the held clone.

## Validation 2 (owner)

In the packaged app (`cd app && npm run package`, then open the built app), with the kernel running as the installed service and a saved workspace for `vikashruhilgit/studio-sandbox` from item 18c:

1. In Wright's thread, ask Wright to draft a crew member that works on `vikashruhilgit/studio-sandbox` with a long `role.md` (past 4,000 characters). Check that the card opens compact: who, Can do with Used for lines, Never does, Limits on one line, and the readiness block, with no `mcp__kernel__` name, JSON or file path.
   - What it showed: Wright held approval 21, "Create crew member studio-sandbox-developer ("Sandbox Developer", octopus crew-olive), proposed by Wright", with a 10-duty charter whose `role.md` is 5,240 characters. The card opened compact: the who line; Can do as three rows (Hand tickets to /automate, Ask the owner to approve an action, Notify the owner); "Also uses Read, Write, Edit, Glob, Grep, Bash; runs commands that start with …"; Never does as one line; Limits as one line ("2,000,000 tokens a day · 1 session at once · delegates 1 level deep"); and the readiness block (10 duties Covered, 2 Flagged). No `mcp__kernel__` name, JSON or file path showed. The Can do rows had no "Used for" lines on this charter. The kernel's display listed the job labels alone ("job: Hand tickets to /automate", …), which is what `jobDisplayLines` does when the purpose lines do not fit the head (`kernel/src/agents/charter-tools.ts`). The shorter approval 20 card in the same thread did show "Used for:" lists.
2. Choose Show full details. Check the line "<n> characters, nothing cut", the four blocks, and that `role.md` ends where Wright's text ends, not mid-sentence. Choose Copy all text, paste into a text editor, and check that the length matches the line.
   - What it showed: "10,258 characters, nothing cut", then the four blocks: Kernel tools by job, Enforced lines, Settings file (`config/agents/studio-sandbox-developer.json`) and role.md (`memory/studio-sandbox-developer/role.md`). role.md ends "…preferences.md, people.md and lessons.md beside this file. The owner's edits win.", the same last line as the kernel's stored display. Copy all text, pasted into a TextEdit document, counted 10,258 characters, and the copied text was byte-identical to `studio approvals --json`'s `display` for approval 21.
3. In Ask or change, type "add comment replies" and Send. Check that it appears as a Reply in the thread Wright drafted the charter in, and that once Wright holds a v2, the v1 card collapses to "Replaced by v2" naming what changed.
   - What it showed: "add comment replies" posted as "Reply to Wright · From the card's Ask or change (approval 21): add comment replies" in the drafting thread (message 83, thread 82, continuing Wright's draft), and Wright answered there. Wright could not hold a v2 for this request. With the PR tools added, the create's head (readiness, job and enforced lines) came out 615 characters over the 4,000 `MAX_APPROVAL_DISPLAY`, and the kernel refused the call (`tool_decision deny held_refused`). Approval 21 was left unchanged. To check the v2 path, a smaller change was sent the same way: "lower the daily token limit to 1,500,000; keep everything else the same". Wright held approval 22 (v2, "1,500,000 tokens a day"). The kernel withdrew approval 21 (status denied, decided_by `kernel`; the timeline shows "Approval 21 denied: kernel_agent_create"). The v1 card collapsed to "▸ studio-sandbox-developer · v1 · Replaced by v2 · limits changed". Wright's own message still told the owner to "reject 21" after the kernel had withdrawn it.
4. On a charter with the workspace flag, choose Choose workspace. Check that the saved `studio-sandbox` folder is offered, then use it and check that a Reply naming the folder is posted and the card says nothing changes until the new version is approved. Optional: Choose folder… on a folder inside `~/Documents` shows the plain refusal and posts nothing.
   - What it showed: on the v2 card (approval 22), the Flagged line "copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)" has Choose workspace. It opened "Where's your copy of vikashruhilgit/studio-sandbox?", offering `~/studio-work/studio-sandbox` with Use this folder, plus Choose folder…, Clone it for me and Not now. Use this folder posted the Reply "Use the workspace at …/studio-work/studio-sandbox for studio-sandbox-developer (from the card's workspace question)" in the drafting thread (message 85, thread 82), and the card said "Sent to Wright. It proposes a new version with this folder; nothing changes until you approve it." Wright confirmed the folder is a clone of vikashruhilgit/studio-sandbox on `main`. Its v3 with the path was refused by the same head limit (60 characters over), so approval 22 is unchanged. The optional `~/Documents` refusal was not run.
5. Run `studio approvals` in a terminal while the long charter is held. Check that its display ends with "… <n> more characters not shown; studio approvals --json, or the app's Approvals screen, shows all of it".
   - What it showed: with approval 21 held, `studio approvals` printed its display through "workspaces: none" and then "… 6258 more characters not shown; studio approvals --json, or the app's Approvals screen, shows all of it" (4,000 + 6,258 = the card's 10,258).

Owner's result (filled in from the owner's report):

Verdict: PASS for Validation 2

Run on 2026-11-11 between 23:03 and 23:30 local time (macOS 26.6.2) by Claude, driving the app while the owner watched. The owner asked for the check to be run rather than waived. It ran against the packaged app (`npm run package`, `release/mac-arm64/Loomwright Studio.app`) and the kernel installed as the launchd service (`service install`, pid 54629), both built from PR head `36916378`. Every behaviour this item adds was seen working: the compact card, full details with nothing cut, copy all, the Reply in the drafting thread, the v1 withdraw and the "Replaced by v2" collapse, the workspace picker's Reply and note, and the CLI cut line.

Findings outside this item's code, for follow-up:

- The kernel's 4,000-character limit on a new member's approval head (`MAX_APPROVAL_DISPLAY`, existing before 18d) refused two Ask or change results on this 10-duty charter: adding comment replies (615 over) and adding the workspace (60 over). Asked for a change that does not fit, Wright can only explain, so on a large charter Ask or change and Choose workspace end in a refusal instead of a v2.
- Wright's message after a v2 still tells the owner to reject the old approval, which the kernel has already withdrawn.

```
Step 2: 10,258 characters, nothing cut | copied text: 10258 characters (TextEdit), identical to approvals --json display
Step 3: approval 21 status=denied decided_by=kernel; approval 22 pending
        ▸ studio-sandbox-developer · v1 · Replaced by v2 · limits changed
Step 4: Sent to Wright. It proposes a new version with this folder; nothing changes until you approve it.
Step 5: … 6258 more characters not shown; studio approvals --json, or the app's Approvals screen, shows all of it
```
