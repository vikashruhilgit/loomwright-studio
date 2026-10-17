# Budget

The budget layer (D24, D26, D28) meters every session's tokens, tracks the subscription cap, and decides whether a session may start. Code: `kernel/src/budget/`. It is a mechanism (invariant 1): every limit and every fallback choice is the user's, set per agent in the budget config or per playbook on the playbook row. With none set, nothing is limited and nothing ever spends money. Limits are counted tokens (input + output + cache writes, D26; cache reads are recorded but never count), never dollars. The only dollar figure is a playbook's API-key fallback ceiling.

This page covers the per-playbook part (phase 3): metering a playbook's sessions, its daily token limit, and its API-key fallback decision. The meter, the cap tracker and `Budget.check` (the gate the playbook gate passes a request with no playbook to) are described in their code docs (`meter.ts`, `cap.ts`, `admission.ts`).

## Per-playbook metering

A session belongs to a playbook when its `sessions.playbook` (migration 13) is set. The meter reads it with the session row on every `result` message and writes the playbook's id (as text, the column is TEXT since migration 1) to `budget.playbook` on each row it records. A session with no playbook writes NULL. A playbook session's usage counts toward its agent, its playbook and the day alike.

After recording, when the playbook's `token_limit_per_day` is set and its counted tokens for the budget day reach it, the meter appends one `playbook_limit_reached` event (`playbook`, `slug`, `day`, `counted_tokens`, `limit`, `retry_at`) and one `notify` (`reason: "playbook_daily_limit"`), once per playbook-day. The running session is not touched: it finishes its current turn, and the playbook gate refuses the playbook's next start.

`playbookTokensToday(store, day)` (exported from `kernel/src/budget/index.ts`) reads the result: one entry per playbook with usage that day, by id, with its `slug`, `countedTokens` and `tokenLimitPerDay` (`null` when unset).

## Admission: the playbook gate

`Budget.checkPlaybook(request)` (`PlaybookAdmission` in `playbook.ts`) takes the session manager's admission request plus `playbook` (a `playbooks.id`, or `null`). Its verdict names the provider the session runs on: `{admitted: true, provider}`, or `{admitted: false, reason, retryAt}` with `reason` one of `cap_parked`, `agent_daily_limit` or `playbook_daily_limit`.

**Wiring.** It is the kernel's session admission: `startKernel` passes the session manager `admission: admissionFor(budget, authProvider.id)` (`kernel/src/kernel.ts`), which asks `checkPlaybook` before every start and resume. The manager's request names the session's `playbook` only when it has one: on a start its `playbook` param, on a resume and every resume retry the playbook it resumes for. A request with no playbook goes to the gate as `playbook: null`, so it gets exactly `Budget.check`'s verdict and events. A refusal throws `AdmissionRefusedError` (`reason` one of the three above) before any row, status change or spawn, so a playbook's fire, run now or dry run at its daily limit starts no session: the fire's or run now's `playbook_runs` row keeps `result_json` `{parked, retry_at}` and the event loop parks the event until `retry_at` (`event_parked`, no second `notify`).

- **`playbook: null`** is exactly `Budget.check`: the same verdict and the same events, byte for byte, and an admit names the subscription provider. The kernel-wide `apiKeyFallback` placeholder in the budget config never switches provider, here or in `check`.
- **A playbook's request** is checked in one store transaction, in this order:
  1. The provider check, as `check` does: a request naming another provider throws (fail closed). An unknown playbook id, or a stored `token_limit_per_day` that is not a positive integer, throws too.
  2. **Daily limit.** A `start` whose playbook's counted tokens today are at or over its `token_limit_per_day` is refused `playbook_daily_limit`, with `retryAt` the start of the next budget day (the host's next local midnight). The first refusal of the day records `playbook_limit_reached` and one `notify`, shared with the meter's crossing, so the owner hears once per playbook per day. A resume is not refused by the limit (as with the agent limit).
  3. **The cap.** When the subscription provider is parked, the playbook is eligible for the API-key fallback (below). If it is not, it is refused `cap_parked` with the park's retry time, as `check` refuses: it waits for the reset.
  4. **The agent limit**, as `check` applies it (`start` only). A fallback never skips it: an eligible playbook whose agent is at its limit is refused `agent_daily_limit`.
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

`events.kind` is free text. This page is the list of the kinds the playbook part writes:

| Kind | When |
|---|---|
| `playbook_limit_reached` | A playbook's counted tokens reached its daily limit, once per playbook-day (meter or gate). Paired with one `notify`. |
| `api_key_fallback_admitted` | The gate admitted a playbook's session on the API-key provider at the cap. |
| `api_key_ceiling_reached` | An opted-in playbook's spend reached its dollar ceiling, once per playbook and ceiling (meter or gate). Paired with one `notify`. A record only: it stops nothing. |
| `admission_refused` | Every refusal (shared with `check`), with `playbook` set on the playbook path. |
