// The charter readiness check flags the declared needs of the jobs a charter
// grants (phase 8 item 20c, `kernel/src/agents/charter-readiness.ts`): beyond
// the kernel tools, a copy of a repo and a connector grant (item 18b), each
// granted job's Claude tools and shell commands (declared on the job and on the
// Loomwright commands it reaches, `kernel/src/features/job-needs.ts`), one
// `flagged` line per job and kind, in plain words; the raw name (`Skill`, a
// shell prefix, `mcp__kernel__…`) only on the display's `enforced:` line.
//
// Includes the 2026-11-12 charter (`studio-sandbox-dev` before approval 32),
// rebuilt from the requirement as a committed fixture: its job runs
// `/loomwright:automate`, which D44 has the kernel launch under its own frozen
// policy, so it must be flagged for GitHub write and a copy of a repo only,
// never for `Skill`.
//
// Unit cases call `charterReadiness` with the shipped composition's catalogue
// and a temp data dir. Never the real SDK, a model, git or the network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  READINESS_FLAG_PREFIX,
  READINESS_HEADING,
  charterReadiness,
  readinessFloorLines,
} from "../src/agents/charter-readiness.js";
import type { ReadinessGrant, ReadinessResult } from "../src/agents/charter-readiness.js";
import { createDisplay } from "../src/agents/charter-tools.js";
import { validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import { TOOL_JOBS, buildToolCatalogue } from "../src/features/catalogue.js";
import type { ToolCatalogue, ToolJob } from "../src/features/catalogue.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { commandNeedsTable } from "../src/features/job-needs.js";

const K = "mcp__kernel__";
const CATALOGUE = buildToolCatalogue(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools);
const PERMISSION = "  flagged: permission to ";
/** Every raw name a readiness line must never show. */
const RAW = /\bSkill\b|\bBash\b|\bAgent\b|mcp__kernel__|git (diff|commit|push)|gh pr/;

let tmp: string;
let dataDir: string;
let home: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "charter-needs-"));
  dataDir = join(tmp, "data");
  home = join(tmp, "home");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** The full names of `job`'s catalogue tools. */
function toolsOf(job: ToolJob): string[] {
  const tools = CATALOGUE.jobs.find((j) => j.id === job)?.tools.map((t) => `${K}${t.name}`) ?? [];
  if (tools.length === 0) throw new Error(`the shipped catalogue has no tool for ${job}`);
  return tools;
}

/** A crew charter granting every kernel tool of `jobs` plus `extraTools`, with the given prefixes and workspaces. */
function crew(
  duties: { text: string; jobs: ToolJob[] }[],
  jobs: readonly ToolJob[],
  extra: { tools?: string[]; prefixes?: string[]; workspaces?: string[] } = {},
): Charter {
  const r = validateCharter(
    {
      id: "dev",
      display_name: "Dev",
      avatar: { shape: "crab", hue: "crew-teal" },
      persona: "A developer for the owner's sandbox repo.",
      duties,
      boundaries: ["Never merge a pull request yourself."],
      model: "claude-sonnet-5",
      permission_mode: "default",
      tool_policy: { allowedTools: [...(extra.tools ?? []), ...jobs.flatMap(toolsOf)], allowedBashPrefixes: extra.prefixes ?? [], never: [] },
      workspaces: extra.workspaces ?? [],
    },
    { dataDir },
  );
  if (!r.ok) throw new Error(`not valid: ${r.message}`);
  return r.charter;
}

function readiness(charter: Charter, grant: ReadinessGrant, catalogue: ToolCatalogue = CATALOGUE): ReadinessResult {
  return charterReadiness({ action: "update", charter, catalogue, grant, dataDir, homeDir: home });
}

const flagged = (r: ReadinessResult): string[] => r.lines.filter((l) => l.startsWith(READINESS_FLAG_PREFIX));
const permissionLines = (r: ReadinessResult): string[] => r.lines.filter((l) => l.startsWith(PERMISSION));

/** The 2026-11-12 charter: the "Hand tickets to /automate" job's kernel tools, no Skill, no shell grant, no workspace. */
const STUDIO_SANDBOX_DEV = (): Charter =>
  crew([{ text: "Hand tickets to /automate", jobs: ["automate_tickets"] }], ["automate_tickets"], { tools: ["Read"], prefixes: [], workspaces: [] });
/** Its connector grant: GitHub, without write (the owner had not granted it). */
const GITHUB_READ: ReadinessGrant = { kind: "stored", raw: { github: "read" } };

describe("AC7: the 2026-11-12 charter (studio-sandbox-dev before approval 32)", () => {
  it("is flagged for GitHub write access and a copy of a repo, under the kernel-owned launch (D44)", () => {
    const r = readiness(STUDIO_SANDBOX_DEV(), GITHUB_READ);
    const lines = flagged(r);
    expect(lines.some((l) => l.startsWith("  flagged: GitHub write access for ") && l.includes("Hand tickets to /automate"))).toBe(true);
    expect(lines.some((l) => l.startsWith("  flagged: copy of a repo for ") && l.includes("Hand tickets to /automate") && l.includes("it has no copy of a repo to work in"))).toBe(true);
    // The duty is covered: its job's kernel tools are granted.
    expect(r.lines).toContain("  covered: duty 1 by Hand tickets to /automate: Hand tickets to /automate");
  });

  it("names no Skill, no 'run skills' and no permission line for that job", () => {
    const r = readiness(STUDIO_SANDBOX_DEV(), GITHUB_READ);
    for (const line of r.lines) expect(line).not.toMatch(/\bSkill\b|run skills|run shell|helper agents/i);
    expect(permissionLines(r)).toEqual([]);
    expect(r.items.filter((i) => i.subject === "permission")).toEqual([]);
    // Nothing is proposed for it either: no Skill, no shell prefix, no Claude tool in Wright's note.
    expect(r.agentNote).toBeDefined();
    expect(r.agentNote).not.toMatch(/\bSkill\b|allowedBashPrefixes|run skills/);
  });
});

describe("AC3: a missing declared need is flagged in plain words", () => {
  const TRIAGE = (extra: Parameters<typeof crew>[2] = {}) =>
    crew([{ text: "Triage PR comments", jobs: ["triage_pr_comments"] }], ["triage_pr_comments"], { tools: ["Read"], ...extra });
  const READ_WRITE: ReadinessGrant = { kind: "stored", raw: { github: "write" } };

  it("a job whose command the crew session runs itself gets one flagged line per kind, naming the job and what it could do", () => {
    const r = readiness(TRIAGE(), READ_WRITE);
    expect(permissionLines(r)).toEqual([
      "  flagged: permission to run skills, run shell commands and start helper agents for Triage PR comments: no charter should grant it",
      "  flagged: permission to see changes with git, commit with git, push with git and work with pull requests on GitHub for Triage PR comments: no charter should grant it",
    ]);
    expect(r.items.filter((i) => i.subject === "permission").map((i) => i.jobs)).toEqual([["triage_pr_comments"], ["triage_pr_comments"]]);
    expect(r.open.length).toBeGreaterThanOrEqual(2);
  });

  it("no readiness line names a raw tool, a shell prefix or an mcp__kernel__ tool; the display's enforced line does", () => {
    const granted = TRIAGE({ tools: ["Read", "Skill"], prefixes: ["gh pr"] });
    const r = readiness(granted, READ_WRITE);
    for (const line of r.lines) expect(line, line).not.toMatch(RAW);
    const display = createDisplay(granted, CATALOGUE, r.lines);
    const enforced = display.split("\n").find((l) => l.startsWith("enforced: ")) ?? "";
    expect(enforced).toContain("Skill");
    expect(enforced).toContain("gh pr");
    expect(enforced).toContain(K);
    // Granting Skill closes that part of the first line, and "gh pr" part of the second.
    expect(permissionLines(r)).toEqual([
      "  flagged: permission to run shell commands and start helper agents for Triage PR comments: no charter should grant it",
      "  flagged: permission to see changes with git, commit with git and push with git for Triage PR comments: no charter should grant it",
    ]);
  });

  it("holding every Claude tool and shell prefix the command asks for closes every permission line", () => {
    const r = readiness(TRIAGE({ tools: ["Read", "Skill", "Bash", "Agent"], prefixes: ["git", "gh"] }), READ_WRITE);
    expect(permissionLines(r)).toEqual([]);
  });

  it("the block stays bounded by jobs, not tools: one line per job and kind however many tools are granted", () => {
    const both = crew(
      [
        { text: "Triage PR comments", jobs: ["triage_pr_comments"] },
        { text: "Ask for merges", jobs: ["ask_for_merge"] },
      ],
      ["triage_pr_comments", "ask_for_merge"],
      { tools: ["Read"] },
    );
    const lines = permissionLines(readiness(both, READ_WRITE));
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.endsWith("for Triage PR comments: no charter should grant it"))).toHaveLength(2);
    // Granting every kernel tool of every job adds jobs, never a line per tool: at most two permission lines per job.
    const every = crew([{ text: "Everything", jobs: [] }], Object.keys(TOOL_JOBS) as ToolJob[], { tools: ["Read"] });
    const all = permissionLines(readiness(every, READ_WRITE));
    expect(all.length).toBeLessThanOrEqual(2 * Object.keys(TOOL_JOBS).length);
    expect(all).toHaveLength(4);
  });

  it("Wright's note proposes no Skill or shell grant for a crew-run command, and names the job and command it reaches", () => {
    const r = readiness(TRIAGE(), READ_WRITE);
    const note = r.agentNote ?? "";
    expect(note).toContain("permission to run skills, run shell commands and start helper agents for Triage PR comments: not granted, and not for a charter to grant");
    expect(note).toContain("Triage PR comments reaches /loomwright:review-pr");
    expect(note).toContain("propose no tool or shell grant for it");
    expect(note).not.toMatch(/allowedBashPrefixes|add .*Skill/);
  });

  it("a command's needs come from the install's contract where it declares them (contract first)", () => {
    const declared = [{ name: "review-pr", description: null, needs: { claude_tools: ["Skill"], bash_prefixes: [], connectors: [], workspace: true } }];
    const catalogue: ToolCatalogue = { ...CATALOGUE, commandNeeds: commandNeedsTable(declared) };
    const r = readiness(TRIAGE(), READ_WRITE, catalogue);
    expect(permissionLines(r)).toEqual(["  flagged: permission to run skills for Triage PR comments: no charter should grant it"]);
    // A contract that declares nothing needed leaves no permission line.
    const none = [{ name: "review-pr", description: null, needs: { claude_tools: [], bash_prefixes: [], connectors: [], workspace: true } }];
    expect(permissionLines(readiness(TRIAGE(), READ_WRITE, { ...CATALOGUE, commandNeeds: commandNeedsTable(none) }))).toEqual([]);
  });

  it("a flag never changes what is covered: the duty line and the other lines are as before, in order", () => {
    const r = readiness(TRIAGE(), READ_WRITE);
    expect(r.lines[0]).toBe(READINESS_HEADING);
    expect(r.lines[1]).toBe("  covered: duty 1 by Triage PR comments: Triage PR comments");
    // Permission lines come after the repo and connector lines.
    const first = r.lines.findIndex((l) => l.startsWith(PERMISSION));
    expect(r.lines.slice(2, first).every((l) => !l.startsWith(PERMISSION))).toBe(true);
    expect(r.lines.slice(first).every((l) => l.startsWith(PERMISSION))).toBe(true);
  });
});

describe("AC3: readinessFloorLines stays a lower bound of the real lines", () => {
  it("is never longer than the real block for a request to the tools or the workspaces", () => {
    const charter = crew([{ text: "Triage PR comments", jobs: ["triage_pr_comments"] }], ["triage_pr_comments"], { tools: ["Read"] });
    const actual = readiness(charter, { kind: "stored", raw: { github: "write" } });
    const total = (lines: readonly string[]) => lines.join("\n").length;
    for (const sets of [
      { tools: false, workspaces: false },
      { tools: false, workspaces: true },
      { tools: true, workspaces: false },
      { tools: true, workspaces: true },
    ]) {
      const floor = readinessFloorLines(charter, CATALOGUE, actual, sets);
      expect(total(floor), JSON.stringify(sets)).toBeLessThanOrEqual(total(actual.lines));
    }
    // The permission lines depend on neither the workspaces nor the connectors: a workspaces-only request keeps them.
    const workspacesOnly = readinessFloorLines(charter, CATALOGUE, actual, { tools: false, workspaces: true });
    for (const line of permissionLines(actual)) expect(workspacesOnly).toContain(line);
  });
});
