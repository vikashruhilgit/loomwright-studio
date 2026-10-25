// What an approval is about (`subject.ts`): the subject read from the
// untrusted payload by type only, the source label, and the link.
import { describe, expect, it } from "vitest";
import type { Approval, PlaybookListing } from "../../api/contract";
import { approvalLink, approvalSourceText, approvalSubject } from "./subject";

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
