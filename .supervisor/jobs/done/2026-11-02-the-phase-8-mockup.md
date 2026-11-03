# Supervisor Job: The phase 8 mockup (phase 8, item 02, D9 gate)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L2
- **CLAUDE.md:** ✓ Found (fresh: every path in its "Where things are" table exists, which `bash scripts/check-docs.sh` enforces. Its "The next step is phase 1" line is stale; phase 8 item 01 fixes it, not this item)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (phase 8 item 01, the foundation contract that declares migration 020's tables and D38–D40, runs in a parallel lane and is not merged at the base commit; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160002-the-phase-8-mockup.md
- **Base commit:** a0db691c37f6d9c4a1af60266987c6d1d33585ec

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | A static, self-contained HTML mockup in `docs/design/mockups/`, the same form as the approved `gui-v1.html` (991 lines), `integrations.html` (919) and `gui-v2.html` (1,580): one file, inline `<style>`/`<script>`, no build, no `<link>`/`<script src>`. |
| 2 | Dependency Availability | GO | `app/scripts/tokens.mjs` prints 195 lines from `docs/design/tokens.json`. Screenshots use the Playwright CLI that `app/package.json` pins (`@playwright/test` `^1.64.1`), as `docs/evidence/gui-v2-mockup/README.md` §"How to regenerate" does. |
| 3 | Architecture Fit | CAUTION | D9 and the phase 0/6/7 precedent fit. But the data the new views show (repo policy, PR tracks, MCP connections, the `write` grant, `mode: live`) has no kernel column at the base commit: it is declared by phase 8 item 01's requirement (Scope §3 and §5: `repo_policies`, `pr_tracks`, `mcp_connections`, `CONNECTOR_KINDS` gains `jira` and `clickup`), which is not merged. The field map (AC6) ties each field to that declaration or lists it as an open point. |
| 4 | Scope vs Supervisor Capability | CAUTION | Seven view groups (Tasks card, Jira connect, ClickUp connect, App upgrade, repo policy card, merge approval card, playbook mode editor), each with empty, loading, error and unreachable plus its own states: about 40 views and 1,600–2,400 hand-written lines. That is past `context-bound` (> 800 changed lines), so the HTML is built in two serialized subtasks, then DESIGN.md and the evidence in a third. |
| 5 | Hard Blockers | GO | No sibling phase 8 item touches `docs/DESIGN.md`, `docs/design/` or `docs/evidence/phase-8-mockup/` (checked every `## Touches` under `.supervisor/requirements/phase-8/`). Items 11, 12 and 13 depend on this one. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Add one clickable mockup, `docs/design/mockups/phase-8.html`, of every new phase 8 view (the Tasks card for a ticket → PR task, Jira and ClickUp connect over MCP + OAuth, the GitHub App permission upgrade, the repo policy card, the "Approve in Studio" merge card and the playbook `mode` editor), every state in light and dark, and record in `docs/DESIGN.md` what it commits items 11–13 to, so the owner approves the design on this PR before any phase 8 screen code (D9).

**Problem Statement:**
The owner needs one approved phase 8 design because D9 forbids coding a screen before its mockup is approved, and items 11, 12 and 13 build these views.
Currently no mockup shows them: UI.md's Tasks card ("1/2 approvals · CI green · waiting on Mason") was deferred from phase 7 (`docs/DESIGN.md:137`, "Linked PRs and tickets, approvals counts and CI state join in phase 8"), and Integrations has no Jira, ClickUp or MCP connect flow, no App permission upgrade and no repo policy.
Success looks like a merged PR (the owner's approval, D9) carrying `phase-8.html`, a DESIGN.md "Phase 8" section, and committed screenshots of every view in both themes.

### Owner decisions (2026-11-02, binding, from the requirement)
- **Tickets come from GitHub Issues, Jira and ClickUp**, each its own optional connector on Integrations (invariant 5, D12).
- **Jira and ClickUp connect as MCP connectors:** Studio is an MCP client to the vendor's hosted server (Atlassian Rovo MCP `https://mcp.atlassian.com/v1/mcp`, ClickUp `https://mcp.clickup.com/mcp`), runs OAuth 2.1 consent in the system browser, keeps tokens in the Keychain, and lists to each agent only the tools the owner grants. It is not a claude.ai sign-in (invariant 6).
- **Jira is the owner's work (Tray) account, "stub only":** never exercised live. The mockup carries that note. **ClickUp is personal.**
- **The GitHub App is raised to every repository permission at write** (supersedes D36's "Read-only still" for the App only; the token path stays read-only). The owner re-approves on github.com. **Session tokens are down-scoped** to Pull requests, Contents, Issues and Checks.
- **Merge approvals are the user's policy, per repo:** Solo, Approve in Studio, or N GitHub reviews (Wright suggests 2 for a team repo). A playbook may only be stricter. A repo with no policy never merges (its PRs park). The kernel ships no number (invariant 1).
- **Repo policy is detect + propose, one click.** Studio reads branch protection, required reviews and checks and who can push, and proposes a card the owner accepts or changes. Studio never changes GitHub's branch protection; when it is missing, the card shows what to set and a link.
- **A repo GitHub can't protect** (private on Free): the card says so and offers making it public or upgrading, "Trust this repo unprotected" (explicit, recorded, passed to Loomwright as `--trust-unprotected`) and Safe mode. None is picked silently.
- **Merging is Loomwright's gate.** The kernel never merges and `gh pr merge` stays blocked (invariant 4). The "Approve in Studio" card approves; Loomwright's `--auto-merge` gate merges.
- **Who owns a PR:** a live `/automate` run, a parked `/automate` item, the owner or the App, or someone else.
- **Live writes:** each outward kind is held the first time; the owner may grant "Always for this playbook" per kind; `never` still wins. A playbook goes `live` only after its dry run and a held enable.
- **One phase 8 mockup first (D9).** The owner approves it by merging its PR, and every UI item depends on it.
- **Nothing is patched outside this item's Touches** (`docs/design/mockups/phase-8.html`, `docs/DESIGN.md`, `docs/evidence/phase-8-mockup/`). A subtask that needs another file stops and says so.

### Design content (binding, from the requirement's Scope)
- **Shell:** reuse `gui-v2.html`'s window, review strip (`.review`, `docs/design/mockups/gui-v2.html:554`), shared `Kernel unreachable` band, and URL-hash state hook (`#view=<view>&theme=<light|dark|system>`, the own-keys-only lookup at `gui-v2.html:892` and the fallback to the default view on an odd hash at `gui-v2.html:903`). The review strip has one group per view group below.
- **Tasks card and history (ticket → PR task):** ticket source and id; PR number and state (open / draft / ready / parked / merged / closed); approvals `n/N` from the repo policy, or "Solo", or "Approve in Studio"; CI state; the comment-triage tally (fix / reply / answer); who owns the PR (an `/automate` run, a parked item, the owner or the App, someone else). States: empty, loading, error, waiting on you, kernel unreachable, plus the card's history click-through.
- **Integrations, Jira and ClickUp connect (MCP + OAuth):** Connect, the browser-consent wait, connected (site or workspace, granted tools), expired, refused and Disconnect (confirms). Jira carries a note that it is the owner's work account and is never exercised live.
- **Integrations, GitHub App permission upgrade:** the current read-only App shows "Needs new permissions" with a button that opens github.com to accept them; the view states that session tokens are down-scoped (Pull requests, Contents, Issues, Checks).
- **Integrations, repo policy card:** detected state (protection, required reviews and checks, who can push); the proposal; the three presets (Solo / Approve in Studio / N GitHub reviews) and Accept; "GitHub can't enforce protection on this repo (private on Free)" with Make public, Trust unprotected and Safe mode; "No policy: PRs park".
- **Approvals, the "Approve in Studio" merge card:** repo, PR, head SHA, CI, Loomwright's READY. Approving never merges in the kernel.
- **Playbook policy editor:** `mode` editable as draft / live (phase 7's `gui-v2.html:1057` shows `live` disabled, "not available yet"; phase 8 lifts it). Turning `live` on goes through its dry run and a held enable.
- **Downstream consumers (items 11–13 build "as `phase-8.html` draws them", so the mockup draws these too):**
  - Item 12 (`2026-11-02-160012-…md` Scope 1–4): the consent wait has Cancel; connected shows the server's tools and which crew member is granted which (the grant is set in Team); the policy card shows when detection was read, has Re-detect, and "N GitHub reviews" with an editable N; the can't-enforce state's Make public / Upgrade is a link to GitHub; Trust unprotected opens a confirm dialog naming what it waives (condition 4 only, never the high-risk park); palette commands `integrations.connect-jira`, `integrations.connect-clickup`, `integrations.repo-policy`.
  - Item 13 (`2026-11-02-160013-…md` Scope 1–2): the merge card shows the repo's policy beside repo, PR link, short head SHA, CI and Loomwright's READY time, and offers Allow once / Deny with no "Always for this playbook"; turning `mode` to live opens a confirm saying live acts on GitHub through the approval gate; Chat's draft card keeps `mode` read-only.
  - Item 11 (`2026-11-02-160011-…md` Scope 1–2): "waiting on you" when an approval or an `awaiting_merge` park needs the owner, linked to that approval; nothing green while CI is pending (honest status); history rows for `pr_state_changed`, the PR's sessions (`/automate`, fix and merge-item runs), its approvals and its comments' routes.
  - Where the mockup deliberately differs from one of these, DESIGN.md's Phase 8 open points name the difference and the item it affects.
- **Every view group has an empty, a loading, an error and a `Kernel unreachable` view,** forced by the review strip and the URL hash. The error view is a route failure inside the body, distinct from the band. Where "empty" has a group-specific meaning (not connected, no repos used yet, no pending merge approvals), the evidence README says what it is.
- **Branding (invariants 6, 7):** "Wright, powered by Claude" only as the palette attribution. Nothing says or looks like "Claude Code". The OAuth consent copy names the vendor (Atlassian, ClickUp), never claude.ai. Vendor and GitHub names and marks appear only as connector labels in `ink`, as `integrations.html` does.
- **No real employer data:** the Jira site, project keys, people and tickets are invented (e.g. `example.atlassian.net`); nothing names `vendsy/*` or a real Tray system.

## Acceptance Criteria
- [ ] AC1 — Given `docs/design/mockups/phase-8.html` opened in a browser, when the review strip (or the URL hash `#view=<view>&theme=<light|dark>`) selects each view, then every view in the Design content above renders in light and dark: for each of the seven view groups (Tasks card, Jira connect, ClickUp connect, App upgrade, repo policy card, merge approval card, playbook mode editor) its empty, loading, error and kernel-unreachable views plus its own states (Tasks waiting-on-you linked to its approval, and history with the rows listed under Downstream consumers; each connector's consent wait with Cancel, connected with granted tools per crew member, expired, refused and Disconnect confirm; the App's "Needs new permissions"; the repo policy proposal with its read time and Re-detect, the presets with an editable N, can't-enforce with the Make public / Upgrade link and the Trust unprotected confirm, and no-policy; the merge card with Allow once / Deny and its repo policy; `mode` draft, the live-enable confirm, and Chat's read-only draft card), and each Downstream consumers element above is drawn or named as a deliberate difference in DESIGN.md's open points. The committed evidence file `docs/evidence/phase-8-mockup/README.md` lists every view's light and dark screenshot (PNGs in that folder, each a relative link that `bash scripts/check-docs.sh` resolves), the exact command that regenerates each one, and what "empty" means for each group. The PR body links to it.
- [ ] AC2 — Given the token block, then it equals `node app/scripts/tokens.mjs` output byte for byte: the block between `/* tokens:begin */` and `/* tokens:end */` is that stdout verbatim, and generator names (`--radius-lg`, `--duration-base`, `--space-4`) are used, never gui-v1's short forms. The evidence README contains (a) the command that diffs that block against `node app/scripts/tokens.mjs` and its empty result, and (b) a table naming every value outside the block, each marked "new — <justification>" or "review-harness chrome (not app UI)", and every new component or variant, each named and justified.
- [ ] AC3 — Given the mockup, then nothing says or looks like "Claude Code", no control offers a claude.ai sign-in, and the only OAuth flows are the Jira and ClickUp vendor consents (invariants 6, 7). `grep -n "Claude Code" docs/design/mockups/phase-8.html` and `grep -ni "claude.ai" docs/design/mockups/phase-8.html` print nothing; `grep -n "vendsy" docs/design/mockups/phase-8.html` prints nothing; the evidence README records all three commands and their empty output.
- [ ] AC4 — Given `docs/DESIGN.md`, then a new "Phase 8" section links `design/mockups/phase-8.html`, the evidence README and the screenshots (a link to `evidence/phase-8-mockup/README.md#screenshots`, the README's screenshot table), lists the views, records what the owner changed (the 2026-11-02 decisions above that the views show), and lists what the mockup commits items 11–13 to with its open points for the owner, in the form of the "Phase 7: GUI v2" section. The "Approved artefacts" table gains a row for the phase 8 mockup. `bash scripts/check-docs.sh` prints `check-docs: OK`.
- [ ] AC5 (owner gate, not worker-satisfiable) — The owner approves by merging this PR (the D9 gate). Supervisor and `/review-pr` never merge it. The evidence is the owner's GitHub approval and merge, not the PR body.
- [ ] AC6 (field sources) — Given the evidence README, then a field map table lists, per view group, every data field the mockup shows and its source: a kernel column at the base commit (`<migration file>: <table>.<column>`), an existing route, or a shape a phase 8 requirement declares (item 01's Scope §3/§5 — `repo_policies`, `pr_tracks`, `mcp_connections`, `CONNECTOR_KINDS`, the `write` grant — or the owning item's requirement file under `.supervisor/requirements/phase-8/`, cited by file name). A field with no source is removed from the mockup or listed as an open point for the owner in DESIGN.md, never shown as if it existed.
- [ ] AC7 (invariant 4 and the merge flow) — Given the merge card, the repo policy card and the Tasks card, then no control merges a PR or reads as if the kernel or Studio merges: the merge card's primary action approves and its copy says Loomwright's gate merges; "Solo" says it merges when CI and Loomwright's review pass, through the gate; "No policy" says PRs park; and Trust unprotected is an explicit click that the card says is recorded. `grep -niE '<button[^>]*>[^<]*merge' docs/design/mockups/phase-8.html` (and the same over the script's button templates) finds no control that merges; the evidence README records the command and accounts for every hit (for example, copy that says Loomwright's gate merges).
- [ ] AC8 (invariants 1 and 3) — Given the repo policy card and the playbook mode editor, then every policy value carries its provenance ("detected from GitHub", "proposed by Wright", "set by you"), as gui-v2's playbook detail does, and no number reads as a built-in default (the "2" for a team repo is "proposed by Wright"; "No policy: PRs park" is the state before the owner accepts anything). Turning a playbook live shows its dry-run requirement and the held enable (or the pending approval it creates), never a direct switch that takes effect. The evidence README's "What was driven by hand" records both.

**Evidence rule:** AC1, AC2, AC3, AC6, AC7 and AC8 rest on the committed `docs/evidence/phase-8-mockup/README.md`. FINALIZE's `## Evidence` section links the README's screenshot table (`#screenshots`), which meets the requirement's "Screenshots of every view in both themes in the PR body"; if it embeds images, it uses absolute blob URLs, since relative PNG paths do not render in a PR body. The PR body is never the evidence's only home.

## File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `docs/design/mockups/phase-8.html` | CREATE | — | HIGH | The new mockup, self-contained like `gui-v2.html`. Its own file: a separate concern, and `gui-v2.html` (1,580) and `integrations.html` (919) are past the 500-line threshold. Expected 1,600–2,400 lines, written by subtasks 1 and 2 in order. |
| `docs/DESIGN.md` | MODIFY | 204 | HIGH | New "Phase 8" section and an "Approved artefacts" row. Below the threshold. |
| `docs/evidence/phase-8-mockup/README.md` | CREATE | — | HIGH | Evidence for AC1, AC2, AC3, AC6 and AC7, in the format of `docs/evidence/gui-v2-mockup/README.md` (Screenshots, What was driven by hand, How to regenerate, Token audit, Checks, Field map). |
| `docs/evidence/phase-8-mockup/*.png` | CREATE (~80) | — | MEDIUM | `phase-8-<view>-<light\|dark>.png`. Binary outputs, never read into a worker's context. Count depends on the final view list. |

Reference only, not modified: `docs/design/mockups/gui-v2.html` (shell, review strip at :554, hash hook at :892/:903, Tasks board and card, playbook edit's `mode` select at :1057), `docs/design/mockups/integrations.html` (connector detail pane, Connect sheet, App views, Disconnect confirm), `docs/design/mockups/gui-v1.html` (the approval card in Approvals), `docs/design/tokens.json`, `app/scripts/tokens.mjs`, `docs/design/brand-book.md`, `docs/design/design-system/components/*/`, `docs/evidence/gui-v2-mockup/README.md` (evidence format), `kernel/src/store/migrations/*.ts` (columns at base), and `.supervisor/requirements/phase-8/2026-11-02-1600{01,03,06,07,08,10,11,12,13}-*.md` (the declared shapes). `docs/UI.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md` are item 01's files and are not touched here.

Validator-owned surfaces: `scripts/check-docs.sh` scans every `*.md` under `docs/` for relative links (so the evidence README's PNG links and DESIGN.md's new links must resolve). Its avatar-hue rules do not scan `phase-8.html`; avatars drawn in it must still use `crew-*` hues (or `accent` for Wright), never a semantic token (rule 4's intent).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | phase-8.html shell, Tasks card, merge approval card, playbook mode editor | AC1 (these three groups' views), AC2, AC3, AC7 (merge card, Tasks card), AC8 (live-enable confirm) | 0 modify, 1 create | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |
| 2 | Integrations: Jira and ClickUp connect, App upgrade, repo policy card | AC1 (remaining four groups' views), AC2, AC3, AC7 (repo policy card), AC8 (policy provenance) | 1 modify (phase-8.html from #1) | `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |
| 3 | DESIGN.md Phase 8 section, evidence README, screenshots and field map | AC1 evidence, AC2 evidence, AC3 evidence, AC4, AC6, AC7 and AC8 evidence | 1 modify, 1 create (+PNG outputs) | `skills/frontend-ui/SKILL.md` | BLOCKED (by #2) |

Subtask 1 owns the file's skeleton: the token block, the shell (sidebar with Tasks, Approvals, Playbooks and Integrations reachable), the review strip with one group per view group, the URL-hash hook (own-keys lookup, odd-hash fallback), the shared kernel-unreachable band, the palette and the theme switch. Subtask 2 adds its views into that skeleton (new view keys, new review-strip groups, palette entries) without changing subtask 1's views. Subtask 3 changes no HTML except to fix a defect it finds while taking screenshots, and records any such fix in the README.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/design/mockups/phase-8.html"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "tokens:begin"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "Kernel unreachable"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "tasks-populated"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "merge-card"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "playbook-mode"}
requires: []
lanes:
  - "docs/design/mockups/phase-8.html"
external_requires:
  - "Node.js (runs app/scripts/tokens.mjs)"

# Subtask 2
provides:
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "jira-connected"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "clickup-connected"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "app-upgrade"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "policy-proposed"}
  - {kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "policy-unenforceable"}
requires:
  - {from: 1, kind: "file", path: "docs/design/mockups/phase-8.html"}
  - {from: 1, kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "tokens:begin"}
lanes:
  - "docs/design/mockups/phase-8.html"
external_requires: []

# Subtask 3
provides:
  - {kind: "symbol", path: "docs/DESIGN.md", name: "Phase 8"}
  - {kind: "file", path: "docs/evidence/phase-8-mockup/README.md"}
requires:
  - {from: 1, kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "merge-card"}
  - {from: 2, kind: "symbol", path: "docs/design/mockups/phase-8.html", name: "policy-unenforceable"}
lanes:
  - "docs/DESIGN.md"
  - "docs/evidence/phase-8-mockup/**"
  - "docs/design/mockups/phase-8.html"
external_requires:
  - "A headless Chromium for screenshots: `cd app && npm ci && npx playwright install chromium`, then from `app/` `npx playwright screenshot --color-scheme=<light|dark> --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<abs>/docs/design/mockups/phase-8.html#view=<v>&theme=<t>' <out>.png`"
```

The view keys named in the contracts are fixed; every other view key is the subtask's choice, listed in the evidence README.

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
| `docs/DESIGN.md:137` | yes | HOLDS | `Linked PRs and tickets, approvals counts and CI state join in phase 8, so the mockup shows none of them.` | base a0db691 |
| `docs/design/mockups/gui-v2.html:554` | yes | HOLDS | `<div class="review" aria-label="Review controls">` | base a0db691 |
| `docs/design/mockups/gui-v2.html:892` | yes | HOLDS | `if(!Object.prototype.hasOwnProperty.call(VIEWS,v)) return false;` | base a0db691 |
| `docs/design/mockups/gui-v2.html:903` | yes | HOLDS | `const p=new URLSearchParams(location.hash.slice(1));` (then `setView(...)\|\|setView(DEFAULT_VIEW)`) | base a0db691 |
| `docs/design/mockups/gui-v2.html:1057` | yes | HOLDS | `<option value="live" disabled>live (not available yet)</option>` | base a0db691 |

## Risk Assessment

| Risk | Impact | Source | Mitigation |
|------|--------|--------|------------|
| Size: seven view groups with every state is a large file; one worker's context cannot hold it all | HIGH | Feasibility (Phase 2.5) | Two serialized HTML subtasks with a fixed skeleton owned by subtask 1. Reuse gui-v2's shell and integrations.html's connector views; invent nothing that exists. |
| Designing data the kernel does not have; item 01's contract (migration 020, D38–D40) is not merged at the base commit | MEDIUM | Feasibility (Phase 2.5) | AC6's field map ties every field to a column at base or a shape a phase 8 requirement declares. A field with no source is removed or listed as an owner open point. |
| A merge control or copy that implies the kernel or Studio merges (invariant 4) | HIGH | Analysis | AC7: the merge card approves, Loomwright's gate merges; no "Merge" button; Solo and No-policy copy as specified. |
| The repo policy card shows a number as a kernel default, or `live` as a plain switch (invariants 1 and 3) | MEDIUM | Plan Review (attempt 1) | AC8: every value carries its provenance; going live shows the dry run and the held enable. |
| Items 11–13 build an element the mockup never drew (a D9 breach) or drift from it | MEDIUM | Plan Review (attempt 1) | The Downstream consumers list in Design content and AC1; a deliberate difference is named in DESIGN.md's open points. |
| The Jira view leaks real work (Tray) data, or reads as live | MEDIUM | Analysis | Invented site and tickets only; the "owner's work account, never exercised live" note is on every Jira view; AC3's `vendsy` grep. |
| OAuth consent reads as a claude.ai sign-in, or a "Claude Code" slip (invariants 6, 7) | MEDIUM | Analysis | AC3 greps; consent copy names the vendor. |
| Prior churn on sibling mockups: `gui-v2.html` (PR #178) and `integrations.html` (PR #143) each took 2 self-heal rounds (`self_heal_churn`), including a HIGH focus-restore defect | MEDIUM | Prior churn (postmortem ledger) | Copy gui-v2's focus rules: `Esc` closes, focus is trapped in dialogs and returns to the control that opened them (or a stable row when it is gone); the hash lookup reads only own keys. Subtask 3 drives the Disconnect confirms, the consent wait, the policy presets and the palette by hand in headless Chromium and records it under "What was driven by hand". |
| Copying gui-v1's token block (short names, extra chrome) fails AC2 | MEDIUM | Analysis | Paste `node app/scripts/tokens.mjs` stdout as the token block; harness chrome goes in a separate, labelled block listed in the AC2 table. |
| Dollar figures shown as limits (D24) | LOW | Analysis | Limits are tokens or sessions at once; any dollar figure only as "≈ at API rates". |
| Merging without the owner's approval (D9) | HIGH | Analysis | AC5 is an owner gate. Never auto-merge; leave the PR for the owner. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound
- **Threshold note:** the hand-written HTML is about 1,600–2,400 lines (past the 800-line bound). It cannot fan out, since both halves write one file (`file-conflict` would serialize them anyway), so the split is serial. The PNGs are generated binaries no worker reads.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-02-the-phase-8-mockup.md
```

## Plan Review: PASS (attempt 2/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Design content; AC1, AC7 | Items 11–13 build "as phase-8.html draws them", but the brief omitted elements their requirements say the mockup draws; "or upgrading" dropped from the binding decision | fixed (attempt 1 → 2): Downstream consumers list, AC1 state list, decision restored |
| 2 | MEDIUM | Acceptance Criteria / Risk Assessment | No AC or risk for invariant 1 (no built-in policy number) or invariant 3 (live via dry run + held enable) | fixed (attempt 1 → 2): AC8 and two risk rows |
| 3 | LOW | Evidence rule | The requirement's PR-body screenshots line had become optional | fixed (attempt 1 → 2): FINALIZE links the README's #screenshots table |
| 4 | LOW | AC4 | Phase 8 section linked the README, not the screenshots | fixed (attempt 1 → 2): links README#screenshots |
| 5 | LOW | AC7 | `>Merge<` grep missed "Merge now" and similar | fixed (attempt 1 → 2): widened grep |
| 6 | LOW | Design content (Downstream consumers) | Item 11's Scope 3 (the last-known card with its mark while unreachable) is not listed; the reused gui-v2 shell already keeps a stale read with "last known" (DESIGN.md:143) | deferred (below the MEDIUM fix floor) — subtask 1 should draw the Tasks unreachable view with the last-known card and its mark |

## Outcome
- **Status:** completed
- **Completed:** 2026-11-02T17:14:42Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/217
- **Branch:** feature/the-phase-8-mockup
- **Files changed:** 133
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Added docs/design/mockups/phase-8.html (65 views, 7 groups, light/dark; token block byte-equal to tokens.mjs), DESIGN.md "Phase 8: Tickets to PRs" section + Approved-artefacts row, and docs/evidence/phase-8-mockup/ (README + 130 PNGs). Phase 4.5: round 1 FAIL (HIGH A/D shortcut acting on a hidden approval; MEDIUM forced-view state leak) → fixed; round 2 PASS with one MEDIUM (stale evidence claim) → fixed with a same-class S.back leak; round 3 PASS, no findings. One LOW left (Tasks history still "waiting" after Allow once, in-app only). AC5 is the owner's merge (D9) — never auto-merged.

## Not verified
- **Playwright CLI screenshots** — app/node_modules not installed; cached chrome-headless-shell used (subtask 1)
- **Real-keyboard focus rings and hover states** — headless synthetic events only (subtask 1)
- **Contrast of every new view in both themes (eyes-on)** — only 16 screenshots eyeballed; subtask 3 measured in code (subtask 2)
- **Screen-reader output of dialogs and the preset radio group** — no screen reader run (subtask 2)
- **Screen-reader output of the dialogs and the preset radio group** — no screen reader run (subtask 3)
- **Eyes-on rendering of 125 of 130 PNGs** — 5 read; contrast measured in code for every view (subtask 3)
- **Requirement files cited in the field map** — .supervisor/ is gitignored; PR reviewers cannot open them (subtask 3)
