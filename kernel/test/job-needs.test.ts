// What a catalogue job's work needs (phase 8 item 20c, subtask 1):
//   AC1 every job declares its needs and `resolveJobNeeds` returns all five parts;
//   AC2 a Loomwright command's needs come from the active install's contract
//       where it declares them, else from the pinned `LOOMWRIGHT_COMMAND_NEEDS`;
//   AC6 a job added to `TOOL_JOB_DEFINITIONS` without needs fails a runtime
//       test (`npm test` is `vitest run` and does not typecheck);
//   D44 `automate_tickets` needs no `Skill` and no shell prefix: the kernel
//       starts `/loomwright:automate` under its own frozen policy.
// The code is `kernel/src/features/job-needs.ts` and the declarations in
// `kernel/src/features/catalogue.ts`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOOL_JOB_DEFINITIONS, TOOL_JOB_IDS, TOOL_JOBS, buildToolCatalogue, jobNeedsWorkspace } from "../src/features/catalogue.js";
import type { ToolCatalogue } from "../src/features/catalogue.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import {
  BASH_PREFIX_LABELS,
  CLAUDE_TOOL_LABELS,
  LOOMWRIGHT_COMMAND_NEEDS,
  UNKNOWN_CLAUDE_TOOL_LABEL,
  bashPrefixHeld,
  commandNeedsTable,
  jobNeedsGaps,
  loadCommandNeeds,
  resolveJobNeeds,
} from "../src/features/job-needs.js";
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

  it("triage and merge reach crew-launched commands: Skill and shell prefixes are declared, none can be closed by a charter change", () => {
    for (const [id, invocation] of [["triage_pr_comments", "/loomwright:review-pr"], ["ask_for_merge", "/loomwright:automate --merge-parked"]] as const) {
      const needs = resolveJobNeeds(id, PINNED);
      expect(needs.commands.map((c) => [c.invocation, c.launch]), id).toEqual([[invocation, "crew"]]);
      expect(needs.claudeTools.map((n) => n.name), id).toContain("Skill");
      expect(needs.bashPrefixes.length, id).toBeGreaterThan(0);
      for (const n of [...needs.claudeTools, ...needs.bashPrefixes]) {
        expect(n.closable, `${id}: ${n.name}`).toBe(false);
        expect(n.command, id).toBe(invocation);
      }
    }
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
    expect(row?.launch).toBe("crew"); // launch is the kernel's own fact (D44), never the contract's
    expect(table["/loomwright:automate"]).toBe(LOOMWRIGHT_COMMAND_NEEDS["/loomwright:automate"]);
    expect(table["/loomwright:automate --merge-parked"]).toBe(LOOMWRIGHT_COMMAND_NEEDS["/loomwright:automate --merge-parked"]);
  });

  it("the resolved needs follow the table the catalogue carries: the contract's declaration replaces the pinned Skill need", () => {
    const table = commandNeedsTable(contractCommands({ claude_tools: ["Read"], bash_prefixes: [] }));
    const viaContract = resolveJobNeeds("triage_pr_comments", buildToolCatalogue(TOOLS, table));
    expect(viaContract.claudeTools.map((n) => n.name)).toEqual(["Read"]);
    expect(viaContract.bashPrefixes).toEqual([]);
    const viaPinned = resolveJobNeeds("triage_pr_comments", PINNED);
    expect(viaPinned.claudeTools.map((n) => n.name)).toContain("Skill");
    // A catalogue built without a table resolves to the pinned rows.
    expect(resolveJobNeeds("triage_pr_comments", buildToolCatalogue(TOOLS)).claudeTools).toEqual(viaPinned.claudeTools);
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
  const triage = resolveJobNeeds("triage_pr_comments", PINNED);
  const none = { allowedTools: [] as string[], allowedBashPrefixes: [] as string[] };

  it("a member holding nothing lacks each Claude tool and prefix the crew-launched command needs, in plain words and as gaps no charter should close", () => {
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
