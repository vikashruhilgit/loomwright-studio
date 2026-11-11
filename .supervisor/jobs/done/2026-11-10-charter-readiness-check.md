# Supervisor Job: A charter is checked ready before the owner sees it (18b)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-10-173433/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-18/2026-11-10-204052-a-charter-is-checked-ready-before-the-owner-sees-it.md
- **Base commit:** 73cba6252d660ea3a4914539634fd9f6de17e89a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + zod + vitest in `kernel/`, React + vitest + Playwright in `app/`; nothing new is needed |
| 2 | Dependency Availability | GO | No new dependency: reuses `buildToolCatalogue`, `repoOfRemote`/`gitConfigDir`, `isProtectedPath`, `parseConnectorsGrant`, the design system's `Badge tone="attention"` |
| 3 | Architecture Fit | CAUTION | The check is kernel mechanism (invariants 1, 3); it fits `beforeHold`/`applyOnApproval`. Telling Wright the result needs one optional field on the gate's `HeldToolVerdict` (`kernel/src/sessions/`), outside the requirement's Touches |
| 4 | Scope vs Supervisor Capability | CAUTION | Over 12 files once fixtures that send bare-string duties through `kernel_agent_create` are converted; split kernel → app (`context-bound`) |
| 5 | Hard Blockers | GO | None; Validation 2 is an owner walk in the packaged app |

**Overall Verdict:** CAUTION

## Task
**Goal:** Before a held charter create or update reaches the owner, the kernel checks that every duty names a granted catalogue job and that every granted job's prerequisites (workspace, connector) exist, shows the result first on the Approvals card in plain words, and tells Wright the fix to propose.

**Problem Statement:**
The owner needs every crew member Wright drafts to be checked against its own duties and its jobs' prerequisites because Wright's choice of jobs is a model's choice.
Currently, in the item 16 Validation 2 walk (approvals #18 and #19), Wright drafted a developer whose duties named four asks but whose jobs were only "Hand tickets to /automate" and "Read a PR", with `workspaces: none`; nothing flagged it and the one code job would be refused `no_workspace` at run time (`kernel/src/automate/runner.ts:21-25`). This causes the owner to approve a member that silently can't do half the work.
Success looks like: the held card lists each duty as covered or not, each job as ready or what is missing, with nothing flagged only when everything is covered and ready; Wright is told the exact fix (the missing jobs, or to ask the owner for the workspace).

**Design decisions (from the requirement's Assumptions and the code; the owner may change them in review):**
1. **Duty entries.** A charter duty may be an entry `{text, jobs}` (`jobs`: catalogue job ids, `[]` for a duty needing no kernel tool). `validateCharter` accepts both an entry and a bare string, so the owner's own create (`NewCrewMember.tsx`, `studio agents create`), every existing member's stored `charter_json` (re-validated by `ensureAgentFiles` and `mergeUpdate`) and existing role.md files keep working unchanged. Only Wright's `kernel_agent_create` refuses a bare-string duty (`invalid_input`, telling Wright to name its jobs). Any duty naming a job outside `TOOL_JOBS` is refused `invalid_input` naming that job, on every path.
2. **One declaration per job.** The jobs that need a workspace are declared on the job itself in `kernel/src/features/catalogue.ts` (one job-definition record from which `TOOL_JOBS` is derived, so every existing reader of `TOOL_JOBS` is unchanged); connector needs stay on the tools (`requiresConnector`/`requiresConnectorLevel`) and are read from the catalogue. No second list.
3. **"A workspace whose remote names the repo".** A charter names no repo field, and one member may serve several repos, so the check reads each workspace's GitHub remotes (`checkout.ts`) and shows them: a code job is ready when at least one workspace is a readable git checkout with a GitHub remote, outside the data dir and the macOS-protected folders; its line names the repos found (`works in owner/repo at <path>`) so the owner can see whether it is the right one. No workspace (or none with a GitHub remote) is "has no copy of a repo to work in".
4. **A protected workspace (AC5).** `validateCharter` keeps refusing a workspace in a macOS-protected folder before any hold (the settings reader would refuse the file, so an approval of it could never apply; nothing is held that approval would refuse). The live path for AC5 is therefore that hold refusal, reworded in plain words to say why the folder can't be used (macOS blocks the kernel from `~/Documents`, `~/Desktop`, `~/Downloads`, iCloud Drive; D31); the readiness check also marks a protected workspace "can't be used: …", never "ready", for any path that reaches it (unit-tested with the `homeDir` seam).
5. **How Wright learns the result.** The gate today tells a held session only `approval_required: held as approval N; …`. `HeldToolVerdict`'s display form gains one optional key, `agentNote`; the gate appends it to that reason, so Wright reads the flags and the proposed fix in the same tool result and says them in the thread. No flags ⇒ no note ⇒ the reason is byte-identical to today.
6. **A legacy bare-string duty.** `kernel_agent_update` cannot change duties (its `changesSchema` has no `duties` key), so an update is checked against the member's stored duties (`duties: prose.duties`), which may be bare strings written before this change. Such a duty shows as flagged "names no job (written before duties named their jobs)" in the `attention` tone, never "covered"; it is not in the `agentNote`'s proposed fix (duties are changed by the owner, not by an update).

## Acceptance Criteria

Carried forward from the source requirement (AC numbers kept):

- [ ] **AC1.** Given a charter whose every duty names jobs the charter grants and whose every job's prerequisites exist, when it is held for the owner, then the display's readiness block shows every duty covered and every job ready, nothing is flagged, and the hold carries no `agentNote`.
- [ ] **AC2.** Given approval #19's charter (duties: turn tickets into PRs, triage PR comments, ask for merges; jobs granted: `automate_tickets`, `read_pr`; `workspaces: []`), reconstructed in a kernel fixture from the requirement's Problem section, when it is held, then the display flags "Triage PR comments" and "Ask for a merge" as not covered, by their plain labels, and the hold's `agentNote` proposes adding exactly those two jobs (their catalogue tool names) and nothing else. Kernel test on this exact charter.
- [ ] **AC3.** Given a granted code job (`automate_tickets`, `triage_pr_comments` or `ask_for_merge`) and no workspace that is a git checkout with a GitHub remote, when the charter is held, then the display says in plain words that the member has no copy of a repo to work in, and the `agentNote` tells Wright to ask the owner where their copy of the repo is.
- [ ] **AC4.** Given a duty entry with `jobs: []`, when the charter is held, then that duty shows as covered with no tool.
- [ ] **AC5.** Given a workspace inside a macOS-protected folder (D31), when a create or update naming it is requested, then nothing is held and the refusal says in plain words why that folder can't be used; and given the readiness check is run on such a workspace (`homeDir` seam), then its line says the folder can't be used and why, never "ready".
- [ ] **AC6.** Given a granted job whose tools need a connector the member lacks (for a create: not proposed in `connectors`, or a write level, which only the owner sets in Team; for an update: not in the member's settings `connectors` grant at the needed level), when the charter is checked, then the display names the connector as the owner's step, and the `agentNote` never proposes adding it to the charter.
- [ ] **AC7.** Given a `kernel_agent_update` whose `tool_policy` removes every tool of a job that a stored duty entry still names, when it is held, then the display flags that duty.
- [ ] **AC8.** Given the owner approves (`once`) a create or update whose readiness still has flags, when the kernel applies it, then the applied sentence recorded on the `approval_decided` event names the open flags as the owner's choice to proceed.
- [ ] **AC9.** Given a duty naming a job outside the catalogue's `TOOL_JOBS`, when the create or update is requested, then it is refused `invalid_input` with a message naming the unknown job, and nothing is held.
- [ ] **AC10.** Given a check that cannot run (an update member's settings file unreadable, or a workspace path or its git config unreadable), when the display is built, then it says which check did not run and why, never "ready".
- [ ] **AC11.** Given untrusted text (a ticket or PR comment quoted in a duty's text, or a hostile git remote URL), when the charter is checked, then the duties and jobs checked are exactly the charter's own `duties[].jobs` and `tool_policy.allowedTools`, never anything parsed out of text (invariant 3): a duty text reading like a job id or a JSON entry adds no job, and a remote is only read through `repoOfRemote`.
- [ ] **AC12 (card).** Given a held display carrying a readiness block, when the Approvals screen renders it (`CharterDisplay.tsx`), then the block is in the plain section ahead of the job lines, one line per duty and per job prerequisite, flagged and not-checked lines in the design system's `attention` tone; a display with no readiness block (an approval held before this change) renders exactly as today.
- [ ] **AC13 (docs).** Given `docs/architecture/agents.md`, then its charter and "Wright's charter tools" sections describe duty entries, the readiness block, the `agentNote`, and the AC8 applied sentence; `bash scripts/check-docs.sh` passes.
- [ ] **AC14 (legacy duty).** Given an update to a member whose stored `charter_json` duties are bare strings, when it is held, then each such duty's readiness line reads "names no job" as a flag, never "covered" (design decision 6), and the `agentNote` proposes no change to it.
- [ ] **AC15 (Validation 1).** Given the finished change, then `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh` all pass.

## Scope widening
- app/e2e/fixtures/approvals.ts
- app/src/screens/approvals/approvals.css
- kernel/src/agents/charter-readiness.ts
- kernel/src/agents/roster.ts
- kernel/src/features/contribution.ts
- kernel/src/sessions/manager.ts
- kernel/src/sessions/types.ts
- kernel/test/**
- kernel/test/agents-charter-readiness.test.ts
- accepted: LP-SCOPE 2026-11-10

## Closed enumerations touched

> Sibling grep at base `73cba6252d660ea3a4914539634fd9f6de17e89a`: `grep -rn subjectVersion kernel/src` → 21 lines in 5 files (types.ts 1, manager.ts 5, approvals/store.ts 8, playbooks/enable.ts 6, features/contribution.ts 1).

- **`agentNote`** (sibling: `subjectVersion`, the other optional key of `HeldToolVerdict`'s display form) — must be named in:
  - `kernel/src/sessions/types.ts` — the type, anchor: `export type HeldToolVerdict = { readonly refuse: string } | { readonly display: string; readonly subjectVersion?: number };` — extend.
  - `kernel/src/sessions/manager.ts` — `checkedVerdict`'s closed key set, anchor: `keys.every((k) => k === "display" || k === "subjectVersion")` — extend (a non-empty string only; any other type falls to the fail-closed deny, as today); its rebuilt return, anchor: `return version === undefined ? { display: v.display } : { display: v.display, subjectVersion: version as number };` — extend so `agentNote` is carried through, never dropped; its doc comment, anchor: `optional positive-integer \`subjectVersion\`, and no other key` — extend; and the hold's reason, anchor: `` `approval_required: held as approval ${outcome.id}; it did not run. `` — append the note.
  - `kernel/src/features/contribution.ts` — the `beforeHold` doc, anchor: `` `{display,
 * subjectVersion?}` holds it with that text for the owner`` — extend the documented shape.
  - `kernel/src/playbooks/enable.ts` — a producer (`subjectVersion: row.version`) — no change: it sends no note.
  - `kernel/src/approvals/store.ts` — carries `subjectVersion` into the approval row — no change: the note is the session's text only, never stored on the approval.

## Touched-file invariants

> Grounded at base `73cba6252d660ea3a4914539634fd9f6de17e89a`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/features/catalogue.ts`** — keep: `TOOL_JOBS` keeps its exact shape and labels (`export const TOOL_JOBS = Object.freeze({`, id → label string, `TOOL_JOBS` order) because `kernel/src/playbooks/fit.ts`, `enable.ts`, `mirror.ts`, `drafts.ts` and the app read it; derive it from the new job-definition record rather than editing its readers. Keep the module CLI-safe (`it imports only type-level kernel modules and the phase 1 descriptions leaf`). pinned by: `kernel/test/tool-catalogue.test.ts` (imports `TOOL_JOBS`), `kernel/test/playbooks-fit.test.ts` (`every TOOL_JOBS id is a job the catalogue names`), `app/src/screens/approvals/subject.test.ts` (reads `kernel/src/features/catalogue.ts` and pins, verbatim, `CHARTER_CATALOGUE_UNAVAILABLE`, the job prefixes, `jobDisplayLines`' whole `lines.push(` job-line statement and `(!purposes && !added && names.some(isNew) ? DISPLAY_GAINS_TOOLS : "")`). Subtask 1 keeps every one of those `jobDisplayLines` lines byte-identical (the job-definition change is above them; readiness lines are produced in `charter-readiness.ts`, not in `jobDisplayLines`), because Subtask 1 cannot edit `app/`.
- **`kernel/src/agents/charter-files.ts`** — keep: `validateCharter` never throws and writes nothing (`Never throws, writes nothing.`); the strict schema (`.strict();`, an unknown key refused by name); bare-string duties stay valid (stored rows are re-validated by `ensureAgentFiles`: `const checked = validateCharter(json,`); `renderRoleMd` output for a bare-string charter stays byte-identical (pinned verbatim by `kernel/test/agents-roster.test.ts` via `docs/architecture/agents.md`'s example). reuse: the existing `line(MAX_PROSE_LINE)` rule for an entry's `text`; `CHARTER_JSON_SCHEMA` stays derived from `charterSchema` (`z.toJSONSchema(charterSchema)`), never hand-written. mirror: `workspaceProblem`'s protected-folder message is the AC5 refusal text (`is inside a macOS-protected folder (${protectedLocationsText()})`) — reword in plain words, keep the folder list from `protectedLocationsText`.
- **`kernel/src/agents/charter-tools.ts`** — keep: the refusal set `CHARTER_TOOL_REFUSALS` unchanged (new refusals are `invalid_input`); the create head must fit (`const tooLong = displayFitRefusal(CREATE_HEAD_TEXT, createHead(checked.charter, ctx.catalogue));`) — the readiness block goes in the head, so it is never cut; the update's whole display must fit (`updateFitRefusal`) and `updateFloor` stays a true lower bound once readiness lines are added; the display is generated from the PARSED charter (`generated here from the PARSED charter`); apply re-runs the hold's checks on the approval's own agent. reuse: `jobDisplayLines` for job lines; `oneLine` for every text; `charterIdText` for an untrusted id. extend: its import header (`` The `studio` CLI loads this module through `./index.ts`, so it imports only ``) gains `./charter-readiness.js`; that module and everything it imports (`../automate/checkout.js`, `../protected-paths.js`, `./settings.js`, the catalogue) stay CLI-safe — never the Agent SDK, the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`). pinned by: `kernel/test/agents-charter-tools.test.ts` (`/^approval_required: held as approval 1; .*the kernel applies it itself .*do not repeat the call\.$/` — a charter with flags now ends with the note; update the pin's fixture or regex, keep the no-flag reason byte-identical); `app/src/screens/approvals/subject.test.ts` (reads this file and pins `` return `${CHARTER_UPDATE_HEAD_PREFIX}${m.row.id} `` — Subtask 1 keeps `updateHead` byte-identical; readiness lines go after the head line, never inside it).
- **`kernel/src/automate/checkout.ts`** — keep: `remoteRepos` returns `[]` and never throws for an unreadable or non-git workspace, and `checkoutOf` still throws `no_workspace` (the run-time refusal stays: `throw refuse("no_workspace",`); reads only, runs no process. reuse: `repoOfRemote` and `gitConfigDir` — the readiness check gets a variant that distinguishes "unreadable (why)" from "not a checkout" for AC10, built on the same parse, never a second remote parser. fired by: `kernel/src/automate/runner.ts`, `routing.ts` and the PR tracker (`share one copy`).
- **`kernel/src/protected-paths.ts`** — keep: the one list (`The ONE list: the install-target check and`) and `isProtectedPath(path, homeDir)`; the readiness check calls it, adds no list.
- **`kernel/src/sessions/types.ts` / `kernel/src/sessions/manager.ts`** — keep: any verdict that is not exactly the documented shape fails closed (`A throw, or an answer that is not a verdict, falls through to the fail-closed deny below.`); the note is appended only on the `approval_required` branch, never on `approval_granted` or a refusal; the gate is otherwise unchanged. pinned by: `kernel/test/agents-charter-connectors.test.ts` (`/^approval_required: held as approval 1;/`).
- **`kernel/src/agents/roster.ts`** — keep: `charterProse` returns `null` when `charter_json` does not parse (`return isBodyObject(c) ? { persona:`); it now maps a duty entry to its `text` so the API detail (app Team inspector) and `formatAgent` show duty text, not "not read"; bare-string duties unchanged.
- **`kernel/src/features/contribution.ts`** — comment only: keep the `beforeHold` contract text in step with `HeldToolVerdict` (anchor `` `{display,
 * subjectVersion?}` holds it with that text for the owner``, extended with `agentNote?`); no code change, so `mergeContributions`' checks (`a tool \`job\` outside \`TOOL_JOBS\``) are untouched.
- **`app/src/screens/approvals/approvals.css`** — keep: existing classes (`approvals-charter-plain`, `approvals-charter-jobs`) unchanged; any new readiness class uses the token variables from `app/src/styles/tokens.css` (`--attention`, `--attention-soft`), never a raw colour.
- **`app/e2e/fixtures/approvals.ts`** — keep: the existing held-display shapes the Playwright specs assert on stay as they are (they model approvals held before this change, which must render exactly as today); add a readiness block only to a new fixture a spec asserts on.
- **`app/src/screens/approvals/subject.ts`** — keep: `charterDisplayParts` returns `undefined` for a display not in the kernel's format, and a display with no readiness block splits exactly as today (approvals held before this change). mirror: the readiness line prefixes are the kernel's exported constants in `kernel/src/agents/charter-readiness.ts`, pinned by `subject.test.ts` reading that file (`nodeFs.readFileSync(` pattern, as for `kernelCatalogue`).
- **`app/src/screens/approvals/CharterDisplay.tsx`** — keep: every part goes through `printable` and is rendered as a text child (`Every part is untrusted text: it goes through \`printable\``); colour only via `Badge` tones (the rule lives in `app/src/components/Badge/Badge.tsx`: `Semantic colour is only` for a kernel state — readiness is a kernel state, so `attention`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-charter-readiness.test.ts` — AC2 approval #19 flags exactly triage and merge | delete the workspace/coverage check line in `kernel/src/agents/charter-readiness.ts` that compares a duty's `jobs` against the granted jobs (the duty then reads covered) |
| `kernel/test/agents-charter-readiness.test.ts` — AC3 code job without workspace | remove `ask_for_merge`'s workspace need from its job definition in `kernel/src/features/catalogue.ts` (the merge-only charter then reads ready) |
| `kernel/test/agents-charter-readiness.test.ts` — AC9 unknown job refused | drop the unknown-job refine on duty `jobs` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC10 unreadable workspace | make the readiness workspace read return "not a checkout" on a read error in `kernel/src/automate/checkout.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC8 applied sentence | delete the open-flags clause from the create applier's `applied` text in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — no-flag hold has no note | always set `agentNote` in `kernel/src/agents/charter-tools.ts` |
| `app/src/screens/approvals/subject.test.ts` — readiness prefixes pinned to the kernel file | flip the flag prefix constant's text in `app/src/screens/approvals/subject.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC1 all covered and ready, nothing flagged | make the code-job workspace check in `kernel/src/agents/charter-readiness.ts` always report "no copy of a repo" (the fully ready charter then shows a flag) |
| `kernel/test/agents-charter-readiness.test.ts` — AC4 `jobs: []` covered with no tool | delete the `jobs.length === 0` covered-with-no-tool branch in `kernel/src/agents/charter-readiness.ts` (the duty then reads flagged) |
| `kernel/test/agents-charter-readiness.test.ts` — AC5 protected workspace never ready (`homeDir` seam) | delete the `isProtectedPath` call in `kernel/src/agents/charter-readiness.ts` (the protected checkout then reads ready) |
| `kernel/test/agents-charter-readiness.test.ts` — AC5 plain-words hold refusal | flip `is inside a macOS-protected folder` → `is not allowed` in `kernel/src/agents/charter-files.ts` (or the reworded text that replaces it) |
| `kernel/test/agents-charter-readiness.test.ts` — AC6 connector named as the owner's step, not in the note | delete the connector-need clause (the `requiresConnector` read) in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC7 update removing a duty's job | compute the update's granted jobs from the member's old `heldTools` instead of the merged `tool_policy.allowedTools` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC11 duty text never adds a job | read job ids out of a duty's `text` as well as its `jobs` in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — AC14 legacy bare-string duty flagged | treat a bare-string duty as covered in `kernel/src/agents/charter-readiness.ts` |
| `kernel/test/agents-charter-tools.test.ts` — changed held-reason pin (`do not repeat the call\.$` for a no-flag charter; note appended for a flagged one) | flip `` `approval_required: held as approval ${outcome.id}; it did not run. `` → `` `approval_required: held as approval ${outcome.id}; it ran. `` in `kernel/src/sessions/manager.ts` |
| `app/src/screens/approvals/subject.test.ts` — a display with no readiness block splits exactly as before | make `charterDisplayParts` in `app/src/screens/approvals/subject.ts` return `undefined` when no readiness line is present |
| `app/src/screens/approvals/CharterDisplay.test.tsx` — flagged line in attention tone | flip `tone="attention"` → `tone="neutral"` in `app/src/screens/approvals/CharterDisplay.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: duty entries, job needs, readiness check, hold note, applied sentence, docs | AC1–AC11, AC13, AC14, AC15 (kernel half) | 9 modify (+ bare-string fixtures in kernel tests that call `kernel_agent_create`), 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: readiness block on the Approvals card | AC12, AC15 (app half) | 4 modify (+ `app/e2e/fixtures/approvals.ts` if a held display there gains the block) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| catalogue | `kernel/src/features/catalogue.ts` (319) — job-definition record (label + workspace need), `TOOL_JOBS` derived | — | HIGH |
| charter schema | `kernel/src/agents/charter-files.ts` (569 — the single authority for the charter schema; the duty-entry rule and its unknown-job refine belong beside `charterSchema`) | — | HIGH |
| readiness (new responsibility) | — | `kernel/src/agents/charter-readiness.ts` — the readiness check (duties × granted jobs, job prerequisites, connector grant via `parseConnectorsGrant`, workspaces via `checkout.ts`, protected via `isProtectedPath`), its display lines, their exported prefix constants, the `agentNote` text, and Wright's bare-string refusal | HIGH |
| charter tools wiring | `kernel/src/agents/charter-tools.ts` (964 — wiring only: call the readiness module from create/update `beforeHold` and appliers, readiness lines in the head/display, `agentNote` on the verdict, open flags in the applied sentence, create description names duty entries; the logic lives in `charter-readiness.ts`) | — | HIGH |
| workspace read | `kernel/src/automate/checkout.ts` (72) — a remotes read that reports unreadable vs not-a-checkout | — | HIGH |
| protected paths | `kernel/src/protected-paths.ts` (132) — reused, change only if a plain-words reason helper is needed | — | LOW |
| gate note | `kernel/src/sessions/types.ts` (663 — `HeldToolVerdict`'s single home), `kernel/src/sessions/manager.ts` (3236 — `checkedVerdict` and the held reason are the gate's single authority; a few lines), `kernel/src/features/contribution.ts` (doc comment only) | — | HIGH |
| roster prose | `kernel/src/agents/roster.ts` (759 — `charterProse` is the one reader of stored prose for the API and CLI; a one-line map) | — | HIGH |
| kernel tests | `kernel/test/agents-charter-tools.test.ts` (1222 — only its changed pins and fixtures; new cases go to the new file) and the other kernel tests whose fixtures send bare-string duties through `kernel_agent_create` (worker finds them by running the suite; candidates from `grep -ln kernel_agent_create kernel/test`) | `kernel/test/agents-charter-readiness.test.ts` (AC1–AC11, AC2 on approval #19's charter) | MEDIUM |
| docs | `docs/architecture/agents.md` (330) | — | HIGH |
| app card | `app/src/screens/approvals/subject.ts` (309), `app/src/screens/approvals/subject.test.ts` (345), `app/src/screens/approvals/CharterDisplay.tsx` (110), `app/src/screens/approvals/CharterDisplay.test.tsx` (366); `app/e2e/fixtures/approvals.ts` only if needed | — | HIGH |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/agents/charter-readiness.ts"}
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "charterReadiness"}
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "READINESS_FLAG_PREFIX"}
  - {kind: "file", path: "kernel/test/agents-charter-readiness.test.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "agentNote"}
requires: []
lanes:
  - "kernel/src/features/catalogue.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/agents/charter-files.ts"
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/src/agents/charter-readiness.ts"
  - "kernel/src/agents/roster.ts"
  - "kernel/src/automate/checkout.ts"
  - "kernel/src/protected-paths.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/**"
  - "docs/architecture/agents.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "app/src/screens/approvals/subject.ts", name: "readiness"}
  - {kind: "symbol", path: "app/src/screens/approvals/CharterDisplay.tsx", name: "READINESS_HEADING"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "READINESS_FLAG_PREFIX"}
lanes:
  - "app/src/screens/approvals/subject.ts"
  - "app/src/screens/approvals/subject.test.ts"
  - "app/src/screens/approvals/CharterDisplay.tsx"
  - "app/src/screens/approvals/CharterDisplay.test.tsx"
  - "app/src/screens/approvals/approvals.css"
  - "app/e2e/fixtures/approvals.ts"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 2 ──→ Subtask 1   (the card parses the kernel's readiness line prefixes)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 reads `charter-readiness.ts` in its test, never edits it) | YES (dependency) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/integrations/github/write-tools.ts:98` | yes | HOLDS | `job: "triage_pr_comments",` | tip 45 minutes ago, fetched <1h |
| `kernel/src/automate/routing.ts:167` | yes | HOLDS | `job: "triage_pr_comments",` | tip 45 minutes ago, fetched <1h |
| `kernel/src/automate/runner.ts:194` | yes | HOLDS | `job: "ask_for_merge",` | tip 45 minutes ago, fetched <1h |
| `kernel/src/automate/runner.ts:21-25` | yes | HOLDS | `// The checkout (\`checkout.ts\`) is the calling agent's workspace for the repo: one` … `Without one, \`no_workspace\`.` | tip 45 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): telling Wright the result needs a new optional `HeldToolVerdict` key in the kernel gate, outside Touches | MEDIUM | One optional string, appended only on `approval_required`; `checkedVerdict` still fails closed on anything else; no-flag holds byte-identical (pinned) |
| Feasibility (Phase 2.5): converting bare-string duty fixtures in kernel tests that call `kernel_agent_create` widens the diff | MEDIUM | Only Wright's create refuses bare strings; owner create, CLI and stored rows keep strings, so only Wright-path fixtures change; run the whole kernel suite |
| Wright marks a real duty "no job needed" to avoid a flag (requirement risk) | MEDIUM | The card shows it as "covered with no tool", where the owner can question it |
| A workspace ready at drafting time moves later (requirement risk) | LOW | The run-time `no_workspace` refusal in `checkout.ts` stays; this is the early warning |
| The readiness block pushes a create head or update display over `MAX_APPROVAL_DISPLAY` (20 duties × 300 chars) | MEDIUM | The block is in the head the owner must see whole; an over-long one is refused `invalid_input` as item 16's head check does (requirement assumption); `updateFloor` must still bound it |
| "A workspace whose remote names the repo" read as "any GitHub remote, named on the card" (design decision 3) | MEDIUM | The card names the repos found so the owner sees a wrong one; the owner may ask for an explicit repo field in review |
| AC5 on the card: a protected workspace can't be held (design decision 4) | LOW | The plain-words hold refusal is the live path; the readiness check still never says "ready" for one |
| Approval #19's exact charter is in the owner's data dir, not the repo | LOW | AC2's fixture is reconstructed from the requirement's Problem section; the owner can paste the real one in review |
| Validation 2 (packaged app, live Wright) is an owner walk | MEDIUM | Not runnable by a worker; the owner reports the card after merge-readiness |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-10-charter-readiness-check.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-11T04:45:09Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/257
- **Branch:** feature/charter-readiness-check
- **Files changed:** 27
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel readiness check for held charter creates/updates (duty entries {text, jobs}, job workspace/connector prerequisites, agentNote to Wright, open flags in the applied sentence) plus the readiness block on the Approvals card. Subtask 1's first worker failed twice (network error, then a stall); the owner chose a fresh retry, which kept its work. Phase 4.5: round 1 PASS with one MEDIUM (connector logic duplicated from playbooks/fit.ts), fixed in 05aa742d by sharing it from features/catalogue.ts; round 2 PASS (one LOW dismissed). All 18 pin mutations held (reviewer-applied). Kernel 4364 tests, app 3157 unit + 348 e2e, check-docs pass. Dismissed: pre-existing unanchored GitHub host in repoOfRemote (MEDIUM), two LOWs.

## Not verified
- **app Approvals card (CharterDisplay.tsx) rendering the readiness block** — Subtask 2's lane, not built yet when subtask 1 finished (subtask 1)
- **packaged-app owner walk (Validation 2)** — needs the packaged app and a live Wright session (subtask 1)
- **thread inline approval card (chat)** — it does not use charterDisplayParts, so readiness lines show there as raw display text (subtask 2)
- **app/src/screens/approvals/ApprovalsScreen.tsx:20-23 header comment** — still describes the plain block as only the jobs; out of lane (subtask 2)
- **packaged app with a live Wright (Validation 2)** — owner walk; no local runtime for it (subtask 2)
