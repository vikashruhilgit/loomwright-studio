// The console's pause part (phase 5 item 05): "pause all" pauses new work.
// While paused no trigger fires (`../triggers/store.ts` records each due
// instant `missed_paused`) and no session starts or resumes (the kernel's
// admission refuses `paused`, and the loop parks the event once), while
// running sessions finish their turn: nothing here stops a session or the
// loop. The state is derived from the append-only `events` log, exactly as
// the kill switch's is (`../api/kill-switch.ts`), never held in memory, so no
// restart releases it. `POST /unpause` (here) and `POST /resume` (phase 1's,
// in `../api/server.ts`) release it. Mechanism only (invariant 1), and owner
// only (invariant 3): no tool, handler or due work can pause or release.
//
// The `studio` CLI loads this module through the feature registry, so its only
// value imports are `./types.js` and the store helper `../loop/internal.js`
// (which itself imports only a type), as `control.ts`'s
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type {
  CliApiClient,
  CliSubcommandOutput,
  ContributedRoute,
  ContributedRouteRequest,
  ContributedRouteResponse,
  ContributedSubcommand,
} from "../features/contribution.js";
import { NO_REF, appendEvent } from "../loop/internal.js";
import type { Store } from "../store/store.js";
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

/** Appended by every `POST /pause` (payload `{by: "owner", via}`). */
export const PAUSE_ENGAGED = "pause_engaged";
/** Appended by a `POST /unpause` or `POST /resume` that found the kernel paused (payload `{by: "owner", via}`). */
export const PAUSE_RELEASED = "pause_released";

/** Who carried the owner's request: the `studio` CLI, or any other API caller (the app). */
export type PauseVia = "cli" | "api";

export interface PauseState {
  readonly paused: boolean;
  /** When the current pause began (its first `pause_engaged` since the last release), or `null`. */
  readonly since: string | null;
}

interface PauseEvent {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
}

/** Paused exactly when the latest of the two pause events is `pause_engaged`. */
export function pauseState(store: Store): PauseState {
  const latest = store
    .prepare<[string, string], PauseEvent>("SELECT id, at, kind FROM events WHERE kind IN (?, ?) ORDER BY id DESC LIMIT 1")
    .get(PAUSE_ENGAGED, PAUSE_RELEASED);
  if (latest === undefined || latest.kind !== PAUSE_ENGAGED) return { paused: false, since: null };
  const lastRelease =
    store
      .prepare<[string], number>("SELECT id FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1")
      .pluck()
      .get(PAUSE_RELEASED) ?? 0;
  const first = store
    .prepare<[string, number], string>("SELECT at FROM events WHERE kind = ? AND id > ? ORDER BY id LIMIT 1")
    .pluck()
    .get(PAUSE_ENGAGED, lastRelease);
  return { paused: true, since: first ?? latest.at };
}

export function isPaused(store: Store): boolean {
  return pauseState(store).paused;
}

/** Append `pause_engaged`. Pausing a paused kernel appends again: every call is audited. */
export function engagePause(store: Store, at: string, via: PauseVia): void {
  appendEvent(store, PAUSE_ENGAGED, NO_REF, { by: "owner", via }, at);
}

/**
 * Append `pause_released` and, in the same transaction, wake every queue row
 * the pause parked: each `pending` row whose latest `event_parked` has
 * `reason: "paused"` and whose `not_before` is later than `at` gets
 * `not_before = at`, so it runs on the next tick. Without the wake, a paused
 * refusal (`retryAt: null`) would wait out the loop's `DEFAULT_PARK_MS` after
 * the release. The caller checks the kernel is paused (a no-op release
 * appends nothing). Returns how many rows it woke.
 */
export function releasePause(store: Store, at: string, via: PauseVia): number {
  return store.transaction((): number => {
    appendEvent(store, PAUSE_RELEASED, NO_REF, { by: "owner", via }, at);
    return store
      .prepare<[string, string]>(
        `UPDATE event_queue SET not_before = ?
          WHERE status = 'pending' AND not_before IS NOT NULL AND not_before > ?
            AND (SELECT json_extract(e.payload_json, '$.reason') FROM events e
                  WHERE e.kind = 'event_parked' AND json_valid(e.payload_json) AND json_extract(e.payload_json, '$.queue_id') = event_queue.id
                  ORDER BY e.id DESC LIMIT 1) = 'paused'`,
      )
      .run(at, at).changes;
  });
}

/** `cli` when the request body says `{"via": "cli"}` (the `studio` verbs send it), else `api`. */
function viaOf(body: unknown): PauseVia {
  return typeof body === "object" && body !== null && (body as { via?: unknown }).via === "cli" ? "cli" : "api";
}

/**
 * `POST /pause` (`engage`) or `POST /unpause`, its change run on the API
 * server's POST queue (the request's `serialized`), so it never interleaves
 * with stop-all, resume, abandon, or a session's stop or kill. Answers
 * `200 {paused}` (the app contract's `PauseResponse`), or
 * `503 {error: "serialized_unavailable"}` when the request carries no queue.
 * A pause always appends `pause_engaged`; an unpause appends `pause_released`
 * (and wakes the parked work) only when the kernel is paused. Any other
 * throw is rethrown: the API answers 500 and records `route_failed`.
 */
async function pauseRoute(req: ContributedRouteRequest, engage: boolean): Promise<ContributedRouteResponse> {
  const serialized = req.serialized;
  if (serialized === undefined) return { status: 503, body: { error: "serialized_unavailable" } };
  const via = viaOf(req.body);
  return serialized(async (): Promise<ContributedRouteResponse> => {
    const at = req.now().toISOString();
    if (engage) engagePause(req.store, at, via);
    else if (isPaused(req.store)) releasePause(req.store, at, via);
    return { status: 200, body: { paused: engage } };
  });
}

/** An error code from an API answer, printed only when it is a plain code. */
function errorOf(body: unknown): string {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof error === "string" && /^[a-z0-9_]{1,64}$/.test(error) ? error : "unknown";
}

/** `studio pause` / `studio unpause`: one POST with `{via: "cli"}`, the state on stdout and 0, else the error on stderr and 1. */
function pauseCommand(name: "pause" | "unpause", path: "/pause" | "/unpause"): ContributedSubcommand {
  return Object.freeze({
    name,
    help: `studio ${name}`,
    async run(args: readonly string[], client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
      if (args.length > 0) {
        out.stderr.write(`usage: studio ${name}\n`);
        return 2;
      }
      const res = await client.request("POST", path, { via: "cli" });
      const paused = typeof res.body === "object" && res.body !== null ? (res.body as { paused?: unknown }).paused : undefined;
      if (res.status !== 200 || typeof paused !== "boolean") {
        out.stderr.write(`studio: kernel API answered ${res.status} to POST ${path}: ${errorOf(res.body)}\n`);
        return 1;
      }
      out.stdout.write(
        paused
          ? "paused: no trigger fires and no session starts or resumes; running sessions finish their turn (studio unpause releases it)\n"
          : "not paused: new work runs\n",
      );
      return 0;
    },
  });
}

/** `POST /pause` and `POST /unpause`, and the `studio pause` and `studio unpause` verbs; no tools, handlers or due work. */
export const pausePart: ConsolePart = Object.freeze({
  ...emptyConsolePart("pause"),
  routes: Object.freeze([
    { method: "POST", path: "/pause", handler: (req) => pauseRoute(req, true) },
    { method: "POST", path: "/unpause", handler: (req) => pauseRoute(req, false) },
  ] satisfies ContributedRoute[]),
  subcommands: Object.freeze([pauseCommand("pause", "/pause"), pauseCommand("unpause", "/unpause")]),
});
