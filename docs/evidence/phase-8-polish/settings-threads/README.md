# Evidence: Settings → Threads, the size hint (phase 8, item 17c)

This is the polish-gate evidence for the Threads section of Settings: each agent's size hint (`thread_summarize_hint_tokens`, the thread size in tokens past which Chat highlights Summarize & start fresh on that thread), read-only. Every screenshot comes from the built app running against the fixture kernel, in light and dark mode. They are evidence for the owner's review, not visual-regression baselines: the spec never compares pixels.

- Section: [`ThreadsSection.tsx`](../../../../app/src/screens/settings/ThreadsSection.tsx), mounted last by [`SettingsScreen.tsx`](../../../../app/src/screens/settings/SettingsScreen.tsx); the reader `hintOf` and the row's words `hintWords` in [`model.ts`](../../../../app/src/screens/settings/model.ts)
- Unit tests: [`ThreadsSection.test.tsx`](../../../../app/src/screens/settings/ThreadsSection.test.tsx)
- e2e: [`settings-threads.spec.ts`](../../../../app/e2e/settings-threads.spec.ts) over the fixture [`fixtures/settings.ts`](../../../../app/e2e/fixtures/settings.ts) (its `agents` option)
- Mockup: [`docs/design/mockups/chat-threads.html`](../../../design/mockups/chat-threads.html), the Settings views `settings-threads` and `settings-threads-set`

## How they were produced

```sh
cd app
npm ci
node node_modules/electron/install.js   # once, if the Electron binary is missing
npm run build
PHASE8_POLISH_EVIDENCE=1 npx playwright test e2e/settings-threads.spec.ts --workers=1
```

The spec writes screenshots here only when **`PHASE8_POLISH_EVIDENCE=1`** is set (the switch shared with the other phase 8 polish folders). Before writing, it deletes every `*.png` in this folder it no longer names. Without the switch, the screenshots go to Playwright's per-test output directory, and a test asserts that no file in this folder changed during the run. Each shot is a full-window screenshot (1180 × 900 px window, 2x, macOS, Electron) with the Threads section scrolled into view, taken with `data-theme="light"` and then `data-theme="dark"` set on `<html>`, after checking that the ground colour differs between the two. The last test checks that this README and the folder list exactly the four files below.

## Screenshots

| Light | Dark | State | Compared with in chat-threads.html |
|---|---|---|---|
| [settings-threads-not-set-light.png](settings-threads-not-set-light.png) | [settings-threads-not-set-dark.png](settings-threads-not-set-dark.png) | **Not set.** Wright (the thread route answers `null`), Mason (no key in its file) and Ada (`"40k"`, a value the kernel's schema refuses, which reads the same) each read "Not set: Summarize is never highlighted." with "Set one in `config/agents/<id>.json`". Below them, "On a thread past it" shows what a highlighted Summarize & start fresh looks like and the "past your size hint" mark. | `settings-threads` (without Wright's proposal and the reference limit) |
| [settings-threads-set-light.png](settings-threads-set-light.png) | [settings-threads-set-dark.png](settings-threads-set-dark.png) | **Set by you.** Wright `40,000 tokens`, Mason `120,000 tokens`, each with the neutral "set by you" badge and "in `config/agents/<id>.json`"; Ada not set; Pim `30,000 tokens` in a file the kernel refuses, with the attention note "Not applied: the kernel refuses this file (…), so Summarize is never highlighted." | `settings-threads-set` (without Save, Discard and the reference limit) |

## Deviations from the mockup

1. **No field, Save, Discard or Wright's proposal.** The mockup draws the size hint as an owner setting with an input, "proposed by Wright · 40,000 tokens", "Use Wright's proposal" and Save. The kernel has no route that writes `thread_summarize_hint_tokens`: only the owner's edit of `config/agents/<id>.json` sets it (D34, `kernel/src/agents/settings.ts`: "no route, verb or tool writes it"), and nothing stores Wright's proposal (DESIGN.md §"Thread continuity", open point 2). So the section is read-only and says which file to edit. The views `settings-threads-edit`, `settings-threads-invalid` (typing and Save) have no counterpart.
2. **No reference limit.** The mockup's second setting is drawn as an owner setting, but the bound on a thread reference is the kernel's own (DESIGN.md open point 1), refused at send time as `409 history_too_large`. The views `settings-threads-ref-edit`, `settings-threads-ref-invalid`, `settings-threads-ref-set` and `settings-threads-both-set` have no counterpart.
3. **One row per agent, not one value.** The mockup has one size hint. The kernel keeps one per agent (each agent's own settings file), so the section lists Wright first and then each crew member in the kernel's roster order, each with its value and file.
4. **Wright's value comes from its thread route.** A crew member's hint is read from `GET /agents/:id`'s `settings.content` with `hintOf`. That route answers `409 reserved` for Wright, so Wright's is read from `GET /threads/wright?limit=1`, whose body carries the kernel's own reading under the same name (`null` when unset or when the file is refused).
5. **A refused file says its hint does not apply.** Not in the mockup: when the kernel refuses an agent's file (any `settings.error` but `model_unset`), it applies nothing in it, so a hint written there would never highlight Summarize. The row keeps the owner's value and adds an attention note saying so, with the kernel's message.
6. **No "read-only" badge and placement last.** The mockup's Threads heading has no badge (its caption "Kept with your other settings in the kernel" becomes "Kept in each agent's settings file in the kernel"). The section sits after "This app", so its rows, which land after the other reads, move nothing already shown.
7. **The sample is always the highlighted one.** The mockup's "On a thread past it" sample changes with the single saved value. With a value per agent, the section always shows the highlighted button and the "past your size hint" mark. The button in the sample is drawn, not a control: it is hidden from assistive tech, and a visually hidden sentence says what it shows.

## What the specs check besides the screenshots

| Where | What it asserts |
|---|---|
| unit, `ThreadsSection.test.tsx` | `hintOf` accepts only a positive safe integer and never throws (absent, null, 0, negative, fractional, a string, NaN, Infinity, past the safe integers, a non-record content); `hintWords` says "N tokens · set by you" or "Not set: Summarize is never highlighted.", and the "Not applied" note for a refused file but not for `model_unset`. The rows: Wright first; Wright read from `GET /threads/wright?limit=1` and never `GET /agents/wright`; a failed read names the request, an unreachable one is unknown; no read is sent while offline and a held value stays when a later read finds the kernel away; the roster's loading, empty and refused states; kernel text shown literally; no field, button, link, Save, proposal, reference limit or `$`; and the section is the last region of the Settings screen. |
| e2e, the hints | In the built app, each row's words and file; the refused file's note; Wright through `/threads/wright`, each crew member through `/agents/<id>`. |
| e2e, read-only | No field, button, link or tab stop in the section; no Save, proposal, reference limit or `$`; a labelled Threads region. |
| e2e, contrast | Every heading, paragraph, label, value, file path and badge in the section is at least 4.5:1 against what it sits on, in both themes (measured after the theme switch's transitions end). |
| e2e, evidence | This README lists exactly the four PNGs on disk and names the regenerate command; without `PHASE8_POLISH_EVIDENCE` nothing in this folder changed during the run. |
