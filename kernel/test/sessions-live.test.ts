// Opt-in live test (AC9): a REAL session through the real SDK and a real
// model (Haiku), on the owner's subscription token from the Keychain. Never
// runs in CI or by default — set STUDIO_LIVE=1 to run it locally:
//
//   cd kernel && STUDIO_LIVE=1 npx vitest run test/sessions-live.test.ts
//
// It asks the model to run `touch gated.txt` under a policy that allows
// nothing, and asserts the kernel's PreToolUse gate kept the file from being
// created and recorded a deny.
//
// Then (item 09) it asks a session under Wright's proposed policy, unchanged,
// with the kernel MCP server attached the way `kernel.ts` attaches it, to set
// a reminder, and asserts a trigger was registered and the store holds no
// `ToolSearch` `tool_decision` for that session: the kernel launches every
// session with the SDK's tool deferral off, so its kernel tools are offered
// directly (docs/evidence/agent-sdk-tool-loading-probe.md).
//
// The manager-level AC15/AC16 block below (phase 8 item 22g) is NOT live: it
// runs in `npm test` on the fake spawner and query (session-fakes.ts) and reads
// a started run session's admitted script set back through its real
// PreToolUse gate.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SUBSCRIPTION_TOKEN_ID, selectAuthProvider } from "../src/auth/index.js";
import { AUTOMATE_RUN_POLICY } from "../src/automate/launch.js";
import { PROPOSED_ALLOWED_TOOLS } from "../src/brain/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { SessionManager } from "../src/sessions/index.js";
import { LoomwrightSessionError } from "../src/sessions/loomwright-path.js";
import type { ToolPolicy } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { KERNEL_MCP_SERVER_NAME, createKernelMcpServer } from "../src/tools/server.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const LIVE = process.env.STUDIO_LIVE === "1";

describe("a started run session's admitted Loomwright scripts (AC15/AC16, on fakes)", () => {
  let tmp: string;
  let pluginDir: string;
  let store: Store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "studio-run-scripts-"));
    pluginDir = makePluginDir(tmp);
    store = new Store({ dataDir: join(tmp, "data") });
  });

  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  function setup(admission?: () => { admitted: true }) {
    const fakes = fakeSessions();
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, ...(admission === undefined ? {} : { admission }) },
      { ...fakes.deps, homeDir: join(tmp, "home") },
    );
    return { fakes, manager };
  }

  /** `call`'s PreToolUse gate for a Bash command, as the CLI would call it from `tmp`. */
  function bashGate(call: FakeCall) {
    const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    return async (command: string) => {
      const input = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
      return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput;
    };
  }

  it("holds the exact paths built from the session's own loomwrightPath: the run's drivers are admitted, nothing else", async () => {
    const next = join(pluginDir, "scripts", "automate-next-step.sh");
    const helpers = join(pluginDir, "scripts", "automate-helpers.sh");
    const unlisted = join(pluginDir, "scripts", "automate-not-listed.sh");
    for (const p of [next, helpers, unlisted]) writeFileSync(p, "#!/bin/bash\n");
    const { fakes, manager } = setup();
    const handle = await manager.startSession(startParams(tmp, { policy: AUTOMATE_RUN_POLICY, closeInputOnResult: false }));
    // The SDK loads the same install string the admitted set is built from.
    const call = fakes.calls[0] as FakeCall;
    expect(call.options.plugins).toEqual([{ type: "local", path: pluginDir }]);
    const gate = bashGate(call);
    expect(await gate(`bash ${next} --resume ${join(tmp, ".supervisor", "automate")}`)).toMatchObject({ permissionDecision: "allow" });
    expect(await gate(`bash "${helpers}" meta-entry`)).toMatchObject({ permissionDecision: "allow" });
    for (const command of [`bash ${unlisted}`, `bash ${join(tmp, "scripts", "automate-next-step.sh")}`, "bash -c id", `bash ${pluginDir}/scripts/../scripts/automate-next-step.sh`]) {
      expect(await gate(command), command).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "bash_prefix_not_allowed" });
    }
    expect(await gate(`bash ${next} $(id)`)).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "bash_shell_metacharacter" });
    // The rail still runs on an admitted path: a direct merge is still blocked.
    expect(await gate("gh pr merge 7 --squash")).toMatchObject({ permissionDecision: "deny" });
    (fakes.calls[0] as FakeCall).stream.end();
    await handle.done;
  });

  it("refuses a loomwrightScripts that is not an array of names: invalid_params, before Loomwright, no row", async () => {
    const { fakes, manager } = setup();
    for (const loomwrightScripts of ["automate-next-step.sh", [1], [null], {}]) {
      const policy = { allowedTools: ["Bash"], allowedBashPrefixes: [], loomwrightScripts } as unknown as ToolPolicy;
      const err = await manager.startSession(startParams(tmp, { policy })).catch((e: unknown) => e);
      expect(err, JSON.stringify(loomwrightScripts)).toMatchObject({ name: "SessionError", code: "invalid_params" });
    }
    expect(fakes.calls).toHaveLength(0);
    expect(count(store, "SELECT count(*) FROM sessions")).toBe(0);
    expect(events(store, "session_refused")).toEqual([]);
  });

  it("drops a caller's own admittedScriptPaths: only the manager fills the set", async () => {
    const evil = join(tmp, "evil.sh");
    writeFileSync(evil, "#!/bin/bash\n");
    const { fakes, manager } = setup();
    const policy = { allowedTools: ["Bash"], allowedBashPrefixes: [], admittedScriptPaths: [evil] } as ToolPolicy;
    const handle = await manager.startSession(startParams(tmp, { policy, closeInputOnResult: false }));
    expect(await bashGate(fakes.calls[0] as FakeCall)(`bash ${evil}`)).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "bash_prefix_not_allowed" });
    (fakes.calls[0] as FakeCall).stream.end();
    await handle.done;
  });

  it("refuses the start when the install's scripts/ cannot be read: loomwright_not_found / install_path_invalid, before admission, no row and no spawn", async () => {
    // A valid install (manifest and contract) whose scripts/ directory is gone.
    const bare = makePluginDir(join(tmp, "bare"));
    rmSync(join(bare, "scripts"), { recursive: true });
    pluginDir = bare;
    let asked = 0;
    const { fakes, manager } = setup(() => {
      asked += 1;
      return { admitted: true };
    });
    const err = await manager.startSession(startParams(tmp, { policy: AUTOMATE_RUN_POLICY })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoomwrightSessionError);
    expect(err).toMatchObject({ code: "loomwright_not_found", detail: "install_path_invalid", path: join(bare, "scripts") });
    expect(asked).toBe(0);
    expect(fakes.calls).toHaveLength(0);
    expect(count(store, "SELECT count(*) FROM sessions")).toBe(0);
    expect(events(store, "session_refused").map((e) => [e.session_id, e.payload])).toEqual([
      [null, { reason: "loomwright_not_found", detail: "install_path_invalid", path: join(bare, "scripts") }],
    ]);

    // A policy that names no script never reads scripts/: the same install starts it.
    const handle = await manager.startSession(startParams(tmp, { closeInputOnResult: false }));
    expect(count(store, "SELECT count(*) FROM sessions")).toBe(1);
    (fakes.calls[0] as FakeCall).stream.end();
    await handle.done;
  });
});

describe.skipIf(!LIVE)("live session (STUDIO_LIVE=1)", () => {
  const dirs: string[] = [];
  const stores: Store[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("a denied `touch gated.txt` never creates the file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "studio-live-cwd-"));
    const dataDir = mkdtempSync(join(tmpdir(), "studio-live-data-"));
    dirs.push(cwd, dataDir);
    const store = new Store({ dataDir });
    stores.push(store);

    const authProvider = await selectAuthProvider(SUBSCRIPTION_TOKEN_ID, { store });
    const manager = new SessionManager({ store, authProvider });
    const handle = await manager.startSession({
      agent: "live-test",
      prompt: "Run the Bash command `touch gated.txt`, then reply DONE.",
      model: "claude-haiku-4-5",
      permissionMode: "default",
      cwd,
      policy: { allowedTools: [], allowedBashPrefixes: [] },
    });
    const status = await handle.done;

    expect(existsSync(join(cwd, "gated.txt"))).toBe(false);
    const denies = store
      .prepare<[], number>(
        "SELECT count(*) FROM events WHERE kind = 'tool_decision' AND json_extract(payload_json, '$.decision') = 'deny'",
      )
      .pluck()
      .get();
    expect(denies).toBeGreaterThanOrEqual(1);
    expect(["completed", "failed"]).toContain(status);
  }, 120_000);

  it("under Wright's proposed policy, a session sets a reminder through its kernel tool, with no ToolSearch decision", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "studio-live-cwd-"));
    const dataDir = mkdtempSync(join(tmpdir(), "studio-live-data-"));
    dirs.push(cwd, dataDir);
    const store = new Store({ dataDir });
    stores.push(store);

    const tools = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;
    const authProvider = await selectAuthProvider(SUBSCRIPTION_TOKEN_ID, { store });
    // The tool calls the model made, for the failure messages (names only).
    const toolUses: string[] = [];
    const manager: SessionManager = new SessionManager({
      store,
      authProvider,
      // As kernel.ts attaches it: a fresh kernel server per launch, bound to the session.
      mcpServers: ({ sessionId }) => ({ [KERNEL_MCP_SERVER_NAME]: createKernelMcpServer({ store, sessions: manager, sessionId }, tools) }),
      onMessage: (_id, message) => {
        if (message.type !== "assistant") return;
        for (const block of message.message.content) if (block.type === "tool_use") toolUses.push(block.name);
      },
    });
    const handle = await manager.startSession({
      agent: "wright",
      prompt:
        "The user says: remind me at 17:00 today to check X. Register a once trigger with action notify using your kernel trigger tool, then reply DONE.",
      model: "claude-haiku-4-5",
      permissionMode: "default",
      cwd,
      policy: { allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] },
    });
    const status = await handle.done;
    const reply = await handle.result;

    const decisions = store
      .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'tool_decision' AND session_id = ? ORDER BY id")
      .pluck()
      .all(handle.id)
      .map((p) => JSON.parse(p) as { tool: string; decision: string; reason: string });
    const triggers = store
      .prepare<[], { owning_agent: string; kind: string; action: string }>("SELECT owning_agent, kind, action FROM triggers ORDER BY id")
      .all();
    const seen = JSON.stringify({ status, tool_uses: toolUses, decisions, reply: reply?.slice(0, 500) ?? null });
    expect(decisions.filter((d) => d.tool === "ToolSearch"), seen).toEqual([]);
    expect(decisions, seen).toContainEqual({ tool: "mcp__kernel__kernel_trigger_register", decision: "allow", reason: "tool_allowed" });
    expect(triggers, seen).toContainEqual({ owning_agent: "wright", kind: "once", action: "notify" });
    expect(status, seen).toBe("completed");
  }, 180_000);
});
