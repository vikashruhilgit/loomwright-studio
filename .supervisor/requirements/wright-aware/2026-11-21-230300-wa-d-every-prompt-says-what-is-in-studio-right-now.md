# wa-d — Every prompt says what is in Studio right now, including recent mistakes

**As the** owner,
**I want** each agent's prompt to carry a short, current summary of Studio (what is running, waiting and scheduled, and what went wrong recently),
**so that** Wright answers "what's going on?" from facts, notices waiting approvals and limits, and does not repeat a mistake it made earlier today.

## Why
Today Wright can list tasks, triggers, playbooks and crew through tools, but nothing tells it about sessions, pending approvals, budget use, settings or its own failed messages (checked 2026-11-21: the 38 kernel tools contain no such reader). Every fact is already recorded by the kernel and served to the app (`GET /sessions`, `/approvals`, `/budget/usage`, `/schedule`, `/events`, `/messages`, `/settings`); the agent just never sees them.

## Acceptance criteria
**Happy path**
- [ ] Given a message to Wright, when its context is built, then it carries a **Studio right now** section, built by the kernel at that moment, with: crew members and whether each is on; playbooks on and off; triggers and the next time each fires; scheduled wakeups; running sessions; approvals waiting for the owner; token use against each limit and any cap reached; Wright's model and tool-policy status; and the local time it was taken.
- [ ] Given the same message, then the section ends with **Recent mistakes**: up to the last N (a kernel constant) failures of this agent from the last day — its failed messages and their `detail`, its tool calls the rail refused, its approvals the owner denied, its failed playbook runs — each one line with when and why.
- [ ] Given a message to a crew member, then its section shows only that member's own items: its playbooks, triggers, sessions, approvals, token use and recent mistakes; never another agent's.

**Edge cases**
- [ ] Given more items than fit, then each list is cut with a stated count of what was left out, and the section never exceeds its own fixed limit (pinned by a test); it is never cut by the whole-context limit.
- [ ] Given a resumed thread, then the section is still included (unlike the guide), because the state has changed since that conversation started.
- [ ] Given any text in the section that came from outside the owner (a playbook name, an approval payload, a failure detail), then it sits inside `<untrusted-data source="studio">`, like other untrusted text.

**Error scenarios**
- [ ] Given one source fails to read, then that line says it is unavailable and the rest of the section and the message still go through.

## Non-goals
- Tools for drilling into details (wa-e).
- Writing lessons (wa-f).
- Any write to Studio's state.

## Owner decisions
- 2026-11-21: crew is in scope; a crew member's view shows only its own items (each member stays its own boundary, D8). Wright sees all of Studio.

## Priority: MVP
**Rationale:** the owner's ask is an agent aware of the whole Studio; this is the always-present half of it.

### Assumptions
- The section reuses the same query functions the owner routes use (`kernel/src/gui/*`, `kernel/src/console/*`, `kernel/src/approvals/store.ts`), so the agent and the app never disagree.
- "Recent mistakes" sources exist today as rows and events: `brain_messages` `failed`, rail refusals, `approval_decided` deny, failed `playbook_runs`.

### Dependencies
- Depends on: wa-a (the context layout). Blocks: wa-e (shares the query module).

### Risks
- Token cost on every message; bounded by the section limit.
- Untrusted names in the snapshot (playbook titles, failure details) are a prompt-injection surface; covered by the wrapper AC.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` with cases for: every line present from a seeded store, the crew view showing only its own rows, the cut counts, the section limit, the untrusted wrapper, one source failing, and the resumed-thread case.
2. **Running system — Wright on the owner's install:** with one approval waiting and one failed message in the last day, ask Wright "what's going on in Studio?"; the answer names the waiting approval and the failure.

## Depends on
2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is.md

## Touches
kernel/src/brain/studio-view.ts
kernel/src/brain/context.ts
kernel/src/brain/handler.ts
kernel/test/brain-studio-view.test.ts
docs/architecture/brain.md
