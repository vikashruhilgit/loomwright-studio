# Supervisor Job: The charter card mockup (phase 8 item 18a) — short by default, complete on request, ready-checked

## Environment
- **Project:** loomwright-studio (lane checkout `loomwright-studio-lanes/automate-2026-11-10-173433/L1`)
- **CLAUDE.md:** ✓ Found (fresh — phases and paths it names exist; `bash scripts/check-docs.sh` → `check-docs: OK` at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-18/2026-11-10-204051-the-charter-card-mockup.md
- **Base commit:** 73cba6252d660ea3a4914539634fd9f6de17e89a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | A static, no-build HTML mockup, the same form as the five existing files in `docs/design/mockups/` (e.g. `chat-threads.html`, 1536 lines). Tokens come from `node app/scripts/tokens.mjs` (present; prints 195 lines). |
| 2 | Dependency Availability | GO | No new dependency. Lucide-style inline SVG icons and the design system's components (`docs/design/design-system/components/`: Card, Badge, Button, Dialog, Input, List, Charter, Toast, …) already exist; `--attention` / `--attention-soft` warning tokens exist in the generated token block. |
| 3 | Architecture Fit | GO | D9 requires the mockup before any UI code; this item is exactly that and adds no route or code. It extends item 17a's charter card (`chat-threads.html` §"Approvals: the charter card in plain language"). |
| 4 | Scope vs Supervisor Capability | CAUTION | One worker, two files. The mockup may run to ~1,200–1,600 lines (the 17a mockup is 1536), past the 800-changed-line `context-bound` bound — but it is ONE file, so no split can divide it (a split would serialize on the same file); single subtask kept, see Risk Assessment. |
| 5 | Hard Blockers | GO | None. Headless Chromium is installed locally (Playwright cache) for the worker's own keyboard / light-dark walk. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Add one clickable, no-build mockup, `docs/design/mockups/charter-card.html`, that draws the crew charter card in eight states (compact, details expanded, readiness results, workspace question, Ask / Change box with the thread's new card version, icon tooltips, Settings → Workspaces, and the empty / loading / error states) in light and dark, and link it from `docs/DESIGN.md` with its approval pending.

**Problem Statement:**
The owner needs to see and approve how a crew member's charter card, its readiness results, its workspace question, its Ask / Change box and the saved Workspaces list will look before any of it is built (D9), because the card they approve crew members from must be simple by default and complete on request.
Currently, the Chat charter card renders the kernel's display as a raw `<pre>` (`app/src/screens/chat/cards.tsx:146`), the display is silently cut at 4,000 characters (`MAX_APPROVAL_DISPLAY`, `kernel/src/approvals/store.ts:117,278`), and nothing on the card says that asked-for jobs are missing or that the member has no workspace (found in the item 16 Validation 2 walk, 2026-11-10). This caused the owner to approve-path a charter missing two jobs and a workspace with no way to tell.
Success looks like a mockup the owner can open in a browser, walk all eight states by keyboard in light and dark, and approve (by merging the PR, D9) — which items 18c and 18d then build to.

## Acceptance Criteria

Carried forward verbatim from the source requirement (AC1–AC7), with the Scope 1–8 states they reference spelled out as the worker's checklist.

**States the mockup draws (requirement §Scope 1–8):**
1. **Compact card (default).** Who (avatar, name, repo); **Can do**: each job's plain name with a "used for" line; **Never does**: the never list in plain words; **Limits** in one line; readiness results (state 3).
2. **Details expanded.** Every raw line exactly as enforced (tools, Bash prefixes, limits, workspaces, the settings file, `role.md`), complete, scrolling inside the card, never cut silently.
3. **Readiness results.** One row per duty: ✓ covered by a job, or ⚠ "no job covers this" with an **Add** action; one row per job that needs a workspace or connector: ✓ ready, or ⚠ with a fix action.
4. **Workspace question.** "Where's your copy of <repo>?" with a picker of saved workspaces whose remote matches, **Choose folder…**, and **Clone it for me** (held for approval). A refused protected folder (D31) explained in plain words.
5. **Ask / Change box** on the card, and how the question, Wright's answer and a new card version appear in the drafting thread: the older card marked "Replaced by v2" with what changed.
6. **Icons with tooltips:** copy ("Copy all text"), expand ("Show full details"), more ("Show more"). Copy exists on the whole card and on each details block.
7. **Settings → Workspaces** list: repo, path, last used, remove.
8. Empty, loading and error states for 3, 4 and 7, keyboard order and focus, in light and dark.

**Happy path**
- [ ] **AC1.** Given the mockup file, when it is opened in a browser, then every state in Scope 1 to 8 is visible and reachable by keyboard, in light and dark.
- [ ] **AC2.** Given the compact card state, when it is read, then no `mcp__kernel__` name, JSON or file path is visible until the details are expanded.
- [ ] **AC3.** Given the details state, when it is read, then the full settings file and the full `role.md` are present with nothing cut, and a copy control sits on the card and on each block.
- [ ] **AC4.** Given every icon-only control, when it is focused or hovered, then it shows a tooltip and has an accessible name.

**Edge cases**
- [ ] **AC5.** Given a charter with no workspace-needing job, when the card is shown, then no workspace question appears.
- [ ] **AC6.** Given a charter update (not a create), when the card is shown, then the jobs it adds and keeps are marked as item 16's card marks them.

**Error scenarios**
- [ ] **AC7.** Given a readiness check that could not run (kernel offline, connector unreadable), when the card is shown, then it says the check did not run and why, and never shows a ✓ it did not earn.

**Docs**
- [ ] **AC8.** Given `docs/DESIGN.md`, when it is read, then its "Approved artefacts" table has a row linking [`docs/design/mockups/charter-card.html`](design/mockups/charter-card.html) that records the approval as pending (the owner approves by merging the PR that adds it, D9), and a `## Charter card (phase 8 item 18a)` section states what the mockup commits items 18c and 18d to and lists open points for the owner; `bash scripts/check-docs.sh` prints `check-docs: OK`.

**Evidence rule:** every criterion is checkable from the committed HTML file and `docs/DESIGN.md` in the diff; none relies on the PR body.

## Design notes for the worker (grounded at base 73cba625)

- **Start from `docs/design/mockups/chat-threads.html`** (approved form of item 17a): copy its shell — the `<style>` token block (re-paste the verbatim stdout of `node app/scripts/tokens.mjs`; never hand-edit), window/sidebar, the review strip (`.review`, grouped view buttons), the `#view=<view>&theme=<light|dark|system>` URL-hash hook (`applyHash` / `writeHash` / `hashchange`), the `Kernel unreachable` band, the avatar renderer and the `I` icon object. One HTML file, no build, no external requests.
- **Item 16's card is the baseline:** reuse its `JOBS` catalogue shape (job → tools → purpose line), `jobHTML` "adds" badge, and the update card's **Adds · N job** / **Keeps · N jobs** blocks (AC6), so an update is marked exactly as item 16's card marks it.
- **The compact card hides every raw name** (`mcp__kernel__…`, JSON, `config/agents/*.json`, `memory/<agent>/role.md` paths) behind "Show full details" (AC2); the details hold the full enforced lines, the full settings file and the full `role.md` in scrolling blocks, each with its own copy icon, plus one copy icon for the whole card (AC3, Scope 6). Sample data must make the settings file and `role.md` long enough that the scroll is visible and nothing is truncated (the 4,000-character cut is the bug being designed away).
- **Readiness rows** reuse the sample charter of the item 16 Validation 2 walk: duties "Triage PR comments" and "Ask for a merge" uncovered (⚠ + **Add**), a workspace-needing job with no workspace (⚠ + fix). Never draw a ✓ in the "check did not run" state (AC7).
- **Workspace question:** saved-workspace picker filtered to a matching remote, **Choose folder…**, **Clone it for me** (marked held for approval), and the D31 refusal of a protected folder (`~/Documents`, `~/Desktop`, …) in plain words. A view with a charter that has no workspace-needing job shows no question (AC5).
- **Icons:** Lucide, 16px, 1.5px stroke, `currentColor` (`docs/design/brand-book.md` §Iconography). Every icon-only button gets `aria-label` and a visible tooltip on hover **and** focus (AC4). If no tooltip component or warning style fits, add it and record it in the `docs/DESIGN.md` section for approval (requirement Assumption).
- **Keyboard:** document the Tab order and shortcuts in the review strip's key line, as `chat-threads.html` does. Verify AC1/AC4 yourself with the installed headless Chromium (light and dark, Tab through every view) before hand-back.
- **Branding:** "Wright, powered by Claude" only as the palette attribution; nothing says or looks like Claude Code (invariant 7). No claude.ai sign-in (invariant 6).
- **Out of scope:** no app or kernel code; the Approvals screen layout is unchanged beyond the charter card; no plain-language refusals elsewhere; no evidence folder (the item's Touches name only the two files below).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Charter card mockup (states 1–8, light/dark) + DESIGN.md link and pending approval | all (AC1–AC8) | 1 modify, 1 create | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| design | `docs/DESIGN.md` (350) — appends one "Approved artefacts" row and one section; below the 500-line threshold, and the single home for mockup approvals | `docs/design/mockups/charter-card.html` — the one home for every new view (a separate concern from `chat-threads.html`, which stays unchanged) | HIGH |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every `docs/**/*.md` relative link, so the new DESIGN.md link must resolve; it also greps avatar `HUES` maps in `gui-v1.html` and design-system previews only (not the new file), so no other surface needs an update.

**Total estimated files:** 1 modify + 1 create

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/design/mockups/charter-card.html"}
  - {kind: "symbol", path: "docs/design/mockups/charter-card.html", name: "Show full details"}
  - {kind: "symbol", path: "docs/design/mockups/charter-card.html", name: "Copy all text"}
  - {kind: "symbol", path: "docs/design/mockups/charter-card.html", name: "Clone it for me"}
  - {kind: "symbol", path: "docs/design/mockups/charter-card.html", name: "Replaced by v2"}
  - {kind: "symbol", path: "docs/DESIGN.md", name: "Charter card (phase 8 item 18a)"}
requires: []
lanes:
  - "docs/design/mockups/charter-card.html"
  - "docs/DESIGN.md"
external_requires:
  - "node (to run app/scripts/tokens.mjs, read only)"
  - "a browser / the installed headless Chromium for the worker's own keyboard and light-dark walk"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md` (design-system components, WCAG 2.1 AA, keyboard and focus) |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/screens/chat/cards.tsx:146` | yes | HOLDS | `<pre className="chat-charter-display">{approval.display ?? ""}</pre>` | tip 43 minutes ago, fetched <1h |
| `kernel/src/approvals/store.ts:117` | yes | HOLDS | `export const MAX_APPROVAL_DISPLAY = 4_000;` | tip 43 minutes ago, fetched <1h |
| `kernel/src/approvals/store.ts:278` | yes | HOLDS | `if (typeof request.display === "string") requested.display = request.display.slice(0, MAX_APPROVAL_DISPLAY);` | tip 43 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): one file may exceed the 800-changed-line `context-bound` bound, and no split can divide a single file | MEDIUM | Start from `chat-threads.html`'s shell (token block, review strip, hash hook, avatar, icons) instead of writing it fresh; keep sample data compact; draw each state as a view in one `VIEWS` table as 17a did. |
| A compact card can hide something the owner should see (requirement Risks) | MEDIUM | Details are one click away, readiness rows always show, and the details omit nothing enforced; AC2/AC3 checked in both the compact and details views. |
| Prior churn (postmortem ledger): `docs/DESIGN.md` was touched by 8 earlier PRs with 11 churn rounds, recurring classes `self_heal_churn` (7) and `drain_churn` (4) | MEDIUM | Keep the DESIGN.md edit small and mirror the existing "Thread continuity" row and section wording; run `bash scripts/check-docs.sh` before hand-back so a broken relative link never reaches review. |
| Tooltips on icon-only controls appear on hover but not on keyboard focus, failing AC4 | MEDIUM | Show the tooltip on `:focus-visible` as well as `:hover`, give every icon button an `aria-label`, and Tab through every view in headless Chromium in light and dark. |
| The token block drifts from the generator | LOW | Re-paste `node app/scripts/tokens.mjs` stdout verbatim; add no raw colour value outside it. |
| Branding: an icon or label resembles Claude Code (invariant 7) | LOW | Lucide icons only, `currentColor`; "Wright, powered by Claude" only as the palette attribution. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-10-the-charter-card-mockup.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-11T03:30:14Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/256
- **Branch:** feature/the-charter-card-mockup
- **Files changed:** 2
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added docs/design/mockups/charter-card.html (28 views covering charter-card states 1–8 in light and dark) and the DESIGN.md row (approval pending) plus the "Charter card (phase 8 item 18a)" section. Phase 4.5 ran 3 reviews / 2 fix rounds: round 1 fixed focus falling to <body>, the toast Dismiss tooltip (AC4), duplicated blocks in Copy all text and 18b→18c drift; round 2 made Copy all text carry the header facts without control labels; round 3 PASS. 4 LOW findings dismissed. risk_classification high_risk=true (size + "token"/"secret" words in design-token and sample text; advisory). Drain not dispatched: .supervisor/config.json auto_review=false (the /automate parent owns the drain).

## Not verified
- **The owner's walk in a real desktop browser (requirement Validation 2)** — only headless Chromium was driven (subtask 1)
- **Screen-reader output for the card, tooltips and workspace question** — aria names and roles checked in the DOM; nothing run through VoiceOver (subtask 1)
- **The charter card on the Approvals screen** — the mockup draws the card in Chat only; Approvals reuses it per 18d (subtask 1)
