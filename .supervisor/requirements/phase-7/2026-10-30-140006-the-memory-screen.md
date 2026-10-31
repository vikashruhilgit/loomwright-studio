# 06 — The Memory screen: view and edit each agent's memory files and shared memory

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D34, invariants 3, 8

**As** the owner,
**I want** to view and edit each agent's role, preferences, people and lessons files, and the shared memory, from the app,
**so that** what my crew remembers stays inspectable and correctable, as invariant 8 promises.

## Problem

Memory is markdown under `<dataDir>/memory/` (`memory/<agent>/…`, `memory/shared/…`; `kernel/src/brain/memory.ts`, `kernel/src/agents/memory.ts`), and no route reads or writes it. DESIGN.md defers memory file viewing to GUI v2. Agents write lessons during sessions, so an owner edit can race an agent's write.

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Scope

1. **Routes (the `memory` part).** `GET /memory` (the tree: agents and their files, shared files, size and modified time), `GET /memory/file?path=` (content and a content hash), `PUT /memory/file` (path, new content, base hash). The write is guarded: the path must resolve inside `<dataDir>/memory/` after symlinks, and never inside `config/` (D34's enforced part) or any protected kernel path (invariant 3); markdown files only; a size cap; atomic write; a base hash that no longer matches is refused `changed_since_read` with the current content, never overwritten; each write records one `memory_updated` event naming the path and `owner`.
2. **The screen** (`app/src/screens/memory/`), built to item 02's mockup: the tree, the file view, edit and save, the conflict state with the current text beside the owner's, and the files' paths shown (invariant 8).
3. **Polish gate.** The PR commits screenshots from the running app, in light and dark, of every state the mockup shows for this screen, and names the mockup state each matches. The owner's approval of the PR is the gate (D9; phase 5's polish-gate decision).

## Non-goals

- Creating or deleting memory files, or editing `config/agents/<id>.json` (Team owns settings).
- Any search or summarisation of memory.

## Acceptance criteria

- [ ] Given the fixture memory tree, then every agent's files and the shared files are listed with their paths.
- [ ] Given an edit saved with a matching base hash, then the file is written atomically and one `memory_updated` event is recorded.
- [ ] Given an agent's write after the owner opened the file, when the owner saves, then the kernel refuses `changed_since_read` and the screen shows both versions; nothing is lost.
- [ ] Given a path outside `memory/`, a `..` segment, a symlink leaving `memory/`, a non-markdown file or an oversized body, then the route refuses it and writes nothing (a test per case).
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

- `memory_updated` already exists as an event kind (UI.md's timeline lists "memory updated"); if not, this item adds it to the closed list.

## Risks

- The write route is the first owner route that writes an arbitrary file under the data dir. The path checks are this item's main risk and each gets a test.

## Depends on
2026-10-30-140001-phase-7-foundation-contract-route-seams-and-screen-stubs.md
2026-10-30-140002-the-gui-v2-mockup.md

## Touches
kernel/src/gui/memory.ts
kernel/test/gui-memory.test.ts
app/src/screens/memory
app/e2e/memory.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-31T03:49:30Z
- **Brief:** .supervisor/jobs/done/2026-10-30-the-memory-screen.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/185
