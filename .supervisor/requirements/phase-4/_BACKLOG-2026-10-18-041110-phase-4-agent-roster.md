# Phase 4 — agent roster: identities, per-agent memory, permission policy, budget — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
Phase 3 was marked done on 2026-10-18, after a live rerun passed all six steps (#81). Item 10 (#79) made the kernel apply an approved kernel action itself.

ROADMAP phase 4 is done when "a specialist created from chat can do only what its policy allows. Tested: a comment-only reviewer can't push."

Nothing crew-shaped exists in code yet:
- No `agents` table: migration 001 says none, although the ARCHITECTURE data model lists one.
- The brain routes only `wright` (`BRAIN_AGENTS`), and there is one settings reader (`readWrightSettings`).
- Dry runs and fires run under Wright's settings and memory dir, and a fire for any other agent fails `agent_not_routed`.
- Per-agent token limits exist in the budget types, but the kernel never feeds them.
- No sessions-at-once limit exists.
- `kernel_agent_*` tools don't exist.
- A policy that allows the `git` prefix can only hold a push for approval; nothing can forbid it outright.

## Owner decisions
Recorded 2026-10-18 in the product-owner session, over four rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries a copy under its own "Owner decisions" heading.
- **Creation from chat:** Wright drafts a charter and calls `kernel_agent_create`, which is always held. The owner's `once` makes the kernel create the agent itself (kernel-applied). The owner can also create one with `studio agents create --from <file>`.
- **Storage:** `memory/<id>/role.md` holds the prose charter, `config/agents/<id>.json` the enforced settings (`wright.json`'s shape plus `never`, `limits`, `workspaces`), and the `agents` table the registry. The kernel enforces only the JSON and the table.
- **Changes:** the owner makes them directly (the file, or `studio agents set`). Wright proposes with `kernel_agent_update`, which is held and kernel-applied. No crew member can change any settings.
- **Limits:** `limits.tokens_per_day` and `limits.sessions_at_once` are optional, and unset means no limit. At sessions-at-once, the start is parked until a session ends.
- **Boundaries:** the allowlist plus a per-agent `never` list from a closed set of the rail's outward categories. A match is denied outright (`agent_boundary`), never held, never granted.
- **Routing:** `studio ask --agent <id>`, and the member's own session. Wright never answers for it.
- **Delegation:** `kernel_agent_message`, not held. It is wrapped as untrusted data from `agent:<sender>`, and the reply returns to the sender.
- **Loop guard:** a chain depth checked against the sender's `limits.delegation_depth` (unset means no limit). A refusal notifies once.
- **Crew playbooks:** Wright drafts them. Dry run, enable and fires run as the crew member. Crew members don't draft playbooks.
- **Memory:** a member's own four files plus `memory/shared/*.md`, never Wright's or another member's.
- **Workspaces:** absolute repo paths in the settings (D31-checked). A message may name one as cwd; otherwise the session runs in `memory/<id>`.
- **Identity:** a stable lowercase id (never reused; `wright` reserved), a renamable display name, and an avatar (a D23 creature and a `crew-*` hue). `studio agents off` never deletes memory.
- **Live exit:** a throwaway local repo with a local bare remote, no GitHub. The reviewer's push is denied and the remote's ref is unchanged; its `gh pr comment` is held, and the owner denies it.
- 2026-10-20 (from the 2026-10-19 live run's step 2): `kernel_agent_create`'s `z.record` input made the Agent SDK's `tools/list` throw, so every session got no kernel tools. The fix has three parts: the schema, a CI test listing every shipped tool the SDK's way, and a start-time self-check that refuses a kernel whose tools can't list. Copied into item 10.

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 01 | Migration 014 (`agents`, `brain_messages` delegation columns), `kernel/src/agents/` shell with per-item parts, `readAgentSettings` / `agentMemoryDir` / `isRoutable` for every agent, the closed `never` categories and the gate's `boundaryDecision` call site, `kernel_agent_create`/`_update` always held and kernel-applied, Wright's four tool names reserved, stub doc pages | none | nothing (it's first) |
| 02 | Charter shape and validation, `createAgent` (row + `role.md` + settings + memory, self-healing), `studio agents list/show/create --from/rename/set/off/on` | 01 | 03, 04, 06 |
| 03 | `never` list denied outright (`agent_boundary`) before any grant or hold | 01 | 02, 04, 06 |
| 04 | Tokens per day and sessions at once per agent, read from each agent's settings at admission | 01 | 02, 03, 06 |
| 06 | `kernel_agent_message` with the chain-depth check | 01 | 02, 03, 04 |
| 05 | Routing to crew members (own context, settings, workspace cwd), `agent:<id>` source, reply-back to the sender, `studio ask --agent`, `studio messages` | 01, 02 | 07, 08 |
| 07 | `kernel_agent_create` / `_update` / `_list`: charter shown in the approval, kernel creates or changes on `once` | 01, 02 | 05, 08 |
| 08 | Playbooks Wright drafts for a crew member; dry run, enable and fires run as that member | 01, 02, 03, 04 | 05, 07 |
| 09 | Exit check: deterministic test, live harness and runbook (comment-only reviewer can't push), evidence, ROADMAP/ARCHITECTURE/OPEN_QUESTIONS | 01–08 | nothing (it's last) |
| 10 | Live run 2026-10-19 step 2 finding: every kernel tool's schema serialises through the SDK (`kernel_agent_create` loses its `z.record`), a CI test lists every shipped tool the SDK's way, and the kernel refuses to start when a tool can't list; then the live exit is rerun | none (01–09 merged) | nothing (one item) |
| 11 | Item 09's finding (PR #93): the kernel records each session's working directory, so the store shows where a session ran; three open questions for the owner (column or event, what a resume records, path as given or realpath) | none | nothing: it shares `docs/ARCHITECTURE.md` with 10, so it runs in its own run |
| 12 | Found during the 2026-10-20 live rerun: `npm test` posts real macOS notifications (`agents-charter-tools.test.ts` boots a kernel with the shipped notifications delivery); a run-wide vitest guard refuses the real notifier outside `STUDIO_LIVE=1`, and the seven exposed tests inject a stub | none | 11 (disjoint Touches) |

## Run
Checked with `automate-helpers.sh plan-waves .supervisor/requirements/phase-4 --max 9 --explain` on 2026-10-18 (Loomwright 17.6.1, resolved from `installed_plugins.json`), with the companions rules below applied:

```
wave 1: 01
wave 2: 02 03 04 06
wave 3: 05 07 08
wave 4: 09
```

Every wait is a real dependency, and none comes from a file conflict.
- 05 waits on 02 because routing calls `ensureAgentFiles` and its tests create members with `createAgent`.
- 07 waits on 02 for `validateCharter` / `createAgent`.
- 08 waits on 02, 03 and 04, because a crew fire must run under the member's `never` list and limits.

N is each wave's width: wave 2 runs at `--parallel 4` and wave 3 at `--parallel 3`. A wave merges as one PR the owner reviews. One-item waves (01, 09) run sequentially, since a one-item wave still pays the full lane cost.

1. `/automate --backlog .supervisor/requirements/phase-4/_BACKLOG-run-1-foundation.md`: sequential, item 01. The owner merges it.
2. `/automate --backlog .supervisor/requirements/phase-4/_BACKLOG-run-2-features.md --parallel 4`: items 02, 03, 04 and 06, one wave of four, one wave PR.
3. `/automate --backlog .supervisor/requirements/phase-4/_BACKLOG-run-3-crew.md --parallel 3`: items 05, 07 and 08, one wave of three.
4. `/automate --backlog .supervisor/requirements/phase-4/_BACKLOG-run-4-exit.md`: sequential, item 09, with the live run (D33: an agent may run it while the owner watches; the owner decides every approval).
5. `/automate --backlog .supervisor/requirements/phase-4/_BACKLOG-run-5-tools-list-fix.md`: sequential, item 10, from the 2026-10-19 live run (evidence `docs/evidence/phase-4-exit-live-2026-10-19.json`). Then rerun the live exit (`docs/evidence/phase-4-exit-runbook.md`); the rerun is not a queue item.
6. `/automate --backlog .supervisor/requirements/phase-4/_BACKLOG-run-6-session-cwd.md`: sequential, item 11, only after the owner has answered its three open questions in the item file (a lane that finds one open stops and implements nothing). It does not block the live rerun; run it before the rerun only if you want the rerun's evidence to read the recorded cwd directly.
7. `/automate --backlog .supervisor/requirements/phase-4/_BACKLOG-run-7-test-notifier-guard.md`: sequential, item 12. Its Touches are disjoint from item 11's, so the two can share a run once item 11's questions are answered.

Safe mode throughout (no `--auto-merge`). Push these items to the metadata branch (`meta-sync.sh push --paths-from`) before a lane can read them. If a lane needs a file outside its Touches that another lane in the same wave owns, it stops and says so; it doesn't edit the file. New findings join this plan doc as new items.

**Hotspots, each owned by item 01 alone:**
- migrations + `store.test.ts`;
- `features/index.ts` + `feature-seams.test.ts`;
- `agents/index.ts` + `agents-foundation.test.ts`;
- brain settings, templates, `brain.md` and `brain.test.ts`;
- `sessions/policy.ts`, `manager.ts` and `types.ts`;
- `approvals/store.ts` and its pins in `approvals.test.ts` and `kernel-tools.test.ts`;
- `ARCHITECTURE.md`.

Later items edit only their own module, test and doc page. Within a wave:
- 04 alone owns `kernel/src/kernel.ts` (wave 2);
- 03 alone owns `docs/architecture/approvals.md` (wave 2);
- 05 alone owns `brain.md` (wave 3);
- 02 (wave 2) and 07 (wave 3) share `docs/architecture/agents.md`, which is safe because they run in different waves.

**Companions rules added with this plan** (`.agent/companions.json`, committed in a separate PR):
- `kernel/src/agents/charter-files.ts` → `docs/architecture/agents.md`, `kernel/test/agents-roster.test.ts`. Item 02 pins the doc's example `role.md` equal to the renderer.
- `docs/architecture/agents.md` → `kernel/src/agents/charter-files.ts`, `kernel/test/agents-roster.test.ts`.
- `kernel/src/agents/index.ts` → `kernel/test/agents-foundation.test.ts`. The parts are pinned there, the same way `features/index.ts` is.

## Considered and not queued
- **A single combined roster item (02 + 07):** split, because 02's `createAgent` is shared by the owner path and the kernel-applied path, and keeping 07 apart keeps the wave-2 PR reviewable.
- **Enforcing prose boundaries:** rejected by the owner's storage decision. The kernel enforces only the settings JSON and the table.
- **Holding every delegation for approval:** not chosen ("not held").
- **A fixed hop limit in code:** not chosen. The chain depth is the owner's per-agent setting.
- **Crew members drafting their own playbooks:** not chosen.
- **A workspace per playbook** (crew playbook sessions run in `memory/<id>`): later; revisit with phase 6 connectors.
- **Shared notes in Wright's own context:** unchanged in phase 4.
- **A per-agent "allowed integrations" field:** waits for connectors (phase 6, D12).
- **Deleting an agent, or reusing an id:** not in scope (`off` only).
- **Recognising `env git push`, `sh -c` or a script that pushes:** a rail limit, documented by item 03 and not built.

## Revisit when
- Connectors land (phase 6): per-agent integrations, a playbook's workspace, real `gh pr comment` posting.
- GUI v1 (phase 5): the Team screen and Charter component replace `studio agents` / `studio messages` as the owner's surface (D25).

## Checklist
- [ ] .supervisor/requirements/phase-4/2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041102-the-owner-creates-lists-renames-sets-and-turns-off-crew-members.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041103-a-crew-members-never-list-is-denied-outright.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041104-token-limits-and-sessions-at-once-per-agent.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041106-wright-delegates-to-a-crew-member-within-a-chain-depth.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041105-a-message-reaches-the-crew-member-it-is-for.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041107-wright-drafts-a-charter-and-the-kernel-creates-it-on-approval.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041108-wright-drafts-playbooks-a-crew-member-runs.md
- [ ] .supervisor/requirements/phase-4/2026-10-18-041109-phase-4-exit-check.md
- [ ] .supervisor/requirements/phase-4/2026-10-20-004500-every-kernel-tool-schema-serialises-through-the-sdk-and-the-kernel-checks-it-at-start.md
- [ ] .supervisor/requirements/phase-4/2026-10-20-011500-the-kernel-records-each-sessions-working-directory.md
- [ ] .supervisor/requirements/phase-4/2026-10-20-111606-no-test-run-posts-a-real-notification.md
