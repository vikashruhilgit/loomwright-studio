# Supervisor Job: Loomwright version notes flag only what changed, and the docs match the code

## Environment
- **Project:** loomwright-studio (lane clone L4)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-15-084413-loomwright-version-notes-say-only-what-changed.md
- **Base commit:** 95d31567140e3101e029cd985b7895a5b7fee8a1

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`, the stack the change lives in. |
| 2 | Dependency Availability | GO | Only `node:fs` (`fstatSync`) is added; no new package. |
| 3 | Architecture Fit | GO | Changes stay inside the version watcher (`kernel/src/loomwright/version-note.ts`) and its doc; mechanism-only (invariant 1) is unchanged. |
| 4 | Scope vs Supervisor Capability | GO | 3 files, well under the single-agent threshold. |
| 5 | Hard Blockers | GO | None. |

**Overall Verdict:** GO

## Task
**Goal:** A Loomwright version note flags `schema_above_known` only on the change that crosses `KNOWN_CONTRACT_SCHEMA_VERSION`, `firstLineOf` allocates no more than it can read, and `docs/architecture/loomwright.md` states what the code does.

**Problem Statement:**
The owner needs version notes whose breaking warnings are new each time, and docs that describe the code, because a repeated warning trains him to ignore real ones and a wrong doc misleads him when something breaks.
Currently, `diffLoomwrightContracts` pushes `schema_above_known` whenever the NEW schema is above the known version (`if (schemaTo !== null && schemaTo > KNOWN_CONTRACT_SCHEMA_VERSION)`), so every later note repeats it; `firstLineOf` allocates `Buffer.alloc(maxBytes)` (the full marker length + 1) even for a small file; and the doc's no-contract paragraph says the notification is "once per install path" although its dedupe key is `(source, title, body)` and the body carries the adapter's message.
Success looks like: the flag fires only on the crossing change, the buffer is `min(marker bytes + 1, file size)`, and each of the doc's three statements has been checked against the code and matches it.

**Premise check done at planning time (the worker re-verifies each, and the PR body says which it was):**
- *"The docs say the watcher reads `capabilities.json` twice"* — the code now reads it once (`checkLoomwrightVersion` → `resolveLoomwrightInstallWithText`, comment `// One read: the resolver validates the text it read and returns it.`, commit `8c0a2e3`), and `docs/architecture/loomwright.md` § Detection already says "reads that install's `capabilities.json` once". Expected outcome: no doc change needed; confirm and say so.
- *No-contract dedupe* — HOLDS: `notifyNoContract` looks up `source = ? AND title = ? AND body = ?` and the body is `Install: ${err.path}\n${err.message}\n…`, while § No contract says "That makes it once per install path". Expected outcome: correct the doc (once per install path **and** adapter message — a changed message for the same install creates a new notification).
- *Host-switch refusal timing* — the § Refusals paragraph already says "Every refusal but one also comes before admission and auth; the exception is a host switch the auth provider's env sets … so it runs after admission and `buildEnv`", which matches `startSession` (`this.#admit(...)` → `this.#auth.buildEnv(...)` → `hostSwitchCollision(env, …)`). Expected outcome: verify the whole § Refusals paragraph (and any other sentence in the file claiming every refusal precedes admission) against `kernel/src/sessions/manager.ts`; fix only a statement that is still wrong.

## Acceptance Criteria
- [ ] Given a contract change from schema 1 to schema 2 with `KNOWN_CONTRACT_SCHEMA_VERSION` 1, when the note is built, then it flags `schema_above_known` (the existing Breaking line); and given a later change from a schema-2 contract to another plugin version still at schema 2, when that note is built, then `diff.breaking` has no `schema_above_known` entry, the note has no Breaking line for it, and the note still states the schema version (its `- From:` / `- To:` lines read `(contract 2)`).
- [ ] Given a change from schema 2 to schema 3 (both above known), when the note is built, then it does not flag `schema_above_known`; given a change from schema 2 back to schema 1, then it does not flag it either.
- [ ] Given a note file larger than the marker, when `writeVersionNote` probes it through `firstLineOf`, then the buffer allocated is at most the marker's UTF-8 length plus one byte; and given a note file smaller than that, then the buffer is at most the file's size. The existing marker-reuse tests (`a crash-retry with a marker over 16 KiB …` and `a file whose first line only starts with the marker is not reused`) still pass.
- [ ] Given `docs/architecture/loomwright.md`, then its statements about how often the contract is read (§ Detection), the no-contract notification's dedupe (§ No contract) and when the host-switch refusal happens (§ Refusals) match the code; § Breaking signals and the `diffLoomwrightContracts` doc comment describe the crossing rule; § The note's crash-retry bullet and the `startsWithMarkerLine` doc comment describe the bounded read (at most the marker plus one byte, and at most the file's size); and `bash scripts/check-docs.sh` passes.
- [ ] `cd kernel && npm ci && npm run typecheck && npm test` passes.

## Touched-file invariants

> Grounded at base `95d31567140e3101e029cd985b7895a5b7fee8a1`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/loomwright/version-note.ts`** — keep: imports only `node:*`, its siblings and type-level kernel modules, never the Agent SDK (header anchor: `` // Imports only `node:*`, its siblings ``); keep `firstLineOf`'s contract `` `undefined` when it cannot be read `` (every read failure, `fstatSync` included, returns `undefined`, never throws) and its partial-read loop (`// A read may return fewer bytes than asked: read until full or end of file.`); keep `startsWithMarkerLine` comparing the whole first line (`return line === marker;`), so a file whose first line only starts with the marker is still not reused; keep `BREAKING_KINDS` unchanged (`export const BREAKING_KINDS = ["command_removed", "agent_removed", "host_switch_changed", "schema_above_known"] as const;`) and the `breakingLine` text for `schema_above_known` (`is newer than this kernel knows`); keep the Changed-section schema line (`- Contract schema version: `), which reports a schema change either way. reuse: the existing `schemaFrom` / `schemaTo` locals in `diffLoomwrightContracts` for the crossing test; `node:fs` is already imported there (`import { closeSync, linkSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";`), add `fstatSync` to that line. mirror: the `diffLoomwrightContracts` doc comment (`Breaking: a removed command or agent, any host-switch change, and a new`) and `docs/architecture/loomwright.md` § Breaking signals (`a contract schema version above \`KNOWN_CONTRACT_SCHEMA_VERSION\``) must both state the crossing rule the code implements; the `startsWithMarkerLine` doc comment (``Reads `marker`'s UTF-8 length plus one byte``) and the crash-retry bullet in `docs/architecture/loomwright.md` § The note (`It reads as many bytes as the marker has (plus its newline)`) must both state the bounded read (the marker's length plus one byte, or the file's size when that is smaller). pinned by: `kernel/test/loomwright-version-note.test.ts` (`is newer than this kernel knows (1). The adapter still reads the contract and does not refuse sessions; fields it does not know are ignored.`, `- Contract schema version: 1 → 2`, `writeVersionNote: a file whose first line only starts with the marker is not reused`).
- **`kernel/test/loomwright-version-note.test.ts`** — keep: every test injects `installedPluginsPath` or `loomwrightPath` (the per-file guard `fails when a test file calls \`startKernel(\` without mentioning either setting`, described in `docs/architecture/loomwright.md` § Detection) — new tests reuse the file's existing `transition(...)` / `contract(...)` / `note(...)` / `sectionOf(...)` helpers rather than starting a kernel of their own.
- **`docs/architecture/loomwright.md`** — keep: every relative link resolves (`scripts/check-docs.sh` check 1: `a relative markdown link in docs/, CLAUDE.md or README.md whose target does not exist`); no absolute home path.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/loomwright-version-note.test.ts` — new test: schema 2 → schema 2 (another plugin version) does not flag `schema_above_known` | Restore the old condition: replace the crossing test in `diffLoomwrightContracts` with `if (schemaTo !== null && schemaTo > KNOWN_CONTRACT_SCHEMA_VERSION)` — the pin must go red. |
| `kernel/test/loomwright-version-note.test.ts` — new test: schema 2 → schema 3 (both above known) does not flag `schema_above_known` | The same mutation as row 1 (restore `if (schemaTo !== null && schemaTo > KNOWN_CONTRACT_SCHEMA_VERSION)`) — the pin must go red. |
| `kernel/test/loomwright-version-note.test.ts` — new test: schema 2 → schema 1 does not flag `schema_above_known` | Replace the crossing test with `schemaFrom !== null && schemaTo !== null && schemaFrom !== schemaTo && (schemaFrom > KNOWN_CONTRACT_SCHEMA_VERSION \|\| schemaTo > KNOWN_CONTRACT_SCHEMA_VERSION)` (fires on any schema change touching a version above known) — the pin must go red. Under the original condition this test passes too, so it is a regression guard against that over-broad form, not against the original. |
| `kernel/test/loomwright-version-note.test.ts` — existing test `a contract schema version above KNOWN_CONTRACT_SCHEMA_VERSION is breaking …` (schema 1 → 2 still flags) | delete `kind: "schema_above_known"` in `kernel/src/loomwright/version-note.ts` (the `breaking.push` line) — the pin must go red. |
| `kernel/test/loomwright-version-note.test.ts` — new test: `firstLineOf`'s buffer is at most marker + 1 bytes and at most the file size | flip `Buffer.alloc(Math.min(maxBytes, size))` → `Buffer.alloc(maxBytes)` in `kernel/src/loomwright/version-note.ts` (the worker uses exactly that expression, or updates this row to the one it wrote) — the pin must go red. |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Crossing-only `schema_above_known`, bounded `firstLineOf` buffer, Loomwright doc corrections | all | 3 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/loomwright/version-note.ts", name: "diffLoomwrightContracts"}
  - {kind: "symbol", path: "kernel/src/loomwright/version-note.ts", name: "firstLineOf"}
  - {kind: "symbol", path: "docs/architecture/loomwright.md", name: "Breaking signals"}
  - {kind: "symbol", path: "docs/architecture/loomwright.md", name: "No contract"}
  - {kind: "file", path: "kernel/test/loomwright-version-note.test.ts"}
requires: []
lanes:
  - "kernel/src/loomwright/version-note.ts"
  - "kernel/test/loomwright-version-note.test.ts"
  - "docs/architecture/loomwright.md"
external_requires: []
```

**Implementation notes (guidance, not extra scope):**
- Crossing rule: flag when `schemaTo !== null && schemaTo > KNOWN_CONTRACT_SCHEMA_VERSION && (schemaFrom === null || schemaFrom <= KNOWN_CONTRACT_SCHEMA_VERSION)`. `schemaFrom` comes from the stored row's `contract_json`, which was validated when stored, so `null` there is defensive only.
- `firstLineOf`: after `openSync`, read the size with `fstatSync(fd).size` and allocate `Buffer.alloc(Math.min(maxBytes, size))` (inside the existing `try`, so a failing `fstatSync` returns `undefined`). A file that grows between the stat and the read is read only up to the stat size, which is still enough to decide whether the first line equals the marker only if size ≥ maxBytes; when size < maxBytes the whole file was read. To test the allocation size without exporting internals, spy on `Buffer.alloc` (`vi.spyOn(Buffer, "alloc")`) around a `writeVersionNote` call that has to probe an existing file, and assert on the sizes it was called with; restore the spy.
- Do not touch `kernel/src/sessions/manager.ts` (non-goal) or read any Loomwright file beyond `capabilities.json` (D32).

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
| Two of the requirement's three doc claims were already fixed in the code or doc (premise drift since the review that raised them). | MEDIUM | Verify each against the code at HEAD; change only statements that are still wrong. The committed doc is the evidence AC4 is judged on; the PR body's per-claim note (requirement scope 3, "say which in the PR") is informational and no criterion depends on it. |
| A stat-sized buffer misses the marker when the file grows between `fstatSync` and the read. | LOW | Notes are written by `createExclusive` (temp file + hard link), so a note file is complete when it appears; a growing file is not a note this transition wrote. Mention it in the doc comment. |
| Spying on `Buffer.alloc` catches allocations other than `firstLineOf`'s. | LOW | Assert on the call whose size is the bounded one (e.g. the max of sizes called during the probe is ≤ the bound), or filter by the expected sizes. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-15-loomwright-version-notes-only-what-changed.md
```

## Plan Review: PASS (attempt 2/3)
- LOW (deferred): one mirror anchor for the `startsWithMarkerLine` doc comment spans a line break; grep the single-line fragment `` `marker`'s UTF-8 length plus one byte (its newline) `` instead.
- LOW (deferred): `transition(...)` always starts from a 17.2.0 schema-1 baseline; for the 2→2 / 2→3 / 2→1 pins chain a second activation + tick after it, or assert on `diffLoomwrightContracts(oldText, newText).breaking` directly.

## Outcome
- **Status:** completed
- **Completed:** 2026-10-15T16:20:33Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/59
- **Branch:** feature/12-loomwright-version-notes-only-what-changed
- **Files changed:** 3
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** schema_above_known flags only the change that crosses KNOWN_CONTRACT_SCHEMA_VERSION; firstLineOf allocates min(marker+1, file size); docs/architecture/loomwright.md corrected (no-contract dedupe, crossing rule, bounded read, baseline limit). 3 review rounds (FAIL, FAIL, PASS), 2 doc-accuracy fixes; risk_classification high_risk=false.
