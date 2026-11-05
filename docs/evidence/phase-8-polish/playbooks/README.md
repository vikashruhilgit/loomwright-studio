# Playbooks screen: mode editor and live confirm (phase 8 item 13)

Screenshots of the Playbooks screen's Edit fields view in light and dark, taken from the built app (`app/dist`, `app/dist-electron`) running against the fixture kernel (`app/e2e/fixture-kernel.ts` with the canned playbooks in `app/e2e/fixtures/playbooks.ts`). They are captured by `app/e2e/playbooks.spec.ts` (the test "the phase 8 mode states are screenshot in light and dark"), launched only through `app/e2e/electron-harness.ts`. Each window is resized to 1180×940 CSS px. The shots are taken with reduced motion.

The approved design is `docs/design/mockups/phase-8.html` (views `playbook-mode` and `playbook-mode-confirm`).

## Screenshots

| State | Light | Dark | What it shows |
|---|---|---|---|
| `playbooks-mode-editor` | `playbooks-mode-editor-light.png` | `playbooks-mode-editor-dark.png` | Edit fields on an enabled playbook with the Mode editor open and `live` picked: both `draft` and `live` are selectable, with the line "draft records outward calls and sends none; live acts on GitHub through the approval gate" under the controls |
| `playbooks-mode-confirm` | `playbooks-mode-confirm-light.png` | `playbooks-mode-confirm-dark.png` | Set pressed on `live`: the shared Dialog "Turn on live mode for “Review PRs on studio-sandbox”?" says live acts on GitHub through the approval gate. Nothing has been sent; its primary action ("Set live") sends one `POST /playbooks/:id/set` with `{field: "mode", value: "live"}`, and Cancel (or Escape) sends nothing |
| `playbooks-mode-refused` | `playbooks-mode-refused-light.png` | `playbooks-mode-refused-dark.png` | The same confirm on a draft playbook: the kernel refuses with `live_needs_enable`, and its words and code sit under the Mode field, the editor still open on the owner's pick |

## Deviations from the mockup

1. **The confirm sends the write; it does not file a held enable.** The mockup's dialog reads "Request live enable" and says nothing switches on until the enable is allowed in Approvals. The kernel as built (item 04) takes the owner's `live` on an already enabled playbook and stores it as the next version, a draft again, or refuses it `live_needs_enable`; the enable approval comes earlier. The dialog says what the Set does (a new version, a draft again until the playbook is turned on) and its button is "Set live", so the words match the one request it sends.
2. **Chat keeps Mode read-only.** The draft card in Chat shows the row without an Edit button; this folder covers the Playbooks screen only.
3. **`merge_requirement` stays read-only** in the editor; its editor is a later item.

## How to regenerate

```sh
cd app
npm ci
node node_modules/electron/install.js   # once, if the Electron binary is missing
npm run build
PHASE8_POLISH_EVIDENCE=1 npx playwright test e2e/playbooks.spec.ts --workers=1 -g "phase 8 mode states"
```

With `PHASE8_POLISH_EVIDENCE=1` the test deletes every PNG in this folder, then writes the six above; without it the shots go to Playwright's per-test output dir, so a plain run never dirties these files. The test "the phase 8 evidence README lists every mode screenshot" fails if this table, the spec's states and the files in this folder drift apart.
