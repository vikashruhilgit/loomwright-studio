// Phase 8 item 25g: the charter readiness check flags a `never` entry that
// blocks one of the member's own jobs. The kernel launches the ticket run, the
// fix and the merge under frozen run policies (`kernel/src/automate/launch.ts`)
// with the member's `never` list added (D45), so a `never` category one of
// those policies admits defeats the job: `charterReadiness` shows one flagged
// line per such job, naming every forbidden action in plain words, and flags
// each duty naming the job not covered. A `never` list that defeats no job
// reads exactly as before.
//
// The first import is `launch.ts`, before anything that loads
// `kernel/src/features/job-needs.ts`: the two are in a runtime import cycle,
// and the ticket job's outward needs must still resolve when `launch.ts`
// loads first (the run policies are read lazily, never at module load).
import { AUTOMATE_RUN_POLICY, MERGE_PARKED_RUN_POLICY, REVIEW_PR_RUN_POLICY } from "../src/automate/launch.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NEVER_FORBIDS, READINESS_FLAG_PREFIX, charterReadiness, readinessFloorLines } from "../src/agents/charter-readiness.js";
import type { ReadinessResult } from "../src/agents/charter-readiness.js";
import { UPDATE_ASK_LESS_NEVER, createDisplay, updateAskLess } from "../src/agents/charter-tools.js";
import { validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import { MAX_APPROVAL_DISPLAY } from "../src/approvals/store.js";
import { TOOL_JOBS, TOOL_JOB_IDS, buildToolCatalogue } from "../src/features/catalogue.js";
import type { ToolJob } from "../src/features/catalogue.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { resolveJobNeeds } from "../src/features/job-needs.js";
import { NEVER_CATEGORIES, neverCategoriesAdmitted } from "../src/sessions/policy.js";
import type { NeverCategory } from "../src/sessions/policy.js";

const K = "mcp__kernel__";
const CATALOGUE = buildToolCatalogue(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools);
const TICKETS = TOOL_JOBS.automate_tickets;

let tmp: string;
let dataDir: string;
let home: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-readiness-never-"));
  dataDir = join(tmp, "data");
  home = join(tmp, "home");
  mkdirSync(home);
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

const duty = (text: string, ...jobs: ToolJob[]) => ({ text, jobs, source: "none" as const });

/** A charter granting every tool of `jobs`, with `duties` and `never`. */
function charterOf(duties: unknown[], jobs: readonly ToolJob[], never: readonly string[]): Charter {
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
      tool_policy: { allowedTools: ["Read", ...jobs.flatMap(toolsOf)], allowedBashPrefixes: [], never },
      workspaces: [],
    },
    { dataDir },
  );
  if (!r.ok) throw new Error(`not valid: ${r.message}`);
  return r.charter;
}

function readiness(charter: Charter, action: "create" | "update" = "create"): ReadinessResult {
  return charterReadiness({ action, charter, catalogue: CATALOGUE, grant: { kind: "proposed", connectors: ["github"] }, dataDir, homeDir: home });
}

/** The ticket duty and an unrelated duty, granting the ticket job and Read a PR. */
function ticketCharter(never: readonly string[]): Charter {
  return charterOf([duty("Turn the owner's tickets into PRs", "automate_tickets"), duty("Read the PRs it opened", "read_pr")], ["automate_tickets", "read_pr"], never);
}

/** The lines of `r` that are never lines (one per defeated job). */
const neverLines = (r: ReadinessResult): string[] => r.lines.filter((l) => l.endsWith(`; ${NEVER_FORBIDS}`));

describe("load order: launch.ts loads before job-needs.ts", () => {
  it("the ticket job's outward needs still resolve from its kernel run policy (the policies are read lazily, never at module load)", () => {
    const [command] = resolveJobNeeds("automate_tickets", CATALOGUE).commands;
    expect(command?.invocation).toBe("/loomwright:automate");
    expect(command?.outward).toEqual(neverCategoriesAdmitted(AUTOMATE_RUN_POLICY));
    expect(command?.outward).toEqual(expect.arrayContaining(["git_push", "gh_pr_create"]));
    expect(resolveJobNeeds("triage_pr_comments", CATALOGUE).commands[0]?.outward).toEqual(neverCategoriesAdmitted(REVIEW_PR_RUN_POLICY));
    expect(resolveJobNeeds("ask_for_merge", CATALOGUE).commands[0]?.outward).toEqual(neverCategoriesAdmitted(MERGE_PARKED_RUN_POLICY));
  });
});

describe("AC1: a never entry the ticket run needs is flagged, one line per job, in plain words", () => {
  it("never: gh_pr_create: the ticket job needs to open a PR, the duty naming it is not covered, and Wright is told it is the owner's decision", () => {
    const r = readiness(ticketCharter(["gh_pr_create"]));
    expect(neverLines(r)).toEqual([`  flagged: ${TICKETS} needs to open a PR; the charter's never list forbids it`]);
    expect(r.lines).toContain(`  flagged: duty 1 not covered (the charter's never list forbids what ${TICKETS} needs): Turn the owner's tickets into PRs`);
    // A duty naming only a job the never list does not defeat stays covered.
    expect(r.lines).toContain("  covered: duty 2 by Read a PR: Read the PRs it opened");
    expect(r.open.map((i) => i.line)).toEqual(expect.arrayContaining([...neverLines(r), r.lines.find((l) => l.includes("duty 1 not covered"))]));
    expect(r.agentNote).toContain("whether to drop that job or that never entry is the owner's decision, never a change you make to the never list");
    // No raw category, tool, prefix or policy constant on a readiness line.
    for (const line of r.lines) {
      expect(line).not.toMatch(/gh_pr_create|git_push|AUTOMATE_RUN_POLICY|mcp__kernel__|gh pr|git push/);
    }
  });

  it("never: git_push: the ticket job needs to push with git", () => {
    const r = readiness(ticketCharter(["git_push"]));
    expect(neverLines(r)).toEqual([`  flagged: ${TICKETS} needs to push with git; the charter's never list forbids it`]);
    expect(r.lines.some((l) => l.startsWith(`${READINESS_FLAG_PREFIX}duty 1 not covered (`))).toBe(true);
    expect(r.agentNote).toContain("the owner's decision");
  });

  it("never: git_push and gh_pr_create: ONE line for the job, naming both actions", () => {
    const r = readiness(ticketCharter(["git_push", "gh_pr_create"]));
    expect(neverLines(r)).toEqual([`  flagged: ${TICKETS} needs to push with git and open a PR; the charter's never list forbids it`]);
  });

  it("an update reads the same, and its note never tells Wright to change the never list itself", () => {
    const r = readiness(ticketCharter(["gh_pr_create"]), "update");
    expect(neverLines(r)).toHaveLength(1);
    expect(r.agentNote).not.toMatch(/to tool_policy\.never|remove .*never|never: \[/);
  });

  it("a duty naming a granted job the never list defeats and an ungranted one names both reasons", () => {
    const r = readiness(charterOf([duty("Turn tickets into PRs and merge them", "automate_tickets", "ask_for_merge")], ["automate_tickets"], ["gh_pr_create"]));
    expect(r.lines).toContain(
      `  flagged: duty 1 not covered (needs ${TOOL_JOBS.ask_for_merge}, which this charter does not grant; the charter's never list forbids what ${TICKETS} needs): Turn tickets into PRs and merge them`,
    );
  });
});

describe("a duty naming two defeated jobs", () => {
  it("names both job labels (never their actions) and each job keeps its own never line", () => {
    const jobs: ToolJob[] = ["automate_tickets", "triage_pr_comments"];
    const r = readiness(charterOf([duty("Turn tickets into PRs and heal their comments", ...jobs)], jobs, ["git_push"]));
    expect(r.lines).toContain(
      `  flagged: duty 1 not covered (the charter's never list forbids what ${TICKETS} and ${TOOL_JOBS.triage_pr_comments} need): Turn tickets into PRs and heal their comments`,
    );
    expect(neverLines(r)).toEqual(jobs.map((j) => `  flagged: ${TOOL_JOBS[j]} needs to push with git; the charter's never list forbids it`));
  });
});

describe("AC2: a never list that defeats no granted job reads exactly as before", () => {
  it("an empty never, and a never naming only categories no granted job's run admits, give the same lines, items, open and note", () => {
    const today = readiness(ticketCharter([]));
    expect(neverLines(today)).toEqual([]);
    const admitted = new Set(neverCategoriesAdmitted(AUTOMATE_RUN_POLICY));
    const harmless = NEVER_CATEGORIES.filter((c) => !admitted.has(c));
    expect(harmless.length).toBeGreaterThan(0);
    const other = readiness(ticketCharter(harmless));
    expect(other.lines).toEqual(today.lines);
    expect(other.items).toEqual(today.items);
    expect(other.open).toEqual(today.open);
    expect(other.agentNote).toEqual(today.agentNote);
  });

  it("a never list defeats no job the charter does not grant: every category with only Read a PR granted has no never line", () => {
    const r = readiness(charterOf([duty("Read PRs", "read_pr")], ["read_pr"], [...NEVER_CATEGORIES]));
    expect(neverLines(r)).toEqual([]);
    expect(r.lines).toContain("  covered: duty 1 by Read a PR: Read PRs");
  });
});

describe("display bound: one never line per granted job, never one per category", () => {
  it("every NEVER_CATEGORIES value with the ticket, triage and merge jobs granted gives exactly three never lines, and the create head fits", () => {
    const jobs: ToolJob[] = ["automate_tickets", "triage_pr_comments", "ask_for_merge"];
    const charter = charterOf(
      jobs.map((j) => duty(`Do the ${TOOL_JOBS[j]} work`, j)),
      jobs,
      [...NEVER_CATEGORIES] as NeverCategory[],
    );
    const r = readiness(charter);
    const lines = neverLines(r);
    // Counted, not only measured: a line per job × category would still fit the cap here, and must still fail.
    expect(lines).toHaveLength(jobs.length);
    expect(lines.map((l) => l.slice(READINESS_FLAG_PREFIX.length, l.indexOf(" needs to ")))).toEqual(jobs.map((j) => TOOL_JOBS[j]));
    // The three run policies hold the same prefixes, so each line names the same eleven actions, once each.
    for (const l of lines) {
      expect(l).toContain(
        " needs to push with git, open a PR, comment on a PR, review a PR, edit a PR, close a PR, open an issue, comment on an issue, edit an issue, close an issue and write through the GitHub API; ",
      );
    }
    // Every duty names a defeated job, so none is covered.
    expect(r.lines.filter((l) => l.includes("not covered (the charter's never list forbids"))).toHaveLength(jobs.length);
    const display = createDisplay(charter, CATALOGUE, r.lines);
    const head = display.slice(0, display.indexOf(`\nconfig/agents/${charter.id}.json:\n`));
    expect(head.length).toBeGreaterThan(0);
    expect(head.length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
  });
});

describe("the update floor: a request that sets never is bounded by an empty never list", () => {
  const FORBIDS = ["git_push", "gh_pr_create", "gh_pr_close", "gh_issue_create"];
  const total = (lines: readonly string[]) => lines.join("\n").length;

  it("a never-only request's floor is exactly the block an empty never gives: the duty lines it covers and no never line", () => {
    const charter = ticketCharter(FORBIDS);
    const actual = readiness(charter, "update");
    expect(neverLines(actual)).toHaveLength(1);
    const empty = readiness(ticketCharter([]), "update");
    const floor = readinessFloorLines(charter, CATALOGUE, actual, { tools: false, workspaces: false, never: true });
    expect(floor).toEqual(empty.lines);
    // The request's own block is longer: counting it as the floor (a never-blind floor) would not be a lower bound.
    expect(total(actual.lines)).toBeGreaterThan(total(empty.lines));
  });

  it("with the tools or the workspaces set too, the floor is still no longer than the block an empty never gives", () => {
    const charter = ticketCharter(FORBIDS);
    const actual = readiness(charter, "update");
    const empty = readiness(ticketCharter([]), "update");
    for (const sets of [
      { tools: true, workspaces: false, never: true },
      { tools: false, workspaces: true, never: true },
      { tools: true, workspaces: true, never: true },
    ]) {
      const floor = readinessFloorLines(charter, CATALOGUE, actual, sets);
      expect(neverLines({ ...actual, lines: floor }), JSON.stringify(sets)).toEqual([]);
      expect(total(floor), JSON.stringify(sets)).toBeLessThanOrEqual(total(empty.lines));
    }
  });
});

describe("the update floor is a true lower bound: a never-only request on a duty naming several granted jobs", () => {
  // The review's case: five granted jobs on every duty. Its covered line names all five labels, longer than the
  // not-covered line naming one defeated job, so the line an empty never gives is not the shortest any never gives.
  const JOBS: ToolJob[] = ["ask_for_approval", "message_agents", "notify_owner", "manage_playbooks", "automate_tickets"];
  const total = (lines: readonly string[]) => lines.join("\n").length;
  const many = (count: number, never: readonly string[]) =>
    charterOf(
      Array.from({ length: count }, (_, i) => duty(`Duty number ${i + 1} for the owner`, ...JOBS)),
      JOBS,
      never,
    );

  for (const count of [1, 4, 10, 20]) {
    it(`${count} duties: the floor of every never request is no longer than the block of any never request`, () => {
      const nevers: string[][] = [[], ["gh_pr_create"], ["git_push", "gh_pr_create"], [...NEVER_CATEGORIES]];
      const blocks = nevers.map((never) => total(readiness(many(count, never), "update").lines));
      for (const never of nevers) {
        const charter = many(count, never);
        const floor = total(readinessFloorLines(charter, CATALOGUE, readiness(charter, "update"), { tools: false, workspaces: false, never: true }));
        for (const [k, block] of blocks.entries()) expect(floor, `never ${JSON.stringify(never)} vs ${JSON.stringify(nevers[k])}`).toBeLessThanOrEqual(block);
      }
      // From four duties the defeated block is the shorter one: the empty-never block is not the floor.
      if (count >= 4) expect(blocks[1]).toBeLessThan(blocks[0] as number);
    });
  }

  it("the floor's duty line is the defeated form readiness emits, word for word", () => {
    const charter = many(1, ["gh_pr_create"]);
    const actual = readiness(charter, "update");
    const floor = readinessFloorLines(charter, CATALOGUE, readiness(many(1, []), "update"), { tools: false, workspaces: false, never: true });
    expect(floor[1]).toBe(actual.lines[1]);
    expect(floor[1]).toBe(`  flagged: duty 1 not covered (the charter's never list forbids what ${TICKETS} needs): Duty number 1 for the owner`);
  });
});

/** A seeded PRNG (mulberry32), so a failure replays. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: readinessFloorLines is a lower bound for every combination of tools, workspaces and never", () => {
  const total = (lines: readonly string[]) => lines.join("\n").length;
  const PREFIXES = ["git status", "git diff", "npm test", "gh pr view"];
  const GRANTABLE = TOOL_JOB_IDS.filter((j) => (CATALOGUE.jobs.find((c) => c.id === j)?.tools.length ?? 0) > 0);

  it("for 80 generated charters, every request changing only the set fields has a block no shorter than the floor", () => {
    const usable = join(tmp, "ws-usable");
    mkdirSync(join(usable, ".git"), { recursive: true });
    writeFileSync(join(usable, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n');
    const plain = join(tmp, "ws-plain");
    mkdirSync(plain);
    const WORKSPACES: string[][] = [[], [usable], [plain], [plain, usable]];
    const rnd = prng(0x25a9);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const subset = <T>(xs: readonly T[], p: number): T[] => xs.filter(() => rnd() < p);
    const policy = () => {
      // Often every job, or every job but the fix and the merge (one never line, not three), so duties whose jobs
      // are all granted (the long covered lines a defeated line can undercut) are common.
      const mode = rnd();
      const granted =
        mode < 0.3 ? [...GRANTABLE] : mode < 0.6 ? GRANTABLE.filter((j) => j !== "triage_pr_comments" && j !== "ask_for_merge") : subset(GRANTABLE, rnd());
      return { tools: ["Read", ...(rnd() < 0.3 ? ["Bash"] : []), ...granted.flatMap(toolsOf)], prefixes: subset(PREFIXES, 0.3) };
    };
    const neverOf = (): string[] => (rnd() < 0.2 ? [] : rnd() < 0.2 ? [...NEVER_CATEGORIES] : rnd() < 0.3 ? [pick(NEVER_CATEGORIES)] : subset(NEVER_CATEGORIES, rnd()));
    const build = (duties: unknown[], p: { tools: string[]; prefixes: string[] }, never: string[], workspaces: string[]): Charter | undefined => {
      const r = validateCharter(
        {
          id: "dev",
          display_name: "Dev",
          avatar: { shape: "crab", hue: "crew-teal" },
          persona: "A developer.",
          duties,
          boundaries: [],
          model: "claude-sonnet-5",
          permission_mode: "default",
          tool_policy: { allowedTools: p.tools, allowedBashPrefixes: p.prefixes, never },
          workspaces,
        },
        { dataDir },
      );
      return r.ok ? r.charter : undefined;
    };
    const SETS = [false, true].flatMap((tools) => [false, true].flatMap((workspaces) => [false, true].map((never) => ({ tools, workspaces, never }))));
    let checked = 0;
    for (let c = 0; c < 80; c += 1) {
      const duties = Array.from({ length: 1 + Math.floor(rnd() * 16) }, (_, i) => {
        // Most duties name the ticket job (which every outward never category defeats) among up to six jobs, mostly
        // granted ones: the long covered lines a not-covered line naming one defeated job can undercut.
        const jobs = [...new Set([...(rnd() < 0.6 ? (["automate_tickets"] as ToolJob[]) : []), ...Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => pick(rnd() < 0.8 ? GRANTABLE : TOOL_JOB_IDS))])];
        return duty(rnd() < 0.3 ? `Duty ${i + 1}` : `Duty ${i + 1}: ${"a long duty text that runs past the excerpt cut ".repeat(3)}`, ...jobs);
      });
      const base = { p: policy(), never: neverOf(), ws: pick(WORKSPACES) };
      const charter = build(duties, base.p, base.never, base.ws);
      expect(charter, `charter ${c}`).toBeDefined();
      if (charter === undefined) continue;
      const actual = readiness(charter, "update");
      for (const sets of SETS) {
        const floorLines = readinessFloorLines(charter, CATALOGUE, actual, sets);
        const floor = total(floorLines);
        // The request itself, the extremes of each set field, and random values of them.
        const variants: { p: { tools: string[]; prefixes: string[] }; never: string[]; ws: string[] }[] = [base];
        for (let v = 0; v < 6; v += 1) {
          variants.push({
            p: sets.tools ? (v === 0 ? { tools: [], prefixes: [] } : v === 1 ? { tools: ["Read", ...GRANTABLE.flatMap(toolsOf)], prefixes: [] } : policy()) : base.p,
            // One category the ticket run admits: the shortest never line, and every duty naming the job defeated.
            never: sets.never ? (v === 0 ? [] : v === 1 ? [...NEVER_CATEGORIES] : v === 2 ? [pick(neverCategoriesAdmitted(AUTOMATE_RUN_POLICY))] : neverOf()) : base.never,
            ws: sets.workspaces ? (v < WORKSPACES.length ? (WORKSPACES[v] as string[]) : pick(WORKSPACES)) : base.ws,
          });
        }
        for (const v of variants) {
          const other = build(duties, v.p, v.never, v.ws);
          if (other === undefined) continue;
          checked += 1;
          const lines = readiness(other, "update").lines;
          const where = `charter ${c}, sets ${JSON.stringify(sets)}, request ${JSON.stringify(v)}`;
          expect(floor, where).toBeLessThanOrEqual(total(lines));
          // Line by line too, for the duty lines (right after the heading in both): each at most its real length.
          for (let d = 1; d <= duties.length; d += 1) expect((floorLines[d] ?? "").length, `${where}, duty ${d}`).toBeLessThanOrEqual((lines[d] ?? "").length);
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  }, 60_000);
});

describe("the update's ask-for-less names only the fields the request sets", () => {
  const ch = (never: readonly string[]) => ({ tool_policy: { allowedTools: [], allowedBashPrefixes: [], never: never as NeverCategory[] } });
  const ask = (fields: string[], never: readonly string[] = []) => updateAskLess({ changes: fields.map((field) => ({ field })), charter: ch(never) });

  it("every combination of tool_policy, workspaces and never", () => {
    expect(ask(["tool_policy"])).toBe("fewer or shorter tools or prefixes");
    expect(ask(["workspaces"])).toBe("fewer or shorter workspaces");
    expect(ask(["tool_policy", "workspaces"])).toBe("fewer or shorter tools, prefixes or workspaces");
    expect(ask(["never"], ["gh_pr_create"])).toBe(UPDATE_ASK_LESS_NEVER);
    expect(ask(["tool_policy", "never"], ["gh_pr_create"])).toBe(`fewer or shorter tools or prefixes; ${UPDATE_ASK_LESS_NEVER}`);
    expect(ask(["workspaces", "never"], ["gh_pr_create"])).toBe(`fewer or shorter workspaces; ${UPDATE_ASK_LESS_NEVER}`);
    expect(ask(["tool_policy", "workspaces", "never"], ["gh_pr_create"])).toBe(`fewer or shorter tools, prefixes or workspaces; ${UPDATE_ASK_LESS_NEVER}`);
    // An empty never can't be shortened: it is not named.
    expect(ask(["tool_policy", "never"], [])).toBe("fewer or shorter tools or prefixes");
    expect(ask(["never"], [])).toBe("shorter new values for the fields it changes");
  });

  it("a request setting none of those names its own fields, never tools, prefixes or workspaces", () => {
    expect(ask(["display_name"])).toBe("shorter values for display_name");
    expect(ask(["model", "limits.tokens_per_day"])).toBe("shorter values for model and limits.tokens_per_day");
    expect(ask(["never", "model"], ["git_push"])).toBe(`${UPDATE_ASK_LESS_NEVER}; shorter values for model`);
  });

  it("the never advice is the owner's choice, never Wright's own change to the never list", () => {
    expect(UPDATE_ASK_LESS_NEVER).toContain("the owner's decision, never a change you make to the never list on your own");
    expect(UPDATE_ASK_LESS_NEVER).not.toMatch(/tools|prefixes|workspaces/);
  });
});
