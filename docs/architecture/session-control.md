# Session control

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 04** (the owner stops or kills one session from the app), in the console's `control.ts` part (`kernel/src/console/control.ts`): Stop is graceful and Kill is immediate, and neither engages the kill switch. The other sessions keep running.

**Routes:** `POST /sessions/:id/stop` and `POST /sessions/:id/kill`. **CLI:** `studio session stop <id>` and `studio session kill <id> [--yes]`.

**Contract types it fills** (`app/src/api/contract.ts`): `SessionControlResponse`.

It is a mechanism (invariant 1): the kernel's session manager does the stopping, and the kernel, not the agent, owns the session's lifecycle (invariant 2). The kill switch (`POST /stop-all`, `studio stop --all`) is unchanged: it is still the immediate stop and kill of everything.

## The two modes

Both go through `SessionManager.stopSession(id, {mode})`, the same entry guards and the same kill sequence as every stop.

| Mode | What happens | Ends |
|---|---|---|
| `stop` (graceful) | Today's stop: the session's input is closed (stdin EOF), the kernel waits out the grace (`stopGraceMs`, default about 2 s) for the CLI to exit, then walks the CLI's descendants once more for tool groups and kills the CLI's process group and every recorded tool group until gone, each tool group after its ownership check (H08). | `stopped`, reason `owner_stop` |
| `kill` (immediate) | The same sequence with no grace: the input is still closed, the last walk, the group kills, the wait for the killed leader's exit and the query close all run, but nothing waits for the CLI to exit on its own. | `stopped`, reason `owner_kill` |

As with any kill, a group the kernel can't confirm gone (the CLI's or a recorded tool group) ends the session `failed` with reason `kill_incomplete` and `cause: {to: "stopped", reason: "owner_stop" | "owner_kill"}`. The kill flags it for the reaper (`sessions.kill_incomplete_at`, or `session_groups.kill_incomplete_at` for a tool group), so every later `reapOrphans` retries it and `GET /status` lists it under `kill_unconfirmed` until then.

A kill that arrives while a stop of the same session is waiting out its grace doesn't wait the grace out: it ends that wait at once and joins the stop already in flight, so there is still one stop and one terminal status, and that status carries `owner_kill` (a kernel shutdown in flight keeps `kernel_shutdown`). A kill that arrives after the grace, while the stop is already killing the groups, only joins it: the session ends with that stop's reason (`owner_stop` for an owner's Stop). Any other second request joins the stop in flight as it is, without cutting its grace. Through the routes this holds for the owner's own Stop too: see [Kill during the owner's Stop](#kill-during-the-owners-stop).

`stopSession(id)` with no mode is unchanged: it is the kill switch's and `kernel_request_stop`'s call, and still ends `stopped` with reason `stop_requested`. The `stop_requested` **event kind** is a different thing (the session asked to stop itself, read by playbook runs), and these routes never write it.

## The routes

Each route answers JSON:

| Answer | When |
|---|---|
| `200 {id, status, reason}` | The stop ran. `status` is the session's status now, and `reason` is the reason of its last `session_status` event, whatever it is: `owner_stop`, `owner_kill`, or `kill_incomplete` (status `failed`). A session whose stream had already ended before the stop (its group still being cleaned up) keeps its own outcome, for example `completed` / `result_success`, with `stop_requested_after_end: true` in its event, and the route reports that as it is. |
| `400 {error: "invalid_id"}` | `:id` is not a positive integer written in digits. |
| `404 {error: "not_found"}` | No such session. |
| `409 {error: "not_running", status}` | The session had already ended (`status` is its terminal status), or it hasn't ended but this kernel doesn't run it (`not_live`, for example a row a previous kernel left `interrupted` or `orphaned`; `status` is the row's). Stopping a session this kernel did not start is a non-goal: the reaper and `studio session abandon` own those rows. |
| `503 {error: "sessions_unavailable"}` | A composition with no session manager or no POST queue on the request. The route never throws for this. |

Any other failure is rethrown, so the API answers `500 {error: "internal_error"}` and records a `route_failed` event naming the `console` contributor. A request body is ignored.

### The `session_stop_requested` event

Each accepted request records exactly one `session_stop_requested` event before the stop begins, with the session's id and task, payload `{by: "owner", mode: "stop" | "kill"}`. The route writes it through the kernel's store helper, so its `actor` is `kernel`; `by: "owner"` in the payload carries who asked. "Accepted" means the session manager's entry guards accepted the stop: the event is written from `StopSessionOptions.onAccepted`, synchronously inside the guards, so a 400, 404, 409 or 503 records none, and a request that joins a stop already in flight records its own. If writing it fails, nothing is stopped and the route answers 500.

## The POST queue seam

The routes are serialized with the other POSTs, as `POST /stop-all` is: their acceptance goes through the request's `serialized`, the API server's one POST queue, which phase 1's `POST /stop-all`, `POST /resume` and `POST /sessions/:id/abandon` also use. Only the acceptance runs on the queue: the id and row checks, the `session_stop_requested` event, and the `stopSession` call, which accepts the stop and starts it (or joins the one in flight) synchronously, before it returns. The stop itself (the grace, the group kills, the leader waits) is awaited after the queued work has returned, so no request holds the queue for a grace or a kill deadline. So a `POST /sessions/:id/kill` sent while a stop-all is still running starts only after it, and a `POST /stop-all` sent during an owner's Stop answers once that Stop has ended: the stop-all runs as soon as the Stop is accepted, and its `stopSession(id)` of that session joins the Stop in flight and waits for its end.

Item 01's route seam gave a contributed route `sessions` (the session manager) and a read-only `killSwitch`, but not the queue: a contributed route's handler was called directly, outside it. The owner chose (2026-10-21) to extend the seam with an optional `ContributedRouteRequest.serialized` rather than drop the serialization, and the API server passes it on every contributed request (`kernel/src/features/contribution.ts`, `kernel/src/api/server.ts`). It is the same queue, never a second one, and a route that doesn't use it behaves as before. Only a route that makes a short, bounded change to session or kill-switch state runs that change through it, and never a wait for a grace or a deadline.

### Kill during the owner's Stop

The owner's Stop is on the queue only while it is accepted, so a Kill of the same session sent during its grace runs right after, even when other requests are queued in between (for example the owner's Stop of another session, then a Stop of this one). It finds the Stop in flight and joins it as `stopSession(id, {mode: "kill"})` does: the grace wait ends at once and the stop kills the groups. There's still one stop and one terminal status, `stopped` with `owner_kill` (or `failed`/`kill_incomplete`).

- **What it answers:** both requests answer `200` with the same shared outcome, `{id, status: "stopped", reason: "owner_kill"}`. The Stop's answer carries `owner_kill` too, because the kill is what ended the session. If the Stop was already past its grace (it is killing the groups), the kill only joins it, and both answer the Stop's `owner_stop`.
- **Events:** each request was accepted, so each records its own `session_stop_requested`: `{mode: "stop"}`, then `{mode: "kill"}`, both before the terminal status.
- **Other requests:** a second Stop sent during the owner's Stop joins it as well (it records its own event, does not cut the grace, and answers the shared outcome). A kill sent during a stop-all still starts only after the stop-all, and a stop or kill sent after the session ended is refused `409 not_running`. The kill switch, and `stopSession(id)` with no mode, are unchanged.

**The cost:** whatever is queued delays the kill switch, and what these routes queue is only their acceptance: a few store reads, one event write and the synchronous start of the stop, with no wait. A `POST /stop-all` sent during an owner's Stop therefore engages the switch and starts stopping every other session at once. Its answer still waits for that Stop to end (it joins it), which is at most about 6 s after the Stop started (the 2 s grace, the 2 s group-kill deadline and the leader-exit waits of up to 1 s each), plus each recorded tool group's own kill deadline; the stop-all's own graceful stops of the other sessions take as long. A Kill skips the grace, and a Kill sent during that Stop cuts its grace short.

A stop or kill whose client gave up (a CLI timeout) still runs: if it was still queued, it is accepted when its turn comes, and an accepted stop runs to its end. Unlike phase 1's abandon, which checks its socket right before it runs, a contributed route can't see the client's socket. That is safe here: stopping a session is what the owner asked for, and `studio status` shows the result.

## The CLI verbs

`studio session stop <id>` and `studio session kill <id> [--yes]` extend phase 1's parser beside `session abandon` (`session` is a phase 1 command word, so it can't be a contributed subcommand). Both read `api.json`, check its pid is alive, and only then read the Keychain token and send the matching POST.

- `stop` never asks and takes no `--yes`.
- `kill` asks `Kill session <id> now? Its process group and every tool group it started are killed at once, with no grace. [y/N]` after the pid check and before the token is read. A no (or stdin ending) sends nothing, exit 1. `--yes` skips the question; with no terminal and no `--yes` it refuses at once with usage, exit 2.
- On a 200 it prints `studio: session <id> <status> (<reason>)` and exits 0 for `stopped` or any other ended status but `failed` (a session that completed on its own is printed as it is), and 1 for `failed` (`kill_incomplete`: a group may still be alive).
- A 400, 404 or 409 prints one line naming the API's error code, exit 1.
- Both verbs wait `STOP_ALL_TIMEOUT_MS`, not the 5 s `CLI_TIMEOUT_MS`: a graceful stop can take longer than 5 s, and either can queue behind a stop-all. A timeout, or a connection lost after connecting, says the session may or may not be stopped and to run `studio status`, exit 1.
