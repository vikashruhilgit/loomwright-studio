# 29 — Memory Edit, Memory Conflict and the Keyboard map adopt the shared crumb

## Status: ready

**Priority:** MVP (polish) · ROADMAP phase 7 · D9

**As** the owner,
**I want** the last three click-through views to use the shell's one Back crumb,
**so that** every click-through view reads "‹ Parent / Current", as the 2026-11-01 decision says.

## Problem

Second live re-run (item 28), 2026-11-02, packaged app at `376cf6c` opened from Finder, light and dark, run by the agent with the owner watching (D33, D35). Every item 20–27 fix passed live. One mismatch class remained:

- **Memory Edit** reads "preferences.md / Edit" with no "‹"; `gui-v2.html`'s `memory-edit` draws "‹ lessons.md / Edit". `app/src/screens/memory/MemoryViews.tsx:406` draws its own `.memory-crumb` button, not `app/src/shell/Crumb.tsx`.
- **Memory Conflict** draws its own "Back to editing" button (`MemoryViews.tsx:496`), not the shared crumb (seen in the source; the conflict state was not reached live).
- **The Keyboard map** reads "Back / Keyboard map" with no "‹"; `gui-v2.html`'s `keymap` draws "‹ Back / Keyboard map". `app/src/screens/keymap/KeymapScreen.tsx:104` draws its own button.

Root cause: item 21 built `shell/Crumb.tsx` and scoped its adoption to Budget (itself), Tasks and Playbooks (their items). Memory's Edit and Conflict views and the Keyboard map were never assigned, so they kept their own Back controls.

## Owner decisions (2026-11-01 re-run, binding)

- **One Back control.** Every click-through view uses one shared crumb from the shell, drawn as the mockup draws it: "‹ Parent / Current" (for example "‹ Tasks / Task #9"), without the word "Back". Each screen adopts it in its own item.
- **Nothing is patched outside an item's Touches.**

## Owner decisions (2026-11-02, binding)

Recorded 2026-11-02 in the item 28 session (AskUserQuestion). The owner chose the proposed option.

- **The crumb names the parent, never the word "Back".** The Keyboard map reads "‹ <the screen that opened it> / Keyboard map" (for example "‹ Memory / Keyboard map"; a deep link onto the map names Settings, its fallback parent). The conflict view reads "‹ Edit / <path>" and returns to the editor. The editor reads "‹ <file> / Edit". `gui-v2.html`'s `keymap` and `memory-conflict` crumbs change first (D9), and their mockup screenshots are regenerated.

## Scope

1. `gui-v2.html`: the `keymap` crumb names the opener ("‹ Settings / Keyboard map", its parent in the mockup) and the `memory-conflict` crumb reads "‹ Edit / <path>"; regenerate `gui-v2-keymap-{light,dark}.png` and `gui-v2-memory-conflict-{light,dark}.png`.
2. Memory's editor and conflict views render `shell/Crumb.tsx`.
3. The Keyboard map renders `shell/Crumb.tsx` with the opener's sidebar label as the parent; focus still lands on it when the map opens, and it still returns to the opener.
4. Polish gate: screenshots from the running app (fixture kernel) of `memory-edit`, `memory-conflict` and `keymap`, light and dark, under `docs/evidence/phase-7-polish/`.

## Non-goals

- Changing `shell/Crumb.tsx`'s props (settled by item 21).
- Any other Memory or Keyboard map change.

## Acceptance criteria

- [ ] Given Memory's editor on `wright/preferences.md`, then its crumb is the shared crumb, "‹ preferences.md / Edit", one button named "Back to preferences.md" that cancels the edit.
- [ ] Given Memory's conflict view, then its crumb is the shared crumb, "‹ Edit / <path>", one button named "Back to Edit" that returns to the editor with the draft.
- [ ] Given the Keyboard map opened from Memory, then its crumb is the shared crumb, "‹ Memory / Keyboard map", one button named "Back to Memory" that has focus when the map opens and returns to Memory; opened by a deep link, it names Settings.
- [ ] Given `gui-v2.html`, then `keymap` and `memory-conflict` draw the same crumbs, and their mockup screenshots are regenerated.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Depends on
2026-11-01-090021-shell-one-back-crumb-and-the-in-content-icon-set.md

## Touches
docs/design/mockups/gui-v2.html
docs/evidence/gui-v2-mockup/
docs/evidence/phase-7-polish/
app/src/screens/memory/MemoryViews.tsx
app/src/screens/memory/MemoryScreen.test.tsx
app/src/screens/memory/memory.css
app/src/screens/keymap/KeymapScreen.tsx
app/src/screens/keymap/keymap.test.tsx
app/src/screens/keymap/keymap.css
app/e2e/
