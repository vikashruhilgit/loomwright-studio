// Team's calls to the kernel: one function per owner route, shared by each
// button and its ⌘K command so both always call the same route. Every call
// goes through the preload bridge (`ApiRequest`: `params` fill the path's
// `:segments`), never a hand-rolled fetch. A write's result reaches the cards
// through the live feed (`agent_*` events refetch `agents`), never through a
// local edit of the roster.
import type {
  AgentChangeResponse,
  AgentConnectorsSetBody,
  AgentCreateBody,
  AgentCreateResponse,
  AgentDetailResponse,
  AgentSetBody,
  AgentSetField,
  AgentSetResponse,
  ApiRequest,
  ApiResult,
  AskResponse,
  ConnectorsResponse,
  StudioBridge,
} from "../../api/contract";
import { type CallOutcome, outcomeOf } from "./model";

async function call<R>(api: StudioBridge, request: ApiRequest): Promise<CallOutcome<R>> {
  let result: ApiResult<R> | undefined;
  try {
    result = await api.request<R>(request);
  } catch {
    // The IPC call itself failed (no answer from the main process): said as such, never swallowed.
    result = undefined;
  }
  return outcomeOf(result);
}

/** `GET /agents/:id`: a crew member's settings, never list, workspaces, memory files and charter prose. Never called for Wright. */
export function fetchAgentDetail(api: StudioBridge, id: string): Promise<CallOutcome<AgentDetailResponse>> {
  return call<AgentDetailResponse>(api, { method: "GET", path: "/agents/:id", params: { id } });
}

/** `POST /agents`: the owner's create, with the charter as the form built it. */
export function createAgent(api: StudioBridge, charter: AgentCreateBody): Promise<CallOutcome<AgentCreateResponse>> {
  return call<AgentCreateResponse>(api, { method: "POST", path: "/agents", body: charter });
}

/** `POST /agents/:id/rename`. */
export function renameAgent(api: StudioBridge, id: string, displayName: string): Promise<CallOutcome<AgentChangeResponse>> {
  return call<AgentChangeResponse>(api, { method: "POST", path: "/agents/:id/rename", params: { id }, body: { display_name: displayName } });
}

/** `POST /agents/:id/set`: `{field, value}`, both strings, the value as typed (`none` clears effort or a limit). */
export function setAgentField(api: StudioBridge, id: string, field: AgentSetField, value: string): Promise<CallOutcome<AgentSetResponse>> {
  const body: AgentSetBody = { field, value };
  return call<AgentSetResponse>(api, { method: "POST", path: "/agents/:id/set", params: { id }, body });
}

/** `POST /agents/:id/set` with `{field: "connectors", value}`: `github` grants the connector, `none` removes the grant. The owner's route only; a session cannot set it. */
export function setAgentConnectors(api: StudioBridge, id: string, value: "github" | "none"): Promise<CallOutcome<AgentSetResponse>> {
  const body: AgentConnectorsSetBody = { field: "connectors", value };
  return call<AgentSetResponse>(api, { method: "POST", path: "/agents/:id/set", params: { id }, body });
}

/** `GET /connectors`: every connector row, none when nothing is connected. Read here, not a store resource. */
export function fetchConnectors(api: StudioBridge): Promise<CallOutcome<ConnectorsResponse>> {
  return call<ConnectorsResponse>(api, { method: "GET", path: "/connectors" });
}

/** `POST /agents/:id/off` or `/on`. */
export function turnAgent(api: StudioBridge, id: string, to: "on" | "off"): Promise<CallOutcome<AgentChangeResponse>> {
  return call<AgentChangeResponse>(api, { method: "POST", path: to === "on" ? "/agents/:id/on" : "/agents/:id/off", params: { id } });
}

/** `POST /ask` to Wright (no `agent`: Wright). */
export function askWright(api: StudioBridge, text: string): Promise<CallOutcome<AskResponse>> {
  return call<AskResponse>(api, { method: "POST", path: "/ask", body: { text } });
}
