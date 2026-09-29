The live output of a running session, in `mono` on `surface-sunken`. A header bar on `surface` carries the StatusDot, agent, task, running time, tokens and cost (tabular, updating in place), and the two controls the user always has: **Stop** (`⌘.`, graceful, the kernel writes the handoff) and **Kill** (danger, confirms).

**Lines:** a `caption`-sized timestamp gutter in `ink-tertiary`, then the line. Tool calls are prefixed `▸` in `accent` with the tool name and its arguments; tool output is indented in `ink`; model prose is `ink-secondary`; errors `danger`; a verified step `ok`. The live end shows a block caret in `accent`.

**Live without jank:** lines append with no transition; the container pins to the bottom while the user hasn't scrolled, and shows a "Following" pill; scrolling up pauses following and the pill becomes "Jump to latest". Nothing above the viewport ever changes height.

**Accessibility:** `role="log"` with `aria-live="off"` (a running session would flood a screen reader); a "Read latest" action announces the last line on demand. State changes (stopped, killed, done) are announced politely from the header.

**Provide:** the session, the line stream, and the stop/kill handlers. Lines carry a kind (tool, output, prose, error, ok) and a timestamp.

**Don't:** colour ordinary output; virtualise in a way that changes scroll position; animate the caret (it is static).
