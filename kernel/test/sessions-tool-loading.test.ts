// How kernel tools reach a session (item 09): every launch, a start and every
// resume attempt, passes the Agent SDK's tool deferral off in the env given
// to `query()`, so the CLI offers each tool directly and never only through
// its `ToolSearch` meta-tool (which no policy lists). The setting was probed
// on SDK 0.3.284: docs/evidence/agent-sdk-tool-loading-probe.md. Over the fake
// spawner/query in session-fakes.ts: never the real SDK, a model or a process.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripCredentialEnv } from "../src/auth/index.js";
import type { BaseEnv } from "../src/auth/index.js";
import { SessionManager } from "../src/sessions/index.js";
import type { ResumeSessionParams, SessionManagerOptions } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { fixtureContract, writeLoomwrightInstall } from "./fixtures/loomwright/helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const SECRET = "sk-ant-test-secret-value";

let tmp: string;
let pluginDir: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-tool-loading-"));
  pluginDir = makePluginDir(tmp);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

const resumeParams: ResumeSessionParams = {
  permissionMode: "default",
  cwd: "",
  policy: { allowedTools: ["Read"], allowedBashPrefixes: [] },
};

function setup(options: Partial<SessionManagerOptions> = {}) {
  const dataDir = join(tmp, "data");
  const store = new Store({ dataDir });
  stores.push(store);
  const fakes = fakeSessions();
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, ...options },
    fakes.deps,
  );
  const stateDirOf = (id: number): string => join(dataDir, "loomwright-state", `session-${id}`);
  return { store, manager, stateDirOf, ...fakes };
}

/** A start, a graceful shutdown (the row ends `interrupted`), then a resume: the two launches' env, in order. */
async function startThenResume(s: ReturnType<typeof setup>): Promise<{ id: number; envs: unknown[] }> {
  const handle = await s.manager.startSession(startParams(tmp));
  await vi.waitFor(() => expect(s.manager.getSession(handle.id)?.status).toBe("running"));
  await s.manager.stopAll({ mode: "shutdown" });
  expect(await handle.done).toBe("interrupted");
  const resumed = await s.manager.resumeSession(handle.id, { ...resumeParams, cwd: tmp });
  expect(resumed.id).toBe(handle.id);
  expect(s.calls).toHaveLength(2);
  expect(s.calls[0]?.options.resume).toBeUndefined();
  expect(s.calls[1]?.options.resume).toBe(s.manager.getSession(handle.id)?.sdk_session_id);
  await s.manager.stopAll();
  return { id: handle.id, envs: s.calls.map((c) => c.options.env) };
}

describe("the launch env turns the SDK's tool deferral off", () => {
  it("a start and a resume both pass ENABLE_TOOL_SEARCH=false, beside the auth env and the host switch", async () => {
    const s = setup();
    const { id, envs } = await startThenResume(s);
    const expected = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: SECRET,
      LOOMWRIGHT_HOST_MODE: "1",
      LOOMWRIGHT_HOST_STATE_DIR: s.stateDirOf(id),
      ENABLE_TOOL_SEARCH: "false",
    };
    expect(envs).toEqual([expected, expected]);
  });

  it("the kernel's value wins over ENABLE_TOOL_SEARCH=true inherited from the daemon's env, at a start and a resume", async () => {
    const seen: BaseEnv[] = [];
    // Like the real providers: the base env minus credentials, then the provider's own credential.
    const passThrough = stubProvider({
      buildEnv: (base) => {
        seen.push({ ...base });
        return { ...stripCredentialEnv(base), ANTHROPIC_API_KEY: SECRET };
      },
    });
    const s = setup({ authProvider: passThrough, baseEnv: { PATH: "/usr/bin", ENABLE_TOOL_SEARCH: "true" } });
    const { id, envs } = await startThenResume(s);
    // The provider saw the inherited value; the child gets the kernel's.
    expect(seen).toEqual([
      { PATH: "/usr/bin", ENABLE_TOOL_SEARCH: "true" },
      { PATH: "/usr/bin", ENABLE_TOOL_SEARCH: "true" },
    ]);
    const expected = {
      PATH: "/usr/bin",
      ENABLE_TOOL_SEARCH: "false",
      ANTHROPIC_API_KEY: SECRET,
      LOOMWRIGHT_HOST_MODE: "1",
      LOOMWRIGHT_HOST_STATE_DIR: s.stateDirOf(id),
    };
    expect(envs).toEqual([expected, expected]);
  });

  it("the kernel's value wins over a contract whose host switch names ENABLE_TOOL_SEARCH, at a start and a resume", async () => {
    const contract = fixtureContract("valid");
    const hostSwitch = contract.host_switch as Record<string, unknown>;
    const install = writeLoomwrightInstall(join(tmp, "installs", "tool-search-switch"), {
      ...contract,
      host_switch: { ...hostSwitch, env: "ENABLE_TOOL_SEARCH" },
    });
    const s = setup({ loomwrightPath: install });
    const { id, envs } = await startThenResume(s);
    const expected = {
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: SECRET,
      ENABLE_TOOL_SEARCH: "false",
      LOOMWRIGHT_HOST_STATE_DIR: s.stateDirOf(id),
    };
    expect(envs).toEqual([expected, expected]);
  });
});
