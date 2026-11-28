# Supervisor Job: wa-b — an unedited old role.md becomes the persona file; an edited one is flagged

## Environment
- **Project:** ~/orca/workspaces/loomwright-studio/starfish-clone
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/wright-aware/2026-11-21-230100-wa-b-an-unedited-old-role-md-becomes-the-persona-file.md
- **Base commit:** d91d06a78a66d13d0d7b7c1dea9110be3cb726ef

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the React app (vitest); `node:crypto`/`node:fs` only, no new dependency. |
| 2 | Dependency Availability | GO | wa-a (#316, the persona `ROLE_TEMPLATE`) is merged at `37d46b7e`. |
| 3 | Architecture Fit | GO | wa-c (#317, merged at base) already ships the same shape for `wright.json`: past values recovered from git, a kernel-registered audit sink, backup beside the file, `*_upgraded` / `*_upgrade_failed` events (`kernel/src/agents/past-tool-lists.ts`). This item mirrors it for `memory/wright/role.md`. |
| 4 | Scope vs Supervisor Capability | CAUTION | 13 files (> 12): split `context-bound` into a kernel subtask and an app subtask. |
| 5 | Hard Blockers | CAUTION | Needs files outside the requirement's Touches (kernel registration, app contract, audit sentences, docs, evidence) — asked once at Phase 6 (`LP-SCOPE`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** On every install made before wa-a, replace a `memory/wright/role.md` that is still a byte-exact copy of a past `ROLE_TEMPLATE` with the current persona template (old text kept as a backup, one audit event), and flag on the Memory screen a Wright `role.md` that still carries the old manual but matches no past template, never writing it.

**Problem Statement:**
The owner who installed Studio before wa-a needs their Wright to stop carrying a stale duplicate manual, because since wa-a the kernel supplies the Studio guide in every context and the old `role.md` copy is now a second, outdated set of rules beside it.
Currently, `ensureMemoryFiles` (`kernel/src/brain/memory.ts`) creates `role.md` only when absent and never touches it again, and `docs/architecture/brain.md` says an old manual "is read as persona with the guide added after it (nothing refuses or rewrites it)". The owner's own `~/.loomwright-studio/memory/wright/role.md` (4864 bytes, Oct 29) has sha256 `8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345`, which is byte-for-byte the `ROLE_TEMPLATE` at commit `d739dfb2`. This causes every existing Wright context to carry two conflicting manuals.
Success looks like: an exact past copy is replaced once (backup + `wright_role_upgraded` event), is a no-op afterwards, an edited copy is never written and is marked on `GET /memory` and the Memory screen, a crew charter and a symbolic link are never written, and a failed backup leaves `role.md` as it was with a `wright_role_upgrade_failed` event.

**Mechanism (decided here; mirror wa-c, do not reinvent):**
- `kernel/src/brain/past-templates.ts` (new) holds `PAST_ROLE_TEMPLATE_HASHES`: the sha256 (hex, of the UTF-8 bytes) of each of the 16 past `ROLE_TEMPLATE` values, oldest first, each with a comment naming its commit; the current template (`37d46b7e`, sha256 prefix `070b81c079cd`) is NOT in the list. Recovered by evaluating `ROLE_TEMPLATE` from `git show <sha>:kernel/src/brain/templates.ts` for every sha in `git log --format=%H -- kernel/src/brain/templates.ts` (17 commits, 17 distinct values; first `181849a6`). Planning cross-check: the `d739dfb2` value hashes to `8819eec9acb3…`, the owner's file. It also holds `OLD_MANUAL_HEADINGS` (`## Untrusted text`, `## Memory`, `## Who decides`, `## How you act`: every past template carries all four, the current one none), `ROLE_UPGRADE_AUDIT_KINDS = ["wright_role_upgraded", "wright_role_upgrade_failed"] as const` on one line (the app's audit-sentence scan reads `export const [A-Z_]*AUDIT_KINDS = [`), `registerRoleUpgradeAudit(dataDir, sink)` (same sink shape and same rules as `registerProposedToolsAudit`: `{inTransaction, transaction, record}`, upgrade only while registered and only at a top-level call, unregister before the store closes, in-process failure memo keyed by the old bytes' sha256) and the pure `carriesOldManual(text)` predicate.
- `ensureMemoryFiles(dataDir)` keeps its signature and return value (the paths it created) and, after the create loop, checks `wright/role.md`: when a sink is registered for the data dir, `memory/wright` and `role.md` are not symbolic links (`lstat`; read with `O_NOFOLLOW`), the file is a regular file no larger than 64 KiB, and its bytes' sha256 is in `PAST_ROLE_TEMPLATE_HASHES`, it copies the old bytes to `memory/wright/role.bak-<UTC stamp>-<random hex>.md` (exclusive create, mode 0600; a `.md` name so `GET /memory` lists it and the owner can open it), writes `ROLE_TEMPLATE` to a temporary sibling, and inside the sink's transaction re-reads `role.md` (changed since the first read ⇒ no rename, no event, the backup stays), appends `wright_role_upgraded {file: "wright/role.md", old_hash, backup: "wright/role.bak-….md"}` and renames last. A failure at any step before the rename leaves `role.md` byte for byte, removes what it created (the temporary file, and the backup, since `role.md` still holds those bytes; only the changed-since-read case keeps the backup, as in wa-c), records `wright_role_upgrade_failed {file, step, code}` once and never throws (so no Wright message or playbook run fails for it). With no sink (the `studio` CLI, a test without the kernel) nothing is written: an upgrade is never unaudited.
- `startKernel` (`kernel/src/kernel.ts`) registers the sink beside `registerProposedToolsAudit` over the same store and unregisters it before `store.close()`.
- `GET /memory` adds `old_manual: true` to the `wright/role.md` entry only, and only when its text is not the current `ROLE_TEMPLATE` and `carriesOldManual` holds (bounded read, never through a link, never a write). The field is absent otherwise, so every existing entry keeps its exact shape. Crew `role.md` entries are never marked (see Risk Assessment: carried wa-a item).

**Carried from wa-a (PR #316) — why this item does not cover it:** a crew member's charter `role.md` still carries its own untrusted-text and memory sections that repeat `crewGuide`. This item cannot fix it inside its scope: the charter is the owner's approved text (D22; requirement non-goal "Replacing crew charters"; AC "a crew member's `role.md` … is never replaced"), and `kernel/src/agents/charter-files.ts` still writes both sections into every new charter (`## Untrusted text`, `## Memory`), so a mark on crew `role.md` would flag every charter the kernel writes today. Dropping those sections from new charters is a charter-prose change the owner must approve as its own item; this item records that in the PR body's follow-ups and adds a bullet naming it to `docs/architecture/brain.md` `## Honest limits` (no such bullet exists at base: the requirement's "recorded in Known limits by wa-a" premise is stale).

## Design decisions
- decision: where the kernel keeps the past role templates' identities and the upgrade's audit sink
  chosen: a new `kernel/src/brain/past-templates.ts` holding the hash list, the old-manual headings, the audit kinds and a `registerRoleUpgradeAudit` sink that mirrors `kernel/src/agents/past-tool-lists.ts` (wa-c) rule for rule
  rejected: add the hashes to `kernel/src/brain/templates.ts` — blast radius: that file is first-run text pinned verbatim to `docs/architecture/brain.md` by `kernel/test/brain.test.ts`, and it is outside the requirement's Touches
  rejected: generalise wa-c's `registerProposedToolsAudit` into one shared audit registry — blast radius: rewrites merged wa-c code and its 577-line test for no behaviour change; revisit when a third upgrade needs a sink
  rejected: pass the store into `ensureMemoryFiles` and record from each caller — blast radius: changes `kernel/src/brain/handler.ts`, `kernel/src/playbooks/runs.ts`, `kernel/src/agents/memory.ts` and 16 test call sites, and a caller that forgets would upgrade unaudited
  evidence: `grep -n "registerProposedToolsAudit" kernel/src/kernel.ts` → `const unregisterProposedToolsAudit = registerProposedToolsAudit(dataDir, {`; `grep -rn "ensureMemoryFiles(" kernel/src kernel/test` → 3 source callers, 16 test calls
  revisit when: a third kernel upgrade of an owner file needs an audit sink
  status: confirmed

## Acceptance Criteria
- [ ] AC1 — Given Wright's `memory/wright/role.md` byte-matches a past `ROLE_TEMPLATE` (its sha256 is in `PAST_ROLE_TEMPLATE_HASHES`, the 16 values recovered from `git log -p -- kernel/src/brain/templates.ts`, each commented with its commit) and the kernel's audit sink is registered, when `ensureMemoryFiles` next runs (every Wright message and every Wright playbook run calls it), then `role.md` holds exactly the current `ROLE_TEMPLATE`, the old bytes are in `memory/wright/role.bak-<UTC stamp>-<random hex>.md` (mode 0600), and exactly one `wright_role_upgraded` event is recorded with payload `{file: "wright/role.md", old_hash: <sha256 hex of the old bytes>, backup: "wright/role.bak-….md"}`.
- [ ] AC2 — Given the replacement ran once, when `ensureMemoryFiles` runs again (and again after a kernel restart), then nothing changes: no new backup, no new event, `role.md` byte for byte the same (the current template's hash is not in the list; a test pins that).
- [ ] AC3 — Given Wright's `role.md` matches no past template and is not the current template, then the kernel never writes it (bytes, mtime and the folder's file list unchanged, no event), and `GET /memory` returns its entry as `{path: "wright/role.md", size, modified, old_manual: true}` when it still carries any of `OLD_MANUAL_HEADINGS` as a line; a role.md with none of those headings, the current template, and every other file keep the exact `{path, size, modified}` shape.
- [ ] AC4 — Given the Memory screen shows a file whose entry has `old_manual: true`, when the owner opens it, then a plain line reads that the Studio guide now comes from the kernel and the old rule sections in this file can be removed; no other file shows the line (`app/src/api/contract.ts` `MemoryFileEntry` gains `readonly old_manual?: true` with a doc comment).
- [ ] AC5 — Given a crew member's `memory/<id>/role.md` byte-matches a past Wright template (or carries the old headings), then it is never replaced, backed up or marked, and no event is recorded for it.
- [ ] AC6 — Given a symbolic link at `memory/wright` or at `memory/wright/role.md` (even one pointing at an exact past copy), then nothing is read through it, nothing is written through it or beside it, no backup is made and no event is recorded (the existing `symlink_refused` rule: the kernel never follows the link, so it cannot know the target is a template copy); `GET /memory` never reads through the link for the mark.
- [ ] AC7 — Given the backup cannot be written (an injected `writeFileSync` failure on the backup path, e.g. `EACCES`/`ENOSPC`), then `role.md` is left byte for byte, no temporary file is left, exactly one `wright_role_upgrade_failed {file, step: "backup", code}` event is recorded, `ensureMemoryFiles` returns normally (never throws into the message path), and the same failure on the next call with the same bytes records nothing more until a kernel restart or changed bytes. The same holds for a failed write or rename (`step: "write"` / `"rename"`), with the backup removed.
- [ ] AC8 — Given no audit sink is registered for the data dir (the `studio` CLI, a test without `startKernel`), when `ensureMemoryFiles` runs on an exact past copy, then nothing is written and no event exists; with `startKernel`, the sink is registered over its store and unregistered before the store closes.
- [ ] AC9 — Given the app's audit log, then `wright_role_upgraded` and `wright_role_upgrade_failed` each read as one plain sentence naming the file (and the backup / the failed step), built only through `safe` from a defensive payload read, and `audit-sentences.test.ts`'s coverage scan sees both kinds through `ROLE_UPGRADE_AUDIT_KINDS`.
- [ ] AC10 — Given the owner's install, then a committed evidence file `docs/evidence/wa-b-role-upgrade.md` contains: the recovery commands and the 17-row commit → sha256 table; a read-only check of `~/.loomwright-studio/memory/wright/role.md` (sha256, size, mtime before and after — unchanged) showing its hash is `PAST_ROLE_TEMPLATE_HASHES`' `d739dfb2` entry; and the upgrade run (this branch's built kernel, a registered sink over a temporary store) against a temporary data dir seeded with a byte copy of that file, showing `role.md` became the current template and the backup holds the Oct 29 bytes (same sha256); the declared line `Verdict: PASS for Validation 3` at column 0 outside any fence, with the note that the owner's own file upgrades at the first Wright message after the owner installs the build. The owner's data dir is never written, no kernel is started against it and its store is never opened. The PR body links to the file.
- [ ] AC11 — Given `docs/architecture/brain.md`, then its memory section describes this upgrade (condition, backup name, events, sink, the `old_manual` mark) in place of "nothing refuses or rewrites it"; its `## Honest limits` bullet that starts "The template reaches a fresh data dir only" no longer says an existing install keeps an old manual (it says an exact past copy is replaced and an edited one is marked); `## Honest limits` gains a new bullet: a crew charter's `role.md` still carries its own `## Untrusted text` and `## Memory` sections (written by `kernel/src/agents/charter-files.ts`), which repeat `crewGuide`, and dropping them from new charters needs owner approval as a separate item; the rename-before-COMMIT `kill -9` limit is recorded there too; and the `ROLE_TEMPLATE` block pinned by `kernel/test/brain.test.ts` is unchanged.
- [ ] AC12 — Given the owner conditions below (`## Owner conditions`), then `docs/evidence/wa-b-role-upgrade.md` contains an owner conditions table with one row per condition, each naming the code that enforces it and the test (file + test name) that pins it, and the PR body shows each condition with its row (it links to the evidence file, as wa-c's PR did); the evidence lives in the committed file, never only in the PR body.

## Owner conditions
> Binding for the build, recorded verbatim from the owner's Phase 6 answer (LP-SCOPE, 2026-11-28). The PR body must show each one.

the same conditions as wa-c apply, since this rewrites a user's memory file: only a role.md that is provably unedited (equal to a shipped version) is rewritten; any owner edit leaves it untouched; every rewrite writes an audit event and keeps a backup; and the result is visible to the owner. Show each condition in the PR body.

How each maps to the plan: "provably unedited (equal to a shipped version)" ⇒ AC1 (sha256 of the whole file in `PAST_ROLE_TEMPLATE_HASHES`) and the in-transaction re-read; "any owner edit leaves it untouched" ⇒ AC3, AC5, AC6 and the changed-since-read case; "every rewrite writes an audit event and keeps a backup" ⇒ AC1, AC7, AC8 (no sink, no rewrite); "the result is visible to the owner" ⇒ the backup is a `.md` listed by `GET /memory` and openable on the Memory screen, the `wright_role_upgraded` sentence in the audit log (AC9), and the `old_manual` note (AC4).

## Scope widening
- app/src/api/contract.ts
- app/src/screens/budget/audit-sentences.test.ts
- app/src/screens/budget/audit-sentences.ts
- docs/architecture/brain.md
- docs/evidence/wa-b-role-upgrade.md
- kernel/src/kernel.ts
- wright/lessons.md
- wright/role.md
- accepted: LP-SCOPE 2026-11-28

## Touched-file invariants

> Grounded at base `d91d06a78a66d13d0d7b7c1dea9110be3cb726ef`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/brain/memory.ts`** — keep: exclusive create for every first-run file, `writeFileSync(path, file.template, { flag: "wx", mode: 0o600 });`, and the signature and return `export function ensureMemoryFiles(dataDir: string): string[] {` (the created paths only, never the upgrade); keep the import rule in the header, `(itself \`node:*\` only): the \`studio\` CLI loads this` — the new import is the sibling `./past-templates.js` only (no `../loop/`, no store); reuse: the file's own `lstatOrUndefined` and `codedError("symlink_refused", …)` idiom and `O_NOFOLLOW` reads (`constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK`); pinned by: `kernel/test/brain.test.ts` `expect(ensureMemoryFiles(dataDir)).toEqual(MEMORY_FILES.map((f) => f.relativePath));` and `kernel/test/agents-foundation.test.ts` `expect(ensureMemoryFiles(dataDir)).toEqual([]);` (both run with no sink, so they must stay green unchanged).
- **`kernel/src/gui/memory.ts`** — keep: a link or subfolder is never listed, `if (!entry.isFile()) continue;`; the order `const AGENT_FILE_ORDER = ["role.md", "preferences.md", "people.md", "lessons.md"];`; the CLI-safe import rule `The \`studio\` CLI loads this module, so it imports only types`; the mark's read is bounded (at most 64 KiB) and opened with `O_NOFOLLOW`, never a write; mirror: the app contract `export interface MemoryFileEntry {` in `app/src/api/contract.ts` (optional `old_manual?: true`, emitted only when true); pinned by: `kernel/test/gui-memory.test.ts` `expect(lessons).toEqual({ path: "wright/lessons.md", size:` (exact entry shape — the field must be absent for every unmarked file).
- **`kernel/src/kernel.ts`** — keep: the wa-c registration and its teardown order, `const unregisterProposedToolsAudit = registerProposedToolsAudit(dataDir, {` and `await step(() => unregisterProposedToolsAudit());` before `await step(() => store.close());`; mirror: register `registerRoleUpgradeAudit` over the same `store` with the same `{inTransaction, transaction, record: (kind, payload) => appendEvent(store, kind, NO_REF, payload, now().toISOString())}` sink and unregister it in the same `teardown` before the store closes.
- **`kernel/src/agents/past-tool-lists.ts`** (read, not modified) — mirror: `export function registerProposedToolsAudit(dataDir: string, sink: ProposedToolsAuditSink): () => void {`, its top-level-only rule (a call while `inTransaction()` leaves the file alone), its in-transaction re-read before the rename, and the one-line kinds form `export const PROPOSED_TOOLS_AUDIT_KINDS = [`.
- **`app/src/api/contract.ts`** — mirror: the kernel's `GET /memory` entry, `export interface MemoryFileEntry {`; add only the optional field and its doc comment.
- **`app/src/screens/budget/audit-sentences.ts`** — keep: one entry per kind the kernel writes, each read defensively and made inert by `safe` (header: `by \`safe\` and clipped: nothing here builds markup`); reuse: the wa-c sibling entry `wright_tool_policy_upgraded: (p) => {` and its `reader(p)` / `withText` idiom; pinned by: `app/src/screens/budget/audit-sentences.test.ts` `every kind has an entry` and `no entry is for a kind the kernel does not write` (its scanner reads `export const [A-Z_]*AUDIT_KINDS`).
- **`app/src/screens/memory/model.ts`** — keep: `export const MEMORY_REFETCH_KINDS = ["memory_updated", "session_status"] as const;` unchanged (an upgrade runs at a Wright session's start, whose `session_status` already refetches the tree; pinned by `app/src/screens/memory/model.test.ts` `expect([...MEMORY_REFETCH_KINDS]).toEqual(["memory_updated", "session_status"]);`); reuse: the file's test-id table and `export function fileLabel(entry: MemoryFileEntry, now: number = Date.now()): string {` style for the note's text and predicate.
- **`app/src/screens/memory/MemoryScreen.tsx`** — keep: the open-file composition `import { ConflictView, FileView, MemoryEditor,` from `./MemoryViews`; the note is one element rendered beside `FileView` for the open entry, its text and predicate imported from `./model`; never render file content as markup.
- **`docs/architecture/brain.md`** — keep: the `ROLE_TEMPLATE` block that `kernel/test/brain.test.ts` pins (`describe("docs/architecture/brain.md (AC9)"`); rewrite the sentence ending `(nothing refuses or rewrites it)`.

## Closed enumerations touched

> Sibling grep at base `d91d06a7`: `grep -rnF 'wright_tool_policy_upgraded' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` → 22 hits in 6 files.

- **`wright_role_upgraded`, `wright_role_upgrade_failed`** (sibling: `wright_tool_policy_upgraded`) — must be named in:
  - `kernel/src/brain/past-templates.ts` — the new one-line `ROLE_UPGRADE_AUDIT_KINDS` list (the scan's sanctioned form, like `export const PROPOSED_TOOLS_AUDIT_KINDS = [`) — create.
  - `app/src/screens/budget/audit-sentences.ts` — the sentence table, `wright_tool_policy_upgraded: (p) => {` — extend (both kinds).
  - `docs/architecture/brain.md` — the wa-c paragraph names its events — extend (the memory section names both new kinds).
  - `kernel/src/agents/past-tool-lists.ts` — wa-c's own kinds list — no change: it is wa-c's list, not a list of every upgrade kind.
  - `kernel/test/agents-settings-upgrade.test.ts`, `app/src/screens/settings/tool-policy.test.tsx` — wa-c's own assertions — no change: they assert only wa-c's kinds.
  - `docs/evidence/wa-c-proposed-tools-upgrade.md` — a past run's evidence — no change: historical.
- **`old_manual`** (a new optional `MemoryFileEntry` field; sibling: `modified`) — `grep -rnF 'readonly modified: IsoTime;' app/src/api/contract.ts` → the entry interface — extend in `app/src/api/contract.ts`; kernel producer `kernel/src/gui/memory.ts` `files.push({ path:` — extend (wright `role.md` only).
- **`MEMORY_REFETCH_KINDS`** (`app/src/screens/memory/model.ts`) — no change: the upgrade runs inside a Wright session's start, which records `session_status`, already in the list.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/brain-role-upgrade.test.ts` — an exact `d739dfb2` copy is replaced, backed up and recorded once (AC1) | delete the `d739dfb2` hash line (`8819eec9acb3…`) in `kernel/src/brain/past-templates.ts` |
| `kernel/test/brain-role-upgrade.test.ts` — the `d739dfb2` template text, held inline in the test file as a byte-exact string literal (never `git show` at test time: a shallow CI clone breaks it), hashes to its list entry `8819eec9…`, and the current template's hash is not in the list (AC2) | add the current `ROLE_TEMPLATE`'s sha256 to `PAST_ROLE_TEMPLATE_HASHES` in `kernel/src/brain/past-templates.ts` |
| `kernel/test/brain-role-upgrade.test.ts` — a second run changes nothing (AC2) | in `kernel/src/brain/memory.ts` flip the `PAST_ROLE_TEMPLATE_HASHES` membership check to always true, so the second run makes a new backup and event |
| `kernel/test/brain-role-upgrade.test.ts` — the owner edits `role.md` between the first read and the transaction: no rename, no event, the backup kept (AC1/AC3) | delete the in-transaction re-read in `kernel/src/brain/memory.ts` |
| `kernel/test/brain-role-upgrade.test.ts` — an edited copy is untouched and `GET /memory` marks it (AC3) | flip the `old_manual` condition in `kernel/src/gui/memory.ts` to `false` |
| `kernel/test/brain-role-upgrade.test.ts` — a crew `role.md` copy is never written or marked (AC5) | in `kernel/src/brain/memory.ts` run the role check over every `memory/<folder>/role.md` instead of `wright/role.md` only |
| `kernel/test/brain-role-upgrade.test.ts` — a link at `memory/wright` / `role.md` is refused (AC6) | delete the `isSymbolicLink()` refusal for `role.md` in `kernel/src/brain/memory.ts` |
| `kernel/test/brain-role-upgrade.test.ts` — a failed backup leaves `role.md` and records one failure (AC7) | in `kernel/src/brain/memory.ts` move the rename before the backup write |
| `kernel/test/brain-role-upgrade.test.ts` — no sink, no upgrade; `startKernel` registers and unregisters (AC8) | delete the "no registration ⇒ return" guard in `kernel/src/brain/past-templates.ts` / delete the `registerRoleUpgradeAudit` call in `kernel/src/kernel.ts` |
| `app/src/screens/memory/MemoryScreen.test.tsx` — the note shows for an `old_manual` file only (AC4) | flip the note's predicate in `app/src/screens/memory/model.ts` to always `true` |
| `app/src/screens/budget/audit-sentences.test.ts` — both new kinds read as one sentence naming the file (AC9) | delete the `wright_role_upgraded` entry (or the `wright_role_upgrade_failed` entry) in `app/src/screens/budget/audit-sentences.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: past role templates, the audited upgrade in `ensureMemoryFiles`, the `GET /memory` mark, docs and evidence | AC1, AC2, AC3, AC5, AC6, AC7, AC8, AC10, AC11, AC12 | 4 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: the `old_manual` contract field, the Memory screen's note line, the two audit sentences | AC3 (contract side), AC4, AC9 | 6 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel | `kernel/src/brain/memory.ts` (276), `kernel/src/gui/memory.ts` (202), `kernel/src/kernel.ts` (625 — the one place the kernel registers its store-backed sinks; two lines beside wa-c's) | `kernel/src/brain/past-templates.ts` (home of the hash list, headings, kinds, sink and predicate), `kernel/test/brain-role-upgrade.test.ts` (home of every kernel case, the `GET /memory` mark included, so `kernel/test/gui-memory.test.ts` (500) is not modified) | HIGH |
| docs | `docs/architecture/brain.md` (418) | `docs/evidence/wa-b-role-upgrade.md` | HIGH |
| app | `app/src/api/contract.ts` (2178 — the single authority for the app/kernel contract; one optional field), `app/src/screens/budget/audit-sentences.ts` (495 — the single sentence table its coverage test requires; two entries), `app/src/screens/budget/audit-sentences.test.ts` (247), `app/src/screens/memory/model.ts` (411 — home of the note's text, test id and predicate), `app/src/screens/memory/MemoryScreen.tsx` (489 — one element beside `FileView`; text and predicate live in `model.ts`), `app/src/screens/memory/MemoryScreen.test.tsx` (1091 — the screen's render harness and `emit` kernel fixture live here; a second file would copy them) | — | HIGH |

**Total estimated files:** 10 modify + 3 create = 13.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/brain/past-templates.ts"}
  - {kind: "symbol", path: "kernel/src/brain/past-templates.ts", name: "PAST_ROLE_TEMPLATE_HASHES"}
  - {kind: "symbol", path: "kernel/src/brain/past-templates.ts", name: "ROLE_UPGRADE_AUDIT_KINDS"}
  - {kind: "symbol", path: "kernel/src/brain/past-templates.ts", name: "registerRoleUpgradeAudit"}
  - {kind: "symbol", path: "kernel/src/brain/past-templates.ts", name: "carriesOldManual"}
  - {kind: "symbol", path: "kernel/src/gui/memory.ts", name: "old_manual"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "registerRoleUpgradeAudit"}
  - {kind: "file", path: "kernel/test/brain-role-upgrade.test.ts"}
  - {kind: "file", path: "docs/evidence/wa-b-role-upgrade.md"}
  - {kind: "symbol", path: "docs/evidence/wa-b-role-upgrade.md", name: "Verdict: PASS for Validation 3"}
  - {kind: "symbol", path: "docs/architecture/brain.md", name: "wright_role_upgraded"}
requires: []
lanes:
  - "kernel/src/brain/past-templates.ts"
  - "kernel/src/brain/memory.ts"
  - "kernel/src/gui/memory.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/brain-role-upgrade.test.ts"
  - "docs/architecture/brain.md"
  - "docs/evidence/wa-b-role-upgrade.md"
external_requires:
  - "git history of kernel/src/brain/templates.ts (17 commits from 181849a6 to 37d46b7e) available in the worktree"
  - "read-only access to ~/.loomwright-studio/memory/wright/role.md for the AC10 evidence"

# Subtask 2
provides:
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "old_manual"}
  - {kind: "symbol", path: "app/src/screens/budget/audit-sentences.ts", name: "wright_role_upgraded"}
  - {kind: "symbol", path: "app/src/screens/budget/audit-sentences.ts", name: "wright_role_upgrade_failed"}
  - {kind: "symbol", path: "app/src/screens/memory/model.ts", name: "oldManual"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/brain/past-templates.ts", name: "ROLE_UPGRADE_AUDIT_KINDS"}
  - {from: "1", kind: "symbol", path: "kernel/src/gui/memory.ts", name: "old_manual"}
lanes:
  - "app/src/api/contract.ts"
  - "app/src/screens/budget/audit-sentences.ts"
  - "app/src/screens/budget/audit-sentences.test.ts"
  - "app/src/screens/memory/model.ts"
  - "app/src/screens/memory/MemoryScreen.tsx"
  - "app/src/screens/memory/MemoryScreen.test.tsx"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (but `audit-sentences.test.ts` scans `kernel/src` for the kinds Subtask 1 writes) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1 (run the kernel suite only: once it lands, the app's `every kind has an entry` test in `app/src/screens/budget/audit-sentences.test.ts` scans `kernel/src` and is expected to fail until Subtask 2 adds the two sentences)
- **Batch 2:** Subtask 2 (after Subtask 1; run the app suite here)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): 13 files exceed one worker's bound | MEDIUM | Split `context-bound`: kernel first, app after it (the app's sentence scan reads the kernel's kinds). |
| Feasibility (Phase 2.5): files outside the requirement's Touches (`kernel/src/kernel.ts`, `app/src/api/contract.ts`, `app/src/screens/budget/audit-sentences.ts`, `app/src/screens/budget/audit-sentences.test.ts`, `docs/architecture/brain.md`, `docs/evidence/wa-b-role-upgrade.md`) | MEDIUM | Asked once at Phase 6 (`LP-SCOPE`); each is required by a mirrored contract or a coverage test, named in Touched-file invariants. |
| A past template recovered wrongly (regex instead of evaluation, an escaped backtick) leaves that install flagged instead of replaced | MEDIUM | Evaluate each historical `templates.ts` (e.g. write it to a temp `.ts` and import it with the repo's TypeScript runner) rather than regex it; the test pins the `d739dfb2` hash to the owner's known `8819eec9…`; the evidence table lists all 17. A miss still shows the `old_manual` note (the requirement's stated fallback). |
| The upgrade runs in the message path (`ensureMemoryFiles` from `kernel/src/brain/handler.ts` and `kernel/src/playbooks/runs.ts`) and a throw would fail the owner's message | HIGH | Every step is caught and recorded (`*_upgrade_failed`), a throwing sink is swallowed (wa-c's `recordQuietly`), and AC7 pins "returns normally". |
| Rename outside the store transaction: a `kill -9` between rename and COMMIT keeps the new `role.md` with no event | LOW | Same documented limit as wa-c; the backup of the old bytes stays; record it in brain.md's limits. |
| Validation 3 cannot be run against the owner's real file without writing production data | MEDIUM | AC10 proves it read-only on the real file plus a real run on a byte copy, and says the real upgrade happens at the owner's first Wright message after installing; the owner confirms post-merge. |
| Carried wa-a item (crew charter duplicate sections) stays open | LOW | Out of scope by the requirement's non-goal and D22; the plan says why (Task section) and the PR body lists it as a follow-up for the owner. |
| `MemoryScreen.tsx` (489) and `audit-sentences.ts` (495) sit just under the 500-line threshold | LOW | Text and predicate live in `model.ts`; the screen gains one element; the sentence table is the single authority its test requires. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Validation (from the source requirement — must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm ci && npm test` (includes `kernel/test/brain-role-upgrade.test.ts`).
2. **Static — app:** `cd app && npm test` (includes the Memory screen note and the two audit sentences).
3. **Running system — the owner's install:** `docs/evidence/wa-b-role-upgrade.md` (AC10), read-only on the owner's data dir.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-28-wa-b-unedited-old-role-md-persona.md
```

## Plan Review: PASS (attempt 3/3)
- Reviewer: loomwright:plan-reviewer (Claude fallback; routed grok seat returned `lens_unparseable` on all three attempts).
- requirement_fit: fulfils; issues: none.
- Attempt 1 PASS with 3 MEDIUM (fixed: brain.md Honest-limits premise, backup-removal wording, idempotency pin), attempt 2 PASS with 2 LOW (fixed with the owner-conditions change), attempt 3 PASS with no issues.


## Outcome
- **Status:** completed
- **Completed:** 2026-11-28T12:36:03Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/318
- **Branch:** feature/wa-b-unedited-old-role-md-persona
- **Files changed:** 13
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel: past-templates.ts (16 past ROLE_TEMPLATE hashes recovered by evaluation; d739dfb2 = 8819eec9…, the owner's file). ensureMemoryFiles now does an audited upgrade of an exact past Wright role.md (backup, wright_role_upgraded, failure memo, sink only under startKernel). GET /memory gains the old_manual mark. brain.md docs and evidence file updated. App: contract field, Memory screen note, two audit sentences. Phase 4.5: round 1 PASS with one MEDIUM (stale evidence text), fixed in 26ccecdd; two LOW findings dismissed below the floor; round 2 PASS clean. Kernel 5532/0, app 3447/0, CI green.

## Not verified
- **The Wright message path (brain/handler.ts and playbooks/runs.ts calling ensureMemoryFiles under a real kernel)** — only direct ensureMemoryFiles under startKernel was run (subtask 1)
- **The owner's real ~/.loomwright-studio role.md upgrade** — needs a write to the owner's data dir; proven on a byte copy instead (subtask 1)
- **App audit-sentences coverage test** — expected to fail until subtask 2; subtask 2 has since passed it (subtask 1)
- **Memory screen old_manual note in the built Electron app** — jsdom render test only; no e2e run (subtask 2)
