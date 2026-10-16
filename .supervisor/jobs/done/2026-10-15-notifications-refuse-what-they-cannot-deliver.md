# Supervisor Job: Notifications refuse what they cannot deliver, and print what they show safely

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-15-153327/L3
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-15-084412-notifications-refuse-what-they-cannot-deliver.md
- **Base commit:** 95d31567140e3101e029cd985b7895a5b7fee8a1

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`; no new dependency. |
| 2 | Dependency Availability | GO | `terminal-notifier` 2.0.0 is at `/opt/homebrew/bin/terminal-notifier` on this Mac (needed for the scope-2 probe). |
| 3 | Architecture Fit | GO | All changes sit inside the notifications feature (`kernel/src/notifications/`) and its doc/evidence pages. |
| 4 | Scope vs Supervisor Capability | GO | ~7 files, well under the context-bound threshold; single subtask. |
| 5 | Hard Blockers | CAUTION | The empty-body probe and the p11 re-run post real, visible notifications on the owner's Mac and briefly bootstrap a launchd agent (p11 cleans up after itself). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Refuse at record time any notification title or body carrying a NUL (both `recordNotification` and `kernel_notify`), probe and pin terminal-notifier's empty-body behaviour, escape bidi controls and U+2028/U+2029 in `printable`, document what `--json` leaves raw, add the missing branch tests, and correct the `spawnNotifier` bound comment and the stale probe output.

**Problem Statement:**
The owner needs every recorded notification to be deliverable and every printed one to be safe in a terminal, because a NUL in the title is accepted today and then makes the notifier spawn fail (row `failed`), an empty body's fate under terminal-notifier is unverified, and `printable` lets bidi controls and line/paragraph separators through. Currently the review of item 03 found these gaps plus two missing branch tests and two stale comments/outputs. Success looks like: a NUL title/body is refused with no row written, the empty-body case is evidenced and pinned, `studio notifications show` escapes U+202E/U+2028/U+061C, and the two untested branches are pinned.

## Acceptance Criteria
- [ ] Given a title (or body) containing NUL, when `kernel_notify` is called, then it answers an error result (`isError: true`) and no `notifications` row and no `kernel_notify:session-<id>:<key>` work step is recorded; and given the same through `recordNotification`, then it throws `InvalidNotificationError` and writes nothing.
- [ ] Given an empty body, then a committed evidence file `docs/evidence/phase-2-notifier-probe.md` contains the exact command run against `/opt/homebrew/bin/terminal-notifier` with an empty stdin body, its exit status and output, and the PR body links to it; and the code makes a recorded empty-body notification either delivered or refused at record time — never left `failed` by the spawn — pinned by a test in `kernel/test/notifications.test.ts`.
- [ ] Given a title with U+202E, U+2028 or U+061C, when `studio notifications show <id>` (and the list view) prints it, then each of those characters appears escaped as `\uNNNN` (lower-case hex, 4 digits) and none appears raw; the full set escaped is U+202A–U+202E, U+2066–U+2069, U+061C, U+200E, U+200F, U+2028, U+2029.
- [ ] Given `docs/architecture/notifications.md`, then its API-and-CLI section states that the text views write control characters as `\xNN` (a line feed as `\n`, or as a real line break in `show`'s body) and the bidi controls and U+2028/U+2029 as `\uNNNN`, and that `--json` prints the API's JSON as `JSON.stringify` writes it (C1 characters, bidi controls and U+2028/U+2029 are left raw) instead of claiming the escaping only the text views do.
- [ ] Given a delivery step already `failed:interrupted` while its row is still `pending` (a crash between the interrupt mark and the row write), when the next tick runs, then the row ends `failed` with detail `interrupted`, the notifier is never called, and exactly one `notification_delivery_failed` event is written — pinned by a test.
- [ ] Given `studio notifications show <id>` for an `agent:` notification whose `notification_created` event has no session (null) and for one whose session row no longer exists, then it exits 0 and prints `  session:   unknown` / `  session:   #<id>, status unknown (no such row)` respectively — pinned by tests.
- [ ] Given `kernel/src/notifications/notifier.ts`, when a reader checks the `spawnNotifier` comment against the code, then the comment names all three settle paths (on 'close'; `DRAIN_MS` after 'exit'; `KILL_GRACE_MS` after the timeout's kill) and states the overall worst case together with its derivation in the comment itself: an 'exit' before the timeout settles by `timeoutMs + DRAIN_MS`; after the kill, by the earlier of 'exit' + `DRAIN_MS` and `timeoutMs + KILL_GRACE_MS`; so the bound is `timeoutMs + KILL_GRACE_MS` because `DRAIN_MS` (250) < `KILL_GRACE_MS` (1 000) — or, if the worker's reading of the code differs, the bound the code actually implements with that reading written out in the comment.
- [ ] Given `docs/evidence/phase-2-notifier-probe.md` section 1, when the current `probes/p11-notifier-under-launchd.mjs` is re-run, then the section's verbatim output is replaced by that run's output, dated, with the macOS / Node / terminal-notifier versions of that run, and the read-off bullets still match it.
- [ ] Given the change, when `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` run, then all pass.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| record + tool | `kernel/src/notifications/record.ts`, `kernel/src/notifications/tool.ts` | — | HIGH |
| CLI printing | `kernel/src/notifications/cli.ts` | — | HIGH |
| notifier | `kernel/src/notifications/notifier.ts` (comment; empty-body handling if the probe shows it fails) | — | HIGH (comment) / MEDIUM (empty body) |
| index exports | `kernel/src/notifications/index.ts` (only if a new export is added) | — | LOW |
| tests | `kernel/test/notifications.test.ts` | — | HIGH |
| docs | `docs/architecture/notifications.md`, `docs/evidence/phase-2-notifier-probe.md` | — | HIGH |

`kernel/src/notifications/deliver.ts` is read for the interrupted-redelivery branch (`err instanceof WorkStepFailedError && err.reason === "interrupted"`) but needs no change unless the test exposes a defect.

## Touched-file invariants

> Grounded at base `95d31567140e3101e029cd985b7895a5b7fee8a1`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/notifications/record.ts`** — keep: refusal happens before any write, through `InvalidNotificationError` (`readonly code = "invalid_notification"`) — the NUL check sits beside the existing title/body length checks, ahead of `return store.transaction(() => {`; keep the title/body length rules (`title.length === 0 || title.length > MAX_NOTIFICATION_TITLE`, `body.length > MAX_NOTIFICATION_BODY`) unchanged; reuse: the module's own error type and message shape (`invalid notification: <reason>`); mirror: `kernel/src/loomwright/version-note.ts` and `kernel/src/approvals/store.ts` call `recordNotification` and must keep compiling unchanged (do not edit them); pinned by: `kernel/test/notifications.test.ts` `refuses anything else before touching the store`.
- **`kernel/src/notifications/tool.ts`** — keep: the tool's arguments are validated by its zod `shape` (`title: z.string().min(1).max(MAX_NOTIFICATION_TITLE)`) before `runStep` runs; a NUL refinement there refuses the call at argument validation (defence in depth: a throw inside `runStep` also rolls back and the feature seam turns it into an `isError` result, `kernel/src/features/contribution.ts` "a throw is an `isError` result"); keep the repeat-with-same-key contract (`ctx.stepKey(args.idempotency_key)`); keep the module importing only zod, the feature seam and kernel modules that never load the Agent SDK (header: `Imports only zod, the feature seam and kernel`); pinned by: `kernel/test/notifications.test.ts` `bad arguments are an isError result and record nothing`.
- **`kernel/src/notifications/cli.ts`** — keep: `printable(text, keepNewlines, indent)`'s signature and its C0/C1/DEL `\xNN` escaping (`/[\u0000-\u001f\u007f-\u009f]/g`) byte-for-byte, so every existing expectation (`printable("a\tb\u0085c")).toBe("a\\x09b\\x85c")`) stays green; `--json` keeps printing `JSON.stringify(answer.body, null, 2)` unchanged (scope 3 is a doc change for `--json`); mirror: `kernel/src/approvals/cli.ts` `shown()` wraps `printable` and then escapes `BIDI` as `\\u${…padStart(4, "0")}` — use the same `\uNNNN` lower-case 4-digit form so both views agree (do not edit approvals); pinned by: `kernel/test/notifications.test.ts` `every control character escaped` and `expect(agent.stdout).not.toMatch(`.
- **`kernel/src/notifications/index.ts`** — keep: every existing re-export unchanged (`export { NOTIFICATIONS_HELP, formatNotification, notificationsSubcommand, printable } from "./cli.js";`); only append a new export when one is added (the CLI loads this module, so it keeps importing only types and zod beyond its siblings: `so it imports only types and zod: never the` in its header).
- **`kernel/src/notifications/deliver.ts`** — keep: at most once — the post runs in `runStepAsync(store, deliveryStepKey(id), …)` with no `rerunnable` option; the conditional settle (`WHERE id = ? AND delivery_status = 'pending'`); the interrupted mapping (`err instanceof WorkStepInterruptedError || (err instanceof WorkStepFailedError && err.reason === "interrupted")`); exactly one `notification_delivery_failed` event per failed row; change it only if the new test exposes a defect; pinned by: the existing `a crash between the post and its record` test and the new interrupted-redelivery test.
- **`kernel/src/notifications/notifier.ts`** — keep: argv arrays only (header: `shell string, never \`shell: true\``); terminal-notifier gets the body on stdin and the title as `plistQuote(n.title)`; `spawnNotifierWith` settles exactly once (`if (settled) return;`); reuse `DRAIN_MS` / `KILL_GRACE_MS` names in the corrected comment; any empty-body handling must keep the body off argv as bare text; pinned by: `kernel/test/notifications.test.ts` `posts once with terminal-notifier: argv only` and `spawnNotifier: a descendant holding the pipes`.
- **`kernel/test/notifications.test.ts`** — keep: the header rule `Never a real notification.` — tests use the `stubExec` notifier stub; the empty-body probe against the real terminal-notifier is run by hand and recorded in the evidence file, never from vitest.
- **`docs/architecture/notifications.md`** / **`docs/evidence/phase-2-notifier-probe.md`** — keep: every relative link resolvable (`bash scripts/check-docs.sh` check 1); keep section 4 (`## 4. Owner observation`) and its `(pending)` blocks untouched — only the owner fills them; home paths in pasted output are written with a placeholder (`/Users/<name>/`), never verbatim.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/notifications.test.ts` — NUL refused by `recordNotification` | delete the line in `kernel/src/notifications/record.ts` that throws `InvalidNotificationError` for a NUL in the title or body (the worker names the exact literal in the PR body) |
| `kernel/test/notifications.test.ts` — NUL refused by `kernel_notify` at argument validation | delete the NUL refinement on the `title`/`body` entries of `notifyTool`'s `shape` in `kernel/src/notifications/tool.ts` — the pin asserts the error result's text is the zod argument error naming `title` (resp. `body`), not `invalid notification: …`; without the refinement the record-time throw still yields `isError` and no row (`runStep` rolls back on a throw, `kernel/src/loop/steps.ts`), so only the error text tells the two apart |
| `kernel/test/notifications.test.ts` — `show` for a session row that no longer exists | flip `s.status === null ?` → `s.status === undefined ?` in `kernel/src/notifications/cli.ts` |
| `kernel/test/notifications.test.ts` — bidi / U+2028 / U+061C escaped in `show` | delete the bidi/separator replace line added to `printable` in `kernel/src/notifications/cli.ts` |
| `kernel/test/notifications.test.ts` — interrupted redelivery | flip `err.reason === "interrupted"` → `err.reason === "never"` in `kernel/src/notifications/deliver.ts` |
| `kernel/test/notifications.test.ts` — `show` with a null session | flip `s === null ?` → `s === undefined ?` in `kernel/src/notifications/cli.ts` |
| `kernel/test/notifications.test.ts` — empty body never `failed` by the spawn | delete the empty-body handling line the worker adds (in `notifier.ts` or `record.ts`, per the probe result); when the probe shows terminal-notifier already exits 0 on an empty body and no code change is needed, this row's pin asserts the exact stdin (`""`) an empty-body notification is posted with, and its mutation is flip `input: n.body` → `input: `${n.body}\n`` in `kernel/src/notifications/notifier.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Notifications hardening: NUL refusal, empty-body probe, safe printing, branch tests, comment/evidence fixes | all | 7 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/notifications/record.ts"}
  - {kind: "symbol", path: "kernel/src/notifications/record.ts", name: "InvalidNotificationError"}
  - {kind: "symbol", path: "kernel/src/notifications/tool.ts", name: "notifyTool"}
  - {kind: "symbol", path: "kernel/src/notifications/cli.ts", name: "printable"}
  - {kind: "symbol", path: "kernel/src/notifications/notifier.ts", name: "DRAIN_MS"}
  - {kind: "file", path: "kernel/test/notifications.test.ts"}
  - {kind: "file", path: "docs/architecture/notifications.md"}
  - {kind: "file", path: "docs/evidence/phase-2-notifier-probe.md"}
requires: []
lanes:
  - "kernel/src/notifications/**"
  - "kernel/test/notifications.test.ts"
  - "docs/architecture/notifications.md"
  - "docs/evidence/phase-2-notifier-probe.md"
external_requires:
  - "terminal-notifier 2.0.0 at /opt/homebrew/bin/terminal-notifier (owner-installed; probe only)"
  - "launchctl GUI domain access for probes/p11-notifier-under-launchd.mjs"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The probes post real notifications and p11 bootstraps a launchd agent on the owner's Mac (Feasibility (Phase 2.5)) | MEDIUM | Run only the two commands the requirement asks for (an empty-body terminal-notifier post with its own `-group`, removed afterwards with `-remove <group>`; the p11 re-run, which boots its agent out itself). Never from vitest. Write home paths in pasted output as `/Users/<name>/`. |
| `kernel/src/triggers/store.ts` has its own private `recordNotification` that writes `notifications` directly, so a trigger whose `action_payload` holds a NUL still reaches the notifier and ends `failed` | MEDIUM | Out of this item's Touches: do not edit `kernel/src/triggers/`. State the gap in `docs/architecture/notifications.md` (the refusal covers `recordNotification` and `kernel_notify`; trigger notifications use the triggers feature's own writer) and name it in the PR body as a follow-up. |
| `kernel/src/approvals/store.ts` builds a notification title from the approval `action`; a NUL in an action would now make `requestApproval` throw `InvalidNotificationError` instead of `ApprovalError` | LOW | Out of Touches: do not edit approvals. Name the behaviour change in the PR body as a follow-up; existing approvals tests must stay green. |
| `kernel/src/loomwright/version-note.ts` builds notification titles from a contract's `plugin_version` (via `oneLine()`, which keeps NUL); `kernel/src/loomwright/contract.ts` accepts any non-empty string there, so a contract with a NUL in `plugin_version` would now make `recordNotification` throw inside the version check's transaction, roll back its `loomwright_contract_seen` row and repeat as `due_work_failed` each interval (today: one notification that ends `failed`) | MEDIUM | Out of Touches: do not edit `kernel/src/loomwright/`. Name the behaviour change in the PR body as a follow-up (refuse or sanitise at the contract parser). |
| `printable` is shared: `kernel/src/approvals/cli.ts` `shown()` wraps it, and its own BIDI set lacks U+061C, U+2028 and U+2029, so `studio approvals` output changes for those three characters too (an improvement) | LOW | No edit to approvals; `kernel/test/approvals.test.ts` must stay green (its `\\u202eevil` pin uses the same lower-case 4-digit form). |
| The empty-body outcome depends on what the probe shows | MEDIUM | Decide from the recorded probe output: exit 0 ⇒ pin the stdin a recorded empty body is posted with; non-zero/hang ⇒ deliver a body that is never empty, or refuse an empty body at record time (and document which). Either way the evidence file records the command and output first. |
| Section 2 of the evidence already says an empty stdin body "came back from `-list` as sent" from an interactive shell | LOW | The new probe line states its own conditions (spawned with a pipe, as the kernel does) and does not rewrite section 2's historical record. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-15-notifications-refuse-what-they-cannot-deliver.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-15T16:32:55Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/60
- **Branch:** feature/11-notifications-refuse-undeliverable
- **Files changed:** 11
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** NUL refused at record time (recordNotification, kernel_notify, and — by owner decision, outside Touches — requestApproval / kernel_approval_request); printable escapes bidi controls and U+2028/U+2029; empty body probed (exit 0) and pinned; interrupted-redelivery and null/missing-session tests; spawnNotifier bound derived; p11 section 1 re-run. Heal: iteration 1 FAIL (HIGH approvals regression + MEDIUM doc wording) fixed in dfbf9de; iteration 2 PASS with 3 LOW dismissed. Follow-ups: Loomwright version note (plugin_version NUL) and triggers' own writer. risk_classification: high_risk false.

## Not verified
- **the empty-body notification banner on screen** — the probe saw exit 0 and -list holding it; whether a banner appeared needs the owner at the screen (section 4) (subtask 1)
- **studio approvals output for U+061C/U+2028/U+2029 (shared printable)** — covered only by the approvals tests staying green, not run by hand (subtask 1)
