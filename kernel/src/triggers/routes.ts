// The owner's control over every trigger, on the loopback API (reached only
// with the bearer token): what `studio triggers` calls, and what the phase 7
// Schedules screen will reuse.
//
//   GET  /triggers[?all=1]       {triggers: [...]}: enabled ones; all=1 adds disabled ones
//   POST /triggers/:id/on        body {confirm?: true}
//   POST /triggers/:id/off
//
// A toggle is the owner's (`by: "owner"`), audited as `trigger_toggled`.
// Turning on a `once` trigger whose time has passed would fire it at once, so
// without `{"confirm": true}` it answers `409 {"error":"needs_confirmation"}`
// and changes nothing. Other refusals: `400 invalid_id` / `invalid_body`,
// `404 not_found`.
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { TriggerError, listTriggers, setTriggerEnabled } from "./store.js";

const ID = /^[1-9]\d*$/;

function idOf(req: ContributedRouteRequest): number | undefined {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  return ID.test(raw) && Number.isSafeInteger(id) ? id : undefined;
}

function toggle(enabled: boolean): (req: ContributedRouteRequest) => Promise<ContributedRouteResponse> {
  return async (req) => {
    const id = idOf(req);
    if (id === undefined) return { status: 400, body: { error: "invalid_id" } };
    const body = req.body;
    if (body !== undefined && (typeof body !== "object" || body === null || Array.isArray(body))) return { status: 400, body: { error: "invalid_body" } };
    const confirm = (body as { confirm?: unknown } | undefined)?.confirm === true;
    const now = req.now();
    try {
      const { trigger, changed } = setTriggerEnabled(req.store, { id, enabled, by: "owner", confirm }, now);
      return { status: 200, body: { trigger, changed } };
    } catch (err) {
      if (!(err instanceof TriggerError)) throw err;
      if (err.code === "not_found") return { status: 404, body: { error: "not_found" } };
      if (err.code === "needs_confirmation") return { status: 409, body: { error: "needs_confirmation", message: err.message, fires_at: now.toISOString() } };
      return { status: 409, body: { error: err.code, message: err.message } };
    }
  };
}

export const triggerRoutes: readonly ContributedRoute[] = Object.freeze([
  {
    method: "GET",
    path: "/triggers",
    handler: async (req) => ({ status: 200, body: { triggers: listTriggers(req.store, { all: req.query.all === "1" || req.query.all === "true" }) } }),
  },
  { method: "POST", path: "/triggers/:id/on", handler: toggle(true) },
  { method: "POST", path: "/triggers/:id/off", handler: toggle(false) },
]);
