// Every kernel tool lists through the Agent SDK's own MCP server, the way a
// session's `tools/list` does: `createKernelMcpServer` (the SDK's
// `createSdkMcpServer`) and a real MCP `Client` over an in-memory transport
// (`listKernelTools`). The kernel's own handler tests call handlers directly
// and its own `z.toJSONSchema` converts every shape, so neither catches a
// shape the SDK's bundled serialiser throws on; and one such shape fails the
// whole listing, so every session is offered no kernel tool while the server
// still reports `connected` (the 2026-10-19 phase 4 live exit, step 2).
//
// The failing shape, `z.record(z.string(), z.unknown())` (the old
// `kernel_agent_create` charter), was seen failing with
// `@anthropic-ai/claude-agent-sdk` 0.3.284, `zod` 4.6.5 and
// `@modelcontextprotocol/sdk` 1.31.0: `MCP error -32603: Cannot read
// properties of undefined (reading 'push')`. A later SDK may serialise it; the
// fixture's cases then fail, which is the signal to re-check them.
//
// `startKernel` runs the same listing before the store opens
// (`assertKernelToolsList`) and refuses a start whose tools would not list.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startFailureExit } from "../src/daemon-exit.js";
import { InvalidContributionError, PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { ContributedTool } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import { Store } from "../src/store/index.js";
import { KERNEL_TOOL_NAMES, LISTING_CTX, assertKernelToolsList, kernelToolDefinitions, kernelToolNames, listKernelTools } from "../src/tools/server.js";

const SHIPPED = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;

/** The old `kernel_agent_create` charter shape: a record the SDK's serialiser throws on. */
function recordTool(name: string): ContributedTool {
  return defineTool({
    name,
    description: "A record-shaped fixture.",
    shape: { charter: z.record(z.string(), z.unknown()) },
    handler: () => null,
  });
}

const FIXTURE = recordTool("kernel_probe_record");

/** A tool with a plain shape, for the stubbed-lister cases. */
function defineToolNamed(name: string): ContributedTool {
  return defineTool({ name, description: "A plain fixture.", shape: { x: z.string() }, handler: () => null });
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-tools-sdk-list-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("the shipped kernel tools list through the Agent SDK", () => {
  it("(a) every name of kernelToolNames is listed (22 in all), each with an object input schema", async () => {
    const expected = kernelToolNames(SHIPPED);
    expect(expected).toHaveLength(22);
    const listed = await listKernelTools(SHIPPED);
    expect(listed.map((t) => t.name).sort()).toEqual([...expected].sort());
    for (const t of listed) expect((t.inputSchema as { type?: unknown }).type, t.name).toBe("object");
  });

  it("kernel_agent_create's charter is listed as a JSON object, not a record", async () => {
    const listed = await listKernelTools(SHIPPED);
    const create = listed.find((t) => t.name === "kernel_agent_create");
    expect((create?.inputSchema as { properties?: Record<string, unknown> }).properties?.charter).toEqual({ type: "object" });
  });

  it("(e) the listing context's members throw when used, and listing the shipped tools with it still resolves (no handler, store or session member runs)", async () => {
    expect(LISTING_CTX.sessionId).toBe(0);
    expect(() => LISTING_CTX.store.dataDir).toThrow("tool listing only");
    expect(() => LISTING_CTX.sessions.getSession(1)).toThrow("tool listing only");
    expect(() => LISTING_CTX.sessions.stopSession(1)).toThrow("tool listing only");
    expect(kernelToolDefinitions(LISTING_CTX, SHIPPED)).toHaveLength(22);
    await expect(listKernelTools(SHIPPED)).resolves.toHaveLength(22);
  });
});

describe("a tool whose shape the SDK cannot serialise", () => {
  it("(b) fails the listing, alone and beside the shipped tools", async () => {
    await expect(listKernelTools([FIXTURE])).rejects.toThrow();
    await expect(listKernelTools([...SHIPPED, FIXTURE])).rejects.toThrow();
  });

  it("(c) assertKernelToolsList names only the failing tool, with the listing error's first line; two failing tools are both named", async () => {
    const err = await assertKernelToolsList([...SHIPPED, FIXTURE]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).contributor).toBe("kernel_probe_record");
    expect((err as Error).message).toMatch(
      /^contribution kernel_probe_record: invalid tool: its input schema does not serialise through the Agent SDK, so tools\/list would offer sessions no kernel tool: \S/,
    );
    expect((err as Error).message).not.toContain("\n");

    const two = await assertKernelToolsList([...SHIPPED, FIXTURE, recordTool("kernel_probe_record_two")]).catch((e: unknown) => e);
    expect(two).toBeInstanceOf(InvalidContributionError);
    expect((two as InvalidContributionError).contributor).toBe("kernel_probe_record, kernel_probe_record_two");
  });

  it("no tool fails alone but the combination does: every contributed tool is named, with the combination's error", async () => {
    const two = [defineToolNamed("kernel_probe_a"), defineToolNamed("kernel_probe_b")];
    const seen: string[][] = [];
    const list = (tools: readonly ContributedTool[]): Promise<{ name: string }[]> => {
      seen.push(tools.map((t) => t.name));
      if (tools.length > 1) return Promise.reject(new Error("the combination fails\nsecond line"));
      return Promise.resolve(kernelToolNames(tools).map((name) => ({ name })));
    };
    const err = await assertKernelToolsList(two, list).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).contributor).toBe("kernel_probe_a, kernel_probe_b");
    expect((err as Error).message).toBe(
      "contribution kernel_probe_a, kernel_probe_b: invalid tool: its input schema does not serialise through the Agent SDK, " +
        "so tools/list would offer sessions no kernel tool: no tool fails alone, the combination fails: the combination fails",
    );
    expect(seen).toEqual([["kernel_probe_a", "kernel_probe_b"], [], ["kernel_probe_a"], ["kernel_probe_b"]]);
  });

  it("a phase 1 tool that fails to list: the phase 1 tools are named, no contributed tool is, and no contributed tool is listed alone", async () => {
    const seen: string[][] = [];
    const list = (tools: readonly ContributedTool[]): Promise<{ name: string }[]> => {
      seen.push(tools.map((t) => t.name));
      return Promise.reject(new Error("a phase 1 shape fails\nsecond line"));
    };
    const err = await assertKernelToolsList(SHIPPED, list).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).contributor).toBe(KERNEL_TOOL_NAMES.join(", "));
    for (const t of SHIPPED) expect((err as Error).message, t.name).not.toContain(t.name);
    expect((err as Error).message).toBe(
      `contribution ${KERNEL_TOOL_NAMES.join(", ")}: invalid tool: its input schema does not serialise through the Agent SDK, ` +
        "so tools/list would offer sessions no kernel tool: a phase 1 shape fails",
    );
    expect(seen).toEqual([SHIPPED.map((t) => t.name), []]);
  });

  it("no contributed tool and a failing phase 1 listing: the phase 1 tools are named (never an empty contributor)", async () => {
    const list = (): Promise<{ name: string }[]> => Promise.reject(new Error("a phase 1 shape fails"));
    const err = await assertKernelToolsList([], list).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).contributor).toBe(KERNEL_TOOL_NAMES.join(", "));
    expect(KERNEL_TOOL_NAMES.length).toBeGreaterThan(0);
  });

  it("a listing that succeeds makes exactly one listing call", async () => {
    const seen: string[][] = [];
    const list = (tools: readonly ContributedTool[]): Promise<{ name: string }[]> => {
      seen.push(tools.map((t) => t.name));
      return Promise.resolve(kernelToolNames(tools).map((name) => ({ name })));
    };
    await expect(assertKernelToolsList(SHIPPED, list)).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  it("a listing that succeeds but omits a tool names the omitted one with its own reason (not a schema failure)", async () => {
    const list = (tools: readonly ContributedTool[]): Promise<{ name: string }[]> =>
      Promise.resolve(kernelToolNames(tools).filter((name) => name !== "kernel_agent_list").map((name) => ({ name })));
    const err = await assertKernelToolsList(SHIPPED, list).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).contributor).toBe("kernel_agent_list");
    expect((err as Error).message).toBe(
      "contribution kernel_agent_list: invalid tool: tools/list succeeded but omitted kernel_agent_list, so sessions would not be offered it",
    );
    expect((err as Error).message).not.toContain("does not serialise");

    const omitTwo = (tools: readonly ContributedTool[]): Promise<{ name: string }[]> =>
      Promise.resolve(
        kernelToolNames(tools)
          .filter((name) => name !== "kernel_agent_list" && name !== "kernel_agent_create")
          .map((name) => ({ name })),
      );
    const two = await assertKernelToolsList(SHIPPED, omitTwo).catch((e: unknown) => e);
    expect((two as Error).message).toMatch(/, so sessions would not be offered them$/);
  });

  it("the shipped tools pass the check", async () => {
    await expect(assertKernelToolsList(SHIPPED)).resolves.toBeUndefined();
  });

  it("(d) startKernel refuses with InvalidContributionError naming it before the store opens; under --launchd that is a permanent exit naming the tool", async () => {
    // Records the call and throws: should the check ever be skipped, the start stops here, before any Keychain, session or API side effect.
    const openStore = vi.fn((): Store => {
      throw new Error("the store was opened");
    });
    const sandbox = { dataDir: join(tmp, "data"), env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: join(tmp, "no-plugin") } };
    const err = await startKernel({ ...sandbox, contributions: [...SHIPPED_CONTRIBUTIONS, { name: "probe", tools: [FIXTURE] }] }, { openStore }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).contributor).toBe("kernel_probe_record");
    expect(openStore).not.toHaveBeenCalled();

    const exit = startFailureExit(err, true);
    expect(exit.status).toBe(0);
    expect(exit.line).not.toContain("\n");
    expect(exit.line).toContain("kernel_probe_record");

    const two = await startKernel(
      { ...sandbox, contributions: [...SHIPPED_CONTRIBUTIONS, { name: "probe", tools: [FIXTURE, recordTool("kernel_probe_record_two")] }] },
      { openStore },
    ).catch((e: unknown) => e);
    expect((two as InvalidContributionError).contributor).toBe("kernel_probe_record, kernel_probe_record_two");
    expect(openStore).not.toHaveBeenCalled();
  });
});
