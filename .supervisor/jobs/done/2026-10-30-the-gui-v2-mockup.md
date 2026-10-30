# Supervisor Job: The GUI v2 mockup (phase 7, item 02, D9 gate)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-142644/L2
- **CLAUDE.md:** ✓ Found (fresh — every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (phase 7 item 01, the foundation contract, runs in a parallel lane and is not merged at the base commit; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140002-the-gui-v2-mockup.md
- **Base commit:** 94cc13ca0bd810e4258c2b335d4a08228a2a67fd

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | A static, self-contained HTML mockup in `docs/design/mockups/`, the same form as the approved `gui-v1.html` (964 lines) and `integrations.html` (919 lines): one file, inline `<style>`/`<script>`, no build, no `<link>`/`<script src>`. |
| 2 | Dependency Availability | GO | `docs/design/tokens.json` and its generator `app/scripts/tokens.mjs` exist; `node app/scripts/tokens.mjs` prints 195 lines. The components the requirement names all have folders under `docs/design/design-system/components/` (plus Table, Button, CommandPalette, Charter, ChatBubble, Cover). Screenshots need headless Chromium: Playwright is an `app/` devDependency. |
| 3 | Architecture Fit | CAUTION | D9 and the phase 0/phase 6 precedent fit. But the requirement's Settings copy names "`studio auth …`" as a terminal command, and no such command exists at the base commit: the phase 5 commands are the three in `app/src/shell/KernelStates.tsx` `SETUP_STEPS` (`claude setup-token`, `security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w`, `studio service install`). The mockup shows only real commands, and lists `studio auth …` as an open point. |
| 4 | Scope vs Supervisor Capability | CAUTION | Six screens with five to seven states each, plus Integrations polish and a keyboard map, in one HTML file: about 2,000–2,800 hand-written lines. That is past `context-bound` (> 800 changed lines), so the file is built in two serialized subtasks, then the docs and evidence in a third. |
| 5 | Hard Blockers | GO | No sibling phase 7 item touches `docs/DESIGN.md` or `docs/design/` (item 01 touches `docs/UI.md`, `docs/ARCHITECTURE.md` and app/kernel code). The mockup depends on nothing unmerged: it maps fields to kernel columns at the base commit and to the shapes item 01's requirement lists (see AC7). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Add one hi-fi, clickable mockup, `docs/design/mockups/gui-v2.html`, of every phase 7 screen (Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit, Settings, Integrations polish) with every designed state in light and dark and the keyboard map, and record in `docs/DESIGN.md` what it commits items 03–09 to, so the owner approves the design on this PR before any screen code (D9).

**Problem Statement:**
The owner needs one approved GUI v2 design because D9 forbids coding a screen before its mockup is approved, and items 03–09 build these screens.
Currently, the approved mockups cover only GUI v1 (`gui-v1.html`) and Integrations (`integrations.html`), and `docs/DESIGN.md` defers "field-level playbook editing, memory file viewing" under "Not in v1". This blocks items 03–09.
Success looks like a merged PR (the owner's approval, D9) carrying `gui-v2.html`, an updated DESIGN.md, and committed screenshots of every view in both themes.

### Owner decisions (2026-10-30, binding, from the requirement)
- **Hooks is deferred to phase 9.** No Hooks screen in phase 7 (`hooks_installed` does not exist: `kernel/src/store/migrations/001_initial.ts:9`). DESIGN.md records this.
- **Tasks shows today's kernel data:** tasks, playbook runs and sessions grouped by state, with click-through to history and session logs. Linked PRs/tickets, approvals counts and CI state join in phase 8, so the mockup shows none of them.
- **Integrations is polish only.** No new connector. The known gap: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` in `app/src/screens/integrations/IntegrationsView.tsx:205` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9):** one file holds every screen and state, light and dark, its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging.
- **Each screen's kernel routes ride with that screen's item;** this item adds no route and no code.
- **Settings shows the auth provider read-only:** the active provider, its health and its token's state, plus the terminal commands that change it. No secret entry, no sign-in control of any kind (invariant 6).

### Design content (binding, from the requirement's Scope)
- **Shell:** reuse gui-v1's window (sidebar, title bar, inspector, list pane widths from tokens), its review strip `.review` and its `Kernel unreachable` band, and `integrations.html`'s URL-hash state hook (`#view=<view>&theme=<light|dark|system>`, its own-keys-only view lookup and its fallback to a default view on an odd hash). The sidebar lists the GUI v1 screens, Integrations, and the six new ones.
- **Tasks:** a board grouped by state with three kinds of card (task, playbook run, session); a card's click-through to its history and its session log (StreamingLog); a designed empty state for "no tasks yet".
- **Playbooks:** a list with intent, trigger, dedupe key, priority, model, mode, last run, tokens (dollars only as "≈ at API rates", D24), on/off; a detail with field-level edit, version history, and "Edit in English" (opens Wright's thread with the playbook named).
- **Schedules & triggers:** a timeline of upcoming wake-ups, polls and cron fires, and firing history with missed fires and their reasons.
- **Memory:** the per-agent tree (role, preferences, people, lessons) and shared memory; a file view; an edit with save; the "changed since you opened it" conflict state.
- **Budget & audit:** usage per day, agent and playbook against each limit (tokens per day and sessions at once, D24); cap state; the full event log with filters.
- **Settings:** the auth provider read-only with its health and the terminal commands that change it; data location; launch at login; notifications; theme. No sign-in control.
- **Integrations polish:** the token-connected detail gains a path to the GitHub App without Disconnect (the token stays in use until the App connects — a proposal the owner approves on this PR).
- **States per screen (the review strip and the URL hash force each):** empty, loading, populated, error (a route failure, distinct from the band), waiting on you where it applies (at least Tasks, Playbooks and Budget & audit; any screen without one says why in the evidence README), and kernel unreachable (the shared band).
- **Keyboard map:** each screen's shortcut and palette commands. Proposal (item 01's requirement): Integrations `⌘5` (unchanged), Tasks `⌘6`, Playbooks `⌘7`, Schedules `⌘8`, Memory `⌘9`, Budget & audit palette only, Settings `⌘,`; in a browser tab `⌃` replaces `⌘`, as gui-v1 does. A keyboard-map view lists every shortcut and palette command.
- **Components:** List, Card, Badge, StatusDot, Dialog, Input, Toast, DiffView, StreamingLog, EventCard, Avatar (plus Button, CommandPalette and Table as they already are). Any new component or token is named and justified in the evidence README.
- **Branding (invariant 7):** "Wright, powered by Claude" is allowed; nothing says or looks like "Claude Code".

## Acceptance Criteria
- [ ] AC1 — Given `docs/design/mockups/gui-v2.html` opened in a browser, when the review strip (or the URL hash `#view=<view>&theme=<light|dark>`) selects each screen and state, then every view renders in light and dark: for each of Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit and Settings its empty, loading, populated, error and kernel-unreachable views and its waiting-on-you view where it applies; plus the Tasks click-through, the Playbook detail, field-level edit and version history, the Memory file view, edit and conflict, the filtered audit log, the Integrations token-to-App path, and the keyboard map. The committed evidence file `docs/evidence/gui-v2-mockup/README.md` lists every view's light and dark screenshot (PNGs in that folder, each a relative link that `bash scripts/check-docs.sh` resolves), the exact command that regenerates each one, and for any screen without a waiting-on-you view, why. The PR body links to it.
- [ ] AC2 — Given the mockup, then every colour, spacing, radius, shadow, duration, easing and type value comes from `tokens.json` under the generator's names: the token block is the verbatim stdout of `node app/scripts/tokens.mjs` between `/* tokens:begin */` and `/* tokens:end */`, and generator names (`--radius-lg`, `--duration-base`, `--space-4`) are used, never gui-v1's short forms (`--r-lg`, `--d-base`, `--ease`). The evidence README contains (a) the command that diffs that block against `node app/scripts/tokens.mjs` and its empty result, and (b) a table naming every value outside the block, each marked "new — <justification>" or "review-harness chrome (not app UI)", and every new component, each named and justified.
- [ ] AC3 — Given Budget & audit and Playbooks, then every limit is in tokens or sessions at once, and any dollar figure is labelled "≈ at API rates" (D24). A grep of the mockup for `$` followed by a digit finds each hit beside "≈ at API rates".
- [ ] AC4 — Given Settings, then no control signs in to anything (no claude.ai sign-in, no OAuth button, no secret field), the auth provider is read-only with its health, its token's state and the terminal commands that change it, and nothing in the mockup says or looks like "Claude Code" (invariants 6, 7). `grep -n "Claude Code" docs/design/mockups/gui-v2.html` prints nothing.
- [ ] AC5 — Given `docs/DESIGN.md`, then a new "Phase 7: GUI v2" section names `design/mockups/gui-v2.html` and lists what the mockup commits items 03–09 to, in the form of the existing "What the mockup commits phase 6 item 11 … to" section, with its open points for the owner. It records that the Hooks screen moved to phase 9 (owner, 2026-10-30) and what Tasks shows in phase 7. The "Approved artefacts" table gains a row for the GUI v2 mockup linking the evidence README, and the "Not in v1" list no longer names field-level playbook editing or memory file viewing. `bash scripts/check-docs.sh` prints `check-docs: OK`.
- [ ] AC6 (owner gate, not worker-satisfiable) — The owner approves the PR, which is the D9 gate. Supervisor and `/review-pr` never merge it. The evidence is the owner's GitHub approval and merge, not the PR body.
- [ ] AC7 (from the requirement's Risks: "every field shown must map to a column or route") — Given the evidence README, then a field map table lists, per screen, every data field the mockup shows and its source: a kernel column at the base commit (`<migration file>: <table>.<column>`, e.g. `001_initial.ts: tasks.state`), an existing route, or a shape item 01's requirement declares (its Scope §1). A field with no source is removed from the mockup or listed as an open point for the owner, never shown as if it existed.

**Evidence rule:** AC1, AC2 and AC7 rest on the committed `docs/evidence/gui-v2-mockup/README.md`. FINALIZE lists it in the PR body's `## Evidence` section and may embed screenshots, but the PR body is never their only home.

## File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `docs/design/mockups/gui-v2.html` | CREATE | — | HIGH | The new mockup, self-contained like `gui-v1.html`. A separate concern, so its own file rather than appended to gui-v1 (964, past the 500-line threshold) or integrations.html (919). Expected 2,000–2,800 lines, written by subtasks 1 and 2 in order. |
| `docs/DESIGN.md` | MODIFY (130) | 130 | HIGH | New "Phase 7: GUI v2" section, an "Approved artefacts" row, the "Not in v1" edit and the Hooks note. Below the threshold. |
| `docs/evidence/gui-v2-mockup/README.md` | CREATE | — | HIGH | Evidence for AC1, AC2 and AC7, in the format of `docs/evidence/github-app-mockup/README.md` (screenshots table, "What was driven by hand", token audit, field map). |
| `docs/evidence/gui-v2-mockup/*.png` | CREATE (~80–100) | — | MEDIUM | `gui-v2-<view>-<light\|dark>.png`. Binary outputs, never read into a worker's context. Count depends on the final view list. |

Reference only, not modified: `docs/design/mockups/gui-v1.html` (shell, review strip, `tg-offline` band, palette builder at line 806, `⌘1–4`/`⌃1–4`), `docs/design/mockups/integrations.html` (URL-hash hook at lines 550 and 915, `tokens:begin` block, review strip groups), `docs/design/tokens.json`, `app/scripts/tokens.mjs`, `docs/design/brand-book.md`, `docs/design/design-system/components/*/`, `app/src/shell/KernelStates.tsx` (the real terminal commands and the band copy), `app/src/screens/integrations/IntegrationsView.tsx` (`TokenDetail`), `kernel/src/store/migrations/*.ts` (tables: `tasks`, `sessions`, `events`, `budget`, `wakeups`, `cap_state` in 001; `triggers`, `approvals` in 011; `playbooks`, `playbook_versions`, `playbook_runs` in 013; `agents` in 014; `auth_providers` in 002; `connectors` in 017), and `.supervisor/requirements/phase-7/2026-10-30-140001-phase-7-foundation-contract-route-seams-and-screen-stubs.md` §Scope 1 (item 01's declared shapes). `docs/UI.md` is item 01's file and is not touched here.

Validator-owned surfaces: `scripts/check-docs.sh` scans every `*.md` under `docs/` for relative links (so the evidence README's PNG links and DESIGN.md's new links must resolve). Its avatar-hue rules name only `gui-v1.html`, `avatar.js`, component previews and `app/src/components/Avatar`, so they do not scan `gui-v2.html`; avatars drawn in it must still use `crew-*` hues (or `accent` for Wright), never a semantic token (rule 4's intent).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | gui-v2.html shell, shared states, Tasks, Playbooks, Schedules & triggers | AC1 (these three screens' views), AC2, AC3 (Playbooks), AC4 (branding) | 0 modify, 1 create | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |
| 2 | Memory, Budget & audit, Settings, Integrations polish, keyboard map | AC1 (remaining views), AC2, AC3 (Budget & audit), AC4 | 1 modify (gui-v2.html from #1) | `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |
| 3 | DESIGN.md section, evidence README, screenshots and field map | AC1 evidence, AC2 evidence, AC5, AC7 | 1 modify, 1 create (+PNG outputs) | `skills/frontend-ui/SKILL.md` | BLOCKED (by #2) |

Subtask 1 owns the file's skeleton: the token block, the shell, the review strip with one group per screen, the URL-hash hook (own-keys lookup, odd-hash fallback), the shared kernel-unreachable band, the palette builder and the theme switch. Subtask 2 adds its screens into that skeleton (new view keys, new review-strip groups, palette entries) and builds the keyboard-map view from every screen's shortcuts. Subtask 3 changes no HTML except to fix a defect it finds while taking screenshots, and records any such fix in the README.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/design/mockups/gui-v2.html"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "tokens:begin"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "Kernel unreachable"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "tasks-empty"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "playbooks-edit"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "schedules-populated"}
requires: []
lanes:
  - "docs/design/mockups/gui-v2.html"
external_requires:
  - "Node.js (runs app/scripts/tokens.mjs)"

# Subtask 2
provides:
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "memory-conflict"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "budget-populated"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "settings-populated"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "integrations-token-to-app"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "keymap"}
requires:
  - {from: 1, kind: "file", path: "docs/design/mockups/gui-v2.html"}
  - {from: 1, kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "tokens:begin"}
lanes:
  - "docs/design/mockups/gui-v2.html"
external_requires: []

# Subtask 3
provides:
  - {kind: "symbol", path: "docs/DESIGN.md", name: "Phase 7: GUI v2"}
  - {kind: "file", path: "docs/evidence/gui-v2-mockup/README.md"}
requires:
  - {from: 2, kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "keymap"}
  - {from: 2, kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "memory-conflict"}
lanes:
  - "docs/DESIGN.md"
  - "docs/evidence/gui-v2-mockup/**"
  - "docs/design/mockups/gui-v2.html"
external_requires:
  - "A headless Chromium for screenshots, e.g. `cd app && npm ci && npx playwright install chromium`, then `npx playwright screenshot --color-scheme=<light|dark> --viewport-size=1280,1000 'file://<abs>/docs/design/mockups/gui-v2.html#view=<v>&theme=<t>' <out>.png`"
```

## Parallelism Analysis

Serialized: 1 → 2 → 3. Subtasks 1 and 2 write the same file; subtask 3's screenshots need every view. No fan-out.

### Batch Plan
- **Batch 1:** subtask 1
- **Batch 2:** subtask 2
- **Batch 3:** subtask 3
- **Recommended workers:** 1 at a time

## Skill References

| Subtask | Skills |
|---------|--------|
| 1, 2 | `skills/frontend-ui/SKILL.md` (design-system reuse, WCAG 2.1 AA, keyboard reachability, focus return) |
| 3 | `skills/frontend-ui/SKILL.md` (contrast checks in both themes while reviewing screenshots) |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` (no `hooks_installed` table exists) | tip 68 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Source | Mitigation |
|------|--------|--------|------------|
| Size: six screens with every state is a large file; one worker's context cannot hold it all (requirement Risk) | HIGH | Feasibility (Phase 2.5) | Split into two serialized HTML subtasks with a fixed skeleton owned by subtask 1. Reuse the GUI v1 shell and components; invent nothing that exists. |
| Designing data the kernel does not have; item 01's contract is not merged at the base commit (requirement Risk) | MEDIUM | Feasibility (Phase 2.5) | AC7's field map ties every field to a column at the base commit or to a shape item 01's requirement declares. A field with no source is removed or listed as an owner open point. |
| Settings names a command that does not exist (`studio auth …` is not a CLI command at the base) | MEDIUM | Feasibility (Phase 2.5) | Show only the real commands from `app/src/shell/KernelStates.tsx` `SETUP_STEPS`. List `studio auth …` as an open point in DESIGN.md. |
| Prior churn on the sibling mockup `integrations.html`: 2 self-heal rounds (`self_heal_churn`), one a HIGH focus-restore defect | MEDIUM | Prior churn (postmortem ledger) | Copy integrations.html's focus rules: `Esc` closes, focus is trapped in dialogs and returns to the control that opened them (or a stable row when it is gone); the hash lookup reads only own keys. Subtask 3 drives the dialogs, palette and memory conflict by hand in headless Chromium and records it under "What was driven by hand". |
| Copying gui-v1's token block, which uses short names and adds non-token chrome (`--desk`, `--menubar`, `--pill-ink`, `--win-shadow`), fails AC2 | MEDIUM | Analysis | Paste `node app/scripts/tokens.mjs` stdout as the token block. Keep harness chrome in a separate, labelled block listed in the AC2 table. |
| Dollar figures shown as limits (D24) | MEDIUM | Analysis | AC3 grep. Limits are tokens per day and sessions at once; dollars only as "≈ at API rates". |
| Branding slip or a sign-in control in Settings (invariants 6, 7) | MEDIUM | Analysis | AC4 grep; Settings has no secret field and no sign-in. |
| Showing phase 8 data on Tasks (linked PRs, approvals counts, CI state) or a Hooks screen | LOW | Analysis | The owner decisions above are binding; DESIGN.md states what Tasks shows in phase 7. |
| Merging without the owner's approval (D9) | HIGH | Analysis | AC6 is an owner gate. Never auto-merge; leave the PR for the owner. |

## Configuration
- **Workers:** 1 at a time
- **Mode:** serialized subtasks
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound
- **Threshold note:** the hand-written HTML is about 2,000–2,800 lines (past the 800-line bound). It cannot fan out, since both halves write one file (`file-conflict` would serialize them anyway), so the split is serial. The PNGs are generated binaries no worker reads.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-the-gui-v2-mockup.md
```

## Plan Review: PASS (attempt 1/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | LOW | Configuration | `Mode: serialized subtasks` is not a standard mode word; read it as `sequential`, Workers 1 | deferred (below the MEDIUM fix floor; owner chose Save) |
| 2 | LOW | Task / AC5 | The token-to-App switch proposal contradicts DESIGN.md's "disconnects first" open point and "one GitHub connection at a time" line; the Phase 7 section should mark the switch as a proposal replacing that open point, and AC7 should map its interim state to the `connectors` columns or list it as an owner open point | deferred (below the MEDIUM fix floor; owner chose Save) — subtask 3 should apply this when writing AC5/AC7 |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T10:58:36Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/178
- **Branch:** feature/the-gui-v2-mockup
- **Files changed:** 105
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added docs/design/mockups/gui-v2.html (51 forced views, light and dark, the token block verbatim from tokens.mjs), the DESIGN.md "Phase 7: GUI v2" section, and docs/evidence/gui-v2-mockup/ (README, 102 PNGs, token audit, field map). Phase 4.5 ran 2 fix rounds (the playbook edit refusal state, the duplicate run card, the repeated dedupe field and the token-limit length) and passed on round 3. 7 findings below the MEDIUM floor were dismissed in a marker comment. The review drain did not run because .supervisor/config.json has auto_review: false. AC6 (owner approval and merge, D9) is still open.

## Not verified
- **Settings 'Copy' and Memory 'Copy my version' buttons** — navigator.clipboard under file:// was not observed (subtask 2)
- **VoiceOver reading order on the new views** — not run (subtask 2)
- **Browsers other than headless Chromium** — only Chromium was available (subtask 2)
- **Fields sourced from item 01's declared shapes** — item 01's contract is not merged at the base (subtask 2)
- **Contrast across all 100 screenshots** — 3 were spot-checked, not measured (subtask 3)
- **A fresh-clone run of the regenerate commands** — run from the main checkout's node_modules (subtask 3)
- **Item 01's contract shapes** — not merged at the base (subtask 3)
- **Real-kernel edit-makes-draft and the token-to-App switch** — read from source, not run (subtask 3)
