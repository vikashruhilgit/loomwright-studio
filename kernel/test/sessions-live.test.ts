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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SUBSCRIPTION_TOKEN_ID, selectAuthProvider } from "../src/auth/index.js";
import { PROPOSED_ALLOWED_TOOLS } from "../src/brain/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { SessionManager } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { KERNEL_MCP_SERVER_NAME, createKernelMcpServer } from "../src/tools/server.js";

const LIVE = process.env.STUDIO_LIVE === "1";

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
