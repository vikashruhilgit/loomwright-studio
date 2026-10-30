// Playbooks (phase 7 item 04): every playbook, its policy with who set each value,
// its runs and versions, and per-field edits, built to the approved GUI v2 mockup
// (`docs/design/mockups/gui-v2.html`, the Playbooks views).
//
// Data: the live store's `playbooks`, `triggers` and `approvals` resources, plus two
// screen-local reads (`./useHistory.ts`): each playbook's newest run for the list, and
// the open playbook's runs and versions. No resource is added to the store. A feed
// event of a kind this screen shows (`playbook_*`, `session_*`, `event_*`) refreshes
// them in place: every read keeps the last answer until a newer one lands, so rows keep
// their size and no spinner replaces loaded content.
//
// Writes: Turn off (`POST /playbooks/:id/off`), Run now (`/run`) and one field per Set
// (`/set`), each through one in-flight guard and `chat/model`'s `write`, whose refusal
// text is the kernel's own words. Nothing shown changes until the kernel answers (no
// optimistic update). There is NO route here that turns a playbook on: the switch in
// the off position only reveals the held `kernel_playbook_enable` approval and links to
// it (invariant 3). "Edit in English" hands a line to Wright's composer and sends nothing.
//
// Every string from the kernel (name, intent, slug, item_ref, a refusal's message) is
// untrusted data: a React text child, never markup.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PlaybookChangeResponse, PlaybookListing, PlaybookRunResponse, StudioBridge, Trigger } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import { isComposingKey, isEditableTarget } from "../../commands/keyboard";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import type { KernelPolicyField } from "../../components/PlaybookPolicy/PlaybookPolicy";
import { liveStoreFor, useLiveStore, useResource } from "../../store/react";
import { handOffComposerText } from "../chat/handoff";
import { WRIGHT, inFlightGuard, navigate, requestComposerFocus, threadHash, when, write } from "../chat/model";
import type { InFlightGuard, WriteOutcome } from "../chat/model";
import { usePlaybooksCommands } from "./commands";
import {
  NO_RUNS,
  PLAYBOOKS_TEST_IDS as IDS,
  countText,
  dedupeText,
  draftsOf,
  handoffLine,
  newestRelevantEventId,
  pendingEnableApproval,
  readError,
  runKindWord,
  runTokensText,
  safe,
  safeBlock,
  stateOf,
  triggerText,
  setValueOrNotSet,
  valueOrNotSet,
} from "./model";
import { Breakable, type Notice, type PlaybookActions, PlaybookSwitch, RunStatus, SetBy, Skeleton, TurnOnNote } from "./parts";
import { PlaybookDetail } from "./PlaybookDetail";
import { PlaybookEdit } from "./PlaybookEdit";
import { PlaybookHistory } from "./PlaybookHistory";
import { type LastRun, useLastRuns, useRuns, useVersions } from "./useHistory";
import "./playbooks.css";

type View = { readonly kind: "list" } | { readonly kind: "detail" | "edit" | "history"; readonly id: number };

export interface PlaybooksScreenProps {
  /** Defaults to `window.api`. */
  readonly api?: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

/**
 * The screen. The shell hands screens no bridge, so this reads `window.api` itself and calls
 * no store hook before that check: with no bridge (the shell's own unit tests) it renders a
 * plain state, never a throw.
 */
export function PlaybooksScreen({ api, registry = commandRegistry }: PlaybooksScreenProps) {
  const bridge = api ?? (getBridge() as StudioBridge | undefined);
  if (bridge === undefined) {
    return (
      <div className="pb-nobridge" data-testid={IDS.screen} data-state="no-bridge">
        <p className="pb-nobridge-title">Playbooks</p>
        <p className="pb-nobridge-note">This window has no connection to the kernel, so there is nothing to show.</p>
      </div>
    );
  }
  return <PlaybooksView api={bridge} registry={registry} />;
}

/** The list's Last run and Tokens cells for one playbook: two lines each, reserved before the answer arrives. */
function LastRunCells({ read }: { readonly read: LastRun | undefined }): { readonly last: ReactNode; readonly tokens: ReactNode } {
  const cell = (value: ReactNode, caption: ReactNode) => (
    <div className="pb-cell">
      <span className="pb-tn">{value}</span>
      <span className="pb-cap">{caption}</span>
    </div>
  );
  if (read === undefined || !read.settled) return { last: cell("reading…", ""), tokens: cell("reading…", "") };
  if (read.data === undefined) return { last: cell("unknown", "could not be read"), tokens: cell("unknown", "could not be read") };
  if (read.data === null) return { last: cell(NO_RUNS, ""), tokens: cell(NO_RUNS, "") };
  const run = read.data;
  return {
    last: cell(
      <time dateTime={run.started}>{when(run.started)}</time>,
      <>
        {runKindWord(run.kind)} · <RunStatus status={run.status} />
      </>,
    ),
    tokens: cell(runTokensText(run), "last run"),
  };
}

interface ListProps {
  readonly playbooks: readonly PlaybookListing[];
  readonly lastRuns: ReadonlyMap<number, LastRun>;
  readonly actions: PlaybookActions;
  readonly triggerOf: (playbook: PlaybookListing) => Trigger | undefined;
  readonly onOpen: (playbook: PlaybookListing) => void;
}

function PlaybookTable({ playbooks, lastRuns, actions, triggerOf, onOpen }: ListProps) {
  return (
    <div className="pb-tablewrap">
      <table className="pb-table" data-testid={IDS.list}>
        <caption className="pb-vh">Playbooks</caption>
        <colgroup>
          <col />
          <col className="pb-c-trigger" />
          <col className="pb-c-dedupe" />
          <col className="pb-c-priority" />
          <col className="pb-c-model" />
          <col className="pb-c-mode" />
          <col className="pb-c-last" />
          <col className="pb-c-tokens" />
          <col className="pb-c-on" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Playbook</th>
            <th scope="col">Trigger</th>
            <th scope="col">Dedupe key</th>
            <th scope="col">Priority</th>
            <th scope="col">Model</th>
            <th scope="col">Mode</th>
            <th scope="col">Last run</th>
            <th scope="col">Tokens</th>
            <th scope="col">On</th>
          </tr>
        </thead>
        <tbody data-nav-group="">
          {playbooks.map((playbook) => {
            const state = stateOf(playbook);
            const cells = LastRunCells({ read: lastRuns.get(playbook.id) });
            return (
              <tr key={playbook.id} data-nav-row="" data-testid={IDS.row} data-playbook={playbook.id} data-state={state}>
                <td>
                  <button type="button" className="pb-plink" data-nav="" data-pb-open={playbook.id} data-testid={IDS.open} onClick={() => onOpen(playbook)}>
                    <b>{safe(playbook.name)}</b>
                    <span className="pb-intent">{safeBlock(playbook.intent)}</span>
                  </button>
                  {state === "draft" ? <Badge tone="attention">draft · waiting on you</Badge> : null}
                </td>
                <td>
                  <span className="pb-cap">
                    <Breakable text={triggerText(triggerOf(playbook), playbook)} />
                  </span>
                </td>
                <td>
                  <div className="pb-cell">
                    <span className="pb-mono">
                      <Breakable text={dedupeText(playbook.dedupe_key_spec)} />
                    </span>
                    <SetBy compact setBy={playbook.dedupe_key_spec === null ? null : playbook.dedupe_key_set_by} />
                  </div>
                </td>
                <td>
                  <div className="pb-cell">
                    <span>
                      <Badge tone={playbook.priority === "high" ? "attention" : "neutral"}>{setValueOrNotSet(playbook.priority, playbook.priority_set_by)}</Badge>
                    </span>
                    <SetBy compact setBy={playbook.priority_set_by} />
                  </div>
                </td>
                <td>
                  <div className="pb-cell">
                    <span>{valueOrNotSet(playbook.model)}</span>
                    <SetBy compact setBy={playbook.model === null ? null : playbook.model_set_by} />
                  </div>
                </td>
                <td>
                  <div className="pb-cell">
                    <span>
                      <Badge>{setValueOrNotSet(playbook.mode, playbook.mode_set_by)}</Badge>
                    </span>
                    <SetBy compact setBy={playbook.mode_set_by} />
                  </div>
                </td>
                <td>{cells.last}</td>
                <td>{cells.tokens}</td>
                <td>
                  <PlaybookSwitch playbook={playbook} actions={actions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The line under the list's count when playbooks wait on the owner (a draft is off until an approval turns it on). */
function WaitingBand({ drafts, onReview }: { readonly drafts: readonly PlaybookListing[]; readonly onReview: (playbook: PlaybookListing) => void }) {
  const first = drafts[0];
  if (first === undefined) return null;
  const names = drafts.slice(0, 3).map((p) => safe(p.name));
  const text =
    drafts.length === 1
      ? `1 playbook waits on you: ${names[0] ?? ""} is a draft. It stays off until you approve turning it on.`
      : `${drafts.length} playbooks wait on you: ${names.join(", ")}${drafts.length > names.length ? " and more" : ""}. Each is a draft and stays off until you approve turning it on.`;
  return (
    <div className="pb-band" role="status" data-testid={IDS.band}>
      <span>{text}</span>
      <Button variant="secondary" size="row" data-testid={IDS.bandReview} onClick={() => onReview(first)}>
        Review
      </Button>
    </div>
  );
}

function EmptyState({ offline, onAsk }: { readonly offline: boolean; readonly onAsk: () => void }) {
  return (
    <div className="pb-empty" data-testid={IDS.empty}>
      <h2>No playbooks yet.</h2>
      <p>Studio ships none. A playbook is behaviour Wright writes with you in plain English: when it runs, what it does, how much it may spend. Every value Wright chooses is a proposal you can change.</p>
      <Button variant="primary" size="standalone" data-testid={IDS.askWright} disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={onAsk}>
        Ask Wright for the first one
      </Button>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { readonly error: Parameters<typeof readError>[0]; readonly onRetry: () => void }) {
  const { text, detail } = readError(error);
  return (
    <div className="pb-fail" role="alert" data-testid={IDS.error}>
      <h2>Couldn't load playbooks</h2>
      <p>{text}</p>
      <div className="pb-fail-detail pb-mono">{detail}</div>
      <div className="pb-fail-actions">
        <Button variant="secondary" size="standalone" data-testid={IDS.retry} onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** The key that moves focus between a group's rows: J down, K up, as the mockup's. Typing in a field is never taken. */
function useRowKeys(rootRef: { readonly current: HTMLElement | null }): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "j" && event.key !== "k") return;
      if (isComposingKey(event) || isEditableTarget(event.target)) return;
      // Nothing runs behind an open dialog or the ⌘K palette.
      if (document.querySelector('[aria-modal="true"], [data-testid="command-palette"]') !== null) return;
      const root = rootRef.current;
      if (root === null) return;
      const active = document.activeElement;
      const group = (active instanceof Element ? active.closest("[data-nav-group]") : null) ?? root.querySelector("[data-nav-group]");
      if (group === null || !root.contains(group)) return;
      const items = Array.from(group.querySelectorAll<HTMLElement>("[data-nav]"));
      if (items.length === 0) return;
      const rowOf = (el: Element): Element => el.closest("[data-nav-row]") ?? el;
      const here = active instanceof Element && group.contains(active) ? rowOf(active) : null;
      const at = here === null ? -1 : items.findIndex((el) => rowOf(el) === here);
      const next = items[Math.min(items.length - 1, Math.max(0, at + (event.key === "j" ? 1 : -1)))];
      if (next === undefined) return;
      event.preventDefault();
      next.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rootRef]);
}

interface Tagged {
  readonly id: number;
  readonly notice: Notice;
}

function PlaybooksView({ api, registry }: { readonly api: StudioBridge; readonly registry: CommandRegistry }) {
  const snapshot = useLiveStore(api);
  const playbooksRead = useResource("playbooks", api);
  const triggersRead = useResource("triggers", api);
  const approvalsRead = useResource("approvals", api);
  const connection = snapshot.connection.state;
  // `connecting` is the first attempt, not a loss: only a kernel that stopped answering is "last known".
  const offline = connection === "reconnecting" || connection === "unreachable" || connection === "not_installed";
  const live = connection === "live";
  const eventId = newestRelevantEventId(snapshot.eventLog);

  const playbooks = playbooksRead?.data?.playbooks;
  const triggers = triggersRead?.data?.triggers;
  const approvals = approvalsRead?.data?.approvals;
  const triggerOf = (playbook: PlaybookListing): Trigger | undefined => (playbook.trigger_id === null ? undefined : triggers?.find((t) => t.id === playbook.trigger_id));

  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const openId = view.kind === "list" ? undefined : view.id;
  const current = openId === undefined ? undefined : playbooks?.find((p) => p.id === openId);
  const runs = useRuns(api, openId, eventId, live);
  const versions = useVersions(api, openId, eventId, live);
  const lastRuns = useLastRuns(api, view.kind === "list" ? (playbooks ?? []).map((p) => p.id) : [], eventId, live);

  const [turnOn, setTurnOn] = useState<number | undefined>(undefined);
  const [offNotice, setOffNotice] = useState<Tagged | undefined>(undefined);
  const [runNotice, setRunNotice] = useState<Tagged | undefined>(undefined);
  const [pending, setPending] = useState<string | null>(null);
  const guard = useRef<InFlightGuard | null>(null);
  guard.current ??= inFlightGuard();

  // A view change unmounts the control the owner used: say which control takes focus.
  const focusAfter = useRef<string | null>(null);
  useLayoutEffect(() => {
    const selector = focusAfter.current;
    if (selector === null) return;
    focusAfter.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }, [view]);
  const show = (next: View, focus: string): void => {
    focusAfter.current = focus;
    setView(next);
  };
  const back = (): void => {
    if (view.kind === "list") return;
    if (view.kind === "detail") show({ kind: "list" }, `[data-pb-open="${view.id}"]`);
    else show({ kind: "detail", id: view.id }, view.kind === "edit" ? `[data-testid="${IDS.editFields}"]` : `[data-testid="${IDS.history}"]`);
  };

  /** One write at a time: a second while one is pending is dropped, and resolves `undefined`. */
  const guarded = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    let result: T | undefined;
    await guard.current?.run(async () => {
      setPending(key);
      try {
        result = await fn();
      } finally {
        setPending(null);
      }
    });
    return result;
  };

  const askWright = (): void => {
    navigate(threadHash(WRIGHT));
    requestComposerFocus(WRIGHT);
  };
  const editInEnglish = (playbook: PlaybookListing): void => {
    // The thread takes this line once when it mounts, into the composer, and sends nothing.
    handOffComposerText(WRIGHT, handoffLine(playbook));
    navigate(threadHash(WRIGHT));
  };
  const turnOff = (playbook: PlaybookListing): void => {
    void guarded(`off:${playbook.id}`, async () => {
      const outcome = await write(api, "/playbooks/:id/off", { id: playbook.id }, undefined, ["playbooks", "triggers"]);
      setOffNotice(outcome.ok ? undefined : { id: playbook.id, notice: { tone: "danger", text: `Turn off: ${outcome.text}` } });
      if (outcome.ok) setTurnOn(undefined);
    });
  };
  const runNow = (playbook: PlaybookListing): void => {
    void guarded(`run:${playbook.id}`, async () => {
      const outcome = await write<PlaybookRunResponse>(api, "/playbooks/:id/run", { id: playbook.id }, undefined, ["playbooks", "triggers"]);
      setRunNotice({
        id: playbook.id,
        notice: outcome.ok
          ? { tone: "ok", text: outcome.body.created ? `Run queued (#${outcome.body.queue_id}).` : `That run was already queued (#${outcome.body.queue_id}).` }
          : { tone: "danger", text: `Run now: ${outcome.text}` },
      });
      if (outcome.ok) runs.refetch();
    });
  };
  const setField = (playbook: PlaybookListing, field: KernelPolicyField, value: string): Promise<WriteOutcome<PlaybookChangeResponse> | undefined> =>
    guarded(`set:${playbook.id}:${field}`, async () => {
      const outcome = await write<PlaybookChangeResponse>(api, "/playbooks/:id/set", { id: playbook.id }, { field, value }, ["playbooks", "triggers"]);
      if (outcome.ok) {
        runs.refetch();
        versions.refetch();
      }
      return outcome;
    });
  const open = (playbook: PlaybookListing): void => show({ kind: "detail", id: playbook.id }, "[data-pb-back]");

  const actions: PlaybookActions = { offline, pending, turnOff, revealTurnOn: (p) => setTurnOn(p.id), runNow, editInEnglish };

  usePlaybooksCommands(
    registry,
    { playbooks: playbooks ?? [], current: view.kind === "list" ? undefined : current, offline },
    {
      askWright,
      open,
      editInEnglish,
      editFields: (p) => show({ kind: "edit", id: p.id }, "[data-pb-back]"),
      showHistory: (p) => show({ kind: "history", id: p.id }, "[data-pb-back]"),
    },
  );
  useRowKeys(rootRef);

  const error = playbooksRead?.error;
  let body: ReactNode;
  let state: string;
  if (view.kind !== "list") {
    state = view.kind;
    if (current === undefined) {
      body = (
        <div className="pb-main">
          <div className="pb-crumb">
            <Button variant="ghost" size="standalone" data-pb-back="" onClick={back}>
              Playbooks
            </Button>
          </div>
          {playbooks === undefined ? (
            <Skeleton rows={2} />
          ) : (
            <p className="pb-cap" role="status">
              This playbook is not in the kernel's playbook list.
            </p>
          )}
        </div>
      );
    } else if (view.kind === "detail") {
      body = (
        <PlaybookDetail
          playbook={current}
          trigger={triggerOf(current)}
          approval={pendingEnableApproval(approvals, current)}
          runs={runs}
          actions={actions}
          turnOnOpen={turnOn === current.id}
          offNotice={offNotice?.id === current.id ? offNotice.notice : undefined}
          runNotice={runNotice?.id === current.id ? runNotice.notice : undefined}
          onBack={back}
          onEdit={() => show({ kind: "edit", id: current.id }, "[data-pb-back]")}
          onHistory={() => show({ kind: "history", id: current.id }, "[data-pb-back]")}
        />
      );
    } else if (view.kind === "edit") {
      body = <PlaybookEdit playbook={current} actions={actions} onSet={setField} onBack={back} />;
    } else {
      body = <PlaybookHistory playbook={current} versions={versions} onBack={back} />;
    }
  } else if (playbooks === undefined) {
    if (error === undefined) {
      state = "loading";
      body = (
        <div aria-busy="true" data-testid={IDS.loading}>
          <span className="pb-vh" role="status">
            Loading playbooks
          </span>
          <Skeleton rows={3} />
        </div>
      );
    } else {
      state = "error";
      body = <ErrorCard error={error} onRetry={() => liveStoreFor(api).refetch("playbooks")} />;
    }
  } else if (playbooks.length === 0) {
    state = offline ? "unreachable" : "empty";
    body = <EmptyState offline={offline} onAsk={askWright} />;
  } else {
    const drafts = draftsOf(playbooks);
    state = offline ? "unreachable" : drafts.length > 0 ? "waiting" : "populated";
    const revealed = turnOn === undefined ? undefined : playbooks.find((p) => p.id === turnOn);
    body = (
      <>
        <WaitingBand drafts={drafts} onReview={open} />
        <PlaybookTable playbooks={playbooks} lastRuns={lastRuns} actions={actions} triggerOf={triggerOf} onOpen={open} />
        {offNotice === undefined ? null : (
          <p className="pb-notice" data-tone={offNotice.notice.tone} role="alert" data-testid={IDS.notice}>
            {offNotice.notice.text}
          </p>
        )}
        {revealed === undefined || stateOf(revealed) === "on" ? null : <TurnOnNote playbook={revealed} approval={pendingEnableApproval(approvals, revealed)} actions={actions} />}
      </>
    );
  }

  const showToolbar = view.kind === "list" && playbooks !== undefined && playbooks.length > 0;
  return (
    <div className="playbooks" ref={rootRef} data-testid={IDS.screen} data-state={state} data-offline={offline ? "true" : undefined}>
      {view.kind === "list" ? (
        <div className="pb-tbar">
          <span className="pb-cap" data-testid={IDS.count}>
            {playbooks === undefined ? "" : countText(playbooks, offline)}
          </span>
          <span className="pb-spacer" />
          {showToolbar ? (
            <Button variant="secondary" size="standalone" data-testid={IDS.askWright} disabled={offline} title={offline ? "Needs the kernel" : undefined} onClick={askWright}>
              Ask Wright for a playbook
            </Button>
          ) : null}
        </div>
      ) : null}
      {body}
    </div>
  );
}
