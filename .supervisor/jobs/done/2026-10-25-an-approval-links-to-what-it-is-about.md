# Supervisor Job: An approval links to what it's about — "Open playbook <slug>" / "Open in Team", and a source label that reads "Requested by Wright in chat"

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L12
- **CLAUDE.md:** ✓ Found (fresh; its `kernel/` + `docs/` description predates `app/`, nothing it states is contradicted)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115030-an-approval-links-to-what-it-is-about.md
- **Base commit:** 9137fb39a4fe7028af13e1504e622bf139b09f5c

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | App-only change: React 19 + strict TypeScript, vitest + Testing Library unit tests, Playwright e2e through `app/e2e/electron-harness.ts`. |
| 2 | Dependency Availability | GO | No new dependency, no kernel change. The payload fields exist: the rail records every `ALWAYS_HELD_TOOLS` call as payload `{tool, input, cwd}` (`kernel/src/sessions/policy.ts` `classifyToolCall`); `kernel_playbook_enable(id, idempotency_key)` → `input.id` (number, `kernel/src/playbooks/enable.ts`); `kernel_agent_create(charter, idempotency_key)` → `input.charter.id` (string; `charterIdText` in `kernel/src/agents/charter-tools.ts`); `kernel_agent_update(id, …)` → `input.id` (string). The slug comes from the existing `playbooks` live-store resource (`GET /playbooks?all=1`, `app/src/store/resources.ts`). |
| 3 | Architecture Fit | GO | Invariant 3 holds: payload fields are untrusted data, read by type only, rendered as React text children; hrefs are built only from a safe-integer playbook id or an `encodeURIComponent`'d member id. The link only navigates — it never decides or writes anything. |
| 4 | Scope vs Supervisor Capability | GO | Single subtask: one concern (an approval names what it is about), ~16 app files, no file-conflict / context-bound / genuine-parallelism reason to split. |
| 5 | Hard Blockers | CAUTION | (a) The requirement's assumption "enable, set, run" does not hold: only three tools are ever held for approval (`ALWAYS_HELD_TOOLS` = enable, agent_create, agent_update); there is no `kernel_playbook_set` / `kernel_playbook_run` approval, so only enable links to a playbook (create and update link to a member). (b) Team has no route that selects a member (`TeamView` holds `selectedId` in state only; the thread header's existing "Open in Team" goes to bare `#/team`), so "goes to the member" needs a small `#/team/<id>` route — a Team-screen change outside the requirement's Touches. (c) The stable anchor the requirement's risk asks about exists: `PlaybookCard` renders `data-playbook={playbook.id}` on its `<section>` (`app/src/screens/chat/cards.tsx`). See Risk Assessment. |

**Overall Verdict:** CAUTION (check 5; findings carried into Risk Assessment)

## Task

**Goal:** An approval about a playbook (`kernel_playbook_enable`) shows "Open playbook <slug>", which opens Wright's thread scrolled to that playbook's card; an approval about a crew member (`kernel_agent_create` once allowed and applied, `kernel_agent_update` always) shows "Open in Team", which opens Team with that member selected; and the source label reads "Requested by Wright in chat" (or "Requested by playbook <slug> v<n>") instead of "Not from a playbook" — on the Approvals screen and on the thread's inline pending-approval card.

**Problem Statement:**
The owner needs to get from an approval to the thing it is about, because after Allow once the next step (Run now) is on the playbook's card.
Currently, after allowing the held `kernel_playbook_enable` (approval 6, enabling playbook 3 `phase5-exit-1024`, from Wright's chat session) in the phase 5 live run, nothing linked the approval to the card and the owner asked where Run now was; the inline card read "Not from a playbook", which is true but reads wrongly on an approval about a playbook.
Success looks like: approval 6's shape shows "Requested by Wright in chat" and "Open playbook phase5-exit-1024", and clicking it lands on Chat with that card in view.

Do this (the requirement's Scope 1–3):

1. **One pure module, `app/src/screens/approvals/subject.ts` (new).** Nothing in it builds markup. Exports:
   - `type ApprovalSubject = { readonly kind: "playbook"; readonly id: number } | { readonly kind: "member"; readonly id: string }`.
   - `approvalSubject(a: Approval): ApprovalSubject | undefined` — reads the payload by type only (it is untrusted): the tool via `payloadTool` from `./kernel-mirror` (reuse it, never a second reader); `input` must be a non-null, non-array object. `"mcp__kernel__kernel_playbook_enable"` → `input.id` when it is a positive safe integer (checked on one line as `typeof id === "number" && Number.isSafeInteger(id) && id > 0`) → `{ kind: "playbook", id }`. `"mcp__kernel__kernel_agent_create"` → `input.charter.id` when `charter` is an object and `id` a non-empty string → `{ kind: "member", id }`. `"mcp__kernel__kernel_agent_update"` → `input.id` when a non-empty string → `{ kind: "member", id }`. Anything else, or a field of the wrong type → `undefined`. The three tool names are typed `keyof typeof KERNEL_APPLIED_ACTIONS` (imported from `./kernel-mirror`, which `kernel-mirror.test.ts` keeps in step with the kernel), each written once in this file.
   - `export const IN_CHAT = "in chat";` and `approvalSourceText(a: Approval): string` — `a.playbook === null` → `Requested by <agent> ${IN_CHAT}`, else `Requested by ${playbookText(a.playbook)}` (reuse `playbookText` from `./kernel-mirror`: `playbook <slug> v<n>`, escaped). `<agent>` is written on one line as `const agent = a.requesting_agent === "wright" ? "Wright" : printable(a.requesting_agent);`.
   - `approvalLink(a: Approval, playbooks: readonly PlaybookListing[] | undefined): { readonly text: string; readonly href: string } | undefined` — playbook subject → `text` `Open playbook <slug>` (the slug from `playbooks` by id, through `printable`; `#<id>` when the playbook is not in the list or the list is unread, written on one line as ``const name = listed === undefined ? `#${subject.id}` : printable(listed.slug);``), `href` `playbookCardHash(id)`. Member subject → `text` `Open in Team`, `href` `memberHash(id)`; for a create only when it was allowed and applied, written on one line as `a.status === "approved" && a.apply_refused === undefined` (before that, or after a deny or a refused apply, the member does not exist: no link). Update links always (the member exists).
2. **Routes.**
   - `app/src/screens/chat/model.ts`: `playbookCardHash(id: number): string` → `#/chat?playbook=<id>` (Wright's thread; `hashAgent`'s `/^#\/chat\/([^/?#]+)/` already reads it as Wright's, and `screenForHash` as Chat), and `playbookFromHash(hash: string): number | undefined` matching `/^#\/chat\?playbook=([1-9][0-9]{0,15})$/` with a `Number.isSafeInteger` check (the `approvalIdFromHash` idiom).
   - `app/src/screens/team/model.ts`: `memberHash(id: string): string` → `` `#/team/${encodeURIComponent(id)}` `` and `memberIdFromHash(hash: string): string | undefined` (`/^#\/team\/([^/?#]+)$/`, `decodeURIComponent` in a try, the `hashAgent` idiom).
   - `app/src/screens/team/TeamView.tsx`: on mount and on each `hashchange` (the `ApprovalsScreen` `selectFromHash` effect's shape, which sets the id without checking any list), a `#/team/<id>` sets the selection from the hash with **no roster check at that moment** (the roster loads asynchronously; a check there would select nothing on a cold open): the same state change `open(agent)` makes — `setCreating(false)`, `setFocusSet(0)`, `setSelectedId(id)`. The existing `selected = roster.find((a) => a.id === selectedId)` then opens the inspector once the roster has the id, and shows nothing for an id it never has. The listener is registered on one line as `window.addEventListener("hashchange", selectFromHash);`. Selection only: nothing is written.
3. **Approvals screen (`ApprovalsScreen.tsx`).** It reads `useResource("playbooks", api)` beside its other reads. In `ApprovalDetail`'s meta row, the conditional `approval-playbook` span is replaced by one always-present `<span data-testid="approval-source">{approvalSourceText(a)}</span>`. Under the header (pending and decided alike), when `approvalLink(a, playbooks)` is defined, an anchor written on one line `<a className="approvals-link" href={link.href} data-testid="approval-link">{link.text}</a>` (a link, not a button: it navigates and decides nothing; `approvals.css` styles it with tokens only, keeping the existing `:focus-visible` ring). The list row's meta `no playbook` becomes `in chat` (`IN_CHAT`). Nothing about deciding changes.
4. **The inline card (`cards.tsx`, `Thread.tsx`).** `ApprovalCard` takes `playbooks: readonly PlaybookListing[] | undefined` (Thread passes its `playbookList`); its `reason` becomes `approvalSourceText(approval)` (no more "Not from a playbook" or "From playbook <slug>"), and under the `EventCard`, inside the `.chat-approval` wrapper (the `EventCard` component is not changed), when `approvalLink` is defined, an anchor on one line `<a className="chat-approval-link" href={link.href} data-testid="chat-approval-link">{link.text}</a>`. `CharterCard` (a pending create: no member yet) gets no link.
5. **Scroll to the card (`Thread.tsx`).** `AgentThread` reads `playbookFromHash(useHash())`. When it names an id and that id's card is rendered (`[data-playbook="<id>"]` inside the thread), a layout effect, once per hash value (a ref `handledHash` holds the hash already handled, checked on one line as `if (handledHash.current === hash) return;`, so a refetch never re-scrolls), sets `atEnd.current = false` (so the keep-the-end-in-view effect does not pull the view back down) and calls, on one line, `card.scrollIntoView({ block: "center" });`. When the thread and the playbooks list have both answered and the card is not rendered (its event is older than the loaded pages, or the playbook is not Wright's), a status line on one line `<p className="chat-card-missing" role="status" data-testid="chat-card-missing">…</p>` says `Playbook <slug or #id>'s card isn't in the part of this thread that's loaded. Load earlier to find it.` — never a silent no-op. Clicking the same link twice (same hash, no `hashchange`) still scrolls: the anchor's `onClick` re-dispatches `hashchange` when `window.location.hash` already equals its href (the `MenubarHost` idiom: `if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"))`), and the handled-hash ref is cleared on that event.

Non-goals: any kernel or `app/src/api/contract.ts` change; the `EventCard` component; a link for a non-kernel-applied action (Bash, outward tools) — the payload names no playbook or member; screenshots (the requirement asks none; the committed `docs/evidence/phase-5-polish/approvals/` screenshots are not regenerated).

## Acceptance Criteria

- [ ] **AC1 — approval 6's shape (Approvals screen).** Given an approval shaped like approval 6 — `{ id: 6, requesting_agent: "wright", requesting_session: 12, action: "kernel_playbook_enable", playbook: null, payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: 3, idempotency_key: "k" }, cwd: "/" } }` — and `GET /playbooks` listing playbook 3 with slug `phase5-exit-1024`, when the Approvals screen shows it (pending, and again after Allow once), then in `ApprovalsScreen.test.tsx` `approval-source` reads exactly `Requested by Wright in chat`, `approval-link` reads `Open playbook phase5-exit-1024` with `href` `#/chat?playbook=3`, the list row's meta reads `wright · in chat`, and the text `Not from a playbook` is nowhere on screen. With `GET /playbooks` refused, the link reads `Open playbook #3`. The existing pins `approval-playbook` → `from playbook crew-setup v4` (line ~332) and the escaping pin (line ~374, whose test source is `.toBe("from playbook slug\\u202e v1")`) move to `approval-source` with `Requested by playbook crew-setup v4` / `.toBe("Requested by playbook slug\\u202e v1")` — the escaped six-character text `\u202e` that `printable` produces, never a raw U+202E (the escaping assertion keeps its meaning).
- [ ] **AC2 — "Open in Team" once a create is decided.** Given a `kernel_agent_create` approval whose payload is `{ tool: "mcp__kernel__kernel_agent_create", input: { charter: { id: "sable", … }, idempotency_key: "k" } }`, then in `ApprovalsScreen.test.tsx`: while pending there is no `approval-link`; after Allow once answers `approved` with an `applied` sentence, `approval-link` reads `Open in Team` with `href` `#/team/sable`; a denied one, and an approved one with `apply_refused`, show none. In `team.test.tsx`, opening Team at `#/team/<a crew id>` — with the `GET /agents` answer arriving after the screen mounts — opens that member's inspector (the inspector shows that member, and its card has `aria-current="true"`); setting `window.location.hash` to another member's `#/team/<id>` and then dispatching `new HashChangeEvent("hashchange")` on `window` inside `act` (the `ApprovalsScreen.test.tsx` idiom, ~811-812) moves the selection to it; and at `#/team/nobody` no member inspector is rendered at all (assert the inspector element is absent, not only that no card has `aria-current`).
- [ ] **AC3 — `subject.ts` unit pins (`subject.test.ts`, new).** `approvalSubject`: enable with `input.id` 3 → `{ kind: "playbook", id: 3 }`; enable with `input.id` `"3"`, `0`, `-1`, `1.5`, missing `input`, or an array `input` → `undefined`; create → `{ kind: "member", id: "sable" }`; create with no `charter` or a non-string `charter.id` → `undefined`; update with `input.id` `"pim"` → member `pim`; a `Bash` payload → `undefined`. `approvalSourceText`: Wright, no playbook → `Requested by Wright in chat`; agent `ada`, no playbook → `Requested by ada in chat`; a playbook → `Requested by playbook review-prs v3`; a hostile agent id or slug comes back through `printable` (contains no raw ESC / U+202E). `approvalLink`: the create link appears only for `status: "approved"` without `apply_refused`; the slug falls back to `#<id>`.
- [ ] **AC4 — the inline card and the scroll (Chat).** In `cards.test.tsx` (where the inline `ApprovalCard`'s tests already live, e.g. its `Allow once` clicks at ~495): Wright's thread with approval 6 pending and the testkit's playbooks list holding `playbook(3, { slug: "pr-review" })` (`app/src/screens/chat/testkit.tsx`'s `playbook()` defaults the slug to `pb-<id>`, so the override is required) shows the reason `Requested by Wright in chat` and a `chat-approval-link` `Open playbook pr-review` with `href` `#/chat?playbook=3`. The existing pin `findByText("From playbook pr-review")` (`thread.test.tsx:133`, whose approval has `playbook: { id: 3, slug: "pr-review", version: 1 }`) becomes `findByText("Requested by playbook pr-review v1")`. In `thread.test.tsx` (stubbing `Element.prototype.scrollIntoView`): rendering Wright's thread at `#/chat?playbook=3`, the stub is called on the `[data-playbook="3"]` element exactly once, and a later refetch of the thread does not call it again; at `#/chat?playbook=99` (no such card) `chat-card-missing` is shown with `#99` and the stub is not called; `playbookFromHash` reads `#/chat?playbook=3` → 3 and `#/chat?playbook=0`, `#/chat?playbook=3x`, `#/chat` → `undefined`.
- [ ] **AC5 — e2e in the built app.** In `app/e2e/approvals.spec.ts`, a new test composes, in this order, `{ ...chatFixture("populated").options.routes, ...approvalsRoutes(kernel) }` (`app/e2e/fixtures/chat.ts` serves Wright's thread with playbook 3 `pr-review` and its card, and also its own `GET /approvals` / `GET /messages`, which the approvals kernel's routes must override) for an `enableApproval(6)` (a new export of `app/e2e/fixtures/approvals.ts`, approval 6's shape with playbook 3), launches through `launchApp` (never `electron.launch` / `new BrowserWindow`), opens `#/approvals`, asserts `approval-source` `Requested by Wright in chat`, clicks `Open playbook pr-review`, and asserts the hash is `#/chat?playbook=3` and `[data-playbook="3"]` is in the viewport (`toBeInViewport()`). The existing test `AC1b + AC2: a charter create's detail; …` additionally asserts, after the applied sentence, `approval-link` `Open in Team` with `href` `#/team/sable`; `charterApproval()`'s payload becomes the kernel's real shape `{ tool, input: { charter: { id: "sable", display_name: "Sable", … }, idempotency_key }, cwd }` (its `payload` contains `KERNEL_AGENT_CREATE` as before), and `e2e/approvals.spec.ts:190`'s `approval-playbook` pin becomes `approval-source` `Requested by playbook crew-setup v2`.
- [ ] **AC6 — validation.** `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and `cd app && npx playwright test e2e/approvals.spec.ts --workers=1` passes after the build.

## File Impact Map

| File | Action | Confidence | Why |
|------|--------|------------|-----|
| `app/src/screens/approvals/subject.ts` | create | HIGH | `approvalSubject`, `approvalSourceText`, `IN_CHAT`, `approvalLink`. |
| `app/src/screens/approvals/subject.test.ts` | create | HIGH | AC3 pins. |
| `app/src/screens/approvals/ApprovalsScreen.tsx` | modify | HIGH | `playbooks` read; `approval-source` replaces `approval-playbook`; `approval-link`; list meta `in chat`. |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx` | modify | HIGH | AC1, AC2 (Approvals half); the two `approval-playbook` pins (~332, ~374) move to `approval-source`; its fake gains a `GET /playbooks` route. |
| `app/src/screens/approvals/approvals.css` | modify | HIGH | `.approvals-link` (tokens only). |
| `app/src/screens/chat/cards.tsx` | modify | HIGH | `ApprovalCard`'s `playbooks` prop, reason, `chat-approval-link`. |
| `app/src/screens/chat/cards.test.tsx` | modify | HIGH | AC4 inline card (the `ApprovalCard` tests live here). |
| `app/src/screens/chat/Thread.tsx` | modify | HIGH | Passes `playbookList` to `ApprovalCard`; scroll-to-card effect; `chat-card-missing`. |
| `app/src/screens/chat/thread.test.tsx` | modify | HIGH | AC4 scroll tests; the `From playbook pr-review` pin (line 133). |
| `app/src/screens/chat/model.ts` | modify | HIGH | `playbookCardHash`, `playbookFromHash`. |
| `app/src/screens/chat/chat.css` | modify | HIGH | `.chat-approval-link`, `.chat-card-missing` (tokens only). |
| `app/src/screens/team/model.ts` | modify | HIGH | `memberHash`, `memberIdFromHash`. |
| `app/src/screens/team/TeamView.tsx` | modify | HIGH | `#/team/<id>` selects the member. |
| `app/src/screens/team/team.test.tsx` | modify | HIGH | AC2 Team half. |
| `app/e2e/fixtures/approvals.ts` | modify | HIGH | `enableApproval()`; `charterApproval()` payload in the kernel's real shape. |
| `app/e2e/approvals.spec.ts` | modify | HIGH | AC5. |

Verified unaffected: `app/src/components/EventCard/EventCard.tsx` (the link sits in `ApprovalCard`'s wrapper; `reason` is still a string); `app/src/api/contract.ts` (`Approval.payload` is `unknown`; `PlaybookListing` exists); `app/src/store/resources.ts` (`playbooks` resource exists, `all=1`); `app/e2e/fixtures/chat.ts` (used as is; it already serves `GET /playbooks`, `GET /threads/:agent`, `GET /agents`); `app/src/screens/approvals/kernel-mirror.ts` (read, not changed); `app/src/App.tsx` (`screenForHash` already routes `#/team/…` and `#/chat?…` on the first segment).

### File Overlap Detection
Single subtask; no overlap.

## Touched-file invariants

> Grounded at base `9137fb3`. The worker re-checks these before hand-back.

- **`app/src/screens/approvals/ApprovalsScreen.tsx`** — keep: every untrusted field through `printable` and rendered as text (header: "Every untrusted field is escaped by"); the selection-by-id rules and the `#/approvals/<id>` route (`APPROVAL_ROUTE`, `approvalIdFromHash`) unchanged; the decision paths (`decide`, `APPROVAL_COMMANDS`, the A / ⇧A / D keys) unchanged — a link never decides. reuse: `playbookText` and `printable`; the `useResource(` reads. pinned by: `ApprovalsScreen.test.tsx` (`approval-playbook` pins move to `approval-source`, AC1), `app/e2e/approvals.spec.ts` (`approval-playbook` at line 190, AC5).
- **`app/src/screens/approvals/approvals.css`** — keep: the focus ring rule `outline: 2px solid var(--focus);`; the only `outline: none` stays the programmatic-focus rule `.approvals-outcome:focus:not(:focus-visible)`; new rules use tokens only, no raw colours.
- **`app/src/screens/chat/cards.tsx`** — keep: "Every kernel string is a React text child only."; `ApprovalCard`'s decisions and `ALWAYS_INELIGIBLE` refusal; `onFullPayload={() => navigate("#/approvals")}`; the `PlaybookCard` anchor `data-playbook={playbook.id}` (the scroll target; item 25 owns the card — do not change it). pinned by: `cards.test.tsx`, `thread.test.tsx`.
- **`app/src/screens/chat/Thread.tsx`** — keep: the keep-the-end-in-view effect `if (el !== null && atEnd.current) el.scrollTop = el.scrollHeight;` (the scroll-to-card sets `atEnd.current = false` rather than changing it); cards keyed by what they show (`card:pb:${id}`), never by position; `idShown` / `thread-id` header and "Open in Team" button unchanged. pinned by: `thread.test.tsx`.
- **`app/src/screens/chat/model.ts`** — keep: `hashAgent`'s regex `/^#\/chat\/([^/?#]+)/` and `threadHash` unchanged (Wright's thread is `#/chat`). pinned by: `thread.test.tsx`, `crew.test.tsx`.
- **`app/src/screens/team/model.ts`, `app/src/screens/team/TeamView.tsx`** — keep: `threadHash` (Team's own, `#/chat/<id>`) unchanged; `const [selectedId, setSelectedId] = useState<string | undefined>(undefined);` stays the one selection state (the route sets it, never a second copy); a closed inspector returns focus to its card (`closeInspector`). pinned by: `team.test.tsx` (`a crew member's inspector`).
- **`app/e2e/approvals.spec.ts`, `app/e2e/fixtures/approvals.ts`** — keep: every launch through `launchApp` (house rule; `app/scripts/hidden-windows.test.ts`); screenshots only under `APPROVALS_EVIDENCE=1`; the evidence-README test (`the evidence README lists every state's screenshot`) untouched; fixture paths stay fixture data.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `subject.test.ts` — AC3 enable → playbook 3 | flip `"mcp__kernel__kernel_playbook_enable"` → `"mcp__kernel__kernel_playbook_enabled"` in `app/src/screens/approvals/subject.ts` |
| `subject.test.ts` — AC3 create → member sable | flip `"mcp__kernel__kernel_agent_create"` → `"mcp__kernel__kernel_agent_created"` in `app/src/screens/approvals/subject.ts` |
| `subject.test.ts` — AC3 create link only when approved and applied | flip `a.status === "approved" && a.apply_refused === undefined` → `true` in `app/src/screens/approvals/subject.ts` |
| `subject.test.ts` — AC3 `Requested by Wright in chat` | flip `"in chat"` → `"from chat"` in `app/src/screens/approvals/subject.ts` |
| `subject.test.ts` — AC3 Wright's name | flip `? "Wright" :` → `? a.requesting_agent :` in `app/src/screens/approvals/subject.ts` |
| `ApprovalsScreen.test.tsx` — AC1 `approval-link` | delete `data-testid="approval-link"` in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `ApprovalsScreen.test.tsx` — AC1 `approval-source` | flip `{approvalSourceText(a)}` → `{"Not from a playbook"}` in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `team.test.tsx` — AC2 `#/team/<id>` selects | flip `/^#\/team\/([^/?#]+)$/` → `/^#\/teams\/([^/?#]+)$/` in `app/src/screens/team/model.ts` |
| `cards.test.tsx` — AC4 inline link | delete `data-testid="chat-approval-link"` in `app/src/screens/chat/cards.tsx` |
| `thread.test.tsx` — AC4 scrolls to the card | delete `card.scrollIntoView({ block: "center" });` in `app/src/screens/chat/Thread.tsx` |
| `thread.test.tsx` — AC4 missing card says so | delete `data-testid="chat-card-missing"` in `app/src/screens/chat/Thread.tsx` |
| `thread.test.tsx` — AC4 `playbookFromHash` | flip `playbook=([1-9][0-9]{0,15})` → `playbook=([0-9]+)` in `app/src/screens/chat/model.ts` |
| `subject.test.ts` — AC3 wrong-type enable ids (`"3"`, `0`, `-1`, `1.5`) | flip `typeof id === "number" && Number.isSafeInteger(id) && id > 0` → `id !== undefined` in `app/src/screens/approvals/subject.ts` |
| `ApprovalsScreen.test.tsx` / `subject.test.ts` — slug fallback `Open playbook #3` | flip ``? `#${subject.id}` :`` → `? "unknown" :` in `app/src/screens/approvals/subject.ts` |
| `thread.test.tsx` — AC4 a refetch does not scroll again | delete `if (handledHash.current === hash) return;` in `app/src/screens/chat/Thread.tsx` |
| `team.test.tsx` — AC2 a hashchange moves the selection | flip `window.addEventListener("hashchange", selectFromHash);` → `window.addEventListener("popstate", selectFromHash);` in `app/src/screens/team/TeamView.tsx` |
| `team.test.tsx` — AC2 `#/team/nobody` selects nothing | flip `roster.find((a) => a.id === selectedId)` → `roster[1]` in `app/src/screens/team/TeamView.tsx` |
| `app/e2e/approvals.spec.ts` — AC5 the card is in the viewport | delete `card.scrollIntoView({ block: "center" });` in `app/src/screens/chat/Thread.tsx`, rebuild, run `npx playwright test e2e/approvals.spec.ts --workers=1` once by hand; the new test must fail on `toBeInViewport()`. The worker states the result (red on the mutant, green restored) in its hand-back summary. |

Each mutation literal must stay on one source line, and appear once in its file, so `scripts/run-pin-mutations.sh` can apply it: `IN_CHAT`'s `"in chat"`, the three tool-name literals, the create condition, the Wright ternary, the two anchors, the `approval-source` span's `{approvalSourceText(a)}`, the `scrollIntoView` call, the `chat-card-missing` paragraph and both route regexes.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Approval subject links, source label, scroll-to-card and `#/team/<id>` | AC1, AC2, AC3, AC4, AC5, AC6 | 14 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/approvals/subject.ts"}
  - {kind: "symbol", path: "app/src/screens/approvals/subject.ts", name: "approvalSubject"}
  - {kind: "symbol", path: "app/src/screens/approvals/subject.ts", name: "approvalSourceText"}
  - {kind: "symbol", path: "app/src/screens/approvals/subject.ts", name: "approvalLink"}
  - {kind: "file", path: "app/src/screens/approvals/subject.test.ts"}
  - {kind: "symbol", path: "app/src/screens/chat/model.ts", name: "playbookFromHash"}
  - {kind: "symbol", path: "app/src/screens/team/model.ts", name: "memberIdFromHash"}
  - {kind: "symbol", path: "app/e2e/fixtures/approvals.ts", name: "enableApproval"}
requires: []
lanes:
  - "app/src/screens/approvals/subject.ts"
  - "app/src/screens/approvals/subject.test.ts"
  - "app/src/screens/approvals/ApprovalsScreen.tsx"
  - "app/src/screens/approvals/ApprovalsScreen.test.tsx"
  - "app/src/screens/approvals/approvals.css"
  - "app/src/screens/chat/cards.tsx"
  - "app/src/screens/chat/cards.test.tsx"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/thread.test.tsx"
  - "app/src/screens/chat/model.ts"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/team/model.ts"
  - "app/src/screens/team/TeamView.tsx"
  - "app/src/screens/team/team.test.tsx"
  - "app/e2e/fixtures/approvals.ts"
  - "app/e2e/approvals.spec.ts"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
1 (no dependencies)

### File Overlap Matrix
Single subtask; none.

### Batch Plan
- single-agent (no fan-out): Batch 1 = subtask 1
- **Recommended workers:** 1

## Skill References
- `skills/unit-testing/SKILL.md` — vitest + Testing Library pins
- `skills/frontend-ui/SKILL.md` — a link is an `<a href>` (navigation, not an action), tokens only, the focus ring kept
- `skills/playwright-e2e/SKILL.md` — the fixture-kernel spec, `toBeInViewport()`

## House Rules
- (advisory, from the requirement) E2E specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts` enforces it). AC5 complies.

## Risk Assessment

| Risk | Severity | Source | Mitigation |
|------|----------|--------|------------|
| The requirement's "enable, set, run" assumption is wrong: only enable, agent_create and agent_update are ever held (`ALWAYS_HELD_TOOLS`), so set/run approvals do not exist and get no link. | MEDIUM | Feasibility (Phase 2.5) | Scope reads the payloads that exist; the PR body states the finding (kernel fact, `kernel/src/sessions/policy.ts`). |
| Files outside the requirement's Touches (`app/src/screens/approvals/`, `app/e2e/approvals.spec.ts`, `app/e2e/fixtures/approvals.ts`): the Team files (`team/model.ts`, `TeamView.tsx`, `team.test.tsx`), which "Open in Team goes to the member" needs as a `#/team/<id>` route Team lacks, and the Chat files (`chat/cards.tsx`, `cards.test.tsx`, `Thread.tsx`, `thread.test.tsx`, `chat/model.ts`, `chat.css`), which Scope 2–3 (the inline card's label and link, scrolling the thread to the card) need. | MEDIUM | Feasibility (Phase 2.5) | Each change is the smallest that meets its scope line (one hash effect in the `selectFromHash` shape; one prop, one anchor, one scroll effect); every one is pinned (AC2, AC4); the PR body lists every file outside Touches. |
| The playbook's card may not be in Wright's loaded thread (its event older than the loaded pages, or the playbook drafted for a crew member and shown elsewhere). | MEDIUM | Requirement risk | Never a silent no-op: `chat-card-missing` says so and points at Load earlier (AC4). The anchor itself exists (`data-playbook` on `PlaybookCard`, item 25's card, unchanged). |
| "in chat" is the label for every approval with no playbook, including an agent's own `kernel_approval_request` from a non-chat session. | LOW | Analysis (Phase 3) | The contract has no `source` field (`kernel-mirror.ts`: "it has no `source` field"); the requirement chose the wording; no kernel change is in scope. |
| The committed approvals screenshots (`docs/evidence/phase-5-polish/approvals/`) predate the new label and link. | LOW | Analysis (Phase 3) | Not regenerated (not asked); the PR body notes they predate this change. |
| Payload fields are untrusted and reach an `href`. | LOW | Invariant 3 | `href` built only from a safe-integer playbook id or an `encodeURIComponent`'d member id; text through `printable`, as React text children. |

## Plan Review
- **Status:** PASS (attempt 3/3; attempts 1 and 2 also PASS, and their MEDIUM/LOW issues were refined)
- **Deferred (LOW, below the fix floor, attempts exhausted):** the pin mutation for `team.test.tsx` — AC2 "a hashchange moves the selection" (flip `hashchange` → `popstate`) may survive if jsdom also fires `popstate` on a fragment change. Use instead: delete `window.addEventListener("hashchange", selectFromHash);` in `app/src/screens/team/TeamView.tsx` (no listener, so the selection cannot move whatever jsdom fires).

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-25-an-approval-links-to-what-it-is-about.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-25T05:22:31Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/138
- **Branch:** feature/an-approval-links-to-what-it-is-about
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Approvals now link to their subject ("Open playbook <slug>" → Wright's thread scrolled to the card; "Open in Team" → #/team/<id>), and the source label reads "Requested by Wright in chat" / "Requested by playbook <slug> v<n>" on the Approvals screen and the inline card. Phase 4.5 ran 3 review→fix rounds: 1) the off-screen missing-card line, focus lost after following the link, Load-earlier advice for an unlisted playbook, a stale evidence README; 2) the Load-earlier rAF restore undoing the card scroll, inline-link focus; 3) focus falling to <body> when the target is absent. The iteration-3 fix (1d049b0) was not re-reviewed, hence the escalation. Required CI was green at every iteration; the pin-mutation script could not drive the app's vitest runner (18 unverified), so the mutations were applied by hand: worker 20/20 killed, Supervisor 4/4, reviewers 8 and 12 rows.

## Not verified
- **Team screen reached via the real Open in Team link in the built app**: e2e checks only the link text and the #/team/sable href; the #/team/<id> selection is pinned in jsdom (subtask 1)
- **A second click of the inline chat link in the built app**: the same-hash re-dispatch is pinned in jsdom only (subtask 1)
