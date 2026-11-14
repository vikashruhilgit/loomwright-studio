# 21f — Wright drafts a crew member's playbook only when the owner asked, and never dry-runs unasked

## Status: ready

**As** the owner of Loomwright Studio,
**I want** Wright to remember what I said when it drafted a crew member, and after I approve the member to draft its playbook only if I asked for one, and to run a dry run only when I ask,
**so that** "only the crew member" means only the crew member, and no dry run spends my tokens without my asking.

## Why

Found 2026-11-14 in phase 8 item 21b's Validation 2 walk (owner's store `~/.loomwright-studio/studio.db`, read-only; `brain_messages` #122–#127, `approvals` 37–39, `playbook_runs` 189):

| Approval | Owner's ask (row, session) | Decision message (row, session) | What Wright did after |
|---|---|---|---|
| 37 `ticket-triage-21b` | #122, session 148: no word on a playbook | #123, session 149 | drafted playbook 10 **and** ran dry run 189 (session 150, 124,277 tokens) |
| 38 `ticket-triage-21b-two` | #124, session 151: "Only the crew member for now: don't draft a playbook or run a dry run for it." | #125, session 152 | drafted playbook 11 |
| 39 `ticket-triage-21b-three` | #126, session 153: "Only the crew member: don't draft a playbook and don't run a dry run." | #127, session 154 | drafted playbook 12, then offered a dry run |

Each approval's `requesting_session` is the ask's session (37→148, 38→151, 39→153), so the kernel knows which conversation asked for it. Two causes, both checked in code:

1. **The decision reaches Wright with none of that conversation.** `decideApproval` (`kernel/src/approvals/store.ts:625`) queues the decision as a plain `message` event (`approval_id`, `sourceRef approval:<id>`). The brain handler (`kernel/src/brain/handler.ts`, step a) gives it its own `brain_messages` row and no `brain_message_threads` row (the store has none for #123, #125 or #127), so step c builds a fresh context: Wright's memory files, the time, and `approved approval 38: kernel_agent_create. The kernel created crew member … Nothing to repeat.` The owner's "don't draft a playbook" (#124) is in session 151, which session 152 never sees. Thread continuity (phase 8 item 17b, `kernel/src/brain/threads.ts`) already resumes or replays a conversation, but only for a `POST /ask` that names `continues`.
2. **Wright's instruction says to draft the playbook on the decision, unconditionally.** `ROLE_TEMPLATE` (`kernel/src/brain/templates.ts`, "Drafting a duty"), and the owner's `memory/wright/role.md:68-69` which is that text: "A crew member's playbook can be drafted only once the member exists, so tell the owner the playbook comes after the approval, and draft it when the approval's decision reaches you." Nothing in the template, the `kernel_agent_create` description or the `kernel_playbook_dry_run` description says a dry run waits for the owner's ask, so in session 149 Wright drafted and then dry-ran on its own initiative.

Invariant 1 and D3: the owner sets policy and Wright may only propose. A draft Wright makes unasked is a proposal the owner can ignore, but it still overrides an explicit "don't". A dry run is not a proposal: it starts a session and spends the owner's tokens.

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given an approval whose requesting session answered a `brain_messages` row of the same agent (Wright's `POST /ask`, for example), when the owner decides it, then the decision's message continues that row's thread: its `brain_message_threads` row has `continues` = that row and `thread_id` = that row's thread, and the handler resumes that conversation (or replays it as data when the resume is refused), exactly as a `POST /ask` with `continues` does. The decision text itself is unchanged.
- [ ] **AC2.** Given that continuation, then the session that handles the decision has the owner's ask in its context (the resumed conversation, or the replay's quoted thread).
- [ ] **AC3.** `ROLE_TEMPLATE`'s "Drafting a duty" says: when a crew member's approval is decided, draft its playbook only if the owner asked for one; otherwise say in one line that it can be drafted on request. Run a playbook's dry run only when the owner asks for one, since it spends the owner's tokens; after a draft, offer it instead. `docs/architecture/brain.md` shows the same text (pinned by `kernel/test/brain.test.ts`).
- [ ] **AC4.** For an install whose `role.md` predates AC3 (the template reaches a fresh data dir only, `brain.md`'s known gap): the `kernel_agent_create` description, the `kernel_playbook_create` description and the `kernel_playbook_dry_run` description carry the same two rules, and the applied sentence of an approved `kernel_agent_create` adds: "Draft its playbook only if the owner asked for one, and run no dry run the owner did not ask for."

**Edge cases:**
- [ ] **AC5.** Given an approval whose requesting session answered no `brain_messages` row (a playbook run's session, a crew session started by a delegation whose row is another agent's, or no requesting session), then the decision's message has no thread row and starts fresh, as today.
- [ ] **AC6.** Given a continued decision whose resume is refused and whose replay is past its bound (`history_too_large`), then the decision's message starts a fresh session (as today) instead of failing: a decision is never lost to a long thread.
- [ ] **AC7.** A redelivered decision event records its thread row once (`ON CONFLICT DO NOTHING`) and changes nothing else.

**Error scenarios:**
- [ ] **AC8.** A denied approval and an applied-refused one continue the thread the same way (the owner's words matter for "do not repeat" too); their texts are unchanged.

## Non-goals
- A kernel refusal of a dry run Wright starts unasked. The kernel cannot read the owner's intent from text, and D3 keeps the dry run as part of Wright's authoring when the owner asks for a playbook; the rule stays Wright's, carried by its role text, the tool descriptions and the decision text.
- Changing an existing install's `role.md` (it is the owner's file, invariant 8).
- Continuing a thread for messages from triggers or other agents.

## Priority: MVP
**Rationale:** The phase 8 exit re-run drafts crew members; each unasked dry run costs ~100k+ tokens of a 500k day.

## Dependencies
- Depends on: none. Blocks: none.

## Touches
kernel/src/brain/handler.ts
kernel/src/brain/threads.ts
kernel/src/brain/templates.ts
kernel/src/agents/charter-tools.ts
kernel/src/playbooks/drafts.ts
kernel/src/playbooks/dry-run.ts
kernel/test/brain-threads.test.ts
kernel/test/agents-charter-tools.test.ts
docs/architecture/brain.md

## Validation (must pass before merge)
1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm test`, with tests covering AC1, AC2 and AC5 to AC8 in the brain thread tests, AC3 in `brain.test.ts`, AC4 in the charter-tools and playbook description tests; `bash scripts/check-docs.sh`.
2. **Running system:** with the kernel installed from the PR head, ask Wright for a crew member and say "only the crew member: don't draft a playbook or run a dry run". Approve it. Wright's reply to the decision drafts no playbook and runs no dry run (`studio playbooks` lists no new playbook for the member; no new `playbook_runs` row), and `studio messages --agent wright` shows the decision's row continuing the ask's thread. Record it in `docs/evidence/phase-8-21f-member-approval-no-unasked-playbook.md` with `Verdict: PASS for Validation 2`.
