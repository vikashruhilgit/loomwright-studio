# Supervisor Job: Draft mode records a draft-mode session's outward calls instead of sending them

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-27-114124/L5
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (item 06, the read-only GitHub tools, may be built in a parallel lane. This item only names those tools in a deny text and never imports them. See Risk Assessment.)
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095107-draft-mode-records-outward-calls-instead-of-sending-them.md
- **Base commit:** f3f2ee52e8ffb003922c5795ccbe917081fb8a37

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel. The change stays in `kernel/src/sessions/`, `kernel/src/integrations/drafts.ts`, tests and docs. |
| 2 | Dependency Availability | GO | Every seam exists on `main`. Migration 17 created `draft_outputs` (`kernel/src/store/migrations/017_phase_6_foundation.ts`). `ToolPolicy.mode` / `ToolPolicy.connectors` are filled by `#sessionPolicy` (`kernel/src/sessions/manager.ts:2794`). `draft_output_recorded` is already a thread event kind with its card (`kernel/src/console/threads.ts:79`, `:256-258`). The contract types `DraftOutput` / `DraftsQuery` / `DraftsResponse` / `DraftDetailResponse` and both routes are in `app/src/api/contract.ts:795-822`, `:880-881`. `draftsPart` is an empty part, already merged (`kernel/src/integrations/index.ts`). No new package. |
| 3 | Architecture Fit | GO | Mechanism only (invariant 1): `mode` is the user's field, and the kernel only enforces it. The deny is a fixed safety-kernel rule (invariant 3). Merge stays `merge_blocked` (invariant 4). The payload is stored as untrusted data. |
| 4 | Scope vs Supervisor Capability | GO | 13 files (11 modify, 2 create). One worker, no named split reason. |
| 5 | Hard Blockers | CAUTION | Every playbook is `draft` by default (migration 17 `DEFAULT 'draft'`), so a playbook session's outward call changes from held to `draft_mode`. `kernel/test/phase-3-exit.test.ts` steps 7-8 assert that a fire session's `gh pr comment` is held and then passes on an `always` grant. Its fixture must set that playbook to `live` (see Design decisions). |

**Overall Verdict:** CAUTION

## Task
**Goal:** In a session whose playbook `mode` is `draft`, every outward call the rail recognises is denied `draft_mode` without asking the owner, before any grant or hold. The call is stored as one `draft_outputs` row with one `draft_output_recorded` event. In a session whose agent holds the `github` grant, every Bash `gh` call is denied `use_kernel_github_tools`. The owner reads drafts through `GET /drafts` and `GET /drafts/:id`.

**Problem Statement:**
The owner needs a draft-mode playbook to record its would-be reviews and never send them, so they can judge real output before anything posts, and no planted instruction can make it post.
Today the policy ignores `ToolPolicy.mode` and `ToolPolicy.connectors` (`kernel/src/sessions/types.ts:81-93`, "The policy does not read it yet (phase 6 item 07)"). A draft session's `gh pr review` is held for approval (or let through by an `always` grant). Nothing records the would-be post. A GitHub-granted session can still run raw `gh`.
Success looks like this: a draft-mode `gh pr review 12 --approve --body "LGTM"` is denied `draft_mode` with no approval, one `draft_outputs` row holds the target `12` and the body `LGTM`, and one `draft_output_recorded` event exists. An `always` grant does not change that. `gh pr merge` stays `merge_blocked`. A granted session's `gh pr view 12` is denied `use_kernel_github_tools`. `GET /drafts?item=github:o/r%2312` returns that PR's drafts, newest first.

### Design decisions (made here, grounded)
- **Gate order** (`#gate` in `kernel/src/sessions/manager.ts:2516`). Steps 1-2 are unchanged, and the new steps 5-6 sit between the dry-run branch and the outward hold:
  1. the policy (`decideToolUse`);
  2. the rail, only after an allow (`classifyToolCall`). A rail deny (`protected_kernel_path`, `merge_blocked`, `bash_shell_metacharacter`, `bash_command_too_large`) still wins whatever the mode or grant (AC3);
  3. the never boundary, `agent_boundary` (unchanged, first for an outward call). The owner's explicit `never` for this agent wins over draft: a forbidden call is denied, not stored as a draft. Nothing is sent either way;
  4. the dry-run branch, `dry_run` would-do (unchanged). A dry run already denies every outward call and records it as a would-do. Draft after dry run keeps every `kernel/test/playbooks-dry-run.test.ts` pin unchanged (dry runs pass `playbook: row.id`, so they read `mode` `draft`, `kernel/src/playbooks/dry-run.ts:486`). Item 09 (a poll playbook's dry run, forced into draft) owns any reorder for its own runs;
  5. **new: draft mode**, `draft_mode`: `policy.mode === "draft"` and the rail answered `outward`. This is every outward kind, the `ALWAYS_HELD_TOOLS` and path labels included (requirement Scope 1: "every call the policy already classifies as outward"). It writes the row and event, never looks up a grant, never holds, never runs the pre-hold check;
  6. **new: the GitHub CLI deny**, `use_kernel_github_tools`: `policy.connectors` includes `github`, the tool is `Bash`, and the command's program could be `gh`. It applies whether or not the policy allowed the call (it only denies, so it never widens a policy, and the model learns which tools to use). It comes after draft, so a granted draft session's `gh pr review` is still recorded as a draft (the phase 6 exit flow);
  7. the outward hold or grant (unchanged);
  8. anything else, as the policy says (unchanged).
- **A non-draft session is unchanged.** `mode` is absent for a session with no playbook (a chat turn, an ask), and steps 5-6 are no-ops without `mode === "draft"` / a `github` grant (AC5).
- **`live` keeps today's behaviour.** A stored `live` (unreachable through the setter, refused `live_mode_not_in_phase_6`) skips step 5, so holds and grants apply as before. This is what lets `phase-3-exit.test.ts` keep its phase 3 always-grant walk with a direct-SQL `UPDATE playbooks SET mode = 'live'`.
- **Program detection for step 6** reuses the rail's reading: the first non-empty brace-expanded shell word, basename, case-folded, compared as a glob (`wordCouldBe`). So `gh`, `/usr/bin/gh`, `GH` and `g{h,x}` are caught. `env gh …`, `sh -c …` or a script are not (the rail's documented limit: allowing such a program grants what it can run). A policy-denied gh word with a metacharacter (`gh pr view 1 | cat`) is still split by `shellWords` and caught.
- **What the row holds** (`draft_outputs`, migration 17 columns):
  - `session`: the session id.
  - `agent`: the session's agent, or `unknown` for a session with none (the approvals rule, `docs/architecture/approvals.md:14`).
  - `playbook`: `sessions.playbook`.
  - `playbook_run` / `item_ref`: the newest `playbook_runs` row with `session_id` = the session (`ORDER BY id DESC LIMIT 1`), both null when none.
  - `tool`: the rail's `action` label (`gh pr review`, `gh pr comment`, `gh api POST`, `git push`, `kernel_playbook_enable`, …). It is more useful on the card than `Bash`, and `DraftOutput.tool` is "The tool or command the session called".
  - `payload_json`: the bounded payload below.
- **The payload** (`draftPayloadOf`, pure):
  - For `gh pr review` / `gh pr comment`: `{kind: "gh_pr_review" | "gh_pr_comment", tool: "Bash", command, cwd, target, body, body_file?, event?, truncated}`.
    - `target` is the first positional word after the subcommand that is not a flag or a flag's value, or null. Value flags are `-b`/`--body`, `-F`/`--body-file`, `-R`/`--repo`; `--body=…`-style and `-bVALUE` forms are read too.
    - `body` is the last `-b`/`--body` value, or null.
    - `body_file` is a `-F`/`--body-file` value, recorded but never read.
    - `event` is `approve` / `request_changes` / `comment`, from `-a`/`--approve`, `-r`/`--request-changes`, `-c`/`--comment` (review only).
  - For any other Bash call: `{kind: "command", tool: "Bash", command, cwd, truncated}`.
  - For any other tool: `{kind: "input", tool: <tool name>, input_json, cwd, truncated}`, where `input_json` is `JSON.stringify(input)`.
  - Every text field is cut to `MAX_DRAFT_TEXT_CHARS = 65536` with `truncated: true` when anything was cut. A Bash command is already at most `MAX_RAIL_COMMAND_LENGTH` (8192), so in practice only a tool's input is ever cut.
  - The payload is untrusted model output. It is stored as JSON text, never interpreted, and never put into an event.
- **The event** `draft_output_recorded` (session-tied, the thread tie `session`): `{draft_output_id, tool, summary}`, where `summary` = `` `${action}${target ? ` ${target}` : ""}` `` clipped to 200 characters (no body text). `threads.ts` already renders `{draft_output_id, tool}` (unchanged).
- **One transaction** writes the row, the draft event and the call's one `tool_decision` event (`reason: "draft_mode"`, plus `draft_output_id`). A throw rolls all of it back and the call is denied `kernel_gate_error` (fail closed, as for a hold). The deny is still a deny, and nothing is sent either way.
- **Deny texts** (exact, exported):
  - `draftDenyReason(id)`: `draft_mode: this playbook runs in draft mode, so the kernel did not send this call; it saved it as draft output ${id} for the owner to read. Nothing was posted. Do not retry it and do not ask for an approval.`
  - `GITHUB_CLI_DENY_REASON`: `use_kernel_github_tools: this agent reads GitHub through the kernel, so gh does not run in its sessions. Use kernel_github_pr_get, kernel_github_pr_diff, kernel_github_pr_files and kernel_github_pr_comments instead.`
- **Routes** (bearer token like every route; `drafts.ts`):
  - `GET /drafts[?agent=][&playbook=][&item=][&limit=]` → `{drafts}`, newest first (`ORDER BY id DESC`). Validation: `agent` and `item` are non-empty strings of at most 512 characters, `playbook` is a positive-integer text, `limit` is 1-200 (default 50). Anything else answers 400 `{error: "invalid_query", message}`. Paging is `limit` only, because the contract's `DraftsQuery` has no cursor field, and adding one is a contract change outside this item.
  - `GET /drafts/:id` → `{draft}`. A non-integer id answers 400 `invalid_query`, and no row answers 404 `{error: "no_draft"}`.
  - `DraftOutput.payload` is `JSON.parse(payload_json)`, or null if that throws. The row never holds a secret (the token lives only in the Keychain, and sessions get no `GH_TOKEN`), and the response carries exactly the contract keys.

## Acceptance Criteria
- [ ] AC1: Given a draft-mode session (a playbook session whose `playbooks.mode` is `draft`, policy allowing `gh pr review`), when it runs `gh pr review 12 --approve --body "LGTM"`, then the call is denied with reason `draft_mode` and the hook text `draftDenyReason(id)`, no `approvals` row exists, one `draft_outputs` row holds `tool` `gh pr review` and a payload with `target` `"12"`, `body` `"LGTM"`, `event` `"approve"`, and exactly one `draft_output_recorded` event `{draft_output_id, tool, summary}` and one `tool_decision` event (`reason: "draft_mode"`, `draft_output_id`) are appended.
- [ ] AC2: Given the same session's playbook holding an `always` grant for `gh pr comment` (and, separately, an unused once-approved grant for the exact payload), when it comments, then it's still denied `draft_mode` and recorded, no `approval_grant_used` event is written, and the once grant stays unused. One test per grant kind.
- [ ] AC3: Given a draft-mode session (with and without the `github` grant), when it runs `gh pr merge 12`, then it's denied `merge_blocked` as today, and no draft row is written (invariant 4).
- [ ] AC4: Given a session of an agent with the `github` grant, when it runs `gh pr view 12` (policy allowing `gh pr view`, and again with a policy that does not), then it's denied `use_kernel_github_tools` with `GITHUB_CLI_DENY_REASON` naming the four kernel tools. A session without the grant may still run it (`bash_prefix_allowed`). A granted draft-mode session's `gh pr comment 12 --body x` is recorded as a draft (`draft_mode`), not denied `use_kernel_github_tools`.
- [ ] AC5: Given a non-draft session without a playbook (a chat turn), then its holds and grants are unchanged. Every existing `kernel/test/sessions-policy.test.ts`, `kernel/test/sessions.test.ts`, `kernel/test/sessions-boundary.test.ts`, `kernel/test/approvals.test.ts`, `kernel/test/playbooks-dry-run.test.ts` and phase 3-5 test passes. The only changes to existing assertions are `phase-3-exit.test.ts`'s playbook set to `live` by direct SQL before step 7 (with a comment) and `integrations-foundation.test.ts`'s empty-part filter dropping `drafts`. Other existing test files only gain new cases. Its steps 7, 8 and 10 (`held as approval 2`, `approval_granted`, `held as approval 4` on the v4 fire) still pass on the hold and the `always` grant. `mode` is its own column, so it survives step 9's version bump, and `#sessionPolicy` reads it afresh at each session start. Checked at base: no other test runs a Bash `gh` call through a session granted `github` by `connectorsFor`, and `phase-3-exit-live.test.ts` asserts no hold.
- [ ] AC6: Given drafts for two items and two agents, when `GET /drafts?item=github:o/r%2312` is called, then only that PR's drafts return, newest first, each with exactly the `DraftOutput` keys, and the response text contains no planted token (a fake token present in the test's environment and connector setup). `agent` / `playbook` / `limit` filter as documented, an invalid value answers 400 `invalid_query`, `GET /drafts/:id` returns one draft, and an unknown id answers 404 `no_draft`.
- [ ] AC7: Given a crew member whose `never` includes `gh_pr_review` running a draft-mode session, when it runs `gh pr review 12 --approve`, then it's denied `agent_boundary` and no draft row is written. Given a dry-run session of a draft playbook, then its `gh pr comment` is a `dry_run` would-do with no draft row (the order of steps 3-5 is pinned).
- [ ] AC8: Given a draft-mode `kernel_playbook_enable` call (an always-held tool) or a Write to `~/.claude/settings.json` from a draft-mode session, then each is denied `draft_mode` with a draft row whose payload is `{kind: "input", …}`, never held. Given a tool input whose JSON is longer than `MAX_DRAFT_TEXT_CHARS`, then `input_json` is cut to that length and `truncated` is `true`.
- [ ] AC9: Given the last write of the draft transaction throws (the test creates `CREATE TRIGGER t BEFORE INSERT ON events WHEN NEW.kind = 'tool_decision' AND json_extract(NEW.payload_json, '$.reason') = 'draft_mode' BEGIN SELECT RAISE(ABORT, 'test'); END`), then the call is denied `kernel_gate_error` (that fallback decision is still recorded), and no `draft_outputs` row and no `draft_output_recorded` event remain (rolled back). A second test drops the `draft_outputs` table: the call is still denied `kernel_gate_error`. Both tests drop or undo their change before the store is closed, because the store's integrity check refuses unlisted SQL triggers on open.
- [ ] AC10: Given the docs, then `docs/architecture/draft-mode.md` documents the field, the deny order (under a new `## Deny order` heading) (never → dry run → draft → GitHub CLI deny → hold), what's recorded (row columns, payload kinds, bound, event), the `gh` deny for granted sessions with its limit (`env gh` / scripts not recognised), the routes, and that `live` is refused in phase 6. Its "Today (the phase 6 foundation)" paragraph is replaced. `docs/architecture/approvals.md`'s rail list and `tool_decision` row name `draft_mode` and `use_kernel_github_tools`. `docs/ARCHITECTURE.md:241` no longer says the policy ignores both.
- [ ] AC11: `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.

## File Impact Map

| Path | Lines at base | Action | Confidence | Home / why |
|------|---------------|--------|------------|------------|
| `kernel/src/sessions/draft-mode.ts` | — | CREATE | HIGH | Home of the new pure decisions: `draftDecision(policy, rail)`, `githubCliDecision(policy, toolName, toolInput)`, `draftPayloadOf(toolName, toolInput, rail)`, `draftDenyReason`, `GITHUB_CLI_DENY_REASON`, `MAX_DRAFT_TEXT_CHARS`, the `DraftPayload` type. It was created because `policy.ts` (1094) is past the module-layout threshold. It imports only from `./policy.js` and `./types.js` (no I/O). |
| `kernel/src/sessions/policy.ts` | 1094 | MODIFY | HIGH | Wiring only (1094; the closed reason union's single home): `ToolDecisionReason` gains `"draft_mode"` and `"use_kernel_github_tools"` with doc lines, plus one exported helper `programCouldBe(command, name)` (the rail's program reading via the private `wordCouldBe` / `braceExpand`), so the matcher has one home. |
| `kernel/src/sessions/manager.ts` | 2886 | MODIFY | HIGH | Wiring only (2886; `#gate` is the single gate): steps 5-6 in `#gate`, the draft-row transaction through `recordDraftOutput`, `toolDecisionPayload`'s `draft_output_id`, the hook texts, the `#gate` and `#sessionPolicy` doc comments ("The policy reads neither yet" removed). |
| `kernel/src/sessions/types.ts` | 586 | MODIFY | HIGH | Comment-only (586): the `mode` / `connectors` doc lines say what the gate does with them now. |
| `kernel/src/integrations/drafts.ts` | 17 | MODIFY | HIGH | `recordDraftOutput(store, input, at)` (row + `draft_output_recorded` event, within the caller's transaction), `listDrafts`, `getDraft`, `draftView`, the two routes, and `draftsPart.routes`. It stays CLI-safe: it imports types, `../loop/internal.js` (`appendEvent`, `clip`) and the feature seam, never the session manager. |
| `kernel/test/draft-mode.test.ts` | — | CREATE | HIGH | AC1-AC4, AC6-AC9 (the requirement's named file), through `SessionManager` with `fakeSessions` / `startParams` (`kernel/test/session-fakes.ts`) and the `sessions-boundary.test.ts` gate pattern, plus the routes through `draftsPart.routes` handlers. |
| `kernel/test/sessions-policy.test.ts` | 368 | MODIFY | HIGH | Pure unit tests for `draftDecision`, `githubCliDecision`, `programCouldBe`, and `draftPayloadOf`'s parse cases (`--body=`, `-bX`, `-F file`, `-R o/r`, event flags, cut). It is under the threshold and named in the requirement. |
| `kernel/test/integrations-foundation.test.ts` | 846 | MODIFY | HIGH | The pin `part %s is still empty` drops `drafts` from its filter (it keeps `github-tools` unless item 06 already filled it), and one new case pins `draftsPart`'s two routes (`GET /drafts`, `GET /drafts/:id`) with no tools, subcommands, handlers or due work. |
| `kernel/test/phase-3-exit.test.ts` | 638 | MODIFY | HIGH | Before step 7, `UPDATE playbooks SET mode = 'live' WHERE id = ?` with a comment: the phase 3 walk proves holds and `always` grants, and draft (the phase 6 default) would record the comment instead (pinned in `draft-mode.test.ts`). |
| `docs/architecture/draft-mode.md` | 16 | MODIFY | HIGH | AC10. |
| `docs/architecture/approvals.md` | 260 | MODIFY | HIGH | The rail list (steps 5-6 plus the new draft and GitHub-CLI steps, renumbered) and the `tool_decision` row's reasons (AC10). |
| `docs/ARCHITECTURE.md` | 278 | MODIFY | HIGH | One line, `:241` (AC10). |
| `kernel/src/integrations/index.ts` | 84 | MODIFY | MEDIUM | The header comment says `drafts` is still empty, so it gets a comment update, plus re-exports of `recordDraftOutput`, `listDrafts`, `getDraft` if the manager or tests import through the index. |

## Touched-file invariants

> Grounded at base `f3f2ee52e8ffb003922c5795ccbe917081fb8a37`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/policy.ts`**
  - keep: `decideToolUse` and `classifyToolCall` unchanged (`// The rail applies only after the policy allowed: it never widens a policy.`, in the manager); the module stays a leaf (`Kept here as literals so this module stays a leaf`), and the new helper uses only existing private functions; `NEVER_CATEGORIES` and `neverCategoriesOf` unchanged (no new category: draft is a mode, not a never category).
  - pinned by: `kernel/test/sessions-policy.test.ts` (`expect(ALWAYS_HELD_TOOLS).toEqual(`, the `NEVER_CATEGORIES and boundaryDecision` block), `kernel/test/approvals.test.ts` (the rail's literal pins).
- **`kernel/src/sessions/manager.ts`**
  - keep: the order "The never boundary is read first for an outward call: before the dry-run branch and any hold or grant"; exactly one `tool_decision` event per call; the fail-closed catch (`reason = "kernel_gate_error";`, with every new per-call variable reset in it as `category` is); "No tool runs without a recorded kernel decision"; the hold path's single transaction (`holdOrUseGrant` and its `tool_decision` in one `this.#store.transaction`); `#sessionPolicy` stays the only place `mode` / `connectors` are set (a caller's value is dropped).
  - mirror: `toolDecisionPayload`'s key set, read by `kernel/src/console/output.ts` and `docs/architecture/approvals.md:256`.
  - pinned by: `kernel/test/sessions.test.ts` (`kernel_playbook_enable is always held`), `kernel/test/sessions-boundary.test.ts`, `kernel/test/playbooks-dry-run.test.ts` (`wouldDo: [{ tool: "Bash", input_summary: COMMENT, would: "held", reason: "dry_run", action: "gh pr comment" }]`), `kernel/test/phase-3-exit.test.ts`, `kernel/test/phase-4-exit.test.ts` (mason's ask session: `{ tool: "Bash", decision: "deny", reason: "agent_boundary", command: PUSH, category: "git_push", tool_use_id: "toolu_1" }`, not a playbook session, so unchanged).
- **`kernel/src/integrations/drafts.ts`**
  - keep: the CLI-safe import rule (`never the Agent SDK, the session manager or \`kernel.ts\``); the part's name `"drafts"` and its position last in `INTEGRATIONS_PARTS`; claims no handler kind (`integrationsContribution` must not throw).
  - pinned by: `kernel/test/feature-seams.test.ts` (`the feature registry's module graph (AC9)`, `SDK_IN_GRAPH`), `kernel/test/integrations-foundation.test.ts` (`merges its four parts in a fixed order`), `kernel/test/console-contract.test.ts` (the route list `{ method: "GET", path: "/drafts", origin: "p6-item-07" }`, unchanged).
- **`kernel/src/console/threads.ts`** (read, not modified)
  - mirror: the event payload `{draft_output_id, tool}` (`isId(p.draft_output_id)`, `isText(p.tool)`); `draft_output_recorded: "session"`.
  - pinned by: `kernel/test/console-threads.test.ts:366-396`.
- **`kernel/test/phase-3-exit.test.ts`**
  - keep: every assertion unchanged. The only addition is the `mode = 'live'` SQL line before step 7 and its comment. It covers steps 7, 8 and 10 (`held as approval 2`, `approval_granted`, `held as approval 4`), because `playbooks.mode` is a separate column that step 9's `token_limit` version bump does not touch.

## Closed enumerations touched

> Sibling grep at base `f3f2ee52e8ffb003922c5795ccbe917081fb8a37`: `grep -rln "agent_boundary" --exclude-dir=node_modules --exclude-dir=.supervisor .` → 21 files (src: `policy.ts`, `manager.ts`, `types.ts`; docs: `approvals.md`, `ARCHITECTURE.md`, `dry-run.md`, `playbook-runs.md`, `OPEN_QUESTIONS.md`, two runbooks, two evidence JSONs; tests; `app/e2e/phase-5-exit.spec.ts`).

- **`draft_mode`, `use_kernel_github_tools`** (sibling: `agent_boundary`). Must be named in:
  - `kernel/src/sessions/policy.ts`: the closed union `export type ToolDecisionReason =`, extended. (`GateReason` in `manager.ts:114` is `ToolDecisionReason | …`, so it follows with no edit.)
  - `docs/architecture/approvals.md:256`: the `tool_decision` row's reason list, extended.
  - The other hits need no change. Tests, runbooks and evidence assert specific `agent_boundary` denies. `kernel/src/console/output.ts` copies a decision's payload whole, with no reason allow-list (`copies an agent_boundary deny's category whole`). `app/e2e/phase-5-exit.spec.ts` asserts a phase 5 walk. `dry-run.md` and `playbook-runs.md` describe the boundary only.
- **`draft_output_recorded`**: already in the closed `THREAD_EVENT_KINDS` (`kernel/src/console/threads.ts:79`). No change.
- **Draft payload `kind`** (`gh_pr_review`, `gh_pr_comment`, `command`, `input`): new, closed in `draft-mode.ts` as `DRAFT_PAYLOAD_KINDS`. There is no other list.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/draft-mode.test.ts` — AC1 (draft denies `draft_mode` and writes one row) | flip `policy.mode === "draft"` → `policy.mode === "live"` in `kernel/src/sessions/draft-mode.ts` |
| `kernel/test/draft-mode.test.ts` — AC1 / AC2 order pin (with the draft branch skipped, the draft call reaches the unchanged hold branch: AC1's call is held, AC2's `always` grant writes `approval_grant_used` and the once grant is consumed, which is the requirement's named hold-before-draft regression) | flip `} else if (draft?.kind === "draft") {` → `} else if (false) {` in `kernel/src/sessions/manager.ts` |
| `kernel/test/draft-mode.test.ts` — AC1 (the body is recorded) | flip `body = value;` → `body = null;` in `kernel/src/sessions/draft-mode.ts` |
| `kernel/test/draft-mode.test.ts` — AC1 (one `draft_output_recorded` event) | flip `const DRAFT_EVENT_KIND = "draft_output_recorded";` → `const DRAFT_EVENT_KIND = "draft_output_noted";` in `kernel/src/integrations/drafts.ts` (the append uses the constant) |
| `kernel/test/draft-mode.test.ts` — AC7 (dry run before draft: a dry-run comment is a would-do with no draft row) | flip `} else if (dry?.kind === "would_do") {` → `} else if (dry?.kind === "would_do" && draft === undefined) {` in `kernel/src/sessions/manager.ts` |
| `kernel/test/draft-mode.test.ts` — AC9 (fail closed: a draft write that throws leaves no draft event and denies `kernel_gate_error`) | flip `const recorded = this.#store.transaction(() => {` → `const recorded = ((fn: () => DraftRecord) => fn())(() => {` in `kernel/src/sessions/manager.ts` (no rollback: with the trigger case, the row and the `draft_output_recorded` event written before the failing `tool_decision` append survive) |
| `kernel/test/draft-mode.test.ts` — AC6 (exactly the contract keys, no planted secret) | flip `return { id: row.id, session: row.session,` → `return { ...row, secret_probe: process.env.GH_TOKEN ?? null, id: row.id, session: row.session,` in `kernel/src/integrations/drafts.ts` (`draftView`) |
| `kernel/test/draft-mode.test.ts` — AC4 (an ungranted session's `gh pr view` still runs) | flip `(policy.connectors ?? []).includes("github")` → `true` in `kernel/src/sessions/draft-mode.ts` |
| `kernel/test/draft-mode.test.ts` — AC3 (merge stays blocked) | flip `if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };` → `if (false) return { kind: "deny", reason: "merge_blocked" };` in `kernel/src/sessions/policy.ts` |
| `kernel/test/draft-mode.test.ts` — AC4 (granted session's `gh pr view` denied) | flip `(policy.connectors ?? []).includes("github")` → `false` in `kernel/src/sessions/draft-mode.ts` |
| `kernel/test/draft-mode.test.ts` — AC4 (a granted draft session's comment is a draft, not a gh deny) | swap order: flip `} else if (draft?.kind === "draft") {` → `} else if (draft?.kind === "draft" && githubCli === undefined) {` in `kernel/src/sessions/manager.ts` |
| `kernel/test/draft-mode.test.ts` — AC7 (never wins over draft) | flip `if (boundary?.kind === "boundary") {` → `if (boundary?.kind === "boundary" && draft === undefined) {` in `kernel/src/sessions/manager.ts` |
| `kernel/test/draft-mode.test.ts` — AC6 (newest first) | flip `ORDER BY id DESC LIMIT ?` → `ORDER BY id ASC LIMIT ?` in `kernel/src/integrations/drafts.ts` (`listDrafts`; the run lookup lives in the manager, see the notes) |
| `kernel/test/draft-mode.test.ts` — AC8 (the cut; the test uses a fixed 70000-character input, and asserts `MAX_DRAFT_TEXT_CHARS === 65536` separately) | flip `text.slice(0, MAX_DRAFT_TEXT_CHARS)` → `text` in `kernel/src/sessions/draft-mode.ts` |
| `kernel/test/sessions-policy.test.ts` — `programCouldBe` (`/usr/bin/gh` caught; case-folding has its own case: `GH pr view 1`) | flip `wordCouldBe(basename(program), name)` → `wordCouldBe(program, name)` in the new `programCouldBe` in `kernel/src/sessions/policy.ts` (`wordCouldBe` already case-folds, so no `.toLowerCase()` is written) |

The worker writes the code so each left-hand literal above appears exactly once in the named file (the brief prescribes these spellings: `draft` / `githubCli` are the gate's locals for the step 5 and step 6 answers).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Draft mode: draft deny + record, GitHub CLI deny, drafts routes, docs | all | 11 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Draft mode (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/sessions/draft-mode.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/draft-mode.ts", name: "draftDecision"}
  - {kind: "symbol", path: "kernel/src/sessions/draft-mode.ts", name: "githubCliDecision"}
  - {kind: "symbol", path: "kernel/src/sessions/draft-mode.ts", name: "draftPayloadOf"}
  - {kind: "symbol", path: "kernel/src/sessions/draft-mode.ts", name: "draftDenyReason"}
  - {kind: "symbol", path: "kernel/src/sessions/draft-mode.ts", name: "GITHUB_CLI_DENY_REASON"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "programCouldBe"}
  - {kind: "type", path: "kernel/src/sessions/policy.ts", name: "ToolDecisionReason"}
  - {kind: "symbol", path: "kernel/src/integrations/drafts.ts", name: "recordDraftOutput"}
  - {kind: "symbol", path: "kernel/src/integrations/drafts.ts", name: "listDrafts"}
  - {kind: "symbol", path: "kernel/src/integrations/drafts.ts", name: "draftsPart"}
  - {kind: "file", path: "kernel/test/draft-mode.test.ts"}
  - {kind: "symbol", path: "docs/architecture/draft-mode.md", name: "Deny order"}
requires: []
lanes:
  - "kernel/src/sessions/draft-mode.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/integrations/drafts.ts"
  - "kernel/src/integrations/index.ts"
  - "kernel/test/draft-mode.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/phase-3-exit.test.ts"
  - "docs/architecture/draft-mode.md"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "Item 06's four kernel GitHub tool names (named in GITHUB_CLI_DENY_REASON as plain text; not imported)"
```

### Implementation notes for the worker
- `manager.ts` imports `recordDraftOutput` from `../integrations/drafts.js` (the manager is not loaded by the CLI, so this edge is allowed; `drafts.ts` must not import back).
- In `#gate`: compute `draft = rail.kind === "outward" ? draftDecision(live.policy, rail) : undefined` and `githubCli = githubCliDecision(live.policy, input.tool_name, input.tool_input)` next to `boundary`. Branch order: `boundary` → `dry?.kind === "would_do"` → `draft?.kind === "draft"` (a transaction: `recordDraftOutput`, then the `tool_decision` event appended inside, then return the hook output directly as the hold path does) → `githubCli !== undefined` (deny, recorded below) → `rail.kind === "outward"` (hold) → else. A rail `deny` happens before all of these: `boundary`/`draft` are only computed for `outward`, and `githubCli` is checked only when `rail.kind !== "deny"`.
- The `playbook_runs` lookup (`SELECT id, item_ref FROM playbook_runs WHERE session_id = ? ORDER BY id DESC LIMIT 1`) and the agent read live in the manager (a private `#draftContext(sessionId)`), and run inside the draft transaction. `recordDraftOutput` receives `{session, agent, playbook, playbookRun, itemRef, tool, payload}` and does no lookup, so `drafts.ts` holds `ORDER BY id DESC LIMIT ?` exactly once.
- Gate branch spelling (for the pin rows): `} else if (dry?.kind === "would_do") {`, then `} else if (draft?.kind === "draft") {` (its body is `const recorded = this.#store.transaction(() => {` … `});`, returning a `DraftRecord` `{id}`), then `} else if (githubCli !== undefined) {`, then the hold branch exactly as at base (`} else if (rail.kind === "outward") {`, unguarded, so every outward call that no earlier branch caught is held, never falls to an allow). The new locals are reset in the catch as `category` is.
- `drafts.ts` declares `const DRAFT_EVENT_KIND = "draft_output_recorded";` and passes it to `appendEvent`. `draftView(row)` builds the contract object key by key, starting `return { id: row.id, session: row.session,`.
- Tests start a playbook session with `startParams(cwd, { playbook: id, playbookVersion: 1, policy })` after inserting a `playbooks` row (mode defaults to `draft`), and pass `connectorsFor: () => ["github"]` to the `SessionManager` options for the granted cases. No network, no real `gh`.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/sessions/policy.ts:218-233` | yes | HOLDS | `export const NEVER_CATEGORIES = Object.freeze([` | base f3f2ee5 |
| `kernel/src/sessions/policy.ts:5-27` | yes | HOLDS | `export type ToolDecisionReason =` | base f3f2ee5 |
| `kernel/src/sessions/policy.ts:453` | yes | HOLDS | `if (forms[0] === "merge") return { kind: "deny", reason: "merge_blocked" };` | base f3f2ee5 |
| `kernel/src/sessions/manager.ts:2546-2553` | yes | HOLDS | `const boundary = rail.kind === "outward" ? boundaryDecision(live.policy, rail) : undefined;` | base f3f2ee5 |
| `kernel/src/sessions/manager.ts:2794-2811` | yes | HOLDS | `#sessionPolicy(policy: ToolPolicy, agent: string \| null, playbook: number \| null): ToolPolicy {` | base f3f2ee5 |
| `kernel/src/sessions/types.ts:81-93` | yes | HOLDS | `The policy does not read it yet (phase 6 item 07).` | base f3f2ee5 |
| `kernel/src/console/threads.ts:256-258` | yes | HOLDS | `if (row.kind === "draft_output_recorded") {` | base f3f2ee5 |
| `kernel/test/phase-3-exit.test.ts:530-550` | yes | HOLDS | `approval_required: held as approval 2;` … `permissionDecisionReason: "approval_granted"` | base f3f2ee5 |
| `kernel/src/playbooks/dry-run.ts:486` | yes | HOLDS | `playbook: row.id,` | base f3f2ee5 |
| `docs/architecture/approvals.md:18-41` | yes | HOLDS | `The kernel's one \`PreToolUse\` hook decides every call in order:` | base f3f2ee5 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): draft is the default mode, so every playbook session's outward call changes from held to `draft_mode`. `phase-3-exit.test.ts` steps 7-8 (and the env-gated `phase-3-exit-live`, if re-run) assert the old hold and `always` grant. | MEDIUM | The fixture sets `mode = 'live'` by direct SQL with a comment (AC5), so the phase 3 walk still proves holds and grants. The PR body names the behaviour change, and `draft-mode.md` states that a stored `live` keeps today's rail. |
| A deny-order regression lets a grant through (requirement Risks) | HIGH | AC2 has one test per grant kind (once and always), and the pin mutations cover the draft branch's position and its precedence over the hold. |
| Order choices made here: never before draft, and dry run before draft | MEDIUM | Grounded in the gate's "never boundary is read first" and in the dry-run pins. Both are pinned by AC7 and documented. Item 09 owns forcing its dry run into draft. |
| Item 06 (parallel or later) also edits `integrations-foundation.test.ts:164` (the `github-tools`/`drafts` empty-part pin) and may rename its tools | LOW | The change is one filter line, so a merge conflict is trivial. The deny text names the four tools from the owner's decision ("`kernel_github_pr_get`, `kernel_github_pr_diff`, `kernel_github_pr_files`, `kernel_github_pr_comments`"). |
| `env gh …`, `sh -c`, or a script bypasses the `gh` deny for a granted session | LOW | It is the rail's existing documented limit (allowing such a program grants what it runs), and it is stated in `draft-mode.md`. The owner's policy chooses the prefixes. |
| A tool call arrives before the run's `session_id` is written, so `playbook_run` / `item_ref` are null | LOW | Both columns are nullable by design. The row still has `session` and `playbook`, and the docs state it. |
| `GET /drafts` paging is `limit` only | LOW | The contract has no cursor field. Stated in the docs, and a follow-up can add `before`. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-28-draft-mode-records-outward-calls.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-28T10:14:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/150
- **Branch:** feature/draft-mode-records-outward-calls
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Draft-mode playbook sessions now deny every outward call with draft_mode and record one draft_outputs row + draft_output_recorded event in the tool_decision's transaction; github-granted sessions get Bash gh denied use_kernel_github_tools; GET /drafts and GET /drafts/:id added; docs updated. Phase 4.5 iteration 1 found one HIGH (unbounded quadratic parse of oversize policy-denied commands in githubCliDecision — kernel DoS), fixed in 4834ba3 (oversize denied unread, programCouldBe stops at the program word); iteration 2 PASS. 5 LOW/nit/drift findings dismissed below the MEDIUM floor (PR comment). Pin-mutation runner unsupported for vitest (15 unverified); reviewers applied all 15 by hand, all caught. tsc clean, 2304 tests pass, CI green. Risk classified high (token/secret/auth/migration content, 1211 lines); red-team lens not enabled. Review drain not dispatched (.auto_review false — owned by /automate).
