# GitHub App connect, set up through the manifest flow. Plan doc (an index, not an implementable item)

## Status: ready (index document — nothing to implement)

## Why
Probe p12 (2026-10-29) showed GitHub reports no permissions for a fine-grained token, so the token path can only rest on the owner's declaration (phase 6 item 14). A GitHub App's installation tokens report their permissions and repos, expire within the hour, and give a later posting phase a bot identity. The owner chose to add it beside the token path, set up by the manifest flow, after phase 6 closes.

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 01 | Probe p13 (owner-run) + the D-entry | phase 6 item 14 | — |
| 02 | Mockup of the App path (owner approves, D9) | 01 | 03 |
| 03 | Kernel: App credentials, installation tokens, verified permissions | 01 | 02 |
| 04 | Kernel: the manifest setup flow and its loopback return routes | 03 | 02 |
| 05 | App: the Connect sheet's App path | 02, 04 | — |

Run only after phase 6's live exit passes. Item 01 stops the backlog if GitHub refuses a loopback return address; the owner then decides (a hosted relay, or manual setup).

## Checklist
- [ ] .supervisor/requirements/github-app/2026-10-29-102710-github-app-probe-and-decision.md
- [ ] .supervisor/requirements/github-app/2026-10-29-102711-github-app-connect-mockup.md
- [ ] .supervisor/requirements/github-app/2026-10-29-102712-github-app-installation-tokens.md
- [ ] .supervisor/requirements/github-app/2026-10-29-102713-github-app-manifest-setup-flow.md
- [ ] .supervisor/requirements/github-app/2026-10-29-102714-github-app-connect-screen.md
