// What an approval is about (`subject.ts`): the subject read from the
// untrusted payload by type only, the source label, the link, and the split
// of a held charter's display into its plain block and its raw lines.
import { describe, expect, it } from "vitest";
import type { Approval, PlaybookListing } from "../../api/contract";
import {
  CHARTER_ADDED_SUFFIX,
  CHARTER_GAINS_TOOLS_SUFFIX,
  CHARTER_CATALOGUE_UNAVAILABLE,
  CHARTER_JOB_PREFIX,
  CHARTER_PURPOSE_PREFIX,
  CHARTER_READINESS_COVERED_PREFIX,
  CHARTER_READINESS_FLAG_PREFIX,
  CHARTER_READINESS_HEADING_PREFIX,
  CHARTER_READINESS_NOT_CHECKED_PREFIX,
  CHARTER_READINESS_READY_PREFIX,
  CHARTER_UPDATE_HEAD_PREFIX,
  approvalLink,
  approvalSourceText,
  approvalSubject,
  charterDisplayParts,
  isCharterApproval,
  readinessIsOpen,
} from "./subject";

// The kernel's catalogue module is read from disk (`process.getBuiltinModule`: the
// renderer's tsconfig has no Node types), as `kernel-mirror.test.ts` reads the kernel.
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const kernelCatalogue = nodeFs.readFileSync(`${here}/../../../../kernel/src/features/catalogue.ts`, "utf8");
const kernelCharterTools = nodeFs.readFileSync(`${here}/../../../../kernel/src/agents/charter-tools.ts`, "utf8");
const kernelReadiness = nodeFs.readFileSync(`${here}/../../../../kernel/src/agents/charter-readiness.ts`, "utf8");

const ESC = "\u001b";
const RLO = "\u202e";
const RAW = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 6,
    requesting_agent: "wright",
    requesting_session: 12,
    action: "kernel_playbook_enable",
    payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: 3, idempotency_key: "k" }, cwd: "/" },
    requested_at: "2026-10-24T10:00:00.000Z",
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...overrides,
  };
}

function enable(input: unknown): Approval {
  return approval({ payload: { tool: "mcp__kernel__kernel_playbook_enable", input, cwd: "/" } });
}

function create(input: unknown, overrides: Partial<Approval> = {}): Approval {
  return approval({ action: "kernel_agent_create", payload: { tool: "mcp__kernel__kernel_agent_create", input, cwd: "/" }, ...overrides });
}

function update(input: unknown): Approval {
  return approval({ action: "kernel_agent_update", payload: { tool: "mcp__kernel__kernel_agent_update", input, cwd: "/" } });
}

const SABLE = { charter: { id: "sable", display_name: "Sable" }, idempotency_key: "k" };

function listing(id: number, slug: string): PlaybookListing {
  return { id, slug } as PlaybookListing;
}

describe("approvalSubject", () => {
  it("an enable names its playbook by a positive safe-integer input.id", () => {
    expect(approvalSubject(enable({ id: 3, idempotency_key: "k" }))).toEqual({ kind: "playbook", id: 3 });
  });

  it("an enable with a wrong-type or out-of-range id, no input, or an array input names nothing", () => {
    for (const id of ["3", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) expect(approvalSubject(enable({ id })), String(id)).toBeUndefined();
    expect(approvalSubject(approval({ payload: { tool: "mcp__kernel__kernel_playbook_enable", cwd: "/" } }))).toBeUndefined();
    expect(approvalSubject(enable([3]))).toBeUndefined();
    expect(approvalSubject(enable(null))).toBeUndefined();
  });

  it("a create names its member by input.charter.id; no charter, or a non-string or empty id, names nothing", () => {
    expect(approvalSubject(create(SABLE))).toEqual({ kind: "member", id: "sable" });
    expect(approvalSubject(create({ idempotency_key: "k" }))).toBeUndefined();
    expect(approvalSubject(create({ charter: { id: 7 } }))).toBeUndefined();
    expect(approvalSubject(create({ charter: { id: "" } }))).toBeUndefined();
    expect(approvalSubject(create({ charter: ["sable"] }))).toBeUndefined();
  });

  it("an update names its member by input.id", () => {
    expect(approvalSubject(update({ id: "pim", idempotency_key: "k" }))).toEqual({ kind: "member", id: "pim" });
    expect(approvalSubject(update({ id: 4 }))).toBeUndefined();
  });

  it("any other tool, or no payload object, names nothing", () => {
    expect(approvalSubject(approval({ action: "Bash", payload: { tool: "Bash", command: "ls", cwd: "/" } }))).toBeUndefined();
    expect(approvalSubject(approval({ payload: { tool: "Bash", input: { id: 3 } } }))).toBeUndefined();
    expect(approvalSubject(approval({ payload: null }))).toBeUndefined();
    expect(approvalSubject(approval({ payload: "mcp__kernel__kernel_playbook_enable" }))).toBeUndefined();
  });
});

describe("approvalSourceText", () => {
  it("no playbook reads who asked, in chat: Wright by name, another agent by its id", () => {
    expect(approvalSourceText(approval())).toBe("Requested by Wright in chat");
    expect(approvalSourceText(approval({ requesting_agent: "ada" }))).toBe("Requested by ada in chat");
  });

  it("a playbook reads the playbook and its version", () => {
    expect(approvalSourceText(approval({ playbook: { id: 9, slug: "review-prs", version: 3 } }))).toBe("Requested by playbook review-prs v3");
  });

  it("a hostile agent id or slug comes back escaped, never raw", () => {
    const agent = approvalSourceText(approval({ requesting_agent: `ada${ESC}[2J${RLO}` }));
    expect(agent).toBe("Requested by ada\\x1b[2J\\u202e in chat");
    expect(agent).not.toMatch(RAW);
    const slug = approvalSourceText(approval({ playbook: { id: 1, slug: `slug${RLO}${ESC}`, version: 1 } }));
    expect(slug).toBe("Requested by playbook slug\\u202e\\x1b v1");
    expect(slug).not.toMatch(RAW);
  });
});

describe("approvalLink", () => {
  it("an enable opens its playbook's card by slug; #<id> when the list does not have it or is unread", () => {
    expect(approvalLink(approval(), [listing(3, "phase5-exit-1024")])).toEqual({ text: "Open playbook phase5-exit-1024", href: "#/chat?playbook=3" });
    expect(approvalLink(approval(), [listing(4, "other")])).toEqual({ text: "Open playbook #3", href: "#/chat?playbook=3" });
    expect(approvalLink(approval(), undefined)).toEqual({ text: "Open playbook #3", href: "#/chat?playbook=3" });
    // Decided, it still links: the card is where Run now is.
    expect(approvalLink(approval({ status: "approved", decision: "once" }), [listing(3, "p")])?.href).toBe("#/chat?playbook=3");
  });

  it("a hostile slug is escaped in the link's text", () => {
    const link = approvalLink(approval(), [listing(3, `pr${RLO}view`)]);
    expect(link?.text).toBe("Open playbook pr\\u202eview");
    expect(link?.text).not.toMatch(RAW);
  });

  it("a create links to Team only once allowed and applied: never pending, denied or refused", () => {
    expect(approvalLink(create(SABLE), undefined)).toBeUndefined();
    expect(approvalLink(create(SABLE, { status: "denied", decision: "deny" }), undefined)).toBeUndefined();
    expect(approvalLink(create(SABLE, { status: "approved", decision: "once", apply_refused: "agent_exists" }), undefined)).toBeUndefined();
    // Allowed but never applied (an approval an agent asked for itself): no `applied`, no member.
    expect(approvalLink(create(SABLE, { status: "approved", decision: "once" }), undefined)).toBeUndefined();
    expect(approvalLink(create(SABLE, { status: "approved", decision: "once", applied: "The kernel created crew member sable." }), undefined)).toEqual({
      text: "Open in Team",
      href: "#/team/sable",
    });
  });

  it("an update always links to its member, its id encoded", () => {
    expect(approvalLink(update({ id: "pim" }), undefined)).toEqual({ text: "Open in Team", href: "#/team/pim" });
    expect(approvalLink(update({ id: "a/b?c" }), undefined)?.href).toBe("#/team/a%2Fb%3Fc");
  });

  it("anything else has no link", () => {
    expect(approvalLink(approval({ payload: { tool: "Bash", command: "ls" } }), [listing(3, "p")])).toBeUndefined();
  });
});

// ---- A held charter's display (phase 8 item 16, AC3 app half) ------------------------
//
// The inputs are the kernel's own pinned display lines (`kernel/test/agents-charter-tools.test.ts`,
// "the display groups the granted kernel tools by job"): createDisplay and updateDisplay over the
// shipped catalogue, and createDisplay with no catalogue (AC9).

const K = "mcp__kernel__";
const CREATE_GRANTED = ["Read", `${K}kernel_github_pr_get`, `${K}kernel_automate_merge_check`, `${K}kernel_task_list`];
const CREATE_RAW = [
  `enforced: never: git_push; tools: ${CREATE_GRANTED.join(", ")}; bash prefixes: none; connectors: github`,
  "limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
  "workspaces: /tmp/work/payments",
  "config/agents/mason.json:",
  "{",
  '  "model": "claude-sonnet-5",',
];
const CREATE_DISPLAY = [
  'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
  "job: Ask for a merge",
  "  - Whether Loomwright may merge one parked pull request now (read only).",
  "job: Read a PR",
  "  - Read one pull request's metadata and description from GitHub (read-only).",
  "job: General",
  "  - List tasks in id order, filtered by state, assignee_agent or parent_task_id (limit 1-200, default 50).",
  ...CREATE_RAW,
].join("\n");

const NEXT = ["Read", `${K}kernel_github_pr_get`, `${K}kernel_automate_merge_check`, `${K}kernel_merge_approval_request`];
const UPDATE_RAW = [
  `tool_policy: ${JSON.stringify({ allowedTools: ["Read", `${K}kernel_github_pr_get`], allowedBashPrefixes: [] })} → ${JSON.stringify({ allowedTools: NEXT, allowedBashPrefixes: [] })}`,
  `enforced: never: git_push; tools: ${NEXT.join(", ")}; bash prefixes: none`,
];
// Mason held only kernel_github_pr_get (Read a PR): the update adds Ask for a merge and keeps Read a PR.
const UPDATE_DISPLAY = [
  'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright',
  "job: Ask for a merge (added)",
  "  - Whether Loomwright may merge one parked pull request now (read only).",
  "  - Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.",
  "job: Read a PR",
  "  - Read one pull request's metadata and description from GitHub (read-only).",
  ...UPDATE_RAW,
].join("\n");

/** A purpose line the update does not mark (every purpose of a create). */
const kept = (text: string) => ({ text, added: false });

describe("charterDisplayParts", () => {
  it("AC3: a create splits into who, the jobs with their purposes in the kernel's order, and every later line raw, unchanged", () => {
    expect(charterDisplayParts(CREATE_DISPLAY)).toEqual({
      head: 'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
      update: false,
      jobs: [
        { label: "Ask for a merge", added: false, purposes: [kept("Whether Loomwright may merge one parked pull request now (read only).")] },
        { label: "Read a PR", added: false, purposes: [kept("Read one pull request's metadata and description from GitHub (read-only).")] },
        { label: "General", added: false, purposes: [kept("List tasks in id order, filtered by state, assignee_agent or parent_task_id (limit 1-200, default 50).")] },
      ],
      note: undefined,
      raw: CREATE_RAW.join("\n"),
    });
  });

  it("AC3: an update's jobs come before its field lines, which stay raw with the enforced line", () => {
    const parts = charterDisplayParts(UPDATE_DISPLAY);
    expect(parts?.jobs.map((j) => [j.label, j.purposes.length])).toEqual([
      ["Ask for a merge", 2],
      ["Read a PR", 1],
    ]);
    expect(parts?.raw).toBe(UPDATE_RAW.join("\n"));
    // The job the update adds is marked added, the one it keeps is not; the mark is taken off the label.
    expect(parts?.update).toBe(true);
    expect(parts?.jobs.map((j) => [j.label, j.added])).toEqual([
      ["Ask for a merge", true],
      ["Read a PR", false],
    ]);
    // No raw kernel name is in the plain block.
    expect(JSON.stringify([parts?.head, parts?.jobs])).not.toContain(K);
  });

  it("a granted tool the catalogue lacks is its own heading's purpose line, by name", () => {
    const parts = charterDisplayParts(['Create crew member nell ("Nell", crab crew-teal), proposed by Wright', "job: other kernel tools, not in the catalogue", "  - kernel_github_pr_get", "enforced: never: none"].join("\n"));
    expect(parts?.jobs).toEqual([{ label: "other kernel tools, not in the catalogue", added: false, purposes: [kept("kernel_github_pr_get")] }]);
  });

  it("the kernel's compact form (every job as its label alone, when the full block would not fit the display) splits into jobs with no purposes, ahead of the raw lines", () => {
    const raw = [`tool_policy: ${JSON.stringify({ allowedTools: ["Read"], allowedBashPrefixes: [] })} → as on the enforced line`, `enforced: never: none; tools: Read, ${K}kernel_github_pr_get, ${K}kernel_task_list, ${K}kernel_pad; bash prefixes: none`];
    const display = ['Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright', "job: Read a PR", "job: General", "job: other kernel tools, not in the catalogue", ...raw].join("\n");
    expect(charterDisplayParts(display)).toEqual({
      head: 'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright',
      update: true,
      jobs: [
        { label: "Read a PR", added: false, purposes: [] },
        { label: "General", added: false, purposes: [] },
        { label: "other kernel tools, not in the catalogue", added: false, purposes: [] },
      ],
      note: undefined,
      raw: raw.join("\n"),
    });
    // A lone label-only job is the compact form too.
    expect(charterDisplayParts("head\njob: Read a PR\nenforced: x")?.jobs).toEqual([{ label: "Read a PR", added: false, purposes: [] }]);
  });

  it("an update's added marks (DESIGN: the jobs it adds and the jobs it keeps): an added job, a new tool under a kept job, and the compact form's marked labels; a create's text is never read as a mark", () => {
    const head = 'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright';
    const full = [head, "job: Ask for a merge", "  - Whether it may merge.", "  - Ask the owner to approve merging. (added)", "job: Read a PR (added)", "  - Read one pull request.", "enforced: x"].join("\n");
    expect(charterDisplayParts(full)?.jobs).toEqual([
      { label: "Ask for a merge", added: false, purposes: [kept("Whether it may merge."), { text: "Ask the owner to approve merging.", added: true }] },
      { label: "Read a PR", added: true, purposes: [kept("Read one pull request.")] },
    ]);
    const compact = charterDisplayParts([head, "job: Ask for a merge (added)", "job: General", "tool_policy: [] → as on the enforced line", "enforced: x"].join("\n"));
    expect(compact?.jobs).toEqual([
      { label: "Ask for a merge", added: true, purposes: [] },
      { label: "General", added: false, purposes: [] },
    ]);
    expect(compact?.raw).toBe("tool_policy: [] → as on the enforced line\nenforced: x");
    const create = charterDisplayParts('Create crew member nell ("Nell", crab crew-teal), proposed by Wright\njob: Read a PR (added)\n  - Read it. (added)\nenforced: x');
    expect(create?.update).toBe(false);
    expect(create?.jobs).toEqual([{ label: "Read a PR (added)", added: false, purposes: [kept("Read it. (added)")] }]);
  });

  it("an update's compact form marks a kept job that gains a tool (gainsTools, the mark taken off the label); a create's text, or a job with no mark, is never read as one", () => {
    const head = 'Update crew member mason ("Mason"), settings sha256 3f9a1c07b2e4, proposed by Wright';
    const compact = charterDisplayParts([head, `job: Ask for a merge${CHARTER_GAINS_TOOLS_SUFFIX}`, "job: Read a PR (added)", "job: General", "tool_policy: [] → as on the enforced line", "enforced: x"].join("\n"));
    expect(compact?.jobs).toEqual([
      { label: "Ask for a merge", added: false, gainsTools: true, purposes: [] },
      { label: "Read a PR", added: true, purposes: [] },
      { label: "General", added: false, purposes: [] },
    ]);
    expect(compact?.jobs[2]?.gainsTools).toBeUndefined();
    expect(compact?.raw).toBe("tool_policy: [] → as on the enforced line\nenforced: x");
    const create = charterDisplayParts(`Create crew member nell ("Nell", crab crew-teal), proposed by Wright\njob: Read a PR${CHARTER_GAINS_TOOLS_SUFFIX}\nenforced: x`);
    expect(create?.jobs).toEqual([{ label: `Read a PR${CHARTER_GAINS_TOOLS_SUFFIX}`, added: false, purposes: [] }]);
    expect(create?.jobs[0]?.gainsTools).toBeUndefined();
  });

  it("AC9: the catalogue-unavailable line is the note, with no grouping; the raw lines follow it", () => {
    const raw = `enforced: never: none; tools: Read, ${K}kernel_github_pr_get; bash prefixes: none`;
    expect(charterDisplayParts(['Create crew member mason ("Mason", crab crew-teal), proposed by Wright', CHARTER_CATALOGUE_UNAVAILABLE, raw].join("\n"))).toEqual({
      head: 'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
      update: false,
      jobs: [],
      note: CHARTER_CATALOGUE_UNAVAILABLE,
      raw,
    });
  });

  it("no plain block (no readiness block and no kernel tool granted, or not the kernel's format) splits nothing, so the card shows the display as it always has", () => {
    // A charter that grants no kernel tool, held before the kernel wrote a readiness block: the display is as it always was.
    expect(charterDisplayParts('Create crew member nell ("Nell", crab crew-teal), proposed by Wright\nenforced: never: none; tools: Read; bash prefixes: none')).toBeUndefined();
    expect(charterDisplayParts("")).toBeUndefined();
    expect(charterDisplayParts("one line")).toBeUndefined();
    // A purpose with no job above it, or a block mixing jobs with and without purposes, is not the kernel's format.
    expect(charterDisplayParts("head\n  - orphan purpose\nenforced: x")).toBeUndefined();
    expect(charterDisplayParts("head\njob: Read a PR\n  - Read it.\njob: Ask for a merge\nenforced: x")).toBeUndefined();
    expect(charterDisplayParts("head\njob: Read a PR\njob: Ask for a merge\n  - Ask.\nenforced: x")).toBeUndefined();
    // A job line that is not right after the head is not a plain block.
    expect(charterDisplayParts("head\nenforced: x\njob: Read a PR\n  - Read it.")).toBeUndefined();
  });

  it("the raw text is returned unescaped (it is escaped where it is rendered), and a lone plain block has an empty raw part", () => {
    const parts = charterDisplayParts(`head \u202e\njob: Read a PR\n  - Read it.`);
    expect(parts?.head).toBe("head \u202e");
    expect(parts?.raw).toBe("");
  });

  it("mirrors the kernel's display format: the job and purpose prefixes (the purposes left out in the compact form), the added mark, the update head and the catalogue-unavailable line", () => {
    expect(kernelCatalogue).toContain(
      `lines.push(\`${CHARTER_JOB_PREFIX}\${job.label}\${mark(added)}\${gains(added, tools.map((t) => t.name))}\`, ...(purposes ? tools.map((t) => \`${CHARTER_PURPOSE_PREFIX}\${t.purpose}\${mark(!added && isNew(t.name))}\`) : []))`,
    );
    expect(/export const DISPLAY_ADDED = "([^"]*)";/.exec(kernelCatalogue)?.[1]).toBe(CHARTER_ADDED_SUFFIX);
    // The compact form's mark on a kept job that gains a tool: never in the full form (purposes), never on an added job or a create's (isNew is false without held).
    expect(/export const DISPLAY_GAINS_TOOLS = "([^"]*)";/.exec(kernelCatalogue)?.[1]).toBe(CHARTER_GAINS_TOOLS_SUFFIX);
    expect(kernelCatalogue).toContain("(!purposes && !added && names.some(isNew) ? DISPLAY_GAINS_TOOLS : \"\")");
    expect(kernelCharterTools).toContain(`return \`${CHARTER_UPDATE_HEAD_PREFIX}\${m.row.id} `);
    const unavailable = /export const DISPLAY_CATALOGUE_UNAVAILABLE =\s*"([^"]*)";/.exec(kernelCatalogue)?.[1];
    expect(unavailable).toBe(CHARTER_CATALOGUE_UNAVAILABLE);
  });
});

// ---- The readiness block (phase 8 item 18b, AC12 app half) ----------------------------
//
// The inputs are the kernel's own documented lines (`docs/architecture/agents.md` §"The
// readiness check": approval #19's charter; §"The update": a member whose stored duties are
// bare lines), built from the mirrored prefixes, which the last test pins to the kernel file.

/** The kernel's readiness heading line, as `charter-readiness.ts` writes it (`READINESS_HEADING`). */
const READINESS_HEADING_LINE = "readiness: checked by the kernel before you see it";

/** Approval #19's readiness block (AC2): one duty covered, two not, no copy of a repo, one connector ready, one the owner's step. */
const READINESS_19 = [
  READINESS_HEADING_LINE,
  `${CHARTER_READINESS_COVERED_PREFIX}duty 1 by Hand tickets to /automate: Turn tickets into PRs`,
  `${CHARTER_READINESS_FLAG_PREFIX}duty 2 not covered (needs Triage PR comments, which this charter does not grant): Triage PR comments`,
  `${CHARTER_READINESS_FLAG_PREFIX}duty 3 not covered (needs Ask for a merge, which this charter does not grant): Ask for merges`,
  `${CHARTER_READINESS_FLAG_PREFIX}copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)`,
  `${CHARTER_READINESS_READY_PREFIX}GitHub access for Read a PR: proposed in this charter`,
  `${CHARTER_READINESS_FLAG_PREFIX}GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)`,
];
const HEAD_19 = 'Create crew member devon ("Devon", crab crew-teal), proposed by Wright';
const JOBS_19 = ["job: Hand tickets to /automate", "job: Read a PR"];
const RAW_19 = [`enforced: never: none; tools: ${K}kernel_automate_prepare, ${K}kernel_github_pr_get; bash prefixes: none; connectors: github`, "limits: tokens_per_day not set (no limit)", "workspaces: none"];

describe("charterDisplayParts: the readiness block", () => {
  it("AC12: approval #19's block splits into one line per duty and per job prerequisite, in the kernel's order, each with its status and the prefix taken off; the jobs and raw lines split as before", () => {
    expect(charterDisplayParts([HEAD_19, ...READINESS_19, ...JOBS_19, ...RAW_19].join("\n"))).toStrictEqual({
      head: HEAD_19,
      update: false,
      readiness: [
        { status: "covered", text: "duty 1 by Hand tickets to /automate: Turn tickets into PRs" },
        { status: "flagged", text: "duty 2 not covered (needs Triage PR comments, which this charter does not grant): Triage PR comments" },
        { status: "flagged", text: "duty 3 not covered (needs Ask for a merge, which this charter does not grant): Ask for merges" },
        { status: "flagged", text: "copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)" },
        { status: "ready", text: "GitHub access for Read a PR: proposed in this charter" },
        { status: "flagged", text: "GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)" },
      ],
      jobs: [
        { label: "Hand tickets to /automate", added: false, purposes: [] },
        { label: "Read a PR", added: false, purposes: [] },
      ],
      note: undefined,
      raw: RAW_19.join("\n"),
    });
  });

  it("a not-checked line is its own status; flagged and not checked are the open ones, covered and ready are not", () => {
    const parts = charterDisplayParts([HEAD_19, READINESS_HEADING_LINE, `${CHARTER_READINESS_NOT_CHECKED_PREFIX}copy of a repo for Hand tickets to /automate: can't tell whether it has one (/w can't be read (EACCES))`, ...JOBS_19, ...RAW_19].join("\n"));
    expect(parts?.readiness).toEqual([{ status: "not_checked", text: "copy of a repo for Hand tickets to /automate: can't tell whether it has one (/w can't be read (EACCES))" }]);
    expect((["covered", "ready", "flagged", "not_checked"] as const).map(readinessIsOpen)).toEqual([false, false, true, true]);
  });

  it("an update's block (stored bare duties, each flagged) sits after its head; the field lines stay raw", () => {
    const head = 'Update crew member mason ("Mason"), settings sha256 3e60d27291fd, proposed by Wright';
    const raw = ["limits.tokens_per_day: 200000 → 300000", 'enforced: never: git_push; tools: Read, Glob, Grep, Bash; bash prefixes: "git diff"'];
    const display = [
      head,
      READINESS_HEADING_LINE,
      `${CHARTER_READINESS_FLAG_PREFIX}duty 1 names no job (written before duties named their jobs): Review the pull requests the owner sends you and say what is risky.`,
      `${CHARTER_READINESS_FLAG_PREFIX}duty 2 names no job (written before duties named their jobs): Summarise each review in three lines or fewer.`,
      ...raw,
    ].join("\n");
    // No kernel tool granted: the readiness block is the whole plain block.
    expect(charterDisplayParts(display)).toStrictEqual({
      head,
      update: true,
      readiness: [
        { status: "flagged", text: "duty 1 names no job (written before duties named their jobs): Review the pull requests the owner sends you and say what is risky." },
        { status: "flagged", text: "duty 2 names no job (written before duties named their jobs): Summarise each review in three lines or fewer." },
      ],
      jobs: [],
      note: undefined,
      raw: raw.join("\n"),
    });
  });

  it("a block followed by the catalogue-unavailable line keeps both: the readiness lines, then the note", () => {
    const raw = `enforced: never: none; tools: ${K}kernel_github_pr_get; bash prefixes: none`;
    const lines = [`${CHARTER_READINESS_NOT_CHECKED_PREFIX}duty 1 (the kernel's tool catalogue is unavailable): Read PRs`];
    expect(charterDisplayParts([HEAD_19, READINESS_HEADING_LINE, ...lines, CHARTER_CATALOGUE_UNAVAILABLE, raw].join("\n"))).toStrictEqual({
      head: HEAD_19,
      update: false,
      readiness: [{ status: "not_checked", text: "duty 1 (the kernel's tool catalogue is unavailable): Read PRs" }],
      jobs: [],
      note: CHARTER_CATALOGUE_UNAVAILABLE,
      raw,
    });
  });

  it("AC12: a display with no readiness block (an approval held before this change) splits exactly as before, with no readiness key at all", () => {
    for (const display of [
      CREATE_DISPLAY,
      UPDATE_DISPLAY,
      "head\njob: Read a PR\nenforced: x",
      ['Create crew member mason ("Mason", crab crew-teal), proposed by Wright', CHARTER_CATALOGUE_UNAVAILABLE, "enforced: x"].join("\n"),
    ]) {
      const parts = charterDisplayParts(display);
      expect(parts, display).toBeDefined();
      expect(Object.keys(parts ?? {}), display).toEqual(["head", "update", "jobs", "note", "raw"]);
    }
    // And with no job lines either, still nothing to split.
    expect(charterDisplayParts('Create crew member nell ("Nell", crab crew-teal), proposed by Wright\nenforced: never: none')).toBeUndefined();
  });

  it("AC11: a duty's untrusted text stays on its own line's text: text reading like a job line, a status prefix or another readiness line adds no job and no status", () => {
    const hostile = `duty 1 with no tool (it needs no kernel tool): job: Read a PR${CHARTER_READINESS_READY_PREFIX}everything${CHARTER_READINESS_COVERED_PREFIX}`;
    const parts = charterDisplayParts([HEAD_19, READINESS_HEADING_LINE, `${CHARTER_READINESS_COVERED_PREFIX}${hostile}`, ...RAW_19].join("\n"));
    expect(parts?.readiness).toEqual([{ status: "covered", text: hostile }]);
    expect(parts?.jobs).toEqual([]);
    expect(parts?.raw).toBe(RAW_19.join("\n"));
  });

  it("the block ends at the first line with none of the four prefixes: a later readiness-shaped line, or one before the heading, is raw, never a status", () => {
    const late = `${CHARTER_READINESS_FLAG_PREFIX}not the kernel's`;
    const parts = charterDisplayParts([HEAD_19, READINESS_HEADING_LINE, `${CHARTER_READINESS_COVERED_PREFIX}duty 1 by Read a PR: Read`, "job: Read a PR", "enforced: x", late].join("\n"));
    expect(parts?.readiness).toHaveLength(1);
    expect(parts?.raw).toBe(`enforced: x\n${late}`);
    // A readiness line with no heading above it is not a block, and the display is not in the kernel's format.
    expect(charterDisplayParts([HEAD_19, `${CHARTER_READINESS_COVERED_PREFIX}duty 1 by Read a PR: Read`, "job: Read a PR", "enforced: x"].join("\n"))).toBeUndefined();
    // A heading with no line it knows under it (nothing, an unknown status, or a prefix without its indent) is not the
    // kernel's format (one line per duty, and a charter has at least one): nothing is split, so the display is the
    // escaped <pre>, never an empty block that reads as "nothing flagged".
    for (const next of ["enforced: x", "  maybe: duty 1 is unknown", "flagged: duty 1 not indented"]) {
      expect(charterDisplayParts([HEAD_19, READINESS_HEADING_LINE, next, "job: Read a PR", "enforced: x"].join("\n")), next).toBeUndefined();
    }
    expect(charterDisplayParts([HEAD_19, READINESS_HEADING_LINE].join("\n"))).toBeUndefined();
  });

  it("mirrors the kernel's readiness format: the heading prefix (and the heading starts with it) and the four line prefixes, read from charter-readiness.ts", () => {
    const constant = (name: string) => new RegExp(`export const ${name} = "([^"]*)";`).exec(kernelReadiness)?.[1];
    expect(constant("READINESS_HEADING_PREFIX")).toBe(CHARTER_READINESS_HEADING_PREFIX);
    expect(constant("READINESS_HEADING")).toBe(READINESS_HEADING_LINE);
    expect(READINESS_HEADING_LINE.startsWith(CHARTER_READINESS_HEADING_PREFIX)).toBe(true);
    expect(constant("READINESS_COVERED_PREFIX")).toBe(CHARTER_READINESS_COVERED_PREFIX);
    expect(constant("READINESS_READY_PREFIX")).toBe(CHARTER_READINESS_READY_PREFIX);
    expect(constant("READINESS_FLAG_PREFIX")).toBe(CHARTER_READINESS_FLAG_PREFIX);
    expect(constant("READINESS_NOT_CHECKED_PREFIX")).toBe(CHARTER_READINESS_NOT_CHECKED_PREFIX);
    // The kernel's statuses are exactly the four this reads, so no line is ever dropped as unknown.
    expect(kernelReadiness).toContain('export type ReadinessStatus = "covered" | "ready" | "flagged" | "not_checked";');
    // And the block sits right after the display's first line, in a create's head and an update's display.
    expect(kernelCharterTools).toMatch(/`Create crew member \$\{charter\.id\} [^\n]*,\n\s*\.\.\.readiness,\n\s*\.\.\.jobDisplayLines\(/);
    expect(kernelCharterTools).toMatch(/updateHead\(m\),\n\s*\.\.\.readiness,\n\s*\.\.\.jobDisplayLines\(/);
  });
});

describe("isCharterApproval", () => {
  it("a held kernel_agent_create or kernel_agent_update, by the payload's tool; nothing else", () => {
    expect(isCharterApproval(create(SABLE))).toBe(true);
    expect(isCharterApproval(update({ id: "pim" }))).toBe(true);
    expect(isCharterApproval(approval())).toBe(false);
    expect(isCharterApproval(approval({ action: "kernel_agent_create", payload: { tool: "Bash" } }))).toBe(false);
    expect(isCharterApproval(approval({ payload: "mcp__kernel__kernel_agent_create" }))).toBe(false);
  });
});
