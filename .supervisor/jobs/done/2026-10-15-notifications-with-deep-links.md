# Supervisor Job: Notifications — native macOS notifications with a stable deep link, plus `studio notifications`

## Environment
- **Project:** loomwright-studio (lane clone L2)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094203-notifications-with-deep-links.md
- **Base commit:** 41425e0778cf31a3912694f32bc0a742b6ebf41e
- **Blockers:** 0 | **Warnings:** 0

## Task
**Goal:** Build the phase 2 `notifications` feature in `kernel/src/notifications/`: a record function other features call, per-tick native macOS delivery with a click that opens Terminal on `studio notifications show <id>`, the `kernel_notify` agent tool, the `studio notifications` CLI backed by API routes, the doc page and the notifier probe evidence. Also close the item 01 seam gap the owner ruled on: contributed API routes get the store.

**Problem Statement:**
Today a `notify` is only an audit row in `events`; nothing reaches the owner, and phase 2 has no GUI. The owner needs a native notification that opens the details on click, and a CLI list of every notification. The item 01 seam gives a contributed route only `{params, query, body}` (contributions are merged before the store opens), so no feature route can read its own table.

**Owner decisions (binding):**
- 2026-10-14 (requirement): delivery is a native macOS notification **and** a CLI list; every notification carries the stable deep link `loomwright-studio://notifications/<id>`, recorded and shown in the CLI; in phase 2 a click opens Terminal on `studio notifications show <id>`.
- 2026-10-15 (lane L2 question "Route seam"): **fix the seam in this PR**: add the store (and the clock) to what a contributed route handler receives, in `kernel/src/features/contribution.ts` + `kernel/src/api/server.ts`, with a seam test. This is outside the requirement's declared Touches by the owner's choice. Lane L3 (triggers) needs the same; keep the change minimal and additive so an overlapping edit merges cleanly.

## Acceptance Criteria
- [ ] Given the seam change, when a contributed route is called, then its handler receives the kernel's `store` and `now` in addition to `params`, `query` and `body`; the phase 1 routes and every existing seam test behave as before (additive field, no reordering of existing ones).
- [ ] Given `recordNotification(store, {source, title, body}, now)`, then exactly one `notifications` row exists with status `pending`, `deep_link` = `loomwright-studio://notifications/<its id>`, committed in one transaction with one audit event (`notification_created`, id and source); `source` must be `trigger:<id>`, `agent:<name>` or `kernel:<reason>` or the call throws without writing.
- [ ] Given a recorded notification, when the loop ticks (notifications due work), then exactly one native post is attempted and the row moves to `delivered` / `failed` / `unsupported` with `delivery_detail`; delivery is keyed on a work step per notification id (not re-runnable), so a crash between post and status write never posts it again: a duplicate post is impossible by construction — a step interrupted between post and status write ends the row `failed` with detail `interrupted` (stricter than the requirement's "one duplicate after a crash is acceptable"; documented).
- [ ] Given delivery fails, then exactly one audit event records it (`notification_delivery_failed`, id, clipped error) and the row stays `failed`; later ticks do not retry it (D17).
- [ ] Given a non-macOS platform, or no click-capable notifier available, then the row is `unsupported` with the reason in `delivery_detail`, and the notification is still posted without a click action when a plain notifier exists.
- [ ] Given `kernel_notify(title, body, idempotency_key)` called twice with the same key in one session, then one notification exists (source `agent:<session's agent, or "unknown">`), and its `notification_created` event carries the session id.
- [ ] Given a body containing shell metacharacters, quotes and newlines, then the notifier is invoked with an argv array (never a shell string) carrying the text literally, and nothing is executed — tested with a stub notifier asserting the exact argv.
- [ ] Given `studio notifications [--limit N] [--json]`, then it lists newest first id, time, source, title, delivery status and deep link, via `GET /notifications` (bearer token).
- [ ] Given `studio notifications show <id>`, then it prints the full record including the deep link, plus for a `trigger:<id>` source the trigger's id, action and next fire, and for an agent source the session id and status; for an unknown id it exits non-zero with "no such notification" (`GET /notifications/:id` answers 404 `{error:"no_such_notification"}`).
- [ ] Given the shipped kernel, then the feature-seam test lists exactly the notifications contribution's tool, routes, subcommand and due work as the only additions beyond phase 1 (the AC3 "nothing preinstalled" test is updated to name them; no other feature registers anything).
- [ ] `docs/architecture/notifications.md` documents the record, delivery, the deep-link scheme, the chosen notifier, its limits, and the at-most-once/crash behaviour.
- [ ] Evidence-file form: `docs/evidence/phase-2-notifier-probe.md` records the probe (`probes/p11-notifier-under-launchd.mjs`) run on this Mac under a launchd agent: which notifier candidates were tried, each one's exit status and output, and a clearly marked "Owner observation" section (notification appeared? click opened Terminal on `studio notifications show <id>`? any permission prompt?) left for the owner to fill in where the worker cannot observe it. The PR body links this file.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | TypeScript kernel, better-sqlite3 store, zod tools, existing contribution seam |
| 2 | Dependency Availability | CAUTION | A click-capable notifier from a launchd agent is unproven; `osascript display notification` has no click action; `terminal-notifier` (Homebrew) is present on this Mac but is a third-party binary |
| 3 | Architecture Fit | CAUTION | Routes need store access the seam lacks; owner chose a seam change in this PR |
| 4 | Scope vs Supervisor Capability | GO | One feature directory plus a ~10-line seam change; single subtask |
| 5 | Hard Blockers | GO | Table exists (migration 11); due-work, tool, route, subcommand seams exist |

**Overall Verdict:** CAUTION

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| seam | `kernel/src/features/contribution.ts`, `kernel/src/api/server.ts` | — | HIGH |
| notifications | `kernel/src/notifications/index.ts` | `kernel/src/notifications/record.ts`, `kernel/src/notifications/deliver.ts`, `kernel/src/notifications/notifier.ts`, `kernel/src/notifications/cli.ts` | HIGH |
| tests | `kernel/test/feature-seams.test.ts`, `kernel/test/cli.test.ts` (line 614: `studio service` usage text under the default contributions now includes the notifications help line) | `kernel/test/notifications.test.ts` | HIGH |
| probe + docs | `docs/architecture/notifications.md`, `docs/ARCHITECTURE.md` (line 65 `kernel_notify(message)` → the new `kernel_notify(title, body, idempotency_key)` signature; line 134 "The handler gets the params, the query and the parsed JSON body" → also the store and the clock) | `probes/p11-notifier-under-launchd.mjs`, `docs/evidence/phase-2-notifier-probe.md` | MEDIUM |
| deps (only if unavoidable) | `kernel/package.json`, `kernel/package-lock.json` (exact pin) | — | LOW |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` checks relative links in `docs/` resolve — any link added in the doc page or evidence file must resolve.

## Touched-file invariants
Stamped against base commit 41425e0778cf31a3912694f32bc0a742b6ebf41e.

- `kernel/src/features/contribution.ts`
  - Module-graph rule: "The `studio` CLI (a separate process) imports this module through `features/index.ts`, so it imports only zod and type-level kernel modules" — the store must be added as `import type { Store }` (already imported that way: `import type { Store } from "../store/store.js";`). Same rule binds every file under `kernel/src/notifications/`: "it imports only types and zod: never the Agent SDK" (notifications/index.ts header); `kernel/test/feature-seams.test.ts` "the feature registry's module graph (AC9)" pins it — notifications code may import `../loop/internal.js`, `../loop/steps.js`, `../store/store.js` only if they do not load the Agent SDK (verify with that test).
  - `export interface ContributedRouteRequest {` — extend additively; keep `params`, `query`, `body`.
  - `// Mechanism only (invariant 1): the merge validates and refuses, it adds no` — do not change merge/validation logic.
  - `// The \`studio\` CLI (a separate process) imports this module through` — the CLI module-graph rule (next bullet).
- `kernel/src/api/server.ts`
  - `const { status: answered, body: answerBody } = await match.route.handler({ params: match.params, query, body });` — the one call site to extend with `store` and `now`.
  - Authentication before routing and the `recordRouteFailure` fail-safe ("a failed write ... never changes the 500") stay unchanged.
- `kernel/src/notifications/index.ts`
  - `export const notificationsContribution: FeatureContribution = Object.freeze({ name: "notifications" });` — keep the export name and `name: "notifications"`.
- `kernel/test/feature-seams.test.ts`
  - `expect(kernel.contributions.routes).toEqual([]);` / `subcommands` / `dueWork` / `kernelToolNames(...)).toEqual([...KERNEL_TOOL_NAMES])` in "the shipped kernel (AC3)" — update to the notifications parts only; keep `contributors` order `["loomwright", "notifications", "triggers", "approvals", "brain"]`.
  - `expect(await runCli(["probe"], …)).toBe(2); expect(stderr.text()).toBe(\`${USAGE}\n\`);` — the usage text now gains the notifications help line; assert the new text, do not delete the check.
  - "the shipped contributions: the five features in a fixed order, each registering nothing (AC3)" (lines 72-82): `expect(Object.keys(c)).toEqual(["name"]);` for every shipped contribution and the empty merged lists — keep the per-contribution check for the other four, and for notifications assert its exact keys (name, tools, routes, subcommands, dueWork); never delete the check.
  - Line 692 `${USAGE} | studio probe <id>` composes only the probe contribution (`contributions: [contribution]` at line 641): unaffected.
- `kernel/test/cli.test.ts`
  - `expect(c.stderr.text()).toBe(\`${USAGE}\n\`);` (line 614, "studio service with no or another action prints usage and exits 2", default contributions) — assert the usage text with the notifications help line appended (`usageText` in `kernel/src/cli/index.ts`), do not delete it.
- Audit rows: `appendEvent(store, kind, ref, payload, at)` in `kernel/src/loop/internal.ts` and `clip()` for free text — reuse, never a hand-written `INSERT INTO events`.
- Work steps: `runStepAsync(store, key, fn, opts)` / `runStep` in `kernel/src/loop/steps.ts`; a contributed tool's key comes from `ctx.stepKey(idempotencyKey)`.

## Closed enumerations touched
New audit `events.kind` values: `notification_created`, `notification_delivery_failed`. Sibling search: `grep -rn "due_work_failed" kernel/src kernel/test docs` → `kernel/src/loop/loop.ts:162` (the writer) and `kernel/test/feature-seams.test.ts:244` (a reader) only; `grep -rn "kind IN" kernel/src` → `kernel/src/sessions/orphans.ts:15` and `kernel/src/api/kill-switch.ts:24`, both filters over their own kinds, not lists every kind must join. `appendEvent(store, kind, …)` takes any string. **No closed list must carry the new kinds.** The `notifications.delivery_status` set (pending / delivered / failed / unsupported) is unchanged; validate it in code (migration 11: "every value set below is closed in code").

## Pin mutations
- The shipped-kernel test's new notifications lists: deleting the notifications `dueWork` entry (or a route) from `notificationsContribution` must turn it red.
- The seam test for route context: removing `store` from the `match.route.handler({...})` call must turn it red.
- The argv test: building the notifier command as a single shell string (`exec`/`shell: true`) must turn it red.
- The no-retry test: changing due work to select `failed` rows as well as `pending` must turn it red.
- The second AC3 test's notifications keys: adding or removing a part of `notificationsContribution` must turn it red.
- Source validation: accepting a source without a `trigger:` / `agent:` / `kernel:` prefix (or writing the row before validating) must turn it red.
- Deep link: building it from anything but the inserted row id (e.g. a counter) must turn it red.
- `kernel_notify` idempotency: dropping `ctx.stepKey(idempotency_key)` from the step key must turn it red.
- Unknown id: answering 200 with `null` instead of 404 `{error:"no_such_notification"}` must turn the route test and the CLI non-zero-exit test red.
- Non-macOS: posting on a non-darwin platform instead of marking `unsupported` must turn it red.

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Route seam + notifications feature + probe + docs | all | 7 modify, 8 create | unit-testing, error-handling | LAUNCHABLE |

## Parallelism Analysis
single-agent (no fan-out)

- **Recommended workers:** 1
- **Estimated batches:** 1

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "ContributedRouteRequest"}
  - {kind: "file", path: "kernel/src/notifications/record.ts"}
  - {kind: "symbol", path: "kernel/src/notifications/record.ts", name: "recordNotification"}
  - {kind: "file", path: "kernel/src/notifications/deliver.ts"}
  - {kind: "file", path: "kernel/src/notifications/notifier.ts"}
  - {kind: "file", path: "kernel/src/notifications/cli.ts"}
  - {kind: "symbol", path: "kernel/src/notifications/index.ts", name: "notificationsContribution"}
  - {kind: "file", path: "kernel/test/notifications.test.ts"}
  - {kind: "file", path: "probes/p11-notifier-under-launchd.mjs"}
  - {kind: "file", path: "docs/evidence/phase-2-notifier-probe.md"}
  - {kind: "file", path: "docs/architecture/notifications.md"}
requires: []
lanes:
  - "kernel/src/notifications/**"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/api/server.ts"
  - "kernel/test/notifications.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/cli.test.ts"
  - "probes/p11-notifier-under-launchd.mjs"
  - "docs/architecture/notifications.md"
  - "docs/evidence/phase-2-notifier-probe.md"
  - "docs/ARCHITECTURE.md"
  - "kernel/package.json"
  - "kernel/package-lock.json"
external_requires:
  - "macOS user GUI (Aqua) session for a launchd agent to post notifications"
  - "osascript (ships with macOS); terminal-notifier (Homebrew) only if the probe chooses it"
```

## Skill References
- `skills/unit-testing/SKILL.md` (vitest patterns; stub notifier asserting argv)
- `skills/error-handling/SKILL.md` (delivery failure is one audit event, no retry loop)

## Risk Assessment
| Risk | Impact | Mitigation |
|------|--------|------------|
| No click-capable notifier works from a launchd agent without a signed app bundle (D31 class) | HIGH | Feasibility (Phase 2.5). Ship `unsupported` click delivery with the link still recorded; say so in the evidence and doc. Grant nothing system-wide to `node` |
| Third-party notifier binary is a supply-chain dependency | MEDIUM | Feasibility (Phase 2.5). Prefer a macOS-shipped mechanism; if `terminal-notifier` is chosen, resolve it from a fixed absolute path, never install it, and degrade to `unsupported` when absent; pin exactly if an npm dependency is unavoidable |
| Seam change outside declared Touches overlaps lane L3 (triggers) | MEDIUM | Owner decision 2026-10-15. Keep the change additive (one new field pair, one call site) so a matching L3 edit merges or conflicts trivially at wave-build |
| Notification text reaching a shell | HIGH | argv arrays only (`execFile`/`spawn` without `shell`); AppleScript text passed as `on run argv` arguments, never interpolated into the script source |
| Human-only evidence (did it appear, did the click work) cannot be produced by the worker | MEDIUM | Evidence file separates machine-observed results from an "Owner observation" section; PR body lists that step under "Not verified" |
| Due-work throw stops nothing but repeats every tick | LOW | Due work catches per-row errors into `failed` + one audit event; a whole-function throw is the loop's `due_work_failed` |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-15-notifications-with-deep-links.md

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-15T01:47:37Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/50
- **Branch:** feature/phase-2-notifications-with-deep-links (stacked on PR #48 head 568a388; PR base main)
- **Files changed:** 16
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1 (iteration-3 HIGH, fixed in abcf72b but not re-reviewed)
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Route seam (store/now) plus the notifications feature (record, at-most-once delivery via terminal-notifier with an osascript fallback, kernel_notify, API routes, studio notifications CLI), the p11 probe under launchd, and docs. Phase 4.5 fixed a BLOCKING osascript option injection, a MEDIUM unbounded notifier timeout and a HIGH EMFILE daemon crash; the final fix was not re-reviewed. 912 tests pass.

## Not verified
- **native banner appearance and click opening Terminal on studio notifications show <id>** — needs the owner at the screen; evidence section 4 pending (subtask 1)
- **macOS permission prompts (Notifications, Automation for Terminal)** — not observable by the worker (subtask 1)
- **installed kernel (studio service install) delivering a real notification end to end** — needs a running daemon plus an agent kernel_notify or a trigger (lane L3); the store is locked by the daemon (subtask 1)
