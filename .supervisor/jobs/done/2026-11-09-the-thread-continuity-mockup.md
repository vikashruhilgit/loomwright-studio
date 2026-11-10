# Supervisor Job: The thread continuity mockup — Reply, Summarize & start fresh, Copy reference (item 17a, D9 gate)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-09-144621/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-17/2026-11-09-160017-the-thread-continuity-mockup.md
- **Base commit:** c1261c68d93dfbfbf240c3182ad6313b97da5b63

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | A no-build HTML mockup, the same form as `docs/design/mockups/phase-8.html`, `gui-v2.html` and `integrations.html`. |
| 2 | Dependency Availability | GO | `node app/scripts/tokens.mjs` exists (120 lines); Playwright 1.64.1 is pinned in `app/package-lock.json` for screenshots, as the phase 8 mockup used. |
| 3 | Architecture Fit | GO | D9 (`docs/UI.md:3`): the mockup comes before any code. No `app/` or `kernel/` change. |
| 4 | Scope vs Supervisor Capability | CAUTION | Eight scope areas with every state in light and dark: the HTML alone is expected at 1,500–2,300 lines, past the 800-line `context-bound` bound. Split serially (one file, so no fan-out). |
| 5 | Hard Blockers | GO | None. Item 17b (the kernel fields) is not merged; the field map cites 17b's requirement by name (AC5), as the phase 8 mockup cited phase 8 requirements. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Add one clickable mockup, `docs/design/mockups/chat-threads.html`, of the new Chat and Crew thread controls (Reply, Summarize & start fresh with its ⓘ and preview, the size hint and its owner setting, Copy reference and its chip, session names, and item 16's plain-language charter card), every state in light and dark, with its evidence README and a `docs/DESIGN.md` row, so the owner can approve the design by merging the PR (D9).

**Problem Statement:**
The owner needs to see and approve how continuing, summarizing and referencing a conversation looks before items 17b and 17c are coded, because D9 says nothing is coded until the owner approves the mockup.
Currently every Chat message starts a fresh session with a one-message context (`docs/architecture/brain.md:230-258`; "nothing summarises the earlier conversation", `brain.md:314`), so in the phase 8 live run (2026-11-09, setup step 6) Wright lost its own crew proposal between two messages. The owner designed the fix in that session; no mockup shows its controls.
Success looks like a mockup the owner clicks through in both themes, a token block identical to the generator's output, every number in tokens, and a field map tying every number and label to a field item 17b names or "computed in the app".

**Design content (from the source requirement's Scope; each is a view or set of views):**
1. **Plain message vs reply.** The composer as today (a plain message is a new topic). Each agent message has **Reply**. Reply puts a strip above the composer, "Replying to: <first line of that message>", with **×** (and `Esc`) to cancel. A sent reply is drawn joined to the message it answers; a chain of replies reads as one thread.
2. **Summarize & start fresh**, beside Reply, with an **ⓘ**. The ⓘ panel shows this thread's numbers in tokens, never dollars (D24): messages so far, tokens read per reply now, and the estimate with a summary; it says a summary keeps exact values word for word and drops the back-and-forth.
3. **The summary preview.** Wright's summary with **Start fresh with this**, **Edit** and **Cancel**. The new thread starts with the summary at its top. The old thread stays readable, marked "Summarized: continued in <new thread>", and still offers Reply.
4. **The size hint.** Past a size the owner sets, Summarize is highlighted. The mockup shows where the owner sets it (a Settings field, gui-v2's Settings screen form) with Wright's proposed default shown as a proposal ("proposed by Wright"), never as fixed (invariant 1).
5. **Copy reference.** Each thread offers **Copy reference**. Pasted into any composer, Chat or Crew, it is a chip "📎 Thread: <title> (<n> messages)" with a toggle (full thread / its summary, when one exists), its size in tokens, and **×** to remove it.
6. **Session names.** Every thread, and its session card in Sessions and Tasks, shows a name for what it is doing (the owner's first line, a playbook's name, "From Wright: …"), never "ad hoc session" (today's fallback, `app/src/screens/tasks/model.ts:226`). A thread can be renamed in place.
7. **The charter approval card in plain language (item 16, AC3).** A held crew charter, create and update, lists its kernel tools grouped by job ("Hand tickets to /automate", "Triage PR comments", "Ask for a merge", "Read a PR"), each with its one-line purpose, ahead of the raw `mcp__kernel__…` names, which sit beneath behind a disclosure. It shows item 16's fit-check gap: "This playbook needs *Ask for a merge*; Sandbox Developer doesn't have it", with the held charter change beside it.
8. **States.** Empty thread; a long thread past the hint; a reply whose earlier session can't be continued ("Continuing from the saved conversation", the fallback); a referenced thread too large for the limit (refused, naming its size and the limit, nothing cut); the kernel unreachable (the shared band).

Both Chat (Wright's thread) and one Crew thread (D25) show items 1–3, 5, 6 and the relevant states: they share one thread component (`app/src/screens/chat/Thread.tsx`).

**Constraints (invariants and settled decisions):**
- **Owner decisions (2026-11-09) shown as drawn:** a plain message stays a new topic and a fresh session; Summarize sits beside Reply with an ⓘ; the old thread can still be continued after a summary; a thread can be attached as a reference instead of summarizing; every session has a task name; item 16's card is designed here; approval is by merging the PR.
- **Tokens, never dollars (D24):** no `$`, "USD" or "cost" figure anywhere.
- **Mechanism vs policy (invariant 1):** the size hint and the reference limit are owner settings with a "proposed by Wright" default, never a fixed number.
- **Branding (invariant 7):** "Wright, powered by Claude" only as the palette attribution; nothing says or looks like "Claude Code"; no claude.ai sign-in (invariant 6).
- **Untrusted input is data (invariant 3):** a referenced thread's text is drawn as quoted content, never as the owner's words.
- **No real employer data:** invented names and repos only (`vikashruhilgit/studio-sandbox` is allowed, it is the owner's sandbox); nothing names `vendsy/*`.
- **Reuse, not reinvent:** the window, review strip, URL-hash hook (`#view=<v>&theme=<light|dark>`, own-keys lookup, odd-hash fallback), `Kernel unreachable` band, palette and focus rules come from `phase-8.html` / `gui-v2.html`. Screens it does not draw stay in the sidebar and say they live in `gui-v1.html` / `gui-v2.html` / `phase-8.html`.

## Acceptance Criteria
- [ ] AC1 — Given `docs/design/mockups/chat-threads.html` opened from the file, when the review strip (or the URL hash `#view=<view>&theme=<light|dark>`) selects each view, then every view in Design content 1–8 renders and is reachable by clicking, in light and dark, in Chat and in one Crew thread where the item applies. The committed evidence file `docs/design/evidence/chat-threads-mockup/README.md` lists every view's light and dark screenshot (PNGs in that folder, each a relative link `bash scripts/check-docs.sh` resolves), the exact command that regenerates each, and a "What was driven by hand" record of the click paths between views. The PR body links to it.
- [ ] AC2 — Given the token block, then the text between `/* tokens:begin */` and `/* tokens:end */` equals `node app/scripts/tokens.mjs` stdout byte for byte, and generator names (`--radius-lg`, `--duration-base`, `--space-4`) are used, never gui-v1's short forms. The evidence README's "Token audit" holds the diff command (as `docs/evidence/phase-8-mockup/README.md` §"Token audit" writes it) and its empty result with `exit 0`, plus a table of every value outside the block, each marked "new — <justification>" or "review-harness chrome (not app UI)".
- [ ] AC3 — Given any number on screen about size or cost, then it is in tokens, never dollars (D24). The evidence README records `grep -nE '\$[0-9]|USD|dollar' docs/design/mockups/chat-threads.html` and accounts for every hit (expected: none), plus `grep -n "Claude Code"` and `grep -ni "claude.ai"` on the file, both empty (invariants 6, 7).
- [ ] AC4 — Given the Reply strip, the summary preview and the reference chip, when navigated by keyboard only, then each is reachable and dismissable: `Esc` cancels the Reply strip and returns focus to that message's Reply; the preview's Tab order is summary text → Start fresh with this → Edit → Cancel, and `Esc`/Cancel returns focus to Summarize; the chip's toggle and × are reachable by Tab and × returns focus to the composer. Text and controls meet WCAG AA contrast in both themes (4.5:1 text, 3:1 non-text). The evidence README's "What was driven by hand" records these key paths (headless Chromium) and the contrast pairs measured.
- [ ] AC5 — Given the evidence README's "Field map", then every number and label the mockup shows about a thread, a session, a summary, a reference or the charter card maps to a field item 17b's requirement names (`.supervisor/requirements/phase-8-17/2026-11-09-160018-thread-continuity-in-the-kernel.md`: the "continues" reference, the thread id, the `resumed` / `replayed` path, message count, tokens the latest reply read, the summary's estimated size, the size-hint owner setting, thread references, the session `title` and owner rename), to item 16's catalogue (job, purpose line, the fit-check gap), or to an existing column/route at the base commit, or is marked "computed in the app". A field with no source is removed or listed as an open point for the owner in DESIGN.md, never drawn as if it existed.
- [ ] AC6 — Given `docs/DESIGN.md`, then its approved-artefacts table gains a row for the thread continuity mockup (in the form of the phase 8 row: one HTML file, no build, token block verbatim from `node app/scripts/tokens.mjs`, pending the owner's merge, links to `design/mockups/chat-threads.html` and to the evidence README), and `bash scripts/check-docs.sh` prints `check-docs: OK`.
- [ ] AC7 (owner gate, not worker-satisfiable) — The owner walks every state in light and dark and approves by merging this PR (D9; Validation 2). Supervisor and `/review-pr` never merge it, and no worker writes a `Verdict: PASS for Validation 2` line: that verdict is the owner's.

**Evidence rule:** AC1–AC5 rest on the committed `docs/design/evidence/chat-threads-mockup/README.md`; FINALIZE's `## Evidence` section links it and its screenshot table. The PR body is never the evidence's only home.

## Scope widening
- docs/design/evidence/chat-threads-mockup/**
- accepted: LP-SCOPE 2026-11-09

## File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `docs/design/mockups/chat-threads.html` | CREATE | — | HIGH | The new mockup, self-contained like `phase-8.html` (1,623). Its own file: a separate concern, and every sibling mockup is past the 500-line threshold. Written by subtasks 1 and 2 in order. |
| `docs/DESIGN.md` | MODIFY | 275 | HIGH | One approved-artefacts table row; open points only if AC5 raises any. Below the threshold. |
| `docs/design/evidence/chat-threads-mockup/README.md` | CREATE | — | HIGH | Evidence for AC1–AC5, in the format of `docs/evidence/phase-8-mockup/README.md` (Screenshots, What was driven by hand, How to regenerate, Token audit, Checks, Field map). The path is the requirement's own (`## Touches`), not the older `docs/evidence/` folder. |
| `docs/design/evidence/chat-threads-mockup/*.png` | CREATE (~50–70) | — | MEDIUM | `chat-threads-<view>-<light\|dark>.png`. Generated binaries no worker reads. Count depends on the final view list. |

Reference only, not modified: `docs/design/mockups/phase-8.html` (shell, review strip, `VIEWS` registry, hash hook, unreachable band, focus rules), `docs/design/mockups/gui-v2.html` (Settings form, Tasks card), `docs/design/mockups/gui-v1.html` (Chat, Team, Sessions, the approval card), `docs/design/tokens.json`, `app/scripts/tokens.mjs`, `docs/design/brand-book.md`, `docs/design/design-system/components/*/`, `docs/evidence/phase-8-mockup/README.md` (evidence format), `app/src/screens/chat/Thread.tsx` (today's thread), `kernel/src/store/migrations/*.ts` (columns at base), `.supervisor/requirements/phase-8-17/2026-11-09-160018-thread-continuity-in-the-kernel.md` (17b's fields) and `.supervisor/requirements/phase-8-16/2026-11-09-160016-wright-drafts-charters-that-cover-the-work.md` (item 16's catalogue and card).

Validator-owned surfaces: `scripts/check-docs.sh` scans every `*.md` under `docs/` for relative links (the README's PNG links and DESIGN.md's new links must resolve). Its avatar-hue rules do not scan `chat-threads.html`; any avatar drawn in it still uses `crew-*` hues (or `accent` for Wright), never a semantic token (rule 4's intent).

**Total estimated files:** 1 modify + 2 create (+ PNG outputs)

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | chat-threads.html skeleton and Chat thread controls | AC1 (Design content 1, 2, 3, 5 and the states in 8, in Chat), AC2, AC3, AC4 | 0 modify, 1 create | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |
| 2 | Crew thread, size-hint setting, session names, charter approval card | AC1 (Crew thread for 1–3 and 5; Design content 4, 6, 7), AC3, AC4 | 1 modify (chat-threads.html from #1) | `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |
| 3 | Evidence README, screenshots, field map and DESIGN.md row | AC1 evidence, AC2–AC4 evidence, AC5, AC6 | 1 modify, 1 create (+PNG outputs) | `skills/frontend-ui/SKILL.md` | BLOCKED (by #2) |

Subtask 1 owns the file's skeleton: the token block, the shell (sidebar with Chat, Team, Sessions, Tasks, Approvals and Settings reachable), the review strip with one group per area, the URL-hash hook, the shared `Kernel unreachable` band, the palette and the theme switch, and the Chat views. Subtask 2 adds its views into that skeleton (new view keys and review-strip groups) without changing subtask 1's views. Subtask 3 changes no HTML except to fix a defect it finds while taking screenshots, and records any such fix in the README.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/design/mockups/chat-threads.html"}
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "tokens:begin"}
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Kernel unreachable"}
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Replying to:"}
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Start fresh with this"}
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Copy reference"}
requires: []
lanes:
  - "docs/design/mockups/chat-threads.html"
external_requires:
  - "Node.js (runs app/scripts/tokens.mjs)"

# Subtask 2
provides:
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "proposed by Wright"}
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Ask for a merge"}
  - {kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Continuing from the saved conversation"}
requires:
  - {from: "1", kind: "file", path: "docs/design/mockups/chat-threads.html"}
  - {from: "1", kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "tokens:begin"}
lanes:
  - "docs/design/mockups/chat-threads.html"
external_requires: []

# Subtask 3
provides:
  - {kind: "file", path: "docs/design/evidence/chat-threads-mockup/README.md"}
  - {kind: "symbol", path: "docs/design/evidence/chat-threads-mockup/README.md", name: "Field map"}
  - {kind: "symbol", path: "docs/DESIGN.md", name: "chat-threads.html"}
requires:
  - {from: "1", kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Copy reference"}
  - {from: "2", kind: "symbol", path: "docs/design/mockups/chat-threads.html", name: "Ask for a merge"}
lanes:
  - "docs/DESIGN.md"
  - "docs/design/evidence/chat-threads-mockup/**"
  - "docs/design/mockups/chat-threads.html"
external_requires:
  - "A headless Chromium for screenshots: `cd app && npm ci && npx playwright install chromium`, then from `app/` `npx playwright screenshot --color-scheme=<light|dark> --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/chat-threads.html#view=<v>&theme=<t>' <out>.png` (`<repo>` the absolute checkout path, never written into the README literally)"
```

Subtask 2 places the "Continuing from the saved conversation" fallback state in the Crew thread (subtask 1 may also draw it in Chat). The view keys are each subtask's choice, listed in the evidence README.

## Parallelism Analysis

Serialized: 1 → 2 → 3. Subtasks 1 and 2 write the same file; subtask 3's screenshots need every view. No fan-out.

### Batch Plan
- **Batch 1:** subtask 1
- **Batch 2:** subtask 2
- **Batch 3:** subtask 3
- **Recommended workers:** 1 at a time
- **Estimated batches:** 3

## Skill References

| Subtask | Skills |
|---------|--------|
| 1, 2 | `skills/frontend-ui/SKILL.md` (design-system reuse, WCAG 2.1 AA, keyboard reachability, focus return) |
| 3 | `skills/frontend-ui/SKILL.md` (contrast checks in both themes while reviewing screenshots) |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `docs/architecture/brain.md:230-258` | yes | HOLDS | `Each message builds one prompt string, fresh, in this order:` … `5. The message.` | tip 3 hours ago, fetched <1h |
| `brain.md:314` | yes (suffix → `docs/architecture/brain.md`) | HOLDS | `A resumed session gets the current memory again as its prompt; nothing summarises the earlier conversation.` | tip 3 hours ago, fetched <1h |
| `docs/UI.md:3` | yes | HOLDS | `Design comes first: nothing is coded until the owner approves the mockups.` | tip 3 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Source | Mitigation |
|------|--------|--------|------------|
| Size: eight areas with every state, in Chat and Crew, is past one worker's context | HIGH | Feasibility (Phase 2.5) | Two serialized HTML subtasks on a skeleton subtask 1 owns; reuse phase-8.html's shell, review strip and hash hook rather than writing new ones. |
| Drawing numbers the kernel will not have; item 17b is not merged | MEDIUM | Analysis | AC5's field map ties every number and label to a 17b field, item 16's catalogue, a column at base, or "computed in the app"; anything else is removed or an owner open point. |
| A size hint or reference limit drawn as a fixed number (invariant 1; the requirement's own risk) | MEDIUM | Analysis | Both are owner settings showing "proposed by Wright"; the unset state shows no highlight. |
| A dollar figure slips in (D24) | MEDIUM | Analysis | AC3's grep, recorded with every hit accounted for. |
| A referenced thread's text reads as the owner's words (invariant 3) | MEDIUM | Analysis | The chip and the preview draw referenced text as quoted content with its source. |
| Prior churn on sibling mockups (`phase-8.html` took 2 self-heal rounds: a keyboard shortcut acting on a hidden card, a forced-view state leak) | MEDIUM | Analysis (`.supervisor/jobs/done/2026-11-02-the-phase-8-mockup.md` §Outcome) | `setView` resets all transient state (reply strip, preview, chip, ⓘ panel); keys act only on the visible view; focus returns to the opener on every close. |
| The evidence folder differs from the older convention (`docs/evidence/<name>/`) | LOW | Analysis | Follow the requirement's `## Touches` (`docs/design/evidence/chat-threads-mockup/`); DESIGN.md links it relatively as `design/evidence/chat-threads-mockup/README.md`, which check-docs resolves. |
| Merging without the owner's approval (D9) | HIGH | Analysis | AC7 is an owner gate. Never auto-merge. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound
- **Threshold note:** the hand-written HTML is about 1,500–2,300 lines (past the 800-line bound). Both halves write one file (`file-conflict` would serialize them anyway), so the split is serial. The PNGs are generated binaries no worker reads.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-09-the-thread-continuity-mockup.md
```

## Plan Review: PASS (attempt 1/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | LOW | File Impact Map | `docs/design/evidence/` does not exist yet; the path is the source requirement's own `## Touches`, recorded in Risk Assessment, and check-docs will resolve DESIGN.md's link | warning (below the MEDIUM fix floor; subtask 3 creates the folder) |

Requirement fit: fulfils. Reviewer note (not an issue): `phase-8.html` already has a "proposed by Wright" badge helper, so subtask 2's `proposed by Wright` provides may already be satisfied by subtask 1's copied shell; subtask 2 must still draw the size-hint setting itself.

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-09T16:58:15Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/249
- **Branch:** feature/the-thread-continuity-mockup
- **Files changed:** 101 (HTML mockup, evidence README, DESIGN.md, 98 PNGs)
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Built docs/design/mockups/chat-threads.html, with 49 views in light and dark in Chat and one Crew thread, plus the evidence README (98 screenshots, token audit, keyboard paths, contrast and field map) and the DESIGN.md row with 7 owner open points. Three subtasks ran in sequence and each passed its deterministic gate. Phase 4.5 review: round 1 FAIL (2 HIGH, 2 MEDIUM, fixed in 46dc19d); rounds 2 and 3 were reviewer PASS, each with 1 MEDIUM at the floor (fixed in e9a570f and 9c45386). The round-3 fix was not re-reviewed because of the iteration cap. That is why the run is ESCALATED; the escalation comment is on the PR. 4 LOW findings were dismissed below the floor. AC7 is the owner's gate: approve by merging.

## Not verified
- **screen-reader output of the Reply strip, preview dialog and chip** — no screen reader was run; only the ARIA markup was checked (subtask 1)
- **screen-reader announcements of the new live-region messages** — no screen reader was run, only headless Chromium (subtask 2)
- **evidence screenshots of the 27 new views** — subtask 3 takes them (subtask 2)
- **visual rendering of 80 of 90 PNGs** — 10 were looked at by eye; contrast was measured in code for all 90 (subtask 3)
