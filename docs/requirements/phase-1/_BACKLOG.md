# Phase 1 backlog: the kernel

Build order for phase 1 (`docs/ROADMAP.md`). Each item is one story file in this folder and becomes one reviewed PR. Run it with Loomwright:

```
/automate --backlog docs/requirements/phase-1/_BACKLOG.md
```

Safe mode (no `--auto-merge`): every PR stops at review-ready, and the owner approves and merges it (`main` requires an approving review).

**Phase exit:** killing the daemon mid-session with `kill -9` and restarting it resumes from disk with no duplicated work (item 09).

**Preconditions:** PR #3 (SDK probes, D26–D29) is merged. The owner's `claude setup-token` token is in the Keychain as `loomwright-studio-oauth` (it's needed only by the opt-in live tests).

**Rules for every item:** read `CLAUDE.md` (invariants) and `docs/DECISIONS.md` first. The probe findings in `docs/OPEN_QUESTIONS.md` are requirements, not suggestions. Unit tests never call the real SDK or a model; live tests are opt-in (`STUDIO_LIVE=1`), use Haiku, and never run in CI.

- [ ] docs/requirements/phase-1/01-architecture-sync.md
- [ ] docs/requirements/phase-1/02-kernel-scaffold.md
- [ ] docs/requirements/phase-1/03-sqlite-store.md
- [ ] docs/requirements/phase-1/04-auth-providers.md
- [ ] docs/requirements/phase-1/05-session-manager.md
- [ ] docs/requirements/phase-1/06-budget-meter-and-cap.md
- [ ] docs/requirements/phase-1/07-event-loop-and-kernel-tools.md
- [ ] docs/requirements/phase-1/08-loopback-api-and-cli.md
- [ ] docs/requirements/phase-1/09-launchd-and-crash-resume.md
