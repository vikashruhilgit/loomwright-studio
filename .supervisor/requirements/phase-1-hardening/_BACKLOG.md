# Phase 1 hardening backlog

**Status: done 2026-10-05.** Run `automate-2026-10-03-180512` merged all six items, each after an approving review: H01 #23, H02 #25, H03 #27, H04 #29, H05 #31, H06 #33. Phase 1 itself is not done until the owner's live exit run (`docs/OPEN_QUESTIONS.md`, "Phase 1 exit: live run") passes.

These items harden the phase 1 kernel. They come from the 34 review findings that run `automate-2026-09-30-211858` dismissed as below the severity floor. Those 34 are 32 distinct findings, because two pairs were duplicates. On 2026-10-03 each one was re-checked against `main` at 4429d4b:

- **30** are still present or partially present, and every one of them is in an item below.
- **2** were already fixed by later PRs and are left out:
  - F05-4, the reaper reading EPERM as "foreign" (fixed in item 05's `#killUntilGone`);
  - F05-6, the ARCHITECTURE session-manager bullets.

Each item is one story file in this folder and becomes one reviewed PR. Run it with Loomwright:

```
/automate --backlog .supervisor/requirements/phase-1-hardening/_BACKLOG.md
```

Use safe mode (no `--auto-merge`): `main` requires an approving review.

**Order:** H01 goes first, because the owner's live exit run and the Keychain-under-launchd check depend on it. H02 and H03 are next; both protect the safety kernel. H04–H06 follow. The items are otherwise independent, except that H03 and H05 each add a store migration, so the later one takes the next free number.

**Rules for every item:** these are the same as phase 1.

- Read `CLAUDE.md` (invariants) and `docs/DECISIONS.md` first.
- Unit tests never call the real SDK, a model, `launchctl` or the Keychain.
- Live tests are opt-in (`STUDIO_LIVE=1`), use Haiku, and never run in CI.
- Line numbers in each item's Evidence section are as of 4429d4b. Find the code by content if they have drifted.

| Item | Findings | Size |
|---|---|---|
| H01 launchd start failure and reinstall | F09-1, F09-2, F09-3, F09-4 | S–M |
| H02 credential env and auth health | F04-1, F04-2, F04-3, F04-4, F04-5 | S–M |
| H03 store integrity | F03-1 … F03-6 | M |
| H04 session manager hardening | F05-1/3, F05-2/7, F05-5, F05-8, F08-1, F08-2 | M |
| H05 budget cap park keys | F06-1, F06-2, F06-3 | M |
| H06 event loop correctness | F07-1 … F07-6 | S–M |

- [x] .supervisor/requirements/phase-1-hardening/01-launchd-start-failure-and-reinstall.md
- [x] .supervisor/requirements/phase-1-hardening/02-credential-env-and-auth-health.md
- [x] .supervisor/requirements/phase-1-hardening/03-store-integrity.md
- [x] .supervisor/requirements/phase-1-hardening/04-session-manager-hardening.md
- [x] .supervisor/requirements/phase-1-hardening/05-budget-cap-park-keys.md
- [x] .supervisor/requirements/phase-1-hardening/06-event-loop-correctness.md
