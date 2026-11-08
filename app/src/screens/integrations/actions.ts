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
import type {
  AgentDetailResponse,
  ApiRequest,
  ApiResult,
  ConnectorChangeResponse,
  ConnectorReposResponse,
  ConnectorsResponse,
  GitHubAppSetupCancelResponse,
  GitHubAppSetupResponse,
  GitHubAppUpgradeResponse,
  McpConnectResponse,
  McpConnectionKind,
  RepoPoliciesResponse,
  RepoPolicy,
  RepoPolicySetBody,
  StudioBridge,
} from "../../api/contract";
import { type Reply, replyOf, splitRepo } from "./model";

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

/**
 * `POST /connectors/github/app/setup`: opens the one setup window. The answer is
 * the loopback `setup_url` to open in the system browser and when the window closes.
 */
export function startAppSetup(api: StudioBridge): Promise<Reply<GitHubAppSetupResponse>> {
  return send<GitHubAppSetupResponse>(api, { method: "POST", path: "/connectors/github/app/setup" });
}

/** `POST /connectors/github/app/setup/cancel`: closes the open setup window, if any. */
export function cancelAppSetup(api: StudioBridge): Promise<Reply<GitHubAppSetupCancelResponse>> {
  return send<GitHubAppSetupCancelResponse>(api, { method: "POST", path: "/connectors/github/app/setup/cancel" });
}

// ---- Phase 8: the MCP connectors, the App upgrade and the repo policy -------------------------------

/**
 * `POST /connectors/mcp/:kind/connect`: opens the one setup window. The answer is the vendor's `authorize_url` to open
 * in the system browser, and when the window closes. The browser's return lands on the kernel's own loopback listener.
 */
export function connectMcp(api: StudioBridge, kind: McpConnectionKind): Promise<Reply<McpConnectResponse>> {
  return send<McpConnectResponse>(api, { method: "POST", path: "/connectors/mcp/:kind/connect", params: { kind } });
}

/** `POST /connectors/mcp/:kind/connect/cancel`: closes the open window, if it is this kind's. */
export function cancelMcp(api: StudioBridge, kind: McpConnectionKind): Promise<Reply<GitHubAppSetupCancelResponse>> {
  return send<GitHubAppSetupCancelResponse>(api, { method: "POST", path: "/connectors/mcp/:kind/connect/cancel", params: { kind } });
}

/** `POST /connectors/mcp/:kind/disconnect`: deletes the Keychain item and drops the grants; the row reads `disconnected`. */
export function disconnectMcp(api: StudioBridge, kind: McpConnectionKind): Promise<Reply<ConnectorChangeResponse>> {
  return send<ConnectorChangeResponse>(api, { method: "POST", path: "/connectors/mcp/:kind/disconnect", params: { kind } });
}

/** `GET /connectors/github/app/upgrade`: where the owner accepts the App's new permissions. The address is the kernel's, never built here. */
export function readUpgrade(api: StudioBridge): Promise<Reply<GitHubAppUpgradeResponse>> {
  return send<GitHubAppUpgradeResponse>(api, { method: "GET", path: "/connectors/github/app/upgrade" });
}

/** `GET /agents/:id`: a crew member's settings, for the tools it is granted. Never called for Wright, which has no detail route. */
export function readAgent(api: StudioBridge, id: string): Promise<Reply<AgentDetailResponse>> {
  return send<AgentDetailResponse>(api, { method: "GET", path: "/agents/:id", params: { id } });
}

/** `GET /repos/policy`: every reached repo with its detection, proposal and set policy. */
export function readRepoPolicies(api: StudioBridge): Promise<Reply<RepoPoliciesResponse>> {
  return send<RepoPoliciesResponse>(api, { method: "GET", path: "/repos/policy" });
}

const NOT_A_REPO: Reply<never> = { kind: "failed", message: "This repo's name is not one Studio can send." };

/** `POST /repos/policy/:owner/:repo/detect`: reads the repo's protection from GitHub again. Studio never changes branch protection. */
export async function detectRepoPolicy(api: StudioBridge, repo: string): Promise<Reply<RepoPolicy>> {
  const parts = splitRepo(repo);
  if (parts === undefined) return NOT_A_REPO;
  return send<RepoPolicy>(api, { method: "POST", path: "/repos/policy/:owner/:repo/detect", params: { owner: parts.owner, repo: parts.name } });
}

/** `POST /repos/policy/:owner/:repo`: sets the repo's merge policy. The owner's call: the card sends it only from a press. */
export async function setRepoPolicy(api: StudioBridge, repo: string, body: RepoPolicySetBody): Promise<Reply<RepoPolicy>> {
  const parts = splitRepo(repo);
  if (parts === undefined) return NOT_A_REPO;
  return send<RepoPolicy>(api, { method: "POST", path: "/repos/policy/:owner/:repo", params: { owner: parts.owner, repo: parts.name }, body });
}

/**
 * Opens `url` in the system browser through the main process's allowlisted
 * channel. `false` for everything that is not a clear yes: the channel refusing
 * the address, the bridge lacking the method, or the IPC call failing. The
 * window itself never navigates.
 */
export async function openExternalUrl(api: StudioBridge, url: string): Promise<boolean> {
  if (api.openExternal === undefined) return false;
  try {
    return (await api.openExternal(url)) === true;
  } catch {
    return false;
  }
}
