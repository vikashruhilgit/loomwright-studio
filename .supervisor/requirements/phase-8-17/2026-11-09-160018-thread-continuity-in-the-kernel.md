# 17b — Thread continuity in the kernel: reply, summarize & start fresh, references, drafts as records, session names

## Status: ready

**Priority:** MVP · ROADMAP phase 8 (blocks item 14's live run at setup step 6) · invariants 1, 2, 3, 8; D24, D25, D34

**As** the owner,
**I want** a message I send as a reply to continue that conversation with the agent's memory of it, and the choice to summarize a thread or attach one as a reference,
**so that** Wright and the crew don't forget what we just agreed, I decide how much history each message carries, and every session is named for what it's doing.

## Problem

Found in the phase 8 live run, 2026-11-09, setup step 6. Wright drafted a crew proposal, the owner answered it, and Wright replied that it had no record of the proposal. The store shows why: `brain_messages` rows 65, 66 and 67 ran as sessions 82, 83 and 84, each a fresh SDK session. The brain's `message` handler builds every prompt from the memory files, the Loomwright summary, the time and that one message (`docs/architecture/brain.md:230-258`). It resumes a session only when the task's latest one was interrupted (`brain.md:258`), and "nothing summarises the earlier conversation" (`brain.md:314`). The thread route (`GET /threads/:agent`, `kernel/src/console/threads.ts`) shows the owner a conversation the model never sees.

A second contributor: Wright put its proposal in chat prose, not in a held approval, so the only copy lived in a conversation that was then forgotten.

## Scope

**Part 0 — probe first (CLAUDE.md "Verify before asserting").** Before building on it, confirm with the real SDK that a *completed* session can be resumed by its SDK session id with a new prompt: in the same kernel run, after a kernel restart, and after the session's working directory files were touched. Record the result in `docs/OPEN_QUESTIONS.md` and the probe's evidence. Part 1's design follows the result.

**Part 1 — Reply.**

1. `POST /ask` (and `studio ask`) accepts an optional "continues" reference: the id of an earlier `brain_messages` row of the same agent. It is its own field, never the existing `reply_to` (which marks a delegation's answer, `brain.md` routing), so the two meanings never mix.
2. The handler continues the session that row ran in: a resume of that session (Part 0 permitting) with the new message as the prompt. When a resume is impossible (Part 0's limits, the SDK's saved conversation gone, the session refused), it starts a fresh session whose prompt carries that thread's stored exchanges (each owner message and agent reply in order, from `brain_messages`) as quoted history, wrapped as data (invariant 3), bounded. The row records which path ran (`resumed` / `replayed`), so the app can show it.
3. A message with no "continues" field is exactly today's behaviour: a new topic and a fresh session. Replying to a reply continues the same thread. Each thread has a stable id, the first row's id, that the thread route returns per message.
4. The kernel owns every start and resume (invariant 2). Admission (budget, caps, sessions at once) applies to a resume exactly as to a start.

**Part 2 — Summarize & start fresh.**

5. A request to summarize a thread runs one short session of that agent that writes the summary: what is being worked on, the decisions made, exact values (names, paths, ids, settings) word for word, open questions, and the approvals the thread produced that are still waiting. The kernel saves it as a markdown file under the agent's memory folder (`memory/<id>/threads/<thread id>.md`, invariant 8) and returns it **without starting anything**.
6. "Start fresh with this" takes the summary text as the owner may have edited it, writes it back to the file, and starts a new thread whose first prompt carries the summary as quoted history. The old thread is marked summarized with a pointer to the new one. It is never deleted, and a reply in it still continues it (Part 1).
7. The thread route returns per thread: message count, the tokens its latest reply read (input plus cache, from `sessions.model_usage_json`, D26's counting), and, when a summary file exists, the summary's size in tokens (estimated, marked as an estimate). Never dollars (D24).
8. The size past which the app highlights Summarize is an owner setting (invariant 1), stored with the owner's other settings, unset by default. Wright may propose a value in a draft, never set it.

**Part 3 — Copy reference.**

9. A message may carry thread references: ids of threads of any agent the owner can read. On send, each referenced thread's exchanges, or its summary when the owner chose that and one exists, go into the prompt as quoted history (`<untrusted-data source="thread:<id>">`), never as the owner's words (invariant 3). Each reference and the total are bounded. A reference past the bound is refused before any session starts, naming its size, and nothing is cut silently.

**Part 4 — Drafts are records.**

10. Wright's role template and the `kernel_agent_create` / `kernel_playbook_create` tool descriptions say: when the owner asks for something that ends in an approval, draft it straight into the held approval and refine it with an update. Never leave a proposal only in chat text. (The template reaches a fresh data dir only, `brain.md`; the tool descriptions reach every install.)

**Part 5 — every session has a name that says what it's doing.**

11. Today all 84 sessions in the store have no task, so the app falls back to "wright · ad hoc session", or "playbook #17" by id (`app/src/screens/sessions/model.ts:97`, `app/src/screens/tasks/model.ts:226`); the session contract (`SessionSummary`) carries no name. The kernel gives every session a `title`, derived deterministically from what started it, with no model call:
   - a Chat or Crew message: the first line of the owner's message, trimmed to a readable length; a reply in a thread: that thread's title;
   - a playbook run: the playbook's name (not its id);
   - a delegation: "From <agent>: <first line of the request>";
   - a trigger or an approval with no playbook: the trigger's or approval's own label;
   - a fresh thread started from a summary: the old thread's title, marked continued.
12. The owner can rename a thread; the rename is stored and wins over the derived title. Wright never renames one.
13. A title is display text only. One taken from untrusted input (a ticket, a comment) is never fed back into a prompt as instructions, and it passes the app's printable filter (invariant 3).

## Acceptance criteria

**Happy path**

- **AC1.** Given an owner message answered by session S, when the owner sends a message that continues it, then the handler resumes S (or replays the thread when Part 0 rules resume out), and the reply shows the agent had the earlier exchange. A test with a fake SDK pins the resume call's session id and prompt; a replay test pins the quoted history.
- **AC2.** Given a message with no "continues" field, then the session, prompt and row are exactly today's (the existing brain tests pass unchanged).
- **AC3.** Given a summarize request, then exactly one short session runs, `memory/<id>/threads/<thread id>.md` is written, and no new thread starts until "start fresh" is called with the (possibly edited) text.
- **AC4.** Given "start fresh", then a new thread starts whose prompt carries the summary as quoted history, the old thread is marked summarized with the new thread's id, and a later reply in the old thread still continues it.
- **AC5.** Given a message with a thread reference, then the referenced exchanges (or summary) are in the prompt wrapped as data, and the owner's own text alone is headed as the owner's.
- **AC6.** Given the thread route, then each message carries its thread id and continuation path, and each thread carries its count and token figures, all in tokens.

- **AC12.** Given each start kind in Part 5, when the session summary and thread route are read, then each session carries the title Part 5 names, never "ad hoc session" and never a bare playbook id. A table test covers every kind; an owner rename wins over the derived title.

**Edge cases**

- **AC7.** Given a "continues" id of another agent, a missing row, or a row whose session never started, then the request is refused before any session (`continues_invalid` naming why). No fresh session is started silently in its place.
- **AC8.** Given an owner edit to a summary file on disk, when the thread is later referenced with its summary, then the edited file is what's sent (the owner's edit wins, invariant 8).
- **AC9.** Given an agent's daily token limit or a parked cap, then a resume is parked like a start (D28), never retried in a loop.

**Error scenarios**

- **AC10.** Given a reference or replay larger than its bound, then the request is refused with the size and the bound, and nothing is truncated without saying so.
- **AC11.** Given a ticket or PR comment quoted in a thread, when that thread is referenced or replayed, then it remains data. A test plants an instruction in a stored reply and checks it arrives wrapped.

## Non-goals

- The app's UI (17c) and the mockup (17a).
- Search across threads; threads across machines.
- Changing playbook-run sessions (they keep their own record, `docs/architecture/playbook-runs.md`).
- Automatic summarizing without the owner pressing the button.

## Owner decisions

- 2026-11-09: a plain message stays a new topic and a fresh session. Only Reply continues one.
- 2026-11-09: Summarize & start fresh comes with token details. The owner sees and can edit the summary before anything starts, and can return to the old thread afterwards.
- 2026-11-09: a thread can be copied as a reference into any message instead of summarizing.
- 2026-11-09: proposals the owner must approve are held in Approvals as records, not left in chat.
- 2026-11-09: every session gets a suitable name based on the task it's performing; "wright · ad hoc session" is not acceptable.

## Assumptions

- The SDK can resume a completed session by id. Unverified: Part 0 probes it, and the replay fallback keeps the feature working if it can't.
- `brain_messages` holds every owner message and agent reply in full (`text`, `reply_text`), so a replay needs no new store of conversation text.

## Dependencies

- Depends on: none (17a's mockup governs 17c, not this API).
- Blocks: 17c.

## Risks

- Long threads raise per-reply token use. Mitigation: the per-thread figures (AC6) and the owner's size hint.
- A summary drops nuance. Mitigation: owner preview and edit before start (AC3, AC4); exact values word for word; the old thread stays continuable.

## Touches

kernel/src/brain/handler.ts
kernel/src/brain/messages.ts
kernel/src/brain/routes.ts
kernel/src/brain/context.ts
kernel/src/brain/cli.ts
kernel/src/brain/templates.ts
kernel/src/brain/memory.ts
kernel/src/console/threads.ts
kernel/src/console/output.ts
kernel/src/gui/tasks.ts
kernel/src/sessions/manager.ts
kernel/src/agents/charter-tools.ts
kernel/src/playbooks/drafts.ts
kernel/src/store/migrations/index.ts
kernel/src/store/migrations/022_thread_continuity.ts
app/src/api/contract.ts
kernel/test/brain.test.ts
kernel/test/console-threads.test.ts
docs/architecture/brain.md
docs/architecture/threads.md
docs/OPEN_QUESTIONS.md

## Validation (must pass before merge)

1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm run typecheck && npm test` (AC1 to AC11, with fake SDK sessions) and `bash scripts/check-docs.sh`.
2. **Running system — the Part 0 probe:** a real-SDK resume of a completed session (same run and after a kernel restart), recorded in `docs/OPEN_QUESTIONS.md` with its evidence before Part 1 merges.

## Depends on

none
