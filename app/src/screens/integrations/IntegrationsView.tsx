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
// Every string from the kernel or GitHub (account, permission names, repo
// names, refusals) is untrusted data: a React text child, never markup.
import { type ReactNode, type Ref, useCallback, useEffect, useId, useRef, useState } from "react";
import type { Connector, ConnectorsResponse, RosterEntry, StudioBridge } from "../../api/contract";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Avatar } from "../../components/Avatar/Avatar";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { useLiveStore, useResource } from "../../store/react";
import { REFETCH_THROTTLE_MS } from "../../store/store";
import { memberHash } from "../team/model";
import { disconnectGithub, fetchRepos, readConnectors } from "./actions";
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
  grantedAgents,
  hasToken,
  isOffline,
  permissionLines,
  replyText,
  rowMeta,
  ungrantedNote,
  viewOf,
  whenText,
} from "./model";
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

// ---- Small marks ---------------------------------------------------------------------------------------

function GitHubMark() {
  return (
    <svg className="integrations-mark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="integrations-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const WarnGlyph = () => (
  <Glyph>
    <path d="M12 8v5M12 16h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3Z" />
  </Glyph>
);
const CheckGlyph = () => (
  <Glyph>
    <path d="m5 12 5 5L20 7" />
  </Glyph>
);
const RepoGlyph = () => (
  <Glyph>
    <path d="M4 19.5V5a2 2 0 0 1 2-2h14v14H6.5a2.5 2.5 0 0 0 0 5H20" />
  </Glyph>
);
const RefreshGlyph = () => (
  <Glyph>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" />
  </Glyph>
);

// ---- Panes ------------------------------------------------------------------------------------------------

interface ListPaneProps {
  readonly view: View;
  readonly connecting: boolean;
  readonly now: Date;
  readonly rowRef: Ref<HTMLButtonElement>;
}

/** The list pane: the one connector, with its dot and words. */
function ListPane({ view, connecting, now, rowRef }: ListPaneProps) {
  const meta = rowMeta(view, connecting, now);
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
        <p>Studio works with no connectors. GitHub is read-only here: a token you create, limited to the personal repos you choose, kept in the Keychain.</p>
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
  readonly onDisconnect: () => void;
  readonly onRefresh: () => void;
}

function TokenDetail({ view, row, repos, roster, rosterError, refreshing, now, onReplace, onDisconnect, onRefresh }: TokenDetailProps) {
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
  const granted = roster === undefined ? undefined : grantedAgents(roster);
  const others = roster === undefined ? undefined : ungrantedNote(roster);

  return (
    <div className="integrations-detail" aria-label="GitHub" data-testid={IDS.detail} data-state={state}>
      <div className="integrations-dhead" data-testid={IDS.detailHeader}>
        <GitHubMark />
        <h2>GitHub</h2>
        <span className="integrations-badge" data-tone="neutral">
          read-only
        </span>
        <span className="integrations-spacer" />
        <Button size="row" variant={urgent ? "primary" : "secondary"} onClick={onReplace} data-testid={IDS.replace} {...dis}>
          Replace token
        </Button>
        <Button size="row" variant="danger" onClick={onDisconnect} data-testid={IDS.disconnect} {...dis}>
          Disconnect
        </Button>
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
            <span className="integrations-cap">{`Unknown while the kernel is unreachable · last verified ${verified}`}</span>
          ) : (
            <>
              <span className="integrations-dot" data-state={state === "connected" ? "ok" : state === "expiring" ? "waiting" : "danger"} aria-hidden="true" />
              {state}
              <span className="integrations-cap">{`${state === "expired" ? "checked" : "verified"} ${verified}`}</span>
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
          <span className="integrations-cap">{readNote}</span>
        </div>
        {lines.length === 0 ? (
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

      <section className="integrations-sec" aria-labelledby={`${ids}-grant`}>
        <div className="integrations-sech">
          <h3 className="integrations-label" id={`${ids}-grant`}>
            {granted === undefined ? "Agents with the GitHub grant" : `Agents with the GitHub grant · ${granted.length}`}
          </h3>
        </div>
        {granted === undefined ? (
          <p className="integrations-cap" data-testid={IDS.agentsNote}>
            {rosterError ? "Couldn't read the team." : "Reading the team…"}
          </p>
        ) : (
          <>
            {granted.length === 0 ? null : (
              <div className="integrations-cards" data-testid={IDS.agents}>
                {granted.map((agent) => (
                  <a key={agent.id} className="integrations-agent" href={memberHash(agent.id)} data-testid={IDS.agentCard} data-agent-id={agent.id}>
                    <Avatar agent={{ id: agent.id, name: agent.display_name, shape: agent.avatar.shape, hue: agent.avatar.hue }} state="idle" size={36} />
                    <span className="integrations-agent-text">
                      <span className="integrations-agent-name">{agent.display_name}</span>
                      <span className="integrations-cap">{agent.model ?? "model not reported"}</span>
                    </span>
                  </a>
                ))}
              </div>
            )}
            <p className="integrations-cap" data-testid={IDS.agentsNote}>
              {`${granted.length === 0 ? "No agent has it. " : others === undefined ? "" : `${others} `}The grant is set per agent in Team.`}
            </p>
          </>
        )}
      </section>
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

export function IntegrationsView({ api, registry = commandRegistry }: IntegrationsViewProps) {
  const { connection, eventLog } = useLiveStore(api);
  const { read, refetch } = useGithubConnectors(api, newestConnectorEventId(eventLog), connection.state === "live");
  const agents = useResource("agents", api);
  const view = viewOf(read);
  const now = new Date();
  const offline = isOffline(view);
  const tokenInUse = hasToken(view);

  const [sheet, setSheet] = useState<SheetMode | undefined>(undefined);
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

  const openSheet = (mode: SheetMode) => {
    if (offline) return;
    if (checkingToken.current) {
      setNotice({ text: TOKEN_PENDING });
      return;
    }
    if (disconnecting.current) return;
    setConfirming(false);
    setNotice(undefined);
    setSheet((open) => open ?? mode);
  };
  const connectHandler = () => openSheet(tokenInUse ? "replace" : "connect");

  const requestDisconnect = () => {
    if (!tokenInUse || offline) return;
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
    { offline, hasToken: tokenInUse, canRefresh: view.state === "connected" || view.state === "expiring" },
    { connect: connectHandler, disconnect: requestDisconnect, refreshRepos },
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
        <ListPane view={view} connecting={connecting} now={now} rowRef={rowRef} />
        {detail}
      </div>
      {sheet === undefined ? null : (
        <ConnectSheet
          api={api}
          mode={sheet}
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
      {confirming ? (
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
