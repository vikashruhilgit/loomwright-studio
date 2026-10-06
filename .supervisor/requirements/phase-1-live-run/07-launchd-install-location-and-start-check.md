# H07: The launchd kernel runs from an unprotected install dir, install proves it started, and protected repos are refused

## Status: ready

**Priority:** MVP · **Blocks the phase 1 live exit run**

## Story

As the owner, I want `studio service install` to run the kernel from a place launchd can read, and to report success only when the kernel actually answers, so that the background kernel works no matter where the repo lives and a broken install is never reported as working (D31).

## Evidence (verified on the owner's Mac on 2026-10-06, `main` at 77775c8)

- The plist runs the build in place. `daemonPath` defaults to the repo's `dist/daemon.js` (`kernel/src/service/launchd.ts:320`) and `nodePath` defaults to `process.execPath` (`:191-192`). This repo is in `~/Documents`, so the kernel exited at once under launchd with `EPERM … open '…/kernel/dist/daemon.js'`. A throwaway `launchctl submit` job with the same `node` reproduced it: reading the repo file failed with `EPERM`, while reading a file in `/private/tmp` succeeded. The terminal can read `~/Documents`; a background launchd job can't (macOS privacy protection, TCC).
- `service install` printed "installed and loaded" (`kernel/src/cli/index.ts:353`) while launchd showed `last exit code = 1` and `state = spawn scheduled`. Nothing checks that the kernel came up.
- The plist's `node` was `/Users/vikashruhil/.nvm/versions/node/v22.14.0/bin/node`. That's an nvm path, which breaks if that version is removed.

## Acceptance criteria

1. **Given** `studio service install`, **when** it runs, **then** it copies the built kernel (`dist/` plus the production `node_modules` it needs at runtime, including `better-sqlite3`'s native binary) to `~/.loomwright-studio/app/<kernel version>/`, or under `STUDIO_DATA_DIR` when that's set, and points `ProgramArguments` at the copy. The copy is written to a temporary directory and renamed into place, so a half-written copy is never used. Re-installing the same version replaces it. Older versions are removed only after the new agent has started.
2. **Given** the install target, **when** it resolves to a macOS-protected location (under `~/Documents`, `~/Desktop`, `~/Downloads`, or `~/Library/Mobile Documents`), **then** install refuses and names D31. This guards against `STUDIO_DATA_DIR` pointing into one.
3. **Given** a loaded agent, **when** install finishes, **then** it waits (bounded, ≤ 15 s) until the kernel answers `GET /status` on the loopback API.
   - If it answers, install prints the installed path and the kernel version.
   - If it doesn't, install prints the last 20 lines of `kernel.err.log` and the agent's `last exit code` from `launchctl print`, exits non-zero, and **unloads the agent** so it can't restart in a loop.

   "Installed and loaded" is printed only on a verified start.
4. **Given** `nodePath` under `~/.nvm/`, `~/.volta/`, `~/.asdf/`, or another version-manager directory, **when** install runs, **then** it prints a one-line warning that the agent breaks if that Node version is removed. Install still proceeds; there's no new flag.
5. **Given** a session start (item 05's `startSession` and resume), **when** its `cwd` is inside a protected location (same list as AC 2), **then** the session manager refuses with `SessionError("protected_cwd", …)` naming D31. Nothing is spawned. The refusal is appended to `events`.
6. **Given** `studio service uninstall`, **when** it runs, **then** it also removes `~/.loomwright-studio/app/`. Data, logs and the store are kept.
7. Unit tests, with injected `exec` and filesystem, cover:
   - the copy and its atomic rename;
   - the protected-target refusal;
   - the start check passing, and failing with log tail plus unload;
   - the nvm warning;
   - the `protected_cwd` refusal.

   No test runs `launchctl`.
8. `README.md` ("Run the kernel as a launchd agent") states the install location, the start check and D31's rule about repo locations.

## Out of scope

A signed app bundle, a login item through `SMAppService`, and Full Disk Access (all excluded by D31).

## Dependencies

None (H01–H06 merged).

## Risks

- Copying `node_modules` must include `better-sqlite3`'s compiled `.node` file for this machine's architecture. Verify by starting the copy, which is exactly what AC 3 does.
- The protected-folder list is macOS policy and may grow; keep it in one constant with a comment linking D31.
