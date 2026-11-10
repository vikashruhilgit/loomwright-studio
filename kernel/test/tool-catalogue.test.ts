// The kernel's tool catalogue (phase 8 item 16, subtask 1): every kernel tool
// a crew session can be granted, with one job and one purpose line, generated
// from the registered tools (`kernel/src/features/catalogue.ts`), and published
// in the drafting tools' descriptions (`kernelToolDefinitions`,
// `kernel/src/tools/server.ts`). AC1, AC2, AC6 and AC9 (the descriptions half);
// the charter display's job grouping (AC3, kernel half) is pinned beside the
// display's other pins in `agents-charter-tools.test.ts`.
//
// The catalogue text format the drafting descriptions carry (after a blank
// line): five plain sentences, then per job `Job <id> "<label>":` and per tool
// `- <name>: <purpose>` (plus ` [needs the <kind> connector grant]` or
// ` [needs the <kind> connector's write grant]`).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_UNAVAILABLE_TEXT,
  DISPLAY_CATALOGUE_UNAVAILABLE,
  DISPLAY_NOT_IN_CATALOGUE,
  GENERAL_JOB,
  TOOL_JOBS,
  TOOL_JOB_IDS,
  ToolCatalogueError,
  buildToolCatalogue,
  catalogueText,
  isToolJob,
  jobDisplayLines,
  purposeOf,
} from "../src/features/catalogue.js";
import type { ToolCatalogue } from "../src/features/catalogue.js";
import { InvalidContributionError, PHASE1_RESERVED, PHASE1_TOOL_NAMES, SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { ContributedTool } from "../src/features/index.js";
import { toolsForConnectors } from "../src/integrations/tool-filter.js";
import { PHASE1_DESCRIPTIONS } from "../src/tools/phase1-descriptions.js";
import { DRAFTING_TOOL_NAMES, LISTING_CTX, assertKernelToolsList, kernelToolCatalogue, kernelToolDefinitions } from "../src/tools/server.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** The registered tools: the phase 1 six's names, then every shipped contributed tool (merged as the daemon merges them). */
const SHIPPED_TOOLS: readonly ContributedTool[] = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;
const REGISTERED = [...PHASE1_TOOL_NAMES, ...SHIPPED_TOOLS.map((t) => t.name)];
const CATALOGUE: ToolCatalogue = buildToolCatalogue(SHIPPED_TOOLS);

/** The four jobs of the phase 8 walk, with the approved mockup's labels (`docs/design/mockups/chat-threads.html`, `const JOBS`). */
const WALK_JOBS = {
  automate_tickets: ["Hand tickets to /automate", ["kernel_automate_prepare", "kernel_automate_state"]],
  triage_pr_comments: ["Triage PR comments", ["kernel_github_pr_reply", "kernel_github_pr_comment", "kernel_github_pr_request_reviewers", "kernel_pr_route"]],
  ask_for_merge: ["Ask for a merge", ["kernel_automate_merge_check", "kernel_merge_approval_request"]],
  read_pr: ["Read a PR", ["kernel_github_pr_get", "kernel_github_pr_diff", "kernel_github_pr_files", "kernel_github_pr_comments"]],
} as const;

const published = (defs: readonly { name: string; description: string }[], name: string): string => {
  const d = defs.find((x) => x.name === name);
  if (d === undefined) throw new Error(`no tool ${name}`);
  return d.description;
};

/** A tool with a job outside the vocabulary, built past `mergeContributions` (which refuses it), so the catalogue build throws. */
const BAD_JOB_TOOL = defineTool({ name: "kernel_bad_job", job: "not_a_job" as never, description: "A tool with a bad job.", shape: {}, handler: () => ({}) });

describe("the catalogue covers every registered tool (AC1, AC6)", () => {
  it("AC1: every registered tool (the phase 1 six and every shipped contributed tool) appears exactly once, in registration order", () => {
    expect(CATALOGUE.tools.map((t) => t.name)).toEqual(REGISTERED);
    expect(new Set(CATALOGUE.tools.map((t) => t.name)).size).toBe(REGISTERED.length);
    // The jobs partition the tools: each tool is under exactly one job, and the jobs keep TOOL_JOBS order.
    expect(CATALOGUE.jobs.flatMap((j) => j.tools.map((t) => t.name)).sort()).toEqual([...REGISTERED].sort());
    expect(CATALOGUE.jobs.map((j) => j.id)).toEqual(TOOL_JOB_IDS.filter((id) => CATALOGUE.tools.some((t) => t.job === id)));
    for (const j of CATALOGUE.jobs) expect(j.label).toBe(TOOL_JOBS[j.id]);
  });

  it("AC1: every shipped contributed tool declares its job beside its name, from TOOL_JOBS (none relies on the general default)", () => {
    const undeclared = SHIPPED_TOOLS.filter((t) => t.job === undefined).map((t) => t.name);
    expect(undeclared, "tools with no job").toEqual([]);
    for (const t of SHIPPED_TOOLS) expect(isToolJob(t.job), t.name).toBe(true);
    for (const t of CATALOGUE.tools.slice(PHASE1_TOOL_NAMES.length)) {
      expect(t.job, t.name).toBe(SHIPPED_TOOLS.find((s) => s.name === t.name)?.job);
    }
  });

  it("AC1: every tool has a non-empty purpose that is never just Read-only. (the three Read-only. tools use their next sentence, marked read only)", () => {
    for (const t of CATALOGUE.tools) {
      expect(t.purpose.trim(), t.name).not.toBe("");
      expect(t.purpose, t.name).not.toMatch(/^Read-only\./);
      expect(t.purpose, t.name).not.toMatch(/\n/);
    }
    const purpose = (name: string) => CATALOGUE.tools.find((t) => t.name === name)?.purpose;
    expect(purpose("kernel_automate_merge_check")).toBe("Whether Loomwright may merge one parked pull request now (read only).");
    expect(purpose("kernel_pr_route")).toBe(
      "Where a comment on a pull request may be acted on, read fresh on every call (run state and the pull request's author, never a stored copy) (read only).",
    );
    expect(purpose("kernel_automate_state")).toMatch(/^Loomwright's \/automate state for your workspace that is a clone of the repo: .* \(read only\)\.$/);
    // Every purpose is its own tool's description's first sentence (or, after Read-only., the next): one source, never rewritten.
    for (const t of SHIPPED_TOOLS) {
      const p = purpose(t.name) as string;
      const head = p.endsWith(" (read only).") ? `${p.slice(0, -" (read only).".length)}.` : p;
      expect(t.description.replace(/\s+/g, " "), t.name).toContain(head);
    }
  });

  it("the four walk jobs carry the mockup's labels and exactly the walk's tools", () => {
    for (const [id, [label, tools]] of Object.entries(WALK_JOBS)) {
      const job = CATALOGUE.jobs.find((j) => j.id === id);
      expect(job?.label, id).toBe(label);
      expect(job?.tools.map((t) => t.name).sort(), id).toEqual([...tools].sort());
    }
    // Reading the comments is Read a PR's, as in the mockup; triage needs it too (the catalogue text says so).
    expect(CATALOGUE.tools.find((t) => t.name === "kernel_github_pr_comments")?.job).toBe("read_pr");
  });

  it("AC6: a tool with no feature job (the phase 1 six, a contributed tool without one) is under general, never dropped", () => {
    const phase1Only = buildToolCatalogue([]);
    expect(phase1Only.tools.map((t) => [t.name, t.job])).toEqual(PHASE1_TOOL_NAMES.map((n) => [n, GENERAL_JOB]));
    expect(phase1Only.jobs.map((j) => j.id)).toEqual([GENERAL_JOB]);
    expect(CATALOGUE.tools.find((t) => t.name === "kernel_task_list")).toEqual({
      name: "kernel_task_list",
      job: "general",
      purpose: "List tasks in id order, filtered by state, assignee_agent or parent_task_id (limit 1-200, default 50).",
    });
    const jobless = defineTool({ name: "kernel_jobless", description: "Do a thing. Then more.", shape: {}, handler: () => ({}) });
    expect(buildToolCatalogue([jobless]).tools.at(-1)).toEqual({ name: "kernel_jobless", job: "general", purpose: "Do a thing." });
  });

  it("a connector tool keeps its connector need; the catalogue and its lists are frozen", () => {
    expect(CATALOGUE.tools.find((t) => t.name === "kernel_github_pr_get")).toMatchObject({ requiresConnector: "github" });
    expect(CATALOGUE.tools.find((t) => t.name === "kernel_github_pr_reply")).toMatchObject({ requiresConnector: "github", requiresConnectorLevel: "write" });
    expect(CATALOGUE.tools.find((t) => t.name === "kernel_task_get")).not.toHaveProperty("requiresConnector");
    expect(Object.isFrozen(CATALOGUE)).toBe(true);
    expect(Object.isFrozen(CATALOGUE.tools)).toBe(true);
    expect(Object.isFrozen(CATALOGUE.jobs[0])).toBe(true);
    expect(Object.isFrozen(TOOL_JOBS)).toBe(true);
  });
});

describe("purposeOf and the build's refusals", () => {
  it("the first sentence; brackets and backticks never end one; a leading Read-only. takes the next sentence with (read only)", () => {
    expect(purposeOf("Get one task by id.")).toBe("Get one task by id.");
    expect(purposeOf("Ask for a charter: {id, persona. duties}. Then more.")).toBe("Ask for a charter: {id, persona. duties}.");
    expect(purposeOf("Read it (cut at 256 KiB. or less) now. More.")).toBe("Read it (cut at 256 KiB. or less) now.");
    expect(purposeOf("Run `a. b` here. More.")).toBe("Run `a. b` here.");
    expect(purposeOf("Read-only. Whether it may merge now. It never merges.")).toBe("Whether it may merge now (read only).");
    expect(purposeOf("Read-only.\n  Where it\n goes?  More.")).toBe("Where it goes (read only)?");
    expect(purposeOf("No stop at the end")).toBe("No stop at the end");
    expect(purposeOf("Read-only.")).toBe("");
    expect(purposeOf("   ")).toBe("");
  });

  it("refuses a name listed twice, a job outside TOOL_JOBS and a tool with no purpose (ToolCatalogueError); mergeContributions refuses the bad job first", () => {
    const tool = (name: string, description: string, job?: string) => defineTool({ name, ...(job === undefined ? {} : { job: job as never }), description, shape: {}, handler: () => ({}) });
    expect(() => buildToolCatalogue([tool("kernel_task_get", "Twice.")])).toThrow(ToolCatalogueError);
    expect(() => buildToolCatalogue([tool("kernel_a", "A.", "read_pr"), tool("kernel_a", "A.", "read_pr")])).toThrow(/kernel_a is listed twice/);
    expect(() => buildToolCatalogue([BAD_JOB_TOOL])).toThrow(/kernel_bad_job's job "not_a_job" is not one of automate_tickets, /);
    expect(() => buildToolCatalogue([tool("kernel_ro", "Read-only.", "read_pr")])).toThrow(/kernel_ro has no purpose line/);
    let err: unknown;
    try {
      mergeContributions([{ name: "probe", tools: [BAD_JOB_TOOL] }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as Error).message).toBe(`contribution probe: invalid tool: kernel_bad_job's job "not_a_job" is not one of ${TOOL_JOB_IDS.join(", ")}`);
    expect(mergeContributions([{ name: "probe", tools: [tool("kernel_ok", "Fine.", "read_pr")] }]).tools.map((t) => t.job)).toEqual(["read_pr"]);
  });
});

describe("the catalogue in Wright's drafting context (AC2, AC9)", () => {
  it("AC2: kernelToolDefinitions publishes the catalogue text after the descriptions of kernel_agent_create, kernel_agent_update, kernel_playbook_create and kernel_playbook_update, and nowhere else", () => {
    const defs = kernelToolDefinitions(LISTING_CTX, SHIPPED_TOOLS);
    const text = catalogueText(CATALOGUE);
    expect(DRAFTING_TOOL_NAMES).toEqual(["kernel_agent_create", "kernel_agent_update", "kernel_playbook_create", "kernel_playbook_update"]);
    for (const name of DRAFTING_TOOL_NAMES) {
      const own = SHIPPED_TOOLS.find((t) => t.name === name)?.description as string;
      expect(published(defs, name), name).toBe(`${own}\n\n${text}`);
    }
    for (const t of SHIPPED_TOOLS.filter((x) => !DRAFTING_TOOL_NAMES.includes(x.name))) expect(published(defs, t.name), t.name).toBe(t.description);
    for (const name of PHASE1_TOOL_NAMES) expect(published(defs, name), name).toBe(PHASE1_DESCRIPTIONS[name]);
  });

  it("AC2: the text names every job (id and label) and every tool with its purpose and connector need, how to grant a job, and that triage also needs Read a PR", () => {
    const text = catalogueText(CATALOGUE);
    const lines = text.split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "The kernel's tool catalogue: every kernel tool a crew member can be granted, by job.",
      "To give a crew member a job, list every tool of that job in its tool_policy.allowedTools as mcp__kernel__<tool>; draft the list from the jobs the owner's words need.",
      "Tell the owner the jobs in plain words, never the tool names.",
      "A tool marked [needs the … grant] is offered only to a member holding that connector grant. The grant is the owner's: a create may propose it in connectors, the owner sets the write level in Team, and kernel_agent_update never changes it.",
      "Triage PR comments also needs Read a PR, to read the comments.",
    ]);
    const job = (id: string) => lines.indexOf(`Job ${id} "${TOOL_JOBS[id as keyof typeof TOOL_JOBS]}":`);
    expect(lines.slice(job("ask_for_merge"), job("ask_for_merge") + 3)).toEqual([
      'Job ask_for_merge "Ask for a merge":',
      "- kernel_automate_merge_check: Whether Loomwright may merge one parked pull request now (read only). [needs the github connector's write grant]",
      "- kernel_merge_approval_request: Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio. [needs the github connector's write grant]",
    ]);
    expect(lines).toContain("- kernel_github_pr_get: Read one pull request's metadata and description from GitHub (read-only). [needs the github connector grant]");
    expect(lines).toContain("- kernel_task_get: Get one task by id.");
    for (const j of CATALOGUE.jobs) expect(job(j.id), j.id).toBeGreaterThan(4);
    for (const t of CATALOGUE.tools) expect(lines.some((l) => l.startsWith(`- ${t.name}: ${t.purpose}`)), t.name).toBe(true);
  });

  it("the composition's unfiltered catalogue reaches a session whose own grants narrow its tools: Wright with no GitHub grant still sees the walk jobs", () => {
    const narrowed = toolsForConnectors(SHIPPED_TOOLS, []);
    expect(narrowed.some((t) => t.name === "kernel_github_pr_get")).toBe(false);
    const defs = kernelToolDefinitions(LISTING_CTX, narrowed, kernelToolCatalogue(SHIPPED_TOOLS));
    expect(published(defs, "kernel_agent_create")).toContain('Job read_pr "Read a PR":\n- kernel_github_pr_get: ');
    expect(published(defs, "kernel_agent_create")).toContain('Job automate_tickets "Hand tickets to /automate":');
    // Without the composition's catalogue, the default is the given list's own (here narrowed): what startKernel must not rely on.
    expect(published(kernelToolDefinitions(LISTING_CTX, narrowed), "kernel_agent_create")).not.toContain("kernel_github_pr_get");
  });

  it("AC9: a catalogue build that fails makes the drafting descriptions say it is unavailable and tell Wright to say it can't see the kernel's tools and draft no tool list", () => {
    const broken = [...SHIPPED_TOOLS, BAD_JOB_TOOL];
    expect(kernelToolCatalogue(broken)).toBeNull();
    const defs = kernelToolDefinitions(LISTING_CTX, broken);
    expect(CATALOGUE_UNAVAILABLE_TEXT).toContain("catalogue is unavailable");
    expect(CATALOGUE_UNAVAILABLE_TEXT).toContain("can't see the kernel's tools");
    expect(CATALOGUE_UNAVAILABLE_TEXT).toContain("draft no tool list");
    for (const name of DRAFTING_TOOL_NAMES) {
      const own = SHIPPED_TOOLS.find((t) => t.name === name)?.description as string;
      expect(published(defs, name), name).toBe(`${own}\n\n${CATALOGUE_UNAVAILABLE_TEXT}`);
      expect(published(defs, name), name).not.toContain("Job ");
    }
  });

  it("the longer descriptions still list through the Agent SDK: every tool, the catalogue included", async () => {
    await expect(assertKernelToolsList(SHIPPED_TOOLS)).resolves.toBeUndefined();
  });
});

describe("the job-grouped display lines (AC3's grouping, AC9's fallback)", () => {
  const K = "mcp__kernel__";

  it("none when no kernel tool is granted; one plain note when the catalogue is unavailable; never a guessed grouping", () => {
    expect(jobDisplayLines(["Read", "Bash", "mcp__other__x", K], CATALOGUE)).toEqual([]);
    expect(jobDisplayLines(["Read"], undefined)).toEqual([]);
    expect(jobDisplayLines(["Read", `${K}kernel_github_pr_get`], undefined)).toEqual([DISPLAY_CATALOGUE_UNAVAILABLE]);
  });

  it("groups the granted kernel tools by job in TOOL_JOBS order, each tool's purpose in catalogue order; a kernel tool the catalogue lacks is listed by name under its own heading", () => {
    const granted = ["Read", `${K}kernel_task_list`, `${K}kernel_github_pr_comments`, `${K}kernel_automate_merge_check`, `${K}kernel_github_pr_get`, `${K}kernel_mcp_jira_x`, `${K}kernel_github_pr_get`];
    expect(jobDisplayLines(granted, CATALOGUE)).toEqual([
      "job: Ask for a merge",
      "  - Whether Loomwright may merge one parked pull request now (read only).",
      "job: Read a PR",
      "  - Read one pull request's metadata and description from GitHub (read-only).",
      "  - Read the comments on one pull request from GitHub (read-only): the conversation's comments, then the review comments on files.",
      "job: General",
      "  - List tasks in id order, filtered by state, assignee_agent or parent_task_id (limit 1-200, default 50).",
      `job: ${DISPLAY_NOT_IN_CATALOGUE}`,
      "  - kernel_mcp_jira_x",
    ]);
  });
});

describe("the catalogue's modules are CLI-safe leaves", () => {
  it("catalogue.ts and phase1-descriptions.ts never import the tool server, kernel.ts, the session manager or the Agent SDK; contribution.ts imports catalogue.ts, which imports it back only as types", () => {
    const importsOf = (file: string) => [...readFileSync(join(SRC, file), "utf8").matchAll(/^import (type )?.* from "([^"]+)";$/gm)].map((m) => ({ type: m[1] !== undefined, from: m[2] as string }));
    for (const file of ["features/catalogue.ts", "tools/phase1-descriptions.ts"]) {
      for (const i of importsOf(file)) expect(i.from, `${file} imports ${i.from}`).not.toMatch(/claude-agent-sdk|tools\/server|server\.js$|sessions\/manager|(^|\/)kernel\.js$|features\/index/);
    }
    expect(importsOf("features/catalogue.ts").filter((i) => i.from === "./contribution.js").every((i) => i.type)).toBe(true);
    expect(importsOf("tools/phase1-descriptions.ts").filter((i) => i.from === "../features/contribution.js").every((i) => i.type)).toBe(true);
  });

  it("the phase 1 descriptions are the server's (one record, every phase 1 tool, frozen)", () => {
    expect(Object.keys(PHASE1_DESCRIPTIONS)).toEqual([...PHASE1_TOOL_NAMES]);
    expect(Object.isFrozen(PHASE1_DESCRIPTIONS)).toBe(true);
  });
});
