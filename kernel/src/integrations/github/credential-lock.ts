// The one queue every GitHub credential change runs on. The token connector
// (`connector.ts`: set, disconnect, refresh) and the App port (`app-port.ts`:
// store, installation, removal) change the same things: the PAT's Keychain
// item, the App's four items, the `connectors` row's `method`, `app_slug` and
// `installation_id`, and the installation-token holder. Each takes this lock
// for its whole call, so a token set never interleaves its Keychain steps with
// an App installation's, whichever object each was called through.
//
// A call that throws or rejects never wedges the queue: the next one still runs.
// Nothing taken under the lock may call another locked entry point (that call
// would wait on the one holding the lock, forever).
//
// It imports nothing, so the `studio` CLI's module graph is unchanged
// (`kernel/test/feature-seams.test.ts`).

/** Runs one call at a time, in the order they were started. */
export interface GitHubCredentialLock {
  /** Runs `fn` once every call started before it has settled; resolves or rejects as `fn` does. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** A new, empty queue. Tests build their own; the shipped connector and port share `githubCredentialLock`. */
export function createGitHubCredentialLock(): GitHubCredentialLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(() => fn());
      // The queue waits on this call settling, never on how: a failure does not stop the next call.
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

/** The process-wide queue: the default for `createGitHubConnector` and `createGitHubAppPort`. */
export const githubCredentialLock: GitHubCredentialLock = createGitHubCredentialLock();
