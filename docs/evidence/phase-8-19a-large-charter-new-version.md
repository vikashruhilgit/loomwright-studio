# Phase 8 item 19a evidence: a large charter still gets a new version

**What shipped:** the readiness lines in a crew member's approval head quote each duty as a word-bounded excerpt instead of in full. A 10-duty charter's head now leaves room for an Ask or change or a workspace to produce a held v2 or v3. When a request still does not fit, the refusal names the overage and what to ask for less of. The committed tests and the static suites are in PR #266's body. This file holds the running-system check (Validation 2).

## Validation 2 (owner)

In the packaged app (`cd app && npm run package`, then open the built app), with the kernel running as the installed service and the saved workspace `~/studio-work/studio-sandbox` from item 18c:

1. In Wright's thread, ask Wright for a 10-duty developer for `vikashruhilgit/studio-sandbox`. Check that Wright holds a v1 and the card shows it.
   - What it showed: Wright held approval 25, "Create crew member developer ("Developer", octopus crew-teal), proposed by Wright", with 10 duties and a full display of 9,590 characters. Each readiness line quotes its duty as a short excerpt ending in "…" (for example "duty 3 by Notify the owner: Notify the owner when something needs attention: a CI failure on the…"). Duties 4 and 5 were flagged as needing Comment on issues, and the copy-of-a-repo line was flagged with Choose workspace.
2. On v1's card, type "add comment replies" in Ask or change and Send. Check that Wright holds a v2 and v1's card collapses to "Replaced by v2".
   - What it showed: Wright held approval 26 (v2, 9,658 characters). The kernel withdrew approval 25 (status `denied`, decided_by `kernel`). The v1 card collapsed to "▸ developer · v1 · Replaced by v2 · adds Comment on issues". Wright read the request as the Comment on issues job, plus reading PR comments under Read a PR. With it, duties 4 and 5 read Covered. In 18d's walk the same request on a 10-duty charter was refused, 615 characters over the 4,000-character head.
3. On v2's card, choose Choose workspace and Use this folder for `~/studio-work/studio-sandbox`. Check that Wright holds a v3 and v2's card collapses to "Replaced by v3".
   - What it showed: Wright held approval 27 (v3, 9,779 characters) with "ready: copy of a repo for Hand tickets to /automate: works in vikashruhilgit/studio-sandbox at /Users/vikashruhil/studio-work/studio-sandbox". The kernel withdrew approval 26 (status `denied`, decided_by `kernel`). The v2 card collapsed to "▸ developer · v2 · Replaced by v3 · workspace set". In 18d's walk the same step was refused, 60 characters over.
4. Run `studio approvals`. Check that each held version's enforced line is printed before its cut.
   - What it showed: the held version's `enforced: never: git_push, … connectors: github` line is printed, then "… 5779 more characters not shown; studio approvals --json, or the app's Approvals screen, shows all of it".

Owner's result (filled in from the owner's report):

Verdict: PASS for Validation 2

Run on 2026-11-12 between 17:05 and 17:20 local time (macOS 26.6.2) by Claude, driving the app at the owner's request. It ran against the packaged app (`npm run package`, `release/mac-arm64/Loomwright Studio.app`) and the kernel installed as the launchd service (`service install`, pid 16734), both built from PR head `9c877ece`. Ask or change and Choose workspace each produced a held new version on a 10-duty charter, and neither was refused.

```
v1 approval 25  9590 chars  -> denied decided_by=kernel
v2 approval 26  9658 chars  -> denied decided_by=kernel   ▸ developer · v1 · Replaced by v2 · adds Comment on issues
v3 approval 27  9779 chars  pending                       ▸ developer · v2 · Replaced by v3 · workspace set
studio approvals: enforced: never: git_push, … connectors: github
                  … 5779 more characters not shown; studio approvals --json, or the app's Approvals screen, shows all of it
```
