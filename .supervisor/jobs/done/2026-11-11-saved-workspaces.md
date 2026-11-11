# Supervisor Job: Saved workspaces: a kernel-kept list of the owner's repo folders, shown and edited in Settings → Workspaces, looked up by repo (phase 8 item 18c)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-10-173433/L3
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement is under the gitignored `.supervisor/`, so its provenance is not in git history)
- **Source requirement:** .supervisor/requirements/phase-8-18/2026-11-10-204053-saved-workspaces.md
- **Base commit:** 0b9ef984dade494df1d10a565371cdd689bd1785

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (better-sqlite3 migrations, vitest), React/Electron app (vitest, Playwright e2e). Nothing new. |
| 2 | Dependency Availability | GO | No new dependency. Electron's `dialog.showOpenDialog` serves the folder picker. |
| 3 | Architecture Fit | GO | One append-only migration, one new console part (`kernel/src/console/workspaces.ts`) beside `threads.ts`, and contract routes like phase 8 item 17's. Reuses `readWorkspaceRepos` (`kernel/src/automate/checkout.ts`) and `isProtectedPath` (`kernel/src/protected-paths.ts`). |
| 4 | Scope vs Supervisor Capability | CAUTION | About 32 files across kernel, app, Electron bridge, e2e and docs. That is past one worker's context, so it is split in two (`context-bound`). |
| 5 | Hard Blockers | CAUTION | The plan needs files outside the requirement's Touches: closed migration and route pins in kernel tests, the Electron bridge for the folder picker, and docs that count routes. They are recorded in `## Scope widening` for the coordinator. |

**Overall Verdict:** CAUTION

## Task
**Goal:** The kernel keeps one list of the owner's saved workspaces (folder path, the GitHub repo its remote names, last used). Settings → Workspaces lists it, adds a folder through a folder picker and removes rows. A lookup by `<owner>/<repo>` re-reads each folder fresh. Only the owner's console routes write the list; no session can.

**Problem Statement:**
The owner needs the repo folders they choose to be remembered in one visible, editable list, so that next time a crew member needs that repo the folder is offered instead of browsed for again.
Currently, each crew member's settings file holds its own `workspaces` (`config/agents/<id>.json`, D34), shown read-only on Team → inspector. Nothing is shared or remembered between members. This causes the owner to re-enter the same path for each member, and Wright and the charter card have no saved folder to offer.
Success looks like this: a folder saved once is listed with its repo, path and last used time; a lookup for its repo returns it, most recently used first, and marks a moved or deleted one as missing; a protected or non-checkout folder is refused in plain words.

**Owner decision (Launch Pad LP-CLARIFY, 2026-11-11):** route only. 18c ships the store, the routes, Settings → Workspaces and an exported lookup function. 18c adds no Wright kernel tool. Wright's read tool comes with 18d, which consumes it. The charter card (18d) calls `GET /workspaces?repo=`.

**Design (the requirement leaves the table and routes to the design):**
- **Table** `saved_workspaces` (migration 24, `saved_workspaces`): `id INTEGER PRIMARY KEY`, `path TEXT NOT NULL UNIQUE` (absolute, resolved with `resolvedPath` from `protected-paths.ts`, so a symlinked or firmlinked spelling of one folder is one row), `repo TEXT` (nullable: the first GitHub remote at save time, `owner/repo`; null when there is none), `added_at TEXT NOT NULL`, `last_used_at TEXT NOT NULL` (ISO-8601 from the kernel clock, `req.now()`). No SQL trigger (the integrity check refuses unlisted triggers). `CREATE TABLE IF NOT EXISTS`, so it is safe to re-run.
- **Console part** `workspacesPart` in a new `kernel/src/console/workspaces.ts`, appended sixth to `CONSOLE_PARTS`. It has three routes, all behind the bearer token, no tools, no handlers, no due work:
  - `GET /workspaces`: every saved row, each re-read fresh, ordered `last_used_at` descending, as `{workspaces: [{id, path, repo, added_at, last_used_at, state}]}`. `state` is one of `ready` (a git checkout whose remotes are read: `readWorkspaceRepos(path).kind === "repos"`), `missing` (`not_checkout`: the folder or its `.git` is gone or moved) or `unreadable` (a read failed, `EACCES`/`EPERM`; never `ready`). With `?repo=<owner>/<repo>` it is the lookup: the rows whose fresh-read remotes name that repo (case-insensitive), plus the rows whose stored `repo` names it but now read `missing`/`unreadable`, in the same order. A malformed `repo` answers `400 invalid_input`.
  - `POST /workspaces` with body `{path}`: save, or touch when already saved. An absolute path is required (`400 invalid_input`). A path inside a macOS-protected folder answers `400 protected_folder` with D31's plain reason, and nothing is written. A folder that is not a git checkout (missing, or no `.git`) answers `400 not_checkout`, and an unreadable one answers `400 unreadable`; neither writes anything. Otherwise it upserts the row: `repo` is the first GitHub remote (or null), and `last_used_at` is now (a new row also sets `added_at`). The answer is `200 {workspace, note}`. `note` is null unless `repo` is null; then it is a plain sentence saying the folder has no GitHub remote, so it won't be matched to a repo. The same route is how 18d's card records a chosen folder (scope 4: chosen ⇒ saved, last used updated).
  - `POST /workspaces/:id/remove`: deletes that row only, answers `200 {removed: id}`; an invalid or absent id answers `404 not_found`. It never reads or writes any `config/agents/*.json`.
- **Lookup function** `lookupSavedWorkspaces(store, repo)` exported from `kernel/src/console/workspaces.ts` (the one implementation both the route and 18d's later Wright tool use).
- **D31 reason, one sentence:** extract `protectedFolderRefusal(path)` into `kernel/src/protected-paths.ts`, returning exactly the sentence `charter-files.ts`'s `workspaceProblem` builds today. `charter-files.ts` and the new route both call it, so the D31 sentence keeps one home.
- **Owner-only (AC7):** the routes need the Keychain-held bearer token (`kernel/src/api/token.ts`), which no session holds. `studio.db` and `api.json` are in `PROTECTED_DATA_FILES` (`kernel/src/sessions/policy.ts`), so a session's file tools can't write the table. No kernel tool and no `studio` subcommand writes the list.
- **App:** `WorkspacesSection.tsx` (a new section on Settings, below Threads) is built to `docs/design/mockups/charter-card.html` `settingsScreen()` and `docs/DESIGN.md` §"Settings → Workspaces (18c)". It is a table of repo, path (shown from `~` through `formatHomePath`) and last used, with a remove icon on each row (Lucide `trash-2`, tooltip). It has Add folder…, Undo in place of a removed row (Undo re-saves the same path, so its last used becomes now; this is an honest limit), and empty, loading and error states. A `missing` row is labelled "Missing" in words; an `unreadable` row is labelled "Can't be read". A refusal or a `note` is shown in plain words. The folder picker is a new bridge member `chooseFolder()` (`studio:choose-folder`; the main process opens `dialog.showOpenDialog({properties: ["openDirectory"]})` for the owner's window only and answers the chosen absolute path or `null`). The renderer never reads the disk itself.

## Acceptance Criteria
- [ ] **AC1.** Given the owner adds (`POST /workspaces`) a folder that is a git checkout with remote `https://github.com/<owner>/<repo>.git` outside the protected folders, when it is saved, then `GET /workspaces` lists it with `repo: "<owner>/<repo>"`, its path, a `last_used_at` and `state: "ready"`, and Settings → Workspaces shows a row with repo `<owner>/<repo>`, its path and a last-used time (kernel test in `kernel/test/console-workspaces.test.ts` against a real temp git checkout; app test in `WorkspacesSection.test.tsx`; e2e in `app/e2e/settings-workspaces.spec.ts`).
- [ ] **AC2.** Given three saved workspaces, two with remote `<owner>/<repo>` (saved at different times) and one with `<owner>/<other>`, when `GET /workspaces?repo=<owner>/<repo>` (and `lookupSavedWorkspaces(store, "<owner>/<repo>")`) runs, then exactly the two `<owner>/<repo>` rows are returned, most recently used first. Saving the older one again moves it first.
- [ ] **AC3.** Given a saved workspace and a crew member whose `config/agents/<id>.json` lists the same folder, when the owner removes it (`POST /workspaces/:id/remove`, or the row's remove icon), then the list no longer has it, and the member's settings file is byte-for-byte unchanged (sha256 before and after). Settings shows the removed row with Undo.
- [ ] **AC4.** Given a saved workspace whose folder is then renamed or deleted, when `GET /workspaces?repo=<owner>/<repo>` runs, then it is returned with `state: "missing"`, never `"ready"`. Given a folder whose `.git` can't be read (`EACCES`), it is `state: "unreadable"`, never `"ready"`. Settings shows the missing row as "Missing" in words.
- [ ] **AC5.** Given a git checkout with no remote, or only a non-GitHub remote (`https://gitlab.com/<owner>/<repo>.git`), when it is saved, then the row is saved with `repo: null`, the answer's `note` says it won't be matched to a repo, no `?repo=` lookup returns it, and Settings shows that note.
- [ ] **AC6.** Given a folder inside `~/Documents`, `~/Desktop`, `~/Downloads` or `~/Library/Mobile Documents` (iCloud Drive), and also a symlink into one, when `POST /workspaces` is called, then it answers `400 protected_folder` whose message is `protectedFolderRefusal(path)` (naming the folder, the protected list and `PROTECTED_FOLDER_WHY`), and the `saved_workspaces` table is unchanged. A folder that is not a git checkout answers `400 not_checkout` and saves nothing. Settings shows the refusal in plain words.
- [ ] **AC7.** Given a session (Wright or crew), when it tries to add or remove a saved workspace, then the attempt is refused. A test pins all four of the following: (a) no shipped kernel tool's name or input touches saved workspaces (the merged composition's tools include none whose name contains `workspace`); (b) no `studio` subcommand writes them; (c) the three routes are console routes reached only with the bearer token (an unauthenticated request to `POST /workspaces` answers 401 through the API server); and (d) the session policy denies a session's write to `<dataDir>/studio.db` (`PROTECTED_DATA_FILES`).
- [ ] **AC8 (doc and contract currency).** Given the merged diff, when `kernel/test/console-contract.test.ts` and `bash scripts/check-docs.sh` run, then they pass, with: `app/src/api/contract.ts` lists the three routes as origin `p8-item-18` with their shapes, `kernel/test/console-contract.test.ts` pins them and their being served, and `docs/architecture/agents.md` gains a "Saved workspaces" section naming the table, the routes, the lookup's states and the owner-only rule. `bash scripts/check-docs.sh` passes.
- [ ] **AC9 (running-system evidence).** Given Subtask 2 is complete, when the PR is opened, then a committed evidence file `docs/evidence/phase-8-18c-saved-workspaces.md` contains: the static suite commands and their pass counts (`cd kernel && npm ci && npm run typecheck && npm test`; `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`; `bash scripts/check-docs.sh`), and a `## Validation 2 (owner)` section holding the owner's steps (in the packaged app, add a checkout of vikashruhilgit/studio-sandbox in Settings → Workspaces and see it listed with its repo; try a folder in `~/Documents` and see the plain refusal) with a place for what each showed. The `Verdict: PASS for Validation 2` line is written only from the owner's report, never by a worker. The PR body links to the file.

## Scope widening
- kernel/src/agents/charter-files.ts
- kernel/src/store/migrations/024_saved_workspaces.ts
- kernel/src/console/workspaces.ts
- kernel/test/console-workspaces.test.ts
- kernel/test/console-foundation.test.ts
- kernel/test/console-contract.test.ts
- kernel/test/console-threads.test.ts
- kernel/test/store.test.ts
- kernel/test/integrations-github-app-migration.test.ts
- kernel/test/integrations-foundation.test.ts
- kernel/test/phase-8-foundation.test.ts
- kernel/test/brain-threads.test.ts
- docs/ARCHITECTURE.md
- app/src/screens/settings/WorkspacesSection.tsx
- app/src/screens/settings/WorkspacesSection.test.tsx
- app/src/screens/settings/settings.css
- app/electron/channels.ts
- app/electron/main.ts
- app/electron/preload.ts
- app/electron/main.test.ts
- app/electron/preload.test.ts
- app/e2e/fixtures/settings.ts
- app/e2e/settings-workspaces.spec.ts
- docs/architecture/app.md
- docs/evidence/phase-8-18c-saved-workspaces.md
- /workspaces/:id/remove
- accepted: LP-SCOPE 2026-11-11

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel store | `kernel/src/store/migrations/index.ts` (53) | `kernel/src/store/migrations/024_saved_workspaces.ts` | HIGH |
| kernel console | `kernel/src/console/index.ts` (119), `kernel/src/protected-paths.ts` (140), `kernel/src/agents/charter-files.ts` (656: one call swapped to the extracted helper, no new code there) | `kernel/src/console/workspaces.ts` (the saved-workspaces part: store reads/writes, lookup, three routes) | HIGH |
| kernel tests | `kernel/test/console-foundation.test.ts` (263), `kernel/test/console-contract.test.ts` (400), `kernel/test/console-threads.test.ts` (its contract regex reads `p8-item-17` only; verify, change only if it breaks), `kernel/test/store.test.ts` (2282: only the existing migration-list pins flip from 23 to 24, the single authority for those pins; no new test lands there), `kernel/test/integrations-github-app-migration.test.ts` (154), `kernel/test/integrations-foundation.test.ts` (937: last-migration pins only), `kernel/test/phase-8-foundation.test.ts` (713: last-migration pins only), `kernel/test/brain-threads.test.ts` (813: last-migration pin only) | `kernel/test/console-workspaces.test.ts` (every AC1–AC7 kernel test) | HIGH |
| contract | `app/src/api/contract.ts` (1823: appended there because it is the single route contract that `console-contract.test.ts` reads as text) | — | HIGH |
| kernel docs | `docs/architecture/agents.md` (370), `docs/ARCHITECTURE.md` (326) | — | HIGH |
| app settings | `app/src/screens/settings/SettingsScreen.tsx` (257), `app/src/screens/settings/SettingsScreen.test.tsx` (718: one render pin only; the section's tests live in the new file), `app/src/screens/settings/settings.css` (417: the Workspaces table classes appended; the screen's one stylesheet) | `app/src/screens/settings/WorkspacesSection.tsx`, `app/src/screens/settings/WorkspacesSection.test.tsx` | HIGH |
| electron bridge | `app/electron/channels.ts` (38), `app/electron/main.ts` (219), `app/electron/preload.ts` (51), `app/electron/main.test.ts` (542: the channel list pin plus one `describe` for the new channel, matching the home-dir channel's), `app/electron/preload.test.ts` (108) | — | HIGH |
| e2e | `app/e2e/fixtures/settings.ts` (226) | `app/e2e/settings-workspaces.spec.ts` (new spec; `settings.spec.ts` at 788 lines is not grown) | MEDIUM |
| app docs / evidence | `docs/architecture/app.md` (196) | `docs/evidence/phase-8-18c-saved-workspaces.md` | HIGH |

**Module layout (one home per new responsibility):** the saved-workspaces store, lookup and routes go in the CREATE `kernel/src/console/workspaces.ts`. The D31 refusal sentence is extracted: `protectedFolderRefusal` goes into `kernel/src/protected-paths.ts` (the shared leaf module), with `charter-files.ts` as the one existing copy switched to call it. The remote read reuses `readWorkspaceRepos` in `kernel/src/automate/checkout.ts` (unchanged). The UI goes in the CREATE `WorkspacesSection.tsx`. The bridge member follows `homeDir`'s pattern in the existing bridge files.

**Validator-owned surfaces:** `scripts/check-docs.sh` checks relative links in `docs/`, `CLAUDE.md` and `README.md`. Every new link in `agents.md`, `app.md` and `ARCHITECTURE.md` must resolve.

**Total estimated files:** 25 modify + 7 create (Subtask 1: 15 modify, 3 create; Subtask 2: 10 modify, 4 create)

## Touched-file invariants

> Grounded at base `0b9ef984dade494df1d10a565371cdd689bd1785`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/store/migrations/index.ts`** — keep: `/** Every migration, in ascending version order. Append only; never edit a shipped one. */`; the new migration is appended after `playbookJobs,` as version 24, and no shipped migration is edited. Reuse: the migration shape of `023_playbook_jobs.ts` (`export const playbookJobs: Migration = {`), idempotent `up`. Pinned by: `kernel/test/store.test.ts` (`[23, "playbook_jobs"],` list and `toEqual([1, 2, 3, ... 22, 23])`), `kernel/test/integrations-github-app-migration.test.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/phase-8-foundation.test.ts` and `kernel/test/brain-threads.test.ts` (`.toEqual([23, "playbook_jobs"])`).
- **`kernel/src/console/index.ts`** — keep: `export const CONSOLE_PARTS: readonly ConsolePart[] = Object.freeze([eventsPart, outputPart, controlPart, pausePart, threadsPart]);` gains `workspacesPart` last. The module imports only types, the feature seam and its own parts: `never the Agent SDK, the session manager or \`kernel.ts\``. The new part may import `../automate/checkout.js` and `../protected-paths.js` (both already CLI-safe), nothing heavier. Update the header comment's part list. Pinned by: `kernel/test/console-foundation.test.ts` (`expect(CONSOLE_PARTS.map((p) => p.name)).toEqual(["events", "output", "control", "pause", "threads"]);`) and `kernel/test/feature-seams.test.ts` (the registry module graph).
- **`kernel/src/protected-paths.ts`** — keep: `// A leaf module: it imports nothing from \`service/\` or \`sessions/\`.`; `PROTECTED_LOCATIONS` stays the ONE list; `PROTECTED_FOLDER_WHY` text unchanged. Add `protectedFolderRefusal(path)` returning exactly `` `${workspace} is inside a macOS-protected folder (${protectedLocationsText()}), so it can't be used: ${PROTECTED_FOLDER_WHY}; use a copy of the repo outside those folders` `` with `path` in place of `workspace`.
- **`kernel/src/agents/charter-files.ts`** — keep: `workspaceProblem`'s refusal text byte-identical (it is pinned by `kernel/test/agents-roster.test.ts` / charter tests through the message, and is the settings reader's rule written twice, per `docs/architecture/agents.md` "The workspace check is the settings reader's rule, written twice"). The only change is that the protected branch returns `protectedFolderRefusal(workspace)`.
- **`kernel/test/console-contract.test.ts`** — keep: `const ENTRY_LINE = /^\{ method: "([A-Z]+)", path: "([^"]+)", origin: "([a-z0-9-]+)" \},$/;`, so each new `CONTRACT_ROUTES` entry is one line in exactly that shape. Extend the literal route list, `lists phase 8's eleven routes` (becomes fourteen, with the three `p8-item-18` rows) and `phase 8's served routes` (add `servedBy("p8-item-18")`).
- **`app/src/api/contract.ts`** — keep: `export type HttpMethod = "GET" | "POST" | "PUT";` (no DELETE, so remove is a POST); one entry per line in `CONTRACT_ROUTES`; the `RouteOrigin` union gains `"p8-item-18"`; each route gets a `"<METHOD> <path>": Route<…>` row in the map beside `"GET /settings": Route<NoQuery, undefined, SettingsResponse>;`. `StudioBridge` gains an optional `chooseFolder?(): Promise<string | null>` (optional like `homeDir?`, so test fakes compile). Mirror: `app/electron/kernel-connection.ts` derives callable routes from `CONTRACT_ROUTES` (`const CALLABLE = CONTRACT_ROUTES.filter`), so the new routes become callable by listing them; there is no second allowlist to edit.
- **`app/electron/channels.ts` / `main.ts` / `preload.ts`** — keep: every handler starts `if (!fromOwner(event)) throw new Error("refused");`; argument-free like `homeDir` (`homeDir: "studio:home-dir",`), and the main process ignores any renderer argument. Mirror the `CHANNELS` entry in the exported channel list (`CHANNELS.homeDir,`). Pinned by: `app/electron/main.test.ts` (`it("handles exactly the bridge's channels, and refuses a caller that is not its window"`) and `app/electron/preload.test.ts` (`{ channel: "studio:home-dir", args: [] },`).
- **`app/src/screens/settings/SettingsScreen.test.tsx`** — keep: every existing case passing unchanged (e.g. `it("populated: the provider, account, health, token created and life, the commands, the kernel and the app's own settings; no h1 of its own"`); the only addition is one case that the Workspaces section renders on the screen. The section's own behaviour is tested in `WorkspacesSection.test.tsx`, not here (this file is 718 lines).
- **`app/e2e/fixtures/settings.ts`** — keep: the opt-in route pattern `...(options.agents === undefined ? {} : threadsRoutes(options.agents)),`. The canned `/workspaces` routes are added the same way (a `workspacesRoutes(...)` helper spread only when a new option is set), so `settings.spec.ts`, `settings-threads.spec.ts` and every other spec's fixture is unchanged.
- **`app/src/screens/settings/settings.css`** — keep: every value is a design token custom property, as in `gap: var(--space-6);` (no new colour value, `docs/DESIGN.md` "No new token"); the Workspaces table classes are appended, and existing selectors are untouched.
- **`app/src/screens/settings/SettingsScreen.tsx`** — keep: `// There is no input, no sign-in control and no secret field on this screen (invariants 6 and 7).` (Add folder… is a picker button, not a text input); the section mounts beside `<ThreadsSection api={api} offline={offline} />` and takes `offline`, disabling Add and remove while the kernel is unreachable; update the header comment naming 18c.

## Closed enumerations touched

> Sibling greps at base `0b9ef984`:
> `grep -rnF 'p8-item-17' --exclude=CHANGELOG.md .` → 18 hits in 4 files (`app/src/api/contract.ts`, `kernel/test/console-contract.test.ts`, `kernel/test/console-threads.test.ts`, `docs/ARCHITECTURE.md`).
> `grep -rnF '"playbook_jobs"' .` → 22 hits in 7 files.
> `grep -rnF 'studio:home-dir' .` → 6 hits in 5 files.

- **`p8-item-18`** (sibling: `p8-item-17`), which must be named in:
  - `app/src/api/contract.ts`: the `RouteOrigin` union (`| "p8-item-17"`) and `CONTRACT_ROUTES`. Extend.
  - `kernel/test/console-contract.test.ts`: the literal route list, the phase 8 list (`lists phase 8's eleven routes`) and `servedBy`. Extend.
  - `docs/ARCHITECTURE.md`: "lists eleven routes as `p8-item-NN`" plus the per-item list. Extend (fourteen, with `p8-item-18`, saved workspaces).
  - `kernel/test/console-threads.test.ts`: its regex selects `(?:item-06|p8-item-17)` only. No change: it is not a closed list of every origin.
- **migration 24 `saved_workspaces`** (sibling: `23, "playbook_jobs"`), which must be named in:
  - `kernel/test/store.test.ts`: the `[23, "playbook_jobs"],` list, every `toEqual([1, … 23])` and every `.at(-1)).toEqual([23, "playbook_jobs"])`. Extend to 24. `expect([playbookJobs.version, playbookJobs.name]).toEqual([23, "playbook_jobs"]);` gets no change (it pins migration 23 itself).
  - `kernel/test/integrations-github-app-migration.test.ts`, `kernel/test/integrations-foundation.test.ts`, `kernel/test/phase-8-foundation.test.ts`, `kernel/test/brain-threads.test.ts`: `.at(-1)).toEqual([23, "playbook_jobs"])`. Extend to `[24, "saved_workspaces"]`; the "directly below … 23, playbook_jobs, the last" test name in the github-app migration test is updated.
  - `kernel/src/store/migrations/023_playbook_jobs.ts`: its own name. No change.
- **`studio:choose-folder`** (sibling: `studio:home-dir`), which must be named in:
  - `app/electron/channels.ts`: `CHANNELS` and the exported list. Extend.
  - `app/electron/main.test.ts`: the sorted handler list. Extend.
  - `app/electron/preload.test.ts`: the bridge's channel calls. Extend.
  - `docs/architecture/app.md`: the bridge table (`| \`homeDir()\` (top level, not under \`prefs\`) | \`studio:home-dir\` |`). Extend.
  - `docs/evidence/phase-7-polish/shell/README.md`: historical evidence. No change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-workspaces.test.ts` — AC6 protected refusal | delete `if (isProtectedPath(` branch in `kernel/src/console/workspaces.ts` (the add route then saves the folder) |
| `kernel/test/console-workspaces.test.ts` — AC4 missing marked | flip `"missing"` → `"ready"` in `kernel/src/console/workspaces.ts` |
| `kernel/test/console-workspaces.test.ts` — AC2 order | flip `last_used_at DESC` → `last_used_at ASC` in `kernel/src/console/workspaces.ts` |
| `kernel/test/console-workspaces.test.ts` — AC5 note | flip the `note` for a null repo to `null` in `kernel/src/console/workspaces.ts` |
| `kernel/test/console-workspaces.test.ts` — AC3 remove touches only the row | delete the `DELETE FROM saved_workspaces` line in `kernel/src/console/workspaces.ts` (the row stays; the test fails) |
| `kernel/test/console-foundation.test.ts` — part list | delete `workspacesPart` from `CONSOLE_PARTS` in `kernel/src/console/index.ts` |
| `kernel/test/console-contract.test.ts` — p8-item-18 served | delete `{ method: "POST", path: "/workspaces/:id/remove"` in `kernel/src/console/workspaces.ts` |
| `kernel/test/store.test.ts` — migration list | delete `savedWorkspaces,` in `kernel/src/store/migrations/index.ts` |
| `app/src/screens/settings/WorkspacesSection.test.tsx` — missing row says "Missing" | flip `"Missing"` → `""` in `app/src/screens/settings/WorkspacesSection.tsx` |
| `app/electron/main.test.ts` — channel list | delete `ipcMain.handle(CHANNELS.chooseFolder` in `app/electron/main.ts` |
| `app/electron/preload.test.ts` — `{ channel: "studio:choose-folder", args: [] }` call | delete `chooseFolder: () => ipcRenderer.invoke(CHANNELS.chooseFolder` in `app/electron/preload.ts` |
| `kernel/test/console-workspaces.test.ts` — AC7(a) no session tool writes the list | add `tools: [saveWorkspaceTool]` (a tool named `kernel_workspace_save`) to `workspacesPart` in `kernel/src/console/workspaces.ts`; the pin (no merged tool name contains `workspace`) turns red |
| `kernel/test/console-workspaces.test.ts` — AC7(b) no `studio` subcommand writes it | add `subcommands: [workspacesSubcommand]` (`studio workspaces add`) to `workspacesPart` in `kernel/src/console/workspaces.ts`; the pin (no merged subcommand name starts `workspaces`) turns red |
| `kernel/test/console-workspaces.test.ts` — AC7(c) unauthenticated `POST /workspaces` answers 401 | flip the `/workspaces` POST route to `unauthenticated: true` in `kernel/src/console/workspaces.ts` (the red comes from `mergeContributions`' guard refusing an unauthenticated non-GET, before the 401 assertion runs; so the test builds its composition in a step of its own and asserts that the merge succeeds first, which keeps a merge failure from reading as the 401 check) |
| `kernel/test/console-workspaces.test.ts` — AC1 listing (`repo: "<owner>/<repo>"`, `state: "ready"`) | flip `state: "ready"` → `state: "missing"` in the `repos` branch of `kernel/src/console/workspaces.ts` |
| `kernel/test/console-workspaces.test.ts` — AC6 `400 not_checkout`, nothing saved | delete the `not_checkout` refusal branch in `kernel/src/console/workspaces.ts` (the folder is then saved) |
| `app/src/screens/settings/SettingsScreen.test.tsx` — the Workspaces section renders | delete `<WorkspacesSection` mount in `app/src/screens/settings/SettingsScreen.tsx` |
| `app/src/screens/settings/WorkspacesSection.test.tsx` — AC5 note shown | flip the rendered `note` text → `""` in `app/src/screens/settings/WorkspacesSection.tsx` |
| `app/src/screens/settings/WorkspacesSection.test.tsx` — AC6 refusal shown in plain words | flip the rendered refusal message → `""` in `app/src/screens/settings/WorkspacesSection.tsx` |
| `app/src/screens/settings/WorkspacesSection.test.tsx` — AC3 removed row offers Undo | delete the `Undo` button in `app/src/screens/settings/WorkspacesSection.tsx` |
| `app/e2e/settings-workspaces.spec.ts` — AC1 row with repo `<owner>/<repo>` | delete the repo cell (`<td>` rendering `repo`) in `app/src/screens/settings/WorkspacesSection.tsx` |
| `kernel/test/console-workspaces.test.ts` — AC7(d) a session's write to `<dataDir>/studio.db` is denied | delete `"studio.db",` in `kernel/src/sessions/policy.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: saved_workspaces table, console part with three routes and lookup, D31 helper, contract routes and types, kernel docs | AC1–AC7 (kernel side), AC8 | 15 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App: Settings → Workspaces section, folder-picker bridge, e2e, app docs, evidence | AC1, AC3–AC6 (app side), AC9 | 10 modify, 4 create | `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md`, `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/024_saved_workspaces.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/024_saved_workspaces.ts", name: "savedWorkspaces"}
  - {kind: "file", path: "kernel/src/console/workspaces.ts"}
  - {kind: "symbol", path: "kernel/src/console/workspaces.ts", name: "workspacesPart"}
  - {kind: "symbol", path: "kernel/src/console/workspaces.ts", name: "lookupSavedWorkspaces"}
  - {kind: "symbol", path: "kernel/src/protected-paths.ts", name: "protectedFolderRefusal"}
  - {kind: "file", path: "kernel/test/console-workspaces.test.ts"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "SavedWorkspace"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "SavedWorkspacesResponse"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "chooseFolder"}
  - {kind: "symbol", path: "docs/architecture/agents.md", name: "Saved workspaces"}
requires: []
lanes:
  - "kernel/src/store/migrations/index.ts"
  - "kernel/src/store/migrations/024_saved_workspaces.ts"
  - "kernel/src/console/index.ts"
  - "kernel/src/console/workspaces.ts"
  - "kernel/src/protected-paths.ts"
  - "kernel/src/agents/charter-files.ts"
  - "kernel/test/console-workspaces.test.ts"
  - "kernel/test/console-foundation.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "kernel/test/console-threads.test.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/integrations-github-app-migration.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/phase-8-foundation.test.ts"
  - "kernel/test/brain-threads.test.ts"
  - "app/src/api/contract.ts"
  - "docs/architecture/agents.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "git (a temp checkout made with `git init` + `git remote add` in tests)"

# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/settings/WorkspacesSection.tsx"}
  - {kind: "symbol", path: "app/src/screens/settings/WorkspacesSection.tsx", name: "WorkspacesSection"}
  - {kind: "file", path: "app/src/screens/settings/WorkspacesSection.test.tsx"}
  - {kind: "symbol", path: "app/electron/channels.ts", name: "chooseFolder"}
  - {kind: "file", path: "app/e2e/settings-workspaces.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-18c-saved-workspaces.md"}
requires:
  - {from: "1", kind: "type", path: "app/src/api/contract.ts", name: "SavedWorkspacesResponse"}
  - {from: "1", kind: "type", path: "app/src/api/contract.ts", name: "SavedWorkspace"}
  - {from: "1", kind: "symbol", path: "app/src/api/contract.ts", name: "chooseFolder"}
lanes:
  - "app/src/screens/settings/SettingsScreen.tsx"
  - "app/src/screens/settings/SettingsScreen.test.tsx"
  - "app/src/screens/settings/WorkspacesSection.tsx"
  - "app/src/screens/settings/WorkspacesSection.test.tsx"
  - "app/src/screens/settings/settings.css"
  - "app/electron/channels.ts"
  - "app/electron/main.ts"
  - "app/electron/preload.ts"
  - "app/electron/main.test.ts"
  - "app/electron/preload.test.ts"
  - "app/e2e/fixtures/settings.ts"
  - "app/e2e/settings-workspaces.spec.ts"
  - "docs/architecture/app.md"
  - "docs/evidence/phase-8-18c-saved-workspaces.md"
external_requires:
  - "Electron dialog.showOpenDialog (openDirectory)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (contract.ts is Subtask 1's alone) | YES (Subtask 2 consumes Subtask 1's contract types) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1 at a time
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md`, `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/screens/team/Inspector.tsx:426` | yes | HOLDS | `{ok.workspaces === null ? <p className="team-insp-empty">Not read: the settings file does not read ok.</p> : <List items={ok.workspaces} empty="None" mono />}` | tip 11 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the plan needs 25 paths outside the requirement's Touches (closed migration and route pins, the Electron picker bridge, route-count docs) | HIGH | Recorded in `## Scope widening`, `decision: pending-coordinator`; the coordinator re-gates with the owner before Supervisor runs |
| Feasibility (Phase 2.5): about 32 files, past one worker's context | MEDIUM | Split kernel then app (`context-bound`); Subtask 1 owns all of contract.ts, so the lanes are disjoint |
| A saved path goes stale silently (requirement risk) | MEDIUM | Every `GET /workspaces` re-reads each folder; `missing`/`unreadable` are never `ready` (AC4) |
| Wright can't read the list yet (owner chose route only at LP-CLARIFY) | LOW | `lookupSavedWorkspaces` is exported for 18d's Wright tool; the docs say Wright has no tool for it in 18c |
| Undo re-saves the row, so its last used becomes now and its id changes | LOW | Stated in the UI copy and in `docs/architecture/agents.md` as an honest limit |
| Migration number collision with a parallel lane also adding migration 24 | LOW | Only lane L3 is live in this run; at merge, rebase and renumber if main gained a 24 |
| Running-system Validation 2 needs the owner in the packaged app; a worker can't produce that verdict | MEDIUM | AC9: the evidence file carries the steps and static results; the `Verdict:` line comes only from the owner's report |
| Path dedupe: two spellings of one folder become two rows | LOW | Store `resolvedPath(path)`, the D31 resolution, and pin a symlinked re-add in the kernel test |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-11-saved-workspaces.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-11T10:15:45Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/260
- **Branch:** feature/saved-workspaces
- **Files changed:** 36
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel saved_workspaces (migration 24, workspaces console part with GET/POST /workspaces and POST /workspaces/:id/remove, lookupSavedWorkspaces, protectedFolderRefusal), p8-item-18 contract, Settings → Workspaces section with the studio:choose-folder bridge, e2e, docs and evidence. Phase 4.5 review PASS round 1 with 2 LOW dismissed (data-dir not refused; fixture message drift). Required CI green. Validation 2 awaits the owner.

## Not verified
- **GET/POST /workspaces in the packaged app and live kernel against the real ~/Documents** — no local runtime of the packaged app; owner Validation 2 (AC9) (subtask 1)
- **native macOS folder picker in the packaged app** — e2e replaces dialog.showOpenDialog in the main process; needs owner Validation 2 (subtask 2)
- **Settings → Workspaces against the real kernel routes** — e2e uses the fixture kernel; real routes covered only by kernel/test/console-workspaces.test.ts (subtask 2)
