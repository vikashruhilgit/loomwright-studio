// The GitHub App setup dialog (GitHub App 4): the mockup's `appSheetHTML()` for
// the setup steps and every outcome, over the shared Dialog chrome
// (`dialog-overlay` / `dialog-panel`) and `useModalFocus`.
//
// Flow. On open the dialog calls `POST /connectors/github/app/setup` once and
// opens the returned `setup_url` through the open-external channel; the Studio
// window never navigates. It then follows the setup:
//   - step 1 (Create) until a `connector_status` event that is not a refusal
//     arrives, or the row becomes an App with a slug and no installation yet
//     (the step-2 signal; see docs/architecture/app.md). Step 2 (Install) after it;
//   - the screen closes the dialog when the connector reads `connected` as an App;
//   - a refusal ends it in one of the mockup's four outcome views. The reason is
//     read from the `refused` field of an event's payload, or the error code of
//     the setup route's refusal, only ever checked against the closed list
//     (`app-setup.ts`). The kernel's own `message` is never shown;
//   - the window's `expires_at` passing ends it as setup-expired.
// Cancel, Escape and the backdrop all cancel a running setup (one call to
// `POST /connectors/github/app/setup/cancel`) and land on setup-cancelled: the
// one window is never left open by closing the dialog.
//
// Over a token in use (`overToken`, the screen's "Switch to GitHub App"): the same dialog, the same one setup
// call, cancel and step logic, with the mockup's switch copy (`docs/design/mockups/gui-v2.html`, `switchDialog()`).
// It says GitHub stays connected through the token, and every ending says so: a cancel is "Setup cancelled.
// GitHub is still connected through your token.", and every refusal (setup-expired and write-scoped included)
// is the one "Setup didn't finish" view, which lists the write permissions a `token_write_scoped` names. None of
// them offers "Paste a token instead": a token is already in use. The dialog never touches the token: only the
// install does, in the kernel.
//
// "Open GitHub again" reopens the same `setup_url`, with no second setup call.
// A `setup_url` the channel refuses (it answers `false`) is setup-failed, never
// a silent no-op, and the window it opened is cancelled.
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Connector, EventFrame, StudioBridge, TruncatedEventFrame } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import "../../components/Dialog/Dialog.css";
import { useModalFocus } from "../../components/Dialog/useModalFocus";
import { cancelAppSetup, openExternalUrl, startAppSetup } from "./actions";
import {
  type AppSetupOutcome,
  type AppSetupPhase,
  MAX_TIMER_MS,
  closesAtText,
  isInProgress,
  msUntil,
  outcomeOfReply,
  signalOfEvent,
  slugOf,
  stepOneDoneRow,
  setupWindowOf,
} from "./app-setup";
import { INTEGRATIONS_TEST_IDS as IDS } from "./model";
import { AppsPageLink, ExternalGlyph } from "./parts";
import "./integrations.css";

export interface AppSetupSheetProps {
  readonly api: StudioBridge;
  /** The live feed's event log: events newer than the newest one at open are the setup's. */
  readonly events: readonly (EventFrame | TruncatedEventFrame)[];
  /** The GitHub row as last read, for the App's slug and the step-2 signal. */
  readonly connector: Connector | undefined;
  /** Close, from an outcome view (a running setup is cancelled first, never closed). */
  readonly onClose: () => void;
  /** "Set up again": the screen mounts a fresh dialog, which makes a new setup call. */
  readonly onSetUpAgain: () => void;
  /** "Paste a token instead": the token sheet. */
  readonly onPasteToken: () => void;
  /** Called with the dialog's phase as it changes, for the list row's words. */
  readonly onPhaseChange?: (phase: AppSetupPhase) => void;
  /** The dialog runs over a token in use (the switch): its copy says the token stays connected. */
  readonly overToken?: boolean;
}

function newestId(events: readonly { readonly id: number }[]): number {
  const last = events[events.length - 1];
  return last === undefined ? 0 : last.id;
}

function Step({ n, label, dot, badge, tone, testId }: { readonly n: number; readonly label: string; readonly dot: "working" | "ok" | "idle"; readonly badge: string; readonly tone?: "ok"; readonly testId: string }) {
  return (
    <li data-testid={testId}>
      <span className="integrations-dot" data-state={dot} aria-hidden="true" />
      <span>{`Step ${n} of 2 · ${label}`}</span>
      <span className="integrations-badge" data-tone={tone}>
        {badge}
      </span>
    </li>
  );
}

export function AppSetupSheet({ api, events, connector, onClose, onSetUpAgain, onPasteToken, onPhaseChange, overToken = false }: AppSetupSheetProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const descId = `${ids}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const [phase, setPhaseState] = useState<AppSetupPhase>({ kind: "starting" });
  const phaseRef = useRef<AppSetupPhase>(phase);
  const [drops, setDrops] = useState<readonly string[]>([]);
  const [slug, setSlug] = useState<string | undefined>(() => slugOf(connector?.app_slug));
  const [expiresAt, setExpiresAt] = useState<string | undefined>(undefined);
  const [cancelFailed, setCancelFailed] = useState(false);

  const mounted = useRef(true);
  const started = useRef(false);
  const setupUrl = useRef<string | undefined>(undefined);
  // The setup call was answered: a window may be open until it is cancelled or closes.
  const windowOpened = useRef(false);
  const cancelSent = useRef(false);
  // The owner cancelled; if that was before the setup call was answered, its answer cancels the window it opened.
  const cancelWanted = useRef(false);
  // The connector became an App connection: the setup is done, so a later unmount cancels nothing.
  const finished = useRef(false);
  // Events at or before this id were there before the dialog opened.
  const seenEvent = useRef(newestId(events));
  const initialUpdate = useRef(connector?.updated_at);

  // The one place the phase changes. The screen's list row follows it, so it is told here, in the same batch as the
  // sheet's own state: both commit together and the row never lags the dialog (an effect would commit a render later).
  // The screen seeds the first phase (`starting`) itself when it opens the dialog.
  const move = useCallback((next: AppSetupPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
    latest.current.onPhaseChange?.(next);
  }, []);

  /** Ends a running setup in an outcome view. The first outcome stands: a later refusal never replaces it. */
  const end = useCallback(
    (outcome: AppSetupOutcome, listed: readonly string[] = []) => {
      if (!isInProgress(phaseRef.current)) return;
      setDrops(listed);
      move({ kind: "outcome", outcome });
    },
    [move],
  );

  const sendCancel = useCallback(async () => {
    if (cancelSent.current) return;
    cancelSent.current = true;
    const reply = await cancelAppSetup(api);
    // A kernel that cannot be asked cannot be told to close the window: say so, never claim it closed.
    if (mounted.current && (reply.kind === "unreachable" || reply.kind === "failed")) setCancelFailed(true);
  }, [api]);

  const latest = useRef({ onClose, onPhaseChange, sendCancel });
  latest.current = { onClose, onPhaseChange, sendCancel };

  // The one setup call. A ref guards it, so a remount of the same instance (StrictMode's double effects) never makes a second.
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void (async () => {
        const reply = await startAppSetup(api);
        if (reply.kind === "ok") windowOpened.current = true;
        // Cancelled (or ended) while the call was out: the window that just opened is closed again, and the URL is not opened.
        if (!isInProgress(phaseRef.current)) {
          if (windowOpened.current && cancelWanted.current) void latest.current.sendCancel();
          return;
        }
        if (!mounted.current) {
          // The dialog went away before the answer: a window it opened is not left behind.
          if (windowOpened.current && !finished.current) void latest.current.sendCancel();
          return;
        }
        if (reply.kind !== "ok") {
          const said = outcomeOfReply(reply);
          end(said.outcome, said.drops);
          return;
        }
        const setup = setupWindowOf(reply.body);
        if (setup === undefined) {
          end("failed");
          void latest.current.sendCancel();
          return;
        }
        setupUrl.current = setup.setupUrl;
        setExpiresAt(setup.expiresAt);
        move({ kind: "create" });
        const opened = await openExternalUrl(api, setup.setupUrl);
        if (!opened) {
          // The channel refused the address (or could not open it): never a silent no-op, and the window is not left open.
          end("failed");
          void latest.current.sendCancel();
        }
      })();
    }
    return () => {
      mounted.current = false;
    };
    // The effect runs for the dialog's life; `api`, `end` and `move` are stable for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Cancel, Escape and the backdrop while the setup runs: the cancelled view now, the cancel call once. */
  const cancel = useCallback(() => {
    if (!isInProgress(phaseRef.current)) return;
    cancelWanted.current = true;
    move({ kind: "outcome", outcome: "cancelled" });
    // Before the setup call is answered there is nothing to cancel yet: the answer's handler cancels the window it opened.
    if (windowOpened.current) void latest.current.sendCancel();
  }, [move]);

  /** A window left open when the dialog goes away without finishing (the screen unmounts) is cancelled. */
  useEffect(
    () => () => {
      if (finished.current || !windowOpened.current || !isInProgress(phaseRef.current)) return;
      void latest.current.sendCancel();
    },
    [],
  );

  const dismiss = useCallback(() => {
    if (isInProgress(phaseRef.current)) cancel();
    else latest.current.onClose();
  }, [cancel]);

  useModalFocus(panelRef, true, dismiss);

  // The connector became an App connection: the setup is over, and the screen closes the dialog.
  useEffect(() => {
    if (connector?.method === "app" && (connector.status === "connected" || connector.status === "expiring")) finished.current = true;
  }, [connector]);

  // Step 2: the row says step 1 is done (an App with a slug and no installation, changed since the dialog opened).
  const stepOne = phase.kind === "create";
  useEffect(() => {
    if (stepOne && connector?.updated_at !== initialUpdate.current && stepOneDoneRow(connector)) move({ kind: "install" });
  }, [stepOne, connector, move]);

  // The feed: events newer than the dialog. A refusal ends the setup; any other change moves it to step 2.
  useEffect(() => {
    const newest = newestId(events);
    // The feed's ids restarted (the kernel's event table was wiped): everything in it is new.
    if (newest < seenEvent.current) seenEvent.current = 0;
    for (const event of events) {
      if (event.id <= seenEvent.current) continue;
      seenEvent.current = event.id;
      const signal = signalOfEvent(event);
      if (signal === undefined) continue;
      if (signal.slug !== undefined) setSlug(signal.slug);
      if (signal.kind === "refused") end(signal.outcome, signal.drops);
      // Before the setup call is answered a change is not about this window; only step 1 moves on.
      else if (phaseRef.current.kind === "create") move({ kind: "install" });
    }
  }, [events, end, move]);

  // The window's clock: once `expires_at` passes, the setup has timed out.
  useEffect(() => {
    if (!isInProgress(phase) || expiresAt === undefined) return;
    const left = msUntil(expiresAt, Date.now());
    if (left === undefined || left > MAX_TIMER_MS) return;
    const timer = window.setTimeout(() => end("expired"), Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [phase, expiresAt, end]);

  // The primary action takes focus on each view (the mockup's `data-af`).
  const view = phase.kind === "outcome" ? phase.outcome : "running";
  useEffect(() => {
    primaryRef.current?.focus();
  }, [view]);

  const reopen = async () => {
    const url = setupUrl.current;
    if (url === undefined || !isInProgress(phaseRef.current)) return;
    const opened = await openExternalUrl(api, url);
    if (!opened && mounted.current) {
      end("failed");
      void latest.current.sendCancel();
    }
  };

  const closes = closesAtText(expiresAt);
  const status = phaseStatus(phase, overToken);
  let title: string;
  let body: ReactNode;
  let actions: ReactNode;
  const again = (
    <>
      <Button variant="secondary" onClick={onPasteToken} data-testid={IDS.appPasteToken}>
        Paste a token instead
      </Button>
      <Button ref={primaryRef} variant="primary" onClick={onSetUpAgain} data-testid={IDS.appAgain}>
        Set up again
      </Button>
    </>
  );
  const close = (
    <Button variant="secondary" onClick={onClose} data-testid={IDS.appClose}>
      Close
    </Button>
  );
  // Over a token the actions are Close and Set up again only: the token is in use, so there is nothing to paste.
  const againOverToken = (
    <>
      {close}
      <Button ref={primaryRef} variant="primary" onClick={onSetUpAgain} data-testid={IDS.appAgain}>
        Set up again
      </Button>
    </>
  );
  const appsLink = <AppsPageLink api={api} slug={slug} testId={IDS.appLink} />;
  const staysOnGitHub = <p>If you had already created the App on GitHub, it stays on your account until you delete it.</p>;

  if (phase.kind !== "outcome") {
    const one = phase.kind !== "install";
    title = overToken ? "Switch GitHub to the GitHub App" : "Set up the GitHub App";
    body = (
      <>
        <p id={descId}>
          {overToken
            ? "Studio opened GitHub in your browser. The two clicks there are yours: Create, then Install. GitHub stays connected through your token while this runs, and keeps working if you cancel or setup fails."
            : "Studio opened GitHub in your browser. The two clicks there are yours: Create, then Install. Studio can't make them for you, and it receives the App's key itself, so you never download a file."}
        </p>
        <ul className="integrations-box" aria-label="Setup steps" data-testid={IDS.appSteps} data-step={one ? "1" : "2"}>
          <Step n={1} label="Create the App on GitHub" dot={one ? "working" : "ok"} badge={one ? "waiting for you" : "done"} tone={one ? undefined : "ok"} testId={IDS.appStep1} />
          <Step n={2} label="Pick the repos and install it" dot={one ? "idle" : "working"} badge={one ? "next" : "waiting for you"} testId={IDS.appStep2} />
        </ul>
        <p className="integrations-cap">{`${one ? "On GitHub, click Create GitHub App." : "On GitHub, choose the repos Studio may read, then click Install."} The App is private, has no webhook, and asks for Pull requests: Read, Contents: Read and Metadata: Read. ${overToken ? "When it connects, the token item is removed." : "Nothing more."}`}</p>
        {closes === undefined ? null : (
          <p className="integrations-cap" data-testid={IDS.appCloses}>
            {`This setup window closes at ${closes}.`}
          </p>
        )}
      </>
    );
    actions = (
      <>
        <Button variant="secondary" onClick={cancel} data-testid={IDS.appCancel}>
          Cancel
        </Button>
        <Button ref={primaryRef} variant="primary" icon={<ExternalGlyph />} loading={phase.kind === "starting"} onClick={() => void reopen()} data-testid={IDS.appOpenAgain}>
          Open GitHub again
        </Button>
      </>
    );
  } else if (phase.outcome === "cancelled") {
    title = "Setup cancelled";
    body = (
      <>
        <p id={descId}>
          {overToken
            ? "Setup cancelled. GitHub is still connected through your token. The setup window is closed. If you had already created the App on GitHub, it stays on your account until you delete it."
            : "Nothing was connected, and the setup window is closed. If you had already created the App on GitHub, it stays on your account until you delete it."}
        </p>
        {cancelFailed ? (
          <p className="integrations-cap" role="status">
            {`Studio couldn't reach the kernel to close the setup window. It closes by itself${closes === undefined ? "" : ` at ${closes}`}.`}
          </p>
        ) : null}
        {appsLink}
      </>
    );
    actions = overToken ? (
      againOverToken
    ) : (
      <>
        {close}
        {again}
      </>
    );
  } else if (overToken) {
    // The mockup's `swf`: the one failure view of the switch, whatever the reason. Nothing changed, and the token is still in use.
    const writes = phase.outcome === "write-scoped";
    title = "Setup didn't finish";
    body = (
      <>
        <div className="integrations-refusal" id={descId} role="alert" data-testid={IDS.appOutcome}>
          <p>GitHub didn&apos;t finish setting the App up, so nothing changed. GitHub is still connected through your token.</p>
          {writes ? (
            <>
              <p>GitHub reports that the App you installed can write, so Studio didn&apos;t connect it. Studio takes only read-only access in this phase. On GitHub, open the App&apos;s permissions and change:</p>
              {drops.length === 0 ? null : (
                <ul>
                  {drops.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <p>Then set it up again.</p>
            </>
          ) : null}
        </div>
        <p className="integrations-cap">Try again. If it keeps failing, keep using the token: it works as before.</p>
        {writes ? appsLink : null}
      </>
    );
    actions = againOverToken;
  } else if (phase.outcome === "expired") {
    title = "Setup timed out";
    body = (
      <>
        <div className="integrations-refusal" id={descId} role="alert" data-testid={IDS.appOutcome}>
          <p>{`The setup window closed${closes === undefined ? "" : ` at ${closes}`}, before GitHub came back to Studio. Nothing was connected.`}</p>
        </div>
        {staysOnGitHub}
        {appsLink}
      </>
    );
    actions = (
      <>
        {close}
        {again}
      </>
    );
  } else if (phase.outcome === "write-scoped") {
    title = "The App can write";
    body = (
      <>
        <div className="integrations-refusal" id={descId} role="alert" data-testid={IDS.appOutcome}>
          <p>GitHub reports that the App you installed can write, so Studio didn&apos;t connect it. Studio takes only read-only access in this phase. On GitHub, open the App&apos;s permissions and change:</p>
          {drops.length === 0 ? null : (
            <ul>
              {drops.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p>Then set it up again.</p>
        </div>
        {appsLink}
      </>
    );
    actions = (
      <>
        {close}
        <Button ref={primaryRef} variant="primary" onClick={onSetUpAgain} data-testid={IDS.appAgain}>
          Set up again
        </Button>
      </>
    );
  } else {
    title = "Setup didn't finish";
    body = (
      <>
        <div className="integrations-refusal" id={descId} role="alert" data-testid={IDS.appOutcome}>
          <p>GitHub didn&apos;t finish setting the App up. Either it did not hand the App&apos;s key to Studio after Create, or the install did not complete or could not be checked. Nothing was connected.</p>
        </div>
        <p className="integrations-cap">Try again. If it keeps failing, paste a token instead.</p>
      </>
    );
    actions = (
      <>
        {close}
        {again}
      </>
    );
  }

  return createPortal(
    <div
      className="dialog-overlay"
      data-state="open"
      onMouseDown={(event) => {
        // A press on the backdrop itself (not a drag that ends there) is the same as Escape.
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div ref={panelRef} className="dialog-panel integrations-sheet" data-wide="true" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} tabIndex={-1} data-testid={IDS.appSetup} data-phase={phase.kind === "outcome" ? phase.outcome : phase.kind}>
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        {body}
        <p className="integrations-sr-only" role="status" data-testid={IDS.appStatus}>
          {status}
        </p>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

/** What the live region says on each view (the mockup's `live()` lines). Over a token every running step says the token stays connected. */
function phaseStatus(phase: AppSetupPhase, overToken: boolean): string {
  const stays = overToken ? " GitHub stays connected through the token." : "";
  if (phase.kind === "starting") return `Setting up the GitHub App.${stays}`;
  if (phase.kind === "create") return `Setting up the GitHub App. Waiting for you on GitHub: step 1 of 2, Create.${stays}`;
  if (phase.kind === "install") return `Step 2 of 2, Install.${stays}`;
  if (phase.outcome !== "cancelled") return "";
  return overToken ? "Setup cancelled. GitHub is still connected through your token." : "Setup cancelled. Nothing was connected.";
}
