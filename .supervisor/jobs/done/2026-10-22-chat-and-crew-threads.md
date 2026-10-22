# Supervisor Job: Build the Chat screen and Crew threads: Wright's thread, one thread per specialist, event cards, inline approvals, playbook / trigger / charter cards and their ⌘K commands

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-071939/L1
- **CLAUDE.md:** ✓ Found (fresh: `kernel/` + `app/` layout, invariants and conventions match the tree at the base commit)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140013-chat-and-crew-threads.md
- **Base commit:** 3f3b9f4d73f64051c0b0f9f44c5745e8b1bd6940

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is Electron + React 19 + TS + Vite, vitest + React Testing Library (jsdom pragma, as `app/src/App.test.tsx`), Playwright Electron e2e through `app/e2e/electron-harness.ts` (`launchApp`) against `app/e2e/fixture-kernel.ts` (`startFixtureKernel({ routes, events })`). |
| 2 | Dependency Availability | GO | No new npm dependency is needed or allowed. Everything the screen needs is on `main`: the live store (`app/src/store/react.ts` `useResource`, `liveStoreFor`; `app/src/store/resources.ts` `threadResource`), the bridge (`getBridge().request`), the registry (`app/src/commands/registry.ts` `commandRegistry`), and the components `ChatBubble`, `EventCard`, `Avatar`, `Button`, `Input`, `List`, `Badge`, `StatusDot`, `Toast`, `Dialog`. |
| 3 | Architecture Fit | CAUTION | Four contract gaps, none fixable inside this item's Touches (requirement: "a missing route or field is a finding, so stop and say so"): (a) no route or thread card serves a playbook's last dry run (`playbook_dry_run` is not in the kernel's `THREAD_EVENT_KINDS`, and `PlaybookDetailResponse` has no dry-run field); (b) a parked message's retry time exists only inside `BrainMessage.detail` text (`admission_refused: <reason>; retry at <ISO>` or `retry time unknown`, written in `kernel/src/brain/handler.ts`); (c) the `EventCard` approval variant (item 10) always renders Always, with no prop to hide it, while the app cannot see the kernel's full `alwaysRefusal` conditions; (d) `CommandPaletteHost` (item 11) is not mounted in `App.tsx`, so ⌘K commands this screen registers are reachable only once the shell mounts the palette. |
| 4 | Scope vs Supervisor Capability | GO | One screen directory plus one fixture, one spec and one evidence dir: one coherent group. Single agent. |
| 5 | Hard Blockers | GO | No migration, credentials or missing modules. `app/node_modules` is not installed in this checkout; `npm ci` in `app/` installs it. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Replace the Chat stub (`app/src/screens/chat/index.tsx`) with the approved Chat screen and the sidebar's Crew group: Wright's thread and one thread per specialist (item 06's `GET /threads/:agent`, live through the item 12 store), message bubbles interleaved with one-line event cards, the agent's pending approval inline at the end, a composer that sends `POST /ask`, playbook / trigger / charter cards with their actions, and the ⌘K commands this screen registers. Committed light/dark screenshots of every designed state are the polish-gate evidence.

**Problem Statement:**
The owner needs to do in the app everything they did with `studio ask`, `studio messages` and `studio playbooks`.
Today Chat is a placeholder and the Crew group always reads "No specialists yet", so none of those verbs is reachable without a terminal.
Success: the owner types to Wright or a specialist, sees the reply when the message row turns `replied`, acts on approvals and playbook / trigger / charter cards inline, and reaches every action by keyboard.

### Design contract (from `docs/design/mockups/gui-v1.html` `renderChat` / `#crewnav`, `docs/DESIGN.md` §5, the component READMEs under `docs/design/design-system/components/`)
- **Routing:** Chat is always Wright's thread at `#/chat`. A specialist's thread is `#/chat/<agent-id>` (the shell's `screenForHash` already maps any `#/chat/...` to this screen; the screen parses the rest itself). An id not in `GET /agents` falls back to Wright's thread. Wright never appears under Crew (D25).
- **Title row (inside the screen, never an `<h1>`; the shell owns the only `h1`):** "with Wright" or "with <display_name>", the agent's state chip (`StatusDot` + state word), and for a specialist an "Open in Team" ghost button (`#/team`).
- **Crew group (`SidebarSection`):** a heading "Crew" (kept). One row per roster entry other than `wright` (`useResource("agents")`), each a button: 24px `Avatar` with its state, the display name, the time of its last message row, its last line (the newest message text or reply, one line, ellipsised), and an unread dot. Unread = a message row newer than the last one the owner saw in that thread; the last-seen id per agent is kept in `localStorage`, every read and write wrapped in try/catch, so it renders correctly without storage. Avatar state: `danger` for a roster `status` of `off`, `waiting` when a pending approval names the agent, `working` when `sessions_running > 0`, else `idle`. With no specialists, the group shows the existing empty line and renders no button.
- **Thread:** items from `useResource(threadResource(agent))` rendered oldest first. A `message` item renders the owner's turn (`ChatBubble` `from="user"`, `text`) and, once `status === "replied"`, the agent's turn (`ChatBubble` `from="wright"` or `"specialist"`, `reply_text`). `queued` / `running` show a pending line ("Wright is working on it"). `failed` shows the kernel's reason (`detail`) as text. `parked` shows "Paused: retries at <time>" with the time parsed from `detail`'s `retry at <ISO>`, or "retry time unknown". A message whose `from_agent` is non-null (a delegation or a reply from another agent) renders as a quoted block, labelled with its source (`from_agent`, `source`), as data, never as the owner's words. An `event` item renders `EventCard variant="event"` with the kernel's `summary` text, its kind mapped onto EventCard's six kinds (`session_status` → session, `playbook_*` and `trigger_fired` → playbook, `agent_*` → agent, `approval_*` → approval), and its time. Paging backwards: "Load earlier" fetches `GET /threads/:agent?before=<next_before>` through the bridge and prepends the page; it is hidden once `next_before` is `null`. New items keep the scroll pinned to the end only when the owner was already at the end.
- **Pending approval inline at the end:** each `pending_approvals` entry whose `requesting_agent` is this thread's agent renders `EventCard variant="approval"` (summary from `display`, else `action`; reason from the playbook slug when present). Allow once → `POST /approvals/:id/approve` `{decision:"once"}`; Always → `{decision:"always"}`; Deny → `POST /approvals/:id/deny`; Full payload → `#/approvals`. Always is eligible only when `approval.playbook !== null`; for an ineligible approval the Always handler calls no route and shows "Always needs an approval from a playbook session; approve once", and a `409 always_not_supported` from the kernel shows its `message`. A kernel refusal on any action shows its `error` / `message` as text and leaves the card in place.
- **Charter card:** a pending approval with `action === "kernel_agent_create"` renders, instead of the plain approval card, a charter card: the approval's `display` as preformatted text (mono, untrusted, never parsed), with Create (approve once), Edit in English and Deny. Edit in English puts "About the charter in approval <id>: " into the composer and focuses it; nothing is sent until the owner sends.
- **Playbook card:** for each playbook named by a `playbook_created` / `playbook_updated` event card in the loaded thread (`ref.playbook_id`), once, after its newest such event: intent, trigger (from `GET /triggers` by `trigger_id`, its `kind` and `next_fire_at`), dedupe key, priority, model, token limit per day and API-key fallback, each marked "proposed" when its `*_set_by` is `wright` and "set by owner" when it is `owner`, and the last dry run. The last dry run is not served by any route (Feasibility gap (a)): the card reads "Last dry run: not available from the kernel yet" and the gap is recorded as a finding. Actions: Run now → `POST /playbooks/:id/run`; Turn off → `POST /playbooks/:id/off`; Set <field> → a small inline form choosing one of `dedupe_key`, `priority` (`low` / `normal` / `high`), `model`, `token_limit`, then `POST /playbooks/:id/set` `{field, value}` (both strings). There is no Enable action: enabling stays an approval, which shows as a pending approval.
- **Trigger card:** for each `trigger_fired` event's trigger (`ref.trigger_id`) and each playbook card's trigger: its kind, text and enabled state, with On (`POST /triggers/:id/on`, `{}`; a `409 needs_confirmation` asks the owner once, then resends `{confirm:true}`) and Off (`POST /triggers/:id/off`).
- **Composer:** a multi-line `Input` (Enter sends, Shift+Enter is a newline, empty / blank text cannot send, at most 8000 characters) and a Send button. Sends `POST /ask` `{text, agent}` with `agent` set to the thread's agent (`"wright"` for Chat). A specialist's composer shows a workspace picker whose only options are "No workspace" and that agent's `workspaces` from `GET /agents/:id` (fetched through the bridge); a `null` list shows only "No workspace". Wright has no listed workspaces (the kernel answers none), so Wright's composer shows no picker. A `202` clears the composer and refetches the thread; a refusal (`409 workspace_not_listed`, `400 invalid_body`, any other) shows its `error` / `message` and keeps the text.
- **Designed states:** empty thread (Wright: "Ask Wright anything. It drafts playbooks and crew for you to approve."), loading (thread resource `loading` with no data), error (the thread resource's `error`, with the shell's kernel-unreachable band above, which `App.tsx` already renders), waiting on you (a pending approval at the end), and populated.
- **⌘K commands (registered from the always-mounted Crew `SidebarSection`, so they exist on every screen; unregistered on unmount):** "Ask Wright" (navigate to `#/chat` and focus the composer); "Ask <name>" per specialist; per playbook: "Run <slug>", "Turn off <slug>", "Set <slug> priority high / normal / low" (one command each); per trigger: "Turn on trigger <id>: <text>" or "Turn off …" by its current state; "Open notifications": one command per recent `GET /notifications` row (at most 20, group `Notifications`), titled with the notification's title, which only navigates and never acts: a `source` of `agent:<x>` (the kernel writes the posting session's agent there, `kernel/src/notifications/tool.ts`) opens that thread when `<x>` is a roster `id`, and any other source (or an unknown `<x>`) opens Wright's thread. Group names: `Agents` for ask commands, `Playbooks` for playbook and trigger commands. Ids are prefixed `chat.` and unique (the registry throws on a collision).
- **Untrusted text:** every kernel string (`text`, `reply_text`, `detail`, `summary`, `display`, playbook `name` / `intent`, notification `title`) is a React text child only. No `dangerouslySetInnerHTML`, no `href` built from kernel text. `ChatBubble` already renders its body inert; the screen keeps it that way for every other surface.
- **Colours:** only `var(--…)` tokens from `app/src/styles/tokens.css` in any new CSS; no hex, `rgb()`, `hsl()` or named-colour literal.

### Implementation constraints (binding)
- **Do not edit any file outside the File Impact Map.** In particular not `app/src/App.tsx`, `app/src/App.test.tsx`, `app/src/screens/types.ts`, `app/src/commands/*`, `app/src/store/*`, `app/src/api/*`, `app/e2e/fixture-kernel.ts`, `app/e2e/electron-harness.ts`, `app/package.json`, anything under `app/src/components/`, or any `kernel/` file. A gap is recorded as a finding in the evidence README, never patched.
- **Test seams:** the screen's components take optional props `api?: StudioBridge` and `registry?: CommandRegistry` (default `commandRegistry`), as `App` does, so unit tests inject `fakeBridge()` from `app/src/store/fake-bridge.ts` and `createCommandRegistry()`.
- **No bridge is a real case (binding):** the shell renders `<Screen />` and `<s.SidebarSection key={s.id} />` with no props, and in `app/src/App.test.tsx` `window.api` is undefined (its fake bridge reaches only `<App api=…>`, and there is no vitest setup file). `getBridge()` then returns `undefined`, and `useResource(name, undefined)` throws (`app/src/store/react.ts` `held.set(api, entry)` on a WeakMap). So resolve the bridge as `props.api ?? getBridge() ?? INERT_BRIDGE`, where `INERT_BRIDGE` is one module-level bridge declared inside `app/src/screens/chat/` (`connection` → `{state:"unreachable", reason:"connection_failed"}`, `request` → `{ok:false, status:0, connection:{state:"unreachable", reason:"connection_failed"}}`, feed and `onNavigate` no-ops). The hooks are always called in the same order, nothing throws, the Crew section shows its empty line and no button, and the screen shows its error state. `getBridge()` is typed non-null (`readonly api: StudioBridge` on `Window`), so put a one-line comment on the fallback saying the runtime value can be undefined (App.test.tsx, before the preload), so a later "unnecessary `??`" cleanup does not remove it. Type `INERT_BRIDGE` as `StudioBridge`: `feed.subscribe` returns a Promise, and `onFrame` / `onNavigate` return an unsubscribe.
- **Writes go through the bridge, reads through the store:** POSTs call `api.request({ method: "POST", path, params, body })` with the contract route paths exactly as in `CONTRACT_ROUTES`; after an `ok` answer the screen calls `liveStoreFor(api).refetch(...)` for the affected resources (the feed also refetches them).
- **Files may be split** inside `app/src/screens/chat/` (for example `Thread.tsx`, `Composer.tsx`, `cards.tsx`, `CrewSection.tsx`, `commands.ts`, `chat.css`, tests), as long as `index.tsx` still exports `screen`. No barrel file elsewhere.

## Acceptance Criteria
- [ ] **AC1 (send to Wright):** Given the fixture kernel, when the owner types in Chat and sends, then `POST /ask` is called with `agent: "wright"` and the typed text, and the reply bubble appears when the message row turns `replied` (unit test with `fakeBridge`, and `app/e2e/chat.spec.ts` against `startFixtureKernel`, whose `POST /ask` route records the body and whose `GET /threads/:agent` answers the row `queued`, then `replied` after an appended `event_done` event).
- [ ] **AC2 (crew thread):** Given a crew member `pim` with `workspaces: ["~/work/a"]`, when the owner opens its Crew row and sends, then `POST /ask` carries `agent: "pim"`. The workspace picker offers only "No workspace" and `~/work/a`, a workspace not in the list cannot be chosen, and choosing `~/work/a` sends `workspace: "~/work/a"`. Wright's composer shows no picker. A blank composer cannot send, and a refusal (`409 workspace_not_listed`) shows the kernel's error and keeps the typed text.
- [ ] **AC3 (inline approval):** Given a pending approval requested by `wright`, then it shows inline at the end of Chat, after every thread item, and Allow once calls `POST /approvals/:id/approve` with `{decision:"once"}`. Deny calls `POST /approvals/:id/deny`. An approval requested by another agent does not show in Wright's thread. For an approval with `playbook: null`, Always calls no route and shows the eligibility note.
- [ ] **AC4 (playbook card):** Given a playbook card whose priority is `normal` set by `wright`, then priority reads "proposed". When the owner chooses Set priority high, then `POST /playbooks/:id/set` is called with `{field:"priority", value:"high"}`, and after the refetched playbook answers `priority_set_by: "owner"`, the card shows "set by owner". Run now calls `POST /playbooks/:id/run`, Turn off calls `POST /playbooks/:id/off`, and the card offers no Enable action.
- [ ] **AC5 (trigger and charter cards):** Given a trigger card, then On calls `POST /triggers/:id/on` and Off calls `POST /triggers/:id/off`; an On answered `409 needs_confirmation` asks the owner once and, on confirm, resends with `{confirm:true}` (cancel sends nothing). Given a pending `kernel_agent_create` approval, then the charter card shows its `display` text, Create calls `POST /approvals/:id/approve` with `{decision:"once"}`, Deny calls `POST /approvals/:id/deny`, and Edit in English fills and focuses the composer without sending.
- [ ] **AC6 (inert text):** Given a reply holding `<img src=x onerror=alert(1)>` and `[x](javascript:alert(1))`, and an approval `display` and event `summary` holding the same, then each renders as literal text: no `img` element, no `a[href^="javascript:"]` anywhere in the screen.
- [ ] **AC7 (message states and paging):** Given rows `failed` (with `detail`), `parked` (with `detail` `admission_refused: cap; retry at 2026-10-22T09:00:00.000Z`) and `parked` with `retry time unknown`, then the failure shows the kernel's reason and each parked row shows its retry time or "retry time unknown". Given a thread with `next_before` set, Load earlier calls `GET /threads/:agent` with `before` and prepends the older items; with `next_before: null` it is not shown.
- [ ] **AC8 (Crew group and ⌘K):** Given roster entries `wright` and `pim`, then the Crew group lists only `pim`, with its avatar, last line, time and an unread dot until its thread is opened; given only `wright`, the group shows the empty line and no button (so `App.test.tsx`'s exact sidebar button list still holds). Rendered with no `api` prop and `window.api` undefined, the Crew section and the screen render without throwing (empty line, error state). `#/chat/pim` opens Pim's thread and `#/chat/nobody` falls back to Wright's. The registry (injected) holds "Ask Wright", "Ask Pim", each playbook's run / turn off / set priority commands, each trigger's on-or-off command and one command per notification; running "Set <slug> priority high" calls `POST /playbooks/:id/set`, and running a notification command only changes `window.location.hash`.
- [ ] **AC9 (evidence and keyboard):** Given `cd app && npm ci && npm run typecheck && npm test && npm run build` passes and `npm run e2e` passes `chat.spec.ts`, then screenshots of every designed state (empty, loading, error with the kernel-unreachable band, waiting on you, populated with a playbook card, a trigger card and a charter card, and a crew thread) in light and dark mode are committed under `docs/evidence/phase-5-polish/chat/`. A keyboard-only test reaches every action (Crew row, Load earlier, each card button, composer, workspace picker, Send) with Tab / Shift+Tab and runs it with Enter or Space. A committed evidence file `docs/evidence/phase-5-polish/chat/README.md` lists each screenshot with the `docs/design/mockups/gui-v1.html` Chat state it matches, how to regenerate them, and the owner findings: Feasibility gaps (a)–(d), and any mockup-vs-component mismatch. The PR body links to it.

## Touched-file invariants

> Grounded at base `3f3b9f4d73f64051c0b0f9f44c5745e8b1bd6940`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/chat/index.tsx`** — keep: the module still exports `screen` (`export const screen: ScreenDefinition = {`) with `id: "chat"`, `title: "Chat"` and `nav: { label: "Chat", order: 1, shortcut: "⌘1" }`, and a `SidebarSection`; the screen root keeps `data-testid="screen-chat"`; the Crew section keeps its heading (`aria-labelledby="nav-crew"`, text `Crew`) and its empty line `No specialists yet. Wright proposes one when a duty needs it.` when there are no specialists. mirror: `app/src/screens/types.ts` `readonly SidebarSection?: ComponentType;` (no required props: the shell renders `<s.SidebarSection key={s.id} />`). pinned by: `app/src/App.test.tsx` — `expect(sidebar.getAllByRole("button").map((b) => b.textContent)).toEqual(["Chat⌘1", "Team⌘2", "Approvals⌘3", "Sessions⌘4"]);` (so with no specialists the Crew group renders no button, and no crew row's text may join that list in that test), `sidebar.getByRole("heading", { name: "Crew" })`, `screen.getByTestId("screen-chat")` with `window.api` undefined in every case (the screen and the Crew section must render with no bridge at all: the inert fallback above), `screen.getByRole("heading", { level: 1 }).textContent).toBe(entry?.title)` (the screen renders no `h1`), and the registry test `["screens.chat", "Screens", "⌘1"]` (an injected registry: the screen registers into its own default `commandRegistry`, never into the shell's `registry` prop); `app/e2e/smoke.spec.ts` — `sidebar.getByRole("button", { name: new RegExp(`^${entry}`) })` (a crew row's accessible name must never start with "Chat", "Team", "Approvals" or "Sessions": it starts with the agent's display name).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/chat/` composer test — "sends POST /ask with agent wright" | in the composer's send handler, drop `agent` from the `POST /ask` body → red |
| `app/src/screens/chat/` thread test — "reply bubble appears only when replied" | render `reply_text` for every status instead of only `replied` → red |
| `app/src/screens/chat/` composer test — "crew thread sends agent: pim" | send `agent: "wright"` for every thread → red |
| `app/src/screens/chat/` composer test — "workspace picker offers only listed workspaces" | build the picker options from a free-text input instead of `workspaces` → red |
| `app/src/screens/chat/` composer test — "Wright shows no workspace picker" | render the picker for every agent → red |
| `app/src/screens/chat/` thread test — "pending approval inline at the end, Allow once approves once" | send `{decision:"always"}` from Allow once → red |
| `app/src/screens/chat/` thread test — "another agent's approval is not shown" | drop the `requesting_agent` filter on `pending_approvals` → red |
| `app/src/screens/chat/` thread test — "ineligible Always calls no route" | delete the `approval.playbook !== null` eligibility check → red |
| `app/src/screens/chat/` cards test — "Set priority high posts and shows set by owner" | map `*_set_by: "owner"` to "proposed" → red |
| `app/src/screens/chat/` cards test — "no Enable action on a playbook card" | add an Enable button calling `POST /playbooks/:id/set` → red |
| `app/src/screens/chat/` cards test — "trigger On / Off routes" | swap the `/on` and `/off` paths → red |
| `app/src/screens/chat/` cards test — "charter Edit in English fills the composer, sends nothing" | call `POST /ask` from Edit in English → red |
| `app/src/screens/chat/` thread test — "HTML and javascript: links render inert" | render `summary` through `dangerouslySetInnerHTML` → red |
| `app/src/screens/chat/` thread test — "parked row shows retry time" | ignore `detail` and always show "retry time unknown" → red |
| `app/src/screens/chat/` thread test — "Load earlier sends before and prepends" | drop the `before` query from the page request → red |
| `app/src/screens/chat/` crew test — "no specialists renders no button" | render a "New specialist" button in the empty Crew group → red |
| `app/src/screens/chat/` crew test — "Wright is never under Crew" | drop the `id !== "wright"` filter on the roster → red |
| `app/src/screens/chat/` commands test — "notification command only navigates" | make the notification command call `api.request` → red |
| `app/src/screens/chat/` commands test — "Set <slug> priority high command posts set" | register the command with `run` as a no-op → red |
| `app/src/screens/chat/` keyboard test — "every action reachable by Tab" | give a card button `tabIndex={-1}` → red |
| `app/src/screens/chat/` crew test — "renders with window.api undefined" | drop the `?? INERT_BRIDGE` fallback → red |
| `app/src/screens/chat/` composer test — "blank text cannot send" | delete the blank-text guard in the send handler → red |
| `app/src/screens/chat/` composer test — "refusal keeps the typed text" | clear the composer before awaiting the `POST /ask` answer → red |
| `app/src/screens/chat/` cards test — "needs_confirmation resends with confirm" | drop `{confirm:true}` from the resend → red |
| `app/src/screens/chat/` thread test — "unknown #/chat/<id> falls back to Wright" | use the hash id without checking it against the roster → red |
| `app/src/screens/chat/` crew test — "unread dot clears once the thread is opened" | never write the last-seen id when a thread is opened → red |
| `app/src/screens/chat/` crew test — "renders without storage" (a `localStorage` stub that throws) | remove the try/catch around the `localStorage.getItem` read → red |
| `app/src/screens/chat/` cards test — "Run now / Turn off routes" | swap the `/playbooks/:id/run` and `/playbooks/:id/off` paths → red |
| `app/src/screens/chat/` thread test — "Deny posts deny" | send Deny to `/approvals/:id/approve` → red |
| `app/src/screens/chat/` cards test — "charter Create approves once" | send `{decision:"always"}` from Create → red |
| `app/src/screens/chat/` thread test — "409 always_not_supported shows the kernel's message" | show a fixed string instead of the refusal's `message` → red |

## Closed enumerations touched

> Sibling grep at base `3f3b9f4`: `grep -rnF '"Playbooks"' app/src` → `app/src/components/CommandPalette/fuzzy.ts` (`GROUP_ORDER`) plus palette tests and gallery fixtures.

- **`Notifications`** (palette group; sibling: `Playbooks`) — must be named in:
  - `app/src/components/CommandPalette/fuzzy.ts` — the palette's closed group order, `GROUP_ORDER = ["Actions", "Screens", "Agents", "Playbooks", "Sessions", "Tasks"]` — no change: the file is item 11's and off-limits here; an unknown group sorts after the known ones in first-registration order (by design), so `Notifications` shows last. Recorded as an owner finding in the evidence README.
  - palette tests / gallery fixtures — no change: fixtures, not closed lists.
- `Agents` and `Playbooks` (the other groups this item uses) are already in `GROUP_ORDER`.

## File Impact Map

| Path | Action | Confidence | Notes |
|------|--------|------------|-------|
| `app/src/screens/chat/index.tsx` | modify | HIGH | Replace the stub; keep the `screen` export and the invariants above. |
| `app/src/screens/chat/*.tsx`, `*.ts`, `chat.css` | create | MEDIUM | Thread, composer, cards, Crew section, command registration, styles; exact split is the worker's. |
| `app/src/screens/chat/*.test.tsx` | create | HIGH | AC1–AC8 and the keyboard part of AC9, with the jsdom pragma, `fakeBridge()` and an injected `createCommandRegistry()`. Picked up by `"test": "vitest run src electron scripts"`. |
| `app/e2e/fixtures/chat.ts` | create | HIGH | Canned `GET /agents`, `GET /agents/:id`, `GET /threads/:agent`, `GET /playbooks`, `GET /triggers`, `GET /notifications`, `GET /messages`, `GET /approvals` and recording POST routes, typed by `app/src/api/contract.ts`. |
| `app/e2e/chat.spec.ts` | create | HIGH | `launchApp(fixture.env)` + `startFixtureKernel(chatFixture)`; AC1, AC2, AC9 states in both themes (`data-theme` on `<html>`), screenshots written as the existing `components.*.spec.ts` do. Typechecked by `app/tsconfig.node.json`. Needs `npm run build` first. |
| `docs/evidence/phase-5-polish/chat/README.md` | create | HIGH | AC9 evidence and owner findings. |
| `docs/evidence/phase-5-polish/chat/*.png` | create | MEDIUM | One per state per theme (about 14 images). |

Existing files read, not modified: `app/src/App.tsx`, `app/src/App.test.tsx`, `app/src/screens/types.ts`, `app/src/api/contract.ts`, `app/src/store/react.ts`, `app/src/store/resources.ts`, `app/src/store/store.ts`, `app/src/store/fake-bridge.ts`, `app/src/commands/registry.ts`, `app/src/components/{ChatBubble,EventCard,Avatar,Button,Input,List,Badge,StatusDot,Toast}/`, `app/e2e/fixture-kernel.ts`, `app/e2e/electron-harness.ts`, `app/e2e/smoke.spec.ts`, `kernel/src/console/threads.ts`, `kernel/src/brain/handler.ts`, `kernel/src/approvals/store.ts`, `kernel/src/playbooks/store.ts` (`PLAYBOOK_POLICY_FIELDS`).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Chat screen, Crew threads, cards, ⌘K commands, e2e and evidence | all | 1 modify, ~10 create (+ screenshots) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Chat screen + Crew threads + cards + commands + e2e + evidence (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/screens/chat/index.tsx"}
  - {kind: "symbol", path: "app/src/screens/chat/index.tsx", name: "screen"}
  - {kind: "file", path: "app/e2e/fixtures/chat.ts"}
  - {kind: "file", path: "app/e2e/chat.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/chat/README.md"}
requires: []
lanes:
  - "app/src/screens/chat/**"
  - "app/e2e/fixtures/chat.ts"
  - "app/e2e/chat.spec.ts"
  - "docs/evidence/phase-5-polish/chat/**"
external_requires:
  - "Items 01, 06, 08-12 merged on main: contract, thread route, primitives, Avatar, conversation components, palette registry, live store (read-only)"
  - "Electron binary download for npm run e2e (node node_modules/electron/install.js)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): no route serves a playbook's last dry run | MEDIUM | Card reads "Last dry run: not available from the kernel yet"; record the finding (candidate: add `playbook_dry_run` to the thread's kinds or a dry-run field to `GET /playbooks/:ref`). No kernel edit. |
| Feasibility (Phase 2.5): parked retry time only inside `detail` text | MEDIUM | Parse `retry at <ISO>` with one anchored regex; anything else shows "retry time unknown". Record the finding (a typed field would be sturdier). |
| Feasibility (Phase 2.5): `EventCard` always renders Always; app sees only part of `alwaysRefusal` | MEDIUM | Eligibility = `approval.playbook !== null`; an ineligible Always calls no route and explains; a kernel `409 always_not_supported` shows its message. Record that EventCard needs an `alwaysEligible` prop; do not edit it. |
| Feasibility (Phase 2.5): `CommandPaletteHost` not mounted in `App.tsx` | MEDIUM | Commands are registered and pinned through an injected registry; the e2e does not drive ⌘K. Record the mount as an owner finding (shell file, item 01 / 17). |
| Registering commands from the always-mounted Crew section into the global registry could collide across remounts (StrictMode, tests) | LOW | Register in one `useEffect` and return the registry's unregister; ids derived from stable kernel ids. |
| `App.test.tsx` pins the exact sidebar button list and an `h1` equal to the title | MEDIUM | Touched-file invariants above; run the full `npm test`, not only the chat tests. |
| E2E against a full app launch is slower and order-sensitive (feed + REST) | MEDIUM | Mirror `app/e2e/store.spec.ts` / `smoke.spec.ts` teardown (`afterEach` closes app and fixture); wait with `expect.poll` / locator assertions, never sleeps. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-chat-and-crew-threads.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T09:19:28Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/118
- **Branch:** feature/chat-and-crew-threads
- **Files changed:** 30
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Chat screen + Crew threads, cards, composer, ⌘K commands, 74 chat unit tests, chat e2e, 12 light/dark screenshots and evidence README. Self-heal fixed 10 findings over 3 iterations (live-page drops, focus scoping/restore, in-flight guards, stable card keys, a11y, composer). Iteration 3's one HIGH (focus lost when a card moves) was disputed by the fixer with a real-Electron trace + React's post-commit focus restore; pins added, not re-reviewed. Escalation comment posted on the PR.

## Not verified
- **⌘K palette UI driving Chat's commands** — CommandPaletteHost is not mounted in App.tsx (gap d); commands are verified only through an injected registry (subtask 1)
- **real kernel /threads, /ask, approvals, playbooks and triggers routes** — no local kernel run; all tests use fakeBridge or the fixture kernel (subtask 1)
