# wa-e — Agents can look up sessions, events, approvals, budget and settings

## Status: ready

**As the** owner,
**I want** Wright (and a crew member, within its own items) to have read-only kernel tools for the details behind the Studio summary,
**so that** when I ask "why did last night's run fail?" or "what's waiting for me?" it can look, instead of guessing or telling me to open a screen.

## Why
The summary in wa-d is short by design. The details (a session's ending and output, the event log, a pending approval's payload, budget use per agent, the current settings) are only reachable through owner API routes today; no kernel tool reads them (checked 2026-11-21).

## Acceptance criteria
**Happy path**
- [ ] Given Wright's session, when it calls each new read tool, then it gets, read-only: a list of sessions (filter by agent, status, time) and one session's ending and recent output; the event log (filter by kind, agent, time); pending and recent approvals with their payloads; token use per agent against its limits; and the current settings (model, tool policy status, workspaces, connectors on).
- [ ] Given a crew member's session that the owner granted these tools through its charter, then every result covers only that member's own rows; asking for another agent's returns nothing and says so.
- [ ] Given the tool catalogue, then each new tool has a job and a purpose line, so Wright can propose it in a charter in plain words.
- [ ] Given the current proposed Wright tool list, then it includes the new tools (they reach an existing Wright through wa-c).

**Edge cases**
- [ ] Given a large result, then it is paged and bounded, with a stated count of what is left.
- [ ] Given any stored text that came from outside the owner (payloads, output, failure details), then the tool marks it as untrusted data.
- [ ] Given secrets in settings (API key, tokens), then they are never returned; only whether each is set.

**Error scenarios**
- [ ] Given a bad filter or an unknown id, then the tool returns a plain refusal naming the field, never a stack trace.

## Non-goals
- Any write, stop, kill or decision through these tools (approvals are decided only by the owner).
- Reading another agent's memory files.

## Owner decisions
- 2026-11-21: crew members see only their own items (D8 boundary); Wright sees all.
- 2026-11-21: new tools reach an existing Wright by upgrading an unedited proposed list (wa-c).

## Priority: MVP
**Rationale:** without it, the agent can name a problem from the summary but not explain it.

### Assumptions
- The tools reuse wa-d's query module and the owner routes' readers; no new tables.
- A crew member gets these tools only through a charter the owner approved (no preset).

### Dependencies
- Depends on: wa-c (delivers the tools to an existing Wright), wa-d (the shared query module). Blocks: none.

### Risks
- A crew member scoped wrong could read another member's work; the scoping test below pins it.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` with a case per tool, the crew scoping, paging, secret redaction, untrusted marking, the catalogue entries and the proposed list.
2. **Running system — Wright on the owner's install:** ask Wright "what did the last failed session say before it ended?"; it calls the session tool and quotes the ending.

## Depends on
2026-11-21-230200-wa-c-an-unedited-proposed-tool-list-gets-the-current-proposed-tools.md
2026-11-21-230300-wa-d-every-prompt-says-what-is-in-studio-right-now.md

## Touches
kernel/src/brain/studio-tools.ts
kernel/src/brain/index.ts
kernel/src/brain/settings.ts
kernel/src/brain/studio-view.ts
kernel/test/brain-studio-tools.test.ts
kernel/test/tool-catalogue.test.ts
kernel/test/feature-seams.test.ts
