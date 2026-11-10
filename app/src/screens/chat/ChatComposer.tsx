// The thread's composer: Enter sends, Shift+Enter is a newline, blank text
// never sends, at most 8000 characters (`AskBody`). It sends `POST /ask` with
// the thread's agent; a `202` clears it (unless the owner kept typing while
// the ask was in flight), a refusal shows the kernel's words
// and keeps the text. A specialist's composer offers only "No workspace" and
// the workspaces its `GET /agents/:id` lists; Wright's offers none.
//
// The workspace choice is remembered per crew member for the app's lifetime,
// across leaving the thread or the Chat screen. With nothing chosen, a sole
// listed workspace is preselected; a remembered one the list no longer has
// becomes "No workspace" (and stays so) once the list has answered.
// The memory is a per-bridge map here, not in the live store: that store
// holds kernel answers only, and this is the owner's choice.
//
// Thread continuity (phase 8 item 17c): a Reply puts "Replying to: <first
// line>" above the field (× or Esc closes it) and the send carries
// `continues`; a pasted reference link becomes a chip and the send carries
// `references`, never the link in the text. A plain send is the body it always
// was. Every refusal is shown in plain words (`refusalWords`), keeping the
// text, the strip and the chip. A `202` clears only what that send carried:
// text typed, a Reply opened or a reference pasted while it was in flight
// stays for the next message. While a summary is being written, Send waits.
//
// It is built on the Composer's own markup and CSS (`.composer`, Input.css)
// rather than the `Composer` component, so the send guard lives here, in the
// one handler that calls the kernel.
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { KeyboardEvent, Ref } from "react";
import type { AgentDetailResponse, AskReference, AskResponse, StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { SelectField } from "../../components/Input/Input";
import { askBodyOf, parseReference, refusalWords } from "./continuity";
import type { ThreadRef } from "./continuity";
import { WRIGHT, refusalOf, write } from "./model";
import { CloseIcon, ReferenceChip } from "./ReferenceChip";
import type { ChipState } from "./ReferenceChip";
import type { ReplyTarget } from "./ThreadControls";

export const MAX_ASK_LENGTH = 8000;

export interface ChatComposerProps {
  readonly api: StudioBridge;
  readonly agent: string;
  readonly agentName: string;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly inputRef: Ref<HTMLTextAreaElement>;
  /** The agent message an open Reply continues; its strip shows above the field. */
  readonly replyTo?: ReplyTarget | null;
  readonly onCancelReply?: () => void;
  /** The attached reference, sent as `references`. */
  readonly chip?: ChipState | null;
  /** The referenced thread's agent's name when it is another agent's. */
  readonly chipOtherAgent?: string;
  readonly onChipUse?: (use: AskReference["use"]) => void;
  readonly onChipRemove?: () => void;
  /** A pasted reference link; without it, a paste is plain text. */
  readonly onPasteReference?: (ref: ThreadRef) => void;
  /**
   * After a `202`: the strip and the chip that went out with the message are spent. `sent` is what the send read when
   * it started, so the owner of this state clears only that: a Reply or a reference set while the ask was in flight is
   * the owner's next message and stays.
   */
  readonly onSent?: (sent: SentContext) => void;
  /** The id of the line saying why Send waits (a summary is being written); `undefined` when it does not. */
  readonly waitingOn?: string;
}

/** The Reply strip and the chip a send carried, as they were when it started (`null`: none). */
export interface SentContext {
  readonly replyTo: ReplyTarget | null;
  readonly chip: ChipState | null;
}

// Per bridge (the app has one for its whole life), per agent id: the owner's
// last workspace choice, where "" is an explicit "No workspace". Never persisted.
const chosenWorkspaces = new WeakMap<StudioBridge, Map<string, string>>();

function chosenFor(api: StudioBridge): Map<string, string> {
  let chosen = chosenWorkspaces.get(api);
  if (chosen === undefined) {
    chosen = new Map();
    chosenWorkspaces.set(api, chosen);
  }
  return chosen;
}

/** What the picker shows: a remembered listed workspace, else a sole listed one when nothing was chosen, else "No workspace". */
function shownWorkspace(remembered: string | undefined, list: readonly string[]): string {
  if (remembered === undefined) return list.length === 1 ? (list[0] ?? "") : "";
  return remembered !== "" && list.includes(remembered) ? remembered : "";
}

/** The workspaces `GET /agents/:id` lists for `agent` (none for Wright, none while it has not answered). */
function useWorkspaces(api: StudioBridge, agent: string): { readonly list: readonly string[]; readonly error: string } {
  const [state, setState] = useState<{ readonly agent: string; readonly list: readonly string[]; readonly error: string }>({ agent, list: [], error: "" });
  useEffect(() => {
    if (agent === WRIGHT) return;
    let live = true;
    api
      .request<AgentDetailResponse>({ method: "GET", path: "/agents/:id", params: { id: agent } })
      .then(
        (result) => {
          if (!live) return;
          if (result.ok) {
            const list = Array.isArray(result.body.workspaces) ? result.body.workspaces.filter((w) => typeof w === "string") : [];
            // A remembered workspace the kernel no longer lists is dropped to an explicit "No workspace",
            // never deleted (a sole remaining one must not be preselected). A refusal leaves it: the list is unknown.
            const chosen = chosenFor(api);
            const remembered = chosen.get(agent);
            if (remembered !== undefined && remembered !== "" && !list.includes(remembered)) chosen.set(agent, "");
            setState({ agent, list, error: "" });
          } else {
            setState({ agent, list: [], error: refusalOf(result).text });
          }
        },
        () => {
          if (live) setState({ agent, list: [], error: refusalOf(undefined).text });
        },
      );
    return () => {
      live = false;
    };
  }, [api, agent]);
  return state.agent === agent ? state : { list: [], error: "" };
}

export function ChatComposer({
  api,
  agent,
  agentName,
  text,
  onTextChange,
  inputRef,
  replyTo = null,
  onCancelReply,
  chip = null,
  chipOtherAgent,
  onChipUse,
  onChipRemove,
  onPasteReference,
  onSent,
  waitingOn,
}: ChatComposerProps) {
  const isWright = agent === WRIGHT;
  const workspaces = useWorkspaces(api, agent);
  // The memory is the source of truth across mounts; choosing writes it and re-renders.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const workspace = isWright ? "" : shownWorkspace(chosenFor(api).get(agent), workspaces.list);
  const choose = (value: string): void => {
    chosenFor(api).set(agent, value);
    rerender();
  };
  const [refusal, setRefusal] = useState("");
  // A ref, not state: two Enters in one tick must not both pass the guard.
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  // The text as it is now, read after the ask answers (the closure's `text` is the text sent).
  const latest = useRef(text);
  useLayoutEffect(() => {
    latest.current = text;
  }, [text]);

  const send = async (): Promise<void> => {
    if (inFlight.current || waitingOn !== undefined) return;
    // Blank text never reaches the kernel (it would answer 400 invalid_body).
    if (text.trim() === "" || text.length > MAX_ASK_LENGTH) return;
    // Only a listed workspace is ever sent.
    const chosen = !isWright && workspace !== "" && workspaces.list.includes(workspace) ? workspace : undefined;
    const sent = text;
    const sentContext: SentContext = { replyTo, chip };
    const continues = replyTo === null ? undefined : replyTo.message;
    const references: AskReference[] | undefined = chip === null ? undefined : [{ thread: chip.thread, use: chip.use }];
    inFlight.current = true;
    setSending(true);
    let outcome;
    try {
      outcome = await write<AskResponse>(api, "/ask", undefined, askBodyOf({ text: sent, agent, workspace: chosen, continues, references }), [`thread:${agent}`, "messages"]);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    if (outcome.ok) {
      setRefusal("");
      // Clear only what was sent: anything typed meanwhile is the owner's next message.
      if (latest.current === sent) onTextChange("");
      onSent?.(sentContext);
    } else {
      // The text, the strip and the chip all stay: the owner fixes what the words say and sends again.
      setRefusal(refusalWords(outcome, "send"));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="chat-composer">
      {replyTo === null ? null : (
        <div className="chat-reply-strip" role="group" aria-label="Reply">
          <svg className="chat-thread-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
          </svg>
          <span className="chat-reply-text">
            Replying to: <b>{replyTo.firstLine}</b>
          </span>
          <kbd className="btn-kbd" aria-hidden="true">
            Esc
          </kbd>
          <button type="button" className="chat-x" aria-label="Cancel reply" onClick={() => onCancelReply?.()}>
            <CloseIcon />
          </button>
        </div>
      )}
      {chip === null ? null : (
        <ReferenceChip chip={chip} {...(chipOtherAgent === undefined ? {} : { otherAgent: chipOtherAgent })} onUse={(use) => onChipUse?.(use)} onRemove={() => onChipRemove?.()} />
      )}
      {isWright ? null : (
        <div className="chat-workspace">
          <SelectField label="Workspace" value={workspace} onChange={(event) => choose(event.target.value)} hint={workspaces.error === "" ? undefined : workspaces.error}>
            <option value="">No workspace</option>
            {workspaces.list.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      <div className="composer">
        <textarea
          ref={inputRef}
          rows={2}
          className="composer-input"
          aria-label={replyTo === null ? `Message ${agentName}` : `Reply to ${agentName}`}
          placeholder={replyTo !== null ? `Reply to ${agentName}` : isWright ? "Ask Wright anything, or tell it a duty…" : `Message ${agentName}…`}
          maxLength={MAX_ASK_LENGTH}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            if (onPasteReference === undefined) return;
            // Only a whole pasted reference link becomes a chip; any other paste is the owner's text.
            const ref = parseReference(event.clipboardData.getData("text/plain") || event.clipboardData.getData("text"));
            if (ref === undefined) return;
            event.preventDefault();
            onPasteReference(ref);
          }}
        />
        <Button
          variant="primary"
          size="row"
          kbd="⏎"
          loading={sending}
          disabled={waitingOn !== undefined}
          title={waitingOn === undefined ? undefined : "Waits for the summary"}
          aria-describedby={waitingOn}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
      {refusal === "" ? null : (
        <p className="chat-card-refusal" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
