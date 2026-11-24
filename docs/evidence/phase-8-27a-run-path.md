# Phase 8 item 27a: a kernel-started run can run the checks it may run

**What changed.** `studio service install` now resolves `npm` and `node` (`RUN_CHECK_TOOLS`, `kernel/src/service/launchd.ts`) through the installing shell's `PATH` with the same rule 23h uses for `gh` and `git`. It writes only the dirs they were found in, in that `PATH`'s order, ahead of launchd's default, and prints where it found them. Each one it can't find is a one-line warning (`runCheckToolWarning`), never a refusal. At launch, the `run_declared_checks` event of a `backlog`, `resume` or `review_pr` run names each admitted check whose executable the kernel's `PATH` can't find (`unrunnable`, `unrunnable_count`). Each entry carries the line `<command> is declared but <executable> is not on the run's PATH`, and the app's audit sentence appends that line. The run policy is unchanged.

**Why.** Phase 8 walk step 1 (session 266, run `20261124-133823`) admitted `npm test` as a declared check (25d). The service's `PATH` was `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, and on this machine `npm` lives under `~/.nvm/versions/node/<v>/bin`. The Supervisor checkpointed with "npm not on PATH" and `pr_url: null`.

## Validation 1: `cd kernel && npm test`

Run on 2026-11-24 from the branch `feature/27a-run-can-run-the-checks-it-may-run` working tree, on base `d790c93c5f0650063e2f3b41f0abcecc74bc364d` with the change uncommitted. The run used macOS 26.6.2 and node v24.11.1.

```
 Test Files  155 passed | 1 skipped (156)
      Tests  5389 passed | 23 skipped (5412)
```

`npm run typecheck` in `kernel/` exits 0. `cd app && npm test` reports `Test Files  109 passed (109)` and `Tests  3408 passed (3408)`, and `npm run typecheck` in `app/` exits 0. `bash scripts/check-docs.sh` prints `check-docs: OK`.

Each pin in the brief was checked by applying its mutation, running the pinning test file and restoring the code. Every mutation turned its test red:

| Mutation | Result |
|---|---|
| `RUN_CHECK_TOOLS` `["npm", "node"]` → `["node"]` | `service-launchd.test.ts` + `cli.test.ts`: 9 failed; `cli.test.ts` alone: 2 failed |
| `resolveServiceToolPath` pushes every filtered installer entry | `service-launchd.test.ts`: 4 failed |
| the `RUN_CHECK_TOOLS` warn loop deleted | `service-launchd.test.ts`: 2 failed |
| `unrunnableDeclaredChecks` returns `[]` | `automate-declared-checks.test.ts`: 4 failed |
| `unrunnable` key dropped from the payload | `automate-declared-checks.test.ts`: 2 failed |
| the audit sentence stops appending the lines | `audit-sentences.test.ts`: 1 failed |

Verdict: PASS for Validation 1

## Validation 2, pre-merge proxy (the installed service not touched)

The proxy did not run `studio service install` or `uninstall`, did not run `launchctl`, and wrote nothing under `~/Library/LaunchAgents`. It ran in the owner's login shell, the one `npm test` works in. It built the branch's kernel (`cd kernel && npm run build`, into the gitignored `kernel/dist/`) and called the built `resolveServiceToolPath` on that shell's `PATH`:

```
$ node --input-type=module -e 'import { resolveServiceToolPath, RUN_CHECK_TOOLS, SERVICE_TOOLS } from "./kernel/dist/service/index.js"; const r = resolveServiceToolPath(process.env.PATH); console.log(JSON.stringify({ SERVICE_TOOLS, RUN_CHECK_TOOLS, ...r }, null, 2));'
{
  "SERVICE_TOOLS": [
    "gh",
    "git"
  ],
  "RUN_CHECK_TOOLS": [
    "npm",
    "node"
  ],
  "path": "/opt/homebrew/bin:/Users/vikashruhil/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  "found": {
    "gh": "/opt/homebrew/bin/gh",
    "git": "/opt/homebrew/bin/git",
    "npm": "/Users/vikashruhil/.nvm/versions/node/v24.11.1/bin/npm",
    "node": "/Users/vikashruhil/.nvm/versions/node/v24.11.1/bin/node"
  }
}
```

That shell's `PATH` holds 46 entries, six of them nvm `bin` dirs (the first is v24.11.1's). The resolved `PATH` holds only the two dirs where the four tools were found, then launchd's default. It holds no other entry from the installer's `PATH`.

The proxy then ran `npm test` with an environment holding only that `PATH`, in a fresh temp dir (`mktemp -d`) seeded with the runbook's sandbox `ping.js` and `package.json` (setup step 1):

```
$ printf 'process.exit(0);\n' > ping.js
$ printf '{ "name": "studio-sandbox", "version": "0.0.0", "private": true, "scripts": { "test": "node ping.js" } }\n' > package.json
$ env -i PATH="/opt/homebrew/bin:/Users/vikashruhil/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin:/usr/sbin:/sbin" npm test

> studio-sandbox@0.0.0 test
> node ping.js

exit=0
```

The control ran in the same dir under the `PATH` session 266 had (`/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`):

```
$ env -i PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="<temp>/home" npm test
env: npm: No such file or directory
exit=127
```

What the proxy does not show: that launchd hands the plist's `PATH` to the kernel, that a kernel-started session runs `npm test` with an `allow` `tool_decision` and a passing result, and what the live `run_declared_checks` event holds. Those need the reinstall below.

## Validation 2: the owner's steps (not run by the worker)

No verdict is claimed for Validation 2 here. These steps are the owner's, from the branch build, as the runbook's setup step 8 describes:

1. From the shell you run `npm test` in, build and reinstall: `cd kernel && npm run build && node dist/cli/index.js service install` (or `studio service install`). The success line must read `its runs use gh <path>, git <path>, npm <path>, node <path>`, with no `warning: npm …` or `warning: node …` line.
2. Read the plist's `PATH`: `plutil -extract EnvironmentVariables.PATH raw ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`. It must hold the dir of that `npm` and `node` (on this machine, `~/.nvm/versions/node/v24.11.1/bin`).
3. Re-walk phase 8 step 1. The run session's events must show `npm test` as an `allow` `tool_decision` (reason `declared_check`) followed by a passing result in the session output, and the run's `run_declared_checks` event must carry `unrunnable: []` and `unrunnable_count: 0`.

## Validation 2, steps 1 and 2: reinstall from the branch (run 2026-11-24, owner-approved)

The owner approved reinstalling the live service from this branch before merge. The run built `feature/27a-run-can-run-the-checks-it-may-run` at `04f48f1d` (`cd kernel && npm ci && npm run build`) and ran `node dist/cli/index.js service install` from the owner's shell, whose first `npm` and `node` are `~/.nvm/versions/node/v24.11.1/bin`. Before the reinstall the plist's `PATH` was `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, the one session 266 had.

Step 1, the install line. There is no `warning: npm …` or `warning: node …` line. The one warning is the existing note that `node` lives under `~/.nvm`.

```
$ node dist/cli/index.js service install
studio service: warning: node /Users/vikashruhil/.nvm/versions/node/v24.11.1/bin/node is under ~/.nvm; the agent stops working if that Node version is removed (then run service install again with another node)
studio: service com.loomwright.studio.kernel installed and loaded: kernel 0.0.0 (pid 25945) running from /Users/vikashruhil/.loomwright-studio/app/0.0.0 (/Users/vikashruhil/Library/LaunchAgents/com.loomwright.studio.kernel.plist); its runs use gh /opt/homebrew/bin/gh, git /opt/homebrew/bin/git, npm /Users/vikashruhil/.nvm/versions/node/v24.11.1/bin/npm, node /Users/vikashruhil/.nvm/versions/node/v24.11.1/bin/node
```

Step 2, the plist's `PATH`, then the `PATH` launchd handed to the running kernel process. It holds npm's and node's dir and no other installer entry.

```
$ plutil -extract EnvironmentVariables.PATH raw ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist
/opt/homebrew/bin:/Users/vikashruhil/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin:/usr/sbin:/sbin
$ ps eww -p 25945 -o command= | tr ' ' '\n' | grep '^PATH='
PATH=/opt/homebrew/bin:/Users/vikashruhil/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin:/usr/sbin:/sbin
$ env -i PATH="/opt/homebrew/bin:/Users/vikashruhil/.nvm/versions/node/v24.11.1/bin:/usr/bin:/bin:/usr/sbin:/sbin" npm --version
11.6.2
```

Step 3 is not run here: a kernel-started session running `npm test` (an `allow` `tool_decision`, a passing result, `unrunnable_count: 0`). It is phase 8 walk step 1, which is re-walked after 27b also lands, so no verdict is claimed for Validation 2 as a whole.
