# Playbooks screen: polish-gate evidence (phase 7, item 04)

Screenshots of the Playbooks screen in light and dark, taken from the built app (`app/dist`, `app/dist-electron`) running against the fixture kernel (`app/e2e/fixture-kernel.ts` with the canned playbooks, runs, versions and approvals in `app/e2e/fixtures/playbooks.ts`). The PNGs are captured by `app/e2e/playbooks.spec.ts` (the test "every designed state is screenshot in light and dark"), launched only through `app/e2e/electron-harness.ts`. Each window is resized to 1180×940 CSS px so the edit view's eight fields, with one editor open, are in one image.

Each row below is one state of the approved mockup (`docs/design/mockups/gui-v2.html`; its own screenshots are `docs/evidence/gui-v2-mockup/gui-v2-playbooks-<state>-<theme>.png`). The state name is the mockup's view name.

## Screenshots

| Mockup state | Light | Dark | What it shows |
|---|---|---|---|
| `playbooks-empty` | `playbooks-empty-light.png` | `playbooks-empty-dark.png` | "No playbooks yet." and one action, Ask Wright for the first one |
| `playbooks-loading` | `playbooks-loading-light.png` | `playbooks-loading-dark.png` | Skeleton rows while the first read is held |
| `playbooks-populated` | `playbooks-populated-light.png` | `playbooks-populated-dark.png` | The table for three playbooks: intent, trigger (poll spec in full), dedupe key, priority, model, mode, last run, tokens, who set each value, and the On switch |
| `playbooks-waiting` | `playbooks-waiting-light.png` | `playbooks-waiting-dark.png` | A draft playbook marked "draft · waiting on you", the band that links to it, and its switch revealing the held `kernel_playbook_enable` approval |
| `playbooks-error` | `playbooks-error-light.png` | `playbooks-error-dark.png` | The list route answering 500: a "Couldn't load playbooks" failure card with Try again |
| `playbooks-unreachable` | `playbooks-unreachable-light.png` | `playbooks-unreachable-dark.png` | The shared band over the last-known table ("last known"); every write and the Ask Wright button disabled |
| `playbooks-detail` | `playbooks-detail-light.png` | `playbooks-detail-dark.png` | One playbook: intent, policy fields with who set each, the trigger with next fire and last result, the switch, counted tokens, three runs with their status in words, Edit in English, Edit fields and Version history |
| `playbooks-edit` | `playbooks-edit-light.png` | `playbooks-edit-dark.png` | Field-level edit: eight fields, each with who set it; the priority editor open with its own Set |
| `playbooks-edit-refused` | `playbooks-edit-refused-light.png` | `playbooks-edit-refused-dark.png` | The kernel's refusal of a dedupe key `{repo}#{pr}` shown under that field in the kernel's own words and code (`invalid_input`) |
| `playbooks-history` | `playbooks-history-light.png` | `playbooks-history-dark.png` | The versions list (newest first) and what the picked version changed, read-only |

## Deviations from the mockup

Each is deliberate, and each is recorded in `docs/DESIGN.md` (open points 6 and 8) except where noted.

1. **Per-field Set, not one batched "Save as vN+1"** (`playbooks-edit`, `playbooks-edit-refused`). The owner's only write, `POST /playbooks/:id/set`, takes one `{field, value}` per call and writes one version per call, so each of the five editable fields has its own Set. A Set that changes nothing writes no version (the kernel answers `changed: false`). The view names the version the kernel answered with and never predicts "v4". The mockup's two-fields-changed DiffView and its "enabled playbook becomes a draft again" note are not shown before a save for the same reason: nothing is staged.
2. **Name, intent and effort are read-only** (`playbooks-edit`, `playbooks-edit-refused`). No owner write route exists for them and this item adds no kernel behaviour, so they carry "Change this with Edit in English" instead of an editor. The mockup's refused-state examples for an empty name and an empty intent therefore cannot occur; the refusal shown is the dedupe key the kernel's closed set rejects, in the kernel's words rather than the mockup's local validation text.
3. **The off-state switch shows the held approval** (`playbooks-waiting`, `playbooks-detail`). On to off sends `POST /playbooks/:id/off`. Off to on sends nothing: no owner route turns a playbook on, so the switch reveals the pending `kernel_playbook_enable` approval and links to Approvals, or says the playbook turns on when Wright asks and the owner approves. The approval stays the only way a playbook turns on.
4. **`mode: live` is disabled** ("not available yet"), as the mockup shows; `draft` is the only offer (phase 6 refuses live).
5. **Tokens are counted, not "today against the limit with ≈ at API rates"** (`playbooks-populated`, `playbooks-detail`). The kernel has no per-playbook "tokens today" figure, so the list shows the last run's counted tokens and the detail sums the counted tokens of the runs it lists ("N tokens counted in the last 3 runs"), beside the limit per day. A run still running reads "not counted yet", never a guess. No dollar figure appears anywhere, so there is no estimate to caption.
6. **Last run is read per playbook** (`playbooks-populated`). It comes from each playbook's runs; while that read is in flight a cell says "reading…", and a failed read says "unknown", never a default. A value nobody set reads "not set".
7. **The intent keeps the mockup's two-line clamp in the list** (the whole intent is in the detail); no other cell is truncated, and the poll spec and dedupe key are shown in full.

## How to regenerate

```sh
cd app
npm ci
node node_modules/electron/install.js   # once, if the Electron binary is missing
npm run build
PLAYBOOKS_EVIDENCE=1 npx playwright test e2e/playbooks.spec.ts --workers=1
```

With `PLAYBOOKS_EVIDENCE=1` the test deletes every PNG in this folder, then writes the 20 above; without it the shots go to Playwright's per-test output dir, so a plain run never dirties these files. The test "the evidence README lists every screenshot, and nothing else" fails if this table, the spec's states and the files in this folder drift apart. The other tests in the spec press real keys and clicks and check what the kernel is sent (one `/set` per Set with no optimistic update, the kernel's refusal under its field, the On switch never turning a playbook on, Run now, Edit in English, the kernel going away, the live feed updating rows in place) and WCAG AA contrast in both themes.

## Owner findings

None yet. Record here anything the gate review finds, with the screenshot it is in.
