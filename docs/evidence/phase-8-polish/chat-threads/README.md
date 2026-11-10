# Evidence: thread continuity in Chat and a Crew thread (phase 8, item 17c)

This is the polish-gate evidence for thread continuity in the app: Reply and its strip, Summarize & start fresh with its ⓘ panel and the summary preview, the size-hint highlight, Copy reference and its chip, rename in place, and the shared `Kernel unreachable` band. It covers Wright's Chat thread and one Crew thread (Pim's). Chat and Crew share one thread component (D25). Every screenshot comes from the built app running against the fixture kernel, in light and dark mode. They are evidence for the owner's review, not visual-regression baselines: the spec never compares pixels. Settings → Threads has its own folder ([`../settings-threads/`](../settings-threads/README.md)).

- Controls: [`ThreadControls.tsx`](../../../../app/src/screens/chat/ThreadControls.tsx) (thread header, rename, Copy reference, Reply, Summarize & start fresh, the ⓘ panel, the state hook), [`SummaryDialog.tsx`](../../../../app/src/screens/chat/SummaryDialog.tsx), [`ReferenceChip.tsx`](../../../../app/src/screens/chat/ReferenceChip.tsx), [`threads.css`](../../../../app/src/screens/chat/threads.css). The pure helpers are in [`continuity.ts`](../../../../app/src/screens/chat/continuity.ts). These are mounted by [`Thread.tsx`](../../../../app/src/screens/chat/Thread.tsx) and [`ChatComposer.tsx`](../../../../app/src/screens/chat/ChatComposer.tsx). The ⌘K commands are in [`commands.ts`](../../../../app/src/screens/chat/commands.ts).
- Unit tests: [`continuity.test.ts`](../../../../app/src/screens/chat/continuity.test.ts), [`continuity.test.tsx`](../../../../app/src/screens/chat/continuity.test.tsx), and the "composer: Reply" block of [`composer.test.tsx`](../../../../app/src/screens/chat/composer.test.tsx). The "thread commands" block of [`commands.test.tsx`](../../../../app/src/screens/chat/commands.test.tsx) also covers it.
- e2e: [`chat-threads.spec.ts`](../../../../app/e2e/chat-threads.spec.ts) over the fixture [`fixtures/chat-threads.ts`](../../../../app/e2e/fixtures/chat-threads.ts).
- Mockup: [`docs/design/mockups/chat-threads.html`](../../../design/mockups/chat-threads.html).

## How they were produced

```sh
cd app
npm ci
node node_modules/electron/install.js   # once, if the Electron binary is missing
npm run build
PHASE8_POLISH_EVIDENCE=1 npx playwright test e2e/chat-threads.spec.ts --workers=1 -g "evidence"
```

The spec writes screenshots to this folder only when **`PHASE8_POLISH_EVIDENCE=1`** is set, and first deletes every `*.png` here, so the folder always matches the current views. Without the switch, the shots go to Playwright's per-test output directory. Each shot is a full-window screenshot (1180 × 1100 px content, 2x, macOS, Electron) taken with `data-theme="light"` and then with `data-theme="dark"` set on `<html>`. Before each shot the spec checks that `color-scheme` reads that theme, and it waits for every finite animation (the strip's fade, the Dialog's entry) to finish. The last check asserts that this README names every file the run produced (14).

Times come from the fixture's fixed timestamps, shown in the machine's local time zone.

## Screenshots

| Light | Dark | View | Compared with in chat-threads.html |
|---|---|---|---|
| [chat-threads-light.png](chat-threads-light.png) | [chat-threads-dark.png](chat-threads-dark.png) | **Threads, Reply strip, ⓘ.** Wright's two threads, each with its header (kernel title, message count, Rename, Copy reference) and its messages on one rail. Message 6 continues thread 4 ("Reply to Wright · …", reply marked "continued"). Thread 4's latest reply reads 52,000 tokens, past the 40,000-token hint, so Summarize & start fresh is highlighted in `attention` and marked "past your size hint". Its ⓘ panel is open, with every figure in tokens. The Reply strip "Replying to: …" sits above the composer, whose label reads "Reply to Wright". | `chat-threads`, `chat-info`, `chat-reply` |
| [chat-preview-light.png](chat-preview-light.png) | [chat-preview-dark.png](chat-preview-dark.png) | **Summary preview.** The Dialog over the thread: title, "by Wright", the summary as text only (headings, list items, and a markup line that stays text), the file, its estimate and the messages it replaces, then Start fresh with this, Edit and Cancel `Esc`. | `chat-preview` |
| [chat-preview-edit-light.png](chat-preview-edit-light.png) | [chat-preview-edit-dark.png](chat-preview-edit-dark.png) | **Preview, editing.** Edit turns the summary into a text field ("Done editing" pressed) and adds the note that the edit is written to the file on Start fresh. | `chat-preview-edit` |
| [chat-summarized-light.png](chat-summarized-light.png) | [chat-summarized-dark.png](chat-summarized-dark.png) | **After Start fresh.** The old thread has the "Summarized" badge and the bar "Summarized: continued in Plan the v1.5 release (continued)." (a link to the new thread's title), and it keeps Reply. The new thread is below it. | `chat-fresh-old`, `chat-fresh` |
| [chat-rename-light.png](chat-rename-light.png) | [chat-rename-dark.png](chat-rename-dark.png) | **Rename in place.** The title becomes a field with Save `⏎` and Cancel `Esc`, and "Empty brings back the name from your first line." | `chat-rename` |
| [crew-reference-light.png](crew-reference-light.png) | [crew-reference-dark.png](crew-reference-dark.png) | **Crew thread with a reference chip.** Pim's thread: a replayed reply shows "Continuing from the saved conversation". The composer holds a pasted reference to Wright's thread, with title, "(2 messages)", "· Wright", the Full thread / Summary toggle on Summary, "about 420 tokens", and ×. | `crew-threads`, `crew-reply-fallback`, `crew-reference-summary` |
| [crew-unreachable-light.png](crew-unreachable-light.png) | [crew-unreachable-dark.png](crew-unreachable-dark.png) | **Kernel unreachable.** The fixture is stopped. The shared band shows, and Reply, Summarize & start fresh and Rename are disabled ("Needs the kernel"). Copy reference and ⓘ stay usable. | `chat-unreachable` |

## Where the build differs from the mockup, and why

Each difference follows from what 17b's kernel serves (the brief's Task § Design decisions). Each is recorded in [`docs/OPEN_QUESTIONS.md`](../../../OPEN_QUESTIONS.md):

- **The chip's Full thread view shows no size.** No kernel field gives a thread's full size before the send (DESIGN.md open point 1). A too-large reference is refused by the send itself (`409 history_too_large`), in characters, and the composer keeps the text and the chip.
- **The ⓘ panel's size hint is read-only and has no "Set one in Settings" proposal.** No route writes `thread_summarize_hint_tokens` (D34). The panel names the file to edit.
- **"Summarized: continued in …" lasts for the app's lifetime only.** The kernel exposes no `summarized_into` on read. The mark comes from Start fresh's `202` or an `already_started_fresh` refusal.
- **The new thread's "Started from a summary" block and "edited by you" after a reload are not drawn.** The kernel records no edit flag (DESIGN.md open point 4), and no read field links a new thread to its summary.
- **A sent reference is not redrawn as quoted data** under the owner's message. The kernel's thread read does not return a message's references.
