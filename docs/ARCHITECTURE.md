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
| `budget` | usage per day, per playbook, per agent, per session. A token limit counts input + output + cache-write tokens; cache reads are recorded and shown but don't count. Read from `result.modelUsage` per model at each query's end, never per-message usage; the "≈$" estimate uses the full `costUSD` (D24, D26). `modelUsage` is cumulative per SDK session across resumes, so the kernel keeps the last totals in `sessions.model_usage_json` and writes only the delta, attributed to the kernel host's local calendar day the result arrived on; a lower total is a fresh baseline (added in full, logged), and an empty or all-zero `modelUsage` is ignored and logged so it never resets the baseline (SDK 0.3.284's `sdk.d.ts` says crash/startup-error results may carry zeroed usage; not probed live, and ignoring is the safe choice either way). Thinking tokens have their own column and are never added to the counted total (they are already inside output). An agent's daily token limit comes from the user's config (none by default); reaching it notifies once per agent-day and refuses that agent's new starts until the next day, while a running session finishes its turn. The agent limit refuses new starts only: resuming an interrupted session is not refused by it (the account cap still refuses resumes), so the limit does not bound the tokens a resumed session spends the same day |
| `work_steps` | idempotency key (unique), status (started / done / failed), result, failure reason (`interrupted`: a crash left it `started` and it was not declared re-runnable, reported as `failed:interrupted` with one notify; `error`: its work threw, unless the caller declared that error effect-free, as the loop does for an admission refusal, in which case the claim of the innermost step whose own work raised it is released and a later call runs the work again; an outer step the error only passed through records `error`, since its work may have had an effect before the inner step), and whether it was declared re-runnable. Makes each kernel tool's effect happen at most once across a crash (D2). Exactly once holds only for effects inside SQLite committed in the step's own transaction; an external effect (a file, a `gh` comment) is at most once only through the key plus this check, and is re-run after a crash only when declared re-runnable (idempotent). `failed` is terminal for a key |
| `wakeups` | id, due time, reason, task, status (starts pending), fired time. Scheduled wake-ups, each fired once by id: the move to `fired` and the queued `wakeup` event commit together, so one that came due while the kernel was down fires once on the first tick after the restart |
| `event_queue` | id, kind (`wakeup` or `message` in phase 1), payload, source ref (the unique dedupe anchor of a derived row, e.g. `wakeup:<id>`; null for a user message), status (pending / done / failed), not-before time (a parked row waits for it), attempts, last error, task, session, enqueued and done times. The loop's processing state lives here because `events` is append-only; every transition is also audited in `events` |
| `cap_state` | account, rate-limit type, status, resets-at time. Subscription cap state from the SDK's `rate_limit_event`; that account's sessions stay parked until `resetsAt` (D28). Also stores the event's utilization, the untyped `unifiedWindows` verbatim (0–1 fractions, observed live only), and a reset source: `event` (from `resetsAt`, epoch seconds stored as ISO) or `recheck` (unknown reset: a `rejected` event without a usable `resetsAt` — missing, not ahead of now, more than 35 days ahead, or past year 9999 — or a usage-limit text found via the SDK's `USAGE_LIMIT_ERROR_PREFIXES`, parked as `text_fallback` and re-checked hourly). A `rejected` window notifies and schedules a wake-up once (`notified_resets_at`); an `allowed_warning` window warns once (`warned_resets_at`). An unexpired park only ever extends (a later known reset, notified once more): an unknown or earlier reset, or an `allowed` from another session, never shortens or clears it. The account is always the auth provider's live account, for the cap tracker and admission alike; the session row's `auth_account` label is never used as a key. Admission refuses every start and resume on a parked account, including each retry attempt of a resume (a refused retry launches nothing and leaves the session `interrupted`, resumable once the park ends); nothing switches provider. The D28 API-key fallback is a config flag plus a dollar ceiling, both off by default; once playbooks exist it is read per playbook and the kernel-wide placeholder is never consulted |
| `auth_providers` | id (the provider id, e.g. `subscription-token`), account label, token creation date. Non-secret metadata only; the secret stays in the Keychain. Expiry warning 30 days before the token's one-year life ends; a `notify` event at most once per provider per UTC day (D27) |

**Memory is markdown, not the database** (invariant 8): `memory/<agent>/role.md`, `preferences.md`, `people.md`, `lessons.md`, one handoff note per task at `memory/<agent>/handoffs/<task>.md` under the data dir (`_unassigned` for a session with no agent, `session-<id>` for one with no task), plus `memory/shared/` for things every agent should know about the user. Users can read, edit and version it.

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

Phase 1 ships the first six: `kernel_task_create / kernel_task_update / kernel_task_list / kernel_task_get / kernel_schedule_wakeup / kernel_request_stop`. The server is named `kernel`, so the SDK's full names are `mcp__kernel__kernel_*`; a session can call one only when the user's tool policy lists that full name (the kernel never adds them itself), and the session manager builds a fresh server for every launch attempt (an instance cannot reconnect). Tool input is untrusted data: each handler validates it and returns an error result instead of throwing. Each tool that creates something takes a caller-chosen `idempotency_key` and runs as a work step keyed `<tool>:session-<session id>:<key>`: a repeat in the same session (also after a resume or a restart) returns the first result, while another session using the same key is not deduplicated against it. `kernel_request_stop` writes the handoff note (atomically; re-runnable, since rewriting it is idempotent), records `stop_requested` (once per work-step key: a crash re-run of the same call adds none, while each call with a new key adds its own), and then schedules the stop out of band instead of awaiting it from inside the session's own tool call; a stop that fails is recorded as `stop_failed`.

Everything else comes from ordinary Claude Code tools (`gh`, MCP connectors, bash, Loomwright commands), limited by the agent's permission policy.

## Main loop

1. An **event** arrives: a trigger fires, the user sends a message, or a wake-up comes due.
2. The kernel logs it and checks budget and cap state. If over a limit, it parks the event and notifies; no retries (D17). The cap is detected from the SDK's `rate_limit_event` with `status: 'rejected'`, not from error text: the kernel parks that account's sessions until `resetsAt` and notifies. A playbook may opt in to continue on the user's own API key under a hard spending ceiling the user sets; without the opt-in, work waits (D28). The real `rejected` event has not been observed yet (Q6).
3. It checks the playbook's dedupe key against past work (if the user defined one) and drops duplicates.
4. It **starts or resumes** the right agent's session: resume if a task is in flight, otherwise fresh, with role, memory, the Loomwright manifest and the event.
5. The agent decides what to do: answer, create tasks, draft or edit a playbook, start specialists.
6. Outward or persistent actions go through the **approval gate**. "Always allow" is stored per playbook, never globally.
7. The session ends with `kernel_request_stop`: the kernel writes the handoff note, updates tasks, and schedules the next wake-up.

How it is built (item 07): an event is written to SQLite before anything acts on it, as an `event_queue` row plus an `event_enqueued` row in `events`, in one transaction. "Internal" events are the kernel's own audit rows in `events` (`notify`, for example): logged, never queued. Each tick fires the due wake-ups into the queue, then processes `pending` rows in id order (no other ordering) with handlers the caller injects; the loop has none of its own and invents no behaviour. A row is marked `done` only after its handler's effects are committed; a kind with no handler is marked `done` with an `event_unhandled` row. A handler refused by admission parks the row: it stays `pending` until `not_before` (the refusal's retry time, or an hour when unknown), with no second notify (D17); the work step whose own work was refused is released so the redelivery runs it again, but if the refusal passed through an outer step that may already have had an effect, that step is `failed` and so is the event (with one notify), never re-run blindly. Any other failure marks the row `failed` with one notify, and the loop moves on: a failed event never blocks the queue. A crash after a handler's effects and before `done` delivers the event again after the restart, so handlers make their effects idempotent through work steps keyed on the event id.

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
- **Kill switch.** `studio stop --all` / the menu-bar button aborts every session and disables every trigger. Durable: its state is derived from the append-only `events` log (`kill_switch_engaged` / `kill_switch_released`), so no restart (launchd KeepAlive) can silently release it, and the daemon does not start the event loop while it is engaged. `POST /stop-all` engages it, stops the loop (the current event finishes, no other starts), then stops every live session through the session manager (`stopped`; a group that cannot be confirmed gone ends `failed`/`kill_incomplete`; a session that already ended `failed:auth` gets its group's kill now and is reported `failed:auth` only once that group is confirmed gone, otherwise `stop_failed` (`kill_incomplete`), its row flagged for the reaper) and records `stop_all_completed` with each outcome; `studio stop --all` exits non-zero unless every session is confirmed stopped or ended (a session not confirmed stopped stays listed under `/status`'s `kill_unconfirmed` while its row is flagged), and waits for the answer longer than one session's worst-case stop (stop grace + group-kill deadline + leader-exit wait, plus a margin; `status` and `resume` wait 5 s); if it still times out it says the kill switch may already be engaged; `POST /resume` (`studio resume`) releases it and restarts the loop. Triggers do not exist until phase 2.

## Loopback API

- **127.0.0.1 only**, never `0.0.0.0`/`::`: the host is a constant, not a setting. The port is OS-assigned and written with the daemon's pid to `<dataDir>/api.json` (mode 0600; never the token). A graceful stop removes the file only while it still names that pid.
- **Bearer token from the Keychain item `loomwright-studio-api`** (account `loomwright-studio`), 32 random bytes as hex, generated by the kernel on first start. It is written with `security -i` reading `add-generic-password …` on **stdin**, so the secret never appears in `argv`; without `-U`, so an existing item is never overwritten. `security -i` can exit 0 when its inner command failed, so the kernel reads the item back and trusts only that.
- **Authentication before routing:** every request, whatever its path or method, needs `Authorization: Bearer <token>` (constant-time compare). Otherwise `401 {"error":"unauthorized"}`; only after that are unknown paths 404 and wrong methods 405. Request bodies are ignored.
- **Routes:** `GET /status` (kernel version, uptime and pid; kill switch; each auth provider's health, never a secret; `starting`/`running` sessions; `kill_unconfirmed`: every session, whatever its status, whose group a kill gave up on or errored on (`kill_incomplete_at` set) and may still be alive, until the reaper confirms it gone; pending queue rows and wake-ups; today's counted tokens per agent (D26); `cap_state` per account), `POST /stop-all`, `POST /resume` (see the kill switch above).
- **`studio` CLI** (`status [--json]`, `stop --all`, `resume`; plus `service install|uninstall`, which runs locally and needs no daemon, `api.json` or Keychain): reads `api.json`, checks its pid is alive (`kill(pid, 0)`; `ESRCH` or `EPERM` mean "not running") before it reads the token or sends anything, and only ever connects to `127.0.0.1`. Residual risk: after a `kill -9` of the daemon, if the OS reuses both that pid (for one of this user's processes) and the port (for another local listener), the CLI would still send the token there. The pid check narrows this case but doesn't close it; launchd restarting the daemon (item 09) rewrites `api.json` on start.
- **Graceful daemon stop** (SIGTERM/SIGINT): close the API, stop the loop, stop every session in `shutdown` mode (the same kill as a stop, but a running session ends `interrupted` with `kernel_shutdown`, resumable after the restart, so a graceful stop never loses more than a `kill -9` would; a group that cannot be confirmed gone is handled as in the kill switch and left flagged for the next boot's reap), remove `api.json`, close the store.

## Auth (D15, D16, D27, D29)

- A pluggable provider interface: `subscription-token`, `api-key` (Keychain); `bedrock`, `vertex` later (D16).
- **`subscription-token`** (D15, D27): a long-lived token the user creates with `claude setup-token` in their own terminal, read from the macOS Keychain item `loomwright-studio-oauth` and passed to each session as `CLAUDE_CODE_OAUTH_TOKEN`. Sessions run fully isolated: `settingSources: []`, Loomwright loaded by path, nothing else of the user's (D27, proven in Q4). Studio never runs a login flow of its own (invariant 6).
- The `subscription-token` provider strips `ANTHROPIC_API_KEY` from the child environment, because a key wins over the token and would silently move billing to the API (D27, Q2).
- The token lasts one year; the kernel checks for expiry and notifies before it lapses (D27). Token entry checks the prefix and length before saving, since a cut-off token fails with a 401 (Q4).
- **Personal build only.** The `subscription-token` provider is compiled out of any distributed build, which supports only API keys and 3P providers (D29).
- `api-key` sets `ANTHROPIC_API_KEY` from the Keychain (Q2); it's also the per-playbook opt-in fallback at the cap (D28). The API-key path is stub-tested until a commercial launch (D16).
- **The kernel runs as a per-user launchd agent** (item 09, D11). `studio service install` (macOS only) writes one plist, `~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`, and loads it with `launchctl bootstrap gui/<uid>`; `studio service uninstall` boots it out and removes that file. Nothing else in `LaunchAgents/` is read or touched. The plist runs the built `daemon.js` with the absolute `node` path, `RunAtLoad`, and `KeepAlive` = `{SuccessfulExit: false}`: launchd restarts the kernel after a crash or `kill -9`, not after a graceful SIGTERM stop. stdout and stderr go to `<dataDir>/logs/kernel.{out,err}.log`. Its environment holds only `STUDIO_DATA_DIR` (always the absolute data dir its logs go under, so the daemon uses the same dir the install chose) and, when set, `STUDIO_AUTH_PROVIDER`, never a token: credentials are read from the Keychain at start. Still open (owner, `docs/OPEN_QUESTIONS.md` "Phase 1 exit: live run"): that the Keychain reads work under launchd without a terminal (Q2).

## Loomwright adapter (D13)

- Resolves the **active** plugin install location. Beware: the desktop app and the CLI install plugins in different places, and `~/.claude/plugins/cache/` can hold stale leftovers.
- On start, and whenever the version changes: parse the manifest, frontmatter, changelog and result schemas, and build the capability manifest.
- When the version changes, compare the changelogs and tell the user about new features, offering playbooks for them.
- Reads Loomwright's structured outputs only.

## Prior art

`reference/SDK_RUNNER_SPIKE.md` (from the Loomwright repo) records a verified SDK capability matrix and the open questions about hooks, skills and memory for SDK-spawned agents. Read it before designing the session manager.
