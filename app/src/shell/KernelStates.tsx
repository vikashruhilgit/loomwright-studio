// The shell's designed kernel states (DESIGN.md: every screen has an error
// state, the "kernel unreachable" band): the one red band over the current screen
// for a kernel that is unreachable or reconnecting, and the "kernel not
// installed" state with the exact terminal setup commands. Setup stays in the
// owner's own terminal (D27, invariant 6): the app never runs a login flow and
// never asks for the token.
import { useState } from "react";
import { getBridge } from "../api/bridge";
import type { KernelLogReveal, StudioBridge } from "../api/contract";
import { WarnGlyph } from "../components/Glyph";
// The shared Band's action style (`.toast-band-action`), imported here so the band does not rely on another screen's import.
import "../components/Toast/Toast.css";

/** The setup steps, in order: each is a command the owner runs in his own terminal. */
export const SETUP_STEPS: readonly { readonly what: string; readonly command: string }[] = [
  { what: "Create your long-lived subscription token", command: "claude setup-token" },
  {
    what: "Save it in the Keychain (paste the token at the prompt)",
    command: "security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w",
  },
  { what: "Install and start the kernel service", command: "studio service install" },
];

/** The band's one fixed copy: no request text, no connection state, no port (a kernel string is never rendered here). */
export const KERNEL_BAND_COPY = "Couldn't reach the kernel. It may be restarting; this window reconnects on its own.";

/** The band's action (the mockup's `BAND` button). It reveals the kernel service's log in Finder. */
export const KERNEL_LOG_LABEL = "Kernel log";

/** What the band says after a press, by the main process's answer: nothing once Finder was asked, else why not. */
function noteFor(answer: KernelLogReveal): string | null {
  if (answer === "revealed") return null;
  return answer === "missing" ? "There is no kernel log yet." : "Couldn't open the kernel log.";
}

/**
 * The one red band for a kernel that does not answer (`reconnecting` or `unreachable`). The shell draws it once
 * above the screen; a screen draws it itself only when its own read answered status 0 before the store noticed
 * (`!useKernelReach(api).shellBand`), so exactly one is ever on screen. It carries no prop that holds text.
 *
 * Its one action asks the main process to reveal the kernel's log; the answer's note lives in this component and
 * goes with it. The bridge is read at press time because the shell and the screens render the band without an `api`.
 */
export function KernelBand({ testId = "kernel-unreachable-band" }: { readonly testId?: string }) {
  const [note, setNote] = useState<string | null>(null);
  const reveal = async (): Promise<void> => {
    let answer: KernelLogReveal = "failed";
    try {
      answer = (await (getBridge() as StudioBridge | undefined)?.revealKernelLog?.()) ?? "failed";
    } catch {
      // A rejected call reads as a failure to open, same as a bridge without the member.
    }
    setNote(noteFor(answer));
  };
  return (
    <div className="band band-danger" role="alert" data-testid={testId}>
      <WarnGlyph className="band-glyph" />
      <span>{KERNEL_BAND_COPY}</span>
      <button type="button" className="toast-band-action" onClick={() => void reveal()}>
        {KERNEL_LOG_LABEL}
      </button>
      {note === null ? null : (
        <span role="status" data-testid="kernel-log-note">
          {note}
        </span>
      )}
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
