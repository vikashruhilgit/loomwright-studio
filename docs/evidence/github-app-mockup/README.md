# GitHub App mockup: screenshot evidence (GitHub App backlog, wave 1, D36)

These are screenshots of the GitHub App views added to `docs/design/mockups/integrations.html`, in light and dark. The mockup is static: it runs no kernel and makes no GitHub call. Each view is forced by the URL hash (`#view=<view>&theme=<light|dark>`), so each screenshot comes from one headless-browser command. No script is committed. The owner approves the design by merging the PR that adds it (D9). The decision is D36 in `docs/DECISIONS.md`, the contract is in [integrations](../../architecture/integrations.md#github-app-connect), and what the views commit wave 2's Connect sheet to is in `docs/DESIGN.md` §"GitHub App connect". The phase 6 views and their audit are in [the phase 6 evidence](../phase-6-integrations-mockup/README.md).

## Screenshots

Each image is the full page: the intro line, the 1180×760 window, and the review strip under it with the forced view highlighted in its "GitHub App view" group. The viewport is 1280×1000 CSS px.

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `app-choice` | The Connect sheet's choice: "Install GitHub App" (suggested, with an `accent` edge; "permissions are checked by GitHub") and "Paste a token" ("permissions are declared by you"), the line that Studio keeps one GitHub connection at a time, and Cancel | [integrations-app-choice-light.png](integrations-app-choice-light.png) | [integrations-app-choice-dark.png](integrations-app-choice-dark.png) |
| `app-setup-create` | Setup in progress, step 1 of 2: step 1 (Create) `working` with "waiting for you", step 2 `idle` with "next", what the App asks for, when the window closes, Cancel and "Open GitHub again" (focused). The list row reads "setting up the GitHub App · waiting for you on GitHub" | [integrations-app-setup-create-light.png](integrations-app-setup-create-light.png) | [integrations-app-setup-create-dark.png](integrations-app-setup-create-dark.png) |
| `app-setup-install` | Step 2 of 2: step 1 `ok` with a "done" Badge, step 2 `working` with "waiting for you" | [integrations-app-setup-install-light.png](integrations-app-setup-install-light.png) | [integrations-app-setup-install-dark.png](integrations-app-setup-install-dark.png) |
| `app-connected` | Connected through the App: status `ok` with its verification time, the account, the App's name and slug, the installation, the key (kept in the Keychain, never shown), the access token's expiry with a "renews automatically" Badge, "Read-only, checked by GitHub" with the three permissions GitHub reported, "Repos chosen at install" (two), Mason's card under the grant, and Disconnect. No Replace token | [integrations-app-connected-light.png](integrations-app-connected-light.png) | [integrations-app-connected-dark.png](integrations-app-connected-dark.png) |
| `app-expired` | Setup timed out (`setup_expired`): the setup window closed at 14:12 before GitHub came back; nothing was connected; a link to the owner's GitHub Apps; Close, "Paste a token instead" and "Set up again" | [integrations-app-expired-light.png](integrations-app-expired-light.png) | [integrations-app-expired-dark.png](integrations-app-expired-dark.png) |
| `app-cancelled` | Setup cancelled: nothing was connected and the window is closed; an App already created on GitHub stays until the owner deletes it; the same three actions | [integrations-app-cancelled-light.png](integrations-app-cancelled-light.png) | [integrations-app-cancelled-dark.png](integrations-app-cancelled-dark.png) |
| `app-write-scoped` | The App reports a write permission (`token_write_scoped`): the refusal names it, "Contents: Read and write → set to Read-only", then Close and "Set up again" | [integrations-app-write-scoped-light.png](integrations-app-write-scoped-light.png) | [integrations-app-write-scoped-dark.png](integrations-app-write-scoped-dark.png) |
| `app-revoked` | Status `rejected` with a `danger` dot: a band says GitHub no longer accepts the App (uninstalled, key revoked or App deleted) and names the parked playbook; the last-read permissions and repos keep their time; "Set up again" is the primary, with Disconnect | [integrations-app-revoked-light.png](integrations-app-revoked-light.png) | [integrations-app-revoked-dark.png](integrations-app-revoked-dark.png) |
| `app-failed` | Setup didn't finish (`conversion_failed` or `install_failed`): GitHub did not hand the key over, or the install did not complete or could not be checked; nothing was connected; the same three actions | [integrations-app-failed-light.png](integrations-app-failed-light.png) | [integrations-app-failed-dark.png](integrations-app-failed-dark.png) |
| `app-unreachable` | The shared `Kernel unreachable` band, the status as "unknown" with no dot, the last-read data with its time, the access token's last known expiry, and Disconnect and Refresh disabled | [integrations-app-unreachable-light.png](integrations-app-unreachable-light.png) | [integrations-app-unreachable-dark.png](integrations-app-unreachable-dark.png) |
| `app-disconnect` | The Disconnect confirm for an App: what Studio removes (the App's key, from the Keychain; the playbook parks) and what only the owner can remove on GitHub (uninstall the App, delete the App), with a link to Installed GitHub Apps and one to the owner's GitHub Apps | [integrations-app-disconnect-light.png](integrations-app-disconnect-light.png) | [integrations-app-disconnect-dark.png](integrations-app-disconnect-dark.png) |

Every view is also reachable from the review strip's "GitHub App view" group. A refusal that has a kernel code names it above. Two setup refusals have no view: `setup_not_open` and `state_mismatch` are answered to the browser tab, not shown in the app (`docs/DESIGN.md` lists this as an open point).

## What was driven by hand

The views above are static. The paths between them were driven once in headless Chromium with a scratch script outside the repo (2026-10-30):

- Connect GitHub from the empty state opens `app-choice` with "Install GitHub App" focused; `Esc` closes it and focus returns to Connect GitHub;
- "Paste a token" opens the token sheet with the token field focused, as before; Replace token on a token connection still opens the token sheet directly, and `⌃K` → Connect GitHub on a token connection does the same;
- "Install GitHub App" opens `app-setup-create` with "Open GitHub again" focused, moves to `app-setup-install` after 2.5 s and to `app-connected` after another 2.5 s, and focus lands on the GitHub row;
- Cancel, `Esc` and the backdrop on the setup dialog all land on `app-cancelled`, and the pending steps never fire after a cancel (checked 5.5 s later); `Esc` on the cancelled view closes it; "Set up again" restarts the setup and "Paste a token instead" opens the token sheet;
- from `app-revoked`, Set up again opens the setup dialog and ends on `app-connected`;
- `⌃K` on an App connection lists Connect GitHub disabled ("disconnect first") and "Show reachable repos" with 2; Disconnect opens `app-disconnect` with its two links, `Esc` returns to `app-connected`, and Disconnect in the confirm returns to `not-connected`;
- in `app-unreachable`, Disconnect and Refresh are disabled;
- the review strip's App buttons force each view, and the URL hash follows.
- an odd hash falls back to `not-connected`: empty, `#`, `#view=bogus`, a bad `theme`, a repeated `view`, and `#view=__proto__` or `#view=constructor`. The last two crashed the render in the base file (the view lookup read `Object.prototype`), so `setView` now looks up only the table's own keys; a double-click on Install does not start two setups, and a hash change mid-setup drops the pending steps.

The run reported no console errors.

## How to regenerate

Setup, once: the Playwright CLI at the version `app/package-lock.json` pins (1.64.1), with its Chromium. These shots were taken with the same CLI version installed outside the repo, so `app/` was untouched: `npm i @playwright/test@1.64.1 && npx playwright install chromium` in an empty directory. Or, from the repo: `cd app && npm ci && npx playwright install chromium`.

Then run each command from the directory where Playwright is installed. `<repo>` is the absolute path of your checkout.

```sh
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-choice&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-choice-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-choice&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-choice-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-setup-create&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-setup-create-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-setup-create&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-setup-create-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-setup-install&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-setup-install-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-setup-install&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-setup-install-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-connected&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-connected-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-connected&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-connected-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-expired&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-expired-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-expired&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-expired-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-cancelled&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-cancelled-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-cancelled&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-cancelled-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-write-scoped&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-write-scoped-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-write-scoped&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-write-scoped-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-revoked&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-revoked-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-revoked&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-revoked-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-failed&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-failed-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-failed&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-failed-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-unreachable&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-unreachable-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-unreachable&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-unreachable-dark.png
npx playwright screenshot --color-scheme=light --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-disconnect&theme=light' <repo>/docs/evidence/github-app-mockup/integrations-app-disconnect-light.png
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/integrations.html#view=app-disconnect&theme=dark' <repo>/docs/evidence/github-app-mockup/integrations-app-disconnect-dark.png
```

The hash's `theme` sets `data-theme` on the page, and `--color-scheme` matches it, so a shot never depends on the host's appearance setting. `--wait-for-timeout=600` lets the dialog's open animation (`duration-slow`, 240ms) finish. The `working` dots animate, so their frame in a regenerated `app-setup-create` or `app-setup-install` shot can differ by a few pixels.

## Checks

Run from the repo root (bash, for the process substitution). Results are from 2026-10-30.

```sh
diff <(node app/scripts/tokens.mjs) <(awk '/\/\* tokens:end \*\//{f=0} f; /\/\* tokens:begin \*\//{f=1}' docs/design/mockups/integrations.html); echo "exit $?"
grep -c "Claude Code" docs/design/mockups/integrations.html
grep -n -i -E "#(24292f|2da44e|1f883d|238636|2ea043|0969da|f6f8fa|57606a|d0d7de|161b22|0d1117|8b949e|30363d|58a6ff|1a7f37|6e7781|eaeef2)\b" docs/design/mockups/integrations.html
git diff -U0 f1646ae -- docs/design/mockups/integrations.html | grep '^+' | grep -n -E "#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\("
```

- The token block is still the generator's output, verbatim: no diff output, then `exit 0`.
- The "Claude Code" count is `0`.
- The Primer colour search prints nothing and exits 1.
- The last command, over every line this item added to the mockup since the base commit `f1646ae`, finds no hex, `rgb()` or `hsl()` value: it prints nothing and exits 1. The GitHub App views add no raw colour value.
- The values outside the token block that this item adds are two: the setup's `2500` ms step timers (mock behaviour only, not a design duration) and the Card's `accent` edge on the suggested option, which is a token. Every other style is an existing class. The two icons (a Lucide shield-check and key) are SVG geometry, which the phase 6 audit does not list.
- The ten phase 6 views render as before. Each was compared with the same view of the file at the base commit by hashing a screenshot of the window (`#win`, animations frozen, caret hidden), light and dark: all identical. What changed outside the window is harness chrome, so the phase 6 screenshots in `../phase-6-integrations-mockup/` are stale in two places and were not regenerated (they are outside this item's lanes): the intro line now says "only the links to GitHub leave the page", and the review strip has a second group.

GitHub's name and mark appear only as the connector's label, in `ink`, as before. The new text mentions "GitHub" and "GitHub App" in plain copy, which tells the owner what to do on GitHub. The App choice uses a shield icon and the token a key, in `ink`. Nothing is styled as GitHub.

## Found, not changed

`.btn.sec` in the mockup's CSS also matches the `.sec` section rule (`display:flex; flex-direction:column`), so a secondary Button that holds a label and a key chip stacks the chip under the label. The phase 6 Disconnect confirm shows it ("Cancel", then "Esc" below it). The App's Disconnect confirm leaves the chip out to avoid it. Fixing it would change an approved phase 6 view, so it is left for the owner to decide.
