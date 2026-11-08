// Jira and ClickUp (phase 8, MCP connect): the mockup's `cnPane` states (`docs/design/mockups/phase-8.html`) for one
// kind: not connected (Connect), connecting (the wait, with the window's close time, and Cancel), connected (the
// workspace, the tools and which crew member is granted each, a pointer to Team), `expired`, refused (each ending with its
// own copy), and Disconnect behind a confirm. Jira always carries the "Work account · stub only" note.
//
// The flow is the GitHub App setup's (`AppSetupSheet.tsx`): one `POST /connectors/mcp/:kind/connect` guarded by a run
// object, the returned `authorize_url` opened through the open-external channel (the window never navigates, and a `false`
// answer is a refusal, never a silent no-op), a cancel that sends one `POST …/connect/cancel`, and a cancel on unmount so
// the kernel's one window is never left open. The app learns of success only from a `connector_status` event followed by a
// `GET /connectors` re-read that shows the row `connected`; nothing here marks a connection locally. The kernel's window is
// single (`connect_in_progress`), so one `useMcpConnect` lives in the screen and survives switching between the panes.
//
// Every string from the kernel or the vendor (the workspace address, tool names, a refusal's code and `message`) is untrusted
// data: a React text child, never markup. The crew grant per tool is read from each crew member's `GET /agents/:id`
// (`settings.content.connectors[<kind>]`); Wright has no detail route, so its per-tool grant reads "unknown".
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { AgentDetailResponse, EventFrame, McpConnection, McpConnectionKind, RosterEntry, StudioBridge, TruncatedEventFrame } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { orderRoster } from "../team/model";
import { cancelMcp, connectMcp, disconnectMcp, openExternalUrl, readAgent } from "./actions";
import { MAX_TIMER_MS, closesAtText, msUntil } from "./app-setup";
import {
  INTEGRATIONS_TEST_IDS as IDS,
  MCP_VENDORS,
  type McpRefusal,
  type McpRefusalView,
  type Phase,
  mcpKeychainItem,
  mcpRefusalCopy,
  mcpRefusalOfEvent,
  mcpRefusalOfReply,
  mcpRowOf,
  mcpStateOf,
  needsToolRead,
  replyText,
  toolCell,
  whenText,
} from "./model";
import { CheckGlyph, ExternalGlyph, WarnGlyph } from "./parts";
import "./integrations.css";

// ---- The connect, kept by the screen ----------------------------------------------------------------

/** Where an attempt is: the connect call is out, the vendor's page is open and waited on, or it ended refused. */
export type McpPhase =
  | { readonly kind: "starting" }
  | { readonly kind: "waiting"; readonly expiresAt: string | undefined }
  | ({ readonly kind: "refused" } & McpRefusalView);

export interface McpAttempt {
  readonly kind: McpConnectionKind;
  readonly phase: McpPhase;
}

export interface McpController {
  /** The attempt in progress or just ended; `undefined` when there is none. */
  readonly attempt: McpAttempt | undefined;
  /** Press Connect for `kind`: one connect call, then the vendor's page. Does nothing while an attempt runs or the kind is connected. */
  readonly connect: (kind: McpConnectionKind) => void;
  /** Cancel the attempt: one `…/connect/cancel` call once a window is open. */
  readonly cancel: () => void;
  /** "Open <vendor> again": the same `authorize_url`, with no second connect call. */
  readonly reopen: () => void;
  /** Leave a refused attempt. */
  readonly dismiss: () => void;
}

/** One press of Connect. The object, not shared refs, so a late answer of an older run can never touch a newer one. */
interface Run {
  readonly kind: McpConnectionKind;
  /** The connect call was answered ok: the kernel has a window open until it is cancelled or closes. */
  opened: boolean;
  cancelWanted: boolean;
  cancelSent: boolean;
  /** The screen went away: a window opened by the late answer is cancelled. */
  abandoned: boolean;
  url: string | undefined;
}

const NOT_OPENED: McpRefusalView = { refusal: { kind: "not_opened" }, message: undefined };

function newestId(events: readonly { readonly id: number }[]): number {
  const last = events[events.length - 1];
  return last === undefined ? 0 : last.id;
}

const inProgress = (attempt: McpAttempt | undefined): boolean => attempt !== undefined && (attempt.phase.kind === "starting" || attempt.phase.kind === "waiting");

export function useMcpConnect(api: StudioBridge, events: readonly (EventFrame | TruncatedEventFrame)[], rows: readonly McpConnection[]): McpController {
  const [attempt, setAttemptState] = useState<McpAttempt | undefined>(undefined);
  const attemptRef = useRef<McpAttempt | undefined>(undefined);
  const runRef = useRef<Run | undefined>(undefined);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  // Events at or before this id were there before the attempt began.
  const seen = useRef(newestId(events));

  const setAttempt = useCallback((next: McpAttempt | undefined) => {
    attemptRef.current = next;
    setAttemptState(next);
  }, []);

  const sendCancel = useCallback(
    async (run: Run) => {
      if (run.cancelSent) return;
      run.cancelSent = true;
      await cancelMcp(api, run.kind);
    },
    [api],
  );

  /** Ends the run in the refused view, unless it was cancelled or is no longer the current one. */
  const refuse = useCallback(
    (run: Run, view: McpRefusalView) => {
      if (runRef.current !== run || run.cancelWanted) return;
      setAttempt({ kind: run.kind, phase: { kind: "refused", ...view } });
    },
    [setAttempt],
  );

  const connect = useCallback(
    (kind: McpConnectionKind) => {
      if (inProgress(attemptRef.current)) return;
      if (mcpStateOf(mcpRowOf(rowsRef.current, kind)) === "connected") return;
      const run: Run = { kind, opened: false, cancelWanted: false, cancelSent: false, abandoned: false, url: undefined };
      runRef.current = run;
      seen.current = newestId(eventsRef.current);
      setAttempt({ kind, phase: { kind: "starting" } });
      void (async () => {
        const reply = await connectMcp(api, kind);
        if (reply.kind === "ok") run.opened = true;
        // Cancelled (or the screen went away) while the call was out: the window that just opened is closed again, and nothing is opened.
        if (run.cancelWanted || run.abandoned) {
          if (run.opened) void sendCancel(run);
          return;
        }
        if (reply.kind !== "ok") {
          refuse(run, mcpRefusalOfReply(reply));
          return;
        }
        const url: unknown = reply.body.authorize_url;
        if (typeof url !== "string" || url === "") {
          void sendCancel(run);
          refuse(run, NOT_OPENED);
          return;
        }
        run.url = url;
        const expiresAt: unknown = reply.body.expires_at;
        setAttempt({ kind, phase: { kind: "waiting", expiresAt: typeof expiresAt === "string" ? expiresAt : undefined } });
        const shown = await openExternalUrl(api, url);
        if (!shown) {
          // The channel refused the address (or could not open it): never a silent no-op, and the window is not left open.
          void sendCancel(run);
          refuse(run, NOT_OPENED);
        }
      })();
    },
    [api, refuse, sendCancel, setAttempt],
  );

  const cancel = useCallback(() => {
    const run = runRef.current;
    if (run === undefined || !inProgress(attemptRef.current)) return;
    run.cancelWanted = true;
    setAttempt(undefined);
    // Before the connect call is answered there is nothing to cancel yet: the answer's handler cancels the window it opened.
    if (run.opened) void sendCancel(run);
  }, [sendCancel, setAttempt]);

  const reopen = useCallback(() => {
    const run = runRef.current;
    if (run === undefined || run.url === undefined || attemptRef.current?.phase.kind !== "waiting") return;
    void openExternalUrl(api, run.url).then((shown) => {
      if (shown) return;
      void sendCancel(run);
      refuse(run, NOT_OPENED);
    });
  }, [api, refuse, sendCancel]);

  const dismiss = useCallback(() => {
    if (attemptRef.current?.phase.kind === "refused") setAttempt(undefined);
  }, [setAttempt]);

  // The feed: events newer than the attempt. A refusal of this kind ends a window that is waiting. Success is not read from
  // an event: it is the connectors read that follows one, below.
  useEffect(() => {
    if (newestId(events) < seen.current) seen.current = 0;
    for (const event of events) {
      if (event.id <= seen.current) continue;
      seen.current = event.id;
      const current = attemptRef.current;
      const run = runRef.current;
      if (event.kind !== "connector_status" || run === undefined || current === undefined || current.phase.kind !== "waiting") continue;
      const view = "payload" in event ? mcpRefusalOfEvent(event.payload, current.kind) : undefined;
      if (view !== undefined) refuse(run, view);
    }
  }, [events, refuse]);

  // The row now reads connected: the connect is over, and the pane shows the connection.
  const waitingKind = attempt?.phase.kind === "waiting" ? attempt.kind : undefined;
  const waitingConnected = waitingKind !== undefined && mcpStateOf(mcpRowOf(rows, waitingKind)) === "connected";
  useEffect(() => {
    if (waitingConnected) setAttempt(undefined);
  }, [waitingConnected, setAttempt]);

  // The window's clock: once `expires_at` passes, the connect has timed out.
  const expiresAt = attempt?.phase.kind === "waiting" ? attempt.phase.expiresAt : undefined;
  useEffect(() => {
    if (waitingKind === undefined || expiresAt === undefined) return;
    const left = msUntil(expiresAt, Date.now());
    if (left === undefined || left > MAX_TIMER_MS) return;
    const timer = window.setTimeout(() => {
      const run = runRef.current;
      if (run !== undefined) refuse(run, { refusal: { kind: "window_expired" }, message: undefined });
    }, Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [waitingKind, expiresAt, refuse]);

  // A window left open when the screen goes away without finishing is cancelled (a late answer is, by `abandoned`).
  useEffect(
    () => () => {
      const run = runRef.current;
      if (run === undefined) return;
      run.abandoned = true;
      if (run.opened && inProgress(attemptRef.current)) void sendCancel(run);
    },
    [sendCancel],
  );

  return { attempt, connect, cancel, reopen, dismiss };
}

// ---- A confirm is left through Cancel or Escape ----------------------------------------------------------

/**
 * `Dialog`'s confirm kind ignores Escape, but the mockup's confirms carry an Esc chip: this listener (capture phase, ahead of
 * the dialog's) calls `onEscape` while `active`.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active]);
}

// ---- The crew's tools -------------------------------------------------------------------------------------

/**
 * Each crew member's `GET /agents/:id`, for the members that may hold `kind`, read while the kind is connected. A detail
 * that cannot be read stays out of the map: its cells read "unknown", never "not granted".
 */
function useCrewDetails(api: StudioBridge, roster: readonly RosterEntry[] | undefined, kind: McpConnectionKind, active: boolean): ReadonlyMap<string, AgentDetailResponse> {
  const [details, setDetails] = useState<ReadonlyMap<string, AgentDetailResponse>>(() => new Map());
  const generation = useRef(0);
  useEffect(() => {
    if (!active || roster === undefined) return;
    generation.current += 1;
    const mine = generation.current;
    const ids = roster.filter((agent) => needsToolRead(agent, kind)).map((agent) => agent.id);
    void Promise.all(ids.map(async (id) => [id, await readAgent(api, id)] as const)).then((answers) => {
      if (generation.current !== mine) return;
      const next = new Map<string, AgentDetailResponse>();
      for (const [id, reply] of answers) if (reply.kind === "ok") next.set(id, reply.body);
      setDetails(next);
    });
    return () => {
      generation.current += 1;
    };
  }, [api, roster, kind, active]);
  return details;
}

interface ToolsProps {
  readonly kind: McpConnectionKind;
  readonly tools: readonly string[];
  readonly roster: readonly RosterEntry[] | undefined;
  readonly rosterError: boolean;
  readonly details: ReadonlyMap<string, AgentDetailResponse>;
  readonly stale: boolean;
}

/** The tools table (`toolsTable`): the server's tool names, and for each crew member whether it holds the tool. */
function Tools({ kind, tools, roster, rosterError, details, stale }: ToolsProps) {
  const id = useId();
  const { name } = MCP_VENDORS[kind];
  const crew = roster === undefined ? [] : orderRoster(roster);
  return (
    <section className="integrations-sec" aria-labelledby={`${id}-tools`}>
      <div className="integrations-sech">
        <h3 className="integrations-label" id={`${id}-tools`}>{`Tools · ${tools.length}`}</h3>
        <span className="integrations-cap">{stale ? "last listed by the server" : "listed by the server"}</span>
        <span className="integrations-spacer" />
        <a className="integrations-link" href="#/team" data-testid={IDS.mcpTeam}>
          Set grants in Team
        </a>
      </div>
      {tools.length === 0 ? (
        <p className="integrations-cap">The server listed no tools Studio could keep.</p>
      ) : (
        <table className="integrations-table" data-testid={IDS.mcpTools}>
          <caption className="integrations-sr-only">{`${name} tools and the crew member granted each`}</caption>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              {crew.map((agent) => (
                <th scope="col" key={agent.id}>
                  {agent.display_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool} data-testid={IDS.mcpTool} data-tool={tool}>
                <th scope="row">
                  <span className="integrations-mono">{tool}</span>
                </th>
                {crew.map((agent) => {
                  const cell = toolCell(agent, kind, tool, details);
                  return (
                    <td key={agent.id} data-testid={IDS.mcpToolCell} data-agent-id={agent.id} data-state={cell}>
                      {cell === "granted" ? (
                        <span className="integrations-badge" data-tone="ok">
                          <CheckGlyph />
                          Granted
                        </span>
                      ) : (
                        <span className="integrations-cap">{cell === "unknown" ? "Unknown" : "Not granted"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="integrations-cap">
        {roster === undefined ? (rosterError ? "Couldn't read the team. " : "Reading the team… ") : ""}
        Each crew member sees only the tools you grant it. The grant is set per agent in Team, never here. Wright&apos;s per-tool grant is read in Team, not shown here.
      </p>
    </section>
  );
}

// ---- The pane --------------------------------------------------------------------------------------------------

export interface McpConnectProps {
  readonly api: StudioBridge;
  readonly kind: McpConnectionKind;
  /** The kind's `mcp_connections` row from the last good connectors answer; `undefined` when there is none. */
  readonly row: McpConnection | undefined;
  /** The connectors read has an answer to show (the last good one, even while the kernel is unreachable). */
  readonly hasData: boolean;
  /** The connectors read's phase: `loading` before the first answer, `unreachable` and `error` when it failed. */
  readonly phase: Phase;
  readonly offline: boolean;
  readonly now: Date;
  readonly controller: McpController;
  readonly roster: readonly RosterEntry[] | undefined;
  readonly rosterError: boolean;
  /** A write changed the connection: the screen re-reads `GET /connectors`. */
  readonly onChanged: () => void;
}

function Wait({ kind, phase, controller }: { readonly kind: McpConnectionKind; readonly phase: Extract<McpPhase, { kind: "starting" | "waiting" }>; readonly controller: McpController }) {
  const { vendor } = MCP_VENDORS[kind];
  const closes = phase.kind === "waiting" ? closesAtText(phase.expiresAt) : undefined;
  return (
    <section className="integrations-sec" data-testid={IDS.mcpWait} data-phase={phase.kind} data-expires-at={phase.kind === "waiting" ? phase.expiresAt : undefined}>
      <h3 className="integrations-label">{`Waiting for you at ${vendor}`}</h3>
      <p>{`Studio opened ${vendor}'s consent page in your browser. Approve “Loomwright Studio” there. ${vendor} shows you what Studio is asking for, and Studio never sees your ${vendor} password.`}</p>
      <ul className="integrations-box" aria-label="Consent steps">
        <li>
          <span className="integrations-dot" data-state={phase.kind === "starting" ? "working" : "ok"} aria-hidden="true" />
          <span>Studio opens your browser</span>
          <span className="integrations-badge" data-tone={phase.kind === "starting" ? undefined : "ok"}>
            {phase.kind === "starting" ? "opening" : "done"}
          </span>
        </li>
        <li>
          <span className="integrations-dot" data-state={phase.kind === "starting" ? "idle" : "working"} aria-hidden="true" />
          <span>{`Your approval at ${vendor}`}</span>
          <span className="integrations-badge">{phase.kind === "starting" ? "next" : "waiting for you"}</span>
        </li>
        <li>
          <span className="integrations-dot" data-state="idle" aria-hidden="true" />
          <span>Studio keeps the token in the Keychain</span>
          <span className="integrations-badge">next</span>
        </li>
      </ul>
      {closes === undefined ? null : (
        <p className="integrations-cap" data-testid={IDS.mcpWaitCloses}>
          {`This window closes at ${closes}, or when ${vendor} answers.`}
        </p>
      )}
      <p className="integrations-cap" role="status">
        Waiting. Cancel discards this attempt and keeps nothing.
      </p>
      <div className="integrations-actions">
        <Button variant="secondary" onClick={controller.cancel} data-testid={IDS.mcpCancel}>
          Cancel
        </Button>
        <Button variant="secondary" icon={<ExternalGlyph />} disabled={phase.kind === "starting"} onClick={controller.reopen} data-testid={IDS.mcpOpenAgain}>
          {`Open ${vendor} again`}
        </Button>
      </div>
    </section>
  );
}

function Refused({ kind, refusal, message, controller, offline }: { readonly kind: McpConnectionKind; readonly refusal: McpRefusal; readonly message: string | undefined; readonly controller: McpController; readonly offline: boolean }) {
  const copy = mcpRefusalCopy(kind, refusal);
  return (
    <section className="integrations-sec" data-testid={IDS.mcpRefused} data-refusal={refusal.kind === "code" ? refusal.code : refusal.kind}>
      <div className="integrations-refusal" role="alert">
        <p>
          <b>{copy.title}</b>
        </p>
        <p>{copy.text}</p>
        {message === undefined ? null : <p data-testid={IDS.mcpRefusedMessage}>{message}</p>}
      </div>
      <p className="integrations-cap">You can try again. To connect, choose Allow on the page that opens.</p>
      <div className="integrations-actions">
        <Button variant="secondary" onClick={controller.dismiss} data-testid={IDS.mcpDismiss}>
          Close
        </Button>
        <Button variant="primary" disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={() => controller.connect(kind)} data-testid={IDS.mcpRetry}>
          Try again
        </Button>
      </div>
    </section>
  );
}

export function McpConnect({ api, kind, row, hasData, phase, offline, now, controller, roster, rosterError, onChanged }: McpConnectProps) {
  const { name, vendor, revoke } = MCP_VENDORS[kind];
  const state = mcpStateOf(row);
  const attempt = controller.attempt?.kind === kind ? controller.attempt : undefined;
  // The kernel's one window is another kind's: Connect waits for it.
  const busyElsewhere = controller.attempt !== undefined && controller.attempt.kind !== kind && (controller.attempt.phase.kind === "starting" || controller.attempt.phase.kind === "waiting");
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const disconnecting = useRef(false);
  const details = useCrewDetails(api, roster, kind, state !== "none" && hasData);
  useEscape(confirming, () => setConfirming(false));

  // The row went away while the confirm was open (disconnected elsewhere): there is nothing left to confirm.
  useEffect(() => {
    if (confirming && state === "none") setConfirming(false);
  }, [confirming, state]);

  const confirmDisconnect = async () => {
    if (disconnecting.current) return;
    disconnecting.current = true;
    const reply = await disconnectMcp(api, kind);
    disconnecting.current = false;
    setConfirming(false);
    if (reply.kind === "ok") {
      setNotice(undefined);
      onChanged();
    } else {
      setNotice(`Couldn't disconnect ${name}: ${replyText(reply)}`);
    }
  };

  const dis = offline ? { disabled: true, title: "Needs the kernel" } : {};
  const connectDis = offline ? { disabled: true, title: "Needs the kernel" } : busyElsewhere ? { disabled: true, title: "Another connect is open. Finish or cancel it first." } : {};
  const stub =
    kind === "jira" ? (
      <div className="integrations-inband" data-tone="attention" role="note" data-testid={IDS.mcpStub}>
        <WarnGlyph />
        <span>
          <b>Work account · stub only.</b> Jira here is the owner&apos;s work account. Studio is built and tested against a stand-in Atlassian server, and this connection is never exercised live.
        </span>
      </div>
    ) : null;

  let designed: string;
  let body: ReactNode;
  if (!hasData && phase === "loading") {
    designed = "loading";
    body = (
      <div aria-busy="true" data-testid={IDS.loading}>
        <p className="integrations-sr-only" role="status">
          {`Reading ${name}…`}
        </p>
        <span className="integrations-skel integrations-skel-title" aria-hidden="true" />
        <span className="integrations-skel" aria-hidden="true" />
        <span className="integrations-skel integrations-skel-short" aria-hidden="true" />
      </div>
    );
  } else if (!hasData) {
    designed = "unknown";
    body = (
      <div className="integrations-empty">
        <h2>Status unknown</h2>
        <p>{`Studio can't tell whether ${name} is connected until the kernel answers.`}</p>
      </div>
    );
  } else if (attempt !== undefined) {
    designed = attempt.phase.kind === "refused" ? "refused" : "connecting";
    body =
      attempt.phase.kind === "refused" ? (
        <Refused kind={kind} refusal={attempt.phase.refusal} message={attempt.phase.message} controller={controller} offline={offline} />
      ) : (
        <Wait kind={kind} phase={attempt.phase} controller={controller} />
      );
  } else if (state === "none") {
    designed = "none";
    body = (
      <div className="integrations-empty">
        <h2>{`Connect ${name} so a playbook can read your tickets.`}</h2>
        <p>{`Studio works with none. ${name} connects over MCP: you approve Studio at ${vendor} in your browser, the token stays in the Keychain, and each crew member sees only the tools you grant it.${kind === "clickup" ? " This is your personal ClickUp." : ""}`}</p>
        <Button variant="primary" onClick={() => controller.connect(kind)} data-testid={IDS.mcpConnect} {...connectDis}>
          {`Connect ${name}`}
        </Button>
      </div>
    );
  } else {
    const expired = state === "expired";
    designed = state;
    const stale = expired || offline;
    body = (
      <>
        <div className="integrations-dhead">
          <h2>{name}</h2>
          <span className="integrations-badge" data-tone="neutral">
            MCP
          </span>
          {kind === "clickup" ? (
            <span className="integrations-badge" data-tone="neutral">
              personal
            </span>
          ) : null}
          <span className="integrations-spacer" />
          {expired ? (
            <Button size="row" variant="primary" onClick={() => controller.connect(kind)} data-testid={IDS.mcpReconnect} {...connectDis}>
              Reconnect
            </Button>
          ) : null}
          <Button size="row" variant="danger" onClick={() => setConfirming(true)} data-testid={IDS.mcpDisconnect} {...dis}>
            Disconnect
          </Button>
        </div>
        {expired ? (
          <div className="integrations-inband" data-tone="danger" role="alert" data-testid={IDS.mcpExpired}>
            <WarnGlyph />
            <span>{`${vendor} no longer accepts Studio's token: Studio tried to refresh it and failed. Playbooks that read ${name} tickets park. Reconnect to resume.`}</span>
          </div>
        ) : null}
        <dl className="integrations-kv">
          <dt>Status</dt>
          <dd>
            {offline ? (
              <span className="integrations-cap">Unknown while the kernel is unreachable · last read</span>
            ) : (
              <>
                <span className="integrations-dot" data-state={expired ? "danger" : "ok"} aria-hidden="true" />
                {expired ? "expired" : "connected"}
              </>
            )}
          </dd>
          <dt>Workspace</dt>
          <dd>
            <span className="integrations-mono" data-testid={IDS.mcpWorkspace}>
              {row?.server_url ?? "unknown"}
            </span>
          </dd>
          <dt>Tokens</dt>
          <dd>
            <span>
              Kept in the Keychain as <span className="integrations-mono">{mcpKeychainItem(kind)}</span>. The values are never shown.
            </span>
          </dd>
          {row?.token_expiry == null || expired ? null : (
            <>
              <dt>Access token</dt>
              <dd>
                <span>{`expires ${whenText(row.token_expiry, now)}`}</span>
                <span className="integrations-badge" data-tone="neutral">
                  renews automatically
                </span>
              </dd>
            </>
          )}
        </dl>
        <Tools kind={kind} tools={row?.granted_tools ?? []} roster={roster} rosterError={rosterError} details={details} stale={stale} />
      </>
    );
  }

  return (
    <div className="integrations-detail" aria-label={name} data-testid={IDS.mcp} data-kind={kind} data-state={designed}>
      {stub}
      {notice === undefined ? null : (
        <p className="integrations-notice" data-tone="danger" role="alert" data-testid={IDS.mcpNotice}>
          {notice}
        </p>
      )}
      {body}
      {confirming ? (
        <Dialog
          kind="confirm"
          wide
          title={`Disconnect ${name}?`}
          description={`Deletes the tokens from the Keychain and drops every crew grant on them. Playbooks that read ${name} tickets park until you connect again.`}
          action={{ label: "Disconnect", onAction: () => void confirmDisconnect() }}
          cancelLabel="Cancel"
          onCancel={() => setConfirming(false)}
        >
          <p className="integrations-flush" data-testid={IDS.mcpDisconnectConfirm}>
            {`Studio can't remove its access at ${vendor}. That part stays yours:`}
          </p>
          <ul className="integrations-steps">
            <li>{`${revoke}.`}</li>
          </ul>
        </Dialog>
      ) : null}
    </div>
  );
}
