# 02 — Loomwright adapter: sessions load the ACTIVE Loomwright, read its capability contract, and run in host mode

## Status: ready

**Priority:** MVP · ROADMAP phase 2 "capability manifest" · D32 (supersedes D13's mechanism) · invariants 3, 4

**As** the owner,
**I want** every Studio session to load the Loomwright install Claude Code itself treats as active, to know what that Loomwright can do from its published `capabilities.json`, and to run with Loomwright's host switch on,
**so that** Wright plans with Loomwright's real, current capabilities, and no Studio agent writes Loomwright's hook files into my repos.

## Problem

- `kernel/src/sessions/loomwright-path.ts` picks the **numerically newest folder** under `~/.claude/plugins/cache/atelier/loomwright/`, which D32 rules out: the cache holds 24 versions, and the newest folder isn't necessarily the active one.
- Nothing reads `capabilities.json`, so a session knows nothing about Loomwright's agents, commands, skills or result schemas.
- Probe p9 (2026-10-06) showed Loomwright's SessionStart writes `.claude/settings.local.json` and `.supervisor/logs/` into the session's repo; the owner's own sessions then read that settings file. Loomwright now declares a host switch (vikashruhilgit/loomwright#468): with `LOOMWRIGHT_HOST_MODE=1`, no hook writes the session's working tree, and state goes to `LOOMWRIGHT_HOST_STATE_DIR`. That is Loomwright's declaration; nobody has verified it from Studio.

Verified 2026-10-14 on the owner's Mac: `~/.claude/plugins/installed_plugins.json` lists `loomwright@atelier` at 17.2.0 (scope `user`), whose install has `capabilities.json` (`plugin_version` 17.2.0, `contract_schema_version` 1; fields `plugin_name`, `plugin_version`, `generated_by`, `agents`, `commands`, `skills`, `result_schemas`, `hooks` (48, each with `event`, `matcher`, `script(s)`, `writes`, `host_mode`), `host_switch` {`env`, `state_dir_env`, `effect`}). The installed **17.0.0** copy, briefly active on 2026-10-13, shipped **without** `capabilities.json`.

## Scope

1. **Resolve the active install** from `installed_plugins.json` (path injectable for tests): the `loomwright@<marketplace>` entry's `installPath` and `version`. Precedence when several scopes list it: follow Claude Code's documented precedence if one is found; otherwise refuse with a clear error naming the entries (never guess). A configured path (phase 1's `loomwrightPath` option) still wins when set, and must hold a contract.
2. **Never fall back** to scanning the cache for the newest folder. Remove that code path.
3. **Read and validate the contract**: refuse with a typed, reported error when the file is missing, unreadable, not JSON, missing a required field, or its `contract_schema_version` is below the minimum this kernel supports (1). Tolerate unknown fields. The error names the install path and the reason; a session start fails cleanly (nothing spawned, one `session_refused` event with reason `loomwright_contract`), and `GET /status` shows the adapter's state (`ok` with version and schema, or the error).
4. **Host mode on every session**: the child environment carries the contract's `host_switch.env` set to `1` and its `state_dir_env` set to a per-session directory under the Studio data dir (created before spawn). The variable names come from the contract, never hard-coded. A contract with no `host_switch` refuses the session (Studio must not run Loomwright without it).
5. **`kernel_loomwright_capabilities`** tool (through item 01's seam): returns the active version, contract schema version and the agents / commands / skills / result-schema names with their one-line descriptions, and hook count by `host_mode`, read from the contract, never from Loomwright's other files. Also export a short manifest summary (names + one-liners, bounded size) that item 06 puts into Wright's session context.
6. **Probes, run by the owner, recorded in a committed evidence file:**
   - Rerun `probes/p9-loomwright-hooks.mjs` with host mode on (add a flag) in a throwaway repo; record whether the repo's working tree stays clean (`git status --porcelain --ignored` before and after) and what landed in the state dir.
   - A new `probes/p10-desktop-plugin-install.mjs` (read-only): report whether a plugin installed through the Claude desktop app appears in `installed_plugins.json`, and how project- and local-scope installs appear. If the desktop-app case can't be covered, the evidence says so explicitly.

## Non-goals

- The version-change note (item 07).
- Parsing Loomwright's `plugin.json`, frontmatter, `hooks.json` or `CHANGELOG.md` (D32 forbids it).

## Acceptance criteria

- [ ] Given an `installed_plugins.json` naming 17.2.0 and a cache holding 17.2.0 and a newer folder 99.0.0, when a session starts, then it loads 17.2.0 (the session row's Loomwright path says so).
- [ ] Given the active install has no `capabilities.json` (fixture modelled on the real 17.0.0 copy), when a session starts, then it is refused with `loomwright_contract` naming the path and "capabilities.json missing", nothing is spawned, and `/status` shows the adapter error; no other install's contract is used.
- [ ] Given a contract with `contract_schema_version` 0, or missing `plugin_version`, or not JSON, then the same refusal with the specific reason.
- [ ] Given a contract with extra unknown top-level and per-hook fields, then it is accepted and the unknown fields are ignored.
- [ ] Given `installed_plugins.json` missing or unparseable and no configured path, then sessions are refused with a clear error naming the file; the kernel itself still starts and answers `/status`.
- [ ] Given a valid contract, when a session starts, then its environment has `LOOMWRIGHT_HOST_MODE=1` and `LOOMWRIGHT_HOST_STATE_DIR=<dataDir>/…/<session>` (names read from the contract fixture, proven by a fixture that renames them), and the directory exists.
- [ ] Given a contract without `host_switch`, then the session is refused with reason `loomwright_no_host_switch`.
- [ ] `kernel_loomwright_capabilities` returns the fixture contract's names and descriptions; its output never includes file paths from Loomwright's internals beyond the install path.
- [ ] `docs/evidence/phase-2-loomwright-host-mode.md` records the p9 rerun with host mode on (repo clean or not, with the `git status` output) and the p10 desktop-app findings; the PR body links it.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`
- Owner: `node probes/p9-loomwright-hooks.mjs --host-mode` and `node probes/p10-desktop-plugin-install.mjs`; outputs pasted into the evidence file.

## Assumptions

- `installed_plugins.json` is an internal Claude Code file, not a documented contract (OPEN_QUESTIONS). The adapter isolates its parsing in one function so a format change breaks one place.

## Risks

- If host mode does NOT keep the repo clean, Studio sessions must not run Loomwright in the owner's repos until Loomwright fixes it. The evidence file records it, and the owner decides; this item does not work around it.

## Depends on
2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md

## Touches
kernel/src/loomwright/
kernel/src/sessions/loomwright-path.ts
kernel/src/sessions/manager.ts
kernel/test/loomwright-adapter.test.ts
kernel/test/sessions.test.ts
kernel/test/fixtures/loomwright/
probes/p9-loomwright-hooks.mjs
probes/p10-desktop-plugin-install.mjs
docs/architecture/loomwright.md
docs/evidence/phase-2-loomwright-host-mode.md
