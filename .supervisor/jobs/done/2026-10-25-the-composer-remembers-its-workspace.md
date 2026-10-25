# Supervisor Job: A crew member's composer remembers the chosen workspace

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L9
- **CLAUDE.md:** ✓ Found (fresh. Its `kernel/` + `docs/` description predates `app/`, which `docs/ARCHITECTURE.md` and the phase-5 requirements document. Nothing it states is contradicted.)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115027-the-composer-remembers-its-workspace.md
- **Base commit:** 9137fb39a4fe7028af13e1504e622bf139b09f5c

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | App: Electron + React + TypeScript + vitest/RTL (`app/`). Nothing new. |
| 2 | Dependency Availability | GO | No new dependency. The workspace list already comes from `GET /agents/:id` (`useWorkspaces` in `app/src/screens/chat/ChatComposer.tsx`). |
| 3 | Architecture Fit | GO | App-only, UI state; no kernel change, no contract change. The memory follows the per-bridge `WeakMap` idiom of `app/src/store/react.ts` (`const held = new WeakMap<StudioBridge, Held>();`), so it lives as long as the app's bridge (the app's lifetime) and each test's fresh fake bridge starts empty. It is deliberately NOT added to `LiveStore` (`app/src/store/store.ts`), whose contract is kernel answers only ("Nothing is reported that the kernel did not answer"). |
| 4 | Scope vs Supervisor Capability | GO | 2 files, 1 worker, no split. |
| 5 | Hard Blockers | GO | None. |

## Task

In the live phase 5 run, the workspace chosen in `phase5-exit-1024`'s composer reset to "No workspace" after a visit to Sessions. Cause: `ChatComposer` keeps the choice in component state (`const [workspace, setWorkspace] = useState("");`, `ChatComposer.tsx:57`), and the composer unmounts whenever its thread does: leaving Chat unmounts the screen, and `ChatScreen` keys the thread by agent (`<AgentThread key={agent} …`, `Thread.tsx:466`), so switching threads unmounts it too.

Fix (all in `app/src/screens/chat/ChatComposer.tsx`):

- **The memory.** A module-level `WeakMap<StudioBridge, Map<string, string>>`: per bridge (the app has one, `window.api`, for its whole life), per agent id, the owner's last choice, where `""` is an explicit "No workspace". A small helper returns the bridge's map, creating it on first use. Not persisted anywhere (non-goal: across app restarts); no `localStorage`.
- **Choosing.** The select's `onChange` writes the choice to the memory and re-renders (component state may mirror it, but the memory is the source of truth across mounts). Choosing "No workspace" is remembered as `""`, so it sticks too.
- **The shown value** is derived on every render from the memory and the kernel's list, never from a stale copy:
  - a remembered non-empty workspace that is in `workspaces.list` → that workspace;
  - a remembered `""` → "No workspace";
  - nothing remembered and the list has exactly one workspace → that workspace (preselected; it is not written to the memory);
  - otherwise → "No workspace".
- **Dropping a removed workspace.** When `GET /agents/:id` has answered `ok` for this agent and a remembered non-empty workspace is not in its list, the memory entry is REPLACED with `""` (an explicit "No workspace"), never deleted, and the composer shows "No workspace". This holds even when exactly one workspace remains: that one is NOT preselected, because the owner never chose it (requirement AC3 has no exception, and the story's point is not to send with a workspace the owner did not mean). While the list has not answered, or answered with a refusal, the entry is left as it is (the list is unknown, not empty), and the shown value is "No workspace" because the remembered one is not listed. The replacement happens in an effect or the answer handler, never during render.
- **Sending is unchanged.** `send()` keeps its guard (`workspaces.list.includes(workspace)`), now applied to the derived value: only a listed workspace is ever sent.
- **Wright** has no picker and no memory entry (`isWright` path unchanged).
- Update the header comment (lines 1-6) to say the choice is remembered per crew member for the app's lifetime, a sole workspace is preselected when nothing was chosen, and a removed one becomes "No workspace"; and, in one line, why the memory is a per-bridge map here rather than in the live store (the live store holds kernel answers only).

Tests (`app/src/screens/chat/composer.test.tsx`), over the existing test kit (`kit`, `renderChat`, `go`, `resetChat` from `./testkit`):

- **Existing tests forced by preselection.** The kit's default gives Pim exactly one workspace (`workspaces: { pim: ["~/work/a"] }`, `testkit.tsx`), which is now preselected:
  - `"crew thread sends agent: pim"`: its expectation becomes `{ text: "Skip PR 12", agent: "pim", workspace: "~/work/a" }` (this is AC2's evidence).
  - `"workspace picker offers only listed workspaces"`: before the unlisted `~/elsewhere` change, first choose "No workspace" (`fireEvent.change(picker, { target: { value: "" } })`) so its first send still checks that nothing unlisted (and nothing at all) is sent; the rest unchanged. (In jsdom a select set to an unlisted value reads `""`, so this test is a regression check of the picker, not a pin of the `workspaces.list.includes(` guard; see Pin mutations.)
  - Every other existing test and assertion stays as it is.
- **New tests**, one per criterion below, plus the per-agent and explicit-"No workspace" cases (AC4, AC5).

## Acceptance Criteria
- [ ] AC1. Given Pim with workspaces `["~/work/a", "~/work/b"]` and `~/work/b` chosen in Pim's composer, when the owner goes to Sessions (`go("#/sessions")`) and back to `#/chat/pim`, then the picker shows `~/work/b` and the next send posts `{ text, agent: "pim", workspace: "~/work/b" }`; and the same holds after the whole view is unmounted (`view.unmount()`) and rendered again over the same kit's bridge (what leaving the Chat screen does in the app). Pinned in `composer.test.tsx`.
- [ ] AC2. Given a member with exactly one workspace and no choice made, when its thread opens, then that workspace is selected and a send posts it (the updated `"crew thread sends agent: pim"` test). Given a member with two workspaces and no choice, then "No workspace" is selected.
- [ ] AC3. Given `~/work/b` remembered for Pim, when Pim's list no longer has it (`k.state.workspaces.pim = ["~/work/a", "~/work/c"]`) and Pim's thread is opened again, then the composer shows "No workspace" (value `""`), a send posts no `workspace`, and the choice is dropped: going away and back again still shows "No workspace" even after `~/work/b` is listed again (`["~/work/a", "~/work/b"]`). And given `~/work/b` remembered, when the list becomes `["~/work/a"]` (one workspace left, not the removed one) and Pim's thread is opened again, then the composer shows "No workspace", not `~/work/a`; and after the list has answered, typing text and sending (which re-renders the composer) posts no `workspace`, and going to Sessions and back once more still shows "No workspace".
- [ ] AC4. Given a member with one workspace on which the owner explicitly chose "No workspace", when the owner goes to Sessions and back, then "No workspace" is still selected (not re-preselected).
- [ ] AC5. The memory is per agent: given `~/work/b` chosen for Pim and a second specialist with its own two workspaces, when its thread opens, then it shows "No workspace", and Pim's thread still shows `~/work/b`. And given `~/work/b` remembered for Pim, when Pim's thread reopens with `GET /agents/:id` refused (it shows "No workspace"), and then reopens again with the list answering `["~/work/a", "~/work/b"]`, then it shows `~/work/b` (a refusal does not drop the choice). The test makes the read refuse by overriding the route with `k.fake.route("GET /agents/:id", …)`: a responder switching on a local flag, answering a refusal (`{ ok: false, status: 500, body: { error: "boom" } }`) for the refused visit and an `ok` agent-detail body with `workspaces: ["~/work/a", "~/work/b"]` otherwise. Pim stays in the roster throughout (taking Pim out of the roster would open Wright's thread instead), and `workspaces: { pim: null }` is not used (that is an `ok` empty list, which drops the choice by design).
- [ ] AC6. `cd app && npm ci && npm run typecheck && npm test && npm run build` passes.

**Evidence rule:** every criterion's evidence is in the diff (unit tests). None lives in the PR body.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| app chat composer | `app/src/screens/chat/ChatComposer.tsx`, `app/src/screens/chat/composer.test.tsx` | — | HIGH |

**Total estimated files:** 2 modify + 0 create

Not edited, checked: `app/e2e/chat.spec.ts` selects `~/work/a` explicitly (`await picker.selectOption("~/work/a");`) and by type-ahead (`await page.keyboard.type("~");` then `toHaveValue("~/work/a")`), both still true with `~/work/a` preselected; its polish state `crew-thread` asserts only the option count (`toHaveCount(2)`). `app/src/screens/chat/keyboard.test.tsx`'s tab order (`["Open in Team", "Workspace", "Message Pim", "Send"]`) is unchanged. `app/src/screens/chat/testkit.tsx` needs no change (`k.state.workspaces` is read at answer time and is mutable).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| app chat composer | — | single group | NO |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/screens/chat/ChatComposer.tsx:57` | yes | HOLDS | `const [workspace, setWorkspace] = useState("");` | tip 7 hours ago |
| `app/src/screens/chat/ChatComposer.tsx:73` | yes | HOLDS | `const chosen = !isWright && workspace !== "" && workspaces.list.includes(workspace) ? workspace : undefined;` | tip 7 hours ago |
| `app/src/screens/chat/Thread.tsx:466` | yes | HOLDS | `return <AgentThread key={agent} api={api} agent={agent} …` | tip 7 hours ago |
| `app/src/store/react.ts:20` | yes | HOLDS | `const held = new WeakMap<StudioBridge, Held>();` | tip 7 hours ago |
| `app/src/screens/chat/testkit.tsx` | yes | HOLDS | `workspaces: { pim: ["~/work/a"] },` (the kit's default) | tip 7 hours ago |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

Applies to `app/e2e/*` only; this brief edits no e2e spec.

## Touched-file invariants

- **`app/src/screens/chat/ChatComposer.tsx`** — keep: the send guard (`if (inFlight.current) return;`, the ref not state: `// A ref, not state: two Enters in one tick must not both pass the guard.`), the blank/length guard (`if (text.trim() === "" || text.length > MAX_ASK_LENGTH) return;`), "Only a listed workspace is ever sent." (the `workspaces.list.includes(` check), the clear-only-what-was-sent rule (`if (latest.current === sent) onTextChange("");`), the refetch list `` [`thread:${agent}`, "messages"] ``, `useWorkspaces`' stale-agent guard (`return state.agent === agent ? state : { list: [], error: "" };`) and its `live` cancel flag, the `<option value="">No workspace</option>` label, and `{isWright ? null : (` (Wright has no picker). Exported `MAX_ASK_LENGTH` and `ChatComposerProps` unchanged (Thread.tsx's call site `<ChatComposer api={api} agent={agent} agentName={name} text={text} onTextChange={setText} inputRef={inputRef} />` is not edited). No `localStorage`/`sessionStorage`. pinned by: `composer.test.tsx` `"a double Enter while the first ask is in flight sends once"`, `"a 202 clears only the text it sent…"`, `"Wright shows no workspace picker"`, `"a null workspace list offers only No workspace"`.
- **`app/src/screens/chat/composer.test.tsx`** — keep: every existing `it(` and assertion except the two named in Task (the `"crew thread sends agent: pim"` expectation gains `workspace: "~/work/a"`; `"workspace picker offers only listed workspaces"` first chooses "No workspace"); keep `afterEach` calling `resetChat` (each test's fresh kit bridge isolates the memory).

## Pin mutations

- AC1: initialise the shown value from `useState("")` with no memory read (today's code) → the go-away-and-back test reads `""`, not `~/work/b`.
- AC2 (one workspace): drop the sole-workspace preselect branch → the updated `"crew thread sends agent: pim"` posts no `workspace`.
- AC2 (two workspaces): preselect the first listed workspace whenever nothing is remembered → the two-workspace member shows `~/work/a`, not "No workspace".
- AC3 (re-listed): skip the not-listed replacement → after `~/work/b` is listed again the third visit shows `~/work/b`.
- AC3 (one left): delete the entry instead of remembering `""` → the send after typing posts `workspace: "~/work/a"`, and the second reopen preselects `~/work/a` (the first read alone may still show "No workspace" before any re-render, so the test does not stop there).
- AC4: treat a remembered `""` as "nothing remembered" → the single-workspace member is re-preselected.
- AC5 (per agent): key the memory by bridge only (one value for all agents) → the second specialist shows `~/work/b` (or Pim loses it).
- AC5 (refusal): replace the entry on a refused read too → the reopen after the refusal shows "No workspace", not `~/work/b`.
- `"workspace picker offers only listed workspaces"`: no single mutation is claimed. Removing the `workspaces.list.includes(` guard alone does not turn it red in jsdom (an unlisted select value reads `""`); it is a regression check of the picker's options and sends, and the guard stays as defence in depth.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Remember the composer's workspace per crew member for the app's lifetime; preselect a sole workspace; drop a removed one | AC1–AC6 | 2 modify, 0 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/src/screens/chat/ChatComposer.tsx", name: "ChatComposer"}
requires: []
lanes:
  - "app/src/screens/chat/ChatComposer.tsx"
  - "app/src/screens/chat/composer.test.tsx"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
- Subtask 1: no dependencies.

### File Overlap Matrix
| | 1 |
|---|---|
| 1 | — |

### Batch Plan
- single-agent (no fan-out)
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Preselection changes two existing composer tests (the kit gives Pim one workspace). | LOW | Named in Task and Touched-file invariants; only those two assertions change, each to the new intended behaviour. |
| Preselection changes what the Chat polish screenshot `crew-thread` shows (`~/work/a` instead of "No workspace"). | LOW | The polish screenshots are written only in evidence mode and not regenerated here; the state's assertion is the option count, unchanged. Mention in the PR body. |
| Replacing the memory entry during render (a mutation in render). | LOW | Task requires the replacement in an effect or the answer handler; AC3 pins the drop. |
| Concurrent lanes L10 (team inspector), L11 (kernel tool schemas), L12 (approval links). | LOW | None names `app/src/screens/chat/ChatComposer.tsx` or `composer.test.tsx`; 0 shared files (run's right-size line). |
| Prior churn (postmortem ledger): 1 entry touching the composer; dominant classes `self_heal_churn`, `drain_churn`. | LOW | Keep the change surgical (2 files) and every criterion pinned by a unit test, so review has nothing to argue from the PR body. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-25-the-composer-remembers-its-workspace.md
```

## Plan Review
- **Status:** PASS on attempt 3/3 (attempts 1-2 PASS with MEDIUM issues, each refined: removed workspace becomes an explicit `""` instead of being deleted; added pin rows; AC3 one-left case forces a re-render; AC5 names how the read is refused). Owner chose Save and exit.
- **Open LOW notes (deferred, non-blocking):**
  - Do the not-listed replacement in `useWorkspaces`' `result.ok` branch (or add an `answered` field to its return): its state `{list: [], error: ""}` cannot otherwise tell "not answered yet" from "answered ok with an empty list". If the stale-agent guard's fallback object gains `answered: false`, its meaning (a stale agent reads as an unanswered empty list) is kept and that is not a broken invariant.
  - The memory is a per-bridge map in `ChatComposer.tsx`, not in `LiveStore` (kernel answers only, `store.ts:34`), against the requirement's literal "the app's store". Keep the one-line reason in the header comment.

## Outcome
- **Status:** completed
- **Completed:** 2026-10-25T04:24:42Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/136
- **Branch:** feature/the-composer-remembers-its-workspace
- **Files changed:** 2
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** ChatComposer remembers the workspace per crew member in a per-bridge WeakMap ("" = explicit No workspace), preselects a sole listed workspace, and turns a no-longer-listed choice into "" on an ok GET /agents/:id answer (a refusal keeps it). 7 new + 2 updated tests pin AC1-AC5; AC6 green (1067 tests). Phase 4.5 code-reviewer PASS on the first pass (2 LOW non-new notes dismissed); required CI green. The review drain was not dispatched (.supervisor/config.json auto_review=false).

## Not verified
- **app/e2e/chat.spec.ts Electron e2e** — not run; assertions read and expected to hold with ~/work/a preselected (subtask 1)
- **Chat polish screenshot crew-thread** — evidence-mode only, not regenerated; would now show ~/work/a instead of No workspace (subtask 1)
