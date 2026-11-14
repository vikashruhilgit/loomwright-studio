# 21b — A crew member's tracker grant is chosen, shown and flagged in plain words

**As** the owner of Loomwright Studio,
**I want** the Team inspector to show what a crew member may do in words, and the creation of a ticket-working member to tell me it has no tracker access and let me grant it there,
**so that** I never read or tick raw kernel tool names, and a member like Ticket Runner never reaches its first ticket unable to read it.

## Why

Found 2026-11-14 during phase 8 item 21a's Validation 2 walk, verified at PR #275's head `140076a6`. Ticket Runner (`ticket-runner-20c`), which Wright created to work ClickUp tickets, has no ClickUp grant, and nothing at creation said so. Owner rule: the owner never handles kernel internals, so a step that needs raw tool names is a product gap.

**1. The Team inspector shows kernel internals.**
- PERMISSIONS (`app/src/screens/team/Inspector.tsx`, `Enforced`) lists `policy.allowedTools` as raw names (`mcp__kernel__kernel_automate_prepare`, …), and Bash prefixes and `never` the same way.
- CONNECTORS (`app/src/screens/team/Connectors.tsx`, `McpRow`) asks the owner to tick ClickUp access from one checkbox per raw tool name: the connection's `granted_tools`, about 58 for ClickUp (`clickup_get_list`, `clickup_send_chat_message`, `clickup_delete_task`, …). Nothing groups them by what they allow, or marks which write or delete.
- Phase 8 item 16 fixed this for the held charter card only. `CharterDisplay` (`app/src/screens/approvals/CharterDisplay.tsx`, built from `charterBlocks.ts`) shows the granted kernel tools by job in words first, with the raw lines beneath under "Kernel tool names, as enforced". The inspector never got that treatment.

**2. Creation never flags the tracker grant.**
- Job `automate_tickets` ("Hand tickets to /automate") declares only a workspace and `/loomwright:automate` (`kernel/src/features/catalogue.ts:91`). Nothing says it needs a ticket source.
- The ClickUp or Jira need comes up only from a playbook's poll source (`kernel/src/playbooks/fit.ts`, `sourceConnector`, `grantNeeds`), and Wright can't draft a playbook for a member that is still off. So the need first shows up after the member exists, not at creation.
- A create may propose only the GitHub grant (`kernel/src/agents/charter-tools.ts:393`, `connectors?: ["github"]`). Item 16 AC8 and item 18 AC6 keep connector grants owner-only, never proposed in a charter. That rule stays; what's missing is telling the owner, in words, where they already are.

## Acceptance Criteria

### Part A — Permissions read as jobs first (Team inspector)

**Happy path:**
- [ ] **AC1.** Given a crew member with granted kernel tools, when the owner opens it in Team, then PERMISSIONS lists what it may do as catalogue job labels ("Hand tickets to /automate", "Notify the owner", …), grouped the same way the held charter card groups them, and no raw tool name appears above a collapsed "Kernel tool names, as enforced".
- [ ] **AC2.** Given that collapsed section, when the owner expands it, then it lists exactly the allowed tools, Bash prefixes and `never` entries the kernel enforces, unchanged from today.

**Edge cases:**
- [ ] **AC3.** Given a granted tool that belongs to no catalogue job, when the inspector opens, then it is listed under "Other tools" by name, never hidden.
- [ ] **AC4.** Given a settings file the kernel refused, when the inspector opens, then it shows the same "settings file unreadable" message as today and no job list.
- [ ] **AC5.** Given Wright (no detail route), when its inspector opens, then it reads as it does today: read-only, grants unknown, never "not granted".

### Part B — A tracker grant is chosen by capability (Team inspector)

**Happy path:**
- [ ] **AC6.** Given a connected ClickUp or Jira connection, when the owner opens a member's CONNECTORS row, then the grant is offered as a short list of capabilities in words (for example "Read tickets", "Comment on tickets", "Change a ticket's status or fields", "Create tickets", "Delete tickets", "Chat and other tools"), each showing granted, not granted or "partly granted (n of m)".
- [ ] **AC7.** Given that list, when the owner ticks a capability, then the member is granted exactly that capability's tools from the connection's tool list, and the result line names the capability, not a tool count.
- [ ] **AC8.** Given any capability, when the owner expands it, then its raw tool names are shown as the enforced detail.

**Edge cases:**
- [ ] **AC9.** Given a member holding some but not all of a capability's tools (granted before this item, or through the raw list), when the row opens, then that capability reads "partly granted (n of m)"; ticking it grants the rest, and nothing is migrated or widened without a tick.
- [ ] **AC10.** Given a tool the connection lists that no capability covers (ClickUp's server is in beta and adds tools), when the row opens, then the tool appears under "Other tools" by name, is never granted by a capability tick, and is never hidden.
- [ ] **AC11.** Given a capability that writes, deletes or posts outside the tracker (delete, chat), when it is shown, then it is marked in words as one that changes things; the approval gate for outward actions is unchanged (invariant 3).

**Error scenarios:**
- [ ] **AC12.** Given the capability list cannot be read, when the row opens, then the raw per-tool list is shown as today, with a line saying the plain list is unavailable; no grant is changed.

### Part C — Creation flags the tracker grant, and the owner can grant it there

**Happy path:**
- [ ] **AC13.** Given the owner asks Wright for a member that works tickets from a named tracker, when Wright drafts the create, then the ticket duty states its ticket source (GitHub Issues, ClickUp or Jira) as a visible proposal on the held card that the owner can change; the source is data, not a grant.
- [ ] **AC14.** Given a held create or update whose ticket duty's source is not granted to the member, when the owner opens the card (in chat and in Approvals), then a prerequisite row says in words that the member can't read that tracker's tickets yet, for example "Ticket Runner can't read ClickUp tickets yet: it has no ClickUp access", and Wright's held reason says the same and names it as the owner's step.
- [ ] **AC15.** Given that row, when the owner ticks capabilities from Part B's list and approves, then the member is created and those capabilities are granted in the same approval, recorded as the owner's own grant.

**Edge cases:**
- [ ] **AC16.** Given the owner approves without ticking, when the member is created, then the card, the Team inspector and Wright's next message each still name the missing access as open.
- [ ] **AC17.** Given a ticket duty with no stated source (a charter written before this item), when it is checked, then the row says the duty doesn't say which tracker it reads and asks Wright to propose one; the charter is still accepted.

**Error scenarios:**
- [ ] **AC18.** Given the duty's tracker is not connected on Integrations, when the card opens, then the row says it isn't connected and offers Connect; nothing is granted, and the create can still be approved (invariant 5).
- [ ] **AC19.** Given a draft from Wright that carries a ClickUp or Jira grant (in `connectors` or anywhere else), when it is submitted, then it is refused as today; only the owner's tick grants (item 16 AC8).

## Non-goals
- Changing who grants: connector grants stay owner-only; Wright never proposes one.
- Changing what a grant enforces: the kernel still enforces the per-tool list; capabilities only choose it.
- GitHub's grant levels (already words: none / read / write).
- Playbook fit messages (`kernel/src/playbooks/fit.ts`): they keep naming the connector as today.
- A live Jira check (the owner's work account; D38: built against a fake server only).

## Owner decisions
- 2026-11-14: the owner found both gaps on the 21a walk and asked for them filed as one requirement.
- 2026-11-14 (`/product-owner` session): the owner may tick the tracker grant on the held create card; it is recorded as the owner's own grant, never as a charter field. This widens item 16 AC8's "set on Team → inspector" to the card as well; owner-only stays.
- 2026-11-14: a ticket duty names its ticket source as a field on the duty (one ticket job, not one job per tracker), drafted by Wright from the owner's words and changeable on the card.
- 2026-11-14: one item with three Parts (right-size reads `large`; the owner chose one PR and one walk).
- Mechanism, not policy (invariant 1): the capability list describes what tools do. Nothing is granted or ticked by default.

## Priority: MVP
**Rationale:** The phase 8 exit re-run creates a ticket-working member that must read ClickUp; today that step can only be finished by ticking raw tool names on another screen.

## Assumptions
- The ClickUp and Atlassian servers' tool lists may carry MCP annotations (`readOnlyHint`, `destructiveHint`). A read-only probe of the owner's ClickUp connection records whether they do, in `docs/OPEN_QUESTIONS.md`, before the capability list is built on them; without them, the kernel keeps its own fixed list per tracker.
- A held create can apply an owner-side grant on approval without the grant being part of Wright's draft (read `createOnApproval` in `kernel/src/agents/charter-tools.ts` and the agent grant route in `kernel/src/agents/roster.ts`).
- The capability names and how ClickUp's ~58 tools fall into them are proposed by the worker in the PR and approved by the owner at merge.

## Dependencies
- Depends on: 21a (PR #275), which touches the same ClickUp path; the walk below uses its list-by-name draft.
- Blocks: the phase 8 exit re-run's ticket-member step.

## Risks
- The capability list drifts as ClickUp's beta server adds or renames tools. AC10 keeps unknown tools visible and ungranted.
- A capability tick grants more than the owner expects. AC8 shows exactly which tools each capability holds.
- About 35 files with companions, above the one-PR guide of 30; the owner chose one item.

## Success Metrics
- In the walk below, the owner creates a ticket-working member and grants it ClickUp access without seeing a raw tool name above "Kernel tool names, as enforced".

## Handoff
Ready for: `/launch-pad goal: ".supervisor/requirements/phase-8-21/2026-11-14-120000-b-a-crew-members-tracker-grant-in-plain-words.md"`

## Validation (must pass before merge)
1. **Static — test suites:** `cd kernel && npm ci && npm test`; `cd app && npm test`; the e2e specs `app/e2e/team.spec.ts` and `app/e2e/approvals.spec.ts`; `bash scripts/check-docs.sh`.
2. **Running system — packaged-app walk:** in the packaged app with ClickUp connected:
   1. Ask Wright for a crew member that works ClickUp tickets in the Loomwright Studio list. The held card shows the duty's source as ClickUp and a row saying the member has no ClickUp access, with the capability list; no raw tool name shows above "Kernel tool names, as enforced".
   2. Tick "Read tickets" and "Comment on tickets", and approve. The member is created and holds exactly those capabilities' tools.
   3. Open the member in Team. PERMISSIONS reads as job labels with raw names collapsed; CONNECTORS shows ClickUp with those two capabilities granted and the rest not.
   4. Create a second such member and approve without ticking. The card, the inspector and Wright's reply each name the missing ClickUp access as the owner's step.
   5. Draft a ClickUp ticket playbook for the first member and dry-run it; it reads the list's open task tagged `studio-sandbox`.

   Its output and screenshots go in `docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md`, with the line `Verdict: PASS for Validation 2`.

## Depends on
2026-11-13-221500-a-a-clickup-poll-names-its-list-the-way-clickup-reads-it.md

## Touches
app/src/screens/team/Inspector.tsx
app/src/screens/team/Connectors.tsx
app/src/screens/team/model.ts
app/src/screens/team/actions.ts
app/src/screens/team/team.css
app/src/screens/team/team.test.tsx
app/src/screens/team/connectors.test.tsx
app/src/screens/approvals/charterBlocks.ts
app/src/screens/approvals/CharterDisplay.tsx
app/src/screens/approvals/CharterDisplay.test.tsx
app/src/screens/chat/CharterCard.tsx
app/src/screens/chat/CharterCard.test.tsx
app/src/api/contract.ts
app/e2e/team.spec.ts
app/e2e/approvals.spec.ts
kernel/src/features/catalogue.ts
kernel/src/agents/charter-tools.ts
kernel/src/agents/charter-readiness.ts
kernel/src/agents/charter-files.ts
kernel/src/agents/roster.ts
kernel/src/integrations/mcp/trackers.ts
kernel/test/tool-catalogue.test.ts
kernel/test/agents-charter-tools.test.ts
kernel/test/agents-charter-readiness.test.ts
kernel/test/agents-charter-needs.test.ts
kernel/test/agents-connectors-grant.test.ts
kernel/test/integrations-mcp-trackers.test.ts
docs/architecture/mcp-connectors.md
docs/DESIGN.md
docs/OPEN_QUESTIONS.md
docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md
