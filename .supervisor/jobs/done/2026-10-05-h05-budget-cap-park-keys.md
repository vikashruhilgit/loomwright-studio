# Supervisor Job: H05 — cap parks key on the provider id, one park and one notify per cap hit, no stale cap wake-ups

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariant 3 applies: budget ceilings and cap detection are part of the fixed safety kernel; invariant 1: the kernel ships mechanism, so a `cap_*` wake-up is documented as "ask admission again", never given a built-in meaning; invariant 2: durable state lives on disk, so the re-key is a store migration)
- **Git:** clean except the automate engine's run file (`.supervisor/automate/automate-2026-10-03-180512.md`, modified) and two untracked owner files (`.supervisor/requirements/h01-launchd-start-failure-and-reinstall-plan.md`, `.supervisor/requirements/phase-1-hardening/_BACKLOG.md`). Never stage any of them in this job; commit with explicit paths only. Branch: main @ 54f188c
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest, `node-version: 22`; `.github/workflows/ci.yml` runs `bash scripts/check-docs.sh`, then in `kernel/` `npm ci`, `npm run typecheck`, `npm test`, `npm run build` — tests run BEFORE the build, so no test may depend on `kernel/dist`)
- **Blockers:** 0 | **Warnings:** 1 (dirty automate run file — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1-hardening/05-budget-cap-park-keys.md
- **Base commit:** 54f188c664f9e3bdcccea25f174edcdd63875005

## Feasibility
- **Verdict:** GO
- Tech stack — GO: strict TypeScript kernel (NodeNext, vitest), better-sqlite3; no new package.
- Dependencies — GO: none new.
- Architecture fit — GO: every change stays inside existing seams — `CapTracker`/`BudgetAdmission`/`internal.ts` helpers, the `AdmissionRequest` the manager builds, `readStatus`/`formatStatus`, and a function migration (`Migration.up` accepts `(db) => void`, `kernel/src/store/migrations/types.ts:12`). `wakeups.status` and `cap_state` have no CHECK constraint (`001_initial.ts:113-133`), so a new `superseded` wake-up status needs no schema change. `events` is append-only (migration 8 trigger + integrity check) and is never rewritten.
- Scope — GO: one worker; ~10 source/doc files modified, 1 created (migration 009), ~6 test files modified.
- Hard blockers — none. Migration number: H03 took no new number (the last shipped migration is `008_events_explicit_id_guard`), so this job adds **009**.

## Task
**Goal:** Cap parks and admission key on the auth provider's stable `id`, never its live account label, so relabelling the account (the first `recordTokenCreated` call, a future setup or rotation flow) can neither lift a park nor create a second park and a second notify; a migration moves existing label-keyed cap state and pending cap wake-ups to the provider id while the label stays display text (`/status`, CLI, event payloads). A text-detected park followed by a `rejected` event for the same hit leaves ONE park row (the event's known reset replaces the text fallback's guessed re-check time — owner decision 2026-10-05) and one notify unless the window really extends. Scheduling a new `cap_*` wake-up for an account and limit type supersedes the earlier pending one, so at most one pending `cap_*` wake-up exists per account and type. The doc comments on `fireDueWakeups` and `EventHandler` say a `cap_*` wake-up means "ask admission again", never "the park ended".

**Problem Statement:** The owner needs a capped account to stay parked until its window ends and to be told once per cap hit (invariant 3: budget ceilings and cap detection are safety kernel). Today a relabel flips `{admitted:false, cap_parked}` to `{admitted:true}` and the next rejection notifies again (F06-1); a text hit then a `rejected` event for the same hit leaves two park rows, two notifies and two wake-ups (F06-2); an extended park leaves its superseded wake-up pending, and nothing documents what a `cap_*` wake-up means (F06-3).

## Acceptance Criteria
- [ ] AC1 — Given a park in force, when the provider's account label changes (through `recordTokenCreated` or by any other means), then admission still refuses until the park's window ends. `CapTracker` and `BudgetAdmission` key every `cap_state` read/write, `activeParks` call and `cap_*` wake-up reason on `authProvider.id` (`kernel/src/budget/cap.ts:188`, `admission.ts:66`, `internal.ts:110`); the live `account` label is read only for display (event/notify payloads keep an `account` field holding the live label and gain a `provider` field holding the id where they lack one). `AdmissionRequest` (`kernel/src/sessions/types.ts:155-160`) gains `provider: string`; the session manager fills it with `this.#auth.id` at all three admission call sites (`kernel/src/sessions/manager.ts:453`, `:656`, `:1239`); admission fails closed (throws, as today) when `request.provider !== authProvider.id`, and no longer compares labels. A new migration `009` (a function migration in `kernel/src/store/migrations/009_cap_keys_provider_id.ts`, appended to `migrations` in `index.ts`) moves every `cap_state` row whose `account` equals an `auth_providers.account` label that differs from that row's `id` to the provider id, and rewrites pending `wakeups` reasons `cap_reset:<label>` / `cap_recheck:<label>` to `cap_reset:<id>` / `cap_recheck:<id>` (status `pending` only; fired rows are history and stay). On a primary-key conflict (a row already exists under the id for that `rate_limit_type`) the merge keeps the more conservative row: a `rejected` row beats a non-`rejected` one; between two `rejected` rows the later `resets_at` wins, `NULL` counting as latest; the losing row is deleted. A label that maps to more than one provider id is copied to each (fail closed). A label that equals ANY `auth_providers.id` is skipped entirely (its rows already belong to that provider; moving them would lift that provider's park — fail open), and the skip is named in the migration's header comment. Rows keyed on a value that is no provider's label (today: the provider id itself, the label's fallback in `subscription-token.ts:75` / `api-key.ts:34`) are untouched. `events` rows are never modified (append-only) and `sessions.auth_account` stays the display label it was frozen as. `/status` (`kernel/src/api/server.ts:191-205`, `:250`) keeps `cap_state[].account` as readable display text — the live label of the provider whose `id` equals the stored key (via `safeAccount`), else the stored key — and gains an additive `provider` field holding the key; `formatStatus` (`kernel/src/cli/index.ts:301-305`) keeps printing `cap <account>: …`. Tests: (a) park, then relabel the provider object's `account` (a mutable `BudgetAuth`), then `check` ⇒ still `{admitted:false, reason:"cap_parked"}` with the same `retryAt`; a second `rejected` for the same window after the relabel writes no second row and no second notify; (b) the same with the real trigger — a `createSubscriptionTokenProvider({ store, … })`-backed provider (Keychain injected/faked, never the real Keychain) whose label changes through `recordTokenCreated`; (c) migration 009: a label equal to another provider's id is skipped (that provider's park stays in force); a database at version 8 holding a `rejected` park row and a pending `cap_reset:<label>` wake-up keyed on an `auth_providers` label migrates to the provider id with `resets_at`, `notified_resets_at` and status unchanged, the fired wake-up untouched and every `events` row byte-for-byte unchanged; the conflict-merge rule; a database already at version 9 reopens; (d) `/status` shows the label for a provider-keyed row and the raw key for a row no provider claims; (e) admission refuses (throws) a request whose `provider` differs. Existing assertions that read `cap_state.account` / wake-up reasons as the label (`kernel/test/budget-cap.test.ts:79`, `:152`, `:166`, `:200`, `:218`, `:302`, `:372-379`, the "another account warns separately" case at `:243-258`, `kernel/test/budget-admission.test.ts:137-141` (:138-139 builds a provider with the SAME id and a different label and expects `{ admitted: true }` — the F06-1 bug asserted as correct; it becomes a relabel-still-refuses assertion or moves into test (a); :141 expects a label-mismatch request to throw, which becomes test (e)'s provider-mismatch throw), `kernel/test/budget-admission.test.ts`, `kernel/test/loop-wakeups.test.ts:105-111`, and every `AdmissionRequest` literal — `kernel/test/budget-admission.test.ts:60` (the `request()` helper), `:371`, `:400`, `:494-495`, `kernel/test/budget-cap.test.ts:127`, `:168`, `:222` — plus the `admission_refused` payload assertion at `kernel/test/budget-admission.test.ts:80`, which gains `provider`) are updated to the id key; none is deleted without an equivalent.
- [ ] AC2 — Given a text-detected park (`text_fallback` row, re-check `resets_at`) followed by a `rejected` `rate_limit_event` for the same hit, when both are processed, then one park row remains and the owner is notified once unless the window actually extends. In `#rateLimitEvent` (`kernel/src/budget/cap.ts:227-324`; today the parked check at `:248-253` looks only at the same `rate_limit_type`, while `#textFallback` at `:199` checks any park): when the event is `rejected`, no unexpired park of the event's own type exists, and an unexpired `text_fallback` park of the same provider exists — (i) **known reset** (`reset_source` would be `event`): the typed row is written with the event's known reset, **even when that reset is earlier than the text fallback's re-check time** (owner decision 2026-10-05: the re-check time is a guess, never a window — this is the ONE documented exception to "an unexpired park only ever extends", and it applies only to replacing a `text_fallback` re-check guess with a known reset, never to two known windows); the `text_fallback` row is deleted in the same transaction; one `cap_park_superseded` event (or an equally named one the worker chooses) records both windows; the typed row's `notified_resets_at` is set to its reset; a `notify` is appended ONLY when the known reset is later than the text fallback's `resets_at`; the text fallback's pending `cap_recheck` wake-up is superseded and one `cap_reset` wake-up is scheduled for the known reset (AC3). (ii) **unknown reset** (`rejected` with no usable `resetsAt`): no typed row is written, no notify, no wake-up; the `text_fallback` park stands as it is and one event records the merge. The reverse order (a `rejected` park first, then the text hit) is unchanged — `#textFallback` already returns on any park. Two different known limit types (e.g. `five_hour` then `seven_day`) remain two rows, as today. Tests: text hit then `rejected` with a later known reset (one row of the event's type, two notifies — the window extended — one pending wake-up); text hit then `rejected` with an earlier known reset (one row with the earlier reset, ONE notify total, admission's `retryAt` is the known reset, one pending wake-up at it); text hit then `rejected` with no `resetsAt` (one `text_fallback` row, one notify, one pending wake-up); the existing reverse-order test stays green.
- [ ] AC3 — Given a park whose window is extended (or replaced, AC2), when the new `cap_*` wake-up is scheduled, then every superseded pending `cap_*` wake-up for the same provider and limit type is marked `status = 'superseded'` (with `updated_at`) in the same transaction, so at most one pending `cap_*` wake-up exists per provider and type. `cap_*` wake-up reasons carry the type: `cap_reset:<providerId>:<rate_limit_type>` / `cap_recheck:<providerId>:<rate_limit_type>` (both scheduling sites, `cap.ts:224` and `:316`). Superseding a (provider, type) also supersedes pending legacy untyped rows for that provider (`cap_reset:<providerId>` / `cap_recheck:<providerId>`, the form migration 009 leaves). The helper lives beside `scheduleWakeupOnce` (`kernel/src/budget/internal.ts:120-131`), keeps its "no duplicate pending row with the same reason and due time" rule, and is the only writer of `superseded`. A superseded row never fires (`fireDueWakeups` selects `status = 'pending'` only, `kernel/src/loop/wakeups.ts:79`) and is not counted in `/status`'s pending wake-ups. Tests: a park extended from 16:20 to 17:20 leaves exactly one pending `cap_reset:<id>:<type>` row (17:20) and one `superseded` row (16:20); a different limit type's pending wake-up is untouched; a legacy untyped row is superseded; a superseded row does not fire.
- [ ] AC4 — Given the doc comments on `fireDueWakeups` (`kernel/src/loop/wakeups.ts:67-75`) and the loop's `EventHandler` type (`kernel/src/loop/types.ts:80-98`), when someone reads them, then they say that a `cap_*` wake-up (reason `cap_reset:…` / `cap_recheck:…`) means "ask admission again" and never "the park ended": a handler must not release parked work on it; the park ends only when admission admits. `docs/ARCHITECTURE.md`'s `cap_state` row (`:45`) says parks key on the provider id with the label as display text, describes the AC2 text-fallback replacement (the one exception to "only ever extends"), and its `wakeups` row (`:43`) names the `superseded` status and what a `cap_*` wake-up means. `bash scripts/check-docs.sh` stays green. No code behaviour changes for AC4.

## Implementation Notes (verified at planning time, main @ 54f188c)
**Files read:**
- `kernel/src/budget/cap.ts` (380 lines): `observe` reads `this.#auth.account` as the key (:188) — switch to `this.#auth.id`, and pass the live label separately for payloads; `#textFallback` (:196-225) — `activeParks(any type)` guard (:199), `cap_recheck:${account}` wake-up (:224); `#rateLimitEvent` (:227-324) — same-type `parked` (:248-253), extension logic (:270-286), once-per-window notify + `scheduleWakeupOnce` (:289-316); `#transient` (:326-338) uses `activeParks` (:328) — key on id; `#row`/`#upsert`/`#updateReadings`/`#setColumn` (:340-379) take the key. The class doc (:123-163) says "keyed on the auth provider's live `account`" — rewrite to the id (and add the AC2 rule and AC3's superseding).
- `kernel/src/budget/admission.ts` (127 lines): the label comparison (:65-71) becomes a provider-id comparison; `activeParks(this.#store, account, at)` (:72) uses the id; `#refuse`'s `admission_refused` payload (:110-124) keeps `account` (the label) and adds `provider`. Class doc (:24-30) — update.
- `kernel/src/budget/internal.ts` (139 lines): `appendNotify` (:49-58) already writes `{ provider: auth.id, account, … }` — callers pass the live label as `account`; `noteAgentLimitReached` (:98) uses `auth.account` for display (fine); `activeParks` (:109-118) — rename the parameter to the key it is; `scheduleWakeupOnce` (:120-131) — add the superseding variant (AC3).
- `kernel/src/budget/types.ts` (140 lines): `BudgetAuth = Pick<AuthProvider, "id" | "account">` (:104) — unchanged; `BudgetOptions.authProvider` doc (:108-115) says the live `account` is the only identity — rewrite to the id.
- `kernel/src/sessions/types.ts` (`AdmissionRequest` :155-160 and its doc :149-154) — add `provider`; `kernel/src/sessions/manager.ts` admission call sites :453, :656, :1239 and the refusal message (:1258, keeps the label for humans); row insert `auth_account` (:1675-1684) stays the label.
- `kernel/src/auth/metadata.ts`: `recordTokenCreated` (:60, upserts `auth_providers.account` at :74-83) — the relabel trigger; NO caller in `kernel/src` today (only the re-export in `auth/index.ts:19`). `subscription-token.ts:74-75` / `api-key.ts:33-34`: `get account()` reads the label live, falling back to the provider id.
- `kernel/src/api/server.ts`: `readStatus` cap rows (:191-205) and `cap_state` mapping (:250); `StatusBody` cap entry type (around :115-125) gains `provider`; `safeAccount` (:174-180).
- `kernel/src/cli/index.ts`: cap lines (:301-305) — unchanged text (`account` stays display); optional: print `(<provider>)` only when it differs from the label (worker's call; keep existing cli.test assertions green or update them deliberately).
- `kernel/src/loop/wakeups.ts` `fireDueWakeups` doc (:67-75); `kernel/src/loop/types.ts` `EventHandler` doc (:80-97).
- `kernel/src/store/migrations/`: `types.ts` (function `up` allowed, runs in a transaction); `index.ts` (append-only list; add `capKeysProviderId` as version 9); `008_events_explicit_id_guard.ts` (style reference: header comment explains why). `kernel/src/store/integrity.ts` `APPEND_ONLY_OBJECTS` — 009 creates no append-only object, so no integrity-list change is needed; confirm.
- `docs/ARCHITECTURE.md` `cap_state` row (:45), `wakeups` row (:43).
- Tests: `kernel/test/budget-helpers.ts` (`AUTH = { id: "stub-provider", account: "owner@example.test" }` :11 — the id and label already differ, which makes the re-key visible), `kernel/test/budget-cap.test.ts` (382 lines), `kernel/test/budget-admission.test.ts` (563), `kernel/test/loop-wakeups.test.ts` (:105-111), `kernel/test/store.test.ts` (migrations `describe` :172; the default-list test name at :187 enumerates migrations — extend it; migration 8's "leaves every existing events row unchanged" pattern at :449 is the model for 009's test; adding version 9 also requires bumping the hard-coded version lists at :464 and :644 (`[1, …, 8]`), the integrity messages at :607 and :616 (versions up to 8), and `err.knownVersion` at :655 (8 ⇒ 9), and renumbering the synthetic `breaking` migration at :672 from version 9 to 10 so `[...migrations, breaking]` stays strictly increasing and the test still exercises the integrity re-check rather than the ordering error), `kernel/test/api.test.ts` (`/status` `cap_state`), `kernel/test/cli.test.ts`, the `AdmissionRequest` literals at `kernel/test/budget-admission.test.ts:60`, `:371`, `:400`, `:494-495` and `kernel/test/budget-cap.test.ts:127`, `:168`, `:222` (typecheck finds every construction site; `kernel/test/sessions.test.ts:1965-1971` / `:2089-2090` assert `notify` payloads, not admission requests, and stay as they are).

**Design (recommended; the worker may deviate with a recorded reason):**
1. **Key vs label:** introduce one local `const key = this.#auth.id` and `const label = this.#auth.account` per `observe` / `check`, read once per call inside the transaction. Every SQL key and wake-up reason uses `key`; every payload's `account` uses `label`, plus `provider: key` where the payload has no `provider` yet. Never derive the key from a label.
2. **Migration 009 (function):** inside the migration transaction: `SELECT id, account FROM auth_providers WHERE account <> id AND account NOT IN (SELECT id FROM auth_providers)`; group by label; for each (label, ids): for each `cap_state` row with `account = label`, for each id: upsert under `(id, rate_limit_type)` applying the conservative merge (AC1), then delete the label row; `UPDATE wakeups SET reason = 'cap_reset:' || <id> … WHERE status = 'pending' AND reason = 'cap_reset:' || <label>` (and `cap_recheck`) — for a label mapping to several ids, insert one copy per extra id. Never touch `events` or `sessions`. Header comment states why (F06-1) and that a label row is only ever this kernel's provider's (one provider per kernel today).
3. **AC2:** before the same-type `parked` computation, when `status === "rejected"` and there is no unexpired row of `type` but `activeParks(key)` contains `text_fallback`: branch as AC2 (i)/(ii). Keep it a small private method (e.g. `#replaceTextFallback`) so the existing same-type path is untouched.
4. **AC3:** `scheduleCapWakeup(store, kind: "cap_reset" | "cap_recheck", key, type, dueAt, at)` in `internal.ts`: `UPDATE wakeups SET status = 'superseded', updated_at = ? WHERE status = 'pending' AND reason IN (<the four typed reasons for key+type>, 'cap_reset:'||key, 'cap_recheck:'||key) AND NOT (reason = <new reason> AND due_at = <dueAt>)`, then the existing insert-unless-duplicate. For AC2 (i) also supersede the `text_fallback` type's rows for the key.

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Cap parks keyed on provider id (+ migration 009), one park per hit, superseded cap wake-ups, wake-up meaning documented | AC1–AC4 | ~10 modify (src/docs), 1 create (migration), ~7 modify (tests) | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts
```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/009_cap_keys_provider_id.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/009_cap_keys_provider_id.ts", name: "capKeysProviderId"}
  - {kind: "symbol", path: "kernel/src/budget/cap.ts", name: "CapTracker"}
  - {kind: "symbol", path: "kernel/src/budget/admission.ts", name: "BudgetAdmission"}
  - {kind: "symbol", path: "kernel/src/budget/internal.ts", name: "scheduleCapWakeup"}
  - {kind: "type", path: "kernel/src/sessions/types.ts", name: "AdmissionRequest"}
  - {kind: "type", path: "kernel/src/api/server.ts", name: "StatusBody"}
  - {kind: "symbol", path: "kernel/src/loop/wakeups.ts", name: "fireDueWakeups"}
  - {kind: "type", path: "kernel/src/loop/types.ts", name: "EventHandler"}
  - {kind: "file", path: "docs/ARCHITECTURE.md"}
requires: []
lanes:
  - "kernel/src/budget/**"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/cli/index.ts"
  - "kernel/src/loop/wakeups.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/store/migrations/**"
  - "kernel/test/budget-cap.test.ts"
  - "kernel/test/budget-admission.test.ts"
  - "kernel/test/budget-helpers.ts"
  - "kernel/test/loop-wakeups.test.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/api.test.ts"
  - "kernel/test/cli.test.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/test/session-fakes.ts"
  - "kernel/test/sessions-process-group.test.ts"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "better-sqlite3 transaction semantics for a function migration (already relied on by the store)"
```
Modified (est.): `kernel/src/budget/cap.ts`, `kernel/src/budget/admission.ts`, `kernel/src/budget/internal.ts`, `kernel/src/budget/types.ts` (doc), `kernel/src/sessions/types.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/api/server.ts`, possibly `kernel/src/cli/index.ts`, `kernel/src/loop/wakeups.ts` (doc), `kernel/src/loop/types.ts` (doc), `kernel/src/store/migrations/index.ts`, `docs/ARCHITECTURE.md`; tests `kernel/test/budget-cap.test.ts`, `kernel/test/budget-admission.test.ts`, possibly `kernel/test/budget-helpers.ts`, `kernel/test/loop-wakeups.test.ts`, `kernel/test/store.test.ts`, `kernel/test/api.test.ts`, possibly `kernel/test/cli.test.ts`, `kernel/test/sessions.test.ts`, `kernel/test/session-fakes.ts`, `kernel/test/sessions-process-group.test.ts`. Created: `kernel/src/store/migrations/009_cap_keys_provider_id.ts`.

## Parallelism Analysis
### Dependency Graph
```
Subtask 1 (independent)
```
### File Overlap Matrix
| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |
### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Phase 3 analysis notes
### Cited-line premise check
| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/budget/cap.ts:188` | yes | HOLDS | `const account = this.#auth.account;` | tip 4 minutes ago, fetched <1h |
| `kernel/src/budget/admission.ts:66` | yes | HOLDS | `const account = this.#auth.account;` | tip 4 minutes ago, fetched <1h |
| `kernel/src/budget/internal.ts:110` | yes | HOLDS | `export function activeParks(store, account, nowIso)` … `WHERE account = ?` (:114) | tip 4 minutes ago, fetched <1h |
| `kernel/src/auth/subscription-token.ts:69` | yes | HOLDS (moved to 75) | `return (store && readProviderMetadata(store, id)?.account) \|\| id;` | tip 4 minutes ago, fetched <1h |
| `kernel/src/auth/api-key.ts:30` | yes | HOLDS (moved to 34) | `return (store && readProviderMetadata(store, id)?.account) \|\| id;` | tip 4 minutes ago, fetched <1h |
| `kernel/src/auth/metadata.ts:20` | yes | HOLDS (moved to 60) | `export function recordTokenCreated(` — no caller in `kernel/src` | tip 4 minutes ago, fetched <1h |
| `kernel/src/budget/cap.ts:248` | yes | HOLDS | `const existing = this.#row(account, type);` (same-type parked check :250-253) | tip 4 minutes ago, fetched <1h |
| `kernel/src/budget/cap.ts:199` | yes | HOLDS | `if (activeParks(this.#store, account, at).length > 0) return;` | tip 4 minutes ago, fetched <1h |
| `kernel/src/budget/internal.ts:121` | yes | HOLDS | `scheduleWakeupOnce` dedupes on reason + due_at, never cancels | tip 4 minutes ago, fetched <1h |
| `kernel/src/budget/cap.ts:316` | yes | HOLDS | `scheduleWakeupOnce(this.#store, \`${known ? "cap_reset" : "cap_recheck"}:${account}\`, resetsAt, at);` | tip 4 minutes ago, fetched <1h |
| `kernel/src/loop/wakeups.ts:76` | yes | HOLDS | `export function fireDueWakeups(store, now)` — fires pending rows into generic `wakeup` events | tip 4 minutes ago, fetched <1h |
| `kernel/src/loop/loop.ts:129` | yes | HOLDS | `this.#finish(row, ref, "event_unhandled", …)` when no handler | tip 4 minutes ago, fetched <1h |

### Blast-Radius / Impact Prediction
| Touched Subsystem | Depends On | Depended-on-by | Incident History |
|-------------------|------------|----------------|------------------|
| `kernel/src/api/server.ts` | `kernel/src/api/kill-switch.ts`, `kernel/src/auth/types.ts`, `kernel/src/budget/index.ts`, `kernel/src/loop/loop.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/orphans.ts`, `kernel/src/sessions/types.ts`, `kernel/src/store/store.ts` | `docs/ARCHITECTURE.md`, `kernel/src/cli/index.ts`, `kernel/src/kernel.ts` | — |
| `kernel/src/loop/wakeups.ts` | `kernel/src/loop/internal.ts`, `kernel/src/loop/queue.ts`, `kernel/src/store/migrations/007_event_loop.ts` | `docs/ARCHITECTURE.md`, `kernel/src/loop/loop.ts`, `kernel/src/tools/server.ts` | — |

**Predicted ripple beyond directly-touched files:** `kernel/src/tools/server.ts` (lets an agent schedule a free-text wake-up reason; a reason that happens to look like `cap_reset:<id>:<type>` would be superseded by the budget — inert either way, verify, no change expected); `kernel/src/kernel.ts` (wires one provider into both the manager and the budget — unchanged).

## Skill References
- `skills/unit-testing/SKILL.md` — vitest, temp stores via `budget-helpers.ts`, controllable clock, a mutable `BudgetAuth` for the relabel, a faked Keychain for the real-provider test, migration tests on a version-8 database
- `skills/error-handling/SKILL.md` — fail closed (provider mismatch throws, conservative migration merge, label mapped to several ids copied to each), no partial writes outside one transaction

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| Migration 009 loses or shortens a park in force (budget state rewrite) | HIGH | LOW | Conservative merge (`rejected` beats non-rejected; later/NULL `resets_at` wins); copy to every matching id; test with a live park row asserting `resets_at`, `notified_resets_at` and admission's refusal after the migration | Requirement "Risks" |
| A label-keyed row no provider claims is left orphaned after the re-key, and admission (now id-keyed) silently admits | MEDIUM | LOW | Today the only non-label key is the provider id itself (the label's fallback), which IS the new key; the migration moves every row whose key is some provider's label; `/status` shows any leftover raw key so the owner can see it | Phase 3 |
| AC2's known-reset replacement lets admission admit earlier than the text fallback's guess | LOW | MEDIUM | Owner decision 2026-10-05: the guess is not a window; the exception is limited to replacing a `text_fallback` re-check with a known reset, documented in the class doc and ARCHITECTURE, and tested both ways (earlier and later) | Owner decision |
| `/status` or CLI shows the opaque provider id instead of a readable label | MEDIUM | MEDIUM | `cap_state[].account` stays the live label (provider lookup), `provider` is additive; api/cli tests assert the label | Requirement "Risks" |
| Typed wake-up reasons break a consumer that parses `cap_reset:<account>` | LOW | LOW | No consumer parses the reason (`grep cap_reset kernel/src` finds only `cap.ts`); the loop passes it through as data; legacy untyped rows are superseded, never misread | Phase 3 |
| Changing `AdmissionRequest` breaks deep-equal assertions in the budget tests | LOW | HIGH | Update the literals listed in AC1 and the `admission_refused` payload assertion to include `provider`; typecheck catches every construction site | Plan Review attempt 1 (LOW) |
| Superseding a provider's legacy untyped `cap_*` wake-up (left by migration 009) ignores type, so it can drop the 'ask again' hint of another type's still-active park | LOW | LOW | Safe by construction: a wake-up is never a release — admission, which reads every active park, is the only release (AC4), and the daemon passes no handlers in phase 1 (`kernel/src/kernel.ts:189`); worst case a delayed hint. Legacy rows exist only until the first new cap wake-up after the migration | Plan Review attempt 1 (LOW) |
| Migration 009 moves rows off a provider whose id equals another provider's label (fail open) | MEDIUM | LOW | Labels equal to any `auth_providers.id` are skipped; a migration test covers the skip | Plan Review attempt 1 (LOW) |
| A relabel mid-transaction makes `observe`/`check` read two different labels | LOW | LOW | Read `id`/`account` once per call inside the transaction; the key never depends on the label | Phase 3 |
| Doc edits break `scripts/check-docs.sh` | LOW | LOW | Run `bash scripts/check-docs.sh` locally | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-05-h05-budget-cap-park-keys.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-05T01:41:05Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/31
- **Branch:** feature/hardening-h05-budget-cap-park-keys
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** H05 AC1-AC4: cap parks, admission and cap wake-ups key on the provider id (AdmissionRequest.provider; migration 009 moves label-keyed cap_state rows and pending cap wake-ups with a conservative merge); a text-fallback park followed by a rejected event leaves one park (known reset replaces the re-check guess, owner decision); typed cap wake-up reasons and superseded status; wake-up meaning documented. Worker resumed once at the turn limit and re-emitted a schema-valid result. Phase 4.5 iteration 1 FAIL (1 HIGH: AC2 merge keyed on the type name; fixed in e3abd74 by reserving text_fallback and guarding on reset_source), iteration 2 PASS. 3 findings dismissed below the fix floor (2 MEDIUM, 1 LOW). risk_classification high_risk=true (advisory).

## Not verified
- **GET /status and `studio status` on a real migrated studio.db under the running daemon** — no local runtime run: covered only by readStatus/API unit tests on temp stores (subtask 1)
