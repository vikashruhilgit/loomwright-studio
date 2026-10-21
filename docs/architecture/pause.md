# Pause

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 05** (pause new work, without killing running sessions), in the console's `pause.ts` part (`kernel/src/console/pause.ts`). While paused, no trigger fires and no session starts or resumes. Sessions that are already running finish their turn. The state is durable in the events log, as the kill switch's is.

**Routes:** `POST /pause` and `POST /unpause`. `POST /resume` also releases a pause, and `GET /status` gains `paused`. **CLI:** `studio pause` and `studio unpause`.

**Contract types it fills** (`app/src/api/contract.ts`): `PauseResponse`, `StatusBody.paused` and `ResumeResponse`.

It is a mechanism (invariant 1), and only the owner controls it (invariant 3): no tool, handler or due work can pause or release. The pause is the menu bar's "Pause all" (owner decision 2026-10-20). The kill switch (`POST /stop-all`, `studio stop --all`) is unchanged: it is still the immediate stop and kill of everything. Pausing never calls it.

## The state

Two events in the append-only `events` log, each with payload `{by: "owner", via}` and actor `kernel`:

- `pause_engaged`: appended by every `POST /pause`, so every call is audited, even on a kernel that is already paused.
- `pause_released`: appended by a `POST /unpause` or `POST /resume` that finds the kernel paused. A release with nothing to release appends nothing.

The kernel is paused exactly when the latest of the two is `pause_engaged` (`pauseState` / `isPaused`, read the same way as `killSwitchState`). `since` is the first `pause_engaged` after the last release. Nothing holds it in memory, so a restart (launchd's KeepAlive, a crash, `kill -9`) never releases it: a new kernel over the same data dir is still paused.

`via` is `cli` when the request body is `{"via": "cli"}`, which `studio pause` and `studio unpause` send, and `api` otherwise. The app sends no body (the contract declares none), so its pauses record `api`. A release by `POST /resume` takes `via` from the `x-studio-client` header, as `POST /sessions/:id/abandon` does. `studio resume` sends it (`cli`), as `studio session abandon` does, so its releases record `cli`; the app's record `api`.

## The routes

| Route | Change | Answer |
|---|---|---|
| `POST /pause` | Appends `pause_engaged`. | `200 {paused: true}` |
| `POST /unpause` | When paused: appends `pause_released` and wakes the work the pause parked (see [Admission](#admission)). Otherwise nothing. | `200 {paused: false}` |

Both answer the contract's `PauseResponse`. Both run their change through the request's `serialized`, the API server's one POST queue, so a pause never interleaves with a stop-all, resume, abandon, or a session's stop or kill. A request with no queue (a composition that gives none) answers `503 {error: "serialized_unavailable"}` and records nothing. Any other failure is rethrown, so the API answers `500 {error: "internal_error"}` and records a `route_failed` event naming the `console` contributor. The change is a few store reads and one transaction, so it holds the queue only briefly.

`GET /status` has `paused: true | false`. It is always present on this kernel; the contract marks it optional for kernels from before item 05.

## The CLI

`studio pause` and `studio unpause` are the part's contributed subcommands. Each sends one `POST` with `{via: "cli"}`. On `200` it prints the state and exits 0. On any other answer it prints `studio: kernel API answered <status> to POST <path>: <error>` on stderr and exits 1, and with arguments it prints its usage and exits 2.

`studio status` prints a `paused:` line (`paused: no`, or `paused: YES, …` naming `studio unpause` and `studio resume`), and `studio status --json` has the field. A daemon from before item 05 sends no `paused`, so no line is printed.

`studio resume` reads `GET /status` just before its `POST /resume`, because the answer (`{engaged: false}`) doesn't say what was released. With a pause it prints `pause released: new work runs (the kill switch was already off)`, or, with the kill switch engaged too, `kill switch off and pause released: …`. Otherwise it prints `kill switch off: the event loop is running`, as before. The read is best effort: if it fails, the resume goes ahead and its own answer decides the exit code and any error line. A pause sent by another client between the two requests is released but not reported.

## What a pause does

### Triggers

The loop keeps running while paused (unlike the kill switch), so due triggers are still processed. A due instant that falls inside a pause window, from the first `pause_engaged` after a release to the next `pause_released` (still open while paused), is recorded and never fired. So is any instant processed while the kernel is paused, even one that came due just before the pause and hadn't been processed yet, so nothing fires during a pause. Each instant is counted for the kill switch first, then the pause, else it fires:

- If every due instant fell inside a kill-switch or pause window, the trigger gets `last_result = missed_kill_switch` when any fell inside a kill-switch window, else `missed_paused`, and one `trigger_missed` event (`reason: kill_switch` or `paused`, carrying `missed_paused` when non-zero). A `once` trigger is then spent. Nothing is posted and no message is queued.
- If some fell outside, it fires once, and `trigger_fired` also carries `missed_paused` (the count left unfired).

The instant's work step is done either way, so an instant recorded during a pause is never fired after the release. A `cron` trigger's next instant after the release fires as usual. The playbook-not-enabled check still comes first. The trigger rules are in [triggers](triggers.md#missed-fires).

### Admission

The kernel's admission check (`admissionFor` in `kernel/src/kernel.ts`, wired with `isPaused` over the kernel's store) refuses every session start and resume while paused, with reason `paused` and `retryAt: null`. It refuses before the budget is asked, so a paused refusal writes no `admission_refused` event and no `notify`. Every start and resume goes through it: the brain's start and its resume of an interrupted session, playbook runs, delegation, dry runs and the session manager's auto-resume retries.

`POST /ask` still answers `202` and queues the message, because the brain doesn't check the pause. Its message waits. When the loop delivers the event, the refusal parks it under the loop's usual rule: one `event_parked` (`reason: paused`), no second notify, and the brain message is `parked`. With no `retryAt`, the park lasts `DEFAULT_PARK_MS` (1 h).

The release wakes the parked work in the same transaction as `pause_released`: every `pending` queue row whose latest `event_parked` has `reason: paused` and whose `not_before` is later than the release gets `not_before` set to the release time, so it runs on the next tick. A row parked again for another reason since (for example `cap_parked`) keeps its later `not_before`.

**Long pauses:** a row parked by a pause is redelivered every `DEFAULT_PARK_MS` while the pause lasts and parked again, with another `event_parked` each hour and never a notify. A pause shorter than an hour parks each event once.

### Running sessions

Nothing in the pause path calls `stopSession`, `stopAll` or `loop.stop()`. A session whose stream is live finishes its turn and ends with its own outcome (for example `completed`), and no `session_stop_requested` is written.

An auto-resume retry (the session manager asking admission again before attempt 2 or later of a resume) is a new launch, so a pause refuses it. The session goes back to `interrupted` (`reason: admission_refused`, `refusal: paused`, `retry_at: null`) and stays resumable. It is never `failed`.

## Resume

`POST /resume` releases the kill switch when it is engaged (`kill_switch_released` and `loop.start()`, as before) and also releases the pause when paused (`pause_released` and the wake above), because the owner chose that resume clears it. It still answers `{engaged: false}` (`ResumeResponse`). With both engaged, one `POST /resume` releases both and `GET /status` then shows `kill_switch.engaged: false` and `paused: false`. With only a pause, it releases the pause.
