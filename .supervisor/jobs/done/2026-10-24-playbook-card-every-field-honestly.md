# Supervisor Job: The playbook card shows unset fields as unset, sets each field on its own row, survives Turn off, and kernel decision messages render as kernel cards

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L7
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115025-the-playbook-card-shows-and-sets-every-field-honestly.md
- **Base commit:** 86265042f043827edf99daa14e0342a6816e2abe

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript app under `app/` (vitest unit tests, Playwright e2e through `app/e2e/electron-harness.ts`); no new dependency |
| 2 | Dependency Availability | GO | Everything needed exists: `GET /playbooks?all=1` (`kernel/src/playbooks/drafts.ts`: "all=1 adds disabled"), `POST /playbooks/:id/set`, and the message row's `source` field (`approval:<id>` for a kernel decision, `kernel/src/brain/context.ts`) |
| 3 | Architecture Fit | CAUTION | The kernel has **no owner route to turn a disabled playbook back on** (routes in `kernel/src/playbooks/`: list, show, set, off, run; enabling is only through an approval of a draft). Scope 3 says "Turn on where the kernel allows it", so the card shows no Turn on and says so in text; no kernel change |
| 4 | Scope vs Supervisor Capability | GO | One coherent UI change in `app/src/screens/chat/` plus its store read, tests and evidence: 14 modify (+1 maybe) and 4 PNG creates. That passes the >12-file `context-bound` bound, which permits but does not require a split; one worker is kept because 9 of the 14 are tests, fixtures or the evidence README, the change is well under 800 changed lines, and every file serves the one card (a split would serialize on `cards.tsx` anyway) |
| 5 | Hard Blockers | GO | None; the requirement's one unverified assumption (the kernel list can include disabled playbooks) is verified at `kernel/src/playbooks/drafts.ts` (`listPlaybooks(req.store, { all: req.query.all === "1" ... })`) |

**Overall Verdict:** CAUTION

## Task
**Goal:** In Chat's playbook card, show every unset policy value as "not set" (Model: "not set: needed before a dry run"), give each settable policy row its own inline Set action with a hint that never moves the controls, keep the card (status `disabled`, trigger card still reachable) after Turn off by reading the kernel's playbook list with disabled ones, and render a kernel approval-decision message as a kernel card instead of an owner "You" bubble.

**Problem Statement:**
The owner needs to drive a playbook from Chat without guessing where a control is, because the phase 5 live run (2026-10-24) showed four defects that block the phase 5 rerun.
Currently, the card shows Model "default" when unset (`playbook.model ?? "default"` in `app/src/screens/chat/cards.tsx`) although the kernel refuses a dry run with no model; the model is settable only through a separate Field dropdown; a text Value's hint ("none clears it") makes the Value column taller so FIELD, VALUE and Set don't line up; after Turn off the card reads "Playbook 3 is not in the kernel's playbook list" because the store reads `GET /playbooks` without `all=1`; and the kernel's "approved approval 6: …" message renders as the owner's "You" bubble. This causes the owner to misread state and lose access to a turned-off playbook's still-on trigger from Chat.
Success looks like: unset reads "not set", each policy row edits inline and posts `POST /playbooks/:id/set`, the card and its trigger card survive Turn off, and decision messages read as the kernel's.

**Kernel facts this brief rests on (verified at the base commit):**
- `GET /playbooks?all=1` adds disabled playbooks (`kernel/src/playbooks/drafts.ts` header and route). No kernel change is needed for scope 3.
- The owner-settable policy fields are exactly `PLAYBOOK_POLICY_FIELDS = ["dedupe_key", "priority", "model", "token_limit"]` (`kernel/src/playbooks/store.ts`); `none` clears a nullable field; priority cannot be cleared; `setPlaybookPolicy` keeps a disabled playbook disabled (so Set stays offered on a disabled card). API-key fallback is **not** owner-settable: its row stays read-only.
- There is no owner Turn on route: the only enable path is the approval of `kernel_playbook_enable` on a **draft** (`kernel/src/playbooks/enable.ts`), and an owner's off is final for agents. `POST /playbooks/:id/run` refuses a playbook that is not enabled (`kernel/src/playbooks/runs.ts`).
- A kernel approval decision is queued as a `message` event with `sourceRef: \`approval:${id}\`` (`kernel/src/approvals/store.ts`), and the message row's `source` is `approval:<id>` (`kernel/src/brain/context.ts`: "`ask`, `trigger:<id>`, `approval:<id>`, `agent:<id>`, `message`"). The thread item carries it (`ThreadItem` = `{type: "message"} & BrainMessage`, `app/src/api/contract.ts`).

**Design (the worker implements this; details within it are the worker's call):**
1. **Unset is "not set".** In `PlaybookCard`, every nullable policy value that is `null` reads `not set` (Dedupe key, Model, Token limit per day, API-key fallback); Model reads exactly `not set: needed before a dry run`. The string `default` never appears for a value. Provenance tags (`provenance(...)`) stay as they are.
2. **Set where you look.** Remove the separate Field dropdown form (`SET_FIELDS` select + Value + "Set {field}"). Each owner-settable row (Dedupe key, Priority, Model, Token limit per day) gets an `Edit` button named for its row (e.g. accessible name "Edit model"); activating it (click, or Enter/Space after Tab) turns that row's value into an inline editor: Priority a select of low/normal/high, the others a text input with the hint `none clears it` (Dedupe key: comma-separated fields), plus a confirm button (accessible name `Set <row>`) and Cancel; Enter in the input confirms, Escape cancels and returns focus to the row's Edit button. Confirm sends `POST /playbooks/:id/set {field, value}` with the kernel's field name through the card's existing `useCardAction` guard and `write(...)`; a refusal shows the kernel's words in the card's `Refusal` and keeps the row in edit mode. After a successful Set the row leaves edit mode and focus goes to that row's `Edit <row>` button, using the card's existing focus-after-swap pattern (`TriggerCard`'s `focusAfterSwap` ref with `focusLost()` from `./model`), so the keyboard path never drops focus to `<body>` when the card then moves after the `playbook_updated` event its Set wrote (the card must still move, not remount). The hint sits on its own line under the row's controls (a separate grid row/area), so the input, confirm and Cancel share one baseline whether or not a hint is present. Keep to the design system's tokens (`var(--space-*)`, `var(--ink-*)`, `var(--type-*)`) in `app/src/screens/chat/chat.css`; no new colour or size literals.
3. **The card survives Turn off.** `FIXED_RESOURCES.playbooks` reads `GET /playbooks` with `query: { all: "1" }` (mirroring `triggers`). A `disabled` card shows `disabled` in its head, offers neither Run now nor Turn off (the kernel refuses run on a non-enabled playbook; off is already done), still offers the per-row Set (the kernel allows it), and shows the text `Turn on: not available from the kernel` (no button: the kernel has no owner route). Its nested trigger card still renders. The command palette (`buildChatCommands`) offers no Run / Turn off command for a disabled playbook.
4. **Decision messages are the kernel's.** In `Thread.tsx`'s `MessageView`, a message whose `source` starts with `approval:` and whose `from_agent` is `null` renders as a kernel card (labelled as the kernel's, e.g. heading "Kernel" with an accessible name like `Kernel decision, approval 6`, the kernel's text as a React text child), never as `<ChatBubble speaker="You" …>`. The decision is made by `source` only, never by the text. The agent's reply/state under it renders as today. Every other source (`ask`, `trigger:<id>`, …) renders exactly as today.

## Acceptance Criteria
- [ ] AC1: Given a playbook whose `model` is `null`, when its card renders, then the Model row reads `not set: needed before a dry run` and no row of the card reads `default`; and given any other nullable policy value that is `null` (Dedupe key, Token limit per day, API-key fallback), then its row reads `not set` (unit tests in `app/src/screens/chat/cards.test.tsx`).
- [ ] AC2: Given the card, when the owner activates the Model row's `Edit model` button, types a value and confirms (`Set model` button or Enter), then exactly one `POST /playbooks/:id/set` with body `{field: "model", value: <typed>}` is sent, and after the kernel's answer the row shows the value with the `set by owner` tag, leaves edit mode, and focus is on its `Edit model` button (and stays there when the card moves after the `playbook_updated` event: the two move-keeps-focus tests, `thread.test.tsx` "a Set's playbook_updated moves the playbook card after it, the same card, with Set still focused" and `chat.spec.ts` "a card that moves after the event its own action wrote keeps the control's focus", are rewritten to assert focus on `Edit priority`, not deleted); the same inline path works for Dedupe key, Priority (select) and Token limit per day, and no separate Field dropdown remains in the card; given the kernel refuses the Set, then the card's Refusal shows the kernel's text and the row stays in edit mode; given edit mode, when Escape is pressed, then the row leaves edit mode and focus is on its `Edit <row>` button (unit tests in `cards.test.tsx`; the keyboard path Tab → Enter → type → Enter is pinned in `app/src/screens/chat/keyboard.test.tsx` and `app/e2e/chat.spec.ts`; the real-kernel walk in `app/e2e/phase-5-exit.spec.ts` sets priority through `Edit priority` → high → `Set priority` and still asserts the store row `priority_set_by: "owner"`).
- [ ] AC3: Given a text row in edit mode with its hint shown, when the card renders, then the hint is outside the controls' row (unit test asserts the hint element is not inside the element that holds the input and its Set/Cancel buttons), and then a committed evidence file `docs/evidence/phase-5-polish/chat/README.md` lists the regenerated light and dark screenshots of the populated card with a row in edit mode and its hint showing (`chat-playbook-edit-light.png`, `chat-playbook-edit-dark.png`, written by `app/e2e/chat.spec.ts` into `docs/evidence/phase-5-polish/chat/`), and the PR body links to it.
- [ ] AC4: Given an enabled playbook card with a linked trigger, when the owner clicks Turn off and the kernel answers, then the card is still in the thread, its head shows `disabled`, Run now and Turn off are gone, `Turn on: not available from the kernel` is shown, the per-row `Edit priority` (and the other Edit buttons) are still present, and the nested trigger card (with its On/Off) is still rendered; and `GET /playbooks` is read with `query: { all: "1" }` (unit tests in `app/src/screens/chat/thread.test.tsx` and `app/src/store/store.test.ts`; e2e in `app/e2e/chat.spec.ts` against the fixture whose `POST /playbooks/:id/off` turns the playbook `disabled`, with screenshots `chat-playbook-off-light.png` / `chat-playbook-off-dark.png` listed in `docs/evidence/phase-5-polish/chat/README.md`).
- [ ] AC5: Given a thread message with `source: "approval:6"` and `from_agent: null`, when the thread renders, then it renders as a kernel card (not a `You` bubble) showing the kernel's text; and given a message with `source: "ask"`, then it still renders as the `You` bubble; and a message with `source: "ask"` whose text starts `approved approval` still renders as `You` (the decision is by source, not text) (unit tests in `thread.test.tsx`).
- [ ] AC6: Given a disabled playbook in the playbooks resource, when the command palette builds, then it holds no `Run <slug>` or `Turn off <slug>` command for it (unit test in `app/src/screens/chat/commands.test.tsx`).
- [ ] AC7: `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and the whole e2e suite CI runs passes (`cd kernel && npm ci`, then `cd app && npm run build && npm run e2e`, i.e. `playwright test e2e --workers=1`; at minimum `e2e/chat.spec.ts` and `e2e/phase-5-exit.spec.ts`, the two specs that drive the playbook card).

## House rule (advisory, from the requirement's Validation)
e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Touched-file invariants

> Grounded at base `86265042f043827edf99daa14e0342a6816e2abe`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/chat/cards.tsx`** — keep: kernel strings render only as text children (`Every kernel string is a React text child only`); one in-flight guard per card for every write (`function useCardAction()`), with the Enter-submits guard on the submit path, not only the button (`Enter in the Value field submits too, so the guard sits here`); no Enable button (`No Enable: enabling stays an approval`); reuse: `provenance(setBy)` (`export function provenance(setBy: string | null): string`) for the `set by owner` / `proposed` tags, `write(api, path, params, body, changes)` and `playbookChanges(agent)` for invalidation, `LAST_DRY_RUN_GAP`-style "not available from the kernel" wording for the Turn on gap; mirror: the kernel's field names `dedupe_key`, `priority`, `model`, `token_limit` (`PLAYBOOK_POLICY_FIELDS` in `kernel/src/playbooks/store.ts`); pinned by: `app/src/screens/chat/cards.test.tsx` (`Set priority high posts and shows set by owner`).
- **`app/src/screens/chat/Thread.tsx`** — keep: the owner/delegation split on `from_agent` (`item.from_agent === null ?`) for every source other than `approval:`; card placement (`Cards: each playbook once, after its newest created/updated event`) unchanged, so a disabled playbook's card still sits after its newest event; reuse: the existing outcome rendering (reply bubble / working / failed / parked) under the kernel card; keep: a card moves (same React key), never remounts, after its own action's event; pinned by: `app/src/screens/chat/thread.test.tsx` (`a Set's playbook_updated moves the playbook card after it, the same card, with Set still focused` — rewrite its `name: /^Set priority/` focus target to the row's `Edit priority` button).
- **`app/src/store/resources.ts`** — keep: the resource table shape; mirror: the triggers entry exactly (`triggers: { method: "GET", path: "/triggers", query: { all: "1" } },`) when changing `playbooks: { method: "GET", path: "/playbooks" },`; pinned by: `app/src/store/store.test.ts` (the existing query pin `expect(fake.requestsTo("GET /messages").at(-1)?.req.query).toEqual({ all: "1" });` is the pattern for the new playbooks pin).
- **`app/src/screens/chat/commands.ts`** — keep: the per-playbook loop (`for (const playbook of playbooks ?? [])`) and the `guarded(...)` wrapper; change only what a disabled playbook offers; pinned by: `app/src/screens/chat/commands.test.tsx` (`"Run pr-review"`, `"Turn off pr-review"`).
- **`app/src/screens/chat/chat.css`** — keep: tokens only (`var(--space-`, `var(--ink-`, `var(--type-`); the existing `.chat-kv` grid (`grid-template-columns: max-content 1fr;`); the old `.chat-set {` block may go with the form it styled.
- **`app/src/screens/chat/keyboard.test.tsx`, `app/e2e/chat.spec.ts`** — keep: the full tab-order pins (rewrite `"Field",` / `"Value",` / `"Set priority",` to the new row-Edit order, never drop the order check); e2e launches only through the harness (`import { APP_DIR, launchApp } from "./electron-harness";`); the evidence-folder pins stay strict (`chat-[a-z-]+-(?:light|dark)\.png` README match and "the folder holds exactly this run's screenshots"); the move-keeps-focus test (`a card that moves after the event its own action wrote keeps the control's focus`) stays, retargeted from `await tabTo(page, "Set priority", playbookCard);` to the row path with focus asserted on `Edit priority`; pinned by: `app/scripts/hidden-windows.test.ts`.
- **`app/e2e/phase-5-exit.spec.ts`** — keep: it runs a real kernel in-process and asserts from the kernel store, not the DOM (`expect(getPlaybook(store, pb.id)).toMatchObject({ status: "draft", version: 2, priority: "high", priority_set_by: "owner" });`); rewrite only the three Field/Value/Set lines (`await card.getByRole("combobox", { name: "Field" }).selectOption("priority");` and the two after it) to the new row path (`Edit priority` → select `high` → `Set priority`); launch only through the harness; fired by: CI's `app` job (`npm run e2e`), which installs `kernel/` for this spec.
- **`app/src/screens/chat/testkit.tsx`** (only if touched) — keep: `fake.route("GET /playbooks", () => ok({ playbooks: state.playbooks }));` returning the list as given (it ignores the query, matching `all=1`); if `POST /playbooks/:id/off` (`"/playbooks/:id/off",` in the recorded-writes list) is made to flip status, mirror the kernel: the playbook stays in the list with status `disabled`.
- **`app/e2e/fixtures/chat.ts`** — keep: the fixture acts as the kernel does (`every Set writes playbook_updated`); mirror the kernel's off: `POST /playbooks/:id/off` turns the fixture playbook `disabled` and `"GET /playbooks": () => ({ status: 200, body: { playbooks } }),` then returns it with that status (the fixture ignores the query, which matches `all=1`).
- **`app/src/screens/chat/cards.test.tsx`, `app/src/screens/chat/thread.test.tsx`, `app/src/store/store.test.ts`, `app/src/screens/chat/commands.test.tsx`** — rewrite pins that assert the Field dropdown to the inline row path; never delete a behaviour pin without its replacement.

## Closed enumerations touched

> Sibling grep at base `86265042f043827edf99daa14e0342a6816e2abe`: `grep -rnF 'crew-thread' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor --exclude-dir=.git -I .` → 2 hits in 2 files.

- **`playbook-edit`, `playbook-off`** (new screenshot states; sibling: `crew-thread`) — must be named in:
  - `app/e2e/chat.spec.ts` — the `SHOTS` list (`state: "crew-thread",`) — extend.
  - `docs/evidence/phase-5-polish/chat/README.md` — the screenshot table (`chat-crew-thread-light.png`), pinned by "the evidence README lists every screenshot, and nothing else" — extend with one row per new state.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/chat/cards.test.tsx` — unset model reads `not set: needed before a dry run` | flip `not set: needed before a dry run` → `default` in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — unset Dedupe key reads `not set` | flip the Dedupe key row's null text `not set` → `none` in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — unset Token limit per day reads `not set` | flip the Token limit row's null text `not set` → `none` in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — unset API-key fallback reads `not set` | flip the API-key fallback row's null text `not set` → `none` in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — no Field dropdown remains in the card | render a `SelectField` labelled `Field` in the card again in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — inline Model edit posts `{field: "model", value}` | flip `"model"` → `"priority"` in the Model row's field name in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — the hint is outside the controls row | move the hint element inside the controls container in `app/src/screens/chat/cards.tsx` |
| `app/src/store/store.test.ts` — `GET /playbooks` query is `{ all: "1" }` | delete `query: { all: "1" }` from the `playbooks:` entry in `app/src/store/resources.ts` |
| `app/src/screens/chat/thread.test.tsx` — the card survives Turn off and shows the Turn on gap | delete `Turn on: not available from the kernel` in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/thread.test.tsx` — a disabled card offers neither Run now nor Turn off | render Run now and Turn off whatever `playbook.status` is in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/thread.test.tsx` — a disabled card keeps its row Edit buttons | render the row Edit buttons only when `playbook.status !== "disabled"` in `app/src/screens/chat/cards.tsx` |
| `app/e2e/chat.spec.ts` — Turn off in the fixture leaves the card with `disabled` and its trigger card | remove the status flip from the fixture's `POST /playbooks/:id/off` in `app/e2e/fixtures/chat.ts` (the card then never shows `disabled`) |
| `app/src/screens/chat/thread.test.tsx` — after a successful Set, focus is on `Edit priority` through the card's move | delete the focus-restore after a successful confirm in `app/src/screens/chat/cards.tsx` |
| `app/e2e/chat.spec.ts` — the moved card keeps focus on `Edit priority` | same mutation: delete the focus-restore after a successful confirm in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/thread.test.tsx` — the nested trigger card still renders on a disabled card | make the nested `TriggerCard` render only when `playbook.status !== "disabled"` in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/thread.test.tsx` — `approval:` source renders a kernel card | flip `startsWith("approval:")` → `startsWith("approval-")` in `app/src/screens/chat/Thread.tsx` |
| `app/src/screens/chat/thread.test.tsx` — a plain `source: "ask"` message renders as the You bubble | render every `from_agent: null` message as the kernel card (drop the `source` check) in `app/src/screens/chat/Thread.tsx` |
| `app/src/screens/chat/thread.test.tsx` — an `ask` message whose text starts `approved approval` still renders as You | replace the `source.startsWith("approval:")` check with `text.startsWith("approved approval")` in `app/src/screens/chat/Thread.tsx` |
| `app/src/screens/chat/cards.test.tsx` — a refused Set shows the kernel's text and stays in edit mode | close the editor before checking the outcome (leave edit mode unconditionally after `write`) in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/cards.test.tsx` — Escape returns focus to `Edit <row>` | delete the focus-restore call in the Escape handler in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/keyboard.test.tsx` — the new full tab order (row Edit buttons, then Run now / Turn off, then the trigger's On / Off) | move the row's Edit button after the Run now / Turn off actions in `app/src/screens/chat/cards.tsx` |
| `app/e2e/chat.spec.ts` — the e2e tab order and Tab → Enter → type → Enter path | same mutation as the keyboard row: move the row's Edit button after the actions in `app/src/screens/chat/cards.tsx` |
| `app/e2e/phase-5-exit.spec.ts` — priority set from the card lands in the store as `priority_set_by: "owner"` | flip `"priority"` → `"model"` in the Priority row's field name in `app/src/screens/chat/cards.tsx` |
| `app/src/screens/chat/commands.test.tsx` — no Run/Turn off for a disabled playbook | delete the disabled-status check in `app/src/screens/chat/commands.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Honest playbook card: not set, inline Set rows, survives Turn off, kernel decision cards | all (AC1-AC7) | 14 modify (+1 maybe: `testkit.tsx`), 4 create (PNGs written by the spec; the other chat PNGs are regenerated) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| card | `app/src/screens/chat/cards.tsx`, `app/src/screens/chat/chat.css`, `app/src/screens/chat/cards.test.tsx` | — | HIGH |
| thread | `app/src/screens/chat/Thread.tsx`, `app/src/screens/chat/thread.test.tsx`, `app/src/screens/chat/keyboard.test.tsx` | — | HIGH |
| store + palette | `app/src/store/resources.ts`, `app/src/store/store.test.ts`, `app/src/screens/chat/commands.ts`, `app/src/screens/chat/commands.test.tsx` | — | HIGH |
| e2e + evidence | `app/e2e/chat.spec.ts`, `app/e2e/phase-5-exit.spec.ts`, `app/e2e/fixtures/chat.ts`, `docs/evidence/phase-5-polish/chat/README.md`, the regenerated `docs/evidence/phase-5-polish/chat/chat-*.png` | `docs/evidence/phase-5-polish/chat/chat-playbook-edit-{light,dark}.png`, `docs/evidence/phase-5-polish/chat/chat-playbook-off-{light,dark}.png` (written by the spec) | HIGH (MEDIUM for the PNG names, which the spec's `shotName` derives) |
| maybe | `app/src/screens/chat/testkit.tsx` (only if the unit fake needs a status flip on off) | — | LOW |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/src/screens/chat/cards.tsx", name: "PlaybookCard"}
  - {kind: "symbol", path: "app/src/screens/chat/cards.tsx", name: "not set: needed before a dry run"}
  - {kind: "symbol", path: "app/src/screens/chat/cards.tsx", name: "Turn on: not available from the kernel"}
  - {kind: "symbol", path: "app/src/store/resources.ts", name: "FIXED_RESOURCES"}
  - {kind: "symbol", path: "app/src/screens/chat/Thread.tsx", name: "approval:"}
  - {kind: "symbol", path: "docs/evidence/phase-5-polish/chat/README.md", name: "chat-playbook-off-light.png"}
  - {kind: "symbol", path: "docs/evidence/phase-5-polish/chat/README.md", name: "chat-playbook-edit-light.png"}
requires: []
lanes:
  - "app/src/screens/chat/cards.tsx"
  - "app/src/screens/chat/cards.test.tsx"
  - "app/src/screens/chat/Thread.tsx"
  - "app/src/screens/chat/thread.test.tsx"
  - "app/src/screens/chat/keyboard.test.tsx"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/commands.ts"
  - "app/src/screens/chat/commands.test.tsx"
  - "app/src/screens/chat/testkit.tsx"
  - "app/src/store/resources.ts"
  - "app/src/store/store.test.ts"
  - "app/e2e/chat.spec.ts"
  - "app/e2e/phase-5-exit.spec.ts"
  - "app/e2e/fixtures/chat.ts"
  - "docs/evidence/phase-5-polish/chat/**"
external_requires:
  - "Electron + Playwright available locally for app/e2e/chat.spec.ts (run `npm run build` first)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/screens/chat/cards.tsx:224` | yes | HOLDS | `<Field label="Model" value={playbook.model ?? "default"} setBy={playbook.model_set_by} />` | tip 40 minutes ago, fetched <1h |
| `cards.tsx:168` | yes (unique suffix `app/src/screens/chat/cards.tsx`) | HOLDS | `export const SET_FIELDS = ["dedupe_key", "priority", "model", "token_limit"] as const;` | tip 40 minutes ago, fetched <1h |
| `app/src/store/resources.ts:63` | yes | HOLDS | `playbooks: { method: "GET", path: "/playbooks" },` | tip 40 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): no owner Turn on route in the kernel, so scope 3's "Turn on where the kernel allows it" yields no button | MEDIUM | Show `Turn on: not available from the kernel` as text; do not add a kernel route (out of this item); say so in the PR body |
| Layout change to an approved component (the playbook card) | MEDIUM | Tokens only in `chat.css`; light + dark screenshots of the edit and off states committed in `docs/evidence/phase-5-polish/chat/` and linked from the PR for the owner's polish gate |
| Reading `GET /playbooks?all=1` makes disabled playbooks visible to every consumer of the `playbooks` resource (`Thread.tsx`, `CrewSection.tsx`, `commands.ts`) | MEDIUM | `commands.ts` filters Run/Turn off for disabled (AC6); check `CrewSection.tsx` passes the list only to `buildChatCommands`; a disabled card shows only actions the kernel accepts |
| `app/e2e/phase-5-exit.spec.ts` drives the card's old Field/Value/Set form against a real kernel; CI's `npm run e2e` runs it, so leaving it unchanged turns CI red | HIGH | It is in this subtask's lanes; rewrite its three form lines to the row path and run the whole e2e suite (AC7), not only `chat.spec.ts` |
| Tab-order pins in `keyboard.test.tsx` and `chat.spec.ts` change with the new rows | LOW | Rewrite the order pins to the new sequence; keep them full-sequence checks |
| The e2e evidence test deletes and rewrites every PNG in the folder | LOW | Run the whole `chat.spec.ts` so every state's PNG is regenerated, and commit the README in the same change |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-24-playbook-card-every-field-honestly.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-24T16:54:44Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/134
- **Branch:** feature/playbook-card-every-field-honestly
- **Files changed:** 29
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** AC1–AC7 implemented in one worker: unset values read "not set", per-row inline Edit/Set, the card survives Turn off (GET /playbooks?all=1, Turn on gap text), approval:<id> messages render as kernel cards, and the palette filters disabled playbooks. Phase 4.5 found and fixed 6 reproduced focus/race defects across 3 iterations. The last review's HIGH (Turn off focus depends on whether the answer or the refetch arrives first) is fixed in be7c612 and pinned, but not re-reviewed. Typecheck, 1043 unit tests and the two card e2e specs pass. The full e2e suite was not re-run after the fixes. Pre-flight OVERLAP with sibling lane PRs #132 and #131 (owner chose proceed-anyway).

## Not verified
- **docs/ARCHITECTURE.md:203** — still describes the card as "Run now, Turn off and Set priority"; out of lane, not updated (subtask 1)
- **docs/evidence/phase-5-wright-app-guidance.md:33** — still cites SET_FIELDS in cards.tsx, now POLICY_FIELDS; out of lane (subtask 1)
