// What an approval is about (`subject.ts`): the subject read from the
// untrusted payload by type only, the source label, the link, and the split
// of a held charter's display into its plain block and its raw lines.
import { describe, expect, it } from "vitest";
import type { Approval, PlaybookListing } from "../../api/contract";
import {
  CHARTER_ADDED_SUFFIX,
  CHARTER_CATALOGUE_UNAVAILABLE,
  CHARTER_JOB_PREFIX,
  CHARTER_PURPOSE_PREFIX,
  CHARTER_UPDATE_HEAD_PREFIX,
  approvalLink,
  approvalSourceText,
  approvalSubject,
  charterDisplayParts,
  isCharterApproval,
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

  it("no plain block (no kernel tool granted, or not the kernel's format) splits nothing, so the card shows the display as it always has", () => {
    // A charter that grants no kernel tool: the display is as it always was.
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
      `lines.push(\`${CHARTER_JOB_PREFIX}\${job.label}\${mark(added)}\`, ...(purposes ? tools.map((t) => \`${CHARTER_PURPOSE_PREFIX}\${t.purpose}\${mark(!added && isNew(t.name))}\`) : []))`,
    );
    expect(/export const DISPLAY_ADDED = "([^"]*)";/.exec(kernelCatalogue)?.[1]).toBe(CHARTER_ADDED_SUFFIX);
    expect(kernelCharterTools).toContain(`return \`${CHARTER_UPDATE_HEAD_PREFIX}\${m.row.id} `);
    const unavailable = /export const DISPLAY_CATALOGUE_UNAVAILABLE =\s*"([^"]*)";/.exec(kernelCatalogue)?.[1];
    expect(unavailable).toBe(CHARTER_CATALOGUE_UNAVAILABLE);
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
