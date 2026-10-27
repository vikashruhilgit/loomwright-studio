# Supervisor Job: The Integrations screen mockup (phase 6, item 02, D9 gate)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-27-053225/L2
- **CLAUDE.md:** ✓ Found (fresh — every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095102-the-integrations-screen-mockup.md
- **Base commit:** 90636f79094bfc9cd66238b3d4d8076b0fef5f06

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | A static, self-contained HTML mockup in `docs/design/mockups/`, the same form as the approved `gui-v1.html` (one file, inline `<style>`/`<script>`, no build, no `<link>`/`<script src>`). |
| 2 | Dependency Availability | GO | Token source `docs/design/tokens.json` and its generator `app/scripts/tokens.mjs` exist; `node app/scripts/tokens.mjs` prints the CSS custom properties (195 lines) and is byte-identical to the checked-in `app/src/styles/tokens.css`. Screenshots need a headless browser: Playwright is an `app/` devDependency (`app/e2e/`). |
| 3 | Architecture Fit | GO | D9 (mockup before screen code) and DESIGN.md's phase 5 precedent ("What the mockups commit phase 5 to"). Docs only; no app or kernel code (non-goal). |
| 4 | Scope vs Supervisor Capability | GO | Single subtask: one new HTML file, one 39-line doc edit, one evidence folder. See Configuration for the threshold note. |
| 5 | Hard Blockers | GO | The requirement's sequencing precondition (phase 5 live exit passed) now holds: `docs/OPEN_QUESTIONS.md` line 112 is ticked `[x]` with `docs/evidence/phase-5-exit-live-2026-10-25.json`. No sibling phase 6 item touches `docs/DESIGN.md` or `docs/design/` (item 01 touches `docs/UI.md`, not this item's files). |

**Overall Verdict:** GO

## Task
**Goal:** Add a hi-fi, clickable Integrations screen mockup (`docs/design/mockups/integrations.html`) with its Connect GitHub sheet, every designed state in light and dark, and its keyboard map, and record in `docs/DESIGN.md` what it commits item 11 to, so the owner can approve the design on this PR before any screen code (D9).

**Problem Statement:**
The owner needs an approved Integrations screen design because D9 forbids coding a screen before its mockup is approved, and phase 6 (item 11) builds that screen.
Currently, `docs/DESIGN.md` lists "the Integrations screen (connect a tool)" under "Not in v1 (deferred to GUI v2 or later)" and `docs/design/mockups/gui-v1.html` has no Integrations screen. This blocks item 11.
Success looks like a merged PR (the owner's approval, D9) carrying `integrations.html`, an updated DESIGN.md, and committed screenshots of every state in both themes.

### Design content (binding, from the requirement's Scope and Owner decisions)
- **The screen:** a list pane of connectors, with only GitHub in phase 6, plus a quiet "more connectors later" footer and no fake entries. A detail pane shows a status dot, the account login, permissions (each read-only permission listed), expiry with days left, the reachable repos, which agents hold the grant (`connectors: ["github"]`), and Disconnect.
- **The Connect GitHub sheet:** says what token to create (fine-grained, read-only, limited to chosen personal repos). It has a link-out label for GitHub's token page, a secure (masked) field, Connect, and the inline refusal for a write-scoped token naming the permission to drop. Copy states that the token is kept in the Keychain and never shown again. There is no OAuth button and no "use gh login" option (owner decision: Studio never runs an OAuth flow and never reuses the `gh` login).
- **States (the review strip forces each):** not connected (the designed empty state), connecting, connected, token rejected (two variants: invalid token; write-scoped token), expiring (≤ 14 days, a design proposal the owner can change), expired, and kernel unreachable (the shared band, same as gui-v1's `Kernel unreachable` toggle).
- **Keyboard map:** `⌘5` opens the screen (with `⌃5` in a browser tab, as gui-v1 does for `⌘1–4`). Palette (`⌘K`) commands are Connect GitHub, Disconnect GitHub and Show reachable repos, each reachable without the mouse.
- **Components:** reuse List, Card, Badge, StatusDot, Dialog and Input (`docs/design/design-system/components/`). Add no new components.
- **Branding (invariant 7):** "Wright, powered by Claude" is allowed. Nothing says or looks like "Claude Code". GitHub's name and mark appear only as the connector's label, with no GitHub brand colours or styling on the screen.
- **Mockup state hook (for reproducible screenshots):** besides the review strip, the page reads its forced view and theme from the URL hash (e.g. `#view=connected&theme=dark`), so each screenshot is one headless-browser command against `file://…/integrations.html#…`, with no committed script.

## Acceptance Criteria
- [ ] AC1 — Given `docs/design/mockups/integrations.html` opened in a browser, when the review strip (or the URL hash) selects each view, then all nine views render in light and dark: not connected, connecting, connected, token rejected (invalid), token rejected (write-scoped), expiring, expired, kernel unreachable, and the Connect GitHub sheet. A committed evidence file `docs/evidence/phase-6-integrations-mockup/README.md` lists every view's light and dark screenshot (18 PNGs in that folder, each a relative link that `bash scripts/check-docs.sh` resolves) and the exact command that regenerates each one, and the PR body links to it.
- [ ] AC2 — Given the mockup, then every colour, spacing, radius, shadow, duration, easing and type value comes from `tokens.json` under the generator's names. The mockup's token block is the verbatim stdout of `node app/scripts/tokens.mjs`, pasted between `/* tokens:begin */` and `/* tokens:end */` comments. Generator names (`--radius-lg`, `--duration-base`, `--ease-standard`, `--space-4`, `--type-body-size`) are used, never gui-v1's short forms (`--r-lg`, `--d-base`, `--ease`). Then the committed evidence file `docs/evidence/phase-6-integrations-mockup/README.md` contains (a) the command that diffs that block against `node app/scripts/tokens.mjs` and its empty result, and (b) a table naming every value outside the block, each marked either "new — <justification>" or "review-harness chrome (not app UI)" for the desk and review strip copied from gui-v1. The PR body links to it.
- [ ] AC3 — Given the write-scoped refusal view, then the inline refusal in the Connect sheet names the exact permission to drop, in the form "Pull requests: Read and write → set to Read-only", and Connect stays unavailable until the token changes.
- [ ] AC4 — Given `docs/DESIGN.md`, then the "Not in v1" list no longer names the Integrations screen, and a new "Phase 6: Integrations" section names `design/mockups/integrations.html`. It lists what the mockup commits item 11 to, in the form of the existing "What the mockups commit phase 5 to" section, and records that the Integrations screen moved from GUI v2 to phase 6 by the owner's 2026-10-24 decision. The "Approved artefacts" table gains a row for the Integrations mockup. `bash scripts/check-docs.sh` prints `check-docs: OK`.
- [ ] AC5 — Given the mockup's markup and copy, then no string reads "Claude Code", no GitHub brand colour (for example `#24292f` or `#2da44e`) appears, and the GitHub name and mark appear only as the connector's label.
- [ ] AC6 (owner gate, not worker-satisfiable) — The owner approves the PR, which is the D9 gate. Supervisor and `/review-pr` never merge it. The evidence is the owner's GitHub approval and merge, not the PR body.

**Evidence rule:** AC1 and AC2 rest on the committed `docs/evidence/phase-6-integrations-mockup/README.md`. FINALIZE lists it in the PR body's `## Evidence` section and may embed the screenshots, but the PR body is never their only home.

## File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `docs/design/mockups/integrations.html` | CREATE | — | HIGH | The new mockup, self-contained like `gui-v1.html` (964 lines). It is a separate concern, so it is its own file rather than appended to gui-v1 (already past the 500-line threshold). Expected size is about 600–900 lines. |
| `docs/DESIGN.md` | MODIFY | 39 | HIGH | New "Phase 6: Integrations" section, an "Approved artefacts" row, and the deferral-list edit. |
| `docs/evidence/phase-6-integrations-mockup/README.md` | CREATE | — | HIGH | The evidence file for AC1 and AC2, in the format of `docs/evidence/phase-5-polish/chat/README.md` (a screenshots table, then "How to regenerate"). |
| `docs/evidence/phase-6-integrations-mockup/*.png` | CREATE (18) | — | HIGH | `integrations-<view>-<light\|dark>.png`. These are binary outputs and are never read into a worker's context. |

Reference only, not modified: `docs/design/mockups/gui-v1.html` (the idioms to copy are the review strip `.review`, `tg-offline` "Kernel unreachable", the palette builder, `⌘1–4`/`⌃1–4` handling, and the theme `seg`), `docs/design/tokens.json`, `app/scripts/tokens.mjs`, `docs/design/brand-book.md`, and `docs/design/design-system/components/{List,Card,Badge,StatusDot,Dialog,Input}/`.

Validator-owned surfaces: `scripts/check-docs.sh` scans every `*.md` under `docs/` for relative links (so the evidence README's PNG links must resolve). Its avatar-hue rule names only `gui-v1.html`, `avatar.js` and component previews, so it does not scan `integrations.html`. If the mockup draws agent avatars for "agents holding the grant", identity hues must still be `crew-*` (or `accent` for Wright), never a semantic token (rule 4's intent).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Integrations mockup, DESIGN.md section, and screenshot evidence | all | 1 modify, 2 create (+18 PNG outputs) | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/design/mockups/integrations.html"}
  - {kind: "symbol", path: "docs/design/mockups/integrations.html", name: "tokens:begin"}
  - {kind: "symbol", path: "docs/design/mockups/integrations.html", name: "Connect GitHub"}
  - {kind: "symbol", path: "docs/DESIGN.md", name: "Phase 6: Integrations"}
  - {kind: "file", path: "docs/evidence/phase-6-integrations-mockup/README.md"}
requires: []
lanes:
  - "docs/design/mockups/integrations.html"
  - "docs/DESIGN.md"
  - "docs/evidence/phase-6-integrations-mockup/**"
external_requires:
  - "Node.js (runs app/scripts/tokens.mjs)"
  - "A headless Chromium for screenshots, e.g. `cd app && npm ci && npx playwright install chromium`, then `npx playwright screenshot --color-scheme=<light|dark> --viewport-size=<w,h> 'file://<abs>/docs/design/mockups/integrations.html#view=<v>&theme=<t>' <out>.png`"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md` (design-system reuse, WCAG 2.1 AA, keyboard reachability) |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `docs/DESIGN.md:39` | yes | HOLDS | `Field-level playbook editing, the Integrations screen (connect a tool), memory file viewing, …` | tip 2 days ago, fetched <1h |
| `docs/OPEN_QUESTIONS.md:112` | yes | STALE | `- [x] **Phase 5 exit: live run (item 18, owner).**` (the requirement said "unticked"; it is now ticked, which means the sequencing precondition is met) | tip 2 days ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Inventing new components or tokens (requirement Risk) | MEDIUM | Build only from List, Card, Badge, StatusDot, Dialog and Input. Any value outside the generated token block goes in the AC2 table with a justification, or it is removed. |
| Copying gui-v1's token block verbatim, which uses short names (`--r-lg`, `--d-base`, `--ease`) and adds non-token chrome (`--desk`, `--menubar`, `--pill-ink`, `--win-shadow`). That fails AC2's "generator's names" check. | MEDIUM | Paste `node app/scripts/tokens.mjs` stdout as the token block. Keep any desk or review-strip chrome in a separate, labelled harness block, listed in the AC2 table. |
| Cited-line premise (Phase 3): `docs/OPEN_QUESTIONS.md:112` no longer holds "unticked". Phase 5's live exit passed on 2026-10-25. | MEDIUM | Informational only. The requirement's "run phase 6 only after that live run passes" precondition is now met, so nothing to do. |
| Screenshot tooling: no Playwright Chromium may be installed on the host (phase 5 evidence used Electron). | LOW | `npx playwright install chromium` inside `app/`. The mockup's URL-hash state hook makes each shot one CLI command, recorded in the README. Nothing is added to `app/`. |
| Branding slip: GitHub styling or a "Claude Code" look (invariant 7). | MEDIUM | AC5 is grep-checkable. Use the neutral app palette, and show the GitHub mark only beside its label. |
| Scope creep into app code (item 11) or `docs/UI.md` (owned by item 01). | LOW | Lanes are limited to the mockup, DESIGN.md and the evidence folder. |
| Merging without the owner's approval (D9). | HIGH | AC6 is an owner gate. Never auto-merge; leave the PR for the owner's review. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main
- **Threshold note:** `context-bound` does not fire in substance. The 18 PNGs are generated binaries that no worker reads, so the hand-written change is 3 files (about 700–1,000 lines, nearly all in one new HTML file). That file cannot be split across workers, and splitting it into a second subtask would only serialize on the same files.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-27-integrations-screen-mockup.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-27T08:19:09Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/143
- **Branch:** feature/integrations-screen-mockup
- **Files changed:** 21
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Added the Integrations screen mockup (docs/design/mockups/integrations.html: nine views × light/dark via the review strip or URL hash, token block verbatim from the generator, inline write-scoped refusal, no "Claude Code" or GitHub colours), the DESIGN.md "Phase 6: Integrations" section, artefacts row and deferral edit, and the evidence README with 18 PNGs. Phase 4.5: review 1 FAIL (1 HIGH focus-restore defect + 4 MEDIUM) → fix 4a48380; review 2 PASS but 1 MEDIUM at the floor (introduced by the fix) → fix 8fc8f99; review 3 PASS, 0 issues. 4 findings dismissed (3 LOW below the floor, 1 MEDIUM pre-existing design-system contrast gap). Awaiting the owner's approval and merge (D9, AC6).

## Not verified
- **Disconnect confirm dialog and the palette** — outside AC1's 9 forced views, so no committed screenshot; only a scratch headless script drove them (subtask 1)
- **GitHub token page behind the link-out** — URL returns 302 to the GitHub login page with return_to; the signed-in page was not observed (subtask 1)
