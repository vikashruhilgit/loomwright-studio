# Supervisor Job: "Always allow" scoped to one playbook version and one action, revocable by the owner

## Environment
- **Project:** loomwright-studio (lane clone L4)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092905-always-allow-scoped-to-one-playbook.md
- **Base commit:** a60340ca29d550cf1aa4e2ab127a19fdc4577d8b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + better-sqlite3 + vitest, same as the existing `kernel/src/approvals/` feature. |
| 2 | Dependency Availability | GO | Migration 13 (item 01, merged in PR #66) already adds `approvals.playbook`, `sessions.playbook`, `sessions.playbook_version` and `playbooks.version`; no new dependency. |
| 3 | Architecture Fit | GO | Grants stay in the approvals feature; the existing precedent records a grant's use as an audit event with "no new column, no new migration" (`store.ts` header). |
| 4 | Scope vs Supervisor Capability | GO | 6 files, one module + its test + its doc: single-agent. |
| 5 | Hard Blockers | CAUTION | Sibling lanes run in parallel: item 03 (dry run) owns `kernel/src/sessions/manager.ts` / `types.ts`. This brief must not touch them, so the dry-run exclusion is item 03's gate (a dry-run session never reaches `holdOrUseGrant`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Let the owner answer a rail-held approval that came from a playbook session with `always`, storing a standing grant scoped to (playbook, playbook version, action, exact canonical payload, requesting agent) that later matching calls from the same playbook version use without a new approval, that never covers `kernel_playbook_enable`, and that the owner can list and revoke.

**Problem Statement:**
The owner needs a routine playbook to stop asking about the same action, because every one-shot grant is consumed once and asks again.
Currently, `studio approve <id> always` is refused with `409 always_not_supported` for every approval (`ALWAYS_REFUSED` in `kernel/src/approvals/store.ts`). This makes playbooks impractical.
Success looks like: an `always` answer on a playbook approval stores a grant that only that playbook version uses; every chat session, other playbook, or newer version still asks; the owner can list and revoke grants.

## Design (binding for the worker)

- **No new migration, no change outside the Touches.** `kernel/src/sessions/**`, `kernel/src/playbooks/**` and migrations are owned by sibling items and must not be edited. `RailOutcome` keeps its shape (`{kind: "granted" | "held", id}`), so `sessions/manager.ts` stays unchanged.
- **Recording the playbook (scope 1).** `requestApproval` reads the requesting session's row (`SELECT playbook, playbook_version FROM sessions WHERE id = ?`). When `playbook` is non-null it writes `approvals.playbook` and adds `playbook` and `playbook_version` keys to the `approval_requested` event payload. A session with no playbook writes exactly what it writes today (the event payload stays `{id, action, source, agent}`), so every existing assertion holds.
- **The standing grant IS the approval row:** `status: approved`, `decision: always`, with the version taken from its `approval_requested` event. Grant id = approval id. No separate store.
- **`always` accepted only when (scope 2, 4).** Order of checks, matching `once`: an unknown id is `no_such_approval` (404) and a decided one is `approval_not_pending` (409) FIRST; `always_not_supported` (409) is only for a pending approval that fails one of these conditions: the approval is pending; it came from the rail (`approval_requested.source = "rail"`); `approvals.playbook` is non-null and its `approval_requested` event carries a non-null `playbook_version`; the requesting session ran a named agent (`sessions.agent` non-null and non-empty for `requesting_session` — an agent-less approval is refused, so a grant always belongs to a named agent); and the payload's `tool` is not in `ALWAYS_HELD_TOOLS` (import from `../sessions/policy.js`, which imports only `node:path`, `../protected-paths.js` and a type-only `./types.js`, so the CLI-loaded module still never loads the Agent SDK). Every other `always` is refused `always_not_supported` with a message that says why (no playbook: "always needs a playbook: …"; an always-held tool; an agent-requested `kernel_approval_request` approval), writing nothing. The `ALWAYS_REFUSED` constant is replaced by a message saying "always" needs an approval held from a playbook session; the per-reason refusal text is `err.message`. `routes.ts` returns `message: err.message` for `always_not_supported` (not the constant), and `cli.ts` prints the API's `message` through `shown(` (falling back to `ALWAYS_REFUSED` when the body has none).
- **Matching (scope 3, 5).** In `holdOrUseGrant`, after the existing one-shot lookup finds nothing (that path is byte-unchanged), look up a standing grant: `status = 'approved' AND decision = 'always'`, same `action`, same canonical `payload_json`, the SAME requester rule as the one-shot `requester` SQL for a named agent — `a.requesting_agent = <the calling session's agent name> AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = a.requesting_session AND s.agent = <that name>)` — and never for a calling session with no agent (an agent named `unknown` never matches a grant from a different agent or from an agent-less session — none can exist, since agent-less `always` is refused), `a.playbook` = the calling session's `sessions.playbook`, the grant's recorded `playbook_version` = the calling session's `sessions.playbook_version` AND = the playbook's current `playbooks.version`, source `rail`, and no `approval_grant_revoked` event for it; and never when `call.tool` is in `ALWAYS_HELD_TOOLS`. A session whose `playbook` or `playbook_version` is null (every chat session) never matches. A match writes one `approval_grant_used` event `{id, tool}` (linked to the session) and returns `{kind: "granted", id}`; the grant is not consumed.
- **Revoke and list (scope 5).** `revokeGrant(store, {id, by}, now)` writes one `approval_grant_revoked` event `{id, by}`; refusals write nothing: `no_such_grant` (no approval with that id that is approved/always) and `grant_revoked` (already revoked). `listGrants(store)` returns every non-revoked grant: `{id, playbook: {id, slug, version}, action, payload, requesting_agent, granted_at, current}` where `current` is whether the grant's version equals the playbook's current version.
- **API:** `GET /approvals/grants` → `{grants: [...]}`; `POST /approvals/grants/:id/revoke` → `200 {grant}` / `404 no_such_grant` / `409 grant_revoked` / `400 invalid_id`. `POST /approvals/:id/approve` accepts `{decision: "always"}` per the rule above.
- **CLI:** `studio approvals grants [--json]`, `studio approvals revoke <grant id>` (both as arguments of the existing `approvals` subcommand; `APPROVALS_HELP` becomes exactly `studio approvals [--all] [--json] | grants [--json] | revoke <grant id>` — under 200 characters, one line — and the help/usage pins in the test change with it), `studio approve <id> always` (success line names the playbook slug and version). `studio approvals` shows `from playbook <slug> v<n>` for an approval that has a playbook. To carry it, `ApprovalView` (and so `GET /approvals` and the approve response) gains `playbook: {id, slug, version} | null`, joined from `playbooks` (slug) and the approval's `approval_requested` event (`playbook_version`); `null` for an approval with no playbook. All text from the store goes through the existing `shown` / `payloadText` escaping.
- **Dry run:** a dry-run session (item 03) is denied by its own gate before the rail, so it never reaches `holdOrUseGrant`; this brief adds no dry-run code. The doc says so.

## Acceptance Criteria
- [ ] Given a held `gh pr comment` from a playbook session (session row `playbook` P, `playbook_version` 2, playbook P at version 2), when the owner approves it `always`, then the API answers 200, the approval reads `approved`/`always`, and a second matching call from another session of the same playbook version runs (`approval_granted`) with one `approval_grant_used` event and no new approval row.
- [ ] Given that grant, when a chat session (no playbook) or a session of another playbook makes the same call, then it is held as a new pending approval.
- [ ] Given an approval with no playbook, when the owner answers `always`, then the API returns 409 `always_not_supported`, the CLI exits 1 with that message, and the approval stays `pending` with nothing written.
- [ ] Given a grant on v2, when the playbook's `playbooks.version` becomes 3 and a v3 session makes the matching call, then it is held again.
- [ ] Given a grant, when the owner runs `studio approvals revoke <id>`, then `studio approvals grants` no longer lists it and the next matching call is held.
- [ ] Given a playbook session calling `mcp__kernel__kernel_playbook_enable`, when standing grants exist (including one whose payload equals that call's), then the call is still held, and `always` on a held `kernel_playbook_enable` approval is refused 409 `always_not_supported`.
- [ ] Given a session with a playbook, when the rail holds its call, then the approval row's `playbook` is set and `studio approvals` shows `from playbook <slug> v<n>`.
- [ ] Given a grant on v2, when a v2 session of the same playbook makes the same call with a different `cwd`, a different command, or from a different agent (including an agent literally named `unknown`), then each call is held as a new pending approval and no `approval_grant_used` event is written.
- [ ] Given no grant with id N, when the owner revokes N, then the API answers `404 no_such_grant`; given a revoked grant, when the owner revokes it again, then `409 grant_revoked`; a non-numeric id answers `400 invalid_id`; none of them writes an event.
- [ ] Given a held rail approval from a playbook session with no agent (`sessions.agent` null), when the owner answers `always`, then the API answers `409 always_not_supported`, the approval stays `pending`, and nothing is written.
- [ ] Given an unknown approval id, when the owner answers `always`, then `404 no_such_approval`; given an already-decided approval, then `409 approval_not_pending`.
- [ ] Given an approval an agent requested with `kernel_approval_request` (source `tool`) from a playbook session, when the owner answers `always`, then it is refused `409 always_not_supported` and stays `pending`.
- [ ] Given a grant on v2, when the playbook moves to v3, then `studio approvals grants --json` lists it with `current: false`.
- [ ] Given the suite, when `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` run, then both pass, with the new tests in `kernel/test/approvals.test.ts` and `docs/architecture/approvals.md` describing the standing-grant rules, the new routes, CLI, refusals and audit events in place of the phase 2 "always" refusal text.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| approvals | `kernel/src/approvals/store.ts`, `kernel/src/approvals/routes.ts`, `kernel/src/approvals/cli.ts`, `kernel/src/approvals/index.ts` | — | HIGH |
| tests | `kernel/test/approvals.test.ts` | — | HIGH |
| docs | `docs/architecture/approvals.md` | — | HIGH |

## Touched-file invariants

> Grounded at base `a60340ca29d550cf1aa4e2ab127a19fdc4577d8b`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/approvals/store.ts`** — keep: the CLI-safe import rule (`modules that never load the Agent SDK`); the one-transaction writes (`return store.transaction(() => {`); exact canonical matching through `canonicalJson` (never a looser match — requirement risk); the one-shot lookup `a.status = 'approved' AND a.decision = 'once'` unchanged; refusals write nothing (`A refusal: nothing was written.`). reuse: `appendEvent`, `canonicalJson`, `getApproval`, `namedAgent`/`agentOf`. mirror: `RailOutcome` shape consumed by `kernel/src/sessions/manager.ts` (`const o = holdOrUseGrant(this.#store, call, this.#now());` and `o.kind === "granted"`). pinned by: `kernel/test/approvals.test.ts` (`payload: { id: 1, tool: "Bash" }` — keep); changes to: `expect(ALWAYS_REFUSED).toBe(` (the new message) and the always-refused test `studio approve <id> always is refused` (rewritten for the no-playbook case).
- **`kernel/src/approvals/routes.ts`** — keep: `const ID = /^[1-9]\d{0,15}$/;` id parsing, refusals as `400 invalid_id` / `invalid_body`; no new route may overlap an existing one with the same method (contribution merge rejects overlaps: `routePathsOverlap`). mirror: `approvalRoutes` is merged through `SHIPPED_CONTRIBUTIONS`. changes to: the contribution test's route list and `expect(approvalRoutes).toHaveLength(3)` (becomes 5: `GET /approvals/grants`, `POST /approvals/grants/:id/revoke` added).
- **`kernel/src/approvals/cli.ts`** — keep: every stored string shown through `shown(` / `payloadText(`; usage errors exit 2, refusals exit 1; `This module never imports \`../cli/index.js\``. changes to: the help pins in `kernel/test/approvals.test.ts` (`["approvals", "studio approvals [--all] [--json]"]` and the `[APPROVALS_HELP, APPROVE_HELP, DENY_HELP]` equality) for the new `APPROVALS_HELP`; keep: `[["approvals", "pending"], APPROVALS_HELP]` (an unknown argument still prints usage, exit 2).
- **`kernel/src/approvals/index.ts`** — keep: the frozen `approvalsContribution` and the re-export list (`} from "./store.js";`); new public functions (`revokeGrant`, `listGrants`, the grant view type) are re-exported there; the header comment's import list (`its modules import only each other, the feature seam`) is extended to name `sessions/policy.ts` (`ALWAYS_HELD_TOOLS`).
- **`kernel/test/approvals.test.ts`** — keep: tests drive the rail through the real `SessionManager` gate over `session-fakes.ts` (`never the real SDK, a model, a real process or the`); a test may set `sessions.playbook` / `playbook_version` directly on the row (requirement assumption), and insert `playbooks` rows directly.
- **`docs/architecture/approvals.md`** — keep: relative links resolve (`scripts/check-docs.sh` check 1).

## Closed enumerations touched

> Sibling grep at base `a60340ca29d550cf1aa4e2ab127a19fdc4577d8b`: `grep -rnF 'always_not_supported' --exclude=CHANGELOG.md .` → 9 hits in 5 files; `grep -rnF 'approval_used' .` → 12 hits in 4 files.

- **`no_such_grant`, `grant_revoked`** (sibling: `always_not_supported`) — must be named in:
  - `kernel/src/approvals/store.ts` — the `ApprovalError` code union `readonly code: "no_such_approval" | "approval_not_pending" | "always_not_supported" | "invalid_approval"` — extend.
  - `kernel/src/approvals/routes.ts` — the error → status mapping (`if (err.code === "always_not_supported")`) — extend for the revoke route.
  - `kernel/src/approvals/cli.ts` — the 409 branch (`error === "always_not_supported"`) — extend for revoke messages.
  - `docs/architecture/approvals.md` — the refusals list — extend.
  - `kernel/test/approvals.test.ts` — assertions — extend with new tests.
- **`approval_grant_used`, `approval_grant_revoked`** (sibling: `approval_used`) — must be named in:
  - `kernel/src/approvals/store.ts` — `export const APPROVAL_AUDIT_KINDS = ["approval_requested", "approval_decided", "approval_used"] as const;` — extend.
  - `docs/architecture/approvals.md` — the `## Audit events` table — extend.
  - `kernel/src/approvals/index.ts` — re-exports `APPROVAL_AUDIT_KINDS` — no change: it re-exports the list, not its members.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/approvals.test.ts` — always on a playbook approval, second matching call granted | delete the line in `kernel/src/approvals/store.ts` that appends the `approval_grant_used` event |
| `kernel/test/approvals.test.ts` — grant on v2 is held for a v3 session | flip the standing-grant SQL's `playbooks.version` comparison to always true in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — revoked grant no longer matches | delete the `approval_grant_revoked` NOT EXISTS clause in the standing-grant lookup in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — kernel_playbook_enable still held with a grant | delete the `ALWAYS_HELD_TOOLS` guard in the standing-grant lookup in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — always on an approval with no playbook is 409 | delete the no-playbook refusal in `decideApproval` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — chat session / other playbook held (AC2) | delete the `a.playbook = ` session-playbook clause in the standing-grant lookup in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — different cwd / command held | delete the `payload_json` equality in the standing-grant lookup in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — different agent held | delete the `a.requesting_agent = ?` clause in the standing-grant lookup in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — always on an agent-less playbook approval is 409 | delete the agent-less refusal in `decideApproval` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — always on an unknown / decided id keeps its code | move the `always_not_supported` checks before the `no_such_approval` lookup in `decideApproval` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — approval row records `playbook`, list shows `from playbook <slug> v<n>` (AC7) | delete the write of `approvals.playbook` in `requestApproval` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — revoke twice is `409 grant_revoked` | delete the already-revoked check in `revokeGrant` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — revoke unknown id is `404 no_such_grant` | delete the not-a-grant check in `revokeGrant` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — always on a `source: "tool"` approval is 409 | delete the rail-source check in `decideApproval` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — grants list `current: false` after v3 | flip the `current` computation to `true` in `listGrants` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals.test.ts` — `expect(ALWAYS_REFUSED).toBe(` (changed pin, new message) | flip the `ALWAYS_REFUSED` text in `kernel/src/approvals/store.ts` back to the phase 2 message |
| `kernel/test/approvals.test.ts` — `expect(approvalRoutes).toHaveLength(` (changed pin, 5 routes) | delete the `GET /approvals/grants` route in `kernel/src/approvals/routes.ts` |
| `kernel/test/approvals.test.ts` — help pin for the new `APPROVALS_HELP` (changed pin) | flip `APPROVALS_HELP` back to `studio approvals [--all] [--json]` in `kernel/src/approvals/cli.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Per-playbook standing grants: decide, match, list, revoke, CLI, doc, tests | all | 6 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "revokeGrant"}
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "listGrants"}
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "approval_grant_used"}
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "approval_grant_revoked"}
  - {kind: "symbol", path: "kernel/src/approvals/routes.ts", name: "/approvals/grants/:id/revoke"}
  - {kind: "symbol", path: "kernel/src/approvals/cli.ts", name: "revoke <grant id>"}
  - {kind: "symbol", path: "docs/architecture/approvals.md", name: "approval_grant_used"}
requires: []
lanes:
  - "kernel/src/approvals/store.ts"
  - "kernel/src/approvals/routes.ts"
  - "kernel/src/approvals/cli.ts"
  - "kernel/src/approvals/index.ts"
  - "kernel/test/approvals.test.ts"
  - "docs/architecture/approvals.md"
external_requires: []
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
| Feasibility (Phase 2.5): sibling lanes (item 03 dry run, item 02 drafts) edit `sessions/` and `playbooks/` in parallel | MEDIUM | Touch only the six lane files; keep `RailOutcome` and the `holdOrUseGrant` signature unchanged so `manager.ts` needs no edit. |
| A looser match lets a grant cover a different call | HIGH | Reuse the exact `canonicalJson` payload equality of one-shot grants, plus action, agent, playbook and version equality; tests cover a different cwd/payload being held. |
| A grant outlives an edit | HIGH | Match only when the grant's recorded version equals both the session's and the playbook's current version. |
| `always` covers `kernel_playbook_enable` | HIGH | Refuse `always` on an always-held tool AND exclude always-held tools at match time (two guards, both tested). |
| Changing `approval_requested`'s payload breaks existing assertions | MEDIUM | Add the `playbook` / `playbook_version` keys only when the session has a playbook. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-16-always-allow-scoped-to-one-playbook.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-16T10:52:42Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/70
- **Branch:** feature/always-allow-per-playbook
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Standing "always" grants per playbook version/action/payload/agent with list + revoke; Phase 4.5 fixed a doc overstatement (iter 1) and closed decide-time vs match-time gaps for stale versions and agent mismatch (iter 2); iter 3 review clean.

## Not verified
- **installed studio CLI against a running kernel daemon** — exercised only via runCli and startApiServer in vitest (subtask 1)
- **hook reason text in kernel/src/sessions/manager.ts (offers only studio approve <id> once)** — out of lane (sessions/** owned by item 03); unchanged (subtask 1)
