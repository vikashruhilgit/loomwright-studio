# Loomwright

The Loomwright adapter (D32, phase 2) decides which Loomwright install a session loads, reads that install's published contract (`capabilities.json`), runs the session with the contract's host switch on, and reports what that Loomwright can do. Code: `kernel/src/loomwright/` (the adapter) and `kernel/src/sessions/loomwright-path.ts` (its session side). Evidence and the probes the owner runs: [`docs/evidence/phase-2-loomwright-host-mode.md`](../evidence/phase-2-loomwright-host-mode.md).

The adapter is a mechanism (invariant 1): it reports and refuses, it never picks a playbook's behaviour. Its parsing of Claude Code's files lives in one function, `resolveLoomwrightInstall`, and fails closed on any shape it does not know.

## Which install a session loads

1. **A configured path wins.** A non-empty `loomwrightPath` (a `SessionManagerOptions` / `KernelOptions.sessions` setting; the shipped daemon sets none) is resolved to an absolute path and must hold a valid contract. A bad configured path is an error, never a fallback to `installed_plugins.json` or to the cache.
2. **Otherwise, the active install from `~/.claude/plugins/installed_plugins.json`** (`installedPluginsPath` overrides the file, and every test injects it). The candidates are the entries under every key matching `^loomwright@[^@]+$`, so `loomwright@atelier` from any marketplace counts and `loomwright-lanes@atelier` never does. An entry counts when its `scope` is `user`, or when its scope is `project` or `local` and its `projectPath` equals the session's `cwd`. Any other scope, or a `project`/`local` entry without a string `projectPath`, makes the file `installed_plugins_unreadable`.
3. **Claude Code's scope precedence decides between candidates.** "When the same plugin is set at several scopes, the local setting overrides the project setting, and the project setting overrides the user setting." ([plugins/install.md](https://code.claude.com/docs/en/plugins/install.md), "Choose an install scope", read 2026-10-14.) The highest scope present wins. Two candidates at that scope (two marketplaces, say) are `ambiguous_install`, naming each one: the adapter never guesses.
4. **The winner's `installPath` must be a directory** (`install_path_invalid`), and its contract is read next.

**The plugin cache is never scanned.** It keeps every version ever installed (24 on 2026-10-14), and the newest folder is not necessarily the active one: 17.0.0, briefly active on 2026-10-13, shipped without `capabilities.json`. A missing contract in the active install is refused; no other install's contract is used instead.

A session keeps the Loomwright it started with: the row's `loomwright_path` records it, and a resume reads the contract at that path again instead of resolving afresh.

## The contract

`readLoomwrightContract(installPath)` reads `<installPath>/capabilities.json` (at most 4 MiB) and validates it field by field. Required: `plugin_name` (must be `"loomwright"`), `plugin_version` (a non-empty string), `contract_schema_version` (an integer of at least `MIN_CONTRACT_SCHEMA_VERSION`, 1), and the arrays `agents`, `commands`, `skills`, `result_schemas` (entries with a non-empty `name`) and `hooks` (entries with string `event` and `host_mode`). Read when present: an entry's `description`, a result schema's `schema_version`, and `host_switch` (`env` and `state_dir_env`, two distinct upper-case variable names, and `effect`). Neither name may be a credential or billing-routing variable the kernel strips (`isCredentialEnvVar`: any `ANTHROPIC_*`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CONFIG_DIR`, ...) or a process-control variable: one whose value an interpreter, loader, shell or tool reads as a path, code or a behaviour switch. The kernel sets the switch to the relative value `1` in the repo's `cwd`, so `BASH_ENV=1` would run `./1` and `PYTHONPATH=1` would import from `./1`. The contract is data and may never undo the kernel's credential isolation or turn repo content into code (invariant 3). The refused groups (the `PROCESS_CONTROL_ENV` table in `kernel/src/loomwright/contract.ts`, one comment per group):

- **Exact names.** Paths and identity: `PATH`, `HOME`, `SHELL`, `USER`, `LOGNAME`, `PWD`, `TMPDIR`, `CDPATH`. Shell startup and behaviour: `BASH_ENV`, `ENV`, `SHELLOPTS`, `BASHOPTS`, `PS4`, `IFS`, `PROMPT_COMMAND`, `ZDOTDIR`, `GLOBIGNORE`. Locale, time zone and terminal: `LANG`, `TZ`, `TERM`. The CLI's shell and env-file hooks: `CLAUDE_ENV_FILE`, `CLAUDE_CODE_SHELL`, `CLAUDE_CODE_SHELL_PREFIX`.
- **Prefixes.** Dynamic loaders: `DYLD_`, `LD_`. Interpreters: `NODE_`, `PYTHON`, `PERL`, `RUBY`, `NPM_CONFIG_`. Exported bash functions: `BASH_FUNC_`. git: `GIT_`. Config dirs, TLS trust stores and locale categories: `XDG_`, `SSL_`, `LC_`. The CLI's and the kernel's own namespaces: `CLAUDE_CODE_`, `ANTHROPIC_`.
- **Suffix.** Every proxy variable: `_PROXY` (`HTTP_PROXY`, `FTP_PROXY`, `SOCKS_PROXY`, `NO_PROXY`, ...).

No `LOOMWRIGHT_` prefix is required, so a later Loomwright may rename its switch. Honest limit: a deny-list cannot be complete. The kernel never sets these names itself, and a namespace allowlist (for example requiring both names to start with `LOOMWRIGHT_`) would close the class, but that is an owner decision, because the brief's AC6 fixture renames the switch to `TEST_HOST_FLAG` / `TEST_HOST_STATE`. The kernel checks the names again at launch, against the auth-built env. Unknown fields at every level are dropped, never an error, so a newer Loomwright can add fields. The adapter never parses Loomwright's `plugin.json`, frontmatter, `hooks.json` or `CHANGELOG.md`.

## Refusals

A session Studio cannot run with this Loomwright is refused before any row or spawn, in the same way as `protected_cwd` (D31). Every refusal but one also comes before admission and auth; the exception is a host switch the auth provider's env sets, which can only be checked against that env, so it runs after admission and `buildEnv`. No `sessions` row is written and nothing is spawned. Exactly one `session_refused` event is appended: `session_id` is null for a start, or the session's id for a resume, whose row is left as it was. Its payload is:

```json
{ "reason": "<SessionError code>", "detail": "<adapter reason>", "path": "<the install, or installed_plugins.json>" }
```

The thrown `SessionError` (a `LoomwrightSessionError`, carrying `detail` and `path`) has the adapter's message, which names the install or the file and the problem (for example `Loomwright at <path>: capabilities.json missing`).

| `SessionError` code | When |
|---|---|
| `loomwright_not_found` | No install could be found: the reasons `installed_plugins_missing`, `installed_plugins_unreadable`, `not_installed`, `ambiguous_install`, `install_path_invalid`. |
| `loomwright_contract` | The install's contract is missing or bad: the `contract_*` reasons. Also (detail `contract_invalid`) a host switch naming a credential or process-control variable (see the contract), or a variable the auth provider itself adds to the session's env: a contract may never overwrite an auth variable. A host-switch name inherited from the daemon's own environment is not a refusal: the kernel drops it (see host mode). |
| `loomwright_no_host_switch` | The contract is valid but has no `host_switch` (reason `no_host_switch`). Studio runs Loomwright only in host mode. |

The adapter's reasons (`LoomwrightContractErrorReason`, a closed list in `kernel/src/loomwright/contract.ts`):

| Reason | Meaning | `path` |
|---|---|---|
| `contract_missing` | The install has no `capabilities.json`. | the install |
| `contract_unreadable` | The file can't be read, or is over 4 MiB. | the install |
| `contract_not_json` | The file is not JSON. | the install |
| `contract_invalid` | Not a JSON object, or a required field is missing or mistyped (the message names it). Also a host-switch name that is a credential or process-control variable, or that the auth provider sets (see above). | the install |
| `contract_schema_too_old` | `contract_schema_version` is below `MIN_CONTRACT_SCHEMA_VERSION` (1). | the install |
| `no_host_switch` | A valid contract without `host_switch`. | the install |
| `installed_plugins_missing` | `installed_plugins.json` does not exist, and no path is configured. | the file |
| `installed_plugins_unreadable` | The file can't be read, is over 4 MiB, is not JSON, has no `plugins` object, or a `loomwright@…` entry has a shape the adapter does not know (the message names the key). | the file |
| `not_installed` | No `loomwright@<marketplace>` entry applies to this session. | the file |
| `ambiguous_install` | More than one candidate at the winning scope (the message names each `key scope installPath`). | the file |
| `install_path_invalid` | The winning entry's `installPath` is not a directory. | that `installPath` |

`/status` adds one reason of its own (`LoomwrightAdapterStatusReason`, `kernel/src/loomwright/active-install.ts`):

| Reason | Meaning | `path` |
|---|---|---|
| `status_threw` | The status reader threw unexpectedly. The clipped error is in `message`. | `""` |

## Host mode

Every session runs with the contract's host switch on, so Loomwright's repo-writing hooks write their state under the Studio data dir instead of into the session's repo (p9, 2026-10-06, saw `.claude/settings.local.json` and `.supervisor/logs/` written into the repo without it). The kernel owns these two names: a value for either inherited from the daemon's environment (for example `LOOMWRIGHT_HOST_MODE` exported in the launching shell) is dropped before the auth provider builds the env, so it never reaches the child. The child env is the auth provider's env plus two variables whose **names come from the contract**, not from Studio:

- `<host_switch.env>=1`
- `<host_switch.state_dir_env>=<dataDir>/loomwright-state/session-<sessions.id>`

For Loomwright 17.2.0 these are `LOOMWRIGHT_HOST_MODE` and `LOOMWRIGHT_HOST_STATE_DIR`. The state dir is created (mode 0700) after the row is written and before the spawn; if it can't be created, the start fails the same way a failed spawn does (`failed`, `spawn_failed`). A resume rebuilds both variables from the contract at the row's `loomwright_path` and re-creates the same dir before every launch attempt. If the auth provider sets a host-switch name at resume time (or the name is a credential or process-control variable, checked again at every launch as defence in depth), that attempt fails and is retried like any other failed attempt, and the session ends `failed` (`resume_failed`) without launching. Whether a real session under host mode leaves its repo clean is the owner's p9 rerun: until then it is Loomwright's declaration, not something Studio has observed (see the evidence page).

## The `kernel_loomwright_capabilities` tool

The `loomwright` feature contributes one kernel tool, `kernel_loomwright_capabilities` (no arguments). It reads the contract of the calling session's own install (the row's `loomwright_path`) and returns only these fields (values illustrative):

```json
{
  "install_path": "…",
  "plugin_version": "17.2.0",
  "contract_schema_version": 1,
  "agents": [{ "name": "…", "description": "… or null" }],
  "commands": [{ "name": "…", "description": "…" }],
  "skills": [{ "name": "…", "description": "…" }],
  "result_schemas": [{ "name": "…", "schema_version": 2 }],
  "hooks_by_host_mode": { "redirects": 35, "skips": 1, "unaffected": 12 },
  "host_switch": { "env": "LOOMWRIGHT_HOST_MODE", "state_dir_env": "LOOMWRIGHT_HOST_STATE_DIR" }
}
```

No hook script, matcher or writes, and no `generated_by`: the only path in the output is the install path. A session with no row or no recorded install gets an `isError` result. `loomwrightManifestSummary(contract)` is the same information as bounded text (names and one-line descriptions, at most 4000 characters, ending in `(truncated)` when cut). It is exported for Wright's context; nothing calls it yet.

## `/status`

`GET /status` has an additive `loomwright` field (an older CLI ignores it), read fresh on every request so it follows the active install without a restart. It is resolved with no project, which is the user-scope view:

```json
{ "status": "ok", "install_path": "…", "plugin_version": "17.2.0", "contract_schema_version": 1, "host_switch": true }
```

or, when sessions would be refused:

```json
{ "status": "error", "reason": "<a reason above>", "path": "…", "message": "…" }
```

A contract without a host switch reads `status: "ok"` with `host_switch: false`, and sessions are still refused (`loomwright_no_host_switch`). A missing or broken Loomwright never stops the kernel: `startKernel` succeeds and `/status` answers 200. `studio status --json` prints the field. The short `studio status` summary does not show it yet.

## Version changes

The `loomwright` feature also contributes one due work, the version watcher (`kernel/src/loomwright/version-note.ts`). When the active Loomwright changes, it writes a note of what was added, removed or changed, and tells the owner (D13's goal, D32's mechanism). Like the rest of the adapter, it reports and decides nothing.

### Detection

The watcher checks on the loop's first tick after the kernel starts, then at most once a minute. It resolves the active install the way `/status` does: with the same `loomwrightPath` and `installedPluginsPath` settings the session manager gets, and no project (the user-scope view). The resolver reads that install's `capabilities.json` once, validates that same text and returns it with the install, so the row stores exactly the bytes it validated and there is no second read for the file to change between. Then it compares the install path, plugin version and contract schema version with the latest `loomwright_contract_seen` row (the highest `id`):

- **No row yet:** the first observation is recorded silently. This is the baseline. There is no note and no notification.
- **The same three values:** nothing happens.
- **Only the install path differs:** the new row is recorded silently.
- **A new plugin version or contract schema version:** the watcher writes the note, then records the row and creates one notification in one transaction.

A triple seen before (a return to an older version, say) replaces its old row, so the latest row is always the active contract.

The watcher runs on every kernel's first tick, whatever else is configured. So a kernel started with neither `loomwrightPath` nor `installedPluginsPath` reads the host's real `~/.claude/plugins/installed_plugins.json`, exactly as `/status` does, and may write a real note and notification into its data dir. Every test must inject one of them (the fixture convention in `kernel/test/fixtures/loomwright/README.md`). A guard test in `kernel/test/loomwright-version-note.test.ts` fails when a test file calls `startKernel(` without mentioning either setting. It checks each file, not each call.

### The diff

The note is built only from the two contracts: the old row's `contract_json` and the new file. No changelog, frontmatter or other Loomwright file is read. Both contracts are read field by field, and unknown fields at every level are ignored, so a contract with extra fields diffs the same as one without them. The diff compares:

- agents, commands, skills and result schemas, by `name`: added, removed, description changed, and a result schema's `schema_version`;
- hooks, by event, matcher and script (two identical hooks count twice): added, removed, `host_mode` changed, `writes` changed (compared as a set);
- `host_switch`: its `env`, `state_dir_env` or `effect`, or one side having none;
- `contract_schema_version`.

### Breaking signals

These go first in the note and in the notification:

- a removed command;
- a removed agent;
- any `host_switch` change;
- a contract schema version that crosses `KNOWN_CONTRACT_SCHEMA_VERSION` (1, the highest this kernel was written against): the new version is above it and the old one is not.

D32 says the adapter tolerates a newer contract and reports the change rather than breaking. So a newer schema version is flagged, and the note says that the adapter still reads the contract and does not refuse sessions. It is flagged only on a change that crosses the known version, so when the warning appears it is new. It does not always appear: the baseline is never diffed (see § Its limits), and a change back down to the known version and up again crosses again, so it is flagged again. A later change between two versions above it (2 to 3, or a new plugin version still at 2) is not flagged again, and neither is a change back down to it; the Changed section still reports any schema change, and the note's From and To lines always state both schema versions. The adapter only has a minimum version (`MIN_CONTRACT_SCHEMA_VERSION`).

### The note

The note is markdown at `<dataDir>/memory/shared/loomwright-updates/<old>-to-<new>.md` (invariant 8: the owner can read and edit it). Its sections, in order: Breaking (only when there is a breaking signal), Added, Removed, Changed (hooks, result-schema versions, the contract schema version), Description changes (last). Each entry shows its name and its one-line description, or `(no description)`. The contract is data, so nothing it supplies is live markdown: every name, description, plugin version, hook event, host mode and host-switch variable name is a code span whose backtick delimiter is one longer than the longest backtick run inside it, and the heading (the notification title, which carries the plugin versions) has every ASCII punctuation character backslash-escaped. A removed command or agent is listed under Breaking and also under Removed.

A hook is shown only by its event and the kind of change, with counts of write paths. Its script, matcher and paths never appear: memory files go into Wright's context, and this is the same rule the capabilities tool follows.

The note's first line is a provenance marker: `<!-- loomwright-version-note from:<old row id> to:<install path>|<plugin version>|<contract schema version> -->`, with the three values percent-encoded so the marker stays one line.

- **The file name.** A plugin version is contract data, never a path. Each version keeps only `[A-Za-z0-9._-]` (any other character becomes `_`), loses its leading dots, and is cut to 64 characters; an empty result is `unknown`. The resolved path must sit directly in `loomwright-updates/`. Directories are created with mode 0700.
- **Never overwritten.** If the name is taken (an earlier note, or a file the owner wrote), the note goes to the first free `-2`, `-3`, …. It is written to a temp file and hard-linked into place, so a note file is never torn.
- **A crash between the note and the row.** The next check finds a file whose first line is this transition's marker and reuses it, so there is no duplicate note. It reads as many bytes as the marker has (plus its newline), so a long install path or plugin version still matches, and never more than the file holds: a smaller file is read whole, with no more allocated than its size. The whole first line must equal the marker; a line that only starts with it is not this note.

### The notification

One notification per version change, created with the row:

- source `kernel:loomwright_version`;
- title `Loomwright <old> → <new>`;
- body `<b> breaking, <n> added, <m> removed, <c> changed. Note: <path>`. The breaking count comes first and only when it is not zero. The added and removed counts are the note's Added and Removed sections only. The changed count is the number of lines in the note's Changed section (hook changes, result-schema versions, the contract schema version), and it appears only when that section is not empty, so a hook-only change still shows in the notification. Description changes are never counted; the note has them.

### Downgrade

When the new version is numerically lower (`MAJOR.MINOR.PATCH`, compared segment by segment), the note and the notification are titled `Loomwright downgrade <old> → <new>`. Everything else is the same. A version that is not three numbers is never called a downgrade.

### No contract

When the active install has no usable contract (any `contract_*` reason: missing, unreadable, not JSON, invalid, too old), there is no note and no row, and `/status` shows the adapter's error. The watcher creates one notification titled `The active Loomwright has no usable contract`, whose body names the install and the adapter's message. It is created only when no notification with the same source, title and body exists, and the body carries both the install path and the adapter's message. That makes it once per install path and message, which for a marketplace install is once per version, and a restart does not repeat it. A different problem with the same install (a missing `capabilities.json` that comes back as invalid JSON, say) changes the message, so it gets a new notification. When no install is found at all (`installed_plugins_missing`, `not_installed` and the other install reasons), the watcher does nothing: reporting that is `/status`'s job.

### Its limits

- A change is seen within about a minute while the loop runs. While the kill switch is engaged the loop does not run, so nothing is checked.
- Only the user-scope view is watched. A `project` or `local` install that one repo's sessions use is not.
- A kernel with neither `loomwrightPath` nor `installedPluginsPath` watches the host's real install. Tests are kept off it by convention and a per-file guard, not by the kernel.
- An unexpected error in a check is one `due_work_failed` row, and the next check, a minute later, tries again.
- A re-activated triple's row is replaced, so its first-seen time is its latest sighting, not its first.
- If the kernel crashes between the note and the row, and the install changes back before the next check, that note stays without a row or a notification.
- A kernel whose first observation is already above `KNOWN_CONTRACT_SCHEMA_VERSION` never flags it: the baseline is silent and no later change crosses. `/status` still shows `contract_schema_version`.
- The note says only what the contract records. Release notes can join the contract later (a Loomwright change).
- The requirement said a newer contract schema version makes the adapter refuse sessions. It does not: D32 tolerates newer contracts, so the note says sessions are not refused.

## Limits

- **Synced and desktop installs.** "Each of these plugins loads as `<name>@synced`, with no marketplace and no install record." ([plugins/loading.md](https://code.claude.com/docs/en/plugins/loading.md), read 2026-10-14.) A Loomwright synced from claude.ai or installed through the desktop app may not appear in `installed_plugins.json`. Sessions are then refused with `not_installed` (or `installed_plugins_missing`), and the message names the file. A configured `loomwrightPath` is the way round it. Whether desktop-app installs are recorded, and the exact shape of `project`/`local` entries, are for the owner's p10 probe ([`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md), [evidence](../evidence/phase-2-loomwright-host-mode.md)).
- **`installed_plugins.json` is an internal Claude Code format.** The adapter refuses any entry shape it does not recognise rather than guess.
- **Not yet built:** recording the contract version each session saw (the version watcher records the active contract, not each session's); putting the manifest summary into Wright's context (item 06).
