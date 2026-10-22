// The app's mirror of kernel facts the contract does not carry. Each is read
// from the kernel's own source, so a kernel change that the app does not
// follow fails here instead of showing the owner a stale line:
//
// - `KERNEL_APPLIED_ACTIONS` and `ALWAYS_REFUSED` in `kernel/src/approvals/store.ts`;
// - the character classes of `printable` in `kernel/src/notifications/cli.ts`.
import { describe, expect, it } from "vitest";
import { ALWAYS_REFUSED, KERNEL_APPLIED_ACTIONS, alwaysRefusalFor, kernelWillLine, playbookText } from "./kernel-mirror";
import { BIDI_AND_SEPARATORS, CONTROLS } from "./printable";
import type { Approval } from "../../api/contract";

// The kernel's files are read from disk (`process.getBuiltinModule`: the
// renderer's tsconfig has no Node types, as in the components' CSS scans).
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(id: "node:fs"): NodeFs } }).process.getBuiltinModule("node:fs");
const here = (import.meta as unknown as { dirname: string }).dirname;
const KERNEL = `${here}/../../../../kernel/src`;
const approvalsStore = nodeFs.readFileSync(`${KERNEL}/approvals/store.ts`, "utf8");
const notificationsCli = nodeFs.readFileSync(`${KERNEL}/notifications/cli.ts`, "utf8");

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 1,
    requesting_agent: "wright",
    requesting_session: 3,
    action: "kernel_agent_create",
    payload: { tool: "mcp__kernel__kernel_agent_create" },
    requested_at: "2026-10-22T08:00:00.000Z",
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: { id: 4, slug: "crew-setup", version: 2 },
    ...overrides,
  };
}

describe("the kernel mirror", () => {
  it("KERNEL_APPLIED_ACTIONS names exactly the kernel's three tools", () => {
    const block = /export const KERNEL_APPLIED_ACTIONS = \[([\s\S]*?)\] as const;/.exec(approvalsStore)?.[1];
    expect(block, "kernel/src/approvals/store.ts declares KERNEL_APPLIED_ACTIONS").toBeDefined();
    const kernelNames = [...(block ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(kernelNames).toEqual([
      "mcp__kernel__kernel_playbook_enable",
      "mcp__kernel__kernel_agent_create",
      "mcp__kernel__kernel_agent_update",
    ]);
    expect(Object.keys(KERNEL_APPLIED_ACTIONS).sort()).toEqual([...kernelNames].sort());
  });

  it("ALWAYS_REFUSED is the kernel's sentence, word for word", () => {
    const kernel = /export const ALWAYS_REFUSED = "([^"]*)";/.exec(approvalsStore)?.[1];
    expect(kernel).toBe("always needs an approval the rail held from a playbook session");
    expect(ALWAYS_REFUSED).toBe(kernel);
  });

  it("printable's character classes are the kernel's", () => {
    const bidi = /const BIDI_AND_SEPARATORS = \/(\[[^\]]+\])\/g;/.exec(notificationsCli)?.[1];
    expect(bidi).toBe(BIDI_AND_SEPARATORS.source);
    expect(notificationsCli).toContain(`.replace(/${CONTROLS.source}/g`);
  });
});

describe("what the screen derives from it", () => {
  it("names what the kernel will do for each kernel-applied tool, and nothing for any other tool", () => {
    expect(kernelWillLine(approval())).toBe("The kernel creates this crew member when you allow it.");
    expect(kernelWillLine(approval({ payload: { tool: "mcp__kernel__kernel_playbook_enable" } }))).toBe("The kernel enables this playbook when you allow it.");
    expect(kernelWillLine(approval({ payload: { tool: "mcp__kernel__kernel_agent_update" } }))).toMatch(/changes this crew member/);
    expect(kernelWillLine(approval({ payload: { tool: "Bash", command: "ls" } }))).toBeUndefined();
    expect(kernelWillLine(approval({ payload: { tool: "toString" } }))).toBeUndefined();
    expect(kernelWillLine(approval({ payload: "mcp__kernel__kernel_agent_create" }))).toBeUndefined();
    expect(kernelWillLine(approval({ payload: null }))).toBeUndefined();
  });

  it("refuses always before asking only when there is no playbook, with the kernel's sentence", () => {
    expect(alwaysRefusalFor(approval({ playbook: null }))).toBe("always needs an approval the rail held from a playbook session; approve it once");
    expect(alwaysRefusalFor(approval())).toBeUndefined();
  });

  it("writes the playbook as the CLI does: slug or #id, then v<n> when recorded, escaped", () => {
    expect(playbookText({ id: 4, slug: "crew-setup", version: 2 })).toBe("playbook crew-setup v2");
    expect(playbookText({ id: 4, slug: null, version: null })).toBe("playbook #4");
    expect(playbookText({ id: 4, slug: "evil\u202egnp", version: 1 })).toBe("playbook evil\\u202egnp v1");
  });
});
