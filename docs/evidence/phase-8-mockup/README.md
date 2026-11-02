# Phase 8 mockup: screenshot, token and field-map evidence (phase 8 item 02)

These are screenshots of every designed view of `docs/design/mockups/phase-8.html`, in light and dark (65 views, 130 images), plus the audit of its token block and of every value outside it, and the map from every field the mockup shows to a kernel column, a route or a shape a phase 8 requirement declares. The mockup is static: it runs no kernel and makes no GitHub, Atlassian or ClickUp call. Each view is forced by the URL hash (`#view=<view>&theme=<light|dark>`), so each screenshot comes from one headless-browser command. No script is committed. The owner approves the design by merging the PR that adds it (D9). What the mockup commits items 11–13 to, and the open points for the owner, are in `docs/DESIGN.md` §["Phase 8"](../../DESIGN.md#phase-8-tickets-to-prs). The mockup reuses `gui-v2.html`'s window, review strip, `Kernel unreachable` band and URL-hash hook; the GitHub connect flow itself (the App and the token) stays approved in `integrations.html`, so the GitHub App views here add only the permission upgrade.

What "empty" means in each group (each group also has a loading, an error and a `Kernel unreachable` view; the error view is a route failure card inside the body, never the band):

| Group | What "empty" means here |
|---|---|
| Tasks | No ticket has become a PR task yet ("No tickets in flight."). It is not "a connector is missing": Studio works with none |
| Approvals | No merge approval is pending ("Nothing waits on you."). A merge approval asks the owner to let Loomwright's gate go ahead with a PR |
| Playbooks | Studio ships no playbook ("No playbooks yet."); a playbook is behaviour Wright writes with the owner |
| GitHub App | GitHub is not connected, so there is no App to upgrade. The connect flow is in `integrations.html` |
| Repo policy | The App reaches no repo yet ("No repos reached yet."), so there is no card to show. A repo that is reached but has no policy is not empty: it is `policy-none`, "No policy: PRs park" |
| Jira, ClickUp | The connector is not connected: one primary action, Connect |
| Chat | One view (`chat-draft`); it has no empty, loading, error or unreachable view, because Chat is approved in `gui-v1.html` and only its draft card's read-only `mode` is drawn here |

## Screenshots

Each image is the full page: the intro line, the 1180×760 window, and the review strip under it with the forced view highlighted in its group. The viewport is 1280×1000 CSS px. The window is a fixed 1180×760 and its body scrolls, so a view taller than the window is cut at the window's bottom edge in the PNG (a long Tasks board, a repo policy card, a tools table); the rest is reachable by scrolling in a browser, and the cut part is also drawn by its own view where it has one (for example `policy-safe` for the Safe mode choice). Every view is also reachable from the review strip.

### Tasks (the ticket → PR card and its history)

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `tasks-empty` | The designed empty state: "No tickets in flight." with one body paragraph and one primary action, Ask Wright. Here "empty" means no ticket has become a PR task yet, not that a connector is missing | [phase-8-tasks-empty-light.png](phase-8-tasks-empty-light.png) | [phase-8-tasks-empty-dark.png](phase-8-tasks-empty-dark.png) |
| `tasks-loading` | Four columns of skeleton cards under their labels; `aria-busy` with a "Loading tasks" status | [phase-8-tasks-loading-light.png](phase-8-tasks-loading-light.png) | [phase-8-tasks-loading-dark.png](phase-8-tasks-loading-dark.png) |
| `tasks-populated` | The board: seven cards in four columns. Ticket → PR cards show the ticket's source chip and id, the PR number and state, the repo policy chip (`0/2 approvals`, `Solo`, `No policy`), the CI chip, the comment tally and who owns the PR; one plain task sits beside them. Waiting on you is empty, with its own line. CI pending is neutral (a hollow dot), never green | [phase-8-tasks-populated-light.png](phase-8-tasks-populated-light.png) | [phase-8-tasks-populated-dark.png](phase-8-tasks-populated-dark.png) |
| `tasks-waiting` | The same board with PR #21 in the first column (an `attention` edge): Loomwright's READY is in, the repo's policy is Approve in Studio, and the card's footer links to approval #7. A band says so | [phase-8-tasks-waiting-light.png](phase-8-tasks-waiting-light.png) | [phase-8-tasks-waiting-dark.png](phase-8-tasks-waiting-dark.png) |
| `tasks-error` | A route failure inside the screen body (`tasks request` · 500), with Try again and Kernel log. The shared band does not appear with it | [phase-8-tasks-error-light.png](phase-8-tasks-error-light.png) | [phase-8-tasks-error-dark.png](phase-8-tasks-error-dark.png) |
| `tasks-unreachable` | The shared `Kernel unreachable` band over the last-known board; every card is disabled and carries "Last known · read 14:22"; the subtitle says "last known 14:22" | [phase-8-tasks-unreachable-light.png](phase-8-tasks-unreachable-light.png) | [phase-8-tasks-unreachable-dark.png](phase-8-tasks-unreachable-dark.png) |
| `tasks-history` | The click-through for PR #21: its facts (ticket, PR, state, head commit, approvals with where the policy came from, CI with when it was recorded, comment tally, owner), a band linking to its approval, ten history rows (`task_created`, three sessions, `pr_state_changed`, `comment_routed`, `approval_requested`) and Session 54's log | [phase-8-tasks-history-light.png](phase-8-tasks-history-light.png) | [phase-8-tasks-history-dark.png](phase-8-tasks-history-dark.png) |

### Approvals (the "Approve in Studio" merge card)

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `approvals-empty` | The empty state: "Nothing waits on you." Here "empty" means no merge approval is pending; one action, Open Tasks | [phase-8-approvals-empty-light.png](phase-8-approvals-empty-light.png) | [phase-8-approvals-empty-dark.png](phase-8-approvals-empty-dark.png) |
| `approvals-loading` | A skeleton list and a skeleton pane | [phase-8-approvals-loading-light.png](phase-8-approvals-loading-light.png) | [phase-8-approvals-loading-dark.png](phase-8-approvals-loading-dark.png) |
| `approvals-error` | A route failure card (`approvals request` · 500) | [phase-8-approvals-error-light.png](phase-8-approvals-error-light.png) | [phase-8-approvals-error-dark.png](phase-8-approvals-error-dark.png) |
| `approvals-unreachable` | The shared band over the last-known approval; Allow once and Deny are disabled; the subtitle says "1 pending · last known" | [phase-8-approvals-unreachable-light.png](phase-8-approvals-unreachable-light.png) | [phase-8-approvals-unreachable-dark.png](phase-8-approvals-unreachable-dark.png) |
| `merge-card` | The "Approve in Studio" merge card for PR #21: repo, PR link, head commit (short SHA), CI with the time it was recorded, Loomwright's READY time, the repo's policy beside them ("set by you"), the note "Approving does not merge", and Allow once / Deny. There is no "Always for this playbook" | [phase-8-merge-card-light.png](phase-8-merge-card-light.png) | [phase-8-merge-card-dark.png](phase-8-merge-card-dark.png) |
| `merge-card-allowed` | After Allow once: "Approval recorded 14:23. Loomwright's gate merges PR #21 when its own checks pass; Studio merged nothing." | [phase-8-merge-card-allowed-light.png](phase-8-merge-card-allowed-light.png) | [phase-8-merge-card-allowed-dark.png](phase-8-merge-card-allowed-dark.png) |
| `merge-card-denied` | After Deny: "Denied at 14:23. PR #21 stays parked and nothing went to Loomwright's gate." | [phase-8-merge-card-denied-light.png](phase-8-merge-card-denied-light.png) | [phase-8-merge-card-denied-dark.png](phase-8-merge-card-denied-dark.png) |
| `approvals-enable-held` | The held enable that turning a playbook live creates (approval #8): the change `mode: draft → live`, the dry run it rests on, what live means, and Allow once / Deny. Merges stay with Loomwright's gate | [phase-8-approvals-enable-held-light.png](phase-8-approvals-enable-held-light.png) | [phase-8-approvals-enable-held-dark.png](phase-8-approvals-enable-held-dark.png) |

### Playbooks (the mode editor) and Chat

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `playbooks-empty` | The empty state: "No playbooks yet." and one action, Ask Wright for the first one. "Empty" means Studio ships none (D3) | [phase-8-playbooks-empty-light.png](phase-8-playbooks-empty-light.png) | [phase-8-playbooks-empty-dark.png](phase-8-playbooks-empty-dark.png) |
| `playbooks-loading` | Three skeleton rows | [phase-8-playbooks-loading-light.png](phase-8-playbooks-loading-light.png) | [phase-8-playbooks-loading-dark.png](phase-8-playbooks-loading-dark.png) |
| `playbooks-populated` | The Table: playbook (owner and version), trigger, mode, last dry run and the on/off switch, for three playbooks, all `draft` | [phase-8-playbooks-populated-light.png](phase-8-playbooks-populated-light.png) | [phase-8-playbooks-populated-dark.png](phase-8-playbooks-populated-dark.png) |
| `playbooks-error` | A route failure card (`playbooks request` · 500) | [phase-8-playbooks-error-light.png](phase-8-playbooks-error-light.png) | [phase-8-playbooks-error-dark.png](phase-8-playbooks-error-dark.png) |
| `playbooks-unreachable` | The shared band over the last-known Table; the rows, the switches and Ask Wright are disabled | [phase-8-playbooks-unreachable-light.png](phase-8-playbooks-unreachable-light.png) | [phase-8-playbooks-unreachable-dark.png](phase-8-playbooks-unreachable-dark.png) |
| `playbook-mode` | The mode editor for Tickets to PRs on studio-sandbox: priority, model, token limit and mode (draft or live), each with who set it, the dry run it has, and an inspector that lists the change and offers "Review live enable…" (live is a request, not a save) | [phase-8-playbook-mode-light.png](phase-8-playbook-mode-light.png) | [phase-8-playbook-mode-dark.png](phase-8-playbook-mode-dark.png) |
| `playbook-mode-no-dry-run` | Triage PR comments on studio-sandbox has never run a dry run: the `live` option is disabled ("run a dry run first") and "No dry run yet" offers Run a dry run | [phase-8-playbook-mode-no-dry-run-light.png](phase-8-playbook-mode-no-dry-run-light.png) | [phase-8-playbook-mode-no-dry-run-dark.png](phase-8-playbook-mode-no-dry-run-dark.png) |
| `playbook-mode-confirm` | The live-enable confirm over the editor: live acts on GitHub through the approval gate; the dry run, the held enable and the first-time hold on each outward kind are listed; Cancel and Request live enable | [phase-8-playbook-mode-confirm-light.png](phase-8-playbook-mode-confirm-light.png) | [phase-8-playbook-mode-confirm-dark.png](phase-8-playbook-mode-confirm-dark.png) |
| `playbook-mode-held` | After Request live enable: a band "Live is requested… waits on you: approval #8", the mode reads `live requested`, the playbook is still a draft, and the inspector links to the approval | [phase-8-playbook-mode-held-light.png](phase-8-playbook-mode-held-light.png) | [phase-8-playbook-mode-held-dark.png](phase-8-playbook-mode-held-dark.png) |
| `playbook-mode-live` | After the owner allows approval #8: mode `live`, set by you, with the note that each kind of outward action is still held the first time | [phase-8-playbook-mode-live-light.png](phase-8-playbook-mode-live-light.png) | [phase-8-playbook-mode-live-dark.png](phase-8-playbook-mode-live-dark.png) |
| `chat-draft` | Chat: Wright's drafted playbook card keeps mode read-only (a lock, `draft`, "read-only here") and says mode changes on Playbooks after the dry run and a held enable. Drawn as one view, filed under Playbooks | [phase-8-chat-draft-light.png](phase-8-chat-draft-light.png) | [phase-8-chat-draft-dark.png](phase-8-chat-draft-dark.png) |

### Integrations: GitHub App permission upgrade

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `app-empty` | GitHub is not connected: "Connect GitHub so Studio can read your repos." The connect flow itself is approved in `integrations.html`; "empty" here means no App to upgrade | [phase-8-app-empty-light.png](phase-8-app-empty-light.png) | [phase-8-app-empty-dark.png](phase-8-app-empty-dark.png) |
| `app-loading` | Skeleton rows under the GitHub header | [phase-8-app-loading-light.png](phase-8-app-loading-light.png) | [phase-8-app-loading-dark.png](phase-8-app-loading-dark.png) |
| `app-error` | A route failure card (`GitHub connector request` · 500) | [phase-8-app-error-light.png](phase-8-app-error-light.png) | [phase-8-app-error-dark.png](phase-8-app-error-dark.png) |
| `app-unreachable` | The shared band over the last-known App; the status reads "Unknown while the kernel is unreachable"; Accept on GitHub is disabled | [phase-8-app-unreachable-light.png](phase-8-app-unreachable-light.png) | [phase-8-app-unreachable-dark.png](phase-8-app-unreachable-dark.png) |
| `app-upgrade` | "Needs new permissions": the installed App is read-only. The permission table shows now against after you accept (every repository permission at read and write; Metadata stays read-only), the address the kernel gives, and "Session tokens are down-scoped" to Pull requests, Contents, Issues and Checks | [phase-8-app-upgrade-light.png](phase-8-app-upgrade-light.png) | [phase-8-app-upgrade-dark.png](phase-8-app-upgrade-dark.png) |
| `app-upgrade-opened` | The waiting dialog "Accept the new permissions on GitHub": three steps, the address, Cancel, Open GitHub again and Check now | [phase-8-app-upgrade-opened-light.png](phase-8-app-upgrade-opened-light.png) | [phase-8-app-upgrade-opened-dark.png](phase-8-app-upgrade-opened-dark.png) |
| `app-upgraded` | After GitHub reports the new set: connected, `read and write`, "checked by GitHub today 14:24" | [phase-8-app-upgraded-light.png](phase-8-app-upgraded-light.png) | [phase-8-app-upgraded-dark.png](phase-8-app-upgraded-dark.png) |

### Integrations: repo policy card

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `policy-empty` | "No repos reached yet." One action, Open GitHub App. "Empty" means the App reaches no repo, so there is no card to show | [phase-8-policy-empty-light.png](phase-8-policy-empty-light.png) | [phase-8-policy-empty-dark.png](phase-8-policy-empty-dark.png) |
| `policy-loading` | Skeleton rows under the Repo policy header | [phase-8-policy-loading-light.png](phase-8-policy-loading-light.png) | [phase-8-policy-loading-dark.png](phase-8-policy-loading-dark.png) |
| `policy-error` | A route failure card (`repo policy request` · 500) | [phase-8-policy-error-light.png](phase-8-policy-error-light.png) | [phase-8-policy-error-dark.png](phase-8-policy-error-dark.png) |
| `policy-unreachable` | The shared band over the last-known card for studio-sandbox; Re-detect and Change policy are disabled; "last known 14:22" | [phase-8-policy-unreachable-light.png](phase-8-policy-unreachable-light.png) | [phase-8-policy-unreachable-dark.png](phase-8-policy-unreachable-dark.png) |
| `policy-proposed` | team-service: what GitHub enforces (protection, required reviews and checks, who can push, with "read today 14:20" and Re-detect, each value "detected from GitHub"), Wright's proposal (N GitHub reviews, N = 2 "proposed by Wright", GitHub itself asks for 1), the three presets with an editable N, and Accept proposal | [phase-8-policy-proposed-light.png](phase-8-policy-proposed-light.png) | [phase-8-policy-proposed-dark.png](phase-8-policy-proposed-dark.png) |
| `policy-edited` | The owner typed N = 3: the number reads "set by you" and the button says Set policy | [phase-8-policy-edited-light.png](phase-8-policy-edited-light.png) | [phase-8-policy-edited-dark.png](phase-8-policy-edited-dark.png) |
| `policy-accepted` | studio-sandbox with a policy set: Approve in Studio, "set by you", set today 09:15, "A playbook may only be stricter than this", and Change policy | [phase-8-policy-accepted-light.png](phase-8-policy-accepted-light.png) | [phase-8-policy-accepted-dark.png](phase-8-policy-accepted-dark.png) |
| `policy-none` | ntfs-tool has no branch protection and no proposal: the card says what to set on GitHub and links to it, no preset is selected, Accept is disabled, and the badge reads "No policy: PRs park" | [phase-8-policy-none-light.png](phase-8-policy-none-light.png) | [phase-8-policy-none-dark.png](phase-8-policy-none-dark.png) |
| `policy-unenforceable` | scratch-notes is private on Free: "GitHub can't enforce protection on this repo (private on Free)" and three ways to go on, none picked: Make public or upgrade (links to GitHub), Trust unprotected…, Safe mode | [phase-8-policy-unenforceable-light.png](phase-8-policy-unenforceable-light.png) | [phase-8-policy-unenforceable-dark.png](phase-8-policy-unenforceable-dark.png) |
| `policy-trust-confirm` | The Trust unprotected confirm (`alertdialog`): it waives condition 4 only, never the high-risk park, and is recorded and passed to Loomwright as `--trust-unprotected` for this repo only | [phase-8-policy-trust-confirm-light.png](phase-8-policy-trust-confirm-light.png) | [phase-8-policy-trust-confirm-dark.png](phase-8-policy-trust-confirm-dark.png) |
| `policy-trusted` | After the confirm: "Trusted unprotected" recorded today 14:23, set by you; the presets appear below with N GitHub reviews switched off (GitHub can't enforce reviews), and a policy is still to be picked | [phase-8-policy-trusted-light.png](phase-8-policy-trusted-light.png) | [phase-8-policy-trusted-dark.png](phase-8-policy-trusted-dark.png) |
| `policy-safe` | Safe mode recorded: /automate opens and fixes PRs here and stops before Loomwright's gate | [phase-8-policy-safe-light.png](phase-8-policy-safe-light.png) | [phase-8-policy-safe-dark.png](phase-8-policy-safe-dark.png) |

### Integrations: Jira connect (MCP + OAuth)

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `jira-empty` | Not connected: "Connect Jira so a playbook can read your tickets." with the "Work account · stub only" note. "Empty" means not connected | [phase-8-jira-empty-light.png](phase-8-jira-empty-light.png) | [phase-8-jira-empty-dark.png](phase-8-jira-empty-dark.png) |
| `jira-loading` | Skeleton rows under the note | [phase-8-jira-loading-light.png](phase-8-jira-loading-light.png) | [phase-8-jira-loading-dark.png](phase-8-jira-loading-dark.png) |
| `jira-error` | A route failure card (`Jira connector request` · 500) | [phase-8-jira-error-light.png](phase-8-jira-error-light.png) | [phase-8-jira-error-dark.png](phase-8-jira-error-dark.png) |
| `jira-unreachable` | The shared band over the last-known Jira; the status reads "Unknown… last verified today 14:02"; Disconnect is disabled | [phase-8-jira-unreachable-light.png](phase-8-jira-unreachable-light.png) | [phase-8-jira-unreachable-dark.png](phase-8-jira-unreachable-dark.png) |
| `jira-connect` | The Connect sheet: Studio opens Atlassian's consent page in the browser; three steps; "Open Atlassian in your browser" | [phase-8-jira-connect-light.png](phase-8-jira-connect-light.png) | [phase-8-jira-connect-dark.png](phase-8-jira-connect-dark.png) |
| `jira-consent` | The browser-consent wait: three steps (opened, your approval, token kept), "this window closes… at 14:32", Cancel and Open Atlassian again | [phase-8-jira-consent-light.png](phase-8-jira-consent-light.png) | [phase-8-jira-consent-dark.png](phase-8-jira-consent-dark.png) |
| `jira-refused` | Atlassian answered `access_denied`: nothing connected, no token kept; Close and Try again | [phase-8-jira-refused-light.png](phase-8-jira-refused-light.png) | [phase-8-jira-refused-dark.png](phase-8-jira-refused-dark.png) |
| `jira-connected` | Connected: the site, account, server and Keychain item, and the server's five tools with which crew member is granted which (the grant is set in Team); write tools are marked "Changes things" | [phase-8-jira-connected-light.png](phase-8-jira-connected-light.png) | [phase-8-jira-connected-dark.png](phase-8-jira-connected-dark.png) |
| `jira-expired` | Expired: a `danger` dot and band ("Atlassian no longer accepts Studio's token"), the last tool list marked "last listed", and Reconnect | [phase-8-jira-expired-light.png](phase-8-jira-expired-light.png) | [phase-8-jira-expired-dark.png](phase-8-jira-expired-dark.png) |
| `jira-disconnect` | The Disconnect confirm (`alertdialog`): what Studio deletes (tokens, crew grants) and what stays the owner's (remove "Loomwright Studio" at Atlassian), with a link | [phase-8-jira-disconnect-light.png](phase-8-jira-disconnect-light.png) | [phase-8-jira-disconnect-dark.png](phase-8-jira-disconnect-dark.png) |

### Integrations: ClickUp connect (MCP + OAuth)

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `clickup-empty` | Not connected: "Connect ClickUp so a playbook can read your tickets." (the personal ClickUp). "Empty" means not connected | [phase-8-clickup-empty-light.png](phase-8-clickup-empty-light.png) | [phase-8-clickup-empty-dark.png](phase-8-clickup-empty-dark.png) |
| `clickup-loading` | Skeleton rows | [phase-8-clickup-loading-light.png](phase-8-clickup-loading-light.png) | [phase-8-clickup-loading-dark.png](phase-8-clickup-loading-dark.png) |
| `clickup-error` | A route failure card (`ClickUp connector request` · 500) | [phase-8-clickup-error-light.png](phase-8-clickup-error-light.png) | [phase-8-clickup-error-dark.png](phase-8-clickup-error-dark.png) |
| `clickup-unreachable` | The shared band over the last-known ClickUp; the status reads "Unknown… last verified today 14:02"; Disconnect is disabled | [phase-8-clickup-unreachable-light.png](phase-8-clickup-unreachable-light.png) | [phase-8-clickup-unreachable-dark.png](phase-8-clickup-unreachable-dark.png) |
| `clickup-connect` | The Connect sheet: Studio opens ClickUp's consent page in the browser; three steps | [phase-8-clickup-connect-light.png](phase-8-clickup-connect-light.png) | [phase-8-clickup-connect-dark.png](phase-8-clickup-connect-dark.png) |
| `clickup-consent` | The browser-consent wait with Cancel and Open ClickUp again | [phase-8-clickup-consent-light.png](phase-8-clickup-consent-light.png) | [phase-8-clickup-consent-dark.png](phase-8-clickup-consent-dark.png) |
| `clickup-refused` | ClickUp answered `access_denied`: nothing connected; Close and Try again | [phase-8-clickup-refused-light.png](phase-8-clickup-refused-light.png) | [phase-8-clickup-refused-dark.png](phase-8-clickup-refused-dark.png) |
| `clickup-connected` | Connected: workspace, account, server and Keychain item, the five tools with the crew grants (set in Team), and a `personal` badge | [phase-8-clickup-connected-light.png](phase-8-clickup-connected-light.png) | [phase-8-clickup-connected-dark.png](phase-8-clickup-connected-dark.png) |
| `clickup-expired` | Expired: the band names the one parked playbook that reads ClickUp tickets; Reconnect | [phase-8-clickup-expired-light.png](phase-8-clickup-expired-light.png) | [phase-8-clickup-expired-dark.png](phase-8-clickup-expired-dark.png) |
| `clickup-disconnect` | The Disconnect confirm: what Studio deletes and what stays the owner's, with a link | [phase-8-clickup-disconnect-light.png](phase-8-clickup-disconnect-light.png) | [phase-8-clickup-disconnect-dark.png](phase-8-clickup-disconnect-dark.png) |
## What was driven by hand

The views above are static. The paths between them were driven in headless Chromium (Playwright 1.64.1) with a scratch script outside the repo (2026-11-02), after the last edit to the mockup. The run made 124 assertions, all held, and reported 0 console errors and 0 page errors:

- **Odd hashes** fall back to the default view, `tasks-populated`: empty, `#`, `#view=bogus`, `#view=__proto__`, `#view=constructor`, `#view=toString`, `#view=hasOwnProperty`, and a repeated `view` (the first is taken). A bad `theme` (`#view=policy-proposed&theme=bad`) keeps the view and leaves `data-theme` unset; `#theme=dark` alone keeps the default view and sets the theme; a live `hashchange` to `#view=__proto__` falls back and does not throw.
- **Every view renders in both themes:** all 65 keys, set one after another through the hash, in light and dark, each shows its screen and the forced theme. Every `*-unreachable` view shows the shared band; every `*-error` view shows the route failure card and not the band.
- **The merge card (AC7):** it offers Allow once and Deny, no "Always for this playbook" and no control whose text says merge. Allow once records "Approval recorded 14:23. Loomwright's gate merges PR #21 when its own checks pass; Studio merged nothing.", puts focus on the decision line and raises the toast; Deny says "PR #21 stays parked"; the keys `A` and `D` do the same. In `approvals-unreachable` Allow once is disabled.
- **Tasks:** Open approval #7 on the waiting card opens the merge card; Enter on a card opens its history with focus on Back, Back returns to the board with focus on that card, `J` moves between cards; in `tasks-unreachable` every card is disabled and marked "Last known".
- **Disconnect confirms (Jira and ClickUp):** Disconnect opens an `alertdialog`; Tab and Shift+Tab stay inside it; `Esc` closes it and focus returns to Disconnect; confirming lands on the not-connected view with focus on Connect and a toast.
- **The consent wait (Jira and ClickUp):** Connect opens the sheet (the copy names Atlassian or ClickUp and never claude.ai); Open … in your browser starts the wait; Cancel returns to not-connected with focus on Connect, and 3 s later nothing has fired (the pending consent never completes after a cancel); left alone the wait finishes by itself into connected after 2.5 s with the granted tools shown; `Esc` on the wait cancels; from the refused sheet, Try again goes back to the wait. The Jira views carry "Work account · stub only" and "never exercised live".
- **The GitHub App upgrade:** Accept on GitHub opens the waiting dialog; `Esc` cancels and focus returns to Accept on GitHub, and a cancelled wait never finishes by itself; left alone it moves to `app-upgraded` after 2.5 s; Check now finishes at once.
- **Policy presets and the editable N (AC8):** on `policy-proposed` N reads 2, "proposed by Wright", and the button says Accept proposal; typing 3 flips the number to "set by you" and the button to Set policy, with the caret staying in the field; 0 and an empty N disable Accept; Accept records the policy "set by you" with N = 3 "set by you", raises the toast and puts focus on the status line; Change policy re-opens the presets. On `policy-none` (no proposal) no preset is selected and Accept is disabled; picking N GitHub reviews leaves N empty and Accept still disabled until the owner types a number, so no number is a default. Re-detect updates the read time to 14:23.
- **Trust unprotected (AC7):** on `policy-unenforceable` there are no presets (nothing is picked silently), Make public and Upgrade are links to github.com, and Trust unprotected… opens an `alertdialog` that names "Waives condition 4 only", "Does not waive the high-risk park" and `--trust-unprotected`; `Esc` closes it with focus back on the button and nothing recorded; confirming records "recorded today 14:23", set by you; Stop trusting returns to the choices; Safe mode is its own recorded choice. In `policy-unreachable` Re-detect is disabled.
- **The palette:** `⌃K` opens it with focus in its input; typing `jira` lists "Connect Jira" with `integrations.connect-jira`, Enter opens the sheet and `Esc` closes it; `clickup` lists `integrations.connect-clickup` (and says it is already connected, in the default data); `repo policy` lists `integrations.repo-policy` and opens the card; the footer reads "Wright, powered by Claude" and is the only attribution; in `jira-unreachable` Connect Jira is disabled.
- **The live enable (AC8):** on `playbook-mode`, picking `live` in the select changes nothing (the header still reads `draft`) and the inspector says "Live is a request, not a save" with a "Review live enable…" button. It opens the confirm: live acts on GitHub through the approval gate, the dry run (finished today 10:41, v2), the held enable and the first-time hold on each outward kind. `Esc` cancels with focus back on Review live enable…. Request live enable leaves the playbook a `draft` with the band "Live is requested… waits on you: approval #8", the toast, and the Approvals count at 2; the band's link opens the held-enable approval, whose Allow once is the only step that turns `live` on, and Playbooks then shows `live`. With no dry run (`playbook-mode-no-dry-run`) the `live` option is disabled and says to run one first. Chat's draft card has no select and no input (mode is read-only). A token limit of `abc` turns Save off with `aria-invalid`.

Not driven: a screen reader. Dialog roles, labels and the radio group are set, and none was run.

## How to regenerate

Setup, once: the Playwright CLI at the version `app/package-lock.json` pins (1.64.1), with its Chromium:

```sh
cd app && npm ci && npx playwright install chromium
```

(Run in this checkout on 2026-11-02; `npm ci` left `app/package-lock.json` unchanged.) Then, from `app/`, each shot is one command. `<repo>` is the absolute path of your checkout, `<v>` is a value from the `View` column above, and `<t>` is `light` or `dark`:

```sh
npx playwright screenshot --color-scheme=<t> --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/phase-8.html#view=<v>&theme=<t>' <repo>/docs/evidence/phase-8-mockup/phase-8-<v>-<t>.png
```

For example, `policy-unenforceable` in dark:

```sh
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/phase-8.html#view=policy-unenforceable&theme=dark' <repo>/docs/evidence/phase-8-mockup/phase-8-policy-unenforceable-dark.png
```

To regenerate all 130 (bash, from `app/`; it was run as a scratch script with this list):

```sh
for v in tasks-empty tasks-loading tasks-populated tasks-waiting tasks-error tasks-unreachable tasks-history approvals-empty approvals-loading approvals-error approvals-unreachable merge-card merge-card-allowed merge-card-denied approvals-enable-held playbooks-empty playbooks-loading playbooks-populated playbooks-error playbooks-unreachable playbook-mode playbook-mode-no-dry-run playbook-mode-confirm playbook-mode-held playbook-mode-live chat-draft app-empty app-loading app-error app-unreachable app-upgrade app-upgrade-opened app-upgraded policy-empty policy-loading policy-error policy-unreachable policy-proposed policy-edited policy-accepted policy-none policy-unenforceable policy-trust-confirm policy-trusted policy-safe jira-empty jira-loading jira-error jira-unreachable jira-connect jira-consent jira-refused jira-connected jira-expired jira-disconnect clickup-empty clickup-loading clickup-error clickup-unreachable clickup-connect clickup-consent clickup-refused clickup-connected clickup-expired clickup-disconnect; do
  for t in light dark; do
    npx playwright screenshot --color-scheme=$t --viewport-size=1280,1000 --full-page --wait-for-timeout=600 "file://<repo>/docs/design/mockups/phase-8.html#view=$v&theme=$t" "<repo>/docs/evidence/phase-8-mockup/phase-8-$v-$t.png"
  done
done
```

The hash's `theme` sets `data-theme` on the page, and `--color-scheme` matches it, so a shot never depends on the host's appearance setting. `--wait-for-timeout=600` lets the dialog's open animation (`duration-slow`, 240ms) finish; the consent and permission waits finish by themselves after 2.5 s, and a forced `…-consent` or `…-upgrade-opened` view starts that timer on a click only, so the shot shows the wait. The `working` dots and the spinner animate, so their frame can differ by a few pixels in a regenerated shot. No cached-browser fallback was needed.

## Token audit

### The token block is the generator's output, verbatim

The mockup's `<style>` opens with the stdout of `node app/scripts/tokens.mjs`, pasted between the `/* tokens:begin */` and `/* tokens:end */` comment lines. Generator names are used throughout (`--radius-lg`, `--duration-base`, `--ease-standard`, `--space-4`, `--type-body-size`), never gui-v1's short forms (`--r-lg`, `--d-base`, `--ease`). To check, run this from the repo root (bash, for the process substitution):

```sh
diff <(node app/scripts/tokens.mjs) <(awk '/\/\* tokens:end \*\//{f=0} f; /\/\* tokens:begin \*\//{f=1}' docs/design/mockups/phase-8.html); echo "exit $?"
```

Result, 2026-11-02: no diff output, then `exit 0`. The block is 195 lines, the same as the generator's stdout. `grep -n -E "var\(--(r-[a-z]+|d-[a-z]+|ease)\)" docs/design/mockups/phase-8.html` prints nothing: no short-form name is used.

### Values outside the block

The rest of the `<style>` is in three parts. The **harness** block (`harness:begin` … `harness:end`) is the same as `gui-v2.html`'s and `integrations.html`'s. The **app UI** part uses `var(--…)` tokens, plus the literals below; most of it is copied unchanged from `gui-v2.html`. The **Phase 8 additions** block (and the Integrations block inside it) holds the new rules. Only the first of the three is review-harness chrome.

The table names every literal value outside the token block, found by listing each number and colour in the CSS outside it (a script over every declaration, with `var(...)` removed), plus the values the script passes inline. Structural values are not listed: `0`, `100%`, `1fr`, `auto`, `max-content`, `minmax(0, 1fr)`, `flex: 1`, `grid-row: 2`, `repeat(4, …)` (the board's four columns), `-webkit-line-clamp: 2` and `margin: calc(var(--space-2) * -1)` lay out the page and carry no design value. The colour keywords `transparent` and `currentColor` are structural too. Lucide icon geometry (the `d` paths) and the avatar shapes are drawing data, not styles; the GitHub mark is copied from `integrations.html`.

| Value | Where | Marking |
|---|---|---|
| `--desk` `#3a3d52` / `#101118`, `--desk-ink` `#eef0ff` / `#d9dbef` | The desk the window sits on, the intro line and the review strip (light / dark) | review-harness chrome (not app UI) |
| `--win-shadow` `0 24px 80px #00000059, 0 0 0 1px #00000026` / `0 24px 80px #000000b3, 0 0 0 1px #ffffff1f` | The window's drop shadow on the desk, applied to `.win` | review-harness chrome (not app UI) |
| `#ff5f57`, `#febc2e`, `#28c840`; 12px circles at `50%` radius, `8px` gap and padding | The macOS traffic lights (the real app gets them from the OS) | review-harness chrome (not app UI) |
| `#ffffff14`, `#ffffff33`, `#ffffff26`, `#ffffff1f` | Review strip fill, borders, the selected segment and the key chips | review-harness chrome (not app UI) |
| `1240px`, `26px`, `12px`, `15px`, `20px`, `16px`, `24px`, `10px`, `18px`, `6px`, `5px`, `4px`, `1px`, `2px`; opacity `.7`, `.75`, `.9`; weights `500`, `600`; `max-width: 1280px` media query | Page, intro and review-strip sizes, type, padding, gaps, radii and focus ring; the breakpoint under which the intro and the strip go full width | review-harness chrome (not app UI) |
| `1180px` × `760px` | The window | new — the default window size; gui-v1 and phase 5's polish evidence ("The default window is 1180×760") |
| `blur(24px) saturate(1.4)` | Sidebar vibrancy | new — specified in `brand-book.md` §Layout; tokens.json has no filter values |
| `1px` | Hairline and border widths; the visually hidden live region's size | new — component READMEs specify "a `hairline` edge"; tokens.json has edge colours but no widths |
| `2px` | Focus ring width and offset (also the held-enable band's outline offset and the preset option's focus ring); the `idle` ring's stroke; the switch knob's inset; the spinner's border | new — `brand-book.md` §Colour: "2px solid with a 2px offset"; the StatusDot idle ring as in gui-v1; the knob sits 2px in from each edge of its track; the spinner is `integrations.html`'s |
| `8px` (and `calc((var(--type-body-line) - 8px) / 2)`) | StatusDot size; the list row's dot column; centring the dot on the subject line | new — StatusDot README: "An 8px dot" |
| `16px`, `14px`, `12px`; stroke widths `1.5`, `1.75`, `2` | Lucide icon sizes (rows, buttons and badges, checks), the GitHub mark (16px), the preset radio (16px) and its label column, the N row's indent (`calc(16px + var(--space-3))`), the spinner (12px) | new — `brand-book.md` §Iconography (16px at 1.5px stroke; 14px in badges); gui-v1's icon classes; the radio matches a 16px icon; the spinner is `integrations.html`'s |
| `20px` | Badge height; the DiffView's marker column; the small Avatar size (inline `--s`) | new — Badge README: "All 20px tall"; the gutter and the avatar reuse the Badge's size, and 20px is List README's small Avatar |
| `24px` | The Avatar size on Chat turns and the crew rows (inline `--s`); the Chat turn's avatar column | new — List README (24px Crew avatar) |
| `32px` | Avatar's default `--s`; the danger disc in a confirm dialog (`.dlg .icon`) | new — `avatar.css` default; the disc is copied unchanged from `integrations.html` |
| `32px` × `18px`, knob `14px`, `translateX(14px)`, opacity `.5` when disabled | The on/off switch (the Playbooks table's On column) | new — differs from Table README's 26×16, as in `gui-v2.html` (its open point 13); the owner may revert it, a one-line change per value |
| `44px` | Crew row height; the palette's search row; the session log's bar | new — List README (44px Crew rows), CommandPalette README ("a 44px search row"), gui-v1's log bar |
| `10px` | A skeleton line's height | new — gui-v1's skeleton (`.skel i`, 10px) |
| `70%`, `40%` | A skeleton card's second and third line widths | new — gui-v1's skeleton rhythm (short last lines) |
| `7px` × `14px`, `-2px` | The streaming caret (a block) and its baseline nudge in the session log | new — as in `gui-v2.html`; gui-v1's is a 2px bar for Chat's text |
| `68px` | The session log's time column | new — a `HH:MM` in `mono` plus a gap |
| `150px` | The field-level edit's label column (the mode editor); the permission table's "Now" column (`.rh .c2`) | new — the longest label ("Token limit per day") plus a gap; the longest word in the column ("Read-only (GitHub fixes it)" wraps within it) |
| `170px` | The Playbooks table's Dry run column; the permission table's "After you accept" column (`.rh .c3`) | new — Table README sets no widths; these fit "finished Thu 29 Oct 14:02" and "Read and write" at `caption` size in a 1180px window |
| `200px`, `92px`, `56px` | The Playbooks table's Trigger, Mode and On columns (Playbook takes the rest); `92px` is also the tool-grant table's crew columns (`.rh.tlt .c3`) | new — as above; 56px is a switch plus padding, 92px a `live requested` Badge or a "Granted" Badge |
| `96px` | The number-of-reviews input (`.opt .nrow .field`) | new — a whole number up to 3 digits at body size plus the Input's padding (`nOk` accepts 1–999) |
| `720px` | Chat turn maximum width | new — copied from gui-v1's `.turn` (`max-width:720px`) |
| `480px`, `560px`, `360px`, `20%` | Dialog width (and the route-failure card's maximum width), the wide Dialog and the palette width, the toast width and the palette list's maximum height, the palette's offset from the top | new — Dialog README ("360px (480px when it carries a diff)"); `560px` for the connect, consent, upgrade and trust dialogs, which carry steps or a list; CommandPalette README ("560px", "centred at 20% from the top"); Toast README ("360px") |
| `65ch`, `44ch` | Maximum width of the empty state's lines; of the "no session log" line | new — `brand-book.md` §Type: "Running text stays under 65 characters"; 44ch keeps a two-line note narrow |
| `500` | Font weight of buttons, the selected sidebar row, the neutral badge, form labels and the pressed chip | new — List README ("weight 500" when selected), gui-v1's buttons and neutral badge; tokens.json defines 500 only for `kbd` |
| `.55`, `.85`, `50%` | The `working` dot's breathing keyframe (opacity, scale, midpoint) | new — gui-v1's StatusDot `pulse`; the duration is `--duration-pulse` |
| `.98` | Dialog and palette open scale | new — Dialog and CommandPalette READMEs: "scaling from 0.98" |
| `1turn` | The spinner's rotation keyframe (`@keyframes turn`) | new — `integrations.html`'s spinner; the duration is `--duration-pulse` |
| `50`, `60` | Overlay and toast `z-index` | new — gui-v1's overlay stacking, the toast above it |
| `inset(50%)` | `clip-path` of the visually hidden live region and labels | new — the standard visually-hidden pattern for the `aria-live` announcer |
| Opacity `.28`, `.45`, `.85`; stroke widths `1.6`, `1.2`, `1.9`, `.8`; dash arrays `2.6 1.5`, `1.8 1.4`, `2.4 2.6` | The Avatar's fill, stitches, lines, loose thread and crown (static idle pose) | new — copied unchanged from `docs/design/avatar/avatar.css`; no avatar value is a token there either |
| `72px` | The textarea's minimum height | new — three body lines of `--type-body-line`; carried from `gui-v2.html` and unused: no phase 8 view has a textarea |
| `2500` ms, `4000` ms (script) | The mock consent and GitHub-acceptance waits; how long a toast stays | new — mock behaviour only, not design durations (Toast README says a toast stays 6s or until hovered; the mock's is shorter so a review strip click never stacks them) |
| inline `--s:20px`, `--s:24px` (script) | Avatar sizes on a card, a history row, a Chat turn and a crew row | new — List and Card READMEs' avatar sizes (20px small, 24px Crew) |

A few rules carried from `gui-v2.html` are drawn by no phase 8 view and have no visible effect: `.pf`, `.tbl .intent`, `.field.ta` with `.field textarea`, `.diff .ctx` and `.log .err`. They are left in so the shared rules stay byte-for-byte as approved.

### New components and variants

The mockup uses List, Card, Badge, StatusDot, Dialog, Input, Toast, DiffView, StreamingLog, EventCard and Avatar, plus Button, CommandPalette and Table, as the design system defines them. Each class below is new in phase 8 (the ones copied from `gui-v2.html` or `integrations.html` are approved there and are listed in the last row), and each names its reason.

| Class | What it is | Marking |
|---|---|---|
| `.tw`, `.tw .tcard`, `.tw .tfoot` | The ticket → PR card: a list item that holds the open-history button and, under it, an optional footer with its own button ("Open approval #7", "Open repo policy") | new — a Card variant. The footer action cannot sit inside the card's button (a button in a button is invalid), so the card is a list item with two siblings |
| `.pills`, `.srcchip`, `.tally`, `.lk` | The card's chip row (state, policy, CI), the ticket source chip (the GitHub mark in `ink`, or the name), the comment tally line, and the "Last known" mark | new — layout and type over Badge, StatusDot and the existing icon; no new colour. The GitHub mark is a connector label only, as in `integrations.html` |
| `.mcard`, `.mcard .mh/.mb/.mf`, `.mcard.done` | The approval card (merge approval, held enable) and, reused, the repo policy card: a header with a Badge, a body, a footer with the actions; an `attention` edge while it waits, a `hairline` edge once decided or set | new — Card README's "waiting" edge applied to a card with a header and footer; no component draws an approval payload |
| `.gate` | The `accent-soft` note that says Loomwright's gate merges ("Approving does not merge", the down-scoped session tokens) | new — a Band without a state: it states a rule, not a condition, and carries the shield icon |
| `.nb`, `.nb.att` | A bordered note block: the dry run, "No dry run yet", branch protection missing, "GitHub can't enforce protection", the Jira stub note | new — Card's chrome over a short note; `.att` is the `attention` edge |
| `.pbt` column classes `.c2`–`.c5` | The Playbooks table's column widths | new — see the values table |
| `.thread`, `.turn`, `.who`, `.msg`, `.draftc`, `.ro`, `.composer` | Chat's trimmed thread, a turn, Wright's drafted-playbook card with a read-only mode row (`.ro`), and the message field | new — a trimmed copy of gui-v1's Chat, plus the draft card (a `hairline` card with a header, a definition list, a dry-run line and two actions) |
| `.rh`, `.rh tbody th` | A Table whose first cell is a row header: the permission table (now, after you accept) and the tool-grant table | new — Table README's chrome with `th scope="row"` so each row is named for assistive technology |
| `.pset`, `.opt`, `.opt .ol`, `.oh`, `.od`, `.nrow`, `.opt.on`, `.opt.off`, `.opt.on .cap`, `.opt .nr` | The merge-policy preset group: a fieldset of three radio options, each with its description and the provenance of its value; the selected one has an `accent` edge; one option can be off with its reason | new — no design-system component draws a radio group with per-value provenance. The native radio is 16px in `accent`, as the phase 6 sheet's checkbox. `.opt.on .cap` and `.opt .nr` keep caption text at `ink-secondary` on `accent-soft` and on a switched-off option (fixes a contrast defect found in this pass; see "Defects found and fixed") |
| `.box > li > .badge:last-child`, `.box.ch`, `.stk` | A list row with a trailing Badge; the "ways to go on" rows, which align to the top and may stack two links on the right | new — layout over the existing bordered list |
| `.pad > .band`, `.nb ul`, `.kv dd > .btn.ghost:first-child` | Small layout helpers: a Band inside a padded page, a bulleted list in a note, a ghost button that starts a definition's value aligned with the text | new — layout only |
| `.spin`, `.link`, `.out`, `.perm`, `.dlg .well`, `.dlg .icon`, `.dlg .errmsg`, `svg.mark` | The spinner, the link-out, the "what Studio can't remove" list, the permission list, the numbered well, the danger disc, the refusal text and the GitHub mark | copied unchanged from `integrations.html`; approved there |
| the shell, `.board`, `.bcol`, `.tcard`, `.fail`, `.empty`, `.skel`, `.sw`, `.chipb`, `.facts`, `.kv`, `.blk`, `.box`, `.evs`, `.evc`, `.log`, `.diff`, `.tbl`, `.field`, `.fe`, `.dlg.wide`, `.crumb`, `.dhead`, `.sech`, `.pad`, `.content`, `.inspector`, `.split`, `.pane`, `.list`, `.row` | The window, the Tasks board and card, route failure, empty and loading, the switch, the chip, the history rows, the session log, the diff, the Table, the form field, and the page layout | copied unchanged from `gui-v2.html`; approved there, and its evidence README lists each one |

## Checks

Run from the repo root. Results are from 2026-11-02.

```sh
grep -n "Claude C[o]de" docs/design/mockups/phase-8.html
grep -ni "claude.ai" docs/design/mockups/phase-8.html
grep -n "vendsy" docs/design/mockups/phase-8.html
grep -niE '<button[^>]*>[^<]*merge' docs/design/mockups/phase-8.html
perl -ne 'while(/<button\b[^>]*>(?:(?!<\/button>).)*merge(?:(?!<\/button>).)*<\/button>/gi){print "$.: $&\n"}' docs/design/mockups/phase-8.html
grep -n -i -E "sign in|sign-in|signin|type=\"password\"" docs/design/mockups/phase-8.html
grep -n '\$[0-9]' docs/design/mockups/phase-8.html
grep -n -i -E "#(24292f|2da44e|1f883d|238636|2ea043|0969da|f6f8fa|57606a|d0d7de|161b22|0d1117|8b949e|30363d|58a6ff|1a7f37|6e7781|eaeef2)\b" docs/design/mockups/phase-8.html
bash scripts/check-docs.sh
```

- **AC3 (invariants 6 and 7).** The first three print nothing: nothing says or looks like the Claude command-line tool (the `[o]` keeps the first line from matching its own pattern, so the same grep over this README is clean too), no control offers a claude.ai sign-in, and nothing names `vendsy`. The only attribution is "Wright, powered by Claude", in the palette footer. The only OAuth flows are the Jira and ClickUp vendor consents.
- **The sign-in grep prints two lines, 1233 and 1234,** both in the Connect sheet's copy for the vendor consent: "Studio opens <host>'s sign-in in your default browser. You sign in … and approve “Loomwright Studio”." and "Studio asks for no other sign-in". Both describe the vendor's own consent page (Atlassian's or ClickUp's); no control is a sign-in and there is no password field (invariant 6).
- **AC7 (invariant 4).** The single-line grep prints nothing, and so does the widened one (it also catches a button whose content has nested tags or template expressions). No button's text says merge. "Merge" (any case) appears on 35 lines of the file, and every occurrence is one of these, none a control: copy that says Loomwright's gate merges ("Loomwright's gate merges PR #21 when its own checks pass; Studio merged nothing", "Approving does not merge. Studio and the kernel never merge a PR", "Solo: … Loomwright's gate merges the PR. Studio and the kernel merge nothing", "Merges stay with Loomwright's gate", "Merging stays with Loomwright's gate", "A merge is asked every time, so there is no standing allowance for it", "A merge is always asked, and Loomwright's gate does the merging", "it heals and never merges"); the words "merge policy" (a repo's setting, "This repo has no merge policy, so its PRs park", the card's "Merge policy" row and the preset group's legend); a PR's recorded state or history ("merged", "closed without merging", "ready → merged", "awaiting_merge", "merge-item run" for a session Loomwright's gate drives, "merged by Loomwright's gate"); the view key `merge-card` with its anchor ids and the function name `mergeDetail`; and code comments. The merge card's primary action is Allow once, which records an approval, and Trust unprotected is an explicit click in a confirm that says it is recorded.
- **Dollars (D24).** The dollar grep prints nothing: there is no literal dollar figure, and no limit is in dollars (the mode editor's limit is in tokens).
- **Colours.** The Primer-colour grep prints nothing: no GitHub colour is used.
- **Contrast, both themes.** The token pairs the mockup uses were computed from the generator's values (WCAG 2.1 ratios, 2026-11-02). Light: `ink` 14.95–17.29, `ink-secondary` 5.39–6.43, `ink-tertiary` 4.68–5.59 (on `ground`, `surface`, `surface-sunken`, `accent-soft`), `accent` on `ground` 5.95 and on `accent-soft` 5.43, `on-accent` on `accent` 6.48, and each state colour on its `-soft` fill 4.63–5.09 (`ok` 4.63, `parked` 4.72, `attention` 5.04, `danger` 5.09). Dark: `ink` 14.08–16.00, `ink-secondary` 5.50–7.59, `ink-tertiary` 4.97–5.65 on `ground`, `surface` and `surface-sunken` but 4.09 on `accent-soft` (the defect below), `accent` on `accent-soft` 5.22, `on-accent` on `accent` 7.02, and each state colour on its `-soft` fill 5.84–7.11. Then a script read the computed colour and the opaque background behind every visible text node in all 65 views in both themes (130 renders; a dialog's own text is included, and the page behind its scrim is measured as if there were no scrim) and flagged anything under 4.5:1. After the fixes below the only hits are the label and description of a switched-off preset option (N GitHub reviews on a repo that cannot enforce reviews), which are text of an inactive control; the sentence that says why it is off was lifted to `ink-secondary` so it is readable.
- **Docs.** `bash scripts/check-docs.sh` prints `check-docs: OK`.

## Field map (AC6)

Every data field a view shows, and its source. A source is a kernel column at the base commit (`<migration file>: <table>.<column>`, migrations in `kernel/src/store/migrations/`), a route that exists at the base commit, or a shape a phase 8 requirement declares. The requirements are the files under `.supervisor/requirements/phase-8/` (gitignored, kept with the job), cited by item number and file name:

| Item | File |
|---|---|
| 01 | `2026-11-02-160001-phase-8-foundation-decisions-contract-seams-and-probes.md` (Scope 3 closed sets, Scope 5 migration 020: `repo_policies`, `pr_tracks`, `mcp_connections`; Scope 7 the app contract) |
| 03 | `2026-11-02-160003-github-app-every-permission-and-down-scoped-session-tokens.md` |
| 04 | `2026-11-02-160004-live-mode-and-github-write-in-sessions.md` |
| 06 | `2026-11-02-160006-mcp-connector-mechanism-with-oauth.md` |
| 07 | `2026-11-02-160007-jira-and-clickup-connectors-and-ticket-sources.md` |
| 08 | `2026-11-02-160008-repo-merge-policy-detect-and-propose.md` |
| 10 | `2026-11-02-160010-pr-tracker-and-owner-aware-comment-routing.md` |
| 11 | `2026-11-02-160011-tasks-card-ticket-pr-approvals-ci-and-triage.md` |
| 12 | `2026-11-02-160012-integrations-jira-clickup-connect-app-upgrade-and-repo-policy-card.md` |
| 13 | `2026-11-02-160013-playbook-live-mode-and-the-merge-approval-card.md` |

Words a view writes itself (empty-state copy, band copy, button labels) are copy, not fields, and are not listed. Item 01 declares the three tables' columns by name only in a list; the exact column names are item 01's, so a column named below (`pr_tracks` "head sha", "ticket ref") is cited as item 01's list entry, not as a settled identifier. A field with no declared source is marked **open point N** and is listed for the owner in `docs/DESIGN.md` §"Open points for the owner (phase 8)"; none is shown as if it existed.

Existing routes at the base commit used below: `GET /status`, `GET /agents`, `POST /agents/:id/set`, `GET /playbooks`, `GET /playbooks/:ref`, `GET /playbooks/:id/runs`, `POST /playbooks/:id/set`, `POST /playbooks/:id/off`, `GET /tasks`, `GET /tasks/:kind/:id`, `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/deny`, `GET /connectors`, `GET /connectors/github/repos`, `GET /threads/:agent`, `GET /sessions/:id/output`, `POST /ask`.

### Every view (the shell)

| Field | Source |
|---|---|
| Crew rows: name, avatar shape and hue | `014_agents.ts: agents.display_name, avatar_shape, avatar_hue` via existing `GET /agents`. Wright has no row: its look (the crowned whale in `accent`) is fixed in the app |
| Crew rows: last line | existing `GET /threads/:agent` (the newest item) |
| Approvals count in the sidebar | `011_phase_2_tables.ts: approvals.status = 'pending'` (existing `GET /approvals`) |
| Sidebar footer: idle / kernel unreachable; the `Kernel unreachable` band; "last known" | the app's connection state and cache (existing; `app/src/shell/KernelStates.tsx`), not a kernel field |

### Tasks

| Field | Source |
|---|---|
| Card kind: ticket → PR card, or plain task | `001_initial.ts: tasks.id, kind, links_json`. A task whose links name a PR is the ticket → PR card: item 10 Scope 1 (the tracker updates the matching `tasks` row's links) and Scope 6 (`GET /tasks` returns the links and PR fields); the shape is item 01 Scope 7 |
| Ticket source chip and id ("GitHub Issue #14", "ClickUp CU-8a41") | `pr_tracks` ticket ref (item 01 Scope 5; item 10 Scope 1). The ref shapes: `github.issues` (item 01 Scope 3), `jira:<site>/<key>` and `clickup:<task id>` (item 07 Scope 2). The icon and the word are the app's rendering of the ref's source. Precedent at base: `017_phase_6_foundation.ts: playbook_runs.item_ref` (`github:<owner>/<repo>#<n>`) |
| Title | `001_initial.ts: tasks.title` |
| Repo ("on ntfs-tool"; a card's repo) | `pr_tracks` repo (item 01 Scope 5) |
| PR number, PR state (open, draft, ready, parked, merged, closed), head SHA | `pr_tracks` number, state, head sha (item 01 Scope 5; the six states are item 10 Scope 1) |
| Approvals `n/N`, "Solo", "Approve in Studio", "No policy" | `pr_tracks` approvals and required (item 01 Scope 5; item 10 Scope 1: "approvals `n` and required `N` from item 08's policy (or `solo` / `studio_approval`)"). The policy word: `repo_policies` policy kind (item 01 Scope 5; item 08 Scope 3). "No policy" is no `repo_policies` row (item 08 Scope 4, `policyMet` answers `no_policy`) |
| CI chip, and "recorded 11:38" | `pr_tracks` CI state (item 01 Scope 5; "from check runs", item 10 Scope 1). The time is `001_initial.ts: events.at` of the `pr_state_changed` event that recorded it (item 10 Scope 1 appends one per change). Green only when recorded; pending is neutral |
| Comment tally "1 fix · 1 reply · 0 answer" | **open point 1**: no declared column or event holds a comment's classification |
| Who owns the PR (live `/automate` run, parked `/automate` item, you or the App, someone else) | `pr_tracks` owner kind (item 01 Scope 5; item 10 Scope 1 and Scope 3, whose four routes are these four) |
| Card meta ("since 14:08", "13:51 · by Loomwright's gate", "12:15 · closed without merging") | `001_initial.ts: tasks.created_at, updated_at`; `pr_tracks` updated and merged_by_gate (item 01 Scope 5; item 10 Scope 2). "Closed without merging" is state `closed` against `merged` |
| Assignee (avatar and name) | `001_initial.ts: tasks.assignee_agent`; name and look from `014_agents.ts: agents.*` |
| "Why" lines ("Loomwright says READY…", "This repo has no merge policy, so its PRs park.") | derived: `pr_tracks.state = parked` with Loomwright's reason (item 10 Scope 1) and the repo's policy; the sentence is copy |
| Column (Waiting on you, Working, Parked, Done today); counts; the waiting band | the screen's grouping of `001_initial.ts: tasks.state` (free text, phase 7 open point 1) and `pr_tracks.state`; counts are derived |
| "Waiting on you" footer and band ("Open approval #7") | `011_phase_2_tables.ts: approvals.id, status = 'pending'`, linked to the PR through the approval's payload (item 13 Scope 2) and the `awaiting_merge` park (item 11 Scope 1) |
| Plain task card: title, state, assignee, "since 14:10" | `001_initial.ts: tasks.title, state, assignee_agent, created_at`; facts add `kind`, `updated_at` and `owner_session_id` |
| "Last known · read 14:22" | the app's cache read time (item 11 Scope 3); no kernel field |
| History facts: Ticket, Pull request (link), State, Head commit, Approvals + where the policy came from, CI + when, Comments, Owner | the fields above; the link is `pr_tracks` repo and number rendered as a github.com URL; "repo policy · set by you" is `repo_policies.set_by` (item 01 Scope 5) and "No policy yet: PRs park" its absence |
| History rows: `task_created` | `001_initial.ts: events.kind = 'task_created'`, `at`, `actor`, `payload_json`, which the kernel writes today; the text names the ticket from the payload |
| History rows: `session` (the `/automate` run, the fix-now run, the merge-item run) | `001_initial.ts: sessions.id, agent, started_at, model`; `013_playbooks.ts: sessions.playbook` and `playbook_runs.kind, item_ref (017)`. The runs are item 09's runner and item 10's `kernel_pr_fix` (item 10 Scope 4); the label ("the fix-now run for PR #21") is derived copy. As in phase 7, a card labelled `session` comes from a `sessions` row, not an `events.kind` |
| History rows: `pr_state_changed` | a new event kind, one per change (item 10 Scope 1): `events.at, actor, payload_json` |
| History rows: `approval_requested` | `001_initial.ts: events.kind = 'approval_requested'`, which the kernel writes today (`kernel/src/playbooks/enable.ts` reads it), and `011_phase_2_tables.ts: approvals.id, requested_at` |
| History rows: `comment_routed` ("classified fix. Route: parked /automate item, fix-now") | **open point 1**: the route is item 10 Scope 3's answer for a PR, but no event or column records a comment's classification and route |
| Session log: lines, times, the live / kept Badge, "Session N" | existing `GET /sessions/:id/output` (`016_session_output.ts: session_output.seq, kind, payload_json, created_at`); the Badge from `sessions.status` |

### Approvals

| Field | Source |
|---|---|
| Row and header: "Allow PR #21 to go to Loomwright's gate" | the approval's `action` and payload (`011_phase_2_tables.ts: approvals.action, payload_json`; the merge approval's payload is item 13 Scope 2); the sentence is copy |
| "Requested by Ada · playbook … · live · 42 min ago" | `011_phase_2_tables.ts: approvals.requesting_agent, requested_at`; `013_playbooks.ts: approvals.playbook` (the playbook's `name`); the word `live` is `017_phase_6_foundation.ts: playbooks.mode` (live is accepted by item 04 Scope 1) |
| Repo, PR link, head commit (short), CI + when recorded, Loomwright READY time | the approval's payload: "repo, PR link, head SHA short form, CI state, Loomwright's READY time, the repo's policy" (item 13 Scope 2), stored in `011_phase_2_tables.ts: approvals.payload_json`, filled when the merge item parks a PR (items 09 and 10) |
| Repo policy ("Approve in Studio", "set by you") and "A playbook may only be stricter" | `repo_policies` kind and set_by (item 01 Scope 5; item 08 Scope 3); the stricter-only rule is item 08 Scope 4 (`playbook_looser_than_repo`) |
| Allow once, Deny; the decision line "Approval recorded 14:23" | existing `POST /approvals/:id/approve` and `/deny`; `011_phase_2_tables.ts: approvals.status, decision, decided_by, decided_at`. No "Always for this playbook": item 13 Scope 2 |
| Held enable (approval #8): "Change mode: draft → live", the dry run, "Live means" | the pending `kernel_playbook_enable` approval (existing: `kernel/src/playbooks/enable.ts`) naming the playbook; `017_phase_6_foundation.ts: playbooks.mode` (draft today; live is accepted by item 04 Scope 1); the dry run is `013_playbooks.ts: playbook_runs` with `kind = 'dry_run'`, `status`, `version`, `ended_at`, `result_json`. Who files it from the screen: **open point 6**. The card itself: **open point 12** |

### Playbooks and Chat

| Field | Source |
|---|---|
| Name, owner (avatar), version | `013_playbooks.ts: playbooks.name, owning_agent, version` |
| On / off switch | `013_playbooks.ts: playbooks.status`; off is existing `POST /playbooks/:id/off`; turning on is the held approval (phase 7 item 04's decision), not a switch |
| Trigger ("poll · every 5 min · GitHub Issues, ClickUp") | `011_phase_2_tables.ts: triggers.kind, spec_json` for `triggers.playbook`; the sources `github.issues` and `clickup.tasks` are item 01 Scope 3 and item 07 Scope 2 |
| Mode, "set by you" / "proposed by Wright" on mode | `017_phase_6_foundation.ts: playbooks.mode, mode_set_by` |
| Priority, model, token limit per day and who set each | `013_playbooks.ts: playbooks.priority, model, token_limit_per_day` and `priority_set_by, model_set_by, token_limit_set_by` |
| Dry run: "finished today 10:41 · v2", "would open 2 PRs, reply to 0 comments · 0 sent", "No dry run yet" | `013_playbooks.ts: playbook_runs.kind = 'dry_run', status, version, ended_at, result_json` (existing `GET /playbooks/:id/runs`); the count of what was recorded is `017_phase_6_foundation.ts: draft_outputs`; none is "no dry-run row" |
| Edit form: the draft of each field, the changes DiffView, Save as vN | the app's form state; the write is existing `POST /playbooks/:id/set` for the four policy fields; `live` goes through the held approval (**open point 6**) |
| "Live requested" state, the band and the inspector link | the pending enable approval above; the app's own state for what it just asked |
| Chat: the thread, "You · 14:18", Wright's reply | `012_brain_messages.ts: brain_messages` via existing `GET /threads/:agent` and `POST /ask` |
| Chat's draft card: name, trigger, action, dedupe key (`item.id`, proposed by Wright), priority, model, mode (read-only) | the playbook row Wright drafted (`013_playbooks.ts: playbooks.name, intent, dedupe_key_spec, priority, model` with their `*_set_by`); `item.id` is one of the closed `DEDUPE_KEY_FIELDS` (`kernel/src/playbooks/types.ts`); the preview line is a dry-run preview over `draft_outputs` |

### Integrations: GitHub App permission upgrade

| Field | Source |
|---|---|
| Status ("needs new permissions", "connected"), "read from GitHub 14:02", "checked by GitHub 14:24" | `needs_permissions` on the connector row is item 03 Scope 3; `017_phase_6_foundation.ts: connectors.status, verified_at`; `018_connector_permissions_source.ts: connectors.permissions_source` ("checked by GitHub") |
| Account, installation, App slug | `017_phase_6_foundation.ts: connectors.account_login`; `019_connector_app.ts: connectors.installation_id, app_slug`. The App's display name is not a column (phase 7 open point 12); the approved App views already show one |
| "Accept at" address | item 03 Scope 3: `GET /connectors/github/app/upgrade` answers the GitHub URL |
| Permission table, "Now": Metadata, Contents, Pull requests, Issues, Checks, every other | `017_phase_6_foundation.ts: connectors.permissions_json` (what GitHub reported) |
| Permission table, "After you accept": every repository permission at read and write | item 03 Scope 1: the manifest's frozen constant of every repository permission, at write; Metadata stays read-only (GitHub fixes it) |
| "Session tokens are down-scoped" to Pull requests, Contents, Issues, Checks, read and write | item 03 Scope 4: `SESSION_TOKEN_PERMISSIONS` (`pull_requests`, `contents`, `issues`, `checks` at write) |
| The waiting dialog: the three steps, the address | the app's own state while it waits; the address is item 03's route |

### Integrations: repo policy card

| Field | Source |
|---|---|
| Repos reached (the chips), repo name | `017_phase_6_foundation.ts: connectors.reachable_repos_json` (existing `GET /connectors/github/repos`); item 08 Scope 3: `GET /repos/policy` answers every reached repo |
| Branch protection, required reviews, required checks, who can push, "read today 14:20", `detected from GitHub` | `repo_policies.detected_json` and its time (item 01 Scope 5; item 08 Scope 1: protection on the default branch with its required review count and checks, `protection_unavailable`, `unprotected` and the collaborators who can push). The role word in "(admin)" and "(write)" and the public / private badge: **open point 4** |
| Re-detect | item 08 Scope 3: `POST /repos/policy/:owner/:repo/detect` |
| Wright's proposal and its kind (Solo, Approve in Studio, N GitHub reviews, N) | item 08 Scope 2: the pure function from the detection. The sentence that says why is copy. The "2" over GitHub's 1: **open point 7** |
| The presets and "proposed by Wright" / "set by you" | the kind: `repo_policies` policy kind and `set_by` (item 01 Scope 5); the number: `repo_policies` required reviews; item 08 Scope 3: `POST /repos/policy/:owner/:repo` takes `{kind: "solo" \| "studio_approval" \| "reviews", required?}`. "Proposed by Wright" is the app's label for a value taken straight from the proposal function; it is not stored |
| Policy set, "set today 09:15" | `repo_policies.set_at, set_by` (item 01 Scope 5) |
| Trust unprotected, "recorded today 14:23", `--trust-unprotected` | item 08 Scope 5: `trust_unprotected` "recorded with who set it and when", passed to Loomwright for that repo only; the route's `trust_unprotected` field (item 08 Scope 3) |
| Safe mode, "recorded today 14:23" | **open point 2**: no declared column or route |
| "No policy: PRs park" | no `repo_policies` row (item 08 Scope 4) |
| Make public / Upgrade links, "what to set" on an unprotected repo | links to github.com; no data |

### Integrations: Jira and ClickUp

| Field | Source |
|---|---|
| Status (connected, expired), the dot | `mcp_connections` status (item 01 Scope 5; item 06 Scope 2: marked `expired` when a refresh fails); listed by existing `GET /connectors` (item 06 Scope 2) |
| Site (Jira) / workspace (ClickUp) | item 07 Scope 1: "the row records the site" and "the workspace" |
| Server (`mcp.atlassian.com/v1/mcp`, `mcp.clickup.com/mcp`), "Atlassian's hosted MCP server" | `mcp_connections` server url (item 01 Scope 5; item 06 Scope 1) |
| Keychain item `loomwright-studio-mcp-<kind>` | item 06 Scope 2; the value is never shown |
| Account (`alex.rivera@example.com`), "verified today 14:02", "listed by Atlassian 14:02", "refused a refresh today 13:48" | **open point 3**: item 01's `mcp_connections` lists kind, server url, status, granted tools and token expiry only |
| Tools list: names | item 06 Scope 3: "the kernel lists the server's tools and stores their names on the `mcp_connections` row" |
| Tools: "Read" / "Changes things" | the tool's MCP `readOnlyHint` (item 06 Scope 5); whether the hint is stored: **open point 3** |
| Which crew member is granted which tool, "Set grants in Team" | item 06 Scope 4: `connectors: {jira: [tool names]}` on the agent, set only by the owner through `POST /agents/:id/set` (existing today as a list of kinds: `kernel/src/agents/charter-files.ts`). The crew from existing `GET /agents` |
| The consent wait: three steps, "closes … at 14:32", Cancel | the connect route's setup window (item 06 Scope 2: `POST /connectors/mcp/:kind/connect` and `…/connect/cancel`, "the same short-lived, one-at-a-time setup window D36 uses"); the steps are the app's state |
| Refused: `access_denied` | the OAuth error the consent returns, through the connect route's answer (item 06 Scope 2); not stored |
| Disconnect and "drops every crew grant" | `POST /connectors/mcp/:kind/disconnect` (item 06 Scope 2); the grant drop: **open point 5** |
| Park line ("1 playbook that reads ClickUp tickets is parked") | derived from the playbooks whose triggers poll `clickup.tasks` (item 01 Scope 3) and the connection's status |
| "Work account · stub only" | no data: the owner's decision (item 01, owner decisions); Jira is built and tested against a fake MCP server and never exercised live |
| "Personal" badge on ClickUp | no data: the owner's decision ("clickup is personal account") |

### Open points the field map raised

The numbers match `docs/DESIGN.md` §"Open points for the owner (phase 8)". Points 1–7 are fields with no declared source and are listed here; 8–13 are where the mockup differs from what an item's requirement describes (sample data with several policies on one repo, no Jira card, Chat as one view, no playbook detail page, the live-enable approval card, the four-row Integrations list), and are in DESIGN.md only.

1. **The triage tally and the `comment_routed` history rows have no stored source.** Item 10's tracker fills `pr_tracks` with state, approvals, CI, owner kind and run file, and appends `pr_state_changed`; nothing records how a comment was classified or where it was routed. Items 01 and 10 must add it, or the card and the history drop it.
2. **Safe mode as a per-repo choice has no declared storage.** Item 08's `POST /repos/policy/:owner/:repo` takes a kind and `trust_unprotected`; `repo_policies` has no safe-mode field.
3. **Four MCP fields have no declared column:** the account line, the "verified" and "listed" times, the time of a failed refresh, and each tool's read-only flag.
4. **The repo visibility badge and a collaborator's role word** are not in item 08's detection, which reads protection, required reviews and checks, and who can push.
5. **Whether Disconnect drops the crew's grants.** The mockup says it does for Jira and ClickUp; phase 6's GitHub Disconnect keeps them.
6. **Who files the held enable.** The mockup's Request live enable creates it; no requirement declares an owner route for that.
7. **The "2" for a team repo** is Wright's, over GitHub's own 1; item 08's proposal function reads N from GitHub.

## Defects found and fixed in the mockup

Subtask 3 changes no HTML except to fix a defect it finds. Three were found in this pass (token block untouched); the checks above were re-run after them:

1. **A caption under 4.5:1 in dark on the preset option.** The number-of-reviews hint ("GitHub reviews needed before the PR goes on") and the provenance line are `ink-tertiary`, and the selected option's fill is `accent-soft`: 4.09:1 in dark (`policy-proposed`, `policy-edited`). Fixed with one rule, `.opt.on .cap { color: var(--ink-secondary) }` (5.50:1 in dark, 5.39:1 in light). The two views affected, `policy-proposed` and `policy-edited`, were retaken in both themes.
2. **The reason a preset is off was in disabled colour.** On `policy-trusted`, "GitHub can't enforce reviews on this repo, so this one is off." sat inside the switched-off option's description at 2.34:1 (light) and 2.46:1 (dark). The sentence is now its own span (`.nr`) at `ink-secondary`. The option's own label and description stay in the disabled colour, as an inactive control's. `policy-trusted` was retaken.
3. **A dedupe key that is not one of the kernel's.** Chat's draft card showed `ticket.id`. The kernel's closed set of key fields is `playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at`, `date`, `item.id` and `item.revision` (`kernel/src/playbooks/types.ts: DEDUPE_KEY_FIELDS`), and `item.id` is the one that dedupes a ticket on its id. The card now shows `item.id`, still "proposed by Wright". `chat-draft` was retaken.

## Found, not changed

- **Tasks > Populated shows an empty Waiting on you column while the sidebar's Approvals badge reads 1,** because approval #7 is pending in every view. This is the phase 7 pattern: the populated view has no waiting card and `tasks-waiting` carries it. Item 11 builds the real screen from the data, where the two agree.
- **The window clips a long body at 760px** (see Screenshots). `policy-unenforceable` shows Make public and Trust unprotected but cuts Safe mode, `jira-connected` cuts the last two tools, and `tasks-populated` cuts the last card; the content is all there on scroll.
- **Rendering was spot-checked by eye on five screenshots** (`tasks-populated` dark, `merge-card` dark, `policy-unenforceable` light, `jira-unreachable` light, `playbook-mode-confirm` dark), not all 130. Contrast was measured in code for every view in both themes (Checks), not by eye, and the driven paths (What was driven by hand) check behaviour, not looks.
