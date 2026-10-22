// The thread's composer: Enter sends, Shift+Enter is a newline, blank text
// never sends, at most 8000 characters (`AskBody`). It sends `POST /ask` with
// the thread's agent; a `202` clears it, a refusal shows the kernel's words
// and keeps the text. A specialist's composer offers only "No workspace" and
// the workspaces its `GET /agents/:id` lists; Wright's offers none.
//
// It is built on the Composer's own markup and CSS (`.composer`, Input.css)
// rather than the `Composer` component, so the send guard lives here, in the
// one handler that calls the kernel.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, Ref } from "react";
import type { AgentDetailResponse, AskResponse, StudioBridge } from "../../api/contract";
import { Button } from "../../components/Button/Button";
import { SelectField } from "../../components/Input/Input";
import { WRIGHT, refusalOf, write } from "./model";

export const MAX_ASK_LENGTH = 8000;

export interface ChatComposerProps {
  readonly api: StudioBridge;
  readonly agent: string;
  readonly agentName: string;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly inputRef: Ref<HTMLTextAreaElement>;
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
          if (result.ok) setState({ agent, list: Array.isArray(result.body.workspaces) ? result.body.workspaces.filter((w) => typeof w === "string") : [], error: "" });
          else setState({ agent, list: [], error: refusalOf(result).text });
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

export function ChatComposer({ api, agent, agentName, text, onTextChange, inputRef }: ChatComposerProps) {
  const isWright = agent === WRIGHT;
  const workspaces = useWorkspaces(api, agent);
  const [workspace, setWorkspace] = useState("");
  const [refusal, setRefusal] = useState("");
  // A ref, not state: two Enters in one tick must not both pass the guard.
  const inFlight = useRef(false);

  const send = async (): Promise<void> => {
    if (inFlight.current) return;
    // Blank text never reaches the kernel (it would answer 400 invalid_body).
    if (text.trim() === "" || text.length > MAX_ASK_LENGTH) return;
    // Only a listed workspace is ever sent.
    const chosen = !isWright && workspace !== "" && workspaces.list.includes(workspace) ? workspace : undefined;
    inFlight.current = true;
    const outcome = await write<AskResponse>(api, "/ask", undefined, { text, agent, ...(chosen === undefined ? {} : { workspace: chosen }) }, [`thread:${agent}`, "messages"]);
    inFlight.current = false;
    if (outcome.ok) {
      setRefusal("");
      onTextChange("");
    } else {
      setRefusal(outcome.text);
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
      {isWright ? null : (
        <div className="chat-workspace">
          <SelectField label="Workspace" value={workspace} onChange={(event) => setWorkspace(event.target.value)} hint={workspaces.error === "" ? undefined : workspaces.error}>
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
          aria-label={`Message ${agentName}`}
          placeholder={isWright ? "Ask Wright anything, or tell it a duty…" : `Message ${agentName}…`}
          maxLength={MAX_ASK_LENGTH}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button variant="primary" size="row" kbd="⏎" onClick={() => void send()}>
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
