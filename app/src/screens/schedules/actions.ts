// Schedules' calls to the kernel: one function per route, shared by each control
// and its ⌘K command so both always call the same route. Every call goes through
// the preload bridge (`window.api.request`): the main process holds the API token,
// so the renderer never makes a network call of its own.
//
// An answer is a `Reply` (`./model.ts`): the bridge's "kernel unreachable" (status 0)
// stays apart from a refusal, because an unreachable kernel is never "nothing
// scheduled". A thrown IPC call is a `failed` reply, never an exception.
import type { ApiRequest, ApiResult, ScheduleResponse, StudioBridge, TriggerFiresResponse, TriggerToggleResponse } from "../../api/contract";
import { type Reply, replyOf } from "./model";

async function send<R>(api: StudioBridge, request: ApiRequest): Promise<Reply<R>> {
  let result: ApiResult<R> | undefined;
  try {
    result = await api.request<R>(request);
  } catch {
    // The IPC call itself failed (no answer from the main process): said as such, never swallowed.
    result = undefined;
  }
  return replyOf(result);
}

/** `GET /schedule`: the next fires of every enabled trigger and every pending wake-up, soonest first. */
export function readSchedule(api: StudioBridge): Promise<Reply<ScheduleResponse>> {
  return send<ScheduleResponse>(api, { method: "GET", path: "/schedule" });
}

/** `GET /triggers/:id/fires`: one page of a trigger's firing history, newest first; `before` is the cursor of the next older page. */
export function readFires(api: StudioBridge, triggerId: number, before?: string): Promise<Reply<TriggerFiresResponse>> {
  const request: ApiRequest =
    before === undefined
      ? { method: "GET", path: "/triggers/:id/fires", params: { id: triggerId } }
      : { method: "GET", path: "/triggers/:id/fires", params: { id: triggerId }, query: { before } };
  return send<TriggerFiresResponse>(api, request);
}

/**
 * `POST /triggers/:id/on` or `/off`, the owner's toggle. A past `once` trigger answers `409 needs_confirmation` until
 * the request carries `{"confirm": true}`; `confirm` is sent only after the owner said yes.
 */
export function setTriggerEnabled(api: StudioBridge, triggerId: number, enabled: boolean, confirm: boolean): Promise<Reply<TriggerToggleResponse>> {
  const request: ApiRequest = {
    method: "POST",
    path: enabled ? "/triggers/:id/on" : "/triggers/:id/off",
    params: { id: triggerId },
    ...(enabled && confirm ? { body: { confirm: true } } : {}),
  };
  return send<TriggerToggleResponse>(api, request);
}
