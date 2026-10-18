# 04 — Token limits and sessions at once, per agent, from each agent's own settings

## Status: ready

**Priority:** MVP · ROADMAP phase 4 "budget" · D24, D26, D17, invariant 1

**As** the owner,
**I want** each agent's tokens per day and sessions at once read from that agent's settings and enforced at session admission,
**so that** a crew member can't spend the shared weekly cap or run more sessions than I allowed.

## Problem

The budget meter already counts tokens per agent and day (D26) and can refuse an agent's new starts at a daily limit (`agent_daily_limit`). But the limits come only from the static `agentDailyTokenLimits` map in `kernel/src/budget/types.ts`, which the kernel never fills (`new Budget({store, authProvider}, {now})`, `kernel/src/kernel.ts:233`), so no agent is ever limited. No sessions-at-once limit exists at all, although the safety kernel names "a limit on concurrent sessions" (ARCHITECTURE, Safety kernel).

## Owner decisions (2026-10-18, binding)

Recorded 2026-10-18 in the product-owner session (every option the owner chose was the one proposed). Each item carries this copy.

- **Creation from chat = a held tool the kernel applies.** Wright drafts a charter from the owner's sentence and calls `kernel_agent_create`. The gate always holds it, and `studio approvals` shows the whole charter. The owner's `once` makes the kernel create the agent itself, as a kernel-applied action: phase 3 item 10's lesson is that an approved state change never depends on a model retrying a call. The owner can also create a member from a charter file of their own: `studio agents create --from <file>`. No role presets (D22, invariant 9).
- **Storage = role.md + a config JSON + a table row.** `memory/<id>/role.md` is the prose charter the agent reads: identity, persona, duties, boundaries. `config/agents/<id>.json` holds the enforced settings in `wright.json`'s shape: model, effort, permission mode, tool policy, the `never` list, limits and workspaces. It sits under `config/`, which no session may write. An `agents` table row is the registry: id, display name, avatar, status. The kernel enforces only the JSON and the table, never the prose.
- **Changes = the owner directly; Wright only proposes.** The owner changes a member's settings by editing the file or with `studio agents set`. Wright may propose a change with `kernel_agent_update`, which is always held and applied by the kernel on the owner's `once`. A crew member can never change its own settings or anyone else's.
- **Limits (D24) are optional, and unset means no limit.** `limits.tokens_per_day` and `limits.sessions_at_once`. Wright proposes values in a draft (shown as proposed), and the kernel picks none (invariant 1). At the sessions-at-once limit, a new start for that agent is parked and runs once one of its sessions ends, the same way the daily limit parks.
- **Boundaries = the allowlist plus a kernel-enforced `never` list.** The tool policy stays an allowlist (tools and Bash prefixes). The settings add a per-agent `never` list drawn from a closed set of the rail's outward categories: push, PR and issue writes, `gh api` writes, alias definitions, settings and hooks writes. A matching call is denied outright (`agent_boundary`). It is never held as an approval and no grant ever covers it. Because it uses the rail's own matchers, `git -c alias…` and other forms the rail recognises are caught too.
- **Routing (D25) = `studio ask --agent <id> "<text>"`.** It queues a message for that crew member, whose own session runs from its own charter, memory and settings. Wright never answers for it. The message rows and exit codes are the same as today's `studio ask`.
- **Delegation = `kernel_agent_message(agent, text)`, not held.** The kernel queues the text for that member, wrapped as untrusted data from `agent:<sender>`. The member's session runs under its own policy, and its reply returns to the sender as a new message.
- **Loop guard = a chain depth the owner sets.** Every delegation and reply carries its chain depth. A delegation past the sending agent's `limits.delegation_depth` is refused (`delegation_depth`, one notify). The field is optional (unset means no limit), Wright proposes a value, and the token limits still apply on top.
- **Crew playbooks = Wright drafts them for a crew member.** Wright may draft a playbook whose owning agent is a crew member. Its dry run, enable and fires run as that member, under its model, policy and limits. Crew members don't draft playbooks.
- **Memory = the member's own files plus shared.** Creating a member creates `memory/<id>/role.md`, `preferences.md`, `people.md` and `lessons.md`. Each is created only if absent, so the owner's edits win. A member's context is its own four files plus `memory/shared/*.md`, never Wright's or another member's. Honest limit: Read, Glob and Grep are allowed by name, not by path.
- **Workspaces = absolute repo paths listed in the settings.** The settings list zero or more absolute repo paths, set by the owner and checked against D31's protected folders and the data dir. A message or delegation may name one of them as the session's cwd. Any other path is refused. With none named, the session runs in `memory/<id>`.
- **Identity = a stable id, a renamable display name, and off.** The id is lowercase and stable: it names the member's folder and config file and is never reused, and `wright` is reserved. The display name and avatar (a D23 creature and a `crew-*` hue; the whale is Wright's) are proposed by Wright and changed by the owner. `studio agents rename` changes only the display name. `studio agents off <id>` stops new sessions and messages for it and never deletes its memory. `studio agents list` and `studio agents show` print the roster.
- **Live exit check = a local repo with a local bare remote.** The repo is a throwaway outside the protected folders, so no GitHub is needed (invariant 5). The owner asks Wright in chat for a comment-only reviewer and approves the create, then tells the reviewer to push. The kernel denies the push (`agent_boundary`, no approval row) and the bare remote's ref is unchanged. The reviewer's `gh pr comment` attempt is held as an approval, which shows commenting is allowed, and the owner denies it.

## Scope

1. **Limits from the agent's settings.**
   - `Budget` takes an `agentLimits(agent)` lookup (`BudgetOptions`). It answers `{tokensPerDay?, sessionsAtOnce?}` and is read at every admission and every metered result, so an owner's edit to `config/agents/<id>.json` takes effect at the next start.
   - The kernel wires it in `kernel/src/kernel.ts` to item 01's `readAgentSettings(dataDir, agent)`. Its `limits.tokens_per_day` and `limits.sessions_at_once` apply to Wright and to crew alike.
   - A settings file that can't be read or is invalid fails closed: `settings_invalid` or `settings_missing` refuses the start, rather than reading as "no limit".
   - The static `agentDailyTokenLimits` map stays valid for existing tests but is consulted only when no lookup is given.
2. **Tokens per day** keeps today's `agent_daily_limit` semantics exactly: counted tokens are input + output + cache writes (D26); a start at or over the limit is refused, with `retryAt` the next budget day; a resume is not refused; there is one notify per agent-day; a running session finishes its turn.
3. **Sessions at once** (new; admission reason `agent_sessions_at_once`):
   - A `start` for an agent whose live sessions already equal its `sessions_at_once` is refused. Live means rows in `starting`, `running` or `orphaned`: an orphan may still be alive, so it counts, which fails closed.
   - A resume counts too: resuming an interrupted session adds a live one.
   - The refusal's `retryAt` is "when one ends". The admission refusal carries a retry time that the loop's park rule turns into `not_before`, so it uses a short recheck interval rather than a guess. The loop's existing rule then parks the event once with no second notify (D17), and the first refusal per agent per hour appends one `notify`.
   - Two starts admitted back to back can't both pass a limit of 1: the count and the admit happen in one store transaction, and the count includes sessions this kernel has admitted but not yet written. If that needs a change in `kernel/src/sessions/manager.ts`, stop and say so; don't edit it.
4. **The playbook gate** (`Budget.checkPlaybook`) applies the agent's sessions-at-once in the same order slot as the agent's daily limit (`docs/architecture/budget.md`, step 4): a playbook fire for a crew member at its limit is parked, not dropped.
5. **Docs:** `docs/architecture/budget.md`: the per-agent section (the source of limits, both refusals, the live-session definition, the honest limits) and the new event and reason names.

## Non-goals

- Dollar limits (D24: none on the subscription build). The D28 fallback ceiling stays per playbook.
- `studio status` per-agent lines (item 02's `list` shows tokens and sessions per agent).
- `limits.delegation_depth` (item 06).

## Acceptance criteria

- [ ] Given `config/agents/mason.json` with `limits.tokens_per_day: 1000` and 1,000 counted tokens today, when a start for `mason` is requested, then it is refused `agent_daily_limit` with `retryAt` the next local midnight, with one `notify` that day. Given no `limits`, then it is admitted whatever the count.
- [ ] Given `limits.sessions_at_once: 1` and one `running` session for `mason`, when a second start is requested, then it is refused `agent_sessions_at_once` and its event is parked. When the first session ends and the recheck comes due, then the parked event starts its session.
- [ ] Given `limits.sessions_at_once: 1` and an `orphaned` session for `mason`, when a start is requested, then it is refused.
- [ ] Given `limits.sessions_at_once: 1` and two starts for `mason` requested in the same tick, then exactly one is admitted.
- [ ] Given Wright's `wright.json` with `limits.sessions_at_once: 1`, then Wright is limited the same way. Given a `wright.json` with no `limits`, then every existing budget and brain test passes unchanged.
- [ ] Given a `mason.json` that becomes invalid JSON, when a start is requested, then it is refused (fail closed) with the settings reason, never admitted as unlimited.
- [ ] Given an enabled playbook owned by `mason` at its sessions-at-once limit, when it fires, then the fire is parked, not dropped and not run.
- [ ] `budget.md` documents both limits, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The recheck interval for a sessions-at-once park is a kernel retry cadence (like the cap's hourly recheck), not a policy: it only decides how soon admission is asked again.

## Risks

- `orphaned` rows counting as live can block an agent until the owner abandons the orphan. That is the safe direction, and the refusal's detail names the orphan's session id and `studio session abandon`.

## Depends on
2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md

## Touches
kernel/src/budget/
kernel/src/kernel.ts
kernel/test/budget-agent-limits.test.ts
docs/architecture/budget.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-18T18:37:39Z
- **Brief:** .supervisor/jobs/done/2026-10-18-token-limits-sessions-at-once-per-agent.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/86
