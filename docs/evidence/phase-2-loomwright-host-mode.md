# Phase 2 evidence: Loomwright host mode and the active install

The Loomwright adapter (D32, [`docs/architecture/loomwright.md`](../architecture/loomwright.md)) loads the install that `~/.claude/plugins/installed_plugins.json` names as active, reads that install's `capabilities.json`, and runs each session with the contract's host switch on. This page holds the evidence for that: two probe runs the owner makes (they spend his subscription or read his machine, so no agent runs them) and the documentation findings the adapter's resolution rule is built on. Paths under the home directory are written `~/…`; please redact them the same way when pasting.

## 1. p9 rerun with host mode on

**Owner run: pending.**

What it answers: with `LOOMWRIGHT_HOST_MODE=1` and `LOOMWRIGHT_HOST_STATE_DIR` set, does a real SDK session that runs a Loomwright agent leave its repo clean? On 2026-10-06, without host mode, Loomwright's SessionStart wrote `.claude/settings.local.json` and `.supervisor/logs/` into the session's repo ([`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md)). The contract declares that host mode stops this; this run checks it from Studio's side.

The exact command, from the repo root (a throwaway git repo with one empty commit):

```bash
cd probes && npm install
repo=$(mktemp -d) && git -C "$repo" init -q && git -C "$repo" commit -q --allow-empty -m init
PROBE_CWD="$repo" node p9-loomwright-hooks.mjs --host-mode
```

`--host-mode` creates a fresh temp state dir, passes `LOOMWRIGHT_HOST_MODE=1` and `LOOMWRIGHT_HOST_STATE_DIR=<that dir>` in the session's env, and adds a section (3) to the output. Sections (1) and (2) are the same as without the flag.

Loomwright version reported by the probe's first line (paste):

```text
(pending)
```

`git status --porcelain --ignored` of the repo, before (paste from section 3):

```text
(pending)
```

`git status --porcelain --ignored` of the repo, after (paste from section 3):

```text
(pending)
```

Files under the state dir after the session (paste from section 3):

```text
(pending)
```

Sections (1) and (2) of the output (paste):

```text
(pending)
```

Pass condition: "after" equals "before" (the repo stays clean, ignored files included), and the state dir holds Loomwright's hook state. If the repo is not clean, the owner decides what happens next; the adapter does not work around it.

## 2. p10: what installed_plugins.json records, per scope and for desktop installs

**Owner run: pending.**

What it answers: the adapter reads `installed_plugins.json`, an internal Claude Code format. It assumes each `loomwright@<marketplace>` entry has `scope`, an absolute `installPath` and `version`, and that a `project` or `local` entry also has a `projectPath`. It refuses (`installed_plugins_unreadable`) any entry it does not recognise. p10 prints what the file really holds so these assumptions can be checked. It is read-only: no SDK, no network, and it writes nothing.

The exact command, from the repo root:

```bash
cd probes && node p10-desktop-plugin-install.mjs
```

For the desktop case, install any plugin from the Claude desktop app, and one at project or local scope in a repo (picking the scope as the docs' "Choose an install scope" describes), then run the command again and compare.

Output, as installed today (paste):

```text
(pending)
```

Output after a desktop-app install and a project/local-scope install (paste):

```text
(pending)
```

What to read off it: whether the desktop install appears in the file at all; the exact field names of a `project` or `local` entry (does it have `projectPath`, and is it absolute?); and whether `~/.claude/plugins/synced/` exists and what it holds.

## 3. Documentation findings (already verified)

These are the documented behaviours the adapter's resolution rule relies on. They come from the job brief's reading of Claude Code's docs on 2026-10-14.

- **Scope precedence.** "When the same plugin is set at several scopes, the local setting overrides the project setting, and the project setting overrides the user setting." ([plugins/install.md](https://code.claude.com/docs/en/plugins/install.md), "Choose an install scope", read 2026-10-14.) The adapter takes the highest scope present (local, then project, then user). If two candidates share that scope (for example, two marketplaces), it refuses with `ambiguous_install` rather than guess.
- **Synced plugins have no install record.** "Each of these plugins loads as `<name>@synced`, with no marketplace and no install record." ([plugins/loading.md](https://code.claude.com/docs/en/plugins/loading.md), read 2026-10-14.) A Loomwright synced from claude.ai or the desktop app is therefore invisible to the adapter: sessions are refused with `not_installed`, and the message names the file. A configured `loomwrightPath` is the escape hatch.

Observed on the owner's Mac on 2026-10-14 (read-only, while the adapter was being built):

- `~/.claude/plugins/installed_plugins.json` has top-level keys `version` and `plugins`. `loomwright@atelier` has one entry: `scope` `user`, `version` `17.2.0`, `installPath` `~/.claude/plugins/cache/atelier/loomwright/17.2.0`, plus `installedAt`, `lastUpdated` and `gitCommitSha`. `loomwright-lanes@atelier` (0.3.0) is a separate key, and the adapter never treats it as a candidate.
- The cache holds 24 Loomwright version folders. `17.0.0` has no `capabilities.json`. `17.0.2` and `17.2.0` both have one, at `contract_schema_version` 1, and both include a `host_switch` (`LOOMWRIGHT_HOST_MODE` / `LOOMWRIGHT_HOST_STATE_DIR`). The 17.2.0 contract has 48 hooks: 35 `redirects`, 12 `unaffected`, 1 `skips`.

## Not verified

- **p9 rerun with host mode on (section 1).** Owner run: pending. Until it runs, a clean repo under host mode is only Loomwright's declaration, not something Studio has observed.
- **p10 desktop/scope probe (section 2).** Owner run: pending. Until it runs, three things are unverified: whether a desktop-app install is recorded in `installed_plugins.json`, the exact shape of `project` and `local` entries (including `projectPath`), and what `~/.claude/plugins/synced/` holds. The adapter fails closed on any entry shape it does not recognise.
