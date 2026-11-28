# Supervisor Job: wa-a — the kernel builds each agent's Studio guide, and role.md holds only who the agent is

## Environment
- **Project:** ~/orca/workspaces/loomwright-studio/starfish-clone (full clone; the linked worktree starfish could not check out main)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main (at origin/main)
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/wright-aware/2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is.md
- **Base commit:** 75963783c9cbc3484f5813a549cc5cb45acca8ad

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest (CLAUDE.md); the work is TypeScript text building and tests |
| 2 | Dependency Availability | GO | No new dependency: the tool list is rendered from `ToolCatalogue` (`catalogue.jobs`) and `KERNEL_TOOL_PREFIX` from `kernel/src/features/catalogue.ts` |
| 3 | Architecture Fit | GO | The kernel already owns the context (`buildContext`) and the catalogue (`kernelToolCatalogue`); the guide is kernel text, like `RESUMED_THREAD_LINE` and the untrusted-data frame. This fits invariant 8: memory stays the owner's files, and the guide is no memory file |
| 4 | Scope vs Supervisor Capability | CAUTION | 11 files to modify and 3 to create, about 14 changed files, which is borderline for `context-bound`. It stays one subtask because the role template, the brain doc and their pins must change together (see Configuration) |
| 5 | Hard Blockers | GO | None. The catalogue does not reach the brain handler today (`EventContext` has no catalogue), so it must be threaded through like `github` |

**Overall Verdict:** CAUTION

## Task
**Goal:** Every Wright and crew session's context carries a kernel-built **Studio guide**: the current rules, a plain-words glossary of Studio's concepts, and a tool list generated from the tool catalogue and the session's allowed tools. A fresh `memory/wright/role.md` then holds only Wright's persona.

**Problem Statement:**
The owner, talking to Wright and the crew, needs every agent to have the current and complete Studio rules on every message, because the rules change every release.
Currently the rules live in `memory/wright/role.md`, copied from `ROLE_TEMPLATE` once (`flag: "wx"`) and then never updated. On a fresh install that file is cut by 1,469 characters (`ROLE_TEMPLATE` is 9,469 characters, and `MAX_MEMORY_FILE_CHARS` is 8,000), which drops "## Untrusted text" and "## Memory". An existing install keeps a stale copy that lacks five later sections.
This leaves a fresh install's Wright without its untrusted-text guidance and leaves an old install's Wright with out-of-date rules.
Success looks like this: every non-resumed context carries the uncut guide for its agent, and the guide's tool list comes from the registered tools.

## Design decisions
- decision: where the Studio guide is built and how its tool list is made
  chosen: a new module `kernel/src/brain/guide.ts` that builds the Wright guide and the crew guide as kernel text, with the tool list rendered by a small helper in `guide.ts` as `- <name>: <purpose>` lines (the shape `catalogueText` uses: `...j.tools.map((t) => `- ${t.name}: ${t.purpose}${connectorNote(t)}`)`), walking `catalogue.jobs` in order and keeping only the tools whose `mcp__kernel__<name>` (`KERNEL_TOOL_PREFIX`) is in the session's `policy.allowedTools`, grouped under each job's label
  rejected: add the guide text to `kernel/src/brain/templates.ts` — partial on reversibility: that module's contract is "No imports: the `studio` CLI loads this module" and it holds first-run file text, while the guide needs the catalogue import and is never a file
  rejected: reuse `jobDisplayLines(allowedTools, catalogue)` — no on fit: it is the owner-facing charter display and prints only `job: <label>` and `  - <purpose>` lines, never tool names (`lines.push(`job: ${job.label}…`, ...(purposes ? tools.map((t) => `  - ${t.purpose}…`)`), so the agent could not call the tools it lists and the retargeted tool-name pins could never pass
  rejected: reuse `catalogueText(catalogue)` — partial on fit: it lists every tool in the catalogue (not the session's allowed ones) and carries charter-drafting rules for Wright only
  rejected: a hand-kept tool list in the guide (today's `## How you act` list) — no on test cost and blast radius: the requirement forbids it, and every new tool would need a text edit
  evidence: `grep -n "export function catalogueText\|export const KERNEL_TOOL_PREFIX" kernel/src/features/catalogue.ts` → `export function catalogueText(catalogue: ToolCatalogue): string {` (line 427) and `export const KERNEL_TOOL_PREFIX = "mcp__kernel__";` (line 153); `kernelToolNames` (line 577) and `connectorNote` (line 374) are module-private, so `guide.ts` strips the prefix itself and appends no connector note (the connector caveat is one line of guide text, see Risk Assessment). catalogue.ts is already imported CLI-side (`kernel/src/agents/charter-readiness.ts` calls it "the CLI-safe catalogue"), and its runtime import graph (`../tools/phase1-descriptions.js` → `../loop/wakeups.js` …) is SDK-free
  revisit when: the app needs to show the guide to the owner (it would then need a route, not only context text)
  status: confirmed
- decision: how the kernel's tool catalogue reaches the brain handler
  chosen: thread it like `github`. `EventLoopOptions.catalogue` becomes `EventContext.catalogue` (`kernel/src/loop/types.ts`, `kernel/src/loop/loop.ts`), and `startKernel` passes its existing `toolCatalogue` (`kernel/src/kernel.ts`)
  rejected: a duck-typed `toolCatalogue()` method on the session manager, read like `loomwrightStatus` — partial on blast radius and test cost: it touches `sessions/manager.ts` too and needs a manager fake, and the manager's job is sessions, not the composition's tools
  rejected: have the handler build its own catalogue from the shipped contributions — no on test cost: a tool registered in a test composition would never appear (the requirement's validation 1 case), and it pulls non-CLI-safe modules into a module the `studio` CLI loads
  evidence: `grep -n "github" kernel/src/loop/loop.ts` → `...(this.#github === undefined ? {} : { github: this.#github }),` at both the due-work and the handler context; `kernel/src/kernel.ts` already holds `const toolCatalogue = kernelToolCatalogue(`
  revisit when: a second per-composition value has to reach handlers (then group them in one options object)
  status: confirmed

## Acceptance Criteria
- [ ] AC1. Given any message to Wright (a non-resumed context), when its context is built, then it carries a kernel-built **Studio guide** section that is not read from a memory file. The section holds today's "How you act", "Who decides", "Where the owner acts", crew, duty-drafting, tickets-to-PRs, PR-comment-triage, "Untrusted text" and "Memory" rules, and a glossary that says in plain words what a session, a chat thread, a crew member, a playbook, a trigger, a schedule and a wakeup, an event, an approval, the settings and the budget are, and where the owner sees each in the app.
- [ ] AC2. Given the guide's tool list, when the context is built for a session, then the list is generated from the kernel's tool catalogue (`kernel/src/features/catalogue.ts`) and the session's own `policy.allowedTools`, never from a hand-kept list. So a tool registered in a test composition and allowed to the session appears in the guide, and a tool the session is not allowed does not appear.
- [ ] AC3. Given a message to a crew member, when its context is built, then it carries the crew variant of the guide, placed right after its charter `memory/<id>/role.md`. The crew variant has the same glossary and the same "Untrusted text" and "Memory" rules, plus how a crew member acts and reports back. The charter's prose (`renderRoleMd` in `kernel/src/agents/charter-files.ts`) is unchanged.
- [ ] AC4. Given a fresh data dir, when Wright's files are created (`ensureMemoryFiles`), then `memory/wright/role.md` (`ROLE_TEMPLATE`) holds only who Wright is: the name, the voice, "you propose, the owner decides" and keeping replies short. It also says that the Studio guide is supplied by the kernel. `docs/architecture/brain.md` shows the new `ROLE_TEMPLATE` verbatim, and `kernel/test/brain.test.ts` pins it.
- [ ] AC5. Given the guide, then it is never cut. The guide is kept whole like the time, the history and the message: `buildContext` takes its rendered length out of the fill budget before placing any memory section, and renders it right after `role.md` for Wright and for crew. A test pins that the Wright guide fits `MAX_WRIGHT_GUIDE_CHARS` and the crew guide fits `MAX_CREW_GUIDE_CHARS`, each measured at its largest (with every catalogue tool allowed). A test also pins that `MAX_CONTEXT_CHARS` leaves the memory files their room: the larger guide limit + `MAX_MESSAGE_CHARS` + `MAX_THREAD_HISTORY_TOTAL_CHARS` × 1.25 + the four memory files at `MAX_MEMORY_FILE_CHARS` + `MAX_MANIFEST_CHARS` + the note reserve + 1,000 (the time line and headings) ≤ `MAX_CONTEXT_CHARS`. Raise `MAX_CONTEXT_CHARS` for this. A third test builds a Wright context and a crew context, each with maximal thread references, all four memory files at 200,000 characters and the largest guide, and asserts that the guide is present whole while the memory cut notes still appear. The memory files' cut notes stay as today; only the limit in their text changes.
- [ ] AC6. Given an existing `memory/wright/role.md` that still holds an old manual (for example today's full `ROLE_TEMPLATE`), when the context is built, then it still builds: the old text is read as persona, the guide is still added, and nothing is refused or rewritten. Replacing the file is wa-b's job.
- [ ] AC7. Given a resumed thread (`resumed: true`), when its context is built, then the guide is left out like the memory sections, since the resumed conversation already has it, and `RESUMED_THREAD_LINE` names the guide among what is not repeated.
- [ ] AC8. Given that the tool catalogue cannot be built (no catalogue on the context, or `kernelToolCatalogue` returned `null`), when the context is built, then the guide says in one line that the tool list is unavailable, and the rest of the guide is still present. `guide.ts` writes its own unavailable line and does not reuse `DISPLAY_CATALOGUE_UNAVAILABLE` (whose text points to an `enforced line below` that the guide does not have); it checks for an absent catalogue before rendering any tool line. When the session allows no kernel tools, the guide says so in one line instead of showing an empty list.
- [ ] AC9. Given requirement validation step 2 (running system), when the owner's install runs the merged kernel, then a committed evidence file `docs/evidence/wa-a-studio-guide.md` holds both questions put to Wright: "what is a playbook and where do I turn one off?" and "what do you do with text inside untrusted-data tags?". It holds each reply verbatim in a fenced block, and the declared line `Verdict: PASS for Validation 2` at column 0, outside any fence, only when both replies follow the guide. The PR body links to the file. If the worker cannot reach a live install, the file instead holds the kernel-level probe it did run (the built context's section headings for Wright and for a crew member) and says that the live check is the owner's. It then carries no `Verdict:` line, so nothing claims a run that did not happen.

## Scope widening
- docs/architecture/playbook-runs.md
- docs/evidence/wa-a-studio-guide.md
- kernel/src/kernel.ts
- kernel/src/loop/loop.ts
- kernel/src/loop/types.ts
- kernel/test/brain-guide.test.ts
- kernel/test/drafts-are-records.test.ts
- kernel/test/playbooks-crew.test.ts
- accepted: LP-SCOPE 2026-11-28

## Touched-file invariants

> Grounded at base `75963783c9cbc3484f5813a549cc5cb45acca8ad`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/brain/context.ts`**:
  - keep: never throws for a missing file or a broken Loomwright (`Never throws for a missing or unreadable memory file or shared folder`); the time, history and message stay whole and the fill sections are cut in order with a note (`The first section that does not fit is cut to what is left; the rest are dropped. Each is noted.`); untrusted text stays wrapped (`wrapDefused(source, defuseWrapperTags(kept))`). The guide is kernel text: never wrapped, and never containing a literal `<untrusted-data ` (with a space) or `</untrusted-data>`, because `kernel/test/brain.test.ts` counts wrappers with `prompt.split("<untrusted-data ")`.
  - reuse: `render(` / `Section` for the guide section, and `cutNote(`.
  - mirror: the module's own import rule (`Imports only \`node:*\`, its siblings, the Loomwright adapter's pure`), where `guide.ts` is a sibling. When the header's import list is updated, name `../features/catalogue.js` there as the CLI-safe catalogue (SDK-free graph).
  - pinned by: `kernel/test/brain.test.ts` (`… truncated: memory/wright/role.md, 500 chars cut (file limit 8000)`, `(context limit 32000)` and `expect(p.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS)`) and `kernel/test/brain-threads.test.ts`, whose `buildContext({ dataDir, agent: "wright", source: "ask", text: "hello", loomwright: UNAVAILABLE, now: NOW, timeZone: "UTC" })` must still equal the handler's prompt. So the guide's input must be optional, and an absent catalogue must give exactly the same text as a handler context with no catalogue.
- **`kernel/src/brain/templates.ts`**:
  - keep: `No imports: the \`studio\` CLI loads this module` and the write-once rule (`Each is written once, when the file is absent, and`).
  - pinned by: `kernel/test/brain.test.ts` (`.toBe(ROLE_TEMPLATE)` against the `docs/architecture/brain.md` block, and `ROLE_TEMPLATE.indexOf("## Drafting a duty")` and its siblings, which move to the guide) and `kernel/test/drafts-are-records.test.ts` (`const flat = ROLE_TEMPLATE.replace(/\s+/g, " ");`, whose drafts-are-records sentence moves to the guide).
- **`kernel/src/brain/handler.ts`**:
  - keep: `Imports only types from the loop and the session manager (never the` (a type-only import of `ToolCatalogue` is fine); the context step's place (`// c. The context`).
  - reuse: the one `contextOf = (extra: Pick<ContextInput, "history" | "resumed">)` closure, so the resume, replay and fresh starts all get the same guide input.
  - fired by: `brainMessageHandler(` in `kernel/src/brain/index.ts`.
- **`kernel/src/loop/types.ts`, `kernel/src/loop/loop.ts`**:
  - keep: the type-only rule (`Type-only, so a module that handles events never imports the`).
  - mirror: the `github` threading exactly (`...(this.#github === undefined ? {} : { github: this.#github }),`); an absent option adds no key to the context.
  - pinned by: the loop tests, which build `new EventLoop({ store, handlers: … })` with no catalogue and must stay green.
- **`kernel/src/kernel.ts`**:
  - keep: the existing `const toolCatalogue = kernelToolCatalogue(` is the one catalogue; pass it to `new EventLoop(` only when it is not null, under the loop option's own key, `...(toolCatalogue === null ? {} : { catalogue: toolCatalogue })`, and never under the API server's key `{ toolCatalogue }`. Build no second catalogue.
- **`kernel/test/brain-crew-routing.test.ts`**:
  - keep: a crew prompt never contains Wright's role heading (`expect(prompt).not.toContain(ROLE_TEMPLATE.split("\n")[0] as string);`), and it is a substring check, so the crew guide must never contain the substring `# Wright` anywhere (no heading of any level may start with "Wright").
- **`kernel/test/playbooks-crew.test.ts`**:
  - keep: `crewPlaybookPrompt` (`kernel/src/playbooks/runs.ts`) budgets with the shared `MAX_CONTEXT_CHARS`, so raising it changes this pin. Update `(context limit 32000)` in `expect(prompt).toMatch(/… truncated: memory\/mason\/lessons\.md, \d+ chars cut \(context limit 32000\)/);` to the new limit, and keep its intent through the part of the prompt that is always kept. Growing the fixture files does nothing, because `crewPlaybookPrompt` cuts each file to `MAX_MEMORY_FILE_CHARS` (8,000) before it budgets (`readMemoryFile(input.dataDir, `${input.agent}/${file}`, MAX_MEMORY_FILE_CHARS)`, `kernel/src/playbooks/runs.ts`). So, in a second `crewPlaybookPrompt` call (the existing call and its `startsWith` assertion on the original input stay as they are), pass a large `intent` (always kept: `the heading, instruction, item block, time and line are always kept`) sized from the new limit, for example `MAX_CONTEXT_CHARS - 20_000`, keep the four 9,000-character files, and assert that `lessons.md` is still cut by the context limit, with the new limit written as a literal in the regex. `kernel/src/playbooks/runs.ts` itself is not changed.
- **`kernel/test/brain.test.ts`, `kernel/test/drafts-are-records.test.ts`, `docs/architecture/brain.md`, `docs/architecture/playbook-runs.md`**:
  - keep: the doc mirrors `ROLE_TEMPLATE` verbatim (`### The first-run \`role.md\``), and it shows the guide's moved sections (duty drafting, tickets to PRs, PR comment triage) verbatim in a new guide subsection, so the doc halves of the `brain.test.ts` pins that read `brain.md` stay and are retargeted to the guide's text; the context section lists every part in order (`## The context a session gets`); the playbook doc's Wright prompt line (`Wright's usual context ([brain](brain.md#the-context-a-session-gets))`) stays true once the guide is in that context.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/brain-guide.test.ts`: the Wright context holds the guide with every glossary term (AC1) | in `kernel/src/brain/context.ts`, drop the guide section from the non-resumed fill list |
| `kernel/test/brain-guide.test.ts`: a tool from a test composition appears in the guide, and a tool that is not allowed does not (AC2) | in `kernel/src/brain/guide.ts`, render the tool lines from every catalogue tool instead of the session's `allowedTools` |
| `kernel/test/brain-guide.test.ts`: the handler's prompt carries a test composition's tool, end to end through `EventContext.catalogue` (AC2) | in `kernel/src/loop/loop.ts`, delete the line that spreads `catalogue` into the handler's `EventContext` |
| `kernel/test/brain-guide.test.ts`: the crew guide comes right after `memory/<id>/role.md` (AC3) | in `kernel/src/brain/context.ts`, place the crew guide after the shared notes instead |
| `kernel/test/brain-guide.test.ts`: the guide limits fit, and `MAX_CONTEXT_CHARS` leaves the memory files their room (AC5) | in `kernel/src/brain/context.ts`, set `MAX_CONTEXT_CHARS` back to `32_000` |
| `kernel/test/brain-guide.test.ts`: a resumed context has no guide (AC7) | in `kernel/src/brain/context.ts`, add the guide to the resumed fill list |
| `kernel/test/brain-guide.test.ts`: no catalogue gives the one unavailable line, with the rest of the guide present (AC8) | in `kernel/src/brain/guide.ts`, return an empty guide when the catalogue is absent |
| `kernel/test/brain.test.ts`: a fresh `role.md` is persona only and says the kernel supplies the guide (AC4) | in `kernel/src/brain/templates.ts`, append today's `## Untrusted text` section to `ROLE_TEMPLATE` |
| `kernel/test/brain.test.ts`: "the role template sends the owner to the app's controls, not to studio commands", retargeted to the Wright guide | in `kernel/src/brain/guide.ts`, delete the `## Where the owner acts` section |
| `kernel/test/brain.test.ts`: "the duty-drafting guidance calls every value a proposal and names no concrete value (AC6)", retargeted to the Wright guide | in `kernel/src/brain/guide.ts`, delete the line holding `Never pick a` from the duty-drafting section |
| `kernel/test/brain.test.ts`: "… list the six playbook tool names (AC6)", retargeted to the guide's generated tool list with every catalogue tool allowed: each name in `PLAYBOOK_TOOL_NAMES` appears as a `- <name>: ` line | in `kernel/src/brain/guide.ts`, filter the tool lines to drop every `kernel_playbook_` tool |
| `kernel/test/brain.test.ts`: the four crew tool names (`AGENT_TOOL_NAMES`), retargeted to the guide's generated tool list with every catalogue tool allowed: each appears as a `- <name>: ` line | in `kernel/src/brain/guide.ts`, render each tool line from `t.purpose` only, without `t.name` |
| `kernel/test/brain.test.ts`: "… names the four automate runner tools and the two playbook shapes …", retargeted to the Wright guide | in `kernel/src/brain/guide.ts`, delete the line holding `kernel_automate_prepare(repo, tickets)` |
| `kernel/test/brain.test.ts`: "… names kernel_pr_route, its four routes and the three triage outcomes …", retargeted to the Wright guide | in `kernel/src/brain/guide.ts`, delete the line holding `- reply_only:` |
| `kernel/test/brain.test.ts`: "… list the four crew tool names, and the template says how Wright treats a crew", retargeted to the Wright guide | in `kernel/src/brain/guide.ts`, delete the line holding `Never act as a crew member or claim its work as yours.` |
| `kernel/test/brain-guide.test.ts`: `RESUMED_THREAD_LINE` names the guide among what is not repeated (AC7) | in `kernel/src/brain/context.ts`, drop the guide's name from `RESUMED_THREAD_LINE` |
| `kernel/test/brain-guide.test.ts`: with maximal thread references and full memory files, the guide is whole and the memory cut notes appear (AC5) | in `kernel/src/brain/context.ts`, put the guide into the fill list (cut like a memory section) instead of reserving its length |
| `kernel/test/brain-guide.test.ts`: an old full manual in `role.md` still builds, read as persona, and the guide is still added (AC6) | in `kernel/src/brain/context.ts`, skip the guide when `role.md` contains `## How you act` |
| `kernel/test/drafts-are-records.test.ts`: the drafts-are-records sentence, retargeted from `ROLE_TEMPLATE` to the Wright guide | in `kernel/src/brain/guide.ts`, delete the line holding `draft it straight into the held approval` |
| `kernel/test/brain.test.ts`: the updated context-limit cut pins (`(context limit <new limit>)`) | in `kernel/src/brain/context.ts`, drop the `notes.push(cutNote(section.name, section.body.length - kept.length, false, …))` for the context limit |
| `kernel/test/playbooks-crew.test.ts`: in a second `crewPlaybookPrompt` call with a large always-kept `intent` sized from the new limit, `lessons.md` is still cut by the context limit, the regex stating the new limit as a literal (`(context limit <new limit>)`) | in `kernel/src/brain/context.ts`, set `MAX_CONTEXT_CHARS` back to `32_000` (the literal in the regex then no longer matches) |
| `kernel/test/brain.test.ts`: with an oversized `history`, the Loomwright summary is still cut inside its wrapper (`sawCut`) and `lessons.md` is cut by the raised context limit | in `kernel/src/brain/context.ts`, drop the `notes.push(cutNote(…))` for a section cut by the context limit (the regexes then fail) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel-built Studio guide, catalogue threaded to the handler, persona-only role template, docs and pins | all | 11 modify, 3 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| guide | `kernel/src/brain/context.ts` (266): the guide section's place, the limits and `RESUMED_THREAD_LINE`; `kernel/src/brain/templates.ts` (207): the persona-only `ROLE_TEMPLATE` | `kernel/src/brain/guide.ts`: the guide text and builder, the one home of the new responsibility | HIGH |
| wiring | `kernel/src/brain/handler.ts` (500; the handler's existing `contextOf` closure is the single place the context gets its input, so a two-line append and no new home); `kernel/src/loop/types.ts` (235); `kernel/src/loop/loop.ts` (358); `kernel/src/kernel.ts` (612; the composition root is the single place the catalogue and the loop meet, so a one-line append) | — | HIGH |
| tests | `kernel/test/brain.test.ts` (1338; only its existing `ROLE_TEMPLATE`, doc and bound pins change, and no new responsibility lands there); `kernel/test/drafts-are-records.test.ts` (62): retarget its role-template pin to the Wright guide; `kernel/test/playbooks-crew.test.ts` (865; only its existing context-limit pin changes); `kernel/test/brain-crew-routing.test.ts` (808; LOW, only if an existing crew-prompt assertion breaks) | `kernel/test/brain-guide.test.ts`: the guide's tests (AC1–AC3, AC5–AC8), a new home because brain.test.ts is past the 500-line threshold | MEDIUM |
| docs | `docs/architecture/brain.md` (366): the new `ROLE_TEMPLATE` block, the guide in "The context a session gets", and the new bounds; `docs/architecture/playbook-runs.md` (151): one clause saying Wright's playbook context now carries the guide | `docs/evidence/wa-a-studio-guide.md` (AC9) | HIGH |

`kernel/src/features/catalogue.ts` (580) is in the requirement's Touches but needs no change: `ToolCatalogue` and `KERNEL_TOOL_PREFIX` are reused as they are, and the tool-line helper lives in `guide.ts`.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/brain/guide.ts"}
  - {kind: "symbol", path: "kernel/src/brain/guide.ts", name: "MAX_WRIGHT_GUIDE_CHARS"}
  - {kind: "symbol", path: "kernel/src/brain/guide.ts", name: "MAX_CREW_GUIDE_CHARS"}
  - {kind: "symbol", path: "kernel/src/brain/context.ts", name: "MAX_CONTEXT_CHARS"}
  - {kind: "symbol", path: "kernel/src/loop/types.ts", name: "catalogue"}
  - {kind: "symbol", path: "kernel/src/brain/templates.ts", name: "ROLE_TEMPLATE"}
  - {kind: "file", path: "kernel/test/brain-guide.test.ts"}
  - {kind: "file", path: "docs/evidence/wa-a-studio-guide.md"}
requires: []
lanes:
  - "kernel/src/brain/guide.ts"
  - "kernel/src/brain/context.ts"
  - "kernel/src/brain/templates.ts"
  - "kernel/src/brain/handler.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/brain-guide.test.ts"
  - "kernel/test/brain.test.ts"
  - "kernel/test/brain-crew-routing.test.ts"
  - "kernel/test/drafts-are-records.test.ts"
  - "kernel/test/playbooks-crew.test.ts"
  - "docs/architecture/brain.md"
  - "docs/architecture/playbook-runs.md"
  - "docs/evidence/wa-a-studio-guide.md"
external_requires:
  - "the owner's running Studio install with a model set, for validation step 2 (AC9)"
```

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): about 14 changed files, borderline for `context-bound` | MEDIUM | Kept as one subtask because `ROLE_TEMPLATE`, its doc block and its pins must change in one commit, and a split would leave the first subtask red. The guide text moves out of `templates.ts` rather than being written twice |
| Feasibility (Phase 2.5): the plan needs files outside the requirement's Touches (`kernel/src/loop/types.ts`, `kernel/src/loop/loop.ts`, `kernel/src/kernel.ts`, `kernel/test/brain-guide.test.ts`, `kernel/test/drafts-are-records.test.ts`, `kernel/test/playbooks-crew.test.ts`, `docs/architecture/playbook-runs.md`, `docs/evidence/wa-a-studio-guide.md`) | MEDIUM | Asked once at Launch Pad Phase 6 (`LP-SCOPE`). The catalogue cannot reach the handler without the loop and the composition root; drafts-are-records pins `ROLE_TEMPLATE` text that moves |
| A longer context costs tokens on every message (requirement risk) | MEDIUM | The guide limits bound it (AC5), and a resumed thread leaves it out (AC7). The worker states the new `MAX_CONTEXT_CHARS` and the guide sizes in the PR |
| Raising `MAX_CONTEXT_CHARS` breaks the existing bound pins in `kernel/test/brain.test.ts` (`(context limit 32000)` regexes in "caps each memory file and the whole context, stating every cut", and the Loomwright-cut loop that steps file sizes from 5,000 to 8,000 and needs `sawCut`) | MEDIUM | Under the AC5 inequality, four capped files, the manifest and an 8,000-character message always fit, so files alone can no longer reach the context limit. Both tests reach it the one way left: pass an oversized `history` to `buildContext` (`never cut`: `/** Thread history (a replay, references), in order, placed before the message and never cut. Absent: none. */`), sized as `MAX_CONTEXT_CHARS` minus the largest Wright guide length, minus the message, minus the note reserve, minus the room the test wants left for memory (so the kept tail never passes the limit and `p.length <= MAX_CONTEXT_CHARS` still holds), with no wrapper tag inside it; the Loomwright loop asserts that its budget lands inside the file-size sweep. Then update the regexes to the new limit and keep each pin's intent: the Loomwright text is still cut inside its wrapper (`sawCut`), and `lessons.md` and the Loomwright summary are still cut by the context limit |
| A crew playbook prompt's whole-context bound (`crewPlaybookPrompt` in `kernel/src/playbooks/runs.ts`) rises with the shared `MAX_CONTEXT_CHARS`, so a crew playbook session can carry more memory than today | LOW | Intended: the memory files get the same room as in a message. Update `kernel/test/playbooks-crew.test.ts`'s cut pin, and update the bound stated in `docs/architecture/playbook-runs.md` (already in lanes) |
| Wright's playbook prompt (`playbookPrompt` in `kernel/src/playbooks/runs.ts`, not in this brief) calls `buildContext` with no catalogue, so its guide says the tool list is unavailable | LOW | It still gets the rules, which is what a fresh install's Wright playbook would otherwise lose. Passing the catalogue there, and adding the guide to the crew playbook prompt (`crewPlaybookPrompt`), are follow-ups to record, not this item |
| A connector-gated tool in `allowedTools` whose connector the agent does not hold is listed although the session will not see it | LOW | The guide lists what policy allows, as the charter display does (`jobDisplayLines`). Say this in the guide's tool-list line ("tools your settings allow; a tool that needs a connector you have not been granted is not in your tool list") |
| Wright's behaviour shifts with the new wording (requirement risk) | MEDIUM | Keep each moved section's text word for word except the tool list. AC9's live check covers the drafting and untrusted-text flows |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-28-wa-a-kernel-built-studio-guide.md
```


## Outcome
- **Status:** completed
- **Completed:** 2026-11-28T09:24:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/316
- **Branch:** feature/wa-a-kernel-built-studio-guide
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added kernel/src/brain/guide.ts, which builds the Wright and crew Studio guides: the rules, a glossary, and a tool list taken from the catalogue and allowedTools. The guide is placed whole right after role.md, and a resumed thread leaves it out. The catalogue is threaded through EventLoopOptions/EventContext.catalogue. ROLE_TEMPLATE is now persona only, and MAX_CONTEXT_CHARS went from 32000 to 82000. Docs, pins and the kernel-probe evidence file are updated. Phase 4.5 ran 3 reviews and 2 fix rounds: an automate.md cross-reference, and the resumed-thread guide limit in brain.md. It ended PASS with 6 LOW/nit findings dismissed (marker comment on the PR). Required CI is green and the rules gate is none. Risk is classified high (size, plus the agents/ path and the auth/token content matches); the red-team lens was not opted in. The drain dispatch was skipped because auto_review is false: the /automate run owns the drain.

## Not verified
- **Wright's live replies on the owner's install (AC9 validation 2)**: there is no live install with a model. The evidence file holds only the kernel-level probe and has no Verdict line. (subtask 1)
- **kernel.ts null-catalogue branch**: kernelToolCatalogue cannot return null with a real composition, so the branch is covered only at loop level. (subtask 1)
- **playbookPrompt and crewPlaybookPrompt in a live playbook run**: out of scope. No catalogue is passed there, and the crew playbook prompt has no guide (follow-ups). (subtask 1)
