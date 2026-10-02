# Architecture

Status: design, pre-code. Decisions referenced as D# are in `DECISIONS.md`. Q# refers to the probe-numbered technical items in `OPEN_QUESTIONS.md` (probe pN): Q1 bundled binary, Q2 subscription auth, Q3 usage reporting, Q4 plugin loading and auth isolation, Q5 session lifecycle, Q6 cap signal.

## Three layers

```
┌─ Surfaces ─────────────────────────────────────────────────┐
│  Electron app (menu bar + windows)   CLI: studio ask|status|stop │
│  Optional connectors: Slack, …                              │
└──────────────┬─────────────────────────────────────────────┘
               │ HTTP + WebSocket on 127.0.0.1, token from Keychain
┌─ Kernel (deterministic TypeScript daemon, launchd service; never an LLM) ─┐
│  Event loop · Trigger engine · Session manager · Approval gate            │
│  SQLite store · Budget meter · Audit log · Loomwright adapter             │
│  Kernel tools (in-process MCP) exposed to the brain                       │
└──────────────┬────────────────────────────────────────────────────────────┘
┌─ Brain (Claude sessions via @anthropic-ai/claude-agent-sdk) ─┐
│  Wright (lead): role + memory → plans, writes playbooks, delegates │
│  Specialists: named agents, each running Loomwright agents/commands │
└──────────────────────────────────────────────────────────────┘
```

The kernel owns everything that must be reliable: lifecycle, state and limits. The brain owns everything that needs judgement. The brain changes the world only through kernel tools, or through tool calls its permission policy allows. (D2, D5, D11)

## Data model

One SQLite database in the Studio data dir (e.g. `~/.loomwright-studio/studio.db`), with **one writer: the kernel.**

| Table | Holds |
|---|---|
| `agents` | id, name, avatar, role charter path, permission policy, allowed integrations, model/effort settings, budget |
| `tasks` | id, title, kind (free text), state, assignee agent, owner session, parent task, links (PR, ticket), dedupe key, next check time |
| `playbooks` | id, name, owning agent, natural-language intent, trigger spec, action spec, dedupe key spec, priority, approval level, model/effort, enabled, version |
| `triggers` | id, playbook, type (poll / cron / hook / webhook / git-hook), spec, last run, last result |
| `sessions` | id, agent, task, SDK session id, status, started, process group id (written before the session starts; Q5), auth account whose cap it counts against (D27, D28), Loomwright path it ran with, the group leader's start time (recorded with the group id, so the reaper can tell the session's CLI from a process that reused the id), when a live kernel's kill of that group last gave up or errored (null otherwise; while set, every reap retries the kill even on a terminal row), tokens/cost as the last `result.modelUsage` totals, so a resume adds only the delta (Q3) |
| `approvals` | id, action, exact payload, requested, decided by, decision (once / always-for-this-playbook / deny) |
| `hooks_installed` | id, scope (session / project / global), file, diff, backup path, verified-fires flag |
| `connectors` | id, kind, status, scopes (all optional; D12) |
| `events` | append-only audit log of everything the kernel did |
| `budget` | usage per day, per playbook, per agent, per session. A token limit counts input + output + cache-write tokens; cache reads are recorded and shown but don't count. Read from `result.modelUsage` per model at each query's end, never per-message usage; the "≈$" estimate uses the full `costUSD` (D24, D26). `modelUsage` is cumulative per SDK session across resumes, so the kernel keeps the last totals in `sessions.model_usage_json` and writes only the delta, attributed to the kernel host's local calendar day the result arrived on; a lower total is a fresh baseline (added in full, logged), and an empty or all-zero `modelUsage` (a crash result) is ignored and logged so it never resets the baseline. Thinking tokens have their own column and are never added to the counted total (they are already inside output). An agent's daily token limit comes from the user's config (none by default); reaching it notifies once per agent-day and refuses that agent's new sessions until the next day, while a running session finishes its turn |
| `work_steps` | idempotency key (unique), status (started / done / failed), result. Makes each kernel tool's effect happen at most once across a crash (D2; see requirement item 07) |
| `wakeups` | id, due time, reason, task, status (starts pending), fired time. Scheduled wake-ups, each fired once by id (see requirement item 07) |
| `cap_state` | account, rate-limit type, status, resets-at time. Subscription cap state from the SDK's `rate_limit_event`; that account's sessions stay parked until `resetsAt` (D28). Also stores the event's utilization, the untyped `unifiedWindows` verbatim (0–1 fractions, observed live only), and a reset source: `event` (from `resetsAt`, epoch seconds stored as ISO) or `recheck` (unknown reset: a `rejected` event without a usable `resetsAt` — missing, not ahead of now, more than 35 days ahead, or past year 9999 — or a usage-limit text found via the SDK's `USAGE_LIMIT_ERROR_PREFIXES`, parked as `text_fallback` and re-checked hourly). A `rejected` window notifies and schedules a wake-up once (`notified_resets_at`); an `allowed_warning` window warns once (`warned_resets_at`). An unexpired park only ever extends (a later known reset, notified once more): an unknown or earlier reset, or an `allowed` from another session, never shortens or clears it. The account is always the auth provider's live account, for the cap tracker and admission alike; the session row's `auth_account` label is never used as a key. Admission refuses every start and resume on a parked account, including each retry attempt of a resume (a refused retry launches nothing and leaves the session `interrupted`, resumable once the park ends); nothing switches provider. The D28 API-key fallback is a config flag plus a dollar ceiling, both off by default; once playbooks exist it is read per playbook and the kernel-wide placeholder is never consulted |
| `auth_providers` | id (the provider id, e.g. `subscription-token`), account label, token creation date. Non-secret metadata only; the secret stays in the Keychain. Expiry warning 30 days before the token's one-year life ends; a `notify` event at most once per provider per UTC day (D27) |

**Memory is markdown, not the database** (invariant 8): `memory/<agent>/role.md`, `preferences.md`, `people.md`, `lessons.md`, one handoff note per task, plus `memory/shared/` for things every agent should know about the user. Users can read, edit and version it.

## Kernel tools (the brain's only levers)

All of these are generic mechanisms; policy is set per playbook (D3, D4). They run in-process as an SDK MCP server, which needs streaming input (Q5). Every name carries the `kernel_` prefix because in Q5 an unprefixed `task_create` lost to the built-in `TaskCreate`, while `kernel_record_task` was called correctly.

- `kernel_task_create / kernel_task_update / kernel_task_list / kernel_task_get`
- `kernel_playbook_create / kernel_playbook_update / kernel_playbook_disable / kernel_playbook_dry_run`
- `kernel_trigger_register(type, spec) / kernel_trigger_remove`
- `kernel_agent_create / kernel_agent_update`: propose a new specialist or change one; requires approval
- `kernel_session_spawn(agent, task, prompt) / kernel_session_stop / kernel_session_status`
- `kernel_schedule_wakeup(at, reason) / kernel_request_stop(handoff)`
- `kernel_approval_request(action, payload)`: blocks until the user decides in the app (or a connector)
- `kernel_hook_propose / kernel_hook_apply / kernel_hook_verify` (D6)
- `kernel_notify(message)`
- `kernel_loomwright_capabilities()`: the adapter's manifest (D13)

Everything else comes from ordinary Claude Code tools (`gh`, MCP connectors, bash, Loomwright commands), limited by the agent's permission policy.

## Main loop

1. An **event** arrives: a trigger fires, the user sends a message, or a wake-up comes due.
2. The kernel logs it and checks budget and cap state. If over a limit, it parks the event and notifies; no retries (D17). The cap is detected from the SDK's `rate_limit_event` with `status: 'rejected'`, not from error text: the kernel parks that account's sessions until `resetsAt` and notifies. A playbook may opt in to continue on the user's own API key under a hard spending ceiling the user sets; without the opt-in, work waits (D28). The real `rejected` event has not been observed yet (Q6).
3. It checks the playbook's dedupe key against past work (if the user defined one) and drops duplicates.
4. It **starts or resumes** the right agent's session: resume if a task is in flight, otherwise fresh, with role, memory, the Loomwright manifest and the event.
5. The agent decides what to do: answer, create tasks, draft or edit a playbook, start specialists.
6. Outward or persistent actions go through the **approval gate**. "Always allow" is stored per playbook, never globally.
7. The session ends with `kernel_request_stop`: the kernel writes the handoff note, updates tasks, and schedules the next wake-up.

## Session manager (Q5)

Every agent session is an SDK `query()`, never a `claude --bg` session: those belong to the CLI's own background manager and can't host kernel tools or the approval callback (Q5).

- **The kernel spawns the CLI itself** through the SDK's `spawnClaudeCodeProcess` option, each session in its own process group. The group id is recorded in SQLite before the session starts; the group leader's start time is read with `ps` right after and recorded next to it, and is null when `ps` could not read it (or the kernel died before it did). Q5 showed a `kill -9` of the kernel orphans the CLI child rather than stopping it, so without a reaper invariant 2 doesn't hold.
- **The boot-time reaper kills only a group it can prove is still the session's.** It does NOT kill every recorded group still alive: a pgid can be reused, and the owner's own interactive `claude` processes lead groups too. It kills a live group only when its leader is named `claude` AND still has the recorded start time, or when `ps` positively reports the leader gone while the group lives on (a pid is never reused while its group exists). A reused or foreign group, a row with no recorded start time, and a failed `ps` are left alone. A row becomes `interrupted` (resumable) only when its group is gone or proven foreign (another leader name or start time). A row whose group may still be the session's and alive (no recorded start time, a failed `ps`, or a kill that outlived its deadline) becomes `orphaned`, with the reason in its event: it is never resumed while that holds, and every later reap re-examines it (appending `session_reap_deferred` while nothing changes) until its group is gone. `EPERM` from a kill means "not gone yet", never "foreign".
- **Every kill re-sends SIGKILL until the group is gone.** One `kill(-pgid, SIGKILL)` that races a fork misses the new child, which survives in the dead group (see `docs/OPEN_QUESTIONS.md`), and the CLI forks shells. Stop, post-session cleanup, the SDK-abort path and the reaper all re-kill every 25 ms until `ESRCH`, for up to 2 s. The kernel's own kills then record `session_kill_incomplete`; the SDK-abort listener cannot record anything and leaves a group that outlives it to the kernel's next kill. A session whose group the kernel could not confirm gone ends `failed` with reason `kill_incomplete` (the intended outcome kept as `cause`), never `stopped` or `completed`, and a resume never launches another attempt over it. The one exception is `failed:auth`, written at the first auth signal (AC7) before its kill; it is never resumed either. Either way the kill that gave up (or errored) flags the row (`kill_incomplete_at`), and a later kill that confirms the group gone clears it. Every `reapOrphans` (at the latest, the next boot) retries each flagged terminal row with the same identity check and kill as an orphan, never changing its status: it appends `session_kill_retried` and clears the flag once the group is gone or proven foreign, so a row is retried only while its group may still be the session's.
- While the kernel is alive, stopping is stdin EOF, then a force-kill of the whole process group after a ~2 s grace (Q5). A stop that arrives after the session's stream has already ended (while its group is being cleaned up) still kills the group, but the session keeps the outcome its stream produced (`completed`, or `failed` with the result or stream error), with `stop_requested_after_end` in the event, not `stopped`: it was no longer running. A background-loop crash (`kernel_error`) likewise keeps an already-computed outcome in its event.
- **The SDK session id is pre-assigned** (`sessionId`), so it is recorded in SQLite before the CLI starts and a kernel killed before the first message still leaves a resumable id.
- **An auth failure surfaces within ~1 s** as an `api_retry` message with a 401, long before the CLI's own retries give up (Q4). The kernel fails the session on the first one: `failed:auth`, one notify event, no retry and no resume.
- **Every session sets `model` explicitly**, since the default is Opus (Q1); which model is playbook policy (D4).
- **Every session sets `permissionMode` explicitly** (Q5), never `bypassPermissions` (D5).
- **Every tool call passes a kernel `PreToolUse` hook callback.** `canUseTool` alone is skipped for read-only commands and for tools listed bare in `allowedTools` (Q5).
- **Streaming input.** The prompt is an async iterable; with a plain string prompt the in-process kernel tools are unavailable (Q5).
- Sessions run isolated with `settingSources: []` and Loomwright loaded by path (D27; see Auth).
- Resume is by SDK session id from the on-disk transcript. Treat it as retryable and record the error text (Q5). Before launching, a resume re-checks the recorded group exactly as the reaper does and refuses (`not_resumable`, the row becomes `orphaned`) while it may still be the session's and alive, so two CLIs never run the same SDK session.
- The CLI binary is bundled in the SDK's per-platform package; the packaged app keeps it outside the asar archive or passes `pathToClaudeCodeExecutable` (Q1).

## Safety kernel (fixed; D5)

- **Per-agent permission policy.** Wright is read-mostly. Builders write only in git worktrees. Reviewers comment only. No agent ever gets `bypassPermissions`.
- **Kernel-side SDK hook callbacks the brain can't edit**, passed as a `PreToolUse` callback on every tool call (Q5):
  - block `gh pr merge` outside Loomwright's sanctioned gate
  - block pushes to protected branches
  - block writes to kernel files and to global settings without approval
- **Untrusted input is data.** PR bodies, comments and ticket text reach the model as quoted data. There's an injection test in the roadmap.
- **A worked-on repo's `AGENTS.md` is untrusted input too.** The CLI's builtin `agents-md` plugin loads even with no plugins configured and puts that file into the model as project instructions where the repo has no `CLAUDE.md` (invariant 3, Q4).
- **Budget ceilings.** Per day, per playbook and per agent, plus a limit on concurrent sessions. Fails closed: park and notify.
- **Kill switch.** `studio stop --all` / the menu-bar button aborts every session and disables every trigger.

## Auth (D15, D16, D27, D29)

- A pluggable provider interface: `subscription-token`, `api-key` (Keychain); `bedrock`, `vertex` later (D16).
- **`subscription-token`** (D15, D27): a long-lived token the user creates with `claude setup-token` in their own terminal, read from the macOS Keychain item `loomwright-studio-oauth` and passed to each session as `CLAUDE_CODE_OAUTH_TOKEN`. Sessions run fully isolated: `settingSources: []`, Loomwright loaded by path, nothing else of the user's (D27, proven in Q4). Studio never runs a login flow of its own (invariant 6).
- The `subscription-token` provider strips `ANTHROPIC_API_KEY` from the child environment, because a key wins over the token and would silently move billing to the API (D27, Q2).
- The token lasts one year; the kernel checks for expiry and notifies before it lapses (D27). Token entry checks the prefix and length before saving, since a cut-off token fails with a 401 (Q4).
- **Personal build only.** The `subscription-token` provider is compiled out of any distributed build, which supports only API keys and 3P providers (D29).
- `api-key` sets `ANTHROPIC_API_KEY` from the Keychain (Q2); it's also the per-playbook opt-in fallback at the cap (D28). The API-key path is stub-tested until a commercial launch (D16).
- Not verified yet: that credentials are reachable when the kernel runs as a launchd agent rather than from a terminal; check once in phase 1 (Q2).

## Loomwright adapter (D13)

- Resolves the **active** plugin install location. Beware: the desktop app and the CLI install plugins in different places, and `~/.claude/plugins/cache/` can hold stale leftovers.
- On start, and whenever the version changes: parse the manifest, frontmatter, changelog and result schemas, and build the capability manifest.
- When the version changes, compare the changelogs and tell the user about new features, offering playbooks for them.
- Reads Loomwright's structured outputs only.

## Prior art

`reference/SDK_RUNNER_SPIKE.md` (from the Loomwright repo) records a verified SDK capability matrix and the open questions about hooks, skills and memory for SDK-spawned agents. Read it before designing the session manager.
