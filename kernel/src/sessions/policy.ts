import type { ToolPolicy } from "./types.js";

export type ToolDecisionReason =
  | "tool_allowed"
  | "tool_not_allowed"
  | "bash_prefix_allowed"
  | "bash_prefix_not_allowed"
  | "bash_command_not_string"
  | "bash_shell_metacharacter";

export interface ToolDecision {
  readonly decision: "allow" | "deny";
  readonly reason: ToolDecisionReason;
}

/**
 * Shell control and substitution characters: `;` `&` `|` `<` `>` `(` `)` `$`
 * backtick, newline and carriage return. A Bash command containing any of them
 * is denied before prefix matching, which is what makes a prefix allowlist
 * safe enough for phase 1 (`echo hi; rm x` would otherwise match `echo`).
 * A parser-grade Bash gate is out of scope.
 */
const SHELL_METACHARACTERS = /[;&|<>()$`\n\r]/;

/**
 * The kernel's tool decision. Pure: no I/O. Deny by default.
 *
 * - `Bash` is gated by `allowedBashPrefixes` ONLY — `Bash` in `allowedTools`
 *   does not allow arbitrary commands. A command is allowed when it is a
 *   string, contains no shell metacharacter, and equals an allowlisted prefix
 *   or starts with it followed by a space. Empty or whitespace-only prefixes
 *   are ignored (they would match anything starting with a space).
 * - Any other tool is allowed only when its exact name is in `allowedTools`.
 *
 * `toolInput` is untrusted data from the model: it is only inspected here,
 * never executed or interpolated.
 */
export function decideToolUse(policy: ToolPolicy, toolName: string, toolInput: unknown): ToolDecision {
  if (toolName === "Bash") {
    const command = bashCommandOf(toolInput);
    if (command === undefined) return { decision: "deny", reason: "bash_command_not_string" };
    if (SHELL_METACHARACTERS.test(command)) return { decision: "deny", reason: "bash_shell_metacharacter" };
    const allowed = policy.allowedBashPrefixes.some(
      (prefix) => prefix.trim() !== "" && (command === prefix || command.startsWith(`${prefix} `)),
    );
    return allowed
      ? { decision: "allow", reason: "bash_prefix_allowed" }
      : { decision: "deny", reason: "bash_prefix_not_allowed" };
  }
  return policy.allowedTools.includes(toolName)
    ? { decision: "allow", reason: "tool_allowed" }
    : { decision: "deny", reason: "tool_not_allowed" };
}

/** `tool_input.command` when `tool_input` is an object whose `command` is a string. */
export function bashCommandOf(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

/** A defensive, frozen copy: later changes to the caller's arrays cannot reach the gate. */
export function freezePolicy(policy: ToolPolicy): ToolPolicy {
  return Object.freeze({
    allowedTools: Object.freeze([...policy.allowedTools]),
    allowedBashPrefixes: Object.freeze([...policy.allowedBashPrefixes]),
  });
}
