// @vitest-environment jsdom
// A held charter's approval card in plain language (phase 8 item 16, AC3 app
// half): the granted kernel tools grouped by job, with their purpose lines,
// before any raw `mcp__kernel__` name; the raw lines beneath, in the "Kernel
// tool names, as enforced" disclosure. The kernel's readiness block (item
// 18b, AC12) is first in the plain section, ahead of the job lines. Drawn directly (`CharterDisplay`) and
// on the Approvals screen, which uses it only for a held charter create or
// update whose display has the kernel's plain block.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Approval, McpCapability, StudioBridge } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import { CHOOSE_ACCESS, CONNECT_TRACKER } from "../chat/CharterCard";
import { ApprovalsScreen } from "./ApprovalsScreen";
import { ADDS, ADDS_TOOLS, CharterDisplay, JOBS_HEADING, KEEPS, RAW_SUMMARY, READINESS_HEADING, READINESS_STATUS_LABELS, SHOW_DETAILS } from "./CharterDisplay";
import { printable } from "./printable";
import {
  CHARTER_CATALOGUE_UNAVAILABLE,
  CHARTER_READINESS_COVERED_PREFIX,
  CHARTER_READINESS_FLAG_PREFIX,
  CHARTER_READINESS_NOT_CHECKED_PREFIX,
  CHARTER_READINESS_READY_PREFIX,
  charterDisplayParts,
} from "./subject";
import type { CharterDisplayParts } from "./subject";

const K = "mcp__kernel__";
const ESC = "\u001b";
const RLO = "\u202e";
const RAW = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/**
 * The phase 8 walk charter's create display, as the kernel's `createDisplay`
 * wrote it over the shipped catalogue at commit 27fbba3 (Mason holding the
 * walk's nine kernel tools, `MASON_TOOLS` in `kernel/test/phase-8-exit.test.ts`).
 * Its `role.md` tail is cut after a few lines, as the kernel's own cut may cut it.
 */
const WALK_DISPLAY = [
  "Create crew member mason (\"Mason\", crab crew-teal), proposed by Wright",
  "job: Hand tickets to /automate",
  "  - Hand tickets to Loomwright's /automate.",
  "  - Loomwright's /automate state for your workspace that is a clone of the repo: live (with the run id; start no run), parked (the parked items with their reason and PR) or idle (read only).",
  "job: Triage PR comments",
  "  - Reply in one review comment's thread on a pull request on GitHub.",
  "  - Comment on a pull request's conversation on GitHub.",
  "  - Ask for, or re-request, reviews on a pull request on GitHub from the named users.",
  "  - Where a comment on a pull request may be acted on, read fresh on every call (run state and the pull request's author, never a stored copy) (read only).",
  "job: Ask for a merge",
  "  - Whether Loomwright may merge one parked pull request now (read only).",
  "  - Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.",
  "job: Read a PR",
  "  - Read the comments on one pull request from GitHub (read-only): the conversation's comments, then the review comments on files.",
  "enforced: never: git_push; tools: Read, Bash, mcp__kernel__kernel_automate_prepare, mcp__kernel__kernel_automate_state, mcp__kernel__kernel_automate_merge_check, mcp__kernel__kernel_merge_approval_request, mcp__kernel__kernel_pr_route, mcp__kernel__kernel_github_pr_comments, mcp__kernel__kernel_github_pr_reply, mcp__kernel__kernel_github_pr_comment, mcp__kernel__kernel_github_pr_request_reviewers; bash prefixes: \"gh pr\"; connectors: github",
  "limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
  "workspaces: /tmp/work/sandbox",
  "config/agents/mason.json:",
  "{",
  "  \"model\": \"claude-sonnet-5\",",
  "  \"permission_mode\": \"default\",",
  "  \"tool_policy\": {",
  "    \"allowedTools\": [",
  "      \"Read\",",
  "      \"Bash\",",
  "      \"mcp__kernel__kernel_automate_prepare\",",
  "      \"mcp__kernel__kernel_automate_state\",",
  "      \"mcp__kernel__kernel_automate_merge_check\",",
  "      \"mcp__kernel__kernel_merge_approval_request\",",
  "      \"mcp__kernel__kernel_pr_route\",",
  "      \"mcp__kernel__kernel_github_pr_comments\",",
  "      \"mcp__kernel__kernel_github_pr_reply\",",
  "      \"mcp__kernel__kernel_github_pr_comment\",",
  "      \"mcp__kernel__kernel_github_pr_request_reviewers\"",
  "    ],",
  "    \"allowedBashPrefixes\": [",
  "      \"gh pr\"",
  "    ]",
  "  },",
  "  \"never\": [",
  "    \"git_push\"",
  "  ],",
  "  \"limits\": {",
  "    \"tokens_per_day\": 200000,",
  "    \"sessions_at_once\": 1",
  "  },",
  "  \"workspaces\": [",
  "    \"/tmp/work/sandbox\"",
  "  ],",
  "  \"connectors\": [",
  "    \"github\"",
  "  ]",
  "}",
  "memory/mason/role.md:",
  "# Mason",
  "",
  "You are Mason (id `mason`), a crew member in Loomwright Studio.",
].join("\n");

/**
 * The update display the kernel pins (`kernel/test/agents-charter-tools.test.ts`, "a held update shows the result's kernel tools by job"):
 * Mason held only kernel_github_pr_get, so the update adds Ask for a merge and keeps Read a PR.
 */
const NEXT = ["Read", `${K}kernel_github_pr_get`, `${K}kernel_automate_merge_check`, `${K}kernel_merge_approval_request`];
const UPDATE_DISPLAY = [
  'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright',
  "job: Ask for a merge (added)",
  "  - Whether Loomwright may merge one parked pull request now (read only).",
  "  - Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.",
  "job: Read a PR",
  "  - Read one pull request's metadata and description from GitHub (read-only).",
  `tool_policy: ${JSON.stringify({ allowedTools: ["Read", `${K}kernel_github_pr_get`], allowedBashPrefixes: [] })} → ${JSON.stringify({ allowedTools: NEXT, allowedBashPrefixes: [] })}`,
  `enforced: never: git_push; tools: ${NEXT.join(", ")}; bash prefixes: none`,
].join("\n");

/** A create granting no kernel tool, held before the kernel wrote a readiness block: the display is as it always was (no plain block). */
const NO_KERNEL_DISPLAY = [
  'Create crew member nell ("Nell", crab crew-teal), proposed by Wright',
  "enforced: never: none; tools: Read; bash prefixes: none",
  "limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
  "workspaces: /tmp/work/sandbox",
].join("\n");

/** The kernel's display when its catalogue could not be built (AC9). */
const UNAVAILABLE_DISPLAY = [
  'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
  CHARTER_CATALOGUE_UNAVAILABLE,
  `enforced: never: none; tools: Read, ${K}kernel_github_pr_get; bash prefixes: none`,
].join("\n");

/**
 * Approval #19's charter as the kernel holds it now (phase 8 item 18b; `docs/architecture/agents.md`
 * §"The readiness check"): the readiness block right after the head, then the jobs, then the raw lines.
 */
const READINESS_LINES = [
  "readiness: checked by the kernel before you see it",
  `${CHARTER_READINESS_COVERED_PREFIX}duty 1 by Hand tickets to /automate: Turn tickets into PRs`,
  `${CHARTER_READINESS_FLAG_PREFIX}duty 2 not covered (needs Triage PR comments, which this charter does not grant): Triage PR comments`,
  `${CHARTER_READINESS_FLAG_PREFIX}duty 3 not covered (needs Ask for a merge, which this charter does not grant): Ask for merges`,
  `${CHARTER_READINESS_NOT_CHECKED_PREFIX}copy of a repo for Hand tickets to /automate: can't tell whether it has one (/w can't be read (EACCES))`,
  `${CHARTER_READINESS_READY_PREFIX}GitHub access for Read a PR: proposed in this charter`,
];
const READINESS_DISPLAY = [
  'Create crew member devon ("Devon", crab crew-teal), proposed by Wright',
  ...READINESS_LINES,
  "job: Hand tickets to /automate",
  "  - Hand tickets to Loomwright's /automate.",
  "job: Read a PR",
  "  - Read one pull request's metadata and description from GitHub (read-only).",
  `enforced: never: none; tools: ${K}kernel_automate_prepare, ${K}kernel_github_pr_get; bash prefixes: none; connectors: github`,
  "workspaces: /w",
].join("\n");

/** A create granting no kernel tool, as the kernel holds it now: the readiness block and no job line. */
const READINESS_NO_KERNEL_DISPLAY = [
  'Create crew member nell ("Nell", crab crew-teal), proposed by Wright',
  "readiness: checked by the kernel before you see it",
  `${CHARTER_READINESS_COVERED_PREFIX}duty 1 with no tool (it needs no kernel tool): Watch my site's uptime every morning.`,
  "enforced: never: none; tools: Read; bash prefixes: none",
  "workspaces: none",
].join("\n");

function parts(display: string): CharterDisplayParts {
  const p = charterDisplayParts(display);
  if (p === undefined) throw new Error("no plain block");
  return p;
}

/** The card's text outside its disclosure. */
function textOutsideRaw(card: HTMLElement): string {
  const copy = card.cloneNode(true) as HTMLElement;
  copy.querySelector("details")?.remove();
  return copy.textContent ?? "";
}

/** Press Show full details (the details start hidden, the owner's 2026-11-10 decision). */
function openDetails(scope: HTMLElement = document.body): void {
  fireEvent.click(within(scope).getByRole("button", { name: SHOW_DETAILS }));
}

/**
 * Every line after the plain block as the details show it: the enforced lines, then each file block under its
 * kernel header line (`config/agents/<id>.json:`, `memory/<id>/role.md:`), joined back as the kernel wrote them.
 */
function rawShown(scope: ParentNode = document): string {
  const out: string[] = [];
  for (const kind of ["enforced", "settings", "role"]) {
    const block = scope.querySelector(`[data-testid="charter-block-${kind}"]`);
    if (block === null) continue;
    const text = block.querySelector('[data-testid="charter-block-text"]')?.textContent ?? "";
    const path = block.querySelector(".approvals-charter-block-path")?.textContent;
    out.push(path === null || path === undefined ? text : `${path}:\n${text}`);
  }
  return out.join("\n");
}

/** Whether `a` comes before `b` in the document. */
function before(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { api?: StudioBridge }).api;
  window.location.hash = "";
});

describe("CharterDisplay", () => {
  it("AC3: the walk charter's jobs, in plain words with their purposes, come before every raw kernel tool name", () => {
    render(<CharterDisplay parts={parts(WALK_DISPLAY)} display={WALK_DISPLAY} />);
    const card = screen.getByTestId("approval-display");
    expect(screen.getByTestId("charter-head").textContent).toBe('Create crew member mason ("Mason", crab crew-teal), proposed by Wright');
    expect(screen.getByRole("heading", { name: JOBS_HEADING })).toBeTruthy();
    const jobs = screen.getAllByTestId("charter-job");
    expect(jobs.map((j) => j.firstChild?.textContent)).toEqual(["Hand tickets to /automate", "Triage PR comments", "Ask for a merge", "Read a PR"]);
    expect(within(jobs[2] as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Whether Loomwright may merge one parked pull request now (read only).",
      "Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.",
    ]);
    // In reading order, once the details are shown: the last plain line is before the first raw name.
    openDetails();
    const text = card.textContent ?? "";
    const lastPlain = text.indexOf("Read the comments on one pull request from GitHub (read-only)");
    expect(lastPlain).toBeGreaterThan(0);
    expect(lastPlain).toBeLessThan(text.indexOf(K));
    expect(before(screen.getByTestId("charter-plain"), screen.getByTestId("charter-raw"))).toBe(true);
  });

  it("AC1/AC2: the raw names are inside the full details, hidden by default; shown, every later line is there exactly as the kernel wrote it", () => {
    render(<CharterDisplay parts={parts(WALK_DISPLAY)} display={WALK_DISPLAY} />);
    const card = screen.getByTestId("approval-display");
    const raw = screen.getByTestId("charter-raw") as HTMLDetailsElement;
    expect(raw.tagName).toBe("DETAILS");
    expect(raw.open).toBe(false);
    expect(raw.querySelector("summary")?.textContent).toBe(RAW_SUMMARY);
    // Hidden: nothing of the details is rendered, and no raw kernel name, JSON or file path shows.
    expect(raw.querySelector("pre")).toBeNull();
    expect(card.textContent).not.toContain(K);
    expect(card.textContent).not.toContain("config/agents/");
    expect(card.textContent).not.toContain('"tool_policy"');
    openDetails();
    expect(raw.open).toBe(true);
    // No raw kernel name outside the details.
    expect(textOutsideRaw(card)).not.toContain(K);
    const lines = WALK_DISPLAY.split("\n");
    const enforcedAt = lines.findIndex((l) => l.startsWith("enforced: "));
    expect(rawShown()).toBe(lines.slice(enforcedAt).join("\n"));
    const enforced = screen.getByTestId("charter-block-enforced").textContent ?? "";
    expect(enforced).toContain('enforced: never: git_push; tools: Read, Bash, mcp__kernel__kernel_automate_prepare, ');
    expect(enforced).toContain('bash prefixes: "gh pr"; connectors: github');
    // The owner may hide it again.
    fireEvent.click(screen.getByRole("button", { name: "Hide full details" }));
    expect(raw.open).toBe(false);
  });

  it("AC3: an update's jobs come before its field lines, whose raw names stay in the disclosure", () => {
    render(<CharterDisplay parts={parts(UPDATE_DISPLAY)} display={UPDATE_DISPLAY} />);
    const card = screen.getByTestId("approval-display");
    expect(screen.getAllByTestId("charter-job").map((j) => j.querySelector(".approvals-charter-job-label")?.textContent)).toEqual(["Ask for a merge", "Read a PR"]);
    expect(textOutsideRaw(card)).not.toContain(K);
    openDetails();
    expect(rawShown().split("\n").map((l) => l.split(":")[0])).toEqual(["tool_policy", "enforced"]);
  });

  it("an update shows the jobs it adds and the jobs it keeps (DESIGN: the charter card), and a new tool under a kept job, in plain words; a create shows neither mark", () => {
    render(<CharterDisplay parts={parts(UPDATE_DISPLAY)} display={UPDATE_DISPLAY} />);
    const jobs = screen.getAllByTestId("charter-job");
    expect(jobs.map((j) => [j.querySelector(".approvals-charter-job-label")?.textContent, j.querySelector(".approvals-charter-job-head .badge")?.textContent])).toEqual([
      ["Ask for a merge", ADDS],
      ["Read a PR", KEEPS],
    ]);
    // The mark is plain words, never the kernel's "(added)" text.
    expect(screen.getByTestId("charter-plain").textContent).not.toContain("(added)");
    cleanup();
    const keptJobGains = [
      'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright',
      "job: Ask for a merge",
      "  - Whether Loomwright may merge one parked pull request now (read only).",
      "  - Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio. (added)",
      `enforced: never: none; tools: ${K}kernel_automate_merge_check, ${K}kernel_merge_approval_request; bash prefixes: none`,
    ].join("\n");
    render(<CharterDisplay parts={parts(keptJobGains)} display={keptJobGains} />);
    const items = within(screen.getByTestId("charter-job")).getAllByRole("listitem");
    expect(items.map((li) => [li.firstChild?.textContent, li.querySelector(".badge")?.textContent ?? null])).toEqual([
      ["Whether Loomwright may merge one parked pull request now (read only).", null],
      ["Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.", ADDS],
    ]);
    expect(screen.getByTestId("charter-job").querySelector(".approvals-charter-job-head .badge")?.textContent).toBe(KEEPS);
    cleanup();
    render(<CharterDisplay parts={parts(WALK_DISPLAY)} display={WALK_DISPLAY} />);
    expect(screen.getByTestId("charter-plain").querySelector(".badge")).toBeNull();
  });

  it("an update's compact form shows a kept job that gains a tool as \"Adds tools\" (no purpose line to mark), never the kernel's text; a create shows no badge", () => {
    const compact = [
      'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright',
      "job: Ask for a merge (gains tools)",
      "job: Read a PR (added)",
      "job: General",
      "tool_policy: [] → as on the enforced line",
      `enforced: never: none; tools: ${K}kernel_automate_merge_check; bash prefixes: none`,
    ].join("\n");
    render(<CharterDisplay parts={parts(compact)} display={compact} />);
    const jobs = screen.getAllByTestId("charter-job");
    expect(jobs.map((j) => [j.querySelector(".approvals-charter-job-label")?.textContent, j.querySelector(".approvals-charter-job-head .badge")?.textContent])).toEqual([
      ["Ask for a merge", ADDS_TOOLS],
      ["Read a PR", ADDS],
      ["General", KEEPS],
    ]);
    expect(screen.getByTestId("charter-plain").textContent).not.toContain("(gains tools)");
    cleanup();
    const nell = 'Create crew member nell ("Nell", crab crew-teal), proposed by Wright\njob: Read a PR (gains tools)\nenforced: x';
    render(<CharterDisplay parts={parts(nell)} display={nell} />);
    expect(screen.getByTestId("charter-plain").querySelector(".badge")).toBeNull();
  });

  it("the kernel's compact form: every job by its label alone, no empty purpose list, still ahead of every raw kernel tool name", () => {
    const compact = [
      'Create crew member nell ("Nell", crab crew-teal), proposed by Wright',
      "job: Hand tickets to /automate",
      "job: Read a PR",
      "job: General",
      `enforced: never: none; tools: ${K}kernel_automate_prepare, ${K}kernel_github_pr_get, ${K}kernel_task_list; bash prefixes: none`,
      "limits: tokens_per_day not set (no limit); sessions_at_once not set (no limit); delegation_depth not set (no limit)",
      "workspaces: none",
    ].join("\n");
    render(<CharterDisplay parts={parts(compact)} display={compact} />);
    const card = screen.getByTestId("approval-display");
    const jobs = screen.getAllByTestId("charter-job");
    expect(jobs.map((j) => j.textContent)).toEqual(["Hand tickets to /automate", "Read a PR", "General"]);
    expect(jobs.every((j) => j.querySelector("ul") === null)).toBe(true);
    expect(textOutsideRaw(card)).not.toContain(K);
    expect(before(screen.getByTestId("charter-plain"), screen.getByTestId("charter-raw"))).toBe(true);
    openDetails();
    expect(rawShown()).toBe(compact.split("\n").slice(4).join("\n"));
  });

  it("AC9: with the kernel's catalogue unavailable, the kernel's note is shown and no grouping is guessed; the raw names follow", () => {
    render(<CharterDisplay parts={parts(UNAVAILABLE_DISPLAY)} display={UNAVAILABLE_DISPLAY} />);
    expect(screen.getByTestId("charter-note").textContent).toBe(CHARTER_CATALOGUE_UNAVAILABLE);
    expect(screen.queryByTestId("charter-jobs")).toBeNull();
    expect(screen.queryAllByTestId("charter-job")).toEqual([]);
    openDetails();
    expect(screen.getByTestId("charter-raw").textContent).toContain(`tools: Read, ${K}kernel_github_pr_get`);
  });

  it("every part is escaped text: an ANSI escape or a bidi override in the head, a purpose or a raw line never reaches the DOM raw, and markup stays text", () => {
    const hostile = [`Create crew member x ("x${RLO}", crab crew-teal), proposed by Wright`, `job: Read <b>a</b> PR`, `  - Read ${ESC}[31mit${ESC}[0m.`, `enforced: never: none; tools: ${K}kernel_github_pr_get${RLO}`].join("\n");
    const { container } = render(<CharterDisplay parts={parts(hostile)} display={hostile} />);
    const card = screen.getByTestId("approval-display");
    expect(card.textContent).not.toMatch(RAW);
    expect(screen.getByTestId("charter-head").textContent).toContain("x\\u202e");
    expect(screen.getByTestId("charter-job").textContent).toContain("Read \\x1b[31mit\\x1b[0m.");
    expect(screen.getByTestId("charter-job").firstChild?.textContent).toBe("Read <b>a</b> PR");
    expect(container.querySelector("b")).toBeNull();
    openDetails();
    expect(card.textContent).not.toMatch(RAW);
    expect(rawShown()).toBe(printable(`enforced: never: none; tools: ${K}kernel_github_pr_get${RLO}`, true));
  });
});

// ---- The readiness block (phase 8 item 18b, AC12) -----------------------------------

/** Each readiness line's [badge text, badge tone, line text]. */
function readinessRows(): [string | null | undefined, string | undefined, string | null | undefined][] {
  return screen.getAllByTestId("charter-readiness-line").map((li) => {
    const badge = li.querySelector(".badge") as HTMLElement | null;
    return [badge?.textContent, badge?.dataset.tone, li.querySelector(".approvals-charter-readiness-text")?.textContent];
  });
}

describe("CharterDisplay: the readiness block", () => {
  it("AC12: one line per duty and per job prerequisite, in the kernel's order, its status in plain words; flagged and not-checked lines in the attention tone, covered and ready neutral", () => {
    render(<CharterDisplay parts={parts(READINESS_DISPLAY)} display={READINESS_DISPLAY} />);
    expect(screen.getByRole("heading", { name: READINESS_HEADING })).toBeTruthy();
    expect(screen.getByRole("list", { name: READINESS_HEADING })).toBe(screen.getByTestId("charter-readiness"));
    expect(readinessRows()).toEqual([
      [READINESS_STATUS_LABELS.covered, "neutral", "duty 1 by Hand tickets to /automate: Turn tickets into PRs"],
      [READINESS_STATUS_LABELS.flagged, "attention", "duty 2 not covered (needs Triage PR comments, which this charter does not grant): Triage PR comments"],
      [READINESS_STATUS_LABELS.flagged, "attention", "duty 3 not covered (needs Ask for a merge, which this charter does not grant): Ask for merges"],
      [READINESS_STATUS_LABELS.not_checked, "attention", "copy of a repo for Hand tickets to /automate: can't tell whether it has one (/w can't be read (EACCES))"],
      [READINESS_STATUS_LABELS.ready, "neutral", "GitHub access for Read a PR: proposed in this charter"],
    ]);
    expect(Object.values(READINESS_STATUS_LABELS)).toEqual(["Covered", "Ready", "Flagged", "Not checked"]);
    // The kernel's own prefixes are not shown: the badge says the status.
    expect(screen.getByTestId("charter-readiness").textContent).not.toMatch(/covered: |flagged: |ready: |not checked: |readiness: /);
  });

  it("AC1 (18d): the block is in the plain section, after who, Can do, Never does and Limits, the jobs drawn as before; the raw lines stay in the details", () => {
    render(<CharterDisplay parts={parts(READINESS_DISPLAY)} display={READINESS_DISPLAY} />);
    const plain = screen.getByTestId("charter-plain");
    const block = screen.getByTestId("charter-readiness");
    expect(plain.contains(block)).toBe(true);
    expect(before(screen.getByTestId("charter-head"), block)).toBe(true);
    expect(before(screen.getByRole("heading", { name: JOBS_HEADING }), block)).toBe(true);
    expect(before(screen.getAllByTestId("charter-job")[1] as HTMLElement, block)).toBe(true);
    expect(before(screen.getByTestId("charter-never"), block)).toBe(true);
    expect(screen.getAllByTestId("charter-job").map((j) => j.querySelector(".approvals-charter-job-label")?.textContent)).toEqual(["Hand tickets to /automate", "Read a PR"]);
    expect(plain.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: JOBS_HEADING }).id);
    expect(textOutsideRaw(screen.getByTestId("approval-display"))).not.toContain(K);
    openDetails();
    expect(rawShown()).toBe(READINESS_DISPLAY.split("\n").slice(-2).join("\n"));
  });

  it("a charter granting no kernel tool shows the readiness block alone: no empty jobs heading, and the section is named by the block's heading", () => {
    render(<CharterDisplay parts={parts(READINESS_NO_KERNEL_DISPLAY)} display={READINESS_NO_KERNEL_DISPLAY} />);
    expect(readinessRows()).toEqual([[READINESS_STATUS_LABELS.covered, "neutral", "duty 1 with no tool (it needs no kernel tool): Watch my site's uptime every morning."]]);
    expect(screen.queryByRole("heading", { name: JOBS_HEADING })).toBeNull();
    expect(screen.queryByTestId("charter-jobs")).toBeNull();
    expect(screen.queryByTestId("charter-note")).toBeNull();
    expect(screen.getByRole("region", { name: READINESS_HEADING })).toBe(screen.getByTestId("charter-plain"));
    openDetails();
    expect(rawShown()).toBe(READINESS_NO_KERNEL_DISPLAY.split("\n").slice(3).join("\n"));
  });

  it("with the catalogue unavailable, the kernel's note comes first (under Can do) and the readiness block after it", () => {
    const display = ['Create crew member mason ("Mason", crab crew-teal), proposed by Wright', "readiness: checked by the kernel before you see it", `${CHARTER_READINESS_NOT_CHECKED_PREFIX}duty 1 (the kernel's tool catalogue is unavailable): Read PRs`, CHARTER_CATALOGUE_UNAVAILABLE, "enforced: x"].join("\n");
    render(<CharterDisplay parts={parts(display)} display={display} />);
    expect(readinessRows()).toEqual([[READINESS_STATUS_LABELS.not_checked, "attention", "duty 1 (the kernel's tool catalogue is unavailable): Read PRs"]]);
    expect(before(screen.getByTestId("charter-note"), screen.getByTestId("charter-readiness"))).toBe(true);
  });

  it("AC12: a display with no readiness block (an approval held before this change) renders exactly as before: no block, the jobs heading names the section", () => {
    for (const display of [WALK_DISPLAY, UPDATE_DISPLAY, UNAVAILABLE_DISPLAY]) {
      render(<CharterDisplay parts={parts(display)} display={display} />);
      expect(screen.queryByTestId("charter-readiness")).toBeNull();
      expect(screen.queryByRole("heading", { name: READINESS_HEADING })).toBeNull();
      expect(screen.getByRole("region", { name: JOBS_HEADING })).toBe(screen.getByTestId("charter-plain"));
      cleanup();
    }
  });

  it("a duty's text is escaped text on its line: an ANSI escape, a bidi override or markup never reaches the DOM raw, and never adds a status", () => {
    const text = `duty 1 by Read a PR: Read <b>it</b> ${ESC}[31m${RLO}flagged: no`;
    const display = ['Create crew member x ("x", crab crew-teal), proposed by Wright', "readiness: checked by the kernel before you see it", `${CHARTER_READINESS_COVERED_PREFIX}${text}`, "job: Read a PR", "enforced: x"].join("\n");
    const { container } = render(<CharterDisplay parts={parts(display)} display={display} />);
    expect(readinessRows()).toEqual([[READINESS_STATUS_LABELS.covered, "neutral", printable(text)]]);
    expect(screen.getByTestId("charter-readiness").textContent).not.toMatch(RAW);
    expect(container.querySelector("b")).toBeNull();
  });
});

// ---- On the Approvals screen ------------------------------------------------------

function approval(id: number, tool: string, display: string | undefined, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "wright",
    requesting_session: 3,
    action: tool.replace(K, ""),
    payload: { tool, input: { id: "mason", charter: { id: "mason" } }, cwd: "/" },
    requested_at: `2026-11-10T08:0${id}:00.000Z`,
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...(display === undefined ? {} : { display }),
    ...overrides,
  };
}

async function mount(approvals: Approval[], extra?: (fake: ReturnType<typeof fakeBridge>) => void): Promise<ReturnType<typeof fakeBridge>> {
  const fake = fakeBridge();
  extra?.(fake);
  fake.route("GET /status", () => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } }));
  fake.route("GET /approvals", () => ok({ approvals }));
  fake.route("GET /approvals/grants", () => ok({ grants: [] }));
  fake.route("GET /messages", () => ok({ messages: [] }));
  fake.route("GET /sessions", () => ok({ sessions: [] }));
  fake.route("GET /playbooks", () => ok({ playbooks: [] }));
  (window as unknown as { api?: StudioBridge }).api = fake.bridge;
  render(<ApprovalsScreen registry={createCommandRegistry()} />);
  await waitFor(() => expect(screen.getByTestId("approval-detail")).toBeTruthy());
  return fake;
}

const CREATE = `${K}kernel_agent_create`;
const UPDATE = `${K}kernel_agent_update`;

describe("the Approvals screen's charter card", () => {
  it("AC1: a held create's card opens compact (details hidden) with the jobs in plain words first and the raw names inside the details beneath", async () => {
    await mount([approval(1, CREATE, WALK_DISPLAY)]);
    const card = screen.getByTestId("approval-display");
    expect(card.tagName).toBe("DIV");
    expect(within(card).getAllByTestId("charter-job")).toHaveLength(4);
    expect((within(card).getByTestId("charter-raw") as HTMLDetailsElement).open).toBe(false);
    expect(card.textContent).not.toContain(K);
    openDetails(card);
    expect(textOutsideRaw(card)).not.toContain(K);
    expect(within(card).getByTestId("charter-raw").textContent).toContain(`${K}kernel_automate_prepare`);
    expect(before(within(card).getByTestId("charter-plain"), within(card).getByTestId("charter-raw"))).toBe(true);
  });

  it("AC3: a held update's card does too", async () => {
    await mount([approval(1, UPDATE, UPDATE_DISPLAY)]);
    const card = screen.getByTestId("approval-display");
    expect(within(card).getAllByTestId("charter-job").map((j) => j.querySelector(".approvals-charter-job-label")?.textContent)).toEqual(["Ask for a merge", "Read a PR"]);
    expect(within(card).getAllByTestId("charter-job").map((j) => j.querySelector(".badge")?.textContent)).toEqual([ADDS, KEEPS]);
    expect(textOutsideRaw(card)).not.toContain(K);
  });

  it("a charter granting no kernel tool held before the readiness block, or any other approval's display (even one shaped like a plain block), is the escaped <pre> as always", async () => {
    const shaped = "Post a comment\njob: Read a PR\n  - Read it.\nmore";
    await mount([approval(1, CREATE, NO_KERNEL_DISPLAY), approval(2, "mcp__github__comment", shaped, { action: "comment" })]);
    let display = screen.getByTestId("approval-display");
    expect(display.tagName).toBe("PRE");
    expect(display.textContent).toBe(printable(NO_KERNEL_DISPLAY, true));
    expect(screen.queryByTestId("charter-plain")).toBeNull();
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2"));
    display = screen.getByTestId("approval-display");
    expect(display.tagName).toBe("PRE");
    expect(display.textContent).toBe(shaped);
    expect(screen.queryByTestId("charter-plain")).toBeNull();
  });

  it("AC12: a held create carrying a readiness block shows it first in the plain section, flagged lines in the attention tone; one granting no kernel tool shows its block too, not the <pre>", async () => {
    await mount([approval(1, CREATE, READINESS_DISPLAY), approval(2, CREATE, READINESS_NO_KERNEL_DISPLAY)]);
    let card = screen.getByTestId("approval-display");
    expect(card.tagName).toBe("DIV");
    const block = within(card).getByTestId("charter-readiness");
    expect(before(within(card).getAllByTestId("charter-job")[1] as HTMLElement, block)).toBe(true);
    expect(within(block).getAllByTestId("charter-readiness-line").map((li) => li.querySelector(".badge")?.getAttribute("data-tone"))).toEqual(["neutral", "attention", "attention", "attention", "neutral"]);
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2"));
    card = screen.getByTestId("approval-display");
    expect(card.tagName).toBe("DIV");
    expect(within(card).getAllByTestId("charter-readiness-line")).toHaveLength(1);
    expect(within(card).queryByTestId("charter-jobs")).toBeNull();
  });

  it("the details' open state is each approval's own: showing them on one leaves the next hidden", async () => {
    await mount([approval(1, CREATE, WALK_DISPLAY), approval(2, UPDATE, UPDATE_DISPLAY)]);
    const first = screen.getByTestId("charter-raw") as HTMLDetailsElement;
    openDetails(screen.getByTestId("approval-display"));
    expect(first.open).toBe(true);
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2"));
    expect((screen.getByTestId("charter-raw") as HTMLDetailsElement).open).toBe(false);
  });
});

// ---- Phase 8 item 21b: a ticket duty's tracker, ticked on the Approvals screen ---------------------------

const TRACKER_CAPABILITIES: readonly McpCapability[] = [
  { id: "read", label: "Read tickets", changes: false, tools: ["clickup_get_task", "clickup_filter_tasks"] },
  { id: "delete", label: "Delete tickets", changes: true, tools: ["clickup_delete_task"] },
];

function trackerDisplay(line: string): string {
  return ['Create crew member mason ("Mason", crab crew-teal), proposed by Wright', "readiness: checked by the kernel before you see it", `${CHARTER_READINESS_FLAG_PREFIX}${line}`, "job: Hand tickets to /automate", "  - Hand tickets to Loomwright's /automate.", "enforced: never: none; tools: Read; bash prefixes: none"].join("\n");
}

const NO_ACCESS = "duty 1: Mason can't read ClickUp tickets yet: it has no ClickUp access (only you can grant it)";

function connectors(fake: ReturnType<typeof fakeBridge>, capabilities: readonly McpCapability[] | null = TRACKER_CAPABILITIES): void {
  fake.route("GET /connectors", () =>
    ok({
      connectors: [],
      mcp_connections: [{ kind: "clickup", server_url: null, status: "connected", granted_tools: ["clickup_get_task", "clickup_filter_tasks", "clickup_delete_task"], capabilities, other_tools: capabilities === null ? null : [], token_expiry: null }],
    }),
  );
}

describe("item 21b on the Approvals screen: a ticket duty's tracker", () => {
  it("AC14: the flagged tracker line offers Choose access, opening the capabilities with nothing ticked; Allow once with no tick posts {decision: once} only", async () => {
    const fake = await mount([approval(1, CREATE, trackerDisplay(NO_ACCESS))], connectors);
    const card = screen.getByTestId("approval-display");
    expect(within(card).getByTestId("charter-readiness").textContent).toContain("Mason can't read ClickUp tickets yet");
    fireEvent.click(within(card).getByRole("button", { name: CHOOSE_ACCESS }));
    const panel = await within(card).findByTestId("charter-tracker-panel");
    await within(panel).findByText("Read tickets");
    for (const box of within(panel).getAllByRole("checkbox")) expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Allow once/ }));
    await waitFor(() => expect(fake.requestsTo("POST /approvals/:id/approve")).toHaveLength(1));
    expect(fake.requestsTo("POST /approvals/:id/approve")[0]?.req.body).toEqual({ decision: "once" });
  });

  it("AC15: Allow once with ticks posts owner_grant naming the ticked capability's tools, however the decision is made (the A key too)", async () => {
    const fake = await mount([approval(1, CREATE, trackerDisplay(NO_ACCESS))], connectors);
    const card = screen.getByTestId("approval-display");
    fireEvent.click(within(card).getByRole("button", { name: CHOOSE_ACCESS }));
    const panel = await within(card).findByTestId("charter-tracker-panel");
    await within(panel).findByText("Read tickets");
    fireEvent.click(within(panel).getByRole("checkbox", { name: /Read tickets/ }));
    expect(within(panel).getByTestId("charter-tracker-clickup-read-state").textContent).toBe("granted");
    fireEvent.keyDown(document.body, { key: "a" });
    await waitFor(() => expect(fake.requestsTo("POST /approvals/:id/approve")).toHaveLength(1));
    expect(fake.requestsTo("POST /approvals/:id/approve")[0]?.req.body).toEqual({ decision: "once", owner_grant: { kind: "clickup", tools: ["clickup_get_task", "clickup_filter_tasks"] } });
  });

  it("AC18: a tracker that isn't connected offers Connect to Integrations and no Choose access", async () => {
    await mount([approval(1, CREATE, trackerDisplay("duty 1: ClickUp isn't connected on Integrations, so Mason can't read its tickets yet (connect it there first; only you can grant access)"))], connectors);
    const card = screen.getByTestId("approval-display");
    expect(within(card).queryByRole("button", { name: CHOOSE_ACCESS })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: CONNECT_TRACKER }));
    expect(window.location.hash).toBe("#/integrations");
  });

  it("a held charter with no tracker line shows no fix at all", async () => {
    await mount([approval(1, CREATE, WALK_DISPLAY)], connectors);
    const card = screen.getByTestId("approval-display");
    expect(within(card).queryByRole("button", { name: CHOOSE_ACCESS })).toBeNull();
    expect(within(card).queryByRole("button", { name: CONNECT_TRACKER })).toBeNull();
  });
});
