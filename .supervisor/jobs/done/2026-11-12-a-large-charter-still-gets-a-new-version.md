# Supervisor Job: 19a — A large charter still gets a new version when the owner asks for a change

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-12-020724/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement is not tracked by git: `.supervisor/` is the lane's metadata area, so its provenance is the /automate run file, not a commit)
- **Source requirement:** .supervisor/requirements/phase-8-19/2026-11-12-020249-a-large-charter-still-gets-a-new-version.md
- **Base commit:** 5ff0d675c4196bda90d7d80f74f27ffc7c50f722

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and React app (vitest); a string-formatting change in existing modules. |
| 2 | Dependency Availability | GO | No new dependency. |
| 3 | Architecture Fit | GO | The readiness lines are built in one place (`dutyFindings` in `kernel/src/agents/charter-readiness.ts`), and both create and update displays take them from `charterReadiness(...).lines`; the app parses only the line prefixes (`app/src/screens/approvals/subject.ts`). |
| 4 | Scope vs Supervisor Capability | GO | 10 modify paths (3 source, 6 tests, 1 doc; 3 of them expected unchanged), 0 creates; below every split threshold. |
| 5 | Hard Blockers | GO | None. Validation 2 (running system) needs the owner and the packaged app; it is the owner's step, not the worker's. |

**Overall Verdict:** GO

## Task
**Goal:** Shorten each readiness duty line's quote of the duty text to a numbered, word-bounded excerpt in every charter approval display (create and update), so a 10-duty charter's head fits `MAX_APPROVAL_DISPLAY` with room for the owner's Ask or change and Choose workspace redrafts, and make the fit refusal name how many characters over it is and what to ask for less of.

**Problem Statement:**
The owner needs Ask or change and Choose workspace to yield a held v2 on a large charter because a real crew member (a developer turning tickets into PRs) has many duties.
Currently, each `covered:` / `flagged:` / `not checked:` duty line quotes the duty's full text, so on approval 21 (10 duties, ~200 characters each) the readiness lines took 3,211 of the head's 3,994 characters, and the two changes the owner asked for were refused for size (615 and 60 characters over). This causes the owner to get an explanation instead of a new version.
Success looks like: the same charter's head fits with ≥1,200 characters to spare, and both redrafts are held as v2.

## Acceptance Criteria

Carried forward from the source requirement (AC numbers kept):

- [ ] **AC1.** Given a create charter with 10 duties whose texts average about 200 characters (approval 21's shape: the same granted jobs, two prerequisite lines), when Wright holds it (`kernel_agent_create` through the gate, shipped catalogue), then the display's head (`createHead`) fits `MAX_APPROVAL_DISPLAY` with at least 1,200 characters to spare, and each duty's readiness line names its duty number (`duty <n>`) and starts with the same `  covered: ` / `  flagged: ` prefix as today.
- [ ] **AC2.** Given that held charter, when the owner's Ask or change produces Wright's redraft that adds a job with 5 more kernel tools (approval 21's "add comment replies" case), then the redraft (a new `kernel_agent_create` with a new idempotency key for the same id) is held as v2 rather than refused for size.
- [ ] **AC3.** Given that held charter, when the owner picks a saved workspace with Choose workspace, then Wright's redraft with that workspace path (a long path, at least as long as `~/studio-work/studio-sandbox` expanded under a home dir) is held as v2 rather than refused for size.
- [ ] **AC4.** Given a held update for a member with 10 duties (~200 characters each), when `updateDisplay` builds it, then its readiness lines use the same short form, and the update fits under the same conditions as the create; `readinessFloorLines` (the update's lower bound, `shortestDutyLine`) uses the same short form, so the floor stays a lower bound of the real display.
- [ ] **AC5.** Given a duty text no longer than the excerpt length, when its readiness line is built, then the line carries the whole text with no cut mark. Given a longer one, the excerpt ends with exactly one visible cut mark (`…`, the kernel's existing cut mark in `clip`), and the line never ends mid-word (the cut falls at whitespace; a first word longer than the excerpt is the one case cut inside it, still with one `…`).
- [ ] **AC6.** Given the shortened display, when the owner opens the card's full details, then `role.md` (in the display's full details) still carries every duty's full text, and the "<n> characters, nothing cut" count matches the stored display's length.
- [ ] **AC7.** Given the chat charter card and the Approvals screen (18d, item 16), when they render a shortened readiness block, then every readiness line still shows with its Covered / Flagged badge and its duty number, and the workspace line still offers Choose workspace.
- [ ] **AC8.** Given a charter that still doesn't fit after shortening (for example many very long enforced lists), when Wright calls the create, then it is refused `invalid_input` as today, the refusal names how many characters over `MAX_APPROVAL_DISPLAY` it is (`<k> over the 4000`) and what to ask for less of (for the create: fewer duties among them, then fewer or shorter tools, prefixes or workspaces), and nothing is held. The update's fitting-floor refusal (same `displayFitRefusal`) also states the `<k> over` count but keeps naming only what an update can change (tools, prefixes or workspaces), never duties — an update cannot change the stored duties.

Implementation notes the ACs rely on (not extra scope): the excerpt applies to every duty line `dutyFindings` builds, the legacy bare-string `flagged: duty <n> names no job …` line included (an update's stored duties may be bare strings), and to both candidates in `shortestDutyLine`; the excerpt symbols are named `READINESS_DUTY_EXCERPT_MAX` and `dutyExcerpt` (fixed by the Subtask Contracts' provides; the value is the builder's choice within AC1's budget, 72 suggested).

Validation (from the requirement, must pass before merge): step 1 static (`cd kernel && npm ci && npm run typecheck && npm test`; `cd app && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh`) is the worker's. Step 2 (running system, the packaged app with the installed kernel service) is the owner's walk; the worker does not claim or fabricate it.

## Touched-file invariants

> Grounded at base `5ff0d675c4196bda90d7d80f74f27ffc7c50f722`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/agents/charter-readiness.ts`** — keep: every line starts with exactly one exported prefix (`export const READINESS_COVERED_PREFIX = "  covered: ";`, `READINESS_FLAG_PREFIX`, `READINESS_NOT_CHECKED_PREFIX`) and the duty's excerpt stays last on its line after the kernel's words (`text is always last on its line, after the kernel's own words, so it can't`); keep the `duty ${i + 1}` numbering (`const n = \`duty ${i + 1}\`;`) and the `brief` short forms unchanged (`brief` carries no duty text: `${n} is covered`); keep the CLI-safe import set (header comment `imports only \`node:os\`, the CLI-safe`; no new import of `../loop/internal.js` — write the excerpt helper here). reuse: the module's own `oneLine(text)` before cutting. mirror: `shortestDutyLine` must build its covered/flagged candidates with the same excerpt as `dutyFindings` (`${oneLine(duty.text)}` there today), or the update floor stops being a lower bound and `updateFitRefusal` wrongly says `no request to these fields fits`; update the format comment (`covered: duty <n> <how>: <duty text>`). pinned by: `kernel/test/agents-charter-readiness.test.ts` (`"  covered: duty 1 by Hand tickets to /automate: Turn tickets into PRs"`), `kernel/test/agents-charter-tools.test.ts` (`covered: duty 1 with no tool (it needs no kernel tool): Review the pull requests the owner sends and comment on them.`), `kernel/test/phase-4-exit.test.ts` (`covered: duty 1 with no tool (it needs no kernel tool): Review the pull requests in the repo and leave review comments.`) — all three texts are shorter than the excerpt, so they stay byte-identical (AC5's whole-text case).
- **`kernel/src/agents/charter-tools.ts`** — keep: the safety rule that the head (who, readiness, job, enforced, limits, workspaces) must fit or nothing is held (`const tooLong = displayFitRefusal(CREATE_HEAD_TEXT, createHead(checked.charter, ctx.catalogue, readiness.lines));`); `MAX_APPROVAL_DISPLAY` is unchanged (non-goal); the refusal token stays `invalid_input` from the closed `CHARTER_TOOL_REFUSALS`; the hold refusal shape (`(nothing was held for the owner)`); keep `; ask for less at once` in the refusal text (pinned). reuse: `displayFitRefusal` stays the single place the fit message is built (both create and the fitting-floor update path call it: `if (floor <= MAX_APPROVAL_DISPLAY) return displayFitRefusal(UPDATE_DISPLAY_TEXT, display);`); it gains the over-count (`${text.length - MAX_APPROVAL_DISPLAY} over the ${MAX_APPROVAL_DISPLAY}`) for both, and each caller passes what to ask for less of — the create names duties first, the update keeps `fewer or shorter tools, prefixes or workspaces` (no duties: an update never changes the stored duties); leave the `no request to these fields fits` branch's wording alone. mirror: `createDisplay` still renders `role.md` from `renderRoleMd(charter, charter.connectors)` (full duty text, AC6). pinned by: `kernel/test/agents-charter-tools.test.ts` (`would be \\d+ characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown; ` and `"; ask for less at once"`).
- **`app/src/screens/approvals/charterBlocks.ts`** — keep: `repoCandidates` reads `owner/repo` tokens from the readiness lines then `role.md` (`const sources = [...(parts?.readiness ?? []).map((l) => l.text)`); a word-bounded excerpt never leaves a partial `owner/re` token, and the full `role.md` text still supplies the repo. Expected unchanged; the worker confirms with tests (AC7). `WORKSPACE_FLAG = "no copy of a repo to work in"` is a prerequisite line, not a duty line, so it is untouched.
- **`kernel/test/agents-charter-readiness.test.ts`, `kernel/test/agents-charter-tools.test.ts`, `app/src/screens/approvals/charterBlocks.test.ts`, `app/src/screens/chat/CharterCard.test.tsx`** (shared invariants) — keep: every existing exact-string pin stays exact (`toEqual` / `toBe` on whole lines, as `"  covered: duty 1 by Hand tickets to /automate: Turn tickets into PRs"`); a pin is changed with intent to the new exact string, never loosened to `toContain` or a wildcard; new excerpt pins assert exact strings too. The fit-boundary tests in `agents-charter-tools.test.ts` keep testing the exact 4,000 / 4,001 boundary: their padding is computed from a probe display's own length (`const padFor = (length: number) => 10 + length - probe;`, `const pad = 10 + MAX_APPROVAL_DISPLAY - (heldDisplays()[0]?.length ?? 0);`), so a shorter readiness block re-sizes them rather than breaking them; if a probe bound (`toBeLessThan(250)`) trips, adjust the fixture, never drop the boundary assertion. The app tests keep using the card fixture's real kernel line shape (`"  covered: duty 1 by Hand tickets to /automate: Turn acme/widgets tickets into PRs"` in `charterBlocks.test.ts`). The readiness suite keeps building through the shipped catalogue and the gate (`buildToolCatalogue`), so AC1–AC4 are measured on the real display, not a hand-built string.
- **`kernel/test/agents-charter-connectors.test.ts`, `kernel/test/phase-4-exit.test.ts`** (verify-only, expected unchanged) — keep: their one-duty fixtures' texts are shorter than the excerpt (`duties: [{ text: "Review the pull requests the owner sends and comment on them.", jobs: [] }],` in the connectors test, 62 characters; the phase-4-exit `covered:` pin quoted above, 63), so their display line positions (`const lines = block.split("\n").slice(1, 5);`, `expect(lines[3]).toBe(\`    ${ENFORCED}; connectors: github\`);`) and the role.md containment check (`for (const line of renderRoleMd(c, ["github"]).trimEnd().split("\n")) expect(block).toContain(`) must stay green with no edit. Edit either file only if the static run shows a failure the excerpt caused, and then change the pin with intent (never loosen it).
- **`docs/architecture/agents.md`** — keep: the readiness format paragraph (`A duty's text is always last on its line, after the kernel's own words`) and the create-display paragraph (`the hold refuses a charter whose head`); update both to say the duty is quoted as a word-bounded excerpt of at most `READINESS_DUTY_EXCERPT_MAX` characters (full text in `role.md`), and the fit refusal names the characters over. `bash scripts/check-docs.sh` checks its relative links.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-charter-readiness.test.ts` — AC1 head spare ≥ 1,200 on the 10-duty fixture | flip `READINESS_DUTY_EXCERPT_MAX = 72` → `READINESS_DUTY_EXCERPT_MAX = 400` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC5 long duty ends with one `…` at a word boundary | flip `READINESS_DUTY_EXCERPT_MAX = 72` → `READINESS_DUTY_EXCERPT_MAX = 400` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC2 redraft adding a job's 5 tools is held as v2 | flip `READINESS_DUTY_EXCERPT_MAX = 72` → `READINESS_DUTY_EXCERPT_MAX = 400` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC3 redraft with the saved workspace path is held as v2 | flip `READINESS_DUTY_EXCERPT_MAX = 72` → `READINESS_DUTY_EXCERPT_MAX = 400` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC4 held 10-duty update's display uses the short form and fits | flip `const text = dutyExcerpt(typeof duty === "string" ? duty : duty.text);` → `const text = oneLine(typeof duty === "string" ? duty : duty.text);` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC4 update floor uses the short form (a fitting 10-duty `tool_policy` update is held, not refused `no request to these fields fits`) | flip `const excerpt = dutyExcerpt(duty.text);` → `const excerpt = oneLine(duty.text);` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC5 never ends mid-word (cut at whitespace); also guards `repoCandidates` from a partial `owner/re` token | flip `head.lastIndexOf(" ")` → `head.length` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-tools.test.ts` — AC6 `role.md` in the stored display carries every duty's full text | delete `asLines(renderRoleMd(charter, charter.connectors)),` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/agents-charter-tools.test.ts` — AC8 create refusal names `<k> over` and duties | flip `${text.length - MAX_APPROVAL_DISPLAY} over the` → `over the` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/agents-charter-tools.test.ts` — AC8 update refusal never names duties | flip `"fewer or shorter tools, prefixes or workspaces"` → `"fewer duties, or fewer or shorter tools, prefixes or workspaces"` in `kernel/src/agents/charter-tools.ts` (the update caller's argument) |
| `app/src/screens/chat/CharterCard.test.tsx` — AC6 "<n> characters, nothing cut" equals the shortened stored display's length | flip `${count(total)} ${total === 1 ? "character" : "characters"}, nothing cut` → `${count(total - 1)} ${total === 1 ? "character" : "characters"}, nothing cut` in `app/src/screens/approvals/CharterDisplay.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — AC7 every shortened readiness line shows its Covered badge and duty number | delete `["covered", CHARTER_READINESS_COVERED_PREFIX],` in `app/src/screens/approvals/subject.ts` |
| `app/src/screens/approvals/charterBlocks.test.ts` — AC7 shortened block keeps the workspace flag (Choose workspace) | flip `export const WORKSPACE_FLAG = "no copy of a repo to work in";` → `export const WORKSPACE_FLAG = "no repo";` in `app/src/screens/approvals/charterBlocks.ts` |
| `app/src/screens/approvals/charterBlocks.test.ts` — `repoCandidates` on a shortened block whose excerpt drops the `owner/repo` token still finds the full repo in `role.md` (the fixture's readiness excerpt must not contain the token) | flip `const sources = [...(parts?.readiness ?? []).map((l) => l.text), (blocks ?? charterBlocks(display, parts)).blocks.find((b) => b.kind === "role")?.text ?? ""];` → `const sources = [...(parts?.readiness ?? []).map((l) => l.text)];` in `app/src/screens/approvals/charterBlocks.ts` |

(Names are fixed — `READINESS_DUTY_EXCERPT_MAX` and `dutyExcerpt`, as in the provides. The value is the builder's choice within AC1's budget; 72 keeps every existing pinned duty text, the longest 63 characters, whole. Rows whose literal does not exist at base — `dutyFindings`' `const text = …`, `shortestDutyLine`'s `const excerpt = …`, `head.lastIndexOf(" ")`, the over-count and the update caller's argument — name the intended code shape; if the worker writes a different literal it updates the row to the literal it wrote, keeping the same mutation.)

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Short duty excerpts in the readiness lines + fit refusal names the overage | all (AC1–AC8) | 10 modify (3 expected unchanged: `charterBlocks.ts`, `agents-charter-connectors.test.ts`, `phase-4-exit.test.ts`), 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "READINESS_DUTY_EXCERPT_MAX"}
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "dutyExcerpt"}
  - {kind: "symbol", path: "kernel/src/agents/charter-tools.ts", name: "displayFitRefusal"}
  - {kind: "file", path: "kernel/test/agents-charter-readiness.test.ts"}
  - {kind: "file", path: "app/src/screens/chat/CharterCard.test.tsx"}
requires: []
lanes:
  - "kernel/src/agents/charter-readiness.ts"
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/test/agents-charter-readiness.test.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "kernel/test/agents-charter-connectors.test.ts"
  - "kernel/test/phase-4-exit.test.ts"
  - "app/src/screens/approvals/charterBlocks.ts"
  - "app/src/screens/approvals/charterBlocks.test.ts"
  - "app/src/screens/chat/CharterCard.test.tsx"
  - "docs/architecture/agents.md"
external_requires: []
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel source | `kernel/src/agents/charter-readiness.ts` (467) — new home of the excerpt (`READINESS_DUTY_EXCERPT_MAX`, `dutyExcerpt`), used by `dutyFindings` and `shortestDutyLine`; `kernel/src/agents/charter-tools.ts` (1035 — `displayFitRefusal` is the single authority for the fit message; a one-message edit, no new responsibility) | — | HIGH |
| kernel tests | `kernel/test/agents-charter-readiness.test.ts` (714 — the 18b readiness suite with the shipped catalogue and gate harness is the one home for AC1–AC5; new `describe` block appended); `kernel/test/agents-charter-tools.test.ts` (1307 — the fit-refusal pins live here; AC8 edits those pins in place, no new suite); `kernel/test/agents-charter-connectors.test.ts` (269) and `kernel/test/phase-4-exit.test.ts` (729) — verify only, change only if a pinned duty text exceeds the excerpt (none does at base) | — | HIGH (readiness/tools), LOW (connectors/phase-4-exit: expected unchanged) |
| app | `app/src/screens/approvals/charterBlocks.test.ts` (104), `app/src/screens/chat/CharterCard.test.tsx` (465 — the card suite is the home for AC6/AC7's shortened-block cases); `app/src/screens/approvals/charterBlocks.ts` (286) — expected unchanged (parse keys on prefixes), modified only if a test shows otherwise | — | HIGH (tests), LOW (charterBlocks.ts change) |
| docs | `docs/architecture/agents.md` (384) | — | HIGH |

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The excerpt length is too generous for AC1's ≥1,200 spare (approval 21: head 3,994, readiness 3,211; ~80 is the arithmetic ceiling) | HIGH | Build the AC1 fixture to approval 21's shape (10 duties × ~200 chars, the same granted jobs and two prerequisite lines, label-only job lines) and assert the spare; the suggested 72 leaves margin after word-boundary cuts. |
| `shortestDutyLine` keeps the full text while the display uses the excerpt: the update floor overstates and a fitting update is refused `no request to these fields fits` | HIGH | Both call the same `dutyExcerpt`; AC4 test exercises a 10-duty update setting `tool_policy`. |
| A test that pins a readiness line's full text is loosened instead of changed with intent (requirement risk) | MEDIUM | Existing pinned texts are ≤ 63 chars and stay whole (AC5); new pins assert exact excerpt strings, not `toContain`. |
| Two duties' excerpts look alike | LOW | The duty number keeps them distinct (requirement). |
| The excerpt cuts inside an `owner/repo` token, giving `repoCandidates` a partial name | LOW | Cut only at whitespace; `role.md` still carries the full token; charterBlocks test covers it. |
| Validation 2 (the owner's packaged-app walk) can't be run by the worker | MEDIUM | The worker reports static validation only; the owner walks Validation 2 and records it, as 18d did in `docs/evidence/phase-8-18d-charter-card-in-chat.md`. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-12-a-large-charter-still-gets-a-new-version.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-12T11:14:03Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/266
- **Branch:** feature/a-large-charter-still-gets-a-new-version
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Readiness duty lines now quote a numbered, word-bounded excerpt (READINESS_DUTY_EXCERPT_MAX = 72, dutyExcerpt) in both create and update displays, and the update floor uses the same excerpt; displayFitRefusal names "<k> over the 4000" with a per-caller ask-for-less (create names duties first, update never names them). Approval 21's 10-duty head now fits with 1,356 characters to spare and the Ask or change / Choose workspace redrafts are held as v2. Kernel typecheck + 4,460 tests, app typecheck + 3,243 tests, check-docs OK. Phase 4.5 review PASS on round 1 (one LOW finding dismissed below the MEDIUM floor); required CI green. Pin-mutation runner unsupported here; the reviewer applied all 14 by hand and all held.

## Not verified
- **Packaged app running-system walk (Validation 2: Ask or change and Choose workspace yield held v2/v3 through a real Wright turn)** — needs the owner, the packaged app with the installed kernel service, and a live model turn (subtask 1)
