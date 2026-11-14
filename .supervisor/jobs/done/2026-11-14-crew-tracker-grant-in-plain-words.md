# Supervisor Job: A crew member's tracker grant is chosen, shown and flagged in plain words (phase 8 item 21b)

## Environment
- **Project:** loomwright-studio (lane L1 of automate-2026-11-14-103216)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement sits under the gitignored `.supervisor/`, so its provenance is unverified)
- **Source requirement:** .supervisor/requirements/phase-8-21/2026-11-14-120000-b-a-crew-members-tracker-grant-in-plain-words.md
- **Base commit:** 02244df1bc2943059840a681ab57b4a0571f7e21

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the React app (vitest + Playwright e2e) already hold every surface: the catalogue, charter readiness, the MCP connector rows, the Team inspector and the charter card. |
| 2 | Dependency Availability | GO | No new dependency. ClickUp's tool list is already stored per connection (`granted_tools`, `{name, proxy, read_only, description, schema}` in `kernel/src/integrations/mcp/rows.ts`). |
| 3 | Architecture Fit | CAUTION | Contributed routes get no tool catalogue today (`ContributedRouteRequest` in `kernel/src/features/contribution.ts` has `approvalApplier`, no `catalogue`), and an approval decision carries no owner input beyond `decision` (`decisionOf` in `kernel/src/approvals/routes.ts`). Both need a small, additive field. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 30 modified files plus tests and docs, past one worker's context (`context-bound`): split into 4 dependency-ordered subtasks. The owner chose one PR. |
| 5 | Hard Blockers | CAUTION | The capability list needs ClickUp's real tool names, which only the owner's live connection holds; the 21a method (read-only `sqlite3 -readonly` of the store plus a read-only `tools/list`) gets them. Files outside the requirement's Touches are needed (see Scope widening). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Show a crew member's permissions as catalogue jobs and its ClickUp/Jira grant as a short list of capabilities in words, and make a ticket-working member's create (or update) name its ticket source, flag missing tracker access in words, and let the owner tick that access on the held card so it is granted in the same approval as the owner's own grant.

**Problem Statement:**
The owner needs to grant and read a crew member's tracker access without ever seeing raw kernel tool names, because the owner rule is that the owner never handles kernel internals.
Currently, the Team inspector lists `policy.allowedTools` raw (`Enforced` in `app/src/screens/team/Inspector.tsx`) and asks for ClickUp access by one checkbox per raw tool name (`McpRow` in `app/src/screens/team/Connectors.tsx`, about 58 for ClickUp), and a create for a ticket-working member (Ticket Runner, `ticket-runner-20c`) never says it has no tracker access. This causes a member that reaches its first ticket unable to read it, and a fix that can only be done by ticking raw tool names on another screen.
Success looks like the Validation 2 walk: the owner creates a ticket-working member and grants it ClickUp access without seeing a raw tool name above "Kernel tool names, as enforced".

## Design decisions
- decision: Where the tracker capability list (tool name → capability) lives
  chosen: A kernel-owned, fixed, exact-name list per tracker in `kernel/src/integrations/mcp/trackers.ts` (beside `MCP_TRACKERS`, the existing per-tracker table), served on `GET /connectors` per connection as `capabilities` + `other_tools`; any listed tool the list does not name is "Other tools"
  rejected: Derive capabilities from the server's `readOnlyHint`/`destructiveHint` — blast radius: the hints only split read from write, they cannot tell "comment" from "delete" or "chat", and `rows.ts` keeps only `read_only` (no destructive flag), so it needs a storage change
  rejected: Group tool names in the app — fits-stack partial: charter readiness (Part C) must know in the kernel which tools mean "read tickets", so an app copy would be a second source that drifts
  evidence: `MCP_TRACKERS: Readonly<Record<McpKind, McpTrackerDefinition>>` in `kernel/src/integrations/mcp/trackers.ts`; `readonly read_only: boolean;` is the only hint `McpStoredTool` keeps (`kernel/src/integrations/mcp/rows.ts`); `docs/evidence/phase-8-20g-clickup-reader.md` records `clickup_filter_tasks` with `readOnlyHint: true, destructiveHint: false`
  revisit when: the owner's probe (AC20) shows ClickUp and Atlassian set `readOnlyHint`/`destructiveHint` on every tool and the owner wants the list derived from them
  status: confirmed
- decision: How the owner's ticks on the held create card become the member's grant "in the same approval"
  chosen: `POST /approvals/:id/approve` accepts an optional owner-only `owner_grant: {kind: "clickup" | "jira", tools: [...]}` for a `kernel_agent_create` or `kernel_agent_update` approval; the kernel checks every tool is in that connection's stored tool list and applies it inside the decision (merged with the existing `mergeConnectorsGrant` idiom and recorded `by: "owner"`), before the applied sentence (`openFlagsSentence`) is computed, so Wright's next message is correct
  rejected: The app posts `POST /agents/:id/set connectors clickup:…` after the approve answers — blast radius yes, but the kernel's applied sentence is computed in `createOnApproval` before that write, so Wright's next message would wrongly say the access is still missing (AC15/AC16 disagree), and a failed second call leaves a half-done approval
  rejected: Let Wright's draft carry the grant — violates item 16 AC8 / requirement AC19 (connector grants stay owner-only)
  evidence: `function decisionOf(req: ContributedRouteRequest, approve: boolean): ApprovalDecision | undefined` reads only `decision` (`kernel/src/approvals/routes.ts`); `const open = checked.ok ? openFlagsSentence(createReadiness(` runs inside `createOnApproval` (`kernel/src/agents/charter-tools.ts`); `export function mergeConnectorsGrant(current: unknown, change: ConnectorsGrantChange): unknown` (`kernel/src/agents/settings.ts`)
  revisit when: approvals gain a general owner-edit-on-approve mechanism
  status: confirmed
- decision: How the Team inspector learns which catalogue job each granted kernel tool belongs to (AC1)
  chosen: Pass the kernel's tool catalogue to contributed routes as `ContributedRouteRequest.catalogue` (the same optional-field pattern as `approvalApplier`, set by the API server from `startKernel`'s `toolCatalogue`), and have `GET /agents/:id` answer a `jobs` view built by one pure catalogue function that groups like `jobDisplayLines` does
  rejected: An app-side mirror of the tool → job table — drifts from `TOOL_JOB_DEFINITIONS` and every contributed tool's `job`; the kernel is the only place that knows the merged catalogue
  rejected: Re-read the member's last held charter display — stale after any later update or owner set
  evidence: `readonly approvalApplier?: ApprovalApplier;` on `ContributedRouteRequest` and `const applier = options.approvalApplier === undefined ? {} : { approvalApplier: options.approvalApplier };` in `kernel/src/api/server.ts`; `const toolCatalogue = kernelToolCatalogue(` in `kernel/src/kernel.ts`
  revisit when: a catalogue route exists for other screens
  status: confirmed

## Acceptance Criteria

### Part A — Permissions read as jobs first (Team inspector)
- [ ] **AC1.** Given a crew member with granted kernel tools, when the owner opens it in Team, then PERMISSIONS lists what it may do as catalogue job labels ("Hand tickets to /automate", "Notify the owner", …), grouped the same way the held charter card groups them (`jobDisplayLines` order), and no raw tool name appears above a collapsed "Kernel tool names, as enforced".
- [ ] **AC2.** Given that collapsed section, when the owner expands it, then it lists exactly the allowed tools, Bash prefixes and `never` entries the kernel enforces, unchanged from today.
- [ ] **AC3.** Given a granted tool that belongs to no catalogue job, when the inspector opens, then it is listed under "Other tools" by name, never hidden.
- [ ] **AC4.** Given a settings file the kernel refused, when the inspector opens, then it shows the same "settings file unreadable" message as today and no job list.
- [ ] **AC5.** Given Wright (no detail route), when its inspector opens, then it reads as it does today: read-only, grants unknown, never "not granted".

### Part B — A tracker grant is chosen by capability (Team inspector)
- [ ] **AC6.** Given a connected ClickUp or Jira connection, when the owner opens a member's CONNECTORS row, then the grant is offered as a short list of capabilities in words (for example "Read tickets", "Comment on tickets", "Change a ticket's status or fields", "Create tickets", "Delete tickets", "Chat and other tools"), each showing granted, not granted or "partly granted (n of m)".
- [ ] **AC7.** Given that list, when the owner ticks a capability, then the member is granted exactly that capability's tools from the connection's tool list (added to what it already holds), and the result line names the capability, not a tool count.
- [ ] **AC8.** Given any capability, when the owner expands it, then its raw tool names are shown as the enforced detail.
- [ ] **AC9.** Given a member holding some but not all of a capability's tools, when the row opens, then that capability reads "partly granted (n of m)"; ticking it grants the rest, and nothing is migrated or widened without a tick.
- [ ] **AC10.** Given a tool the connection lists that no capability covers, when the row opens, then the tool appears under "Other tools" by name, is never granted by a capability tick, and is never hidden.
- [ ] **AC11.** Given a capability that writes, deletes or posts outside the tracker (delete, chat), when it is shown, then it is marked in words as one that changes things; the approval gate for outward actions is unchanged (invariant 3).
- [ ] **AC12.** Given the capability list cannot be read (the connection's `capabilities` is absent or null), when the row opens, then the raw per-tool list is shown as today, with a line saying the plain list is unavailable; no grant is changed.

### Part C — Creation flags the tracker grant, and the owner can grant it there
- [ ] **AC13.** Given the owner asks Wright for a member that works tickets from a named tracker, when Wright drafts the create, then the ticket duty states its ticket source (`source`: GitHub Issues, ClickUp or Jira) as a visible proposal on the held card that the owner can change through the card's existing Ask or change box; the source is data, not a grant.
- [ ] **AC14.** Given a held create or update whose ticket duty's source is not granted to the member, when the owner opens the card (in chat and in Approvals), then a readiness row says in words that the member can't read that tracker's tickets yet (for example "Ticket Runner can't read ClickUp tickets yet: it has no ClickUp access"), and Wright's held reason says the same and names it as the owner's step.
- [ ] **AC15.** Given that row, when the owner ticks capabilities from Part B's list and approves, then the member is created (or updated) and those capabilities are granted in the same approval, recorded as the owner's own grant (`by: "owner"`), and the applied sentence Wright receives does not name the access as open.
- [ ] **AC16.** Given the owner approves without ticking, when the member is created, then the card, the Team inspector and Wright's next message (the applied sentence) each still name the missing access as open.
- [ ] **AC17.** Given a ticket duty with no stated source (a charter written before this item), when it is checked, then the row says the duty doesn't say which tracker it reads and asks Wright to propose one; the charter is still accepted.
- [ ] **AC18.** Given the duty's tracker is not connected on Integrations, when the card opens, then the row says it isn't connected and offers Connect; nothing is granted, and the create can still be approved (invariant 5).
- [ ] **AC19.** Given a draft from Wright that carries a ClickUp or Jira grant (in `connectors` or anywhere else in the charter, a duty included), when it is submitted, then it is refused as today; only the owner's tick (`owner_grant` on the owner's approve) grants (item 16 AC8). An `owner_grant` naming a tool the connection does not list, or a kind that is not an MCP tracker, is refused and nothing is decided.

### Probe, validation and evidence
- [ ] **AC20.** Given the owner's ClickUp connection, when a read-only probe (the 21a method: the store read with `sqlite3 -readonly`, a read-only `tools/list`, no token printed) lists the server's tools, then a committed evidence file `docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md` records whether each tool carries `readOnlyHint`/`destructiveHint`, the tool names and which capability each falls in (the worker's proposed mapping, for the owner to approve at merge), and `docs/OPEN_QUESTIONS.md` records the hint answer.
- [ ] **AC21.** Given the finished change, when `cd kernel && npm ci && npm test`, `cd app && npm test`, the e2e specs `app/e2e/team.spec.ts` and `app/e2e/approvals.spec.ts` and `bash scripts/check-docs.sh` run, then all pass, and their summary output is recorded in the same committed evidence file under `## Validation 1`.
- [ ] **AC22.** Given the evidence file, when it is committed, then it carries a `## Validation 2` section with the requirement's five packaged-app walk steps; the line `Verdict: PASS for Validation 2` is written only by whoever performs that walk in the packaged app with ClickUp connected, never pre-filled by a worker.

## Scope widening
- kernel/src/integrations/mcp/connector.ts
- kernel/src/features/contribution.ts
- kernel/src/api/server.ts
- kernel/src/kernel.ts
- kernel/src/agents/settings.ts
- kernel/src/features/job-needs.ts
- kernel/src/approvals/routes.ts
- kernel/src/approvals/store.ts
- kernel/test/agents-roster.test.ts
- kernel/test/approvals.test.ts
- kernel/test/integrations-mcp-connector.test.ts
- kernel/test/job-needs.test.ts
- app/e2e/fixtures/team.ts
- app/e2e/fixtures/approvals.ts
- app/e2e/fixtures/chat.ts
- app/src/screens/approvals/ApprovalsScreen.tsx
- app/src/screens/approvals/charterBlocks.test.ts
- docs/architecture/approvals.md
- accepted: LP-SCOPE 2026-11-14

## Touched-file invariants

> Grounded at base `02244df1bc2943059840a681ab57b4a0571f7e21`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/mcp/trackers.ts`** — keep: tool names are untrusted data checked against the stored list (`a tool name here is data, checked`); the import fence (`never \`connector.ts\` (which imports`); reuse: `storedToolsOf` for the listed tools; pinned by: `kernel/test/integrations-mcp-trackers.test.ts`.
- **`kernel/src/integrations/mcp/connector.ts`** — keep: the view never carries a token or proxy names (`Never a token, and \`granted_tools\` are the server's tool names only`); `granted_tools` stays the server names list so today's raw list (AC12) keeps working; mirror: `McpConnection` in `app/src/api/contract.ts`; pinned by: `kernel/test/integrations-mcp-connector.test.ts`.
- **`kernel/src/features/catalogue.ts`** — keep: one declaration per job (`the ONE place a job is`), every job declares its needs (`A job that needs nothing beyond its tools still declares it`), `TOOL_JOBS` derived, frozen; reuse: `jobDisplayLines`' grouping (`for (const job of catalogue.jobs)`) and `DISPLAY_NOT_IN_CATALOGUE` for tools outside the catalogue; pinned by: `kernel/test/tool-catalogue.test.ts`, `kernel/test/job-needs.test.ts`.
- **`kernel/src/features/contribution.ts`** / **`kernel/src/api/server.ts`** / **`kernel/src/kernel.ts`** — keep: request fields are optional so a handler test literal still typechecks (`Optional in the type so a request`); mirror: the `approvalApplier` plumbing (`const applier = options.approvalApplier === undefined ? {} : { approvalApplier: options.approvalApplier };`); the CLI-safe import fence (`kernel/test/feature-seams.test.ts`).
- **`kernel/src/agents/roster.ts`** — keep: `show` answers `settings.error` for a refused file and `never: read.ok ? [...(read.settings.never ?? [])] : null`; set writes atomically (`A temporary sibling, then a rename over the file`) and `changeMcpGrant`'s `<kind>:<tool>[,<tool>…]` value form; pinned by: `kernel/test/agents-roster.test.ts`, `kernel/test/agents-connectors-grant.test.ts`.
- **`kernel/src/agents/charter-files.ts`** — keep: connector grants are owner-only (`the ${ownerOnly} grant is owner-only`); bare-string duties stay readable (`export type CharterDuty = string | DutyEntry;`); `__proto__` refused by `validateCharter`; pinned by: `kernel/test/agents-charter-tools.test.ts`, `kernel/test/agents-charter-connectors.test.ts`.
- **`kernel/src/agents/charter-readiness.ts`** — keep: inputs only (`Inputs, and nothing else (invariant 3)`), a duty's text is never read for a job (`A duty's text is shown, never read for a job`), never holds or refuses except a bare-string Wright duty, the line prefixes (`READINESS_FLAG_PREFIX`) and the CLI-safe import list; mirror: the app reads these lines through `CHARTER_READINESS_HEADING_PREFIX` (`app/src/screens/approvals/subject.ts`) and any new flag text through a constant mirrored in `app/src/screens/approvals/charterBlocks.ts` (as `WORKSPACE_FLAG = "no copy of a repo to work in"`); pinned by: `kernel/test/agents-charter-readiness.test.ts`, `kernel/test/agents-charter-needs.test.ts`.
- **`kernel/src/agents/charter-tools.ts`** — keep: `connectors?: [\"github\"]` stays the only grant a create proposes; `createOnApproval` reports open flags via `openFlagsSentence`; `deferFiles: true` with `after: () => void ensureAgentFiles(` (an owner grant must reach the settings file the `after` writes, or be merged after it, never lost); pinned by: `kernel/test/agents-charter-tools.test.ts`.
- **`kernel/src/approvals/routes.ts`** / **`kernel/src/approvals/store.ts`** — keep: refusals write nothing (`Refusals write nothing`); a decision is the owner's (`by: OWNER`); an applied outcome's `after` runs after commit; pinned by: `kernel/test/approvals.test.ts`.
- **`app/src/screens/team/Connectors.tsx`** — keep: one write path per grant (`changeMcpGrant`), a comma-holding tool name refused unsent (`which a grant cannot carry. Nothing was changed.`), `<kind>:none` never `none`, Wright's grant unknown never "not granted", every string a React text child; pinned by: `app/src/screens/team/connectors.test.tsx`.
- **`app/src/screens/team/Inspector.tsx`** — keep: only a kernel-accepted file is shown as enforced (`Only a file the kernel accepted is shown as enforced`) and the `team-settings-unreadable` message; pinned by: `app/src/screens/team/team.test.tsx`, `app/e2e/team.spec.ts`.
- **`app/src/screens/chat/CharterCard.tsx`** — keep: every kernel string through `printable` as a text child; a refusal shows the kernel's words and leaves the card; reuse: the `readinessFix` slot as `Choose workspace` uses it (`line.status === "flagged" && line.text.includes(WORKSPACE_FLAG)`); pinned by: `app/src/screens/chat/CharterCard.test.tsx`.
- **`app/src/screens/approvals/CharterDisplay.tsx`** — keep: the fix slot's shape (`readonly readinessFix?: (line: CharterReadinessLine, index: number) => ReactNode;`) and its call (`{readinessFix?.(line, i) ?? null}`), so the workspace fix keeps working; pinned by: `app/src/screens/approvals/CharterDisplay.test.tsx`.
- **`app/src/screens/approvals/ApprovalsScreen.tsx`** — keep: the one charter render (`<CharterDisplay key={a.id} parts={charter} display={a.display}>`) and its pending-only `CharterAsk`; the change only passes `readinessFix`; pinned by: `app/src/screens/approvals/ApprovalsScreen.test.tsx`.
- **`app/src/screens/approvals/charterBlocks.ts`** — keep: pure, no React (`Pure: no React and no markup`); mirror: each flag constant is the kernel's text exactly, as `export const WORKSPACE_FLAG = "no copy of a repo to work in";` mirrors `workspaceItem`; the new `TRACKER_ACCESS_FLAG` mirrors the kernel's `TRACKER_ACCESS_FLAG` byte for byte; pinned by: `app/src/screens/approvals/charterBlocks.test.ts`.
- **`app/src/api/contract.ts`** — keep: the contract is the app's mirror of kernel bodies; every new field optional or nullable so an older kernel's answer still types (`export interface McpConnection {`); mirror: `McpConnectionView` (`kernel/src/integrations/mcp/connector.ts`), `show` in `kernel/src/agents/roster.ts`, the approve body in `kernel/src/approvals/routes.ts`.
- **`app/src/screens/team/actions.ts`** — keep: every grant goes through the one route helper (`export function setAgentMcpTools(`); a capability tick builds the full kind set and calls it, never a second POST shape.
- **`app/src/screens/team/model.ts`** — keep: the held-tools reader reads untrusted settings content and answers `undefined` (unknown) rather than guessing (`export function mcpToolsHeld(content: unknown, kind: McpConnectionKind): readonly string[] | undefined {`); new capability logic lives in Connectors.tsx, not here; pinned by: `app/src/screens/team/connectors.test.tsx`.
- **`app/e2e/fixtures/team.ts`** / **`app/e2e/fixtures/approvals.ts`** / **`app/e2e/fixtures/chat.ts`** — keep: each fixture kernel answers the contract's shapes (`teamFixture`, `ApprovalsKernel`); the new fields (`jobs`, `capabilities`, `other_tools`, `tracker_access`, readiness line text) are added beside the existing answers, never replacing them, so the other specs that import these fixtures stay green.
- **`kernel/src/features/job-needs.ts`** — keep: the needs gap kinds stay closed (`export type NeedsGapKind = "claude_tool" | "bash_prefix" | "connector" | "workspace";`) and unchanged — the ticket source is a readiness check, not a playbook fit gap (`kernel/src/playbooks/fit.ts` is a non-goal); pinned by: `kernel/test/job-needs.test.ts`.
- **`kernel/src/agents/settings.ts`** — keep: one merge for every grant change (`export function mergeConnectorsGrant(current: unknown, change: ConnectorsGrantChange): unknown {`) replacing only its own kind's key; the owner grant on approve reuses it, never a copy; pinned by: `kernel/test/agents-connectors-grant.test.ts`.

## Closed enumerations touched

> Sibling greps at base `02244df1`: `grep -rnF '"connector"' kernel/src/agents app/src/screens` → 4 hits in `kernel/src/agents/charter-readiness.ts` (the `ReadinessSubject` union and three `item("connector", …)` calls; the other hits are command keywords, not this kind). `grep -rnF 'always_not_supported' kernel/src app/src docs` → routes.ts header + handler, store.ts error code union, approvals/cli.ts, two app tests. `grep -rnF 'loomwrightCommands' kernel/src/features` → catalogue.ts `needs()` and job-needs.ts.

- **`"tracker"`** (sibling: `"connector"`) — must be named in:
  - `kernel/src/agents/charter-readiness.ts` — the `ReadinessSubject` union (`export type ReadinessSubject = "duty" | "workspace" | "connector" | "permission" | "jobs";`) — extend.
  - `kernel/src/playbooks/fit.ts` / `kernel/src/features/job-needs.ts` `NeedsGapKind` — no change: a ticket source is a charter readiness item, not a playbook fit gap (fit messages are a non-goal).
- **`TICKET_SOURCES` values `"github" | "clickup" | "jira"`** (sibling: `CONNECTOR_KINDS`) — a new closed list in `kernel/src/agents/charter-files.ts`, published in `CHARTER_JSON_SCHEMA` as an enum (the file's rule: `share one source: every closed set`) — extend that schema; `app/src/api/contract.ts` `TrackerAccess.source` — extend.
- **`ticketSource` need key** (sibling: `loomwrightCommands`) — must be named in:
  - `kernel/src/features/catalogue.ts` — `JobNeedsDeclaration` and `needs()` (`function needs(declared: Partial<JobNeedsDeclaration> = {}): JobNeedsDeclaration {`) — extend (default false; only `automate_tickets` sets it).
  - `kernel/src/features/job-needs.ts` — `resolveJobNeeds` reads named keys only — no change unless the catalogue text prints needs, in which case extend `catalogueText`'s needs line and its pin in `kernel/test/tool-catalogue.test.ts`.
- **`tracker_access.status` values `"granted" | "no_access" | "not_connected" | "no_source"`** — a new closed list owned by `kernel/src/agents/charter-readiness.ts`, mirrored in `app/src/api/contract.ts` `TrackerAccess` — extend both together.
- **Approve refusals** (sibling: `always_not_supported`) — no change: a bad `owner_grant` reuses `400 invalid_body` / `invalid_approval`; `kernel/src/approvals/routes.ts`' header list of refusals gains only the sentence naming `owner_grant` under `invalid_body`, and `kernel/src/approvals/cli.ts` needs nothing (the CLI never sends `owner_grant`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-mcp-trackers.test.ts` — a tool sits in at most one capability | in `kernel/src/integrations/mcp/trackers.ts`, add `clickup_get_list` to a second ClickUp capability's `tools` |
| `kernel/test/integrations-mcp-trackers.test.ts` — an unlisted tool is `other_tools`, never in a capability | in `trackerCapabilities`, return the capability's declared `tools` instead of their intersection with the listed tools |
| `kernel/test/integrations-mcp-connector.test.ts` — the view carries `capabilities` and keeps `granted_tools` names | delete the `capabilities:` line in `mcpConnectionView` in `kernel/src/integrations/mcp/connector.ts` |
| `kernel/test/agents-roster.test.ts` — `show` answers `jobs` grouped by catalogue job, unknown tools last | in `jobGroups` in `kernel/src/features/catalogue.ts`, drop the not-in-catalogue group |
| `kernel/test/agents-roster.test.ts` — `show` answers `tracker_access` with `no_access` for an ungranted ClickUp ticket duty | in `kernel/src/agents/roster.ts`, answer `tracker_access: null` unconditionally |
| `kernel/test/agents-charter-tools.test.ts` — a Wright create draft carrying `clickup` (in `connectors` or a duty) is refused | delete the `mcpGrantKindOf` owner-only check line in `kernel/src/agents/charter-files.ts` |
| `kernel/test/agents-charter-readiness.test.ts` — an unstated source on a ticket duty is flagged, charter accepted | in `charter-readiness.ts`, skip the tracker item when `source` is undefined |
| `kernel/test/approvals.test.ts` — an `owner_grant` naming a tool the connection does not list decides nothing | delete the stored-tool-list check in the `owner_grant` validation in `kernel/src/approvals/routes.ts` |
| `kernel/test/agents-charter-tools.test.ts` — after approve with `owner_grant`, the member's settings file holds those tools and the applied sentence names no open tracker access | in `createOnApproval`, compute `openFlagsSentence` before applying the owner grant |
| `app/src/screens/team/connectors.test.tsx` — "partly granted (n of m)" | in `app/src/screens/team/Connectors.tsx`, report a partly held capability as `not granted` |
| `app/src/screens/team/connectors.test.tsx` — capability unavailable falls back to the raw list | in `Connectors.tsx`, render `CapabilityList` when `capabilities` is null |
| `app/src/screens/team/team.test.tsx` — no raw `mcp__kernel__` name above the collapsed section | in `app/src/screens/team/Inspector.tsx`, render the allowed-tools `List` outside the `<details>` |
| `app/src/screens/approvals/charterBlocks.test.ts` — `TRACKER_ACCESS_FLAG` equals the kernel's text | flip one word of `TRACKER_ACCESS_FLAG` in `app/src/screens/approvals/charterBlocks.ts` |
| `app/src/screens/chat/CharterCard.test.tsx` — Create with ticks posts `owner_grant`; Create without ticks posts `{decision: "once"}` only | in `CharterCard.tsx`, drop `owner_grant` from the approve body |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: tracker capabilities, jobs view, catalogue on routes, probe | AC1–AC3 (kernel half), AC6, AC10–AC12 (kernel half), AC20 | 14 modify, 1 create | unit-testing | LAUNCHABLE |
| 2 | Kernel: ticket source on a duty, tracker readiness, owner grant on approve | AC13, AC14, AC15–AC19 (kernel half) | 18 modify, 0 create | unit-testing, error-handling | BLOCKED (by #1) |
| 3 | App: Team inspector jobs-first and capability grants | AC1–AC12 (app half) | 9 modify, 0 create | frontend-ui, unit-testing, playwright-e2e | BLOCKED (by #1) |
| 4 | App: held card tracker row and tick-to-grant, docs, validation | AC14–AC18 (app half), AC21, AC22 | 14 modify, 0 create (plus the evidence file created by #1) | frontend-ui, unit-testing, playwright-e2e | BLOCKED (by #2, #3) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 kernel capabilities | `kernel/src/integrations/mcp/trackers.ts` (147 — home of the capability list, beside `MCP_TRACKERS`), `kernel/src/integrations/mcp/connector.ts` (556 — view field only; the list is computed in trackers.ts), `kernel/src/features/catalogue.ts` (529 — one pure job-group function beside `jobDisplayLines`, the single authority for grouping), `kernel/src/features/contribution.ts` (689 — one optional request field), `kernel/src/api/server.ts` (920 — one option passed through, as `approvalApplier`), `kernel/src/kernel.ts` (507 — pass `toolCatalogue`), `kernel/src/agents/roster.ts` (769 — `show` adds `jobs`; logic lives in catalogue.ts), `app/src/api/contract.ts` (1907 — the single contract file), `kernel/test/integrations-mcp-trackers.test.ts` (1015 — the trackers suite), `kernel/test/integrations-mcp-connector.test.ts` (1430 — the view's suite), `kernel/test/tool-catalogue.test.ts` (402), `kernel/test/agents-roster.test.ts` (883 — the `show` suite), `docs/architecture/mcp-connectors.md` (213), `docs/OPEN_QUESTIONS.md` (275) | `docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md` | HIGH |
| 2 kernel ticket source | `kernel/src/agents/charter-files.ts` (654 — `DutyEntry` and `validateCharter` are the single home), `kernel/src/agents/roster.ts` (769 — `show` answers `tracker_access` from the readiness authority; no new logic here), `kernel/test/agents-roster.test.ts` (883 — the `show` suite), `kernel/test/job-needs.test.ts` (253), `kernel/src/features/catalogue.ts` (529 — the `automate_tickets` needs declaration), `kernel/src/features/job-needs.ts` (382 — only if the new need key is enumerated there), `kernel/src/agents/charter-readiness.ts` (624 — the single readiness authority; one tracker item beside `connectorItem`), `kernel/src/agents/charter-tools.ts` (1044 — tool description, `createOnApproval`/`updateOnApproval` apply the owner grant), `kernel/src/agents/settings.ts` (493 — reuse `mergeConnectorsGrant`; change only if a helper must be exported), `kernel/src/approvals/routes.ts` (87), `kernel/src/approvals/store.ts` (845 — `AppliedApproval` gains the owner grant; the single decision authority), `app/src/api/contract.ts` (1907 — approve body type), `kernel/test/agents-charter-needs.test.ts` (225), `kernel/test/agents-charter-readiness.test.ts` (952 — the readiness suite), `kernel/test/agents-charter-tools.test.ts` (1364 — the create/update suite), `kernel/test/approvals.test.ts` (2043 — the decide suite), `kernel/test/agents-connectors-grant.test.ts` (520 — owner-only grant pins), `docs/architecture/approvals.md` | — | MEDIUM |
| 3 app inspector | `app/src/screens/team/Inspector.tsx` (461 — `Enforced` is the single home of PERMISSIONS), `app/src/screens/team/Connectors.tsx` (273 — home of the capability rows, beside `mcpGrantRows`/`changeMcpGrant`; exports the capability list component the card reuses), `app/src/screens/team/model.ts` (560 — only if a held-tools reader must change; new logic goes in Connectors.tsx), `app/src/screens/team/actions.ts` (93), `app/src/screens/team/team.css` (382), `app/src/screens/team/team.test.tsx` (1399 — the inspector suite), `app/src/screens/team/connectors.test.tsx` (565 — the connectors suite), `app/e2e/team.spec.ts` (752), `app/e2e/fixtures/team.ts` (461 — the Team e2e fixture kernel answers `jobs` and `capabilities`) | — | HIGH |
| 4 app card | `app/src/screens/chat/CharterCard.tsx` (214), `app/src/screens/approvals/CharterDisplay.tsx` (295), `app/src/screens/approvals/charterBlocks.ts` (286 — the mirrored flag constant beside `WORKSPACE_FLAG`), `app/src/screens/approvals/ApprovalsScreen.tsx` (1054 — pass `readinessFix` to its one `CharterDisplay`), `app/src/screens/team/Inspector.tsx` (461 — AC16 open-access line, read from `tracker_access`), `app/src/screens/team/team.test.tsx` (1399 — the inspector suite), `app/src/screens/chat/CharterCard.test.tsx` (536 — the card suite), `app/src/screens/approvals/CharterDisplay.test.tsx` (538), `app/src/screens/approvals/charterBlocks.test.ts` (146), `app/e2e/approvals.spec.ts` (704), `app/e2e/fixtures/approvals.ts` (398), `app/e2e/fixtures/chat.ts` (346 — the fixture kernels answer `tracker_access`, the tracker readiness line and `owner_grant`), `docs/DESIGN.md` (418), `docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md` (created by #1) | — | MEDIUM |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "MCP_TRACKER_CAPABILITIES"}
  - {kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "trackerCapabilities"}
  - {kind: "symbol", path: "kernel/src/features/catalogue.ts", name: "jobGroups"}
  - {kind: "symbol", path: "kernel/src/api/server.ts", name: "toolCatalogue"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "McpCapability"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "AgentJobGroup"}
  - {kind: "file", path: "docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md"}
requires: []
lanes:
  - "kernel/src/integrations/mcp/trackers.ts"
  - "kernel/src/integrations/mcp/connector.ts"
  - "kernel/src/features/catalogue.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/agents/roster.ts"
  - "app/src/api/contract.ts"
  - "kernel/test/integrations-mcp-trackers.test.ts"
  - "kernel/test/integrations-mcp-connector.test.ts"
  - "kernel/test/tool-catalogue.test.ts"
  - "kernel/test/agents-roster.test.ts"
  - "docs/architecture/mcp-connectors.md"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md"
external_requires:
  - "The owner's live ClickUp connection in the Studio store (read-only probe, 21a method) for the real tool names and hints"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "TICKET_SOURCES"}
  - {kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "TRACKER_ACCESS_FLAG"}
  - {kind: "symbol", path: "kernel/src/approvals/routes.ts", name: "owner_grant"}
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "tracker_access"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "OwnerGrant"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "TrackerAccess"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "trackerCapabilities"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/mcp/trackers.ts", name: "MCP_TRACKER_CAPABILITIES"}
lanes:
  - "kernel/src/agents/charter-files.ts"
  - "kernel/src/agents/roster.ts"
  - "kernel/test/agents-roster.test.ts"
  - "kernel/src/features/catalogue.ts"
  - "kernel/src/features/job-needs.ts"
  - "kernel/src/agents/charter-readiness.ts"
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/src/agents/settings.ts"
  - "kernel/src/approvals/routes.ts"
  - "kernel/src/approvals/store.ts"
  - "app/src/api/contract.ts"
  - "kernel/test/agents-charter-needs.test.ts"
  - "kernel/test/agents-charter-readiness.test.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/agents-connectors-grant.test.ts"
  - "kernel/test/job-needs.test.ts"
  - "docs/architecture/approvals.md"
external_requires: []

# Subtask 3
provides:
  - {kind: "symbol", path: "app/src/screens/team/Connectors.tsx", name: "CapabilityList"}
  - {kind: "symbol", path: "app/src/screens/team/Connectors.tsx", name: "changeCapabilityGrant"}
  - {kind: "symbol", path: "app/src/screens/team/Inspector.tsx", name: "RAW_TOOL_NAMES_SUMMARY"}
requires:
  - {from: "1", kind: "type", path: "app/src/api/contract.ts", name: "McpCapability"}
  - {from: "1", kind: "type", path: "app/src/api/contract.ts", name: "AgentJobGroup"}
lanes:
  - "app/src/screens/team/Inspector.tsx"
  - "app/src/screens/team/Connectors.tsx"
  - "app/src/screens/team/model.ts"
  - "app/src/screens/team/actions.ts"
  - "app/src/screens/team/team.css"
  - "app/src/screens/team/team.test.tsx"
  - "app/src/screens/team/connectors.test.tsx"
  - "app/e2e/team.spec.ts"
  - "app/e2e/fixtures/team.ts"
external_requires: []

# Subtask 4
provides:
  - {kind: "symbol", path: "app/src/screens/approvals/charterBlocks.ts", name: "TRACKER_ACCESS_FLAG"}
  - {kind: "symbol", path: "app/src/screens/chat/CharterCard.tsx", name: "CapabilityList"}
  - {kind: "symbol", path: "docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md", name: "## Validation 1"}
  - {kind: "symbol", path: "docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md", name: "## Validation 2"}
requires:
  - {from: "2", kind: "symbol", path: "kernel/src/agents/charter-readiness.ts", name: "TRACKER_ACCESS_FLAG"}
  - {from: "2", kind: "type", path: "app/src/api/contract.ts", name: "OwnerGrant"}
  - {from: "2", kind: "type", path: "app/src/api/contract.ts", name: "TrackerAccess"}
  - {from: "2", kind: "symbol", path: "kernel/src/agents/roster.ts", name: "tracker_access"}
  - {from: "3", kind: "symbol", path: "app/src/screens/team/Connectors.tsx", name: "CapabilityList"}
lanes:
  - "app/src/screens/chat/CharterCard.tsx"
  - "app/src/screens/approvals/CharterDisplay.tsx"
  - "app/src/screens/approvals/charterBlocks.ts"
  - "app/src/screens/approvals/ApprovalsScreen.tsx"
  - "app/src/screens/team/Inspector.tsx"
  - "app/src/screens/chat/CharterCard.test.tsx"
  - "app/src/screens/approvals/CharterDisplay.test.tsx"
  - "app/src/screens/approvals/charterBlocks.test.ts"
  - "app/src/screens/team/team.test.tsx"
  - "app/e2e/approvals.spec.ts"
  - "app/e2e/fixtures/approvals.ts"
  - "app/e2e/fixtures/chat.ts"
  - "docs/DESIGN.md"
  - "docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md"
external_requires:
  - "Validation 2 is a packaged-app walk with ClickUp connected, performed by the owner or the lane's validation step; a worker never writes its Verdict line"
```

### Subtask notes (what each worker builds)

- **1:** `MCP_TRACKER_CAPABILITIES` per kind: an ordered list of `{id, label, changes: boolean, tools: readonly string[]}` naming exact server tool names (from the AC20 probe for ClickUp; from `kernel/test/fixtures/mcp-trackers/jira-tools.json` and Atlassian's documented names for Jira, marked NEEDS VERIFICATION in `docs/OPEN_QUESTIONS.md`, D38). One capability id is the "read tickets" one Part C checks (it includes each tracker's poll tool, `MCP_TRACKERS[kind].tool`). `trackerCapabilities(kind, listed)` answers each capability's listed tools and `other_tools` (listed, uncovered: AC10); a tool can sit in at most one capability (a test pins it). `mcpConnectionView` adds `capabilities` and `other_tools` (null when the list cannot be built: AC12). `jobGroups(allowedTools, catalogue)` in catalogue.ts returns `[{job, label, tools}]` in `jobDisplayLines` order plus the not-in-catalogue tools; `GET /agents/:id` answers `jobs` (null when the settings file is refused or no catalogue was given). Nothing is granted or ticked by default (invariant 1).
- **2:** `TICKET_SOURCES = ["github", "clickup", "jira"]` and `DutyEntry.source?: TicketSource`, valid only on a duty whose `jobs` include a ticket job (`automate_tickets`); declared on that job's needs in `TOOL_JOB_DEFINITIONS` (one ticket job, not one per tracker). Readiness gets the tracker view (connected? which listed tools are "read tickets"?) as an input from `charter-tools.ts`, never by importing the store itself; it emits one flagged line per ticket duty: no source (AC17), not connected (AC18), or no read access (AC14, naming the member's display name and the tracker label, mirrored to the app as `TRACKER_ACCESS_FLAG`), and the agent note says the grant is the owner's step. `owner_grant` on approve: only for a pending `kernel_agent_create` / `kernel_agent_update`, kind an MCP tracker, every tool in that connection's stored list, else a 400 with nothing decided (AC19); applied inside the decision as the owner's grant (it rides on `AppliedApproval`, which `approvalApplierOf` in `kernel/src/tools/server.ts` passes to `applyOnApproval` unchanged — `t.applyOnApproval(parsed.data, { store, now: () => now, approval,` — so that file needs no change), recorded `by: "owner"`, before `openFlagsSentence`. A refused `owner_grant` reuses today's codes (`400 invalid_body` at the route, or the store's `invalid_approval`), so no new error code is added. `GET /agents/:id` answers `tracker_access`: one entry per ticket duty `{duty, source (null when unstated), status: "granted" | "no_access" | "not_connected" | "no_source", line}`, computed by the same readiness function the card uses (never a second rule), `null` when the settings file is refused; `charterProse` keeps cutting duties to their text. Wright's create description names `source` as a proposal and still says connectors is only the GitHub grant.
- **3:** PERMISSIONS: job labels first (from `jobs`), "Other tools" by name (AC3), then a collapsed `<details>` "Kernel tool names, as enforced" holding today's three lists unchanged (AC2). CONNECTORS MCP row: `CapabilityList` (granted / not granted / "partly granted (n of m)", a "changes things" mark for `changes: true`, expand shows raw names, "Other tools" listed and never ticked by a capability), every tick posting the full kind set through `changeMcpGrant`'s route and a result line naming the capability (AC7); raw per-tool list kept as the fallback when `capabilities` is null (AC12).
- **4:** The card's `readinessFix` on a `TRACKER_ACCESS_FLAG` line shows `CapabilityList` for that tracker (or "isn't connected" with Connect to Integrations, AC18); Create/Approve posts `{decision: "once", owner_grant}` when anything is ticked; the same slot on the Approvals screen's `CharterDisplay` (AC14 "in Approvals"). The inspector names a ticket duty's missing tracker access as open (AC16), from `GET /agents/:id` `tracker_access` (`status` other than `granted`). `docs/DESIGN.md` gains the inspector and card behaviour. The evidence file gains `## Validation 1` (command summaries) and `## Validation 2` (the walk steps, no Verdict line).

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2 ──→ Subtask 4
Subtask 1 ──→ Subtask 3 ──→ Subtask 4
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/src/features/catalogue.ts`, `kernel/src/agents/roster.ts`, `kernel/test/agents-roster.test.ts`, `app/src/api/contract.ts` | YES (2 requires 1) |
| Subtask 2 | Subtask 3 | none | NO |
| Subtask 1 | Subtask 3 | none | NO (3 requires 1) |
| Subtask 2 | Subtask 4 | none | NO (4 requires 2) |
| Subtask 3 | Subtask 4 | `app/src/screens/team/Inspector.tsx`, `app/src/screens/team/team.test.tsx` | YES (4 requires 3) |
| Subtask 1 | Subtask 4 | `docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md` | YES (4 reaches 1 through 2 and 3) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2, Subtask 3 (parallel — no shared file, both only after 1)
- **Batch 3:** Subtask 4 (after 2 and 3)
- **Recommended workers:** 2
- **Estimated batches:** 3

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |
| 4 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/features/catalogue.ts:91` | yes | HOLDS | `automate_tickets: Object.freeze({ label: "Hand tickets to /automate", needs: needs({ workspace: true, loomwrightCommands: ["/loomwright:automate"] }) }),` | tip 22 minutes ago, fetched <1h |
| `kernel/src/agents/charter-tools.ts:393` | yes | HOLDS | `"connectors is your proposal of the GitHub grant, never a default: say so to the owner; …"` | tip 22 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): about 40 files including tests, past the one-PR guide of 30; the owner chose one item | HIGH | Four dependency-ordered subtasks; each keeps its lanes; the one PR is reviewed as a whole at Phase 4.5. |
| Feasibility (Phase 2.5): ClickUp's real tool names live only in the owner's connection | MEDIUM | Subtask 1 runs the 21a read-only probe first; no token printed, no write, names and hints only; if the store or sign-in is unreadable the worker records that in the evidence file and stops for the owner rather than guessing names. |
| Feasibility (Phase 2.5): routes get a tool catalogue and an approve body gains `owner_grant` — both outside the requirement's Touches | MEDIUM | Recorded under `## Scope widening` for the coordinator's re-gate; both are additive optional fields following the `approvalApplier` and `decision` patterns. |
| The capability list drifts as ClickUp's beta server adds or renames tools (requirement risk) | MEDIUM | Exact names only; an unknown tool is "Other tools", never granted by a tick (AC10); a removed tool simply drops from the capability's listed set. |
| A capability tick grants more than the owner expects (requirement risk) | MEDIUM | Expanding a capability shows its exact tools (AC8); `changes: true` capabilities are marked in words (AC11); the rail still holds every `kernel_mcp_w_` call. |
| `owner_grant` widens who can grant if any non-owner path reaches the approve route | HIGH | Only the owner's approve route reads it (`by: OWNER`); Wright's charter is still refused for any MCP grant (AC19); a test pins that a create draft with `clickup` anywhere is refused and that a bad `owner_grant` decides nothing. |
| The create's settings file is written in the decision's `after` (`deferFiles`), so a grant merged too early is lost | MEDIUM | Subtask 2 applies the owner grant where the file is written (or right after `ensureAgentFiles`) and a test reads the member's settings file after approve. |
| "Kernel tool names, as enforced" is DESIGN.md wording, not an app constant today | LOW | Subtask 3 exports one constant and the e2e spec asserts it. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-14-crew-tracker-grant-in-plain-words.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-14T08:19:52Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/278
- **Branch:** feature/crew-tracker-grant-in-plain-words
- **Files changed:** 45
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Resumed run (--continue). Accepted subtask 2 on disk evidence, ran subtask 4, merged all four subtasks, opened PR #278. Phase 4.5 fixed 3 MEDIUM findings over 2 iterations (trackerLine display-name steering, agents.md drift, pinned flag constants unused by the matcher); round 3 PASS. 1 LOW dismissed below the floor. Drain not dispatched: .auto_review is false (the enclosing /automate owns it).

## Not verified
- **Packaged app with ClickUp connected (Validation 2 walk)** — owner-closed step; the steps are written, the Verdict line is deliberately left unwritten (subtask 4)
- **owner_grant against a live ClickUp connection** — exercised only by the kernel suite and the fixture kernels, not a real connection (subtask 4)
