Tables are for screens where the user compares many rows on the same facts: Playbooks, Budget, the audit log. 36px rows on `surface` with `hairline` rules, `label`-style headers in `ink-tertiary` (the sorted column in `ink` with a chevron), tabular numbers right-aligned.

**Cells:** the row subject in `body-strong`; supporting cells in `ink-secondary`; keys and paths in `mono`; states as Badges, never as coloured text; on/off as a 26×16 switch in `accent` (`role="switch"` with `aria-checked`).

**Provide:** columns with a key, a label, alignment and a sort function; rows with a stable key; the row-open handler. Sorting and column resizing persist per screen.

**Loading:** skeleton rows at 36px. **Empty:** the screen's empty state above the header, never an empty body.

**Don't:** wrap cell text (truncate with a title tooltip); zebra-stripe; put more than one interactive control in a row besides the switch.
