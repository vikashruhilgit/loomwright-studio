# Phase 1 live-run fixes

The owner's first live exit run (2026-10-06, `main` at 77775c8) failed. Its findings are recorded under "Phase 1 exit: live run", step 6, in `docs/OPEN_QUESTIONS.md`. One combined item (H07+H08, owner decision 2026-10-06) fixes what it found, as one PR; after it merges, the owner repeats the live run.

Run with Loomwright, in safe mode (`main` requires an approving review):

```
/automate --backlog .supervisor/requirements/phase-1-live-run/_BACKLOG.md
```

**Order inside the item:** part A (launchd install) first, so the kernel can run under launchd at all; then part B (tool process containment), whose live test uses the fixed install.

**Rules for every item:** same as phase 1.

- Read `CLAUDE.md` (invariants) and `docs/DECISIONS.md` first, including D31.
- Unit tests never call the real SDK, a model, `launchctl` or the Keychain.
- Live tests are opt-in (`STUDIO_LIVE=1`), use Haiku, and never run in CI.
- Line numbers in the Evidence sections are as of 77775c8. Find the code by content if they have drifted.

- [ ] .supervisor/requirements/phase-1-live-run/07-live-run-fixes.md
