# Approvals

The approval gate (phase 2, D5, D7, invariant 3): an outward or persistent action an agent attempts waits for the owner's decision, which the owner gives from the terminal. The session is never kept running while it waits. Code: `kernel/src/approvals/` (the tool, the record, the routes, the CLI) and the kernel's `PreToolUse` rail in `kernel/src/sessions/policy.ts` (`classifyToolCall`, pure) and `kernel/src/sessions/manager.ts` (the gate). Table: `approvals` (migration 11, see the [data model](../ARCHITECTURE.md#data-model)).

It is a mechanism (invariant 1): no approval, grant or rule is preinstalled. The outward set and the deny sets below are part of the fixed safety kernel: they are code, not settings, and no agent can edit them (invariant 3). A payload is untrusted data: stored exactly as given, shown as data, never executed or interpolated.

## Two ways in

| Source | What creates the approval |
|---|---|
| The rail | A tool call the session's policy **allows** that falls in the fixed outward set (below). It does not run: the hook denies it with `approval_required`, and the reason it gives the model names the approval id, says the decision arrives as a new message, and says to end the turn and, if approved, run exactly the same call again once. |
| `kernel_approval_request(action, payload, idempotency_key)` | An agent asks before acting. `action` is 1-200 characters; `payload` is a JSON object (at most 64,000 characters as JSON). It returns at once with `{id, status: "pending", action, message}`, where the message tells the agent the decision arrives as a new message and to end its turn. It runs as one work step keyed `kernel_approval_request:session-<id>:<idempotency_key>`, so a repeat with the same key in that session returns the same approval (with its current status) and records nothing new. |

Either way, one transaction writes the `pending` row (`requesting_agent` is the session's agent, or `unknown` for a session with none; `requesting_session`; `action`; `payload_json`, the payload as canonical JSON with object keys sorted), one `approval_requested` event (`{id, action, source: "rail" | "tool", agent}`) and one notification with source `kernel:approval` ([notifications](notifications.md)).

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
5. **The outward set: held as a pending approval** (`approval_required`), unless an unused one-shot grant matches exactly (`approval_granted`, see below):
   - git with any word after `git` that is (or could expand to) `push` (`git push`, `git --attr-source X push`, `git subtree push`, `git lfs push`), `send-pack`, `http-push`, `dcommit` or `set-tree` (git svn), `send-email`, `imap-send` or `cvsexportcommit`, or `submit` after `p4`. Over-holding (`git commit -m push`) is the safe direction;
   - an alias definition that could make a later allowed call push or merge under another name: `gh alias set|import`, and git with any word holding `alias.`, `include.path` or `includeIf.` (`git -c alias.p=push p`, `git config alias.p push`), `help.autocorrect` (`git -c help.autocorrect=immediate psuh` runs as a push), or `--config-env`;
   - `gh pr create|comment|review|edit|close …` and `gh issue create|comment|edit|close …`, with gh's built-in `new` alias read as `create` (`gh pr new`, `gh issue new`);
   - `gh api …` with a non-GET method: `-X`/`--method` (also `-XPOST`, `--method=POST`) other than GET, or, with no explicit method, any `-f`, `-F`, `--field`, `--raw-field` or `--input` (gh sends those as POST), or a flag the rail cannot account for (`gh api (flag unread)`). A single-dash word is read as pflag reads it, a group of short flags: `-i` is a bool, and the first of `X`/`f`/`F`/`H`/`p`/`q`/`t` takes the rest of the word (after an optional `=`) or, for `X`/`f`/`F`, the next word, so `-iX PUT`, `-iXPUT`, `-X=PUT`, `-if body=x` and `-iF query=@f` are all read. A group holding any other character (a glob, an unknown letter) is unread;
   - a Write, Edit or NotebookEdit to, or a Bash command naming or globbing, anything under `~/.claude/`, any `settings*.json`, any `hooks.json`, or anything under a `.git/hooks/` dir or a `hooks` dir inside a `.claude` dir. A bare `*` could expand to a `settings.json` in the cwd, so `ls *` is held too (`*.ts` is not).
6. Anything else runs as the policy says.

Every call still records exactly one `tool_decision` event (with `approval_id` when one was held or used). The gate fails closed: if creating the approval, consuming a grant or recording the decision throws, the whole transaction rolls back and the call is denied with `kernel_gate_error`.

### Which command forms the matcher recognises

The rail reads a Bash command the way the shell splits it into words (`shellWords`: a space or tab separates words, as in bash, single and double quotes and backslash escapes are read as the shell reads them, adjacent parts join into one word). The policy has already refused shell control and substitution characters (`;` `&` `|` `<` `>` `(` `)` `$`, backtick, newline), so a command is one program and its arguments. The expansions the shell can still apply are read failing closed: a word that **could** expand to a protected, merge or outward form counts as that form.

- **Brace expansion** is expanded (`{a,b}` alternatives, nested and repeated; a `{1..9}` sequence reads as `*`), and one word can become several argv words (`gh {pr,merge} 12` is a merge). More than 64 results read as "any path".
- **Globs:** `*`, `?`, `[…]` (any one character) and a `**` segment followed by another segment (zsh's recursive glob, any depth) are matched as patterns against the protected and outward paths and the subcommand names (`git pu*` is a push). A glob followed by `..` is its parent.
- **The program** is the first word's basename, case-folded: `git`, `/usr/bin/git` and `GIT` are all git, and `git-push` (git's libexec spelling) is `git push`.
- **git:** every word after `git` is read, so no option before the subcommand (`--attr-source`, `--exec-path`, …) can hide a push.
- **Empty words** are not command words: bash removes an unquoted empty word (`{,} gh pr merge`, `gh api -X {,} PUT …`), and cobra skips a quoted one (`''`, `""`) when it looks up a subcommand, so `gh pr '' merge` and `gh '' pr merge` are merges and `gh pr '' comment` is held. Reading every empty word away only over-holds (`gh api -X '' PUT …` reads as `-X PUT`).
- **gh:** the command words are the first two words that are not flags or empty. When gh looks up its subcommand, cobra skips the word after any two-character short flag and any `--long` flag without `=` (an unknown one included), and pflag the word after a short group ending in `R`; so every such flag, and a globbed flag (`-[R]`), is read both as taking the next word and as not, and a merge (then an outward form) in any reading wins: `gh -R o/r pr merge 12`, `gh pr -b view merge 12` and `gh pr -hR o/r merge 12` are merges. Only `-h`, `--help` and `--` are read as taking no value. More than 64 readings read as a merge.
- **Paths:** a word is read as every path a program could take from it: the word itself, raw and percent-decoded (`file:///…/Loomwright%20Studio/api.json`), with a `?query` / `#fragment` cut off when it holds a `:`; the part after every `=` (`--file=…`), `@` (`curl -d @file`, `-d@file`) and `:` (`file:api.json`); the rest of a glued short option (`-C/path`); and every substring starting at a `/` (`file:///abs`, `-d@/abs`, `prefix/abs`) or at a `~/` inside the word. `~` and `~/…` expand to the home dir, `~+` to the cwd, and any other `~…` (`~user`, `~-`, a named dir) to "any directory"; anything else resolves against the hook's `cwd`. Paths compare case-insensitively (APFS is by default) on a path-segment boundary, after `..` is applied and a leading `/System/Volumes/Data` firmlink is removed (the same rule as the protected-folder check in `kernel/src/protected-paths.ts`). A Write, Edit or NotebookEdit path is not shell-expanded: its characters are literal.

**Not recognised:** `env git push`, `xargs git push`, `sh -c "…"`, a gh or git alias defined before the session (or by a config file the rail never reads), a `help.autocorrect` the owner set in a git config file (a mistyped `git psuh` then pushes unheld), a script or Makefile target that pushes, a git hook, or any other program that runs others. Symlinks (and other path aliases than the firmlink) are not followed, and a command that names only a parent of the data dir (`rm -rf ~/Library/Application\ Support`) is not denied: the rail denies a word that names or could expand to a protected path, not one that contains it. Branch merges that are not pull-request merges (`gh api … /merges`, the GraphQL `mergeBranch`) are held as `gh api POST`, not denied. Allowing such a program in a policy grants whatever it can run, exactly as the [safety kernel](../ARCHITECTURE.md#safety-kernel-fixed-d5) says for the Bash allowlist. Other gh write subcommands (`gh pr ready`, `gh release create`, `gh repo delete`, …) are not in phase 2's set either: a policy that allows the `gh` prefix allows them. Keep such prefixes out of a policy unless that is the intent.

## Deciding

The owner decides over the loopback API (bearer token, like every route), which the `studio` CLI calls:

| CLI | API | Effect |
|---|---|---|
| `studio approvals [--all] [--json]` | `GET /approvals[?all=1]` | Pending approvals first (oldest first): id, status, time, agent, session, action and the exact payload pretty-printed as JSON data. `--all` adds the decided ones (newest first, at most 500). `--json` prints the API's JSON. |
| `studio approve <id> once` | `POST /approvals/<id>/approve` `{"decision": "once"}` | `approved` / `once`. |
| `studio deny <id>` | `POST /approvals/<id>/deny` | `denied` / `deny`. |
| `studio approve <id> always` | `POST /approvals/<id>/approve` `{"decision": "always"}` | Refused: `409 {"error": "always_not_supported", "message": "always-allow is stored per playbook; playbooks arrive in phase 3"}`; the CLI prints that message and exits 1. Nothing is written and the approval stays `pending`. "Always allow" is stored per playbook, never globally (ARCHITECTURE, main loop). |

A decision is the owner's (`decided_by: owner`). In one transaction it writes the row (`status`, `decision`, `decided_by`, `decided_at`), one `approval_decided` event (`{id, decision, by: "owner", action}`) and one queued `message` event. Refusals write nothing: `400 invalid_id` / `invalid_body`, `404 no_such_approval`, `409 approval_not_pending` (with the current `status`). The CLI reports each as one stderr line and exits 1; bad usage prints the subcommand's usage and exits 2.

The list shows every control character in an action, agent name or payload escaped as `\xNN` (C0, C1 and DEL; a newline inside a JSON string stays `\n`) and every bidi control as `\uNNNN`, so a stored payload can never move the cursor, recolour the terminal or fake a line of output.

## Delivering the decision

Deciding queues one `message` event with payload `{text: "<approved|denied> approval <id>: <action>", agent, approval_id}`, where `agent` is the requesting session's agent (`null` for a session with none). Its `sourceRef` is `approval:<id>`, so a retried decision can never queue it twice. Routing a message to its agent is [the brain](brain.md)'s (phase 2 item 06, `studio ask`); nothing here keeps a session open or wakes one.

## One-shot grants

An approved rail approval lets **exactly** that call through **once**:

- **Exact payload.** A Bash call's payload is `{tool: "Bash", command, cwd}` (the command string exactly, not the description or timeout); any other tool's is `{tool, input, cwd}` with its whole input. `cwd` is the hook input's working directory (`/` when absent or not absolute), so the owner sees where the call runs (`studio approvals` prints it with the payload) and a grant for a push in one repo never lets the identical push through in another. Matching is on the canonical JSON, so key order does not matter but every character does: `git push --force origin main` does not match a grant for `git push origin main`, and neither does a trailing space or another cwd.
- **Same requester.** For a named agent: the same agent name, and a requesting session that ran that agent (any session of it, since the decision usually arrives in a new one). For a session with no agent: that same session only, never another agent-less session, and never an agent literally named `unknown`. A grant for one agent never lets another agent's identical call through.
- **Once.** The grant's use is one `approval_used` event (`{id, tool}`, linked to the session) written in the same transaction as the allow and its `tool_decision` event; a used grant never matches again. A second identical call is held as a new approval.

A denied approval grants nothing: the held call never runs, and an identical later call is held as a new approval.

## Audit events

| Kind | Payload | When |
|---|---|---|
| `approval_requested` | `{id, action, source, agent}` | An approval is created (by the rail or the tool). |
| `approval_decided` | `{id, decision, by, action}` | The owner decides. |
| `approval_used` | `{id, tool}` | The rail lets a call through on a one-shot grant. |
| `tool_decision` | `{tool, decision, reason, command?, approval_id?}` | Every gated call (phase 1), with the new reasons `approval_required`, `approval_granted`, `protected_kernel_path`, `merge_blocked` and `bash_command_too_large` (and `bash_shell_metacharacter` now also for a command the rail will not read). |

## Values

`approvals.status` is `pending`, `approved` or `denied`; `approvals.decision` is `once`, `always` or `deny`. Both sets are closed in code (migration 11 has no SQL CHECK). Phase 2 never writes `always`. No approval expires (timeouts are policy, later).
