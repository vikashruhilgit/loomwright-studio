# Supervisor Job: Phase 5 foundation — the app scaffold, the kernel's GUI seams, and one API contract every later item codes against

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh: its kernel test command, `docs/` table and invariants match the tree at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (4 extra worktrees: `loomwright-studio-p4-done` (merged), `loomwright-studio-p5-companions`, and two under `.claude/worktrees/` from PRs #98/#99, both merged. Advisory only; none is on a branch this job uses)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140001-phase-5-foundation-app-scaffold-api-seams-and-contract.md
- **Base commit:** 3a20ac8fc847e47f01dba7e80450e399fc36a200

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | CAUTION | The kernel is strict TS + vitest. `app/` brings in a new stack (Electron + React + Vite), but the owner chose it (requirement §Owner decisions, "Stack") and it sits beside `kernel/` as its own package |
| 2 | Dependency Availability | CAUTION | All of these resolve on npm today: electron 44.9.2, vite 8.3.4, react 19.3.1, electron-builder 26.15.3, @playwright/test 1.64.1, ws 8.22.0, @types/ws 8.18.2, @testing-library/react 16.3.3, jsdom 30.1.3, vitest 5.0.5, typescript 7.0.2, @react-spring/web 10.1.2, motion 14.4.0. Electron downloads a binary of about 100 MB on `npm ci`, locally and in CI |
| 3 | Architecture Fit | GO | ARCHITECTURE's diagram already puts a WebSocket feed on the 127.0.0.1 API server. Contributed routes are the established extension seam, the session manager already has an observer hook (`onMessage`), and D10 calls for a thin-shell app |
| 4 | Scope vs Supervisor Capability | CAUTION | Roughly 15 kernel files plus a scaffold of about 30 new app files is well past one worker's context, so it is split: `context-bound` |
| 5 | Hard Blockers | CAUTION | The `npm run package` criterion needs macOS with a GUI login session. CI runs ubuntu, so it is evidenced once in a committed file. The host disk is 96% full with 19 GiB free, enough for one electron-builder output |

**Overall Verdict:** CAUTION

## Task
**Goal:** Land phase 5's shared foundation in one change: migration 016 (`session_output`), an empty `console` kernel feature, the contributed-route controls (`sessions`, `killSwitch`), a stubbed WebSocket upgrade and output sink, the `app/` Electron + React + Vite scaffold with every dependency later items need, the typed API contract plus its kernel-side pin, the CI `app` job, and the architecture docs with their stub pages.

**Problem Statement:**
The owner needs phase 5's shared files, dependencies, stubs and API contract created in one change first, because items 02–17 should each edit only their own module, test and doc page, and run in parallel waves without merge conflicts.
Today no `app/` exists and CI builds only `kernel/`. The kernel has no WebSocket (`kernel/src/api/server.ts` serves HTTP only) and keeps no session output. Contributed routes get only the store and the clock (`ContributedRouteRequest`, `kernel/src/features/contribution.ts:192`), so a contributed route can't stop a session. Every later item would need to edit the same shared files: the migrations list, `features/index.ts`, `server.ts`, `sessions/manager.ts`, `app/package.json` and its lockfile, the router, CI and `docs/ARCHITECTURE.md`. While those files are shared, no two items can share a wave.
Success looks like this: every later item has a stub file it owns, a contract it codes against, and no reason to edit a shared file. No behaviour beyond the stubs ships.

**Owner decisions (binding, from the source requirement, 2026-10-20):** live feed = one WebSocket event feed on the existing API server behind the same bearer token. Session output = a bounded log the kernel keeps. v1 coverage = Chat cards and the ⌘K palette. Setup stays in the terminal. Packaging = a local, ad-hoc-signed `Loomwright Studio.app` (never published, not notarised). Stack = `app/`: Electron + React + TS + Vite, with a thin main process, and a renderer that talks to the kernel only over the loopback API through the main process. Pause all = pause new work. The kernel posts notifications and the app opens their `loomwright-studio://` links. Stop is graceful and Kill is immediate. The tray stays and there is no autostart. Read the source requirement's §Owner decisions for the full text. Don't reopen any of these.

**Non-goals:** any screen, component or kernel behaviour beyond the stubs (items 02–17). Notarisation, auto-update and launch at login.

## Acceptance Criteria
1. [ ] Given a fresh store, when migrations run, then migration 016 (`session_output`, exported as `sessionOutput` from `kernel/src/store/migrations/016_session_output.ts`) creates `session_output` with id, session, seq (per session), kind, payload JSON and created, and no SQL CHECK and no SQL trigger. Given a store at 015, when it upgrades, then nothing else changes: every other table and object keeps its text, the integrity check passes before and after, and a re-run with its `schema_migrations` row deleted is a no-op. The kind set (`assistant_text` / `tool_call` / `tool_decision` / `tool_result` / `result` / `system`) is closed in code as `SESSION_OUTPUT_KINDS` in `kernel/src/console/output.ts`.
2. [ ] Given the shipped contributions, when they merge, then `console` is registered eighth, after `agents`, with no tools, routes, subcommands, handlers or due work. Its `index.ts` merges empty parts from `events.ts`, `output.ts`, `control.ts`, `pause.ts` and `threads.ts` in that order, and `kernel/test/console-foundation.test.ts` pins all of that. `features/index.js` still loads without the Agent SDK (the module-graph pin in `feature-seams.test.ts` stays green).
3. [ ] Given a request to `GET /events/stream` with `Upgrade: websocket` and no token, or a wrong one, then it is refused with `401` before any upgrade and the socket is closed. Given the token, then it is upgraded, handed to `handleEventFeed(socket, req, ctx)` in `kernel/src/api/feed.ts`, and closed by the stub with code 1013. The test is in `kernel/test/api.test.ts`. An upgrade on any other path, even with the token, is refused and never upgraded.
4. [ ] Given a contributed route, when it runs, then its request carries `sessions` (the kernel's `SessionManager`, or `undefined` in a composition without one) and `killSwitch` (a read-only view of the kill-switch state), beside params, query, body, store and now. A `feature-seams.test.ts` case pins both, and its existing pin that a server given no applier adds no `approvalApplier` key stays green.
5. [ ] Given a running session, when the SDK emits a message, then the manager calls the optional `onOutput(sessionId, message)` for every message, beside `onMessage`. An `onOutput` that throws is recorded like `onMessage`'s `observer_error` and never breaks the session (pinned in `kernel/test/sessions.test.ts`). `kernel.ts` wires it to `recordSessionOutput` in `kernel/src/console/output.ts`, which is a no-op.
6. [ ] Given `npm ci && npm run typecheck && npm test && npm run build` in `app/`, then all four pass. The Playwright Electron smoke (`app/e2e/smoke.spec.ts`) opens the window against `app/e2e/fixture-kernel.ts` and shows the sidebar's five entries: Chat, Crew, Team, Approvals, Sessions. With no fixture kernel running, it shows the "kernel unreachable" band.
7. [ ] Given `npm run package` on macOS, then `Loomwright Studio.app` is built ad-hoc signed and registers the `loomwright-studio://` scheme. A committed evidence file `docs/evidence/phase-5-foundation-package.md` records the package command and its output tail, `codesign -dv` on the bundle (an ad-hoc signature), the `CFBundleURLTypes` scheme from the built `Info.plist`, and the check that the app opens with no terminal (`open "<path>/Loomwright Studio.app"` through LaunchServices, then the app's process seen running and the window shown). The PR body links to that file.
8. [ ] Given the renderer, then no code path in it can read the API token. The preload exposes exactly one key, `api`, through `contextBridge.exposeInMainWorld`, the window uses `contextIsolation: true` with `nodeIntegration: false`, and the main process makes every API call. A test in `app/` pins all three, and a test pins that `kernel-connection.ts` never puts the token in a log line or in anything it returns to the bridge.
9. [ ] Given `docs/design/tokens.json`, then `app/src/styles/tokens.css` equals `node app/scripts/tokens.mjs`'s output byte for byte (a test pins it) and holds the light and dark custom properties plus the layout width tokens. `bash scripts/check-docs.sh` passes.
10. [ ] Given `app/src/api/contract.ts`, then it types every route the app calls: the existing phase 1, brain, approvals, triggers, playbooks and agents routes, plus items 02–07's new routes as their requirement files name them (listed under Subtask 2). It also types the feed's frame shape, and exports `CONTRACT_ROUTES`, the list of `{method, path}`. `kernel/test/console-contract.test.ts` pins that list's paths and methods against the same list written literally in the test (each route listed once), and asserts that every `CONTRACT_ROUTES` entry the test marks existing matches a route in `PHASE1_ROUTES` or in `mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes`.
11. [ ] Given `.github/workflows/ci.yml`, then it has a new `app` job: `npm ci`, typecheck, vitest, build, and the Playwright Electron smoke under xvfb on ubuntu-latest. The existing `ci` job is unchanged, name included.
12. [ ] Given `docs/ARCHITECTURE.md`, then it documents the app (the main/renderer split, and the token never reaching the renderer), the `session_output` table in the data model, the feed, and the console feature. It gains a "Phase 5 features" section linking new stub pages `docs/architecture/app.md`, `feed.md`, `session-output.md`, `session-control.md`, `pause.md` and `threads.md`, each naming its item and the contract types it fills.

**Validation (must pass before merge):** `cd kernel && npm ci && npm run typecheck && npm test`; `cd app && npm ci && npm run typecheck && npm test && npm run build`; `bash scripts/check-docs.sh`.

## Touched-file invariants

> Grounded at base `3a20ac8fc847e47f01dba7e80450e399fc36a200`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/api/server.ts`**
  - **Keep:** authentication runs before routing on every request, `if (!isAuthorized(req, expected)) {`, with the constant-time compare `return timingSafeEqual(presented, expected);` and the comment `// Headers only: the body is not touched before the caller is authenticated.` A Node `http` server does **not** send an `Upgrade: websocket` request through the `createServer` request handler. It emits a separate `'upgrade'` event, and with no listener the socket is just destroyed. So the new `server.on("upgrade", …)` handler must call the same `isAuthorized(req, expected)` first and write a raw `HTTP/1.1 401 Unauthorized` (with `WWW-Authenticate: Bearer`) to the socket before destroying it. It never calls `handleUpgrade` for an unauthenticated request or for any path other than `/events/stream`.
  - **Keep:** the contributed handler call `match.route.handler({ params: match.params, query, body, store, now, ...applier })` and the conditional-spread idiom `const applier = options.approvalApplier === undefined ? {} : { approvalApplier: options.approvalApplier };`. The pin `expect(seen[0]).not.toHaveProperty("approvalApplier");` must stay green.
  - **Keep:** `close()` resolving only once in-flight requests are answered. An open feed socket must not keep `close()` from resolving: the stub closes at once, and `close()` should also terminate open feed sockets.
  - **Mirror:** `ApiServerOptions.sessions` is `Pick<SessionManager, "stopAll" | "abandonSession"> & …`. Test fakes pass only those two methods (`sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon }` in `feature-seams.test.ts`). So `req.sessions` must come from a **new optional** option (for example `readonly sessionManager?: SessionManager`), which `kernel.ts` sets to `manager`, never from the narrowed `sessions` Pick.
  - **Pinned by:** `kernel/test/api.test.ts` (401 body `UNAUTHORIZED_BODY`) and `kernel/test/feature-seams.test.ts` (`describe("the route seam carries the API's store and clock"`).
- **`kernel/src/features/contribution.ts`**
  - **Keep:** `ContributedRouteRequest`'s existing fields and `readonly approvalApplier?: ApprovalApplier;`.
  - **Keep:** the new fields optional at the type level (`sessions?`, `killSwitch?`). Test files build request literals without them, `route.handler({ params: { id }, query: {}, body: undefined, store, now })` in `playbooks-crew.test.ts`, `route.handler({ params: { id }, query: {}, body, store, now })` in `playbooks-runs.test.ts`, and `r.handler({ params: {}, …` in `brain-crew-routing.test.ts`, and must still typecheck. The server always sets `killSwitch`, and sets `sessions` whenever it was given a manager.
  - **Keep:** imports from `../sessions/*` stay `import type`, as in `import type { HeldToolVerdict, SessionHandle, SessionRow, SessionStatus, StartSessionParams } from "../sessions/types.js";`. The CLI loads this module, and the module-graph pin fails if a value import pulls in the SDK.
- **`kernel/src/features/index.ts`**
  - **Keep:** the frozen order `Object.freeze([`, with `consoleContribution` appended after `agentsContribution,`. Update the header comment ("the five phase 2 features, then phase 3's `playbooks`, then phase 4's `agents`") to name phase 5's `console`.
  - **Keep:** the module-graph rule "neither it nor anything it loads may import the Agent SDK, the session manager or `kernel.ts`". `kernel/src/console/*` uses type-only imports for `SDKMessage` and `SessionManager`.
  - **Pinned by:** `kernel/test/feature-seams.test.ts`, three literal contributor lists ending `"playbooks", "agents"]` (the `SHIPPED_CONTRIBUTIONS.map((c) => c.name)`, `merged.contributors` and `kernel.contributions.contributors` assertions), all of which must gain `"console"`. Also `kernel/test/agents-foundation.test.ts`'s `expect(SHIPPED_CONTRIBUTIONS[6]).toBe(agentsContribution);`, which stays true with console at index 7.
- **`kernel/src/store/migrations/index.ts`, plus new `016_session_output.ts`**
  - **Keep:** the rule `/** Every migration, in ascending version order. Append only; never edit a shipped one. */`.
  - **Reuse:** 014's idioms: the `NOW` default `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, `CREATE TABLE IF NOT EXISTS`, and the doc comment's "Creates no SQL trigger: the integrity check refuses any trigger the kernel does not list" (014_agents.ts). Value sets stay closed in code, never `CHECK`.
  - **Keep:** `seq` unique per session, through `UNIQUE (session_id, seq)` or a unique index (an index is fine, a trigger is not). Don't touch `events` or its triggers.
- **`kernel/test/store.test.ts`**
  - **Pinned:** every literal that names the top migration must move to 16: the `[15, "session_cwd"],` row in the default-list test (add `[16, "session_output"]` after it), the six `toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])` lists, the `.at(-1)).toEqual([15, "session_cwd"])` assertions, the table-name list ending `"agents",` (add `"session_output"`), and the test title "the default list adds …". The `describe("migration 15: session_cwd"` block keeps pinning an upgrade to exactly 15. Today it upgrades with the default list (`const store = open();`, `const rerun = open();`), so with 016 appended its two `.at(-1)).toEqual([15, "session_cwd"])` assertions and its "only sessions gains a column, every other object keeps its text" check would see `session_output`. Make that block open with `migrations.slice(0, 15)`, as the 14 block already does with a slice (`// The upgrade this describe pins is to 14: migration 15 ALTERs sessions`). Its two `.at(-1)` assertions then stay `[15, "session_cwd"]`, and only the default-list assertions outside it move to `[16, "session_output"]`. Add a `describe("migration 16: session_output"` block in the same shape: upgrade from a v15 store with rows, re-run as a no-op, integrity before and after.
- **`kernel/src/sessions/manager.ts` / `kernel/src/sessions/types.ts`**
  - **Mirror:** the new `onOutput` beside `readonly onMessage?: (sessionId: number, message: SDKMessage) => void;`, with a doc comment in the same form ("An observer that throws is recorded as an `observer_error` event and never breaks the session").
  - **Reuse:** `#observe`'s try/catch, ending in `// The store is gone; the session loop must still not break.`. Call `onOutput` from the same per-message point as `this.#onMessage(live.id, message);`, guarded the same way, so one observer's throw never skips the other.
  - **Pinned by:** `kernel/test/sessions.test.ts`.
- **`kernel/src/kernel.ts`**
  - **Keep:** `onMessage: budget.observe,`. Add `onOutput` beside it, wired to `recordSessionOutput`, and pass the manager to the API server through the new optional option, next to `sessions: manager,`.
  - **Keep:** `routes: contributions.routes,` and `approvalApplier,` unchanged.
- **`kernel/package.json` / `kernel/package-lock.json`**
  - **Keep:** exact-pinned or caret deps as today (`"zod": "^4.6.5"`). Add `ws` to `dependencies` and `@types/ws` to `devDependencies`, and regenerate the lockfile with `npm install` (never hand-edit it).
  - **Keep:** `npm run build` (`node scripts/build.mjs`) bundles or copies `ws`, so `node dist/daemon.js --version` still runs (the CI smoke step). Check `kernel/scripts/build.mjs` for how it treats dependencies.
- **`.github/workflows/ci.yml`**
  - **Keep:** the job name `ci` and its every step: `# The job is named \`ci\` on purpose: it is the required status check on \`main\``. The new `app` job is a sibling job, keyed on `hashFiles('app/package.json')` like the kernel steps, using `actions/setup-node@v4` with `node-version: 22` and `cache-dependency-path: app/package-lock.json`.

## Closed enumerations touched

> Sibling greps at base `3a20ac8fc847e47f01dba7e80450e399fc36a200`: `grep -rnF 'agentsContribution' kernel/src kernel/test docs CLAUDE.md README.md` → 13 hits in 5 files; `grep -rnF '"playbooks", "agents"' kernel docs --exclude-dir=node_modules --exclude-dir=dist` → 3 hits in 1 file; `grep -rnF '[15, "session_cwd"]' kernel/test` → 6 hits in 1 file.

- **`console`** (a contributor name; sibling `agents`) must be named in:
  - `kernel/src/features/index.ts`: the `SHIPPED_CONTRIBUTIONS` frozen list (`agentsContribution,`). Extend.
  - `kernel/test/feature-seams.test.ts`: the three contributor lists ending `"playbooks", "agents"]`. Extend.
  - `docs/ARCHITECTURE.md`: the Phase 2 features prose "(these five, then phase 3's playbooks and phase 4's agents)". Extend. A new "Phase 5 features" section says console is registered eighth.
  - `kernel/src/agents/index.ts` (the comment "seventh, after `playbooks`"): no change, since agents is still seventh.
  - `kernel/test/agents-foundation.test.ts` (`SHIPPED_CONTRIBUTIONS[6]`, `agentsContribution.name`) and `kernel/test/agents-roster.test.ts`: no change. They index or merge agents alone and are not closed lists of every contributor.
- **`session_output`** (a migration name and table; sibling `session_cwd`) must be named in:
  - `kernel/src/store/migrations/index.ts`: the `migrations` array (`sessionCwd,`). Extend.
  - `kernel/test/store.test.ts`: the version and name lists and the table list (see Touched-file invariants). Extend.
  - `docs/ARCHITECTURE.md`: the `## Data model` table (`| Table | Holds |`). Extend with a `session_output` row (migration 16).
- **`SESSION_OUTPUT_KINDS`** (a new closed set: `assistant_text`, `tool_call`, `tool_decision`, `tool_result`, `result`, `system`): defined once in `kernel/src/console/output.ts` and mirrored as a TS union in `app/src/api/contract.ts`. `kernel/test/console-contract.test.ts` pins that both carry the same six values.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-foundation.test.ts`: console is the eighth shipped contribution | delete `  consoleContribution,` in `kernel/src/features/index.ts` |
| `kernel/test/store.test.ts`: migration 16 creates `session_output` | delete `  sessionOutput,` in `kernel/src/store/migrations/index.ts` |
| `kernel/test/api.test.ts`: the feed stub closes 1013 | flip `1013` → `1000` in `kernel/src/api/feed.ts` |
| `kernel/test/api.test.ts`: an upgrade with no token is refused 401 before any upgrade | in `kernel/src/api/server.ts`'s `'upgrade'` listener, remove the `isAuthorized(req, expected)` check (reviewer-applied: the literal also appears in the HTTP handler) |
| `kernel/test/feature-seams.test.ts`: the route request carries `sessions` and `killSwitch` | in `kernel/src/api/server.ts`, drop `killSwitch` from the object passed to `match.route.handler(…)` (reviewer-applied) |
| `kernel/test/sessions.test.ts`: `onOutput` is called for every SDK message, and a throw is `observer_error` | in `kernel/src/sessions/manager.ts`, delete the line that calls the `onOutput` option (reviewer-applied) |
| `kernel/test/console-contract.test.ts`: the contract's routes and methods | delete one route entry in `CONTRACT_ROUTES` in `app/src/api/contract.ts` (reviewer-applied) |
| the `app/` preload pin: exactly one bridge key, `api` | flip `"api"` → `"token"` in the `exposeInMainWorld` call in `app/electron/preload.ts` (reviewer-applied) |
| the `app/` tokens pin: `tokens.css` equals the generator's output | delete any one custom-property line in `app/src/styles/tokens.css` (reviewer-applied) |
| `kernel/test/console-contract.test.ts`: `SESSION_OUTPUT_KINDS` and the contract's kind union carry the same six values | delete `"system"` from `SESSION_OUTPUT_KINDS` in `kernel/src/console/output.ts` (reviewer-applied) |
| `kernel/test/api.test.ts`: an upgrade with a wrong token is refused 401 | in `kernel/src/api/server.ts`'s `isAuthorized`, make the `'upgrade'` listener accept any non-empty `Bearer` value (reviewer-applied) |
| `kernel/test/api.test.ts`: an upgrade on any path other than `/events/stream` is refused, even with the token | remove the `/events/stream` path check in `kernel/src/api/server.ts`'s `'upgrade'` listener (reviewer-applied) |
| the `app/` window pin: `contextIsolation: true` | flip `contextIsolation: true` → `contextIsolation: false` in `app/electron/main.ts` |
| the `app/` window pin: `nodeIntegration: false` | flip `nodeIntegration: false` → `nodeIntegration: true` in `app/electron/main.ts` |
| the `app/` token pin: `kernel-connection.ts` never logs the token or returns it to the bridge | add `console.log(token)` after the Keychain read in `app/electron/kernel-connection.ts`, or return the token in the bridge's result (reviewer-applied) |
| the CI `app` job (Criterion 11; no test pins workflow text, so the PR's own CI run on the job is the evidence) | delete the `app:` job in `.github/workflows/ci.yml` → the PR's checks list shows no `app` run (reviewer-checked on the PR, not a vitest pin) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel seams: migration 016, empty `console` feature, route controls, WebSocket upgrade stub, output sink | 1, 2, 3, 4, 5 | 13 modify, 9 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App scaffold: Electron main/preload, kernel connection, renderer layout + stub screens, tokens, command registry, contract, test rig, packaging, CI `app` job, package evidence | 6, 7, 8, 9 (tokens), 10 (contract.ts), 11 | 1 modify, ~32 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md`, `skills/ci-cd/SKILL.md` | LAUNCHABLE |
| 3 | Contract pin test + architecture docs and six stub pages | 9 (check-docs), 10 (kernel pin), 12 | 1 modify, 7 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1, #2) |

**Subtask 1 design notes:**
- The `console` feature (`kernel/src/console/`) follows `kernel/src/agents/index.ts`'s parts pattern: one empty part per sub-file (`events.ts`, `output.ts`, `control.ts`, `pause.ts`, `threads.ts`), merged in that order into one frozen `consoleContribution` named `console`. It has no `subcommands` key, unless the parts pattern needs one. If it does, `console-foundation.test.ts` pins the exact key set, as `agents-foundation.test.ts` does.
- `output.ts` exports `SESSION_OUTPUT_KINDS` and a no-op `recordSessionOutput(store, sessionId, message)`, or a factory over the store. Its shape is the worker's choice, as long as `kernel.ts` can wire it with no SDK value import.
- `killSwitch` on the request is read only. Pass the `KillSwitchState` reader bound to the store (for example `killSwitch: { state: () => killSwitchState(store) }`) or an equivalent getter, never `engageKillSwitch`/`releaseKillSwitch`.
- `feed.ts` exports `handleEventFeed(socket, req, ctx)`, with `ctx` holding at least `{store, now}`. The stub closes with 1013 and the reason `"not yet"`. Use `ws`'s `WebSocketServer({ noServer: true })` and `handleUpgrade` inside the authenticated `'upgrade'` listener.

**Subtask 2 design notes:**
- **Layout:** `app/package.json` (scripts `typecheck`, `test`, `build`, `package`, `e2e`), `app/package-lock.json`, the tsconfig(s), `app/vite.config.ts`, `app/index.html`, `app/electron/{main,preload,kernel-connection,tray,deeplink}.ts`, `app/src/{main.tsx,App.tsx}`, `app/src/screens/{chat,team,approvals,sessions}/index.tsx`, `app/src/commands/registry.ts`, `app/src/api/contract.ts`, `app/src/styles/tokens.css`, `app/scripts/tokens.mjs`, the vitest config and unit tests under `app/src/**`, `app/e2e/{smoke.spec.ts,fixture-kernel.ts}`, `app/e2e/fixtures/` (for later items), and `app/playwright.config.ts`.
- **Dependencies:** install every one later items need, so none of them touches `app/package.json`: react, react-dom, electron, vite, typescript, vitest, @testing-library/react, jsdom, @playwright/test, electron-builder, plus their required companions (@vitejs/plugin-react, @types/react, @types/react-dom, @types/node). Install exactly one small spring library for the avatar (`@react-spring/web` or `motion`) and record which in `docs/evidence/phase-5-foundation-package.md`'s dependency list. Item 09 may use only that one.
- **Kernel connection:** `kernel-connection.ts` reads `<dataDir>/api.json` (pid + port, never a token), checks the pid is alive, reads the `loomwright-studio-api` Keychain item through `/usr/bin/security`, and connects only to `127.0.0.1`, mirroring the CLI (ARCHITECTURE §Loopback API). The data dir and token reader may be injectable for the fixture kernel only through the main process's environment, which Playwright's `electron.launch({ env })` sets. The renderer can never reach that seam.
- **Contract routes (`CONTRACT_ROUTES`):** existing (verified at base): phase 1's `GET /status`, `POST /stop-all`, `POST /resume` and `POST /sessions/:id/abandon`; the brain's `POST /ask`, `GET /messages` and `GET /messages/:id`; approvals' `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/deny`, `GET /approvals/grants` and `POST /approvals/grants/:id/revoke`; triggers' `GET /triggers`, `POST /triggers/:id/on` and `POST /triggers/:id/off`; playbooks' `GET /playbooks`, `GET /playbooks/:ref`, `POST /playbooks/:id/set`, `POST /playbooks/:id/off` and `POST /playbooks/:id/run`; and agents' `GET /agents`, `GET /agents/:id`, `POST /agents`, `POST /agents/:id/rename`, `POST /agents/:id/set`, `POST /agents/:id/off` and `POST /agents/:id/on`. New, from items 02–07's requirement files: `GET /events` (02), the `GET /events/stream` feed (02), `GET /sessions` and `GET /sessions/:id/output` (03), `POST /sessions/:id/stop` and `POST /sessions/:id/kill` (04), `POST /pause` and `POST /unpause` (05, and read item 05's file for whether `/resume` also clears pause), and `GET /threads/:agent` (06). Item 07 adds no route: it lets the existing `POST /agents/:id/set` accept `wright`, so that route is listed once, as existing, with item 07's Wright fields in its body type. Read each item's requirement file under `.supervisor/requirements/phase-5/` for the exact path, query and body. The feed's frames are `{"type":"subscribe","after"}` (client) and `{"type":"event","id","at","kind","session_id","task_id","payload"}`, with the truncated form `{"type":"event","id","kind","truncated":true}` (item 02).
- **Ignores:** add `app/.gitignore` with `test-results/` and `playwright-report/`, plus the electron-builder output dir if it isn't `dist/` or `out/` (the root `.gitignore` already covers `node_modules/`, `dist/` and `out/`).
- **Layout tokens and the unreachable state:** the 240px sidebar, 52px title bar, 320px inspector and 360px list pane come from `docs/design/tokens.json` (DESIGN.md §"What the mockups commit phase 5 to"). The "kernel not installed" state shows the exact terminal setup commands (`studio service install`, and the subscription-token step per D27).
- **Packaging:** electron-builder with `mac.identity: null` (or `"-"` for ad-hoc), `productName: "Loomwright Studio"`, and `protocols: [{ name: …, schemes: ["loomwright-studio"] }]`. No publish config. Branding: "Wright, powered by Claude" is allowed. Nothing may say or look like "Claude Code" (invariant 7).

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/016_session_output.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/016_session_output.ts", name: "sessionOutput"}
  - {kind: "file", path: "kernel/src/console/index.ts"}
  - {kind: "symbol", path: "kernel/src/console/index.ts", name: "consoleContribution"}
  - {kind: "symbol", path: "kernel/src/console/output.ts", name: "SESSION_OUTPUT_KINDS"}
  - {kind: "symbol", path: "kernel/src/console/output.ts", name: "recordSessionOutput"}
  - {kind: "file", path: "kernel/src/console/events.ts"}
  - {kind: "file", path: "kernel/src/console/control.ts"}
  - {kind: "file", path: "kernel/src/console/pause.ts"}
  - {kind: "file", path: "kernel/src/console/threads.ts"}
  - {kind: "symbol", path: "kernel/src/api/feed.ts", name: "handleEventFeed"}
  - {kind: "type", path: "kernel/src/features/contribution.ts", name: "ContributedRouteRequest"}
  - {kind: "file", path: "kernel/test/console-foundation.test.ts"}
requires: []
lanes:
  - "kernel/src/store/migrations/016_session_output.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/test/store.test.ts"
  - "kernel/src/console/**"
  - "kernel/test/console-foundation.test.ts"
  - "kernel/src/features/index.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/api/feed.ts"
  - "kernel/test/api.test.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/src/kernel.ts"
  - "kernel/package.json"
  - "kernel/package-lock.json"
external_requires:
  - "ws 8.x and @types/ws from the npm registry"

# Subtask 2
provides:
  - {kind: "file", path: "app/package.json"}
  - {kind: "file", path: "app/package-lock.json"}
  - {kind: "file", path: "app/electron/main.ts"}
  - {kind: "file", path: "app/electron/preload.ts"}
  - {kind: "file", path: "app/electron/kernel-connection.ts"}
  - {kind: "file", path: "app/electron/tray.ts"}
  - {kind: "file", path: "app/electron/deeplink.ts"}
  - {kind: "file", path: "app/src/main.tsx"}
  - {kind: "file", path: "app/src/App.tsx"}
  - {kind: "file", path: "app/src/screens/chat/index.tsx"}
  - {kind: "file", path: "app/src/screens/team/index.tsx"}
  - {kind: "file", path: "app/src/screens/approvals/index.tsx"}
  - {kind: "file", path: "app/src/screens/sessions/index.tsx"}
  - {kind: "file", path: "app/src/commands/registry.ts"}
  - {kind: "file", path: "app/src/api/contract.ts"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "CONTRACT_ROUTES"}
  - {kind: "file", path: "app/scripts/tokens.mjs"}
  - {kind: "file", path: "app/src/styles/tokens.css"}
  - {kind: "file", path: "app/e2e/smoke.spec.ts"}
  - {kind: "file", path: "app/e2e/fixture-kernel.ts"}
  - {kind: "symbol", path: ".github/workflows/ci.yml", name: "app"}
  - {kind: "file", path: "docs/evidence/phase-5-foundation-package.md"}
requires: []
lanes:
  - "app/**"
  - ".github/workflows/ci.yml"
  - "docs/evidence/phase-5-foundation-package.md"
external_requires:
  - "electron, vite, react, electron-builder, @playwright/test and the rest of the app's dependencies from the npm registry"
  - "macOS with a GUI login session, for the one-time npm run package + open check recorded in the evidence file"
  - "xvfb on the ubuntu-latest GitHub runner for the Playwright Electron smoke"

# Subtask 3
provides:
  - {kind: "file", path: "kernel/test/console-contract.test.ts"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "Phase 5 features"}
  - {kind: "file", path: "docs/architecture/app.md"}
  - {kind: "file", path: "docs/architecture/feed.md"}
  - {kind: "file", path: "docs/architecture/session-output.md"}
  - {kind: "file", path: "docs/architecture/session-control.md"}
  - {kind: "file", path: "docs/architecture/pause.md"}
  - {kind: "file", path: "docs/architecture/threads.md"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/console/index.ts", name: "consoleContribution"}
  - {from: "1", kind: "symbol", path: "kernel/src/console/output.ts", name: "SESSION_OUTPUT_KINDS"}
  - {from: "2", kind: "symbol", path: "app/src/api/contract.ts", name: "CONTRACT_ROUTES"}
lanes:
  - "kernel/test/console-contract.test.ts"
  - "docs/ARCHITECTURE.md"
  - "docs/architecture/app.md"
  - "docs/architecture/feed.md"
  - "docs/architecture/session-output.md"
  - "docs/architecture/session-control.md"
  - "docs/architecture/pause.md"
  - "docs/architecture/threads.md"
external_requires: []
```

**Subtask 3 design notes:** `console-contract.test.ts` reads `app/src/api/contract.ts` **as text** and extracts the `CONTRACT_ROUTES` entries and the session-output kind union. It never imports across packages: the kernel's `tsconfig.json` includes only `src` and `test`, and `tsconfig.build.json` must stay `rootDir src`. It compares them with a literal list in the test and with `SESSION_OUTPUT_KINDS`, and checks every route the kernel already serves against `PHASE1_ROUTES` plus `mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes`. Each stub page links back to `../ARCHITECTURE.md` and names its item, and every relative link must resolve (`scripts/check-docs.sh` check 1).

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 3
Subtask 2 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (kernel/** vs app/**, ci.yml, one evidence file) | NO |
| Subtask 1 | Subtask 3 | none (3 adds one new kernel test; reads 1's outputs) | YES (requires) |
| Subtask 2 | Subtask 3 | none (3 reads `app/src/api/contract.ts`, never edits it) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel, zero file overlap, both with empty `requires`)
- **Batch 2:** Subtask 3 (after Subtasks 1 and 2)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md`, `skills/ci-cd/SKILL.md` |
| 3 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/features/contribution.ts:192` | yes | HOLDS | `export interface ContributedRouteRequest {` (fields params, query, body, store, now, approvalApplier only, so no session controls) | tip 14 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): a new stack and about 13 new npm dependencies, including Electron's binary download of about 100 MB, on every `npm ci` | MEDIUM | Pin the versions verified today (Feasibility table). Commit `app/package-lock.json`. In CI, cache npm on `app/package-lock.json`. |
| Feasibility (Phase 2.5): `context-bound` scope, a big diff whose stubs might accidentally ship behaviour | HIGH | Three subtasks. The reviewer checks that every console part is empty, `feed.ts` only closes 1013, `recordSessionOutput` is a no-op, and every screen is a placeholder. This is the requirement's own named risk. |
| Feasibility (Phase 2.5): the `npm run package` criterion needs macOS with a GUI session, and the run may be headless | MEDIUM | Evidence goes to `docs/evidence/phase-5-foundation-package.md`: `codesign -dv`, the `Info.plist` scheme, and an `open` through LaunchServices plus the process check. If no GUI session is available, the file says so honestly and the owner re-runs `open` once before approving. Never claim "opened from Finder" without having looked. |
| Node's `http` server routes `Upgrade` requests to the `'upgrade'` event, not the request handler, so the existing auth-before-routing check does **not** cover the feed unless it is repeated there | HIGH | Touched-file invariant on `server.ts`. Criterion 3 pins a 401 before any upgrade, both with no token and with a wrong one, plus a refused upgrade on any other path. |
| Feasibility (Phase 2.5): the host disk is 96% full (19 GiB free), and two parallel `npm ci` runs (one with Electron's binary) plus an electron-builder output land on it | LOW | Check `df -h .` before the package step. The owner may remove the merged worktrees listed under Environment (`loomwright-studio-p4-done` and the two under `.claude/worktrees/`). Workers never remove them on their own. |
| The new `app` job is not a required check (branch protection requires only `ci`), so a red app job would not block a merge | MEDIUM | Keep `ci` untouched as the requirement asks. In the PR, the owner is told that `app` must be added to `main`'s required checks (owner action: `gh api repos/vikashruhilgit/loomwright-studio/branches/main/protection`). |
| The fixture-kernel seam (data dir and token reader injectable through main's environment) could become a way for the shipped app to talk to a non-kernel endpoint, or to reveal the token | MEDIUM | Only the main process reads the injection, and it stays loopback-only (`127.0.0.1`). A test pins that the renderer bridge never returns the token. Document the seam in `docs/architecture/app.md`. |
| `ContributedRouteRequest.sessions` typed as the full `SessionManager`, while `ApiServerOptions.sessions` is a two-method Pick that test fakes satisfy | MEDIUM | Source `req.sessions` from a new optional `ApiServerOptions` field set by `kernel.ts`. Keep the request fields optional so the existing test request literals compile (Touched-file invariants). |
| The kernel build (`scripts/build.mjs`) may not carry the new `ws` runtime dependency into `dist/`, which would break the `--version` CI smoke | MEDIUM | Read `kernel/scripts/build.mjs` before adding `ws`, and run `npm run build && node dist/daemon.js --version` locally. |
| Typing items 02–07's routes before they exist could drift from what those items build | LOW | Each kernel item makes its route match the contract (the requirement's rule). `console-contract.test.ts` pins paths and methods, and its served-route check tightens as items land. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-21-phase-5-foundation-app-scaffold-seams.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-21T05:07:47Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/101
- **Branch:** feature/phase-5-foundation-app-scaffold-seams
- **Files changed:** 73
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** 3/3 subtasks merged (kernel seams, app scaffold, contract pin + docs). Phase 4.5: iteration 1 FAIL (HIGH dot-segment allowlist escape, fixed 156e0ed); iteration 2 PASS with 2 MEDIUM at the floor (lone-surrogate encode + untested upgrade branches, fixed c6ad38c); iteration 3 PASS, 1 LOW. 4 LOW findings dismissed below the MEDIUM floor (PR comment). Kernel 1742 passed / 10 skipped, app 38, check-docs OK, CI app/ci/claude-review green. FINALIZE needed two owner decisions: SUP-CHILDREN proceed anyway (afb12cc287e65a547, a superseded subtask-2 worker), and a repair of the false session_end that close-stranded-run.sh wrote when this headless session paused on that question.

## Not verified
- **Packaged app window seen by a person** — the open check ran while the screen was locked; the owner runs open once (subtask 2)
- **CI app job on ubuntu xvfb** — PR only; it has since passed on the PR (subtask 2)
- **App use of /events/stream via Electron main** — the kernel stub closes the socket (subtask 1)
- **ARCHITECTURE.md heading anchors** — check-docs.sh strips anchors; checked by reading (subtask 3)
