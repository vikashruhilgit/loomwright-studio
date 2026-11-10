// The sidebar's Crew group: one row per specialist (never Wright, D25), each a
// button opening that agent's thread, as the mockup draws it (gui-v2.html): its
// avatar and state, its name and one line of its newest message, plus an unread
// dot. Off members sort last, dimmed and saying "off" (their threads stay open
// to read, D34); a member whose name collides with another's shows its id. It
// is always mounted, so it also registers Chat's ⌘K commands (and unregisters
// them on unmount).
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import type { BrainMessage, RosterEntry, StudioBridge } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import { CREW_EMPTY_TEXT } from "../../components/List/List";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { useResource } from "../../store/react";
import { sharedNames } from "../team/model";
import { buildChatCommands } from "./commands";
import { openThreadSnapshot, subscribeOpenThread } from "./continuity";
import { WRIGHT, agentAvatarState, hashAgent, navigate, readSeen, requestComposerFocus, resolveBridge, seenSnapshot, specialists, subscribeSeen, threadHash } from "./model";
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

/** Off members after every other one; `Array.prototype.sort` is stable, so the kernel's order holds inside each group. */
export const offLast = (a: RosterEntry, b: RosterEntry): number => Number(a.status === "off") - Number(b.status === "off");

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
  const openThread = useSyncExternalStore(subscribeOpenThread, openThreadSnapshot);
  const [notice, setNotice] = useState("");
  const rowIds = useId();

  const roster = agents?.data?.agents;
  const crew = specialists(roster);
  const rows = [...crew].sort(offLast);
  // Wright counts: a specialist named like Wright is told apart from it too.
  const shared = sharedNames(roster ?? []);
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
        openThread,
      }),
    [api, roster, playbooks?.data, triggers?.data, notifications?.data, openThread],
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
          {rows.map((agent, index) => {
            const newest = newestMessage(messages?.data?.messages, agent.id);
            const selected = current === agent.id;
            const unread = !selected && newest !== undefined && newest.id > readSeen(agent.id);
            const state = agentAvatarState(agent, approvals?.data?.approvals);
            const off = agent.status === "off";
            const idShown = shared.has(agent.id);
            // The name stays "<display name>[ (<id>)][, unread][, off]" (it must never start with a screen's
            // name); the last line, which a label would hide, is the row's description.
            const lastId = `${rowIds}-${index}-last`;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className={`chat-crew-row${selected ? " selected" : ""}${off ? " off" : ""}`}
                  aria-current={selected ? "page" : undefined}
                  aria-label={`${agent.display_name}${idShown ? ` (${agent.id})` : ""}${unread ? ", unread" : ""}${off ? ", off" : ""}`}
                  title={agent.id}
                  aria-describedby={newest === undefined ? undefined : lastId}
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
                      {off ? <span className="chat-crew-off" data-testid="crew-off">off</span> : null}
                      {unread ? <span className="chat-crew-unread" data-testid="crew-unread" aria-hidden="true" /> : null}
                    </span>
                    {idShown ? <span className="chat-crew-id" data-testid="crew-id">{agent.id}</span> : null}
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
