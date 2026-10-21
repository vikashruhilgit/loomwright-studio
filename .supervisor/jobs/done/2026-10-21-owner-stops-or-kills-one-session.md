# Supervisor Job: The owner stops or kills one session from the app (phase 5 item 04)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio (lane L3 worktree of run `automate-2026-10-21-052020`)
- **CLAUDE.md:** ✓ Found (fresh: its kernel test command, `docs/` table and invariants match the tree at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (`.supervisor/run.lock` is held by a dead pid of this lane's own automate run; it is reclaimable and the next `run-lock.sh acquire` takes it)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140004-the-owner-stops-or-kills-one-session.md
- **Base commit:** 77be86d5d57f029e6622126d92164c7205b92a96
- **Wave:** run 2, wave 1, items 02 / 03 / 04. One file is shared within the wave: `kernel/test/console-foundation.test.ts`. Its "is its name alone" and "each empty" pins break as soon as any console part is filled, so items 02 (events part) and 03 (output part; lane L2's saved brief lists it in `lanes:` and expects the rebase conflict) edit it too. L2 also edits `docs/ARCHITECTURE.md`, so this job leaves that file alone. Every other file in this job is item 04's alone within the wave.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel only: strict TS + vitest, and the existing fake spawner and query in `kernel/test/session-fakes.ts` |
| 2 | Dependency Availability | GO | No new npm dependency |
| 3 | Architecture Fit | CAUTION | The requirement says "they run one at a time with the other POSTs, as stop-all does". That queue is a private closure, `const serialized = <T>(fn: () => Promise<T>): Promise<T> => {` in `kernel/src/api/server.ts`, and contributed routes never pass through it: `handleContributed` calls `match.route.handler(…)` directly. Item 01's seam does not fit. **Owner decision (2026-10-21, this Launch Pad session): extend the seam.** Add an optional `serialized` to `ContributedRouteRequest` and pass the server's queue into it. That is two files outside the requirement's Touches. `server.ts` belongs to item 05, but item 05 runs in wave 2, so wave 1 has no conflict. `contribution.ts` belongs to no item in run 2. |
| 4 | Scope vs Supervisor Capability | GO | 10 modified files and 1 created, tightly coupled (manager → route → CLI → tests): one worker |
| 5 | Hard Blockers | CAUTION | The CLI half can't be a contributed subcommand. `session` is a phase 1 word (`export const PHASE1_SUBCOMMANDS: readonly string[] = ["status", "stop", "resume", "session", "service"];`), so `mergeContributions` would refuse it, and `console-foundation.test.ts` pins that the console "never gets a subcommands key". So `studio session stop|kill` extends phase 1's parser in `kernel/src/cli/index.ts`, beside `session abandon`, with tests in `kernel/test/cli.test.ts`. Both are outside Touches and no item in run 2 owns them. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give the owner a graceful **Stop** and an immediate **Kill** for one session, without the kill switch. That means `SessionManager.stopSession(id, {mode})`, the contributed routes `POST /sessions/:id/stop` and `POST /sessions/:id/kill` in the console's `control.ts` part (serialized with the other POSTs), the CLI verbs `studio session stop <id>` and `studio session kill <id> [--yes]`, and the `session-control.md` page.

**Problem Statement:**
Only the kill switch (`POST /stop-all`) and an orphan's abandon (`POST /sessions/:id/abandon`) are routes today. `SessionManager.stopSession(id)` exists (`stopSession(id: number): Promise<SessionStatus> {`, which closes stdin, waits out the ~2 s grace, then runs the group kill-until-gone), but no route calls it, and no kill path skips the grace. So the owner can end one runaway agent only by stopping all of them. Success: one session is stopped or killed by id, the rest keep running, and the session ends `stopped` with an owner reason, or `failed`/`kill_incomplete` when its group can't be confirmed gone.

**Owner decisions (binding, from the source requirement, 2026-10-20):** Stop is graceful and Kill is immediate. Stop is today's stop: stdin EOF, then the group kill after the ~2 s grace, ending `stopped`. Kill kills the CLI's group and every recorded tool group at once, with no grace, and always asks for confirmation. Both are new per-session owner routes. The kill switch stays the immediate stop-and-kill of everything, unchanged. Read the source requirement's §Owner decisions for the full text, and don't reopen any of them.
**Owner decision (2026-10-21, this session):** extend item 01's route seam with an optional `serialized` (see Feasibility 3). Don't park the item, and don't drop the serialization.

**Non-goals:** the kill switch (unchanged). Stopping a session this kernel did not start (a row not live in this manager is refused `409 not_running`). Any app UI (item 16).

## Acceptance Criteria
1. [ ] Given a running stand-in session, when `POST /sessions/:id/stop`, then it ends `stopped` (`owner_stop`) after its grace, and its groups are gone.
2. [ ] Given a running session with a recorded tool group, when `POST /sessions/:id/kill`, then the CLI's group and the tool group are killed with no grace, and it ends `stopped` (`owner_kill`).
3. [ ] Given a kill whose group can't be confirmed gone, then it ends `failed`/`kill_incomplete`, flagged for the reaper, as any kill does.
4. [ ] Given a completed session, then `409 not_running`. Given an unknown id, then `404`.
5. [ ] Given `studio session kill 5` with no terminal and no `--yes`, then it refuses with exit 2.
6. [ ] `session-control.md` documents it, and `bash scripts/check-docs.sh` passes.

**Derived checks (from the requirement's Scope; each is a test in the named file):**
- Both routes answer `200 {id, status, reason}`, where `reason` is the reason of the session's terminal `session_status` event, whatever it is. For an owner stop that is `owner_stop`, `owner_kill` or `kill_incomplete`. A session that ended on its own between the route's check and the stop keeps its stream's outcome (for example `completed` / `result_success`, with `stop_requested_after_end: true` in the event), and the route reports that as it is.
- The route is pinned against the app contract, as `kernel/test/console-contract.test.ts` assigns to each item ("The routes phase 5 items add are not checked here; each item's own test pins its route against the contract."). `console-control.test.ts` reads `app/src/api/contract.ts` as text (never imports across packages). It checks that both `CONTRACT_ROUTES` entries with `origin: "item-04"` are served by `mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes` with the same method and path, and that the 200 body's keys are exactly `SessionControlResponse`'s `id`, `status` and `reason`. They refuse `400 invalid_id` (a non-positive-integer `:id`), `404 not_found`, and `409 {error: "not_running", status: <current status>}` for a terminal row or a non-terminal row this manager does not run (`SessionError("not_live")`) (`kernel/test/console-control.test.ts`).
- Each accepted request records one `session_stop_requested` event `{by: "owner", mode: "stop"|"kill"}` with the session's id, before the stop begins. A 400, 404 or 409 records none (`console-control.test.ts`).
- The routes run through the server's POST queue. A `POST /sessions/:id/kill` sent while a `POST /stop-all` is still running starts only after it. A `POST /stop-all` sent during an owner Stop answers once that Stop has ended (`console-control.test.ts`, against a real `startApiServer` with `sessionManager`).
- In a composition with no session manager (`req.sessions === undefined`) or no queue, the route answers `503 {error: "sessions_unavailable"}` and never throws (`console-control.test.ts`).
- `stopSession(id)` with no options keeps today's reason, `stop_requested`. The pin `expect(statusEvents(store, h.id).at(-1)).toEqual({ from: "running", to: "stopped", reason: "stop_requested" });` in `sessions-stop-all.test.ts` stays green, and the kill switch's `stopAll` is unchanged (`kernel/test/sessions-stop-all.test.ts`).
- A kill that arrives while a graceful stop of the same session is waiting out its grace does not wait the grace out. It kills the groups at once and shares the one in-flight stop, so there is one terminal transition (`sessions-stop-all.test.ts`).
- `studio session stop <id>` and `studio session kill <id> --yes` send the matching POST and print the outcome. They exit 0 on a 200 whose status is `stopped`, and on any other terminal status that is not `failed` (printed as is, for example a session that completed on its own). They exit 1 on `failed` (for example `kill_incomplete`) or a 400/404/409 (naming the API's error code). Without `--yes`, a kill on a terminal asks `[y/N]`, and a no sends nothing (exit 1) (`kernel/test/cli.test.ts`).

**Validation (must pass before merge):** `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh`.

## House Rules
No `.agent/rules/` store in this repository, so no house rule applies.

## Touched-file invariants

> Grounded at base `77be86d5d57f029e6622126d92164c7205b92a96`. The worker re-checks each entry before hand-back.

- **`kernel/src/sessions/manager.ts`**
  - **Keep:** `stopSession` with no options is the kill switch's call (`#stopForAll`: `const status = await (mode === "stop" ? this.stopSession(id) : this.#stopLive(id, "shutdown"));`), and it keeps `{ reason: "stop_requested" }`. The new `options: { readonly mode?: "stop" | "kill" }` is optional. `mode: "stop"` ends `owner_stop` and `mode: "kill"` ends `owner_kill`. `StopIntent` (`type StopIntent = "stop" | "shutdown";`) grows to carry the intent, and the `shutdown` branch is untouched.
  - **Keep:** the entry guards in `#stopLive` (`if (live.stopPromise !== undefined) return live.stopPromise;`), so a stop already in flight is shared and never doubled. A kill that finds a stop in flight must also cut its grace short. For example, make `#stop`'s `await this.#waitFor(attempt.exited, this.#stopGraceMs);` race a per-live "kill now" signal. Never start a second `#stop`.
  - **Reuse:** the kill path has no grace but keeps everything else. For `kill`, skip only the `#waitFor(attempt.exited, this.#stopGraceMs)`. Still run `attempt.input.close()`, the last `#walkNow` (`// One last walk of the CLI's descendants: a tool group started since the`), `#killAttemptGroup` (CLI group, then `#killRecordedGroups` with H08 ownership checks), the `LEADER_EXIT_WAIT_MS` wait, `#closeQuery`, and `#finishAfterKill`. That way a group that can't be confirmed gone ends `failed` with `reason: "kill_incomplete"` and `cause: { to, reason: … }`, exactly as today.
  - **Keep:** `stopSession` returns `Promise<SessionStatus>` (the kill switch, the tool server and tests call it). The route reads the reason from the session's last `session_status` event, so the return type doesn't need to change.
  - **Pinned by:** `kernel/test/sessions-stop-all.test.ts` (`"stopSession alone still ends a running session stopped (unchanged)"`, `"shares a stop already in flight instead of starting a second one"`) and `kernel/test/sessions.test.ts` / `sessions-tool-groups.test.ts` (the `stop_requested` reason), all unchanged.
- **`kernel/src/console/control.ts`**
  - **Keep:** type-only imports from `../sessions/*`. The only value imports are `emptyConsolePart` from `./types.js` and `appendEvent`/`NO_REF` from `../loop/internal.js`. `loop/internal.ts` imports only `import type { Store } from "../store/store.js";`, and the CLI-loaded `agents` feature already value-imports it (`import { NO_REF, appendEvent, errorMessage } from "../loop/internal.js";` in `kernel/src/agents/roster.ts`). The CLI loads this module (`// The \`studio\` CLI loads it, so it imports only types, the feature seam and` in `console/index.ts`), and `feature-seams.test.ts` pins the module graph. Use `SessionError` only by its `code` property (duck-typed), or import it as a type. Never value-import `../sessions/manager.js`.
  - **Keep true:** its header (`// Empty until item 04 fills it in.`). Replace that line with what the part now does.
  - **Out of lane:** `kernel/src/console/index.ts`. Lane L2 (item 03) edits it in this wave. Its header sentences "Every part is empty until its item fills it in, so today the contribution is its name alone" and "imports only types, the feature seam and its own parts" become stale once control.ts has routes and value-imports `../loop/internal.js`. Don't edit it here. The PR body names the stale sentences, so whichever wave-1 PR lands later (or item 05's) corrects them.
  - **Keep:** the part stays a `ConsolePart` with `routes` only. No `subcommands` key (`console-foundation.test.ts`: `"a filled part's routes, handlers and due work reach the contribution in part order; it never gets a subcommands key"`), no tools, no handlers.
  - **Mirror:** phase 1's abandon route answers in `server.ts` (`if (!Number.isSafeInteger(id) || id < 1) {` → `400 invalid_id`; `if (err.code === "not_found") return { status: 404, body: { error: "not_found" } };`). Map a non-`SessionError` throw to a rethrow, so the server's `route_failed` row and `500` apply.
  - **Never:** name the new event `stop_requested`. That kind already means "the session asked to stop itself" (`kernel_request_stop`), and playbook runs read it: `SELECT 1 FROM events WHERE kind = 'stop_requested' AND session_id = ? LIMIT 1` in `kernel/src/playbooks/runs.ts`. The new kind is `session_stop_requested`.
- **`kernel/test/console-foundation.test.ts`** (outside Touches; shared with wave-1 items 02 and 03)
  - **Change only what this item makes false, in the narrowest shape.** In `"is its name alone: no tools, routes, subcommands, handlers or due work"` (`expect(Object.keys(consoleContribution)).toEqual(["name"]);`, `expect(merged.routes.filter((r) => r.owner === "console")).toEqual([]);`) and `"… each empty"` (`expect(part, part.name).toEqual({ name: part.name, tools: [], routes: [], handlers: {} });`, `expect(mergeConsoleParts(CONSOLE_PARTS)).toEqual({ tools: [], routes: [], handlers: {}, dueWork: [] });`), make the assertions per part by name. `controlPart` has exactly the two routes (method and path) and no tools, handlers or dueWork. `events`, `pause` and `threads` stay pinned empty. Leave `output`'s line as base has it, because item 03 owns it. The console's merged routes include `POST /sessions/:id/stop` and `POST /sessions/:id/kill`, owner `console`. Rename the test titles to match.
  - **Keep true:** the file's header comment ("one `console` contribution built from five empty sub-file parts"). Reword only what this item makes false (the control part is no longer empty).
  - **Keep:** `"a filled part's routes, handlers and due work reach the contribution in part order; it never gets a subcommands key"` unchanged (item 03 changes the subcommands half; this item adds no subcommands). Keep the order pins and `SHIPPED_CONTRIBUTIONS[7]`.
- **`kernel/src/features/contribution.ts`** (outside Touches, by the owner's decision)
  - **Keep:** `ContributedRouteRequest`'s existing fields, and the new field optional at the type level, as `sessions?` and `killSwitch?` are ("Optional in the type so a request literal built without it (a test calling a handler directly) still typechecks."). Name it `serialized?: <T>(fn: () => Promise<T>) => Promise<T>`, with a doc comment: the API server's one POST queue (phase 1's stop-all, resume and abandon run on it). Only a route that makes a short, bounded change to session or kill-switch state runs its work through it, because whatever is queued delays the kill switch. Never queue slow or unbounded work on it.
  - **Keep:** imports from `../sessions/*` stay `import type`.
- **`kernel/src/api/server.ts`** (outside Touches, by the owner's decision; item 05 edits it in wave 2)
  - **Keep:** `serialized` itself unchanged. Pass the same function on the contributed request beside `killSwitch` (`await match.route.handler({ params: match.params, query, body, store, now, killSwitch, ...managed, ...applier })`). It is the same chain, never a second queue. Contributed routes that don't use it behave exactly as today.
  - **Keep:** the pin `expect(seen[0]).not.toHaveProperty("approvalApplier");` (`feature-seams.test.ts`). It is about `approvalApplier` only, so `serialized` is added unconditionally.
  - **Pinned, must move:** the exact-keys pin in `feature-seams.test.ts`, `keys: ["params", "query", "body", "store", "now", "killSwitch", "sessions", "approvalApplier"],` (the probe route returns `Object.keys(req)`). Pass `serialized` right after `killSwitch` in the handler call, so the pin becomes `["params", "query", "body", "store", "now", "killSwitch", "serialized", "sessions", "approvalApplier"]`. Also add an assertion in the `describe("the route seam carries the API's store and clock"` block that `typeof seen[0].serialized === "function"`.
  - **Keep:** `startApiServer`'s doc comment matches the call. Its request-field list (wrapped across two lines at base, about server.ts:459-460: `Their handler gets \`{params, query,` / `body, store, now, killSwitch}\``) gains `serialized` (the server's one POST queue, which phase 1's stop-all, resume and abandon also use).
- **`kernel/src/cli/index.ts`** (outside Touches; phase 1's CLI, no item in run 2 owns it)
  - **Mirror:** `session abandon`'s parse (`if (cmd === "session" && rest[0] === "abandon" && (rest.length === 2 || (rest.length === 3 && rest[2] === "--yes"))) {`, with the id regex `/^[1-9]\d*$/`), its terminal refusal (`stderr.write(\`studio: session abandon needs a terminal to confirm, or --yes\n${usage}\n\`); return 2;`), and its confirm-after-the-pid-check (`if (command.kind === "abandon" && !command.yes) {`). `stop` takes no `--yes` and never asks.
  - **Keep:** the timeout. `CLI_TIMEOUT_MS = 5_000` is shorter than a graceful stop (`DEFAULT_STOP_GRACE_MS` 2 000 + `KILL_GROUP_DEADLINE_MS` 2 000 + `LEADER_EXIT_WAIT_MS` 1 000 twice), and a request can also queue behind a stop-all. Use `STOP_ALL_TIMEOUT_MS` (`deps.stopAllTimeoutMs`) for both verbs. A timeout says the session may or may not be stopped, and to run `studio status`, as abandon's does.
  - **Keep:** `USAGE` gains the two verbs. Tests compare against the `USAGE` constant (`expect(c.stderr.text()).toBe(\`${USAGE}\n\`);`, `agents-foundation.test.ts`: `r.stderr.startsWith(\`${USAGE} | \`)`), not a literal, so they follow. Update the header comment's command list.

## Closed enumerations touched

> Sibling grep at base: `grep -rn "stop_requested" kernel/src kernel/test docs` → 30 hits in 10 files. They are the `stop_requested` status reason (manager, tests, ARCHITECTURE) and the separate `stop_requested` **event kind** (`tools/server.ts`, `playbooks/runs.ts`, `docs/architecture/playbook-runs.md`). No closed list (array, union or `CHECK`) of status reasons or event kinds exists: `EVENT_KINDS` in `kernel/src/loop/types.ts` is the loop's queue kinds (`["wakeup", "message"]`), not `events.kind`.

- **`owner_stop`, `owner_kill`** (status reasons; sibling `stop_requested`): no closed list must name them. The app contract's `SessionControlResponse.reason` doc comment (`/** \`owner_stop\` or \`owner_kill\` (or \`kill_incomplete\` for a kill that could not confirm the group gone). */`) already names them. Don't change it (`app/` is not this job's).
- **`session_stop_requested`** (an event kind; siblings `session_kill_incomplete`, `stop_all_completed`): open set, nothing to extend. Document it in `docs/architecture/session-control.md`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `console-control.test.ts`: stop ends `stopped` with `owner_stop` | in `manager.ts`, write `{ reason: "stop_requested" }` for `mode: "stop"` too |
| `console-control.test.ts` / `sessions-stop-all.test.ts`: kill skips the grace (the fake leader never exits on EOF, with a large `stopGraceMs`, and the kill must finish well before it) | in `manager.ts`, remove the `mode === "kill"` bypass so kill also awaits `#waitFor(attempt.exited, this.#stopGraceMs)` |
| `console-control.test.ts`: kill also kills the recorded tool group | in `manager.ts`'s kill path, skip `#killRecordedGroups` (reviewer-applied) |
| `console-control.test.ts`: an unconfirmable kill ends `failed`/`kill_incomplete`, with `kill_incomplete_at` set | in `manager.ts`'s kill path, call `#finish` instead of `#finishAfterKill` |
| `console-control.test.ts`: `409 not_running` for a completed session | in `control.ts`, drop the terminal-row check, so the route answers 200 with the terminal status |
| `console-control.test.ts`: `404` for an unknown id | in `control.ts`, map `not_found` to 409 |
| `console-control.test.ts`: one `session_stop_requested {by: "owner", mode}` per accepted request, none on a refusal | in `control.ts`, record the event before the 404/409 checks |
| `console-control.test.ts`: kill runs behind an in-flight `stop-all` | in `control.ts`, call the stop directly instead of through `req.serialized` |
| `console-control.test.ts`: `503 sessions_unavailable` without a manager | in `control.ts`, use `req.sessions!` without the undefined check (the call throws, 500) |
| `sessions-stop-all.test.ts`: a kill during a stop's grace does not wait it out | in `manager.ts`, have `#stopLive` return the in-flight `stopPromise` without signalling "kill now" |
| `feature-seams.test.ts`: the route request carries `serialized` | in `server.ts`, drop `serialized` from the object passed to `match.route.handler(…)` |
| `cli.test.ts`: `studio session kill 5` with no terminal and no `--yes` exits 2 | in `cli/index.ts`, remove `kill` from the `!command.yes && !isInteractive` refusal |
| `feature-seams.test.ts`: the exact request keys include `"serialized"` after `"killSwitch"` | in `server.ts`, move `serialized` after `...managed` in the handler call (the key order changes) |
| `console-foundation.test.ts`: the control part carries exactly the two routes, and `events`/`pause`/`threads` stay empty | in `control.ts`, drop the `/kill` route from `controlPart.routes` |
| `console-control.test.ts`: both item-04 contract routes are served with the same method and path | flip `"POST"` → `"PUT"` on the `/sessions/:id/kill` route in `control.ts` (reviewer-applied) |
| `console-control.test.ts`: the 200 body's keys are exactly `id`, `status`, `reason` | in `control.ts`, add `mode` to the 200 body |
| `console-control.test.ts`: `400 invalid_id` for a non-positive-integer `:id` (`0`, `-1`, `abc`, `1.5`) | in `control.ts`, drop the `id < 1` half of the id check |
| `console-control.test.ts`: `409 not_running` with the row's status for a non-terminal row this manager does not run (`SessionError("not_live")`) | in `control.ts`, rethrow a `not_live` `SessionError` instead of mapping it to 409 (it answers 500) |
| `console-control.test.ts`: a session that ended on its own before the stop is reported with its own reason | in `control.ts`, answer `reason: \`owner_${mode}\`` instead of reading the last `session_status` event |
| `cli.test.ts`: a 200 with status `failed` (`kill_incomplete`) exits 1 | in `cli/index.ts`, map a `failed` status to exit 0 |
| `cli.test.ts`: another terminal non-`failed` status exits 0, printed as is | in `cli/index.ts`, return 1 for any status other than `stopped` |
| `cli.test.ts`: a kill answered "no" at `[y/N]` sends nothing and exits 1 | in `cli/index.ts`, ignore the confirm result for `session-kill` |
| `cli.test.ts`: `studio session stop <id>` never asks, and `stop <id> --yes` is a usage error (exit 2) | in `cli/index.ts`, send `session stop` through the kill confirmation |
| `console-control.test.ts`: `session_stop_requested` is written with actor `kernel` and payload `{by: "owner", mode}` | in `control.ts`, drop `by` from the payload |
| `cli.test.ts`: both verbs use the stop-all timeout | in `cli/index.ts`, give `session stop`/`kill` `CLI_TIMEOUT_MS` (reviewer-applied) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Stop / Kill one session: manager mode, serialized console routes, CLI verbs, docs | 1, 2, 3, 4, 5, 6 (+ every derived check) | 10 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

**Subtask 1 design notes:**
- **Manager:** `stopSession(id, options = {})`. Keep the intent on the live entry, so a kill that arrives during an owner stop's grace flips it to kill and wakes the grace wait. Then the session's one terminal `session_status` carries the reason of the stop that actually killed it. (Pick `owner_kill` when the grace was cut short by a kill, and pin it.)
- **Routes (`control.ts`):** `controlPart` keeps the name `"control"`. Its two routes are `{method: "POST", path: "/sessions/:id/stop"}` and `{method: "POST", path: "/sessions/:id/kill"}`, both through `req.serialized`. Inside the queued function: validate the id → `req.sessions.getSession(id)` → 404 / 409 (terminal) → append `session_stop_requested` with `appendEvent(req.store, "session_stop_requested", { sessionId: id, taskId: <row's task_id> }, { by: "owner", mode }, req.now().toISOString())` from `../loop/internal.js` (the helper the `agents` feature uses; no console part appends events yet). That helper writes actor `kernel`, which is accepted: the payload's `by: "owner"` carries the attribution. `session-control.md` says so, and the test pins it. → `await req.sessions.stopSession(id, { mode })` (a `not_live` `SessionError` → 409 with the row's status) → read the last `session_status` payload's `reason` → `200 {id, status, reason}`. Phase 1's `PHASE1_ROUTES` reserves `/sessions/:id/abandon` only, and `/sessions/:id/stop` doesn't overlap it (a different literal segment). Confirm that by running `mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED)` in the test.
- **Tests:** `kernel/test/console-control.test.ts` (new) drives a real `SessionManager` over `session-fakes.ts` (`fakeSessions`, `startParams`, `stubProvider`, as `sessions-stop-all.test.ts`'s `setup()` does). It goes through a real `startApiServer({ …, sessionManager: manager, routes: merged.routes })` on port 0 for the HTTP status, serialization and 503 checks, and calls the route handler directly where that is simpler. "Groups are gone" is asserted with the fakes' `isGroupAlive`. "Flagged for the reaper" is asserted with `kill_incomplete_at` set on the row (or on `session_groups` for the tool group).
- **CLI:** new `Command` kinds `{kind: "session-stop", id}` and `{kind: "session-kill", id, yes}`. The kill confirmation reads like abandon's ("Kill session <id> now? Its process group and every tool group it started are killed at once, with no grace. [y/N] "). Output `studio: session <id> <status> (<reason>)`.
- **Docs:** fill `docs/architecture/session-control.md` (keep its link `../ARCHITECTURE.md#phase-5-features`). Replace its last paragraph's claim "so this part needs no change to the API server" with the `serialized` seam, and say why it exists. Document:
  - the routes, their answers and refusals;
  - the `session_stop_requested` event;
  - the manager modes (`stop_requested` stays the kill switch's reason);
  - the queue seam and its cost: a `POST /stop-all` sent after an owner Stop waits for that Stop, which takes up to about 6 s (grace + group-kill deadline + leader waits) plus each recorded tool group's kill deadline;
  - that a stop or kill whose client timed out still runs when its turn comes (unlike abandon, a contributed route can't see the client's socket);
  - the CLI verbs and their timeout;
  - the non-goal (a session this kernel did not start).

  Don't edit `docs/ARCHITECTURE.md` (lane L2 edits it in this wave). Keep every relative link resolving.

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "stopSession"}
  - {kind: "symbol", path: "kernel/src/console/control.ts", name: "controlPart"}
  - {kind: "type", path: "kernel/src/features/contribution.ts", name: "ContributedRouteRequest"}
  - {kind: "file", path: "kernel/test/console-control.test.ts"}
  - {kind: "file", path: "docs/architecture/session-control.md"}
requires: []
lanes:
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/console/control.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/cli/index.ts"
  - "kernel/test/console-control.test.ts"
  - "kernel/test/sessions-stop-all.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/cli.test.ts"
  - "kernel/test/console-foundation.test.ts"
  - "docs/architecture/session-control.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (single)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | wave-1 lane L1 (item 02) | `kernel/test/console-foundation.test.ts` (likely: filling `eventsPart` breaks the same emptiness pins; L1 has no saved brief yet, so this is unverified) | NO (separate PRs; the later one rebases) |
| Subtask 1 | wave-1 lane L2 (item 03) | `kernel/test/console-foundation.test.ts` (verified in L2's saved brief `lanes:`) | NO (separate PRs; the later one rebases) |
| Subtask 1 | wave-2 item 05 | `kernel/src/api/server.ts` | later wave, which rebases on this PR |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/api/server.ts` `serialized` | yes | HOLDS | `const serialized = <T>(fn: () => Promise<T>): Promise<T> => {`, local to `startApiServer`, used only by `stopAll`, `resume` and `abandon` | base 77be86d |
| `kernel/src/features/contribution.ts` `PHASE1_SUBCOMMANDS` | yes | HOLDS | `["status", "stop", "resume", "session", "service"]` | base 77be86d |
| `kernel/src/sessions/manager.ts` `#stop` grace | yes | HOLDS | `await this.#waitFor(attempt.exited, this.#stopGraceMs);` then `{ reason: "stop_requested" }` | base 77be86d |
| `kernel/test/console-control.test.ts` | no (to create) | the requirement lists it under Touches; it doesn't exist at base | — | base 77be86d |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): item 01's seam doesn't expose the POST queue. Extending `ContributedRouteRequest` + `server.ts` changes a shared contract that item 05 (wave 2) also edits | MEDIUM | This was the owner's decision. Additive and optional only. Item 05 rebases on this PR. The PR body names both out-of-Touches files and why. |
| Feasibility (Phase 2.5): the CLI must edit phase 1's `cli/index.ts`/`cli.test.ts` (outside Touches), because `session` is reserved and the console has no subcommands | LOW | No item in run 2 owns either file. Mirror `session abandon` exactly. The PR body says why. |
| A rebase conflict on `kernel/test/console-foundation.test.ts` with lanes L1/L2, which fill their own console parts in the same wave | MEDIUM | Assert per part by name and touch only the control part's lines and the merged-routes line (invariant). Whichever PR merges later rebases and keeps each item's truth. Never delete another item's pin. |
| The shared POST queue adds latency to the kill switch: a `POST /stop-all` sent after an owner Stop waits up to about 6 s, plus tool-group kill deadlines | MEDIUM | This is the trade-off the owner chose (serialization). The `serialized` doc comment restricts the queue to short, bounded session/kill-switch changes. `session-control.md` documents the latency. A test pins that a stop-all queued behind a Stop finishes once that Stop has (bounded by the fakes' deadlines). |
| A kill during an in-flight graceful stop waits the grace out, if the shared `stopPromise` is returned as is (so "Kill is immediate" is broken) | HIGH | A design note and a pinned test in `sessions-stop-all.test.ts`, plus a pin mutation. |
| A stop/kill CLI call times out at 5 s while a graceful stop (~6 s, longer when queued behind stop-all) is still running, telling the owner it failed when it succeeded | MEDIUM | Use `STOP_ALL_TIMEOUT_MS`, and on a timeout say "may or may not be stopped, run studio status" (an invariant plus a pin mutation). |
| Changing the default reason breaks the kill switch's `stop_requested` pins and playbook runs | MEDIUM | `stopSession(id)` with no options is unchanged (the existing pin). The new event is `session_stop_requested`, never the `stop_requested` event kind playbook runs read. |
| `control.ts` value-imports the session manager or the SDK and breaks the CLI module-graph pin | MEDIUM | Type-only imports, and `SessionError` matched by `code` (an invariant). `feature-seams.test.ts` catches it. |
| Untrusted data: a session id in the path is the only input, and no body is read | LOW | The id is validated as a positive safe integer before any lookup. Bodies are ignored. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-21-owner-stops-or-kills-one-session.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-21T12:00:36Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/103
- **Branch:** feature/owner-stops-or-kills-one-session
- **Files changed:** 11
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Owner Stop/Kill for one session: SessionManager.stopSession(id,{mode}) (owner_stop / owner_kill, a kill cuts an in-flight grace), the serialized seam on contributed routes, console POST /sessions/:id/stop|kill (only the acceptance runs on the POST queue; the stop is awaited off it), studio session stop|kill, and session-control.md. 3 heal iterations: e4498f4, 5b077c7 (root cause: acceptance-only queueing), b0f9976 (synchronous-acceptance pins). Review 3's only open item was a BLOCKING test gap that b0f9976 addresses, but no review has looked at b0f9976. The supervisor checked the full suite (1785 passed) and confirmed mutant N05 now fails the new tests.

## Not verified
- **docs/ARCHITECTURE.md (~137/139/191) and kernel/src/console/index.ts header + line 86** — stale restated claims (POST queue, CLI verbs, route controls, every part empty) in files another lane owns this wave; named in the PR body for the later PR (subtask 1)
- **real Claude CLI and real process groups** — no live SDK run; only the fake spawner and fake process table were exercised (subtask 1)
- **app consumer of POST /sessions/:id/stop|kill** — no app UI calls the routes yet (item 16) (subtask 1)
