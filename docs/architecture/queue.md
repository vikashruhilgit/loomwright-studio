# Queue

The durable event queue and the order the main loop handles it in. Code: `kernel/src/loop/queue.ts` and `kernel/src/loop/loop.ts`. Table: `event_queue` (migration 7, `priority` added by migration 13, see the [data model](../ARCHITECTURE.md#data-model)).

A queue row is one event the kernel must act on: a user message, a fired wake-up, a trigger's `wake_agent`. It is written before anything acts on it, together with its `event_enqueued` row in `events`, in one transaction. The loop marks it `done` only after its handler's effects are committed, parks it (`not_before`) when admission refuses, or marks it `failed`.

## Priority

`enqueueEvent` takes an optional `priority`: `low`, `normal` or `high` (the closed set `PLAYBOOK_PRIORITIES` in `kernel/src/playbooks/types.ts`). Absent or `null` means `normal`. Any other value (`urgent`, an empty string, a number) is refused with a `TypeError` before anything is written. `enqueueMessage` passes none, so a message is `normal`.

A `sourceRef` duplicate writes nothing and returns the first row's id, so the first row keeps its priority even when the second enqueue asked for another one.

The kernel never picks a priority (invariant 1). It only orders by the value the caller set. [Playbook runs](playbook-runs.md) (item 08) pass the playbook's priority, which the owner sets.

## Order

Each tick handles the eligible `pending` rows one at a time:

- `high` first, then `normal`, then `low`;
- within a level, the lowest id (the oldest row) first;
- a row parked until `not_before` is not eligible before that time, whatever its priority;
- each row is handled at most once per tick. A row parked or left `pending` during the tick waits for the next one, even if its `not_before` passes before the tick ends.

The next row is chosen afresh after each one, so a row a handler enqueues during the tick is handled in that tick at its priority: a `high` row enqueued while handling a `normal` row runs before the remaining `normal` and `low` rows. Likewise, a row from an earlier tick whose `not_before` passes while the tick is running is taken in that tick, at its priority. (The phase 1 loop walked rows by increasing id, so it skipped such a row until the next tick.)

## Honest limits

- No starvation guard: a steady stream of `high` rows delays `low` rows indefinitely.
- No pre-emption: the order decides which pending row is handled next. It never interrupts a row being handled or a running session.
- The values are closed in code, not by SQL. A stored priority outside the set (only hand-written SQL can store one) sorts as `normal`.
