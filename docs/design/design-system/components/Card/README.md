A card is one thing the user can open: an agent on Team, a task on the board, a playbook. `surface` on `ground`, a `hairline` edge, `radius-md`, `space-4` padding, `shadow-1` on hover only. Cards are focusable and open on `Enter`.

**Agent card:** a 36px Avatar carrying identity and state, `title-2` name, a `caption` role line that states the permission boundary in plain words ("comments only, can't push"), the current task, then a budget block pinned to the bottom: a 3px meter in `accent` (`attention` from 80%) with its label directly beneath it in `caption`: "142k of 375k today" and the model, tabular.

**Layout rules learned in review:** the grid is `auto-fill` with a 250px minimum and `grid-auto-rows: 1fr`, so opening the inspector reflows to two columns and every card, including the New agent card, stays the same height. The name is one line with an ellipsis; the role wraps to two lines with a reserved two-line height (never cut at one line, which was the bug); anything longer ends in an ellipsis, with the full role in the card's tooltip and in the inspector; the task line clamps at two lines with the full text as a tooltip; the meta row never wraps. The meter is the only divider: no hairline above the meta row.

**Task card:** subject, linked PR/ticket chips, and a state line built from verified facts only ("1/2 approvals · CI green · waiting on Mason"), each fact a Badge.

**Provide:** the entity, its status, the meta pair, and the open handler. Rename and create live in the inspector or a dialog, not on the card.

**Don't:** put buttons on a card face (one action, Open, and it is the card); use a coloured left border; stretch a card to fill an empty row; show a dollar amount as the primary figure on a subscription build.
