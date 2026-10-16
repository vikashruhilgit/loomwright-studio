// The dry-run mechanism (phase 3 item 03): what a dry-run session may run,
// and what it records instead of running everything else. Pure, no I/O, a
// leaf like `policy.ts`. The gate in `manager.ts` calls `classifyDryRunCall`
// only for a dry-run session, after the policy and the rail have answered: a
// dry run only narrows them (invariant 3), it never widens or skips either.
import type { UsageTotals } from "../budget/types.js";
import { bashCommandOf, shellWords } from "./policy.js";
import type { ToolCallClass, ToolDecision } from "./policy.js";
import type { WouldDoEntry } from "./types.js";

/**
 * The tools a dry-run session may run by name, whatever their input: the
 * three file readers and the kernel's Loomwright contract reader. Closed: a
 * name is added only by a kernel change, never by a policy or a playbook.
 * The kernel's own list/get tools are read-only too (`isDryRunReadOnlyKernelTool`).
 * Every other tool is "would do": `Write`, `Edit`, `NotebookEdit`,
 * `WebFetch`, `WebSearch`, `Task`, every other `kernel_*` tool (`kernel_notify`,
 * `kernel_approval_request`, `kernel_schedule_wakeup`, `kernel_request_stop`,
 * each `*_create` / `*_update` / `*_register` / `*_remove` / `*_disable` /
 * `*_enable` / `*_dry_run`) and any tool of another MCP server.
 */
export const DRY_RUN_READ_ONLY_TOOLS: readonly string[] = Object.freeze([
  "Read",
  "Glob",
  "Grep",
  "mcp__kernel__kernel_loomwright_capabilities",
]);

/**
 * A kernel MCP server tool that only reads: `mcp__kernel__kernel_<name>_list`
 * or `mcp__kernel__kernel_<name>_get`, where `<name>` is one or more
 * lower-case alphanumeric words joined by single underscores (today
 * `kernel_task_list`, `kernel_task_get`, `kernel_trigger_list`; later
 * `kernel_playbook_list`). The whole name must match: no other suffix counts.
 */
const KERNEL_READ_TOOL = /^mcp__kernel__kernel_[a-z0-9]+(?:_[a-z0-9]+)*_(?:list|get)$/;

/** Whether `toolName` is one of the kernel's own list/get tools (`KERNEL_READ_TOOL`). */
export function isDryRunReadOnlyKernelTool(toolName: string): boolean {
  return KERNEL_READ_TOOL.test(toolName);
}

/**
 * The programs a dry-run session's Bash command may start with, matched
 * against the command's FIRST shell word exactly (`shellWords`, case-sensitive,
 * no path: `/bin/cat`, `./ls` and `CAT` are not in the set). Each one only
 * reads or prints: none can write a file, send anything, or run another
 * program through its own arguments. The policy's shell-metacharacter deny
 * (no `>`, `|`, `;`, `$`, …) and the rail (protected paths, the outward set)
 * still apply on top, so `cat ~/.claude/settings.json` is still held and a
 * `cat` of a kernel file is still denied.
 *
 * Deliberately out (each can write, send or run another program): `git`
 * (aliases, `-c`, hooks), `gh` (any write subcommand), `find` (`-exec`,
 * `-delete`), `xargs`, `env`, `sed` (`w`, `e`, `-i`), `awk` (`system()`,
 * redirection), `sort` (`-o`), `uniq` (an output file operand), `tee`, `rg`
 * (`--pre`), `npm` / `npx` / `node` (scripts), `sh` / `bash`, `curl`, `date`
 * (`-s` sets the clock) and `touch`. Closed and frozen: a name is added only
 * by a kernel change, never by a policy or a playbook.
 */
export const DRY_RUN_READ_ONLY_BASH: readonly string[] = Object.freeze(["cat", "head", "tail", "ls", "wc", "grep", "pwd", "echo"]);

/** Whether a Bash command's first shell word is exactly one of `DRY_RUN_READ_ONLY_BASH`. */
export function isDryRunReadOnlyBash(command: string): boolean {
  const first = shellWords(command)[0];
  return first !== undefined && DRY_RUN_READ_ONLY_BASH.includes(first);
}

/** Whether a dry-run session may run this call (a read-only tool, or a read-only Bash command). */
export function isDryRunReadOnly(toolName: string, toolInput: unknown): boolean {
  if (toolName === "Bash") {
    const command = bashCommandOf(toolInput);
    return command !== undefined && isDryRunReadOnlyBash(command);
  }
  return DRY_RUN_READ_ONLY_TOOLS.includes(toolName) || isDryRunReadOnlyKernelTool(toolName);
}

/**
 * A would-do entry's `input_summary` is at most this many characters: a Bash
 * command truncated to the same bound as the `tool_decision` event's
 * `command` (`MAX_EVENT_COMMAND_CHARS` in `manager.ts`), any other tool's
 * input as JSON truncated to it.
 */
export const DRY_RUN_INPUT_SUMMARY_CHARS = 500;

/**
 * A bounded summary of a call's untrusted input: the Bash command, or the
 * input as JSON, cut to `DRY_RUN_INPUT_SUMMARY_CHARS`. It is data only: never
 * executed or interpolated. The kernel adds nothing to it (no env, no
 * credential). A `toJSON` that throws propagates: the gate then fails closed.
 */
export function dryRunInputSummary(toolName: string, toolInput: unknown): string {
  const command = toolName === "Bash" ? bashCommandOf(toolInput) : undefined;
  const text = command ?? JSON.stringify(toolInput) ?? "";
  return text.slice(0, DRY_RUN_INPUT_SUMMARY_CHARS);
}

/**
 * What a dry-run session does with one call:
 * - `as_real_run`: the policy or the rail denied it. Denied with their reason,
 *   exactly as in a real run, and never a would-do entry (a real run would
 *   not do it either).
 * - `allow`: a read-only call the rail found ordinary. It runs, as in a real run.
 * - `would_do`: denied with reason `dry_run`, and `entry` is recorded.
 */
export type DryRunVerdict =
  | { readonly kind: "as_real_run" }
  | { readonly kind: "allow" }
  | { readonly kind: "would_do"; readonly entry: WouldDoEntry };

/**
 * Classify one call for a dry-run session from the policy's decision and the
 * rail's class (the rail is read only after the policy allowed). In order:
 *
 * 1. the policy denies ⇒ `as_real_run`;
 * 2. the rail denies (protected path, merge block, an unreadable or too-large
 *    Bash command) ⇒ `as_real_run`;
 * 3. the rail answers `outward` ⇒ `would_do` with `would: "held"` and the
 *    rail's `action`, whatever the tool (a read-only program the rail holds,
 *    `cat ~/.claude/settings.json`, is held too). The caller never reaches the
 *    approval path, so no approval is written and no grant consumed;
 * 4. the rail answers `ordinary`: a read-only call (`isDryRunReadOnly`) ⇒
 *    `allow`; anything else ⇒ `would_do` with `would: "run"`.
 *
 * `toolInput` is untrusted data: inspected and summarised, never executed or
 * interpolated.
 */
export function classifyDryRunCall(toolName: string, toolInput: unknown, decision: ToolDecision, rail: ToolCallClass): DryRunVerdict {
  if (decision.decision !== "allow" || rail.kind === "deny") return { kind: "as_real_run" };
  if (rail.kind === "outward") return { kind: "would_do", entry: wouldDoEntry(toolName, toolInput, "held", rail.action) };
  if (isDryRunReadOnly(toolName, toolInput)) return { kind: "allow" };
  return { kind: "would_do", entry: wouldDoEntry(toolName, toolInput, "run", undefined) };
}

function wouldDoEntry(tool: string, toolInput: unknown, would: WouldDoEntry["would"], action: string | undefined): WouldDoEntry {
  return Object.freeze({
    tool,
    input_summary: dryRunInputSummary(tool, toolInput),
    would,
    reason: "dry_run" as const,
    ...(action === undefined ? {} : { action }),
  });
}

/**
 * The text the model sees for a `dry_run` deny. Fixed: it never includes the
 * call's input. It tells the model the call was recorded and not run, so it
 * can go on and describe the rest of its plan.
 */
export const DRY_RUN_DENY_MESSAGE =
  "dry_run: this session is a dry run, so this call was recorded as something the session would do and it did not run. " +
  "Do not retry it; continue with the rest of your plan and describe what you would do next.";

// ---- token usage on the report ---------------------------------------------

/** A finite, non-negative number, else 0. Copied from `budget/internal.ts` `finiteNonNegative` so this module stays a leaf. */
function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Normalise one `ModelUsage`: unknown or bad numbers read as 0, tokens as
 * integers. Copied from `budget/meter.ts` `readTotals` (private there), so the
 * report reads usage in the same shape the meter records it.
 */
function readTotals(value: unknown): UsageTotals {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const tokens = (key: string): number => Math.trunc(finiteNonNegative(v[key]));
  return Object.freeze({
    inputTokens: tokens("inputTokens"),
    outputTokens: tokens("outputTokens"),
    cacheCreationInputTokens: tokens("cacheCreationInputTokens"),
    cacheReadInputTokens: tokens("cacheReadInputTokens"),
    thinkingTokens: tokens("thinkingTokens"),
    costUSD: finiteNonNegative(v.costUSD),
  });
}

/**
 * A `result` message's `modelUsage`, normalised per model (`readTotals`), as
 * a frozen null-prototype record: a model named `constructor` or `__proto__`
 * is an ordinary own key. Anything that is not a plain object reads as no
 * models. It is the SDK session's cumulative total, so the report keeps the
 * LAST result's value and never adds results together (`budget/meter.ts`
 * records the deltas).
 */
export function dryRunUsage(modelUsage: unknown): Readonly<Record<string, UsageTotals>> {
  const out = Object.create(null) as Record<string, UsageTotals>;
  if (typeof modelUsage === "object" && modelUsage !== null && !Array.isArray(modelUsage)) {
    for (const [model, usage] of Object.entries(modelUsage)) out[model] = readTotals(usage);
  }
  return Object.freeze(out);
}
