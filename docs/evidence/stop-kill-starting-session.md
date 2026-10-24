# Evidence: Stop and Kill on a `starting` session

The phase 5 live run of 2026-10-24 reported that Stop, then Kill, pressed on two `starting` Wright sessions (36 and 37) did nothing: no `session_stop_requested`, no error, and no change in the app. This page records what the worker probed before changing anything, what it found, and what it could not settle. The design that landed is in [session control: starting sessions](../architecture/session-control.md#starting-sessions).

**Result: the lost press was not reproduced, and its mechanism is not identified.** Each layer a press passes through records it, refuses it with text, or forwards it. Pressed through the app against a real in-process kernel, Stop and Kill on `starting` Wright sessions were both accepted, recorded and ended their sessions. The SDK spawns synchronously, so there is no pre-spawn window in production. The live store and the live harness summary hold nothing that identifies the press: no event, and no owner observation. What still landed is the requirement's guards (AC2–AC8), which make a lost press impossible in the kernel and silent refusals impossible in the app for every path probed below. That includes the orphan race a later SDK could open.

## 1. The SDK's spawn timing (`query()` and `spawnClaudeCodeProcess`)

**Run by the worker, 2026-10-24, macOS (Darwin 25.6.0), Node v24.11.1, `@anthropic-ai/claude-agent-sdk` 0.3.284** (the version pinned in `kernel/package.json`; `cd kernel && node -p "require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version"` printed `0.3.284`).

The probe calls the installed SDK's real `query()` with a stand-in `spawnClaudeCodeProcess` that only records when it is called and returns a fake child, so no CLI, model or network is used. It runs three option shapes: a streaming prompt, a string prompt, and the kernel's own shape (`plugins`, `hooks`, `includeHookEvents`, an in-process `mcpServers` entry from `createSdkMcpServer`, `abortController`, `sessionId`), as `SessionManager.#launch` builds it.

The script (`spawn-timing.mjs`, kept outside the repo):

```js
// Probe: does the installed SDK's query() call spawnClaudeCodeProcess synchronously?
// A stand-in spawner records the call; no real CLI, model or network is used.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
const kernelDir = process.argv[2];
const require = createRequire(kernelDir + "/package.json");
const sdkPath = require.resolve("@anthropic-ai/claude-agent-sdk");
const { query, createSdkMcpServer } = await import(sdkPath);
const { readFileSync } = await import("node:fs"); const version = JSON.parse(readFileSync(kernelDir + "/node_modules/@anthropic-ai/claude-agent-sdk/package.json", "utf8")).version;
const log = [];
const t0 = performance.now();
const at = () => (performance.now() - t0).toFixed(2) + "ms";
function fakeChild() {
  const c = new EventEmitter();
  c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough();
  c.pid = 2_000_000_001; c.killed = false; c.exitCode = null;
  c.kill = () => { c.killed = true; setImmediate(() => c.emit("exit", null, "SIGKILL")); return true; };
  return c;
}
async function* prompt() { yield { type: "user", message: { role: "user", content: "hi" }, parent_tool_use_id: null, session_id: "" }; await new Promise(() => {}); }
let mode = process.argv[3] ?? "streaming";
log.push(`sdk ${version} (${sdkPath}), node ${process.version}, prompt=${mode}`);
let spawned = false;
log.push(`${at()} before query()`);
const q = query({
  prompt: mode === "string" ? "hi" : prompt(),
  options: {
    model: "claude-haiku-4-5", settingSources: [], cwd: process.cwd(), env: { PATH: "/usr/bin" },
    ...(mode === "kernel-shape" ? {
      permissionMode: "default",
      plugins: [{ type: "local", path: process.cwd() }],
      includeHookEvents: true,
      hooks: { PreToolUse: [{ hooks: [async () => ({})] }] },
      mcpServers: { kernel: createSdkMcpServer({ name: "kernel", version: "0.0.0", tools: [] }) },
      abortController: new AbortController(),
      sessionId: "00000000-0000-4000-8000-000000000001",
    } : {}),
    spawnClaudeCodeProcess: (o) => { spawned = true; log.push(`${at()} spawnClaudeCodeProcess called (command=${o.command.split("/").pop()})`); return fakeChild(); },
  },
});
log.push(`${at()} query() returned; spawned synchronously = ${spawned}`);
await Promise.resolve();
log.push(`${at()} after one microtask; spawned = ${spawned}`);
await new Promise((r) => setImmediate(r));
log.push(`${at()} after one macrotask (setImmediate); spawned = ${spawned}`);
await new Promise((r) => setTimeout(r, 200));
log.push(`${at()} after 200 ms; spawned = ${spawned}`);
console.log(log.join("\n"));
try { q.close?.(); } catch {}
process.exit(0);
```

The commands, from a scratch directory (`<repo>` is this checkout):

```bash
node spawn-timing.mjs <repo>/kernel streaming
node spawn-timing.mjs <repo>/kernel string
node spawn-timing.mjs <repo>/kernel kernel-shape
```

The output (the SDK path shortened to `<repo>`):

```text
sdk 0.3.284 (<repo>/kernel/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs), node v24.11.1, prompt=streaming
0.01ms before query()
2.19ms spawnClaudeCodeProcess called (command=claude)
4.87ms query() returned; spawned synchronously = true
4.89ms after one microtask; spawned = true
5.19ms after one macrotask (setImmediate); spawned = true
206.11ms after 200 ms; spawned = true
---
sdk 0.3.284 (<repo>/kernel/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs), node v24.11.1, prompt=string
0.03ms before query()
4.48ms spawnClaudeCodeProcess called (command=claude)
6.86ms query() returned; spawned synchronously = true
6.88ms after one microtask; spawned = true
7.16ms after one macrotask (setImmediate); spawned = true
208.39ms after 200 ms; spawned = true
---
sdk 0.3.284 (<repo>/kernel/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs), node v24.11.1, prompt=kernel-shape
0.01ms before query()
5.52ms spawnClaudeCodeProcess called (command=claude)
7.16ms query() returned; spawned synchronously = true
7.18ms after one microtask; spawned = true
11.75ms after one macrotask (setImmediate); spawned = true
212.91ms after 200 ms; spawned = true
```

**Finding:** in all three shapes, `spawnClaudeCodeProcess` is called synchronously inside `query()`, before it returns. The kernel's spawner (`spawnInNewProcessGroup`, `kernel/src/sessions/spawner.ts`) calls `onSpawn(pgid)` synchronously after `spawn` returns. So `SessionManager.#launch` has the pgid on disk before `startSession` returns, and a stop can't land in a pre-spawn window with this SDK. The orphan race the requirement names (`#killAttemptGroup` returning at once for an undefined pgid) is therefore not what lost the live presses. It would only open if a later SDK spawned after `query()` returned. The guard for that landed anyway (section 5).

## 2. The reproduction, through the app against a real in-process kernel

`app/e2e/stop-kill-starting.spec.ts` walks the runbook's flow 4 ([phase 5 exit runbook](phase-5-exit-runbook.md#flow-4-stop-one-session-and-kill-another-sessions)) as the owner did it, in the `phase-5-exit.spec.ts` style:

- `startKernel` runs in the Playwright worker, with the shipped contributions, the brain's handler and the session fakes.
- The app is launched only through `launchApp` (`app/e2e/electron-harness.ts`).
- In Chat it asks Wright twice, so two Wright sessions start. Each stand-in CLI is held before `system/init`, so both stay `starting`, as real Wright sessions do for their first 20–40 s.
- It opens Sessions, selects the first and presses Stop, then selects the second and presses Kill and confirms.
- Every effect is read from the kernel's own store.

```bash
cd app && npm run build && npx playwright test e2e/stop-kill-starting.spec.ts --workers=1 --reporter=line
```

```text
Running 1 test using 1 worker
[1/1] e2e/stop-kill-starting.spec.ts:137:1 › flow 4 on starting sessions: Stop and Kill pressed in Sessions on two starting Wright sessions are each recorded and end them
  1 passed (12.6s)
```

The press is **not lost**:

- Both sessions are listed `starting`, and Stop and Kill are enabled on them (not `aria-disabled`).
- The Stop records one `session_stop_requested {by: "owner", mode: "stop"}` and the session's statuses are exactly `starting → stopped` (`owner_stop`).
- The Kill, after its confirm, records `{mode: "kill"}` and ends `starting → stopped` (`owner_kill`), with no grace.
- A `system/init` the stand-ins send afterwards moves neither session to `running`, and every stand-in group is gone.

The spec was run against the code at base `8626504`, before any change in this job, and passed. It still passes after the change.

## 3. The live store and the live harness summary (read only)

Both were read without writing: `sqlite3 "file:$HOME/.loomwright-studio/studio.db?mode=ro"`, and the summary JSON under `$TMPDIR`. Nothing was written to `~/.loomwright-studio`.

Sessions 36 and 37 (`SELECT … FROM sessions WHERE id BETWEEN 33 AND 46`, and their `session_status` events):

| Session | `starting` | `running` | Ended | Outcome |
|---|---|---|---|---|
| 36 | 05:58:35.252 | 05:59:01.191 (25.9 s later) | 05:59:45.171 | `completed` / `result_success` |
| 37 | 05:58:40.370 | 05:59:18.005 (37.6 s later) | 05:59:59.329 | `completed` / `result_success` |
| 41 | 06:01:17.982 | | 06:03:00.310 | `stopped` / `owner_stop` (request 06:02:53.532) |
| 44 | 06:05:17.058 | | 06:06:19.012 | `stopped` / `owner_kill` (request 06:06:15.283) |

Between 05:57:30 and 06:01:30 the store has no `session_stop_requested`, no `route_failed` and no `stop_*` event for any session. The only events for 36 and 37 are their status changes, their output, and their tool groups' records.

The harness summary (`studio-phase-5-exit-live-summary-1792817365164.json`) records the run at commit `1631cf18` with `run_by: null`. Flow 4's owner fields (`stop_pressed_in_sessions`, `kill_confirm_shown`, `kill_confirmed`) are all `null`, and the app was not running at the run's start (`process_seen_at_start: false`). Flow 4's harness requests list only the presses on 41 and 44. So nothing in the run records which row was selected, what the screen showed, or when the presses on 36 and 37 were made.

The 20–40 s spent in `starting` (25.9 s and 37.6 s here) is a requirement non-goal and is only recorded here.

## 4. Where a press could be lost, checked layer by layer

Each layer between the button and the store, at base `8626504`:

| Layer | What it does with a press on a `starting` session | Evidence |
|---|---|---|
| Sessions screen | `runsNow` treats `starting` as live (`LIVE_STATUSES` in `model.ts`), so Stop, ⌘. and Kill are enabled and send one request each. Any answer but a 200 sets `notice: refusalText(...)`, shown as `session-notice`. | Code read. Pinned by `SessionsScreen.test.tsx` "a starting session" and `sessions.spec.ts` "a starting session". |
| `StreamingLog` | Calls `onStop` / `onKillRequest` only while `live`, the same `runsNow`. | `app/src/components/StreamingLog/StreamingLog.tsx` (`if (live) onStop()`). |
| Bridge (`app/electron/kernel-connection.ts`) | Sends the POST with a 10 s timeout. A timeout or connection failure comes back as `connection` and the screen shows "Couldn't reach the kernel". | Code read (`REQUEST_TIMEOUT_MS`). |
| API server POST queue (`serialized`) | Used only by the control routes, pause, `stop-all`, `resume` and `abandon`. A Chat message never holds it. | `grep serialized kernel/src`: `api/server.ts`, `console/control.ts`, `console/pause.ts` only. |
| Control route (`kernel/src/console/control.ts`) | Records `session_stop_requested` from `onAccepted`. It answers 409 only for an ended row, or for a `not_live` row (no live entry). | Code read. |
| Session manager (`#stopLive`) | `not_live` only when `#live.get(id)` is undefined. `startSession` inserts the `starting` row and calls `#newLive` with no `await` between them. The brain starts Wright sessions through the same manager instance the routes stop through (`kernel/src/kernel.ts`: `sessions: manager` and `sessionManager: manager`). | Code read. Pinned by `console-control.test.ts` "stop on a starting session" and "kill on a starting session". |
| Installed kernel build (`~/.loomwright-studio/app/0.0.0/dist`) | Same guards and routes: `not_live` thrown only with no live entry, `onAccepted?.()` before `live.stopping = true`, both routes registered. | `grep` of `dist/sessions/manager.js` and `dist/console/control.js`. |
| App code at the live run's commit | The Sessions screen, `StreamingLog`, the bridge, the API client and the store are unchanged between `1631cf18` and `8626504`, apart from one trigger-card commit. `LIVE_STATUSES` was `["starting", "running"]` at `1631cf18`. | `git log 1631cf18..8626504 -- app/src/screens/sessions app/src/components/StreamingLog app/electron app/src/api app/src/store` lists only `d608abd`; `git show 1631cf18:app/src/screens/sessions/model.ts`. |

**What is left, unproven.** "No event and no text" fits only a press that never left the renderer. Every path that reaches the bridge either records the event or shows text. In this code a press sends nothing, and shows nothing, only when the screen thinks the selected session isn't live:

- `runsNow` is false (`SessionsScreen.tsx` `function runsNow`; `StreamingLog`'s `aria-disabled` and `if (live)` follow it), or
- a request for that session is already in flight (`inFlight.current`), or
- a dialog is open.

That would happen if the press went to a different selected row, or to a detail whose list read was stale. A press made after 36 or 37 had ended (05:59:45 / 05:59:59) would instead have answered 409 and shown the notice, which also records nothing by design. Nothing recorded in the live run can tell these apart, so the worker does not claim any of them. **To settle it on the rerun:** if a press appears to do nothing, note the selected row's id and the status word it shows, and fill flow 4's owner fields.

## 5. What landed (the guards, AC2–AC8)

The reproduction found no lost press to fix, so the change makes the requirement's guarantees explicit and pinned. Each guard below is a test that turns red under the brief's pin mutations.

- **Stop and Kill on `starting` take effect** (`kernel/test/console-control.test.ts`, "stop on a starting session" and "kill on a starting session"). The fake CLI sends `system/init` and an assistant message after the stop was accepted. The session stays `starting` (the `!live.stopping` guard in `#handleMessage`) and ends `stopped` with `owner_stop` / `owner_kill`. `SessionManager.#consumeStream` no longer records the CLI's messages as output while a stop is in flight on a `starting` session (`!(live.stopping && live.status === "starting")`). The budget still observes them.
- **The spawn race, both orders, no orphan** (`kernel/test/sessions.test.ts`, the `heldSpawn` cases):
  - `#spawnFor`'s `onSpawn` kills the group when `live.stopping` (`#killLateSpawn`, recording `session_spawn_after_stop`).
  - `#stop` with an undefined pgid races that kill against the attempt ending and `LEADER_EXIT_WAIT_MS`.
  - A spawn that never reports still ends `stopped` within the limit. One that reports after the end is killed and recorded.
  - `#spawnFor` also marks a child that exited synchronously during `onSpawn` (a fake spawner's kill) as exited.
- **The message is not retried** (`kernel/test/brain.test.ts`, "a Wright message whose session the owner stopped before it ran a turn"). The queue event is `done` after one attempt and the `start-session` step holds the session id, so no second session starts. The message ends `failed` with `session_stopped`. The line that settles it is `attachReply(store, row, handle, now)` in `kernel/src/brain/handler.ts`; deleting it turns the pin red.
- **The app shows every refusal** (`app/src/screens/sessions/SessionsScreen.test.tsx` and `app/e2e/sessions.spec.ts`, "a starting session"). Stop, ⌘. and Kill are enabled on a `starting` row. A 409 for an ended row, a 409 for a `not_live` row, a 500 and a bridge failure each show their text in `session-notice`.
