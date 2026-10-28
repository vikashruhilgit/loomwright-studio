# Draft mode

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 07** (draft mode records outward calls instead of sending them), in the integrations feature's `drafts.ts` part (`kernel/src/integrations/drafts.ts`), the pure decisions in `kernel/src/sessions/draft-mode.ts` and the session gate (`SessionManager.#gate`, `kernel/src/sessions/manager.ts`).

**Routes** (owner-only, bearer token like every route):

| Route | Answers |
|---|---|
| `GET /drafts[?agent=…][&playbook=…][&item=…][&limit=N]` | `{drafts}`: the matching draft outputs, newest first (`ORDER BY id DESC`) |
| `GET /drafts/:id` | `{draft}`: one draft output |

`agent` and `item` are non-empty strings of at most 512 characters, `playbook` is a positive integer written in digits, and `limit` is 1-200 (default 50). Anything else answers 400 `{error: "invalid_query", message}`. A non-integer `:id` answers 400 `invalid_query`, and an id with no row answers 404 `{error: "no_draft"}`. Paging is `limit` only: the contract's `DraftsQuery` has no cursor field, and adding one is a contract change (a follow-up could add `before`). Each draft carries exactly the contract's keys; `payload` is the stored JSON parsed, or null if it does not parse. A row never holds a secret (a connector's token lives only in the Keychain, and sessions get no `GH_TOKEN`).

**Contract types it fills** (`app/src/api/contract.ts`): `DraftOutput`, `DraftsQuery`, `DraftsResponse` and `DraftDetailResponse`.

## The field

A playbook's `mode` (`PLAYBOOK_MODES`: `draft` or `live`, default `draft`) is the user's policy, set like the playbook's other fields and owner-locked the same way: Wright only proposes it. The kernel only enforces it. `live` is not built in phase 6: setting it is refused `live_mode_not_in_phase_6`. A stored `live` (written only by direct SQL, as a test does) skips the draft step, so holds and grants apply as before.

The session manager puts the playbook's `mode` into the session's policy (`ToolPolicy.mode`) at every start and resume, and the agent's `connectors` beside it. A session with no playbook (a chat turn, an ask) has no `mode`, so draft mode never applies to it. A stored mode outside `PLAYBOOK_MODES` reads as `draft`, the mode that sends nothing. Because every playbook is `draft` by default, a playbook session's outward call that was held for approval is now recorded as a draft instead.

## Deny order

The session gate decides every tool call in this order; the first step that answers decides it, and each call records exactly one `tool_decision` event:

1. **The policy** (`decideToolUse`), then, only after an allow, **the rail** (`classifyToolCall`). A rail deny (`protected_kernel_path`, `merge_blocked`, `bash_shell_metacharacter`, `bash_command_too_large`) wins over everything below, so `gh pr merge` stays `merge_blocked` in a draft session, with or without the `github` grant, and no draft is written.
2. **The never boundary** (`agent_boundary`). The owner's explicit `never` for the agent wins over draft: a forbidden call is denied, not stored as a draft. Nothing is sent either way.
3. **The dry run** (`dry_run`). A dry run already denies every outward call and records it as a would-do, so a dry run of a draft playbook keeps that and writes no draft row, except a forced-draft dry run (a poll playbook's review, see [dry-run](dry-run.md#poll-playbooks)), which takes step 4 and writes one.
4. **Draft mode** (`draft_mode`): the session's `mode` is `draft` and the rail answered outward. This is every outward kind: the recognised `git push` and listed gh write forms, a non-GET `gh api`, the always-held kernel tools (such as `kernel_playbook_enable`) and the path labels (a Write to `~/.claude/settings.json`). A gh write outside the rail's list, such as `gh repo delete`, is not recognised, so draft mode does not catch it (see [open questions](../OPEN_QUESTIONS.md#technical-verify-dont-assume)). The call is recorded (below) and denied without asking the owner. No grant is looked up, no approval is written and the pre-hold check does not run, so an `always` or a once-approved grant for the exact call is not used.
5. **The GitHub CLI deny** (`use_kernel_github_tools`): the agent holds the `github` grant (`policy.connectors`), the tool is Bash and the command's program could be `gh`. It applies whether or not the policy allowed the call (it only denies, so it never widens a policy, and the model learns to use the kernel's tools). It comes after draft, so a granted draft session's `gh pr comment` is still recorded as a draft. A session without the grant may still run `gh pr view`. A Bash command longer than the rail's size limit (8192 characters) is denied `use_kernel_github_tools` unread in a granted session: a policy-denied call never reaches the rail's own size guard, and this keeps the deny from parsing it.
6. **The outward hold or grant** (`approval_required` / `approval_granted`), unchanged.
7. Anything else, as the policy says.

The program is read as the rail reads it: the first non-empty brace-expanded shell word, its basename, case-folded, compared as a glob. So `gh`, `/usr/bin/gh`, `GH` and `g{h,x}` are caught, and so is a policy-denied `gh pr view 1 | cat`. `env gh …`, `sh -c …` and a script are not recognised: the rail's documented limit, since allowing such a program grants what it can run. The owner's policy chooses the prefixes.

The hook texts are exact: `draft_mode: this playbook runs in draft mode, so the kernel did not send this call; it saved it as draft output <id> for the owner to read. Nothing was posted. Do not retry it and do not ask for an approval.` (`draftDenyReason`), and `use_kernel_github_tools: this agent reads GitHub through the kernel, so gh does not run in its sessions. Use kernel_github_pr_get, kernel_github_pr_diff, kernel_github_pr_files and kernel_github_pr_comments instead.` (`GITHUB_CLI_DENY_REASON`; the tools are item 06's, named here as text only).

## What is recorded

Under `draft`, the kernel records the call as one `draft_outputs` row (migration 17) and appends one `draft_output_recorded` event, which the agent's thread shows as a card ([threads](threads.md#the-event-kinds)). Nothing is sent. The row, the event and the call's one `tool_decision` event (`reason: "draft_mode"`, plus `draft_output_id`) are written in one transaction. If any write throws, all of it rolls back and the call is denied `kernel_gate_error` (fail closed): the deny is still a deny, and nothing is sent either way.

| Column | Holds |
|---|---|
| `session` | the session id |
| `agent` | the session's agent, or `unknown` for a session with none (as the approvals do) |
| `playbook` | the session's playbook |
| `playbook_run`, `item_ref` | the newest `playbook_runs` row whose `session_id` is the session; both null when there is none (a call can arrive before the run's `session_id` is written) |
| `tool` | the rail's action label (`gh pr review`, `gh pr comment`, `gh api POST`, `git push`, `kernel_playbook_enable`, …) |
| `payload_json` | the bounded payload below |

**The payload** is model output built from PR text: untrusted data. It is stored as JSON text, never interpreted and never put into an event. Its `kind` is one of four:

- `gh_pr_review` / `gh_pr_comment`: `{kind, tool: "Bash", command, cwd, target, body, body_file?, event?, truncated}`. `target` is the first positional word after the subcommand that is not a flag or a flag's value, or null (the value flags are `-b`/`--body`, `-F`/`--body-file` and `-R`/`--repo`; `--body=…` and `-bVALUE` are read too). `body` is the last `-b`/`--body` value, or null. `body_file` is a `-F`/`--body-file` value, recorded and never read. `event` is `approve`, `request_changes` or `comment` from `-a`/`--approve`, `-r`/`--request-changes`, `-c`/`--comment` (review only).
- `command`: any other Bash call, `{kind, tool: "Bash", command, cwd, truncated}`.
- `input`: any other tool, `{kind, tool: <tool name>, input_json, cwd, truncated}`, where `input_json` is `JSON.stringify` of the tool input.

Every text field is cut to `MAX_DRAFT_TEXT_CHARS` (65,536) and `truncated` is `true` when anything was cut. A Bash command is already at most 8,192 characters, so in practice only a tool's input is ever cut.

The event is `draft_output_recorded` `{draft_output_id, tool, summary}`, where `summary` is the action and its target (no body text) clipped to 200 characters.
