A chat turn is a 24px avatar, a `caption` line with the speaker and time, and a bubble in `chat` size. Wright and specialists sit left on `surface` with a `hairline` edge; the user sits right on `accent-soft` with no edge. Bubbles cap at 520px and wrap.

**The playbook draft** is the reason Chat exists: a reply can carry a drafted playbook as a card inside the bubble, with its name, the agent it runs as, a key/value block (trigger, action, dedupe key, model, approval level), the **dry-run line** in `mono` on `surface-sunken` saying exactly what it would have done, and the actions: Enable (primary), Edit in English, Edit fields. Every value Wright chose rather than the user is marked "proposed" in `ink-tertiary`, because policy is the user's (D4).

**Streaming:** tokens append into the bubble with no animation and no height reservation trick beyond pinning the thread to the bottom; a 2px `accent` caret marks the live end; the meta line reads "streaming" and Send becomes Stop.

**Provide:** speaker, timestamp, the markdown body, an optional draft object, and the streaming flag.

**Don't:** show typing indicators (show the streaming turn instead); use emoji; bold the whole first sentence; hide the dry run behind a disclosure.
