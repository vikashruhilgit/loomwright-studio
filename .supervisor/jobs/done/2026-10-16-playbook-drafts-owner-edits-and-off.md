# Supervisor Job: Playbook drafts — Wright creates, updates, lists and disables draft playbooks (versioned, mirrored to markdown, each with one linked trigger); the owner lists, shows, sets any policy value and turns a playbook off

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-16-150622/L1 (lane L1 clone of the primary checkout)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092902-wright-drafts-playbooks-the-owner-reads-changes-and-turns-off.md
- **Base commit:** a60340ca29d550cf1aa4e2ab127a19fdc4577d8b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript, better-sqlite3, zod, vitest (`kernel/package.json`). |
| 2 | Dependency Availability | GO | No new dependency. |
| 3 | Architecture Fit | GO | Item 01 (PR #66) built the seam: `kernel/src/playbooks/drafts.ts` exports an empty `PlaybookPart` merged by `kernel/src/playbooks/index.ts`; migration 13 created `playbooks` / `playbook_versions`. Tools follow the triggers feature's pattern (`kernel/src/triggers/tools.ts`: `defineTool`, `runStep` keyed `ctx.stepKey(idempotency_key)`). |
| 4 | Scope vs Supervisor Capability | GO | 12 files (3 create, 9 modify), one domain; single worker. |
| 5 | Hard Blockers | CAUTION | The requirement's `## Touches` misses five files the change cannot avoid (see Design decision 10): `kernel/test/playbooks-foundation.test.ts` pins the drafts part as empty, `kernel/src/triggers/index.ts` is the only sanctioned import surface (requirement Risks), `kernel/src/triggers/cli.ts` prints the trigger list the AC names, and the crash-recovery AC needs a due-work hook the `PlaybookPart` type does not have (`kernel/src/playbooks/types.ts`, `index.ts`). No item of this wave (03–06) touches any of them. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Fill in the playbooks feature's `drafts` part: Wright's `kernel_playbook_create`, `kernel_playbook_update`, `kernel_playbook_list`, `kernel_playbook_disable` tools; a playbook store that versions every change into `playbook_versions` and records who set each policy value; a read-only markdown mirror at `<dataDir>/memory/playbooks/<slug>.md` rewritten after every change and resynced from the rows after a restart; one trigger per playbook registered through the triggers module and linked to it; and the owner's `studio playbooks list | show | set | off` verbs with matching API routes. Every create, update, set and disable is an audit event. Document it in `docs/architecture/playbooks.md`.

**Problem Statement:**
The owner needs recurring work Wright drafts ("every weekday at 9, summarise what changed in repo X") written down where the owner can read it, with every policy value (dedupe key, priority, model, token limit) changeable by the owner and the playbook switchable off at any time, so that nothing about how it runs is decided for them (invariants 1, 8; D3, D4). Today item 01 left `kernel/src/playbooks/drafts.ts` empty: nothing creates, versions, lists or edits a playbook and no file exists for the owner to read.
Success looks like: Wright creates a draft v1 playbook with every policy value marked proposed; the owner sees it in `studio playbooks list`, reads its mirror file, sets a value (new version, no longer proposed) and turns it off; Wright can no longer change it after the owner's off.

## Acceptance Criteria
- [ ] AC1 — Given Wright calls `kernel_playbook_create` with a valid cron trigger and all policy values (dedupe key, priority, model, token limit), when it returns, then the playbook row is `status: draft`, `version: 1`, every given policy field has `*_set_by = 'wright'`, one `playbook_versions` row exists for version 1, a `playbook_created` audit event exists, and `<dataDir>/memory/playbooks/<slug>.md` shows each of those policy values followed by `(proposed)`.
- [ ] AC2 — Given Wright creates a playbook, when it returns, then exactly one `triggers` row has `playbook` equal to the playbook's slug, it is owned by the creating agent, and `studio triggers` (the default, enabled-only list, through `formatTriggers`) prints it with `playbook <slug>` on its block.
- [ ] AC3 — Given a draft, when the owner runs `studio playbooks set <id> priority high` (route `POST /playbooks/:id/set`), then `priority = 'high'`, `priority_set_by = 'owner'`, `version` is 2, `playbook_versions` holds rows for versions 1 and 2 (each snapshot the full row at that version), a `playbook_updated` audit event with `by: "owner"` exists, and the mirror shows priority `high` without `(proposed)` while the untouched Wright fields still read `(proposed)`.
- [ ] AC4 — Given a playbook whose status is `enabled` (written directly in the test: enabling is item 07), when Wright (`kernel_playbook_update`) or the owner (`set`) changes any value, then it reads `status: draft` at the incremented version, with a snapshot for the new version.
- [ ] AC5 — Given a dedupe key naming a field outside `DEDUPE_KEY_FIELDS`, a cron spec the triggers module refuses, a priority `urgent`, or an empty intent, when Wright calls `kernel_playbook_create`, then the tool result is an error (`isError`, never a throw through the SDK) whose text names the field (`dedupe_key`, `trigger`, `priority`, `intent`), and nothing is stored: no `playbooks`, `playbook_versions` or `triggers` row, no event, no mirror file.
- [ ] AC6 — Given the owner turned a playbook off (`studio playbooks off <id>`, route `POST /playbooks/:id/off`), when Wright calls `kernel_playbook_update` or `kernel_playbook_disable` on it, then the result is an error saying the owner turned it off and nothing changes (no version, no event); the exported guard `refuseIfOwnerTurnedOff(store, id)` throws the same error and is what item 07's `kernel_playbook_enable` must call (pinned directly by a test, since the enable tool does not exist yet).
- [ ] AC7 — Given a playbook whose mirror file is missing or stale (simulating a crash after the row commit and before the mirror write), when a NEW `Store` is opened on the same data dir and the playbooks due work runs once, then the mirror is rewritten byte-identical to what `renderPlaybookMirror` produces from the row; a mirror already equal is not rewritten (its mtime is unchanged).
- [ ] AC8 — Given a linked trigger whose playbook is not `enabled`, when its instant comes due and `fireDueTriggers` runs, then no notification row and no `message` queue row is created, the instant is never fired later (it is recorded once as a `trigger_missed` event with `reason: "playbook_not_enabled"`), a cron trigger moves to its next future instant and a once trigger is spent; a trigger with `playbook = NULL` fires exactly as before (every existing `kernel/test/triggers.test.ts` test passes unchanged, except the audit-kind set test around line 520 — `TRIGGER_AUDIT_KINDS.filter((k) => k !== "trigger_missed")` — which is extended to call `updateTriggerSpec` so it still covers every kind).
- [ ] AC9 — Given a draft whose trigger spec Wright changes through `kernel_playbook_update`, when it returns, then the SAME linked trigger row (same id) carries the new spec and next fire, a new playbook version exists, and no second linked trigger exists; an invalid new spec is an error naming `trigger` with nothing changed.
- [ ] AC10 — The owner's verbs work through `runCli`: `studio playbooks list [--all] [--json]` (default hides `disabled`), `show <id|slug>` (the playbook, its versions and its linked trigger id), `set <id> <field> <value>` for `dedupe_key` / `priority` / `model` / `token_limit` (an unknown field, or a value the field refuses, is one stderr line naming it and exit 2, nothing stored), `off <id>`; `studio playbooks` help lists the four verbs on one line (≤ 200 characters). Each verb calls only its route.
- [ ] AC11 — Tests live in `kernel/test/playbooks-drafts.test.ts` (new) plus the trigger cases in `kernel/test/triggers.test.ts`; `kernel/test/playbooks-foundation.test.ts` pins the drafts part's new tools, routes, verbs and due work; `docs/architecture/playbooks.md` describes the tools, the verbs and routes, versions, who-set-it, the owner's off, the linked trigger and the mirror (format, resync, "edits are not read"); `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.

## Design decisions the workers must follow (from the source requirement + analysis)

1. **Store module — `kernel/src/playbooks/store.ts` (create).** All SQL over `playbooks` / `playbook_versions` lives here; tools and routes only call it. Exports at least: `PlaybookError` (class with a closed `code`: `invalid_input` / `not_found` / `not_owner` / `owner_off`, message naming the field or the problem), `createPlaybook`, `updatePlaybook`, `setPlaybookPolicy` (owner), `disablePlaybook`, `listPlaybooks`, `getPlaybook` (by id or slug), `listPlaybookVersions`, `refuseIfOwnerTurnedOff`, `PLAYBOOK_AUDIT_KINDS = ["playbook_created", "playbook_updated", "playbook_disabled"]`. Every change runs in ONE `store.transaction` that writes the row, the `playbook_versions` snapshot (when a version is made), the linked trigger (through the triggers module, Design decision 6) and exactly one audit event via `appendEvent` (`kernel/src/loop/internal.ts`, actor `kernel`), so all of it commits or rolls back together — the triggers feature's rule (`kernel/src/triggers/store.ts` header: "Every change appends exactly one audit event of its own `trigger_*` kind in the same transaction as the change").
   - **Validation before any write**, each refusal a `PlaybookError("invalid_input")` whose message starts with the field name: `name` (1–200 chars, no NUL), `intent` (non-empty after trim, ≤ 2 000 chars, no NUL), `trigger` (validated ONLY by the triggers module's own exported validation — the register/update call, never re-implemented; its `TriggerError` message is wrapped as `trigger: <message>`), `dedupe_key` (a non-empty list of distinct `DEDUPE_KEY_FIELDS` values, stored as a JSON array text in `dedupe_key_spec`; an unknown entry names it), `priority` (one of `PLAYBOOK_PRIORITIES`), `model` (1–200 chars, no whitespace or NUL), `token_limit` (a positive safe integer, stored in `token_limit_per_day`). Read the value sets from `./types.js`, never re-type them.
   - **Slug.** Derived once at create from `name`: lowercase, runs of non-`[a-z0-9]` become `-`, trimmed of `-`, cut to 48 chars, `playbook` when empty; a collision appends `-2`, `-3`, …. It must match `^[a-z0-9][a-z0-9-]{0,63}$` (it is a path segment of the mirror — no traversal possible). The slug never changes afterwards (a name change keeps it).
   - **Who set it.** A value Wright supplies records `*_set_by = 'wright'`; one the owner sets records `'owner'`; an omitted field stays null with a null `*_set_by` (`priority` keeps its column default `normal` with `priority_set_by` null). `effort` and `api_key_fallback_json` are not settable by this item (item 06 owns the fallback).
   - **Wright cannot overwrite the owner's choice.** `updatePlaybook` by Wright refuses (`invalid_input`, message names the field and says the owner set it) a policy field whose `*_set_by` is `owner` — invariant 1: Wright only proposes; the owner's value is changed only by the owner.
   - **Versions.** Create writes version 1 and its snapshot. Every update or owner set that changes something increments `version`, writes one snapshot (`snapshot_json` = the full row after the change, every column), bumps `updated_at`, and sets `status` to `draft` when it was `enabled` (a `disabled` playbook stays `disabled`). A change that changes nothing (same values) writes nothing and returns `changed: false`. Disabling writes no version.
   - **The owner's off.** `disablePlaybook(store, {id, by: "owner"|"wright"})` sets `status = 'disabled'` and appends `playbook_disabled` with `by`. There is no `disabled_by` column: who turned it off is read from the append-only log — the newest `playbook_disabled` event for the playbook — as the triggers feature reads its toggles (`lastToggleTurnedOn` in `kernel/src/triggers/store.ts`). `refuseIfOwnerTurnedOff(store, id)` throws `PlaybookError("owner_off", "playbook <id> was turned off by the owner; an agent cannot change, disable or re-enable it")` when status is `disabled` and that newest event's `by` is `owner`. Wright's update and disable call it; the owner's own `set` on a disabled playbook is allowed (a new version, still disabled). Disabling an already-disabled playbook is `changed: false`, no event.
   - **Ownership.** Wright's tools act only on playbooks whose `owning_agent` is the calling session's agent (`not_owner` otherwise); the owner's routes act on every playbook.
2. **Wright's tools — `kernel/src/playbooks/drafts.ts`.** Four tools in this order: `kernel_playbook_create(name, intent, trigger, dedupe_key?, priority?, model?, token_limit?, idempotency_key)`, `kernel_playbook_update(id, changes, idempotency_key)` (`changes` has optional `name`, `intent`, `trigger`, `dedupe_key`, `priority`, `model`, `token_limit`; empty `changes` is an `invalid_input` error), `kernel_playbook_list()` (the caller's own playbooks, every status, id order, each with its linked trigger id and `next_fire_at`), `kernel_playbook_disable(id, idempotency_key)`. `trigger` is `{kind: "once", spec}` or `{kind: "cron", spec, tz}` with the zod constraints of `kernel_trigger_register` (`z.enum(TRIGGER_KINDS)`, `spec` ≤ `MAX_CRON_LENGTH`, `tz` ≤ 64). `dedupe_key` is a zod array of strings (the field check is the store's, so the error names the field). Follow `kernel/src/triggers/tools.ts` exactly: the owning agent is `ctx.sessions.getSession(ctx.sessionId)?.agent` (refused when absent); create/update/disable run as `runStep(ctx.store, ctx.stepKey(a.idempotency_key), …, { now: ctx.now })` so a repeat returns the first result; a repeated update/disable after the owner's off re-checks `refuseIfOwnerTurnedOff` and fails (the triggers' `refuseIfOwnerOff` precedent); every refusal is a throw prefixed with the tool name (the `named` helper), which the tool server turns into an `isError` result. Descriptions tell Wright: the playbook is a draft the owner reviews; every policy value it gives is a proposal the owner can change; it cannot change a value the owner set or a playbook the owner turned off; enabling is a separate step (item 07). Return values carry `{id, slug, status, version, trigger_id, next_fire_at, mirror}` (`mirror` = the file path relative to the data dir, `memory/playbooks/<slug>.md`). The mirror is written AFTER `runStep` returns (outside the transaction; a replay rewrites it too, idempotently).
3. **The markdown mirror — `kernel/src/playbooks/mirror.ts` (create).** `mirrorPath(dataDir, slug)` = `<dataDir>/memory/playbooks/<slug>.md` (refuse a slug failing the slug pattern); `renderPlaybookMirror(row, trigger, timeZone)` is a pure function; `writePlaybookMirror(dataDir, row, trigger, timeZone)` writes atomically with `writeFileAtomic` from `kernel/src/tools/handoff.ts` (temp file + rename; that module imports only `node:` builtins, so the studio CLI graph stays SDK-free) and skips the write when the file already holds identical bytes. Content, in order: an H1 with the name; a line stating the file is generated by the Studio kernel from its `playbooks` table and that edits here are not read; status; version; the intent; the trigger (`cron "<expr>" in <tz>`, or `once at <instant>`, and its next fire in the owner's local time — the kernel host's zone, `Intl.DateTimeFormat().resolvedOptions().timeZone`, formatted with the triggers module's exported `formatZoned`); one line per policy field (dedupe key, priority, model, token limit, effort, API-key fallback) with its value or `not set`, followed by ` (proposed)` when `*_set_by` is `wright`; then a `Last dry run` line: the placeholder `No dry run yet.` (item 07 fills it). **Inert rendering:** name, intent, model and every other stored string is data (invariant 3): a one-line value is a CommonMark code span whose backtick fence is one longer than its longest backtick run (the `codeSpan` rule in `kernel/src/loomwright/version-note.ts` — copy the small helper; do not import that module, it pulls notifications), and the multi-line intent is a fenced code block whose fence is longer than any backtick run inside it. The mirror is written for every status, `disabled` included.
4. **Crash resync.** `PlaybookPart` (`kernel/src/playbooks/types.ts`) gains an optional `readonly dueWork?: readonly DueWorkFn[]`; `mergePlaybookParts` (`kernel/src/playbooks/index.ts`) concatenates the parts' due work in part order and `playbooksContributionOf` adds `dueWork` only when non-empty (keeping the "only non-empty keys" rule). The drafts part contributes one due-work function that, ONCE per `Store` instance (a module-level `WeakSet<Store>`), rewrites every playbook's mirror whose bytes differ from `renderPlaybookMirror` of its row (the row is the truth). It appends no event, takes no lock beyond the store's, and a failure on one playbook does not stop the others (collect, then throw one message so the loop records one `due_work_failed`, as `fireDueTriggers` does).
5. **The owner's routes (in `drafts.ts`, the part's `routes`).** `GET /playbooks[?all=1]` → `200 {playbooks: [...]}` (all=1 adds `disabled`); `GET /playbooks/:ref` (decimal id or slug) → `200 {playbook, versions: [{version, created_at}], trigger}` or `404 {error: "not_found"}`; `POST /playbooks/:id/set` body `{field, value}` (`field` ∈ `dedupe_key` / `priority` / `model` / `token_limit`; `value` a string as typed on the CLI, or `none` to clear a nullable field, recorded `set_by: owner`; dedupe key given as comma-separated fields) → `200 {playbook, changed}`, `400 {error: "invalid_input", message}` naming the field; `POST /playbooks/:id/off` → `200 {playbook, changed}`. `400 invalid_id` / `invalid_body` and `404 not_found` follow `kernel/src/triggers/routes.ts`. Each owner change writes the mirror after its transaction, like the tools.
6. **The linked trigger — `kernel/src/triggers/store.ts` (+ exports in `kernel/src/triggers/index.ts`).**
   - `RegisterParams` gains optional `readonly playbook?: string` (the playbook's slug, stored in the existing TEXT column `triggers.playbook`, migration 11); `registerTrigger` writes it (null when absent — every existing caller unchanged) and includes it in the `trigger_registered` payload only when given. The playbook's trigger is registered with `action: "wake_agent"` and `text: "Playbook <slug>"`; what a fire does is item 08's.
   - New exported `updateTriggerSpec(store, {id, agent, kind, spec, tz?, sessionId?}, now)`: validates with the same private `checkSpec`, refuses `not_found` / `not_owner` / `owner_off` (an owner's off on the trigger stays final for agents), rewrites `kind`, `spec_json` and `next_fire_at` in place (same id), appends ONE `trigger_updated` event (add it to `TRIGGER_AUDIT_KINDS`), all in one transaction. Playbook create/update call these inside the playbook's transaction (savepoints), so a refused trigger rolls the whole change back.
   - **A linked trigger of a playbook that is not `enabled` never starts work.** In `fireDueTriggers`, for a due row whose `playbook` is not null, read `SELECT status FROM playbooks WHERE slug = ?` with raw SQL (the triggers module must not import the playbooks module — the dependency points the other way); when the status is not `enabled` (or the row is missing), the instant is handled inside the SAME per-instant `runStep` (key `trigger:<id>:<instant>`) as a miss: no notification, no queue row, one `trigger_missed` event with `reason: "playbook_not_enabled"` and the playbook slug, then the next fire is scheduled exactly as after a fire (cron: next future instant; once: spent, `next_fire_at` null). `last_result` keeps its closed set (`TRIGGER_RESULTS` is NOT extended; leave `last_result` unchanged on this path); the returned `TriggerFireOutcome` for this path carries `result: "skipped"` (the existing union member — no new literal) — item 08 decides what a fire of an enabled playbook does.
   - `kernel/src/triggers/cli.ts`: `TriggerLike` gains `playbook`, and `formatTriggers` appends `; playbook <slug>` (through `bare`, so the slug prints plainly and anything odd is quoted) to the first line of a block whose `playbook` is not null; blocks of unlinked triggers are byte-unchanged.
7. **The owner's verbs (in `drafts.ts`, the part's `verbs`).** `list [--all] [--json]`, `show <id|slug> [--json]`, `set <id> <field> <value>`, `off <id>`; help lines short enough that the merged `studio playbooks` help stays one line ≤ 200 characters (the `mergeContributions` subcommand-help rule) — pin `PLAYBOOKS_HELP`'s literal in the test. Plain output shows times in the owner's local zone (`formatZoned`); every stored string printed through a quoting helper like `formatTriggers`' `quoted`/`bare`, so terminal escapes in Wright's text cannot reach the owner's terminal. A usage error (missing/unknown argument) is one stderr line and exit 2 before any API call; an API refusal prints its `error`/`message` on stderr and exits 1. The verbs import only the CLI-safe graph (no Agent SDK, session manager or `kernel.ts`; the existing `feature-seams.test.ts` module-graph child-process pin covers it).
8. **Audit events.** `playbook_created` (`{playbook_id, slug, owning_agent, version: 1, by: "wright", trigger_id}`), `playbook_updated` (`{playbook_id, version, by, fields: [...]}`), `playbook_disabled` (`{playbook_id, by}`), each in its change's transaction, `session_id` = the calling session for a tool, null for the owner. Payloads carry field NAMES, not Wright's free text (keep events small; the snapshot holds the values).
9. **Docs — `docs/architecture/playbooks.md`.** Replace the stub with: what a playbook is here (draft → enabled by items 07/08), the four tools and what each refuses, the owner's four verbs and the four routes, versions and snapshots, who-set-it and "(proposed)", the owner's off and Wright's limits, the linked trigger (one per playbook, linked by slug, never starts work unless the playbook is `enabled`), the mirror (path, content, inert text, rewritten after every change, resynced from the rows after a restart, edits not read) under a `## Markdown mirror` heading. Keep links relative and existing (`scripts/check-docs.sh` rule 1). Do not edit `docs/architecture/triggers.md` (item 08 owns it) or `docs/ARCHITECTURE.md`.
10. **Touches expansion (declared, analysis-derived).** Beyond the requirement's `## Touches`, the change must edit: `kernel/test/playbooks-foundation.test.ts` (it pins the drafts part empty and the contribution keys `["name", "subcommands"]`; update those pins to the new values and keep every other assertion), `kernel/src/playbooks/types.ts` and `kernel/src/playbooks/index.ts` (Design decision 4), `kernel/src/triggers/index.ts` (export `updateTriggerSpec`, and re-export `MAX_CRON_LENGTH` from `./cron.js` for the tool's zod bound — the requirement's Risks say import the triggers module's public index only), `kernel/src/triggers/cli.ts` (AC2's "listed by studio triggers with the playbook named"). The PR body should note these five as outside the requirement's Touches, with the reason (advisory — not a review criterion). Nothing else outside the lanes is edited; a failing test outside the lanes is reported, not fixed.

## Touched-file invariants

> Grounded at base `a60340ca29d550cf1aa4e2ab127a19fdc4577d8b`. The worker re-checks each entry for the files in its lanes before hand-back.

- **`kernel/src/playbooks/drafts.ts`** — rewrite the header comment (`empty until phase 3 item 02 fills it` / `Only this file changes when it does`) to describe the filled part; keep the export name `draftsPart`, `name: "drafts"` and `Object.freeze`.
- **`kernel/src/playbooks/index.ts`** — keep: `it imports only types and zod and the feature` (… seam: never the Agent SDK, the session manager or `kernel.ts`); the verb/handler conflict rules in `mergePlaybookParts` (`ContributionConflictError("subcommand", …)` / `("handler", …)`); `the verb "${PLAYBOOKS_HELP_VERB}" is the built-in help`; the only-non-empty-keys rule in `playbooksContributionOf` (its comment `Never \`dueWork\`: a part has none.` must be rewritten, since parts may now have due work).
- **`kernel/src/playbooks/types.ts`** — keep: `Migration 13 stores these values as TEXT with no SQL CHECK, so` (the lists are the only closure) and `Types only, plus the lists: the \`studio\` CLI loads this module`; the five closed lists unchanged (pinned by `kernel/test/playbooks-foundation.test.ts`: `expect(DEDUPE_KEY_FIELDS).toEqual(["playbook.id", "playbook.version", "trigger.id", "trigger.scheduled_at", "date"]);`).
- **`kernel/src/triggers/store.ts`** — keep: `Every change appends exactly one audit event of its own \`trigger_*\` kind in` (the same transaction); `The owner's off is final for agents`; `Trigger ids are never reused` (`nextTriggerId`); `fireDueTriggers`' rule `One trigger's failure never stops the others`; the per-instant step key `trigger:<id>:<scheduled instant>` (`fireStepKey`); `Nothing fires while the kill switch is engaged` (the kill-switch check stays first). `TRIGGER_RESULTS = ["fired", "missed_kill_switch"]` is not extended.
- **`kernel/src/triggers/tools.ts`** (read-only pattern) — reuse: `runStep(` with `ctx.stepKey(a.idempotency_key)`, `refuseIfOwnerOff(ctx.store, registered.id);` after a replay, the `named(` prefix helper, `owningAgent(ctx)`.
- **`kernel/src/triggers/index.ts`** — keep: the header's import rule (`nothing reachable from here may import the` Agent SDK …); add `updateTriggerSpec` to the existing `export { … } from "./store.js"` list and `MAX_CRON_LENGTH` to the existing `export { … } from "./cron.js"` list; nothing else.
- **`kernel/src/triggers/cli.ts`** — keep: `TRIGGERS_HELP` literal (pinned in `kernel/test/triggers.test.ts`); `formatTriggers` output for an unlinked trigger byte-identical (pinned: `toContain("last toggled by owner at 2026-10-14 10:02 +00:00")` and the other format tests).
- **`kernel/src/tools/handoff.ts`** (read-only) — reuse `writeFileAtomic` (`Write \`content\` to \`path\` atomically`); its imports are `node:` builtins only.
- **`kernel/src/features/contribution.ts`** (read-only) — `const TOOL_NAME = /^kernel_[a-z0-9_]{1,64}$/;`, the help rule (one line, ≤ 200 characters), route rules (`compileRoutePath`); `ContributedToolContext` gives `store`, `sessions.getSession`, `sessionId`, `now`, `stepKey` — no data dir: use `ctx.store.dataDir` / `req.store.dataDir` (`readonly dataDir: string;` on `Store`, `kernel/src/store/store.ts`).
- **`kernel/test/playbooks-foundation.test.ts`** — pinned today: `expect(Object.keys(playbooksContribution)).toEqual(["name", "subcommands"]);`, `expect(merged.tools).toEqual([]);`, `expect(merged.routes).toEqual([]);`, `expect(merged.dueWork).toEqual([]);`, `expect(mergePlaybookParts(PLAYBOOK_PARTS).verbs).toEqual([]);`, and the per-part empty check `toEqual({ tools: [], routes: [], verbs: [], handlers: {} })` — the drafts part's values change; the dry-run/enable/runs parts must still pin empty.
- **`kernel/test/triggers.test.ts`** — pinned: `expect(TRIGGER_TOOL_NAMES).toEqual(["kernel_trigger_register", "kernel_trigger_remove", "kernel_trigger_list"]);` (unchanged), the event-kind sequences `expect(kinds()).toEqual(["trigger_registered", …])` (unchanged for unlinked triggers), and the closed-set consumer `toEqual(new Set(TRIGGER_AUDIT_KINDS.filter((k) => k !== "trigger_missed")))` around line 520 — extend that test with an `updateTriggerSpec` call (not a filter exemption), so the set still proves every kind is emitted.

## Closed enumerations touched

> Sibling grep at base `a60340c`: `grep -rnF 'trigger_registered' kernel/src kernel/test docs` → `kernel/src/triggers/store.ts` (`TRIGGER_AUDIT_KINDS`), `kernel/test/triggers.test.ts` (sequence pins, unaffected for unlinked triggers), `kernel/test/phase-2-exit-live.test.ts` (live test, reads only `trigger_registered`). `grep -rnF 'missed_kill_switch' kernel/src kernel/test docs` → `kernel/src/triggers/store.ts`, `kernel/test/triggers.test.ts`, `docs/ARCHITECTURE.md`, `docs/architecture/triggers.md` (not extended — Design decision 6).

- **audit kind `trigger_updated`** (sibling: `trigger_toggled`; extra grep `grep -rnF 'TRIGGER_AUDIT_KINDS' kernel` → `kernel/src/triggers/store.ts`, `kernel/src/triggers/index.ts`, `kernel/test/triggers.test.ts` ~line 520 — a closed-set consumer, extended as its Touched-file entry says) — must be named in `TRIGGER_AUDIT_KINDS` in `kernel/src/triggers/store.ts`; documented in `docs/architecture/playbooks.md` (not `triggers.md`, which item 08 owns).
- **`trigger_missed` reason `playbook_not_enabled`** (siblings: `kill_switch`, `already_done`) — the reasons are free payload values, not a closed list; documented in `docs/architecture/playbooks.md`.
- **audit kinds `playbook_created` / `playbook_updated` / `playbook_disabled`** (new list `PLAYBOOK_AUDIT_KINDS`, sibling `TRIGGER_AUDIT_KINDS`) — defined in `kernel/src/playbooks/store.ts`, pinned in `kernel/test/playbooks-drafts.test.ts`.
- **tools `kernel_playbook_create` / `_update` / `_list` / `_disable`** (sibling: `kernel_trigger_register`) — already reserved in `PROPOSED_ALLOWED_TOOLS` (`kernel/src/brain/settings.ts`) and listed in `docs/ARCHITECTURE.md` by item 01; this item adds them to `draftsPart.tools` and pins them in `kernel/test/playbooks-foundation.test.ts` (no edit to settings or ARCHITECTURE.md).
- **routes `GET /playbooks`, `GET /playbooks/:ref`, `POST /playbooks/:id/set`, `POST /playbooks/:id/off`** — pinned in `kernel/test/playbooks-foundation.test.ts` as `"<METHOD> <path>"`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `playbooks-drafts.test.ts` — create stores draft v1, every given field `set_by: wright`, mirror shows `(proposed)` | in `createPlaybook`, write `'owner'` instead of `'wright'` for `priority_set_by` |
| `playbooks-drafts.test.ts` — exactly one linked trigger, named in `studio triggers` | drop `playbook` from the `INSERT INTO triggers` column list in `registerTrigger` |
| `playbooks-drafts.test.ts` — owner `set priority high`: owner-set, v2, two snapshots, mirror not proposed | remove the `playbook_versions` INSERT from `setPlaybookPolicy` |
| `playbooks-drafts.test.ts` — an enabled playbook returns to draft on change | delete the `status = 'draft'` assignment for an `enabled` row in the shared update path |
| `playbooks-drafts.test.ts` — unknown dedupe field / bad cron / `urgent` / empty intent: error naming the field, nothing stored | skip the dedupe-field check against `DEDUPE_KEY_FIELDS` in the store's validation |
| `playbooks-drafts.test.ts` — after the owner's off, Wright's update/disable is an `owner_off` error | make `refuseIfOwnerTurnedOff` return without throwing |
| `playbooks-drafts.test.ts` — a new Store's due work rewrites a stale mirror from the row | remove the drafts part's due-work entry from `draftsPart` |
| `playbooks-drafts.test.ts` — Wright cannot overwrite an owner-set field | delete the `*_set_by === 'owner'` refusal in `updatePlaybook` |
| `triggers.test.ts` — a linked trigger of a non-enabled playbook creates no notification/queue row and records `playbook_not_enabled` | delete the playbook-status check in `fireDueTriggers` |
| `triggers.test.ts` — `updateTriggerSpec` keeps the id and rewrites spec + next fire | change `updateTriggerSpec` to INSERT a new row instead of UPDATE |
| `playbooks-foundation.test.ts` — drafts part tools / routes / verbs / due work, other parts empty | delete `list` from the drafts part's `tools` array |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Playbook drafts: store, Wright's tools, owner's verbs + routes, markdown mirror + resync, linked trigger, docs | AC1–AC11 | 9 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/playbooks/store.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "createPlaybook"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "refuseIfOwnerTurnedOff"}
  - {kind: "symbol", path: "kernel/src/playbooks/store.ts", name: "PLAYBOOK_AUDIT_KINDS"}
  - {kind: "file", path: "kernel/src/playbooks/mirror.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/mirror.ts", name: "renderPlaybookMirror"}
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "kernel_playbook_create"}
  - {kind: "symbol", path: "kernel/src/triggers/store.ts", name: "updateTriggerSpec"}
  - {kind: "file", path: "kernel/test/playbooks-drafts.test.ts"}
  - {kind: "symbol", path: "docs/architecture/playbooks.md", name: "## Markdown mirror"}
requires: []
lanes:
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/src/playbooks/store.ts"
  - "kernel/src/playbooks/mirror.ts"
  - "kernel/src/playbooks/types.ts"
  - "kernel/src/playbooks/index.ts"
  - "kernel/src/triggers/store.ts"
  - "kernel/src/triggers/index.ts"
  - "kernel/src/triggers/cli.ts"
  - "kernel/test/triggers.test.ts"
  - "kernel/test/playbooks-drafts.test.ts"
  - "kernel/test/playbooks-foundation.test.ts"
  - "docs/architecture/playbooks.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): five files outside the requirement's `## Touches` must change | MEDIUM | Design decision 10 names them and why; no other item of this wave (03–06) touches them (checked against their `## Touches`); the PR body lists them. |
| Reusing the triggers validators across features (source requirement Risks) | MEDIUM | Validation goes only through the triggers module's exported functions via `kernel/src/triggers/index.ts`; the trigger write and the playbook write share one transaction so a refused spec stores nothing (AC5, AC9). |
| `fireDueTriggers` change regresses unlinked triggers | HIGH | The new branch runs only for `playbook IS NOT NULL`; every existing `triggers.test.ts` test must pass unchanged except the audit-kind set test, which is extended for `trigger_updated` (AC8); the miss reuses the per-instant step key so it can never fire later. |
| Mirror text injection (Wright's intent rendered as live markdown) | MEDIUM | Design decision 3's inert rendering (code spans / fences longer than any backtick run); a test with a backtick-laden, heading-laden intent asserts it renders inside the fence. |
| Crash between row commit and mirror write leaves the owner reading stale text | MEDIUM | Design decision 4 resync on the first tick of each new Store (AC7). |
| Wright overriding the owner's policy choice | MEDIUM | Design decision 1: Wright's update refuses an owner-set field (invariant 1). |
| The studio CLI module graph pulls the Agent SDK through a new import | MEDIUM | Imports limited to `node:` builtins, zod, `../features/contribution.js`, `../loop/*`, the triggers index and `../tools/handoff.js`; the existing module-graph child-process pin in `feature-seams.test.ts` runs in the full suite. |
| Item 08 later edits `kernel/src/triggers/store.ts` (fire semantics) | LOW | This item adds only the not-enabled skip and `updateTriggerSpec`, documented in `docs/architecture/playbooks.md`; item 08 runs in a later wave on the merged base. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-16-playbook-drafts-owner-edits-and-off.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-16T10:56:33Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/71
- **Branch:** feature/phase-3-playbook-drafts
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Playbook drafts (store with versions + who-set-it + final owner's off, four Wright tools, four owner routes/verbs, inert markdown mirror with once-per-Store resync, playbook-linked triggers with not-enabled miss and in-place updateTriggerSpec) + docs. Phase 4.5: iteration 1 FAIL (2 HIGH: spent-once re-arm, all-digit slug) fixed in 7f2a7fd; iteration 2 PASS carrying 1 MEDIUM (untested instantTaken refusal) fixed in 5a5fe46 (tests only); iteration 3 PASS, 0 issues. 1219 passed / 7 skipped, check-docs OK. 1 LOW dismissed below the fix floor (triggers.md list drift, item 08). Risk classification high (size, token/auth content) — advisory. Detached drain suppressed by /automate (owned drain follows).

## Not verified
- **studio playbooks list/show/set/off via the installed studio binary against a running daemon** — exercised only through runCli against a test loopback API server (subtask 1)
- **docs/architecture/triggers.md and docs/ARCHITECTURE.md restated lists** — outside lanes, left stale per the brief (subtask 1)
