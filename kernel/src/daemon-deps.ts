// The shipped daemon's side effects (`KernelDeps`), kept out of daemon.ts so
// they can be tested: daemon.ts starts the kernel as soon as it is imported.
//
// Two dependencies the daemon wires itself:
//   - the real GitHub client, so a due poll and a poll playbook's dry run on the
//     installed service list through the credential the connector stored in the
//     Keychain: the token's PAT, or else the GitHub App's installation token (the
//     method is resolved on each call, `createResolvingGitHubClient`);
//   - the session token minter (D39), so a live, write-granted playbook session
//     gets its down-scoped GitHub token: `mintSessionToken` over the kernel's own
//     store, answered in the shape the session manager's port expects.
// Every other dependency keeps `startKernel`'s default. A composition that is not
// the shipped daemon (the tests) passes its own client and minter, or none.
import { createGitHubAppTokens } from "./integrations/github/app-token.js";
import { mintSessionToken } from "./integrations/github/app-port.js";
import type { GitHubAppPortDeps, GitHubSessionTokenError, GitHubSessionTokenResult } from "./integrations/github/app-port.js";
import type { GitHubClientDeps } from "./integrations/github/client.js";
import { createResolvingGitHubClient } from "./integrations/github/connector.js";
import type { KernelDeps } from "./kernel.js";
import type { SessionTokenMint, SessionTokenMintResult } from "./sessions/github-session-auth.js";
import type { Store } from "./store/store.js";

/**
 * The short, fixed text of each way a mint can fail: what the refusal's `detail`
 * carries beside the code (`mint_failed: <code>: <text>`). Each is at most 120
 * characters, so the detail with an HTTP status stays under the session auth's
 * 200-character cut. A `Record` over the whole code set, so adding a code without
 * a text fails the type check.
 */
const MINT_FAILURE_TEXTS: Readonly<Record<GitHubSessionTokenError, string>> = Object.freeze({
  repo_not_reached: "a repo the playbook names is not one the GitHub App's installation reaches",
  needs_permissions: "the GitHub App's installation does not report every permission a session token needs, at write",
  no_credentials: "no GitHub App is connected and in use, or its credentials are missing from the Keychain",
  keychain_failed: "the Keychain could not be read for the GitHub App's credentials",
  bad_key: "the stored GitHub App key could not be used to sign a request",
  unreachable: "GitHub could not be reached, or answered something unreadable",
  rate_limited: "GitHub rate-limited the token request",
  http_error: "GitHub refused the token request",
  scope_exceeded: "GitHub issued a token with more permissions than a session may hold, so it was dropped",
});

/**
 * `mintSessionToken`'s answer in the session manager's port shape. A failure's
 * `message` is its code's fixed text, then ` (HTTP <status>)` when GitHub gave a
 * status; it is built from the code and the status only, never from the token or
 * from any caught error, so it cannot carry a secret.
 */
export function toSessionTokenMintResult(res: GitHubSessionTokenResult): SessionTokenMintResult {
  if (res.ok) return { ok: true, token: res.token, expires_at: res.expires_at };
  const suffix =
    res.status === undefined
      ? ""
      : ` (HTTP ${res.status})`;
  return { ok: false, error: res.error, message: `${MINT_FAILURE_TEXTS[res.error]}${suffix}` };
}

/** The session minter over `store`: each call asks `mintSessionToken` for a token down-scoped to `repos`. Reads and requests nothing until called. */
export function daemonSessionTokenMint(store: Store, appDeps: GitHubAppPortDeps): SessionTokenMint {
  return (repos) => mintSessionToken(store, repos, appDeps).then(toSessionTokenMintResult);
}

/**
 * What the mint reads: with a Keychain or `fetch` injected, a holder of its own over
 * them (the process-wide one reads the real Keychain, which an injected one never
 * meant); with neither, `{}` so `mintSessionToken` uses the process-wide holder.
 * The holder reads the Keychain and sends a request only when a mint is called.
 */
function appDepsOf(clientDeps: GitHubClientDeps): GitHubAppPortDeps {
  if (clientDeps.keychain === undefined && clientDeps.fetch === undefined) return {};
  return {
    tokens: createGitHubAppTokens({
      ...(clientDeps.keychain !== undefined ? { keychain: clientDeps.keychain } : {}),
      ...(clientDeps.fetch !== undefined ? { fetch: clientDeps.fetch } : {}),
      ...(clientDeps.timeoutMs !== undefined ? { timeoutMs: clientDeps.timeoutMs } : {}),
      ...(clientDeps.maxBodyBytes !== undefined ? { maxBodyBytes: clientDeps.maxBodyBytes } : {}),
      ...(clientDeps.now !== undefined ? { now: clientDeps.now } : {}),
    }),
  };
}

/** What daemon.ts passes to `startKernel`. Builds the client and the minter factory only: no Keychain read and no request until a poll runs or a session asks for a token. */
export function daemonKernelDeps(clientDeps: GitHubClientDeps = {}): KernelDeps {
  const appDeps = appDepsOf(clientDeps);
  return {
    githubClient: createResolvingGitHubClient(clientDeps),
    sessionTokenMintFor: (store) => daemonSessionTokenMint(store, appDeps),
  };
}
