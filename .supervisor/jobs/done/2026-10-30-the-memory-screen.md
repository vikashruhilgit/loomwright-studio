# Supervisor Job: The Memory screen: view and edit each agent's memory files and the shared memory (phase 7 item 06)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-192357/L4
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140006-the-memory-screen.md
- **Base commit:** 78fb740251cbbba04ccf6b596b3484807faffe26

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TS kernel (vitest) + React/Electron app (vitest, Playwright). The routes fill the existing empty `memory` part (`kernel/src/gui/memory.ts`, 17 lines), and the screen replaces the existing placeholder (`app/src/screens/memory/index.tsx`) |
| 2 | Dependency Availability | GO | No new dependency. The contract already declares every shape (`MemoryTreeResponse`, `MemoryFileResponse`, `MemoryWriteBody`, `MemoryWriteResponse`, `MemoryWriteRefusal`, `MemoryConflictError`; `app/src/api/contract.ts:1112-1183`). The fixture kernel answers both GETs empty and leaves `PUT /memory/file` to this item (`app/e2e/fixture-kernel.ts:116`). The API server already reads a contributed route's JSON body for any method (`readBoundedBody`, `MAX_CONTRIBUTED_BODY_BYTES = 1024 * 1024`, `kernel/src/api/server.ts:58`). Reusable: `writeFileAtomic` (`kernel/src/tools/handoff.ts:70`), `appendEvent`/`NO_REF` (`kernel/src/loop/internal.ts`), `PROTECTED_DATA_DIRS`/`PROTECTED_DATA_FILES` (`kernel/src/sessions/policy.ts:166-178`, a leaf that imports only `node:path` and `../protected-paths.js`), `memoryDir`/`KERNEL_MEMORY_DIRS` (`kernel/src/brain/memory.ts`), `isValidAgentId` (`kernel/src/agents/types.ts:46`), `DiffView` (`app/src/components/DiffView`) |
| 3 | Architecture Fit | GO | A contributed route reaches the data dir through `req.store.dataDir` (`kernel/src/store/store.ts:68`). Same part shape as the merged siblings (`kernel/src/gui/tasks.ts`, `schedules.ts`) |
| 4 | Scope vs Supervisor Capability | CAUTION | ~15 source files plus 16 committed screenshots, and the security-relevant path guard needs its own careful worker: above one worker's bound. Split two ways (kernel / app), zero file overlap, as items 03–05 were |
| 5 | Hard Blockers | CAUTION | (a) The kernel writes no `memory_updated` event today, and an agent's own memory write records nothing (`docs/DESIGN.md` open point 3, `docs/OPEN_QUESTIONS.md:140`). This item records the event for the owner's writes only, so the screen cannot learn of an agent's write from the feed; the save's base-hash check is what protects the owner's edit. (b) The hash check and the write are not one atomic step against another *process* (a session writing the file directly): the window is the synchronous gap between the read and the rename. The brief keeps it synchronous (no `await` between them) and documents the limit honestly |

**Overall Verdict:** CAUTION

## Task
**Goal:** Serve `GET /memory`, `GET /memory/file` and the guarded `PUT /memory/file` from the `gui` feature's `memory` part, and replace the Memory placeholder with the screen the GUI v2 mockup designs: the tree of each agent's files and the shared files, the file view with its path, edit and save, and the conflict view that shows the text on disk beside the owner's edit. Commit light and dark screenshots of every Memory state the mockup shows.

**Problem Statement:**
Memory is markdown under `<dataDir>/memory/` (`memory/<agent>/…`, `memory/shared/…`), and invariant 8 promises it is inspectable and correctable, yet no route reads or writes it and the Memory screen is still the phase 7 foundation's placeholder. Agents write their lessons during sessions, so an owner's edit can race an agent's write. The write route is the first owner route that writes a file the caller names, so its path guard is this item's main risk.
Success looks like ⌘9 opening a tree of every agent's files and the shared files, each with its full path shown. The owner opens a file, edits it and saves it. A save over a file that changed since it was opened is refused, with both versions shown and nothing lost. Every path outside `memory/`, through a symlink, into `config/` or to a non-markdown file is refused, and nothing is written.

## Acceptance Criteria
- [ ] **AC1 (kernel, tree):** Given the fixture memory tree (`memory/wright/{role,preferences,people,lessons}.md`, a crew member `memory/mason/` with the same four files plus a `handoffs/` folder, `memory/shared/{README.md,about-me.md}`, `memory/_unassigned/handoffs/x.md`, `memory/playbooks/p.md`, a non-markdown `memory/mason/notes.txt` and a symlink `memory/mason/link.md`), when `GET /memory` is called, then it answers `MemoryTreeResponse`:
  - `agents`: one entry per folder directly under `memory/` whose name is `wright` or passes `isValidAgentId`. `wright` comes first, then the rest by id ascending. `shared`, `_unassigned` and `playbooks` are never agents.
  - Each agent's `files`: the regular `*.md` files directly in its folder (`lstat`: a symlink is not listed, and neither is a subfolder such as `handoffs/`). `role.md`, `preferences.md`, `people.md` and `lessons.md` come first, in that order, then any other file by name.
  - `shared`: the regular `*.md` files directly in `memory/shared/`, by name.
  - Each entry's `path` is relative to `memory/` (`mason/lessons.md`), with `size` in bytes and `modified` as the file's `mtime`, ISO.
  - No `memory/` folder answers `200 {agents: [], shared: []}`.
  - `kernel/test/gui-memory.test.ts` pins each of these.
- [ ] **AC2 (kernel, read):** Given a listed path, when `GET /memory/file?path=<path>` is called, then it answers `MemoryFileResponse`: `content` is the file's UTF-8 text, and `content_hash` is the SHA-256 hex digest of its bytes on disk. The path passes the same guard as the write (AC4), with the same codes and statuses. An absent file answers 404 `not_found`, and a file over the cap answers 400 `too_large`.
- [ ] **AC3 (kernel, write):** Given an edit saved with a matching `base_hash`, when `PUT /memory/file` is called, then:
  - The file's resolved target is written atomically with `writeFileAtomic` (temp file in the same folder, then rename).
  - It answers `200 MemoryWriteResponse` (`path`, the new `content_hash`, `size`, `modified`).
  - Exactly one `memory_updated` event is recorded, with `NO_REF` and payload `{path, by: "owner", size, content_hash}`.
  - Given a `base_hash` that no longer matches the file (an agent wrote after the owner opened it), it answers `409 MemoryConflictError` (`error: "changed_since_read"`, `current_content`, `current_hash`). The file is unchanged and no event is recorded.
  - Every refusal leaves the file byte-identical and records no event. Each test asserts both.
- [ ] **AC4 (kernel, the path guard; a test per case):** Given each of these, when `PUT /memory/file` is called (and `GET /memory/file`, for every path case), then the route refuses with the code shown and writes nothing:
  - a body that is not `{path: string, content: string, base_hash: string}`: 400 `invalid_body` (PUT only)
  - an absolute path (`/etc/x.md`): 400 `path_outside_memory`
  - a `..`, `.` or empty segment (`../config/x.md`, `wright/../../x.md`, `wright//role.md`), a backslash, a NUL, a path over 512 characters, or a path that is not exactly `<folder>/<file>`: 400 `invalid_path`
  - a file name that does not end in `.md`: 400 `not_markdown`
  - a first segment of `_unassigned` or `playbooks` (kernel-written handoffs and playbook mirrors): 400 `path_protected`
  - a first segment that is not `shared`, `wright` or a valid agent id: 400 `invalid_path`
  - `content` over `MAX_MEMORY_FILE_BYTES` (256 KiB, UTF-8 bytes): 400 `too_large`
  - an absent file (this item creates no file): 404 `not_found`
  - a symlink inside `memory/` whose real path is in `<dataDir>/config/`, in `<dataDir>/app/`, or is one of `PROTECTED_DATA_FILES` in `<dataDir>`: 400 `path_protected`
  - a symlink inside `memory/` whose real path leaves `memory/` anywhere else: 400 `path_outside_memory`
  - a symlink that stays inside `memory/` is checked again on its **real** path relative to the real `memory/`, with the same rules as a typed path: a link to `playbooks/p.md` or to `_unassigned/handoffs/x.md` answers 400 `path_protected`, a link to `mason/notes.txt` answers 400 `not_markdown`, and a link to `mason/handoffs/h.md` (not `<folder>/<file>`) answers 400 `invalid_path`
  - a `memory/` folder that is itself a symlink resolves through it: the real `memory/` is the boundary
  - `content` between 256 KiB and 1 MiB tests `too_large`. Above 1 MiB, the API server answers `413 {error: "body_too_large"}` before the handler runs (`kernel/src/api/server.ts:753-756`). That is not a `MemoryWriteRefusal` code, and it also writes nothing
  - The refusal list the kernel answers is exactly the contract's `MemoryWriteRefusal` union. The test reads `app/src/api/contract.ts` as text, as `kernel/test/console-contract.test.ts` does.
- [ ] **AC5 (kernel, seams):** Given the `gui` feature, when its pins run, then:
  - `memoryRoutes` holds exactly `GET /memory`, `GET /memory/file` and `PUT /memory/file`, and none sets `unauthenticated`.
  - `kernel/test/gui-foundation.test.ts`, `kernel/test/feature-seams.test.ts` and `kernel/test/console-contract.test.ts` pass unchanged.
- [ ] **AC6 (screen, tree and paths):** Given the fixture kernel's memory tree, when the Memory screen opens, then:
  - Every agent's files and the shared files are listed under their folder (`wright/`, `mason/`, `shared/`) with size, and the memory root path is shown above the tree. The root is `<data_dir>/memory/`, where `data_dir` comes from `GET /settings` (`SettingsResponse.data_dir`, `app/src/api/contract.ts:1269`; the fixture kernel answers a canned one, `app/e2e/fixture-kernel.ts:160`). The contract is not edited. Until `GET /settings` answers, or if it fails, the screen shows `memory/<path>` with no root. `MemoryScreen.test.tsx` pins both cases.
  - The overview reads "Pick a file", as the mockup's `memoryOverview` does.
  - Opening a file shows its full path (`memory/<path>` under the data folder), size, modified time, version (the content hash, first 8 characters), and its contents as text in a focusable `<pre>`.
  - With no files at all, the designed empty state shows ("Nothing remembered yet." and the mockup's note), never an empty tree.
- [ ] **AC7 (screen, edit and save):** Given a file view, when the owner chooses Edit, then:
  - A textarea holds the text, and the "Changes" inspector shows a `DiffView` of the edit against the text as opened. Save stays disabled until the text differs.
  - Save sends `PUT /memory/file` with the `content_hash` the file was opened at as `base_hash`. A `200` returns to the file view with the new version and the toast "Saved memory/<path>. Version <hash8>."
  - Cancel returns to the file view, discarding the edit.
- [ ] **AC8 (screen, conflict, nothing lost):** Given an agent's write after the owner opened the file, when the owner saves, then the kernel refuses `changed_since_read` and the screen shows the conflict view:
  - The attention band (`role="alert"`): "<path> changed since you opened it. Your save was refused, nothing was overwritten and nothing of yours is lost."
  - "On disk now" (`current_content`) beside "Your edit", and a `DiffView` from disk to the edit.
  - "Discard my edit" returns to the file view showing the disk text. "Copy my version" copies the draft to the clipboard. "Edit on top of the current version" opens the editor on the disk text plus the lines the owner added (the mockup's `mergeOnDisk`), with `current_hash` as the new base.
  - The owner's draft survives every refetch, a feed event and a kernel outage. A save that gets no answer, or any refusal other than `409` (a `400`, the `404`, or the API server's `413 body_too_large`), keeps the draft and says it was not saved, naming the code.
- [ ] **AC9 (unreachable):** Given the kernel becomes unreachable, when the tree, a file, the editor or the conflict view is showing, then the shell's `kernel-unreachable-band` shows, the screen keeps its last data (subtitle "last known"), and Edit, Save and the conflict's actions are disabled. The draft text stays, and nothing throws. The screen never falls back to the empty state.
- [ ] **AC10 (keyboard and palette):** Given the keyboard only:
  - ⌘9 opens Memory. J/K and ↓/↑ move between files in the tree, and Enter opens one. Tab reaches Edit, the textarea, Cancel, Save and every conflict action.
  - Esc from the file view returns to the tree with focus on that file's button. Esc from an unchanged editor returns to the file view.
  - The ⌘K palette lists `Open memory/<path>`, one per file (`memory.open:<path>`), and, while a file view is open, `Edit memory/<path>` (`memory.edit`). Both are group "Memory", owner `memory`, disabled while unreachable, and unregistered on unmount.
- [ ] **AC11 (live):** Given the screen is showing, when the feed delivers a `memory_updated` or `session_status` event, then the screen refetches `GET /memory` without a reload. A file view that is not being edited also refetches its file. The editor's draft is never replaced. Tree rows that did not change keep their position: the e2e compares their bounding boxes before and after.
- [ ] **AC12 (accessibility):** Given VoiceOver, then:
  - The tree is a `nav` labelled "Memory files", and each file button's accessible name is "<path>, <size>, modified <time>", as the mockup's.
  - The textarea is labelled "Contents of <path>", each `<pre>` has a label, and the conflict band is `role="alert"`. Saves and refusals are announced through a polite live region.
  - In both themes, `contrast.test.ts` gives at least 4.5:1 for every text token pair `memory.css` uses. `memory.css` uses only design tokens (no hex, `rgb(` or `hsl(`).
- [ ] **AC13 (polish gate, evidence file):** Given the built app, when `MEMORY_EVIDENCE=1 npx playwright test e2e/memory.spec.ts --workers=1` runs on macOS, then light and dark screenshots of each of the mockup's eight Memory states (empty, loading, populated, file, edit, conflict, error, unreachable) are written to `docs/evidence/phase-7-polish/memory/memory-<state>-<theme>.png`. A committed evidence file `docs/evidence/phase-7-polish/memory/README.md` names each pair against its mockup view id (`memory-empty` … `memory-unreachable`) and how the state was produced, and the PR body links to it. A spec test pins that the README lists exactly the 16 files and that the folder holds nothing else.
- [ ] **AC14 (validation):** Given the validation commands, when run, then all of these pass:
  - `cd kernel && npm ci && npm run typecheck && npm test`
  - `cd app && npm ci && npm run typecheck && npm test && npm run build`
  - `cd app && npx playwright test e2e/memory.spec.ts e2e/smoke.spec.ts --workers=1`, which launches only through `app/e2e/electron-harness.ts`
  - `bash scripts/check-docs.sh`

### Kernel route rules (AC1–AC4)

- **One guard, both routes.** `resolveMemoryPath(dataDir, path)` in `kernel/src/gui/memory-paths.ts` answers `{ok: true, relative, target}` (target is the real path) or `{ok: false, status, error}`. It runs the checks in this order: lexical shape, then absolute, then segments, then depth, then extension, then the kernel-written folders, then the first segment, then existence, then the real path against the protected set, then the real path against the real `memory/`, then **the real path's own shape**. `relative(realRoot, real)` is split on `sep` and run back through the same depth, extension, kernel-written-folder and first-segment checks (`checkShape(segments)`, the one function both passes call), so a link that stays inside `memory/` can never reach a file a typed path could not. Size and hash belong to the handlers.
- **Real paths.** The boundary is `realpathSync.native(memoryDir(dataDir))` plus `sep`. The protected set is `realpathSync.native(dataDir)` joined with each of `PROTECTED_DATA_DIRS` (prefix, plus `sep`) and each of `PROTECTED_DATA_FILES` (exact), imported from `../sessions/policy.js` and never copied. The target's real path comes from `realpathSync.native` on the joined path. A failure (`ENOENT`, a dangling link) answers `not_found`. A real path that is not a regular file also answers `not_found`.
- **Write.** Read the target's bytes, then hash them, compare with `base_hash`, call `writeFileAtomic(target, content)` and `appendEvent`. No `await` sits between the read and the rename, so no other kernel request interleaves. Another process can still write in that gap. That is a documented limit, and the event is written only after the rename succeeds. Write to the real target, never over a symlink inside `memory/`. The PUT does not use `req.serialized` (the kill switch's queue is never used for file IO).
- **Literals the pins name:** `export const MAX_MEMORY_FILE_BYTES = 256 * 1024;`, `export const MAX_MEMORY_PATH_LENGTH = 512;`, `export const MEMORY_UPDATED = "memory_updated";`, `export const MEMORY_WRITE_REFUSALS = ["invalid_body", "invalid_path", "path_outside_memory", "path_protected", "not_markdown", "too_large", "not_found", "changed_since_read"] as const;`, `const AGENT_FILE_ORDER = ["role.md", "preferences.md", "people.md", "lessons.md"];` and `const KERNEL_WRITTEN_DIRS = [UNASSIGNED_AGENT_DIR, PLAYBOOK_MIRROR_DIR];`.
- Every stored string (file text, file names) is returned as data, never interpreted (invariant 3).

## Touched-file invariants

> Grounded at base `78fb740251cbbba04ccf6b596b3484807faffe26`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/gui/memory.ts`** (17 lines)
  - Keep: the header rule, which wraps across lines 3–4. Its line-4 text is `// owner route that needs the API token: none sets \`unauthenticated\`.` Keep the exported names `memoryRoutes` and `memoryPart`; `kernel/src/gui/index.ts` re-exports them (`export { memoryPart, memoryRoutes } from "./memory.js";`). Keep the part shape `name: "memory"` with `tools`, `subcommands`, `handlers` and `dueWork` frozen and empty, and `routes: memoryRoutes`. `GUI_PARTS` order is unchanged.
  - Imports: types, the feature seam, `node:*`, `../brain/memory.js`, `../agents/types.js`, `../tools/handoff.js`, `../loop/internal.js`, `../sessions/policy.js` and its sibling `./memory-paths.js`. Never the Agent SDK, the session manager or `kernel.ts`: `kernel/src/gui/index.ts` says so (`never the Agent SDK, the session manager or \`kernel.ts\``), and `kernel/test/feature-seams.test.ts` pins the registry's module graph (`SDK_IN_GRAPH`).
  - Reuse: the merged siblings' handler idiom (`kernel/src/gui/tasks.ts`, `schedules.ts`: routes array `satisfies ContributedRoute[]`, each handler `(req: ContributedRouteRequest): Promise<ContributedRouteResponse>`).
  - Pinned by: `kernel/test/gui-foundation.test.ts` (`holds no tools, subcommands, handlers or due work in any part: gui parts serve routes only`, `serves no gui route unauthenticated`), and `kernel/test/feature-seams.test.ts`.
- **`app/src/screens/memory/index.tsx`** (17 lines)
  - Keep `export const screen: ScreenDefinition` with `id: "memory"`, `title: "Memory"` and `nav: { label: "Memory", order: 9, shortcut: "⌘9" }`. The shell discovers it through `import.meta.glob` in `App.tsx`, and `App.test.tsx` pins the routing loop (`"memory"`) and the palette row `["screens.memory", "Screens", "⌘9"]`.
  - The screen root keeps `data-testid="screen-memory"`: `App.test.tsx`'s routing loop asserts `screen.getByTestId(\`screen-${id}\`)` with no bridge.
  - With no `window.api`, the screen renders a plain state, never a throw (`getBridge() as StudioBridge | undefined`, the merged screens' idiom).
  - Stop importing `../placeholder`. `app/src/screens/placeholder.tsx` stays, because the remaining stubs use it.
- **`docs/architecture/threads.md`** (63 lines): line 48 says ``memory_updated` is not in the list: no kernel code writes that kind today``. Rewrite the clause to say the kernel now writes it for the owner's writes (`PUT /memory/file`, payload `{path, by: "owner", …}`). It is still not in `THREAD_EVENT_KINDS`, since it has no thread tie yet. Keep the link `[open questions](../OPEN_QUESTIONS.md#deferred-decisions)` and the last sentence unchanged.
- **`docs/OPEN_QUESTIONS.md`** (141 lines): line 140, `**Thread transcripts show no "memory updated" card.**`. Edit only the sentence ``no kernel code writes a `memory_updated` event``. It becomes: the kernel records one for the owner's writes only (item 06), and an agent's write records nothing. Keep the rest of the bullet and its link.
- **`docs/architecture/brain.md`** (258 lines): append three bullets (`GET /memory`, `GET /memory/file`, `PUT /memory/file`) to the bullet list under `## API and CLI`. The section opens with `The routes are contributed, so they are reached only with the bearer token.` Add an "Honest limits" bullet for the cross-process write window. Every other section stays unchanged.
- **Reused as-is (read, not modified):** `kernel/src/tools/handoff.ts` (`writeFileAtomic`, `UNASSIGNED_AGENT_DIR`), `kernel/src/brain/memory.ts` (`memoryDir`, `PLAYBOOK_MIRROR_DIR`), `kernel/src/agents/types.ts` (`isValidAgentId`), `kernel/src/sessions/policy.ts` (`PROTECTED_DATA_DIRS`, `PROTECTED_DATA_FILES`), `kernel/src/loop/internal.ts` (`appendEvent`, `NO_REF`), `app/src/api/contract.ts`, `app/src/components/DiffView`, `Badge`, `Button`, `Toast`, `app/src/store/react.ts` (`useLiveStore`), `app/src/commands/registry.ts`, `app/e2e/fixture-kernel.ts` (per-spec `routes` merge, `appendEvent`; `PUT /memory/file` is added per spec, never as a default). No subtask edits any of these.

## Closed enumerations touched

> Sibling grep at base `78fb740`: `grep -rn "draft_output_recorded" kernel/src app/src` → `kernel/src/integrations/drafts.ts:24,26,54`, `kernel/src/sessions/manager.ts:2535`, `kernel/src/console/threads.ts:59,79,256`, `app/src/screens/chat/Thread.tsx:158,282`, plus tests (`app/src/screens/tasks/model.test.ts:232`, `TasksScreen.test.tsx`, `chat/integrationCards.test.tsx`). `grep -rn "memory_updated" kernel/src` → no hits.

- **`memory_updated`** (a new event kind the kernel writes). `events.kind` is free `TEXT` (`kernel/src/store/migrations/001_initial.ts`), so no closed kernel list must name it. Each list the grep found:
  - `kernel/src/console/threads.ts` `THREAD_EVENT_KINDS`: **deliberately not added**. A kind there needs a tie, and an owner's memory write names no session or task. `docs/architecture/threads.md:48` records the decision, and the card stays a follow-up (DESIGN open point 3).
  - `app/src/screens/tasks/model.ts` `refetchWanted`: an open predicate (every kind except `session_output_appended`), so no change.
  - `app/src/screens/chat/Thread.tsx`: renders by kind for `draft_output_recorded` only. No change.
- **`MemoryWriteRefusal`** (`app/src/api/contract.ts:1167`) already holds the eight codes. The kernel's `MEMORY_WRITE_REFUSALS` must equal it, pinned by AC4's text-read test. `contract.ts` is not edited.
- **`MEMORY_REFETCH_KINDS`** (`["memory_updated", "session_status"]`) is a new closed set in the new `app/src/screens/memory/model.ts`. It extends no existing list.

## Pin mutations

> The new code's literals named here are fixed by this brief: each worker writes them exactly as quoted, so each mutation applies verbatim.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/gui-memory.test.ts`: `..` segment refused `invalid_path` | flip `if (segments.some((s) => s === "" \|\| s === "." \|\| s === ".."))` → `if (segments.some((s) => s === ""))` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: absolute path refused `path_outside_memory` | delete `if (isAbsolute(path)) return refuse(400, "path_outside_memory");` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: symlink leaving `memory/` refused `path_outside_memory` | flip `if (!real.startsWith(root + sep)) return refuse(400, "path_outside_memory");` → `if (false) return refuse(400, "path_outside_memory");` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: symlink into `config/` refused `path_protected` | delete `if (isProtected(real, dataRoot)) return refuse(400, "path_protected");` in `kernel/src/gui/memory-paths.ts` (the real path also leaves `memory/`, so the test asserts the exact code `path_protected`) |
| `kernel/test/gui-memory.test.ts`: a link inside `memory/` to `playbooks/p.md` refused `path_protected`, and to `mason/notes.txt` refused `not_markdown` | delete `const realShape = checkShape(relative(root, real).split(sep)); if (!realShape.ok) return realShape;` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: `playbooks/` and `_unassigned/` refused `path_protected` | flip `if (KERNEL_WRITTEN_DIRS.includes(folder))` → `if (false)` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: non-markdown refused `not_markdown` | flip `if (!name.endsWith(".md")) return refuse(400, "not_markdown");` → `if (false) return refuse(400, "not_markdown");` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: oversized body refused `too_large` | flip `export const MAX_MEMORY_FILE_BYTES = 256 * 1024;` → `export const MAX_MEMORY_FILE_BYTES = 256 * 1024 * 1024;` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: stale base hash refused `changed_since_read` with the disk text | flip `if (currentHash !== body.base_hash)` → `if (false)` in `kernel/src/gui/memory.ts` |
| `kernel/test/gui-memory.test.ts`: one `memory_updated` event per write | delete `appendEvent(req.store, MEMORY_UPDATED, NO_REF, { path: resolved.relative, by: "owner", size, content_hash: hash }, at);` in `kernel/src/gui/memory.ts` |
| `kernel/test/gui-memory.test.ts`: written atomically (no temp file left; the old text or the new, never torn) | flip `writeFileAtomic(resolved.target, body.content);` → `writeFileSync(resolved.target, body.content);` in `kernel/src/gui/memory.ts` (the test spies on `renameSync` through the module, or asserts the inode changed; the worker records which) |
| `kernel/test/gui-memory.test.ts`: a symlinked file is written at its real target, the link kept | flip `writeFileAtomic(resolved.target, body.content);` → `writeFileAtomic(join(memoryDir(req.store.dataDir), resolved.relative), body.content);` in `kernel/src/gui/memory.ts` |
| `kernel/test/gui-memory.test.ts`: tree lists no symlink and no subfolder | flip `if (!entry.isFile()) continue;` → `if (entry.isDirectory()) continue;` in `kernel/src/gui/memory.ts` |
| `kernel/test/gui-memory.test.ts`: role, preferences, people, lessons first | flip `const AGENT_FILE_ORDER = ["role.md", "preferences.md", "people.md", "lessons.md"];` → `const AGENT_FILE_ORDER: string[] = [];` in `kernel/src/gui/memory.ts` |
| `kernel/test/gui-memory.test.ts`: `shared`/`_unassigned`/`playbooks` are never agents | flip `if (name !== "wright" && !isValidAgentId(name)) continue;` → `if (name === "shared") continue;` in `kernel/src/gui/memory.ts` |
| `kernel/test/gui-memory.test.ts`: refusal list equals the contract's union | delete `"path_protected",` from `MEMORY_WRITE_REFUSALS` in `kernel/src/gui/memory-paths.ts` |
| `kernel/test/gui-memory.test.ts`: `memoryRoutes` holds exactly the three routes | delete `{ method: "PUT", path: "/memory/file", handler: writeHandler },` in `kernel/src/gui/memory.ts` |
| `kernel/test/gui-foundation.test.ts`: no unauthenticated gui route | flip `{ method: "GET", path: "/memory", handler: treeHandler },` → `{ method: "GET", path: "/memory", handler: treeHandler, unauthenticated: true },` in `kernel/src/gui/memory.ts` |
| `app/src/screens/memory/model.test.ts`: feed refetch on the two kinds only | flip `export const MEMORY_REFETCH_KINDS = ["memory_updated", "session_status"] as const;` → `export const MEMORY_REFETCH_KINDS = ["memory_updated"] as const;` in `app/src/screens/memory/model.ts` |
| `app/src/screens/memory/model.test.ts`: carry-over keeps the disk text and adds only the owner's added lines | flip `return [...current.split("\n"), ...added].join("\n");` → `return mine;` in `app/src/screens/memory/model.ts` |
| `app/src/screens/memory/model.test.ts`: line diff marks an added line | flip `out.push({ kind: "add", newNumber: j + 1, text: b[j] });` → `out.push({ kind: "context", oldNumber: i + 1, newNumber: j + 1, text: b[j] });` in `app/src/screens/memory/model.ts` |
| `app/src/screens/memory/MemoryScreen.test.tsx`: no bridge renders a plain state | delete `if (api === undefined) return <MemoryNoKernel />;` in `app/src/screens/memory/index.tsx` |
| `app/src/screens/memory/MemoryScreen.test.tsx`: empty state when no files | delete `if (fileCount(tree) === 0) return <MemoryEmpty />;` in `app/src/screens/memory/MemoryScreen.tsx` |
| `app/src/screens/memory/MemoryScreen.test.tsx`: save sends the opened hash as `base_hash` | flip `base_hash: draft.baseHash,` → `base_hash: "",` in `app/src/screens/memory/MemoryScreen.tsx` |
| `app/src/screens/memory/MemoryScreen.test.tsx`: a `409` shows both versions and keeps the draft | flip `if (result.status === 409) setConflict(result.body as MemoryConflictError);` → `if (result.status === 409) setDraft(undefined);` in `app/src/screens/memory/MemoryScreen.tsx` |
| `app/src/screens/memory/MemoryScreen.test.tsx`: palette commands unregistered on unmount | delete `return () => registry.unregister(MEMORY_OWNER);` in `app/src/screens/memory/MemoryScreen.tsx` |
| `app/src/screens/memory/contrast.test.ts`: tokens only in `memory.css` | add `.memory-tree { color: #777; }` to `app/src/screens/memory/memory.css` |
| `app/src/screens/memory/contrast.test.ts`: ≥ 4.5:1 in both themes | flip the file-title rule's `color: var(--ink);` → `color: var(--ink-tertiary);` in `app/src/screens/memory/memory.css` (red if that pair is below 4.5:1; if it is not, the worker names a token pair that is and records it in the test comment) |
| `app/e2e/memory.spec.ts`: live update without reload | delete `useEffect(() => { void refetchTree(); }, [refetchTree, feedMark]);` in `app/src/screens/memory/MemoryScreen.tsx` |
| `app/e2e/memory.spec.ts`: unreachable keeps last data, never the empty state | flip `setTree((last) => (result.status === 0 ? last : result.ok ? result.body : last));` → `setTree(result.ok ? result.body : undefined);` in `app/src/screens/memory/MemoryScreen.tsx` |
| `app/e2e/memory.spec.ts`: keyboard J/K move between files | delete `case "j":` in `app/src/screens/memory/MemoryScreen.tsx` |
| `app/e2e/memory.spec.ts`: README lists the 16 screenshots | delete `memory-conflict-dark.png` in `docs/evidence/phase-7-polish/memory/README.md` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `GET /memory`, `GET /memory/file` and the guarded `PUT /memory/file` in the gui `memory` part, and their docs | AC1–AC5, AC14 (kernel + docs) | 4 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: the Memory screen (tree, file view, edit, conflict), palette commands, e2e and polish-gate evidence | AC6–AC13, AC14 (app) | 1 modify, 11 create (+16 PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 kernel-memory | `kernel/src/gui/memory.ts` (17), `docs/architecture/brain.md` (258), `docs/architecture/threads.md` (63), `docs/OPEN_QUESTIONS.md` (141) | `kernel/src/gui/memory-paths.ts` (the one path guard, `MAX_MEMORY_FILE_BYTES`, `MAX_MEMORY_PATH_LENGTH`, `MEMORY_WRITE_REFUSALS`, `resolveMemoryPath`), `kernel/test/gui-memory.test.ts` | HIGH |
| 2 app-memory | `app/src/screens/memory/index.tsx` (17) | `app/src/screens/memory/MemoryScreen.tsx` (state, fetches, save, feed, palette), `app/src/screens/memory/MemoryViews.tsx` (tree, overview, file view, editor, conflict view, empty/loading/error), `app/src/screens/memory/model.ts` (pure TS: line diff → `DiffHunk[]`, carry-over, `MEMORY_REFETCH_KINDS`, size/version/label formatting, tree flattening for J/K), `app/src/screens/memory/commands.ts` (palette commands, the Schedules idiom), `app/src/screens/memory/model.test.ts`, `app/src/screens/memory/MemoryScreen.test.tsx`, `app/src/screens/memory/contrast.test.ts`, `app/src/screens/memory/memory.css`, `app/e2e/memory.spec.ts`, `app/e2e/fixtures/memory.ts` (the fixture tree, files and a `PUT /memory/file` that answers 200, 409 or no answer per test), `docs/evidence/phase-7-polish/memory/README.md`, `docs/evidence/phase-7-polish/memory/*.png` (16: `memory-{empty,loading,populated,file,edit,conflict,error,unreachable}-{light,dark}.png`) | HIGH |

Module layout: no MODIFY path is near the 500-line threshold. Each new responsibility gets one home:
- The path guard has its own module, `memory-paths.ts`, so the security-relevant checks are read and reviewed in one place. Both routes call it, and nothing else copies it.
- The handlers stay in `memory.ts`, the part item 01 made for them.
- Diff and carry-over live in `model.ts` (pure, unit-tested). Views go in `MemoryViews.tsx` and state in `MemoryScreen.tsx`, as the Tasks screen splits `TasksScreen.tsx` from `TasksViews.tsx`.
- Fixtures go in `app/e2e/fixtures/memory.ts`, as `fixtures/tasks.ts` does.
- The line diff is new: no app module computes one today (`DiffView` takes hunks). The contrast helper in `contrast.test.ts` follows `app/src/screens/schedules/contrast.test.ts`. It is the second copy, so extracting it is a follow-up once both have landed. It is not done here, because the shared module would be a cross-lane file.
- If `MemoryScreen.tsx` grows past 500 lines, the conflict handling moves to `useMemoryFile.ts` in the same directory, which sits inside lane `app/src/screens/memory/**`.

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` check 1 scans every `docs/**/*.md` for relative links, so `docs/evidence/phase-7-polish/memory/README.md` must link only to paths that exist (e.g. `../../../design/mockups/gui-v2.html`).

**Total estimated files:** 5 modify + 13 create (+16 generated PNGs)

### Subtask Contracts

```yaml
# Subtask 1 — kernel memory routes (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/gui/memory.ts", name: "memoryRoutes"}
  - {kind: "symbol", path: "kernel/src/gui/memory.ts", name: "memoryPart"}
  - {kind: "symbol", path: "kernel/src/gui/memory.ts", name: "MEMORY_UPDATED"}
  - {kind: "symbol", path: "kernel/src/gui/memory-paths.ts", name: "resolveMemoryPath"}
  - {kind: "symbol", path: "kernel/src/gui/memory-paths.ts", name: "MEMORY_WRITE_REFUSALS"}
  - {kind: "symbol", path: "kernel/src/gui/memory-paths.ts", name: "MAX_MEMORY_FILE_BYTES"}
  - {kind: "file", path: "kernel/test/gui-memory.test.ts"}
requires: []
lanes:
  - "kernel/src/gui/memory.ts"
  - "kernel/src/gui/memory-paths.ts"
  - "kernel/test/gui-memory.test.ts"
  - "docs/architecture/brain.md"
  - "docs/architecture/threads.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires: []

# Subtask 2 — app Memory screen (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "app/src/screens/memory/index.tsx", name: "screen"}
  - {kind: "symbol", path: "app/src/screens/memory/MemoryScreen.tsx", name: "MemoryScreen"}
  - {kind: "symbol", path: "app/src/screens/memory/model.ts", name: "lineDiff"}
  - {kind: "symbol", path: "app/src/screens/memory/model.ts", name: "carryOver"}
  - {kind: "symbol", path: "app/src/screens/memory/model.ts", name: "MEMORY_REFETCH_KINDS"}
  - {kind: "symbol", path: "app/src/screens/memory/commands.ts", name: "MEMORY_OWNER"}
  - {kind: "file", path: "app/src/screens/memory/MemoryViews.tsx"}
  - {kind: "file", path: "app/src/screens/memory/model.test.ts"}
  - {kind: "file", path: "app/src/screens/memory/MemoryScreen.test.tsx"}
  - {kind: "file", path: "app/src/screens/memory/contrast.test.ts"}
  - {kind: "file", path: "app/src/screens/memory/memory.css"}
  - {kind: "file", path: "app/e2e/memory.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/memory.ts"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/memory/README.md"}
requires: []
lanes:
  - "app/src/screens/memory/**"
  - "app/e2e/memory.spec.ts"
  - "app/e2e/fixtures/memory.ts"
  - "docs/evidence/phase-7-polish/memory/**"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```

The two subtasks have no build-time dependency. The app codes against `app/src/api/contract.ts`, which this item does not change, and the e2e runs against the fixture kernel (`app/e2e/fixture-kernel.ts` plus per-spec routes from `app/e2e/fixtures/memory.ts`), never the real kernel. The kernel never imports the app. The shared interface is the contract's shapes plus the rules in this brief:
- the refusal codes and statuses (AC4; `409` for `changed_since_read` with `current_content`/`current_hash`)
- paths relative to `memory/`
- `content_hash` is opaque to the app
- the `memory_updated` payload `{path, by: "owner", size, content_hash}`

Subtask 2's fixtures must answer in exactly that form.

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | base 78fb740, read this session |
| `docs/OPEN_QUESTIONS.md:140` | yes | HOLDS | `- **Thread transcripts show no "memory updated" card.** … no kernel code writes a \`memory_updated\` event` | base 78fb740, read this session |
| `app/e2e/fixture-kernel.ts:116` | yes | HOLDS | `` * `PUT /memory/file` has no default: item 06 adds it.`` | base 78fb740, read this session |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The write route is the first owner route that writes a file the caller names. A missed case writes outside `memory/` or into `config/` (D34, invariant 3). Source: the requirement's Risks | HIGH | One guard module (`memory-paths.ts`) that both routes call, with a fixed check order. Real paths are compared against the real `memory/` and the real protected set (imported from `sessions/policy.ts`, never copied). The route writes only existing files, at their real target. There is a test per case, each asserting the file is byte-identical and no event was recorded, and a mutation per check (Pin mutations) |
| An agent writes after the owner opened the file. Sources: Feasibility (Phase 2.5) and the requirement's Problem | HIGH | A base-hash check that refuses `changed_since_read` with the disk text, and the conflict view keeps the draft (AC8). Within one kernel the read, hash, rename and event run with no `await` between them. **Honest limit:** another process (a session's own file write) can still land in that microsecond gap. It is documented in `docs/architecture/brain.md` "Honest limits", never claimed as atomic |
| An agent's write records no event. The screen cannot see it live, and the mockup's "See who wrote it in the audit log" has nothing to show. Source: Feasibility (Phase 2.5), DESIGN open point 3 | MEDIUM | The tree also refetches on `session_status`, since a session ending is when lessons are written. The audit-log link is **not built**: the evidence README records the omission against `memory-conflict`, for the owner's approval of the PR (D9), and points to open point 3. Tracking agent writes is the owner's decision and is not taken here |
| Scope vs Supervisor capability: ~15 source files plus 16 screenshots. Source: Feasibility (Phase 2.5) | MEDIUM | Split kernel / app on `genuine-parallelism` with zero overlap. The app reuses `DiffView`, the palette registry and the live store, without rebuilding them |
| `docs/OPEN_QUESTIONS.md` is a hot file that sibling lanes (items 07, 08) may also edit in this wave | MEDIUM | Subtask 1 edits one sentence of one bullet (line 140) and nothing else. A merge conflict there is textual: keep both edits |
| A large file's line diff is quadratic | LOW | `lineDiff` refuses above `MAX_DIFF_CELLS = 4_000_000` (lines × lines) and the view says the file is too large to compare here. Save still works. 256 KiB caps the file anyway |
| Screenshots are macOS-only and pixel-unstable, while CI is Ubuntu | MEDIUM | As `tasks.spec.ts` does: write to `docs/evidence/…` only with `MEMORY_EVIDENCE=1`, otherwise to Playwright's output dir. The spec asserts behaviour, never pixels |
| The layout-shift assertion is flaky if the tree re-renders wholesale on refetch | MEDIUM | Key tree rows by `path` (never by index), and compare the bounding boxes of an unchanged row and of the folder headers before and after the event |
| Prior churn: the recurring class on gui and screen items is `self_heal_churn`. Source: Prior churn (postmortem ledger, 87 `self_heal_churn` lines) | MEDIUM | Mirror each file's idiom exactly (Touched-file invariants), leave `fixture-kernel.ts` untouched (per-spec routes only), and run every validation command before hand-back |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** genuine-parallelism

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-the-memory-screen.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-31T03:03:51Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/185
- **Branch:** feature/the-memory-screen
- **Files changed:** 36
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel memory routes (GET /memory, GET /memory/file, guarded PUT /memory/file with one path guard and a memory_updated event for owner writes) and the app Memory screen (tree, file view, edit and save, conflict view, palette, live refetch, e2e, 16 polish-gate screenshots). Phase 4.5: review 1 PASS with one MEDIUM at the fix floor (duplicated WCAG contrast helper), fixed in 5b3fd58 (app/src/styles/test-support.ts). Review 2 PASS with no findings. 2 LOW dismissed below the floor (marker comment posted). CI required checks green. Risk classification high_risk=true (auth/crypto/token content matches, size). Red-team lens not enabled.
