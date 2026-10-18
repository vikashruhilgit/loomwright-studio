# 03 — A crew member's `never` list is denied outright, before any approval or grant

## Status: ready

**Priority:** MVP · ROADMAP phase 4 "Tested: a comment-only reviewer can't push" · D5, D8, invariant 3

**As** the owner,
**I want** a call matching an agent's `never` list denied by the kernel, never held as an approval,
**so that** "comment-only, can't push" is a boundary I can't approve away by mistake, and a policy that lists `git` for `git diff` still can't push.

## Problem

Today a session's policy is an allowlist. When it allows a Bash prefix that can push (`git`, so that `git diff` and `git log` work), the rail recognises the push and holds it for the owner's approval (`approval_required`, `docs/architecture/approvals.md` "The outward set"). The owner can then approve it, and a standing grant could cover it. For a comment-only reviewer that is the wrong answer. The push must be impossible, not merely asked about. Item 01 adds `never` to `ToolPolicy`, the closed `NEVER_CATEGORIES`, and a `boundaryDecision(policy, classification)` stub that the gate already calls after the rail classifies a call as outward and before any grant or hold. This item makes that function decide.

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

1. **`boundaryDecision`** (`kernel/src/sessions/policy.ts`, pure): given the session's policy and the rail's classification of a call the policy allowed, it returns a deny with reason `agent_boundary` and the matched category when the call's outward action is in the policy's `never` list. Otherwise it returns no boundary.
   - The categories map one-to-one onto the rail's existing action labels (item 01), so every form the rail recognises as a push is `git_push`: `git push`, `git --attr-source X push`, `git subtree push`, `git lfs push`, `send-pack`, `http-push`, a globbed `git pu*`, `git-push` and the rest. No new matcher is written.
   - A call the rail reads as several outward forms is denied when any of them is in `never`.
2. **The order is fixed.** The gate already calls this function (item 01), and the order it runs in is:
   1. the policy;
   2. the unreadable-Bash deny;
   3. protected kernel paths;
   4. the merge block;
   5. **the boundary**;
   6. one-shot grants, standing grants and the hold.

   So a boundary deny is recorded as one `tool_decision` event (`decision: deny`, `reason: agent_boundary`, plus the category). It writes no approval row, uses no grant, and its reason text tells the model that the owner's settings forbid this for this agent and not to ask for an approval or retry. A matching standing grant, which can exist if the owner added the category after granting, never lets the call through.
3. **The reason joins the public union.** `ToolDecisionReason` gains `agent_boundary`, and the gate's reason text is pinned.
4. **Docs:** `docs/architecture/approvals.md` "The rail": the boundary step in the order, the category table (category → the rail forms it covers), and the honest limits. A program that runs other programs (`env git push`, `sh -c`, `xargs`, a script or Makefile target, a pre-defined alias) is not recognised by the rail, so it is not covered by `never` either. Listing such a prefix grants what it can run, exactly as the safety-kernel section already says.

## Non-goals

- Reading `never` from an agent's settings file: item 01's reader returns it, and items 05 and 08 pass it in the session's policy. The tests here pass policies directly.
- New outward forms. The set is the rail's; widening it is its own change.

## Acceptance criteria

- [ ] Given a policy allowing the Bash prefix `git` with `never: ["git_push"]`, when the session runs `git push origin main`, `git -c alias.p=push p`, `git subtree push` or `git pu*`, then each is denied `agent_boundary` (category `git_push`), with exactly one `tool_decision` event, no approval row and no `approval_used` or `approval_grant_used` event.
- [ ] Given the same policy, when the session runs `git diff` or `git log`, then each runs as before.
- [ ] Given `never: ["git_push"]` and a policy allowing `gh pr comment`, when the session runs `gh pr comment 3 -b x`, then it is held as an approval exactly as today, so the boundary never widens or narrows anything outside its categories.
- [ ] Given a standing grant whose exact payload is a push, and a policy that now has `never: ["git_push"]`, when the identical call is made, then it is denied `agent_boundary` and the grant is not used.
- [ ] Given a policy with no `never`, when any outward call is made, then every existing rail test passes unchanged.
- [ ] Given the merge block and a boundary both matching (`gh pr merge` with `never` naming PR writes), then the call is denied `merge_blocked`, which comes first in the order.
- [ ] `approvals.md` documents the step, the table and the limits, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Item 01's call site is already placed between the merge block and the grants. If it isn't, stop and say so; don't edit `manager.ts` (it is item 01's).

## Risks

- A category mapping that misses one of the rail's labels would let that form through to a hold rather than a deny. The test iterates every label the rail can emit and asserts that each one maps to a category.

## Depends on
2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md

## Touches
kernel/src/sessions/policy.ts
kernel/test/sessions-policy.test.ts
kernel/test/sessions-boundary.test.ts
docs/architecture/approvals.md
