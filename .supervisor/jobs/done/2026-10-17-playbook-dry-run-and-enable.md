# Supervisor Job: Wright dry-runs a playbook, shows the result, and asks the owner to enable it

## Environment
- **Project:** loomwright-studio (lane clone L1 of run automate-2026-10-17-091219)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the sibling lane L2, item 08, builds the fire-time dedupe evaluator in `kernel/src/playbooks/runs.ts` at the same time; see Risks)
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092907-wright-dry-runs-a-playbook-and-asks-to-enable-it.md
- **Base commit:** b30ae94

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest. The change fills the two empty parts `kernel/src/playbooks/dry-run.ts` and `kernel/src/playbooks/enable.ts` that item 01 reserved. |
| 2 | Dependency Availability | GO | No new dependency. Item 03 shipped `startSession({ …, dryRun: true })` and `SessionHandle.dryRun` (`kernel/src/sessions/dry-run.ts`). Migration 13 shipped `playbook_runs` and `sessions.playbook` / `playbook_version`. `nextCronFire` exists in `kernel/src/triggers/cron.ts`. |
| 3 | Architecture Fit | CAUTION | Three small seams are missing. (a) A contributed tool cannot start a session: `ContributedToolContext.sessions` has only `stopSession` / `getSession` (`kernel/src/features/contribution.ts`), although `kernel.ts` already passes the whole manager. (b) The gate holds every `kernel_playbook_enable` call before the handler runs (`ALWAYS_HELD_TOOLS`), so nothing can refuse a call with no dry run or put display text on the held approval. (c) No store function sets a playbook to `enabled`. |
| 4 | Scope vs Supervisor Capability | GO | About 16 files. One subtask: the seams and their single consumer must land together, and none of the three split reasons applies. |
| 5 | Hard Blockers | GO | None. No migration is needed (display text rides on the `approval_requested` event payload). |

**Overall Verdict:** CAUTION (finding 3 is resolved by Design 1–3 below; it feeds the Risk Assessment)

## Task
**Goal:** Ship `kernel_playbook_dry_run(id, idempotency_key)` and `kernel_playbook_enable(id, idempotency_key)`. A dry run runs the playbook's current version once in a dry-run session. It stores a `playbook_runs` row of kind `dry_run` (the "would do" list, the next three fire times, the next fire's dedupe key, tokens), shows it in the playbook's mirror and returns it to Wright. Enabling is refused without a completed dry run of the current version. Otherwise it is held for the owner with a display that `studio approvals` shows, and it enables exactly the approved version when Wright retries.

**Problem Statement:**
Item 02 stores playbook drafts, and item 03 can run a session that reads but never acts. Nothing dry-runs a playbook, and nothing enables one (ROADMAP phase 3 exit, "whose dry-run output is shown before it's enabled"; D3; invariant 3). Item 01 reserved both tool names. `kernel_playbook_enable` is already in the fixed outward set (`ALWAYS_HELD_TOOLS`).
Success: the owner sees what the playbook would do, its schedule, what its dedupe key would skip and its token cost before approving. An enable approval is never for a version the owner did not see. An edit after the request cancels the enable.

## Acceptance Criteria
- [ ] Given a draft playbook, when Wright calls `kernel_playbook_dry_run` with a stand-in session that reads one file and attempts one `gh pr comment`, then a `dry_run` run is stored with that comment in its "would do" list, the next three fire times and tokens, and the mirror shows the summary.
- [ ] Given a draft with no dry run of its current version, when Wright calls `kernel_playbook_enable`, then the result is an error saying a dry run is required.
- [ ] Given a dry-run draft, when Wright calls `kernel_playbook_enable`, then the call is held, and `studio approvals` shows the playbook, its version, its values with "(proposed)" marks, and the dry-run summary.
- [ ] Given the owner approves and Wright retries, when the retry runs, then the playbook is `enabled` at the approved version.
- [ ] Given an edit after the request and before the retry, when the retry runs, then enabling is refused and the playbook stays `draft`.
- [ ] Given a playbook with no model, when dry-run is requested, then it is refused naming the model.
- [ ] Tests in `kernel/test/playbooks-dry-run.test.ts` (stand-in sessions, no model).

### Design (binding for the worker)

1. **Seam A: a contributed tool may start a session.** In `kernel/src/features/contribution.ts`, add an OPTIONAL `startSession?(params: StartSessionParams): Promise<SessionHandle>` to `ContributedToolContext.sessions`. Use a type-only import from `../sessions/types.js`, because `kernel/test/feature-seams.test.ts` pins that the feature registry loads without the Agent SDK. In `kernel/src/tools/server.ts`, widen `KernelToolContext.sessions` from `Pick<SessionManager, "stopSession" | "getSession">` to also pick `startSession` (optional), and pass it through in `contributedToolHandler`. `kernel.ts` already passes the whole `manager`, so it needs no edit unless typecheck says otherwise. Existing callers and tests that build a context without `startSession` keep compiling. A tool that needs it and finds it absent refuses with a clear error and never throws an unhandled error.

2. **Seam B: a held-tool check that runs before the hold.** It applies to tools in `ALWAYS_HELD_TOOLS` only. A contributed tool may declare an optional `beforeHold(args, ctx)` in `ContributedTool` (`contribution.ts`). It is synchronous, reads the store only, and returns either `{ refuse: string }` or `{ display: string; subjectVersion?: number }`. `mergeContributions` throws `InvalidContributionError` when `beforeHold` is present but not a function. `kernel.ts` builds one lookup from the shipped contributions, `(toolName, input, sessionId) => verdict | undefined`, and passes it to `SessionManager` as a new optional constructor option (typed in `kernel/src/sessions/types.ts`). In the gate (`kernel/src/sessions/manager.ts`):
   - It runs only after the policy allowed and the rail answered `outward` for an `ALWAYS_HELD_TOOLS` call. It runs before `holdOrUseGrant`, and never in a dry-run session (that branch never reaches the approval path).
   - Every outcome, exactly:

     | Lookup outcome | Gate action |
     |---|---|
     | no lookup configured | hold exactly as today, no display |
     | lookup returns `undefined` (the tool declares no `beforeHold`) | hold exactly as today, no display |
     | args fail the tool's zod shape | refuse (the lookup parses with the tool's shape first) |
     | `{ refuse }` | deny with the new gate-local reason `held_refused`, one `tool_decision` event, the refusal text as `permissionDecisionReason`. No approval row, no grant consumed |
     | `{ display, subjectVersion? }` | hold. `holdOrUseGrant` → `requestApproval` stores `display` (truncated to a fixed maximum, e.g. 4000 characters, never refused) and `subject_version` in the `approval_requested` event payload. Never in `payload_json`: grant matching on the canonical payload stays byte-identical. A grant that matches is consumed exactly as today |
     | throw, or any other shape | deny `kernel_gate_error` (fail closed) |

   - It can only narrow: it never allows a call that would be held, never skips the hold, and never consumes a grant itself.
   - `approvalView` (`kernel/src/approvals/store.ts`) exposes `display` read from that event, only when it is non-null. Omitting the key otherwise keeps every existing `toEqual` on an `ApprovalView` green. The worker checks `approvals.test.ts` and lists any pin it must update.
   - `formatApprovals` (`kernel/src/approvals/cli.ts`) prints it before `payload:` as a `display:` label. Each line is escaped with the same escape `payloadText`/`field()` use and indented under the label: the text carries untrusted data (playbook name and intent written by Wright, would-do summaries of tool inputs). A test puts a control character and a fake `payload:` line in a would-do summary and asserts the output escapes both and keeps them indented under `display:`.
   - A refused retry (for example an edit with no new dry run) leaves the owner's approved one-shot grant unused. `docs/architecture/approvals.md` says so, and that the handler's own checks (Design 5) stop any later stale use.

3. **Store: `enablePlaybook`** goes in `kernel/src/playbooks/store.ts`. It takes `{ id, version, sessionId, approvalId, now }`. In one transaction it sets `status = 'enabled'` only when the row's current `version === version` and status is `draft`, and appends `playbook_enabled` `{ playbook_id, version, approval_id, by: "owner" }` (the owner approved it). Otherwise it throws `PlaybookError("invalid_input", …)` naming why. Add `playbook_dry_run` and `playbook_enabled` to `PLAYBOOK_AUDIT_KINDS`, and update the exact-list pin in `kernel/test/playbooks-drafts.test.ts`. No new `PlaybookErrorCode`: every new refusal is `invalid_input` with a message naming the cause ("model", "dry run required", "version changed").

4. **`kernel_playbook_dry_run(id, idempotency_key)`** goes in `kernel/src/playbooks/dry-run.ts`. Follow `drafts.ts` conventions: `named(...)`, `owningAgent(ctx)`, `refuseIfOwnerTurnedOff`, zod `idempotency_key` 1–200.
   - Refusals:
     - The playbook is not the caller's (`not_owner`, as drafts).
     - No model set ⇒ `invalid_input` naming `model`. The kernel never picks a model (`docs/architecture/brain.md`).
     - Not a draft (already enabled at this version, or disabled) ⇒ the refusals `drafts.ts` already uses.
   - **Check order:**
     1. The playbook's own model. Null ⇒ refuse naming the playbook's `model`, before Wright's settings are read and before any session.
     2. `readWrightSettings(dataDir)`. A not-ok result (e.g. `model_unset`) is its own refusal, naming `wright.json`.
     3. Only then the session.
   - Session: `ctx.sessions.startSession({ agent: owning agent, prompt: <the current version's intent, verbatim>, model: <playbook model>, permissionMode, cwd, policy, dryRun: true, playbook: id, playbookVersion: version })`. `permissionMode` / `policy` come from those settings and `cwd = wrightMemoryDir(dataDir)`, exactly as `kernel/src/brain/handler.ts` starts Wright. The playbook's model always wins over the settings' model. Then await `handle.done` and `handle.dryRun`.
   - **Test fixture (binding):**
     - The AC6 fixture writes a VALID `wright.json` (a model set). The no-model refusal is then the playbook's, and removing it turns the pin red.
     - The AC1 fixture's `wright.json` policy allows `Read` and the `gh` Bash prefix (as `sessions-dry-run.test.ts`'s GH policy does). `gh pr comment` then passes the policy, the rail calls it outward, and it is recorded `would: "held"`, never `as_real_run`.
   - The step key makes it exactly-once per `idempotency_key` (`runStepAsync`, `kernel/src/loop/steps.ts`). A repeat with the same key returns the stored summary and starts no second session. `startSession` is the step's first effect, with a no-effect predicate for `admission_refused`, as `brain/handler.ts` uses: an admission refusal returns the refusal as the tool error and leaves nothing to repeat.
   - **The run row** is inserted only after `startSession` succeeded: a `playbook_runs` row `kind = 'dry_run'`, `status = 'running'` with `session_id`, `version`, `started_at`. On the end, set `status` to `done` (the session completed) or `failed` (anything else), plus `ended_at`, `tokens` and `result_json`.
     - `tokens` is the sum of input + output + cache-write + cache-read tokens over the report's `usage` models.
     - `result_json` is `{ would_do, next_fires, dedupe_key, final_text, usage }`.
   - **Stale rows.** A kernel restart (`kill -9`) mid dry run leaves the row `running` while its session is no longer live. On every call, BEFORE the step (so a same-key repeat clears stale rows too), the next `kernel_playbook_dry_run` call for that playbook first marks any `running` dry_run row `failed` whose session row reads terminal or is not live. `latestDryRun` only ever reads `done` rows, so a stale row never counts as a dry run. `dry-run.md` states this.
   - **Tool-call timeout (unverified).** Whether the CLI/SDK puts a timeout on an in-process SDK-MCP tool call is unverified. The worker greps the installed `@anthropic-ai/claude-agent-sdk` (types and docs under `kernel/node_modules`) for an MCP tool timeout setting and records the finding in `docs/OPEN_QUESTIONS.md` under the existing NEEDS VERIFICATION convention. If a timeout fires, Wright sees a tool error while the dry run finishes and its row still lands `done`; a repeat with the same key returns it. The honest limit goes in `dry-run.md`.
   - `next_fires`: from `linkedTriggerOf`. A cron spec ⇒ three successive `nextCronFire(spec, tz, after)` values from `ctx.now()`. A once spec ⇒ `[at]` when it is in the future, else `[]`. No trigger ⇒ `[]`.
   - `dedupe_key`: a small pure function in `dry-run.ts` evaluates the playbook's `dedupe_key_spec` (the closed `DEDUPE_KEY_FIELDS`) for the FIRST next fire. Values come from `playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at` = that fire's ISO instant, and `date` = that fire's local date in the trigger's time zone. The result is `null` when there is no spec or no next fire. The doc says it is a preview, and that item 08 owns the fire-time check.
   - Append one `playbook_dry_run` audit event `{ playbook_id, version, run_id, status, tokens, would_do: <count> }`.
   - Rewrite the mirror (Design 6).
   - Return `{ run_id, playbook, version, status, would_do, next_fires, dedupe_key, tokens, summary }`, where `summary` is the same one-paragraph text the mirror and the approval display use. Export a reader `latestDryRun(store, playbookId, version)` (the newest `done` `dry_run` row of that version, or null) and the summary formatter, for Design 5 and 6.
   - Recursion is safe by construction: inside a dry-run session `kernel_playbook_dry_run` is already "would do" (`*_dry_run`, `docs/architecture/dry-run.md`).

5. **`kernel_playbook_enable(id, idempotency_key)`** goes in `kernel/src/playbooks/enable.ts`. It has two halves.
   - **`beforeHold`** (Seam B):
     - Not found, not the caller's, owner-off, or not a draft ⇒ `refuse`.
     - No `done` dry run of the current version (`latestDryRun`) ⇒ `refuse` with text containing "a dry run of version <n> is required" (AC2).
     - Else `{ display, subjectVersion: <current version> }`. The display holds the playbook name and slug, `version <n>`, and every policy value the row has — `model`, `priority`, `dedupe_key`, `token_limit`, `effort`, `api_key_fallback` (the fields `formatPlaybook` shows) — each marked ` (proposed)` where its `*_set_by` is `wright`, and the latest dry run's summary (AC3).
   - **The handler** (runs only on the owner-approved retry):
     - **Find this call's OWN approval.** Take the newest approval that is all of:
       - consumed by an `approval_used` event linked to `ctx.sessionId` with payload `tool` = `mcp__kernel__kernel_playbook_enable`;
       - `payload_json.input.id` equals `args.id` (compared as the same id after resolving a slug) and `payload_json.input.idempotency_key` equals `args.idempotency_key`;
       - from an `approval_requested` event with `source: "rail"`.
       None ⇒ refuse, fail closed; the handler never enables without its own consumed approval. Two enables in one session can never borrow each other's approval.
     - **Version checks (AC5).** Every one must hold, else refuse "version changed" (status stays `draft`):
       1. That approval's `approval_requested` payload `subject_version` equals the playbook's current version. A missing `subject_version` ⇒ refuse.
       2. No `playbook_updated` event for this playbook has an event id greater than that `approval_requested` event's id. Event ids are monotonic, which avoids same-second clock ties.
       3. A `done` dry run of the current version exists.
     - Else `enablePlaybook` at the current version, inside the tool's step (`runStep` with `ctx.stepKey(idempotency_key)`, exactly-once), then `refuseIfOwnerTurnedOff` and the mirror rewrite, as `drafts.ts`'s `afterStep` does.
     - Return `{ playbook, version, status: "enabled", approval_id }`.
   - It never edits `kernel/src/triggers/`. The linked trigger already exists (item 02), and item 08 makes it fire.

6. **Mirror.** `renderPlaybookMirror` / `writePlaybookMirror` (`kernel/src/playbooks/mirror.ts`) take an optional last-dry-run summary. Absent ⇒ today's `Last dry run: No dry run yet.` line, byte-identical, so the existing drafts pin stays green. `syncMirror` and `resyncPlaybookMirrors` (`kernel/src/playbooks/drafts.ts`) pass `latestDryRun(store, row.id, row.version)`'s summary. A resync therefore never wipes it, and an edit (new version) shows "No dry run of version <n> yet." Exact text is the worker's choice; the doc states it.

7. **Docs.**
   - `docs/architecture/dry-run.md`: replace the closing "added by item 07" line with the playbook half: the tool, refusals, the run row and `result_json` shape, next fires, the dedupe-key preview, tokens counting against limits, and the mirror line.
   - `docs/architecture/playbooks.md`: enabling, statuses, the mirror's last-dry-run line, and the two new audit kinds. Replace the "item 07 fills it" notes.
   - `docs/architecture/approvals.md`: the `beforeHold` check (`held_refused`, display text on the `approval_requested` event, fail closed, narrowing only), plus the "grant left unused" note. Also replace its "Running a playbook's dry run is item 07." sentence in the **Dry runs** paragraph.
   - Every relative link resolves (`bash scripts/check-docs.sh`). Do not edit `docs/architecture/playbook-runs.md` (item 08's page).

## Touched-file invariants

> Grounded at base `b30ae94`. The worker re-checks each entry before hand-back.

- **`kernel/src/sessions/manager.ts`**
  - Keep the gate's fail-closed throw path (`reason = "kernel_gate_error";`) and "No tool runs without a recorded kernel decision". The rail applies only after the policy allowed. A dry-run session never reaches the approval path. The hold and its `tool_decision` event share one transaction (`const o = holdOrUseGrant(this.#store, call, this.#now());`).
  - The new check runs only for `ALWAYS_HELD_TOOLS` calls, outside dry runs, and before that call.
  - Pinned by `kernel/test/sessions.test.ts`, `kernel/test/approvals.test.ts` and `kernel/test/sessions-dry-run.test.ts`, all green unchanged.
- **`kernel/src/approvals/store.ts`**
  - `holdOrUseGrant` matches grants on `payload_json = ?` (canonical JSON). The display must never enter `payload_json`.
  - `MAX_APPROVAL_ACTION` and the NUL checks stay.
  - Standing grants never cover `ALWAYS_HELD_TOOLS`.
  - Pinned by `kernel/test/approvals.test.ts`.
- **`kernel/src/features/contribution.ts` / `kernel/src/tools/server.ts`**
  - Type-only imports from sessions. `contributedToolHandler` still parses args with zod before the handler, and still turns a throw into an `isError` result ("Never rejects").
  - Pinned by `kernel/test/feature-seams.test.ts` and `kernel/test/kernel-tools.test.ts`.
- **`kernel/src/playbooks/store.ts`**
  - `writeVersion` turns `enabled` back to `draft` on every edit. Keep it: an edited enabled playbook needs a new dry run and a new approval.
  - Pinned by `kernel/test/playbooks-drafts.test.ts` (audit kinds exact list, updated by this item).
- **`kernel/src/playbooks/mirror.ts`**
  - The no-summary render is byte-identical to today's.
  - Pinned by `kernel/test/playbooks-drafts.test.ts` (`Last dry run: No dry run yet.`).
- **`kernel/test/playbooks-foundation.test.ts`**
  - It asserts that `dryRunPart` and `enablePart` are empty, and that the merged tool list is exactly the four drafts tools.
  - Update it so it asserts each part's tools separately: drafts' four, dry-run's one, enable's one. Do not pin the whole merged list as one literal, so item 08's added tools conflict on the fewest lines.
  - Keep `runsPart`'s own assertion untouched (item 08 owns it).
- **`kernel/src/playbooks/drafts.ts`**
  - `syncMirror` (`function syncMirror(`) and `resyncPlaybookMirrors` (`export function resyncPlaybookMirrors(`) stay the only mirror writers. A mirror failure stays a `mirror_error` field, never a thrown error.
  - Pinned by `kernel/test/playbooks-drafts.test.ts`.
- **`kernel/src/kernel.ts`**
  - The manager construction (`const manager = new SessionManager(`) keeps `admission: budget.check`. The kernel MCP server still gets the full `manager` (`createKernelMcpServer({ store, sessions: manager, sessionId, now }, contributions.tools)`). The held-tool lookup is built from the same `contributions` the tools come from.
  - Pinned by `kernel/test/kernel-daemon.test.ts` and `kernel/test/feature-seams.test.ts`.
- **`kernel/src/approvals/cli.ts`**
  - `formatApprovals` keeps every existing line and its escape (`field(`, `payloadText(`). The `display:` block is added only when `display` is present, so an approval without it prints byte-identically.
  - Pinned by `kernel/test/approvals.test.ts` (CLI output).
- **`kernel/src/sessions/types.ts`**
  - `SessionManagerOptions` gains one optional field. Every existing option and the `SessionHandle` never-rejects contract (`readonly result: Promise<string | null>;`) stay.
  - Pinned by `kernel/test/sessions.test.ts`.

## Closed enumerations touched

> Sibling grep at base `b30ae94`: `grep -rnF 'kernel_gate_error' kernel/src docs` (the gate-local reason sibling) and `grep -rnF '"playbook_disabled"' kernel docs`.

- **`held_refused`**, a new gate-local `tool_decision` reason (sibling `dry_run` / `kernel_gate_error`).
  - Name it in `manager.ts`'s gate reason type and in `docs/architecture/approvals.md`.
  - Like `dry_run`, it does not join the public `ToolDecisionReason` union in `policy.ts`. File one follow-up draft under `.supervisor/requirements/proposed/` covering both.
- **`playbook_dry_run`, `playbook_enabled`** (sibling `playbook_disabled`).
  - Name them in `PLAYBOOK_AUDIT_KINDS` (`store.ts`), the exact-list pin in `playbooks-drafts.test.ts`, and `docs/architecture/playbooks.md`.
- **`playbook_runs.status` values `running` / `done` / `failed`.** There is no closed list in code today.
  - Use these literals, the same ones item 08 reads ("ended `done`"). Name them in `dry-run.md`.

## Pin mutations

| Pin | Mutation that must turn it red |
|-----|--------------------------------|
| `playbooks-dry-run.test.ts` AC1 (would-do holds the `gh pr comment`, three fire times, tokens, mirror line) | Store `result_json` with `would_do: []` in `dry-run.ts`. |
| `playbooks-dry-run.test.ts` AC2 (no dry run ⇒ error naming the dry run, no approval row) | Make `beforeHold` return `display` when `latestDryRun` is null. |
| `playbooks-dry-run.test.ts` AC3 (held; `studio approvals` output has name, version, a `(proposed)` mark, the summary) | Drop the ` (proposed)` suffix in the display builder. |
| `playbooks-dry-run.test.ts` AC4 (approve + retry ⇒ `enabled` at that version) | Make the handler skip `enablePlaybook`. |
| `playbooks-dry-run.test.ts` AC5a: request v1, approve, edit (v2), dry-run v2, retry with the same input. The gate consumes the v1 grant, and the handler must refuse "version changed" (still `draft`) | Delete both version checks (`subject_version` and the event-id order) in `enable.ts`. |
| `playbooks-dry-run.test.ts` AC5b: request, approve, edit with no new dry run, retry | Make `beforeHold` skip the `latestDryRun` refusal. The grant is then consumed (the test asserts it is left unused and the retry is denied `held_refused`). |
| `playbooks-dry-run.test.ts`: the handler's own-approval filter. A and B are both at v1, both with a `done` dry run, and B is never edited. Hold both, approve only A, retry A through the gate (A's grant is consumed and A is enabled). Then call B's handler directly through `contributedToolHandler`, with the same `ctx.sessionId` and no grant of its own: it must refuse ("no approval of its own"), and B stays `draft`. The filter is defence in depth behind the gate, which is why this pin bypasses the gate | Match the consumed approval by session and tool only, dropping the `input.id` / `idempotency_key` filter. B's direct call then borrows A's approval and enables B. |
| `playbooks-dry-run.test.ts` AC6 (valid `wright.json` with a model; playbook has none ⇒ refused naming the playbook's `model`, no session started) | Remove the playbook-model refusal: the session starts with the settings' model and the test turns red. |
| `playbooks-dry-run.test.ts`: display escaping (control char + fake `payload:` line) | Print `display` lines raw in `formatApprovals`. |
| `playbooks-dry-run.test.ts` (check throws ⇒ `kernel_gate_error`, no approval) | Wrap the `beforeHold` call in a try/catch that falls through to the hold. |
| `playbooks-dry-run.test.ts` (idempotent repeat ⇒ one session, one run row) | Drop the step wrapper, so each call starts a session. |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Playbook dry run, held enable, seams and docs | all | 18 modify (incl. 1 conditional), 1 create + proposed drafts | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Playbook dry run, held enable, seams and docs (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/dry-run.ts", name: "dryRunPart"}
  - {kind: "symbol", path: "kernel/src/playbooks/dry-run.ts", name: "latestDryRun"}
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: "enablePart"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "enablePlaybook"}
  - {kind: "file", path: "kernel/test/playbooks-dry-run.test.ts"}
requires: []
lanes:
  - "kernel/src/playbooks/dry-run.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/src/playbooks/store.ts"
  - "kernel/src/playbooks/mirror.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/approvals/store.ts"
  - "kernel/src/approvals/cli.ts"
  - "kernel/test/playbooks-dry-run.test.ts"
  - "kernel/test/playbooks-foundation.test.ts"
  - "kernel/test/playbooks-drafts.test.ts"
  - "docs/architecture/dry-run.md"
  - "docs/architecture/playbooks.md"
  - "docs/architecture/approvals.md"
  - "docs/OPEN_QUESTIONS.md"
  - "kernel/test/approvals.test.ts"
  - ".supervisor/requirements/proposed/"
external_requires: []
```

## File Impact Map

| File | Action | Confidence |
|------|--------|-----------|
| kernel/src/playbooks/dry-run.ts | modify (fill the empty part) | HIGH |
| kernel/src/playbooks/enable.ts | modify (fill the empty part) | HIGH |
| kernel/src/playbooks/store.ts | modify (`enablePlaybook`, audit kinds) | HIGH |
| kernel/src/playbooks/mirror.ts | modify (optional summary) | HIGH |
| kernel/src/playbooks/drafts.ts | modify (mirror callers pass the summary) | HIGH |
| kernel/src/features/contribution.ts | modify (Seam A, `beforeHold`) | HIGH |
| kernel/src/tools/server.ts | modify (widen the sessions pick) | HIGH |
| kernel/src/sessions/manager.ts | modify (gate check before the hold) | HIGH |
| kernel/src/sessions/types.ts | modify (manager option type) | MEDIUM |
| kernel/src/kernel.ts | modify (build the held-tool lookup) | MEDIUM |
| kernel/src/approvals/store.ts | modify (display on `approval_requested`, `approvalView`) | HIGH |
| kernel/src/approvals/cli.ts | modify (print `display`) | HIGH |
| kernel/test/playbooks-dry-run.test.ts | create | HIGH |
| kernel/test/playbooks-foundation.test.ts | modify (parts no longer empty) | HIGH |
| kernel/test/playbooks-drafts.test.ts | modify (audit kinds list) | HIGH |
| docs/architecture/dry-run.md | modify | HIGH |
| docs/architecture/playbooks.md | modify | HIGH |
| docs/architecture/approvals.md | modify | HIGH |
| docs/OPEN_QUESTIONS.md | modify (SDK-MCP tool-call timeout, NEEDS VERIFICATION) | MEDIUM |
| kernel/test/approvals.test.ts | modify only if an `ApprovalView`/CLI pin must change (listed by the worker) | LOW |
| .supervisor/requirements/proposed/ | create (follow-up drafts: public `ToolDecisionReason` for `dry_run`/`held_refused`; one dedupe evaluator with item 08) | HIGH |

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
| The pre-hold check widens the safety kernel (lets a held call run, skips the hold or consumes a grant) | HIGH | It can only refuse or add display text. It runs before `holdOrUseGrant` and never replaces it. A throw ⇒ `kernel_gate_error`. Pinned by tests, and the existing approvals and sessions suites stay green unchanged. |
| Display text changes grant matching (payload drift) | HIGH | The display lives on the `approval_requested` event payload, never in `payload_json`. The existing grant tests stay green. |
| Enabling a version the owner never saw | HIGH | The handler requires a consumed approval, refuses on any `playbook_updated` after the request (event-id order), and requires a `done` dry run of the current version. `enablePlaybook` re-checks the version in its transaction. |
| Duplicate dedupe-key evaluation: item 08 (sibling lane L2) writes the fire-time evaluator in `runs.ts` in parallel | MEDIUM | This item's evaluator is a preview in `dry-run.ts` over the same closed field list. It never edits `runs.ts`. The worker files a follow-up draft to make item 08's evaluator the one implementation once both land. |
| The tool call blocks Wright's turn for the whole dry-run session | MEDIUM | This is what the requirement asks ("the tool returns that summary to Wright"). The session is bounded by the agent's limits and admission. An admission refusal returns the refusal as the tool error, and no run row is left `running`. |
| Textual conflicts with lane L2 (item 08) in `kernel/test/playbooks-foundation.test.ts` (part tool lists), `kernel/src/playbooks/store.ts` (`PLAYBOOK_AUDIT_KINDS`), `kernel/test/playbooks-drafts.test.ts` (its exact-list pin) and possibly `kernel/src/playbooks/index.ts` (exports) | MEDIUM | Keep edits to this item's own lines. Assert tools per part, not the whole merged list. Append the two audit kinds at the end of the list. `wave-build` stops on any non-marker conflict, and the owner resolves it on the lane PR, with the second lane rebasing. This item does not add a closed `playbook_runs.status` list: `dry-run.md` names the literals `running` / `done` / `failed` and says item 08 owns the closed list. This item does not edit `brain/handler.ts`, `triggers/store.ts` or `runs.ts`. |
| A long dry run exceeds an SDK-MCP tool-call timeout (unverified) | MEDIUM | Probe-or-record step in Design 4. The row still lands `done`, and a same-key repeat returns it. Stale `running` rows are failed on the next call. |
| Feasibility (Phase 2.5): Architecture Fit CAUTION | MEDIUM | Seams A and B and `enablePlaybook` (Design 1–3), each minimal and optional. |

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
/supervisor job: .supervisor/jobs/pending/2026-10-17-playbook-dry-run-and-enable.md
```

## Plan Review
- **Decision:** PASS (attempt 3/3; attempt 1 FAIL — 1 HIGH, 6 MEDIUM fixed; attempt 2 PASS with 1 MEDIUM fixed)
- **Deferred (LOW):** Est. Files count reads 18 modify, the map lists 19. Stale-row cleanup race between two overlapping calls: the end-of-run update must write `status`/`ended_at`/`tokens`/`result_json` by the run's own outcome, whatever the cleanup wrote.
- **Owner:** Save and exit

## Outcome
- **Status:** completed
- **Completed:** 2026-10-17T05:27:33Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/74
- **Branch:** feature/phase3-07-playbook-dry-run-enable
- **Files changed:** 19
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel_playbook_dry_run runs a draft's current version once in a dry-run session and stores a dry_run playbook_runs row (would-do, next 3 fires, dedupe-key preview, tokens) shown in the mirror. kernel_playbook_enable stays always held: a pre-hold check (beforeHold) refuses with held_refused when no done dry run of the current version exists, else holds with a display (studio approvals) and subject_version on the approval_requested event, never in payload_json. The handler enables only on its own consumed approval and refuses "version changed". Phase 4.5: iteration 1 FAIL (HIGH reused enable key replay, fixed 126e363), iteration 2 FAIL on a MEDIUM (cross-playbook same-key dry-run replay, fixed 59004cc), iteration 3 PASS (LOW nits only). risk_classification: high_risk true (size, content). 1347 tests pass.

## Not verified
- **kernel_playbook_dry_run under a real CLI/SDK session (MCP tool-call timeout)** — no local real-model runtime; SDK types read only, recorded NEEDS VERIFICATION (subtask 1)
- **studio approvals display block on a real terminal** — checked as formatted CLI text through runCli only (subtask 1)
