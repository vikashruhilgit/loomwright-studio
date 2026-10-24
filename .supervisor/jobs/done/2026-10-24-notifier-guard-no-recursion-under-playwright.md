# Supervisor Job: The notifier guard does not recurse under Playwright

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L5
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-101652-the-notifier-guard-does-not-recurse-under-playwright.md
- **Base commit:** 86265042f043827edf99daa14e0342a6816e2abe

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript test helper in `kernel/test/` (vitest) and a Playwright spec in `app/e2e/`; no new stack. |
| 2 | Dependency Availability | GO | Only `node:util` `promisify` and `node:child_process`, both already imported by the guard. |
| 3 | Architecture Fit | GO | Test infrastructure only; the shipped notifier is untouched (requirement non-goal). |
| 4 | Scope vs Supervisor Capability | GO | 3 files, well under the single-agent threshold. |
| 5 | Hard Blockers | GO | None. Root cause probed on Node v24.11.1: `execFile[promisify.custom][promisify.custom] === execFile[promisify.custom]` is `false` before and `true` after one `promisify(execFile)` call. |

**Overall Verdict:** GO

## Task
**Goal:** Make `installNotifierGuard()` install cleanly when `execFile`'s promisified form already refers to itself (as in a Playwright worker), and remove the spec-side workaround.

**Problem Statement:**
The owner needs every spec that boots a real kernel to be guarded against posting a real notification, without each spec carrying its own workaround.
Currently, `guarded()` in `kernel/test/notifier-guard.ts` reads `original[promisify.custom]` and calls `guarded(custom, executable)` on it unconditionally. Node's `util.promisify` sets `custom[promisify.custom] = custom` on the promisified form the first time anything promisifies `execFile`, and Playwright's runner does that before any spec loads. So in a Playwright worker, `guarded(execFile)` → `guarded(custom)` → `guarded(custom)` → … recurses until `RangeError`. `app/e2e/phase-5-exit.spec.ts` deletes the self-reference in `installGuardInThisWorker()` before installing the guard.
Success looks like this: the guard skips a `promisify.custom` that is the function itself or already a guarded wrapper; a unit test reproduces the self-reference with a stand-in and proves both call forms are still refused and that installing twice is a no-op; and the spec calls `installNotifierGuard()` directly.

**Mechanism notes for the worker (grounded, not prescriptive):**
- `promisify(fn)` returns `fn[promisify.custom]` as-is when that property is a function, so `promisify(guardedExecFile)` returns the wrapper's own `promisify.custom`. The guarded custom form must check the executable before calling the original's promisified form, and must not refer back to the outer wrapper (requirement Scope 1).
- The guard currently refuses synchronously (a throw from `check(...)` before `original.apply`), and that includes the promisified form. A test may assert `toThrow` on `promisify(execFile)(...)`. Do not turn the refusal into a rejection unless the existing tests still hold.
- The unit test cannot re-install on the real `node:child_process`: `installNotifierGuard()` returns early once `record().installed` is true, and the vitest setup has already installed it. So the guard needs a narrow exported seam, `guardChildProcess(cp)`, that applies the same wrapping to a supplied `child_process`-shaped record. `installNotifierGuard()` must call it, so the test exercises the real code path. Only a stand-in is ever passed to it, so no real process is spawned.

## Acceptance Criteria
- [ ] AC1: Given an `execFile` stand-in whose `promisify.custom` is itself (and, separately, one whose `promisify.custom` is a function whose own `promisify.custom` is itself, which is Node's shape after one `promisify`), when the guard wraps it, then no `RangeError` is thrown, and a call to `terminal-notifier` is refused through both `execFile(...)` and `promisify(execFile)(...)`. Through the promisified form, the refusal may be a synchronous throw or a rejection, either way carrying the guard's `real notifier refused in a test run: ` message. (For the self-equal shape, `promisify` may build Node's generic form, which rejects.) Each refusal is recorded once, and the stand-in is never invoked for the refused call.
- [ ] AC2: Given the guard applied twice to the same record (and `installNotifierGuard()` called again on the real one), when a notifier and a non-notifier are called, then the second application leaves `record.execFile` and `record.exec` `toBe` the functions the first application left, and their `promisify.custom` too. A notifier is refused with exactly one recorded refusal per call, a non-notifier reaches the original exactly once, and nothing recurses.
- [ ] AC3: Given `app/e2e/phase-5-exit.spec.ts` with `installGuardInThisWorker()` and its comment removed, so the test calls `installNotifierGuard()` directly, and with its now-unused `createRequire`/`promisify` imports dropped, then the spec passes in the `app` CI job (`xvfb-run --auto-servernum npm run e2e`).
- [ ] AC4: `kernel/test/notifications-test-guard.test.ts` passes, including its existing (a)–(e) cases unchanged, and `cd kernel && npm run typecheck && npm test` and `cd app && npm run typecheck && npm test && npm run build` pass.

## File Impact Map

| File | Action | Confidence | Why |
|------|--------|------------|-----|
| `kernel/test/notifier-guard.ts` | modify | HIGH | The fix in `guarded()` (skip a self-referencing or already-wrapped `promisify.custom`) and the new exported seam `guardChildProcess(cp)`, which `installNotifierGuard()` calls. The header comment is updated to say so. |
| `kernel/test/notifications-test-guard.test.ts` | modify | HIGH | New case(s) for AC1/AC2, using a stand-in `execFile` and the new seam. |
| `app/e2e/phase-5-exit.spec.ts` | modify | HIGH | Remove `installGuardInThisWorker()` and its doc comment, call `installNotifierGuard()` directly, and drop the `createRequire` and `promisify` imports (both used only by the workaround: at base, every `grep -n "createRequire\|promisify"` hit besides the imports on lines 48 and 51 falls inside the removed lines 422-438). |

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Touched-file invariants

> Grounded at base `86265042f043827edf99daa14e0342a6816e2abe`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/test/notifier-guard.ts`**: keep the once-per-process early return `if (r.installed || !notifierGuardEnabled()) return;`, the shared `globalThis` record `Symbol.for("studio.notifierGuard")`, the no-double-wrap check `!(WRAPPED in original)`, the ESM sync `syncBuiltinESMExports();`, and refuse-before-run order `check(executable(args));` ahead of `original.apply(this, args)`. Keep the wrapper's `name` copy, `Object.defineProperty(wrapper, "name", { value: original.name });`. Reuse the existing `WRAPPED` marker to recognise an already-guarded custom form, not a new symbol. The guarded promisified form must carry the same `executable` picker (`byFile` for `execFile`, `byCommand` for `exec`). Fired by `kernel/test/setup-no-real-notifier.ts` (`installNotifierGuard();`, wired through `kernel/vitest.config.ts`) and by `app/e2e/phase-5-exit.spec.ts`. Pinned by `kernel/test/notifications-test-guard.test.ts`: `copy.installNotifierGuard(); // already installed: a no-op` (case (e)), and `expect(setup).toContain("installNotifierGuard();");` (case (d)).
- **`kernel/test/notifications-test-guard.test.ts`**: keep the gate `describe.skipIf(!notifierGuardInstalled())` on every case that attempts a real notifier, and keep (a)–(e) unchanged. New cases call only a stand-in `execFile` and never the real `node:child_process` with a notifier, so no run can post (requirement Risk). Drain or assert the refusal list with `takeNotifierRefusals()` inside the test, so the setup's `afterEach(assertNoNotifierRefusals);` does not fail it.
- **`app/e2e/phase-5-exit.spec.ts`**: keep `import { assertNoNotifierRefusals, installNotifierGuard } from "../../kernel/test/notifier-guard.js";`, the `afterEach` line `assertNoNotifierRefusals();`, and the guard install as the test body's first step after `test.setTimeout(240_000);`. Electron still launches only through `launchApp` from `./electron-harness` (house rule above). Nothing else in the spec changes.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/notifications-test-guard.test.ts`: new self-reference case (AC1) | In `kernel/test/notifier-guard.ts`'s `guarded()`, remove the new skip so `guarded(custom, executable)` is again called unconditionally on any function `promisify.custom`. The case must go red with `RangeError`. |
| `kernel/test/notifications-test-guard.test.ts`: new promisified-form refusal (AC1) | In `kernel/test/notifier-guard.ts`, make the wrapper's `promisify.custom` the unguarded original custom form (drop its `check(...)`). The case must go red: the stand-in runs for `terminal-notifier`. |
| `kernel/test/notifications-test-guard.test.ts`: new install-twice case (AC2) | In `kernel/test/notifier-guard.ts`, remove the `WRAPPED in` no-double-wrap check from `guardChildProcess`. The case must go red: the second application replaces `record.execFile` with a new wrapper (the identity assertion fails). |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Guard skips a self-referencing promisify.custom; pin it; drop the spec workaround | AC1, AC2, AC3, AC4 | 3 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/test/notifier-guard.ts", name: "guardChildProcess"}
  - {kind: "symbol", path: "kernel/test/notifications-test-guard.test.ts", name: "guardChildProcess"}
requires: []
lanes:
  - "kernel/test/notifier-guard.ts"
  - "kernel/test/notifications-test-guard.test.ts"
  - "app/e2e/phase-5-exit.spec.ts"
external_requires:
  - "Node's util.promisify returns fn[promisify.custom] as-is and sets custom[promisify.custom] = custom on it (probed on Node v24.11.1)"
```

## Parallelism Analysis

### Dependency Graph
1 (no dependencies)

### File Overlap Matrix
Single subtask; none.

### Batch Plan
- single-agent (no fan-out): Batch 1 = subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` (vitest stand-ins, `toThrow`, refusal-list asserts), `skills/playwright-e2e/SKILL.md` (the e2e runs in the `app` CI job) |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/test/notifier-guard.ts:117-118` | yes | HOLDS | `const custom = (original as { [promisify.custom]?: AnyFn })[promisify.custom];` / `if (typeof custom === "function") Object.defineProperty(wrapper, promisify.custom, { value: guarded(custom, executable), configurable: true });` | base 8626504 |
| `app/e2e/phase-5-exit.spec.ts:421-428` | yes | HOLDS (moved to 422-438) | `if (custom !== undefined && custom[promisify.custom] === custom) delete custom[promisify.custom];` | base 8626504 |

## Risk Assessment

| Risk | Severity | Source | Mitigation |
|------|----------|--------|------------|
| A guard that silently stops guarding: the fix skips the custom form and `promisify(execFile)` bypasses the check. | HIGH | Requirement | AC1 asserts refusal through both call forms. The pin mutations prove the new cases go red on a reverted fix. |
| The e2e is only proven green in CI (Electron and xvfb on ubuntu). A local macOS run may differ. | MEDIUM | Analysis (Phase 3) | AC3 names the `app` CI job as the evidence. Run `npm run e2e` locally when possible, but the CI check is the gate. |
| The new exported seam widens the test helper's surface, and a later caller could patch a real module twice. | LOW | Analysis (Phase 3) | The seam honours `WRAPPED`, so repeated application is a no-op. `installNotifierGuard()` keeps its once-per-process record. |
| The `docs/OPEN_QUESTIONS.md` gap (3) entry still reads as open after merge. | LOW | Requirement | Out of scope by the requirement: it is updated in the phase 5 close-out commit. Say what's fixed in the PR body. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-notifier-guard-no-recursion-under-playwright.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-24T15:43:29Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/131
- **Branch:** feature/notifier-guard-no-recursion-under-playwright
- **Files changed:** 3
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** guarded() skips a self-referencing promisify.custom and reuses an already-guarded one; new exported guardChildProcess(cp) is called by installNotifierGuard(); stand-in cases (f)/(g) pin AC1/AC2 (pin mutations hand-verified red); phase-5-exit.spec.ts drops its workaround. Phase 4.5 Code Reviewer PASS (1 LOW nit dismissed). PR checks ci, app (e2e under xvfb, the AC3 gate) and claude-review all pass on 231c0d2.

## Not verified
- **app CI job (xvfb-run --auto-servernum npm run e2e on ubuntu) for app/e2e/phase-5-exit.spec.ts** — only run locally on macOS by the worker; CI is the gate for AC3 (subtask 1). Since resolved: the PR's `app` check passed on 231c0d2 (7m35s).
