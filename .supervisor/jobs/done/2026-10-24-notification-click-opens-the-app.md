# Supervisor Job: A notification click opens the app on what it names, not Terminal

## Environment
- **Project:** loomwright-studio (lane checkout `loomwright-studio-lanes/automate-2026-10-24-064605/L3`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115022-a-notification-click-opens-the-app-not-terminal.md
- **Base commit:** e6233a90e050fb930a318e275fcdcb3b00f0987d

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel; the change stays in `kernel/src/notifications/` and its tests. |
| 2 | Dependency Availability | GO | terminal-notifier 2.0 `-open URL` (requirement, `terminal-notifier -help` on the owner's Mac 2026-10-24). No new npm dependency. `deepLinkFor` already exists in `kernel/src/notifications/record.ts`. |
| 3 | Architecture Fit | GO | Matches phase 5 item 01 ("the kernel posts them, and the app opens their links"); the app registers `loomwright-studio://` (phase 5 item 17). Keeps the argv-only, no-shell rule (invariant 3) and actually removes the one shell path. |
| 4 | Scope vs Supervisor Capability | GO | One worker, 6 files, one module. No split reason fires. |
| 5 | Hard Blockers | GO | None. AC 3 is an owner observation at the phase 5 live rerun, outside this PR (see Acceptance Criteria). |

**Overall Verdict:** GO

## Task
**Goal:** Post every terminal-notifier notification with `-open <its kernel-built deep link>` instead of a `-execute` shell command, so a click opens Loomwright Studio on what the notification names and never opens Terminal.

**Problem Statement:**
The owner needs a Studio notification click to bring the app forward on the thread or approval it names, because phase 5's exit criterion is "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".
Currently, `postNotification` passes terminal-notifier `-execute` with a shell command that has Terminal run `studio notifications show <id>` (`clickShellCommand(showCommand(...))` in `kernel/src/notifications/notifier.ts`). In the 2026-10-24 live run, clicking reminder #21 opened Terminal. Every row already carries `deep_link` (`loomwright-studio://notifications/<id>`), the app handles that scheme, and the deterministic e2e uses a stub notifier, so nothing caught it.
Success looks like: terminal-notifier's argv carries `-open "loomwright-studio://notifications/<id>"` and no `-execute`; the Terminal click path (`clickShellCommand`, `showCommand`, the `nodePath`/`cliPath` deps, `shellQuote`) is gone; the row's `delivery_detail` says what a click opens and that it needs Loomwright Studio.app; `studio notifications show <id>` still works as a CLI command; the docs describe the new click.

**Design decisions (made here, grounded in the code):**
- **The `-open` value is `plistQuote(deepLinkFor(n.id))`**, built inside `terminalNotifierInvocation` from the validated id, never from the title, body or the stored `deep_link` column. It is plist-quoted like `-title` and `-group`, because terminal-notifier reads `-key value` arguments as property lists (p11, `docs/evidence/phase-2-notifier-probe.md`); Cocoa reads a quoted plist string back as exactly the link. So the argv item after `-open` is `"loomwright-studio://notifications/<id>"` (with the plist quotes), and that is what the pins assert. This is the requirement's AC 1 `-open loomwright-studio://notifications/<id>` as terminal-notifier sees it.
- **`terminalNotifierInvocation` loses its `click` parameter** (signature `(path, n)`). **`postNotification` keeps its signature `(n, dataDir, deps)`**: `dataDir` becomes unused (renamed `_dataDir`, its doc comment saying it is kept for the callers' signature). Dropping it would break `kernel/test/notifications-test-guard.test.ts` (`postNotification({ id: 1, title: "t", body: "b" }, tmp, …)`), which is sibling item 21's lane, and `deliver.ts`; both stay untouched. Removing the parameter is a follow-up once item 21 has landed.
- **Removed outright (scope 3, nothing else uses them, verified by `grep -rn` at the base commit):** `showCommand`, `clickShellCommand`, `shellQuote` (used only by those two), `NotifierDeps.nodePath`, `NotifierDeps.cliPath`, the `fileURLToPath` import, and their re-exports in `kernel/src/notifications/index.ts`. `studio notifications show <id>` itself (`kernel/src/notifications/cli.ts`) is untouched.
- **No-app detail (scope 2):** the kernel does not probe LaunchServices for a handler (that needs native code or `lsregister`, neither of which the kernel uses). The detail is honest either way: `posted by <path>; a click opens loomwright-studio://notifications/<id> (needs Loomwright Studio.app)`. There is no fallback to Terminal or to any other click.
- osascript posting is unchanged (no click action; non-goal).

## Acceptance Criteria
- [ ] 1. Given a pending notification and terminal-notifier present, when the delivery due work posts it, then the argv is exactly `["-title", <plist title>, "-group", <plist group>, "-open", plistQuote(deepLinkFor(id))]` (so the item after `-open` is `"loomwright-studio://notifications/<id>"`) and contains no `-execute`. Pinned in `kernel/test/notifications.test.ts` (the existing "posts once with terminal-notifier" test, rewritten) and in `kernel/test/phase-2-exit.test.ts` (its `argAfter(post.args, "-execute")` check becomes `argAfter(post.args, "-open")` equal to `plistQuote(deepLinkFor(n.id))`, plus `post.args` not containing `"-execute"`).
- [ ] 2. Given a notification whose title or body contains `loomwright-studio://approvals/9` and shell metacharacters (`$(…)`, backticks, `;`, `|`, `&`, quotes), and whose id is not 9 and not 1, when it is posted with terminal-notifier, then the `-open` value is `plistQuote(deepLinkFor(<its own id>))` and the text appears only in the quoted `-title` item and on stdin. Pinned by a new test in `kernel/test/notifications.test.ts`.
- [ ] 3. Given terminal-notifier posted a notification, when the row is settled, then its `delivery_status` is `delivered` and its `delivery_detail` is `posted by <path>; a click opens loomwright-studio://notifications/<id> (needs Loomwright Studio.app)`; `studio notifications show <id>` prints that detail. Pinned by the updated `delivery_detail` and `notifications show` expectations in `kernel/test/notifications.test.ts`.
- [ ] 4. Given the change, then `grep -rnE "clickShellCommand|showCommand|shellQuote|nodePath|cliPath" kernel/src/notifications kernel/test/notifications.test.ts kernel/test/phase-2-exit.test.ts kernel/test/phase-2-exit-live.test.ts` finds nothing, and `grep -rn -- "-execute" kernel/src/notifications` finds nothing. (In the tests, `-execute` stays only as hostile data, i.e. the `TITLE` constant and its expected quoted title, and in the negative assertions `not.toContain("-execute")`.) `studio notifications show <id>` still works: its existing CLI test passes, changed only in the detail string.
- [ ] 5. Given `docs/architecture/notifications.md`, then these all describe the `-open` click (the app opens the link; no Terminal, no shell, no Automation prompt for Terminal): its intro, the deep-link paragraph, the situation-table row, the terminal-notifier candidate bullet (now "the only candidate with a click action (`-execute`)"), the osascript bullet's sentence "The click's `osascript … do script` passes its command after `--` too." (to be deleted), the "The click" bullet, and the Limits bullets. Afterwards `grep -nE -- '-execute|do script|in Terminal' docs/architecture/notifications.md` finds no line stating current behaviour. The header comments of `kernel/src/notifications/index.ts` and `notifier.ts` no longer say the click opens Terminal.
- [ ] 6. Given the validation commands, then `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.
- [ ] 7. *(Owner observation, outside this PR.)* Given the phase 5 live rerun, when the owner clicks a reminder's notification, then the app comes forward on Wright's thread. This is recorded at the rerun by the existing runbook field `notification_click_opened_thread` (`docs/evidence/phase-5-exit-runbook.md`); this PR neither claims nor fakes it, and the PR body says it is pending the rerun.

## Touched-file invariants

> Grounded at base `e6233a90e050fb930a318e275fcdcb3b00f0987d`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/notifications/notifier.ts`** — keep: every process spawned with an argv array, never a shell (`never a shell string, never \`shell: true\``); the id check before building any argv (`checkId(n.id);` in `terminalNotifierInvocation` and `postNotification`); the title as a plist string and the body on stdin (`"-title", plistQuote(n.title)`, `input: n.body`); the group (`"-group", plistQuote(notifierGroup(n.id))`); the chooser order and its fixed paths (`TERMINAL_NOTIFIER_PATHS`, never `PATH`); the osascript invocation byte-for-byte (`"display notification (item 2 of argv) with title (item 1 of argv)"`); `spawnNotifierWith`, `notifierEnv` and `failureOf` untouched; "exactly one notifier process per call". reuse: `plistQuote` for the `-open` value; `deepLinkFor` from `./record.js` (no new link builder; `record.ts` imports nothing from `notifier.ts`, so no cycle). mirror: the stored `deep_link` is `deepLinkFor(id)` (`store.prepare("UPDATE notifications SET deep_link = ? WHERE id = ?").run(deepLinkFor(id), id);` in `kernel/src/notifications/record.ts`), so the `-open` value equals the row's link. pinned by: `kernel/test/notifications.test.ts` (`'"loomwright-studio-notification-1"'`, `delivery_detail:`), `kernel/test/phase-2-exit.test.ts` (`argAfter(post.args, "-execute")`, to be rewritten to `-open`).
- **`postNotification`'s callers stay unchanged** — mirror: `kernel/src/notifications/deliver.ts` (`postNotification(row, store.dataDir, deps)`), `kernel/test/notifications-test-guard.test.ts` (`postNotification({ id: 1, title: "t", body: "b" }, tmp,`, sibling item 21's lane) and `kernel/test/notifications.test.ts` (`postNotification({ id: 1, title: "t", body: "b" }, dir, darwin(exec))`) keep compiling because the `(n, dataDir, deps)` signature is kept. Neither of the first two files is edited.
- **`kernel/src/notifications/index.ts`** — keep: the barrel's other exports (`plistQuote`, `postNotification`, `terminalNotifierInvocation`, `osascriptInvocation`, `chooseNotifier`, `notifierGroup`, `spawnNotifier`, `NOTIFIER_TIMEOUT_MS`, `OSASCRIPT_PATH`, `TERMINAL_NOTIFIER_PATHS`); the header's "imports only types and zod: never the Agent SDK" rule. Remove only `clickShellCommand`, `showCommand`, `shellQuote`.
- **`kernel/test/notifications.test.ts`, `kernel/test/phase-2-exit.test.ts`, `kernel/test/phase-2-exit-live.test.ts`** — keep: no test posts a real notification (#99's guard; the stubbed `exec`, `darwin()` and `stubbedContributions()` stay stubs; `phase-2-exit-live.test.ts` stays gated as it is); the hostile `TITLE`/`BODY` constants; the osascript tests. Change: drop `nodePath: NODE, cliPath: CLI` from `darwin()` and `stubbedContributions()` (typecheck covers `test/`, `"include": ["src", "test"]` in `kernel/tsconfig.json`, so a leftover is an excess-property error), and delete the now-unused `NODE`/`CLI` constants in `notifications.test.ts` and `phase-2-exit.test.ts`. In `phase-2-exit-live.test.ts`: drop `createDeliveryDueWork({ cliPath: CLI_PATH })`'s `cliPath` (keep `CLI_PATH`, which the file's other steps still use), and reword both its header comment (`opening Terminal on \`studio notifications show <id>\``) and `// The real notifier, with the click running this checkout's built CLI.` to say the click opens the notification's link in the app. Rewrite the existing pin in "text starting with '-' is data to every notifier …" (`"-execute", expect.stringMatching(/^"/)]`) to `"-open", '"loomwright-studio://notifications/2"'`. Delete the two tests of the removed helpers ("the click's shell command, read by a real /bin/sh …" and "the Terminal command runs the kernel's CLI …").
- **`docs/architecture/notifications.md`** — keep: every relative link resolving (`scripts/check-docs.sh` check 1); the other situation-table rows verbatim.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/notifications.test.ts` — "posts once with terminal-notifier" argv (`"-open"`, no `-execute`) | flip `"-open"` → `"-execute"` in `kernel/src/notifications/notifier.ts` |
| `kernel/test/notifications.test.ts` — new AC 2 test (`-open` is the notification's own link despite `loomwright-studio://approvals/9` in the text) | flip `plistQuote(deepLinkFor(n.id))` → `plistQuote(deepLinkFor(1))` in `kernel/src/notifications/notifier.ts` |
| `kernel/test/phase-2-exit.test.ts` — `argAfter(post.args, "-open")` equals the row's quoted link | flip `"-open"` → `"-execute"` in `kernel/src/notifications/notifier.ts` |
| `kernel/test/notifications.test.ts` — "text starting with '-' is data to every notifier" (`"-open", '"loomwright-studio://notifications/2"'`) | flip `"-open"` → `"-execute"` in `kernel/src/notifications/notifier.ts` |
| `kernel/test/notifications.test.ts` — `delivery_detail` / `notifications show` detail string | flip `; a click opens ` → `; a click runs ` in `kernel/src/notifications/notifier.ts` |

The notifier must contain `plistQuote(deepLinkFor(n.id))` exactly once (the `-open` argv item) and `"-open"` exactly once, so each row's mutation hits one line.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Post with `-open <deep link>`, drop the Terminal click path, update tests and docs | 1, 2, 3, 4, 5, 6 (7 is the owner's, at the rerun) | 6 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1 — -open click, Terminal path removed (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/notifications/notifier.ts", name: "terminalNotifierInvocation"}
  - {kind: "symbol", path: "kernel/src/notifications/notifier.ts", name: "postNotification"}
  - {kind: "symbol", path: "kernel/src/notifications/notifier.ts", name: "-open"}
  - {kind: "symbol", path: "kernel/test/notifications.test.ts", name: "loomwright-studio://approvals/9"}
  - {kind: "symbol", path: "kernel/test/phase-2-exit.test.ts", name: "-open"}
  - {kind: "symbol", path: "docs/architecture/notifications.md", name: "-open"}
requires: []
lanes:
  - "kernel/src/notifications/notifier.ts"
  - "kernel/src/notifications/index.ts"
  - "kernel/test/notifications.test.ts"
  - "kernel/test/phase-2-exit.test.ts"
  - "kernel/test/phase-2-exit-live.test.ts"
  - "docs/architecture/notifications.md"
external_requires:
  - "terminal-notifier 2.0 `-open URL` handing a custom scheme to LaunchServices (observed only at the phase 5 live rerun)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| notifier | `kernel/src/notifications/notifier.ts`, `kernel/src/notifications/index.ts` | — | HIGH |
| tests | `kernel/test/notifications.test.ts`, `kernel/test/phase-2-exit.test.ts`, `kernel/test/phase-2-exit-live.test.ts` | — | HIGH |
| docs | `docs/architecture/notifications.md` | — | HIGH |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans `docs/`, `CLAUDE.md` and `README.md` for relative links; only `docs/architecture/notifications.md` changes, and its existing links must still resolve. Historical evidence (`docs/evidence/phase-2-*.json`, `docs/evidence/phase-2-notifier-probe.md`) records past runs and is not edited. `docs/OPEN_QUESTIONS.md` and `docs/DECISIONS.md` D33 mention the old Terminal click as history; leave them unless a line states it as current behaviour (then a one-line update is in scope for the docs group).

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/notifications/notifier.ts:7` | yes | HOLDS | `//   click action (\`-execute\`). Its click opens Terminal on` | tip 10 minutes ago, fetched <1h |
| `kernel/src/notifications/record.ts:102` | yes | HOLDS | `store.prepare("UPDATE notifications SET deep_link = ? WHERE id = ?").run(deepLinkFor(id), id);` | tip 10 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| terminal-notifier 2.0's `-open` may not hand a custom scheme to LaunchServices the way it does https (requirement assumption) | MEDIUM | Not machine-checkable; AC 7 is the owner's observation at the rerun. Unit tests pin only the argv. If it fails at the rerun, the row still says `delivered` and the app's deep link still works; the docs' Limits bullet says so. |
| A test posts a real notification | HIGH | No test spawns the real notifier: keep the stub `exec` in `darwin()`/`stubbedContributions()`; #99's guard applies; `phase-2-exit-live.test.ts` stays behind its existing gate. |
| Removing `nodePath`/`cliPath` from `NotifierDeps` leaves an excess property in a test object literal (typecheck covers `test/`) | MEDIUM | `grep -rn "nodePath\|cliPath" kernel/test` at base finds notifier uses only in three files, all in lanes: `notifications.test.ts` `darwin()`, `phase-2-exit.test.ts` `stubbedContributions()`, `phase-2-exit-live.test.ts` `createDeliveryDueWork({ cliPath: CLI_PATH })`. `npm run typecheck` is in the validation. |
| Plist quoting changes the `-open` value terminal-notifier sees | LOW | p11 showed quoted plist strings round-trip exactly (`-group` is already passed this way). An unquoted URL would also parse, but quoting keeps one rule for every `-key value`. |
| Sibling item 21 (notifier guard) owns `kernel/test/notifications-test-guard.test.ts`, which calls `postNotification(…, tmp, …)` | MEDIUM | `postNotification` keeps its `(n, dataDir, deps)` signature, so that file is neither edited nor broken. No declared Touch of items 20 or 21 (`app/e2e/fixtures/menubar.ts`, `kernel/test/notifier-guard.ts`, `kernel/test/notifications-test-guard.test.ts`, `app/e2e/phase-5-exit.spec.ts`) is in these lanes. Rebase on `main` before the PR if one lands first. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-notification-click-opens-the-app.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-24T07:37:04Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/126
- **Branch:** feature/notification-click-opens-the-app
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** terminal-notifier posts with `-open plistQuote(deepLinkFor(id))` instead of the `-execute` Terminal click; showCommand/clickShellCommand/shellQuote/nodePath/cliPath removed; delivery_detail names the link and Loomwright Studio.app; tests and docs updated. Phase 4.5 fixed two MEDIUM doc findings (stale Terminal-click references; phase-2 runbook click field) in 2 iterations, then PASS with no issues. pin_mutations script unverified (unsupported_pin_runner); all mutations caught on manual runs by the Supervisor and the reviewer.

## Not verified
- **terminal-notifier -open click handing loomwright-studio:// to LaunchServices on a real Mac** — needs the owner at the screen at the phase 5 live rerun (AC 7) (subtask 1)
- **kernel/test/phase-2-exit-live.test.ts live run** — gated behind STUDIO_LIVE=1 and the owner's launchd service; typechecked only (subtask 1)
