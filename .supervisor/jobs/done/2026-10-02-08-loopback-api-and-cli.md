# Supervisor Job: Loopback API, kill switch, and the `studio` CLI

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariants 1, 2, 3, 5 and 6 apply directly)
- **Git:** dirty only with the automate engine's own trail files (`.supervisor/automate/*`, `.supervisor/postmortem/results.jsonl`, `.supervisor/requirements/phase-1/07-event-loop-and-kernel-tools.md`, `.supervisor/jobs/done/2026-10-02-07-event-loop-and-kernel-tools.md`, `.supervisor/requirements/proposed/*`, `.supervisor/requirements/phase1-0{6,7}-*-plan.md`) — never stage them in this job; commit with explicit paths only. Branch: main @ dd9663f
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0
- **Blockers:** 0 | **Warnings:** 1 (dirty trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1/08-loopback-api-and-cli.md
- **Base commit:** dd9663f54d2acc1a331540f97e39084c243f78c4

## Feasibility
- **Verdict:** CAUTION
- Tech stack — GO: TypeScript kernel (strict, NodeNext, vitest). The HTTP server, the client and the token generator use Node built-ins only (`node:http`, `node:crypto`), so no new package.
- Dependencies — GO: no new dependency. `package.json` gains only a `bin` entry (and `package-lock.json` is resynced with `npm install --package-lock-only`, no version change).
- Architecture fit — GO: `docs/ARCHITECTURE.md:9-12` already draws "CLI: studio ask|status|stop" talking "HTTP + WebSocket on 127.0.0.1, token from Keychain"; `:109` defines the kill switch ("`studio stop --all` … aborts every session and disables every trigger"). Every dependency is merged: session manager (item 05), budget meter and cap tracker (item 06), event loop and kernel tools (item 07). `kernel/src/api/index.ts` and `kernel/src/cli/index.ts` are `export {}` stubs; `kernel/src/daemon.ts` only answers `--version`.
- Scope — GO: one worker; 11 modified (incl. the lock file) + 10 created files (below).
- Hard blockers — CAUTION: (1) **Keychain write is new.** `kernel/src/auth/keychain.ts` only reads (`security find-generic-password -s <service> -w`; `securityCliKeychain` :75-95) and its header (:1-5) makes it the ONLY module allowed to touch the Keychain or `node:child_process`. Writing the generated API token without putting the secret in `argv` (visible to `ps`) needs `security -i` (interactive mode reads commands on stdin until EOF; `man security`), which has NOT been probed live — doing so writes a real Keychain item on the owner's machine, which this planning run does not do. Unit tests inject the exec; the live path is listed under "Not verified". (2) The daemon has never composed store + auth + budget + sessions + loop; this item does that for the first time (item 09 then runs it under launchd).

## Task
**Goal:** Make the kernel observable and stoppable from a terminal before any GUI exists (invariant 3: the kill switch). The daemon serves an authenticated HTTP API on `127.0.0.1` only, on an OS-assigned port written to `<dataDir>/api.json`; `GET /status` reports kernel, auth, sessions, queue, tokens and cap state; `POST /stop-all` stops every session and halts the event loop until `POST /resume`; the `studio` CLI (`status`, `stop --all`) talks to it. Mechanism only (invariant 1): no playbook, policy or default handler is invented.

## Acceptance Criteria
- [ ] AC1 — Given the daemon, when it starts, then it serves HTTP on `127.0.0.1` only (never `0.0.0.0`), on a port written to `~/.loomwright-studio/api.json` (i.e. `<dataDir>/api.json`, honouring `STUDIO_DATA_DIR`). Every request needs a bearer token from the Keychain item `loomwright-studio-api`, which the kernel generates on first start. A request without the right token gets 401, and the response body never echoes the token.
- [ ] AC2 — Given `GET /status`, when it's called, then it returns JSON with: kernel version and uptime; auth provider health (item 04; never the secret); running sessions (id, agent, model, pgid, started); pending events and wake-ups; today's tokens per agent (D26 counting); `cap_state` per account.
- [ ] AC3 — Given `POST /stop-all`, when it's called, then every session is stopped through the session manager (item 05), the loop stops taking new events until `POST /resume` is called, and both are recorded in `events`.
- [ ] AC4 — Given the CLI, when `studio status` runs, then it prints a short human summary of `/status` (`--json` prints the raw JSON). `studio stop --all` calls `/stop-all`. If the daemon isn't running, both exit non-zero with a one-line message.
- [ ] AC5 — Given a test, when it starts the API on a random port, then it asserts the 401 without the token, the loopback-only bind, and that `/stop-all` leaves no session process group alive (using the fake spawner).

## Implementation Notes (verified at planning time)

**Files read:** `kernel/src/api/index.ts`, `kernel/src/cli/index.ts` (both `export {}` stubs), `kernel/src/daemon.ts` (:1-11, `--version` only), `kernel/src/version.ts` (`kernelVersion()`), `kernel/src/auth/keychain.ts` (`SECURITY_BIN`, `securityCliKeychain(exec)`, `KeychainError` built from service + status only, `ExecFileSyncLike` injectable; header :1-5), `kernel/src/auth/index.ts`, `kernel/src/auth/registry.ts` (`availableProviderIds()`, `selectAuthProvider(id, deps)`; the subscription provider is loaded through a non-literal specifier so a distribution build can drop it — nothing may import `subscription-token.js` statically, `test/auth-distribution.test.ts`), `kernel/src/auth/types.ts` (`AuthProvider.health(): AuthHealth`, four variants, no secret), `kernel/src/store/store.ts` (`resolveDataDir`, `DATA_DIR_ENV = "STUDIO_DATA_DIR"`, `Store.dataDir`, `transaction`), `kernel/src/store/migrations/001_initial.ts` (`sessions` :31, append-only `events` :54-82, `budget` with generated `counted_tokens` :87-102 — D26: input + output + cache-write, `wakeups` :113-122, `cap_state` :127-134), `006_budget_cap_details.ts` (`cap_state.utilization`, `reset_source`), `007_event_loop.ts` (`event_queue` status/`not_before`), `kernel/src/sessions/manager.ts` (`SessionManager` :336; private `#live` map :359; `getSession` :387; `stopSession(id)` :481 — idempotent, closes input, kills the group until gone, awaits exit; `reapOrphans()` :645), `kernel/src/sessions/types.ts` (`SessionManagerOptions` :263-300, `SessionRow` :175, `TERMINAL_STATUSES` :35), `kernel/src/loop/loop.ts` (`EventLoop.start()` idempotent; `stop()` cancels the next tick and awaits the running one, finishing its current event), `kernel/src/budget/index.ts` (`Budget` wires `observe`/`check`), `kernel/src/budget/types.ts` (`BudgetOptions.authProvider`, `BudgetDeps.dayOf` defaults to the host's local day — `/status` must use the same day function), `kernel/src/budget/internal.ts` (`localDay`), `kernel/src/tools/server.ts` (`KernelToolContext` :57-66, `createKernelMcpServer(ctx)` :392, `KERNEL_MCP_SERVER_NAME`), `kernel/src/tools/handoff.ts` (`writeFileAtomic(path, content)` :70, mode 0600), `kernel/test/sessions.test.ts:75-290 (`FakeChild` :75, `harness` :217)` (the fake-spawner harness: `FakeChild`/`FakeStream`, `killGroup` exits the fake child, `isGroupAlive`), `kernel/tsconfig.build.json` (`rootDir: src`), `kernel/scripts/build.mjs`, `docs/ARCHITECTURE.md` (:9-12, §Safety kernel :100-109), `docs/ROADMAP.md:8`.

**Design (the worker may refine names, not behaviour):**

1. **API token in the Keychain (`kernel/src/auth/keychain.ts`, the only Keychain module):**
   - Add `KeychainWriter` (`add(service, account, secret): void`) and `securityCliKeychainWriter(exec?)` that runs `SECURITY_BIN` with argv `["-i"]` and passes ONE command line on **stdin** — `add-generic-password -a <account> -s <service> -w <secret>\n` — so the secret never appears in `argv`. The secret is hex only (no quoting hazard); reject any service/account/secret containing whitespace, quotes or a newline before running anything. `-U` is NOT passed (an existing item is never overwritten). The injectable exec gains an optional `input` option; when `input` is given, `stdio[0]` is `"pipe"` explicitly (widen `ExecOptions.stdio` accordingly — never rely on `input` silently overriding `"ignore"`), and the default `realExec` passes `input` through. A failure throws `KeychainError` built from service + status only (never stdout/stderr/input). `KeychainError` gains an optional `operation: "read" | "write"` constructor parameter defaulting to `"read"`, so the existing read message stays byte-identical (`kernel/test/auth.test.ts:240` pins `Keychain read of service "svc" failed (/usr/bin/security exit status 1)`) and the write path says `Keychain write of service …`. **`security -i` may exit 0 even when a command inside it failed**, so the exit status is never the success signal: `ensureApiToken`'s read-back (below) is the only proof the item exists — do not "simplify" it away.
   - New `kernel/src/api/token.ts`: `API_TOKEN_KEYCHAIN_SERVICE = "loomwright-studio-api"`, `ensureApiToken(reader, writer, random = randomBytes)`: read; present ⇒ return it; absent ⇒ generate 32 random bytes as 64 hex chars, `add` under the fixed account label `API_TOKEN_KEYCHAIN_ACCOUNT = "loomwright-studio"` (a constant, not the OS user name), then read back and return what the Keychain holds (if the add failed because another process created it first, the read-back wins; if the read-back is still absent, throw). The token is never logged, never written to a file, never put in an error message.
2. **Kill switch state (`kernel/src/api/kill-switch.ts`):** durable, derived from the append-only `events` log so a launchd restart (item 09) cannot silently release it: `isKillSwitchEngaged(store)` = the latest of the `kill_switch_engaged` / `kill_switch_released` events is `kill_switch_engaged`. `engage` / `release` append those events (`actor: "api"`).
3. **`SessionManager.stopAll()` (`kernel/src/sessions/manager.ts`, narrow addition):** `async stopAll(options?: { mode?: "stop" | "shutdown" }): Promise<StopAllOutcome[]>` with the exported type `StopAllOutcome = { readonly id: number; readonly status: SessionStatus } | { readonly id: number; readonly status: "stop_failed"; readonly error: string }` — snapshot `#live` ids, `stopSession` each (`Promise.allSettled`, so one failing stop never skips another), return each outcome. A rejected stop is reported as `stop_failed` with the error message (an outcome label for the stop call, NOT a session status: the row keeps whatever the manager recorded); `/stop-all` returns these outcomes verbatim.
   - **Two modes, one kill path (owner decision, Plan Review attempt 2):** `mode: "stop"` (default — the kill switch) calls `stopSession` for each, so a running session ends `stopped` (terminal) exactly as today. `mode: "shutdown"` (graceful daemon stop, SIGTERM/SIGINT) runs the SAME `#stop` kill sequence (close input, grace, `killGroupUntilGone`, wait for exit, close query) but a session whose stream had not ended finishes **`interrupted`** with payload `{ reason: "kernel_shutdown" }` instead of `stopped`, so `resumeSession` accepts it after the restart (its group is confirmed gone, `sdk_session_id`/`model`/`loomwright_path` are on the row). Everything else is unchanged in both modes: a kill that cannot confirm the group gone still ends `failed` / `kill_incomplete` through `#finishAfterKill` (never resumable over a possibly-live group); a stream that had already ended keeps its computed verdict; a session whose stop is already in flight (`stopPromise`) keeps that stop. Implement by threading an intent through the private `#stop(live, intent)` (`stopSession` passes `"stop"`, so its behaviour and every existing test are byte-identical); `interrupted` is non-terminal, so `#finish`/`#settle` already handle it (`#transition` writes the row and a `session_status` event; `#markRow`'s `interrupted` branch is not involved). Why: a graceful stop must lose no more than a `kill -9` does (invariant 2) — a `kill -9` leaves the group to the next boot's `reapOrphans`, which marks it `interrupted` — while never leaving an orphaned CLI running ungated (Q5: an orphaned CLI kept making model calls and forking shells). No other change to the manager; the whole existing session suite must stay green.
4. **The API server (`kernel/src/api/server.ts`, exported from `kernel/src/api/index.ts`):** `startApiServer(options, deps): Promise<{ port: number; host: "127.0.0.1"; close(): Promise<void> }>` with options `{ store, sessions: Pick<SessionManager, "stopAll">, loop: Pick<EventLoop, "start" | "stop">, authProviders: readonly AuthProvider[], token: string, port?: number /* default 0 = OS-assigned */ }` and deps `{ now?, dayOf?, startedAt? }`.
   - `node:http` `createServer`, `listen(port, "127.0.0.1")` — the host is a constant, never configurable, never `0.0.0.0`/`::`.
   - **Auth first, for every path and method:** `Authorization: Bearer <token>` compared with `crypto.timingSafeEqual` on equal-length buffers (a length mismatch is a plain 401, no compare). Missing/wrong ⇒ `401` with body `{"error":"unauthorized"}` and `WWW-Authenticate: Bearer`; the body, headers and any log never contain the presented or the real token. Unknown path ⇒ `404`, wrong method ⇒ `405` (only after auth, so an unauthenticated caller learns nothing about routes). Responses are `application/json`; request bodies are ignored.
   - `GET /status` ⇒ `{ kernel: { version, uptime_s, pid }, kill_switch: { engaged, since }, auth: [{ id, account, health }], sessions: [{ id, agent, model, pgid, started_at, status }] /* rows with status starting|running */, queue: { pending: <count>, events: [{ id, kind, enqueued_at, not_before, attempts }] /* event_queue pending, id order, first 50 */ }, wakeups: { pending: <count>, items: [{ id, due_at, reason, task_id }] /* first 50 by due_at, id */ }, tokens_today: { day, agents: [{ agent, counted_tokens }] /* SUM(counted_tokens) FROM budget WHERE day = dayOf(now) GROUP BY agent */ }, cap_state: [{ account, limits: [{ rate_limit_type, status, resets_at, utilization, reset_source }] }] }`. A provider whose `health()` throws reports `health: { status: "error" }` (message dropped — it could carry Keychain output), never a 500.
   - `POST /stop-all` ⇒ (1) `engage` (append `kill_switch_engaged`), (2) `await loop.stop()` (finishes the current event, starts no other — so a session an in-flight handler starts is live before step 3), (3) `await sessions.stopAll()`, (4) append `stop_all_completed` with the per-session outcomes; respond `200 { engaged: true, sessions: [...] }`. Repeating it while engaged re-runs (2)–(4) and appends another `kill_switch_engaged` (harmless; every call is audited).
   - `POST /resume` ⇒ engaged: `release` (append `kill_switch_released`), `loop.start()`, `200 { engaged: false }`; not engaged: `200 { engaged: false }`, nothing appended.
5. **Daemon composition (`kernel/src/daemon.ts` + new `kernel/src/kernel.ts`):** `startKernel(options, deps)` composes, in order: `new Store({ dataDir })`; the auth provider (`--auth-provider <id>` / `STUDIO_AUTH_PROVIDER`; default `subscription-token` when `availableProviderIds()` has it, else `api-key` — build configuration per D15/D29, not playbook policy); `new Budget({ store, authProvider })`; `new SessionManager({ store, authProvider, onMessage: budget.observe, admission: budget.check, mcpServers: ({ sessionId }) => ({ [KERNEL_MCP_SERVER_NAME]: createKernelMcpServer({ store, sessions: manager, sessionId }) }) })`; `await manager.reapOrphans()`; `new EventLoop({ store, handlers: {} })` (phase 1 ships no handler — invariant 1; the `message` handler arrives with the brain, phase 2), started only when the kill switch is NOT engaged; `ensureApiToken`; `startApiServer`; then writes `<dataDir>/api.json` = `{ "port": <n>, "host": "127.0.0.1", "pid": <pid>, "started_at": <iso> }` via `writeFileAtomic` (mode 0600; never the token). `stop()` (SIGTERM/SIGINT): close the API server, `loop.stop()`, `manager.stopAll({ mode: "shutdown" })` (sessions end `interrupted`, resumable after the restart — see §3), remove `api.json` only if it still names this pid, `store.close()`. **Partial-start unwind:** if any step after the Store opened throws (provider selection, `reapOrphans`, `ensureApiToken`, `startApiServer`, the `api.json` write), `startKernel` undoes what it already started, in reverse order — close the API server if listening, `loop.stop()` if started, `manager.stopAll({ mode: "shutdown" })` if the manager exists, `store.close()` — then rethrows; nothing is left listening, no `api.json` is left behind, and the store lock is released. All of Store, auth provider selection, keychain reader/writer, SessionManager deps and the clock are injectable so a test runs it with a temp data dir, a stub provider, a fake keychain and the fake spawner. `daemon.ts` keeps `--version` and otherwise calls `startKernel` and installs the signal handlers; a start failure prints one line (no secret) and exits non-zero.
6. **The CLI (`kernel/src/cli/index.ts`, shebang `#!/usr/bin/env node`; `package.json` `"bin": { "studio": "dist/cli/index.js" }`):** `runCli(argv, deps): Promise<number>` (exit code; deps: `dataDir`, keychain reader, `fetch`, `isPidAlive`, `stdout`, `stderr`) plus a thin `main` that runs ONLY when the module is the process entry point — compare `import.meta.url` with `pathToFileURL(realpathSync(process.argv[1]))` (`realpath` resolves the npm `bin` symlink) — so importing `runCli` in vitest never runs the CLI against the real argv or sets `process.exitCode`. Commands: `studio status` (human summary: version + uptime, kill switch, one line per auth provider, running sessions, pending event/wake-up counts, tokens per agent today, cap state per account), `studio status --json` (the raw `/status` body), `studio stop --all` (calls `POST /stop-all`, prints how many sessions were stopped), `studio resume` (calls `POST /resume`; added so the kill switch can be released from the terminal without hand-crafting a bearer header — flagged as a deliberate addition). `studio stop` without `--all` and unknown commands print usage and exit 2. "Daemon not running" — `api.json` missing/unreadable, **its `pid` not alive** (`process.kill(pid, 0)` throws `ESRCH`; checked BEFORE the token is read or sent, so a stale `api.json` left by a `kill -9` never makes the CLI send the bearer token to whatever process now holds that port), the API token absent from the Keychain, or a connection error (`ECONNREFUSED`, timeout 5 s) — prints exactly one line to stderr (e.g. `studio: kernel daemon is not running (no <dataDir>/api.json)`) and exits 1; a non-2xx answer prints one line with the status code and exits 1. The CLI only ever connects to `127.0.0.1:<port from api.json>`; it never prints the token.
7. **Docs:** `docs/ARCHITECTURE.md` — a short §Loopback API (127.0.0.1 only, OS-assigned port in `<dataDir>/api.json`, bearer token in Keychain item `loomwright-studio-api` generated on first start and written via `security -i` on stdin, the three routes, 401-before-routing) and extend the kill-switch bullet (:109): durable through the `events` log, `/stop-all` halts the loop and stops every live session, `/resume` releases it; triggers do not exist until phase 2. `docs/OPEN_QUESTIONS.md`: record that the `security -i` stdin write path is unit-tested only and needs one live run by the owner (with the launchd follow-up of item 09).

**Tests (no real SDK, no model calls, no real Keychain; temp data dir; vitest):**
- `kernel/test/api.test.ts` (new): start the API with `port: 0` → the address is `127.0.0.1` and the port is non-zero (loopback-only bind asserted via `server.address()` AND a request to `127.0.0.1:<port>` succeeding); **401** without a header, with a wrong token, with a wrong scheme, and on an unknown path when unauthenticated — the 401 body equals `{"error":"unauthorized"}` and contains neither token; 404/405 only when authenticated; `GET /status` shape: version, `uptime_s`, auth health (a stub provider reporting `expiring`; a throwing provider reports `error`, response still 200), running sessions only (a `completed` row excluded), pending queue rows and wake-ups (done rows excluded), `tokens_today` summing `counted_tokens` for today's day only (rows inserted for today and yesterday, cache reads excluded per D26), `cap_state` grouped per account; **`POST /stop-all` with two sessions started through a `SessionManager` built on a fake spawner/query (write a minimal fake in this file modelled on `kernel/test/sessions.test.ts:75-290 (`FakeChild` :75, `harness` :217)`; do not modify `sessions.test.ts`) → both rows `stopped`, the fake `isGroupAlive` reports every recorded pgid gone, the loop's `stop` was awaited before the sessions were stopped, and `events` holds `kill_switch_engaged` + `stop_all_completed`**; while engaged a fake loop is not restarted; `POST /resume` → `kill_switch_released`, `loop.start()` called; resume when not engaged appends nothing; a stop of one session that rejects does not skip the other.
- `kernel/test/api-token.test.ts` (new): `ensureApiToken` returns an existing item without writing; generates 64 hex chars when absent, writes through the writer and returns the read-back; the writer's exec receives argv `["-i"]` only and the secret only in `input`; invalid characters are refused before exec; a failing exec throws `KeychainError` whose message says `write` and contains neither the secret nor stdin; an exec that exits 0 without creating the item (read-back still absent) makes `ensureApiToken` throw; `auth.test.ts:240`'s read message is unchanged.
- `kernel/test/kill-switch.test.ts` (new): engaged/released derived from the latest event, survives closing and reopening the `Store`.
- `kernel/test/sessions-stop-all.test.ts` (new; a minimal fake spawner/query modelled on `kernel/test/sessions.test.ts:75-290`, which stays unmodified): `stopAll()` (default `stop`) ends two running sessions `stopped`, every recorded group gone; `stopAll({ mode: "shutdown" })` ends them `interrupted` with `reason: "kernel_shutdown"` in their status event, the groups gone, and `resumeSession` on each then launches a resume attempt (not `not_resumable`); in `shutdown` mode a kill that cannot confirm the group gone ends `failed` / `kill_incomplete`; one `stopSession` rejecting yields a `stop_failed` outcome and the other session is still stopped; with no live session it returns `[]`; `stopSession` alone still ends `stopped` (unchanged).
- `kernel/test/kernel-daemon.test.ts` (new): `startKernel` with a temp data dir, stub provider, fake keychain and fake spawner → `api.json` written (mode 0600) with the bound port and no token; a session running at `stop()` ends `interrupted` (`kernel_shutdown`), not `stopped`; the loop is not started when the kill switch was engaged before start; `stop()` removes `api.json` and closes the store; with `STUDIO_AUTH_PROVIDER=api-key` the api-key provider is selected; **partial-start unwind**: an injected keychain whose read throws (so `ensureApiToken` fails after the loop started) makes `startKernel` reject, the loop's `stop` was called, no `api.json` exists, and a new `Store` on the same data dir opens (lock released); the same for a `startApiServer` failure (e.g. an injected port already in use).
- `kernel/test/cli.test.ts` (new): `runCli` against a real `startApiServer` on port 0 with a fake keychain: `status` prints a summary, `status --json` prints parseable JSON equal to `/status`, `stop --all` hits `/stop-all`, `resume` hits `/resume`; no `api.json` ⇒ exit 1 and exactly one stderr line; `api.json` naming a closed port ⇒ exit 1, one line; `api.json` naming a dead pid ⇒ exit 1, one line, and the fake `fetch` and keychain reader were never called; missing Keychain token ⇒ exit 1, one line; output never contains the token; importing the module does not run `main` (the test's `process.exitCode` is untouched).
- `kernel/test/sessions.test.ts`: unchanged; the whole existing suite stays green. `npm test` and `npm run typecheck` green in `kernel/`; `npm run build` emits `dist/cli/index.js` with the shebang.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Loopback API, Keychain API token, durable kill switch, SessionManager.stopAll (stop / shutdown modes), daemon composition, `studio` CLI, tests, docs | AC 1–5 | 11 modify, 10 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — loopback API, kill switch and the studio CLI (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/api/server.ts"}
  - {kind: "file", path: "kernel/src/api/token.ts"}
  - {kind: "file", path: "kernel/src/api/kill-switch.ts"}
  - {kind: "file", path: "kernel/src/kernel.ts"}
  - {kind: "file", path: "kernel/test/api.test.ts"}
  - {kind: "file", path: "kernel/test/api-token.test.ts"}
  - {kind: "file", path: "kernel/test/kill-switch.test.ts"}
  - {kind: "file", path: "kernel/test/kernel-daemon.test.ts"}
  - {kind: "file", path: "kernel/test/cli.test.ts"}
  - {kind: "file", path: "kernel/test/sessions-stop-all.test.ts"}
  - {kind: "symbol", path: "kernel/src/api/server.ts", name: "startApiServer"}
  - {kind: "symbol", path: "kernel/src/api/token.ts", name: "ensureApiToken"}
  - {kind: "symbol", path: "kernel/src/api/token.ts", name: "API_TOKEN_KEYCHAIN_SERVICE"}
  - {kind: "symbol", path: "kernel/src/api/kill-switch.ts", name: "isKillSwitchEngaged"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "startKernel"}
  - {kind: "symbol", path: "kernel/src/cli/index.ts", name: "runCli"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "stopAll"}
  - {kind: "type", path: "kernel/src/sessions/manager.ts", name: "StopAllOutcome"}
  - {kind: "symbol", path: "kernel/src/auth/keychain.ts", name: "securityCliKeychainWriter"}
requires: []
lanes:
  - "kernel/src/api/**"
  - "kernel/src/cli/**"
  - "kernel/src/kernel.ts"
  - "kernel/src/daemon.ts"
  - "kernel/src/auth/keychain.ts"
  - "kernel/src/auth/index.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/index.ts"
  - "kernel/package.json"
  - "kernel/package-lock.json"
  - "kernel/test/**"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "Node >= 22 built-ins node:http, node:crypto (timingSafeEqual, randomBytes) — no new package"
  - "macOS /usr/bin/security -i reading add-generic-password from stdin (documented in man security; not probed live — unit tests inject the exec)"
```

Modified files (11, incl. the lock file): `kernel/src/api/index.ts` (was `export {}`), `kernel/src/cli/index.ts` (was `export {}`), `kernel/src/daemon.ts`, `kernel/src/auth/keychain.ts` (+ `kernel/src/auth/index.ts` re-export), `kernel/src/sessions/manager.ts` (`stopAll` + the private `#stop` intent only) (+ `kernel/src/sessions/index.ts` re-export of `StopAllOutcome`), `kernel/package.json` (`bin`) + `kernel/package-lock.json` (resync, no version change), `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`. Created: `kernel/src/api/{server,token,kill-switch}.ts`, `kernel/src/kernel.ts`, and the six test files above.

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
- `skills/unit-testing/SKILL.md` — vitest, temp data dir, fake keychain/exec, fake spawner, real loopback server on port 0
- `skills/error-handling/SKILL.md` — 401 before routing, provider health errors degrade to `error` not 500, one-line CLI failures, secrets never in errors

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| `security -i` stdin write path not probed live; `security -i` may exit 0 when its inner command failed | MEDIUM | MEDIUM | Exec injected and asserted (argv `["-i"]`, stdin piped explicitly, secret only on stdin, hex-only secret, no `-U`); the read-back, not the exit status, is the success signal (tested with an exec that exits 0 and writes nothing); listed under "Not verified" and in OPEN_QUESTIONS for one owner run | Feasibility (Phase 2.5) |
| API token leaks via argv, error text, a 401 body, `api.json`, CLI output, or a CLI request to a stale port (a `kill -9` leaves `api.json`; the OS may hand its port to another local listener) | HIGH | LOW | Secret only on stdin; `KeychainError` from service + status only; fixed 401 body; `api.json` holds port/host/pid only; the CLI checks the `api.json` pid is alive before reading or sending the token; tests assert the token is absent from every output and never sent for a dead pid | Phase 3 / Plan Review (attempt 2) |
| Server bound to a non-loopback interface | HIGH | LOW | Host is a constant `127.0.0.1`; test asserts `server.address()` | Requirement |
| Timing attack on the bearer compare | LOW | LOW | `crypto.timingSafeEqual` on equal-length buffers | Phase 3 |
| Kill switch silently released by a daemon restart (launchd KeepAlive, item 09) | HIGH | MEDIUM | Engaged state derived from the append-only `events` log; the daemon does not start the loop while engaged; tested across a store reopen | Phase 3 |
| A session started by an in-flight event handler survives `/stop-all` | MEDIUM | LOW | Stop the loop (await its current event) BEFORE stopping sessions; order asserted in the test | Phase 3 |
| One failing stop skips the remaining sessions | MEDIUM | LOW | `stopAll` uses `Promise.allSettled` and reports each outcome; tested | Phase 3 |
| First full daemon composition (store + auth + budget + sessions + loop + API): wrong start order or a partial start leaving a listener, a running loop, a stale `api.json` or a held store lock | HIGH | MEDIUM | Fixed start order; `startKernel` unwinds in reverse on any later failure and rethrows; `kernel-daemon.test.ts` injects a failing keychain and a failing `startApiServer` and asserts the unwind (loop stopped, no `api.json`, store reopenable) | Feasibility (Phase 2.5) / Plan Review (attempt 1) |
| A graceful daemon stop (launchd stop, logout, `kickstart -k`) terminally `stopped` every session — losing more than a `kill -9`, which leaves them to the reaper as `interrupted` | HIGH | HIGH | Owner decision: `stopAll({ mode: "shutdown" })` kills each group until gone exactly like a stop but ends the row `interrupted` (`kernel_shutdown`), resumable; kill-incomplete still `failed`; tested in `sessions-stop-all.test.ts` and `kernel-daemon.test.ts` | Plan Review (attempt 2) |
| Session-manager regression (items 05/06/07 heavily reviewed) | HIGH | LOW | Additive `stopAll()` plus an intent parameter on the private `#stop`; `stopSession` passes `"stop"` so its behaviour is byte-identical; existing suite must stay green | Phase 3 |
| Distribution build pulls in the subscription provider via the daemon | MEDIUM | LOW | Daemon selects providers only through `selectAuthProvider`/`availableProviderIds`; `auth-distribution.test.ts` stays green | Phase 3 |
| Invariant 1 drift (a default message handler, a built-in policy) | MEDIUM | LOW | Loop composed with `handlers: {}`; the auth-provider default is build configuration (D15/D29), overridable | Requirement |
| `studio resume` is beyond the AC's command list | LOW | MEDIUM | Deliberate, tiny, symmetrical with `/resume` (AC3); flagged in the PR | Phase 4 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-02-08-loopback-api-and-cli.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-02T13:41:58Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/19
- **Branch:** feature/phase1-08-loopback-api-and-cli
- **Files changed:** 22
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Loopback API on 127.0.0.1 only (OS-assigned port in <dataDir>/api.json; bearer token from Keychain item loomwright-studio-api, generated on first start via `security -i` on stdin; 401 before routing), GET /status, POST /stop-all + /resume with a kill switch derived from the append-only events log, SessionManager.stopAll (stop → stopped; shutdown → interrupted/kernel_shutdown, resumable; an unconfirmed group kill reports stop_failed/kill_incomplete), startKernel composition with reverse unwind, `studio status|stop --all|resume` CLI. Self-heal FAIL→fix d633ace (stop --all counted non-stopped outcomes as stopped)→FAIL→fix e04da4e (failed:auth group kill not confirmed)→PASS. No rubric; red_team_advisory: disabled; risk_classification high_risk true (auth/token/size). 2 MEDIUM + 2 LOW dismissed for owner decision.

## Not verified
- **security -i Keychain write path (live)** — unit-tested with an injected exec only; a live run writes a real Keychain item, left to the owner (subtask 1)
- **Keychain read-back of the API token under launchd** — no launchd runtime yet, item 09 (subtask 1)
- **kernel/src/daemon.ts as a process (signals, start-failure line, exit codes)** — startKernel is tested directly (subtask 1)
- **built studio bin (dist/cli/index.js) against a live daemon, incl. the npm bin symlink entry check** — not executed (subtask 1)
- **/stop-all and shutdown against real Claude CLI process groups** — fake spawner/query only (subtask 1)
