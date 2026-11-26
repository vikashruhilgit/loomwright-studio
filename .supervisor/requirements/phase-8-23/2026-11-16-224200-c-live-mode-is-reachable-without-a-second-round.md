# 23c — Live mode without a second dry run, approval and wrong advice

## Status: proposed

**Observed live (2026-11-16, walk step 1).** For each ticket playbook (17, 18): Wright cannot create a playbook in live mode ("only the owner can set that"); the app only offers Live once the playbook is on ("Live can only be chosen on a playbook that is on"); setting Live writes a new draft version that needs its own dry run and enable approval. So each live playbook took two dry runs (about 126k–190k tokens each, on Sonnet) and two enable approvals (47+48, 49+50). Wright also told the owner twice to set live with the CLI (`studio playbooks set 17 mode live`), "the card shows the mode but doesn't edit it", while the playbook page has a Draft/Live control with a confirm (`app/src/screens/playbooks/PlaybookEdit.tsx`).

**Ask.** One owner decision reaches a live, enabled playbook (for example the enable card carries the mode the owner chooses, or Wright may propose live in the draft the owner approves), with one dry run; Wright's guidance names the app's control, never a CLI command (see memory: the owner never handles kernel internals).
