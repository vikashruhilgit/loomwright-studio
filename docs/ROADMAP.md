# Roadmap

Every phase ends with a check **in the running system**, not just a test pass. Phases 0–6 make up the spike: they prove the core idea (a generic kernel plus self-authored behaviour) before anything posts or merges.

| # | Phase | Done when |
|---|---|---|
| 0 | **Design:** design system + hi-fi mockups of every screen (`UI.md`) | The owner approves the mockups |
| 1 | **Kernel:** repo scaffold, SQLite schema, event loop, session manager (Agent SDK), lifecycle tools, budget meter, audit log, loopback API, `studio status` CLI | Killing the daemon mid-session with `kill -9` and restarting it resumes from disk with no duplicated work |
| 2 | **Brain + Loomwright adapter:** role and memory files, kernel tools, approval gate (CLI), capability manifest, changelog comparison | `studio ask "remind me at 5pm to check X"`: Wright creates the trigger itself and it fires at 5pm. A Loomwright version change produces a "new features" note |
| 3 | **Self-authored playbooks + dry run** | A plain-English request becomes a stored playbook whose dry-run output is shown before it's enabled; dedupe key, priority and model come from the user, with Wright only proposing defaults |
| 4 | **Agent roster:** identities, per-agent memory, permission policy, budget | A specialist created from chat can do only what its policy allows. Tested: a comment-only reviewer can't push |
| 5 | **GUI v1:** menu bar, Chat, Team, Approvals, Sessions (stop/kill) | Everything in phases 2–4 can be done from the app, with nothing typed in a terminal |
| 6 | **Integrations screen (GitHub first) + acceptance test 1:** PR-review duty built from one sentence, in **draft mode** (no posting) | Works against the owner's **personal** repos; unchanged PRs are skipped according to the user-set dedupe key; an injection planted in a PR body is ignored |
| 7 | **GUI v2:** Tasks, Playbooks, Schedules, Memory, Hooks, Budget, Integrations, Settings | Each screen passes its polish gate |
| 8 | **Acceptance test 2:** tickets → PRs → 2 approvals, run through Loomwright `/automate` | A PR is tracked through its states; comments are triaged (fix / reply / answer); reviewers are re-requested; merge only through the gated path |
| 9 | **Hook management + more connectors** (Slack, …) | Propose → apply with backup → **verified to fire** → recorded; project scope first |
| 10 | **Always-on host** | The same kernel runs on an always-on machine or VM; the app connects over an authenticated tunnel; works with the laptop closed |
| — | **Commercial readiness** (only after daily dogfooding proves value) | Lawyer review, trademark clearance, CLA, signing/notarisation, auto-update, onboarding, API-key/Bedrock/Vertex auth live-tested, security review + injection testing |
