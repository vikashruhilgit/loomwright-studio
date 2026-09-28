# Architecture

Status: design, pre-code. Decisions referenced as D# are in `DECISIONS.md`.

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
| `sessions` | id, agent, task, SDK session id, status, started, tokens/cost |
| `approvals` | id, action, exact payload, requested, decided by, decision (once / always-for-this-playbook / deny) |
| `hooks_installed` | id, scope (session / project / global), file, diff, backup path, verified-fires flag |
| `connectors` | id, kind, status, scopes (all optional; D12) |
| `events` | append-only audit log of everything the kernel did |
| `budget` | usage per day, per playbook, per agent, per session |

**Memory is markdown, not the database** (invariant 8): `memory/<agent>/role.md`, `preferences.md`, `people.md`, `lessons.md`, one handoff note per task, plus `memory/shared/` for things every agent should know about the user. Users can read, edit and version it.

## Kernel tools (the brain's only levers)

All of these are generic mechanisms; policy is set per playbook (D3, D4).

- `task_create / task_update / task_list / task_get`
- `playbook_create / playbook_update / playbook_disable / playbook_dry_run`
- `trigger_register(type, spec) / trigger_remove`
- `agent_create / agent_update`: propose a new specialist or change one; requires approval
- `session_spawn(agent, task, prompt) / session_stop / session_status`
- `schedule_wakeup(at, reason) / request_stop(handoff)`
- `approval_request(action, payload)`: blocks until the user decides in the app (or a connector)
- `hook_propose / hook_apply / hook_verify` (D6)
- `notify(message)`
- `loomwright_capabilities()`: the adapter's manifest (D13)

Everything else comes from ordinary Claude Code tools (`gh`, MCP connectors, bash, Loomwright commands), limited by the agent's permission policy.

## Main loop

1. An **event** arrives: a trigger fires, the user sends a message, or a wake-up comes due.
2. The kernel logs it and checks budget and cap state. If over a limit, it parks the event and notifies; no retries (D17).
3. It checks the playbook's dedupe key against past work (if the user defined one) and drops duplicates.
4. It **starts or resumes** the right agent's session: resume if a task is in flight, otherwise fresh, with role, memory, the Loomwright manifest and the event.
5. The agent decides what to do: answer, create tasks, draft or edit a playbook, start specialists.
6. Outward or persistent actions go through the **approval gate**. "Always allow" is stored per playbook, never globally.
7. The session ends with `request_stop`: the kernel writes the handoff note, updates tasks, and schedules the next wake-up.

## Safety kernel (fixed; D5)

- **Per-agent permission policy.** Wright is read-mostly. Builders write only in git worktrees. Reviewers comment only. No agent ever gets `bypassPermissions`.
- **Kernel-side SDK hook callbacks the brain can't edit:**
  - block `gh pr merge` outside Loomwright's sanctioned gate
  - block pushes to protected branches
  - block writes to kernel files and to global settings without approval
- **Untrusted input is data.** PR bodies, comments and ticket text reach the model as quoted data. There's an injection test in the roadmap.
- **Budget ceilings.** Per day, per playbook and per agent, plus a limit on concurrent sessions. Fails closed: park and notify.
- **Kill switch.** `studio stop --all` / the menu-bar button aborts every session and disables every trigger.

## Auth (D15, D16)

- A pluggable provider interface: `subscription` (uses the Claude Code login already on the machine, personal build only, never a login UI of our own), `api-key` (Keychain), `bedrock`, `vertex`.
- The API-key path is stub-tested until a commercial launch.

## Loomwright adapter (D13)

- Resolves the **active** plugin install location. Beware: the desktop app and the CLI install plugins in different places, and `~/.claude/plugins/cache/` can hold stale leftovers.
- On start, and whenever the version changes: parse the manifest, frontmatter, changelog and result schemas, and build the capability manifest.
- When the version changes, compare the changelogs and tell the user about new features, offering playbooks for them.
- Reads Loomwright's structured outputs only.

## Prior art

`reference/SDK_RUNNER_SPIKE.md` (from the Loomwright repo) records a verified SDK capability matrix and the open questions about hooks, skills and memory for SDK-spawned agents. Read it before designing the session manager.
