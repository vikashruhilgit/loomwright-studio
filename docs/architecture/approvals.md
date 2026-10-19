# Approvals

The approval gate (phase 2, D5, D7, invariant 3): an outward or persistent action an agent attempts waits for the owner's decision, which the owner gives from the terminal. The session is never kept running while it waits. Code: `kernel/src/approvals/` (the tool, the record, the routes, the CLI) and the kernel's `PreToolUse` rail in `kernel/src/sessions/policy.ts` (`classifyToolCall`, pure) and `kernel/src/sessions/manager.ts` (the gate). Table: `approvals` (migration 11, plus `approvals.playbook` from migration 13, see the [data model](../ARCHITECTURE.md#data-model)). Phase 3 adds [standing grants](#standing-grants-always-per-playbook-version): "always", for one playbook version and one exact call, revocable by the owner.

It is a mechanism (invariant 1): no approval, grant or rule is preinstalled. The outward set and the deny sets below are part of the fixed safety kernel: they are code, not settings, and no agent can edit them (invariant 3). A payload is untrusted data: stored exactly as given, shown as data, never executed or interpolated.

## Two ways in

| Source | What creates the approval |
|---|---|
| The rail | A tool call the session's policy **allows** that falls in the fixed outward set (below). It does not run: the hook denies it with `approval_required`, and the reason it gives the model names the approval id, says the decision arrives as a new message, and says to end the turn and, if approved, run exactly the same call again once; for a [kernel-applied action](#kernel-applied-actions) it says instead that the kernel applies it and that message says what it did, so the call is not repeated. |
| `kernel_approval_request(action, payload, idempotency_key)` | An agent asks before acting. `action` is 1-200 characters with no NUL (refused at argument validation, since it goes into the approval's notification, which refuses one); `payload` is a JSON object (at most 64,000 characters as JSON). It returns at once with `{id, status: "pending", action, message}`, where the message tells the agent the decision arrives as a new message and to end its turn. It runs as one work step keyed `kernel_approval_request:session-<id>:<idempotency_key>`, so a repeat with the same key in that session returns the same approval (with its current status) and records nothing new. |

Either way, one transaction writes the `pending` row (`requesting_agent` is the session's agent, or `unknown` for a session with none; `requesting_session`; `action`; `payload_json`, the payload as canonical JSON with object keys sorted; `playbook`, the requesting session's `sessions.playbook`, null for a session with none), one `approval_requested` event (`{id, action, source: "rail" | "tool", agent}`, plus `playbook` and `playbook_version`, the session's, when the session has a playbook) and one notification with source `kernel:approval` ([notifications](notifications.md)). Before any of it, `requestApproval` refuses an action that is empty, longer than 200 characters or holds a NUL, or an agent name that holds a NUL, as `invalid_approval`, and writes nothing (on the rail, that throw denies the call with `kernel_gate_error`).

An approval an agent requested through the tool never lets a tool call through the rail, even if its payload looks like one. Only an approval the rail itself held is a grant.

## The rail

The kernel's one `PreToolUse` hook decides every call in order:

1. **The session's policy** (`decideToolUse`, unchanged from phase 1). A call the policy denies is denied as before. The sets below apply only after the policy allowed the call, so they never widen a policy.
2. **A Bash command the rail will not read: denied, whatever the policy, never an approval.** One holding any control character other than tab (C0, DEL, C1: vertical tab, form feed, NUL, escape, NEL, …), any Unicode space or line/paragraph separator other than the ASCII space (no-break space, em space, U+2028, …) or any format character (zero-width space or joiner, bidi controls, the BOM, a soft hyphen) is denied with `bash_shell_metacharacter`: bash splits words only on space and tab, so such a character could make the shell see one word where a reader sees two (`cp evil x<VT>/../../../.claude/CLAUDE.md`), or hide a word from the owner. An emoji built with a zero-width joiner is refused too. One longer than 8,192 characters, or whose words hold more than 262,144 characters of path text (the summed length of the distinct texts read as paths, below; a slash-heavy word reads about n²/4), is denied with `bash_command_too_large`, before it is read, which bounds the rail's synchronous cost in the hook. A realistic long command (a 2,000-character `npm test -- <files>`) is well inside both.
3. **Protected kernel paths: denied, whatever the policy, never an approval** (`protected_kernel_path`). A Write, Edit or NotebookEdit whose path is, or a Bash command any of whose words names or could expand to (see [the forms below](#which-command-forms-the-matcher-recognises)):
   - the data dir itself;
   - anything under `<dataDir>/config/` (each agent's settings) or `<dataDir>/app/` (the kernel's install copy);
   - `<dataDir>/studio.db`, `studio.db-wal`, `studio.db-shm`, `studio.db-journal`, `studio.lock`, `studio.lock-journal`, `studio.lock.pid` or `api.json`.

   A Bash command that only names such a path (`cat …/api.json`) is denied too: the rail cannot tell a read from a write in a shell command.
4. **The merge block: denied, whatever the policy, never an approval** (`merge_blocked`, invariant 4: Studio merges only through Loomwright's sanctioned gate). `gh pr merge …` in any form, and `gh api`:
   - reaching a pull request's `…/pulls/<n>/merge` with a non-GET method (or a flag the rail cannot account for that could be one). The endpoint is compared with its `?query` and `#fragment` cut off, percent-decoded, with empty, `.` and `..` segments normalised, and as a glob (`merg*`, `{merge,x}`);
   - naming the GraphQL `mergePullRequest`, `enablePullRequestAutoMerge` or `enqueuePullRequest` mutation;
   - sending a GraphQL query whose text the rail cannot read: `gh api graphql` (or any `…/graphql` endpoint) with a field read from a file (`-F query=@file`, `--field=…=@…`), `--input`, a globbed word, or a flag the rail cannot account for.
5. **The agent's boundary: denied, whatever any grant says, never an approval** (`agent_boundary`, phase 4, invariant 3). A call the rail reads as an outward form (step 6) in one of the session policy's `never` categories is denied outright, before any grant is looked up or any hold is written: see [the never boundary](#the-never-boundary). The merge block and protected paths come first, so `gh pr merge` is `merge_blocked` whatever `never` names.
6. **The outward set: held as a pending approval** (`approval_required`), unless an unused one-shot grant or a standing grant matches exactly (`approval_granted`, see below):
   - git with any word after `git` that is (or could expand to) `push` (`git push`, `git --attr-source X push`, `git subtree push`, `git lfs push`), `send-pack`, `http-push`, `dcommit` or `set-tree` (git svn), `send-email`, `imap-send` or `cvsexportcommit`, or `submit` after `p4`. Over-holding (`git commit -m push`) is the safe direction;
   - an alias definition that could make a later allowed call push or merge under another name: `gh alias set|import`, and git with any word holding `alias.`, `include.path` or `includeIf.` (`git -c alias.p=push p`, `git config alias.p push`), `help.autocorrect` (`git -c help.autocorrect=immediate psuh` runs as a push), or `--config-env`;
   - `gh pr create|comment|review|edit|close …` and `gh issue create|comment|edit|close …`, with gh's built-in `new` alias read as `create` (`gh pr new`, `gh issue new`);
   - `gh api …` with a non-GET method: `-X`/`--method` (also `-XPOST`, `--method=POST`) other than GET, or, with no explicit method, any `-f`, `-F`, `--field`, `--raw-field` or `--input` (gh sends those as POST), or a flag the rail cannot account for (`gh api (flag unread)`). A single-dash word is read as pflag reads it, a group of short flags: `-i` is a bool, and the first of `X`/`f`/`F`/`H`/`p`/`q`/`t` takes the rest of the word (after an optional `=`) or, for `X`/`f`/`F`, the next word, so `-iX PUT`, `-iXPUT`, `-X=PUT`, `-if body=x` and `-iF query=@f` are all read. A group holding any other character (a glob, an unknown letter) is unread;
   - a Write, Edit or NotebookEdit to, or a Bash command naming or globbing, anything under `~/.claude/`, any `settings*.json`, any `hooks.json`, or anything under a `.git/hooks/` dir or a `hooks` dir inside a `.claude` dir. A `*` could expand to a `settings.json` in the cwd, so `ls sub/*` is held too (`*.ts` is not), and a bare `ls *` is denied (see [relative paths](#relative-paths-fail-closed)).
7. Anything else runs as the policy says.

Every call still records exactly one `tool_decision` event (with `approval_id` when one was held or used, and `category` on an `agent_boundary` deny). The gate fails closed: if creating the approval, consuming a grant or recording the decision throws, the whole transaction rolls back and the call is denied with `kernel_gate_error`.

### The never boundary

A session policy may carry `never`: categories from the closed `NEVER_CATEGORIES` list in `kernel/src/sessions/policy.ts`. Which categories a crew member never takes is the owner's setting (invariant 1); the kernel ships none as a default, and with no `never` (or an empty one) the rail decides exactly as before. The gate asks `boundaryDecision` (pure) about every call the rail answered outward, before the dry-run branch, the pre-hold check and any grant or hold. A call in a `never` category:

- is denied `agent_boundary`, with one `tool_decision` event whose payload carries `category`;
- writes no approval row and uses no grant: a one-shot or standing grant whose exact payload matches (one can exist when the owner added the category after granting) never lets it through, and no `approval_used` or `approval_grant_used` event is written;
- in a dry run, is denied the same way, with no would-do entry;
- gets this hook reason, which names the category, says the owner's settings forbid it for this agent, and tells the model not to ask for an approval or retry (`boundaryDenyReason`): `agent_boundary: <category> is in this agent's never list. The owner's settings forbid it for this agent; it did not run. Do not ask for an approval and do not retry it.`

A call the rail reads as several outward forms is denied when any of them is in `never`: a gh flag read both ways (`gh pr -b create comment 3` is a comment or a create), an inline alias beside a push (`git -c alias.x=y push`), a push naming a path under `~/.claude/`, or a Write to `~/.claude/hooks/x.sh` (both `~/.claude/` and a hooks file). The event names the first matching category in the table's order. The approval and its action are unchanged: the extra forms are only read by the boundary.

The categories use the rail's own matchers (step 6 and [the forms below](#which-command-forms-the-matcher-recognises)); no new matcher is written:

| Category | The rail forms it covers |
|---|---|
| `git_push` | every form step 6 reads as `git push` (`git push`, `git --attr-source X push`, `git subtree push`, `git lfs push`, `git-push`, a globbed `git pu*`), `git send-pack`, `git http-push`, `git svn dcommit`, `git svn set-tree`, `git send-email`, `git imap-send`, `git cvsexportcommit`, `git p4 submit`; and a git alias or autocorrect definition (`git -c alias.p=push p`, `git config alias.p push`), which can run a push |
| `alias_define` | a git alias or autocorrect definition (the forms above), `gh alias set`, `gh alias import` |
| `gh_pr_create` | `gh pr create`, `gh pr new` |
| `gh_pr_comment` | `gh pr comment` |
| `gh_pr_review` | `gh pr review` |
| `gh_pr_edit` | `gh pr edit` |
| `gh_pr_close` | `gh pr close` |
| `gh_issue_create` | `gh issue create`, `gh issue new` |
| `gh_issue_comment` | `gh issue comment` |
| `gh_issue_edit` | `gh issue edit` |
| `gh_issue_close` | `gh issue close` |
| `gh_api_write` | `gh api` with a non-GET method (`gh api POST`, `PUT`, `DELETE`, …), and `gh api (flag unread)` |
| `settings_write` | a Write, Edit or NotebookEdit to, or a Bash command naming or globbing, anything under `~/.claude/` or any `settings*.json` |
| `hooks_write` | the same for any `hooks.json`, or anything under a `.git/hooks/` dir or a `hooks` dir inside a `.claude` dir |

A merge and a protected kernel path are denied for every session already, so neither is a category. `ALWAYS_HELD_TOOLS` (`kernel_playbook_enable`, `kernel_agent_create`, `kernel_agent_update`) are in no category: they are held as before, whatever `never` names.

**Over-deny, in the safe direction.** Within a `never` category, whatever the rail over-holds is denied: under `git_push`, `git commit -m push` and any git alias definition (a harmless one too) are denied.

**Not covered.** Only the forms the rail recognises are covered. A program that runs other programs (`env git push`, `xargs git push`, `sh -c "…"`, a script or Makefile target, a git or gh alias defined before the session) is not recognised by the rail (see **Not recognised** at the end of [relative paths](#relative-paths-fail-closed), below), so `never` does not cover it either: listing such a prefix grants whatever it can run, exactly as the [safety kernel](../ARCHITECTURE.md#safety-kernel-fixed-d5) says for the Bash allowlist. gh writes outside the outward set (`gh pr ready`, `gh release create`, …) are in no category.

### The pre-hold check

A call to a tool in `ALWAYS_HELD_TOOLS` (`mcp__kernel__kernel_playbook_enable`, and since phase 4 `mcp__kernel__kernel_agent_create` and `mcp__kernel__kernel_agent_update`) gets one more step, after the policy allowed it and the rail answered outward, and before the hold (`SessionManagerOptions.heldToolCheck`, phase 3 item 07). It never runs in a dry-run session: that session's gate denies the call `dry_run` before the approval path. The kernel builds the check from the shipped contributions: a contributed tool may declare a synchronous `beforeHold(args, ctx)` that reads the store only, and the check parses the call's input with that tool's own zod shape first. Every outcome:

| The check answers | The gate |
|---|---|
| nothing (no check configured, or the tool declares no `beforeHold`) | holds the call exactly as before, with no display |
| a refusal, because the input fails the tool's shape | denies it `held_refused` (below) |
| `{refuse}` | denies it with reason `held_refused`: one `tool_decision` event, the refusal text as the model's reason. No approval row is written and no grant is used. |
| `{display, subjectVersion?}` | holds it as before. A new approval's `approval_requested` event gets `display` (cut to 4,000 characters, never refused) and `subject_version`; neither ever enters `payload_json`, so grant matching on the canonical payload is unchanged, and a grant that matches is used exactly as before. |
| a throw, or any other answer (a promise, an empty refusal, an unknown key, a version that is not a positive integer) | denies it `kernel_gate_error` (fail closed) |

It can only narrow: it never allows a call that would be held, never skips the hold and never uses a grant itself. `held_refused` is a gate-local reason like `dry_run` and `kernel_gate_error`, not yet in the public `ToolDecisionReason` union in `kernel/src/sessions/policy.ts`.

**A kernel-applied action's grant is spent by the kernel.** The enable is a [kernel-applied action](#kernel-applied-actions): when the owner approves it `once`, the kernel applies it in the decision and records the grant as used (`approval_used` with `by: "kernel"`) on every apply attempt, applied or refused. So no later call from the agent can use that grant. A retry after the kernel enabled the playbook is refused here (the playbook is no longer a `draft`); a retry after a refused apply (the playbook was edited since) is refused here when the new version has no dry run, and is otherwise held as a new approval. The enable's own handler still checks the approval's `subject_version`, the edit order and a dry run of the current version before it enables ([playbooks: enabling](playbooks.md#enabling)), as a defence for a composition that decides with no applier.

**A used idempotency key is refused before the hold.** An enable's work step stores its result under its idempotency key, so a same-key call after an edit returned the playbook to `draft` could only replay the old result: an approval for it would be spent with no effect. The enable's check refuses such a key (`idempotency_key already used for an enable in this session; use a new key`) with no approval written, and its handler refuses, never replays, a stored result for another playbook or whose `approval_id` is not the approval the call just consumed ([playbooks: enabling](playbooks.md#enabling)).

**The display is untrusted text.** It carries what Wright wrote (a playbook's name) and would-do summaries of the model's tool inputs. `studio approvals` prints it under a `display:` label before `payload:`, each line escaped like the payload (`\xNN`, `\uNNNN`) and indented under the label, so no line of it can fake another label or drive the terminal. `--json` and the API return it as the approval's `display` field, present only when the event has one: an approval without one prints exactly as before.

### Which command forms the matcher recognises

The rail reads a Bash command the way the shell splits it into words (`shellWords`: a space or tab separates words, as in bash, single and double quotes and backslash escapes are read as the shell reads them, adjacent parts join into one word). The policy has already refused shell control and substitution characters (`;` `&` `|` `<` `>` `(` `)` `$`, backtick, newline), so a command is one program and its arguments. The expansions the shell can still apply are read failing closed: a word that **could** expand to a protected, merge or outward form counts as that form.

- **Brace expansion** is expanded (`{a,b}` alternatives, nested and repeated; a `{1..9}` sequence reads as `*`), and one word can become several argv words (`gh {pr,merge} 12` is a merge). More than 64 results read as "any path".
- **Globs:** `*`, `?`, `[…]` (any one character) and a `**` segment followed by another segment (zsh's recursive glob, any depth) are matched as patterns against the protected and outward paths and the subcommand names (`git pu*` is a push). A glob followed by `..` is its parent.
- **The program** is the first word's basename, case-folded: `git`, `/usr/bin/git` and `GIT` are all git, and `git-push` (git's libexec spelling) is `git push`.
- **git:** every word after `git` is read, so no option before the subcommand (`--attr-source`, `--exec-path`, …) can hide a push.
- **Empty words** are not command words: bash removes an unquoted empty word (`{,} gh pr merge`, `gh api -X {,} PUT …`), and cobra skips a quoted one (`''`, `""`) when it looks up a subcommand, so `gh pr '' merge` and `gh '' pr merge` are merges and `gh pr '' comment` is held. Reading every empty word away only over-holds (`gh api -X '' PUT …` reads as `-X PUT`).
- **gh:** the command words are the first two words that are not flags or empty. When gh looks up its subcommand, cobra skips the word after any two-character short flag and any `--long` flag without `=` (an unknown one included), and pflag the word after a short group ending in `R`; so every such flag, and a globbed flag (`-[R]`), is read both as taking the next word and as not, and a merge (then an outward form) in any reading wins: `gh -R o/r pr merge 12`, `gh pr -b view merge 12` and `gh pr -hR o/r merge 12` are merges. Only `-h`, `--help` and `--` are read as taking no value. More than 64 readings read as a merge.
- **Paths:** a word is read as every path a program could take from it: the word itself, raw and percent-decoded (`file:///…/Loomwright%20Studio/api.json`), with a `?query` / `#fragment` cut off when it holds a `:`; the part after every `=` (`--file=…`), `@` (`curl -d @file`, `-d@file`) and `:` (`file:api.json`); the rest of a glued short option (`-C/path`); and every substring starting at a `/` (`file:///abs`, `-d@/abs`, `prefix/abs`) or at a `~/` inside the word. `~` and `~/…` expand to the home dir, `~+` to the cwd, and any other `~…` (`~user`, `~-`, a named dir) to "any directory"; anything else is a relative path, read as described [below](#relative-paths-fail-closed). Paths compare case-insensitively (APFS is by default) on a path-segment boundary, after `..` is applied and a leading `/System/Volumes/Data` firmlink is removed (the same rule as the protected-folder check in `kernel/src/protected-paths.ts`). A Write, Edit or NotebookEdit path is not shell-expanded: its characters are literal.

### Relative paths fail closed

A relative path (a Bash word's value not starting with `/` or `~`, `~+/…`, or a Write, Edit or NotebookEdit path not starting with `/` or `~/`) is read two ways, and matching either counts:

1. **Resolved against the hook input's `cwd`,** when that is an absolute path. It is never resolved against `/`: with no `cwd` (or a relative one) there is no resolved reading.
2. **Anchored in a directory the rail does not know.** The hook's `cwd` may be absent or stale after a `cd` the Bash tool kept (unverified, see [OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)), so the relative path is also matched against every tail of each protected and outward path that a directory **outside** that entry could reach: `config/…` is a tail of `<dataDir>/config/…`, `hooks/…` and `.git/hooks/…` of a `.git/hooks` dir, `.claude/…` and `owner/.claude/…` of `~/.claude/`. The directory is never assumed to be inside the entry: from inside `~/.claude/` every relative path would be held, and from inside the data dir every one denied. How far up a tail may start:
   - **Outward paths:** any tail (`settings.json`, `hooks.json`, `hooks/x`, `.git/hooks/x`, `.claude/x`): a session can `cd` into `.git` or a repo's `.claude` with an ordinary command.
   - **Protected paths, with an absolute `cwd`:** only tails that start at or above the data dir's own name (`Loomwright Studio/api.json`, `Application Support/Loomwright Studio/config/x`). A session cannot be in the data dir or under it: every `cd` that names it is denied by this rule, and if its reported `cwd` is there, the resolved reading denies every relative path. So `api.json`, `config/x` and `app/x` alone stay ordinary.
   - **Protected paths, with no `cwd`, or for a `cd`/`pushd` operand:** any tail, including `api.json`, `studio.db*`, `studio.lock*`, `config/…` and `app/…`. With no `cwd` the rail cannot rule out a spawn in the data dir; a `cd` operand can land in any `CDPATH` entry.

The cost, in the safe direction:

- **Over-deny:** a bare glob that could match the data dir's name from its parent (`ls *`, `rm L*`, a leading `**/…`) is denied; `cd config` and `pushd app` are denied; with no `cwd`, so are `git config …`, `npm config …`, `cat app/page.tsx` and `cat api.json`. An absolute path (`ls /repo/*`) is read only as itself.
- **Over-hold:** a relative path with a `hooks` segment (`ls hooks/`), a `.claude/…` path in a repo, or a `settings*.json` anywhere is held, whatever the repo.
- **Ordinary:** `git status`, `npm test`, `ls src/*.ts`, `cat README.md`, an edit to `src/foo.ts`.
- **Not covered:** a session in `~/.claude/` (or a `.git/hooks` dir) after the owner approved the `cd` there, with a stale `cwd`: a relative path then is not held. The approval showed the `cd`.

**Not recognised:** `env git push`, `xargs git push`, `sh -c "…"`, a gh or git alias defined before the session (or by a config file the rail never reads), a `help.autocorrect` the owner set in a git config file (a mistyped `git psuh` then pushes unheld), a script or Makefile target that pushes, a git hook, or any other program that runs others. Symlinks (and other path aliases than the firmlink) are not followed, and a command that names only a parent of the data dir (`rm -rf ~/Library/Application\ Support`) is not denied: the rail denies a word that names or could expand to a protected path, not one that contains it. Branch merges that are not pull-request merges (`gh api … /merges`, the GraphQL `mergeBranch`) are held as `gh api POST`, not denied. Allowing such a program in a policy grants whatever it can run, exactly as the [safety kernel](../ARCHITECTURE.md#safety-kernel-fixed-d5) says for the Bash allowlist. Other gh write subcommands (`gh pr ready`, `gh release create`, `gh repo delete`, …) are not in phase 2's set either: a policy that allows the `gh` prefix allows them. Keep such prefixes out of a policy unless that is the intent.

## Deciding

The owner decides over the loopback API (bearer token, like every route), which the `studio` CLI calls:

| CLI | API | Effect |
|---|---|---|
| `studio approvals [--all] [--json]` | `GET /approvals[?all=1]` | Pending approvals first (oldest first): id, status, time, agent, session, action, `from playbook <slug> v<n>` for an approval that has a playbook, its `display:` text when it has one ([the pre-hold check](#the-pre-hold-check)), and the exact payload pretty-printed as JSON data. `--all` adds the decided ones (newest first, at most 500). `--json` prints the API's JSON, where each approval has `playbook: {id, slug, version}` (null for none; `version` is the one the requesting session ran) and, when it has one, `display`. |
| `studio approve <id> once` | `POST /approvals/<id>/approve` `{"decision": "once"}` | `approved` / `once`. |
| `studio approve <id> always` | `POST /approvals/<id>/approve` `{"decision": "always"}` | `approved` / `always`: a [standing grant](#standing-grants-always-per-playbook-version) for that playbook version. Only for a rail approval from a playbook session (below); the CLI's line names the playbook's slug and version. |
| `studio deny <id>` | `POST /approvals/<id>/deny` | `denied` / `deny`. |
| `studio approvals grants [--json]` | `GET /approvals/grants` | `{grants: [...]}`: every standing grant the owner has not revoked (oldest first), each `{id, playbook: {id, slug, version}, action, payload, requesting_agent, granted_at, current}`. `current` is false once the playbook has a newer version: that grant no longer matches. |
| `studio approvals revoke <grant id>` | `POST /approvals/grants/<id>/revoke` | `200 {grant}`: one `approval_grant_revoked` event; the grant never matches again and is no longer listed. |

The `approvals` subcommand's usage is `studio approvals [--all] [--json] | grants [--json] | revoke <grant id>`.

A decision is the owner's (`decided_by: owner`), and so is a revoke (`by: "owner"`). In one transaction a decision writes the row (`status`, `decision`, `decided_by`, `decided_at`), one `approval_decided` event (`{id, decision, by: "owner", action}`, plus `applied` or `apply_refused` and `apply_detail` when the kernel applied a [kernel-applied action](#kernel-applied-actions)) and one queued `message` event. Refusals write nothing:

- `400 invalid_id` / `invalid_body`;
- `404 no_such_approval`, then `409 approval_not_pending` (with the current `status`), checked first for `always` too;
- `409 always_not_supported`, for `always` on a pending approval that is not eligible (below), with a `message` saying which condition failed (for an approval with no playbook: `always needs a playbook: approval <id> did not come from a playbook session; approve it once`);
- `404 no_such_grant` (no standing grant has that id: an unknown id, or an approval that is not approved / `always`) and `409 grant_revoked` (already revoked), for a revoke.

The CLI reports each as one stderr line and exits 1 (for `always_not_supported`, the API's `message`, escaped like any stored text); bad usage prints the subcommand's usage and exits 2.

For a kernel-applied action, `studio approve <id> once` prints a second line after its usual one: `studio: the kernel applied it: <sentence>`, or `studio: not applied: <reason>: <detail>`. It exits 0 either way: the decision itself succeeded. `studio approvals --all` prints the same `  applied: …` or `  not applied: …` line after `decided:`, and `--json` and the API return the approval's `applied`, or `apply_refused` and `apply_detail`, present only then. An approval without them prints exactly as before. The sentence names a playbook, so it is escaped like any stored text.

The list shows every control character in an action, agent name, playbook slug or payload escaped as `\xNN` (C0, C1 and DEL; a newline inside a JSON string stays `\n`) and every bidi control as `\uNNNN`, so a stored payload can never move the cursor, recolour the terminal or fake a line of output.

## Delivering the decision

Deciding queues one `message` event with payload `{text, agent, approval_id}`, where `agent` is the requesting session's agent (`null` for a session with none). Its `sourceRef` is `approval:<id>`, so a retried decision can never queue it twice. Routing a message to its agent is [the brain](brain.md)'s (phase 2 item 06, `studio ask`); nothing here keeps a session open or wakes one.

The text says what happened and whether the agent repeats the call, so the agent never has to infer it:

| Case | `text` |
|---|---|
| a [kernel-applied action](#kernel-applied-actions), applied | `approved approval <id>: <action>. <applied sentence> Nothing to repeat.` |
| a kernel-applied action, refused | `approved approval <id>: <action>. <refusal sentence> Do not repeat the call.` |
| any other approved rail approval (`once` or `always`) whose payload is an object with a string `tool` | `approved approval <id>: <action>. Repeat exactly this call once, unchanged: tool <tool>, input <input>.` |
| approved, asked for with `kernel_approval_request` (`source: "tool"`), or a rail payload with no string `tool` | `approved approval <id>: <action>` |
| denied | `denied approval <id>: <action>. Nothing was done; do not repeat the call.` |

`<input>` is the held call's input as canonical JSON: the payload's `input` (a Write's whole input, keys sorted), or for a Bash call, whose payload has no `input`, `{"command": …}`, the command the grant matches on. It is never cut here: the brain cuts a message longer than `MAX_MESSAGE_CHARS` (8,000 characters, `kernel/src/brain/context.ts`) and says it did.

## One-shot grants

An approved rail approval lets **exactly** that call through **once**:

- **Exact payload.** A Bash call's payload is `{tool: "Bash", command, cwd}` (the command string exactly, not the description or timeout); any other tool's is `{tool, input, cwd}` with its whole input. `cwd` is the hook input's working directory (`/` when absent or not absolute; the rail never resolves a path against that `/`), so the owner sees where the call runs (`studio approvals` prints it with the payload) and a grant for a push in one repo never lets the identical push through in another. Matching is on the canonical JSON, so key order does not matter but every character does: `git push --force origin main` does not match a grant for `git push origin main`, and neither does a trailing space or another cwd.
- **Same requester.** For a named agent: the same agent name, and a requesting session that ran that agent (any session of it, since the decision usually arrives in a new one). For a session with no agent: that same session only, never another agent-less session, and never an agent literally named `unknown`. A grant for one agent never lets another agent's identical call through.
- **Once.** The grant's use is one `approval_used` event (`{id, tool}`, linked to the session) written in the same transaction as the allow and its `tool_decision` event; a used grant never matches again. A second identical call is held as a new approval. For a [kernel-applied action](#kernel-applied-actions) the kernel uses the grant itself, in the decision (`{id, tool, by: "kernel"}`, linked to the requesting session), so the agent's call never can.

A denied approval grants nothing: the held call never runs, and an identical later call is held as a new approval.

## Kernel-applied actions

A held call to a kernel tool with a kernel-side effect is applied by the kernel itself when the owner approves it `once`, in the same transaction as the decision. The agent does not repeat the call: completing an approved state change must not depend on a model repeating a call it can no longer see (invariant 2; the 2026-10-17 live run's step 4, where Wright made no call and the playbook stayed a draft). The owner's approval stays required (D3, invariant 3): only the owner's `once` on a call the rail held applies anything.

**The closed set.** `KERNEL_APPLIED_ACTIONS` in `kernel/src/approvals/store.ts`, full SDK tool names: `mcp__kernel__kernel_playbook_enable`, `mcp__kernel__kernel_agent_create` and `mcp__kernel__kernel_agent_update`. The two charter tools are applied by the agents feature's `charter-tools` part (phase 4 item 07): the kernel creates or changes the crew member itself ([agents: Wright's charter tools](agents.md#wrights-charter-tools)). It is code, not a setting, and adding a tool is a code change with its own review. Every member is also in `ALWAYS_HELD_TOOLS`, so `always` never reaches one. The composition enforces that at start, not only a test: a member missing from `ALWAYS_HELD_TOOLS` refuses the start (`InvalidContributionError`, from `approvalApplierOf`). A contributed tool registers its apply as `applyOnApproval` beside `beforeHold`; the kernel builds the applier once at start (`approvalApplierOf`, `kernel/src/tools/server.ts`), and a tool that declares one outside the set refuses the start (`InvalidContributionError`). The approvals module never imports the tool: the API server hands the applier to the decision route.

**When it applies.** The decision is `once`, the approval's `approval_requested` event has `source: "rail"`, its payload's `tool` is in the set, and the kernel gave an applier. A deny applies nothing and uses no grant. An approval an agent asked for with `kernel_approval_request` is never applied, even with the same payload. With no applier (a composition without one), the decision is as before apart from the message text, and the grant is left for the agent's retry.

**How it runs.** The applier gets the held input, parsed with the tool's own zod shape, and the approval: its id, the requesting session, the requesting agent from the `approval_requested` event (null when absent, never the stored `unknown`), that event's `subject_version` and its event id. It runs in a nested transaction (a savepoint): a throw rolls back only its own writes, and the decision still commits as `approved`. An applied outcome may name a follow-up (the enable's mirror rewrite), which runs once the decision committed; its failure never fails the decision.

**What it records.** On every apply attempt, applied or refused, one `approval_used` event `{id, tool, by: "kernel"}` linked to the requesting session, so the one-shot grant can never be spent by a later agent call. The `approval_decided` event adds `applied` (one sentence, for example `The kernel enabled playbook <slug> (#<id>) at version <n> on approval <id>.`) or `apply_refused` (a reason token) and `apply_detail` (one sentence). No new column. The reason tokens, a closed list:

| `apply_refused` | Why nothing was applied |
|---|---|
| `not_lead` | a charter tool's approval was requested by an agent other than Wright (or by a session with none) |
| `not_found` | the playbook no longer exists; for an update, no crew member has the id |
| `crew_cannot_draft` | the requesting agent is a registered crew member: crew members don't draft or enable playbooks (a defence: the pre-hold check never holds such a call) |
| `not_owner` | the playbook is not the requesting agent's, nor a registered crew member's with Wright requesting (a request with no agent never matches) |
| `turned_off_by_owner` | the owner turned the playbook off after the request |
| `not_draft` | the playbook is no longer a `draft` |
| `version_changed` | the approval's `subject_version` is not the playbook's current version, or the playbook was edited after the request |
| `no_dry_run` | the current version has no `done` dry run |
| `reserved` | an update names `wright`, which is not a crew member (the owner edits `wright.json`) |
| `agent_off` | the crew member an update names is `off` |
| `id_taken` | a crew member with the create's id exists, `active` or `off` (the owner made one since the request) |
| `files_exist` | something is already at one of the create's target paths |
| `config_changed` | the crew member's settings file changed since the update was requested (its sha256 is not `expected_sha256`) |
| `invalid_input` | the held input fails the tool's shape; for a charter tool, also a charter (or an update's result) `validateCharter` refuses, or an update that changes nothing |
| `no_applier` | no applier is registered for a tool in the set (fail closed: the action is never handed back to the agent) |
| `apply_error` | the applier threw; its writes were rolled back (`the kernel could not apply it: <message, cut to 300 characters>`) |

`not_owner`, `crew_cannot_draft`, `turned_off_by_owner`, `not_draft`, `version_changed`, `no_dry_run` and the playbook case of `not_found` are the enable's (`EnableRefused` in `kernel/src/playbooks/enable.ts`, [playbooks: enabling](playbooks.md#enabling)). `not_lead`, `reserved`, `agent_off`, `id_taken`, `files_exist`, `config_changed` and the crew-member cases of `not_found` and `invalid_input` are the charter tools' (`CHARTER_TOOL_REFUSALS` in `kernel/src/agents/charter-tools.ts`, [agents: Wright's charter tools](agents.md#wrights-charter-tools)). `invalid_input` (the shape), `no_applier` and `apply_error` are the decision's.

**Other actions keep the agent's retry.** A held call to any other tool (a `gh pr comment`, a `git push`, a write under `~/.claude/`) is never run by the kernel: the owner's approval is a grant the agent's own exact repeat uses once, as above. Its message now names the exact call to repeat ([delivering the decision](#delivering-the-decision)). The rail's hold reason says the same: a held call to any other tool is told to repeat itself once if approved, and a kernel-applied action is told that the kernel applies it and not to repeat the call (`kernel/src/sessions/manager.ts`, branching on `KERNEL_APPLIED_ACTIONS`). A repeat of a kernel-applied action anyway is refused or held anew, never let through.

## Standing grants ("always", per playbook version)

"Always allow" is stored per playbook, never globally (ARCHITECTURE, main loop step 6). The approved / `always` row **is** the standing grant: the grant's id is the approval's, and there is no separate store, column or migration.

**When `always` is accepted.** Only for a pending approval that:

1. the rail held (`approval_requested.source = "rail"`). An approval an agent asked for with `kernel_approval_request` is refused;
2. came from a playbook session (`approvals.playbook` is set) that recorded its version (the event's `playbook_version`);
3. that version is still the playbook's current `playbooks.version` (and the playbook still exists). Once the playbook has a new version, such a grant could never match, so it is refused: `always needs the playbook's current version: approval <id> came from v<n>, the playbook is now v<m>; approve it once`;
4. came from a session that ran a named agent (`sessions.agent`), so a grant always belongs to a named agent, and that agent is still the approval's `requesting_agent` (the requester rule below needs both);
5. is not for a tool in `ALWAYS_HELD_TOOLS` (`kernel/src/sessions/policy.ts`: `mcp__kernel__kernel_playbook_enable`, `mcp__kernel__kernel_agent_create`, `mcp__kernel__kernel_agent_update`). The owner decides every enable and every crew member's charter.

Any other `always` is refused with `409 always_not_supported`, whose message names the failing condition, and nothing is written. Answer such an approval `once`.

**What it matches.** A held call from the outward set runs on a standing grant (`approval_granted`) when no unused one-shot grant matched first and all of these hold:

- **The exact call:** the same `action` and the same canonical payload, exactly as for a [one-shot grant](#one-shot-grants), so a different command, a trailing space or another `cwd` is held.
- **The same requester:** the same named agent, by the one-shot rule (the agent name, and a requesting session that ran that agent). A calling session with no agent never matches, and an agent literally named `unknown` matches only its own grants, never an agent-less session's (agent-less `always` is refused).
- **The same playbook and version:** the calling session's `sessions.playbook` is the grant's playbook, and its `sessions.playbook_version` equals the grant's version, which must also be the playbook's current `playbooks.version`. A chat session (no playbook), a session of another playbook, a session of an older version, and every session once the playbook has a new version (any edit, phase 3 item 02) are held. The grant stays listed with `current: false`.
- **Not revoked:** no `approval_grant_revoked` event names it.
- **Not an always-held tool:** a call to a tool in `ALWAYS_HELD_TOOLS` is held even if a grant row with its exact payload exists. That is the second guard after the decide-time refusal.

A match writes one `approval_grant_used` event (`{id, tool}`, linked to the calling session) in the same transaction as the allow and its `tool_decision` event. A standing grant is not consumed. The fixed rail runs before any grant, so no grant ever covers a protected kernel path or the merge block: those are denied, never held.

**Dry runs.** A dry-run session (phase 3 item 03) is denied every outward or persistent call by its own gate, after the policy and the rail answered and before the approval path, so it never reaches a grant and never uses one ([dry runs](dry-run.md)). A playbook's dry run (`kernel_playbook_dry_run`, item 07) is such a session, and an enable needs one of the playbook's current version before the gate holds it ([the pre-hold check](#the-pre-hold-check)).

## Audit events

| Kind | Payload | When |
|---|---|---|
| `approval_requested` | `{id, action, source, agent}`, plus `playbook` and `playbook_version` from a playbook session, and `display` / `subject_version` when the pre-hold check gave them | An approval is created (by the rail or the tool). |
| `approval_decided` | `{id, decision, by, action}`, plus `applied` or `apply_refused` and `apply_detail` when the kernel applied a kernel-applied action | The owner decides (`decision` is `once`, `always` or `deny`). |
| `approval_used` | `{id, tool}`, or `{id, tool, by: "kernel"}` for the kernel's use | The rail lets a call through on a one-shot grant, or the kernel applies an approved kernel-applied action (on every attempt, applied or refused). |
| `approval_grant_used` | `{id, tool}` | The rail lets a call through on a standing grant. |
| `approval_grant_revoked` | `{id, by}` | The owner revokes a standing grant. |
| `tool_decision` | `{tool, decision, reason, command?, approval_id?, category?}` | Every gated call (phase 1), with the new reasons `approval_required`, `approval_granted`, `protected_kernel_path`, `merge_blocked` and `bash_command_too_large` (and `bash_shell_metacharacter` now also for a command the rail will not read), `agent_boundary` (phase 4, with the `category`; [the never boundary](#the-never-boundary)), plus the gate-local `held_refused` (the pre-hold check refused it), `dry_run` and `kernel_gate_error`. |

## Values

`approvals.status` is `pending`, `approved` or `denied`; `approvals.decision` is `once`, `always` or `deny`. Both sets are closed in code (migration 11 has no SQL CHECK). `always` is written only for an eligible playbook approval (above). No approval or grant expires (timeouts are policy, later); a grant ends when the playbook gets a new version or the owner revokes it.
