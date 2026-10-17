# Supervisor Job: The kernel applies an approved kernel action itself, and tells the agent what it did

## Environment
- **Project:** loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-17-164900-the-kernel-applies-an-approved-kernel-action-itself.md
- **Base commit:** 19ce285

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest. Every change is in existing modules (`approvals/`, `playbooks/enable.ts`, the feature seam, the API's route request). |
| 2 | Dependency Availability | GO | No new dependency, no migration. The apply result rides on the `approval_decided` event payload and the kernel's grant use on an `approval_used` event, the same no-new-column convention `approvals/store.ts` already follows. |
| 3 | Architecture Fit | CAUTION | The decision runs in the approvals route (`decideApproval`, `approvals/routes.ts`), which has only `req.store` / `req.now` and must not import playbooks (requirement Risks). A small seam is needed to hand it a registered applier (Design 1). |
| 4 | Scope vs Supervisor Capability | GO | About 17 files. One subtask: the seam, the applier and its single consumer (the decision) must land together, and none of the three split reasons applies. |
| 5 | Hard Blockers | GO | None. |

**Overall Verdict:** CAUTION (finding 3 is resolved by Design 1; it feeds the Risk Assessment)

## Task
**Goal:** When the owner approves `once` a held `kernel_playbook_enable`, the kernel itself re-validates and enables the playbook in the decision's transaction, records the grant as used by the kernel, and queues a message to the agent that states what the kernel did. Held actions that are not kernel tools keep the agent's retry, and their message now names the exact tool and input to repeat once.

**Problem Statement:**
Live run 2026-10-17 (`docs/evidence/phase-3-exit-live-2026-10-17.json`, step 4): the owner approved the enable once; the queued message `approved approval 1: kernel_playbook_enable` named only the approval; Wright's new session made no tool call and falsely replied that the playbook was enabled. Completing an approved state change depended on a model repeating a call it could not see: the LLM owning a transition the kernel should own (invariant 2). Owner decision 2026-10-17 (in the requirement): for a held action that is a kernel tool with a kernel-side effect (phase 3: `kernel_playbook_enable` only, a closed set in code), the owner's `once` approval makes the kernel apply the held call itself. The owner's approval stays required (D3, invariant 3 unchanged).
Success: approving an enable enables it every time, with no agent call; a refused apply says why, on the approval and in the agent's message; the agent never has to infer whether something happened.

## Acceptance Criteria
- [ ] Given a held `kernel_playbook_enable` for v4 with a `done` dry run of v4, when the owner approves `once`, then in the decision's transaction the playbook is `enabled` at v4, one `playbook_enabled` event names the approval, one `approval_used` event `{id, tool, by: "kernel"}` records the grant as used, and no agent call is needed.
- [ ] Given the playbook was edited to v5 after the request, when the owner approves, then the approval is `approved`, nothing is enabled, the approval records `apply_refused: version_changed`, and the agent's message says the kernel did not enable it and why.
- [ ] Given the owner turned the playbook off after the request, when they approve, then nothing is enabled and the approval records `apply_refused: turned_off_by_owner`.
- [ ] Given an approved held `gh pr comment` (a rail approval whose tool is not in `KERNEL_APPLIED_ACTIONS`), when the message is queued, then it names the tool and its exact input and asks for one unchanged retry; the one-shot grant is not consumed by the decision and behaves as today.
- [ ] Given a deny, when it is decided, then nothing is applied, no grant is consumed, and the message says it was denied and nothing was done.
- [ ] Given a kernel-applied approval, when the owner runs `studio approve <id> once`, then it prints what the kernel applied, or `not applied: <reason>: <detail>`, and exits 0.
- [ ] Given a stand-in Wright that makes no retry, when `kernel/test/phase-3-exit.test.ts` runs, then steps 4 and 9 enable on the approval itself and the test passes; given the live harness, when the owner approves in step 4, then `kernel/test/phase-3-exit-live.test.ts` and `docs/evidence/phase-3-exit-runbook.md` pass when `playbook_enabled` names the approval before the first minute, with Wright's reply recorded, not required.
- [ ] Given the change, when `bash scripts/check-docs.sh` runs, then it passes, and `docs/architecture/approvals.md`, `docs/architecture/dry-run.md`, `docs/architecture/playbooks.md` describe kernel-applied actions and the message texts, and the `docs/OPEN_QUESTIONS.md` retry entry is answered.

### Design (binding for the worker)

1. **The applier seam (approvals never imports playbooks).**
   - **Closed set:** `export const KERNEL_APPLIED_ACTIONS = ["mcp__kernel__kernel_playbook_enable"] as const;` in `kernel/src/approvals/store.ts` (full SDK tool names: what a rail payload's `tool` holds). Export it from `approvals/index.ts`. Every member must also be in `ALWAYS_HELD_TOOLS` (`sessions/policy.ts`); a test pins that.
   - **Types, in `kernel/src/approvals/store.ts`:**
     ```ts
     /** The approval a kernel applier runs on. */
     export interface AppliedApproval { readonly id: number; readonly sessionId: number | null; readonly agent: string | null; readonly subjectVersion: number | null; readonly requestedEventId: number }
     /** `applied`: one sentence for the agent ("the kernel enabled …"); `after` runs once the decision committed (a throw is ignored). `refused`: a reason token and one sentence ("the kernel did not enable …: …"). */
     export type ApprovalApplyOutcome =
       | { readonly applied: string; readonly after?: () => void }
       | { readonly refused: string; readonly text: string };
     /** By full tool name: `undefined` when no applier is registered for that tool. Synchronous; runs inside the decision's transaction. */
     export type ApprovalApplier = (tool: string, input: unknown, approval: AppliedApproval, store: Store, now: Date) => ApprovalApplyOutcome | undefined;
     ```
   - **Tool side:** `ContributedTool` (`kernel/src/features/contribution.ts`) gains an optional `applyOnApproval?(args: z.infer<z.ZodObject<S>>, ctx: { store: Store; now: () => Date; approval: AppliedApproval }): ApprovalApplyOutcome`, documented beside `beforeHold`. Import the types type-only (`import type`), so `kernel/test/feature-seams.test.ts`'s module-graph pin stays green. `mergeContributions` throws `InvalidContributionError` when `applyOnApproval` is present but not a function (same line shape as the `beforeHold` check).
   - **Lookup:** `approvalApplierOf(contributed: readonly ContributedTool[]): ApprovalApplier` in `kernel/src/tools/server.ts`, beside `heldToolCheckOf`, keyed by `mcp__kernel__<name>`. At build time it throws `InvalidContributionError` for a tool that declares `applyOnApproval` but whose full name is not in `KERNEL_APPLIED_ACTIONS` (the closed set is enforced in code: a composition that breaks it never starts). The returned function: no applier for `tool` ⇒ `undefined`; else parse `input` with the tool's zod shape (failure ⇒ `{ refused: "invalid_input", text: "<tool>: the held input is not valid: …" }`), then call `applyOnApproval`.
   - **Transport to the route:** `ContributedRouteRequest` (`contribution.ts`) gains an optional `approvalApplier?: ApprovalApplier` (type-only import). `ApiServerOptions` (`kernel/src/api/server.ts`) gains an optional `approvalApplier`, passed on every contributed route request (the `match.route.handler({ params, query, body, store, now })` call). `kernel.ts` builds `approvalApplierOf(contributions.tools)` once and passes it to the API server. `approvals/routes.ts`'s `decide` passes `req.approvalApplier` to `decideApproval`. No other route reads it.

2. **`decideApproval(store, input, now, applier?)`** (`kernel/src/approvals/store.ts`). Unchanged: the validation, the refusals that write nothing (`no_such_approval`, `approval_not_pending`, `always_not_supported`, `invalid_approval`), the row update, `sourceRef: approval:<id>`. New, inside the same transaction:
   - **When it applies:** decision `once`, the approval's `approval_requested` event has `source: "rail"`, its payload's `tool` is in `KERNEL_APPLIED_ACTIONS`, and an `applier` was given. (`always` can never reach it: `alwaysRefusal` already refuses `ALWAYS_HELD_TOOLS`.) With no `applier` given (a composition without one, and the existing unit tests), the decision is exactly today's apart from the message text below, and the grant is left for the agent's retry.
   - **Running it:** `AppliedApproval` is built from the row and its `approval_requested` event (`subject_version` ⇒ `subjectVersion`, null when absent; that event's `id` ⇒ `requestedEventId`; `agent` ⇒ that event's `agent`, null when absent — never `approvals.requesting_agent`, which holds the literal `unknown` for a session with no agent). The applier runs in a NESTED `store.transaction` (a savepoint): a throw rolls back only its writes and becomes `{ refused: "apply_error", text: "the kernel could not apply it: <message, clipped to 300>" }`. `applier` returning `undefined` for a tool in the set ⇒ `{ refused: "no_applier", text: "the kernel has no applier for <tool>; nothing was done" }` (fail closed: a kernel-applied action is never handed back to the agent).
   - **The grant:** when it applies, whatever the outcome, append one `approval_used` event `{ id, tool, by: "kernel" }` linked to the requesting session, so the one-shot grant can never be spent by a later agent call. (A refused apply with the playbook still a draft: the agent's next same-input call is refused by `beforeHold` or held as a NEW approval, never let through on this one.)
   - **The record:** the `approval_decided` event payload gains `applied: <the sentence>` or `apply_refused: <reason token>` plus `apply_detail: <the sentence>`, only when it applied. No new column. `approvalView` exposes optional `applied?: string`, `apply_refused?: string`, `apply_detail?: string`, read from that event and present only when there (keys omitted otherwise, so every existing `toEqual` on an `ApprovalView` stays green).
   - **After commit:** when the outcome has `after`, call it once after the transaction returns, inside a try/catch that ignores a throw (the mirror rewrite; a mirror failure never fails a decision).
   - **The message** (`payload.text`; `agent`, `approval_id` and `sourceRef` unchanged):

     | Case | `text` |
     |---|---|
     | kernel-applied, applied | `approved approval <id>: <action>. <applied sentence> Nothing to repeat.` |
     | kernel-applied, refused | `approved approval <id>: <action>. <refused text> Do not repeat the call.` |
     | other approved rail approval (`once` or `always`) whose payload is an object with a string `tool` | `approved approval <id>: <action>. Repeat exactly this call once, unchanged: tool <tool>, input <canonicalJson(payload.input ?? null)>.` |
     | approved, `source: "tool"` (`kernel_approval_request`), or a rail payload with no string `tool` | `approved approval <id>: <action>` (today's text) |
     | deny | `denied approval <id>: <action>. Nothing was done; do not repeat the call.` |

     The input JSON is not cut here: `brain/context.ts` already cuts a message at `MAX_MESSAGE_CHARS` and states the cut. `approvals.md` names that limit.

3. **One enable function** (`kernel/src/playbooks/enable.ts`). Extract the checks and the enable from `enableOnApproval` into one exported function used by both paths:
   ```ts
   export class EnableRefused extends Error { readonly reason: "not_found" | "not_owner" | "turned_off_by_owner" | "not_draft" | "version_changed" | "no_dry_run"; … }
   export function enableApproved(store: Store, p: { playbookId: number; agent: string | null; approval: { id: number; requestedEventId: number; subjectVersion: unknown }; sessionId: number | null; now: Date }): EnableToolResult
   ```
   - **Check order:** playbook exists (`not_found`) → owning agent equals `p.agent` (`not_owner`; a null agent never matches) → `refuseIfOwnerTurnedOff` (`turned_off_by_owner`) → status is `draft` (`not_draft`) → `subjectVersion === row.version` (`version_changed`) → no `playbook_updated` after `requestedEventId` (`version_changed`) → a `done` dry run of the current version (`no_dry_run`) → `enablePlaybook({ id, version, sessionId, approvalId })`.
   - **The handler path** (`enableOnApproval`, the agent's retry) keeps `ownApproval`, `refuseStaleReplay` and its work step exactly, and calls `enableApproved` for the checks. It converts `EnableRefused` into the same `PlaybookError` messages it throws today ("version changed: …", the `ownDraft` refusals), so every existing pin in `kernel/test/playbooks-dry-run.test.ts` on the handler path stays green unchanged.
   - **The kernel path:** `applyOnApproval` on the enable tool: `enableApproved` with `p.agent = approval.agent`, `sessionId = approval.sessionId`, inside the decision's transaction. Applied ⇒ `{ applied: "The kernel enabled playbook <slug> (#<id>) at version <n> on approval <approval id>.", after: () => syncMirror(store, id) }`. `EnableRefused` ⇒ `{ refused: <reason>, text: "The kernel did not enable playbook <slug or #id> (#<id>): <reason> (<one-line detail>)." }`. Any other throw propagates (the decision turns it into `apply_error`).
   - `beforeHold` and the tool's `description` keep their behaviour; the description's sentence telling Wright to "run exactly the same call again, once" is replaced by: the owner's approval enables it (the kernel applies it and tells you what it did); do not repeat the call.
   - `playbook_enabled` keeps its payload `{ playbook_id, version, approval_id, by: "owner" }` (the owner approved it).

4. **`studio approve` output** (`kernel/src/approvals/cli.ts`, `decide`). After today's line, when the answered approval has `applied` print `studio: the kernel applied it: <applied>`; when it has `apply_refused` print `studio: not applied: <apply_refused>: <apply_detail>`. Both through the same escape as `field(…)` (untrusted text: playbook slugs). Exit code 0 in both cases (the decision itself succeeded). An approval without these fields prints byte-identically to today. `formatApprovals` (`studio approvals --all`) adds a `  applied: …` / `  not applied: …` line after `decided:` only when present.

5. **Exit checks follow the new path.**
   - `kernel/test/phase-3-exit.test.ts`: steps 4 and 9 drop the `retryEnable` driver. After `studio approve <id> once`, assert synchronously (no `vi.waitFor` needed for the enable) one `playbook_enabled` naming the approval, the `approval_used` with `by: "kernel"`, the playbook `enabled` at that version, and the queued message text `approved approval <id>: kernel_playbook_enable. The kernel enabled playbook … Nothing to repeat.` The stand-in Wright woken by that message makes NO tool call (push a driver that only replies) and the test still passes; a test-local assertion that no second `kernel_playbook_enable` approval exists. Keep the rest of the scenario (fire, duplicate skip, always grant, token-limit park) unchanged.
   - `kernel/test/phase-3-exit-live.test.ts` step 4 (`4_…`) passes when the approval is decided `once` by `owner`, exactly one `playbook_enabled` names it, the `approval_decided` event carries `applied`, and the playbook was enabled before the first minute. It records Wright's reply to the decision message when one arrives within the wait, never requires it. Update its header comment (lines 25–30) to match.
   - `docs/evidence/phase-3-exit-runbook.md` step 4: the kernel applies the approved enable itself; the pass condition above; the paragraph about the retry having to repeat the held call is replaced by what the message now says. The evidence template's step 4 `harness` keys gain `wright_reply` (may be empty).

6. **Docs.**
   - `docs/architecture/approvals.md`: a "Kernel-applied actions" section: the closed set and why (kernel tools with a kernel-side effect; adding one is a code change with its own review), the apply in the decision's transaction, the savepoint, the `apply_refused` tokens (`not_found`, `not_owner`, `turned_off_by_owner`, `not_draft`, `version_changed`, `no_dry_run`, `invalid_input`, `no_applier`, `apply_error`), the `approval_used` `by: "kernel"` field (update the events table row), the message table from Design 2 with `MAX_MESSAGE_CHARS`, and that non-kernel actions keep the agent's retry. Rewrite the paragraph at `approvals.md:58` ("A refused retry leaves the grant unused … the owner's one-shot grant stays unused"): for a kernel-applied action the kernel now records the grant used on every apply attempt.
   - `docs/architecture/dry-run.md` and `docs/architecture/playbooks.md`: enabling now happens on the owner's approval; the handler retry is a defence path only (a retry after the kernel applied is refused by `beforeHold`: the playbook is no longer a draft).
   - `docs/OPEN_QUESTIONS.md`: the "Wright's retry after the owner approves an enable" entry is answered: the enable no longer depends on a retry (this item); the retry of non-kernel outward actions, now with the exact call in the message, is still untested live.

## Touched-file invariants

> Grounded at base `19ce285`. The worker re-checks each entry before hand-back.

- **`kernel/src/approvals/store.ts`**
  - `holdOrUseGrant` matches grants on the canonical `payload_json` (`a.payload_json = ?`) and finds an unused one-shot grant with `NOT EXISTS (… u.kind = 'approval_used' …)`. The kernel's `approval_used` row uses exactly that kind, so a kernel-consumed grant never matches again.
  - `decideApproval`'s refusals write nothing (`throw new ApprovalError("no_such_approval"`, `"approval_not_pending"`, `"always_not_supported"`), and the conditional update (`WHERE id = ? AND status = 'pending'`) stays.
  - The message is one queued event with `sourceRef: \`approval:${id}\``, so a retried decision never queues twice.
  - `alwaysRefusal` keeps `always never covers ${held}` for `ALWAYS_HELD_TOOLS`.
  - Pinned by `kernel/test/approvals.test.ts` (its message-text pins at lines ~727, 795, 810, 969, 1429 and 1573 change by design to the Design 2 texts; the worker lists each one it updates). The fixtures at 1429/1573 seed a rail payload `{ tool: "Bash", command }` with no `input`; move them to the real `{tool, input, cwd}` shape (`sessions/policy.ts:323,338`) so the retry text is asserted on a realistic input.
- **`kernel/src/approvals/routes.ts`**
  - Every error mapping (`404 no_such_approval`, `409 approval_not_pending` with `status`, `409 always_not_supported` with `message`) stays. The 200 body stays `{ approval: approvalView(…) }`.
  - Pinned by `kernel/test/approvals.test.ts` (routes).
- **`kernel/src/approvals/cli.ts`**
  - `decide` keeps its first line (`studio: approval ${id} ${verb}${how}: …; the requesting agent gets a message`) and its exit codes. `formatApprovals` prints byte-identically for an approval without the new fields.
  - Pinned by `kernel/test/approvals.test.ts` and `kernel/test/cli.test.ts`.
- **`kernel/src/features/contribution.ts`**
  - Type-only imports from other kernel modules (the header: "it imports only zod and type-level kernel modules"). `mergeContributions` keeps refusing collisions and malformed parts by throwing.
  - Pinned by `kernel/test/feature-seams.test.ts`.
- **`kernel/src/tools/server.ts`**
  - `heldToolCheckOf` and `contributedToolHandler` unchanged ("Never rejects", zod parse before the handler).
  - Pinned by `kernel/test/kernel-tools.test.ts` and `kernel/test/playbooks-dry-run.test.ts`.
- **`kernel/src/api/server.ts`**
  - The contributed-route call keeps `params, query, body, store, now`; the new field is additive and optional. Phase 1 routes unchanged.
  - Pinned by `kernel/test/api.test.ts`.
- **`kernel/src/kernel.ts`**
  - The manager construction keeps `admission` and `heldToolCheck: heldToolCheckOf(contributions.tools, …)`; the applier is built from the same `contributions.tools`.
  - Pinned by `kernel/test/kernel-daemon.test.ts` and `kernel/test/feature-seams.test.ts`.
- **`kernel/src/playbooks/enable.ts`**
  - `beforeHold`'s refusals (used key, no dry run, `PlaybookError` ⇒ `refuse`), `ownApproval`'s filter (session + tool + playbook + idempotency key + `source = 'rail'`), and `refuseStaleReplay` stay.
  - Pinned by `kernel/test/playbooks-dry-run.test.ts` (the "defence behind the gate" and own-approval tests, green unchanged: they decide without an applier).
- **`kernel/src/playbooks/store.ts`** (`enablePlaybook`, read only)
  - It re-checks the version and `draft` status in its own transaction and writes `playbook_enabled` with `by: OWNER`. Nested in the decision's savepoint it joins it.

## Closed enumerations touched

> Sibling greps at base `19ce285`: `grep -rln "ALWAYS_HELD_TOOLS" kernel/src docs` (hits: `features/contribution.ts`, `playbooks/enable.ts`, `sessions/manager.ts`, `sessions/types.ts`, `sessions/policy.ts`, `approvals/index.ts`, `approvals/store.ts`, `docs/ARCHITECTURE.md`, `docs/architecture/playbooks.md`, `docs/architecture/approvals.md`) and `grep -rn "approval_used" kernel/src docs` (hits: `approvals/store.ts`, `playbooks/enable.ts`, `docs/architecture/approvals.md:131,167`, `docs/architecture/playbooks.md:33`, `docs/evidence/phase-3-exit-runbook.md:184`).

- **`KERNEL_APPLIED_ACTIONS`** (new closed set, sibling `ALWAYS_HELD_TOOLS`): defined once in `approvals/store.ts`, exported from `approvals/index.ts`, named in `docs/architecture/approvals.md`; `approvalApplierOf` enforces it.
- **`apply_refused` reason tokens** (new closed list): `EnableRefused.reason` in `enable.ts` (six) plus the approvals-side `invalid_input`, `no_applier`, `apply_error`; all nine named in `docs/architecture/approvals.md`.
- **`approval_used` payload** gains `by: "kernel"` on the kernel's use only (the rail's use keeps `{id, tool}`): update the events-table row in `approvals.md` (line 167) and the "Once." bullet (line 131).
- **`approval_decided` payload** gains the optional `applied` / `apply_refused` / `apply_detail` fields (present only when the kernel applied): update `approvals.md:110` (`one approval_decided event ({id, decision, by: "owner", action})`), the events-table row at `approvals.md:166` (`| approval_decided | {id, decision, by, action} |`), and the `decideApproval` doc comment at `kernel/src/approvals/store.ts:352-363`, which also states the old message text `"<approved|denied> approval <id>: <action>"`.

## Pin mutations

| Pin | Mutation that must turn it red |
|-----|--------------------------------|
| `approvals.test.ts` or `playbooks-dry-run.test.ts` AC1: approve `once` with the applier ⇒ `enabled` at v4, one `playbook_enabled` naming the approval, `approval_used` `by: "kernel"`, message "The kernel enabled …" | In `decideApproval`, skip calling the applier. |
| AC1 same transaction: an applier that enables then throws ⇒ nothing enabled, `apply_refused: apply_error`, approval still `approved` | Run the applier outside the nested `store.transaction`. |
| AC2: edit to v5 after the request, approve ⇒ `apply_refused: version_changed`, still `draft`, message says so | Drop the `subjectVersion === row.version` check in `enableApproved` (and the edited-since check). |
| AC3: owner turned it off, approve ⇒ `apply_refused: turned_off_by_owner` | Move `not_draft` before `turned_off_by_owner` in the check order. |
| Grant consumed: after an applied or refused apply, the same held call from the agent is not let through on that grant (refused `held_refused` or held as a new approval) | Do not append the kernel's `approval_used` event. |
| AC4: approved held `gh pr comment` ⇒ message names `tool` and the exact canonical input and asks for one unchanged retry; the retry consumes the grant as today | Emit today's `approved approval <id>: <action>` text for rail approvals. |
| AC5: deny ⇒ nothing applied, no `approval_used`, message "Nothing was done; do not repeat the call." | Call the applier for `deny` too. |
| Closed set: a tool declaring `applyOnApproval` outside `KERNEL_APPLIED_ACTIONS` ⇒ `approvalApplierOf` throws | Remove the membership check. |
| Every `KERNEL_APPLIED_ACTIONS` member is in `ALWAYS_HELD_TOOLS` | Add a non-held tool name to the set. |
| `studio approve` prints `the kernel applied it:` / `not applied:` | Drop the new lines in `cli.ts` `decide`. |
| `phase-3-exit.test.ts` steps 4 and 9 enable with a stand-in Wright that makes no call | Revert `decideApproval` to call no applier: the playbook stays `draft`. |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel-applied approvals, messages, exit checks and docs | all | 18 modify (+2 conditional) | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Kernel-applied approvals, messages, exit checks and docs (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "KERNEL_APPLIED_ACTIONS"}
  - {kind: "symbol", path: "kernel/src/tools/server.ts", name: "approvalApplierOf"}
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: "enableApproved"}
requires: []
lanes:
  - "kernel/src/approvals/store.ts"
  - "kernel/src/approvals/index.ts"
  - "kernel/src/approvals/routes.ts"
  - "kernel/src/approvals/cli.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/playbooks-dry-run.test.ts"
  - "kernel/test/phase-3-exit.test.ts"
  - "kernel/test/phase-3-exit-live.test.ts"
  - "kernel/test/kernel-tools.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/cli.test.ts"
  - "docs/architecture/approvals.md"
  - "docs/architecture/dry-run.md"
  - "docs/architecture/playbooks.md"
  - "docs/evidence/phase-3-exit-runbook.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires: []
```

## File Impact Map

| File | Action | Confidence |
|------|--------|-----------|
| kernel/src/approvals/store.ts | modify (closed set, types, `decideApproval` apply + messages, `approvalView` fields) | HIGH |
| kernel/src/approvals/index.ts | modify (exports) | HIGH |
| kernel/src/approvals/routes.ts | modify (pass `req.approvalApplier`) | HIGH |
| kernel/src/approvals/cli.ts | modify (`studio approve` / `approvals` lines) | HIGH |
| kernel/src/features/contribution.ts | modify (`applyOnApproval`, `ContributedRouteRequest.approvalApplier`, merge check) | HIGH |
| kernel/src/tools/server.ts | modify (`approvalApplierOf`) | HIGH |
| kernel/src/api/server.ts | modify (option passed to contributed routes) | HIGH |
| kernel/src/kernel.ts | modify (build and pass the applier) | HIGH |
| kernel/src/playbooks/enable.ts | modify (`enableApproved`, `EnableRefused`, `applyOnApproval`, description) | HIGH |
| kernel/test/approvals.test.ts | modify (message texts, apply cases, closed set) | HIGH |
| kernel/test/playbooks-dry-run.test.ts | modify (AC1–AC3 through the applier; existing handler-path pins unchanged) | HIGH |
| kernel/test/phase-3-exit.test.ts | modify (steps 4 and 9) | HIGH |
| kernel/test/phase-3-exit-live.test.ts | modify (step 4 and header) | HIGH |
| docs/architecture/approvals.md | modify | HIGH |
| docs/architecture/dry-run.md | modify | HIGH |
| docs/architecture/playbooks.md | modify | HIGH |
| docs/evidence/phase-3-exit-runbook.md | modify (step 4, template key) | HIGH |
| docs/OPEN_QUESTIONS.md | modify (answer the retry entry) | HIGH |
| kernel/test/kernel-tools.test.ts | modify (`approvalApplierOf`: closed-set throw, invalid-input refusal) | MEDIUM |
| kernel/test/feature-seams.test.ts / kernel/test/cli.test.ts | modify only if a pin must change, or for the `applyOnApproval` merge check (the worker lists it) | LOW |

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Widening the safety kernel: the kernel acting without the owner's approval, or `always` reaching a kernel-applied action | HIGH | It applies only on the owner's `once` decision of a rail approval whose tool is in a closed set in code that is also in `ALWAYS_HELD_TOOLS`; `alwaysRefusal` already refuses those. Deny applies nothing. Pinned (AC1, AC5, closed-set pins). |
| Enabling a version the owner never saw | HIGH | `enableApproved` checks `subject_version`, edits after the request (event-id order), a `done` dry run of the current version, owner-off and `draft`, and `enablePlaybook` re-checks the version in its transaction. |
| A partial apply leaves half-written state on an unexpected throw | HIGH | The applier runs in a nested transaction (savepoint); a throw rolls back its writes and records `apply_error`. Pinned. |
| The agent spends the grant after the kernel applied (a double enable or a stale enable) | MEDIUM | The kernel appends `approval_used` (`by: "kernel"`) on every apply attempt; `holdOrUseGrant` then never matches that grant; a retry hits `beforeHold` (not a draft ⇒ `held_refused`). |
| The approvals module coupling to playbooks | MEDIUM | Approvals sees only `ApprovalApplier` (a function by tool name); the enable tool registers it through the feature seam; `kernel.ts` wires it (Design 1). |
| The mirror is not rewritten on a kernel enable | LOW | `after` runs `syncMirror` once the decision commits; a failure is ignored and the next resync writes it. |
| Feasibility (Phase 2.5): Architecture Fit CAUTION | MEDIUM | Design 1's optional seam, additive on every type it touches. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Validation (must pass before merge)
- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-17-kernel-applies-approved-enable.md
```

## Plan Review
- **Decision:** PASS (attempt 2/3; attempt 1 PASS with 1 MEDIUM + 5 LOW, all fixed)
- **Deferred (LOW):** Feasibility row 4 says "About 17 files"; the Subtask Structure says 18 modify (+2 conditional). Cosmetic; the single-subtask decision does not depend on it.
- **Owner:** Save and exit

## Outcome
- **Status:** completed
- **Completed:** 2026-10-17T14:42:44Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/79
- **Branch:** feature/phase3-10-kernel-applies-approved-enable
- **Files changed:** 21
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** The owner's once approval of a held kernel_playbook_enable now makes the kernel re-validate and enable the playbook in the decision's transaction (savepoint), record approval_used {by: kernel}, and queue a message stating what it did or why not (apply_refused tokens). Non-kernel rail approvals keep the agent's retry with the exact tool + input in the message; a deny says nothing was done. Approvals calls a registered applier by tool name (KERNEL_APPLIED_ACTIONS closed set, approvalApplierOf); enable.ts has one enableApproved for both paths. Phase 4.5: iteration 1 PASS with 1 MEDIUM (rail hold text still told a kernel-applied enable to repeat; fixed 336a4ac), iteration 2 PASS, no issues. 4 LOW dismissed. risk_classification: high_risk true (content, size). 1425 tests pass.

## Not verified
- **live harness step 4 (kernel/test/phase-3-exit-live.test.ts)** — typechecks and skips without STUDIO_LIVE=1; the owner's run (subtask 1)
