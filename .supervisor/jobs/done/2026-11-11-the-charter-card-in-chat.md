# Supervisor Job: The charter card in Chat — plain and short, complete on request, copyable, and discussed in its drafting thread (phase 8 item 18d)

## Environment
- **Project:** loomwright-studio (lane checkout `automate-2026-11-10-173433/L4`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement lives under the gitignored `.supervisor/`, so its provenance is the lane's copy, not a commit)
- **Source requirement:** .supervisor/requirements/phase-8-18/2026-11-10-204054-the-charter-card-in-chat.md
- **Base commit:** 327c6e3b953b151ae33aea8e270978e9959f697f

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the React/Electron app (vitest + Playwright e2e); no new dependency |
| 2 | Dependency Availability | GO | 18a mockup (#256), 18b readiness block (#257), 18c saved workspaces + folder-picker bridge (#260) and 17c threads/Reply (#253) are all merged on `main` |
| 3 | Architecture Fit | CAUTION | The owner's 2026-11-11 choice "withdraw v1, hold v2" needs a small kernel mechanism (a held charter call names its subject; a newer hold for the same subject withdraws the older pending one). It stays mechanism, not policy (invariant 1), and withdrawing only ever denies, never approves (invariant 3) |
| 4 | Scope vs Supervisor Capability | CAUTION | 45 files (32 modify + 13 create) across kernel and app: over the `context-bound` bound, so two subtasks (kernel, then app) |
| 5 | Hard Blockers | CAUTION | The kernel's readiness line for a missing workspace names no repo (`workspaceItem` in `kernel/src/agents/charter-readiness.ts`), so "saved workspaces whose remote matches the repo" needs the repo from the charter's own text (see Risk Assessment) |

**Overall Verdict:** CAUTION

## Task
**Goal:** Chat's charter card (and the Approvals screen's) shows the plain compact view by default, the complete display (no 4,000-character cut) behind Show full details with copy on the card and on each block, a workspace question when 18b flags a missing workspace, and an Ask or change box that posts into the drafting thread, where a newer charter version withdraws and replaces the older held one.

**Problem Statement:**
The owner needs to judge and adjust a drafted crew member from its card, because today the card cannot be trusted or acted on.
Currently, Chat's charter card renders the kernel's display raw in a `<pre>` (`app/src/screens/chat/cards.tsx`), the kernel stores the display cut at 4,000 characters with no mark (`MAX_APPROVAL_DISPLAY` in `kernel/src/approvals/store.ts`), there is no copy control, and "Edit in English" only pre-fills the composer with no tie to the thread the charter was drafted in. In the item 16 walk the owner saw `role.md` end mid-sentence and could not tell what was missing.
Success looks like: the compact card shows no `mcp__kernel__` name, JSON or file path; the expanded details hold every character the kernel stored; copy puts the exact full text on the clipboard; an Ask or change posts a Reply into the drafting thread; and a new version from Wright marks the older card "Replaced by v2" with what changed, the older held approval withdrawn by the kernel.

**Owner decisions (2026-11-11, Launch Pad `LP-CLARIFY`, answering 18a's open points 1–3 in `docs/DESIGN.md` §"Open points for the owner (charter card)"):**
1. **A new version withdraws the old one.** When Wright holds a charter create or update for a member while an older charter call for the same member is still pending, the kernel withdraws the older one (decided `deny` by `kernel`, recording `replaced_by: <new id>`) and holds the new one. Chat shows the old one collapsed as "Replaced by v2" with what changed.
2. **Clone is split to a follow-up item.** "Clone it for me" is offered (AC8), and in this item it posts the request into the drafting thread and says on the card that cloning is not built yet. Nothing is cloned and no new approval kind is added. A follow-up item builds the held kernel clone (its kind, credentials and destination).
3. **A workspace pick goes through Wright.** Picking a saved workspace, or choosing a folder, posts a Reply into the drafting thread naming the folder; Wright proposes the held v2 with the workspace, by the same path as Ask or change. There is no new kernel route.

## Acceptance Criteria

Carried forward from the source requirement (AC1–AC11), with the owner's 2026-11-11 decisions folded in; AC12–AC14 make those decisions testable.

**Happy path**
- [ ] **AC1.** Given a held charter create (or update), when its card is shown in Chat, then it shows the compact plain view first (who; **Can do**: each job's plain label with its "Used for" purpose lines; **Never does**: the never list in words; **Limits** on one line; then 18b's readiness block), with no `mcp__kernel__` name, JSON or file path until Show full details is used. The Approvals screen's charter card opens the same way (details hidden by default, owner decision 2026-11-10).
- [ ] **AC2.** Given a stored display longer than 4,000 characters, when the details are expanded in the app, then all of it is shown in its blocks (kernel tools by job, the enforced lines, the settings file, `role.md`), each block scrolling inside the card, with a line giving the total length and saying nothing is cut; a kernel test proves a 4,001+-character display is stored and served whole (bounded by `MAX_REQUEST_PAYLOAD_JSON`, 64,000).
- [ ] **AC3.** Given the card's Copy all text control, when it is used, then the clipboard holds the full display text exactly as the kernel stored it (byte-equal to `approval.display`); a block's copy control copies that block in full, whatever part of it is visible.
- [ ] **AC4.** Given the owner types "add comment replies" in the card's Ask or change box, when it is sent, then the app sends `POST /ask` with `continues` set to the drafting message (the agent message whose `session_id` is the approval's `requesting_session`) and the owner's words marked as from the card's Ask or change, so it appears as a Reply in the charter's drafting thread; when Wright then holds a v2 for the same member, the v2 card appears in that thread and the v1 card is collapsed to "Replaced by v2" naming what changed (jobs added or removed, workspace set, limits changed).
- [ ] **AC5.** Given 18b flagged a missing workspace and 18c holds a matching saved workspace, when the owner picks it on the card, then a Reply naming that folder is posted into the drafting thread (owner decision 3), so Wright proposes the held charter update adding that workspace; the card says the request went to Wright and nothing changes until the new version is approved.

**Edge cases**
- [ ] **AC6.** Given `studio approvals` printing a display longer than `MAX_APPROVAL_DISPLAY` (4,000), when it is cut, then it ends with a visible mark naming how many characters were left out and how to see them all (`studio approvals --json`, or the app's Approvals screen); it never ends mid-sentence with no mark. (The kernel's approval notification body carries no display today, so the CLI list is the one short surface.)
- [ ] **AC7.** Given the drafting thread was summarized and started fresh (17c), when the owner uses Ask or change, then it posts into the thread that holds the charter's latest version (the thread of the message whose `session_id` is the latest held version's `requesting_session`), and the box says which thread by its title; when that message is not among the loaded thread items, the box says so and sends nothing (never a guessed thread).
- [ ] **AC8.** Given no saved workspace matches, when the workspace question shows, then it offers **Choose folder…** and **Clone it for me** only.

**Error scenarios**
- [ ] **AC9.** Given the clipboard write fails, when copy is used, then the owner is told it did not copy (a visible alert), never a silent success.
- [ ] **AC10.** Given a chosen folder inside a protected folder (D31), when it is chosen, then the card shows the kernel's `protected_folder` refusal from `POST /workspaces` in plain words and proposes nothing (no Reply is posted).
- [ ] **AC11.** Display text is untrusted: every part (head, readiness, jobs, never, limits, each details block, the "what changed" line) is rendered through `printable` as a React text child, never markup, in every view, and copy writes the raw stored text, not HTML.

**Owner decisions made testable**
- [ ] **AC12.** Given a pending `kernel_agent_create` (or `kernel_agent_update`) for member X, when Wright holds a new charter call for member X, then in the same transaction the older pending approval becomes `denied` with `decision: "deny"` and `decided_by: "kernel"`, its `approval_decided` event carries `replaced_by: <new id>`, `GET /approvals?all=1` shows `replaced_by` on it, no decision message is enqueued for it, and a pending charter call for a different member is untouched.
- [ ] **AC13.** Given the workspace question, when **Clone it for me** is used, then a Reply asking Wright for a clone of the repo is posted into the drafting thread and the card says cloning is not built yet and nothing was cloned; no approval kind, route or file write is added for cloning.
- [ ] **AC14.** Given a pending `kernel_agent_update`, when Chat shows it, then it renders as the charter card (not the generic approval card), with item 16's "Adds" / "Keeps" marks.

**Evidence rule:** every criterion above is shown by a committed test (kernel vitest, app vitest, or Playwright e2e). The requirement's Validation 2 (running system, the owner's walk) is recorded in a committed `docs/evidence/phase-8-18d-charter-card-in-chat.md` with the line `Verdict: PASS for Validation 2` at column 0 when the owner walks it, as items 18b and 18c did; the PR body links to it.

## Scope widening
- kernel/src/approvals/replace.ts
- kernel/src/approvals/cli.ts
- kernel/src/sessions/types.ts
- kernel/src/sessions/manager.ts
- kernel/src/agents/charter-tools.ts
- kernel/test/approvals-replace.test.ts
- kernel/test/agents-charter-tools.test.ts
- kernel/test/playbooks-fit.test.ts
- app/src/api/contract.ts
- app/src/components/copyText.ts
- app/src/components/IconButton/IconButton.tsx
- app/src/components/IconButton/IconButton.css
- app/src/components/IconButton/IconButton.test.tsx
- app/src/screens/approvals/charterBlocks.ts
- app/src/screens/approvals/charterBlocks.test.ts
- app/src/screens/approvals/ApprovalsScreen.test.tsx
- app/src/screens/chat/CharterCard.tsx
- app/src/screens/chat/CharterCard.test.tsx
- app/src/screens/chat/Thread.tsx
- app/src/screens/chat/ThreadControls.tsx
- app/src/screens/chat/continuity.test.ts
- app/e2e/chat-charter-card.spec.ts
- app/e2e/fixture-kernel.ts
- docs/architecture/app.md
- docs/DESIGN.md
- docs/evidence/phase-8-18d-charter-card-in-chat.md
- app/src/components/IconButton/*
- app/src/screens/chat/CharterAsk.tsx
- kernel/src/approvals/index.ts
- app/src/screens/chat/keyboard.test.tsx
- app/src/screens/chat/thread.test.tsx
- app/e2e/chat.spec.ts
- app/e2e/fixtures/chat.ts
- docs/architecture/agents.md
- kernel/src/features/contribution.ts
- kernel/test/playbooks-dry-run.test.ts
- accepted: LP-SCOPE 2026-11-11

## Touched-file invariants

> Grounded at base `327c6e3b953b151ae33aea8e270978e9959f697f`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/approvals/store.ts`** — keep: `requestApproval` writes the row, one `approval_requested` event and one notification in ONE transaction, and the display never enters `payload_json` (grant matching is on the canonical payload: "neither ever enters `payload_json`"); `decideApproval`'s `UPDATE approvals SET status = ?, decision = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'` guard; `MAX_APPROVAL_DISPLAY` stays exported (it becomes the CLI list's cut and the charter head-fit bound) and `MAX_REQUEST_PAYLOAD_JSON = 64_000` stays the bound of the whole stored display. reuse: `approvalApply`'s read of the `approval_decided` event (`SELECT payload_json FROM events WHERE kind = 'approval_decided'`) for the new `replaced_by` field, the existing `appendEvent`; withdraw uses `by` value `"kernel"` as `approval_used` already does (`{ id, tool: rail.tool, by: "kernel" }`). pinned by: `kernel/test/approvals.test.ts` (`kernel_gate_error`), and the six cut pins that change with the contract, per the requirement's Assumptions: `kernel/test/agents-charter-tools.test.ts` (the four `expect(shown.length).toBe(MAX_APPROVAL_DISPLAY)` and `.slice(0, MAX_APPROVAL_DISPLAY)`) and `kernel/test/playbooks-dry-run.test.ts` (`expect(payload.display).toHaveLength(4000)`, its test title "held with the display (cut to 4000 characters)"). A repo-wide sweep (`grep -rnE "toHaveLength\(4_?000\)|4_?000\)|MAX_APPROVAL_DISPLAY|repeat\(5000\)" kernel/test app/src app/e2e`) found no other stored-display pin: `kernel/test/phase-4-exit-live.test.ts` (`clipped(display, 4_000)`) only clips its own recorded copy, and `kernel/test/playbooks-fit.test.ts` (`toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY)`) stays true.
- **`kernel/src/approvals/index.ts`** — keep: it is a re-export barrel only (`MAX_REQUEST_PAYLOAD_JSON,` among the store's exports); add `withdrawReplaced` beside them, no logic.
- **`kernel/src/features/contribution.ts`** — keep: `beforeHold?(args: z.infer<z.ZodObject<S>>, ctx: ContributedToolContext): HeldToolVerdict;` is unchanged; only its doc comment (`A hold may add \`agentNote?\``) gains `subject?`.
- **`app/src/api/contract.ts`** — mirror: `export interface Approval` mirrors the kernel's `ApprovalView`; `readonly replaced_by?: number;` sits beside `readonly apply_refused?: string;` with the same "present only then" rule, and no other route or type changes.
- **`app/src/screens/approvals/ApprovalsScreen.tsx`** — keep: its decision buttons, Always rules (`MERGE_ALWAYS_REFUSED`), refusal lines and the non-charter cards are unchanged; the charter card keeps rendering through `CharterDisplay` (`charterDisplayParts`), and the only addition is `CharterAsk` on a pending charter approval plus the whole-card Copy (wiring). pinned by: `app/src/screens/approvals/ApprovalsScreen.test.tsx` (the raw disclosure now starts closed: cases that read `charter-raw` open it first).
- **`app/e2e/fixture-kernel.ts`, `app/e2e/fixtures/chat.ts`** — mirror: every fixture approval has the kernel `ApprovalView` shape (`approvalOf(9, "kernel_agent_create", CHARTER_DISPLAY)`), and a replaced one carries `status: "denied"`, `decision: "deny"`, `decided_by: "kernel"`, `replaced_by`; the drafting agent message's `session_id` equals the approval's `requesting_session`. Fixtures stay fake data only (no real kernel).
- **Tests rewritten or moved** (`app/src/screens/chat/cards.test.tsx`, `thread.test.tsx`, `keyboard.test.tsx`, `app/e2e/chat.spec.ts`, `CharterDisplay.test.tsx`) — keep: each pin's intent (XSS shown as text, tab order reaches every control, the Approvals card's marks) moves to the new card; no pin is deleted without its replacement (see Pin mutations).
- **`kernel/src/sessions/manager.ts`** — keep: `checkedVerdict` is a closed key set that throws on anything else so the gate denies `kernel_gate_error` (fail closed): `keys.every((k) => k === "display" || k === "subjectVersion" || k === "agentNote")`; `agentNote` is never stored. mirror: the `hold` object passed to `holdOrUseGrant` (`{ display: verdict.display, ...(verdict.subjectVersion === undefined ? {} : { subjectVersion: verdict.subjectVersion }) }`) gains `subject` the same optional way. fired by: every `ALWAYS_HELD_TOOLS` call through `this.#heldToolCheck`.
- **`kernel/src/sessions/types.ts`** — keep: `HeldToolVerdict` stays a union with the `{ readonly refuse: string }` arm unchanged; the new key is optional (`readonly subject?: string`).
- **`kernel/src/agents/charter-tools.ts`** — keep: the head-fit refusals stay (`displayFitRefusal`, `updateFitRefusal`, text "over the ${MAX_APPROVAL_DISPLAY} the owner is shown") because the CLI list still cuts at that length and the head must never be the cut part; the display text itself (`createDisplay`, `updateDisplay`) is unchanged byte for byte. reuse: `heldVerdict(display, readiness)` is the one place a hold's verdict is built: add `subject: \`agent:${id}\`` there (create: the validated charter's id; update: the member id). pinned by: `kernel/test/agents-charter-tools.test.ts`, `app/src/screens/approvals/subject.test.ts` (reads this file as text for `updateHead`).
- **`kernel/src/approvals/cli.ts`** — keep: every display line goes through `shown` via `displayText(text, indent)` so no line can leave the `display:` block; `--json` prints the API's JSON unchanged (that is where the full text is). pinned by: `kernel/test/approvals.test.ts` (`formatApprovals`).
- **`app/src/screens/approvals/CharterDisplay.tsx`** — keep: every kernel string goes through `printable` and is a React text child ("Every part is untrusted text"); the readiness block, `READINESS_STATUS_LABELS`, `ADDS` / `ADDS_TOOLS` / `KEEPS` marks and the catalogue-unavailable note (`charter-note`) keep rendering exactly as item 16/18b pinned them. change: the raw disclosure (`<details className="approvals-charter-raw" open`) starts closed (owner decision 2026-11-10). pinned by: `app/src/screens/approvals/CharterDisplay.test.tsx` (`RAW_SUMMARY`, `charter-raw`).
- **`app/src/screens/chat/cards.tsx`** — keep: `useCardAction`'s one in-flight guard per card and `approvalChanges(agent)` invalidation; `ApprovalCard`, `PlaybookCard` and `TriggerCard` unchanged. The `CharterCard` export moves to `CharterCard.tsx` and `cards.tsx` re-exports it so `Thread.tsx`'s `import { ApprovalCard, CharterCard, PlaybookCard, TriggerCard } from "./cards"` keeps working. pinned by: `app/src/screens/chat/cards.test.tsx` (charter tests move to `CharterCard.test.tsx`).
- **`app/src/screens/chat/continuity.ts`** — keep: no React and no markup or `href` built from a kernel string ("nothing here builds markup or an `href` from one"); `askBodyOf` sends exactly `{text, agent[, workspace]}` for a plain send. reuse: `askBodyOf({ text, agent, continues })` for the Ask or change post, `threadOf(item)` and `summarizedInto(api, agent, thread)` for AC7. pinned by: `app/src/screens/chat/continuity.test.ts`.
- **`app/src/screens/chat/Thread.tsx`** — keep: pending approvals render after the items in `chat-pending-approval` rows; the composer's `setText` / `focusComposer` stay for its other callers. change: `approval.action === "kernel_agent_create"` becomes `isCharterApproval(approval)` (AC14), and `CharterCard` gets no `onEditInEnglish` prop any more: "Edit in English" is removed and replaced by the card's Ask or change box (one outcome, see Implementation notes). pinned by: `app/src/screens/chat/thread.test.tsx` (`.chat-charter-display` XSS pin, moves to the new card's details/plain parts), `app/src/screens/chat/keyboard.test.tsx` (`"Create", "Edit in English", "Deny"` tab order, rewritten to the new card's order from DESIGN.md §"Keyboard"), `app/e2e/chat.spec.ts` (Tab reaches "Edit in English" and the composer holds `About the charter in approval 9: `, rewritten to the Ask or change box posting a Reply).
- **`app/src/screens/chat/ThreadControls.tsx`** — reuse/extract: its private `copyText` (async clipboard, else the selection's copy) moves to `app/src/components/copyText.ts` and is imported back unchanged in behaviour.

## Closed enumerations touched

> Sibling grep at base `327c6e3b`: `grep -rnF 'agentNote' kernel app docs --exclude-dir=node_modules` → hits in 8 files.

- **`subject`** (sibling: `agentNote`, a `HeldToolVerdict` key) — must be named in:
  - `kernel/src/sessions/manager.ts` — `checkedVerdict`'s closed key set, `keys.every((k) => k === "display" || k === "subjectVersion" || k === "agentNote")` — extend (a non-empty string, at most 200 characters).
  - `kernel/src/sessions/types.ts` — `export type HeldToolVerdict = … { readonly display: string; readonly subjectVersion?: number; readonly agentNote?: string }` — extend.
  - `docs/architecture/approvals.md` — the verdict table row `` `{display, subjectVersion?, agentNote?}` `` — extend, and its "cut to 4,000 characters" wording becomes "kept whole up to 64,000".
  - `kernel/src/features/contribution.ts` — `beforeHold`'s doc comment lists the verdict keys in prose (`` `{display,\n * subjectVersion?}` holds it `` … `A hold may add \`agentNote?\``) — extend: document `subject?` and that a hold naming one withdraws an older pending hold with the same subject.
  - `kernel/src/agents/charter-readiness.ts`, `kernel/test/agents-charter-readiness.test.ts` — `agentNote` producer and its tests — no change: they do not enumerate the verdict's keys.
  - `docs/architecture/agents.md` — no change for the key list, but its two "cut at 4,000 characters" statements (`The approval's display is cut at 4,000 characters` and `**The display is cut at 4,000 characters.**`) are reworded to the new contract (stored whole up to 64,000; `studio approvals` cuts at `MAX_APPROVAL_DISPLAY` with a mark; the head-fit refusal stays) — extend.
- **`replaced_by`** (sibling: `apply_refused`, an `approval_decided` event field surfaced on `ApprovalView`) — `grep -rnF 'apply_refused' kernel/src app/src` — must be named in:
  - `kernel/src/approvals/store.ts` — `ApprovalView` and `approvalApply`'s reader — extend.
  - `app/src/api/contract.ts` — `export interface Approval` (`readonly apply_refused?: string;`) — extend with `readonly replaced_by?: number;`.
  - `app/src/screens/budget/audit-sentences.ts` (`approval_decided: (p) =>`) — no change: it reads `id`, `decision`, `by`, `action` by name and ignores other keys.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-charter-tools.test.ts` — the five cut pins (the `shown.length` pins and the `.slice(0, MAX_APPROVAL_DISPLAY)` pin) rewritten to the whole display | flip `MAX_REQUEST_PAYLOAD_JSON)` → `MAX_APPROVAL_DISPLAY)` in `kernel/src/approvals/store.ts` |
| `kernel/test/playbooks-dry-run.test.ts` — the sixth cut pin, rewritten to `expect(payload.display).toHaveLength(5009)` (the whole display) and equal to the listed approval's display | flip `MAX_REQUEST_PAYLOAD_JSON)` → `MAX_APPROVAL_DISPLAY)` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals-replace.test.ts` — a pending charter call for a different member, a non-charter pending call and an already-decided one stay untouched | delete `subject = ?` in `kernel/src/approvals/replace.ts` |
| `kernel/test/approvals-replace.test.ts` — no decision message is enqueued for a withdrawn approval | flip `enqueue: false` → `enqueue: true` in `kernel/src/approvals/replace.ts` |
| `app/src/screens/chat/thread.test.tsx` — a pending `kernel_agent_update` renders as the charter card (AC14) | flip `isCharterApproval(approval)` → `approval.action === "kernel_agent_create"` in `app/src/screens/chat/Thread.tsx` |
| `app/src/screens/chat/keyboard.test.tsx` — the charter card's tab order (Copy all text, Show full details, readiness fixes, Ask or change, Send, Create, Deny) | delete `<CharterAsk` in `app/src/screens/chat/CharterCard.tsx` |
| `app/e2e/chat.spec.ts` — Tab reaches Ask or change; Send posts `POST /ask` with `continues` (replaces the "Edit in English" steps) | delete `continues: drafting.message` in `app/src/screens/chat/CharterAsk.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — Copy all text writes `approval.display` byte-equal (AC3) | flip `copyText(display)` → `copyText(shownText)` in `app/src/screens/approvals/CharterDisplay.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — Send is disabled and nothing is posted when the drafting message is not loaded (AC7) | delete `if (drafting === undefined) return;` in `app/src/screens/chat/CharterAsk.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — Clone posts a Reply and the card says nothing was cloned (AC13) | delete `CLONE_NOT_BUILT` in `app/src/screens/chat/CharterAsk.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — a `protected_folder` refusal is shown and no Reply is posted (AC10) | delete `if (!saved.ok) return;` in `app/src/screens/chat/CharterAsk.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — the older version shows "Replaced by v2" with what changed (AC4) | delete `REPLACED_BY` in `app/src/screens/chat/CharterCard.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — the charter cases moved from `cards.test.tsx` (Create / Deny writes, refusal line) | delete `"/approvals/:id/approve"` in `app/src/screens/chat/CharterCard.tsx` |
| `app/src/screens/chat/thread.test.tsx` — the XSS pin, moved from `.chat-charter-display` to the charter card's rendered parts | delete `printable(parts.head)` in `app/src/screens/approvals/CharterDisplay.tsx` |
| `kernel/test/approvals-replace.test.ts` — older pending charter call withdrawn with `replaced_by` | delete `withdrawReplaced(` in `kernel/src/approvals/store.ts` |
| `kernel/test/approvals-replace.test.ts` — `checkedVerdict` accepts `subject` and still throws on an unknown key | delete `k === "subject"` in `kernel/src/sessions/manager.ts` |
| `kernel/test/approvals-replace.test.ts` — `formatApprovals` cut mark names the characters left out | delete `more characters not shown` in `kernel/src/approvals/cli.ts` |
| `app/src/screens/approvals/CharterDisplay.test.tsx` — details hidden by default | flip `open={detailsOpen}` → `open` in `app/src/screens/approvals/CharterDisplay.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — Ask or change posts with `continues` of the drafting message | delete `continues: drafting.message` in `app/src/screens/chat/CharterCard.tsx` |
| `app/src/screens/chat/CharterCard.test.tsx` — a failed clipboard write shows an alert | flip `if (!copied)` → `if (false)` in `app/src/screens/approvals/CharterDisplay.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: keep the display whole, mark the CLI cut, withdraw a replaced charter hold | AC2 (kernel half), AC6, AC11 (CLI), AC12 | 12 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | App: compact charter card with complete, copyable details, Ask or change into the drafting thread, versions and the workspace question | AC1, AC2 (app half), AC3, AC4, AC5, AC7, AC8, AC9, AC10, AC11, AC13, AC14 | 20 modify, 11 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel-approvals | `kernel/src/approvals/store.ts` (781 — store the display sliced to `MAX_REQUEST_PAYLOAD_JSON`; `ApprovalRequest` gains `subject?`, recorded on `approval_requested`; call `withdrawReplaced` inside `requestApproval`'s transaction; `ApprovalView.replaced_by` read beside `approvalApply` — a few lines each, the single authority for the row/event pair), `kernel/src/approvals/cli.ts` (275), `kernel/src/approvals/index.ts` (70 — re-export) | `kernel/src/approvals/replace.ts` (the withdraw-on-replace mechanism: find pending approvals whose `approval_requested` event names the same `subject`, decide each `deny` by `kernel` with `replaced_by`, no queued message) | HIGH |
| kernel-held-verdict | `kernel/src/sessions/types.ts` (666 — one optional key), `kernel/src/sessions/manager.ts` (3242 — the closed key set and the `hold` object only; the single authority for the verdict shape), `kernel/src/agents/charter-tools.ts` (1022 — `heldVerdict` adds `subject`; comments about the cut reworded), `kernel/src/features/contribution.ts` (685 — the `beforeHold` doc comment only) | — | HIGH |
| kernel-tests+docs | `kernel/test/agents-charter-tools.test.ts` (1283 — rewrite the five cut pins only: the four `expect(shown.length).toBe(MAX_APPROVAL_DISPLAY)` and `expect(shown).toBe(createDisplay(…).slice(0, MAX_APPROVAL_DISPLAY))`, which becomes the whole display; the "head never cut" bound stays), `kernel/test/playbooks-dry-run.test.ts` (1097 — the one `toHaveLength(4000)` pin and its test title only), `kernel/test/playbooks-fit.test.ts` (614 — `toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY)` stays true; verify only), `docs/architecture/approvals.md` (281 — including the verdict row's "cut to 4,000 characters, never refused"), `docs/architecture/agents.md` (383 — the two "cut at 4,000 characters" statements) | `kernel/test/approvals-replace.test.ts` (new tests live here, not in the 2043-line `kernel/test/approvals.test.ts`) | HIGH |
| app-shared | `app/src/api/contract.ts` (1901 — one optional field), `app/src/screens/chat/ThreadControls.tsx` (770 — import the extracted helper) | extract `copyText` into `app/src/components/copyText.ts`; `app/src/components/IconButton/IconButton.tsx`, `IconButton.css`, `IconButton.test.tsx` (the icon-only button with the DESIGN.md tooltip and its charter-card icons: copy, maximize-2/minimize-2, ellipsis/chevron-up, folder, download) | HIGH |
| app-charter-view | `app/src/screens/approvals/CharterDisplay.tsx` (152), `app/src/screens/approvals/CharterDisplay.test.tsx` (499), `app/src/screens/approvals/approvals.css` (473), `app/src/screens/approvals/ApprovalsScreen.tsx` (1047 — wiring only: render `CharterAsk` on a charter card and link to its thread), `app/src/screens/approvals/ApprovalsScreen.test.tsx` (1261 — the new Approvals-screen cases only) | `app/src/screens/approvals/charterBlocks.ts` + `charterBlocks.test.ts` (pure: split `CharterDisplayParts.raw` into the enforced lines, the settings file (`config/agents/<id>.json:`) and `role.md` (`memory/<id>/role.md:`) blocks; the never list and limits in plain words from the `enforced:` and `limits:` lines (an unknown token shown as its own text); the "what changed" sentence between two displays; the repo candidates (`owner/repo` tokens) in the display's duty and `role.md` text) | HIGH |
| app-chat | `app/src/screens/chat/cards.tsx` (478 — remove `CharterCard`, re-export it), `app/src/screens/chat/cards.test.tsx` (715 — move the charter cases out), `app/src/screens/chat/Thread.tsx` (701 — `isCharterApproval`, pass items, approvals and the drafting thread to the card), `app/src/screens/chat/continuity.ts` (289 — `draftingMessage(items, approval)` and the latest-version thread for AC7), `app/src/screens/chat/continuity.test.ts`, `app/src/screens/chat/chat.css` (472), `app/src/screens/chat/thread.test.tsx` (968 — move the `.chat-charter-display` XSS pin to the new card), `app/src/screens/chat/keyboard.test.tsx` (116 — the charter card's tab order) | `app/src/screens/chat/CharterCard.tsx` (the Chat card: compact `CharterDisplay`, the collapsed "Replaced by v<n>" line, `CharterAsk`, Create and Deny), `app/src/screens/chat/CharterCard.test.tsx`, `app/src/screens/chat/CharterAsk.tsx` (the Ask or change box and the workspace question, shared by Chat and Approvals) | MEDIUM |
| app-e2e+docs | `app/e2e/fixture-kernel.ts` (409 — a held charter fixture over 4,000 characters, a replaced v1, saved workspaces), `app/e2e/chat.spec.ts` (498 — the "Edit in English" steps become the Ask or change Reply), `app/e2e/fixtures/chat.ts` (341 — the drafting agent message with `session_id` equal to approval 9's `requesting_session`), `docs/architecture/app.md` (209), `docs/DESIGN.md` (410 — record the owner's 2026-11-11 answers to open points 1–3) | `app/e2e/chat-charter-card.spec.ts`, `docs/evidence/phase-8-18d-charter-card-in-chat.md` (Validation 2, written at the owner's walk) | MEDIUM |

**Total estimated files:** 32 modify + 13 create (tests counted).

**Module layout notes (`skills/supervisor-readiness/SKILL.md` §"Module layout"):** every new responsibility has its own CREATE home: the withdraw mechanism (`replace.ts`), the block/plain-words parsing (`charterBlocks.ts`), the icon button and tooltip (`IconButton/`), the Chat card (`CharterCard.tsx`, out of the 478-line `cards.tsx`), the shared Ask/workspace box (`CharterAsk.tsx`, kept out of the 1047-line `ApprovalsScreen.tsx`). Appends to large files are wiring only, with the reason in the map. The `copyText` helper is extracted rather than copied a third time.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/screens/chat/cards.tsx:146` | yes | HOLDS | `<pre className="chat-charter-display">{approval.display ?? ""}</pre>` | tip 20 minutes ago, fetched <1h |
| `kernel/src/approvals/store.ts:117` | yes | HOLDS | `export const MAX_APPROVAL_DISPLAY = 4_000;` | tip 20 minutes ago, fetched <1h |
| `kernel/src/approvals/store.ts:278` | yes | HOLDS | `requested.display = request.display.slice(0, MAX_APPROVAL_DISPLAY);` | tip 20 minutes ago, fetched <1h |
| `app/src/screens/chat/cards.tsx:125` | yes | HOLDS | `/** Edit in English: put \`text\` in the composer and focus it. Sends nothing. */` | tip 20 minutes ago, fetched <1h |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/approvals/replace.ts"}
  - {kind: "symbol", path: "kernel/src/approvals/replace.ts", name: "withdrawReplaced"}
  - {kind: "symbol", path: "kernel/src/approvals/store.ts", name: "replaced_by"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "subject"}
  - {kind: "symbol", path: "kernel/src/approvals/cli.ts", name: "more characters not shown"}
  - {kind: "file", path: "kernel/test/approvals-replace.test.ts"}
requires: []
lanes:
  - "kernel/src/approvals/store.ts"
  - "kernel/src/approvals/replace.ts"
  - "kernel/src/approvals/cli.ts"
  - "kernel/src/approvals/index.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/test/approvals-replace.test.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "kernel/test/playbooks-fit.test.ts"
  - "kernel/test/playbooks-dry-run.test.ts"
  - "kernel/src/features/contribution.ts"
  - "docs/architecture/approvals.md"
  - "docs/architecture/agents.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "app/src/screens/chat/CharterCard.tsx"}
  - {kind: "symbol", path: "app/src/screens/chat/CharterCard.tsx", name: "CharterCard"}
  - {kind: "file", path: "app/src/screens/chat/CharterAsk.tsx"}
  - {kind: "symbol", path: "app/src/screens/chat/CharterAsk.tsx", name: "CharterAsk"}
  - {kind: "file", path: "app/src/screens/approvals/charterBlocks.ts"}
  - {kind: "symbol", path: "app/src/screens/approvals/charterBlocks.ts", name: "charterBlocks"}
  - {kind: "file", path: "app/src/components/IconButton/IconButton.tsx"}
  - {kind: "symbol", path: "app/src/components/IconButton/IconButton.tsx", name: "IconButton"}
  - {kind: "symbol", path: "app/src/components/copyText.ts", name: "copyText"}
  - {kind: "symbol", path: "app/src/screens/chat/continuity.ts", name: "draftingMessage"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "replaced_by"}
  - {kind: "file", path: "app/e2e/chat-charter-card.spec.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/approvals/store.ts", name: "replaced_by"}
lanes:
  - "app/src/api/contract.ts"
  - "app/src/components/copyText.ts"
  - "app/src/components/IconButton/*"
  - "app/src/screens/approvals/CharterDisplay.tsx"
  - "app/src/screens/approvals/CharterDisplay.test.tsx"
  - "app/src/screens/approvals/charterBlocks.ts"
  - "app/src/screens/approvals/charterBlocks.test.ts"
  - "app/src/screens/approvals/ApprovalsScreen.tsx"
  - "app/src/screens/approvals/ApprovalsScreen.test.tsx"
  - "app/src/screens/approvals/approvals.css"
  - "app/src/screens/chat/CharterCard.tsx"
  - "app/src/screens/chat/CharterCard.test.tsx"
  - "app/src/screens/chat/CharterAsk.tsx"
  - "app/src/screens/chat/cards.tsx"
  - "app/src/screens/chat/cards.test.tsx"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/ThreadControls.tsx"
  - "app/src/screens/chat/continuity.ts"
  - "app/src/screens/chat/continuity.test.ts"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/thread.test.tsx"
  - "app/src/screens/chat/keyboard.test.tsx"
  - "app/e2e/chat-charter-card.spec.ts"
  - "app/e2e/fixture-kernel.ts"
  - "app/e2e/chat.spec.ts"
  - "app/e2e/fixtures/chat.ts"
  - "docs/architecture/app.md"
  - "docs/DESIGN.md"
  - "docs/evidence/phase-8-18d-charter-card-in-chat.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (kernel) ──→ Subtask 2 (app)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (the app's `replaced_by` mirrors the kernel's field name; ordered by `requires`) | YES (by dependency) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1 at a time
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Implementation notes (binding where they say "must")

- **Whole display, short surface marked (Part A, AC2, AC6).** `requestApproval` stores `request.display.slice(0, MAX_REQUEST_PAYLOAD_JSON)`. `MAX_APPROVAL_DISPLAY` stays 4,000 and now means "what the CLI list shows": `formatApprovals` prints the first `MAX_APPROVAL_DISPLAY` characters, then a line `    … <n> more characters not shown; studio approvals --json, or the app's Approvals screen, shows all of it`. The charter head-fit refusals in `charter-tools.ts` stay, so the head is never in the cut part. The six cut pins (five in `agents-charter-tools.test.ts`, one in `playbooks-dry-run.test.ts`) change to expect the whole display (the requirement's stated contract change).
- **Withdraw on replace (owner decision 1, AC12).** `HeldToolVerdict` gains `subject?: string` (non-empty, ≤ 200 characters, else `checkedVerdict` throws → `kernel_gate_error`). Charter holds set `subject: "agent:<member id>"`. `requestApproval` records `subject` on the `approval_requested` event (never in `payload_json`) and, in the same transaction after inserting the new row, calls `withdrawReplaced(store, subject, newId, at)`: every OTHER `pending` approval whose `approval_requested` event has the same `subject` becomes `denied` / `deny` / `decided_by: "kernel"` with one `approval_decided` event `{id, decision: "deny", by: "kernel", action, replaced_by: newId}`, and **no** queued decision message (Wright is the one replacing it). A grant is never used or consumed by a withdraw. `ApprovalView` exposes `replaced_by` (present only then). Approving is never done by the kernel.
- **Compact view (AC1).** `CharterDisplay` takes the parts plus the blocks from `charterBlocks.ts`. Compact: who, Can do (jobs and purposes, or the compact labels), Never does, Limits, then readiness; Show full details (an `IconButton`, `maximize-2`/`minimize-2`) reveals the blocks. The details start hidden on both screens.
- **Details (AC2, AC3).** Four blocks: kernel tools by job, enforced lines, settings file, `role.md`; each a scrollable region (`tabIndex=0`, `role="region"`, an accessible name), with Show more (`ellipsis`/`chevron-up`) and its own Copy. Above them: "<n> characters, nothing cut". Copy all text writes `approval.display` exactly; a block's copy writes the block's raw text. Copy shows a check for two seconds and a toast with the character count (DESIGN.md); a failure shows an alert "Did not copy" (AC9).
- **Versions (AC4).** A card for approval N finds, in the approvals list read with `all=1`, the approval whose `replaced_by` is N (and its own predecessors), numbers the chain v1..vn, and above the live card shows each older one collapsed: "<name> · v<k> · Replaced by v<k+1> · <what changed>" (a `<details>` opening its read-only card, no Create or Deny). "What changed" compares the two displays' parts: jobs added or removed, workspaces line changed ("workspace set"), limits line changed.
- **Ask or change (AC4, AC7).** `CharterAsk` posts `askBodyOf({ text: "From the card's Ask or change (approval <id>): <words>", agent: <the agent the drafting message belongs to>, continues: drafting.message })`. `draftingMessage(items, approval)` is the agent message (`from_agent === null` is the owner's; the drafting one carries a `reply_text`) whose `session_id === approval.requesting_session`; its thread is `threadOf(item)`. The box names that thread's title. Not found → the box says the drafting message isn't loaded and Send is disabled. On the Approvals screen the box reads the requesting agent's thread through the existing thread route, posts the same way, and links to `#/chat/<agent>` at that thread. "Edit in English" is removed and replaced by this box: `CharterCard` drops its `onEditInEnglish` prop and `Thread.tsx` stops passing it; the tests that pinned it (`keyboard.test.tsx`, `thread.test.tsx`, `app/e2e/chat.spec.ts`) are rewritten to the new card.
- **Workspace question (AC5, AC8, AC10, AC13).** Shown only when the readiness block has a `flagged` line of the workspace kind (`no copy of a repo to work in`) and the card is live (not a replaced version). Repo candidates: `owner/repo` tokens found in the display's duty lines and `role.md` block; for each, `GET /workspaces?repo=<owner/repo>` (the kernel validates the format and refuses anything else); rows with `state: "ready"` are offered with Use this folder. None, or no repo named → only Choose folder… and Clone it for me. Choose folder… uses the 18c bridge `chooseFolder()`, then `POST /workspaces` (a `protected_folder` / `not_checkout` / `unreadable` refusal is shown in its own words and nothing is posted). Use or Choose then posts a Reply: "Use the workspace at <path> for <member> (from the card's workspace question)". Clone it for me posts "Clone <repo or 'the repo'> for <member> (from the card's workspace question)" and the card says "Cloning isn't built yet; nothing was cloned. Wright has your request." Every path is shown through `formatHomePath`, never building markup from it.
- **Icons with tooltips (Part B).** `IconButton` is a `<button aria-label=…>` whose tooltip (DESIGN.md "Tooltip": `caption` type, `surface` text on `ink`, `radius-xs`, `shadow-2`) shows on hover and focus, hides on `Esc` until pointer/focus leaves, and is `aria-hidden` (the accessible name is the label). Icons: Lucide paths from `docs/design/mockups/charter-card.html`, `currentColor`, 16px. No new token.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope beyond the requirement's Touches (36 paths, listed in `## Scope widening` as `pending-coordinator`): the owner's "withdraw v1" needs the verdict seam (`types.ts`, `manager.ts`, `charter-tools.ts`); the CLI list lives in `kernel/src/approvals/cli.ts`, not `kernel/src/cli/index.ts`; versions and the drafting thread need `Thread.tsx` and `contract.ts`; new modules keep large files from growing | HIGH (scope) — Feasibility (Phase 2.5) | The coordinator's scope re-gate asks the owner once; `kernel/src/cli/index.ts` is in Touches but needs no change |
| The kernel's readiness line for a missing workspace names no repo, so "saved workspaces whose remote matches the repo" depends on an `owner/repo` the charter's own text names | MEDIUM — Feasibility (Phase 2.5) | Repo candidates come from the display's duty and `role.md` text and are used only as a lookup query the kernel validates; with none, the question offers Choose folder… and Clone it for me (AC8) and says no repo was named. A kernel field naming the repo is a follow-up |
| A withdraw runs in Wright's hold transaction: a bug could deny an unrelated pending approval | HIGH | `subject` is matched exactly, set only by the two charter holds; tests cover a different member's pending call, a non-charter pending call and an already-decided one staying untouched; withdraw never approves and never consumes a grant |
| The old 4,000 cut also bounded the app's payload: a 64,000-character display in Chat is heavy | MEDIUM | Details render only when expanded (the requirement's own mitigation); the blocks scroll inside the card |
| Wright's answer and v2 (AC4's second half) depend on a live model turn | MEDIUM | Tests drive the fixture kernel (the Reply's body, then a fixture v2 with `replaced_by` on v1); the live Wright turn is the requirement's Validation 2 walk |
| Clone is offered but not built (owner decision 2) | LOW | The card says so plainly (AC13); the follow-up item is named in the PR body and in `docs/DESIGN.md` beside the recorded decision |
| `kernel/src/sessions/manager.ts` is 3,242 lines and on a hot path | MEDIUM | Change only `checkedVerdict`'s key set and the `hold` object; no restructuring |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-11-the-charter-card-in-chat.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-11T14:34:52Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/262
- **Branch:** feature/the-charter-card-in-chat
- **Files changed:** 44
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unarmed (marker_missing)
- **Summary:** Kernel keeps the approval display whole (≤64,000), marks the CLI cut, and withdraws an older pending charter hold for the same member (deny by kernel, replaced_by). The app's charter card is compact by default and has full copyable details, Ask or change into the drafting thread, Replaced by v<n>, and the workspace question. Three heal rounds fixed 2 MEDIUM + 1 HIGH + 1 MEDIUM. The last fix (tests only, 105/105 pass) was not re-reviewed because the iteration bound was reached. Validation 2 (owner walk) pending. Children check skipped by the owner (benign: a Context-Keeper turn-limit stop and the first subtask-2 worker's turn-limit stop).

## Not verified
- **app Approvals and Chat screens rendering replaced_by and whole display** — subtask 2 lane (subtask 1)
- **studio approvals against a live daemon** — tested via formatApprovals and fake API client (subtask 1)
- **live Wright turn producing held v2 after Ask or change** — needs a live model turn; Validation 2 walk (subtask 2)
- **app against real kernel routes and native folder picker** — e2e uses fixture kernel and replaced dialog (subtask 2)
- **full npm run e2e suite** — only 5 charter-related specs run (subtask 2)
