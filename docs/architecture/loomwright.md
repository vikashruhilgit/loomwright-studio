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

`readLoomwrightContract(installPath)` reads `<installPath>/capabilities.json` (at most 4 MiB) and validates it field by field. Required: `plugin_name` (must be `"loomwright"`), `plugin_version` (a non-empty string), `contract_schema_version` (an integer of at least `MIN_CONTRACT_SCHEMA_VERSION`, 1), and the arrays `agents`, `commands`, `skills`, `result_schemas` (entries with a non-empty `name`) and `hooks` (entries with string `event` and `host_mode`). Read when present: an entry's `description`, a result schema's `schema_version`, and `host_switch` (`env` and `state_dir_env`, two distinct upper-case variable names, and `effect`). Neither name may be a credential or billing-routing variable the kernel strips (`isCredentialEnvVar`: any `ANTHROPIC_*`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CONFIG_DIR`, ...) or a process-control variable (`PATH`, `HOME`, `SHELL`, `USER`, `LOGNAME`, `PWD`, `TMPDIR`, the `*_PROXY` variables, and any `DYLD_*`, `LD_*` or `NODE_*` name): the contract is data and may never undo the kernel's credential isolation (invariant 3). No `LOOMWRIGHT_` prefix is required, so a later Loomwright may rename its switch. Unknown fields at every level are dropped, never an error, so a newer Loomwright can add fields. The adapter never parses Loomwright's `plugin.json`, frontmatter, `hooks.json` or `CHANGELOG.md`.

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

## Limits

- **Synced and desktop installs.** "Each of these plugins loads as `<name>@synced`, with no marketplace and no install record." ([plugins/loading.md](https://code.claude.com/docs/en/plugins/loading.md), read 2026-10-14.) A Loomwright synced from claude.ai or installed through the desktop app may not appear in `installed_plugins.json`. Sessions are then refused with `not_installed` (or `installed_plugins_missing`), and the message names the file. A configured `loomwrightPath` is the way round it. Whether desktop-app installs are recorded, and the exact shape of `project`/`local` entries, are for the owner's p10 probe ([`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md), [evidence](../evidence/phase-2-loomwright-host-mode.md)).
- **`installed_plugins.json` is an internal Claude Code format.** The adapter refuses any entry shape it does not recognise rather than guess.
- **Not in this item:** recording the contract version each session saw, and the version-change note (item 07); putting the manifest summary into Wright's context (item 06).
