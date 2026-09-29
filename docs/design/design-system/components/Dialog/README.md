A dialog interrupts for one decision. 360px (480px when it carries a diff) on `surface-raised`, `radius-lg`, `shadow-3`, `space-5` padding, over `overlay`. It opens on `duration-slow` `ease-enter` scaling from 0.98, and closes on `duration-fast`. Focus moves to the first non-destructive control; `Esc` cancels; the primary action has a kbd chip.

**Confirm (destructive):** `role="alertdialog"`, a 32px `danger-soft` icon disc, a `title-2` question, a `body` paragraph in `ink-secondary` stating the consequence in numbers ("2 sessions, 4 triggers") and what survives, then Cancel and a `danger` button whose label repeats the verb. Kill and the kill switch always go through this.

**Decision:** `role="dialog"`, a question title, the scope in plain words, the exact action in a `mono` well, an optional narrowing checkbox, then Cancel and the primary. "Always allow" says the playbook's name and that it never applies globally (D5, main loop step 6).

**Provide:** title, description, the payload for the well when there is one, and the action handlers. Text inputs inside dialogs are for rename and create only.

**Don't:** stack dialogs; use a dialog for information (use a band or the inspector); put more than two buttons in the action row; let the primary be `danger` and default-focused at the same time.
