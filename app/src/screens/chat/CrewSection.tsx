// The sidebar's Crew group: one row per specialist (never Wright, D25), each a
// button opening that agent's thread, with its avatar and state, the time and
// text of its newest message, and an unread dot. It is always mounted, so it
// also registers Chat's ⌘K commands (and unregisters them on unmount).
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import type { BrainMessage, StudioBridge } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import { CREW_EMPTY_TEXT } from "../../components/List/List";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { useResource } from "../../store/react";
import { buildChatCommands } from "./commands";
import { WRIGHT, agentAvatarState, clock, hashAgent, navigate, readSeen, requestComposerFocus, resolveBridge, seenSnapshot, specialists, subscribeSeen, threadHash } from "./model";
import "./chat.css";

export interface CrewSectionProps {
  /** Defaults to `window.api`, else an inert bridge. */
  readonly api?: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

/** The current hash, kept current. */
export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

/** The newest message row in `agent`'s thread (one it received or sent). */
export function newestMessage(messages: readonly BrainMessage[] | undefined, agent: string): BrainMessage | undefined {
  let newest: BrainMessage | undefined;
  for (const m of messages ?? []) {
    if (m.agent !== agent && m.from_agent !== agent) continue;
    if (newest === undefined || m.id > newest.id) newest = m;
  }
  return newest;
}

function lastLineOf(message: BrainMessage | undefined): string {
  if (message === undefined) return "";
  const text = message.status === "replied" && message.reply_text !== null ? message.reply_text : message.text;
  return text.replace(/\s+/g, " ").trim();
}

export function CrewSection({ api: apiProp, registry = commandRegistry }: CrewSectionProps) {
  const api = useMemo(() => resolveBridge(apiProp), [apiProp]);
  const agents = useResource("agents", api);
  const approvals = useResource("approvals", api);
  const messages = useResource("messages", api);
  const playbooks = useResource("playbooks", api);
  const triggers = useResource("triggers", api);
  const notifications = useResource("notifications", api);
  const hash = useHash();
  useSyncExternalStore(subscribeSeen, seenSnapshot);
  const [notice, setNotice] = useState("");
  const rowIds = useId();

  const roster = agents?.data?.agents;
  const crew = specialists(roster);
  const current = hash.startsWith("#/chat") ? (hashAgent(hash) ?? WRIGHT) : undefined;

  const commands = useMemo(
    () =>
      buildChatCommands({
        api,
        roster,
        playbooks: playbooks?.data?.playbooks,
        triggers: triggers?.data?.triggers,
        notifications: notifications?.data?.notifications,
        onNotice: setNotice,
      }),
    [api, roster, playbooks?.data, triggers?.data, notifications?.data],
  );
  useEffect(() => registry.register("chat", commands), [registry, commands]);

  return (
    <section className="nav-group" aria-labelledby="nav-crew">
      <h2 className="nav-label" id="nav-crew" title="Direct threads with each specialist">
        Crew
      </h2>
      {crew.length === 0 ? (
        <p className="nav-empty">{CREW_EMPTY_TEXT}</p>
      ) : (
        <ul className="chat-crew" aria-label="Crew">
          {crew.map((agent, index) => {
            const newest = newestMessage(messages?.data?.messages, agent.id);
            const selected = current === agent.id;
            const unread = !selected && newest !== undefined && newest.id > readSeen(agent.id);
            const state = agentAvatarState(agent, approvals?.data?.approvals);
            // The name stays "<display name>[, unread]" (it must never start with a screen's name); the
            // time and last line, which a label would hide, are the row's description.
            const timeId = `${rowIds}-${index}-time`;
            const lastId = `${rowIds}-${index}-last`;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className={selected ? "chat-crew-row selected" : "chat-crew-row"}
                  aria-current={selected ? "page" : undefined}
                  aria-label={`${agent.display_name}${unread ? ", unread" : ""}`}
                  aria-describedby={newest === undefined ? undefined : `${timeId} ${lastId}`}
                  data-agent={agent.id}
                  onClick={() => {
                    navigate(threadHash(agent.id));
                    requestComposerFocus(agent.id);
                  }}
                >
                  <Avatar agent={{ id: agent.id, name: agent.display_name, shape: agent.avatar.shape, hue: agent.avatar.hue }} state={state} size={24} />
                  <span className="chat-crew-text">
                    <span className="chat-crew-top">
                      <span className={unread ? "chat-crew-name unread" : "chat-crew-name"}>{agent.display_name}</span>
                      {unread ? <span className="chat-crew-unread" data-testid="crew-unread" aria-hidden="true" /> : null}
                      <time className="chat-crew-time" id={timeId} dateTime={newest?.created_at}>
                        {clock(newest?.created_at)}
                      </time>
                    </span>
                    <span className="chat-crew-last" id={lastId}>
                      {lastLineOf(newest)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {notice === "" ? null : (
        <p className="nav-empty chat-crew-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
