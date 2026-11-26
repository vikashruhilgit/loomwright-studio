# 23a — An admitted Loomwright driver call is never read as a settings write

## Status: in_progress

**As** the owner of Loomwright Studio,
**I want** a kernel-started `/automate`, `/review-pr` or `--merge-parked` session to run the Loomwright scripts its run policy admits by exact path,
**so that** the phase 8 exit walk's ticket runs can reach their first step.

## Why

**Observed live (2026-11-16, phase 8 exit re-run, walk step 1).** Kernel and app built from `main` `15a865b1`, service on the API key. Crew member `p8-22` (approval 46), playbook 17 live v2 (approval 48). Issue `vikashruhilgit/studio-sandbox#17` was picked up and the kernel started the ticket run, session 202 (`/loomwright:automate --backlog … --inline-phases`, cwd `~/studio-work/studio-sandbox`). The session read the skill files, then its first two driver calls were refused (`studio sessions output 202`, seq 20–25):

```
Bash deny (agent_boundary)  category settings_write
  command bash ~/.claude/plugins/cache/atelier/loomwright/17.38.0/scripts/automate-helpers.sh lane-info
Bash deny (agent_boundary)  category settings_write
  command bash ~/.claude/plugins/cache/atelier/loomwright/17.38.0/scripts/automate-helpers.sh meta-entry
```

The session stopped (45,649 tokens) with no run file, no PR. The harness summary read `incomplete`, 0 of 2 PRs.

**Root cause (read on `main` `15a865b1`).** `decideToolUse` admits the call (`matchLoomwrightScript`, the exact path under the session's install). The manager then runs the fixed rail on every allowed call (`classifyToolCall`, `kernel/src/sessions/policy.ts`), and the rail labels any Bash word that names a path under `~/.claude/` as the outward action `settings_write` (`policy.ts:572`, targets built at `:1159`). The active Loomwright install lives under `~/.claude/plugins/cache/…`, so EVERY admitted driver call is classified `settings_write`. With `settings_write` in the member's `never` list (Wright drafts it by default) the call is denied `agent_boundary`; without it, every helper call would be held for an approval.

**Why CI missed it.** The gate tests that drive an admitted script through the rail use a fake install at `/lw` (`kernel/test/automate-launch-routes.test.ts:242`, `:258`), outside any home `.claude`. `sessions-policy.test.ts` uses a `~/.claude/…` install path but tests `decideToolUse` only, never `classifyToolCall`.

## Acceptance Criteria

- [ ] **AC1.** A Bash call that `matchLoomwrightScript` admits under the session's run policy is not labelled `settings_write` (or any outward label) for naming its own script path under the install; the rest of the rail (merge block, shell metacharacters, protected kernel paths, `git push` and the other outward forms) is unchanged for it.
- [ ] **AC2.** Any OTHER Bash or Write/Edit naming `~/.claude/` (settings, hooks, a path outside the admitted scripts, the install's own non-script files) is still `settings_write` in every policy, run policies included.
- [ ] **AC3.** A gate test drives a kernel-started run session's real `PreToolUse` hook with the install under a temp `HOME/.claude/plugins/cache/…/scripts/` and the member's `never` list containing `settings_write`: `automate-helpers.sh lane-info`, `meta-entry` and an `automate-next-step.sh --resume …` call are allowed; `cat ~/.claude/settings.json`-style writes stay denied. The test fails on `main` `15a865b1`.
- [ ] **AC4.** The `/lw` stand-in installs in the launch tests are replaced (or joined) by an install under the test's home `.claude`, so the shape the owner's machine has is the one CI runs.

## Not verified
- Whether any other admitted script argument (a run file under the checkout) trips a different rail label; AC3's driver calls cover the first steps only.
