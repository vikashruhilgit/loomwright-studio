// Another screen's line for an agent's Chat composer: "Edit in English" on the
// Playbooks screen stores one here, then goes to `#/chat`, and the thread takes
// it once when it mounts. A plain per-agent map: no React, no storage, nothing
// persisted, so an app restart forgets an untaken line. Nothing here sends: the
// text only fills the composer, and the owner sends it (the composer owns
// `POST /ask`).

/** The text each agent's composer is owed, set by `handOffComposerText`, cleared by `takeComposerHandoff`. */
const pending = new Map<string, string>();

/** Hold `text` for `agent`'s composer, replacing any line already held for it. */
export function handOffComposerText(agent: string, text: string): void {
  pending.set(agent, text);
}

/** The line held for `agent`, or `undefined`; it is cleared, so a second take finds nothing. */
export function takeComposerHandoff(agent: string): string | undefined {
  const text = pending.get(agent);
  pending.delete(agent);
  return text;
}
