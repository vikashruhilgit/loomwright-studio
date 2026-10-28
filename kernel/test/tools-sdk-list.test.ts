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
//
// The same listing must also show every closed value set the kernel's checks
// enforce as a JSON-Schema `enum`, and every positive-count bound as a
// positive integer, so a session drafts a valid call the first time instead
// of guessing: a session that has to guess a closed value set is refused and
// retries, one call per wrong guess. `CLOSED_VALUE_SETS` classifies every
// shipped tool, and its walk fails on a set not published.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CHARTER_PERMISSION_MODES } from "../src/agents/charter-files.js";
import { AVATAR_HUES, AVATAR_SHAPES } from "../src/agents/types.js";
import { startFailureExit } from "../src/daemon-exit.js";
import { InvalidContributionError, PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { ContributedTool } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import { DEDUPE_KEY_FIELDS, PLAYBOOK_MODES, PLAYBOOK_PRIORITIES } from "../src/playbooks/types.js";
import { NEVER_CATEGORIES } from "../src/sessions/policy.js";
import { Store } from "../src/store/index.js";
import { KERNEL_TOOL_NAMES, LISTING_CTX, assertKernelToolsList, kernelToolDefinitions, kernelToolNames, listKernelTools } from "../src/tools/server.js";
import { TRIGGER_ACTIONS, TRIGGER_KINDS } from "../src/triggers/index.js";

const SHIPPED = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;

/**
 * One closed set a tool's input must publish. `path` is dotted through the
 * input schema's `properties`, with `[]` for an array's `items`
 * (`charter.tool_policy.never[]`). An `enum` entry must list exactly the
 * source constant's values, in order; a `positiveInteger` entry must be
 * `"type": "integer"` with a positive lower bound (`exclusiveMinimum >= 0` or
 * `minimum >= 1`; a `maximum` is ignored). A `nullable` entry is zod 4's
 * `anyOf: [<schema>, {"type": "null"}]`: the null branch must be there (null
 * clears the value) and the other branch is checked.
 */
type ClosedValueSet =
  | { readonly path: string; readonly enum: readonly string[]; readonly nullable?: true }
  | { readonly path: string; readonly positiveInteger: true; readonly nullable?: true };

/** The charter's closed sets, under `prefix` (`charter.` for create, `changes.` for update, whose `never` is top level). */
function charterSets(prefix: string, never: string, nullableLimits: boolean): ClosedValueSet[] {
  const nullable = nullableLimits ? ({ nullable: true } as const) : {};
  return [
    { path: `${prefix}avatar.shape`, enum: AVATAR_SHAPES },
    { path: `${prefix}avatar.hue`, enum: AVATAR_HUES },
    { path: `${prefix}permission_mode`, enum: CHARTER_PERMISSION_MODES },
    { path: `${prefix}${never}[]`, enum: NEVER_CATEGORIES },
    { path: `${prefix}limits.tokens_per_day`, positiveInteger: true, ...nullable },
    { path: `${prefix}limits.sessions_at_once`, positiveInteger: true, ...nullable },
    { path: `${prefix}limits.delegation_depth`, positiveInteger: true, ...nullable },
  ];
}

/** A playbook draft's policy and trigger sets, under `prefix` (`changes.` for update). */
function playbookSets(prefix: string): ClosedValueSet[] {
  return [
    { path: `${prefix}dedupe_key[]`, enum: DEDUPE_KEY_FIELDS },
    { path: `${prefix}priority`, enum: PLAYBOOK_PRIORITIES },
    { path: `${prefix}mode`, enum: PLAYBOOK_MODES },
    { path: `${prefix}trigger.kind`, enum: TRIGGER_KINDS },
    { path: `${prefix}token_limit`, positiveInteger: true },
  ];
}

/**
 * Every shipped tool, keyed by name, with the closed sets the kernel enforces
 * on its input (empty: none). A new tool fails the walk until it is classified
 * here. Task `state` / `kind` are the user's vocabulary (invariant 1), an
 * approval's `payload` is free JSON, and `kernel_agent_message`'s `workspace`
 * is checked against the target's own settings (per member, not a closed set).
 */
const CLOSED_VALUE_SETS: Readonly<Record<string, readonly ClosedValueSet[]>> = {
  kernel_task_create: [],
  kernel_task_update: [],
  kernel_task_list: [],
  kernel_task_get: [],
  kernel_schedule_wakeup: [],
  kernel_request_stop: [],
  kernel_trigger_register: [
    { path: "kind", enum: TRIGGER_KINDS },
    { path: "action", enum: TRIGGER_ACTIONS },
  ],
  kernel_trigger_remove: [],
  kernel_trigger_list: [],
  kernel_notify: [],
  kernel_approval_request: [],
  kernel_loomwright_capabilities: [],
  kernel_playbook_create: playbookSets(""),
  kernel_playbook_update: playbookSets("changes."),
  kernel_playbook_list: [],
  kernel_playbook_disable: [],
  kernel_playbook_dry_run: [],
  kernel_playbook_enable: [],
  kernel_agent_create: charterSets("charter.", "tool_policy.never", false),
  kernel_agent_update: charterSets("changes.", "never", true),
  kernel_agent_list: [],
  kernel_agent_message: [],
  kernel_github_pr_get: [],
  kernel_github_pr_diff: [{ path: "max_bytes", positiveInteger: true }],
  kernel_github_pr_files: [],
  kernel_github_pr_comments: [],
};

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The schema at `path` in `schema`, or why there is none. */
function schemaAt(schema: unknown, path: string): Json | string {
  let node = schema;
  for (const segment of path.split(".").flatMap((s) => (s.endsWith("[]") ? [s.slice(0, -2), "[]"] : [s]))) {
    if (!isJson(node)) return `${path}: no schema above ${segment}`;
    node = segment === "[]" ? node.items : isJson(node.properties) ? node.properties[segment] : undefined;
  }
  return isJson(node) ? node : `${path}: not in the listed schema`;
}

/** Why `inputSchema` does not publish `set`, or undefined when it does. */
function closedSetProblem(inputSchema: unknown, set: ClosedValueSet): string | undefined {
  const found = schemaAt(inputSchema, set.path);
  if (typeof found === "string") return found;
  let node = found;
  if (set.nullable === true) {
    const branches = Array.isArray(node.anyOf) ? (node.anyOf as unknown[]) : [];
    const others = branches.filter((b) => !(isJson(b) && b.type === "null" && Object.keys(b).length === 1));
    if (branches.length !== 2 || others.length !== 1 || !isJson(others[0])) return `${set.path}: not anyOf [<schema>, {"type":"null"}] (${JSON.stringify(node)})`;
    node = others[0];
  }
  if ("enum" in set) {
    if (JSON.stringify(node.enum) !== JSON.stringify(set.enum)) return `${set.path}: enum ${JSON.stringify(node.enum)}, not ${JSON.stringify(set.enum)}`;
    return undefined;
  }
  const exclusive = typeof node.exclusiveMinimum === "number" && node.exclusiveMinimum >= 0;
  const inclusive = typeof node.minimum === "number" && node.minimum >= 1;
  if (node.type !== "integer" || !(exclusive || inclusive)) return `${set.path}: not a positive integer (${JSON.stringify(node)})`;
  return undefined;
}

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
  it("(a) every name of kernelToolNames is listed (26 in all), each with an object input schema", async () => {
    const expected = kernelToolNames(SHIPPED);
    expect(expected).toHaveLength(26);
    const listed = await listKernelTools(SHIPPED);
    expect(listed.map((t) => t.name).sort()).toEqual([...expected].sort());
    for (const t of listed) expect((t.inputSchema as { type?: unknown }).type, t.name).toBe("object");
  });

  it("kernel_agent_create's charter is listed as a JSON object with its properties, not a record", async () => {
    const listed = await listKernelTools(SHIPPED);
    const create = listed.find((t) => t.name === "kernel_agent_create");
    const charter = (create?.inputSchema as { properties?: Record<string, unknown> }).properties?.charter as Json | undefined;
    expect(charter?.type).toBe("object");
    expect(isJson(charter?.properties), JSON.stringify(charter)).toBe(true);
    // A record publishes `additionalProperties` as a schema; the strict charter publishes `false`.
    expect([undefined, false]).toContain(charter?.additionalProperties);
  });

  it("every shipped tool is classified in CLOSED_VALUE_SETS, and each listed input schema publishes its closed sets as enums and its bounds as positive integers", async () => {
    expect(Object.keys(CLOSED_VALUE_SETS).sort()).toEqual([...kernelToolNames(SHIPPED)].sort());
    const listed = await listKernelTools(SHIPPED);
    const problems = listed.flatMap((t) => (CLOSED_VALUE_SETS[t.name] ?? []).map((set) => closedSetProblem(t.inputSchema, set)).filter((p) => p !== undefined).map((p) => `${t.name}: ${p}`));
    expect(problems).toEqual([]);
    // The table is not vacuous: the six tools with closed sets are each checked.
    expect(Object.entries(CLOSED_VALUE_SETS).filter(([, sets]) => sets.length > 0).map(([name]) => name).sort()).toEqual(
      ["kernel_agent_create", "kernel_agent_update", "kernel_github_pr_diff", "kernel_playbook_create", "kernel_playbook_update", "kernel_trigger_register"],
    );
  });

  it("the walk refuses a set published as a bare string, number or other order, a missing path, and a nullable bound without its null branch", async () => {
    const loose = defineTool({
      name: "kernel_probe_loose",
      description: "A loose fixture.",
      shape: { kind: z.string(), e: z.enum(TRIGGER_KINDS), n: z.number(), m: z.number().int().positive(), o: z.object({ p: z.array(z.string()) }) },
      handler: () => null,
    });
    // The listing always has the phase 1 tools too: the fixture is found by name.
    const schema = (await listKernelTools([loose])).find((t) => t.name === "kernel_probe_loose")?.inputSchema;
    expect(isJson(schema)).toBe(true);
    expect(closedSetProblem(schema, { path: "kind", enum: TRIGGER_KINDS })).toMatch(/^kind: enum undefined, not /);
    expect(closedSetProblem(schema, { path: "o.p[]", enum: TRIGGER_KINDS })).toMatch(/^o\.p\[\]: enum undefined, not /);
    expect(closedSetProblem(schema, { path: "n", positiveInteger: true })).toMatch(/^n: not a positive integer/);
    expect(closedSetProblem(schema, { path: "m", positiveInteger: true })).toBeUndefined();
    expect(closedSetProblem(schema, { path: "m", positiveInteger: true, nullable: true })).toMatch(/^m: not anyOf /);
    expect(closedSetProblem(schema, { path: "absent", enum: TRIGGER_KINDS })).toBe("absent: not in the listed schema");
    expect(closedSetProblem(schema, { path: "e", enum: TRIGGER_KINDS })).toBeUndefined();
    expect(closedSetProblem(schema, { path: "e", enum: [...TRIGGER_KINDS].reverse() })).toBe(`e: enum ${JSON.stringify(TRIGGER_KINDS)}, not ${JSON.stringify([...TRIGGER_KINDS].reverse())}`);
  });

  it("(e) the listing context's members throw when used, and listing the shipped tools with it still resolves (no handler, store or session member runs)", async () => {
    expect(LISTING_CTX.sessionId).toBe(0);
    expect(() => LISTING_CTX.store.dataDir).toThrow("tool listing only");
    expect(() => LISTING_CTX.sessions.getSession(1)).toThrow("tool listing only");
    expect(() => LISTING_CTX.sessions.stopSession(1)).toThrow("tool listing only");
    expect(kernelToolDefinitions(LISTING_CTX, SHIPPED)).toHaveLength(26);
    await expect(listKernelTools(SHIPPED)).resolves.toHaveLength(26);
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
