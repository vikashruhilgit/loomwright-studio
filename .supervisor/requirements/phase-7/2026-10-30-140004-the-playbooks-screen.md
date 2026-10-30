# 04 — The Playbooks screen: every behaviour Wright wrote, its history, and field-level edits

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D3, D4, D9, D24, invariant 1

**As** the owner,
**I want** a screen listing every playbook with its intent, trigger, dedupe key, priority, model, mode, last run, tokens and on/off, with field-level edits and its run and version history,
**so that** I set each playbook's policy directly instead of through chat or the CLI.

## Problem

`GET /playbooks`, `GET /playbooks/:ref`, `POST /playbooks/:id/set|off|run` exist, and Chat's playbook card shows and sets fields (phase 5 item, "the playbook card shows and sets every field honestly"). Nothing lists a playbook's runs or versions (`playbook_runs`, `playbook_versions`), and DESIGN.md defers field-level playbook editing to GUI v2.

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Scope

1. **Routes (the `playbook-history` part).** `GET /playbooks/:id/runs` (paged: status, item, revision, tokens, session, started and ended) and `GET /playbooks/:id/versions`. Edits reuse `POST /playbooks/:id/set`; its refusals are shown as they are.
2. **The screen** (`app/src/screens/playbooks/`), built to item 02's mockup: list, detail, field-level edit, version and run history, Turn on/off through the approval it already requires, Run now, and "Edit in English", which opens Wright's thread with the playbook named and sends nothing by itself.
3. Every value is the owner's: the screen never fills a default the owner did not set (invariant 1; D4). Tokens are shown as counted (D26); dollars only as "≈ at API rates" (D24).
4. **Polish gate.** The PR commits screenshots from the running app, in light and dark, of every state the mockup shows for this screen, and names the mockup state each matches. The owner's approval of the PR is the gate (D9; phase 5's polish-gate decision).

## Non-goals

- A playbook editor that writes prose for the owner.
- Any new playbook field or kernel behaviour.

## Acceptance criteria

- [ ] Given the fixture kernel, then the list and detail show every field the mockup shows, with the poll spec, mode and dedupe key in full (phase 6's "Revisit when").
- [ ] Given a field edit, then it goes through `POST /playbooks/:id/set`, a refusal is shown with its reason, and nothing changes locally until the kernel answers.
- [ ] Given Turn on, then the held approval is shown, never bypassed.
- [ ] Given "Edit in English", then Wright's thread opens with the playbook named, and no message is sent until the owner sends it.
- [ ] Given the kernel unreachable, then the shared band shows and the screen keeps its last data without a throw.
- [ ] Given the keyboard only, then every action on the screen is reachable, and the palette lists the screen's commands.
- [ ] Given a live event on the feed that changes what the screen shows, then it updates without a reload and without layout shift.
- [ ] Given VoiceOver, then every control and status has a label, and both themes meet WCAG 2.1 AA contrast.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup state.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- The Playwright e2e for the screen (launched only through `app/e2e/electron-harness.ts`).
- `cd kernel && npm ci && npm run typecheck && npm test` (the screen's routes).
- `bash scripts/check-docs.sh`

## Assumptions

- `playbook_runs.tokens` is the per-run count the meter recorded (D26).

## Risks

- Overlap with Chat's playbook card: the two must agree. Reuse its field components rather than copying them.

## Depends on
2026-10-30-140001-phase-7-foundation-contract-route-seams-and-screen-stubs.md
2026-10-30-140002-the-gui-v2-mockup.md

## Touches
kernel/src/gui/playbook-history.ts
kernel/test/gui-playbook-history.test.ts
app/src/screens/playbooks
app/e2e/playbooks.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-30T16:05:25Z
- **Brief:** .supervisor/jobs/done/2026-10-30-the-playbooks-screen.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/182
