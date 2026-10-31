# Memory screen evidence (phase 7 item 06)

These are screenshots of the built app's Memory screen in each of the eight states the GUI v2 mockup shows for it (`docs/design/mockups/gui-v2.html`), each in light and dark mode (16 files). Each one was taken by `app/e2e/memory.spec.ts` against the fixture kernel, with the canned data in `app/e2e/fixtures/memory.ts`. Every name and line of text in them is a fixture value (agents `wright`, `ada` and `mason`, a lessons file that says "PR #3"), so none of it is real data, and the data folder shown is the fixture's canned `/fixture/studio-data`. Times are relative to the moment of capture ("today 23:14"), so they differ from the mockup's fixed clock.

To regenerate the screenshots (macOS):

```sh
cd app && npm run build && MEMORY_EVIDENCE=1 npx playwright test e2e/memory.spec.ts --workers=1
```

`MEMORY_EVIDENCE=1 npm run e2e` writes the same files, and also rewrites other screens' tracked screenshots, whose pixels change a little on every run; use the command above to regenerate these alone.

Without `MEMORY_EVIDENCE=1` the spec writes its screenshots to Playwright's per-test output directory, so CI never changes these files, and one of its tests fails if any file in this directory is newer than the run's start. Another test fails unless this README links exactly the 16 files below and the folder holds nothing else. The spec checks behaviour and never compares pixels, because fonts differ between macOS and the Ubuntu CI run. All 16 files were captured on macOS on 2026-10-30.

## Screenshots

The "Mockup view" column names the view of `docs/design/mockups/gui-v2.html` each screenshot matches (`#view=<name>`), and "How it was produced" says how the spec put the screen in that state.

| Screenshot (light / dark) | Mockup view | How it was produced, and what it shows |
|---|---|---|
| [light](memory-empty-light.png) / [dark](memory-empty-dark.png) | `memory-empty` | The fixture kernel answers `GET /memory` with no file. "Nothing remembered yet." with the mockup's note (plain markdown under the memory root, Wright creates its own on first talk, nothing hidden in a database) and the one action, Ask Wright. |
| [light](memory-loading-light.png) / [dark](memory-loading-dark.png) | `memory-loading` | The fixture holds the tree read open (`holdTree`). Skeleton rows in the tree and the pane, `aria-busy`, and a status line "Loading memory" for a screen reader. |
| [light](memory-populated-light.png) / [dark](memory-populated-dark.png) | `memory-populated` | The tree answered. The memory root above the tree (`<data_dir>/memory/`, from `GET /settings`), each folder (`wright/`, `ada/`, `mason/`, `shared/`) with its files and sizes, and the overview "Pick a file" with a row per folder. |
| [light](memory-file-light.png) / [dark](memory-file-dark.png) | `memory-file` | `mason/lessons.md` opened from the tree. Its full path, size, modified time, version (the content hash's first 8 characters), Edit, and its text in a focusable `<pre>`, with the note that agents write lessons during sessions. |
| [light](memory-edit-light.png) / [dark](memory-edit-dark.png) | `memory-edit` | Edit on that file with one line typed. The textarea, "opened at version ...", and the "Changes" inspector with a diff of the edit against the text as opened, Cancel and Save (enabled, because the text differs). |
| [light](memory-conflict-light.png) / [dark](memory-conflict-dark.png) | `memory-conflict` | The fixture changes the file as an agent would (no event) after the file was opened, and Save is pressed: the kernel answers `409 changed_since_read`. The attention band, both versions beside each other ("On disk now", "Your edit"), the diff from disk to the edit, and Discard my edit, Copy my version and Edit on top of the current version. |
| [light](memory-error-light.png) / [dark](memory-error-dark.png) | `memory-error` | The fixture answers `GET /memory` with `500 store_unreadable`. The route-failure card: "Couldn't load memory", the detail `GET /memory · 500 · store_unreadable`, and Try again. No kernel band above it: the kernel answered. |
| [light](memory-unreachable-light.png) / [dark](memory-unreachable-dark.png) | `memory-unreachable` | The fixture kernel closed while the tree was showing: the shell's "Couldn't reach the kernel" band, the subtitle "14 files · last known", every file kept as last read and marked off (a click opens nothing). |

## Contrast check (AC12)

The screen takes every colour from the design tokens. `app/src/screens/memory/contrast.test.ts` lists each rule of `memory.css` that sets a text colour with the ground it sits on, and checks three things: the rule really declares that token, every rule that sets a colour is listed, and the pair is at least 4.5:1 in both themes (non-text parts 3:1), computed from `app/src/styles/tokens.css`. It also fails on a hex colour, a colour function, a named colour or a token that does not exist in the stylesheet, and `app/e2e/memory.spec.ts` repeats the no-hex check. The ratios on 2026-10-30:

| Pair (text on background) | Light | Dark |
|---|---|---|
| `ink` on `ground` (titles, facts, the screen's text) | 15.89 | 15.31 |
| `ink` on `surface` (a file's text, the overview rows, the inspector) | 17.29 | 14.08 |
| `ink` on `surface-sunken` (the editor at rest, the failure detail) | 14.95 | 16.00 |
| `ink-secondary` on `ground` (a file's name, the overview's paragraph) | 5.91 | 7.26 |
| `ink-secondary` on `surface` (the failure card's note) | 6.43 | 6.68 |
| `ink-secondary` on `surface-sunken` (the neutral badges) | 5.56 | 7.59 |
| `ink-tertiary` on `ground` (the count line, the root, captions, section labels) | 5.14 | 5.40 |
| `ink-tertiary` on `surface` (captions in the overview box and the inspector) | 5.59 | 4.97 |
| `accent` on `accent-soft` (the open file in the tree) | 5.43 | 5.22 |
| `danger` on `danger-soft` (a refusal under a save) | 5.09 | 6.04 |
| `danger` on `surface` (the failure card's heading) | 5.95 | 6.52 |
| `attention` on `attention-soft` (the conflict band, the "not saved" badge) | 5.04 | 7.11 |
| `on-accent` on `accent` (the primary button's label) | 6.48 | 7.02 |
| `focus` on `ground` (non-text, 3:1: the focus ring) | 5.95 | 6.90 |
| `accent` on `surface` (non-text, 3:1: the border of the disk's text in the conflict) | 6.48 | 6.34 |

Every status carries text as well as colour (the "not saved" badge, the band's words, "last known" in the subtitle). The tree is a `nav` labelled "Memory files" and each file button is named "`<path>`, `<size>`, modified `<time>`"; the textarea is labelled "Contents of `<path>`", each `<pre>` has a label, the conflict band is `role="alert"`, and saves and refusals are announced through a polite live region (a save's toast has its own polite announcer). The e2e checks these with `getByRole`.

## What the spec checks

| Area | Check |
|---|---|
| Tree and paths (AC6) | Every agent's files and the shared files under their folder with sizes, in the order the route sends them; the root under the tree; "Pick a file"; a file's full path, size, modified time, version and text in a focusable `<pre>`; the empty state. |
| Edit and save (AC7) | The textarea and the Changes inspector; Save is off until the text differs; Save sends the hash the file was opened at as `base_hash`; the file view shows the new version, a toast "Saved memory/`<path>`. Version `<hash8>`." and the new size; Cancel discards. |
| Conflict (AC8) | An agent's write after the file was opened: the band, both versions, the diff, nothing overwritten on disk; Back to editing keeps the draft; Edit on top of the current version carries over the owner's added lines on the disk's version and saves against its hash; Discard shows the disk text; Copy my version. A `400`, the `404` and the `413` keep the draft and name the code; a save nobody answers keeps it too. |
| Unreachable (AC9) | The fixture kernel is closed: the shell's band shows, the rows stay, the subtitle says "last known", Edit is off and the screen never falls back to the empty state. The editor and the conflict view keep the draft with Save and the conflict's actions off. |
| Keyboard (AC10) | J, K and the arrows move between files; Enter opens one; Esc returns to the tree with focus on that file; Tab reaches Edit, the textarea, Cancel and Save, and every conflict action; Esc from a changed editor keeps its text. |
| Live (AC11) | A `memory_updated` and a `session_status` event update the tree with no reload and no skeleton; the boxes of the rows and folder headers already shown are identical before and after. A file view not being edited reads its file again; an editor's draft is never replaced, and its save is still checked against the version it was opened at. |
| Names (AC12) | Accessible names, labels, the alert, the polite region, file text shown as text and never as an element, and the no-hex check. |

## Departures from the mockup

- **The "See who wrote it in the audit log" link in the conflict view is not built.** The kernel records no event for an agent's own memory write (`docs/DESIGN.md`, open point 3), so the audit log has nothing to show for it. Whether to track agent writes is the owner's decision and is not taken here. The brief's approval point for this omission is the PR review.
- **The tree also refetches on `session_status`.** For the same reason: a session ending is when agents write their lessons, and the feed carries no event for the write itself.
- **The conflict's actions sit above the two versions**, not below the diff, so they are on screen when the conflict opens.
- **Each folder's name is the folder, capitalised** ("Mason"), not the roster's display name, and there is no avatar. The tree is from `GET /memory`, which carries the folder only.
- **Sizes and modified times come from the tree's row**; the conflict view shows only versions for "On disk now", because the `409` carries no time.
- **Line breaks.** A `<textarea>` holds `\n`, so a file that used `\r\n` is shown with `\n`, is not "changed" by opening it, and a save writes `\r\n` back.
- **Row text clips.** File rows and folder headers have fixed heights so a refetch moves nothing; a long name ends in an ellipsis.

## Limits

- **The ⌘K palette and ⌘9 are not reachable in the built app.** The shell does not mount the command palette or bind the screen shortcuts (as for every phase 7 screen). The screen registers `Open memory/<path>` (one per file, id `memory.open:<path>`) and, while a file view is open, `Edit memory/<path>` (`memory.edit`), under owner `memory`, and unregisters them on unmount; that is pinned in `app/src/screens/memory/MemoryScreen.test.tsx` (jsdom), not driven in Electron.
- **The draft lives in the screen.** Leaving Memory for another screen unmounts it and drops an unsaved draft; a refetch, a feed event or an outage never does.
- **The save's hash check is not atomic against another process.** It is the kernel's check (`docs/architecture/brain.md`, "Honest limits"): a session writing the file directly can land between the kernel's read and its rename.
- **The fixture's routes are the shared interface, not the kernel's.** The real routes (`kernel/src/gui/memory.ts`) are covered by `kernel/test/gui-memory.test.ts`. The "no answer" case is a kernel that drops the connection with the save open, because the main process only reports a timeout after 10 seconds.
- All screenshots come from one machine (macOS). The Ubuntu CI run executes the same assertions but does not write these files.
