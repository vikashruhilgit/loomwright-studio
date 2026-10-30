# UI

"No compromise on UI" (D9). Design comes first: nothing is coded until the owner approves the mockups.

**Phase 0 is complete.** The approved design system and mockups, and what the review changed, are in `DESIGN.md`. The rest of this file is the original brief plus the additions the review made (marked *added in review*).

## Phase 0 deliverables

1. **Design system:**
   - type scale
   - colour tokens (light + dark)
   - spacing
   - radii and elevation
   - motion (durations, easing, reduced-motion)
   - iconography
   - the component set: buttons, inputs, lists, cards, tables, chat bubbles, diff views, streaming log, status dots, badges, toasts, dialogs, the ⌘K palette
2. **High-fidelity, clickable mockups** of every main screen below, in light and dark.
3. **Owner review and approval**, iterated until approved.

## Principles

- **Target quality bar:** Linear or Raycast.
- **Keyboard-first:** a ⌘K command palette; every action reachable without the mouse.
- **Live without jank:** streaming session output and new approvals appear without layout shift.
- **Native macOS feel:** vibrancy, menu-bar presence, native notifications, windows that restore where they were.
- **Accessibility:** WCAG 2.1 AA, including contrast in both themes and full screen-reader labels.
- **Every state designed:** empty, loading, error and "waiting on you" states are designed, never left as defaults.
- **Honest status:** a task or session never shows green unless the kernel has verified it.
- **A polish gate per screen:** each built screen passes a design review in the running app, not just in the mockup.

## Screens

| Screen | Purpose |
|---|---|
| **Chat** | Talk to Wright. Replies can carry a drafted playbook or a drafted crew charter with its dry-run preview and Enable / Create / Edit actions. *Added in review:* a thread is a timeline: system events (session started, playbook created, memory updated, approval decided) appear as one-line cards, and an agent's pending approval appears inline at the end of its thread |
| **Crew** (sidebar group) | *Added in review (D25):* one thread per specialist with presence: avatar state, last line, time, unread. Wright is not listed here; Chat is his thread |
| **Team** | Agent cards: avatar, name, role, current task, tokens today against the daily limit, status. Create (from a charter, D22), rename, or open an agent's thread. The inspector shows role, kernel-enforced permissions, model and limits, and the memory files as paths |
| **Tasks** | A board grouped by state. Cards show linked PRs/tickets and state (e.g. "1/2 approvals · CI green · waiting on Mason"); click through to history and session logs |
| **Playbooks** | Every behaviour Wright has written: plain-English intent, trigger, dedupe key, priority, model, last run, cost, on/off. Edit in English or directly |
| **Schedules & triggers** | A timeline of upcoming wake-ups, polls and cron jobs, plus firing history |
| **Sessions** | Live running sessions: agent, task, running time, tokens. Streaming output; **Stop** and **Kill** |
| **Approvals** | Inbox of pending actions showing exactly what will happen (review text, hook diff, message). Allow once / Always for this playbook / Deny |
| **Memory** | View and edit each agent's role, preferences, people and lessons files, plus shared memory |
| **Hooks** | Installed hooks, their scope, whether they're verified to fire, one-click rollback |
| **Integrations** | Optional connectors: connect, disconnect, see scopes. *Phase 6, GitHub only (owner, 2026-10-24); see the note below* |
| **Budget & audit** | Usage per day, playbook and agent against caps; cap state; the full event log |
| **Settings** | Auth provider, data location, launch at login, notifications, theme |

**Menu-bar icon:**
- a status dot: idle / working / waiting on you / paused at cap
- the approval count
- quick actions: Open, **Pause all**, **Kill switch**

**Avatars** (*added in review*, D23): every crew member is a sea creature stitched from its own thread; Wright is the crowned whale. The loose thread end carries the kernel state (sways, sews, rises to you, hangs slack, ties a bow, is cut), so state is legible with motion off. Specified in the design system's Avatar component.

**Limits** (*added in review*, D24): tokens per day and sessions at once per agent; dollars only as estimates.

**GUI v1** (roadmap phase 5): menu bar, Chat (with Crew threads), Team, Approvals, Sessions. **GUI v2** (phase 7): all the rest.

**Integrations is phase 6, GitHub only** (the owner's decision, 2026-10-24). The ROADMAP's phase 6 row wins over the GUI v2 listing above: phase 6 builds the real Integrations screen with GitHub as its only connector (connect, disconnect, scopes, expiry, status and the repos the token reaches), on `⌘5` after Sessions, from a mockup the owner approves first (D9). Phase 7 adds its polish and the other connectors. DESIGN.md gets the matching note in phase 6.

**Hooks is phase 9** (the owner's decision, 2026-10-30). Phase 7's GUI v2 builds the other screens above (Tasks, Playbooks, Schedules, Memory, Budget & audit, Settings) and leaves the Hooks row as written; the Hooks screen moves to phase 9.

**Tasks in phase 7.** A read-only board grouped by state, over the kernel's tasks, playbook runs and sessions. Each card shows its kind and state, and opens its history: the events that touched it, its runs, its sessions and any approvals that name it. It shows only what the kernel recorded; there is no edit or create. The shortcuts are a proposal (Tasks `⌘6`, Playbooks `⌘7`, Schedules `⌘8`, Memory `⌘9`, Budget & audit none, Settings `⌘,`) until the GUI v2 mockup sets the final ones.
