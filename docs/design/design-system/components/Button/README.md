Buttons trigger one action and say exactly what it does. Four variants: `primary` (`accent` fill, `on-accent` text), `secondary` (`surface` with a `border` edge), `ghost` (no edge, `ink-secondary` until hover) and `danger` (`danger` text and edge, `danger-soft` on hover). Two sizes: 32px standalone (`control-height`) and 28px inside rows (`row-height`).

**Use:** one `primary` per view, and it is the action the kernel is waiting for (Enable, Allow once, Send). `secondary` for the alternative. `ghost` for tertiary actions in toolbars and rows. `danger` only for Kill, Deny and Delete; Kill always opens a confirm dialog.

**Provide:** the label in sentence case as a verb phrase; an optional 14px Lucide icon before it; an optional kbd chip after it showing the shortcut, which is required on Approvals and Sessions buttons.

**States:** hover and pressed shift the fill on `duration-instant`; `:focus-visible` shows the `focus` ring; loading swaps the icon for a 12px spinner and sets `aria-busy`, keeping the button's width; disabled uses `ink-disabled` on `surface-sunken` and never explains itself in the label (use a tooltip).

**Don't:** put two primaries in one view; use `danger` for anything reversible; use uppercase; animate a button's width.
