// Integrations' view (phase 6 item 11): the GitHub connector, built to the
// approved mockup (`docs/design/mockups/integrations.html`). A list pane with
// the one connector row, and a detail pane that is the empty state, the
// connected / expiring / expired detail, or "status unknown"; the Connect
// GitHub sheet (`./ConnectSheet.tsx`), the Disconnect confirm and Integrations'
// ⌘K commands.
//
// Data: `GET /connectors` is read here, on mount and again when a
// `connector_status` event arrives on the live feed (trailing,
// `REFETCH_THROTTLE_MS` after the last one; Team's `useConnectors` is private to
// its view, so this is its own copy of the same pattern). A refetch keeps the
// last answer on screen until the next lands, so nothing flashes or shifts; an
// answer older than the latest request is dropped. A status 0 answer is
// "kernel unreachable", never "not connected". The roster (`useResource("agents")`)
// gives the agents with the GitHub grant. Every write goes through `./actions.ts`
// and reaches the screen through `GET /connectors`, never a local edit.
//
// The GitHub App path (GitHub App 4): with nothing connected the Connect sheet opens on
// a choice; "Install GitHub App" mounts the setup dialog (`./AppSetupSheet.tsx`), which
// follows the setup through the feed, and an App connection has its own detail pane
// (`./AppDetail.tsx`) and a disconnect confirm that sends the owner to GitHub for the
// part Studio cannot remove.
//
// Switching from a token: "Switch to GitHub App" (the token detail's header, and the palette's "Switch GitHub
// to the GitHub App") is `startApp` called while a token is in use. It is the same setup dialog, told it runs
// over the token (`overToken`), so its words say the token stays connected, and the list row reads `token ·
// setting up the App`. Nothing here disconnects: the token goes only when the kernel records the install, and a
// cancel or a failure leaves the connection as it was.
//
// Every string from the kernel or GitHub (account, permission names, repo
// names, refusals) is untrusted data: a React text child, never markup.
import { type ReactNode, type Ref, useCallback, useEffect, useId, useRef, useState } from "react";
import type { Connector, ConnectorsResponse, RosterEntry, StudioBridge } from "../../api/contract";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { useLiveStore, useResource } from "../../store/react";
import { REFETCH_THROTTLE_MS } from "../../store/store";
import { disconnectGithub, fetchRepos, readConnectors } from "./actions";
import { AppDetail } from "./AppDetail";
import { AppSetupSheet } from "./AppSetupSheet";
import { type AppSetupPhase, INSTALLATIONS_URL, appRowMeta, slugOf, switchRowMeta } from "./app-setup";
import { ConnectSheet } from "./ConnectSheet";
import type { SheetMode } from "./ConnectSheet";
import { useIntegrationsCommands } from "./commands";
import {
  type ConnectorsRead,
  INTEGRATIONS_TEST_IDS as IDS,
  type IntegrationsView as View,
  type Reply,
  daysLeft,
  expiryOf,
  githubRow,
  hasToken,
  isAppConnection,
  isOffline,
  permissionLines,
  replyText,
  rowMeta,
  switchToApp,
  viewOf,
  whenText,
} from "./model";
import { AppsPageLink, CheckGlyph, ExternalLink, GitHubMark, GrantSection, RefreshGlyph, RepoGlyph, WarnGlyph } from "./parts";
import "./integrations.css";

// ---- Data ------------------------------------------------------------------------------------------

/** The id of the newest `connector_status` event in the feed, 0 when none. */
function newestConnectorEventId(eventLog: readonly { readonly id: number; readonly kind: string }[]): number {
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const e = eventLog[i];
    if (e !== undefined && e.kind === "connector_status") return e.id;
  }
  return 0;
}

/**
 * `GET /connectors`: on mount, again when a `connector_status` event arrives,
 * and again when the feed comes back after an answer that never reached the
 * kernel. The last `ok` answer is kept until a newer `ok` one lands; an answer
 * older than the latest request is dropped.
 */
function useGithubConnectors(api: StudioBridge, eventId: number, live: boolean): { readonly read: ConnectorsRead; readonly refetch: () => void } {
  const [read, setRead] = useState<ConnectorsRead>({ latest: undefined, lastOk: undefined });
  const generation = useRef(0);

  const refetch = useCallback(() => {
    generation.current += 1;
    const mine = generation.current;
    void readConnectors(api).then((reply: Reply<ConnectorsResponse>) => {
      if (generation.current !== mine) return;
      setRead((prev) => ({ latest: reply, lastOk: reply.kind === "ok" ? reply.body : prev.lastOk }));
    });
  }, [api]);

  useEffect(() => {
    refetch();
    return () => {
      // The answer in flight is dropped once the screen unmounts.
      generation.current += 1;
    };
  }, [refetch]);

  useEffect(() => {
    if (eventId === 0) return;
    const timer = window.setTimeout(refetch, REFETCH_THROTTLE_MS);
    return () => window.clearTimeout(timer);
  }, [eventId, refetch]);

  // "It may be restarting; this window reconnects on its own": so the screen asks again once the feed is live.
  const unanswered = read.latest !== undefined && (read.latest.kind === "unreachable" || read.latest.kind === "failed");
  useEffect(() => {
    if (live && unanswered) refetch();
  }, [live, unanswered, refetch]);

  return { read, refetch };
}

// ---- Panes ------------------------------------------------------------------------------------------------

interface ListPaneProps {
  readonly view: View;
  readonly connecting: boolean;
  readonly now: Date;
  readonly rowRef: Ref<HTMLButtonElement>;
  /** The App setup dialog is open: its words replace the row's. */
  readonly setup: AppSetupPhase | undefined;
  /** The dialog runs over a token in use: the row keeps the token's words and adds the setup's. */
  readonly switching: boolean;
}

/** The list pane: the one connector, with its dot and words. */
function ListPane({ view, connecting, now, rowRef, setup, switching }: ListPaneProps) {
  const meta = setup === undefined ? rowMeta(view, connecting, now) : switching ? switchRowMeta(setup, rowMeta(view, false, now)) : appRowMeta(setup);
  return (
    <div className="integrations-list" data-testid={IDS.list}>
      <div role="listbox" aria-label="Connectors">
        <button ref={rowRef} type="button" role="option" aria-selected="true" className="integrations-row" data-testid={IDS.listRow}>
          <span className="integrations-dot" data-state={meta.dot} data-testid={IDS.listDot} aria-hidden="true" />
          <span className="integrations-row-text">
            <span className="integrations-row-title">
              <GitHubMark />
              GitHub
            </span>
            <span className="integrations-cap" data-testid={IDS.listMeta}>
              {meta.text}
            </span>
          </span>
        </button>
      </div>
      <p className="integrations-cap integrations-more">More connectors come later. Studio works with none connected.</p>
    </div>
  );
}

function EmptyDetail({ offline, onConnect }: { readonly offline: boolean; readonly onConnect: () => void }) {
  return (
    <div className="integrations-detail" data-testid={IDS.detail} data-state="none">
      <div className="integrations-empty" data-testid={IDS.empty}>
        <h2>Connect GitHub so a playbook can read your PRs.</h2>
        <p>Studio works with no connectors. GitHub is read-only here: a GitHub App you install or a token you create, limited to the personal repos you choose, kept in the Keychain.</p>
        <Button variant="primary" disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={onConnect} data-testid={IDS.emptyConnect}>
          Connect GitHub
        </Button>
      </div>
    </div>
  );
}

function UnknownDetail({ loading }: { readonly loading: boolean }) {
  if (loading) {
    return (
      <div className="integrations-detail" data-testid={IDS.loading} aria-busy="true">
        <p className="integrations-sr-only" role="status">
          Reading the connectors…
        </p>
        <span className="integrations-skel integrations-skel-title" aria-hidden="true" />
        <span className="integrations-skel" aria-hidden="true" />
        <span className="integrations-skel integrations-skel-short" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="integrations-detail" data-state="unknown">
      <div className="integrations-empty">
        <h2>Status unknown</h2>
        <p>Studio can't tell whether GitHub is connected until the kernel answers.</p>
      </div>
    </div>
  );
}

interface RepoList {
  readonly repos: readonly string[];
  /** When GitHub was last read for them. */
  readonly verifiedAt: string | null;
}

interface TokenDetailProps {
  readonly view: View;
  readonly row: Connector;
  readonly repos: RepoList;
  readonly roster: readonly RosterEntry[] | undefined;
  readonly rosterError: boolean;
  readonly refreshing: boolean;
  readonly now: Date;
  readonly onReplace: () => void;
  readonly onSwitch: () => void;
  readonly onDisconnect: () => void;
  readonly onRefresh: () => void;
}

function TokenDetail({ view, row, repos, roster, rosterError, refreshing, now, onReplace, onSwitch, onDisconnect, onRefresh }: TokenDetailProps) {
  const ids = useId();
  const offline = isOffline(view);
  const state = view.state;
  const urgent = state === "expiring" || state === "expired";
  const dis = offline ? { disabled: true, title: "Needs the kernel" } : {};
  const verified = whenText(row.verified_at, now);
  const expiry = expiryOf(row.expires_at, state, now);
  const days = daysLeft(row.expires_at, now);
  const readNote = state === "expired" || offline ? `last read ${verified}` : `read from GitHub ${verified}`;
  const lines = permissionLines(row.permissions);
  // The owner's word, not GitHub's: a fine-grained token's permissions are never reported, so Studio keeps what the owner declared.
  const declared = row.permissions_source === "declared";
  const declaredAt = row.permissions_declared_at === null ? "" : ` ${whenText(row.permissions_declared_at, now)}`;

  return (
    <div className="integrations-detail" aria-label="GitHub" data-testid={IDS.detail} data-state={state}>
      <div className="integrations-dhead" data-testid={IDS.detailHeader}>
        <GitHubMark />
        <h2>GitHub</h2>
        <span className="integrations-badge" data-tone="neutral">
          {declared ? "read-only · declared" : "read-only"}
        </span>
        <div className="integrations-dactions">
          <Button size="row" variant={urgent ? "primary" : "secondary"} onClick={onReplace} data-testid={IDS.replace} {...dis}>
            Replace token
          </Button>
          <Button size="row" variant="secondary" onClick={onSwitch} data-testid={IDS.switchToApp} {...dis}>
            Switch to GitHub App
          </Button>
          <Button size="row" variant="danger" onClick={onDisconnect} data-testid={IDS.disconnect} {...dis}>
            Disconnect
          </Button>
        </div>
      </div>

      {state === "expiring" ? (
        <div className="integrations-inband" data-tone="attention" role="status" data-testid={IDS.inBand}>
          <WarnGlyph />
          <span>{`The token expires ${days === undefined ? "soon" : `in ${days} ${days === 1 ? "day" : "days"}`}, on ${expiry.date}. Replace it before then, or playbooks that need GitHub park.`}</span>
        </div>
      ) : null}
      {state === "expired" ? (
        <div className="integrations-inband" data-tone="danger" role="alert" data-testid={IDS.inBand}>
          <WarnGlyph />
          <span>{`${row.expires_at === null ? "The token has expired." : `The token expired on ${expiry.date}.`} Replace the token to resume playbooks that need GitHub.`}</span>
        </div>
      ) : null}

      <dl className="integrations-kv">
        <dt>Status</dt>
        <dd data-testid={IDS.status}>
          {offline ? (
            <span className="integrations-cap">{`Unknown while the kernel is unreachable · last ${declared ? "checked" : "verified"} ${verified}`}</span>
          ) : (
            <>
              <span className="integrations-dot" data-state={state === "connected" ? "ok" : state === "expiring" ? "waiting" : "danger"} aria-hidden="true" />
              {state}
              <span className="integrations-cap">{`${state === "expired" ? "checked" : declared ? "account and repos checked" : "verified"} ${verified}`}</span>
            </>
          )}
        </dd>
        <dt>Account</dt>
        <dd>
          <span className="integrations-mono" data-testid={IDS.account}>
            {row.account_login ?? "unknown"}
          </span>
        </dd>
        <dt>Token</dt>
        <dd>
          Kept in the Keychain as <span className="integrations-mono">loomwright-studio-github</span>
        </dd>
        <dt>Expires</dt>
        <dd data-testid={IDS.expires}>
          {expiry.left === undefined ? expiry.date : `${expiry.date} · ${expiry.left}`}
          {expiry.badge === undefined ? null : (
            <span className="integrations-badge" data-tone={expiry.badge === "expired" ? "danger" : "attention"}>
              {expiry.badge}
            </span>
          )}
        </dd>
      </dl>

      <section className="integrations-sec" aria-labelledby={`${ids}-perm`}>
        <div className="integrations-sech">
          <h3 className="integrations-label" id={`${ids}-perm`}>
            Permissions
          </h3>
          <span className="integrations-cap">{declared ? `declared by you${declaredAt}` : readNote}</span>
        </div>
        {declared ? (
          <>
            <p>
              <b>Read-only</b>, declared by you.
            </p>
            <p className="integrations-cap">
              GitHub doesn't report what a fine-grained token can do, so Studio keeps this as your word, not as something it checked. If you gave the token more than Read, change it on GitHub and replace it here.
            </p>
          </>
        ) : lines.length === 0 ? (
          <p className="integrations-cap">No permissions reported.</p>
        ) : (
          <ul className="integrations-perm" data-testid={IDS.permissions}>
            {lines.map((p) => (
              <li key={p.label}>
                <CheckGlyph />
                <b>{p.label}</b>
                <span className="integrations-level">{p.level}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="integrations-sec" aria-labelledby={`${ids}-repos`}>
        <div className="integrations-sech">
          <h3 className="integrations-label" id={`${ids}-repos`} data-testid={IDS.reposHeading}>
            {`Reachable repos · ${repos.repos.length}`}
          </h3>
          <span className="integrations-cap">{state === "expired" || offline ? `last read ${whenText(repos.verifiedAt, now)}` : `read from GitHub ${whenText(repos.verifiedAt, now)}`}</span>
          <span className="integrations-spacer" />
          <Button size="row" variant="ghost" icon={<RefreshGlyph />} loading={refreshing} onClick={onRefresh} data-testid={IDS.refresh} {...dis}>
            Refresh
          </Button>
        </div>
        {repos.repos.length === 0 ? (
          <p className="integrations-cap">No repos reachable with this token.</p>
        ) : (
          <ul className="integrations-box" data-testid={IDS.repos}>
            {repos.repos.map((name) => (
              <li key={name}>
                <RepoGlyph />
                <span className="integrations-mono">{name}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="integrations-cap">A poll trigger can name only these repos. Change the set on GitHub, then Refresh.</p>
      </section>

      <GrantSection roster={roster} rosterError={rosterError} />
    </div>
  );
}

// ---- The screen -----------------------------------------------------------------------------------------

export interface IntegrationsViewProps {
  readonly api: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

interface Notice {
  readonly text: string;
}

interface RepoOverride extends RepoList {
  /** The connectors answer this list was read after: a newer answer replaces it. */
  readonly basis: ConnectorsRead["latest"];
}

const TOKEN_PENDING = "GitHub is still checking the last token. Try again once it answers.";

/** What is open of the Connect sheet: its mode, and whether it starts on the choice between the App and a token. */
interface SheetState {
  readonly mode: SheetMode;
  readonly choice: boolean;
}

/** One run of the App setup dialog; a new `key` mounts a fresh dialog, which makes a new setup call. */
interface AppRun {
  readonly key: number;
  /** The run started while a token was in use (the switch): the dialog's words say the token stays connected. */
  readonly overToken: boolean;
}

export function IntegrationsView({ api, registry = commandRegistry }: IntegrationsViewProps) {
  const { connection, eventLog } = useLiveStore(api);
  const { read, refetch } = useGithubConnectors(api, newestConnectorEventId(eventLog), connection.state === "live");
  const agents = useResource("agents", api);
  const view = viewOf(read);
  const now = new Date();
  const offline = isOffline(view);
  const tokenInUse = hasToken(view);
  const appInUse = isAppConnection(view);
  const switchable = switchToApp(view);

  const [sheet, setSheet] = useState<SheetState | undefined>(undefined);
  const [app, setApp] = useState<AppRun | undefined>(undefined);
  const [appPhase, setAppPhase] = useState<AppSetupPhase | undefined>(undefined);
  const appRuns = useRef(0);
  // Where focus goes when the App dialog closes: the control that opened the choice (the dialog replaces it, so its own return has nothing).
  const opener = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [override, setOverride] = useState<RepoOverride | undefined>(undefined);
  const rowRef = useRef<HTMLButtonElement>(null);
  const disconnecting = useRef(false);
  // A token check is out and unanswered. It outlives the sheet (Cancel does not stop the kernel), so a second sheet
  // cannot send a second token while the first is pending: the older answer could land last and win.
  const checkingToken = useRef(false);
  const refreshingNow = useRef(false);
  const latestRead = useRef(read);
  latestRead.current = read;

  // Where focus goes once the designed state has changed after a connect or a disconnect: the opener (the Connect
  // GitHub or Disconnect button) is gone by then, and focus must not fall to the page.
  const settleFrom = useRef<View["state"] | undefined>(undefined);
  useEffect(() => {
    const from = settleFrom.current;
    if (from === undefined || from === view.state) return;
    settleFrom.current = undefined;
    const active = document.activeElement;
    if (active === null || active === document.body) rowRef.current?.focus();
  });

  // A confirm is left through Cancel or Escape (the mockup's Esc chip). Dialog's own confirm kind ignores Escape, so
  // this listener (capture phase, ahead of Dialog's) closes it.
  useEffect(() => {
    if (!confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setConfirming(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [confirming]);

  // The token went away while the confirm was open (disconnected elsewhere): there is nothing left to confirm.
  useEffect(() => {
    if (confirming && !tokenInUse) setConfirming(false);
  }, [confirming, tokenInUse]);

  const rememberOpener = () => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  };

  /** Opens the Connect sheet: on the choice when nothing is connected, on the token form to replace one. */
  const openSheet = (mode: SheetMode) => {
    if (offline) return;
    if (checkingToken.current) {
      setNotice({ text: TOKEN_PENDING });
      return;
    }
    if (disconnecting.current || app !== undefined) return;
    if (sheet === undefined) rememberOpener();
    setConfirming(false);
    setNotice(undefined);
    setSheet((open) => open ?? { mode, choice: mode === "connect" });
  };
  // One connection at a time: with an App connected, Connect GitHub waits for a disconnect.
  const connectHandler = () => {
    if (appInUse) return;
    openSheet(tokenInUse ? "replace" : "connect");
  };

  /** Starts a fresh App setup (the choice's "Install GitHub App", "Set up again"). It never runs over another sheet or the confirm. */
  const startApp = () => {
    if (offline) return;
    if (checkingToken.current) {
      setNotice({ text: TOKEN_PENDING });
      return;
    }
    if (disconnecting.current) return;
    if (sheet === undefined && app === undefined) rememberOpener();
    setConfirming(false);
    setNotice(undefined);
    setSheet(undefined);
    appRuns.current += 1;
    // The row's words start with the dialog's first phase; the dialog reports each change after it.
    setAppPhase({ kind: "starting" });
    // A setup started while a token is in use is the switch (also "Set up again" from one): it never touches the token.
    setApp({ key: appRuns.current, overToken: switchable });
  };

  /** "Switch to GitHub App": the setup dialog over the token in use. Not over another App dialog, and never a disconnect. */
  const switchHandler = () => {
    if (!switchable || offline || app !== undefined) return;
    startApp();
  };

  const closeApp = () => {
    setApp(undefined);
    setAppPhase(undefined);
  };

  /** "Paste a token instead": the token form, over nothing. */
  const pasteToken = () => {
    closeApp();
    if (offline) return;
    setSheet({ mode: "connect", choice: false });
  };

  // The last sheet or dialog is gone: focus goes back to what opened it, else the connector's row, unless something took it already.
  // (The App dialog replaces the control that opened it, so it has no return of its own.)
  const overlayOpen = app !== undefined || sheet !== undefined;
  const wasOverlayOpen = useRef(false);
  useEffect(() => {
    if (overlayOpen) {
      wasOverlayOpen.current = true;
      return;
    }
    if (!wasOverlayOpen.current) return;
    wasOverlayOpen.current = false;
    const back = opener.current;
    opener.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    (back?.isConnected === true ? back : rowRef.current)?.focus();
  }, [overlayOpen]);

  // The connector became an App connection while the dialog was open: the setup is done, and the detail pane says so.
  const appConnected = appInUse && (view.state === "connected" || view.state === "expiring");
  // The dialog's copy follows the token: if it is gone (disconnected elsewhere) the words are the no-token ones again.
  const switching = app !== undefined && app.overToken && view.state !== "none";
  useEffect(() => {
    if (app !== undefined && appConnected) closeApp();
  }, [app, appConnected]);

  const requestDisconnect = () => {
    if (!tokenInUse || offline || app !== undefined) return;
    if (checkingToken.current) {
      setNotice({ text: TOKEN_PENDING });
      return;
    }
    setSheet(undefined);
    setNotice(undefined);
    setConfirming(true);
  };

  const confirmDisconnect = async () => {
    if (disconnecting.current) return;
    disconnecting.current = true;
    const reply = await disconnectGithub(api);
    disconnecting.current = false;
    setConfirming(false);
    if (reply.kind === "ok") {
      settleFrom.current = view.state;
      refetch();
    } else {
      setNotice({ text: `Couldn't disconnect GitHub: ${replyText(reply)}` });
    }
  };

  const refreshRepos = async () => {
    if (offline || refreshingNow.current) return;
    refreshingNow.current = true;
    setRefreshing(true);
    setNotice(undefined);
    const reply = await fetchRepos(api, true);
    refreshingNow.current = false;
    setRefreshing(false);
    if (reply.kind === "ok") setOverride({ repos: reply.body.repos, verifiedAt: reply.body.verified_at, basis: latestRead.current.latest });
    else setNotice({ text: `Couldn't refresh the repos: ${replyText(reply)}` });
  };

  useIntegrationsCommands(
    registry,
    { offline, hasToken: tokenInUse, appConnected: appInUse },
    { connect: connectHandler, disconnect: requestDisconnect, refreshRepos, switchToApp: switchHandler },
  );

  const row = view.row;
  // The refreshed repos stand until a newer connectors answer lands (which carries the kernel's own copy).
  const repos: RepoList = override !== undefined && override.basis === read.latest ? override : { repos: row?.reachable_repos ?? [], verifiedAt: row?.verified_at ?? null };
  const roster = agents?.data?.agents;
  const rosterError = roster === undefined && agents?.error !== undefined;
  const unknownNoData = read.lastOk === undefined && (view.phase === "error" || view.phase === "unreachable");

  let detail: ReactNode;
  if (view.phase === "loading") detail = <UnknownDetail loading />;
  else if (unknownNoData) detail = <UnknownDetail loading={false} />;
  else if (row === undefined) detail = <EmptyDetail offline={offline} onConnect={() => openSheet("connect")} />;
  else if (appInUse)
    detail = (
      <AppDetail
        view={view}
        row={row}
        repos={repos}
        roster={roster}
        rosterError={rosterError}
        refreshing={refreshing}
        now={now}
        onSetUpAgain={startApp}
        onDisconnect={requestDisconnect}
        onRefresh={() => void refreshRepos()}
      />
    );
  else
    detail = (
      <TokenDetail
        view={view}
        row={row}
        repos={repos}
        roster={roster}
        rosterError={rosterError}
        refreshing={refreshing}
        now={now}
        onReplace={() => openSheet("replace")}
        onSwitch={switchHandler}
        onDisconnect={requestDisconnect}
        onRefresh={() => void refreshRepos()}
      />
    );

  return (
    <div className="integrations" data-testid={IDS.screen}>
      <div className="integrations-tbar">
        <span className="integrations-cap" data-testid={IDS.count}>
          1 connector · all optional
        </span>
      </div>
      {offline ? (
        <div className="integrations-band" data-tone="danger" role="alert" data-testid={IDS.band}>
          <WarnGlyph />
          <span>Couldn't reach the kernel. It may be restarting; this window reconnects on its own.</span>
        </div>
      ) : null}
      {view.phase === "error" ? (
        <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.readError}>
          {`Couldn't read the connectors: ${view.message ?? "no answer"}`}
        </p>
      ) : null}
      {notice === undefined ? null : (
        <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.notice}>
          {notice.text}
        </p>
      )}
      <div className="integrations-split">
        <ListPane view={view} connecting={connecting} now={now} rowRef={rowRef} setup={app === undefined || appConnected ? undefined : appPhase} switching={switching} />
        {detail}
      </div>
      {sheet === undefined ? null : (
        <ConnectSheet
          api={api}
          mode={sheet.mode}
          choice={sheet.choice}
          offline={offline}
          onChooseApp={startApp}
          expired={view.state === "expired"}
          onClose={() => setSheet(undefined)}
          onConnected={() => {
            settleFrom.current = view.state;
            setOverride(undefined);
            refetch();
          }}
          onBusyChange={setConnecting}
          inFlight={checkingToken}
          onSettled={() => setNotice((current) => (current?.text === TOKEN_PENDING ? undefined : current))}
        />
      )}
      {app === undefined ? null : (
        <AppSetupSheet
          key={app.key}
          api={api}
          events={eventLog}
          connector={githubRow(read.lastOk)}
          onClose={closeApp}
          onSetUpAgain={startApp}
          onPasteToken={pasteToken}
          onPhaseChange={setAppPhase}
          overToken={switching}
        />
      )}
      {confirming && appInUse ? (
        <Dialog
          kind="confirm"
          wide
          title="Disconnect GitHub?"
          description={`Deletes the App's key from the Keychain. ${view.state === "revoked" ? "Playbooks that need GitHub are already parked, and stay parked until you connect again." : "Playbooks that need GitHub park until you connect again."} Agents keep their grant.`}
          action={{ label: "Disconnect", onAction: () => void confirmDisconnect() }}
          cancelLabel="Cancel"
          onCancel={() => setConfirming(false)}
        >
          <p className="integrations-flush" data-testid={IDS.appConfirm}>Studio can&apos;t remove the App from GitHub. That part stays yours:</p>
          <ul className="integrations-steps">
            <li>
              <b>Uninstall</b> it, to end its access to your repos.
            </li>
            <li>
              <b>Delete</b> it, to remove the App itself.
            </li>
          </ul>
          <div className="integrations-links">
            <ExternalLink api={api} url={INSTALLATIONS_URL} testId={IDS.appConfirmInstalled}>
              Open Installed GitHub Apps
            </ExternalLink>
            <AppsPageLink api={api} slug={slugOf(row?.app_slug)} testId={IDS.appConfirmApps} />
          </div>
        </Dialog>
      ) : null}
      {confirming && !appInUse ? (
        <Dialog
          kind="confirm"
          title="Disconnect GitHub?"
          description={`Deletes the token from the Keychain. ${view.state === "expired" ? "Playbooks that need GitHub are already parked, and stay parked until you connect again." : "Playbooks that need GitHub park until you connect again."} Agents keep their grant.`}
          action={{ label: "Disconnect", onAction: () => void confirmDisconnect() }}
          cancelLabel="Cancel"
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
