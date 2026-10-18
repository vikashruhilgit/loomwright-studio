import { describe, expect, it } from "vitest";
import { PROPOSED_ALLOWED_TOOLS } from "../src/brain/index.js";
import { decideToolUse, freezePolicy } from "../src/sessions/index.js";
import { ALWAYS_HELD_TOOLS, NEVER_CATEGORIES, boundaryDecision, boundaryDenyReason, classifyToolCall, neverCategoriesOf } from "../src/sessions/policy.js";
import type { NeverCategory } from "../src/sessions/policy.js";
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

  it("copies never (frozen) when present, and adds no never key when absent", () => {
    const never: NeverCategory[] = ["git_push"];
    const frozen = freezePolicy({ allowedTools: [], allowedBashPrefixes: [], never });
    never.push("gh_api_write");
    expect(frozen.never).toEqual(["git_push"]);
    expect(Object.isFrozen(frozen.never)).toBe(true);
    expect(Object.keys(freezePolicy({ allowedTools: [], allowedBashPrefixes: [] }))).toEqual(["allowedTools", "allowedBashPrefixes"]);
  });
});

describe("NEVER_CATEGORIES and boundaryDecision (phase 4 foundation)", () => {
  const rail = { dataDir: "/data", homeDir: "/home/o", cwd: "/work" };

  it("is the closed, frozen list of never categories, one per outward form the rail emits", () => {
    expect(NEVER_CATEGORIES).toEqual([
      "git_push",
      "alias_define",
      "gh_pr_create",
      "gh_pr_comment",
      "gh_pr_review",
      "gh_pr_edit",
      "gh_pr_close",
      "gh_issue_create",
      "gh_issue_comment",
      "gh_issue_edit",
      "gh_issue_close",
      "gh_api_write",
      "settings_write",
      "hooks_write",
    ]);
    expect(Object.isFrozen(NEVER_CATEGORIES)).toBe(true);
  });

  /** One call per outward action label the rail can emit, with the categories that label is in. */
  const LABELS: [string, unknown, string, NeverCategory[]][] = [
    ["Bash", { command: "git push origin main" }, "git push", ["git_push"]],
    ["Bash", { command: "git send-pack remote" }, "git send-pack", ["git_push"]],
    ["Bash", { command: "git http-push url" }, "git http-push", ["git_push"]],
    ["Bash", { command: "git svn dcommit" }, "git svn dcommit", ["git_push"]],
    ["Bash", { command: "git svn set-tree x" }, "git svn set-tree", ["git_push"]],
    ["Bash", { command: "git send-email x.patch" }, "git send-email", ["git_push"]],
    ["Bash", { command: "git imap-send" }, "git imap-send", ["git_push"]],
    ["Bash", { command: "git cvsexportcommit x" }, "git cvsexportcommit", ["git_push"]],
    ["Bash", { command: "git p4 submit" }, "git p4 submit", ["git_push"]],
    ["Bash", { command: "git -c alias.p=push p" }, "git alias", ["git_push", "alias_define"]],
    ["Bash", { command: "gh alias set co 'pr checkout'" }, "gh alias set", ["alias_define"]],
    ["Bash", { command: "gh alias import aliases.yml" }, "gh alias import", ["alias_define"]],
    ["Bash", { command: "gh pr create --fill" }, "gh pr create", ["gh_pr_create"]],
    ["Bash", { command: "gh pr new --fill" }, "gh pr create", ["gh_pr_create"]],
    ["Bash", { command: "gh pr comment 3 -b x" }, "gh pr comment", ["gh_pr_comment"]],
    ["Bash", { command: "gh pr review 3 --approve" }, "gh pr review", ["gh_pr_review"]],
    ["Bash", { command: "gh pr edit 3 --title t" }, "gh pr edit", ["gh_pr_edit"]],
    ["Bash", { command: "gh pr close 3" }, "gh pr close", ["gh_pr_close"]],
    ["Bash", { command: "gh issue create --title t" }, "gh issue create", ["gh_issue_create"]],
    ["Bash", { command: "gh issue new --title t" }, "gh issue create", ["gh_issue_create"]],
    ["Bash", { command: "gh issue comment 3 --body x" }, "gh issue comment", ["gh_issue_comment"]],
    ["Bash", { command: "gh issue edit 3" }, "gh issue edit", ["gh_issue_edit"]],
    ["Bash", { command: "gh issue close 3" }, "gh issue close", ["gh_issue_close"]],
    ["Bash", { command: "gh api -X POST repos/o/r/issues" }, "gh api POST", ["gh_api_write"]],
    ["Bash", { command: "gh api -X DELETE repos/o/r/x" }, "gh api DELETE", ["gh_api_write"]],
    ["Bash", { command: "gh api -Z repos/o/r" }, "gh api (flag unread)", ["gh_api_write"]],
    ["Bash", { command: "cat /home/o/.claude/CLAUDE.md" }, "Bash naming ~/.claude/", ["settings_write"]],
    ["Bash", { command: "cat settings.local.json" }, "Bash naming a settings*.json file", ["settings_write"]],
    ["Bash", { command: "chmod +x .git/hooks/pre-push" }, "Bash naming a hooks file", ["hooks_write"]],
    ["Write", { file_path: "/home/o/.claude/CLAUDE.md", content: "" }, "Write ~/.claude/", ["settings_write"]],
    ["Write", { file_path: "/work/settings.json", content: "" }, "Write a settings*.json file", ["settings_write"]],
    ["Write", { file_path: "/work/.git/hooks/pre-commit", content: "" }, "Write a hooks file", ["hooks_write"]],
    ["Edit", { file_path: "/home/o/.claude/CLAUDE.md" }, "Edit ~/.claude/", ["settings_write"]],
    ["Edit", { file_path: "/work/settings.json" }, "Edit a settings*.json file", ["settings_write"]],
    ["Edit", { file_path: "/work/hooks.json" }, "Edit a hooks file", ["hooks_write"]],
    ["NotebookEdit", { notebook_path: "/home/o/.claude/x.ipynb" }, "NotebookEdit ~/.claude/", ["settings_write"]],
    ["NotebookEdit", { notebook_path: "/work/settings.json" }, "NotebookEdit a settings*.json file", ["settings_write"]],
    ["NotebookEdit", { notebook_path: "/work/.git/hooks/x.ipynb" }, "NotebookEdit a hooks file", ["hooks_write"]],
  ];

  it("maps every outward label the rail emits for Bash, Write, Edit and NotebookEdit to its categories, and every category is reachable", () => {
    for (const [tool, input, action, categories] of LABELS) {
      const c = classifyToolCall(tool, input, rail);
      expect(c, JSON.stringify(input)).toMatchObject({ kind: "outward", action });
      expect(neverCategoriesOf(action), action).toEqual(categories);
    }
    const reached = new Set(LABELS.flatMap(([, , action]) => neverCategoriesOf(action)));
    expect(NEVER_CATEGORIES.filter((c) => !reached.has(c))).toEqual([]);
  });

  it("maps the ALWAYS_HELD_TOOLS actions, a merge and any other text to no category", () => {
    for (const tool of ALWAYS_HELD_TOOLS) {
      const c = classifyToolCall(tool, {}, rail);
      expect(c.kind, tool).toBe("outward");
      if (c.kind === "outward") expect(neverCategoriesOf(c.action), tool).toEqual([]);
    }
    for (const text of ["kernel_playbook_enable", "kernel_agent_create", "kernel_agent_update", "gh pr merge", "git", "gh api", "Read ~/.claude/", ""]) {
      expect(neverCategoriesOf(text), text).toEqual([]);
    }
  });

  it("answers no boundary for every outward call when the policy has no never, or an empty one", () => {
    for (const [tool, input] of LABELS) {
      const c = classifyToolCall(tool, input, rail);
      if (c.kind !== "outward") throw new Error(`not outward: ${JSON.stringify(input)}`);
      for (const policy of [{ allowedTools: [], allowedBashPrefixes: [] }, { allowedTools: [], allowedBashPrefixes: [], never: [] }] as ToolPolicy[]) {
        expect(boundaryDecision(policy, c)).toEqual({ kind: "none" });
      }
    }
  });

  it("answers a boundary with the call's category when never names it, and none when never names only other categories", () => {
    for (const [tool, input, , categories] of LABELS) {
      const c = classifyToolCall(tool, input, rail);
      if (c.kind !== "outward") throw new Error(`not outward: ${JSON.stringify(input)}`);
      for (const category of categories) {
        expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [], never: [category] }, c), `${c.action} ${category}`).toEqual({ kind: "boundary", category });
      }
      const others = NEVER_CATEGORIES.filter((n) => !categories.includes(n));
      expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [], never: others }, c), c.action).toEqual({ kind: "none" });
    }
    // The reported category is the first match in NEVER_CATEGORIES order, whatever order never lists them in.
    const alias = classifyToolCall("Bash", { command: "git -c alias.p=push p" }, rail);
    if (alias.kind !== "outward") throw new Error("not outward");
    expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [], never: ["alias_define", "git_push"] }, alias)).toEqual({ kind: "boundary", category: "git_push" });
    // ALWAYS_HELD_TOOLS are never inside a boundary, whatever never names.
    const create = classifyToolCall("mcp__kernel__kernel_agent_create", {}, rail);
    if (create.kind !== "outward") throw new Error("not outward");
    expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [], never: [...NEVER_CATEGORIES] }, create)).toEqual({ kind: "none" });
  });

  it("records the other forms a call reads only when they add a category (alsoReads), and the boundary checks every one", () => {
    const at = (tool: string, input: unknown) => classifyToolCall(tool, input, rail);
    // Two labels in one category: no alsoReads, so the class is exactly what it was.
    const settings = { file_path: "/home/o/.claude/settings.json", content: "" };
    expect(at("Write", settings)).toEqual({ kind: "outward", action: "Write ~/.claude/", payload: { tool: "Write", input: settings, cwd: "/work" } });
    // A hooks file under ~/.claude/: settings_write by its action, hooks_write by its other label.
    const hooks = { file_path: "/home/o/.claude/hooks/x.sh", content: "" };
    const multi = at("Write", hooks);
    expect(multi).toEqual({ kind: "outward", action: "Write ~/.claude/", payload: { tool: "Write", input: hooks, cwd: "/work" }, alsoReads: ["Write a hooks file"] });
    // gh reads a flag both ways: `-b` taking `create` (a comment) or not (a create).
    expect(at("Bash", { command: "gh pr -b create comment 3" })).toMatchObject({ action: "gh pr comment", alsoReads: ["gh pr create"] });
    // An inline alias beside a push adds alias_define; a path naming ~/.claude/ adds settings_write.
    expect(at("Bash", { command: "git -c alias.x=y push" })).toMatchObject({ action: "git push", alsoReads: ["git alias"] });
    expect(at("Bash", { command: "git push /home/o/.claude/x" })).toMatchObject({ action: "git push", alsoReads: ["Bash naming ~/.claude/"] });
    // Several git push forms (a glob could be any of them) add nothing beyond git_push.
    expect(at("Bash", { command: "git *" })).not.toHaveProperty("alsoReads");
    const cases: [ReturnType<typeof at>, NeverCategory][] = [
      [multi, "hooks_write"],
      [at("Bash", { command: "gh pr -b create comment 3" }), "gh_pr_create"],
      [at("Bash", { command: "git -c alias.x=y push" }), "alias_define"],
      [at("Bash", { command: "git push /home/o/.claude/x" }), "settings_write"],
    ];
    for (const [c, category] of cases) {
      if (c.kind !== "outward") throw new Error("not outward");
      expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [], never: [category] }, c), c.action).toEqual({ kind: "boundary", category });
    }
  });

  it("names the category in the deny reason and tells the model not to ask for an approval or retry", () => {
    expect(boundaryDenyReason("git_push")).toBe(
      "agent_boundary: git_push is in this agent's never list. The owner's settings forbid it for this agent; it did not run. Do not ask for an approval and do not retry it.",
    );
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

  it("is the closed list of tools every call to which is held: kernel_playbook_enable, then the two charter tools", () => {
    expect(ALWAYS_HELD_TOOLS).toEqual(["mcp__kernel__kernel_playbook_enable", "mcp__kernel__kernel_agent_create", "mcp__kernel__kernel_agent_update"]);
    expect(Object.isFrozen(ALWAYS_HELD_TOOLS)).toBe(true);
  });

  it("classifies kernel_agent_create and kernel_agent_update as outward whatever their input; kernel_agent_list and kernel_agent_message stay ordinary", () => {
    for (const name of ["kernel_agent_create", "kernel_agent_update"]) {
      for (const input of [{ id: "mason" }, {}, null]) {
        expect(classifyToolCall(`mcp__kernel__${name}`, input, rail)).toEqual({
          kind: "outward",
          action: name,
          payload: { tool: `mcp__kernel__${name}`, input, cwd: "/work" },
        });
      }
    }
    for (const name of ["mcp__kernel__kernel_agent_list", "mcp__kernel__kernel_agent_message", "mcp__kernel__kernel_agent_createx"]) {
      expect(classifyToolCall(name, {}, rail), name).toEqual({ kind: "ordinary" });
    }
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
