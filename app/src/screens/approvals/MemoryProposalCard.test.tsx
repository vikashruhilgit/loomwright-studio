// @vitest-environment jsdom
// The memory proposal card (wa-f): the file and the entry as plain text, the
// evidence escaped in a well marked as untrusted, never rendered as markup.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Approval } from "../../api/contract";
import { MEMORY_ALWAYS_REFUSED, MEMORY_PROPOSAL_ACTION, MemoryProposalCard, isMemoryProposal, memoryProposalOf } from "./MemoryProposalCard";

afterEach(cleanup);

function held(input: unknown, overrides: Partial<Approval> = {}): Approval {
  return {
    id: 7,
    requesting_agent: "wright",
    requesting_session: 3,
    action: MEMORY_PROPOSAL_ACTION,
    payload: { tool: "mcp__kernel__kernel_memory_propose", input, cwd: "/" },
    requested_at: "2026-11-28T10:00:00.000Z",
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...overrides,
  };
}

const INPUT = { file: "lessons", entry: "Say a refused call was refused.", evidence: "session 1: Bash refused\n<img src=x onerror=alert(1)>\u001b[2J", idempotency_key: "k1" };

describe("memoryProposalOf", () => {
  it("reads the file, entry and evidence from the rail payload's input, the agent from the approval", () => {
    expect(memoryProposalOf(held(INPUT))).toEqual({ path: "memory/wright/lessons.md", entry: INPUT.entry, evidence: INPUT.evidence });
    expect(memoryProposalOf(held(INPUT, { requesting_agent: "mason" }))?.path).toBe("memory/mason/lessons.md");
  });

  it("is undefined for another action or tool, a file outside the three, or a field of the wrong type", () => {
    expect(memoryProposalOf(held(INPUT, { action: "kernel_approval_request" }))).toBeUndefined();
    expect(memoryProposalOf(held(INPUT, { payload: { tool: "mcp__kernel__kernel_approval_request", input: INPUT } }))).toBeUndefined();
    for (const file of ["role", "role.md", "mason/lessons", "shared/x", 3]) expect(memoryProposalOf(held({ ...INPUT, file })), String(file)).toBeUndefined();
    expect(memoryProposalOf(held({ ...INPUT, entry: 5 }))).toBeUndefined();
    expect(memoryProposalOf(held(null))).toBeUndefined();
  });

  it("the no-Always gate keys on the action alone", () => {
    expect(isMemoryProposal(held(null))).toBe(true);
    expect(isMemoryProposal(held(INPUT, { action: "comment" }))).toBe(false);
    expect(MEMORY_ALWAYS_REFUSED).toMatch(/asked every time/);
  });
});

describe("MemoryProposalCard", () => {
  it("shows the file and the entry as text, and the evidence escaped inside the untrusted well, never as markup", () => {
    const proposal = memoryProposalOf(held(INPUT));
    if (proposal === undefined) throw new Error("no proposal");
    const { container } = render(<MemoryProposalCard proposal={proposal} />);
    expect(screen.getByTestId("memory-path").textContent).toBe("memory/wright/lessons.md");
    expect(screen.getByTestId("memory-entry").textContent).toBe("Say a refused call was refused.");
    const evidence = screen.getByTestId("memory-evidence");
    // Escaped: the ESC control is shown as text, the newline kept, the tag left as literal text.
    expect(evidence.textContent).toBe("session 1: Bash refused\n<img src=x onerror=alert(1)>\\x1b[2J");
    expect(container.querySelector("img")).toBeNull();
    const well = evidence.closest(".approvals-well");
    expect(well?.querySelector(".approvals-well-note")?.textContent).toBe("untrusted text");
    expect(screen.getByTestId("memory-gate").textContent).toContain("Nothing is written until you allow it.");
  });
});
