# Supervisor Job: wa-f — agents propose lessons, preferences and people entries; the owner approves; the kernel writes them

## Environment
- **Project:** ~/orca/workspaces/loomwright-studio/starfish-clone
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/wright-aware/2026-11-21-230500-wa-f-agents-propose-lessons-and-the-owner-approves-them.md
- **Base commit:** 32105d8be0e2b771f5bb359b140c16e786c42e03

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and React app (`app/`, vitest); the change is a contributed kernel tool plus an Approvals card, the same shape as `kernel_agent_create` and `MergeApprovalCard`. |
| 2 | Dependency Availability | GO | No new dependency. Reuses `zod`, `defineTool` (`kernel/src/features/contribution.ts`), `writeFileAtomic` (`kernel/src/tools/handoff.ts`), `MEMORY_UPDATED` (`kernel/src/gui/memory-paths.ts`), `readMemoryFile`/`memoryDir` (`kernel/src/brain/memory.ts`), `MAX_MEMORY_FILE_CHARS` (`kernel/src/brain/context.ts`). |
| 3 | Architecture Fit | GO | The held-and-applied path exists: a tool in `ALWAYS_HELD_TOOLS` with `beforeHold` (narrow-only pre-hold check, may name a `subject` for withdraw-on-replace) and `applyOnApproval` (runs inside the owner's `once` decision, a savepoint; a throw is `apply_error`). Invariants 2, 3 and 8 hold: the kernel writes, the owner decides, memory stays inspectable markdown. |
| 4 | Scope vs Supervisor Capability | CAUTION | Single agent, accepted at a larger scope: 22 files in all (17 modify, 5 create), past the 12-file `context-bound` count, but most are one-line edits to closed lists, pins, comments and docs; source logic sits in the new `memory-propose.ts`, the new card and one rail deny. Splitting would make one subtask own the closed sets and another the tool that must join them in the same change (a `file-conflict` that would serialize anyway), so one worker is cheaper. The plan needs files outside the requirement's `## Touches`: `kernel/src/agents/past-tool-lists.ts` (wa-c: the current 31-tool proposal must be appended when `PROPOSED_ALLOWED_TOOLS` grows), the pinning tests `kernel/test/tools-sdk-list.test.ts` and `kernel/test/agents-settings-upgrade.test.ts`, a new `app/src/screens/approvals/MemoryProposalCard.tsx` (+ test), `docs/architecture/approvals.md`, `docs/architecture/brain.md` and the evidence file — asked once at Phase 6 (`LP-SCOPE`). |
| 5 | Hard Blockers | GO | None. No migration (the approvals table and `events` already hold everything; `memory_updated` is an existing event kind). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Add the always-held kernel tool `kernel_memory_propose`, so Wright and crew members propose an entry for their own `lessons.md`, `preferences.md` or `people.md` as an owner approval, and the kernel itself appends the dated entry on the owner's `once` approval; no agent can ever decide such an approval.

**Problem Statement:**
The owner needs Wright and the crew to carry what they learned between conversations, because today nothing does: no agent can write its memory (the proposed policy has no write tool and no kernel tool writes memory), and the owner's `preferences.md`, `people.md` and `lessons.md` are still the empty templates from 2026-10-15.
Currently a mistake, a stated preference or a fact about a colleague is lost when the conversation ends. This causes the same mistakes to repeat and the owner to restate preferences.
Success looks like: an agent proposes one entry with its evidence, the owner sees it in Approvals, approves once, and the entry is in `memory/<agent>/<file>.md` and in the agent's next context; nothing reaches a memory file without the owner's yes (D5, D7), and no agent session can say that yes.

## Design decisions
- decision: How a proposed entry is held, decided and written (T2: new module `kernel/src/brain/memory-propose.ts`)
  chosen: A contributed tool in the brain contribution with `beforeHold` + `applyOnApproval`, its full name added to `KERNEL_APPLIED_ACTIONS` and `ALWAYS_HELD_TOOLS`; the applier first `lstat`-checks `memory/<agent>` and `memory/<agent>/<file>.md` and refuses a symbolic link or a non-regular entry (`symlink_refused`, the `threadsDir` idiom in `kernel/src/brain/memory.ts`, because `writeFileAtomic` itself follows a linked parent and replaces a linked file), then appends with the existing `writeFileAtomic` (temporary sibling + rename) and records the existing `memory_updated` event kind
  rejected: writing through the owner's Memory-screen path `resolveMemoryPath` (`kernel/src/gui/memory-paths.ts`, used by `PUT /memory/file`) — it resolves a link to its real target and writes there, and an agent-triggered write must never follow a link the agent's session could plant in its own cwd (invariant 3); the two writers therefore treat a linked `lessons.md` differently, recorded in `docs/architecture/brain.md` "Honest limits"
  rejected: a new `memory_proposals` table and an owner route that writes on approve — needs a migration and a second decision path beside `decideApproval` (blast radius: no; test cost: no)
  rejected: a plain `kernel_approval_request` that the agent follows with its own write — the agent would hold a write tool, a non-goal, and the kernel would not own the write (invariant 2)
  evidence: `kernel/src/approvals/store.ts` "A held call to a tool in `KERNEL_APPLIED_ACTIONS` (a kernel tool with a kernel-side effect) is applied by the kernel itself when the owner approves it `once`"; `kernel/src/agents/charter-tools.ts` `beforeHold: createBeforeHold,` / `applyOnApproval: createOnApproval,`; `kernel/src/tools/handoff.ts` `export function writeFileAtomic(path: string, content: string): void {`
  revisit when: an entry must be edited before it is written (the requirement's non-goal "edit then approve" becomes a goal)
  status: confirmed
- decision: How the owner condition (no agent session decides a `kernel_memory_propose` approval, by any tool, delegation or route) is enforced (T2: new module `app/src/screens/approvals/MemoryProposalCard.tsx` is UI only; this entry covers the kernel side the condition needs)
  chosen: Keep the owner's API route (`POST /approvals/:id/approve|deny`, bearer token, `by: OWNER`) the only decider and pin it: (a) no contributed kernel tool decides an approval (source pin: `decideApproval(` is called only from `kernel/src/approvals/routes.ts`); (b) a new fixed rail deny in `classifyToolCall` (`kernel/src/sessions/policy.ts`), reason `approval_decision_blocked`, for a Bash command whose program is the `studio` CLI (bare `studio` or a path ending in `/studio`) with subcommand `approve` or `deny`, read the way the merge block reads `gh` (the words brace-expanded with `braceExpand` and matched with `wordCouldBe`, so `studio {approve,x} 1 once` and quoted splits are caught too) (the only decision forms `kernel/src/approvals/cli.ts` registers; `studio approvals revoke <grant id>` revokes a standing grant, never decides an approval, and an always-held tool never carries a grant, so it is left as is), in every session whatever its Bash prefixes, denied like `merge_blocked` (never an approval); (c) the existing protected `api.json` stays unreadable to a session
  rejected: pins only, no rail deny — a crew charter the owner gives a `studio` Bash prefix could run `studio approve <id> once` (the CLI reads the token itself, unseen by the rail), which breaks "through any route" (blast radius: yes, but correctness: no)
  rejected: a caller check inside `decideApproval` — the route cannot tell an agent's process from the owner's (both hold the same bearer token), so the check would be decorative
  evidence: `grep -rn "decideApproval(" kernel/src` → `kernel/src/approvals/routes.ts:82` and the definition in `kernel/src/approvals/store.ts` only; `kernel/src/approvals/cli.ts` registers `approvals`, `approve` and `deny`; the card follows the sibling-card module `app/src/screens/approvals/MergeApprovalCard.tsx`; `kernel/src/sessions/policy.ts` `if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };`; `PROTECTED_DATA_FILES` lists `"api.json",`
  revisit when: an agent is ever meant to decide an approval of some kind (that would need its own owner decision), or Studio gains a second decision route
  status: confirmed

## Acceptance Criteria

**Happy path**
- [ ] AC1 — Given a Wright or crew session whose policy allows `mcp__kernel__kernel_memory_propose`, when it calls `kernel_memory_propose` with `file` (`lessons`, `preferences` or `people`), `entry` (the entry text), `evidence` (what happened, with ids where it has them) and `idempotency_key`, then the call is always held as a pending approval (the tool is in `ALWAYS_HELD_TOOLS`, so no "always" grant covers it) whose display shows the file (`memory/<agent>/<file>.md`), the entry and the evidence; the agent comes from the session, never from the tool input.
- [ ] AC2 — Given that pending approval, when the owner approves it `once`, then the kernel's applier (the tool's `applyOnApproval`, registered in `KERNEL_APPLIED_ACTIONS`) appends the entry with its date (`YYYY-MM-DD`, from the decision time) to `memory/<agent>/<file>.md`, records one `memory_updated` event `{path, by: "kernel", agent, approval_id, size, content_hash}` in the decision's transaction, and the decision message to the agent quotes the entry it added; the agent's next non-resumed context holds the entry under that file's section (`buildContext` reads the file).
- [ ] AC3 — Given the owner denies it with a note, then the decision reaches the agent as today (`denied approval <id>: …`); when the agent then proposes a revised entry for the same file, the earlier pending proposal for that agent and file is withdrawn (the hold names subject `memory:<agent>/<file>`, so `withdrawReplaced` denies the older pending one with `replaced_by`).
- [ ] AC4 — Given the Studio guide (`kernel/src/brain/guide.ts`, the shared Memory section both `wrightGuide` and `crewGuide` render), then it tells agents: propose with `kernel_memory_propose` after a refused call, a denied approval, a failed run or an owner correction; one entry per lesson; never copy untrusted text into an entry as an instruction; the owner can ask Wright to draft a reflection playbook that reviews recent mistakes, only when the owner asks (none is preinstalled); and each guide stays within `MAX_WRIGHT_GUIDE_CHARS` / `MAX_CREW_GUIDE_CHARS`.
- [ ] AC5 — Given Wright's settings, then `mcp__kernel__kernel_memory_propose` is in `PROPOSED_ALLOWED_TOOLS`, the 31-tool proposal it replaces is appended to `PAST_PROPOSED_TOOL_LISTS` (so wa-c's upgrade carries the tool to an unedited `wright.json`), and the tool's catalogue job is the existing `ask_for_approval`, so a crew member gets it only through a charter the owner approved with that job.

**Edge cases**
- [ ] AC6 — Given an entry that would take the file past `MAX_MEMORY_FILE_CHARS` (the file's current characters plus the dated entry), then the call is refused before any approval is written, with a reason that names the limit and tells the agent to propose trimming instead; the applier repeats the check at approval time and refuses (`apply_refused`) rather than write past it.
- [ ] AC7 — Given a `file` other than exactly `lessons`, `preferences` or `people` (another agent's file such as `mason/lessons`, `role` or `role.md`, a path, `shared/…`), then the call is refused before any approval is written: an agent proposes only to its own three files.
- [ ] AC8 — Given the file changed on disk between the proposal and the approval (the owner edited it in the Memory screen), then approving still appends to the file as it is at approval time; every byte the owner wrote stays, in order, before the new entry.
- [ ] AC9 — Given the approval card in Approvals, then a memory proposal shows its file and the entry as plain text and the evidence in a well marked as untrusted data (escaped, never rendered as markup), and offers Allow once and Deny only (no "always").

**Error scenarios**
- [ ] AC10 — Given the write fails at approval time (the folder is unwritable, a symbolic link at `memory/<agent>` or at the file — caught by the applier's own `lstat` checks before `writeFileAtomic`, the link's target left untouched — or the rename throws), then the approval records `apply_refused` with the reason and `apply_detail`, the decision message says it was not written, no `memory_updated` event is recorded and the file is byte for byte as before (no temporary sibling left behind).

**Owner condition (2026-11-28, binding)**
- [ ] AC11 — Given a pending `kernel_memory_propose` approval (its own or another agent's), when any agent session (Wright or crew, whatever its Bash prefixes) tries to decide it — Bash `studio approve <id> once`, `studio approve <id> always`, `studio deny <id>`, `/abs/path/studio approve <id> once` or a brace or quoted variant such as `studio {approve,x} <id> once`, a Read of `<dataDir>/api.json`, or a `kernel_agent_message` delegation asking a crew member to approve it — then each attempt is refused (the rail answers `approval_decision_blocked` for the `studio` decision forms, `protected_kernel_path` for `api.json`; a crew member has no tool that decides), the approval stays `pending` and the memory file is byte for byte unchanged; and a source pin asserts `decideApproval(` is called only from `kernel/src/approvals/routes.ts` (the owner's bearer route).
- [ ] AC12 — Given the PR, then a committed evidence file `docs/evidence/wa-f-memory-proposals.md` contains the owner condition (quoted from the requirement's "Owner condition (2026-11-28, binding)"), the file and test names that pin it (AC11), and the static half of Validation 3 — a kernel-level walk over a temporary data dir (Wright's session proposes after a refused call, the owner route approves `once`, `memory/wright/lessons.md` holds the dated entry, the next `buildContext` includes it) with its fenced output and the column-0 line `Verdict: PASS for Validation 3 (static half; the live ask to Wright on the owner's install is the owner's)` — and the PR body links to it. The live half is listed at the end of the file as the owner's step, not run by the worker.

## Scope widening
- app/src/screens/approvals/MemoryProposalCard.test.tsx
- app/src/screens/approvals/MemoryProposalCard.tsx
- app/src/screens/memory/MemoryScreen.tsx
- docs/architecture/approvals.md
- docs/evidence/wa-f-memory-proposals.md
- kernel/src/agents/past-tool-lists.ts
- kernel/test/agents-settings-upgrade.test.ts
- kernel/test/tools-sdk-list.test.ts
- accepted: LP-SCOPE 2026-11-28

## Owner conditions (LP-SCOPE answer, 2026-11-28, binding — verbatim)

> Owner conditions (binding for the build, put them in the brief verbatim; the PR body must show each one): Adding kernel_memory_propose to an unedited Wright list is fine: it only raises a held approval, and the binding owner condition (no agent decides one) is pinned by a test. Also show in the PR body that a proposal never writes memory until the owner approves, and that the proposed text is shown to the owner as data, never run as instructions.

Each condition goes in `docs/evidence/wa-f-memory-proposals.md` (AC12), and the PR body shows each one and links to the file. Each one names the test that pins it: (1) adding the tool to an unedited Wright list only raises a held approval (AC1, AC5); (2) no agent decides one (AC11); (3) a proposal writes no memory until the owner approves (AC1 and AC10: the file is unchanged while the approval is pending and after a deny); (4) the proposed text is shown as data and never run as instructions (AC9, and AC4's guide rule).

## Owner conditions (LP-SAVE-NOTE answer, 2026-11-28, binding — verbatim)

> Owner conditions (binding for the build, put them in the brief verbatim): The build must close both MEDIUM notes: add the brain.test.ts tool-list pin-mutation row, shown failing on a mutation, and keep the 22-file scope reviewable. Split it into serial subtasks (kernel first, then app) if the Supervisor allows, and list both fixes in the PR body.

The two MEDIUM notes this refers to (Plan Review attempt 3, deferred at save): (1) `## Pin mutations` has no row for `kernel/test/brain.test.ts` — the brain contribution's tool list includes `kernel_memory_propose`; the reviewer's suggested mutation is removing the new tool from `tools: Object.freeze([...studioTools])` in `kernel/src/brain/index.ts`, and the build shows the pin turning red on it. (2) `## Risk Assessment` has no row for one worker owning 22 files. For the Supervisor: if it can, run this as two serial subtasks, kernel first (every `kernel/` and `docs/` path), then the app (every `app/` path), with the app subtask requiring the kernel subtask's `kernel_memory_propose` symbol. If it cannot, keep one worker and keep the diff reviewable. Either way the PR body lists both fixes and links `docs/evidence/wa-f-memory-proposals.md`.

## Validation (from the source requirement, must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm ci && npm test` with cases for: always held, approve writes and records the event, deny then re-propose withdraws the old one, size refusal, other-agent and `role.md` refusal, owner edit kept, write failure, and the owner condition (AC11).
2. **Static — app:** `cd app && npm test` with the Approvals card for a memory proposal (AC9).
3. **Running system — the owner's install:** have Wright call a tool its policy refuses, then ask it what it learned; a lesson proposal appears in Approvals, and after approving, `memory/wright/lessons.md` holds the entry and the next answer uses it. The worker records the static half in `docs/evidence/wa-f-memory-proposals.md` (AC12); the live half is the owner's.

## Touched-file invariants

> Grounded at base `32105d8be0e2b771f5bb359b140c16e786c42e03`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/approvals/store.ts`** — keep: the closed applied set and its rule that every member is also always held: `export const KERNEL_APPLIED_ACTIONS = [`; the applier runs in a savepoint and a throw becomes `apply_error`: `return { refused: "apply_error", text: \`the kernel could not apply it: ${clip(errorMessage(err), 300)}\` };`; the grant is spent on every attempt: `// The grant is spent by the kernel on every attempt, so no later agent call can use it.`; mirror: the composition check in `kernel/src/tools/server.ts` `is in KERNEL_APPLIED_ACTIONS but not in ALWAYS_HELD_TOOLS, so an "always" grant could reach it` (add the name to both sets in the same change); pinned by: `kernel/test/kernel-tools.test.ts` `for (const tool of KERNEL_APPLIED_ACTIONS) expect(ALWAYS_HELD_TOOLS).toContain(tool);`.
- **`kernel/src/sessions/policy.ts`** — keep: the closed always-held list `export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([` (add exactly `"mcp__kernel__kernel_memory_propose"`, documented in its JSDoc list like the others); the rail deny union `export type RailDenyReason = "protected_kernel_path" | "merge_blocked" | "bash_shell_metacharacter" | "bash_command_too_large";` and the decision-reason union entry `| "merge_blocked"` (both gain `approval_decision_blocked`); reuse: the existing parse-once Bash reading and its deny placement beside `if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };` — never a second tokenizer; the protected set `"api.json",` stays; pinned by: `kernel/test/sessions-policy.test.ts` `expect(ALWAYS_HELD_TOOLS).toEqual([`.
- **`kernel/src/brain/settings.ts`** — keep: `PROPOSED_ALLOWED_TOOLS` frozen and append-only (`// wa-e: the six read-only Studio lookups (job \`look_up_studio\`). The list before them is the last of \`PAST_PROPOSED_TOOL_LISTS\`.` — the comment must be updated to say the 31-tool list is now the last past list); mirror: `kernel/src/agents/past-tool-lists.ts` `before is appended here, or an install still holding it is never upgraded.`; pinned by: `kernel/test/agents-settings-upgrade.test.ts` `expect(PAST_PROPOSED_TOOL_LISTS.map((l) => l.length)).toEqual([15, 21, 25]);` (becomes `[15, 21, 25, 31]`).
- **`kernel/src/agents/past-tool-lists.ts`** — keep: each past list is a subset of the next and of the current proposal (`* next and of the current proposal (a test pins it), so an upgrade never`), oldest first, each `Object.freeze([` with a comment naming its commits (`// 25 tools: \`845564ce\` through \`b4450b80\``); the new entry is the exact 31-tool list at base, commented with `32105d8b`.
- **`kernel/src/brain/memory.ts`** — keep: the thread-summary symlink refusal `if (st.isSymbolicLink()) throw codedError("symlink_refused", \`${dir} is a symbolic link\`);` and the create-only rule for memory files (`flag: "wx"`); reuse: if the applier needs the refusal, export a small helper built from the existing `lstatOrUndefined` / `codedError` without changing `threadsDir`'s behaviour — never a copy in `memory-propose.ts` and never a refactor of the thread-summary path; pinned by: `kernel/test/brain-thread-summary.test.ts` `summary_unwritable symlink_refused`.
- **`kernel/src/brain/index.ts`** — keep: the contribution's one tool list `tools: Object.freeze([...studioTools]),` (the new tool joins it) and the header's import note (only modules that never load the SDK: `none of them loads the session`); the new module must import only SDK-free kernel modules; pinned by: `kernel/test/feature-seams.test.ts` (the registry's module graph).
- **`kernel/src/brain/guide.ts`** — keep: kernel text never holds a wrapper tag (`Kernel text: never wrapped as data, and it never holds a wrapper's opening`); the bounds `export const MAX_WRIGHT_GUIDE_CHARS = 20_000;` / `export const MAX_CREW_GUIDE_CHARS = 14_000;` hold at the largest catalogue; reuse: the shared `const MEMORY = \`### Memory` section for both guides; pinned by: `kernel/test/brain-guide.test.ts` `expect(w.length).toBeLessThanOrEqual(MAX_WRIGHT_GUIDE_CHARS);`.
- **`kernel/test/tools-sdk-list.test.ts`** — keep: every shipped tool has a closed-value entry: `expect(Object.keys(CLOSED_VALUE_SETS).sort()).toEqual([...kernelToolNames(SHIPPED)].sort());` (add `kernel_memory_propose` with its `file` values).
- **`app/src/screens/approvals/ApprovalsScreen.tsx`** — keep: every untrusted field escaped through `printable(…)` and the untrusted well label `<span className="approvals-well-note">untrusted text</span>`; reuse: the sibling-card slot `{merge === undefined ? null : <MergeApprovalCard merge={merge} />}` (the memory card mounts the same way, from its own module); "always" stays refused for an always-held tool.
- **`docs/architecture/approvals.md`** — keep: the rail's numbered deny list (`4. **The merge block: denied, whatever the policy, never an approval**`) gains the `approval_decision_blocked` rule; `## Kernel-applied actions` gains `kernel_memory_propose`.

## Closed enumerations touched

> Sibling grep at base `32105d8b`: `grep -rnF 'merge_blocked' --exclude=CHANGELOG.md kernel/src app/src docs` → 23 hits in 12 files; `grep -rnF 'mcp__kernel__kernel_agent_update' kernel/src` (sibling of the new always-held, kernel-applied tool) → hits in `approvals/store.ts`, `sessions/policy.ts`, `agents/past-tool-lists.ts`, `brain/settings.ts`, `tools/server.ts` (comment).

- **`approval_decision_blocked`** (sibling: `merge_blocked`) — must be named in:
  - `kernel/src/sessions/policy.ts` — `export type RailDenyReason = "protected_kernel_path" | "merge_blocked"` — extend.
  - `kernel/src/sessions/policy.ts` — the gate decision reason union (`| "merge_blocked"`) — extend.
  - `docs/architecture/approvals.md` — the rail's numbered deny list (`4. **The merge block`) — extend.
  - `kernel/src/sessions/draft-mode.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/types.ts`, `kernel/src/automate/launch.ts` — prose comments about the merge block — no change: they describe `merge_blocked` only, not a list of every deny.
  - `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`, `docs/evidence/phase-8-exit-runbook.md`, `docs/architecture/draft-mode.md`, `docs/architecture/repo-policy.md`, `docs/architecture/automate.md`, `docs/DECISIONS.md` — prose about merges — no change: not a closed list of rail denies.
- **`mcp__kernel__kernel_memory_propose`** (sibling: `mcp__kernel__kernel_agent_update`) — must be named in:
  - `kernel/src/approvals/store.ts` — `export const KERNEL_APPLIED_ACTIONS = [` — extend.
  - `kernel/src/sessions/policy.ts` — `export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze([` — extend.
  - `kernel/src/brain/settings.ts` — `PROPOSED_ALLOWED_TOOLS` — extend (append).
  - `kernel/src/agents/past-tool-lists.ts` — `PAST_PROPOSED_TOOL_LISTS` — no change to existing lists; a new 31-tool past list is appended (it does not name the new tool).
  - `kernel/src/approvals/store.ts` — `OWNER_GRANT_ACTIONS` — no change: a memory proposal carries no tracker grant.
  - `kernel/test/tools-sdk-list.test.ts` — `CLOSED_VALUE_SETS` keyed by every shipped tool — extend.
  - `kernel/test/brain.test.ts` — the brain contribution's exact tool list `expect(merged.tools.map((t) => t.name)).toEqual(["kernel_session_list",` — extend (append `"kernel_memory_propose"`; update the test title's "six Studio lookup tools" wording).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-policy.test.ts` — `ALWAYS_HELD_TOOLS` equals the list incl. `kernel_memory_propose` | delete `"mcp__kernel__kernel_memory_propose",` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-policy.test.ts` — a Bash `studio approve 1 once` in a session whose prefixes admit `studio` is denied `approval_decision_blocked` | flip `reason: "approval_decision_blocked"` → `reason: "merge_blocked"` in `kernel/src/sessions/policy.ts` |
| `kernel/test/brain-memory-propose.test.ts` — approve `once` appends the dated entry and records `memory_updated` | delete `"mcp__kernel__kernel_memory_propose",` in `kernel/src/approvals/store.ts` (the decision then applies nothing) |
| `kernel/test/brain-memory-propose.test.ts` — size refusal names `MAX_MEMORY_FILE_CHARS` | flip `> MAX_MEMORY_FILE_CHARS` → `> Number.MAX_SAFE_INTEGER` in `kernel/src/brain/memory-propose.ts` |
| `kernel/test/brain-memory-propose.test.ts` — a revised proposal withdraws the older pending one | flip `subject: \`memory:${agent}/${file}\`` → `subject: undefined` in `kernel/src/brain/memory-propose.ts` |
| `kernel/test/brain-memory-propose.test.ts` — source pin: `decideApproval(` appears only in `kernel/src/approvals/routes.ts` (and its definition in `store.ts`) | add a `decideApproval(ctx.store, { id: 1, decision: "once", by: "owner" }, ctx.now())` call in the handler of `kernel/src/brain/memory-propose.ts` (must turn the pin red) |
| `kernel/test/brain-memory-propose.test.ts` — Bash `studio approve <id> once` from a session leaves the approval `pending` and the file unchanged | delete the `approval_decision_blocked` deny line in `kernel/src/sessions/policy.ts` (with a `studio` prefix the call then runs) |
| `app/src/screens/approvals/MemoryProposalCard.test.tsx` — evidence is rendered escaped inside the untrusted well | render the evidence without `printable(…)` in `app/src/screens/approvals/MemoryProposalCard.tsx` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` — a memory proposal offers no "Allow always" | drop the always-held check for the memory proposal in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `kernel/test/brain-memory-propose.test.ts` — AC10: a symbolic link at `memory/<agent>` or at the file ends in `apply_refused`, the link's target untouched | delete the applier's `isSymbolicLink()` refusal in `kernel/src/brain/memory-propose.ts` (`writeFileAtomic` then writes through or replaces the link) |
| `kernel/test/brain-memory-propose.test.ts` — AC7: `mason/lessons`, `role`, `role.md` and `shared/notes` are refused before any approval | delete the own-three-files allow-list check (`lessons`, `preferences`, `people`) in the `beforeHold` of `kernel/src/brain/memory-propose.ts` |
| `kernel/test/brain-memory-propose.test.ts` — AC8: an owner edit made after the hold stays, before the new entry | replace the at-approval read of the file with the text read when the proposal was held, in the applier of `kernel/src/brain/memory-propose.ts` |
| `kernel/test/brain-memory-propose.test.ts` — AC4: both guides name `kernel_memory_propose` and the four signals | delete the propose paragraph from `const MEMORY = \`### Memory` in `kernel/src/brain/guide.ts` |
| `kernel/test/approvals.test.ts` — "always" on a memory proposal is refused `always_not_supported` | delete `"mcp__kernel__kernel_memory_propose",` in `kernel/src/sessions/policy.ts` |
| `kernel/test/tools-sdk-list.test.ts` — `CLOSED_VALUE_SETS` covers `kernel_memory_propose`'s `file` values | flip `"people"` → `"person"` in the `file` value set of `kernel/src/brain/memory-propose.ts` |
| `kernel/test/agents-settings-upgrade.test.ts` — past list lengths `[15, 21, 25, 31]` | delete the `// 31 tools:` list's opening `Object.freeze([` block in `kernel/src/agents/past-tool-lists.ts` (row for the reviewer's D1 fallback) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | `kernel_memory_propose`: held proposal, kernel-applied append, owner-only decision, guide text and Approvals card | all | 17 modify, 5 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel tool (new responsibility: hold + apply a memory proposal → its own module) | `kernel/src/brain/memory.ts` (463 — one exported link-refusal helper built from its private `lstatOrUndefined` / `codedError`, so the applier reuses it), `kernel/src/brain/index.ts` (104), `kernel/src/brain/guide.ts` (333), `kernel/src/brain/settings.ts` (146), `kernel/src/agents/past-tool-lists.ts` (380) | `kernel/src/brain/memory-propose.ts` | HIGH |
| approvals + rail (closed sets) | `kernel/src/approvals/store.ts` (897 — one name appended to the single authority `KERNEL_APPLIED_ACTIONS`; no new logic there), `kernel/src/sessions/policy.ts` (1750 — the rail is the single authority for fixed denies; one name in `ALWAYS_HELD_TOOLS` and one deny beside `merge_blocked`) | — | HIGH |
| kernel tests | `kernel/test/approvals.test.ts` (2226 — one case: a memory proposal is refused "always"; the always-refusal cases live there), `kernel/test/sessions-policy.test.ts` (1593 — the `ALWAYS_HELD_TOOLS` pin and the new rail deny cases sit beside the merge-block cases), `kernel/test/tools-sdk-list.test.ts` (428), `kernel/test/agents-settings-upgrade.test.ts` (577 — one pinned length array), `kernel/test/brain.test.ts` (1374 — one name appended to the brain contribution's pinned tool list; the pin lives there) | `kernel/test/brain-memory-propose.test.ts` (every AC1–AC8, AC10, AC11 case; AC4 guide-text case) | HIGH |
| app card (new responsibility → its own module, like `MergeApprovalCard.tsx`) | `app/src/screens/approvals/ApprovalsScreen.tsx` (1111 — one mount line beside `MergeApprovalCard` and the "always" refusal), `app/src/screens/approvals/ApprovalsScreen.test.tsx` (1410 — one screen-level case: the card mounts and "always" is not offered), `app/src/screens/memory/MemoryScreen.tsx` (500 — one header-comment line: `memory_updated` is now also recorded for a kernel-applied agent proposal, so the Memory screen refetches on it; no code change) | `app/src/screens/approvals/MemoryProposalCard.tsx`, `app/src/screens/approvals/MemoryProposalCard.test.tsx` | MEDIUM |
| docs + evidence | `docs/architecture/approvals.md` (306), `docs/architecture/brain.md` (494) | `docs/evidence/wa-f-memory-proposals.md` | MEDIUM |

Reused, not modified: `kernel/src/tools/handoff.ts` (`writeFileAtomic`), `kernel/src/gui/memory-paths.ts` (`MEMORY_UPDATED`), `kernel/src/brain/memory.ts` (`memoryDir`, `readMemoryFile`; the symlink refusal idiom its thread-summary writes use), `kernel/src/brain/context.ts` (`MAX_MEMORY_FILE_CHARS`), `kernel/src/approvals/replace.ts` (`withdrawReplaced` via the hold's `subject`). `kernel/src/brain/memory.ts` gains only the exported link-refusal helper (no copy in the new module, no change to the thread-summary path).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/brain/memory-propose.ts"}
  - {kind: "symbol", path: "kernel/src/brain/memory-propose.ts", name: "kernel_memory_propose"}
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "mcp__kernel__kernel_memory_propose"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "mcp__kernel__kernel_memory_propose"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "approval_decision_blocked"}
  - {kind: "symbol", path: "kernel/src/brain/settings.ts", name: "mcp__kernel__kernel_memory_propose"}
  - {kind: "file", path: "kernel/test/brain-memory-propose.test.ts"}
  - {kind: "file", path: "app/src/screens/approvals/MemoryProposalCard.tsx"}
  - {kind: "symbol", path: "app/src/screens/approvals/MemoryProposalCard.tsx", name: "MemoryProposalCard"}
  - {kind: "file", path: "app/src/screens/approvals/MemoryProposalCard.test.tsx"}
  - {kind: "file", path: "docs/evidence/wa-f-memory-proposals.md"}
requires: []
lanes:
  - "kernel/src/brain/memory-propose.ts"
  - "kernel/src/brain/index.ts"
  - "kernel/src/brain/memory.ts"
  - "kernel/src/brain/guide.ts"
  - "kernel/src/brain/settings.ts"
  - "kernel/src/agents/past-tool-lists.ts"
  - "kernel/src/approvals/store.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/test/brain-memory-propose.test.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/tools-sdk-list.test.ts"
  - "kernel/test/agents-settings-upgrade.test.ts"
  - "kernel/test/brain.test.ts"
  - "app/src/screens/memory/MemoryScreen.tsx"
  - "app/src/screens/approvals/ApprovalsScreen.tsx"
  - "app/src/screens/approvals/ApprovalsScreen.test.tsx"
  - "app/src/screens/approvals/MemoryProposalCard.tsx"
  - "app/src/screens/approvals/MemoryProposalCard.test.tsx"
  - "docs/architecture/approvals.md"
  - "docs/architecture/brain.md"
  - "docs/evidence/wa-f-memory-proposals.md"
external_requires: []
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Needs files outside the requirement's Touches (Feasibility (Phase 2.5)) | MEDIUM | Asked once at Phase 6 (`LP-SCOPE`); every extra path is a pin or closed list the change must keep green (past tool lists, closed-value sets) or the module-layout home for the card. |
| A file write is not rolled back by the decision's savepoint: a crash between the rename and the COMMIT leaves the entry with no `memory_updated` event | MEDIUM | Same honest limit as the roster's `set` and wa-c's upgrade: rename last, inside the applier; document it in `docs/architecture/brain.md` "Honest limits". A refused or thrown apply never renames, so AC10's "nothing half-written" holds. |
| An injected comment gets an agent to propose a "lesson" that is really an instruction | MEDIUM | The owner's approval is the gate; the card shows evidence as escaped untrusted data (AC9); the guide forbids copying untrusted text into an entry as an instruction (AC4). |
| Too many proposals become noise | LOW | The guide asks for one entry per lesson and only on the listed signals (AC4); withdraw-on-replace keeps one pending proposal per agent and file (AC3). |
| The rail deny matches only the `studio` CLI's own forms; a session the owner gives arbitrary shell could still reach the Keychain token through another program | MEDIUM | Record as an honest limit in `docs/architecture/approvals.md` (beside the existing "a script the session runs can use the token, unseen by the rail" limit in `docs/OPEN_QUESTIONS.md`); Wright has no shell, and a crew member's shell is only what its approved charter grants. |
| A resumed thread's prompt leaves memory out, so the "next message has it in context" claim holds only for a non-resumed context | LOW | The applied decision message quotes the entry (AC2), so even a resumed thread receives it; the guide's next non-resumed context has the file. |
| The requirement's optional thread "memory updated" card: no threads view lists `memory_updated` today (`grep -rn memory_updated app/src` hits only the Memory screen's refetch kinds), so it is more than one line and is out of scope | LOW | The Memory screen already refetches on `memory_updated` (`MEMORY_REFETCH_KINDS`), and the decision message quotes the entry in the agent's thread; the thread card is a follow-up. |
| The guide grows past its bound | LOW | `brain-guide.test.ts` pins `MAX_WRIGHT_GUIDE_CHARS` / `MAX_CREW_GUIDE_CHARS`; restate the measured sizes in `docs/architecture/brain.md` as wa-e did. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-28-wa-f-memory-proposals.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-28T16:47:34Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/321
- **Branch:** feature/wa-f-memory-proposals
- **Files changed:** 30
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 1
- **Heal reason:** needs_human
- **Heal remaining issues:** 3
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added always-held, kernel-applied kernel_memory_propose (dated append to memory/<agent>/<file>.md on the owner's once, symlink/size/own-file refusals, memory_updated in the decision savepoint), the approval_decision_blocked rail deny for studio approve/deny, a decideApproval source pin, guide text, the Approvals MemoryProposalCard, docs and evidence. Heal round 1 fixed 3 MEDIUMs (thread card Always, stale guide sizes, idempotency_key reuse via shared used-key.ts). Escalated for the owner: AC5 catalogue job general vs ask_for_approval; AC11 a Read of api.json is not a rail deny (file holds no token); one open MEDIUM — the idempotency doc claim holds only within one session.

## Not verified
- **app/src/screens/chat/cards.tsx inline approval card** — out of lane; still offers Always for a playbook-session memory proposal, kernel refuses 409 (subtask 1) — since fixed in heal round 1 (9549873a)
- **Validation 3 live half on the owner's install** — owner's step; needs the running install and a live model (subtask 1)
