// The shipped daemon's side effects (`KernelDeps`), kept out of daemon.ts so
// they can be tested: daemon.ts starts the kernel as soon as it is imported.
//
// The one dependency the daemon wires itself is the real GitHub client, so a
// due poll and a poll playbook's dry run on the installed service list
// through the credential the connector stored in the Keychain: the token's
// PAT, or else the GitHub App's installation token (the method is resolved on
// each call, `createResolvingGitHubClient`). Every other
// dependency keeps `startKernel`'s default. A composition that is not the
// shipped daemon (the tests) passes its own client, or none.
import type { GitHubClientDeps } from "./integrations/github/client.js";
import { createResolvingGitHubClient } from "./integrations/github/connector.js";
import type { KernelDeps } from "./kernel.js";

/** What daemon.ts passes to `startKernel`. Builds the client only: no Keychain read and no request until a poll runs. */
export function daemonKernelDeps(clientDeps: GitHubClientDeps = {}): KernelDeps {
  return { githubClient: createResolvingGitHubClient(clientDeps) };
}
