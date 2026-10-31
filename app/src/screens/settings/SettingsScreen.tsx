// Settings (phase 7 item 08), built to the approved mockup (`docs/design/mockups/gui-v2.html`,
// `settingsScreen`): the auth provider read-only with its health and the terminal commands
// that change it (`./AuthSection.tsx`), the kernel's data location, notifier and Loomwright
// install, and the app's own preferences (launch at login, notifications, theme).
//
// Data. `GET /settings` is read here, on mount and again when an `auth_*` or `loomwright_*`
// event arrives on the live feed (`./model.ts` lists the kinds; throttled to one read per
// `REFETCH_THROTTLE_MS`). The screen holds the contract's known fields only (`parseSettings`),
// so a body's extra field is never shown or kept, and it edits no shared store file. A refetch
// keeps the rows on screen until the answer lands (no skeleton, fixed rows), so a live update
// moves nothing already shown. A status 0 answer is "kernel unreachable", never "nothing to
// show": the screen keeps its last data, marks it "last known" and disables Reveal; the shell
// draws the shared band above it.
//
// The app's own preferences are the main process's (`window.api.prefs`), not the kernel's: they
// work while the kernel is down. Launch at login shows what the OS reports on every read; a
// "needs approval" or refused state is said as it is. The theme is applied by the main process
// (`nativeTheme.themeSource`), so the tokens re-theme at once with no reload.
//
// There is no input, no sign-in control and no secret field on this screen (invariants 6 and 7).
// Keys. Everything is reachable by Tab, Enter and Space; the ⌘K commands call the same handlers.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { StudioBridge, ThemePreference } from "../../api/contract";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Button } from "../../components/Button/Button";
import { useLiveStore } from "../../store/react";
import { failureDetail } from "../schedules/model";
import { useFeedRefetch } from "../schedules/useSchedule";
import { AuthSection, CommandsSection, KernelSection } from "./AuthSection";
import { SETTINGS_OWNER, settingsCommands } from "./commands";
import {
  LOGIN_DESCRIPTION,
  NOTIFICATIONS_DESCRIPTION,
  SETTINGS_TEST_IDS as IDS,
  THEME_DESCRIPTION,
  bandOf,
  loginNote,
  newestSettingsEventId,
} from "./model";
import { Skeleton, Switch, WarnGlyph } from "./parts";
import { useSettingsRead, usePreferences } from "./useSettings";
import "./settings.css";

const THEMES: readonly { readonly theme: ThemePreference; readonly label: string; readonly testId: string }[] = [
  { theme: "system", label: "System", testId: IDS.themeSystem },
  { theme: "light", label: "Light", testId: IDS.themeLight },
  { theme: "dark", label: "Dark", testId: IDS.themeDark },
];

export interface SettingsScreenProps {
  readonly api: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

export function SettingsScreen({ api, registry = commandRegistry }: SettingsScreenProps) {
  const { connection, eventLog } = useLiveStore(api);
  const { read, refetch } = useSettingsRead(api);
  const preferences = usePreferences(api);
  const [revealFailed, setRevealFailed] = useState(false);

  const connectionDown = connection.state === "reconnecting" || connection.state === "unreachable" || connection.state === "not_installed";
  const latest = read.latest;
  const offline = connectionDown || latest?.kind === "unreachable";
  const view = read.lastOk;
  const failed = latest !== undefined && (latest.kind === "refused" || latest.kind === "failed") ? latest : undefined;

  // A live event refetches the view; the feed's own baseline at mount is not one.
  useFeedRefetch(newestSettingsEventId(eventLog), refetch);

  // "It may be restarting; this window reconnects on its own": once the feed is live again, ask again.
  const live = connection.state === "live";
  const unanswered = latest?.kind === "unreachable" || latest?.kind === "failed";
  useEffect(() => {
    if (live && unanswered) refetch();
  }, [live, unanswered, refetch]);

  const { prefs, change, reveal: revealFolder } = preferences;
  const prefsReady = preferences.available && prefs !== undefined;
  const reveal = useCallback(async () => {
    if (offline) return;
    setRevealFailed(!(await revealFolder()));
  }, [offline, revealFolder]);

  // Palette commands: registered while mounted, read through a ref so a handler is never stale. The two toggles'
  // titles name the action they would take, so the screen registers again when a switch changes.
  const state = useRef({ offline, prefsReady, prefs, reveal, change });
  state.current = { offline, prefsReady, prefs, reveal, change };
  const loginOn = prefs?.launchAtLogin.enabled;
  const notificationsOn = prefs?.notifications;
  useEffect(
    () =>
      registry.register(
        SETTINGS_OWNER,
        settingsCommands(
          () => ({ offline: state.current.offline, prefsReady: state.current.prefsReady }),
          () => ({
            setTheme: (theme) => state.current.change("theme", { theme }),
            reveal: () => state.current.reveal(),
            toggleLogin: () => state.current.change("login", { launchAtLogin: state.current.prefs?.launchAtLogin.enabled !== true }),
            toggleNotifications: () => state.current.change("notifications", { notifications: state.current.prefs?.notifications !== true }),
          }),
          { launchAtLogin: loginOn, notifications: notificationsOn },
        ),
      ),
    [registry, loginOn, notificationsOn],
  );

  const now = new Date();
  const band = view === undefined ? undefined : bandOf(view, now);

  // What the auth section draws while it holds no view.
  let placeholder: ReactNode;
  if (failed !== undefined) {
    placeholder = (
      <div className="settings-fail" role="alert" data-testid={IDS.error}>
        <div className="settings-fail-head">
          <WarnGlyph />
          <h3 className="settings-title">Couldn't load the auth provider</h3>
        </div>
        <p>{failed.kind === "refused" ? `The kernel answered, but the settings request failed (${failed.status}). Nothing on this screen was changed.` : "The kernel did not answer the settings request. Nothing on this screen was changed."}</p>
        <div className="settings-fail-detail settings-mono" data-testid={IDS.errorDetail}>
          {failureDetail("GET /settings", failed)}
        </div>
        <div>
          <Button size="row" variant="secondary" disabled={offline} onClick={refetch} data-testid={IDS.retry}>
            Try again
          </Button>
        </div>
      </div>
    );
  } else if (latest?.kind === "unreachable" || (latest === undefined && connectionDown)) {
    placeholder = (
      <div className="settings-unknown" data-testid={IDS.unknown}>
        <h3 className="settings-title">Status unknown</h3>
        <p>Studio can't tell how the auth provider is until the kernel answers.</p>
      </div>
    );
  } else placeholder = <Skeleton testId={IDS.loading} what="the auth provider" rows={2} />;

  const showKernelSection = view !== undefined;
  const showKernelSkeleton = view === undefined && failed === undefined && !(latest?.kind === "unreachable" || (latest === undefined && connectionDown));

  const login = prefs?.launchAtLogin;
  const note = login === undefined ? undefined : loginNote(login, preferences.loginRefused);
  const unavailable = !preferences.available || (prefs === undefined && preferences.failed);
  const controlsOff = !prefsReady;

  return (
    <div className="settings" data-testid={IDS.screen} data-offline={offline ? "true" : undefined}>
      {band === undefined ? null : (
        <div className="settings-band" data-tone={band.tone} role={band.role} data-testid={IDS.band}>
          <WarnGlyph />
          <span>{band.text}</span>
        </div>
      )}
      {view !== undefined && failed !== undefined ? (
        <p className="settings-notice" data-tone="danger" role="alert" data-testid={IDS.notice}>
          {`Couldn't refresh the settings: ${failureDetail("GET /settings", failed)}. What is shown is the last read.`}
        </p>
      ) : null}
      <div className="settings-pad">
        <AuthSection view={view} placeholder={placeholder} offline={offline} now={now} />
        {failed !== undefined && view === undefined ? null : <CommandsSection view={view} />}
        {showKernelSection ? (
          <KernelSection view={view} offline={offline} canReveal={preferences.available} onReveal={() => void reveal()} revealFailed={revealFailed} />
        ) : showKernelSkeleton ? (
          <section className="settings-blk" aria-labelledby="settings-h-kern">
            <div className="settings-sech">
              <h2 className="settings-label" id="settings-h-kern">
                Kernel
              </h2>
            </div>
            <Skeleton testId={`${IDS.loading}-kernel`} what="the kernel" rows={1} />
          </section>
        ) : null}

        <section className="settings-blk" aria-labelledby="settings-h-app" data-testid={IDS.app}>
          <div className="settings-sech">
            <h2 className="settings-label" id="settings-h-app">
              This app
            </h2>
            <span className="settings-cap">Kept in the app's own settings, not in the kernel</span>
          </div>
          {unavailable ? (
            <p className="settings-notice" data-tone={preferences.available ? "danger" : "neutral"} role={preferences.available ? "alert" : undefined} data-testid={preferences.available ? IDS.prefsError : IDS.prefsUnavailable}>
              {preferences.available ? "Couldn't read this app's settings." : "This window has no access to the app's own settings."}
            </p>
          ) : null}
          <ul className="settings-box" aria-label="This app">
            <li>
              <span className="settings-ttext">
                <b>Launch at login</b>
                <span className="settings-cap" data-tone={note === undefined ? undefined : "attention"} data-testid={IDS.loginNote}>
                  {note ?? LOGIN_DESCRIPTION}
                </span>
              </span>
              <Switch
                checked={login?.enabled === true}
                label={`Launch at login is ${login?.enabled === true ? "on" : "off"}`}
                busy={preferences.busy.has("login")}
                disabled={controlsOff}
                testId={IDS.login}
                onToggle={() => void change("login", { launchAtLogin: login?.enabled !== true })}
              />
            </li>
            <li>
              <span className="settings-ttext">
                <b>Notifications</b>
                <span className="settings-cap">{NOTIFICATIONS_DESCRIPTION}</span>
              </span>
              <Switch
                checked={prefs?.notifications === true}
                label={`Notifications is ${prefs?.notifications === true ? "on" : "off"}`}
                busy={preferences.busy.has("notifications")}
                disabled={controlsOff}
                testId={IDS.notifications}
                onToggle={() => void change("notifications", { notifications: prefs?.notifications !== true })}
              />
            </li>
            <li>
              <span className="settings-ttext">
                <b id="settings-theme-label">Theme</b>
                <span className="settings-cap">{THEME_DESCRIPTION}</span>
              </span>
              <span className="settings-chips" role="group" aria-labelledby="settings-theme-label" data-testid={IDS.themeGroup}>
                {THEMES.map(({ theme, label, testId }) => (
                  <button
                    key={theme}
                    type="button"
                    className="settings-chip"
                    aria-pressed={prefs?.theme === theme}
                    aria-busy={preferences.busy.has("theme") ? "true" : undefined}
                    disabled={controlsOff}
                    data-testid={testId}
                    onClick={() => void change("theme", { theme })}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
