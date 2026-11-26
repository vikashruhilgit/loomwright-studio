# 23j — The owner can resume a parked run

## Status: proposed

**Observed live (2026-11-17, after the 23h fix was installed, plist `PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`).** Run `automate-2026-11-17-001` in `~/studio-work/studio-sandbox` is `paused` (`trail_pr_open`, the 23h cause, now gone), and nothing in Studio can start it again.
- A kernel run launch comes only from `kernel_automate_prepare`, which only a crew session calls, and a crew session wakes only for a poll item that isn't a duplicate.
- Both playbooks dedupe on `playbook.id + item.id` (owner policy), so every poll since 06:18 UTC logged `poll_item_skipped` for #17, #18, 86bd2djuq and 86bd3z76t.
- Wright's tools (`kernel_*`) include no resume, and the owner has no route or card action that resumes a run.

**Ask.** The owner can resume a parked run from Studio without touching kernel internals, for example a Resume action on the parked run, which queues the same kernel launch (`/automate --backlog <path> --inline-phases`, safe mode) that `kernel_automate_prepare` queues. It must keep the single-drain checks (`run_live`, `run_session_live`). This is kernel mechanism; when to resume stays the owner's call. Pairs with 23i: a ticket that was dropped from a backlog also needs a way back in.
