Lists are the app's main surface: the sidebar, the Crew roster, sessions, approvals. Three row heights: `row-height` (28px) for single-line navigation rows, 44px for two-line rows with a subject and a meta line, and 44px Crew rows.

**Sidebar rows:** icon (16px), label, and either a kbd shortcut in `ink-tertiary` or the count pill. Selected: `accent-soft` ground, `accent` text, weight 500, `aria-current="page"`. Group headers use `label`. Order: Chat (Wright), Team, Approvals, Sessions, then the Crew group.

**Crew rows (presence):** a 24px Avatar showing the agent's state, the name (weight 600 with an `accent` dot when unread), a tabular time on the right, and a second line in `caption` with the last thing that happened in that thread: the last message, or "Waiting on you · <the approval>" when the agent needs you. Hovering the avatar shows its current action. Opening a row opens that agent's thread and clears unread.

**Data rows:** an 8px StatusDot, the subject in `body-strong`, a `caption` meta line in `ink-tertiary` with tabular numbers, and a right-aligned column for the secondary fact (model, tokens, time). Selected: `accent-soft`; hover: `surface`. Keyboard: `↑ ↓` or `J K` move, `Enter` opens, focus ring on the row.

**Loading:** skeleton rows on `surface-sunken` at the same height as real rows, so nothing shifts when data lands. **Empty:** the screen's empty state, not an empty list; an empty Crew group says "No specialists yet. Wright proposes one when a duty needs it."

**Provide:** items with a stable key, the status, subject, meta, and the selection handler. Streaming updates to a row's meta (running time, tokens, last line) change text only, never height.

**Don't:** put more than one action inside a row (rows open; actions live in the inspector or on hover at the row's end); zebra-stripe; use a spinner in place of skeletons; show a status dot beside an Avatar.
