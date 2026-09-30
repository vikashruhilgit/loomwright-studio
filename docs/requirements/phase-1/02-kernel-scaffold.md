# 02: Kernel package scaffold

## Status: ready

**Priority:** MVP

## Story

As the developer, I want a minimal, typed, tested TypeScript package for the kernel daemon, so that every later item lands in a consistent structure with tests and CI from day one.

## Acceptance criteria

1. **Given** a clean clone, **when** `npm ci && npm test` runs in `kernel/`, **then** it installs and a placeholder test passes. Node ≥ 22 is declared in `engines`.
2. **Given** the package, **when** it's inspected, **then** it has:
   - TypeScript with `strict: true`;
   - vitest for tests;
   - `@anthropic-ai/claude-agent-sdk` pinned to the exact version the probes used (0.3.284; no caret);
   - `better-sqlite3` (D30) and `zod`.
3. **Given** `npm run build`, **when** it completes, **then** it emits `kernel/dist/` with an entry point `kernel/dist/daemon.js` that starts, logs one line, and exits 0 when run with `--version`.
4. **Given** a PR, **when** CI runs, **then** the existing `ci` workflow also runs typecheck and unit tests for `kernel/`, and fails the check if either fails. CI never needs a token and never calls a model.
5. **Given** `CLAUDE.md`, **when** it's read, **then** "The repo is **pre-code**" is replaced by a one-line description of `kernel/` and how to run its tests.
6. **Given** `.gitignore`, **when** `git check-ignore kernel/node_modules kernel/dist` runs, **then** both are ignored (the root `node_modules/` and `dist/` patterns already cover them; add nothing unless that check fails).
7. **Given** `kernel/src/`, **when** it's listed, **then** it has the module folders later items fill (`store/`, `auth/`, `sessions/`, `budget/`, `loop/`, `api/`, `cli/`), each with an `index.ts` that exports nothing yet.

## Out of scope

Electron, packaging, and anything that runs a session.

## Dependencies

01.

## Risks

`better-sqlite3` compiles natively on install. If CI lacks a toolchain, use a prebuilt binary; don't switch libraries without the owner.
