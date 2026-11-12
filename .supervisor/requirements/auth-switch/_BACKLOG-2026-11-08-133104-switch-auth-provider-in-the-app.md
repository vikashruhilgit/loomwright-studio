# Backlog: Switch the auth provider in the app

## Why now
Switching between subscription billing and API credits today means using a terminal (`security add-generic-password …`, then `STUDIO_AUTH_PROVIDER=api-key studio service install`), and Settings → Auth provider is read-only. The owner asked on 2026-11-08 to do this in the app: enter credentials, switch providers, and restart the kernel.

## Checklist
- [ ] 2026-11-08-133104-real-api-key-session-probe.md
- [ ] 2026-11-08-133104-decision-and-contract-for-switching-auth-in-the-app.md
- [ ] 2026-11-08-133104-kernel-saves-credentials-and-applies-an-approved-provider-switch.md
- [ ] 2026-11-08-133104-settings-credential-entry-provider-switch-and-restart-kernel.md
- [ ] 2026-11-12-121226-chat-shows-working-and-where-replies-land.md

## Order
1. Auth 2 (decision D42 + contract, mockup, `501` stubs) and, alongside it, Auth 1 (real-key probe, owner-run by hand, not automatable: real credential). The owner approves D42 in Auth 2's review.
2. Auth 3 (kernel) and Auth 4 (app) in parallel: disjoint Touches, both build against Auth 2's contract. Auth 3 also depends on Auth 1: it cannot merge until the probe evidence is committed, and it adds that citation to D42.
3. Chat 1 (added 2026-11-12, from the 19a walk): the title row shows "working" while an approval waits, a clearer working mark ("two rings sliding through", decided with the owner), and a link from a card's Ask or change to Wright's reply. It depends on nothing and shares no file with Auth 2–4, so it runs in wave 1 beside Auth 2.

## Run
Two waves: [Auth 2 ∥ Chat 1 ∥ Auth 1 (owner)] → [Auth 3 ∥ Auth 4]. Queue Auth 2–4 and Chat 1 through `/automate`; Auth 1 is done by hand during wave 1.

## Considered and not queued
- Rewriting the launchd plist on switch. The persisted choice lives in the data dir instead, and an env/flag pin refuses a switch rather than being silently overridden.
- An unheld direct switch with only a confirm dialog. Not queued because the owner chose the approval path.
- Folding Auth 1 into a phase exit-run item. right-size suggested this because they share `docs/OPEN_QUESTIONS.md`, but the probe is a prerequisite with its own owner-run evidence.

## Revisit when
- Bedrock or Vertex providers land (D16): they would join the same switch.
- A distributed build ships: re-check D29's token-free path end to end.

## Owner decisions
- 2026-11-12: add Chat 1 to this backlog; running it in the same wave as the auth items is fine. Its working mark is "two rings sliding through" (reference mock `2026-11-12-121226-working-mark-mock.html`).
