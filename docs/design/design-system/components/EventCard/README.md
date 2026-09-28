A thread is a timeline, not only a conversation: everything the kernel did on the user's behalf appears in it as a one-line event, so the user never has to leave the thread to learn what happened. Two forms:

**Event line.** Centred, `caption`-sized, `ink-tertiary`, a 14px Lucide icon, the subject in `ink-secondary` weight 500, paths in `mono`, a tabular timestamp on the right. Events are `role="status"`. Kinds and their icons: session started/stopped/killed (terminal), playbook created or changed (plus), agent created or renamed (people), memory updated (file, with the file path, since memory is inspectable), approval decided (list), hook applied and verified (check). Each event links to the thing it names (the session, the playbook, the file).

**Inline approval.** When the agent in this thread is waiting on you, the pending approval appears at the end of the thread as a card with an `attention` edge, an `attention-soft` header, a one-line summary of the payload, the playbook's reason, and the same three actions as the Approvals inbox (Allow once `A`, Always `⇧A`, Deny `D`) plus "Full payload", which opens the inbox with the exact review text, diff or message. Deciding here is identical to deciding in the inbox; the event line records it.

**Provide:** the event kind, its text with the subject marked, the timestamp, and a link target; for the inline approval, the approval id and the decision handlers.

**Don't:** put events in bubbles; let an event scroll the thread while the user is reading above; show an inline approval for another agent's action in this thread.
