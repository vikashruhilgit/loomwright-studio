# Open questions

## Owner to-dos (legal and commercial, before any launch)

- [ ] **Employment IP clause.** Read the Tray employment agreement sections on "Intellectual Property", "Inventions" and "Work Product": does the company own work made on company time or equipment, or related to its business (AI dev tools)? Is there a prior-inventions list? Until then, build Studio only on a personal machine, personal accounts and personal time, and never test against `vendsy/*` repos.
- [ ] **Trademark search for "Loomwright Studio".** Search WIPO Global Brand Database, India IP Office, USPTO and EUIPO in Class 9 (software) and Class 42 (SaaS). A lawyer should do the final clearance.
- [ ] **Lawyer review** of the PolyForm Shield choice and of the `Required Notice` / `Licensor Line of Business` lines, before selling anything.
- [ ] **AI-assisted code and copyright.** Much of the code is AI co-written, and how far copyright protects it is legally unsettled. Raise this with the lawyer.
- [ ] **CLA** before accepting any outside contribution.
- [ ] **Loomwright PR vikashruhilgit/loomwright#289** (relicense to Shield) needs the owner's approving review to merge.

## Technical: verify, don't assume

Each of these needs a probe of the real SDK or CLI, with the finding recorded.

- [ ] **Does the Agent SDK load installed Claude Code plugins** (Loomwright's agents, commands, skills, `hooks.json`) for SDK sessions? The current SDK docs list "Plugins: load by local path" and "Skills, commands, and memory: load from `.claude/` and `~/.claude/`". Loomwright's spike (SDK 0.3.202) marked hooks.json firing and skills preload/memory as NEEDS VERIFICATION.
- [ ] **Does the TS SDK bundle the Claude Code binary**, so a fresh install needs no separate Claude Code install? Loomwright's spike says yes; re-confirm on the current version (0.3.283 was the latest on 2026-09-26).
- [ ] **Subscription auth from the SDK.** Confirm the SDK picks up the machine's existing Claude Code login for the personal build, without any Studio login UI.
- [ ] **Cap-hit signal.** The exact error or message the SDK surfaces when the subscription weekly limit is hit, so the kernel can park until the reset.
- [ ] **Usage reporting.** Does the SDK result's `usage` accumulate per query or report the last turn only? Is `total_cost_usd` per query? (Carried over from the spike's live checklist.) This now also gates D24: per-agent token limits need a reliable per-session token count from the SDK, and the kernel must sum it itself since nothing exposes the subscription's remaining quota.
- [ ] **Background sessions.** Whether the kernel should drive `claude --bg` sessions or SDK `query()` sessions, or both. Decide in phase 1 from a probe.

## Deferred decisions

- Whether Loomwright should publish a machine-readable `capabilities.json` per release (proposed in D13). That would be a change in the Loomwright repo.
- Tauri instead of Electron, revisited only if mobile or wide distribution becomes a goal (D10).
- The pricing model at commercial launch (bring your own key vs metered), deferred until after dogfooding.
