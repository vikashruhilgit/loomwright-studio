# Supervisor Job: wa-c — an unedited proposed tool list gets the current proposed tools

## Environment
- **Project:** starfish-clone (Loomwright Studio checkout)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/wright-aware/2026-11-21-230200-wa-c-an-unedited-proposed-tool-list-gets-the-current-proposed-tools.md
- **Base commit:** 37d46b7ebcd95b562491fbfdb89c715328d4bae0

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and React app (vitest); no new dependency (`node:fs`, zod and the existing catalogue only). |
| 2 | Dependency Availability | GO | Nothing new to add. |
| 3 | Architecture Fit | CAUTION | The shared reader `readAgentSettings` takes only `dataDir` and has no store, so it cannot write an audit event by itself. This plan adds a per-data-dir audit hook that `startKernel` registers (see Design decisions). |
| 4 | Scope vs Supervisor Capability | CAUTION | 15 files (10 modify, 5 create) is more than one worker's 12-file bound, so the work is split `context-bound` into kernel, then app. |
| 5 | Hard Blockers | CAUTION | Needs files outside the requirement's Touches (`kernel/src/kernel.ts`, `kernel/test/gui-settings.test.ts`, `app/src/api/contract.ts`, `app/src/screens/budget/audit-sentences.ts`, `app/src/screens/settings/model.test.ts`, `app/src/screens/settings/tool-policy.ts`, `app/src/screens/settings/tool-policy.test.tsx`, `docs/architecture/brain.md`, `docs/evidence/wa-c-proposed-tools-upgrade.md`). The owner is asked once at Phase 6 (`LP-SCOPE`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** When the kernel reads Wright's settings, a `wright.json` whose `tool_policy.status` is `proposed` and whose `allowedTools` is, as a set, exactly one of the kernel's past proposed lists is rewritten to the current `PROPOSED_ALLOWED_TOOLS`, with a backup and one audit event. Any other list is never written, and `GET /settings` plus the Settings screen name the proposed tools that list lacks, in plain words from the tool catalogue.

**Problem Statement:**
The owner needs new kernel abilities (wa-e's Studio read tools, wa-f's lesson proposals) to reach an existing Wright without the kernel ever overriding a tool policy the owner set.
Currently `wright.json` is created once (`flag: "wx"`) and never rewritten, so an existing install keeps the list it was first given, even though `PROPOSED_ALLOWED_TOOLS` in `kernel/src/brain/settings.ts` grows. On the owner's install the list has 25 tools (checked 2026-11-21). This causes wa-e and wa-f to deliver nothing to an existing Wright.
Success looks like this: an unedited proposed list follows the current proposal (with a backup and an audit event), an edited or non-`proposed` list is never touched, and the owner sees, by job, which proposed tools their list lacks.

**Past proposed lists, recovered from git history of `kernel/src/brain/settings.ts` (`git log -- kernel/src/brain/settings.ts`):**
- 15 tools at `181849a6` (also `1de480ed`, `450e500c`): the 10 task, trigger, notify, approval and Loomwright tools plus `kernel_schedule_wakeup`, `kernel_request_stop`, `Read`, `Glob`, `Grep`.
- 21 tools at `bc6d53f6`: the 15 plus the six `kernel_playbook_*` tools.
- 25 tools at `845564ce` through `b4450b80` (the current list at base): the 21 plus the four `kernel_agent_*` tools.
Each list is a subset of the next (checked with `comm -23` on the sorted lists: 0 lines each), so writing the current list never removes a tool.

**Carried from wa-a (PR #316): what this plan covers and what it cannot.** The follow-up, "playbookPrompt and crewPlaybookPrompt are not wired to the tool catalogue" (`docs/architecture/brain.md` "Known limits": "The playbook prompts do not get the catalogue yet"), is a prompt-builder change in `kernel/src/playbooks/runs.ts`. That file is outside this item's Touches and outside its job (the settings file). The requirement routes it to this item "with wa-d", and wa-d ("every prompt says what is in Studio right now") is the item that changes the prompt builders, so this plan leaves the wiring to wa-d and leaves the Known-limits line in place. This plan covers only the settings side. A Wright playbook session reads its tools through `readWrightSettings` (`kernel/src/playbooks/runs.ts`: `settings = readWrightSettings(dataDir);`), so it runs with the upgraded list as soon as this lands. The PR body must say this in one line.

## Design decisions
- decision: where the kernel's past proposed lists, and the upgrade logic that reads them, live
  chosen: a new leaf module `kernel/src/agents/past-tool-lists.ts`. It holds the three recorded lists, the pure match (`isPastProposedList`), the missing-tools reader and the upgrade write, imports only `node:*` and `../brain/settings.js`, and is called by `readAgentSettings`.
  rejected: append the lists and the write to `kernel/src/agents/settings.ts` — blast radius partial: it would push the 493-line reader past the 500-line Module layout threshold.
  rejected: add the past lists to `kernel/src/brain/settings.ts` beside `PROPOSED_ALLOWED_TOOLS` — blast radius no: the requirement fixes that file as read-only ("`kernel/src/brain/settings.ts` is read, not changed").
  rejected: write with the existing `writeFileAtomic` (`kernel/src/tools/handoff.ts`) — reversibility partial: it renames at once, so the rename cannot sit inside the store transaction after the re-read, as the roster `set` pattern this mirrors requires.
  evidence: `wc -l kernel/src/agents/settings.ts` → 493; requirement Assumptions: "the upgrade lives in the shared reader (`kernel/src/agents/settings.ts`)… so `kernel/src/brain/settings.ts` is read, not changed"; Touches names `kernel/src/agents/past-tool-lists.ts`.
  revisit when: a fourth list is recorded and the module passes 500 lines, or a crew upgrade is ever wanted (a non-goal now).
  status: confirmed
- decision: how the shared reader, which only has `dataDir`, records the upgrade's audit event
  chosen: an audit hook kept per data dir. `past-tool-lists.ts` exports `registerProposedToolsAudit(dataDir, sink): () => void`, and `startKernel` (`kernel/src/kernel.ts`) registers a sink over its open store right after the store opens and unregisters it in `teardown` before `store.close()`. The upgrade runs only when a sink is registered for that data dir. With none (the `studio` CLI, a test without the kernel), the file is left as it is, so an upgrade is never unaudited.
  rejected: pass a recorder through `ReadAgentSettingsOptions` at each call site — blast radius no: about 25 `readAgentSettings` / `readWrightSettings` call sites in `kernel/src/brain`, `playbooks`, `automate`, `agents` and `gui` would all change.
  rejected: return an `upgraded` field in the reader's result for callers to log — blast radius no, and a caller that ignores it leaves the widening unaudited (the D5 safety concern the requirement's Risks names).
  evidence: `grep -rn "readWrightSettings(\|readAgentSettings(" kernel/src` → about 25 call sites; `kernel/src/kernel.ts` holds `const store = (deps.openStore ?? ((dir: string) => new Store({ dataDir: dir })))(dataDir);` and `await step(() => store.close());`.
  revisit when: the reader gains a store parameter for another reason, or a second kernel-initiated settings write needs the same hook.
  status: confirmed
- decision: where the app's parse and plain-words lines for `wright_tools` live
  chosen: a new plain-TypeScript module `app/src/screens/settings/tool-policy.ts`, with no React and no `.tsx` import. It holds the parse, the words and the block's test ids, and `model.ts` adds only the view field and one call.
  rejected: append to `app/src/screens/settings/model.ts` — blast radius partial: at 496 lines it would pass the 500-line Module layout threshold.
  rejected: put it in `app/src/screens/settings/SettingsScreen.tsx` — test cost no: the e2e project (`tsconfig.node.json`, no `jsx`) imports `SETTINGS_TEST_IDS` and cannot import a `.tsx` file.
  evidence: `wc -l app/src/screens/settings/model.ts` → 496; the `model.ts` header: "no import that reaches a `.tsx` file, so the e2e project (`tsconfig.node.json`, no `jsx`) can import `SETTINGS_TEST_IDS`".
  revisit when: `model.ts` is split for another reason.
  status: confirmed

## Acceptance Criteria
- [ ] AC1. Given `wright.json` has `tool_policy.status` `"proposed"` and its `allowedTools` equals, as a set (order and duplicates ignored), one of the past proposed lists recorded in `kernel/src/agents/past-tool-lists.ts`, and the kernel has an audit sink registered for that data dir, when the kernel reads Wright's settings (`readAgentSettings(dataDir, "wright")`, and so `readWrightSettings`), then: the old bytes are copied to a backup beside the file (`wright.json.bak-<UTC stamp>-<random hex>`, exclusive create, mode 0600, so two reads in the same millisecond never collide); the file is rewritten through a temporary sibling and a rename with `allowedTools` set to the current `PROPOSED_ALLOWED_TOOLS` and every other key, an unknown one included, keeping its value; exactly one `wright_tool_policy_upgraded` event is recorded with `{file, backup, added}`, where `added` is the tools added; and the returned settings carry the new list.
- [ ] AC2. Given the upgrade ran, when Wright's settings are read again, then nothing is written, no backup is made and no event is recorded (the file now equals the current list, the newest recorded past list).
- [ ] AC3. Given a list the owner changed (any set difference from every recorded past list) or a `status` other than `"proposed"` (absent included), when Wright's settings are read, then the file's bytes are unchanged and no backup or event is made. `GET /settings` answers `wright_tools: {status, missing: [{name, job, purpose}]}`, where `missing` lists the current proposed tools the list lacks, each with its catalogue job label and purpose line (`null` for a tool the catalogue does not list, for example `Read`). `GET /settings` itself never writes and never creates `wright.json`: `wright_tools` is `null` when the file is absent or is not a readable settings object.
- [ ] AC4. Given `GET /settings` names missing tools, when the Settings screen renders, then it shows a "Wright's tools" block listing each missing tool in plain words (its job label and purpose line, or the tool name when it has no catalogue entry) and the file to add them to, every kernel string rendered as a React text child through `printable`. With `missing` empty, or `wright_tools` absent (an older kernel) or `null`, the block shows no list.
- [ ] AC5. Given a malformed `wright.json` (not JSON, over 64 KiB, or not the schema's shape), when it is read, then the existing `settings_invalid` refusal is returned unchanged and nothing is written, backed up or recorded.
- [ ] AC6. Given a crew member's settings file whose `tool_policy` is `{status: "proposed", allowedTools: <a recorded past list>}`, when `readAgentSettings(dataDir, "<crew id>")` reads it, then it is never written and no event is recorded: a crew member's tools come only from its approved charter.
- [ ] AC7. Given the backup, the temporary write or the rename fails, when the upgrade runs, then the old `wright.json` stays in place byte for byte, the read returns the old list (the session runs with it), no `wright_tool_policy_upgraded` event is recorded, one `wright_tool_policy_upgrade_failed` event `{file, step, code}` is recorded, and the read never throws for it. A sink that itself throws is swallowed, so the read still returns.
- [ ] AC7b. Given the file's bytes change between the upgrade's read and its rename (an owner's edit), when the re-read inside the sink's transaction sees the change, then there is no rename and no `wright_tool_policy_upgraded` event, the temporary sibling is removed (the backup of the old bytes stays), and the read returns the list it parsed before the change (the next read sees the owner's edit and leaves it alone, because it no longer matches a past list).
- [ ] AC8. Given the app's audit log, then `app/src/screens/budget/audit-sentences.ts` has a sentence for `wright_tool_policy_upgraded` (naming how many tools were added and that a backup was kept) and for `wright_tool_policy_upgrade_failed`, so `audit-sentences.test.ts` ("the sentence table covers every kind the kernel writes") stays green.
- [ ] AC9. Given the merged change, when Validation 3 (running system) is run read-only against the owner's install, then a committed evidence file `docs/evidence/wa-c-proposed-tools-upgrade.md` contains: the commands run; the owner's `wright.json` `tool_policy.status`, its tool count, and whether its list equals a recorded past list; the `wright_tools` that `GET /settings` would answer, computed with `proposedToolsMissing`; the line `Verdict: PASS for Validation 3 (current-list half; upgrade half pending wa-e/wa-f)` at column 0; and the one-line wa-a carry-over statement from `## Task` (the catalogue wiring for the playbook prompts is left to wa-d). At base, the owner's 25-tool list equals the current proposal, so the expected result is "unedited, current, nothing missing, no write". The evidence file must say that the upgrade half (current list written, 25-tool backup) can be observed only after wa-e or wa-f grows `PROPOSED_ALLOWED_TOOLS`. The PR body links to the file. The check reads the owner's files and never starts a kernel against the owner's data dir.

## Owner conditions (binding)
Given by the owner at the Launch Pad save gate (LP-SAVE-NOTE, 2026-11-28), verbatim:
> because this touches the safety-kernel settings reader, the build must keep these properties, and the PR body must show each one: only a list that is provably unedited (still equal to a shipped proposal) is upgraded; any owner edit leaves the list untouched; every upgrade writes an audit event and makes a backup; Settings shows the result. Nothing widens grants for an edited or owner-set list.

Each condition is already an acceptance criterion:
- only a provably unedited list (set-equal to a shipped proposal, `status: "proposed"`) is upgraded → AC1, plus the subset and set-equality pins;
- any owner edit leaves the list untouched → AC3, AC7b;
- every upgrade writes an audit event and makes a backup → AC1, AC7, plus the no-sink-no-upgrade pin;
- Settings shows the result → AC3, AC4;
- nothing widens grants for an edited or owner-set list → AC3, AC6.

This section was added after the final Plan Review (attempt 3/3), on the owner's instruction; it adds no new scope.

- [ ] AC10. Given the merged change, then `docs/evidence/wa-c-proposed-tools-upgrade.md` has an "Owner conditions" table: one row per condition above, naming the test file and the test name that proves it, and the result of the run. The PR body shows the five conditions with a link to that table. The table in the committed file is the evidence; the PR body only links to it.

## Scope widening
- app/src/api/contract.ts
- app/src/screens/budget/audit-sentences.ts
- app/src/screens/settings/model.test.ts
- app/src/screens/settings/tool-policy.test.tsx
- app/src/screens/settings/tool-policy.ts
- docs/architecture/brain.md
- docs/evidence/wa-c-proposed-tools-upgrade.md
- kernel/src/kernel.ts
- kernel/test/gui-settings.test.ts
- accepted: LP-SCOPE 2026-11-28

## Touched-file invariants

> Grounded at base `37d46b7ebcd95b562491fbfdb89c715328d4bae0`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/agents/settings.ts`** — keep: the create-once first run `writeFileSync(file, defaultWrightSettingsJson(), { flag: "wx", mode: 0o600 });` (a fresh file already holds the current list and is never upgraded); the size guard `if (statSync(file).size > MAX_SETTINGS_BYTES)` and its after-read twin `if (buf.length > MAX_SETTINGS_BYTES)` (the rewrite must also stay under the limit); the Wright-only branch `const isWright = id === WRIGHT_ID;` (the upgrade sits only under it, which is AC6); the refusal-first order, so no write happens unless the schema parse, the `never`/`workspaces` refusal and the `connectors` read have all passed (AC5). The upgrade runs before the `model_unset` check, so a file with no model is still upgraded. reuse: read the raw parsed JSON (`json = JSON.parse(raw);`) for the rewrite, never the zod-parsed `s`, because `wrightSchema` drops unknown keys and the rewrite must keep them. mirror: the header comment ("Wright's file is created once… A malformed file is a refusal naming it… never a rewrite") must be updated to state the one kernel rewrite. pinned by: `kernel/test/agents-wright-settings.test.ts` and `kernel/test/agents-foundation.test.ts` (`expect(readdirSync(join(dataDir, "config", "agents"))).toEqual(["wright.json"]);`). These write the current list, so they stay green. A backup must appear only when an upgrade ran.
- **`kernel/src/gui/settings.ts`** — keep: "The route is read-only: nothing is written." (the new field is read with a raw file read, never through `readAgentSettings`, which creates and would upgrade); "The body is built field by field: never a token…" (the new `wright_tools` is built the same way); the refusal shape `503 {"error":"settings_unavailable","reason":...}` is unchanged, and an unreadable `wright.json` becomes `wright_tools: null`, never a 503. reuse: the catalogue arrives on the request (`readonly catalogue?: ToolCatalogue;` in `kernel/src/features/contribution.ts`) and is read with `catalogueTool(catalogue, name)` from `kernel/src/features/catalogue.ts`; with no catalogue, `job` and `purpose` are `null`. mirror: `app/src/api/contract.ts` `export interface SettingsResponse {` (the header says "The shape mirrors `app/src/api/contract.ts` (`SettingsResponse`, `NotifierKind`)"). pinned by: `kernel/test/gui-settings.test.ts` `expect(Object.keys(res.body).sort()).toEqual(["data_dir", "loomwright", "notifier", "pending_provider", "provider", "provider_source", "providers"]);`, which must gain `"wright_tools"`.
- **`kernel/src/kernel.ts`** — keep: `teardown` steps in their order, with the sink unregistered by its own `step` before `await step(() => store.close());`, so no sink outlives its store (vitest runs many kernels in one process). reuse: the store opened at `const store = (deps.openStore ?? ((dir: string) => new Store({ dataDir: dir })))(dataDir);`, plus the existing `appendEvent`-style insert and `store.transaction` (as `kernel/src/agents/roster.ts` does with `renameSync(temp, file);` inside the transaction).
- **`kernel/src/agents/past-tool-lists.ts`** (create) — mirror: the rename-last pattern of `kernel/src/agents/roster.ts` `set` ("// Re-read just before the rename: an owner's hand edit since the first read wins."): write the temporary sibling, then inside the sink's transaction re-read the file, and if its bytes changed since the read (an owner's edit), abort with no event; otherwise append `wright_tool_policy_upgraded` and rename last. Import cycle: `past-tool-lists.ts` imports `../brain/settings.js`, which imports `../agents/settings.js`, which imports `past-tool-lists.ts`. The cycle is safe only at call time, so `PROPOSED_ALLOWED_TOOLS` is read only inside functions, never at module load (no top-level freeze, union or copy of it). The audit kinds go on ONE line as `export const PROPOSED_TOOLS_AUDIT_KINDS = ["wright_tool_policy_upgraded", "wright_tool_policy_upgrade_failed"] as const;`, the form `audit-sentences.test.ts`'s scan reads (`/export const [A-Z_]*AUDIT_KINDS = \[([^\]]*)\]/`).
- **`app/src/screens/settings/model.ts`** — keep: `parseSettings` builds the view from known fields only, and every kernel string passes through `printable` (`import { printable } from "../approvals/printable";`); the module imports no `.tsx` (the e2e project imports `SETTINGS_TEST_IDS`); a malformed `wright_tools` reads as `null`, never as a failed reply (`export function viewReply(reply: Reply<SettingsResponse>): Reply<SettingsView> {` stays as it is). reuse: the parse lives in the new `app/src/screens/settings/tool-policy.ts`, and `model.ts` adds only the view field and one call. pinned by: `app/src/screens/settings/model.test.ts` `describe("parseSettings: the contract's known fields, nothing else"`, whose `toEqual` gains `wrightTools: null`.
- **`app/src/screens/settings/SettingsScreen.tsx`** — keep: sections use `className="settings-blk"` with an `aria-labelledby` heading, and test ids come from `SETTINGS_TEST_IDS` (`data-testid={IDS.app}`). The new ids are declared in `tool-policy.ts` and spread into `SETTINGS_TEST_IDS`, so `model.ts` stays under 500 lines. Placement: the "Wright's tools" block sits between the Kernel section and "This app". The file path is plain text, never a link and never a copy button (no reuse of `IDS.copy`). pinned by: `app/src/screens/settings/SettingsScreen.test.tsx` (`expect(container.querySelectorAll("a[href]")).toHaveLength(0)`; the region order whose last two are `"settings-h-threads", "settings-h-workspaces"`; the copy-button count `expect(actions).toHaveLength(3 + 1 + 2 + 3)`) and `app/src/screens/settings/ThreadsSection.test.tsx` (Threads directly after "This app"). These stay unchanged and must stay green.
- **`app/src/api/contract.ts`** — keep: the convention that a new field is optional and "Absent from an older kernel" (as `readonly pending_provider?: string | null;`).
- **`app/src/screens/budget/audit-sentences.ts`** — keep: one entry per kind in the table's form (`auth_api_key_set: () => "You stored an API key in the Keychain.",`); payload values pass through the table's own guards, never raw. pinned by: `app/src/screens/budget/audit-sentences.test.ts` ("the sentence table covers every kind the kernel writes"), both directions.

## Closed enumerations touched

> Sibling grep at base `37d46b7ebcd95b562491fbfdb89c715328d4bae0`: `git grep -nF 'agent_settings_set' -- . ':!CHANGELOG.md'` → about 70 hits in 28 files (tests, fixtures, docs and evidence, plus the closed lists below).

- **`wright_tool_policy_upgraded`, `wright_tool_policy_upgrade_failed`** (sibling: `agent_settings_set`) — must be named in:
  - `kernel/src/agents/past-tool-lists.ts` — the new `PROPOSED_TOOLS_AUDIT_KINDS` (a sibling of `export const AGENT_AUDIT_KINDS = [` in `kernel/src/agents/charter-files.ts`) — create.
  - `app/src/screens/budget/audit-sentences.ts` — the sentence table (`agent_settings_set: (p, r) => {`), which its test forces to cover every kernel kind — extend.
  - `kernel/src/agents/charter-files.ts` `AGENT_AUDIT_KINDS` — no change: it is the crew charter's kinds, pinned exactly in `kernel/test/agents-roster.test.ts` (`expect(AGENT_AUDIT_KINDS).toEqual([`); a kernel-initiated Wright settings write is not a roster action.
  - `kernel/src/console/threads.ts` (`agent_settings_set: "agent",`) — no change: an opt-in list ("any other kind is never a card"), and the upgrade is not a crew-thread card.
  - `app/e2e/fixtures/team.ts`, `docs/architecture/agents.md`, `docs/architecture/approvals.md`, `docs/architecture/threads.md`, `docs/evidence/*`, kernel and app tests — no change: they emit or describe `agent_settings_set` and are not lists of every kind.
- **`wright_tools`** (a new `GET /settings` key; sibling `pending_provider`) — must be named in:
  - `kernel/test/gui-settings.test.ts` — the exact sorted key list — extend.
  - `app/src/api/contract.ts` `SettingsResponse` — extend (optional field).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-settings-upgrade.test.ts` — past 15-, 21- and 25-tool lists (shuffled and with a duplicate) upgrade to the current list, with a backup and one event | in `kernel/src/agents/past-tool-lists.ts`, drop the 21-tool list from the recorded past lists → the 21-list case is no longer upgraded |
| `kernel/test/agents-settings-upgrade.test.ts` — the second read writes nothing and records no event | make the match skip its "already the current list" check, so the current list is rewritten again → a second backup and event appear |
| `kernel/test/agents-settings-upgrade.test.ts` — an edited list (one tool removed, or one added) and `status: "owner"` are left byte for byte, with no event | change the set-equality match to "is a subset of a past list" → the one-removed case gets upgraded |
| `kernel/test/agents-settings-upgrade.test.ts` — a crew file holding a past list is not written | remove the `isWright` guard around the upgrade call in `kernel/src/agents/settings.ts` → the crew file is rewritten |
| `kernel/test/agents-settings-upgrade.test.ts` — an unknown top-level key and `limits` survive the rewrite | build the rewrite from the zod-parsed settings instead of the raw JSON → the unknown key disappears |
| `kernel/test/agents-settings-upgrade.test.ts` — a failed write (an injected write or rename failure) keeps the old bytes, returns the old list and records `wright_tool_policy_upgrade_failed` | return the new list even when the write failed → the returned `allowedTools` is the new list |
| `kernel/test/agents-settings-upgrade.test.ts` — with no sink registered, nothing is upgraded | make the upgrade run with no sink → the file is rewritten with no event |
| `kernel/test/agents-settings-upgrade.test.ts` — every recorded past list is a subset of `PROPOSED_ALLOWED_TOOLS` (no upgrade can remove a tool) | add a tool absent from `PROPOSED_ALLOWED_TOOLS` to the 15-tool past list in `kernel/src/agents/past-tool-lists.ts` → the subset check fails |
| `kernel/test/gui-settings.test.ts` — `wright_tools.missing` names the catalogue job and purpose of each missing proposed tool, `GET /settings` writes nothing, and an absent file stays absent | read the file through `readAgentSettings` in `kernel/src/gui/settings.ts` → an absent `wright.json` is created |
| `app/src/screens/settings/tool-policy.test.tsx` — the screen lists each missing tool by its job label and purpose | render `name` instead of `purpose` for a catalogued tool → the plain-words line is missing |
| `app/src/screens/settings/tool-policy.test.tsx` — no list is rendered when `missing` is empty, `wright_tools` is absent, or it is `null` | drop the empty-list guard in the block → an empty list heading renders |
| `kernel/test/gui-settings.test.ts` — the exact sorted key list now includes `"wright_tools"` | delete the `wright_tools:` field from the body in `kernel/src/gui/settings.ts` → the key list is short one |
| `app/src/screens/settings/model.test.ts` — `parseSettings(body())` equals the known fields with `wrightTools: null`, and a malformed `wright_tools` is `null`, not a failed reply | make the `wright_tools` parse return undefined on a malformed value, so `parseSettings` fails → `viewReply` turns the reply `failed` |
| `kernel/test/agents-settings-upgrade.test.ts` — a sink that throws is swallowed and the read returns | remove the try/catch around the sink call in `kernel/src/agents/past-tool-lists.ts` → `readAgentSettings` throws |
| `kernel/test/agents-settings-upgrade.test.ts` — a schema-invalid file (valid JSON, `status: "proposed"`, a recorded past list, but a wrong-typed field such as `"permission_mode": 7`) and a non-JSON file both return `settings_invalid` with their bytes unchanged, no backup and no event (AC5) | in `kernel/src/agents/settings.ts`, move the upgrade call above the `wrightSchema` parse → the schema-invalid file is rewritten and a backup appears |
| `kernel/test/agents-settings-upgrade.test.ts` — an owner's edit between the read and the rename wins (AC7b) | drop the re-read before the rename → the owner's edit is overwritten |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: past lists, the audited upgrade in the shared reader, `GET /settings` `wright_tools`, docs and evidence (gate: `cd kernel && npm test` only; `cd app && npm test` is expected red on `audit-sentences.test.ts` until Subtask 2 adds the two sentences) | AC1, AC2, AC3 (kernel half), AC5, AC6, AC7, AC7b, AC9, AC10 | 5 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: contract field, Settings "Wright's tools" block, audit sentences | AC3 (contract), AC4, AC8 | 5 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel (subtask 1) | `kernel/src/agents/settings.ts` (493: one guarded call to the upgrade, with the header comment updated; the upgrade itself lives in the new module), `kernel/src/gui/settings.ts` (251), `kernel/src/kernel.ts` (614: one register call and one teardown step, the only place holding both the store and the data dir at start), `kernel/test/gui-settings.test.ts` (183), `docs/architecture/brain.md` (414: "create-if-absent, so an existing data dir keeps its old policy" and "It is never rewritten" become the one audited rewrite; "Known limits" gains a line saying the header comment of `kernel/src/brain/settings.ts` ("never overwritten") is now stale and left unchanged because the requirement keeps that file read-only) | `kernel/src/agents/past-tool-lists.ts` (past lists, match, missing-tools reader, upgrade write, sink registry, `PROPOSED_TOOLS_AUDIT_KINDS`), `kernel/test/agents-settings-upgrade.test.ts`, `docs/evidence/wa-c-proposed-tools-upgrade.md` | HIGH |
| app (subtask 2) | `app/src/api/contract.ts` (2164: the single contract authority, where `SettingsResponse` lives), `app/src/screens/budget/audit-sentences.ts` (466), `app/src/screens/settings/model.ts` (496: only the view field, one import, one spread of the block's test ids and one parse call; the parse and the ids live in the new module so the file stays under 500), `app/src/screens/settings/model.test.ts` (341), `app/src/screens/settings/SettingsScreen.tsx` (262) | `app/src/screens/settings/tool-policy.ts` (parse and plain-words lines), `app/src/screens/settings/tool-policy.test.tsx` (parse and screen render; a new file because `SettingsScreen.test.tsx` is 732 lines, past the threshold) | HIGH (screen layout MEDIUM) |

`app/src/screens/settings/SettingsScreen.test.tsx` and `kernel/src/brain/settings.ts` (both named by the requirement) are read and not changed.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/agents/past-tool-lists.ts"}
  - {kind: "symbol", path: "kernel/src/agents/past-tool-lists.ts", name: "PROPOSED_TOOLS_AUDIT_KINDS"}
  - {kind: "symbol", path: "kernel/src/agents/past-tool-lists.ts", name: "registerProposedToolsAudit"}
  - {kind: "symbol", path: "kernel/src/agents/past-tool-lists.ts", name: "proposedToolsMissing"}
  - {kind: "symbol", path: "kernel/src/gui/settings.ts", name: "wright_tools"}
  - {kind: "file", path: "kernel/test/agents-settings-upgrade.test.ts"}
  - {kind: "file", path: "docs/evidence/wa-c-proposed-tools-upgrade.md"}
requires: []
lanes:
  - "kernel/src/agents/past-tool-lists.ts"
  - "kernel/src/agents/settings.ts"
  - "kernel/src/gui/settings.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/agents-settings-upgrade.test.ts"
  - "kernel/test/gui-settings.test.ts"
  - "docs/architecture/brain.md"
  - "docs/evidence/wa-c-proposed-tools-upgrade.md"
external_requires:
  - "read-only access to the owner's Studio data dir (config/agents/wright.json) for Validation 3"

# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/settings/tool-policy.ts"}
  - {kind: "file", path: "app/src/screens/settings/tool-policy.test.tsx"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "wright_tools"}
  - {kind: "symbol", path: "app/src/screens/budget/audit-sentences.ts", name: "wright_tool_policy_upgraded"}
  - {kind: "symbol", path: "app/src/screens/budget/audit-sentences.ts", name: "wright_tool_policy_upgrade_failed"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/agents/past-tool-lists.ts", name: "PROPOSED_TOOLS_AUDIT_KINDS"}
  - {from: "1", kind: "symbol", path: "kernel/src/gui/settings.ts", name: "wright_tools"}
lanes:
  - "app/src/api/contract.ts"
  - "app/src/screens/budget/audit-sentences.ts"
  - "app/src/screens/settings/model.ts"
  - "app/src/screens/settings/model.test.ts"
  - "app/src/screens/settings/SettingsScreen.tsx"
  - "app/src/screens/settings/tool-policy.ts"
  - "app/src/screens/settings/tool-policy.test.tsx"
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
| Subtask 1 | Subtask 2 | none | YES (Subtask 2 requires Subtask 1's audit kinds and response field; the app's audit-sentence test scans the kernel's source) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
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
| Widening an agent's tools without the owner is a safety-kernel concern (D5) | HIGH | Only an exact set match with a recorded past list and `status: "proposed"` upgrades. Nothing upgrades without a registered audit sink. Every upgrade records `wright_tool_policy_upgraded` with `added`, and the backup is kept. A test pins that every past list is a subset of the current one, so no upgrade removes a tool. |
| Validation 3's upgrade half cannot be seen on the owner's install at merge: the owner's 25-tool list already equals the current proposal | MEDIUM | AC9 records the honest result ("unedited, current, nothing missing, no write") and says the backup-of-25 check runs when wa-e or wa-f grows `PROPOSED_ALLOWED_TOOLS`. The tests cover the upgrade with the real 15- and 21-tool lists. |
| A sink left registered after its store closes (many kernels in one vitest process) | MEDIUM | Keep the registry per data dir. `register` returns the unregister function, `teardown` calls it before `store.close()`, and a sink that throws is swallowed (AC7). |
| Tests elsewhere that write an old list with `status: "proposed"` while a kernel is running would now see it upgraded | LOW | Run the whole kernel suite. Only exact past lists match, so a test's custom list is untouched. |
| A backup file beside `wright.json` could break `readdirSync(...).toEqual(["wright.json"])` pins | LOW | A backup is made only on an upgrade, and those pins write the current list. Nothing in `kernel/src` lists `config/agents/` (`grep -rn readdirSync kernel/src`). |
| Feasibility (Phase 2.5): the reader has no store | MEDIUM | Design decision 2 (the per-data-dir sink). |
| Feasibility (Phase 2.5): files outside Touches | MEDIUM | Asked once at Phase 6 (`LP-SCOPE`). Every path is listed in the File Impact Map. |
| Feasibility (Phase 2.5): 15 files, more than one worker's bound | MEDIUM | `context-bound` split into kernel, then app, run serially. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-28-wa-c-unedited-proposed-tool-list-upgrade.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-28T10:55:40Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/317
- **Branch:** feature/wa-c-unedited-proposed-tool-list-upgrade
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** The kernel upgrades an unedited proposed Wright tool list (set-equal to a recorded 15/21/25-tool past list, status proposed) to PROPOSED_ALLOWED_TOOLS when an audit sink is registered, at a top-level read only. Each upgrade makes a backup and records one wright_tool_policy_upgraded event; a lasting pre-rename failure records one wright_tool_policy_upgrade_failed event and leaves no backup. GET /settings gains wright_tools, and the Settings screen gains a "Wright's tools" block. Heal round 1 fixed 3 HIGH + 1 MEDIUM; round 2 PASSED with 2 LOW dismissed. Kernel 5489 passed/23 skipped; app 3440/3440; required CI green.

## Not verified
- **app Settings 'Wright's tools' block and audit sentences** — Subtask 2's lane; app tests not run by worker 1 (covered by subtask 2: 3440/3440) (subtask 1)
- **the upgrade on the owner's live install (backup of the 25-tool list)** — needs PROPOSED_ALLOWED_TOOLS to grow (wa-e/wa-f); live data dir is read-only (subtask 1)
- **the running launchd kernel's GET /settings** — the owner's daemon runs a separate install; evidence used the real route handler with a store stand-in, no kernel started (subtask 1)
- **Settings screen in the built Electron app (e2e/settings.spec.ts)** — only jsdom renders were run; e2e needs a built app and a kernel (subtask 2)
- **GET /settings from a running kernel feeding the block** — only scripted bodies were used; no kernel was started (subtask 2)
