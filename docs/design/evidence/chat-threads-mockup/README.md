# Thread continuity mockup: screenshot, token and field-map evidence (phase 8 item 17a)

This folder holds screenshots of every view of [`docs/design/mockups/chat-threads.html`](../../mockups/chat-threads.html) in light and dark: 49 views, 98 images. It also has the audit of the mockup's token block and of every value outside it, the keyboard paths and contrast pairs measured in headless Chromium, and the map from every number and label the mockup shows to its source. That source is a field item 17b or item 16 names, a column or route at the base commit, or "computed in the app".

The mockup is static. It runs no kernel, and the URL hash forces each view (`#view=<view>&theme=<light|dark>`), so each screenshot comes from one headless-browser command. No script is committed.

The owner approves the design by merging the PR that adds it (D9). What the mockup commits items 17b, 17c and 16 to, and the open points for the owner, are in `docs/DESIGN.md`, section ["Thread continuity"](../../../DESIGN.md#thread-continuity-phase-8-item-17a).

The mockup reuses `phase-8.html`'s window, review strip, `Kernel unreachable` band and URL-hash hook. The screens it draws only in part (Approvals, Sessions, Tasks and Settings) say where the rest is drawn, and Team says it lives in `gui-v1.html`.

Two threads carry the views:

- **Wright's Chat**, Mon 9 Nov 2026 at 14:22. Thread 65 is the phase 8 live run's crew setup, now continued by Reply. Thread 70 is a second topic.
- **Sandbox Developer's Crew thread**, later the same day, 15:02–16:12. Both threads draw through one thread component, as `app/src/screens/chat/Thread.tsx` will.

Every name, repo and ticket is invented, apart from `vikashruhilgit/studio-sandbox`, the owner's sandbox.

## Screenshots

Each image is the full page: the intro line, the 1180×760 window, and the review strip under it with the forced view highlighted in its group. The viewport is 1280×1000 CSS px.

The window is a fixed 1180×760 and its body scrolls. A view taller than the window shows only the window's part of it in the PNG.

- A thread view scrolls the thread to what it is about when it opens (the Reply strip's message, the ⓘ panel, the new thread), so a thread's header can sit above the visible part. In `chat-long`, the header's "46 messages" and the "40 earlier messages" button are above it, and the highlighted Summarize is in view.
- An Approvals view is cut at the window's bottom edge (the second charter card on `approvals-charter-create`, the enable card under #13).

The rest is reachable by scrolling in a browser, and every view can also be selected from the review strip.

### Chat · Reply

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `chat-threads` | Wright's Chat with two threads under their headers (title, message count, Rename, Copy reference). "Set up a crew for my studio-sandbox tickets" has 6 messages: the owner's two replies are drawn joined on its rail ("Reply to Wright · 14:03"), and Wright's answers read "· continued". "What's waiting on me today?" has 2 messages. Every agent message has Reply. The latest has Summarize & start fresh and its ⓘ | [light](chat-threads-chat-threads-light.png) | [dark](chat-threads-chat-threads-dark.png) |
| `chat-plain-sent` | A plain message ("Draft a playbook that turns my ClickUp tasks into PRs.") starts a third thread with its own header: "Wright is replying · a new topic, in a fresh session" | [light](chat-threads-chat-plain-sent-light.png) | [dark](chat-threads-chat-plain-sent-dark.png) |
| `chat-reply` | The Reply strip above the composer: "Replying to: Added to Mason's held charter: a weekly digest of merged PRs, o…" (the message's first line, cut at 64 characters), an `Esc` key chip and ×. The composer reads "Reply to Wright" | [light](chat-threads-chat-reply-light.png) | [dark](chat-threads-chat-reply-dark.png) |
| `chat-reply-sent` | The sent reply sits on thread 65's rail, "Reply to Wright · 14:11", and the pending line says "Wright is replying · continuing this thread" | [light](chat-threads-chat-reply-sent-light.png) | [dark](chat-threads-chat-reply-sent-dark.png) |

### Chat · Summarize & start fresh

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `chat-info` | The ⓘ panel for thread 65, in tokens: Messages so far 6; Each reply now reads 24,800 tokens ("what the latest reply read: input and cache"); With a summary "Not written yet"; Size hint "Not set, so Summarize is never highlighted" with Set one in Settings. It says a summary keeps exact values word for word and drops the back-and-forth | [light](chat-threads-chat-info-light.png) | [dark](chat-threads-chat-info-dark.png) |
| `chat-summarizing` | Summarize is unavailable while "Wright is writing a summary of this thread: one short session. Nothing new starts until you choose, so Send waits." Send is disabled ("Waits for the summary"), described by that line | [light](chat-threads-chat-summarizing-light.png) | [dark](chat-threads-chat-summarizing-dark.png) |
| `chat-preview` | The preview dialog, "Summary of “Set up a crew for my studio-sandbox tickets”", by Wright. It has the summary's sections (Working on, Decided, Exact values, Open questions, Waiting on you), "Saved as `memory/wright/threads/65.md` · about 900 tokens, an estimate · in place of 6 messages", and Start fresh with this, Edit and Cancel (`Esc`) | [light](chat-threads-chat-preview-light.png) | [dark](chat-threads-chat-preview-dark.png) |
| `chat-preview-edit` | The same dialog in edit mode: the summary's markdown in a text area, Done editing pressed, and "Your edit is written to this file when you start fresh; Cancel or Esc drops it." | [light](chat-threads-chat-preview-edit-light.png) | [dark](chat-threads-chat-preview-edit-dark.png) |
| `chat-fresh` | The new thread "Set up a crew for my studio-sandbox tickets (continued)". Its top is the summary it started from, as a disclosure ("about 900 tokens, an estimate · by Wright", "Kept as `memory/wright/threads/65.md`"), and Wright's first reply reads "· started from the summary" | [light](chat-threads-chat-fresh-light.png) | [dark](chat-threads-chat-fresh-dark.png) |
| `chat-fresh-old` | The old thread stays readable. It has a `Summarized` badge and the note "Summarized: continued in <the new thread>. This thread stays, and Reply still continues it.", and each message still has Reply | [light](chat-threads-chat-fresh-old-light.png) | [dark](chat-threads-chat-fresh-old-dark.png) |

### Chat · Copy reference

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `chat-reference` | The chip in the composer: a paperclip, "Thread: Set up a crew for my studio-sandbox tickets (6 messages)", the Full thread / Summary toggle (Full thread pressed; the toggle shows because a summary exists), "4,200 tokens" and × | [light](chat-threads-chat-reference-light.png) | [dark](chat-threads-chat-reference-dark.png) |
| `chat-reference-summary` | The same chip on Summary: "about 900 tokens" | [light](chat-threads-chat-reference-summary-light.png) | [dark](chat-threads-chat-reference-summary-dark.png) |
| `chat-reference-sent` | The sent message "Use the same crew shape for vikashruhilgit/ntfs-tool." carries a quoted block: "Attached thread · sent to Wright as quoted data, not as your words", the thread, its count, "its summary · about 900 tokens", and Show what was attached. It is a new topic | [light](chat-threads-chat-reference-sent-light.png) | [dark](chat-threads-chat-reference-sent-dark.png) |

### Chat · States

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `chat-empty` | No thread yet: "Ask Wright anything." It says each message starts a new thread and Reply continues one. "Empty" here means no thread exists, not that a connector is missing | [light](chat-threads-chat-empty-light.png) | [dark](chat-threads-chat-empty-dark.png) |
| `chat-long` | Thread 65 past the owner's size hint: "40 earlier messages", 46 messages, the latest reply read 64,200 tokens, and the hint is 40,000, set by you. Summarize & start fresh is highlighted (`attention`) and marked "past your size hint". Thread 70 is under it and is not highlighted | [light](chat-threads-chat-long-light.png) | [dark](chat-threads-chat-long-dark.png) |
| `chat-reply-fallback` | A reply whose earlier session can't be continued: "Continuing from the saved conversation. The earlier session can't be continued, so Wright reads this thread's 6 saved messages, quoted as data, in a new session. Nothing in the thread is lost." | [light](chat-threads-chat-reply-fallback-light.png) | [dark](chat-threads-chat-reply-fallback-dark.png) |
| `chat-reference-too-large` | Mason's "Review notes for studio-sandbox" (212 messages) is refused: "Too large to attach: this thread is 182,000 tokens and your reference limit is 50,000 tokens. Nothing was cut and nothing was sent." It offers to remove it or attach its summary, links to Settings, and shows "Reference limit 50,000 tokens · set by you": this view is the one where the owner has saved a limit. With the limit unset (every other view) nothing is refused at paste. The chip has a `danger` edge and Send is disabled | [light](chat-threads-chat-reference-too-large-light.png) | [dark](chat-threads-chat-reference-too-large-dark.png) |
| `chat-unreachable` | The shared `Kernel unreachable` band. The subtitle reads "last known 14:22", and Reply, Summarize & start fresh, Rename and Send are disabled ("Needs the kernel"). Copy reference and ⓘ stay available: they read what is on screen | [light](chat-threads-chat-unreachable-light.png) | [dark](chat-threads-chat-unreachable-dark.png) |

### Crew · Sandbox Developer, later today

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `crew-threads` | Sandbox Developer's Crew thread ("Crew member · 2 threads · 16:12"). "Take ticket #9 on studio-sandbox through /automate" has 4 messages, with the owner's reply joined. "Which tickets on studio-sandbox are still open?" has 2 messages. Reply, Summarize & start fresh, ⓘ, Rename and Copy reference work as in Chat. The sidebar shows the crew later the same day | [light](chat-threads-crew-threads-light.png) | [dark](chat-threads-crew-threads-dark.png) |
| `crew-plain-sent` | A plain message ("Draft the PR description template for studio-sandbox.") starts a new topic | [light](chat-threads-crew-plain-sent-light.png) | [dark](chat-threads-crew-plain-sent-dark.png) |
| `crew-reply` | The Reply strip: "Replying to: It opened PR #24 and parked it, awaiting merge. I can't ask for…" (the first line, cut at 64 characters) | [light](chat-threads-crew-reply-light.png) | [dark](chat-threads-crew-reply-dark.png) |
| `crew-reply-sent` | "Approval #13 is through. Ask for the merge on PR #24." joined to its thread, continuing it | [light](chat-threads-crew-reply-sent-light.png) | [dark](chat-threads-crew-reply-sent-dark.png) |
| `crew-reply-fallback` | The same reply on the fallback path: "Continuing from the saved conversation", with this thread's 4 saved messages read as data | [light](chat-threads-crew-reply-fallback-light.png) | [dark](chat-threads-crew-reply-fallback-dark.png) |
| `crew-info` | The ⓘ panel for thread 90: 4 messages, 21,400 tokens per reply now, no summary yet, size hint not set | [light](chat-threads-crew-info-light.png) | [dark](chat-threads-crew-info-dark.png) |
| `crew-summarizing` | "Sandbox Developer is writing a summary of this thread", and Send waits, as in `chat-summarizing` | [light](chat-threads-crew-summarizing-light.png) | [dark](chat-threads-crew-summarizing-dark.png) |
| `crew-preview` | The preview of thread 90's summary: `memory/sandbox-developer/threads/90.md`, about 700 tokens, in place of 4 messages | [light](chat-threads-crew-preview-light.png) | [dark](chat-threads-crew-preview-dark.png) |
| `crew-preview-edit` | The preview in edit mode | [light](chat-threads-crew-preview-edit-light.png) | [dark](chat-threads-crew-preview-edit-dark.png) |
| `crew-fresh` | The new thread "Take ticket #9 on studio-sandbox through /automate (continued)", with the summary at its top and the first reply at 16:14 "· started from the summary". The old thread is marked Summarized above it | [light](chat-threads-crew-fresh-light.png) | [dark](chat-threads-crew-fresh-dark.png) |
| `crew-reference` | A reference to Wright's thread pasted into the Crew composer: "Thread: Set up a crew for my studio-sandbox tickets (6 messages) · Wright", the toggle (Wright's thread was summarized at 14:24) and 4,200 tokens | [light](chat-threads-crew-reference-light.png) | [dark](chat-threads-crew-reference-dark.png) |
| `crew-reference-summary` | The same chip on Summary: about 900 tokens | [light](chat-threads-crew-reference-summary-light.png) | [dark](chat-threads-crew-reference-summary-dark.png) |
| `crew-reference-sent` | "Use the crew setup we agreed when you pick up the next ticket." with Wright's summarized thread quoted as data, "sent to Sandbox Developer as quoted data, not as your words" | [light](chat-threads-crew-reference-sent-light.png) | [dark](chat-threads-crew-reference-sent-dark.png) |

### Settings · Size hint and reference limit

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `settings-threads` | The Threads section ("Kept with your other settings in the kernel"). Size hint: the field is empty ("Not set"), "Now not set · Summarize is never highlighted", and beside it "proposed by Wright · 40,000 tokens" with Use Wright's proposal. A sample shows how a thread past the hint looks (here: never highlighted). Reference limit: the field is empty ("Not set"), "Now not set · Nothing is refused when you attach a thread", and beside it "proposed by Wright · 50,000 tokens" with its own Use Wright's proposal. Save and Discard are disabled; "Saved." | [light](chat-threads-settings-threads-light.png) | [dark](chat-threads-settings-threads-dark.png) |
| `settings-threads-edit` | After Use Wright's proposal: the field holds 40000, nothing is saved yet, Save and Discard are on, and "Unsaved change. Leaving Settings drops it, as Discard does." | [light](chat-threads-settings-threads-edit-light.png) | [dark](chat-threads-settings-threads-edit-dark.png) |
| `settings-threads-invalid` | "40k" is refused under the field: "Enter a whole number of tokens, like 40000. Leave it empty for no size hint." (`aria-invalid`) | [light](chat-threads-settings-threads-invalid-light.png) | [dark](chat-threads-settings-threads-invalid-dark.png) |
| `settings-threads-set` | Saved: "Now 40,000 tokens · set by you". The proposal row is gone because the saved value is the proposal, and the sample shows Summarize highlighted and marked "past your size hint" | [light](chat-threads-settings-threads-set-light.png) | [dark](chat-threads-settings-threads-set-dark.png) |
| `settings-threads-ref-edit` | After the reference limit's Use Wright's proposal: its field holds 50000, nothing is saved yet, Save and Discard are on, and "Unsaved change." The size hint is untouched | [light](chat-threads-settings-threads-ref-edit-light.png) | [dark](chat-threads-settings-threads-ref-edit-dark.png) |
| `settings-threads-ref-invalid` | "50k" is refused under the reference limit: "Enter a whole number of tokens, like 50000. Leave it empty for no reference limit." (`aria-invalid`) | [light](chat-threads-settings-threads-ref-invalid-light.png) | [dark](chat-threads-settings-threads-ref-invalid-dark.png) |
| `settings-threads-ref-set` | Only the reference limit saved: "Now 50,000 tokens · set by you", its proposal row gone. The size hint still reads "Now not set" with its proposal | [light](chat-threads-settings-threads-ref-set-light.png) | [dark](chat-threads-settings-threads-ref-set-dark.png) |
| `settings-threads-both-set` | Both saved: "Now 40,000 tokens · set by you" and "Now 50,000 tokens · set by you", no proposal rows, and the sample shows Summarize highlighted | [light](chat-threads-settings-threads-both-set-light.png) | [dark](chat-threads-settings-threads-both-set-dark.png) |

### Session names

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `chat-rename` | Rename in place: thread 65's title becomes a field with Save (`⏎`) and Cancel (`Esc`), and "Empty brings back the name from your first line." | [light](chat-threads-chat-rename-light.png) | [dark](chat-threads-chat-rename-dark.png) |
| `chat-renamed` | The thread reads "Studio-sandbox crew setup", marked "renamed by you" | [light](chat-threads-chat-renamed-light.png) | [dark](chat-threads-chat-renamed-dark.png) |
| `sessions-names` | Sessions at 16:20 (1 running, 9 today), each with a name. A playbook's name ("Merge when ready"), an old thread's title marked continued, "From Wright: Review PR #24 on studio-sandbox" (a delegation), the owner's first lines, and an approval's label ("Create crew member: Sandbox Developer"). The detail pane for session 108 shows agent, session, model, started, tokens and "Thread: None: this session isn't a thread", with the naming rule under it. No session reads "ad hoc session" | [light](chat-threads-sessions-names-light.png) | [dark](chat-threads-sessions-names-dark.png) |
| `sessions-renamed` | Session 82 is selected, named by the owner's rename "Studio-sandbox crew setup" and marked "renamed by you". It says "Your rename. It wins over “Set up a crew for my studio-sandbox tickets”, the name the kernel derived." and has Open the thread | [light](chat-threads-sessions-renamed-light.png) | [dark](chat-threads-sessions-renamed-dark.png) |
| `tasks-names` | The Tasks board's session cards carry the session's name. Working has playbook run #31 and session #108. Done today has eight sessions. Waiting on you and Parked are empty, each with its own line | [light](chat-threads-tasks-names-light.png) | [dark](chat-threads-tasks-names-dark.png) |

### Approvals · Charter card

| View (`#view=`) | What it shows | Light | Dark |
|---|---|---|---|
| `approvals-charter-create` | Two held creates, #11 Sandbox Developer and #12 Mason, each "proposed by Wright · waiting on you". Each card shows: From Wright · 14:07 · in your thread “Set up a crew for my studio-sandbox tickets”; the model; limits "300,000 tokens a day · 1 session at once" (proposed by Wright); the workspace; "What it may do in the kernel · 3 jobs", where each job (Hand tickets to /automate, Triage PR comments, Read a PR) lists its tools' one-line purposes; Other tools (Tools, Bash prefixes, Never) shown as today; the closed disclosure "Kernel tool names, as enforced"; and Approve, Deny and Ask Wright to change it | [light](chat-threads-approvals-charter-create-light.png) | [dark](chat-threads-approvals-charter-create-dark.png) |
| `approvals-charter-raw` | #11's disclosure open: the enforced line with the raw `mcp__kernel__…` names, beneath the plain-language jobs | [light](chat-threads-approvals-charter-raw-light.png) | [dark](chat-threads-approvals-charter-raw-dark.png) |
| `approvals-charter-update` | #13, "Change crew member: Sandbox Developer". From Wright · 16:05 · the fit check of Merge when ready (#14) found the gap. Drafted against `config/agents/sandbox-developer.json` sha256 `3f9a1c07b2e4…`. "Adds · 1 job", Ask for a merge (2 tools, `adds`); "Keeps · 3 jobs, unchanged"; "Connector grants stay yours to give in Team. This change asks for none."; Approve change and Deny. The enable card #14 is under it | [light](chat-threads-approvals-charter-update-light.png) | [dark](chat-threads-approvals-charter-update-dark.png) |
| `approvals-fit-gap` | The fit check, the enable card #14 "Enable playbook: Merge when ready" (repo, runs as, Wright's dry run · 16:04), beside the held change #13. Its gap band reads "This playbook needs *Ask for a merge*; Sandbox Developer doesn't have it.", lists what the charter refused, and says the change is held beside it as #13. Enable is disabled, and Enable anyway is offered: "Approve #13 first, or enable anyway. Either choice is recorded." | [light](chat-threads-approvals-fit-gap-light.png) | [dark](chat-threads-approvals-fit-gap-dark.png) |
| `approvals-fit-closed` | After #13 is approved: "No gap. Sandbox Developer has every job this playbook needs: Ask for a merge, Read a PR." Enable is on, #13 reads "You approved it.", and the subtitle reads 1 waiting on you | [light](chat-threads-approvals-fit-closed-light.png) | [dark](chat-threads-approvals-fit-closed-dark.png) |

## What was driven by hand

The views above are static. The paths between them were driven in headless Chromium (Playwright 1.64.1) on 2026-11-09 against the committed file, with a scratch script outside the repo. It made **161 assertions, all held, with 0 console errors and 0 page errors.** The review fixes below (iteration 1) changed the HTML after that run, and were driven again in a second run; iteration 2's fixes were driven in a third. Both are listed at the end of this section, and where an earlier run's key differs from the third run's, the third run is the file's current behaviour. Keys were pressed with `page.keyboard`; no element was clicked except where a path below says so.

- **Every view in both themes.** The review strip lists 45 view buttons. All 45 keys, each loaded fresh through the hash in light and in dark (90 loads), set `data-theme`, press exactly that view's strip button, and keep the hash as `#view=<v>&theme=<t>`.
- **Odd hashes** fall back to `chat-threads`: empty, `#`, `#view=bogus`, `#view=__proto__`, `#view=constructor`, `#view=toString`, `#view=hasOwnProperty`.
- **`chat-unreachable`** shows the band (`role="alert"`) and disables Send.
- **The Reply strip (AC4), in Chat (`chat-threads`, message 67) and in the Crew thread (`crew-threads`, message 91):**
  - Tab from the page reaches that message's Reply. `Enter` shows "Replying to:" and puts focus in the composer.
  - Shift+Tab from the composer reaches the strip's ×.
  - `Esc` cancels the strip, and focus returns to that message's Reply. `Enter` on × does the same.
- **The summary preview (AC4), in Chat (thread 65) and Crew (thread 90), in dark:**
  - Tab reaches Summarize & start fresh. `Enter` shows "writing a summary", and the preview opens by itself 1.4 s later.
  - The preview's Tab order is summary text → Start fresh with this → Edit → Cancel, and Tab then wraps to the summary text. Shift+Tab from the summary text wraps to Cancel.
  - `Esc` closes the preview with focus back on Summarize. `Enter` on Cancel does the same.
  - Edit puts focus in the text area. Typing, then `Esc`, drops the edit, with focus back on Summarize.
  - Start fresh with this lands on the started-fresh view (`chat-fresh` / `crew-fresh` in the hash), with the Summarized bar on the old thread and the summary at the new thread's top.
- **The reference chip (AC4).** In Chat (`chat-fresh`, thread 65, which has a summary):
  - Tab reaches Copy reference and `Enter` copies it. Tab reaches the composer, and Ctrl+V pastes the chip with focus still in the composer.
  - Shift+Tab reaches the chip's ×, then the toggle's Summary. `Enter` on Summary switches it ("about 900 tokens") and keeps focus on the toggle, and Shift+Tab reaches Full thread.
  - `Enter` on × removes the chip, and focus returns to the composer.

  In the Crew thread (`crew-threads`, thread 90, no summary yet) there is no toggle; × is reached and returns focus to the composer the same way. `crew-reference` names Wright's thread and its agent, so a reference copied in Chat pastes into a Crew composer. `chat-reference-too-large` names 182,000 and 50,000 tokens and disables Send.
- **The ⓘ panel and rename.** On `chat-threads`, `Enter` on ⓘ opens the panel and `Esc` closes it with focus back on ⓘ. `Enter` on Rename puts focus in the name field, and `Esc` cancels with focus back on Rename.
- **Review fixes, iteration 1 (second run, 2026-11-09, same setup, against the fixed file): 360 assertions, all held, 0 console errors, 0 page errors.** Clicks are named where used.
  - All 45 views again in light and dark: hash, theme and the pressed strip button.
  - Summarize on thread 70 (Chat) and 93 (Crew), clicked: no preview opens after 1.7 s, the key stays, nothing is marked Summarized, and the note says the flow is drawn on thread 65 / 90. Summarize on 65 / 90 still opens their preview; once started fresh, Summarize on 65 / 90 says it is already summarized.
  - Type in the composer, click Summarize, press `Enter` at once: Send is disabled with "so Send waits", nothing is sent, and the preview still opens 1.4 s later. `Esc` closes it onto `chat-threads`, Summarize is enabled again, and focus is on it. On `crew-reference`, toggling the chip to Summary while the summary is written keeps `crew-summarizing`, and closing the preview lands on `crew-reference-summary`. A double click on Summarize opens one dialog. A view change during the wait cancels it. With the palette open when the wait ends, the preview replaces it and `Esc` returns focus to Summarize.
  - On `chat-reply` and `crew-reply`, Summarize then `Esc` keeps the key and the Reply strip; Start fresh from there ends the strip and lands on `chat-fresh` / `crew-fresh`. On `chat-rename`, Summarize then `Esc` keeps `chat-rename` and the field. Reply opened while the summary is written makes Cancel land on `chat-reply`. From `chat-info`, the preview closes onto `chat-threads` (Summarize closed the panel). A forced `chat-preview` / `crew-preview` closes onto `…-threads` with focus on Summarize.
  - Settings: the reference limit is empty and "not set"; its Use Wright's proposal (clicked, and from `⌘K`) fills 50000; Save makes it "set by you" and removes the proposal row; "50k" is refused with "Leave it empty for no reference limit." `chat-reference-too-large` names 182,000 and 50,000, credits the limit "set by you" with no "proposed by Wright", and disables Send. On `chat-fresh` a pasted chip shows no refusal (no limit set).
  - The AC4 paths above, again: Reply strip `Esc` to Reply (Chat, Crew); the preview's Tab order summary text → Start fresh with this → Edit → Cancel → wrap, Shift+Tab wrap, Cancel and `Esc` to Summarize (Chat, Crew, dark); the chip's toggle and × by Shift+Tab, × to the composer; Rename and ⓘ `Esc`; a strip view change clears a running summary and the Reply strip.
- **Review fixes, iteration 2 (third run, 2026-11-09, same setup, against the fixed file): 446 assertions, all held, 0 console errors, 0 page errors.** Clicks and keys as named. After each in-place action the run read the hash, loaded that hash in a fresh page, and compared the window's markup and field values with what the action left on screen (sent-message times excepted, since a send stamps the screen's clock).
  - All 49 views in light and dark: each keeps its own key on load, sets `data-theme` and presses its strip button.
  - In Chat and in the Crew thread: Reply, `Esc` and × on the strip; ⓘ open and closed; a reply sent; a plain message sent; Summarize, the preview, Edit and Done editing, Cancel and `Esc`, Start fresh with this; Summarize from the Reply strip, `Esc`, and Start fresh from there; the chip's Summary and Full thread, ×, and a sent reference. Each lands on a key whose reload draws the same screen. In Chat also: Copy reference then `Ctrl+V` (`chat-reference`); Rename, `Esc`, Save (`chat-renamed`) and Cancel; Rename and Summarize from `chat-info`; a forced preview's `Esc`. Open the thread from `sessions-renamed` lands on `chat-renamed`; a plain message sent, then `⌘6` and `⌘1`, comes back to `chat-plain-sent`.
  - Settings: the reference limit's Use Wright's proposal (`settings-threads-ref-edit`), Save (`settings-threads-ref-set`), then the size hint's proposal and Save (`settings-threads-both-set`); "50k" in the limit and Save (`settings-threads-ref-invalid`), Discard (`settings-threads`); the hint's proposal (`settings-threads-edit`), Discard, typing 40000 (`settings-threads-edit`), "40k" and `Enter` (`settings-threads-invalid`); Save from `settings-threads-edit` (`settings-threads-set`); clearing a saved hint and Save (`settings-threads`). Each reload draws the same screen.
  - Approvals: Approve change on `approvals-fit-gap` lands on `approvals-fit-closed`; opening and closing #11's raw names lands on `approvals-charter-raw` and back.
  - The reviewer's repros: `chat-reference-too-large`, Summarize on 65, Start fresh with this lands on `chat-fresh` (Mason's refused chip stays in the composer; no view forces both). On `chat-rename`, a message sent with the field open keeps `chat-rename`, and the field stays.
  - The AC4 paths, again: Reply strip `Esc` to Reply (Chat, Crew); the preview's Tab order summary text → Start fresh with this → Edit → Cancel → wrap and `Esc` / Cancel to Summarize (Chat, Crew, dark); the chip's × and Summary by Shift+Tab, × to the composer; Rename `Esc` to Rename.
  - Not re-measured for contrast: the four new Settings views. They draw only what `settings-threads-edit`, `settings-threads-invalid` and `settings-threads-set` already drew and the audit below measured, on the reference limit's row.

**Contrast (AC4), both themes.** The same run read the computed colour of every visible text node inside the window, in all 45 views in both themes (90 renders). It composited each colour over the opaque background behind it and flagged anything under 4.5:1. A dialog's own text is included, and the page behind its scrim is measured as if there were no scrim. Text inside `.vh` (visually hidden) and SVG drawing data were skipped.

**No enabled text is under 4.5:1.** The only hits are 44 nodes of disabled controls: Summarize while it is writing, Send while a reference is refused or the kernel is unreachable (and, since iteration 1, while a summary is written: the same `ink-disabled` on a disabled fill, 4 more nodes in `chat-summarizing` and `crew-summarizing`, not re-measured), Reply, Rename and Summarize while unreachable, Save and Discard with nothing changed, and Enable while the gap is open. They measure 2.03–2.15:1 (light) and 2.67–2.79:1 (dark): `ink-disabled` on a disabled button's fill, and on the thread's ground for the unavailable Summarize while it is writing. WCAG 1.4.3 exempts the text of an inactive control.

The token pairs the mockup draws, measured from the page's computed tokens (WCAG 2.1 ratios):

| Pair | Light | Dark | Where |
|---|---|---|---|
| `ink` on `ground`, `surface`, `surface-sunken`, `accent-soft`, `parked-soft`, `attention-soft`, `ok-soft` | 14.28–17.29 | 11.27–16.00 | Messages, titles, the Summarized bar, the fit-check band, the summary text |
| `ink-secondary` on `ground`, `surface`, `surface-sunken`, `surface-raised`, `accent-soft`, `parked-soft`, `attention-soft`, `ok-soft` | 5.31–6.43 | 5.34–7.59 | Ghost buttons (Reply, Summarize, Copy reference, Rename), the ⓘ text, the dialog's body, purpose lines, captions stepped up on a fill |
| `ink-tertiary` on `ground`, `surface`, `surface-sunken` | 4.83–5.59 | 4.97–5.65 | Captions, times, counts, the composer's placeholder |
| `ink-tertiary` on `accent-soft` | 4.68 | **4.09** | Never drawn with text: the selected session row's caption and the selected crew entry's last line step up to `ink-secondary` (5.39 / 5.50) for this reason (`.row.sel .m`, `.nav.crew.sel .last`). The audit above found no text on this pair |
| `accent` on `ground`, `surface`, `surface-sunken`, `surface-raised`, `accent-soft` | 5.43–6.48 | 5.22–7.21 | Links (Set one in Settings, the new thread's link, Show what was attached, Kernel tool names), the pressed toggle segment, `proposed by Wright` |
| `on-accent` on `accent` | 6.48 | 7.02 | Send, Start fresh with this, Save, Approve |
| `attention` / `parked` / `ok` / `danger` on their `-soft` fill | 4.63–5.09 | 5.84–7.11 | `waiting on you`, `past your size hint`, `Summarized`, `approved`, `adds` and the band text |
| `danger` on `ground`, `surface` | 5.47, 5.95 | 7.09, 6.52 | The reference refusal and the Settings field error |
| Non-text: `focus` on `ground`, `surface` | 5.95, 6.48 | 6.90, 6.34 | The 2px focus ring |
| Non-text: `border` on `ground`, `surface`, `surface-raised` | 3.11, 3.38, 3.38 | 3.63, 3.33, 3.02 | The chip's edge, the toggle's edge and divider, secondary buttons (Edit in the preview, Use Wright's proposal, Enable anyway, the earlier-messages button) |
| Non-text: `attention`, `ok`, `danger` edges on `surface` | 5.64, 5.32, 5.95 | 8.89, 7.20, 6.52 | The highlighted Summarize's edge, a waiting approval card, the `adds` job card, the refused chip |

The reference block's 3px left bar is `border` on the block's own `surface-sunken` fill (2.92:1 in light), and on the `ground` outside it (3.11:1). It is decoration: the block is named by its "Attached thread · sent to … as quoted data" line. The toggle's pressed segment is shown by its `accent` text (5.43 / 5.22) and weight 500, not by its fill alone.

The text field's own edge (`surface-sunken` on `ground`, 1.06 / 1.04) is the approved Input's, carried unchanged from `gui-v1.html` through `phase-8.html`; it is named here, not changed.

Not driven: a screen reader. The dialog's role and labels, the live region and the strip's `role="group"` are set, and VoiceOver was not run.

## How to regenerate

Setup, once: the Playwright CLI at the version `app/package-lock.json` pins (1.64.1), with its Chromium:

```sh
cd app && npm ci && npx playwright install chromium
```

`app/node_modules` and Playwright's cached Chromium were already present in this checkout on 2026-11-09, so neither command needed to change anything. Then, from `app/`, each shot is one command. `<repo>` is the absolute path of your checkout, `<v>` is a value from the `View` column above, and `<t>` is `light` or `dark`:

```sh
npx playwright screenshot --color-scheme=<t> --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/chat-threads.html#view=<v>&theme=<t>' <repo>/docs/design/evidence/chat-threads-mockup/chat-threads-<v>-<t>.png
```

For example, `chat-preview` in dark:

```sh
npx playwright screenshot --color-scheme=dark --viewport-size=1280,1000 --full-page --wait-for-timeout=600 'file://<repo>/docs/design/mockups/chat-threads.html#view=chat-preview&theme=dark' <repo>/docs/design/evidence/chat-threads-mockup/chat-threads-chat-preview-dark.png
```

To regenerate all 98 (bash, from `app/`; it was run as a scratch script with this list, and all 98 commands exited 0; last run for review iteration 2, because the four Settings views it added put new buttons on the review strip every image shows):

```sh
for v in chat-threads chat-plain-sent chat-reply chat-reply-sent chat-info chat-summarizing chat-preview chat-preview-edit chat-fresh chat-fresh-old chat-reference chat-reference-summary chat-reference-sent chat-empty chat-long chat-reply-fallback chat-reference-too-large chat-unreachable crew-threads crew-plain-sent crew-reply crew-reply-sent crew-reply-fallback crew-info crew-summarizing crew-preview crew-preview-edit crew-fresh crew-reference crew-reference-summary crew-reference-sent settings-threads settings-threads-edit settings-threads-invalid settings-threads-set settings-threads-ref-edit settings-threads-ref-invalid settings-threads-ref-set settings-threads-both-set chat-rename chat-renamed sessions-names sessions-renamed tasks-names approvals-charter-create approvals-charter-raw approvals-charter-update approvals-fit-gap approvals-fit-closed; do
  for t in light dark; do
    npx playwright screenshot --color-scheme=$t --viewport-size=1280,1000 --full-page --wait-for-timeout=600 "file://<repo>/docs/design/mockups/chat-threads.html#view=$v&theme=$t" "<repo>/docs/design/evidence/chat-threads-mockup/chat-threads-$v-$t.png"
  done
done
```

The hash's `theme` sets `data-theme` on the page, and `--color-scheme` matches it, so a shot never depends on the host's appearance setting. `--wait-for-timeout=600` lets the dialog's open animation (`duration-slow`, 240ms) finish.

A forced `…-summarizing` view starts no timer (the 1.4 s wait into the preview starts on a click only), so its shot shows the summary being written. The `working` dot and the spinner animate, so their frame can differ by a few pixels in a regenerated shot.

## Token audit

### The token block is the generator's output, verbatim

The mockup's `<style>` opens with the stdout of `node app/scripts/tokens.mjs`, pasted between the `/* tokens:begin */` and `/* tokens:end */` comment lines. Generator names are used throughout (`--radius-lg`, `--duration-base`, `--ease-standard`, `--space-4`, `--type-body-size`), never gui-v1's short forms (`--r-lg`, `--d-base`, `--ease`). To check, run this from the repo root (bash, for the process substitution):

```sh
diff <(node app/scripts/tokens.mjs) <(awk '/\/\* tokens:end \*\//{f=0} f; /\/\* tokens:begin \*\//{f=1}' docs/design/mockups/chat-threads.html); echo "exit $?"
```

Result, 2026-11-09: no diff output, then `exit 0`. The block is 195 lines, the same as the generator's stdout. `grep -n -E "var\(--(r-[a-z]+|d-[a-z]+|ease)\)" docs/design/mockups/chat-threads.html` prints nothing: no short-form name is used.

### Values outside the block

The rest of the `<style>` is in four parts:

- The **harness** block (`harness:begin` … `harness:end`), the same as `phase-8.html`'s.
- The **app UI** part, copied unchanged from `phase-8.html` (itself from `gui-v2.html`).
- The **Thread continuity additions**.
- The **second part's** rules (Crew, Settings, Sessions, Tasks, Approvals). The board and card rules in it are copied from `phase-8.html`.

Only the harness is review-harness chrome.

The table names every literal value outside the token block. It was found by listing each number and colour in the CSS outside the block (every declaration, with `var(...)` removed), plus the values the script passes inline. Structural values are not listed: `0`, `100%`, `1fr`, `auto`, `max-content`, `minmax(0, 1fr)`, `flex: 1`, `repeat(4, …)` (the board's four columns), `repeat(2, …)` (the fit-check pair), `-1` in `calc(var(--space-2) * -1)` and the token-only `calc(var(--row-height) - var(--space-1))` lay out the page and carry no design value. The colour keywords `transparent` and `currentColor` are structural too. Lucide icon geometry (the `d` paths) and the avatar shapes are drawing data, not styles.

| Value | Where | Marking |
|---|---|---|
| `--desk` `#3a3d52` / `#101118`, `--desk-ink` `#eef0ff` / `#d9dbef` | The desk the window sits on, the intro line and the review strip (light / dark) | review-harness chrome (not app UI) |
| `--win-shadow` `0 24px 80px #00000059, 0 0 0 1px #00000026` / `0 24px 80px #000000b3, 0 0 0 1px #ffffff1f` | The window's drop shadow on the desk, applied to `.win` | review-harness chrome (not app UI) |
| `#ff5f57`, `#febc2e`, `#28c840`; 12px circles at `50%` radius, `8px` gap and padding | The macOS traffic lights (the real app gets them from the OS) | review-harness chrome (not app UI) |
| `#ffffff14`, `#ffffff33`, `#ffffff26`, `#ffffff1f` | Review strip fill, borders, the selected segment and the key chips | review-harness chrome (not app UI) |
| `1240px`, `26px`, `12px`, `15px`, `20px`, `16px`, `24px`, `10px`, `18px`, `6px`, `5px`, `4px`, `1px`, `2px`; opacity `.7`, `.75`, `.9`; weights `500`, `600`; `max-width: 1280px` media query | Page, intro and review-strip sizes, type, padding, gaps, radii and focus ring; the breakpoint under which the intro and the strip go full width | review-harness chrome (not app UI) |
| `1180px` × `760px` | The window | new — the default window size, carried from `phase-8.html` (gui-v1; phase 5's polish evidence) |
| `blur(24px) saturate(1.4)` | Sidebar vibrancy | new — `brand-book.md` §Layout; carried from `phase-8.html` |
| `1px` | Hairline and border widths (the info panel, the summary disclosure, the chip, the toggle and its divider, a job card, the board's dashed "none" line); the visually hidden live region's size | new — component READMEs specify "a `hairline` edge"; tokens.json has edge colours but no widths |
| `2px` | Focus ring width and offset (also on a thread title that takes focus, `.th .tt:focus-visible`); the thread rail (`.tl`, a 2px `hairline` left edge that joins a reply to the thread it continues); the `idle` ring; the switch knob's inset; the spinner's border | new — `brand-book.md` §Colour: "2px solid with a 2px offset"; the rail reuses the focus ring's width so a joined thread reads as one line without a new value; the rest as in `phase-8.html` |
| `3px` | The reference block's left bar (`.refq`) | new — a quote bar one step heavier than the rail, so a quoted thread never reads as a joined reply (invariant 3: quoted data, not the owner's words) |
| `8px` | StatusDot size; the session row's dot column | new — StatusDot README: "An 8px dot" |
| `16px`, `14px`, `12px`; stroke widths `1.5`, `1.75`, `2` | Lucide icon sizes (rows and buttons, the 14px icons in buttons, the chip and the strip), the spinner (12px) | new — `brand-book.md` §Iconography (16px at 1.5px stroke; 14px in badges); the spinner is `integrations.html`'s |
| `20px` | Badge height; the small Avatar (inline `--s`) on session cards, the session pane and the enable card | new — Badge README: "All 20px tall"; List README's small Avatar |
| `24px` | The Avatar on a thread turn, the crew rows and the charter card header (inline `--s`); the turn's avatar column | new — List README (24px Crew avatar) |
| `32px` | Avatar's default `--s` | new — `avatar.css` default |
| `32px` × `18px`, knob `14px`, `translateX(14px)` | The switch | new — carried from `phase-8.html` (its open point 13: Table README says 26×16). No view here draws a switch |
| `44px` | Crew row height in the sidebar; the palette's search row | new — List README (44px Crew rows), CommandPalette README ("a 44px search row") |
| `10px`, `70%`, `40%` | A skeleton line's height and the second and third line widths | new — gui-v1's skeleton; carried from `phase-8.html`. No view here draws a skeleton |
| `150px` | The Settings form's label column (`.fe`) | new — the longest label ("On a thread past it", "Reference limit") plus a gap, as in `phase-8.html`'s field-level edit |
| `166px` | Settings' Save row indent (`.facts`) | new — the 150px label column plus `space-4` (16px), so Save lines up with the fields |
| `200px` | The number field's width (`.fe .field.num`) | new — a number up to 9 digits with the `tokens` unit at body size, plus the Input's padding |
| `360px` | The rename field's width (`.rnf .field`); the toast's width; the palette list's maximum height | new — a title up to the field's 80 characters reads in about two thirds of the thread column at body size; Toast README ("360px") and the palette as in `phase-8.html` |
| `480px`, `560px`, `20%` | Dialog widths (the preview uses the wide Dialog), the palette width, the route-failure card's maximum width, the palette's offset from the top; `560px` is also the maximum width of the ⓘ panel, the fallback note, the reference block and an owner's message bubble | new — Dialog README (480px, wider when it carries more); the preview carries the summary, so it takes the 560px Dialog as `phase-8.html`'s steps dialogs do; the panels match the message bubble's width so they never run past the message they belong to |
| `720px` | A turn's maximum width; also the Summarized bar, the summary disclosure and the refusal line | new — copied from gui-v1's `.turn`; the thread's own notes keep the turn's width |
| `300px`, `180px` | The summary text's maximum height in the preview; in a sent reference's disclosure | new — the preview shows about 12 lines of the summary before it scrolls (the dialog still fits a 760px window); a quoted block stays shorter than the message it is attached to |
| `240px`, `72px` | The preview's text area minimum height (`.dlg textarea`); the shared text area's minimum height | new — the edit shows as much of the summary as the read view does; 72px is three body lines, carried from `phase-8.html` |
| `14em` | Flex basis of a card heading in the fit-check pair (`.pair .mcard .mh h3`) | new — lets "Change crew member: Sandbox Developer" wrap before the badges in a half-width card |
| `65ch` | Maximum width of the empty state's lines | new — `brand-book.md` §Type: "Running text stays under 65 characters" |
| `500` | Font weight of buttons, the selected sidebar row, the neutral badge, form labels and the pressed toggle segment | new — List README ("weight 500" when selected), gui-v1's buttons; tokens.json defines 500 only for `kbd` |
| `.55`, `.85`, `50%` | The `working` dot's breathing keyframe (opacity, scale, midpoint) | new — gui-v1's StatusDot `pulse`; the duration is `--duration-pulse` |
| `.98` | Dialog and palette open scale | new — Dialog and CommandPalette READMEs: "scaling from 0.98" |
| `1turn` | The spinner's rotation keyframe | new — `integrations.html`'s spinner; the duration is `--duration-pulse` |
| `50`, `60` | Overlay and toast `z-index` | new — gui-v1's overlay stacking, the toast above it |
| `inset(50%)` | `clip-path` of the visually hidden live region and labels | new — the standard visually-hidden pattern |
| Opacity `.28`, `.45`, `.85`; stroke widths `1.6`, `1.2`, `1.9`, `.8`; dash arrays `2.6 1.5`, `1.8 1.4`, `2.4 2.6` | The Avatar's fill, stitches, lines, loose thread and crown (static idle pose) | new — copied unchanged from `docs/design/avatar/avatar.css` |
| `1400` ms, `4000` ms (script) | The mock summary's wait before the preview opens; how long a toast stays | new — mock behaviour only, not design durations (Toast README says 6s; phase 7's open point 13 carries the 4s) |
| inline `--s:20px`, `--s:24px` (script) | Avatar sizes, as above | new — List and Card READMEs' avatar sizes |

A few rules carried from `phase-8.html` are drawn by no view here: `.sw`, `.skel`, `.fail`, `.crumb`, `.box`, `.gate` and `svg.i.xs`. This was found by listing every class the CSS names and every class any of the 45 views, the palette and a toast render. They are left in so the shared rules stay byte for byte as approved.

### New components and variants

The mockup uses List, Card, Badge, StatusDot, Dialog, Input, Toast, Button, CommandPalette and Avatar as the design system defines them. Each class below is new in this item; the ones copied from `phase-8.html` are approved there and are listed in the last row.

| Class | What it is | Marking |
|---|---|---|
| `.tg`, `.th`, `.th .tt`, `.tl`, `.ub`, `.rto` | A thread: its header (title, count, badges, Rename, Copy reference) and its messages on one rail; a reply's "Reply to <agent> · <time>" line | new — a List variant grouped by thread. No design-system component draws a thread with a header |
| `.macts`, `.btn.ic`, `.btn.hl`, `.btn[aria-disabled]` | The actions under an agent message (Reply, Summarize & start fresh, ⓘ); the icon-only ⓘ button; Summarize highlighted past the size hint (`attention-soft` fill, `attention` text and edge); Summarize unavailable while writing | new — Button variants. `.hl` uses the `attention` state colours only; no new colour |
| `.infop` | The ⓘ panel: this thread's numbers in tokens | new — a Card body with a definition list, inline under the message it belongs to |
| `.pend`, `.fb` | The pending line under a sent message; the fallback note ("Continuing from the saved conversation") | new — a status line with a StatusDot; the fallback is a `surface-sunken` note, not a band, because it is not a failure |
| `.sumbar`, `.sumtop`, `.sumtext`, `.lnk` | The Summarized note on the old thread (`parked-soft`), the summary a new thread starts from (a disclosure), the summary text, and an inline link button | new — the note is a Band without an action; the summary is Card chrome over plain markdown (headings as `label`, list items) |
| `.crow`, `.rstrip`, `.x` | The composer row; the Reply strip (`accent-soft`, with × and the `Esc` chip); a bare dismiss button | new — the strip is a Band in the composer; × reuses Toast's dismiss button |
| `.rchips`, `.rchip`, `.rchip.err`, `.rc-t`, `.seg2`, `.cerr` | The reference chip (paperclip, thread, count, toggle, size, ×), its refused state (`danger` edge), the two-segment Full thread / Summary toggle, and the refusal line | new — no design-system component draws an attachment. The paperclip is a Lucide icon, not the 📎 emoji: brand-book bans emoji in Wright's voice and every other glyph here is an icon |
| `.refq`, `.refq .src` | A sent reference: quoted data with its source line | new — a blockquote with a `border` bar, so a quoted thread never reads as the owner's words (invariant 3) |
| `.rnf` | Rename in place: the title becomes an Input with Save and Cancel | new — Input and Button in the header row |
| `.where`, `.prop`, `.ferr`, `.fe .field.num`, `.fe .field .u` | The "drawn elsewhere" note; a setting's provenance row ("Now … · set by you", "proposed by Wright"); a field's error; the number field with its `tokens` unit | new — layout over Badge and Input's error text |
| `.jobs`, `.job`, `.job.add`, `.job .jh`, `.raw`, `.raw .ms` | The charter card's jobs: one card per job with its tool count and purpose lines (an `ok` edge when the change adds it); the "Kernel tool names, as enforced" disclosure | new — Card chrome over a list; the raw names stay beneath, never instead (item 16 AC3) |
| `.pair`, `.fit`, `.fit.ok` | The enable card and the held change side by side; the fit-check band (`attention-soft` with the gap, `ok-soft` when closed) | new — a Band with a list and a link to the held change |
| `.row .m`, `.row.sel .m`, `.nav.crew.sel .last`, `.tcard .why`, `.tcard[disabled]` | A session row's caption line; the caption on a selected row or crew entry steps up to `ink-secondary` (`ink-tertiary` is 4.09:1 on `accent-soft` in dark); "renamed by you" on a task card | new — layout and a contrast step-up; no new colour |
| the shell, `.board`, `.bcol`, `.tcard`, `.empty`, `.band`, `.mcard`, `.kv`, `.blk`, `.sech`, `.dhead`, `.pad`, `.split`, `.list`, `.pane`, `.row`, `.fe`, `.field`, `.facts`, `.dlg`, `.pal`, `.toast`, `.turn`, `.composer`, `.thread`, `.badge`, `.btn`, `.dot`, `.bot` | The window, sidebar, board, cards, empty state, band, approval card, definition lists, list pane, form fields, dialog, palette, toast, Chat turns and the composer | copied unchanged from `phase-8.html`; approved there, and its evidence README lists each one |

## Checks

Run from the repo root. Results are from 2026-11-09.

```sh
grep -nE '\$[0-9]|USD|dollar' docs/design/mockups/chat-threads.html
grep -niw "cost" docs/design/mockups/chat-threads.html
grep -n "Claude C[o]de" docs/design/mockups/chat-threads.html
grep -ni "claude.ai" docs/design/mockups/chat-threads.html
grep -n "vendsy" docs/design/mockups/chat-threads.html
grep -n -i -E "sign in|sign-in|signin|type=\"password\"" docs/design/mockups/chat-threads.html
grep -niE '<button[^>]*>[^<]*merge' docs/design/mockups/chat-threads.html
bash scripts/check-docs.sh
```

- **AC3, tokens never dollars (D24).** The dollar grep prints nothing, so there are no hits to account for. The `cost` grep prints nothing either. Every size on screen is in tokens: the ⓘ panel, the preview's estimate, the chip, the refusal, the size hint, the reference limit, the charter's daily limit and each session's tokens.
- **AC3, invariants 6 and 7.** The Claude and claude.ai greps print nothing. The first is AC3's grep for the command-line tool's name, written with `[o]` in place of its `o`: the bracket matches exactly the same lines, and it keeps this README from matching its own pattern. The only attribution is "Wright, powered by Claude", in the palette footer. The sign-in grep prints nothing: no control is a sign-in and there is no password field.
- **No employer data.** The `vendsy` grep prints nothing. The only real repo named is `vikashruhilgit/studio-sandbox` (and `vikashruhilgit/ntfs-tool` in one sent message, also the owner's).
- **Invariant 4.** The merge-button grep prints nothing. "Ask for a merge" is a job name and its tools' purpose lines say the gate merges ("It never merges"); no control merges.
- **Docs.** `bash scripts/check-docs.sh` prints `check-docs: OK`.

## Field map (AC5)

Every number and label the mockup shows about a thread, a session, a summary, a reference or the charter card, and its source. A source is one of:

- **17b**: a field item 17b's requirement names, cited by item number (`.supervisor/requirements/phase-8-17/2026-11-09-160018-thread-continuity-in-the-kernel.md`, gitignored and kept with the job). 17b is not merged; this map cites its requirement, as the phase 8 mockup cited phase 8's.
- **16**: item 16's catalogue or fit check (`.supervisor/requirements/phase-8-16/2026-11-09-160016-wright-drafts-charters-that-cover-the-work.md`), cited by Scope or AC number.
- **base**: a column at the base commit (`<migration file>: <table>.<column>`, migrations in `kernel/src/store/migrations/`), a route that exists there, or a shape in `app/src/api/contract.ts`.
- **computed in the app**: the app derives it from the fields above, or from its own state (what it just sent, its clock, its cache).

Words a view writes itself (button labels, empty-state copy, the note that a screen is drawn elsewhere) are copy, not fields, and are not listed. A field with no source is marked **open point N** and is listed for the owner in `docs/DESIGN.md` §["Open points for the owner (thread continuity)"](../../../DESIGN.md#open-points-for-the-owner-thread-continuity). None is drawn as if it existed, and none was removed from the HTML.

Existing routes at the base commit used below: `POST /ask`, `GET /threads/:agent`, `GET /sessions`, `GET /tasks`, `GET /agents`, `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/deny`.

### A thread (Chat and Crew)

| Field | Source |
|---|---|
| Messages grouped into threads; the thread's stable id | 17b item 3: each thread's id is its first row's id, returned per message by the thread route (AC6) |
| Thread title ("Set up a crew for my studio-sandbox tickets") | 17b item 11: the session `title`, the first line of the owner's message, trimmed; a reply in a thread takes that thread's title |
| "(continued)" on a thread started from a summary | 17b item 11: "the old thread's title, marked continued" |
| Renamed title, "renamed by you", "Empty brings back the name from your first line" | 17b item 12: the owner's rename is stored and wins over the derived title; the derived title is deterministic (item 11), so clearing the rename brings it back |
| Message count ("6 messages", "(212 messages)", "46 messages") | 17b item 7: the thread route's message count. What one "message" is: **open point 3** |
| "40 earlier messages" | computed in the app: the count (17b item 7) less the rows drawn |
| `Summarized` badge; "Summarized: continued in <new thread>" with its link | 17b item 6: the old thread is marked summarized with a pointer to the new one |
| Subtitle "Wright · 2 threads", "Crew member · 2 threads · 16:12" | computed in the app: the distinct thread ids (17b item 3) from base `GET /threads/:agent`; the time is the app's clock |
| "last known 14:22" (unreachable) | computed in the app: its cache read time (base: `app/src/shell/KernelStates.tsx`) |

### A message and its reply

| Field | Source |
|---|---|
| The owner's text; the agent's reply | base `012_brain_messages.ts: brain_messages.text, reply_text`, via `GET /threads/:agent` |
| "You · 14:06"; the reply's time ("Wright 14:07") | base `brain_messages.created_at`; `updated_at` once the reply is written (`status`) |
| Agent name and avatar | base `014_agents.ts: agents.display_name, avatar_shape, avatar_hue` via `GET /agents`; Wright's look is fixed in the app |
| "Reply to Wright · 14:03" on a reply, drawn joined to its thread | 17b item 1: the "continues" reference (a row id of the same agent), never `reply_to`; the time is the continued row's reply time (above) |
| "· continued" | 17b item 2: the row records the path, `resumed` |
| "· from the saved conversation"; "Continuing from the saved conversation" | 17b item 2: the path `replayed` |
| "N saved messages" in the fallback note | computed in the app: the message count (17b item 7) less the message just sent |
| "· started from the summary" | computed in the app: the thread is the one an old thread's summarized pointer names (17b item 6) |
| "Wright is replying · continuing this thread" / "· a new topic, in a fresh session" | computed in the app: base `brain_messages.status` (queued or running), plus whether the app sent a "continues" field (17b item 1) |

### Summarize & start fresh: the ⓘ panel, the preview, the new thread

| Field | Source |
|---|---|
| Messages so far | 17b item 7: message count (**open point 3**) |
| Each reply now reads "24,800 tokens", "input and cache" | 17b item 7: the tokens the latest reply read, input plus cache, from base `001_initial.ts: sessions.model_usage_json` (D26's counting) |
| With a summary: "about 900 tokens", `estimate`, "read from `memory/wright/threads/65.md`" | 17b item 7: the summary's size in tokens, estimated and marked as an estimate, when a summary file exists; the path is 17b item 5's (`memory/<id>/threads/<thread id>.md`) |
| With a summary: "Not written yet" | 17b item 7: no summary file, so no size is returned |
| Size hint in the panel ("Not set", "40,000 tokens · set by you", "this thread is past it") | 17b item 8: the owner setting, unset by default; only the owner sets it, so a value is "set by you". "Past it" is computed in the app: the latest reply's tokens (item 7) over the hint |
| Summarize highlighted, "past your size hint" | computed in the app, as above |
| "Wright is writing a summary of this thread: one short session" | computed in the app: its summarize request (17b item 5) is in flight; item 5 runs one short session and returns the summary without starting anything |
| Preview title "Summary of “<title>”" | 17b item 11: the thread's title |
| Preview text (Working on, Decided, Exact values, Open questions, Waiting on you) | 17b item 5: the summary's sections, returned as the file's markdown |
| "Saved as `memory/…/65.md` · about 900 tokens, an estimate · in place of 6 messages" | 17b item 5 (the path), item 7 (the estimate and the count) |
| `by Wright` / `edited by you` in the preview | computed in the app: the editor's state before Start fresh |
| "by Wright, edited by you" on the new thread's summary | **open point 4**: 17b item 6 writes the edited text back to the file but records no flag that the owner edited it |
| The new thread's summary at its top, "Kept as …" | 17b item 6: the new thread's first prompt carries the summary; item 5's file |

### Copy reference: the chip and a sent reference

| Field | Source |
|---|---|
| "Thread: <title> (n messages)" | 17b item 11 (title), item 7 (count, **open point 3**) |
| "· Mason", "· Wright" (another agent's thread) | base `brain_messages.agent`; the name from `agents.display_name` |
| The Full thread / Summary toggle, shown only when a summary exists | 17b item 9: the owner may send a thread's summary "when one exists"; item 7 tells the app one exists |
| Size, Summary: "about 900 tokens" | 17b item 7: the summary's estimated size |
| Size, Full thread: "4,200 tokens", "182,000 tokens" | **open point 1**: 17b names no field for a thread's full size the app can read before sending |
| "Reference limit 50,000 tokens · set by you" (`chat-reference-too-large`, where the owner saved it); the refusal "this thread is 182,000 tokens and your reference limit is 50,000 tokens. Nothing was cut and nothing was sent." | **open point 1**: 17b item 9 and AC10 bound each reference and refuse one past the bound with its size and the bound, but the bound is the kernel's, not an owner setting, and the refusal comes on send, not on paste |
| Sent reference: "Attached thread · sent to <agent> as quoted data, not as your words", "its summary · about 900 tokens", Show what was attached | 17b item 9: the message carries thread references, each sent as quoted history (`<untrusted-data source="thread:<id>">`), never as the owner's words; the size as above |

### Settings: the size hint and the reference limit

| Field | Source |
|---|---|
| Size hint value, "Now not set", "set by you", "Kept with your other settings in the kernel" | 17b item 8: an owner setting, stored with the owner's other settings, unset by default |
| "proposed by Wright · 40,000 tokens", Use Wright's proposal | **open point 2**: 17b item 8 says Wright may propose a value in a draft, never set it, but names no field that stores the proposal |
| Reference limit value, "Now not set", "set by you" | **open point 1** (the limit as an owner setting, unset by default) |
| "proposed by Wright · 50,000 tokens" beside the reference limit, its Use Wright's proposal | **open point 1**, and no stored source for the proposal, as in **open point 2** |
| "Not a number" refusal, Save, Discard, "Unsaved change" | computed in the app: its form state; the check mirrors a whole number of tokens above 0 |

### Sessions and Tasks: session names

| Field | Source |
|---|---|
| A session's name ("Set up a crew for my studio-sandbox tickets", "Merge when ready", "From Wright: Review PR #24 on studio-sandbox", "Create crew member: Sandbox Developer", "… (continued)") | 17b item 11: the session `title`, derived with no model call from what started it (an owner message's first line, a playbook's name, "From <agent>: <first line>", an approval's label, an old thread's title marked continued). Which rule made a title is not drawn: 17b returns the title, not its rule |
| "renamed by you"; "Your rename. It wins over “…”, the name the kernel derived." | 17b item 12: the stored rename wins; the derived title is item 11's |
| "Session 82 · Wright · 14:02 · 61,300 tokens"; running / completed; Model; Started; Tokens | base `GET /sessions`: `SessionSummary.id, agent, status, model, started, tokens` (`app/src/api/contract.ts`), from `001_initial.ts: sessions.*` |
| Thread: Open the thread / "None: this session isn't a thread" | base `012_brain_messages.ts: brain_messages.session_id` (a row ran in this session, or none did), then 17b item 3's thread id |
| "1 running · 9 today · 16:20", Running · 1, Finished today · 8 | computed in the app: counts over the list; the time is its clock |
| Tasks: "Session #108", badge, name, agent, time, tokens | base `GET /tasks`: `TaskBoardItem.kind, id, state, agent, started, tokens`; the name is 17b item 11's title |
| Tasks: "Playbook run #31", "Merge when ready", "Sandbox Developer · 16:18" | base `TaskBoardItem` for a run (`kind`, `id`, `playbook`, `agent`, `started`); the name from `013_playbooks.ts: playbooks.name` |
| Column counts | computed in the app |

### Approvals: the charter card and the fit check

| Field | Source |
|---|---|
| "Create crew member: <name>" / "Change crew member: <name>", the avatar, `#11` | base `011_phase_2_tables.ts: approvals.id, action` (`kernel_agent_create`, `kernel_agent_update`) and `payload_json` (the charter's `display_name` and `avatar`) |
| `proposed by Wright` | base `approvals.requesting_agent`; the create and update displays say "proposed by Wright" (`kernel/src/agents/charter-tools.ts`, `createHead`, `updateHead`) |
| `waiting on you`, `approved`, "You approved it." | base `approvals.status, decision` |
| From "Wright · 14:07" | base `approvals.requesting_agent, requested_at` |
| "in your thread “Set up a crew for my studio-sandbox tickets”" | base `approvals.requesting_session` joined to `brain_messages.session_id`, then 17b item 11's title (or the owner's rename, item 12) |
| Model, Limits ("300,000 tokens a day · 1 session at once", proposed by Wright), Workspace | the charter in base `approvals.payload_json`: `model`, `limits.tokens_per_day`, `limits.sessions_at_once`, `workspaces` (the display's `limits:` line marks each "(proposed)") |
| "What it may do in the kernel · 3 jobs"; each job's name, its "N tools" and its purpose lines | 16 Scope 1 and 3, AC3: the catalogue's job and purpose line per granted kernel tool, grouped by job; the counts are computed in the app |
| Other tools (Tools, Bash prefixes, Never), "shown as today" | base charter `tool_policy.allowedTools` (the non-kernel ones), `allowedBashPrefixes`, `never` (16 Scope 3: shown as today) |
| "Kernel tool names, as enforced" (create) | base `enforcedLine` (`charter-tools.ts`): the `enforced:` line with the `mcp__kernel__…` names |
| "Kernel tool names, as enforced" (update), first line `tool_policy: adds …` | base `updateDisplay` writes `tool_policy: <old> → <new>`; the mockup's "adds" wording is **open point 6** |
| "Drafted against `config/agents/sandbox-developer.json`", "sha256 3f9a1c07b2e4…" | base `updateHead`: "settings sha256 <first 12>" of `config/agents/<id>.json` (`kernel_agent_update`'s `expected_sha256`) |
| "Adds · 1 job" (`adds`), "Keeps · 3 jobs, unchanged" | 16 Scope 3 (grouped by job) applied to the update's `tool_policy` change; computed in the app from the old and new tool lists |
| "Connector grants stay yours to give in Team. This change asks for none." | 16 AC8: a connector grant is never proposed in a charter change |
| "From Wright · 16:05 · the fit check of Merge when ready (#14) found the gap" | 16 Scope 4 and AC4: the change is proposed in the same flow as the fit check. The link from #13 to #14 is **open point 5** |
| "Enable playbook: Merge when ready", `#14`, Runs as | base: a pending `kernel_playbook_enable` approval (`kernel/src/playbooks/enable.ts`) with `013_playbooks.ts: approvals.playbook`, `playbooks.name`, `owning_agent` |
| Repo `vikashruhilgit/studio-sandbox` | base `011_phase_2_tables.ts: triggers.spec_json` for the playbook's trigger (phase 8's precedent) |
| Fit check "Wright's dry run · 16:04" | base `013_playbooks.ts: playbook_runs` with `kind = 'dry_run'`, `ended_at` |
| The gap: "This playbook needs *Ask for a merge*; Sandbox Developer doesn't have it." | 16 Scope 4, AC4: the missing job, in plain words, from the catalogue |
| "Wright's dry run of this playbook called these, and the charter refused them", the refused tools' purposes | 16 Scope 4 names a dry run's policy refusals as one candidate source; choosing it is **open point 5** |
| "Wright has held the charter change that adds it beside this card, #13"; "Approve #13 first" | **open point 5** |
| Enable disabled while the gap is open; Enable anyway; "Either choice is recorded"; "enabled with the gap open · recorded" | 16 AC4: the playbook can't be enabled until the gap is closed or the owner enables it anyway, and that choice is recorded |
| "No gap. Sandbox Developer has every job this playbook needs: Ask for a merge, Read a PR." | 16 Scope 4: the fit check with no missing tool; the job names from the catalogue |

### The sidebar

| Field | Source |
|---|---|
| Crew rows: name, avatar | base `014_agents.ts: agents.*` via `GET /agents`. At 14:22 both members are still held creates and have no row: **open point 7** |
| Crew rows: last line ("Waiting on its charter approval", "PR #24 parked, awaiting merge") | base `GET /threads/:agent` (the newest item), as in `phase-8.html`; at 14:22, **open point 7** |
| Sidebar footer: idle / kernel unreachable | the app's connection state (base `app/src/shell/KernelStates.tsx`) |

### Open points the field map raised

The numbers match `docs/DESIGN.md` §"Open points for the owner (thread continuity)". Points 1–4 are fields with no named source in 17b. Points 5 and 6 are item 16 differences. Point 7 is sample data.

1. **A referenced thread's full size, and the reference limit as an owner setting.** 17b names a summary's size (item 7) and a bound on each reference (item 9), but no full-thread size the app can read before sending, and the bound is the kernel's, not an owner setting. The mockup draws it as an owner setting, unset until saved, with Wright's 50,000 beside it as a proposal.
2. **Wright's size-hint proposal (40,000) has no stored source.** 17b item 8 lets Wright propose and never set, and names no field for the proposal.
3. **What one "message" counts.** The mockup counts each owner message and each reply (three exchanges are "6 messages"); 17b item 7 does not say whether the count is of `brain_messages` rows or of both sides.
4. **"Edited by you" on a started summary has no stored source.**
5. **Where the fit check learns a run's needs, and the link from a gap to the change that closes it.**
6. **The update card's raw line** reads `tool_policy: adds …`; the kernel's update display writes `tool_policy: <old> → <new>`.
7. **The 14:22 sample data draws two crew members before their charters are approved**, and a 212-message thread of Mason's.

## Defects found and fixed in the mockup

**Iteration 1 (code review on PR #249).** Each fix covers every place the same defect appeared, in Chat and the Crew thread:

1. **Summarize was drawn on every thread but always summarized one.** Summarize on thread 70 opened thread 65's summary and Start fresh marked 65 Summarized (90 for 93 in Crew). Now Summarize on a thread with no drawn summary, or on the drawn one once it is summarized, says so in the note instead, as the sidebar does for Mason's thread. No view's picture changed.
2. **The summary wait could stick.** Its timer gave up when the view key had moved (a send, or the chip toggle, re-keyed the view during the wait), leaving Summarize disabled and "is writing a summary" on screen for good. Now only a view change cancels the wait; otherwise the flag is cleared and the preview opens. Send waits while the summary is written, and the line says so ("Nothing new starts until you choose, so Send waits."). Pictures changed: `chat-summarizing`, `crew-summarizing`.
3. **The reference limit was Wright's proposal in force, credited to the owner.** The chip refused at 50,000 before the owner had saved anything and said "your reference limit". Now the limit is unset by default, with Wright's 50,000 beside it as a proposal and its own Use Wright's proposal, as the size hint is (invariant 1). `chat-reference-too-large` is the view where the owner has saved 50,000 ("set by you"). Pictures changed: `chat-reference-too-large`, `settings-threads`, `settings-threads-edit`, `settings-threads-invalid`, `settings-threads-set`. `docs/DESIGN.md` open point 1 and the field map say the same.
4. **Closing the preview mislabelled the view.** It always set `…-threads`, even with the Reply strip or a rename field still open. Now the preview closes onto the key Summarize was clicked on, kept with whatever changed beneath it during the wait (`S.under`); a forced preview closes onto `…-threads`. Start fresh ends the Reply strip and an unsaved rename (both belong to the old thread) and lands on `…-fresh`, or on `…-reference` / `…-reference-summary` while a chip is attached. The views' `after` prop is gone. No view's picture changed.

**Iteration 2 (code review on PR #249):**

5. **The view key could still name a state other than the one on screen.** Fix 4 covered the preview; every other click still named its result by hand, so the mislabel survived elsewhere. Saving only the reference limit kept `settings-threads` (reloaded, it read "Now not set"); saving both gave `settings-threads-set`, which has no limit; a refused limit stayed on `settings-threads`. Start fresh with Mason's refused chip (thread 31) landed on `chat-reference`, and a message sent with the rename field open landed on `chat-plain-sent`. The cause was the mechanism, not the cases: each action wrote its own key. Now no action writes the key. Every render compares the state with what each view of the same screen forces (`relabel()`, with each view's forced state built by the same `forcedState()` that `setView` applies), and the hash names the view that reproduces the screen. Typed words and numbers are not compared. A state no view forces (two flows open at once, a decision on a card no view decides) gets the nearest view: thread contents and an open rename field first, then the fewest other differences, the current key on a tie. `S.under`, `curKey()`, `setKey()` and `vk()` are gone. Four views were added so every single-field Settings outcome has a key: `settings-threads-ref-edit`, `settings-threads-ref-invalid`, `settings-threads-ref-set`, `settings-threads-both-set`. Pictures changed: all 98, because the four new buttons sit on the review strip every image shows; a pixel comparison of the window area (the top 905px) of the 90 old and new images found no difference except the spinner's frame in `chat-summarizing`.

**Subtasks 1–3:** none. Subtask 3 changes no HTML except to fix a defect it finds, and this pass found none to fix: the token diff, the greps, the 161 driven assertions and the contrast audit all held against the file as committed by subtasks 1 and 2 (`5ec7f22`, `a13846f`). The field map's gaps are listed as open points for the owner rather than removed, because each is a design choice the owner may keep (AC5 allows either).

## Found, not changed

- **The sample data at 14:22** (open point 7). The sidebar lists Sandbox Developer and Mason while both charters wait in Approvals, and the too-large reference is Mason's 212-message thread. The data does this so the crew sidebar and a cross-agent chip are drawn in the Chat views. 17c reads real data.
- **The window clips a long body at 760px** (see Screenshots). `approvals-charter-create` shows #11 down to its Other tools heading, so #11's raw-names disclosure and actions and all of #12 are below the cut (`approvals-charter-raw` scrolls to #11's disclosure). `approvals-charter-update` shows all of #13 and the top of the enable card #14, and `chat-long` shows the newest part of the thread with the highlighted Summarize, its header above the cut. All of it is there on scroll.
- **Rendering was spot-checked by eye on ten screenshots** (`chat-threads` light, `chat-preview` dark, `chat-reference-too-large` dark, `chat-long` dark, `crew-reply-fallback` light, `settings-threads` dark, `sessions-names` light, `approvals-charter-create` dark, `approvals-charter-update` light, `approvals-fit-gap` light), not all 90. Contrast was measured in code for every view in both themes, not by eye, and the driven paths check behaviour, not looks.
