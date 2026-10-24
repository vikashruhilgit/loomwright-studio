# Phase 6: the Integrations screen (GitHub first) and acceptance test 1. Plan doc (an index, not an implementable item)

## Status: ready (index document — nothing to implement)

## Why now
Phases 0–4 are done (ROADMAP ✓). Phase 5 (GUI v1) is code-complete (#101–#124), but **it isn't exit-verified yet**: `docs/OPEN_QUESTIONS.md:112` is unticked, and there's no `docs/evidence/phase-5-exit-live-*.json`. The owner chose to write phase 6 now and run it only after phase 5's live run passes (see Owner decisions).

ROADMAP phase 6: "Integrations screen (GitHub first) + acceptance test 1: PR-review duty built from one sentence, in draft mode (no posting)". Done when: "Works against the owner's personal repos; unchanged PRs are skipped according to the user-set dedupe key; an injection planted in a PR body is ignored".

What doesn't exist yet (checked 2026-10-24, main at 1631cf1):
- **No connector.** There's no GitHub code, and the `connectors` table is only planned (`docs/ARCHITECTURE.md:45`). `GH_TOKEN` passes through the daemon untouched (`kernel/src/auth/credential-env.ts:82-90`).
- **No poll trigger.** Triggers are `once` and `cron` only (`kernel/src/triggers/store.ts:72`).
- **The dedupe key can't see a PR.** `DEDUPE_KEY_FIELDS` has no item fields (`kernel/src/playbooks/types.ts:26`).
- **No draft mode.** Only a crew member's `never` list and the rail's approval holds stop posting, and neither keeps the would-be review.
- **The dry run can't read GitHub** (`kernel/src/sessions/dry-run.ts:22`, :61).
- **PR text fetched with `gh` arrives raw.** It isn't wrapped as untrusted data.
- **No Integrations screen, and no mockup for one** (`docs/DESIGN.md:39` defers it).

## Owner decisions

Recorded 2026-10-24 in the phase 6 product-owner session, over four rounds of AskUserQuestion plus one on the mockup. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D5, D8, D9, D12, D22, D27, D34 and invariants 1–9 stay as they are. Phase 5's own decisions (in its items) still hold.

- **Sequencing: write phase 6 now; phase 5's live exit is still owed.** Phase 5 is code-complete (#101–#124) but has not been exit-verified (`docs/OPEN_QUESTIONS.md:112` unticked, no `docs/evidence/phase-5-exit-live-*.json`). Run phase 6 only after that live run passes. Any findings from it land first, as phase-5 items.
- **The Integrations screen is phase 6, GitHub only.** The ROADMAP row wins over UI.md and DESIGN.md, which list Integrations under GUI v2. Phase 6 builds the real screen with GitHub as its only connector: connect, disconnect, scopes, expiry, status, reachable repos. Phase 7 adds polish and the other connectors. UI.md and DESIGN.md get a note recording this.
- **Mockup first (D9).** A design item adds the Integrations screen to the mockup source in `docs/design/`, light and dark, with every designed state (not connected, connecting, connected, token rejected, expiring, kernel unreachable) and the Connect sheet. The owner approves it on its PR. The screen item depends on it, and its polish gate matches that mockup.
- **Credential = Studio's own token in the Keychain.** The owner creates a fine-grained, read-only personal access token limited to the personal repos they choose. It's stored as the Keychain item `loomwright-studio-github`, and the kernel strips any inherited `GH_TOKEN` / `GITHUB_TOKEN` from every child environment. Studio never runs an OAuth flow and never reuses the `gh` CLI's login.
- **Token entry = paste in the app.** The Integrations screen's Connect GitHub sheet has a secure field. The Electron main process sends the token straight to a new kernel owner route. The kernel validates it against GitHub, writes the Keychain item and never returns or logs the token. The renderer clears the field at once. A terminal fallback, `studio connectors github set`, reads the token from stdin and does the same.
- **Write-scoped tokens are refused in phase 6.** The kernel accepts only a token whose permissions are all read-only, and says exactly which permission to drop. Phase 8's live posting revisits this.
- **PRs arrive through a kernel `poll` trigger.** It's a new generic trigger kind: the kernel itself fetches a source (in phase 6, GitHub open PRs on repos the user chose) at the interval the user set. Each item (PR) becomes its own playbook run. New dedupe-key fields `item.id` and `item.revision` (for a PR, its head SHA) are evaluated per item, so an unchanged PR is skipped as `skipped_duplicate` under the key the user set. The PR's text reaches the agent wrapped as `<untrusted-data source="github:<owner>/<repo>#<n>">`.
- **Poll floor = 60 s plus rate-limit backoff (mechanism).** The kernel refuses intervals under 60 s. It reads GitHub's rate-limit headers and backs off on 403 or 429, recording why. A poll that finds nothing new starts no session and spends no tokens. Everything else (interval, repos, filters) is the user's policy (D4).
- **Repos are chosen in the poll trigger.** Each playbook's poll lists its repos and filters (state, draft, author), and Wright proposes them from the user's sentence. The Integrations screen shows which repos the token can reach, and the kernel refuses a poll naming a repo outside that set.
- **GitHub access is a per-agent grant.** A new owner-set field, `connectors: ["github"]`, goes in `config/agents/<id>.json` (the enforced part, which no session can write; D34). Only sessions of an agent with the grant get the GitHub tools. A playbook on an agent without the grant parks with "needs GitHub" (DESIGN.md §6).
- **PR reads go only through kernel tools.** Read-only kernel MCP tools (`kernel_github_pr_get`, `kernel_github_pr_diff`, `kernel_github_pr_files`, `kernel_github_pr_comments`) fetch with Studio's token and return everything wrapped as untrusted data. The `gh` binary is unavailable to sessions of agents with the GitHub grant, so no raw PR text reaches the model unwrapped.
- **Draft mode = a per-playbook `mode: draft | live`.** The user sets it and Wright only proposes it. It defaults to `draft`. Under `draft` the kernel denies, without asking, every outward call the session makes (`gh pr comment|review`, non-GET `gh api`, any GitHub write). It stores the call's payload as a **draft output**, which the owner reads as a card in the agent's thread, and nothing is sent. `live` is not built in phase 6: setting it is refused with a clear message.
- **A poll playbook's dry run shows one real PR.** The dry run polls the source once, without recording dedupe keys, and shows which PRs would run or be skipped and under which key. It then reviews one real PR through the read-only kernel tools, forced into draft mode, so the owner sees the actual would-be review before enabling.
- **One sentence builds the duty.** From one sentence (e.g. "review every open PR on studio-sandbox when it changes, draft only"), Wright drafts the playbook with its poll trigger, dedupe key and mode. If no fitting crew member exists, it also drafts a comment-only reviewer charter with the GitHub grant proposed. The owner approves the charter and the enable, and Wright only proposes every value (D4).
- **Exit repo = a throwaway private sandbox repo.** The owner creates a private personal repo (e.g. `vikashruhilgit/studio-sandbox`). The runbook plants two PRs there: an ordinary one, and one whose body tells the agent to post "LGTM", approve the PR and run a command. Re-polling with no new commits skips both. A new push re-runs only that PR. Never `vendsy/*` or any employer repo (OPEN_QUESTIONS employment-IP to-do).

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 01 | Migration 017 (connectors, draft_outputs, playbook mode, run item columns). The `integrations` feature with empty parts. Shared types and a fake GitHub client. Closed sets grow, with refusals (`poll`, item fields, `mode`, `connectors`, thread kinds). Per-agent tool filter. Policy inputs. GitHub env strip. API contract. Screen stub on ⌘5. Docs stubs. UI.md note | none | 02 |
| 02 | Integrations screen and Connect sheet mockup, all states, light and dark; the DESIGN.md section (the D9 gate) | none | 01 |
| 03 | GitHub connector: read-only token probe, real client with rate limits, Keychain set/replace/disconnect, expiry notices, routes, CLI | 01 | 04–08 |
| 04 | `poll` trigger: 60 s floor, reachable-repo check, one queued fire per PR, backoff, parking | 01 | 03, 05–08 |
| 05 | Per-item runs: item dedupe fields, `skipped_duplicate` per PR, wrapped item in the prompt, `needs_github` parking | 01 | 03, 04, 06–08 |
| 06 | Read-only kernel GitHub tools returning wrapped untrusted data | 01 | 03–05, 07, 08 |
| 07 | Draft mode in the policy: deny without asking, record the draft, `gh` denied for granted sessions, `/drafts` routes | 01 | 03–06, 08 |
| 08 | The owner grants an agent GitHub (CLI, route, Team inspector), and the charter shows it | 01 | 03–07 |
| 09 | A poll playbook's dry run: poll once with nothing recorded, would-run/would-skip, one real PR reviewed in forced draft | 01, 04–07 | 10–12 |
| 10 | Wright drafts the duty from one sentence: poll, key and mode in `kernel_playbook_create`; the charter proposes the grant; guidance | 01, 04, 05, 07, 08 | 09, 11, 12 |
| 11 | The Integrations screen, built to item 02's mockup | 01, 02, 03 | 09, 10, 12 |
| 12 | Draft, poll and connector cards in threads | 01, 07 | 09–11 |
| 13 | Exit check: deterministic kernel test and app e2e, live harness on the sandbox repo, runbook, evidence, ROADMAP ✓ | 01–12 | nothing (it's last) |

## Run
Checked with `automate-helpers.sh plan-waves .supervisor/requirements/phase-6 --max 13 --explain` on 2026-10-24 (Loomwright 17.14.1, resolved from `~/.claude/plugins/installed_plugins.json`). `--lint` passes for all 13 items.

```
wave 1: 01 02
wave 2: 03 04 05 06 07 08
wave 3: 09 10 11 12
wave 4: 13
```

Every wait is a dependency, and no item waits on a file conflict (the same holds at `--max 3` and `--max 2`). The six-item second wave is too wide for reviewable PRs, so it's split into runs:

1. `/automate --backlog .supervisor/requirements/phase-6/_BACKLOG-run-1-foundation.md --parallel 2`: items 01 and 02 in one wave. 01 is a large scaffold. 02 is docs-only, and its merge is the owner's D9 approval of the mockup.
2. `/automate --backlog .supervisor/requirements/phase-6/_BACKLOG-run-2-kernel.md --parallel 3`: items 03–08 as two waves (03 04 05 | 06 07 08). N=3 because they change the kernel's core paths: the Keychain, triggers, runs and the policy.
3. `/automate --backlog .supervisor/requirements/phase-6/_BACKLOG-run-3-kernel-drafting.md --parallel 2`: items 09 and 10, after run 2.
4. `/automate --backlog .supervisor/requirements/phase-6/_BACKLOG-run-4-app.md --parallel 2`: items 11 and 12, after runs 1 and 2. They can run before, after or alongside run 3. N=2 because each screen PR carries polish-gate evidence that the owner reviews.
5. `/automate --backlog .supervisor/requirements/phase-6/_BACKLOG-run-5-exit.md`: item 13, sequential, with the live run (D33: an agent may run it while the owner watches; the owner decides every approval).

Rules for every run:
- Use safe mode throughout (no `--auto-merge`).
- Push these items to `loomwright-meta` with `meta-sync.sh push --paths-from` before a lane reads them.
- A lane that needs a file outside its Touches, or a new npm dependency, stops and says so: don't edit it.
- New findings join this plan doc as new items.

**Hotspots, all owned by item 01:**
- the migrations and `store.test.ts`;
- `features/index.ts` and `contribution.ts`, with `feature-seams.test.ts`;
- `integrations/index.ts`, with `integrations-foundation.test.ts`;
- `sessions/manager.ts` and `types.ts` (no later phase 6 item edits them);
- `playbooks/types.ts` and `playbooks/store.ts`;
- `playbooks/drafts.ts` (only item 10 later, in wave 3);
- `playbooks/dry-run.ts` (only item 09 later);
- `triggers/store.ts` (only item 04 later);
- `agents/settings.ts`;
- `console/threads.ts`;
- `auth/credential-env.ts`;
- `app/src/api/contract.ts`, with `console-contract.test.ts`;
- `app/e2e/fixture-kernel.ts`;
- the Integrations screen stub;
- `ARCHITECTURE.md`, `UI.md` and the stub pages.

`sessions/policy.ts` is item 07's alone. `app/src/screens/team/` is item 08's alone.

**Companions rules proposed with this plan** (`.agent/companions.json`, in a separate PR from a worktree branch):
- `kernel/src/integrations/index.ts` → `kernel/test/integrations-foundation.test.ts`.

Every other coupling phase 6 touches is already declared: migrations → `store.test.ts`; `policy.ts` → `sessions-policy.test.ts`; `brain/templates.ts` → `brain.md` and `brain.test.ts`; `agents.md` ↔ `charter-files.ts` and `agents-roster.test.ts`; `contract.ts` → `console-contract.test.ts`.

## Considered and not queued
- **Reusing the `gh` CLI's login, or a GitHub App:** not chosen. The owner's own read-only token goes in the Keychain.
- **A cron trigger where the agent lists PRs itself:** not chosen. The kernel couldn't skip unchanged PRs, and the PR text would arrive unwrapped.
- **`gh` read commands for reviewing sessions:** not chosen. Reads go only through the wrapped kernel tools.
- **Draft as a never-list only, or as holds the owner denies:** not chosen. A per-playbook `mode: draft` keeps the would-be post.
- **A fixture PR or a list-only dry run:** not chosen. The dry run reviews one real PR, in forced draft.
- **Using Loomwright's `/review-pr`:** not queued. It heals by pushing fixes, which draft mode forbids. How the reviewer reviews is its charter's business (D3).
- **Accepting write-scoped tokens with a warning:** not chosen. They're refused in phase 6.
- **A connector-level repo allow-list:** not chosen. The repos live in each poll, bounded by the token's reach.
- **Running on loomwright-studio's own PRs:** not chosen. A private sandbox repo is used.
- **Building the screen without a mockup:** not chosen (D9).
- **Webhooks instead of polling, and `live` posting:** later (phase 8 or beyond).

## Revisit when
- **Phase 8 (acceptance test 2):** `live` mode, write-scoped tokens, and posting through an approval-gated path. Merging only through Loomwright's gated `--auto-merge` (invariant 4).
- **Phase 7 (GUI v2):** the Playbooks and Schedules screens show the poll spec, the mode and the dedupe key in full.
- **Phase 9:** more connectors on the Integrations screen.
- **Item 03's probe:** if it finds no reliable way to read a fine-grained token's permissions, the owner decides the fallback before items 03 and 11 proceed.

## Checklist
- [ ] .supervisor/requirements/phase-6/2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095102-the-integrations-screen-mockup.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095103-the-github-connector-token-validation-and-reachable-repos.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095104-a-poll-trigger-fetches-a-source-at-a-user-set-interval.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095105-one-playbook-run-per-item-deduped-by-item-fields.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095106-read-only-github-tools-return-pr-text-as-untrusted-data.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095107-draft-mode-records-outward-calls-instead-of-sending-them.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095108-the-owner-grants-an-agent-github-access.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095109-a-poll-playbooks-dry-run-previews-one-real-pr.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095110-wright-drafts-a-pr-review-duty-from-one-sentence.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095111-the-integrations-screen.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095112-draft-output-and-poll-cards-in-threads.md
- [ ] .supervisor/requirements/phase-6/2026-10-24-095113-phase-6-exit-check.md
