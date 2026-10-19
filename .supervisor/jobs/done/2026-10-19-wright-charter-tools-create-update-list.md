# Supervisor Job: Wright drafts a charter, and the kernel creates (or changes) the crew member on the owner's approval (`kernel_agent_create`, `kernel_agent_update`, `kernel_agent_list`)

## Environment
- **Project:** loomwright-studio (lane clone L2 of run automate-2026-10-19-001356)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041107-wright-drafts-a-charter-and-the-kernel-creates-it-on-approval.md
- **Base commit:** f387cec5402a6ed6575c7ee5694da93d3d8563bf

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest. Item 01 reserved the empty part `kernel/src/agents/charter-tools.ts` (`charterToolsPart`), merged by `AGENT_PARTS` in `kernel/src/agents/index.ts`. |
| 2 | Dependency Availability | GO | No new dependency. The held/kernel-applied seam exists and has one working user: `beforeHold` / `applyOnApproval` on `ContributedTool` (`kernel/src/features/contribution.ts`), `KERNEL_APPLIED_ACTIONS` already lists both charter tools (`kernel/src/approvals/store.ts`), `ALWAYS_HELD_TOOLS` holds them (`kernel/src/sessions/policy.ts`). Item 02 ships `validateCharter`, `createAgent`, `ensureAgentFiles`, `renderRoleMd`, `renderAgentSettingsJson`, `agentFilePaths` (`kernel/src/agents/charter-files.ts`). `ctx.store.dataDir` reaches the data dir. |
| 3 | Architecture Fit | CAUTION | `createAgent` writes the files right after its own transaction. Inside an applier that transaction is a savepoint of the decision's transaction, so the files would land before the decision commits. The requirement wants the file writes as the applier's follow-up (`after`). That needs one small option on `createAgent` in `charter-files.ts`, which the requirement allows only when needed and said so (Design 3). |
| 4 | Scope vs Supervisor Capability | GO | 1 create + 11 modify, one subsystem. One subtask: none of the three split reasons applies (the tools share one file and one test file). |
| 5 | Hard Blockers | GO | None. No migration (migration 14's `agents` table has every column). |

**Overall Verdict:** CAUTION (finding 3 is resolved by Design 3; it feeds the Risk Assessment)

## Task
**Goal:** Fill `kernel/src/agents/charter-tools.ts` with three kernel tools: `kernel_agent_create(charter, idempotency_key)` and `kernel_agent_update(id, changes, expected_sha256, idempotency_key)` (always held; the kernel applies the owner's `once` itself through `applyOnApproval`), and the read-only `kernel_agent_list()`. Document them in `docs/architecture/agents.md` and update every doc and test pin that still says the charter tools have no applier.

**Problem Statement:**
The owner needs Wright to turn one sentence ("a reviewer that comments on PRs and never pushes") into a crew member the owner approves, seeing every enforced boundary first, because a crew member exists only through a charter the owner saw (D22, invariant 9).
Currently `kernel_agent_create` and `kernel_agent_update` are in `ALWAYS_HELD_TOOLS` and `KERNEL_APPLIED_ACTIONS` but no tool exists, so an owner's `once` is recorded `apply_refused: no_applier` and nothing happens. Wright has no read of the roster with content hashes.
Success looks like: a held create whose display shows `role.md`, the settings JSON and one kernel-generated enforced-boundary line; the owner's `once` makes the kernel create the row, event and files with no Wright retry; a held update that refuses a stale settings hash at hold and at apply; a list whose `sha256` equals each settings file's bytes.

## Acceptance Criteria
- [ ] Given a Wright session (stand-in) that calls `kernel_agent_create` with a valid comment-only reviewer charter (`tool_policy.never: ["git_push", …]`), then the call is held (`approval_required`) and `studio approvals` shows the display with the `role.md` text and the `never` line. No `agents` row and no file exists yet.
- [ ] Given the owner's `studio approve <id> once`, then in the decision the kernel inserts the `mason` row (`created_by: wright`, `approval_id` = the approval's id), writes its five files, records `approval_used` with `by: "kernel"`, and `studio approve` prints `studio: the kernel applied it: The kernel created crew member mason (<display name>) on approval <id>.`. The queued message to Wright ends `Nothing to repeat.`
- [ ] Given the owner created `mason` by hand (`createAgent` with `by: "owner"`) between the hold and the approval, when the owner approves, then `apply_refused: id_taken` is recorded and nothing more is written (one row, the owner's; no `agent_created` with `by: "wright"`). Given the follow-up file write failing (an unwritable `config/agents` folder), then the decision is `approved`, the row exists with `created_by: wright`, and after the folder is writable again the next `ensureAgentFiles` writes every file.
- [ ] Given a crew session (agent `scout`, its policy listing `mcp__kernel__kernel_agent_create`) calling `kernel_agent_create`, then it is denied `held_refused` with text naming `not_lead`, and no approval row exists.
- [ ] Given `kernel_agent_update` with an `expected_sha256` that no longer matches because the owner edited the settings file, then it is refused at hold (`held_refused`, `config_changed`, no approval row). Given an edit after the hold, then the approval is recorded `apply_refused: config_changed` and the file's bytes are unchanged.
- [ ] Given a valid update of `limits.tokens_per_day`, when the owner approves, then only that key changes in the file (every other byte-level value and key order kept), `readAgentSettings` returns the new value, and the display showed `limits.tokens_per_day: <old> → <new>`.
- [ ] Given `kernel_agent_list`, then each member's `sha256` equals `createHash("sha256")` of its settings file's bytes, and Wright's entry has its settings and no `sha256`.
- [ ] `docs/architecture/agents.md` documents the three tools, the displays, the applied sentences and the refusal tokens; the pinned `role.md` and settings example blocks are byte-unchanged; and `bash scripts/check-docs.sh` passes.
- [ ] Tests in `kernel/test/agents-charter-tools.test.ts` (store-level and gate-level with stub sessions; no model, no live session); `cd kernel && npm ci && npm run typecheck && npm test` passes.

### Design (binding for the worker)

1. **The part.** `charterToolsPart.tools` = the three tools, in the order `kernel_agent_create`, `kernel_agent_update`, `kernel_agent_list`, each built with `defineTool` (`kernel/src/features/contribution.ts`). `routes`, `verbs`, `handlers` stay empty; keep `name: "charter-tools"` and `Object.freeze`. Export a frozen `CHARTER_TOOL_REFUSALS` list (the one list of refusal tokens, Design 9) and the three tool-name constants. Model the file on `kernel/src/playbooks/enable.ts` (the one existing held, kernel-applied tool): `beforeHold` returns `{refuse}` or `{display}`, `applyOnApproval` returns `{applied, after?}` or `{refused, text}` and lets any other throw propagate (the decision records `apply_error`).
2. **The caller.** At hold: `ctx.sessions.getSession(ctx.sessionId)?.agent`; at apply: `approval.agent` (the `approval_requested` event's agent). Anything but exactly `"wright"` ⇒ `not_lead` (crew members never create or change agents). Never read the caller from the tool input.
3. **`createAgent` gains one option** (`kernel/src/agents/charter-files.ts`): `CreateAgentOptions.deferFiles?: boolean`. `true` ⇒ every check and the ONE transaction (row + `agent_created`) run unchanged, the files are not written, and `filesError` is `null`; the caller writes them with `ensureAgentFiles` after its own transaction commits. Absent/false ⇒ byte-identical behaviour (the owner's `POST /agents` is unchanged). Update the function's doc comment and the `## Create, without half-creating` section of `agents.md` to say so. This is the only `charter-files.ts` change besides `AGENT_AUDIT_KINDS` (Design 7).
4. **`kernel_agent_create`** — shape `{charter: z.record(z.string(), z.unknown()), idempotency_key: z.string().min(1).max(200)}` (the charter's own rules are `validateCharter`'s, never a second schema).
   - **Description** tells the model: draft the charter from the owner's words; every value the owner did not state is a proposal; put each "never …" the owner said into both the prose `boundaries` and the enforced `tool_policy.never`; propose `limits` and `limits.delegation_depth` and never let the owner think they are already set; the kernel always holds the call for the owner and creates the member itself on approval — end the turn and do not repeat the call; use a new `idempotency_key` per request.
   - **`beforeHold`** (store and file reads only), in order: `not_lead`; `idempotency_key_used` (this session already has an approval whose rail payload is for this tool with this key: `SELECT 1 FROM approvals WHERE requesting_session = ? AND json_extract(payload_json, '$.tool') = ? AND json_extract(payload_json, '$.input.idempotency_key') = ?`, the tool bound as the FULL name `mcp__kernel__kernel_agent_create` / `mcp__kernel__kernel_agent_update`, never the short one); `invalid_input` (`validateCharter(charter, {dataDir: ctx.store.dataDir})` refused — `agent_id_invalid` covers a reserved id such as `wright` — the message names the field); `id_taken` (`getAgent` finds a row, active or off). Refuse text: `kernel_agent_create: <token>: <one-line detail> (nothing was held for the owner)`.
   - **Display** (held), lines in this order so the 4,000-character display cut (`MAX_APPROVAL_DISPLAY`) never hides the enforced part: `Create crew member <id> ("<display name>", <shape> <hue>), proposed by Wright`; the enforced line generated from the PARSED charter, never from prose: `enforced: never: <categories joined ", " or none>; tools: <allowedTools or none>; bash prefixes: <JSON-quoted prefixes or none>`; `limits: tokens_per_day <n> (proposed) | not set (no limit); sessions_at_once …; delegation_depth …`; `workspaces: <list or none>`; `config/agents/<id>.json:` then `renderAgentSettingsJson(charter)`; `memory/<id>/role.md:` then `renderRoleMd(charter)`. The CLI escapes every display line already.
   - **`applyOnApproval`**: `not_lead` (from `approval.agent`); then `createAgent(store, store.dataDir, a.charter, {by: "wright", approvalId: approval.id, deferFiles: true}, now)`. Its refusals map to tokens: `agent_id_invalid` / `charter_invalid` ⇒ `invalid_input`, `id_taken` ⇒ `id_taken`, `files_exist` ⇒ `files_exist`. Refused ⇒ `{refused: <token>, text: "The kernel did not create crew member <id>: <token> (<one-line message>)."}`. Created ⇒ `{applied: "The kernel created crew member <id> (<display name>) on approval <approval id>.", after: () => void ensureAgentFiles(store, store.dataDir, <id>)}` (a throw in `after` is ignored by the decision; the row stays and the next `ensureAgentFiles` heals the files).
   - **Handler** (reached only when a composition with no applier let an approved retry through): throw `kernel_agent_create is applied by the kernel when the owner approves it; this call did nothing` — fail closed, nothing written.
5. **`kernel_agent_update`** — shape `{id: z.string().min(1).max(64), changes: <strict object, every key optional, at least one key>, expected_sha256: z.string().regex(/^[0-9a-f]{64}$/), idempotency_key: z.string().min(1).max(200)}`. `changes` keys: `model` (string), `effort` (string or `null` = clear), `permission_mode` (string), `tool_policy` (`{allowedTools, allowedBashPrefixes}`), `never` (string array), `limits` (object of `tokens_per_day` / `sessions_at_once` / `delegation_depth`, each a number or `null` = clear), `workspaces` (string array), `display_name` (string), `avatar` (`{shape, hue}`). The values' rules are the charter's (step "merge" below), not this shape's.
   - **Merge** (one helper used at hold and apply): read the settings file's bytes once (`agentSettingsPath`); `sha256` of those bytes; parse them as a JSON object. The new file object = the parsed object with only the named keys replaced, in place (key order kept, a new key appended): `tool_policy` replaces `allowedTools` and `allowedBashPrefixes` and keeps any `status` key; `limits` merges per key (`null` deletes that key; `limits` itself stays, as `studio agents set` does); `effort: null` deletes `effort`; every other key replaces whole. Validate the result by building a charter from the row's `charter_json` (`id`, `persona`, `duties`, `boundaries`, and `display_name` / `avatar` unless changed) plus the new file's `model`, `effort`, `permission_mode`, `tool_policy` (with `never` from the file's top-level `never`), `limits`, `workspaces`, and running `validateCharter` (so every value passes the charter's own rules, workspaces and size included). The text written is `JSON.stringify(newObject, null, 2) + "\n"`.
   - **`beforeHold`**, in order: `not_lead`; `idempotency_key_used` (same query, this tool); `reserved` (`id` is `wright`: the owner edits `wright.json`); `not_found` (invalid id or no row); `agent_off` (row `status` is `off`); `invalid_input` (the settings file is missing, over `MAX_SETTINGS_BYTES`, not a JSON object, or the merged result fails `validateCharter`; the detail names the field); `config_changed` (the file's `sha256` ≠ `expected_sha256`); `invalid_input` (`changes changes nothing`: every named value equals the current one).
   - **Display**: `Update crew member <id> ("<display name>"), settings sha256 <first 12 hex>, proposed by Wright`, then one line per changed field `<field>: <old JSON> → <new JSON>` (a limit as `limits.<key>`; absent as `not set`), then the enforced line (Design 4's format) of the result.
   - **`applyOnApproval`**: `not_lead`, `reserved`, `not_found`, `agent_off` as at hold; read and hash the file again — ≠ `expected_sha256` ⇒ `config_changed`, nothing written; merge and validate ⇒ `invalid_input`. Then mirror `studio agents set`'s write (`kernel/src/agents/roster.ts`, function `set`): write a temporary sibling (`.<name>.<pid>.<random>.tmp`, `flag: "wx"`, mode `0o600`); in `store.transaction`: re-read the file's bytes and refuse `config_changed` when they differ from the hashed bytes, update the row's `display_name` / `avatar_shape` / `avatar_hue` / `updated_at` when changed, append one `agent_updated` event `{id, fields, approval_id, by: "kernel"}`, then `renameSync(temp, file)`; on any refusal or throw unlink the temp file. **Why the rename stays in the applier, not in `after`:** in `after` the decision (and `agent_updated`) would commit first, and a failed rename would leave an event and an `applied` sentence for a change that never landed: a false claim to the owner and Wright. In the applier, the order is: the rename is the last statement of the applier's savepoint, and after it `decideApproval` still writes `approval_used`, `approval_decided`, the queued message and the outer COMMIT (`kernel/src/approvals/store.ts`, `decideApproval`). A failure in those writes would leave the new file with no `agent_updated` event and the approval still `pending`, and a re-approve would then refuse `config_changed` against the kernel's own write. `agents.md`'s honest limits must state exactly this (not "the same window as `set`"). Applied sentence: `The kernel updated crew member <id> on approval <approval id>: <fields joined ", ">.` Refused: `The kernel did not update crew member <id>: <token> (<one-line message>).`
   - **Handler**: the same fail-closed throw as Design 4, naming `kernel_agent_update`.
6. **`kernel_agent_list`** — shape `{}`; not held, any agent whose policy lists it may call it; reads only. Returns `{agents: [...]}`: Wright first — `{id: "wright", display_name: "Wright", avatar: {shape: "whale", hue: "accent"}, status: "active", settings, settings_error}` read only when `wright.json` exists (a list never creates it; `rosterOf`'s rule) and with NO `sha256` key — then every row from `listAgents` in id order: `{id, display_name, avatar: {shape, hue}, status, created_by, settings, settings_error, sha256}`. For a member, read the file's bytes ONCE: `sha256` = hex `sha256` of those bytes, `settings` = those bytes parsed as JSON (null when absent, over `MAX_SETTINGS_BYTES` or not JSON; `sha256` null when absent or unreadable), `settings_error` = `readAgentSettings(...)`'s `error` when not ok, else null.
7. **Audit kind.** Add `"agent_updated"` to `AGENT_AUDIT_KINDS` (`kernel/src/agents/charter-files.ts`) and to the `## Events` list in `agents.md` (`agent_updated`: `{id, fields, approval_id, by: "kernel"}`); the create's event stays `agent_created` `{id, by: "wright", approval_id}` (written by `createAgent`).
8. **Imports.** The `studio` CLI loads this file through `./index.ts`: import only types, zod, `node:*`, the feature seam, `../loop/internal.js`, `../brain/settings.js` (`MAX_SETTINGS_BYTES`), and this feature's own modules; type-only imports from `../approvals/store.js` and `../sessions/types.js` (as `enable.ts` does). Never the Agent SDK, the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
9. **Refusal tokens** (`CHARTER_TOOL_REFUSALS`, one frozen list, in this order): `not_lead`, `idempotency_key_used`, `reserved`, `not_found`, `agent_off`, `invalid_input`, `id_taken`, `files_exist`, `config_changed`. Every hold refusal and every `apply_refused` this file answers is one of them.
10. **Existing pins that change** (each exactly, nothing else in those files):
    - `kernel/test/agents-foundation.test.ts`, test "is built from three frozen parts, in order: roster (item 02, filled), delegate (item 06, filled) and charter-tools (item 07, still empty)": the charter-tools assertion becomes `tools: ["kernel_agent_create", "kernel_agent_update", "kernel_agent_list"]` (by `name`), `routes: []`, `verbs: []`, `handlers: {}`, `dueWork: []`, the title says "filled", and the in-test comment `// Item 07's charter-tools part: still empty here.` becomes `// Item 07's charter-tools part: the three charter tools.`. The `Object.keys(agentsContribution)` pin (`["name", "tools", "routes", "subcommands"]`) and `expect(merged.tools).toEqual(AGENT_PARTS.flatMap(` stay unchanged (they already hold).
    - `kernel/test/approvals.test.ts`, test "%s: once with the shipped composition's applier (none registered for it yet) is recorded no_applier, …": with the shipped applier registered, the held `INPUT` fails the charter tools' shapes, so the decision records `apply_refused: invalid_input`; assert that (and the grant spent, the retry held as approval 2) and retitle it. Nothing else in the file changes.
    - `kernel/test/kernel-tools.test.ts`, test "the shipped composition builds: its only applier is the enable's, a member of the set": the appliers are now `kernel_playbook_enable`, `kernel_agent_create`, `kernel_agent_update`; retitle; drop the "before item 07 registers their applier" comment.
    - `kernel/test/agents-roster.test.ts`, the `AGENT_AUDIT_KINDS` pin: add `"agent_updated"` last.
11. **Headers and docs.** Replace the `charter-tools.ts` header ("empty until phase 4 item 07 fills it in") with a header in the style of `enable.ts` and `delegate.ts`. In `kernel/src/agents/index.ts` change only the header sentence that says `charter-tools` is empty. In `kernel/src/approvals/store.ts` change only the `KERNEL_APPLIED_ACTIONS` doc comment paragraph "The two charter tools … are members before their applier exists …". In `docs/architecture/approvals.md`: the "The closed set" paragraph's "before their applier exists" sentence, and add the charter tools' tokens to the `apply_refused` table (`not_lead`, `reserved`, `agent_off`, `id_taken`, `files_exist`, `config_changed`; extend `not_found` / `invalid_input` rows to name the charter tools), and the sentence under the table naming whose tokens they are. In `docs/ARCHITECTURE.md`: only the lines that call the three tools "planned" (the tool-list line and the "The rest of the list above is still planned" sentence) and the one that says "No applier is registered yet". In `kernel/test/agents-foundation.test.ts` the file-header comment (`` `charter-tools`, still empty) ``) may also change. Confirm `kernel/test/feature-seams.test.ts`'s `shippedToolNames()` derives the names (no literal list to edit). `agents.md` gains a section `## Wright's charter tools` (the three tools, both displays with a worked example, the applied sentences, the refusal tokens, what the handler does) and honest limits: the update's rename lands inside the decision's savepoint, before the decision's remaining writes and its COMMIT, so a failure there leaves the new file with no `agent_updated` event and the approval pending (Design 5 says why `after` would be worse); the display is cut at 4,000 characters (the enforced lines come first, and the approval's payload holds the whole charter); `charter_json` is the creation snapshot (an update changes the file and the row, not `charter_json`). **OWNER DECISION (Phase 1.5 SUP-OVERLAP, proceed-anyway):** the two honest-limit bullets "Nothing calls `ensureAgentFiles` yet." and "Nothing enforces the settings yet." in `agents.md` stay BYTE-UNCHANGED on this branch: sibling lane PR #89 (item 05) rewrites both, and editing them here would conflict at wave build. Put this item's facts in NEW bullets instead, for example: "**Wright's create heals its own files once.** The `kernel_agent_create` applier's `after` calls `ensureAgentFiles` right after the decision commits; its throw is ignored, so a failed write leaves missing files (which `show` names) until the next `ensureAgentFiles` call." and "**Wright reads and changes the settings file too.** `kernel_agent_list` reads every member's file, and `kernel_agent_update` reads it and, on the owner's approval, rewrites it." This supersedes the Plan Review's deferred notes about those two bullets.

## Touched-file invariants

> Grounded at base `f387cec`. The worker re-checks each entry before hand-back.

- **`kernel/src/agents/charter-tools.ts`** — keep: `name: "charter-tools"` and frozen part (`export const charterToolsPart: AgentPart = Object.freeze({`); only this file defines the part (`./index.ts merges every part in AGENT_PARTS`). Mirror: `beforeHold` is synchronous and store-read-only, and a throw is `kernel_gate_error` (`It can only narrow: {refuse} denies the call (held_refused)` in `kernel/src/features/contribution.ts`); `applyOnApproval` is synchronous and runs inside the decision's savepoint (`Run applier for held call tool in a nested transaction (a savepoint)` in `kernel/src/approvals/store.ts`).
- **`kernel/src/agents/charter-files.ts`** — keep: `Create never half-creates` (refusals write nothing; row and `agent_created` in ONE transaction); `writeIfAbsent` exclusive create (`flag: "wx", mode: 0o600`); `createAgent`'s `RangeError` for a `by` outside `AGENT_CREATED_BY`. Pinned by: `kernel/test/agents-roster.test.ts` (`renderRoleMd` / `renderAgentSettingsJson` against the `<!-- role-example:start -->` / `<!-- settings-example:start -->` blocks of `docs/architecture/agents.md`, and `expect(AGENT_AUDIT_KINDS).toEqual([`). Only `deferFiles` and `agent_updated` are added.
- **`kernel/src/agents/index.ts`** — only the header sentence (`and \`charter-tools\` is empty`) changes; `AGENT_PARTS`, `mergeAgentParts` and the exports keep their text (add exports for the new charter-tools names only if the tests import them through `./index.ts`).
- **`kernel/src/approvals/store.ts`** — only the `KERNEL_APPLIED_ACTIONS` doc comment (`are members before their applier exists`); the array itself is pinned by `kernel/test/approvals.test.ts` (`expect(KERNEL_APPLIED_ACTIONS).toEqual([`) and stays byte-identical.
- **`kernel/test/agents-foundation.test.ts`, `kernel/test/approvals.test.ts`, `kernel/test/kernel-tools.test.ts`, `kernel/test/agents-roster.test.ts`** — only the pins Design 10 names change; every other test stays byte-identical.
- **`docs/architecture/agents.md`** — the three example blocks (`<!-- charter-example:start -->`, `<!-- role-example:start -->`, `<!-- settings-example:start -->` through their `:end` markers) are pinned by `kernel/test/agents-roster.test.ts` (`const DOC = new URL("../../docs/architecture/agents.md"`) and stay byte-identical.

## Closed enumerations touched

> Sibling grep at base `f387cec`: `grep -rnF 'agent_status_changed' --exclude-dir=node_modules --exclude-dir=.supervisor .` → 7 hits in 4 files. `grep -rnF 'turned_off_by_owner' --exclude-dir=node_modules --exclude-dir=.supervisor .` → 10 hits in 4 files.

- **`agent_updated`** (sibling: `agent_status_changed`) — must be named in:
  - `kernel/src/agents/charter-files.ts` — `export const AGENT_AUDIT_KINDS = ["agent_created", …]` — extend.
  - `kernel/test/agents-roster.test.ts` — `expect(AGENT_AUDIT_KINDS).toEqual([` — extend.
  - `docs/architecture/agents.md` — the `## Events` list — extend.
  - `kernel/src/agents/roster.ts` — one `appendEvent(... "agent_status_changed" ...)` call — no change: a use, not a list.
- **apply_refused tokens `not_lead`, `reserved`, `agent_off`, `id_taken`, `files_exist`, `config_changed`** (sibling: `turned_off_by_owner`) — must be named in:
  - `docs/architecture/approvals.md` — the `| \`apply_refused\` | Why nothing was applied |` table — extend.
  - `kernel/src/agents/charter-tools.ts` — `CHARTER_TOOL_REFUSALS` — create (the one list).
  - `kernel/src/playbooks/enable.ts`, `docs/architecture/playbooks.md`, `kernel/test/playbooks-dry-run.test.ts` — the enable's own tokens — no change: the enable's list, not the charter tools'.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-charter-tools.test.ts` — crew session's create refused `not_lead`, no approval row | delete the `not_lead` check in `beforeHold` of `kernel_agent_create` |
| `kernel/test/agents-charter-tools.test.ts` — held create: no row and no file before the decision | call `createAgent` in `beforeHold` |
| `kernel/test/agents-charter-tools.test.ts` — display holds the `enforced: never: git_push` line | build the enforced line from `charter.boundaries` instead of `tool_policy.never` |
| `kernel/test/agents-charter-tools.test.ts` — approve once: row `created_by: wright` with `approval_id`, five files, `approval_used` by kernel, applied sentence | flip `by: "wright"` → `by: "owner"` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/agents-charter-tools.test.ts` — hand-made `mason` between hold and approve ⇒ `apply_refused: id_taken`, one row | skip `createAgent`'s `id_taken` check via a pre-insert `DELETE` (or: return `applied` without calling `createAgent`) |
| `kernel/test/agents-charter-tools.test.ts` — failing follow-up write: row exists, `ensureAgentFiles` heals | let the `after` throw propagate out of `applyOnApproval` (call `ensureAgentFiles` inside the applier) |
| `kernel/test/agents-charter-tools.test.ts` — stale `expected_sha256` refused at hold (`config_changed`) | delete the hash comparison in the update's `beforeHold` |
| `kernel/test/agents-charter-tools.test.ts` — edit after hold ⇒ `apply_refused: config_changed`, bytes unchanged | delete the hash re-check in the update's `applyOnApproval` |
| `kernel/test/agents-charter-tools.test.ts` — update of `limits.tokens_per_day` changes only that key | replace `limits` whole instead of merging per key |
| `kernel/test/agents-charter-tools.test.ts` — list `sha256` equals the file bytes' hash | hash `JSON.stringify(parsed)` instead of the bytes |
| `kernel/test/agents-charter-tools.test.ts` — Wright's list entry has no `sha256` | add `sha256` to Wright's entry |
| `kernel/test/agents-foundation.test.ts` — charter-tools part has exactly the three tools | remove `kernel_agent_list` from `charterToolsPart.tools` |
| `kernel/test/agents-roster.test.ts` — `AGENT_AUDIT_KINDS` | delete `"agent_updated"` from `AGENT_AUDIT_KINDS` |
| `kernel/test/approvals.test.ts` — shipped applier records `invalid_input` for the charter tools | unregister `applyOnApproval` on `kernel_agent_create` (back to `no_applier`) |
| `kernel/test/kernel-tools.test.ts` — shipped composition's appliers are the three | remove `applyOnApproval` from `kernel_agent_update` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | The three charter tools, `createAgent`'s deferred files, tests, pins and docs | all | 11 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — the three charter tools, createAgent's deferred files, tests, pins and docs (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/agents/charter-tools.ts", name: "charterToolsPart"}
  - {kind: "symbol", path: "kernel/src/agents/charter-tools.ts", name: "CHARTER_TOOL_REFUSALS"}
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "deferFiles"}
  - {kind: "file", path: "kernel/test/agents-charter-tools.test.ts"}
  - {kind: "symbol", path: "docs/architecture/agents.md", name: "## Wright's charter tools"}
requires: []
lanes:
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/src/agents/charter-files.ts"
  - "kernel/src/agents/index.ts"
  - "kernel/src/approvals/store.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "kernel/test/agents-foundation.test.ts"
  - "kernel/test/agents-roster.test.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/kernel-tools.test.ts"
  - "docs/architecture/agents.md"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
external_requires: []
```

## File Impact Map

| File | Action | Confidence |
|------|--------|-----------|
| kernel/src/agents/charter-tools.ts | modify (fill the empty part: three tools) | HIGH |
| kernel/src/agents/charter-files.ts | modify (`deferFiles`, `agent_updated`) | HIGH |
| kernel/test/agents-charter-tools.test.ts | create | HIGH |
| kernel/src/agents/index.ts | modify (header sentence; exports if needed) | HIGH |
| kernel/src/approvals/store.ts | modify (one doc comment paragraph) | HIGH |
| kernel/test/agents-foundation.test.ts | modify (charter-tools pin, Design 10) | HIGH |
| kernel/test/approvals.test.ts | modify (no_applier pin, Design 10) | HIGH |
| kernel/test/kernel-tools.test.ts | modify (shipped appliers pin, Design 10) | HIGH |
| kernel/test/agents-roster.test.ts | modify (`AGENT_AUDIT_KINDS` pin) | HIGH |
| docs/architecture/agents.md | modify (new section, create/events/limits) | HIGH |
| docs/architecture/approvals.md | modify (closed set sentence, refusal table) | HIGH |
| docs/ARCHITECTURE.md | modify (two lines) | MEDIUM |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every relative link in `docs/`; any link added to `agents.md` or `approvals.md` must resolve. `kernel/test/agents-roster.test.ts` reads `docs/architecture/agents.md` (`DOC`) for the pinned example blocks; `kernel/test/brain.test.ts` reads `docs/architecture/brain.md` (not touched).

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
| Feasibility (Phase 2.5): `createAgent` writes files inside the decision's transaction when called from an applier | MEDIUM | Design 3: `deferFiles` keeps the owner's create byte-identical and moves the applier's writes to `after`; AC 3 pins the self-heal. |
| The display is model-written text shown to the owner | MEDIUM | The enforced line and the limits line are generated by the kernel from the parsed charter, never copied from prose, and come first so the 4,000-character cut never hides them; the CLI escapes every line; the approval payload keeps the whole charter. |
| An update overwrites an owner's edit made after Wright read the file | HIGH | `expected_sha256` checked at hold and at apply, plus the byte re-read just before the rename (the `set` pattern); the remaining few-instruction window is documented as an honest limit. |
| The update's rename lands before the decision commits (Design 5) | MEDIUM | Chosen over `after`, which could record an applied change that never landed; the exact failure shape (new file, no event, approval pending, re-approve refused `config_changed`) is documented in `agents.md`'s honest limits. |
| Lane PRs for items 05 and 08 (same wave) conflict with this one | LOW | No shared file: item 05 touches `kernel/src/brain/*`, item 08 `kernel/src/playbooks/*`. Only `docs/ARCHITECTURE.md` may be shared; keep the edit to the two charter-tool lines. |
| A held update's `idempotency_key` reuse check reads approvals by JSON path | LOW | One query, same session and tool only; a test asserts a reused key is refused and a new key is held. |
| Wright's tools list already names `kernel_agent_list` (`kernel/src/brain/settings.ts`) but the tool did not exist | LOW | This item adds it; `kernel/test/brain.test.ts` pins only the names, unchanged. |

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
/supervisor job: .supervisor/jobs/pending/2026-10-19-wright-charter-tools-create-update-list.md
```

## Plan Review
- **Decision:** PASS (attempt 3/3; attempt 1 PASS with 1 MEDIUM fixed — update rename ordering/honest limit; attempt 2 PASS with 1 MEDIUM fixed — the `ensureAgentFiles` honest-limit bullet)
- **Deferred (no attempts left):** MEDIUM — `docs/architecture/agents.md` honest-limit bullet "Nothing enforces the settings yet." ends "Today the settings file is read by `list`, `show` and `set` only."; this item makes it false — the worker also names `kernel_agent_list` (reads) and `kernel_agent_update` (reads, then rewrites on approval) there. LOW — the "Self-heal." paragraph in `## Create, without half-creating` names the Wright create's `after` as an `ensureAgentFiles` caller.
- **Owner:** Save and exit

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-18T20:52:41Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/91
- **Branch:** feature/wright-charter-tools-create-update-list
- **Files changed:** 13
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Filled charterToolsPart with kernel_agent_create / kernel_agent_update (always held; the kernel applies the owner's once via applyOnApproval — createAgent by wright with deferFiles, files in after via ensureAgentFiles; sha-guarded temp+rename update with agent_updated) and read-only kernel_agent_list (sha256 of file bytes; Wright without hash). Heal: iter 1 FAIL (HIGH display cut could hide enforced lines; MEDIUM brain.md:127; MEDIUM untested re-read) fixed 4cbcb02; iter 2 PASS+MEDIUM (impossible remedy) fixed 3b4da17; iter 3 PASS+MEDIUM (updateFloor not tight) fixed 4ebd9e0 on the final iteration, not re-reviewed — the owned drain reviews it. 4 LOWs dismissed below the MEDIUM floor. Pre-flight OVERLAP with sibling PR #89 (owner: proceed; the two agents.md honest-limit bullets kept byte-unchanged). typecheck clean, vitest 1598 passed / 8 skipped, check-docs OK. risk_classification: high_risk true (agents/ paths; content token/auth matches; size 1748 lines). red_team_advisory: disabled.

## Not verified
- **A real Agent SDK session calling the three charter tools** — tests use fake sessions and the kernel's registered handlers only; no live session or model (subtask 1)
- **docs/architecture/brain.md tool-registration sentence (line 127)** — reported out of lane by the worker; since updated by the Phase 4.5 fix 4cbcb02 (subtask 1)
