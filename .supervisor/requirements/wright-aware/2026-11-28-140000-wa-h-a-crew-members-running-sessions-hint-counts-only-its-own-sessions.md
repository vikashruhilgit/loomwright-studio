# wa-h — A crew member's "Running sessions" hint counts only its own sessions

## Status: ready

**As** the owner of Loomwright Studio,
**I want** a crew member's "Studio right now" section to say its running-sessions list may be cut off only when its own list really may be,
**so that** the crew member is never told to distrust a list that is complete.

## Why

- wa-d (PR #319, merged as `39ce2279`) added the kernel-built `## Studio right now` section. Its "Running sessions" group is built in `kernel/src/brain/studio-view.ts` (lines 351–362 on `main` at `39ce2279`). The group reads `GET /sessions?status=running` and `?status=starting` through `sessionOutputRoutes`, each with `limit: SESSIONS_LIMIT`. For a crew member it then keeps only that member's rows (`filter((x) => s.wright || x.agent === s.agent)`).
- `atLeast` is set from the unfiltered lengths (`running.length >= SESSIONS_LIMIT || starting.length >= SESSIONS_LIMIT`). So when all of Studio has at least `SESSIONS_LIMIT` running or starting sessions, a crew member's section says "… the source answered its own limit, so there may be more not shown", even when every one of its own sessions is listed.
- The reverse case also exists: when the global page is full, a crew member's own sessions beyond that page are not read at all. The hint is what tells it so, so the fix must not drop the hint where the crew member's list really is incomplete.
- Found by the review drain on PR #319 (LOW, below the fix floor). The owner (via the coordinator, 2026-11-28) asked for it as a follow-up item for the next run.

## Owner decisions

- 2026-11-28: use crew-scoped counts for the hint, and add a test for this case.

## Acceptance Criteria

**Happy path:**
- [ ] AC1. Given a crew member whose own running and starting sessions are all listed, and all of Studio has at least `SESSIONS_LIMIT` running (or starting) sessions, then that member's "Running sessions" group lists its sessions with no "may be more" or "at least" line.
- [ ] AC2. Given a crew member that has more running or starting sessions than the group can show, then its group still says that more may exist (the existing `atLeast` / hidden-count wording), so a truncated list is never presented as complete.
- [ ] AC3. Given Wright, then the "Running sessions" group is unchanged: it lists all of Studio's sessions, and its hint keeps today's global rule.

**How:**
- [ ] AC4. The crew member's hint is decided from crew-scoped data: either the sessions read is narrowed to that agent (if the `/sessions` route or its reader supports an agent filter; check before adding one), or `atLeast` is computed so it is true only when the member's own rows may lie beyond what was read. Whichever is chosen, the section is still read through the owner route's own handler or reader, as wa-d requires, and the bound of `MAX_STUDIO_VIEW_CHARS` still holds.

**Tests:**
- [ ] AC5. `kernel/test/brain-studio-view.test.ts` gains a test for AC1: a store seeded with at least `SESSIONS_LIMIT` running sessions of other agents plus one session of the crew member, asserting the member's section has no "may be more" line. A test for AC2 and a test pinning AC3 are added or kept. Each new pin is shown to fail when the fix is reverted (one pin-mutation row per pin).

**Always:**
- [ ] AC6. A crew member still sees only its own items (wa-d's crew scoping), and nothing is written to the store by building the section.

## Non-goals
- Changing the other groups' limits or wording.
- Changing the `/sessions` route's behaviour for the app.

## Priority: Low
**Rationale:** a wrong "may be more" hint misleads a crew member but hides nothing.

## Validation (must pass before merge)
1. **Static:** `cd kernel && npm ci && npm test`, with the AC5 tests; `bash scripts/check-docs.sh`.

## Depends on
none

## Touches
kernel/src/brain/studio-view.ts
kernel/test/brain-studio-view.test.ts
docs/architecture/brain.md
