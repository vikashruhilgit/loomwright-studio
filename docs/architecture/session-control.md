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

A kill that arrives while a stop of the same session is waiting out its grace doesn't wait the grace out: it ends that wait at once and joins the stop already in flight, so there is still one stop and one terminal status, and that status carries `owner_kill` (a kernel shutdown in flight keeps `kernel_shutdown`). Any other second request joins the stop in flight as it is.

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

The routes run one at a time with the other POSTs, as `POST /stop-all` does: their work goes through the request's `serialized`, the API server's one POST queue, which phase 1's `POST /stop-all`, `POST /resume` and `POST /sessions/:id/abandon` also use. So a `POST /sessions/:id/kill` sent while a stop-all is still running starts only after it, and a `POST /stop-all` sent during an owner's Stop answers once that Stop has ended.

Item 01's route seam gave a contributed route `sessions` (the session manager) and a read-only `killSwitch`, but not the queue: a contributed route's handler was called directly, outside it. The owner chose (2026-10-21) to extend the seam with an optional `ContributedRouteRequest.serialized` rather than drop the serialization, and the API server passes it on every contributed request (`kernel/src/features/contribution.ts`, `kernel/src/api/server.ts`). It is the same queue, never a second one, and a route that doesn't use it behaves as before. Only a route that makes a short, bounded change to session or kill-switch state runs work through it.

**The cost:** whatever is queued delays the kill switch. A `POST /stop-all` sent after an owner's Stop waits for that Stop, which takes up to about 6 s (the 2 s grace, the 2 s group-kill deadline and the leader-exit waits of up to 1 s each), plus each recorded tool group's own kill deadline. A Kill skips the grace.

A stop or kill whose client gave up (a CLI timeout) still runs when its turn comes. Unlike phase 1's abandon, which checks its socket right before it runs, a contributed route can't see the client's socket. That is safe here: stopping a session is what the owner asked for, and `studio status` shows the result.

## The CLI verbs

`studio session stop <id>` and `studio session kill <id> [--yes]` extend phase 1's parser beside `session abandon` (`session` is a phase 1 command word, so it can't be a contributed subcommand). Both read `api.json`, check its pid is alive, and only then read the Keychain token and send the matching POST.

- `stop` never asks and takes no `--yes`.
- `kill` asks `Kill session <id> now? Its process group and every tool group it started are killed at once, with no grace. [y/N]` after the pid check and before the token is read. A no (or stdin ending) sends nothing, exit 1. `--yes` skips the question; with no terminal and no `--yes` it refuses at once with usage, exit 2.
- On a 200 it prints `studio: session <id> <status> (<reason>)` and exits 0 for `stopped` or any other ended status but `failed` (a session that completed on its own is printed as it is), and 1 for `failed` (`kill_incomplete`: a group may still be alive).
- A 400, 404 or 409 prints one line naming the API's error code, exit 1.
- Both verbs wait `STOP_ALL_TIMEOUT_MS`, not the 5 s `CLI_TIMEOUT_MS`: a graceful stop can take longer than 5 s, and either can queue behind a stop-all. A timeout, or a connection lost after connecting, says the session may or may not be stopped and to run `studio status`, exit 1.
