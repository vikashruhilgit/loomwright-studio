import { describe, expect, it } from "vitest";
import { decideToolUse, freezePolicy } from "../src/sessions/index.js";
import type { ToolPolicy } from "../src/sessions/index.js";

const policy: ToolPolicy = {
  allowedTools: ["Read", "mcp__studio__kernel_record_task", "Bash"],
  allowedBashPrefixes: ["echo", "git status", "ls -la"],
};

const bash = (command: unknown) => decideToolUse(policy, "Bash", { command });

describe("decideToolUse: non-Bash tools", () => {
  it("allows an allowlisted tool by exact name", () => {
    expect(decideToolUse(policy, "Read", { file_path: "/x" })).toEqual({ decision: "allow", reason: "tool_allowed" });
    expect(decideToolUse(policy, "mcp__studio__kernel_record_task", {})).toEqual({
      decision: "allow",
      reason: "tool_allowed",
    });
  });

  it("denies an unknown tool and near-miss names", () => {
    for (const name of ["Write", "read", "Read ", "mcp__studio__kernel_record", "", "Edit"]) {
      expect(decideToolUse(policy, name, {})).toEqual({ decision: "deny", reason: "tool_not_allowed" });
    }
  });

  it("denies everything under an empty policy", () => {
    const empty: ToolPolicy = { allowedTools: [], allowedBashPrefixes: [] };
    expect(decideToolUse(empty, "Read", {}).decision).toBe("deny");
    expect(decideToolUse(empty, "Bash", { command: "echo hi" }).decision).toBe("deny");
  });
});

describe("decideToolUse: Bash", () => {
  it("allows an allowlisted prefix on a word boundary", () => {
    expect(bash("echo hi")).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(bash("echo")).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(bash("git status --short")).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(bash("ls -la /tmp")).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
  });

  it("denies a prefix match that is not on a word boundary", () => {
    expect(bash("echoX hi")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    expect(bash("git statusx")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    expect(bash("git stat")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    expect(bash(" echo hi")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    expect(bash("echo\thi")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
  });

  it("does not allow arbitrary commands because Bash is in allowedTools", () => {
    expect(bash("touch gated.txt")).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
  });

  it("denies echo when it is not allowlisted (the hook gates read-only commands too)", () => {
    const noEcho: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["ls"] };
    expect(decideToolUse(noEcho, "Bash", { command: "echo probe-hi" })).toEqual({
      decision: "deny",
      reason: "bash_prefix_not_allowed",
    });
  });

  // Each shell control/substitution character, on its own, after an allowlisted first word.
  const metacharacters: [string, string][] = [
    [";", "echo hi; touch x"],
    ["&", "echo hi & touch x"],
    ["&&", "echo hi && touch x"],
    ["|", "echo hi | sh"],
    ["||", "echo hi || touch x"],
    ["<", "echo hi < /etc/passwd"],
    [">", "echo hi > x"],
    ["(", "echo (hi"],
    [")", "echo hi)"],
    ["$", "echo $HOME"],
    ["$(", "echo $(touch x)"],
    ["backtick", "echo `touch x`"],
    ["newline", "echo hi\ntouch x"],
    ["carriage return", "echo hi\rtouch x"],
  ];
  for (const [name, command] of metacharacters) {
    it(`denies a compound command using ${name}`, () => {
      expect(bash(command)).toEqual({ decision: "deny", reason: "bash_shell_metacharacter" });
    });
  }

  it("denies a non-string or missing command", () => {
    for (const input of [{ command: 42 }, { command: null }, { command: ["echo", "hi"] }, {}, null, "echo hi", undefined]) {
      expect(decideToolUse(policy, "Bash", input)).toEqual({ decision: "deny", reason: "bash_command_not_string" });
    }
  });

  it("ignores empty and whitespace-only prefixes", () => {
    const loose: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["", " "] };
    expect(decideToolUse(loose, "Bash", { command: " touch x" }).decision).toBe("deny");
    expect(decideToolUse(loose, "Bash", { command: "" }).decision).toBe("deny");
    expect(decideToolUse(loose, "Bash", { command: "  touch x" }).decision).toBe("deny");
  });
});

describe("freezePolicy", () => {
  it("returns a frozen copy that later changes to the input cannot reach", () => {
    const tools = ["Read"];
    const prefixes = ["echo"];
    const frozen = freezePolicy({ allowedTools: tools, allowedBashPrefixes: prefixes });
    tools.push("Write");
    prefixes.push("touch");
    expect(decideToolUse(frozen, "Write", {}).decision).toBe("deny");
    expect(decideToolUse(frozen, "Bash", { command: "touch x" }).decision).toBe("deny");
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.allowedTools)).toBe(true);
    expect(() => (frozen.allowedTools as string[]).push("Write")).toThrow();
  });
});
