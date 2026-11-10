// @vitest-environment jsdom
// A held charter's approval card in plain language (phase 8 item 16, AC3 app
// half): the granted kernel tools grouped by job, with their purpose lines,
// before any raw `mcp__kernel__` name; the raw lines beneath, in the "Kernel
// tool names, as enforced" disclosure. Drawn directly (`CharterDisplay`) and
// on the Approvals screen, which uses it only for a held charter create or
// update whose display has the kernel's plain block.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Approval, StudioBridge } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import { ApprovalsScreen } from "./ApprovalsScreen";
import { ADDS, CharterDisplay, JOBS_HEADING, KEEPS, RAW_SUMMARY } from "./CharterDisplay";
import { printable } from "./printable";
import { CHARTER_CATALOGUE_UNAVAILABLE, charterDisplayParts } from "./subject";
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

/** A create granting no kernel tool: the display is as it always was (no plain block). */
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
    render(<CharterDisplay parts={parts(WALK_DISPLAY)} />);
    const card = screen.getByTestId("approval-display");
    expect(screen.getByTestId("charter-head").textContent).toBe('Create crew member mason ("Mason", crab crew-teal), proposed by Wright');
    expect(screen.getByRole("heading", { name: JOBS_HEADING })).toBeTruthy();
    const jobs = screen.getAllByTestId("charter-job");
    expect(jobs.map((j) => j.firstChild?.textContent)).toEqual(["Hand tickets to /automate", "Triage PR comments", "Ask for a merge", "Read a PR"]);
    expect(within(jobs[2] as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Whether Loomwright may merge one parked pull request now (read only).",
      "Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.",
    ]);
    // In reading order: the last plain line is before the first raw name.
    const text = card.textContent ?? "";
    const lastPlain = text.indexOf("Read the comments on one pull request from GitHub (read-only)");
    expect(lastPlain).toBeGreaterThan(0);
    expect(lastPlain).toBeLessThan(text.indexOf(K));
    expect(before(screen.getByTestId("charter-plain"), screen.getByTestId("charter-raw"))).toBe(true);
  });

  it("AC3: the raw names are inside the open \"Kernel tool names, as enforced\" disclosure, beneath, with every later line exactly as the kernel wrote it", () => {
    render(<CharterDisplay parts={parts(WALK_DISPLAY)} />);
    const card = screen.getByTestId("approval-display");
    const raw = screen.getByTestId("charter-raw") as HTMLDetailsElement;
    expect(raw.tagName).toBe("DETAILS");
    expect(raw.open).toBe(true);
    expect(raw.querySelector("summary")?.textContent).toBe(RAW_SUMMARY);
    // No raw kernel name outside the disclosure.
    expect(textOutsideRaw(card)).not.toContain(K);
    const pre = raw.querySelector("pre") as HTMLElement;
    const lines = WALK_DISPLAY.split("\n");
    const enforcedAt = lines.findIndex((l) => l.startsWith("enforced: "));
    expect(pre.textContent).toBe(lines.slice(enforcedAt).join("\n"));
    // Non-kernel tools and Bash prefixes are shown as today: on the enforced line, which is open.
    expect(pre.textContent).toContain('enforced: never: git_push; tools: Read, Bash, mcp__kernel__kernel_automate_prepare, ');
    expect(pre.textContent).toContain('bash prefixes: "gh pr"; connectors: github');
    // The owner may close it.
    fireEvent.click(raw.querySelector("summary") as HTMLElement);
    expect(raw.open).toBe(false);
  });

  it("AC3: an update's jobs come before its field lines, whose raw names stay in the disclosure", () => {
    render(<CharterDisplay parts={parts(UPDATE_DISPLAY)} />);
    const card = screen.getByTestId("approval-display");
    expect(screen.getAllByTestId("charter-job").map((j) => j.querySelector(".approvals-charter-job-label")?.textContent)).toEqual(["Ask for a merge", "Read a PR"]);
    expect(textOutsideRaw(card)).not.toContain(K);
    const pre = screen.getByTestId("charter-raw").querySelector("pre") as HTMLElement;
    expect(pre.textContent?.split("\n").map((l) => l.split(":")[0])).toEqual(["tool_policy", "enforced"]);
  });

  it("an update shows the jobs it adds and the jobs it keeps (DESIGN: the charter card), and a new tool under a kept job, in plain words; a create shows neither mark", () => {
    render(<CharterDisplay parts={parts(UPDATE_DISPLAY)} />);
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
    render(<CharterDisplay parts={parts(keptJobGains)} />);
    const items = within(screen.getByTestId("charter-job")).getAllByRole("listitem");
    expect(items.map((li) => [li.firstChild?.textContent, li.querySelector(".badge")?.textContent ?? null])).toEqual([
      ["Whether Loomwright may merge one parked pull request now (read only).", null],
      ["Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.", ADDS],
    ]);
    expect(screen.getByTestId("charter-job").querySelector(".approvals-charter-job-head .badge")?.textContent).toBe(KEEPS);
    cleanup();
    render(<CharterDisplay parts={parts(WALK_DISPLAY)} />);
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
    render(<CharterDisplay parts={parts(compact)} />);
    const card = screen.getByTestId("approval-display");
    const jobs = screen.getAllByTestId("charter-job");
    expect(jobs.map((j) => j.textContent)).toEqual(["Hand tickets to /automate", "Read a PR", "General"]);
    expect(jobs.every((j) => j.querySelector("ul") === null)).toBe(true);
    expect(textOutsideRaw(card)).not.toContain(K);
    expect(before(screen.getByTestId("charter-plain"), screen.getByTestId("charter-raw"))).toBe(true);
    expect(screen.getByTestId("charter-raw").querySelector("pre")?.textContent).toBe(compact.split("\n").slice(4).join("\n"));
  });

  it("AC9: with the kernel's catalogue unavailable, the kernel's note is shown and no grouping is guessed; the raw names follow", () => {
    render(<CharterDisplay parts={parts(UNAVAILABLE_DISPLAY)} />);
    expect(screen.getByTestId("charter-note").textContent).toBe(CHARTER_CATALOGUE_UNAVAILABLE);
    expect(screen.queryByTestId("charter-jobs")).toBeNull();
    expect(screen.queryAllByTestId("charter-job")).toEqual([]);
    expect(screen.getByTestId("charter-raw").textContent).toContain(`tools: Read, ${K}kernel_github_pr_get`);
  });

  it("every part is escaped text: an ANSI escape or a bidi override in the head, a purpose or a raw line never reaches the DOM raw, and markup stays text", () => {
    const hostile = [`Create crew member x ("x${RLO}", crab crew-teal), proposed by Wright`, `job: Read <b>a</b> PR`, `  - Read ${ESC}[31mit${ESC}[0m.`, `enforced: never: none; tools: ${K}kernel_github_pr_get${RLO}`].join("\n");
    const { container } = render(<CharterDisplay parts={parts(hostile)} />);
    const card = screen.getByTestId("approval-display");
    expect(card.textContent).not.toMatch(RAW);
    expect(screen.getByTestId("charter-head").textContent).toContain("x\\u202e");
    expect(screen.getByTestId("charter-job").textContent).toContain("Read \\x1b[31mit\\x1b[0m.");
    expect(screen.getByTestId("charter-job").firstChild?.textContent).toBe("Read <b>a</b> PR");
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByTestId("charter-raw").querySelector("pre")?.textContent).toBe(printable(`enforced: never: none; tools: ${K}kernel_github_pr_get${RLO}`, true));
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

async function mount(approvals: Approval[]): Promise<void> {
  const fake = fakeBridge();
  fake.route("GET /status", () => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } }));
  fake.route("GET /approvals", () => ok({ approvals }));
  fake.route("GET /approvals/grants", () => ok({ grants: [] }));
  fake.route("GET /messages", () => ok({ messages: [] }));
  fake.route("GET /sessions", () => ok({ sessions: [] }));
  fake.route("GET /playbooks", () => ok({ playbooks: [] }));
  (window as unknown as { api?: StudioBridge }).api = fake.bridge;
  render(<ApprovalsScreen registry={createCommandRegistry()} />);
  await waitFor(() => expect(screen.getByTestId("approval-detail")).toBeTruthy());
}

const CREATE = `${K}kernel_agent_create`;
const UPDATE = `${K}kernel_agent_update`;

describe("the Approvals screen's charter card", () => {
  it("AC3: a held create's card shows the jobs in plain words first and the raw names inside the disclosure beneath", async () => {
    await mount([approval(1, CREATE, WALK_DISPLAY)]);
    const card = screen.getByTestId("approval-display");
    expect(card.tagName).toBe("DIV");
    expect(within(card).getAllByTestId("charter-job")).toHaveLength(4);
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

  it("a charter granting no kernel tool, or any other approval's display (even one shaped like a plain block), is the escaped <pre> as always", async () => {
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

  it("the disclosure's open state is each approval's own: closing it on one leaves the next open", async () => {
    await mount([approval(1, CREATE, WALK_DISPLAY), approval(2, UPDATE, UPDATE_DISPLAY)]);
    const first = screen.getByTestId("charter-raw") as HTMLDetailsElement;
    fireEvent.click(first.querySelector("summary") as HTMLElement);
    expect(first.open).toBe(false);
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2"));
    expect((screen.getByTestId("charter-raw") as HTMLDetailsElement).open).toBe(true);
  });
});
