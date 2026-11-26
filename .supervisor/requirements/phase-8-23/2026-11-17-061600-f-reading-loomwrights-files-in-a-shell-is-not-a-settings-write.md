# 23f — Reading Loomwright's own files with a shell command is not a settings write

## Status: in_progress

**Observed live (session 205, seq 63).** `grep -n "runfile-write" ~/.claude/plugins/cache/atelier/loomwright/17.38.0/skills/automate-loop/helpers.md` was denied `agent_boundary` / `settings_write`. The rail labels any Bash word naming `~/.claude/` as `settings_write` (`kernel/src/sessions/policy.ts`), even for a read-only program. The Read tool reads the same file fine. 23a exempted only the admitted script's own path.

**Ask.** A read-only program (`cat`, `grep`, `head`, `tail`, `wc`, `ls`, `jq`) naming a path under the session's own Loomwright install is not an outward settings write; anything else under `~/.claude/` stays `settings_write`. Low priority: the session can use Read instead, but it did not.
