Inputs sit on `surface-sunken` at rest and lift to `surface` with an `accent` edge on focus, so a focused field is the brightest thing in its row. Variants: text, search (leading icon, trailing kbd hint), select (trailing chevron), and the chat composer, which is a multi-line field on `surface` with the Send button inside it.

**Use:** the `label` style above every field, in `ink-tertiary`; a `hint` line under it only when the field needs explaining. Error state: `danger` edge, the message in `danger` under the field, `aria-invalid` and `aria-describedby` wired.

**Provide:** `id`, label text, placeholder (a hint of the expected value, never the label repeated), value, and for the composer an `aria-label` since it has no visible label.

**Composer rules:** `chat` size text; `⏎` sends, `⇧⏎` inserts a newline; the field grows to six lines then scrolls; while Wright is streaming, Send becomes Stop.

**Don't:** use a placeholder as the only label; put a border on a resting field (the sunken fill is the edge); make the error message an apology.
