Badges carry a short fact in a colour: a semantic badge uses a `*-soft` ground with its strong colour as text (`ok` on `ok-soft`, `attention` on `attention-soft`, `danger` on `danger-soft`, `parked` on `parked-soft`, `accent` on `accent-soft`); a neutral badge is `ink-secondary` on `surface-sunken`. All 20px tall, `radius-xs`, `caption` size at weight 600.

Related marks in the same family: the **count pill** (`attention` fill, `radius-full`, tabular digits) on Approvals in the sidebar and menu bar; the **chip** for an agent (14px avatar) or a linked PR or ticket, on `surface` with a `hairline` edge; the **kbd** chip for shortcuts; inline **mono** for dedupe keys and paths.

**Use:** semantic colour only for a kernel state or a verified outcome, exactly as StatusDot. Everything else is neutral. A badge with an icon uses 12px Lucide at 2px stroke.

**Provide:** the text (sentence case, two or three words), optional icon, and for the pill an `aria-label` with the unit ("3 pending").

**Don't:** stack more than three badges on a row; use a badge as a button; colour a model name or a draft state.
