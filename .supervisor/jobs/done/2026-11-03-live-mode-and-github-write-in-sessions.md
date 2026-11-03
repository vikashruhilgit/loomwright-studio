# Supervisor Job: Live mode and GitHub write in sessions (phase 8 item 04)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L4
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (disk 91% used, 41 GiB free: enough for one worktree)
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160004-live-mode-and-github-write-in-sessions.md
- **Base commit:** 0a41b7ef528a2194874e1bbe5128c3855d2f8abe

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest; every change is in existing kernel modules. |
| 2 | Dependency Availability | CAUTION | Item 03's `mintSessionToken` runs in parallel (lane L3) and is not on `main`. Owner decision (2026-11-03): define a port now, fail closed, wire item 03's function in a later follow-up item. |
| 3 | Architecture Fit | GO | Mechanism only: the safety kernel, the rail and `merge_blocked` are unchanged (invariants 3 and 4). |
| 4 | Scope vs Supervisor Capability | CAUTION | 25 files (16 Touches plus 9 the owner approved), past the context bound, so the work is split into 2 sequential subtasks. |
| 5 | Hard Blockers | GO | gh 2.102.0 and git 2.55.0 were probed locally on 2026-11-03, results below. |

**Overall Verdict:** CAUTION

**Probes run by Launch Pad (2026-11-03, gh 2.102.0, git 2.55.0):**
- With `GH_TOKEN`/`GITHUB_TOKEN` unset and `GH_CONFIG_DIR` pointing at a directory whose `hosts.yml` holds `github.com: {oauth_token: <t>, user: x-access-token, git_protocol: https}`, `gh auth token` printed `<t>` and `gh auth status` reported the account from that `hosts.yml`. It did not fall back to the owner's keychain login.
- `git credential fill` under `GIT_CONFIG_COUNT=2`, with `GIT_CONFIG_KEY_0=credential.helper`/`GIT_CONFIG_VALUE_0=` (empty, which resets the helper list) and `KEY_1=credential.helper`/`VALUE_1=!f() { test "$1" = get || exit 0; echo username=x-access-token; printf 'password=%s\n' "$(cat '<dir>/token')"; }; f`, returned the token from the file even though the global `credential.helper` is `cache`.

## Owner decisions taken in this Launch Pad (2026-11-03, binding for this brief)
- **"File-backed, no GH_TOKEN (Recommended)".** A running process's environment cannot change, so a `GH_TOKEN` set at spawn would go stale after the one-hour expiry. Instead the kernel writes the token to a 0600 file in a 0700 per-session directory. `gh` reads it through `GH_CONFIG_DIR/hosts.yml`, git reads it through an env-scoped credential helper, a re-mint rewrites both in place, and the directory is deleted when the session ends. No `GH_TOKEN` is set. AC2 below is reworded to match. The docs record this as a deviation from D39's literal "passes it as `GH_TOKEN`"; the D39 text itself is amended by the follow-up item, because `docs/DECISIONS.md` is outside Touches.
- **"Port now, wire later (Recommended)".** This item defines the `SessionTokenMint` port. While none is wired, a live session with the write grant is refused `github_token_unavailable` (fail closed). Wiring item 03's `mintSessionToken` into `kernel/src/kernel.ts` is a follow-up item, not this one.
- **"Extend with all 9 (Recommended)".** Touches gains `kernel/src/sessions/types.ts`, `kernel/src/kernel.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/phase-8-foundation.test.ts`, `kernel/test/playbooks-drafts.test.ts`, `kernel/test/playbooks-drafts-poll.test.ts`, `docs/ARCHITECTURE.md`, `docs/architecture/playbooks.md` and `docs/OPEN_QUESTIONS.md`. No other file may be edited. A worker that needs another file stops and says so.

## Task
**Goal:** Let the owner set a playbook `live`, grant an agent `github: write`, and have the kernel give exactly those live, write-granted sessions a down-scoped, refreshable GitHub token, with `gh` allowed there, while the rail, the approval gate and `merge_blocked` stay unchanged.

**Problem Statement:**
The owner needs Studio's live playbooks (and `/automate` in kernel sessions) to push and open PRs, because phase 8's acceptance test turns tickets into PRs.
Currently every playbook is `draft` (`live` is refused `live_mode_not_in_phase_6`), every session's environment is stripped of GitHub tokens, a session with the `github` grant is denied any `gh` call (`use_kernel_github_tools`), and `connectors: {github: "write"}` is refused `github_write_not_built`. So nothing can write to GitHub from a kernel session.
Success looks like this: a live, write-granted session gets a down-scoped token that is re-minted before expiry. Its pushes and gh writes are held, or covered by the owner's always grant. `gh pr merge` stays `merge_blocked`. Every other session is unchanged.

## Acceptance Criteria
- [ ] AC1: Given a playbook whose current version has a `done` dry run and whose enable the owner approved (status `enabled` at that version), when the owner sets `mode live` (`setPlaybookPolicy`, `POST /playbooks/:id/set`, `studio playbooks set <id> mode live`), then it is stored (`mode_set_by = 'owner'`) as the next version, which by the existing versioning rule returns the playbook to `draft`, so it runs live only after that version's own dry run and held enable. Given a playbook that is not enabled with a done dry run at its current version, the owner's `live` is refused `live_needs_enable`. Given Wright or a crew member gives `mode: "live"` on create or update, it is refused `live_mode_owner_only` and nothing is written. `live_mode_not_in_phase_6` no longer exists in `kernel/src`, and the owner may always set `mode draft`. Re-setting `mode live` when the stored value is already owner-set `live` is the existing no-op (`changed: false`, no version, no refusal): the `unchanged` short-circuit in `setPlaybookPolicy` runs before the `live_needs_enable` check.
- [ ] AC2: Given an agent's settings file with `connectors: {github: "write"}` (written by the owner through `POST /agents/:id/set` `{field: "connectors", value: "github:write"}` or `studio agents set <id> connectors github:write`), then `readAgentSettings` reads it ok with `connectors: ["github"]` and `githubWrite: true`, the array form `["github"]` reads as before with no write, `{github: "read"}` and any other object form stay refused, and `github_write_not_built` no longer exists in `kernel/src`. Given a live playbook session (not a dry run) whose agent holds `github: write` and whose playbook's linked poll trigger names repos, then its spawn env carries `GH_CONFIG_DIR` (whose `hosts.yml` holds the minted, down-scoped token), `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` (an env-scoped credential helper reading the session's token file) and `GIT_TERMINAL_PROMPT=0`, and no `GH_TOKEN`. A draft session, a dry run, a chat session and a session of an agent without the write grant carry none of these, and their credential strip is unchanged.
- [ ] AC3: Given that live, write-granted session, when it runs `gh pr view 1`, then it is not denied `use_kernel_github_tools`. When it runs `git push origin feature`, then it is held `approval_required`, or allowed `approval_granted` by the owner's existing per-playbook-version always grant. When it runs `gh pr merge 1` (any form), then it is denied `merge_blocked`. The agent's `never` still wins (`agent_boundary`).
- [ ] AC4: Given the mint fails, or no minter is wired, or the playbook names no repos, then `startSession` rejects with `SessionError("github_token_unavailable")` before any spawn, one `session_refused` event `{reason: "github_token_unavailable", detail}` is appended, no token directory exists, and the env never names `GH_TOKEN` or a stored gh login. A resume that fails to mint is refused the same way, on the session's id, with the row unchanged.
- [ ] AC5: Given a live, write-granted session still running at `expires_at - GITHUB_TOKEN_REMINT_MARGIN_MS`, then the kernel mints again and atomically rewrites the token file and `hosts.yml` (temp file + rename), so a fresh token is in place before the old one expires. When the session ends (any terminal status, or `reapOrphans` reaping it), the re-mint timer is cleared and the session's token directory is removed. The token never appears in an event, a log or a row.
- [ ] AC6: Given the docs, then `docs/architecture/draft-mode.md` describes the live branch (no `use_kernel_github_tools` in a live, write-granted session, the file-backed token, `merge_blocked` unchanged), `approvals.md` says live outward calls are held or covered by the existing always grant, `agents.md` documents the `github: write` level and `github:write` on `set`, `playbooks.md` and `ARCHITECTURE.md` no longer say `live` or the write grant is refused, and `docs/OPEN_QUESTIONS.md` records (a) the known limit that a script the session runs can use the token within its down-scope, unseen by the rail, and (b) Launch Pad's 2026-11-03 gh/git probe results above. `bash scripts/check-docs.sh` passes.

## Touched-file invariants

> Grounded at base `0a41b7ef528a2194874e1bbe5128c3855d2f8abe`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/playbooks/store.ts`**
  - keep: every policy path calls the one check (`export function checkPolicyValue(field: PlaybookPolicyField, value: unknown, allowClear: boolean): ColumnValue`).
  - keep: an agent can never overwrite the owner's value (`the owner set this value; only the owner can change it`).
  - keep: a version-making change returns an `enabled` playbook to `draft` (`const status = row.status === "enabled" ? "draft" : row.status;`).
  - mirror: the route maps any other `PlaybookError` code to 409 (`return { status: 409, body: { error: err.code, message: err.message } };` in `kernel/src/playbooks/drafts.ts`), so the new codes surface as 409 without editing drafts.ts.
  - pinned by: `kernel/test/integrations-foundation.test.ts` (`live_mode_not_in_phase_6`), `kernel/test/playbooks-drafts.test.ts` (`studio playbooks set: live_mode_not_in_phase_6`), `kernel/test/playbooks-drafts-poll.test.ts` and `kernel/test/phase-8-foundation.test.ts`. Rewrite each to the new behaviour; never delete the refusal assertions.
- **`kernel/test/draft-mode.test.ts`**
  - keep: every existing assertion, including the draft-mode deny (`denies a draft-mode gh pr review draft_mode and records one row and one event, with no approval`), the deny that wins over grants (`an always grant for gh pr comment is not used: the call is still denied draft_mode and recorded`), and the `use_kernel_github_tools` deny for a `github`-granted policy without `githubWrite`.
  - add: only the live+write cases (`githubWrite: true` exempts `gh`; a draft or dry-run policy with `githubWrite` absent is still denied).
- **`kernel/test/sessions-policy.test.ts`**
  - keep: every existing rail assertion, including `["Bash", { command: "git push origin main" }, "git push", ["git_push"]],` and `merge_blocked` for every `gh pr merge` form. The rail code (`kernel/src/sessions/policy.ts`) is not in lanes and must not change.
  - add: only cases showing that a live+write policy gets the same rail answers (`git push` outward, `gh pr merge 1` `merge_blocked`).
- **`kernel/src/playbooks/types.ts`**
  - keep: `export const PLAYBOOK_MODES = Object.freeze(["draft", "live"] as const);` unchanged.
  - update: the doc comment naming `live_mode_not_in_phase_6`.
- **`kernel/src/playbooks/enable.ts`** (no change expected)
  - keep: `if (latestDryRun(store, row.id, row.version) === null) throw new EnableRefused("no_dry_run"`.
  - Because an enable already needs a done dry run at the version it enables, AC1's `live_needs_enable` check in `setPlaybookPolicy` reads only `row.status === "enabled"` (at the current version, which an enable pins).
  - Never import `latestDryRun` (defined in `kernel/src/playbooks/dry-run.ts`) into `store.ts`: `store.ts` may import only `../loop/internal.js`, the triggers index and this feature's types (`it imports only`), and `dry-run.ts` imports `store.js`.
- **`kernel/src/agents/settings.ts`**
  - keep: the unbuilt-kind refusal (`const UNBUILT_CONNECTORS: readonly string[] = ["jira", "clickup"];`) and `connector_not_built`.
  - keep: the crew schema strict (`const crewSchema = z.object({ ...shape, tool_policy: z.object(toolPolicyShape).strict() }).strict();`).
  - keep: any object form other than `{github: "write"}` refused, `{github: "read"}` included (pinned by `kernel/test/phase-8-foundation.test.ts`, `any other object form is refused too`).
- **`kernel/src/agents/roster.ts`**
  - keep: `set` writes only through `parseSetValue` (`return raw === "github" ? { value: ["github"] satisfies ConnectorKind[] } : { message: CONNECTORS_VALUE_MESSAGE };`), so add `github:write` there.
  - keep: `CONNECTORS_VALUE_MESSAGE` text exactly as it is (`connectors must be github or none`). Every value `kernel/test/agents-connectors-grant.test.ts` refuses stays refused.
  - pinned by: `kernel/test/agents-connectors-grant.test.ts` (`connectors must be github or none`), outside Touches, which must stay green unedited.
  - keep: owner-only routes (`{ method: "POST", path: "/agents/:id/set", handler: set }`).
- **`kernel/src/auth/credential-env.ts`**
  - keep: `"GH_TOKEN",` and the other three GitHub token names in `CREDENTIAL_ENV_VARS`, and `stripCredentialEnv` unchanged for every session.
  - The live token is added after the strip, never by dropping a name from the list.
  - pinned by: `kernel/test/auth.test.ts` (`"GH_TOKEN",`), which must stay green unedited.
- **`kernel/src/sessions/kernel-env.ts`**
  - keep: `export const TOOL_DEFERRAL_OFF` and `isKernelSessionEnvVar`.
  - extend: `isKernelSessionEnvVar` so a Loomwright host switch naming `GH_CONFIG_DIR`, `GIT_TERMINAL_PROMPT` or a `GIT_CONFIG_` name is refused. The file stays dependency-free (`Dependency-free:`).
  - update: reword the doc comments of `KERNEL_SESSION_ENV_NAMES` and `isKernelSessionEnvVar` to "names the kernel may set in a session's environment", since the GitHub names are set only in live, write-granted sessions.
- **`kernel/src/sessions/draft-mode.ts`**
  - keep: `export function githubCliDecision(policy: ToolPolicy, toolName: string, toolInput: unknown)` pure, and only deny.
  - keep: `GITHUB_CLI_DENY_REASON` text exact.
  - change: the new exemption applies only when the manager set `policy.githubWrite === true`.
  - pinned by: `kernel/test/phase-6-exit.test.ts` (`use_kernel_github_tools`), which must stay green unedited.
- **`kernel/src/sessions/types.ts`**
  - extend: the closed `SessionErrorCode` union (`| "cwd_changed";`) with `github_token_unavailable`.
  - add: `ToolPolicy.githubWrite?: boolean` (manager-filled, like `readonly connectors?: readonly ConnectorKind[];`).
  - add: `SessionManagerOptions.githubWriteFor?` and `sessionTokenMint?` beside `readonly connectorsFor?: (agent: string) => readonly ConnectorKind[];`.
- **`kernel/src/sessions/manager.ts`**
  - keep: the start and resume env line (`env: { ...config.env, ...TOOL_DEFERRAL_OFF },`), so the GitHub env is merged into `config.env` before `#launch`, never after `TOOL_DEFERRAL_OFF`.
  - keep: a caller's own `mode`/`connectors` never reach the policy (`#sessionPolicy`), and `githubWrite` is set only there.
  - keep: refusals go through `#recordSafely("session_refused", …)`.
  - keep: the rail runs only after a policy allow (`// The rail applies only after the policy allowed: it never widens a policy.`).
  - keep: a rail deny wins (`const githubCli = rail.kind === "deny" ? undefined : githubCliDecision(`).
  - reuse: `#settle(live: LiveSession)` for the cleanup, and `reapOrphans` for removing orphaned token directories.
  - At 2985 lines: the token logic lives in the new `github-session-auth.ts`, and manager.ts only calls it.
- **`kernel/src/kernel.ts`**
  - mirror: `export function connectorsFor(dataDir: string)` with a sibling `githubWriteFor(dataDir)` read through the one reader (`readAgentSettings`).
  - Fail closed: any refusal grants no write.
  - Wire no minter (the follow-up wires item 03's).

## Closed enumerations touched

> Sibling grep at base `0a41b7e`: `grep -rnF 'cwd_changed' kernel/src app/src` → 3 hits in 2 files. `grep -rlnF 'live_mode_not_in_phase_6' kernel app docs` → `kernel/src/playbooks/store.ts`, `kernel/src/playbooks/types.ts`, 4 kernel tests, `app/e2e/fixtures/playbooks.ts`, `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`, `docs/ARCHITECTURE.md`, `docs/architecture/draft-mode.md`, `docs/architecture/playbooks.md`, `docs/DECISIONS.md`. `grep -rlnF 'github_write_not_built' kernel docs` → `kernel/src/agents/settings.ts`, `kernel/test/phase-8-foundation.test.ts`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.

- **`github_token_unavailable`** (sibling: `cwd_changed`). It must be named in:
  - `kernel/src/sessions/types.ts`: the `SessionErrorCode` union (`| "cwd_changed";`). Extend.
  - `kernel/src/sessions/manager.ts`: the `session_refused` payloads. Extend, through the new refusal path.
- **`live_mode_owner_only`, `live_needs_enable`** (replacing `live_mode_not_in_phase_6`). They must be named in:
  - `kernel/src/playbooks/store.ts`: `export type PlaybookErrorCode`. Extend and remove the old code.
  - `kernel/src/playbooks/types.ts`: the doc comment. Update.
  - the 4 kernel tests. Rewrite.
  - `docs/architecture/draft-mode.md`, `playbooks.md` and `ARCHITECTURE.md`. Update.
  - `docs/DECISIONS.md`: no change. A historical record that names the code as lifted by item 04.
  - `app/e2e/fixtures/playbooks.ts` and `app/src/components/PlaybookPolicy/PlaybookPolicy.tsx`: no change. The app side belongs to item 13, and the fixture is a mock.
- **Connectors grant value `github:write`** (sibling: `github` in `parseSetValue`). It must be named in:
  - `kernel/src/agents/roster.ts`: `parseSetValue`. Extend.
  - `kernel/src/agents/roster.ts`: `CONNECTORS_VALUE_MESSAGE` and its pin `kernel/test/agents-connectors-grant.test.ts`. No change: the message text stays exactly as it is.
  - `docs/architecture/agents.md`. Extend.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-github-session-auth.test.ts` — the live+write session runs `gh pr view` without `use_kernel_github_tools` | flip `policy.githubWrite === true` → `false` in `kernel/src/sessions/draft-mode.ts` |
| `kernel/test/sessions-github-session-auth.test.ts` — the live+write session's env has no `GH_TOKEN` and the draft/chat/no-grant envs have no `GH_CONFIG_DIR` | delete the `mode === "live"` condition line in the manager's grant check in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions-github-session-auth.test.ts` — the mint failure refuses `github_token_unavailable` with one `session_refused` | delete `github_token_unavailable` refusal `throw` in `kernel/src/sessions/github-session-auth.ts` |
| `kernel/test/sessions-github-session-auth.test.ts` — the re-mint rewrites the file before expiry (fake timers) | flip `GITHUB_TOKEN_REMINT_MARGIN_MS` value to `0` in `kernel/src/sessions/github-session-auth.ts` |
| `kernel/test/sessions-policy.test.ts` — `gh pr merge 1` in a live+write policy is `merge_blocked` | delete the `merge_blocked` rail branch in `kernel/src/sessions/policy.ts` (scratch copy only: policy.ts is not in lanes) |
| `kernel/test/integrations-foundation.test.ts` — Wright's create with `mode live` is refused `live_mode_owner_only` | delete `live_mode_owner_only` throw in `kernel/src/playbooks/store.ts` |
| `kernel/test/integrations-foundation.test.ts` — the owner's `live` on a not-enabled playbook is refused `live_needs_enable` | delete `live_needs_enable` throw in `kernel/src/playbooks/store.ts` |
| `kernel/test/phase-8-foundation.test.ts` — `{github: "write"}` reads `githubWrite: true` | flip `githubWrite: true` → `githubWrite: false` in `kernel/src/agents/settings.ts` |
| `kernel/test/phase-8-foundation.test.ts` — the rewritten live block: the owner's live on an enabled playbook is stored, an agent's live is refused | delete `live_mode_owner_only` throw in `kernel/src/playbooks/store.ts` |
| `kernel/test/playbooks-drafts.test.ts` — `studio playbooks set <id> mode live` on a not-enabled playbook prints `live_needs_enable` | delete `live_needs_enable` throw in `kernel/src/playbooks/store.ts` |
| `kernel/test/playbooks-drafts-poll.test.ts` — `create({ mode: "live" })` is refused `live_mode_owner_only` | delete `live_mode_owner_only` throw in `kernel/src/playbooks/store.ts` |
| `kernel/test/phase-8-foundation.test.ts` — `set connectors github:write` writes `{github: "write"}` | delete the `github:write` branch line in `parseSetValue` in `kernel/src/agents/roster.ts` |
| `kernel/test/sessions-github-session-auth.test.ts` — a host switch naming `GH_CONFIG_DIR` is refused | delete `GH_CONFIG_DIR` name from the GitHub session env names in `kernel/src/sessions/kernel-env.ts` |
| `kernel/test/sessions-github-session-auth.test.ts` — the token directory is gone after the session ends | delete the token-directory `rmSync` cleanup line in `kernel/src/sessions/github-session-auth.ts` |
| `kernel/test/sessions-github-session-auth.test.ts` — a resume whose mint fails is refused `github_token_unavailable` with the row unchanged | delete the mint call on the resume path in `kernel/src/sessions/manager.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Owner-only `live` mode and the `github: write` grant | AC1, AC2 (settings and `set` part), AC6 (agents.md, playbooks.md) | 11 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Token injection, re-mint and `gh` in live, write-granted sessions | AC2 (env part), AC3, AC4, AC5, AC6 (draft-mode.md, approvals.md, ARCHITECTURE.md, OPEN_QUESTIONS.md) | 12 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | BLOCKED (by #1) |

### File Impact Map (line counts at base)

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 playbooks | `kernel/src/playbooks/store.ts` (732), `kernel/src/playbooks/types.ts` (70), `kernel/src/playbooks/enable.ts` (441) | — | HIGH |
| 1 agents | `kernel/src/agents/settings.ts` (310), `kernel/src/agents/roster.ts` (731) | — | HIGH |
| 1 tests | `kernel/test/integrations-foundation.test.ts` (881), `kernel/test/phase-8-foundation.test.ts` (418), `kernel/test/playbooks-drafts.test.ts` (898), `kernel/test/playbooks-drafts-poll.test.ts` (207) | — | HIGH |
| 1 docs | `docs/architecture/agents.md` (315), `docs/architecture/playbooks.md` (127) | — | HIGH |
| 2 sessions | `kernel/src/sessions/manager.ts` (2985), `kernel/src/sessions/types.ts` (602), `kernel/src/sessions/kernel-env.ts` (27), `kernel/src/sessions/draft-mode.ts` (217), `kernel/src/auth/credential-env.ts` (108), `kernel/src/kernel.ts` (411) | `kernel/src/sessions/github-session-auth.ts` | HIGH |
| 2 tests | `kernel/test/draft-mode.test.ts` (484), `kernel/test/sessions-policy.test.ts` (475) | `kernel/test/sessions-github-session-auth.test.ts` | HIGH |
| 2 docs | `docs/architecture/draft-mode.md` (59), `docs/architecture/approvals.md` (262), `docs/ARCHITECTURE.md` (322), `docs/OPEN_QUESTIONS.md` (182) | — | HIGH |

**Module layout (`skills/supervisor-readiness/SKILL.md` §"Module layout"):**
- **The live-mode precondition:** appended to `store.ts` (732). It is the single authority for policy values (`checkPolicyValue`). The `row.status === "enabled"` check lives in `setPlaybookPolicy`, with no new import.
- **The token lifecycle** (the `SessionTokenMint` port type, the repos lookup from the playbook's linked poll trigger, token file and `hosts.yml` writes with temp + rename, env additions, the re-mint timer with `GITHUB_TOKEN_REMINT_MARGIN_MS`, cleanup): the CREATE module `kernel/src/sessions/github-session-auth.ts`. `manager.ts` (2985) gets only the call sites (start, resume, `#settle`, `reapOrphans`, `#sessionPolicy`), because it is past the threshold.
- **The write-grant parse:** appended to `settings.ts` (310), the one reader.
- **The `set` value:** appended to `roster.ts` (731), the single `parseSetValue`.
- **The new tests:** the CREATE `kernel/test/sessions-github-session-auth.test.ts`. The pin tests are edited where they already live.
- **`credential-env.ts`:** a comment only (the live token is added after the strip and the list stays).
- **`enable.ts`:** unchanged; kept in lanes only for the owner's Touches.

### Design notes (binding for the workers)
- **Token directory:** `<dataDir>/session-github/session-<id>/`, mode 0700. It holds `token` (0600) and `gh/hosts.yml` (0600, `github.com: {oauth_token, user: x-access-token, git_protocol: https}`). Never under the Loomwright state dir.
- **Env additions:** `GH_CONFIG_DIR=<dir>/gh`, `GIT_TERMINAL_PROMPT=0`, and `GIT_CONFIG_COUNT=2` with `credential.helper` reset to empty and then the inline helper reading `<dir>/token`, exactly as probed. The env never gets `GH_TOKEN`.
- **When a session qualifies:** the playbook's `mode` is `live`, the session is not a dry run, `githubWriteFor(agent)` is true, and `connectors` includes `github`. Only then do the mint, the env additions and `policy.githubWrite = true` happen, at every start and every resume attempt.
- **Repos:** from the playbook's linked poll trigger spec (`repos`). None means `github_token_unavailable` with detail `no_repos`.
- **Mint result:** `{ok: true, token, expires_at}` or `{ok: false, error, message}`. A mint result's error text goes into `detail`, never the token.
- **Mint before insert:** at a start, mint before the row insert, after admission, and write the files after the insert, before the spawn.

### Subtask Contracts

```yaml
# Subtask 1 — Owner-only live mode and the github write grant (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "live_needs_enable"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "live_mode_owner_only"}
  - {kind: "symbol", path: "kernel/src/agents/settings.ts", name: "githubWrite"}
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "github:write"}
requires: []
lanes:
  - "kernel/src/playbooks/store.ts"
  - "kernel/src/playbooks/types.ts"
  - "kernel/src/playbooks/enable.ts"
  - "kernel/src/agents/settings.ts"
  - "kernel/src/agents/roster.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/playbooks-drafts.test.ts"
  - "kernel/test/playbooks-drafts-poll.test.ts"
  - "docs/architecture/agents.md"
  - "docs/architecture/playbooks.md"
external_requires: []

# Subtask 2 — Token injection, re-mint and gh in live write sessions (BLOCKED by #1)
provides:
  - {kind: "file", path: "kernel/src/sessions/github-session-auth.ts"}
  - {kind: "type", path: "kernel/src/sessions/github-session-auth.ts", name: "SessionTokenMint"}
  - {kind: "symbol", path: "kernel/src/sessions/github-session-auth.ts", name: "GITHUB_TOKEN_REMINT_MARGIN_MS"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "github_token_unavailable"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "githubWriteFor"}
  - {kind: "file", path: "kernel/test/sessions-github-session-auth.test.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/agents/settings.ts", name: "githubWrite"}
lanes:
  - "kernel/src/sessions/github-session-auth.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/kernel-env.ts"
  - "kernel/src/sessions/draft-mode.ts"
  - "kernel/src/auth/credential-env.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/sessions-github-session-auth.test.ts"
  - "kernel/test/draft-mode.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "docs/architecture/draft-mode.md"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "gh >= 2.102 reads GH_CONFIG_DIR/hosts.yml oauth_token (probed 2026-11-03)"
  - "git >= 2.31 GIT_CONFIG_COUNT env config (probed on 2.55)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 reads 1's settings and store symbols) | YES (dependency) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/playbooks/store.ts:68` | yes | HOLDS | `export type PlaybookErrorCode = … \| "live_mode_not_in_phase_6";` | tip 9 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Item 03's `mintSessionToken` is not on `main` (Feasibility, Phase 2.5) | MEDIUM | Port plus fail-closed `github_token_unavailable`. The follow-up item wires kernel.ts and amends D39's text. Until then no session gets a token, which is the safe direction. |
| The 25-file scope is past the context bound (Feasibility, Phase 2.5) | MEDIUM | 2 sequential subtasks. manager.ts edits stay call-site only. |
| The token is on disk for the session's life | MEDIUM | 0700 directory, 0600 files, atomic rewrite, removed in `#settle` and by `reapOrphans`. The token is never in an event, log or row (a test greps the store and the events). |
| A script in the session can use the token within its down-scope, unseen by the rail | MEDIUM | A known limit per the owner's merge-flow decision, recorded in `docs/OPEN_QUESTIONS.md` (AC6). |
| The Claude Code Bash tool's shell snapshot could reset `GH_CONFIG_DIR` or `GIT_CONFIG_*` | LOW | Unverified (not probed in an SDK session). Record it as NEEDS VERIFICATION in `docs/OPEN_QUESTIONS.md` with item 14's live run as the probe. If it fails, gh/git fall back to no token (they fail), never to a broader one, because the keychain login is not used when `GH_CONFIG_DIR` is set. |
| Prior churn on `kernel/src/sessions/manager.ts` (27), `store.ts` (5), `roster.ts` (4): `self_heal_churn` and `drain_churn` (Prior churn, postmortem ledger) | MEDIUM | Keep the manager edits minimal and tested through the gate. Run the full `npm test` before hand-back. |
| An inherited `GIT_CONFIG_COUNT`/`GH_CONFIG_DIR` in the daemon env | LOW | In a live session the kernel's values are spread over the auth env. Other sessions are unchanged by design. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-03-live-mode-and-github-write-in-sessions.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-03T04:52:28Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/219
- **Branch:** feature/live-mode-and-github-write-in-sessions
- **Files changed:** 24
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Owner-only live mode and the github write grant (subtask 1) plus a file-backed, re-minted, down-scoped GitHub token for live, write-granted sessions with gh allowed and the rail unchanged (subtask 2); no minter wired, so qualifying sessions fail closed github_token_unavailable. Phase 4.5 fixed 4 findings across 3 rounds: the admission race, the kill switch missing a start mid-mint, setTimeout overflow, and the docs. Round 3's reviewer PASSed, but its MEDIUM docs finding was fixed on the final round and not re-reviewed, hence the escalation. Required CI green.

## Not verified
- **studio agents set <id> connectors github:write through the real CLI process** — only the roster route handler was exercised (subtask 1)
- **Claude Code Bash tool shell snapshot keeping GH_CONFIG_DIR / GIT_CONFIG_* in an SDK session** — needs a live SDK session (item 14's run); NEEDS VERIFICATION in docs/OPEN_QUESTIONS.md (subtask 2)
- **A real down-scoped token mint** — no minter is wired (item 03's mintSessionToken is a follow-up) (subtask 2)
