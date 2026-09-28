# UI

"No compromise on UI" (D9). Design comes first: nothing is coded until the owner approves the mockups.

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
| **Chat** | Talk to Wright (or any agent). Replies can carry a drafted playbook with its dry-run preview and Enable / Edit actions |
| **Team** | Agent cards: avatar, name, role, current task, spend, status. Create or rename agents; chat with one directly |
| **Tasks** | A board grouped by state. Cards show linked PRs/tickets and state (e.g. "1/2 approvals · CI green · waiting on Mason"); click through to history and session logs |
| **Playbooks** | Every behaviour Wright has written: plain-English intent, trigger, dedupe key, priority, model, last run, cost, on/off. Edit in English or directly |
| **Schedules & triggers** | A timeline of upcoming wake-ups, polls and cron jobs, plus firing history |
| **Sessions** | Live running sessions: agent, task, running time, tokens. Streaming output; **Stop** and **Kill** |
| **Approvals** | Inbox of pending actions showing exactly what will happen (review text, hook diff, message). Allow once / Always for this playbook / Deny |
| **Memory** | View and edit each agent's role, preferences, people and lessons files, plus shared memory |
| **Hooks** | Installed hooks, their scope, whether they're verified to fire, one-click rollback |
| **Integrations** | Optional connectors: connect, disconnect, see scopes |
| **Budget & audit** | Usage per day, playbook and agent against caps; cap state; the full event log |
| **Settings** | Auth provider, data location, launch at login, notifications, theme |

**Menu-bar icon:**
- a status dot: idle / working / waiting on you / paused at cap
- the approval count
- quick actions: Open, **Pause all**, **Kill switch**

**GUI v1** (roadmap phase 5): menu bar, Chat, Team, Approvals, Sessions. **GUI v2** (phase 7): all the rest.
