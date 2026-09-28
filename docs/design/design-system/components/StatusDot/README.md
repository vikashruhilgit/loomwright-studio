An 8px dot plus a word. It is the same mark in the menu bar, the sidebar, agent cards, session rows and badges, so the user learns it once. Four kernel states and two verified outcomes:

| State | Mark | Colour |
|---|---|---|
| idle | hollow ring | `idle` (= `ink-tertiary`) |
| working | filled, breathing on `duration-pulse` | `working` (= `accent`) |
| waiting on you | filled | `attention` |
| paused at cap | filled with a pause bar | `parked` |
| verified ok | filled | `ok` |
| failed / killed / denied | filled | `danger` |

**Use:** always with the state word next to it (or an `aria-label` carrying it when space forbids, as in the menu bar). Add the meta that makes it actionable in `caption`: the count, the reset time, the verification time.

**Honest status:** `ok` is set only from a kernel-verified fact and its meta names the verification time. A guess is `ink-tertiary` text with no dot.

**Don't:** animate anything but `working`; use `ok` for "probably fine"; use red for "waiting on you".
