# Supervisor Job: Thread continuity in the app — Reply, Summarize & start fresh with ⓘ, Copy reference, session names (phase 8 item 17c)

## Environment
- **Project:** loomwright-studio (lane checkout `L3` of run `automate-2026-11-09-144621`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-17/2026-11-09-160019-thread-continuity-in-the-app.md
- **Base commit:** 04b78822f367ea988e77004bdc17349752b46ce4

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript app (`app/`), vitest unit tests, Playwright e2e over `app/e2e/fixture-kernel.ts`; no new dependency |
| 2 | Dependency Availability | CAUTION | 17b's kernel routes are merged (`kernel/src/brain/routes.ts` takes `continues` / `references`; `kernel/src/console/threads.ts` serves figures, summarize, summary, start-fresh, rename). But the app's `AskBody` in `app/src/api/contract.ts` still lacks `continues` and `references` (the requirement's assumption holds only partly), and four things the mockup draws have no kernel source: a route that writes `thread_summarize_hint_tokens` (`kernel/src/agents/settings.ts`: "no route, verb or tool writes it, D34"), the `summarized_into` link on read (only `threadLinks` in the kernel and the `already_started_fresh {summarized_into}` refusal carry it), a full-thread size before send, and a title on a Tasks board session card (`kernel/src/gui/tasks.ts`: `NULL AS title`) |
| 3 | Architecture Fit | GO | Chat and each Crew thread share one thread component (D25); writes go through the existing `write()` helper in `app/src/screens/chat/model.ts`; kernel behaviour is a non-goal and is not touched |
| 4 | Scope vs Supervisor Capability | CAUTION | About 40 files across Chat, Sessions, Tasks, Settings, contract and e2e: over the 12-file `context-bound` bound, so the brief splits into 3 subtasks |
| 5 | Hard Blockers | GO | None. The Validation 2 owner run in the packaged app is the owner's, after the PR |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build the approved thread-continuity mockup (`docs/design/mockups/chat-threads.html`) in the app over 17b's kernel API: Reply, Summarize & start fresh with ⓘ and its preview, the size-hint highlight and its Settings home, Copy reference with its chip, kernel session titles on every session card with rename in place, and ⌘K commands, in Chat (Wright's thread) and every Crew thread.

**Problem Statement:**
The owner needs to choose how much conversation each message carries without typing anything technical, because every Chat send today is a plain `POST /ask` (`app/src/screens/chat/ChatComposer.tsx`) that starts a fresh session.
Currently, 17b's kernel continuity (reply, summarize & start fresh, references, titles) is reachable only by API: Wright forgot its own proposal in the phase 8 live run on 2026-11-09, and Sessions and Tasks still label sessions "ad hoc session" or "playbook #<id>".
Success looks like: a Reply sends `continues`, a summary is previewed and edited before anything starts, a reference is a chip that sends as `references`, every session card shows the kernel's title, and no dollar figure appears.

**Design decisions this brief makes (each grounded in what 17b ships; the gaps go to `docs/OPEN_QUESTIONS.md`):**
- **The size hint is read-only in the app.** The kernel offers no route that writes `thread_summarize_hint_tokens` (owner hand-edit of `config/agents/<id>.json` only, D34). Settings → Threads (where the mockup puts it) shows each agent's value as "set by you" or "not set" and names the file to edit. It shows no Save, no Wright proposal (DESIGN.md open point 2: no stored source) and no reference-limit setting (open point 1: the bound is the kernel's, not an owner setting). Chat reads the hint from `GET /threads/:agent`'s `thread_summarize_hint_tokens` and highlights Summarize in `attention` past it, marked "past your size hint".
- **"Summarized: continued in …"** is drawn from what the app can read: the `202` of start-fresh (`from`, `thread`) and the `409 already_started_fresh {summarized_into}` refusal, kept in a per-bridge memory for the app's lifetime (the same pattern as the composer's workspace memory). After an app restart the mark returns only once the kernel answers one of those; recorded as an open question (the kernel exposes no `summarized_into` on read).
- **The chip's size:** with the Summary toggle, the thread's `summary_estimated_tokens` ("about N tokens"); with Full thread, no token size (no kernel field gives one before send; DESIGN.md open point 1, option "the refusal comes back from the send"), only the message count. A too-large reference is refused by the kernel's `409 history_too_large {thread, size, bound}` (characters) and shown in plain words, keeping the composer text and the chip.
- **Tasks board session cards** take their title from `GET /sessions` (`SessionSummary.title`), matched by id; a session with no title there reads `Session #<id>`, the kernel's own fallback for "any other session" (`docs/architecture/threads.md` titles table). Never "ad hoc session" or "playbook #<id>".

## Acceptance Criteria
- [ ] **AC1.** Given an agent message in Chat or a Crew thread, when the owner presses Reply and sends, then `POST /ask` carries `continues: <that message's id>` and the sent message is drawn joined to that thread (same rail, "Reply to <agent> · <time>"); and when the owner sends without Reply, the body carries no `continues`. A message whose `continuation` is `replayed` shows the mockup's note "Continuing from the saved conversation".
- [ ] **AC2.** Given the "Replying to: <first line>" strip, when the owner presses × or `Esc`, then the strip closes, focus returns to that message's Reply, and the next send carries no `continues`.
- [ ] **AC3.** Given Summarize & start fresh on a thread's latest agent reply, when the owner presses it, then the app calls `POST /threads/:agent/:thread/summarize`, waits for the summary (`GET /threads/:agent/:thread/summary`), and opens the preview Dialog (Start fresh with this / Edit / Cancel); nothing calls `start-fresh` until Start fresh with this is pressed; Cancel calls nothing further and leaves both threads unchanged; after Edit, the edited text is the `summary` sent to `POST /threads/:agent/:thread/start-fresh`. The old thread then shows "Summarized: continued in <new thread title>" and keeps Reply. When summarize answers `409 summary_exists` (a summary file already exists, e.g. after an earlier Cancel), the app reads `GET /threads/:agent/:thread/summary` and opens the same preview with that file's text, never a refusal; a test presses Summarize, Cancel, then Summarize again and gets the preview.
- [ ] **AC4.** Given the ⓘ panel of a thread, then it shows that thread's `messages`, `latest_reply_tokens`, `summary_estimated_tokens` (once a summary exists) and the size hint, from `GET /threads/:agent`'s `threads` figures, each in tokens; a unit test renders the panel and asserts its text contains no `$`.
- [ ] **AC5.** Given Copy reference on a thread header, when the owner pastes into any composer (Chat or Crew), then a chip renders (title, message count, the agent when it is another's, a Full thread / Summary toggle when a summary exists, the size, ×); the send carries `references: [{thread, use}]` with `use` `exchanges` for Full thread and `summary` for Summary, and the pasted reference text is not in `text`.
- [ ] **AC6.** Given the kernel unreachable, or a refusal of `continues_invalid` (reason `no_such_message`, `other_agent`, `never_started`), `history_too_large` (`{thread, size, bound}`) or a start-fresh / summarize refusal, when the owner sends or acts, then the composer keeps the owner's text (and the strip and chip) and shows the refusal in plain words (each code above mapped to a sentence, never the bare code).
- [ ] **AC7.** Given each new control (Reply, the strip, Summarize, ⓘ panel, preview Dialog, chip, Copy reference, rename field, Settings → Threads), then it matches the approved mockup in light and dark (except, in Settings → Threads, the size hint's Save and Wright's proposed value, omitted per Task § Design decisions (D34, no kernel write route) and recorded in `docs/OPEN_QUESTIONS.md`), is reachable by keyboard (Tab order and `Esc` as `docs/DESIGN.md` §"Thread continuity" states), and meets WCAG AA; and a committed evidence file `docs/evidence/phase-8-polish/chat-threads/README.md` (Chat, Crew) and `docs/evidence/phase-8-polish/settings-threads/README.md` (Settings) each lists the mockup views compared, the screenshots produced (light and dark) and how they were produced, and the PR body links to them.
- [ ] **AC8.** Given any session in Sessions, Tasks, Chat or Crew, then its card shows the kernel's title (`SessionSummary.title`, a thread's `ThreadFigures.title`, a message's `session_title`), falling back to `Session #<id>`; a test renders each of those screens with a playbook session and a chat session and asserts no text matches `ad hoc session` or `/playbook #\d+/`. When the owner renames a thread in place (`⏎` saves, `Esc` cancels, empty clears to the derived name via `title: null`), `POST /threads/:agent/:thread/rename` is called and the thread, `sessions` and the open Crew/Chat views refetch, so the new title shows everywhere; a renamed title is marked "renamed by you".
- [ ] **AC9.** Given the ⌘K palette on Chat or a Crew thread, then it offers "Reply to the last message", "Summarize & start fresh" and "Copy reference" for the open thread, built like the existing chat commands (`buildChatCommands` in `app/src/screens/chat/commands.ts`, guarded in-flight).
- [ ] **AC10.** Given the finished change, when `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` runs (requirement Validation 1), then every step passes. Each subtask runs the parts its lanes touch before hand-back (typecheck, `npm test`, and the e2e specs it changed); the whole command runs on the integrated branch once all three subtasks are merged into it (Supervisor's integration check), not in any one subtask. Validation 2 (the owner's packaged-app run) is the owner's, after the PR.

## Scope widening
- app/e2e/chat-threads.spec.ts
- app/src/screens/chat/commands.test.tsx
- app/e2e/fixtures/chat-threads.ts
- app/e2e/fixtures/sessions.ts
- app/e2e/fixtures/settings.ts
- app/e2e/fixtures/tasks.ts
- app/e2e/sessions.spec.ts
- app/e2e/settings-threads.spec.ts
- app/e2e/tasks.spec.ts
- app/src/api/contract.ts
- app/src/screens/chat/ReferenceChip.tsx
- app/src/screens/chat/SummaryDialog.tsx
- app/src/screens/chat/ThreadControls.tsx
- app/src/screens/chat/continuity.test.ts
- app/src/screens/chat/continuity.test.tsx
- app/src/screens/chat/continuity.ts
- app/src/screens/chat/threads.css
- app/src/screens/sessions/SessionsScreen.test.tsx
- app/src/screens/sessions/model.test.ts
- app/src/screens/settings/ThreadsSection.test.tsx
- app/src/screens/settings/ThreadsSection.tsx
- app/src/screens/tasks/TaskDetail.tsx
- app/src/screens/tasks/TasksScreen.test.tsx
- app/src/screens/tasks/TasksScreen.tsx
- app/src/screens/tasks/TasksViews.tsx
- app/src/screens/tasks/model.test.ts
- docs/OPEN_QUESTIONS.md
- docs/evidence/phase-8-polish/chat-threads/**
- docs/evidence/phase-8-polish/chat-threads/README.md
- docs/evidence/phase-8-polish/settings-threads/**
- docs/evidence/phase-8-polish/settings-threads/README.md
- accepted: LP-SCOPE 2026-11-10

## Touched-file invariants

> Grounded at base `04b78822f367ea988e77004bdc17349752b46ce4`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/api/contract.ts`** — keep: every 17b type as it is (`export interface ThreadFigures {`, `readonly thread_summarize_hint_tokens?: number | null;`); extend `export interface AskBody {` with optional fields only, so a plain send is byte-identical to today's; mirror: the kernel's `POST /ask` body exactly — `kernel/src/brain/routes.ts` destructures `continues?: unknown; references?: unknown` and `kernel/src/brain/threads.ts` refuses anything but `references[${i}].use must be "exchanges" or "summary"`; the refusal shapes `continues_invalid` (`reason`, `continues`) and `history_too_large` (`thread`, `size`, `bound`) as `kernel/src/brain/routes.ts` answers them; pinned by: `app/src/api/contract.test.ts` (route table; re-run it).
- **`app/src/screens/chat/ChatComposer.tsx`** — keep: `export const MAX_ASK_LENGTH = 8000;`, the send guard, "a refusal shows the kernel's words and keeps the text", and the refetch list `[`thread:${agent}`, "messages"]`; reuse: `write<AskResponse>(api, "/ask"` (one call site; add `continues` / `references` to its body, never a second sender); pinned by: `app/src/screens/chat/composer.test.tsx`.
- **`app/src/screens/chat/model.ts`** — keep: `export function refusalOf(` and its unreachable line `text: "The kernel is not reachable."`; reuse: `export async function write<R = unknown>(` for every new POST (summarize, start-fresh, rename) and `inFlightGuard` for double-press safety; pinned by: `app/src/screens/chat/thread.test.tsx`, `app/src/screens/chat/cards.test.tsx` (both import `./model`).
- **`app/src/screens/chat/Thread.tsx`, `app/src/screens/chat/CrewSection.tsx`** — keep: one shared thread component for Chat and Crew (D25): `export function ChatScreen({ api: apiProp }: ChatScreenProps) {` and `export function CrewSection({ api: apiProp, registry = commandRegistry }: CrewSectionProps) {` mount the same new controls; untrusted text (`text`, `reply_text`, titles, summary) is rendered as text, never HTML (invariant 3); pinned by: `app/src/screens/chat/thread.test.tsx`, `app/src/screens/chat/crew.test.tsx`.
- **`app/src/screens/chat/commands.ts`** — keep: `const commands: Command[] = [ask("chat.ask.wright", "Ask Wright", WRIGHT)];` and the `guarded(` idiom; new command ids follow the `chat.` prefix; pinned by: `app/src/screens/chat/commands.test.tsx`.
- **`app/src/screens/sessions/model.ts`** — replace: `export function taskText(` (returns `ad hoc session` / `playbook #`) with the kernel title, fallback `Session #<id>`; keep `export function agentText(`; pinned by: `app/src/screens/sessions/model.test.ts` (`expect(taskText({ playbook: 7 })).toBe("playbook #7");`), `app/src/screens/sessions/SessionsScreen.test.tsx` (`toBe("ad hoc session")`), `app/e2e/sessions.spec.ts` (`toHaveText("ad hoc session")`) — these pins change.
- **`app/src/screens/tasks/TaskDetail.tsx`** — caller of the replaced helper: `import { elapsedText, statusLine, statusView, taskText } from "../sessions/model";` and `task={item.kind === "session" ? taskText({ playbook: item.playbook }) : title}`; switch it to the new title helper fed from the history response's `sessions` (each `SessionSummary` carries `title`); keep `elapsedText`, `statusLine`, `statusView` as they are.
- **`app/src/screens/sessions/SessionsScreen.tsx`** — keep: its two `taskText(session)` call sites' meaning (the row's task cell and the Kill dialog sentence `({taskText(dialog.session)})`); change only what they print.
- **`app/src/screens/tasks/model.ts`** — keep: `export function cardTitle(item: TaskBoardItem): string {` returns a task's title or a run's playbook name first, escaped by `printable`; change only the session branch (`ad hoc session` / `playbook #`); pinned by: `app/src/screens/tasks/model.test.ts` (`"wright · ad hoc session"`), `app/src/screens/tasks/TasksScreen.test.tsx` and `app/e2e/tasks.spec.ts` (`"Session 39: ada · ad hoc session, failed:auth"`) — these pins change. Callers: `app/src/screens/tasks/TasksViews.tsx` (`aria-label={cardLabel(item)}`, `{cardTitle(item)}`), `app/src/screens/tasks/TaskDetail.tsx` (`const title = cardTitle(item);`) and `app/src/screens/tasks/TicketPrCard.tsx` (`return `${cardLabel(item)}. ${words.join(". ")}.`;`, `{cardTitle(item)}`). `TicketPrCard.tsx` is in no lane: the title map is an OPTIONAL last parameter of `cardTitle` / `cardLabel` (absent ⇒ a session card reads `Session #<id>`), so its calls compile unchanged and it renders only ticket (task) cards.
- **`app/src/screens/tasks/TasksScreen.tsx`, `app/src/screens/tasks/TasksViews.tsx`** — keep: the board's accessible names `aria-label={cardLabel(item)}` and `printable` escaping of every kernel string (`import { printable } from "../approvals/printable";` in `model.ts`); the Kernel unreachable band (`import { KernelBand } from "../../shell/KernelStates";`); add only the `sessions` live-resource read and the id → title map passed down.
- **`app/src/screens/settings/model.ts`** — keep: `export function parseSettings(body: unknown): SettingsView | undefined {` and `export function safe(text: string): string {`; `hintOf` is a pure reader that accepts only a positive integer `thread_summarize_hint_tokens` from `settings.content` (anything else ⇒ not set) and never throws.
- **`app/src/screens/chat/cards.tsx`** — touched only if a card needs the thread rail class; keep its refusal line `<p className="chat-card-refusal" role="alert">` and the approval card `data-approval={approval.id}` unchanged.
- **`app/e2e/fixtures/sessions.ts`, `app/e2e/fixtures/tasks.ts`, `app/e2e/fixtures/settings.ts`** — keep their builders' signatures (`export function summary(id: number, overrides: Partial<SessionSummary> = {}): SessionSummary {`, `export function item(kind: TaskBoardKind, id: number, state: string, overrides: Partial<TaskBoardItem> = {}): TaskBoardItem {`) so every existing spec compiles; add `title` through the overrides and the defaults only.
- **`app/src/screens/settings/SettingsScreen.tsx`** — keep: its section order and `import { AuthSection, CommandsSection, KernelSection } from "./AuthSection";`; add one section import; never write `config/agents/*.json` (the kernel says `only the owner's edit of the file sets it (no route, verb or tool writes it, D34)`, `kernel/src/agents/settings.ts`).
- **`app/e2e/fixture-kernel.ts`** — keep: every existing default route answer (`"GET /tasks": () => ({ status: 200, body: { groups: [], next_before: null } satisfies TasksResponse }),`); add 17b's routes and fields with contract types (`satisfies`), so other specs are unchanged.

## Closed enumerations touched

> Sibling grep at base `04b78822f367ea988e77004bdc17349752b46ce4`: `grep -rnF '"chat.ask.wright"' app docs` → 4 hits in 2 files.

- **`chat.thread.reply-last`, `chat.thread.summarize`, `chat.thread.copy-reference`** (sibling: `chat.ask.wright`) — must be named in:
  - `app/src/screens/chat/commands.test.tsx` — the exact registered-command list, quoting its anchor: `expect(k.registry.list().map((c) => [c.id, c.title, c.group])).toEqual([` — extend (Subtask 3's lane).
  - `app/src/screens/chat/commands.ts` — `const commands: Command[] = [ask("chat.ask.wright", "Ask Wright", WRIGHT)];`, the producer — extend.
  - `app/src/screens/chat/commands.test.tsx` — `k.registry.get("chat.ask.wright")?.run()` (two hits) — no change: runs one command by id, not a list.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/sessions/model.test.ts` — the session title pin (title shown, `Session #<id>` fallback) | make the title helper in `app/src/screens/sessions/model.ts` return `"ad hoc session"` |
| `app/src/screens/tasks/model.test.ts` — a session card's title is the matched `GET /sessions` title | make the session branch of `cardTitle` in `app/src/screens/tasks/model.ts` ignore the title map |
| `app/src/screens/chat/composer.test.tsx` — a Reply send carries `continues`; a plain send carries none | drop `continues` from the `/ask` body in `app/src/screens/chat/ChatComposer.tsx` |
| `app/src/screens/chat/composer.test.tsx` — × / `Esc` clears the strip | remove the reset of the reply target on × in `app/src/screens/chat/ChatComposer.tsx` |
| `app/src/screens/chat/continuity.test.tsx` — Cancel calls no start-fresh; Edit's text is the `summary` sent | send the original summary text instead of the edited one in `app/src/screens/chat/SummaryDialog.tsx` |
| `app/src/screens/chat/continuity.test.tsx` — ⓘ panel contains no `$` | prefix one figure with `$` in the ⓘ panel |
| `app/src/screens/chat/continuity.test.tsx` — a reference sends as `references`, not text | append the reference's clipboard text to `text` in the composer's send |
| `app/src/screens/sessions/SessionsScreen.test.tsx` — AC8: no rendered text matches `ad hoc session` or `playbook #N` | make the row's task cell in `app/src/screens/sessions/SessionsScreen.tsx` print `` `playbook #${session.playbook}` `` again |
| `app/src/screens/tasks/TasksScreen.test.tsx` — AC8: no rendered text matches `ad hoc session` or `playbook #N`; a session card names its kernel title | make the session branch of `cardTitle` in `app/src/screens/tasks/model.ts` return `"ad hoc session"` |
| `app/e2e/sessions.spec.ts` / `app/e2e/tasks.spec.ts` — the changed label pins now expect the kernel title | restore the base `taskText` / `cardTitle` session branch |
| `app/src/screens/chat/continuity.test.tsx` — AC8: rename calls `POST /threads/:agent/:thread/rename` and refetches `sessions` and the thread | drop `"sessions"` from the rename's refetch list in `app/src/screens/chat/ThreadControls.tsx` |
| `app/src/screens/chat/continuity.test.tsx` — AC3: Summarize after Cancel (`summary_exists`) opens the preview | treat `summary_exists` as a refusal in `app/src/screens/chat/ThreadControls.tsx` |
| `app/src/screens/chat/commands.test.tsx` — AC9: the three thread commands are offered for the open thread | remove the "Copy reference" command push in `app/src/screens/chat/commands.ts` |
| `app/src/screens/chat/continuity.test.ts` — AC6: each refusal code maps to a plain sentence, never the bare code | make `refusalWords` in `app/src/screens/chat/continuity.ts` return the bare code for `continues_invalid` |
| `app/src/screens/chat/composer.test.tsx` — AC2: × / `Esc` returns focus to that message's Reply | remove the focus call on strip close in `app/src/screens/chat/ChatComposer.tsx` |
| `app/e2e/chat-threads.spec.ts` — a Reply send in the running app carries `continues`; a chip send carries `references` | drop `continues` from `askBodyOf` in `app/src/screens/chat/continuity.ts` |
| `app/e2e/settings-threads.spec.ts` — a set hint reads "N tokens · set by you" | make `hintOf` in `app/src/screens/settings/model.ts` return `undefined` |
| `app/src/screens/chat/continuity.test.tsx` — AC1: a `continuation: "replayed"` message shows "Continuing from the saved conversation" | stop rendering the note for `continuation === "replayed"` in `app/src/screens/chat/ThreadControls.tsx` |
| `app/src/screens/chat/continuity.test.ts` — AC5: the Summary toggle sends `use: "summary"`, Full thread `use: "exchanges"` | hard-code `use: "exchanges"` in `askBodyOf` in `app/src/screens/chat/continuity.ts` |
| `app/src/screens/settings/ThreadsSection.test.tsx` — unset hint reads "not set" with no Save | render a Save button in `app/src/screens/settings/ThreadsSection.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Contract + kernel session titles on Sessions and Tasks + e2e fixture | AC8 (Sessions, Tasks), contract for AC1/AC5/AC6, AC10 (its lanes) | 16 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |
| 2 | Settings → Threads: the size hint, read-only | AC7 (Settings), the size-hint setting of scope 3, AC10 (its lanes) | 3 modify, 4 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |
| 3 | Chat and Crew continuity: Reply, Summarize & start fresh with ⓘ, Copy reference chip, rename, ⌘K | AC1, AC2, AC3, AC4, AC5, AC6, AC7 (Chat, Crew), AC8 (Chat, Crew, rename), AC9, AC10 (its lanes) | 12 modify (2 only if needed), 10 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |

### File Impact Map (lines at base `04b7882`)

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 contract | `app/src/api/contract.ts` (1776 — the single contract authority; adds two optional `AskBody` fields and two refusal types) | — | HIGH |
| 1 session names | `app/src/screens/sessions/model.ts` (247), `app/src/screens/sessions/SessionsScreen.tsx` (1019 — only its two `taskText` call sites change; no new responsibility), `app/src/screens/sessions/model.test.ts` (204), `app/src/screens/sessions/SessionsScreen.test.tsx` (926 — only existing pins edited, plus one title test), `app/src/screens/tasks/model.ts` (391), `app/src/screens/tasks/TasksScreen.tsx` (394), `app/src/screens/tasks/TasksViews.tsx` (302), `app/src/screens/tasks/TaskDetail.tsx` (282), `app/src/screens/tasks/model.test.ts` (393), `app/src/screens/tasks/TasksScreen.test.tsx` (1186 — only existing pins edited, plus one title test) | — | HIGH (model/tests), MEDIUM (`TasksViews.tsx`, `TaskDetail.tsx`: depends on how the title map is threaded) |
| 1 e2e | `app/e2e/fixture-kernel.ts` (375), `app/e2e/fixtures/sessions.ts` (307), `app/e2e/fixtures/tasks.ts` (373), `app/e2e/sessions.spec.ts` (689 — existing pins edited), `app/e2e/tasks.spec.ts` (1365 — existing pins edited) | — | HIGH |
| 2 settings | `app/src/screens/settings/SettingsScreen.tsx` (253), `app/src/screens/settings/model.ts` (343 — one pure reader `hintOf`), `app/e2e/fixtures/settings.ts` (137) | `app/src/screens/settings/ThreadsSection.tsx` (the section), `app/src/screens/settings/ThreadsSection.test.tsx`, `app/e2e/settings-threads.spec.ts` (new spec: `settings.spec.ts` is 787 lines), `docs/evidence/phase-8-polish/settings-threads/README.md` | HIGH |
| 3 chat | `app/src/screens/chat/ChatComposer.tsx` (178), `app/src/screens/chat/Thread.tsx` (655 — mounts the new components only; logic lives in the CREATE modules), `app/src/screens/chat/CrewSection.tsx` (150), `app/src/screens/chat/cards.tsx` (478 — only if an existing card needs the thread rail class), `app/src/screens/chat/commands.ts` (133), `app/src/screens/chat/model.ts` (371 — refetch names only; continuity helpers go to `continuity.ts`), `app/src/screens/chat/chat.css` (472 — import only; new classes go to `threads.css`), `app/src/screens/chat/composer.test.tsx` (340 — Reply/strip/chip/refusal send tests, the composer's own suite), `app/src/screens/chat/commands.test.tsx` (214 — its exact command-list pin gains the three thread commands), `app/src/screens/chat/thread.test.tsx` (968 — only existing pins that the new header changes), `docs/OPEN_QUESTIONS.md` (259) | `app/src/screens/chat/continuity.ts` (pure: ask-body builder, reference clipboard format and parser, refusal words, hint check, thread grouping, the per-bridge summarized-into memory), `app/src/screens/chat/continuity.test.ts`, `app/src/screens/chat/ThreadControls.tsx` (thread header with title, rename in place and Copy reference; Reply, Summarize, ⓘ panel), `app/src/screens/chat/SummaryDialog.tsx` (the preview Dialog), `app/src/screens/chat/ReferenceChip.tsx`, `app/src/screens/chat/threads.css`, `app/src/screens/chat/continuity.test.tsx` (component tests; `thread.test.tsx` is 968 lines), `app/e2e/chat-threads.spec.ts` (new spec: `chat.spec.ts` is 498 lines), `app/e2e/fixtures/chat-threads.ts`, `docs/evidence/phase-8-polish/chat-threads/README.md` | HIGH (creates, composer, commands), MEDIUM (`cards.tsx`, `thread.test.tsx`: touched only if needed) |

Touches files not changed by this plan: `app/e2e/chat.spec.ts` (new e2e goes to `app/e2e/chat-threads.spec.ts`; edit it only if an existing chat pin breaks).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "AskBody"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "AskReference"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "ContinuesInvalidError"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "HistoryTooLargeError"}
  - {kind: "symbol", path: "app/src/screens/sessions/model.ts", name: "sessionTitle"}
  - {kind: "symbol", path: "app/src/screens/tasks/model.ts", name: "cardTitle"}
  - {kind: "file", path: "app/e2e/fixture-kernel.ts"}
requires: []
lanes:
  - "app/src/api/contract.ts"
  - "app/src/screens/sessions/model.ts"
  - "app/src/screens/sessions/model.test.ts"
  - "app/src/screens/sessions/SessionsScreen.tsx"
  - "app/src/screens/sessions/SessionsScreen.test.tsx"
  - "app/src/screens/tasks/model.ts"
  - "app/src/screens/tasks/model.test.ts"
  - "app/src/screens/tasks/TasksScreen.tsx"
  - "app/src/screens/tasks/TasksViews.tsx"
  - "app/src/screens/tasks/TaskDetail.tsx"
  - "app/src/screens/tasks/TasksScreen.test.tsx"
  - "app/e2e/fixture-kernel.ts"
  - "app/e2e/fixtures/sessions.ts"
  - "app/e2e/fixtures/tasks.ts"
  - "app/e2e/sessions.spec.ts"
  - "app/e2e/tasks.spec.ts"
external_requires:
  - "17b kernel routes merged on main: POST /ask continues/references, GET /threads/:agent figures, summarize, summary, start-fresh, rename"

# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/settings/ThreadsSection.tsx"}
  - {kind: "symbol", path: "app/src/screens/settings/ThreadsSection.tsx", name: "ThreadsSection"}
  - {kind: "symbol", path: "app/src/screens/settings/model.ts", name: "hintOf"}
  - {kind: "file", path: "app/src/screens/settings/ThreadsSection.test.tsx"}
  - {kind: "file", path: "app/e2e/settings-threads.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-polish/settings-threads/README.md"}
requires: []
lanes:
  - "app/src/screens/settings/SettingsScreen.tsx"
  - "app/src/screens/settings/model.ts"
  - "app/src/screens/settings/ThreadsSection.tsx"
  - "app/src/screens/settings/ThreadsSection.test.tsx"
  - "app/e2e/fixtures/settings.ts"
  - "app/e2e/settings-threads.spec.ts"
  - "docs/evidence/phase-8-polish/settings-threads/**"
external_requires:
  - "GET /agents/:id answers settings.content: the agent's config/agents/<id>.json as read, carrying thread_summarize_hint_tokens when the owner set it"

# Subtask 3
provides:
  - {kind: "file", path: "app/src/screens/chat/continuity.ts"}
  - {kind: "symbol", path: "app/src/screens/chat/continuity.ts", name: "askBodyOf"}
  - {kind: "symbol", path: "app/src/screens/chat/continuity.ts", name: "parseReference"}
  - {kind: "symbol", path: "app/src/screens/chat/continuity.ts", name: "refusalWords"}
  - {kind: "symbol", path: "app/src/screens/chat/ThreadControls.tsx", name: "ThreadControls"}
  - {kind: "symbol", path: "app/src/screens/chat/SummaryDialog.tsx", name: "SummaryDialog"}
  - {kind: "symbol", path: "app/src/screens/chat/ReferenceChip.tsx", name: "ReferenceChip"}
  - {kind: "file", path: "app/src/screens/chat/threads.css"}
  - {kind: "file", path: "app/src/screens/chat/continuity.test.ts"}
  - {kind: "file", path: "app/src/screens/chat/continuity.test.tsx"}
  - {kind: "file", path: "app/e2e/chat-threads.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/chat-threads.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-polish/chat-threads/README.md"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/api/contract.ts", name: "AskBody"}
  - {from: "1", kind: "type", path: "app/src/api/contract.ts", name: "AskReference"}
  - {from: "1", kind: "type", path: "app/src/api/contract.ts", name: "ContinuesInvalidError"}
  - {from: "1", kind: "type", path: "app/src/api/contract.ts", name: "HistoryTooLargeError"}
  - {from: "1", kind: "file", path: "app/e2e/fixture-kernel.ts"}
lanes:
  - "app/src/screens/chat/ChatComposer.tsx"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/CrewSection.tsx"
  - "app/src/screens/chat/cards.tsx"
  - "app/src/screens/chat/commands.ts"
  - "app/src/screens/chat/model.ts"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/composer.test.tsx"
  - "app/src/screens/chat/commands.test.tsx"
  - "app/src/screens/chat/thread.test.tsx"
  - "app/src/screens/chat/continuity.ts"
  - "app/src/screens/chat/continuity.test.ts"
  - "app/src/screens/chat/continuity.test.tsx"
  - "app/src/screens/chat/ThreadControls.tsx"
  - "app/src/screens/chat/SummaryDialog.tsx"
  - "app/src/screens/chat/ReferenceChip.tsx"
  - "app/src/screens/chat/threads.css"
  - "app/e2e/chat.spec.ts"
  - "app/e2e/chat-threads.spec.ts"
  - "app/e2e/fixtures/chat-threads.ts"
  - "app/e2e/fixture-kernel.ts"
  - "docs/evidence/phase-8-polish/chat-threads/**"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "17b kernel routes merged on main (as Subtask 1)"
```

**Per-subtask notes for the workers:**
- **Subtask 1.** In `contract.ts`: `AskBody` gains `readonly continues?: number;` and `readonly references?: readonly AskReference[];` with `AskReference = { readonly thread: number; readonly use: "exchanges" | "summary" }`; add `ContinuesInvalidError` (`error: "continues_invalid"`, `reason: "no_such_message" | "other_agent" | "never_started"`, `continues`) and `HistoryTooLargeError` (`error: "history_too_large"`, `thread: number | null`, `size`, `bound`), each `extends ApiError`, matching `kernel/src/brain/routes.ts`. Sessions: replace `taskText` with `sessionTitle(session)` = the escaped kernel `title`, else `Session #<id>`. Tasks: the screen reads the `sessions` live resource and passes an id → title map; `cardTitle` uses it for a session card, else `Session #<id>`. Update every existing pin that names `ad hoc session` / `playbook #<id>` for a session, and add a test per screen asserting no rendered text matches either. `fixture-kernel.ts`: add default answers for 17b's thread routes and `title` on sessions so later specs can override them.
- **Subtask 2.** `ThreadsSection` lists Wright and each crew member with its hint ("40,000 tokens · set by you in `config/agents/<id>.json`", or "Not set: Summarize is never highlighted"), read with `hintOf(settings.content)` from `GET /agents/:id`. No Save control, no proposal and no reference limit (Task § Design decisions). Its e2e overrides routes in `app/e2e/fixtures/settings.ts`, never in `fixture-kernel.ts` (Subtask 1's lane).
- **Subtask 3.** Read `docs/DESIGN.md` §"Thread continuity (phase 8 item 17a)" and the mockup views named there before building. Reply sits on every agent message; Summarize and ⓘ on a thread's latest agent reply; Copy reference and rename on the thread header. Copy reference writes a `loomwright-studio://thread/<agent>/<thread>` link to the clipboard; the composer's paste handler turns that link into a chip (other pasted text is unchanged). `refusalWords` maps `continues_invalid` (each reason), `history_too_large` (naming size and bound in characters, as the kernel counts), `already_started_fresh`, `summary_exists`, `no_summary`, `nothing_to_summarize`, `summary_unreadable`, `summary_unwritable`, `agent_off`, `kill_switch_engaged`, `workspace_not_listed` and the unreachable case to one plain sentence each; any other code falls back to `refusalOf`'s text. Every new control is disabled under the shared `Kernel unreachable` band. Record in `docs/OPEN_QUESTIONS.md` the four kernel gaps from Task § Design decisions (hint write route, `summarized_into` on read, full-thread size before send, Tasks board session title) as items for a later kernel change, each naming the DESIGN.md open point it relates to. Register the three ⌘K commands for the open thread only, and extend the exact command-list pin in `app/src/screens/chat/commands.test.tsx`. Re-run `app/src/screens/chat/crew.test.tsx` and `app/src/screens/chat/keyboard.test.tsx`: a per-message Reply button may move a Tab-order pin there; if one breaks, the fix is out of lane — report it in the hand-back rather than editing silently.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 3
Subtask 2 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | `app/e2e/fixture-kernel.ts` | YES (3 requires 1) |
| Subtask 2 | Subtask 3 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel — both have empty `requires`, no shared file)
- **Batch 2:** Subtask 3 (after Subtask 1)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the app's `AskBody` lacks `continues` / `references` although 17b's kernel takes them | MEDIUM | Subtask 1 extends the contract first, mirroring `kernel/src/brain/routes.ts`; Subtask 3 is blocked on it |
| Feasibility (Phase 2.5): four mockup elements have no kernel source (hint write route, `summarized_into` on read, full-thread size, Tasks session title) | MEDIUM | Build only what 17b serves (Task § Design decisions); record each gap in `docs/OPEN_QUESTIONS.md`; never change kernel code (non-goal) |
| Feasibility (Phase 2.5): about 40 files, past one worker's context | HIGH | Split into 3 subtasks (`context-bound`); new logic in CREATE modules so large files only mount it |
| Feasibility (Phase 2.5): the plan needs files outside the requirement's Touches (contract, tests and e2e that pin the old labels, Tasks views, new modules) | MEDIUM | Listed in `## Scope widening` for the coordinator's re-gate |
| Existing pins assert `ad hoc session` / `playbook #<id>` in unit and e2e suites (Sessions, Tasks) | MEDIUM | Subtask 1 owns every such pin and rewrites it to the title; a repo-wide `grep -rn "ad hoc session" app/src app/e2e` returns no session label after the change |
| Untrusted text (titles, summary, replies) rendered in new controls | MEDIUM | Render as text only; the summary preview shows the markdown as plain text or with the mockup's safe subset, never HTML (invariant 3) |
| A size-refusal message is in characters while the UI speaks tokens (D24) | LOW | Name the kernel's unit honestly ("characters") in that one refusal; every figure the app shows is in tokens; no `$` anywhere (AC4 test) |
| Subtask 3 alone is about 21 files, past the `context-bound` 12-file bound itself | LOW | Kept whole: splitting it would serialize on `Thread.tsx` and `ChatComposer.tsx`; most of its files are small creates and the logic sits in one pure module (`continuity.ts`) with its own tests |
| The chip's Full thread view shows no token size (no kernel field before send), a change from scope 4's "size in tokens" | LOW | Summary view shows `summary_estimated_tokens`; the gap is recorded in `docs/OPEN_QUESTIONS.md` (DESIGN.md open point 1) so the owner knows it before Validation 2 |
| Validation 2 (the owner's packaged-app run) cannot be done by a worker | LOW | Workers do not write a `Verdict:` line; the owner reports the run after the PR and the coordinator records it, as for 17a |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-10-thread-continuity-in-the-app.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-10T08:17:25Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/253
- **Branch:** feature/thread-continuity-in-the-app
- **Files changed:** 65
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** 3 subtasks (contract + kernel session titles on Sessions/Tasks; Settings → Threads read-only size hint; Chat/Crew continuity — Reply, Summarize & start fresh with preview, ⓘ panel, Copy reference chip, rename, ⌘K) merged cleanly. Integration check found 2 phase-7-exit e2e failures (composed route table lacked GET /sessions); heal round 1 fixed that plus a HIGH lost-update race (Reply strip/chip/rename cleared across an in-flight send) and 3 MEDIUM (duplicated hint reader, duplicated contrastRows, stale evidence READMEs); round 2 added mutation-proven tests for the new guards; round 3 PASS. Final HEAD 7954a35 verified by the Supervisor: npm ci + typecheck + 3119/3119 unit + build + e2e 348/348. Risk classification high_risk=true (size, token/auth content). 5 LOW/nit findings dismissed (PR marker comment). Auto-review drain not dispatched (.supervisor/config.json auto_review=false — the /automate coordinator owns the drain).

## Not verified
- **Old evidence screenshots** — docs/evidence/phase-5-polish/sessions and phase-7-polish/tasks screenshots still show the old labels; their READMEs now carry a "Superseded since 17c" note (subtask 1)
- **Packaged app against the real 17b kernel** — Validation 2 is the owner's (subtask 1)
- **Packaged app vs real kernel** — Validation 2 (subtask 2)
- **Full e2e pool** — run by the Supervisor on the integrated branch: 348/348 (subtask 2)
- **Packaged app** — Validation 2 (subtask 3)
- **Real 17b kernel routes** — exercised through the e2e fixture kernel only (subtask 3)
