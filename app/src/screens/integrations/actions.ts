// Integrations' calls to the kernel: one function per connector route, shared
// by each button and its ⌘K command so both always call the same route. Every
// call goes through the preload bridge (`window.api.request`): the main process
// holds the API token and posts the body, so the renderer never makes a
// network call of its own.
//
// `GET /connectors` is read here, not through Team's `fetchConnectors`, because
// that one folds the bridge's "kernel unreachable" answer into a message and
// this screen must tell it from a refusal (an unreachable kernel is never "not
// connected"). The wording of the failure is still Team's `outcomeOf`.
//
// The pasted token appears in this module once: as the `body` of
// `connectGithub`'s request. It is never logged, stored or put in an error.
import type { ApiRequest, ApiResult, ConnectorChangeResponse, ConnectorReposResponse, ConnectorsResponse, StudioBridge } from "../../api/contract";
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

/** `GET /connectors`: every connector row, none when nothing is connected. */
export function readConnectors(api: StudioBridge): Promise<Reply<ConnectorsResponse>> {
  return send<ConnectorsResponse>(api, { method: "GET", path: "/connectors" });
}

/**
 * `POST /connectors/github/token`: the token the owner pasted, to the kernel by
 * way of the main process, with the owner's declaration that every permission they
 * gave it is Read (the sheet sends only once the box is ticked). The answer is the row
 * after the change, never the token.
 */
export function connectGithub(api: StudioBridge, token: string): Promise<Reply<ConnectorChangeResponse>> {
  return send<ConnectorChangeResponse>(api, { method: "POST", path: "/connectors/github/token", body: { token, declared_read_only: true } });
}

/** `POST /connectors/github/disconnect`: deletes the Keychain item; the row reads `disconnected`. */
export function disconnectGithub(api: StudioBridge): Promise<Reply<ConnectorChangeResponse>> {
  return send<ConnectorChangeResponse>(api, { method: "POST", path: "/connectors/github/disconnect" });
}

/** `GET /connectors/github/repos`: the repos the token reaches; `refresh` re-reads them from GitHub first (`?refresh=1`). */
export function fetchRepos(api: StudioBridge, refresh: boolean): Promise<Reply<ConnectorReposResponse>> {
  const request: ApiRequest = refresh
    ? { method: "GET", path: "/connectors/github/repos", query: { refresh: "1" } }
    : { method: "GET", path: "/connectors/github/repos" };
  return send<ConnectorReposResponse>(api, request);
}
