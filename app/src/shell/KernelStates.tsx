// The shell's designed kernel states (DESIGN.md: every screen has an error
// state, the "kernel unreachable" band): the band over the current screen, and
// the "kernel not installed" state with the exact terminal setup commands.
// Setup stays in the owner's own terminal (D27, invariant 6): the app never
// runs a login flow and never asks for the token.

/** The setup steps, in order: each is a command the owner runs in his own terminal. */
export const SETUP_STEPS: readonly { readonly what: string; readonly command: string }[] = [
  { what: "Create your long-lived subscription token", command: "claude setup-token" },
  {
    what: "Save it in the Keychain (paste the token at the prompt)",
    command: "security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w",
  },
  { what: "Install and start the kernel service", command: "studio service install" },
];

/** Over the current screen while `api.json` exists but the kernel does not answer. */
export function UnreachableBand() {
  return (
    <div className="band band-danger" role="alert" data-testid="kernel-unreachable-band">
      <span className="band-dot" aria-hidden="true" />
      Couldn't reach the kernel. It may be restarting; this window reconnects on its own.
    </div>
  );
}

/** In place of the screen while there is no `api.json`: the kernel was never started here. */
export function NotInstalledState({ dataDir }: { readonly dataDir: string }) {
  return (
    <div className="setup" data-testid="kernel-not-installed">
      <h1 className="setup-title">The kernel isn't installed yet</h1>
      <p className="setup-note">
        Wright's kernel runs in the background, apart from this window. Set it up once, in your own terminal:
      </p>
      <ol className="setup-steps">
        {SETUP_STEPS.map((step) => (
          <li key={step.command}>
            <span className="setup-what">{step.what}</span>
            <code className="setup-command">{step.command}</code>
          </li>
        ))}
      </ol>
      <p className="setup-meta">
        Looked for <code>{`${dataDir}/api.json`}</code>. This window connects on its own once the kernel is running.
      </p>
    </div>
  );
}
