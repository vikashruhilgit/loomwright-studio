// How kernel tools reach a session (item 09): every launch, a start and every
// resume attempt, passes the Agent SDK's tool deferral off in the env given
// to `query()`, so the CLI offers each tool directly and never only through
// its `ToolSearch` meta-tool (which no policy lists). The setting was probed
// on SDK 0.3.284: docs/evidence/agent-sdk-tool-loading-probe.md. Over the fake
// spawner/query in session-fakes.ts: never the real SDK, a model or a process.
// The variable is kernel-owned: a contract whose host switch names it is refused.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripCredentialEnv } from "../src/auth/index.js";
import type { BaseEnv } from "../src/auth/index.js";
import { LoomwrightSessionError, SessionManager } from "../src/sessions/index.js";
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

function setup(options: Partial<SessionManagerOptions> = {}, dataDirName = "data") {
  const dataDir = join(tmp, dataDirName);
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

async function refusal(p: Promise<unknown>): Promise<LoomwrightSessionError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LoomwrightSessionError);
  return err as LoomwrightSessionError;
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

  it("a contract whose host switch names ENABLE_TOOL_SEARCH is refused (loomwright_contract, contract_invalid): a start writes no row, a resume launches nothing and leaves the row interrupted", async () => {
    const contract = fixtureContract("valid");
    const hostSwitch = contract.host_switch as Record<string, unknown>;
    for (const field of ["env", "state_dir_env"] as const) {
      const naming = { ...contract, host_switch: { ...hostSwitch, [field]: "ENABLE_TOOL_SEARCH" } };
      // A start: refused before admission and before any row is written.
      const refusedInstall = writeLoomwrightInstall(join(tmp, "installs", `refused-${field}`), naming);
      const refused = setup({ loomwrightPath: refusedInstall }, `data-refused-${field}`);
      const startErr = await refusal(refused.manager.startSession(startParams(tmp)));
      expect([startErr.code, startErr.detail, startErr.path], field).toEqual(["loomwright_contract", "contract_invalid", refusedInstall]);
      expect(startErr.message).toContain(`host_switch.${field} must not name ENABLE_TOOL_SEARCH: a variable the kernel sets in every session's environment`);
      expect(refused.store.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
      expect(refused.calls).toEqual([]);

      // A resume: the row's install turns bad after the start; nothing launches and the row keeps its status.
      const install = writeLoomwrightInstall(join(tmp, "installs", `resumed-${field}`));
      const s = setup({ loomwrightPath: install }, `data-resumed-${field}`);
      const handle = await s.manager.startSession(startParams(tmp));
      await vi.waitFor(() => expect(s.manager.getSession(handle.id)?.status).toBe("running"));
      await s.manager.stopAll({ mode: "shutdown" });
      expect(await handle.done).toBe("interrupted");
      writeLoomwrightInstall(install, naming);
      const resumeErr = await refusal(s.manager.resumeSession(handle.id, { ...resumeParams, cwd: tmp }));
      expect([resumeErr.code, resumeErr.detail, resumeErr.path], field).toEqual(["loomwright_contract", "contract_invalid", install]);
      expect(s.manager.getSession(handle.id)).toMatchObject({ status: "interrupted", loomwright_path: install });
      expect(s.calls).toHaveLength(1);
    }
  });
});
