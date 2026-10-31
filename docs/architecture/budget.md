# Budget

The budget layer (D24, D26, D28) meters every session's tokens, tracks the subscription cap, and decides whether a session may start. Code: `kernel/src/budget/`. It is a mechanism (invariant 1): every limit and every fallback choice is the user's, set per agent in the agent's own settings file or per playbook on the playbook row. With none set, nothing is limited and nothing ever spends money. Limits are counted tokens (input + output + cache writes, D26; cache reads are recorded but never count), never dollars. The only dollar figure is a playbook's API-key fallback ceiling.

This page covers the per-agent limits (phase 4) and the per-playbook part (phase 3): metering a playbook's sessions, its daily token limit, and its API-key fallback decision. The meter, the cap tracker and `Budget.check` (the gate the playbook gate passes a request with no playbook to) are described in their code docs (`meter.ts`, `cap.ts`, `admission.ts`).

## Per-agent limits

**Source.** Each agent's limits live in its own settings file, `<dataDir>/config/agents/<id>.json` (`wright.json` for Wright): `limits.tokens_per_day` and `limits.sessions_at_once`, each a positive integer, each unset when absent (the kernel picks none). The kernel gives the `Budget` an `agentLimits` lookup (`agentLimitsFor` in `kernel/src/kernel.ts`) that reads the file through the one settings reader, `readAgentSettings` (`kernel/src/agents/settings.ts`), at every admission check (inside its store transaction) and at every metered `result`. Nothing is cached, so an edit to the file takes effect at the agent's next start. A file with no `model` (`model_unset`) still has its limits applied: a missing model is the session's refusal, not the budget's. `limits.delegation_depth` is not the budget's and is not read here. With no lookup (a `Budget` built without one, as in unit tests), the budget config's static `agentDailyTokenLimits` applies instead and there is no sessions-at-once check.

**Wright.** `wright.json` may set `limits.tokens_per_day` and `limits.sessions_at_once`, and both apply to Wright's sessions exactly as to a crew member's. `limits.delegation_depth` is read too and applied by `kernel_agent_message` ([delegation](delegation.md#wrights-delegation_depth)); `never` and `workspaces` are still refused for Wright (`settings_invalid`, "not supported for Wright yet").

**Order.** `Budget.check` runs, in one store transaction: the cap (`cap_parked`), then the agent's settings, then its token limit, then its sessions at once. The first refusal wins. The playbook gate runs the same three agent checks in its agent slot (step 4 below). A `null` agent skips all three.

- **`settings_invalid` / `settings_missing`.** An agent whose settings file is invalid (not JSON, over the size limit, the wrong shape, a misspelt or non-positive limit) or, for a crew member, missing is refused, starts and resumes alike, with `retryAt` `null` (the event loop's default one-hour recheck). The `admission_refused` event names the `file` and the reader's `message`. A broken or deleted file is never read as "no limit" (fail closed).
- **`agent_daily_limit`.** A `start` whose agent's counted tokens today are at or over its `tokens_per_day` is refused until the start of the next budget day. The first crossing of the day records `budget_limit_reached` and one `notify`, shared with the meter's crossing. A resume is never refused by `tokens_per_day`.
- **`agent_sessions_at_once`.** A `start` or `resume` whose agent's live sessions number `sessions_at_once` or more is refused, with `retryAt` now + `SESSIONS_AT_ONCE_RECHECK_MS` (60 seconds, `kernel/src/budget/internal.ts`), so the event loop parks the work one minute rather than its one-hour default and starts it once a live session has ended. A resume counts because it adds a live session. The `admission_refused` event carries `live`, `limit` and `live_sessions` (the live ids), plus `orphaned_sessions` and a `hint` naming `studio session abandon <id>` when an orphan is among them.

**Live sessions** are the agent's `sessions` rows with status `starting`, `running` or `orphaned` (an orphan's process group may still be alive). They are counted in the same transaction the admit is decided in, and the session manager inserts an admitted start's `starting` row with no `await` after the admit, so two starts issued in the same tick admit at most the limit. A resume request carries the id of the session it resumes (`AdmissionRequest.session`, on the resume and every resume retry), and that row is left out of the count: a session's own retry (its row is `starting` or `running`) and the resume of its own `orphaned` row never refuse themselves. A `resume` request without `session` counts every live row (fail closed).

**Notifications.** The token limit notifies once per agent-day (above). `settings_invalid`, `settings_missing` and `agent_sessions_at_once` notify once per agent and reason per hour: the first refusal appends one `notify` (`reason` the refusal's, with `agent`), later ones within the hour append only their `admission_refused` event. A parked event's redelivery is a new refusal, so a start waiting on `sessions_at_once` appends one `admission_refused` and one `event_parked` per minute while it waits.

**Labels that are not crew ids.** An agent label that fails the crew-id grammar (`isValidAgentId` false and not `wright`, for example `exit-test:event-1` or a reserved folder name) cannot name a settings file, so it has no limit the owner could have set: no per-agent check applies, as for a `null` agent (owner decision, 2026-10-18). The cap and a playbook's own limit still apply.

**The meter** reads `tokens_per_day` through the same lookup, to record `budget_limit_reached` when a result crosses it. A settings refusal, or a lookup that throws, is skipped there and never fails the metered result: the usage is still recorded, and admission refuses the agent's next start on the broken file.

**Honest limits.**

- Limits apply at admission only. A running session is never stopped when its agent passes `tokens_per_day` or when the owner lowers a limit; the new value applies to the next start.
- A resume is never refused by `tokens_per_day`, so a resumed session can spend past the limit the same day (as before).
- An `orphaned` row counts as live until it is resumed, re-examined back to `interrupted` by the kernel's orphan reaper, or abandoned. `studio session abandon` releases only an orphan whose orphaning reason was `leader_unverified`; the hint names the command for every orphan, and for the others the reaper or a resume is the way out.
- Reading Wright's limits creates `wright.json` when it is absent (the one reader's rule, as the brain already does); a failure to create it fails the admission closed.
- A settings refusal waits for the loop's hourly recheck: fixing the file does not wake a parked event sooner.
- A dry run is a `start` that takes one of the owning agent's `sessions_at_once` slots. `kernel_playbook_dry_run` (`kernel/src/playbooks/dry-run.ts`) starts its session as the playbook's owning agent (the caller for its own playbook, the crew member for one Wright drafted for it) and waits for it to end, so the caller's own session is live the whole time. With `sessions_at_once` 1, every dry run from the agent's own session is refused `agent_sessions_at_once`. The refusal fails the tool call and nothing parks it, so a retry from the same session cannot succeed. `kernel_playbook_enable` (`kernel/src/playbooks/enable.ts`) needs a `done` dry run of the current version, so such an agent can never get a playbook enabled. A dry run needs a limit of at least 2.
- Wright's messages, its playbooks' fires and the owner's run nows all start (or resume) sessions as `wright`, so they share Wright's `sessions_at_once`. With a limit of 1, each one waits, parked a minute at a time, while any Wright session is live, including the one the owner is talking to.
- A crew member's playbook runs as that member (phase 4 item 08, [playbook runs](playbook-runs.md#the-run)): its dry run, fires and run nows start sessions with the member's `agent`, so the member's own `tokens_per_day` and `sessions_at_once` apply at admission, and a parked fire stays parked as for Wright's. Only an id that is neither Wright nor a registered crew member fails `agent_not_routed` before admission; an `off` member's fire fails `agent_off`, also before admission.

## Per-playbook metering

A session belongs to a playbook when its `sessions.playbook` (migration 13) is set. The meter reads it with the session row on every `result` message and writes the playbook's id (as text, the column is TEXT since migration 1) to `budget.playbook` on each row it records. A session with no playbook writes NULL. A playbook session's usage counts toward its agent, its playbook and the day alike.

After recording, when the playbook's `token_limit_per_day` is set and its counted tokens for the budget day reach it, the meter appends one `playbook_limit_reached` event (`playbook`, `slug`, `day`, `counted_tokens`, `limit`, `retry_at`) and one `notify` (`reason: "playbook_daily_limit"`), once per playbook-day. The running session is not touched: it finishes its current turn, and the playbook gate refuses the playbook's next start.

`playbookTokensToday(store, day)` (exported from `kernel/src/budget/index.ts`) reads the result: one entry per playbook with usage that day, by id, with its `slug`, `countedTokens` and `tokenLimitPerDay` (`null` when unset).

## Admission: the playbook gate

`Budget.checkPlaybook(request)` (`PlaybookAdmission` in `playbook.ts`) takes the session manager's admission request plus `playbook` (a `playbooks.id`, or `null`). Its verdict names the provider the session runs on: `{admitted: true, provider}`, or `{admitted: false, reason, retryAt}` with `reason` one of `cap_parked`, `settings_invalid`, `settings_missing`, `agent_daily_limit`, `agent_sessions_at_once` or `playbook_daily_limit`.

**Wiring.** It is the kernel's session admission: `startKernel` passes the session manager `admission: admissionFor(budget, authProvider.id)` (`kernel/src/kernel.ts`), which asks `checkPlaybook` before every start and resume. The manager's request names the session's `playbook` only when it has one: on a start its `playbook` param, on a resume and every resume retry the playbook it resumes for. A request with no playbook goes to the gate as `playbook: null`, so it gets exactly `Budget.check`'s verdict and events. A refusal throws `AdmissionRefusedError` (`reason` one of the six above) before any row, status change or spawn, so a playbook's fire, run now or dry run at its daily limit starts no session: the fire's or run now's `playbook_runs` row keeps `result_json` `{parked, retry_at}` and the event loop parks the event until `retry_at` (`event_parked`, no second `notify`).

- **`playbook: null`** is exactly `Budget.check`: the same verdict and the same events, byte for byte, and an admit names the subscription provider. The kernel-wide `apiKeyFallback` placeholder in the budget config never switches provider, here or in `check`.
- **A playbook's request** is checked in one store transaction, in this order:
  1. The provider check, as `check` does: a request naming another provider throws (fail closed). An unknown playbook id, or a stored `token_limit_per_day` that is not a positive integer, throws too.
  2. **Daily limit.** A `start` whose playbook's counted tokens today are at or over its `token_limit_per_day` is refused `playbook_daily_limit`, with `retryAt` the start of the next budget day (the host's next local midnight). The first refusal of the day records `playbook_limit_reached` and one `notify`, shared with the meter's crossing, so the owner hears once per playbook per day. A resume is not refused by the limit (as with the agent limit).
  3. **The cap.** When the subscription provider is parked, the playbook is eligible for the API-key fallback (below). If it is not, it is refused `cap_parked` with the park's retry time, as `check` refuses: it waits for the reset.
  4. **The agent checks**, as `check` applies them (see "Per-agent limits"): the agent's settings (`settings_invalid` / `settings_missing`), its token limit (`start` only, `agent_daily_limit`), then its sessions at once (`agent_sessions_at_once`). A fallback never skips them: an eligible playbook whose agent is at a limit is refused.
  5. Admitted: on the API-key provider when step 3 found it eligible (one `api_key_fallback_admitted` event with the spend and the ceiling), else on the subscription provider.

Every refusal appends one `admission_refused` event: `check`'s payload plus the `playbook` id, and for `cap_parked` an `api_key_fallback` field saying why the fallback did not apply (`not_opted_in`, `no_api_key_provider` or `ceiling_reached`).

## API-key fallback

D28: when the subscription cap is hit, a playbook may continue on the user's own API key under a dollar ceiling. It is opt-in per playbook, and only the playbooks the user chooses can ever cost money.

**The ceiling is checked at admission only.** It decides whether a new session may start or resume on the API key; it does not bound what an admitted session spends. Spend grows only when the meter records a `result`, so while it is under the ceiling every request is admitted (a spend of $4.99 under a $5 ceiling admits each start until a result is metered), and each admitted session then spends until it ends. A playbook's total can therefore pass its ceiling by whatever its admitted sessions spend. The meter records the crossing: one `api_key_ceiling_reached` event (`playbook`, `slug`, `spend_usd`, `ceiling_usd`) and one `notify` (`reason: "api_key_ceiling_reached"`), once per playbook and ceiling value (the gate records the same event if it finds the ceiling reached first). Nothing stops a session already running when it happens; see "Not wired yet".

- **The policy** is `playbooks.api_key_fallback_json`, the `ApiKeyFallbackPolicy` shape: `{"enabled": true, "dollarCeilingUsd": 20}`. It is checked with the same rules as the budget config's placeholder (`enabled` a boolean, the ceiling `null` or a positive finite number). NULL, unparseable JSON or an invalid policy reads as off: a damaged policy fails toward waiting, never toward spending.
- **Eligible** means all of: the policy is enabled with a positive ceiling, the `Budget` was given an API-key provider identity (`BudgetOptions.apiKeyProvider`, which must not share the subscription provider's id), and the playbook's spend is below the ceiling. A playbook whose recorded spend equals or passes the ceiling is not admitted on the API key and waits for the reset; sessions admitted before that are not affected.
- **How spend is measured:** the sum of `budget.cost_usd` (the SDK's list-price estimate) over **all** of the playbook's budget rows, **all time**. The schema has no per-session record of which provider a session ran on (`sessions.auth_account` is a display label, never read by the budget), so subscription sessions' estimates are counted too. That can only overcount, so the ceiling is reached early, never late (invariant 3). An exact figure needs a stable provider key on the session or budget row, which is a migration and a follow-up.

**Owner decisions (open).** Three choices above are assumptions D28 does not settle, and all three are reversible:

- What counts as spend: all of the playbook's `cost_usd`, subscription sessions included (the safe overcount), rather than API-key sessions only.
- The period: all time, never reset. D28 names no period, so a daily or monthly ceiling would need the owner to choose one.
- How hard the ceiling is: today it gates admission only, so a playbook can overrun it by its running sessions' spend. Whether a crossing must stop or park running API-key sessions, and whether to cap concurrent API-key admits, is the owner's call (it is wired by item 03, below).

## Not wired yet

- **The session manager never launches on the API-key provider.** The playbook gate is wired (see "Wiring" above), so the playbook's daily limit is enforced on a launch, but the manager launches every session on its one auth provider and the kernel gives the `Budget` no API-key provider, so the fallback never admits a session: at the cap a playbook waits for the reset. `admissionFor` fails closed on an admit that names any other provider (the start or resume launches nothing). Switching a launch to the API key needs the manager to take a provider per session (`kernel/src/sessions/manager.ts`, `types.ts`, item 03). The kernel's own wiring is `onMessage: budget.observe` and `admission: admissionFor(budget, authProvider.id)`.
- **Nothing enforces the dollar ceiling on a running session.** Item 03 must stop or park a playbook's API-key sessions when its spend crosses the ceiling mid-run (the `api_key_ceiling_reached` event is the signal), and decide what happens to admits already granted and running when it does. Until then the ceiling bounds admission only, and an overrun is recorded but not prevented.
- **`studio status` shows no per-playbook line.** The budget module has no status hook in the API or CLI. The data is available through `playbookTokensToday(store, day)` for whichever item adds the line.

## Events

`events.kind` is free text. This page is the list of the kinds the per-agent and playbook parts write:

| Kind | When |
|---|---|
| `playbook_limit_reached` | A playbook's counted tokens reached its daily limit, once per playbook-day (meter or gate). Paired with one `notify`. |
| `api_key_fallback_admitted` | The gate admitted a playbook's session on the API-key provider at the cap. |
| `api_key_ceiling_reached` | An opted-in playbook's spend reached its dollar ceiling, once per playbook and ceiling (meter or gate). Paired with one `notify`. A record only: it stops nothing. |
| `admission_refused` | Every refusal (shared with `check`), with `playbook` set on the playbook path. `reason` is `cap_parked`, `settings_invalid`, `settings_missing`, `agent_daily_limit`, `agent_sessions_at_once` or `playbook_daily_limit`. |
| `budget_limit_reached` | An agent's counted tokens reached its `tokens_per_day`, once per agent-day (meter or gate). Paired with one `notify` (`reason: "agent_daily_limit"`). |
| `notify` | Also written for `settings_invalid`, `settings_missing` and `agent_sessions_at_once` refusals: once per agent and reason per hour, with `agent` and the refusal's details. |

## Reading usage

Two read-only routes serve the Budget & audit screen, from the `gui` feature's `budget-audit` part (`kernel/src/gui/budget-audit.ts`). They report; they set no policy and write nothing. Both need the API token like every route.

### `GET /budget/usage?days=`

`days` is a whole number from 1 to 90 (default 7); anything else answers `400 {"error":"invalid_days"}`. The window is today and the `days - 1` host-local days before it, the same local day the meter and `rosterOf` use. The answer is `{rows, limits, cap_state}`:

- **`rows`** are `budget` rows grouped by day, agent and playbook, newest day first, then by agent and playbook (a missing agent or playbook sorts first). `counted_tokens` is the sum of the generated `counted_tokens` column (input + output + cache writes, D26); `cache_read_tokens` is shown beside it and never added. `cost_estimate_usd` is the sum of `cost_usd`, or `null` when every row in the group has none; it is an estimate "at API rates", never a charge on the subscription build. A day with no usage has no row (the screen draws it as 0).
- **`playbook` is the slug.** `budget.playbook` stores the playbook's id as text, so the route joins `playbooks` to answer the slug. A stored value that names no playbook (a deleted one) keeps its stored text, so a day's rows still add up to the `budget` rows. A row outside any playbook has `playbook: null`.
- **`limits`** has one `scope: "agent"` entry per roster agent (Wright first, then members in id order) taken from the roster as it is: `tokens_today`, `tokens_per_day`, `sessions_running`, `sessions_at_once`, with `null` for a limit never set. Then one `scope: "playbook"` entry per playbook (id order), `id` the slug: `tokens_today` is the meter's own query (`playbookCountedTokens`), `tokens_per_day` is `token_limit_per_day` (`null` when unset or damaged), `sessions_running` counts that playbook's `starting` and `running` sessions, and `sessions_at_once` is `null` (a playbook has none).
- **`cap_state`** is the same rows and grouping `GET /status` reports, with `status`, `resets_at`, `utilization` and `reset_source` as stored. `account` holds the **provider id**, not a label: a contributed route has no auth-provider list, so it cannot look the label up as `GET /status` does. The screen takes the label from the `status` resource entry with the same `provider`. `utilization` is returned as stored; its scale (a 0 to 1 fraction in the observed `unifiedWindows`) is unverified for the top-level field (`docs/OPEN_QUESTIONS.md` Q6).

### `GET /audit?kind=&agent=&playbook=&since=&until=&before=&limit=`

The answer is `{events, next_before}`: events as the feed sends them (`EventFrame`), newest first by id. Every filter is optional and they combine with AND.

- **`kind`** matches `events.kind` exactly. It is free text, so the route has no closed list.
- **`agent`** matches an event when its session has that agent **or** its payload's `agent` key equals it. `events` has no agent column (its `actor` is `kernel` or `api`), so those two links are the only ones.
- **`playbook`** (a slug) matches when the event's session runs that playbook **or** its payload's `playbook` key is the playbook's id (a number) or its slug. A slug naming no playbook answers `200 {"events": [], "next_before": null}`.
- **`since`** and **`until`** are inclusive ISO-8601 instants with an explicit `Z` or offset, normalized to UTC and compared with `events.at` as text. A bad one answers `400 invalid_since` or `invalid_until`; `since` after `until` answers `400 invalid_range`.
- **`limit`** is 1 to 200 (default 50), else `400 invalid_limit`. **`before`** is an event id, and only ids below it are returned; a value that is not a positive whole number answers `400 invalid_cursor`.
- **`next_before`** is the last returned id as a decimal string when the page is full, else `null`. Paging is by keyset, so there is no total, and a page that is exactly full carries a cursor whose next page is empty (with `null`).

A payload is untrusted JSON. A row whose `payload_json` is not valid JSON never raises: it matches no payload condition (`agent`, `playbook`) but still matches `kind` and the time filters, and it is returned with its payload as the stored text.
