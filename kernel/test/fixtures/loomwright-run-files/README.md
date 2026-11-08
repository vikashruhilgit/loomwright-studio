# Loomwright run-file fixtures

Run files as Loomwright 17.34.2 writes them (`skills/automate-loop/run-file.md`), cut down to what the kernel reads. They back `kernel/test/automate-runner.test.ts` and `kernel/test/automate-merge-check.test.ts`, which copy one scenario folder into `<checkout>/.supervisor/automate/` of a temp directory.

Every pull request is `https://github.com/o/r/pull/7` (a fictitious repo), and every head is forty `a`s.

| Folder | What it holds | The kernel reads it as |
|---|---|---|
| `live/` | one run, `## Status: running`, its item `running` with no PR yet | `live` (run id `2026-11-09-100000-stories`) |
| `parked/` | one run, `## Status: paused`, its item `awaiting_merge` at PR 7, with a `ready_sha`, `ready_at` and `termination_reason` line; plus the run's `.supervisor-result.md` sidecar, which sorts after the run file and has no title | `parked` (run id `2026-11-08-072502-stories`) |
| `done/` | one run, `## Status: done`, its item `done` | `idle` |
| `escalated/` | one run, `## Status: paused`, its item `escalated` at PR 7 | `parked`, but not `awaiting_merge` |

The sidecar in `parked/` is the trap probe p15 hit: its probe took "the last `.md` in the folder", which was the sidecar. A run file is found by its `# Automate Run:` title line, never by name or position.

The run lock (`.supervisor/run.lock/meta`, `scripts/run-lock.sh`) is not a fixture file: its `pid` must name a live or dead process, so the tests write it.

If Loomwright changes the run-file format, update these files from a real run file (probe p14's record in `docs/OPEN_QUESTIONS.md` quotes one), then the parser in `kernel/src/automate/run-state.ts`.
