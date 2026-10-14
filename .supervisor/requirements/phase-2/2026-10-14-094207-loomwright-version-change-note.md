# 07 — A Loomwright version change produces a "new features" note built from the contract diff

## Status: ready

**Priority:** MVP · ROADMAP phase 2 exit check (b) · D13's goal, D32's mechanism

**As** the owner,
**I want** Studio to notice when the active Loomwright changes version and tell me what was added, removed or changed,
**so that** Wright and I learn about new Loomwright capabilities within minutes, without anyone reading release notes.

## Owner decisions (2026-10-14, binding)

- The note is built from a **diff of the old and new `capabilities.json`**, nothing else: the installed plugin ships no `CHANGELOG.md`, the contract has no changelog field, and D32 forbids parsing Loomwright's other files. Release notes can join the contract later (a Loomwright change).

## Scope

1. **Detect**: at kernel start and on each tick at most once a minute, resolve the active install through item 02's adapter. When (install path, plugin version, contract schema version) differs from the latest `loomwright_contract_seen` row (item 01), record the new row with the contract as read. The first observation ever is recorded silently (a baseline, no note).
2. **Diff** old vs new contract: agents, commands, skills and result schemas added / removed / description changed; hooks added / removed / `host_mode` or `writes` changed; `host_switch` changed; contract schema version changed. Unknown fields are ignored (D32: tolerate).
3. **Note**: write `memory/shared/loomwright-updates/<old>-to-<new>.md` (markdown, invariant 8: what changed, grouped, with each item's one-line description) and create one notification (item 03's record function, source `kernel:loomwright_version`, title "Loomwright <old> → <new>", body the counts and the file path).
4. **Breaking signals** go first in the note and the notification: a removed command or agent, a `host_switch` change, or a contract schema version above what this kernel supports (then item 02 refuses sessions; the note says so).
5. A downgrade (new version lower) produces the same note, titled as a downgrade.
6. Doc page section in `docs/architecture/loomwright.md`.

## Non-goals

- Offering playbooks for new features (phase 3, D13).
- Reading Loomwright's changelog, frontmatter or any non-contract file.

## Acceptance criteria

- [ ] Given no prior observation, when the kernel starts with 17.2.0 active, then one row is recorded and no note or notification is created.
- [ ] Given 17.2.0 was seen and the fixture `installed_plugins.json` now names 17.3.0 whose contract adds one command and removes one skill, then within one minute of ticks one note file `17.2.0-to-17.3.0.md` lists both, and one notification exists; later ticks create nothing more.
- [ ] Given the new contract changes `host_switch.env`, then the note's first section flags it as breaking.
- [ ] Given the new install has no `capabilities.json`, then no note is written, item 02's adapter error is what `/status` shows, and one notification says the active Loomwright has no contract (once per version, not per tick).
- [ ] Given the note file already exists (owner kept it), then it is not overwritten; a suffixed file is written instead.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- Description-only churn makes noisy notes. The note groups description changes last and the notification counts only additions and removals.

## Depends on
2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md
2026-10-14-094202-loomwright-adapter-reads-the-active-contract.md

## Touches
kernel/src/loomwright/
kernel/test/loomwright-version-note.test.ts
docs/architecture/loomwright.md
