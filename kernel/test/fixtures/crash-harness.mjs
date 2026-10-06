// The phase 1 exit test's kernel process (item 09, AC3/AC4): a composition of
// the BUILT kernel that the tests start, `kill -9` and start again. Plain JS:
// it runs as its own `node` process against `<outDir>/kernel.js` (tsconfig has
// no allowJs, and Node 22.14 cannot run the .ts sources). Test-only: nothing in
// kernel/src/ knows about it, so the shipped daemon can reach none of it.
//
//   node crash-harness.mjs --out-dir <dist> --data-dir <dir> --cwd <dir>
//        [--plugin-dir <dir>] [--leader <claude> --sleep-ms <n>]
//        [--enqueue] [--fault task-create] [--live]
//
// It plays the part of a playbook: its `message` handler starts ONE session
// for the event, and on a redelivery after a crash resumes that session
// instead of starting a second one. In deterministic mode (no --live) the SDK
// `query` is replaced by a stand-in session that runs a real process group led
// by `--leader` (a symlink named `claude`, see crash-helpers.ts) and calls the
// per-launch `kernel` MCP server's `kernel_task_create` itself: no model, no
// Keychain. With --live: the real SDK, the subscription-token provider and the
// real Keychain READ path; the API token is kept in memory, never written.
//
// stdout carries exactly one line, `{"ready":true,"pid":<pid>}`, once the
// kernel is up. SIGTERM stops the kernel gracefully and exits 0.
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const EXIT_TEST_KEY = "exit-test-key";
const EXIT_TEST_MODEL = "claude-haiku-4-5";
const EXIT_TEST_POLICY = { allowedTools: ["mcp__kernel__kernel_task_create", "Bash"], allowedBashPrefixes: ["sleep"] };
/**
 * How long a first launch waits for the kernel to record its leader's start
 * time (the async `ps` probe, bounded by its own 2 s timeout) before the
 * harness gives up with a named precondition error.
 */
const LEADER_RECORDED_TIMEOUT_MS = 5_000;
/**
 * How long a first launch waits for the kernel's tool-group poll (one `ps -A`
 * walk a second) to record the stand-in's tool group before the harness gives
 * up with a named precondition error.
 */
const TOOL_GROUP_RECORDED_TIMEOUT_MS = 10_000;
const EXIT_TEST_PROMPT =
  'Call the tool mcp__kernel__kernel_task_create with title "exit test", state "open" and idempotency_key "exit-test-key". ' +
  "Then run the Bash command `sleep 20`. Then reply DONE.";

function parseArgs(argv) {
  const out = { enqueue: false, live: false, fault: undefined, sleepMs: 30_000 };
  const value = (i) => {
    const v = argv[i + 1];
    if (v === undefined || v === "") throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--enqueue") out.enqueue = true;
    else if (a === "--live") out.live = true;
    else if (a === "--out-dir") out.outDir = value(i++);
    else if (a === "--data-dir") out.dataDir = value(i++);
    else if (a === "--cwd") out.cwd = value(i++);
    else if (a === "--plugin-dir") out.pluginDir = value(i++);
    else if (a === "--leader") out.leader = value(i++);
    else if (a === "--sleep-ms") out.sleepMs = Number(value(i++));
    else if (a === "--fault") {
      out.fault = value(i++);
      if (out.fault !== "task-create") throw new Error(`unknown fault: ${out.fault}`);
    } else throw new Error(`unknown argument: ${a}`);
  }
  for (const k of ["outDir", "dataDir", "cwd"]) if (out[k] === undefined) throw new Error(`--${k} is required`);
  if (!out.live && out.leader === undefined) throw new Error("--leader is required without --live");
  return out;
}

/**
 * The exit test's reaper kills the orphaned group only when the session row
 * recorded the leader's start time before the kill -9; with the probe async,
 * a kill could otherwise race it. Never a silent skip: exit 1 with a named
 * error, which the test prints, instead of an obscure reap assertion later.
 */
function failPrecondition(message) {
  process.stderr.write(`crash-harness: precondition failed: ${message}\n`);
  process.exit(1);
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * AC4's fault, installed ONLY here: the store's `INSERT INTO tasks` statement
 * runs, then the process SIGKILLs itself before `runStep`'s transaction (which
 * holds the INSERT, the `task_created` event and the work step) commits. The
 * stand-in calls the tool only once the leader's start time is recorded; the
 * check here is a backstop for that ordering.
 */
function withTaskCreateFault(store) {
  const prepare = store.prepare.bind(store);
  store.prepare = (sql) => {
    const stmt = prepare(sql);
    if (!/^\s*INSERT INTO tasks\b/.test(sql)) return stmt;
    return new Proxy(stmt, {
      get(target, prop) {
        if (prop !== "run") {
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        }
        return (...args) => {
          target.run(...args);
          const unrecorded = prepare("SELECT count(*) FROM sessions WHERE pgid IS NOT NULL AND leader_started_at IS NULL").pluck().get();
          if (unrecorded !== 0) failPrecondition("a session's leader_started_at is still null at the task-create fault");
          // kill(2) on oneself delivers an unblocked SIGKILL before it returns;
          // the loop is only a guard that nothing after it can ever run.
          process.kill(process.pid, "SIGKILL");
          for (;;);
        };
      },
    });
  };
  return store;
}

/** The SDK result message (shape of test/fixtures/sdk/p3-result.json, zero usage). */
function resultMessage(sessionId) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 1,
    result: "DONE",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000000",
    session_id: sessionId,
  };
}

/**
 * The stand-in for the SDK's `query` (deterministic mode). Like the SDK, it
 * spawns the CLI synchronously inside `query()` through
 * `options.spawnClaudeCodeProcess`, so the manager records the pgid and the
 * leader's start time before any message. On a first launch the leader
 * forks a child into a NEW session and group (`detached: true`), as the CLI's
 * Bash tool does (H08): the stand-in's "tool command", outside the CLI's
 * group, run through the same `claude` path so the test's ownership-checked
 * cleanup (`killOwnGroup`) can kill it. Then: `system/init`; on a first
 * launch, wait until the handler's `start-session` step committed (so a kill
 * from here on never leaves that step `started`), until the row records
 * the leader's start time (the manager reads it asynchronously; a kill before
 * that would leave the group unverifiable) and until the kernel's poll has
 * recorded the tool group (`session_groups`); call `kernel_task_create`
 * with the fixed key through the per-launch server the manager passed; wait
 * for the leader to exit; a success `result`. A resume does the same with a
 * leader that exits at once, and calls the tool again with the SAME key: the
 * session-scoped work step must return the first task.
 */
function standInQuery({ leader, sleepMs, startStepCommitted, leaderStartedAt, toolGroupsRecorded }) {
  return ({ prompt, options }) => {
    const resumed = options.resume !== undefined;
    const sessionId = options.resume ?? options.sessionId ?? "unknown";
    // The tool command: a detached grandchild (new session and group) that outlives nothing on its own.
    const tool =
      `require("node:child_process").spawn(${JSON.stringify(leader)}, ["-e", "setTimeout(() => {}, ${sleepMs})"], ` +
      `{ detached: true, stdio: "ignore" }).unref();`;
    const child = options.spawnClaudeCodeProcess({
      command: leader,
      args: ["-e", `${resumed ? "" : tool} setTimeout(() => {}, ${resumed ? 0 : sleepMs})`],
      cwd: options.cwd,
      env: options.env ?? {},
      signal: options.abortController?.signal ?? new AbortController().signal,
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const closed = deferred();
    // Read and drop the prompt, like the CLI.
    void (async () => {
      for await (const _m of prompt) {
        // nothing
      }
    })();

    async function* messages() {
      yield { type: "system", subtype: "init", session_id: sessionId };
      if (!resumed) {
        await Promise.race([startStepCommitted, closed.promise]);
        const until = Date.now() + LEADER_RECORDED_TIMEOUT_MS;
        while (leaderStartedAt(sessionId) == null) {
          if (Date.now() >= until) failPrecondition(`leader_started_at of session ${sessionId} still null after ${LEADER_RECORDED_TIMEOUT_MS} ms`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const groupsBy = Date.now() + TOOL_GROUP_RECORDED_TIMEOUT_MS;
        while (!(toolGroupsRecorded(sessionId) > 0)) {
          if (Date.now() >= groupsBy) failPrecondition(`no tool group of session ${sessionId} recorded after ${TOOL_GROUP_RECORDED_TIMEOUT_MS} ms`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const server = options.mcpServers?.kernel;
      const tool = server?.instance?._registeredTools?.kernel_task_create;
      if (tool === undefined) throw new Error("stand-in: no kernel_task_create on the per-launch kernel server");
      const res = await tool.handler({ title: "exit test", state: "open", idempotency_key: EXIT_TEST_KEY }, {});
      if (res?.isError === true) throw new Error(`stand-in: kernel_task_create failed: ${res.content?.[0]?.text ?? "?"}`);
      if ((await Promise.race([exited.then(() => "exited"), closed.promise.then(() => "closed")])) === "closed") return;
      yield resultMessage(sessionId);
    }
    const iterator = messages();
    return {
      [Symbol.asyncIterator]: () => iterator,
      close: () => closed.resolve(),
    };
  };
}

function memoryKeychain(real, apiTokenService) {
  const items = new Map();
  return {
    // The API token lives in memory only; anything else (the live
    // subscription token) is read from `real`, never written.
    reader: { read: (service) => (service === apiTokenService || real === undefined ? items.get(service) : real.read(service)) },
    writer: { add: (service, _account, secret) => void items.set(service, secret) },
    items,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = (p) => pathToFileURL(join(args.outDir, p)).href;
  const { startKernel } = await import(dist("kernel.js"));
  const { Store } = await import(dist("store/store.js"));
  const { enqueueMessage } = await import(dist("loop/queue.js"));
  const { API_TOKEN_KEYCHAIN_SERVICE } = await import(dist("api/token.js"));

  const kernelReady = deferred();
  const startStepCommitted = deferred();
  const handles = new Map();
  const startParams = (agent) => ({
    agent,
    prompt: EXIT_TEST_PROMPT,
    model: EXIT_TEST_MODEL,
    permissionMode: "default",
    cwd: args.cwd,
    policy: EXIT_TEST_POLICY,
  });

  // The "playbook". The session is linked to the event durably twice: the
  // `start-session` step's stored result (its id) and the agent label.
  const message = async (ctx) => {
    const kernel = await kernelReady.promise;
    const agent = `exit-test:event-${ctx.event.id}`;
    // Not re-runnable, and done right after the launch, long before any kill.
    const sessionId = await ctx.runStepAsync("start-session", async () => {
      const handle = await kernel.sessions.startSession(startParams(agent));
      handles.set(handle.id, handle);
      return handle.id;
    });
    startStepCommitted.resolve();
    // Outside any non-rerunnable step: a kill while awaiting must not leave a
    // `started` step that a redelivery would turn into failed:interrupted.
    let status;
    const handle = handles.get(sessionId);
    if (handle !== undefined) status = await handle.done;
    else {
      const row = kernel.sessions.getSession(sessionId);
      if (row === undefined) throw new Error(`no session ${sessionId} for event ${ctx.event.id}`);
      if (row.status === "completed") return;
      if (row.status !== "interrupted" && row.status !== "orphaned") throw new Error(`session ${sessionId} is ${row.status}`);
      const resumed = await kernel.sessions.resumeSession(sessionId, { permissionMode: "default", cwd: args.cwd, policy: EXIT_TEST_POLICY });
      status = await resumed.done;
    }
    if (status !== "completed") throw new Error(`session ${sessionId} ended ${status}`);
  };

  let keychain;
  let store;
  const deps = {};
  if (args.live) {
    const { securityCliKeychain } = await import(dist("auth/keychain.js"));
    keychain = memoryKeychain(securityCliKeychain(), API_TOKEN_KEYCHAIN_SERVICE);
  } else {
    keychain = memoryKeychain(undefined, API_TOKEN_KEYCHAIN_SERVICE);
    deps.availableProviderIds = async () => ["stub"];
    deps.selectAuthProvider = async () => ({
      id: "stub-provider",
      account: "exit-test@example.test",
      buildEnv: () => ({ PATH: "/usr/bin:/bin" }),
      health: () => ({ status: "ok" }),
    });
    deps.sessionDeps = {
      query: standInQuery({
        leader: args.leader,
        sleepMs: args.sleepMs,
        startStepCommitted: startStepCommitted.promise,
        leaderStartedAt: (sdkSessionId) =>
          store?.prepare("SELECT leader_started_at FROM sessions WHERE sdk_session_id = ?").pluck().get(sdkSessionId),
        toolGroupsRecorded: (sdkSessionId) =>
          store
            ?.prepare("SELECT count(*) FROM session_groups g JOIN sessions s ON s.id = g.session_id WHERE s.sdk_session_id = ?")
            .pluck()
            .get(sdkSessionId) ?? 0,
      }),
    };
  }
  deps.keychain = keychain.reader;
  deps.keychainWriter = keychain.writer;
  deps.openStore = (dir) => {
    store = new Store({ dataDir: dir });
    // Before startKernel starts the loop.
    if (args.enqueue) enqueueMessage(store, { text: "exit test" });
    return args.fault === "task-create" ? withTaskCreateFault(store) : store;
  };

  const kernel = await startKernel(
    {
      dataDir: args.dataDir,
      env: args.live ? process.env : { PATH: "/usr/bin:/bin" },
      ...(args.live ? { authProviderId: "subscription-token" } : {}),
      handlers: { message },
      sessions: { ...(args.pluginDir === undefined ? {} : { loomwrightPath: args.pluginDir }), stopGraceMs: 100 },
    },
    deps,
  );
  kernelReady.resolve(kernel);
  process.once("SIGTERM", () => {
    kernel.stop().then(
      () => process.exit(0),
      (err) => {
        process.stderr.write(`crash-harness: stop failed: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      },
    );
  });
  process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid })}\n`);
}

main().catch((err) => {
  process.stderr.write(`crash-harness: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
