# 09 — Wright can load and call its kernel tools in a real session

## Status: ready

**Priority:** MVP · blocks the phase 2 exit (ROADMAP phase 2 row) · found by the owner's live run of 2026-10-15

**As** the owner,
**I want** Wright, running in a real Agent SDK session, to be able to call the kernel tools its policy allows (`kernel_trigger_register` first of all),
**so that** "remind me at 5pm to check X" creates a trigger, and the phase 2 live exit run can pass.

## Problem

The owner's live exit run on 2026-10-15 (commit `05e5362`, Wright model `claude-sonnet-5-5`, the kernel installed as the launchd service) failed steps 1, 3 and 5. In every Wright session the Agent SDK did not offer the kernel's MCP tools directly: Wright first had to call the SDK's `ToolSearch` meta-tool to load `mcp__kernel__kernel_trigger_register`. The kernel's PreToolUse gate (`decideToolUse` in `kernel/src/sessions/policy.ts`) allows only exact names from the policy's `allowedTools`, and Wright's proposed policy does not list `ToolSearch`, so the load was denied. The store recorded it in all three sessions: `tool_decision {"tool":"ToolSearch","decision":"deny","reason":"tool_not_allowed"}` (events 14, 20 and 30). Wright replied that it could not set the reminder.

So on a fresh install Wright can use none of its kernel tools: triggers, notify, approvals, tasks, wake-ups. CI did not catch it because `kernel/test/phase-2-exit.test.ts` uses a stand-in Wright that calls the trigger tool directly and never goes through SDK tool loading.

## Owner decisions (2026-10-15, binding)

- **Approach (b) first.** Kernel sessions run with the SDK's tool deferral turned off, so every tool in the session is offered from the start and the policy stays exactly the user's list. The installed SDK (`@anthropic-ai/claude-agent-sdk` 0.3.284) recognises an `ENABLE_TOOL_SEARCH` environment variable; what it does is UNVERIFIED.
- **Approach (a) only as a fallback**, if the probe shows (b) does not work: the gate allows the `ToolSearch` meta-tool alone (never any other name outside the policy), and records each such decision as a `tool_decision` event like any other. Every tool loaded through it is still gated by exact name when called.
- The user's tool policy is never widened: no tool is added to the proposed Wright policy (`kernel/src/brain/settings.ts`) or to any role's policy to make this work.

## Scope

1. **Probe the real SDK first** and record the result before writing the fix: with the kernel's own launch options and a kernel MCP server, does a session started with tool deferral off call a kernel tool without `ToolSearch`? Record the commands, the SDK version, what the session called and the result in `docs/evidence/agent-sdk-tool-loading-probe.md`, and close a `docs/OPEN_QUESTIONS.md` entry for it.
2. **The fix**: set the deferral switch on every kernel session launch, start and resume alike (the env the session manager builds for `query()`), unless the probe shows it has no effect, in which case implement fallback (a) in the gate instead and say why in the evidence file.
3. **Regression tests**: a deterministic test that pins the launch env/options the kernel passes for start and resume (fails if the switch is dropped), and an opt-in live test (`STUDIO_LIVE=1`, beside `kernel/test/sessions-live.test.ts`) in which a real session calls a kernel tool and the store holds no `ToolSearch` `tool_decision`.
4. **Docs**: the session-launch section of `docs/ARCHITECTURE.md` says how kernel tools reach a session and why the policy needs no meta-tool.

## Part B — the live harness, ready for the rerun

Small fixes to the live exit harness and runbook (from run `automate-2026-10-15-111629`'s kept review summary), so the rerun after this item merges runs clean:

- The harness hard-codes the deep-link prefix instead of using the notifications module's `deepLinkFor()`.
- A redundant extra database connection around `triggerNotifications`.
- CLI stderr is printed unredacted in harness assertion messages; pass it through the harness's existing redaction.
- The runbook's "Real notifications appear" bullet omits step 2's notification.

## Non-goals

- Changing any agent's tool policy, or adding `ToolSearch` (or any other tool) to the proposed Wright policy.
- Running the phase 2 live exit again: that stays the owner's step after this item merges.
- Marking phase 2 done in `docs/ROADMAP.md`.

## Acceptance criteria

- [ ] Given the probe, then `docs/evidence/agent-sdk-tool-loading-probe.md` records the SDK version, the exact launch setting tried, whether the session called a kernel tool with and without the setting, and the store's `tool_decision` rows for each, and `docs/OPEN_QUESTIONS.md` has the matching entry marked answered with a link to it.
- [ ] Given a session started by the session manager, when the test inspects the options passed to `query()`, then the deferral setting the probe validated is present; and given a resumed session, the same holds.
- [ ] Given Wright's proposed policy unchanged, when a real Wright session (`STUDIO_LIVE=1`) is asked to set a reminder, then a trigger is registered and the store has no `ToolSearch` `tool_decision` for that session.
- [ ] Given a tool not in the policy, when a session tries to call it, then it is still denied with `tool_not_allowed` (no tool becomes callable that the policy does not list).
- [ ] Given fallback (a) is used instead, then only the exact name `ToolSearch` is allowed outside the policy, each decision is recorded as a `tool_decision` event with its own reason, and a test pins that any other unlisted name is still denied.
- [ ] Given the live harness, then its deep links come from `deepLinkFor()`, no assertion message prints unredacted CLI stderr, and the runbook's "Real notifications appear" bullet lists step 2.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`
- Running system: `cd kernel && STUDIO_LIVE=1 npx vitest run test/sessions-live.test.ts` on the owner's machine; paste its output (fenced) in the PR body. It spends tokens on the owner's subscription.

## Risks

- The `ENABLE_TOOL_SEARCH` setting is undocumented in the SDK's types; a later SDK may rename or drop it. The deterministic test pins that the kernel sets it, and the live test catches the SDK ignoring it.
- With deferral off, every tool's schema is in context on every turn. Wright's set (about 12 kernel tools plus Read, Glob and Grep, and whatever the Loomwright plugin adds) is small, but note the count in the evidence file.
- Fallback (a) puts a fixed exception into the safety gate. It is the owner's stated fallback; keep it to the one name and record every use.

## Depends on
none

## Touches
kernel/src/sessions/manager.ts
kernel/src/sessions/policy.ts
kernel/test/sessions-tool-loading.test.ts
kernel/test/sessions-policy.test.ts
kernel/test/sessions-live.test.ts
kernel/test/phase-2-exit-live.test.ts
docs/evidence/agent-sdk-tool-loading-probe.md
docs/evidence/phase-2-exit-runbook.md
docs/OPEN_QUESTIONS.md
docs/ARCHITECTURE.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-16T01:38:53Z
- **Brief:** .supervisor/jobs/done/2026-10-15-wright-kernel-tool-loading.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/61
