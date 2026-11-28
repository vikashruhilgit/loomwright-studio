# wa-f — Agents propose lessons, and the owner approves them before they are written

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/321

**As the** owner,
**I want** Wright and my crew to propose what they learned (a lesson from a mistake, a preference I stated, a fact about someone I work with) as an approval I decide, with the kernel writing it to their memory files,
**so that** they get better over time, and nothing becomes a standing instruction without my yes.

## Why
No agent can write its memory today: the proposed policy has no write tool and no kernel tool writes memory (checked 2026-11-21). The owner's `preferences.md`, `people.md` and `lessons.md` are still the empty templates from 2026-10-15, so nothing carries over between conversations. D7 asks for "skills learned from use"; D5 puts persistent actions behind the approval gate.

## Acceptance criteria
**Happy path**
- [ ] Given an agent's session, when it calls the new `kernel_memory_propose` with a file (`lessons`, `preferences` or `people`), the entry text and its evidence (what happened, with ids where it has them), then the call is always held as an approval showing the file, the entry and the evidence.
- [ ] Given the owner approves it, then the kernel itself appends the entry, dated, to that agent's own file (`memory/<agent>/<file>.md`), records a `memory_updated` event naming the agent and the approval, and the agent's next message has it in context.
- [ ] Given the owner denies it with a note, then the decision reaches the agent as today; when the agent proposes a revised entry for the same file, the earlier pending one is withdrawn (the existing replace-on-subject rule).
- [ ] Given the Studio guide (wa-a), then it tells agents when to propose: after a refused call, a denied approval, a failed run or an owner correction, one entry per lesson, never copying untrusted text into an entry as an instruction; and that the owner can have Wright draft a reflection playbook that reviews recent mistakes, only when the owner asks (none is preinstalled).

**Edge cases**
- [ ] Given an entry that would take the file past `MAX_MEMORY_FILE_CHARS`, then the call is refused with that reason, so the agent proposes trimming instead.
- [ ] Given a proposal for another agent's file or for `role.md`, then it is refused: an agent proposes only to its own three files.
- [ ] Given the file changed on disk since the proposal (the owner edited it), then approving still appends; nothing the owner wrote is overwritten.
- [ ] Given the approval card, then it shows the entry as plain text and the evidence wrapped as untrusted data.

**Error scenarios**
- [ ] Given the write fails at approval time, then the approval is marked failed with the reason and nothing is half-written.

## Non-goals
- Agents writing memory without approval.
- An "edit then approve" control on the card: the owner edits after approving in the Memory screen, or denies with a note so the agent re-proposes.
- Proposals to `memory/shared/`.

## Owner decisions
- 2026-11-21: every lesson, preference or people entry is held for the owner's approval; the kernel writes it.
- 2026-11-21: crew is in scope together with Wright.

## Priority: MVP
**Rationale:** this is the learning loop the owner asked for.

### Assumptions
- Uses the existing held-and-applied path (`KERNEL_APPLIED_ACTIONS` in `kernel/src/approvals/store.ts`, as `kernel_agent_create` does) and `ALWAYS_HELD_TOOLS` in `kernel/src/sessions/policy.ts`.
- A crew member gets the tool only through a charter the owner approved.
- The `memory_updated` event for an agent-proposed write also gives the thread its "memory updated" card (`docs/OPEN_QUESTIONS.md`), if the threads view lists that kind; adding it there is in scope only if it is one line.

### Dependencies
- Depends on: wa-a (guide text on when to propose), wa-c (delivers the tool to an existing Wright). Blocks: none.

### Risks
- An injected comment could try to get a "lesson" proposed; the owner's approval is the gate, and the card shows the evidence as untrusted.
- Too many proposals become noise; the guide asks for one entry per lesson and only on the listed signals.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` with cases for: always held, approve writes and records the event, deny then re-propose withdraws the old one, size refusal, other-agent and `role.md` refusal, owner edit kept, write failure.
2. **Static — app:** `cd app && npm test` with the Approvals card for a memory proposal.
3. **Running system — the owner's install:** have Wright call a tool its policy refuses, then ask it what it learned; a lesson proposal appears in Approvals, and after approving, `memory/wright/lessons.md` holds the entry and the next answer uses it.

## Depends on
2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is.md
2026-11-21-230200-wa-c-an-unedited-proposed-tool-list-gets-the-current-proposed-tools.md

## Touches
kernel/src/brain/memory-propose.ts
kernel/src/brain/index.ts
kernel/src/brain/memory.ts
kernel/src/brain/guide.ts
kernel/src/brain/settings.ts
kernel/src/approvals/store.ts
kernel/src/sessions/policy.ts
kernel/test/brain-memory-propose.test.ts
kernel/test/approvals.test.ts
kernel/test/sessions-policy.test.ts
app/src/screens/approvals/ApprovalsScreen.tsx
app/src/screens/approvals/ApprovalsScreen.test.tsx

## Owner condition (2026-11-28, binding)

Relayed by the coordinator when wa-f was started: keep the approval with the owner. An agent may only propose a lesson; it never accepts its own lesson or any other. In the build this means: no agent session (Wright or crew) can decide a `kernel_memory_propose` approval, whether its own or another agent's, through any tool, delegation or route; only the owner's decision path applies it; and a test pins that an agent's attempt to decide one is refused and writes nothing. The PR body shows this condition and the test that pins it.

## Owner-accepted deviations (2026-11-28, PR #321)

- **AC5 (the catalogue job):** `kernel_memory_propose` sits under the `general` job, not `ask_for_approval`. With `ask_for_approval`, approval 21's 10-duty charter head drops below the 1,200-character slack that phase 8 item 19a AC1 requires. The owner accepted it because a crew member still gets the tool only through an approved charter that lists it.
- **AC11 (the api.json Read):** a Read of `<dataDir>/api.json` is not a rail deny, because the rail checks paths only for Write, Edit, NotebookEdit and Bash. The file holds port, host, pid and start time, and the token is in the Keychain. The test pins the `ApiInfo` fields and the Bash `cat` deny instead. The owner accepted this.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-28T17:17:40Z
- **Brief:** .supervisor/jobs/done/2026-11-28-wa-f-memory-proposals.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/321
