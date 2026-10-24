# 29 — Kernel tool schemas show their closed value sets, so a model doesn't guess

## Status: ready

**Priority:** Polish (token cost and reliability) · invariant 1, #95

**As** the owner,
**I want** each kernel tool's input schema to list the values it accepts,
**so that** Wright drafts a valid call the first time instead of spending sessions on refusals.

## Problem

In the live run, Wright's `kernel_agent_create` was refused four times before the fifth call was held (session 35, events 396–419). Each refusal came from the pre-hold check:
1. `avatar.shape` must be one of shark…crab;
2. `avatar.hue` must be one of crew-teal…crew-slate;
3. `tool_policy.never.0` must be one of the never categories;
4. `limits.delegation_depth` must be >0.

The tool's schema types the avatar as `z.object({ shape: z.string(), hue: z.string() })` (`kernel/src/agents/charter-tools.ts:327`), and the closed sets are checked only afterwards, so the model never sees them.

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. In every kernel tool's input schema, use `z.enum(...)` for each closed set the pre-hold check enforces (avatar shape and hue, never categories, permission modes, priorities, dedupe fields, and the like), and numeric bounds (`.int().positive()`) where the check needs them. The kernel's check stays as it is (defence in depth).
2. The schemas must still serialise for the SDK: `tools-sdk-list.test.ts` (#95) passes, with no `z.record`.
3. A test walks every shipped kernel tool and fails if a value set the pre-hold check enforces isn't an enum in the published schema.

## Non-goals

- Changing any value set.

## Acceptance criteria

- [ ] Given `tools/list`, then `kernel_agent_create`'s schema lists the shapes, hues and never categories as enums, and `delegation_depth` as a positive integer.
- [ ] Given the walk test, then it passes for every shipped tool.
- [ ] `tools-sdk-list.test.ts` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`

## Assumptions

- The SDK serialises `z.enum` (#95 found that only `z.record` empties the list). The test confirms it.

## Risks

- Long enum lists cost a few tokens per session, which is small next to four refused calls.

## Depends on
none

## Touches
kernel/src/agents/charter-tools.ts
kernel/test/agents-charter-tools.test.ts
kernel/test/tools-sdk-list.test.ts
