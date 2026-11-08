# Phase 8 item 09 evidence: the payload shape of a merge approval

**Question (Scope 9):** which payload shape does the approval rail file for `mcp__kernel__kernel_merge_approval_request`, and what must `hasMergeApproval` (`kernel/src/integrations/github/repo-policy.ts`) read?

**Answer: the rail files `{ tool, input, cwd }`; `hasMergeApproval` reads that shape and only that shape.**

## What the rail files

`kernel/src/sessions/policy.ts`, `classifyToolCall`, for a tool in `ALWAYS_HELD_TOOLS` (or a GitHub write tool) at base `b2ac1e4`:

```ts
if (ALWAYS_HELD_TOOLS.includes(toolName) || Object.prototype.hasOwnProperty.call(GITHUB_WRITE_TOOLS, toolName)) {
  const action = toolName.startsWith(KERNEL_TOOL_PREFIX) ? toolName.slice(KERNEL_TOOL_PREFIX.length) : toolName;
  return { kind: "outward", action, payload: { tool: toolName, input: toolInput, cwd: payloadCwd } };
}
```

So for the merge approval tool:

- `action` is `kernel_merge_approval_request` (the `mcp__kernel__` prefix stripped), which is `MERGE_APPROVAL_ACTION`;
- `payload` is `{ tool: "mcp__kernel__kernel_merge_approval_request", input: <the tool's input>, cwd }`, stored as `payload_json`.

The tool's input carries `repo`, `pr` and `head_sha` (plus `ci` and `ready_at`). Nothing in the rail copies them to the payload's top level, so a stored merge approval has them at `payload.input.repo`, `payload.input.pr` and `payload.input.head_sha`. (The tool joins `ALWAYS_HELD_TOOLS` in the same item, subtask 2; the shape is the rail's for every held tool.)

## What was wrong

`hasMergeApproval` read `$.repo`, `$.pr` and `$.head_sha` at the top level. The item 08 tests filed hand-built top-level rows, so they passed, but no approval filed through the rail ever had that shape: "Allow once" on a `studio_approval` repo would have approved and still never satisfied `policyMet`, silently never merging.

## What it reads now, and why only that

`json_extract(payload_json, '$.tool') = 'mcp__kernel__kernel_merge_approval_request'` and `$.input.repo`, `$.input.pr`, `$.input.head_sha`, with the existing `action = 'kernel_merge_approval_request' AND status = 'approved'` and `json_valid(payload_json)` guards.

- **Only the filed shape.** The payload is data an agent's tool input produced; a second accepted shape (a top-level `repo` / `pr` / `head_sha`) is a second way for a row to count as the owner's approval, and nothing legitimate files it. Accepting only the rail's shape keeps the check to one reading of one writer.
- **`$.tool` is required.** `action` already says what the row is, but `$.tool` ties the payload to the rail's classification of that exact tool, so a row whose action was written some other way, without that tool, does not count. It fails closed.
- **A type must match.** SQLite compares `pr` as stored: a `"7"` string never equals the number `7`, as before.

## Pins

`kernel/test/integrations-github-repo-policy.test.ts`, `AC5: studio_approval is met only by an approved kernel_merge_approval_request for this repo, PR and head`: the rows are in the nested shape (`filed(...)`, mirroring the rail); the exact one at the head is met; a top-level-shaped row, a row without `tool`, a row of another tool, an `input` that is not an object, another repo, another PR, a non-numeric PR, a pending or denied status, another action and non-JSON all stay `awaiting_owner_approval`; a new head has no approval of its own. The other `policyMet` tests that file an approval use the same nested helper.

Mutation check: flipping `'$.input.repo'` to `'$.repo'` fails those tests (and the real-path pin that item 09 adds in `kernel/test/automate-merge-check.test.ts`).

## Follow-up (outside this item's files)

`app/src/screens/approvals/subject.ts` `kernelFields` already falls back to `payload.input`; its comment "The kernel's reader (`hasMergeApproval`) reads only the payload's top level, so the top level wins" is now stale and should be reworded (not edited here: outside the item's Touches). `docs/architecture/repo-policy.md` (the `studio_approval` row) says the payload's `repo`, `pr` and `head_sha` match; it should say they are read from the filed `input`.
