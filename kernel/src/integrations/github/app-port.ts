// The GitHub App connect's port (D36), stubbed: the contract wave 2 builds
// against. The kernel tokens item fills it in (storing the converted app and its
// `pem` in the Keychain, recording the installation, minting and renewing the
// installation token); until then every method resolves `not_implemented`.
// Never throws or rejects, whatever it is given.
//
// The `studio` CLI loads it, so it imports only types: never the Agent SDK, the
// session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import type { GitHubAppPort, GitHubAppPortResult } from "../types.js";

/** The one failure the stub answers. */
function notImplemented(what: string): Promise<GitHubAppPortResult<never>> {
  return Promise.resolve({ ok: false, error: "not_implemented", message: `${what} is not implemented yet` });
}

/** The stub port: every method answers `not_implemented`, and its arguments are never read. */
export const githubAppPort: GitHubAppPort = Object.freeze({
  storeApp: () => notImplemented("storing a GitHub App"),
  recordInstallation: () => notImplemented("recording a GitHub App installation"),
  removeApp: () => notImplemented("removing a GitHub App"),
});
