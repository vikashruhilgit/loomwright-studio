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
import { LOOMWRIGHT_COMMAND_NEEDS, commandNeedsTable } from "../src/features/job-needs.js";
import type { CommandNeeds } from "../src/features/job-needs.js";

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
  /** The shipped catalogue with review-pr marked crew-launched: no shipped row is (D45), but the comparison is still the mechanism. */
  const crewRow = LOOMWRIGHT_COMMAND_NEEDS["/loomwright:review-pr"] as CommandNeeds;
  const CREW_CATALOGUE: ToolCatalogue = { ...CATALOGUE, commandNeeds: { ...LOOMWRIGHT_COMMAND_NEEDS, "/loomwright:review-pr": { ...crewRow, launch: "crew" } } };

  it("D45: a triage job, whose fix the kernel starts, gets no permission line and no 'no charter should grant it'", () => {
    const r = readiness(TRIAGE(), READ_WRITE);
    expect(permissionLines(r)).toEqual([]);
    for (const line of r.lines) expect(line).not.toContain("no charter should grant it");
    expect(r.lines).toContain("  covered: Triage PR comments: Studio runs the fix for this member");
  });

  it("a crew-launched command (a test table) still gets one flagged line per kind, naming the job and what it could do", () => {
    const r = readiness(TRIAGE(), READ_WRITE, CREW_CATALOGUE);
    expect(permissionLines(r)).toEqual([
      "  flagged: permission to run skills, run shell commands and start helper agents for Triage PR comments: no charter should grant it",
      "  flagged: permission to see changes with git, commit with git, push with git and work with pull requests on GitHub for Triage PR comments: no charter should grant it",
    ]);
    expect(r.items.filter((i) => i.subject === "permission" && i.status === "flagged").map((i) => i.jobs)).toEqual([["triage_pr_comments"], ["triage_pr_comments"]]);
    // Its route is not the kernel's, so it is not read as covered by Studio.
    expect(r.lines.some((l) => l.includes("Studio runs"))).toBe(false);
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
    // The held Skill and gh pr are read as held for no need (AC7), in plain words.
    expect(permissionLines(r)).toEqual([
      "  flagged: permission to run skills and work with pull requests on GitHub: this charter holds a permission no crew member needs (Studio runs that work itself)",
    ]);
  });

  it("the block stays bounded by jobs, not tools: at most one covered route line and one surplus line however many are held", () => {
    const both = crew(
      [
        { text: "Triage PR comments", jobs: ["triage_pr_comments"] },
        { text: "Ask for merges", jobs: ["ask_for_merge"] },
      ],
      ["triage_pr_comments", "ask_for_merge"],
      { tools: ["Read", "Skill", "Agent"], prefixes: ["git commit", "git push", "gh pr", "git", "gh"] },
    );
    const r = readiness(both, READ_WRITE);
    expect(permissionLines(r)).toHaveLength(1);
    expect(r.lines.filter((l) => l.includes("Studio runs"))).toEqual([
      "  covered: Triage PR comments and Ask for a merge: Studio runs the fix and the merge for this member",
      "  flagged: permission to run skills, start helper agents, commit with git, push with git and work with pull requests on GitHub: this charter holds a permission no crew member needs (Studio runs that work itself)",
    ]);
    // Granting every kernel tool of every job adds jobs, never a line per tool.
    const every = crew([{ text: "Everything", jobs: [] }], Object.keys(TOOL_JOBS) as ToolJob[], { tools: ["Read"] });
    expect(permissionLines(readiness(every, READ_WRITE))).toEqual([]);
  });

  it("Wright's note proposes no Skill or shell grant, and for a held one says the kernel starts Loomwright's commands itself", () => {
    const clean = readiness(TRIAGE(), READ_WRITE);
    expect(clean.agentNote ?? "").not.toMatch(/allowedBashPrefixes|add .*Skill|reaches \/loomwright/);
    const held = readiness(TRIAGE({ tools: ["Read", "Skill"] }), READ_WRITE);
    const note = held.agentNote ?? "";
    expect(note).toContain("holds a permission no crew member needs (run skills)");
    expect(note).toContain("the kernel starts Loomwright's commands itself");
    expect(note).toContain("Never draft one or copy one from another member");
    expect(note).not.toMatch(/allowedBashPrefixes|add .*Skill/);
  });

  it("a command's needs come from the install's contract where it declares them, and a kernel-launched command's stay the kernel's (contract first)", () => {
    const declared = [{ name: "review-pr", description: null, needs: { claude_tools: ["Skill"], bash_prefixes: ["git push"], connectors: [], workspace: true } }];
    const catalogue: ToolCatalogue = { ...CATALOGUE, commandNeeds: commandNeedsTable(declared) };
    expect(permissionLines(readiness(TRIAGE(), READ_WRITE, catalogue))).toEqual([]);
    // On a crew-launched row, the contract's declaration is what is flagged.
    const crewDeclared: ToolCatalogue = { ...CATALOGUE, commandNeeds: { ...LOOMWRIGHT_COMMAND_NEEDS, "/loomwright:review-pr": { ...(commandNeedsTable(declared)["/loomwright:review-pr"] as CommandNeeds), launch: "crew" } } };
    expect(permissionLines(readiness(TRIAGE(), READ_WRITE, crewDeclared))).toEqual([
      "  flagged: permission to run skills for Triage PR comments: no charter should grant it",
      "  flagged: permission to push with git for Triage PR comments: no charter should grant it",
    ]);
  });

  it("a flag never changes what is covered: the duty line and the other lines are as before, in order", () => {
    const r = readiness(TRIAGE({ tools: ["Read", "Skill"] }), READ_WRITE);
    expect(r.lines[0]).toBe(READINESS_HEADING);
    expect(r.lines[1]).toBe("  covered: duty 1 by Triage PR comments: Triage PR comments");
    // The covered route line and the surplus line come after the repo and connector lines.
    const route = r.lines.findIndex((l) => l.includes("Studio runs the fix"));
    const first = r.lines.findIndex((l) => l.startsWith(PERMISSION));
    expect(route).toBeGreaterThan(1);
    expect(first).toBe(route + 1);
    expect(r.lines.slice(2, route).every((l) => !l.startsWith(PERMISSION))).toBe(true);
  });
});

describe("item 21b: a ticket duty's tracker line is its own finding, not a job need", () => {
  const TICKETS = (source?: "github" | "clickup" | "jira") =>
    crew([{ text: "Work the owner's tickets", jobs: ["automate_tickets"], ...(source === undefined ? {} : { source }) } as { text: string; jobs: ToolJob[] }], ["automate_tickets"], { tools: ["Read"] });

  it("is no job need: the job's declared needs and the permission lines are unchanged, and the tracker line has no raw tool, prefix or Claude tool name", () => {
    const withSource = readiness(TICKETS("clickup"), GITHUB_READ);
    const without = readiness(TICKETS(), GITHUB_READ);
    expect(permissionLines(withSource)).toEqual(permissionLines(without));
    expect(withSource.items.filter((i) => i.subject === "permission")).toEqual(without.items.filter((i) => i.subject === "permission"));
    const tracker = withSource.lines.filter((l) => l.includes("tickets yet"));
    expect(tracker).toHaveLength(1);
    for (const line of [...tracker, ...without.lines.filter((l) => l.includes("which tracker"))]) expect(line).not.toMatch(RAW);
  });

  it("readinessFloorLines keeps it as it is when a request sets the tools, so the floor is still a lower bound and counts the line", () => {
    const charter = TICKETS("clickup");
    const actual = readiness(charter, GITHUB_READ);
    const line = actual.items.find((i) => i.subject === "tracker")?.line ?? "";
    expect(line).not.toBe("");
    const total = (lines: readonly string[]) => lines.join("\n").length;
    for (const sets of [
      { tools: false, workspaces: false },
      { tools: false, workspaces: true },
      { tools: true, workspaces: false },
      { tools: true, workspaces: true },
    ]) {
      const floor = readinessFloorLines(charter, CATALOGUE, actual, sets);
      expect(floor, JSON.stringify(sets)).toContain(line);
      expect(total(floor), JSON.stringify(sets)).toBeLessThanOrEqual(total(actual.lines));
    }
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
