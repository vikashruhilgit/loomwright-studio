// A charter may propose the GitHub grant (phase 6 item 09, `kernel/src/agents/
// charter-files.ts` and `charter-tools.ts`): `connectors: ["github"]` is an
// optional charter key. It is only a proposal: the held `kernel_agent_create`
// shows it on the enforced line, and `config/agents/<id>.json` and `role.md`
// hold it only when the owner approves the call (D34). A charter without it
// renders byte-identical files and display, and `kernel_agent_update` still
// refuses `connectors` (the grant is never changed by an update).
//
// A kernel composed with the shipped features over the fake spawner/query
// (session-fakes.ts), the real PreToolUse gate and the real `studio` CLI over
// the loopback API; never the real SDK, a model or the network.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONNECTOR_KINDS } from "../src/integrations/types.js";
import { createDisplay } from "../src/agents/charter-tools.js";
import { agentFilePaths, agentSettingsPath, readAgentSettings, renderAgentSettingsJson, renderRoleMd, validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../src/api/index.js";
import { defaultWrightSettingsJson } from "../src/brain/index.js";
import { runCli } from "../src/cli/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import type { ToolPolicy } from "../src/sessions/types.js";
import { events } from "./loop-helpers.js";
import { stubNotifierContributions } from "./notifier-stub.js";
import { fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const MODEL = "claude-haiku-4-5";
const CREATE = "mcp__kernel__kernel_agent_create";
const UPDATE = "mcp__kernel__kernel_agent_update";
const POLICY: ToolPolicy = { allowedTools: [CREATE, UPDATE], allowedBashPrefixes: [] };

let tmp: string;
let dataDir: string;
let home: string;
let kernel: Kernel;
let fakes: ReturnType<typeof fakeSessions>;
let keychain: Map<string, string>;
const kernels: Kernel[] = [];

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "studio-charter-grant-"));
  dataDir = join(tmp, "data");
  home = join(tmp, "home");
  mkdirSync(home);
  const wright = agentSettingsPath(dataDir, "wright");
  mkdirSync(join(wright, ".."), { recursive: true });
  writeFileSync(wright, `${JSON.stringify({ ...(JSON.parse(defaultWrightSettingsJson()) as object), model: MODEL }, null, 2)}\n`);
  keychain = new Map<string, string>();
  fakes = fakeSessions();
  kernel = await startKernel(
    { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 }, contributions: stubNotifierContributions() },
    {
      keychain: { read: (service) => keychain.get(service) },
      keychainWriter: { add: (service, _account, secret) => void keychain.set(service, secret) },
      sessionDeps: { ...fakes.deps, homeDir: home },
      selectAuthProvider: async () => stubProvider(),
      availableProviderIds: async () => ["api-key"],
      loopDeps: { tickMs: 3_600_000 },
    },
  );
  kernels.push(kernel);
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Helpers ---------------------------------------------------------------------

/** A comment-only reviewer charter; `extra` adds or overrides keys (the grant is a proposal Wright adds). */
function charter(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "reviewer",
    display_name: "Reviewer",
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful reviewer who comments on pull requests.",
    duties: ["Review the pull requests the owner sends and comment on them."],
    boundaries: ["Never push code."],
    model: "claude-sonnet-5",
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [], never: ["git_push"] },
    limits: { tokens_per_day: 200000 },
    workspaces: [join(tmp, "work")],
    ...extra,
  };
}

function validated(c: Record<string, unknown>): Charter {
  const r = validateCharter(c, { dataDir, homeDir: home });
  if (!r.ok) throw new Error(`not valid: ${r.message}`);
  return r.charter;
}

type Decision = { permissionDecision: string; permissionDecisionReason: string };

/** Start Wright's session and return a function calling its PreToolUse gate, as the CLI would from `tmp`. */
async function wrightGate(): Promise<(tool: string, toolInput: unknown) => Promise<Decision>> {
  await kernel.sessions.startSession({ agent: "wright", prompt: "Draft a crew member.", model: MODEL, permissionMode: "default", cwd: tmp, policy: POLICY, closeInputOnResult: false });
  const call = fakes.calls[fakes.calls.length - 1] as FakeCall;
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return async (tool, toolInput) => {
    const input = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
    return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
  };
}

/** `studio <argv>` against this kernel. */
async function studio(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { dataDir, keychain: { read: (s) => keychain.get(s) }, stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

const count = (sql: string): number => kernel.store.prepare<[], number>(sql).pluck().get() ?? -1;

/** The display lines `studio approvals` shows for the pending approval (from "display:" to "payload:"). */
async function shownDisplay(): Promise<string> {
  const shown = await studio("approvals");
  expect(shown.code).toBe(0);
  return shown.stdout.slice(shown.stdout.indexOf("  display:\n"), shown.stdout.indexOf("  payload:\n"));
}

const ENFORCED = "enforced: never: git_push; tools: Read; bash prefixes: none";

// ---- The charter key -------------------------------------------------------------

describe("the charter's optional connectors key", () => {
  it("is a closed set of the connector kinds (CONNECTOR_KINDS), published as a charter field, and a repeat, an unknown kind or a non-list is refused naming connectors", () => {
    expect(CONNECTOR_KINDS).toEqual(["github"]);
    expect(validated(charter({ connectors: ["github"] })).connectors).toEqual(["github"]);
    for (const bad of [["github", "github"], ["gitlab"], "github", [1], [null]]) {
      const r = validateCharter(charter({ connectors: bad }), { dataDir, homeDir: home });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.ok ? "" : r.field, JSON.stringify(bad)).toMatch(/^connectors/);
    }
    // The charter stays strict: a misspelt key is still refused.
    const misspelt = validateCharter(charter({ connector: ["github"] }), { dataDir, homeDir: home });
    expect(misspelt).toMatchObject({ ok: false, error: "charter_invalid", field: "connector" });
  });

  it("renders the settings file with connectors last, only when non-empty; absent or empty renders the bytes it always did", () => {
    const none = validated(charter());
    const empty = validated(charter({ connectors: [] }));
    const granted = validated(charter({ connectors: ["github"] }));
    expect(renderAgentSettingsJson(empty)).toBe(renderAgentSettingsJson(none));
    expect(renderAgentSettingsJson(none)).not.toContain("connectors");
    const parsed = JSON.parse(renderAgentSettingsJson(granted)) as Record<string, unknown>;
    expect(Object.keys(parsed).slice(-2)).toEqual(["workspaces", "connectors"]);
    expect(parsed.connectors).toEqual(["github"]);
    expect(renderAgentSettingsJson(granted)).toBe(`${JSON.stringify({ ...JSON.parse(renderAgentSettingsJson(none)), connectors: ["github"] }, null, 2)}\n`);
  });
});

// ---- AC4: the grant is written only on approval -----------------------------------

describe("kernel_agent_create with connectors: [github] (AC4)", () => {
  it("held: no row and no file; the owner's once writes config/agents/<id>.json with connectors and role.md names GitHub under What the kernel enforces", async () => {
    const gate = await wrightGate();
    const held = await gate(CREATE, { charter: charter({ connectors: ["github"] }), idempotency_key: "c1" });
    expect(held.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(count("SELECT count(*) FROM agents")).toBe(0);
    expect(agentFilePaths(dataDir, "reviewer").all.filter((p) => existsSync(p))).toEqual([]);

    const approved = await studio("approve", "1", "once");
    expect(approved.code).toBe(0);
    expect(approved.stdout).toContain("the kernel applied it: The kernel created crew member reviewer (Reviewer) on approval 1.");

    const paths = agentFilePaths(dataDir, "reviewer");
    const settings = JSON.parse(readFileSync(paths.settings, "utf8")) as Record<string, unknown>;
    expect(settings.connectors).toEqual(["github"]);
    const read = readAgentSettings(dataDir, "reviewer", { homeDir: home });
    expect(read.ok && read.settings.connectors).toEqual(["github"]);
    const role = readFileSync(paths.memory[0] as string, "utf8");
    expect(role).toContain("tool policy, never list, limits, workspaces and connectors (GitHub).");
    expect(role).toBe(renderRoleMd(validated(charter({ connectors: ["github"] })), ["github"]));
    // The row's charter snapshot keeps the proposal, so a lost file is re-created with the grant.
    const row = kernel.store.prepare<[], { charter_json: string }>("SELECT charter_json FROM agents WHERE id = 'reviewer'").get();
    expect((JSON.parse(row?.charter_json ?? "{}") as { connectors?: unknown }).connectors).toEqual(["github"]);
  });

  it("denied: no agents row, no settings file, no memory file is written", async () => {
    const gate = await wrightGate();
    const held = await gate(CREATE, { charter: charter({ connectors: ["github"] }), idempotency_key: "c1" });
    expect(held.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const denied = await studio("deny", "1");
    expect(denied.code, denied.stderr).toBe(0);
    expect(count("SELECT count(*) FROM agents")).toBe(0);
    expect(existsSync(agentSettingsPath(dataDir, "reviewer"))).toBe(false);
    expect(existsSync(join(dataDir, "memory", "reviewer"))).toBe(false);
    expect(events(kernel.store, "agent_created")).toEqual([]);
  });

  it("a charter with no connectors writes a settings file with no connectors key and the role.md line it always had", async () => {
    const gate = await wrightGate();
    await gate(CREATE, { charter: charter(), idempotency_key: "c1" });
    expect((await studio("approve", "1", "once")).code).toBe(0);
    const paths = agentFilePaths(dataDir, "reviewer");
    const text = readFileSync(paths.settings, "utf8");
    expect(text).toBe(renderAgentSettingsJson(validated(charter())));
    expect(text).not.toContain("connectors");
    expect(readFileSync(paths.memory[0] as string, "utf8")).toContain("tool policy, never list, limits and workspaces. A call outside them");
  });
});

// ---- AC8: the owner sees the grant before approving ---------------------------------

describe("the held create's display (AC8)", () => {
  it("a proposed grant ends the enforced line with `; connectors: github`; the shown settings file and role.md match what the kernel writes", async () => {
    const gate = await wrightGate();
    await gate(CREATE, { charter: charter({ connectors: ["github"] }), idempotency_key: "c1" });
    const block = await shownDisplay();
    const lines = block.split("\n").slice(1, 3);
    expect(lines[1]).toBe(`    ${ENFORCED}; connectors: github`);
    const c = validated(charter({ connectors: ["github"] }));
    expect(block).toContain('\n      "connectors": [\n        "github"\n      ]\n');
    for (const line of renderRoleMd(c, ["github"]).trimEnd().split("\n")) expect(block).toContain(`\n    ${line}`);
    expect(block).toContain("limits, workspaces and connectors (GitHub)");
  });

  it("with no connectors the display is byte-identical to today's (no connectors text anywhere), and an empty list reads as none", () => {
    const none = validated(charter());
    const text = createDisplay(none);
    expect(text).not.toContain("connectors");
    expect(text.split("\n")[1]).toBe(ENFORCED);
    expect(createDisplay(validated(charter({ connectors: [] })))).toBe(text);
    expect(text).toBe(
      [
        'Create crew member reviewer ("Reviewer", crab crew-teal), proposed by Wright',
        ENFORCED,
        "limits: tokens_per_day 200000 (proposed); sessions_at_once not set (no limit); delegation_depth not set (no limit)",
        `workspaces: ${join(tmp, "work")}`,
        "config/agents/reviewer.json:",
        renderAgentSettingsJson(none).trimEnd(),
        "memory/reviewer/role.md:",
        renderRoleMd(none).trimEnd(),
      ].join("\n"),
    );
  });
});

// ---- AC10: an update never changes the grant ------------------------------------------

describe("kernel_agent_update (AC10)", () => {
  it("still refuses changes {connectors: [github]}, alone or beside a valid change: nothing held, the settings bytes unchanged", async () => {
    const gate = await wrightGate();
    await gate(CREATE, { charter: charter(), idempotency_key: "c1" });
    expect((await studio("approve", "1", "once")).code).toBe(0);
    const bytes = readFileSync(agentSettingsPath(dataDir, "reviewer"));
    const sha = createHash("sha256").update(bytes).digest("hex");
    const alone = await gate(UPDATE, { id: "reviewer", changes: { connectors: ["github"] }, expected_sha256: sha, idempotency_key: "u1" });
    expect(alone.permissionDecision).toBe("deny");
    expect(alone.permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: /);
    expect(alone.permissionDecisionReason).not.toMatch(/approval_required/);
    const mixed = await gate(UPDATE, { id: "reviewer", changes: { model: "claude-opus-5", connectors: ["github"] }, expected_sha256: sha, idempotency_key: "u2" });
    expect(mixed.permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: /);
    expect(readFileSync(agentSettingsPath(dataDir, "reviewer")).equals(bytes)).toBe(true);
    expect(count("SELECT count(*) FROM approvals")).toBe(1);
  });
});
