# wa-c: an unedited proposed tool list gets the current proposed tools (evidence)

**What this is.** Validation 3 (the running system) of the wa-c brief, run read-only against the owner's install, plus the owner conditions table (AC10). The check read the owner's files only: it never started a kernel against the owner's data dir, never opened its store and never wrote to it.

## Validation 3: the owner's `wright.json`, read-only

Run on 2026-11-28 at the branch's working tree (base `37d46b7e`).

**Finding the data dir.** The kernel resolves it with `resolveDataDir` (`kernel/src/store/store.ts`): `STUDIO_DATA_DIR`, else `~/.loomwright-studio`. `STUDIO_DATA_DIR` was unset in the shell, and the owner's launchd job (`~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`) sets `STUDIO_DATA_DIR` to `~/.loomwright-studio`, so both point at the same dir. The launchd kernel runs from `~/.loomwright-studio/app/0.0.0/dist/daemon.js`, not from this checkout, so building this checkout did not touch it.

**Commands run:**

```sh
echo "STUDIO_DATA_DIR=${STUDIO_DATA_DIR:-<unset>}"
plutil -p ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist | grep -iE "STUDIO_DATA_DIR|ProgramArguments"
ls -la ~/.loomwright-studio/config/agents/
cd kernel && node scripts/build.mjs            # this checkout's kernel into kernel/dist (gitignored), removed afterwards
node <scratch>/validation3.mjs "$PWD/dist" ~/.loomwright-studio
rm -rf dist
```

`validation3.mjs` (a scratch script, not committed) imports the built `agents/past-tool-lists.js`, `brain/settings.js`, `gui/settings.js` and the shipped catalogue. It reads the file's sha256, size and mtime, then reads the policy with `readWrightToolPolicy` and computes `isPastProposedList` and `proposedToolsMissing`. It then calls the real `GET /settings` handler (`settingsRoutes[0].handler`) with a store stand-in that carries only `dataDir` (no database is opened) and the shipped catalogue. Finally it reads the sha256, size, mtime and the `wright.json*` file list again.

**Observed:**

| What | Value |
|---|---|
| File | `~/.loomwright-studio/config/agents/wright.json` (1183 bytes, mtime 2026-10-29T14:10:25.988Z) |
| `tool_policy.status` | `"proposed"` |
| Tool count | 25 (25 distinct) |
| Equals a recorded past list (as a set) | yes: the 25-tool list (not the 15 or the 21) |
| Equals the current `PROPOSED_ALLOWED_TOOLS` (as a set) | yes |
| `isPastProposedList` (would upgrade) | `false`: the 25-tool list is the current proposal, so there is nothing to add |
| `proposedToolsMissing` | `[]` |
| `GET /settings` handler status | 200 |
| `wright_tools` it answers | `{"status": "proposed", "missing": []}` |
| sha256 before and after | `144d381e2d33a1aa54d267d297139878f3afea06f4f72d05bf4851e581790a83` (unchanged; size and mtime unchanged too) |
| `wright.json*` files before and after | `["wright.json"]` (no backup made) |

Result: unedited, current, nothing missing, no write. This matches the expected result for this base.

**The upgrade half can't be observed yet.** At this base the owner's 25-tool list equals the current proposal. The upgrade half (the current list written to the owner's file, and a backup of the 25-tool bytes beside it) can be seen only after wa-e or wa-f grows `PROPOSED_ALLOWED_TOOLS`. At that point the 25-tool list becomes a past list that is no longer current. Until then the upgrade is proven by the tests below, with the real recorded 15- and 21-tool lists.

Verdict: PASS for Validation 3 (current-list half; upgrade half pending wa-e/wa-f)

**Carried from wa-a (PR #316):** the catalogue wiring for the playbook prompts (`playbookPrompt` and `crewPlaybookPrompt`) is left to wa-d. A Wright playbook session reads its tools through `readWrightSettings`, so it runs with the upgraded list as soon as this lands.

## Owner conditions

The owner's conditions (LP-SAVE-NOTE, 2026-11-28), each with the tests that prove it. Result: the run of `cd kernel && npm test` on 2026-11-28 at this branch's working tree, which reported 159 files passed and 1 skipped, and 5483 tests passed and 23 skipped. Every test named below passed in it. (One earlier run of the suite that day failed one unrelated test, `run-confinement.test.ts` > "drops a forged entry naming an EXISTING directory…", with an `ENOENT` on a temporary git worktree file. That test passed 3 of 3 times on its own and in the full run above.) All the kernel test names below are in `kernel/test/agents-settings-upgrade.test.ts` except those marked `gui-settings.test.ts` (`kernel/test/gui-settings.test.ts`).

| Condition | Test (file > describe > name) | Result |
|---|---|---|
| Only a list that is provably unedited (still equal to a shipped proposal) is upgraded | `the recorded past lists > are the 15-, 21- and 25-tool lists, each a subset of the next and of PROPOSED_ALLOWED_TOOLS (no upgrade can remove a tool)`; `the recorded past lists > matches a past list as a set, never the current list, never a list one tool short or one tool over`; `AC1: … > past %s-tool list (shuffled and with a duplicate) upgrades to the current list, with a backup and one event (none when it already is the current list)` (15, 21, 25); `AC5: … > a schema-invalid (permission_mode 7) file returns settings_invalid with its bytes unchanged, no backup and no event` | pass |
| Any owner edit leaves the list untouched | `AC3: an owner's list or status is never written > an edited list or a non-proposed status (%s) is left byte for byte, with no event` (one tool removed, one tool added, status owner, status absent, status Proposed); `AC7b: an owner's edit during the upgrade wins > an owner's edit between the read and the rename wins` | pass |
| Every upgrade writes an audit event and makes a backup | `AC1: … > past %s-tool list (shuffled and with a duplicate) upgrades to the current list, with a backup and one event (none when it already is the current list)`; `AC3: … > with no sink registered, nothing is upgraded`; `AC7: a failed step keeps the old file > a failed write (an injected %s failure) keeps the old bytes, returns the old list and records wright_tool_policy_upgrade_failed` (backup, write, rename); `startKernel registers the audit sink over its store, and unregisters it before the store closes > a running kernel upgrades an unedited proposed list with its own event; after stop, nothing upgrades` | pass |
| Settings shows the result | `gui-settings.test.ts`: `GET /settings wright_tools (wa-c) > wright_tools.missing names the catalogue job and purpose of each missing proposed tool; GET /settings writes nothing`; `GET /settings wright_tools (wa-c) > an absent wright.json is null and stays absent`; `GET /settings > answers exactly the contract's keys, from the provider, the store and the reader, and never the token value`. The screen half (AC4, `app/src/screens/settings/tool-policy.test.tsx`) is Subtask 2's and was not part of this run. | pass (kernel half) |
| Nothing widens grants for an edited or owner-set list | `AC3: … > an edited list or a non-proposed status (%s) is left byte for byte, with no event`; `AC6: a crew member's file is never upgraded > a crew file holding a past list is not written`; `the recorded past lists > are the 15-, 21- and 25-tool lists, each a subset of the next and of PROPOSED_ALLOWED_TOOLS (no upgrade can remove a tool)` | pass |

Each kernel pin in the brief's "Pin mutations" table was also applied one at a time to the code it protects, with its test file re-run. All 13 kernel mutations failed their pin: none survived.
