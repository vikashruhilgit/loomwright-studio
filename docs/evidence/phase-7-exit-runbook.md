# Phase 7 exit: the owner's live polish gate

Phase 7 is done when this holds in the running system ([`docs/ROADMAP.md`](../ROADMAP.md), phase 7 row): **each screen passes its polish gate.** The seven screens are Integrations, Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit and Settings. A screen passes when, on the owner's real store and in the packaged app opened from Finder, it looks and behaves like its view in the approved mockup ([`gui-v2.html`](../design/mockups/gui-v2.html), screenshots in [the mockup evidence](gui-v2-mockup/README.md)), in light and dark.

The deterministic half is in CI: `app/e2e/phase-7-exit.spec.ts` launches the built app once against one fixture kernel that serves all seven screens (`app/e2e/fixtures/phase-7-exit.ts`), reaches each screen from the sidebar by keyboard only, runs the keys each screen's own spec pins, walks every designed state of every screen in both themes, and checks that every view in the mockup README is covered by a test or named as a known gap. It proves the screens on fixture data, together. It does not prove them on real data or in the packaged app. This runbook is the live half: a visual comparison on this Mac, screen by screen. There is no `STUDIO_LIVE` harness for this phase, because the gate is a comparison with a design, not a store effect a script can read. Phase 5's and phase 6's live runs are the precedent ([phase 5](phase-5-exit-runbook.md), [phase 6](phase-6-exit-runbook.md)).

The owner decides when this runs. It uses the owner's launchd service, store and screen. The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md), [D35](../DECISIONS.md)); see [Who clicks](#who-clicks).

## What this run does to the machine

Read this before starting.

- **It reads your real store through the packaged app.** The app is a thin window over the kernel's loopback API; every screen shows what `~/.loomwright-studio/studio.db` (or `$STUDIO_DATA_DIR`) and the memory folder hold. Memory shows the text of your real memory files, Budget & audit your real token counts and audit log, Settings your account name and data location, Integrations your connected account and repos.
- **The screenshots show your real data.** That is the point of the run, and also the risk: see [Screenshots](#screenshots-the-owners-2026-10-31-decision) for how they are staged, reviewed and withheld. The repo is public.
- **It writes nothing, except what a step names.** The walk only looks, and presses keys that move focus or open a view. The steps that write are these, each named where it happens: [populating Tasks](#populating-thin-screens) (two task rows Wright creates, on your own data), stopping and restarting the service ([the unreachable state](#the-unreachable-state)), and the theme if you change it in Settings (it writes the app's own `prefs.json`; set it back to System).
- **It presses none of the screens' write controls**, unless the owner named the click in chat before the run (see [Who clicks](#who-clicks)): not Save in Memory, not a trigger or playbook switch, not Run now, not Turn off, not Replace token, Switch to GitHub App or Disconnect, not Launch at login. Opening Edit and cancelling it writes nothing.
- **Sessions spend tokens** on your subscription only in the Tasks step (Wright's session creating the rows).
- **Never an employer repository.** Nothing here is run against `vendsy/*` or any other employer repo, and a store that holds one is not used. Use your personal data only.

## Setup

Typed in a terminal, from the repo root, with the branch under test checked out. The service runs an install copy under `<dataDir>/app/`, not the checkout (D31), so reinstall after every build you want it to run.

1. **Build the kernel and reinstall the service**, as [phase 5's setup step 2](phase-5-exit-runbook.md#setup) does:

   ```bash
   cd kernel && npm ci && npm run build && cd ..
   node kernel/dist/cli/index.js service install
   launchctl print gui/$(id -u)/com.loomwright.studio.kernel | grep -E 'state|pid|last exit code'
   node kernel/dist/cli/index.js status
   ```

2. **Package the app and open it from Finder.**

   ```bash
   cd app && npm ci && npm run package && cd ..
   ```

   The output is `app/release/mac-arm64/Loomwright Studio.app`, ad-hoc signed and never notarised ([package evidence](phase-5-foundation-package.md)). **Open it from Finder** (double-click it, or right-click, Open, the first time), not with `npm start` and not from a terminal: the run checks the app a user gets.
3. **Record** the commit (`git rev-parse HEAD`), the service's pid, `sw_vers -productVersion` and `node --version`. These go in the evidence file.
4. **Stage the screenshot folder outside the repo**, and keep the compared mockup open in a browser next to the app:

   ```bash
   OUT="${TMPDIR:-/tmp}/studio-phase7-exit-$(date +%F)"; mkdir -p "$OUT"; echo "$OUT"
   open "file://$PWD/docs/design/mockups/gui-v2.html#view=tasks-populated&theme=light"
   ```

## Populating thin screens

A screen the real store has no rows for cannot be compared in its populated state, so make rows, from the app, on your own data. Never on `vendsy/*` or any employer repo.

- **Tasks** (empty today). In Chat, ask Wright to create two tasks, for example: `Create a task "Check my sandbox repo for new PRs" and park it, and a task "Pick the repos to review first" waiting on my answer.` Wright creates them with `kernel_task_create` (a task's state is free text Wright chooses; the board puts `waiting` in "Waiting on you" and `parked` in "Parked"). This writes two task rows to your real store and spends a session of tokens. If the store already has tasks, skip this.
- **Playbooks, Schedules & triggers, Budget & audit, Memory, Settings, Integrations.** Each has rows from the earlier phases' work (the phase 6 reviewer duty gives Playbooks, Schedules and Integrations rows; sessions give Budget its tokens; Wright's `role.md` gives Memory its files). If one shows its empty state, record it as `empty` and compare it with the `<screen>-empty` view; do not invent data for it.
- A state the real store does not reach (a held approval for Playbooks' `waiting`, an agent at its limit for Budget's `waiting`, an expiring token for Settings' `waiting`) is **not** manufactured. Record it `not_exercised`, with the reason: the fixture spec covers it.

## The walk

For each screen, open it in the packaged app, find its view in the mockup (`gui-v2.html#view=<view>&theme=<light|dark>`, or the review strip under the window), and compare in **light and dark** (macOS System Settings, Appearance; or the Settings screen's theme buttons, which write the app's `prefs.json`, so set System again at the end). Compare the layout, the words, the order of the sections, the states of the controls and the colours' meaning (a state is never colour alone). Use the keyboard wherever the mockup shows a key. Record each as **`match`** or **`mismatch`**, with a **one-line reason** and a **screenshot**.

| Screen | Views to compare (`#view=`) | Keys to try (no ⌘ keys: see [the known mismatches](#the-known-mismatches-to-expect)) |
|---|---|---|
| Integrations | `integrations-token` or `integrations-app-connected`, whichever the real store holds | Tab through the row, Replace token, Switch to GitHub App, Disconnect and Refresh. Do not press them |
| Tasks | `tasks-populated`; `tasks-waiting` and `tasks-empty` where the store shows them; `tasks-history` by opening a card | J / K between cards, Enter opens, Esc returns with focus on the card |
| Playbooks | `playbooks-populated`; `playbooks-waiting`, `playbooks-empty` where shown; `playbooks-detail`, `playbooks-history` by opening one (do not press Save in the edit view) | J / K between rows, Enter opens, Back |
| Schedules & triggers | `schedules-populated` or `schedules-empty` | Tab to the triggers, J / K, Enter |
| Memory | `memory-populated` or `memory-empty`; `memory-file` by opening one | J / K between files, Enter opens, Esc returns. Open Edit and cancel it, never save |
| Budget & audit | `budget-populated`; `budget-waiting`, `budget-empty` where shown; `budget-audit` by opening the log | Tab to Audit log, Enter opens it, Tab through the filters, Esc returns |
| Settings | `settings-populated`; `settings-waiting` or `settings-empty` where shown | Tab through each Copy, Reveal, the two switches (do not press them) and the three theme buttons |

### The unreachable state

Every screen's `<screen>-unreachable` view is the shared "Couldn't reach the kernel" band over the last-known data. Open all seven screens first, so each holds data, then stop the service and look at each again:

```bash
launchctl bootout gui/$(id -u)/com.loomwright.studio.kernel
```

Compare each screen with its `<screen>-unreachable` view, in light and dark: the band, the "last known" marks, the disabled controls. Then restart the service, which also checks it comes back:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist
node kernel/dist/cli/index.js status
```

(`node kernel/dist/cli/index.js service install` also restarts it.) Stop the service only when no session you care about is running; the kernel resumes from disk, but a running step is lost.

### Not reachable on a real store

The `loading` and `error` views cannot be shown on a real store on demand (a read that is slow, or one the kernel refuses). Record them `not_exercised` with that reason; the fixture spec covers them. The Integrations switch dialog (`integrations-token-to-app`, `-install`, `-failed`) opens a real GitHub App setup in your browser: compare those views only if the owner named the Switch click before the run; otherwise record them `not_exercised`.

## The known mismatches to expect

Two are known before the run (`KNOWN_GAPS` in `app/e2e/phase-7-exit.spec.ts`, and the entry "Phase 7 exit: live run (item 10, owner)" in [`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md)). Record each as a `mismatch`; do not skip it:

1. **The ⌘ shortcuts and ⌘K do nothing.** The sidebar labels Integrations `⌘5` through Memory `⌘9` and Settings `⌘,`, and the mockup has a ⌘K palette, but the shell mounts no global keyboard map and no command palette (`app/src/App.tsx`). Pressing them in the packaged app does nothing; reach each screen with the sidebar.
2. **There is no Keyboard map view.** The mockup's `keymap` view (opened from Settings with `?`) has no screen in the app.

Anything else you see that differs is a new finding.

## Who clicks

The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md), [D35](../DECISIONS.md)). Under D35 an agent may click only what the owner named in chat before the run, with its value: Wright's task request in [Populating thin screens](#populating-thin-screens), the Appearance or theme change, stopping and restarting the service, and any write control the owner chooses to compare (the Switch to GitHub App click, for one). The agent clicks nothing else. The evidence file's `run_by` says who ran it, and each such click is recorded as "the agent, on the owner's word". Every `owner` field holds only what the owner reports seeing.

## Screenshots (the owner's 2026-10-31 decision)

The repo is public and the screenshots show real data, so:

1. **Take them to the staged folder outside the repo**, `$OUT` from Setup step 4 (for example `${TMPDIR}/studio-phase7-exit-<date>/`), never into the checkout. One per screen, state and theme. `screencapture -o -x -w "$OUT/<screen>-<state>-<theme>.png"` lets you click the window; name each `<screen>-<state>-<theme>.png`.
2. **The owner reviews each one** before anything is committed.
3. **Those the owner approves are committed** under `docs/evidence/phase-7-exit-live-<date>/`, in the close commit and not before.
4. **One that shows private content stays local.** Take its hash, `shasum -a 256 "$OUT/<file>.png"`, and the evidence JSON records its file name and sha256 with `withheld: private`, in place of a path.

## The evidence file

`docs/evidence/phase-7-exit-live-<YYYY-MM-DD>.json`, written after the run in the shape of [phase 6's](phase-6-exit-runbook.md#the-evidence-file) and committed only at the close. It does not exist until then: this runbook names it, it does not link it. Copy machine values from the terminal; type your own observations into the `owner` fields. Never paste env, a token or a path to a credential.

```json
{
  "test": "phase-7-exit-live",
  "date": "YYYY-MM-DD",
  "result": "passed | failed — <one line>",
  "run_by": "<the owner, or which agent at the owner's request with the owner watching (D33)>",
  "commit": "<git rev-parse HEAD that the service and the app were built from>",
  "dirty_worktree": false,
  "machine": { "macos": "<sw_vers -productVersion>", "node": "<node --version>" },
  "service": "<the pid and state from launchctl print>",
  "app_opened_from": "Finder",
  "screens": {
    "tasks": {
      "populated": {
        "light": {
          "view": "tasks-populated",
          "outcome": "match | mismatch | not_exercised",
          "reason": "<one line>",
          "screenshot": { "path": "docs/evidence/phase-7-exit-live-<date>/tasks-populated-light.png" },
          "run_by": "<the owner | the agent, on the owner's word>",
          "owner": { "seen": null, "notes": "" }
        },
        "dark": {
          "view": "tasks-populated",
          "outcome": "match | mismatch | not_exercised",
          "reason": "<one line>",
          "screenshot": { "name": "tasks-populated-dark.png", "sha256": "<shasum -a 256>", "withheld": "private" },
          "run_by": "<the owner | the agent, on the owner's word>",
          "owner": { "seen": null, "notes": "" }
        }
      }
    }
  },
  "known_mismatches": [
    { "id": "shortcuts-and-palette", "outcome": "mismatch", "reason": "<what pressing ⌘5 … ⌘, and ⌘K did>", "finding": "<the new item's file name>" },
    { "id": "keymap", "outcome": "mismatch", "reason": "<no Keyboard map view>", "finding": "<the new item's file name>" }
  ],
  "findings": [],
  "owner": { "every_decision_made_by": "", "notes": "" },
  "cleanup": "<the tasks you made and what you did about them; the theme set back; the service running>"
}
```

`screens` repeats the `tasks` shape for `integrations`, `playbooks`, `schedules`, `memory`, `budget` and `settings`, with one object per state compared (`populated`, `empty`, `waiting`, `unreachable`, the click-through views) holding a `light` and a `dark` entry. A `screenshot` is either `{ "path": … }` for a committed image or `{ "name", "sha256", "withheld": "private" }` for one that stays local. A `not_exercised` entry still carries its reason. The `owner` fields stay empty until the owner reports.

## Findings

**Every mismatch becomes a new phase 7 requirement item** under `.supervisor/requirements/phase-7/` (its file name goes in the entry's `finding`). **Nothing is patched during the run**, and not in the PR that adds this check. Phase 7 stays not done until a re-run has no open mismatch. The two known mismatches above are findings for new items before the run starts, and they keep phase 7 open until those items land.

## Closing phase 7

Only after a run with no open mismatch, and in **one commit**:

- `docs/evidence/phase-7-exit-live-<date>.json`, and the approved screenshots under `docs/evidence/phase-7-exit-live-<date>/`;
- `docs/ROADMAP.md`, phase 7 row: add **Done `<date>`** and the evidence file's path to the first cell, and a ✓ at the end of its "Done when" cell, in the earlier rows' shape;
- `docs/OPEN_QUESTIONS.md`: tick the "Phase 7 exit: live run (item 10, owner)" entry and record what was and was not observed;
- run `bash scripts/check-docs.sh` (it must pass), and put the evidence path in the PR body.

The ROADMAP ✓ and the evidence file are never committed before a passing live run.
