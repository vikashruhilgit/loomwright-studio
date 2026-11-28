# 23p — A raised limit wakes the work it held; avatars move only for live work

## Status: in_progress

**Limit (observed live 2026-11-17).**
- The owner's Resume (queue 601) was parked `playbook_daily_limit` until 18:30Z.
- The owner raised playbook 18's `token_limit` to 3,000,000 (version 3, now `draft`). Nothing woke the held event.
- Fix: `wakeLimitHeld` (`kernel/src/playbooks/store.ts`) runs on an owner `token_limit` change and on an enable. It wakes the playbook's pending events whose latest park was `playbook_daily_limit`; admission then asks the budget again.
- Tests: "enabling a playbook wakes what its daily limit held" in `kernel/test/automate-resume.test.ts`.

**Not a bug: a launch checks `mode` only.** I suspected a `draft` playbook with `mode live` should not launch runs. `kernel/test/phase-8-exit.test.ts` keeps the triage and merge playbooks live by mode while they stay drafts, because they run on the owner's ask, not on a trigger. So `status: enabled` means "its trigger runs", and the launch is right.

**Avatars (measured live).** With Studio visible on Tasks, the renderer ran at about 69% CPU with motion on and about 0.7% with Reduce motion on.
- Fix: `Avatar`'s `idle` motion is opt-in (`live`). The crew list, Team cards and inspector pass it for crew that is on.
- Avatars off screen are paused through one shared IntersectionObserver.
- Tests:
  - `Avatar.test.tsx`: the still rule covers every part the reduced-motion block stops.
  - `TasksScreen.test.tsx`: the number of moving avatars is the same with 3 or 60 finished cards. It fails without the change.

**Avatars, second cause (measured live 2026-11-18).** After the fix above, Tasks still held about 38% while visible, with only 4 animations running. Earlier injection tests had proved nothing: the page's CSP (`style-src 'self'`) silently blocks an injected `<style>`. Rerun with constructed stylesheets:
- Pausing everything: 38% → 0%. Pausing only the animations inside the SVG, with the HTML ring still moving: 38% → 3%. A compositing layer or `contain: strict` per avatar: no change.
- Cause: a transform on an SVG `<g>`, or a stroke dash offset, has no compositor path. Each display frame (120 Hz) runs style, layout and paint for the whole page on the main thread, and a Tasks frame costs about 10 ms.
- Fix: drift, rig, tail and the stitch ring are HTML layers (`Avatar.tsx`, `VIEW_BOX`/`originOf`), so their transforms run on the compositor. Origins and translations are percentages of the 36-unit viewBox. The ring's running dashes became a rotation at the same speed along the circle.
- Owner's call: the working outline dashes (`run` on `.st`/`.ln`) stay still. One working avatar's dashes alone cost about 34% (about 10% stepped).
- Result: 4 animations at 7% (was 38%); with 2 working avatars added, 14% and 0 main-thread paints.
- Test: `Avatar.test.tsx` "every transform animation targets an HTML layer". It fails on an in-SVG transform animation or any non-transform/opacity keyframe, checked with both.

<!-- loomwright:requirement-closeout -->
## Status: done_with_escalation
- **Completed:** 2026-11-28T07:32:04Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/291
- **Owed:** live check: raising a playbook token_limit wakes an event parked playbook_daily_limit (tests only; the avatar half was measured live)
