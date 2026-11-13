# Supervisor Job: A crew member's charter is checked against what its work needs (phase 8 item 20c)

## Environment
- **Project:** loomwright-studio (lane checkout `L7`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-20/2026-11-12-170445-c-a-crew-member-s-charter-is-checked-against-what-its-work-needs.md
- **Base commit:** 9ea7801a563bdb6ea320ff8da1d978fd53d26ce3

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest; no new dependency. |
| 2 | Dependency Availability | GO | The dependency 20b has landed (`ba3df845`, PR #270): D44 and `AUTOMATE_RUN_POLICY` in `kernel/src/automate/launch.ts`. Loomwright's `capabilities.json` (17.37.0) has `commands[]` entries with only `name` and `description`, so the pinned table is the live source, as the requirement assumes. |
| 3 | Architecture Fit | GO | Extends item 16's catalogue (`TOOL_JOB_DEFINITIONS`, `connectorNeeds`, `holdsConnector`), item 18b's readiness block and item 16's `playbookFit` and `charter_gap`. Mechanism only (invariant 1): the kernel compares lists and grants nothing. |
| 4 | Scope vs Supervisor Capability | CAUTION | 22 files (17 modify, 5 create), so `context-bound` (more than 12 files) fires and the work splits into 3 subtasks. |
| 5 | Hard Blockers | CAUTION | The requirement names "D43 (kernel-owned launch)". The kernel-owned launch is recorded as **D44** in `docs/DECISIONS.md`, and D43 is the decision it supersedes for the ticket run. This brief reads every "D43 (kernel-owned launch)" as D44. The 2026-11-12 charter (`studio-sandbox-dev` before approval 32) is not in the repo (`grep -rn "approval 32" docs` has no hits), so the fixture is rebuilt from the requirement's description. Files outside Touches are needed (see `## Scope widening`). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Every catalogue job declares what its work needs (kernel tools, Claude tools, Bash prefixes, connectors at a level, a workspace), with the needs of any Loomwright command it reaches. The charter readiness block, a playbook's dry run and its enable then show any gap before the owner approves or enables.

**Problem Statement:**
The owner needs to know exactly which permissions a crew member needs for the work they describe, because a user can ask Wright to set up a crew member for anything.
Today the readiness check (`kernel/src/agents/charter-readiness.ts`, item 18b) asks only whether the charter holds the kernel tools of its jobs (plus a repo copy and connector access derived from those tools). The playbook dry run runs in draft mode, so it never reaches the calls a real run makes. In the 2026-11-12 exit live run, a charter passed every check and the real run was then refused three times.
Success looks like this: the gap shows on the charter card and in the playbook's dry run before approval or enable, in plain words, and the enable is refused `charter_gap` unless the owner says to enable it anyway.

## Design decisions
- decision: Where a job's needs are declared, and how kernel tools are counted (T2, a new module `kernel/src/features/job-needs.ts`)
  chosen: Each `TOOL_JOB_DEFINITIONS` entry in `kernel/src/features/catalogue.ts` gains a required `needs` declaration: `claudeTools`, `bashPrefixes`, `connectors` (beyond what its tools already declare), `workspace` (replacing today's `needsWorkspace`, same values) and `loomwrightCommands`. Each Claude tool and Bash prefix carries a plain-words label. Kernel tools are NOT listed again: they are the catalogue's tools of that job, as today. A new CLI-safe leaf `kernel/src/features/job-needs.ts` resolves a job's full needs (the catalogue's tools, the job's declaration, and its Loomwright commands' needs) and compares them with a policy, a connector grant and the workspaces. That comparison is the one rule readiness and fit share, as `jobGranted`/`holdsConnector` are today.
  rejected: Listing kernel tool names on each job — the catalogue header says it is "generated from the registered tools themselves, never kept as a second list" (reversibility: two lists drift).
  rejected: Appending the resolver to `catalogue.ts` — it is 434 lines and would pass the 500-line threshold with the pinned command table (module layout).
  evidence: `grep -n "needsWorkspace" kernel/src/features/catalogue.ts` → the job definition already carries one non-tool need; `connectorNeeds`/`holdsConnector` are already shared by `../playbooks/fit.ts` and `../agents/charter-readiness.ts` ("so the two never disagree on the same charter").
  revisit when: a second kind of non-tool need appears that is not per job (for example per trigger).
  status: confirmed
- decision: Where a Loomwright command's needs come from (T4: a mechanism shared by readiness, fit and Wright's drafting text)
  chosen: Contract first. `kernel/src/loomwright/contract.ts` parses an OPTIONAL `needs` object on a `commands[]` entry (`claude_tools`, `bash_prefixes`, `connectors`, `workspace`). An entry without it parses exactly as today, and a malformed `needs` is ignored for that command, never a contract error. Where the active install's contract declares no needs for a command, a pinned kernel table `LOOMWRIGHT_COMMAND_NEEDS` in `job-needs.ts` (stamped with the Loomwright version it was read from, 17.37.0) is used. The kernel reads the active install's contract once when it builds the tool catalogue (`kernel/src/kernel.ts`, fail-safe: any error means the pinned table). The resolved needs ride on the `ToolCatalogue`, so readiness, fit and dry run read them from `ctx.catalogue` with no new plumbing.
  rejected: Pinned table only — fails the requirement's "from Loomwright's contract where it declares them".
  rejected: Reading the contract on every readiness or fit call — new I/O on every hold, and not CLI-safe in `charter-readiness.ts`.
  evidence: `jq '[.commands[]|keys[]]|unique' capabilities.json` → `["description","name"]` (no command declares needs today); `kernel/src/loomwright/contract.ts` `const commands = entries("commands");`; `kernel/src/kernel.ts` `const toolCatalogue = kernelToolCatalogue(contributions.tools);`.
  revisit when: Loomwright's contract declares per-command needs (then the pinned rows for those commands become dead and can be removed).
  status: confirmed
- decision: How the three Loomwright commands that jobs reach are declared under D44
  chosen: `automate_tickets` reaches `/loomwright:automate` with `launch: "kernel"` (D44: the kernel starts it with `AUTOMATE_RUN_POLICY`). Its Claude tools and Bash prefixes are that frozen kernel policy's and are never a crew need, so the job's needs are its kernel tools, GitHub write and a workspace, with no `Skill` and no Loomwright or git/gh shell prefix (owner decision 2026-11-12). `triage_pr_comments` (the `automate_fix` route answers `/loomwright:review-pr <url>`, `kernel/src/automate/routing.ts`) and `ask_for_merge` (`kernel_automate_merge_check`'s `go` answers `/loomwright:automate --merge-parked <run_id>`) reach commands with `launch: "crew"`: the crew session is told to run them itself. Their pinned needs (`Skill` and the commands' shell prefixes) are declared truthfully. Readiness and the dry run name them as calls the crew member would be refused that no charter change should grant (D44 leaves a kernel launch for these routes as a follow-up). Wright's fix note proposes no grant for them, and the owner can enable anyway.
  rejected: Leaving the two D44-open crew routes out of the table — hides the exact "approved, then refused at run time" gap this item exists to show (`docs/DECISIONS.md` D44: "nothing claims they work").
  rejected: Proposing `Skill` or Loomwright prefixes in a crew charter — D44 rejected alternative (a) and invariant 3.
  evidence: `kernel/src/automate/routing.ts` `const command = \`/loomwright:review-pr ${url}\`;`; `kernel/src/automate/merge-check.ts` `const invocation = ["/loomwright:automate", "--merge-parked", ...`; `kernel/src/automate/launch.ts` `export const AUTOMATE_RUN_POLICY: ToolPolicy = Object.freeze({`.
  revisit when: a kernel launch for `review-pr` / `--merge-parked` lands (then those rows become `launch: "kernel"` and the flag goes away).
  status: confirmed

## Acceptance Criteria
- [ ] AC1 — Given any job in `kernel/src/features/catalogue.ts` (`TOOL_JOB_DEFINITIONS`), then it declares what its work needs: kernel tools (the catalogue's tools of that job), Claude tools (for example `Skill`, `Agent`), Bash prefixes, connectors and their levels, and a workspace. `resolveJobNeeds` (`kernel/src/features/job-needs.ts`) returns all five for every `TOOL_JOB_IDS` job.
- [ ] AC2 — Given a job that runs a Loomwright command, when its needs are resolved, then the command's needs come from Loomwright's contract (`capabilities.json` `commands[].needs`) where the active install declares them, and from the pinned kernel table `LOOMWRIGHT_COMMAND_NEEDS` where it does not. A test covers both: a contract fixture that declares needs for one command overrides that command's pinned row, and a contract with no `needs` uses the pinned row.
- [ ] AC3 — Given a charter (create or update) missing a declared need, when its card shows, then its readiness block has a `  flagged: ` line naming the job (its label) and the missing permission in plain words, for example "run skills" and not `Skill`. The raw name (`Skill`, a Bash prefix, `mcp__kernel__…`) appears only on the display's `enforced:` line, never on a readiness line. The flag uses one line per job and kind of permission, so the block stays bounded by jobs, not by tool count. `readinessFloorLines` stays a true lower bound of the new lines, so `MAX_APPROVAL_DISPLAY` refusals are still computed correctly.
- [ ] AC4 — Given a crew member's playbook whose real (non-draft) run would make a call its member's policy refuses (a declared need of one of its jobs that the member's `allowedTools`, `allowedBashPrefixes`, connector grant or workspaces lack), when it is dry-run, then `kernel_playbook_dry_run`'s result (through `fit`) lists each such call, and the dry run's summary names them before the enable. The enable is then refused `charter_gap` unless the owner says to enable it anyway (`enable_anyway: true`, item 16's pattern). A gap only the owner can close (a connector grant or write level, a workspace, or a D44-open crew route) is named as the owner's step and never put in `proposed_update`.
- [ ] AC5 — Given Wright drafting a charter or a playbook, then the drafting tools' catalogue text (`catalogueText`, carried on `kernel_agent_create`, `kernel_agent_update`, `kernel_playbook_create` and `kernel_playbook_update`) lists each job's declared needs and says which only the owner can grant: GitHub write, connectors, live mode, a workspace, and the D44-open crew routes' `Skill`, which no charter should hold.
- [ ] AC6 — Given a new job added to `TOOL_JOB_DEFINITIONS` with no declared needs, then a test fails. This is a runtime vitest test over every `TOOL_JOB_IDS` entry, because `npm test` is `vitest run` and does not typecheck.
- [ ] AC7 — Given the 2026-11-12 charter (`studio-sandbox-dev` before approval 32) as a committed fixture, rebuilt from the requirement (a "Hand tickets to /automate" duty with that job's kernel tools granted, no `Skill`, no shell grant, no workspaces, and a GitHub grant without write), then readiness flags its missing needs for "Hand tickets to /automate" under D44 (the kernel-owned launch): GitHub write access and a copy of a repo. No readiness line names `Skill` or "run skills" for that job.
- [ ] AC8 — Given the change, then a committed evidence file `docs/evidence/phase-8-20c-charter-needs.md` contains the requirement's Validation 1 commands and their results (`cd kernel && npm test`, `cd app && npm test`, `bash scripts/check-docs.sh`), and the Validation 2 steps (in the packaged app: ask Wright for a crew member whose job needs a permission the draft lacks; the card's readiness names the gap before approval, and a playbook's dry run names the call a real run would be refused), with a `Verdict:` line for the owner to fill in (`Verdict: PASS for Validation 2` once run). The PR body links to it.

## Scope widening
- kernel/src/features/job-needs.ts
- kernel/src/loomwright/contract.ts
- kernel/src/kernel.ts
- kernel/src/tools/server.ts
- kernel/src/playbooks/fit.ts
- kernel/test/job-needs.test.ts
- kernel/test/tool-catalogue.test.ts
- kernel/test/automate-launch.test.ts
- kernel/test/agents-charter-needs.test.ts
- kernel/test/playbooks-fit.test.ts
- kernel/test/playbooks-dry-run-needs.test.ts
- docs/architecture/loomwright.md
- accepted: LP-SCOPE 2026-11-13

## Touched-file invariants

> Grounded at base `9ea7801a563bdb6ea320ff8da1d978fd53d26ce3`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/features/catalogue.ts`** — keep: CLI-safe imports only (`` `../tools/server.js`, `../kernel.js` or the Agent SDK ``); the closed job vocabulary is declared in one place (`export const TOOL_JOB_DEFINITIONS = Object.freeze({`) and `TOOL_JOBS` stays derived from it; `jobNeedsWorkspace(job)` keeps its meaning (the `workspace` need replaces `needsWorkspace` with the same values: `automate_tickets`, `triage_pr_comments`, `ask_for_merge`) and stays the only reader of it; `jobGranted` fails closed (`is never granted, so neither check calls a job`); `allowedToolsForJobs` still yields only `mcp__kernel__` names (`return catalogue.tools.filter((t) => wanted.has(t.job)).map((t) => \`${KERNEL_TOOL_PREFIX}${t.name}\`);`), and a job's declared `claudeTools`/`bashPrefixes` are never added to a drafted charter for a D44-open crew route; in `catalogueText` each `Job <id> "<label>":` heading is followed directly by its tool lines, and the job's needs line(s) go after its tools, so the existing pin `'Job read_pr "Read a PR":\n- kernel_github_pr_get: '` stays green. reuse: `connectorNeeds`, `holdsConnector`, `connectorAccessText` for connector needs, never a second fold. mirror: the mockup's job labels (`use the approved mockup's labels exactly`). pinned by: `kernel/test/tool-catalogue.test.ts`; `kernel/test/agents-charter-tools.test.ts` (`- kernel_github_pr_get: `, the catalogue-text heading pin); `kernel/test/automate-launch.test.ts` (`toEqual(["label", "needsWorkspace"])`, item 20b's AC5 job-shape pin — Subtask 1 rewrites it to what 20b meant: `allowedToolsForJobs` for `automate_tickets` and `triage_pr_comments` holds only `mcp__kernel__` tools, and `resolveJobNeeds("automate_tickets")` holds no `Skill` and no shell prefix, keeping the test name's intent); `kernel/test/agents-charter-readiness.test.ts` (`d.needsWorkspace` — Subtask 1 switches it to `jobNeedsWorkspace(id)`, keeping the asserted list `["automate_tickets", "triage_pr_comments", "ask_for_merge"]`).
- **`kernel/src/agents/charter-readiness.ts`** — keep: the block format and prefixes (`READINESS_FLAG_PREFIX = "  flagged: "`, `READINESS_HEADING = "readiness: checked by the kernel before you see it"`); every line starts with exactly one prefix, and a duty's text stays last on its line; a read failure is `not checked`, never `ready` (`never throws (a read that fails is "not checked", never "ready")`); the block grows with duties, never with the number of granted tools (`number of granted tools or jobs`); `noteText` proposes only the missing jobs' kernel tools (and, new, declared Claude tools/prefixes a charter may hold), and never a connector grant, a workspace or a D44-open route's `Skill` (`it is never a change you draft`); `readinessFloorLines` stays a lower bound of every real line. mirror: the app parses the block by prefix and keys the workspace fix on the flagged text `no copy of a repo to work in` (`app/src/screens/approvals/charterBlocks.ts` `export const WORKSPACE_FLAG = "no copy of a repo to work in";`), so that wording must not change. reuse: `item(...)`, `labels(...)`, `andList`. pinned by: `kernel/test/agents-charter-readiness.test.ts`.
- **`kernel/src/agents/charter-tools.ts`** — keep: the head-size refusal (`MAX_APPROVAL_DISPLAY`) computed from `readinessFloorLines`; `createReadiness` passes `grant: { kind: "proposed", connectors: charter.connectors ?? [] }`; the module stays CLI-safe. pinned by: `kernel/test/agents-charter-tools.test.ts`, `kernel/test/agents-charter-readiness.test.ts`.
- **`kernel/src/playbooks/fit.ts`** — keep: inputs only `jobs_json`, the catalogue, the member's settings and the trigger's poll source (`Reads only \`row.jobs_json\`, \`catalogue\`, the member's`); `unchecked` fails closed through `fitGapOpen`; `proposed_update` never carries a connector grant (`Never a connector grant.`), and `expected_sha256` is the hash of the bytes read (`Hashed before and after the read`). mirror: `kernel/src/playbooks/enable.ts` `charterGap` reads `fit.lines`, `fit.proposed_update` and `fitGapOpen(fit)`, and enable.ts is not modified, so a new gap must surface through those fields. pinned by: `kernel/test/playbooks-fit.test.ts`.
- **`kernel/src/playbooks/dry-run.ts`** — keep: `never refuses on a gap: the enable does (\`charter_gap\`).`; the stored summary stays one paragraph (`formatDryRunSummary`); a replay returns the stored result and shows the fit as it is now (`withFit`). pinned by: `kernel/test/playbooks-dry-run.test.ts`.
- **`kernel/src/loomwright/contract.ts`** — keep: an entry missing `needs` parses exactly as today (`return { name: entry.name, description: oneLine(entry.description) };`); a malformed optional `needs` never turns into a `LoomwrightContractError` (an install with a newer contract must not stop the kernel); `MIN_CONTRACT_SCHEMA_VERSION` is unchanged. pinned by: `kernel/test/loomwright-adapter.test.ts`.
- **`kernel/src/kernel.ts` / `kernel/src/tools/server.ts`** — keep: the catalogue is built from `contributions.tools` unfiltered (`const toolCatalogue = kernelToolCatalogue(contributions.tools);`); `kernelToolCatalogue` returns `null` on a build error and never throws; reading the Loomwright contract for command needs is fail-safe (no install, an unreadable install or a bad contract means the pinned table) and never stops `startKernel`. reuse: `resolveLoomwrightInstall` (`kernel/src/loomwright/active-install.ts`) and `readLoomwrightContract` (`kernel/src/loomwright/contract.ts`), wrapped fail-safe; never a second install resolver or contract reader.

## Closed enumerations touched

> Sibling grep at base `9ea7801a`: `grep -rnF '"workspace" | "connector"' kernel app` → 1 hit in 1 file.

- **`"permission"`** (new `ReadinessSubject`, sibling: `"connector"`) — must be named in:
  - `kernel/src/agents/charter-readiness.ts` — `export type ReadinessSubject = "duty" | "workspace" | "connector" | "jobs";` — extend.
  - `app/src/screens/approvals/charterBlocks.ts` — parses lines by status prefix, not by subject — no change: the subject is not shown in the display text.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/job-needs.test.ts` — every job declares needs (AC6) | delete `needs` from the `manage_crew` entry in `kernel/src/features/catalogue.ts` |
| `kernel/test/job-needs.test.ts` — contract needs override the pinned row (AC2) | make `resolveJobNeeds` in `kernel/src/features/job-needs.ts` ignore its contract argument |
| `kernel/test/job-needs.test.ts` — `automate_tickets` needs hold no `Skill` (D44) | flip `launch: "kernel"` → `launch: "crew"` on the `/loomwright:automate` row in `kernel/src/features/job-needs.ts` |
| `kernel/test/automate-launch.test.ts` — rewritten item 20b job-shape pin: `allowedToolsForJobs` for `automate_tickets`/`triage_pr_comments` holds only `mcp__kernel__` names, and `resolveJobNeeds("automate_tickets")` holds no `Skill` and no shell prefix | make `allowedToolsForJobs` in `kernel/src/features/catalogue.ts` append the job's declared `claudeTools` |
| `kernel/test/agents-charter-needs.test.ts` — 2026-11-12 fixture flags GitHub write and a copy of a repo, never `Skill` (AC7) | delete the workspace check call in `charterReadiness` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-needs.test.ts` — a missing Claude tool is flagged in plain words, the raw name only on `enforced:` (AC3) | flip the plain-words label of `Skill` → its raw name in `kernel/src/features/job-needs.ts` |
| `kernel/test/playbooks-dry-run-needs.test.ts` — the dry run lists a call the real run would be refused, and the enable is refused `charter_gap` (AC4) | make `playbookFit` in `kernel/src/playbooks/fit.ts` return `fits` when only declared non-kernel needs are missing |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Job needs: declarations, pinned Loomwright table, contract-first, drafting text | AC1, AC2, AC5, AC6 | 8 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Charter readiness flags missing declared needs | AC3, AC7 | 4 modify, 1 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |
| 3 | Playbook fit, dry run and enable name refused calls; evidence file | AC4, AC8 | 5 modify, 2 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 needs | `kernel/src/features/catalogue.ts` (434), `kernel/src/loomwright/contract.ts` (327), `kernel/src/kernel.ts` (502 — one call site passes the contract's command needs; no new responsibility), `kernel/src/tools/server.ts` (679 — `kernelToolCatalogue` gains an optional argument; no new responsibility), `kernel/test/tool-catalogue.test.ts` (344), `kernel/test/automate-launch.test.ts` (865 — only item 20b's job-shape pin is rewritten, see invariants), `kernel/test/agents-charter-readiness.test.ts` (951 — only the `d.needsWorkspace` read in "the code jobs are declared once" is moved to `jobNeedsWorkspace`; Subtask 2 then edits the same file after Subtask 1, a legal ordered share), `docs/architecture/loomwright.md` (192) | `kernel/src/features/job-needs.ts` (home of the pinned table, the resolver and the needs-vs-policy comparison), `kernel/test/job-needs.test.ts` (home of AC1, AC2 and AC6 tests) | HIGH (catalogue, job-needs, tests), MEDIUM (kernel.ts, server.ts wiring) |
| 2 readiness | `kernel/src/agents/charter-readiness.ts` (501 — the single authority of the readiness block; the comparison logic lives in `job-needs.ts`, so only line emission is appended), `kernel/src/agents/charter-tools.ts` (1044 — readiness wiring and description text only; no new responsibility), `kernel/test/agents-charter-readiness.test.ts` (951 — existing pins updated only where the block gains lines), `docs/architecture/agents.md` (384) | `kernel/test/agents-charter-needs.test.ts` (home of the AC3 and AC7 tests and the 2026-11-12 fixture) | HIGH (readiness), MEDIUM (charter-tools) |
| 3 fit/dry run | `kernel/src/playbooks/fit.ts` (250), `kernel/src/playbooks/dry-run.ts` (594 — summary lines only; the single authority of `formatDryRunSummary`), `kernel/test/playbooks-fit.test.ts` (621 — existing pins updated only where triage and merge playbooks now report the D44-open route gap), `kernel/test/playbooks-dry-run.test.ts` (1098 — existing pins updated only; new dry-run tests go in the CREATE file), `docs/architecture/dry-run.md` (172) | `kernel/test/playbooks-dry-run-needs.test.ts` (home of the AC4 tests), `docs/evidence/phase-8-20c-charter-needs.md` | HIGH |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` checks every relative markdown link in `docs/`, `CLAUDE.md` and `README.md`. Every link added to `docs/architecture/*.md` or the evidence file must resolve. `cd app && npm test` pins the readiness wording the app parses (`WORKSPACE_FLAG`).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/features/job-needs.ts"}
  - {kind: "symbol", path: "kernel/src/features/job-needs.ts", name: "LOOMWRIGHT_COMMAND_NEEDS"}
  - {kind: "symbol", path: "kernel/src/features/job-needs.ts", name: "resolveJobNeeds"}
  - {kind: "type", path: "kernel/src/features/job-needs.ts", name: "JobNeeds"}
  - {kind: "symbol", path: "kernel/src/features/catalogue.ts", name: "TOOL_JOB_DEFINITIONS"}
  - {kind: "file", path: "kernel/test/job-needs.test.ts"}
requires: []
lanes:
  - "kernel/src/features/catalogue.ts"
  - "kernel/src/features/job-needs.ts"
  - "kernel/src/loomwright/contract.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/test/tool-catalogue.test.ts"
  - "kernel/test/job-needs.test.ts"
  - "kernel/test/automate-launch.test.ts"
  - "kernel/test/agents-charter-readiness.test.ts"
  - "docs/architecture/loomwright.md"
external_requires:
  - "Loomwright 17.37.0 capabilities.json (commands[] carry only name and description; pinned table stamped with this version)"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "ReadinessSubject"}
  - {kind: "file", path: "kernel/test/agents-charter-needs.test.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/features/job-needs.ts", name: "resolveJobNeeds"}
  - {from: "1", kind: "type", path: "kernel/src/features/job-needs.ts", name: "JobNeeds"}
lanes:
  - "kernel/src/agents/charter-readiness.ts"
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/test/agents-charter-readiness.test.ts"
  - "kernel/test/agents-charter-needs.test.ts"
  - "docs/architecture/agents.md"
external_requires: []

# Subtask 3
provides:
  - {kind: "type", path: "kernel/src/playbooks/fit.ts", name: "PlaybookFit"}
  - {kind: "file", path: "kernel/test/playbooks-dry-run-needs.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-20c-charter-needs.md"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/features/job-needs.ts", name: "resolveJobNeeds"}
  - {from: "1", kind: "type", path: "kernel/src/features/job-needs.ts", name: "JobNeeds"}
lanes:
  - "kernel/src/playbooks/fit.ts"
  - "kernel/src/playbooks/dry-run.ts"
  - "kernel/test/playbooks-fit.test.ts"
  - "kernel/test/playbooks-dry-run.test.ts"
  - "kernel/test/playbooks-dry-run-needs.test.ts"
  - "docs/architecture/dry-run.md"
  - "docs/evidence/phase-8-20c-charter-needs.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
Subtask 1 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/test/agents-charter-readiness.test.ts` (ordered: 2 requires 1, a legal share) | YES (requires) |
| Subtask 1 | Subtask 3 | none (3 requires 1's exports) | YES (requires) |
| Subtask 2 | Subtask 3 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2, Subtask 3 (parallel — disjoint lanes, both after #1)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope: 22 files, several of them outside the requirement's Touches (Feasibility, Phase 2.5) | HIGH | Split `context-bound` into 3 subtasks with disjoint lanes; the paths outside Touches are listed in `## Scope widening` for the coordinator's re-gate. |
| The requirement says "D43 (kernel-owned launch)", but the kernel-owned launch is D44 (Feasibility, Phase 2.5) | MEDIUM | Read it as D44 everywhere; code comments and docs cite D44. |
| The 2026-11-12 fixture charter is not in the repo (Feasibility, Phase 2.5) | MEDIUM | Rebuild it in `kernel/test/agents-charter-needs.test.ts` from the requirement's description, with a comment naming the source (the requirement's "What failed", sessions 125, 126 and 129) and saying it is a reconstruction. |
| Flagging the D44-open crew routes (`/loomwright:review-pr`, `--merge-parked`) turns every triage and merge playbook's fit into `gap`, so existing enable tests and walks now need `enable_anyway` | HIGH | Update the affected existing pins deliberately, each with the D44 reason. Never weaken `fitGapOpen`. The fit line says the gap is a kernel follow-up the owner may enable past. |
| The readiness head grows and a charter that fitted `MAX_APPROVAL_DISPLAY` no longer does (18d evidence: a 10-duty charter was 60 to 615 characters over) | MEDIUM | One line per job and kind of permission (bounded by jobs). Extend `readinessFloorLines` so the update-floor refusal stays correct, and test a long-duty charter. |
| The pinned table drifts from Loomwright's real needs after an upgrade (requirement risk) | MEDIUM | Stamp the table with the Loomwright version it was read from (17.37.0), and name the stamp in `docs/architecture/loomwright.md`. Wiring it into the phase 2 version-change note is a follow-up, not this item. |
| A malformed `needs` in a future contract stops the kernel from starting | MEDIUM | Parse `needs` as optional and ignore a bad one per command; test it in `kernel/test/job-needs.test.ts`. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-13-charter-checked-against-job-needs.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-13T13:56:28Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/274
- **Branch:** feature/charter-checked-against-job-needs
- **Files changed:** 24
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** 3/3 subtasks merged (job needs + pinned Loomwright table, contract-first; readiness flags; fit/dry-run/enable refused calls + evidence file). Phase 4.5 round 1 FAILed on 1 HIGH (an integrated test failed at 4014/4000 display chars: a temp-dir-length fixture met ~370 chars of non-closable crew-route lines) and 4 MEDIUM (untested crew-run boundary, stale playbooks.md fit shape, drafts.ts guidance drift, triplicated list joiner). All five were fixed in 2233273a; round 2 PASSed. Kernel suite 4548 passed, app 3292 passed, tsc clean, check-docs OK. 5 LOW/nit findings dismissed below the MEDIUM floor (PR comment). Validation 2 verdict is the owner's step.

## Not verified
- **`startKernel` with a real install that declares needs** — only `loadCommandNeeds` and the catalogue are unit-tested; the `startKernel` wiring has not been run end to end (subtask 1)
- **The fix sentence for a closable Claude tool or prefix in the agent note** — no shipped job declares a closable need, so there is no fixture for this branch (subtask 2)
