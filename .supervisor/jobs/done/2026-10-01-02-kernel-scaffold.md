# Supervisor Job: Kernel package scaffold (`kernel/`)

## Environment
- **Project:** /Users/vikashruhil/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh — item 01 merged e6773ed)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 / 10.9.2
- **Blockers:** 0 | **Warnings:** 1 (this PR edits `.github/workflows/ci.yml`, so the `claude-review` action skips itself on it — see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-1/02-kernel-scaffold.md
- **Base commit:** e6773ed79f52ba668c22d3b25d664b6c5881cd67

## Feasibility
- **Verdict:** CAUTION — greenfield TypeScript package, no existing code to conflict with. Two cautions: (1) `better-sqlite3` builds natively (prebuilt binaries normally download; CI `ubuntu-latest` has a toolchain as fallback); (2) the existing CI TypeScript steps are keyed on a ROOT `package.json`, which this item does not create, so AC4 needs kernel-specific steps.

## Task
**Goal:** Create a minimal, typed, tested TypeScript package in `kernel/` (strict TS, vitest, pinned Agent SDK 0.3.284, `better-sqlite3`, `zod`), a buildable `daemon.js` entry point, empty module folders, CI typecheck + unit tests for `kernel/`, and update CLAUDE.md's "pre-code" line.

**Problem Statement:**
The owner and every later phase-1 item (03–09) need a consistent package structure with tests and CI from day one.
Currently the repo has no code — only `docs/`, `scripts/check-docs.sh` and a one-off `probes/` package. This causes each later item to invent its own layout and leaves CI unable to check kernel code.
Success looks like `npm ci && npm test` and `npm run build` working in `kernel/`, CI failing the `ci` check if kernel typecheck or tests fail, and CLAUDE.md describing `kernel/`.

## Acceptance Criteria
- [ ] AC1 — Given a clean clone, when `npm ci && npm test` runs in `kernel/`, then it installs and a placeholder test passes. `kernel/package.json` declares `"engines": { "node": ">=22" }`.
- [ ] AC2 — Given the package, when it's inspected, then: `kernel/tsconfig.json` has `"strict": true`; vitest is the test runner; `@anthropic-ai/claude-agent-sdk` is pinned to exactly `"0.3.284"` (no caret/tilde — same pin as `probes/package.json`); `better-sqlite3` (D30) and `zod` are dependencies. `zod` must satisfy the SDK's peer range `^4.0.0`. A `kernel/package-lock.json` is committed (required by `npm ci`).
- [ ] AC3 — Given `npm run build` in `kernel/`, when it completes, then it emits `kernel/dist/` containing `kernel/dist/daemon.js`; `node kernel/dist/daemon.js --version` logs exactly one line (the package version) and exits 0.
- [ ] AC4 — Given a PR, when CI runs, then the existing `ci` job in `.github/workflows/ci.yml` also runs typecheck and unit tests for `kernel/` and the job fails if either fails. CI needs no token and calls no model. The job keeps its name `ci` (it is the required check on `main`).
- [ ] AC5 — Given `CLAUDE.md`, when it's read, then the sentence starting "The repo is **pre-code**" is replaced by one line describing `kernel/` and how to run its tests (`cd kernel && npm ci && npm test`). Nothing else in CLAUDE.md changes except what that replacement requires.
- [ ] AC6 — Given `.gitignore`, when `git check-ignore kernel/node_modules kernel/dist` runs, then both are ignored. (The root `node_modules/` and `dist/` patterns already cover them — verified at planning time; add nothing unless that check fails.)
- [ ] AC7 — Given `kernel/src/`, when it's listed, then it has the module folders `store/`, `auth/`, `sessions/`, `budget/`, `loop/`, `api/`, `cli/`, each with an `index.ts` that exports nothing yet (`export {};`).

## Outcomes Rubric
- `kernel/package.json` has `"@anthropic-ai/claude-agent-sdk": "0.3.284"` (exact), `better-sqlite3`, `zod` (^4) and `engines.node` `>=22`, and scripts `build`, `test`, `typecheck`.
- `kernel/tsconfig.json` sets `"strict": true` and the build emits to `dist/` with `dist/daemon.js` as the entry.
- `kernel/src/{store,auth,sessions,budget,loop,api,cli}/index.ts` all exist and contain no exports beyond `export {};`.
- `.github/workflows/ci.yml` job `ci` has kernel steps (install, typecheck, test) with `working-directory: kernel`, and the job name `ci` is unchanged.
- `CLAUDE.md` no longer contains "The repo is **pre-code**" and names `kernel/` and its test command.
- The PR adds no root `package.json`, no `.gitignore` change, and no file outside `kernel/`, `.github/workflows/ci.yml`, `CLAUDE.md` and `docs/requirements/phase-1/` (the last only for a requirement status stamp).

## Implementation Notes (verified at planning time)
- **Versions available today:** `better-sqlite3` 13.0.3 (engines node >=22), `zod` 4.6.5, `vitest` 5.0.3 (engines `^22.12.0 || ^24 || >=26` — fine for Node 22.14 locally and `node-version: 22` in CI), `@types/node` 22.x, `@types/better-sqlite3` 9.6.0. `typescript` latest is 7.0.2 — if 7.x's `tsc` misbehaves, pin the latest 5.x instead and say so in the PR body. Use caret ranges for everything EXCEPT the SDK, which is exact.
- **SDK peers:** `@anthropic-ai/claude-agent-sdk@0.3.284` declares peers `@anthropic-ai/sdk >=0.93.0`, `@modelcontextprotocol/sdk ^1.29.0`, `zod ^4.0.0`. npm ≥7 auto-installs peers; `npm ci` must succeed without `--legacy-peer-deps`.
- **Module format:** ESM (`"type": "module"`, `module`/`moduleResolution` `NodeNext`), matching `probes/` which is ESM.
- **Entry point:** `kernel/src/daemon.ts` → `dist/daemon.js`. With `--version`, print the version from `package.json` (read at runtime relative to the file, or via `createRequire`) and exit 0. Without `--version`, it may log one "not implemented" line and exit 0 — nothing runs a session in this item.
- **Placeholder test:** e.g. `kernel/test/daemon.test.ts` that asserts the version helper returns `package.json`'s version. Unit tests never call the real SDK or a model (backlog rule).
- **Tests must not import `better-sqlite3`** in this item (no store code yet); the dependency only needs to install.
- **CI design (AC4):** add steps to the existing `ci` job, gated on `hashFiles('kernel/package.json') != ''`: `actions/setup-node@v4` with `node-version: 22`, `cache: npm`, `cache-dependency-path: kernel/package-lock.json`; then `npm ci`, `npm run typecheck`, `npm test`, each with `working-directory: kernel`. Leave the existing root-`package.json` steps in place (dormant) — do not delete them. Only one `setup-node` should run when both exist; since no root `package.json` is added, the root steps stay skipped.
- **package-lock:** generate with `npm install` inside `kernel/` (local Node 22.14 / npm 10.9) and commit it; then verify `rm -rf node_modules && npm ci && npm test && npm run build && node dist/daemon.js --version` from a clean state.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Scaffold `kernel/` package, CI steps, CLAUDE.md line | AC 1–7 | 2 modify, ~14 create | unit-testing, ci-cd | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — Kernel scaffold (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/package.json"}
  - {kind: "file", path: "kernel/package-lock.json"}
  - {kind: "file", path: "kernel/tsconfig.json"}
  - {kind: "file", path: "kernel/src/daemon.ts"}
  - {kind: "file", path: "kernel/src/store/index.ts"}
  - {kind: "file", path: "kernel/src/auth/index.ts"}
  - {kind: "file", path: "kernel/src/sessions/index.ts"}
  - {kind: "file", path: "kernel/src/budget/index.ts"}
  - {kind: "file", path: "kernel/src/loop/index.ts"}
  - {kind: "file", path: "kernel/src/api/index.ts"}
  - {kind: "file", path: "kernel/src/cli/index.ts"}
  - {kind: "file", path: ".github/workflows/ci.yml"}
  - {kind: "file", path: "CLAUDE.md"}
requires: []
lanes:
  - "kernel/**"
  - ".github/workflows/ci.yml"
  - "CLAUDE.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `unit-testing` (vitest placeholder), `ci-cd` (GitHub Actions steps). Read `CLAUDE.md` invariants, `docs/DECISIONS.md` D30, `docs/requirements/phase-1/_BACKLOG.md` rules |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): `better-sqlite3` native build fails in CI (no prebuilt for the runner's Node ABI) | MEDIUM | `ubuntu-latest` ships build-essential + python, so node-gyp fallback works; if CI still fails, use a prebuilt-binary approach — never switch libraries without the owner (requirement Risks) |
| Feasibility (Phase 2.5): existing CI TS steps key on a root `package.json`; adding one would also activate them and break on missing scripts | MEDIUM | Add kernel-specific steps with `working-directory: kernel`; do not create a root `package.json` |
| Editing `.github/workflows/ci.yml` makes `anthropics/claude-code-action` skip itself on this PR (green, no review posted) | MEDIUM | Expected; the owned until-mergeable drain's earned-fallback code review covers it. Note it in the PR body |
| Lockfile generated on macOS missing linux optional binaries for the SDK | LOW | npm 10 records all platform `optionalDependencies` in the lockfile; CI `npm ci` proves it |
| TypeScript 7.x (native port) incompatibility | LOW | Fall back to latest 5.x and record why in the PR body |
| Accidentally touching the auth surface / adding any session-running code | LOW | Out of scope per requirement; module folders export nothing |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-01-02-kernel-scaffold.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-01T00:31:36Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/6
- **Branch:** feature/phase1-02-kernel-scaffold
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel/ scaffolded (strict TS 7, vitest 5, SDK 0.3.284 exact, better-sqlite3, zod ^4); ci job gains kernel install/typecheck/test; CLAUDE.md pre-code line replaced. Review PASS (3 MEDIUM, 3 LOW, 0 HIGH); rubric 6/6; risk high_risk:true (advisory). Requirement close-out noop_unresolved (requirement lives under docs/, not .supervisor/requirements/).

## Not verified
- **.github/workflows/ci.yml kernel steps on ubuntu-latest** — no Actions run at worker time; since verified green on bb9c821 by the reviewer (subtask 1)
