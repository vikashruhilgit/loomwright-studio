# 23i — Handovers made before a run starts all reach that run

## Status: proposed

**Observed live (2026-11-17, walk step 1, kernel `7ed3f0cd` as the launchd service).** Three crew sessions prepared tickets for the same checkout, `~/studio-work/studio-sandbox`, within two minutes:
- Session 210 (playbook 17) prepared issue #18, launch event 348.
- Session 211 (playbook 18) prepared the README task 86bd2djuq, event 349.
- Session 212 (playbook 18) prepared the cheer.sh task 86bd3z76t, event 350.

The run that started (session 213, from event 348) read a `_BACKLOG.md` that listed only the cheer.sh item, and its run file queued only that item. Events 349 and 350 were marked `event_done` 2 s after session 213 started, with no session. Their reason is stored only in `work_steps` (`event:349:automate-run` and `event:350:automate-run`: `skipped: run_session_live: session 213`), with no notify, so the owner never sees it. Issue #18 and the README task now have item files but appear in no backlog and no run.

**Mechanism (code read plus the observed files).**
1. `writeTicketItems` (`kernel/src/automate/tickets-to-items.ts`) `replaceFile`s `_BACKLOG.md` with only the tickets of the current handover, so the last of several handovers made before a run starts wins.
2. The later launches are skipped while a run session for that checkout is live (`launch.ts`: `run_session_live` / `run_live`), and the skip is stored only in `work_steps` with no notify, so the dropped tickets are invisible to the owner.

**Ask.**
- A ticket handed over is either in the run that drains the checkout's backlog or visibly not, never silently dropped.
- Candidates: the backlog keeps unchecked items from earlier handovers (merge, not replace), and a skipped launch records its reason where the owner sees it.
- Kernel mechanism only. Which tickets to hand over stays playbook policy (invariant 1).
