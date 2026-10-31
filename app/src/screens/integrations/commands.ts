// Integrations' ⌘K commands (phase 6 item 11, AC8): owner `integrations`, ids
// prefixed `integrations.`. Registered while the Integrations screen is mounted
// and unregistered on unmount (the shell renders only the current screen),
// through the registry's own unregister. Each command calls the same handler as
// its button, so both reach the same route.
//
// The palette reads `enabled` when it opens, so the flags are read through a
// ref that every render refreshes: the four commands are registered once,
// never again when the connector changes state.
//   Connect GitHub          disabled while the kernel is unreachable, and while a GitHub App is
//                           connected (the mockup's "disconnect first": one connection at a time);
//                           opens the choice when nothing is connected, and the sheet in replace
//                           mode when a token exists (the mockup's palette entry)
//   Disconnect GitHub       enabled only while a non-disconnected token row exists
//   Refresh reachable repos enabled while a token is in use (expired too), the
//                           same as the detail pane's Refresh button
//   Switch GitHub to the GitHub App
//                           enabled only while a token is in use, the kernel is reachable and no App is
//                           connected (the detail pane's "Switch to GitHub App"): it opens the App setup
//                           dialog over the token, which stays in use until the install succeeds
import { useEffect, useRef } from "react";
import type { Command, CommandRegistry } from "../../commands/registry";

/** The registry owner every Integrations command is registered under. */
export const INTEGRATIONS_OWNER = "integrations";

/** The palette group Integrations' commands appear under. */
export const INTEGRATIONS_GROUP = "Integrations";

/** What each command does: the same handlers the screen's buttons call. */
export interface IntegrationsCommandHandlers {
  /** The choice when nothing is connected; the token sheet in replace mode when a token exists. */
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly refreshRepos: () => void | Promise<void>;
  /** The App setup dialog over the token in use (the detail pane's "Switch to GitHub App"). */
  readonly switchToApp: () => void;
}

/** What decides `enabled`, read at the moment the palette asks. */
export interface IntegrationsCommandFlags {
  /** The kernel cannot be asked (status 0). */
  readonly offline: boolean;
  /** A token is in use: connected, expiring or expired. */
  readonly hasToken: boolean;
  /** The connection in use is a GitHub App (connected or revoked): Connect GitHub waits for a disconnect. */
  readonly appConnected: boolean;
}

/** Integrations' commands over `flags` and `handlers` (both read when a command is asked, never captured). */
export function integrationsCommands(flags: () => IntegrationsCommandFlags, handlers: () => IntegrationsCommandHandlers): Command[] {
  return [
    {
      id: "integrations.connect-github",
      title: "Connect GitHub",
      group: INTEGRATIONS_GROUP,
      keywords: ["token", "replace", "integration", "connector"],
      enabled: () => {
        const f = flags();
        return !f.offline && !f.appConnected;
      },
      run: () => handlers().connect(),
    },
    {
      id: "integrations.disconnect-github",
      title: "Disconnect GitHub",
      group: INTEGRATIONS_GROUP,
      keywords: ["token", "remove", "integration", "connector"],
      enabled: () => {
        const f = flags();
        return f.hasToken && !f.offline;
      },
      run: () => handlers().disconnect(),
    },
    {
      id: "integrations.refresh-repos",
      title: "Refresh reachable repos",
      group: INTEGRATIONS_GROUP,
      keywords: ["github", "repositories", "reload"],
      enabled: () => {
        const f = flags();
        return f.hasToken && !f.offline;
      },
      run: () => handlers().refreshRepos(),
    },
    {
      id: "integrations.switch-to-app",
      title: "Switch GitHub to the GitHub App",
      group: INTEGRATIONS_GROUP,
      keywords: ["token", "app", "install", "integration", "connector"],
      enabled: () => {
        const f = flags();
        return f.hasToken && !f.offline && !f.appConnected;
      },
      run: () => handlers().switchToApp(),
    },
  ];
}

/** Register Integrations' commands with `registry` for the caller's lifetime. The latest flags and handlers are read through a ref. */
export function useIntegrationsCommands(registry: CommandRegistry, flags: IntegrationsCommandFlags, handlers: IntegrationsCommandHandlers): void {
  const latest = useRef({ flags, handlers });
  latest.current = { flags, handlers };
  useEffect(() => registry.register(INTEGRATIONS_OWNER, integrationsCommands(() => latest.current.flags, () => latest.current.handlers)), [registry]);
}
