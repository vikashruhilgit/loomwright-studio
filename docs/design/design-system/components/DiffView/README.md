A unified diff in `mono` on `surface`, used wherever the user must see exactly what will change before approving it: a hook install (D6), a playbook edit, a file a builder wants to write outside a worktree.

**Anatomy:** a file header on `surface-sunken` with the path in `mono`, a scope Badge when it matters (project / global), and the +/− counts in `ok` / `danger`; hunk headers in `ink-tertiary` on `ground`; two line-number gutters, a sign column, then the line. Added lines sit on `diff-add-soft` with `diff-add` gutters; deleted on `diff-del-soft` with `diff-del`; context in `ink-secondary`. Gutters are `user-select: none` so copied text is clean.

**Provide:** the file path, the scope, and the hunks as parsed lines. Long lines scroll horizontally inside the diff; the page never scrolls sideways.

**In an approval:** the diff is the approval's body. Allow is not enabled until the diff has rendered.

**Don't:** syntax-highlight (the add/del colour is the only colour); collapse hunks by default; show a diff without its file path and scope.
