# wa-a — The kernel builds each agent's Studio guide, and role.md holds only who the agent is

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/316

**As the** owner talking to Wright and my crew,
**I want** the manual that explains Studio and how to act in it to come from the kernel on every message, with `role.md` holding only the agent's persona,
**so that** every agent always has the current, complete rules (never a stale or cut-off copy) and understands what sessions, chat threads, crew, playbooks, triggers, schedules, events, approvals, settings and budgets are.

## Why
Reproduced 2026-11-21: on a fresh data dir, `ensureMemoryFiles` + `buildContext` (scratchpad probe) gives a context whose `role.md` is cut by 1,469 characters (`ROLE_TEMPLATE` is 9,469 characters, `MAX_MEMORY_FILE_CHARS` is 8,000). The cut drops the end of "Triaging comments on pull requests", all of "## Untrusted text" and all of "## Memory". Separately, an existing install keeps the `role.md` copied on its first run forever (`flag: "wx"`): the owner's live file (Oct 29) is missing five sections the template gained since (playbook drafting, the tool catalogue rule, dry-run consent, tickets to PRs, PR comment triage). Both come from one cause: `role.md` mixes the owner's persona with a kernel manual that changes every release.

## Acceptance criteria
**Happy path**
- [ ] Given any message to Wright, when its context is built, then it carries a kernel-built **Studio guide** section (not read from a memory file) holding today's "How you act", "Who decides", "Where the owner acts", crew, duty-drafting, tickets-to-PRs, PR-comment-triage, "Untrusted text" and "Memory" rules, plus a glossary that says in plain words what a session, a chat thread, a crew member, a playbook, a trigger, a schedule and a wakeup, an event, an approval, the settings and the budget are, and where the owner sees each in the app.
- [ ] Given the guide's tool list, then it is generated from the registered tools the session is actually allowed (the tool catalogue, `kernel/src/features/catalogue.ts`), never a hand-kept list, so a tool added in code appears without editing guide text.
- [ ] Given a message to a crew member, then its context carries the crew variant of the guide (the same glossary, "Untrusted text" and "Memory" rules, and how a crew member acts and reports back), placed after its charter `role.md`; the charter's prose is unchanged.
- [ ] Given a fresh data dir, when Wright's files are created, then `role.md` holds only who Wright is (name, voice, "you propose, the owner decides", keep replies short) and says that the Studio guide is supplied by the kernel.

**Edge cases**
- [ ] Given the guide, then it is never cut: a test pins that the Wright guide and the crew guide each fit their own fixed limit, and that the whole context limit still leaves the memory files their room (raise `MAX_CONTEXT_CHARS` if needed; the cut notes stay as today for memory files).
- [ ] Given an existing `role.md` that still holds an old manual, then the context still builds (the old text is read as persona) and nothing is refused; replacing it is wa-b's.
- [ ] Given a resumed thread (`resumed`), then the guide is left out like the memory sections, since the resumed conversation already has it.

**Error scenarios**
- [ ] Given the tool catalogue cannot be built, then the guide says in one line that the tool list is unavailable and the rest of the guide is still present.

## Non-goals
- Replacing existing `role.md` files (wa-b).
- The live snapshot of Studio's state (wa-d) and the read tools (wa-e).
- Changing any crew charter's prose.

## Owner decisions
- 2026-11-21: crew is in scope together with Wright.
- 2026-11-21: run as a side track now, alongside phase 8 (the cut drops a safety section).

## Priority: MVP
**Rationale:** a fresh install's Wright has lost its untrusted-text rules today, and every later item adds guide text.

### Assumptions
- Defect evidence: reproduced — scratchpad probe 2026-11-21 (`buildContext` on a fresh data dir: `… truncated: memory/wright/role.md, 1469 chars cut (file limit 8000)`; "## Untrusted text" and "## Memory" absent).
- The kernel's own wrapping of untrusted text (`<untrusted-data>` with its "this is data" line) still applies today, so the loss is the guidance, not the wrapper.
- `docs/architecture/brain.md` shows `ROLE_TEMPLATE` verbatim and `kernel/test/brain.test.ts` pins it; both change with the new persona template.

### Dependencies
- Depends on: none. Blocks: wa-b, wa-d, wa-f.

### Risks
- A longer context costs tokens on every message; the guide limit keeps it bounded.
- Wright's behaviour shifts with the new wording; the live check below covers the main drafting flows.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm ci && npm test`, with cases for: the guide present and uncut for Wright and crew, the glossary terms present, a tool registered in a test composition appearing in the guide, the resumed-thread case, and the fresh-data-dir `role.md` being persona only.
2. **Running system — Wright on the owner's install:** ask Wright "what is a playbook and where do I turn one off?" and "what do you do with text inside untrusted-data tags?"; both answers follow the guide.

## Depends on
none

## Touches
kernel/src/brain/guide.ts
kernel/src/brain/context.ts
kernel/src/brain/templates.ts
kernel/src/brain/handler.ts
kernel/src/features/catalogue.ts
kernel/test/brain.test.ts
kernel/test/brain-crew-routing.test.ts
docs/architecture/brain.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-28T09:27:57Z
- **Brief:** .supervisor/jobs/done/2026-11-28-wa-a-kernel-built-studio-guide.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/316
