# Supervisor Job: Approval gate (CLI) — outward or persistent actions wait for the owner's decision, without holding a session open

## Environment
- **Project:** loomwright-studio (lane clone L4)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094205-approval-gate-from-the-cli.md
- **Base commit:** 5b0b60b101a151ba8e441609d86b438c0956ad2d
- **Blockers:** 0 | **Warnings:** 0

## Task
**Goal:** Build the phase 2 `approvals` feature in `kernel/src/approvals/`: the `kernel_approval_request` agent tool (records a `pending` approval plus a `kernel:approval` notification and returns at once), a fixed outward/persistent action set and a fixed protected-kernel-path deny set enforced in the kernel's `PreToolUse` rail, the owner's `studio approvals` / `studio approve <id> once|always` / `studio deny <id>` CLI backed by API routes, decision delivery as one queued `message` event, exact-payload one-shot grants, and the doc page.

**Problem Statement:**
Phase 1 has no approval mechanism. `docs/ARCHITECTURE.md` lists `kernel_approval_request(action, payload)` and an `approvals` table (migration 11 created it, nothing writes it). The `PreToolUse` gate (`SessionManager#gate` → `decideToolUse` in `kernel/src/sessions/policy.ts`) decides allow/deny from the session's policy only; it holds nothing for the owner and checks no paths. Note a stale premise in the requirement: AC "`gh pr merge 12` … is blocked as in phase 1" — phase 1's rail has **no** merge block (`grep -rn "pr merge" kernel/src` → nothing; only `docs/ARCHITECTURE.md:110` describes it). A policy allowing the `gh` prefix would let `gh pr merge` run today, so this item must ADD the outright block.

**Owner decisions (binding, 2026-10-14):**
- Creating triggers and tasks needs no approval (item 04). The gate covers outward or persistent actions and an agent's explicit `kernel_approval_request`.

## Acceptance Criteria
- [ ] Given a session whose policy allows `Bash` prefix `git push`, when it runs `git push origin main`, then the rail denies the call (it does not run), exactly one `pending` approval row holds `action` + the exact command in `payload_json`, one `kernel:approval` notification is recorded, and the hook's `permissionDecisionReason` names the approval id.
- [ ] Given approval 3 pending for that push, when the owner runs `studio approve 3 once`, then approval 3 reads `approved` / `once` / `decided_by: owner`, one `approval_decided` audit event exists, one `event_queue` row of kind `message` with payload `{ text: "approved approval 3: <action>", agent, approval_id: 3 }` is queued, and the next identical `git push origin main` from that agent is allowed once; a second identical push is held again as a new pending approval.
- [ ] Given an approved payload, when the same agent runs a different command (`git push --force origin main`), then it is held as a new approval (exact match on tool + payload only; a grant for one agent never lets another agent's identical call through).
- [ ] Given `studio approve 3 always`, then it exits non-zero with "always-allow is stored per playbook; playbooks arrive in phase 3" and approval 3 stays `pending` (API answers 409/400 with a stable error code; nothing written).
- [ ] Given `studio deny 3`, then 3 reads `denied` / `deny`, the agent gets one `message` event saying so, and the held command never runs (a later identical call is held again as a new approval).
- [ ] Given a decision on a non-pending or unknown id, then it fails clearly (CLI non-zero exit with the reason; API 404 `{error:"no_such_approval"}` / 409 `{error:"approval_not_pending"}`) and writes nothing.
- [ ] Given a session whose policy allows `Write` (or `Edit`, `NotebookEdit`), when it writes `<dataDir>/config/agents/wright.json`, `<dataDir>/studio.db` (or `-wal`/`-shm`, `studio.lock`, `studio.lock.pid`), `<dataDir>/api.json` or anything under `<dataDir>/app/`, then the call is denied with reason `protected_kernel_path` and no approval is created; a Bash command (allowed by prefix) that names such a path is denied the same way.
- [ ] Given a session whose policy allows `Bash` prefix `gh`, when it runs `gh pr merge 12` (any `gh pr merge …` form), then it is denied outright with reason `merge_blocked` and no approval is created.
- [ ] Given the other members of the fixed outward set — `gh pr create|comment|review|edit|close`, `gh issue create|comment|edit|close`, `gh api` with a non-GET method (`-X`/`--method` other than GET, or any `-f`/`-F`/`--field`/`--raw-field`/`--input` which implies POST), and Write/Edit/NotebookEdit (or a Bash command naming the path) to anything under `~/.claude/`, any `settings*.json`, or a hooks file/dir — then each is held as a pending approval when the policy allows it; a call the policy denies is denied as before (the set never widens the policy); `gh pr view`, `gh api` GET and `git status` are not held.
- [ ] Given a session whose `agent` is null, then `requesting_agent` is stored as `unknown` (migration 11: `NOT NULL`) and its grant matches only calls from that same `requesting_session` (never another null-agent session's call); for a named agent a grant matches (agent, tool, exact payload).
- [ ] Given `kernel_approval_request(action, payload, idempotency_key)`, then it returns at once `{ id, status: "pending", ... }` with a message telling the agent the decision arrives as a new message and to end its turn; called twice with the same key in one session, one approval exists.
- [ ] Given a payload containing terminal escape sequences (ESC, C1, DEL, newlines), when `studio approvals` prints it, then every control character is shown escaped (`\xNN`), never interpreted; `--json` prints valid JSON.
- [ ] Given `studio approvals [--all] [--json]`, then it lists pending approvals first (id, agent, session, time, action, exact payload pretty-printed as data), `--all` includes decided ones, via `GET /approvals` (bearer token).
- [ ] Given the shipped kernel, then the feature-seam tests list exactly the approvals contribution's tool (`kernel_approval_request`), routes, and subcommands (`approvals`, `approve`, `deny`) as additions; the AC3 assertions in `kernel/test/feature-seams.test.ts` are updated to name them (never deleted).
- [ ] `docs/architecture/approvals.md` documents the request tool, the fixed outward set and exactly which command forms the matcher recognises (and that `env git push`, aliases, scripts or an allowed program that runs others are NOT recognised — allowing such a program grants what it can run), the protected-path deny set, decisions, delivery, one-shot exact-payload grants, and that `always` is refused in phase 2.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | TypeScript kernel, better-sqlite3 store, zod tools, existing contribution seam (tools, routes with `store`/`now`, subcommands) |
| 2 | Dependency Availability | GO | No new dependency; `approvals` table exists (migration 11); `recordNotification`, `enqueueEvent`, `runStep`, `appendEvent` exist |
| 3 | Architecture Fit | CAUTION | The rail is `SessionManager#gate` in `kernel/src/sessions/manager.ts`, not in the declared Touches; `policy.ts` is pure (no I/O) so the store writes must be wired in `manager.ts` |
| 4 | Scope vs Supervisor Capability | GO | One feature directory plus a pure classifier and one gate call site; single subtask |
| 5 | Hard Blockers | GO | None |

**Overall Verdict:** CAUTION

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| approvals feature | `kernel/src/approvals/index.ts` | `kernel/src/approvals/store.ts`, `kernel/src/approvals/tool.ts`, `kernel/src/approvals/routes.ts`, `kernel/src/approvals/cli.ts` | HIGH |
| rail | `kernel/src/sessions/policy.ts` (pure classifier: outward set, merge block, protected paths), `kernel/src/sessions/manager.ts` (`#gate`: hold → `requestApproval`, consume a one-shot grant, `protected_kernel_path` / `merge_blocked` denies) | — | HIGH |
| tests | `kernel/test/sessions-policy.test.ts`, `kernel/test/feature-seams.test.ts`, `kernel/test/triggers.test.ts` (line 149: the shipped-contributions usage string `${USAGE} | ${NOTIFICATIONS_HELP} | ${TRIGGERS_HELP}` gains the approvals help after `TRIGGERS_HELP`) | `kernel/test/approvals.test.ts` | HIGH |
| docs | `docs/architecture/approvals.md`, `docs/ARCHITECTURE.md` (line 63 `kernel_approval_request(action, payload)`: "blocks until the user decides" → returns at once with `pending`, decision arrives as a message; line 131 "so far the Loomwright tool, the notifications feature, and triggers' …" → add the approvals tool, routes and subcommands) | — | MEDIUM |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` checks relative links in `docs/` resolve — any link added in the doc page must resolve.

## Touched-file invariants
Stamped against base commit 5b0b60b101a151ba8e441609d86b438c0956ad2d.

- `kernel/src/sessions/policy.ts`
  - "The kernel's tool decision. Pure: no I/O. Deny by default." — the new classifier stays pure (no store, no fs except what `protected-paths.ts`-style pure path math needs; take `dataDir` and `homeDir` as arguments). The store writes happen in `manager.ts`.
  - `const SHELL_METACHARACTERS = /[;&|<>()$\`\n\r]/;` and the prefix rule `command === prefix || command.startsWith(\`${prefix} \`)` — unchanged; the outward/protected classification applies only AFTER `decideToolUse` allowed the call (the set never widens a policy).
  - `export type ToolDecisionReason =` — closed union; add the new reasons (`approval_required`, `approval_granted`, `protected_kernel_path`, `merge_blocked`) here.
  - "`toolInput` is untrusted data from the model" (first line of the doc comment) — keep: inspected, never executed or interpolated.
- `kernel/src/sessions/manager.ts`
  - `#gate(live: LiveSession): HookCallback {` — "fails closed: any exception (including failing to record an allow) denies with `kernel_gate_error`". A failure to create the approval row, or to consume a grant, must deny (never allow).
  - `// No tool runs without a recorded kernel decision.` — each decision (held, granted, protected, merge-blocked) still records exactly one `tool_decision` event.
  - `hooks: { PreToolUse: [{ hooks: [this.#gate(live)] }] },` — the one wiring point; no second hook.
  - `this.#store.dataDir` and `this.#homeDir` (line 492/533) are the inputs for the protected-path and `~/.claude/` checks.
- `kernel/src/approvals/index.ts`
  - `export const approvalsContribution: FeatureContribution = Object.freeze({ name: "approvals" });` — keep the export name and `name: "approvals"`.
  - "The `studio` CLI loads it, so it imports only types and zod: never the Agent SDK." — every file under `kernel/src/approvals/` follows it; pinned by `kernel/test/feature-seams.test.ts` module-graph test.
- `kernel/test/feature-seams.test.ts`
  - "the shipped contributions: the five features in a fixed order, registering nothing but loomwright's one tool, the notifications parts and the triggers parts (AC3)" — extend the expected tool/route/subcommand lists with the approvals parts; keep `contributors` order `["loomwright", "notifications", "triggers", "approvals", "brain"]`.
  - "the shipped kernel (AC3)" — `shippedTools`, routes and `subcommands` lists extended the same way; never delete the assertions.
  - Lines 100-105, the `keys` map (`notifications: ["name", "tools", "routes", "subcommands", "dueWork"],`) — add an `approvals:` entry with exactly the approvals contribution's keys (e.g. `["name", "tools", "routes", "subcommands"]`); the `?? ["name"]` fallback otherwise fails.
  - Line 486-487, the literal shipped usage string `` `${USAGE} | studio notifications [--limit N] [--json] | … | studio triggers on|off <id> [--yes]\n` `` — append the approvals help text.
  - Lines 511-519, the `composed()` (= `[...SHIPPED_CONTRIBUTIONS, probe]`) launched-tools list ending `"kernel_trigger_list", "kernel_probe_echo"` — insert `"kernel_approval_request"` after `"kernel_trigger_list"` (merge order); never delete. Also update the AC3 test title (line 444) and comments (lines 476/483) that say "beyond phase 1's but the notifications and triggers ones" to name approvals.
  - Line 780, `expect(kernel.contributions.subcommands.map((s) => s.name)).toEqual(["notifications", "triggers", "probe"]);` — becomes `["notifications", "triggers", "approvals", "approve", "deny", "probe"]` (or the actual merge order); never deleted.
- `kernel/test/cli.test.ts` — NOT touched: its `cli()` helper passes `contributions: []` (line 85), so line 616 `expect(c.stderr.text()).toBe(\`${USAGE}\n\`);` prints phase 1's usage whatever ships and must stay unchanged.
- `kernel/test/triggers.test.ts`
  - `expect(stderr.join("")).toBe(\`${USAGE} | ${NOTIFICATIONS_HELP} | ${TRIGGERS_HELP}\n\`);` (line 149, `runCli` with no `contributions` override ⇒ `SHIPPED_CONTRIBUTIONS`, `kernel/src/cli/index.ts:386`) — extend with the approvals help after `TRIGGERS_HELP`; never delete.
- Audit rows: `appendEvent(store, kind, ref, payload, at)` in `kernel/src/loop/internal.ts` and `clip()` for free text — reuse, never a hand-written `INSERT INTO events`.
- Queue: `enqueueEvent(store, { kind: "message", payload, sourceRef })` in `kernel/src/loop/queue.ts` — use `sourceRef: "approval:<id>"` so a retried decision never queues twice.
- Idempotent tool: `runStep(ctx.store, ctx.stepKey(args.idempotency_key), fn, { now: ctx.now })` exactly as `kernel/src/notifications/tool.ts` `notifyTool` does.
- Notification: `recordNotification(store, { source: "kernel:approval", title, body, sessionId }, now)` from `kernel/src/notifications/record.ts`.

## Closed enumerations touched
- `ToolDecisionReason` (`kernel/src/sessions/policy.ts`; the new pure classifier is exported as `classifyToolCall(toolName, toolInput, { dataDir, homeDir })`) gains `approval_required`, `approval_granted`, `protected_kernel_path`, `merge_blocked`. Sibling search: `grep -rn "bash_prefix_not_allowed" kernel/src kernel/test docs` → `kernel/src/sessions/policy.ts` (definition + use), `kernel/test/sessions-policy.test.ts` (assertions) and `kernel/test/sessions.test.ts:760-761` (a gate decision case table, not exhaustive); no closed list elsewhere must list every reason.
- New audit `events.kind` values: `approval_requested`, `approval_decided`, `approval_used`. Sibling search: `grep -rn "notification_created" kernel/src` → `kernel/src/notifications/record.ts` only (writer); `appendEvent` takes any string; no closed list must carry them.
- `approvals.status` / `approvals.decision` value sets (`pending|approved|denied`, `once|always|deny`) are unchanged and validated in code (migration 11: "every value set below is closed in code"); `always` is never written in phase 2. A grant's one use is recorded by an `approval_used` audit event in the same transaction as the allow (no new column, no new migration).

## Pin mutations
- Outward hold: making the gate allow `git push origin main` (dropping the outward classification) must turn the hold test red.
- One-shot: not recording `approval_used` (or not checking it) so a second identical push runs must turn the "second push is held again" test red.
- Exact match: matching on prefix or on the action only (not the exact payload) must turn the `git push --force` test red; matching without the agent must turn the cross-agent test red.
- `always` refusal: writing `approved`/`always` must turn the refusal test red.
- Protected path: allowing a Write to `<dataDir>/config/agents/wright.json`, or creating an approval for it instead of denying, must turn the `protected_kernel_path` test red.
- Merge block: removing the `gh pr merge` rule (with a `gh` prefix allowed) must turn the `merge_blocked` test red.
- Fail closed: an approval-row write that throws must yield `deny` / `kernel_gate_error`, never `allow`.
- Escapes: printing the payload without escaping C0/C1/DEL must turn the escape test red.
- Idempotency: dropping `ctx.stepKey(idempotency_key)` from the tool's step key must turn the duplicate-key test red.
- Null-agent grants: matching a null-agent session's grant on the placeholder `unknown` alone (ignoring `requesting_session`) must turn the null-agent cross-session test red.
- Seam lists: removing the approvals tool, a route or a subcommand from `approvalsContribution` must turn the AC3 tests red.

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Approvals feature + PreToolUse rail (outward set, merge block, protected paths) + CLI + docs | all | 8 modify, 5 create | unit-testing, error-handling | LAUNCHABLE |

## Parallelism Analysis
single-agent (no fan-out)

- **Recommended workers:** 1
- **Estimated batches:** 1

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/approvals/store.ts"}
  - {kind: "file", path: "kernel/src/approvals/tool.ts"}
  - {kind: "symbol", path: "kernel/src/approvals/tool.ts", name: "approvalRequestTool"}
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "requestApproval"}
  - {kind: "file", path: "kernel/src/approvals/routes.ts"}
  - {kind: "file", path: "kernel/src/approvals/cli.ts"}
  - {kind: "symbol", path: "kernel/src/approvals/index.ts", name: "approvalsContribution"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "classifyToolCall"}
  - {kind: "symbol", path: "kernel/src/approvals/routes.ts", name: "approvalRoutes"}
  - {kind: "file", path: "kernel/test/approvals.test.ts"}
  - {kind: "file", path: "docs/architecture/approvals.md"}
requires: []
lanes:
  - "kernel/src/approvals/**"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/triggers.test.ts"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
external_requires: []
```

## Skill References
- `skills/unit-testing/SKILL.md` (vitest; drive the gate through `SessionManager` with the existing session fakes in `kernel/test/session-fakes.ts`)
- `skills/error-handling/SKILL.md` (fail closed in the gate; clear CLI errors on non-pending ids)

## Risk Assessment
| Risk | Impact | Mitigation |
|------|--------|------------|
| The rail lives in `kernel/src/sessions/manager.ts`, outside the requirement's declared Touches | MEDIUM | Feasibility (Phase 2.5). Keep the manager change to the `#gate` call site plus a thin call into `approvals/store.ts`; all classification stays pure in `policy.ts` |
| A command reaching the outward set by a route the matcher misses (`env git push`, an alias, a script, an allowed program that runs others) | HIGH | Requirement risk. Recognise only the documented argv forms (first tokens after splitting on whitespace); the doc page lists them and states plainly that allowing a program which runs others grants what it can run (ARCHITECTURE "Safety kernel") |
| Stale premise: "`gh pr merge` blocked as in phase 1" — phase 1 has no merge block | MEDIUM | Cited-line premise (Phase 3). Add the outright `merge_blocked` deny now, independent of the policy prefix |
| A gate exception or store failure allowing an outward call | HIGH | Every write sits in the existing fail-closed `try`; any throw is `deny` / `kernel_gate_error` (pinned) |
| Grant consumed twice under a race (two identical calls in flight) | MEDIUM | Check-and-consume in ONE `store.transaction`; the gate is per call and the store is single-writer |
| Payload shown to the owner carrying terminal control sequences | HIGH | Reuse the notifications CLI escape (C0/C1/DEL → `\xNN`); payload printed as data, never interpolated |
| Prior churn on `kernel/src/sessions/manager.ts` (8 postmortem entries, classes self_heal_churn / drain_churn) | MEDIUM | Prior churn (postmortem ledger). Reviewers watch the gate's fail-closed path and the one-`tool_decision`-per-call rule |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-15-approval-gate-from-the-cli.md

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-15T04:00:21Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/52
- **Branch:** feature/phase-2-approval-gate-from-the-cli
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 3 (iteration-3 HIGH + 2 MEDIUM, fixed in 5adab7c but not re-reviewed)
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Approvals feature (kernel_approval_request, /approvals routes, studio approvals/approve/deny, one-shot exact-payload grants scoped to agent/session and cwd) plus a pure classifyToolCall rail in the fail-closed PreToolUse gate (protected_kernel_path, merge_blocked, outward holds). Phase 4.5 reproduced and closed rail bypasses over three iterations (argv shapes, shell expansion, pflag/cobra parsing, aliases, autocorrect, in-word paths, empty words, Unicode whitespace, cost bound); the final fix was not re-reviewed. risk_classification: high_risk (auth/token/migration content, 2797 changed lines). 1006 tests pass.

## Not verified
- **the live Agent SDK PreToolUse hook and the permissionDecisionReason text the model sees** — no real SDK session; driven only through the fake query/spawner (subtask 1)
- **delivery of the queued decision message to the agent** — routing belongs to item 06 (brain), not built yet (subtask 1)
- **studio approvals/approve/deny against a running launchd daemon** — exercised only against an in-process API server (subtask 1)
