// What a catalogue job's work needs (phase 8 item 20c, subtask 1):
//   AC1 every job declares its needs and `resolveJobNeeds` returns all five parts;
//   AC2 a Loomwright command's needs come from the active install's contract
//       where it declares them, else from the pinned `LOOMWRIGHT_COMMAND_NEEDS`;
//   AC6 a job added to `TOOL_JOB_DEFINITIONS` without needs fails a runtime
//       test (`npm test` is `vitest run` and does not typecheck);
//   D44 `automate_tickets` needs no `Skill` and no shell prefix: the kernel
//       starts `/loomwright:automate` under its own frozen policy;
//   D45 (item 22g, AC5) likewise `triage_pr_comments` and `ask_for_merge`:
//       the kernel starts `/loomwright:review-pr` and `--merge-parked`.
// The code is `kernel/src/features/job-needs.ts` and the declarations in
// `kernel/src/features/catalogue.ts`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOOL_JOB_DEFINITIONS, TOOL_JOB_IDS, TOOL_JOBS, buildToolCatalogue, jobNeedsTicketSource, jobNeedsWorkspace } from "../src/features/catalogue.js";
import type { ToolCatalogue } from "../src/features/catalogue.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import {
  BASH_PREFIX_LABELS,
  CLAUDE_TOOL_LABELS,
  LOOMWRIGHT_COMMAND_NEEDS,
  NEVER_ACTION_LABELS,
  UNKNOWN_CLAUDE_TOOL_LABEL,
  bashPrefixHeld,
  commandNeedsTable,
  jobNeedsGaps,
  loadCommandNeeds,
  resolveJobNeeds,
} from "../src/features/job-needs.js";
import type { CommandNeeds, LoomwrightCommandNeedsTable } from "../src/features/job-needs.js";
import { AUTOMATE_RUN_POLICY, MERGE_PARKED_RUN_POLICY, REVIEW_PR_RUN_POLICY } from "../src/automate/launch.js";
import { GITHUB_WRITE_TOOLS, NEVER_CATEGORIES, neverCategoriesAdmitted } from "../src/sessions/policy.js";
import { parseLoomwrightContract } from "../src/loomwright/contract.js";
import type { LoomwrightContractEntry } from "../src/loomwright/contract.js";
import { fixtureContract, writeLoomwrightInstall } from "./fixtures/loomwright/helpers.js";

const TOOLS = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;
const PINNED: ToolCatalogue = buildToolCatalogue(TOOLS, LOOMWRIGHT_COMMAND_NEEDS);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The commands of a contract fixture with `needs` added to the `review-pr` entry (or to none). */
function contractCommands(needs?: unknown, name = "review-pr"): readonly LoomwrightContractEntry[] {
  const raw = fixtureContract();
  const commands = (raw.commands as Record<string, unknown>[]).map((c) => (c.name === name && needs !== undefined ? { ...c, needs } : c));
  return parseLoomwrightContract(JSON.stringify({ ...raw, commands }), "/install").commands;
}

describe("AC1 and AC6: every job declares what its work needs", () => {
  it("AC6: every TOOL_JOB_IDS job has a needs declaration of the five parts (a job added without one fails here, at run time)", () => {
    expect(TOOL_JOB_IDS.length).toBeGreaterThan(0);
    for (const id of TOOL_JOB_IDS) {
      const needs = (TOOL_JOB_DEFINITIONS[id] as unknown as { needs?: Record<string, unknown> }).needs;
      expect(needs, `${id} declares no needs`).toBeDefined();
      for (const field of ["claudeTools", "bashPrefixes", "connectors", "loomwrightCommands"]) expect(Array.isArray(needs?.[field]), `${id}.needs.${field}`).toBe(true);
      expect(typeof needs?.workspace, `${id}.needs.workspace`).toBe("boolean");
      for (const n of [...((needs?.claudeTools as { name: string; label: string }[]) ?? []), ...((needs?.bashPrefixes as { name: string; label: string }[]) ?? [])]) {
        expect(n.name, id).not.toBe("");
        expect(n.label, id).not.toBe("");
        expect(n.label, `${id}: a plain-words label, not the raw name`).not.toBe(n.name);
      }
    }
  });

  it("AC1: resolveJobNeeds returns all five parts for every job; kernel tools are the catalogue's tools of the job, never a second list", () => {
    for (const id of TOOL_JOB_IDS) {
      const needs = resolveJobNeeds(id, PINNED);
      expect(needs.job).toBe(id);
      expect(needs.label).toBe(TOOL_JOBS[id]);
      expect(needs.kernelTools, id).toEqual(PINNED.tools.filter((t) => t.job === id).map((t) => `mcp__kernel__${t.name}`));
      for (const part of [needs.claudeTools, needs.bashPrefixes, needs.connectors, needs.commands]) expect(Array.isArray(part), id).toBe(true);
      expect(typeof needs.workspace, id).toBe("boolean");
      expect(needs.workspace, id).toBe(jobNeedsWorkspace(id));
    }
    // Without a catalogue there are no kernel tools to list, and the rest still resolves.
    expect(resolveJobNeeds("read_pr").kernelTools).toEqual([]);
    expect(resolveJobNeeds("automate_tickets").workspace).toBe(true);
  });

  it("a job's connector needs include its tools' (write for the ticket, triage and merge jobs) from the catalogue, not a second declaration", () => {
    for (const id of ["automate_tickets", "triage_pr_comments", "ask_for_merge"] as const) {
      expect(resolveJobNeeds(id, PINNED).connectors.some((c) => c.kind === "github" && c.write && c.source === "tool"), id).toBe(true);
    }
    expect(resolveJobNeeds("read_pr", PINNED).connectors.every((c) => !c.write)).toBe(true);
  });

  it("every Loomwright command a job declares has a pinned row, and the pinned table is stamped and frozen", () => {
    for (const id of TOOL_JOB_IDS) {
      for (const invocation of TOOL_JOB_DEFINITIONS[id].needs.loomwrightCommands) expect(LOOMWRIGHT_COMMAND_NEEDS[invocation], `${id}: ${invocation}`).toBeDefined();
    }
    expect(Object.isFrozen(LOOMWRIGHT_COMMAND_NEEDS)).toBe(true);
    for (const row of Object.values(LOOMWRIGHT_COMMAND_NEEDS)) expect(Object.isFrozen(row)).toBe(true);
  });

  it("the plain-words labels name no raw tool: every declared Claude tool and prefix has a label that is not its name", () => {
    for (const [name, label] of Object.entries(CLAUDE_TOOL_LABELS)) expect(label, name).not.toContain(name);
    for (const [prefix, label] of Object.entries(BASH_PREFIX_LABELS)) expect(label, prefix).not.toBe(prefix);
    for (const row of Object.values(LOOMWRIGHT_COMMAND_NEEDS)) {
      for (const n of [...row.claudeTools, ...row.bashPrefixes]) expect(n.label, `${row.invocation}: ${n.name}`).not.toBe(n.name);
    }
  });
});

describe("D44: which commands a job's crew must hold the tools for", () => {
  it("'Hand tickets to /automate' holds no Skill and no shell prefix: the kernel starts /automate under its own policy", () => {
    const needs = resolveJobNeeds("automate_tickets", PINNED);
    expect(needs.claudeTools).toEqual([]);
    expect(needs.bashPrefixes).toEqual([]);
    expect(needs.commands.map((c) => [c.invocation, c.launch])).toEqual([["/loomwright:automate", "kernel"]]);
    // The row is truthful about what the run asks for; it is just not a crew need.
    expect(LOOMWRIGHT_COMMAND_NEEDS["/loomwright:automate"]?.claudeTools.map((n) => n.name)).toContain("Skill");
  });

  it("D45: triage and merge reach kernel-launched commands too, so their crew holds no Skill and no shell prefix", () => {
    for (const [id, invocation] of [["triage_pr_comments", "/loomwright:review-pr"], ["ask_for_merge", "/loomwright:automate --merge-parked"]] as const) {
      const needs = resolveJobNeeds(id, PINNED);
      expect(needs.commands.map((c) => [c.invocation, c.launch]), id).toEqual([[invocation, "kernel"]]);
      expect(needs.claudeTools, id).toEqual([]);
      expect(needs.bashPrefixes, id).toEqual([]);
      // The row stays truthful about what the command asks for; it is the kernel's, never a crew need.
      expect(LOOMWRIGHT_COMMAND_NEEDS[invocation]?.claudeTools.map((n) => n.name), id).toContain("Skill");
    }
  });

  it("AC5: no job's needs include Skill, Agent, Bash or a Loomwright shell prefix, and no command row is crew-launched", () => {
    const prefixes = new Set(Object.values(LOOMWRIGHT_COMMAND_NEEDS).flatMap((r) => r.bashPrefixes.map((p) => p.name)));
    for (const id of TOOL_JOB_IDS) {
      const needs = resolveJobNeeds(id, PINNED);
      expect(needs.claudeTools.map((n) => n.name).filter((n) => ["Skill", "Agent", "Bash"].includes(n)), id).toEqual([]);
      expect(needs.bashPrefixes.filter((p) => [...prefixes].some((lw) => bashPrefixHeld([p.name], lw) || bashPrefixHeld([lw], p.name))), id).toEqual([]);
      for (const c of needs.commands) expect(c.launch, `${id}: ${c.invocation}`).toBe("kernel");
    }
    for (const row of Object.values(LOOMWRIGHT_COMMAND_NEEDS)) expect(row.launch, row.invocation).toBe("kernel");
  });
});

describe("AC2: contract first, the pinned table where the contract declares nothing", () => {
  it("a contract with no `needs` anywhere resolves to the pinned rows, and its entries parse exactly as before", () => {
    const commands = contractCommands();
    for (const c of commands) expect(Object.keys(c).sort(), c.name).toEqual(["description", "name"]);
    expect(commandNeedsTable(commands)).toEqual(LOOMWRIGHT_COMMAND_NEEDS);
    expect(commandNeedsTable(undefined)).toBe(LOOMWRIGHT_COMMAND_NEEDS);
  });

  it("a contract that declares needs for review-pr overrides that command's pinned row only", () => {
    const table = commandNeedsTable(contractCommands({ claude_tools: ["Read"], bash_prefixes: ["git diff"], connectors: [{ kind: "github", write: true }], workspace: false }));
    const row = table["/loomwright:review-pr"];
    expect(row?.claudeTools.map((n) => n.name)).toEqual(["Read"]);
    expect(row?.bashPrefixes.map((n) => n.name)).toEqual(["git diff"]);
    expect(row?.connectors).toEqual([{ kind: "github", write: true }]);
    expect(row?.workspace).toBe(false);
    expect(row?.launch).toBe("kernel"); // launch is the kernel's own fact (D44, D45), never the contract's
    expect(table["/loomwright:automate"]).toBe(LOOMWRIGHT_COMMAND_NEEDS["/loomwright:automate"]);
    expect(table["/loomwright:automate --merge-parked"]).toBe(LOOMWRIGHT_COMMAND_NEEDS["/loomwright:automate --merge-parked"]);
  });

  it("the resolved needs follow the table the catalogue carries: a contract's declaration for a kernel-launched command stays the kernel's, never the job's", () => {
    const table = commandNeedsTable(contractCommands({ claude_tools: ["Skill", "Read"], bash_prefixes: ["git push"] }));
    expect(table["/loomwright:review-pr"]?.claudeTools.map((n) => n.name)).toEqual(["Skill", "Read"]);
    const viaContract = resolveJobNeeds("triage_pr_comments", buildToolCatalogue(TOOLS, table));
    expect(viaContract.claudeTools).toEqual([]);
    expect(viaContract.bashPrefixes).toEqual([]);
    expect(viaContract.commands.map((c) => [c.invocation, c.launch, c.claudeTools.map((n) => n.name)])).toEqual([["/loomwright:review-pr", "kernel", ["Skill", "Read"]]]);
    // A catalogue built without a table resolves to the pinned rows.
    expect(resolveJobNeeds("triage_pr_comments", buildToolCatalogue(TOOLS)).commands).toEqual(resolveJobNeeds("triage_pr_comments", PINNED).commands);
  });

  it("a contract that declares needs for `automate` changes the kernel-launched row's needs but they stay the kernel's, not the ticket job's", () => {
    const table = commandNeedsTable(contractCommands({ claude_tools: ["Skill", "Agent"] }, "automate"));
    expect(table["/loomwright:automate"]?.claudeTools.map((n) => n.name)).toEqual(["Skill", "Agent"]);
    expect(resolveJobNeeds("automate_tickets", buildToolCatalogue(TOOLS, table)).claudeTools).toEqual([]);
    // Both automate rows read the contract's `automate` entry.
    expect(table["/loomwright:automate --merge-parked"]?.claudeTools.map((n) => n.name)).toEqual(["Skill", "Agent"]);
  });

  it("a malformed `needs` is ignored for that command and is never a contract error", () => {
    for (const bad of ["x", 3, [], { claude_tools: "Skill" }, { claude_tools: [1] }, { bash_prefixes: [""] }, { connectors: [{ kind: 7 }] }, { connectors: "github" }, { workspace: "yes" }, { connectors: [{ kind: "github", write: "y" }] }]) {
      const commands = contractCommands(bad);
      expect(commands.find((c) => c.name === "review-pr")?.needs, JSON.stringify(bad)).toBeUndefined();
      expect(commandNeedsTable(commands), JSON.stringify(bad)).toEqual(LOOMWRIGHT_COMMAND_NEEDS);
    }
  });

  it("a declaration with only some fields is a whole declaration: the omitted ones are empty (an empty `needs` says the command needs nothing)", () => {
    const commands = contractCommands({});
    expect(commands.find((c) => c.name === "review-pr")?.needs).toEqual({ claude_tools: [], bash_prefixes: [], connectors: [], workspace: false });
    expect(commandNeedsTable(commands)["/loomwright:review-pr"]?.claudeTools).toEqual([]);
  });

  it("a declared Claude tool the kernel has no words for gets a generic label, never its raw name; an unknown connector kind is dropped", () => {
    const table = commandNeedsTable(contractCommands({ claude_tools: ["NewTool"], connectors: [{ kind: "carrier-pigeon", write: true }, { kind: "jira", write: false }] }));
    const row = table["/loomwright:review-pr"];
    expect(row?.claudeTools).toEqual([{ name: "NewTool", label: UNKNOWN_CLAUDE_TOOL_LABEL }]);
    expect(row?.connectors).toEqual([{ kind: "jira", write: false }]);
  });

  it("loadCommandNeeds reads the active install's contract once and is fail-safe: no install, a bad contract or a throwing resolver is the pinned table", () => {
    const root = mkdtempSync(join(tmpdir(), "job-needs-"));
    dirs.push(root);
    const withNeeds = fixtureContract();
    (withNeeds.commands as Record<string, unknown>[]).forEach((c) => {
      if (c.name === "review-pr") c.needs = { claude_tools: ["Read"] };
    });
    const install = writeLoomwrightInstall(join(root, "with-needs"), withNeeds);
    expect(loadCommandNeeds({ configured: install })["/loomwright:review-pr"]?.claudeTools.map((n) => n.name)).toEqual(["Read"]);
    // No needs declared there: the pinned rows.
    expect(loadCommandNeeds({ configured: writeLoomwrightInstall(join(root, "plain")) })).toEqual(LOOMWRIGHT_COMMAND_NEEDS);
    // No contract, a bad configured path and no installed_plugins.json are all the pinned table.
    expect(loadCommandNeeds({ configured: writeLoomwrightInstall(join(root, "none"), null) })).toBe(LOOMWRIGHT_COMMAND_NEEDS);
    expect(loadCommandNeeds({ configured: join(root, "missing") })).toBe(LOOMWRIGHT_COMMAND_NEEDS);
    expect(loadCommandNeeds({ installedPluginsPath: join(root, "no-such-installed_plugins.json") })).toBe(LOOMWRIGHT_COMMAND_NEEDS);
    expect(loadCommandNeeds({}, () => {
      throw new Error("boom");
    })).toBe(LOOMWRIGHT_COMMAND_NEEDS);
  });
});

describe("the needs-vs-policy comparison readiness and fit share", () => {
  // No shipped row is crew-launched (D45); the `crew` mechanism is still compared, on a test table that marks review-pr so.
  const crewRow = LOOMWRIGHT_COMMAND_NEEDS["/loomwright:review-pr"] as CommandNeeds;
  const CREW_TABLE: LoomwrightCommandNeedsTable = { ...LOOMWRIGHT_COMMAND_NEEDS, "/loomwright:review-pr": { ...crewRow, launch: "crew" } };
  const triage = resolveJobNeeds("triage_pr_comments", buildToolCatalogue(TOOLS, CREW_TABLE));
  const none = { allowedTools: [] as string[], allowedBashPrefixes: [] as string[] };

  it("the shipped triage job lacks nothing a charter must hold: the kernel starts its fix (D45)", () => {
    expect(jobNeedsGaps(resolveJobNeeds("triage_pr_comments", PINNED), none)).toEqual([]);
    expect(jobNeedsGaps(resolveJobNeeds("ask_for_merge", PINNED), none)).toEqual([]);
  });

  it("a member holding nothing lacks each Claude tool and prefix a crew-launched command needs, in plain words and as gaps no charter should close", () => {
    const gaps = jobNeedsGaps(triage, none);
    expect(gaps.filter((g) => g.kind === "claude_tool").map((g) => g.name)).toEqual(["Skill", "Bash", "Agent"]);
    expect(gaps.filter((g) => g.kind === "bash_prefix").map((g) => g.name)).toEqual(["git diff", "git commit", "git push", "gh pr"]);
    for (const g of gaps) {
      expect(g.job).toBe("triage_pr_comments");
      expect(g.closable).toBe(false);
      expect(g.command).toBe("/loomwright:review-pr");
      expect(g.label).not.toBe(g.name);
    }
    expect(gaps.find((g) => g.name === "Skill")?.label).toBe("run skills");
  });

  it("holding the tools and a word-boundary prefix closes a gap; `git` holds `git push`, `git pu` does not", () => {
    expect(bashPrefixHeld(["git"], "git push")).toBe(true);
    expect(bashPrefixHeld(["git push"], "git push")).toBe(true);
    expect(bashPrefixHeld(["git pu"], "git push")).toBe(false);
    expect(bashPrefixHeld(["gh"], "git push")).toBe(false);
    const all = jobNeedsGaps(triage, { allowedTools: ["Skill", "Bash", "Agent"], allowedBashPrefixes: ["git", "gh pr"] });
    expect(all).toEqual([]);
  });

  it("the ticket job lacks nothing a charter must hold: the kernel's launch policy covers the rest", () => {
    expect(jobNeedsGaps(resolveJobNeeds("automate_tickets", PINNED), none)).toEqual([]);
  });

  it("connectors and the workspace are compared only when the caller asks (readiness and fit already check the tools' own)", () => {
    const tickets = resolveJobNeeds("automate_tickets", PINNED);
    expect(jobNeedsGaps(tickets, none)).toEqual([]);
    const gaps = jobNeedsGaps(tickets, { ...none, connectors: { connectors: ["github"], githubWrite: false }, workspace: false });
    expect(gaps.map((g) => [g.kind, g.label, g.closable, g.source])).toEqual([
      ["connector", "GitHub write access", false, "tool"],
      ["workspace", "a copy of a repo to work in", false, undefined],
    ]);
    expect(jobNeedsGaps(tickets, { ...none, connectors: { connectors: ["github"], githubWrite: true }, workspace: true })).toEqual([]);
  });

  it("a Claude tool the job itself declares (not a command's) is a gap a charter change can close", () => {
    const declared = { ...resolveJobNeeds("read_pr", PINNED), claudeTools: [{ name: "WebFetch", label: "fetch web pages", closable: true }] };
    expect(jobNeedsGaps(declared, none).map((g) => [g.name, g.closable])).toEqual([["WebFetch", true]]);
  });
});

// ---- Item 25g: a kernel run's outward needs, derived from its run policy, against the member's never list ----------------

describe("item 25g: neverCategoriesAdmitted reads a policy's outward reach through the rail's own labels", () => {
  const admits = (allowedBashPrefixes: string[], allowedTools: string[] = []) => neverCategoriesAdmitted({ allowedTools, allowedBashPrefixes });
  const prCategories = NEVER_CATEGORIES.filter((c) => c.startsWith("gh_pr_"));
  const issueCategories = NEVER_CATEGORIES.filter((c) => c.startsWith("gh_issue_"));

  it("AUTOMATE_RUN_POLICY admits git_push (its `git push` prefix) and gh_pr_create (its `gh pr` prefix), in NEVER_CATEGORIES order", () => {
    const admitted = neverCategoriesAdmitted(AUTOMATE_RUN_POLICY);
    expect(admitted).toEqual(expect.arrayContaining(["git_push", "gh_pr_create"]));
    expect(admitted).toEqual(NEVER_CATEGORIES.filter((c) => admitted.includes(c)));
  });

  it("the word-boundary rule: `gh p` and `gh prx` admit no gh_pr_* category; `gh pr` admits them", () => {
    expect(admits(["gh p"])).toEqual([]);
    expect(admits(["gh prx"]).filter((c) => prCategories.includes(c))).toEqual([]);
    expect(admits(["git pus"])).toEqual([]);
    expect(admits(["gh pr"])).toEqual(["gh_pr_create", "gh_pr_comment", "gh_pr_review", "gh_pr_edit", "gh_pr_close"]);
  });

  it("`gh pr` admits no gh_issue_* category, and `gh issue` no gh_pr_* one", () => {
    expect(admits(["gh pr"]).filter((c) => issueCategories.includes(c))).toEqual([]);
    expect(admits(["gh issue"])).toEqual(["gh_issue_create", "gh_issue_comment", "gh_issue_edit", "gh_issue_close"]);
  });

  it("a narrower prefix admits only its own form; `gh pr new` is read as create, `gh api` as a write, `gh` holds every gh form", () => {
    expect(admits(["gh pr create"])).toEqual(["gh_pr_create"]);
    expect(admits(["gh pr new"])).toEqual(["gh_pr_create"]);
    expect(admits(["gh pr view", "gh pr diff", "git status"])).toEqual([]);
    expect(admits(["gh api"])).toEqual(["gh_api_write"]);
    expect(admits(["gh alias set"])).toEqual(["alias_define"]);
    expect(admits(["git"])).toEqual(["git_push"]);
    // `gh` holds every gh form; the two PR categories with no gh form (request reviewers, comment reply) are only kernel tools.
    expect(admits(["gh"])).toEqual([
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
    ]);
  });

  it("a prefix more specific than the rail's form is read as the command a session could start with", () => {
    expect(admits(["git push origin"])).toEqual(["git_push"]);
    expect(admits(["git push origin main"])).toEqual(["git_push"]);
    expect(admits(["gh pr create --draft"])).toEqual(["gh_pr_create"]);
    expect(admits(["gh pr new --fill"])).toEqual(["gh_pr_create"]);
    expect(admits(["gh issue comment 12"])).toEqual(["gh_issue_comment"]);
    expect(admits(["gh api -X POST"])).toEqual(["gh_api_write"]);
    expect(admits(["gh api --method PATCH"])).toEqual(["gh_api_write"]);
    expect(admits(["gh api --method=DELETE repos/o/r/issues/1"])).toEqual(["gh_api_write"]);
    expect(admits(["gh api repos/o/r/issues -f title=x"])).toEqual(["gh_api_write"]);
    // Read-only prefixes the rail reads as no outward form admit nothing.
    expect(admits(["gh api repos/x"])).toEqual([]);
    expect(admits(["gh api -X GET repos/x"])).toEqual([]);
    expect(admits(["git status", "git log --oneline", "gh pr view 12"])).toEqual([]);
    expect(admits(["gh prx"])).toEqual([]);
    expect(admits(["gh prx create"])).toEqual([]);
  });

  it("the three run policies admit exactly what their prefixes held before the both-directions read", () => {
    for (const policy of [AUTOMATE_RUN_POLICY, REVIEW_PR_RUN_POLICY, MERGE_PARKED_RUN_POLICY]) {
      expect(neverCategoriesAdmitted(policy)).toEqual([
        "git_push",
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
      ]);
    }
  });

  it("a GitHub write tool in allowedTools admits its category; an empty or blank prefix, or a file tool, admits nothing", () => {
    for (const [tool, category] of Object.entries(GITHUB_WRITE_TOOLS)) expect(admits([], [tool]), tool).toEqual([category]);
    expect(admits(["", "  "])).toEqual([]);
    expect(admits([], ["Write", "Edit", "Bash"])).toEqual([]);
  });
});

describe("item 25g: a kernel-launched command's outward needs, compared with held.never", () => {
  const none = { allowedTools: [] as string[], allowedBashPrefixes: [] as string[] };

  it("the ticket job's resolved outward needs include git_push and gh_pr_create, derived from its kernel run policy", () => {
    const [command] = resolveJobNeeds("automate_tickets", PINNED).commands;
    expect(command?.outward).toEqual(expect.arrayContaining(["git_push", "gh_pr_create"]));
    expect(command?.outward).toEqual(neverCategoriesAdmitted(AUTOMATE_RUN_POLICY));
    // A job reaching no command has no outward needs.
    expect(resolveJobNeeds("read_pr", PINNED).commands).toEqual([]);
  });

  it("a crew-launched command is not under a kernel run policy, so it carries no outward needs", () => {
    const row = LOOMWRIGHT_COMMAND_NEEDS["/loomwright:review-pr"] as CommandNeeds;
    const table: LoomwrightCommandNeedsTable = { ...LOOMWRIGHT_COMMAND_NEEDS, "/loomwright:review-pr": { ...row, launch: "crew" } };
    expect(resolveJobNeeds("triage_pr_comments", buildToolCatalogue(TOOLS, table)).commands[0]?.outward).toEqual([]);
  });

  it("a contract's declared needs never replace a row's run policy (it is the kernel's own fact, like launch)", () => {
    const table = commandNeedsTable(contractCommands({ claude_tools: ["Read"], bash_prefixes: [] }, "automate"));
    expect(table["/loomwright:automate"]?.runPolicy).toBe(LOOMWRIGHT_COMMAND_NEEDS["/loomwright:automate"]?.runPolicy);
    expect(resolveJobNeeds("automate_tickets", buildToolCatalogue(TOOLS, table)).commands[0]?.outward).toEqual(neverCategoriesAdmitted(AUTOMATE_RUN_POLICY));
  });

  it("a never entry the run admits is a `never` gap: plain words, never closable, last in the gap order, once per category", () => {
    const tickets = resolveJobNeeds("automate_tickets", PINNED);
    const gaps = jobNeedsGaps(tickets, { ...none, workspace: false, never: ["gh_pr_create", "git_push", "mcp_write"] });
    expect(gaps.map((g) => [g.kind, g.name, g.label, g.closable, g.command])).toEqual([
      ["workspace", "workspace", "a copy of a repo to work in", false, undefined],
      ["never", "git_push", "push with git", false, "/loomwright:automate"],
      ["never", "gh_pr_create", "open a PR", false, "/loomwright:automate"],
    ]);
  });

  it("no never given, an empty never, or one the run does not admit: no `never` gap", () => {
    const tickets = resolveJobNeeds("automate_tickets", PINNED);
    expect(jobNeedsGaps(tickets, none)).toEqual([]);
    expect(jobNeedsGaps(tickets, { ...none, never: [] })).toEqual([]);
    expect(jobNeedsGaps(tickets, { ...none, never: ["mcp_write", "settings_write", "hooks_write", "alias_define"] })).toEqual([]);
  });

  it("every never category has plain words that are not its raw name", () => {
    for (const c of NEVER_CATEGORIES) {
      expect(NEVER_ACTION_LABELS[c], c).toBeTruthy();
      expect(NEVER_ACTION_LABELS[c], c).not.toContain("_");
    }
  });
});

// ---- Item 21b: a ticket duty's tracker is a readiness item, not a fit gap ---------------------------------------------

describe("the ticket source is declared on the one ticket job and is not a needs gap (item 21b)", () => {
  it("only the ticket job declares a ticket source, once; the other needs a job declares are unchanged", () => {
    expect(Object.entries(TOOL_JOB_DEFINITIONS).filter(([, d]) => d.needs.ticketSource).map(([id]) => id)).toEqual(["automate_tickets"]);
    expect(jobNeedsTicketSource("automate_tickets")).toBe(true);
    expect(jobNeedsTicketSource("read_pr")).toBe(false);
    // Every job still declares the five parts it always did, beside the new one.
    for (const def of Object.values(TOOL_JOB_DEFINITIONS)) expect(Object.keys(def.needs).sort()).toEqual(["bashPrefixes", "claudeTools", "connectors", "loomwrightCommands", "ticketSource", "workspace"]);
  });

  it("a member lacking everything the ticket job needs gets only the closed gap kinds: no gap names a tracker", () => {
    const gaps = jobNeedsGaps(resolveJobNeeds("automate_tickets"), { allowedTools: [], allowedBashPrefixes: [], connectors: {}, workspace: false });
    const kinds: readonly string[] = ["claude_tool", "bash_prefix", "connector", "workspace"];
    for (const g of gaps) {
      expect(kinds).toContain(g.kind);
      expect(g.label).not.toMatch(/tracker|ClickUp|Jira|ticket source/i);
    }
  });
});
