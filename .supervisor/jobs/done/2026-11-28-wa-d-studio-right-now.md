# Supervisor Job: wa-d — every prompt says what is in Studio right now, including recent mistakes

## Environment
- **Project:** starfish-clone (Loomwright Studio checkout)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/wright-aware/2026-11-21-230300-wa-d-every-prompt-says-what-is-in-studio-right-now.md
- **Base commit:** 873fb241c1f9be4612ce40f4976de0b00c648aaa

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest). No new dependency: `node:*`, the store and existing kernel readers only. |
| 2 | Dependency Availability | GO | Every fact is already stored and read by an owner route or an exported reader (`rosterOf`, `listPlaybooks`, `listTriggers`, `listApprovals`, `schedulesRoutes`, `sessionOutputRoutes`, `budgetAuditRoutes`, `readWrightSettings`/`readAgentSettings`, `readWrightToolPolicy`). |
| 3 | Architecture Fit | CAUTION | `MAX_CONTEXT_CHARS` (82 000) has no room for a new section that is never cut: `kernel/test/brain-guide.test.ts` pins the sum at 81 000. The limit must rise to 88 000, and three tests pin the literal `context limit 82000`. |
| 4 | Scope vs Supervisor Capability | GO | 12 files (9 modify, 3 create), within one worker's bound; four of the modified tests change only pins. One subtask. |
| 5 | Hard Blockers | CAUTION | Needs files outside the requirement's Touches: `kernel/src/playbooks/runs.ts` (the carried wa-a follow-up), `kernel/test/brain-guide.test.ts`, `kernel/test/brain.test.ts`, `kernel/test/playbooks-crew.test.ts` (the limit pins), `kernel/test/brain-threads.test.ts` (two exact handler-prompt pins), `docs/architecture/playbook-runs.md`, `docs/evidence/wa-d-studio-right-now.md`. The owner is asked once at Phase 6 (`LP-SCOPE`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Every agent session's prompt carries a kernel-built **Studio right now** section, read at that moment from the same readers the owner routes use, ending with **Recent mistakes**. Wright sees all of Studio. A crew member sees only its own items. The section has its own fixed limit, is wrapped as untrusted data, is kept in a resumed thread, and a source that fails to read becomes one "unavailable" line.

**Problem Statement:**
The owner needs Wright to answer "what's going on?" from facts, to notice waiting approvals and limits, and not to repeat a mistake it made earlier today.
Today the prompt (`kernel/src/brain/context.ts` `buildContext`) carries role, guide, memory, Loomwright, time and message, but nothing about sessions, approvals, budget, settings or the agent's own failures. The 38 kernel tools have no reader for them either (checked 2026-11-21).
Success looks like this: on the owner's install, with one approval waiting and one failed message in the last day, Wright's answer to "what's going on in Studio?" names both.

**Carried from wa-a (PR #316), routed here by wa-c: what this plan covers.** "playbookPrompt and crewPlaybookPrompt are not wired to the tool catalogue" (`docs/architecture/brain.md` "Known limits": "The playbook prompts do not get the catalogue yet"). This plan covers it, because wa-d is the item that changes the prompt builders and a playbook session is an agent prompt too. Wright's `playbookPrompt` passes the loop's catalogue and the session's `allowedTools` to `buildContext`, plus the Studio section. `crewPlaybookPrompt` gains the crew guide right after `role.md`, plus the member's own Studio section. Both are kept whole like the guide. The Known-limits line is removed, and `docs/architecture/playbook-runs.md` ("built with no catalogue here", "It carries no Studio guide yet (a follow-up)") is updated.

## Design decisions
- decision: where the Studio-right-now reader lives and how it reads each fact
  chosen: a new module `kernel/src/brain/studio-view.ts` exporting `async studioView(store, agent, {now, timeZone, self}): Promise<string>` (the rendered section; it never rejects) and its constants. It is async because the three route handlers it reuses return promises (`kernel/src/gui/schedules.ts` `async function schedule(`, `kernel/src/console/output.ts` `async function listSessions(`, `kernel/src/gui/budget-audit.ts` `usage(` returns `Promise.resolve(...)`). The callers await it once, before building the prompt, and pass the rendered string to the synchronous builders: `kernel/src/brain/handler.ts` awaits it in step c, after step b's settings read and before `contextOf`, with `now()` taken once; `kernel/src/playbooks/runs.ts` awaits it inside its async start step, right before `playbookPrompt` / `crewPlaybookPrompt`. `buildContext`, `playbookPrompt` and `crewPlaybookPrompt` stay synchronous and take the string. `self` is the agent's model and tool-policy status as the caller's step b already read it (`settings.settings.model`, and for Wright `readWrightToolPolicy(dataDir)` status with the `proposedToolsMissing` count, a raw read that never writes; for a crew member its charter policy), so the view never reads an agent's own settings again. The crew on/off line uses `listAgents` (`kernel/src/agents/registry.ts`, a store read) rather than `rosterOf`. It reads each fact through the reader the owner route uses. Where a route has an exported reader, it calls that reader: `listAgents` (the registry `GET /agents`'s `rosterOf` is built on), `listPlaybooks` (`GET /playbooks`), `listTriggers` (`GET /triggers`), `listApprovals` (`GET /approvals`). Where the route's query is inline in its handler, it calls that handler in-process through the route's exported array, with a read-only request `{params: {}, query, body: undefined, store, now}`: `GET /schedule` (`schedulesRoutes`), `GET /sessions?status=running` and `?status=starting` (`sessionOutputRoutes`), `GET /budget/usage?days=1` (`budgetAuditRoutes`). The agent and the app then never disagree, and none of those route files change. Only the four "Recent mistakes" queries are new SQL, because no route serves them. They are read-only `SELECT`s in this module, the query module wa-e will share.
  rejected: copy the routes' SQL into `studio-view.ts`. Blast radius partial: two copies drift, which is the exact disagreement the requirement's Assumptions rule out.
  rejected: export the inline helpers from `kernel/src/gui/schedules.ts`, `kernel/src/console/output.ts` (928 lines) and `kernel/src/gui/budget-audit.ts`. Blast radius partial: three more modified files (one past the 500-line threshold) for answers the exported route arrays already give.
  rejected: append the reader to `kernel/src/brain/context.ts`. Test cost no: `context.ts` is pure over its input and its tests build contexts with no store. Reading the store there would change every one of them.
  evidence: `grep -n "^export const .*Routes" kernel/src/gui/budget-audit.ts kernel/src/gui/schedules.ts kernel/src/console/output.ts` → `budgetAuditRoutes`, `schedulesRoutes`, `sessionOutputRoutes`; `kernel/src/triggers/routes.ts`: `body: { triggers: listTriggers(req.store, …) }`; `kernel/src/playbooks/drafts.ts`: `body: { playbooks: listPlaybooks(req.store, …) }`; requirement Touches names `kernel/src/brain/studio-view.ts`.
  revisit when: wa-e adds drill-down tools (they import this module's queries), or a route's handler starts writing.
  status: confirmed
- decision: how the section fits the prompt and its bounds
  chosen: `buildContext` gains an optional `studio?: string` input: the rendered section, built by the caller from the store. Absent means no section, so every existing context test is unchanged. The section is placed right before `## Now`. Like the guide, it is kept whole and its rendered length is taken out of the fill budget before any memory section is placed. It is rendered in a resumed thread too. `studioView` enforces its own limit, `MAX_STUDIO_VIEW_CHARS = 6_000` (rendered, heading and wrapper included). `MAX_CONTEXT_CHARS` rises from 82 000 to 88 000, and the sum pin in `kernel/test/brain-guide.test.ts` gains `MAX_STUDIO_VIEW_CHARS`.
  rejected: put the section in the fill list, cut like a memory file. Requirement: "it is never cut by the whole-context limit".
  rejected: keep 82 000 and let the memory files lose room. The sum pin (`expect(room).toBeLessThanOrEqual(MAX_CONTEXT_CHARS)`, room 81 000 today) would fail.
  evidence: `kernel/src/brain/context.ts`: `export const MAX_CONTEXT_CHARS = 82_000;` and `const budget = MAX_CONTEXT_CHARS - tail.length - NOTE_RESERVE - (guide === "" ? 0 : guide.length + 1);`; `git grep -n "82000"` → `kernel/test/brain.test.ts:850,851`, `kernel/test/playbooks-crew.test.ts:847`.
  revisit when: a further always-whole section is added.
  status: confirmed

## Acceptance Criteria
- [ ] AC1. Given a message to Wright, when its context is built (`kernel/src/brain/handler.ts` step c), then it carries a `## Studio right now` section built by `await studioView(store, "wright", …)` at that moment, with one labelled line group each for: crew members, each with whether it is on (`listAgents` `status`); playbooks on and off (`listPlaybooks`, `all: true`); triggers and the next time each fires (`listTriggers`, `all: true`, enabled with next fire in local time, disabled marked off); scheduled wakeups (the pending `wakeup` entries of `GET /schedule`); running sessions (`GET /sessions` with `status=running` and `status=starting`: id, agent, playbook, started); approvals waiting for the owner (`listApprovals`, pending: id, requesting agent, action); token use against each limit (`GET /budget/usage?days=1` `limits`: `tokens_today` / `tokens_per_day`, sessions running / at once, "no limit" when null) and every cap window whose `status` is not `allowed` (with its reset time); Wright's model and tool-policy status (passed in as `self`: step b's model, plus `readWrightToolPolicy` status and the count from `proposedToolsMissing`); and the line `Taken at: <local time line>`. An empty group says `none`.
- [ ] AC2. Given the same message, then the section ends with `Recent mistakes`: up to `MAX_RECENT_MISTAKES` (a kernel constant, 10) of this agent's failures from the last 24 hours, newest first, each one line `- <local time> <kind>: <why>`, from four sources: its `brain_messages` rows with status `failed` (the `detail`); `tool_decision` events with `decision` `deny` from its sessions (the `tool` and `reason`), leaving out `approval_required` (a held call, shown under waiting approvals), `dry_run` (a dry run denies by design) and `draft_mode` (the call is saved as draft output by design, `kernel/src/sessions/draft-mode.ts` and `kernel/src/sessions/manager.ts`); its approvals decided `deny` (the action); and failed `playbook_runs` of playbooks it owns (the slug and the `result_json` `error`). With none: `none in the last 24 hours`.
- [ ] AC3. Given a message to a crew member, then its section shows only that member's own items: playbooks and triggers whose `owning_agent` is the member, sessions whose `agent` is the member, approvals whose `requesting_agent` is the member, its own limit line and its own playbooks' limit lines, its own model and charter tool-policy status, and its own recent mistakes. It has no crew line and no wakeup line (a wakeup names no agent), and no other agent's id, slug or text appears (pinned with a second agent's seeded rows). Cap windows are account-wide, not another agent's items, so they are shown.
- [ ] AC4. Given more items than fit, then each group is cut at `MAX_STUDIO_GROUP_ITEMS` (8) with the line `… and <n> more not shown`, each item line at `MAX_STUDIO_LINE_CHARS` (200). If the rendered section would still pass `MAX_STUDIO_VIEW_CHARS` (6 000), groups are cut further from the end, each cut stated. The section never passes 6 000 characters, pinned by a test seeding hundreds of rows per source with maximal names. `buildContext` keeps it whole: its length comes out of the budget like the guide's, and with an oversized history the memory files are cut while the section is still whole (pinned). `MAX_CONTEXT_CHARS` is 88 000, and the sum pin includes `MAX_STUDIO_VIEW_CHARS`.
- [ ] AC5. Given a resumed thread (`resumed: true`), then the section is still included, built fresh, even though the guide and memory are not (`RESUMED_THREAD_LINE` names only the role, guide, memory and Loomwright summary, so it stays unchanged). A replayed thread and an approval's fresh start carry it too.
- [ ] AC6. Given text in the section that came from outside the owner (a playbook name or slug, a trigger's text, an approval payload or action, a session title, a failure detail), then it sits inside `<untrusted-data source="studio">` through `wrapUntrusted("studio", …)`, so a closing tag inside a playbook name is defused and cannot end the wrapper (pinned). Only the heading and one kernel line outside the wrapper ("read by the kernel at this moment…") are unwrapped.
- [ ] AC7. Given one source that throws when read (a test makes, for example, `listApprovals` or the schedule handler throw, or the route answers non-200), then that group's line reads `<group>: unavailable (<one-line reason>)`, every other group is present, and the message still starts its session. A route handler that rejects or answers a status other than 200 is treated the same way. `studioView` never throws and never rejects. An unexpected throw outside the per-source guards gives one line `Studio right now is unavailable: <reason>` in place of the section, and the session still starts.
- [ ] AC8. Given a playbook run (carried wa-a follow-up), when its prompt is built, then Wright's `playbookPrompt` passes `ctx.catalogue`, the session's `policy.allowedTools` and `studioView(store, "wright", …)` to `buildContext`, so its guide lists the session's tools, not `GUIDE_TOOLS_UNAVAILABLE`. A crew member's `crewPlaybookPrompt` renders `studioGuide(<member>, {catalogue, allowedTools})` right after `memory/<id>/role.md`, and the member's `studioView` before `## Now`. Both are kept whole within `MAX_CONTEXT_CHARS`, and a crew playbook prompt still never reads `memory/wright`. The "The playbook prompts do not get the catalogue yet" Known-limits line is removed from `docs/architecture/brain.md`, and `docs/architecture/playbook-runs.md` describes the guide and the section.
- [ ] AC9. Given any build of the section, then the view adds no write of its own: nothing is written to the store or the data dir. A test compares the store's total changes, the `events` count and a listing of the data dir before and after, for a crew member and for Wright. Wright's case runs twice: with `wright.json` absent (the view must not create it, because it never calls `readWrightSettings`) and with a current `wright.json` under a registered `registerProposedToolsAudit` sink. One known limit is stated in `docs/architecture/brain.md`: `GET /budget/usage`'s `limitsOf` reads each agent's settings through `rosterOf`, and that reader can run wa-c's audited upgrade of an unedited past list. For a Wright message the handler builds the view after step b, whose `readWrightSettings` has already run any upgrade, so that read is a no-op there. For a crew member's message or a crew playbook run, Wright's settings are not read first, so the view can run wa-c's audited upgrade of an unedited past Wright list once, exactly as the owner's own `GET /budget/usage` does (a backup and one `wright_tool_policy_upgraded` event). The view itself writes nothing else. A test pins this: a crew view with an unedited past Wright list under a registered sink records exactly that one event and nothing more, and with a current list records nothing.
- [ ] AC10. Given the merged change, then a committed evidence file `docs/evidence/wa-d-studio-right-now.md` records Validation 2's static half. It holds the commands run and the section's line groups and counts produced by `studioView` over a read-only copy of the owner's store (copied with `sqlite3 … ".backup"` into a temp dir; no kernel is started against the owner's data dir, and nothing is written to it). Only group names, counts and kinds are recorded, never payload, playbook or failure text. It also holds the kernel suite's result line and the line `Verdict: PASS for Validation 2 (static half; the live "what's going on in Studio?" ask is the owner's)` at column 0. The live ask on the owner's install (one approval waiting, one failed message) is listed as the owner's step, never run by the worker. The PR body links to the file.

## Owner conditions (binding)
Given by the owner at the Launch Pad save gate (LP-SAVE-NOTE, 2026-11-28), verbatim:
> The worker must resolve both MEDIUM issues in the build: add the missing pin-mutation rows, so each changed pin (the brain-threads exact pins, the 82000-to-88000 literals, the AC9 crew-view pin, the AC5 replay path, the AC7 fallback) is shown to fail on a mutation, and keep brain.test.ts under its size limit (split rather than grow it past 1374 lines). The PR body should list each fix.

This section was added after the final Plan Review (attempt 3/3), on the owner's instruction. It adds no new scope: it makes binding the two MEDIUM issues listed under `## Plan Review`.

## Scope widening
- docs/architecture/playbook-runs.md
- docs/evidence/wa-d-studio-right-now.md
- kernel/src/playbooks/runs.ts
- kernel/test/brain-guide.test.ts
- kernel/test/brain-threads.test.ts
- kernel/test/playbooks-crew.test.ts
- accepted: LP-SCOPE 2026-11-28

## Touched-file invariants

> Grounded at base `873fb241c1f9be4612ce40f4976de0b00c648aaa`. The worker re-checks every entry before hand-back.

- **`kernel/src/brain/context.ts`** (300 lines). Keep: `buildContext` stays pure over its input (no store read). Studio's text arrives as `studio?: string`, and with it absent the output is byte-identical to today. "The guide is kernel text, never read from a file and never cut: its length is taken out of the fill budget before any memory section is placed": the section follows the same rule. The time, history and message stay "always kept whole". `wrapUntrusted` / `defuseWrapperTags` are the only wrapper (`/** Defuse \`<untrusted-data\` and \`</untrusted-data\` inside wrapped text… */`). The import comment "the `studio` CLI loads this module" holds: `context.ts` gains no import (it neither imports `studio-view.ts` nor any store reader), so its header's import list (lines 34-38) is unchanged. Mirror: the module header comment lists the sections in order and gains the Studio section and its resumed-thread rule. `RESUMED_THREAD_LINE` is pinned by `kernel/test/brain-guide.test.ts` (imported there), so any wording change updates that pin. Pinned by: `kernel/test/brain-guide.test.ts` ("MAX_CONTEXT_CHARS leaves the memory files their room…", whose sum gains `MAX_STUDIO_VIEW_CHARS`), `kernel/test/brain.test.ts:850-851` (`context limit 82000` becomes `88000`).
- **`kernel/src/brain/handler.ts`** (503 lines, past the 500-line threshold). Reason for appending: step c is the one place the context is built, so the change is one `studioView(...)` call computed once with `now()`, and the field passed in `contextOf`; all logic lives in `studio-view.ts`. Keep: "the handler never awaits the session, so the loop is never blocked"; the import rule "Imports only types from the loop and the session manager (never the manager itself or the Agent SDK: the `studio` CLI loads this module)", which `studio-view.ts` must keep too (it imports no `../sessions/manager.js`, `../budget/cap.js` or `../budget/index.js`, which import the SDK at runtime; `../console/output.js` imports only a type from it). Mirror: the header's step c line ("c. the context (`buildContext`, the agent's own memory, and the Studio guide's tool list…)") names the Studio section.
- **`kernel/src/playbooks/runs.ts`** (930 lines, past the threshold). Reason for appending: the two prompt builders live here, and the change is input fields and one rendered section each. Keep: `crewPlaybookPrompt` "never calls `buildContext` and never reads `memory/wright`"; its `throw new TypeError(...)` for a non-crew id; "the heading, instruction, item block, time and line are always kept". The new guide and Studio section join the kept parts, so `const budget = MAX_CONTEXT_CHARS - heading.length - instruction.length - item.length - tail.length - CREW_NOTE_RESERVE;` also subtracts them. The comment block at lines 51-52 ("h. the prompt (`playbookPrompt` for Wright, `crewPlaybookPrompt` for a crew member…") is updated. Mirror: the header's import list (lines 65-73, ending "never the Agent SDK or the session manager") gains `../brain/studio-view.js` and `../brain/guide.js`. Their whole runtime graph (the three route modules, approvals store, agents registry, budget internals) must stay SDK-free, as must handler.ts's. This is pinned by `kernel/test/feature-seams.test.ts` (`SDK_IN_GRAPH`), which must stay green. `studio-view.ts` imports no `../budget/cap.js`, `../budget/index.js` or `../sessions/manager.js`. The value is awaited inside the async start step, so `playbookPrompt` / `crewPlaybookPrompt` stay synchronous. Pinned by: `kernel/test/playbooks-crew.test.ts:847` (`context limit 82000` becomes `88000`) and the crew prompt's section-order assertions in that file, which must stay green with the guide inserted after `role.md`.
- **`kernel/src/brain/studio-view.ts`** (create). Mirror: the route reuse in Design decision 1. The read-only request literal is typed `ContributedRouteRequest` (`kernel/src/features/contribution.ts`: "Optional in the type so a request literal built without it (a test calling a handler directly) still typechecks"). Each source is wrapped in its own try/catch, and so is the whole function (AC7). Every timestamp shown goes through `formatZoned` (`kernel/src/triggers/cron.js`), as `localTimeLine` does.
- **`kernel/test/brain-guide.test.ts`**, **`kernel/test/brain.test.ts`**, **`kernel/test/playbooks-crew.test.ts`**: only the sum and the `82000` literals change. No assertion is loosened. `playbooks-crew.test.ts:843-846` gives the memory about 18 800 characters and expects role.md's file-limit note. Those calls pass no `studio` and no catalogue, so the inserted crew guide is its no-tool size (about 4 700, `docs/architecture/brain.md` Bounds), under the about 10 600 that would cut role.md. The worker measures `studioGuide("mason", {})` there and, if a line must change, names it in the PR body.
- **`kernel/test/brain-threads.test.ts`** (904 lines). Lines 278 and 376 pin the handler's prompt exactly: `expect(s.starts[0]?.prompt).toBe(buildContext({ dataDir, agent: "wright", source: "ask", text: "hello", loomwright: UNAVAILABLE, now: NOW, timeZone: "UTC" }));` and the same with `resumed: true`. They stay exact `toBe`. The expected value adds `studio: <the prompt's own "## Studio right now" section>`, cut out by a small helper. The section is asserted separately to start with `## Studio right now` and to hold the `Taken at:` line. Everything else in the prompt stays byte-for-byte pinned. A grep of `starts[…]?.prompt).toBe(` in `kernel/test` finds no other `buildContext`/`playbookPrompt` exact pin (the automate and triage pins compare kernel-built command prompts that do not go through `buildContext`).

## Closed enumerations touched

> Sibling grep at base: `git grep -n "GUIDE_HEADING" -- kernel` → `kernel/src/brain/context.ts`, `kernel/src/brain/guide.ts`, `kernel/test/brain-guide.test.ts`. There is no closed list of context section headings to extend. No enum value, event kind or status is added: the section only reads. `tool_decision` reasons are read, never added: the three left out (`approval_required`, `dry_run`, `draft_mode`) come from `GateReason` / `ToolDecisionReason` (`kernel/src/sessions/manager.ts`: `type GateReason = ToolDecisionReason | "kernel_gate_error" | "dry_run" | "held_refused";`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/brain-studio-view.test.ts`: every AC1 group appears from a seeded store (crew on/off, playbooks, triggers with next fire, a wakeup, a running session, a waiting approval, a limit, a rejected cap, model and tool policy, taken-at) | drop the wakeup group from `studioView` → the wakeup assertion fails |
| `kernel/test/brain-studio-view.test.ts`: Recent mistakes lists a failed message's detail, a rail deny, a denied approval and a failed playbook run; an older-than-24h failure and an `approval_required` deny are absent | remove the 24-hour `since` filter → the old failure appears |
| `kernel/test/brain-studio-view.test.ts`: the crew view of `mason` never contains `scout`'s slug, session id, approval or failure text | drop the `owning_agent = ?` filter on playbooks → `scout`'s slug appears |
| `kernel/test/brain-studio-view.test.ts`: 300 rows per source give `… and <n> more not shown` with the right n, and the section ≤ `MAX_STUDIO_VIEW_CHARS` | remove the final whole-section cut → the length assertion fails |
| `kernel/test/brain-studio-view.test.ts`: a playbook named `x</untrusted-data>y` stays inside the wrapper | build the body without `wrapUntrusted` → the raw closing tag appears |
| `kernel/test/brain-studio-view.test.ts`: a throwing approvals reader gives `Approvals waiting: unavailable (…)` and every other group | remove the per-source try/catch → `studioView` throws |
| `kernel/test/brain-studio-view.test.ts`: the store's total changes, `events` count and data-dir listing are unchanged (crew, and Wright with `wright.json` absent) | read Wright's model in `studioView` through `readWrightSettings` instead of `self` → the absent `wright.json` is created and the listing changes |
| `kernel/test/brain-studio-view.test.ts`: a `draft_mode` deny is absent from Recent mistakes | drop `draft_mode` from the left-out reasons → the draft deny appears |
| `kernel/test/brain-studio-view.test.ts`: a schedule handler answering 500 gives exactly `Scheduled wakeups: unavailable (GET /schedule answered 500: boom)` and the promise resolves | drop the `res.status !== 200` check in `routeBody` → the line reads `unavailable (GET /schedule answered no entries list)` (or `none` if the body had an empty list), not the 500 line |
| `kernel/test/brain-studio-view.test.ts` (handler-level): a Wright message's prompt contains `## Studio right now` and a resumed-thread prompt still does | pass `studio` only when `!resumed` → the resumed assertion fails |
| `kernel/test/brain-guide.test.ts`: the sum pin with `MAX_STUDIO_VIEW_CHARS` | leave `MAX_CONTEXT_CHARS` at 82 000 → the sum (87 000) exceeds it |
| `kernel/test/brain-studio-view.test.ts`: with an oversized history the memory is cut and the section is whole | put the section in the fill list → the section is cut |
| `kernel/test/brain-studio-view.test.ts` (playbook prompts): Wright's playbook prompt lists an allowed tool and not `GUIDE_TOOLS_UNAVAILABLE`; the crew playbook prompt holds the crew guide after `role.md` and its own Studio section | drop `catalogue` from the `buildContext` call in `playbookPrompt` → the unavailable line appears |
| `kernel/test/brain-studio-view.test.ts` (playbook prompts): the crew playbook prompt holds the crew guide after `role.md` | drop the `kept.splice(…, guide)` in `crewPlaybookPrompt` → the guide and order assertions fail |
| `kernel/test/brain-threads.test.ts:278` (exact `toBe` pin of the fresh prompt, `studio:` the prompt's own section) | pass `studio` only when `resumed` → `studioOf` finds no `## Studio right now` and the pin fails; or render the section after `## Now` → the exact pin fails |
| `kernel/test/brain-threads.test.ts:376` (exact `toBe` pin of the resumed prompt) | pass `studio` only when `!resumed` → `studioOf` finds no heading in the resumed prompt and the pin fails |
| `kernel/test/brain.test.ts:850-851` (`context limit 88000` literals) | leave `MAX_CONTEXT_CHARS` at 82 000 → the cut notes say `context limit 82000` and both matches fail |
| `kernel/test/playbooks-crew.test.ts:847` (`context limit 88000` literal) | leave `MAX_CONTEXT_CHARS` at 82 000 → the lessons.md cut note says `82000` and the match fails |
| `kernel/test/brain-studio-view.test.ts` (AC9): a crew view with `wright.json` absent leaves the store's changes, `events` and the data-dir listing unchanged | call `readWrightSettings(store.dataDir)` before the budget read in the crew view → `wright.json` is created and the listing differs |
| `kernel/test/brain-studio-view.test.ts` (AC9): a crew view with an unedited past Wright list under a registered sink records exactly one `wright_tool_policy_upgraded` event, one backup file, one store change; a second view records nothing | make the crew view skip the `GET /budget/usage` read → no event is recorded and the `["wright_tool_policy_upgraded"]` assertion fails (any extra write the view adds also changes the counted one-change delta) |
| `kernel/test/brain-studio-view.test.ts` (AC5, handler-level): the replayed thread's prompt carries the section before `## Now` | build the replay start's prompt with `buildContext` and no `studio` → `studioPart` finds no heading |
| `kernel/test/brain-studio-view.test.ts` (AC5, handler-level): an approval decision's fresh start carries the section | build the fresh prompt of an `approval:<id>` message without `studio` → `studioPart` finds no heading |
| `kernel/test/brain-studio-view.test.ts` (AC7): a throw outside every source's guard (an invalid `now`) resolves to exactly `## Studio right now\n\nStudio right now is unavailable: Invalid time value\n` | remove the outer try/catch in `studioView` → it rejects with `RangeError: Invalid time value` |
| `kernel/test/brain-studio-view.test.ts` (AC3): mason's view never contains `scout` or a `wr-` item, and has no Crew or Scheduled wakeups group | scope the view as Wright's for every agent (`wright: true`) → scout's items and the crew group appear |
| `kernel/test/brain-studio-view.test.ts` (AC4): with 300 rows per source the section is at most 6 000 | remove both the cut-from-the-end loop and the last-resort cut → the length assertion fails |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: Studio-right-now reader, context and playbook prompt wiring, docs and evidence | AC1–AC10 | 9 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel (subtask 1) | `kernel/src/brain/context.ts` (300), `kernel/src/brain/handler.ts` (503: one call and one field; reason above), `kernel/src/playbooks/runs.ts` (930: input fields and one section per builder; reason above), `kernel/test/brain-guide.test.ts` (358), `kernel/test/brain.test.ts` (the two `82000` literals), `kernel/test/playbooks-crew.test.ts` (874: the one `82000` literal), `kernel/test/brain-threads.test.ts` (904: the two exact prompt pins at lines 278 and 376), `docs/architecture/brain.md` (428: the section, the bounds paragraph at 88 000, and the Known-limits line removed and replaced by "the section costs tokens on every message, at most 6 000 characters"), `docs/architecture/playbook-runs.md` (the prompt paragraph) | `kernel/src/brain/studio-view.ts` (reader, groups, mistakes queries, bounds, constants), `kernel/test/brain-studio-view.test.ts` (reader, handler and playbook-prompt cases; a new file because `playbooks-crew.test.ts` is 874 lines and `brain-threads.test.ts` 904, past the threshold), `docs/evidence/wa-d-studio-right-now.md` | HIGH (crew prompt section-order pins MEDIUM) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/brain/studio-view.ts"}
  - {kind: "symbol", path: "kernel/src/brain/studio-view.ts", name: "studioView"}
  - {kind: "symbol", path: "kernel/src/brain/studio-view.ts", name: "MAX_STUDIO_VIEW_CHARS"}
  - {kind: "symbol", path: "kernel/src/brain/studio-view.ts", name: "MAX_RECENT_MISTAKES"}
  - {kind: "file", path: "kernel/test/brain-studio-view.test.ts"}
  - {kind: "file", path: "docs/evidence/wa-d-studio-right-now.md"}
requires: []
lanes:
  - "kernel/src/brain/studio-view.ts"
  - "kernel/src/brain/context.ts"
  - "kernel/src/brain/handler.ts"
  - "kernel/src/playbooks/runs.ts"
  - "kernel/test/brain-studio-view.test.ts"
  - "kernel/test/brain-threads.test.ts"
  - "kernel/test/brain-guide.test.ts"
  - "kernel/test/brain.test.ts"
  - "kernel/test/playbooks-crew.test.ts"
  - "docs/architecture/brain.md"
  - "docs/architecture/playbook-runs.md"
  - "docs/evidence/wa-d-studio-right-now.md"
external_requires:
  - "read-only access to the owner's Studio store (copied with sqlite3 .backup to a temp dir) for AC10"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | — | n/a |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Untrusted names and failure details in the section are a prompt-injection surface | HIGH | AC6: one `wrapUntrusted("studio", …)` wrapper with tags defused, pinned with a hostile playbook name. |
| Token cost on every message (up to 6 000 characters, about 1 500 tokens), real spend on the API key (D42) | MEDIUM | Fixed limit `MAX_STUDIO_VIEW_CHARS`, per-group and per-line cuts; docs Known limits states the cost. |
| A crew member seeing another agent's items breaks the D8 boundary | HIGH | AC3, pinned with a second agent's seeded rows across every source. |
| Calling route handlers in-process ties the view to their response shape | MEDIUM | The view reads only documented contract fields (`entries`, `sessions`, `limits`, `cap_state`); a non-200 or reshaped answer becomes that group's "unavailable" line (AC7), never a throw. |
| Raising `MAX_CONTEXT_CHARS` to 88 000 | LOW | Only the sum pin and three `82000` literals change. The memory files keep their room. |
| The crew playbook prompt's existing section-order assertions break when the guide is inserted after `role.md` | MEDIUM | Run `kernel/test/playbooks-crew.test.ts` in full. The guide is placed exactly where Wright's sits (after `role.md`). |
| Feasibility (Phase 2.5): context limit has no room | MEDIUM | Design decision 2. |
| Feasibility (Phase 2.5): files outside Touches | MEDIUM | Asked once at Phase 6 (`LP-SCOPE`). Every path is listed in the File Impact Map. |
| Validation 2's live half needs a real Wright session on the owner's install (production, real spend) | MEDIUM | AC10 records the static half read-only. The live ask is the owner's step, listed in the PR body as not verified. |

## Plan Review
- **Decision:** PASS (attempt 3/3)
- **Deferred (at the fix floor, no review attempt left; the worker resolves each before hand-back):**
  - MEDIUM (pin mutations): add Pin mutations rows for the brain-threads.test.ts:278/376 exact pins (mutation: pass `studio` only when `!resumed` → line 376 fails), the `82000`→`88000` literals, AC9's crew-view one-event pin (call `readWrightSettings` before `limitsOf` in the crew view → a file or event appears in the absent-file case), AC5's replay and approval fresh-start paths (omit `studio` on the replay path → the replay prompt lacks the heading), and AC7's whole-function fallback (remove the outer try/catch and make `listAgents` throw → `studioView` rejects). Reword the schedule-500 row so it holds however the code reads a missing `entries`: assert on the `unavailable` line, not on `none`.
  - MEDIUM (module layout): `kernel/test/brain.test.ts` is 1374 lines at base; the edit only updates its two `82000` pins.
  - LOW: a crew message can now be the first read to trigger wa-c's audited Wright tool-list upgrade, as `GET /budget/usage` already can. The PR body says this in one line.
  - LOW: the runs.ts invariant also keeps the header's "never `../brain/index.js` or `handler.js`: no runtime cycle" clause. The worker re-checks that `studio-view.ts`'s graph does not reach `brain/index.js` or `handler.js`.

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-28-wa-d-studio-right-now.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-28T13:51:49Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/319
- **Branch:** feature/wa-d-studio-right-now
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added kernel/src/brain/studio-view.ts (studioView: a bounded, untrusted-wrapped, crew-scoped "Studio right now" section ending with Recent mistakes, never rejects) and wired it into the handler's step c, resumed/replayed/approval prompts and both playbook prompts (which now also get the tool catalogue and, for crew, the crew guide); MAX_CONTEXT_CHARS 88000. Phase 4.5: round 1 PASS with one MEDIUM (restated route limits) fixed in 7a63531a; round 2 PASS, no findings. One LOW dismissed below the floor. Suite 5551 passed; CI green.

## Not verified
- **live Wright answer to 'what's going on in Studio?' on the owner's install** — needs a real Wright session in production with real spend (D42); the owner's step (subtask 1)
- **owner app screens showing the same facts** — app not run; the view reuses the routes' own handlers and readers (subtask 1)
