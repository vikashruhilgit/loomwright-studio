# Supervisor Job: H01 — launchd start failures don't loop, reinstall is reliable, the live exit test can't flake or leak

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariants 1, 2 and 3 apply: a start failure must never hide its cause, the kernel owns its own lifecycle, unit tests never touch the real `launchctl`/Keychain)
- **Git:** clean except the automate engine's untracked trail files (`.supervisor/automate/automate-2026-10-03-180512.md`, `.supervisor/requirements/phase-1-hardening/`). Never stage them in this job; commit with explicit paths only. Branch: main @ 4429d4b
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest, `.github/workflows/ci.yml`; kernel steps run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` in `kernel/`)
- **Blockers:** 0 | **Warnings:** 1 (untracked trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1-hardening/01-launchd-start-failure-and-reinstall.md
- **Base commit:** 4429d4b

## Feasibility
- **Verdict:** CAUTION
- Tech stack — GO: strict TypeScript kernel (NodeNext, vitest). The plist is plain XML; `launchctl` runs through the injected `ServiceExec`; no new package.
- Dependencies — GO: none new.
- Architecture fit — GO: D11 (launchd service). `docs/ARCHITECTURE.md:128` documents the current `KeepAlive {SuccessfulExit: false}` behaviour this item changes.
- Scope — GO: one worker; ~11 files modified (source, tests, docs) and 2 created (`kernel/src/daemon-exit.ts`, `kernel/test/daemon-exit.test.ts`), plus possibly a fake-`launchctl` test fixture.
- Hard blockers — CAUTION: CI can't run launchd, so whether `bootout` is asynchronous (AC4's real-world motivation) stays unverified until the owner's run (requirement "Risks"). `launchd.plist(5)` has no "don't restart on exit code N" key, so the restart split in AC1–3 must be built from `SuccessfulExit` (exit 0 = not restarted) — see Design 1.

## Task
**Goal:** Make a kernel that fails to start under launchd stop cleanly (permanent failures) or retry at most once a minute (failures that may clear by themselves), make a graceful stop whose teardown throws not restart, make `studio service install` reliable when the job is already loaded (poll after `bootout`, retry `bootstrap` once on exit status 5, report the real status and stderr), make the opt-in live exit test unable to race or leak, and cover the untested `launchd.ts` / CLI paths. Docs say how start failures behave under launchd.

## Acceptance Criteria
- [ ] AC1 — Given a start failure that a retry can't fix (canonical case: the store lock held by another live kernel, `StoreLockedError`), when the daemon exits under launchd, then launchd doesn't restart it, and the daemon writes one stderr line naming the cause.
- [ ] AC2 — Given a start failure that may clear by itself (e.g. a Keychain read failing — `KeychainError`), when the daemon exits under launchd, then launchd restarts it no more than once every 60 s, and each failure writes one line naming the cause. The plist sets `ThrottleInterval` 60, and the unit test that reads the generated plist pins the value.
- [ ] AC3 — Given a graceful SIGTERM whose teardown throws, when the daemon exits under launchd, then the exit doesn't start a restart loop, and the teardown error is logged.
- [ ] AC4 — Given `studio service install` with the job already loaded, when it runs, then after `bootout` it polls `launchctl print` until the job is gone, bounded (≤ 5 s); then runs `bootstrap`, retrying once if it exits with status 5; if it still fails, it reports the real exit status and launchctl's stderr. Unit tests cover the poll, the retry and the final failure with an injected `exec`.
- [ ] AC5 — Given the live exit test (`STUDIO_LIVE=1`), when it sends the kill, then it first confirms that `sleep` is running in the session's process group (e.g. a `ps` of the group); the comment "(the command is running)" is then true.
- [ ] AC6 — Given a live exit run that fails at any point, when `afterEach` runs, then it kills the tracked process group with `killOwnGroup` (or an equivalent ownership-checked kill) and removes `tmp`, so no CLI process outlives the test.
- [ ] AC7 — Given `test/service-launchd.test.ts` and `test/cli.test.ts`, when they run, then they cover: `defaultExec`'s spawn-error path and its killed-by-signal path; the invalid-uid refusal; the relative `daemonPath` refusal; the `writePlistAtomic` cleanup (temp file removed when the write/rename fails); and the CLI's production `dataDir` (`deps.dataDir === undefined`). The `defaultExec` tests use a fake binary, never the real `launchctl`.
- [ ] AC8 — `docs/ARCHITECTURE.md` (the launchd bullet, :128) and `README.md` (launchd section, :14-31) say how a start failure behaves under launchd: which failures restart, which don't, and at what rate. `docs/OPEN_QUESTIONS.md` notes that the `bootout`-is-asynchronous assumption is unverified until the owner's run.

## Implementation Notes (verified at planning time, main @ 4429d4b)
**Files read:**
- `kernel/src/daemon.ts` (66 lines): `main` — `startKernel(parseArgs(args))`; any start failure ⇒ `console.error("<NAME>: failed to start: <oneLine>")` + `process.exit(1)` (:36-41). SIGTERM/SIGINT ⇒ `kernel.stop()` ⇒ exit 0, a teardown error ⇒ one stderr line + exit 1 (:45-53). `parseArgs` throws `unknown argument` / `--auth-provider needs a value` (:18-32).
- `kernel/src/kernel.ts:133-215` `startKernel`: opens the store first (`StoreLockedError` from `src/store/lock.ts:14`, `code = "STORE_LOCKED"`); selects the auth provider (`AuthProviderError`, `src/auth/types.ts:73`, `code: "missing" | "invalid_shape" | "unavailable"`; `"unavailable"` = provider not in this build, `src/auth/registry.ts:68`); `ensureApiToken` (`src/api/token.ts:49-68`) reads/writes the Keychain — `KeychainError` (`src/auth/keychain.ts:49`) or `ApiTokenError` (`src/api/token.ts:19`). Failures after the store opened are torn down and rethrown.
- `kernel/src/service/launchd.ts` (245 lines):
  - `renderPlist` :80-117 — `KeepAlive` = `{SuccessfulExit: false}` at :102-106, no `ThrottleInterval`; `ProgramArguments` = `[nodePath, daemonPath]` :95-99.
  - `ServiceExec = (file, args) => number` :120; `defaultExec` :122-130 runs `spawnSync(file, args, { stdio: "ignore" })`; spawn error ⇒ `ServiceError("cannot run <file> (<code>)")`; killed by signal ⇒ `-1`.
  - `resolveDeps` :166-171 — non-darwin refusal; invalid uid refusal at :169.
  - `isLoaded` :181 (`launchctl print gui/<uid>/<label>` exit 0); `bootout` :185-188.
  - `writePlistAtomic` :191-203 — temp `.<name>.<pid>.tmp`, `rmSync` on failure.
  - `installService` :211-232 — daemonPath refusal at :216 (relative or missing); `if (isLoaded(r)) bootout(r)` then `bootstrap` immediately at :228-230 (F09-1).
- `kernel/src/cli/index.ts:241-253` — `service install|uninstall` dispatch; :245 is the `deps.dataDir === undefined` branch (production dataDir) — untested.
- `kernel/test/service-launchd.test.ts` — always injects `exec`; covers renderPlist (:74-134), installService (:136-209), uninstallService (:211-238), non-darwin (:240).
- `kernel/test/cli.test.ts:365-430` — `studio service` tests, always with `CliDeps.dataDir` set.
- `kernel/test/exit-live.test.ts` (146 lines) — kills at the `tool_decision` allow row (:69-87; the gate writes that row in `src/sessions/manager.ts:1443` BEFORE the SDK spawns `sleep`), asserts `groupAlive(pgid)` at :89 (races); `afterEach` (:52-54) only `stopHarnesses`, no group kill; `rmSync(tmp)` only on success (:144).
- `kernel/test/crash-helpers.ts` — `stopHarnesses` :104 (SIGTERM, then SIGKILL, harness pids only), `groupAlive` :134, `groupProbeCode` :145, `killOwnGroup(pgid, leader)` :160 (kills `-pgid` only when `ps -o args= -p <pgid>` starts with `"<leader> "`).
- `kernel/test/crash-resume.test.ts:57-62` — the precedent `afterEach`: `stopHarnesses()`, then `killOwnGroup` for each tracked pgid, then `rmSync(tmp)`.
- `kernel/test/kernel-daemon.test.ts:180-195` — reads `src/daemon.ts` source to assert no handlers are passed (keep that assertion passing).
- `README.md:14-31` (launchd section; :31 "run `service install` again"); `docs/ARCHITECTURE.md:128` (launchd bullet); `docs/OPEN_QUESTIONS.md:17-18` (owner's live-run steps).

**Design (the worker may refine names, not behaviour):**

1. **Restart policy from the exit status (AC1–3).** launchd's only knob here is `KeepAlive {SuccessfulExit: false}`: exit 0 ⇒ not restarted, non-zero ⇒ restarted (throttled). So:
   - **The plist tells the daemon it runs under launchd:** `ProgramArguments` = `[nodePath, daemonPath, "--launchd"]`; `daemon.ts` `parseArgs` accepts `--launchd` (no value). A daemon started by hand (no flag) keeps today's exit statuses exactly (start failure ⇒ 1, teardown error ⇒ 1) so scripts and humans still see failures as non-zero.
   - **Detect `--launchd` with `args.includes("--launchd")` BEFORE parsing**, so the launchd exit path applies even when `parseArgs` throws (e.g. `[--launchd, --bogus]`).
   - **A pure classifier** (exported from a small module, e.g. `kernel/src/daemon-exit.ts`, so it is unit-testable without spawning): `startFailureKind(err): "permanent" | "transient"`. **Permanent (an explicit allowlist — a retry can't fix it):** `StoreLockedError` (`code === "STORE_LOCKED"`); argument errors from `parseArgs` — `parseArgs` throws a plain `Error` today, so give it a dedicated class (e.g. `DaemonArgumentError`). **Put `DaemonArgumentError` and `parseArgs` in `kernel/src/daemon-exit.ts`, never in `daemon.ts`:** `daemon.ts` runs `main()` when it is imported (`daemon.ts:59-66`), so no test may import it — `daemon.ts` imports them, and the tests import `daemon-exit.ts` only; a plain `Error` stays transient; `AuthProviderError` with `code === "unavailable"` (provider not in this build). **Everything else is transient** (fail toward retrying, throttled) — including `KeychainError`, `ApiTokenError`, `AuthProviderError` `missing`/`invalid_shape`, a store open/migration error.
   - **`kernel/test/kernel-daemon.test.ts:189-190` asserts the WHOLE `daemon.ts` source does not match `/handlers/`, comments included.** The word "handlers" must not appear anywhere in `daemon.ts` (say "signal listener", not "signal handlers").
   - **Exit status under `--launchd`:** permanent start failure ⇒ one stderr line `"<NAME>: failed to start (not restarting: <reason>): <oneLine(err)>"` then exit 0; transient ⇒ one stderr line `"<NAME>: failed to start (launchd retries in ≥ 60 s): <oneLine(err)>"` then exit 1; SIGTERM/SIGINT with a teardown error ⇒ one stderr line (as today) then exit 0. The exact wording may differ, but every line names the cause and whether launchd will restart. **Never an exit without a stderr line** (requirement risk: the split must never hide a failure).
   - **Plist:** add `<key>ThrottleInterval</key><integer>60</integer>` (exported constant, e.g. `THROTTLE_INTERVAL_SECONDS = 60`). The renderPlist unit test pins both `ThrottleInterval` 60 and the `--launchd` argument.
   - **Tests (`kernel/test/daemon-exit.test.ts`, new, or extend `kernel-daemon.test.ts`):** the classifier on each named error (a real `StoreLockedError`, `KeychainError`, `AuthProviderError` for each code, a plain `Error`); and the exit-decision function (`(kind, launchd) => { status, line }`) for all combinations, including teardown. If the worker wants an end-to-end check, spawn the BUILT daemon only via the existing `buildKernel()` helper with a held store lock (a second `Store` on the same data dir) and `--launchd`, asserting exit 0 + one stderr line — optional, never touches the Keychain (the store lock is taken before any Keychain read).
2. **Reliable reinstall (AC4).**
   - **`ServiceExec` returns `{ status: number; stderr: string }`** (stderr captured with `stdio: ["ignore", "ignore", "pipe"]`, `encoding: "utf8"`; keep the first non-empty line AND bound it to ~500 chars — the CLI contract is ONE stderr line, `kernel/src/cli/index.ts:227-229`). With empty stderr the message is exactly today's `… failed (exit status <n>)` — no trailing `: `. This deliberately relaxes the module's "launchctl's output is never shown" comment for stderr only, as AC4 requires; update the header comment and `ServiceError` doc accordingly. launchctl's stderr carries no secret (the plist holds none — `renderPlist` restricts env to two non-secret keys).
   - **`installService`:** when loaded ⇒ `bootout`, then poll `launchctl print gui/<uid>/<label>` until it exits non-zero, every 100–250 ms, bounded by `BOOTOUT_WAIT_MS = 5_000` (injectable `sleep`/`now` deps so tests don't wait). **Timeout ⇒ throw a one-line `ServiceError` naming the 5 s bound (e.g. `studio service: <label> still loaded 5 s after bootout; the previous kernel may still be stopping, run service install again`) and NEVER bootstrap** — settled, not the worker's choice: the store lock (`src/store/lock.ts:42-45`) is released only when the old process dies, and `StoreLockedError` is now a permanent (exit 0, not restarted) failure, so bootstrapping over a still-stopping kernel would leave a dead kernel after an install that printed "installed and loaded". Then `bootstrap`; on exit status **5** only, wait once (same poll or a short fixed delay) and retry `bootstrap` once. Final failure ⇒ `ServiceError("studio service: launchctl bootstrap gui/<uid> failed (exit status <n>): <stderr line>")`. `bootout` failure messages also carry stderr.
   - **Synchronous waits:** `installService` is synchronous today and the CLI calls it synchronously; keep it synchronous with an injected `sleep(ms)` dep whose default is `Atomics.wait` on a `SharedArrayBuffer` (no busy loop), OR make it `async` and `await` it in `runCli` (already async). Either is fine; tests inject a fake clock/sleep.
   - **Tests (`service-launchd.test.ts`):** a scripted fake exec — print 0 (loaded), bootout 0, print 0 ×N then non-zero (the poll), bootstrap 5 then 0 (the retry), bootstrap 5 then 5 (final failure, message has status 5 + stderr), the poll timeout (throws, no bootstrap), and that the poll never exceeds the bound. **Every `installService` test — the CLI ones in `cli.test.ts` included — injects `sleep`/`now`**, so no test waits in real time.
   - **Existing assertions this design changes on purpose (update them, don't delete the intent):** the `ServiceExec` fakes returning a number at `service-launchd.test.ts:61-65` and `cli.test.ts:372-376` (type change); `service-launchd.test.ts:157-162` answers `print` with 0 forever when loaded — with the poll it must now answer non-zero after `bootout`, and the expected verb list grows (`print`, `bootout`, `print`…, `bootstrap`); the exact `… failed (exit status 5)` messages at `service-launchd.test.ts:172`, `:235` and `cli.test.ts:420` (keep exact when stderr is empty; add a case with stderr).
3. **Coverage (AC7, `service-launchd.test.ts` + `cli.test.ts`):**
   - `defaultExec` (export it, or reach it through `installService` with no `exec` and an injected launchctl path — prefer exporting `defaultExec` or making `LAUNCHCTL_PATH` injectable via deps so tests point it at a **fake binary** in a temp dir): spawn error (a nonexistent path ⇒ `ServiceError` naming `ENOENT`); killed by a signal (a fake executable script that does `kill -9 $$` ⇒ status `-1`, never 0); a fake that writes to stderr and exits 5 ⇒ `{status: 5, stderr}`. Never the real `/bin/launchctl`.
   - invalid uid refusal (`uid: -1` and `uid: 1.5` ⇒ `cannot determine the user id`, nothing run).
   - relative `daemonPath` refusal (`daemonPath: "dist/daemon.js"` ⇒ refused before anything is written or run).
   - `writePlistAtomic` cleanup: make the rename fail (e.g. the plist path is an existing **directory**) and assert the `.<name>.<pid>.tmp` file is gone and the error propagates.
   - CLI production dataDir: `runCli(["service","install"], { service: { options: { daemonPath, env: { STUDIO_DATA_DIR: <tmp> } }, deps } })` with NO `CliDeps.dataDir` ⇒ the plist's `STUDIO_DATA_DIR` / logs dir is the env's dir (and, separately, with an empty env the default `~/.loomwright-studio` under the injected `homeDir`). Never writes under the real home.
4. **Live exit test (AC5–6, `kernel/test/exit-live.test.ts`, still `describe.skipIf(!LIVE)`):**
   - After the `tool_decision` allow row appears, `waitFor` (bounded, e.g. 30 s, 100 ms) until a `ps -eo pgid=,comm=` scan shows a process whose `comm` **basename** is `sleep` in the session's pgid (macOS reports the exec path, e.g. `/bin/sleep`; match the basename, not the whole string); only then `SIGKILL` the harness. Keep the `groupAlive(pgid)` assertion after the kill. Put the probe in `crash-helpers.ts` (e.g. `groupHasCommand(pgid, "sleep")`), portable to macOS and Linux `ps`.
   - Track the session pgid as soon as it's known (a `Set` like `crash-resume.test.ts`'s `pgids`) and `afterEach`: `await stopHarnesses(30_000)`, then kill each tracked group with an ownership check, then `rmSync(tmp, { recursive: true, force: true })` (move the success-path `rmSync` out). **`killOwnGroup(pgid, leader)` requires `ps -o args=` to start with `"<leader> "`** — for the live CLI the leader is the real `claude` executable. Pass as `leader` **only the FIRST argv token** (the executable path) of `ps -o args= -p <pgid>` read at tracking time — passing the whole args line never matches (no trailing space after it) and would silently kill nothing — or extend `killOwnGroup` with a `comm` basename match. Never `kill(-pgid)` without an ownership check.
   - Keep the file importable with `STUDIO_LIVE` unset (typecheck covers it); it must still skip in CI.
5. **Docs (AC8):** `docs/ARCHITECTURE.md:128` — the plist now passes `--launchd` and sets `ThrottleInterval` 60; permanent start failures (store lock held by another kernel, a bad argument, an auth provider not in this build) exit 0 and are not restarted; every other start failure exits 1 and is retried at most once a minute; a teardown error on SIGTERM is logged and not restarted; every exit writes its cause to `kernel.err.log`. `install` waits (≤ 5 s) for `bootout` to finish — if the job is still loaded after 5 s it fails with a one-line error saying to run it again, and never bootstraps — then retries `bootstrap` once on status 5. `README.md` launchd section: the same in two or three plain sentences, plus "to stop a retrying kernel: `service uninstall`"; that an agent `launchctl print` shows as not running with last exit code 0 stopped on a permanent start failure — read `kernel.err.log`; and that a plist installed before this change keeps the old 10 s restart loop until `service install` is run again. `docs/OPEN_QUESTIONS.md` (the "Phase 1 exit: live run" to-do): note as unverified, to record during the owner's run, (a) whether `bootout` is asynchronous, (b) that `launchctl print` exiting non-zero means the old kernel process has exited, and (c) that the CLI runs the Bash tool's `sleep` inside the session's process group (the live test's probe relies on it).

**Verification the worker runs:** `cd kernel && npm ci && npm run typecheck && npm test && npm run build`; `bash scripts/check-docs.sh` from the repo root. `exit-live.test.ts` stays skipped (no `STUDIO_LIVE`).

## Subtask Structure
| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | launchd restart policy (`--launchd`, classifier, ThrottleInterval), reliable reinstall (poll + retry + stderr), live exit test race/leak fix, coverage for the untested launchd/CLI paths, docs | AC 1–8 | ~11 modify, 2 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts
```yaml
# Subtask 1 — H01 launchd hardening (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/daemon.ts"}
  - {kind: "file", path: "kernel/src/service/launchd.ts"}
  - {kind: "file", path: "kernel/test/service-launchd.test.ts"}
  - {kind: "file", path: "kernel/test/exit-live.test.ts"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "renderPlist"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "installService"}
requires: []
lanes:
  - "kernel/src/daemon.ts"
  - "kernel/src/daemon-exit.ts"
  - "kernel/src/service/**"
  - "kernel/src/cli/**"
  - "kernel/test/**"
  - "README.md"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "macOS /bin/launchctl print|bootout|bootstrap in the gui/<uid> domain (man launchctl), exit status 5 on a bootstrap I/O error — not run by this job; unit tests inject the exec"
  - "launchd.plist(5): KeepAlive.SuccessfulExit and ThrottleInterval (integer seconds)"
  - "/bin/ps on macOS and Linux procps for the live test's group probe"
```
Modified (est.): `kernel/src/daemon.ts`, `kernel/src/service/launchd.ts`, `kernel/src/service/index.ts` (re-exports), `kernel/src/cli/index.ts` (only if `installService` becomes async or a message changes), `kernel/test/service-launchd.test.ts`, `kernel/test/cli.test.ts`, `kernel/test/exit-live.test.ts`, `kernel/test/crash-helpers.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`. Created (est.): `kernel/src/daemon-exit.ts` (classifier + exit decision) and `kernel/test/daemon-exit.test.ts`.

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
- `skills/unit-testing/SKILL.md` — vitest, temp dirs, injected exec/uid/homeDir/platform/sleep, a fake executable for `defaultExec`, leak-free `afterEach`
- `skills/error-handling/SKILL.md` — one-line failures naming the cause, launchctl status + stderr, permanent vs transient classification

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| An exit-0 path hides a real failure (launchd stops retrying something that would have cleared) | HIGH | MEDIUM | Permanent is an explicit allowlist (3 cases); everything else is transient. Every exit path writes one stderr line naming the cause and whether launchd restarts; tests pin the line per case | Requirement "Risks" |
| A daemon started by hand starts exiting 0 on failure | MEDIUM | LOW | The 0-exit split applies only with `--launchd`, which only the plist passes; tests pin the no-flag statuses unchanged | Phase 3 |
| `bootout` is synchronous in practice, so the poll is dead code — or slower than 5 s | LOW | MEDIUM | Slower than 5 s ⇒ install fails with a one-line error saying to run it again (never bootstraps); a fast-but-still-loaded case ⇒ one `bootstrap` retry on status 5. Real behaviour recorded in `docs/OPEN_QUESTIONS.md` at the owner's run | Feasibility (Phase 2.5) |
| Capturing launchctl stderr leaks something sensitive | LOW | LOW | The plist holds no secret; stderr is trimmed and bounded; only status + stderr line in the message | Phase 3 |
| `defaultExec` test with a fake binary is flaky across macOS/Linux | LOW | MEDIUM | A `#!/bin/sh` script in a temp dir, `chmod 0755`; signal case `kill -9 $$`; no timing | Phase 3 |
| The live test's ownership-checked group kill matches nothing (leader string differs for the real CLI), so a failed run still leaks | MEDIUM | MEDIUM | Pass only the FIRST argv token of `ps -o args=` (read at tracking time) as `leader`, or extend `killOwnGroup` with a `comm` basename match (Design 4 is authoritative); never an unchecked `kill(-pgid)` | Phase 3 (`crash-helpers.ts:160`) |
| `kernel-daemon.test.ts:189-190` matches `/handlers/` against the WHOLE `daemon.ts` source, comments included | LOW | MEDIUM | The word "handlers" must not appear anywhere in `daemon.ts` (say "signal listener") | Plan Review |
| Reinstall over a still-stopping kernel: `bootstrap` starts a new kernel while the old one holds the store lock; `StoreLockedError` is permanent, so it exits 0 and is never restarted, after an install that printed success | HIGH | LOW | The bootout poll's timeout throws and never bootstraps; the OPEN_QUESTIONS note records the "`print` non-zero ⇒ old process exited" assumption for the owner's run | Plan Review |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-03-h01-launchd-start-failure-and-reinstall.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-03T14:49:37Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/23
- **Branch:** feature/hardening-h01-launchd-start-failure
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** --launchd exit-status split (permanent ⇒ 0, transient ⇒ 1) + ThrottleInterval 60; install polls after bootout (throws at 5 s, never bootstraps), retries bootstrap once on 5, reports stderr; live exit test sleep probe + afterEach group kill; AC7 coverage; docs. Phase 4.5 review PASS on the first pass (2 MEDIUM + 3 LOW dismissed below the fix floor).

## Not verified
- **real launchctl install/reinstall on macOS (bootout async, print non-zero after bootout, bootstrap status 5)** — no launchd in CI; unit tests inject exec; recorded as open for the owner's live run (subtask 1)
- **defaultSleep (Atomics.wait) real blocking wait inside installService** — every test injects sleep/now (subtask 1)
- **exit-live.test.ts end to end (sleep probe on the real CLI, afterEach group kill)** — needs STUDIO_LIVE=1, a real model and the Keychain token (subtask 1)
