import { describe, expect, it } from "vitest";
import { PROPOSED_ALLOWED_TOOLS } from "../src/brain/index.js";
import { decideToolUse, freezePolicy } from "../src/sessions/index.js";
import { DRAFT_PAYLOAD_KINDS, MAX_DRAFT_TEXT_CHARS, draftDecision, draftPayloadOf, githubCliDecision } from "../src/sessions/draft-mode.js";
import { ALWAYS_HELD_TOOLS, GITHUB_WRITE_TOOLS, MAX_RAIL_COMMAND_LENGTH, NEVER_CATEGORIES, boundaryDecision, boundaryDenyReason, classifyToolCall, neverCategoriesOf, programCouldBe, safeRunFileCreation } from "../src/sessions/policy.js";
import type { NeverCategory } from "../src/sessions/policy.js";
import type { ToolPolicy } from "../src/sessions/index.js";
import { LOOMWRIGHT_DRIVER_ARGUMENTS, LOOMWRIGHT_DRIVER_PROFILES } from "../src/sessions/loomwright-scripts.js";
import type { LoomwrightDriverProfile } from "../src/sessions/loomwright-scripts.js";

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

  it("copies loomwrightScripts (frozen) when present, and never a caller's admittedScriptPaths, mode, connectors or githubWrite", () => {
    const names = ["automate-next-step.sh"];
    const given = { allowedTools: [], allowedBashPrefixes: [], loomwrightScripts: names, admittedScriptPaths: ["/x/scripts/evil.sh"], mode: "live", connectors: ["github"], githubWrite: true } as ToolPolicy;
    const frozen = freezePolicy(given);
    names.push("other.sh");
    expect(frozen.loomwrightScripts).toEqual(["automate-next-step.sh"]);
    expect(Object.isFrozen(frozen.loomwrightScripts)).toBe(true);
    expect(Object.keys(frozen)).toEqual(["allowedTools", "allowedBashPrefixes", "loomwrightScripts"]);
    expect(decideToolUse(frozen, "Bash", { command: "bash /x/scripts/evil.sh" })).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
  });
});

// AC15 (phase 8 item 22g): a run policy admits Loomwright's driver scripts by exact path only. On `main` 1a4a77b1
// both reproductions below were denied `bash_prefix_not_allowed` under AUTOMATE_RUN_POLICY: the policy had no way
// to name them, and `bash` is never a prefix. The admitted set is the session manager's (`admittedScriptPaths`).
describe("decideToolUse: Loomwright driver scripts by exact path (AC15)", () => {
  const install = "/Users/o/.claude/plugins/cache/atelier/loomwright/17.38.0";
  const next = `${install}/scripts/automate-next-step.sh`;
  const helpers = `${install}/scripts/automate-helpers.sh`;
  // AUTOMATE_RUN_POLICY's grants, with the manager's admitted set filled as a run session's would be.
  const run: ToolPolicy = { allowedTools: ["Bash", "Read"], allowedBashPrefixes: ["git status", "gh pr"], loomwrightScripts: ["automate-next-step.sh", "automate-helpers.sh"], admittedScriptPaths: [next, helpers] };
  const runBash = (command: string) => decideToolUse(run, "Bash", { command });

  it("admits `bash <driver> --resume …` and `bash <helpers> meta-entry` (the two calls denied on main), unquoted or double-quoted", () => {
    expect(runBash(`bash ${next} --resume /w/o-r/.supervisor/automate --run latest`)).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(runBash(`bash ${helpers} meta-entry`)).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(runBash(`bash ${next}`)).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    expect(runBash(`bash "${next}" --resume /w/o-r/.supervisor/automate`)).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    // The prefixes still answer as before.
    expect(runBash("git status")).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
  });

  it("the same calls are denied without an admitted set: the name list alone admits nothing", () => {
    const named: ToolPolicy = { allowedTools: run.allowedTools, allowedBashPrefixes: run.allowedBashPrefixes, loomwrightScripts: run.loomwrightScripts ?? [] };
    for (const command of [`bash ${next} --resume /w`, `bash ${helpers} meta-entry`]) {
      expect(decideToolUse(named, "Bash", { command }), command).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    }
  });

  it("denies a driver path followed by a shell metacharacter: the metacharacter check runs first", () => {
    for (const command of [`bash ${next} $(touch x)`, `bash ${next}; touch x`, `bash ${next} --resume /w | sh`, `bash ${next} && rm x`, `bash "${next}" \`id\``, `bash ${next} > /tmp/x`]) {
      expect(runBash(command), command).toEqual({ decision: "deny", reason: "bash_shell_metacharacter" });
    }
  });

  it("denies any other bash command, a path outside the admitted set, a `..` or a near-miss spelling", () => {
    for (const command of [
      "bash",
      "bash -c id",
      `bash -x ${next}`,
      `bash  ${next}`,
      `bash\t${next}`,
      `sh ${next}`,
      `${next} --resume /w`,
      `bash ${install}/scripts/`,
      `bash ${install}/scripts/automate-wave.sh`,
      `bash ${install}/scripts/../scripts/automate-next-step.sh`,
      `bash ${install}/scripts/./automate-next-step.sh`,
      `bash ${install}/scripts//automate-next-step.sh`,
      `bash ${next}x`,
      `bash ${next}.bak`,
      `bash /tmp/automate-next-step.sh`,
      "bash automate-next-step.sh",
      `bash '${next}'`,
      `bash "${next}"x`,
      `bash "${next}`,
      `bash ${next}\t--resume`,
    ]) {
      expect(runBash(command), command).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    }
  });

  it("denies an admitted script's merging, pushing or spawning subcommand however it is spelled (review iteration 1)", () => {
    const meta = `${install}/scripts/meta-sync.sh`;
    const both: ToolPolicy = { ...run, admittedScriptPaths: [next, helpers, meta] };
    const bash = (command: string) => decideToolUse(both, "Bash", { command });
    // The reproduction: the plugin's one `gh pr merge --squash` is `gate-eval`, reading a ctx file the session can write.
    for (const command of [
      `bash ${helpers} gate-eval https://github.com/o/r/pull/1 /tmp/ctx.json --root /x`,
      `bash "${helpers}" gate-eval https://github.com/o/r/pull/1 /tmp/ctx.json`,
      `bash ${helpers}  gate-eval https://github.com/o/r/pull/1 /tmp/ctx.json`,
      `bash ${helpers} \tgate-eval x y`,
      `bash ${helpers} trail-pr /w/run.md --reason done`,
      `bash ${helpers} closeout /w/run.md item https://github.com/o/r/pull/1`,
      `bash ${helpers} closeout-others /w/.supervisor/automate`,
      `bash ${helpers} finalize-empty /w/run.md`,
      `bash ${helpers} wave-build /w/run.md`,
      `bash ${helpers} lane-launch /w-lanes/r/L1 --owner-command x`,
      `bash ${helpers} lane-create /w/run.md item 1`,
      `bash ${helpers} phase-launch x`,
      `bash ${helpers} lane-convert-ready /w-lanes/r/L1`,
      // A spelling bash would turn into a denied name is refused too (fail closed).
      `bash ${helpers} "gate-eval" x y`,
      `bash ${helpers} 'gate-eval' x y`,
      `bash ${helpers} gate\\-eval x y`,
      `bash ${helpers} gate-ev?l x y`,
      `bash ${helpers} gate-eva[l] x y`,
      `bash ${helpers} {gate-eval,} x y`,
      `bash ${helpers} gate"-eval" x y`,
      // meta-sync.sh reads its subcommand at any position.
      `bash ${meta} push`,
      `bash ${meta} --root /w push`,
      `bash ${meta} --root "/w" status`,
    ]) {
      expect(bash(command), command).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    }
    // The legitimate calls still run: the drivers, the start's own helper calls, and a denied name as a later argument of automate-helpers.sh.
    // (`--merge-parked` is no longer one of them under this ticket-run profile: review iteration 2, below.)
    for (const command of [
      `bash ${next} --resume /w/.supervisor/automate --run latest`,
      `bash ${helpers} meta-entry`,
      `bash ${helpers} lane-info`,
      `bash ${helpers} resume-glob /w/.supervisor/automate --finalize`,
      `bash ${helpers} progress-append /w/run.md "closeout gate-eval trail-pr"`,
      `bash ${helpers}`,
      `bash ${meta} pull --root /w`,
      `bash ${meta} status`,
    ]) {
      expect(bash(command), command).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    }
  });
});

// Review iteration 2: the driver takes `--mode`, `--trust-unprotected` and `--merge-parked` from its own argv and feeds
// them to `gate-eval` (Loomwright 17.38.0 `automate-next-step.sh`), so each run policy's profile refuses the ones its
// run must never pass, however spelled.
describe("decideToolUse: automate-next-step.sh's merge, mode and trust options by policy profile (review iteration 2)", () => {
  const install = "/Users/o/.claude/plugins/cache/atelier/loomwright/17.38.0";
  const next = `${install}/scripts/automate-next-step.sh`;
  const review = `${install}/scripts/review-heal-next-step.sh`;
  const runFile = "/w/.supervisor/automate/r1.md";
  const policyOf = (profile?: LoomwrightDriverProfile): ToolPolicy => ({
    allowedTools: ["Bash"],
    allowedBashPrefixes: [],
    loomwrightScripts: ["automate-next-step.sh", "review-heal-next-step.sh"],
    admittedScriptPaths: [next, review],
    ...(profile === undefined ? {} : { loomwrightDriverProfile: profile }),
    // A merge run is always launched pinned to its parked run (review iteration 3).
    ...(profile === "merge_parked" || profile === "merge_parked_trust_unprotected" ? { loomwrightRunId: "r1" } : {}),
  });
  const decide = (profile: LoomwrightDriverProfile | undefined, command: string) => decideToolUse(policyOf(profile), "Bash", { command });
  const ALLOW = { decision: "allow", reason: "bash_prefix_allowed" };
  const DENY = { decision: "deny", reason: "bash_prefix_not_allowed" };

  /** Each option written every way bash would still pass it to the driver. */
  const spellings = (option: string, value = ""): string[] => {
    const v = value === "" ? "" : ` ${value}`;
    return [
      `${option}${v}`,
      `"${option}"${v}`,
      `'${option}'${v}`,
      `${option.slice(0, 3)}"${option.slice(3)}"${v}`,
      `${option.slice(0, 3)}\\${option.slice(3)}${v}`,
      ...(value === "" ? [`${option}=true`] : [`${option}=${value}`]),
    ];
  };

  it("the ticket run (automate_run, and a policy naming no profile) never takes --merge-parked, --trust-unprotected, --auto-merge or a mode but safe", () => {
    const denied = [
      // The reviewer's reproductions.
      `--merge-parked /w/.supervisor/automate --run r1 --session-id s`,
      `${runFile} --start pick --mode auto-merge --session-id s`,
      `--resume /w/.supervisor/automate --run latest --session-id s --mode auto-merge`,
      `${runFile} --result '{"answers":["ok"]}' --trust-unprotected`,
      `${runFile} --start run --mode safe --trust-unprotected --session-id s`,
      ...spellings("--merge-parked", "/w/.supervisor/automate").map((a) => `${a} --run r1 --session-id s`),
      ...spellings("--trust-unprotected").map((a) => `${runFile} --start run --mode safe ${a}`),
      ...spellings("--auto-merge").map((a) => `${runFile} --start run ${a}`),
      ...spellings("--mode", "auto-merge").map((a) => `${runFile} --start run ${a}`),
      `${runFile} --start run --mode "auto-merge"`,
      `${runFile} --start run --mode auto-mer\\ge`,
      `${runFile} --start run --mode=safe`,
      `${runFile} --start run --mode`,
      `${runFile} --start run --mode '' safe`,
      // Unreadable words fail closed: glob, brace, tilde, unterminated quote, trailing backslash.
      `${runFile} --start run --trust-unprotecte?`,
      `${runFile} --start run --trust-unprotecte[d]`,
      `${runFile} --start run {--trust-unprotected,}`,
      `${runFile} --start run --mode safe ~`,
      `${runFile} --start run "--mode safe`,
      `${runFile} --start run \\`,
      `${runFile} --start run --session-id s1 # --trust-unprotected`,
      `${runFile} --start run ^--mode`,
      `${runFile} --start run --trust-unprotecte!`,
    ];
    for (const profile of [undefined, "automate_run"] as const) {
      for (const args of denied) expect(decide(profile, `bash ${next} ${args}`), `${profile} ${args}`).toEqual(DENY);
      expect(decide(profile, `bash "${next}" --merge-parked /w/.supervisor/automate --run r1 --session-id s`), `${profile} quoted path`).toEqual(DENY);
      // The ticket run's own calls (skills/automate-loop SKILL.md "Coordinator loop", per-item-loop.md): start, pick, run, report, answer.
      for (const args of [
        "",
        "--resume /w/.supervisor/automate --session-id s1",
        "--resume /w/.supervisor/automate --run latest --session-id s1 --inline-phases",
        `${runFile} --start pick --session-id s1`,
        `${runFile} --start run --mode safe --session-id s1 --inline-phases`,
        `${runFile} --start run --mode "safe" --session-id s1`,
        `${runFile} --result '{"answers":["continue"],"note":"--mode auto-merge is not asked for"}' --mode safe --session-id s1`,
        `${runFile} --result-file /w/.supervisor/automate/r1.drain.json --mode safe --non-interactive --session-id s1`,
        `${runFile} --owner-command '/loomwright:automate --backlog /w/plan.md --inline-phases' --session-id s1`,
      ]) {
        expect(decide(profile, `bash ${next} ${args}`.trimEnd()), `${profile} ${args}`).toEqual(ALLOW);
      }
    }
  });

  it("the merge run (merge_parked) takes only its --merge-parked entry and the answer calls: never --start, --resume, --mode, --auto-merge or a session-added --trust-unprotected", () => {
    const denied = [
      // The reviewer's reproductions: the per-item loop's own entries with auto-merge, and a session-added trust flag.
      `${runFile} --start pick --mode auto-merge --session-id s`,
      `--resume /w/.supervisor/automate --run r1 --session-id s --mode auto-merge`,
      `--merge-parked /w/.supervisor/automate --run r1 --session-id s --trust-unprotected`,
      `${runFile} --start pick --session-id s`,
      `--resume /w/.supervisor/automate --run r1 --session-id s`,
      `--merge-parked /w/.supervisor/automate --run r1 --session-id s --mode safe`,
      ...spellings("--start", "pick").map((a) => `${runFile} ${a} --session-id s`),
      ...spellings("--resume", "/w/.supervisor/automate").map((a) => `${a} --run r1 --session-id s`),
      ...spellings("--trust-unprotected").map((a) => `--merge-parked /w/.supervisor/automate --run r1 --session-id s ${a}`),
      ...spellings("--auto-merge").map((a) => `--merge-parked /w/.supervisor/automate --run r1 --session-id s ${a}`),
      ...spellings("--mode", "auto-merge").map((a) => `${runFile} --result '{"answers":["merge"]}' ${a}`),
    ];
    for (const args of denied) expect(decide("merge_parked", `bash ${next} ${args}`), args).toEqual(DENY);
    // The call `/loomwright:automate --merge-parked <run_id>` makes (SKILL.md "Coordinator loop" step 1; resume.md
    // "Merging one parked item"), and the answer to an ask it prints, on the run file.
    for (const args of [
      "--merge-parked .supervisor/automate --run r1 --session-id s1",
      "--merge-parked /w/.supervisor/automate --run r1 --session-id s1 --root /w",
      `${runFile} --result '{"answers":["keep parked"]}' --session-id s1`,
    ]) {
      expect(decide("merge_parked", `bash ${next} ${args}`), args).toEqual(ALLOW);
    }
  });

  it("the trusted merge run (merge_parked_trust_unprotected) also takes --trust-unprotected, the flag its prompt carried, and nothing else more", () => {
    for (const args of [
      "--merge-parked .supervisor/automate --run r1 --session-id s1 --trust-unprotected",
      `${runFile} --result '{"answers":["keep parked"]}' --session-id s1 --trust-unprotected`,
      "--merge-parked .supervisor/automate --run r1 --session-id s1",
    ]) {
      expect(decide("merge_parked_trust_unprotected", `bash ${next} ${args}`), args).toEqual(ALLOW);
    }
    for (const args of [
      `${runFile} --start pick --trust-unprotected --session-id s`,
      "--resume /w/.supervisor/automate --run r1 --session-id s --trust-unprotected",
      "--merge-parked .supervisor/automate --run r1 --session-id s --mode auto-merge",
      "--merge-parked .supervisor/automate --run r1 --session-id s --auto-merge",
    ]) {
      expect(decide("merge_parked_trust_unprotected", `bash ${next} ${args}`), args).toEqual(DENY);
    }
  });

  it("reads only automate-next-step.sh's arguments: review-heal-next-step.sh (which never merges) keeps its own options", () => {
    for (const profile of [undefined, "automate_run", "merge_parked"] as const) {
      expect(decide(profile, `bash ${review} --pr https://github.com/o/r/pull/7 --until-mergeable --mode x`), String(profile)).toEqual(ALLOW);
    }
  });

  it("the profiles are a closed, frozen kernel constant", () => {
    expect(LOOMWRIGHT_DRIVER_PROFILES).toEqual(["automate_run", "merge_parked", "merge_parked_trust_unprotected"]);
    expect(Object.isFrozen(LOOMWRIGHT_DRIVER_ARGUMENTS)).toBe(true);
    for (const p of LOOMWRIGHT_DRIVER_PROFILES) {
      expect(Object.isFrozen(LOOMWRIGHT_DRIVER_ARGUMENTS[p]) && Object.isFrozen(LOOMWRIGHT_DRIVER_ARGUMENTS[p].denied), p).toBe(true);
      expect(LOOMWRIGHT_DRIVER_ARGUMENTS[p].denied, p).toContain("--auto-merge");
    }
    expect(LOOMWRIGHT_DRIVER_ARGUMENTS.automate_run.denied).toEqual(expect.arrayContaining(["--merge-parked", "--trust-unprotected"]));
    expect(LOOMWRIGHT_DRIVER_ARGUMENTS.merge_parked.denied).toEqual(expect.arrayContaining(["--start", "--resume", "--trust-unprotected"]));
    expect(LOOMWRIGHT_DRIVER_ARGUMENTS.merge_parked_trust_unprotected.denied).not.toContain("--trust-unprotected");
  });

  it("freezePolicy copies the profile only when present", () => {
    expect(freezePolicy({ allowedTools: [], allowedBashPrefixes: [], loomwrightDriverProfile: "merge_parked" }).loomwrightDriverProfile).toBe("merge_parked");
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
      "gh_pr_request_reviewers",
      "gh_pr_comment_reply",
      "gh_issue_create",
      "gh_issue_comment",
      "gh_issue_edit",
      "gh_issue_close",
      "gh_api_write",
      "mcp_write",
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
    // An MCP connector's non-read-only proxy tool (phase 8 item 06): the kernel fixed the `kernel_mcp_w_` name from its stored row.
    ["mcp__kernel__kernel_mcp_w_jira_create_issue", { arguments_json: '{"summary":"x"}' }, "mcp_write", ["mcp_write"]],
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
    // The kernel's GitHub write tools (phase 8 item 05): outward by name, the action is the name without `mcp__kernel__`.
    ["mcp__kernel__kernel_github_pr_reply", { repo: "o/r", pr: 3, comment_id: 9, body: "x" }, "kernel_github_pr_reply", ["gh_pr_comment_reply"]],
    ["mcp__kernel__kernel_github_pr_comment", { repo: "o/r", pr: 3, body: "x" }, "kernel_github_pr_comment", ["gh_pr_comment"]],
    ["mcp__kernel__kernel_github_issue_comment", { repo: "o/r", issue: 3, body: "x" }, "kernel_github_issue_comment", ["gh_issue_comment"]],
    ["mcp__kernel__kernel_github_pr_request_reviewers", { repo: "o/r", pr: 3, reviewers: ["a"] }, "kernel_github_pr_request_reviewers", ["gh_pr_request_reviewers"]],
  ];

  it("maps every outward label the rail emits for Bash, Write, Edit and NotebookEdit, and the four GitHub write tools, to its categories, and every category is reachable", () => {
    for (const [tool, input, action, categories] of LABELS) {
      const c = classifyToolCall(tool, input, rail);
      expect(c, JSON.stringify(input)).toMatchObject({ kind: "outward", action });
      expect(neverCategoriesOf(action), action).toEqual(categories);
    }
    const reached = new Set(LABELS.flatMap(([, , action]) => neverCategoriesOf(action)));
    expect(NEVER_CATEGORIES.filter((c) => !reached.has(c))).toEqual([]);
  });

  it("classifies each GitHub write tool outward with the tool's own payload, and not as an always-held tool", () => {
    expect(Object.keys(GITHUB_WRITE_TOOLS)).toEqual([
      "mcp__kernel__kernel_github_pr_reply",
      "mcp__kernel__kernel_github_pr_comment",
      "mcp__kernel__kernel_github_issue_comment",
      "mcp__kernel__kernel_github_pr_request_reviewers",
    ]);
    expect(Object.isFrozen(GITHUB_WRITE_TOOLS)).toBe(true);
    const input = { repo: "o/r", pr: 3, reviewers: ["alice"] };
    for (const name of Object.keys(GITHUB_WRITE_TOOLS)) {
      expect(ALWAYS_HELD_TOOLS, name).not.toContain(name);
      expect(classifyToolCall(name, input, rail), name).toEqual({
        kind: "outward",
        action: name.replace("mcp__kernel__", ""),
        payload: { tool: name, input, cwd: "/work" },
      });
    }
    // The read tools and a look-alike name are ordinary, whatever their input.
    for (const name of ["mcp__kernel__kernel_github_pr_get", "mcp__kernel__kernel_github_pr_comments", "mcp__kernel__kernel_github_pr_reply_x", "kernel_github_pr_reply"]) {
      expect(classifyToolCall(name, input, rail).kind, name).toBe("ordinary");
    }
    // Inherited property names are not tool names.
    expect(classifyToolCall("constructor", input, rail).kind).toBe("ordinary");
  });

  it("holds every MCP proxy tool that is not provably read-only as mcp_write, and lets only kernel_mcp_r_ through", () => {
    const payload = (tool: string, input: unknown) => ({ tool, input, cwd: "/work" });
    // The `w` prefix, and every other `kernel_mcp_` name (the rail fails closed on the prefix, not on a `w`).
    for (const name of ["kernel_mcp_w_jira_create_issue", "kernel_mcp_w_clickup_x", "kernel_mcp_jira_create_issue", "kernel_mcp_x_jira_a", "kernel_mcp_", "kernel_mcp_R_jira_a", "kernel_mcp_read_jira_a"]) {
      const full = `mcp__kernel__${name}`;
      expect(classifyToolCall(full, { arguments_json: "{}" }, rail), name).toEqual({ kind: "outward", action: "mcp_write", payload: payload(full, { arguments_json: "{}" }) });
    }
    // A read-only proxy (the server's hint, kept in the kernel's row) and a tool of another namespace stay ordinary.
    for (const name of ["mcp__kernel__kernel_mcp_r_jira_get_issue", "mcp__kernel__kernel_mcp_r_clickup_x", "mcp__other__kernel_mcp_w_jira_x", "kernel_mcp_w_jira_x", "mcp__kernel__kernel_github_pr_get"]) {
      expect(classifyToolCall(name, {}, rail), name).toEqual({ kind: "ordinary" });
    }
    // Not an always-held tool: the owner's per-playbook "always" may cover it, so it is in no ALWAYS_HELD list.
    expect(ALWAYS_HELD_TOOLS.some((t) => t.includes("kernel_mcp_"))).toBe(false);
  });

  it("denies an mcp_write call agent_boundary when the policy's never lists it, and holds it otherwise", () => {
    const c = classifyToolCall("mcp__kernel__kernel_mcp_w_jira_create_issue", {}, rail);
    if (c.kind !== "outward") throw new Error("not outward");
    expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [], never: ["mcp_write"] }, c)).toEqual({ kind: "boundary", category: "mcp_write" });
    expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [], never: ["git_push", "gh_api_write"] }, c)).toEqual({ kind: "none" });
    expect(boundaryDecision({ allowedTools: [], allowedBashPrefixes: [] }, c)).toEqual({ kind: "none" });
    expect(boundaryDenyReason("mcp_write")).toContain("mcp_write is in this agent's never list");
  });

  it("maps the ALWAYS_HELD_TOOLS actions, a merge and any other text to no category", () => {
    for (const tool of ALWAYS_HELD_TOOLS) {
      const c = classifyToolCall(tool, {}, rail);
      expect(c.kind, tool).toBe("outward");
      if (c.kind === "outward") expect(neverCategoriesOf(c.action), tool).toEqual([]);
    }
    for (const text of ["kernel_playbook_enable", "kernel_agent_create", "kernel_agent_update", "mcp__kernel__kernel_github_pr_reply", "kernel_github_pr_get", "gh pr merge", "git", "gh api", "Read ~/.claude/", ""]) {
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

describe("a live, write-granted policy gets the same rail answers (phase 8 item 04)", () => {
  const rail = { dataDir: "/data", homeDir: "/home/o", cwd: "/work" };
  const liveWrite: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["git", "gh"], mode: "live", connectors: ["github"], githubWrite: true };

  it("keeps git push outward and every gh pr merge form merge_blocked: githubWrite changes only the use_kernel_github_tools deny", () => {
    expect(classifyToolCall("Bash", { command: "git push origin feature" }, rail)).toMatchObject({ kind: "outward", action: "git push" });
    for (const merge of ["gh pr merge 1", "gh pr merge 1 --squash --delete-branch", "gh --repo a/b pr merge 1"]) {
      expect(decideToolUse(liveWrite, "Bash", { command: merge }), merge).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
      expect(classifyToolCall("Bash", { command: merge }, rail), merge).toEqual({ kind: "deny", reason: "merge_blocked" });
    }
    expect(githubCliDecision(liveWrite, "Bash", { command: "gh pr view 1" })).toBeUndefined();
    expect(githubCliDecision({ ...liveWrite, githubWrite: false }, "Bash", { command: "gh pr view 1" })).toEqual({ kind: "deny" });
    expect(githubCliDecision({ ...liveWrite, githubWrite: undefined }, "Bash", { command: "gh pr view 1" })).toEqual({ kind: "deny" });
  });
});

describe("ALWAYS_HELD_TOOLS (phase 3 foundation)", () => {
  const rail = { dataDir: "/data", homeDir: "/home/o", cwd: "/work" };

  it("is the closed list of tools every call to which is held: kernel_playbook_enable, the two charter tools, the merge approval (phase 8 item 09), then the run's gate question (D44)", () => {
    expect(ALWAYS_HELD_TOOLS).toEqual([
      "mcp__kernel__kernel_playbook_enable",
      "mcp__kernel__kernel_agent_create",
      "mcp__kernel__kernel_agent_update",
      "mcp__kernel__kernel_merge_approval_request",
      "AskUserQuestion",
    ]);
    expect(Object.isFrozen(ALWAYS_HELD_TOOLS)).toBe(true);
  });

  it("classifies AskUserQuestion as outward whatever its input, filing {tool, input, cwd}; it is in no never category and a near name stays ordinary (D44)", () => {
    const input = { questions: [{ header: "Gate", question: "Process the queue?", options: [{ label: "Process" }, { label: "Skip" }], multiSelect: false }] };
    for (const i of [input, {}, null]) {
      expect(classifyToolCall("AskUserQuestion", i, rail)).toEqual({ kind: "outward", action: "AskUserQuestion", payload: { tool: "AskUserQuestion", input: i, cwd: "/work" } });
    }
    expect(neverCategoriesOf("AskUserQuestion")).toEqual([]);
    for (const near of ["askuserquestion", "AskUserQuestionx", "mcp__kernel__AskUserQuestion"]) {
      expect(classifyToolCall(near, input, rail), near).toEqual({ kind: "ordinary" });
    }
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

  it("classifies kernel_merge_approval_request as outward whatever its input, filing {tool, input, cwd}; it is neither a GitHub write tool nor in any never category (phase 8 item 09)", () => {
    const name = "mcp__kernel__kernel_merge_approval_request";
    for (const input of [{ repo: "o/r", pr: 7, head_sha: "a".repeat(40), ci: "green", ready_at: "2026-11-08T04:56:42Z" }, {}, null]) {
      expect(classifyToolCall(name, input, rail)).toEqual({
        kind: "outward",
        action: "kernel_merge_approval_request",
        payload: { tool: name, input, cwd: "/work" },
      });
    }
    // Held, never "always": it is in ALWAYS_HELD_TOOLS, so no per-playbook grant covers it, and it is not a GitHub write tool a grant could cover.
    expect(ALWAYS_HELD_TOOLS).toContain(name);
    expect(Object.keys(GITHUB_WRITE_TOOLS)).not.toContain(name);
    expect(neverCategoriesOf("kernel_merge_approval_request")).toEqual([]);
    for (const near of ["mcp__kernel__kernel_merge_approval_requestx", "kernel_merge_approval_request", "mcp__other__kernel_merge_approval_request"]) {
      expect(classifyToolCall(near, {}, rail), near).toEqual({ kind: "ordinary" });
    }
    // The merge itself stays blocked for every session.
    expect(classifyToolCall("Bash", { command: "gh pr merge 7" }, rail)).toEqual({ kind: "deny", reason: "merge_blocked" });
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

// ---- Draft mode and the GitHub CLI deny (phase 6 item 07): the pure decisions ----

describe("programCouldBe", () => {
  it("reads the program as the rail does: first non-empty brace-expanded word, its basename, case-folded, as a glob", () => {
    for (const command of ["gh pr view 1", "/usr/bin/gh pr view 1", "GH pr view 1", "g{h,x} pr view 1", "{,} gh pr view 1", "g? pr view 1", "gh pr view 1 | cat"]) {
      expect(programCouldBe(command, "gh"), command).toBe(true);
    }
  });

  it("does not take a later word, another program, or a program that runs gh", () => {
    for (const command of ["echo gh", "ghx pr view 1", "env gh pr view 1", "sh -c 'gh pr view 1'", "git gh", "", "   "]) {
      expect(programCouldBe(command, "gh"), command).toBe(false);
    }
  });
});

describe("draftDecision and githubCliDecision", () => {
  const base: ToolPolicy = { allowedTools: [], allowedBashPrefixes: ["gh"] };
  const outward = classifyToolCall("Bash", { command: "gh pr comment 1 --body x" }, { dataDir: "/data", homeDir: "/home/u", cwd: "/work" });

  it("draftDecision drafts an outward call only when the policy's mode is draft", () => {
    if (outward.kind !== "outward") throw new Error("expected outward");
    expect(draftDecision({ ...base, mode: "draft" }, outward)).toEqual({ kind: "draft", action: "gh pr comment", call: outward });
    expect(draftDecision({ ...base, mode: "live" }, outward)).toEqual({ kind: "none" });
    expect(draftDecision(base, outward)).toEqual({ kind: "none" });
  });

  it("githubCliDecision denies a Bash gh call only with the github grant", () => {
    const granted: ToolPolicy = { ...base, connectors: ["github"] };
    expect(githubCliDecision(granted, "Bash", { command: "gh pr view 1" })).toEqual({ kind: "deny" });
    expect(githubCliDecision(granted, "Bash", { command: "/usr/bin/gh pr view 1" })).toEqual({ kind: "deny" });
    expect(githubCliDecision(granted, "Bash", { command: "git status" })).toBeUndefined();
    expect(githubCliDecision(granted, "Bash", { command: 7 })).toBeUndefined();
    expect(githubCliDecision(granted, "Bash", undefined)).toBeUndefined();
    expect(githubCliDecision(granted, "Read", { command: "gh pr view 1" })).toBeUndefined();
    // Over the rail's size limit: denied unread (never parsed), only in a granted session.
    const big = "{".repeat(MAX_RAIL_COMMAND_LENGTH + 1);
    expect(githubCliDecision(granted, "Bash", { command: big })).toEqual({ kind: "deny" });
    expect(githubCliDecision(base, "Bash", { command: big })).toBeUndefined();
    expect(githubCliDecision(base, "Bash", { command: "gh pr view 1" })).toBeUndefined();
    expect(githubCliDecision({ ...base, connectors: [] }, "Bash", { command: "gh pr view 1" })).toBeUndefined();
  });
});

describe("draftPayloadOf", () => {
  const ctx = { dataDir: "/data", homeDir: "/home/u", cwd: "/work" };
  const payloadOf = (command: string) => {
    const rail = classifyToolCall("Bash", { command }, ctx);
    if (rail.kind !== "outward") throw new Error(`expected outward: ${command}`);
    return draftPayloadOf("Bash", { command }, rail);
  };

  it("the closed kinds are exactly the four", () => {
    expect(DRAFT_PAYLOAD_KINDS).toEqual(["gh_pr_review", "gh_pr_comment", "command", "input"]);
  });

  it("reads a review's target, body and verdict", () => {
    expect(payloadOf('gh pr review 12 --approve --body "LGTM"')).toEqual({
      kind: "gh_pr_review", tool: "Bash", command: 'gh pr review 12 --approve --body "LGTM"', cwd: "/work", target: "12", body: "LGTM", event: "approve", truncated: false,
    });
    expect(payloadOf("gh pr review 3 -r -b 'fix it'")).toMatchObject({ target: "3", body: "fix it", event: "request_changes" });
    expect(payloadOf("gh pr review 3 --comment")).toMatchObject({ target: "3", body: null, event: "comment" });
    expect(payloadOf("gh pr review 3 -a")).toMatchObject({ event: "approve" });
  });

  it("reads --body=, -bX, -F file and -R o/r (a repo flag's value is not the target)", () => {
    expect(payloadOf("gh pr comment 5 --body=hello")).toMatchObject({ kind: "gh_pr_comment", target: "5", body: "hello" });
    expect(payloadOf("gh pr comment 5 -bhello")).toMatchObject({ target: "5", body: "hello" });
    expect(payloadOf("gh pr comment 5 -F notes.md")).toMatchObject({ target: "5", body: null, body_file: "notes.md" });
    expect(payloadOf("gh pr comment 5 --body-file=notes.md")).toMatchObject({ body_file: "notes.md" });
    expect(payloadOf("gh pr comment -R o/r 5 --body x")).toMatchObject({ target: "5", body: "x" });
    expect(payloadOf("gh pr comment --repo o/r --body x 5")).toMatchObject({ target: "5", body: "x" });
    expect(payloadOf("gh -R o/r pr comment 5 --body x")).toMatchObject({ target: "5", body: "x" });
  });

  it("takes the last body, records no target when none is named, and never reads a body file", () => {
    expect(payloadOf("gh pr comment 5 -b one -b two")).toMatchObject({ body: "two" });
    expect(payloadOf("gh pr comment --body x")).toMatchObject({ target: null, body: "x" });
    expect(payloadOf("gh pr comment 5 -F /does/not/exist")).toMatchObject({ body: null, body_file: "/does/not/exist" });
    // A comment has no verdict flag: -c is not an event there.
    expect(payloadOf("gh pr comment 5 -c")).not.toHaveProperty("event");
  });

  it("records any other outward Bash call as a command, and another tool's input as JSON text", () => {
    expect(payloadOf("git push origin main")).toEqual({ kind: "command", tool: "Bash", command: "git push origin main", cwd: "/work", truncated: false });
    expect(payloadOf("gh pr close 3")).toMatchObject({ kind: "command" });
    const rail = classifyToolCall("mcp__kernel__kernel_playbook_enable", { id: 1 }, ctx);
    if (rail.kind !== "outward") throw new Error("expected outward");
    expect(draftPayloadOf("mcp__kernel__kernel_playbook_enable", { id: 1 }, rail)).toEqual({
      kind: "input", tool: "mcp__kernel__kernel_playbook_enable", input_json: '{"id":1}', cwd: "/work", truncated: false,
    });
  });

  it("cuts a text past MAX_DRAFT_TEXT_CHARS and sets truncated", () => {
    const rail = classifyToolCall("mcp__kernel__kernel_agent_create", { x: "y".repeat(MAX_DRAFT_TEXT_CHARS) }, ctx);
    if (rail.kind !== "outward") throw new Error("expected outward");
    const payload = draftPayloadOf("mcp__kernel__kernel_agent_create", { x: "y".repeat(MAX_DRAFT_TEXT_CHARS) }, rail);
    expect(payload).toMatchObject({ kind: "input", truncated: true });
    expect((payload as { input_json: string }).input_json).toHaveLength(MAX_DRAFT_TEXT_CHARS);
  });
});

describe("decideToolUse: a merge run acts on its own parked run only (review iteration 3)", () => {
  const install = "/Users/o/.claude/plugins/cache/atelier/loomwright/17.38.0";
  const next = `${install}/scripts/automate-next-step.sh`;
  const policyOf = (profile: LoomwrightDriverProfile, runId?: string): ToolPolicy => ({
    allowedTools: ["Bash"],
    allowedBashPrefixes: [],
    loomwrightScripts: ["automate-next-step.sh"],
    admittedScriptPaths: [next],
    loomwrightDriverProfile: profile,
    ...(runId === undefined ? {} : { loomwrightRunId: runId }),
  });
  const decide = (policy: ToolPolicy, args: string) => decideToolUse(policy, "Bash", { command: `bash ${next} ${args}` });
  const ALLOW = { decision: "allow", reason: "bash_prefix_allowed" };
  const DENY = { decision: "deny", reason: "bash_prefix_not_allowed" };
  const RUN = "automate-2026-11-16-040506";

  it("admits the pinned run's entry and its answer calls, under both merge profiles", () => {
    for (const profile of ["merge_parked", "merge_parked_trust_unprotected"] as const) {
      const p = policyOf(profile, RUN);
      for (const args of [
        `--merge-parked .supervisor/automate --run ${RUN} --session-id s1`,
        `--session-id s1 /w/.supervisor/automate/${RUN}.md --result '{"answers":["keep parked"]}'`,
        `/w/.supervisor/automate/${RUN}.md --result '{"answers":["keep parked"]}' --session-id s1`,
        `.supervisor/automate/${RUN}.md --result '{"answers":["keep parked"]}' --session-id s1`,
      ]) {
        expect(decide(p, args), `${profile} ${args}`).toEqual(ALLOW);
      }
    }
  });

  it("denies any other run: another --run value, another run file, or a second --run", () => {
    const p = policyOf("merge_parked", RUN);
    for (const args of [
      "--merge-parked .supervisor/automate --run automate-2026-11-15-143719 --session-id s1",
      "--merge-parked .supervisor/automate --run=automate-2026-11-15-143719 --session-id s1",
      `--merge-parked .supervisor/automate --run ${RUN} --run automate-2026-11-15-143719 --session-id s1`,
      "--merge-parked .supervisor/automate --run latest --session-id s1",
      "--merge-parked .supervisor/automate --run --session-id s1",
      `/w/.supervisor/automate/automate-2026-11-15-143719.md --result '{"answers":["merge"]}' --session-id s1`,
      `/w/.supervisor/automate/${RUN}.md.bak --result '{"answers":["merge"]}' --session-id s1`,
      `/w/.supervisor/automate/x${RUN}.md --result '{"answers":["merge"]}' --session-id s1`,
      // The driver takes its one run file at ANY position (17.38.0 argument loop), so it is read after an option too.
      `--session-id s1 /w/.supervisor/automate/automate-2026-11-15-143719.md --result '{"answers":["merge"]}'`,
      `--result '{"answers":["merge"]}' --session-id s1 /w/.supervisor/automate/automate-2026-11-15-143719.md`,
      `--merge-parked .supervisor/automate --run ${RUN} --session-id s1 /w/.supervisor/automate/automate-2026-11-15-143719.md`,
      // An option the driver does not know could take a value and hide a run file: refused.
      `--frobnicate ${RUN} /w/.supervisor/automate/${RUN}.md --result x`,
      `--run=${RUN} --merge-parked .supervisor/automate --session-id s1`,
      // A value option with no value.
      `/w/.supervisor/automate/${RUN}.md --result`,
    ]) {
      expect(decide(p, args), args).toEqual(DENY);
    }
  });

  it("fails closed without a pin: a merge profile with no run id admits no --run and no run file", () => {
    for (const profile of ["merge_parked", "merge_parked_trust_unprotected"] as const) {
      const p = policyOf(profile);
      expect(decide(p, `--merge-parked .supervisor/automate --run ${RUN} --session-id s1`)).toEqual(DENY);
      expect(decide(p, `/w/.supervisor/automate/${RUN}.md --result '{"answers":["keep parked"]}'`)).toEqual(DENY);
      // A malformed pin (the manager refuses one at start) reads as no pin.
      expect(decide(policyOf(profile, "../x"), "--merge-parked .supervisor/automate --run ../x --session-id s1")).toEqual(DENY);
    }
  });

  it("leaves the ticket run unpinned: its driver mints its own run id", () => {
    const p = policyOf("automate_run");
    expect(decide(p, "--resume /w/.supervisor/automate --session-id s1")).toEqual(ALLOW);
    expect(decide(p, "/w/.supervisor/automate/automate-2026-11-15-143719.md --start pick --session-id s1")).toEqual(ALLOW);
  });

  it("freezePolicy keeps the pin, and the pin is copied only when present", () => {
    expect(freezePolicy(policyOf("merge_parked", RUN)).loomwrightRunId).toBe(RUN);
    expect("loomwrightRunId" in freezePolicy(policyOf("merge_parked"))).toBe(false);
  });
});

describe("decideToolUse: Loomwright run state is written by Loomwright's scripts only (review iteration 3)", () => {
  const install = "/Users/o/.claude/plugins/cache/atelier/loomwright/17.38.0";
  const helpers = `${install}/scripts/automate-helpers.sh`;
  const runPolicy: ToolPolicy = {
    allowedTools: ["Read", "Write", "Edit", "NotebookEdit", "Bash"],
    allowedBashPrefixes: ["git checkout", "git stash", "git add", "git status", "git show", "gh pr", "mkdir", "cat", "grep", "jq", "ls", "head"],
    loomwrightScripts: ["automate-helpers.sh"],
    admittedScriptPaths: [helpers],
  };
  const plain: ToolPolicy = { ...runPolicy, loomwrightScripts: [], admittedScriptPaths: [] };
  const RUN_STATE = { decision: "deny", reason: "loomwright_run_state" };
  const RUN_FILE = "/w/.supervisor/automate/automate-2026-11-16-040506.md";

  it("denies a Write, Edit or NotebookEdit of a run file or a driver sidecar, however the path is spelled", () => {
    for (const path of [
      RUN_FILE,
      "/w/.supervisor/automate/automate-2026-11-16-040506-L2.md",
      "/w/.supervisor/automate/automate-2026-11-16-040506.next-step.json",
      ".supervisor/automate/automate-2026-11-16-040506.md",
      "/w/.Supervisor/Automate/AUTOMATE-2026-11-16-040506.MD",
      "/w/.supervisor/automate/sub/../automate-2026-11-16-040506.md",
      "/w/.supervisor/x/../automate/r1.next-step.json",
      // A run id may hold a `.` (LOOMWRIGHT_RUN_ID): every `.md` there counts but the phase result hand-offs.
      "/w/.supervisor/automate/run.v2.md",
      "/w/.supervisor/automate/automate-2026-11-16-040506.md.bak.md",
    ]) {
      for (const [tool, field] of [["Write", "file_path"], ["Edit", "file_path"], ["NotebookEdit", "notebook_path"]] as const) {
        expect(decideToolUse(runPolicy, tool, { [field]: path, content: "- mode: auto-merge | trust_unprotected: true" }), `${tool} ${path}`).toEqual(RUN_STATE);
      }
    }
  });

  it("still allows the run's other writes: result sidecars, briefs, requirements and code", () => {
    for (const path of [
      "/w/.supervisor/automate/automate-2026-11-16-040506.supervisor-result.md",
      "/w/.supervisor/automate/automate-2026-11-16-040506.review-heal-result.md",
      "/w/.supervisor/automate/automate-2026-11-16-040506.launch-pad-result.md",
      "/w/.supervisor/jobs/pending/brief.md",
      "/w/.supervisor/requirements/item.md",
      "/w/automate/r1.md",
      "/w/kernel/src/sessions/policy.ts",
    ]) {
      expect(decideToolUse(runPolicy, "Write", { file_path: path, content: "x" }), path).toEqual({ decision: "allow", reason: "tool_allowed" });
    }
    expect(decideToolUse(runPolicy, "Read", { file_path: RUN_FILE })).toEqual({ decision: "allow", reason: "tool_allowed" });
  });

  it("denies a git or gh command that names run state, and lets read-only programs read it", () => {
    for (const command of [
      `git checkout loomwright-meta -- ${RUN_FILE}`,
      "git checkout main -- .supervisor",
      "git checkout main -- ./.supervisor/",
      "git checkout main -- .supervisor/auto*",
      "git checkout main -- .supervisor/{automate,jobs}",
      "git stash push .supervisor/automate",
      "git checkout main -- '*.md'",
      "git checkout main -- **/*.next-step.json",
      "git checkout main -- :!kernel",
      "git checkout main -- :/",
      "git stash push -- 'auto?ate'",
    ]) {
      expect(decideToolUse(runPolicy, "Bash", { command }), command).toEqual(RUN_STATE);
    }
    for (const command of [`cat ${RUN_FILE}`, "grep -n mode .supervisor/automate/r1.md", "jq . .supervisor/automate/r1.next-step.json", "ls .supervisor/automate", "head -5 .supervisor/automate/r1.md", "git status", "git add kernel/src/x.ts", "git add .supervisor/jobs/done/brief.md", "mkdir -p .supervisor/automate", "git checkout -b feature/x", "git show HEAD:kernel/src/x.ts"]) {
      expect(decideToolUse(runPolicy, "Bash", { command }), command).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    }
  });

  it("lets Loomwright's own admitted scripts write the run file", () => {
    expect(decideToolUse(runPolicy, "Bash", { command: `bash ${helpers} current-set ${RUN_FILE} --pause-reason null` })).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
  });

  it("applies only to a Loomwright run policy: a session with no Loomwright scripts is unchanged", () => {
    expect(decideToolUse(plain, "Write", { file_path: RUN_FILE, content: "x" })).toEqual({ decision: "allow", reason: "tool_allowed" });
    expect(decideToolUse(plain, "Bash", { command: `git checkout main -- ${RUN_FILE}` })).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
  });

  it("never widens a policy: a tool or prefix the policy does not grant is still denied for its own reason", () => {
    const narrow: ToolPolicy = { ...runPolicy, allowedTools: ["Read"], allowedBashPrefixes: [] };
    expect(decideToolUse(narrow, "Write", { file_path: RUN_FILE, content: "x" })).toEqual({ decision: "deny", reason: "tool_not_allowed" });
    expect(decideToolUse(narrow, "Bash", { command: `git checkout main -- ${RUN_FILE}` })).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
  });
});

describe("run-lock.sh: a run session never breaks the lock (invariant 4, review iteration 3)", () => {
  const install = "/Users/o/.claude/plugins/cache/atelier/loomwright/17.38.0";
  const lock = `${install}/scripts/run-lock.sh`;
  const policy: ToolPolicy = { allowedTools: ["Bash"], allowedBashPrefixes: [], loomwrightScripts: ["run-lock.sh"], admittedScriptPaths: [lock] };
  const decide = (args: string) => decideToolUse(policy, "Bash", { command: `bash ${lock} ${args}` });

  it("denies --force-unlock at any position and as --force-unlock=", () => {
    for (const args of ["release --owner automate:r1 --force-unlock", "--force-unlock acquire --owner automate:r1", "acquire --owner automate:r1 --session-id s1 --force-unlock=1"]) {
      expect(decide(args), args).toEqual({ decision: "deny", reason: "bash_prefix_not_allowed" });
    }
  });

  it("still admits the lock's ordinary calls", () => {
    for (const args of ["acquire --owner automate:r1 --session-id s1", "release --owner automate:r1", "status", "liveness --pid 42"]) {
      expect(decide(args), args).toEqual({ decision: "allow", reason: "bash_prefix_allowed" });
    }
  });
});

describe("safeRunFileCreation: a new run's first run file, safe mode only (review iteration 3)", () => {
  const RF = "/w/.supervisor/automate/automate-2026-11-16-040506.md";
  const runFile = (config: string, extra = ""): string =>
    ["# Automate Run: phase-8-22", "## Status: running", "## Source", "- folder .supervisor/requirements/x", "## Run Config", config,
      "- auto_review_original: absent | config_backup: r.config-backup.json", "## Queue", "- [ ] .supervisor/requirements/x/a.md", "## Current",
      "- item: null | status: null | pr: null | branch: null", "- pause_reason: null", extra, "## Progress", "- 2026-11-16T04:05:06Z run created"].join("\n");
  const SAFE = "- mode: safe | limit: 5 | trust_unprotected: false";

  it("reads the template's safe-mode file as a creation, at an absolute path or one relative to an absolute cwd", () => {
    expect(safeRunFileCreation("Write", { file_path: RF, content: runFile(SAFE) }, undefined)).toBe(RF);
    expect(safeRunFileCreation("Write", { file_path: ".supervisor/automate/r1.md", content: runFile(SAFE) }, "/w")).toBe("/w/.supervisor/automate/r1.md");
    expect(safeRunFileCreation("Write", { file_path: RF, content: runFile("- mode: safe | limit: 5") }, undefined)).toBe(RF);
  });

  it("refuses any content the driver would read as more than safe mode, or a READY head it did not write", () => {
    for (const config of [
      "- mode: auto-merge | limit: 5 | trust_unprotected: false",
      "- mode: safe | limit: 5 | trust_unprotected: true",
      "- mode: safe | limit: 5 | trust_unprotected: yes",
      "- limit: 5 | trust_unprotected: false",
      "- mode:  | limit: 5",
    ]) {
      expect(safeRunFileCreation("Write", { file_path: RF, content: runFile(config) }, undefined), config).toBeUndefined();
    }
    // The driver takes the FIRST `- mode: ` line of the section: a safe second line does not help.
    expect(safeRunFileCreation("Write", { file_path: RF, content: runFile(`- mode: auto-merge | limit: 5\n${SAFE}`) }, undefined)).toBeUndefined();
    expect(safeRunFileCreation("Write", { file_path: RF, content: runFile(SAFE, "- ready_sha: abc | ready_at: 2026-11-16T04:05:06Z | termination_reason: converged") }, undefined)).toBeUndefined();
    expect(safeRunFileCreation("Write", { file_path: RF, content: "# Automate Run: x\n## Status: running\n## Queue" }, undefined)).toBeUndefined();
  });

  it("is a Write of a run file only: never Edit or NotebookEdit, a sidecar, a result file, a relative path without a cwd, or another path", () => {
    expect(safeRunFileCreation("Edit", { file_path: RF, old_string: "a", new_string: runFile(SAFE) }, undefined)).toBeUndefined();
    expect(safeRunFileCreation("Write", { file_path: "/w/.supervisor/automate/r1.next-step.json", content: runFile(SAFE) }, undefined)).toBeUndefined();
    expect(safeRunFileCreation("Write", { file_path: "/w/.supervisor/automate/r1.supervisor-result.md", content: runFile(SAFE) }, undefined)).toBeUndefined();
    expect(safeRunFileCreation("Write", { file_path: ".supervisor/automate/r1.md", content: runFile(SAFE) }, undefined)).toBeUndefined();
    expect(safeRunFileCreation("Write", { file_path: "/w/notes.md", content: runFile(SAFE) }, undefined)).toBeUndefined();
  });
});
