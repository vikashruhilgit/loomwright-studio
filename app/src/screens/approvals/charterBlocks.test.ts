// The charter display's details blocks and plain words (phase 8 item 18d):
// every line after the plain block lands in exactly one block, in the kernel's
// order; the never list, limits, other tools and Bash prefixes in words; what
// changed between two versions; and the repo names a workspace lookup tries.
import { describe, expect, it } from "vitest";
import { NEVER_CATEGORIES } from "../team/model";
import { BLOCK_TITLES, KERNEL_TOOL_PREFIX, NEVER_WORDS, charterBlocks, limitsWords, neverWords, repoCandidates, whatChanged } from "./charterBlocks";
import { CHARTER_CATALOGUE_UNAVAILABLE } from "./subject";

const K = KERNEL_TOOL_PREFIX;

const CREATE = [
  'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
  "readiness: checked by the kernel before you see it",
  "  covered: duty 1 by Hand tickets to /automate: Turn acme/widgets tickets into PRs",
  "  flagged: the code jobs: it has no copy of a repo to work in (no workspace is listed)",
  "job: Hand tickets to /automate",
  "  - Hand tickets to Loomwright's /automate.",
  "job: Read a PR",
  "  - Read one pull request.",
  `enforced: never: git_push, gh_pr_create; tools: Read, Bash, ${K}kernel_automate_prepare, ${K}kernel_github_pr_get; bash prefixes: "gh pr", "git status"; connectors: github`,
  "limits: tokens_per_day 200000 (proposed); sessions_at_once 2 (proposed); delegation_depth not set (no limit)",
  "workspaces: none",
  "config/agents/mason.json:",
  "{",
  '  "workspaces": []',
  "}",
  "memory/mason/role.md:",
  "# Mason",
  "",
  "Works on example/other and acme/widgets; see docs/a/b for notes.",
].join("\n");

describe("charterBlocks", () => {
  it("splits everything after the head and the readiness block into the four blocks, in order, losing no line", () => {
    const read = charterBlocks(CREATE);
    expect(read.total).toBe(CREATE.length);
    expect(read.blocks.map((b) => [b.kind, b.title, b.path])).toEqual([
      ["jobs", BLOCK_TITLES.jobs, undefined],
      ["enforced", BLOCK_TITLES.enforced, undefined],
      ["settings", BLOCK_TITLES.settings, "config/agents/mason.json"],
      ["role", BLOCK_TITLES.role, "memory/mason/role.md"],
    ]);
    const rebuilt = read.blocks.map((b) => (b.path === undefined ? b.text : `${b.path}:\n${b.text}`)).join("\n");
    expect(rebuilt).toBe(CREATE.split("\n").slice(4).join("\n"));
    expect(read.blocks[3]?.text.endsWith("see docs/a/b for notes.")).toBe(true);
  });

  it("reads the never list, limits, other tools and Bash prefixes in words; a kernel tool name never reaches the plain words", () => {
    const read = charterBlocks(CREATE);
    expect(read.never).toEqual(["Push to a git remote", "Open pull requests"]);
    expect(read.limits).toBe("200,000 tokens a day · 2 sessions at once · no delegation depth limit");
    expect(read.otherTools).toEqual(["Read", "Bash"]);
    expect(read.bashPrefixes).toEqual(["gh pr", "git status"]);
    expect(JSON.stringify([read.never, read.limits, read.otherTools])).not.toContain(K);
  });

  it("an unknown never category or limit part is shown as its own text, never dropped", () => {
    expect(neverWords("brand_new_category")).toBe("brand_new_category");
    expect(limitsWords("tokens_per_day 1 (proposed); widgets 3 (proposed)")).toBe("1 token a day · widgets 3 (proposed)");
    const none = charterBlocks(CREATE.replace("never: git_push, gh_pr_create", "never: none"));
    expect(none.never).toEqual([]);
  });

  it("names every kernel never category in words (mirrors NEVER_CATEGORIES)", () => {
    for (const category of NEVER_CATEGORIES) expect(Object.hasOwn(NEVER_WORDS, category), category).toBe(true);
    expect(Object.keys(NEVER_WORDS).sort()).toEqual([...NEVER_CATEGORIES].sort());
  });

  it("an update's display has the jobs and enforced blocks only (its field lines in the enforced block), and no limits line", () => {
    const update = ['Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright', "job: Read a PR (added)", "  - Read one pull request.", 'workspaces: [] → ["/w"]', `enforced: never: none; tools: ${K}kernel_github_pr_get; bash prefixes: none`].join("\n");
    const read = charterBlocks(update);
    expect(read.blocks.map((b) => b.kind)).toEqual(["jobs", "enforced"]);
    expect(read.blocks[1]?.text).toBe(update.split("\n").slice(3).join("\n"));
    expect(read.limits).toBeUndefined();
  });

  it("the catalogue-unavailable note is the jobs block; a display not in the kernel's format keeps every line after the head in one block", () => {
    const unavailable = ['Create crew member mason ("Mason", crab crew-teal), proposed by Wright', CHARTER_CATALOGUE_UNAVAILABLE, "enforced: never: none; tools: Read; bash prefixes: none"].join("\n");
    expect(charterBlocks(unavailable).blocks.map((b) => [b.kind, b.text])).toEqual([
      ["jobs", CHARTER_CATALOGUE_UNAVAILABLE],
      ["enforced", "enforced: never: none; tools: Read; bash prefixes: none"],
    ]);
    const odd = "Post a comment\nline two\nline three";
    expect(charterBlocks(odd).blocks.map((b) => b.text)).toEqual(["line two\nline three"]);
  });
});

describe("whatChanged", () => {
  it("names the jobs added or removed, a workspace set and limits changed", () => {
    const v2 = CREATE.replace("job: Read a PR\n  - Read one pull request.", "job: Triage PR comments\n  - Reply to comments.")
      .replace("workspaces: none", "workspaces: /Users/me/code/widgets")
      .replace("sessions_at_once 2 (proposed)", "sessions_at_once 1 (proposed)");
    expect(whatChanged(CREATE, v2)).toBe("adds Triage PR comments; removes Read a PR; workspace set; limits changed");
    expect(whatChanged(CREATE, CREATE)).toBe("no change to its jobs, workspace or limits");
  });
});

describe("repoCandidates", () => {
  it("finds the owner/repo names in the duty lines and role.md, each once, never a longer path", () => {
    expect(repoCandidates(CREATE)).toEqual(["acme/widgets", "example/other"]);
    expect(repoCandidates("Create crew member x (\"x\", crab crew-teal), proposed by Wright\nreadiness: checked by the kernel before you see it\n  covered: duty 1: watch https://github.com/a/b and src/a/b.ts\njob: X\n  - y\nenforced: x")).toEqual([]);
  });
});
