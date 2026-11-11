// The charter card's Ask or change box and its workspace question (phase 8
// item 18d Parts C and D; docs/DESIGN.md §"Charter card (phase 8 item 18a)",
// the owner's 2026-11-11 decisions 2 and 3). Shared by Chat's charter card and
// the Approvals screen's.
//
// Both post a Reply into the thread the charter was drafted in: `POST /ask`
// with `continues` set to the drafting message (`draftingMessage`: the agent
// message whose `session_id` is the approval's `requesting_session`), so Wright
// answers there and, for a change, holds a new version (the kernel withdraws
// the older one). When that message is not among the loaded thread items the
// box says so and sends nothing: never a guessed thread (AC7).
//
// The workspace question (shown by Chat's card when the kernel's readiness
// block flags a missing workspace) offers the saved workspaces whose remote
// matches a repo the charter names (`GET /workspaces?repo=`), Choose folder…
// (the 18c picker, then `POST /workspaces`; a refusal such as
// `protected_folder` is shown in the kernel's words and nothing is posted) and
// Clone it for me (posts the request; cloning is not built yet, decision 2).
// Nothing changes until the owner approves the new version Wright proposes.
//
// Every kernel string (titles, paths, refusal messages) is untrusted data,
// rendered as a React text child only; a path is shown through
// `formatHomePath`, never built into markup.
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Approval, AskResponse, SaveWorkspaceResponse, SavedWorkspace, SavedWorkspacesResponse, StudioBridge, ThreadFigures, ThreadItem } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { Icon } from "../../components/IconButton/IconButton";
import { formatHomePath } from "../../shell/home-path";
import { useHomeDir } from "../../shell/useHomeDir";
import { useResource } from "../../store/react";
import { threadResource } from "../../store/resources";
import { printable } from "../approvals/printable";
import { askBodyOf, draftingMessage, refusalWords, summarizedInto, threadTitle } from "./continuity";
import type { DraftingTarget } from "./continuity";
import { useCardAction } from "./cardActions";
import { rehashIfCurrent, write } from "./model";
import "./chat.css";
import type { WriteOutcome } from "./model";

/** The box's label. */
export const ASK_LABEL = "Ask or change";

/** How the owner's words are marked, so Wright and the thread show they came from the card. */
export const ASK_PREFIX = "From the card's Ask or change";

/** The `POST /ask` text the box sends for approval `id`. */
export function askText(id: number, words: string): string {
  return `${ASK_PREFIX} (approval ${id}): ${words}`;
}

/** What the box says when the drafting message is not among the loaded items: nothing is sent. */
export const NOT_LOADED = "The message Wright drafted this in isn't in the part of the thread that's loaded, so nothing can be sent from here yet. Load earlier in the thread to find it.";

/** The same, on the Approvals screen, which reads only the thread's latest page and has no Load earlier. */
export const NOT_LOADED_HERE = "The message Wright drafted this in isn't among the thread's latest messages, so nothing can be sent from here. Open the thread in Chat and load earlier messages to find it.";

/** What the card says once Clone it for me posted (the owner's decision 2: the clone is a follow-up item). */
export const CLONE_NOT_BUILT = "Cloning isn't built yet; nothing was cloned. Wright has your request.";

/** What the card says once a folder was sent to Wright (AC5). */
export const WORKSPACE_SENT = "Sent to Wright. It proposes a new version with this folder; nothing changes until you approve it.";

/** The words a workspace pick posts. `path` is the folder's absolute path, as Wright needs it. */
export function folderText(path: string, member: string): string {
  return `Use the workspace at ${path} for ${member} (from the card's workspace question)`;
}

/** The words Clone it for me posts. */
export function cloneText(repo: string | undefined, member: string): string {
  return `Clone ${repo ?? "the repo"} for ${member} (from the card's workspace question)`;
}

/** The thread a link names in Chat: Wright's is `#/chat`, any other agent's `#/chat/<id>`. */
export function chatHash(agent: string): string {
  return agent === "wright" ? "#/chat" : `#/chat/${encodeURIComponent(agent)}`;
}

/** Where a held charter's requests go, read from the loaded thread. */
export interface DraftingRead {
  /** `undefined` while the thread is unread, or when the message is not loaded (`loaded` says which). */
  readonly drafting: DraftingTarget | undefined;
  readonly loaded: boolean;
  /** The drafting thread's title, as the kernel names it. */
  readonly title: string | undefined;
  /** The thread the drafting one was summarized into in this window, if any. */
  readonly summarizedInto: number | undefined;
}

/**
 * The drafting message for `approval`, from `items` when given (Chat passes
 * every loaded page), else from the requesting agent's thread as the live
 * store reads it (the Approvals screen).
 */
export function useDrafting(api: StudioBridge, approval: Approval, items?: readonly ThreadItem[], threads?: readonly ThreadFigures[]): DraftingRead {
  const resource = useResource(threadResource(approval.requesting_agent), api);
  const shown = items ?? resource?.data?.items;
  const figures = threads ?? resource?.data?.threads;
  const drafting = shown === undefined ? undefined : draftingMessage(shown, approval);
  const title = drafting === undefined ? undefined : threadTitle(figures?.find((t) => t.id === drafting.thread), drafting.thread, drafting.item.session_title);
  return {
    drafting,
    // A thread read that failed is answered too: the message is not loaded, so nothing is sent.
    loaded: shown !== undefined || resource?.error !== undefined,
    title,
    summarizedInto: drafting === undefined ? undefined : summarizedInto(api, drafting.agent, drafting.thread),
  };
}

/** One Reply into the drafting thread. */
export async function postToDrafting(api: StudioBridge, drafting: DraftingTarget, text: string): Promise<WriteOutcome<AskResponse>> {
  return write<AskResponse>(api, "/ask", undefined, askBodyOf({ text, agent: drafting.agent, continues: drafting.message }), [`thread:${drafting.agent}`, "messages"]);
}

/** A `POST /workspaces` refusal in the kernel's own words (its `message`), else `refusalOf`'s text. */
function folderRefusal(outcome: Extract<WriteOutcome<unknown>, { ok: false }>): string {
  const message = typeof outcome.body === "object" && outcome.body !== null ? (outcome.body as { message?: unknown }).message : undefined;
  return `Not used: ${printable(typeof message === "string" && message !== "" ? message : outcome.text)}. Nothing was sent to Wright; choose another folder.`;
}

function sendRefusal(outcome: Extract<WriteOutcome<unknown>, { ok: false }>): string {
  return refusalWords({ status: outcome.status, code: outcome.code, text: outcome.text, ...(outcome.body === undefined ? {} : { body: outcome.body }) });
}

export interface CharterAskProps {
  readonly api: StudioBridge;
  readonly approval: Approval;
  /** The loaded thread items (Chat); omitted, the box reads the requesting agent's thread itself. */
  readonly items?: readonly ThreadItem[];
  readonly threads?: readonly ThreadFigures[];
  /** The Approvals screen: a link to the drafting thread in Chat. */
  readonly linkToThread?: boolean;
}

/** The Ask or change box: the owner's words go to Wright as a Reply in the charter's drafting thread. */
export function CharterAsk({ api, approval, items, threads, linkToThread = false }: CharterAskProps) {
  const fieldId = useId();
  const noteId = useId();
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const { busy, act } = useCardAction();
  const { drafting, loaded, title, summarizedInto: into } = useDrafting(api, approval, items, threads);
  const words = text.trim();

  const send = (): void => {
    // Never a guessed thread (AC7): no drafting message, nothing is sent.
    if (drafting === undefined || words === "") return;
    const target = drafting;
    act("send", async () => {
      const answer = await postToDrafting(api, target, askText(approval.id, words));
      if (answer.ok) {
        setText("");
        setOutcome({ ok: true, text: `Sent to Wright in “${printable(title ?? "")}”. Wright answers there; a change comes back as a new version of this card.` });
      } else {
        setOutcome({ ok: false, text: sendRefusal(answer) });
      }
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // ⏎ sends; ⇧⏎ is a new line. Never while composing (an IME's Enter confirms the text).
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  let where: string;
  if (!loaded) where = "Finding the thread Wright drafted this in…";
  else if (drafting === undefined) where = linkToThread ? NOT_LOADED_HERE : NOT_LOADED;
  else {
    where = `Goes to Wright as a Reply in “${printable(title ?? "")}”, the thread it drafted this version in.`;
    if (into !== undefined) where += ` That thread was summarized into thread #${into}; this version was drafted before that, so the Reply continues it there.`;
  }
  const href = chatHash(approval.requesting_agent);
  return (
    <div className="charter-ask" data-testid="charter-ask">
      <label className="approvals-label charter-ask-label" htmlFor={fieldId}>
        {ASK_LABEL}
      </label>
      <p className="charter-ask-where" id={noteId} data-testid="charter-ask-where">
        {where}
      </p>
      <textarea
        id={fieldId}
        className="charter-ask-field"
        rows={2}
        maxLength={8000 - askText(approval.id, "").length}
        value={text}
        aria-describedby={noteId}
        placeholder="Ask about it, or say what to change"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="charter-ask-actions">
        <Button variant="secondary" size="row" loading={busy === "send"} disabled={drafting === undefined} onClick={send}>
          Send
        </Button>
        {linkToThread && loaded ? (
          // A link, not a button: it only navigates. Shown when the drafting message isn't loaded too:
          // this screen has no Load earlier, so Chat is where the owner finds it.
          <a className="approvals-link" href={href} data-testid="charter-ask-thread" onClick={() => rehashIfCurrent(href)}>
            Open the thread in Chat
          </a>
        ) : null}
      </div>
      {outcome === null ? null : (
        <p className={outcome.ok ? "charter-ask-sent" : "chat-card-refusal"} role={outcome.ok ? "status" : "alert"} data-testid="charter-ask-outcome">
          {outcome.text}
        </p>
      )}
    </div>
  );
}

// ---- the workspace question ---------------------------------------------------------------

type Lookup = { readonly state: "loading" } | { readonly state: "error"; readonly text: string } | { readonly state: "done"; readonly rows: readonly SavedWorkspace[] };

export interface WorkspaceQuestionProps {
  readonly api: StudioBridge;
  readonly approval: Approval;
  /** The crew member's id, as the requests name it. */
  readonly member: string;
  /** The `owner/repo` names the charter's own text gives (`repoCandidates`). */
  readonly repos: readonly string[];
  readonly items?: readonly ThreadItem[];
  readonly threads?: readonly ThreadFigures[];
  /** Not now, or Esc: close, and return focus to Choose workspace. */
  readonly onClose: () => void;
}

/** "Where's your copy of <repo>?": the saved workspaces that match, Choose folder… and Clone it for me. */
export function WorkspaceQuestion({ api, approval, member, repos, items, threads, onClose }: WorkspaceQuestionProps) {
  const headingId = useId();
  const home = useHomeDir(api);
  const [lookup, setLookup] = useState<Lookup>(() => (repos.length === 0 ? { state: "done", rows: [] } : { state: "loading" }));
  const [refusal, setRefusal] = useState("");
  const [sent, setSent] = useState("");
  const { busy, act } = useCardAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { drafting, loaded } = useDrafting(api, approval, items, threads);
  const repoKey = repos.join(" ");

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (repoKey === "") return;
    let live = true;
    void (async () => {
      const found = new Map<number, SavedWorkspace>();
      for (const repo of repoKey.split(" ")) {
        let answer;
        try {
          answer = await api.request<SavedWorkspacesResponse>({ method: "GET", path: "/workspaces", query: { repo } });
        } catch {
          answer = undefined;
        }
        if (!live) return;
        if (answer?.ok !== true) {
          setLookup({ state: "error", text: "The saved workspaces couldn't be read, so none can be offered. Choose a folder instead, or try again later." });
          return;
        }
        for (const row of answer.body.workspaces) if (row.state === "ready") found.set(row.id, row);
      }
      setLookup({ state: "done", rows: [...found.values()] });
    })();
    return () => {
      live = false;
    };
  }, [api, repoKey]);

  const shown = (path: string): string => printable(formatHomePath(path, home));
  const post = async (target: DraftingTarget, text: string, after: string): Promise<void> => {
    const answer = await postToDrafting(api, target, text);
    if (!answer.ok) {
      setRefusal(sendRefusal(answer));
      return;
    }
    setRefusal("");
    setSent(after);
  };

  // Never a guessed thread (AC7): no drafting message, nothing is sent.
  const useFolder = (row: SavedWorkspace): void => {
    if (drafting === undefined) return;
    const target = drafting;
    act(`use:${row.id}`, () => post(target, folderText(row.path, member), WORKSPACE_SENT));
  };
  const chooseFolder = (): void => {
    if (api.chooseFolder === undefined || drafting === undefined) return;
    const target = drafting;
    act("choose", async () => {
      let chosen: string | null | undefined;
      try {
        chosen = await api.chooseFolder?.();
      } catch {
        setRefusal("Couldn't open the folder picker. Nothing was sent to Wright.");
        return;
      }
      if (typeof chosen !== "string" || chosen === "") return;
      const saved = await write<SaveWorkspaceResponse>(api, "/workspaces", undefined, { path: chosen }, []);
      // The kernel's own words (a protected folder says why, D31); nothing is proposed.
      setRefusal(saved.ok ? "" : folderRefusal(saved));
      if (!saved.ok) return;
      await post(target, folderText(saved.body.workspace.path, member), WORKSPACE_SENT);
    });
  };
  const clone = (): void => {
    if (drafting === undefined) return;
    const target = drafting;
    act("clone", () => post(target, cloneText(repos[0], member), CLONE_NOT_BUILT));
  };

  const repo = repos[0];
  const rows = lookup.state === "done" ? lookup.rows : [];
  const off = drafting === undefined || busy !== null;
  return (
    <section
      className="charter-wsq"
      aria-labelledby={headingId}
      data-testid="charter-workspace-question"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <h4 className="charter-wsq-title" id={headingId} ref={headingRef} tabIndex={-1}>
        {repo === undefined ? "Where's its copy of the repo?" : `Where's your copy of ${printable(repo)}?`}
      </h4>
      {repo === undefined ? <p className="charter-wsq-note">The charter names no repo, so no saved folder can be matched to it.</p> : null}
      {lookup.state === "loading" ? (
        <p className="charter-wsq-note" role="status">
          Looking for saved folders…
        </p>
      ) : lookup.state === "error" ? (
        <p className="chat-card-refusal" role="alert">
          {lookup.text}
        </p>
      ) : rows.length === 0 ? (
        repo === undefined ? null : <p className="charter-wsq-note">No saved folder is a copy of {printable(repo)}.</p>
      ) : (
        <ul className="charter-wsq-rows" aria-label="Saved folders" data-testid="charter-wsq-rows">
          {rows.map((row) => (
            <li key={row.id} className="charter-wsq-row">
              <span className="charter-wsq-path">{shown(row.path)}</span>
              <Button variant="secondary" size="row" aria-label={`Use this folder: ${shown(row.path)}`} loading={busy === `use:${row.id}`} disabled={off && busy !== `use:${row.id}`} onClick={() => useFolder(row)}>
                Use this folder
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="charter-wsq-offers" role="group" aria-label="Other ways" data-testid="charter-wsq-offers">
        {api.chooseFolder === undefined ? null : (
          <Button variant="secondary" size="row" icon={<Icon name="folder" />} loading={busy === "choose"} disabled={off && busy !== "choose"} onClick={chooseFolder}>
            Choose folder…
          </Button>
        )}
        <Button variant="secondary" size="row" icon={<Icon name="download" />} loading={busy === "clone"} disabled={off && busy !== "clone"} onClick={clone}>
          Clone it for me
        </Button>
      </div>
      <div className="charter-wsq-actions">
        <Button variant="ghost" size="row" onClick={onClose}>
          Not now
        </Button>
      </div>
      {loaded && drafting === undefined ? <p className="charter-wsq-note">{NOT_LOADED}</p> : null}
      {refusal === "" ? null : (
        <p className="chat-card-refusal" role="alert" data-testid="charter-wsq-refusal">
          {refusal}
        </p>
      )}
      {sent === "" ? null : (
        <p className="charter-ask-sent" role="status" data-testid="charter-wsq-sent">
          {sent}
        </p>
      )}
    </section>
  );
}
