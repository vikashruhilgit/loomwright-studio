The ⌘K palette is how every action is reachable without the mouse. 560px on `surface-raised`, `radius-lg`, `shadow-3`, over `overlay`, centred at 20% from the top. Opens on `duration-slow` `ease-palette` scaling from 0.98 (plain `ease-enter` under reduced motion); closes on `duration-fast`.

**Anatomy:** a 44px search row (`title-2` size input, search icon, `Esc` chip); a grouped list of 32px rows with a 16px icon or a StatusDot, the label, and a right slot for meta in `ink-tertiary` and a kbd chip; a footer with the navigation keys and the attribution "Wright, powered by Claude".

**Groups, in order:** Actions (things to do now, pending approvals first), Screens, Agents, Playbooks, Sessions, Tasks. Fuzzy match over labels and linked ids (PR numbers, ticket keys). The selected row is `accent-soft` with `accent` text. `Enter` runs or opens; `⌘Enter` opens in the inspector.

**Accessibility:** a real combobox: `role="combobox"` on the shell, `aria-activedescendant` on the input, `role="option"` rows, `aria-selected` on the active one; group headers are not options.

**Provide:** the command registry (label, group, icon or status, shortcut, run handler, optional meta) and the entity search.

**Don't:** show more than eight rows per group without "Show all"; put destructive actions in the palette without their confirm; animate the list on filter.
