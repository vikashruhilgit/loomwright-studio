Two kinds of feedback. A **toast** confirms something that just happened and goes away: 360px on `surface-raised` with `shadow-2`, a StatusDot, one bold clause then one plain clause, at most one action in `accent`, and a dismiss. It stacks bottom-right of the main column, enters on `duration-base` `ease-enter`, leaves on `duration-fast` `ease-exit`, and stays 6s or until hovered. `role="status"`.

A **band** is persistent and sits at the top of the main column, full width, on a `*-soft` ground with its strong colour: `danger` for kernel unreachable (`role="alert"`), `parked` for paused at cap with the reset time and the parked count, `attention` for "N approvals waiting" on screens other than Approvals. It never auto-dismisses; it leaves when the condition clears.

**Use:** a toast for outcomes of the user's own action (enabled, allowed, denied, stopped). Never a toast for something that needs a decision; that is an approval, and it appears in the inbox and the menu bar count. Native macOS notifications carry "waiting on you" when the window is not focused.

**Don't:** stack more than three toasts (older ones collapse); put a diff or long text in a toast; use red for anything but failure.
