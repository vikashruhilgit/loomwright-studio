# wa-b: an unedited old `role.md` becomes the persona file; an edited one is flagged (evidence)

**What this is.** Validation 3 (the running system) of the wa-b brief, plus how the past templates were recovered and the owner conditions table (AC10, AC12). The check read the owner's `role.md` only (sha256, size, mtime and the folder listing, before and after). It never started a kernel against the owner's data dir, never opened its store and never wrote to it. The upgrade itself ran against a temporary data dir seeded with a byte copy of the owner's file.

## Recovering the past templates

`PAST_ROLE_TEMPLATE_HASHES` (`kernel/src/brain/past-templates.ts`) was recovered by **evaluating** `ROLE_TEMPLATE` from each historical `kernel/src/brain/templates.ts`, never by matching its text with a regex (a template literal's escapes, such as the escaped backticks around `studio` at `d739dfb2`, are resolved only by evaluating it). No historical version has an import or an interpolation, so each file is evaluated standalone by Node 24's TypeScript type stripping.

**Commands run** (2026-11-28, at base `d91d06a7`, the repository is not a shallow clone):

```sh
git log --format='%H %h %ad %s' --date=short -- kernel/src/brain/templates.ts   # 17 commits, 181849a6 to 37d46b7e
for c in $(git log --reverse --format=%H -- kernel/src/brain/templates.ts); do
  git show "${c}:kernel/src/brain/templates.ts" > "<scratch>/recover/src/${c}.ts"
done
node <scratch>/recover-roles.mjs <scratch>/recover/src $(git log --reverse --format=%H -- kernel/src/brain/templates.ts)
```

`recover-roles.mjs` (a scratch script, not committed) does, for each commit: `const { ROLE_TEMPLATE } = await import(pathToFileURL("<scratch>/recover/src/<sha>.ts"))`, then prints `sha256(Buffer.from(ROLE_TEMPLATE, "utf8"))`, the byte length, and how many of the four `OLD_MANUAL_HEADINGS` appear as a line.

**Observed (17 commits, 17 distinct values):**

| # | Commit | Date | Bytes | sha256 of `ROLE_TEMPLATE` | Old headings | In `PAST_ROLE_TEMPLATE_HASHES` |
|---|---|---|---|---|---|---|
| 1 | `181849a6` | 2026-10-15 | 1558 | `e14f33ad758b8545fdf0eb805264ebeaaed34553c15cbc93890359de09a7a0dd` | 4 | yes (index 0) |
| 2 | `ab3d8c75` | 2026-10-15 | 1592 | `5013a269b49dfce932e7f4c3cc38dd35dcde78f6357f86f31c5617d835b16c11` | 4 | yes |
| 3 | `bc6d53f6` | 2026-10-16 | 1748 | `177ded7579881bb501edbba54bd6d3765af3a9a37a8f6c1f14e7ca9a06e3e623` | 4 | yes |
| 4 | `845564ce` | 2026-10-18 | 2368 | `ff34c1099d8e65bd751daa07a1161e54d718717586ec4ab76bc446142212cefe` | 4 | yes |
| 5 | `714f28ce` | 2026-10-24 | 2718 | `58de5dc40658740e570908c76d79623f31d24efa4b2f10fde47c3b14c7752156` | 4 | yes |
| 6 | `e93bac93` | 2026-10-28 | 4093 | `11dddbf55c9644eec81ffbcf9f9a21bce4977a2461fb9de10cb242f4d35ee509` | 4 | yes |
| 7 | `99bdce81` | 2026-10-28 | 4183 | `7569bebe1ccc624f9c91bc26fd849ae540840e79b7f9b1b7a07a8801e136f7b7` | 4 | yes |
| 8 | `1540566c` | 2026-10-29 | 4519 | `97d294d96595ef425d7de584e5466a606203910e373dea06e25d63f97b78d5bf` | 4 | yes |
| 9 | `d739dfb2` | 2026-10-29 | 4864 | `8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345` | 4 | yes (index 8): the owner's file |
| 10 | `ad404e4f` | 2026-11-09 | 6438 | `96a753d2b12ecb746f805a7bdf8b21087d5eed8178ac05a2e504f70ca6a55335` | 4 | yes |
| 11 | `0f00bc16` | 2026-11-09 | 7889 | `72da7a5d260f52e72322a1b006aaef70c8bbf4b277949505410b660b54430746` | 4 | yes |
| 12 | `d0052809` | 2026-11-09 | 8206 | `d3a6d29d0856eb5db358dbbdb56f8ccf69ba3fb25ab9add5b55e07339d2dd8b6` | 4 | yes |
| 13 | `27fbba3b` | 2026-11-10 | 8666 | `0d366f9d6afc79e8ec8026c6d358a92ef18e4591b944d4d54ade65b7e6f7e367` | 4 | yes |
| 14 | `2927ef11` | 2026-11-13 | 8763 | `d371acfdc5718300787ff930dcd4bc6e9d96b96574ea2b66a6bf771d7900f050` | 4 | yes |
| 15 | `ff127a5d` | 2026-11-14 | 9180 | `bd5d7e04a891f182ac6d70dc336f7d82165ad68d8f483eb64240b0ee1a7cd2e4` | 4 | yes |
| 16 | `7da35cc9` | 2026-11-16 | 9469 | `1852559e15176fe17ea5ef7aca4e9fb56c3b57199cb767821b0ef55cc7230dd4` | 4 | yes |
| 17 | `37d46b7e` | 2026-11-28 | 580 | `070b81c079cdc13c466c73b09fa3fe01e7936e2c5746309e88c0029854a8d37e` | 0 | no: the current template (wa-a) |

Every past template is under 10 KiB (the upgrade reads at most 64 KiB) and carries all four old-manual headings; the current one carries none. The planning cross-check holds: the `d739dfb2` value hashes to `8819eec9acb3…`, the owner's file. `kernel/test/brain-role-upgrade.test.ts` holds the `d739dfb2` and `181849a6` templates inline as their verbatim template literals (never `git show` at test time) and pins each to its list entry.

## Validation 3: the owner's `role.md`, read-only, and the upgrade on a byte copy

Run on 2026-11-28 (12:08 UTC) at this branch's working tree (base `d91d06a7`). `STUDIO_DATA_DIR` was unset in the shell, so the data dir is `~/.loomwright-studio` (`resolveDataDir`, `kernel/src/store/store.ts`).

**Commands run:**

```sh
F=~/.loomwright-studio/memory/wright/role.md
shasum -a 256 "$F"; stat -f 'size=%z mtime=%Sm' -t '%Y-%m-%dT%H:%M:%S%z' "$F"; ls -la ~/.loomwright-studio/memory/wright/   # before
cd kernel && node scripts/build.mjs            # this branch's kernel into kernel/dist (gitignored), removed afterwards
node <scratch>/validation3.mjs "$PWD/dist" "$F"
rm -rf dist
shasum -a 256 "$F"; stat -f 'size=%z mtime=%Sm' -t '%Y-%m-%dT%H:%M:%S%z' "$F"; ls -la ~/.loomwright-studio/memory/wright/   # after
```

`validation3.mjs` (a scratch script, not committed) imports the built `brain/memory.js`, `brain/past-templates.js`, `brain/templates.js`, `store/store.js`, `loop/internal.js` and `gui/memory.js`. It reads the owner's file's sha256, size and mtime (a read, never a write) and looks its hash up in `PAST_ROLE_TEMPLATE_HASHES`. It then makes a temporary data dir under `$TMPDIR`, copies the owner's file to its `memory/wright/role.md` byte for byte, opens a new `Store` on **that temporary dir**, registers the audit sink over it with `registerRoleUpgradeAudit` (the same sink `startKernel` registers), and calls `ensureMemoryFiles` twice. After that it calls the real `GET /memory` handler on the temporary store, unregisters, closes the temporary store and reads the owner's file again. The temporary dir was deleted afterwards.

**Observed, the owner's file (read-only):**

| What | Before | After |
|---|---|---|
| File | `~/.loomwright-studio/memory/wright/role.md` | same |
| sha256 | `8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345` | `8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345` |
| Size | 4864 bytes | 4864 bytes |
| mtime | 2026-10-29T15:24:35.576Z (Oct 29 20:54 local) | 2026-10-29T15:24:35.576Z |
| `memory/wright/` listing | `lessons.md`, `people.md`, `preferences.md`, `role.md`, `threads/` | the same, no backup |
| Index in `PAST_ROLE_TEMPLATE_HASHES` | 8, the `d739dfb2` entry | n/a |

**Observed, the upgrade on the byte copy (temporary data dir, this branch's built kernel):**

| What | Value |
|---|---|
| Seeded copy | 4864 bytes, sha256 `8819eec9acb3…4345` (the owner's bytes) |
| First `ensureMemoryFiles` returned | `["wright/preferences.md","wright/people.md","wright/lessons.md","shared/README.md"]` (the absent first-run files; never `role.md`) |
| `role.md` after | 580 bytes, sha256 `070b81c079cd…d37e`, equal to the current `ROLE_TEMPLATE` |
| Backup | `memory/wright/role.bak-20261128T120849131Z-a8bb9806.md`, 4864 bytes, mode 600, sha256 `8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345`: the Oct 29 bytes |
| Events | exactly one: `wright_role_upgraded`, actor `kernel`, payload `{"file":"wright/role.md","old_hash":"8819eec9acb3aed46042567dc20a595b3e303f162b07bf692a22197c357d4345","backup":"wright/role.bak-20261128T120849131Z-a8bb9806.md"}` |
| Second `ensureMemoryFiles` | returned `[]`; still one event; the file list unchanged (no second backup) |
| `GET /memory` Wright files | `wright/role.md`, `wright/preferences.md`, `wright/people.md`, `wright/lessons.md`, `wright/role.bak-20261128T120849131Z-a8bb9806.md`: the backup is listed (so the owner can open it), and no entry carries `old_manual` (the replaced `role.md` is the current template) |

Result: the owner's file is byte for byte the `d739dfb2` template, the kernel's list recognises it, and the built kernel replaces a byte copy of it with the current template, keeps the Oct 29 bytes as a backup with the same sha256, and records one event; the owner's own file was not written.

Verdict: PASS for Validation 3

The owner's own file upgrades at the first Wright message (or Wright playbook run) after the owner installs this build: the installed kernel registers the sink at start, and that message's `ensureMemoryFiles` replaces it. The owner confirms that after merge; it was not done here because it would write the owner's data dir.

## Owner conditions

The owner's conditions (LP-SCOPE, 2026-11-28): "the same conditions as wa-c apply, since this rewrites a user's memory file: only a role.md that is provably unedited (equal to a shipped version) is rewritten; any owner edit leaves it untouched; every rewrite writes an audit event and keeps a backup; and the result is visible to the owner."

Result: the runs of `cd kernel && npx tsc -p tsconfig.json && npm test` and `cd app && npm run typecheck && npm test` on 2026-11-28 at this branch's working tree are recorded in the last paragraphs of this section. Every test named below is in `kernel/test/brain-role-upgrade.test.ts` (describe > name) unless it names an app file, and passed. Each kernel pin in the brief's "Pin mutations" table was applied one at a time to the code it protects, with the test file re-run: all 10 kernel mutations (the table's 9 kernel rows, the last row's two mutations applied separately: the hash line deleted, the current hash added, the membership check forced true, the in-transaction re-read deleted, the `old_manual` condition forced false, the role check pointed at a crew folder, the `role.md` `isSymbolicLink()` refusal deleted, the rename moved before the backup, the no-registration guard deleted, the `startKernel` registration deleted) failed their pin, and so did one extra (the whole re-read block deleted, not just its comparison); none survived.

| Condition | Enforced by | Test (describe > name) | Result |
|---|---|---|---|
| Only a `role.md` that is provably unedited (equal to a shipped version) is rewritten | `PAST_ROLE_TEMPLATE_HASHES` (`kernel/src/brain/past-templates.ts`): sha256 of the whole file, checked in `upgradeWrightRole` (`kernel/src/brain/memory.ts`), and the in-transaction re-read before the rename | `the recorded past templates > are 16 distinct sha256 hex digests, and the current ROLE_TEMPLATE's is not one of them (an upgraded file is never upgraded again)`; `the recorded past templates > the d739dfb2 template held inline hashes to its list entry 8819eec9… (the owner's file), and the 181849a6 one to the first`; `AC1: an exact past copy is replaced, backed up and recorded once > a %s copy becomes the current template, its bytes in role.bak-<stamp>-<hex>.md (0600), with one wright_role_upgraded event` (d739dfb2, 181849a6); `AC2: once replaced, nothing changes again > a second run and a run after a kernel restart write nothing and record nothing` | pass |
| Any owner edit leaves it untouched | the hash check (any byte changed is no match); `readWrightRoleForUpgrade`'s `lstat` refusal of a link at `memory/wright` or `role.md`, `O_NOFOLLOW` open and one-link check; the upgrade looks at `wright/role.md` only; the re-read inside the transaction (`RoleChangedError`) | `AC3: an edited copy is never written, and GET /memory marks it > an edited copy (%s) is left byte for byte (bytes, mtime, folder list), no event, and marked old_manual` (one byte added, one byte removed, a line rewritten, only the memory heading kept, CRLF line ends); `AC3: … > an edited copy over 64 KiB is never written, and is marked from its whole lines within the bound`; `AC3: … > an exact past copy with a second hard link is never written (it is shared with another path)`; `AC1/AC3: the owner edits role.md between the first read and the transaction > the owner's edit wins: no rename, no event, the backup stays, and the next run leaves the edit alone`; `AC5: a crew member's role.md is never replaced, backed up or marked > a crew role.md that is an exact past Wright template is left alone, with no event and no mark`; `AC6: a symbolic link at memory/wright or at role.md is never read, written or followed > a link at memory/wright (to a folder holding an exact past copy): nothing read through it, nothing written, no event`; `AC6: … > a link at role.md (to an exact past copy): the link is never opened, nothing is written beside it, no event` | pass |
| Every rewrite writes an audit event and keeps a backup | `upgradeWrightRole`: the backup (exclusive create, 0600) before the temporary file, `wright_role_upgraded` appended inside the sink's transaction before the rename, the rename last; `roleUpgradeRegistration` (no sink, or an open outer transaction, is no upgrade); `registerRoleUpgradeAudit` in `startKernel` (`kernel/src/kernel.ts`), unregistered before `store.close()` | `AC1: … > a %s copy becomes the current template, …`; `AC1: … > two upgrades in the same millisecond make two backups (a random suffix, exclusive create)`; `AC7: a failed step leaves role.md byte for byte, records one failure and never throws > an injected %s failure (%#) keeps role.md, leaves no temporary file or backup, and records wright_role_upgrade_failed once` (backup ENOSPC, backup EACCES, write, rename); `AC7: … > a lasting failure over two calls records one event; changed bytes and a new registration try again`; `AC7: … > a sink whose record throws is swallowed: role.md stays, no backup or temporary file, and the call returns`; `AC7: … > a sink whose transaction throws is swallowed the same way`; `AC7: … > a COMMIT that fails after the rename still records the upgrade (role.md holds the new template), and the backup stays`; `AC7: only a top-level call upgrades (never inside an open store transaction) > a call inside an outer transaction that rolls back leaves role.md; a later top-level call upgrades with its event`; `AC7: only a top-level call upgrades … > a sink whose inTransaction throws upgrades nothing and records nothing (fail closed)`; `AC8: no sink, no upgrade; startKernel registers the sink and unregisters it before the store closes > with no sink registered, an exact past copy is not written and no event exists`; `AC8: … > a sink registered for another data dir does not upgrade this one, and an unregistered sink upgrades nothing`; `AC8: … > a stale unregister does not remove a newer registration`; `AC8: … > a running kernel replaces an exact past copy with its own event; after stop, nothing upgrades` | pass |
| The result is visible to the owner | the backup's `.md` name (`role.bak-<stamp>-<hex>.md`), listed by `GET /memory` (`kernel/src/gui/memory.ts`); the `old_manual` mark on an edited Wright `role.md` (`oldManualOf`, `carriesOldManual`); the `wright_role_upgraded` event in the audit log | `AC1: … > the backup is a .md file GET /memory lists, so the owner can open it`; `AC3: … > an edited copy (%s) is left byte for byte …, and marked old_manual`; `AC3: … > a role.md with only %s of the old headings is marked`; `AC3: … > a role.md with none of the headings, the current template, and every other file keep the exact {path, size, modified} shape`; `AC5: … > a crew role.md that is an exact past Wright template is left alone, with no event and no mark`. The Memory screen's note line (AC4): `app/src/screens/memory/MemoryScreen.test.tsx` > `the tree > wa-b: a file whose entry carries old_manual shows one plain note that the old rule sections can go; no other file does`. The two audit sentences (AC9): `app/src/screens/budget/audit-sentences.test.ts` > `the sentences > wa-b: the role upgrade's kinds come from ROLE_UPGRADE_AUDIT_KINDS, and each reads as one sentence naming the file`, with `the sentence table covers every kind the kernel writes > every kind has an entry` | pass (kernel and app) |

Kernel suite (2026-11-28, this branch's working tree, kernel subtask): `npx tsc -p tsconfig.json` clean; `npm test` reported 160 files passed and 1 skipped, 5532 tests passed and 23 skipped (`kernel/test/brain-role-upgrade.test.ts`: 42 tests). An earlier full run that day failed one unrelated test, `run-confinement.test.ts` > "drops a forged entry naming an EXISTING directory…", with an `ENOENT` on a temporary git worktree file (the same intermittent failure the wa-c evidence records); that file then passed three times on its own, and the full run above passed. App suite (2026-11-28, this branch with the app side in): `cd app && npm run typecheck` clean; `npm test` reported 110 files passed, 3447 tests passed, among them the two wa-b tests named above and `audit-sentences.test.ts` > `every kind has an entry`, which scans `kernel/src` and so sees `ROLE_UPGRADE_AUDIT_KINDS`.
