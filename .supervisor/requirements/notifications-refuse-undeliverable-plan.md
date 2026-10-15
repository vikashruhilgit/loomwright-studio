# Task Plan: notifications-refuse-undeliverable (item 11)

Source brief: .supervisor/jobs/in-progress/2026-10-15-notifications-refuse-what-they-cannot-deliver.md
Base: 95d31567140e3101e029cd985b7895a5b7fee8a1 (main). Persistence: file fallback (Beads not active).
Decomposition: ONE task (Decomposition Threshold default; none of the three split reasons applies).
Gate: deterministic outputs_verified + typecheck/tests/check-docs; Phase 4.5 integrated review once after FINALIZE. No per-subtask review.

## EPIC notifications-refuse-undeliverable
- [ ] **notifications-refuse-undeliverable-1** - Notifications hardening (all acceptance criteria in the brief)
  - Blocked by: nothing
  - Order inside the task (the probe result decides one code branch):
    1. Probe by hand: `printf '' | /opt/homebrew/bin/terminal-notifier -title ...` (empty stdin body). Record the exact command, exit status and output in docs/evidence/phase-2-notifier-probe.md. Then either refuse empty body at record time / handle it in notifier.ts (keep the body off argv), or, if the exit is 0, pin stdin `""`.
    2. Re-run probes/p11-notifier-under-launchd.mjs. Replace section 1's verbatim output with the dated run and its versions, and re-check the read-off bullets. Use the /Users/<name>/ placeholder. Leave section 4 untouched.
    3. NUL refusal: record.ts (InvalidNotificationError, before store.transaction) + tool.ts zod refinement on title/body (error text names the field).
    4. printable: add the \uNNNN escape for U+202A-202E, U+2066-2069, U+061C, U+200E, U+200F, U+2028, U+2029 (lower-case, 4 digits, same form as approvals/cli.ts shown()). Keep the C0/C1 \xNN regex byte-for-byte.
    5. Tests (kernel/test/notifications.test.ts, stubExec only): NUL x {record, tool} x {title, body}; bidi/separators in show and list; empty-body pin; interrupted redelivery (row pending + step failed:interrupted -> failed/interrupted, notifier not called, one notification_delivery_failed); show with a null session / a missing session row.
    6. notifier.ts spawnNotifier comment: name the three settle paths and give the worst case with its derivation (timeoutMs + KILL_GRACE_MS, since DRAIN_MS 250 < KILL_GRACE_MS 1000), or whatever bound the code actually implements.
    7. docs/architecture/notifications.md API-and-CLI section: text views use \xNN / \n / \uNNNN; --json is raw JSON.stringify output.
  - Verify: `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh`; apply each Pin-mutation row and confirm its test goes red.
  - Skills: skills/unit-testing/SKILL.md, skills/quality-checklist/SKILL.md
