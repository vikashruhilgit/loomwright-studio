# 23l — A stranded run is visible and resumable

## Status: in_progress

**Observed live (2026-11-17, right after session 214).** Session 214 ended `completed` (`result_success`) mid-item, after the 23k denial. It left:
- `automate-2026-11-17-001.md` at `## Status: running`, with the cheer.sh item `status: running`;
- `.supervisor/run.lock/meta` naming pid 32853, which is no longer running.

So:
- the kernel's `summarizeRuns` reads the run as `live` (a `running` run file), so every launch is refused `run_live`;
- `GET /automate/paused-runs` lists only `paused` runs, so the Parked run card disappeared.

The run is stuck and invisible, and nothing in Studio can continue it. Loomwright's own `--resume` reconciles a run like this (a dead lock holder).

**Ask.** A run whose file says `running` while no lock holder is alive and no kernel run session for its checkout is live is shown as stranded on the Parked run card and is resumable through the same Resume (`--resume <run_id>`). A run with a live lock holder or a live kernel session stays `run_live`.

**Fix (branch `fix/service-path-gh-git`, uncommitted).** `pausedRuns` lists a `running` run with no live lock holder as `stranded: true`; `resumeWouldDoubleDrain` blocks only on a live holder or another `running` run; the Parked run card badges it `stranded`. Tests in `kernel/test/automate-resume.test.ts`. Not yet verified live.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-28T07:31:59Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/291
