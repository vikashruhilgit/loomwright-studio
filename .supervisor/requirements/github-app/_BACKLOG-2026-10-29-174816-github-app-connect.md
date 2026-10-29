# GitHub App connect — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
Phase 6 closed on 2026-10-29 with one connect path: a fine-grained token whose read-only permissions the owner declares, because GitHub reports none (probe p12). The owner chose to add a GitHub App connect beside it, for three reasons:
- GitHub reports an installation token's permissions and repos, so read-only is proven.
- The token dies within the hour.
- A later posting phase gets a `<app>[bot]` identity. The owner wants reviews posted to PRs eventually, but that's out of scope here.

Probe p13, run by the owner on 2026-10-29, proved the Manifest flow works against Studio's loopback API (`docs/OPEN_QUESTIONS.md`, "GitHub App connect"). This set replaces the five items written on 2026-10-29 without `/product-owner`, which are in `superseded/`. It's reshaped so wave 2 runs three items in parallel.

## Owner decisions
none recorded

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 1 | D36, the shared contract (types, owner-route stubs, port stub, app contract) and the approved mockup | none | — |
| 2 | Kernel: App credentials, installation tokens, verified permissions, the real port | 1 | 3, 4 |
| 3 | Kernel: the manifest setup flow and its three bounded browser routes | 1 | 2, 4 |
| 4 | App: the Connect sheet's App path and a narrow open-external channel | 1 | 2, 3 |

## Run
/automate --backlog .supervisor/requirements/github-app/_BACKLOG-2026-10-29-174816-github-app-connect.md --parallel 3 --cheap

Safe mode, never `--auto-merge`; `--parallel` refuses it anyway. Branch mode is on (`loomwright-meta`), which lanes need. Item 1's PR carries the mockup, and the owner approves it there (D9) before wave 2 starts.

Why N = 3: wave 2 is three items with disjoint Touches, all building against item 1's contract. A wider N gains nothing, and a narrower one serialises work that doesn't collide.

```
wave 1: .supervisor/requirements/github-app/2026-10-29-174812-github-app-contract-decision-and-mockup.md
wave 2: .supervisor/requirements/github-app/2026-10-29-174813-kernel-github-app-installation-tokens.md .supervisor/requirements/github-app/2026-10-29-174814-kernel-github-app-manifest-setup-flow.md .supervisor/requirements/github-app/2026-10-29-174815-app-github-app-connect-sheet.md
```

Serialisations: 2, 3 and 4 each wait on 1, because they build against its contract. That's a real dependency, not a shared file.

Hotspots, with one owner per wave:
- `kernel/src/integrations/types.ts`, `kernel/src/integrations/index.ts`, `app/src/api/contract.ts` and `kernel/test/console-contract.test.ts`: item 1 only. Wave 2 items read them and never edit them.
- `kernel/src/integrations/github/app-port.ts`: item 1 creates the stub, and item 2 fills it.
- `kernel/src/integrations/github/app-routes.ts`: item 1 creates the stub, and item 3 fills it.
- `docs/architecture/integrations.md`: item 1 in wave 1 and item 2 in wave 2. Item 3 writes its own `docs/architecture/github-app-setup.md`, and item 4 writes `docs/architecture/app.md`.

Companions rule: none proposed.

## Considered and not queued
- **A CLI setup verb** (`studio connectors github app setup`). The owner chose app-only setup on 2026-10-29. `status` still shows the method.
- **The probe as backlog item 01.** It was run first instead (p13, PR vikashruhilgit/loomwright-studio#168), so the stories rest on GitHub's real behaviour.
- **Splitting item 1** into a contract item and a mockup item run in parallel. The owner chose one item: two smaller PRs aren't worth a second run's fixed cost.
- **A webhook.** GitHub refuses a loopback hook URL, and Studio polls.
- **A live end-to-end connect check as an item.** After wave 2 merges, the owner connects once through the App on the sandbox, like p13. Queue it as an item only if evidence in a file is wanted.

## Revisit when
- GitHub changes the Manifest flow's rules for return addresses, or the conversion's fields. Re-run `probes/p13-github-app-manifest.mjs`.
- The posting phase is planned: raising the App's permissions above read is that phase's decision.

## Checklist
- [ ] .supervisor/requirements/github-app/2026-10-29-174812-github-app-contract-decision-and-mockup.md
- [ ] .supervisor/requirements/github-app/2026-10-29-174813-kernel-github-app-installation-tokens.md
- [ ] .supervisor/requirements/github-app/2026-10-29-174814-kernel-github-app-manifest-setup-flow.md
- [ ] .supervisor/requirements/github-app/2026-10-29-174815-app-github-app-connect-sheet.md
