# SDK message fixtures

Recorded SDK message shapes the budget tests replay (item 06, AC9). The
raw outputs of `probes/p3-usage-reporting.mjs` and `probes/p6-cap-signal.mjs`
were never saved as files, so these fixtures are **rebuilt** from the figures
`docs/OPEN_QUESTIONS.md` records (Q3, Q6), shaped after the types in
`@anthropic-ai/claude-agent-sdk` 0.3.284 `sdk.d.ts`. They are plausible
shapes, not byte-for-byte captures.

Every `session_id` and `uuid` is redacted to a fixed all-zero UUID, and the
`result` text is replaced by `REDACTED`. Timing fields are zeroed.

## `p3-result.json`

A `result` message (`subtype: "success"`) from the three-turn Haiku 4.5 query
of p3 (2026-09-29). It is **stitched from different recorded figures**, so it
is not a captured `modelUsage` entry:

| Field | Value | Source in `docs/OPEN_QUESTIONS.md` (Q3) |
|---|---|---|
| `modelUsage[…].inputTokens` | 955 | the recorded `result.modelUsage` input figure |
| `modelUsage[…].cacheCreationInputTokens` | 7,788 | the recorded `result.usage` cache-creation sum |
| `modelUsage[…].cacheReadInputTokens` | 48,986 | the recorded `result.usage` cache-read sum |
| `modelUsage[…].outputTokens` | 281 | the result's recorded output figure |
| `modelUsage[…].costUSD` | 0.0229 | the recorded `total_cost_usd` (equal to the sum of `costUSD`) |
| `total_cost_usd` | 0.0229 | the recorded `total_cost_usd` |
| `usage.input_tokens` | 26 | the recorded `result.usage` input sum |
| `usage.output_tokens` | 281 | the result's recorded output figure |

Not recorded, filled in: the model key `claude-haiku-4-5`, `webSearchRequests`
(0), `contextWindow` and `maxOutputTokens`. No `thinkingTokens` (the field is
optional in `sdk.d.ts`).

## `p6-rate-limit-event.json`

The `rate_limit_event` p6 observed live (2026-09-29, normal login): `status:
"allowed"`, `rateLimitType: "five_hour"`, `resetsAt: 1790698800` (epoch
**seconds**, 2026-09-29 16:20 UTC), and `unifiedWindows` with `five_hour`
utilization 0.01 and `seven_day` 0.07.

- `unifiedWindows` is **untyped**: observed live, absent from `sdk.d.ts`. Its
  utilizations are **0–1 fractions** (the experimental usage API reports 0–100
  percentages instead). The kernel stores it verbatim and reads nothing out of
  it.
- Not recorded, filled in: the top-level `utilization` (0.01, taken from the
  `five_hour` window) and the `seven_day` window's `resetsAt` (1791216000, a
  placeholder; OPEN_QUESTIONS only says each window carries its own).

## `p6-rate-limit-rejected.json`, `p6-rate-limit-warning.json`

**Synthesized** from `SDKRateLimitInfo` in `sdk.d.ts` on the p6 event's
nesting; **never seen live** (the cap-hit path was not triggered, Q6).
`rejected` reuses the `five_hour` reset time; `allowed_warning` is a
`seven_day` warning at 0.8 with `surpassedThreshold` 0.75. All figures in them
are made up.
