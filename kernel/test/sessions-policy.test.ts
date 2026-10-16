import { describe, expect, it } from "vitest";
import { PROPOSED_ALLOWED_TOOLS } from "../src/brain/index.js";
import { decideToolUse, freezePolicy } from "../src/sessions/index.js";
import { ALWAYS_HELD_TOOLS, classifyToolCall } from "../src/sessions/policy.js";
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

  it("denies the SDK's ToolSearch meta-tool under Wright's proposed policy (no gate exception: deferral is off at launch instead)", () => {
    const wright: ToolPolicy = { allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] };
    expect(PROPOSED_ALLOWED_TOOLS).not.toContain("ToolSearch");
    for (const name of ["ToolSearch", "toolsearch", "ToolSearchX", "Toolbox"]) {
      expect(decideToolUse(wright, name, {})).toEqual({ decision: "deny", reason: "tool_not_allowed" });
    }
    // The kernel tools it lists are still allowed by exact name.
    expect(decideToolUse(wright, "mcp__kernel__kernel_trigger_register", {})).toEqual({ decision: "allow", reason: "tool_allowed" });
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

describe("decideToolUse and the fixed rail (approvals)", () => {
  const rail = { dataDir: "/data", homeDir: "/home/o", cwd: "/work" };

  it("decideToolUse itself is unchanged: an outward or merge command is still a policy allow, and the gate applies the rail after it", () => {
    const gh: ToolPolicy = { allowedTools: ["Write"], allowedBashPrefixes: ["git", "gh"] };
    expect(decideToolUse(gh, "Bash", { command: "git push origin main" })).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(decideToolUse(gh, "Bash", { command: "gh pr merge 12" })).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(classifyToolCall("Bash", { command: "git push origin main" }, rail)).toMatchObject({ kind: "outward", action: "git push" });
    // The held payload carries the cwd it would run in, and no git option spelling hides the push.
    expect(classifyToolCall("Bash", { command: "git --attr-source HEAD push origin main" }, rail)).toEqual({
      kind: "outward",
      action: "git push",
      payload: { tool: "Bash", command: "git --attr-source HEAD push origin main", cwd: "/work" },
    });
    expect(decideToolUse(gh, "Bash", { command: "rm /data/studio.d*" })).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    expect(classifyToolCall("Bash", { command: "rm /data/studio.d*" }, rail)).toEqual({ kind: "deny", reason: "protected_kernel_path" });
    expect(classifyToolCall("Bash", { command: "gh pr merge 12" }, rail)).toEqual({ kind: "deny", reason: "merge_blocked" });
    expect(classifyToolCall("Write", { file_path: "/data/studio.db", content: "" }, rail)).toEqual({ kind: "deny", reason: "protected_kernel_path" });
    // The metacharacter refusal still comes first: a chained push never reaches the rail.
    expect(decideToolUse(gh, "Bash", { command: "echo hi; git push" })).toEqual({ decision: "deny", reason: "bash_shell_metacharacter" });
  });
});

describe("ALWAYS_HELD_TOOLS (phase 3 foundation)", () => {
  const rail = { dataDir: "/data", homeDir: "/home/o", cwd: "/work" };

  it("is the closed list of tools every call to which is held: today only kernel_playbook_enable", () => {
    expect(ALWAYS_HELD_TOOLS).toEqual(["mcp__kernel__kernel_playbook_enable"]);
    expect(Object.isFrozen(ALWAYS_HELD_TOOLS)).toBe(true);
  });

  it("classifies kernel_playbook_enable as outward whatever its input: action without the mcp__kernel__ prefix, payload {tool, input, cwd}", () => {
    for (const input of [{ playbook: 3 }, {}, null, "x"]) {
      expect(classifyToolCall("mcp__kernel__kernel_playbook_enable", input, rail)).toEqual({
        kind: "outward",
        action: "kernel_playbook_enable",
        payload: { tool: "mcp__kernel__kernel_playbook_enable", input, cwd: "/work" },
      });
    }
    // A relative or absent cwd records "/", as every other outward payload does.
    expect(classifyToolCall("mcp__kernel__kernel_playbook_enable", {}, { dataDir: "/data", homeDir: "/home/o" })).toMatchObject({
      payload: { cwd: "/" },
    });
  });

  it("holds only the exact name: the other playbook tools and near-miss names stay ordinary", () => {
    for (const name of [
      "mcp__kernel__kernel_playbook_create",
      "mcp__kernel__kernel_playbook_update",
      "mcp__kernel__kernel_playbook_list",
      "mcp__kernel__kernel_playbook_disable",
      "mcp__kernel__kernel_playbook_dry_run",
      "kernel_playbook_enable",
      "mcp__kernel__kernel_playbook_enablex",
      "mcp__other__kernel_playbook_enable",
    ]) {
      expect(classifyToolCall(name, {}, rail), name).toEqual({ kind: "ordinary" });
    }
  });

  it("every proposed Wright tool outside ALWAYS_HELD_TOOLS stays ordinary, and every one in it is outward", () => {
    for (const name of PROPOSED_ALLOWED_TOOLS) {
      const expected = ALWAYS_HELD_TOOLS.includes(name) ? "outward" : "ordinary";
      expect(classifyToolCall(name, {}, rail).kind, name).toBe(expected);
    }
  });
});
