# 25b — The rail reads quoted text as text

**As the** owner,
**I want** the rail to judge a command by its shell meaning, so a metacharacter inside quotes is just text,
**so that** a driver answer with a note in parentheses, a commit with its `Co-Authored-By: … <…>` trailer, or a PR title with `(` is not refused while real pipes, redirects and chains still are.

## Why
The rail refuses `[;&|<>()$` + backtick + newline anywhere in the raw command (`kernel/src/sessions/policy.ts:80`). Observed denials of quoted text in the live runs (studio.db, 2026-11-17 → 11-20):
- `git commit -m "… Co-Authored-By: Claude … <noreply@…>"`: events 29902 → 33100 (sessions 217, 224, 226, 231, 236). In session 231 the commit went in without the trailer and not as a conventional commit (`c54de0b`).
- `supervisor-next-step.sh --result '{… "reason": "… (…) …"}'` and `automate-next-step.sh --result '{…}'` with `;`, `(` or `$` in a note: 29820, 30191, 30491, 32597, 32837, 33311, 33314, 38082; each retried with the note stripped.
- `launch-pad-phase.sh 5.5 PASS (attempt 1/3)` (33441), `gh pr create --body "…"` (31706).

## Acceptance criteria
- [ ] Given a command whose only metacharacters sit inside single quotes, when the rail decides it, then it is judged on its words (prefix, script path, options profile) as if the quoted text were plain, and admitted when those are.
- [ ] Given double quotes, when they contain `$` or a backtick, then the command is refused `bash_shell_metacharacter` (expansion); any other character inside double quotes is text.
- [ ] Given an unquoted `;`, `&`, `&&`, `||`, `|`, `<`, `>`, `(`, `)`, `$`, a backtick or a newline, when the rail decides, then it is refused exactly as today.
- [ ] Given an unterminated quote, a `\` escape the parser does not model, `$'…'`, or a heredoc marker, when the rail decides, then it is refused (fail closed) with reason `bash_unparsed`.
- [ ] Given the word split the rail now computes, when prefix, script-path, options-profile and `~/.claude` (settings_write / agent_boundary) checks run, then they read the parsed words, so a quoted argument can never be mistaken for a program or option, and a `~/.claude` path inside quotes is still found.
- [ ] Each observed denial above, replayed as a test case, is admitted; each of today's genuine compound forms in the denial inventory (`P=…; bash $P/…`, `ls && cat -A`, `> file 2>&1`) is still refused.
- [ ] A new decision record (the next free D-number in `docs/DECISIONS.md`) states the rule, and `docs/architecture/automate.md` (or the sessions architecture page) describes it.

## Non-goals
- Admitting pipes, redirects, chains or command substitution, quoted or not.
- Changing which programs are admitted (25c, 25d).

## Owner decisions
- 2026-11-20: "Quote-aware rail" chosen over keeping the rail strict and changing Loomwright's instructions (owner, /product-owner session).

## Priority: MVP
The safety kernel's change (invariant 3), owner-approved; it removes a whole class of retries and one observed lost commit trailer.

### Assumptions
- Defect evidence: observed — studio.db `tool_decision` events listed above.
- The rail already has a word splitter (`shellWords`, added in 23k for `--result`); this generalises it.

### Risks
- Parser bugs are security bugs: every refusal case gets a test, and a fuzz-style table of tricky inputs (`'a'"$b"`, `"\""`, `'it''s'`, nested quotes) is pinned.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` passes; `kernel/test/sessions-policy.test.ts` holds the replayed denials and the refusal table.
2. **Static — tests bite:** reverting the parser makes the replayed-trailer and `--result` cases fail.
3. **Running system — next live walk:** no `bash_shell_metacharacter` denial on a quoted-only command in the run sessions' `tool_decision` events.

## Depends on
none

## Touches
kernel/src/sessions/policy.ts
kernel/test/sessions-policy.test.ts
docs/DECISIONS.md
docs/architecture/automate.md

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-20-rail-reads-quoted-text-as-text.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-22T12:15:41Z
- **Brief:** .supervisor/jobs/done/2026-11-20-rail-reads-quoted-text-as-text.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/301
